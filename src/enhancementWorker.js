import {
    DEFAULT_MONTE_CARLO_SAMPLES,
    MONTE_CARLO_HARD_TRANSITION_LIMIT,
    MONTE_CARLO_LOAD_THRESHOLD,
    analyzeEnhancementRisk,
    calculateStrategyCostMoments,
    createMonteCarloTrialAccumulator,
    createSeededRandom,
    fitGammaRisk,
    runEnhancementTrial,
    summarizeMonteCarloTrials,
} from "./services/enhancementSimulator.js";

const DEFAULT_BATCH_SIZE = 256;
const MAX_SAMPLE_COUNT = 1_000_000;

function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function toInteger(value, fallback = 0) {
    return Math.trunc(toFiniteNumber(value, fallback));
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function pickRunOptions(payload) {
    const options = {
        ...(payload?.riskOptions && typeof payload.riskOptions === "object" ? payload.riskOptions : {}),
        ...(payload?.options && typeof payload.options === "object" ? payload.options : {}),
    };
    const topLevelKeys = [
        "sampleCount",
        "seed",
        "budget",
        "percentiles",
        "loadThreshold",
        "hardTransitionLimit",
        "batchSize",
        "includeTrials",
    ];
    for (const key of topLevelKeys) {
        if (payload?.[key] !== undefined) {
            options[key] = payload[key];
        }
    }
    return options;
}

function normalizeRun(payload) {
    const strategy = payload?.strategy || payload?.input;
    if (!strategy?.model?.outcomes?.length) {
        throw new Error("A valid enhancement strategy is required.");
    }
    const options = pickRunOptions(payload);
    const sampleCount = clamp(
        toInteger(options.sampleCount ?? strategy.config?.sampleCount, DEFAULT_MONTE_CARLO_SAMPLES),
        1,
        MAX_SAMPLE_COUNT
    );
    const seed = options.seed ?? strategy.config?.seed ?? 1;
    const budget = options.budget ?? strategy.config?.budget;
    const loadThreshold = Math.max(
        0,
        toFiniteNumber(options.loadThreshold, MONTE_CARLO_LOAD_THRESHOLD)
    );
    const hardTransitionLimit = Math.min(
        MONTE_CARLO_HARD_TRANSITION_LIMIT,
        Math.max(1, toInteger(options.hardTransitionLimit, MONTE_CARLO_HARD_TRANSITION_LIMIT))
    );
    const batchSize = clamp(toInteger(options.batchSize, DEFAULT_BATCH_SIZE), 1, 4096);
    const estimatedTransitions = toFiniteNumber(strategy.expectedActions, 0) * sampleCount;
    return {
        strategy,
        options: {
            ...options,
            sampleCount,
            seed,
            budget,
            hardTransitionLimit,
        },
        sampleCount,
        seed,
        budget,
        loadThreshold,
        hardTransitionLimit,
        batchSize,
        estimatedTransitions,
    };
}

function gammaFallback(run, metadata) {
    const moments = calculateStrategyCostMoments(run.strategy);
    const startingItem = run.strategy.startingItem;
    const initialOffset = startingItem?.available
        ? toFiniteNumber(startingItem.price, 0) * toFiniteNumber(run.strategy.markupMultiplier, 1)
        : 0;
    return {
        ...fitGammaRisk(moments, {
            ...run.options,
            budget: run.budget,
            seed: run.seed,
            offset: initialOffset,
        }),
        estimatedTransitions: run.estimatedTransitions,
        ...metadata,
    };
}

function defaultYieldTask() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

export function createEnhancementWorkerRuntime(runtimeOptions = {}) {
    const post = typeof runtimeOptions.postMessage === "function"
        ? runtimeOptions.postMessage
        : () => {};
    const yieldTask = typeof runtimeOptions.yieldTask === "function"
        ? runtimeOptions.yieldTask
        : defaultYieldTask;
    let activeRun = null;

    function isCurrent(token) {
        return activeRun === token && !token.cancelled;
    }

    function postFor(token, message) {
        if (!isCurrent(token)) {
            return false;
        }
        post({ ...message, runId: token.runId });
        return true;
    }

    function cancelToken(token, reason = "requested") {
        if (!token || token.cancelled) {
            return false;
        }
        token.cancelled = true;
        if (activeRun === token) {
            activeRun = null;
        }
        post({
            type: "enhancement_cancelled",
            runId: token.runId,
            reason,
        });
        return true;
    }

    async function executeRun(payload) {
        if (activeRun) {
            cancelToken(activeRun, "superseded");
        }

        const token = {
            runId: String(payload?.runId || ""),
            cancelled: false,
        };
        activeRun = token;

        try {
            const run = normalizeRun(payload);
            if (run.estimatedTransitions >= run.loadThreshold) {
                const result = analyzeEnhancementRisk(run.strategy, {
                    ...run.options,
                    loadThreshold: run.loadThreshold,
                });
                if (postFor(token, { type: "enhancement_result", result })) {
                    activeRun = null;
                }
                return result;
            }

            const random = createSeededRandom(run.seed);
            const includeTrials = run.options.includeTrials !== false;
            const trials = includeTrials ? [] : null;
            const compactTrials = includeTrials
                ? null
                : createMonteCarloTrialAccumulator(run.strategy, run.options);
            let completed = 0;
            let transitions = 0;

            while (completed < run.sampleCount) {
                const batchEnd = Math.min(completed + run.batchSize, run.sampleCount);
                while (completed < batchEnd) {
                    if (!isCurrent(token)) {
                        return null;
                    }
                    const remainingTransitions = run.hardTransitionLimit - transitions;
                    if (remainingTransitions <= 0) {
                        const result = gammaFallback(run, {
                            transitions,
                            actualSamples: completed,
                            fallbackReason: "hard_transition_limit",
                        });
                        if (postFor(token, { type: "enhancement_result", result })) {
                            activeRun = null;
                        }
                        return result;
                    }

                    const trial = runEnhancementTrial(run.strategy, random, {
                        ...run.options,
                        maxTransitions: remainingTransitions,
                    });
                    transitions += trial.transitions;
                    if (trial.exceeded) {
                        const result = gammaFallback(run, {
                            transitions,
                            actualSamples: completed,
                            fallbackReason: "hard_transition_limit",
                        });
                        if (postFor(token, { type: "enhancement_result", result })) {
                            activeRun = null;
                        }
                        return result;
                    }
                    if (includeTrials) {
                        trials.push(trial);
                    } else {
                        compactTrials.add(trial);
                    }
                    completed += 1;
                }

                if (!postFor(token, {
                    type: "enhancement_progress",
                    completed,
                    total: run.sampleCount,
                    progress: completed / run.sampleCount,
                    transitions,
                    estimatedTransitions: run.estimatedTransitions,
                })) {
                    return null;
                }

                if (completed < run.sampleCount) {
                    await yieldTask();
                }
            }

            const summary = includeTrials
                ? summarizeMonteCarloTrials(trials, run.options)
                : compactTrials.summarize(run.options);
            const result = {
                ...summary,
                seed: run.seed,
                sampleCount: run.sampleCount,
                actualSamples: completed,
                transitions,
                exceeded: false,
                cancelled: false,
                trials: includeTrials ? trials : undefined,
                estimatedTransitions: run.estimatedTransitions,
            };
            if (postFor(token, { type: "enhancement_result", result })) {
                activeRun = null;
            }
            return result;
        } catch (error) {
            if (postFor(token, {
                type: "enhancement_error",
                error: error instanceof Error ? error.message : String(error),
            })) {
                activeRun = null;
            }
            return null;
        }
    }

    function handleMessage(message = {}) {
        if (message.type === "enhancement_run") {
            return executeRun(message);
        }
        if (message.type === "enhancement_cancel") {
            const runId = String(message.runId || "");
            if (activeRun?.runId === runId) {
                cancelToken(activeRun);
            }
        }
        return Promise.resolve(null);
    }

    return {
        handleMessage,
        getActiveRunId: () => activeRun?.runId || "",
    };
}

const isWorkerScope = typeof self !== "undefined"
    && typeof self.postMessage === "function"
    && typeof self.addEventListener === "function"
    && typeof document === "undefined";

if (isWorkerScope) {
    const runtime = createEnhancementWorkerRuntime({
        postMessage: (message) => self.postMessage(message),
    });
    self.addEventListener("message", (event) => {
        void runtime.handleMessage(event.data);
    });
}

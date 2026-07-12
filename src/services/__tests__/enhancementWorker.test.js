import { describe, expect, it } from "vitest";
import { createEnhancementWorkerRuntime } from "../../enhancementWorker.js";
import {
    analyzeEnhancementRisk,
    analyzeEnhancementStrategy,
    runMonteCarloTrials,
} from "../enhancementSimulator.js";

const enhancementData = {
    successRates: [
        0.5, 0.45, 0.45, 0.4, 0.4, 0.4, 0.35, 0.35, 0.35, 0.35,
        0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3,
    ],
    actionBaseSeconds: 12,
    enhanceableItems: [{
        hrid: "/items/test_sword",
        itemLevel: 10,
        enhancementCosts: [{ itemHrid: "/items/coin", count: 5 }],
    }],
};

const pricing = {
    priceTable: {
        "/items/test_sword": { ask: 100 },
        "/items/mirror_of_protection": { ask: 20 },
    },
};

function createStrategy(overrides = {}) {
    return analyzeEnhancementStrategy({
        itemHrid: "/items/test_sword",
        skillLevel: 10,
        startLevel: 0,
        targetLevel: 3,
        protectAt: 2,
        ...overrides,
    }, enhancementData, pricing);
}

describe("enhancementWorker runtime", () => {
    it("matches the synchronous seeded Monte Carlo result across batches", async () => {
        const strategy = createStrategy();
        const messages = [];
        const runtime = createEnhancementWorkerRuntime({
            postMessage: (message) => messages.push(message),
            yieldTask: () => Promise.resolve(),
        });
        const options = {
            sampleCount: 64,
            seed: "worker-seed",
            budget: 250,
            batchSize: 7,
            loadThreshold: Number.MAX_SAFE_INTEGER,
        };

        await runtime.handleMessage({
            type: "enhancement_run",
            runId: "run-1",
            strategy,
            options,
        });

        const resultMessage = messages.find((message) => message.type === "enhancement_result");
        const synchronous = runMonteCarloTrials(strategy, {
            ...options,
            estimatedTransitions: strategy.expectedActions * options.sampleCount,
        });
        expect(resultMessage).toEqual({
            type: "enhancement_result",
            runId: "run-1",
            result: synchronous,
        });
        expect(messages.filter((message) => message.type === "enhancement_progress")).toHaveLength(10);
        expect(messages.at(-2)).toMatchObject({
            type: "enhancement_progress",
            runId: "run-1",
            completed: 64,
            progress: 1,
        });
        expect(runtime.getActiveRunId()).toBe("");
    });

    it("matches compact synchronous summaries without returning full trials", async () => {
        const strategy = createStrategy();
        const messages = [];
        const runtime = createEnhancementWorkerRuntime({
            postMessage: (message) => messages.push(message),
            yieldTask: () => Promise.resolve(),
        });
        const options = {
            sampleCount: 128,
            seed: "compact-worker",
            budget: 250,
            batchSize: 11,
            includeTrials: false,
            loadThreshold: Number.MAX_SAFE_INTEGER,
        };

        await runtime.handleMessage({
            type: "enhancement_run",
            runId: "compact-run",
            strategy,
            options,
        });

        const result = messages.find((message) => message.type === "enhancement_result")?.result;
        expect(result).toEqual(runMonteCarloTrials(strategy, {
            ...options,
            estimatedTransitions: strategy.expectedActions * options.sampleCount,
        }));
        expect(result.trials).toBeUndefined();
    });

    it("acknowledges cancellation and suppresses all later progress and results", async () => {
        const messages = [];
        let runtime;
        runtime = createEnhancementWorkerRuntime({
            postMessage(message) {
                messages.push(message);
                if (message.type === "enhancement_progress") {
                    void runtime.handleMessage({
                        type: "enhancement_cancel",
                        runId: message.runId,
                    });
                }
            },
            yieldTask: () => Promise.resolve(),
        });

        await runtime.handleMessage({
            type: "enhancement_run",
            runId: "cancel-me",
            strategy: createStrategy(),
            sampleCount: 100,
            batchSize: 5,
            loadThreshold: Number.MAX_SAFE_INTEGER,
        });

        expect(messages.filter((message) => message.type === "enhancement_progress")).toHaveLength(1);
        expect(messages).toContainEqual({
            type: "enhancement_cancelled",
            runId: "cancel-me",
            reason: "requested",
        });
        expect(messages.some((message) => message.type === "enhancement_result")).toBe(false);
        expect(runtime.getActiveRunId()).toBe("");
    });

    it("prevents a superseded run from publishing a late result", async () => {
        const messages = [];
        const pendingYields = [];
        const runtime = createEnhancementWorkerRuntime({
            postMessage: (message) => messages.push(message),
            yieldTask: () => new Promise((resolve) => pendingYields.push(resolve)),
        });

        const oldRun = runtime.handleMessage({
            type: "enhancement_run",
            runId: "old",
            strategy: createStrategy(),
            sampleCount: 20,
            batchSize: 1,
            loadThreshold: Number.MAX_SAFE_INTEGER,
        });
        const newRun = runtime.handleMessage({
            type: "enhancement_run",
            runId: "new",
            strategy: createStrategy({ targetLevel: 1 }),
            sampleCount: 1,
            loadThreshold: Number.MAX_SAFE_INTEGER,
        });

        await newRun;
        pendingYields.splice(0).forEach((resolve) => resolve());
        await oldRun;

        expect(messages).toContainEqual({
            type: "enhancement_cancelled",
            runId: "old",
            reason: "superseded",
        });
        expect(messages.filter((message) => message.type === "enhancement_result" && message.runId === "old"))
            .toHaveLength(0);
        expect(messages.filter((message) => message.type === "enhancement_result" && message.runId === "new"))
            .toHaveLength(1);
    });

    it("falls back to exact moments and Gamma at the transition hard limit", async () => {
        const messages = [];
        const strategy = createStrategy();
        const runtime = createEnhancementWorkerRuntime({
            postMessage: (message) => messages.push(message),
            yieldTask: () => Promise.resolve(),
        });

        await runtime.handleMessage({
            type: "enhancement_run",
            runId: "capped",
            strategy,
            sampleCount: 100,
            hardTransitionLimit: 1,
            loadThreshold: Number.MAX_SAFE_INTEGER,
        });

        const result = messages.find((message) => message.type === "enhancement_result")?.result;
        expect(result).toMatchObject({
            method: "moment_gamma",
            approximate: true,
            fallbackReason: "hard_transition_limit",
            transitions: 1,
            actualSamples: 0,
        });
        expect(result.quantiles).toHaveProperty("99");
        expect(result).toEqual(analyzeEnhancementRisk(strategy, {
            sampleCount: 100,
            hardTransitionLimit: 1,
            loadThreshold: Number.MAX_SAFE_INTEGER,
        }));
    });

    it("defensively skips Monte Carlo when the estimated load is high", async () => {
        const messages = [];
        const runtime = createEnhancementWorkerRuntime({
            postMessage: (message) => messages.push(message),
        });

        await runtime.handleMessage({
            type: "enhancement_run",
            runId: "high-load",
            strategy: createStrategy(),
            sampleCount: 32,
            loadThreshold: 1,
        });

        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({
            type: "enhancement_result",
            runId: "high-load",
            result: {
                method: "moment_gamma",
                fallbackReason: "estimated_load",
                transitions: 0,
            },
        });
    });
});

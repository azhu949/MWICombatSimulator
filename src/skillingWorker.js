import { skillingData } from "./shared/gameDataIndex.js";
import {
    buildSkillingOverview,
    normalizeSkillingBalancedCostTolerance,
    normalizeSkillingOptimizationMode,
    planSkillingSkill,
    resolveSkillingSkillHrids,
} from "./services/skillingPlanner.js";

function finiteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function defaultYieldTask() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

export function createSkillingWorkerRuntime(options = {}) {
    const post = typeof options.postMessage === "function" ? options.postMessage : () => {};
    const yieldTask = typeof options.yieldTask === "function" ? options.yieldTask : defaultYieldTask;
    let activeRun = null;

    function isCurrent(token) {
        return activeRun === token && token.cancelled !== true;
    }

    function cancel(reason = "requested") {
        if (!activeRun) {
            return false;
        }
        const token = activeRun;
        token.cancelled = true;
        activeRun = null;
        post({ type: "skilling_cancelled", runId: token.runId, reason });
        return true;
    }

    async function execute(payload) {
        if (activeRun) {
            cancel("superseded");
        }
        const token = { runId: String(payload?.runId || ""), cancelled: false };
        activeRun = token;
        try {
            const optimizationMode = normalizeSkillingOptimizationMode(payload?.optimizationMode);
            const balancedCostTolerance = normalizeSkillingBalancedCostTolerance(payload?.balancedCostTolerance);
            const skillHrids = resolveSkillingSkillHrids(skillingData, payload?.skillHrids);
            const plansBySkill = {};
            for (let index = 0; index < skillHrids.length; index += 1) {
                if (!isCurrent(token)) {
                    return null;
                }
                const skillHrid = skillHrids[index];
                plansBySkill[skillHrid] = planSkillingSkill({
                    profile: payload?.profile,
                    skillHrid,
                    targetLevel: payload?.targetLevels?.[skillHrid],
                    priceTable: payload?.priceTable,
                    enhancementQuotesByItem: payload?.enhancementQuotesByItem,
                    optimizationMode,
                    balancedCostTolerance,
                    data: skillingData,
                    feeRate: payload?.feeRate,
                    now: payload?.now,
                    onProgress: (progress) => {
                        if (!isCurrent(token)) return;
                        post({
                            type: "skilling_progress",
                            runId: token.runId,
                            ...progress,
                            skillIndex: index,
                            skillCount: skillHrids.length,
                            overallProgress: (index + finiteNumber(progress?.progress, 0)) / Math.max(1, skillHrids.length),
                        });
                    },
                });
                post({
                    type: "skilling_progress",
                    runId: token.runId,
                    skillHrid,
                    skillIndex: index,
                    skillCount: skillHrids.length,
                    overallProgress: (index + 1) / Math.max(1, skillHrids.length),
                });
                await yieldTask();
            }
            if (!isCurrent(token)) {
                return null;
            }
            const overview = buildSkillingOverview(plansBySkill, optimizationMode);
            const result = {
                generatedAt: finiteNumber(payload?.now, Date.now()),
                optimizationMode,
                balancedCostTolerance,
                skillHrids,
                plansBySkill,
                overview,
            };
            post({ type: "skilling_result", runId: token.runId, result });
            activeRun = null;
            return result;
        } catch (error) {
            if (isCurrent(token)) {
                post({
                    type: "skilling_error",
                    runId: token.runId,
                    error: error instanceof Error ? error.message : String(error),
                });
                activeRun = null;
            }
            return null;
        }
    }

    function handleMessage(message = {}) {
        if (message.type === "skilling_run") {
            return execute(message);
        }
        if (message.type === "skilling_cancel" && activeRun?.runId === String(message.runId || "")) {
            cancel();
        }
        return Promise.resolve(null);
    }

    return { handleMessage, cancel, getActiveRunId: () => activeRun?.runId || "" };
}

const isWorkerScope = typeof self !== "undefined"
    && typeof self.postMessage === "function"
    && typeof self.addEventListener === "function"
    && typeof document === "undefined";

if (isWorkerScope) {
    const runtime = createSkillingWorkerRuntime({ postMessage: (message) => self.postMessage(message) });
    self.addEventListener("message", (event) => {
        void runtime.handleMessage(event.data);
    });
}

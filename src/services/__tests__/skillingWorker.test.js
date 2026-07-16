import { describe, expect, it } from "vitest";
import { skillingData } from "../../shared/gameDataIndex.js";
import { createSkillingWorkerRuntime } from "../../skillingWorker.js";
import { SKILLING_OPTIMIZATION_MODE_BALANCED } from "../skillingPlanner.js";

function completedPayload(runId) {
    return {
        type: "skilling_run",
        runId,
        profile: {
            skills: Object.fromEntries([
                ...skillingData.skillHrids.map((skillHrid) => [skillHrid, { level: 1, experience: 0 }]),
                ["/skills/total_level", { level: skillingData.skillHrids.length, experience: null }],
            ]),
            inventory: {},
            equipment: [],
            buffsBySource: {},
        },
        targetLevels: Object.fromEntries(skillingData.skillHrids.map((skillHrid) => [skillHrid, 1])),
        priceTable: {},
        optimizationMode: SKILLING_OPTIMIZATION_MODE_BALANCED,
        balancedCostTolerance: 0.25,
        now: 1234,
    };
}

describe("skillingWorker runtime", () => {
    it("publishes per-skill progress without ranking completed targets", async () => {
        const messages = [];
        const runtime = createSkillingWorkerRuntime({
            postMessage: (message) => messages.push(message),
            yieldTask: () => Promise.resolve(),
        });

        await runtime.handleMessage(completedPayload("complete"));

        expect(messages.filter((message) => message.type === "skilling_progress")).toHaveLength(skillingData.skillHrids.length);
        const result = messages.find((message) => message.type === "skilling_result");
        expect(result.runId).toBe("complete");
        expect(result.result.generatedAt).toBe(1234);
        expect(result.result.optimizationMode).toBe(SKILLING_OPTIMIZATION_MODE_BALANCED);
        expect(result.result.balancedCostTolerance).toBe(0.25);
        expect(Object.keys(result.result.plansBySkill)).toEqual(skillingData.skillHrids);
        expect(Object.values(result.result.plansBySkill).every((plan) => plan.balancedCostTolerance === 0.25)).toBe(true);
        expect(result.result.overview).toEqual([]);
        expect(runtime.getActiveRunId()).toBe("");
    });

    it("normalizes out-of-range balanced tolerance values", async () => {
        const messages = [];
        const runtime = createSkillingWorkerRuntime({
            postMessage: (message) => messages.push(message),
            yieldTask: () => Promise.resolve(),
        });
        const payload = completedPayload("clamped");
        payload.balancedCostTolerance = 4;

        await runtime.handleMessage(payload);

        const result = messages.find((message) => message.type === "skilling_result");
        expect(result.result.balancedCostTolerance).toBe(1);
        expect(Object.values(result.result.plansBySkill).every((plan) => plan.balancedCostTolerance === 1)).toBe(true);
    });

    it("acknowledges cancellation and suppresses the final result", async () => {
        const messages = [];
        let runtime;
        runtime = createSkillingWorkerRuntime({
            postMessage(message) {
                messages.push(message);
                if (message.type === "skilling_progress") {
                    void runtime.handleMessage({ type: "skilling_cancel", runId: message.runId });
                }
            },
            yieldTask: () => Promise.resolve(),
        });

        await runtime.handleMessage(completedPayload("cancelled"));

        expect(messages).toContainEqual({
            type: "skilling_cancelled",
            runId: "cancelled",
            reason: "requested",
        });
        expect(messages.some((message) => message.type === "skilling_result")).toBe(false);
        expect(runtime.getActiveRunId()).toBe("");
    });
});

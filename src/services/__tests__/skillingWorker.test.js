import { describe, expect, it } from "vitest";
import { skillingData } from "../../shared/gameDataIndex.js";
import { createSkillingWorkerRuntime } from "../../skillingWorker.js";

function completedPayload(runId) {
    return {
        type: "skilling_run",
        runId,
        profile: {
            skills: Object.fromEntries([
                ...skillingData.skillHrids.map((skillHrid) => [skillHrid, { level: 1, experience: 0 }]),
                ["/skills/total_level", { level: 5, experience: null }],
            ]),
            inventory: {},
            equipment: [],
            buffsBySource: {},
        },
        targetLevels: Object.fromEntries(skillingData.skillHrids.map((skillHrid) => [skillHrid, 1])),
        priceTable: {},
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

        expect(messages.filter((message) => message.type === "skilling_progress")).toHaveLength(5);
        const result = messages.find((message) => message.type === "skilling_result");
        expect(result.runId).toBe("complete");
        expect(result.result.generatedAt).toBe(1234);
        expect(Object.keys(result.result.plansBySkill)).toEqual(skillingData.skillHrids);
        expect(result.result.overview).toEqual([]);
        expect(runtime.getActiveRunId()).toBe("");
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

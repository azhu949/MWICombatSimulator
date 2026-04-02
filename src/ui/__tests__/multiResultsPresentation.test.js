import { describe, expect, it } from "vitest";
import { isQueueRunInProgress } from "../multiResultsPresentation.js";

describe("multiResultsPresentation", () => {
    it("treats active queue runs as running", () => {
        expect(isQueueRunInProgress({
            isRunning: true,
            lastRunStatus: "running",
        })).toBe(true);
    });

    it("does not treat baseline runs as queue runs", () => {
        expect(isQueueRunInProgress({
            isRunning: true,
            lastRunStatus: "idle",
        })).toBe(false);
    });

    it("does not treat finished queue runs as running", () => {
        expect(isQueueRunInProgress({
            isRunning: false,
            lastRunStatus: "completed",
        })).toBe(false);
    });
});

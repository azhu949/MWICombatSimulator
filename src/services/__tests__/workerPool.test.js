import { describe, expect, it, vi } from "vitest";
import { runParallelWorkerPool } from "../workerPool.js";

describe("runParallelWorkerPool", () => {
    it("runs every task exactly once with parallel workers", async () => {
        const ran = [];
        await runParallelWorkerPool({
            taskCount: 10,
            workerLimit: 3,
            runTask: async (index) => {
                ran.push(index);
            },
        });

        expect(ran).toHaveLength(10);
        expect([...ran].sort((left, right) => left - right)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it("runs tasks concurrently up to the worker limit", async () => {
        let active = 0;
        let maxActive = 0;
        await runParallelWorkerPool({
            taskCount: 6,
            workerLimit: 3,
            runTask: async () => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                await new Promise((resolve) => {
                    setTimeout(resolve, 10);
                });
                active -= 1;
            },
        });

        expect(maxActive).toBe(3);
    });

    it("clamps the worker count to the task count", async () => {
        let active = 0;
        let maxActive = 0;
        await runParallelWorkerPool({
            taskCount: 2,
            workerLimit: 8,
            runTask: async () => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                await new Promise((resolve) => {
                    setTimeout(resolve, 10);
                });
                active -= 1;
            },
        });

        expect(maxActive).toBe(2);
    });

    it("does not clamp the worker count when clampWorkerCount is false", async () => {
        const ran = [];
        await runParallelWorkerPool({
            taskCount: 2,
            workerLimit: 8,
            clampWorkerCount: false,
            runTask: async (index) => {
                ran.push(index);
            },
        });

        expect(ran).toHaveLength(2);
        expect([...ran].sort((left, right) => left - right)).toEqual([0, 1]);
    });

    it("calls ensureActive immediately before each task is reserved", async () => {
        const events = [];
        await runParallelWorkerPool({
            taskCount: 4,
            workerLimit: 2,
            ensureActive: () => {
                events.push("ensure");
            },
            runTask: async (index) => {
                events.push(`task-${index}`);
            },
        });

        expect(events).toHaveLength(8);
        for (let index = 0; index < 4; index += 1) {
            const taskPosition = events.indexOf(`task-${index}`);
            expect(events[taskPosition - 1]).toBe("ensure");
        }
    });

    it("aborts the pool when ensureActive throws", async () => {
        const ensureActive = vi.fn(() => {
            throw new Error("cancelled");
        });
        const runTask = vi.fn();

        await expect(runParallelWorkerPool({
            taskCount: 4,
            workerLimit: 2,
            ensureActive,
            runTask,
        })).rejects.toThrow("cancelled");
        expect(runTask).not.toHaveBeenCalled();
    });

    it("rejects with the first task failure", async () => {
        const boom = new Error("boom");
        await expect(runParallelWorkerPool({
            taskCount: 4,
            workerLimit: 2,
            runTask: async (index) => {
                if (index === 1) {
                    throw boom;
                }
            },
        })).rejects.toThrow("boom");
    });

    it("resolves immediately for an empty task range", async () => {
        const runTask = vi.fn();
        await runParallelWorkerPool({
            taskCount: 0,
            workerLimit: 3,
            runTask,
        });

        expect(runTask).not.toHaveBeenCalled();
    });
});

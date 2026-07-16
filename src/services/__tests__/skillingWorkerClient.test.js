import { beforeEach, describe, expect, it, vi } from "vitest";
import { SKILLING_OPTIMIZATION_MODE_BALANCED } from "../skillingPlanner.js";
import { SkillingWorkerClient } from "../skillingWorkerClient.js";

class FakeWorker {
    static instances = [];

    constructor(url, options) {
        this.url = url;
        this.options = options;
        this.postMessage = vi.fn();
        this.terminate = vi.fn();
        this.onmessage = null;
        this.onerror = null;
        FakeWorker.instances.push(this);
    }

    emit(data) {
        this.onmessage?.({ data });
    }
}

describe("SkillingWorkerClient", () => {
    beforeEach(() => {
        FakeWorker.instances = [];
        global.Worker = FakeWorker;
    });

    it("routes only active-run progress and results", () => {
        const client = new SkillingWorkerClient();
        const onProgress = vi.fn();
        const onResult = vi.fn();
        client.start({
            runId: "active",
            optimizationMode: SKILLING_OPTIMIZATION_MODE_BALANCED,
            balancedCostTolerance: 0.2,
        }, { onProgress, onResult });
        const worker = FakeWorker.instances[0];

        expect(worker.postMessage).toHaveBeenCalledWith({
            type: "skilling_run",
            runId: "active",
            optimizationMode: SKILLING_OPTIMIZATION_MODE_BALANCED,
            balancedCostTolerance: 0.2,
        });

        worker.emit({ type: "skilling_progress", runId: "stale", overallProgress: 0.5 });
        worker.emit({ type: "skilling_progress", runId: "active", overallProgress: 0.5 });
        const result = {
            optimizationMode: SKILLING_OPTIMIZATION_MODE_BALANCED,
            overview: [{ skillHrid: "/skills/cooking" }],
        };
        worker.emit({ type: "skilling_result", runId: "active", result });

        expect(onProgress).toHaveBeenCalledOnce();
        expect(onResult).toHaveBeenCalledWith(result);
        expect(worker.terminate).toHaveBeenCalledOnce();
    });

    it("posts cancellation and ignores queued messages after termination", () => {
        const client = new SkillingWorkerClient();
        const onResult = vi.fn();
        client.start({ runId: "cancelled" }, { onResult });
        const worker = FakeWorker.instances[0];

        client.cancel();
        worker.emit({ type: "skilling_result", runId: "cancelled", result: {} });

        expect(worker.postMessage).toHaveBeenLastCalledWith({ type: "skilling_cancel", runId: "cancelled" });
        expect(onResult).not.toHaveBeenCalled();
        expect(worker.terminate).toHaveBeenCalledOnce();
    });
});

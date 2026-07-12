import { beforeEach, describe, expect, it, vi } from "vitest";
import { EnhancementWorkerClient } from "../enhancementWorkerClient.js";

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

describe("EnhancementWorkerClient", () => {
    beforeEach(() => {
        FakeWorker.instances = [];
        global.Worker = FakeWorker;
    });

    it("routes only messages belonging to the active run", () => {
        const client = new EnhancementWorkerClient();
        const onProgress = vi.fn();
        const onResult = vi.fn();
        client.start({ runId: "active", strategy: {} }, { onProgress, onResult });
        const worker = FakeWorker.instances[0];

        worker.emit({ type: "enhancement_progress", runId: "stale", progress: 0.5 });
        worker.emit({ type: "enhancement_result", runId: "stale", result: { mean: 1 } });
        worker.emit({ type: "enhancement_progress", runId: "active", progress: 0.75 });
        worker.emit({ type: "enhancement_result", runId: "active", result: { mean: 2 } });

        expect(onProgress).toHaveBeenCalledTimes(1);
        expect(onResult).toHaveBeenCalledWith({ mean: 2 });
        expect(worker.terminate).toHaveBeenCalledTimes(1);
    });

    it("sends cancellation and ignores results queued after the request", () => {
        const client = new EnhancementWorkerClient();
        const onProgress = vi.fn();
        const onResult = vi.fn();
        const onCancelled = vi.fn();
        client.start({ runId: "cancelled" }, { onProgress, onResult, onCancelled });
        const worker = FakeWorker.instances[0];

        client.cancel();
        worker.emit({ type: "enhancement_progress", runId: "cancelled", progress: 1 });
        worker.emit({ type: "enhancement_result", runId: "cancelled", result: { mean: 2 } });
        worker.emit({ type: "enhancement_cancelled", runId: "cancelled", reason: "requested" });

        expect(worker.postMessage).toHaveBeenLastCalledWith({
            type: "enhancement_cancel",
            runId: "cancelled",
        });
        expect(onProgress).not.toHaveBeenCalled();
        expect(onResult).not.toHaveBeenCalled();
        expect(onCancelled).toHaveBeenCalledWith(expect.objectContaining({ runId: "cancelled" }));
        expect(worker.terminate).toHaveBeenCalledTimes(1);
    });
});

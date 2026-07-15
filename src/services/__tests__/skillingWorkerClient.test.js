import { beforeEach, describe, expect, it, vi } from "vitest";
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
        client.start({ runId: "active" }, { onProgress, onResult });
        const worker = FakeWorker.instances[0];

        worker.emit({ type: "skilling_progress", runId: "stale", overallProgress: 0.5 });
        worker.emit({ type: "skilling_progress", runId: "active", overallProgress: 0.5 });
        worker.emit({ type: "skilling_result", runId: "active", result: { overview: [] } });

        expect(onProgress).toHaveBeenCalledOnce();
        expect(onResult).toHaveBeenCalledWith({ overview: [] });
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

export class SkillingWorkerClient {
    constructor() {
        this.worker = null;
        this.activeRunId = "";
    }

    start(payload, handlers = {}) {
        this.stop();
        const runId = String(payload?.runId || "");
        this.activeRunId = runId;
        this.worker = new Worker(new URL("../skillingWorker.js", import.meta.url), { type: "module" });
        this.worker.onmessage = (event) => {
            const data = event.data || {};
            if (String(data.runId || "") !== this.activeRunId) return;
            if (data.type === "skilling_progress") handlers.onProgress?.(data);
            else if (data.type === "skilling_result") {
                handlers.onResult?.(data.result);
                this.stop(runId);
            } else if (data.type === "skilling_cancelled") {
                handlers.onCancelled?.(data);
                this.stop(runId);
            } else if (data.type === "skilling_error") {
                handlers.onError?.(data.error || "Skilling calculation failed.");
                this.stop(runId);
            }
        };
        this.worker.onerror = (error) => {
            if (runId !== this.activeRunId) return;
            handlers.onError?.(error?.message || String(error));
            this.stop(runId);
        };
        this.worker.postMessage({ type: "skilling_run", ...payload, runId });
    }

    cancel() {
        if (!this.worker || !this.activeRunId) return false;
        const runId = this.activeRunId;
        this.worker.postMessage({ type: "skilling_cancel", runId });
        this.stop(runId);
        return true;
    }

    stop(expectedRunId = "") {
        if (expectedRunId && expectedRunId !== this.activeRunId) return;
        this.worker?.terminate();
        this.worker = null;
        this.activeRunId = "";
    }
}

export default new SkillingWorkerClient();

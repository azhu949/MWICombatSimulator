export class EnhancementWorkerClient {
    constructor() {
        this.worker = null;
        this.activeRunId = "";
        this.cancelRequestedRunId = "";
    }

    start(payload, handlers = {}) {
        this.stop();

        const runId = String(payload?.runId || "");
        this.activeRunId = runId;
        this.worker = new Worker(new URL("../enhancementWorker.js", import.meta.url), { type: "module" });

        this.worker.onmessage = (event) => {
            const data = event.data ?? {};
            if (String(data.runId || "") !== this.activeRunId) {
                return;
            }
            if (this.cancelRequestedRunId === this.activeRunId
                && data.type !== "enhancement_cancelled") {
                return;
            }

            switch (data.type) {
                case "enhancement_progress":
                    handlers.onProgress?.(data);
                    break;
                case "enhancement_result":
                    handlers.onResult?.(data.result);
                    this.stop(runId);
                    break;
                case "enhancement_cancelled":
                    handlers.onCancelled?.(data);
                    this.stop(runId);
                    break;
                case "enhancement_workload_exceeded":
                    handlers.onWorkloadExceeded?.(data);
                    this.stop(runId);
                    break;
                case "enhancement_error":
                    handlers.onError?.(data.error || "Enhancement simulation failed.");
                    this.stop(runId);
                    break;
                default:
                    break;
            }
        };

        this.worker.onerror = (error) => {
            if (runId !== this.activeRunId) {
                return;
            }
            if (this.cancelRequestedRunId === runId) {
                this.stop(runId);
                return;
            }
            handlers.onError?.(error?.message || String(error));
            this.stop(runId);
        };

        this.worker.postMessage({
            type: "enhancement_run",
            ...payload,
            runId,
        });
    }

    cancel() {
        if (!this.worker || !this.activeRunId) {
            return;
        }

        this.worker.postMessage({
            type: "enhancement_cancel",
            runId: this.activeRunId,
        });
        this.cancelRequestedRunId = this.activeRunId;
    }

    stop(expectedRunId = "") {
        if (expectedRunId && expectedRunId !== this.activeRunId) {
            return;
        }
        if (this.worker) {
            this.worker.terminate();
        }
        this.worker = null;
        this.activeRunId = "";
        this.cancelRequestedRunId = "";
    }
}

export default new EnhancementWorkerClient();

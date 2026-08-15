import sharedWorkerClient, { WorkerClient } from "./workerClient.js";

export const DEDICATED_WORKER_SCOPE_QUEUE = "queue";
export const DEDICATED_WORKER_SCOPE_ADVISOR = "advisor";

const dedicatedWorkerRuns = new Set();
let sharedWorkerRunHandle = null;

export function createWorkerRunCancellationError(message = "Simulation cancelled.") {
    const error = new Error(message);
    error.code = "cancelled";
    return error;
}

export function isWorkerRunCancelledError(error) {
    return Boolean(error?.code === "cancelled");
}

function registerDedicatedWorkerRun(workerRunHandle) {
    if (workerRunHandle) {
        dedicatedWorkerRuns.add(workerRunHandle);
    }
}

function unregisterDedicatedWorkerRun(workerRunHandle) {
    if (workerRunHandle) {
        dedicatedWorkerRuns.delete(workerRunHandle);
    }
}

export function cancelDedicatedWorkerRuns(predicate = () => true, cancellationError = createWorkerRunCancellationError()) {
    for (const workerRunHandle of Array.from(dedicatedWorkerRuns)) {
        if (!predicate(workerRunHandle)) {
            continue;
        }
        try {
            workerRunHandle.cancel(cancellationError);
        } catch (error) {
            // ignore cancel errors while cleaning dedicated workers
        }
    }
}

export function stopQueueWorkerClients() {
    cancelDedicatedWorkerRuns((workerRunHandle) => workerRunHandle.scope === DEDICATED_WORKER_SCOPE_QUEUE);
}

export function stopAdvisorWorkerRuns() {
    cancelDedicatedWorkerRuns((workerRunHandle) => workerRunHandle.scope === DEDICATED_WORKER_SCOPE_ADVISOR);
}

function unregisterSharedWorkerRun(workerRunHandle) {
    if (sharedWorkerRunHandle === workerRunHandle) {
        sharedWorkerRunHandle = null;
    }
}

export function cancelSharedWorkerRun(cancellationError = createWorkerRunCancellationError()) {
    if (!sharedWorkerRunHandle) {
        return;
    }

    try {
        sharedWorkerRunHandle.cancel(cancellationError);
    } catch (error) {
        // ignore cancel errors while cleaning shared workers
    }
}

export function runSingleSimulationPayloadWithDedicatedWorker(payload, onProgress = () => {}, options = {}) {
    const ClientCtor = typeof options?.WorkerClientCtor === "function" ? options.WorkerClientCtor : WorkerClient;
    return new Promise((resolve, reject) => {
        const dedicatedClient = new ClientCtor();
        const scope = String(options?.scope || DEDICATED_WORKER_SCOPE_QUEUE);
        let settled = false;
        let workerRunHandle = null;

        const settle = (callback, value) => {
            if (settled) {
                return;
            }

            settled = true;

            try {
                dedicatedClient.stopSimulation();
            } catch (error) {
                // ignore stop errors while settling dedicated workers
            }

            unregisterDedicatedWorkerRun(workerRunHandle);
            callback(value);
        };

        workerRunHandle = {
            scope,
            cancel: (error = createWorkerRunCancellationError()) => {
                settle(reject, error);
            },
        };
        registerDedicatedWorkerRun(workerRunHandle);

        try {
            dedicatedClient.startSimulation(payload, {
                onProgress: (data) => {
                    if (settled) {
                        return;
                    }
                    try {
                        onProgress(data);
                    } catch (error) {
                        settle(reject, error);
                    }
                },
                onResult: (simResult) => {
                    settle(resolve, simResult);
                },
                onError: (error) => {
                    settle(reject, error);
                },
            });
        } catch (error) {
            settle(reject, error);
        }
    });
}

export function runMultiSimulationPayloadWithDedicatedWorker(payload, onProgress = () => {}, options = {}) {
    const ClientCtor = typeof options?.WorkerClientCtor === "function" ? options.WorkerClientCtor : WorkerClient;
    return new Promise((resolve, reject) => {
        const dedicatedClient = new ClientCtor();
        const scope = String(options?.scope || DEDICATED_WORKER_SCOPE_QUEUE);
        const onItemResult = typeof options?.onItemResult === "function" ? options.onItemResult : () => {};
        let settled = false;
        let workerRunHandle = null;

        const settle = (callback, value) => {
            if (settled) {
                return;
            }

            settled = true;

            try {
                dedicatedClient.stopSimulation();
            } catch (error) {
                // ignore stop errors while settling dedicated workers
            }

            unregisterDedicatedWorkerRun(workerRunHandle);
            callback(value);
        };

        workerRunHandle = {
            scope,
            cancel: (error = createWorkerRunCancellationError()) => {
                settle(reject, error);
            },
        };
        registerDedicatedWorkerRun(workerRunHandle);

        try {
            dedicatedClient.startMultiSimulation(payload, {
                onProgress: (data) => {
                    if (settled) {
                        return;
                    }
                    try {
                        onProgress(data);
                    } catch (error) {
                        settle(reject, error);
                    }
                },
                onItemResult: (data) => {
                    if (settled) {
                        return;
                    }
                    try {
                        onItemResult(data);
                    } catch (error) {
                        settle(reject, error);
                    }
                },
                onBatchResult: (simResults, batchResultType) => {
                    settle(resolve, {
                        simResults: Array.isArray(simResults) ? simResults : [],
                        batchResultType: String(batchResultType || ""),
                    });
                },
                onError: (error) => {
                    settle(reject, error);
                },
            });
        } catch (error) {
            settle(reject, error);
        }
    });
}

export function runSharedSingleSimulationPayload(payload, onProgress = () => {}, options = {}) {
    const workerClient = options?.workerClient || sharedWorkerClient;
    return new Promise((resolve, reject) => {
        let settled = false;
        let workerRunHandle = null;

        const settle = (callback, value, stopWorker = false) => {
            if (settled) {
                return;
            }

            settled = true;

            if (stopWorker) {
                try {
                    workerClient.stopSimulation();
                } catch (error) {
                    // ignore stop errors while settling shared workers
                }
            }

            unregisterSharedWorkerRun(workerRunHandle);
            callback(value);
        };

        workerRunHandle = {
            cancel: (error = createWorkerRunCancellationError()) => {
                settle(reject, error, true);
            },
        };
        sharedWorkerRunHandle = workerRunHandle;

        try {
            workerClient.startSimulation(payload, {
                onProgress: (data) => {
                    if (settled) {
                        return;
                    }
                    try {
                        onProgress(data);
                    } catch (error) {
                        settle(reject, error, true);
                    }
                },
                onResult: (simResult) => {
                    settle(resolve, simResult);
                },
                onError: (error) => {
                    settle(reject, error);
                },
            });
        } catch (error) {
            settle(reject, error, true);
        }
    });
}

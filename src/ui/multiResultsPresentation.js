export function isQueueRunInProgress(queueState) {
    return Boolean(queueState?.isRunning) && String(queueState?.lastRunStatus || "") === "running";
}

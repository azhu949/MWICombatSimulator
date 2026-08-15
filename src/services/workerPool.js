/**
 * Runs a fixed number of concurrent workers over a shared next-index counter.
 * Each task is picked up by exactly one worker; the next task index is always
 * reserved before the previous task settles, so tasks never overlap.
 *
 * Error semantics match a plain Promise.all: the first task failure rejects
 * the whole pool, remaining in-flight tasks are not force-cancelled.
 *
 * @param {Object} options
 * @param {number} options.taskCount  Total number of tasks (indexed 0..taskCount-1).
 * @param {number} options.workerLimit Desired concurrent worker count.
 * @param {(index: number) => Promise<any>} options.runTask Task body for one index.
 * @param {() => void} [options.ensureActive] Optional guard called before each task
 *        is reserved (e.g. cancellation checks). Throwing aborts the pool.
 * @param {boolean} [options.clampWorkerCount=true] When true the worker count is
 *        clamped to taskCount; when false the requested limit is spawned as-is
 *        (extra workers exit immediately without touching any task).
 * @returns {Promise<void>}
 */
export async function runParallelWorkerPool({
    taskCount,
    workerLimit,
    runTask,
    ensureActive,
    clampWorkerCount = true,
}) {
    const limit = Math.max(1, Number(workerLimit) || 1);
    const workerCount = clampWorkerCount ? Math.min(limit, taskCount) : limit;
    let nextIndex = 0;

    const workerLoop = async () => {
        while (nextIndex < taskCount) {
            ensureActive?.();
            const currentIndex = nextIndex;
            nextIndex += 1;
            // eslint-disable-next-line no-await-in-loop
            await runTask(currentIndex);
        }
    };

    await Promise.all(Array.from({ length: workerCount }, () => workerLoop()));
}

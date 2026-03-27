export function emitAggregateProgress(workerScope, progressState) {
    const values = Object.values(progressState);
    const totalProgress = values.length > 0
        ? values.reduce((acc, progress) => acc + progress, 0) / values.length
        : 0;
    workerScope.postMessage({ type: "simulation_progress", progress: totalProgress });
}

function normalizeWorkerError(error) {
    return error?.message || String(error);
}

function terminateChildWorker(worker) {
    try {
        worker?.terminate?.();
    } catch (error) {
        // ignore worker termination errors while cleaning child workers
    }
}

function getHardwareWorkerLimit() {
    const rawLimit = Number(globalThis?.navigator?.hardwareConcurrency || 1);
    if (!Number.isFinite(rawLimit) || rawLimit <= 0) {
        return 1;
    }
    return Math.max(1, Math.floor(rawLimit));
}

function buildMultiSimulationConfig(eventData = {}) {
    if (eventData?.type === "start_simulation_all_zones") {
        return {
            resultType: "simulation_result_allZones",
            targets: Array.isArray(eventData.zones) ? eventData.zones : [],
            buildProgressKey: (zone) => `${zone.zoneHrid}#${zone.difficultyTier}`,
            buildWorkerMessage: (zone) => ({
                type: "start_simulation",
                players: eventData.players,
                zone,
                extra: eventData.extra,
                simulationTimeLimit: eventData.simulationTimeLimit,
            }),
            buildItemResult: (zone, index, simResult) => ({
                type: "simulation_item_result",
                index,
                zone,
                zoneHrid: zone.zoneHrid,
                difficultyTier: zone.difficultyTier,
                simResult,
            }),
        };
    }

    if (eventData?.type === "start_simulation_all_labyrinths") {
        return {
            resultType: "simulation_result_allLabyrinths",
            targets: Array.isArray(eventData.labyrinths) ? eventData.labyrinths : [],
            buildProgressKey: (labyrinth) => `${labyrinth.labyrinthHrid}#${labyrinth.roomLevel}`,
            buildWorkerMessage: (labyrinth) => ({
                type: "start_simulation",
                players: eventData.players,
                labyrinth,
                extra: eventData.extra,
                simulationTimeLimit: eventData.simulationTimeLimit,
            }),
            buildItemResult: (labyrinth, index, simResult) => ({
                type: "simulation_item_result",
                index,
                labyrinth,
                labyrinthHrid: labyrinth.labyrinthHrid,
                roomLevel: labyrinth.roomLevel,
                simResult,
            }),
        };
    }

    return null;
}

export async function handleMultiSimulationMessage(eventData = {}, workerScope = globalThis) {
    const config = buildMultiSimulationConfig(eventData);
    if (!config) {
        return;
    }

    const progressState = Object.fromEntries(
        config.targets.map((target) => [config.buildProgressKey(target), 0])
    );
    const taskQueue = config.targets.map((target, index) => ({ index, target }));
    const results = new Array(config.targets.length);
    const activeTaskControls = new Set();
    let aborted = false;

    const closeWorkerScope = () => {
        try {
            workerScope?.close?.();
        } catch (error) {
            // ignore worker close errors while finishing one-shot multi workers
        }
    };

    const cancelActiveTasks = (error) => {
        for (const taskControl of Array.from(activeTaskControls)) {
            try {
                taskControl.cancel(error);
            } catch (cancelError) {
                // ignore task cancellation errors while cleaning active task controls
            }
        }
    };

    const runTask = async ({ index, target }) => {
        const progressKey = config.buildProgressKey(target);
        const simulationWorker = new Worker(new URL("worker.js", import.meta.url), { type: "module" });
        let taskControl = null;

        try {
            const simResult = await new Promise((resolve, reject) => {
                let settled = false;
                const settle = (callback, value) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    activeTaskControls.delete(taskControl);
                    terminateChildWorker(simulationWorker);
                    callback(value);
                };

                taskControl = {
                    cancel: (error) => {
                        settle(reject, error);
                    },
                };
                activeTaskControls.add(taskControl);

                simulationWorker.onmessage = (workerEvent) => {
                    if (aborted || settled) {
                        return;
                    }

                    const data = workerEvent.data ?? {};
                    if (data.type === "simulation_result") {
                        progressState[progressKey] = 1;
                        emitAggregateProgress(workerScope, progressState);
                        workerScope.postMessage(config.buildItemResult(target, index, data.simResult));
                        settle(resolve, data.simResult);
                        return;
                    }

                    if (data.type === "simulation_progress") {
                        progressState[progressKey] = Number(data.progress || 0);
                        emitAggregateProgress(workerScope, progressState);
                        return;
                    }

                    if (data.type === "simulation_error") {
                        settle(reject, data.error);
                    }
                };

                simulationWorker.onerror = (error) => {
                    settle(reject, normalizeWorkerError(error));
                };

                try {
                    simulationWorker.postMessage(config.buildWorkerMessage(target));
                } catch (error) {
                    settle(reject, error);
                }
            });

            results[index] = simResult;
        } catch (error) {
            aborted = true;
            cancelActiveTasks(error);
            throw error;
        }
    };

    const processTaskQueue = async () => {
        while (!aborted && taskQueue.length > 0) {
            const nextTask = taskQueue.shift();
            if (!nextTask) {
                return;
            }
            // eslint-disable-next-line no-await-in-loop
            await runTask(nextTask);
        }
    };

    try {
        const maxWorkers = Math.min(getHardwareWorkerLimit(), config.targets.length);
        const workers = Array.from({ length: maxWorkers }, () => processTaskQueue());
        await Promise.all(workers);
        if (!aborted) {
            workerScope.postMessage({ type: config.resultType, simResults: results });
        }
    } catch (error) {
        cancelActiveTasks(error);
        workerScope.postMessage({ type: "simulation_error", error });
    } finally {
        closeWorkerScope();
    }
}

const workerScope = globalThis;
if (workerScope && typeof workerScope.postMessage === "function") {
    workerScope.onmessage = async function (event) {
        await handleMultiSimulationMessage(event.data, workerScope);
    };
}

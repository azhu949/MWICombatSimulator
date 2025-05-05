
onmessage = async function (event) {
    switch (event.data.type) {
        case "start_simulation_all_zones":
            // get now time
            const now = new Date();
            const zoneHrids = event.data.zones;
            let zoneProgress = {};

            try {
                const simulatorWorkerPool = []
                for (let i = 0; i < zoneHrids.length; i++) {
                    const simulationWorker = new Worker(new URL('worker.js', import.meta.url));
                    simulatorWorkerPool.push(simulationWorker);
                    // Do simulation
                    let workerMessage = {
                        type: "start_simulation",
                        players: event.data.players,
                        zoneHrid: zoneHrids[i],
                        simulationTimeLimit: event.data.simulationTimeLimit,
                    };
                    simulationWorker.postMessage(workerMessage);
                }

                const outer_worker = this;
                // Wait for all simulations to finish
                const simulationResults = await Promise.all(simulatorWorkerPool.map(worker => {
                    return new Promise((resolve, reject) => {
                        worker.onmessage = function (event) {
                            if (event.data.type === "simulation_result") {
                                resolve(event.data.simResult);
                            } else if (event.data.type === "simulation_progress") {
                                zoneProgress[event.data.zone] = event.data.progress;
                                let totalProgress = Object.values(zoneProgress).reduce((acc, progress) => acc + progress, 0) / Object.keys(zoneProgress).length;
                                outer_worker.postMessage({ type: "simulation_progress", progress: totalProgress });
                            } else if (event.data.type === "simulation_error") {
                                reject(event.data.error);
                            }
                        };
                    });
                }));

                // Terminate all workers
                for (let i = 0; i < simulatorWorkerPool.length; i++) {
                    simulatorWorkerPool[i].terminate();
                }

                this.postMessage({ type: "simulation_result_allZones", simResults: simulationResults });
            } catch (e) {
                console.log(e);
                this.postMessage({ type: "simulation_error", error: e });
            }
            break;
    }
};

onmessage = async function (event) {
    switch (event.data.type) {
        case "start_simulation_all_zones":
            const zoneHrids = event.data.zones;
            let zoneProgress = Object.fromEntries(zoneHrids.map(zone => [zone.zoneHrid+'#'+zone.difficultyTier, 0]));

            try {
                const maxWorkers = navigator.hardwareConcurrency;
                console.log("maxWorkers: " + maxWorkers);

                const taskQueue = [...zoneHrids];
                const results = new Array(zoneHrids.length);
                const outer_worker = this;

                // 创建工作线程池
                const processTask = async (workerId) => {
                    while (taskQueue.length > 0) {
                        const zoneIndex = zoneHrids.length - taskQueue.length;
                        const currentZone = taskQueue.shift();

                        const simulationWorker = new Worker(new URL('worker.js', import.meta.url));

                        // Do simulation
                        let workerMessage = {
                            type: "start_simulation",
                            players: event.data.players,
                            zone: currentZone,
                            extra: event.data.extra,
                            simulationTimeLimit: event.data.simulationTimeLimit,
                        };
                        simulationWorker.postMessage(workerMessage);
                        
                        const result = await new Promise((resolve, reject) => {
                            simulationWorker.onmessage = function (event) {
                                if (event.data.type === "simulation_result") {
                                    zoneProgress[event.data.zone+'#'+event.data.difficultyTier] = 1.0;
                                    resolve(event.data.simResult);
                                } else if (event.data.type === "simulation_progress") {
                                    zoneProgress[event.data.zone+'#'+event.data.difficultyTier] = event.data.progress;
                                    let totalProgress = Object.values(zoneProgress).reduce((acc, progress) => acc + progress, 0) / Object.keys(zoneProgress).length;
                                    outer_worker.postMessage({ type: "simulation_progress", progress: totalProgress });
                                } else if (event.data.type === "simulation_error") {
                                    reject(event.data.error);
                                }
                            };
                        });

                        results[zoneIndex] = result;
                        simulationWorker.terminate();
                    }
                };

                // 启动工作线程
                const workers = Array(Math.min(maxWorkers, zoneHrids.length))
                    .fill()
                    .map((_, index) => processTask(index));

                // 等待所有任务完成
                await Promise.all(workers);

                this.postMessage({ type: "simulation_result_allZones", simResults: results });
            } catch (e) {
                console.log(e);
                this.postMessage({ type: "simulation_error", error: e });
            }
            break;
        case "start_simulation_all_labyrinths":
            const labyrinthHrids = event.data.labyrinths;
            let labyrinthProgress = Object.fromEntries(labyrinthHrids.map(labyrinth => [labyrinth.labyrinthHrid+'#'+labyrinth.roomLevel, 0]));
            
            try {
                const maxWorkers = navigator.hardwareConcurrency;
                console.log("maxWorkers: " + maxWorkers);

                const taskQueue = [...labyrinthHrids];
                const results = new Array(labyrinthHrids.length);
                const outer_worker = this;

                // 创建工作线程池
                const processTask = async (workerId) => {
                    while (taskQueue.length > 0) {
                        const labyrinthIndex = labyrinthHrids.length - taskQueue.length;
                        const currentLabyrinth = taskQueue.shift();

                        const simulationWorker = new Worker(new URL('worker.js', import.meta.url));

                        // Do simulation
                        let workerMessage = {
                            type: "start_simulation",
                            players: event.data.players,
                            labyrinth: currentLabyrinth,
                            extra: event.data.extra,
                            simulationTimeLimit: event.data.simulationTimeLimit,
                        };
                        simulationWorker.postMessage(workerMessage);
                        
                        const result = await new Promise((resolve, reject) => {
                            simulationWorker.onmessage = function (event) {
                                if (event.data.type === "simulation_result") {
                                    labyrinthProgress[currentLabyrinth.labyrinthHrid+'#'+currentLabyrinth.roomLevel] = 1.0;
                                    resolve(event.data.simResult);
                                } else if (event.data.type === "simulation_progress") {
                                    labyrinthProgress[currentLabyrinth.labyrinthHrid+'#'+currentLabyrinth.roomLevel] = event.data.progress;
                                    let totalProgress = Object.values(labyrinthProgress).reduce((acc, progress) => acc + progress, 0) / Object.keys(labyrinthProgress).length;
                                    outer_worker.postMessage({ type: "simulation_progress", progress: totalProgress });
                                } else if (event.data.type === "simulation_error") {
                                    reject(event.data.error);
                                }
                            };
                        });

                        results[labyrinthIndex] = result;
                        simulationWorker.terminate();
                    }
                };

                // 启动工作线程
                const workers = Array(Math.min(maxWorkers, labyrinthHrids.length))
                    .fill()
                    .map((_, index) => processTask(index));

                // 等待所有任务完成
                await Promise.all(workers);

                this.postMessage({ type: "simulation_result_allLabyrinths", simResults: results });
            } catch (e) {
                console.log(e);
                this.postMessage({ type: "simulation_error", error: e });
            }   
            break;
    }
};
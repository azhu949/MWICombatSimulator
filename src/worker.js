import CombatSimulator from "./combatsimulator/combatSimulator";
import Player from "./combatsimulator/player";
import Zone from "./combatsimulator/zone";

const THREAD_LIMIT = 10; // TODO: Configurable thread limit

class SimulationManager {
    constructor() {
        this.simulations = [];
        this.simResults;
    }

    addSimulation(sim) {
        this.simulations.push(sim);
    }

    async startSimulations(simulationTimeLimit) {
        const simulationPromises = this.simulations.map(simulation => simulation.simulate(simulationTimeLimit));
        const results = await Promise.all(simulationPromises);
        return results;
    }
}

onmessage = async function (event) {
    switch (event.data.type) {
        case "start_simulation":
            let playersData = event.data.players;
            let players = [];
            let zone = new Zone(event.data.zoneHrid);
            for (let i = 0; i < playersData.length; i++) {
                let currentPlayer = Player.createFromDTO(structuredClone(playersData[i]));
                currentPlayer.zoneBuffs = zone.buffs;
                players.push(currentPlayer);
            }
            let simulationTimeLimit = event.data.simulationTimeLimit;
            let combatSimulator = new CombatSimulator(players, zone);
            combatSimulator.addEventListener("progress", (event) => {
                this.postMessage({ type: "simulation_progress", progress: event.detail });
            });

            try {
                let simResult = await combatSimulator.simulate(simulationTimeLimit);
                this.postMessage({ type: "simulation_result", simResult: simResult });
            } catch (e) {
                console.log(e);
                this.postMessage({ type: "simulation_error", error: e });
            }
            break;
        case "start_simulation_all_zones":
            // get now time
            const now = new Date();
            const zoneHrids = event.data.zones;
            let zoneProgress = {};

            try {
                const simulatorWorkerPool = []
                for (let i = 0; i < zoneHrids.length; i++) {
                    const zoneInstance = new Zone(zoneHrids[i]);
                    if (zoneInstance.monsterSpawnInfo.randomSpawnInfo.spawns) {
                        // Create threads for all-simulation senario
                        const simulationWorker = new Worker(new URL('combatsimulator/combatSimulator.js', import.meta.url));
                        simulatorWorkerPool.push(simulationWorker);
                        // Do simulation
                        simulationWorker.postMessage({
                            type: "start_simulation",
                            players: event.data.players,
                            zone: zoneHrids[i],
                            simulationTimeLimit: event.data.simulationTimeLimit,
                        });
                    }
                }

                const outer_worker = this;
                // Wait for all simulations to finish
                const simulationResults = await Promise.all(simulatorWorkerPool.map(worker => {
                    return new Promise((resolve, reject) => {
                        worker.onmessage = function (event) {
                            if (event.data.type === "simulation_result") {
                                resolve(event.data.simResult);
                            } else if (event.data.type === "simulation_progress"){
                                zoneProgress[event.data.zone] = event.data.progress;
                                let totalProgress = Object.values(zoneProgress).reduce((acc, progress) => acc + progress, 0) / Object.keys(zoneProgress).length;
                                outer_worker.postMessage({ type: "simulation_progress", progress: totalProgress });
                            }else if (event.data.type === "simulation_error") {
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

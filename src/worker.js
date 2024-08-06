import CombatSimulator from "./combatsimulator/combatSimulator";
import Player from "./combatsimulator/player";
import Zone from "./combatsimulator/zone";

var player;

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
            player = Player.createFromDTO(event.data.player);
            let zone = new Zone(event.data.zoneHrid);
            player.zoneBuffs = zone.buffs;
            let simulationTimeLimit = event.data.simulationTimeLimit;

            let combatSimulator = new CombatSimulator(player, zone);
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
            const simManager = new SimulationManager();
            const zoneHrids = event.data.zones;
            for (let i = 0; i < zoneHrids.length; i++) {
                const zoneInstance = new Zone(zoneHrids[i]);
                if (zoneInstance.monsterSpawnInfo.randomSpawnInfo.spawns) {
                    const clonedPlayerDTO = structuredClone(event.data.player);
                    var newPlayer = Player.createFromDTO(clonedPlayerDTO);
                    newPlayer.zoneBuffs = zoneInstance.buffs;
                    let simulation = new CombatSimulator(newPlayer, zoneInstance);
                    if(i == 0) {
                        simulation.addEventListener("progress", (event) => {
                            this.postMessage({ type: "simulation_progress", progress: event.detail });
                        });
                    }
                    simManager.addSimulation(simulation);
                }
            }
            try {
                const simResults = await simManager.startSimulations(event.data.simulationTimeLimit);
                    this.postMessage({ type: "simulation_result_allZones", simResults: simResults });
                } catch (e) {
                    console.log(e);
                    this.postMessage({ type: "simulation_error", error: e });
                }
            break;
    }
};

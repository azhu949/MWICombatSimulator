/**
 * @typedef {Object} SingleSimulationWorkerPayload
 * @property {"start_simulation"} type
 * @property {string} workerId
 * @property {Array<any>} players
 * @property {{ zoneHrid: string, difficultyTier: number } | null} zone
 * @property {{ labyrinthHrid: string, roomLevel: number, crates: string[] } | null} labyrinth
 * @property {number} simulationTimeLimit
 * @property {{ mooPass: boolean, comExp: number, comDrop: number, enableHpMpVisualization: boolean }} extra
 */

/**
 * @typedef {Object} MultiZoneSimulationWorkerPayload
 * @property {"start_simulation_all_zones"} type
 * @property {Array<any>} players
 * @property {Array<{ zoneHrid: string, difficultyTier: number }>} zones
 * @property {number} simulationTimeLimit
 * @property {{ mooPass: boolean, comExp: number, comDrop: number, enableHpMpVisualization: boolean }} extra
 */

/**
 * @typedef {Object} MultiLabyrinthSimulationWorkerPayload
 * @property {"start_simulation_all_labyrinths"} type
 * @property {Array<any>} players
 * @property {Array<{ labyrinthHrid: string, roomLevel: number, crates: string[] }>} labyrinths
 * @property {number} simulationTimeLimit
 * @property {{ mooPass: boolean, comExp: number, comDrop: number, enableHpMpVisualization: boolean }} extra
 */

export class WorkerClient {
    constructor() {
        this.worker = null;
    }

    /**
     * @param {SingleSimulationWorkerPayload} payload
     * @param {{ onProgress?: Function, onResult?: Function, onError?: Function }} handlers
     */
    startSimulation(payload, handlers = {}) {
        this.stopSimulation();

        this.worker = new Worker(new URL("../worker.js", import.meta.url), { type: "module" });
        this.worker.onmessage = (event) => {
            const data = event.data ?? {};

            switch (data.type) {
                case "simulation_progress":
                    handlers.onProgress?.(data);
                    break;
                case "simulation_result":
                    handlers.onResult?.(data.simResult);
                    break;
                case "simulation_error":
                    handlers.onError?.(data.error);
                    break;
                default:
                    break;
            }
        };

        this.worker.onerror = (error) => {
            handlers.onError?.(error?.message || String(error));
        };

        this.worker.postMessage(payload);
    }

    /**
     * @param {MultiZoneSimulationWorkerPayload | MultiLabyrinthSimulationWorkerPayload} payload
     * @param {{ onProgress?: Function, onItemResult?: Function, onBatchResult?: Function, onError?: Function }} handlers
     */
    startMultiSimulation(payload, handlers = {}) {
        this.stopSimulation();

        this.worker = new Worker(new URL("../multiWorker.js", import.meta.url), { type: "module" });
        this.worker.onmessage = (event) => {
            const data = event.data ?? {};

            switch (data.type) {
                case "simulation_progress":
                    handlers.onProgress?.(data);
                    break;
                case "simulation_item_result":
                    handlers.onItemResult?.(data);
                    break;
                case "simulation_result_allZones":
                case "simulation_result_allLabyrinths":
                    handlers.onBatchResult?.(data.simResults ?? [], data.type);
                    break;
                case "simulation_error":
                    handlers.onError?.(data.error);
                    break;
                default:
                    break;
            }
        };

        this.worker.onerror = (error) => {
            handlers.onError?.(error?.message || String(error));
        };

        this.worker.postMessage(payload);
    }

    stopSimulation() {
        if (!this.worker) {
            return;
        }

        this.worker.terminate();
        this.worker = null;
    }
}

const workerClient = new WorkerClient();
export default workerClient;

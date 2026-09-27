/**
 * @typedef {Object} SingleSimulationWorkerPayload
 * @property {"start_simulation"} type
 * @property {string} workerId
 * @property {Array<any>} players
 * @property {{ zoneHrid: string, difficultyTier: number } | null} zone
 * @property {{ labyrinthHrid: string, roomLevel: number, crates: string[] } | null} labyrinth
 * @property {number} simulationTimeLimit
 * @property {{ mooPass: boolean, comExp: number, comDrop: number, enableHpMpVisualization: boolean }} extra
 * @property {{ isGuildTrial?: boolean }} [simulationContext]
 */

/**
 * @typedef {Object} MultiZoneSimulationWorkerPayload
 * @property {"start_simulation_all_zones"} type
 * @property {Array<any>} players
 * @property {Array<{ zoneHrid: string, difficultyTier: number }>} zones
 * @property {number} [parallelWorkerLimit]
 * @property {number} simulationTimeLimit
 * @property {{ mooPass: boolean, comExp: number, comDrop: number, enableHpMpVisualization: boolean }} extra
 * @property {{ isGuildTrial?: boolean }} [simulationContext]
 */

/**
 * @typedef {Object} MultiLabyrinthSimulationWorkerPayload
 * @property {"start_simulation_all_labyrinths"} type
 * @property {Array<any>} players
 * @property {Array<{ labyrinthHrid: string, roomLevel: number, crates: string[] }>} labyrinths
 * @property {number} [parallelWorkerLimit]
 * @property {number} simulationTimeLimit
 * @property {{ mooPass: boolean, comExp: number, comDrop: number, enableHpMpVisualization: boolean }} extra
 * @property {{ isGuildTrial?: boolean }} [simulationContext]
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

    this.worker = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event) => {
      const data = event.data ?? {};

      switch (data.type) {
        case 'simulation_progress':
          handlers.onProgress?.(data);
          break;
        case 'simulation_result':
          handlers.onResult?.(data.simResult);
          break;
        case 'simulation_error':
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
   * 批量模拟（§54，2026-09-27）：一个 realm 里按顺序跑完 payloads —— **上一条结果（或失败）
   * 回来才发下一条**。串行投递是硬约束：worker.js 的 onmessage 是 async，并发投递会让同一
   * realm 里同时跑两个模拟，并把 installSeedScope 换上的全局 Math.random 互相覆盖
   * （「一个 realm 同一时刻只跑一场」是播种的安全前提，见 worker.js 的复用说明）。
   *
   * handlers: { onProgress(data, index), onResult(simResult, index), onError(errorMessage, index),
   *             onAbort(errorMessage, index), onComplete() }
   *   onError = 单场失败（worker.js 的 simulation_error）→ 本批继续跑下一条（与逐场路径的
   *             失败传播一致：那一场退化为失败样本，其余照跑）；
   *   onAbort = realm 级崩溃（worker.onerror）→ 本批停止投递，index = 在飞的那一条（调用方
   *             据此决定是否换新 realm 续跑）。
   */
  startSimulationBatch(payloads, handlers = {}) {
    this.stopSimulation();

    const list = Array.isArray(payloads) ? payloads : [];
    this.worker = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
    let index = -1;
    let aborted = false;

    const postNext = () => {
      index += 1;
      if (index >= list.length) {
        handlers.onComplete?.();
        return;
      }
      this.worker.postMessage(list[index]);
    };

    this.worker.onmessage = (event) => {
      if (aborted) {
        return;
      }
      const data = event.data ?? {};

      switch (data.type) {
        case 'simulation_progress':
          handlers.onProgress?.(data, index);
          break;
        case 'simulation_result':
          handlers.onResult?.(data.simResult, index);
          postNext();
          break;
        case 'simulation_error':
          handlers.onError?.(data.error, index);
          postNext();
          break;
        default:
          break;
      }
    };

    this.worker.onerror = (error) => {
      if (aborted) {
        return;
      }
      aborted = true;
      handlers.onAbort?.(error?.message || String(error), index);
    };

    postNext();
  }

  /**
   * @param {MultiZoneSimulationWorkerPayload | MultiLabyrinthSimulationWorkerPayload} payload
   * @param {{ onProgress?: Function, onItemResult?: Function, onBatchResult?: Function, onError?: Function }} handlers
   */
  startMultiSimulation(payload, handlers = {}) {
    this.stopSimulation();

    this.worker = new Worker(new URL('../multiWorker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event) => {
      const data = event.data ?? {};

      switch (data.type) {
        case 'simulation_progress':
          handlers.onProgress?.(data);
          break;
        case 'simulation_item_result':
          handlers.onItemResult?.(data);
          break;
        case 'simulation_result_allZones':
        case 'simulation_result_allLabyrinths':
          handlers.onBatchResult?.(data.simResults ?? [], data.type);
          break;
        case 'simulation_error':
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

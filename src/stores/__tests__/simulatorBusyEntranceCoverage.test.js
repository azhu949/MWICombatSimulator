import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSimulatorStore } from '../simulatorStore.js';
import { createQueueActions } from '../simulatorQueueActions.js';
import { RUN_SCOPE_SINGLE } from '../../services/simulationDomain.js';
import {
  DEDICATED_WORKER_SCOPE_HOME_MULTI_ROUND,
  hasHomeMultiRoundWorkerRunInProgress,
  runSimulationBatchWithDedicatedWorker,
  stopHomeMultiRoundWorkerRuns,
} from '../../services/simulatorWorkerRuns.js';

// 防漏项覆盖：统一忙碌判定（simulatorRunConflicts.isSimulationBusy）在各运行入口的
// 拦截。用「首页多轮批运行在途」句柄作代表性占用 —— 它是最近一次补漏涉及的标志
//（此前多处清单只靠 runtime.isRunning 的等价覆盖，属最易漏项的一类）。
// 句柄经真实运行入口（runSimulationBatchWithDedicatedWorker + 不结算的 Ctor 桩）注册，
// 保证测的是真实注册 → 判定可见的链路，而不是判定函数本身的 mock。
class HangingBatchWorkerClient {
  startSimulationBatch() {}
  stopSimulation() {}
}

const pendingBatches = [];

function startHangingHomeMultiRoundBatch() {
  const batch = runSimulationBatchWithDedicatedWorker([{ id: 1 }], () => {}, {
    scope: DEDICATED_WORKER_SCOPE_HOME_MULTI_ROUND,
    WorkerClientCtor: HangingBatchWorkerClient,
  });
  pendingBatches.push(batch.catch(() => {}));
}

function createLocalStorageMock() {
  const storage = new Map();
  return {
    getItem: vi.fn((key) => (storage.has(key) ? storage.get(key) : null)),
    setItem: vi.fn((key, value) => {
      storage.set(key, String(value));
    }),
    removeItem: vi.fn((key) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
  };
}

describe('unified busy predicate entrance coverage (home multi-round handle)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    global.localStorage = createLocalStorageMock();
  });

  afterEach(async () => {
    stopHomeMultiRoundWorkerRuns();
    await Promise.all(pendingBatches.splice(0));
    vi.restoreAllMocks();
  });

  function createStore() {
    const simulator = useSimulatorStore();
    simulator.players.forEach((player, index) => {
      player.selected = index === 0;
    });
    simulator.simulationSettings.runScope = RUN_SCOPE_SINGLE;
    simulator.simulationSettings.mode = 'zone';
    return simulator;
  }

  it('manual simulation entry is rejected while a home multi-round batch is in flight', async () => {
    const simulator = createStore();
    startHangingHomeMultiRoundBatch();
    expect(hasHomeMultiRoundWorkerRunInProgress()).toBe(true);

    await simulator.startSimulation();

    expect(simulator.runtime.error).toBe('common:simulation.errorAnotherRunInProgress');
    expect(simulator.runtime.isRunning).toBe(false);
  });

  it('queue baseline first gate is rejected synchronously', async () => {
    const simulator = createStore();
    simulator.setImportedProfileState(simulator.activePlayerId, true);
    startHangingHomeMultiRoundBatch();
    expect(hasHomeMultiRoundWorkerRunInProgress()).toBe(true);

    await expect(simulator.setQueueBaselineForActivePlayer({ runSimulation: true })).rejects.toThrow(
      'common:queue.errorBusy',
    );
    expect(simulator.activeQueueState.isRunning).toBe(false);
  });

  it('queue baseline second gate covers handles appearing inside the import window', async () => {
    const simulator = createStore();
    simulator.setImportedProfileState(simulator.activePlayerId, true);
    let resolveLoader;
    const actions = createQueueActions({
      ensureQueueMarketPriceSnapshot: async () => {},
      loadPlayerMapperModule: () =>
        new Promise((resolve) => {
          resolveLoader = resolve;
        }),
      workerClient: {},
    });

    const pending = actions.setQueueBaselineForActivePlayer.call(simulator, { runSimulation: true });
    // 动态导入窗口内多轮批运行开始：第一处检查已放行，第二处必须拦住。
    startHangingHomeMultiRoundBatch();
    resolveLoader({ buildPlayersForSimulation: () => [{}] });

    await expect(pending).rejects.toThrow('common:queue.errorBusy');
    expect(simulator.activeQueueState.isRunning).toBe(false);
    expect(simulator.runtime.isRunning).toBe(false);
  });

  it('active queue run entry is rejected', async () => {
    const simulator = createStore();
    startHangingHomeMultiRoundBatch();
    expect(hasHomeMultiRoundWorkerRunInProgress()).toBe(true);

    const rows = await simulator.runActiveQueue();

    expect(rows).toEqual([]);
    expect(simulator.activeQueueState.error).toBe('common:queue.errorBusy');
    expect(simulator.activeQueueState.isRunning).toBe(false);
  });
});

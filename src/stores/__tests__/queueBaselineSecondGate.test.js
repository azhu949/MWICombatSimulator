import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSimulatorStore } from '../simulatorStore.js';
import { createQueueActions } from '../simulatorQueueActions.js';
import { RUN_SCOPE_SINGLE } from '../../services/simulationDomain.js';

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

// 第二处防重入检查（await loadPlayerMapperModule() 之后、状态置位之前）补齐
// this.runtime.isRunning 的修复回归：动态导入启动窗口内，手动模拟
// startSimulation 完成置位后，后到的队列基线必须被同一 i18n 契约拦截，
// 否则双方经 workerClient 模块级单例 realm 互相 supersede 抢占。
// 用「真实 store + 工厂注入可控 loader」：让调用停在导入窗口内再翻转
// runtime.isRunning，以精确触达第二处检查（第一处在 await 前已放行）。
describe('queue baseline second re-entry gate covers runtime.isRunning', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    global.localStorage = createLocalStorageMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createStore() {
    const simulator = useSimulatorStore();
    simulator.players.forEach((player, index) => {
      player.selected = index === 0;
    });
    simulator.setImportedProfileState(simulator.activePlayerId, true);
    simulator.simulationSettings.runScope = RUN_SCOPE_SINGLE;
    simulator.simulationSettings.mode = 'zone';
    return simulator;
  }

  it('second gate rejects when manual simulation flips runtime.isRunning during the import window', async () => {
    const simulator = createStore();
    let resolveLoader;
    const loadPlayerMapperModule = () =>
      new Promise((resolve) => {
        resolveLoader = resolve;
      });
    const actions = createQueueActions({
      ensureQueueMarketPriceSnapshot: async () => {},
      loadPlayerMapperModule,
      workerClient: {},
    });

    // 不 await：让调用停在 await loadPlayerMapperModule() 的动态导入窗口内。
    const pending = actions.setQueueBaselineForActivePlayer.call(simulator, { runSimulation: true });
    // 模拟手动模拟 startSimulation 在同一窗口内完成置位（其 isRunning 在自身 await 之后）。
    simulator.runtime.isRunning = true;
    resolveLoader({ buildPlayersForSimulation: () => [{}] });

    await expect(pending).rejects.toThrow('common:queue.errorBusy');
    // throw 位于状态置位之前：无队列运行态残留（runtime.isRunning 归手动模拟所有，保持 true）。
    expect(simulator.activeQueueState.isRunning).toBe(false);
  });

  it('first gate still rejects synchronously when runtime.isRunning is set before the call', async () => {
    const simulator = createStore();
    const actions = createQueueActions({
      ensureQueueMarketPriceSnapshot: async () => {},
      loadPlayerMapperModule: async () => ({ buildPlayersForSimulation: () => [{}] }),
      workerClient: {},
    });

    // 第一处检查在 await 之前同步执行：调用前置位即触达，作为反向对照。
    simulator.runtime.isRunning = true;

    await expect(actions.setQueueBaselineForActivePlayer.call(simulator, { runSimulation: true })).rejects.toThrow(
      'common:queue.errorBusy',
    );
    expect(simulator.activeQueueState.isRunning).toBe(false);
  });
});

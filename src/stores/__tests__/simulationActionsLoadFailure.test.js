import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSimulatorStore } from '../simulatorStore.js';
import { createSimulationActions } from '../simulatorSimulationActions.js';
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

// 入口段模块加载失败契约（G2 范围外两处同款缺口的修复回归）：
// ① startSimulation：调用方为模板事件直连（Vue 仅 console.error），失败必须
//    转入 runtime.error 错误通道（App.vue watch → i18n key 翻译弹窗），
//    不得向上抛出，否则用户端完全静默。
// ② setQueueBaselineForActivePlayer：throw-by-contract 动作，失败必须转为
//    i18n key 的 Error，由调用方（App.vue 顶栏 / SettingsPage）catch 后本地化
//    显示，不得透传浏览器原生错误文本。
// 测试用「真实 store + 工厂注入失败 loader」：store 层无法注入失败 loader
//（真实动态导入经模块级缓存），故直接调用动作工厂并以真实 store 作为 this。
describe('simulation/queue entry module-load failure funnel', () => {
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
    return simulator;
  }

  it('startSimulation converts a rejecting module load into the runtime error channel', async () => {
    const simulator = createStore();
    const actions = createSimulationActions({
      loadPlayerMapperModule: () => Promise.reject(new Error('Failed to fetch dynamically imported module')),
      workerClient: {},
    });

    // 契约：入口失败不 reject（模板事件直连下 Vue 只 console.error），统一
    // 写 runtime.error（i18n key），无运行态残留。
    await expect(actions.startSimulation.call(simulator)).resolves.toBeUndefined();
    expect(simulator.runtime.error).toBe('common:simulation.errorLoadModule');
    expect(simulator.runtime.isRunning).toBe(false);
  });

  it('startSimulation funnels buildPlayersForSimulation throwbacks into errorBuildPlayerData', async () => {
    const simulator = createStore();
    const actions = createSimulationActions({
      loadPlayerMapperModule: async () => ({
        buildPlayersForSimulation: () => {
          throw new Error('player build failed');
        },
      }),
      workerClient: {},
    });

    await expect(actions.startSimulation.call(simulator)).resolves.toBeUndefined();
    expect(simulator.runtime.error).toBe('common:simulation.errorBuildPlayerData');
    expect(simulator.runtime.isRunning).toBe(false);
  });

  it('setQueueBaselineForActivePlayer throws the i18n key contract on module load failure', async () => {
    const simulator = createStore();
    simulator.setImportedProfileState(simulator.activePlayerId, true);
    simulator.simulationSettings.runScope = RUN_SCOPE_SINGLE;
    simulator.simulationSettings.mode = 'zone';
    const actions = createQueueActions({
      ensureQueueMarketPriceSnapshot: async () => {},
      loadPlayerMapperModule: () => Promise.reject(new Error('Failed to fetch dynamically imported module')),
      workerClient: {},
    });

    await expect(actions.setQueueBaselineForActivePlayer.call(simulator, { runSimulation: true })).rejects.toThrow(
      'common:queue.errorLoadModule',
    );
    // throw 位于状态置位之前：无运行态残留。
    expect(simulator.activeQueueState.isRunning).toBe(false);
    expect(simulator.runtime.isRunning).toBe(false);
  });

  it('setQueueBaselineForActivePlayer maps buildPlayersForSimulation throwbacks to errorBuildPlayerData', async () => {
    const simulator = createStore();
    simulator.setImportedProfileState(simulator.activePlayerId, true);
    simulator.simulationSettings.runScope = RUN_SCOPE_SINGLE;
    simulator.simulationSettings.mode = 'zone';
    const actions = createQueueActions({
      ensureQueueMarketPriceSnapshot: async () => {},
      loadPlayerMapperModule: async () => ({
        buildPlayersForSimulation: () => {
          throw new Error('player build failed');
        },
      }),
      workerClient: {},
    });

    await expect(actions.setQueueBaselineForActivePlayer.call(simulator, { runSimulation: true })).rejects.toThrow(
      'common:queue.errorBuildPlayerData',
    );
    expect(simulator.activeQueueState.isRunning).toBe(false);
  });
});

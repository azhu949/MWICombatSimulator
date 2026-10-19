import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSimulatorStore } from '../simulatorStore.js';
import { createSimulationActions } from '../simulatorSimulationActions.js';
import { createQueueActions } from '../simulatorQueueActions.js';
import { RUN_SCOPE_SINGLE } from '../../services/simulationDomain.js';
import { GAME_MODE_IRONCOW } from '../../services/gameMode.js';
import { cancelSharedWorkerRun } from '../../services/simulatorWorkerRuns.js';

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

// 动态导入窗口的铁牛模式闸门：startSimulation / setQueueBaselineForActivePlayer 的
// runtime.isRunning 要到首个 await 之后才置位，窗口内切入铁牛会让任务在无停止入口的
// 占位态下继续运行。runtime.preparing 覆盖该窗口，await 后再复查 gameMode 兜底。
describe('simulation start preparation window in ironcow mode', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    global.localStorage = createLocalStorageMock();
  });

  afterEach(() => {
    cancelSharedWorkerRun();
    vi.restoreAllMocks();
  });

  function createStore() {
    const simulator = useSimulatorStore();
    simulator.players.forEach((player, index) => {
      player.selected = index === 0;
    });
    simulator.simulationSettings.mode = 'zone';
    simulator.simulationSettings.runScope = RUN_SCOPE_SINGLE;
    simulator.simulationSettings.simulationRounds = 1;
    return simulator;
  }

  it('manual simulation exposes preparing during the loader await and rejects after switching to ironcow', async () => {
    const simulator = createStore();
    let resolveLoader;
    const loaderPromise = new Promise((resolve) => {
      resolveLoader = resolve;
    });
    const startSimulationStub = vi.fn();
    const actions = createSimulationActions({
      loadPlayerMapperModule: () => loaderPromise,
      workerClient: { startSimulation: startSimulationStub },
    });

    const startPromise = actions.startSimulation.call(simulator);
    expect(simulator.runtime.preparing).toBe(true);
    expect(simulator.runtime.isRunning).toBe(false);

    simulator.setGameMode(GAME_MODE_IRONCOW);
    resolveLoader({ buildPlayersForSimulation: () => [{}] });

    await expect(startPromise).resolves.toBeUndefined();
    expect(simulator.runtime.preparing).toBe(false);
    expect(simulator.runtime.isRunning).toBe(false);
    expect(simulator.runtime.error).toBe('common:simulation.errorIroncowMode');
    expect(startSimulationStub).not.toHaveBeenCalled();
  });

  it('manual simulation resets preparing when the loader fails and keeps the load error channel', async () => {
    const simulator = createStore();
    let rejectLoader;
    const loaderPromise = new Promise((resolve, reject) => {
      rejectLoader = reject;
    });
    const actions = createSimulationActions({
      loadPlayerMapperModule: () => loaderPromise,
      workerClient: { startSimulation: vi.fn() },
    });

    const startPromise = actions.startSimulation.call(simulator);
    expect(simulator.runtime.preparing).toBe(true);
    rejectLoader(new Error('chunk load failed'));

    await expect(startPromise).resolves.toBeUndefined();
    expect(simulator.runtime.preparing).toBe(false);
    expect(simulator.runtime.error).toBe('common:simulation.errorLoadModule');
  });

  it('manual simulation is rejected synchronously when already in ironcow mode', async () => {
    const simulator = createStore();
    simulator.setGameMode(GAME_MODE_IRONCOW);
    const loadPlayerMapperModule = vi.fn();
    const actions = createSimulationActions({
      loadPlayerMapperModule,
      workerClient: { startSimulation: vi.fn() },
    });

    await actions.startSimulation.call(simulator);
    expect(loadPlayerMapperModule).not.toHaveBeenCalled();
    expect(simulator.runtime.preparing).toBe(false);
    expect(simulator.runtime.error).toBe('common:simulation.errorIroncowMode');
  });

  it('queue baseline exposes preparing during the loader await and rejects after switching to ironcow', async () => {
    const simulator = createStore();
    simulator.setImportedProfileState(simulator.activePlayerId, true);
    let resolveLoader;
    const loaderPromise = new Promise((resolve) => {
      resolveLoader = resolve;
    });
    const actions = createQueueActions({
      ensureQueueMarketPriceSnapshot: async () => {},
      loadPlayerMapperModule: () => loaderPromise,
      workerClient: {},
    });

    const pending = actions.setQueueBaselineForActivePlayer.call(simulator, { runSimulation: true });
    expect(simulator.runtime.preparing).toBe(true);
    expect(simulator.activeQueueState.isRunning).toBe(false);

    simulator.setGameMode(GAME_MODE_IRONCOW);
    resolveLoader({ buildPlayersForSimulation: () => [{}] });

    await expect(pending).rejects.toThrow('common:queue.errorIroncowMode');
    expect(simulator.runtime.preparing).toBe(false);
    expect(simulator.runtime.isRunning).toBe(false);
    expect(simulator.activeQueueState.isRunning).toBe(false);
  });

  it('setting only the queue baseline snapshot stays available in ironcow mode', async () => {
    const simulator = createStore();
    simulator.setGameMode(GAME_MODE_IRONCOW);
    const loadPlayerMapperModule = vi.fn();
    const actions = createQueueActions({
      ensureQueueMarketPriceSnapshot: async () => {},
      loadPlayerMapperModule,
      workerClient: {},
    });

    const baseline = await actions.setQueueBaselineForActivePlayer.call(simulator);
    expect(baseline).toBeTruthy();
    expect(loadPlayerMapperModule).not.toHaveBeenCalled();
    expect(simulator.runtime.preparing).toBe(false);
    expect(simulator.activeQueueState.isRunning).toBe(false);
  });
});

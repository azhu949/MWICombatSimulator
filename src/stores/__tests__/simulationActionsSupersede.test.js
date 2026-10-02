import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSimulatorStore } from '../simulatorStore.js';
import { createSimulationActions } from '../simulatorSimulationActions.js';
import { RUN_SCOPE_SINGLE } from '../../services/simulationDomain.js';
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

// 共享 realm 抢占（supersede）竞态的修复回归：手动模拟路径（startSimulation）此前
// 既缺「本 store 已在运行」的防重入项（动态导入 await 的窗口期内重复进入），旧运行的
// onError 收尾又会无条件写 runtime.error / 复位 isRunning，污染抢占它的新运行状态
//（App.vue watch runtime.error → 全局错误弹窗误报 "Realm superseded by a newer run."）。
// 测试用「真实 store + 动作工厂注入桩」：与 simulationActionsLoadFailure.test.js 同款
// 口径，workerClient.startSimulation 为注入桩，不触真实 worker。
describe('simulation supersede/reentry guards', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    global.localStorage = createLocalStorageMock();
  });

  afterEach(() => {
    // 跨用例清理共享句柄：单轮路径现在注册共享句柄，桩不回调时句柄会残留，
    // 防 hasSharedWorkerRunInProgress 泄漏到后续用例（interference）。
    cancelSharedWorkerRun();
    vi.restoreAllMocks();
  });

  function createStore() {
    const simulator = useSimulatorStore();
    simulator.players.forEach((player, index) => {
      player.selected = index === 0;
    });
    return simulator;
  }

  // 显式锁定单轮路径（rounds <= 1 走注入的 workerClient.startSimulation）：
  // store 默认值来自持久化 UI 设置，测试环境不保证，全部显式设置保险。
  function forceSingleRoundScope(simulator) {
    simulator.simulationSettings.mode = 'zone';
    simulator.simulationSettings.runScope = RUN_SCOPE_SINGLE;
    simulator.simulationSettings.simulationRounds = 1;
  }

  it('startSimulation is rejected while runtime.isRunning is already true', async () => {
    const simulator = createStore();
    const startSimulationStub = vi.fn();
    const actions = createSimulationActions({
      loadPlayerMapperModule: async () => ({ buildPlayersForSimulation: () => [{}] }),
      workerClient: { startSimulation: startSimulationStub },
    });

    // 模拟另一入口已置位运行态：第一处检查清单必须拦截，走既有 i18n key。
    simulator.runtime.isRunning = true;
    await expect(actions.startSimulation.call(simulator)).resolves.toBeUndefined();
    expect(simulator.runtime.error).toBe('common:simulation.errorAnotherRunInProgress');
    expect(startSimulationStub).not.toHaveBeenCalled();
    expect(simulator.runtime.isRunning).toBe(true);
  });

  it('startSimulation is rejected when runtime.isRunning turns true during the loader await window', async () => {
    const simulator = createStore();
    const startSimulationStub = vi.fn();
    let resolveLoader;
    const loaderPromise = new Promise((resolve) => {
      resolveLoader = resolve;
    });
    const actions = createSimulationActions({
      loadPlayerMapperModule: () => loaderPromise,
      workerClient: { startSimulation: startSimulationStub },
    });

    // 不 await：调用同步段通过第一处检查后在 loadPlayerMapperModule 的 await 处挂起；
    // 窗口期内另一入口置位 isRunning（此前该窗口缺拦截，重复调用会并发进入）。
    const startPromise = actions.startSimulation.call(simulator);
    simulator.runtime.isRunning = true;
    resolveLoader({ buildPlayersForSimulation: () => [{}] });

    await expect(startPromise).resolves.toBeUndefined();
    // 第二处重检（await 之后、置位 isRunning 之前）必须拦截：同 key、不触 worker、
    // 不动新运行刚置位的运行态。
    expect(simulator.runtime.error).toBe('common:simulation.errorAnotherRunInProgress');
    expect(startSimulationStub).not.toHaveBeenCalled();
    expect(simulator.runtime.isRunning).toBe(true);
  });

  it('onError swallows supersede cancellation silently and keeps the original channel for real errors', async () => {
    const simulator = createStore();
    forceSingleRoundScope(simulator);
    let capturedHandlers = null;
    const startSimulationStub = vi.fn((payload, handlers) => {
      capturedHandlers = handlers;
    });
    const actions = createSimulationActions({
      loadPlayerMapperModule: async () => ({ buildPlayersForSimulation: () => [{}] }),
      workerClient: { startSimulation: startSimulationStub },
    });

    await expect(actions.startSimulation.call(simulator)).resolves.toBeUndefined();
    expect(startSimulationStub).toHaveBeenCalledTimes(1);
    // 桩不回调 onResult：运行态保持「运行中」，模拟随后被新运行抢占的时点。
    expect(simulator.runtime.isRunning).toBe(true);

    // 抢占收尾（workerClient 以 createSupersededRealmError 触发旧运行的 onError）：
    // cancelled 属共享 realm 抢占语义，必须静默返回——不写 error（避免全局弹窗）、
    // 不复位 isRunning（避免打掉新运行刚置位的状态）。
    const supersededError = new Error('Realm superseded by a newer run.');
    supersededError.code = 'cancelled';
    capturedHandlers.onError(supersededError);
    // 单轮路径经共享句柄包装（promise 化）投递：onError 的传播隔一跳微任务，
    // 等待 promise 链排空后再断言。
    await Promise.resolve();
    expect(simulator.runtime.error).toBe('');
    expect(simulator.runtime.isRunning).toBe(true);

    // 对照：非取消错误仍走原错误通道（复位运行态 + formatSimulationRunError 文本）。
    // 包装路径的一次运行只结算一次（settle 幂等防护），与直连时同一 handlers 可
    // 连续多次回调不同——复位运行态后重新发起一次运行，锚定真实错误通道保持不变。
    simulator.runtime.isRunning = false;
    await expect(actions.startSimulation.call(simulator)).resolves.toBeUndefined();
    expect(startSimulationStub).toHaveBeenCalledTimes(2);
    capturedHandlers.onError(new Error('boom'));
    await vi.waitFor(() => {
      expect(simulator.runtime.isRunning).toBe(false);
      expect(simulator.runtime.error).toBe('boom');
    });
  });

  // 多轮批（首页多轮模拟）被 supersede 抢占：cancelled 收尾必须与单轮路径同口径——
  // 运行时状态归抢占者所有，不复位 isRunning、不写 runtime.error；「停止」场景的复位
  // 由 store.stopSimulation 负责（simulatorStore.test.js「停止按钮取消整批」锚定）。
  it('multi-round supersede cancellation leaves the runtime state to the new run', async () => {
    const simulator = createStore();
    simulator.simulationSettings.mode = 'zone';
    simulator.simulationSettings.runScope = RUN_SCOPE_SINGLE;
    simulator.simulationSettings.simulationRounds = 3;
    let rejectBatch;
    const batchSpy = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectBatch = reject;
        }),
    );
    simulator.runSimulationBatchPayloads = batchSpy;
    const actions = createSimulationActions({
      loadPlayerMapperModule: async () => ({ buildPlayersForSimulation: () => [{}] }),
      workerClient: { startSimulation: vi.fn() },
    });

    await expect(actions.startSimulation.call(simulator)).resolves.toBeUndefined();
    expect(batchSpy).toHaveBeenCalledTimes(1);
    // 批运行在飞：运行时状态由本次多轮批持有。
    expect(simulator.runtime.isRunning).toBe(true);

    // 抢占收尾：等价于 workerClient.inFlightDiscard → onAbort(cancelled) →
    // simulatorWorkerRuns 整批取消收敛后的 rejected promise（上游链路已由
    // simulatorWorkerRuns.test.js / workerClient.test.js 的 supersede 用例锚定）。
    const supersededError = new Error('Realm superseded by a newer run.');
    supersededError.code = 'cancelled';
    rejectBatch(supersededError);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 与单轮路径 onError 同口径：cancelled 静默收尾，不得打掉抢占者刚置位的运行态。
    expect(simulator.runtime.isRunning).toBe(true);
    expect(simulator.runtime.error).toBe('');
  });
});

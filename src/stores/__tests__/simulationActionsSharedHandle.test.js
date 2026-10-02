import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSimulatorStore } from '../simulatorStore.js';
import { createSimulationActions } from '../simulatorSimulationActions.js';
import { RUN_SCOPE_ALL_GROUP_ZONES } from '../../services/simulationDomain.js';
import { cancelSharedWorkerRun, hasSharedWorkerRunInProgress } from '../../services/simulatorWorkerRuns.js';

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

// 手动模拟共享句柄可见性的修复回归：首页三条手动路径（单轮 / 全迷宫 / 全区域）
// 此前直连 workerClient、不注册任何运行句柄，导致手动运行期间
// hasSharedWorkerRunInProgress() 恒为 false——所有只查该函数的纵深防线（触发器
// 优化器服务层闸门等）看不到手动运行。改为共享句柄包装路径后，运行期间句柄必须
// 可见、settle 后注销；用户「停止」以 cancelled 静默收尾（不写 runtime.error、
// 不触发全局错误弹窗），运行态由 stopSimulation 手动复位。
// 测试用「真实 store + 动作工厂注入桩」：与 simulationActionsSupersede.test.js
// 同款口径，workerClient.startMultiSimulation 为注入桩，不触真实 worker。
describe('simulation manual-run shared handle visibility', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    global.localStorage = createLocalStorageMock();
  });

  afterEach(() => {
    // 跨用例清理共享句柄：桩不回调时 promise 未结算，防模块级句柄泄漏到后续用例。
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

  // 显式锁定全区域路径（走注入的 workerClient.startMultiSimulation）：
  // store 默认值来自持久化 UI 设置，测试环境不保证，全部显式设置保险。
  function forceAllGroupZonesScope(simulator) {
    simulator.simulationSettings.mode = 'zone';
    simulator.simulationSettings.runScope = RUN_SCOPE_ALL_GROUP_ZONES;
  }

  it('manual all-zones run registers the shared handle and clears it after the batch result', async () => {
    const simulator = createStore();
    forceAllGroupZonesScope(simulator);
    let capturedHandlers = null;
    const startMultiSimulationStub = vi.fn((payload, handlers) => {
      capturedHandlers = handlers;
    });
    const actions = createSimulationActions({
      loadPlayerMapperModule: async () => ({ buildPlayersForSimulation: () => [{ hrid: 'player1' }] }),
      workerClient: { startMultiSimulation: startMultiSimulationStub, stopSimulation: vi.fn() },
    });

    await actions.startSimulation.call(simulator);
    expect(startMultiSimulationStub).toHaveBeenCalledTimes(1);
    expect(simulator.runtime.isRunning).toBe(true);
    // 手动 multi 运行期间共享句柄必须可见（此前直连路径恒 false）。
    expect(hasSharedWorkerRunInProgress()).toBe(true);

    capturedHandlers.onBatchResult([{ encounters: 5 }], 'simulation_result_allZones');

    // settle 同步注销句柄（防线恢复放行）；store 的结果写入随后在微任务中完成。
    expect(hasSharedWorkerRunInProgress()).toBe(false);
    await vi.waitFor(() => expect(simulator.runtime.isRunning).toBe(false));
    // toMatchObject：summarizeBatchResults 的利润估算会在 simResult 上挂
    // __noRngDropCountMapCache 缓存字段，只锚定业务字段即可。
    expect(simulator.results.simResults).toMatchObject([{ encounters: 5 }]);
    expect(simulator.results.batchResultType).toBe('simulation_result_allZones');
    expect(simulator.runtime.error).toBe('');
  });

  it('stopSimulation cancels the manual multi run silently and resets the runtime state', async () => {
    const simulator = createStore();
    forceAllGroupZonesScope(simulator);
    const startMultiSimulationStub = vi.fn();
    const stopSimulationStub = vi.fn();
    const actions = createSimulationActions({
      loadPlayerMapperModule: async () => ({ buildPlayersForSimulation: () => [{ hrid: 'player1' }] }),
      workerClient: { startMultiSimulation: startMultiSimulationStub, stopSimulation: stopSimulationStub },
    });

    await actions.startSimulation.call(simulator);
    expect(hasSharedWorkerRunInProgress()).toBe(true);

    actions.stopSimulation.call(simulator);

    // 用户「停止」：句柄以 cancelled 收尾（terminate 注入的 worker），store 的
    // onError 取消特判静默处理——runtime.error 保持 ''（无全局错误弹窗），
    // isRunning 由 stopSimulation 手动复位。
    await vi.waitFor(() => expect(hasSharedWorkerRunInProgress()).toBe(false));
    expect(simulator.runtime.error).toBe('');
    expect(simulator.runtime.isRunning).toBe(false);
    expect(stopSimulationStub).toHaveBeenCalled();
  });
});

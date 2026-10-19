import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dungeonCalculatorRunInFlight,
  isReactiveSimulationBusy,
  isSimulationBusy,
  setDungeonCalculatorRunInFlight,
} from '../simulatorRunConflicts.js';
import {
  hasDungeonCalculatorWorkerRunInProgress,
  hasHomeMultiRoundWorkerRunInProgress,
  hasSharedWorkerRunInProgress,
} from '../simulatorWorkerRuns.js';
import { hasBudgetOptimizerRunInProgress } from '../budgetOptimizerRunRegistry.js';

// 判定函数对模块级句柄的依赖在这里 mock 固定：本文件只测判定矩阵与选项语义；
// 真实句柄注册路径（runSimulationBatchWithDedicatedWorker → 句柄可见）由
// src/stores/__tests__/simulatorBusyEntranceCoverage.test.js 锚定。
vi.mock('../simulatorWorkerRuns.js', () => ({
  hasDungeonCalculatorWorkerRunInProgress: vi.fn(() => false),
  hasHomeMultiRoundWorkerRunInProgress: vi.fn(() => false),
  hasSharedWorkerRunInProgress: vi.fn(() => false),
}));
vi.mock('../budgetOptimizerRunRegistry.js', () => ({
  hasBudgetOptimizerRunInProgress: vi.fn(() => false),
}));

function createStore(overrides = {}) {
  return {
    runtime: { isRunning: false },
    isAnyQueueRunning: false,
    advisor: { runtime: { isRunning: false, scanInFlight: false } },
    foodOptimizer: { runtime: { isRunning: false } },
    triggerOptimizer: { runtime: { isRunning: false } },
    budgetOptimizer: { runtime: { isRunning: false } },
    ...overrides,
  };
}

describe('simulatorRunConflicts unified busy predicate', () => {
  beforeEach(() => {
    hasSharedWorkerRunInProgress.mockReturnValue(false);
    hasHomeMultiRoundWorkerRunInProgress.mockReturnValue(false);
    hasBudgetOptimizerRunInProgress.mockReturnValue(false);
    hasDungeonCalculatorWorkerRunInProgress.mockReturnValue(false);
  });

  it('reports not busy for an idle store with no module-level realm handles', () => {
    expect(isSimulationBusy(createStore())).toBe(false);
    expect(isReactiveSimulationBusy(createStore())).toBe(false);
  });

  it.each([
    ['runtime.isRunning', { runtime: { isRunning: true } }],
    ['isAnyQueueRunning', { isAnyQueueRunning: true }],
    ['advisor.runtime.isRunning', { advisor: { runtime: { isRunning: true, scanInFlight: false } } }],
    ['advisor.runtime.scanInFlight', { advisor: { runtime: { isRunning: false, scanInFlight: true } } }],
    ['foodOptimizer.runtime.isRunning', { foodOptimizer: { runtime: { isRunning: true } } }],
    ['triggerOptimizer.runtime.isRunning', { triggerOptimizer: { runtime: { isRunning: true } } }],
    ['budgetOptimizer.runtime.isRunning', { budgetOptimizer: { runtime: { isRunning: true } } }],
  ])('detects store flag %s', (_label, overrides) => {
    expect(isSimulationBusy(createStore(overrides))).toBe(true);
    expect(isReactiveSimulationBusy(createStore(overrides))).toBe(true);
  });

  it('detects module-level realm handles only in the full predicate', () => {
    hasSharedWorkerRunInProgress.mockReturnValue(true);
    expect(isSimulationBusy(createStore())).toBe(true);
    expect(isReactiveSimulationBusy(createStore())).toBe(false);

    hasSharedWorkerRunInProgress.mockReturnValue(false);
    hasHomeMultiRoundWorkerRunInProgress.mockReturnValue(true);
    expect(isSimulationBusy(createStore())).toBe(true);
    expect(isReactiveSimulationBusy(createStore())).toBe(false);

    // 预算优化注册表（2026-10-04 登记）：与非响应式句柄同款 —— 完整版可见、响应式版不可见。
    hasHomeMultiRoundWorkerRunInProgress.mockReturnValue(false);
    hasBudgetOptimizerRunInProgress.mockReturnValue(true);
    expect(isSimulationBusy(createStore())).toBe(true);
    expect(isReactiveSimulationBusy(createStore())).toBe(false);

    // 地下城计算器批运行（2026-10-10 登记）：与非响应式句柄同款。
    hasBudgetOptimizerRunInProgress.mockReturnValue(false);
    hasDungeonCalculatorWorkerRunInProgress.mockReturnValue(true);
    expect(isSimulationBusy(createStore())).toBe(true);
    expect(isReactiveSimulationBusy(createStore())).toBe(false);
  });

  it('ignores advisor scanInFlight only when the caller opts out (advisor self gate)', () => {
    const store = createStore({ advisor: { runtime: { isRunning: false, scanInFlight: true } } });
    expect(isSimulationBusy(store)).toBe(true);
    expect(isSimulationBusy(store, { ignoreAdvisorScanInFlight: true })).toBe(false);
    expect(isReactiveSimulationBusy(store, { ignoreAdvisorScanInFlight: true })).toBe(false);

    // 其它标志不受 ignore 选项影响。
    const otherBusy = createStore({
      advisor: { runtime: { isRunning: false, scanInFlight: true } },
      foodOptimizer: { runtime: { isRunning: true } },
    });
    expect(isSimulationBusy(otherBusy, { ignoreAdvisorScanInFlight: true })).toBe(true);
  });

  it('treats a missing store defensively as not busy', () => {
    expect(isSimulationBusy(null)).toBe(false);
    expect(isReactiveSimulationBusy(undefined)).toBe(false);
  });

  it('exposes the dungeon calculator run anchor without feeding the busy predicates', () => {
    // 跨 store 运行态的响应式锚点（顶栏模式按钮消费）：写入 / 复位语义，以及
    //「不并入统一忙碌判定」的契约——计算器入口自身闸门引用两份判定，并入会在其
    // 运行期间自我判忙而自锁。
    expect(dungeonCalculatorRunInFlight.value).toBe(false);
    setDungeonCalculatorRunInFlight(true);
    expect(dungeonCalculatorRunInFlight.value).toBe(true);
    expect(isSimulationBusy(createStore())).toBe(false);
    expect(isReactiveSimulationBusy(createStore())).toBe(false);
    setDungeonCalculatorRunInFlight(false);
    expect(dungeonCalculatorRunInFlight.value).toBe(false);
  });
});

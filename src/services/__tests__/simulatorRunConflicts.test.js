import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isReactiveSimulationBusy, isSimulationBusy } from '../simulatorRunConflicts.js';
import { hasHomeMultiRoundWorkerRunInProgress, hasSharedWorkerRunInProgress } from '../simulatorWorkerRuns.js';

// 判定函数对模块级句柄的依赖在这里 mock 固定：本文件只测判定矩阵与选项语义；
// 真实句柄注册路径（runSimulationBatchWithDedicatedWorker → 句柄可见）由
// src/stores/__tests__/simulatorBusyEntranceCoverage.test.js 锚定。
vi.mock('../simulatorWorkerRuns.js', () => ({
  hasHomeMultiRoundWorkerRunInProgress: vi.fn(() => false),
  hasSharedWorkerRunInProgress: vi.fn(() => false),
}));

function createStore(overrides = {}) {
  return {
    runtime: { isRunning: false },
    isAnyQueueRunning: false,
    advisor: { runtime: { isRunning: false, scanInFlight: false } },
    foodOptimizer: { runtime: { isRunning: false } },
    triggerOptimizer: { runtime: { isRunning: false } },
    ...overrides,
  };
}

describe('simulatorRunConflicts unified busy predicate', () => {
  beforeEach(() => {
    hasSharedWorkerRunInProgress.mockReturnValue(false);
    hasHomeMultiRoundWorkerRunInProgress.mockReturnValue(false);
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
});

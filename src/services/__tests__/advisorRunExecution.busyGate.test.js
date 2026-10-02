import { describe, expect, it } from 'vitest';
import { executeAdvisorScan } from '../advisorRunExecution.js';
import { createAdvisorState } from '../advisorDomain.js';

// advisor 双闸统一判定回归：第一处（函数入口）与第二处（动态导入窗口复检）
// 都改走 simulatorRunConflicts.isSimulationBusy。advisor 自身扫描的 scanInFlight
// 必须被 ignoreAdvisorScanInFlight 忽略，不得把自己拦下。
function createFakeStore(overrides = {}) {
  return {
    runtime: { isRunning: false },
    isAnyQueueRunning: false,
    foodOptimizer: { runtime: { isRunning: false } },
    triggerOptimizer: { runtime: { isRunning: false } },
    advisor: createAdvisorState(),
    players: [],
    selectedPlayers: [{ id: 'player-1', name: 'Hero' }],
    activePlayerId: 'player-1',
    ...overrides,
  };
}

describe('executeAdvisorScan unified busy gates', () => {
  it('rejects immediately when another feature is running (first gate)', async () => {
    const store = createFakeStore({ triggerOptimizer: { runtime: { isRunning: true } } });

    await expect(executeAdvisorScan({ store, loadPlayerMapperModule: () => Promise.resolve({}) })).resolves.toEqual([]);
    expect(store.advisor.error).toBe('Another simulation is already running.');
  });

  it('rejects when a conflicting run starts inside the dynamic-import window (second gate)', async () => {
    const store = createFakeStore();
    let resolveLoader;
    const pending = executeAdvisorScan({
      store,
      loadPlayerMapperModule: () =>
        new Promise((resolve) => {
          resolveLoader = resolve;
        }),
    });

    // 窗口内队列运行开始（第二处此前只查 food/trigger 两项，看不到队列）。
    store.isAnyQueueRunning = true;
    resolveLoader({ buildPlayersForSimulation: () => [{}] });

    await expect(pending).resolves.toEqual([]);
    expect(store.advisor.error).toBe('Another simulation is already running.');
  });

  it('does not treat its own scanInFlight as a conflict (ignored flag allows entry)', async () => {
    const store = createFakeStore();
    // runAdvisorScan 在进入 executeAdvisorScan 前已同步置位 scanInFlight；
    // 若统一判定不忽略该项，每次扫描都会被自己拦下。
    store.advisor.runtime.scanInFlight = true;

    await expect(
      executeAdvisorScan({ store, loadPlayerMapperModule: async () => ({ buildPlayersForSimulation: () => [] }) }),
    ).resolves.toEqual([]);
    // 放行后走到「玩家构建为空」的业务校验（而非 another-run 拦截）。
    expect(store.advisor.error).toBe('Unable to build player simulation data.');
  });
});

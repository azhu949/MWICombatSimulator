import { describe, expect, it } from 'vitest';
import { executeAdvisorScan } from '../advisorRunExecution.js';
import { createAdvisorState } from '../advisorDomain.js';

// G2 回归：executeAdvisorScan 入口段（context 创建之前）的异常不得向上抛出，
// 必须统一转入 store.advisor.error 并以 [] 正常返回——否则会逃逸成
// AdvisorPage void runAdvisor() 的全局 unhandledrejection 弹窗，并跳过
// runAdvisorScan 的收尾落盘。store 层无法注入失败的 loadPlayerMapperModule
// （simulatorStore 的动态导入经模块级 promise 缓存），故在服务层直测。
function createFakeStore() {
  const advisor = createAdvisorState();
  // 预置上一轮扫描结果：入口段失败发生在「清空旧结果」之前，旧结果必须保留。
  advisor.quickRows = [{ id: 'prev-quick' }];
  advisor.refinedRows = [];
  advisor.topCards = [{ key: 'overall' }];
  // 预置「上一轮已完成扫描」的 runtime 形态（done/进度 1/取消标记残留）：
  // 让下方对 handleAdvisorScanEntryError 防御性复位的断言真正有效——
  // 若初始值即 idle/0/false，断言将在 handler 什么也不做时也通过。
  advisor.runtime.phase = 'done';
  advisor.runtime.progress = 1;
  advisor.runtime.cancelRequested = true;
  advisor.runtime.runId = 3;
  return {
    runtime: { isRunning: false },
    isAnyQueueRunning: false,
    activePlayerId: 'player-1',
    players: [{ id: 'player-1', name: 'Hero' }],
    selectedPlayers: [{ id: 'player-1', name: 'Hero' }],
    advisor,
  };
}

describe('executeAdvisorScan entry failure funnel', () => {
  it('converts a rejecting dynamic import into advisor.error instead of a rejected promise', async () => {
    const store = createFakeStore();
    const loadPlayerMapperModule = () => Promise.reject(new Error('Failed to fetch dynamically imported module'));

    const scanPromise = executeAdvisorScan({ store, loadPlayerMapperModule });

    // 契约：入口段失败绝不 reject（runAdvisorScan 无 catch，页面侧是
    // void runAdvisor() 浮动 Promise），统一以 [] 正常返回。
    await expect(scanPromise).resolves.toEqual([]);
    expect(store.advisor.error).toBe('Failed to fetch dynamically imported module');
    // 失败尝试保留旧结果（清空点位于入口段之后）。
    expect(store.advisor.quickRows).toEqual([{ id: 'prev-quick' }]);
    expect(store.advisor.topCards).toEqual([{ key: 'overall' }]);
    // runtime 防御性复位：上一轮的 done/进度 1/取消残留被复位，无卡死、无残留运行态。
    expect(store.advisor.runtime.isRunning).toBe(false);
    expect(store.advisor.runtime.phase).toBe('idle');
    expect(store.advisor.runtime.progress).toBe(0);
    expect(store.advisor.runtime.cancelRequested).toBe(false);
    // 入口失败不消耗 runId（createAdvisorScanContext 未触达），上一轮 runId 保留。
    expect(store.advisor.runtime.runId).toBe(3);
  });

  it('funnels buildPlayersForSimulation throwbacks through the same entry handler', async () => {
    const store = createFakeStore();
    const loadPlayerMapperModule = async () => ({
      buildPlayersForSimulation: () => {
        throw new Error('player build failed');
      },
    });

    await expect(executeAdvisorScan({ store, loadPlayerMapperModule })).resolves.toEqual([]);
    expect(store.advisor.error).toBe('player build failed');
    expect(store.advisor.quickRows).toEqual([{ id: 'prev-quick' }]);
    expect(store.advisor.runtime.isRunning).toBe(false);
    expect(store.advisor.runtime.phase).toBe('idle');
  });

  it('handles non-Error rejection reasons (string / plain object)', async () => {
    const stringReasonStore = createFakeStore();
    await expect(
      executeAdvisorScan({
        store: stringReasonStore,
        loadPlayerMapperModule: () => Promise.reject('chunk load failed'),
      }),
    ).resolves.toEqual([]);
    expect(stringReasonStore.advisor.error).toBe('chunk load failed');

    const objectReasonStore = createFakeStore();
    await expect(
      executeAdvisorScan({
        store: objectReasonStore,
        loadPlayerMapperModule: () => Promise.reject({ code: 500 }),
      }),
    ).resolves.toEqual([]);
    expect(objectReasonStore.advisor.error).toBe(JSON.stringify({ code: 500 }));
  });
});

// 预算优化 store actions 测试（模式照 triggerOptimizerStore.test.js）：
//   1) start 校验矩阵（无导入 / 迷宫 / 非单目标 / 缺区域 / busy / 非法设置）；
//   2) busy 闸门（自身 / 他者 / 共享 worker）；
//   3) 成功运行的 input 契约与进度直通、结果写入、报告持久化/恢复；
//   4) apply / revert（快照恢复、手改拒绝、未被涉及的手改不阻止撤销）；
//   5) 指纹过期（stale）；
//   6) stop 的 runId guard 与 reset（含快照恢复触发的重置）。
//
// 搜索模块在 actions 里是动态 import，测试桩必须拦在模块层（同 trigger 的手手法）。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

import { buildBudgetCandidates, ensureBudgetOptimizerCostReference } from '../../services/budgetOptimizerDomain.js';
import { resolveAssetItemValue, resolveEquipmentAssetValue } from '../../services/assetScoreService.js';
import { cancelSharedWorkerRun, runSharedSingleSimulationPayload } from '../../services/simulatorWorkerRuns.js';
import { resolveBudgetOptimizerTeammates } from '../simulatorBudgetOptimizerActions.js';
import { useSimulatorStore } from '../simulatorStore.js';

const controls = vi.hoisted(() => ({ calls: [] }));

vi.mock('../../services/budgetOptimizerSearch.js', () => ({
  optimizeBudgetUpgrades(input, callbacks) {
    return new Promise((resolve) => {
      controls.calls.push({ input, callbacks, resolve });
    });
  },
}));

// 估值链出口注入点（默认直通真实实现）：真实估值链全部分支恒带 source，「有价无 source」
// 只能从模块边界注入；用于锚定 store resolver 的出口归一（缺 source 透传，不臆造哨兵）。
const assetValueOverrides = vi.hoisted(() => ({ resolveEquipment: null, resolveItem: null }));

vi.mock('../../services/assetScoreService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveEquipmentAssetValue(...args) {
      if (assetValueOverrides.resolveEquipment) return assetValueOverrides.resolveEquipment(...args);
      return actual.resolveEquipmentAssetValue(...args);
    },
    resolveAssetItemValue(...args) {
      if (assetValueOverrides.resolveItem) return assetValueOverrides.resolveItem(...args);
      return actual.resolveAssetItemValue(...args);
    },
  };
});

function storageMock() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

// 共享 worker 挂起装置：经真实注册路径（runSharedSingleSimulationPayload + 不结算的客户端桩）
// 让 hasSharedWorkerRunInProgress() 为真，测的是一条真实注册 → 判定可见的链路。
const hangingRuns = [];

class HangingSharedWorkerClient {
  startSimulation() {}
  stopSimulation() {}
}

function startHangingSharedRun() {
  const pending = runSharedSingleSimulationPayload({ id: 1 }, () => {}, {
    workerClient: new HangingSharedWorkerClient(),
  });
  hangingRuns.push(pending.catch(() => {}));
}

beforeEach(() => {
  vi.stubGlobal('localStorage', storageMock());
  setActivePinia(createPinia());
  controls.calls = [];
  assetValueOverrides.resolveEquipment = null;
  assetValueOverrides.resolveItem = null;
});

afterEach(async () => {
  cancelSharedWorkerRun();
  await Promise.all(hangingRuns.splice(0));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function importedStore() {
  const store = useSimulatorStore();
  store.setImportedProfileState('1', true);
  store.simulationSettings.zoneHrid = '/actions/combat/fly';
  return store;
}

// 搜索桩的完成结果：链报告最小结构（v2：steps/totalCost/stopReason/finalSnapshot/finalConfig）。
function makeResult(overrides = {}) {
  return {
    version: 2,
    createdAt: Date.now(),
    elapsedSeconds: 3,
    cancelled: false,
    stopReason: 'exhausted',
    objective: 'dps',
    settings: { budgetCoins: 1_000_000_000, budgetHigh: 1_200_000_000, teammateIds: [] },
    baseline: { metrics: null },
    steps: [],
    totalCost: 0,
    remainingBudget: 0,
    finalSnapshot: null,
    finalConfig: null,
    diagnostics: { skippedNoPrice: 0, candidateCount: 0, stages: [], simulations: 0, evaluations: 0 },
    ...overrides,
  };
}

// 单步链结果装置：在 prepareAbilityCandidateEnvironment 之上构造「BERSERK +10 → +N」一步链的
// 报告（steps[0].candidate.effect 驱动写回快照的 touched 键；finalConfig 是链终点配置）。
function makeAbilityChainResult(candidate, { cancelled = false, stopReason = 'exhausted' } = {}) {
  const level = candidate.effect.level;
  return makeResult({
    cancelled,
    stopReason: cancelled ? 'cancelled' : stopReason,
    steps: [
      {
        index: 0,
        candidate: {
          id: candidate.id,
          kind: 'ability',
          label: candidate.label,
          fromLabel: candidate.fromLabel,
          toLabel: candidate.toLabel,
          effect: candidate.effect,
          fromEffect: candidate.fromEffect,
          cost: candidate.cost,
        },
        cost: candidate.cost,
        deltaObjective: 100,
        deltaDps: 100,
        se: 0,
        baselineBefore: { dps: 100, rounds: 16, failed: false },
        candidatesSnapshot: { candidates: [], total: 1, truncated: 0 },
        remainingBudgetAfter: 1_000_000_000 - candidate.cost,
        elapsedSeconds: 3,
      },
    ],
    totalCost: candidate.cost,
    finalConfig: { equipment: {}, abilities: [{ abilityHrid: BERSERK, level }], houseRooms: {} },
  });
}

// 注意：不能直接 `return pending` —— async 函数会收养返回的 promise，
// 调用方 `await startPending()` 将一直等到搜索被 resolve（而 resolve 在之后）→ 死锁。
// 计数按基线对比：同一用例内二次 start 时，旧调用记录不能让 waitFor 抢跑。
async function startPending(store) {
  const baseline = controls.calls.length;
  const pending = store.startBudgetOptimizer();
  await vi.waitFor(() => expect(controls.calls.length).toBeGreaterThan(baseline), { timeout: 20000 });
  return { pending };
}

async function completeStart(store, result = makeResult()) {
  const { pending } = await startPending(store);
  controls.calls.at(-1).resolve(result);
  await pending;
  return result;
}

const BERSERK = '/abilities/berserk';

// apply/revert 的候选装置：让重建候选能生成 BERSERK 的升级档位 —— 真实经验表（幂等注入）、
// 技能书价格、其余范围关闭（枚举最小化）。返回技能候选列表（id / cost / effect 与运行时同源）。
function prepareAbilityCandidateEnvironment(store) {
  ensureBudgetOptimizerCostReference();
  store.activePlayer.abilities = [{ abilityHrid: BERSERK, level: 10 }];
  store.pricing.priceTable = { '/items/berserk': { ask: 9, bid: 7, vendor: 1 } };
  store.budgetOptimizer.settings = {
    budgetCoins: 1_000_000_000,
    bandRatio: 0.2,
    simulationHours: 24,
    partyPlayerIds: [],
    enableEquipment: false,
    enableAbilities: true,
    enableHouses: false,
    objective: 'dps',
    maxLevelUp: 3,
    maxHouseUp: 5,
    searchPreset: 'standard',
    // 校验以「完整设置对象」为契约（isValid 白名单逐项检查），新增字段必须同步。
    stepLimitMode: 'unlimited',
    maxChainSteps: 10,
  };
  const { candidates } = buildBudgetCandidates({
    playerConfig: store.activePlayer,
    pricingState: store.pricing,
    settings: store.budgetOptimizer.settings,
  });
  return candidates.filter((candidate) => candidate.kind === 'ability' && candidate.effect.abilityHrid === BERSERK);
}

function abilityLevel(store, hrid = BERSERK) {
  return store.activePlayer.abilities.find((ability) => ability.abilityHrid === hrid)?.level;
}

describe('budget optimizer store', () => {
  it('rejects a start without an imported player profile', async () => {
    const store = useSimulatorStore();
    store.simulationSettings.zoneHrid = '/actions/combat/fly';

    await store.startBudgetOptimizer();

    expect(store.budgetOptimizer.runtime.error).toBe('common:budgetOptimizer.requireImport');
    expect(store.budgetOptimizer.runtime.isRunning).toBe(false);
    expect(controls.calls).toHaveLength(0);
  });

  it.each([
    [
      'labyrinth mode',
      (store) => {
        store.setSimulationMode('labyrinth');
      },
      'common:budgetOptimizer.labyrinthUnsupported',
    ],
    [
      'batch run scope',
      (store) => {
        store.setRunScope('all_solo_zones');
      },
      'common:budgetOptimizer.requireSingle',
    ],
    [
      'missing zone',
      (store) => {
        store.simulationSettings.zoneHrid = '';
      },
      'common:budgetOptimizer.requireZone',
    ],
    [
      'another feature loading pricing',
      (store) => {
        store.pricing.isLoading = true;
      },
      'common:budgetOptimizer.busy',
    ],
    [
      'trigger optimizer running',
      (store) => {
        store.triggerOptimizer.runtime.isRunning = true;
      },
      'common:budgetOptimizer.busy',
    ],
    [
      'invalid settings',
      (store) => {
        store.budgetOptimizer.settings = { ...store.budgetOptimizer.settings, budgetCoins: 0 };
      },
      'common:budgetOptimizer.invalidSettings',
    ],
  ])('rejects a start when %s', async (_label, mutate, expectedError) => {
    const store = importedStore();
    mutate(store);

    await store.startBudgetOptimizer();

    expect(store.budgetOptimizer.runtime.error).toBe(expectedError);
    expect(store.budgetOptimizer.runtime.isRunning).toBe(false);
    expect(controls.calls).toHaveLength(0);
  });

  it('reads the queue baselineSaleSide setting into the search input (default bid / ask)', async () => {
    const store = importedStore();
    // 缺省路径：未显式设置时按归一化默认 'bid' 透传（activeQueueState.settings 的缺省口径）。
    const { pending } = await startPending(store);
    expect(controls.calls.at(-1).input.saleSide).toBe('bid');
    controls.calls.at(-1).resolve(makeResult());
    await pending;

    // ask 口径：写入 activeQueueState.settings 后由 startBudgetOptimizer 读取（与队列页/成本
    // 弹窗同源），归一化后透传搜索层，进抵扣取价与指纹（snapshotBudgetOptimizerInput）。
    store.updateActiveQueueSettings({ baselineSaleSide: 'ask' });
    const { pending: askPending } = await startPending(store);
    expect(controls.calls.at(-1).input.saleSide).toBe('ask');
    controls.calls.at(-1).resolve(makeResult());
    await askPending;
  }, 30000);

  it('估值回退 resolver 拒绝 vendor（商店卖店价）源：卖店价不是买入成本（魔术师帽★ 回归）', async () => {
    const store = importedStore();
    // 空行情：魔术师帽★ +20 买入侧除「商店卖店价」外全链无价（真实事故场景）。
    store.pricing.priceTable = {};
    store.pricing.basePriceTable = {};
    store.pricing.enhancementQuotesByItem = {};
    store.pricing.marketItemValues = {};

    const { pending } = await startPending(store);
    const resolver = controls.calls.at(-1).input.fairValueResolver;
    expect(typeof resolver).toBe('function');

    // 佐证底层估值链确实会给出 vendor 卖店价（真实 itemDetailMap.sellPrice = 350 万）：
    // 修复前 resolver 原样透传该伪价，domain 再减旧件实价卖出抵扣后钳成 0 → 「花费 0」假免费。
    expect(resolveEquipmentAssetValue(store.pricing, '/items/magicians_hat_refined', 20, 'head')).toEqual({
      price: 3_500_000,
      source: 'vendor',
    });

    // 修复后：vendor 源按不可得处理 → null（domain 走缺价跳过，不再进入成本计算）。
    expect(resolver('/items/magicians_hat_refined', 20, { kind: 'equipment', slotKey: 'head' })).toBeNull();

    // 非 vendor 源不受影响：官方估算照常返回（+19 档，避开 resolver 的 per-run 记忆化缓存）。
    store.pricing.marketItemValues = { '/items/magicians_hat_refined': { 19: 12345 } };
    const official = resolver('/items/magicians_hat_refined', 19, { kind: 'equipment', slotKey: 'head' });
    expect(official).toMatchObject({ price: 12345, source: 'official_estimate' });

    controls.calls.at(-1).resolve(makeResult());
    await pending;
  }, 30000);

  it('估值回退 resolver 的 vendor 拒绝对 ability（技能书）分链同样生效：与 equipment 过滤口径一致', async () => {
    const store = importedStore();
    // 空行情：berserk 技能书除「商店卖店价」外估值链全无价（冷门书无行情的典型形态）。
    store.pricing.priceTable = {};
    store.pricing.basePriceTable = {};
    store.pricing.enhancementQuotesByItem = {};
    store.pricing.marketItemValues = {};

    const { pending } = await startPending(store);
    const resolver = controls.calls.at(-1).input.fairValueResolver;
    expect(typeof resolver).toBe('function');

    // 佐证底层估值链对技能书同样会落到 vendor 卖店价出口（bookPrice 取真实
    // itemDetailMap.sellPrice，数值随游戏数据版本变化，不锚定具体金额）。
    const vendorValue = resolveAssetItemValue(store.pricing, '/items/berserk', 0);
    expect(vendorValue).toMatchObject({ source: 'vendor' });
    expect(vendorValue.price).toBeGreaterThan(0);

    // 2026-10-16 魔术师帽★修复的 vendor 过滤不区分 context.kind：ability 分链（domain 携
    // { kind: 'ability', abilityHrid }，取价走 resolveAssetItemValue）同样按不可得返回 null
    //（与 equipment 分链的 vendor 拒绝断言同款口径），显式锚定该波及已确认接受。
    expect(resolver('/items/berserk', 0, { kind: 'ability', abilityHrid: '/abilities/berserk' })).toBeNull();

    controls.calls.at(-1).resolve(makeResult());
    await pending;

    // 反向锚定（防过度过滤）：过滤只拦 vendor 源。注入官方估算后重开一轮取新 resolver
    //（绕开上一轮闭包的 per-run 记忆化缓存——同键首次估值结果已固定为 null），ability
    // 分链对非 vendor 源的估值救回能力照常存在。
    store.pricing.marketItemValues = { '/items/berserk': { 0: 12345 } };
    const { pending: secondPending } = await startPending(store);
    const freshResolver = controls.calls.at(-1).input.fairValueResolver;
    const official = freshResolver('/items/berserk', 0, { kind: 'ability', abilityHrid: '/abilities/berserk' });
    expect(official).toMatchObject({ price: 12345, source: 'official_estimate' });

    controls.calls.at(-1).resolve(makeResult());
    await secondPending;
  }, 30000);

  it('估值 resolver 缺 source 透传缺 source（不臆造 fair_value 哨兵）：与域层「缺 source 放行」契约一致', async () => {
    const store = importedStore();
    // 空行情：候选买入侧全链缺价（不是本用例关注点，估值由下方注入强制接管）。
    store.pricing.priceTable = {};
    store.pricing.basePriceTable = {};
    store.pricing.enhancementQuotesByItem = {};
    store.pricing.marketItemValues = {};

    // 强制估值链出口「有价无 source」（真实链全出口恒带 source，此形状为防御分支注入）。
    assetValueOverrides.resolveEquipment = () => ({ price: 1_234_567 });

    const { pending } = await startPending(store);
    const resolver = controls.calls.at(-1).input.fairValueResolver;
    const valued = resolver('/items/magicians_hat_refined', 20, { kind: 'equipment', slotKey: 'head' });

    // 出口原样透传缺 source（而非 { price, source: 'fair_value' }）：域层来源门白名单
    //（BUY_SIDE_ASSET_SCORE_SOURCES 六成员，不含 'fair_value'）只拒绝「非空且不在白名单」的
    // source；臆造哨兵会把缺 source 静默归入「完全缺价」，与 budgetOptimizerDomain.test.js
    //「来源门放行缺 source 的 resolver 返回值」锚定相反。
    expect(valued).toEqual({ price: 1_234_567 });
    expect(valued?.source).toBeUndefined();

    // 反向锚定（防过度修复）：带 source 的出口照常透传（换 level 绕开 per-run 记忆化）。
    assetValueOverrides.resolveEquipment = () => ({ price: 999, source: 'market_quote' });
    expect(resolver('/items/magicians_hat_refined', 19, { kind: 'equipment', slotKey: 'head' })).toEqual({
      price: 999,
      source: 'market_quote',
    });

    controls.calls.at(-1).resolve(makeResult());
    await pending;
  }, 30000);

  it('rejects a second start while its own run is in flight', async () => {
    const store = importedStore();
    const { pending } = await startPending(store);

    await store.startBudgetOptimizer();

    // 自身运行中：第二次 start 直接返回，不会打开第二条运行。
    expect(controls.calls).toHaveLength(1);
    expect(store.budgetOptimizer.runtime.isRunning).toBe(true);

    controls.calls.at(-1).resolve(makeResult());
    await pending;
  }, 30000);

  it('rejects a start while a shared worker run is in flight', async () => {
    const store = importedStore();
    startHangingSharedRun();

    await store.startBudgetOptimizer();

    expect(store.budgetOptimizer.runtime.error).toBe('common:budgetOptimizer.busy');
    expect(store.budgetOptimizer.runtime.isRunning).toBe(false);
    expect(controls.calls).toHaveLength(0);
  });

  it('runs the search with the active player, zone and settings, then stores the fresh result', async () => {
    const store = importedStore();
    const result = makeResult();
    const { pending } = await startPending(store);

    const { input, callbacks } = controls.calls.at(-1);
    expect(input.playerConfig.id).toBe('1');
    expect(input.simulationSettings).toMatchObject({
      mode: 'zone',
      zoneHrid: '/actions/combat/fly',
      useDungeon: false,
      difficultyTier: 0,
      simulationTimeHours: 24,
    });
    expect(input.settings).toEqual(store.budgetOptimizer.settings);
    expect(input.pricing.pricingState).toBeTruthy();
    expect(input.pricing.pricingOptions).toBeTruthy();
    expect(Number.isInteger(input.parallelWorkerLimit)).toBe(true);
    expect(Number.isFinite(input.startedAt)).toBe(true);
    expect(store.budgetOptimizer.runtime.isRunning).toBe(true);
    expect(store.budgetOptimizer.runtime.phase).toBe('preparing');
    // 「服务调用在途」是页面「忙」计算属性的响应式锚点（见 store 的说明）：调用期必须为真。
    expect(store.budgetOptimizer.runtime.serviceRunInFlight).toBe(true);

    // 进度回调直通 runtime（含阶段计数与步数）。
    callbacks.onProgress({
      phase: 'screening',
      progress: 0.4,
      elapsedSeconds: 3,
      evaluated: 12,
      total: 40,
      stepsDone: 1,
    });
    expect(store.budgetOptimizer.runtime).toMatchObject({
      phase: 'screening',
      progress: 0.4,
      elapsedSeconds: 3,
      evaluated: 12,
      total: 40,
      stepsDone: 1,
    });

    // onStep 渐进上报：步骤立刻进入 runtime.chainSteps（UI 运行中读它上屏）。
    callbacks.onStep({ index: 0, cost: 9, candidate: { id: 'ability:x:11' } });
    expect(store.budgetOptimizer.runtime.chainSteps).toHaveLength(1);
    expect(store.budgetOptimizer.runtime.chainSteps[0].cost).toBe(9);

    controls.calls.at(-1).resolve(result);
    await pending;

    expect(store.budgetOptimizer.runtime).toMatchObject({
      isRunning: false,
      phase: 'done',
      progress: 1,
      completionNoticeId: 1,
    });
    expect(store.budgetOptimizer.results.createdAt).toBeTruthy();
    expect(store.budgetOptimizer.results.stale).toBe(false);
    expect(store.budgetOptimizer.results.steps).toEqual(result.steps);
    expect(store.budgetOptimizer.results.totalCost).toBe(result.totalCost);
    // finalConfig 被剥离（写回主角后它就是当前配置的重复品，不入报告）。
    expect(store.budgetOptimizer.results.finalConfig).toBeUndefined();
    expect(store.budgetOptimizerReportStale).toBe(false);
    expect(store.budgetOptimizer.runtime.serviceRunInFlight).toBe(false);
  }, 30000);

  it('writes the chain result back to the active player on completion and reverts it completely', async () => {
    const store = importedStore();
    const candidates = prepareAbilityCandidateEnvironment(store);
    const level11 = candidates.find((candidate) => candidate.effect.level === 11);
    expect(level11).toBeTruthy();

    await completeStart(store, makeAbilityChainResult(level11));

    // 链结束自动写回：主角配置更新 + 一条整链撤销快照 + 应用后指纹。
    expect(abilityLevel(store)).toBe(11);
    const stack = store.budgetOptimizer.baselineSnapshots;
    expect(stack).toHaveLength(1);
    expect(stack[0]).toMatchObject({ playerId: '1' });
    // 快照记录的是**应用前**的三字段全量（撤销恢复的取值来源）。
    expect(stack[0].abilities.find((ability) => ability.abilityHrid === BERSERK)?.level).toBe(10);
    expect(stack[0].touched.abilityHrids).toEqual([BERSERK]);
    expect(store.budgetOptimizer.results.appliedInputSignature).not.toBe('');
    // 应用后指纹与当前输入一致：不是过期报告（否则撤销按钮会立刻消失）。
    expect(store.budgetOptimizerReportStale).toBe(false);

    expect(store.revertBudgetOptimizerChanges()).toBe(true);
    expect(abilityLevel(store)).toBe(10);
    expect(store.budgetOptimizer.baselineSnapshots).toEqual([]);
    expect(store.budgetOptimizer.results.appliedInputSignature).toBe('');
  }, 30000);

  // memo 0366770569446801408：写回按 touched 子集定点修补（与撤销同一套收窄口径）——链运行期间
  // 用户在别处对同一角色三字段的编辑（含链未涉及的槽位/房间）不被静默覆盖，兑现界面 applyHint
  // 的「只覆盖链涉及的装备 / 技能 / 房子键，未涉及的改动不受影响」。
  it('keeps mid-run edits to keys the chain does not touch when writing the chain back', async () => {
    const store = importedStore();
    const candidates = prepareAbilityCandidateEnvironment(store);
    const level11 = candidates.find((candidate) => candidate.effect.level === 11);
    expect(level11).toBeTruthy();

    const { pending } = await startPending(store);

    // 链运行中（resolve 前）改主角身上链未涉及的键：一个装备槽位 + 一个房子房间。
    // 本链的 steps 只涉及技能（BERSERK），slots / rooms 都是空集。
    const player = store.activePlayer;
    player.equipment.helmet = { itemHrid: '/items/regal_sword', enhancementLevel: 4 };
    player.houseRooms['/house_rooms/dojo'] = 3;

    controls.calls.at(-1).resolve(makeAbilityChainResult(level11));
    await pending;

    // touched 键被写成链终点值；未涉及键的运行期手改原样保留（旧行为的整字段覆盖会把它清掉）。
    expect(abilityLevel(store)).toBe(11);
    expect(player.equipment.helmet).toEqual({ itemHrid: '/items/regal_sword', enhancementLevel: 4 });
    expect(player.houseRooms['/house_rooms/dojo']).toBe(3);

    // 撤销口径不变：touched 键回到链起点值，未涉及键的手改依旧不受影响。
    expect(store.revertBudgetOptimizerChanges()).toBe(true);
    expect(abilityLevel(store)).toBe(10);
    expect(player.equipment.helmet).toEqual({ itemHrid: '/items/regal_sword', enhancementLevel: 4 });
    expect(player.houseRooms['/house_rooms/dojo']).toBe(3);
  }, 30000);

  // memo 0366770566183632896：运行中切换主角后收尾，链终点配置必须仍写回**链起点角色**，
  // 不得覆盖新主角；报告相对当前激活角色如实过期（不再被写后指纹掩盖）。
  it('writes the chain back to the player that started the run when the active player changes mid-run', async () => {
    const store = importedStore();
    const candidates = prepareAbilityCandidateEnvironment(store);
    const level11 = candidates.find((candidate) => candidate.effect.level === 11);
    expect(level11).toBeTruthy();

    // 角色 2 的可辨识配置：写回若错投到新主角身上，下面三处深比较会立刻失败。
    const otherPlayer = store.players[1];
    otherPlayer.equipment = { main_hand: { itemHrid: '/items/regal_sword', enhancementLevel: 5 } };
    otherPlayer.abilities = [{ abilityHrid: BERSERK, level: 3 }];
    otherPlayer.houseRooms = { '/house_rooms/dojo': 2 };

    const { pending } = await startPending(store);
    // 链起点角色已在 start 时冻结（先于所有 await 与运行期切换）。
    expect(store.budgetOptimizer.runtime.targetPlayerId).toBe('1');

    // 运行中切换主角：写回目标仍是链起点角色 1。切换会补全角色 2 的默认高级字段
    //（ensurePlayerAdvancedState 给房子补 0 级房间），故「写回前」基准在切换之后再取。
    store.setActivePlayer('2');
    expect(String(store.activePlayerId)).toBe('2');
    expect(otherPlayer.houseRooms['/house_rooms/dojo']).toBe(2);
    const otherBefore = JSON.parse(
      JSON.stringify({
        equipment: otherPlayer.equipment,
        abilities: otherPlayer.abilities,
        houseRooms: otherPlayer.houseRooms,
      }),
    );

    controls.calls.at(-1).resolve(makeAbilityChainResult(level11));
    await pending;

    // 新主角三字段原样保留（未被链终点配置覆盖）。
    expect(otherPlayer.equipment).toEqual(otherBefore.equipment);
    expect(otherPlayer.abilities).toEqual(otherBefore.abilities);
    expect(otherPlayer.houseRooms).toEqual(otherBefore.houseRooms);
    // 链终点写回链起点角色 1。
    expect(store.players[0].abilities.find((ability) => ability.abilityHrid === BERSERK)?.level).toBe(11);
    // 撤销快照指向链起点角色（撤销目标与写回目标一致）。
    expect(store.budgetOptimizer.baselineSnapshots).toHaveLength(1);
    expect(store.budgetOptimizer.baselineSnapshots[0].playerId).toBe('1');
    // 报告不属于当前视角：不记应用后指纹、显式过期、给出用户提示。
    expect(store.budgetOptimizer.results.appliedInputSignature).toBe('');
    expect(store.budgetOptimizer.results.stale).toBe(true);
    expect(store.budgetOptimizerReportStale).toBe(true);
    expect(store.budgetOptimizer.runtime.error).toBe('common:budgetOptimizer.appliedToOtherPlayer');

    // 撤销恢复角色 1（退回链起点 +10），角色 2 全程不变。
    expect(store.revertBudgetOptimizerChanges()).toBe(true);
    expect(store.players[0].abilities.find((ability) => ability.abilityHrid === BERSERK)?.level).toBe(10);
    expect(otherPlayer.equipment).toEqual(otherBefore.equipment);
    expect(otherPlayer.abilities).toEqual(otherBefore.abilities);
    expect(otherPlayer.houseRooms).toEqual(otherBefore.houseRooms);
  }, 30000);

  it('does not write back a zero-step chain (nothing affordable)', async () => {
    const store = importedStore();
    const candidates = prepareAbilityCandidateEnvironment(store);
    const level11 = candidates.find((candidate) => candidate.effect.level === 11);
    expect(level11).toBeTruthy();

    // steps 为空 + finalConfig 存在：零步链不写回（无快照、无应用指纹）。
    await completeStart(store, makeResult({ finalConfig: { abilities: [{ abilityHrid: BERSERK, level: 11 }] } }));

    expect(abilityLevel(store)).toBe(10);
    expect(store.budgetOptimizer.baselineSnapshots).toEqual([]);
    expect(store.budgetOptimizer.results.appliedInputSignature).toBe('');
  }, 30000);

  it('blocks revert when the applied fields were edited by hand, and keeps the edit intact', async () => {
    const store = importedStore();
    const candidates = prepareAbilityCandidateEnvironment(store);
    const level11 = candidates.find((candidate) => candidate.effect.level === 11);

    await completeStart(store, makeAbilityChainResult(level11));
    expect(abilityLevel(store)).toBe(11);

    // 应用后被手改：撤销会把这些键写回应用前，手工改动会被踩掉 → 拒绝。
    store.activePlayer.abilities.find((ability) => ability.abilityHrid === BERSERK).level = 99;

    expect(store.revertBudgetOptimizerChanges()).toBe(false);
    expect(store.budgetOptimizer.runtime.error).toBe('common:budgetOptimizer.revertBlockedEdited');
    expect(abilityLevel(store)).toBe(99);
    expect(store.budgetOptimizer.baselineSnapshots).toHaveLength(1);
  }, 30000);

  it('marks results stale when inputs change: revert still available for untouched keys', async () => {
    const store = importedStore();
    const candidates = prepareAbilityCandidateEnvironment(store);
    const level11 = candidates.find((candidate) => candidate.effect.level === 11);

    await completeStart(store, makeAbilityChainResult(level11));

    // 改一个链没碰过的字段（等级）：指纹变化 → 报告过期。
    const staminaBefore = store.activePlayer.levels.stamina;
    store.activePlayer.levels.stamina = staminaBefore + 1;

    expect(store.budgetOptimizerReportStale).toBe(true);
    // 撤销只覆盖被链涉及的键（技能），等级手改不阻止撤销、也不被撤销踩掉。
    expect(store.revertBudgetOptimizerChanges()).toBe(true);
    expect(store.budgetOptimizer.baselineSnapshots).toEqual([]);
    expect(store.activePlayer.levels.stamina).toBe(staminaBefore + 1);
  }, 30000);

  it('blocks revert while another feature run is in flight', async () => {
    const store = importedStore();
    const candidates = prepareAbilityCandidateEnvironment(store);
    const level11 = candidates.find((candidate) => candidate.effect.level === 11);

    await completeStart(store, makeAbilityChainResult(level11));
    const appliedLevel = abilityLevel(store);
    // 浅拷贝数组（元素引用同）：撤销若写出，长度或内容会偏离。
    const snapshotsBefore = [...store.budgetOptimizer.baselineSnapshots];

    store.pricing.isLoading = true;

    expect(store.revertBudgetOptimizerChanges()).toBe(false);
    expect(store.budgetOptimizer.runtime.error).toBe('common:budgetOptimizer.busy');
    // 玩家配置与撤销栈都必须原样保留（撤销没有写回）。
    expect(abilityLevel(store)).toBe(appliedLevel);
    expect(store.budgetOptimizer.baselineSnapshots).toEqual(snapshotsBefore);

    store.pricing.isLoading = false;
    expect(store.revertBudgetOptimizerChanges()).toBe(true);
    expect(store.budgetOptimizer.baselineSnapshots).toEqual([]);
  }, 30000);

  it('reverts chain by chain: two chains unwind one at a time', async () => {
    const store = importedStore();
    const candidates = prepareAbilityCandidateEnvironment(store);
    const level11 = candidates.find((candidate) => candidate.effect.level === 11);
    const level12 = candidates.find((candidate) => candidate.effect.level === 12);
    expect(level11).toBeTruthy();
    expect(level12).toBeTruthy();

    // 第一条链：写回 +11。
    await completeStart(store, makeAbilityChainResult(level11));
    expect(abilityLevel(store)).toBe(11);
    expect(store.budgetOptimizer.baselineSnapshots).toHaveLength(1);

    // 第二条链（模拟再点一次「开始」续跑）：不清撤销栈；写回 +12。
    await completeStart(store, makeAbilityChainResult(level12));
    expect(store.budgetOptimizer.baselineSnapshots).toHaveLength(2);
    expect(abilityLevel(store)).toBe(12);

    // 逐链回退：先回 +11，再回起点 +10；回到起点后再撤销 → 无记录。
    expect(store.revertBudgetOptimizerChanges()).toBe(true);
    expect(abilityLevel(store)).toBe(11);
    expect(store.budgetOptimizer.baselineSnapshots).toHaveLength(1);
    expect(store.revertBudgetOptimizerChanges()).toBe(true);
    expect(abilityLevel(store)).toBe(10);
    expect(store.budgetOptimizer.baselineSnapshots).toEqual([]);
    expect(store.revertBudgetOptimizerChanges()).toBe(false);
    expect(store.budgetOptimizer.runtime.error).toBe('common:budgetOptimizer.noChangesToRevert');
  }, 30000);

  it('cancelled chain still writes back completed steps (accepting partial progress)', async () => {
    const store = importedStore();
    const candidates = prepareAbilityCandidateEnvironment(store);
    const level11 = candidates.find((candidate) => candidate.effect.level === 11);

    await completeStart(store, makeAbilityChainResult(level11, { cancelled: true }));

    // 取消的链：已应用步骤是既成事实 → 照常写回 + 快照（撤销可整体退回）。
    expect(store.budgetOptimizer.runtime.phase).toBe('cancelled');
    expect(abilityLevel(store)).toBe(11);
    expect(store.budgetOptimizer.baselineSnapshots).toHaveLength(1);
    expect(store.revertBudgetOptimizerChanges()).toBe(true);
    expect(abilityLevel(store)).toBe(10);
  }, 30000);

  it('rejects revert without a snapshot', () => {
    const store = importedStore();

    expect(store.revertBudgetOptimizerChanges()).toBe(false);
    expect(store.budgetOptimizer.runtime.error).toBe('common:budgetOptimizer.noChangesToRevert');
  });

  it('refuses revert and writes nothing when the snapshot player no longer exists', async () => {
    const store = importedStore();
    const candidates = prepareAbilityCandidateEnvironment(store);
    const level11 = candidates.find((candidate) => candidate.effect.level === 11);
    expect(level11).toBeTruthy();

    await completeStart(store, makeAbilityChainResult(level11));
    expect(abilityLevel(store)).toBe(11);
    expect(store.budgetOptimizer.baselineSnapshots).toHaveLength(1);

    // 防御分支锚定：快照 playerId 指向玩家表中不存在的 id（玩家槽位常驻、id 稳定，正常流程到不了
    // 这里；一旦到达，撤销不得把快照值写到别的玩家身上——与写回侧「找不到即放弃」口径对偶）。
    store.budgetOptimizer.baselineSnapshots[0].playerId = '999';
    const playersBefore = store.players.map((player) =>
      JSON.stringify({ equipment: player.equipment, abilities: player.abilities, houseRooms: player.houseRooms }),
    );

    expect(store.revertBudgetOptimizerChanges()).toBe(false);
    expect(store.budgetOptimizer.runtime.error).toBe('common:budgetOptimizer.revertTargetUnavailable');
    // 未弹栈、未清应用指纹、未写任何玩家的三字段（零写入）。
    expect(store.budgetOptimizer.baselineSnapshots).toHaveLength(1);
    expect(store.budgetOptimizer.results.appliedInputSignature).not.toBe('');
    const playersAfter = store.players.map((player) =>
      JSON.stringify({ equipment: player.equipment, abilities: player.abilities, houseRooms: player.houseRooms }),
    );
    expect(playersAfter).toEqual(playersBefore);
  }, 30000);

  it('persists settings changes and flags the completed result stale', async () => {
    const store = importedStore();
    await completeStart(store);

    expect(store.setBudgetOptimizerSettings({ budgetCoins: 2_000_000_000 })).toBe(true);
    expect(store.budgetOptimizer.settings.budgetCoins).toBe(2_000_000_000);
    expect(store.budgetOptimizer.results.stale).toBe(true);
    expect(store.budgetOptimizerReportStale).toBe(true);

    // 落盘可回读（simulatorStorage 的版本化键）。
    const raw = JSON.parse(global.localStorage.getItem('mwi.budgetOptimizer.settings.v1'));
    expect(raw.budgetCoins).toBe(2_000_000_000);
    expect(raw.version).toBe(1);
  }, 30000);

  it('defaults to the profit objective, switches it through settings, persists and flags results stale', async () => {
    const store = importedStore();
    // 默认目标：利润（归一化缺省；切换到非默认值验证写盘与过期）。
    expect(store.budgetOptimizer.settings.objective).toBe('profit');
    await completeStart(store);

    expect(store.setBudgetOptimizerSettings({ objective: 'xp' })).toBe(true);
    expect(store.budgetOptimizer.settings.objective).toBe('xp');
    expect(store.budgetOptimizerReportStale).toBe(true);

    const raw = JSON.parse(global.localStorage.getItem('mwi.budgetOptimizer.settings.v1'));
    expect(raw.objective).toBe('xp');

    // 非法目标被归一化白名单拒绝：设置保持不变。
    expect(store.setBudgetOptimizerSettings({ objective: 'gold' })).toBe(false);
    expect(store.budgetOptimizer.settings.objective).toBe('xp');
  }, 30000);

  it('persists the simulation step limit (mode + steps); invalid modes are rejected', async () => {
    const store = importedStore();
    // 默认「用完预算」（unlimited，旧行为：上限 = 安全阀 40）。
    expect(store.budgetOptimizer.settings.stepLimitMode).toBe('unlimited');
    await completeStart(store);

    expect(store.setBudgetOptimizerSettings({ stepLimitMode: 'custom', maxChainSteps: 5 })).toBe(true);
    expect(store.budgetOptimizer.settings.stepLimitMode).toBe('custom');
    expect(store.budgetOptimizer.settings.maxChainSteps).toBe(5);
    const raw = JSON.parse(global.localStorage.getItem('mwi.budgetOptimizer.settings.v1'));
    expect(raw.stepLimitMode).toBe('custom');
    expect(raw.maxChainSteps).toBe(5);

    // 非法模式被白名单拒绝：设置保持不变。
    expect(store.setBudgetOptimizerSettings({ stepLimitMode: 'deluxe' })).toBe(false);
    expect(store.budgetOptimizer.settings.stepLimitMode).toBe('custom');
  }, 30000);

  it('rejects fractional integer fields the same way the UI draft validation does', () => {
    const store = importedStore();
    // memo 0366808714871685120：整数字段传小数被 isValid 拒绝（与页面 validDraft 同源同结论），
    // 不再被归一化静默 floor 落盘 —— 设置保持原值。
    const previous = store.budgetOptimizer.settings.simulationHours;
    expect(store.setBudgetOptimizerSettings({ simulationHours: 3.5 })).toBe(false);
    expect(store.budgetOptimizer.settings.simulationHours).toBe(previous);
  });

  it('resolves party teammates from settings and binds them into the run and fingerprint', async () => {
    const store = importedStore();
    // 队友槽位须先导入真数据：players 2-5 常驻但默认空配置，幽灵队友防御只认
    // importedProfileByPlayer 标记为 true 的槽位（见下一用例）。
    store.setImportedProfileState('2', true);
    expect(store.setBudgetOptimizerPartyPlayers(['2', '2', '1', '9'])).toBe(true);
    // 归一化：去重 + 保序；主角（'1'）与未知 id（'9'）允许留在集合里，解析时排除。
    expect(store.budgetOptimizer.settings.partyPlayerIds).toEqual(['2', '1', '9']);

    const teammates = resolveBudgetOptimizerTeammates(store);
    expect(teammates.map((player) => String(player.id))).toEqual(['2']);
    expect(teammates[0]).not.toBe(store.players[1]); // 冻结副本：不是 Pinia 的响应式对象

    const { pending } = await startPending(store);
    expect(controls.calls.at(-1).input.teammates.map((player) => String(player.id))).toEqual(['2']);

    controls.calls.at(-1).resolve(makeResult());
    await pending;
    expect(store.budgetOptimizerReportStale).toBe(false);

    // 换队友 ⇒ 既有报告立即过期（与设置变更同款语义）。
    expect(store.setBudgetOptimizerPartyPlayers(['2', '3'])).toBe(true);
    expect(store.budgetOptimizerReportStale).toBe(true);
  }, 30000);

  // 幽灵队友防御（2026-10-04）：勾选残留但队友槽位未导入（刷新后数据已丢）时，
  // 空配置玩家不得混进整队模拟 —— resolve 直接过滤，运行按单人载荷进行。
  it('skips unimported party slots when resolving teammates (ghost teammate guard)', () => {
    const store = importedStore();
    expect(store.setBudgetOptimizerPartyPlayers(['2', '3'])).toBe(true);

    const teammates = resolveBudgetOptimizerTeammates(store);
    expect(teammates).toEqual([]);
  });

  // 勾选不落盘（2026-10-04）：队友配置数据是会话级的，勾选状态随会话丢弃；
  // 刷新后 store 从存储 hydrate，partyPlayerIds 必为空（残留的旧存档也被清空）。
  it('does not persist party player selection across sessions', () => {
    const store = importedStore();
    store.setImportedProfileState('2', true);
    expect(store.setBudgetOptimizerPartyPlayers(['2'])).toBe(true);
    expect(store.budgetOptimizer.settings.partyPlayerIds).toEqual(['2']);

    const raw = JSON.parse(global.localStorage.getItem('mwi.budgetOptimizer.settings.v1'));
    expect(raw.partyPlayerIds).toEqual([]);

    // 新会话（同一 localStorage、新 Pinia）hydrate：勾选回落空（= 单人）。
    setActivePinia(createPinia());
    const fresh = useSimulatorStore();
    expect(fresh.budgetOptimizer.settings.partyPlayerIds).toEqual([]);

    // 旧存档里手工塞入勾选（模拟升级前的残留），load 也强制清空。
    global.localStorage.setItem(
      'mwi.budgetOptimizer.settings.v1',
      JSON.stringify({ ...raw, partyPlayerIds: ['2', '3'], version: 1 }),
    );
    setActivePinia(createPinia());
    const legacy = useSimulatorStore();
    expect(legacy.budgetOptimizer.settings.partyPlayerIds).toEqual([]);
  });

  // 停止收尾（2026-10-06 修复）：stop 顶掉 runId 后，搜索层把已完成步骤收敛成取消报告 resolve
  // 回来（不抛错）——store 必须写入 results 并照常写回（既成事实），否则 UI 数据源从
  // runtime.chainSteps 切回 results.steps 时「已搜出的步骤」整段消失。
  it('stop cancels the run; the cancelled report with completed steps is kept and written back', async () => {
    const store = importedStore();
    const candidates = prepareAbilityCandidateEnvironment(store);
    const level11 = candidates.find((candidate) => candidate.effect.level === 11);
    expect(level11).toBeTruthy();
    const { pending } = await startPending(store);

    // 已完成一步（渐进上报，UI 运行中读 chainSteps）后，进度上报一次再点「停止」。
    controls.calls.at(-1).callbacks.onStep({ index: 0, cost: 9, candidate: { id: 'ability:x:11' } });
    controls.calls.at(-1).callbacks.onProgress({ progress: 0.42 });
    store.stopBudgetOptimizer();
    expect(store.budgetOptimizer.runtime).toMatchObject({ isRunning: false, phase: 'cancelled' });
    // 页面的「收尾窗口」判别依赖本字段：stop 返回瞬间服务调用仍在收尾，它必须仍为真
    //（页面靠它区分「自家收尾」与「被其他任务占用」）。
    expect(store.budgetOptimizer.runtime.serviceRunInFlight).toBe(true);
    // 进度读数保留（2026-10-09）：停止不再把 progress 置 0，收尾窗口内进度条不回零。
    expect(store.budgetOptimizer.runtime.progress).toBeCloseTo(0.42, 5);

    controls.calls.at(-1).resolve(makeAbilityChainResult(level11, { cancelled: true }));
    await pending;

    // 取消收尾：取消报告写入 results（结束后 UI 读 results.steps），已搜出的步骤保留。
    expect(store.budgetOptimizer.runtime.phase).toBe('cancelled');
    expect(store.budgetOptimizer.results.createdAt).toBeTruthy();
    expect(store.budgetOptimizer.results.cancelled).toBe(true);
    expect(store.budgetOptimizer.results.steps).toHaveLength(1);
    expect(store.budgetOptimizer.results.stale).toBe(false);
    // 写回照常进行（已应用步骤是既成事实）+ 一条整链撤销快照。
    expect(abilityLevel(store)).toBe(11);
    expect(store.budgetOptimizer.baselineSnapshots).toHaveLength(1);
    // 取消不算完成：不触发完成通知。
    expect(store.budgetOptimizer.runtime.completionNoticeId).toBe(0);
  }, 30000);

  // runId 闸门的另一半语义不变：迟到的**非取消**结果（停止后服务层异常路径漏出的 resolve）
  // 依旧丢弃，不落进停止后的空结果。
  it('a late non-cancelled result after stop stays dropped by the runId guard', async () => {
    const store = importedStore();
    const { pending } = await startPending(store);

    store.stopBudgetOptimizer();

    controls.calls.at(-1).resolve(makeResult());
    await pending;

    expect(store.budgetOptimizer.runtime.phase).toBe('cancelled');
    expect(store.budgetOptimizer.results.createdAt).toBeFalsy();
    expect(store.budgetOptimizer.runtime.completionNoticeId).toBe(0);
  }, 30000);

  // 停止 → 保留取消报告 → 再点开始（用户「停一下看看、再从当前配置续跑」的完整回路）：
  // 新链入口照常清空旧取消报告（results / chainSteps），旧数据不串进新链。
  it('starts a fresh run after a kept cancelled report, clearing it at entrance', async () => {
    const store = importedStore();
    const candidates = prepareAbilityCandidateEnvironment(store);
    const level11 = candidates.find((candidate) => candidate.effect.level === 11);
    const first = await startPending(store);
    store.stopBudgetOptimizer();
    controls.calls[0].resolve(makeAbilityChainResult(level11, { cancelled: true }));
    await first.pending;
    expect(store.budgetOptimizer.results.cancelled).toBe(true);

    const second = await startPending(store);
    expect(store.budgetOptimizer.runtime.isRunning).toBe(true);
    // 新链入口清空：旧取消报告不再上屏，步骤区跟随新链。
    expect(store.budgetOptimizer.results.createdAt).toBeFalsy();
    expect(store.budgetOptimizer.runtime.chainSteps).toEqual([]);

    controls.calls[1].resolve(makeResult());
    await second.pending;
    expect(store.budgetOptimizer.results.createdAt).toBeTruthy();
    expect(store.budgetOptimizer.runtime.phase).toBe('done');
  }, 30000);

  // 预检失败不吞旧报告（memo 0366940866278162432）：start 的同步段已越过入口预检（一次互斥检查），
  // 之后挂起共享 worker，让动态导入 resolve 后的二次互斥检查命中失败 —— 上一份报告必须仍在。
  it('keeps the previous report when a post-precheck busy guard rejects the start', async () => {
    const store = importedStore();
    await completeStart(store, makeResult());
    const previousCreatedAt = store.budgetOptimizer.results.createdAt;
    expect(previousCreatedAt).toBeTruthy();

    const pending = store.startBudgetOptimizer();
    startHangingSharedRun();
    await pending;

    expect(store.budgetOptimizer.runtime.error).toBe('common:budgetOptimizer.busy');
    expect(store.budgetOptimizer.runtime.isRunning).toBe(false);
    expect(store.budgetOptimizer.results.createdAt).toBe(previousCreatedAt);
    expect(controls.calls).toHaveLength(1);
  }, 30000);

  // reset（导入新存档/恢复快照）停掉的搜索：迟到取消报告必须丢弃 —— 玩家配置已被新存档
  // 整体替换，旧链 finalConfig 的写回会污染新配置（reset 清掉 cancelRequested 关闭放行判据）。
  it('drops the late cancelled report when resetBudgetOptimizerResults stops a running search', async () => {
    const store = importedStore();
    const candidates = prepareAbilityCandidateEnvironment(store);
    const level11 = candidates.find((candidate) => candidate.effect.level === 11);
    const { pending } = await startPending(store);

    store.resetBudgetOptimizerResults();
    expect(store.budgetOptimizer.runtime.phase).toBe('idle');

    controls.calls.at(-1).resolve(makeAbilityChainResult(level11, { cancelled: true }));
    await pending;

    expect(store.budgetOptimizer.results.createdAt).toBeFalsy();
    expect(abilityLevel(store)).toBe(10);
    expect(store.budgetOptimizer.baselineSnapshots).toEqual([]);
  }, 30000);

  // 收尾窗口内的 reset（停止后、迟到取消报告 resolve 前）：isRunning 已被 stop 置假，闸门分支
  // 不得依赖它 —— cancelRequested 若残留为真，迟到的取消报告会被放行写回，把旧链 finalConfig
  // 污染到已被整体替换的新存档玩家上。修复后 reset 在条件外无条件关闭放行判据（布尔
  // cancelRequested + 世代 cancelledRunId），报告整体丢弃：不写 results、不改玩家、不留快照。
  it('drops the late cancelled report when reset lands inside the stop winding-down window', async () => {
    const store = importedStore();
    const candidates = prepareAbilityCandidateEnvironment(store);
    const level11 = candidates.find((candidate) => candidate.effect.level === 11);
    const { pending } = await startPending(store);

    store.stopBudgetOptimizer();
    expect(store.budgetOptimizer.runtime.isRunning).toBe(false);
    expect(store.budgetOptimizer.runtime.serviceRunInFlight).toBe(true);
    store.resetBudgetOptimizerResults();

    controls.calls.at(-1).resolve(makeAbilityChainResult(level11, { cancelled: true }));
    await pending;

    expect(store.budgetOptimizer.results.createdAt).toBeFalsy();
    expect(abilityLevel(store)).toBe(10);
    expect(store.budgetOptimizer.baselineSnapshots).toEqual([]);
  }, 30000);

  it('resets session results when a player data snapshot is restored', async () => {
    const store = importedStore();
    await completeStart(store);
    expect(store.budgetOptimizer.results.createdAt).toBeTruthy();

    // 空玩家配置不算「有意义的快照」（simulatorStorage 的 hasMeaningful 校验会过滤掉），
    // 先做一次真实改动再保存。
    store.players[0].levels.stamina = 77;
    expect((await store.savePlayerDataSnapshot()).ok).toBe(true);
    store.players[0].levels.stamina = 1;
    expect((await store.loadPlayerDataSnapshot()).ok).toBe(true);
    expect(store.players[0].levels.stamina).toBe(77);

    expect(store.budgetOptimizer.results.createdAt).toBeFalsy();
    expect(store.budgetOptimizer.baselineSnapshots).toEqual([]);
    expect(store.budgetOptimizer.runtime.error).toBe('');
  }, 30000);

  it('clears the revert stack when a player data snapshot is restored', async () => {
    const store = importedStore();
    const candidates = prepareAbilityCandidateEnvironment(store);
    const level11 = candidates.find((candidate) => candidate.effect.level === 11);
    await completeStart(store, makeAbilityChainResult(level11));
    expect(store.budgetOptimizer.baselineSnapshots).toHaveLength(1);

    // 导入/恢复新存档：配置整体被替换，旧撤销栈随之作废。
    store.players[0].levels.stamina = 77;
    expect((await store.savePlayerDataSnapshot()).ok).toBe(true);
    store.players[0].levels.stamina = 1;
    expect((await store.loadPlayerDataSnapshot()).ok).toBe(true);

    expect(store.budgetOptimizer.baselineSnapshots).toEqual([]);
  }, 30000);

  it('persists the finished report and restores it in a fresh store', async () => {
    const store = importedStore();
    await completeStart(store, makeResult());
    await nextTick();

    const createdAt = store.budgetOptimizer.results.createdAt;
    expect(createdAt).toBeTruthy();
    const raw = localStorage.getItem('mwi.budgetOptimizer.report.v1');
    expect(raw).toBeTruthy();
    const stored = JSON.parse(raw);
    expect(stored.version).toBe(1);
    expect(stored.report.createdAt).toBe(createdAt);

    // 模拟刷新/重进：全新 pinia + 全新 store，state 工厂从存储 hydrate 最近一份报告。
    setActivePinia(createPinia());
    const restored = useSimulatorStore();
    expect(restored.budgetOptimizer.results.createdAt).toBe(createdAt);
  }, 60000);

  it('keeps the stored report when results are cleared, and deletes it only on explicit reset', async () => {
    const store = importedStore();
    await completeStart(store, makeResult());
    await nextTick();
    expect(localStorage.getItem('mwi.budgetOptimizer.report.v1')).toBeTruthy();

    store.budgetOptimizer.results = {};
    await nextTick();
    expect(localStorage.getItem('mwi.budgetOptimizer.report.v1')).toBeTruthy();

    // 空结果自带 createdAt: 0（createEmptyBudgetOptimizerResult 形状）——同样既不覆盖也不删除存档。
    store.budgetOptimizer.results = { createdAt: 0, stale: false };
    await nextTick();
    expect(localStorage.getItem('mwi.budgetOptimizer.report.v1')).toBeTruthy();

    store.resetBudgetOptimizerResults();
    await nextTick();
    expect(localStorage.getItem('mwi.budgetOptimizer.report.v1')).toBeNull();
  }, 60000);
});

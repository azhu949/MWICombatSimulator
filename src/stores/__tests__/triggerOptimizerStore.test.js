import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

import abilityDetailMap from '../../combatsimulator/data/abilityDetailMap.json';
import { resolveTriggerOptimizerPresetId } from '../../services/triggerOptimizerDomain.js';
import { resolveTriggerOptimizerTeammates } from '../simulatorTriggerOptimizerActions.js';
import { useSimulatorStore } from '../simulatorStore.js';

const SELF = '/combat_trigger_dependencies/self';
const CURRENT_HP = '/combat_trigger_conditions/current_hp';
const LTE = '/combat_trigger_comparators/less_than_equal';

// 搜索引擎在 actions 里是动态 import，测试桩必须拦在模块层
//（同 foodOptimizerStore.test.js 对 foodOptimizerSearch 的手法）。
const controls = vi.hoisted(() => ({
  calls: [],
  robustnessCalls: [],
  // 复核追加（2026-09-26，设计 §51）：与首跑复核是**同一个 store 动作的两态**，但走服务层的
  // 另一个导出 —— 单独一只桶，用例据此分清「首跑」与「追加」各被调了几次。
  robustnessAppendCalls: [],
  appendCalls: [],
}));

vi.mock('../../services/triggerOptimizerSearch.js', () => ({
  optimizeTriggers(input, callbacks) {
    return new Promise((resolve) => {
      controls.calls.push({ input, callbacks, resolve });
    });
  },
  // 换难度复核（2026-09-23，设计 §29）走同一个模块的动态 import，必须一并打桩。
  verifyTriggerOptimizerRobustness(input, options) {
    return new Promise((resolve) => {
      controls.robustnessCalls.push({ input, options, resolve });
    });
  },
  // 追加复验（2026-09-24，设计 §31）同上：动态 import 的**每个**用到的导出都得打桩，
  // 漏一个就是 undefined（调用时报「不是函数」，而不是安静地走真实实现）。
  appendTriggerOptimizerVerification(input, options) {
    return new Promise((resolve) => {
      controls.appendCalls.push({ input, options, resolve });
    });
  },
  // 复核追加（2026-09-26，设计 §51）同上：store 的两态编排里动态 import 解构出的**每一个**
  // 导出都得在桩里 —— 漏一个会让整条 import 抛错（被 store 的 catch 吃掉，表现为「点了复核
  // 却什么都没发生」，比「报错」更难查）。
  appendTriggerOptimizerRobustness(input, options) {
    return new Promise((resolve) => {
      controls.robustnessAppendCalls.push({ input, options, resolve });
    });
  },
}));

function storageMock() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', storageMock());
  setActivePinia(createPinia());
  controls.calls = [];
  controls.robustnessCalls = [];
  controls.robustnessAppendCalls = [];
  controls.appendCalls = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function listAbilitiesWithDefaultTriggers(count) {
  return Object.values(abilityDetailMap)
    .filter(
      (entry) =>
        entry?.isSpecialAbility !== true &&
        Array.isArray(entry?.defaultCombatTriggers) &&
        entry.defaultCombatTriggers.length > 0,
    )
    .slice(0, count)
    .map((entry) => entry.hrid);
}

const [ABILITY_HRID, SECOND_ABILITY_HRID] = listAbilitiesWithDefaultTriggers(2);

function customTrigger(value) {
  return { dependencyHrid: SELF, conditionHrid: CURRENT_HP, comparatorHrid: LTE, value };
}

function importedStore() {
  const store = useSimulatorStore();
  store.setImportedProfileState('1', true);
  store.simulationSettings.zoneHrid = '/actions/combat/fly';
  return store;
}

// 搜索桩的完成结果：ABILITY_HRID 换新触发器；SECOND_ABILITY_HRID 缺席
//（default 态 → apply 时删键）。
function makeResult(overrides = {}) {
  return {
    cancelled: false,
    rounds: 2,
    perAbilityChoices: [
      { slotIndex: 1, abilityHrid: ABILITY_HRID, role: 'damage', candidates: [], chosen: null },
      { slotIndex: 2, abilityHrid: SECOND_ABILITY_HRID, role: 'buff', candidates: [], chosen: null },
    ],
    metricsByCandidate: {},
    baselineMetrics: { dps: 1, dailyNoRngProfit: 0, xpPerHour: 100, killsPerHour: 1, deathsPerHour: 0 },
    bestTriggerMap: { [ABILITY_HRID]: [customTrigger(500)] },
    improvement: { scoreDelta: 0.25 },
    evaluations: 12,
    maxConcurrentWorkers: 2,
    workerLimit: 2,
    elapsedSeconds: 6,
    error: '',
    ...overrides,
  };
}

// 注意：不能直接 `return pending` —— async 函数会收养返回的 promise，
// 调用方 `await startPending()` 将一直等到搜索被 resolve（而 resolve 在之后）→ 死锁。
// 因此返回普通对象包装。
async function startPending(store) {
  const pending = store.startTriggerOptimizer();
  // playerMapper 冷加载 + 构建模拟玩家需要数秒（首个用例尤甚），给足等待预算。
  await vi.waitFor(() => expect(controls.calls.length).toBeGreaterThan(0), { timeout: 20000 });
  return { pending };
}

async function completeStart(store, result = makeResult()) {
  const { pending } = await startPending(store);
  controls.calls.at(-1).resolve(result);
  await pending;
  return result;
}

describe('trigger optimizer store', () => {
  it('rejects a start without an imported player profile', async () => {
    const store = useSimulatorStore();
    store.simulationSettings.zoneHrid = '/actions/combat/fly';

    await store.startTriggerOptimizer();

    expect(store.triggerOptimizer.runtime.error).toBe('common:triggerOptimizer.requireImport');
    expect(store.triggerOptimizer.runtime.isRunning).toBe(false);
    expect(controls.calls).toHaveLength(0);
  });

  it.each([
    [
      'labyrinth mode',
      (store) => {
        store.setSimulationMode('labyrinth');
      },
      'common:triggerOptimizer.labyrinthUnsupported',
    ],
    [
      'batch run scope',
      (store) => {
        store.setRunScope('all_solo_zones');
      },
      'common:triggerOptimizer.requireSingle',
    ],
    [
      'missing zone',
      (store) => {
        store.simulationSettings.zoneHrid = '';
      },
      'common:triggerOptimizer.requireZone',
    ],
    [
      'another feature loading pricing',
      (store) => {
        store.pricing.isLoading = true;
      },
      'common:triggerOptimizer.busy',
    ],
  ])('rejects a start when %s', async (_label, mutate, expectedError) => {
    const store = importedStore();
    mutate(store);

    await store.startTriggerOptimizer();

    expect(store.triggerOptimizer.runtime.error).toBe(expectedError);
    expect(store.triggerOptimizer.runtime.isRunning).toBe(false);
    expect(controls.calls).toHaveLength(0);
  });

  it('runs the search with the active player, zone and weights, then stores the fresh result', async () => {
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
    });
    expect(input.weights).toEqual(store.triggerOptimizer.settings.objectiveWeights);
    expect(Number.isInteger(input.parallelWorkerLimit)).toBe(true);
    expect(store.triggerOptimizer.runtime.isRunning).toBe(true);
    expect(store.triggerOptimizer.runtime.phase).toBe('preparing');
    // 「服务调用在途」是页面「忙」计算属性的响应式锚点（见 store 的说明）：调用期必须为真。
    expect(store.triggerOptimizer.runtime.serviceRunInFlight).toBe(true);

    // 进度回调直通 runtime。
    callbacks.onProgress({ phase: 'searching', progress: 0.4, elapsedSeconds: 3 });
    expect(store.triggerOptimizer.runtime).toMatchObject({
      phase: 'searching',
      progress: 0.4,
      elapsedSeconds: 3,
    });

    controls.calls.at(-1).resolve(result);
    await pending;

    expect(store.triggerOptimizer.runtime).toMatchObject({
      isRunning: false,
      phase: 'done',
      progress: 1,
      completionNoticeId: 1,
    });
    expect(store.triggerOptimizer.results.createdAt).toBeTruthy();
    expect(store.triggerOptimizer.results.stale).toBe(false);
    expect(store.triggerOptimizer.results.bestTriggerMap).toEqual(result.bestTriggerMap);
    expect(store.triggerOptimizerReportStale).toBe(false);
    expect(store.triggerOptimizer.runtime.serviceRunInFlight).toBe(false);
  }, 30000);

  it('applies recommended triggers without touching food keys and reverts completely', async () => {
    const store = importedStore();
    const foodTrigger = [customTrigger(10)];
    const beforeMap = {
      '/items/donut': foodTrigger,
      [ABILITY_HRID]: [customTrigger(100)],
      [SECOND_ABILITY_HRID]: [customTrigger(200)],
    };
    store.activePlayer.triggerMap = JSON.parse(JSON.stringify(beforeMap));

    await completeStart(store);

    expect(store.applyTriggerOptimizerResult()).toBe(true);
    expect(store.activePlayer.triggerMap[ABILITY_HRID]).toEqual([customTrigger(500)]);
    expect(Object.prototype.hasOwnProperty.call(store.activePlayer.triggerMap, SECOND_ABILITY_HRID)).toBe(false);
    expect(store.activePlayer.triggerMap['/items/donut']).toEqual(foodTrigger);
    expect(store.triggerOptimizer.baselineSnapshot).toMatchObject({ playerId: '1' });
    expect(store.triggerOptimizer.baselineSnapshot.triggerMap).toEqual(beforeMap);
    expect(store.triggerOptimizer.results.changeDescriptors.length).toBeGreaterThan(0);

    expect(store.revertTriggerOptimizerChanges()).toBe(true);
    expect(store.activePlayer.triggerMap).toEqual(beforeMap);
    expect(store.triggerOptimizer.baselineSnapshot).toBeNull();
  }, 30000);

  // Pinia 的 devtools 插件（dev 下对 options store 生效，见 deps/pinia.js 的
  // patchActionForGrouping）会给**每次** action 调用传一个新建的 `new Proxy(store)`
  // 当 this。以 store 身份为键的 WeakSet 因此永不命中：注册去重与 apply 期间的遮蔽
  // 同时失效——$patch 里写 triggerMap 的那一刻（appliedInputSignature 还空着）老
  // watcher 把刚应用的结果判成过期，sticky 的 results.stale 被钉成 true，紧接着
  // 「撤销」按钮消失（2026-09-17 浏览器冒烟定案）。
  it('keeps apply-time masking when actions are invoked through a rebound `this` (Pinia devtools proxy)', async () => {
    const store = importedStore();
    await completeStart(store);

    // 模拟 devtools 包装：每次调用都换一个全新的代理当 this。
    const reboundThis = () =>
      new Proxy(store, {
        get: (target, key) => Reflect.get(target, key),
        set: (target, key, value) => Reflect.set(target, key, value),
      });

    expect(store.setTriggerOptimizerSettings.call(reboundThis(), {})).toBe(true);
    expect(store.applyTriggerOptimizerResult.call(reboundThis())).toBe(true);

    expect(store.triggerOptimizer.results.stale).toBe(false);
    expect(store.triggerOptimizerReportStale).toBe(false);
    expect(store.triggerOptimizer.baselineSnapshot).toMatchObject({ playerId: '1' });

    // 撤销也必须在这种调用方式下可用（应用后不能一按就判过期）。
    expect(store.revertTriggerOptimizerChanges.call(reboundThis())).toBe(true);
    expect(store.triggerOptimizer.baselineSnapshot).toBeNull();
  }, 30000);

  // 撤销门禁收窄（2026-09-19，设计 §19.6）：只有「被优化的技能触发器被手改」才拒绝撤销——
  // 撤销会把那些键整条覆盖回应用前，手工改动会被踩掉。
  it('blocks revert when the optimized ability triggers were edited by hand', async () => {
    const store = importedStore();
    await completeStart(store);
    expect(store.applyTriggerOptimizerResult()).toBe(true);
    expect(store.activePlayer.triggerMap[ABILITY_HRID]).toEqual([customTrigger(500)]);

    store.activePlayer.triggerMap[ABILITY_HRID] = [customTrigger(999)];

    expect(store.revertTriggerOptimizerChanges()).toBe(false);
    expect(store.triggerOptimizer.runtime.error).toBe('common:triggerOptimizer.revertBlockedEdited');
    // 手工改动必须原样保留（撤销没有写回），快照仍在（用户可以先手改回去再撤销）。
    expect(store.activePlayer.triggerMap[ABILITY_HRID]).toEqual([customTrigger(999)]);
    expect(store.triggerOptimizer.baselineSnapshot).not.toBeNull();
  }, 30000);

  // 撤销与应用共用运行互斥闸门（2026-09-27）：任何其它在途任务期间，撤销必须与
  // apply 一样被拒——页面 canRevert 早已按此口径禁用，这里是 store 层的回归锚点。
  it('blocks revert while another feature run is in flight', async () => {
    const store = importedStore();
    await completeStart(store);
    expect(store.applyTriggerOptimizerResult()).toBe(true);
    const appliedMap = JSON.parse(JSON.stringify(store.activePlayer.triggerMap));
    const snapshotBefore = store.triggerOptimizer.baselineSnapshot;

    store.pricing.isLoading = true;

    expect(store.revertTriggerOptimizerChanges()).toBe(false);
    expect(store.triggerOptimizer.runtime.error).toBe('common:triggerOptimizer.busy');
    // 玩家 triggerMap 与基线快照都必须原样保留（撤销没有写回）。
    expect(store.activePlayer.triggerMap).toEqual(appliedMap);
    expect(store.triggerOptimizer.baselineSnapshot).toEqual(snapshotBefore);

    store.pricing.isLoading = false;
    expect(store.revertTriggerOptimizerChanges()).toBe(true);
    expect(store.triggerOptimizer.baselineSnapshot).toBeNull();
  }, 30000);

  it('marks results stale when inputs change: apply blocked, revert still available', async () => {
    const store = importedStore();
    await completeStart(store);
    expect(store.applyTriggerOptimizerResult()).toBe(true);

    store.activePlayer.levels.stamina += 1;

    expect(store.triggerOptimizerReportStale).toBe(true);
    expect(store.applyTriggerOptimizerResult()).toBe(false);
    expect(store.triggerOptimizer.runtime.error).toBe('common:triggerOptimizer.stale');
    // 撤销只覆盖被优化的技能键，等级/地图这类输入变化撤销并不会踩到 → 仍然允许（旧实现
    // 用整份指纹的 stale 一刀切，撤销按钮会凭空消失）。
    expect(store.revertTriggerOptimizerChanges()).toBe(true);
    expect(store.triggerOptimizer.baselineSnapshot).toBeNull();
  }, 30000);

  it('persists settings changes and flags the completed result stale', async () => {
    const store = importedStore();
    await completeStart(store);

    expect(store.setTriggerOptimizerSettings({ maxRounds: 3 })).toBe(true);
    expect(store.triggerOptimizer.settings.maxRounds).toBe(3);
    expect(store.triggerOptimizer.results.stale).toBe(true);
    expect(store.triggerOptimizerReportStale).toBe(true);

    // 落盘可回读（simulatorStorage 的版本化键）。
    const raw = JSON.parse(global.localStorage.getItem('mwi.triggerOptimizer.settings.v1'));
    expect(raw.maxRounds).toBe(3);
    expect(raw.version).toBe(1);
  }, 30000);

  // 队伍载荷（2026-09-27，设计 §59）：队友集合存设置（归一化 + 落盘 + 过期标记），运行期解析成
  // **冻结副本**随 payload 传入；主角自身永不入队、未知 id 静默跳过（报告靠指纹变化自然过期）。
  it('resolves party teammates from settings and binds them into the run and fingerprint', async () => {
    const store = importedStore();
    expect(store.setTriggerOptimizerPartyPlayers(['2', '2', '1', '9'])).toBe(true);
    // 归一化：去重 + 保序；主角（'1'）与未知 id（'9'）允许留在集合里，解析时排除。
    expect(store.triggerOptimizer.settings.partyPlayerIds).toEqual(['2', '1', '9']);

    const teammates = resolveTriggerOptimizerTeammates(store);
    expect(teammates.map((player) => String(player.id))).toEqual(['2']);
    expect(teammates[0]).not.toBe(store.players[1]); // 冻结副本：不是 Pinia 的响应式对象

    const { pending } = await startPending(store);
    expect(controls.calls.at(-1).input.teammates.map((player) => String(player.id))).toEqual(['2']);

    controls.calls.at(-1).resolve(makeResult());
    await pending;
    expect(store.triggerOptimizerReportStale).toBe(false);

    // 换队友 ⇒ 既有报告立即过期（与锁定集合同款语义）。
    expect(store.setTriggerOptimizerPartyPlayers(['2', '3'])).toBe(true);
    expect(store.triggerOptimizerReportStale).toBe(true);
  }, 30000);

  // 时长自适应轮数（2026-09-20 重定，设计 §20.1）：每档预设自带一张「时长 → 轮数」表。
  // 用户改时长时，若当前三元组命中某档预设，就把该档在新时长下的有效轮数写回；
  // 显式改三元组的自定义配置绝不被静默覆盖。
  it('changing the duration while on a preset re-derives the sampling rounds (24h → 5, 4h → 8)', () => {
    const store = importedStore();
    // 初始 = 标准档（10/2/5，时长 24h）：默认重复次数从 2 提到 5（功效实测，§20.1）。
    expect(store.triggerOptimizer.settings.rounds).toBe(5);
    expect(store.triggerOptimizer.settings.simulationHours).toBe(24);

    expect(store.setTriggerOptimizerSettings({ simulationHours: 4 })).toBe(true);
    expect(store.triggerOptimizer.settings.simulationHours).toBe(4);
    expect(store.triggerOptimizer.settings.rounds).toBe(8);
    // 仍然是「标准档」：预设判定用的是设置自己的时长（不会掉成「自定义」）。
    expect(resolveTriggerOptimizerPresetId(store.triggerOptimizer.settings)).toBe('standard');

    // 回到长时长 → 轮数回落（预设口径再次生效）。
    expect(store.setTriggerOptimizerSettings({ simulationHours: 24 })).toBe(true);
    expect(store.triggerOptimizer.settings.rounds).toBe(5);
  }, 30000);

  it('custom triples are never silently overridden by the duration rule', () => {
    const store = importedStore();
    // 用户手填 rounds=4（8/2/4 = 自定义）→ 改时长不该动它。
    expect(store.setTriggerOptimizerSettings({ candidateLimit: 8, maxRounds: 2, rounds: 4 })).toBe(true);
    expect(resolveTriggerOptimizerPresetId(store.triggerOptimizer.settings)).toBe('custom');

    expect(store.setTriggerOptimizerSettings({ simulationHours: 4 })).toBe(true);
    expect(store.triggerOptimizer.settings.rounds).toBe(4);

    // 同一补丁里显式给了 rounds → 以补丁为准（时长规则不介入）。
    expect(store.setTriggerOptimizerSettings({ simulationHours: 24, rounds: 3 })).toBe(true);
    expect(store.triggerOptimizer.settings.rounds).toBe(3);
  }, 30000);

  // 复验否决闸门：搜索期的正分可能只是那组种子的运气。实测（2026-09-18）标准档在
  // 一个已调优角色上采纳了 +0.00078 分的改动，独立复验（换种子 × 6 轮）却判它显著更差
  // （p=0.022）—— 这样的报告一旦被应用，用户看到的「提升」立刻变成退步。
  it('refuses to apply a result whose independent verification says it is worse', async () => {
    const store = importedStore();
    await completeStart(store, makeResult({ verification: { rounds: 6, verdict: 'negative' } }));

    expect(store.applyTriggerOptimizerResult()).toBe(false);
    expect(store.triggerOptimizer.runtime.error).toBe('common:triggerOptimizer.applyBlockedNegative');
    // 没应用 → 不建立基线快照（玩家配置没被改动，撤销按钮不会出现）。
    expect(store.triggerOptimizer.baselineSnapshot).toBeNull();
  }, 30000);

  it('still applies when the verification is merely inconclusive', async () => {
    // 复验只在判负时否决：未达显著不等于更差（否则任何样本不足的结果都不能应用，
    // 等于把功能变成只读报告）。
    const store = importedStore();
    await completeStart(store, makeResult({ verification: { rounds: 6, verdict: 'inconclusive' } }));

    expect(store.applyTriggerOptimizerResult()).toBe(true);
    expect(store.triggerOptimizer.baselineSnapshot).not.toBeNull();
  }, 30000);

  it('rejects apply without results and apply while stale', async () => {
    const store = importedStore();
    expect(store.applyTriggerOptimizerResult()).toBe(false);
    expect(store.triggerOptimizer.runtime.error).toBe('common:triggerOptimizer.noResults');
  });

  it('stop cancels the run and a late result is dropped by the runId guard', async () => {
    const store = importedStore();
    const { pending } = await startPending(store);

    store.stopTriggerOptimizer();
    expect(store.triggerOptimizer.runtime).toMatchObject({ isRunning: false, phase: 'cancelled' });

    controls.calls.at(-1).resolve(makeResult({ cancelled: true }));
    await pending;

    expect(store.triggerOptimizer.runtime.phase).toBe('cancelled');
    expect(store.triggerOptimizer.results.createdAt).toBeFalsy();
    expect(store.triggerOptimizer.runtime.completionNoticeId).toBe(0);
  }, 30000);

  it('resets session results when a player data snapshot is restored', async () => {
    const store = importedStore();
    await completeStart(store);
    expect(store.triggerOptimizer.results.createdAt).toBeTruthy();

    // 空玩家配置不算「有意义的快照」（simulatorStorage 的 hasMeaningful 校验会过滤掉），
    // 先做一次真实改动再保存。
    store.players[0].levels.stamina = 77;
    expect(store.savePlayerDataSnapshot().ok).toBe(true);
    store.players[0].levels.stamina = 1;
    expect(store.loadPlayerDataSnapshot().ok).toBe(true);
    expect(store.players[0].levels.stamina).toBe(77);

    expect(store.triggerOptimizer.results.createdAt).toBeFalsy();
    expect(store.triggerOptimizer.baselineSnapshot).toBeNull();
    expect(store.triggerOptimizer.runtime.error).toBe('');
  }, 30000);

  // 换难度稳健性复核（2026-09-23，设计 §29）：触发器写的是全局技能配置，而搜索只在单一难度上
  // 评估过 —— 复核把报告里的「最优 vs 搜索起点」搬到**报告记录的**相邻难度上跑一次配对评估。
  // 只读：不写玩家配置，结果挂在当前这一份报告上（results.robustness）。
  it('re-checks the report on the adjacent difficulty and attaches the outcome to it', async () => {
    const store = importedStore();
    const baselineMap = { [ABILITY_HRID]: [customTrigger(100)] };
    await completeStart(
      store,
      makeResult({
        baselineTriggerMap: baselineMap,
        evaluationScope: { zoneHrid: '/actions/combat/fly', useDungeon: false, difficultyTier: 0, simulationHours: 24 },
        // 复核轮数自适应（2026-09-25，设计 §49）：反解的依据是报告里已有的复验统计，成本护栏的
        // 基准是整轮场次 —— 报告两者都得带上，计划才会被算出来（缺一个就回落到固定 6 轮）。
        verification: {
          rounds: 6,
          paired: { rounds: 6, score: { rounds: 6, mean: 0.04, stdError: 0.02, verdict: 'inconclusive' } },
        },
        simulations: 84,
      }),
    );
    // 搜索完成后首页设置被改过（难度 4）：复核必须用**报告记录的范围**，不是当前设置。
    store.simulationSettings.difficultyTier = 4;

    const pending = store.runTriggerOptimizerRobustness();
    await vi.waitFor(() => expect(controls.robustnessCalls.length).toBe(1), { timeout: 20000 });
    const { input, options } = controls.robustnessCalls.at(-1);

    // 目标难度 = 相邻难度（fly 的合法区间 0..5，tier 0 → +1）；时长取报告当时的 24 小时。
    expect(options.targetTier).toBe(1);
    // 复核轮数自适应（2026-09-25，设计 §49）：0.04 / SE 0.02 在**目标难度**上要 9 轮才判得出来
    //（保底 6 < 9 < 上限 16；护栏：整轮 84 场 × 20% = 16 → 2 ×(9−6) = 6 场预算没被咬住）。
    expect(options.rounds).toBe(9);
    // 计划快照与轮数同源（同一个纯函数的输出）：服务层据此写进 result.plan，报告能回答「为什么是
    // 9 轮」；页面上那句「这次要跑几轮」用的也是它 —— 三处不能分裂。
    expect(options.plan).toMatchObject({
      capped: false,
      budgetLimited: false,
      currentRounds: 6,
      requiredRounds: 9,
      capRounds: 16,
      plannedRounds: 9,
      plannedSimulations: 18,
      budgetSimulations: 16,
    });
    expect(input.simulationSettings).toMatchObject({
      mode: 'zone',
      zoneHrid: '/actions/combat/fly',
      useDungeon: false,
      difficultyTier: 1,
      simulationTimeHours: 24,
    });
    // 两份配置都来自报告（最优 = 本次结果、起点 = 报告快照），且是深拷贝（不共享引用）。
    expect(input.bestTriggerMap).toEqual({ [ABILITY_HRID]: [customTrigger(500)] });
    expect(input.baselineTriggerMap).toEqual(baselineMap);
    expect(input.bestTriggerMap).not.toBe(store.triggerOptimizer.results.bestTriggerMap);
    // 运行态：复核在跑，且这一段里「应用结果」必须被挡住（正在读的配置不能被改）。
    expect(store.triggerOptimizer.runtime.robustness).toMatchObject({ isRunning: true, difficultyTier: 1 });
    expect(store.applyTriggerOptimizerResult()).toBe(false);
    // 服务调用在途标志：它是「忙」计算属性的响应式锚点，运行期必须为真（见 store 的注释）。
    expect(store.triggerOptimizer.runtime.serviceRunInFlight).toBe(true);

    options.onProgress({ phase: 'robustness', progress: 0.5, elapsedSeconds: 2 });
    expect(store.triggerOptimizer.runtime.robustness).toMatchObject({ progress: 0.5, elapsedSeconds: 2 });
    // 复核结果只属于报告：跑之前报告里没有它（首跑态：结论只在跑完后写入 —— §51 起
    // 开局不再清空 robustness，留着它给追加态保留旧结论）。
    expect(store.triggerOptimizer.results.robustness).toBeFalsy();

    controls.robustnessCalls.at(-1).resolve({
      cancelled: false,
      difficultyTier: 1,
      zoneHrid: '/actions/combat/fly',
      rounds: 9,
      // 服务层真实输出的形状（§49）：计划快照净化后随结果留档（plannedRounds 与实际 rounds 自洽）。
      plan: {
        capped: false,
        budgetLimited: false,
        currentRounds: 6,
        requiredRounds: 9,
        capRounds: 16,
        plannedRounds: 9,
        plannedSimulations: 18,
        budgetSimulations: 16,
      },
      verdict: 'positive',
      scoreDelta: 0.031,
      profitDelta: 12345,
      paired: { rounds: 9, score: { mean: 0.031, stdError: 0.004, pValue: 0.002, verdict: 'positive' } },
      elapsedSeconds: 9,
      error: '',
    });
    await pending;

    expect(store.triggerOptimizer.results.robustness).toMatchObject({
      difficultyTier: 1,
      verdict: 'positive',
      scoreDelta: 0.031,
    });
    expect(store.triggerOptimizer.results.robustness.createdAt).toBeTruthy();
    expect(store.triggerOptimizer.runtime.robustness).toMatchObject({ isRunning: false, phase: 'done', progress: 1 });
    // 结算后必须清掉「服务调用在途」：留着会让页面永久停在忙态（正是它要修的那个卡死）。
    expect(store.triggerOptimizer.runtime.serviceRunInFlight).toBe(false);
    // 只读动作：玩家配置与报告主体都没被动过。
    expect(store.activePlayer.triggerMap[ABILITY_HRID]).toBeUndefined();
    expect(store.triggerOptimizer.results.bestTriggerMap).toEqual({ [ABILITY_HRID]: [customTrigger(500)] });
    // 计划快照随报告落盘（2026-09-25，设计 §49）：deep watch 把带 createdAt 的报告整体写进本地
    // 存储，robustness.plan 一并往返 —— 刷新/重进之后仍能复盘「这次复核跑了几轮、上限/护栏有没有
    // 咬住」。缺了落盘，上屏那句话就成了唯一的证据（下一次渲染就被顶掉）。
    expect(store.triggerOptimizer.results.robustness.plan?.plannedRounds).toBe(9);
    await nextTick();
    const persisted = JSON.parse(localStorage.getItem('mwi.triggerOptimizer.report.v1'));
    expect(persisted.report.robustness.plan).toMatchObject({ plannedRounds: 9, currentRounds: 6, capRounds: 16 });
  }, 60000);

  // ── 复核追加（2026-09-26，设计 §51）：两态编排的第二态 ──────────────────────
  // 报告已有复核结论时，再点复核 = 换盐追加（新样本与首跑样本合并重检），不再同盐复跑
  //（§51 装置实测：同盐两次派生逐值相同、信息增量 0 ⇒ 纯白烧）。只读：不写玩家配置，合并结论
  // 写回**当前这一份报告**的 robustness（含 attempts 留档）；取消/失败不覆盖（旧结论保留到合并成功）。

  // 复核记录的逐轮样本：逐轮带抖动（配对差非恒值 ⇒ stdError ≠ 0），免得计划撞上零差出口。
  function robustnessSamples(base, jitter = 0, count = 6) {
    return Array.from({ length: count }, (_, index) => ({
      dps: base + index * 2 + (index % 2 === 0 ? jitter : -jitter),
      dailyProfit: 1000,
      dailyNoRngProfit: 1000 + index,
      xpPerHour: 500,
      killsPerHour: 10,
      deathsPerHour: 0.1,
      ranOutOfMana: false,
    }));
  }

  function makeRobustness(score, rounds = 6, extra = {}) {
    return {
      difficultyTier: 1,
      zoneHrid: '/actions/combat/fly',
      baselineMetrics: { rounds, samples: robustnessSamples(100) },
      bestMetrics: { rounds, samples: robustnessSamples(116, 3) },
      paired: { rounds, score: { rounds, ...score } },
      verdict: String(score.verdict ?? 'inconclusive'),
      seeds: Array.from({ length: rounds }, (_, index) => index + 1),
      rounds,
      attempts: [],
      createdAt: Date.now() - 1000,
      ...extra,
    };
  }

  it('appends a re-check on the recorded difficulty with a fresh seed salt and merges the verdict', async () => {
    const store = importedStore();
    const baselineMap = { [ABILITY_HRID]: [customTrigger(100)] };
    const previous = makeRobustness({ mean: 0.012, stdError: 0.009, pValue: 0.2, verdict: 'inconclusive' });
    await completeStart(
      store,
      makeResult({
        baselineTriggerMap: baselineMap,
        evaluationScope: { zoneHrid: '/actions/combat/fly', useDungeon: false, difficultyTier: 2, simulationHours: 24 },
        simulations: 100,
        robustness: previous,
      }),
    );
    // 搜索完成后首页难度被改过：追加必须沿用**复核记录的**难度 1（不是重算报告范围的相邻难度）。
    store.simulationSettings.difficultyTier = 4;

    const pending = store.runTriggerOptimizerRobustness();
    await vi.waitFor(() => expect(controls.robustnessAppendCalls.length).toBe(1), { timeout: 20000 });
    const { input, options } = controls.robustnessAppendCalls.at(-1);

    // 首跑入口（verify 桩）一次都没被调用：报告已有结论 ⇒ 走追加路径。
    expect(controls.robustnessCalls).toHaveLength(0);
    expect(options.attempt).toBe(1);
    expect(options.targetTier).toBe(1);
    // 补到上限（§51 S2 口径）：已有 6 轮 ⇒ 目标补 10 轮（上限 16）；整轮 100 场 ⇒ 单次预算 20 场
    // 正好装下（2 × 10，边界不咬）、累计预算 40，两级护栏都没咬住。
    expect(options.rounds).toBe(10);
    expect(options.plan).toMatchObject({
      zeroDiff: false,
      atCap: false,
      capped: true,
      budgetLimited: false,
      limitedBy: null,
      currentRounds: 6,
      requiredRounds: null,
      capRounds: 16,
      plannedRounds: 10,
      plannedSimulations: 20,
      budgetSimulations: 20,
      cumulativeBudgetSimulations: 40,
      spentSimulations: 0,
    });
    // 合并重检的原料（首跑复核记录，含逐轮样本）随输入交给服务层，且是深拷贝（不共享引用）。
    expect(input.previousRobustness).toEqual(previous);
    expect(input.previousRobustness).not.toBe(store.triggerOptimizer.results.robustness);
    expect(input.simulationSettings).toMatchObject({
      zoneHrid: '/actions/combat/fly',
      difficultyTier: 1,
      simulationTimeHours: 24,
    });
    expect(store.triggerOptimizer.runtime.robustness).toMatchObject({ isRunning: true, difficultyTier: 1 });
    // 旧结论保留到合并成功（§51）：追加期间结论仍是首跑的，不再被开局清空。
    expect(store.triggerOptimizer.results.robustness.verdict).toBe('inconclusive');

    options.onProgress({ phase: 'robustness-append', progress: 0.5, elapsedSeconds: 3 });
    expect(store.triggerOptimizer.runtime.robustness).toMatchObject({ progress: 0.5, elapsedSeconds: 3 });

    controls.robustnessAppendCalls.at(-1).resolve({
      ...previous,
      rounds: 16,
      seeds: [...previous.seeds, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
      baselineMetrics: { rounds: 16, samples: [...previous.baselineMetrics.samples, ...robustnessSamples(104, 0, 10)] },
      bestMetrics: { rounds: 16, samples: [...previous.bestMetrics.samples, ...robustnessSamples(128, 3, 10)] },
      paired: { rounds: 16, score: { rounds: 16, mean: 0.03, stdError: 0.008, pValue: 0.004, verdict: 'positive' } },
      verdict: 'positive',
      scoreDelta: 0.03,
      profitDelta: 4321,
      attempts: [
        {
          attempt: 1,
          rounds: 10,
          seeds: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
          paired: { rounds: 10, score: { rounds: 10, mean: 0.04, stdError: 0.012, pValue: 0.01, verdict: 'positive' } },
          verdict: 'positive',
          mergedRounds: 16,
          mergedVerdict: 'positive',
          plan: options.plan,
        },
      ],
      evaluations: 2,
      simulations: 20,
      elapsedSeconds: 7,
      cancelled: false,
      error: '',
    });
    await pending;

    // 合并结论写回报告（含 attempts 留档），createdAt 由 store 刷新。
    expect(store.triggerOptimizer.results.robustness).toMatchObject({
      verdict: 'positive',
      rounds: 16,
      scoreDelta: 0.03,
      profitDelta: 4321,
    });
    expect(store.triggerOptimizer.results.robustness.attempts).toHaveLength(1);
    expect(store.triggerOptimizer.results.robustness.createdAt).toBeTruthy();
    expect(store.triggerOptimizer.results.robustness.createdAt).not.toBe(previous.createdAt);
    expect(store.triggerOptimizer.runtime.robustness).toMatchObject({ isRunning: false, phase: 'done', progress: 1 });
    // 结算后必须清掉「服务调用在途」（页面忙态的响应式锚点）。
    expect(store.triggerOptimizer.runtime.serviceRunInFlight).toBe(false);
    // 只读动作：玩家配置没有被写。
    expect(store.activePlayer.triggerMap[ABILITY_HRID]).toBeUndefined();
    // 合并结论与 attempts 留档随报告落盘（§51 与 §48 同款理由：刷新/重进之后仍能复盘
    // 「这次补了几轮、护栏有没有咬住」）。
    await nextTick();
    const persisted = JSON.parse(localStorage.getItem('mwi.triggerOptimizer.report.v1'));
    expect(persisted.report.robustness.rounds).toBe(16);
    expect(persisted.report.robustness.attempts[0].plan.plannedRounds).toBe(10);
    expect(persisted.report.robustness.attempts[0].plan.spentSimulations).toBe(0);
  }, 60000);

  it('refuses a pointless re-check append without dispatching, with a reason for each case', async () => {
    const store = importedStore();
    await completeStart(
      store,
      makeResult({
        baselineTriggerMap: { [ABILITY_HRID]: [customTrigger(100)] },
        evaluationScope: { zoneHrid: '/actions/combat/fly', useDungeon: false, difficultyTier: 0, simulationHours: 24 },
        simulations: 40,
        // ① 零差出口：目标难度的逐轮差恒 0 ⇒ 再补样本也判不出，一次都不派。
        robustness: makeRobustness({ mean: 0, stdError: 0, verdict: 'inconclusive' }),
      }),
    );
    expect(await store.runTriggerOptimizerRobustness()).toBe(false);
    expect(store.triggerOptimizer.runtime.robustness.error).toBe('common:triggerOptimizer.robustnessAppendZeroDiff');

    // ② 已达上限（复核上限是**总量**上限）：16 轮 ⇒ 一轮都追加不了。
    store.triggerOptimizer.results.robustness = makeRobustness(
      { mean: 0.01, stdError: 0.02, verdict: 'inconclusive' },
      16,
    );
    expect(await store.runTriggerOptimizerRobustness()).toBe(false);
    expect(store.triggerOptimizer.runtime.robustness.error).toBe('common:triggerOptimizer.robustnessAppendAtCap');

    // ③ 累计预算用尽：整轮 40 场 ⇒ 单次预算 8 / 累计预算 16 场；已追加 8 轮（16 场）⇒ 累计
    // 余量 0 ⇒ 报「预算用尽」而不是「上限不够」—— 两个原因不同，出路也不同。
    store.triggerOptimizer.results.robustness = makeRobustness(
      { mean: 0.01, stdError: 0.02, verdict: 'inconclusive' },
      6,
      { attempts: [{ attempt: 1, rounds: 8, mergedRounds: 12, mergedVerdict: 'inconclusive' }] },
    );
    expect(await store.runTriggerOptimizerRobustness()).toBe(false);
    expect(store.triggerOptimizer.runtime.robustness.error).toBe(
      'common:triggerOptimizer.robustnessAppendBudgetExhausted',
    );

    // 三种情形都必须在服务调用之前返回：一次都没派出去（首跑/追加两只桶都是空的）。
    expect(controls.robustnessAppendCalls).toHaveLength(0);
    expect(controls.robustnessCalls).toHaveLength(0);
  }, 60000);

  it('refuses the append when the robustness record has no samples to merge, and never starts the service', async () => {
    const store = importedStore();
    await completeStart(
      store,
      makeResult({
        baselineTriggerMap: { [ABILITY_HRID]: [customTrigger(100)] },
        evaluationScope: { zoneHrid: '/actions/combat/fly', useDungeon: false, difficultyTier: 0, simulationHours: 24 },
        // 旧版复核记录（没有逐轮样本）⇒ 无从合并重检 —— 明确报错请用户重跑搜索，而不是猜一份样本。
        robustness: { difficultyTier: 1, rounds: 6, verdict: 'inconclusive', attempts: [] },
      }),
    );
    expect(await store.runTriggerOptimizerRobustness()).toBe(false);
    expect(store.triggerOptimizer.runtime.robustness.error).toBe('common:triggerOptimizer.robustnessAppendMissing');
    expect(controls.robustnessAppendCalls).toHaveLength(0);
  }, 60000);

  it('stops an in-flight append through the shared cancel chain and keeps the previous verdict', async () => {
    const store = importedStore();
    const previous = makeRobustness({ mean: 0.012, stdError: 0.009, pValue: 0.2, verdict: 'inconclusive' });
    await completeStart(
      store,
      makeResult({
        baselineTriggerMap: { [ABILITY_HRID]: [customTrigger(100)] },
        evaluationScope: { zoneHrid: '/actions/combat/fly', useDungeon: false, difficultyTier: 0, simulationHours: 24 },
        robustness: previous,
      }),
    );

    const pending = store.runTriggerOptimizerRobustness();
    await vi.waitFor(() => expect(controls.robustnessAppendCalls.length).toBe(1), { timeout: 20000 });
    expect(store.triggerOptimizer.runtime.robustness.isRunning).toBe(true);

    store.stopTriggerOptimizer();
    expect(store.triggerOptimizer.runtime.robustness).toMatchObject({ isRunning: false, phase: 'cancelled' });

    // 在途结果作废（runId 已复位）→ 不写回，也不留错误（取消不是失败）。
    controls.robustnessAppendCalls.at(-1).resolve({ cancelled: true });
    await pending;

    // 「什么都没追加」：旧结论原样保留（§51 语义变化 —— 不再像旧口径那样被开局清空丢掉）。
    expect(store.triggerOptimizer.results.robustness).toMatchObject({ verdict: 'inconclusive', rounds: 6 });
    expect(store.triggerOptimizer.results.robustness.attempts).toHaveLength(0);
    expect(store.triggerOptimizer.runtime.robustness.error).toBe('');
    expect(store.triggerOptimizer.runtime.serviceRunInFlight).toBe(false);
  }, 60000);

  // 逐轮样本（aggregateRoundMetrics 的 pickSampleMetrics 口径）：只留参与聚合的键。
  function verificationSamples(dps) {
    return Array.from({ length: 6 }, () => ({
      dps,
      dailyProfit: 1000,
      dailyNoRngProfit: 1000,
      xpPerHour: 500,
      killsPerHour: 10,
      deathsPerHour: 0.1,
      ranOutOfMana: false,
    }));
  }

  // 追加复验（2026-09-24，设计 §31）：首轮复验判「未达显著」时再采一组独立样本、与首轮样本合并
  // 重检。只读（不写玩家配置），合并结论写回**当前这一份报告**的 verification（含 attempts 留档）；
  // 取消不写回（服务层「什么都没追加」的口径）。
  it('appends an independent verification and writes the merged verdict back to the report', async () => {
    const store = importedStore();
    const baselineMap = { [ABILITY_HRID]: [customTrigger(100)] };
    const verification = {
      baselineMetrics: { rounds: 6, samples: verificationSamples(100) },
      bestMetrics: { rounds: 6, samples: verificationSamples(110) },
      // score 的形态与生产一致（summarizeSamples 一定带 rounds）：追加轮数自适应要读它反解。
      paired: { rounds: 6, score: { rounds: 6, mean: 0.01, stdError: 0.02, pValue: 0.6, verdict: 'inconclusive' } },
      verdict: 'inconclusive',
      seeds: [1, 2, 3, 4, 5, 6],
      rounds: 6,
      attempts: [],
    };
    await completeStart(
      store,
      makeResult({
        baselineTriggerMap: baselineMap,
        evaluationScope: {
          zoneHrid: '/actions/combat/fly',
          useDungeon: false,
          difficultyTier: 0,
          simulationHours: 24,
        },
        verification,
      }),
    );
    // 搜索完成后首页设置被改过（难度 4）：追加必须用**报告记录的范围**（原难度 0）—— 不换难度。
    store.simulationSettings.difficultyTier = 4;

    const pending = store.runTriggerOptimizerVerificationAppend();
    await vi.waitFor(() => expect(controls.appendCalls.length).toBe(1), { timeout: 20000 });
    const { input, options } = controls.appendCalls.at(-1);

    expect(input.simulationSettings).toMatchObject({
      mode: 'zone',
      zoneHrid: '/actions/combat/fly',
      useDungeon: false,
      difficultyTier: 0,
      simulationTimeHours: 24,
    });
    // 第一次追加 = attempt 1（进种子盐）；两份配置与首轮样本都取自报告，且是深拷贝。
    expect(options.attempt).toBe(1);
    // 追加轮数自适应（2026-09-25，设计 §47）：0.01 / SE 0.02 在 6 轮上「连上限 24 轮都判不出来」
    // ⇒ A′ 口径补到上限：目标 24 轮 − 已有 6 轮 = 18 轮/侧（36 场）。报告没有整轮场次
    //（makeResult 不带 simulations）⇒ 拿不到护栏基准 ⇒ 不假装有护栏，按上限口径全量追加。
    expect(options.rounds).toBe(18);
    // 计划快照随调用透传（2026-09-25，设计 §48）：服务层据此写进 attempts[i].plan，留档「为什么是
    // 18 轮」—— 上屏的计划行与这里传下去的是同一个纯函数的输出，不能让报告拿到另一套口径。
    expect(options.plan?.plannedRounds).toBe(18);
    expect(store.triggerOptimizer.runtime.verifyAppend.error).toBe('');
    expect(input.bestTriggerMap).toEqual({ [ABILITY_HRID]: [customTrigger(500)] });
    expect(input.baselineTriggerMap).toEqual(baselineMap);
    expect(input.verification).toEqual(verification);
    expect(input.verification).not.toBe(store.triggerOptimizer.results.verification);
    // 运行态：追加在跑，这一段里「应用结果」必须被挡住（正在读的配置不能被改）。
    expect(store.triggerOptimizer.runtime.verifyAppend).toMatchObject({ isRunning: true, phase: 'preparing' });
    expect(store.applyTriggerOptimizerResult()).toBe(false);
    // 服务调用在途标志：「忙」计算属性的响应式锚点，运行期必须为真。
    expect(store.triggerOptimizer.runtime.serviceRunInFlight).toBe(true);

    options.onProgress({ phase: 'verify-append', progress: 0.5, elapsedSeconds: 2 });
    expect(store.triggerOptimizer.runtime.verifyAppend).toMatchObject({ progress: 0.5, elapsedSeconds: 2 });
    // 合并前报告里的复验结论仍是首轮的。
    expect(store.triggerOptimizer.results.verification.verdict).toBe('inconclusive');

    controls.appendCalls.at(-1).resolve({
      ...verification,
      baselineMetrics: {
        rounds: 24,
        samples: [...verification.baselineMetrics.samples, ...verificationSamples(105)],
      },
      bestMetrics: { rounds: 24, samples: [...verification.bestMetrics.samples, ...verificationSamples(120)] },
      paired: { rounds: 24, score: { mean: 0.05, stdError: 0.004, pValue: 0.002, verdict: 'positive' } },
      verdict: 'positive',
      rounds: 24,
      seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      // 服务层真实输出的形状（§47/§48）：本次追加 18 轮、合并 24 轮，attempts 里带计划快照 ——
      // 快照自身与 rounds 自洽（plannedRounds = 18），store 只负责原样写回并落盘。
      attempts: [
        {
          attempt: 1,
          rounds: 18,
          mergedRounds: 24,
          mergedVerdict: 'positive',
          plan: {
            decisive: false,
            capped: false,
            budgetLimited: false,
            // 两级护栏字段（2026-09-26，设计 §50 B-2）：这一份报告没有整轮场次 ⇒ 两个护栏基准都是
            // null（不假装有护栏）、累计已花 0（第一次追加）。
            limitedBy: null,
            currentRounds: 6,
            requiredRounds: 24,
            capRounds: 24,
            targetRounds: 24,
            plannedRounds: 18,
            plannedSimulations: 36,
            budgetSimulations: null,
            spentSimulations: 0,
            cumulativeBudgetSimulations: null,
          },
        },
      ],
      evaluations: 2,
      simulations: 12,
      elapsedSeconds: 9,
      cancelled: false,
      error: '',
    });
    await pending;

    // 合并结论写回报告（含 attempts 留档）。
    expect(store.triggerOptimizer.results.verification).toMatchObject({ verdict: 'positive', rounds: 24 });
    expect(store.triggerOptimizer.results.verification.attempts).toHaveLength(1);
    // 计划快照随报告落盘（2026-09-25，设计 §48）：deep watch 把带 createdAt 的报告整体写进本地
    // 存储，attempts[i].plan 一并往返 —— 刷新/重进（hydrate）之后仍能复盘「这次补了几轮、
    // 上限/护栏有没有咬住」。
    await nextTick();
    const stored = JSON.parse(localStorage.getItem('mwi.triggerOptimizer.report.v1'));
    expect(stored.report.verification.attempts[0].plan.plannedRounds).toBe(18);
    expect(stored.report.verification.attempts[0].plan.capRounds).toBe(24);
    // §50 B-2 的两级护栏字段同样原样往返（store 不做二次加工，字段白名单在 domain）。
    expect(stored.report.verification.attempts[0].plan.limitedBy).toBeNull();
    expect(stored.report.verification.attempts[0].plan.spentSimulations).toBe(0);
    expect(store.triggerOptimizer.runtime.verifyAppend).toMatchObject({
      isRunning: false,
      phase: 'done',
      progress: 1,
    });
    // 结算后必须清掉「服务调用在途」：留着会让页面永久停在忙态（§29.9 的卡死教训）。
    expect(store.triggerOptimizer.runtime.serviceRunInFlight).toBe(false);
    // 只读动作：玩家配置与报告主体都没被动过。
    expect(store.activePlayer.triggerMap[ABILITY_HRID]).toBeUndefined();
    expect(store.triggerOptimizer.results.bestTriggerMap).toEqual({ [ABILITY_HRID]: [customTrigger(500)] });
  }, 60000);

  // 成本护栏与「一次都不派」的两种情形（2026-09-25，设计 §47）：追加场次不许超过整轮运行的 20%
  //（快档整轮只有 ~74 场，24 轮上限对它是 48% ⇒ 护栏必需）；而上限已尽 / 结论已明确时追加没有统计
  // 收益，白跑只是烧机器 —— 这两种情形必须一次模拟都不派，并把原因写进 runtime.verifyAppend.error。
  it('clamps the adaptive append by the cost guard and refuses a pointless append without dispatching', async () => {
    const store = importedStore();
    const baselineMap = { [ABILITY_HRID]: [customTrigger(100)] };
    const scope = { zoneHrid: '/actions/combat/fly', useDungeon: false, difficultyTier: 0, simulationHours: 24 };
    // 只有 score 摘要参与反解（生产里 paired.score 就是 summarizeSamples 的输出，一定带 rounds）。
    const verificationWith = (score, rounds = 6) => ({
      baselineMetrics: { rounds, samples: verificationSamples(100) },
      bestMetrics: { rounds, samples: verificationSamples(110) },
      paired: { rounds, score: { rounds, ...score } },
      verdict: String(score.verdict ?? 'inconclusive'),
      seeds: Array.from({ length: rounds }, (_, index) => index + 1),
      rounds,
      attempts: [],
    });

    await completeStart(
      store,
      makeResult({
        baselineTriggerMap: baselineMap,
        evaluationScope: scope,
        verification: verificationWith({ mean: 0.01, stdError: 0.02, verdict: 'inconclusive' }),
      }),
    );

    // ① 护栏咬住：整轮 100 场 ⇒ 单次预算 20 场 = 10 轮/侧（累计预算 40 场还没花过，不是瓶颈）。
    //    反解说「上限 24 轮也不够」⇒ A′ 先要补到上限（要 18 轮），再被单次护栏钳到 10 轮 ——
    //    实际派出去的轮数就必须是 10，瓶颈记为 'single'。
    store.triggerOptimizer.results.simulations = 100;
    const guarded = store.runTriggerOptimizerVerificationAppend();
    await vi.waitFor(() => expect(controls.appendCalls.length).toBe(1), { timeout: 20000 });
    expect(controls.appendCalls.at(-1).options.rounds).toBe(10);
    expect(controls.appendCalls.at(-1).options.plan?.limitedBy).toBe('single');
    controls.appendCalls.at(-1).resolve({ cancelled: true });
    await guarded;

    // ② 上限已尽：已经在上限（24 轮）且仍判不出 ⇒ 一轮都不追加，原因上屏（再加样本也判不出）。
    store.triggerOptimizer.results.verification = verificationWith(
      { mean: 0.005, stdError: 0.02, verdict: 'inconclusive' },
      24,
    );
    expect(await store.runTriggerOptimizerVerificationAppend()).toBe(false);
    expect(store.triggerOptimizer.runtime.verifyAppend.error).toBe('common:triggerOptimizer.verifyAppendExhausted');

    // ③ 结论已明确：（入口本就不会挂出来，store 是独立防线）⇒ 不派样本，error 说清「无需追加」。
    store.triggerOptimizer.results.verification = verificationWith({ mean: 0.05, stdError: 0.01, verdict: 'positive' });
    expect(await store.runTriggerOptimizerVerificationAppend()).toBe(false);
    expect(store.triggerOptimizer.runtime.verifyAppend.error).toBe('common:triggerOptimizer.verifyAppendDecisive');

    // ④ 护栏没有余量：反解说 9 轮就够（保底抬到 12 轮 ⇒ 要追加 6 轮），但整轮只有 8 场 ⇒ 单次预算
    //    1 场、累计预算 3 场（各自允许 0 轮 / 1 轮，单次才是最终瓶颈）⇒ 报「预算用尽」而不是
    //    「上限不够」—— 两个原因不同，出路也不同。
    store.triggerOptimizer.results.simulations = 8;
    store.triggerOptimizer.results.verification = verificationWith({
      mean: 0.04,
      stdError: 0.02,
      verdict: 'inconclusive',
    });
    expect(await store.runTriggerOptimizerVerificationAppend()).toBe(false);
    expect(store.triggerOptimizer.runtime.verifyAppend.error).toBe(
      'common:triggerOptimizer.verifyAppendBudgetExhausted',
    );
    // ⑤ 累计护栏咬住（2026-09-26，设计 §50 B-2）：整轮 100 场 ⇒ 累计预算 40 场；已经追加过 18 轮
    //    （36 场）⇒ 本次只剩 4 场 = 2 轮 —— 单次 20% 允许 10 轮，累计才是最终瓶颈（limitedBy）。
    store.triggerOptimizer.results.simulations = 100;
    store.triggerOptimizer.results.verification = {
      ...verificationWith({ mean: 0.01, stdError: 0.02, verdict: 'inconclusive' }),
      attempts: [{ attempt: 1, rounds: 18, mergedRounds: 24, mergedVerdict: 'inconclusive' }],
    };
    const cumulative = store.runTriggerOptimizerVerificationAppend();
    await vi.waitFor(() => expect(controls.appendCalls.length).toBe(2), { timeout: 20000 });
    expect(controls.appendCalls.at(-1).options.rounds).toBe(2);
    expect(controls.appendCalls.at(-1).options.plan?.limitedBy).toBe('cumulative');
    controls.appendCalls.at(-1).resolve({ cancelled: true });
    await cumulative;

    // ⑥ 累计预算用尽：累计已花正好 40 场（整轮的 40%）⇒ 一轮都不追加；原因必须报「预算用尽」
    //    （不是「上限不够」）—— 反解本身在 24 轮上限内是有解的，预算才是瓶颈。
    store.triggerOptimizer.results.verification = {
      ...verificationWith({ mean: 0.01, stdError: 0.02, verdict: 'inconclusive' }),
      attempts: [{ attempt: 1, rounds: 20, mergedRounds: 24, mergedVerdict: 'inconclusive' }],
    };
    expect(await store.runTriggerOptimizerVerificationAppend()).toBe(false);
    expect(store.triggerOptimizer.runtime.verifyAppend.error).toBe(
      'common:triggerOptimizer.verifyAppendBudgetExhausted',
    );

    // ②③④⑥ 都必须在服务调用之前返回：真正派出去的追加一共只有两次（① 的 10 轮、⑤ 的 2 轮）。
    expect(controls.appendCalls).toHaveLength(2);
  }, 60000);

  it('refuses the append when the report has no samples to merge, and never starts the service', async () => {
    const store = importedStore();

    // ① 还没有报告。
    expect(await store.runTriggerOptimizerVerificationAppend()).toBe(false);
    expect(store.triggerOptimizer.runtime.verifyAppend.error).toBe('common:triggerOptimizer.noResults');

    // ② 报告缺首轮复验样本（旧报告 / 复验没跑成）→ 明确报错请用户重跑搜索，不猜一份样本去追加。
    await completeStart(
      store,
      makeResult({
        baselineTriggerMap: { [ABILITY_HRID]: [customTrigger(100)] },
        evaluationScope: {
          zoneHrid: '/actions/combat/fly',
          useDungeon: false,
          difficultyTier: 0,
          simulationHours: 24,
        },
        verification: { verdict: 'inconclusive' },
      }),
    );
    expect(await store.runTriggerOptimizerVerificationAppend()).toBe(false);
    expect(store.triggerOptimizer.runtime.verifyAppend.error).toBe('common:triggerOptimizer.verifyAppendMissing');
    // 校验在服务调用之前：一次评估都不该被派出去。
    expect(controls.appendCalls).toHaveLength(0);
  }, 60000);

  it('refuses the re-check when the report has nothing to re-check, with a reason', async () => {
    const store = importedStore();

    // ① 还没有报告。
    expect(await store.runTriggerOptimizerRobustness()).toBe(false);
    expect(store.triggerOptimizer.runtime.robustness.error).toBe('common:triggerOptimizer.noResults');

    // ② 旧报告：本功能之前的报告没有搜索起点配置（复核的对照侧）→ 请用户重跑一次搜索。
    store.triggerOptimizer.results = {
      ...makeResult({ evaluationScope: { zoneHrid: '/actions/combat/fly', difficultyTier: 0 } }),
      createdAt: Date.now(),
    };
    expect(await store.runTriggerOptimizerRobustness()).toBe(false);
    expect(store.triggerOptimizer.runtime.robustness.error).toBe('common:triggerOptimizer.robustnessMissingBaseline');

    // ③ 目标没有相邻难度（合法区间查不到）→ 说明原因，而不是静默拿原难度重跑一遍假复核。
    store.triggerOptimizer.results = {
      ...makeResult({
        baselineTriggerMap: {},
        evaluationScope: { zoneHrid: '/actions/combat/not_a_real_zone', difficultyTier: 0 },
      }),
      createdAt: Date.now(),
    };
    expect(await store.runTriggerOptimizerRobustness()).toBe(false);
    expect(store.triggerOptimizer.runtime.robustness.error).toBe('common:triggerOptimizer.robustnessUnavailable');
    expect(controls.robustnessCalls).toHaveLength(0);
  }, 30000);

  it('stops an in-flight re-check through the shared cancel chain and drops its outcome', async () => {
    const store = importedStore();
    await completeStart(
      store,
      makeResult({
        baselineTriggerMap: {},
        evaluationScope: { zoneHrid: '/actions/combat/fly', difficultyTier: 0, simulationHours: 24 },
      }),
    );

    const pending = store.runTriggerOptimizerRobustness();
    await vi.waitFor(() => expect(controls.robustnessCalls.length).toBe(1), { timeout: 20000 });
    expect(store.triggerOptimizer.runtime.robustness.isRunning).toBe(true);

    store.stopTriggerOptimizer();
    expect(store.triggerOptimizer.runtime.robustness).toMatchObject({ isRunning: false, phase: 'cancelled' });

    // 在途结果作废（runId 已复位）→ 不写回报告，也不留错误（取消不是失败）。
    controls.robustnessCalls.at(-1).resolve({ cancelled: true, verdict: 'unknown' });
    await pending;

    // 报告里本来就没有复核结论（首跑态：搜索结果不带 robustness 键）：取消不留下任何东西。
    expect(store.triggerOptimizer.results.robustness).toBeFalsy();
    expect(store.triggerOptimizer.runtime.robustness.error).toBe('');
    // 收尾窗口结束：在途标志必须清掉（页面「忙」计算属性的响应式锚点）。
    expect(store.triggerOptimizer.runtime.serviceRunInFlight).toBe(false);
  }, 60000);

  // 导入新存档 / 恢复快照会重置会话内结果：在途的复核必须一起停掉 —— 它结束时是往
  // 「报告」里写结果的，留着会把上个存档的复核结论写到新报告上（2026-09-23）。
  it('stops an in-flight re-check when the session results are reset', async () => {
    const store = importedStore();
    await completeStart(
      store,
      makeResult({
        baselineTriggerMap: {},
        evaluationScope: { zoneHrid: '/actions/combat/fly', difficultyTier: 0, simulationHours: 24 },
      }),
    );
    const pending = store.runTriggerOptimizerRobustness();
    await vi.waitFor(() => expect(controls.robustnessCalls.length).toBe(1), { timeout: 20000 });
    // 这份报告没有复验统计（makeResult 不带 verification）⇒ 反解不出来 ⇒ 省略 rounds，由服务层
    // 缺省 6 轮兜底：旧报告的行为与自适应之前逐字一致（不留一个「凭空的计划」）。
    expect(controls.robustnessCalls.at(-1).options.rounds).toBeUndefined();
    expect(controls.robustnessCalls.at(-1).options.plan).toBeUndefined();

    store.resetTriggerOptimizerResults();

    expect(store.triggerOptimizer.runtime.robustness.isRunning).toBe(false);
    expect(store.triggerOptimizer.results.createdAt).toBeFalsy();

    // 在途结果作废（runId 已复位）→ 不写回新报告。
    controls.robustnessCalls.at(-1).resolve({ cancelled: false, verdict: 'positive', scoreDelta: 0.5 });
    await pending;

    expect(store.triggerOptimizer.results.robustness).toBeNull();
    expect(store.triggerOptimizer.runtime.serviceRunInFlight).toBe(false);
  }, 60000);

  // 报告落盘/恢复（2026-09-24，设计 §40）：最近一份报告自动持久化，换新 store 从存储恢复。
  it('persists the finished report and restores it in a fresh store', async () => {
    const store = importedStore();
    await completeStart(store, makeResult());
    await nextTick();

    const createdAt = store.triggerOptimizer.results.createdAt;
    expect(createdAt).toBeTruthy();
    const raw = localStorage.getItem('mwi.triggerOptimizer.report.v1');
    expect(raw).toBeTruthy();
    const stored = JSON.parse(raw);
    expect(stored.version).toBe(1);
    expect(stored.report.createdAt).toBe(createdAt);

    // 模拟刷新/重进：全新 pinia + 全新 store，state 工厂从存储 hydrate 最近一份报告。
    setActivePinia(createPinia());
    const restored = useSimulatorStore();
    expect(restored.triggerOptimizer.results.createdAt).toBe(createdAt);
    expect(restored.triggerOptimizer.results.bestTriggerMap).toEqual({
      [ABILITY_HRID]: [customTrigger(500)],
    });
  }, 60000);

  // 防丢语义（核心）：结果被清空（开跑/崩溃）**不删**存储 —— 上一份报告要能找回；
  // 只在 resetTriggerOptimizerResults（导入新存档）显式删除。
  it('keeps the stored report when results are cleared, and deletes it only on explicit reset', async () => {
    const store = importedStore();
    await completeStart(store, makeResult());
    await nextTick();
    expect(localStorage.getItem('mwi.triggerOptimizer.report.v1')).toBeTruthy();

    store.triggerOptimizer.results = {};
    await nextTick();
    expect(localStorage.getItem('mwi.triggerOptimizer.report.v1')).toBeTruthy();

    // 空结果自带 createdAt: 0（createEmptyResult 形状）——同样既不覆盖也不删除存档。
    store.triggerOptimizer.results = { createdAt: 0, stale: false };
    await nextTick();
    expect(localStorage.getItem('mwi.triggerOptimizer.report.v1')).toBeTruthy();

    store.resetTriggerOptimizerResults();
    await nextTick();
    expect(localStorage.getItem('mwi.triggerOptimizer.report.v1')).toBeNull();
  }, 60000);
});

// 技能触发器优化器 —— 追加复验（2026-09-24，设计 §31）。
//
// 用 SimulatedWorkerClient 桩跑 appendTriggerOptimizerVerification（与 racing.test.js 同款桩），
// 锁定四件事：
//   ① 合并重检：首轮 6 轮 + 追加 6 轮 → **12 轮样本一起**进 computePairedStats（不是只看新增
//      样本），verdict 是合并后的结论、seeds = 旧 6 + 新 6、attempts 留下本次的双口径记录；
//   ② 样本分割：attempt 1 / 2 的种子互不相交，且与 verify / search / screen 盐的种子全不相交
//      （「要不要追加」是拿上一轮结论做的决定 —— select on A，追加样本必须独立于那个决定）；
//   ③ 缺逐轮样本（旧报告 / 退化结构）→ 抛 MISSING_VERIFICATION_ERROR，不猜、不静默通过；
//   ④ 取消 → resolve { cancelled: true }（与 optimizeTriggers 同款：取消不算失败），
//      且**不写回**合并结论（旧字段原样带回 = 「什么都没追加」）。
import { afterEach, describe, expect, it, vi } from 'vitest';

import abilityDetailMap from '../../combatsimulator/data/abilityDetailMap.json';
import { createEmptyPlayerConfig } from '../../shared/playerConfig.js';
import {
  TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS,
  TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS,
  TRIGGER_OPTIMIZER_SEED_SALT_ROBUSTNESS,
  TRIGGER_OPTIMIZER_SEED_SALT_SCREEN,
  TRIGGER_OPTIMIZER_SEED_SALT_SEARCH,
  TRIGGER_OPTIMIZER_SEED_SALT_VERIFY,
  TRIGGER_OPTIMIZER_SEED_SALT_VERIFY_APPEND,
  TRIGGER_OPTIMIZER_VERIFY_MAX_ROUNDS,
  TRIGGER_OPTIMIZER_VERIFY_ROUNDS,
  createTriggerOptimizerSeedSet,
} from '../triggerOptimizerDomain.js';
import {
  MISSING_ROBUSTNESS_ERROR,
  MISSING_VERIFICATION_ERROR,
  appendTriggerOptimizerRobustness,
  appendTriggerOptimizerVerification,
  cancelTriggerOptimizerRun,
} from '../triggerOptimizerSearch.js';
import { computePairedStats } from '../triggerOptimizerScoring.js';
import { aggregateRoundMetrics } from '../triggerOptimizerSimulation.js';
import { cancelDedicatedWorkerRuns, cancelSharedWorkerRun } from '../simulatorWorkerRuns.js';

const SELF = '/combat_trigger_dependencies/self';
const CURRENT_HP = '/combat_trigger_conditions/current_hp';
const LTE = '/combat_trigger_comparators/less_than_equal';
const BASELINE_VALUE = 300;
const BEST_VALUE = 700;

const ABILITY_SLOT = 1;
const abilitiesWithDefaultTriggers = Object.values(abilityDetailMap).filter(
  (entry) =>
    entry?.isSpecialAbility !== true &&
    Array.isArray(entry?.defaultCombatTriggers) &&
    entry.defaultCombatTriggers.length > 0,
);
const ABILITY_HRID = String(abilitiesWithDefaultTriggers[0]?.hrid ?? '');

function buildSimResult(tier) {
  return {
    simulatedTime: 24 * 3600 * 1e9,
    encounters: 240 * tier,
    deaths: { player1: 0 },
    experienceGained: { player1: { attack: 48000 * tier } },
    attacks: { player1: {} },
    consumablesUsed: { player1: {} },
    playerRanOutOfMana: { player1: false },
  };
}

class SimulatedWorkerClient {
  static instances = [];
  static responder = null;

  constructor() {
    this.handlers = {};
    this.stopSimulation = () => {};
    SimulatedWorkerClient.instances.push(this);
  }

  startSimulation(payload, handlers = {}) {
    this.payload = payload;
    this.handlers = handlers;
    const response = SimulatedWorkerClient.responder?.(payload) ?? null;
    if (!response) return;
    if (response.error) {
      handlers.onError?.(new Error(response.error));
      return;
    }
    handlers.onResult?.(response.simResult);
  }
}

// 两个配置的区分只靠触发器 value（同 racing.test.js 的 syntheticValue 思路），并给逐轮一点
// 确定性抖动：两侧共享同一组种子（CRN），抖动按 seed 派生 ⇒ 配对差逐轮略有起伏、标准误非 0
// （全同的逐轮差会让 stdError=0，t 统计量退化，测不出「显著」这条路径）。
function trigger(value) {
  return { dependencyHrid: SELF, conditionHrid: CURRENT_HP, comparatorHrid: LTE, value };
}

function configValue(payload) {
  const first = payload?.players?.[0]?.abilities?.[ABILITY_SLOT]?.triggers?.[0];
  return first?.dependencyHrid === SELF && first?.conditionHrid === CURRENT_HP ? Number(first.value) : null;
}

function makeResponder() {
  return (payload) => {
    const jitter = 1 + ((Number(payload?.seed) >>> 0) % 7) * 0.002;
    const tier = (configValue(payload) === BEST_VALUE ? 1.3 : 1) * jitter;
    return { simResult: buildSimResult(tier) };
  };
}

function createInput(verification, overrides = {}) {
  const playerConfig = createEmptyPlayerConfig('1');
  playerConfig.abilities[ABILITY_SLOT] = { abilityHrid: ABILITY_HRID, level: 1 };
  return {
    playerConfig,
    simulationSettings: {
      mode: 'zone',
      zoneHrid: '/actions/combat/green_slimes',
      difficultyTier: 0,
      simulationTimeHours: 24,
    },
    bestTriggerMap: { [ABILITY_HRID]: [trigger(BEST_VALUE)] },
    baselineTriggerMap: { [ABILITY_HRID]: [trigger(BASELINE_VALUE)] },
    verification,
    WorkerClientCtor: SimulatedWorkerClient,
    ...overrides,
  };
}

const seedContext = () => ({
  playerId: '1',
  playerConfig: createEmptyPlayerConfig('1'),
  simulationSettings: {
    mode: 'zone',
    zoneHrid: '/actions/combat/green_slimes',
    difficultyTier: 0,
    simulationTimeHours: 24,
  },
});

// 首轮复验的报告：6 轮逐轮样本 + 「未达显著」结论（正是本功能的入口条件）。
function makeFirstVerification() {
  const baselineSamples = [];
  const bestSamples = [];
  for (let round = 0; round < TRIGGER_OPTIMIZER_VERIFY_ROUNDS; round += 1) {
    baselineSamples.push({
      dps: 100 + round,
      dailyProfit: 1000,
      dailyNoRngProfit: 1000 + round,
      xpPerHour: 500 + round,
      killsPerHour: 10,
      deathsPerHour: 0.1,
      ranOutOfMana: false,
    });
    // 首轮「有提升迹象但噪声盖过信号」：均值小、逐轮起伏大 ⇒ inconclusive。
    bestSamples.push({
      dps: 100 + round + (round % 2 === 0 ? 6 : -4),
      dailyProfit: 1000,
      dailyNoRngProfit: 1000 + round + (round % 2 === 0 ? 8 : -6),
      xpPerHour: 500 + round + (round % 2 === 0 ? 3 : -2),
      killsPerHour: 10,
      deathsPerHour: 0.1,
      ranOutOfMana: false,
    });
  }
  const baselineMetrics = aggregateRoundMetrics(baselineSamples);
  const bestMetrics = aggregateRoundMetrics(bestSamples);
  const paired = computePairedStats(bestMetrics, baselineMetrics);
  return {
    baselineMetrics,
    bestMetrics,
    paired,
    verdict: paired?.score?.verdict ?? 'unknown',
    seeds: createTriggerOptimizerSeedSet({
      ...seedContext(),
      salt: TRIGGER_OPTIMIZER_SEED_SALT_VERIFY,
      count: TRIGGER_OPTIMIZER_VERIFY_ROUNDS,
    }),
    rounds: TRIGGER_OPTIMIZER_VERIFY_ROUNDS,
    attempts: [],
  };
}

afterEach(() => {
  cancelTriggerOptimizerRun();
  cancelDedicatedWorkerRuns();
  cancelSharedWorkerRun();
  SimulatedWorkerClient.responder = null;
  SimulatedWorkerClient.instances = [];
});

describe('追加复验（合并样本重检）', () => {
  it('把首轮 6 轮与追加 6 轮合并成 12 轮重检，并留下双口径的 attempts 留档', async () => {
    const first = makeFirstVerification();
    // 前提自证：首轮确实判「未达显著」—— 本功能的入口条件。
    expect(first.verdict).toBe('inconclusive');
    SimulatedWorkerClient.responder = makeResponder();

    const result = await appendTriggerOptimizerVerification(createInput(first), { attempt: 1 });

    // ① 合并 6 + 6 = 12 轮：两侧样本、配对统计、报告轮数全部是合并口径。
    expect(result.baselineMetrics.samples).toHaveLength(12);
    expect(result.bestMetrics.samples).toHaveLength(12);
    expect(result.rounds).toBe(12);
    expect(result.paired.rounds).toBe(12);
    expect(result.verdict).toBe('positive');
    // 合并重检与「只看新增样本」不是一回事：前 6 轮就是首轮的样本（逐轮一一对得上）。
    expect(result.baselineMetrics.samples.slice(0, 6).map((sample) => sample.dps)).toEqual(
      first.baselineMetrics.samples.map((sample) => sample.dps),
    );

    // ② 计数口径：2 次评估 × 6 轮 = 12 场，精确不多不少（与 racing.test.js 的成本契约同款）。
    expect(result.evaluations).toBe(2);
    expect(result.simulations).toBe(12);
    expect(SimulatedWorkerClient.instances).toHaveLength(12);

    // ③ seeds = 旧 6 + 新 6；attempts 留下「本次新增样本自身的统计」+「合并后的结论」两条口径。
    expect(result.seeds).toHaveLength(12);
    expect(result.seeds.slice(0, 6)).toEqual(first.seeds);
    expect(result.attempts).toHaveLength(1);
    const attempt = result.attempts[0];
    expect(attempt.attempt).toBe(1);
    expect(attempt.rounds).toBe(6);
    expect(attempt.seeds).toHaveLength(6);
    expect(attempt.mergedRounds).toBe(12);
    expect(attempt.mergedVerdict).toBe(result.verdict);
    expect(attempt.verdict).toBe(String(attempt.paired?.score?.verdict ?? 'unknown'));
    // 合并结论 = 用合并后的两侧样本重算的配对统计（自证「判据看的是全部 12 轮」）。
    const recomputed = computePairedStats(result.bestMetrics, result.baselineMetrics);
    expect(result.verdict).toBe(recomputed?.score?.verdict);
    expect(result.paired.rounds).toBe(recomputed.rounds);
  });

  it('每次追加换一层盐：attempt 1 / 2 的种子互不相交，也与 verify / search / screen 全不相交', async () => {
    SimulatedWorkerClient.responder = makeResponder();
    const first = makeFirstVerification();

    const one = await appendTriggerOptimizerVerification(createInput(first), { attempt: 1 });
    const two = await appendTriggerOptimizerVerification(createInput(one), { attempt: 2 });

    // attempts 是**留档**：每次追加只在末尾加一条，旧记录（含它用过的种子）原样保留。
    expect(one.attempts).toHaveLength(1);
    expect(two.attempts).toHaveLength(2);
    expect(two.attempts[0]).toEqual(one.attempts[0]);
    const attemptOneSeeds = two.attempts[0].seeds;
    const attemptTwoSeeds = two.attempts[1].seeds;
    expect(attemptOneSeeds).toHaveLength(TRIGGER_OPTIMIZER_VERIFY_ROUNDS);
    expect(attemptTwoSeeds).toHaveLength(TRIGGER_OPTIMIZER_VERIFY_ROUNDS);
    expect(attemptOneSeeds.some((seed) => attemptTwoSeeds.includes(seed))).toBe(false);
    // seeds 逐次累加：首轮复验 6 + 两次追加各 6 = 18（与合并轮数同口径）。
    expect(two.seeds).toHaveLength(18);
    expect(two.rounds).toBe(18);

    // 与生产同源的派生：上下文必须与 createInput 的**同一份**（playerId + 佩戴技能 + 目标/难度/时长），
    // 否则「期望种子」与实际种子根本不可比；追加的盐是 `${VERIFY_APPEND}.v${attempt}`。
    const derived = (salt) => {
      const playerConfig = createEmptyPlayerConfig('1');
      playerConfig.abilities[ABILITY_SLOT] = { abilityHrid: ABILITY_HRID, level: 1 };
      return createTriggerOptimizerSeedSet({
        playerId: '1',
        playerConfig,
        simulationSettings: {
          mode: 'zone',
          zoneHrid: '/actions/combat/green_slimes',
          difficultyTier: 0,
          simulationTimeHours: 24,
        },
        salt,
        count: TRIGGER_OPTIMIZER_VERIFY_ROUNDS,
      });
    };
    expect(attemptOneSeeds).toEqual(derived(`${TRIGGER_OPTIMIZER_SEED_SALT_VERIFY_APPEND}.v1`));
    expect(attemptTwoSeeds).toEqual(derived(`${TRIGGER_OPTIMIZER_SEED_SALT_VERIFY_APPEND}.v2`));
    const otherSalts = [
      TRIGGER_OPTIMIZER_SEED_SALT_VERIFY,
      TRIGGER_OPTIMIZER_SEED_SALT_SEARCH,
      TRIGGER_OPTIMIZER_SEED_SALT_SCREEN,
    ];
    for (const seeds of [attemptOneSeeds, attemptTwoSeeds]) {
      for (const salt of otherSalts) {
        expect(seeds.some((seed) => derived(salt).includes(seed))).toBe(false);
      }
    }
  });

  it('报告缺逐轮样本时明确报错，而不是猜一份样本去追加', async () => {
    SimulatedWorkerClient.responder = makeResponder();
    const missing = makeFirstVerification();
    delete missing.baselineMetrics.samples;
    await expect(appendTriggerOptimizerVerification(createInput(missing), { attempt: 1 })).rejects.toThrow(
      MISSING_VERIFICATION_ERROR,
    );

    // 退化结构（空 samples）与两侧轮数不齐都算「无从合并」。
    const degenerate = makeFirstVerification();
    degenerate.bestMetrics = { ...degenerate.bestMetrics, samples: [] };
    await expect(appendTriggerOptimizerVerification(createInput(degenerate), { attempt: 1 })).rejects.toThrow(
      MISSING_VERIFICATION_ERROR,
    );

    const ragged = makeFirstVerification();
    ragged.bestMetrics = { ...ragged.bestMetrics, samples: ragged.bestMetrics.samples.slice(0, 3) };
    await expect(appendTriggerOptimizerVerification(createInput(ragged), { attempt: 1 })).rejects.toThrow(
      MISSING_VERIFICATION_ERROR,
    );
    // 三次失败都不该真的跑过模拟（校验在注册运行/派生种子之前）。
    expect(SimulatedWorkerClient.instances).toHaveLength(0);
  });

  it('取消时 resolve cancelled，且不写回合并结论（旧字段原样带回）', async () => {
    SimulatedWorkerClient.responder = makeResponder();
    const first = makeFirstVerification();

    const pending = appendTriggerOptimizerVerification(createInput(first), {
      attempt: 1,
      onProgress: (update) => {
        // 第 1 次评估收尾后立刻请求取消 ⇒ 第 2 次评估的 ensureActive() 抛取消错误。
        if (Number(update?.evaluations) >= 1) cancelTriggerOptimizerRun();
      },
    });
    const result = await pending;

    expect(result.cancelled).toBe(true);
    expect(result.error).toBe('');
    // 对照侧先跑完（6 场），最优侧一次都没跑：取消发生在两次评估之间。
    expect(result.evaluations).toBe(1);
    expect(result.simulations).toBe(6);
    // 「什么都没追加」：结论字段仍是首轮的（12 轮合并口径绝不凭空出现）。
    expect(result.rounds).toBe(TRIGGER_OPTIMIZER_VERIFY_ROUNDS);
    expect(result.baselineMetrics.samples).toHaveLength(6);
    expect(result.seeds).toHaveLength(TRIGGER_OPTIMIZER_VERIFY_ROUNDS);
    expect(result.attempts).toHaveLength(0);
    expect(result.verdict).toBe(first.verdict);
  });

  // 自适应轮数（2026-09-25，设计 §47）：调用方按反解传来的轮数可以超过搜索期的轮数上限（当时 10、
  // 2026-09-27 起 12），复验口径的上限是 24 —— 用搜索口径归一化会把「要 18 轮」静默钳成小值，
  // 这里把这条锁住；顺带锁住越界值的处置：不 clamp 到边界，而是按归一化口径回落产品默认（6 轮）。
  it('honours adaptive round counts beyond the search-rounds cap, and defaults out-of-range counts', async () => {
    SimulatedWorkerClient.responder = makeResponder();
    const first = makeFirstVerification();

    const adaptive = await appendTriggerOptimizerVerification(createInput(first), { attempt: 1, rounds: 18 });
    expect(adaptive.rounds).toBe(24);
    expect(adaptive.baselineMetrics.samples).toHaveLength(24);
    expect(adaptive.bestMetrics.samples).toHaveLength(24);
    expect(adaptive.seeds).toHaveLength(24);
    // 计数口径：2 次评估 × 18 轮 = 36 场，精确不多不少。
    expect(adaptive.evaluations).toBe(2);
    expect(adaptive.simulations).toBe(36);
    expect(SimulatedWorkerClient.instances).toHaveLength(36);
    // attempts 留档记的是**本次新增样本**的轮数（18），不是合并后的 24。
    expect(adaptive.attempts).toHaveLength(1);
    expect(adaptive.attempts[0].rounds).toBe(18);
    expect(adaptive.attempts[0].seeds).toHaveLength(18);
    expect(adaptive.attempts[0].mergedRounds).toBe(24);

    // 上限本身（24 轮）是合法值：照跑 48 场，不因为「贴着上限」被当成脏数据。
    const atCap = await appendTriggerOptimizerVerification(createInput(first), {
      attempt: 2,
      rounds: TRIGGER_OPTIMIZER_VERIFY_MAX_ROUNDS,
    });
    expect(atCap.attempts[0].rounds).toBe(TRIGGER_OPTIMIZER_VERIFY_MAX_ROUNDS);
    expect(atCap.simulations).toBe(2 * TRIGGER_OPTIMIZER_VERIFY_MAX_ROUNDS);
    expect(atCap.rounds).toBe(TRIGGER_OPTIMIZER_VERIFY_ROUNDS + TRIGGER_OPTIMIZER_VERIFY_MAX_ROUNDS);

    // 越界值（99 > 上限）不 clamp 到边界，而是回落产品默认 —— 与全项目「脏数据跟随产品默认，
    // 不钳到边界」同款（见 domain 的 normalizeBoundedNumber）：调用方算错时少花样本比多花安全。
    const outOfRange = await appendTriggerOptimizerVerification(createInput(first), { attempt: 3, rounds: 99 });
    expect(outOfRange.attempts[0].rounds).toBe(TRIGGER_OPTIMIZER_VERIFY_ROUNDS);
    expect(outOfRange.simulations).toBe(2 * TRIGGER_OPTIMIZER_VERIFY_ROUNDS);
    expect(outOfRange.rounds).toBe(2 * TRIGGER_OPTIMIZER_VERIFY_ROUNDS);
  });

  // 计划快照留档（2026-09-25，设计 §48）：自适应轮数（§47）只有进报告才能事后复盘「这次补了几轮、
  // 上限/护栏有没有咬住」—— 调用方把计划从 options.plan 带进来，服务层净化后写进 attempts[i].plan；
  // 不自洽（plannedRounds ≠ 实际执行的 rounds）或没带时**不留档**（宁可不留，也不留矛盾数据）。
  it('archives the append plan snapshot only when it is self-consistent with the executed rounds', async () => {
    SimulatedWorkerClient.responder = makeResponder();
    const first = makeFirstVerification();
    const plan = {
      decisive: false,
      capped: false,
      budgetLimited: false,
      // 成本护栏的两级字段（2026-09-26，设计 §50 B-2）：第一次追加（spent = 0）；整轮 370 场 ⇒
      // 单次预算 74 场 / 累计预算 148 场（都没咬）。
      limitedBy: null,
      currentRounds: 6,
      requiredRounds: 18,
      capRounds: 24,
      targetRounds: 24,
      plannedRounds: 18,
      plannedSimulations: 36,
      budgetSimulations: 74,
      spentSimulations: 0,
      cumulativeBudgetSimulations: 148,
    };

    const archived = await appendTriggerOptimizerVerification(createInput(first), {
      attempt: 1,
      rounds: 18,
      plan,
    });
    // 快照逐字段留档（与 plan 函数的输出同构），并且与实际执行的轮数一致。
    expect(archived.attempts[0].rounds).toBe(18);
    expect(archived.attempts[0].plan).toEqual(plan);

    // 不自洽（plan 说 30 轮、实际归一化后只跑 6 轮）：整份丢弃 —— 留档它会把复盘带偏。
    const inconsistent = await appendTriggerOptimizerVerification(createInput(first), {
      attempt: 2,
      rounds: 6,
      plan: { ...plan, plannedRounds: 30 },
    });
    expect('plan' in inconsistent.attempts[0]).toBe(false);
    expect(inconsistent.attempts[0].rounds).toBe(6);

    // 没带 plan（旧调用方 / 反解不出来）：不留 plan 字段，其余留档照旧（服务层缺省口径不变）。
    const legacy = await appendTriggerOptimizerVerification(createInput(first), { attempt: 3, rounds: 6 });
    expect('plan' in legacy.attempts[0]).toBe(false);
    expect(legacy.attempts[0].rounds).toBe(6);

    // 可空项合法：capped（上限也不够）时 requiredRounds = null；报告没有整轮场次时护栏不存在，
    // budgetSimulations / cumulativeBudgetSimulations = null —— 这些 null 按原样留档，不丢整份快照。
    const cappedPlan = {
      decisive: false,
      capped: true,
      budgetLimited: false,
      limitedBy: null,
      currentRounds: 6,
      requiredRounds: null,
      capRounds: 24,
      targetRounds: 24,
      plannedRounds: 18,
      plannedSimulations: 36,
      budgetSimulations: null,
      spentSimulations: 0,
      cumulativeBudgetSimulations: null,
    };
    const capped = await appendTriggerOptimizerVerification(createInput(first), {
      attempt: 4,
      rounds: 18,
      plan: cappedPlan,
    });
    expect(capped.attempts[0].plan).toEqual(cappedPlan);

    // 脏 plan（类型不符）：整份丢弃，追加本身照跑（留档失败不该阻断真正的动作）。
    const dirty = await appendTriggerOptimizerVerification(createInput(first), {
      attempt: 5,
      rounds: 6,
      plan: { ...plan, plannedRounds: '18', capRounds: Number.NaN, budgetLimited: 'no' },
    });
    expect('plan' in dirty.attempts[0]).toBe(false);
    expect(dirty.attempts[0].rounds).toBe(6);
    expect(dirty.simulations).toBe(12);
  });
});

// 复核追加（2026-09-26，设计 §51）：报告已有复核结论时再点复核 = 换盐追加（不再同盐复跑：
// §51 装置实测同盐两次派生逐值相同、信息增量 0 ⇒ 纯白烧）。锁定四件事：
//   ① 合并重检：首跑 6 轮 + 追加 6 轮 → **12 轮样本一起**进 computePairedStats，verdict 是
//      合并后的结论、seeds = 旧 6 + 新 6、attempts 留下本次的双口径记录；
//   ② 样本分割：盐 = robustness 盐 + `.r${attempt}` ⇒ 各次追加互不相交，且与首跑复核 /
//      复验追加 / 搜索 / 粗筛全不相交（「要不要追加」是拿已合并结论做的决定，新样本必须
//      独立于那个决定 —— §21 的可选停时教训）；
//   ③ 缺逐轮样本（旧报告 / 退化结构 / 完全没有 previousRobustness）→ 抛
//      MISSING_ROBUSTNESS_ERROR，不猜、不静默通过；
//   ④ 取消 → resolve { cancelled: true }（取消不算失败），且**不写回**合并结论
//      （旧字段原样带回 = 「什么都没追加」）。
describe('复核追加（换盐新样本与首跑合并重检）', () => {
  // 种子派生上下文必须与 createInput 的同一份（playerId + 佩戴技能 + 目标/难度/时长），
  // 否则「期望种子」与实际种子根本不可比（盐是 `${ROBUSTNESS}.r${attempt}`）。
  function robustnessSeedContext() {
    const playerConfig = createEmptyPlayerConfig('1');
    playerConfig.abilities[ABILITY_SLOT] = { abilityHrid: ABILITY_HRID, level: 1 };
    return {
      playerId: '1',
      playerConfig,
      simulationSettings: {
        mode: 'zone',
        zoneHrid: '/actions/combat/green_slimes',
        difficultyTier: 0,
        simulationTimeHours: 24,
      },
    };
  }

  // 首跑复核的记录：6 轮逐轮样本（两侧同长）+ 「未达显著」结论（追加的入口条件）。
  function makeFirstRobustness() {
    const baselineSamples = [];
    const bestSamples = [];
    for (let round = 0; round < TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS; round += 1) {
      baselineSamples.push({
        dps: 100 + round,
        dailyProfit: 1000,
        dailyNoRngProfit: 1000 + round,
        xpPerHour: 500 + round,
        killsPerHour: 10,
        deathsPerHour: 0.1,
        ranOutOfMana: false,
      });
      // 「有提升迹象但噪声盖过信号」：均值小、逐轮起伏大 ⇒ inconclusive。
      bestSamples.push({
        dps: 100 + round + (round % 2 === 0 ? 6 : -4),
        dailyProfit: 1000,
        dailyNoRngProfit: 1000 + round + (round % 2 === 0 ? 8 : -6),
        xpPerHour: 500 + round + (round % 2 === 0 ? 3 : -2),
        killsPerHour: 10,
        deathsPerHour: 0.1,
        ranOutOfMana: false,
      });
    }
    const baselineMetrics = aggregateRoundMetrics(baselineSamples);
    const bestMetrics = aggregateRoundMetrics(bestSamples);
    const paired = computePairedStats(bestMetrics, baselineMetrics);
    return {
      difficultyTier: 0,
      zoneHrid: '/actions/combat/green_slimes',
      baselineMetrics,
      bestMetrics,
      paired,
      verdict: String(paired?.score?.verdict ?? 'unknown'),
      scoreDelta: Number(paired?.score?.mean) || 0,
      profitDelta: Number(paired?.metrics?.dailyNoRngProfit?.mean) || 0,
      seeds: createTriggerOptimizerSeedSet({
        ...robustnessSeedContext(),
        salt: TRIGGER_OPTIMIZER_SEED_SALT_ROBUSTNESS,
        count: TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS,
      }),
      rounds: TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS,
      attempts: [],
    };
  }

  const createAppendInput = (previous, overrides = {}) =>
    createInput(null, { previousRobustness: previous, ...overrides });

  it('把首跑 6 轮与追加 6 轮合并成 12 轮重检，并留下双口径的 attempts 留档', async () => {
    const first = makeFirstRobustness();
    // 前提自证：首跑确实判「未达显著」—— 追加的入口条件。
    expect(first.verdict).toBe('inconclusive');
    SimulatedWorkerClient.responder = makeResponder();

    const result = await appendTriggerOptimizerRobustness(createAppendInput(first), {
      attempt: 1,
      targetTier: 0,
    });

    // ① 合并 6 + 6 = 12 轮：两侧样本、配对统计、报告轮数全部是合并口径。
    expect(result.baselineMetrics.samples).toHaveLength(12);
    expect(result.bestMetrics.samples).toHaveLength(12);
    expect(result.rounds).toBe(12);
    expect(result.paired.rounds).toBe(12);
    expect(result.verdict).toBe('positive');
    // 合并重检与「只看新增样本」不是一回事：前 6 轮就是首跑的样本（逐轮一一对得上）。
    expect(result.baselineMetrics.samples.slice(0, 6).map((sample) => sample.dps)).toEqual(
      first.baselineMetrics.samples.map((sample) => sample.dps),
    );

    // ② 计数口径：2 次评估 × 6 轮 = 12 场，精确不多不少（与 racing.test.js 的成本契约同款）。
    expect(result.evaluations).toBe(2);
    expect(result.simulations).toBe(12);
    expect(SimulatedWorkerClient.instances).toHaveLength(12);

    // ③ seeds = 旧 6 + 新 6；attempts 留下「本次新增样本自身的统计」+「合并后的结论」两条口径。
    expect(result.seeds).toHaveLength(12);
    expect(result.seeds.slice(0, 6)).toEqual(first.seeds);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].attempt).toBe(1);
    expect(result.attempts[0].rounds).toBe(6);
    expect(result.attempts[0].seeds).toHaveLength(6);
    expect(result.attempts[0].mergedRounds).toBe(12);
    expect(result.attempts[0].mergedVerdict).toBe(result.verdict);
    expect(result.attempts[0].verdict).toBe(String(result.attempts[0].paired?.score?.verdict ?? 'unknown'));
    // 合并结论 = 用合并后的两侧样本重算的配对统计（自证「判据看的是全部 12 轮」）。
    const recomputed = computePairedStats(result.bestMetrics, result.baselineMetrics);
    expect(result.verdict).toBe(recomputed?.score?.verdict);
    expect(result.paired.rounds).toBe(recomputed.rounds);
    // 难度沿用首跑记录（追加不换难度）。
    expect(result.difficultyTier).toBe(0);
  });

  it('每次追加换一层盐：.r1 / .r2 互不相交，也与首跑复核及其它阶段全不相交', async () => {
    SimulatedWorkerClient.responder = makeResponder();
    const first = makeFirstRobustness();

    const one = await appendTriggerOptimizerRobustness(createAppendInput(first), { attempt: 1, targetTier: 0 });
    const two = await appendTriggerOptimizerRobustness(createAppendInput(one), { attempt: 2, targetTier: 0 });

    // attempts 是**留档**：每次追加只在末尾加一条，旧记录（含它用过的种子）原样保留。
    expect(one.attempts).toHaveLength(1);
    expect(two.attempts).toHaveLength(2);
    expect(two.attempts[0]).toEqual(one.attempts[0]);
    const attemptOneSeeds = two.attempts[0].seeds;
    const attemptTwoSeeds = two.attempts[1].seeds;
    expect(attemptOneSeeds).toHaveLength(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
    expect(attemptTwoSeeds).toHaveLength(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
    expect(attemptOneSeeds.some((seed) => attemptTwoSeeds.includes(seed))).toBe(false);
    // 与首跑复核的种子也不相交（追加样本必须独立于「要不要追加」这个决定）。
    expect(first.seeds.some((seed) => attemptOneSeeds.includes(seed) || attemptTwoSeeds.includes(seed))).toBe(false);
    // seeds 逐次累加：首跑 6 + 两次追加各 6 = 18（与合并轮数同口径）。
    expect(two.seeds).toHaveLength(18);
    expect(two.rounds).toBe(18);

    // 与生产同源的派生：盐 = `${ROBUSTNESS}.r${attempt}`。
    const derived = (salt) =>
      createTriggerOptimizerSeedSet({
        ...robustnessSeedContext(),
        salt,
        count: TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS,
      });
    expect(attemptOneSeeds).toEqual(derived(`${TRIGGER_OPTIMIZER_SEED_SALT_ROBUSTNESS}.r1`));
    expect(attemptTwoSeeds).toEqual(derived(`${TRIGGER_OPTIMIZER_SEED_SALT_ROBUSTNESS}.r2`));
    for (const salt of [
      TRIGGER_OPTIMIZER_SEED_SALT_ROBUSTNESS,
      TRIGGER_OPTIMIZER_SEED_SALT_VERIFY,
      TRIGGER_OPTIMIZER_SEED_SALT_VERIFY_APPEND,
      TRIGGER_OPTIMIZER_SEED_SALT_SEARCH,
      TRIGGER_OPTIMIZER_SEED_SALT_SCREEN,
    ]) {
      expect(attemptOneSeeds.some((seed) => derived(salt).includes(seed))).toBe(false);
      expect(attemptTwoSeeds.some((seed) => derived(salt).includes(seed))).toBe(false);
    }
  });

  it('报告缺复核逐轮样本时明确报错，而不是猜一份样本去追加', async () => {
    SimulatedWorkerClient.responder = makeResponder();

    const missing = makeFirstRobustness();
    delete missing.baselineMetrics.samples;
    await expect(
      appendTriggerOptimizerRobustness(createAppendInput(missing), { attempt: 1, targetTier: 0 }),
    ).rejects.toThrow(MISSING_ROBUSTNESS_ERROR);

    // 退化结构（空 samples）与两侧轮数不齐都算「无从合并」。
    const degenerate = makeFirstRobustness();
    degenerate.bestMetrics = { ...degenerate.bestMetrics, samples: [] };
    await expect(
      appendTriggerOptimizerRobustness(createAppendInput(degenerate), { attempt: 1, targetTier: 0 }),
    ).rejects.toThrow(MISSING_ROBUSTNESS_ERROR);

    const ragged = makeFirstRobustness();
    ragged.bestMetrics = { ...ragged.bestMetrics, samples: ragged.bestMetrics.samples.slice(0, 3) };
    await expect(
      appendTriggerOptimizerRobustness(createAppendInput(ragged), { attempt: 1, targetTier: 0 }),
    ).rejects.toThrow(MISSING_ROBUSTNESS_ERROR);

    // 完全没有 previousRobustness（旧调用方）同样明确报错，不静默通过。
    await expect(appendTriggerOptimizerRobustness(createInput(null), { attempt: 1, targetTier: 0 })).rejects.toThrow(
      MISSING_ROBUSTNESS_ERROR,
    );

    // 四次失败都不该真的跑过模拟（校验在注册运行/派生种子之前）。
    expect(SimulatedWorkerClient.instances).toHaveLength(0);
  });

  it('取消时 resolve cancelled，且不写回合并结论（旧字段原样带回）', async () => {
    SimulatedWorkerClient.responder = makeResponder();
    const first = makeFirstRobustness();

    const pending = appendTriggerOptimizerRobustness(createAppendInput(first), {
      attempt: 1,
      targetTier: 0,
      onProgress: (update) => {
        // 第 1 次评估收尾后立刻请求取消 ⇒ 第 2 次评估的 ensureActive() 抛取消错误。
        if (Number(update?.evaluations) >= 1) cancelTriggerOptimizerRun();
      },
    });
    const result = await pending;

    expect(result.cancelled).toBe(true);
    expect(result.error).toBe('');
    // 对照侧先跑完（6 场），最优侧一次都没跑：取消发生在两次评估之间。
    expect(result.evaluations).toBe(1);
    expect(result.simulations).toBe(6);
    // 「什么都没追加」：结论字段仍是首跑的（12 轮合并口径绝不凭空出现）。
    expect(result.rounds).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
    expect(result.baselineMetrics.samples).toHaveLength(6);
    expect(result.seeds).toHaveLength(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
    expect(result.attempts).toHaveLength(0);
    expect(result.verdict).toBe(first.verdict);
  });

  // 计划快照留档（§51）+ 轮数口径：追加轮数走**复核口径**的上限 16（不复用搜索口径 —— 语义不同，
  // 历史上搜索口径曾把「补到 12 轮」静默钳成 10 轮）；越界值回落产品默认（少花比多花安全）。
  it('archives the append plan snapshot only when self-consistent, and honours the robustness cap', async () => {
    SimulatedWorkerClient.responder = makeResponder();
    const first = makeFirstRobustness();
    const plan = {
      capped: true,
      budgetLimited: false,
      limitedBy: null,
      currentRounds: 6,
      requiredRounds: null,
      capRounds: TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS,
      plannedRounds: 6,
      plannedSimulations: 12,
      budgetSimulations: 16,
      zeroDiff: false,
      atCap: false,
      spentSimulations: 0,
      cumulativeBudgetSimulations: 33,
    };

    const archived = await appendTriggerOptimizerRobustness(createAppendInput(first), {
      attempt: 1,
      targetTier: 0,
      rounds: 6,
      plan,
    });
    expect(archived.attempts[0].rounds).toBe(6);
    expect(archived.attempts[0].plan).toEqual(plan);

    // 不自洽（plan 说 12 轮、实际 6 轮）：整份丢弃 —— 留档它会把复盘带偏。
    const inconsistent = await appendTriggerOptimizerRobustness(createAppendInput(first), {
      attempt: 2,
      targetTier: 0,
      rounds: 6,
      plan: { ...plan, plannedRounds: 12 },
    });
    expect('plan' in inconsistent.attempts[0]).toBe(false);

    // 没带 plan（旧调用方 / 计划退化）：不留 plan 字段，其余留档照旧。
    const legacy = await appendTriggerOptimizerRobustness(createAppendInput(first), {
      attempt: 3,
      targetTier: 0,
      rounds: 6,
    });
    expect('plan' in legacy.attempts[0]).toBe(false);

    // 追加轮数按复核口径的上限 16 收，16 本身也是合法值 —— 一次追加就把首跑 6 轮合并到 22 轮。
    const fill = await appendTriggerOptimizerRobustness(createAppendInput(first), {
      attempt: 4,
      targetTier: 0,
      rounds: TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS,
    });
    expect(fill.attempts[0].rounds).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS);
    expect(fill.rounds).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS + TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS);
    expect(fill.simulations).toBe(2 * TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS);

    // 越界值（99 > 上限）不钳到边界，而是回落产品默认 6 轮。
    const outOfRange = await appendTriggerOptimizerRobustness(createAppendInput(first), {
      attempt: 5,
      targetTier: 0,
      rounds: 99,
    });
    expect(outOfRange.attempts[0].rounds).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
    expect(outOfRange.simulations).toBe(2 * TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
  });
});

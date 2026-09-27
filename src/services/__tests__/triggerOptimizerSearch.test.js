import { afterEach, describe, expect, it, vi } from 'vitest';

import abilityDetailMap from '../../combatsimulator/data/abilityDetailMap.json';
import { createEmptyPlayerConfig } from '../../shared/playerConfig.js';
import {
  TRIGGER_OPTIMIZER_DEEP_DIVE_ROUNDS,
  TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS,
  TRIGGER_OPTIMIZER_DEFAULT_ROUNDS,
  TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS,
  TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS,
  TRIGGER_OPTIMIZER_SEED_SALT_ROBUSTNESS,
  TRIGGER_OPTIMIZER_SEED_SALT_SEARCH,
  TRIGGER_OPTIMIZER_VERIFY_ROUNDS,
  createTriggerOptimizerSeedSet,
} from '../triggerOptimizerDomain.js';
import { scoreCandidate, TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE } from '../triggerOptimizerScoring.js';
import { ONE_HOUR } from '../simulationDomain.js';
import {
  MISSING_TRIGGER_MAP_ERROR,
  SHARED_RUN_BUSY_ERROR,
  TRIGGER_OPTIMIZER_BUSY_ERROR,
  cancelTriggerOptimizerRun,
  hasTriggerOptimizerRunInProgress,
  optimizeTriggers,
  verifyTriggerOptimizerRobustness,
} from '../triggerOptimizerSearch.js';
import {
  cancelDedicatedWorkerRuns,
  cancelSharedWorkerRun,
  runSharedSingleSimulationPayload,
} from '../simulatorWorkerRuns.js';

// 技能槽 1 的智力要求是 abilitySlotsLevelRequirementList[2] === 1。
const ABILITY_SLOT = 1;
// 技能槽 2 的智力要求是 abilitySlotsLevelRequirementList[3] === 20（多槽叠加用例需要两个可搜槽）。
const SECOND_ABILITY_SLOT = 2;
const SECOND_SLOT_REQUIRED_INTELLIGENCE = 20;

function findFirstAbilityWithDefaultTriggers() {
  const ability = Object.values(abilityDetailMap).find(
    (entry) =>
      entry?.isSpecialAbility !== true &&
      Array.isArray(entry?.defaultCombatTriggers) &&
      entry.defaultCombatTriggers.length > 0,
  );
  return ability?.hrid ?? '';
}

function findAnotherAbilityWithDefaultTriggers() {
  const ability = Object.values(abilityDetailMap).find(
    (entry) =>
      entry?.isSpecialAbility !== true &&
      entry.hrid !== ABILITY_HRID &&
      Array.isArray(entry?.defaultCombatTriggers) &&
      entry.defaultCombatTriggers.length > 0,
  );
  return ability?.hrid ?? '';
}

const ABILITY_HRID = findFirstAbilityWithDefaultTriggers();
const SECOND_ABILITY_HRID = findAnotherAbilityWithDefaultTriggers();

// 最小可打分的 simResult（同 triggerOptimizerSimulation.test.js 的构造）。
function buildSimResult(overrides = {}) {
  return {
    simulatedTime: 24 * ONE_HOUR,
    encounters: 240,
    deaths: { player1: 0 },
    experienceGained: { player1: { attack: 48000 } },
    attacks: { player1: {} },
    consumablesUsed: { player1: {} },
    playerRanOutOfMana: { player1: false },
    ...overrides,
  };
}

// 响应器约定：返回 { simResult } / { error } / null（挂起）。
class SimulatedWorkerClient {
  static instances = [];
  static responder = null;

  constructor() {
    this.handlers = {};
    this.stopSimulation = vi.fn();
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

function payloadSlotTriggers(payload) {
  const triggers = payload?.players?.[0]?.abilities?.[ABILITY_SLOT]?.triggers;
  return Array.isArray(triggers) ? triggers : null;
}

function payloadSlotTriggersAt(payload, slotIndex) {
  const triggers = payload?.players?.[0]?.abilities?.[slotIndex]?.triggers;
  return Array.isArray(triggers) ? triggers : null;
}

const ALL_ENEMIES = '/combat_trigger_dependencies/all_enemies';
const ACTIVE_UNITS = '/combat_trigger_conditions/number_of_active_units';

// 「空触发器（立即释放）候选取胜」的确定性响应器：空触发器的指标翻倍。
function fastWhenEmptyTriggers(payload) {
  const triggers = payloadSlotTriggers(payload);
  const empty = Array.isArray(triggers) && triggers.length === 0;
  return {
    simResult: buildSimResult({
      encounters: empty ? 480 : 240,
      experienceGained: { player1: { attack: empty ? 96000 : 48000 } },
    }),
  };
}

// 「敌人越多越早放越好」的确定性响应器：number_of_active_units 门槛的 value 越大，
// 指标越好。改进量刻意做成**次对数**（每档 +10% 相对基线）：目标函数的单指标
// 归一化在相对变化 ≥ 100% 时饱和（log2(2) = 1 即钳到 1），线性放大会让 count=2/3/4
// 同分，并列时 compareCandidates 会选改动更小的 count=2，精炼通路永远走不到。
// 本测试环境下 resolveOptimizerResources 返回 null（无 maxHp/maxMp），该槽只有
// 锚点 + manyEnemies 计数候选，故用计数精炼验证搜索层的精炼通路：网格 count=3
// 先被采纳，精炼 count=4 再胜出。
function betterWithMoreEnemies(payload) {
  const triggers = payloadSlotTriggers(payload);
  const count =
    Array.isArray(triggers) &&
    triggers.length === 1 &&
    triggers[0].conditionHrid === ACTIVE_UNITS &&
    Number(triggers[0].value) > 0
      ? Number(triggers[0].value)
      : 1;
  const tier = 1 + 0.1 * (count - 1);
  return {
    simResult: buildSimResult({
      encounters: 240 * tier,
      experienceGained: { player1: { attack: 48000 * tier } },
    }),
  };
}

// 「精炼行走在不再改进处自然终止」的确定性响应器（B2，2026-09-19）：count=5 是隐藏
// 内部最优 —— 4 → 5 上坡、6 回落，且**网格最优是 3**（网格只有 2/3）：
//   count:  2     3     4     5     6
//   tier:  1.04  1.06  1.10  1.14  1.12
// 单级精炼只会停在 4；多级行走必须走到 5，并在评估 6（回落）后停下。
const REFINE_WALK_GAINS = { 2: 0.04, 3: 0.06, 4: 0.1, 5: 0.14, 6: 0.12 };
function walkToHiddenCountPeak(payload) {
  const triggers = payloadSlotTriggers(payload);
  const count = Array.isArray(triggers) && triggers.length === 1 ? Number(triggers[0].value) : 0;
  const gain = REFINE_WALK_GAINS[count] ?? 0;
  return {
    simResult: buildSimResult({
      encounters: 240 * (1 + gain),
      experienceGained: { player1: { attack: 48000 * (1 + gain) } },
    }),
  };
}

// 「每个槽的『立即释放』各自带来 +20%」的确定性响应器（复现实测的多槽叠加缺陷）：
//   tier = Π_槽 (槽触发器为空 ? 1.2 : 1)
// 两个槽同增益 ⇒ **与槽处理顺序无关**：先处理的槽以 +20%（≈0.237 分）被采纳后，
// 后处理的槽相对「已更新的工作配置」同样是 +20% —— 旧实现的门槛是「上一个被采纳候选在
// 它自己参考系里的分 + MIN_ADOPT_SCORE」（0.237 + 0.01 > 0.237）→ 后一个槽必被拦掉；
// 修正为同参考系门槛（增量分 ≥ MIN_ADOPT_SCORE）后两笔都应落地。
function emptyTriggersBoostEverySlot(payload) {
  const slots = [ABILITY_SLOT, SECOND_ABILITY_SLOT];
  let tier = 1;
  for (const slotIndex of slots) {
    const triggers = payloadSlotTriggersAt(payload, slotIndex);
    if (Array.isArray(triggers) && triggers.length === 0) tier *= 1.2;
  }
  return {
    simResult: buildSimResult({
      encounters: 240 * tier,
      experienceGained: { player1: { attack: 48000 * tier } },
    }),
  };
}

function createInput(overrides = {}) {
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
    settings: { maxRounds: 2, candidateLimit: 8 },
    WorkerClientCtor: SimulatedWorkerClient,
    ...overrides,
  };
}

// 两个可搜槽（槽 1 与槽 2）的输入：槽 2 的智力要求是 20，故显式抬高 intelligence。
function createTwoSlotInput(overrides = {}) {
  const playerConfig = createEmptyPlayerConfig('1');
  playerConfig.levels.intelligence = SECOND_SLOT_REQUIRED_INTELLIGENCE;
  playerConfig.abilities[ABILITY_SLOT] = { abilityHrid: ABILITY_HRID, level: 1 };
  playerConfig.abilities[SECOND_ABILITY_SLOT] = { abilityHrid: SECOND_ABILITY_HRID, level: 1 };
  return {
    playerConfig,
    simulationSettings: {
      mode: 'zone',
      zoneHrid: '/actions/combat/green_slimes',
      difficultyTier: 0,
      simulationTimeHours: 24,
    },
    settings: { maxRounds: 2, candidateLimit: 8 },
    WorkerClientCtor: SimulatedWorkerClient,
    ...overrides,
  };
}

afterEach(() => {
  cancelTriggerOptimizerRun();
  cancelDedicatedWorkerRuns();
  cancelSharedWorkerRun();
  SimulatedWorkerClient.responder = null;
  SimulatedWorkerClient.instances = [];
});

describe('triggerOptimizerSearch', () => {
  it('takes the caller clock origin so the reported elapsed time matches the page clock', async () => {
    SimulatedWorkerClient.responder = fastWhenEmptyTriggers;
    const startedAt = Date.now() - 7000; // 页面侧从点击「开始搜索」起计时（含准备段）
    const reported = [];
    const result = await optimizeTriggers(createInput({ startedAt }), {
      onProgress: (update) => reported.push(update.elapsedSeconds),
    });

    // 报告与每次进度上报都用调用方给的起点 → 页面在跑完那一刻不会回缩。
    expect(result.elapsedSeconds).toBeGreaterThanOrEqual(7);
    expect(reported.length).toBeGreaterThan(0);
    expect(Math.min(...reported)).toBeGreaterThanOrEqual(7);

    // 缺省（不传 startedAt）仍以自己的起点计时，保持旧调用方语义。
    const fallback = await optimizeTriggers(createInput());
    expect(fallback.elapsedSeconds).toBeLessThan(7);
  });

  it('coordinate descent 采纳更优候选并在固定点收敛（两轮）', async () => {
    SimulatedWorkerClient.responder = fastWhenEmptyTriggers;
    const onRound = vi.fn();
    const onProgress = vi.fn();

    const result = await optimizeTriggers(createInput({ parallelWorkerLimit: 8, parallelWorkerHardMax: 3 }), {
      onRound,
      onProgress,
    });

    expect(result.cancelled).toBe(false);
    expect(result.error).toBe('');
    expect(result.rounds).toBe(2);
    // 走满 2 轮但**最后一轮零采纳**（固定点收敛）→ 不是「轮数上限截断」：上限没有约束搜索。
    expect(result.roundLimitReached).toBe(false);
    // 「立即释放」候选（triggers=[]）被采纳进最终触发器映射。
    expect(result.bestTriggerMap[ABILITY_HRID]).toEqual([]);
    expect(result.improvement.scoreDelta).toBeGreaterThan(0);

    const choice = result.perAbilityChoices[0];
    expect(choice.slotIndex).toBe(ABILITY_SLOT);
    expect(choice.chosen).toBeTruthy();
    expect(choice.chosen.signature).toBe('[]');
    expect(choice.chosen.score).toBeGreaterThan(0);

    // 评估次数 = 基线 1 + 两轮 × 该槽候选数 + 独立复验 2 次（基线/最优各一次）。
    expect(result.evaluations).toBe(1 + 2 * choice.candidates.length + 2);
    // 并行期望值被硬上限钳制（3），实际并发不超过它。
    expect(result.workerLimit).toBe(3);
    expect(result.maxConcurrentWorkers).toBeGreaterThanOrEqual(1);
    expect(result.maxConcurrentWorkers).toBeLessThanOrEqual(3);

    expect(onRound).toHaveBeenCalledTimes(2);
    expect(onRound.mock.calls[0][1].improvedSlots).toContain(ABILITY_SLOT);
    expect(onRound.mock.calls[1][1].improvedSlots).toEqual([]);
    expect(onProgress).toHaveBeenCalled();
    expect(onProgress.mock.calls.some(([update]) => update?.phase === 'done' && update.progress === 1)).toBe(true);
    expect(hasTriggerOptimizerRunInProgress()).toBe(false);

    // 独立复验：换一组种子重跑「基线 vs 最优」，给出「提升是否成立」的结论。
    // 没有这一步，报告里的提升无法证伪（旧实现的缺口）。
    expect(result.verification).toBeTruthy();
    expect(result.verification.seeds).toHaveLength(TRIGGER_OPTIMIZER_VERIFY_ROUNDS);
    expect(result.verification.paired.rounds).toBe(TRIGGER_OPTIMIZER_VERIFY_ROUNDS);
    expect(result.verification.rounds).toBe(TRIGGER_OPTIMIZER_VERIFY_ROUNDS);
    expect(['positive', 'negative', 'inconclusive', 'unknown']).toContain(result.verification.verdict);
    // 复验必须换种子：复用搜索种子的话「复验」只是把搜索期结论复述一遍。
    const searchSeeds = new Set(
      SimulatedWorkerClient.instances.slice(0, result.evaluationRounds).map((client) => client.payload.seed),
    );
    expect(result.verification.seeds.some((seed) => searchSeeds.has(seed))).toBe(false);
  });

  it('多槽叠加：后处理的槽即便增量不超过前一槽，也不再被跨参考系门槛拦掉', async () => {
    SimulatedWorkerClient.responder = emptyTriggersBoostEverySlot;
    const result = await optimizeTriggers(createTwoSlotInput());

    // 两笔改进都落地。旧实现只落地第一笔：第二个槽的 +20% 被「前一笔的增量分（≈0.237）
    // + MIN_ADOPT_SCORE」拦住 —— 那是另一个参考系的分（实测缺陷与修正：设计 §16.9）。
    expect(result.bestTriggerMap[ABILITY_HRID]).toEqual([]);
    expect(result.bestTriggerMap[SECOND_ABILITY_HRID]).toEqual([]);
    const adopted = result.perAbilityChoices.filter((choice) => choice.chosen);
    expect(adopted).toHaveLength(2);
    expect(adopted.every((choice) => choice.chosen.score > 0)).toBe(true);
    // 两个槽都真被采纳过（UI 的「推荐」徽章看这个字段）。
    expect([...result.adoptedSlots].sort()).toEqual([ABILITY_SLOT, SECOND_ABILITY_SLOT].sort());

    // 报告总分必须是「最优配置相对**基线**的累计分」，而不是最后一笔增量：
    // 用同一参考系现算校验（旧实现上抛 best.score，此处会不相等）。
    expect(result.improvement.score).toBeCloseTo(
      scoreCandidate(result.improvement.metrics, TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS, result.baselineMetrics),
      9,
    );
    // 累计分大于任何单笔增量（两笔改进都在里面）。
    const [largest, second] = [...adopted].sort((a, b) => b.chosen.score - a.chosen.score);
    expect(result.improvement.score).toBeGreaterThan(largest.chosen.score);
    // 自守断言：本场景**必须**落在旧门槛会拦截的区间内，否则用例就不再复现缺陷
    //（第二笔增量 ≤ 第一笔增量 + MIN_ADOPT_SCORE ⇒ 旧判据必然拒绝）。
    expect(second.chosen.score).toBeLessThan(largest.chosen.score + TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE);
  });

  // ── 跨槽联合探针（C，2026-09-19，设计 §19.11）──────────────────────────────
  // 响应器：两个槽的「立即释放」候选各自贡献一份确定性增益（gainA / gainB）；两槽同时为空
  // 时附加 jointExtra（默认 0 = 可加）。确定性增益 ⇒ 配对证据恒为 positive，把关注点留给
  // 「联合判据 + 边际检查」本身。
  // 增益 ↔ 分数换算（默认权重 0.5/0.3/0.2 → byMetric：xp 0.3 + kills 0.1，另两项本环境为 0）：
  //   score ≈ 0.4 × log2(1 + gain)。于是：
  //   · 0.012/槽：单槽 ≈ 0.0069（< MIN_ADOPT_SCORE 0.01，单独不够格）、联合 ≈ 0.0137（过闸）；
  //   · 0.004/槽：单槽 ≈ 0.0023、联合 ≈ 0.0046（都不过闸，用作对照）。
  function jointProbeResponder({ gainA = 0, gainB = 0, jointExtra = 0 } = {}) {
    const isEmpty = (triggers) => Array.isArray(triggers) && triggers.length === 0;
    return (payload) => {
      const emptyA = isEmpty(payloadSlotTriggersAt(payload, ABILITY_SLOT));
      const emptyB = isEmpty(payloadSlotTriggersAt(payload, SECOND_ABILITY_SLOT));
      let gain = (emptyA ? gainA : 0) + (emptyB ? gainB : 0);
      if (emptyA && emptyB) gain += jointExtra;
      return {
        simResult: buildSimResult({
          encounters: 240 * (1 + gain),
          experienceGained: { player1: { attack: 48000 * (1 + gain) } },
        }),
      };
    };
  }

  const choiceForSlot = (result, slotIndex) =>
    result.perAbilityChoices.find((choice) => choice.slotIndex === slotIndex);

  it('跨槽联合探针：两槽各自不够格、联合过闸 → 两槽一起被采纳并写进报告', async () => {
    SimulatedWorkerClient.responder = jointProbeResponder({ gainA: 0.012, gainB: 0.012 });
    const result = await optimizeTriggers(createTwoSlotInput());

    // 单槽视角：两个槽的槽内最优都没到最小效应量 —— 没有联合探针就不会有任何采纳。
    const smallA = choiceForSlot(result, ABILITY_SLOT);
    const smallB = choiceForSlot(result, SECOND_ABILITY_SLOT);
    for (const choice of [smallA, smallB]) {
      expect(choice).toBeTruthy();
      expect(Number(choice.chosen.score)).toBeGreaterThan(0);
      expect(Number(choice.chosen.score)).toBeLessThan(TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE);
    }

    // 联合采纳：两槽一起写回；报告里有一条联合采纳记录（相对轮起参考的统计量 + 边际均值）。
    expect(result.rounds).toBe(2);
    expect(result.jointAdoptions).toHaveLength(1);
    const [joint] = result.jointAdoptions;
    expect(joint.round).toBe(1);
    // settings.rounds 缺省 = TRIGGER_OPTIMIZER_DEFAULT_ROUNDS（标准档 24h）：抽样口径随报告自证
    expect(joint.rounds).toBe(TRIGGER_OPTIMIZER_DEFAULT_ROUNDS);
    expect([...joint.slots].sort()).toEqual([ABILITY_SLOT, SECOND_ABILITY_SLOT].sort());
    expect([...joint.adoptedSlots].sort()).toEqual([ABILITY_SLOT, SECOND_ABILITY_SLOT].sort());
    expect(joint.score).toBeGreaterThanOrEqual(TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE);
    expect(joint.verdict).toBe('positive');
    expect(joint.mean).toBeGreaterThan(0);
    expect(joint.marginalMean).toBeGreaterThan(0);

    expect(result.bestTriggerMap[ABILITY_HRID]).toEqual([]);
    expect(result.bestTriggerMap[SECOND_ABILITY_HRID]).toEqual([]);
    expect([...result.adoptedSlots].sort()).toEqual([ABILITY_SLOT, SECOND_ABILITY_SLOT].sort());
    expect(result.improvement.improved).toBe(true);
    expect(result.evidenceBlocked).toBe(false);
    // 一轮联合采纳后，第二轮两槽的复核点分数 = 0（已是自己 vs 自己）→ 无合格成员、不再探针。
    expect(result.roundLimitReached).toBe(false);

    // 成本口径：基线 1 + 两轮候选 + 第 1 轮 1 次联合评估 + 复验 2。
    expect(result.evaluations).toBe(1 + (smallA.candidates.length + smallB.candidates.length) * 2 + 1 + 2);
  });

  it('跨槽联合探针：联合也不够格 → 不采纳且不留记录，一轮收敛', async () => {
    SimulatedWorkerClient.responder = jointProbeResponder({ gainA: 0.004, gainB: 0.004 });
    const result = await optimizeTriggers(createTwoSlotInput());

    const smallA = choiceForSlot(result, ABILITY_SLOT);
    const smallB = choiceForSlot(result, SECOND_ABILITY_SLOT);
    expect(Number(smallA.chosen.score)).toBeGreaterThan(0);

    expect(result.jointAdoptions).toEqual([]);
    expect(result.adoptedSlots).toEqual([]);
    expect(result.bestTriggerMap[ABILITY_HRID]).toBeUndefined();
    expect(result.bestTriggerMap[SECOND_ABILITY_HRID]).toBeUndefined();
    expect(result.improvement.improved).toBe(false);
    // 分数没到最小效应量 ⇒ 是「不够格」而不是「证据不足」：不置 evidenceBlocked。
    expect(result.evidenceBlocked).toBe(false);

    // 零采纳 ⇒ 该轮即固定点（探针只在真正跑过的轮次里发生）：本轮 1 次联合评估；
    // 读数 = 基线 + 本轮候选 + 1 次探针 + 复验。
    expect(result.rounds).toBe(1);
    expect(result.evaluations).toBe(1 + (smallA.candidates.length + smallB.candidates.length) + 1 + 2);
  });

  it('跨槽联合探针：一槽已单独采纳、另一槽不够格 → 联合（相对轮起）过闸时补采纳被拦的槽', async () => {
    SimulatedWorkerClient.responder = jointProbeResponder({ gainA: 0.012, gainB: 0.2 });
    const result = await optimizeTriggers(createTwoSlotInput());

    const small = choiceForSlot(result, ABILITY_SLOT);
    const big = choiceForSlot(result, SECOND_ABILITY_SLOT);
    // 大增益槽被单独采纳（≈0.105），小增益槽单看不够格（≈0.0069）——正是 §19.10 实测里的
    // 「先采纳 B、再补 A 的增量被功效拦掉」形态；联合比较把两者收益并入同一分子后过闸。
    expect(Number(small.chosen.score)).toBeLessThan(TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE);
    expect(Number(big.chosen.score)).toBeGreaterThanOrEqual(TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE);

    expect(result.jointAdoptions).toHaveLength(1);
    const [joint] = result.jointAdoptions;
    // 只有小增益槽是这次联合**新增**采纳的（大增益槽的收益已经计入轮起比较的那一侧）。
    expect(joint.adoptedSlots).toEqual([ABILITY_SLOT]);
    expect(joint.marginalMean).toBeGreaterThan(0);
    expect(result.bestTriggerMap[ABILITY_HRID]).toEqual([]);
    expect(result.bestTriggerMap[SECOND_ABILITY_HRID]).toEqual([]);
    expect([...result.adoptedSlots].sort()).toEqual([ABILITY_SLOT, SECOND_ABILITY_SLOT].sort());
    expect(result.evaluations).toBe(1 + (small.candidates.length + big.candidates.length) * 2 + 1 + 2);
  });

  it('跨槽联合探针：联合相对轮起过闸但边际均值为负（有害搭车）→ 不采纳', async () => {
    // gainA +0.012、gainB +0.2、联合附加 −0.024：联合配置 = +0.188（相对轮起显著、证据为确定性
    // positive），但相对「已采纳 B 的当前配置」边际 ≈ −1% ⇒ 被边际符号检查拦下。这是
    // 「这一对不值得」，不是「证据不足」（evidenceBlocked 不置位）。
    SimulatedWorkerClient.responder = jointProbeResponder({ gainA: 0.012, gainB: 0.2, jointExtra: -0.024 });
    const result = await optimizeTriggers(createTwoSlotInput());

    const small = choiceForSlot(result, ABILITY_SLOT);
    const big = choiceForSlot(result, SECOND_ABILITY_SLOT);
    expect(Number(small.chosen.score)).toBeGreaterThan(0);
    expect(result.jointAdoptions).toEqual([]);
    expect(result.adoptedSlots).toEqual([SECOND_ABILITY_SLOT]);
    expect(result.bestTriggerMap[ABILITY_HRID]).toBeUndefined();
    expect(result.bestTriggerMap[SECOND_ABILITY_HRID]).toEqual([]);
    expect(result.evidenceBlocked).toBe(false);
    expect(result.evaluations).toBe(1 + (small.candidates.length + big.candidates.length) * 2 + 1 + 2);
  });

  it('重复次数作用于每一次评估：结果公布模拟场次与抽样轮数', async () => {
    SimulatedWorkerClient.responder = fastWhenEmptyTriggers;
    const result = await optimizeTriggers(createInput({ settings: { maxRounds: 2, candidateLimit: 8, rounds: 3 } }));

    const choice = result.perAbilityChoices[0];
    // 评估次数 = 基线 1 + 两轮 × 候选数 + 复验 2；模拟场次 = 评估次数 × 重复次数。
    expect(result.evaluations).toBe(1 + 2 * choice.candidates.length + 2);
    expect(result.evaluationRounds).toBe(3);
    // 模拟场次 = 搜索期评估 × rounds + 复验 2 次评估 × VERIFY_ROUNDS（复验轮数与 rounds 解耦）。
    expect(result.simulations).toBe((1 + 2 * choice.candidates.length) * 3 + 2 * TRIGGER_OPTIMIZER_VERIFY_ROUNDS);
    // 每场抽样各起一个专用 worker：实例数 = 模拟场次，前三次的 workerId 带轮次后缀。
    expect(SimulatedWorkerClient.instances).toHaveLength(result.simulations);
    expect(SimulatedWorkerClient.instances.slice(0, 3).map((client) => client.payload.workerId)).toEqual([
      'trigger-optimizer#r1',
      'trigger-optimizer#r2',
      'trigger-optimizer#r3',
    ]);
  });

  it('取消：进行中搜索收尾为 cancelled 并清理运行标志', async () => {
    SimulatedWorkerClient.responder = () => null;
    const onCancel = vi.fn();
    const promise = optimizeTriggers(createInput(), { onCancel });

    expect(hasTriggerOptimizerRunInProgress()).toBe(true);
    cancelTriggerOptimizerRun();
    const result = await promise;

    expect(result.cancelled).toBe(true);
    expect(result.bestTriggerMap).toBeNull();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(hasTriggerOptimizerRunInProgress()).toBe(false);
  });

  it('共享 worker 运行进行中时拒绝启动，且不建立自身运行标志', async () => {
    SimulatedWorkerClient.responder = () => null;
    const sharedPromise = runSharedSingleSimulationPayload({ type: 'start_simulation' }, () => {}, {
      workerClient: new SimulatedWorkerClient(),
    });

    await expect(optimizeTriggers(createInput())).rejects.toThrow(SHARED_RUN_BUSY_ERROR);
    expect(hasTriggerOptimizerRunInProgress()).toBe(false);

    cancelSharedWorkerRun();
    await expect(sharedPromise).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('重入：同一时刻只允许一个搜索', async () => {
    SimulatedWorkerClient.responder = () => null;
    const first = optimizeTriggers(createInput());

    await expect(optimizeTriggers(createInput())).rejects.toThrow(TRIGGER_OPTIMIZER_BUSY_ERROR);

    cancelTriggerOptimizerRun();
    const result = await first;
    expect(result.cancelled).toBe(true);
  });

  it('单个候选的 worker 失败退化为失败指标：不中断搜索也不被误采纳', async () => {
    SimulatedWorkerClient.responder = (payload) => {
      const triggers = payloadSlotTriggers(payload);
      const empty = Array.isArray(triggers) && triggers.length === 0;
      if (empty) return { error: 'worker crashed' };
      return { simResult: buildSimResult() };
    };

    const result = await optimizeTriggers(createInput());

    expect(result.cancelled).toBe(false);
    // 无可采纳改进 → 一轮即到固定点；基线（无键=默认）原样保留。
    expect(result.rounds).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(result.bestTriggerMap, ABILITY_HRID)).toBe(false);
    expect(Object.values(result.metricsByCandidate).some((entry) => entry.metrics?.failed === true)).toBe(true);
  });

  it('已提供的 baselineMetrics 带等长逐轮样本时被复用为基线结果', async () => {
    SimulatedWorkerClient.responder = fastWhenEmptyTriggers;
    // 复用前提是**配对性**：必须带 settings.rounds（缺省 = TRIGGER_OPTIMIZER_DEFAULT_ROUNDS）
    // 等长的逐轮样本。
    const rounds = TRIGGER_OPTIMIZER_DEFAULT_ROUNDS;
    const sample = {
      dps: 0,
      dailyNoRngProfit: 0,
      xpPerHour: 2000,
      killsPerHour: 10,
      deathsPerHour: 0,
      ranOutOfMana: false,
    };
    const baselineMetrics = {
      ...sample,
      samples: Array.from({ length: rounds }, () => sample),
      rounds,
    };

    const result = await optimizeTriggers(createInput({ baselineMetrics }));

    expect(result.baselineMetrics).toBe(baselineMetrics);
    expect(result.improvement.scoreDelta).toBeGreaterThan(0);
  });

  it('baselineMetrics 缺逐轮样本（无法配对）时不被复用：现场重新评估基线', async () => {
    // 不带 samples 的基线指标 → computePairedStats 返回 null → 采纳闸门永远拒绝，
    // 搜索会静默退化成「只看不采纳」。宁可多跑 rounds 场模拟，也不接受无法配对的参考。
    SimulatedWorkerClient.responder = fastWhenEmptyTriggers;
    const baselineMetrics = {
      dps: 0,
      dailyNoRngProfit: 0,
      xpPerHour: 2000,
      killsPerHour: 10,
      deathsPerHour: 0,
      ranOutOfMana: false,
    };

    const result = await optimizeTriggers(createInput({ baselineMetrics }));

    expect(result.baselineMetrics).not.toBe(baselineMetrics);
    expect(result.baselineMetrics.samples).toHaveLength(TRIGGER_OPTIMIZER_DEFAULT_ROUNDS);
    expect(result.improvement.scoreDelta).toBeGreaterThan(0);
  });

  it('自适应阈值精炼：多级邻域把网格外的更优阈值走出来（±10 → ±5，直到不再改进或到级数上限）', async () => {
    SimulatedWorkerClient.responder = betterWithMoreEnemies;

    const result = await optimizeTriggers(createInput());

    const choice = result.perAbilityChoices[0];
    // 原始候选：锚点（default/alwaysFire）+ manyEnemies 2/3（本环境下 resources 不可用，
    // 没有数值类候选）。
    const baseCandidateCount = 4;

    // 第 1 轮：count=3 被采纳 → 多级精炼沿「越大越好」的响应器一路走到级数上限（4）：
    // 3 → 4 → 5 → 6 → 7。每级邻域里较小的一侧都在候选表里（2/3/4/5/6 依次），被签名去重
    // 跳过，所以每级只评估 1 个点；B2 之前只走一级、停在 4。第 2 轮：候选表 8 个全部不优
    // 于当前配置 → 固定点收敛。
    // 评估次数 = 基线 1 + 第 1 轮 4 + 精炼 4 + 第 2 轮 8 + 复验 2。
    expect(result.rounds).toBe(2);
    expect(result.evaluations).toBe(1 + baseCandidateCount + 4 + (baseCandidateCount + 4) + 2);
    expect(result.evaluations).toBe(19);

    // 最终触发器是行走到的 count=7（不是网格里的 2/3，也不是 B2 之前的一级精炼 4）。
    const finalTriggers = result.bestTriggerMap[ABILITY_HRID];
    expect(finalTriggers).toHaveLength(1);
    expect(finalTriggers[0].dependencyHrid).toBe(ALL_ENEMIES);
    expect(finalTriggers[0].conditionHrid).toBe(ACTIVE_UNITS);
    expect(finalTriggers[0].value).toBe(7);

    // 精炼候选逐级回写进候选表（UI 可见）与指标表（分数/paired 已记录），且同一参考系下
    // 分数逐级走高：4 < 5 < 6 < 7。
    const scoresByCount = [4, 5, 6, 7].map((count) => {
      const candidate = choice.candidates.find((entry) => entry.labelParams?.count === count);
      expect(candidate).toBeTruthy();
      const recorded = result.metricsByCandidate[`${ABILITY_SLOT}|${candidate.signature}`];
      expect(recorded).toBeTruthy();
      return recorded.score;
    });
    for (let index = 1; index < scoresByCount.length; index += 1) {
      expect(scoresByCount[index]).toBeGreaterThan(scoresByCount[index - 1]);
    }
    // 换算口径不变：count=4 → tier 1.3 → 48000 × 1.3 / 24h = 2600 xp/h；count=7 → 3200。
    const xpByCount = (count) => {
      const candidate = choice.candidates.find((entry) => entry.labelParams?.count === count);
      return result.metricsByCandidate[`${ABILITY_SLOT}|${candidate.signature}`].metrics.xpPerHour;
    };
    expect(xpByCount(4)).toBe(2600);
    expect(xpByCount(7)).toBe(3200);

    expect(result.improvement.scoreDelta).toBeGreaterThan(0);
    // 独立复验也认同「精炼后的配置优于基线」（换种子后仍确定性成立）。
    expect(result.verification.verdict).toBe('positive');
  });

  it('精炼行走在「不再改进」处自然终止，而不是走到级数上限', async () => {
    SimulatedWorkerClient.responder = walkToHiddenCountPeak;

    const result = await optimizeTriggers(createInput());

    const choice = result.perAbilityChoices[0];
    // 第 1 轮：count=3 被采纳 → 行走 4（level 0）→ 5（level 1）；level 2 评估 6 时分数回落
    // → 不采纳、行走自然停止（较小的一侧 4 已在候选表里被签名去重）。第 2 轮：候选表 7 个
    // 全部不优 → 固定点收敛。
    // 评估次数 = 基线 1 + 第 1 轮 4 + 精炼 3（4/5/6 各一次）+ 第 2 轮 7 + 复验 2。
    expect(result.rounds).toBe(2);
    expect(result.evaluations).toBe(1 + 4 + 3 + 7 + 2);
    expect(result.evaluations).toBe(17);

    // 最终阈值是隐藏内部最优 5（单级精炼只会停在 4，级数上限也参与不到这里）。
    const finalTriggers = result.bestTriggerMap[ABILITY_HRID];
    expect(finalTriggers).toHaveLength(1);
    expect(finalTriggers[0].value).toBe(5);

    // 「探边」是透明的：被拒绝的 6 也留下评估记录（候选表 + 指标表），且 4 < 5 > 6。
    const scoreByCount = (count) => {
      const candidate = choice.candidates.find((entry) => entry.labelParams?.count === count);
      expect(candidate).toBeTruthy();
      const recorded = result.metricsByCandidate[`${ABILITY_SLOT}|${candidate.signature}`];
      expect(recorded).toBeTruthy();
      return recorded.score;
    };
    expect(scoreByCount(5)).toBeGreaterThan(scoreByCount(4));
    expect(scoreByCount(5)).toBeGreaterThan(scoreByCount(6));
    // 被拒绝的 6 没有被误采纳（bestTriggerMap 只有 5 这一条）。
    expect(finalTriggers[0].value).toBe(5);
  });

  // ── 深挖（2026-09-19 设计 §18.1；2026-09-20 改独立种子，设计 §21）──────────
  // 用 workerId 的 "#rN" 后缀当轮序号，构造「前两轮看不出、加密复核才看得出」的确定性
  // 情形：立即释放候选的增益按轮序号给出 [0.08, 0.0137, 0.02, 0.02, 0.02, 0.02]。
  //   · settings.rounds = 2 → 配对样本 [0.0444, 0.0079]：均值 0.0261、2×SE 0.0366
  //     ⇒ 证据不足（被噪声地板拦下），但聚合分 0.0264 ≥ 最小效应量 → 触发深挖；
  //   · 独立种子的 6 轮 → 均值 0.0163、2×SE 0.0113 ⇒ 过闸被采纳。
  // 这不是统计噪声仿真，而是刻意构造「样本不足 → 复核 → 过闸」的机制场景：锁定的是深挖的
  // 接线（独立盐、重新判据、报告记录、采纳）。增益只取决于轮序号（与种子无关），所以
  // 「判据换盐」不影响数值断言——换盐本身由下面的种子集合断言锁定。
  const DEEP_DIVE_ROUND_GAINS = [0.08, 0.0137, 0.02, 0.02, 0.02, 0.02];
  const BLOCKED_AFTER_DEEP_DIVE_GAINS = [0.08, 0.0137, 0, 0, 0, 0];
  function gainByRound(payload, gains = DEEP_DIVE_ROUND_GAINS) {
    const triggers = payloadSlotTriggers(payload);
    const alwaysFire = Array.isArray(triggers) && triggers.length === 0;
    const roundIndex = Number(String(payload?.workerId || '').match(/#r(\d+)$/)?.[1] ?? 1);
    const gain = alwaysFire ? gains[Math.min(Math.max(roundIndex, 1), gains.length) - 1] : 0;
    return {
      simResult: buildSimResult({
        encounters: 240 * (1 + gain),
        experienceGained: { player1: { attack: 48000 * (1 + gain) } },
      }),
    };
  }

  it('深挖：短采样被噪声地板拦下的候选，在独立种子的 6 轮复核后被采纳并写进报告', async () => {
    SimulatedWorkerClient.responder = (payload) => gainByRound(payload);
    const result = await optimizeTriggers(createInput({ settings: { maxRounds: 2, candidateLimit: 8, rounds: 2 } }));

    // 报告里有一条深挖记录：轮数 = 深挖轮数、采纳、统计量齐全。
    expect(result.deepDives).toHaveLength(1);
    const [dive] = result.deepDives;
    expect(dive.slotIndex).toBe(ABILITY_SLOT);
    expect(dive.abilityHrid).toBe(ABILITY_HRID);
    expect(dive.rounds).toBe(TRIGGER_OPTIMIZER_DEEP_DIVE_ROUNDS);
    expect(dive.seeds).toHaveLength(TRIGGER_OPTIMIZER_DEEP_DIVE_ROUNDS);
    expect(dive.adopted).toBe(true);
    expect(dive.mean).toBeCloseTo(0.01633, 4);
    expect(dive.stdError).toBeCloseTo(0.00565, 4);
    expect(['positive', 'inconclusive']).toContain(dive.verdict);
    // 判据数据必须独立（设计 §21）：搜索期那几轮参与了「谁被复核」的决策，不能再用。
    // 独立盐 ⇒ 深挖种子与搜索种子、复验种子都不相交（salt 进 key 参与 hash）。
    const searchSeeds = new Set(
      SimulatedWorkerClient.instances.slice(0, result.evaluationRounds).map((client) => client.payload.seed),
    );
    expect(dive.seeds.some((seed) => searchSeeds.has(seed))).toBe(false);
    expect(dive.seeds.some((seed) => result.verification.seeds.includes(seed))).toBe(false);

    // 采纳落地：最终配置 = 立即释放；被拦不再成立（深挖过闸）。
    expect(result.bestTriggerMap[ABILITY_HRID]).toEqual([]);
    expect(result.evidenceBlocked).toBe(false);
    // 采纳的槽位要如实上报：UI 用 adoptedSlots（而不是 chosen）决定是否挂「推荐」，
    // 否则已采纳的槽会显示成「保持当前配置」（浏览器实测：快照取早了的缺陷）。
    expect(result.adoptedSlots).toEqual([ABILITY_SLOT]);
    const choice = result.perAbilityChoices[0];
    expect(choice.chosen?.signature).toBe('[]');
    expect(result.improvement.scoreDelta).toBeGreaterThan(0);

    // 成本口径：深挖 = 2 次评估（参考 + 候选）× 6 场 = 12 场模拟，计入报告与进度。
    // 用 6 连号的轮次窗口定位它（搜索期 rounds=2、复验 6 轮在最后，都不会与它混淆）。
    const roundIds = SimulatedWorkerClient.instances.map((client) =>
      String(client.payload.workerId).replace(/^.*#/, '#'),
    );
    const deepDiveStart = roundIds.findIndex(
      (_, index) =>
        roundIds.slice(index, index + 6).join(',') === '#r1,#r2,#r3,#r4,#r5,#r6' &&
        index + 6 <= roundIds.length - TRIGGER_OPTIMIZER_VERIFY_ROUNDS * 2,
    );
    expect(deepDiveStart).toBeGreaterThan(0);
    const deepDiveClients = SimulatedWorkerClient.instances.slice(deepDiveStart, deepDiveStart + 12);
    expect(deepDiveClients.map((client) => String(client.payload.workerId).replace(/^.*#/, '#'))).toEqual([
      '#r1',
      '#r2',
      '#r3',
      '#r4',
      '#r5',
      '#r6',
      '#r1',
      '#r2',
      '#r3',
      '#r4',
      '#r5',
      '#r6',
    ]);
    // 前 6 场是参考配置（当前工作配置 = 默认触发器），后 6 场才是候选（立即释放）：
    // 参考侧必须用同一组种子重测，配对才成立。
    expect(payloadSlotTriggers(deepDiveClients[0].payload)).not.toEqual([]);
    expect(payloadSlotTriggers(deepDiveClients[6].payload)).toEqual([]);
    // 接线自证：这 12 场跑的正是报告里那组**独立**种子（而不是搜索期的种子）。
    expect(deepDiveClients.every((client) => dive.seeds.includes(client.payload.seed))).toBe(true);
    expect(SimulatedWorkerClient.instances).toHaveLength(result.simulations);
  });

  it('深挖后证据仍不足：不采纳、标记 evidenceBlocked，并留下 adopted=false 的记录', async () => {
    SimulatedWorkerClient.responder = (payload) => gainByRound(payload, BLOCKED_AFTER_DEEP_DIVE_GAINS);
    const result = await optimizeTriggers(createInput({ settings: { maxRounds: 2, candidateLimit: 8, rounds: 2 } }));

    expect(result.deepDives).toHaveLength(1);
    expect(result.deepDives[0].adopted).toBe(false);
    expect(result.deepDives[0].rounds).toBe(TRIGGER_OPTIMIZER_DEEP_DIVE_ROUNDS);
    expect(result.deepDives[0].seeds).toHaveLength(TRIGGER_OPTIMIZER_DEEP_DIVE_ROUNDS);
    // 深度复核也没过噪声地板 → 不采纳、保持当前配置，并按「证据不足」上报（UI 文案不同）。
    expect(result.bestTriggerMap[ABILITY_HRID]).toBeUndefined();
    expect(result.evidenceBlocked).toBe(true);
    expect(result.improvement.improved).toBe(false);
    expect(result.adoptedSlots).toEqual([]);
  });

  it('搜索轮数已 ≥ 深挖轮数时不触发深挖（样本本来就够，没有增量意义）', async () => {
    SimulatedWorkerClient.responder = (payload) => gainByRound(payload);
    const result = await optimizeTriggers(
      createInput({
        settings: { maxRounds: 2, candidateLimit: 8, rounds: TRIGGER_OPTIMIZER_DEEP_DIVE_ROUNDS },
      }),
    );

    expect(result.deepDives).toEqual([]);
    // 6 轮采样本身就足以过闸 → 直接采纳，不需要深挖。
    expect(result.bestTriggerMap[ABILITY_HRID]).toEqual([]);
    expect(result.evaluationRounds).toBe(TRIGGER_OPTIMIZER_DEEP_DIVE_ROUNDS);
  });

  // 「轮数上限截断」（2026-09-19，设计 §19.8）：搜索循环的早停口径是「一整轮零采纳」；
  // 跑到 maxRounds 才停说明固定点还没到（此刻无从知道「再给一轮会不会还有改进」）。
  // 上限 = 1 轮是最小可复现的截断：本轮一旦有采纳，循环就不是因收敛而停。
  it('轮数上限截断：跑满 maxRounds 且最后一轮仍有采纳 → roundLimitReached=true', async () => {
    SimulatedWorkerClient.responder = fastWhenEmptyTriggers;
    const onRound = vi.fn();
    const result = await optimizeTriggers(createInput({ settings: { maxRounds: 1, candidateLimit: 8 } }), {
      onRound,
    });

    expect(result.cancelled).toBe(false);
    expect(result.rounds).toBe(1);
    expect(onRound).toHaveBeenCalledTimes(1);
    expect(onRound.mock.calls[0][1].improvedSlots).toContain(ABILITY_SLOT);
    expect(result.adoptedSlots).toEqual([ABILITY_SLOT]);
    // 报告同时带「确有提升」与「被上限截断」：UI 的提示以两者同时成立为前提。
    expect(result.improvement.improved).toBe(true);
    expect(result.roundLimitReached).toBe(true);
  });

  // 报告里的搜索起点配置与适用范围（2026-09-23，设计 §29）：换难度复核要的「最优 vs 起点」
  // 这一对配置，以及「这份结论是在哪个目标/难度上得出的」——两者此前都不在报告里
  //（workingConfig 是克隆体、bestTriggerMap 原地改写，起点无从复原）。
  it('报告带搜索起点配置与适用范围：换难度复核的两个前提', async () => {
    SimulatedWorkerClient.responder = fastWhenEmptyTriggers;
    const input = createInput();
    // 起点 = 自定义配置（立即释放）；搜索会把工作配置改写掉，但报告必须能复原起点。
    input.playerConfig.triggerMap = { [ABILITY_HRID]: [] };
    const result = await optimizeTriggers(input);

    expect(result.baselineTriggerMap).toEqual({ [ABILITY_HRID]: [] });
    // 深拷贝语义：调用方之后改自己那份对象，报告不受影响。
    input.playerConfig.triggerMap[ABILITY_HRID].push({ dependencyHrid: 'mutated' });
    expect(result.baselineTriggerMap[ABILITY_HRID]).toEqual([]);
    // 适用范围 = 实际目标 hrid + 难度 + 时长（useDungeon 的那一路解析成同一个字段）。
    expect(result.evaluationScope).toEqual({
      zoneHrid: '/actions/combat/green_slimes',
      useDungeon: false,
      difficultyTier: 0,
      simulationHours: 24,
      // 队伍载荷（2026-09-27，设计 §59）：未传队友 = 单人载荷，恒发空数组（输入形状恒定）。
      party: [],
    });
  });

  // 换难度稳健性复核（2026-09-23，设计 §29）：触发器写的是全局技能配置，而搜索只在单一难度上
  // 评估过 —— 复核把「最优配置 vs 搜索起点配置」搬到相邻难度上，用独立盐的新样本配对评估。
  it('换难度复核：两个配置在目标难度上用同一组新种子配对评估，给出该难度的结论', async () => {
    SimulatedWorkerClient.responder = fastWhenEmptyTriggers;
    const input = createInput();
    const baselineTriggerMap = {}; // 搜索起点 = 游戏默认触发器（无键）
    const bestTriggerMap = { [ABILITY_HRID]: [] }; // 搜索最优 = 冷却好了立即释放
    const reported = [];
    const result = await verifyTriggerOptimizerRobustness(
      { ...input, bestTriggerMap, baselineTriggerMap },
      { targetTier: 1, onProgress: (update) => reported.push(update) },
    );

    expect(result.cancelled).toBe(false);
    expect(result.error).toBe('');
    expect(result.difficultyTier).toBe(1);
    expect(result.zoneHrid).toBe('/actions/combat/green_slimes');
    expect(result.rounds).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
    // 成本口径：2 次评估（起点 / 最优）× 6 场。
    expect(result.evaluations).toBe(2);
    expect(result.simulations).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS * 2);
    expect(SimulatedWorkerClient.instances).toHaveLength(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS * 2);
    expect(hasTriggerOptimizerRunInProgress()).toBe(false);

    // 目标难度真的进了 payload：区域不变、只换难度（复核的唯一变量）。
    expect(SimulatedWorkerClient.instances.every((client) => client.payload.zone?.difficultyTier === 1)).toBe(true);
    expect(
      SimulatedWorkerClient.instances.every(
        (client) => client.payload.zone?.zoneHrid === '/actions/combat/green_slimes',
      ),
    ).toBe(true);
    // 前 6 场 = 搜索起点配置（默认触发器），后 6 场 = 最优配置（立即释放）：顺序固定、可核查。
    const baselineRuns = SimulatedWorkerClient.instances.slice(0, TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
    const bestRuns = SimulatedWorkerClient.instances.slice(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
    expect(payloadSlotTriggers(baselineRuns[0].payload)).not.toEqual([]);
    expect(bestRuns.every((client) => payloadSlotTriggers(client.payload)?.length === 0)).toBe(true);
    // 两侧共享**同一组**种子（配对性的前提）：第 i 轮用同一个种子。
    expect(bestRuns.map((client) => client.payload.seed)).toEqual(baselineRuns.map((client) => client.payload.seed));

    // 种子 = 「目标难度 + 独立盐」的确定性派生：报告里的 seeds 与实际使用的一致。
    const robustnessSeeds = (tier) =>
      createTriggerOptimizerSeedSet({
        playerId: '1',
        playerConfig: input.playerConfig,
        simulationSettings: { ...input.simulationSettings, difficultyTier: tier },
        salt: TRIGGER_OPTIMIZER_SEED_SALT_ROBUSTNESS,
        count: TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS,
      });
    expect(result.seeds).toEqual(baselineRuns.map((client) => client.payload.seed));
    expect(result.seeds).toEqual([...robustnessSeeds(1)]);
    // 换难度就换一组新随机流（种子键里带 difficultyTier）；与搜索盐也天然错开。
    expect(robustnessSeeds(2).some((seed) => result.seeds.includes(seed))).toBe(false);
    const searchSaltSeeds = createTriggerOptimizerSeedSet({
      playerId: '1',
      playerConfig: input.playerConfig,
      simulationSettings: { ...input.simulationSettings, difficultyTier: 1 },
      salt: TRIGGER_OPTIMIZER_SEED_SALT_SEARCH,
      count: TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS,
    });
    expect(searchSaltSeeds.some((seed) => result.seeds.includes(seed))).toBe(false);

    // 结论：确定性响应器下「立即释放」在该难度上稳定更优 → 配对显著为正。
    expect(result.verdict).toBe('positive');
    expect(result.paired.rounds).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
    expect(result.paired.score.verdict).toBe('positive');
    expect(result.scoreDelta).toBeGreaterThan(0);
    expect(result.paired.score.mean).toBeCloseTo(result.scoreDelta, 10);
    // 逐指标配对差同样逐轮可查（UI 复用「本槽净效应」同一份口径）：响应器抬的是经验收益。
    expect(result.paired.metrics.xpPerHour.mean).toBeGreaterThan(0);
    // 进度上报覆盖两个配置：phase 固定为 robustness、进度收尾到 1。
    expect(reported[0]).toMatchObject({ phase: 'robustness', rounds: TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS });
    expect(Math.max(...reported.map((update) => update.progress))).toBe(1);
  });

  it('换难度复核：不给目标难度时沿用输入的难度，轮数可显式覆盖（测试/调试入口）', async () => {
    SimulatedWorkerClient.responder = fastWhenEmptyTriggers;
    const result = await verifyTriggerOptimizerRobustness(
      { ...createInput(), bestTriggerMap: { [ABILITY_HRID]: [] }, baselineTriggerMap: {} },
      { rounds: 3 },
    );

    expect(result.difficultyTier).toBe(0);
    expect(result.rounds).toBe(3);
    expect(result.simulations).toBe(6);
  });

  // 复核轮数自适应（2026-09-25，设计 §49）：轮数上限是**复核口径**的 16（不是搜索口径的 12），
  // 调用方带来的执行计划经净化后随结果留档；不自洽的快照整份丢弃、但不阻断复核本身。
  it('换难度复核：轮数按复核口径放行到 16 轮，计划快照自洽才留档', async () => {
    SimulatedWorkerClient.responder = fastWhenEmptyTriggers;
    const plan = {
      capped: true,
      budgetLimited: false,
      currentRounds: 6,
      requiredRounds: null,
      capRounds: TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS,
      plannedRounds: TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS,
      plannedSimulations: TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS * 2,
      budgetSimulations: null,
      // 追加补注的缺省值（2026-09-26，设计 §51）：normalizeTriggerOptimizerRobustnessPlan
      // 净化**首跑**（§49）计划时也按缺省补齐这五个字段 —— 留档口径自此固定，期望得带上它们。
      zeroDiff: false,
      atCap: false,
      limitedBy: null,
      spentSimulations: null,
      cumulativeBudgetSimulations: null,
    };
    const result = await verifyTriggerOptimizerRobustness(
      { ...createInput(), bestTriggerMap: { [ABILITY_HRID]: [] }, baselineTriggerMap: {} },
      { targetTier: 1, rounds: plan.plannedRounds, plan },
    );

    // 16 轮 = 复核口径的上限，必须放行 —— 不能借用搜索口径的归一化（搜索上限 12 会把 16 静默钳短）。
    expect(result.rounds).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS);
    expect(result.evaluations).toBe(2);
    expect(result.simulations).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS * 2);
    expect(SimulatedWorkerClient.instances).toHaveLength(TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS * 2);
    expect(result.paired.rounds).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS);
    // 计划快照原样留档（含可空的 requiredRounds / budgetSimulations 与追加补注的缺省值）。
    expect(result.plan).toEqual(plan);

    // 不自洽（plannedRounds ≠ 这次实际执行的 rounds）：整份丢弃，但复核照跑 —— 留档失败不该变成
    // 功能失败。
    const mismatched = await verifyTriggerOptimizerRobustness(
      { ...createInput(), bestTriggerMap: { [ABILITY_HRID]: [] }, baselineTriggerMap: {} },
      { targetTier: 1, rounds: 6, plan: { ...plan, plannedRounds: 9, plannedSimulations: 18 } },
    );
    expect(mismatched.rounds).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
    expect(mismatched.plan).toBeUndefined();

    // 越界值按归一化口径回落**保底 6 轮**（不是被钳到上限 —— 与 §47 同款约定：非法输入不猜上限，
    // 宁可退回产品默认）；调用方没带计划时不留 plan 字段。
    const clamped = await verifyTriggerOptimizerRobustness(
      { ...createInput(), bestTriggerMap: { [ABILITY_HRID]: [] }, baselineTriggerMap: {} },
      { targetTier: 1, rounds: 99 },
    );
    expect(clamped.rounds).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
    expect(clamped.plan).toBeUndefined();
  });

  it('换难度复核：缺少任一侧配置时直接拒绝（不静默拿原难度重跑一遍假复核）', async () => {
    SimulatedWorkerClient.responder = fastWhenEmptyTriggers;
    const input = createInput();

    await expect(
      verifyTriggerOptimizerRobustness({ ...input, bestTriggerMap: { [ABILITY_HRID]: [] } }),
    ).rejects.toThrow(MISSING_TRIGGER_MAP_ERROR);
    await expect(verifyTriggerOptimizerRobustness({ ...input, baselineTriggerMap: {} })).rejects.toThrow(
      MISSING_TRIGGER_MAP_ERROR,
    );
    expect(SimulatedWorkerClient.instances).toHaveLength(0);
    expect(hasTriggerOptimizerRunInProgress()).toBe(false);
  });

  it('换难度复核：取消收尾为 cancelled 并清理运行标志', async () => {
    SimulatedWorkerClient.responder = () => null;
    const promise = verifyTriggerOptimizerRobustness(
      { ...createInput(), bestTriggerMap: { [ABILITY_HRID]: [] }, baselineTriggerMap: {} },
      { targetTier: 1 },
    );

    expect(hasTriggerOptimizerRunInProgress()).toBe(true);
    cancelTriggerOptimizerRun();
    const result = await promise;

    expect(result.cancelled).toBe(true);
    expect(result.paired).toBeNull();
    expect(result.verdict).toBe('unknown');
    expect(hasTriggerOptimizerRunInProgress()).toBe(false);
  });
});

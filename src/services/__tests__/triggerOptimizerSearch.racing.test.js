// 技能触发器优化器 —— racing 分级采样（2026-09-24，设计 §30）。
//
// 候选池小（≤ TRIGGER_OPTIMIZER_RACING_MIN_POOL）时走原路径、零行为变化（既有契约由
// triggerOptimizerSearch.test.js 全量锁定）；本文件专测大候选池的两段式采样：
//   粗筛（SCREEN_ROUNDS 场、独立 screen 盐）→ 幸存者（top-K ∪ 锚点）→
//   精测（settings.rounds 场、search 盐）。
// 关键不变式：
//   ① winner / 采纳判据只看精测统计（粗筛样本不进判据 —— select on A / test on B）；
//   ② 粗筛 top-1 ≠ 精测 top-1 时**以精测为准**（主用例：201 粗筛第一、精测 0 分；
//      202 粗筛第二、精测最强 → 必须采纳 202）；
//   ③ 锚点保送（distance 0 不因粗筛排名落榜而失去精测资格）；
//   ④ 非幸存者只留下粗筛记录（lane='screen'、sampleRounds=2），幸存者记录为精测口径；
//   ⑤ 成本口径：非幸存者只花粗筛的 2 场；粗筛参考只测一次（采纳后由 winner 的粗筛
//      测量接续，零额外模拟）。
//
// 候选池通过 mock buildCandidateConfigs 注入合成候选（测试环境 resolveOptimizerResources
// 为 null，真实生成器产不出超过 RACING_MIN_POOL 的池）。
import { afterEach, describe, expect, it, vi } from 'vitest';

import abilityDetailMap from '../../combatsimulator/data/abilityDetailMap.json';
import { createEmptyPlayerConfig } from '../../shared/playerConfig.js';
import {
  TRIGGER_OPTIMIZER_RACING_KEEP,
  TRIGGER_OPTIMIZER_RACING_MIN_POOL,
  TRIGGER_OPTIMIZER_SCREEN_ROUNDS,
  TRIGGER_OPTIMIZER_SEED_SALT_SCREEN,
  TRIGGER_OPTIMIZER_SEED_SALT_SEARCH,
  TRIGGER_OPTIMIZER_VERIFY_ROUNDS,
  createTriggerOptimizerSeedSet,
} from '../triggerOptimizerDomain.js';
import {
  cancelTriggerOptimizerRun,
  isRacingPool,
  optimizeTriggers,
  pickRacingSurvivors,
} from '../triggerOptimizerSearch.js';
import { cancelDedicatedWorkerRuns, cancelSharedWorkerRun } from '../simulatorWorkerRuns.js';

// vi.mock 的工厂会被提升到 import 之前执行：工厂里引用的常量必须 vi.hoisted。
const { SELF, CURRENT_HP, LTE, SYNTHETIC_VALUES } = vi.hoisted(() => ({
  SELF: '/combat_trigger_dependencies/self',
  CURRENT_HP: '/combat_trigger_conditions/current_hp',
  LTE: '/combat_trigger_comparators/less_than_equal',
  // 合成候选的 value 档位：201=粗筛虚高（诱饵）、202=精测真优、203=陪跑、204-209=垫底。
  // 9 条是**下限保证**：真实生成器给小技能槽可能只产 1~2 条候选，每个 choice 注入 9 条后
  // 池子必然 > RACING_MIN_POOL（9 > 8）—— 多槽用例要求两个槽都真的走粗筛（「粗筛参考跨槽
  // 接续」的路径只在 racing 槽之间才有内容可测；实测 6 条时槽 2 池恰为 8，走了原路径）。
  SYNTHETIC_VALUES: [201, 202, 203, 204, 205, 206, 207, 208, 209],
}));

vi.mock('../triggerOptimizerCandidates.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    buildCandidateConfigs: (player, settings) => {
      const choices = actual.buildCandidateConfigs(player, settings);
      for (const choice of choices) {
        for (const value of SYNTHETIC_VALUES) {
          const triggers = [{ dependencyHrid: SELF, conditionHrid: CURRENT_HP, comparatorHrid: LTE, value }];
          choice.candidates.push({
            slotIndex: choice.slotIndex,
            abilityHrid: choice.abilityHrid,
            role: choice.role,
            state: 'custom',
            triggers,
            // 合成候选不经过 finalizeCandidate：签名直接由条目内容决定（与生产同构，
            // 槽内唯一即可 —— 搜索层只用它做记录键与去重）。
            signature: JSON.stringify(triggers),
            labelKey: 'common:triggerOptimizer.candidate.lowHpSelf',
            labelParams: { percent: value },
            distance: 2,
          });
        }
        choice.generatedCandidates = choice.candidates.length;
        choice.truncatedCandidates = 0;
      }
      return choices;
    },
  };
});

const ABILITY_SLOT = 1;
const SECOND_ABILITY_SLOT = 2;
const SECOND_SLOT_REQUIRED_INTELLIGENCE = 20;

// 两个**不同**的技能（都带默认触发器）：triggerMap 按 hrid 记账，同 hrid 的两个槽
// 会共享同一个键 —— 逐槽候选互相串改，多槽用例必须分开（与 triggerOptimizerSearch.test.js
// 的 findFirst/findAnother 同一口径）。
const abilitiesWithDefaultTriggers = Object.values(abilityDetailMap).filter(
  (entry) =>
    entry?.isSpecialAbility !== true &&
    Array.isArray(entry?.defaultCombatTriggers) &&
    entry.defaultCombatTriggers.length > 0,
);
const ABILITY_HRID = String(abilitiesWithDefaultTriggers[0]?.hrid ?? '');
const SECOND_ABILITY_HRID = String(abilitiesWithDefaultTriggers[1]?.hrid ?? '');

function buildSimResult(overrides = {}) {
  return {
    simulatedTime: 24 * 3600 * 1e9,
    encounters: 240,
    deaths: { player1: 0 },
    experienceGained: { player1: { attack: 48000 } },
    attacks: { player1: {} },
    consumablesUsed: { player1: {} },
    playerRanOutOfMana: { player1: false },
    ...overrides,
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

// 每槽触发器里的 value → { screen, decide } 增益（其余候选一律 0）。
// 粗筛里 201 遥遥领先（诱饵）、202 第二；精测里 202 独大、201 为 0 —— 若采纳判据
// 误用粗筛样本（或把粗筛 top-1 直接当 winner），主用例立刻变红。
const GAIN_BY_VALUE = {
  201: { screen: 0.3, decide: 0 },
  202: { screen: 0.1, decide: 0.3 },
  203: { screen: 0.05, decide: 0 },
};

function syntheticValue(triggers) {
  const first = Array.isArray(triggers) ? triggers[0] : null;
  if (!first) return null;
  if (first.dependencyHrid !== SELF || first.conditionHrid !== CURRENT_HP || first.comparatorHrid !== LTE) return null;
  const value = Number(first.value);
  return SYNTHETIC_VALUES.includes(value) ? value : null;
}

// 泳道判定按**种子归属**（screen 盐 vs search 盐）：粗筛与精测共享同一份配置、只换随机流，
// 与生产口径一致。复验等其它种子走 decide 增益（对结论无影响，B 稳定更优）。
function makeResponder(screenSeeds) {
  return (payload) => {
    const lane = screenSeeds.has(Number(payload?.seed) >>> 0) ? 'screen' : 'decide';
    let tier = 1;
    for (const slotIndex of [ABILITY_SLOT, SECOND_ABILITY_SLOT]) {
      const value = syntheticValue(payload?.players?.[0]?.abilities?.[slotIndex]?.triggers);
      const gain = Number(GAIN_BY_VALUE[value]?.[lane] ?? 0);
      if (gain) tier *= 1 + gain;
    }
    return {
      simResult: buildSimResult({
        encounters: 240 * tier,
        experienceGained: { player1: { attack: 48000 * tier } },
      }),
    };
  };
}

function createInput({ secondSlot = false, ...overrides } = {}) {
  const playerConfig = createEmptyPlayerConfig('1');
  if (secondSlot) {
    playerConfig.levels.intelligence = SECOND_SLOT_REQUIRED_INTELLIGENCE;
  }
  playerConfig.abilities[ABILITY_SLOT] = { abilityHrid: ABILITY_HRID, level: 1 };
  if (secondSlot) {
    playerConfig.abilities[SECOND_ABILITY_SLOT] = { abilityHrid: SECOND_ABILITY_HRID, level: 1 };
  }
  const input = {
    playerConfig,
    simulationSettings: {
      mode: 'zone',
      zoneHrid: '/actions/combat/green_slimes',
      difficultyTier: 0,
      simulationTimeHours: 24,
    },
    settings: { maxRounds: 1, candidateLimit: 20, rounds: 3 },
    WorkerClientCtor: SimulatedWorkerClient,
    ...overrides,
  };
  return input;
}

// 与生产同源的两组种子（同一上下文 + 各自盐）：响应器用它区分泳道，测试用它自证
// 「粗筛与精测用的是两组不相交的随机流」。
function deriveLanes(input) {
  const seedContext = {
    playerId: String(input.playerConfig.id ?? '1'),
    playerConfig: input.playerConfig,
    simulationSettings: input.simulationSettings,
  };
  const screenSeeds = createTriggerOptimizerSeedSet({
    ...seedContext,
    salt: TRIGGER_OPTIMIZER_SEED_SALT_SCREEN,
    count: TRIGGER_OPTIMIZER_SCREEN_ROUNDS,
  });
  const searchSeeds = createTriggerOptimizerSeedSet({
    ...seedContext,
    salt: TRIGGER_OPTIMIZER_SEED_SALT_SEARCH,
    count: 3,
  });
  expect(screenSeeds.some((seed) => searchSeeds.includes(seed))).toBe(false);
  return { screenSet: new Set(screenSeeds.map((seed) => Number(seed) >>> 0)), screenSeeds, searchSeeds };
}

const candidateByValue = (choice, value) =>
  choice.candidates.find((candidate) => Number(candidate?.labelParams?.percent) === value);

afterEach(() => {
  cancelTriggerOptimizerRun();
  cancelDedicatedWorkerRuns();
  cancelSharedWorkerRun();
  SimulatedWorkerClient.responder = null;
  SimulatedWorkerClient.instances = [];
});

describe('pickRacingSurvivors / isRacingPool（纯函数）', () => {
  it('isRacingPool：候选数超过 RACING_MIN_POOL 才启用粗筛', () => {
    expect(isRacingPool(TRIGGER_OPTIMIZER_RACING_MIN_POOL)).toBe(false);
    expect(isRacingPool(TRIGGER_OPTIMIZER_RACING_MIN_POOL + 1)).toBe(true);
  });

  it('pickRacingSurvivors：top-K ∪ 锚点，锚点不因粗筛排名落榜，顺序保持排名序', () => {
    const entries = [
      { signature: 'a', score: 5, distance: 2, metrics: {}, paired: null },
      { signature: 'b', score: 4, distance: 2, metrics: {}, paired: null },
      { signature: 'c', score: 3, distance: 2, metrics: {}, paired: null },
      { signature: 'd', score: 2, distance: 2, metrics: {}, paired: null },
      { signature: 'anchor', score: 0, distance: 0, metrics: {}, paired: null },
    ];
    const survivors = pickRacingSurvivors(entries);
    expect(survivors.map((entry) => entry.signature)).toEqual(['a', 'b', 'c', 'anchor']);
    expect(survivors).toHaveLength(TRIGGER_OPTIMIZER_RACING_KEEP + 1);
  });
});

describe('racing 分级采样（大候选池）', () => {
  it('精测统计决定 winner：粗筛虚高的诱饵不被采纳，锚点保送精测，非幸存者只留粗筛记录', async () => {
    const input = createInput();
    const { screenSet, screenSeeds, searchSeeds } = deriveLanes(input);
    SimulatedWorkerClient.responder = makeResponder(screenSet);

    const result = await optimizeTriggers(input);

    const choice = result.perAbilityChoices[0];
    const pool = choice.candidates.length;
    expect(pool).toBeGreaterThan(TRIGGER_OPTIMIZER_RACING_MIN_POOL);

    // 报告自证采样口径。
    expect(result.racingUsed).toBe(true);
    expect(result.screenRounds).toBe(TRIGGER_OPTIMIZER_SCREEN_ROUNDS);
    expect(result.racingKeep).toBe(TRIGGER_OPTIMIZER_RACING_KEEP);

    // ② 精测为准：粗筛 top-1 是 201（诱饵），真正被采纳的必须是 202。
    const decoy = candidateByValue(choice, 201);
    const real = candidateByValue(choice, 202);
    expect(decoy).toBeTruthy();
    expect(real).toBeTruthy();
    expect(choice.chosen?.signature).toBe(real.signature);
    expect(choice.chosen.signature).not.toBe(decoy.signature);
    expect(result.adoptedSlots).toEqual([ABILITY_SLOT]);
    expect(result.bestTriggerMap[real.abilityHrid]).toEqual(real.triggers);

    // ④ 记录口径：幸存者（201/202/203 + 保送锚点）是精测记录；其余只有粗筛记录。
    const record = (candidate) => result.metricsByCandidate[`${ABILITY_SLOT}|${candidate.signature}`];
    for (const value of [201, 202, 203]) {
      const entry = record(candidateByValue(choice, value));
      expect(entry?.lane).toBe('decide');
      expect(entry?.sampleRounds).toBe(3);
    }
    // ③ 锚点保送：粗筛里它 0 分排不进 top-3，仍拿到精测记录（lane='decide'）。
    //    锚点签名 = 'default'（triggers=null，与 buildTriggerCandidateSignature 同构）。
    const anchorRecord = result.metricsByCandidate[`${ABILITY_SLOT}|default`];
    expect(anchorRecord?.lane).toBe('decide');
    const screenedOnly = choice.candidates
      .map((candidate) => record(candidate))
      .filter((entry) => entry?.lane === 'screen');
    expect(screenedOnly.length).toBe(pool - 4);
    for (const entry of screenedOnly) {
      expect(entry.sampleRounds).toBe(TRIGGER_OPTIMIZER_SCREEN_ROUNDS);
    }

    // ⑤ 成本口径：基线精测 3 + 粗筛参考 2 + 全池粗筛（2/条）+ 4 条精测（3/条）+ 复验 2×6。
    expect(result.evaluations).toBe(1 + 1 + pool + 4 + 2);
    expect(result.simulations).toBe(
      3 + 2 + pool * TRIGGER_OPTIMIZER_SCREEN_ROUNDS + 4 * 3 + 2 * TRIGGER_OPTIMIZER_VERIFY_ROUNDS,
    );
    expect(SimulatedWorkerClient.instances).toHaveLength(result.simulations);

    // 两泳道随机流不相交（样本分割的前提）：实际 worker 调用的 seed 与两组派生一一对应。
    const usedSeeds = SimulatedWorkerClient.instances.map((client) => Number(client.payload.seed) >>> 0);
    for (const seed of screenSeeds) expect(usedSeeds).toContain(Number(seed) >>> 0);
    for (const seed of searchSeeds) expect(usedSeeds).toContain(Number(seed) >>> 0);
  });

  it('多槽参考链：粗筛参考只测一次，采纳槽的粗筛测量直接接续（零额外模拟）', async () => {
    const input = createInput({ secondSlot: true });
    const { screenSet } = deriveLanes(input);
    SimulatedWorkerClient.responder = makeResponder(screenSet);

    const result = await optimizeTriggers(input);

    // 两个槽都采纳 202（各自独立增益 ⇒ 逐槽 +30%）。
    expect([...result.adoptedSlots].sort()).toEqual([ABILITY_SLOT, SECOND_ABILITY_SLOT].sort());
    for (const choice of result.perAbilityChoices) {
      const real = candidateByValue(choice, 202);
      expect(choice.chosen?.signature).toBe(real.signature);
      expect(result.bestTriggerMap[real.abilityHrid]).toEqual(real.triggers);
    }

    // 前提自证：两个槽都真的走了粗筛（大候选池）——「粗筛参考跨槽接续」只在 racing 槽之间
    // 才有内容可测（合成候选 9 条的下限保证 + 真实候选，每个池必 > RACING_MIN_POOL）。
    for (const choice of result.perAbilityChoices) {
      expect(isRacingPool(choice.candidates.length)).toBe(true);
    }

    // 成本：粗筛参考 1×2 —— 第二个槽沿用 winner 的粗筛测量，不再补测。
    const pools = result.perAbilityChoices.map((choice) => choice.candidates.length);
    expect(result.evaluations).toBe(1 + 1 + pools.reduce((total, pool) => total + pool + 4, 0) + 2);
    expect(result.simulations).toBe(
      3 +
        2 +
        pools.reduce((total, pool) => total + pool * TRIGGER_OPTIMIZER_SCREEN_ROUNDS + 4 * 3, 0) +
        2 * TRIGGER_OPTIMIZER_VERIFY_ROUNDS,
    );
  });
});

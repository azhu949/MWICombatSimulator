import { describe, expect, it } from 'vitest';

import { createEmptyPlayerConfig } from '../../shared/playerConfig.js';
import {
  TRIGGER_OPTIMIZER_DEFAULT_CANDIDATE_LIMIT,
  TRIGGER_OPTIMIZER_DEFAULT_MAX_ROUNDS,
  TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS,
  TRIGGER_OPTIMIZER_DEFAULT_ROUNDS,
  TRIGGER_OPTIMIZER_DEFAULT_SIMULATION_HOURS,
  TRIGGER_OPTIMIZER_DEFAULT_TARGET_SCOPE,
  TRIGGER_OPTIMIZER_DEATH_REDUCTION_CREDIT,
  TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
  TRIGGER_OPTIMIZER_MAX_MAX_ROUNDS,
  TRIGGER_OPTIMIZER_MAX_ROUNDS,
  TRIGGER_OPTIMIZER_MANA_RECOVERY_BONUS,
  TRIGGER_OPTIMIZER_METRIC_KEYS,
  TRIGGER_OPTIMIZER_MIN_CANDIDATE_LIMIT,
  TRIGGER_OPTIMIZER_MIN_MAX_ROUNDS,
  TRIGGER_OPTIMIZER_MIN_ROUNDS,
  TRIGGER_OPTIMIZER_MIN_USABLE_ROUNDS,
  TRIGGER_OPTIMIZER_PRESETS,
  TRIGGER_OPTIMIZER_PRESET_CUSTOM,
  TRIGGER_OPTIMIZER_PRESET_FAST,
  TRIGGER_OPTIMIZER_PRESET_FINE,
  TRIGGER_OPTIMIZER_PRESET_STANDARD,
  TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS,
  TRIGGER_OPTIMIZER_SCORE_EPSILON,
  buildTriggerCandidateSignature,
  computeObjectiveScore,
  createEmptyResult,
  createOptimizerInput,
  createTriggerOptimizerInputSignature,
  createTriggerOptimizerSeedSet,
  createTriggerOptimizerState,
  getTriggerOptimizerPresetSettings,
  isValidTriggerOptimizerSettings,
  normalizeTriggerOptimizerAppendPlan,
  normalizeTriggerOptimizerRobustnessAppendRounds,
  normalizeTriggerOptimizerRobustnessPlan,
  normalizeTriggerOptimizerRobustnessRounds,
  normalizeTriggerOptimizerRounds,
  normalizeTriggerOptimizerSettings,
  resolveRecommendedTriggerOptimizerRounds,
  resolveTriggerOptimizerAppendSpentSimulations,
  resolveTriggerOptimizerPresetId,
} from '../triggerOptimizerDomain.js';
import { sanitizeTriggerList } from '../triggerMapper.js';

const SELF = '/combat_trigger_dependencies/self';
const CURRENT_HP = '/combat_trigger_conditions/current_hp';
const LTE = '/combat_trigger_comparators/less_than_equal';

function playerWithAbilities(abilities, triggerMap = {}) {
  const config = createEmptyPlayerConfig('1');
  config.abilities = abilities;
  config.triggerMap = triggerMap;
  return config;
}

function simulationSettings(overrides = {}) {
  return {
    mode: 'zone',
    runScope: 'single',
    zoneHrid: '/zones/test',
    difficultyTier: 3,
    simulationTimeHours: 12,
    ...overrides,
  };
}

describe('triggerOptimizerDomain', () => {
  describe('createTriggerOptimizerState', () => {
    it('exposes settings / runtime / results with every documented field', () => {
      const state = createTriggerOptimizerState();
      expect(Object.keys(state).sort()).toEqual(['results', 'runtime', 'settings'].sort());

      expect(state.runtime).toEqual({
        isRunning: false,
        progress: 0,
        startedAt: null,
        elapsedSeconds: 0,
        error: '',
        cancelRequested: false,
        completionNoticeId: null,
      });

      expect(state.results).toEqual(
        expect.objectContaining({
          baseline: null,
          perAbilityChoices: [],
          metricsByCandidate: {},
          rounds: TRIGGER_OPTIMIZER_DEFAULT_ROUNDS,
          bestSignature: '',
          bestTriggerMap: null,
          passes: [],
          improvedSlots: [],
          // 跨槽联合采纳记录（2026-09-19，设计 §19.11）：骨架为空数组，搜索层原地累积。
          jointAdoptions: [],
          createdAt: 0,
          stale: false,
        }),
      );
    });

    it('uses the documented product defaults', () => {
      const { settings } = createTriggerOptimizerState();
      expect(settings.maxRounds).toBe(TRIGGER_OPTIMIZER_DEFAULT_MAX_ROUNDS);
      expect(settings.rounds).toBe(TRIGGER_OPTIMIZER_DEFAULT_ROUNDS);
      expect(settings.simulationHours).toBe(TRIGGER_OPTIMIZER_DEFAULT_SIMULATION_HOURS);
      expect(settings.candidateLimit).toBe(TRIGGER_OPTIMIZER_DEFAULT_CANDIDATE_LIMIT);
      expect(settings.targetScope).toBe(TRIGGER_OPTIMIZER_DEFAULT_TARGET_SCOPE);
      // 默认权重结构复用 queuePerformanceWeights（权重和为 1）。
      expect(settings.objectiveWeights.weightProfit).toBeCloseTo(0.5, 9);
      expect(settings.objectiveWeights.weightXp).toBeCloseTo(0.3, 9);
      expect(settings.objectiveWeights.weightDeathSafety).toBeCloseTo(0.2, 9);
      // 默认模拟时长与 store.simulationSettings.simulationTimeHours 的默认值对齐。
      expect(TRIGGER_OPTIMIZER_DEFAULT_SIMULATION_HOURS).toBe(24);
    });

    it('lets persisted settings override the defaults', () => {
      const state = createTriggerOptimizerState({
        objectiveWeights: { weightProfit: 0.2, weightXp: 0.4 },
        maxRounds: 4,
        simulationHours: 48,
        candidateLimit: 4,
        targetScope: 'abilities',
      });
      expect(state.settings.maxRounds).toBe(4);
      expect(state.settings.simulationHours).toBe(48);
      expect(state.settings.candidateLimit).toBe(4);
      expect(state.settings.objectiveWeights.weightProfit).toBeCloseTo(0.2, 9);
      expect(state.settings.objectiveWeights.weightXp).toBeCloseTo(0.4, 9);
      // 派生权重随设置变化（weightDeathSafety = 1 - profit - xp）。
      expect(state.settings.objectiveWeights.weightDeathSafety).toBeCloseTo(0.4, 9);
    });

    it('falls back to defaults on dirty persisted settings', () => {
      const state = createTriggerOptimizerState({
        maxRounds: 'not-a-number',
        simulationHours: -5,
        candidateLimit: 999,
        targetScope: 'weapons',
      });
      expect(state.settings.maxRounds).toBe(TRIGGER_OPTIMIZER_DEFAULT_MAX_ROUNDS);
      expect(state.settings.simulationHours).toBe(TRIGGER_OPTIMIZER_DEFAULT_SIMULATION_HOURS);
      expect(state.settings.candidateLimit).toBe(TRIGGER_OPTIMIZER_DEFAULT_CANDIDATE_LIMIT);
      expect(state.settings.targetScope).toBe(TRIGGER_OPTIMIZER_DEFAULT_TARGET_SCOPE);
    });
  });

  describe('normalizeTriggerOptimizerSettings', () => {
    it('accepts the design-doc field names as persistence aliases', () => {
      const normalized = normalizeTriggerOptimizerSettings({
        maxPasses: 5,
        maxCandidatesPerAbility: 6,
      });
      expect(normalized.maxRounds).toBe(5);
      expect(normalized.candidateLimit).toBe(6);
    });

    it('falls back to defaults for out-of-range values (dirty storage follows product defaults)', () => {
      // 越界值回落到默认而非 clamp 到边界：-5 小时不能被当成「1 小时」跑出误导结果。
      const normalized = normalizeTriggerOptimizerSettings({
        maxRounds: 99,
        rounds: 99,
        simulationHours: 99999,
        candidateLimit: 999,
      });
      expect(normalized.maxRounds).toBe(TRIGGER_OPTIMIZER_DEFAULT_MAX_ROUNDS);
      expect(normalized.rounds).toBe(TRIGGER_OPTIMIZER_DEFAULT_ROUNDS);
      expect(normalized.simulationHours).toBe(TRIGGER_OPTIMIZER_DEFAULT_SIMULATION_HOURS);
      expect(normalized.candidateLimit).toBe(TRIGGER_OPTIMIZER_DEFAULT_CANDIDATE_LIMIT);
    });

    it('treats non-object input as the product defaults', () => {
      expect(normalizeTriggerOptimizerSettings(null)).toEqual(normalizeTriggerOptimizerSettings());
      expect(normalizeTriggerOptimizerSettings('garbage').candidateLimit).toBe(
        TRIGGER_OPTIMIZER_DEFAULT_CANDIDATE_LIMIT,
      );
    });

    it('重复次数的归一化是唯一入口：合法值原样保留，越界/非整数回落产品默认', () => {
      expect(normalizeTriggerOptimizerRounds(3)).toBe(3);
      expect(normalizeTriggerOptimizerRounds('3')).toBe(3);
      expect(normalizeTriggerOptimizerRounds(TRIGGER_OPTIMIZER_MAX_ROUNDS)).toBe(TRIGGER_OPTIMIZER_MAX_ROUNDS);
      expect(normalizeTriggerOptimizerRounds(0)).toBe(TRIGGER_OPTIMIZER_DEFAULT_ROUNDS);
      expect(normalizeTriggerOptimizerRounds(TRIGGER_OPTIMIZER_MAX_ROUNDS + 1)).toBe(TRIGGER_OPTIMIZER_DEFAULT_ROUNDS);
      expect(normalizeTriggerOptimizerRounds(2.5)).toBe(TRIGGER_OPTIMIZER_DEFAULT_ROUNDS);
      expect(normalizeTriggerOptimizerRounds(undefined)).toBe(TRIGGER_OPTIMIZER_DEFAULT_ROUNDS);
      expect(normalizeTriggerOptimizerRounds('')).toBe(TRIGGER_OPTIMIZER_DEFAULT_ROUNDS);
    });
  });

  describe('isValidTriggerOptimizerSettings', () => {
    it('accepts the documented defaults and explicit legal values', () => {
      expect(isValidTriggerOptimizerSettings(normalizeTriggerOptimizerSettings())).toBe(true);
      expect(
        isValidTriggerOptimizerSettings({
          objectiveWeights: { weightProfit: 0.5, weightXp: 0.3 },
          maxRounds: 3,
          rounds: 1,
          simulationHours: 24,
          candidateLimit: 8,
          targetScope: 'abilities',
        }),
      ).toBe(true);
    });

    it('rejects illegal values', () => {
      expect(isValidTriggerOptimizerSettings({ objectiveWeights: { weightProfit: 0.9, weightXp: 0.9 } })).toBe(false);
      expect(isValidTriggerOptimizerSettings({ maxRounds: 0 })).toBe(false);
      expect(isValidTriggerOptimizerSettings({ simulationHours: 0 })).toBe(false);
      expect(isValidTriggerOptimizerSettings({ candidateLimit: 1 })).toBe(false);
      expect(isValidTriggerOptimizerSettings({ targetScope: 'weapons' })).toBe(false);
      expect(isValidTriggerOptimizerSettings({ rounds: 11 })).toBe(false);
    });
  });

  describe('搜索强度预设', () => {
    it('「标准」预设 = 三个产品默认常量（默认档位就是现状，不偷偷变快或变慢）', () => {
      expect(getTriggerOptimizerPresetSettings(TRIGGER_OPTIMIZER_PRESET_STANDARD)).toEqual({
        candidateLimit: TRIGGER_OPTIMIZER_DEFAULT_CANDIDATE_LIMIT,
        maxRounds: TRIGGER_OPTIMIZER_DEFAULT_MAX_ROUNDS,
        rounds: TRIGGER_OPTIMIZER_DEFAULT_ROUNDS,
      });
      expect(resolveTriggerOptimizerPresetId(normalizeTriggerOptimizerSettings({}))).toBe(
        TRIGGER_OPTIMIZER_PRESET_STANDARD,
      );
    });

    it('每档预设的三个数值都在各自合法区间内（预设产不出非法设置）', () => {
      for (const preset of TRIGGER_OPTIMIZER_PRESETS) {
        const settings = getTriggerOptimizerPresetSettings(preset.id);
        expect(settings.candidateLimit).toBeGreaterThanOrEqual(TRIGGER_OPTIMIZER_MIN_CANDIDATE_LIMIT);
        expect(settings.candidateLimit).toBeLessThanOrEqual(TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT);
        expect(settings.maxRounds).toBeGreaterThanOrEqual(TRIGGER_OPTIMIZER_MIN_MAX_ROUNDS);
        expect(settings.maxRounds).toBeLessThanOrEqual(TRIGGER_OPTIMIZER_MAX_MAX_ROUNDS);
        expect(settings.rounds).toBeGreaterThanOrEqual(TRIGGER_OPTIMIZER_MIN_ROUNDS);
        expect(settings.rounds).toBeLessThanOrEqual(TRIGGER_OPTIMIZER_MAX_ROUNDS);
      }
      // 三档预设的三元组两两不同（否则下拉里会出现两个名字指向同一档）。
      const triples = TRIGGER_OPTIMIZER_PRESETS.map((preset) =>
        JSON.stringify(getTriggerOptimizerPresetSettings(preset.id)),
      );
      expect(new Set(triples).size).toBe(TRIGGER_OPTIMIZER_PRESETS.length);
    });

    it('每档预设的 rounds 都不低于「可用的最少抽样轮数」：否则该档永远采纳不了候选', () => {
      // rounds < 2 时配对统计给不出标准误（verdict 恒 unknown）→ 采纳闸门
      // （hasAdoptionEvidence）永远拒绝 → 该档只是一个「烧机器、却永远报未找到更优配置」
      // 的死档。早先快速档 rounds=1 的「速度优势」本身就是把噪声当提升（实测 +49% 利润
      // 的假象），不是真的快。
      for (const preset of TRIGGER_OPTIMIZER_PRESETS) {
        expect(preset.rounds).toBeGreaterThanOrEqual(TRIGGER_OPTIMIZER_MIN_USABLE_ROUNDS);
      }
      expect(getTriggerOptimizerPresetSettings(TRIGGER_OPTIMIZER_PRESET_FAST)).toEqual({
        candidateLimit: 6,
        maxRounds: 1,
        rounds: TRIGGER_OPTIMIZER_MIN_USABLE_ROUNDS,
      });
    });

    it('三元组匹配不上预设 → 自定义；脏值先归一化再比对', () => {
      expect(resolveTriggerOptimizerPresetId({ candidateLimit: 8, maxRounds: 2, rounds: 3 })).toBe(
        TRIGGER_OPTIMIZER_PRESET_CUSTOM,
      );
      // 精细档 = (上限候选数, 3, 6)：用常量而不是字面量 —— 上限 2026-09-20 已从 16 提到 20。
      expect(
        resolveTriggerOptimizerPresetId({
          candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
          maxRounds: 3,
          rounds: 6,
        }),
      ).toBe(TRIGGER_OPTIMIZER_PRESET_FINE);
      // 字符串数字等价于数字（归一化后判定）。
      expect(
        resolveTriggerOptimizerPresetId({
          candidateLimit: String(TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT),
          maxRounds: '3',
          rounds: '6',
        }),
      ).toBe(TRIGGER_OPTIMIZER_PRESET_FINE);
      // 越界值回落到产品默认（10/2/5 ≠ 精细档），不会伪装成精细档。
      expect(resolveTriggerOptimizerPresetId({ candidateLimit: 999, maxRounds: 3, rounds: 2 })).toBe(
        TRIGGER_OPTIMIZER_PRESET_CUSTOM,
      );
      // 旧版本持久化的「精细档」三元组（16/3/6）现在落在两档之间 → 自定义（不静默改成别的档）。
      expect(resolveTriggerOptimizerPresetId({ candidateLimit: 16, maxRounds: 3, rounds: 6 })).toBe(
        TRIGGER_OPTIMIZER_PRESET_CUSTOM,
      );
    });

    it('未知预设 id 返回 null（调用方据此忽略该次选择）', () => {
      expect(getTriggerOptimizerPresetSettings('turbo')).toBeNull();
      expect(getTriggerOptimizerPresetSettings(undefined)).toBeNull();
      expect(getTriggerOptimizerPresetSettings(TRIGGER_OPTIMIZER_PRESET_CUSTOM)).toBeNull();
    });

    // 时长自适应轮数（2026-09-20 按功效实测重定，设计 §20.1）：从「全局推荐值 ×
    // 基础轮数」的两段式改为**每档自带一张「时长 → 轮数」表**。依据：采纳地板
    // ∝ 1/√(n·T)（总模拟小时数是唯一货币），但 p<0.05 的显著门槛还要乘 t(n−1)——
    // 实测 24h × 2 轮的显著门槛要 ≈9.2% 利润（搜索期 verdict 几乎恒 inconclusive），
    // × 5 轮降到 ≈1.2%。三档按「结论强度」分档，长时长用各档的兜底轮数。
    it('时长自适应：每档自带「时长 → 轮数」表（fast 5/3/2、standard 8/6/5、fine 10/10/6）', () => {
      const roundsAt = (presetId, hours) => getTriggerOptimizerPresetSettings(presetId, hours).rounds;
      // fast：保持历史行为（短时长加密，长时长 2 轮）。
      expect([4, 8, 24, 168].map((hours) => roundsAt(TRIGGER_OPTIMIZER_PRESET_FAST, hours))).toEqual([5, 3, 2, 2]);
      // standard（= 产品默认档）：24h 从 2 轮提到 5 轮 —— 本轮的核心改动。
      expect([1, 4, 8, 12, 24, 168].map((hours) => roundsAt(TRIGGER_OPTIMIZER_PRESET_STANDARD, hours))).toEqual([
        8, 8, 6, 5, 5, 5,
      ]);
      // fine：短时长 10 轮（档位值，未跟随 2026-09-27 的上限 10→12）、长时长 6 轮（与复验的 6 轮口径对齐）。
      expect([4, 8, 24].map((hours) => roundsAt(TRIGGER_OPTIMIZER_PRESET_FINE, hours))).toEqual([10, 10, 6]);
      // 三档在任意时长下严格有序（fast < standard < fine），否则下拉里的档位没有意义。
      for (const hours of [1, 4, 8, 12, 24, 168]) {
        expect(roundsAt(TRIGGER_OPTIMIZER_PRESET_FAST, hours)).toBeLessThan(
          roundsAt(TRIGGER_OPTIMIZER_PRESET_STANDARD, hours),
        );
        expect(roundsAt(TRIGGER_OPTIMIZER_PRESET_STANDARD, hours)).toBeLessThan(
          roundsAt(TRIGGER_OPTIMIZER_PRESET_FINE, hours),
        );
      }
      // 缺省 hours（旧调用方）按产品默认时长解析 → 各档的长时长口径。
      expect(getTriggerOptimizerPresetSettings(TRIGGER_OPTIMIZER_PRESET_STANDARD)).toEqual({
        candidateLimit: TRIGGER_OPTIMIZER_DEFAULT_CANDIDATE_LIMIT,
        maxRounds: TRIGGER_OPTIMIZER_DEFAULT_MAX_ROUNDS,
        rounds: TRIGGER_OPTIMIZER_DEFAULT_ROUNDS,
      });
      // 「推荐轮数」入口 = 标准档口径；非法/缺省时长回落产品默认时长（24h → 5 轮）。
      expect(resolveRecommendedTriggerOptimizerRounds(4)).toBe(8);
      expect(resolveRecommendedTriggerOptimizerRounds(24)).toBe(TRIGGER_OPTIMIZER_DEFAULT_ROUNDS);
      expect(resolveRecommendedTriggerOptimizerRounds('not-a-number')).toBe(TRIGGER_OPTIMIZER_DEFAULT_ROUNDS);
      expect(resolveRecommendedTriggerOptimizerRounds(undefined)).toBe(TRIGGER_OPTIMIZER_DEFAULT_ROUNDS);
    });

    it('预设判定走「设置自己的时长」：同一三元组在 4h 命中标准档、在 24h 就是自定义', () => {
      expect(
        resolveTriggerOptimizerPresetId({
          candidateLimit: TRIGGER_OPTIMIZER_DEFAULT_CANDIDATE_LIMIT,
          maxRounds: TRIGGER_OPTIMIZER_DEFAULT_MAX_ROUNDS,
          rounds: 8,
          simulationHours: 4,
        }),
      ).toBe(TRIGGER_OPTIMIZER_PRESET_STANDARD);
      expect(
        resolveTriggerOptimizerPresetId({
          candidateLimit: TRIGGER_OPTIMIZER_DEFAULT_CANDIDATE_LIMIT,
          maxRounds: TRIGGER_OPTIMIZER_DEFAULT_MAX_ROUNDS,
          rounds: 8,
          simulationHours: 24,
        }),
      ).toBe(TRIGGER_OPTIMIZER_PRESET_CUSTOM);
      expect(
        resolveTriggerOptimizerPresetId({
          candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
          maxRounds: 3,
          rounds: 10,
          simulationHours: 4,
        }),
      ).toBe(TRIGGER_OPTIMIZER_PRESET_FINE);
    });
  });

  describe('createOptimizerInput', () => {
    it('deep-clones the player config so search-time mutation never leaks into the source', () => {
      const source = playerWithAbilities(
        [
          { abilityHrid: '/abilities/fireball', level: 5 },
          { abilityHrid: '', level: 1 },
        ],
        { '/abilities/fireball': [{ dependencyHrid: SELF, conditionHrid: CURRENT_HP, comparatorHrid: LTE, value: 7 }] },
      );
      const input = createOptimizerInput(source, simulationSettings());

      input.player.triggerMap['/abilities/fireball'] = [];
      input.player.abilities[0].level = 99;
      expect(source.abilities[0].level).toBe(5);
      expect(source.triggerMap['/abilities/fireball'][0].value).toBe(7);
    });

    it('excludes derived player fields (assetScore etc.) from the fingerprint — asset recomputation must not expire reports', () => {
      // 2026-09-17 浏览器冒烟回归：assetScore 由行情/资产管线异步重算写入（含 computedAt），
      // 一旦进指纹，应用优化结果后的资产重算会让报告被误判过期（「撤销」按钮消失）。
      const source = playerWithAbilities([{ abilityHrid: '/abilities/fireball', level: 1 }]);
      const signatureOf = (input) => createTriggerOptimizerInputSignature(input);
      const first = createOptimizerInput(source, simulationSettings());
      const base = signatureOf(first);

      source.assetScore = { version: 1, computedAt: 1789648361304, total: 3026.6, items: {} };
      expect(signatureOf(createOptimizerInput(source, simulationSettings()))).toBe(base);

      source.skillExperience = { attack: 12345 };
      expect(signatureOf(createOptimizerInput(source, simulationSettings()))).toBe(base);

      // 战斗键仍然生效：装备变化必须让指纹变化。
      source.equipment = {
        ...source.equipment,
        weapon: { itemHrid: '/items/other_weapon', enhancementLevel: 0 },
      };
      expect(signatureOf(createOptimizerInput(source, simulationSettings()))).not.toBe(base);
    });

    it('freezes the baseline triggerMap for later revert', () => {
      const source = playerWithAbilities([{ abilityHrid: '/abilities/fireball', level: 1 }], {
        '/abilities/fireball': [{ dependencyHrid: SELF, conditionHrid: CURRENT_HP, comparatorHrid: LTE, value: 7 }],
      });
      const { baselineTriggerMap } = createOptimizerInput(source, simulationSettings());
      expect(Object.isFrozen(baselineTriggerMap)).toBe(true);
      expect(Object.isFrozen(baselineTriggerMap['/abilities/fireball'])).toBe(true);
      expect(() => {
        baselineTriggerMap['/abilities/fireball'] = [];
      }).toThrow(TypeError);
      expect(baselineTriggerMap['/abilities/fireball'][0].value).toBe(7);
    });

    it('handles players without a triggerMap (empty baseline)', () => {
      const { baselineTriggerMap } = createOptimizerInput(
        playerWithAbilities([{ abilityHrid: '/abilities/fireball', level: 1 }]),
        simulationSettings(),
      );
      expect(Object.isFrozen(baselineTriggerMap)).toBe(true);
      expect(baselineTriggerMap).toEqual({});
    });

    it('snapshots the simulation settings that affect results', () => {
      const { simulation } = createOptimizerInput(
        playerWithAbilities([{ abilityHrid: '/abilities/fireball', level: 1 }]),
        simulationSettings({ zoneHrid: '/zones/other', simulationTimeHours: 36 }),
      );
      expect(simulation.zoneHrid).toBe('/zones/other');
      expect(simulation.simulationTimeHours).toBe(36);
      // 快照是独立拷贝：改原件不影响输入。
      const settings = simulationSettings();
      const input = createOptimizerInput(
        playerWithAbilities([{ abilityHrid: '/abilities/fireball', level: 1 }]),
        settings,
      );
      settings.zoneHrid = '/zones/mutated';
      expect(input.simulation.zoneHrid).toBe('/zones/test');
    });

    it('队伍载荷进指纹：队友集合 / 队友配置变化都让报告过期（设计 §59）', () => {
      const source = playerWithAbilities([{ abilityHrid: '/abilities/fireball', level: 1 }]);
      const makeMate = (overrides = {}) => ({
        ...playerWithAbilities([{ abilityHrid: '/abilities/fireball', level: 1 }]),
        id: '2',
        name: 'Mate',
        ...overrides,
      });
      const signature = (teammates) =>
        createTriggerOptimizerInputSignature(createOptimizerInput(source, simulationSettings(), { teammates }));

      const solo = signature(undefined);
      // 空集合 = 单人载荷：形状恒定，指纹与不传队友逐值一致。
      expect(signature([])).toBe(solo);
      const withMate = signature([makeMate()]);
      expect(withMate).not.toBe(solo);
      // 队友自己的触发器同样改变整队输出 ⇒ 必须进指纹（否则「队友被改过」的报告会被误用）。
      expect(signature([makeMate({ triggerMap: { '/abilities/fireball': [] } })])).not.toBe(withMate);
      // 队友的装备变化同样进指纹（战斗键口径与主角同源）。
      expect(signature([makeMate({ equipment: { weapon: { itemHrid: '/items/other' } } })])).not.toBe(withMate);
      // 派生字段不进指纹（与主角同款）：资产重算不该让未过期的报告失效。
      expect(signature([makeMate({ assetScore: { computedAt: 1, total: 2 } })])).toBe(withMate);
    });

    it('队伍设置归一化：去重 + 保序 + 上限，并拒绝非法值（设计 §59）', () => {
      const source = playerWithAbilities([{ abilityHrid: '/abilities/fireball', level: 1 }]);
      const partyOf = (partyPlayerIds) =>
        createOptimizerInput(source, simulationSettings(), { settings: { partyPlayerIds } }).settings.partyPlayerIds;

      expect(partyOf(undefined)).toEqual([]);
      expect(partyOf(['3', '2', '3'])).toEqual(['3', '2']);
      // 上限 = 主角之外最多 4 名队友（引擎的玩家 hrid 只到 player5）。
      expect(partyOf(['1', '2', '3', '4', '5', '6'])).toEqual(['1', '2', '3', '4']);
      expect(partyOf([''])).toEqual([]);

      const base = normalizeTriggerOptimizerSettings({});
      expect(isValidTriggerOptimizerSettings({ ...base, partyPlayerIds: ['2'] })).toBe(true);
      expect(isValidTriggerOptimizerSettings({ ...base, partyPlayerIds: '2' })).toBe(false);
      expect(isValidTriggerOptimizerSettings({ ...base, partyPlayerIds: ['2', ''] })).toBe(false);
    });
  });

  describe('createTriggerOptimizerInputSignature', () => {
    const baseInput = () =>
      createOptimizerInput(
        playerWithAbilities([{ abilityHrid: '/abilities/fireball', level: 1 }]),
        simulationSettings(),
        { settings: { objectiveWeights: { weightProfit: 0.5, weightXp: 0.3 } } },
      );

    it('is stable for identical inputs and ignores key order', () => {
      const a = baseInput();
      const b = baseInput();
      // 打乱键顺序：指纹必须不变（递归排序）。
      const shuffled = {
        settings: b.settings,
        simulation: b.simulation,
        baselineTriggerMap: b.baselineTriggerMap,
        teammates: b.teammates,
        player: b.player,
        playerId: b.playerId,
      };
      expect(createTriggerOptimizerInputSignature(a)).toBe(createTriggerOptimizerInputSignature(b));
      expect(createTriggerOptimizerInputSignature(shuffled)).toBe(createTriggerOptimizerInputSignature(a));
    });

    it('changes when the triggerMap changes (report goes stale after applying a result)', () => {
      const a = baseInput();
      const b = baseInput();
      b.player.triggerMap['/abilities/fireball'] = [];
      expect(createTriggerOptimizerInputSignature(a)).not.toBe(createTriggerOptimizerInputSignature(b));
    });

    it('changes when the zone, duration or weights change', () => {
      const base = createTriggerOptimizerInputSignature(baseInput());
      const zoneChanged = createTriggerOptimizerInputSignature(
        createOptimizerInput(
          playerWithAbilities([{ abilityHrid: '/abilities/fireball', level: 1 }]),
          simulationSettings({ zoneHrid: '/zones/other' }),
        ),
      );
      const hoursChanged = createTriggerOptimizerInputSignature(
        createOptimizerInput(
          playerWithAbilities([{ abilityHrid: '/abilities/fireball', level: 1 }]),
          simulationSettings({ simulationTimeHours: 48 }),
        ),
      );
      const weightsChanged = createTriggerOptimizerInputSignature(
        createOptimizerInput(
          playerWithAbilities([{ abilityHrid: '/abilities/fireball', level: 1 }]),
          simulationSettings(),
          { settings: { objectiveWeights: { weightProfit: 0.2, weightXp: 0.4 } } },
        ),
      );
      expect(new Set([base, zoneChanged, hoursChanged, weightsChanged]).size).toBe(4);
    });

    it('changes when extra gain settings change (moo pass / community exp & drop)', () => {
      // 回归（2026-09-27）：这五个字段随 buildSimulationExtra 进入每场模拟，改月卡或
      // 社区经验 / 掉落倍率后既有报告必须过期。此前指纹遗漏它们，旧报告仍可被应用。
      const base = createTriggerOptimizerInputSignature(baseInput());
      const mooPassChanged = createTriggerOptimizerInputSignature(
        createOptimizerInput(
          playerWithAbilities([{ abilityHrid: '/abilities/fireball', level: 1 }]),
          simulationSettings({ mooPass: true }),
        ),
      );
      const comExpChanged = createTriggerOptimizerInputSignature(
        createOptimizerInput(
          playerWithAbilities([{ abilityHrid: '/abilities/fireball', level: 1 }]),
          simulationSettings({ comExpEnabled: true, comExp: 20 }),
        ),
      );
      const comDropChanged = createTriggerOptimizerInputSignature(
        createOptimizerInput(
          playerWithAbilities([{ abilityHrid: '/abilities/fireball', level: 1 }]),
          simulationSettings({ comDropEnabled: true, comDrop: 20 }),
        ),
      );
      expect(new Set([base, mooPassChanged, comExpChanged, comDropChanged]).size).toBe(4);
    });
  });

  describe('createEmptyResult', () => {
    it('returns a fresh, independent skeleton on every call', () => {
      const first = createEmptyResult();
      first.perAbilityChoices.push({ slotIndex: 0 });
      first.metricsByCandidate['x'] = {};
      const second = createEmptyResult();
      expect(second.perAbilityChoices).toEqual([]);
      expect(second.metricsByCandidate).toEqual({});
      expect(second.rounds).toBe(TRIGGER_OPTIMIZER_DEFAULT_ROUNDS);
      // 「轮数上限截断」标记默认 false（2026-09-19，设计 §19.8）：骨架与搜索报告同形。
      expect(second.roundLimitReached).toBe(false);
    });
  });

  describe('buildTriggerCandidateSignature', () => {
    it('uses fixed anchors for delete-key and fire-immediately', () => {
      expect(buildTriggerCandidateSignature(null)).toBe('default');
      expect(buildTriggerCandidateSignature([])).toBe('[]');
    });

    it('is driven by sanitized content and preserves entry order', () => {
      const triggers = [{ dependencyHrid: SELF, conditionHrid: CURRENT_HP, comparatorHrid: LTE, value: 100 }];
      expect(buildTriggerCandidateSignature(triggers)).toBe(JSON.stringify(sanitizeTriggerList(triggers)));
      // 单条目反转与原列表等价。
      expect(buildTriggerCandidateSignature([...triggers].reverse())).toBe(buildTriggerCandidateSignature(triggers));
      // sanitize 保留输入顺序：条目顺序不同 → 签名不同（候选去重必须用 sanitize 后的内容）。
      const enrage = {
        dependencyHrid: SELF,
        conditionHrid: '/combat_trigger_conditions/enrage',
        comparatorHrid: '/combat_trigger_comparators/is_inactive',
        value: 0,
      };
      expect(buildTriggerCandidateSignature([triggers[0], enrage])).not.toBe(
        buildTriggerCandidateSignature([enrage, triggers[0]]),
      );
    });
  });

  describe('computeObjectiveScore', () => {
    const zeroMetrics = () => Object.fromEntries(TRIGGER_OPTIMIZER_METRIC_KEYS.map((key) => [key, 0]));

    it('scores the baseline against itself as exactly zero', () => {
      const baseline = { ...zeroMetrics(), deathsPerHour: 1 };
      expect(computeObjectiveScore(baseline, TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS, baseline)).toBeCloseTo(0, 9);
    });

    it('相对基线翻倍 = 每指标 +1 分，未饱和区间内严格单调', () => {
      const baseline = { ...zeroMetrics(), dailyNoRngProfit: 10000 };
      // relative = (20000 - 10000) / max(10000, floor 10000) = 1 → log2(2) = 1 → 0.5 * 1。
      const score = computeObjectiveScore(
        { ...zeroMetrics(), dailyNoRngProfit: 20000 },
        TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS,
        baseline,
      );
      expect(score).toBeCloseTo(0.5, 9);
      // +50% → log2(1.5)（未饱和）。
      const mild = computeObjectiveScore(
        { ...zeroMetrics(), dailyNoRngProfit: 15000 },
        TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS,
        baseline,
      );
      expect(mild).toBeCloseTo(0.5 * Math.log2(1.5), 9);
      expect(mild).toBeLessThan(score);
    });

    it('奖励「把亏损压小」：负基线不再被钳零（旧口径的静默错误排序）', () => {
      // 基线亏损 5000/天、候选只亏 500/天——这是实打实的改进，必须得正分。
      const baseline = { ...zeroMetrics(), dailyNoRngProfit: -5000 };
      const improved = computeObjectiveScore(
        { ...zeroMetrics(), dailyNoRngProfit: -500 },
        TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS,
        baseline,
      );
      const worse = computeObjectiveScore(
        { ...zeroMetrics(), dailyNoRngProfit: -20000 },
        TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS,
        baseline,
      );
      expect(improved).toBeGreaterThan(0);
      expect(worse).toBeLessThan(0);
      expect(improved).toBeGreaterThan(worse);
      // 基线为负时旧口径 (m+1)/(base+1) 会翻转符号，这里必须保持正确方向：
      // 越靠近 0（越不亏）分数越高。
      const closerToZero = computeObjectiveScore(
        { ...zeroMetrics(), dailyNoRngProfit: -100 },
        TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS,
        baseline,
      );
      expect(closerToZero).toBeGreaterThan(improved);
    });

    it('量纲地板：基线接近 0 时不会把微小差异放大成满分', () => {
      // 基线利润 0（地板 10000）→ 候选 +2 只值 log2(1 + 2/10000)，远小于 1 分。
      const score = computeObjectiveScore(
        { ...zeroMetrics(), dailyNoRngProfit: 2 },
        TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS,
        { ...zeroMetrics(), dailyNoRngProfit: 0 },
      );
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(0.001);
    });

    it('is monotonic in each metric', () => {
      const baseline = { ...zeroMetrics(), dps: 100 };
      const weights = { weightProfit: 0, weightXp: 0 }; // weightDeathSafety=1 → dps 权重 0.5
      const low = computeObjectiveScore({ ...zeroMetrics(), dps: 100 }, weights, baseline);
      const mid = computeObjectiveScore({ ...zeroMetrics(), dps: 200 }, weights, baseline);
      const high = computeObjectiveScore({ ...zeroMetrics(), dps: 400 }, weights, baseline);
      expect(low).toBeLessThan(mid);
      expect(mid).toBeLessThan(high);
    });

    it('clamps the per-metric contribution to [-1, 1]', () => {
      const baseline = zeroMetrics();
      // 用极大但有限的值（1e12）而不是 Infinity：指标经 toFiniteNumber 会丢弃非有限值。
      const huge = computeObjectiveScore(
        { ...zeroMetrics(), dps: 1e12 },
        TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS,
        baseline,
      );
      expect(huge).toBeLessThanOrEqual(1);
      const hugeWeight = computeObjectiveScore(
        { ...zeroMetrics(), dps: 1e12 },
        { weightProfit: 0, weightXp: 0 },
        baseline,
      );
      expect(hugeWeight).toBeCloseTo(0.5, 9); // weightDps = 0.5 * clamp(1) = 0.5
      const collapsed = computeObjectiveScore(
        { ...zeroMetrics(), dps: 0 },
        TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS,
        { ...zeroMetrics(), dps: 1000 },
      );
      // relative = (0 - 1000) / max(1000, floor 1000) = -1 → 该指标钳到 -1。
      expect(collapsed).toBeGreaterThanOrEqual(-1);
      expect(collapsed).toBeCloseTo(-0.1, 9); // weightDps = 0.1
    });

    it('penalizes extra deaths and symmetrically rewards fewer deaths', () => {
      const baseline = { ...zeroMetrics(), deathsPerHour: 1 };
      const weights = { weightProfit: 0, weightXp: 0 }; // weightDeathSafety = 1
      const moreDeaths = computeObjectiveScore({ ...zeroMetrics(), deathsPerHour: 11 }, weights, baseline);
      const fewerDeaths = computeObjectiveScore({ ...zeroMetrics(), deathsPerHour: 0 }, weights, baseline);
      // 惩罚：增加 10 次 / max(1, 2) → -5。
      expect(moreDeaths).toBeCloseTo(-1 * (10 / Math.max(1, 2)), 9);
      // 奖励：减少 1 次 / max(1, 2) × CREDIT → +0.5（旧口径此项为 0，「死亡更低」不得分）。
      expect(fewerDeaths).toBeCloseTo(TRIGGER_OPTIMIZER_DEATH_REDUCTION_CREDIT * (1 / Math.max(1, 2)), 9);
      expect(fewerDeaths).toBeGreaterThan(0);
      // 惩罚与奖励都随 weightDeathSafety 缩放：默认权重（0.2）下同一变化只值 1/5。
      const defaultFewer = computeObjectiveScore(
        { ...zeroMetrics(), deathsPerHour: 0 },
        TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS,
        baseline,
      );
      expect(defaultFewer).toBeCloseTo(TRIGGER_OPTIMIZER_DEATH_REDUCTION_CREDIT * (1 / 2) * 0.2, 9);
    });

    it('死亡减少的奖励有上限：基线清零时不超过 CREDIT × weightDeathSafety', () => {
      const baseline = { ...zeroMetrics(), deathsPerHour: 100 };
      const weights = { weightProfit: 0, weightXp: 0 }; // weightDeathSafety = 1
      const noDeaths = computeObjectiveScore({ ...zeroMetrics(), deathsPerHour: 0 }, weights, baseline);
      // reduction=100，分母 max(100, 2)=100 → min(1, 1) → 满分奖励（不会再超出）。
      expect(noDeaths).toBeCloseTo(TRIGGER_OPTIMIZER_DEATH_REDUCTION_CREDIT, 9);
      const halfDeaths = computeObjectiveScore({ ...zeroMetrics(), deathsPerHour: 50 }, weights, baseline);
      expect(halfDeaths).toBeCloseTo(TRIGGER_OPTIMIZER_DEATH_REDUCTION_CREDIT * 0.5, 9);
      expect(halfDeaths).toBeLessThan(noDeaths);
    });

    it('treats missing metrics as zero and never yields NaN', () => {
      const score = computeObjectiveScore({}, TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS, {});
      expect(Number.isFinite(score)).toBe(true);
      expect(score).toBeCloseTo(0, 9);
    });

    it('vetoes mana exhaustion with -Infinity', () => {
      expect(computeObjectiveScore({ ranOutOfMana: true }, TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS, {})).toBe(
        -Infinity,
      );
      // 指标再好也救不回来。
      expect(
        computeObjectiveScore(
          { ...zeroMetrics(), dps: Infinity, ranOutOfMana: true },
          TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS,
          {},
        ),
      ).toBe(-Infinity);
    });

    it('空蓝只在「基线不空蓝而候选空蓝」时判负，修复空蓝另有加分', () => {
      // 回归：基线不空蓝、候选空蓝 → 否决。
      expect(
        computeObjectiveScore({ ...zeroMetrics(), ranOutOfMana: true }, TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS, {
          ...zeroMetrics(),
          ranOutOfMana: false,
        }),
      ).toBe(-Infinity);
      // 基线自己也空蓝 → 候选空蓝不算退步（旧口径会把它系统性误杀）。
      const starved = { ...zeroMetrics(), ranOutOfMana: true };
      expect(
        Number.isFinite(
          computeObjectiveScore(
            { ...zeroMetrics(), ranOutOfMana: true },
            TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS,
            starved,
          ),
        ),
      ).toBe(true);
      // 修复空蓝 → 固定加分，让「不再崩蓝」这种改进能浮出水面。
      expect(
        computeObjectiveScore(
          { ...zeroMetrics(), ranOutOfMana: false },
          TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS,
          starved,
        ),
      ).toBeCloseTo(TRIGGER_OPTIMIZER_MANA_RECOVERY_BONUS, 9);
    });

    it('accepts resolved subweights (byMetric) directly', () => {
      const subweights = {
        byMetric: { dps: 1, dailyNoRngProfit: 0, xpPerHour: 0, killsPerHour: 0 },
        weightDeathSafety: 0,
      };
      // dps 地板 1000 主导（基线 100 很小）：relative = 50 / 1000 → log2(1.05)。
      const score = computeObjectiveScore({ dps: 150 }, subweights, { dps: 100 });
      expect(score).toBeCloseTo(Math.log2(1.05), 9);
    });
  });

  describe('createTriggerOptimizerSeedSet（公共随机数的基础）', () => {
    const playerConfig = () =>
      playerWithAbilities([
        { abilityHrid: '/abilities/fireball', level: 1 },
        { abilityHrid: '/abilities/ice_bolt', level: 1 },
      ]);

    it('同样输入 → 同样种子集：结论可复现、可交叉验证', () => {
      const args = { playerId: '1', playerConfig: playerConfig(), simulationSettings: simulationSettings(), count: 3 };
      expect(createTriggerOptimizerSeedSet(args)).toEqual(createTriggerOptimizerSeedSet(args));
      expect(createTriggerOptimizerSeedSet(args)).toHaveLength(3);
      expect(new Set(createTriggerOptimizerSeedSet(args)).size).toBe(3);
      expect(createTriggerOptimizerSeedSet(args).every((seed) => Number.isInteger(seed) && seed >= 0)).toBe(true);
    });

    it('不随 triggerMap 变化：搜索期间 triggerMap 一直在变，算进种子就会毁掉配对性', () => {
      const before = playerWithAbilities([{ abilityHrid: '/abilities/fireball', level: 1 }], {});
      const after = playerWithAbilities([{ abilityHrid: '/abilities/fireball', level: 1 }], {
        '/abilities/fireball': [],
      });
      const args = { playerId: '1', simulationSettings: simulationSettings(), count: 2 };
      expect(createTriggerOptimizerSeedSet({ ...args, playerConfig: after })).toEqual(
        createTriggerOptimizerSeedSet({ ...args, playerConfig: before }),
      );
    });

    it('玩家/技能列表/区域/难度/时长/盐任一变化都会错开随机流', () => {
      const base = { playerId: '1', playerConfig: playerConfig(), simulationSettings: simulationSettings(), count: 1 };
      const pick = (overrides) => createTriggerOptimizerSeedSet({ ...base, ...overrides })[0];
      const values = new Set([
        pick({}),
        pick({ playerId: '2' }),
        pick({ playerConfig: playerWithAbilities([{ abilityHrid: '/abilities/fireball', level: 1 }]) }),
        pick({ simulationSettings: simulationSettings({ zoneHrid: '/zones/other' }) }),
        pick({ simulationSettings: simulationSettings({ simulationTimeHours: 48 }) }),
        pick({ simulationSettings: simulationSettings({ difficultyTier: 0 }) }),
        pick({ salt: 'other-salt' }),
      ]);
      expect(values.size).toBe(7);
    });

    it('count 缺失/为 0/为负 → 空集（脏值不产出无意义种子）', () => {
      const base = { playerId: '1', playerConfig: playerConfig(), simulationSettings: simulationSettings() };
      expect(createTriggerOptimizerSeedSet({ ...base, count: 0 })).toEqual([]);
      expect(createTriggerOptimizerSeedSet({ ...base, count: -3 })).toEqual([]);
      expect(createTriggerOptimizerSeedSet(base)).toEqual([]);
      expect(createTriggerOptimizerSeedSet()).toEqual([]);
    });
  });

  describe('lockedAbilityHrids（按结果快速调整策略的入口）', () => {
    it('归一化去重 + 排序 + 剔除空值：语义相同则指纹一致（勾选顺序不影响过期判定）', () => {
      const normalized = normalizeTriggerOptimizerSettings({
        lockedAbilityHrids: ['/abilities/b', '', '/abilities/a', '/abilities/b', null],
      });
      expect(normalized.lockedAbilityHrids).toEqual(['/abilities/a', '/abilities/b']);
      expect(normalizeTriggerOptimizerSettings({}).lockedAbilityHrids).toEqual([]);
      expect(normalizeTriggerOptimizerSettings({ lockedAbilityHrids: 'garbage' }).lockedAbilityHrids).toEqual([]);
    });

    it('校验只拒绝显式非法值（缺省 = 未锁定，合法）', () => {
      // 校验入口要求「完整设置对象」：缺字段本身即非法（与既有测试同款口径），
      // 所以这里用完整基线再逐项覆盖 lockedAbilityHrids。
      const base = {
        objectiveWeights: { weightProfit: 0.5, weightXp: 0.3 },
        maxRounds: 2,
        rounds: 2,
        simulationHours: 24,
        candidateLimit: 10,
        targetScope: 'abilities',
      };
      expect(isValidTriggerOptimizerSettings(base)).toBe(true);
      expect(isValidTriggerOptimizerSettings({ ...base, lockedAbilityHrids: ['/abilities/a'] })).toBe(true);
      expect(isValidTriggerOptimizerSettings({ ...base, lockedAbilityHrids: [] })).toBe(true);
      expect(isValidTriggerOptimizerSettings({ ...base, lockedAbilityHrids: [''] })).toBe(false);
      expect(isValidTriggerOptimizerSettings({ ...base, lockedAbilityHrids: [1] })).toBe(false);
      expect(isValidTriggerOptimizerSettings({ ...base, lockedAbilityHrids: '/abilities/a' })).toBe(false);
    });

    it('进入输入指纹：锁定技能变化即让既有报告过期', () => {
      const player = playerWithAbilities([{ abilityHrid: '/abilities/fireball', level: 1 }]);
      const unlocked = createOptimizerInput(player, simulationSettings(), { settings: {} });
      const locked = createOptimizerInput(player, simulationSettings(), {
        settings: { lockedAbilityHrids: ['/abilities/fireball'] },
      });
      expect(createTriggerOptimizerInputSignature(locked)).not.toBe(createTriggerOptimizerInputSignature(unlocked));
    });
  });

  it('keeps the score epsilon documented for strict improvement adoption', () => {
    expect(TRIGGER_OPTIMIZER_SCORE_EPSILON).toBe(1e-9);
  });

  // 追加复验的计划快照净化（2026-09-25，设计 §48；累计字段 2026-09-26，设计 §50 B-2）：报告里的
  // attempts[i].plan 要能回答「这次补了几轮、上限/护栏有没有咬住、累计预算花到哪」—— 白名单 +
  // 类型校验，任何缺项/类型不符整份丢弃；还必须与这一条实际执行的 rounds 自洽
  //（plannedRounds === rounds），否则宁可不出快照。
  describe('normalizeTriggerOptimizerAppendPlan（追加复验的留档快照）', () => {
    const plan = () => ({
      decisive: false,
      capped: false,
      budgetLimited: false,
      // 成本护栏的两级字段（§50 B-2）：未咬 = limitedBy null；本次之前累计已花 24 场；整轮 370 场
      // ⇒ 单次预算 74 场 / 累计预算 148 场（都够用，所以没咬）。
      limitedBy: null,
      currentRounds: 6,
      requiredRounds: 18,
      capRounds: 24,
      targetRounds: 24,
      plannedRounds: 18,
      plannedSimulations: 36,
      budgetSimulations: 74,
      spentSimulations: 24,
      cumulativeBudgetSimulations: 148,
    });

    it('keeps the full whitelist snapshot when it is self-consistent with the executed rounds', () => {
      expect(normalizeTriggerOptimizerAppendPlan(plan(), 18)).toEqual(plan());
      // 可空项合法：capped 时反解没有解（requiredRounds = null）、拿不到整轮场次时护栏不存在
      //（budgetSimulations = null），两者都按 null 留档而不是丢弃整份快照。
      const nullable = { ...plan(), capped: true, requiredRounds: null, budgetSimulations: null };
      expect(normalizeTriggerOptimizerAppendPlan(nullable, 18)).toEqual(nullable);
    });

    it('drops the whole snapshot when any field is missing, mistyped, or inconsistent with the rounds', () => {
      const missingCap = plan();
      delete missingCap.capRounds;
      expect(normalizeTriggerOptimizerAppendPlan(missingCap, 18)).toBeNull();
      expect(normalizeTriggerOptimizerAppendPlan({ ...plan(), budgetLimited: 'no' }, 18)).toBeNull();
      // limitedBy 是枚举（null / 'single' / 'cumulative'）：枚举之外整份丢弃，不留没定义的瓶颈来源。
      expect(normalizeTriggerOptimizerAppendPlan({ ...plan(), limitedBy: 'both' }, 18)).toBeNull();
      // 累计字段在必填数值白名单里：缺 spentSimulations 的快照同样整份丢弃（缺项 = 旧格式 = 不可信）。
      const missingSpent = plan();
      delete missingSpent.spentSimulations;
      expect(normalizeTriggerOptimizerAppendPlan(missingSpent, 18)).toBeNull();
      expect(normalizeTriggerOptimizerAppendPlan({ ...plan(), capRounds: Number.NaN }, 18)).toBeNull();
      expect(normalizeTriggerOptimizerAppendPlan({ ...plan(), budgetSimulations: Infinity }, 18)).toBeNull();
      // plannedRounds ≠ 实际执行的 rounds：计划与真正跑的东西不是同一件事（例如越界值被归一化
      // 回落），留档它只会误导复盘 —— 宁可不留。
      expect(normalizeTriggerOptimizerAppendPlan(plan(), 6)).toBeNull();
      expect(normalizeTriggerOptimizerAppendPlan({ ...plan(), plannedRounds: 30 }, 18)).toBeNull();
    });

    it('rejects non-object input instead of inventing a snapshot', () => {
      expect(normalizeTriggerOptimizerAppendPlan(null, 18)).toBeNull();
      expect(normalizeTriggerOptimizerAppendPlan(undefined, 18)).toBeNull();
      expect(normalizeTriggerOptimizerAppendPlan('plan', 18)).toBeNull();
      expect(normalizeTriggerOptimizerAppendPlan([], 18)).toBeNull();
      expect(normalizeTriggerOptimizerAppendPlan(plan(), undefined)).toBeNull();
    });
  });

  // 追加复验的累计已花场次（2026-09-26，设计 §50 B-2）：attempts 各条 rounds 即「本次追加几轮/侧」，
  // 每轮双侧 = 2 场 ⇒ 累计 = Σ(2 × rounds)；只数**追加**部分（不含首轮复验）—— store（真的去跑）
  // 与页面（上屏说将要花多少）共用这一个口径，否则「文案里的预算」与「实际扣的预算」会分裂。
  describe('resolveTriggerOptimizerAppendSpentSimulations（累计已花的场次）', () => {
    it('sums 2 × rounds over the append attempts and degrades dirty input to zero', () => {
      expect(resolveTriggerOptimizerAppendSpentSimulations([])).toBe(0);
      expect(resolveTriggerOptimizerAppendSpentSimulations([{ rounds: 18 }, { rounds: 6 }])).toBe(48);
      // 非数组 / 缺 rounds / 非正数或非数字 rounds：不猜、不抛，按 0 计 —— 护栏宁可不咬，也不误咬。
      expect(resolveTriggerOptimizerAppendSpentSimulations(null)).toBe(0);
      expect(resolveTriggerOptimizerAppendSpentSimulations(undefined)).toBe(0);
      expect(resolveTriggerOptimizerAppendSpentSimulations('attempts')).toBe(0);
      expect(resolveTriggerOptimizerAppendSpentSimulations([{ rounds: 0 }, {}, { rounds: -3 }, { rounds: 'x' }])).toBe(
        0,
      );
      // 小数轮数按 floor 计（与归一化口径一致）：18.9 轮 = 18 轮 = 36 场。
      expect(resolveTriggerOptimizerAppendSpentSimulations([{ rounds: 18.9 }])).toBe(36);
    });
  });

  // 复核轮数的归一化（2026-09-25，设计 §49）：上限由**复核口径**的常量（2026-09-27 起 16）独立
  // 给出，不复用搜索口径的归一化（语义不同；历史上搜索上限 10 曾把「这次要 12 轮」静默钳成
  // 10 轮 —— §47 同款教训）。
  describe('normalizeTriggerOptimizerRobustnessRounds（复核轮数的归一化）', () => {
    it('accepts 1..16 and falls back to the baseline for anything outside', () => {
      expect(normalizeTriggerOptimizerRobustnessRounds(9)).toBe(9);
      expect(normalizeTriggerOptimizerRobustnessRounds(12)).toBe(12);
      expect(normalizeTriggerOptimizerRobustnessRounds(16)).toBe(16);
      expect(normalizeTriggerOptimizerRobustnessRounds(17)).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
      expect(normalizeTriggerOptimizerRobustnessRounds(0)).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
      expect(normalizeTriggerOptimizerRobustnessRounds(6.5)).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
      expect(normalizeTriggerOptimizerRobustnessRounds(null)).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
      expect(normalizeTriggerOptimizerRobustnessRounds(undefined)).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
      // 上限可由调用方收紧（装置/测试需要更小的天花板时不必改常量）。
      expect(normalizeTriggerOptimizerRobustnessRounds(8, 8)).toBe(8);
      expect(normalizeTriggerOptimizerRobustnessRounds(9, 8)).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
    });
  });

  // 复核**追加**轮数的归一化（2026-09-26，设计 §51）：合法区间与首跑相同（1..上限 16），但语义
  // 是「这一次补几轮」。与首跑的归一化同形分离（§47/§49 的教训：两套口径可以长得像、含义不同，
  // 将来任一方改口径时不会静默串味）；同样**不能**复用搜索口径（语义不同；历史上搜索上限 10
  // 曾把「补到 12 轮」静默钳短）。
  describe('normalizeTriggerOptimizerRobustnessAppendRounds（复核追加轮数的归一化）', () => {
    it('accepts 1..16 and falls back to the baseline for anything outside', () => {
      expect(normalizeTriggerOptimizerRobustnessAppendRounds(6)).toBe(6);
      expect(normalizeTriggerOptimizerRobustnessAppendRounds(12)).toBe(12);
      expect(normalizeTriggerOptimizerRobustnessAppendRounds(16)).toBe(16);
      // 越界不钳到边界，而是回落保底 6（与全项目「脏数据跟随产品默认」同款：调用方算错时
      // 少花样本比多花安全）。
      expect(normalizeTriggerOptimizerRobustnessAppendRounds(17)).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
      expect(normalizeTriggerOptimizerRobustnessAppendRounds(0)).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
      expect(normalizeTriggerOptimizerRobustnessAppendRounds(6.5)).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
      expect(normalizeTriggerOptimizerRobustnessAppendRounds(null)).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
      expect(normalizeTriggerOptimizerRobustnessAppendRounds(undefined)).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
      // 上限可由调用方收紧（装置/测试需要更小的天花板时不必改常量）。
      expect(normalizeTriggerOptimizerRobustnessAppendRounds(8, 8)).toBe(8);
      expect(normalizeTriggerOptimizerRobustnessAppendRounds(9, 8)).toBe(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS);
    });
  });

  // 复核计划的留档快照（2026-09-25，设计 §49；追加计划字段 2026-09-26，设计 §51）：与 §48 的
  // 追加复验同款（白名单 + 类型校验 + 自洽闸门），但字段集不同 —— 复核没有 decisive / targetRounds：
  // 它回答的是「新现场从零跑多少轮」，先验已判明确也照样给轮数。追加计划的额外字段（zeroDiff /
  // atCap / limitedBy / spentSimulations / cumulativeBudgetSimulations）按**可选**处理：首跑的
  // §49 计划没有它们，缺了不丢整份（「这次跑了几轮」的主证据在 §49 字段里，追加细节只是补注）。
  describe('normalizeTriggerOptimizerRobustnessPlan（复核计划的留档快照）', () => {
    const plan = () => ({
      capped: false,
      budgetLimited: false,
      currentRounds: 6,
      requiredRounds: 9,
      capRounds: 12,
      plannedRounds: 9,
      plannedSimulations: 18,
      budgetSimulations: 16,
      // 追加补注的缺省值（§51）：zeroDiff / atCap 缺省 false，limitedBy 缺省 null，两个预算
      // 字段缺省 null —— 首跑的 §49 计划不带它们，净化时按缺省补齐。
      zeroDiff: false,
      atCap: false,
      limitedBy: null,
      spentSimulations: null,
      cumulativeBudgetSimulations: null,
    });

    it('keeps the whitelist snapshot when it is self-consistent with the executed rounds', () => {
      expect(normalizeTriggerOptimizerRobustnessPlan(plan(), 9)).toEqual(plan());
      // 可空项合法：capped（上限也不够）时反解没有解（requiredRounds = null）、拿不到整轮场次时
      // 护栏不存在（budgetSimulations = null）—— 都按 null 留档，而不是丢弃整份快照。
      const nullable = {
        ...plan(),
        capped: true,
        requiredRounds: null,
        budgetSimulations: null,
        plannedRounds: 12,
        plannedSimulations: 24,
      };
      expect(normalizeTriggerOptimizerRobustnessPlan(nullable, 12)).toEqual(nullable);
    });

    it('keeps the optional append annotations when they are present and well-typed', () => {
      // 追加计划（§51）：补注字段显式给出时原样留档（这条计划说「补到上限、护栏没咬」）。
      const annotated = {
        ...plan(),
        atCap: true,
        limitedBy: 'cumulative',
        spentSimulations: 12,
        cumulativeBudgetSimulations: 40,
      };
      expect(normalizeTriggerOptimizerRobustnessPlan(annotated, 9)).toEqual(annotated);
      // 枚举外的 limitedBy / 非布尔补注 / 非数字预算：整份丢弃（宁可不留档，也不留没定义的来源）。
      expect(normalizeTriggerOptimizerRobustnessPlan({ ...plan(), limitedBy: 'nope' }, 9)).toBeNull();
      expect(normalizeTriggerOptimizerRobustnessPlan({ ...plan(), zeroDiff: 'yes' }, 9)).toBeNull();
      expect(normalizeTriggerOptimizerRobustnessPlan({ ...plan(), atCap: 1 }, 9)).toBeNull();
      expect(normalizeTriggerOptimizerRobustnessPlan({ ...plan(), spentSimulations: 'many' }, 9)).toBeNull();
      expect(normalizeTriggerOptimizerRobustnessPlan({ ...plan(), cumulativeBudgetSimulations: 'lots' }, 9)).toBeNull();
    });

    it('drops the whole snapshot when a field is missing, mistyped, or inconsistent with the rounds', () => {
      const missingCap = plan();
      delete missingCap.capRounds;
      expect(normalizeTriggerOptimizerRobustnessPlan(missingCap, 9)).toBeNull();
      expect(normalizeTriggerOptimizerRobustnessPlan({ ...plan(), budgetLimited: 'no' }, 9)).toBeNull();
      expect(normalizeTriggerOptimizerRobustnessPlan({ ...plan(), requiredRounds: Number.NaN }, 9)).toBeNull();
      expect(normalizeTriggerOptimizerRobustnessPlan({ ...plan(), plannedSimulations: Infinity }, 9)).toBeNull();
      expect(normalizeTriggerOptimizerRobustnessPlan({ ...plan(), budgetSimulations: 'many' }, 9)).toBeNull();
      // plannedRounds ≠ 实际执行的 rounds：计划与真正跑的不是同一件事（例如越界值被归一化回落），
      // 留档它只会误导复盘 —— 宁可不留。
      expect(normalizeTriggerOptimizerRobustnessPlan(plan(), 6)).toBeNull();
      expect(normalizeTriggerOptimizerRobustnessPlan({ ...plan(), plannedRounds: 12 }, 9)).toBeNull();
    });

    it('rejects non-object input instead of inventing a snapshot', () => {
      expect(normalizeTriggerOptimizerRobustnessPlan(null, 9)).toBeNull();
      expect(normalizeTriggerOptimizerRobustnessPlan(undefined, 9)).toBeNull();
      expect(normalizeTriggerOptimizerRobustnessPlan('plan', 9)).toBeNull();
      expect(normalizeTriggerOptimizerRobustnessPlan([], 9)).toBeNull();
      expect(normalizeTriggerOptimizerRobustnessPlan(plan(), undefined)).toBeNull();
    });
  });
});

import { describe, expect, it } from 'vitest';

import abilityDetailMap from '../../combatsimulator/data/abilityDetailMap.json';
import abilitySlotsLevelRequirementList from '../../combatsimulator/data/abilitySlotsLevelRequirementList.json';
import { createEmptyPlayerConfig } from '../../shared/playerConfig.js';
import {
  TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS,
  TRIGGER_OPTIMIZER_ROLE_AURA,
  TRIGGER_OPTIMIZER_ROLE_BUFF,
  TRIGGER_OPTIMIZER_ROLE_DAMAGE,
  TRIGGER_OPTIMIZER_ROLE_DEBUFF,
  TRIGGER_OPTIMIZER_ROLE_HEALING,
  TRIGGER_OPTIMIZER_ROLE_UNKNOWN,
  buildCandidateConfigs,
  buildRefinedCandidates,
  buildRefinementCandidates,
  classifyAbilityRole,
  generateAbilityCandidates,
  generateAbilityCandidatesDetailed,
  isAbilitySlotActive,
} from '../triggerOptimizerCandidates.js';
import {
  TRIGGER_OPTIMIZER_DEFAULT_CANDIDATE_LIMIT,
  TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
} from '../triggerOptimizerDomain.js';
import { getDefaultTriggerDtosForHrid, sanitizeTriggerList } from '../triggerMapper.js';

const FIREBALL = '/abilities/fireball'; // 纯伤害
const BERSERK = '/abilities/berserk'; // 自身增益
const HEAL = '/abilities/heal'; // 治疗
const GUARDIAN_AURA = '/abilities/guardian_aura'; // 光环（特殊技能槽）
const PUNCTURE = '/abilities/puncture'; // 伤害 + 敌人 debuff
// 条件 hrid（穿刺）：技能定义 targetType = enemy ⇒ 目标侧条件，只能配 targeted_enemy。
const PUNCTURE_CONDITION = '/combat_trigger_conditions/puncture';
// 目标侧（敌人减益）技能的另三个样本，用于验证「减益角色优先 + 上限 3 条」的排序口径。
const FRACTURING_IMPACT = '/abilities/fracturing_impact'; // allEnemies + /buff_types/damage_taken
const ICE_SPEAR = '/abilities/ice_spear'; // enemy + 降攻速
const MAIM = '/abilities/maim'; // enemy + /buff_types/damage_taken
// 自身侧（self 增益）技能的样本：条件经技能自身的 hrid 回落命中（子键无对应 condition）。
const ELEMENTAL_AFFINITY = '/abilities/elemental_affinity'; // self 增益
const FRENZY = '/abilities/frenzy'; // self 增益
const PRECISION = '/abilities/precision'; // self 增益
const PROVOKE = '/abilities/provoke'; // 自身增益（默认触发器为空列表 = 立即释放）

// 战斗属性桩：maxHp/maxMp 供「自身/蓝量」类候选换算，enemyHp 供「敌方血量 / 波内进度」类
// 候选换算（min = 小怪血量、group = 一波怪总血量、max = 阈值合法上界、waveSize = 一波怪
// 的**上限**人数，与 triggerOptimizerSimulation 的 resolveEnemyHpScale 同结构）。
const RESOURCES = {
  resources: { maxHp: 1000, maxMp: 500, enemyHp: { min: 1000, max: 4000, group: 5000, waveSize: 4 } },
};

function playerWithAbilities(abilities, triggerMap = {}, intelligence = 100) {
  const config = createEmptyPlayerConfig('1');
  config.levels.intelligence = intelligence;
  config.abilities = abilities;
  config.triggerMap = triggerMap;
  return config;
}

const CUSTOM_TRIGGER = {
  dependencyHrid: '/combat_trigger_dependencies/self',
  conditionHrid: '/combat_trigger_conditions/current_hp',
  comparatorHrid: '/combat_trigger_comparators/less_than_equal',
  value: 123,
};

// 「暴走」= 怪物暴走增益（引擎只在 processEnrageTickEvent 里给敌人挂
// /buff_uniques/enrage_damage / enrage_accuracy）。玩家侧没有任何来源，因此
// `self + enrage` 恒为未激活 —— 候选生成器不得再产出这类无效候选。
const ENRAGE_CONDITION = '/combat_trigger_conditions/enrage';

// 候选标签 key 的简写（文件级；各 describe 内的局部同名常量会遮蔽它，互不影响）。
const labels = TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS;

describe('triggerOptimizerCandidates', () => {
  describe('classifyAbilityRole', () => {
    it('buckets real abilities by their effect signatures', () => {
      expect(classifyAbilityRole(FIREBALL)).toBe(TRIGGER_OPTIMIZER_ROLE_DAMAGE);
      expect(classifyAbilityRole(BERSERK)).toBe(TRIGGER_OPTIMIZER_ROLE_BUFF);
      expect(classifyAbilityRole(HEAL)).toBe(TRIGGER_OPTIMIZER_ROLE_HEALING);
      expect(classifyAbilityRole(GUARDIAN_AURA)).toBe(TRIGGER_OPTIMIZER_ROLE_AURA);
      expect(classifyAbilityRole(PUNCTURE)).toBe(TRIGGER_OPTIMIZER_ROLE_DEBUFF);
    });

    it('classifies unknown hrids as unknown', () => {
      expect(classifyAbilityRole('/abilities/does_not_exist')).toBe(TRIGGER_OPTIMIZER_ROLE_UNKNOWN);
      expect(classifyAbilityRole('')).toBe(TRIGGER_OPTIMIZER_ROLE_UNKNOWN);
    });

    it('keeps every ability in the game data bucketed (no unknown leaks)', () => {
      const unknown = Object.keys(abilityDetailMap).filter(
        (hrid) => classifyAbilityRole(hrid) === TRIGGER_OPTIMIZER_ROLE_UNKNOWN,
      );
      // 仅特殊机制技能（如复活）无法套进常用角色桶；它们仍然获得锚点候选。
      expect(unknown).toEqual(expect.arrayContaining(['/abilities/revive']));
    });
  });

  describe('isAbilitySlotActive', () => {
    it('enforces the intelligence gate from playerMapper ([0,1,1,20,50,90])', () => {
      const player = playerWithAbilities(
        [
          { abilityHrid: FIREBALL, level: 1 },
          { abilityHrid: FIREBALL, level: 1 },
          { abilityHrid: FIREBALL, level: 1 },
          { abilityHrid: FIREBALL, level: 1 },
          { abilityHrid: FIREBALL, level: 1 },
        ],
        {},
        1,
      );
      expect(abilitySlotsLevelRequirementList).toEqual([0, 1, 1, 20, 50, 90]);
      // playerMapper 用 abilitySlotsLevelRequirementList[i + 1]：槽 0/1 要求 1，
      // 槽 2 要求 20，槽 3 要求 50，槽 4 要求 90。
      expect(isAbilitySlotActive(player, 0)).toBe(true);
      expect(isAbilitySlotActive(player, 1)).toBe(true);
      expect(isAbilitySlotActive(player, 2)).toBe(false); // 需要 20 智力
      expect(isAbilitySlotActive(player, 3)).toBe(false); // 需要 50 智力
      expect(isAbilitySlotActive(player, 4)).toBe(false); // 需要 90 智力
    });

    it('skips empty slots and zero/negative levels', () => {
      const player = playerWithAbilities(
        [
          { abilityHrid: '', level: 1 },
          { abilityHrid: FIREBALL, level: 0 },
        ],
        {},
        100,
      );
      expect(isAbilitySlotActive(player, 0)).toBe(false);
      expect(isAbilitySlotActive(player, 1)).toBe(false);
    });
  });

  describe('buildCandidateConfigs', () => {
    it('returns nothing when no ability is equipped', () => {
      expect(buildCandidateConfigs(playerWithAbilities([]), RESOURCES)).toEqual([]);
      expect(buildCandidateConfigs(createEmptyPlayerConfig('1'), RESOURCES)).toEqual([]);
    });

    it('skips slots blocked by the intelligence gate', () => {
      const player = playerWithAbilities(
        [
          { abilityHrid: GUARDIAN_AURA, level: 1 },
          { abilityHrid: '', level: 1 },
          { abilityHrid: '', level: 1 },
          { abilityHrid: FIREBALL, level: 1 },
          { abilityHrid: FIREBALL, level: 1 },
        ],
        {},
        1,
      );
      const choices = buildCandidateConfigs(player, RESOURCES);
      expect(choices.map((choice) => choice.slotIndex)).toEqual([0]);
    });

    it('covers every equipped slot including the special slot 0', () => {
      const player = playerWithAbilities(
        [
          { abilityHrid: GUARDIAN_AURA, level: 1 },
          { abilityHrid: FIREBALL, level: 1 },
          { abilityHrid: BERSERK, level: 1 },
          { abilityHrid: HEAL, level: 1 },
          { abilityHrid: PUNCTURE, level: 1 },
        ],
        {},
        100,
      );
      const choices = buildCandidateConfigs(player, RESOURCES);
      expect(choices.map((choice) => choice.slotIndex)).toEqual([0, 1, 2, 3, 4]);
      expect(choices.map((choice) => choice.role)).toEqual([
        TRIGGER_OPTIMIZER_ROLE_AURA,
        TRIGGER_OPTIMIZER_ROLE_DAMAGE,
        TRIGGER_OPTIMIZER_ROLE_BUFF,
        TRIGGER_OPTIMIZER_ROLE_HEALING,
        TRIGGER_OPTIMIZER_ROLE_DEBUFF,
      ]);
      // 每条 choice 携带 i18n 标签 key（UI 与翻译文件的对齐契约；必须是 common: 冒号前缀，
      // 点号前缀在本项目 i18next 配置下解析不到）。
      for (const choice of choices) {
        expect(choice.roleLabelKey).toMatch(/^common:triggerOptimizer\.role\./);
        expect(choice.abilityHrid).toBeTruthy();
      }
    });
  });

  describe('candidate shape, limits and dedup', () => {
    const player = () =>
      playerWithAbilities(
        [
          { abilityHrid: GUARDIAN_AURA, level: 1 },
          { abilityHrid: FIREBALL, level: 1 },
          { abilityHrid: BERSERK, level: 1 },
          { abilityHrid: HEAL, level: 1 },
          { abilityHrid: PUNCTURE, level: 1 },
        ],
        {},
        100,
      );

    it('emits the two anchors for every ability', () => {
      for (const choice of buildCandidateConfigs(player(), RESOURCES)) {
        const signatures = choice.candidates.map((candidate) => candidate.signature);
        expect(signatures).toContain('default');
        expect(signatures).toContain('[]');
        const defaultCandidate = choice.candidates.find((candidate) => candidate.signature === 'default');
        expect(defaultCandidate.state).toBe('default');
        expect(defaultCandidate.triggers).toBeNull();
        expect(defaultCandidate.labelKey).toBe(TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.default);
        const alwaysCandidate = choice.candidates.find((candidate) => candidate.signature === '[]');
        // 空列表 = 立即释放（state 标签沿用 UI 的 disabled 语义，文案须澄清）。
        expect(alwaysCandidate.state).toBe('disabled');
        expect(alwaysCandidate.triggers).toEqual([]);
        expect(alwaysCandidate.labelKey).toBe(TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.alwaysFire);
      }
    });

    it('never exceeds candidateLimit and always keeps the anchors', () => {
      const choices = buildCandidateConfigs(player(), { ...RESOURCES, candidateLimit: 3 });
      for (const choice of choices) {
        expect(choice.candidates.length).toBeLessThanOrEqual(3);
        expect(choice.candidates.length).toBeGreaterThanOrEqual(2);
      }
    });

    // 截断透明化（2026-09-23，设计 §28）：报告必须能说出「生成了多少条、被上限截掉多少条」，
    // 否则 UI 上的「8 个候选」会被读成「搜索试遍了所有可能」——截断是静默丢候选。
    it('reports how many candidates were generated and how many the limit cut off', () => {
      const rich = generateAbilityCandidatesDetailed(player(), 1, {
        ...RESOURCES,
        candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
      });
      expect(rich.limit).toBe(TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT);
      expect(rich.candidates.length).toBeLessThanOrEqual(rich.limit);

      const capped = generateAbilityCandidatesDetailed(player(), 1, { ...RESOURCES, candidateLimit: 3 });
      // 关键不变式：上限只决定**保留**多少，不改变生成了多少（同一张网格）。
      expect(capped.generated).toBe(rich.generated);
      expect(capped.limit).toBe(3);
      expect(capped.candidates).toHaveLength(3);
      expect(capped.generated).toBeGreaterThan(capped.candidates.length);
      // 对外契约不变：数组版返回的与统计版的 candidates 逐条相同。
      expect(generateAbilityCandidates(player(), 1, { ...RESOURCES, candidateLimit: 3 })).toEqual(capped.candidates);

      // buildCandidateConfigs 把三个字段带上报告（UI 据此渲染「另有 N 条未评估」）。
      for (const choice of buildCandidateConfigs(player(), { ...RESOURCES, candidateLimit: 3 })) {
        expect(choice.candidateLimit).toBe(3);
        expect(choice.generatedCandidates).toBeGreaterThanOrEqual(choice.candidates.length);
        expect(choice.truncatedCandidates).toBe(choice.generatedCandidates - choice.candidates.length);
      }
      // 上限装得下的槽（光环槽网格远小于上限）→ 截断数为 0：UI 不显示提示。
      const roomy = buildCandidateConfigs(player(), {
        ...RESOURCES,
        candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
      }).find((choice) => choice.slotIndex === 0);
      expect(roomy.truncatedCandidates).toBe(0);
      expect(roomy.generatedCandidates).toBe(roomy.candidates.length);

      // 早退路径（空槽）也给同一形状，UI 不需要判 undefined。
      expect(generateAbilityCandidatesDetailed(playerWithAbilities([]), 1, RESOURCES)).toEqual({
        candidates: [],
        generated: 0,
        limit: 0,
      });
    });

    it('deduplicates by signature', () => {
      for (const choice of buildCandidateConfigs(player(), RESOURCES)) {
        const signatures = choice.candidates.map((candidate) => candidate.signature);
        expect(new Set(signatures).size).toBe(signatures.length);
      }
    });

    it('行为等价去重：与游戏默认等价的候选不再评估（berserk 的默认就是 buffInactive）', () => {
      // berserk 的 defaultCombatTriggers 就是 `self + berserk is_inactive` → 该候选的指标
      // 与默认锚点必然一模一样，评估它纯属浪费一场模拟（候选表里一半是无效项的来源之一）。
      // 槽 2 = BERSERK，triggerMap 为空 = 全部技能走游戏默认。
      const candidates = generateAbilityCandidates(player(), 2, RESOURCES);
      const labels = candidates.map((candidate) => candidate.labelKey);
      expect(labels).toContain(TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.default);
      expect(labels).not.toContain(TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.buffInactive);
    });

    it('produces candidates that all survive sanitizeTriggerList', () => {
      // 这是搜索引擎的硬约束：候选若被 sanitize 丢弃条目，就会退化成与默认等价，白跑模拟。
      for (const choice of buildCandidateConfigs(player(), RESOURCES)) {
        for (const candidate of choice.candidates) {
          expect(candidate.triggers === null || Array.isArray(candidate.triggers)).toBe(true);
          if (candidate.triggers) {
            expect(sanitizeTriggerList(candidate.triggers)).toEqual(candidate.triggers);
          }
        }
      }
    });

    it('never emits more than MAX_TRIGGER_COUNT entries per candidate', () => {
      for (const choice of buildCandidateConfigs(player(), RESOURCES)) {
        for (const candidate of choice.candidates) {
          expect((candidate.triggers || []).length).toBeLessThanOrEqual(4);
        }
      }
    });

    it('keeps the current custom configuration as an anchor', () => {
      const current = { [FIREBALL]: [CUSTOM_TRIGGER] };
      const choices = buildCandidateConfigs(
        playerWithAbilities(
          [
            { abilityHrid: GUARDIAN_AURA, level: 1 },
            { abilityHrid: FIREBALL, level: 1 },
          ],
          current,
          100,
        ),
        RESOURCES,
      );
      const fireball = choices.find((choice) => choice.abilityHrid === FIREBALL);
      const currentCandidate = fireball.candidates.find(
        (candidate) => candidate.signature === JSON.stringify([CUSTOM_TRIGGER]),
      );
      expect(currentCandidate).toBeDefined();
      expect(currentCandidate.labelKey).toBe(TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.current);
      expect(currentCandidate.distance).toBe(0);
    });
  });

  describe('role heuristics', () => {
    const playerWith = (hrid) =>
      playerWithAbilities(
        [
          { abilityHrid: GUARDIAN_AURA, level: 1 },
          { abilityHrid: hrid, level: 1 },
        ],
        {},
        100,
      );

    it('damage: 顺序 = 价值顺序（AOE 敌方总血量 → 敌人数 → 单体防浪费 → 斩杀线 → 蓝量 → 自身残血）', () => {
      const labels = TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS;
      const candidates = generateAbilityCandidates(playerWith(FIREBALL), 1, {
        ...RESOURCES,
        candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
      });
      // 不再产出 `self + enrage`：玩家侧永远不激活，is_inactive 恒真 = 与「立即释放」等价。
      expect(
        candidates.some((candidate) =>
          (candidate.triggers || []).some((trigger) => trigger.conditionHrid === ENRAGE_CONDITION),
        ),
      ).toBe(false);

      // ① AOE：敌方总血量 ≥ X（group 5000 → 25%/50%）—— 别把 AOE 丢给残血的一波怪。
      const group = candidates.filter((candidate) => candidate.labelKey === labels.enemyGroupHp);
      expect(group.map((candidate) => candidate.labelParams.value)).toEqual([1250, 2500]);
      expect(
        group.every(
          (candidate) =>
            candidate.triggers[0].dependencyHrid === '/combat_trigger_dependencies/all_enemies' &&
            candidate.triggers[0].conditionHrid === '/combat_trigger_conditions/current_hp' &&
            candidate.triggers[0].comparatorHrid === '/combat_trigger_comparators/greater_than_equal',
        ),
      ).toBe(true);
      // ② AOE 计数 2/3。
      const many = candidates.filter((candidate) => candidate.labelKey === labels.manyEnemies);
      expect(many.map((candidate) => candidate.labelParams.count)).toEqual([2, 3]);
      // ③ 波内进度（2026-09-20，设计 §22）：引擎的 number_of_dead_units 只在多目标依赖下
      //    求值，数的是**当前这一波**的死怪数。阈值被 waveSize = 4 过滤：只保 ≤ 0（开波期）
      //    与 ≥ 1/2（清场期）；≥ 4 恒假、≤ 3 恒真，两种都不生成。
      const deadMost = candidates.filter((candidate) => candidate.labelKey === labels.deadUnitsAtMost);
      expect(deadMost.map((candidate) => candidate.labelParams.count)).toEqual([0]);
      expect(deadMost[0].triggers[0]).toEqual({
        dependencyHrid: '/combat_trigger_dependencies/all_enemies',
        conditionHrid: '/combat_trigger_conditions/number_of_dead_units',
        comparatorHrid: '/combat_trigger_comparators/less_than_equal',
        value: 0,
      });
      const deadLeast = candidates.filter((candidate) => candidate.labelKey === labels.deadUnitsAtLeast);
      expect(deadLeast.map((candidate) => candidate.labelParams.count)).toEqual([1, 2]);
      expect(
        deadLeast.every(
          (candidate) =>
            candidate.triggers[0].dependencyHrid === '/combat_trigger_dependencies/all_enemies' &&
            candidate.triggers[0].conditionHrid === '/combat_trigger_conditions/number_of_dead_units' &&
            candidate.triggers[0].comparatorHrid === '/combat_trigger_comparators/greater_than_equal',
        ),
      ).toBe(true);
      // ④ 跨技能增益门（2026-09-19，设计 §18.3）：只在其他已佩戴技能挂给自身的增益
      //    覆盖期间释放 —— 槽 0 的守护光环提供了 guardian_aura 条件，因此这里必有一条。
      const buffWindow = candidates.filter((candidate) => candidate.labelKey === labels.buffWindow);
      expect(buffWindow.length).toBe(1);
      expect(buffWindow[0].labelParams.conditionHrid).toBe('/combat_trigger_conditions/guardian_aura');
      expect(buffWindow[0].triggers[0]).toEqual({
        dependencyHrid: '/combat_trigger_dependencies/self',
        conditionHrid: '/combat_trigger_conditions/guardian_aura',
        comparatorHrid: '/combat_trigger_comparators/is_active',
        value: 0,
      });
      // ⑤ 单体：目标血量 ≥ 50% 小怪血量 = 500 —— 防过量伤害（把技能留给下一只满血怪）。
      const target = candidates.filter((candidate) => candidate.labelKey === labels.enemyTargetHp);
      expect(target.map((candidate) => candidate.triggers[0].value)).toEqual([500]);
      expect(target[0].triggers[0].dependencyHrid).toBe('/combat_trigger_dependencies/targeted_enemy');
      // ⑥ 斩杀线 = 30% **小怪血量** = 300。旧版拿玩家 maxHp 的 30%（439）当斩杀线，
      //    对 500 血的小怪近似恒真 —— 那是候选空间里的假信号，不是策略。
      const execute = candidates.find((candidate) => candidate.labelKey === labels.executeHp);
      expect(execute.triggers[0].dependencyHrid).toBe('/combat_trigger_dependencies/targeted_enemy');
      expect(execute.triggers[0].comparatorHrid).toBe('/combat_trigger_comparators/less_than_equal');
      expect(execute.triggers[0].value).toBe(300);
      // ⑦ 蓝量台阶：法力 ≥ 30% maxMp = 150。
      const enoughMp = candidates.find((candidate) => candidate.labelKey === labels.enoughMp);
      expect(enoughMp.triggers[0].conditionHrid).toBe('/combat_trigger_conditions/current_mp');
      expect(enoughMp.triggers[0].value).toBe(150);
      // ⑧ 自身残血 50/75（价值最低，候选上限截断时先丢它）。
      const lowHp = candidates.filter((candidate) => candidate.labelKey === labels.lowHp);
      expect(lowHp.map((candidate) => candidate.labelParams.percent)).toEqual([50, 75]);
      expect(
        lowHp.every((candidate) => candidate.triggers[0].value === 500 || candidate.triggers[0].value === 750),
      ).toBe(true);

      // 家族交错契约（2026-09-24，设计 §39-A）：截断保留规则是「按 labelKey 家族 round-robin
      // 取代表」——每族首条进 top-N（轮 1），同族第 2 条排在所有族首条之后（轮 2）。
      // 动机：熊熊星球 T0 实测真最优 deadUnitsAtMost{0} 按旧「纯价值顺序」排第 12、被默认
      // 上限 10 整族截断（§34 Δ = −0.03236）。前两条仍是 default / alwaysFire 两个锚点。
      const singles = candidates
        .filter((candidate) => !candidate.labelKey.includes('.composite'))
        .map((candidate) => candidate.labelKey);
      expect(singles.slice(2)).toEqual([
        // 轮 1：每族首条（族间顺序 = 各族首条的生成顺序）
        labels.enemyGroupHp,
        labels.manyEnemies,
        labels.deadUnitsAtMost,
        labels.deadUnitsAtLeast,
        labels.buffWindow,
        labels.enemyTargetHp,
        labels.executeHp,
        labels.enoughMp,
        labels.lowHp,
        // 轮 2：同族第 2 条
        labels.enemyGroupHp,
        labels.manyEnemies,
        labels.deadUnitsAtLeast,
        labels.lowHp,
      ]);
    });

    // 波内进度候选的阈值上界来自区域一波怪的上限人数（enemyHp.waveSize）：≥ waveSize
    // 恒假（整波死光就换波）、≤ waveSize − 1 恒真（等于没有这条触发器）——两种都不该生成，
    // 否则只是白跑一场模拟（与「敌方血量类」的 isMeaningfulEnemyHpThreshold 同款自守）。
    it('波内进度候选按一波怪的上限人数过滤；单怪图/资源缺失时整族不生成', () => {
      // 必须用上限档生成：家族交错后 deadUnits 首条虽进默认档，但第 2 条（≥ 2）仍在轮 2 ——
      // 用默认档断言会拿到不完整的过滤结果（见下方「候选上限」用例）。
      const enemyHpOf = (waveSize) => ({
        resources: { maxHp: 1000, maxMp: 500, enemyHp: { min: 1000, max: 4000, group: 5000, waveSize } },
        candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
      });
      const deadLabelsOf = (waveSize) =>
        generateAbilityCandidates(playerWith(FIREBALL), 1, enemyHpOf(waveSize)).filter((candidate) =>
          String(candidate.labelKey).includes('.deadUnits'),
        );

      // 波上限 4（丛林）：≤ 0 与 ≥ 1/2 全保。
      const four = deadLabelsOf(4);
      expect(four.map((candidate) => candidate.labelParams.count)).toEqual([0, 1, 2]);
      // 波上限 2：≥ 2 恒假、≤ 1 恒真 → 只剩 ≥ 1 与 ≤ 0。
      const two = deadLabelsOf(2);
      expect(two.map((candidate) => candidate.labelParams.count)).toEqual([0, 1]);
      // 单怪图（波上限 1）没有「波内进度」可言；缺 waveSize / 资源整体缺失同理 → 一条都不产。
      expect(deadLabelsOf(1)).toEqual([]);
      expect(
        generateAbilityCandidates(playerWith(FIREBALL), 1, {
          resources: { maxHp: 1000, maxMp: 500, enemyHp: { min: 1000, max: 4000, group: 5000 } },
        }).filter((candidate) => String(candidate.labelKey).includes('.deadUnits')),
      ).toEqual([]);
      expect(
        generateAbilityCandidates(playerWith(FIREBALL), 1, {}).filter((candidate) =>
          String(candidate.labelKey).includes('.deadUnits'),
        ),
      ).toEqual([]);
    });

    // 截断锚点（设计 §39-A）：家族交错后，截断丢的只是「同族第 2 条」（轮 2），每族首条
    // 优先进默认档（10）—— 熊熊 T0 实测旧规则会把 deadUnitsAtMost 整族截断（真最优丢分
    // −0.03236），新规则下它排在轮 1。本用例钉住这条不变式。
    it('候选上限：默认档按家族交错保每族代表，截断只丢同族第 2 条', () => {
      const labels = TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS;
      const labelsOf = (candidateLimit) =>
        generateAbilityCandidates(playerWith(FIREBALL), 1, { ...RESOURCES, candidateLimit }).map(
          (candidate) => candidate.labelKey,
        );

      const standard = labelsOf(TRIGGER_OPTIMIZER_DEFAULT_CANDIDATE_LIMIT);
      const deadOf = (list) => list.filter((label) => String(label).includes('.deadUnits'));
      expect(standard).toHaveLength(TRIGGER_OPTIMIZER_DEFAULT_CANDIDATE_LIMIT);
      // deadUnits 族首条（deadUnitsAtMost{0}）现在进默认档 —— 旧规则下整个 .deadUnits 族为空。
      expect(deadOf(standard)).toEqual([labels.deadUnitsAtMost, labels.deadUnitsAtLeast]);
      // 轮 1 之外的族（蓝量台阶、自身残血）仍被截断 —— 上限不变，换的是保留规则。
      expect(standard).not.toContain(labels.enoughMp);
      expect(standard).not.toContain(labels.lowHp);

      const fine = labelsOf(TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT);
      expect(deadOf(fine)).toHaveLength(3);
      expect(fine).toContain(labels.enoughMp);
      expect(fine.filter((label) => label === labels.lowHp)).toHaveLength(2);
      // 完整网格 = 2 锚点 + 13 单条件 + 4 组合 = 19；上限必须 ≥ 19 才能「装下」。
      expect(fine).toHaveLength(19);
      expect(TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT).toBeGreaterThanOrEqual(fine.length);
    });

    it('buff: re-cast when the own buff drops（默认触发器为空列表时才产出这条）', () => {
      // berserk 的游戏默认触发器**就是** `self + berserk is_inactive` → 默认状态下该候选
      // 与「默认」锚点行为完全等价，已被「行为等价去重」剔除（见下方向应用例）。
      // provoke 的默认触发器是空列表（[] = 冷却好了立即释放），buffInactive 才是新配置。
      const candidates = generateAbilityCandidates(playerWith(PROVOKE), 1, RESOURCES);
      const buffInactive = candidates.find(
        (candidate) => candidate.labelKey === TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.buffInactive,
      );
      expect(buffInactive).toBeDefined();
      expect(buffInactive.triggers[0].conditionHrid).toBe('/combat_trigger_conditions/provoke');
      expect(buffInactive.triggers[0].comparatorHrid).toBe('/combat_trigger_comparators/is_inactive');
      // 默认 = buffInactive 的技能（berserk）不再产出这条重复候选。
      const berserkLabels = generateAbilityCandidates(playerWith(BERSERK), 1, RESOURCES).map(
        (candidate) => candidate.labelKey,
      );
      expect(berserkLabels).not.toContain(TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.buffInactive);
    });

    it('debuff: re-apply when the enemy debuff drops', () => {
      const candidates = generateAbilityCandidates(playerWith(PUNCTURE), 1, RESOURCES);
      const debuffInactive = candidates.find(
        (candidate) => candidate.labelKey === TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.debuffInactive,
      );
      expect(debuffInactive).toBeDefined();
      expect(debuffInactive.triggers[0].dependencyHrid).toBe('/combat_trigger_dependencies/targeted_enemy');
      expect(debuffInactive.triggers[0].conditionHrid).toBe('/combat_trigger_conditions/puncture');
      expect(debuffInactive.triggers[0].comparatorHrid).toBe('/combat_trigger_comparators/is_inactive');
    });

    it('healing/defense: hp thresholds, missing-hp grid and ally low-hp percentage', () => {
      // 治疗角色默认会产 9 个候选（超过默认上限 8），放开上限以检查完整网格。
      const candidates = generateAbilityCandidates(playerWith(HEAL), 1, { ...RESOURCES, candidateLimit: 16 });
      const lowHp = candidates.filter(
        (candidate) => candidate.labelKey === TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.lowHp,
      );
      expect(lowHp.map((candidate) => candidate.labelParams.percent)).toEqual([50, 75, 90]);
      const missing = candidates.filter(
        (candidate) => candidate.labelKey === TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.missingHp,
      );
      // missing_hp 用向上取整：ceil(1000 * 0.25) = 250。
      expect(missing.map((candidate) => candidate.triggers[0].value)).toEqual([250, 500]);
      const allyLow = candidates.filter(
        (candidate) => candidate.labelKey === TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.allyLowHp,
      );
      // lowest_hp_percentage 是 0-100 百分比，可直接写数值（不依赖 maxHp）。
      expect(allyLow.map((candidate) => candidate.triggers[0].value)).toEqual([40, 60]);
      expect(
        allyLow.every(
          (candidate) => candidate.triggers[0].dependencyHrid === '/combat_trigger_dependencies/all_allies',
        ),
      ).toBe(true);
      // 治疗额外有防穿蓝候选。
      const lowMp = candidates.find((candidate) => candidate.labelKey === TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.lowMp);
      expect(lowMp.triggers[0].conditionHrid).toBe('/combat_trigger_conditions/current_mp');
      expect(lowMp.triggers[0].value).toBe(100); // floor(500 * 0.2)
    });

    it('aura: 锚点 + 资源无关的组合候选（不再是「光环无法优化」）', () => {
      // 原先唯一的角色候选 `self + enrage is_active` 恒假（会把光环变成永不释放），已移除；
      // 上一版因此只剩两个锚点 = 光环技能完全没有优化空间。本轮补上合取组合候选。
      const candidates = generateAbilityCandidates(playerWith(GUARDIAN_AURA), 0, RESOURCES);
      expect(candidates.slice(0, 2).map((candidate) => candidate.labelKey)).toEqual([
        TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.default,
        TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.alwaysFire,
      ]);
      const labels = candidates.map((candidate) => candidate.labelKey);
      expect(labels).toContain(TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.compositeAuraRefreshAllyLowHp);
      expect(labels).toContain(TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.compositeBuffRefreshLowHp);
      expect(
        candidates.some((candidate) =>
          (candidate.triggers || []).some((trigger) => trigger.conditionHrid === ENRAGE_CONDITION),
        ),
      ).toBe(false);
    });

    it('unknown roles still get the two anchors', () => {
      // 复活技能没有伤害/治疗/buff 信号，无法套进常用角色桶——仍然保留两个锚点候选。
      const candidates = generateAbilityCandidates(playerWith('/abilities/revive'), 1, RESOURCES);
      expect(candidates.map((candidate) => candidate.signature)).toEqual(['default', '[]']);
    });
  });

  describe('合取组合候选（引擎语义：多条触发器之间是 AND）', () => {
    const playerWith = (hrid) =>
      playerWithAbilities(
        [
          { abilityHrid: GUARDIAN_AURA, level: 1 },
          { abilityHrid: hrid, level: 1 },
        ],
        {},
        100,
      );

    it('组合候选恰好两条触发器，condition 互不相同（同 condition 重复是自我矛盾）', () => {
      for (const hrid of [FIREBALL, BERSERK, PUNCTURE, HEAL]) {
        const composites = generateAbilityCandidates(playerWith(hrid), 1, RESOURCES).filter(
          (candidate) => (candidate.triggers || []).length === 2,
        );
        expect(composites.length).toBeGreaterThan(0);
        for (const candidate of composites) {
          expect(new Set(candidate.triggers.map((trigger) => trigger.conditionHrid)).size).toBe(2);
          // 组合候选的改动距离最大：同分时优先采纳条件更少的单条件候选。
          expect(candidate.distance).toBe(3);
          expect(sanitizeTriggerList(candidate.triggers)).toEqual(candidate.triggers);
        }
      }
    });

    it('交错进位：默认上限内单条件与组合两类都有代表（组合候选不会被整批截断）', () => {
      const candidates = generateAbilityCandidates(playerWith(FIREBALL), 1, {
        ...RESOURCES,
        candidateLimit: TRIGGER_OPTIMIZER_DEFAULT_CANDIDATE_LIMIT,
      });
      const singles = candidates.filter((candidate) => (candidate.triggers || []).length === 1);
      const composites = candidates.filter((candidate) => (candidate.triggers || []).length === 2);
      expect(singles.length).toBeGreaterThan(0);
      expect(composites.length).toBeGreaterThan(0);
      expect(candidates.length).toBeLessThanOrEqual(TRIGGER_OPTIMIZER_DEFAULT_CANDIDATE_LIMIT);
    });

    it('需要绝对值的组合在资源缺失时不硬凑；资源无关的组合仍然保留', () => {
      // 伤害技能的组合全部依赖 maxHp/maxMp → 无资源时一条都不产（不产比产错的强）。
      const damage = generateAbilityCandidates(playerWith(FIREBALL), 1, {});
      expect(damage.every((candidate) => (candidate.triggers || []).length <= 1)).toBe(true);
      // 光环/debuff 的组合只用 is_inactive 与计数/百分比条件 → 无资源时依然可用。
      const aura = generateAbilityCandidates(playerWith(GUARDIAN_AURA), 0, {});
      expect(aura.some((candidate) => (candidate.triggers || []).length === 2)).toBe(true);
      const debuff = generateAbilityCandidates(playerWith(PUNCTURE), 1, {});
      expect(debuff.some((candidate) => (candidate.triggers || []).length === 2)).toBe(true);
    });
  });

  // ── 跨技能增益门（2026-09-19 新增，设计 §18.3）──────────────────────────────
  // 旧生成器只用「本技能自己」的 buff 条件，跨技能的一条都不产；引擎侧其实支持
  // （trigger.js 按 condition 名字读 source.combatBuffs，不区分谁挂的；allAllies 的
  // 增益会施加到含施法者自己在内的 players）。这里的断言锁住「只从其他已佩戴技能的
  // 增益里取、最多 3 条、不制造恒定假候选」三条口径。
  describe('跨技能增益门', () => {
    it('条件只来自**其他**已佩戴技能，且写作 self + is_active', () => {
      const player = playerWithAbilities(
        [
          { abilityHrid: GUARDIAN_AURA, level: 1 },
          { abilityHrid: FIREBALL, level: 1 },
        ],
        {},
        100,
      );
      const candidates = generateAbilityCandidates(player, 1, {
        ...RESOURCES,
        candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
      });
      const windows = candidates.filter((candidate) => candidate.labelKey === labels.buffWindow);
      expect(windows.length).toBe(1);
      expect(windows[0].labelParams.conditionHrid).toBe('/combat_trigger_conditions/guardian_aura');
      expect(windows[0].triggers[0].dependencyHrid).toBe('/combat_trigger_dependencies/self');
      expect(windows[0].triggers[0].comparatorHrid).toBe('/combat_trigger_comparators/is_active');
      expect(sanitizeTriggerList(windows[0].triggers)).toEqual(windows[0].triggers);
    });

    it('其他技能不提供增益时不产出（不制造恒定假的候选，见 §13 的教训）', () => {
      const player = playerWithAbilities(
        [
          { abilityHrid: FIREBALL, level: 1 },
          { abilityHrid: FIREBALL, level: 1 },
        ],
        {},
        100,
      );
      const candidates = generateAbilityCandidates(player, 1, {
        ...RESOURCES,
        candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
      });
      expect(candidates.some((candidate) => candidate.labelKey === labels.buffWindow)).toBe(false);
    });

    it('最多 3 条：光环/增益角色优先，同类按槽位序（条件只取自身侧）', () => {
      // 4 个自身侧来源（1 光环 + 3 增益）：上限 3 条按「角色优先级 → 槽位序」截断，
      // 槽位最靠后的 precision 被丢掉（同分位的光环永远优先）。
      const player = playerWithAbilities(
        [
          { abilityHrid: GUARDIAN_AURA, level: 1 },
          { abilityHrid: BERSERK, level: 1 },
          { abilityHrid: FRENZY, level: 1 },
          { abilityHrid: PRECISION, level: 1 },
          { abilityHrid: FIREBALL, level: 1 },
        ],
        {},
        100,
      );
      const candidates = generateAbilityCandidates(player, 4, {
        ...RESOURCES,
        candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
      });
      const windows = candidates.filter((candidate) => candidate.labelKey === labels.buffWindow);
      expect(windows.map((candidate) => candidate.labelParams.conditionHrid)).toEqual([
        '/combat_trigger_conditions/guardian_aura',
        '/combat_trigger_conditions/berserk',
        '/combat_trigger_conditions/frenzy',
      ]);
      // 没有任何目标侧减益来源 → 减益窗口一条都不产（两侧各自独立，不互相补位）。
      expect(candidates.some((candidate) => candidate.labelKey === labels.debuffWindow)).toBe(false);
    });

    it('组合候选「增益门 × AOE 窗口」：需要 enemyHp 尺度，缺了就整条跳过', () => {
      const player = playerWithAbilities(
        [
          { abilityHrid: GUARDIAN_AURA, level: 1 },
          { abilityHrid: FIREBALL, level: 1 },
        ],
        {},
        100,
      );
      const withEnemyHp = generateAbilityCandidates(player, 1, {
        resources: { enemyHp: { min: 1000, max: 4000, group: 5000 } },
        candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
      });
      const composite = withEnemyHp.find((candidate) => candidate.labelKey === labels.compositeBuffWindowGroupHp);
      expect(composite).toBeTruthy();
      expect(composite.triggers.map((trigger) => trigger.conditionHrid)).toEqual([
        '/combat_trigger_conditions/guardian_aura',
        '/combat_trigger_conditions/current_hp',
      ]);
      expect(composite.triggers[0].comparatorHrid).toBe('/combat_trigger_comparators/is_active');
      expect(composite.triggers[1].value).toBe(1250); // 25% × group 5000
      expect(sanitizeTriggerList(composite.triggers)).toEqual(composite.triggers);

      const withoutEnemyHp = generateAbilityCandidates(player, 1, {
        resources: { maxHp: 1000, maxMp: 500 },
        candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
      });
      expect(withoutEnemyHp.some((candidate) => candidate.labelKey === labels.compositeBuffWindowGroupHp)).toBe(false);
    });

    it('本技能自己的 buff 条件不会混进跨技能候选（那是 buff 角色的 buffInactive 语义）', () => {
      // provoke 的游戏默认触发器是空列表（[] = 立即释放）→ 它的 buffInactive 候选会被保留
      // （berserk 的默认触发器就是双自身 buffInactive，会被「行为等价去重」剔除，不能用来断言）。
      const player = playerWithAbilities(
        [
          { abilityHrid: GUARDIAN_AURA, level: 1 },
          { abilityHrid: PROVOKE, level: 1 },
        ],
        {},
        100,
      );
      const candidates = generateAbilityCandidates(player, 1, {
        ...RESOURCES,
        candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
      });
      const windows = candidates.filter((candidate) => candidate.labelKey === labels.buffWindow);
      expect(
        windows.every((candidate) => candidate.labelParams.conditionHrid !== '/combat_trigger_conditions/provoke'),
      ).toBe(true);
      // 自己的 buff 走的是 buffInactive（刷新语义），两条路径互斥。
      expect(candidates.some((candidate) => candidate.labelKey === labels.buffInactive)).toBe(true);
    });
  });

  // ── 跨技能减益窗口（2026-09-21 新增，设计 §23）──────────────────────────────
  // 条件侧别由技能定义的 targetType 决定（self/allAllies = 自身侧、enemy/allEnemies =
  // 目标侧）：同一份 buff 条件表，配 self 读施法者自己身上的 buff（trigger.js 28-29），
  // 配 targeted_enemy 读目标身上的 buff（trigger.js 31-35）。旧生成器把敌人减益也塞进
  // 增益门（self + is_active），读的是施法者身上永远不存在的 buff ⇒ 每轮白跑一场模拟，
  // 精细档还占名额；本节锁住「减益走 targeted_enemy + is_active，不再混进增益门」。
  describe('跨技能减益窗口', () => {
    it('条件只来自**其他**已佩戴技能的目标侧减益，写作 targeted_enemy + is_active', () => {
      const player = playerWithAbilities(
        [
          { abilityHrid: PUNCTURE, level: 1 },
          { abilityHrid: FIREBALL, level: 1 },
        ],
        {},
        100,
      );
      const candidates = generateAbilityCandidates(player, 1, {
        ...RESOURCES,
        candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
      });
      const windows = candidates.filter((candidate) => candidate.labelKey === labels.debuffWindow);
      expect(windows.length).toBe(1);
      expect(windows[0].labelParams.conditionHrid).toBe(PUNCTURE_CONDITION);
      expect(windows[0].triggers[0]).toEqual({
        dependencyHrid: '/combat_trigger_dependencies/targeted_enemy',
        conditionHrid: PUNCTURE_CONDITION,
        comparatorHrid: '/combat_trigger_comparators/is_active',
        value: 0,
      });
      expect(sanitizeTriggerList(windows[0].triggers)).toEqual(windows[0].triggers);
    });

    it('侧别分流：自身增益进 buffWindow、敌人减益进 debuffWindow，两侧不互相串味', () => {
      // ELEMENTAL_AFFINITY 是 self 增益（targetType self）、PUNCTURE 是敌人减益
      // （targetType enemy）——同一套生成器必须把它们分到两侧。
      const player = playerWithAbilities(
        [
          { abilityHrid: ELEMENTAL_AFFINITY, level: 1 },
          { abilityHrid: PUNCTURE, level: 1 },
          { abilityHrid: FIREBALL, level: 1 },
        ],
        {},
        100,
      );
      const candidates = generateAbilityCandidates(player, 2, {
        ...RESOURCES,
        candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
      });
      const selfSide = candidates.filter((candidate) => candidate.labelKey === labels.buffWindow);
      const targetSide = candidates.filter((candidate) => candidate.labelKey === labels.debuffWindow);
      expect(selfSide.map((candidate) => candidate.labelParams.conditionHrid)).toEqual([
        '/combat_trigger_conditions/elemental_affinity',
      ]);
      expect(selfSide[0].triggers[0].dependencyHrid).toBe('/combat_trigger_dependencies/self');
      expect(targetSide.map((candidate) => candidate.labelParams.conditionHrid)).toEqual([PUNCTURE_CONDITION]);
      // §23 的回归点：减益不再出现在增益门里（旧实现会产出一条结构性恒假的 self 候选）。
      expect(selfSide.every((candidate) => candidate.labelParams.conditionHrid !== PUNCTURE_CONDITION)).toBe(true);
      // 减益窗口的依赖固定为目标侧（读 target.combatBuffs），不是施法者自己。
      expect(
        targetSide.every(
          (candidate) =>
            candidate.triggers[0].dependencyHrid === '/combat_trigger_dependencies/targeted_enemy' &&
            candidate.triggers[0].comparatorHrid === '/combat_trigger_comparators/is_active',
        ),
      ).toBe(true);
    });

    it('最多 3 条：减益角色优先，同类按槽位序', () => {
      const player = playerWithAbilities(
        [
          { abilityHrid: PUNCTURE, level: 1 },
          { abilityHrid: FRACTURING_IMPACT, level: 1 },
          { abilityHrid: ICE_SPEAR, level: 1 },
          { abilityHrid: MAIM, level: 1 },
          { abilityHrid: FIREBALL, level: 1 },
        ],
        {},
        100,
      );
      const candidates = generateAbilityCandidates(player, 4, {
        ...RESOURCES,
        candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
      });
      const windows = candidates.filter((candidate) => candidate.labelKey === labels.debuffWindow);
      expect(windows.map((candidate) => candidate.labelParams.conditionHrid)).toEqual([
        PUNCTURE_CONDITION,
        '/combat_trigger_conditions/fracturing_impact',
        '/combat_trigger_conditions/ice_spear',
      ]);
      // 这条阵容没有任何自身侧增益来源 → 增益门一条都不产（不硬凑）。
      expect(candidates.some((candidate) => candidate.labelKey === labels.buffWindow)).toBe(false);
    });

    it('其他技能不提供减益时不产出；本技能自己的减益走 debuffInactive', () => {
      const player = playerWithAbilities(
        [
          { abilityHrid: FIREBALL, level: 1 },
          { abilityHrid: FIREBALL, level: 1 },
        ],
        {},
        100,
      );
      const candidates = generateAbilityCandidates(player, 1, {
        ...RESOURCES,
        candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
      });
      expect(candidates.some((candidate) => candidate.labelKey === labels.debuffWindow)).toBe(false);

      // 本技能自己挂的减益：刷新语义走 debuffInactive（targeted_enemy + is_inactive），
      // 不会被当成「别人的窗口」重复产出一条 is_active。
      const solo = generateAbilityCandidates(playerWithAbilities([{ abilityHrid: PUNCTURE, level: 1 }], {}, 100), 0, {
        ...RESOURCES,
        candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
      });
      expect(solo.some((candidate) => candidate.labelKey === labels.debuffInactive)).toBe(true);
      expect(solo.some((candidate) => candidate.labelKey === labels.debuffWindow)).toBe(false);
    });

    it('家族交错下窗口候选的族序与相对次序：增益门在减益窗口之前', () => {
      const player = playerWithAbilities(
        [
          { abilityHrid: ELEMENTAL_AFFINITY, level: 1 },
          { abilityHrid: PUNCTURE, level: 1 },
          { abilityHrid: FIREBALL, level: 1 },
        ],
        {},
        100,
      );
      const candidates = generateAbilityCandidates(player, 2, {
        ...RESOURCES,
        candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
      });
      const singles = candidates
        .filter((candidate) => !candidate.labelKey.includes('.composite'))
        .map((candidate) => candidate.labelKey);
      // 家族交错契约（§39-A）：轮 1 = 每族首条（族序 = 生成序：AOE → 敌人数 → 波内进度 →
      // 增益门 → 减益窗口 → 单体 → 斩杀 → 蓝量 → 自身残血）；轮 2 = 同族第 2 条。
      // 两条窗口候选的先后（自身增益在前）也是契约的一部分。
      expect(singles.slice(2, 12)).toEqual([
        labels.enemyGroupHp,
        labels.manyEnemies,
        labels.deadUnitsAtMost,
        labels.deadUnitsAtLeast,
        labels.buffWindow,
        labels.debuffWindow,
        labels.enemyTargetHp,
        labels.executeHp,
        labels.enoughMp,
        labels.lowHp,
      ]);
      expect(singles.slice(12)).toEqual([
        labels.enemyGroupHp,
        labels.manyEnemies,
        labels.deadUnitsAtLeast,
        labels.lowHp,
      ]);
    });
  });

  // ── §25：敌人数波上限自守 + 光环守卫维度（2026-09-21）────────────────────────
  // 两件事同一个主题：候选表里不留「结构性不成立」或「语义重复」的条目。
  describe('§25 敌人数波上限自守与光环守卫维度', () => {
    const SELF = '/combat_trigger_dependencies/self';
    const ALL_ENEMIES = '/combat_trigger_dependencies/all_enemies';
    const ACTIVE_UNITS = '/combat_trigger_conditions/number_of_active_units';
    const CURRENT_MP = '/combat_trigger_conditions/current_mp';
    const IS_INACTIVE = '/combat_trigger_comparators/is_inactive';
    const GTE = '/combat_trigger_comparators/greater_than_equal';

    // 与 triggerOptimizerSimulation.resolveEnemyHpScale 同结构（waveSize = 一波怪的上限人数）。
    const resourcesOf = (waveSize) => ({
      resources: { maxHp: 1000, maxMp: 500, enemyHp: { min: 1000, max: 4000, group: 5000, waveSize } },
      candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
    });
    const soloWith = (hrid) => playerWithAbilities([{ abilityHrid: hrid, level: 1 }], {}, 100);
    const countsOf = (hrid, slotIndex, waveSize) =>
      generateAbilityCandidates(soloWith(hrid), slotIndex, resourcesOf(waveSize))
        .filter((candidate) => candidate.labelKey === labels.manyEnemies)
        .map((candidate) => candidate.labelParams.count);

    it('单怪图不产「敌人数 ≥ 2/3」；波上限 2/3 只保留合法阈值；读不到波上限时不过滤', () => {
      // 全游戏 44 个单怪区域（maxSpawnCount = 1）里「敌人数 ≥ N（N ≥ 2）」永远不成立
      // ⇒ 结构性恒假候选，每轮白跑一场模拟、精细档还占名额。
      expect(countsOf(FIREBALL, 0, 4)).toEqual([2, 3]);
      expect(countsOf(FIREBALL, 0, 3)).toEqual([2, 3]);
      expect(countsOf(FIREBALL, 0, 2)).toEqual([2]);
      expect(countsOf(FIREBALL, 0, 1)).toEqual([]);
      // 资源降级（读不到 waveSize = 0）→ 没有证据证明恒假，保持既有网格（不做无据过滤）。
      expect(countsOf(FIREBALL, 0, 0)).toEqual([2, 3]);
    });

    it('组合候选里的「敌人数」腿同样被挡（单怪图没有「减益失效且多目标」）', () => {
      const labelsOf = (waveSize) =>
        generateAbilityCandidates(soloWith(PUNCTURE), 0, resourcesOf(waveSize)).map((candidate) => candidate.labelKey);
      // 单怪图：敌人数腿恒假 → 依赖它的组合候选整条不产；减益刷新（无绝对值）仍在。
      expect(labelsOf(1)).not.toContain(labels.compositeDebuffMultiple);
      expect(labelsOf(1)).toContain(labels.debuffInactive);
      // 多怪图：组合与单条件都在（回归守卫）。
      expect(labelsOf(4)).toContain(labels.compositeDebuffMultiple);
      expect(labelsOf(4)).toContain(labels.manyEnemies);
    });

    it('「敌人数」精炼的上界随波上限收紧：单怪图没有合法邻域', () => {
      const winner = {
        labelKey: labels.manyEnemies,
        labelParams: { count: 3 },
        triggers: [{ dependencyHrid: ALL_ENEMIES, conditionHrid: ACTIVE_UNITS, comparatorHrid: GTE, value: 3 }],
      };
      const counts = (resources) =>
        buildRefinementCandidates(winner, resources).map((descriptor) => descriptor.labelParams.count);
      // 波上限 4：3 的邻域是 2 与 4（4 ≤ waveSize 合法）。
      expect(counts({ enemyHp: { min: 1000, max: 4000, group: 5000, waveSize: 4 } })).toEqual([2, 4]);
      // 波上限 3：4 越界（≥ waveSize + 1 恒假）→ 只剩 2。
      expect(counts({ enemyHp: { min: 1000, max: 4000, group: 5000, waveSize: 3 } })).toEqual([2]);
      // 单怪图：上界 1 低于网格下界 2 → 该族没有任何合法邻域。
      expect(counts({ enemyHp: { min: 1000, max: 4000, group: 5000, waveSize: 1 } })).toEqual([]);
      // 读不到波上限 → 保持网格边界 [2,8]（无据不过滤）。
      expect(counts({ maxHp: 1000 })).toEqual([2, 4]);
    });

    it('光环槽补上「光环失效且蓝量充足」组合（与 BUFF 角色对齐，用户手工配置正是这条）', () => {
      const candidates = generateAbilityCandidates(soloWith(GUARDIAN_AURA), 0, resourcesOf(4));
      const guard = candidates.find((candidate) => candidate.labelKey === labels.compositeBuffRefreshGuard);
      expect(guard).toBeDefined();
      expect(guard.triggers[0]).toEqual({
        dependencyHrid: SELF,
        conditionHrid: '/combat_trigger_conditions/guardian_aura',
        comparatorHrid: IS_INACTIVE,
        value: 0,
      });
      // 蓝量腿 = current_mp ≥ 30% maxMp = ceil(500 × 0.3) = 150（与 BUFF 角色的同名组合同口径）。
      expect(guard.triggers[1].conditionHrid).toBe(CURRENT_MP);
      expect(guard.triggers[1].comparatorHrid).toBe(GTE);
      expect(guard.triggers[1].value).toBe(150);
      expect(guard.labelParams.mpPercent).toBe(30);
      expect(sanitizeTriggerList(guard.triggers)).toEqual(guard.triggers);
      // 需要绝对值（maxMp）：读不到战斗属性时整条跳过，但另外两条不需要绝对值的组合仍在
      // —— 与「不硬凑」的资源降级口径一致。
      const degraded = generateAbilityCandidates(soloWith(GUARDIAN_AURA), 0, {});
      expect(degraded.some((candidate) => candidate.labelKey === labels.compositeBuffRefreshGuard)).toBe(false);
      expect(degraded.some((candidate) => candidate.labelKey === labels.compositeAuraRefreshAllyLowHp)).toBe(true);
    });

    it('光环的单条件候选仍是空的 —— 游戏默认就是「未生效时释放」，补了会被行为等价去重吃掉', () => {
      // 实测（abilityDetailMap.defaultCombatTriggers）：光环类技能的默认配置正是
      // `self + 〈自身光环〉 + is_inactive`，而生成器会剔除「与默认等价」的候选
      // ⇒ 单条件候选在光环槽只会空转，真正缺的是组合里的守卫维度（上一条用例）。
      expect(sanitizeTriggerList(getDefaultTriggerDtosForHrid(GUARDIAN_AURA))).toEqual([
        {
          dependencyHrid: SELF,
          conditionHrid: '/combat_trigger_conditions/guardian_aura',
          comparatorHrid: IS_INACTIVE,
          value: 0,
        },
      ]);
      const candidates = generateAbilityCandidates(soloWith(GUARDIAN_AURA), 0, resourcesOf(4));
      expect(candidates.filter((candidate) => (candidate.triggers || []).length === 1)).toEqual([]);
    });
  });

  describe('resources and thresholds', () => {
    const playerWith = (hrid) =>
      playerWithAbilities(
        [
          { abilityHrid: GUARDIAN_AURA, level: 1 },
          { abilityHrid: hrid, level: 1 },
        ],
        {},
        100,
      );

    it('skips absolute-value candidates when maxHp/maxMp are unknown', () => {
      // 不能用 playerConfig 估算血量（装备/成就/公会增益会影响最终值），缺失时宁可少候选。
      const candidates = generateAbilityCandidates(playerWith(FIREBALL), 1, {});
      const labels = candidates.map((candidate) => candidate.labelKey);
      expect(labels).not.toContain(TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.lowHp);
      expect(labels).not.toContain(TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.executeHp);
      expect(labels).toContain(TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.manyEnemies); // 不依赖资源
      // 默认 + 立即释放 + 两个 AOE + 一条跨技能增益门（is_active 也不需要绝对值）= 5 个。
      expect(candidates.length).toBe(5);
      expect(labels).toContain(TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.buffWindow);
    });

    it('converts percentages to absolute values using the provided resources', () => {
      const candidates = generateAbilityCandidates(playerWith(FIREBALL), 1, {
        resources: { maxHp: 2000, maxMp: 1000 },
      });
      const lowHp = candidates.find((candidate) => candidate.labelParams.percent === 50);
      expect(lowHp.triggers[0].value).toBe(1000);
    });

    it('honors threshold overrides', () => {
      const candidates = generateAbilityCandidates(playerWith(FIREBALL), 1, {
        ...RESOURCES,
        candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
        thresholds: { damageHpPercent: [33] },
      });
      const lowHp = candidates.filter(
        (candidate) => candidate.labelKey === TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.lowHp,
      );
      expect(lowHp.map((candidate) => candidate.labelParams.percent)).toEqual([33]);
      expect(lowHp[0].triggers[0].value).toBe(330);
    });
  });

  describe('buildRefinementCandidates（自适应阈值精炼）', () => {
    const playerWith = (hrid) =>
      playerWithAbilities(
        [
          { abilityHrid: GUARDIAN_AURA, level: 1 },
          { abilityHrid: hrid, level: 1 },
        ],
        {},
        100,
      );

    const SELF = '/combat_trigger_dependencies/self';
    const TARGETED_ENEMY = '/combat_trigger_dependencies/targeted_enemy';
    const ALL_ENEMIES = '/combat_trigger_dependencies/all_enemies';
    const CURRENT_HP = '/combat_trigger_conditions/current_hp';
    const MISSING_HP = '/combat_trigger_conditions/missing_hp';
    const LOWEST_HP = '/combat_trigger_conditions/lowest_hp_percentage';
    const ACTIVE_UNITS = '/combat_trigger_conditions/number_of_active_units';
    const DEAD_UNITS = '/combat_trigger_conditions/number_of_dead_units';
    const LTE = '/combat_trigger_comparators/less_than_equal';
    const GTE = '/combat_trigger_comparators/greater_than_equal';

    const RES = { maxHp: 1000, maxMp: 500 };

    // 输出技能在默认候选上限（10）下按家族交错截断（§39-A），轮 2 的同族第 2 条会被丢掉。
    // 精炼用例需要完整网格 → 用上限档（16）生成。
    const fireballCandidates = () =>
      generateAbilityCandidates(playerWith(FIREBALL), 1, {
        ...RESOURCES,
        candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
      });

    // 从生成结果里取一条「指定标签 + 指定百分比/计数」的候选，模拟搜索层采纳的 winner。
    function findCandidate(candidates, labelKey, paramValue) {
      return candidates.find((candidate) => {
        if (candidate.labelKey !== labelKey) return false;
        const params = candidate.labelParams || {};
        return params.percent === paramValue || params.count === paramValue;
      });
    }

    it('为单条件百分比候选生成 ±10 个百分点的邻域候选（绝对值换算与生成器同口径）', () => {
      // damage 的低血候选：current_hp <= 500（50%），floor 取整。
      const winner = findCandidate(fireballCandidates(), TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.lowHp, 50);
      const descriptors = buildRefinementCandidates(winner, RES);
      expect(descriptors.map((descriptor) => descriptor.labelParams.percent).sort((a, b) => a - b)).toEqual([40, 60]);
      // floor(1000 * 0.4) = 400、floor(1000 * 0.6) = 600。
      expect(descriptors.map((descriptor) => descriptor.triggers[0].value).sort((a, b) => a - b)).toEqual([400, 600]);
      // 复用 winner 的三件套：依赖/条件/比较器不变，标签与插值参数沿用（无新 i18n key）。
      expect(
        descriptors.every(
          (descriptor) =>
            descriptor.triggers[0].dependencyHrid === SELF &&
            descriptor.triggers[0].conditionHrid === CURRENT_HP &&
            descriptor.triggers[0].comparatorHrid === LTE &&
            descriptor.labelKey === TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.lowHp,
        ),
      ).toBe(true);
    });

    // 多级精炼（B2，2026-09-19）：步长随层级减半（10 → 5，5 为下限）；计数类 ±1 不变。
    it('精炼步长随层级减半（level≥1 → ±5，下限 5），计数类不随层级变化', () => {
      const winner = findCandidate(fireballCandidates(), TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.lowHp, 50);
      // level 0（缺省）= ±10：40 / 60。
      expect(
        buildRefinementCandidates(winner, RES, { level: 0 })
          .map((descriptor) => descriptor.labelParams.percent)
          .sort((a, b) => a - b),
      ).toEqual([40, 60]);
      // level 1 = ±5：45 / 55，绝对值换算与生成器同口径（floor(1000 × 0.45/0.55)）。
      const levelOne = buildRefinementCandidates(winner, RES, { level: 1 });
      expect(levelOne.map((descriptor) => descriptor.labelParams.percent).sort((a, b) => a - b)).toEqual([45, 55]);
      expect(levelOne.map((descriptor) => descriptor.triggers[0].value).sort((a, b) => a - b)).toEqual([450, 550]);
      // level 2+ 仍是 ±5（下限：再细的阈值差异已低于逐轮抽样噪声；二分对照的无提升实证见设计 §32）。
      expect(
        buildRefinementCandidates(winner, RES, { level: 2 })
          .map((descriptor) => descriptor.labelParams.percent)
          .sort((a, b) => a - b),
      ).toEqual([45, 55]);
      // 原始百分比类（lowest_hp_percentage）不依赖资源，同样按层级减半。
      const allyWinner = findCandidate(
        generateAbilityCandidates(playerWith(HEAL), 1, { ...RESOURCES, candidateLimit: 16 }),
        TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.allyLowHp,
        40,
      );
      expect(
        buildRefinementCandidates(allyWinner, {}, { level: 1 }).map((descriptor) => descriptor.triggers[0].value),
      ).toEqual([35, 45]);
      // 计数类：±1 已是最细整数粒度，不随层级变化。
      const countWinner = findCandidate(fireballCandidates(), TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.manyEnemies, 3);
      expect(
        buildRefinementCandidates(countWinner, RES, { level: 1 }).map((descriptor) => descriptor.labelParams.count),
      ).toEqual([2, 4]);
      // 边界：95% 在 level 1 只产出单侧（95 - 5 = 90；95 + 5 → clamp 95 与自身相同 → 跳过）。
      const edgeWinner = findCandidate(
        generateAbilityCandidates(playerWith(FIREBALL), 1, {
          ...RESOURCES,
          candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
          thresholds: { damageHpPercent: [95] },
        }),
        TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.lowHp,
        95,
      );
      expect(
        buildRefinementCandidates(edgeWinner, RES, { level: 1 }).map((descriptor) => descriptor.labelParams.percent),
      ).toEqual([90]);
      // 物化路径同样透传 level（搜索层按级调用 buildRefinedCandidates）。
      const choice = {
        slotIndex: 1,
        abilityHrid: FIREBALL,
        role: TRIGGER_OPTIMIZER_ROLE_DAMAGE,
        candidates: fireballCandidates(),
      };
      expect(
        buildRefinedCandidates(winner, choice, RES, { level: 1 })
          .map((candidate) => candidate.labelParams.percent)
          .sort((a, b) => a - b),
      ).toEqual([45, 55]);
    });

    it('missing_hp 用向上取整（与 defense/healing 生成器一致）', () => {
      const winner = findCandidate(
        generateAbilityCandidates(playerWith(HEAL), 1, { ...RESOURCES, candidateLimit: 16 }),
        TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.missingHp,
        25,
      );
      const descriptors = buildRefinementCandidates(winner, RES);
      // 25 - 10 = 15 → ceil(1000 * 0.15) = 150；25 + 10 = 35 → ceil(1000 * 0.35) = 350。
      expect(descriptors.map((descriptor) => descriptor.triggers[0].value).sort((a, b) => a - b)).toEqual([150, 350]);
      expect(descriptors.every((descriptor) => descriptor.triggers[0].conditionHrid === MISSING_HP)).toBe(true);
    });

    it('lowest_hp_percentage 不依赖资源即可精炼（原始百分比）', () => {
      const winner = findCandidate(
        generateAbilityCandidates(playerWith(HEAL), 1, { ...RESOURCES, candidateLimit: 16 }),
        TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.allyLowHp,
        40,
      );
      // 资源缺失也能精炼（本身即百分比）。
      const descriptors = buildRefinementCandidates(winner, {});
      expect(descriptors.map((descriptor) => descriptor.triggers[0].value).sort((a, b) => a - b)).toEqual([30, 50]);
      expect(descriptors.every((descriptor) => descriptor.triggers[0].conditionHrid === LOWEST_HP)).toBe(true);
    });

    it('number_of_active_units 计数 ±1 并 clamp 到 [2,8]', () => {
      const winner = findCandidate(fireballCandidates(), TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.manyEnemies, 2);
      expect(winner.triggers[0].dependencyHrid).toBe(ALL_ENEMIES);
      // 2 的邻域：1 被 clamp 到 2（与自身相同 → 跳过），只剩 3。
      // 本函数只负责产出邻域；与该槽已有候选的签名去重在 buildRefinedCandidates 里做。
      const descriptors = buildRefinementCandidates(winner, RES);
      expect(descriptors.map((descriptor) => descriptor.labelParams.count)).toEqual([3]);
      // 3 的邻域：2 与 4 都保留（下一轮 buildRefinedCandidates 会按签名跳过已在网格里的 2）。
      const winner3 = findCandidate(fireballCandidates(), TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.manyEnemies, 3);
      const next = buildRefinementCandidates(winner3, RES);
      expect(next.map((descriptor) => descriptor.labelParams.count)).toEqual([2, 4]);
      expect(next[0].triggers[0].conditionHrid).toBe(ACTIVE_UNITS);
      expect(next[0].triggers[0].comparatorHrid).toBe(GTE);
      // 上界处：8 的邻域 9 被 clamp 回 8（与自身相同 → 跳过），只剩 7。
      const winner8 = {
        labelKey: TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.manyEnemies,
        labelParams: { count: 8 },
        triggers: [{ dependencyHrid: ALL_ENEMIES, conditionHrid: ACTIVE_UNITS, comparatorHrid: GTE, value: 8 }],
      };
      expect(buildRefinementCandidates(winner8, RES).map((descriptor) => descriptor.labelParams.count)).toEqual([7]);
    });

    // 波内进度类（2026-09-20，设计 §22.4）：计数 ±1，但合法区间由**区域一波怪的上限人数**
    // 决定（≥ 类 [1, waveSize−1]、≤ 类 [0, waveSize−2]），不能复用 number_of_active_units
    // 的 [2,8]：≤ 0 是合法网格点（≤ 1 恒真），≥ waveSize 是恒假配置。
    it('波内进度类精炼 ±1 并 clamp 到区域波上限决定的合法区间', () => {
      const deadWinner = (labelKey, count, comparatorHrid) => ({
        labelKey,
        labelParams: { count },
        triggers: [{ dependencyHrid: ALL_ENEMIES, conditionHrid: DEAD_UNITS, comparatorHrid, value: count }],
      });
      const resourcesOf = (waveSize) => ({ enemyHp: { min: 1000, max: 4000, group: 5000, waveSize } });
      const most = (count) => deadWinner(TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.deadUnitsAtMost, count, LTE);
      const least = (count) => deadWinner(TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.deadUnitsAtLeast, count, GTE);
      const counts = (descriptors) => descriptors.map((descriptor) => descriptor.labelParams.count);

      // 波上限 4（丛林）：≤ 0 的邻域只有 1（−1 被 clamp 回 0 = 与自身相同 → 跳过）；
      // ≥ 2 的邻域是 1 与 3（1 在网格里，由 buildRefinedCandidates 的签名去重跳过）。
      expect(counts(buildRefinementCandidates(most(0), resourcesOf(4)))).toEqual([1]);
      expect(counts(buildRefinementCandidates(least(2), resourcesOf(4)))).toEqual([1, 3]);
      // ≥ 1 的邻域只有 2（0 非法 → clamp 回 1 = 自身）。
      expect(counts(buildRefinementCandidates(least(1), resourcesOf(4)))).toEqual([2]);
      // 波上限 2：≤ 0（上界 0）与 ≥ 1（上界 1）都没有合法邻域 → 不产出。
      expect(buildRefinementCandidates(most(0), resourcesOf(2))).toEqual([]);
      expect(buildRefinementCandidates(least(1), resourcesOf(2))).toEqual([]);
      // 单怪图 / 缺 waveSize / 无资源 → 不精炼（与生成阶段「整族不生成」同口径）。
      expect(buildRefinementCandidates(most(0), resourcesOf(1))).toEqual([]);
      expect(buildRefinementCandidates(most(0), { enemyHp: { min: 1000, max: 4000, group: 5000 } })).toEqual([]);
      expect(buildRefinementCandidates(most(0), { maxHp: 1000 })).toEqual([]);
      // 三件套/比较器/标签与插值沿用 winner（无新 i18n key），且产物通过 sanitize。
      const refined = buildRefinementCandidates(most(0), resourcesOf(4))[0];
      expect(refined.triggers[0].dependencyHrid).toBe(ALL_ENEMIES);
      expect(refined.triggers[0].conditionHrid).toBe(DEAD_UNITS);
      expect(refined.triggers[0].comparatorHrid).toBe(LTE);
      expect(refined.labelKey).toBe(TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.deadUnitsAtMost);
      expect(sanitizeTriggerList(refined.triggers)).toEqual(refined.triggers);
    });

    // 敌方血量类（2026-09-21 新增，设计 §24）：阈值 = 百分比 × 敌方血量尺度，步长复用同一把
    // 「百分点」尺子；标签插值是绝对值 {{value}}（没有 percent），百分比由 value ÷ 尺度反推，
    // 物化仍写回 { value } —— 与网格候选完全同一份标签契约（UI/i18n 无需改动）。
    it('敌方血量类精炼 ±10 个百分点并换算回绝对值（三标签各用自己的尺度）', () => {
      const ENEMY_RES = { enemyHp: { min: 1000, max: 4000, group: 5000 } };
      const labelKeys = TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS;
      const candidates = fireballCandidates();
      const winnerOf = (labelKey, value) =>
        candidates.find(
          (candidate) => candidate.labelKey === labelKey && (candidate.labelParams || {}).value === value,
        );
      const valuesOf = (descriptors) =>
        descriptors.map((descriptor) => descriptor.labelParams.value).sort((a, b) => a - b);

      // AOE 总量（group 5000）：网格 25% = 1250 → 15% = 750 / 35% = 1750。
      const group = buildRefinementCandidates(winnerOf(labelKeys.enemyGroupHp, 1250), ENEMY_RES);
      expect(valuesOf(group)).toEqual([750, 1750]);
      expect(group.every((descriptor) => descriptor.triggers[0].dependencyHrid === ALL_ENEMIES)).toBe(true);
      expect(group.every((descriptor) => descriptor.triggers[0].comparatorHrid === GTE)).toBe(true);
      // 单体目标血量（min 1000，GTE）：网格 50% = 500 → 40% = 400 / 60% = 600。
      expect(valuesOf(buildRefinementCandidates(winnerOf(labelKeys.enemyTargetHp, 500), ENEMY_RES))).toEqual([
        400, 600,
      ]);
      // 斩杀线（min 1000，LTE）：网格 30% = 300 → 20% = 200 / 40% = 400。
      const execute = buildRefinementCandidates(winnerOf(labelKeys.executeHp, 300), ENEMY_RES);
      expect(valuesOf(execute)).toEqual([200, 400]);
      expect(execute.every((descriptor) => descriptor.triggers[0].dependencyHrid === TARGETED_ENEMY)).toBe(true);
      expect(execute.every((descriptor) => descriptor.triggers[0].comparatorHrid === LTE)).toBe(true);
      // 步长同样随层级减半（level ≥1 → ±5pp）：25% = 250 / 35% = 350。
      expect(valuesOf(buildRefinementCandidates(winnerOf(labelKeys.executeHp, 300), ENEMY_RES, { level: 1 }))).toEqual([
        250, 350,
      ]);
      // 标签与插值形态沿用 winner（仍是绝对值 { value }，没有 percent），且产物通过 sanitize。
      expect(
        execute.every(
          (descriptor) =>
            descriptor.labelKey === labelKeys.executeHp &&
            descriptor.labelParams.percent === undefined &&
            sanitizeTriggerList(descriptor.triggers).length === descriptor.triggers.length,
        ),
      ).toBe(true);
    });

    it('敌方血量类的自守与降级：越界阈值不产出，尺度缺失整类不精炼', () => {
      const labelKeys = TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS;
      const groupWinner = {
        labelKey: labelKeys.enemyGroupHp,
        labelParams: { value: 4000 },
        triggers: [{ dependencyHrid: ALL_ENEMIES, conditionHrid: CURRENT_HP, comparatorHrid: GTE, value: 4000 }],
      };
      // 80% of 5000 = 4000 正好是上界（enemyHp.max）：+10pp → 90% = 4500 > 4000（恒真，白跑一场），
      // 按生成阶段的自守规则不产出；−10pp → 70% = 3500 合法。
      expect(
        buildRefinementCandidates(groupWinner, { enemyHp: { min: 1000, max: 4000, group: 5000 } }).map(
          (descriptor) => descriptor.labelParams.value,
        ),
      ).toEqual([3500]);
      // 上界缺失（只有 group）→ 无法自守，整条跳过（不产越界阈值）。
      expect(buildRefinementCandidates(groupWinner, { enemyHp: { min: 1000, group: 5000 } })).toEqual([]);
      // 尺度缺失 / 为 0 → 不精炼（与生成阶段「资源降级 → 敌方血量类整类不生成」一致）。
      const executeWinner = {
        labelKey: labelKeys.executeHp,
        labelParams: { value: 300 },
        triggers: [{ dependencyHrid: TARGETED_ENEMY, conditionHrid: CURRENT_HP, comparatorHrid: LTE, value: 300 }],
      };
      expect(buildRefinementCandidates(executeWinner, {})).toEqual([]);
      expect(buildRefinementCandidates(executeWinner, { maxHp: 1000, maxMp: 500 })).toEqual([]);
      expect(buildRefinementCandidates(executeWinner, { enemyHp: { min: 0, max: 0, group: 0 } })).toEqual([]);
      // 尺度太小时 ±步长会取整回同一个阈值 → 不产出（不把「同一个点」当邻域重复评估）。
      expect(
        buildRefinementCandidates(
          {
            ...executeWinner,
            labelParams: { value: 2 },
            triggers: [{ ...executeWinner.triggers[0], value: 2 }],
          },
          { enemyHp: { min: 3, max: 10, group: 10 } },
        ),
      ).toEqual([]);
    });

    it('敌方血量类精炼的物化与签名去重（阈值已存在 → 只产出缺失的一侧）', () => {
      const ENEMY_RES = { enemyHp: { min: 1000, max: 4000, group: 5000 } };
      const candidates = fireballCandidates();
      const winner = candidates.find(
        (candidate) => candidate.labelKey === TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.executeHp,
      );
      const choice = { slotIndex: 1, abilityHrid: FIREBALL, role: TRIGGER_OPTIMIZER_ROLE_DAMAGE, candidates };
      const refined = buildRefinedCandidates(winner, choice, ENEMY_RES);
      expect(refined.map((candidate) => candidate.labelParams.value).sort((a, b) => a - b)).toEqual([200, 400]);
      expect(
        refined.every(
          (candidate) =>
            candidate.distance === 4 && // DISTANCE_REFINEMENT
            candidate.state === 'custom' &&
            candidate.labelKey === TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.executeHp &&
            sanitizeTriggerList(candidate.triggers).length === candidate.triggers.length,
        ),
      ).toBe(true);
      // 400 已在候选表里（签名命中）→ 只产出 200。
      const withExisting400 = {
        ...choice,
        candidates: [
          ...candidates,
          {
            signature: JSON.stringify([
              { dependencyHrid: TARGETED_ENEMY, conditionHrid: CURRENT_HP, comparatorHrid: LTE, value: 400 },
            ]),
          },
        ],
      };
      expect(
        buildRefinedCandidates(winner, withExisting400, ENEMY_RES).map((candidate) => candidate.labelParams.value),
      ).toEqual([200]);
    });

    it('百分比 clamp 到 [5,95]：边界处只产出单侧邻域', () => {
      const winner = findCandidate(
        generateAbilityCandidates(playerWith(FIREBALL), 1, {
          ...RESOURCES,
          candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
          thresholds: { damageHpPercent: [95] },
        }),
        TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.lowHp,
        95,
      );
      const descriptors = buildRefinementCandidates(winner, RES);
      // 95 + 10 = 105 → clamp 95（与自身相同，跳过）；只剩 85。
      expect(descriptors.map((descriptor) => descriptor.labelParams.percent)).toEqual([85]);
    });

    it('资源不可用时不产出绝对值类邻域（与生成器降级口径一致）', () => {
      const winner = findCandidate(fireballCandidates(), TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.lowHp, 50);
      expect(buildRefinementCandidates(winner, {})).toEqual([]);
      expect(buildRefinementCandidates(winner, { maxMp: 500 })).toEqual([]); // 只有蓝量不够
    });

    it('组合候选、锚点、非数值条件不可精炼', () => {
      const candidates = fireballCandidates();
      // 立即释放锚点（triggers=[]）。
      const always = candidates.find(
        (candidate) => candidate.labelKey === TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.alwaysFire,
      );
      expect(buildRefinementCandidates(always, RES)).toEqual([]);
      // 默认锚点（triggers=null）。
      const def = candidates.find((candidate) => candidate.labelKey === TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.default);
      expect(buildRefinementCandidates(def, RES)).toEqual([]);
      // 组合候选（2 条触发器）。
      const composite = candidates.find((candidate) => candidate.triggers && candidate.triggers.length === 2);
      expect(composite).toBeDefined();
      expect(buildRefinementCandidates(composite, RES)).toEqual([]);
      // buff 的 is_inactive 类候选（非百分比/计数参数）：provoke 的默认触发器是空列表，
      // 所以它的 buffInactive 候选是真实新配置（berserk 的那条与默认等价、已被去重）。
      const buffInactive = generateAbilityCandidates(playerWith(PROVOKE), 1, RESOURCES).find(
        (candidate) => candidate.labelKey === TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.buffInactive,
      );
      expect(buffInactive).toBeDefined();
      expect(buildRefinementCandidates(buffInactive, RES)).toEqual([]);
      // 非对象 / 缺触发器。
      expect(buildRefinementCandidates(null, RES)).toEqual([]);
      expect(buildRefinementCandidates({}, RES)).toEqual([]);
    });

    it('buildRefinedCandidates 物化 + 签名去重 + sanitize 通过', () => {
      const candidates = fireballCandidates();
      const winner = findCandidate(candidates, TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.lowHp, 50);
      const choice = { slotIndex: 1, abilityHrid: FIREBALL, role: TRIGGER_OPTIMIZER_ROLE_DAMAGE, candidates };

      const refined = buildRefinedCandidates(winner, choice, RES);
      // 40/60 两个新候选（网格里只有 50/75，都不重复）。
      expect(refined.map((candidate) => candidate.labelParams.percent).sort((a, b) => a - b)).toEqual([40, 60]);
      // 物化口径：状态、签名、标签、距离齐备，且触发器通过 sanitize（长度不变）。
      expect(
        refined.every(
          (candidate) =>
            candidate.state === 'custom' &&
            candidate.slotIndex === 1 &&
            candidate.abilityHrid === FIREBALL &&
            candidate.labelKey === TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.lowHp &&
            candidate.distance === 4 && // DISTANCE_REFINEMENT：大于 DISTANCE_COMPOSITE(3)
            sanitizeTriggerList(candidate.triggers).length === candidate.triggers.length,
        ),
      ).toBe(true);
      // 签名与已有候选互不重复。
      const existing = new Set(candidates.map((candidate) => candidate.signature));
      expect(refined.every((candidate) => !existing.has(candidate.signature))).toBe(true);

      // 已存在的阈值会被去重：往 choice.candidates 里塞入 60% 的等价签名后，
      // 从 50 出发精炼到 40/60，60 命中去重被跳过，只剩 40。
      const choiceWith60 = {
        ...choice,
        candidates: [
          ...candidates,
          {
            signature: JSON.stringify([
              { dependencyHrid: SELF, conditionHrid: CURRENT_HP, comparatorHrid: LTE, value: 600 },
            ]),
          },
        ],
      };
      const deduped = buildRefinedCandidates(winner, choiceWith60, RES);
      expect(deduped.map((candidate) => candidate.labelParams.percent)).toEqual([40]);
    });
  });
});

// 技能触发器优化器 —— 候选生成（纯函数）。
//
// 为每个已装备技能（player.abilities 的 5 个槽，含特殊技能槽 0）生成候选触发器
// 配置列表。候选是「该技能 triggerMap 条目的候选值」：
//   ① 保持默认（删键）   ② 立即释放（[] —— 冷却好了就放，不是禁用，见设计 §1.1）
//   ③ 当前配置（若已是自定义，作为锚点保留）  ④ 按技能角色启发式生成的常用配置
//
// 合法性由三个 combatTrigger*DetailMap.json 保证：每条候选都先过
// isConditionAllowedForDependency / isComparatorAllowedForCondition（经
// triggerMapper 的导出查询入口）预检，生成后再跑 sanitizeTriggerList 自查——
// sanitize 会静默丢弃非法条目，不自查会让候选退化成「与默认等价」，白跑模拟。
//
// 角色启发式依据 resolveAbilityDefinition(hrid).abilityEffects 的
// effectType / targetType / buffs 把技能分桶（设计 §6.2）。数值类触发器的 value
// 是绝对值，百分比候选必须由调用方（node-3 的模拟层，走 getFoodOptimizerResources
// 同款路径）通过 settings.resources 传入 maxHp/maxMp；缺失时跳过数值类候选，
// 不用 playerConfig 估算（装备/成就/公会增益会影响最终血量）。

import combatTriggerConditionDetailMap from '../combatsimulator/data/combatTriggerConditionDetailMap.json';
import abilitySlotsLevelRequirementList from '../combatsimulator/data/abilitySlotsLevelRequirementList.json';
import { resolveAbilityDefinition } from '../combatsimulator/abilityDefinitionResolver.js';
import {
  getDefaultTriggerDtosForHrid,
  getTriggerComparatorsForCondition,
  getTriggerConditionsForDependency,
  sanitizeTriggerList,
} from './triggerMapper.js';
import {
  buildTriggerCandidateSignature,
  TRIGGER_OPTIMIZER_DEFAULT_CANDIDATE_LIMIT,
  TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
  TRIGGER_OPTIMIZER_MIN_CANDIDATE_LIMIT,
} from './triggerOptimizerDomain.js';
import { clamp, toFiniteNumber } from './utils.js';

// 触发器三件套 hrid 常量（与 triggerMapper/trigger.js 同源，集中在此避免散落字面量）。
const DEPENDENCY_SELF = '/combat_trigger_dependencies/self';
const DEPENDENCY_TARGETED_ENEMY = '/combat_trigger_dependencies/targeted_enemy';
const DEPENDENCY_ALL_ENEMIES = '/combat_trigger_dependencies/all_enemies';
const DEPENDENCY_ALL_ALLIES = '/combat_trigger_dependencies/all_allies';
const CONDITION_CURRENT_HP = '/combat_trigger_conditions/current_hp';
const CONDITION_CURRENT_MP = '/combat_trigger_conditions/current_mp';
const CONDITION_MISSING_HP = '/combat_trigger_conditions/missing_hp';
const CONDITION_MISSING_MP = '/combat_trigger_conditions/missing_mp';
const CONDITION_LOWEST_HP_PERCENTAGE = '/combat_trigger_conditions/lowest_hp_percentage';
const CONDITION_NUMBER_OF_ACTIVE_UNITS = '/combat_trigger_conditions/number_of_active_units';
// 多目标专用条件（trigger.js 65 只在 isActiveMultiTarget 里求值）：数的是依赖组里
// hp ≤ 0 的单位数。玩家打怪时依赖组 = 当前这一波（combatSimulator 换波会整个替换
// this.enemies），所以它的语义是「波内已死几只」，不是累计击杀。
const CONDITION_NUMBER_OF_DEAD_UNITS = '/combat_trigger_conditions/number_of_dead_units';
const COMPARATOR_GTE = '/combat_trigger_comparators/greater_than_equal';
const COMPARATOR_LTE = '/combat_trigger_comparators/less_than_equal';
const COMPARATOR_IS_ACTIVE = '/combat_trigger_comparators/is_active';
const COMPARATOR_IS_INACTIVE = '/combat_trigger_comparators/is_inactive';

// 技能角色（分桶）。
export const TRIGGER_OPTIMIZER_ROLE_DAMAGE = 'damage';
export const TRIGGER_OPTIMIZER_ROLE_BUFF = 'buff';
export const TRIGGER_OPTIMIZER_ROLE_DEBUFF = 'debuff';
export const TRIGGER_OPTIMIZER_ROLE_DEFENSE = 'defense';
export const TRIGGER_OPTIMIZER_ROLE_HEALING = 'healing';
export const TRIGGER_OPTIMIZER_ROLE_AURA = 'aura';
export const TRIGGER_OPTIMIZER_ROLE_UNKNOWN = 'unknown';

// 角色 → i18n key（翻译在 node-5 的 locales/{zh,en}/common.json 补齐）。
// 键格式必须是 `common:xxx`：项目 i18next 的 defaultNS='common'、nsSeparator=':'，
// 点号前缀（'common.xxx'）会被当作 defaultNS 下的键路径解析而查不到（渲染原始键）。
export const TRIGGER_OPTIMIZER_ROLE_LABEL_KEYS = {
  [TRIGGER_OPTIMIZER_ROLE_DAMAGE]: 'common:triggerOptimizer.role.damage',
  [TRIGGER_OPTIMIZER_ROLE_BUFF]: 'common:triggerOptimizer.role.buff',
  [TRIGGER_OPTIMIZER_ROLE_DEBUFF]: 'common:triggerOptimizer.role.debuff',
  [TRIGGER_OPTIMIZER_ROLE_DEFENSE]: 'common:triggerOptimizer.role.defense',
  [TRIGGER_OPTIMIZER_ROLE_HEALING]: 'common:triggerOptimizer.role.healing',
  [TRIGGER_OPTIMIZER_ROLE_AURA]: 'common:triggerOptimizer.role.aura',
  [TRIGGER_OPTIMIZER_ROLE_UNKNOWN]: 'common:triggerOptimizer.role.unknown',
};

// 候选标签 i18n key 清单（UI 与 node-5 的翻译文件必须覆盖这里每一项）。
export const TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS = {
  default: 'common:triggerOptimizer.candidate.default',
  current: 'common:triggerOptimizer.candidate.current',
  alwaysFire: 'common:triggerOptimizer.candidate.alwaysFire',
  lowHp: 'common:triggerOptimizer.candidate.lowHp',
  executeHp: 'common:triggerOptimizer.candidate.executeHp',
  missingHp: 'common:triggerOptimizer.candidate.missingHp',
  // 敌方血量类候选（2026-09-18 新增）：阈值换算自**区域真实怪物血量**（enemyHp 尺度），
  // 与玩家 maxHp 无关。enemyGroupHp = AOE 的「敌方总血量」（防对小怪尸体放 AOE），
  // enemyTargetHp = 单体「目标血量够高才放」（防过量伤害）。
  enemyGroupHp: 'common:triggerOptimizer.candidate.enemyGroupHp',
  enemyTargetHp: 'common:triggerOptimizer.candidate.enemyTargetHp',
  lowMp: 'common:triggerOptimizer.candidate.lowMp',
  enoughMp: 'common:triggerOptimizer.candidate.enoughMp',
  missingMp: 'common:triggerOptimizer.candidate.missingMp',
  buffInactive: 'common:triggerOptimizer.candidate.buffInactive',
  debuffInactive: 'common:triggerOptimizer.candidate.debuffInactive',
  manyEnemies: 'common:triggerOptimizer.candidate.manyEnemies',
  // 波内进度类候选（2026-09-20 新增，设计 §22）：all_enemies + number_of_dead_units，
  // 阈值取自区域一波怪的**上限**人数（enemyHp.waveSize = maxSpawnCount）。
  //   deadUnitsAtLeast：≥ N → 只在清场期放（残波才用爆发）
  //   deadUnitsAtMost ：≤ N → 只在开波期放（满波才用 AOE，与敌方总血量同向）
  deadUnitsAtLeast: 'common:triggerOptimizer.candidate.deadUnitsAtLeast',
  deadUnitsAtMost: 'common:triggerOptimizer.candidate.deadUnitsAtMost',
  allyLowHp: 'common:triggerOptimizer.candidate.allyLowHp',
  // 跨技能增益门（2026-09-19 新增，设计 §18.3）：只在**其他已佩戴技能**挂给自身的增益
  // 覆盖期间释放（引擎只读 buff 是否存在，不区分「谁挂的」，见 trigger.js 88-140）。
  // 依赖固定为 self：条件来自自身侧（targetType self / allAllies）的 buff。
  buffWindow: 'common:triggerOptimizer.candidate.buffWindow',
  // 跨技能减益窗口（2026-09-21 新增，设计 §23）：只在**当前目标**带有其他已佩戴技能
  // 挂的减益期间释放（爆发对齐增伤窗口）。依赖固定为 targeted_enemy：条件来自目标侧
  // （targetType enemy / allEnemies）的 buff —— 与 buffWindow 是同一件事的两侧，
  // 合成一条会产出恒假候选（施法者身上没有敌人减益）。
  debuffWindow: 'common:triggerOptimizer.candidate.debuffWindow',
  // 合取（AND）组合候选：两条触发器必须同时成立才释放（见下方 compositesForRole 的语义说明）。
  compositeExecuteGuard: 'common:triggerOptimizer.candidate.compositeExecuteGuard',
  compositeManyEnemiesGuard: 'common:triggerOptimizer.candidate.compositeManyEnemiesGuard',
  compositeLowHpGuard: 'common:triggerOptimizer.candidate.compositeLowHpGuard',
  compositeBuffRefreshGuard: 'common:triggerOptimizer.candidate.compositeBuffRefreshGuard',
  compositeBuffRefreshLowHp: 'common:triggerOptimizer.candidate.compositeBuffRefreshLowHp',
  compositeAuraRefreshAllyLowHp: 'common:triggerOptimizer.candidate.compositeAuraRefreshAllyLowHp',
  compositeDebuffRefreshGuard: 'common:triggerOptimizer.candidate.compositeDebuffRefreshGuard',
  compositeDebuffMultiple: 'common:triggerOptimizer.candidate.compositeDebuffMultiple',
  compositeAllyLowHpGuard: 'common:triggerOptimizer.candidate.compositeAllyLowHpGuard',
  compositeMissingHpGuard: 'common:triggerOptimizer.candidate.compositeMissingHpGuard',
  // 跨技能增益门 × AOE 窗口（组合候选）：增益在且这一波怪够厚才放（设计 §18.3）。
  compositeBuffWindowGroupHp: 'common:triggerOptimizer.candidate.compositeBuffWindowGroupHp',
};

// 「立即释放」候选的澄清文案 key（空列表 ≠ 禁用，见设计 §1.1 / §9.2）。
export const TRIGGER_OPTIMIZER_CANDIDATE_DISABLED_HINT_KEY = 'common:triggerOptimizer.candidate.disabledHint';

// 阈值网格默认值（设计 §6.3：HP/MP 百分比 25/50/75/90，number_of_active_units 2/3，斩杀 30）。
// 全量可配：settings.thresholds 整体或逐项覆盖。
export const TRIGGER_OPTIMIZER_DEFAULT_THRESHOLDS = Object.freeze({
  damageHpPercent: [50, 75],
  buffHpPercent: [60],
  defenseHpPercent: [50, 75, 90],
  missingHpPercent: [25, 50],
  // 斩杀线：**相对区域小怪血量**（enemyHp.min），不再是玩家 maxHp 的百分比。
  executePercent: [30],
  // 敌方血量类（2026-09-18 新增，同样相对真实怪物血量）：
  //   enemyGroupHpPercent：一整波怪的总血量（enemyHp.group）—— AOE 防浪费
  //   enemyTargetHpPercent：单个目标血量（enemyHp.min）—— 单体防过量伤害
  enemyGroupHpPercent: [25, 50],
  enemyTargetHpPercent: [50],
  // 输出技能的蓝量台阶：法力 ≥ X% maxMp（上一版只有「复合候选」里带蓝量门槛）。
  minMpPercent: [30],
  activeUnits: [2, 3],
  // 波内进度（2026-09-20 新增，设计 §22）：见 damageCandidates ③ 的说明。
  // 阈值会被区域一波怪的上限人数（enemyHp.waveSize）二次过滤：≥ waveSize 恒假、
  // ≤ waveSize − 1 恒真，两种都不生成（与敌方血量类的 isMeaningfulEnemyHpThreshold 同款）。
  deadUnitsAtLeast: [1, 2],
  deadUnitsAtMost: [0],
  allyLowHpPercent: [40, 60],
  lowMpPercent: [20],
  missingMpPercent: [30],
  // 组合候选的「蓝量充足」门槛：current_mp >= 30% maxMp。
  compositeMpPercent: [30],
});

// 一条技能配置最多几条触发器（与 triggerMapper 的 MAX_TRIGGER_COUNT 同源）。
// 组合候选只用 2 条，余量留给将来的三条件组合。
export const TRIGGER_OPTIMIZER_MAX_TRIGGERS_PER_CANDIDATE = 4;

// 候选「改动距离」：并列分数时倾向改动更小/更接近基线的候选（搜索确定收敛）。
export const DISTANCE_ANCHOR = 0;
const DISTANCE_ALWAYS = 1;
const DISTANCE_CUSTOM = 2;
// 组合候选距离最大：同等分数下优先采纳单条件候选（条件越少越贴合游戏原生用法，
// 也越容易被用户理解与手改）。
const DISTANCE_COMPOSITE = 3;
// 精炼候选距离比组合候选更大：同分时优先网格候选，精炼只在网格候选已被采纳后
// 才有机会跑（见 buildRefinementCandidates）。
const DISTANCE_REFINEMENT = 4;

// 技能槽位上限（playerConfig.abilities 固定 5 槽，含特殊技能槽 0）。
const ABILITY_SLOT_COUNT = 5;

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function resolveThresholds(settings) {
  const overrides = isPlainObject(settings?.thresholds) ? settings.thresholds : {};
  const merged = { ...TRIGGER_OPTIMIZER_DEFAULT_THRESHOLDS };
  for (const key of Object.keys(TRIGGER_OPTIMIZER_DEFAULT_THRESHOLDS)) {
    const override = overrides[key];
    merged[key] = Array.isArray(override)
      ? override.map((value) => toFiniteNumber(value)).filter(Number.isFinite)
      : merged[key];
  }
  return merged;
}

function resolveCandidateSettings(settings = {}) {
  const source = isPlainObject(settings) ? settings : {};
  const resources = isPlainObject(source.resources) ? source.resources : {};
  // 同时接受 resources.maxHp / maxHp / maxHitpoints 三种写法：外层（buildCandidateConfigs）
  // 已归一化后再次调用本函数时，maxHp/maxMp 是平铺字段。
  const rawHp = resources.maxHp ?? source.maxHp ?? source.maxHitpoints;
  const rawMp = resources.maxMp ?? source.maxMp ?? source.maxManapoints;
  const maxHp = Number.isFinite(Number(rawHp)) ? Number(rawHp) : null;
  const maxMp = Number.isFinite(Number(rawMp)) ? Number(rawMp) : null;
  // 敌方血量尺度（enemyHp.min/max/group，由 triggerOptimizerSimulation 用 Zone+Monster
  // 按难度算出）。读不到时敌方血量类候选整类跳过，其余候选不受影响。
  const rawEnemyHp = resources.enemyHp ?? source.enemyHp;
  const enemyHp = isPlainObject(rawEnemyHp) ? rawEnemyHp : null;
  return {
    candidateLimit: clamp(
      Math.floor(toFiniteNumber(source.candidateLimit, TRIGGER_OPTIMIZER_DEFAULT_CANDIDATE_LIMIT)),
      TRIGGER_OPTIMIZER_MIN_CANDIDATE_LIMIT,
      TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
    ),
    thresholds: resolveThresholds(source),
    maxHp,
    maxMp,
    enemyHp,
  };
}

// 智力闸门（playerMapper.js 702-707）：低智力玩家的技能槽不进模拟，
// 候选生成器同步跳过——否则候选永远等价于基线，白费 worker。
export function isAbilitySlotActive(player, slotIndex) {
  const ability = player?.abilities?.[slotIndex];
  const abilityHrid = String(ability?.abilityHrid || '');
  if (!abilityHrid) return false;
  const level = Number(ability.level ?? 1);
  const intelligence = Number(player?.levels?.intelligence ?? 0);
  const requirement = abilitySlotsLevelRequirementList[slotIndex + 1];
  return (
    Number.isFinite(level) && level > 0 && Number.isFinite(intelligence) && intelligence >= (requirement ?? Infinity)
  );
}

// 角色分类：按 effectType / targetType / buffs 分桶（设计 §6.2）。
// 优先级：治疗 > 光环（全队增益）> Debuff（给敌人挂的 buff）> 自身增益 > 伤害 > 未知。
export function classifyAbilityRole(abilityHrid) {
  const definition = resolveAbilityDefinition(abilityHrid);
  if (!definition) return TRIGGER_OPTIMIZER_ROLE_UNKNOWN;
  return classifyAbilityDefinition(definition);
}

function classifyAbilityDefinition(definition) {
  const effects = Array.isArray(definition.abilityEffects) ? definition.abilityEffects : [];
  let hasHeal = false;
  let hasDamage = false;
  let hasHpDrain = false;
  let hasSelfBuff = false;
  let hasAllyBuff = false;
  let hasEnemyBuff = false;
  for (const effect of effects) {
    const buffs = Array.isArray(effect.buffs) ? effect.buffs : [];
    const appliesBuffs = buffs.length > 0;
    if (effect.effectType === '/ability_effect_types/heal') hasHeal = true;
    if (effect.effectType === '/ability_effect_types/damage') hasDamage = true;
    if (toFiniteNumber(effect.hpDrainRatio, 0) > 0) hasHpDrain = true;
    if (appliesBuffs) {
      if (effect.targetType === 'self') hasSelfBuff = true;
      else if (effect.targetType === 'enemy' || effect.targetType === 'allEnemies') hasEnemyBuff = true;
      else hasAllyBuff = true;
    }
  }
  if (hasHeal) return TRIGGER_OPTIMIZER_ROLE_HEALING;
  if (hasAllyBuff) return TRIGGER_OPTIMIZER_ROLE_AURA;
  if (hasEnemyBuff) return TRIGGER_OPTIMIZER_ROLE_DEBUFF;
  if (hasSelfBuff) return TRIGGER_OPTIMIZER_ROLE_BUFF;
  if (hasHpDrain && !hasDamage) return TRIGGER_OPTIMIZER_ROLE_DEFENSE;
  if (hasDamage || hasHpDrain) return TRIGGER_OPTIMIZER_ROLE_DAMAGE;
  return TRIGGER_OPTIMIZER_ROLE_UNKNOWN;
}

// ── 条件侧别（2026-09-21 新增，设计 §23）────────────────────────────────────
// buff 条件在引擎里读的是**某个单位身上**的 combatBuffs（trigger.js 25-42）：
//   · self           → source.combatBuffs（施法者自己）
//   · targeted_enemy → target.combatBuffs（当前目标；target 为空时直接返回 false）
// 而 buff 挂在谁身上由技能定义的 abilityEffects[].targetType 决定：
//   · self / allAllies   → 施法者身上一定有这份 buff（allAllies 的增益施加给
//     this.players，其中含施法者自己，combatSimulator.js 1882-1902）
//   · enemy / allEnemies → buff 只挂在被命中的敌人身上（combatSimulator.js
//     2038-2043 把伤害类效果的 buff 加给 target）；施法者身上永远没有
// ⇒ 「条件配哪个依赖」不是风格问题：把敌人减益配到 self 上恒假（§13 的教训），
//   每轮白跑一场模拟，精细档还占名额。分类只看 targetType，不靠 buff 名字猜。
const CONDITION_SIDE_SELF = 'self';
const CONDITION_SIDE_TARGET = 'target';

function resolveConditionSide(targetType) {
  const normalized = String(targetType || '');
  if (normalized === 'self' || normalized === 'allAllies') return CONDITION_SIDE_SELF;
  if (normalized === 'enemy' || normalized === 'allEnemies') return CONDITION_SIDE_TARGET;
  return null;
}

// 从技能定义里反查它自身 buff 对应的触发器 condition hrid：
//   /buff_uniques/berserk → /combat_trigger_conditions/berserk
// 大多数 buff 唯一键与 condition 同名；光环类（guardian_aura_* 等子键无对应
// condition）回落到技能 hrid 本身的最后一段（guardian_aura），trigger.js 的
// 前缀匹配（Object.keys(combatBuffs).filter(startsWith)）正是按前缀聚合的。
// 只保留在 condition 表里存在且为单目标的 condition（triggerMapper 28-40 要求单目标
// 依赖只能配 isSingleTarget 条件），并按 buff 落点分「自身侧 / 目标侧」返回，
// 调用方按依赖取对应侧（self → SELF、targeted_enemy → TARGET）。
function resolveOwnBuffConditions(definition) {
  const sides = { [CONDITION_SIDE_SELF]: [], [CONDITION_SIDE_TARGET]: [] };
  const seen = new Set();
  const register = (hrid, side) => {
    if (!side) return; // 队友侧：单目标依赖读不到（多目标侧已被 §22 扫完），不进候选
    const detail = combatTriggerConditionDetailMap[hrid];
    if (!detail || !detail.isSingleTarget) return;
    const key = `${side}\u0000${hrid}`;
    if (seen.has(key)) return;
    seen.add(key);
    sides[side].push(hrid);
  };
  const buffSides = new Set();
  for (const effect of definition.abilityEffects || []) {
    const side = resolveConditionSide(effect.targetType);
    for (const buff of effect.buffs || []) {
      const unique = String(buff.uniqueHrid || '');
      if (!unique) continue;
      if (side) buffSides.add(side);
      register(`/combat_trigger_conditions${unique.slice(unique.lastIndexOf('/'))}`, side);
    }
  }
  // 技能 hrid 本身的回落项：只在这个技能确实会挂 buff 时才登记（挂在哪一侧由它的
  // 效果决定；同一技能两侧都有 buff 时两侧都登记 —— 前缀匹配下两种读法都可能成立）。
  const own = String(definition.hrid || '');
  if (own && buffSides.size > 0) {
    const hrid = `/combat_trigger_conditions${own.slice(own.lastIndexOf('/'))}`;
    for (const side of buffSides) register(hrid, side);
  }
  return sides;
}

// 取某一侧的第一个条件（没有则 null）。
function firstOwnCondition(definition, side) {
  const conditions = resolveOwnBuffConditions(definition)[side];
  return conditions.length ? conditions[0] : null;
}

// ── 跨技能窗口条件（2026-09-19 新增 §18.3；2026-09-21 按侧别拆分 §23）──────────
// 「AOE/爆发只在某个增益/减益覆盖期间释放」是游戏的常见玩法，也是用户手工配置里的
// 写法，但旧生成器只会用**本技能自己**的 buff 条件（resolveOwnBuffConditions），
// 跨技能的一条都不产。引擎侧是支持的：trigger.js 88-140 读的是施法者
// `source.combatBuffs` 里的同名字段，**不区分这个增益是谁挂的**；而 allAllies 类光环
// 的增益会施加到 `this.players`（= 含施法者自己，combatSimulator.js 1882-1902）——
// 所以「自身吃到队友/光环技能的增益」在 self 依赖下可读、可写、有意义。
// 目标侧同理：伤害类技能的减益挂在被命中的敌人身上（combatSimulator.js 2038-2043），
// `targeted_enemy + is_active` 读的正是 target.combatBuffs（trigger.js 31-35）。
//
// 候选只从**其他已佩戴技能**的 buff 条件里取：
//   · 保证该增益在当前配置中真的存在（不会产出恒定假的候选，见 §13 关于暴走的教训）；
//   · 按侧别筛选（2026-09-21 §23）：自身侧条件只配 self、目标侧条件只配 targeted_enemy
//     —— 旧实现不筛侧别，把别人挂在敌人身上的减益也塞进 self 增益门，产出一条恒假候选；
//   · 优先取该侧的「窗口来源」角色（增益侧 aura/buff、减益侧 debuff），再按槽位序补齐；
//   · 每侧上限 CROSS_SKILL_CONDITION_LIMIT 条，避免候选空间爆炸（每条候选都是一场真实模拟）。
const CROSS_SKILL_CONDITION_LIMIT = 3;
const CROSS_SKILL_ROLE_PRIORITY = {
  [CONDITION_SIDE_SELF]: {
    [TRIGGER_OPTIMIZER_ROLE_AURA]: 0,
    [TRIGGER_OPTIMIZER_ROLE_BUFF]: 1,
  },
  [CONDITION_SIDE_TARGET]: {
    [TRIGGER_OPTIMIZER_ROLE_DEBUFF]: 0,
  },
};

function resolveCrossSkillConditions(player, slotIndex, side) {
  const abilities = Array.isArray(player?.abilities) ? player.abilities : [];
  const slotCount = Math.min(abilities.length, ABILITY_SLOT_COUNT);
  const entries = [];
  for (let index = 0; index < slotCount; index += 1) {
    if (index === slotIndex) continue;
    if (!isAbilitySlotActive(player, index)) continue;
    const abilityHrid = String(abilities[index]?.abilityHrid || '');
    if (!abilityHrid) continue;
    const definition = resolveAbilityDefinition(abilityHrid);
    if (!definition) continue;
    const conditions = resolveOwnBuffConditions(definition)[side];
    if (!conditions.length) continue;
    entries.push({
      slotIndex: index,
      role: classifyAbilityDefinition(definition),
      conditions,
    });
  }
  const priority = CROSS_SKILL_ROLE_PRIORITY[side] || {};
  entries.sort(
    (left, right) => (priority[left.role] ?? 2) - (priority[right.role] ?? 2) || left.slotIndex - right.slotIndex,
  );
  const conditions = [];
  for (const entry of entries) {
    for (const condition of entry.conditions) {
      if (conditions.includes(condition)) continue;
      conditions.push(condition);
      if (conditions.length >= CROSS_SKILL_CONDITION_LIMIT) return conditions;
    }
  }
  return conditions;
}

// 合法性预检：condition 必须允许配该 dependency，comparator 必须允许配该 condition
// （triggerMapper 的 isConditionAllowedForDependency / isComparatorAllowedForCondition
// 是模块私有，这里走它导出的查询入口，口径同源不漂移）。
function isTriggerAllowed(dependencyHrid, conditionHrid, comparatorHrid) {
  return (
    getTriggerConditionsForDependency(dependencyHrid).some((condition) => condition.hrid === conditionHrid) &&
    getTriggerComparatorsForCondition(conditionHrid).some((comparator) => comparator.hrid === comparatorHrid)
  );
}

function buildTriggerDto(dependencyHrid, conditionHrid, comparatorHrid, value = 0) {
  if (!isTriggerAllowed(dependencyHrid, conditionHrid, comparatorHrid)) return null;
  return { dependencyHrid, conditionHrid, comparatorHrid, value };
}

function percentToAbsolute(percent, max, rounding) {
  if (max === null || max <= 0) return null;
  return Math.max(1, rounding(max * (clamp(percent, 0, 100) / 100)));
}

// 敌方血量阈值：按尺度（小怪血量 enemyHp.min / 一整波怪血量 enemyHp.group）换算成
// 绝对值。越界阈值会退化成恒真（≈ 立即释放）或恒假（≈ 永不释放）：既白跑一场模拟，
// 又污染候选表——这正是旧版「斩杀线 = 玩家 maxHp × 30%」的毛病（对 500 血的丛林
// 小怪算出 439 ≈ 恒真，对 4400 血的 BOSS 又完全是另一个意思）。因此这类候选必须
// 用真实怪物血量换算，且换算结果一律过 isMeaningfulEnemyHpThreshold 才生成。
function enemyHpThreshold(percent, scale) {
  const numericScale = toFiniteNumber(scale, 0);
  if (!(numericScale > 0)) return null;
  return Math.max(1, Math.round((clamp(percent, 0, 100) / 100) * numericScale));
}

// gte：value 必须 > 1（不能恒真）且 ≤ 上界（不能恒假）；
// lte：value 必须 ≥ 1 且 < 尺度（≥ 尺度即恒真，退化成 [] 立即释放）。
function isMeaningfulEnemyHpThreshold(comparatorHrid, value, ceiling) {
  const numeric = Number(value);
  const upper = toFiniteNumber(ceiling, 0);
  if (!Number.isFinite(numeric) || numeric < 1 || !(upper > 0)) return false;
  return comparatorHrid === COMPARATOR_GTE ? numeric <= upper : numeric < upper;
}

// 「敌人数 ≥ N」的结构性自守（2026-09-21 新增，设计 §25）：一波怪的**上限**人数
// （enemyHp.waveSize = maxSpawnCount）同时是 N 的硬上界 —— 一波最多刷 waveSize 只怪，
// N > waveSize 时该触发器恒假（单怪图里「敌人数 ≥ 2」永远不成立），每轮白跑一场模拟、
// 精细档还占名额。读不到 waveSize（资源降级 = 0）时**不过滤**：没有证据就不改既有行为
// （与 §22「不无据过滤」同口径）。
function isMeaningfulActiveUnitThreshold(count, waveSize) {
  const numeric = Math.floor(toFiniteNumber(count, 0));
  if (!(numeric >= 1)) return false;
  const limit = Math.floor(toFiniteNumber(waveSize, 0));
  return limit >= 1 ? numeric <= limit : true;
}

// ── 按角色的候选描述符（descriptor）生成器 ──────────────────────────────────
// descriptor = { triggers: TriggerDto[] | null, labelKey, labelParams }
// anchors（default/current/always）在外层追加，这里只产「常用配置」。

// 注意（2026-09-17 修订）：「暴走」（/combat_trigger_conditions/enrage）是**怪物**增益
// ——引擎只在 processEnrageTickEvent 里给敌人挂 /buff_uniques/enrage_damage /
// enrage_accuracy（trigger.js 用 `/buff_uniques/enrage` 前缀匹配读取），数据里没有任何
// 技能/消耗品会给玩家自己挂 enrage 系增益。因此 `self + enrage` 的取值恒为 undefined：
// is_inactive 恒真（= 立即释放，与 [] 候选行为完全等价）、is_active 恒假（= 永不释放）。
// 两个方向都是「白跑一场模拟」的无效候选，本轮已全部移除。
// 输出类候选。**顺序 = 预期价值顺序**：descriptors 会被 candidateLimit 截断
//（交错 push 保证组合候选不会整批被丢），所以最值钱的排最前。
// 2026-09-18 实测结论：触发器真正有杠杆的方向是「别把技能丢在快死的一波怪上」——
// 用户手工配置里写的就是它（all_enemies/current_hp >= 500），而旧生成器一条都不产。
function damageCandidates(ctx) {
  const descriptors = [];
  const enemyHp = isPlainObject(ctx.enemyHp) ? ctx.enemyHp : null;
  const smallHp = enemyHp?.min ?? null; // 小怪血量尺度（单体阈值）
  const groupHp = enemyHp?.group ?? null; // 一整波怪血量尺度（AOE 阈值）
  const ceilingHp = enemyHp?.max ?? null; // 阈值合法上界
  const push = (dependencyHrid, conditionHrid, comparatorHrid, value, labelKey, labelParams) => {
    const trigger = buildTriggerDto(dependencyHrid, conditionHrid, comparatorHrid, value);
    if (!trigger) return;
    descriptors.push({ triggers: [trigger], labelKey, labelParams });
  };

  // ① AOE：敌方总血量 ≥ X（这一波怪还剩多少血）→ 别把 AOE 丢在残血的一波上。
  for (const percent of ctx.thresholds.enemyGroupHpPercent) {
    const value = enemyHpThreshold(percent, groupHp);
    if (value === null || !isMeaningfulEnemyHpThreshold(COMPARATOR_GTE, value, ceilingHp)) continue;
    push(
      DEPENDENCY_ALL_ENEMIES,
      CONDITION_CURRENT_HP,
      COMPARATOR_GTE,
      value,
      TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.enemyGroupHp,
      {
        value,
      },
    );
  }
  // 一波怪的上限人数（enemyHp.waveSize = maxSpawnCount）：②「敌人数」与 ③「波内进度」
  // 共用同一条硬上界。读不到（资源降级）= 0 → 两族各自降级（② 不过滤、③ 整族跳过）。
  const waveSize = Math.floor(toFiniteNumber(enemyHp?.waveSize, 0));
  // ② 敌人数（AOE 场合）：多目标才放。阈值同样过波上限自守（2026-09-21 新增，设计 §25）：
  // 单怪图（waveSize = 1，全游戏 44 个区域）里「敌人数 ≥ 2/3」结构性恒假 —— 与 ③ 的
  // 已死怪数自守同一套理由，不产白跑一场的候选。
  for (const count of ctx.thresholds.activeUnits) {
    if (!isMeaningfulActiveUnitThreshold(count, waveSize)) continue;
    push(
      DEPENDENCY_ALL_ENEMIES,
      CONDITION_NUMBER_OF_ACTIVE_UNITS,
      COMPARATOR_GTE,
      count,
      TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.manyEnemies,
      { count },
    );
  }
  // ③ 波内进度（2026-09-20 新增，设计 §22）：引擎的 number_of_dead_units 只在多目标依赖
  // （all_enemies / all_allies）下求值，数的是**当前这一波**里 hp ≤ 0 的怪（换波时整个
  // enemies 数组被替换，所以它是波内进度而非累计击杀）。它给出 ①② 表达不了的窗口：
  //   ≤ N（deadUnitsAtMost）：只在开波期放 —— 「别把技能丢在残波上」的更精确版本；
  //   ≥ N（deadUnitsAtLeast）：只在清场期放 —— 把爆发留给残波（①② 都无法表达的方向）。
  // 阈值必须落在 [0, waveSize)：≥ waveSize 恒假（整波死光就换波）、≤ waveSize − 1 恒真
  // （与没有这条触发器等价）——两种都是白跑一场模拟的无效候选，直接不生成。
  // waveSize 读不到（资源降级）或 < 2（单怪图没有「波内进度」可言）→ 整族跳过。
  if (waveSize >= 2) {
    for (const count of ctx.thresholds.deadUnitsAtMost) {
      const value = Math.floor(toFiniteNumber(count, 0));
      if (!(value >= 0 && value <= waveSize - 2)) continue;
      push(
        DEPENDENCY_ALL_ENEMIES,
        CONDITION_NUMBER_OF_DEAD_UNITS,
        COMPARATOR_LTE,
        value,
        TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.deadUnitsAtMost,
        { count: value },
      );
    }
    for (const count of ctx.thresholds.deadUnitsAtLeast) {
      const value = Math.floor(toFiniteNumber(count, 0));
      if (!(value >= 1 && value <= waveSize - 1)) continue;
      push(
        DEPENDENCY_ALL_ENEMIES,
        CONDITION_NUMBER_OF_DEAD_UNITS,
        COMPARATOR_GTE,
        value,
        TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.deadUnitsAtLeast,
        { count: value },
      );
    }
  }
  // ④ 跨技能增益门（2026-09-19 新增，设计 §18.3）：只在**其他已佩戴技能**挂给自身的
  // 增益覆盖期间释放 —— 与增益窗口对齐（旧生成器一条都不产，见 resolveCrossSkillConditions）。
  // 排在「敌方血量/敌人数」之后、「单体目标血量」之前：与窗口对齐对爆发技能的期望收益
  // 高于防过量伤害，但低于 AOE 时机（实测唯一被反复采纳的方向）。
  // 条件只取自身侧（2026-09-21 §23）：目标侧减益配 self 恒假，改由 ⑤ 用 targeted_enemy 生成。
  for (const conditionHrid of ctx.otherBuffConditions || []) {
    const trigger = buildTriggerDto(DEPENDENCY_SELF, conditionHrid, COMPARATOR_IS_ACTIVE);
    if (!trigger) continue;
    descriptors.push({
      triggers: [trigger],
      labelKey: TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.buffWindow,
      labelParams: { conditionHrid },
    });
  }
  // ⑤ 跨技能减益窗口（2026-09-21 新增，设计 §23）：只在**当前目标**带着其他已佩戴技能
  // 挂的减益时释放。减益里收益最直接的一类是「受到伤害提高」（破甲弹 fracturing_impact
  // +5% 受伤、致残 maim +8% 受伤），其次是破甲（puncture −20% 护甲）与降攻速
  // （ice_spear −25% 攻速）——把爆发放进这个窗口是实打实的乘区对齐。
  // 依赖必须是 targeted_enemy：引擎读 target.combatBuffs（trigger.js 31-35，target 为空
  // 直接返回 false）；配 self 会读施法者自己身上的 buff，而减益挂在敌人身上 → 恒假。
  // 排在 ④ 之后：同一档「窗口对齐」，但窗口先由 ④ 的自身增益给出（该侧已被 §18.3 实测
  // 采纳过），减益窗口的收益方向尚未实测（见设计 §23.4 的边界说明）。
  for (const conditionHrid of ctx.otherDebuffConditions || []) {
    const trigger = buildTriggerDto(DEPENDENCY_TARGETED_ENEMY, conditionHrid, COMPARATOR_IS_ACTIVE);
    if (!trigger) continue;
    descriptors.push({
      triggers: [trigger],
      labelKey: TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.debuffWindow,
      labelParams: { conditionHrid },
    });
  }
  // ⑥ 单体：目标血量 ≥ X → 防过量伤害（把技能留给下一只满血怪，而不是补刀残血小怪）。
  for (const percent of ctx.thresholds.enemyTargetHpPercent) {
    const value = enemyHpThreshold(percent, smallHp);
    if (value === null || !isMeaningfulEnemyHpThreshold(COMPARATOR_GTE, value, smallHp)) continue;
    push(
      DEPENDENCY_TARGETED_ENEMY,
      CONDITION_CURRENT_HP,
      COMPARATOR_GTE,
      value,
      TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.enemyTargetHp,
      { value },
    );
  }
  // ⑦ 斩杀线：目标血量 ≤ X（% **小怪血量**，不再是玩家 maxHp 的百分比）。
  for (const percent of ctx.thresholds.executePercent) {
    const value = enemyHpThreshold(percent, smallHp);
    if (value === null || !isMeaningfulEnemyHpThreshold(COMPARATOR_LTE, value, smallHp)) continue;
    push(
      DEPENDENCY_TARGETED_ENEMY,
      CONDITION_CURRENT_HP,
      COMPARATOR_LTE,
      value,
      TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.executeHp,
      {
        value,
      },
    );
  }
  // ⑧ 蓝量台阶：法力 ≥ X%（上一版只有「复合候选」里带蓝量门槛，缺一条朴素的）。
  for (const percent of ctx.thresholds.minMpPercent) {
    const value = percentToAbsolute(percent, ctx.maxMp, Math.floor);
    if (value === null) continue;
    push(
      DEPENDENCY_SELF,
      CONDITION_CURRENT_MP,
      COMPARATOR_GTE,
      value,
      TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.enoughMp,
      {
        percent,
      },
    );
  }
  // ⑨ 自身残血（旧候选，价值最低，排最后：candidateLimit 截断时先丢它）。
  for (const percent of ctx.thresholds.damageHpPercent) {
    const value = percentToAbsolute(percent, ctx.maxHp, Math.floor);
    if (value === null) continue;
    push(DEPENDENCY_SELF, CONDITION_CURRENT_HP, COMPARATOR_LTE, value, TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.lowHp, {
      percent,
    });
  }
  return descriptors;
}

function buffCandidates(ctx) {
  const descriptors = [];
  // 自身增益 → 自身侧条件（targetType self / allAllies）：buff 挂在施法者身上，
  // self 依赖读得到（resolveOwnBuffConditions 的侧别分类，设计 §23）。
  const condition = firstOwnCondition(ctx.definition, CONDITION_SIDE_SELF);
  if (condition) {
    const trigger = buildTriggerDto(DEPENDENCY_SELF, condition, COMPARATOR_IS_INACTIVE);
    if (trigger) {
      descriptors.push({
        triggers: [trigger],
        labelKey: TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.buffInactive,
        labelParams: { conditionHrid: condition },
      });
    }
  }
  for (const percent of ctx.thresholds.buffHpPercent) {
    const value = percentToAbsolute(percent, ctx.maxHp, Math.floor);
    if (value === null) continue;
    const trigger = buildTriggerDto(DEPENDENCY_SELF, CONDITION_CURRENT_HP, COMPARATOR_LTE, value);
    if (trigger) {
      descriptors.push({
        triggers: [trigger],
        labelKey: TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.lowHp,
        labelParams: { percent },
      });
    }
  }
  for (const percent of ctx.thresholds.missingMpPercent) {
    const value = percentToAbsolute(percent, ctx.maxMp, Math.ceil);
    if (value === null) continue;
    const trigger = buildTriggerDto(DEPENDENCY_SELF, CONDITION_MISSING_MP, COMPARATOR_GTE, value);
    if (trigger) {
      descriptors.push({
        triggers: [trigger],
        labelKey: TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.missingMp,
        labelParams: { percent },
      });
    }
  }
  return descriptors;
}

function debuffCandidates(ctx) {
  const descriptors = [];
  // 本技能挂给敌人的减益 → 目标侧条件（targetType enemy / allEnemies）：buff 挂在被
  // 命中的敌人身上，只有 targeted_enemy 依赖读得到（设计 §23）。配 self 恒假。
  const condition = firstOwnCondition(ctx.definition, CONDITION_SIDE_TARGET);
  if (condition) {
    const trigger = buildTriggerDto(DEPENDENCY_TARGETED_ENEMY, condition, COMPARATOR_IS_INACTIVE);
    if (trigger) {
      descriptors.push({
        triggers: [trigger],
        labelKey: TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.debuffInactive,
        labelParams: { conditionHrid: condition },
      });
    }
  }
  // 敌人数阈值同样过波上限自守（2026-09-21 §25）：与 damageCandidates ② 同口径 ——
  // 单怪图里「敌人数 ≥ 2/3」恒假，不产白跑一场的候选。
  const debuffWaveSize = Math.floor(toFiniteNumber(isPlainObject(ctx.enemyHp) ? ctx.enemyHp.waveSize : 0, 0));
  for (const count of ctx.thresholds.activeUnits) {
    if (!isMeaningfulActiveUnitThreshold(count, debuffWaveSize)) continue;
    const trigger = buildTriggerDto(DEPENDENCY_ALL_ENEMIES, CONDITION_NUMBER_OF_ACTIVE_UNITS, COMPARATOR_GTE, count);
    if (trigger) {
      descriptors.push({
        triggers: [trigger],
        labelKey: TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.manyEnemies,
        labelParams: { count },
      });
    }
  }
  return descriptors;
}

function defenseCandidates(ctx) {
  const descriptors = [];
  for (const percent of ctx.thresholds.defenseHpPercent) {
    const value = percentToAbsolute(percent, ctx.maxHp, Math.floor);
    if (value === null) continue;
    const trigger = buildTriggerDto(DEPENDENCY_SELF, CONDITION_CURRENT_HP, COMPARATOR_LTE, value);
    if (trigger) {
      descriptors.push({
        triggers: [trigger],
        labelKey: TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.lowHp,
        labelParams: { percent },
      });
    }
  }
  for (const percent of ctx.thresholds.missingHpPercent) {
    const value = percentToAbsolute(percent, ctx.maxHp, Math.ceil);
    if (value === null) continue;
    const trigger = buildTriggerDto(DEPENDENCY_SELF, CONDITION_MISSING_HP, COMPARATOR_GTE, value);
    if (trigger) {
      descriptors.push({
        triggers: [trigger],
        labelKey: TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.missingHp,
        labelParams: { percent },
      });
    }
  }
  // lowest_hp_percentage 是 0-100 的百分比，可直接写数值，不需要 maxHp。
  for (const percent of ctx.thresholds.allyLowHpPercent) {
    const trigger = buildTriggerDto(
      DEPENDENCY_ALL_ALLIES,
      CONDITION_LOWEST_HP_PERCENTAGE,
      COMPARATOR_LTE,
      Math.max(1, Math.min(100, Math.round(percent))),
    );
    if (trigger) {
      descriptors.push({
        triggers: [trigger],
        labelKey: TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.allyLowHp,
        labelParams: { percent },
      });
    }
  }
  return descriptors;
}

function healingCandidates(ctx) {
  const descriptors = defenseCandidates(ctx);
  for (const percent of ctx.thresholds.lowMpPercent) {
    const value = percentToAbsolute(percent, ctx.maxMp, Math.floor);
    if (value === null) continue;
    const trigger = buildTriggerDto(DEPENDENCY_SELF, CONDITION_CURRENT_MP, COMPARATOR_LTE, value);
    if (trigger) {
      descriptors.push({
        triggers: [trigger],
        labelKey: TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.lowMp,
        labelParams: { percent },
      });
    }
  }
  return descriptors;
}

// 光环：单条件候选只保留锚点。光环是长 CD、常驻型全队增益，`[]`（CD 好了就放）
// 通常就是最优；原先唯一的角色候选 `self + enrage is_active` 恒假（暴走只挂在怪物
// 身上，见 damageCandidates 上方的说明），会让光环永不释放，已移除。
//
// 为什么**不**补「光环未生效时释放」这条单条件（2026-09-21 §25 复核）：光环类技能的
// `defaultCombatTriggers` 本身就是 `self + 〈自身光环〉 + is_inactive`
// （mystic_aura / guardian_aura / elemental_affinity / fierce_aura / speed_aura 实测都是这一条，
// 见 abilityDetailMap），而 generateAbilityCandidates 会做「与游戏默认行为等价」的去重
// ⇒ 补出来的候选会被逐字去重掉，纯属空转。光环真正缺的不是这条语义（默认锚点已经带着它），
// 而是**组合**里的守卫维度（见 compositeCandidates 的 AURA 分支）。
// 光环的**组合**候选见 compositeCandidates（不需要绝对值，始终可用）。
function auraCandidates() {
  return [];
}

// ── 合取组合候选（2026-09-17 新增）─────────────────────────────────────────
// 引擎语义（combatsimulator/ability.js 102-109）：
//   let shouldTrigger = true;
//   for (const trigger of this.triggers) {
//     if (!trigger.isActive(source, target, friendlies, enemies, currentTime)) shouldTrigger = false;
//   }
//   return shouldTrigger;
//   ⇒ **多条触发器之间是 AND**（全部满足才释放），不是 OR。这是本轮实现前才确认的
//     契约，设计文档此前只记录了四态语义、从未提到 AND/OR。
//
// 所以组合候选只能表达「既要…又要…」，而这恰好覆盖了单条件候选表达不了的、收益最
// 明显的一类时机控制：
//   · 「敌方残血」且「自身蓝量充足」→ 大招收尾，但不把蓝榨干（防空蓝崩盘）
//   · 「队友残血」且「自身蓝量充足」→ 治疗/护盾不把自己抽空
//   · 「增益失效」且「自身血量健康」→ 补增益，不在残血时抢治疗的蓝
//   ⇒ 上一版只给「单一条件」候选，是「候选空间塌缩、效果不显著」的成因之一。
//
// 依赖分层（重要）：
//   · 需要绝对值换算（maxMp/maxHp）的组合只在 resources 可用时产出；
//   · 不需要绝对值的组合（number_of_active_units / lowest_hp_percentage /
//     is_inactive）始终产出 —— 保证「没读到角色战斗属性」时仍有组合候选可搜，
//     不会退化成「只剩默认 + 立即释放两个锚点」。
function buildManaGuard(ctx) {
  for (const percent of ctx.thresholds.compositeMpPercent) {
    const value = percentToAbsolute(percent, ctx.maxMp, Math.ceil);
    if (value === null) continue;
    const trigger = buildTriggerDto(DEPENDENCY_SELF, CONDITION_CURRENT_MP, COMPARATOR_GTE, value);
    if (trigger) return { trigger, percent };
  }
  return null;
}

function compositeCandidates(ctx) {
  const descriptors = [];
  const mpGuard = buildManaGuard(ctx);
  // 「敌人数 ≥ N」腿的波上限自守（2026-09-21 §25）：单怪图里恒假 → 返回 null，
  // 由 push 的 null 判定整条组合候选被丢弃（push 要求两条腿都非空）。
  const compositeWaveSize = Math.floor(toFiniteNumber(isPlainObject(ctx.enemyHp) ? ctx.enemyHp.waveSize : 0, 0));
  // 「本技能的 buff 失效」组合项：依赖与条件侧别必须一致（设计 §23）——
  // self 配自身侧（BUFF/AURA 角色）、targeted_enemy 配目标侧（DEBUFF 角色）。
  // 侧别错配（例如给敌人挂减益的技能用 self）读的是施法者身上不存在的 buff，恒假。
  const ownBuffInactive = (dependencyHrid, side) => {
    const condition = firstOwnCondition(ctx.definition, side);
    return condition ? buildTriggerDto(dependencyHrid, condition, COMPARATOR_IS_INACTIVE) : null;
  };
  const activeUnit = (count) =>
    isMeaningfulActiveUnitThreshold(count, compositeWaveSize)
      ? buildTriggerDto(DEPENDENCY_ALL_ENEMIES, CONDITION_NUMBER_OF_ACTIVE_UNITS, COMPARATOR_GTE, count)
      : null;
  // 「目标残血」也是**敌方血量**口径：与 damageCandidates 的斩杀线同源（enemyHp.min），
  // 不再用玩家 maxHp 近似——旧口径对 500 血的小怪算出 439 的「残血线」≈ 恒真。
  const enemyLowHp = (percent) => {
    const smallHp = isPlainObject(ctx.enemyHp) ? ctx.enemyHp.min : null;
    const value = enemyHpThreshold(percent, smallHp);
    if (value === null || !isMeaningfulEnemyHpThreshold(COMPARATOR_LTE, value, smallHp)) return null;
    return buildTriggerDto(DEPENDENCY_TARGETED_ENEMY, CONDITION_CURRENT_HP, COMPARATOR_LTE, value);
  };
  const selfLowHp = (percent) => {
    const value = percentToAbsolute(percent, ctx.maxHp, Math.floor);
    return value === null ? null : buildTriggerDto(DEPENDENCY_SELF, CONDITION_CURRENT_HP, COMPARATOR_LTE, value);
  };
  const selfMissingHp = (percent) => {
    const value = percentToAbsolute(percent, ctx.maxHp, Math.ceil);
    return value === null ? null : buildTriggerDto(DEPENDENCY_SELF, CONDITION_MISSING_HP, COMPARATOR_GTE, value);
  };
  const allyLowHp = (percent) =>
    buildTriggerDto(
      DEPENDENCY_ALL_ALLIES,
      CONDITION_LOWEST_HP_PERCENTAGE,
      COMPARATOR_LTE,
      Math.max(1, Math.min(100, Math.round(percent))),
    );
  // 同一 condition 出现两次等于自我矛盾（current_hp <= 50 且 <= 75 → 等价于 <= 50），
  // 会让候选与单条件候选重复，浪费一场模拟。直接拒绝。
  const push = (first, second, labelKey, labelParams) => {
    if (!first || !second || first.conditionHrid === second.conditionHrid) return;
    descriptors.push({ triggers: [first, second], labelKey, labelParams: labelParams || {} });
  };
  const guardParams = mpGuard ? { mpPercent: mpGuard.percent } : {};

  switch (ctx.role) {
    case TRIGGER_OPTIMIZER_ROLE_DAMAGE: {
      // 三条都需要绝对值（maxHp 或 maxMp）：资源不可用时**不硬凑**——凑出来的组合会
      // 与单条件候选重复（浪费一场模拟），或落到恒定真/假的条件上（等于废掉该技能）。
      push(
        enemyLowHp(ctx.thresholds.executePercent[0]),
        mpGuard?.trigger,
        TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.compositeExecuteGuard,
        {
          percent: ctx.thresholds.executePercent[0],
          ...guardParams,
        },
      );
      push(
        activeUnit(ctx.thresholds.activeUnits[0]),
        mpGuard?.trigger,
        TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.compositeManyEnemiesGuard,
        {
          count: ctx.thresholds.activeUnits[0],
          ...guardParams,
        },
      );
      push(
        selfLowHp(ctx.thresholds.damageHpPercent[0]),
        mpGuard?.trigger,
        TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.compositeLowHpGuard,
        {
          percent: ctx.thresholds.damageHpPercent[0],
          ...guardParams,
        },
      );
      // 跨技能增益门 × AOE 窗口（2026-09-19 新增，设计 §18.3）：增益在且这一波怪够厚才放。
      // 两个前提缺一不可（增益来自其他已佩戴技能、能读到敌方血量尺度），任一缺失整条跳过 ——
      // 与上方三条「不硬凑」的口径一致：凑出来的组合要么与单条件候选重复，要么落到恒真/恒假上。
      const buffWindowCondition = (ctx.otherBuffConditions || [])[0];
      const groupTrigger =
        buffWindowCondition && isPlainObject(ctx.enemyHp)
          ? (() => {
              const value = enemyHpThreshold(ctx.thresholds.enemyGroupHpPercent[0], ctx.enemyHp.group);
              if (value === null || !isMeaningfulEnemyHpThreshold(COMPARATOR_GTE, value, ctx.enemyHp.max)) {
                return null;
              }
              return buildTriggerDto(DEPENDENCY_ALL_ENEMIES, CONDITION_CURRENT_HP, COMPARATOR_GTE, value);
            })()
          : null;
      if (buffWindowCondition && groupTrigger) {
        push(
          buildTriggerDto(DEPENDENCY_SELF, buffWindowCondition, COMPARATOR_IS_ACTIVE),
          groupTrigger,
          TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.compositeBuffWindowGroupHp,
          { conditionHrid: buffWindowCondition, value: groupTrigger.value },
        );
      }
      break;
    }
    case TRIGGER_OPTIMIZER_ROLE_BUFF: {
      const buff = ownBuffInactive(DEPENDENCY_SELF, CONDITION_SIDE_SELF);
      push(buff, mpGuard?.trigger, TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.compositeBuffRefreshGuard, guardParams);
      push(
        buff,
        selfLowHp(ctx.thresholds.buffHpPercent[0]),
        TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.compositeBuffRefreshLowHp,
        {
          percent: ctx.thresholds.buffHpPercent[0],
        },
      );
      break;
    }
    case TRIGGER_OPTIMIZER_ROLE_DEBUFF: {
      const debuff = ownBuffInactive(DEPENDENCY_TARGETED_ENEMY, CONDITION_SIDE_TARGET);
      // 「减益掉了且多目标」不需要绝对值 → 即使读不到战斗属性也始终可用。
      push(
        debuff,
        activeUnit(ctx.thresholds.activeUnits[0]),
        TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.compositeDebuffMultiple,
        {
          count: ctx.thresholds.activeUnits[0],
        },
      );
      push(debuff, mpGuard?.trigger, TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.compositeDebuffRefreshGuard, guardParams);
      break;
    }
    case TRIGGER_OPTIMIZER_ROLE_DEFENSE:
    case TRIGGER_OPTIMIZER_ROLE_HEALING: {
      push(
        allyLowHp(ctx.thresholds.allyLowHpPercent[0]),
        mpGuard?.trigger,
        TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.compositeAllyLowHpGuard,
        {
          percent: ctx.thresholds.allyLowHpPercent[0],
          ...guardParams,
        },
      );
      push(
        selfMissingHp(ctx.thresholds.missingHpPercent[0]),
        mpGuard?.trigger,
        TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.compositeMissingHpGuard,
        {
          percent: ctx.thresholds.missingHpPercent[0],
          ...guardParams,
        },
      );
      break;
    }
    case TRIGGER_OPTIMIZER_ROLE_AURA: {
      // 「光环未生效且队友残血」不需要绝对值 → 始终可用。
      // 这条填上了上一版的空白：光环角色此前一条角色候选都没有（只剩两个锚点），
      // 等于「光环技能无法被优化」。
      const buff = ownBuffInactive(DEPENDENCY_SELF, CONDITION_SIDE_SELF);
      push(
        buff,
        allyLowHp(ctx.thresholds.allyLowHpPercent[0]),
        TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.compositeAuraRefreshAllyLowHp,
        {
          percent: ctx.thresholds.allyLowHpPercent[0],
        },
      );
      push(
        buff,
        selfLowHp(ctx.thresholds.buffHpPercent[0]),
        TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.compositeBuffRefreshLowHp,
        {
          percent: ctx.thresholds.buffHpPercent[0],
        },
      );
      // 「光环失效且蓝量充足」（2026-09-21 新增，设计 §25）：与 BUFF 角色的同名组合对齐。
      // 光环是长 CD 常驻增益，「掉了就补、但别把蓝榨干」是用户手工配置里的常见写法
      // （丛林夹具的 mystic_aura 当前配置正是 `光环失效 且 蓝量 ≥ 500`），而生成器此前只给
      // BUFF 角色产这条 —— 光环槽真正缺的守卫维度就是它（见 auraCandidates 上方的说明）。
      push(buff, mpGuard?.trigger, TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.compositeBuffRefreshGuard, guardParams);
      break;
    }
    default:
      break;
  }
  return descriptors;
}

const ROLE_CANDIDATE_BUILDERS = {
  [TRIGGER_OPTIMIZER_ROLE_DAMAGE]: damageCandidates,
  [TRIGGER_OPTIMIZER_ROLE_BUFF]: buffCandidates,
  [TRIGGER_OPTIMIZER_ROLE_DEBUFF]: debuffCandidates,
  [TRIGGER_OPTIMIZER_ROLE_DEFENSE]: defenseCandidates,
  [TRIGGER_OPTIMIZER_ROLE_HEALING]: healingCandidates,
  [TRIGGER_OPTIMIZER_ROLE_AURA]: auraCandidates,
  [TRIGGER_OPTIMIZER_ROLE_UNKNOWN]: () => [],
};

// 把 descriptor 固化成候选：跑 sanitizeTriggerList 自查（非法条目会被静默丢弃，
// 丢弃后长度变化即拒绝该候选），签名由 sanitize 后的内容决定。
function finalizeCandidate(slotIndex, abilityHrid, role, descriptor, distance) {
  const triggers = descriptor.triggers === null || descriptor.triggers === undefined ? null : descriptor.triggers;
  if (triggers !== null) {
    const sanitized = sanitizeTriggerList(triggers);
    if (sanitized.length !== triggers.length) return null;
    return {
      slotIndex,
      abilityHrid,
      role,
      state: sanitized.length === 0 ? 'disabled' : 'custom',
      triggers: sanitized,
      signature: buildTriggerCandidateSignature(sanitized),
      labelKey: descriptor.labelKey,
      labelParams: descriptor.labelParams || {},
      distance,
    };
  }
  return {
    slotIndex,
    abilityHrid,
    role,
    state: 'default',
    triggers: null,
    signature: buildTriggerCandidateSignature(null),
    labelKey: descriptor.labelKey,
    labelParams: descriptor.labelParams || {},
    distance,
  };
}

// 候选物化（sanitize 自查 + 签名去重）：角色候选与精炼候选共用同一份口径。
// seen 是调用方持有的签名集合，物化过的签名会写回，因此同一槽内不会出现两条
// 同签名的候选（不同生成路径产出重复配置时只保留第一条）。
function materializeCandidates(ctx, descriptors, seen) {
  const candidates = [];
  for (const descriptor of descriptors) {
    const candidate = finalizeCandidate(ctx.slotIndex, ctx.abilityHrid, ctx.role, descriptor, descriptor.distance);
    if (!candidate) continue;
    if (seen.has(candidate.signature)) continue;
    seen.add(candidate.signature);
    candidates.push(candidate);
  }
  return candidates;
}

// 家族交错（2026-09-24，设计 §39-A）：candidateLimit 的截断保留规则从「纯价值顺序丢尾部」
// 改为「按 labelKey 家族 round-robin 取代表」——每族首条优先进 top-N（轮 1），同族第 2 条排在
// 所有族首条之后（轮 2），以此类推；族内保持生成序（= 价值顺序），族间顺序 = 各族首条的生成顺序。
// 动机（§34 / §39 实测）：熊熊星球 T0 的 firestorm 真最优 deadUnitsAtMost{0} 按旧规则排生成第
// 12 条，默认上限 10 整族被截断（Δ = −0.03236）——「价值顺序」先验在真实场景并不总成立；家族
// 交错以零评估成本保住每族的入场券。锚点（default/current/alwaysFire）是各自家族的首条且生成序
// 在最前，天然保留原位。
// 族键 = labelKey + conditionHrid（2026-09-24 实测修正）：同标签**不同条件**的窗口候选
// （buffWindow 的 guardian_aura / berserk / frenzy 三个窗口）是三个不同方向，各占一族；
// 同方向的多档位（lowHp{50,75}、enemyGroupHp{25%,50%}、deadUnitsAtLeast{1,2}）仍归同族轮转
// —— 第 2 档位的优先级天然低于其它方向的第 1 档。
function interleaveCandidatesByFamily(candidates) {
  const families = new Map();
  for (const candidate of candidates) {
    const key = `${String(candidate?.labelKey ?? '')}|${String(candidate?.labelParams?.conditionHrid ?? '')}`;
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(candidate);
  }
  const queues = [...families.values()];
  const ordered = [];
  while (queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const candidate = queue.shift();
      if (candidate) ordered.push(candidate);
    }
  }
  return ordered;
}

// 候选去重（按签名）+ 上限：锚点优先保留，超出的候选按**家族交错**顺序截断（§39-A，
// 保证 top-N 覆盖每个候选家族的代表，而不是把整族尾部静默丢掉）。
// existingSignatures 用于「已物化候选」的去重预填（精炼路径复用本函数时传入）。
//
// 统计版（2026-09-23，设计 §28）：把「物化去重后有多少条」与「上限」一起回传 —— 截断是
// 静默丢候选（§22.3/§23.4 实测过「新族挤掉旧族」），UI 必须能说出「本槽另有 N 条未评估」，
// 否则用户看到「8 个候选」会以为搜索试遍了所有可能。generated 是**过上限之前**的条数。
function finalizeCandidatesWithStats(ctx, descriptors, existingSignatures = []) {
  const seen = new Set(
    (Array.isArray(existingSignatures) ? existingSignatures : [])
      .map((signature) => String(signature ?? ''))
      .filter((signature) => signature.length > 0),
  );
  const materialized = interleaveCandidatesByFamily(materializeCandidates(ctx, descriptors, seen));
  const limit = Math.max(0, ctx.candidateLimit || 0);
  return { candidates: materialized.slice(0, limit), generated: materialized.length, limit };
}

function finalizeCandidates(ctx, descriptors, existingSignatures = []) {
  return finalizeCandidatesWithStats(ctx, descriptors, existingSignatures).candidates;
}

// 单技能槽候选生成（设计 §8.1 的 generateAbilityCandidates）。
//
// 统计版（2026-09-23，设计 §28）：返回 { candidates, generated, limit } —— generated 是
// **过 candidateLimit 之前**的候选条数（已过 sanitize 自查 + 签名去重），limit 是本次生效的
// 每槽候选上限。截断数 = generated − candidates.length，报告把它带给 UI 明示
// 「本槽另有 N 条未评估」。对外契约不变：generateAbilityCandidates 仍只返回数组。
export function generateAbilityCandidatesDetailed(player, slotIndex, settings = {}) {
  const ability = player?.abilities?.[slotIndex];
  const abilityHrid = String(ability?.abilityHrid || '');
  if (!abilityHrid || !isAbilitySlotActive(player, slotIndex)) {
    return { candidates: [], generated: 0, limit: 0 };
  }
  const definition = resolveAbilityDefinition(abilityHrid);
  if (!definition) {
    return { candidates: [], generated: 0, limit: 0 };
  }

  const resolved = resolveCandidateSettings(settings);
  const role = classifyAbilityRole(abilityHrid);
  const currentList = player?.triggerMap?.[abilityHrid];
  const ctx = {
    slotIndex,
    abilityHrid,
    definition,
    role,
    currentList,
    // 跨技能窗口条件（设计 §18.3 / §23）：其他已佩戴技能的 buff 条件，按 buff 落点分侧。
    //   otherBuffConditions → 自身侧（self / allAllies），配 self 依赖（增益门）
    //   otherDebuffConditions → 目标侧（enemy / allEnemies），配 targeted_enemy 依赖（减益窗口）
    otherBuffConditions: resolveCrossSkillConditions(player, slotIndex, CONDITION_SIDE_SELF),
    otherDebuffConditions: resolveCrossSkillConditions(player, slotIndex, CONDITION_SIDE_TARGET),
    ...resolved,
  };

  const descriptors = [
    { triggers: null, labelKey: TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.default, distance: DISTANCE_ANCHOR },
  ];
  // 当前配置若已是自定义（非默认、非空），作为锚点保留——它是 coordinate descent
  // 的起点，也是「不改动」的兜底。
  if (Array.isArray(currentList) && currentList.length > 0) {
    descriptors.push({
      triggers: currentList,
      labelKey: TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.current,
      distance: DISTANCE_ANCHOR,
    });
  }
  descriptors.push({
    triggers: [],
    labelKey: TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.alwaysFire,
    distance: DISTANCE_ALWAYS,
  });
  const builder = ROLE_CANDIDATE_BUILDERS[role] || ROLE_CANDIDATE_BUILDERS[TRIGGER_OPTIMIZER_ROLE_UNKNOWN];
  const roleSingles = builder(ctx).map((descriptor) => ({ ...descriptor, distance: DISTANCE_CUSTOM }));
  const roleComposites = compositeCandidates(ctx).map((descriptor) => ({
    ...descriptor,
    distance: DISTANCE_COMPOSITE,
  }));
  // 单条件与组合**交错**上位：candidateLimit 截断时两类都必有代表。
  // 上一版把角色候选一股脑追加再截断，靠后的候选会被整批静默丢掉——新增组合候选
  // 若沿用追加顺序，会在默认上限下一条都进不来（组合候选永远排在最末）。
  const maxRoleCandidates = Math.max(roleSingles.length, roleComposites.length);
  for (let index = 0; index < maxRoleCandidates; index += 1) {
    if (roleSingles[index]) descriptors.push(roleSingles[index]);
    if (roleComposites[index]) descriptors.push(roleComposites[index]);
  }

  // 行为等价去重（2026-09-18）：与「游戏默认」锚点行为等价的候选不该再评估一遍——
  // 指标必然一模一样，纯属浪费一场模拟（数值档位与默认值撞车、恒真阈值都属于这类；
  // 恒真阈值现在已经在生成阶段被 isMeaningfulEnemyHpThreshold 拦掉）。默认触发器列表
  // 由 triggerMapper 自己解析（与引擎注入同源）。
  // 默认列表为空（'[]'）时不加进去重集：那说明该技能的默认就等价于「立即释放」，
  // 两个锚点本就重复，此时保留原样的双锚点（UI 文案与既有断言都不变），不去动它。
  const defaultSignature = buildTriggerCandidateSignature(getDefaultTriggerDtosForHrid(abilityHrid));
  const dedupSignatures = defaultSignature && defaultSignature !== '[]' ? [defaultSignature] : [];
  return finalizeCandidatesWithStats(ctx, descriptors, dedupSignatures);
}

export function generateAbilityCandidates(player, slotIndex, settings = {}) {
  return generateAbilityCandidatesDetailed(player, slotIndex, settings).candidates;
}

// 全量候选生成：遍历已装备技能槽（含特殊技能槽 0），产出 perAbilityChoices。
// 空槽、被智力闸门挡住的槽、未知 hrid 一律跳过（引擎根本不会释放这些技能）。
// settings.lockedAbilityHrids 命中的技能仍产出候选（UI 要展示它当前配置），但带
// locked:true 标记，搜索引擎会跳过——这是用户「锁定已满意的技能再优化其余」的入口。
export function buildCandidateConfigs(player, settings = {}) {
  const source = isPlainObject(player) ? player : {};
  const abilities = Array.isArray(source.abilities) ? source.abilities : [];
  const resolved = resolveCandidateSettings(settings);
  const lockedHrids = new Set(
    (Array.isArray(settings?.lockedAbilityHrids) ? settings.lockedAbilityHrids : []).map((hrid) => String(hrid)),
  );
  const choices = [];
  const slotCount = Math.min(abilities.length, ABILITY_SLOT_COUNT);
  for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
    const ability = abilities[slotIndex];
    const abilityHrid = String(ability?.abilityHrid || '');
    if (!abilityHrid || !isAbilitySlotActive(source, slotIndex)) continue;
    const definition = resolveAbilityDefinition(abilityHrid);
    if (!definition) continue;
    const role = classifyAbilityRole(abilityHrid);
    // 用带统计的版本：报告要能说出「本槽另有 N 条因每槽候选上限未评估」（设计 §28）。
    const { candidates, generated, limit } = generateAbilityCandidatesDetailed(source, slotIndex, resolved);
    if (!candidates.length) continue;
    choices.push({
      slotIndex,
      abilityHrid,
      role,
      roleLabelKey: TRIGGER_OPTIMIZER_ROLE_LABEL_KEYS[role],
      locked: lockedHrids.has(abilityHrid),
      candidates,
      candidateLimit: limit,
      generatedCandidates: generated,
      // 截断数：0 = 候选表完整（UI 不显示提示）。
      truncatedCandidates: Math.max(0, generated - candidates.length),
    });
  }
  return choices;
}

// ── 自适应阈值精炼（2026-09-18 新增）─────────────────────────────────────────
// 固定阈值网格（TRIGGER_OPTIMIZER_DEFAULT_THRESHOLDS：50/75/90…）粒度太粗：真实
// 最优阈值常落在格点之间（例如 62%），网格永远搜不到它——这是「找不到最优触发」
// 的主因。全量加密网格会让候选数爆炸（每个数值槽 ×5），而精炼只对**已被采纳的
// 单条件数值类候选**做一次邻域搜索：模拟成本只花在已证明有改进的槽上。
//
// 触发条件（buildRefinementCandidates）：
//   · winner 恰好 1 条触发器（组合候选有 2 条，精炼其中一条会改变另一条的语义，
//     不碰）；
//   · 标签带 {{percent}} / {{count}} 插值参数 —— labelParams 是百分比的唯一精确
//     来源（绝对值经取整后无法无损反推），且 UI 已支持这些插值，无需新增 i18n key。
//
// 邻域口径（与角色候选生成器逐一对应，保证精炼值与网格值在同一尺度上）：
//   · 百分比类（current/missing hp、mp）：±步长 个百分点（步长随精炼层级减半，见下），
//     clamp 到 [5,95]（0%/100% 会退化成「恒不触发/恒触发」），再用 resources 的
//     maxHp/maxMp 换算绝对值，取整方式与该标签的生成器一致；
//   · lowest_hp_percentage：本身即百分比，不需要资源换算；
//   · number_of_active_units：计数 ±1，clamp 到 [2, min(8, waveSize)]（下界 2 是因为
//     GTE 1 恒真 = 立即释放，与 [] 候选等价，属于退化配置；上界随区域波上限收紧，
//     2026-09-21 §25 —— ≥ waveSize + 1 恒假，与生成阶段同一套自守。上界低于 2
//     （单怪图 waveSize = 1）→ 该族没有合法邻域，不产出）；
//   · number_of_dead_units（波内进度，2026-09-20 新增 §22.4）：计数 ±1，但合法区间由
//     **区域一波怪的上限人数**（enemyHp.waveSize）决定 —— ≥ 类 [1, waveSize−1]、
//     ≤ 类 [0, waveSize−2]（≥ waveSize 恒假、≤ waveSize−1 恒真，都是退化配置，与
//     生成阶段的同一套自守规则）。读不到 waveSize（资源降级）时不精炼：不能凭空造出
//     越界阈值。
//   · executeHp / enemyGroupHp / enemyTargetHp（敌方血量类，2026-09-21 新增 §24）：阈值
//     本身就是「百分比 × 敌方血量尺度」，步长 = 同一把「百分点」尺子（±10 / level≥1
//     ±5），尺度由标签决定（group vs min）；同样过生成阶段的自守
//     isMeaningfulEnemyHpThreshold。这些标签的插值是绝对值 {{value}}（没有 percent），
//     百分比从「value ÷ 尺度」反推，物化时仍写回 { value }（标签契约不变）。
//
// 多级精炼（B2，2026-09-19 落地）：搜索层会在「上一级精炼候选被采纳」后带着更大的
// level 再调一次本函数。步长随层级减半直到下限 5：网格 25 → 10（level 0）→ 5（level ≥1）。
// 「~5」是目标粒度 —— 再细的阈值差异已低于逐轮抽样噪声，成本却不会少（每次评估 =
// rounds 场模拟）。计数类不随层级变化：±1 已是最细的整数粒度。
//
// 2026-09-24 实测（设计 §32）：把下限放开成二分（10 → 5 → 2 → 1）**没有提升**，故不改口径 ——
// 现实起点（家族真实网格候选）上两条步长序列的终值逐样本完全一致（1000 样本配对差 0.00000），
// 全起点样本上 5 次决策样本时也完全一致、2 次时二分反而略差（t = −9.8 / −11.3）。根因是
// **行走很少启动**（走到 level ≥2 的比例 ≤ 8%，而步长差异只在 level ≥2 才生效），不是下限的问题。
const REFINEMENT_PERCENT_STEP = 10;
const REFINEMENT_PERCENT_STEP_FLOOR = 5;
const REFINEMENT_PERCENT_MIN = 5;
const REFINEMENT_PERCENT_MAX = 95;
const REFINEMENT_COUNT_MIN = 2;
const REFINEMENT_COUNT_MAX = 8;
// 波内进度类（deadUnitsAtLeast / deadUnitsAtMost）的邻域 clamp：下界逐族固定，上界由
// 区域一波怪的上限人数推出来（waveSizeDelta：≥ 类到 waveSize−1，≤ 类到 waveSize−2）——
// 不能复用 number_of_active_units 的 [2,8]（那是「同时存在几只怪」的网格边界，对死怪数
// 是越界值：≤ 0 是合法网格点，≥ waveSize 是恒假配置）。
const REFINE_DEAD_UNIT_SPECS = {
  [TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.deadUnitsAtMost]: { min: 0, waveSizeDelta: -2 },
  [TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.deadUnitsAtLeast]: { min: 1, waveSizeDelta: -1 },
};

function refinementPercentStep(level) {
  const normalized = Number.isFinite(Number(level)) ? Math.max(0, Math.floor(Number(level))) : 0;
  return Math.max(REFINEMENT_PERCENT_STEP_FLOOR, REFINEMENT_PERCENT_STEP / 2 ** normalized);
}

// 「敌人数」精炼的上界（2026-09-21 新增，设计 §25）：读数可用时取 min(8, waveSize) ——
// ≥ waveSize + 1 恒假（一波最多刷 waveSize 只怪），与生成阶段 isMeaningfulActiveUnitThreshold
// 同一套自守；读不到（资源降级）时保持网格边界 8（无据不过滤）。
function refinementActiveUnitUpperBound(resources) {
  const enemyHp = resources?.enemyHp;
  const waveSize = Math.floor(toFiniteNumber(isPlainObject(enemyHp) ? enemyHp.waveSize : 0, 0));
  return waveSize >= 1 ? Math.min(REFINEMENT_COUNT_MAX, waveSize) : REFINEMENT_COUNT_MAX;
}

// 带百分比的标签 → 绝对值换算口径（资源池 + 取整方式，与角色候选生成器逐一对应：
// lowHp 用 maxHp+floor、missingHp 用 maxHp+ceil、lowMp 用 maxMp+floor、missingMp 用
// maxMp+ceil）。
const REFINE_PERCENT_SPECS = {
  [TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.lowHp]: { resourceKey: 'maxHp', rounding: Math.floor },
  [TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.missingHp]: { resourceKey: 'maxHp', rounding: Math.ceil },
  [TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.lowMp]: { resourceKey: 'maxMp', rounding: Math.floor },
  [TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.missingMp]: { resourceKey: 'maxMp', rounding: Math.ceil },
};

// 敌方血量类标签 → 尺度与自守上界（2026-09-21 新增，设计 §24）。
// 「阈值步长 = 怪物血量的百分之几」这一步长口径就落在这里：阈值 = 百分比 × 尺度，
// 与生成器的 enemyHpThreshold(percent, scale) 同源（取整方式也一致：Math.round + 下限 1）。
//   · scaleKey   ：换算用的血量尺度 —— enemyGroupHp 是**一整波怪的总血量**（group，
//                  AOE 的「这波还剩多少血」），enemyTargetHp / executeHp 是**小怪血量**（min，
//                  单体目标的「够不够厚 / 够不够残」）；
//   · ceilingKey ：阈值合法上界，必须与生成阶段的 isMeaningfulEnemyHpThreshold 调用完全一致
//                  （GTE：value ≤ 上界；LTE：value < 上界）——enemyGroupHp 的上界是
//                  enemyHp.max（BOSS 血量），另外两条的上界就是 min 本身（目标血量不可能超过
//                  小怪尺度，否则对满血怪恒真/恒假）。
const REFINE_ENEMY_HP_SPECS = {
  [TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.enemyGroupHp]: { scaleKey: 'group', ceilingKey: 'max' },
  [TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.enemyTargetHp]: { scaleKey: 'min', ceilingKey: 'min' },
  [TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.executeHp]: { scaleKey: 'min', ceilingKey: 'min' },
};

function refinementResourceValue(resources, resourceKey) {
  const value = Number(resources?.[resourceKey]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// 敌方血量尺度/上界（resources.enemyHp.{min,max,group}）：读不到或 ≤ 0 视为不可用 ——
// 那时无法把百分比换算成合法阈值，整类不精炼（与生成阶段「资源降级 → 整类不生成」一致）。
function refinementEnemyHpValue(resources, key) {
  const enemyHp = resources?.enemyHp;
  const value = Number(isPlainObject(enemyHp) ? enemyHp[key] : NaN);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// 区域一波怪的**上限**人数（enemyHp.waveSize）：读不到或 < 2（单怪图）都视为不可用 ——
// 那时「波内进度」没有合法阈值可言（与生成阶段整族跳过的口径同源）。
function refinementWaveSize(resources) {
  const enemyHp = resources?.enemyHp;
  const value = Math.floor(toFiniteNumber(isPlainObject(enemyHp) ? enemyHp.waveSize : 0, 0));
  return value >= 2 ? value : null;
}

// 为「被采纳的单条件数值类候选」生成邻域 descriptor（未物化、未去重）。
// options.level 决定百分比步长（0 → ±10；≥1 → ±5，见 refinementPercentStep）。
// 返回空数组 = 该 winner 不可精炼（组合候选、锚点、buff/debuff 的 is_inactive
// 类非数值条件、或资源不可用时的绝对值类标签）。搜索层负责物化、签名去重与评估。
export function buildRefinementCandidates(winner, resources = {}, options = {}) {
  if (!isPlainObject(winner)) return [];
  const triggers = Array.isArray(winner.triggers) ? winner.triggers : null;
  if (!triggers || triggers.length !== 1) return [];
  const winnerTrigger = triggers[0];
  if (!isPlainObject(winnerTrigger)) return [];
  const dependency = String(winnerTrigger.dependencyHrid || '');
  const condition = String(winnerTrigger.conditionHrid || '');
  const comparator = String(winnerTrigger.comparatorHrid || '');
  const labelKey = String(winner.labelKey || '');
  const params = isPlainObject(winner.labelParams) ? winner.labelParams : {};
  const percentStep = refinementPercentStep(options?.level);

  const descriptors = [];
  const percentSpec = REFINE_PERCENT_SPECS[labelKey];
  // lowest_hp_percentage（allyLowHp）本身即百分比：不在 REFINE_PERCENT_SPECS 里，
  // 靠 condition 识别，不需要资源换算，读不到战斗属性也能精炼。
  const rawPercent = condition === CONDITION_LOWEST_HP_PERCENTAGE;
  if ((percentSpec || rawPercent) && Number.isFinite(Number(params.percent))) {
    const percent = Number(params.percent);
    if (rawPercent) {
      // 原始百分比（all_allies lowest_hp_percentage）：不需要绝对值换算，
      // 始终可精炼（即使读不到战斗属性）。
      for (const candidate of [percent - percentStep, percent + percentStep]) {
        const next = clamp(Math.round(candidate), REFINEMENT_PERCENT_MIN, REFINEMENT_PERCENT_MAX);
        if (next === Math.round(percent)) continue;
        const refined = buildTriggerDto(dependency, condition, comparator, next);
        if (refined) descriptors.push({ triggers: [refined], labelKey, labelParams: { percent: next } });
      }
    } else {
      // 绝对值类：资源不可用时无法换算，直接放弃（与角色候选生成器的降级口径一致）。
      const max = refinementResourceValue(resources, percentSpec.resourceKey);
      if (max === null) return descriptors;
      for (const candidate of [percent - percentStep, percent + percentStep]) {
        const next = clamp(candidate, REFINEMENT_PERCENT_MIN, REFINEMENT_PERCENT_MAX);
        if (next === percent) continue;
        const value = percentToAbsolute(next, max, percentSpec.rounding);
        if (value === null) continue;
        const refined = buildTriggerDto(dependency, condition, comparator, value);
        if (refined) descriptors.push({ triggers: [refined], labelKey, labelParams: { percent: next } });
      }
    }
  } else if (labelKey === TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.manyEnemies && Number.isFinite(Number(params.count))) {
    // 计数 ±1，上界随区域一波怪的上限人数收紧（2026-09-21 §25）：≥ waveSize + 1 恒假
    // （与生成阶段同口径）；上界低于网格下界（单怪图 waveSize = 1 < 2）→ 该族没有合法邻域。
    const upper = refinementActiveUnitUpperBound(resources);
    const count = Math.round(Number(params.count));
    if (upper >= REFINEMENT_COUNT_MIN) {
      for (const candidate of [count - 1, count + 1]) {
        const next = clamp(Math.round(candidate), REFINEMENT_COUNT_MIN, upper);
        if (next === count) continue;
        const refined = buildTriggerDto(dependency, condition, comparator, next);
        if (refined) descriptors.push({ triggers: [refined], labelKey, labelParams: { count: next } });
      }
    }
  } else if (REFINE_DEAD_UNIT_SPECS[labelKey] && Number.isFinite(Number(params.count))) {
    // 波内进度类：±1 个死怪数，clamp 到该区域波上限人数决定的合法区间。读不到 waveSize
    // 直接不产出（与生成阶段「资源降级 → 整族不生成」一致：精炼不能凭空造越界阈值）。
    const waveSize = refinementWaveSize(resources);
    if (waveSize === null) return descriptors;
    const spec = REFINE_DEAD_UNIT_SPECS[labelKey];
    const count = Math.round(Number(params.count));
    for (const candidate of [count - 1, count + 1]) {
      const next = clamp(Math.round(candidate), spec.min, waveSize + spec.waveSizeDelta);
      if (next === count) continue;
      const refined = buildTriggerDto(dependency, condition, comparator, next);
      if (refined) descriptors.push({ triggers: [refined], labelKey, labelParams: { count: next } });
    }
  } else if (REFINE_ENEMY_HP_SPECS[labelKey] && Number.isFinite(Number(params.value))) {
    // 敌方血量类（2026-09-21 新增，设计 §24）：阈值 = 百分比 × 敌方血量尺度，步长复用同一把
    // 「百分点」尺子（level 0 → ±10pp、level ≥1 → ±5pp）；clamp [5,95] 后经生成器的
    // enemyHpThreshold 换算（Math.round + 下限 1），再过 isMeaningfulEnemyHpThreshold 自守
    // ——与「敌方血量类」候选生成阶段完全同一套口径，精炼不可能造出网格生成器不会产的值。
    // 标签插值是绝对值 {{value}}（没有 percent），所以百分比由 value ÷ 尺度反推；物化仍写
    // 回 { value }，与网格候选的标签契约保持一致（UI 无需改动）。
    const spec = REFINE_ENEMY_HP_SPECS[labelKey];
    const scale = refinementEnemyHpValue(resources, spec.scaleKey);
    const ceiling = refinementEnemyHpValue(resources, spec.ceilingKey);
    if (scale === null || ceiling === null) return descriptors;
    const current = Number(params.value);
    const percent = (current / scale) * 100;
    for (const candidate of [percent - percentStep, percent + percentStep]) {
      const next = clamp(candidate, REFINEMENT_PERCENT_MIN, REFINEMENT_PERCENT_MAX);
      if (next === percent) continue;
      const value = enemyHpThreshold(next, scale);
      if (value === null || value === current) continue;
      if (!isMeaningfulEnemyHpThreshold(comparator, value, ceiling)) continue;
      const refined = buildTriggerDto(dependency, condition, comparator, value);
      if (refined) descriptors.push({ triggers: [refined], labelKey, labelParams: { value } });
    }
  }
  return descriptors;
}

// 把精炼 descriptor 物化成候选，并对该槽已有候选按签名去重（网格内的阈值会被自然
// 跳过，精炼不会与已有候选重复）——「已走过的点」因此不会重复评估，这也是多级行走
// 的自然终止条件。options.level 透传给 buildRefinementCandidates（步长随级递减）。
// 搜索层在候选被采纳后按级调用本函数；返回空数组 = 无需（或已无可精炼的）精炼。
export function buildRefinedCandidates(winner, choice, resources = {}, options = {}) {
  if (!isPlainObject(choice)) return [];
  const descriptors = buildRefinementCandidates(winner, resources, options);
  if (descriptors.length === 0) return [];
  const ctx = { slotIndex: choice.slotIndex, abilityHrid: choice.abilityHrid, role: choice.role };
  const seen = new Set(
    (Array.isArray(choice.candidates) ? choice.candidates : [])
      .map((candidate) => (isPlainObject(candidate) ? String(candidate.signature ?? '') : ''))
      .filter((signature) => signature.length > 0),
  );
  return materializeCandidates(
    ctx,
    descriptors.map((descriptor) => ({ ...descriptor, distance: DISTANCE_REFINEMENT })),
    seen,
  );
}

export { ABILITY_SLOT_COUNT };

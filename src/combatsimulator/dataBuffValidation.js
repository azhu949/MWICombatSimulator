// 在模块加载时对战斗引擎从已检入数据文件中消费的每个增益进行形状校验。
// addBuff（combatUnit.js）在热路径上执行同样的检查，作为最后一道防线；
// 本模块将失败点提前，因此损坏的数据更新（例如缺少 `duration` 的增益）
// 会在启动/测试时被捕获，而不是在战斗中才中止正在运行的模拟。
//
// 覆盖范围：
//   - abilityDetailMap.json   — 所有技能的增益效果（包括队伍光环，
//                               它们还在 buffSourcePolicy.js 中额外有更强的
//                               快照断言）
//   - itemDetailMap.json      — 消耗品（食物/饮料）增益
// 战斗卷轴在构造时由 getCombatScrollBuffTemplate（combatScrolls.js）校验；
// 诅咒/狂暴/虚弱/激怒增益在 combatSimulator.js 中内联构造，
// 不随游戏数据更新而变化。
import abilityDetailMap from './data/abilityDetailMap.json';
import itemDetailMap from './data/itemDetailMap.json';

const BUFF_EFFECT_TYPE_HRID = '/ability_effect_types/buff';

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 校验一条增益记录是否符合 addBuff 依赖的形状。抛出
 * TypeError，列出违规字段并附带数据路径上下文字符串。
 */
export function validateBuffShape(buff, context) {
  const problems = [];
  if (!isNonEmptyString(buff?.uniqueHrid)) {
    problems.push('uniqueHrid');
  }
  if (!isNonEmptyString(buff?.typeHrid)) {
    problems.push('typeHrid');
  }
  if (!isFiniteNumber(buff?.ratioBoost)) {
    problems.push('ratioBoost');
  }
  if (!isFiniteNumber(buff?.flatBoost)) {
    problems.push('flatBoost');
  }
  if (!isFiniteNumber(buff?.duration)) {
    problems.push('duration');
  }
  if (problems.length > 0) {
    throw new TypeError(`Buff data shape invalid at ${context}: ${problems.join(', ')}`);
  }
}

export function collectAbilityBuffShapes(abilityMap = abilityDetailMap) {
  const failures = [];
  for (const [hrid, ability] of Object.entries(abilityMap ?? {})) {
    for (const [effectIndex, effect] of (ability?.abilityEffects ?? []).entries()) {
      if (effect?.effectType !== BUFF_EFFECT_TYPE_HRID) {
        continue;
      }
      for (const [buffIndex, buff] of (effect?.buffs ?? []).entries()) {
        try {
          validateBuffShape(buff, `ability ${hrid} effect[${effectIndex}] buff[${buffIndex}]`);
        } catch (error) {
          failures.push(error.message);
        }
      }
    }
  }
  return failures;
}

export function collectItemBuffShapes(itemMap = itemDetailMap) {
  const failures = [];
  for (const [hrid, item] of Object.entries(itemMap ?? {})) {
    const buffs = item?.consumableDetail?.buffs ?? item?.buffs;
    if (!Array.isArray(buffs)) {
      continue;
    }
    for (const [buffIndex, buff] of buffs.entries()) {
      try {
        validateBuffShape(buff, `item ${hrid} buff[${buffIndex}]`);
      } catch (error) {
        failures.push(error.message);
      }
    }
  }
  return failures;
}

/**
 * 断言每个已检入的技能/消耗品增益记录都具备战斗引擎
 * 消费所需的形状。可注入的映射使失败报告和单元测试
 * 与随附的数据文件相互独立。
 */
export function assertBuffShapesValid({ abilityMap = abilityDetailMap, itemMap = itemDetailMap } = {}) {
  const failures = [...collectAbilityBuffShapes(abilityMap), ...collectItemBuffShapes(itemMap)];
  if (failures.length > 0) {
    throw new Error(
      `Checked-in buff data contains ${failures.length} malformed buff record(s). ` +
        `Fix the data files (or update this validation) before shipping:\n` +
        failures.map((failure) => `  - ${failure}`).join('\n'),
    );
  }
}

// 在模块加载时运行一次，使每个模拟/测试入口在战斗开始前
// 就能针对畸形增益数据快速失败。
assertBuffShapesValid();

import { describe, expect, it } from 'vitest';
import Trigger from '../trigger.js';

const SELF_DEPENDENCY_HRID = '/combat_trigger_dependencies/self';
const INVINCIBLE_CONDITION_HRID = '/combat_trigger_conditions/invincible';
const INVINCIBLE_BUFF_HRID = '/buff_uniques/invincible_armor';

function createInvincibleTrigger(comparator) {
  return new Trigger(SELF_DEPENDENCY_HRID, INVINCIBLE_CONDITION_HRID, `/combat_trigger_comparators/${comparator}`);
}

function createSource(hasInvincibleBuff) {
  return {
    combatBuffs: hasInvincibleBuff ? { [INVINCIBLE_BUFF_HRID]: { uniqueHrid: INVINCIBLE_BUFF_HRID } } : {},
  };
}

describe('Trigger invincible condition', () => {
  it.each([
    ['is_active', true, true],
    ['is_active', false, false],
    ['is_inactive', true, false],
    ['is_inactive', false, true],
  ])('evaluates %s with buff presence %s as %s', (comparator, hasInvincibleBuff, expected) => {
    const trigger = createInvincibleTrigger(comparator);

    expect(trigger.isActive(createSource(hasInvincibleBuff), null, [], [], 0)).toBe(expected);
  });
});

// 条件「侧别」（2026-09-21 新增，设计 §23）：同一个 buff 条件配 self 与 targeted_enemy
// 读的是**不同单位**的 combatBuffs —— self 读施法者自己（trigger.js 28-29），
// targeted_enemy 读当前目标（trigger.js 31-35，target 为空直接返回 false）。
// 敌人减益（puncture / fracturing_impact 等，技能定义 targetType = enemy / allEnemies，
// 由 combatSimulator 2038-2043 施加给被命中的敌人）只存在于敌人身上 ⇒ 配 self 恒假。
describe('Trigger condition side (self vs targeted_enemy)', () => {
  const PUNCTURE_CONDITION_HRID = '/combat_trigger_conditions/puncture';
  const PUNCTURE_BUFF_HRID = '/buff_uniques/puncture';
  const TARGETED_ENEMY_DEPENDENCY_HRID = '/combat_trigger_dependencies/targeted_enemy';

  const caster = { combatBuffs: {} };
  const puncturedEnemy = { combatBuffs: { [PUNCTURE_BUFF_HRID]: { uniqueHrid: PUNCTURE_BUFF_HRID } } };
  const cleanEnemy = { combatBuffs: {} };

  const createPunctureTrigger = (dependencyHrid, comparator) =>
    new Trigger(dependencyHrid, PUNCTURE_CONDITION_HRID, `/combat_trigger_comparators/${comparator}`);

  it('reads the caster for self and the target for targeted_enemy', () => {
    const selfTrigger = createPunctureTrigger(SELF_DEPENDENCY_HRID, 'is_active');
    const targetTrigger = createPunctureTrigger(TARGETED_ENEMY_DEPENDENCY_HRID, 'is_active');

    // 目标被破甲：只有 targeted_enemy 读得到 —— self 看的是施法者自己身上的 buff。
    expect(targetTrigger.isActive(caster, puncturedEnemy, [], [], 0)).toBe(true);
    expect(selfTrigger.isActive(caster, puncturedEnemy, [], [], 0)).toBe(false);

    // 目标没有减益：两者都假（self 恒假，因为减益永远不挂在施法者身上）。
    expect(targetTrigger.isActive(caster, cleanEnemy, [], [], 0)).toBe(false);
    expect(selfTrigger.isActive(caster, cleanEnemy, [], [], 0)).toBe(false);
  });

  it('returns false for targeted_enemy when there is no target (both comparators)', () => {
    const targetTrigger = createPunctureTrigger(TARGETED_ENEMY_DEPENDENCY_HRID, 'is_active');
    const targetInactive = createPunctureTrigger(TARGETED_ENEMY_DEPENDENCY_HRID, 'is_inactive');

    // 引擎在 target 为空时于求值前直接 return false（trigger.js 31-34），**不看比较符**：
    // 「目标未激活」也不会因此变成 true —— 目标不存在时该触发器一律不成立。
    expect(targetTrigger.isActive(caster, null, [], [], 0)).toBe(false);
    expect(targetInactive.isActive(caster, null, [], [], 0)).toBe(false);
  });
});

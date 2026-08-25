import { describe, expect, it } from 'vitest';
import Player from '../player.js';

// 守护 baseCombatStats 契约（参见 CombatUnit.baseCombatStats 与
// refreshBaseCombatStats）：任何对 combatDetails.combatStats.X 的直接写入都必须
// 通过 refreshBaseCombatStats 折回基准值，否则下一次
// updateCombatDetails 会通过 resetCombatStatsToBase 静默丢弃它。
describe('baseCombatStats contract (direct combatStats writes must be folded)', () => {
  it('clearCCs folds its damageTaken zeroing into the recalculation baseline', () => {
    const unit = new Player();
    const curse = {
      uniqueHrid: '/buff_uniques/clear_ccs_curse',
      typeHrid: '/buff_types/damage_taken',
      ratioBoost: 0,
      flatBoost: 0.04,
      duration: 1_000e9,
    };

    // 在 damage_taken（诅咒）增益生效期间反复重算，
    // 会把推导出的 0.04 沉淀到 baseCombatStats —— 正是战斗中
    // 清理控制效果（CC）时可能遇到的状态。
    unit.addBuff(curse, 0, 'attacker');
    unit.updateCombatDetails();
    expect(unit.combatDetails.combatStats.damageTaken).toBeCloseTo(0.04);
    expect(unit.baseCombatStats.damageTaken).toBeCloseTo(0.04);

    // clearCCs 将可见属性清零。其刷新必须把这个零值
    // 带入基准：否则之后的重算会先通过
    // resetCombatStatsToBase 复活被诅咒的值。
    unit.clearCCs();
    expect(unit.combatDetails.combatStats.damageTaken).toBe(0);
    expect(unit.baseCombatStats.damageTaken).toBe(0);

    // 折回的目的是保持基准干净，而非压制增益：当诅咒
    // 仍然生效时，重算会照常从增益重新推导该属性。
    unit.updateCombatDetails();
    expect(unit.combatDetails.combatStats.damageTaken).toBeCloseTo(0.04);
  });
});

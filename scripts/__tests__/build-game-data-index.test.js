import { describe, expect, it } from 'vitest';
import { resolveIsCombatInert } from '../build-game-data-index.mjs';

// 护符「战斗惰性」投影的语义锁定（2026-09-14 复核修正，取代原来的身份命名 isSkillingCharm）。
// 字段承诺的是引擎口径的产出——「引擎在战斗里读不到贡献 ⇒ 不作为战斗向选项出品（标记由选项
// 出品层消费）」，不承诺身份（「这是一条生活技能护符」）：真实数据里 60 条 combatStats 为空的生活
// 护符与身份恰好等价，但缺数据的未来战斗护符也会落到同一支，身份命名会把它误读成生活护符。
// 该兜底分支在真实数据下从不触达（shared/__tests__/gameDataIndex.charmOptions.test.js 与
// combatsimulator/__tests__/charmCombatNeutrality.test.js 锁定「每条护符都声明 combatStats
// 对象」），所以这里用合成输入把它钉死：既防止未来反向改成「不过滤」（引擎读取即报错的护符
// 会回到战斗下拉），也防止改回身份语义。
describe('resolveIsCombatInert（combatStats 判定）', () => {
  it('把「combatStats 为空对象」判为战斗惰性（当前 60 条生活护符的形态）', () => {
    expect(resolveIsCombatInert({ combatStats: {} })).toBe(true);
  });

  it('只要 combatStats 有任意键就判为非惰性，包括只声明 focusTraining 的形态', () => {
    expect(resolveIsCombatInert({ combatStats: { attack: 5 } })).toBe(false);
    expect(resolveIsCombatInert({ combatStats: { combatStyleHrids: ['/combat_styles/melee'] } })).toBe(false);
    expect(resolveIsCombatInert({ combatStats: { focusTraining: '/skills/attack' } })).toBe(false);
  });

  it('缺数据（combatStats 缺失/null/非对象）一律 fail-safe 判为战斗惰性，而不是抛错或放行', () => {
    // equipment.js 的 getCombatStat / getFocusTraining 对缺失 combatStats 无兜底（读取即报错），
    // 所以只能按「不作为战斗向选项出品」处理；返回值不携带任何身份含义。
    expect(resolveIsCombatInert(undefined)).toBe(true);
    expect(resolveIsCombatInert({})).toBe(true);
    expect(resolveIsCombatInert({ combatStats: null })).toBe(true);
    expect(resolveIsCombatInert({ combatStats: 0 })).toBe(true);
    expect(resolveIsCombatInert({ combatStats: 'combat-stats-placeholder' })).toBe(true);
  });
});

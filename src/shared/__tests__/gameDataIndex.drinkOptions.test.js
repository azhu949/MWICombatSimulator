import { describe, expect, it } from 'vitest';
import gameDataIndex from '../gameDataIndex.generated.json';
import itemDetailMap from '../../combatsimulator/data/itemDetailMap.json';

const COMBAT_ACTION_TYPE_HRID = '/action_types/combat';

// drinkOptions.combatUsable 是战斗模拟器饮品下拉过滤的唯一语义依据
// （simulatorStore.getConsumableOptions）。本测试锁定构建期投影：
// 1) 每条饮品都必须携带布尔 combatUsable；
// 2) 该字段必须与原始表 consumableDetail.usableInActionTypeMap['/action_types/combat']
//    保持一致，防止构建脚本投影漂移或字段缺失导致过滤退化。
describe('gameDataIndex drinkOptions combatUsable projection', () => {
  it('projects a boolean combatUsable for every drink option', () => {
    const drinks = gameDataIndex.drinkOptions;
    expect(Array.isArray(drinks)).toBe(true);
    expect(drinks.length).toBeGreaterThan(0);
    for (const drink of drinks) {
      expect(typeof drink.combatUsable).toBe('boolean');
    }
  });

  it('stays consistent with itemDetailMap usableInActionTypeMap', () => {
    for (const drink of gameDataIndex.drinkOptions) {
      const expected =
        itemDetailMap[drink.hrid]?.consumableDetail?.usableInActionTypeMap?.[COMBAT_ACTION_TYPE_HRID] === true;
      expect(drink.combatUsable, `${drink.hrid} combatUsable mismatch`).toBe(expected);
    }
  });

  it('contains both combat-usable and non-combat drinks in current game data', () => {
    const drinks = gameDataIndex.drinkOptions;
    expect(drinks.some((drink) => drink.combatUsable)).toBe(true);
    expect(drinks.some((drink) => !drink.combatUsable)).toBe(true);
  });
});

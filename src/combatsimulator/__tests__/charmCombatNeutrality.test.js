import { describe, expect, it } from 'vitest';
import Equipment from '../equipment.js';
import equipmentTypeDetailMap from '../data/equipmentTypeDetailMap.json';
import itemDetailMap from '../data/itemDetailMap.json';

// 装备下拉把 isCombatInert 的护符当作「对战斗没有任何贡献」而不提供
// （投影来源 scripts/build-game-data-index.mjs 的 createItemIndex →
// shared/gameDataIndex.resolveEquipmentComboboxItems）。这条口径成立的前提是引擎行为本身：
// equipment.js 的 getCombatStat 对 combatStats 中不存在的属性一律返回 0、
// getFocusTraining 直读 combatStats.focusTraining（player.js 在 charm 槽位上正是读它们）。
// 本测试用真实护符数据锁定该前提——若引擎改成从别处读取战斗属性，这里必须失败。
// 另外先断言输入形态（每条护符都声明 combatStats 对象）：字段缺失时引擎读取会抛错，那属于
// 构建期哨兵与 shared 侧测试负责暴露的形态变化，不应以 TypeError 的形式混进这里的断言。
// 「哪些护符被标记」由 shared/__tests__/gameDataIndex.charmOptions.test.js 锁定，
// 本文件只回答「被标记 = 对战斗零贡献」这件事在引擎里确实成立。
const CHARM_LOCATION_HRID = '/item_locations/charm';

const charmHrids = Object.entries(itemDetailMap)
  .filter(
    ([, item]) =>
      String(equipmentTypeDetailMap?.[item?.equipmentDetail?.type]?.itemLocationHrid || '') === CHARM_LOCATION_HRID,
  )
  .map(([hrid]) => hrid);

const declaredCombatStats = (hrid) => itemDetailMap[hrid]?.equipmentDetail?.combatStats;
const combatStatsOf = (hrid) => declaredCombatStats(hrid) || {};

// 引擎在 charm 槽位上读取的数值战斗属性集合（由全部护符的 combatStats 数值键推导；
// focusTraining 是技能 hrid 字符串，单独用 getFocusTraining 覆盖）。
const charmCombatStatKeys = Array.from(
  new Set(
    charmHrids.flatMap((hrid) =>
      Object.entries(combatStatsOf(hrid))
        .filter(([, value]) => typeof value === 'number')
        .map(([key]) => key),
    ),
  ),
);

// 只统计「已声明 combatStats 对象且为空」的护符：字段缺失属于输入形态变化（引擎读取会抛错，
// 构建期回退为过滤并告警），由下面的形态断言和 shared 侧测试负责暴露，这里不再计入中性集合，
// 以免以 TypeError 的形式失败。
const neutralCharmHrids = charmHrids.filter((hrid) => {
  const combatStats = declaredCombatStats(hrid);
  return combatStats !== null && typeof combatStats === 'object' && Object.keys(combatStats).length === 0;
});

describe('charm combat neutrality', () => {
  it('finds charm data to check', () => {
    expect(charmHrids.length).toBeGreaterThan(0);
    expect(charmCombatStatKeys.length).toBeGreaterThan(0);
    expect(neutralCharmHrids.length).toBeGreaterThan(0);
    expect(neutralCharmHrids.length).toBeLessThan(charmHrids.length);
    expect(
      charmHrids.every((hrid) => {
        const combatStats = declaredCombatStats(hrid);
        return combatStats !== null && typeof combatStats === 'object';
      }),
      '每条护符都必须声明 combatStats 对象（缺失时引擎会抛错，判定回退为过滤）',
    ).toBe(true);
  });

  it('scores the charms with an empty combatStats object as 0 on every combat stat, with no training focus', () => {
    for (const hrid of neutralCharmHrids) {
      const equipment = new Equipment(hrid, 0);
      for (const stat of charmCombatStatKeys) {
        expect(equipment.getCombatStat(stat), `${hrid} ${stat}`).toBe(0);
      }
      expect(equipment.getFocusTraining(), `${hrid} focusTraining`).toBeUndefined();
    }
  });

  it('keeps every charm the dropdown preserves because the engine really reads combat data from it', () => {
    const contributingCharmHrids = charmHrids.filter((hrid) => Object.keys(combatStatsOf(hrid)).length > 0);
    expect(contributingCharmHrids.length).toBeGreaterThan(0);
    for (const hrid of contributingCharmHrids) {
      const equipment = new Equipment(hrid, 0);
      // 引擎在 charm 槽位上读两类战斗数据：数值战斗属性（EQUIPMENT_COMBAT_STATS 求和）与
      // focusTraining（技能 hrid 字符串）。两者皆无 ⇒ 该护符在引擎里其实毫无贡献，
      // 说明「保留它」的依据不成立（数据退化，需人工复核）。
      const readsCombatData =
        charmCombatStatKeys.some((stat) => equipment.getCombatStat(stat) > 0) ||
        typeof equipment.getFocusTraining() === 'string';
      expect(readsCombatData, `${hrid} 非生活护符应至少被引擎读到一项战斗数据`).toBe(true);
    }
  });
});

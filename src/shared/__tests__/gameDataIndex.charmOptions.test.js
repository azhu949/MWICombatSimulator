import { describe, expect, it } from 'vitest';
import gameDataIndex from '../gameDataIndex.generated.json';
import equipmentTypeDetailMap from '../../combatsimulator/data/equipmentTypeDetailMap.json';
import itemDetailMap from '../../combatsimulator/data/itemDetailMap.json';
import skillDetailMap from '../../combatsimulator/data/skillDetailMap.json';

// equipmentBySlot.charm 的 isCombatInert 是装备下拉过滤战斗惰性护符的唯一语义依据
// （simulatorStore 选项出品层 → shared/gameDataIndex.resolveEquipmentComboboxItems；
// UI 经 store action getEquipmentComboboxOptions 取选项）。本测试锁定「真正的语义前提」，
// 而不是某个代理变量的实现细节：
//   字段语义（2026-09-14 复核修正）——产出语义而非身份语义：isCombatInert = 「引擎在战斗里
//   读不到贡献 ⇒ 不作为战斗向选项出品」（combatStats 缺数据时同样投影为 true 作 fail-safe，
//   由构建脚本 resolveIsCombatInert 与 scripts/__tests__/build-game-data-index.test.js 锁定）。
//   引擎口径（equipment.js:37-45）——getCombatStat 对 combatStats 中不存在的属性一律返回 0、
//   getFocusTraining 直读 combatStats.focusTraining ⇒ combatStats 为空的护符在战斗模拟里
//   不产生任何战斗贡献，因此构建期投影的判定依据必须等于「combatStats 为空」。
// 断言分工：
// 1) 每条护符都必须携带布尔 isCombatInert；
// 2) 输入形态：每条护符在原始表里都存在且声明了 combatStats 对象（引擎对缺字段会抛错）；
// 3) 该字段必须与原始表 equipmentDetail.combatStats 是否为空一致（投影漂移防护）；
// 4) 当前数据不变量（不是惰性的推论）：被标记的护符恰好都是生活护符，因而还必须满足生活护符
//    的数据不变量（无任何战斗属性 / 战斗强化加成，且有生活属性）——漂移即人工复核；
// 5) 数据形态哨兵：历史上用过的代理变量（levelRequirements[0].skillHrid 是否生活技能）当前与
//    引擎口径一一对应；此断言失败 == 官方数据形态变化（多需求 / 双专精 / total_level 前移），
//    需要人工复核护符过滤口径，而不是顺手改期望值；
// 6) 完备性：索引护符集合 == 槽位映射（equipmentTypeDetailMap → /item_locations/charm）能识别的
//    全部护符——过滤口径必须覆盖全量护符，不能因漏投影而"少过滤"；
// 7) 其余槽位不得携带该字段，避免该语义外溢到战斗装备下拉。
const charms = gameDataIndex.equipmentBySlot.charm;
const equipmentDetailOf = (charm) => itemDetailMap[charm.hrid]?.equipmentDetail || {};
const statKeysOf = (charm, field) => Object.keys(equipmentDetailOf(charm)?.[field] || {});
// 槽位映射侧的护符全集（构建脚本 resolveEquipmentSlotName 的判定输入是同一张映射表）。构建
// 脚本另外还要求 categoryHrid === '/item_categories/equipment'，这里不重复该过滤——两者若不等，
// 由下面的完备性断言把差异显式暴露出来并交人工判断。
const charmHridsBySlotMap = new Set(
  Object.entries(itemDetailMap)
    .filter(
      ([, item]) =>
        String(equipmentTypeDetailMap?.[item?.equipmentDetail?.type]?.itemLocationHrid || '') ===
        '/item_locations/charm',
    )
    .map(([hrid]) => hrid),
);

describe('gameDataIndex charm isCombatInert projection', () => {
  it('projects a boolean isCombatInert for every charm option', () => {
    expect(Array.isArray(charms)).toBe(true);
    expect(charms.length).toBeGreaterThan(0);
    for (const charm of charms) {
      expect(typeof charm.isCombatInert, `${charm.hrid} isCombatInert`).toBe('boolean');
    }
  });

  it('keeps combatStats declared as an object on every charm (premise input shape)', () => {
    for (const charm of charms) {
      const item = itemDetailMap[charm.hrid];
      expect(item, `${charm.hrid} 在 itemDetailMap 中缺失`).toBeTruthy();
      const combatStats = item?.equipmentDetail?.combatStats;
      expect(
        combatStats !== null && typeof combatStats === 'object',
        `${charm.hrid} 缺少 combatStats 对象：引擎 getCombatStat/getFocusTraining 会抛错，构建期已按 fail-safe 投影 isCombatInert=true 并告警`,
      ).toBe(true);
    }
  });

  it('flags exactly the charms whose combatStats is empty (engine premise)', () => {
    let flaggedCount = 0;
    for (const charm of charms) {
      const expected = statKeysOf(charm, 'combatStats').length === 0;
      if (expected) {
        flaggedCount += 1;
      }
      expect(charm.isCombatInert, `${charm.hrid} 判定应等于「combatStats 为空」`).toBe(expected);
    }
    expect(flaggedCount).toBeGreaterThan(0);
    expect(flaggedCount).toBeLessThan(charms.length);
  });

  it('keeps the flagged charms free of combat effects and full of life-skill stats (current-data invariant)', () => {
    for (const charm of charms.filter((option) => option.isCombatInert)) {
      // 当前数据下「惰性」与「生活护符」恰好等价，所以顺带锁定生活护符的数据不变量：战斗强化
      // 加成只在 combatStats 有基值时才会被引擎取用，但生活护符本就不该携带任何战斗面字段；
      // 漂移即人工复核（缺数据的战斗护符会同时触发本断言与上面的输入形态断言）。
      expect(statKeysOf(charm, 'combatStats'), `${charm.hrid} combatStats`).toEqual([]);
      expect(statKeysOf(charm, 'combatEnhancementBonuses'), `${charm.hrid} combatEnhancementBonuses`).toEqual([]);
      expect(statKeysOf(charm, 'noncombatStats').length, `${charm.hrid} noncombatStats`).toBeGreaterThan(0);
    }
  });

  it('alarms when the level-requirement proxy diverges from the engine premise (data shape canary)', () => {
    for (const charm of charms) {
      const skillHrid = String(equipmentDetailOf(charm)?.levelRequirements?.[0]?.skillHrid || '');
      const proxyIsSkilling = skillDetailMap?.[skillHrid]?.isSkilling === true;
      expect(
        proxyIsSkilling,
        `${charm.hrid}（${skillHrid || '无技能需求'}）代理变量与引擎口径背离：官方数据形态可能已变化，请人工复核护符过滤口径`,
      ).toBe(charm.isCombatInert);
    }
  });

  it('separates skilling charms from combat charms in current game data', () => {
    expect(charms.find((charm) => charm.hrid === '/items/trainee_milking_charm')?.isCombatInert).toBe(true);
    expect(charms.find((charm) => charm.hrid === '/items/trainee_attack_charm')?.isCombatInert).toBe(false);
    expect(charms.some((charm) => charm.isCombatInert)).toBe(true);
    expect(charms.some((charm) => !charm.isCombatInert)).toBe(true);
  });

  it('indexes every charm the slot mapping can identify (index completeness)', () => {
    const indexedHrids = new Set(charms.map((charm) => String(charm.hrid || '')));
    expect(charmHridsBySlotMap.size).toBeGreaterThan(0);
    expect([...charmHridsBySlotMap].filter((hrid) => !indexedHrids.has(hrid))).toEqual([]);
    expect([...indexedHrids].filter((hrid) => !charmHridsBySlotMap.has(hrid))).toEqual([]);
  });

  it('keeps the marker scoped to the charm slot', () => {
    for (const [slot, options] of Object.entries(gameDataIndex.equipmentBySlot)) {
      if (slot === 'charm') {
        continue;
      }
      expect(
        options.some((option) => 'isCombatInert' in option),
        slot,
      ).toBe(false);
    }
  });
});

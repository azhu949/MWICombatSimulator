import { describe, expect, it } from 'vitest';
import gameDataIndex from '../gameDataIndex.generated.json';
import actionDetailSource from '../../combatsimulator/data/actionDetailMap.json';
import equipmentTypeDetailMap from '../../combatsimulator/data/equipmentTypeDetailMap.json';
import itemDetailMap from '../../combatsimulator/data/itemDetailMap.json';
import skillDetailMap from '../../combatsimulator/data/skillDetailMap.json';
import { houseRoomHrids, resolveEquipmentComboboxItems, zoneMonsterSpawnIndex } from '../gameDataIndex.js';
import { ensurePlayerAdvancedState } from '../playerConfig.js';

// 2026-10-03 合并：原 5 个 shared/ 侧薄测试文件（gameDataIndex.drinkOptions /
// gameDataIndex.equipmentCombobox / gameDataIndex.zoneMonsterSpawn / gameDataIndex.charmOptions /
// playerConfig）。用例、断言与注释逐字保留，仅减少测试文件数——全量墙钟瓶颈在文件数与
// fork 启停。
const COMBAT_ACTION_TYPE_HRID = '/action_types/combat';

describe('gameDataIndex & shared option projections', () => {
  describe('gameDataIndex drinkOptions combatUsable projection', () => {
    // drinkOptions.combatUsable 是战斗模拟器饮品下拉过滤的唯一语义依据
    // （simulatorStore.getConsumableOptions）。本测试锁定构建期投影：
    // 1) 每条饮品都必须携带布尔 combatUsable；
    // 2) 该字段必须与原始表 consumableDetail.usableInActionTypeMap['/action_types/combat']
    //    保持一致，防止构建脚本投影漂移或字段缺失导致过滤退化。
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

  describe('resolveEquipmentComboboxItems', () => {
    const charmOptions = [
      { hrid: '/items/trainee_attack_charm', name: 'Trainee Attack Charm', itemLevel: 1, isCombatInert: false },
      { hrid: '/items/trainee_milking_charm', name: 'Trainee Milking Charm', itemLevel: 1, isCombatInert: true },
    ];

    // 装备下拉口径的唯一实现（simulatorStore 选项出品层用它产出 options.equipmentBySlot，
    // getEquipmentComboboxOptions 用它补回「保留已选中」例外）；UI 层不得再自建第二份过滤逻辑。
    // 标记是产出语义（构建期 isCombatInert：引擎在战斗里读不到贡献，当前数据即生活技能护符），
    // 不是身份判定。本测试锁定：过滤语义、保留已选中的例外、无标记槽位零影响（含引用同一性）、
    // 异常输入容错。
    it('filters combat-inert charms (current data: life-skill charms) out of the equipment dropdown', () => {
      const visible = resolveEquipmentComboboxItems(charmOptions);
      expect(visible).toEqual([charmOptions[0]]);
      // 过滤分支必须产出新数组：入参是共享索引里的槽位数组，不得被原地修改。
      expect(visible).not.toBe(charmOptions);
      expect(charmOptions).toHaveLength(2);
    });

    it('keeps the equipped life-skill charm visible so the selector never renders blank', () => {
      const items = resolveEquipmentComboboxItems(charmOptions, '/items/trainee_milking_charm');
      expect(items.map((item) => item.hrid)).toEqual(['/items/trainee_attack_charm', '/items/trainee_milking_charm']);
    });

    it('does not duplicate the equipped item when it is already visible', () => {
      const items = resolveEquipmentComboboxItems(charmOptions, '/items/trainee_attack_charm');
      expect(items.map((item) => item.hrid)).toEqual(['/items/trainee_attack_charm']);
    });

    it('leaves slots without the projection marker untouched', () => {
      const headOptions = [
        { hrid: '/items/cheese_helmet', name: 'Cheese Helmet', itemLevel: 10 },
        { hrid: '/items/vision_helmet', name: 'Vision Helmet', itemLevel: 90 },
      ];
      // 无标记槽位必须原样返回同一数组引用（= 共享索引 equipmentOptionsBySlot[slot]），
      // 否则「store 选项 === 共享索引」在引用层面不成立，每个槽位还多一份等价长驻副本。
      expect(resolveEquipmentComboboxItems(headOptions, '/items/vision_helmet')).toBe(headOptions);
      expect(resolveEquipmentComboboxItems(headOptions)).toBe(headOptions);
    });

    it('tolerates missing or empty option lists', () => {
      expect(resolveEquipmentComboboxItems()).toEqual([]);
      expect(resolveEquipmentComboboxItems(null, '/items/trainee_milking_charm')).toEqual([]);
      expect(resolveEquipmentComboboxItems([], '/items/trainee_milking_charm')).toEqual([]);
    });

    it('ignores an unknown equipped hrid', () => {
      expect(resolveEquipmentComboboxItems(charmOptions, '/items/missing_charm')).toEqual([charmOptions[0]]);
    });
  });

  describe('gameDataIndex zoneMonsterSpawnIndex projection', () => {
    // zoneMonsterSpawnIndex 是刷图推荐器「铁牛模式」的区域→怪物链路入口：
    // 键为非地牢战斗区域 hrid，值为该区域（随机刷怪表 + boss 刷怪表合并去重）的
    // { monsterHrid, difficultyTier } 列表，difficultyTier 为难度档偏移。
    // 本测试锁定构建期投影：
    // 1) 模块导出必须指向生成索引中的 zoneMonsterSpawnIndex；
    // 2) 键集合必须与 actionDetailIndex 中的非地牢战斗区域完全一致；
    // 3) 条目形状必须为 { monsterHrid, difficultyTier } 且区域内去重；
    // 4) 投影内容必须与原始表 actionDetailMap 保持一致，防止构建投影漂移漏算怪物。
    function buildExpectedIndex() {
      const expected = {};
      for (const action of Object.values(actionDetailSource)) {
        const hrid = String(action?.hrid || '');
        if (
          !hrid ||
          String(action?.type || '') !== COMBAT_ACTION_TYPE_HRID ||
          action?.combatZoneInfo?.isDungeon === true
        ) {
          continue;
        }

        const fightInfo = action?.combatZoneInfo?.fightInfo;
        const spawnEntries = [
          ...(Array.isArray(fightInfo?.randomSpawnInfo?.spawns) ? fightInfo.randomSpawnInfo.spawns : []),
          ...(Array.isArray(fightInfo?.bossSpawns) ? fightInfo.bossSpawns : []),
        ];
        const seen = new Set();
        const monsters = [];
        for (const spawn of spawnEntries) {
          const monsterHrid = String(spawn?.combatMonsterHrid || '');
          if (!monsterHrid) {
            continue;
          }
          const difficultyTier = Number(spawn?.difficultyTier ?? 0);
          const dedupeKey = `${monsterHrid}::${difficultyTier}`;
          if (seen.has(dedupeKey)) {
            continue;
          }
          seen.add(dedupeKey);
          monsters.push({ monsterHrid, difficultyTier });
        }
        expected[hrid] = monsters;
      }
      return expected;
    }

    it('exports the generated projection through gameDataIndex.js', () => {
      expect(zoneMonsterSpawnIndex).toBe(gameDataIndex.zoneMonsterSpawnIndex);
    });

    it('keys exactly match the non-dungeon combat zones in actionDetailIndex', () => {
      const expectedZoneHrids = new Set(
        Object.values(gameDataIndex.actionDetailIndex)
          .filter((action) => action?.type === COMBAT_ACTION_TYPE_HRID && action?.isDungeon !== true)
          .map((action) => String(action?.hrid || ''))
          .filter(Boolean),
      );
      expect(expectedZoneHrids.size).toBeGreaterThan(0);
      expect(new Set(Object.keys(zoneMonsterSpawnIndex))).toEqual(expectedZoneHrids);
    });

    it('projects deduplicated { monsterHrid, difficultyTier } entries for every zone', () => {
      const zoneHrids = Object.keys(zoneMonsterSpawnIndex);
      expect(zoneHrids.length).toBeGreaterThan(0);
      for (const zoneHrid of zoneHrids) {
        const monsters = zoneMonsterSpawnIndex[zoneHrid];
        expect(Array.isArray(monsters), `${zoneHrid} entries must be an array`).toBe(true);
        expect(monsters.length, `${zoneHrid} must list at least one monster`).toBeGreaterThan(0);
        const seen = new Set();
        for (const entry of monsters) {
          expect(Object.keys(entry).sort(), `${zoneHrid} entry shape`).toEqual(['difficultyTier', 'monsterHrid']);
          expect(entry.monsterHrid.startsWith('/monsters/'), `${zoneHrid} monster hrid prefix`).toBe(true);
          expect(Number.isInteger(entry.difficultyTier), `${zoneHrid} difficultyTier must be an integer`).toBe(true);
          const dedupeKey = `${entry.monsterHrid}::${entry.difficultyTier}`;
          expect(seen.has(dedupeKey), `${zoneHrid} duplicates ${dedupeKey}`).toBe(false);
          seen.add(dedupeKey);
        }
      }
    });

    it('stays in sync with the spawns + bossSpawns of actionDetailMap', () => {
      expect(zoneMonsterSpawnIndex).toEqual(buildExpectedIndex());
    });

    it('merges boss spawns into zone entries and excludes dungeons and the labyrinth', () => {
      // aqua_planet：普通怪 sea_snail 与 boss marine_huntress 都必须收录
      expect(zoneMonsterSpawnIndex['/actions/combat/aqua_planet']).toContainEqual({
        monsterHrid: '/monsters/sea_snail',
        difficultyTier: 0,
      });
      expect(zoneMonsterSpawnIndex['/actions/combat/aqua_planet']).toContainEqual({
        monsterHrid: '/monsters/marine_huntress',
        difficultyTier: 0,
      });
      // 地牢（isDungeon=true）与迷宫（/action_types/labyrinth）不收录
      expect(zoneMonsterSpawnIndex['/actions/combat/enchanted_fortress']).toBeUndefined();
      expect(zoneMonsterSpawnIndex['/actions/labyrinth/explore']).toBeUndefined();
    });
  });

  describe('gameDataIndex charm isCombatInert projection', () => {
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

  describe('player config normalization', () => {
    it('keeps only known house rooms and normalizes their levels', () => {
      const knownRoomHrid = houseRoomHrids[0];
      const unknownRoomHrid = '/house_rooms/removed_or_misspelled';
      const player = {
        houseRooms: {
          [knownRoomHrid]: '3.9',
          [unknownRoomHrid]: 7,
        },
      };

      ensurePlayerAdvancedState(player);

      expect(player.houseRooms[knownRoomHrid]).toBe(3);
      expect(player.houseRooms).not.toHaveProperty(unknownRoomHrid);
      expect(Object.keys(player.houseRooms)).toEqual(houseRoomHrids);
    });
  });
});

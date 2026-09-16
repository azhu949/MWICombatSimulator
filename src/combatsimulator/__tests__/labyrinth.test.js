import { describe, expect, it } from 'vitest';

import Labyrinth from '../labyrinth.js';
import {
  COMBAT_LABYRINTH_SHOP_UPGRADES,
  LABYRINTH_SHOP_BUFF_UPGRADES,
  buildLabyrinthShopUpgradeBuffs,
  normalizeLabyrinthShopUpgrades,
} from '../../shared/labyrinthShopUpgrades.js';

const UPGRADE_UNIQUE_PREFIX = '/buff_uniques/labyrinth_shop_upgrade_';

describe('labyrinth shop permanent buff upgrades', () => {
  it('keeps the full 9-upgrade catalog with 5 combat-relevant entries', () => {
    expect(LABYRINTH_SHOP_BUFF_UPGRADES).toHaveLength(9);
    expect(COMBAT_LABYRINTH_SHOP_UPGRADES.map((upgrade) => upgrade.key)).toEqual([
      'damage',
      'attack_speed',
      'cast_speed',
      'critical_rate',
      'experience',
    ]);
  });

  it('exposes the official characterInfo field for every combat-relevant upgrade（主站导入映射的派生来源）', () => {
    // 主站导入映射（importExportMapper 的 CHARACTER_INFO_LABYRINTH_UPGRADE_FIELDS）由目录的
    // characterInfoField 派生，不再手写第二份 key 清单：这 5 项必须各自携带非空且互不重复的
    // 官方 characterInfo 字段名，否则派生映射会静默丢掉对应 key（normalizeLabyrinthShopUpgrades
    // 只按目录 key 取值，导入结果静默变空且运行时无报错）。逐项钉死字段名，兼防误改
    // （官方字段名只能靠真实载荷核对）。
    expect(COMBAT_LABYRINTH_SHOP_UPGRADES.map((upgrade) => upgrade.characterInfoField)).toEqual([
      'labyrinthCombatDamageLevel',
      'labyrinthAttackSpeedLevel',
      'labyrinthCastSpeedLevel',
      'labyrinthCriticalRateLevel',
      'labyrinthExperienceLevel',
    ]);
  });

  it('normalizes upgrade levels to the combat-relevant keys clamped to 0-12', () => {
    expect(normalizeLabyrinthShopUpgrades(null)).toEqual({});
    expect(normalizeLabyrinthShopUpgrades(undefined)).toEqual({});
    expect(
      normalizeLabyrinthShopUpgrades({
        damage: 12,
        attack_speed: 0,
        cast_speed: -3,
        critical_rate: 'bad',
        experience: 13,
        skilling_speed: 8,
      }),
    ).toEqual({ damage: 12, experience: 12 });
    expect(normalizeLabyrinthShopUpgrades({ damage: 5.9 })).toEqual({ damage: 5 });
  });

  it('rejects pseudo values that Number() would coerce into levels（伪值不得凭空变成等级）', () => {
    // Number() 一把转换会把「无数据」伪装成有效等级：true→1、[3]→3、'0x10'→16（钳成 12）、
    // Object.create({damage:5})→读原型链得 5。这些值一旦落盘就是用户从未购买的等级，
    // 且与导入侧 hasLevelField 门（明确排除布尔/数组/对象）口径相悖。
    expect(normalizeLabyrinthShopUpgrades({ damage: true, attack_speed: false })).toEqual({});
    expect(normalizeLabyrinthShopUpgrades({ damage: [3], attack_speed: ['5'] })).toEqual({});
    expect(normalizeLabyrinthShopUpgrades({ damage: '0x10', attack_speed: '1e2' })).toEqual({});
    expect(normalizeLabyrinthShopUpgrades({ damage: null, attack_speed: undefined, cast_speed: {} })).toEqual({});
    expect(normalizeLabyrinthShopUpgrades(Object.create({ damage: 5 }))).toEqual({});

    // 数字与十进制数字串仍照常接受（含首尾空白/正负号/小数写法）。
    expect(normalizeLabyrinthShopUpgrades({ damage: ' 7 ', attack_speed: '+3', cast_speed: '2.9' })).toEqual({
      damage: 7,
      attack_speed: 3,
      cast_speed: 2,
    });
  });

  it('builds level-scaled buffs with official boost field conventions', () => {
    const buffs = buildLabyrinthShopUpgradeBuffs({ damage: 12, cast_speed: 5 });
    expect(buffs).toHaveLength(2);

    const damage = buffs.find((buff) => buff.typeHrid === '/buff_types/damage');
    expect(damage).toMatchObject({
      uniqueHrid: `${UPGRADE_UNIQUE_PREFIX}damage`,
      ratioBoost: 0.12,
      ratioBoostLevelBonus: 0,
      flatBoost: 0,
      flatBoostLevelBonus: 0,
    });

    const castSpeed = buffs.find((buff) => buff.typeHrid === '/buff_types/cast_speed');
    expect(castSpeed).toMatchObject({
      uniqueHrid: `${UPGRADE_UNIQUE_PREFIX}cast_speed`,
      ratioBoost: 0,
      ratioBoostLevelBonus: 0,
      flatBoost: 0.05,
      flatBoostLevelBonus: 0,
    });

    // 空等级不产生 buff。
    expect(buildLabyrinthShopUpgradeBuffs({})).toHaveLength(0);
    expect(buildLabyrinthShopUpgradeBuffs(null)).toHaveLength(0);

    // 伪值同样不产生 buff（与归一化同一取值门：true→1、[12]→12 都不得凭空生效）。
    expect(buildLabyrinthShopUpgradeBuffs({ damage: true, attack_speed: [12] })).toHaveLength(0);
    expect(buildLabyrinthShopUpgradeBuffs(Object.create({ damage: 12 }))).toHaveLength(0);
  });

  it('appends upgrade buffs to labyrinth zone buffs alongside crates', () => {
    const noUpgrades = new Labyrinth('/monsters/test', 100, [], null);
    const baselineCount = noUpgrades.buffs.length;
    expect(noUpgrades.buffs.filter((buff) => String(buff.uniqueHrid).startsWith(UPGRADE_UNIQUE_PREFIX))).toHaveLength(
      0,
    );

    const crateOnly = new Labyrinth('/monsters/test', 100, ['/items/basic_coffee_crate'], null);
    const crateCount = crateOnly.buffs.length;
    expect(crateCount).toBeGreaterThan(0);
    expect(crateOnly.buffs.filter((buff) => String(buff.uniqueHrid).startsWith(UPGRADE_UNIQUE_PREFIX))).toHaveLength(0);

    const upgraded = new Labyrinth('/monsters/test', 100, ['/items/basic_coffee_crate'], {
      damage: 12,
      attack_speed: 7,
      cast_speed: 7,
      critical_rate: 7,
      experience: 7,
    });

    expect(upgraded.buffs.length).toBe(crateCount + 5);
    const upgradeBuffs = upgraded.buffs.filter((buff) => String(buff.uniqueHrid).startsWith(UPGRADE_UNIQUE_PREFIX));
    expect(upgradeBuffs.map((buff) => buff.typeHrid)).toEqual([
      '/buff_types/damage',
      '/buff_types/attack_speed',
      '/buff_types/cast_speed',
      '/buff_types/critical_rate',
      '/buff_types/wisdom',
    ]);
    expect(upgradeBuffs.find((buff) => buff.typeHrid === '/buff_types/damage').ratioBoost).toBeCloseTo(0.12, 8);
    expect(upgradeBuffs.find((buff) => buff.typeHrid === '/buff_types/attack_speed').ratioBoost).toBeCloseTo(0.07, 8);
    expect(upgradeBuffs.find((buff) => buff.typeHrid === '/buff_types/cast_speed').flatBoost).toBeCloseTo(0.07, 8);
    expect(upgradeBuffs.find((buff) => buff.typeHrid === '/buff_types/critical_rate').flatBoost).toBeCloseTo(0.07, 8);
    expect(upgradeBuffs.find((buff) => buff.typeHrid === '/buff_types/wisdom').flatBoost).toBeCloseTo(0.07, 8);
  });
});

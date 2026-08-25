import { describe, expect, it } from 'vitest';
import Player from '../player.js';
import CombatSimulator from '../combatSimulator.js';
import Zone from '../zone.js';
import Ability from '../ability.js';
import { REMOVE_ACTIVE_SOURCE } from '../combatUnit.js';
import itemDetailMap from '../data/itemDetailMap.json';
import {
  BUFF_SOURCE_POLICY,
  PARTY_AURA_STRENGTH_FIELDS,
  assertPartyAuraSnapshotMatchesOfficialData,
  getAbilityBuffSourcePolicy,
  isPartyAuraBuff,
} from '../buffSourcePolicy.js';

function makeBuff(uniqueHrid, ratioBoost, duration = 100e9) {
  return {
    uniqueHrid,
    typeHrid: '/buff_types/attack_speed',
    ratioBoost,
    flatBoost: 0,
    duration,
  };
}

describe('Buff source policy', () => {
  it('documents the official one-stack equipment values used by the probes', () => {
    expect({
      curse: itemDetailMap['/items/cursed_bow'].equipmentDetail.combatStats.curse,
      curseRefined: itemDetailMap['/items/cursed_bow_refined'].equipmentDetail.combatStats.curse,
      weaken: itemDetailMap['/items/griffin_bulwark'].equipmentDetail.combatStats.weaken,
      weakenRefined: itemDetailMap['/items/griffin_bulwark_refined'].equipmentDetail.combatStats.weaken,
      fury: itemDetailMap['/items/furious_spear'].equipmentDetail.combatStats.fury,
      furyRefined: itemDetailMap['/items/furious_spear_refined'].equipmentDetail.combatStats.fury,
    }).toEqual({
      curse: 0.02,
      curseRefined: 0.022,
      weaken: 0.03,
      weakenRefined: 0.032,
      fury: 0.03,
      furyRefined: 0.032,
    });
  });

  async function runDeterministicSimulation(playerCount, abilityHrid = null) {
    const players = Array.from({ length: playerCount }, (_, index) => {
      const player = new Player();
      player.hrid = `player${index + 1}`;
      player.attackLevel = 31 + index;
      player.meleeLevel = 31 + index;
      player.defenseLevel = 31 + index;
      player.zoneBuffs = [];
      player.extraBuffs = [];
      if (abilityHrid) {
        player.abilities = [new Ability(abilityHrid), null, null, null];
      }
      player.updateCombatDetails();
      return player;
    });

    const simulator = new CombatSimulator(players, new Zone('/actions/combat/sorcerers_tower', 0), null, {});
    await simulator.simulate(60e9);
    return {
      attacks: simulator.simResult.attacks,
      deaths: simulator.simResult.deaths,
      manaUsed: simulator.simResult.manaUsed,
      stats: players.map((player) => ({
        attackInterval: player.combatDetails.combatStats.attackInterval,
        smashMaxDamage: player.combatDetails.smashMaxDamage,
        currentHitpoints: player.combatDetails.currentHitpoints,
        currentManapoints: player.combatDetails.currentManapoints,
      })),
    };
  }

  // 以固定常量运行回调中的 Math.random。下方的黄金
  // 模拟通过 Promise.all 并发运行三次模拟，
  // 因此种子序列会在三次运行之间不可预测地交错，
  // 导致快照不稳定。固定值使每次
  // Math.random() 调用无论交错顺序如何都完全相同，
  // 这正是黄金值可复现的原因。
  async function withFixedRandom(callback) {
    const originalRandom = Math.random;
    Math.random = () => 0.5;
    try {
      return await callback();
    } finally {
      Math.random = originalRandom;
    }
  }

  // 这些期望值是通过用相同的确定性输入运行未改动的 HEAD 引擎
  // 与本实现捕获的。保留
  // 旧引擎的值，使普通战斗不会因添加队伍光环
  // 源仲裁而作为副作用发生漂移。
  //
  // 维护成本：这是一个刻意设计的黄金值测试。对普通
  // 战斗路径（伤害公式、攻击时机、区域行为、
  // 技能效果等）的任何改动都会合理地改变这些数字，并迫使
  // 快照更新。发生这种情况时：
  //   1. 确认改动是有意的，且新值正确
  //      （用相同的固定随机数运行模拟并检查差异，
  //      或通过 `vitest -u` 更新）。
  //   2. 同时更新内联快照 / toEqual 期望。
  //   3. 不要为了减少未来的更新而削弱断言（例如对一切使用 toBeCloseTo）——
  //      紧密耦合正是重点：它保护
  //      普通路径免受光环仲裁引起的意外漂移。
  it('matches the legacy-engine golden results for ordinary simulations', async () => {
    const [single, dual, dualWithSelfBuff] = await withFixedRandom(() =>
      Promise.all([
        runDeterministicSimulation(1),
        runDeterministicSimulation(2),
        runDeterministicSimulation(2, '/abilities/berserk'),
      ]),
    );

    expect(single).toMatchInlineSnapshot(`
              {
                "attacks": {
                  "/monsters/ice_sorcerer": {
                    "player1": {
                      "/abilities/water_strike": {
                        "4": 1,
                        "53": 2,
                      },
                    },
                  },
                },
                "deaths": {
                  "player1": 1,
                },
                "manaUsed": {
                  "player1": {},
                },
                "stats": [
                  {
                    "attackInterval": 2954209748.892171,
                    "currentHitpoints": 0,
                    "currentManapoints": 110,
                    "smashMaxDamage": 41,
                  },
                ],
              }
            `);
    expect(dual).toEqual({
      attacks: {
        '/monsters/ice_sorcerer': {
          player2: {
            '/abilities/water_strike': { 4: 1, 53: 2 },
          },
          player1: {
            '/abilities/water_strike': { 4: 1, 53: 2 },
          },
        },
        player1: {
          '/monsters/ice_sorcerer': {
            autoAttack: { miss: 1 },
          },
        },
      },
      deaths: { player1: 1, player2: 1 },
      manaUsed: { player1: {}, player2: {} },
      stats: [
        {
          attackInterval: 2954209748.892171,
          smashMaxDamage: 41,
          currentHitpoints: 0,
          currentManapoints: 110,
        },
        {
          attackInterval: 2952755905.511811,
          smashMaxDamage: 42,
          currentHitpoints: 0,
          currentManapoints: 110,
        },
      ],
    });
    expect(dualWithSelfBuff.manaUsed).toEqual({
      player1: { '/abilities/berserk': 65 },
      player2: { '/abilities/berserk': 65 },
    });
    expect(dualWithSelfBuff.stats).toEqual(
      dual.stats.map((stats) => ({
        ...stats,
        currentManapoints: 45,
      })),
    );
  });

  it('preserves last-write-wins for non-aura buffs', () => {
    const unit = new Player();
    const uniqueHrid = '/buff_uniques/non_aura_policy_probe';

    unit.addBuff(makeBuff(uniqueHrid, 0.15), 0, 'first');
    unit.addBuff(makeBuff(uniqueHrid, 0.03), 0, 'second');

    expect(unit.activeBuffSourceKeys[uniqueHrid]).toBe('second');
    expect(unit.combatBuffs[uniqueHrid].ratioBoost).toBe(0.03);

    unit.removeBuff({ uniqueHrid }, 'second');
    expect(unit.combatBuffs[uniqueHrid]).toBeUndefined();
    expect(unit.buffSources[uniqueHrid]).toBeUndefined();
  });

  it('keeps uniqueHrid-only removal compatible for source-keyed ordinary buffs', () => {
    const unit = new Player();
    const uniqueHrid = '/buff_uniques/remove_compatibility_probe';

    unit.addBuff(makeBuff(uniqueHrid, 0.15), 0, 'first');
    unit.addBuff(makeBuff(uniqueHrid, 0.03), 1, 'second');

    // 旧版 API 移除可见的（后写覆盖）Buff 时，不要求
    // 调用方了解任何源注册信息。
    unit.removeBuff({ uniqueHrid });

    expect(unit.combatBuffs[uniqueHrid]).toBeUndefined();
    expect(unit.buffSources[uniqueHrid]).toBeUndefined();
  });

  it('removes the active strongest source and hands off when no key is given', () => {
    const unit = new Player();
    const uniqueHrid = '/buff_uniques/speed_aura_attack_speed';
    const add = (ratioBoost, sourceKey) =>
      unit.addBuff(makeBuff(uniqueHrid, ratioBoost), 0, sourceKey, {
        sourcePolicy: BUFF_SOURCE_POLICY.STRONGEST,
      });

    add(0.03, 'weak');
    add(0.15, 'strong');

    unit.removeBuffByUniqueHrid(uniqueHrid);

    expect(unit.activeBuffSourceKeys[uniqueHrid]).toBe('weak');
    expect(unit.combatBuffs[uniqueHrid].ratioBoost).toBe(0.03);
    expect(unit.buffSources[uniqueHrid].has('strong')).toBe(false);
    expect(unit.buffSources[uniqueHrid].has('weak')).toBe(true);
  });

  it('supports an explicit active-source sentinel without changing default-source removal', () => {
    const unit = new Player();
    const uniqueHrid = '/buff_uniques/speed_aura_attack_speed';
    const add = (ratioBoost, sourceKey) =>
      unit.addBuff(makeBuff(uniqueHrid, ratioBoost), 0, sourceKey, {
        sourcePolicy: BUFF_SOURCE_POLICY.STRONGEST,
      });

    add(0.03, 'weak');
    add(0.15, 'strong');

    unit.removeBuffByUniqueHrid(uniqueHrid, REMOVE_ACTIVE_SOURCE);

    expect(unit.activeBuffSourceKeys[uniqueHrid]).toBe('weak');
    expect(unit.combatBuffs[uniqueHrid].ratioBoost).toBe(0.03);
  });

  it('keeps explicit null removal scoped to the default source', () => {
    const unit = new Player();
    const uniqueHrid = '/buff_uniques/explicit_default_removal_probe';

    unit.addBuff(makeBuff(uniqueHrid, 0.15), 0);
    unit.addBuff(makeBuff(uniqueHrid, 0.03), 1, 'named');

    unit.removeBuffByUniqueHrid(uniqueHrid, null);

    expect(unit.activeBuffSourceKeys[uniqueHrid]).toBe('named');
    expect(unit.combatBuffs[uniqueHrid].ratioBoost).toBe(0.03);
    expect(unit.buffSources[uniqueHrid].has('default')).toBe(false);
    expect(unit.buffSources[uniqueHrid].has('named')).toBe(true);
  });

  // 取自已提交的官方客户端数据快照（`data/itemDetailMap.json`）的
  // 官方单层代表性数值：
  //   /items/cursed_bow 0.02, /items/cursed_bow_refined 0.022（诅咒）
  //   /items/griffin_bulwark 0.03, /items/griffin_bulwark_refined 0.032（虚弱）
  //   /items/furious_spear 0.03, /items/furious_spear_refined 0.032（狂暴）
  // 运行时公式分别按 `curse * stacks`、
  // `-weaken * stacks` 和 `fury * stacks` 应用这些装备属性。这些是
  // 仲裁测试的官方代表性输入，而非通用的
  // 硬编码 Buff 数值。公式请参阅 combatSimulator.js。
  it('keeps curse, weaken, and fury on the legacy last-write path', () => {
    const ordinaryBuffs = [
      {
        uniqueHrid: '/buff_uniques/curse',
        typeHrid: '/buff_types/damage_taken',
        first: { ratioBoost: 0, flatBoost: 0.022 },
        second: { ratioBoost: 0, flatBoost: 0.02 },
      },
      {
        uniqueHrid: '/buff_uniques/weaken',
        typeHrid: '/buff_types/damage',
        first: { ratioBoost: -0.032, flatBoost: 0 },
        second: { ratioBoost: -0.03, flatBoost: 0 },
      },
      {
        uniqueHrid: '/buff_uniques/fury_damage',
        typeHrid: '/buff_types/fury_damage',
        first: { ratioBoost: 0.032, flatBoost: 0 },
        second: { ratioBoost: 0.03, flatBoost: 0 },
      },
    ];

    for (const ordinary of ordinaryBuffs) {
      const unit = new Player();
      const create = (boosts) => ({
        uniqueHrid: ordinary.uniqueHrid,
        typeHrid: ordinary.typeHrid,
        duration: 100e9,
        ...boosts,
      });

      unit.addBuff(create(ordinary.first), 0, 'first');
      unit.addBuff(create(ordinary.second), 1, 'second');

      expect(unit.activeBuffSourceKeys[ordinary.uniqueHrid]).toBe('second');
      expect(unit.combatBuffs[ordinary.uniqueHrid]).toMatchObject(ordinary.second);
    }
  });

  it('uses strongest-source handoff only when explicitly requested', () => {
    const unit = new Player();
    const uniqueHrid = '/buff_uniques/speed_aura_attack_speed';
    const add = (ratioBoost, sourceKey, duration) =>
      unit.addBuff(makeBuff(uniqueHrid, ratioBoost, duration), 0, sourceKey, {
        sourcePolicy: BUFF_SOURCE_POLICY.STRONGEST,
      });

    add(0.03, 'weak', 1_000e9);
    add(0.15, 'strong', 100e9);

    expect(unit.activeBuffSourceKeys[uniqueHrid]).toBe('strong');
    unit.removeExpiredBuffs(101e9);
    expect(unit.activeBuffSourceKeys[uniqueHrid]).toBe('weak');
    expect(unit.combatBuffs[uniqueHrid].ratioBoost).toBe(0.03);
  });

  it('uses the official flat field for flat-only party aura strength', () => {
    const unit = new Player();
    const uniqueHrid = '/buff_uniques/guardian_aura_armor';
    const add = (flatBoost, sourceKey) =>
      unit.addBuff(
        {
          uniqueHrid,
          typeHrid: '/buff_types/armor',
          ratioBoost: 0,
          flatBoost,
          duration: 1_000e9,
        },
        0,
        sourceKey,
        { sourcePolicy: BUFF_SOURCE_POLICY.STRONGEST },
      );

    add(5, 'weak');
    add(25, 'strong');

    expect(unit.activeBuffSourceKeys[uniqueHrid]).toBe('strong');
    expect(unit.combatBuffs[uniqueHrid].flatBoost).toBe(25);
  });

  it('classifies only official party-aura ability buffs as strongest', () => {
    expect(
      isPartyAuraBuff({
        uniqueHrid: '/buff_uniques/speed_aura_attack_speed',
      }),
    ).toBe(true);
    expect(isPartyAuraBuff({ uniqueHrid: '/buff_uniques/curse' })).toBe(false);
    expect(
      getAbilityBuffSourcePolicy(
        { hrid: '/abilities/speed_aura' },
        { uniqueHrid: '/buff_uniques/speed_aura_attack_speed' },
      ),
    ).toBe(BUFF_SOURCE_POLICY.STRONGEST);
    expect(
      getAbilityBuffSourcePolicy({ hrid: '/abilities/mana_spring' }, { uniqueHrid: '/buff_uniques/mana_spring' }),
    ).toBe(BUFF_SOURCE_POLICY.REPLACE);
  });

  it('rejects changing the policy of an already registered uniqueHrid', () => {
    const unit = new Player();
    const uniqueHrid = '/buff_uniques/speed_aura_attack_speed';
    unit.addBuff(makeBuff(uniqueHrid, 0.1), 0, 'source', {
      sourcePolicy: BUFF_SOURCE_POLICY.REPLACE,
    });

    expect(() =>
      unit.addBuff(makeBuff(uniqueHrid, 0.2), 1, 'source', {
        sourcePolicy: BUFF_SOURCE_POLICY.STRONGEST,
      }),
    ).toThrow(/policy mismatch/);
  });

  it('fails fast when the official data adds a party aura buff not in the snapshot', () => {
    const officialBuffs = [
      ...Object.keys(PARTY_AURA_STRENGTH_FIELDS).map((uniqueHrid) => ({
        uniqueHrid,
        ratioBoost: 0,
        flatBoost: 0.02,
      })),
      { uniqueHrid: '/buff_uniques/new_official_aura', ratioBoost: 0.01, flatBoost: 0 },
    ];

    expect(() => assertPartyAuraSnapshotMatchesOfficialData(officialBuffs)).toThrow(
      /Unexpected in official data: \/buff_uniques\/new_official_aura/,
    );
  });

  it('fails fast when the official data removes a party aura buff from the snapshot', () => {
    const officialBuffs = Object.keys(PARTY_AURA_STRENGTH_FIELDS)
      .filter((uniqueHrid) => uniqueHrid !== '/buff_uniques/fierce_aura')
      .map((uniqueHrid) => ({
        uniqueHrid,
        ratioBoost: 0,
        flatBoost: 0.02,
      }));

    expect(() => assertPartyAuraSnapshotMatchesOfficialData(officialBuffs)).toThrow(
      /Missing from official data: \/buff_uniques\/fierce_aura/,
    );
  });

  it('fails fast when a party aura buff shape changes (negative or mixed fields)', () => {
    const officialBuffs = Object.keys(PARTY_AURA_STRENGTH_FIELDS).map((uniqueHrid) => ({
      uniqueHrid,
      ratioBoost: 0,
      flatBoost: 0.02,
    }));
    officialBuffs.find((buff) => buff.uniqueHrid === '/buff_uniques/speed_aura_attack_speed').ratioBoost = -0.01;

    expect(() => assertPartyAuraSnapshotMatchesOfficialData(officialBuffs)).toThrow(
      /Party aura strength shape changed for \/buff_uniques\/speed_aura_attack_speed/,
    );
  });

  it('accepts the checked-in official snapshot without throwing', () => {
    expect(() => assertPartyAuraSnapshotMatchesOfficialData()).not.toThrow();
  });
});

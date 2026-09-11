import { describe, expect, it, vi } from 'vitest';
import CombatUnit from '../combatUnit.js';
import Equipment from '../equipment.js';
import Monster from '../monster.js';
import Player from '../player.js';
import combatMonsterDetailMap from '../data/combatMonsterDetailMap.json';

const LEVELS = ['stamina', 'intelligence', 'attack', 'melee', 'defense', 'ranged', 'magic'];
const INITIAL_STATS = new CombatUnit().combatDetails.combatStats;
const SPECIAL_PLAYER_STATS = new Set([
  'attackInterval',
  'foodSlots',
  'drinkSlots',
  'damageTaken',
  'armorDamageRatio',
  'hpDrainRatio',
  'maxHitpointsRatio',
  'maxManapointsRatio',
]);
// Derive the additive schema from the unit contract, independently of the
// production equipment/default-stat lists. Haste and tenacity are optional.
const EQUIPMENT_STATS = [
  ...Object.keys(INITIAL_STATS).filter(
    (stat) => typeof INITIAL_STATS[stat] === 'number' && !SPECIAL_PLAYER_STATS.has(stat),
  ),
  'abilityHaste',
  'tenacity',
];
const MONSTER_DEFAULT_STATS = EQUIPMENT_STATS.filter((stat) => !LEVELS.some((level) => stat === `${level}Experience`));

function buff(uniqueHrid, type, ratioBoost, flatBoost, duration = 100e9) {
  return { uniqueHrid, typeHrid: `/buff_types/${type}`, ratioBoost, flatBoost, duration };
}

function expectLegacyEquipmentSums(player) {
  const expectedBase = { ...player.baseCombatStats };
  for (const stat of EQUIPMENT_STATS) {
    expectedBase[stat] = Object.values(player.equipment)
      .filter((equipment) => equipment != null)
      .map((equipment) => equipment.getCombatStat(stat))
      .reduce((previous, current) => previous + current, 0);
  }
  expect(player.baseCombatStats).toStrictEqual(expectedBase);

  const reference = new CombatUnit();
  reference.isPlayer = true;
  reference.equipment = player.equipment;
  for (const level of LEVELS) reference[`${level}Level`] = player[`${level}Level`];
  reference.combatDetails.combatStats = expectedBase;
  reference.combatBuffs = structuredClone(player.combatBuffs);
  reference.updateCombatDetails();
  expect(player.combatDetails).toStrictEqual(reference.combatDetails);
}

function referenceMonster(hrid, difficultyTier, roomLevel, buffs = {}) {
  const definition = combatMonsterDetailMap[hrid];
  const reference = new CombatUnit();
  reference.isPlayer = false;
  const scale = roomLevel / 100;
  for (const level of LEVELS) {
    const multiplier = 1 + (level === 'defense' ? 0.15 : 0.25) * difficultyTier;
    reference[`${level}Level`] = multiplier * (definition.combatDetails[`${level}Level`] + 20 * difficultyTier) * scale;
  }
  const stats = reference.combatDetails.combatStats;
  const source = definition.combatDetails.combatStats;
  stats.combatStyleHrid = source.combatStyleHrids[0];
  // Preserve the previous copy/default sequence as an independent oracle.
  for (const [key, value] of Object.entries(source)) stats[key] = value;
  for (const stat of ['armor', 'waterResistance', 'natureResistance', 'fireResistance']) stats[stat] *= scale;
  for (const stat of MONSTER_DEFAULT_STATS) if (source[stat] == null) stats[stat] = 0;
  if (stats.attackInterval == 0) stats.attackInterval = definition.combatDetails.attackInterval;
  reference.combatBuffs = structuredClone(buffs);
  reference.updateCombatDetails();
  return reference;
}

function legacyReset(currentTime = 0) {
  this.clearCCs();
  if (currentTime == 0 || !this.isPlayer) {
    this.clearBuffs();
    this.updateCombatDetails();
    this.resetCooldowns(currentTime);
  } else {
    this.removeExpiredBuffs(currentTime, { updateDetails: false });
    this.updateCombatDetails();
  }
  this.combatDetails.currentHitpoints = this.combatDetails.maxHitpoints;
  this.combatDetails.currentManapoints = this.combatDetails.maxManapoints;
}

function createResetUnit(kind) {
  const unit =
    kind === 'player'
      ? new Player()
      : kind === 'monster'
        ? new Monster('/monsters/chronofrost_sorcerer', 1, 73)
        : new CombatUnit();
  if (kind === 'unit') unit.isPlayer = false;
  unit.permanentBuffs = {
    health: buff('permanent-health', 'max_hitpoints', 0.125, 37),
    speed: buff('permanent-speed', 'attack_speed', 0.05, 0),
  };
  unit.clearBuffs();
  unit.addBuff(buff('runtime-speed', 'attack_speed', 0.3, 0), 0, 'speed-source');
  unit.addBuff(buff('runtime-curse', 'damage_taken', 0, 0.04, 20e9), 0, 'curse-source');
  unit.food = [{ lastUsed: 17e9 }, null, { lastUsed: 19e9 }];
  unit.drinks = [null, { lastUsed: 23e9 }, null];
  unit.abilities = [{ lastUsed: 29e9, cooldownDuration: 20e9 }, null, { lastUsed: 31e9, cooldownDuration: 80e9 }];
  unit.isStunned = unit.isSilenced = unit.isBlinded = true;
  unit.stunExpireTime = unit.silenceExpireTime = unit.blindExpireTime = 100e9;
  unit.combatDetails.currentHitpoints = 0;
  unit.combatDetails.currentManapoints = 3;
  return unit;
}

function resetSnapshot(unit, time, reset = unit.reset, includeBaseline = true) {
  const randomCalls = [];
  const random = vi.spyOn(Math, 'random').mockImplementation(() => {
    const value = randomCalls.length % 2 === 0 ? 0.125 : 0.875;
    randomCalls.push(value);
    return value;
  });
  try {
    reset.call(unit, time);
    return structuredClone({
      combatDetails: unit.combatDetails,
      ...(includeBaseline ? { baseCombatStats: unit.baseCombatStats } : {}),
      combatBuffs: unit.combatBuffs,
      buffSources: unit.buffSources,
      activeBuffSourceKeys: unit.activeBuffSourceKeys,
      buffSourcePolicies: unit.buffSourcePolicies,
      buffSourceSequence: unit.buffSourceSequence,
      crowdControl: [
        unit.isStunned,
        unit.isSilenced,
        unit.isBlinded,
        unit.stunExpireTime,
        unit.silenceExpireTime,
        unit.blindExpireTime,
      ],
      food: unit.food,
      drinks: unit.drinks,
      abilities: unit.abilities,
      randomCalls,
    });
  } finally {
    random.mockRestore();
  }
}

describe('combat stat recalculation', () => {
  it('keeps empty enemy buff dictionaries isolated between resets and units', () => {
    const first = new Monster('/monsters/fly', 0);
    const second = new Monster('/monsters/fly', 0);
    first.clearBuffs();
    second.clearBuffs();
    const previous = first.combatBuffs;
    expect(previous).not.toBe(first.permanentBuffs);
    expect(previous).not.toBe(second.combatBuffs);
    previous.temporary = buff('temporary', 'armor', 0, 10);
    expect(first.permanentBuffs).toEqual({});
    expect(second.combatBuffs).toEqual({});
    first.clearBuffs();
    expect(first.combatBuffs).toEqual({});
    expect(first.combatBuffs).not.toBe(previous);
  });

  it('deeply isolates populated enemy permanent buffs and preserves their effects', () => {
    const monster = new Monster('/monsters/fly', 0);
    monster.permanentBuffs = {
      armor: { ...buff('armor', 'armor', 0.17, 3), metadata: { sources: ['permanent'] } },
    };
    const permanent = structuredClone(monster.permanentBuffs);
    monster.clearBuffs();
    const details = structuredClone(monster.combatDetails);
    monster.combatBuffs.armor.metadata.sources.push('runtime');
    monster.combatBuffs.armor.flatBoost = 999;
    expect(monster.permanentBuffs).toStrictEqual(permanent);
    monster.clearBuffs();
    expect(monster.combatBuffs).toStrictEqual(permanent);
    expect(monster.combatDetails).toStrictEqual(details);
  });

  it.each([() => [], () => Object.create(null)])('retains cloning semantics for another empty container', (create) => {
    const unit = new CombatUnit();
    unit.isPlayer = false;
    unit.permanentBuffs = create();
    const expected = structuredClone(unit.permanentBuffs);
    unit.clearBuffs();
    expect(unit.combatBuffs).toStrictEqual(expected);
    expect(unit.combatBuffs).not.toBe(unit.permanentBuffs);
  });

  it.each([undefined, true, false, {}, 'fresh', Symbol('fresh-combat-stats')])(
    'restores a standalone unit baseline for an ordinary argument %s',
    (argument) => {
      const unit = new CombatUnit();
      unit.isPlayer = true;
      unit.combatDetails.combatStats.armor = 37;
      unit.combatBuffs = {
        armor: buff('armor', 'armor', 0.13, 0.17),
        speed: buff('speed', 'attack_speed', 0.23, 0),
      };
      unit.updateCombatDetails();
      const expected = structuredClone(unit.combatDetails);
      unit.combatDetails.combatStats.armor = 999;
      unit.combatDetails.combatStats.hpRegenPer10 = 100;
      unit.combatDetails.combatStats.attackInterval = 1;
      unit.updateCombatDetails(argument);
      expect(unit.combatDetails).toStrictEqual(expected);
    },
  );

  it.each(['refreshBaseCombatStats', 'updateCombatDetailsFromBuffs'])(
    'restores stats changed by an overridden %s',
    (method) => {
      const player = new Player();
      const reference = new Player();
      reference.updateCombatDetails();
      const original = player[method];
      player[method] = function (...args) {
        if (method === 'refreshBaseCombatStats') original.apply(this, args);
        this.combatDetails.combatStats.armor = 999;
        this.combatDetails.combatStats.hpRegenPer10 = 100;
        if (method !== 'refreshBaseCombatStats') original.apply(this, args);
      };
      player.updateCombatDetails();
      expect(player.combatDetails).toStrictEqual(reference.combatDetails);
    },
  );

  it.each(['instance', 'prototype'])('retains an overridden baseline restoration on the %s', (target) => {
    const player = new Player();
    const reference = new Player();
    reference.equipment['/equipment_types/head'] = { getCombatStat: (stat) => (stat === 'armor' ? 7 : 0) };
    reference.updateCombatDetails();
    const original = CombatUnit.prototype.resetCombatStatsToBase;
    const override = vi
      .spyOn(target === 'prototype' ? CombatUnit.prototype : player, 'resetCombatStatsToBase')
      .mockImplementation(function () {
        original.call(this);
        this.combatDetails.combatStats.armor += 7;
      });
    try {
      player.updateCombatDetails();
      expect(player.combatDetails).toStrictEqual(reference.combatDetails);
    } finally {
      override.mockRestore();
    }
  });

  it.each([false, true])('matches full restoration when a buff reader reenters (legacy index = %s)', (legacy) => {
    const run = (forceRestore) => {
      const player = new Player();
      player.combatBuffs = {
        armor: buff('armor', 'armor', 0.17, 0.29),
        speed: buff('speed', 'attack_speed', 0.13, 0),
        ...(legacy ? { legacy: { typeHrid: 1, ratioBoost: 0, flatBoost: 0 } } : {}),
      };
      if (forceRestore) {
        const refresh = player.refreshBaseCombatStats;
        player.refreshBaseCombatStats = function () {
          return refresh.call(this);
        };
      }
      const lookup = player.getBuffBoost;
      let entered = false;
      player.getBuffBoost = function (type) {
        if (!entered) {
          entered = true;
          this.updateCombatDetails();
        }
        return lookup.call(this, type);
      };
      player.updateCombatDetails();
      player.combatBuffs.armor.flatBoost = 3;
      expect(player.getBuffBoosts('/buff_types/armor')).toEqual([{ ratioBoost: 0.17, flatBoost: 3 }]);
      return structuredClone(player.combatDetails);
    };
    expect(run(false)).toStrictEqual(run(true));
  });

  it('restores the lookup after a mid-calculation exception and retries with current buffs', () => {
    const player = new Player();
    player.combatBuffs = { armor: buff('armor', 'armor', 0.17, 0.29) };
    const lookup = player.getBuffBoost;
    let shouldThrow = true;
    player.getBuffBoost = function (type) {
      if (shouldThrow) {
        shouldThrow = false;
        throw new Error('interrupted stat calculation');
      }
      return lookup.call(this, type);
    };
    expect(() => player.updateCombatDetails()).toThrow('interrupted stat calculation');
    player.combatBuffs.armor.flatBoost = 3;
    expect(player.getBuffBoosts('/buff_types/armor')).toEqual([{ ratioBoost: 0.17, flatBoost: 3 }]);
    player.updateCombatDetails();
    const reference = new Player();
    reference.combatBuffs = structuredClone(player.combatBuffs);
    reference.updateCombatDetails();
    expect(player.combatDetails).toStrictEqual(reference.combatDetails);
  });

  it('preserves equipment enumeration and order-sensitive sums for every additive stat', () => {
    const player = new Player();
    const calls = [];
    for (const [slot, value] of [
      ['10', 1],
      ['2', -1e16],
      ['1', 1e16],
    ]) {
      player.equipment[slot] = {
        getCombatStat(stat) {
          calls.push([stat, slot]);
          return value;
        },
      };
    }
    player.equipment.missing = undefined;
    player.updateCombatDetails();
    expect(new Set(calls.map(([stat]) => stat))).toStrictEqual(new Set(EQUIPMENT_STATS));
    for (const stat of EQUIPMENT_STATS) {
      expect(player.baseCombatStats[stat]).toBe(1);
      expect(calls.filter(([queried]) => queried === stat).map(([, slot]) => slot)).toEqual(['1', '2', '10']);
    }
    expectLegacyEquipmentSums(player);
  });

  it('observes equipment replacement, enhancement changes, and unequipping on the next recalculation', () => {
    const player = new Player();
    player.attackLevel = 83;
    player.defenseLevel = 79;
    player.equipment['/equipment_types/head'] = new Equipment('/items/cheese_helmet', 2);
    player.equipment['/equipment_types/main_hand'] = new Equipment('/items/cheese_sword', 3);
    player.equipment['/equipment_types/pouch'] = new Equipment('/items/large_pouch', 0);
    player.equipment['/equipment_types/charm'] = new Equipment('/items/trainee_attack_charm', 0);
    player.addBuff(buff('amplify', 'physical_amplify', 0, 0.17), 0);
    expectLegacyEquipmentSums(player);
    expect(player.combatDetails.combatStats.foodSlots).toBe(3);
    expect(player.combatDetails.combatStats.focusTraining).toBe('/skills/attack');

    player.equipment['/equipment_types/head'].enhancementLevel = 11;
    player.equipment['/equipment_types/main_hand'] = null;
    player.equipment['/equipment_types/two_hand'] = new Equipment('/items/cheese_bulwark', 7);
    player.updateCombatDetails();
    expectLegacyEquipmentSums(player);
    const withEquipment = structuredClone(player.combatDetails);
    player.updateCombatDetails();
    expect(player.combatDetails).toStrictEqual(withEquipment);

    for (const slot of Object.keys(player.equipment)) player.equipment[slot] = null;
    player.updateCombatDetails();
    expectLegacyEquipmentSums(player);
    expect(player.combatDetails.combatStats.foodSlots).toBe(1);
    expect(player.combatDetails.combatStats.drinkSlots).toBe(1);
    expect(player.combatDetails.combatStats.focusTraining).toBe('');
  });

  it.each([
    ['/monsters/fly', 0, 100],
    ['/monsters/abyssal_imp', 2, 100],
    ['/monsters/chronofrost_sorcerer', 1, 73],
    ['/monsters/granite_golem', 3, 137],
  ])('matches legacy copying and scaling for %s, tier %i, room %i', (hrid, difficultyTier, roomLevel) => {
    const monster = new Monster(hrid, difficultyTier, roomLevel);
    monster.combatBuffs = {
      armor: buff('armor', 'armor', 0.17, 0.29),
      speed: buff('speed', 'attack_speed', 0.13, 0),
    };
    for (let pass = 0; pass < 3; pass += 1) {
      monster.updateCombatDetails();
      const reference = referenceMonster(hrid, monster.difficultyTier, monster.roomLevel, monster.combatBuffs);
      expect(monster.combatDetails).toStrictEqual(reference.combatDetails);
      expect(monster.baseCombatStats).toStrictEqual(reference.baseCombatStats);
      expect(monster.experience).toBe(
        (1 + 0.5 * monster.difficultyTier) * (combatMonsterDetailMap[hrid].experience + 5 * monster.difficultyTier),
      );
      monster.difficultyTier += 1;
      monster.roomLevel += 13;
    }
  });

  it('retains null defaults, unknown official fields, and the zero attack-interval fallback', () => {
    const hrid = '/monsters/stat_recalculation_fixture';
    const definition = structuredClone(combatMonsterDetailMap['/monsters/fly']);
    definition.combatDetails.combatStats = {
      combatStyleHrids: ['/combat_styles/smash'],
      damageType: '/damage_types/physical',
      attackInterval: 0,
      armor: null,
      waterResistance: undefined,
      natureResistance: 0,
      fireResistance: 17,
      abilityHaste: 0,
      tenacity: null,
      maxHitpointsRatio: 2.3,
      extraOfficialField: 0.75,
    };
    combatMonsterDetailMap[hrid] = definition;
    try {
      const monster = new Monster(hrid, 2, 73);
      monster.updateCombatDetails();
      const reference = referenceMonster(hrid, 2, 73);
      expect(monster.combatDetails).toStrictEqual(reference.combatDetails);
      expect(monster.baseCombatStats).toStrictEqual(reference.baseCombatStats);
      expect(monster.baseCombatStats.attackInterval).toBe(definition.combatDetails.attackInterval);
      expect(monster.baseCombatStats.armor).toBe(0);
      expect(monster.baseCombatStats.extraOfficialField).toBe(0.75);

      definition.combatDetails.combatStats.fireResistance = 31;
      monster.updateCombatDetails();
      expect(monster.baseCombatStats.fireResistance).toBe(31 * 0.73);
    } finally {
      delete combatMonsterDetailMap[hrid];
    }
  });

  it.each([
    ['player', 0],
    ['monster', 0],
    ['monster', 50e9],
    ['unit', 50e9],
  ])('fully resets %s at %i with one recalculation and identical cooldown RNG', (kind, time) => {
    const actual = createResetUnit(kind);
    const reference = createResetUnit(kind);
    const update = vi.spyOn(actual, 'updateCombatDetails');
    expect(resetSnapshot(actual, time)).toStrictEqual(resetSnapshot(reference, time, legacyReset));
    expect(update).toHaveBeenCalledTimes(1);
    expect(actual.buffSources).toEqual({});
    expect(actual.combatDetails.currentHitpoints).toBe(actual.combatDetails.maxHitpoints);
    expect(actual.combatDetails.currentManapoints).toBe(actual.combatDetails.maxManapoints);
  });

  it('retains live buffs and cooldowns during a player dungeon restart', () => {
    const actual = createResetUnit('player');
    const reference = createResetUnit('player');
    const update = vi.spyOn(actual, 'updateCombatDetails');
    expect(resetSnapshot(actual, 50e9)).toStrictEqual(resetSnapshot(reference, 50e9, legacyReset));
    expect(update).toHaveBeenCalledTimes(1);
    expect(actual.combatBuffs['runtime-speed']).toBeDefined();
    expect(actual.combatBuffs['runtime-curse']).toBeUndefined();
    expect(actual.abilities[0].lastUsed).toBe(29e9);
    expect(actual.food[0].lastUsed).toBe(17e9);
  });

  it('keeps clearBuffs synchronous for direct respawn callers without refilling resources', () => {
    const player = createResetUnit('player');
    const update = vi.spyOn(player, 'updateCombatDetails');
    player.clearBuffs();
    expect(update).toHaveBeenCalledTimes(1);
    expect(player.combatDetails.combatStats.damageTaken).toBe(0);
    expect(player.combatBuffs['runtime-speed']).toBeUndefined();
    expect(player.combatDetails.currentHitpoints).toBe(0);
    expect(player.combatDetails.currentManapoints).toBe(3);
  });

  it('keeps a permanent damage-taken buff effective after reset and later recalculations', () => {
    const actual = createResetUnit('player');
    const reference = createResetUnit('player');
    for (const unit of [actual, reference])
      unit.permanentBuffs.damage = buff('permanent-damage', 'damage_taken', 0, 0.07);
    // damageTaken is derived afresh from buffs on every call. Its intermediate
    // baseline snapshot need not capture the previous redundant pass.
    expect(resetSnapshot(actual, 0, actual.reset, false)).toStrictEqual(
      resetSnapshot(reference, 0, legacyReset, false),
    );
    expect(actual.combatDetails.combatStats.damageTaken).toBe(0.07);
    for (let pass = 0; pass < 3; pass += 1) {
      actual.updateCombatDetails();
      reference.updateCombatDetails();
      expect(actual.combatDetails).toStrictEqual(reference.combatDetails);
      expect(actual.baseCombatStats).toStrictEqual(reference.baseCombatStats);
    }
  });
});

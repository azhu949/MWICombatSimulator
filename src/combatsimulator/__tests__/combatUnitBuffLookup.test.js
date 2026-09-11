import { describe, expect, it, vi } from 'vitest';
import CombatUnit from '../combatUnit.js';
import buffTypeDetailMap from '../data/buffTypeDetailMap.json';

function legacyLookup(type) {
  return Object.values(this.combatBuffs)
    .filter((buff) => buff.typeHrid == type)
    .map((buff) => ({ ratioBoost: buff.ratioBoost, flatBoost: buff.flatBoost }));
}

function buff(type, ratioBoost = 0, flatBoost = 0) {
  return { typeHrid: `/buff_types/${type}`, ratioBoost, flatBoost };
}

function createUnit(buffs, isPlayer = true, legacy = false) {
  const unit = new CombatUnit();
  unit.isPlayer = isPlayer;
  unit.combatBuffs = structuredClone(buffs);
  ['stamina', 'intelligence', 'attack', 'melee', 'defense', 'ranged', 'magic'].forEach((stat, index) => {
    unit[`${stat}Level`] = 31 + index * 13;
  });
  if (legacy) {
    unit.updateCombatDetails = unit.updateCombatDetailsFromBuffs;
    unit.getBuffBoosts = legacyLookup;
  }
  return unit;
}

describe('buff lookup during stat recalculation', () => {
  it.each([true, false])('matches all derived stats with mixed buff types (isPlayer = %s)', (isPlayer) => {
    const types = Object.keys(buffTypeDetailMap);
    const buffs = Object.fromEntries(
      [0, 1, 2].flatMap((round) =>
        types.map((typeHrid, index) => [
          `${round}-${index}`,
          {
            uniqueHrid: `${round}-${index}`,
            typeHrid,
            ratioBoost: ((index % 5) - round) / 100,
            flatBoost: (round - 1) / 10,
          },
        ]),
      ),
    );
    const actual = createUnit(buffs, isPlayer);
    const expected = createUnit(buffs, isPlayer, true);
    for (let round = 0; round < 3; round += 1) {
      actual.updateCombatDetails();
      expected.updateCombatDetails();
      expect(actual.combatDetails).toStrictEqual(expected.combatDetails);
      expect(actual.baseCombatStats).toStrictEqual(expected.baseCombatStats);
    }
  });

  it('preserves Object.values order and order-sensitive floating-point sums', () => {
    const buffs = {};
    // Integer keys enumerate numerically, even though they were inserted in a different order.
    buffs['10'] = buff('armor', 0, 1);
    buffs['2'] = buff('armor', 0, -1e16);
    buffs['1'] = buff('armor', 0, 1e16);
    buffs.speed1 = buff('attack_speed', 1e16);
    buffs.other = buff('water_resistance', 0.1, 0.2);
    buffs.speed2 = buff('attack_speed', -1e16);
    buffs.speed3 = buff('attack_speed', 1);
    const actual = createUnit(buffs);
    const expected = createUnit(buffs, true, true);
    actual.defenseLevel = expected.defenseLevel = 0;
    actual.updateCombatDetails();
    expected.updateCombatDetails();
    expect(actual.combatDetails).toStrictEqual(expected.combatDetails);
    expect(actual.combatDetails.totalArmor).toBe(1);
    expect(actual.combatDetails.combatStats.attackInterval).toBe(3e9 / (1 + actual.attackLevel / 2000) / 2);
  });

  it('observes direct mutations, replacement, addition, and deletion on the next recalculation', () => {
    const unit = createUnit({ first: buff('armor', 0.1, 2), second: buff('attack_speed', 0.2) });
    const check = () => {
      const reference = createUnit(unit.combatBuffs, true, true);
      unit.updateCombatDetails();
      reference.updateCombatDetails();
      expect(unit.combatDetails).toStrictEqual(reference.combatDetails);
    };
    check();
    unit.combatBuffs.first.ratioBoost = 0.7;
    unit.combatBuffs.first.typeHrid = '/buff_types/fire_resistance';
    unit.combatBuffs.third = buff('armor', 0.4, 3);
    delete unit.combatBuffs.second;
    expect(unit.getBuffBoosts('/buff_types/armor')).toEqual([{ ratioBoost: 0.4, flatBoost: 3 }]);
    check();
    unit.combatBuffs = { replacement: buff('max_hitpoints', 0.25, 100) };
    check();
    unit.combatBuffs = {};
    check();
  });

  it('returns fresh projections both during and after recalculation', () => {
    const unit = createUnit({ first: buff('armor', 0.1, 2) });
    const check = () => {
      const first = unit.getBuffBoosts('/buff_types/armor');
      first[0].flatBoost = 999;
      first.push({ ratioBoost: 999, flatBoost: 999 });
      expect(unit.getBuffBoosts('/buff_types/armor')).toEqual([{ ratioBoost: 0.1, flatBoost: 2 }]);
    };
    vi.spyOn(unit, 'updateCombatDetailsFromBuffs').mockImplementationOnce(check);
    unit.updateCombatDetails();
    check();
    expect(unit.combatBuffs.first.flatBoost).toBe(2);
  });

  it('discards the temporary lookup when recalculation throws', () => {
    const unit = createUnit({ first: buff('armor', 0.1, 2) });
    vi.spyOn(unit, 'updateCombatDetailsFromBuffs').mockImplementationOnce(() => {
      expect(unit.getBuffBoosts('/buff_types/armor')).toEqual([{ ratioBoost: 0.1, flatBoost: 2 }]);
      throw new Error('recalculation failed');
    });
    expect(() => unit.updateCombatDetails()).toThrow('recalculation failed');
    unit.combatBuffs = { second: buff('armor', 0.3, 4) };
    expect(unit.getBuffBoosts('/buff_types/armor')).toEqual([{ ratioBoost: 0.3, flatBoost: 4 }]);
    unit.updateCombatDetails();
    const reference = createUnit(unit.combatBuffs, true, true);
    reference.updateCombatDetails();
    expect(unit.combatDetails).toStrictEqual(reference.combatDetails);
  });

  it('retains loose-equality lookup semantics for legacy non-string records and queries', () => {
    const unit = createUnit({
      numeric: { typeHrid: 1, ratioBoost: 0.1, flatBoost: 2 },
      string: { typeHrid: '1', ratioBoost: 0.2, flatBoost: 3 },
      regular: buff('armor', 0.3, 4),
    });
    const check = () => {
      for (const type of [1, '1', '/buff_types/armor', undefined])
        expect(unit.getBuffBoosts(type)).toEqual(legacyLookup.call(unit, type));
    };
    vi.spyOn(unit, 'updateCombatDetailsFromBuffs').mockImplementationOnce(check);
    unit.updateCombatDetails();
    check();
  });
});

import { describe, expect, it, vi } from 'vitest';
import Consumable from '../consumable.js';
import Trigger from '../trigger.js';

const SECOND = 1e9;
const RESOURCE_CASES = [
  {
    condition: 'missing_hp',
    maximum: 'maxHitpoints',
    current: 'currentHitpoints',
    hrid: '/items/blackberry_cake',
  },
  {
    condition: 'missing_mp',
    maximum: 'maxManapoints',
    current: 'currentManapoints',
    hrid: '/items/apple_gummy',
  },
];

function createSource() {
  return {
    isStunned: false,
    combatBuffs: {},
    combatDetails: {
      maxHitpoints: 100,
      currentHitpoints: 30,
      maxManapoints: 200,
      currentManapoints: 160,
      combatStats: { foodHaste: 0, drinkConcentration: 0 },
    },
  };
}

function createTrigger({
  dependency = 'self',
  condition = 'missing_hp',
  comparator = 'greater_than_equal',
  value = 50,
} = {}) {
  return new Trigger(
    `/combat_trigger_dependencies/${dependency}`,
    `/combat_trigger_conditions/${condition}`,
    `/combat_trigger_comparators/${comparator}`,
    value,
  );
}

describe.each(RESOURCE_CASES)('Consumable $condition comparisons', ({ condition, maximum, current, hrid }) => {
  it.each([
    { max: 100.75, now: 50.5, threshold: 50, expected: true },
    { max: 100.75, now: 50.5, threshold: 50.25, expected: true },
    { max: 100.75, now: 50.5, threshold: 50.5, expected: false },
    { max: 100, now: 0, threshold: 100, expected: true },
    { max: 100, now: 100, threshold: 1, expected: false },
    { max: 100, now: 100, threshold: 0, expected: true },
    { max: 100, now: 105, threshold: 0, expected: false },
  ])('matches native Trigger for max=$max, current=$now, threshold=$threshold', ({ max, now, threshold, expected }) => {
    const source = createSource();
    source.combatDetails[maximum] = max;
    source.combatDetails[current] = now;
    const trigger = createTrigger({ condition, value: threshold });
    const consumable = new Consumable(hrid, [trigger]);

    // Exercise the native dependency/condition dispatcher as the reference.
    const nativeResult = trigger.isActive(source, null, [source], [], 0);
    expect(nativeResult).toBe(expected);
    expect(consumable.shouldTrigger(0, source, null, [source], [])).toBe(nativeResult);
  });

  it('uses the current resource cap after buffs change it', () => {
    const source = createSource();
    source.combatDetails[current] = 60.5;
    const trigger = createTrigger({ condition, value: 50.25 });
    const consumable = new Consumable(hrid, [trigger]);

    for (const [max, expected] of [
      [100.75, false],
      [110.75, true],
      [90.75, false],
    ]) {
      source.combatDetails[maximum] = max;
      const nativeResult = trigger.isActive(source, null, [source], [], 0);
      expect(nativeResult).toBe(expected);
      expect(consumable.shouldTrigger(0, source, null, [source], [])).toBe(nativeResult);
    }
  });

  it('passes the unrounded deficit through a compareValue observer on every check', () => {
    const source = createSource();
    source.combatDetails[maximum] = 100.75;
    source.combatDetails[current] = 50.5;
    const trigger = createTrigger({ condition, value: 50.5 });
    const consumable = new Consumable(hrid, [trigger]);
    const nativeCompare = trigger.compareValue;
    // The optimizer wraps this method to observe both failed and successful comparisons.
    trigger.compareValue = vi.fn(function (value) {
      return nativeCompare.call(this, value);
    });

    expect(consumable.shouldTrigger(0, source, null, [source], [])).toBe(false);
    source.combatDetails[current] = 50.25;
    expect(consumable.shouldTrigger(0, source, null, [source], [])).toBe(true);
    trigger.value = 51;
    expect(consumable.shouldTrigger(0, source, null, [source], [])).toBe(false);

    expect(trigger.compareValue.mock.calls).toEqual([[50.25], [50.5], [50.5]]);
  });

  it('does not compare or consume while stunned', () => {
    const source = createSource();
    const trigger = createTrigger({ condition, value: 1 });
    const consumable = new Consumable(hrid, [trigger]);
    const compare = vi.spyOn(trigger, 'compareValue');
    source.isStunned = true;

    expect(consumable.shouldTrigger(0, source, null, [source], [])).toBe(false);
    expect(compare).not.toHaveBeenCalled();
    source.isStunned = false;
    expect(consumable.shouldTrigger(0, source, null, [source], [])).toBe(true);
    expect(compare).toHaveBeenCalledOnce();
  });
});

describe('Consumable cooldown gates', () => {
  it.each([
    { kind: 'food', hrid: '/items/blackberry_cake', foodHaste: 1, drinkConcentration: 3, fraction: 0.5 },
    { kind: 'drink', hrid: '/items/attack_coffee', foodHaste: 3, drinkConcentration: 1, fraction: 0.5 },
    { kind: 'food', hrid: '/items/blackberry_cake', foodHaste: 0, drinkConcentration: 3, fraction: 1 },
    { kind: 'drink', hrid: '/items/attack_coffee', foodHaste: 3, drinkConcentration: 0, fraction: 1 },
    { kind: 'food', hrid: '/items/blackberry_cake', foodHaste: -0.5, drinkConcentration: 3, fraction: 1 },
    { kind: 'drink', hrid: '/items/attack_coffee', foodHaste: 3, drinkConcentration: -0.5, fraction: 1 },
  ])(
    'gates $kind using foodHaste=$foodHaste and drinkConcentration=$drinkConcentration',
    ({ hrid, foodHaste, drinkConcentration, fraction }) => {
      const source = createSource();
      source.combatDetails.combatStats = { foodHaste, drinkConcentration };
      const trigger = createTrigger({ value: 1 });
      const consumable = new Consumable(hrid, [trigger]);
      const compare = vi.spyOn(trigger, 'compareValue');
      consumable.lastUsed = 10 * SECOND;
      const readyAt = consumable.lastUsed + consumable.cooldownDuration * fraction;

      expect(consumable.shouldTrigger(readyAt - 1, source, null, [source], [])).toBe(false);
      expect(compare).not.toHaveBeenCalled();
      expect(consumable.shouldTrigger(readyAt, source, null, [source], [])).toBe(true);
      expect(consumable.shouldTrigger(readyAt + 1, source, null, [source], [])).toBe(true);
      expect(compare.mock.calls).toEqual([[70], [70]]);
    },
  );
});

describe('Consumable general trigger rules', () => {
  it.each([
    { dependency: 'targeted_enemy', condition: 'missing_hp', value: 25, expected: false },
    { dependency: 'all_allies', condition: 'missing_mp', value: 100, expected: true },
    { dependency: 'all_enemies', condition: 'number_of_active_units', value: 2, expected: false },
    { condition: 'missing_hp', comparator: 'less_than_equal', value: 69, expected: false },
    { condition: 'missing_mp', comparator: 'less_than_equal', value: 40, expected: true },
    { condition: 'current_hp', value: 50, expected: false },
    { condition: 'attack_coffee', comparator: 'is_inactive', expected: true },
  ])('delegates rule $condition / $dependency / $comparator to Trigger.isActive', (rule) => {
    const source = createSource();
    const target = createSource();
    target.combatDetails.currentHitpoints = 80;
    const ally = createSource();
    ally.combatDetails.currentManapoints = 140;
    const deadEnemy = createSource();
    deadEnemy.combatDetails.currentHitpoints = 0;
    const friendlies = [source, ally];
    const enemies = [target, deadEnemy];
    const currentTime = 10 * SECOND;
    const trigger = createTrigger(rule);
    const consumable = new Consumable('/items/blackberry_cake', [trigger]);
    const nativeResult = trigger.isActive(source, target, friendlies, enemies, currentTime);
    const isActive = vi.spyOn(trigger, 'isActive');

    expect(nativeResult).toBe(rule.expected);
    expect(consumable.shouldTrigger(currentTime, source, target, friendlies, enemies)).toBe(nativeResult);
    expect(isActive).toHaveBeenCalledOnce();
    expect(isActive).toHaveBeenCalledWith(source, target, friendlies, enemies, currentTime);
  });

  it.each([
    { hpThreshold: 71, mpThreshold: 40, expected: false },
    { hpThreshold: 70, mpThreshold: 41, expected: false },
    { hpThreshold: 70, mpThreshold: 40, expected: true },
  ])(
    'checks every rule with HP threshold=$hpThreshold and MP threshold=$mpThreshold',
    ({ hpThreshold, mpThreshold, expected }) => {
      const source = createSource();
      const friendlies = [source];
      const enemies = [];
      const triggers = [
        createTrigger({ condition: 'missing_hp', value: hpThreshold }),
        createTrigger({ condition: 'missing_mp', value: mpThreshold }),
      ];
      const activeChecks = triggers.map((trigger) => vi.spyOn(trigger, 'isActive'));
      const comparisons = triggers.map((trigger) => vi.spyOn(trigger, 'compareValue'));
      const consumable = new Consumable('/items/blackberry_cake', triggers);

      expect(consumable.shouldTrigger(0, source, null, friendlies, enemies)).toBe(expected);
      for (const check of activeChecks) {
        expect(check).toHaveBeenCalledOnce();
        expect(check).toHaveBeenCalledWith(source, null, friendlies, enemies, 0);
      }
      expect(comparisons[0].mock.calls).toEqual([[70]]);
      // A failed earlier rule must not hide later observations from the optimizer.
      expect(comparisons[1].mock.calls).toEqual([[40]]);
    },
  );
});

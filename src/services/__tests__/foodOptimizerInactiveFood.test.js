import { describe, expect, it } from 'vitest';
import { observeInactiveFoodThresholds } from '../foodOptimizerInactiveFood.js';

function fixture() {
  const food = [{ hrid: 'expand' }, { hrid: 'restore' }];
  const player = {
    hrid: 'player1',
    isStunned: false,
    food,
    combatDetails: { currentHitpoints: 100, maxHitpoints: 100, currentManapoints: 90, maxManapoints: 100 },
  };
  const simulator = {
    checkTriggersForUnit(unit) {
      for (const item of unit.food) this.tryUseConsumable(unit, item);
      return true;
    },
    tryUseConsumable(unit, item) {
      if (item.hrid === 'expand') unit.combatDetails.maxManapoints = 200;
      else unit.combatDetails.currentManapoints = unit.combatDetails.maxManapoints;
      return true;
    },
  };
  return { player, simulator };
}

describe('never-trigger bounds between food effects', () => {
  it('captures a deficit that rises and falls between two foods without changing execution', () => {
    const observed = fixture();
    const reference = fixture();
    const read = observeInactiveFoodThresholds(observed.simulator, 'player1');
    expect(observed.simulator.checkTriggersForUnit(observed.player)).toBe(
      reference.simulator.checkTriggersForUnit(reference.player),
    );
    expect(observed.player).toEqual(reference.player);
    // The entry deficit is 10 and the exit deficit is 0, but an inserted
    // food could see a deficit of 110 after the first food's stat change.
    expect(read()).toEqual({ hp: 1, mp: 111 });
  });

  it('observes potential new foods while every existing food is cooling down', () => {
    const { player, simulator } = fixture();
    simulator.checkTriggersForUnit = () => false;
    player.combatDetails.currentHitpoints = 79.8;
    player.combatDetails.currentManapoints = 48.1;
    const read = observeInactiveFoodThresholds(simulator, 'player1');
    simulator.checkTriggersForUnit(player);
    expect(read()).toEqual({ hp: 21, mp: 52 });
  });

  it('ignores dead, stunned and other units until the target can check food again', () => {
    const { player, simulator } = fixture();
    simulator.checkTriggersForUnit = () => false;
    const read = observeInactiveFoodThresholds(simulator, 'player1');
    player.isStunned = true;
    player.combatDetails.currentManapoints = 0;
    simulator.checkTriggersForUnit(player);
    player.isStunned = false;
    player.combatDetails.currentHitpoints = 0;
    simulator.checkTriggersForUnit(player);
    simulator.checkTriggersForUnit({
      ...player,
      hrid: 'player2',
      combatDetails: { ...player.combatDetails, currentHitpoints: 1 },
    });
    expect(read()).toEqual({ hp: 1, mp: 1 });
    player.combatDetails.currentHitpoints = 100;
    simulator.checkTriggersForUnit(player);
    expect(read()).toEqual({ hp: 1, mp: 101 });
  });

  it.each([NaN, Infinity])('declines certificates after nonfinite resource observations: %s', (current) => {
    const { player, simulator } = fixture();
    simulator.checkTriggersForUnit = () => false;
    const read = observeInactiveFoodThresholds(simulator, 'player1');
    player.combatDetails.currentManapoints = current;
    simulator.checkTriggersForUnit(player);
    player.combatDetails.currentManapoints = 100;
    simulator.checkTriggersForUnit(player);
    expect(read()).toBeNull();
  });

  it('returns independent certificates and leaves normal consumable return values intact', () => {
    const { player, simulator } = fixture();
    const read = observeInactiveFoodThresholds(simulator, 'player1');
    expect(simulator.tryUseConsumable(player, player.food[0])).toBe(true);
    const first = read();
    first.mp = 1;
    expect(read()).toEqual({ hp: 1, mp: 111 });
  });
});

import { describe, expect, it, vi } from 'vitest';
import CombatSimulator from '../../combatsimulator/combatSimulator.js';
import CombatUnit, { FRESH_COMBAT_STATS } from '../../combatsimulator/combatUnit.js';
import Consumable from '../../combatsimulator/consumable.js';
import Trigger from '../../combatsimulator/trigger.js';
import { buildFoodCandidate } from '../foodOptimizerDomain.js';
import {
  createFoodOptimizerFixture,
  installLegacyBuffLookup,
  referenceFoodOptimizerRound,
} from './support/foodOptimizerTestSupport.js';

describe('independent food optimizer reference', () => {
  it('restores its baseline even when an optimized caller passes the fresh-base marker', () => {
    const unit = new CombatUnit();
    unit.combatDetails.combatStats.armor = 37;
    unit.combatBuffs = {
      armor: { typeHrid: '/buff_types/armor', ratioBoost: 0.13, flatBoost: 0.17 },
      speed: { typeHrid: '/buff_types/attack_speed', ratioBoost: 0.23, flatBoost: 0 },
    };
    unit.updateCombatDetails();
    const expected = structuredClone(unit.combatDetails);
    const originalUpdate = CombatUnit.prototype.updateCombatDetails;
    const restore = installLegacyBuffLookup();
    try {
      unit.combatDetails.combatStats.armor = 999;
      unit.combatDetails.combatStats.attackInterval = 1;
      unit.updateCombatDetails(FRESH_COMBAT_STATS);
      expect(unit.combatDetails).toStrictEqual(expected);
    } finally {
      restore();
    }
    expect(CombatUnit.prototype.updateCombatDetails).toBe(originalUpdate);
  });

  it('uses full results and generic consumable triggers without changing the request or leaving patches installed', async () => {
    const { request, items } = createFoodOptimizerFixture({ foodSlots: 1, seconds: 120, rounds: 1 });
    const food = items.find((item) => item.kind === 'mp');
    const candidate = buildFoodCandidate([{ ...food, threshold: 1 }]);
    const snapshot = structuredClone({ request, candidate });
    const originalRandom = Math.random;
    const originalUpdate = CombatUnit.prototype.updateCombatDetails;
    const originalLookup = CombatUnit.prototype.getBuffBoosts;
    const optimizedTrigger = vi.spyOn(Consumable.prototype, 'shouldTrigger').mockImplementation(() => {
      throw new Error('The reference must not use the optimized consumable path.');
    });
    const dispatch = vi.spyOn(Trigger.prototype, 'isActive');
    const createResult = vi.spyOn(CombatSimulator.prototype, 'createSimResult');
    try {
      const result = await referenceFoodOptimizerRound(request, candidate, 7);
      expect(result).toMatchObject({
        seed: 7,
        stoppedEarly: false,
        simulatedTime: request.payload.simulationTimeLimit,
      });
      expect(createResult.mock.results.length).toBeGreaterThan(0);
      for (const entry of createResult.mock.results) {
        expect(entry.type).toBe('return');
        expect(entry.value).toHaveProperty('attacks');
        expect(entry.value).toHaveProperty('experienceGained');
        expect(entry.value).toHaveProperty('dropContextBuckets');
      }
      expect(
        dispatch.mock.contexts.some(
          (trigger) =>
            trigger.dependencyHrid === '/combat_trigger_dependencies/self' &&
            trigger.conditionHrid === '/combat_trigger_conditions/missing_mp',
        ),
      ).toBe(true);
      expect(optimizedTrigger).not.toHaveBeenCalled();
      expect(Consumable.prototype.shouldTrigger).toBe(optimizedTrigger);
      expect(CombatUnit.prototype.updateCombatDetails).toBe(originalUpdate);
      expect(CombatUnit.prototype.getBuffBoosts).toBe(originalLookup);
      expect(Math.random).toBe(originalRandom);
      expect({ request, candidate }).toEqual(snapshot);
    } finally {
      createResult.mockRestore();
      dispatch.mockRestore();
      optimizedTrigger.mockRestore();
    }
  });

  it('restores the RNG and combat prototypes when reference construction fails', async () => {
    const { request } = createFoodOptimizerFixture({ foodSlots: 1, seconds: 120, rounds: 1 });
    request.payload.zone.zoneHrid = '/invalid';
    const originalRandom = Math.random;
    const originalTrigger = Consumable.prototype.shouldTrigger;
    const originalUpdate = CombatUnit.prototype.updateCombatDetails;
    const originalLookup = CombatUnit.prototype.getBuffBoosts;
    await expect(referenceFoodOptimizerRound(request, null, 7)).rejects.toThrow();
    expect(Math.random).toBe(originalRandom);
    expect(Consumable.prototype.shouldTrigger).toBe(originalTrigger);
    expect(CombatUnit.prototype.updateCombatDetails).toBe(originalUpdate);
    expect(CombatUnit.prototype.getBuffBoosts).toBe(originalLookup);
  });
});

import { describe, expect, it } from 'vitest';
import {
  assertFoodOptimizerTarget,
  FOOD_OPTIMIZER_LABYRINTH_ERROR,
  isFoodOptimizerLabyrinth,
} from '../foodOptimizerTarget.js';

describe('food optimizer target restriction', () => {
  it.each([
    { simulation: { labyrinth: { labyrinthHrid: '/monsters/cyclops' } } },
    { payload: { labyrinth: { labyrinthHrid: '/monsters/cyclops' } } },
    { simulation: { labyrinth: {} }, payload: { zone: { zoneHrid: '/actions/combat/fly' }, labyrinth: null } },
    { simulation: { zone: { zoneHrid: '/actions/combat/fly' } }, payload: { labyrinth: {} } },
  ])('rejects a labyrinth recorded in either snapshot or worker payload (%#)', (input) => {
    expect(isFoodOptimizerLabyrinth(input)).toBe(true);
    expect(() => assertFoodOptimizerTarget(input)).toThrow(FOOD_OPTIMIZER_LABYRINTH_ERROR);
  });

  it.each([
    undefined,
    null,
    {},
    { simulation: { zone: { zoneHrid: '/actions/combat/fly' }, labyrinth: null } },
    { payload: { zone: { zoneHrid: '/actions/combat/chimerical_den' }, labyrinth: null } },
    { simulation: { labyrinth: null }, payload: { labyrinth: null } },
  ])('leaves normal zones, dungeons and other target validation to their existing paths (%#)', (input) => {
    expect(isFoodOptimizerLabyrinth(input)).toBe(false);
    expect(() => assertFoodOptimizerTarget(input)).not.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import Trigger from '../../combatsimulator/trigger.js';
import {
  buildFoodCandidate,
  buildFoodDefaultCandidate,
  generateFoodOptimizerCompositionCandidates,
} from '../foodOptimizerDomain.js';
import {
  createFoodOptimizerPruningCache,
  generatePrunedFoodOptimizerCandidates,
  intersectFoodOptimizerThresholds,
  observeFoodOptimizerThresholds,
  observeUnusedFoodThresholds,
  materializeFoodOptimizerOutcome,
} from '../foodOptimizerPruning.js';

const item = (hrid, kind = 'mp', thresholds = [100, 50, 10]) => ({ hrid, kind, thresholds, restore: 50, price: 1 });
const failure = (candidate, min = 1, max = 100) => ({
  rejected: 'mana',
  roundsCompleted: 1,
  samples: [{ seed: 1, ranOutOfMana: true, stoppedEarly: true }],
  equivalentThresholds: candidate.slots.map(({ hrid, kind }) => ({ hrid, kind, min, max })),
});
const success = (candidate, min = 1, max = 100) => ({
  ...failure(candidate, min, max),
  rejected: '',
  feasible: true,
  ranOutOfMana: false,
  deaths: 0,
  costPerHour: 100,
  foodUsed: Object.fromEntries(candidate.food.map((hrid) => [hrid, 1])),
  roundsCompleted: 3,
  samples: [1, 2, 3].map((seed) => ({ seed, ranOutOfMana: false, stoppedEarly: false })),
});

describe('provable food optimizer pruning', () => {
  it('records integer threshold intervals from actual comparisons, including fractional resource values', () => {
    const candidate = buildFoodCandidate([{ ...item('mana'), threshold: 50 }]);
    const trigger = Trigger.createFromDTO(candidate.triggerMap.mana[0]);
    const read = observeFoodOptimizerThresholds({ food: [{ hrid: 'mana', triggers: [trigger] }] }, candidate);
    expect(trigger.compareValue(10.5)).toBe(false);
    expect(trigger.compareValue(49.5)).toBe(false);
    expect(trigger.compareValue(70.5)).toBe(true);
    expect(trigger.compareValue(55.9)).toBe(true);
    expect(read()).toEqual([{ hrid: 'mana', kind: 'mp', min: 50, max: 55 }]);
  });

  it('declines to certify unexpected trigger rules or invalid resource values', () => {
    const candidate = buildFoodCandidate([{ ...item('mana'), threshold: 50 }]);
    const trigger = Trigger.createFromDTO(candidate.triggerMap.mana[0]);
    trigger.comparatorHrid = '/combat_trigger_comparators/less_than_equal';
    const player = { food: [{ hrid: 'mana', triggers: [trigger] }] };
    expect(observeFoodOptimizerThresholds(player, candidate)()).toBeNull();
    trigger.comparatorHrid = '/combat_trigger_comparators/greater_than_equal';
    const read = observeFoodOptimizerThresholds(player, candidate);
    trigger.compareValue(NaN);
    expect(read()).toBeNull();
  });

  it('intersects observations across rounds instead of reusing only the final round', () => {
    const a = [{ hrid: 'mana', kind: 'mp', min: 10, max: 80 }];
    const b = [{ hrid: 'mana', kind: 'mp', min: 30, max: 90 }];
    expect(intersectFoodOptimizerThresholds(a, b)).toEqual([{ hrid: 'mana', kind: 'mp', min: 30, max: 80 }]);
    expect(intersectFoodOptimizerThresholds(a, null)).toBeNull();
    expect(intersectFoodOptimizerThresholds(a, [{ ...b[0], hrid: 'other' }])).toBeNull();
    expect(intersectFoodOptimizerThresholds(a, [{ ...b[0], min: 81 }])).toBeNull();
  });

  it('skips only thresholds inside a certified failure interval', () => {
    const cache = createFoodOptimizerPruningCache();
    const food = item('mana');
    const candidate = buildFoodCandidate([{ ...food, threshold: 50 }]);
    cache.record(candidate, failure(candidate, 21, 100));
    expect(cache.match(buildFoodCandidate([{ ...food, threshold: 100 }]))?.result.rejected).toBe('mana');
    expect(cache.match(buildFoodCandidate([{ ...food, threshold: 21 }]))?.result.rejected).toBe('mana');
    expect(cache.match(buildFoodCandidate([{ ...food, threshold: 20 }]))).toBeNull();
    expect(cache.match(buildFoodCandidate([{ ...item('other'), threshold: 50 }]))).toBeNull();
  });

  it('keeps reordered slots eligible, including restoration and price tie breakers', () => {
    const foods = [
      { ...item('a', 'mp', [30, 20, 10]), restore: 20 },
      { ...item('b', 'mp', [30, 20, 10]), restore: 40 },
    ];
    const observed = buildFoodCandidate([
      { ...foods[0], threshold: 30 },
      { ...foods[1], threshold: 10 },
    ]);
    const cache = createFoodOptimizerPruningCache();
    cache.record(observed, failure(observed, 1, 30));
    const all = [...generateFoodOptimizerCompositionCandidates(foods)];
    const sameOrder = all.filter((candidate) => candidate.food.join(',') === observed.food.join(','));
    for (const candidate of all)
      expect(cache.match(candidate)?.result.rejected ?? null).toBe(sameOrder.includes(candidate) ? 'mana' : null);
    const jobs = [...generatePrunedFoodOptimizerCandidates(foods, cache, observed)];
    expect(jobs.reduce((sum, job) => sum + (job.coveredCandidates || 0), 0)).toBe(sameOrder.length - 1);
    expect(
      jobs
        .filter((job) => !job.coveredCandidates)
        .map((candidate) => candidate.signature)
        .sort(),
    ).toEqual(
      all
        .filter((candidate) => !sameOrder.includes(candidate))
        .map((candidate) => candidate.signature)
        .sort(),
    );
  });

  it('discards a billion-candidate subtree without generating its leaves or double-counting its default', () => {
    const thresholds = (offset) => Array.from({ length: 1000 }, (_, index) => offset + 1000 - index);
    const foods = [
      item('mana', 'mp', thresholds(5000)),
      item('high-hp', 'hp', thresholds(2000)),
      item('low-hp', 'hp', thresholds(0)),
    ];
    const observed = buildFoodCandidate(foods.map((food) => ({ ...food, threshold: food.thresholds[0] })));
    const cache = createFoodOptimizerPruningCache();
    cache.record(observed, failure(observed, 1, 6000));
    expect([...generatePrunedFoodOptimizerCandidates(foods, cache, observed)]).toMatchObject([
      { coveredCandidates: 999999999, evidence: { result: { rejected: 'mana' } } },
    ]);
  });

  it('enumerates every remaining candidate when no certified interval covers it', () => {
    const foods = [item('mana'), item('health', 'hp')];
    const baseline = buildFoodDefaultCandidate(foods);
    const cache = createFoodOptimizerPruningCache();
    expect(
      [...generatePrunedFoodOptimizerCandidates(foods, cache, baseline)].map((candidate) => candidate.signature),
    ).toEqual(
      [...generateFoodOptimizerCompositionCandidates(foods)]
        .filter((candidate) => candidate.signature !== baseline.signature)
        .map((candidate) => candidate.signature),
    );
    expect([...generatePrunedFoodOptimizerCandidates([], cache, buildFoodCandidate([]))]).toEqual([]);
  });

  it('bounds retained evidence and ignores uncertified or incomplete results', () => {
    const cache = createFoodOptimizerPruningCache({ maxEntries: 3, rounds: 3 });
    const candidates = Array.from({ length: 5 }, (_, index) =>
      buildFoodCandidate([{ ...item(String(index)), threshold: 50 }]),
    );
    for (const candidate of candidates) {
      cache.record(candidate, failure(candidate));
      expect(cache.size).toBeLessThanOrEqual(3);
    }
    expect(cache.match(candidates[0])).toBeNull();
    expect(cache.match(candidates[4])?.result.rejected).toBe('mana');
    cache.clear();
    cache.record(candidates[0], { rejected: 'mana' });
    cache.record(candidates[0], { ...failure(candidates[0]), rejected: '', feasible: true });
    cache.record(candidates[0], failure(candidates[0], 60, 100));
    cache.record(candidates[0], failure(candidates[0], 50, 50));
    expect(cache.size).toBe(0);
  });

  it('reuses full feasible outcomes with a separate bound on retained samples', () => {
    const cache = createFoodOptimizerPruningCache({ maxEntries: 10, maxFeasibleEntries: 2, rounds: 3 });
    const candidates = Array.from({ length: 5 }, (_, index) =>
      buildFoodCandidate([{ ...item(String(index)), threshold: 50 }]),
    );
    for (const candidate of candidates) {
      cache.record(candidate, success(candidate));
      expect(cache.feasibleSize).toBeLessThanOrEqual(2);
    }
    expect(cache.match(candidates[0])).toBeNull();
    const variant = buildFoodCandidate([{ ...item('4'), threshold: 100 }]);
    const evidence = cache.match(variant);
    expect(evidence.result).toMatchObject({ feasible: true, roundsCompleted: 3, costPerHour: 100 });
    expect(materializeFoodOptimizerOutcome(evidence, variant)).toEqual(success(candidates[4]));
  });

  it('records a conservative never-trigger range at every no-food trigger check', () => {
    const simulator = { checkTriggersForUnit: () => false };
    const player = {
      hrid: 'player1',
      combatDetails: { maxHitpoints: 100, currentHitpoints: 75, maxManapoints: 100, currentManapoints: 70 },
    };
    const read = observeUnusedFoodThresholds(simulator, 'player1');
    expect(simulator.checkTriggersForUnit(player)).toBe(false);
    player.combatDetails.currentHitpoints = 95;
    player.combatDetails.currentManapoints = 50;
    simulator.checkTriggersForUnit(player);
    player.isStunned = true;
    player.combatDetails.currentManapoints = 0;
    simulator.checkTriggersForUnit(player);
    expect(read()).toEqual({ hp: 26, mp: 51 });
  });

  it('reuses no-food outcomes across compositions and orders only when every added food stays inactive', () => {
    const empty = buildFoodCandidate([]);
    const result = {
      ...success(empty),
      costPerHour: 0,
      unusedFoodThresholds: { hp: 26, mp: 51 },
      samples: [1, 2, 3].map((seed) => ({
        seed,
        stoppedEarly: false,
        ranOutOfMana: false,
        foodUsed: {},
        unusedFoodThresholds: { hp: 26, mp: 51 },
      })),
    };
    const cache = createFoodOptimizerPruningCache({ rounds: 3 });
    cache.record(empty, result);
    const candidate = buildFoodCandidate([
      { ...item('hp', 'hp'), threshold: 26 },
      { ...item('mp'), threshold: 51 },
    ]);
    const evidence = cache.match(candidate);
    expect(evidence.unusedFood).toBe(true);
    const reused = materializeFoodOptimizerOutcome(evidence, candidate);
    expect(reused).toMatchObject({
      feasible: true,
      costPerHour: 0,
      foodUsed: { hp: 0, mp: 0 },
      unusedFoodThresholds: null,
    });
    expect(reused.samples.every((sample) => sample.foodUsed.hp === 0 && sample.foodUsed.mp === 0)).toBe(true);
    expect(cache.match(buildFoodCandidate([{ ...item('mp'), threshold: 50 }]))).toBeNull();
    expect(cache.match(buildFoodCandidate([{ ...item('hp', 'hp'), threshold: 25 }]))).toBeNull();
  });
});

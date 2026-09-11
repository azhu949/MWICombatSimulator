import { describe, expect, it, vi } from 'vitest';
import { buildFoodCandidate } from '../foodOptimizerDomain.js';
import { createFoodOptimizerEvaluator, evaluateFoodOptimizerCandidate } from '../foodOptimizerSimulation.js';
import { createFoodOptimizerSearch } from '../foodOptimizerSearch.js';
import {
  createFoodOptimizerFixture,
  physicalFoodOptimizerResult,
  referenceFoodOptimizerRound,
} from './support/foodOptimizerTestSupport.js';

describe('inactive foods across real combat compositions', () => {
  it.each(['zone', 'dungeon'])(
    'adds and removes unused food without changing any round result in %s',
    async (target) => {
      const { request, items } = createFoodOptimizerFixture({ target, foodSlots: 3 });
      const evaluate = createFoodOptimizerEvaluator(request, { items });
      const baseline = await evaluate(null);
      let core;
      let coreResult;
      for (const item of items.filter((item) => item.kind === 'mp')) {
        for (const threshold of [...item.thresholds].reverse()) {
          const candidate = buildFoodCandidate([{ ...item, threshold }]);
          const result = await evaluate(candidate, baseline.deaths);
          if (result.feasible && result.samples.every((sample) => sample.foodUsed[item.hrid] > 0)) {
            core = candidate;
            coreResult = result;
            break;
          }
        }
        if (core) break;
      }
      expect(core, 'fixture must consume a core food in every complete round').toBeDefined();
      const original = structuredClone(coreResult);
      const expanded = buildFoodCandidate([
        ...core.slots,
        ...items
          .filter((item) => item.kind === 'hp')
          .map((item) => ({ ...item, threshold: Math.max(...item.thresholds) })),
      ]);
      expect(expanded.slots).toHaveLength(3);
      const expected = await evaluateFoodOptimizerCandidate(
        request,
        expanded,
        baseline.deaths,
        undefined,
        referenceFoodOptimizerRound,
      );
      const reused = await evaluate(expanded, baseline.deaths);
      expect(reused).toMatchObject({ feasible: true, simulatedRounds: 0, reusedRounds: request.rounds });
      expect(physicalFoodOptimizerResult(reused)).toEqual(physicalFoodOptimizerResult(expected));
      expect(coreResult).toEqual(original);

      // A separate cache must also be able to remove foods from a source result;
      // it has never evaluated the one-food candidate before this query.
      const remove = createFoodOptimizerEvaluator(request, { items });
      const source = await remove(expanded, baseline.deaths);
      expect(source.simulatedRounds).toBe(request.rounds);
      const reduced = await remove(core, baseline.deaths);
      expect(reduced).toMatchObject({ feasible: true, simulatedRounds: 0, reusedRounds: request.rounds });
      expect(physicalFoodOptimizerResult(reduced)).toEqual(physicalFoodOptimizerResult(coreResult));
    },
  );

  it.each(['payload', 'simulation'])('refuses a labyrinth in %s before allocating any Worker', async (field) => {
    const workerFactory = vi.fn();
    const request = { rounds: 1, seeds: [1], [field]: { labyrinth: { labyrinthHrid: 'excluded' } } };
    const report = await createFoodOptimizerSearch({ request, items: [], foodSlots: 3, workerLimit: 4, workerFactory })
      .done;
    expect(report).toMatchObject({
      status: 'error',
      complete: false,
      error: 'common:foodOptimizer.labyrinthUnsupported',
    });
    expect(workerFactory).not.toHaveBeenCalled();
  });
});

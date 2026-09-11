import { describe, expect, it } from 'vitest';
import { buildFoodCandidate, buildFoodDefaultCandidate } from '../foodOptimizerDomain.js';
import { createFoodOptimizerPruningCache, generatePrunedFoodOptimizerCandidates } from '../foodOptimizerPruning.js';

const food = (hrid, thresholds = [90, 60, 30]) => ({ hrid, kind: 'mp', restore: 60, price: 1, thresholds });
const candidateFor = (items, threshold = 60) => buildFoodCandidate(items.map((item) => ({ ...item, threshold })));
const proofFor = (candidate, overrides = {}) => ({
  feasible: null,
  rejected: '',
  ranOutOfMana: false,
  pruned: 'cost',
  costLowerBound: 120,
  roundsCompleted: 1,
  samples: [{ seed: 1, stoppedEarly: true, ranOutOfMana: false, pruned: 'cost' }],
  equivalentThresholds: candidate.slots.map(({ hrid, kind }) => ({ hrid, kind, min: 30, max: 90 })),
  ...overrides,
});

describe('food optimizer ranking certificates', () => {
  it('keeps cost evidence separate from complete feasibility evidence and rechecks the current cutoff', () => {
    const items = [food('a')];
    const candidate = candidateFor(items);
    let cutoff = 100;
    const cache = createFoodOptimizerPruningCache({ items, rounds: 3, getCostCutoff: () => cutoff });
    cache.record(candidate, proofFor(candidate));
    expect(cache.size).toBe(1);
    expect(cache.feasibleSize).toBe(0);
    expect(cache.match(candidate)?.result).toEqual({
      feasible: null,
      rejected: '',
      pruned: 'cost',
      roundsCompleted: 1,
      costLowerBound: 120,
    });
    cutoff = 50;
    expect(cache.match(candidateFor(items, 30))?.result.pruned).toBe('cost');
    cutoff = 120;
    expect(cache.match(candidate)).toBeNull();
    cutoff = undefined;
    expect(cache.match(candidate)).toBeNull();
    cutoff = 100;
    expect(cache.match(candidate)).not.toBeNull();
    expect(cache.match(candidateFor(items, 10))).toBeNull();
  });

  it.each([
    ['complete search', undefined, {}],
    ['missing incumbent', () => undefined, {}],
    ['cost tie', () => 120, {}],
    ['floating-point boundary', () => 120, { costLowerBound: 120 + Number.EPSILON * 120 }],
    ['nonfinite bound', () => 100, { costLowerBound: Infinity }],
    ['negative bound', () => 100, { costLowerBound: -1 }],
    ['claimed feasibility', () => 100, { feasible: true }],
    ['simultaneous failure', () => 100, { rejected: 'mana' }],
    ['missing sample', () => 100, { samples: [] }],
  ])('does not cache %s as a cost certificate', (name, getCostCutoff, overrides) => {
    const items = [food('a')];
    const candidate = candidateFor(items);
    const cache = createFoodOptimizerPruningCache({ items, rounds: 3, getCostCutoff });
    cache.record(candidate, proofFor(candidate, overrides));
    expect(cache.size).toBe(0);
    expect(cache.match(candidate)).toBeNull();
  });

  it('preserves food order and refuses incompatible prices or compositions', () => {
    const items = [food('a'), { ...food('b'), price: 2 }];
    const candidate = buildFoodCandidate([
      { ...items[0], threshold: 90 },
      { ...items[1], threshold: 30 },
    ]);
    const cache = createFoodOptimizerPruningCache({ items, rounds: 3, getCostCutoff: () => 100 });
    cache.record(candidate, proofFor(candidate));
    expect(cache.match(candidateFor(items))?.result.pruned).toBe('cost');
    expect(
      cache.match(
        buildFoodCandidate([
          { ...items[0], threshold: 30 },
          { ...items[1], threshold: 90 },
        ]),
      ),
    ).toBeNull();
    expect(cache.match(candidateFor([{ ...items[0], price: 3 }, items[1]]))).toBeNull();
    expect(cache.match(candidateFor([items[0]]))).toBeNull();
  });

  it('never publishes a cost-stopped no-food sample as global unused-food evidence', () => {
    const candidate = buildFoodCandidate([]);
    const cache = createFoodOptimizerPruningCache({ rounds: 3, getCostCutoff: () => 100 });
    cache.record(
      candidate,
      proofFor(candidate, {
        unusedFoodThresholds: { hp: 1, mp: 1 },
        samples: [{ seed: 1, stoppedEarly: true, ranOutOfMana: false, unusedFoodThresholds: { hp: 1, mp: 1 } }],
      }),
    );
    expect(cache.match(candidate)).toBeNull();
    expect(cache.match(candidateFor([food('a')]))).toBeNull();
  });

  it('uses the full ranking lower bound only after cost and deaths reach zero', () => {
    const items = [food('a'), food('b')];
    let cutoff = { costPerHour: 0, deaths: 0, slots: [{}] };
    const cache = createFoodOptimizerPruningCache({ items, getRankCutoff: () => cutoff });
    const pair = candidateFor(items);
    expect(cache.match(pair)?.result).toMatchObject({
      feasible: null,
      rejected: '',
      pruned: 'rank',
      roundsCompleted: 0,
      rankLowerBound: { costPerHour: 0, deaths: 0, slotCount: 2 },
    });
    expect(cache.match(candidateFor([items[0]]))).toBeNull();
    cutoff = { ...cutoff, deaths: 1 };
    expect(cache.match(pair)).toBeNull();
    cutoff = { ...cutoff, deaths: 0, costPerHour: 1 };
    expect(cache.match(pair)).toBeNull();
    cutoff = undefined;
    expect(cache.match(pair)).toBeNull();
  });

  it('compresses a newly dominated billion-point region without losing or duplicating its default', () => {
    const thresholds = Array.from({ length: 1000 }, (_, index) => 1000 - index);
    const items = [food('a', thresholds), food('b', thresholds), food('c', thresholds)];
    let cutoff;
    const cache = createFoodOptimizerPruningCache({ items, getRankCutoff: () => cutoff });
    const excluded = buildFoodDefaultCandidate(items);
    const iterator = generatePrunedFoodOptimizerCandidates(items, cache, excluded, { captureCoverage: true });
    const first = iterator.next();
    expect(first.done).toBe(false);
    expect(first.value.coveredCandidates).toBeUndefined();
    cutoff = { costPerHour: 0, deaths: 0, slots: [{}] };
    const blocks = [...iterator];
    expect(blocks.length).toBeLessThan(8);
    expect(blocks.every((block) => block.evidence.result.pruned === 'rank')).toBe(true);
    expect(1 + blocks.reduce((total, block) => total + block.coveredCandidates, 0)).toBe(1e9 - 1);
    expect(blocks.filter((block) => block.excludedSignature === excluded.signature)).toHaveLength(1);
  });
});

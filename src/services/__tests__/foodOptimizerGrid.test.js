import { describe, expect, it } from 'vitest';
import { buildFoodCandidate, generateFoodOptimizerCompositionCandidates } from '../foodOptimizerDomain.js';
import { createFoodOptimizerGrid, projectFoodOptimizerRanges } from '../foodOptimizerGrid.js';
import { createFoodOptimizerPruningCache, materializeFoodOptimizerOutcome } from '../foodOptimizerPruning.js';

const food = (hrid, kind = 'mp', thresholds = [100, 50, 10], restore = 50, price = 1) => ({
  hrid,
  kind,
  thresholds,
  restore,
  price,
});
const at = (item, threshold) => ({ ...item, threshold });
const rangesFor = (candidate, min = 1, max = 200) =>
  candidate.slots.map(({ hrid, kind }) => ({ hrid, kind, min, max }));
const success = (candidate, ranges = rangesFor(candidate)) => {
  const foodUsed = Object.fromEntries(candidate.food.map((hrid) => [hrid, 2]));
  return {
    feasible: true,
    rejected: '',
    ranOutOfMana: false,
    deaths: 0,
    costPerHour: 12,
    foodUsed,
    roundsCompleted: 1,
    equivalentThresholds: ranges,
    samples: [
      {
        seed: 1,
        ranOutOfMana: false,
        stoppedEarly: false,
        deaths: 0,
        simulatedTime: 600e9,
        costPerHour: 12,
        foodUsed,
        equivalentThresholds: ranges,
      },
    ],
  };
};
const failure = (candidate, ranges) => ({
  ...success(candidate, ranges),
  feasible: false,
  rejected: 'mana',
  ranOutOfMana: true,
  samples: [{ seed: 1, ranOutOfMana: true, stoppedEarly: true }],
});

describe('discrete food optimizer evidence', () => {
  it('drops a wide interval that contains only the original discrete threshold', () => {
    const item = food('mana');
    const candidate = buildFoodCandidate([at(item, 50)]);
    const ranges = rangesFor(candidate, 21, 99);
    expect(projectFoodOptimizerRanges(createFoodOptimizerGrid([item]), candidate, ranges)).toEqual({
      ranges: [{ hrid: 'mana', kind: 'mp', min: 50, max: 50 }],
      coverage: 1,
    });
    const cache = createFoodOptimizerPruningCache({ items: [item], rounds: 1 });
    cache.record(candidate, success(candidate, ranges));
    expect(cache.size).toBe(0);
    expect(cache.match(candidate)).toBeNull();
  });

  it('drops a multi-axis region whose other discrete points all change the slot order', () => {
    const items = [food('a', 'mp', [60, 50], 20), food('b', 'mp', [70, 60], 10)];
    const candidate = buildFoodCandidate([at(items[0], 60), at(items[1], 60)]);
    const result = failure(candidate);
    expect(
      projectFoodOptimizerRanges(createFoodOptimizerGrid(items), candidate, result.equivalentThresholds).coverage,
    ).toBe(1);
    const cache = createFoodOptimizerPruningCache({ items });
    cache.record(candidate, result);
    expect(cache.size).toBe(0);
  });

  it.each([
    { name: 'restore amount', earlier: food('a', 'mp', [100, 90], 10), later: food('b', 'mp', [90], 20) },
    { name: 'price', earlier: food('a', 'mp', [100, 90], 20, 2), later: food('b', 'mp', [90], 20, 1) },
    { name: 'hrid', earlier: food('z', 'mp', [100, 90], 20), later: food('a', 'mp', [90], 20) },
  ])('accounts for the $name tie breaker when deciding whether another candidate is covered', ({ earlier, later }) => {
    const items = [earlier, later];
    const candidate = buildFoodCandidate([at(earlier, 100), at(later, 90)]);
    const cache = createFoodOptimizerPruningCache({ items });
    cache.record(candidate, failure(candidate));
    expect(cache.size).toBe(0);
  });

  it('retains reusable grid points, excludes gaps, and keeps the original result and samples untouched', () => {
    const items = [food('a', 'mp', [100, 90, 80], 20), food('b', 'mp', [90], 10)];
    const candidate = buildFoodCandidate([at(items[0], 100), at(items[1], 90)]);
    const ranges = rangesFor(candidate, 81, 199);
    const result = success(candidate, ranges);
    const original = structuredClone(result);
    const cache = createFoodOptimizerPruningCache({ items, rounds: 1 });
    cache.record(candidate, result);
    const other = buildFoodCandidate([at(items[0], 90), at(items[1], 90)]);
    const evidence = cache.match(other);
    expect(evidence.ranges).toEqual([
      { hrid: 'a', kind: 'mp', min: 90, max: 100 },
      { hrid: 'b', kind: 'mp', min: 90, max: 90 },
    ]);
    expect(evidence.result).toBe(result);
    expect(materializeFoodOptimizerOutcome(evidence, other)).toBe(result);
    expect(evidence.result.samples).toBe(result.samples);
    expect(result).toEqual(original);
    expect(cache.match(buildFoodCandidate([at(items[0], 95), at(items[1], 90)]))).toBeNull();
    expect(cache.match(buildFoodCandidate([at(items[0], 80), at(items[1], 90)]))).toBeNull();
    expect(
      cache.matchRanges([
        { ...items[0], min: 95, max: 100 },
        { ...items[1], min: 90, max: 90 },
      ]),
    ).toBeNull();
    expect(
      cache.matchRanges([
        { ...items[0], min: 90, max: 100 },
        { ...items[1], min: 90, max: 90 },
      ]),
    ).toBe(evidence);
  });

  it.each([
    ['mp', 'mp', 'mp'],
    ['hp', 'hp', 'hp'],
    ['mp', 'hp', 'mp'],
    ['hp', 'mp', 'hp'],
  ])('matches exhaustive discrete coverage for %s / %s / %s without losing reusable certificates', (a, b, c) => {
    const items = [
      food('z', a, [100, 50, 10], 40, 3),
      food('a', b, [100, 75, 10], 50, 1),
      food('m', c, [100, 50, 25], 40, 2),
    ];
    const grid = createFoodOptimizerGrid(items);
    const candidates = [...generateFoodOptimizerCompositionCandidates(items)];
    for (const candidate of candidates) {
      const expected = candidates.filter((other) => other.food.join('|') === candidate.food.join('|'));
      const ranges = rangesFor(candidate, 1, 100);
      const projection = projectFoodOptimizerRanges(grid, candidate, ranges);
      expect(projection.coverage).toBe(expected.length);
      const cache = createFoodOptimizerPruningCache({ items });
      cache.record(candidate, failure(candidate, ranges));
      expect(cache.size).toBe(Number(expected.length > 1));
      for (const other of candidates)
        expect(Boolean(cache.match(other))).toBe(expected.length > 1 && expected.includes(other));
    }
  });

  it('keeps the no-food certificate even when every food grid contains only one point', () => {
    const items = [food('mana', 'mp', [50]), food('health', 'hp', [50])];
    const candidate = buildFoodCandidate([]);
    const result = success(candidate);
    result.costPerHour = 0;
    result.unusedFoodThresholds = { hp: 26, mp: 26 };
    result.samples[0].unusedFoodThresholds = { hp: 26, mp: 26 };
    const cache = createFoodOptimizerPruningCache({ items, rounds: 1, maxEntries: 1 });
    cache.record(candidate, result);
    expect(cache.size).toBe(0);
    const added = buildFoodCandidate(items.map((item) => at(item, 50)));
    const evidence = cache.match(added);
    expect(evidence.unusedFood).toBe(true);
    expect(materializeFoodOptimizerOutcome(evidence, added).foodUsed).toEqual({ mana: 0, health: 0 });
    cache.clear();
    expect(cache.match(added)).toBeNull();
  });

  it('preserves continuous matching and FIFO capacity when no catalog is provided', () => {
    const items = ['a', 'b', 'c'].map((hrid) => food(hrid));
    const cache = createFoodOptimizerPruningCache({ rounds: 1, maxEntries: 2 });
    for (const item of items) {
      const candidate = buildFoodCandidate([at(item, 50)]);
      cache.record(candidate, success(candidate, rangesFor(candidate, 21, 99)));
      expect(cache.size).toBeLessThanOrEqual(2);
    }
    expect(cache.match(buildFoodCandidate([at(items[0], 50)]))).toBeNull();
    expect(cache.match(buildFoodCandidate([at(items[1], 75)]))?.result.feasible).toBe(true);
    expect(cache.match(buildFoodCandidate([at(items[2], 75)]))?.ranges[0]).toMatchObject({ min: 21, max: 99 });
  });

  it('preserves total and feasible capacity bounds without letting singleton evidence evict useful entries', () => {
    const items = ['a', 'b', 'c', 'd'].map((hrid) => food(hrid));
    const candidates = items.map((item) => buildFoodCandidate([at(item, 50)]));
    const cache = createFoodOptimizerPruningCache({ items, rounds: 1, maxEntries: 2, maxFeasibleEntries: 1 });
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      cache.record(candidate, index === 1 || index === 2 ? success(candidate) : failure(candidate));
      expect(cache.size).toBeLessThanOrEqual(2);
      expect(cache.feasibleSize).toBeLessThanOrEqual(1);
    }
    expect(cache.match(candidates[0])).toBeNull();
    expect(cache.match(candidates[1])).toBeNull();
    expect(cache.match(candidates[2])?.result.feasible).toBe(true);
    expect(cache.match(candidates[3])?.result.rejected).toBe('mana');
    cache.record(candidates[0], failure(candidates[0], rangesFor(candidates[0], 40, 60)));
    expect(cache.match(candidates[2])?.result.feasible).toBe(true);
    expect(cache.match(candidates[3])?.result.rejected).toBe('mana');
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.feasibleSize).toBe(0);
  });

  it.each([
    { kind: 'other' },
    { restore: NaN },
    { price: Infinity },
    { thresholds: [100, '50', 10] },
    { thresholds: [100, 0] },
    { thresholds: [] },
  ])('declines projection from an invalid catalog item: %j', (overrides) => {
    const item = food('mana');
    const candidate = buildFoodCandidate([at(item, 50)]);
    const cache = createFoodOptimizerPruningCache({ items: [{ ...item, ...overrides }] });
    cache.record(candidate, failure(candidate));
    expect(cache.size).toBe(0);
  });

  it('declines ambiguous catalogs, missing items, inconsistent slot metadata, and reordered evidence', () => {
    const items = [food('a', 'mp', [100, 50]), food('b', 'hp', [100, 50])];
    const candidate = buildFoodCandidate([at(items[0], 100), at(items[1], 50)]);
    const ranges = rangesFor(candidate);
    expect(projectFoodOptimizerRanges(createFoodOptimizerGrid([items[0]]), candidate, ranges)).toBeNull();
    expect(projectFoodOptimizerRanges(createFoodOptimizerGrid([...items, items[0]]), candidate, ranges)).toBeNull();
    const grid = createFoodOptimizerGrid(items);
    for (const attribute of ['kind', 'restore', 'price']) {
      const changed = { ...candidate, slots: candidate.slots.map((slot) => ({ ...slot, [attribute]: 'changed' })) };
      expect(projectFoodOptimizerRanges(grid, changed, ranges)).toBeNull();
    }
    expect(projectFoodOptimizerRanges(grid, candidate, [...ranges].reverse())).toBeNull();
    expect(projectFoodOptimizerRanges(grid, { ...candidate, food: [...candidate.food].reverse() }, ranges)).toBeNull();
  });
});

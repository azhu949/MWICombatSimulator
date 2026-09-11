import { describe, expect, it } from 'vitest';
import {
  buildFoodCandidate,
  buildFoodDefaultCandidate,
  generateFoodOptimizerCompositionCandidates,
} from '../foodOptimizerDomain.js';
import { createFoodOptimizerGrid, projectFoodOptimizerRanges } from '../foodOptimizerGrid.js';
import {
  createFoodOptimizerPruningCache,
  generatePrunedFoodOptimizerCandidates,
  materializeFoodOptimizerOutcome,
} from '../foodOptimizerPruning.js';

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

const traversalFood = (hrid, kind, thresholds, restore = 50) => ({ hrid, kind, thresholds, restore, price: 1 });
const traversalFailure = (candidate, range = () => ({ min: 1, max: 6000 })) => ({
  rejected: 'mana',
  roundsCompleted: 1,
  samples: [{ seed: 1, ranOutOfMana: true, stoppedEarly: true }],
  equivalentThresholds: candidate.slots.map((slot) => ({ hrid: slot.hrid, kind: slot.kind, ...range(slot) })),
});
const traversalSuccess = (candidate) => ({
  ...traversalFailure(candidate),
  feasible: true,
  rejected: '',
  ranOutOfMana: false,
  samples: [{ seed: 1, ranOutOfMana: false, stoppedEarly: false }],
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
    expect(evidence.result).toEqual(result);
    expect(materializeFoodOptimizerOutcome(evidence, other)).toEqual(result);
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

  it.each([{ kind: 'other' }, { thresholds: [100, '50', 10] }, { thresholds: [] }])(
    'declines projection from an invalid catalog item: %j',
    (overrides) => {
      const item = food('mana');
      const candidate = buildFoodCandidate([at(item, 50)]);
      const cache = createFoodOptimizerPruningCache({ items: [{ ...item, ...overrides }] });
      cache.record(candidate, failure(candidate));
      expect(cache.size).toBe(0);
    },
  );

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

describe('adaptive traversal of certified food thresholds', () => {
  it.each([
    { feasible: true, captureCoverage: false },
    { feasible: true, captureCoverage: true },
    { feasible: false, captureCoverage: false },
    { feasible: false, captureCoverage: true },
  ])('preserves a pre-certified whole grid and its default exclusion (%j)', ({ feasible, captureCoverage }) => {
    const items = [traversalFood('mana', 'mp', [100, 75, 50]), traversalFood('health', 'hp', [10, 25, 50])];
    const excluded = buildFoodDefaultCandidate(items);
    // Keep the factory's own method intact: spying on matchRanges would exercise
    // the custom-cache path instead of a pre-existing native certificate.
    const cache = createFoodOptimizerPruningCache({ rounds: 1, items });
    cache.record(excluded, feasible ? traversalSuccess(excluded) : traversalFailure(excluded));
    const chunks = [...generatePrunedFoodOptimizerCandidates(items, cache, excluded, { captureCoverage })];
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      coveredCandidates: 8,
      excludedSignature: excluded.signature,
      evidence: { result: { feasible, rejected: feasible ? '' : 'mana' } },
    });
    if (feasible || captureCoverage) {
      expect(chunks[0].items).toEqual(items);
      const covered = [...generateFoodOptimizerCompositionCandidates(chunks[0].items)]
        .filter((candidate) => candidate.signature !== chunks[0].excludedSignature)
        .map((candidate) => candidate.signature);
      expect(covered).toHaveLength(8);
      expect(new Set(covered).size).toBe(8);
      expect(covered).toEqual(
        [...generateFoodOptimizerCompositionCandidates(items)]
          .filter((candidate) => candidate.signature !== excluded.signature)
          .map((candidate) => candidate.signature),
      );
    } else {
      expect(chunks[0].items).toBeUndefined();
    }
  });

  it('uses a newly learned certificate to cover a billion-point grid', () => {
    const thresholds = (offset) => Array.from({ length: 1000 }, (_, index) => offset + 1000 - index);
    const items = [
      traversalFood('mana', 'mp', thresholds(5000), 5500),
      traversalFood('high-hp', 'hp', thresholds(2000), 2500),
      traversalFood('low-hp', 'hp', thresholds(0), 500),
    ];
    const excluded = buildFoodDefaultCandidate(items);
    const cache = createFoodOptimizerPruningCache();
    const iterator = generatePrunedFoodOptimizerCandidates(items, cache, excluded);
    const first = iterator.next().value;
    expect(first).not.toHaveProperty('coveredCandidates');
    // The generator is already suspended inside its first leaf when the worker
    // returns this result. Its remaining sibling ranges must adapt immediately.
    cache.record(first, traversalFailure(first));
    const chunks = [...iterator];
    expect(chunks).toHaveLength(3);
    expect(chunks.reduce((count, chunk) => count + chunk.coveredCandidates, 0)).toBe(1_000_000_000 - 2);
    expect(chunks.filter((chunk) => chunk.excludedSignature === excluded.signature)).toHaveLength(1);
    expect(chunks.every((chunk) => chunk.items === undefined)).toBe(true);
  });

  it('covers every remaining point exactly once across interval boundaries and changing slot orders', () => {
    const items = [
      traversalFood('b', 'mp', [100, 75, 50, 25, 10]),
      traversalFood('a', 'mp', [10, 25, 50, 75, 100], 75),
      traversalFood('h', 'hp', [100, 75, 50, 25, 10]),
    ];
    const excluded = buildFoodDefaultCandidate(items);
    const cache = createFoodOptimizerPruningCache();
    const seen = [];
    let coveredCount = 0;
    for (const entry of generatePrunedFoodOptimizerCandidates(items, cache, excluded, { captureCoverage: true })) {
      if (!entry.coveredCandidates) {
        seen.push(entry.signature);
        cache.record(
          entry,
          traversalFailure(entry, ({ threshold }) => (threshold >= 50 ? { min: 50, max: 100 } : { min: 1, max: 49 })),
        );
        continue;
      }
      const candidates = [...generateFoodOptimizerCompositionCandidates(entry.items)].filter(
        (candidate) => candidate.signature !== entry.excludedSignature,
      );
      expect(candidates).toHaveLength(entry.coveredCandidates);
      for (const candidate of candidates) {
        expect(candidate.food).toEqual(entry.evidence.order);
        expect(cache.match(candidate)).not.toBeNull();
        seen.push(candidate.signature);
      }
      coveredCount += entry.coveredCandidates;
    }
    expect(coveredCount).toBeGreaterThan(0);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(
      [...generateFoodOptimizerCompositionCandidates(items)]
        .filter((candidate) => candidate.signature !== excluded.signature)
        .map((candidate) => candidate.signature)
        .sort(),
    );
  });

  it('does not interpret an unordered grid slice as a numeric interval', () => {
    const items = [traversalFood('a', 'mp', [100, 50, 75, 25, 10])];
    const cache = createFoodOptimizerPruningCache();
    const iterator = generatePrunedFoodOptimizerCandidates(items, cache, undefined, { captureCoverage: true });
    const first = iterator.next().value;
    cache.record(first, traversalFailure(first));
    const chunks = [...iterator];
    expect(chunks).toHaveLength(4);
    expect(chunks.every((chunk) => chunk.coveredCandidates === 1)).toBe(true);
    expect(chunks.flatMap((chunk) => [...generateFoodOptimizerCompositionCandidates(chunk.items)])).toEqual(
      [...generateFoodOptimizerCompositionCandidates(items)].slice(1),
    );
  });
});

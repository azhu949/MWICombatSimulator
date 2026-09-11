import { describe, expect, it, vi } from 'vitest';
import { buildFoodDefaultCandidate, generateFoodOptimizerCompositionCandidates } from '../foodOptimizerDomain.js';
import { createFoodOptimizerPruningCache, generatePrunedFoodOptimizerCandidates } from '../foodOptimizerPruning.js';
import { selectFoodOptimizerRepresentatives } from '../foodOptimizerRepresentatives.js';

const food = (hrid, kind, thresholds, restore = 50) => ({ hrid, kind, thresholds, restore, price: 1 });
const failure = (candidate, range = () => ({ min: 1, max: 6000 })) => ({
  rejected: 'mana',
  roundsCompleted: 1,
  samples: [{ seed: 1, ranOutOfMana: true, stoppedEarly: true }],
  equivalentThresholds: candidate.slots.map((slot) => ({ hrid: slot.hrid, kind: slot.kind, ...range(slot) })),
});
const success = (candidate) => ({
  ...failure(candidate),
  feasible: true,
  rejected: '',
  ranOutOfMana: false,
  samples: [{ seed: 1, ranOutOfMana: false, stoppedEarly: false }],
});

describe('adaptive traversal of certified food thresholds', () => {
  it.each([
    { feasible: true, captureCoverage: false },
    { feasible: true, captureCoverage: true },
    { feasible: false, captureCoverage: false },
    { feasible: false, captureCoverage: true },
  ])('preserves a pre-certified whole grid and its default exclusion (%j)', ({ feasible, captureCoverage }) => {
    const items = [food('mana', 'mp', [100, 75, 50]), food('health', 'hp', [10, 25, 50])];
    const excluded = buildFoodDefaultCandidate(items);
    // Keep the factory's own method intact: spying on matchRanges would exercise
    // the custom-cache path instead of a pre-existing native certificate.
    const cache = createFoodOptimizerPruningCache({ rounds: 1, items });
    cache.record(excluded, feasible ? success(excluded) : failure(excluded));
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

  it.each(['custom', 'overridden', 'getter'])(
    'preserves query and point order when a %s cache reorders thresholds during its first lookup',
    (kind) => {
      const items = [food('a', 'mp', [100, 50, 75, 10])];
      const excluded = buildFoodDefaultCandidate(items);
      const native = createFoodOptimizerPruningCache({ rounds: 1, items });
      native.record(excluded, failure(excluded));
      const originalLookup = native.matchRanges.bind(native);
      const queries = [];
      let getterReads = 0;
      const reorder = () => items[0].thresholds.sort((left, right) => right - left);
      function matchRanges(domains) {
        queries.push(domains.map(({ min, max }) => [min, max]));
        if (queries.length === 1) {
          if (kind !== 'getter') reorder();
          return null;
        }
        return originalLookup(domains);
      }
      const cache = kind === 'custom' ? { matchRanges } : native;
      if (kind === 'overridden') cache.matchRanges = matchRanges;
      if (kind === 'getter')
        Object.defineProperty(cache, 'matchRanges', {
          get() {
            if (++getterReads === 1) reorder();
            return matchRanges;
          },
        });

      const chunks = [...generatePrunedFoodOptimizerCandidates(items, cache, excluded, { captureCoverage: true })];
      // Captured from the independent validated-final snapshot. The original
      // unordered axis must still use point visits after the first query sorts
      // it. A method-identity check must not read a getter earlier than that query.
      expect(queries).toEqual([[[10, 100]], [[100, 100]], [[75, 75]], [[50, 50]], [[10, 10]]]);
      expect(items[0].thresholds).toEqual([100, 75, 50, 10]);
      expect(
        chunks.map((chunk) => ({
          count: chunk.coveredCandidates,
          thresholds: chunk.items[0].thresholds,
          excludedSignature: chunk.excludedSignature,
        })),
      ).toEqual([
        { count: 1, thresholds: [100], excludedSignature: undefined },
        { count: 1, thresholds: [75], excludedSignature: undefined },
        { count: 1, thresholds: [10], excludedSignature: undefined },
      ]);
      if (kind === 'getter') expect(getterReads).toBe(5);
    },
  );

  it.each([
    { name: 'repeated', thresholds: [100, 50, 100, 10], remaining: [100, 100, 10] },
    { name: 'unordered', thresholds: [100, 50, 75, 10], remaining: [100, 75, 10] },
  ])('retains the supplied $name axis under a whole-grid certificate', ({ thresholds, remaining }) => {
    const items = [food('a', 'mp', thresholds)];
    const excluded = buildFoodDefaultCandidate(items);
    const cache = createFoodOptimizerPruningCache({ rounds: 1, items });
    cache.record(excluded, failure(excluded));
    const chunks = [...generatePrunedFoodOptimizerCandidates(items, cache, excluded, { captureCoverage: true })];
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ coveredCandidates: 3, excludedSignature: excluded.signature });
    expect(chunks[0].items).toEqual(items);
    expect(
      [...generateFoodOptimizerCompositionCandidates(chunks[0].items)]
        .filter((candidate) => candidate.signature !== chunks[0].excludedSignature)
        .map((candidate) => candidate.slots[0].threshold),
    ).toEqual(remaining);
  });

  it('distinguishes the one empty composition from an axis with no choices even with full evidence', () => {
    const empty = buildFoodDefaultCandidate([]);
    const unusedFoodThresholds = { hp: 1, mp: 1 };
    const cache = createFoodOptimizerPruningCache({ rounds: 1 });
    cache.record(empty, {
      ...success(empty),
      unusedFoodThresholds,
      samples: [{ seed: 1, ranOutOfMana: false, stoppedEarly: false, unusedFoodThresholds }],
    });
    expect([...generatePrunedFoodOptimizerCandidates([], cache)]).toMatchObject([
      { coveredCandidates: 1, items: [], evidence: { unusedFood: true } },
    ]);
    expect([...generatePrunedFoodOptimizerCandidates([], cache, empty)]).toEqual([]);
    expect([
      ...generatePrunedFoodOptimizerCandidates([food('a', 'mp', [])], cache, undefined, { captureCoverage: true }),
    ]).toEqual([]);
  });

  it('keeps the exact point order and number of lookups when no evidence is available', () => {
    const items = [food('a', 'mp', [100, 50]), food('b', 'hp', [10, 50, 100]), food('c', 'hp', [100, 10, 75, 50])];
    const excluded = buildFoodDefaultCandidate(items);
    const cache = { matchRanges: vi.fn(() => null) };
    expect([...generatePrunedFoodOptimizerCandidates(items, cache, excluded)]).toEqual(
      [...generateFoodOptimizerCompositionCandidates(items)].filter(
        (candidate) => candidate.signature !== excluded.signature,
      ),
    );
    expect(cache.matchRanges).toHaveBeenCalledTimes(1 + 2 + 2 * 3 + 2 * 3 * 4);
  });

  it('uses a newly learned certificate to cover a billion-point grid with fewer than fifty lookups', () => {
    const thresholds = (offset) => Array.from({ length: 1000 }, (_, index) => offset + 1000 - index);
    const items = [
      food('mana', 'mp', thresholds(5000), 5500),
      food('high-hp', 'hp', thresholds(2000), 2500),
      food('low-hp', 'hp', thresholds(0), 500),
    ];
    const excluded = buildFoodDefaultCandidate(items);
    const cache = createFoodOptimizerPruningCache();
    const matchRanges = vi.spyOn(cache, 'matchRanges');
    const iterator = generatePrunedFoodOptimizerCandidates(items, cache, excluded);
    const first = iterator.next().value;
    expect(first).not.toHaveProperty('coveredCandidates');
    // The generator is already suspended inside its first leaf when the worker
    // returns this result. Its remaining sibling ranges must adapt immediately.
    cache.record(first, failure(first));
    const chunks = [...iterator];
    expect(chunks).toHaveLength(3);
    expect(chunks.reduce((count, chunk) => count + chunk.coveredCandidates, 0)).toBe(1_000_000_000 - 2);
    expect(chunks.filter((chunk) => chunk.excludedSignature === excluded.signature)).toHaveLength(1);
    expect(matchRanges.mock.calls.length).toBeLessThan(50);
    expect(chunks.every((chunk) => chunk.items === undefined)).toBe(true);
  });

  it('covers every remaining point exactly once across interval boundaries and changing slot orders', () => {
    const items = [
      food('b', 'mp', [100, 75, 50, 25, 10]),
      food('a', 'mp', [10, 25, 50, 75, 100], 75),
      food('h', 'hp', [100, 75, 50, 25, 10]),
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
          failure(entry, ({ threshold }) => (threshold >= 50 ? { min: 50, max: 100 } : { min: 1, max: 49 })),
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
    const items = [food('a', 'mp', [100, 50, 75, 25, 10])];
    const cache = createFoodOptimizerPruningCache();
    const iterator = generatePrunedFoodOptimizerCandidates(items, cache, undefined, { captureCoverage: true });
    const first = iterator.next().value;
    cache.record(first, failure(first));
    const chunks = [...iterator];
    expect(chunks).toHaveLength(4);
    expect(chunks.every((chunk) => chunk.coveredCandidates === 1)).toBe(true);
    expect(chunks.flatMap((chunk) => [...generateFoodOptimizerCompositionCandidates(chunk.items)])).toEqual(
      [...generateFoodOptimizerCompositionCandidates(items)].slice(1),
    );
  });

  it('retains exact feasible representatives and the default exclusion in ascending ranges', () => {
    const items = [food('a', 'mp', [10, 25, 50, 75, 100]), food('b', 'hp', [10, 25, 50, 75, 100])];
    const excluded = buildFoodDefaultCandidate(items);
    const cache = createFoodOptimizerPruningCache({ rounds: 1 });
    const iterator = generatePrunedFoodOptimizerCandidates(items, cache, excluded);
    const first = iterator.next().value;
    cache.record(first, {
      ...failure(first),
      feasible: true,
      rejected: '',
      ranOutOfMana: false,
      samples: [{ seed: 1, ranOutOfMana: false, stoppedEarly: false }],
    });
    const chunks = [...iterator];
    expect(chunks.every((chunk) => chunk.items)).toBe(true);
    expect(chunks.reduce((count, chunk) => count + chunk.coveredCandidates, 1)).toBe(24);
    const representatives = [
      first,
      ...chunks.flatMap((chunk) =>
        selectFoodOptimizerRepresentatives(chunk.items, {
          order: chunk.evidence.order,
          excludedSignature: chunk.excludedSignature,
        }),
      ),
    ];
    const bySignature = (left, right) => (left.signature < right.signature ? -1 : 1);
    expect(representatives.sort(bySignature).slice(0, 10)).toEqual(
      [...generateFoodOptimizerCompositionCandidates(items)]
        .filter((candidate) => candidate.signature !== excluded.signature)
        .sort(bySignature)
        .slice(0, 10),
    );
  });
});

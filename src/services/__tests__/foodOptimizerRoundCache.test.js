import { describe, expect, it } from 'vitest';
import { buildFoodCandidate } from '../foodOptimizerDomain.js';
import { createFoodOptimizerRoundCache } from '../foodOptimizerRoundCache.js';
import { evaluateFoodOptimizerCandidate, simulateFoodOptimizerRound } from '../foodOptimizerSimulation.js';
import { createFoodOptimizerFixture, referenceFoodOptimizerRound } from './support/foodOptimizerTestSupport.js';

const item = (hrid = '/items/gummy', threshold = 50, kind = 'mp') => ({
  hrid,
  threshold,
  kind,
  restore: 40,
  price: 10,
});
const candidateAt = (threshold = 50, hrid = '/items/gummy') => buildFoodCandidate([item(hrid, threshold)]);
const sampleFor = (candidate, overrides = {}) => ({
  seed: 1,
  deaths: 0,
  ranOutOfMana: false,
  stoppedEarly: false,
  simulatedTime: 600e9,
  foodUsed: Object.fromEntries(candidate.food.map((hrid) => [hrid, 3])),
  costPerHour: candidate.food.length ? 180 : 0,
  equivalentThresholds: candidate.slots.map(({ hrid, kind }) => ({ hrid, kind, min: 20, max: 100 })),
  unusedFoodThresholds: candidate.slots.length ? null : { hp: 26, mp: 51 },
  ...overrides,
});

describe('food optimizer complete-round cache', () => {
  it('isolates random streams and request instances while using the engine seed normalization', () => {
    const cache = createFoodOptimizerRoundCache();
    const candidate = candidateAt();
    const first = sampleFor(candidate);
    const second = sampleFor(candidate, { seed: 2, deaths: 3, costPerHour: 60 });
    cache.record(1, candidate, first);
    cache.record(2, candidate, second);

    expect(cache.match(1, candidateAt(75))).toBe(first);
    expect(cache.match(2, candidateAt(75))).toBe(second);
    expect(cache.match(3, candidateAt(75))).toBeNull();
    expect(createFoodOptimizerRoundCache().match(1, candidateAt(75))).toBeNull();

    const normalized = sampleFor(candidate, { seed: 0xffffffff });
    cache.record(-1, candidate, normalized);
    expect(cache.match(0xffffffff, candidate)).toBe(normalized);
    expect(cache.match(-1, candidate)).toEqual({ ...normalized, seed: -1 });
  });

  it('preserves the requested seed representation without changing the cached sample', () => {
    const cache = createFoodOptimizerRoundCache();
    const candidate = candidateAt();
    const original = Object.freeze(sampleFor(candidate, { seed: 0x100000001 }));
    cache.record(original.seed, candidate, original);

    const reused = cache.match(1, candidateAt(75));
    expect(reused).toEqual({ ...original, seed: 1 });
    expect(reused).not.toBe(original);
    expect(original.seed).toBe(0x100000001);
    expect(cache.match(original.seed, candidateAt(75))).toBe(original);
  });

  it('keeps catalog thresholds and prices isolated between requests', () => {
    const catalog = [
      { ...item('core'), thresholds: [100, 75, 50] },
      { ...item('extra', 120, 'hp'), thresholds: [120, 100] },
    ];
    const otherCatalog = [
      { ...catalog[0], price: 20, thresholds: [100, 80, 50] },
      { ...catalog[1], price: 20, thresholds: [140, 100] },
    ];
    const cache = createFoodOptimizerRoundCache({ items: catalog });
    const otherCache = createFoodOptimizerRoundCache({ items: otherCatalog });
    const source = candidateAt(50, 'core');
    const otherSource = buildFoodCandidate([{ ...otherCatalog[0], threshold: 50 }]);
    const first = sampleFor(source, { inactiveFoodThresholds: { hp: 101, mp: 101 } });
    const second = sampleFor(otherSource, { inactiveFoodThresholds: { hp: 101, mp: 101 }, costPerHour: 360 });
    cache.record(1, source, first);
    otherCache.record(1, otherSource, second);

    const equivalent = candidateAt(75, 'core');
    const otherEquivalent = buildFoodCandidate([{ ...otherCatalog[0], threshold: 80 }]);
    expect(cache.match(1, equivalent)).toBe(first);
    expect(otherCache.match(1, otherEquivalent)).toBe(second);
    expect(cache.match(1, otherSource)).toBeNull();
    expect(otherCache.match(1, source)).toBeNull();
    expect(cache.match(1, candidateAt(80, 'core'))).toBeNull();
    expect(otherCache.match(1, buildFoodCandidate([{ ...otherCatalog[0], threshold: 75 }]))).toBeNull();
    expect(cache.match(1, otherEquivalent)).toBeNull();
    expect(otherCache.match(1, equivalent)).toBeNull();

    const expanded = buildFoodCandidate([...source.slots, item('extra', 120, 'hp')]);
    const otherExpanded = buildFoodCandidate([...otherSource.slots, { ...otherCatalog[1], threshold: 140 }]);
    expect(cache.match(1, expanded)?.foodUsed).toEqual({ core: 3, extra: 0 });
    expect(otherCache.match(1, otherExpanded)?.foodUsed).toEqual({ core: 3, extra: 0 });
    expect(cache.match(1, otherExpanded)).toBeNull();
    expect(otherCache.match(1, expanded)).toBeNull();
  });

  it('matches only the observed composition and compatible slot order', () => {
    const cache = createFoodOptimizerRoundCache();
    const candidate = buildFoodCandidate([item('first', 70), item('second', 40)]);
    const sample = sampleFor(candidate);
    cache.record(1, candidate, sample);

    expect(cache.match(1, buildFoodCandidate([item('first', 90), item('second', 30)]))).toBe(sample);
    expect(cache.match(1, buildFoodCandidate([item('first', 30), item('second', 90)]))).toBeNull();
    expect(cache.match(1, buildFoodCandidate([item('first', 90), item('other', 30)]))).toBeNull();
    expect(cache.match(1, buildFoodCandidate([item('first', 90), item('second', 19)]))).toBeNull();
  });

  it('preserves complete physical results across thresholds in a real observed trajectory', async () => {
    const { request, items } = createFoodOptimizerFixture({ foodSlots: 1, rounds: 1 });
    const food = items.find((entry) => entry.hrid === '/items/star_fruit_yogurt');
    const candidate = buildFoodCandidate([{ ...food, threshold: 1 }]);
    const sample = await simulateFoodOptimizerRound(request, candidate, request.seeds[0]);
    expect(sample).toMatchObject({ stoppedEarly: false, ranOutOfMana: false });
    expect(sample.foodUsed[food.hrid]).toBeGreaterThan(0);
    expect(sample.equivalentThresholds[0].max).toBeGreaterThan(1);

    const cache = createFoodOptimizerRoundCache();
    cache.record(request.seeds[0], candidate, sample);
    const equivalent = buildFoodCandidate([{ ...food, threshold: 2 }]);
    const cached = cache.match(request.seeds[0], equivalent);
    const reference = await referenceFoodOptimizerRound(request, equivalent, request.seeds[0]);
    const { equivalentThresholds, unusedFoodThresholds, inactiveFoodThresholds, ...physical } = cached;
    expect(physical).toEqual(reference);
  });

  it.each([{ seed: 2 }, { stoppedEarly: true }, { ranOutOfMana: true }, { simulatedTime: 0 }, { costPerHour: -1 }])(
    'does not cache an incomplete or invalid sample: %j',
    (overrides) => {
      const cache = createFoodOptimizerRoundCache();
      const candidate = candidateAt();
      cache.record(1, candidate, sampleFor(candidate, overrides));

      expect(cache.match(1, candidateAt(75))).toBeNull();
      expect(cache.size).toBe(0);
      expect(cache.seedCount).toBe(0);
    },
  );

  it('materializes inactive food counts without changing the no-food certificate', () => {
    const cache = createFoodOptimizerRoundCache();
    const empty = buildFoodCandidate([]);
    const sample = sampleFor(empty);
    const original = structuredClone(sample);
    cache.record(1, empty, sample);
    const candidate = buildFoodCandidate([item('health', 26, 'hp'), item('mana', 51)]);
    const reused = cache.match(1, candidate);

    expect(reused).toMatchObject({
      seed: 1,
      deaths: 0,
      stoppedEarly: false,
      ranOutOfMana: false,
      simulatedTime: 600e9,
      foodUsed: { health: 0, mana: 0 },
      costPerHour: 0,
      unusedFoodThresholds: null,
      equivalentThresholds: [
        { hrid: 'mana', kind: 'mp', min: 51, max: Number.MAX_SAFE_INTEGER },
        { hrid: 'health', kind: 'hp', min: 26, max: Number.MAX_SAFE_INTEGER },
      ],
    });
    reused.foodUsed.mana = 99;
    expect(cache.match(1, candidate).foodUsed.mana).toBe(0);
    expect(cache.match(1, empty)).toBe(sample);
    expect(sample).toEqual(original);
    expect(cache.match(1, candidateAt(50, 'mana'))).toBeNull();
    expect(cache.match(1, buildFoodCandidate([item('health', 25, 'hp')]))).toBeNull();
  });
});

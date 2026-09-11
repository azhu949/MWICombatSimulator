import { describe, expect, it } from 'vitest';
import { buildFoodCandidate } from '../foodOptimizerDomain.js';
import { createFoodOptimizerInactiveCache } from '../foodOptimizerInactiveCache.js';
import { createFoodOptimizerRoundCache, matchFoodOptimizerReusableSample } from '../foodOptimizerRoundCache.js';

const item = (hrid, threshold = 50, kind = 'mp', overrides = {}) => ({
  hrid,
  threshold,
  kind,
  restore: 40,
  price: 10,
  recoveryDuration: 0,
  ...overrides,
});
const candidateAt = (threshold = 50, hrid = 'core') => buildFoodCandidate([item(hrid, threshold)]);
const sampleFor = (candidate, overrides = {}) => ({
  seed: 1,
  deaths: 2,
  ranOutOfMana: false,
  stoppedEarly: false,
  simulatedTime: 600e9,
  foodUsed: Object.fromEntries(candidate.food.map((hrid) => [hrid, 3])),
  costPerHour: candidate.food.length * 180,
  equivalentThresholds: candidate.slots.map(({ hrid, kind, threshold }) => ({
    hrid,
    kind,
    min: Math.max(1, threshold - 30),
    max: threshold + 30,
  })),
  unusedFoodThresholds: null,
  inactiveFoodThresholds: { hp: 101, mp: 101 },
  ...overrides,
});
const withExtra = (core, threshold = 101, kind = 'hp') =>
  buildFoodCandidate([...core.slots, item('extra', threshold, kind)]);

describe('food optimizer consumed-core round certificates', () => {
  it('adds two inactive foods and materializes complete target counts and threshold ranges', () => {
    const cache = createFoodOptimizerInactiveCache();
    const source = candidateAt();
    const sample = sampleFor(source);
    const original = structuredClone(sample);
    cache.record(1, source, sample);
    const target = buildFoodCandidate([item('core', 75), item('health-a', 101, 'hp'), item('health-b', 150, 'hp')]);
    const reused = cache.match(1, target);

    expect(reused).toEqual({
      ...sample,
      foodUsed: { core: 3, 'health-b': 0, 'health-a': 0 },
      equivalentThresholds: [
        { hrid: 'core', kind: 'mp', min: 20, max: 80 },
        { hrid: 'health-b', kind: 'hp', min: 101, max: Number.MAX_SAFE_INTEGER },
        { hrid: 'health-a', kind: 'hp', min: 101, max: Number.MAX_SAFE_INTEGER },
      ],
    });
    expect(matchFoodOptimizerReusableSample(1, target, reused, sample.simulatedTime)).toBe(reused);
    expect(sample).toEqual(original);
    expect(cache.size).toBe(1);
  });

  it('removes explicitly unused source foods even if their thresholds are below the global inactive bound', () => {
    const cache = createFoodOptimizerInactiveCache();
    const source = buildFoodCandidate([item('core'), item('unused', 5, 'hp')]);
    const sample = sampleFor(source, { foodUsed: { core: 3, unused: 0 }, costPerHour: 180 });
    cache.record(1, source, sample);

    expect(cache.match(1, candidateAt(75))).toEqual({
      ...sample,
      foodUsed: { core: 3 },
      equivalentThresholds: [{ hrid: 'core', kind: 'mp', min: 20, max: 80 }],
    });
    expect(cache.match(1, withExtra(candidateAt(), 101))).toMatchObject({ foodUsed: { core: 3, extra: 0 } });
    expect(cache.match(1, source)).toBeNull();
  });

  it.each([
    ['before', [item('core')], item('extra', 101), ['extra', 'core']],
    [
      'between',
      [item('core-mp'), item('core-hp', 40, 'hp')],
      item('extra', 101, 'hp'),
      ['core-mp', 'extra', 'core-hp'],
    ],
    ['after', [item('core')], item('extra', 101, 'hp'), ['core', 'extra']],
  ])('allows adding and removing an inactive food %s the consumed core', (position, coreItems, extra, order) => {
    const core = buildFoodCandidate(coreItems);
    const target = buildFoodCandidate([...coreItems, extra]);
    const cache = createFoodOptimizerInactiveCache();
    const sample = sampleFor(core);
    cache.record(1, core, sample);
    const added = cache.match(1, target);

    expect(target.food).toEqual(order);
    expect(added).not.toBeNull();
    expect(added.foodUsed.extra).toBe(0);
    expect(added.costPerHour).toBe(sample.costPerHour);
    const reverse = createFoodOptimizerInactiveCache();
    reverse.record(1, target, added);
    expect(reverse.match(1, core)).toEqual(sample);
  });

  it('requires every consumed food and preserves their relative order', () => {
    const cache = createFoodOptimizerInactiveCache();
    const source = buildFoodCandidate([item('first', 70), item('second', 50)]);
    const sample = sampleFor(source, {
      equivalentThresholds: source.slots.map(({ hrid, kind }) => ({ hrid, kind, min: 20, max: 90 })),
    });
    cache.record(1, source, sample);

    expect(cache.match(1, buildFoodCandidate([item('first', 80), item('second', 30)]))).not.toBeNull();
    expect(cache.match(1, buildFoodCandidate([item('first', 30), item('second', 80)]))).toBeNull();
    expect(cache.match(1, candidateAt(70, 'first'))).toBeNull();
    expect(cache.match(1, buildFoodCandidate([item('first', 70), item('replacement', 50)]))).toBeNull();
  });

  it('accepts the exact inactive and core bounds while rejecting a threshold outside either proof', () => {
    const cache = createFoodOptimizerInactiveCache();
    const source = candidateAt();
    cache.record(1, source, sampleFor(source, { inactiveFoodThresholds: { hp: 101, mp: 121 } }));

    expect(cache.match(1, withExtra(candidateAt(20), 101))).not.toBeNull();
    expect(cache.match(1, withExtra(candidateAt(80), 121, 'mp'))).not.toBeNull();
    expect(cache.match(1, withExtra(candidateAt(), 100))).toBeNull();
    expect(cache.match(1, withExtra(candidateAt(), 120, 'mp'))).toBeNull();
    expect(cache.match(1, withExtra(candidateAt(19)))).toBeNull();
    expect(cache.match(1, withExtra(candidateAt(81)))).toBeNull();
  });

  it('normalizes the random stream but preserves the requested seed representation', () => {
    const cache = createFoodOptimizerInactiveCache();
    const source = candidateAt();
    const sample = sampleFor(source, { seed: 0xffffffff });
    cache.record(-1, source, sample);
    const target = withExtra(source);

    expect(cache.match(-1, target)).toMatchObject({ seed: -1, foodUsed: { core: 3, extra: 0 } });
    expect(cache.match(0x1ffffffff, target).seed).toBe(0x1ffffffff);
    expect(cache.match(1, target)).toBeNull();
    expect(cache.match(Number.MAX_SAFE_INTEGER + 1, target)).toBeNull();
    expect(sample.seed).toBe(0xffffffff);
    const mismatch = createFoodOptimizerInactiveCache();
    mismatch.record(1, source, sample);
    expect(mismatch.size).toBe(0);
  });

  it.each([
    ['missing restore', (candidate) => delete candidate.slots[0].restore],
    ['zero restore', (candidate) => (candidate.slots[0].restore = 0)],
    ['missing price', (candidate) => delete candidate.slots[0].price],
    ['negative price', (candidate) => (candidate.slots[0].price = -1)],
    ['invalid duration', (candidate) => (candidate.slots[0].recoveryDuration = Infinity)],
    ['invalid kind', (candidate) => (candidate.slots[0].kind = 'other')],
    ['fractional threshold', (candidate) => (candidate.slots[0].threshold = 50.5)],
    ['missing trigger', (candidate) => delete candidate.triggerMap[candidate.food[0]]],
    ['wrong dependency', (candidate) => (candidate.triggerMap[candidate.food[0]][0].dependencyHrid = 'enemy')],
    ['wrong condition', (candidate) => (candidate.triggerMap[candidate.food[0]][0].conditionHrid = 'missing_hp')],
    ['wrong comparator', (candidate) => (candidate.triggerMap[candidate.food[0]][0].comparatorHrid = 'less_than')],
    ['wrong trigger value', (candidate) => (candidate.triggerMap[candidate.food[0]][0].value = 25)],
    ['extra trigger', (candidate) => candidate.triggerMap[candidate.food[0]].push({})],
    ['misaligned foods', (candidate) => candidate.food.reverse()],
    [
      'noncanonical order',
      (candidate) => {
        candidate.food.reverse();
        candidate.slots.reverse();
      },
    ],
  ])('rejects a source or target with %s', (label, invalidate) => {
    const source = buildFoodCandidate([item('first', 70), item('second', 50)]);
    const invalid = structuredClone(source);
    const sample = sampleFor(source);
    invalidate(invalid);
    const rejected = createFoodOptimizerInactiveCache();
    rejected.record(1, invalid, sample);
    expect(rejected.size).toBe(0);

    const cache = createFoodOptimizerInactiveCache();
    cache.record(1, source, sample);
    expect(cache.match(1, invalid)).toBeNull();
  });

  it.each([{ restore: 41 }, { price: 11 }, { recoveryDuration: 1 }, { recoveryDuration: undefined }])(
    'requires the consumed food effect and price metadata to match: %j',
    (overrides) => {
      const source = candidateAt();
      const cache = createFoodOptimizerInactiveCache();
      cache.record(1, source, sampleFor(source));
      expect(
        cache.match(1, buildFoodCandidate([item('core', 50, 'mp', overrides), item('extra', 101, 'hp')])),
      ).toBeNull();
    },
  );

  it.each([
    ['missing zero count', (sample) => delete sample.foodUsed.unused],
    ['extra count', (sample) => (sample.foodUsed.unselected = 0)],
    ['negative count', (sample) => (sample.foodUsed.core = -1)],
    ['fractional count', (sample) => (sample.foodUsed.core = 0.5)],
    ['nonfinite count', (sample) => (sample.foodUsed.core = NaN)],
    ['absent ranges', (sample) => (sample.equivalentThresholds = null)],
    ['missing range', (sample) => sample.equivalentThresholds.pop()],
    ['wrong range food', (sample) => (sample.equivalentThresholds[0].hrid = 'other')],
    ['range outside source', (sample) => (sample.equivalentThresholds[0].min = 51)],
    ['invalid range bound', (sample) => (sample.equivalentThresholds[0].max = Infinity)],
    ['absent inactive bound', (sample) => delete sample.inactiveFoodThresholds],
    ['missing inactive kind', (sample) => delete sample.inactiveFoodThresholds.hp],
    ['nonpositive inactive bound', (sample) => (sample.inactiveFoodThresholds.hp = 0)],
    ['fractional inactive bound', (sample) => (sample.inactiveFoodThresholds.hp = 1.5)],
    ['inherited inactive bound', (sample) => (sample.inactiveFoodThresholds = Object.create({ hp: 101, mp: 101 }))],
    ['early stop', (sample) => (sample.stoppedEarly = true)],
    ['mana failure', (sample) => (sample.ranOutOfMana = true)],
    ['invalid deaths', (sample) => (sample.deaths = -1)],
    ['invalid duration', (sample) => (sample.simulatedTime = 0)],
    ['invalid cost', (sample) => (sample.costPerHour = NaN)],
  ])('does not infer a consumed core from a sample with %s', (label, invalidate) => {
    const source = buildFoodCandidate([item('core'), item('unused', 101, 'hp')]);
    const sample = sampleFor(source, { foodUsed: { core: 3, unused: 0 } });
    invalidate(sample);
    const cache = createFoodOptimizerInactiveCache();
    cache.record(1, source, sample);
    expect(cache.size).toBe(0);
    expect(cache.match(1, candidateAt())).toBeNull();
  });

  it('leaves zero-food and three-consumed-food samples to the existing paths', () => {
    const cache = createFoodOptimizerInactiveCache();
    const source = candidateAt();
    cache.record(1, source, sampleFor(source, { foodUsed: { core: 0 }, costPerHour: 0 }));
    const empty = buildFoodCandidate([]);
    cache.record(1, empty, sampleFor(empty));
    const full = buildFoodCandidate([item('first'), item('second'), item('third')]);
    cache.record(1, full, sampleFor(full));
    expect(cache.size).toBe(0);
  });

  it('snapshots source evidence and returns independent counts, ranges and inactive bounds', () => {
    const source = candidateAt();
    const sample = sampleFor(source);
    const expected = structuredClone(sample);
    const cache = createFoodOptimizerInactiveCache();
    cache.record(1, source, sample);
    source.slots[0].restore = 999;
    sample.costPerHour = 0;
    sample.foodUsed.core = 99;
    sample.equivalentThresholds[0].min = 1;
    sample.inactiveFoodThresholds.hp = 1;

    const target = withExtra(candidateAt());
    const first = cache.match(1, target);
    expect(first.costPerHour).toBe(expected.costPerHour);
    expect(first.foodUsed.core).toBe(3);
    expect(first.equivalentThresholds[0].min).toBe(20);
    expect(first.inactiveFoodThresholds.hp).toBe(101);
    first.foodUsed.core = 77;
    first.equivalentThresholds[0].max = 1000;
    first.inactiveFoodThresholds.hp = 1;
    const second = cache.match(1, target);
    expect(second.foodUsed.core).toBe(3);
    expect(second.equivalentThresholds[0].max).toBe(80);
    expect(second.inactiveFoodThresholds.hp).toBe(101);
    expect(cache.match(1, withExtra(candidateAt(), 100))).toBeNull();
  });

  it('retains a single grid point because the same core can cover multiple compositions', () => {
    const source = candidateAt();
    const target = withExtra(source, 150);
    const items = [...source.slots, item('extra', 150, 'hp')].map((slot) => ({
      ...slot,
      thresholds: [slot.threshold],
    }));
    const sample = sampleFor(source, { equivalentThresholds: [{ hrid: 'core', kind: 'mp', min: 50, max: 50 }] });
    const cache = createFoodOptimizerRoundCache({ items, maxSeeds: 1 });
    cache.record(1, source, sample);

    expect(cache.size).toBe(1);
    expect(cache.seedCount).toBe(1);
    expect(cache.match(1, target)).toMatchObject({ foodUsed: { core: 3, extra: 0 } });
    expect(cache.match(1, withExtra(source, 149))).toBeNull();
    cache.record(2, source, { ...sample, seed: 2 });
    expect(cache.size).toBe(1);
    expect(cache.seedCount).toBe(1);
    expect(cache.match(1, target)).toBeNull();
    expect(cache.match(2, target)).not.toBeNull();
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.seedCount).toBe(0);
    expect(cache.match(2, target)).toBeNull();

    const rejected = createFoodOptimizerInactiveCache({ items });
    const offGrid = candidateAt(51);
    rejected.record(1, offGrid, sampleFor(offGrid));
    expect(rejected.size).toBe(0);
  });

  it.each([
    [2, 3],
    [100, 65],
  ])('bounds the FIFO cache with maxEntries %i', (maxEntries, total) => {
    const cache = createFoodOptimizerInactiveCache({ maxEntries });
    for (let index = 0; index < total; index += 1) {
      const candidate = candidateAt(50, `core-${index}`);
      cache.record(1, candidate, sampleFor(candidate));
    }
    expect(cache.size).toBe(total - 1);
    expect(cache.match(1, withExtra(candidateAt(50, 'core-0')))).toBeNull();
    expect(cache.match(1, withExtra(candidateAt(50, 'core-1')))).not.toBeNull();
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.match(1, withExtra(candidateAt(50, 'core-1')))).toBeNull();
  });

  it('suppresses duplicate and dominated proofs while keeping independently useful bounds', () => {
    const cache = createFoodOptimizerInactiveCache();
    const source = candidateAt();
    const proof = (min, max, inactive) =>
      sampleFor(source, {
        equivalentThresholds: [{ hrid: 'core', kind: 'mp', min, max }],
        inactiveFoodThresholds: { hp: inactive, mp: inactive },
      });
    cache.record(1, source, proof(30, 70, 101));
    cache.record(1, source, proof(30, 70, 101));
    cache.record(1, source, proof(40, 60, 120));
    expect(cache.size).toBe(1);
    cache.record(1, source, proof(20, 80, 90));
    expect(cache.size).toBe(1);
    expect(cache.match(1, withExtra(candidateAt(75), 90))).not.toBeNull();
    cache.record(1, source, proof(10, 50, 95));
    expect(cache.size).toBe(2);
    expect(cache.match(1, withExtra(candidateAt(10), 95))).not.toBeNull();
    expect(cache.match(1, withExtra(candidateAt(75), 90))).not.toBeNull();
  });
});

describe('consumed-core integration with the complete-round cache', () => {
  it('prefers an ordinary certificate and preserves its sample identity and inactive bounds', () => {
    const cache = createFoodOptimizerRoundCache();
    const source = candidateAt();
    const sample = sampleFor(source);
    cache.record(1, source, sample);

    expect(cache.size).toBe(2);
    expect(cache.match(1, candidateAt(75))).toBe(sample);
    expect(cache.match(1, withExtra(candidateAt(75)))).toMatchObject({
      inactiveFoodThresholds: sample.inactiveFoodThresholds,
      foodUsed: { core: 3, extra: 0 },
    });
  });

  it('preserves inactive metadata when the no-food certificate materializes another composition', () => {
    const cache = createFoodOptimizerRoundCache();
    const source = buildFoodCandidate([]);
    const sample = sampleFor(source, { unusedFoodThresholds: { hp: 101, mp: 101 } });
    cache.record(1, source, sample);
    const target = buildFoodCandidate([item('health', 101, 'hp'), item('mana', 101)]);
    const reused = cache.match(1, target);

    expect(cache.match(1, source)).toBe(sample);
    expect(reused).toMatchObject({ foodUsed: { health: 0, mana: 0 }, inactiveFoodThresholds: { hp: 101, mp: 101 } });
    expect(matchFoodOptimizerReusableSample(1, target, reused, sample.simulatedTime)).toBe(reused);
  });

  it('validates new inactive metadata while retaining compatibility with absent metadata', () => {
    const candidate = candidateAt();
    const sample = sampleFor(candidate);
    for (const inactiveFoodThresholds of [{ hp: 101 }, { hp: 0, mp: 101 }, { hp: 1.5, mp: 101 }, []]) {
      expect(
        matchFoodOptimizerReusableSample(1, candidate, { ...sample, inactiveFoodThresholds }, sample.simulatedTime),
      ).toBeNull();
    }
    for (const inactiveFoodThresholds of [undefined, null, { hp: 101, mp: 101 }]) {
      const compatible = { ...sample, inactiveFoodThresholds };
      expect(matchFoodOptimizerReusableSample(1, candidate, compatible, sample.simulatedTime)).toBe(compatible);
    }
  });
});

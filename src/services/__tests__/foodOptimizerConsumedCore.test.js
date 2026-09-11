import { describe, expect, it } from 'vitest';
import { buildFoodCandidate } from '../foodOptimizerDomain.js';
import { createFoodOptimizerInactiveCache } from '../foodOptimizerInactiveCache.js';
import {
  createFoodOptimizerPruningCache,
  materializeFoodOptimizerOutcome,
  selectFoodOptimizerConsumedCoreCapacity,
} from '../foodOptimizerPruning.js';
import { createFoodOptimizerRoundCache, matchFoodOptimizerReusableSample } from '../foodOptimizerRoundCache.js';

const MAX_THRESHOLD = Number.MAX_SAFE_INTEGER;
const food = (hrid, kind, thresholds, restore = 50) => ({ hrid, kind, thresholds, restore, price: 1 });
const at = (item, threshold) => ({ ...item, threshold });
const MANA = food('mana', 'mp', [100, 50, 10]);
const OTHER = food('other', 'mp', [70, 30]);
const THIRD = food('third', 'mp', [60, 40]);
const HEALTH = food('health', 'hp', [80, 20]);
const SCRATCH = food('scratch', 'hp', [90, 30]);

const failureCapacity = { maxFailureCoreEntries: 32, maxCoreGroupEntries: 8 };
const feasibleCapacity = { maxFeasibleCoreEntries: 8, maxCoreGroupEntries: 8 };

// A mana failure certifies the failing seed's round only, exactly like the
// same-composition entry: a food above the per-kind bound never fires there.
const manaWitness = (candidate, cores, inactive, coreRanges) => ({
  rejected: 'mana',
  feasible: false,
  roundsCompleted: 1,
  samples: [
    {
      seed: 1,
      ranOutOfMana: true,
      stoppedEarly: true,
      foodUsed: Object.fromEntries(candidate.food.map((hrid) => [hrid, cores[hrid] ?? 0])),
      inactiveFoodThresholds: inactive,
    },
  ],
  equivalentThresholds: candidate.slots.map(({ hrid, kind }) => ({
    hrid,
    kind,
    ...(coreRanges[hrid] ?? { min: 1, max: 100 }),
  })),
  inactiveFoodThresholds: inactive,
});

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

describe('consumed-core cross-composition reuse', () => {
  it('stays disabled by default so only explicit capacities change behavior', () => {
    const cache = createFoodOptimizerPruningCache({ rounds: 1 });
    const witness = buildFoodCandidate([at(MANA, 50), at(HEALTH, 20)]);
    cache.record(witness, manaWitness(witness, { mana: 2 }, { hp: 20, mp: 61 }, {}));
    expect(cache.match(buildFoodCandidate([at(MANA, 50), at(SCRATCH, 80)]))).toBeNull();
  });

  it('reuses a mana failure for larger compositions whose added foods never trigger', () => {
    const cache = createFoodOptimizerPruningCache({ rounds: 1, ...failureCapacity });
    const witness = buildFoodCandidate([at(MANA, 50), at(HEALTH, 20)]);
    cache.record(
      witness,
      manaWitness(
        witness,
        { mana: 2 },
        { hp: 20, mp: 61 },
        { mana: { min: 45, max: 60 }, health: { min: 15, max: 25 } },
      ),
    );
    // Sorted order: mana (mp) first, then the HP foods by descending threshold.
    const covered = buildFoodCandidate([at(MANA, 50), at(SCRATCH, 80), at(HEALTH, 20)]);
    expect(cache.match(covered)?.result).toMatchObject({ rejected: 'mana', feasible: false });
    // The added food may also sort before a single-food core: it never fires.
    expect(cache.match(buildFoodCandidate([at(OTHER, 80), at(MANA, 50)]))?.result).toMatchObject({
      rejected: 'mana',
    });
    // A too-low added threshold, a threshold outside the core range, and a
    // different core are never certified by this entry.
    expect(cache.match(buildFoodCandidate([at(MANA, 50), at(SCRATCH, 19)]))).toBeNull();
    expect(cache.match(buildFoodCandidate([at(MANA, 70), at(SCRATCH, 80)]))).toBeNull();
    expect(cache.match(buildFoodCandidate([at(HEALTH, 20), at(SCRATCH, 80)]))).toBeNull();
  });

  it('checks the per-kind bound against every food of the query, not only the probed subset', () => {
    const single = createFoodOptimizerPruningCache({ rounds: 1, ...failureCapacity });
    const witness = buildFoodCandidate([at(MANA, 50), at(HEALTH, 20)]);
    single.record(witness, manaWitness(witness, { mana: 2 }, { hp: 20, mp: 61 }, { mana: { min: 45, max: 60 } }));
    expect(single.match(buildFoodCandidate([at(MANA, 50), at(SCRATCH, 19), at(HEALTH, 20)]))).toBeNull();
    expect(single.match(buildFoodCandidate([at(MANA, 50), at(SCRATCH, 20), at(HEALTH, 20)]))).not.toBeNull();

    // The same guard must hold when the probed core is a pair that skips the
    // intervening inactive food.
    const pair = createFoodOptimizerPruningCache({ rounds: 1, ...failureCapacity });
    pair.record(
      witness,
      manaWitness(
        witness,
        { mana: 2, health: 1 },
        { hp: 20, mp: 61 },
        {
          mana: { min: 45, max: 60 },
          health: { min: 15, max: 25 },
        },
      ),
    );
    expect(pair.match(buildFoodCandidate([at(MANA, 50), at(SCRATCH, 19), at(HEALTH, 20)]))).toBeNull();
    expect(pair.match(buildFoodCandidate([at(MANA, 50), at(SCRATCH, 20), at(HEALTH, 20)]))).not.toBeNull();
  });

  it('requires the full-prefix intersection bound for death failures', () => {
    const cache = createFoodOptimizerPruningCache({ rounds: 2, ...failureCapacity });
    const witness = buildFoodCandidate([at(MANA, 50), at(HEALTH, 20)]);
    cache.record(witness, {
      rejected: 'deaths',
      feasible: false,
      roundsCompleted: 2,
      samples: [
        {
          seed: 1,
          deaths: 0,
          ranOutOfMana: false,
          foodUsed: { mana: 2, health: 0 },
          inactiveFoodThresholds: { hp: 20, mp: 61 },
        },
        {
          seed: 2,
          deaths: 3,
          ranOutOfMana: false,
          stoppedEarly: true,
          foodUsed: { mana: 1, health: 0 },
          inactiveFoodThresholds: { hp: 25, mp: 51 },
        },
      ],
      equivalentThresholds: [
        { hrid: 'mana', kind: 'mp', min: 45, max: 60 },
        { hrid: 'health', kind: 'hp', min: 15, max: 25 },
      ],
      inactiveFoodThresholds: { hp: 25, mp: 51 },
    });
    expect(cache.match(buildFoodCandidate([at(MANA, 50), at(SCRATCH, 70)]))?.result).toMatchObject({
      rejected: 'deaths',
      roundsCompleted: 2,
    });
    // 24 clears the first round's bound but not the intersected full-prefix one.
    expect(cache.match(buildFoodCandidate([at(MANA, 50), at(SCRATCH, 24)]))).toBeNull();
    expect(cache.match(buildFoodCandidate([at(MANA, 40), at(SCRATCH, 70)]))).toBeNull();
  });

  it('materializes a feasible core for larger compositions with zero added consumption', () => {
    const cache = createFoodOptimizerPruningCache({ rounds: 3, ...feasibleCapacity });
    const witness = buildFoodCandidate([at(MANA, 50), at(HEALTH, 20)]);
    const sample = (seed) => ({
      seed,
      deaths: 0,
      ranOutOfMana: false,
      stoppedEarly: false,
      simulatedTime: 600e9,
      foodUsed: { mana: 2, health: 1 },
      costPerHour: 120,
      equivalentThresholds: [
        { hrid: 'mana', kind: 'mp', min: 45, max: 60 },
        { hrid: 'health', kind: 'hp', min: 15, max: 25 },
      ],
      inactiveFoodThresholds: { hp: 30, mp: 61 },
      unusedFoodThresholds: null,
    });
    cache.record(witness, {
      feasible: true,
      rejected: '',
      ranOutOfMana: false,
      deaths: 0,
      roundsCompleted: 3,
      costPerHour: 120,
      foodUsed: { mana: 2, health: 1 },
      samples: [sample(1), sample(2), sample(3)],
      equivalentThresholds: [
        { hrid: 'mana', kind: 'mp', min: 45, max: 60 },
        { hrid: 'health', kind: 'hp', min: 15, max: 25 },
      ],
      inactiveFoodThresholds: { hp: 30, mp: 61 },
    });
    // The added food sorts between the two consumed core foods.
    const candidate = buildFoodCandidate([at(MANA, 50), at(SCRATCH, 80), at(HEALTH, 20)]);
    const evidence = cache.match(candidate);
    expect(evidence?.coreRanges).toEqual([
      { hrid: 'mana', kind: 'mp', min: 45, max: 60 },
      { hrid: 'health', kind: 'hp', min: 15, max: 25 },
    ]);
    const outcome = materializeFoodOptimizerOutcome(evidence, candidate);
    expect(outcome).toMatchObject({ feasible: true, roundsCompleted: 3, costPerHour: 120 });
    expect(outcome.foodUsed).toEqual({ mana: 2, scratch: 0, health: 1 });
    expect(outcome.equivalentThresholds).toEqual([
      { hrid: 'mana', kind: 'mp', min: 45, max: 60 },
      { hrid: 'scratch', kind: 'hp', min: 30, max: MAX_THRESHOLD },
      { hrid: 'health', kind: 'hp', min: 15, max: 25 },
    ]);
    expect(outcome.samples).toHaveLength(3);
    expect(outcome.samples[0]).toMatchObject({ foodUsed: { mana: 2, scratch: 0, health: 1 }, deaths: 0 });
    expect(outcome.samples[0].equivalentThresholds[1]).toEqual({
      hrid: 'scratch',
      kind: 'hp',
      min: 30,
      max: MAX_THRESHOLD,
    });
  });

  it('keeps a consumed pair eligible only while the recorded slot order holds', () => {
    const cache = createFoodOptimizerPruningCache({ rounds: 1, ...failureCapacity });
    const witness = buildFoodCandidate([at(MANA, 50), at(OTHER, 30)]);
    cache.record(witness, {
      rejected: 'mana',
      feasible: false,
      roundsCompleted: 1,
      samples: [
        {
          seed: 1,
          ranOutOfMana: true,
          stoppedEarly: true,
          foodUsed: { mana: 1, other: 1 },
          inactiveFoodThresholds: { hp: 20, mp: 61 },
        },
      ],
      // Overlapping ranges: a covered query may sort the pair either way, and
      // only the queries that keep the witness's physical order are equivalent.
      equivalentThresholds: [
        { hrid: 'mana', kind: 'mp', min: 45, max: 60 },
        { hrid: 'other', kind: 'mp', min: 30, max: 70 },
      ],
      inactiveFoodThresholds: { hp: 20, mp: 61 },
    });
    expect(cache.match(buildFoodCandidate([at(MANA, 60), at(OTHER, 30)]))?.result).toMatchObject({
      rejected: 'mana',
    });
    expect(cache.match(buildFoodCandidate([at(MANA, 45), at(OTHER, 70)]))).toBeNull();
    expect(cache.match(buildFoodCandidate([at(MANA, 50), at(OTHER, 40)]))?.result).toMatchObject({
      rejected: 'mana',
    });
    // A covered block that spans the flip point must be rejected as a whole:
    // some of its candidates would run a different physical slot order.
    const block = (manaMin, manaMax, otherMin, otherMax) => [
      { hrid: 'mana', kind: 'mp', min: manaMin, max: manaMax, restore: 50, price: 1 },
      { hrid: 'other', kind: 'mp', min: otherMin, max: otherMax, restore: 50, price: 1 },
      { hrid: 'scratch', kind: 'hp', min: 20, max: 30, restore: 50, price: 1 },
    ];
    expect(cache.matchRanges(block(55, 60, 30, 40))).not.toBeNull();
    expect(cache.matchRanges(block(45, 60, 30, 70))).toBeNull();
  });

  it('revalidates a cost-pruned core against the current ranking cutoff', () => {
    let cutoff = 100;
    const cache = createFoodOptimizerPruningCache({
      rounds: 2,
      maxFailureCoreEntries: 32,
      maxCoreGroupEntries: 8,
      getCostCutoff: () => cutoff,
    });
    const witness = buildFoodCandidate([at(MANA, 50), at(HEALTH, 20)]);
    cache.record(witness, {
      pruned: 'cost',
      feasible: null,
      rejected: '',
      ranOutOfMana: false,
      costLowerBound: 160,
      roundsCompleted: 1,
      samples: [
        {
          seed: 1,
          ranOutOfMana: false,
          stoppedEarly: false,
          pruned: 'cost',
          costLowerBound: 160,
          foodUsed: { mana: 2, health: 0 },
          inactiveFoodThresholds: { hp: 20, mp: 61 },
        },
      ],
      equivalentThresholds: [
        { hrid: 'mana', kind: 'mp', min: 45, max: 60 },
        { hrid: 'health', kind: 'hp', min: 15, max: 25 },
      ],
      inactiveFoodThresholds: { hp: 20, mp: 61 },
    });
    const candidate = buildFoodCandidate([at(MANA, 50), at(SCRATCH, 80)]);
    expect(cache.match(candidate)?.result).toMatchObject({ pruned: 'cost', costLowerBound: 160 });
    // A stronger ranking only removes pruning evidence; it never admits a
    // candidate the recorded bound cannot beat.
    cutoff = 170;
    expect(cache.match(candidate)).toBeNull();
    cutoff = 100;
    expect(cache.match(candidate)?.result).toMatchObject({ pruned: 'cost' });
  });

  it('scales the consumed-core capacity with the search space', () => {
    const tiers = [0, 2048, 65536, 524288, 5_000_000].map((total) => selectFoodOptimizerConsumedCoreCapacity(total));
    for (let index = 1; index < tiers.length; index += 1) {
      expect(tiers[index].maxFailureCoreEntries).toBeGreaterThanOrEqual(tiers[index - 1].maxFailureCoreEntries);
      expect(tiers[index].maxFeasibleCoreEntries).toBeGreaterThanOrEqual(tiers[index - 1].maxFeasibleCoreEntries);
    }
    expect(selectFoodOptimizerConsumedCoreCapacity(Number.NaN)).toEqual(tiers[0]);
    expect(selectFoodOptimizerConsumedCoreCapacity(-1)).toEqual(tiers[0]);
  });
});

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

  it.each([
    ['missing restore', (candidate) => delete candidate.slots[0].restore],
    ['invalid kind', (candidate) => (candidate.slots[0].kind = 'other')],
    ['wrong condition', (candidate) => (candidate.triggerMap[candidate.food[0]][0].conditionHrid = 'missing_hp')],
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

  it.each([
    ['absent ranges', (sample) => (sample.equivalentThresholds = null)],
    ['invalid range bound', (sample) => (sample.equivalentThresholds[0].max = Infinity)],
    ['nonpositive inactive bound', (sample) => (sample.inactiveFoodThresholds.hp = 0)],
    ['early stop', (sample) => (sample.stoppedEarly = true)],
    ['mana failure', (sample) => (sample.ranOutOfMana = true)],
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

    expect(cache.match(1, candidateAt(75))).toBe(sample);
    expect(cache.match(1, withExtra(candidateAt(75)))).toMatchObject({
      inactiveFoodThresholds: sample.inactiveFoodThresholds,
      foodUsed: { core: 3, extra: 0 },
    });
  });
});

import { describe, expect, it } from 'vitest';
import { buildFoodCandidate } from '../foodOptimizerDomain.js';
import {
  createFoodOptimizerPruningCache,
  materializeFoodOptimizerOutcome,
  selectFoodOptimizerConsumedCoreCapacity,
} from '../foodOptimizerPruning.js';

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

describe('consumed-core cross-composition reuse', () => {
  it('stays disabled by default so only explicit capacities change behavior', () => {
    const cache = createFoodOptimizerPruningCache({ rounds: 1 });
    const witness = buildFoodCandidate([at(MANA, 50), at(HEALTH, 20)]);
    cache.record(witness, manaWitness(witness, { mana: 2 }, { hp: 20, mp: 61 }, {}));
    expect(cache.match(buildFoodCandidate([at(MANA, 50), at(SCRATCH, 80)]))).toBeNull();
    expect(cache.coreMetrics).toMatchObject({ probes: 0, hits: 0, records: 0 });
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
    expect(cache.coreMetrics.records).toBe(1);

    // Sorted order: mana (mp) first, then the HP foods by descending threshold.
    const covered = buildFoodCandidate([at(MANA, 50), at(SCRATCH, 80), at(HEALTH, 20)]);
    expect(cache.match(covered)?.result).toMatchObject({ rejected: 'mana', feasible: false });
    // The added food may also sort before a single-food core: it never fires.
    expect(cache.match(buildFoodCandidate([at(OTHER, 80), at(MANA, 50)]))?.result).toMatchObject({
      rejected: 'mana',
    });
    expect(cache.coreMetrics.hits).toBe(2);
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
    for (const entry of outcome.samples) {
      expect(entry.foodUsed).toEqual({ mana: 2, scratch: 0, health: 1 });
      expect(entry.equivalentThresholds[1]).toEqual({ hrid: 'scratch', kind: 'hp', min: 30, max: MAX_THRESHOLD });
      expect(entry.deaths).toBe(0);
    }
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

  it('bounds retained cores and evicts without unbounded growth', () => {
    const cache = createFoodOptimizerPruningCache({
      rounds: 1,
      maxFailureCoreEntries: 2,
      maxCoreGroupEntries: 1,
    });
    for (const [core, threshold] of [
      [MANA, 50],
      [OTHER, 30],
      [THIRD, 40],
    ]) {
      const candidate = buildFoodCandidate([at(core, threshold), at(HEALTH, 20)]);
      cache.record(candidate, manaWitness(candidate, { [core.hrid]: 1 }, { hp: 20, mp: threshold + 11 }, {}));
    }
    expect(cache.coreMetrics.failureEntries).toBeLessThanOrEqual(2);
    expect(cache.coreMetrics.groups).toBeLessThanOrEqual(2);
    expect(cache.coreMetrics.evictions).toBeGreaterThan(0);
    cache.clear();
    expect(cache.coreMetrics).toMatchObject({ failureEntries: 0, feasibleEntries: 0, groups: 0 });
  });

  it('never registers three consumed foods or uncertified results', () => {
    const cache = createFoodOptimizerPruningCache({ rounds: 1, ...failureCapacity });
    const trio = buildFoodCandidate([at(MANA, 50), at(HEALTH, 20), at(SCRATCH, 80)]);
    cache.record(trio, {
      ...manaWitness(trio, { mana: 1, health: 1, scratch: 1 }, { hp: 20, mp: 61 }, {}),
    });
    // A ranking rejection proves nothing about the physical outcome.
    const ranked = buildFoodCandidate([at(MANA, 50)]);
    cache.record(ranked, {
      pruned: 'rank',
      feasible: null,
      rejected: '',
      roundsCompleted: 1,
      samples: [{ seed: 1, ranOutOfMana: false, stoppedEarly: false }],
      equivalentThresholds: [{ hrid: 'mana', kind: 'mp', min: 1, max: 100 }],
    });
    expect(cache.coreMetrics.records).toBe(0);
  });

  it('scales the consumed-core capacity with the search space', () => {
    const tiers = [0, 2048, 65536, 524288, 5_000_000].map((total) => selectFoodOptimizerConsumedCoreCapacity(total));
    for (const tier of tiers)
      expect(tier).toMatchObject({
        maxFailureCoreEntries: expect.any(Number),
        maxFeasibleCoreEntries: expect.any(Number),
        maxCoreGroupEntries: expect.any(Number),
      });
    for (let index = 1; index < tiers.length; index += 1) {
      expect(tiers[index].maxFailureCoreEntries).toBeGreaterThanOrEqual(tiers[index - 1].maxFailureCoreEntries);
      expect(tiers[index].maxFeasibleCoreEntries).toBeGreaterThanOrEqual(tiers[index - 1].maxFeasibleCoreEntries);
    }
    expect(selectFoodOptimizerConsumedCoreCapacity(Number.NaN)).toEqual(tiers[0]);
    expect(selectFoodOptimizerConsumedCoreCapacity(-1)).toEqual(tiers[0]);
  });
});

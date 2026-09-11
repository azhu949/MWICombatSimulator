import { describe, expect, it, vi } from 'vitest';
import { buildFoodCandidate } from '../foodOptimizerDomain.js';
import { tryEvaluateFoodOptimizerCachedCandidate } from '../foodOptimizerEvaluation.js';
import { evaluateFoodOptimizerCandidate } from '../foodOptimizerSimulation.js';

const TIME_LIMIT = 600e9;
const HRID = '/items/gummy';
const candidateAt = (threshold = 50) =>
  buildFoodCandidate([{ hrid: HRID, kind: 'mp', threshold, restore: 40, price: 10 }]);
const requestFor = (rounds = 3) => ({
  rounds,
  seeds: Array.from({ length: rounds }, (_, index) => index + 1),
  payload: { simulationTimeLimit: TIME_LIMIT },
});
const range = (min, max) => [{ hrid: HRID, kind: 'mp', min, max }];
const completed = (seed, overrides = {}) => ({
  seed,
  deaths: 0,
  ranOutOfMana: false,
  stoppedEarly: false,
  simulatedTime: TIME_LIMIT,
  foodUsed: { [HRID]: 2 },
  costPerHour: 120,
  equivalentThresholds: range(1, 100),
  unusedFoodThresholds: null,
  inactiveFoodThresholds: { hp: 21, mp: 31 },
  ...overrides,
});
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

describe('synchronous food optimizer cached evaluation', () => {
  it('returns a complete result with original sample identities and intersected certificates', () => {
    const request = freeze(requestFor());
    const candidate = freeze(candidateAt());
    const samples = freeze([
      completed(1, {
        deaths: 1,
        foodUsed: { [HRID]: 1 },
        costPerHour: 10,
        equivalentThresholds: range(20, 80),
        inactiveFoodThresholds: { hp: 21, mp: 61 },
      }),
      completed(2, {
        deaths: 2,
        foodUsed: { [HRID]: 2 },
        costPerHour: 20,
        equivalentThresholds: range(40, 90),
        inactiveFoodThresholds: { hp: 51, mp: 31 },
      }),
      completed(3, {
        foodUsed: { [HRID]: 6 },
        costPerHour: 30,
        equivalentThresholds: range(30, 70),
        inactiveFoodThresholds: { hp: 41, mp: 51 },
      }),
    ]);
    const before = structuredClone({ request, candidate, samples });
    const result = tryEvaluateFoodOptimizerCachedCandidate(request, candidate, 3, samples);

    expect(result).toEqual({
      samples,
      roundsCompleted: 3,
      simulatedRounds: 0,
      reusedRounds: 3,
      deaths: 3,
      ranOutOfMana: false,
      rejected: '',
      equivalentThresholds: range(40, 70),
      unusedFoodThresholds: null,
      inactiveFoodThresholds: { hp: 51, mp: 61 },
      feasible: true,
      foodUsed: { [HRID]: 3 },
      costPerHour: 20,
    });
    expect(result).not.toBeInstanceOf(Promise);
    samples.forEach((sample, index) => expect(result.samples[index]).toBe(sample));
    expect({ request, candidate, samples }).toEqual(before);
  });

  it('accepts only the death-failure prefix after validating the complete supplied rounds', () => {
    const samples = freeze([
      completed(1, { deaths: 1, costPerHour: 10, equivalentThresholds: range(20, 80) }),
      completed(2, { deaths: 2, costPerHour: 20, equivalentThresholds: range(40, 90) }),
      completed(3, { deaths: 100, costPerHour: 999, equivalentThresholds: range(50, 50) }),
    ]);
    const result = tryEvaluateFoodOptimizerCachedCandidate(requestFor(), candidateAt(), 2, samples);

    expect(result).toMatchObject({
      feasible: false,
      rejected: 'deaths',
      deaths: 3,
      roundsCompleted: 2,
      simulatedRounds: 0,
      reusedRounds: 2,
      costPerHour: 15,
      foodUsed: { [HRID]: 2 },
      equivalentThresholds: range(40, 80),
    });
    expect(result.samples).toEqual(samples.slice(0, 2));
    expect(result.samples[0]).toBe(samples[0]);
    expect(result.samples[1]).toBe(samples[1]);
  });

  it.each([
    ['a sparse trailing round', (samples) => delete samples[2]],
    ['wrong trailing seed', (samples) => (samples[2].seed = 2)],
    ['early-stop trailing round', (samples) => (samples[2].stoppedEarly = true)],
    ['missing trailing certificate', (samples) => (samples[2].equivalentThresholds = null)],
    ['invalid inactive certificate', (samples) => (samples[2].inactiveFoodThresholds.hp = 0)],
  ])('returns null for %s even when the first round would exceed the death budget', (label, invalidate) => {
    const samples = [completed(1, { deaths: 1 }), completed(2), completed(3)];
    invalidate(samples);
    expect(tryEvaluateFoodOptimizerCachedCandidate(requestFor(), candidateAt(), 0, samples)).toBeNull();
  });

  it.each([
    ['zero rounds', (request) => (request.rounds = 0)],
    ['missing seed array', (request) => delete request.seeds],
    ['a short seed array', (request) => request.seeds.pop()],
    ['missing time limit', (request) => delete request.payload.simulationTimeLimit],
  ])('returns null for %s', (label, invalidate) => {
    const request = requestFor();
    invalidate(request);
    expect(
      tryEvaluateFoodOptimizerCachedCandidate(request, candidateAt(), 0, [completed(1), completed(2), completed(3)]),
    ).toBeNull();
  });

  it('requires candidate trigger rules and an aligned sample array', () => {
    const request = requestFor(1);
    const candidate = candidateAt();
    for (const samples of [undefined, {}])
      expect(tryEvaluateFoodOptimizerCachedCandidate(request, candidate, 0, samples)).toBeNull();
    candidate.triggerMap[HRID][0].value = 75;
    expect(tryEvaluateFoodOptimizerCachedCandidate(request, candidate, 0, [completed(1)])).toBeNull();
  });

  it('handles no-food candidates and keeps the empty baseline exempt from candidate death rejection', () => {
    const request = {
      ...requestFor(2),
      activePlayerId: '1',
      payload: { simulationTimeLimit: TIME_LIMIT, players: [{ hrid: 'player1', food: [null, null, null] }] },
    };
    const samples = freeze(
      [1, 2].map((seed) =>
        completed(seed, {
          deaths: 1,
          costPerHour: 0,
          foodUsed: {},
          equivalentThresholds: [],
          unusedFoodThresholds: { hp: seed * 10, mp: 30 - seed * 10 },
        }),
      ),
    );
    const baseline = tryEvaluateFoodOptimizerCachedCandidate(request, null, 0, samples);
    const candidate = tryEvaluateFoodOptimizerCachedCandidate(request, buildFoodCandidate([]), 0, samples);

    expect(baseline).toMatchObject({
      feasible: true,
      deaths: 2,
      reusedRounds: 2,
      foodUsed: {},
      costPerHour: 0,
      unusedFoodThresholds: { hp: 20, mp: 20 },
    });
    expect(candidate).toMatchObject({ feasible: false, rejected: 'deaths', deaths: 1, reusedRounds: 1 });
    request.payload.players[0].food[0] = { hrid: HRID };
    expect(tryEvaluateFoodOptimizerCachedCandidate(request, null, 0, samples)).toBeNull();
  });
});

describe('shared accumulation during simulated food evaluation', () => {
  it.each([
    ['mana', false],
    ['deaths', false],
    ['deaths', true],
  ])(
    'marks terminal %s progress while keeping successful progress unchanged (cached failure: %s)',
    async (rejected, cachedFailure) => {
      const candidate = candidateAt();
      const successful = completed(1);
      const failure = completed(2, {
        deaths: 1,
        ranOutOfMana: rejected === 'mana',
        stoppedEarly: !cachedFailure,
        simulatedTime: cachedFailure ? TIME_LIMIT : 30e9,
      });
      const progress = vi.fn();
      const simulate = vi.fn().mockResolvedValue(failure);
      const result = await evaluateFoodOptimizerCandidate(requestFor(), candidate, 0, progress, simulate, {
        reusableSamples: [successful, cachedFailure ? failure : null, null],
      });

      expect(result).toMatchObject({ rejected, roundsCompleted: 2, feasible: false });
      expect(progress.mock.calls.at(-1)[0]).toMatchObject({ round: 2, rejected });
      expect(simulate).toHaveBeenCalledTimes(cachedFailure ? 0 : 1);
    },
  );

  it('keeps mixed cached/simulated progress, death budgets and recording in the original order', async () => {
    const request = requestFor();
    const candidate = candidateAt();
    const samples = [1, 2, 3].map((seed) => completed(seed, { deaths: 1, costPerHour: seed * 10 }));
    const calls = [];
    const progress = (event) => calls.push({ progress: event });
    const simulate = vi.fn(async (input, current, seed, onProgress, deathLimit) => {
      calls.push({ simulatedSeed: seed, deathLimit });
      onProgress(0.5);
      return samples[seed - 1];
    });
    const roundCache = {
      match: () => null,
      record: (seed, current, sample) => calls.push({ recordedSeed: seed, sample }),
    };
    const result = await evaluateFoodOptimizerCandidate(request, candidate, 3, progress, simulate, {
      reusableSamples: [samples[0], null, samples[2]],
      roundCache,
    });
    const cached = tryEvaluateFoodOptimizerCachedCandidate(request, candidate, 3, samples);

    expect(result).toEqual({ ...cached, simulatedRounds: 1, reusedRounds: 2 });
    expect(calls).toContainEqual({ simulatedSeed: 2, deathLimit: 2 });
    expect(calls).toContainEqual({ recordedSeed: 2, sample: samples[1] });
    samples.forEach((sample, index) => expect(result.samples[index]).toBe(sample));
    expect(simulate).toHaveBeenCalledOnce();
  });

  it('keeps a mana-failing seed certificate independent while retaining aggregate inactive bounds', async () => {
    const samples = [
      completed(1, {
        equivalentThresholds: range(45, 55),
        unusedFoodThresholds: { hp: 91, mp: 81 },
        inactiveFoodThresholds: { hp: 91, mp: 81 },
      }),
      completed(2, {
        deaths: 3,
        stoppedEarly: true,
        ranOutOfMana: true,
        simulatedTime: 30e9,
        equivalentThresholds: range(10, 90),
        unusedFoodThresholds: { hp: 11, mp: 21 },
        inactiveFoodThresholds: { hp: 11, mp: 21 },
      }),
    ];
    const simulate = vi.fn(async (request, candidate, seed) => samples[seed - 1]);
    const result = await evaluateFoodOptimizerCandidate(requestFor(), candidateAt(), 0, undefined, simulate, {
      collectThresholds: false,
    });

    expect(result).toMatchObject({
      feasible: false,
      rejected: 'mana',
      deaths: 3,
      roundsCompleted: 2,
      simulatedRounds: 2,
      reusedRounds: 0,
      equivalentThresholds: range(10, 90),
      unusedFoodThresholds: { hp: 11, mp: 21 },
      inactiveFoodThresholds: { hp: 91, mp: 81 },
    });
    expect(simulate).toHaveBeenCalledTimes(2);
  });
});

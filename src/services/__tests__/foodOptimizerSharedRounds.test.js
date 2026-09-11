import { describe, expect, it, vi } from 'vitest';
import { buildFoodCandidate } from '../foodOptimizerDomain.js';
import { createFoodOptimizerRoundCache } from '../foodOptimizerRoundCache.js';
import { createFoodOptimizerEvaluator, evaluateFoodOptimizerCandidate } from '../foodOptimizerSimulation.js';
import {
  createFoodOptimizerFixture,
  physicalFoodOptimizerResult,
  referenceFoodOptimizerRound,
} from './support/foodOptimizerTestSupport.js';

const TIME_LIMIT = 600e9;
const food = (hrid = '/items/gummy', threshold = 50, restore = 40) => ({
  hrid,
  kind: 'mp',
  threshold,
  restore,
  price: 10,
});
const candidateAt = (threshold = 50) => buildFoodCandidate([food('/items/gummy', threshold)]);
const requestFor = (rounds = 1) => ({
  rounds,
  seeds: Array.from({ length: rounds }, (_, index) => index + 1),
  payload: { simulationTimeLimit: TIME_LIMIT },
});
const completed = (candidate, seed = 1, overrides = {}) => ({
  seed,
  deaths: 0,
  ranOutOfMana: false,
  stoppedEarly: false,
  simulatedTime: TIME_LIMIT,
  foodUsed: Object.fromEntries(candidate.food.map((hrid) => [hrid, 2])),
  costPerHour: candidate.slots.length ? 120 : 0,
  equivalentThresholds: candidate.slots.map(({ hrid, kind }) => ({ hrid, kind, min: 1, max: 100 })),
  unusedFoodThresholds: candidate.slots.length ? null : { hp: 26, mp: 51 },
  ...overrides,
});
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

describe('food optimizer shared round execution', () => {
  it("reuses another evaluator's complete samples without changing physical results or inputs", async () => {
    const { request, items } = createFoodOptimizerFixture({ foodSlots: 1, rounds: 2 });
    const yogurt = items.find((item) => item.hrid === '/items/star_fruit_yogurt');
    const sourceCandidate = buildFoodCandidate([{ ...yogurt, threshold: 1 }]);
    const source = await createFoodOptimizerEvaluator(request, { sharedRounds: true, items })(
      sourceCandidate,
      Infinity,
    );
    const target = freeze(buildFoodCandidate([{ ...yogurt, threshold: 2 }]));
    expect(source.samples.every((sample) => sample.equivalentThresholds[0].max >= 2)).toBe(true);
    const shared = freeze(structuredClone(source.samples));
    const before = structuredClone(shared);
    const receiver = createFoodOptimizerEvaluator(structuredClone(request), { sharedRounds: true, items });
    const result = await receiver(target, Infinity, undefined, shared);
    const reference = await evaluateFoodOptimizerCandidate(
      request,
      target,
      Infinity,
      undefined,
      referenceFoodOptimizerRound,
    );

    expect(result).toMatchObject({ feasible: true, simulatedRounds: 0, reusedRounds: 2 });
    expect(physicalFoodOptimizerResult(result)).toEqual(physicalFoodOptimizerResult(reference));
    expect(shared).toEqual(before);
    expect(result.samples[0]).toBe(shared[0]);
    expect(result.samples[1]).toBe(shared[1]);
  });

  it('keeps standalone caches but retains no duplicate worker cache in shared mode', async () => {
    const { request, items } = createFoodOptimizerFixture({ foodSlots: 1, rounds: 1 });
    const yogurt = items.find((item) => item.hrid === '/items/star_fruit_yogurt');
    const grid = [{ ...yogurt, thresholds: [2, 1] }];
    const candidate = buildFoodCandidate([{ ...yogurt, threshold: 1 }]);
    const equivalent = buildFoodCandidate([{ ...yogurt, threshold: 2 }]);
    const shared = createFoodOptimizerEvaluator(request, { sharedRounds: true, items: grid });
    const local = createFoodOptimizerEvaluator(request, { items: grid });

    expect(await shared(candidate, Infinity)).toMatchObject({ simulatedRounds: 1, reusedRounds: 0 });
    expect(await shared(equivalent, Infinity)).toMatchObject({ simulatedRounds: 1, reusedRounds: 0 });
    expect(await local(candidate, Infinity)).toMatchObject({ simulatedRounds: 1, reusedRounds: 0 });
    expect(await local(equivalent, Infinity)).toMatchObject({ simulatedRounds: 0, reusedRounds: 1 });
    expect(await createFoodOptimizerEvaluator(request, { items: grid })(equivalent, Infinity)).toMatchObject({
      simulatedRounds: 1,
      reusedRounds: 0,
    });
  });

  it('combines aligned shared rounds with simulated gaps and reports each kind once', async () => {
    const candidate = candidateAt();
    const samples = [10, 20, 30].map((costPerHour, index) => completed(candidate, index + 1, { costPerHour }));
    const simulate = vi.fn().mockResolvedValue(samples[1]);
    const progress = vi.fn();
    const reusableSamples = freeze([samples[0], null, samples[2]]);
    const result = await evaluateFoodOptimizerCandidate(requestFor(3), candidate, 0, progress, simulate, {
      reusableSamples,
    });

    expect(result).toMatchObject({ feasible: true, simulatedRounds: 1, reusedRounds: 2, costPerHour: 20 });
    expect(result.samples).toEqual(samples);
    expect(simulate.mock.calls.map((call) => call[2])).toEqual([2]);
    expect(progress).toHaveBeenLastCalledWith({ round: 3, progress: 0, simulatedRounds: 1, reusedRounds: 2 });
  });

  const invalidSamples = [
    ['different seed', { seed: 2 }],
    ['missing seed', { seed: undefined }],
    ['shorter completed duration', { simulatedTime: TIME_LIMIT - 1 }],
    ['longer completed duration', { simulatedTime: TIME_LIMIT + 1 }],
    ['partial prefix', { stoppedEarly: true }],
    ['missing completion marker', { stoppedEarly: undefined }],
    ['mana failure', { ranOutOfMana: true }],
    ['negative deaths', { deaths: -1 }],
    ['fractional deaths', { deaths: 0.5 }],
    ['nonfinite deaths', { deaths: Infinity }],
    ['negative cost', { costPerHour: -1 }],
    ['nonfinite cost', { costPerHour: NaN }],
    ['different food identity', { foodUsed: { '/items/donut': 2 } }],
    ['missing food count', { foodUsed: {} }],
    ['additional food count', { foodUsed: { '/items/gummy': 2, '/items/donut': 0 } }],
    ['negative food count', { foodUsed: { '/items/gummy': -1 } }],
    ['averaged food count', { foodUsed: { '/items/gummy': 0.5 } }],
    ['nonfinite food count', { foodUsed: { '/items/gummy': NaN } }],
    ['missing threshold certificate', { equivalentThresholds: null }],
    [
      'threshold outside certificate',
      { equivalentThresholds: [{ hrid: '/items/gummy', kind: 'mp', min: 51, max: 100 }] },
    ],
    ['different resource kind', { equivalentThresholds: [{ hrid: '/items/gummy', kind: 'hp', min: 1, max: 100 }] }],
    ['invalid threshold range', { equivalentThresholds: [{ hrid: '/items/gummy', kind: 'mp', min: NaN, max: 100 }] }],
  ];
  it.each(invalidSamples)('simulates again for %s', async (reason, overrides) => {
    const candidate = candidateAt();
    const supplied = completed(candidate, 1, overrides);
    const fallback = completed(candidate, 1, { costPerHour: 240 });
    const simulate = vi.fn().mockResolvedValue(fallback);
    const result = await evaluateFoodOptimizerCandidate(requestFor(), candidate, 0, undefined, simulate, {
      reusableSamples: [supplied],
    });

    expect(simulate).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ feasible: true, simulatedRounds: 1, reusedRounds: 0 });
    expect(result.samples[0]).toBe(fallback);
  });

  it('rejects reversed slot order and trigger rules inconsistent with the certificate', async () => {
    const observed = buildFoodCandidate([food('first', 70, 20), food('second', 30, 40)]);
    const sample = completed(observed);
    const reversed = buildFoodCandidate([food('first', 30, 20), food('second', 70, 40)]);
    const tied = buildFoodCandidate([food('first', 50, 20), food('second', 50, 40)]);
    const changedTrigger = structuredClone(observed);
    changedTrigger.triggerMap.first[0].comparatorHrid = '/combat_trigger_comparators/less_than_equal';
    for (const candidate of [reversed, tied, changedTrigger]) {
      const simulate = vi.fn().mockResolvedValue(completed(candidate));
      const result = await evaluateFoodOptimizerCandidate(requestFor(), candidate, 0, undefined, simulate, {
        reusableSamples: [sample],
      });
      expect(simulate).toHaveBeenCalledOnce();
      expect(result).toMatchObject({ simulatedRounds: 1, reusedRounds: 0 });
    }
  });

  it('does not treat a reordered sample array as aligned request rounds', async () => {
    const candidate = candidateAt();
    const simulate = vi.fn(async (request, current, seed) => completed(current, seed));
    const result = await evaluateFoodOptimizerCandidate(requestFor(2), candidate, 0, undefined, simulate, {
      reusableSamples: [completed(candidate, 2), completed(candidate, 1)],
    });

    expect(result).toMatchObject({ simulatedRounds: 2, reusedRounds: 0 });
    expect(simulate.mock.calls.map((call) => call[2])).toEqual([1, 2]);
  });

  it('reuses a completed round before failure but reruns the failing prefix and stops at its result', async () => {
    const candidate = candidateAt();
    const successful = completed(candidate);
    const failure = completed(candidate, 2, { stoppedEarly: true, ranOutOfMana: true, simulatedTime: 30e9 });
    const simulate = vi.fn().mockResolvedValue(failure);
    const supplied = freeze([successful, failure, completed(candidate, 3)]);
    const result = await evaluateFoodOptimizerCandidate(requestFor(3), candidate, 0, undefined, simulate, {
      reusableSamples: supplied,
    });

    expect(result).toMatchObject({
      feasible: false,
      rejected: 'mana',
      roundsCompleted: 2,
      simulatedRounds: 1,
      reusedRounds: 1,
    });
    expect(result.samples[0]).toBe(successful);
    expect(simulate.mock.calls.map((call) => call[2])).toEqual([2]);
  });

  it('applies the cumulative death budget to shared rounds before accepting later samples', async () => {
    const candidate = candidateAt();
    const supplied = freeze([1, 2, 0].map((deaths, index) => completed(candidate, index + 1, { deaths })));
    const simulate = vi.fn();
    const result = await evaluateFoodOptimizerCandidate(requestFor(3), candidate, 2, undefined, simulate, {
      reusableSamples: supplied,
    });

    expect(simulate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      feasible: false,
      rejected: 'deaths',
      deaths: 3,
      roundsCompleted: 2,
      simulatedRounds: 0,
      reusedRounds: 2,
    });
    expect(result.samples).toEqual(supplied.slice(0, 2));
  });

  it('accepts coordinator-materialized no-food evidence and preserves its source', async () => {
    const cache = createFoodOptimizerRoundCache();
    const empty = buildFoodCandidate([]);
    const source = freeze(completed(empty));
    cache.record(1, empty, source);
    const candidate = candidateAt(75);
    const supplied = freeze(cache.match(1, candidate));
    const simulate = vi.fn();
    const result = await evaluateFoodOptimizerCandidate(requestFor(), candidate, 0, undefined, simulate, {
      reusableSamples: [supplied],
    });

    expect(simulate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ simulatedRounds: 0, reusedRounds: 1, costPerHour: 0 });
    expect(result.foodUsed).toEqual({ '/items/gummy': 0 });
    expect(source.foodUsed).toEqual({});
    expect(source.unusedFoodThresholds).toEqual({ hp: 26, mp: 51 });
  });

  it('falls back to a local certificate when a supplied sample is invalid', async () => {
    const cache = createFoodOptimizerRoundCache();
    const candidate = candidateAt();
    const local = completed(candidate);
    cache.record(1, candidate, local);
    const simulate = vi.fn();
    const result = await evaluateFoodOptimizerCandidate(requestFor(), candidateAt(75), 0, undefined, simulate, {
      roundCache: cache,
      reusableSamples: [completed(candidate, 2)],
    });

    expect(simulate).not.toHaveBeenCalled();
    expect(result.samples[0]).toBe(local);
    expect(result).toMatchObject({ simulatedRounds: 0, reusedRounds: 1 });
  });

  it('normalizes equivalent seed representations without mutating the shared input', async () => {
    const candidate = candidateAt();
    const shared = freeze(completed(candidate, 0x100000001));
    const simulate = vi.fn();
    const result = await evaluateFoodOptimizerCandidate(requestFor(), candidate, 0, undefined, simulate, {
      reusableSamples: [shared],
    });

    expect(simulate).not.toHaveBeenCalled();
    expect(result.samples[0]).toEqual({ ...shared, seed: 1 });
    expect(shared.seed).toBe(0x100000001);
  });

  it('ignores supplied samples when reuse is disabled', async () => {
    const candidate = candidateAt();
    const sample = completed(candidate);
    const simulate = vi.fn().mockResolvedValue(sample);
    const result = await evaluateFoodOptimizerCandidate(requestFor(), candidate, 0, undefined, simulate, {
      collectThresholds: false,
      reusableSamples: [sample],
    });

    expect(simulate).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ simulatedRounds: 1, reusedRounds: 0 });
  });

  it('forwards shared worker inputs and binds a fresh evaluator on initialization', async () => {
    const { request, items } = createFoodOptimizerFixture({ foodSlots: 1, rounds: 1, seconds: 60 });
    const yogurt = items.find((item) => item.hrid === '/items/star_fruit_yogurt');
    const candidate = buildFoodCandidate([{ ...yogurt, threshold: 1 }]);
    const context = { postMessage: vi.fn() };
    vi.stubGlobal('self', context);
    try {
      await import('../../foodOptimizerWorker.js');
      const send = async (data) => {
        context.postMessage.mockClear();
        await context.onmessage({ data });
        const messages = context.postMessage.mock.calls.map(([message]) => message);
        expect(messages.at(-1).type).toBe('result');
        return messages.at(-1).result;
      };
      await send({ type: 'init', request, items, sharedRounds: true });
      const first = await send({ type: 'evaluate', candidate, baselineDeaths: Infinity });
      expect(first).toMatchObject({ simulatedRounds: 1, reusedRounds: 0 });
      const reused = await send({
        type: 'evaluate',
        candidate,
        baselineDeaths: Infinity,
        reusableSamples: first.samples,
      });
      expect(reused).toMatchObject({ simulatedRounds: 0, reusedRounds: 1 });
      expect(await send({ type: 'evaluate', candidate, baselineDeaths: Infinity })).toMatchObject({
        simulatedRounds: 1,
        reusedRounds: 0,
      });

      const changed = { ...request, payload: { ...request.payload, simulationTimeLimit: 120e9 } };
      await send({ type: 'init', request: changed, items, sharedRounds: true });
      const refreshed = await send({
        type: 'evaluate',
        candidate,
        baselineDeaths: Infinity,
        reusableSamples: first.samples,
      });
      expect(refreshed).toMatchObject({ simulatedRounds: 1, reusedRounds: 0 });
      expect(refreshed.samples[0].simulatedTime).toBe(changed.payload.simulationTimeLimit);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  buildFoodCandidate,
  compareFoodOptimizerResults,
  generateFoodOptimizerCandidates,
} from '../foodOptimizerDomain.js';
import { createFoodOptimizerRoundCache } from '../foodOptimizerRoundCache.js';
import { createFoodOptimizerSearch } from '../foodOptimizerSearch.js';
import { createFoodOptimizerEvaluator, evaluateFoodOptimizerCandidate } from '../foodOptimizerSimulation.js';
import { createFoodOptimizerFixture, physicalFoodOptimizerResult } from './support/foodOptimizerTestSupport.js';

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

const item = (hrid) => ({ hrid, kind: 'mp', restore: 50, price: 1, thresholds: [100, 50, 20] });

// Seed 1 has an identical path throughout a composition's grid. Seed 2 is
// different at every point, so whole-candidate reuse cannot substitute for
// sharing the first seed between workers.
function sampleFor(request, candidate, seed, producer = -1) {
  const foodUsed = Object.fromEntries(
    (candidate?.slots || []).map((slot) => [slot.hrid, seed === 1 ? 1 : slot.threshold / 10]),
  );
  return {
    seed,
    producer,
    context: request.inputSignature,
    deaths: 0,
    ranOutOfMana: false,
    stoppedEarly: false,
    simulatedTime: request.payload.simulationTimeLimit,
    foodUsed,
    costPerHour: candidate ? Object.values(foodUsed).reduce((sum, count) => sum + count, 0) * request.priceScale : 999,
    equivalentThresholds:
      candidate?.slots.map(({ hrid, kind, threshold }) => ({
        hrid,
        kind,
        min: seed === 1 ? 1 : threshold,
        max: seed === 1 ? 100 : threshold,
      })) ?? null,
    unusedFoodThresholds: null,
  };
}

async function run({
  items = [item('a')],
  workerLimit = 3,
  reuse = true,
  inputSignature = 'first',
  priceScale = 1,
} = {}) {
  const request = {
    activePlayerId: '1',
    rounds: 2,
    seeds: [1, 2],
    inputSignature,
    priceScale,
    payload: { players: [{ hrid: 'player1', food: [{ hrid: 'original' }] }], simulationTimeLimit: 600e9 },
  };
  const clients = [];
  const transferred = [];
  const simulated = [];
  const updates = [];
  const covered = new Map();
  const report = await createFoodOptimizerSearch({
    request,
    items,
    foodSlots: 3,
    workerLimit,
    adaptiveWorkers: false,
    reuse,
    onUpdate(report, progress) {
      updates.push({ report, progress });
    },
    onCoverage({ candidate, result }) {
      expect(candidate).toBeDefined();
      expect(covered.has(candidate.signature)).toBe(false);
      covered.set(candidate.signature, physicalFoodOptimizerResult(result));
    },
    workerFactory() {
      const producer = clients.length;
      let init;
      let roundCache;
      const client = {
        stop: vi.fn(),
        async call(message, progress) {
          if (message.type === 'init') {
            init = message;
            roundCache =
              message.collectThresholds && !message.sharedRounds
                ? createFoodOptimizerRoundCache({ items: message.items })
                : null;
            return;
          }
          await Promise.resolve();
          for (const sample of message.reusableSamples || []) if (sample) transferred.push({ producer, sample });
          return evaluateFoodOptimizerCandidate(
            init.request,
            message.candidate,
            message.deathBudget,
            progress,
            async (request, candidate, seed) => {
              simulated.push({ producer, candidate, seed });
              return sampleFor(request, candidate, seed, producer);
            },
            { collectThresholds: init.collectThresholds, roundCache, reusableSamples: message.reusableSamples },
          );
        },
      };
      clients.push(client);
      return client;
    },
  }).done;
  const expected = [];
  for (const candidate of generateFoodOptimizerCandidates(items, 3)) {
    const result = await evaluateFoodOptimizerCandidate(
      request,
      candidate,
      0,
      undefined,
      async (request, candidate, seed) => sampleFor(request, candidate, seed),
    );
    expected.push({ ...candidate, ...result });
  }
  expect(report.status, report.error).toBe('completed');
  expect(report.complete).toBe(true);
  expect(covered).toEqual(
    new Map(expected.map((candidate) => [candidate.signature, physicalFoodOptimizerResult(candidate)])),
  );
  expect(report.stats.completedCandidates).toBe(expected.length);
  expect(report.stats.feasibleCandidates).toBe(expected.length);
  expect(report.stats.simulatedCandidates + report.stats.reusedCandidates + report.stats.skippedCandidates).toBe(
    expected.length,
  );
  expect(report.stats.completedRounds).toBe(simulated.length);
  expect(report.stats.completedRounds + report.stats.reusedRounds).toBe((expected.length + 1) * request.rounds);
  const ranked = (candidate) => ({ signature: candidate.signature, result: physicalFoodOptimizerResult(candidate) });
  expect(report.topResults.map(ranked)).toEqual(expected.sort(compareFoodOptimizerResults).slice(0, 10).map(ranked));
  expect(clients.every((client) => client.stop.mock.calls.length)).toBe(true);
  return { report, clients, transferred, simulated, updates };
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
    // 切片 21B：JS 引擎已删除——参照改为一个全新 evaluator（独立缓存）真跑同一候选，
    // wasm 确定性下复用轮次与重算轮次的物理结果必须逐字段一致。
    const reference = await evaluateFoodOptimizerCandidate(request, target, Infinity);

    expect(result).toMatchObject({ feasible: true, simulatedRounds: 0, reusedRounds: 2 });
    expect(physicalFoodOptimizerResult(result)).toEqual(physicalFoodOptimizerResult(reference));
    expect(shared).toEqual(before);
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
  });

  const invalidSamples = [
    ['different seed', { seed: 2 }],
    ['shorter completed duration', { simulatedTime: TIME_LIMIT - 1 }],
    ['partial prefix', { stoppedEarly: true }],
    ['different food identity', { foodUsed: { '/items/donut': 2 } }],
    ['missing threshold certificate', { equivalentThresholds: null }],
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
      const first = await send({ type: 'evaluate', candidate, deathBudget: Infinity });
      expect(first).toMatchObject({ simulatedRounds: 1, reusedRounds: 0 });
      const reused = await send({
        type: 'evaluate',
        candidate,
        deathBudget: Infinity,
        reusableSamples: first.samples,
      });
      expect(reused).toMatchObject({ simulatedRounds: 0, reusedRounds: 1 });
      expect(await send({ type: 'evaluate', candidate, deathBudget: Infinity })).toMatchObject({
        simulatedRounds: 1,
        reusedRounds: 0,
      });

      const changed = { ...request, payload: { ...request.payload, simulationTimeLimit: 120e9 } };
      await send({ type: 'init', request: changed, items, sharedRounds: true });
      const refreshed = await send({
        type: 'evaluate',
        candidate,
        deathBudget: Infinity,
        reusableSamples: first.samples,
      });
      expect(refreshed).toMatchObject({ simulatedRounds: 1, reusedRounds: 0 });
      expect(refreshed.samples[0].simulatedTime).toBe(changed.payload.simulationTimeLimit);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('shared food evidence and bounded composition windows', () => {
  it('shares complete rounds across worker identities while simulating every unmatched seed', async () => {
    const shared = await run();
    expect(shared.transferred.some(({ producer, sample }) => producer !== sample.producer)).toBe(true);
    expect(shared.report.stats.reusedRounds).toBeGreaterThan(0);
    const exhaustive = await run({ reuse: false });
    expect(exhaustive.transferred).toEqual([]);
    expect(exhaustive.report.stats.reusedRounds).toBe(0);
  });

  it('keeps the one-worker cache local without transferring duplicate samples', async () => {
    const local = await run({ workerLimit: 1 });
    expect(local.transferred).toEqual([]);
    expect(local.report.stats.reusedRounds).toBeGreaterThan(0);
  });

  it('does not carry shared evidence into a new request with different prices', async () => {
    await run();
    const second = await run({ inputSignature: 'second', priceScale: 10 });
    expect(second.transferred.length).toBeGreaterThan(0);
    expect(second.transferred.every(({ sample }) => sample.context === 'second')).toBe(true);
  });
});

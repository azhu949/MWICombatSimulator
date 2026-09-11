import { describe, expect, it, vi } from 'vitest';
import {
  compareFoodOptimizerResults,
  generateFoodOptimizerCandidates,
  generateFoodOptimizerCompositionCandidates,
} from '../foodOptimizerDomain.js';
import { createFoodOptimizerSearch } from '../foodOptimizerSearch.js';
import { evaluateFoodOptimizerCandidate } from '../foodOptimizerSimulation.js';
import { createFoodOptimizerRoundCache } from '../foodOptimizerRoundCache.js';
import { materializeFoodOptimizerOutcome } from '../foodOptimizerPruning.js';
import { physicalFoodOptimizerResult } from './support/foodOptimizerTestSupport.js';

const catalog = (count = 5, thresholds = [100, 90, 60, 30]) =>
  Array.from({ length: count }, (_, index) => ({
    hrid: `food-${count - index}`,
    kind: index % 2 ? 'hp' : 'mp',
    restore: 30,
    price: 1,
    thresholds,
  }));

async function run({
  items = catalog(),
  foodSlots = 3,
  workerLimit = 1,
  equipped = false,
  searchMode = 'top10',
  reuse = true,
  baselineDeaths = 6,
  emptyDeaths = 6,
  manaFailure = false,
  mutateSample,
  cancelAfter,
} = {}) {
  const request = {
    activePlayerId: '1',
    rounds: 2,
    seeds: [1, 2],
    searchMode,
    payload: {
      simulationTimeLimit: 600e9,
      players: [{ hrid: 'player1', food: equipped ? [{ hrid: 'original' }] : [] }],
    },
  };
  const sampleFor = (candidate, seed) => {
    const original = candidate === null && equipped;
    const slots = candidate?.slots || [];
    const foodUsed = original
      ? { original: 1 }
      : Object.fromEntries(slots.map((slot) => [slot.hrid, Number(slot.threshold < 51)]));
    const consumed = Object.values(foodUsed).some(Boolean);
    return {
      seed,
      deaths: (original ? baselineDeaths : consumed ? 0 : emptyDeaths) / 2,
      ranOutOfMana: !original && !consumed && manaFailure,
      stoppedEarly: false,
      simulatedTime: 600e9,
      costPerHour: consumed ? 80 : 0,
      foodUsed,
      equivalentThresholds: original
        ? null
        : slots.map((slot) => ({ hrid: slot.hrid, kind: slot.kind, min: slot.threshold, max: slot.threshold })),
      unusedFoodThresholds: !original && !slots.length ? { hp: 51, mp: 51 } : null,
    };
  };
  const expected = [...generateFoodOptimizerCandidates(items, foodSlots)].map((candidate) => {
    const samples = request.seeds.map((seed) => sampleFor(candidate, seed));
    const deaths = samples.reduce((sum, sample) => sum + sample.deaths, 0);
    const ranOutOfMana = samples.some((sample) => sample.ranOutOfMana);
    return {
      ...candidate,
      samples,
      deaths,
      ranOutOfMana,
      feasible: !ranOutOfMana && deaths <= baselineDeaths,
      roundsCompleted: 2,
      costPerHour: samples.reduce((sum, sample) => sum + sample.costPerHour, 0) / 2,
      foodUsed: samples[0].foodUsed,
    };
  });
  const ranked = expected
    .filter((result) => result.feasible)
    .sort(compareFoodOptimizerResults)
    .slice(0, 10);
  const expectedBySignature = new Map(expected.map((result) => [result.signature, result]));
  const calls = [];
  const covered = new Map();
  const clients = [];
  const updates = [];
  let feasibleBeforeDispatch = 0;
  let pruned = 0;
  let search;
  const accept = (candidate, result) => {
    expect(covered.has(candidate.signature)).toBe(false);
    covered.set(candidate.signature, result);
    if (result.feasible) feasibleBeforeDispatch += 1;
    if (result.pruned) pruned += 1;
  };
  search = createFoodOptimizerSearch({
    request,
    items,
    foodSlots,
    workerLimit,
    adaptiveWorkers: false,
    reuse,
    onUpdate: (report, progress) => updates.push({ report, progress }),
    onCoverage(entry) {
      if (entry.candidate) accept(entry.candidate, entry.result);
      else
        for (const candidate of generateFoodOptimizerCompositionCandidates(entry.items))
          if (candidate.signature !== entry.excludedSignature)
            accept(candidate, materializeFoodOptimizerOutcome(entry.evidence, candidate));
      if (cancelAfter && pruned >= cancelAfter) search.cancel();
    },
    workerFactory() {
      let roundCache;
      let collectThresholds;
      const client = {
        stop: vi.fn(),
        async call(message, progress) {
          if (message.type === 'init') {
            collectThresholds = message.collectThresholds;
            roundCache = collectThresholds && !message.sharedRounds ? createFoodOptimizerRoundCache({ items }) : null;
            return;
          }
          if (message.candidate) calls.push({ ...message, feasibleBeforeDispatch });
          return evaluateFoodOptimizerCandidate(
            request,
            message.candidate,
            message.baselineDeaths,
            progress,
            async (_request, candidate, seed) => {
              await Promise.resolve();
              const sample = sampleFor(candidate, seed);
              if (!candidate?.slots.length) mutateSample?.(sample, seed);
              return sample;
            },
            { collectThresholds, roundCache, reusableSamples: message.reusableSamples, costCutoff: message.costCutoff },
          );
        },
      };
      clients.push(client);
      return client;
    },
  });
  const report = await search.done;
  expect(report.status, report.error).toBe(cancelAfter ? 'cancelled' : 'completed');
  expect(clients.every((client) => client.stop.mock.calls.length)).toBe(true);
  const stats = report.stats;
  expect(stats.completedCandidates).toBe(covered.size);
  expect(stats.completedCandidates).toBe(
    stats.simulatedCandidates + stats.reusedCandidates + stats.skippedCandidates + stats.prunedCandidates,
  );
  expect(stats.completedCandidates).toBe(
    stats.feasibleCandidates + stats.rejectedMana + stats.rejectedDeaths + stats.prunedCandidates,
  );
  if (!cancelAfter && !mutateSample) {
    expect(covered.size).toBe(expected.length);
    expect(report.topResults.map((result) => [result.signature, physicalFoodOptimizerResult(result)])).toEqual(
      ranked.map((result) => [result.signature, physicalFoodOptimizerResult(result)]),
    );
    for (const [signature, result] of covered) {
      const actual = expectedBySignature.get(signature);
      if (result.pruned) {
        expect(ranked.some((finalist) => finalist.signature === signature)).toBe(false);
        if (actual.feasible) expect(compareFoodOptimizerResults(actual, ranked[9])).toBeGreaterThan(0);
      } else expect(physicalFoodOptimizerResult(result)).toEqual(physicalFoodOptimizerResult(actual));
    }
  }
  return { report, calls, covered, updates };
}

describe('certified zero-consumption ranking witnesses', () => {
  it.each([1, 4])('establishes a bound before ten candidates are visited with %i workers', async (workerLimit) => {
    const { report, calls } = await run({ workerLimit });
    expect(calls[0].costCutoff).toBe(0);
    expect(calls[0].feasibleBeforeDispatch).toBeLessThan(10);
    expect(report.stats.prunedCandidates).toBeGreaterThan(0);
    expect(report.topResults).toHaveLength(10);
    expect(report.topResults.every((result) => result.deaths === 6)).toBe(true);
  });

  it.each([1, 4])(
    'can establish the bound from an empty candidate after an equipped baseline with %i workers',
    async (workerLimit) => {
      const { calls } = await run({ equipped: true, workerLimit });
      expect(calls[0].candidate.signature).toBe('');
      expect(calls[0].costCutoff).toBeUndefined();
      expect(calls.some((call) => call.costCutoff === 0 && call.feasibleBeforeDispatch < 10)).toBe(true);
    },
  );

  it.each([1, 4])(
    'deduplicates witnesses against real results before applying slot bounds with %i workers',
    async (workerLimit) => {
      const { report } = await run({ items: catalog(3, [90, 60, 30]), emptyDeaths: 0, baselineDeaths: 0, workerLimit });
      expect(report.topResults).toHaveLength(10);
      expect(report.topResults[9].slots).toHaveLength(2);
      expect(new Set(report.topResults.map((result) => result.signature)).size).toBe(10);
    },
  );

  it('cannot fill ten places by repeating a smaller certified set', async () => {
    const { report, calls } = await run({ items: catalog(3, [90, 60, 30]), foodSlots: 1 });
    expect(calls.filter((call) => call.feasibleBeforeDispatch < 10).every((call) => call.costCutoff == null)).toBe(
      true,
    );
    expect(report.topResults).toHaveLength(10);
    expect(report.topResults[9].costPerHour).toBe(80);
  });

  it.each([
    { equipped: true, baselineDeaths: 4 },
    { equipped: true, manaFailure: true },
  ])('retains the original feasibility constraints: %j', async (options) => {
    const { report, calls } = await run(options);
    expect(calls.every((call) => call.costCutoff !== 0)).toBe(true);
    expect(report.topResults.every((result) => result.costPerHour === 80)).toBe(true);
  });

  it.each([
    (sample) => {
      sample.seed = 99;
    },
    (sample) => {
      sample.simulatedTime = 1;
    },
    (sample) => {
      sample.stoppedEarly = true;
    },
    (sample) => {
      sample.unusedFoodThresholds = null;
    },
    (sample, seed) => {
      if (seed === 2) sample.unusedFoodThresholds = { hp: 101, mp: 101 };
    },
  ])('does not establish an early bound from incomplete or mismatched per-seed evidence (%#)', async (mutateSample) => {
    const { calls } = await run({ mutateSample });
    expect(calls[0].costCutoff).toBeUndefined();
  });

  it('leaves complete-statistics mode free of ranking bounds', async () => {
    const { report, calls } = await run({ searchMode: 'complete' });
    expect(calls.every((call) => call.costCutoff == null)).toBe(true);
    expect(report.stats.prunedCandidates).toBe(0);
  });

  it('does not bootstrap when evidence reuse is disabled', async () => {
    const { calls } = await run({ reuse: false });
    expect(calls.filter((call) => call.feasibleBeforeDispatch < 10).every((call) => call.costCutoff == null)).toBe(
      true,
    );
  });

  it.each([1, 4])('remains cancellable after early pruning starts with %i workers', async (workerLimit) => {
    const { report, updates } = await run({ workerLimit, cancelAfter: 3 });
    expect(report.complete).toBe(false);
    expect(report.stats.completedCandidates).toBeLessThan(report.stats.totalCandidates);
    expect(updates.at(-1).report.status).toBe('cancelled');
  });
});

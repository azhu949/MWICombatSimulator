import { describe, expect, it, vi } from 'vitest';
import { compareFoodOptimizerResults, generateFoodOptimizerCandidates } from '../foodOptimizerDomain.js';
import { createFoodOptimizerSearch } from '../foodOptimizerSearch.js';
import { evaluateFoodOptimizerCandidate } from '../foodOptimizerSimulation.js';
import { createFoodOptimizerRoundCache } from '../foodOptimizerRoundCache.js';
import { physicalFoodOptimizerResult } from './support/foodOptimizerTestSupport.js';

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
            message.baselineDeaths,
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

describe('shared food evidence and bounded composition windows', () => {
  it('shares complete rounds across worker identities while simulating every unmatched seed', async () => {
    const shared = await run();
    expect(shared.clients).toHaveLength(3);
    expect(shared.transferred.some(({ producer, sample }) => producer !== sample.producer)).toBe(true);
    expect(shared.report.stats).toMatchObject({ completedCandidates: 4, completedRounds: 8, reusedRounds: 2 });
    const exhaustive = await run({ reuse: false });
    expect(exhaustive.transferred).toEqual([]);
    expect(exhaustive.report.stats).toMatchObject({ completedRounds: 10, reusedRounds: 0 });
  });

  it('keeps the one-worker cache local without transferring duplicate samples', async () => {
    const local = await run({ workerLimit: 1 });
    expect(local.transferred).toEqual([]);
    expect(local.report.stats).toMatchObject({ completedRounds: 8, reusedRounds: 2 });
  });

  it('does not carry shared evidence into a new request with different prices', async () => {
    await run();
    const second = await run({ inputSignature: 'second', priceScale: 10 });
    expect(second.transferred.length).toBeGreaterThan(0);
    expect(second.transferred.every(({ sample }) => sample.context === 'second')).toBe(true);
    expect(second.report.stats.completedRounds).toBe(8);
  });

  it('expands an early bounded window before screening the rest of a large catalog', async () => {
    const state = await run({ items: Array.from({ length: 7 }, (_, index) => item(`food${index}`)), workerLimit: 4 });
    const startedVariants = state.updates.find(({ progress }) => progress.phase === 'searching');
    expect(startedVariants.report.stats.totalCompositions).toBe(64);
    expect(startedVariants.report.stats.screenedCompositions).toBe(32);
    expect(state.report.stats.screenedCompositions).toBe(64);
    expect(state.updates.at(-1).progress.progress).toBe(1);
  });

  it('yields to cancellation even when each small window consists entirely of proven reuse', async () => {
    const request = {
      activePlayerId: '1',
      rounds: 2,
      seeds: [1, 2],
      payload: { players: [{ hrid: 'player1', food: [] }], simulationTimeLimit: 600e9 },
    };
    const samples = request.seeds.map((seed) => ({
      seed,
      deaths: 0,
      costPerHour: 0,
      foodUsed: {},
      ranOutOfMana: false,
      stoppedEarly: false,
      simulatedTime: 600e9,
      equivalentThresholds: [],
      unusedFoodThresholds: { hp: 1, mp: 1 },
    }));
    const result = {
      ...samples[0],
      samples,
      roundsCompleted: 2,
      simulatedRounds: 2,
      reusedRounds: 0,
      feasible: true,
      rejected: '',
    };
    let calls = 0;
    const client = {
      stop: vi.fn(),
      async call(message) {
        if (message.type === 'init') return;
        calls += 1;
        return result;
      },
    };
    const search = createFoodOptimizerSearch({
      request,
      items: Array.from({ length: 7 }, (_, index) => item(`food${index}`)),
      foodSlots: 3,
      workerLimit: 4,
      workerFactory: () => client,
    });
    const timer = setTimeout(() => search.cancel(), 0);
    const report = await search.done;
    clearTimeout(timer);
    expect(report).toMatchObject({ status: 'cancelled', complete: false });
    expect(report.stats.completedCandidates).toBeGreaterThan(0);
    expect(report.stats.completedCandidates).toBeLessThan(report.stats.totalCandidates);
    expect(calls).toBe(1);
    expect(client.stop).toHaveBeenCalled();
  });
});

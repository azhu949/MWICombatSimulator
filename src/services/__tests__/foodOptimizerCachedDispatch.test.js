import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildFoodDefaultCandidate,
  compareFoodOptimizerResults,
  generateFoodOptimizerCandidates,
} from '../foodOptimizerDomain.js';
import { createFoodOptimizerRoundCache } from '../foodOptimizerRoundCache.js';
import { createFoodOptimizerSearch } from '../foodOptimizerSearch.js';
import { evaluateFoodOptimizerCandidate } from '../foodOptimizerSimulation.js';

vi.mock('../foodOptimizerRoundCache.js', async (importOriginal) => ({
  ...(await importOriginal()),
  createFoodOptimizerRoundCache: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const SEEDS = [1, 2, 3];
const SIMULATION_TIME = 600e9;
const BASELINE_COST = 1000;

const foods = (count = 4) =>
  Array.from({ length: count }, (_, index) => ({
    hrid: `food-${index}`,
    kind: 'mp',
    restore: 2,
    price: index + 1,
    thresholds: [3, 2, 1],
  }));

function sampleFor(candidate, seed, deaths = 0) {
  const foodUsed = Object.fromEntries(candidate.slots.map((slot) => [slot.hrid, 3 * (slot.threshold + seed)]));
  return {
    seed,
    deaths,
    ranOutOfMana: false,
    stoppedEarly: false,
    simulatedTime: SIMULATION_TIME,
    foodUsed,
    costPerHour: candidate.slots.reduce((sum, slot) => sum + foodUsed[slot.hrid] * slot.price * 6, 0),
    // Singleton certificates cannot cover a later threshold. The no-food bound
    // likewise cannot cover this catalog, so every cache hit exercises dispatch.
    equivalentThresholds: candidate.slots.map(({ hrid, kind, threshold }) => ({
      hrid,
      kind,
      min: threshold,
      max: threshold,
    })),
    unusedFoodThresholds: candidate.slots.length ? null : { hp: 1000, mp: 1000 },
    inactiveFoodThresholds: null,
  };
}

function baselineFor(deaths) {
  return {
    feasible: true,
    rejected: '',
    deaths,
    ranOutOfMana: false,
    roundsCompleted: SEEDS.length,
    simulatedRounds: SEEDS.length,
    reusedRounds: 0,
    foodUsed: { equipped: 1 },
    costPerHour: BASELINE_COST,
    equivalentThresholds: null,
    unusedFoodThresholds: null,
    inactiveFoodThresholds: null,
    samples: SEEDS.map((seed, index) => ({
      seed,
      deaths: index === 0 ? deaths : 0,
      ranOutOfMana: false,
      stoppedEarly: false,
      simulatedTime: SIMULATION_TIME,
      foodUsed: { equipped: 1 },
      costPerHour: BASELINE_COST,
      equivalentThresholds: null,
      unusedFoodThresholds: null,
      inactiveFoodThresholds: null,
    })),
  };
}

function start({ items = foods(), baselineDeaths = 0, cachedSample = sampleFor, adaptiveWorkers = false } = {}) {
  const request = {
    activePlayerId: '1',
    rounds: SEEDS.length,
    seeds: SEEDS,
    payload: {
      players: [{ hrid: 'player1', food: [{ hrid: 'equipped' }] }],
      simulationTimeLimit: SIMULATION_TIME,
    },
  };
  const cache = {
    match: vi.fn((seed, candidate) => cachedSample(candidate, seed)),
    record: vi.fn(),
    clear: vi.fn(),
  };
  vi.mocked(createFoodOptimizerRoundCache).mockReset().mockReturnValue(cache);
  const calls = [];
  const clients = [];
  const coverage = new Map();
  const updates = [];
  const simulateRound = vi.fn(async (request, candidate, seed) => sampleFor(candidate, seed));
  const search = createFoodOptimizerSearch({
    request,
    items,
    foodSlots: 1,
    workerLimit: 2,
    adaptiveWorkers,
    onUpdate(report, progress) {
      updates.push({ report, progress });
    },
    onCoverage({ candidate, result }) {
      expect(candidate).toBeDefined();
      expect(coverage.has(candidate.signature)).toBe(false);
      coverage.set(candidate.signature, result);
    },
    workerFactory() {
      const client = {
        stop: vi.fn(),
        async call(message, progress) {
          if (message.type === 'init') return;
          calls.push(message);
          if (message.candidate === null) {
            progress?.({ round: SEEDS.length, progress: 0, simulatedRounds: SEEDS.length, reusedRounds: 0 });
            return baselineFor(baselineDeaths);
          }
          return evaluateFoodOptimizerCandidate(
            request,
            message.candidate,
            message.baselineDeaths,
            progress,
            simulateRound,
            { reusableSamples: message.reusableSamples },
          );
        },
      };
      clients.push(client);
      return client;
    },
  });
  return { search, cache, calls, clients, coverage, updates, simulateRound, items };
}

describe('food optimizer dispatch of complete shared-round evidence', () => {
  it.each([false, true])(
    'finishes fully cached candidates on the coordinator (adaptive workers: %s)',
    async (adaptiveWorkers) => {
      const state = start({ adaptiveWorkers });
      const report = await state.search.done;
      const candidates = [...generateFoodOptimizerCandidates(state.items, 1)];
      const expected = candidates
        .map((candidate) => ({
          ...candidate,
          foodUsed: Object.fromEntries(candidate.slots.map((slot) => [slot.hrid, 3 * (slot.threshold + 2)])),
          costPerHour: candidate.slots.reduce((sum, slot) => sum + 18 * (slot.threshold + 2) * slot.price, 0),
          deaths: 0,
        }))
        .sort(compareFoodOptimizerResults)
        .slice(0, 10);
      expect(report).toMatchObject({ status: 'completed', complete: true });
      expect(state.calls.map((message) => message.candidate)).toEqual([null]);
      expect(state.simulateRound).not.toHaveBeenCalled();
      expect(state.coverage.size).toBe(candidates.length);
      expect(report.stats).toMatchObject({
        completedCandidates: candidates.length,
        feasibleCandidates: candidates.length,
        reusedCandidates: candidates.length,
        simulatedCandidates: 0,
        skippedCandidates: 0,
        completedRounds: SEEDS.length,
        reusedRounds: candidates.length * SEEDS.length,
        screenedCompositions: state.items.length + 1,
        passedCompositions: state.items.length + 1,
      });
      expect(report.topResults).toHaveLength(10);
      expect(
        report.topResults.map(({ signature, foodUsed, costPerHour, deaths }) => ({
          signature,
          foodUsed,
          costPerHour,
          deaths,
        })),
      ).toEqual(
        expected.map(({ signature, foodUsed, costPerHour, deaths }) => ({ signature, foodUsed, costPerHour, deaths })),
      );
      for (const result of report.topResults) {
        expect(result).toMatchObject({ simulatedRounds: 0, reusedRounds: SEEDS.length, roundsCompleted: SEEDS.length });
        expect(result.savingsPerHour).toBe(BASELINE_COST - result.costPerHour);
      }
      expect(state.updates.at(-1).progress.progress).toBe(1);
      expect(
        state.updates.every(
          ({ progress }, index) => index === 0 || progress.progress >= state.updates[index - 1].progress.progress,
        ),
      ).toBe(true);
    },
  );

  it.each(SEEDS)(
    'dispatches when seed %i is missing and still transfers the remaining validated rounds',
    async (missingSeed) => {
      const items = foods(1);
      const target = buildFoodDefaultCandidate(items);
      const state = start({
        items,
        cachedSample: (candidate, seed) =>
          candidate.signature === target.signature && seed === missingSeed ? null : sampleFor(candidate, seed),
      });
      const report = await state.search.done;
      const dispatched = state.calls.filter((message) => message.candidate !== null);
      expect(report).toMatchObject({ status: 'completed', complete: true });
      expect(dispatched).toHaveLength(1);
      expect(dispatched[0].candidate.signature).toBe(target.signature);
      expect(dispatched[0].reusableSamples.map((sample) => sample?.seed ?? null)).toEqual(
        SEEDS.map((seed) => (seed === missingSeed ? null : seed)),
      );
      expect(state.simulateRound).toHaveBeenCalledOnce();
      expect(state.simulateRound.mock.calls[0][2]).toBe(missingSeed);
      expect(report.stats).toMatchObject({
        completedCandidates: 4,
        feasibleCandidates: 4,
        simulatedCandidates: 1,
        reusedCandidates: 3,
        skippedCandidates: 0,
        completedRounds: 4,
        reusedRounds: 11,
      });
      expect(state.coverage.get(target.signature)).toMatchObject({ simulatedRounds: 1, reusedRounds: 2 });
    },
  );

  it('counts only the reused death-failure prefix and excludes it from feasible rankings without dispatching', async () => {
    const items = foods(1);
    const target = buildFoodDefaultCandidate(items);
    const state = start({
      items,
      baselineDeaths: 2,
      cachedSample: (candidate, seed) =>
        sampleFor(candidate, seed, candidate.signature === target.signature ? [1, 2, 0][seed - 1] : 0),
    });
    const report = await state.search.done;
    expect(report).toMatchObject({ status: 'completed', complete: true });
    expect(state.calls.map((message) => message.candidate)).toEqual([null]);
    expect(report.stats).toMatchObject({
      completedCandidates: 4,
      feasibleCandidates: 3,
      reusedCandidates: 3,
      skippedCandidates: 1,
      simulatedCandidates: 0,
      rejectedDeaths: 1,
      rejectedMana: 0,
      completedRounds: 3,
      reusedRounds: 11,
      screenedCompositions: 2,
      passedCompositions: 1,
    });
    const rejected = state.coverage.get(target.signature);
    expect(rejected).toMatchObject({
      feasible: false,
      rejected: 'deaths',
      deaths: 3,
      roundsCompleted: 2,
      simulatedRounds: 0,
      reusedRounds: 2,
    });
    expect(rejected.samples.map((sample) => sample.seed)).toEqual([1, 2]);
    expect(report.topResults).toHaveLength(3);
    expect(report.topResults.some((result) => result.signature === target.signature)).toBe(false);
    expect(state.updates.at(-1).progress.progress).toBe(1);
  });

  it('yields during consecutive coordinator summaries so a queued cancellation stops the search', async () => {
    vi.stubGlobal('MessageChannel', undefined);
    const state = start({ items: foods(80) });
    const timer = setTimeout(() => state.search.cancel(), 0);
    let report;
    try {
      report = await state.search.done;
    } finally {
      clearTimeout(timer);
    }
    expect(report).toMatchObject({ status: 'cancelled', complete: false });
    expect(state.calls.map((message) => message.candidate)).toEqual([null]);
    expect(report.stats.completedCandidates).toBeGreaterThan(0);
    expect(report.stats.completedCandidates).toBeLessThan(report.stats.totalCandidates);
    expect(report.stats.reusedCandidates).toBe(report.stats.completedCandidates);
    expect(report.stats.reusedRounds).toBe(report.stats.completedCandidates * SEEDS.length);
    expect(report.stats.completedRounds).toBe(SEEDS.length);
    expect(report.stats.simulatedCandidates).toBe(0);
    expect(state.coverage.size).toBe(report.stats.completedCandidates);
    expect(report.topResults.length).toBeGreaterThan(0);
  });
});

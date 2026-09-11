import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compareFoodOptimizerResults,
  generateFoodOptimizerCandidates,
  generateFoodOptimizerCompositionCandidates,
} from '../foodOptimizerDomain.js';
import { materializeFoodOptimizerOutcome } from '../foodOptimizerPruning.js';
import { createFoodOptimizerSearch } from '../foodOptimizerSearch.js';

afterEach(() => vi.restoreAllMocks());

const items = [
  { hrid: 'hp-a', kind: 'hp', thresholds: [100, 50, 10], restore: 50, price: 1 },
  { hrid: 'mp-a', kind: 'mp', thresholds: [200, 50, 10], restore: 50, price: 1 },
  { hrid: 'mp-b', kind: 'mp', thresholds: [100, 50, 20], restore: 50, price: 1 },
  { hrid: 'hp-b', kind: 'hp', thresholds: [120, 80, 50], restore: 80, price: 1 },
  { hrid: 'empty-grid', thresholds: [] },
];

function outcome(candidate, unusedFoodThresholds = null) {
  const foodUsed = Object.fromEntries((candidate?.food || []).map((hrid) => [hrid, 0]));
  return {
    feasible: true,
    rejected: '',
    ranOutOfMana: false,
    deaths: 0,
    roundsCompleted: 2,
    simulatedRounds: 2,
    reusedRounds: 0,
    foodUsed,
    costPerHour: 0,
    unusedFoodThresholds,
    equivalentThresholds: null,
    samples: [1, 2].map((seed) => ({
      seed,
      deaths: 0,
      ranOutOfMana: false,
      stoppedEarly: false,
      foodUsed,
      costPerHour: 0,
      simulatedTime: 600e9,
      unusedFoodThresholds,
      equivalentThresholds: null,
    })),
  };
}

function setup({
  food = [null, null, null],
  baseline = outcome(null, { hp: 10, mp: 10 }),
  reuse = true,
  onUpdate,
  onCoverage,
} = {}) {
  const clients = [];
  const calls = [];
  const search = createFoodOptimizerSearch({
    request: {
      activePlayerId: '1',
      rounds: 2,
      seeds: [1, 2],
      payload: { players: [{ hrid: 'player1', food }] },
    },
    items,
    foodSlots: 3,
    workerLimit: 4,
    adaptiveWorkers: false,
    reuse,
    onUpdate,
    onCoverage,
    workerFactory() {
      const client = {
        stop: vi.fn(),
        async call(message) {
          if (message.type === 'init') return;
          calls.push(message.candidate);
          return message.candidate === null ? structuredClone(baseline) : outcome(message.candidate);
        },
      };
      clients.push(client);
      return client;
    },
  });
  return { search, clients, calls };
}

describe('worker allocation after a fully reusable empty-food baseline', () => {
  it('uses only the baseline worker while preserving every candidate and the exact top ten', async () => {
    const seen = [];
    const covered = new Map();
    const accept = (candidate, result) => {
      seen.push(candidate.signature);
      covered.set(candidate.signature, {
        feasible: result.feasible,
        foodUsed: result.foodUsed,
        deaths: result.deaths,
        costPerHour: result.costPerHour,
      });
    };
    const phases = [];
    const { search, clients, calls } = setup({
      onUpdate(report, progress) {
        phases.push(progress.phase);
      },
      onCoverage(coverage) {
        if (coverage.candidate) {
          accept(coverage.candidate, coverage.result);
          return;
        }
        for (const candidate of generateFoodOptimizerCompositionCandidates(coverage.items))
          if (candidate.signature !== coverage.excludedSignature)
            accept(candidate, materializeFoodOptimizerOutcome(coverage.evidence, candidate));
      },
    });
    const report = await search.done;
    const expected = [...generateFoodOptimizerCandidates(items, 3)].map((candidate) => ({
      ...candidate,
      ...outcome(candidate),
    }));
    expect(clients).toHaveLength(1);
    expect(calls).toEqual([null]);
    expect(clients[0].stop).toHaveBeenCalled();
    expect(report).toMatchObject({ status: 'completed', complete: true });
    expect(report.stats).toMatchObject({
      completedCandidates: expected.length,
      feasibleCandidates: expected.length,
      reusedCandidates: expected.length,
      simulatedCandidates: 0,
      completedRounds: 2,
    });
    expect(new Set(seen).size).toBe(expected.length);
    expect(seen).toHaveLength(expected.length);
    expect(covered).toEqual(
      new Map(
        expected.map(({ signature, feasible, foodUsed, deaths, costPerHour }) => [
          signature,
          { feasible, foodUsed, deaths, costPerHour },
        ]),
      ),
    );
    const ranked = ({ signature, foodUsed, deaths, costPerHour }) => ({ signature, foodUsed, deaths, costPerHour });
    expect(report.topResults.map(ranked)).toEqual(expected.sort(compareFoodOptimizerResults).slice(0, 10).map(ranked));
    expect(phases).toEqual(expect.arrayContaining(['baseline', 'screening', 'searching', 'completed']));
  });

  it.each([
    { name: 'an equipped food', options: { food: [{ hrid: 'equipped' }, null, null] } },
    { name: 'disabled reuse', options: { reuse: false } },
    { name: 'a missing certificate', patch: (baseline) => ({ ...baseline, unusedFoodThresholds: null }) },
    {
      name: 'incomplete rounds',
      patch: (baseline) => ({ ...baseline, roundsCompleted: 1, samples: baseline.samples.slice(0, 1) }),
    },
    { name: 'aggregate mana exhaustion', patch: (baseline) => ({ ...baseline, ranOutOfMana: true }) },
    {
      name: 'mana exhaustion hidden in one sample',
      patch: (baseline) => ({
        ...baseline,
        samples: baseline.samples.map((sample, index) => ({ ...sample, ranOutOfMana: index === 0 })),
      }),
    },
    {
      name: 'a stopped sample',
      patch: (baseline) => ({
        ...baseline,
        samples: baseline.samples.map((sample, index) => ({ ...sample, stoppedEarly: index === 0 })),
      }),
    },
    {
      name: 'a certificate that omits the lowest HP threshold',
      patch: (baseline) => ({
        ...baseline,
        unusedFoodThresholds: { hp: 11, mp: 10 },
        samples: baseline.samples.map((sample) => ({ ...sample, unusedFoodThresholds: { hp: 11, mp: 10 } })),
      }),
    },
    {
      name: 'an invalid unused-food bound',
      patch: (baseline) => ({ ...baseline, unusedFoodThresholds: { hp: 0, mp: 10 } }),
    },
  ])('keeps the full worker pool for $name', async ({ options, patch }) => {
    const baseline = outcome(null, { hp: 10, mp: 10 });
    const { search, clients, calls } = setup({ ...options, baseline: patch ? patch(baseline) : baseline });
    const report = await search.done;
    expect(report.status).toBe('completed');
    expect(clients).toHaveLength(4);
    expect(calls.some((candidate) => candidate !== null)).toBe(true);
    expect(clients.every((client) => client.stop.mock.calls.length > 0)).toBe(true);
  });

  it('remains cancellable during main-thread reuse with the single baseline worker', async () => {
    let time = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => (time += 200));
    let search;
    const configured = setup({
      onUpdate(report, progress) {
        if (progress.phase === 'searching' && report.stats.completedCandidates > report.stats.totalCompositions)
          search.cancel();
      },
    });
    search = configured.search;
    const report = await search.done;
    expect(report).toMatchObject({ status: 'cancelled', complete: false });
    expect(configured.clients).toHaveLength(1);
    expect(configured.calls).toEqual([null]);
    expect(report.stats.completedCandidates).toBeLessThan(report.stats.totalCandidates);
    expect(report.topResults.length).toBeGreaterThan(0);
    expect(configured.clients[0].stop).toHaveBeenCalled();
  });
});

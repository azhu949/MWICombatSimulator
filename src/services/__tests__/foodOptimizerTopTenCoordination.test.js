import { describe, expect, it, vi } from 'vitest';
import { compareFoodOptimizerResults, generateFoodOptimizerCandidates } from '../foodOptimizerDomain.js';
import { createFoodOptimizerSearch } from '../foodOptimizerSearch.js';

const requestFor = (searchMode = 'top10') => ({
  activePlayerId: '1',
  searchMode,
  rounds: 2,
  seeds: [1, 2],
  payload: { simulationTimeLimit: 600e9 },
});
const catalog = () =>
  Array.from({ length: 12 }, (_, index) => ({
    hrid: `food-${String(11 - index).padStart(2, '0')}`,
    kind: 'mp',
    restore: 30,
    price: index + 1,
    thresholds: [90, 60, 30],
  }));
const outcome = (request, candidate, cost) => ({
  feasible: true,
  rejected: '',
  ranOutOfMana: false,
  deaths: 0,
  costPerHour: cost,
  roundsCompleted: request.rounds,
  simulatedRounds: request.rounds,
  reusedRounds: 0,
  foodUsed: Object.fromEntries(candidate.food.map((hrid) => [hrid, 1])),
  samples: request.seeds.map((seed) => ({
    seed,
    deaths: 0,
    ranOutOfMana: false,
    stoppedEarly: false,
    simulatedTime: 600e9,
    costPerHour: cost,
    foodUsed: Object.fromEntries(candidate.food.map((hrid) => [hrid, 1])),
  })),
});
const checkCounts = (report) => {
  const stats = report.stats;
  expect(stats.completedCandidates).toBe(
    stats.simulatedCandidates + stats.reusedCandidates + stats.skippedCandidates + stats.prunedCandidates,
  );
  expect(stats.completedCandidates).toBe(
    stats.feasibleCandidates + stats.rejectedMana + stats.rejectedDeaths + stats.prunedCandidates,
  );
};

describe('exact top-ten food optimizer coordination', () => {
  it('finds the exact zero-cost ranking while skipping every larger-slot composition as a block', async () => {
    const request = requestFor();
    const items = catalog();
    const evaluated = [];
    const coverage = [];
    const report = await createFoodOptimizerSearch({
      request,
      items,
      foodSlots: 3,
      workerLimit: 1,
      onCoverage: (entry) => coverage.push(entry),
      workerFactory: () => ({
        stop() {},
        async call(message) {
          if (message.type === 'init') return;
          if (message.candidate === null) return outcome(request, { food: [] }, 0);
          evaluated.push(message.candidate);
          return outcome(request, message.candidate, 0);
        },
      }),
    }).done;
    const expected = [...generateFoodOptimizerCandidates(items, 3)]
      .map((candidate) => ({ ...candidate, ...outcome(request, candidate, 0) }))
      .sort(compareFoodOptimizerResults)
      .slice(0, 10);
    expect(report.complete).toBe(true);
    expect(report.topResults.map((entry) => entry.signature)).toEqual(expected.map((entry) => entry.signature));
    expect(evaluated.every((candidate) => candidate.slots.length <= 1)).toBe(true);
    expect(report.stats.feasibleCandidates).toBe(1 + 12 * 3);
    expect(report.stats.prunedCandidates).toBe(report.stats.totalCandidates - report.stats.feasibleCandidates);
    expect(report.stats.completedRounds).toBe((evaluated.length + 1) * request.rounds);
    expect(coverage.some((entry) => entry.evidence?.result.pruned === 'rank')).toBe(true);
    checkCounts(report);
  });

  it.each([1, 4])(
    'passes only an established cutoff and keeps pruned rounds separate with %i workers',
    async (workerLimit) => {
      const request = requestFor();
      const items = catalog();
      const calls = [];
      const clients = [];
      const costFor = (candidate) =>
        candidate.food.some((hrid) => hrid.endsWith('00')) ? 200 : candidate.food.length ? 10 : 0;
      const report = await createFoodOptimizerSearch({
        request,
        items,
        foodSlots: 2,
        workerLimit,
        adaptiveWorkers: false,
        workerFactory: () => {
          const client = {
            stop: vi.fn(),
            async call(message, progress) {
              if (message.type === 'init') return;
              if (message.candidate === null) return outcome(request, { food: [] }, 0);
              calls.push(message);
              await Promise.resolve();
              const cost = costFor(message.candidate);
              if (Number.isFinite(message.costCutoff) && cost / 2 > message.costCutoff) {
                const result = outcome(request, message.candidate, cost);
                progress?.({ round: 1, progress: 0, simulatedRounds: 1, reusedRounds: 0, pruned: 'cost' });
                return {
                  ...result,
                  samples: result.samples.slice(0, 1),
                  roundsCompleted: 1,
                  simulatedRounds: 1,
                  feasible: null,
                  pruned: 'cost',
                  costLowerBound: cost / 2,
                  costPerHour: null,
                };
              }
              return outcome(request, message.candidate, cost);
            },
          };
          clients.push(client);
          return client;
        },
      }).done;
      const expected = [...generateFoodOptimizerCandidates(items, 2)]
        .map((candidate) => ({ ...candidate, ...outcome(request, candidate, costFor(candidate)) }))
        .sort(compareFoodOptimizerResults)
        .slice(0, 10);
      expect(report.status).toBe('completed');
      expect(report.topResults.map((entry) => [entry.signature, entry.costPerHour])).toEqual(
        expected.map((entry) => [entry.signature, entry.costPerHour]),
      );
      expect(calls.slice(0, 10).every((message) => message.costCutoff === undefined)).toBe(true);
      expect(calls.some((message) => message.costCutoff === 10)).toBe(true);
      expect(report.stats.prunedCandidates).toBeGreaterThan(0);
      expect(report.stats.rejectedMana).toBe(0);
      expect(report.stats.rejectedDeaths).toBe(0);
      expect(report.stats.completedRounds).toBe(report.stats.maxSimulationRounds - report.stats.prunedCandidates);
      expect(clients.every((client) => client.stop.mock.calls.length > 0)).toBe(true);
      checkCounts(report);
    },
  );

  it('keeps complete searches free of ranking cutoffs and preserves their feasible total', async () => {
    const request = requestFor('complete');
    const items = catalog().slice(0, 3);
    const calls = [];
    const report = await createFoodOptimizerSearch({
      request,
      items,
      foodSlots: 2,
      workerLimit: 1,
      workerFactory: () => ({
        stop() {},
        async call(message) {
          if (message.type === 'init') return;
          calls.push(message);
          return outcome(request, message.candidate || { food: [] }, 0);
        },
      }),
    }).done;
    expect(report.complete).toBe(true);
    expect(calls.every((message) => !Object.hasOwn(message, 'costCutoff'))).toBe(true);
    expect(report.stats.prunedCandidates).toBe(0);
    expect(report.stats.feasibleCandidates).toBe(report.stats.totalCandidates);
    checkCounts(report);
  });

  it('stays cancellable during a long sequence of ranking exclusions', async () => {
    const request = requestFor();
    const items = catalog();
    let search;
    let pruned = 0;
    let stopped = false;
    search = createFoodOptimizerSearch({
      request,
      items,
      foodSlots: 3,
      workerLimit: 1,
      onCoverage(entry) {
        if ((entry.result || entry.evidence?.result)?.pruned && ++pruned === 20) search.cancel();
      },
      workerFactory: () => ({
        stop() {
          stopped = true;
        },
        async call(message) {
          if (message.type === 'init') return;
          return outcome(request, message.candidate || { food: [] }, 0);
        },
      }),
    });
    const report = await search.done;
    expect(report.status).toBe('cancelled');
    expect(report.complete).toBe(false);
    expect(report.stats.completedCandidates).toBeLessThan(report.stats.totalCandidates);
    expect(stopped).toBe(true);
    checkCounts(report);
  });
});

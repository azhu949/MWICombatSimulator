import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compareFoodOptimizerResults,
  generateFoodOptimizerCandidates,
  generateFoodOptimizerCompositionCandidates,
} from '../foodOptimizerDomain.js';
import { materializeFoodOptimizerOutcome } from '../foodOptimizerPruning.js';
import { createFoodOptimizerSearch } from '../foodOptimizerSearch.js';
import { createFoodOptimizerWorkQueue } from '../foodOptimizerWorkQueue.js';

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
    expect(report).toMatchObject({ status: 'completed', complete: true });
    expect(report.stats).toMatchObject({
      completedCandidates: expected.length,
      reusedCandidates: expected.length,
      simulatedCandidates: 0,
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
    expect(phases).toEqual(expect.arrayContaining(['searching', 'completed']));
  });

  it.each([
    { name: 'an equipped food', options: { food: [{ hrid: 'equipped' }, null, null] } },
    { name: 'disabled reuse', options: { reuse: false } },
  ])('keeps the full worker pool for $name', async ({ options }) => {
    const baseline = outcome(null, { hp: 10, mp: 10 });
    const { search, clients, calls } = setup({ ...options, baseline });
    const report = await search.done;
    expect(report.status).toBe('completed');
    expect(clients).toHaveLength(4);
    expect(calls.some((candidate) => candidate !== null)).toBe(true);
    expect(clients.every((client) => client.stop.mock.calls.length > 0)).toBe(true);
  });
});

describe('food composition work allocation', () => {
  it('keeps related work on the same worker while other compositions are available', () => {
    const factories = [vi.fn(() => ['a1', 'a2', 'a3']), vi.fn(() => ['b1', 'b2']), vi.fn(() => ['c1'])];
    const queue = createFoodOptimizerWorkQueue(factories);
    expect(queue.next('first').value).toBe('a1');
    expect(queue.next('second').value).toBe('b1');
    expect(queue.next('first').value).toBe('a2');
    expect(queue.next('second').value).toBe('b2');
    expect(queue.next('second').value).toBe('c1');
    expect(queue.next('first').value).toBe('a3');
    expect(queue.next('first').done).toBe(true);
    expect(queue.next('second').done).toBe(true);
  });

  it('lets idle workers consume a long remaining composition without waiting for its owner', () => {
    const queue = createFoodOptimizerWorkQueue([() => ['a1', 'a2', 'a3', 'a4', 'a5'], () => ['b1']]);
    const seen = [queue.next('first').value, queue.next('second').value];
    seen.push(queue.next('second').value, queue.next('third').value, queue.next('first').value);
    expect(seen).toEqual(['a1', 'b1', 'a2', 'a3', 'a4']);
    expect(queue.next('second').value).toBe('a5');
    for (const worker of ['first', 'second', 'third']) expect(queue.next(worker).done).toBe(true);
  });

  it('preserves every yielded block exactly once across uneven and empty groups', () => {
    const groups = Array.from({ length: 11 }, (_, group) =>
      Array.from({ length: group % 5 }, (_, point) => ({ group, point, coveredCandidates: 10 ** point })),
    );
    const queue = createFoodOptimizerWorkQueue(groups.map((group) => () => group));
    const seen = [];
    let done = 0;
    while (done < 4) {
      done = 0;
      for (const worker of ['a', 'b', 'a', 'c']) {
        const entry = queue.next(worker);
        if (entry.done) done += 1;
        else seen.push(entry.value);
      }
    }
    expect(new Set(seen).size).toBe(groups.flat().length);
    expect(new Set(seen)).toEqual(new Set(groups.flat()));
  });

  it('clears pending and assigned work without opening another composition', () => {
    const unopened = vi.fn(() => ['b1']);
    const queue = createFoodOptimizerWorkQueue([() => ['a1', 'a2'], unopened]);
    expect(queue.next('first').value).toBe('a1');
    queue.clear();
    expect(queue.next('first').done).toBe(true);
    expect(queue.next('second').done).toBe(true);
    expect(unopened).not.toHaveBeenCalled();
  });
});

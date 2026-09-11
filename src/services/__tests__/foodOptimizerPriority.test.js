import { describe, expect, it, vi } from 'vitest';
import {
  buildFoodDefaultCandidate,
  compareFoodOptimizerResults,
  countFoodOptimizerCompositions,
  generateFoodOptimizerCandidates,
  generateFoodOptimizerCompositionCandidates,
} from '../foodOptimizerDomain.js';
import { createFoodOptimizerPriority } from '../foodOptimizerPriority.js';
import { materializeFoodOptimizerOutcome } from '../foodOptimizerPruning.js';
import { createFoodOptimizerSearch } from '../foodOptimizerSearch.js';

const catalog = () =>
  ['early-hp', 'early-mp', 'equipped-hp', 'equipped-mp-a', 'equipped-mp-b'].map((hrid) => ({
    hrid,
    kind: hrid.endsWith('hp') ? 'hp' : 'mp',
    restore: 50,
    price: 1,
    thresholds: [90, 70, 50, 30, 10],
  }));
const requestFor = (items, searchMode = 'top10') => ({
  activePlayerId: '2',
  searchMode,
  rounds: 1,
  seeds: [1],
  payload: {
    simulationTimeLimit: 600e9,
    players: [
      { hrid: 'player1', food: [null, null, null] },
      { hrid: 'player2', food: items.slice(-3).map((item) => ({ hrid: item.hrid })) },
    ],
  },
});

describe('bounded equipped-food neighborhood', () => {
  it.each(
    [
      [90, 70, 50, 30, 10],
      [10, 30, 50, 70, 90],
      [90, 10, 50, 30, 70],
      [100, 99, 70, 51, 50, 49, 10, 1],
      [50],
      [90, 50],
    ].map((thresholds) => [thresholds]),
  )('partitions an irregular grid without duplicates or gaps (%j)', (thresholds) => {
    const items = catalog()
      .slice(-3)
      .map((item, index) => ({ ...item, thresholds: index === 1 ? [90, 50, 10] : thresholds }));
    const original = structuredClone(items);
    const plan = createFoodOptimizerPriority(requestFor(items), items, 3);
    expect(plan.nearbyCount).toBeLessThanOrEqual(27);
    expect(plan.remainingItems.length).toBeLessThanOrEqual(6);
    const seen = new Set();
    for (const region of [plan.nearbyItems, ...plan.remainingItems])
      for (const candidate of generateFoodOptimizerCompositionCandidates(region)) {
        expect(seen.has(candidate.signature)).toBe(false);
        seen.add(candidate.signature);
      }
    expect(seen).toEqual(
      new Set([...generateFoodOptimizerCompositionCandidates(items)].map((candidate) => candidate.signature)),
    );
    expect(plan.candidate).toEqual(buildFoodDefaultCandidate(items));
    expect(items).toEqual(original);
  });

  it.each(['missing', 'single', 'unknown', 'duplicate', 'too-many', 'default-outside-grid', 'duplicate-threshold'])(
    'falls back for %s equipment',
    (kind) => {
      const items = catalog();
      const request = requestFor(items);
      let slots = 3;
      if (kind === 'missing') delete request.payload.players;
      if (kind === 'single') request.payload.players[1].food = [{ hrid: items[4].hrid }];
      if (kind === 'unknown') request.payload.players[1].food[0].hrid = 'missing-food';
      if (kind === 'duplicate') request.payload.players[1].food[1] = { ...request.payload.players[1].food[0] };
      if (kind === 'too-many') slots = 2;
      if (kind === 'default-outside-grid') items[2].thresholds = [90, 30, 10];
      if (kind === 'duplicate-threshold') items[2].thresholds.push(50);
      expect(createFoodOptimizerPriority(request, items, slots)).toBeNull();
    },
  );
});

function resultFor(candidate, { broad = false, emptyFeasible = false } = {}) {
  const slots = candidate?.slots || [];
  const feasible = !candidate || slots.length === 3 || (emptyFeasible && slots.length === 0);
  const champion =
    slots.length === 3 &&
    slots.some((slot) => slot.hrid === 'early-hp') &&
    slots.every((slot) => slot.threshold === 10);
  const sensitive = slots.filter((slot) => !broad || slot.kind === 'mp');
  const costPerHour = slots.length
    ? champion && !broad
      ? 1
      : 100 + sensitive.reduce((sum, slot) => sum + slot.threshold, 0)
    : 0;
  const sample = {
    seed: 1,
    deaths: 0,
    ranOutOfMana: !feasible,
    stoppedEarly: !feasible,
    simulatedTime: 600e9,
    foodUsed: Object.fromEntries(slots.map((slot) => [slot.hrid, Number(!broad || slot.kind === 'mp')])),
    costPerHour,
    equivalentThresholds: broad
      ? slots.map(({ hrid, kind, threshold }) => ({
          hrid,
          kind,
          min: kind === 'hp' ? 1 : threshold,
          max: kind === 'hp' ? 100 : threshold,
        }))
      : null,
  };
  return {
    ...sample,
    feasible,
    rejected: feasible ? '' : 'mana',
    samples: [sample],
    roundsCompleted: 1,
    simulatedRounds: 1,
    reusedRounds: 0,
  };
}

async function searchFor({
  items: suppliedItems,
  workerLimit = 1,
  reuse = true,
  broad = false,
  emptyFeasible = false,
  searchMode = 'top10',
  cancelAt,
  failNear = false,
} = {}) {
  const items = suppliedItems ?? catalog();
  const request = requestFor(items, searchMode);
  const original = structuredClone({ items, request });
  const covered = new Map();
  const calls = [];
  const clients = [];
  let search;
  const accept = (candidate, result) => {
    expect(covered.has(candidate.signature)).toBe(false);
    covered.set(candidate.signature, result);
    if (cancelAt?.(candidate)) search.cancel();
  };
  search = createFoodOptimizerSearch({
    request,
    items,
    foodSlots: 3,
    workerLimit,
    reuse,
    adaptiveWorkers: false,
    onCoverage(coverage) {
      if (coverage.candidate) accept(coverage.candidate, coverage.result);
      else
        for (const candidate of generateFoodOptimizerCompositionCandidates(coverage.items))
          if (candidate.signature !== coverage.excludedSignature)
            accept(candidate, materializeFoodOptimizerOutcome(coverage.evidence, candidate));
    },
    workerFactory() {
      const client = {
        stop: vi.fn(),
        async call(message) {
          if (message.type === 'init') return;
          await Promise.resolve();
          if (message.candidate) {
            calls.push(message);
            if (
              failNear &&
              message.candidate.slots.length === 3 &&
              message.candidate.slots.some((slot) => slot.threshold !== 50)
            )
              throw new Error('neighborhood worker failed');
          }
          return resultFor(message.candidate, { broad, emptyFeasible });
        },
      };
      clients.push(client);
      return client;
    },
  });
  const report = await search.done;
  expect({ items, request }).toEqual(original);
  expect(clients.every((client) => client.stop.mock.calls.length)).toBe(true);
  return { report, covered, calls, items, request };
}

describe('equipped-food priority in the full search', () => {
  it('keeps an already completed neighborhood excluded across later composition windows', async () => {
    const items = Array.from({ length: 9 }, (_, index) => ({
      hrid: `late-${index}`,
      kind: 'mp',
      restore: 50,
      price: 1,
      thresholds: [90, 50, 10],
    }));
    const { report, calls, covered } = await searchFor({ items, reuse: false, workerLimit: 4 });
    const expected = [...generateFoodOptimizerCandidates(items, 3)];
    const equipped = new Set(items.slice(-3).map((item) => item.hrid));
    expect(report.complete).toBe(true);
    expect(covered.size).toBe(expected.length);
    expect(calls).toHaveLength(expected.length);
    expect(
      calls.filter(
        ({ candidate }) => candidate.food.length === 3 && candidate.food.every((hrid) => equipped.has(hrid)),
      ),
    ).toHaveLength(27);
    expect(report.stats.screenedCompositions).toBe(countFoodOptimizerCompositions(items, 3));
  });
  it.each(
    [1, 4].flatMap((workerLimit) =>
      [true, false].flatMap((reuse) => [true, false].map((broad) => ({ workerLimit, reuse, broad }))),
    ),
  )(
    'keeps exact coverage and a better optimum outside the neighborhood ($workerLimit workers, reuse=$reuse, broad=$broad)',
    async (options) => {
      const { report, covered, calls, items } = await searchFor(options);
      const candidates = [...generateFoodOptimizerCandidates(items, 3)];
      const expected = candidates.map((candidate) => ({ ...candidate, ...resultFor(candidate, options) }));
      expect(report.status, report.error).toBe('completed');
      expect(report.complete).toBe(true);
      expect(new Set(covered.keys())).toEqual(new Set(candidates.map((candidate) => candidate.signature)));
      for (const result of expected) {
        const actual = covered.get(result.signature);
        expect(actual.feasible).toBe(result.feasible);
        if (result.feasible)
          expect(actual).toMatchObject({
            deaths: result.deaths,
            costPerHour: result.costPerHour,
            foodUsed: result.foodUsed,
          });
      }
      const ranked = expected.filter((result) => result.feasible).sort(compareFoodOptimizerResults);
      expect(report.topResults.map((result) => result.signature)).toEqual(
        ranked.slice(0, 10).map((result) => result.signature),
      );
      expect(report.stats.screenedCompositions).toBe(countFoodOptimizerCompositions(items, 3));
      expect(report.stats.passedCompositions).toBe(10);
      expect(report.stats.completedCandidates).toBe(candidates.length);
      expect(report.stats.completedRounds).toBeLessThanOrEqual(report.stats.maxSimulationRounds);
      expect(
        report.stats.simulatedCandidates +
          report.stats.reusedCandidates +
          report.stats.skippedCandidates +
          report.stats.prunedCandidates,
      ).toBe(candidates.length);
      expect(calls[0].candidate.slots).toHaveLength(0);
      expect(calls[1].candidate.signature).toBe(buildFoodDefaultCandidate(items.slice(-3)).signature);
      if (!options.reuse) {
        expect(calls.findIndex(({ candidate }) => candidate.slots.length === 1)).toBe(28);
        expect(calls).toHaveLength(candidates.length);
      }
      const firstRegular = calls.find(({ candidate }) => candidate.slots.length === 1);
      expect(firstRegular.costCutoff).toBeGreaterThan(0);
      if (!options.broad) expect(report.topResults[0].costPerHour).toBe(1);
    },
  );

  it('leaves complete mode in its original composition order', async () => {
    const { calls, report } = await searchFor({ searchMode: 'complete', reuse: false });
    expect(calls.slice(0, 4).map(({ candidate }) => candidate.slots.length)).toEqual([0, 1, 2, 3]);
    expect(calls.every((call) => call.costCutoff === undefined)).toBe(true);
    expect(report.complete).toBe(true);
  });

  it('skips the neighborhood when no food is already feasible', async () => {
    const { calls, report } = await searchFor({ emptyFeasible: true });
    expect(calls[0].candidate.slots).toHaveLength(0);
    expect(calls[1].candidate.slots).toHaveLength(1);
    expect(report.complete).toBe(true);
    expect(report.stats.screenedCompositions).toBe(26);
  });

  it.each([1, 4].flatMap((workerLimit) => ['empty', 'default', 'nearby'].map((stage) => ({ workerLimit, stage }))))(
    'cancels during $stage with $workerLimit workers',
    async ({ workerLimit, stage }) => {
      const { report } = await searchFor({
        workerLimit,
        cancelAt: (candidate) =>
          stage === 'empty'
            ? candidate.slots.length === 0
            : candidate.slots.length === 3 &&
              (stage === 'default'
                ? candidate.slots.every((slot) => slot.threshold === 50)
                : candidate.slots.some((slot) => slot.threshold !== 50)),
      });
      expect(report.status).toBe('cancelled');
      expect(report.complete).toBe(false);
      expect(report.stats.completedCandidates).toBeLessThanOrEqual(28);
      expect(report.stats.completedCandidates).toBeLessThan(report.stats.totalCandidates);
    },
  );

  it('cleans up a worker failure during the neighborhood', async () => {
    const { report } = await searchFor({ workerLimit: 4, failNear: true });
    expect(report.status).toBe('error');
    expect(report.error).toBe('neighborhood worker failed');
    expect(report.complete).toBe(false);
  });
});

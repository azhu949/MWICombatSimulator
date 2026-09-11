import { describe, expect, it, vi } from 'vitest';
import {
  compareFoodOptimizerResults,
  generateFoodOptimizerCandidates,
  generateFoodOptimizerCompositionCandidates,
} from '../foodOptimizerDomain.js';
import { materializeFoodOptimizerOutcome } from '../foodOptimizerPruning.js';
import { createFoodOptimizerSearch } from '../foodOptimizerSearch.js';

const item = (hrid, kind, thresholds = [90, 50, 10]) => ({ hrid, kind, restore: 50, price: 1, thresholds });
const catalog = () => [item('health', 'hp'), item('mana-a', 'mp'), item('mana-b', 'mp')];

function outcome(candidate, rejected = '', certifyHealth = false) {
  const slots = candidate?.slots || [];
  const foodUsed = Object.fromEntries(slots.map((slot) => [slot.hrid, slot.kind === 'mp' ? 1 : 0]));
  const costPerHour = 100 + slots.filter((slot) => slot.kind === 'mp').reduce((sum, slot) => sum + slot.threshold, 0);
  const sample = {
    seed: 1,
    deaths: Number(rejected === 'deaths'),
    ranOutOfMana: rejected === 'mana',
    stoppedEarly: Boolean(rejected),
    simulatedTime: 600e9,
    foodUsed,
    costPerHour,
    equivalentThresholds: certifyHealth
      ? slots.map(({ hrid, kind, threshold }) => ({
          hrid,
          kind,
          min: kind === 'hp' ? 1 : threshold,
          max: kind === 'hp' ? 1000 : threshold,
        }))
      : null,
  };
  return {
    ...sample,
    feasible: !rejected,
    rejected,
    roundsCompleted: 1,
    simulatedRounds: 1,
    reusedRounds: 0,
    samples: [sample],
  };
}

function outcomeWithSensitiveFoods(candidate, sensitiveHrids) {
  const slots = candidate?.slots || [];
  const sensitive = (slot) => sensitiveHrids.includes(slot.hrid);
  const result = outcome(candidate);
  const details = {
    foodUsed: Object.fromEntries(slots.map((slot) => [slot.hrid, Number(sensitive(slot))])),
    costPerHour: 100 + slots.filter(sensitive).reduce((sum, slot) => sum + slot.threshold, 0),
    equivalentThresholds: slots.map(({ hrid, kind, threshold }) => ({
      hrid,
      kind,
      min: sensitiveHrids.includes(hrid) ? threshold : 1,
      max: sensitiveHrids.includes(hrid) ? threshold : 1000,
    })),
  };
  Object.assign(result, details);
  Object.assign(result.samples[0], details);
  return result;
}

async function run({
  items = catalog(),
  searchMode = 'top10',
  workerLimit = 1,
  reuse = true,
  baselineDeaths = 0,
  resultFor,
}) {
  const originalItems = structuredClone(items);
  const calls = [];
  const covered = new Map();
  const clients = [];
  let coverageRecords = 0;
  const accept = (candidate, result) => {
    expect(covered.has(candidate.signature)).toBe(false);
    covered.set(candidate.signature, { candidate, result });
  };
  const report = await createFoodOptimizerSearch({
    request: { searchMode, rounds: 1, seeds: [1], payload: { simulationTimeLimit: 600e9 } },
    items,
    foodSlots: 3,
    workerLimit,
    adaptiveWorkers: false,
    reuse,
    onCoverage(coverage) {
      coverageRecords += 1;
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
          if (message.candidate === null) {
            const baseline = outcome(null);
            baseline.deaths = baseline.samples[0].deaths = baselineDeaths;
            return baseline;
          }
          calls.push(message.candidate);
          await Promise.resolve();
          return resultFor(message.candidate);
        },
      };
      clients.push(client);
      return client;
    },
  }).done;
  expect(report.status, report.error).toBe('completed');
  expect(report.complete).toBe(true);
  expect(items).toEqual(originalItems);
  expect(clients).toHaveLength(workerLimit);
  expect(clients.every((client) => client.stop.mock.calls.length)).toBe(true);
  const expected = [...generateFoodOptimizerCandidates(items, 3)];
  expect(covered.size).toBe(expected.length);
  expect(report.stats.completedCandidates).toBe(expected.length);
  expect(report.stats.totalCandidates).toBe(expected.length);
  const feasible = [];
  for (const candidate of expected) {
    const actual = covered.get(candidate.signature);
    const result = resultFor(candidate);
    expect(actual.candidate).toEqual(candidate);
    expect(actual.result).toMatchObject({
      feasible: result.feasible,
      rejected: result.rejected,
      ...(result.feasible ? { deaths: result.deaths, costPerHour: result.costPerHour, foodUsed: result.foodUsed } : {}),
    });
    if (result.feasible) feasible.push({ ...candidate, ...result });
  }
  expect(report.stats.feasibleCandidates).toBe(feasible.length);
  expect(report.topResults.map((result) => result.signature)).toEqual(
    feasible
      .sort(compareFoodOptimizerResults)
      .slice(0, 10)
      .map((result) => result.signature),
  );
  return { calls, coverageRecords, report };
}

describe.each(['complete', 'top10'])('food threshold axis selection in %s mode', (searchMode) => {
  it.each(
    [
      { name: 'feasible MP defaults', kinds: ['hp', 'mp', 'mp'], sensitive: [1, 2] },
      { name: 'HP pressure with inactive mana food', kinds: ['mp', 'hp', 'hp'], sensitive: [1, 2] },
      { name: 'two MP foods with different sensitivity', kinds: ['mp', 'mp', 'hp'], sensitive: [1] },
    ].flatMap((scenario) => [1, 4].map((workerLimit) => ({ ...scenario, workerLimit }))),
  )('compresses wide axes for $name with $workerLimit workers', async ({ kinds, sensitive, workerLimit }) => {
    const items = kinds.map((kind, index) =>
      item(`food-${index}`, kind, index === 0 ? Array.from({ length: 100 }, (_, index) => 100 - index) : [90, 50, 10]),
    );
    const sensitiveHrids = sensitive.map((index) => items[index].hrid);
    const { report, coverageRecords } = await run({
      items,
      searchMode,
      workerLimit,
      resultFor: (candidate) => outcomeWithSensitiveFoods(candidate, sensitiveHrids),
    });
    expect(report.stats.passedCompositions).toBe(report.stats.totalCompositions);
    expect(report.stats.reusedCandidates).toBeGreaterThan(0);
    expect(coverageRecords).toBeLessThan(150);
  });

  it.each([1, 4])('uses relative coverage for differently sized grids with %i workers', async (workerLimit) => {
    const items = [
      item('mana', 'mp'),
      item(
        'health',
        'hp',
        Array.from({ length: 100 }, (_, index) => 100 - index),
      ),
    ];
    const { calls } = await run({
      items,
      searchMode,
      workerLimit,
      resultFor(candidate) {
        const result = outcome(candidate);
        const ranges = candidate.slots.map(({ hrid, kind, threshold }) => {
          const min = kind === 'hp' ? Math.floor((threshold - 1) / 10) * 10 + 1 : threshold;
          return { hrid, kind, min, max: kind === 'hp' ? min + 9 : threshold };
        });
        result.equivalentThresholds = result.samples[0].equivalentThresholds = ranges;
        result.costPerHour = result.samples[0].costPerHour = 100 + ranges.reduce((sum, range) => sum + range.min, 0);
        return result;
      },
    });
    const thresholds = calls
      .filter((candidate) => candidate.slots.length === 2)
      .map((candidate) => items.map((item) => candidate.slots.find((slot) => slot.hrid === item.hrid).threshold));
    // 10 点等效 HP 相当于该网格的 10%，而 1 点 MP 相当于 33%。
    expect(thresholds.slice(0, 3)).toEqual([
      [50, 50],
      [90, 100],
      [50, 100],
    ]);
  });

  it.each([1, 4])('cancels during certified reuse after a feasible default with %i workers', async (workerLimit) => {
    const clients = [];
    let search;
    let cancelledDuringReuse = false;
    search = createFoodOptimizerSearch({
      request: { searchMode, rounds: 1, seeds: [1], payload: { simulationTimeLimit: 600e9 } },
      items: catalog(),
      foodSlots: 3,
      workerLimit,
      adaptiveWorkers: false,
      onCoverage(coverage) {
        if (coverage.items?.length === 3 && coverage.items.find((item) => item.kind === 'hp').thresholds.length > 1) {
          cancelledDuringReuse = true;
          search.cancel();
        }
      },
      workerFactory() {
        const client = {
          stop: vi.fn(),
          async call(message) {
            if (message.type === 'init') return;
            await Promise.resolve();
            return outcomeWithSensitiveFoods(message.candidate, ['mana-a', 'mana-b']);
          },
        };
        clients.push(client);
        return client;
      },
    });
    const report = await search.done;
    expect(cancelledDuringReuse).toBe(true);
    expect(report).toMatchObject({ status: 'cancelled', complete: false });
    expect(report.stats.completedCandidates).toBeLessThan(report.stats.totalCandidates);
    expect(clients).toHaveLength(workerLimit);
    expect(clients.every((client) => client.stop.mock.calls.length)).toBe(true);
  });

  it.each([
    { kinds: ['hp', 'mp', 'mp'], workerLimit: 1 },
    { kinds: ['hp', 'mp', 'mp'], workerLimit: 4 },
    { kinds: ['hp', 'mp', 'hp'], workerLimit: 1 },
    { kinds: ['hp', 'mp', 'hp'], workerLimit: 4 },
  ])(
    'finds a final-leaf optimum despite nonmonotone feasibility ($kinds, $workerLimit workers)',
    async ({ kinds, workerLimit }) => {
      const items = kinds.map((kind, index) => item(`food-${index}`, kind, [100, 75, 50, 25, 10]));
      const { calls, report } = await run({
        items,
        searchMode,
        workerLimit,
        resultFor(candidate) {
          const feasible =
            candidate.slots.length === 3 && candidate.slots.every((slot) => [75, 25, 10].includes(slot.threshold));
          const result = outcome(candidate, feasible ? '' : 'mana');
          const cost = candidate.slots.reduce((sum, slot) => sum + slot.threshold, 0);
          result.costPerHour = result.samples[0].costPerHour = cost;
          return result;
        },
      });
      expect(report.stats.feasibleCandidates).toBe(27);
      expect(report.topResults[0].slots.map((slot) => slot.threshold)).toEqual([10, 10, 10]);
      expect(calls.filter((candidate) => candidate.slots.length === 3).at(-1).signature).toBe(
        report.topResults[0].signature,
      );
    },
  );

  it.each([
    { kinds: ['hp', 'mp', 'mp'], workerLimit: 1 },
    { kinds: ['hp', 'mp', 'mp'], workerLimit: 4 },
    { kinds: ['hp', 'mp', 'hp'], workerLimit: 1 },
    { kinds: ['hp', 'mp', 'hp'], workerLimit: 4 },
  ])(
    'retains death and signature tie-breakers in reused regions ($kinds, $workerLimit workers)',
    async ({ kinds, workerLimit }) => {
      const items = kinds.map((kind, index) => item(`food-${index}`, kind, [100, 50, 20, 10, 1]));
      const { report } = await run({
        items,
        searchMode,
        workerLimit,
        baselineDeaths: 1,
        resultFor(candidate) {
          const mana = candidate.slots.filter((slot) => slot.kind === 'mp');
          const feasible = candidate.slots.length === 3 && mana.every((slot) => slot.threshold !== 50);
          const result = outcome(candidate, feasible ? '' : 'mana', true);
          result.costPerHour = result.samples[0].costPerHour = 100;
          result.deaths = result.samples[0].deaths = mana.some((slot) => slot.threshold !== 1) ? 1 : 0;
          return result;
        },
      });
      expect(report.stats.reusedCandidates).toBeGreaterThan(0);
      expect(report.topResults[0]).toMatchObject({ costPerHour: 100, deaths: 0 });
      expect(
        report.topResults[0].slots.filter((slot) => slot.kind === 'mp').every((slot) => slot.threshold === 1),
      ).toBe(true);
    },
  );

  it.each([1, 4])(
    'cancels while processing a reordered mixed-food composition with %i workers',
    async (workerLimit) => {
      const clients = [];
      let search;
      let cancelledInComposition = false;
      search = createFoodOptimizerSearch({
        request: { searchMode, rounds: 1, seeds: [1], payload: { simulationTimeLimit: 600e9 } },
        items: catalog(),
        foodSlots: 3,
        workerLimit,
        adaptiveWorkers: false,
        onCoverage({ candidate }) {
          if (
            candidate?.slots.length === 3 &&
            candidate.slots.every((slot) => slot.threshold === (slot.kind === 'mp' ? 90 : 50))
          ) {
            cancelledInComposition = true;
            search.cancel();
          }
        },
        workerFactory() {
          const client = {
            stop: vi.fn(),
            async call(message) {
              if (message.type === 'init') return;
              await Promise.resolve();
              return outcome(message.candidate, message.candidate ? 'mana' : '');
            },
          };
          clients.push(client);
          return client;
        },
      });
      const report = await search.done;
      expect(cancelledInComposition).toBe(true);
      expect(report).toMatchObject({ status: 'cancelled', complete: false });
      expect(report.stats.completedCandidates).toBeLessThan(report.stats.totalCandidates);
      expect(clients).toHaveLength(workerLimit);
      expect(clients.every((client) => client.stop.mock.calls.length)).toBe(true);
    },
  );

  it.each([1, 4])(
    'keeps MP choices fixed while varying HP after a mana failure with %i workers',
    async (workerLimit) => {
      const { calls } = await run({
        searchMode,
        workerLimit,
        resultFor: (candidate) =>
          outcome(
            candidate,
            candidate.slots.length && candidate.slots.every((slot) => slot.threshold === 50) ? 'mana' : '',
          ),
      });
      const thresholds = calls
        .filter((candidate) => candidate.slots.length === 3)
        .map((candidate) =>
          ['health', 'mana-a', 'mana-b'].map((hrid) => candidate.slots.find((slot) => slot.hrid === hrid).threshold),
        );
      expect(thresholds.slice(0, 5)).toEqual([
        [50, 50, 50],
        [90, 90, 90],
        [50, 90, 90],
        [10, 90, 90],
        [90, 90, 50],
      ]);
      expect(
        calls.filter((candidate) => candidate.slots.length === 3).some((candidate) => candidate.food[0] === 'mana-b'),
      ).toBe(true);
    },
  );

  it.each([
    { name: 'feasible defaults without evidence', rejected: '', reuse: true },
    { name: 'death failures without evidence', rejected: 'deaths', reuse: true },
    { name: 'disabled reuse', rejected: 'mana', reuse: false },
    { name: 'disabled reuse with wide HP evidence', rejected: 'mana', reuse: false, evidence: 'health' },
    { name: 'equal coverage fractions', rejected: '', reuse: true, evidence: 'point' },
    { name: 'malformed threshold evidence', rejected: '', reuse: true, evidence: 'invalid' },
    { name: 'unrelated threshold evidence', rejected: '', reuse: true, evidence: 'unrelated' },
  ])('retains catalog traversal for $name', async ({ rejected, reuse, evidence }) => {
    const { calls } = await run({
      searchMode,
      reuse,
      resultFor: (candidate) => {
        const result = outcome(
          candidate,
          candidate.slots.length && candidate.slots.every((slot) => slot.threshold === 50) ? rejected : '',
        );
        if (evidence)
          result.equivalentThresholds = result.samples[0].equivalentThresholds =
            evidence === 'unrelated'
              ? [{ hrid: 'not-a-candidate-food', kind: 'mp', min: 1, max: 1000 }]
              : candidate.slots.map(({ hrid, kind, threshold }) => ({
                  hrid,
                  kind,
                  min: evidence === 'health' && kind === 'hp' ? 1 : threshold,
                  max: evidence === 'invalid' ? NaN : evidence === 'health' && kind === 'hp' ? 1000 : threshold,
                }));
        return result;
      },
    });
    const thresholds = calls
      .filter((candidate) => candidate.slots.length === 3)
      .map((candidate) =>
        ['health', 'mana-a', 'mana-b'].map((hrid) => candidate.slots.find((slot) => slot.hrid === hrid).threshold),
      );
    expect(thresholds.slice(0, 5)).toEqual([
      [50, 50, 50],
      [90, 90, 90],
      [90, 90, 50],
      [90, 90, 10],
      [90, 50, 90],
    ]);
  });

  it.each([1, 4])(
    'compresses wide HP regions without losing defaults or changing slot order with %i workers',
    async (workerLimit) => {
      const { coverageRecords } = await run({
        searchMode,
        workerLimit,
        items: [
          item(
            'health',
            'hp',
            Array.from({ length: 1000 }, (_, index) => 1000 - index),
          ),
          ...catalog().slice(1),
        ],
        resultFor: (candidate) =>
          outcome(
            candidate,
            candidate.slots.some((slot) => slot.kind === 'mp' && slot.threshold === 10) ? '' : 'mana',
            true,
          ),
      });
      expect(coverageRecords).toBeLessThan(150);
    },
  );
});

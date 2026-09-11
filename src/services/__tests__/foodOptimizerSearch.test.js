import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFoodOptimizerSearch } from '../foodOptimizerSearch.js';
import { generateFoodOptimizerCandidates, getFoodOptimizerItems } from '../foodOptimizerDomain.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup({ onUpdate, failAfter = Infinity, items, workerLimit = 3 } = {}) {
  const clients = [];
  let active = 0;
  let peak = 0;
  let calls = 0;
  let clock = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => (clock += 200));
  const request = { rounds: 3, seeds: [1, 2, 3], inputSignature: 'input' };
  const search = createFoodOptimizerSearch({
    request,
    items: items || getFoodOptimizerItems({ maxHp: 100, maxMp: 100, thresholdStepPercent: 100 }).slice(0, 5),
    foodSlots: 3,
    workerLimit,
    adaptiveWorkers: false,
    onUpdate,
    workerFactory() {
      const client = {
        stop: vi.fn(),
        async call(data, onProgress) {
          if (data.type === 'init') return;
          const index = calls++;
          active += 1;
          peak = Math.max(peak, active);
          await Promise.resolve();
          active -= 1;
          if (index >= failAfter) throw new Error('failed candidate');
          for (let round = 0; round < 3; round += 1) {
            onProgress?.({ round, progress: 0.5 });
            onProgress?.({ round: round + 1, progress: 0 });
          }
          return {
            feasible: true,
            rejected: '',
            deaths: 0,
            roundsCompleted: 3,
            samples: [1, 2, 3],
            foodUsed: {},
            costPerHour: data.candidate ? data.candidate.food.length : 100,
          };
        },
      };
      clients.push(client);
      return client;
    },
  });
  return { search, clients, peak: () => peak, calls: () => calls };
}

describe('bounded exhaustive food search', () => {
  it('counts actual simulations and reused rounds independently of logical progress', async () => {
    const items = [{ hrid: 'mana', kind: 'mp', restore: 50, price: 1, thresholds: [100, 50] }];
    const client = {
      stop: vi.fn(),
      async call(message, progress) {
        if (message.type === 'init') return;
        const simulatedRounds = message.candidate === null ? 3 : message.candidate.slots[0]?.threshold === 50 ? 1 : 0;
        const reusedRounds = 3 - simulatedRounds;
        progress({
          round: 1,
          progress: 0,
          simulatedRounds: Math.min(1, simulatedRounds),
          reusedRounds: Number(!simulatedRounds),
        });
        progress({ round: 3, progress: 0, simulatedRounds, reusedRounds });
        return {
          feasible: true,
          deaths: 0,
          costPerHour: 1,
          roundsCompleted: 3,
          simulatedRounds,
          reusedRounds,
        };
      },
    };
    const updates = [];
    const report = await createFoodOptimizerSearch({
      request: { rounds: 3 },
      items,
      foodSlots: 1,
      workerLimit: 1,
      workerFactory: () => client,
      onUpdate: (report, progress) => updates.push({ report, progress }),
    }).done;
    expect(report).toMatchObject({
      complete: true,
      stats: { totalCandidates: 3, completedCandidates: 3, simulatedCandidates: 1, reusedCandidates: 2 },
    });
    expect(updates.at(-1).progress.progress).toBe(1);
    expect(client.stop).toHaveBeenCalled();
  });

  it('counts completed baseline rounds even when cancelled before the baseline finishes', async () => {
    let rejectPending;
    let progress;
    const client = {
      stop: () => rejectPending?.(new Error('stopped')),
      call: async (message, onProgress) => {
        if (message.type === 'init') return;
        progress = onProgress;
        return new Promise((resolve, reject) => {
          rejectPending = reject;
        });
      },
    };
    const search = createFoodOptimizerSearch({
      request: { rounds: 3 },
      items: [],
      foodSlots: 0,
      workerLimit: 1,
      workerFactory: () => client,
    });
    await vi.waitFor(() => expect(progress).toBeTypeOf('function'));
    progress({ round: 1, progress: 0 });
    search.cancel();
    const report = await search.done;
    expect(report).toMatchObject({ complete: false, status: 'cancelled', baseline: null });
    expect(report.stats.completedRounds).toBe(1);
  });

  it('prioritizes successful defaults without losing feasible lower thresholds in a failed two-mana-food combination', async () => {
    const calls = [];
    let client;
    const request = {
      rounds: 1,
      seeds: [1],
      resources: { maxMp: 100 },
      inputSignature: 'input',
    };
    const items = [
      { hrid: 'mana-food', kind: 'mp', restore: 20, price: 1, thresholds: [100, 20, 10] },
      { hrid: 'other-mana-food', kind: 'mp', restore: 30, price: 1, thresholds: [100, 30] },
    ];
    client = {
      stop: vi.fn(),
      async call(message) {
        if (message.type === 'init') return;
        calls.push(message.candidate);
        if (message.candidate === null)
          return { deaths: 0, ranOutOfMana: false, roundsCompleted: 1, costPerHour: 0, foodUsed: {} };
        const manaThreshold = message.candidate.slots.find((slot) => slot.hrid === 'mana-food')?.threshold;
        if (manaThreshold != null && manaThreshold !== 10)
          return { rejected: 'mana', deaths: 0, ranOutOfMana: true, roundsCompleted: 1, costPerHour: 0, foodUsed: {} };
        return {
          rejected: '',
          deaths: 0,
          ranOutOfMana: false,
          roundsCompleted: 1,
          feasible: true,
          costPerHour: 2,
          foodUsed: {},
        };
      },
    };
    const search = createFoodOptimizerSearch({
      request,
      items,
      foodSlots: 2,
      workerLimit: 1,
      workerFactory: () => client,
    });
    const report = await search.done;
    const signatures = calls.slice(1).map((candidate) => candidate.signature);
    expect(signatures.slice().sort()).toEqual(
      [...generateFoodOptimizerCandidates(items, 2)].map((candidate) => candidate.signature).sort(),
    );
    expect(new Set(signatures).size).toBe(signatures.length);
    expect(
      report.topResults.some(
        (candidate) =>
          candidate.slots.length === 2 &&
          candidate.slots.some((slot) => slot.hrid === 'mana-food' && slot.threshold === 10),
      ),
    ).toBe(true);
    expect(report.stats.screenedCompositions).toBe(4);
    expect(report.stats.passedCompositions).toBe(2);
    expect(report.stats.completedCandidates).toBe(report.stats.totalCandidates);
    expect(report.complete).toBe(true);
  });

  it('does not prune a composition when its default threshold runs out of mana', async () => {
    const calls = [];
    const request = {
      rounds: 1,
      seeds: [1],
      resources: { maxMp: 100 },
      inputSignature: 'input',
    };
    const items = [{ hrid: 'mana-food', kind: 'mp', restore: 20, price: 1, thresholds: [100, 20] }];
    const client = {
      stop: vi.fn(),
      async call(message) {
        if (message.type === 'init') return;
        calls.push(message.candidate);
        if (message.candidate === null)
          return { deaths: 0, ranOutOfMana: false, roundsCompleted: 1, costPerHour: 0, foodUsed: {} };
        return { rejected: 'mana', deaths: 0, ranOutOfMana: true, roundsCompleted: 1, costPerHour: 0, foodUsed: {} };
      },
    };
    const report = await createFoodOptimizerSearch({
      request,
      items,
      foodSlots: 1,
      workerLimit: 1,
      workerFactory: () => client,
    }).done;
    const dispatched = calls.map((candidate) => candidate?.slots[0]?.threshold);
    expect(dispatched).toContain(20);
    expect(dispatched).toContain(100);
    expect(report.stats.completedCandidates).toBe(report.stats.totalCandidates);
    expect(report.complete).toBe(true);
  });
  it('finishes baseline first, batches candidates, reuses the pool and retains only ten results', async () => {
    const updates = [];
    const { search } = setup({
      onUpdate: (report, progress) => updates.push({ report, progress }),
    });
    const report = await search.done;
    expect(report.complete).toBe(true);
    expect(report.stats.completedCandidates).toBe(report.stats.totalCandidates);
    expect(report.stats.completedRounds).toBe(report.stats.maxSimulationRounds);
    expect(report.topResults).toHaveLength(10);
    expect(report.topResults[0].food).toEqual([]);
    expect(updates.at(-1).progress).toMatchObject({ phase: 'completed', progress: 1 });
  });

  it('can stop during composition screening without expanding a billion threshold candidates', async () => {
    let state;
    state = setup({
      items: getFoodOptimizerItems({ maxHp: 10000, maxMp: 10000, thresholdStepPercent: 1 }),
      workerLimit: 1,
      onUpdate(report) {
        if (report.stats.completedCandidates === 4) state.search.cancel();
      },
    });
    const report = await state.search.done;
    expect(report.stats.totalCandidates).toBeGreaterThan(1_000_000_000);
    expect(report).toMatchObject({ status: 'cancelled', complete: false });
  });

  it('preserves complete candidates when stopped and does not claim optimality', async () => {
    let state;
    state = setup({
      onUpdate(report) {
        if (report.stats.completedCandidates >= 4) state.search.cancel();
      },
    });
    const report = await state.search.done;
    expect(report.status).toBe('cancelled');
    expect(report.complete).toBe(false);
    expect(report.topResults.length).toBeGreaterThan(0);
    expect(report.topResults.every((entry) => entry.roundsCompleted === 3)).toBe(true);
    expect(report.stats.completedCandidates).toBeLessThan(report.stats.totalCandidates);
  });

  it.each([5, 30])(
    'terminates all workers and preserves partial results on an exception at call %i',
    async (failAfter) => {
      const { search } = setup({ failAfter });
      const report = await search.done;
      expect(report).toMatchObject({ status: 'error', complete: false, error: 'failed candidate' });
      expect(report.topResults.length).toBeGreaterThan(0);
    },
  );

  it.each([false, true])(
    'uses certified pruning across the pool and releases it on completion or cancellation (%s)',
    async (cancel) => {
      const items = ['mana', 'health', 'other-mana'].map((hrid, index) => ({
        hrid,
        kind: index === 1 ? 'hp' : 'mp',
        restore: 50,
        price: index + 1,
        thresholds: [100, 50, 20, 10],
      }));
      const evaluate = (candidate) => {
        const common = { foodUsed: {}, samples: [1, 2, 3], roundsCompleted: 3, deaths: 0 };
        if (!candidate) return { ...common, feasible: true, costPerHour: 1000 };
        if (candidate.slots.some((slot) => slot.hrid === 'mana' && slot.threshold >= 50))
          return {
            ...common,
            feasible: false,
            rejected: 'mana',
            roundsCompleted: 1,
            samples: [1],
            equivalentThresholds: candidate.slots.map(({ hrid, kind }) => ({
              hrid,
              kind,
              min: hrid === 'mana' ? 50 : 1,
              max: 100,
            })),
          };
        const costPerHour = candidate.slots.reduce((sum, slot) => sum + slot.price + (100 - slot.threshold) / 10, 0);
        return {
          ...common,
          costPerHour,
          rejected: '',
          feasible: true,
          deaths: candidate.slots.length % 2,
          equivalentThresholds: candidate.slots.map(({ hrid, kind, threshold }) => ({
            hrid,
            kind,
            min: threshold,
            max: threshold,
          })),
        };
      };
      const clients = [];
      let active = 0;
      let peak = 0;
      let calls = 0;
      let clock = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => (clock += 200));
      let search;
      search = createFoodOptimizerSearch({
        request: { rounds: 3 },
        items,
        foodSlots: 3,
        workerLimit: 3,
        adaptiveWorkers: false,
        onUpdate(report) {
          if (cancel && report.stats.skippedCandidates > 0) search.cancel();
        },
        workerFactory() {
          const client = {
            stop: vi.fn(),
            async call(message, progress) {
              if (message.type === 'init') return;
              calls += 1;
              active += 1;
              peak = Math.max(peak, active);
              await Promise.resolve();
              active -= 1;
              const result = evaluate(message.candidate);
              progress?.({ round: result.roundsCompleted, progress: 0 });
              return result;
            },
          };
          clients.push(client);
          return client;
        },
      });
      const report = await search.done;
      expect(report.status).toBe(cancel ? 'cancelled' : 'completed');
      expect(report.complete).toBe(!cancel);
      expect(report.stats.skippedCandidates).toBeGreaterThan(0);
      if (cancel) return;
      expect(report.stats.completedCandidates).toBe(report.stats.totalCandidates);
      expect(report.topResults.length).toBeGreaterThan(0);
    },
  );
});

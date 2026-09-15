import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFoodOptimizerSearch, FoodOptimizerWorkerClient } from '../foodOptimizerSearch.js';
import {
  compareFoodOptimizerResults,
  generateFoodOptimizerCandidates,
  getFoodOptimizerItems,
} from '../foodOptimizerDomain.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// 夹具必须跨烹饪线（每件自成一类）：优化器把同一条烹饪线（甜甜圈/蛋糕/软糖/酸奶）
// 视为一类、每个候选最多占一个槽位；目录前几项全是甜甜圈线，直接截取会让搜索空间塌缩。
// probe-* 是不在目录里的假 hrid（没有官方烹饪分类），按 fail-open 各自成一类；
// 尾缀只是可读标记，不参与分族判定。
function spanCookingFamilies(items) {
  const suffixes = ['_donut', '_cake', '_gummy', '_yogurt', ''];
  return items.map((item, index) => ({ ...item, hrid: `probe-${index}${suffixes[index]}` }));
}

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
    items:
      items ||
      spanCookingFamilies(getFoodOptimizerItems({ maxHp: 100, maxMp: 100, thresholdStepPercent: 100 }).slice(0, 5)),
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
      stats: {
        totalCandidates: 3,
        completedCandidates: 3,
        simulatedCandidates: 1,
        reusedCandidates: 2,
        completedRounds: 4,
        reusedRounds: 8,
      },
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
    expect(calls[0]).toBeNull();
    expect(calls.slice(1, 5).map((candidate) => candidate.slots.map((slot) => slot.threshold))).toEqual([
      [],
      [20],
      [30, 20],
      [30],
    ]);
    expect(calls[5].slots).toMatchObject([{ hrid: 'other-mana-food', threshold: 100 }]);
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
    expect(calls.map((candidate) => candidate?.slots[0]?.threshold)).toEqual([undefined, undefined, 20, 100]);
    expect(report.stats.screenedCompositions).toBe(2);
    expect(report.stats.passedCompositions).toBe(0);
    expect(report.stats.completedCandidates).toBe(report.stats.totalCandidates);
    expect(report.complete).toBe(true);
  });
  it('finishes baseline first, batches candidates, reuses the pool and retains only ten results', async () => {
    const updates = [];
    const { search, clients, peak, calls } = setup({
      onUpdate: (report, progress) => updates.push({ report, progress }),
    });
    const report = await search.done;
    expect(report.complete).toBe(true);
    expect(report.stats.completedCandidates + 1).toBe(calls());
    expect(report.stats.completedCandidates).toBe(report.stats.totalCandidates);
    expect(report.stats.completedRounds).toBe(report.stats.maxSimulationRounds);
    expect(report.stats.screenedCompositions).toBe(report.stats.totalCompositions);
    expect(report.topResults).toHaveLength(10);
    expect(report.topResults[0].food).toEqual([]);
    expect(clients).toHaveLength(3);
    expect(peak()).toBeLessThanOrEqual(3);
    expect(clients.every((client) => client.stop.mock.calls.length)).toBe(true);
    expect(updates.at(-1).progress).toMatchObject({ phase: 'completed', progress: 1 });
    expect(updates.map(({ progress }) => progress.phase)).toContain('screening');
    expect(updates.every(({ report }) => report.topResults.length <= 10)).toBe(true);
    expect(
      updates.every(({ progress }, index) => index === 0 || progress.progress >= updates[index - 1].progress.progress),
    ).toBe(true);
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
    // 全目录（28 件）分 4 条烹饪线、每类最多 1 件：组合数 = Σ C(4,s)·7^s (s≤3)
    // = 1 + 28 + 294 + 1372 = 1695（旧口径每件独立成轴时为 C(28,0..3) = 3683）。
    expect(report.stats.totalCompositions).toBe(1695);
    expect(report.stats.completedCandidates).toBe(4);
    expect(state.calls()).toBe(5);
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
    expect(state.clients.every((client) => client.stop.mock.calls.length)).toBe(true);
  });

  it('preserves screening results when cancelled during threshold search', async () => {
    let state;
    state = setup({
      onUpdate(report, progress) {
        if (progress.phase === 'searching' && report.stats.completedCandidates > report.stats.totalCompositions)
          state.search.cancel();
      },
    });
    const report = await state.search.done;
    expect(report).toMatchObject({ status: 'cancelled', complete: false });
    expect(report.stats.screenedCompositions).toBe(report.stats.totalCompositions);
    expect(report.stats.completedCandidates).toBeGreaterThan(report.stats.totalCompositions);
    expect(report.stats.completedCandidates).toBeLessThan(report.stats.totalCandidates);
    expect(report.topResults).toHaveLength(10);
    expect(state.clients).toHaveLength(3);
    expect(state.clients.every((client) => client.stop.mock.calls.length)).toBe(true);
  });

  it.each([5, 30])(
    'terminates all workers and preserves partial results on an exception at call %i',
    async (failAfter) => {
      const { search, clients } = setup({ failAfter });
      const report = await search.done;
      expect(report).toMatchObject({ status: 'error', complete: false, error: 'failed candidate' });
      expect(report.topResults.length).toBeGreaterThan(0);
      expect(clients.every((client) => client.stop.mock.calls.length)).toBe(true);
    },
  );

  it('settles pending RPCs and ignores late replies after termination', async () => {
    const worker = { postMessage: vi.fn(), terminate: vi.fn() };
    vi.stubGlobal(
      'Worker',
      vi.fn(() => worker),
    );
    const client = new FoodOptimizerWorkerClient();
    const pending = client.call({ type: 'evaluate' });
    client.stop();
    await expect(pending).rejects.toThrow('stopped');
    expect(worker.terminate).toHaveBeenCalledOnce();
    worker.onmessage({ data: { type: 'result', result: 'late' } });
    expect(client.pending).toBeNull();
  });

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
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(3);
      expect(clients.every((client) => client.stop.mock.calls.length > 0)).toBe(true);
      expect(report.stats.skippedCandidates).toBeGreaterThan(0);
      expect(report.stats.simulatedCandidates + report.stats.skippedCandidates + report.stats.reusedCandidates).toBe(
        report.stats.completedCandidates,
      );
      if (cancel) return;
      const expected = [...generateFoodOptimizerCandidates(items, 3)]
        .map((candidate) => ({
          ...candidate,
          ...evaluate(candidate),
          savingsPerHour: 1000 - evaluate(candidate).costPerHour,
        }))
        .filter((result) => result.feasible)
        .sort(compareFoodOptimizerResults);
      expect(report.topResults).toEqual(expected.slice(0, 10));
      expect(report.stats.feasibleCandidates).toBe(expected.length);
      expect(report.stats.completedCandidates).toBe(report.stats.totalCandidates);
      expect(calls).toBeLessThan(report.stats.totalCandidates + 1);
    },
  );
  it('keeps all workers occupied even when a phase has fewer than one old batch of candidates', async () => {
    // 两件夹具必须分属两条烹饪线（甜甜圈 + 蛋糕），否则同类互斥会把候选数压到 3。
    const items = getFoodOptimizerItems({ maxHp: 100, maxMp: 100, thresholdStepPercent: 100 })
      .slice(0, 2)
      .map((item, index) => ({
        ...item,
        restore: 100,
        thresholds: [100],
        hrid: `probe-${index}${index === 0 ? '_donut' : '_cake'}`,
      }));
    const { search, peak } = setup({ items, workerLimit: 3 });
    const report = await search.done;
    expect(report.stats.totalCandidates).toBe(4);
    expect(report.complete).toBe(true);
    expect(peak()).toBe(3);
  });

  it('can cancel during bulk reuse of feasible results while retaining completed rankings', async () => {
    const items = spanCookingFamilies(
      getFoodOptimizerItems({ maxHp: 10000, maxMp: 10000, thresholdStepPercent: 1 }).slice(0, 3),
    );
    let calls = 0;
    let clock = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => (clock += 200));
    const result = {
      feasible: true,
      rejected: '',
      ranOutOfMana: false,
      deaths: 0,
      roundsCompleted: 3,
      costPerHour: 0,
      foodUsed: {},
      unusedFoodThresholds: { hp: 1, mp: 1 },
      samples: [1, 2, 3].map((seed) => ({
        seed,
        foodUsed: {},
        costPerHour: 0,
        stoppedEarly: false,
        ranOutOfMana: false,
        unusedFoodThresholds: { hp: 1, mp: 1 },
      })),
    };
    const client = {
      stop: vi.fn(),
      async call(message) {
        if (message.type === 'init') return;
        calls += 1;
        return structuredClone(result);
      },
    };
    let search;
    search = createFoodOptimizerSearch({
      request: { rounds: 3 },
      items,
      foodSlots: 3,
      workerLimit: 1,
      workerFactory: () => client,
      onUpdate(report, progress) {
        if (progress.phase === 'searching' && report.stats.completedCandidates > report.stats.totalCompositions)
          search.cancel();
      },
    });
    const report = await search.done;
    expect(report).toMatchObject({ status: 'cancelled', complete: false });
    expect(calls).toBe(2);
    expect(report.stats.totalCandidates).toBeGreaterThan(1000000);
    expect(report.stats.reusedCandidates).toBeGreaterThan(0);
    expect(report.stats.completedCandidates).toBeLessThan(report.stats.totalCandidates);
    expect(report.topResults.length).toBeGreaterThan(0);
    expect(report.topResults.every((candidate) => candidate.feasible && candidate.roundsCompleted === 3)).toBe(true);
    expect(client.stop).toHaveBeenCalled();
  });
});

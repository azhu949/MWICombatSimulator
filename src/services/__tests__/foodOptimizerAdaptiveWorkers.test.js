import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compareFoodOptimizerResults, generateFoodOptimizerCandidates } from '../foodOptimizerDomain.js';
import { createFoodOptimizerSearch } from '../foodOptimizerSearch.js';
import { createFoodOptimizerWorkerPolicy } from '../foodOptimizerWorkerPolicy.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

function outcome(candidate, rounds = 1, rejected = '') {
  const foodUsed = Object.fromEntries((candidate?.slots || []).map((slot) => [slot.hrid, slot.threshold]));
  const samples = Array.from({ length: rejected ? 1 : rounds }, (_, index) => ({
    seed: index + 1,
    deaths: rejected === 'deaths' ? 1 : 0,
    ranOutOfMana: rejected === 'mana',
    stoppedEarly: Boolean(rejected),
    simulatedTime: rejected ? 200e9 : 600e9,
    foodUsed,
    costPerHour: candidate ? Object.values(foodUsed).reduce((sum, value) => sum + value, 0) : 1000,
    equivalentThresholds: null,
    unusedFoodThresholds: null,
    inactiveFoodThresholds: null,
  }));
  return {
    ...samples[0],
    samples,
    roundsCompleted: samples.length,
    simulatedRounds: samples.length,
    reusedRounds: 0,
    feasible: !rejected,
    rejected,
  };
}

function setup({
  rounds = 1,
  candidateMs = 100,
  candidateProgress,
  baselineMs = 100,
  initialMs = 100,
  extraInitMs = initialMs,
  thresholds = 60,
  workerLimit = 4,
  failExtraInit = false,
  failInitWorker = 1,
  cancelDuringInit = false,
  cancelDuringEvaluation = false,
  resolveInitAfterStop = false,
  rejectCandidate = () => '',
} = {}) {
  const items = [
    {
      hrid: 'food',
      kind: 'mp',
      price: 1,
      restore: thresholds,
      thresholds: Array.from({ length: thresholds }, (_, index) => thresholds - index),
    },
  ];
  const state = {
    rounds,
    clients: [],
    calls: [],
    events: [],
    updates: [],
    progressCallbacks: [],
    initializing: 0,
    maxInitializing: 0,
    active: 0,
    peak: 0,
    covered: new Map(),
  };
  state.outcome = (candidate) => outcome(candidate, rounds, candidate ? rejectCandidate(candidate) : '');
  state.search = createFoodOptimizerSearch({
    request: {
      activePlayerId: '1',
      rounds,
      seeds: Array.from({ length: rounds }, (_, index) => index + 1),
      payload: {
        players: [{ hrid: 'player1', food: [{ hrid: 'original' }] }],
        simulationTimeLimit: 600e9,
      },
    },
    items,
    foodSlots: 1,
    workerLimit,
    now: () => Date.now(),
    onUpdate(report, progress) {
      state.updates.push({ report, progress });
    },
    onCoverage({ candidate, result }) {
      expect(candidate).toBeDefined();
      expect(state.covered.has(candidate.signature)).toBe(false);
      state.covered.set(candidate.signature, result);
    },
    workerFactory() {
      const index = state.clients.length;
      let pending = null;
      const client = {
        stop: vi.fn((error = new Error('stopped')) => {
          if (!pending || (pending.init && resolveInitAfterStop)) return;
          pending.finish(error);
        }),
        call(message, progress) {
          expect(pending).toBeNull();
          const init = message.type === 'init';
          const candidate = message.candidate;
          const label = init ? 'init' : candidate === null ? 'baseline' : 'candidate';
          const delay = init
            ? index
              ? extraInitMs
              : initialMs
            : candidate === null
              ? baselineMs
              : typeof candidateMs === 'function'
                ? candidateMs(candidate)
                : candidateMs;
          const result = init ? null : state.outcome(candidate);
          const emitProgress = (round, fraction = 0) => {
            const update = {
              round,
              progress: fraction,
              simulatedRounds: round,
              reusedRounds: 0,
              ...(fraction === 0 && round === result.roundsCompleted && result.rejected
                ? { rejected: result.rejected }
                : {}),
            };
            const event = {
              event: `${label}-progress`,
              worker: index,
              at: Date.now(),
              signature: candidate?.signature,
              workersBefore: state.clients.length,
              ...update,
            };
            state.events.push(event);
            progress?.(update);
            event.workersAfter = state.clients.length;
          };
          state.events.push({
            event: `${label}-start`,
            worker: index,
            at: Date.now(),
            signature: candidate?.signature,
          });
          if (init) {
            state.initializing++;
            state.maxInitializing = Math.max(state.maxInitializing, state.initializing);
          } else {
            state.active++;
            state.peak = Math.max(state.peak, state.active);
            state.calls.push({ worker: index, candidate });
            state.progressCallbacks.push(progress);
          }
          return new Promise((resolve, reject) => {
            const timers = new Set();
            const schedule = (callback, wait) => {
              const timer = setTimeout(() => {
                timers.delete(timer);
                callback();
              }, wait);
              timers.add(timer);
            };
            const finish = (error) => {
              if (pending?.finish !== finish) return;
              for (const timer of timers) clearTimeout(timer);
              timers.clear();
              pending = null;
              if (init) state.initializing--;
              else state.active--;
              state.events.push({
                event: `${label}-${error ? 'error' : 'end'}`,
                worker: index,
                at: Date.now(),
                signature: candidate?.signature,
              });
              if (error) reject(error);
              else if (init) resolve();
              else {
                emitProgress(result.roundsCompleted);
                resolve(result);
              }
            };
            pending = { init, timers, finish };
            if (!init) {
              const intermediate =
                (candidate && candidateProgress?.(candidate)) ??
                Array.from({ length: result.roundsCompleted - 1 }, (_, index) => ({
                  round: index + 1,
                  afterMs: (delay * (index + 1)) / result.roundsCompleted,
                }));
              for (const update of intermediate)
                schedule(() => emitProgress(update.round, update.progress), update.afterMs);
            }
            if ((init && index > 0 && cancelDuringInit) || (candidate && index > 0 && cancelDuringEvaluation))
              schedule(() => {
                state.events.push({ event: 'cancel', worker: index, at: Date.now() });
                state.search.cancel();
              }, delay / 2);
            schedule(
              () => finish(init && index === failInitWorker && failExtraInit ? new Error('init failed') : null),
              delay,
            );
          });
        },
      };
      state.clients.push(client);
      return client;
    },
  });
  state.expected = [...generateFoodOptimizerCandidates(items, 1)].map((candidate) => ({
    ...candidate,
    ...state.outcome(candidate),
  }));
  return state;
}

async function finish(state) {
  await vi.runAllTimersAsync();
  const report = await state.search.done;
  expect(state.clients.every((client) => client.stop.mock.calls.length > 0)).toBe(true);
  expect(state.active).toBe(0);
  expect(state.initializing).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(state.updates.at(-1).report.status).toBe(report.status);
  const progress = state.updates.map((update) => update.progress.progress);
  expect(progress).toEqual([...progress].sort((a, b) => a - b));
  return report;
}

function expectComplete(state, report) {
  const feasible = state.expected.filter((candidate) => candidate.feasible);
  expect(report.status, report.error).toBe('completed');
  expect(report.complete).toBe(true);
  expect(report.stats).toMatchObject({
    completedCandidates: state.expected.length,
    simulatedCandidates: state.expected.length,
    feasibleCandidates: feasible.length,
    completedRounds: state.rounds + state.expected.reduce((sum, candidate) => sum + candidate.roundsCompleted, 0),
    reusedRounds: 0,
    rejectedMana: state.expected.filter((candidate) => candidate.rejected === 'mana').length,
    rejectedDeaths: state.expected.filter((candidate) => candidate.rejected === 'deaths').length,
  });
  expect(state.covered).toEqual(
    new Map(state.expected.map((candidate) => [candidate.signature, state.outcome(candidate)])),
  );
  const ranked = (result) => ({ signature: result.signature, samples: result.samples });
  expect(report.topResults.map(ranked)).toEqual(feasible.sort(compareFoodOptimizerResults).slice(0, 10).map(ranked));
  expect(state.updates.at(-1).progress.progress).toBe(1);
}

function recordSimulations(policy, count, durationMs) {
  for (let index = 0; index < count; index += 1) policy.record({ durationMs, simulated: true });
}

const context = (overrides = {}) => ({ workers: 1, workerLimit: 4, remainingCandidates: 1000, ...overrides });
const observation = (overrides = {}) => ({ durationMs: 100, simulatedRounds: 1, plannedRounds: 3, ...overrides });
const shouldGrow = (policy, overrides) => policy.shouldGrow(context(overrides));

describe('adaptive food worker scheduling', () => {
  it('keeps short work on one worker even after a very slow baseline', async () => {
    const state = setup({ candidateMs: 1, baselineMs: 10000 });
    const report = await finish(state);
    expectComplete(state, report);
    expect(state.clients).toHaveLength(1);
  });

  it('grows CPU-heavy work while existing workers keep running, preserving every candidate', async () => {
    const state = setup({ extraInitMs: 200 });
    const report = await finish(state);
    expectComplete(state, report);
    expect(state.clients).toHaveLength(4);
    const starting = state.events.find((event) => event.event === 'init-start' && event.worker === 1);
    const ready = state.events.find((event) => event.event === 'init-end' && event.worker === 1);
    expect(
      state.events.some(
        (event) =>
          event.event === 'candidate-start' && event.worker === 0 && event.at >= starting.at && event.at < ready.at,
      ),
    ).toBe(true);
  });

  it.each([2, 3, 4])('keeps ready and starting workers within a limit of %i', async (workerLimit) => {
    const state = setup({ candidateMs: 150, extraInitMs: 150, workerLimit, thresholds: 90 });
    const report = await finish(state);
    expectComplete(state, report);
    expect(state.clients).toHaveLength(workerLimit);
  });

  it('finishes when the first worker drains the phase before a late initialization completes', async () => {
    const state = setup({ initialMs: 50, extraInitMs: 2000, thresholds: 12 });
    const report = await finish(state);
    expectComplete(state, report);
    expect(state.clients).toHaveLength(2);
    expect(state.calls.every((call) => call.worker === 0)).toBe(true);
  });

  it('preserves the original initialization failure while stopping every worker', async () => {
    const state = setup({ failExtraInit: true, extraInitMs: 300 });
    const report = await finish(state);
    expect(report).toMatchObject({ status: 'error', complete: false, error: 'init failed' });
    expect(state.clients).toHaveLength(2);
    expect(report.stats.completedCandidates).toBeLessThan(report.stats.totalCandidates);
  });

  it.each([150, 200, 250])(
    'does not replace a failed starting worker while other runners finish (%i ms)',
    async (extraInitMs) => {
      const state = setup({ failExtraInit: true, failInitWorker: 2, extraInitMs, thresholds: 90 });
      const report = await finish(state);
      expect(report).toMatchObject({ status: 'error', complete: false, error: 'init failed' });
      expect(state.clients).toHaveLength(3);
      const failedAt = state.events.findIndex((event) => event.event === 'init-error' && event.worker === 2);
      expect(failedAt).toBeGreaterThan(-1);
      expect(state.events.slice(failedAt + 1).some((event) => event.event === 'init-start')).toBe(false);
    },
  );

  it.each([false, true])(
    'cancels during initialization and ignores late readiness (late resolution: %s)',
    async (resolveInitAfterStop) => {
      const state = setup({ cancelDuringInit: true, resolveInitAfterStop, extraInitMs: 300 });
      const report = await finish(state);
      expect(report).toMatchObject({ status: 'cancelled', complete: false });
      expect(state.clients).toHaveLength(2);
      expect(state.calls.every((call) => call.worker === 0)).toBe(true);
      const stats = structuredClone(report.stats);
      for (const progress of state.progressCallbacks)
        progress?.({ round: 1, progress: 1, simulatedRounds: 100, reusedRounds: 100 });
      expect(report.stats).toEqual(stats);
    },
  );

  it('cancels after expansion without leaving an evaluation or another initialization pending', async () => {
    const state = setup({ cancelDuringEvaluation: true });
    const report = await finish(state);
    expect(report).toMatchObject({ status: 'cancelled', complete: false });
    expect(state.clients.length).toBeGreaterThan(1);
    expect(state.clients.length).toBeLessThanOrEqual(4);
    expect(report.stats.completedCandidates).toBeLessThan(report.stats.totalCandidates);
  });
});

const slowVariants = (candidate) => (candidate.slots.some((slot) => slot.threshold !== slot.restore) ? 900 : 1);

describe('adaptive food workers during multi-round candidates', () => {
  it('starts the remaining workers after the first slow round while the original worker continues', async () => {
    const state = setup({ rounds: 3, initialMs: 200, candidateMs: slowVariants });
    const report = await finish(state);
    expectComplete(state, report);
    expect(state.clients).toHaveLength(4);

    const round = state.events.find(
      (event) => event.event === 'candidate-progress' && event.signature === 'food@mp:59' && event.round === 1,
    );
    expect(round).toMatchObject({ worker: 0 });
  });

  it.each([false, true])(
    'cancels an initializing batch and ignores late readiness (late resolution: %s)',
    async (resolveInitAfterStop) => {
      const state = setup({
        rounds: 3,
        initialMs: 200,
        candidateMs: slowVariants,
        cancelDuringInit: true,
        resolveInitAfterStop,
      });
      const report = await finish(state);
      expect(report).toMatchObject({ status: 'cancelled', complete: false });
      const cancelAt = state.events.findIndex((event) => event.event === 'cancel');
      expect(cancelAt).toBeGreaterThan(-1);
      const afterCancel = state.events.slice(cancelAt + 1);
      expect(afterCancel.some((event) => event.event === 'candidate-progress' || event.event === 'init-start')).toBe(
        false,
      );
      const stats = structuredClone(report.stats);
      for (const progress of state.progressCallbacks)
        progress?.({ round: 2, progress: 1, simulatedRounds: 100, reusedRounds: 100 });
      expect(report.stats).toEqual(stats);
    },
  );

  it('waits for a confirmed round boundary instead of expanding from raw in-round progress', async () => {
    const state = setup({
      rounds: 3,
      initialMs: 200,
      candidateMs: slowVariants,
      candidateProgress: (candidate) =>
        candidate.slots[0]?.threshold === 59
          ? [
              { round: 1, afterMs: 40 },
              { round: 1, progress: 0.5, afterMs: 300 },
              { round: 2, afterMs: 600 },
            ]
          : null,
    });
    const report = await finish(state);
    expectComplete(state, report);
    const updates = state.events.filter(
      (event) => event.event === 'candidate-progress' && event.signature === 'food@mp:59',
    );
    const expanded = updates.filter((event) => event.workersAfter > event.workersBefore);
    expect(expanded).toHaveLength(1);
    expect(expanded[0]).toMatchObject({ round: 2, progress: 0 });
    expect(state.clients.length).toBeGreaterThan(1);
  });

  it.each([false, true])(
    'preserves a batch initialization failure and clears running and starting work (late resolution: %s)',
    async (resolveInitAfterStop) => {
      const state = setup({
        rounds: 3,
        initialMs: 200,
        candidateMs: slowVariants,
        failExtraInit: true,
        failInitWorker: 2,
        resolveInitAfterStop,
      });
      const report = await finish(state);
      expect(report).toMatchObject({ status: 'error', complete: false, error: 'init failed' });
      expect(state.clients).toHaveLength(4);
      expect(state.maxInitializing).toBe(3);
      expect(state.peak).toBeLessThanOrEqual(4);
      expect(report.stats.completedCandidates).toBeLessThan(report.stats.totalCandidates);
      const failedAt = state.events.findIndex((event) => event.event === 'init-error' && event.worker === 2);
      expect(failedAt).toBeGreaterThan(-1);
      expect(state.events.slice(failedAt + 1).some((event) => event.event === 'init-start')).toBe(false);
      expect(state.events.slice(failedAt + 1).some((event) => event.event === 'candidate-progress')).toBe(false);
      expect(state.calls.some((call) => call.worker === 2 || call.worker === 3)).toBe(false);
    },
  );

  it.each(['mana', 'deaths'])('does not expand from a terminal %s progress update', async (rejected) => {
    const fails = (candidate) => candidate.slots[0]?.threshold === 59;
    const state = setup({
      rounds: 3,
      initialMs: 200,
      candidateMs: (candidate) => (fails(candidate) ? 900 : 1),
      rejectCandidate: (candidate) => (fails(candidate) ? rejected : ''),
    });
    const report = await finish(state);
    expectComplete(state, report);
    const terminal = state.events.find((event) => event.event === 'candidate-progress' && event.rejected === rejected);
    expect(terminal).toMatchObject({
      signature: 'food@mp:59',
      round: 1,
      simulatedRounds: 1,
      workersBefore: 1,
      workersAfter: 1,
    });
    expect(state.clients.length).toBeLessThanOrEqual(4);
  });

  it('keeps a slow multi-round baseline outside the growth policy', async () => {
    const state = setup({ rounds: 3, initialMs: 200, baselineMs: 10000, candidateMs: 1 });
    const report = await finish(state);
    expectComplete(state, report);
    expect(state.clients).toHaveLength(1);
    expect(state.events.filter((event) => event.event === 'baseline-progress').map((event) => event.round)).toEqual([
      1, 2, 3,
    ]);
  });
});

describe('adaptive food optimizer worker policy', () => {
  it('keeps short tasks serial despite a large nominal candidate count', () => {
    const policy = createFoodOptimizerWorkerPolicy();
    policy.recordInitialization(100);
    recordSimulations(policy, 8, 2);

    expect(shouldGrow(policy, { remainingCandidates: 1_000_000 })).toBe(false);
  });

  it('discounts a cache-heavy workload instead of extrapolating only the slow simulated candidates', () => {
    const dense = createFoodOptimizerWorkerPolicy();
    const cacheHeavy = createFoodOptimizerWorkerPolicy();
    for (const policy of [dense, cacheHeavy]) {
      policy.recordInitialization(100);
      recordSimulations(policy, 4, 100);
    }
    for (let index = 0; index < 24; index += 1) cacheHeavy.record();

    expect(shouldGrow(dense, { remainingCandidates: 10 })).toBe(true);
    expect(shouldGrow(cacheHeavy, { remainingCandidates: 10 })).toBe(false);
  });

  it('accounts for the logical coverage of a reused block rather than treating it as one ordinary candidate', () => {
    const policy = createFoodOptimizerWorkerPolicy();
    policy.recordInitialization(100);
    recordSimulations(policy, 4, 100);
    expect(shouldGrow(policy, { remainingCandidates: 1_000_000 })).toBe(true);

    policy.record({ coveredCandidates: 1_000_000_000 });
    expect(shouldGrow(policy, { remainingCandidates: 1_000_000 })).toBe(false);
  });

  it.each([
    ['another worker is initializing', { pendingWorkers: 1 }],
    ['multiple workers are already reserved', { pendingWorkers: 2 }],
    ['the configured worker limit is reached', { workers: 4 }],
    ['the limit was lowered below the active pool', { workers: 3, workerLimit: 2 }],
    ['there is no active worker to extend', { workers: 0 }],
    ['the pending work is exhausted', { remainingCandidates: 0 }],
  ])('does not grow when %s, even with expensive work in its history', (_reason, options) => {
    const policy = createFoodOptimizerWorkerPolicy();
    policy.recordInitialization(100);
    recordSimulations(policy, 4, 500);
    expect(shouldGrow(policy)).toBe(true);

    expect(shouldGrow(policy, options)).toBe(false);
    expect(policy.workersToStart(context(options), observation({ durationMs: 1000 }))).toBe(0);
  });

  it('stops extrapolating old expensive simulations once recent work is entirely reusable', () => {
    const policy = createFoodOptimizerWorkerPolicy();
    policy.recordInitialization(100);
    recordSimulations(policy, 4, 1000);
    expect(shouldGrow(policy)).toBe(true);

    for (let index = 0; index < 32; index += 1) policy.record();
    expect(shouldGrow(policy)).toBe(false);
  });
});

describe('growth during an unfinished food candidate', () => {
  it('can fill the remaining worker capacity after a real round without waiting for two complete candidates', () => {
    const policy = createFoodOptimizerWorkerPolicy();
    policy.recordInitialization(100);

    expect(shouldGrow(policy)).toBe(false);
    expect(policy.workersToStart(context(), observation())).toBeGreaterThan(0);
    // A progress observation estimates future work; it is not completed work
    // credited to the ordinary growth budget.
    expect(shouldGrow(policy)).toBe(false);
  });

  it('can grow the first long candidate after a cache hit without adding observations to completed history or budget', () => {
    const policy = createFoodOptimizerWorkerPolicy();
    policy.recordInitialization(100);
    policy.record();
    expect(shouldGrow(policy)).toBe(false);

    const remaining = context({ remainingCandidates: 30 });
    const running = observation({ durationMs: 10000 });
    expect(policy.workersToStart(remaining, running)).toBeGreaterThan(0);
    expect(policy.workersToStart(remaining, running)).toBeGreaterThan(0);
    expect(shouldGrow(policy)).toBe(false);
  });

  it.each([
    ['a missing observation', undefined],
    ['no completed real round', observation({ simulatedRounds: 0, durationMs: 10000 })],
    ['a fractional completed-round count', observation({ simulatedRounds: 0.5 })],
    ['a nonfinite completed-round count', observation({ simulatedRounds: Infinity })],
    ['a missing elapsed time', { simulatedRounds: 1, plannedRounds: 3 }],
    ['negative elapsed time', observation({ durationMs: -100 })],
    ['nonfinite elapsed time', observation({ durationMs: Infinity })],
    ['NaN elapsed time', observation({ durationMs: NaN })],
    ['a missing planned-round count', { simulatedRounds: 1, durationMs: 100 }],
    ['a fractional planned-round count', observation({ plannedRounds: 1.5 })],
    ['the final planned round', observation({ simulatedRounds: 3 })],
    ['more completed than planned rounds', observation({ simulatedRounds: 4 })],
    ['a completed single-round candidate', observation({ plannedRounds: 1 })],
  ])(
    'does not infer batch growth from %s, but preserves growth justified by completed candidates',
    (_reason, observed) => {
      const policy = createFoodOptimizerWorkerPolicy();
      policy.recordInitialization(100);
      expect(policy.workersToStart(context(), observed)).toBe(0);

      recordSimulations(policy, 2, 200);
      expect(shouldGrow(policy)).toBe(true);
      expect(policy.workersToStart(context(), observed)).toBeGreaterThan(0);
    },
  );

  it('does not turn a huge compressed candidate domain into estimated simulation calls', () => {
    const policy = createFoodOptimizerWorkerPolicy();
    policy.recordInitialization(100);
    recordSimulations(policy, 2, 100);
    policy.record({ coveredCandidates: 1_000_000_000 });

    expect(policy.workersToStart(context({ remainingCandidates: 1_000_000 }), observation({ durationMs: 1000 }))).toBe(
      0,
    );
  });
});

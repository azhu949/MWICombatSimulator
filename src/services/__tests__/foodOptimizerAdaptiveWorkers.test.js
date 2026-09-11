import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compareFoodOptimizerResults, generateFoodOptimizerCandidates } from '../foodOptimizerDomain.js';
import { createFoodOptimizerSearch } from '../foodOptimizerSearch.js';

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
    expect(state.peak).toBeGreaterThan(1);
    expect(state.peak).toBeLessThanOrEqual(4);
    expect(state.maxInitializing).toBe(1);
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
    expect(state.peak).toBeLessThanOrEqual(workerLimit);
    expect(state.maxInitializing).toBe(1);
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
    expect(state.maxInitializing).toBe(3);
    expect(state.peak).toBe(4);

    const first = state.events.find((event) => event.event === 'candidate-start' && event.signature === 'food@mp:59');
    const round = state.events.find(
      (event) => event.event === 'candidate-progress' && event.signature === first.signature && event.round === 1,
    );
    const ended = state.events.find((event) => event.event === 'candidate-end' && event.signature === first.signature);
    const starting = state.events.filter((event) => event.event === 'init-start' && event.worker > 0);
    const ready = state.events.filter((event) => event.event === 'init-end' && event.worker > 0);
    expect(round).toMatchObject({ worker: 0, workersBefore: 1, workersAfter: 4, at: first.at + 300 });
    expect(starting.map((event) => event.at)).toEqual([round.at, round.at, round.at]);
    expect(ready.map((event) => event.at)).toEqual([round.at + 200, round.at + 200, round.at + 200]);
    expect(ended.at).toBe(first.at + 900);
    expect(ready.every((event) => event.at < ended.at)).toBe(true);
    for (const event of ready)
      expect(
        state.events.some(
          (started) =>
            started.event === 'candidate-start' && started.worker === event.worker && started.at === event.at,
        ),
      ).toBe(true);
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
      expect(state.clients).toHaveLength(4);
      expect(state.maxInitializing).toBe(3);
      expect(state.peak).toBeLessThanOrEqual(4);
      expect(state.calls.every((call) => call.worker === 0)).toBe(true);
      const cancelAt = state.events.findIndex((event) => event.event === 'cancel');
      expect(cancelAt).toBeGreaterThan(-1);
      const afterCancel = state.events.slice(cancelAt + 1);
      expect(afterCancel.some((event) => event.event === 'candidate-progress' || event.event === 'init-start')).toBe(
        false,
      );
      const settled = afterCancel.filter(
        (event) => event.worker > 0 && event.event === (resolveInitAfterStop ? 'init-end' : 'init-error'),
      );
      expect(settled).toHaveLength(3);
      expect(settled.every((event) => event.at >= state.events[cancelAt].at)).toBe(true);
      if (resolveInitAfterStop) expect(settled.every((event) => event.at > state.events[cancelAt].at)).toBe(true);
      const stats = structuredClone(report.stats);
      for (const progress of state.progressCallbacks)
        progress?.({ round: 2, progress: 1, simulatedRounds: 100, reusedRounds: 100 });
      expect(report.stats).toEqual(stats);
      expect(state.clients).toHaveLength(4);
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
    expect(
      updates.map(({ round, progress, workersBefore, workersAfter }) => ({
        round,
        progress,
        workersBefore,
        workersAfter,
      })),
    ).toEqual([
      { round: 1, progress: 0, workersBefore: 1, workersAfter: 1 },
      { round: 1, progress: 0.5, workersBefore: 1, workersAfter: 1 },
      { round: 2, progress: 0, workersBefore: 1, workersAfter: 4 },
      { round: 3, progress: 0, workersBefore: 4, workersAfter: 4 },
    ]);
    expect(
      state.events.filter((event) => event.event === 'init-start' && event.worker > 0).map((event) => event.at),
    ).toEqual([updates[2].at, updates[2].at, updates[2].at]);
    expect(state.maxInitializing).toBe(3);
    expect(state.peak).toBeLessThanOrEqual(4);
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
    expect(state.maxInitializing).toBeLessThanOrEqual(1);
    expect(state.clients.length).toBeLessThanOrEqual(4);
    expect(state.peak).toBeLessThanOrEqual(4);
  });

  it('keeps a slow multi-round baseline outside the growth policy', async () => {
    const state = setup({ rounds: 3, initialMs: 200, baselineMs: 10000, candidateMs: 1 });
    const report = await finish(state);
    expectComplete(state, report);
    expect(state.clients).toHaveLength(1);
    expect(state.events.filter((event) => event.event === 'baseline-progress').map((event) => event.round)).toEqual([
      1, 2, 3,
    ]);
    expect(
      state.events
        .filter((event) => event.event === 'baseline-progress')
        .every((event) => event.workersBefore === 1 && event.workersAfter === 1),
    ).toBe(true);
  });
});

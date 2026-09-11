import { describe, expect, it } from 'vitest';
import { createFoodOptimizerWorkerPolicy } from '../foodOptimizerWorkerPolicy.js';

function recordSimulations(policy, count, durationMs) {
  for (let index = 0; index < count; index += 1) policy.record({ durationMs, simulated: true });
}

const context = (overrides = {}) => ({ workers: 1, workerLimit: 4, remainingCandidates: 1000, ...overrides });
const observation = (overrides = {}) => ({ durationMs: 100, simulatedRounds: 1, plannedRounds: 3, ...overrides });
const shouldGrow = (policy, overrides) => policy.shouldGrow(context(overrides));

describe('adaptive food optimizer worker policy', () => {
  it('waits for two actual candidates even when one slow sample and many cache hits suggest ample work', () => {
    const policy = createFoodOptimizerWorkerPolicy();
    policy.recordInitialization(100);
    expect(shouldGrow(policy)).toBe(false);

    recordSimulations(policy, 1, 1000);
    for (let index = 0; index < 12; index += 1) policy.record({ durationMs: 1000, simulated: false });
    expect(shouldGrow(policy)).toBe(false);

    policy.record({ durationMs: 1000, simulated: true });
    expect(shouldGrow(policy)).toBe(true);
  });

  it('requires both paid simulation work and remaining savings beyond the observed startup cost', () => {
    const policy = createFoodOptimizerWorkerPolicy();
    policy.recordInitialization(100);
    recordSimulations(policy, 4, 20);
    // A large backlog alone cannot justify growth after only 80 ms of actual work.
    expect(shouldGrow(policy, { remainingCandidates: 10000 })).toBe(false);

    policy.record({ durationMs: 20, simulated: true });
    // Ten more 20 ms jobs save only the 100 ms needed to start another worker.
    expect(shouldGrow(policy, { remainingCandidates: 10 })).toBe(false);
    expect(shouldGrow(policy, { remainingCandidates: 11 })).toBe(true);
  });

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

  it('needs more remaining work to repay a slower worker initialization', () => {
    const fastStartup = createFoodOptimizerWorkerPolicy();
    const slowStartup = createFoodOptimizerWorkerPolicy();
    fastStartup.recordInitialization(100);
    slowStartup.recordInitialization(1000);
    for (const policy of [fastStartup, slowStartup]) recordSimulations(policy, 4, 500);

    expect(shouldGrow(fastStartup, { remainingCandidates: 3 })).toBe(true);
    expect(shouldGrow(slowStartup, { remainingCandidates: 3 })).toBe(false);
    expect(shouldGrow(slowStartup, { remainingCandidates: 40 })).toBe(true);
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

  it('deducts each startup charge while preserving paid work for later growth and ignoring cache-hit latency', () => {
    const policy = createFoodOptimizerWorkerPolicy();
    policy.recordInitialization(100);
    recordSimulations(policy, 2, 175);
    for (const workers of [1, 2, 3]) {
      expect(shouldGrow(policy, { workers, workerLimit: 6 })).toBe(true);
      policy.workerStarted();
    }

    // Three startup charges leave 50 ms of the original 350 ms, rather than
    // discarding all measured work at the first expansion.
    expect(shouldGrow(policy, { workers: 4, workerLimit: 6 })).toBe(false);
    policy.record({ durationMs: 10000, simulated: false });
    expect(shouldGrow(policy, { workers: 4, workerLimit: 6 })).toBe(false);

    policy.record({ durationMs: 50, simulated: true });
    expect(shouldGrow(policy, { workers: 4, workerLimit: 6 })).toBe(true);
  });

  it('forgets an old huge reuse block after 32 new observations reveal sustained simulation work', () => {
    const policy = createFoodOptimizerWorkerPolicy();
    policy.recordInitialization(100);
    policy.record({ coveredCandidates: 1_000_000_000 });
    recordSimulations(policy, 4, 100);
    expect(shouldGrow(policy)).toBe(false);

    recordSimulations(policy, 27, 100);
    expect(shouldGrow(policy)).toBe(false);
    policy.record({ durationMs: 100, simulated: true });
    expect(shouldGrow(policy)).toBe(true);
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
    expect(policy.workersToStart(context(), observation())).toBe(3);
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
    expect(policy.workersToStart(remaining, running)).toBe(3);
    expect(policy.workersToStart(remaining, running)).toBe(3);
    expect(shouldGrow(policy)).toBe(false);
  });

  it.each([
    [1, 0],
    [3, 1],
    [5, 2],
    [20, 3],
  ])(
    'with %i remaining calls, starts at most %i workers so each new worker has two estimated tasks',
    (remaining, count) => {
      const policy = createFoodOptimizerWorkerPolicy();
      policy.recordInitialization(100);

      expect(policy.workersToStart(context({ remainingCandidates: remaining }), observation({ durationMs: 500 }))).toBe(
        count,
      );
    },
  );

  it('respects the remaining capacity of an already expanded pool', () => {
    const policy = createFoodOptimizerWorkerPolicy();
    policy.recordInitialization(100);

    expect(policy.workersToStart(context({ workers: 3 }), observation({ durationMs: 500 }))).toBe(1);
    expect(policy.workersToStart(context({ workerLimit: 2 }), observation({ durationMs: 500 }))).toBe(1);
  });

  it.each([
    [100, 49, 50],
    [800, 199, 200],
  ])('with a %i ms startup, requires a sufficiently long real-round observation', (startupMs, earlyMs, readyMs) => {
    const policy = createFoodOptimizerWorkerPolicy();
    policy.recordInitialization(startupMs);

    expect(policy.workersToStart(context(), observation({ durationMs: earlyMs }))).toBe(0);
    expect(policy.workersToStart(context(), observation({ durationMs: readyMs }))).toBe(3);
  });

  it('requires estimated savings strictly greater than twice the overlapping startup cost', () => {
    const policy = createFoodOptimizerWorkerPolicy();
    policy.recordInitialization(100);
    const twoCalls = context({ remainingCandidates: 2 });

    expect(policy.workersToStart(twoCalls, observation({ durationMs: 100, plannedRounds: 2 }))).toBe(0);
    expect(policy.workersToStart(twoCalls, observation({ durationMs: 101, plannedRounds: 2 }))).toBe(1);
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
      expect(policy.workersToStart(context(), observed)).toBe(1);
    },
  );

  it('reduces the batch size when recent candidates are usually satisfied by cache hits', () => {
    const dense = createFoodOptimizerWorkerPolicy();
    const cacheHeavy = createFoodOptimizerWorkerPolicy();
    for (const policy of [dense, cacheHeavy]) {
      policy.recordInitialization(100);
      recordSimulations(policy, 2, 100);
    }
    for (let index = 0; index < 18; index += 1) cacheHeavy.record();

    const remaining = context({ remainingCandidates: 20 });
    const running = observation({ durationMs: 300 });
    expect(dense.workersToStart(remaining, running)).toBe(3);
    expect(cacheHeavy.workersToStart(remaining, running)).toBe(1);
  });

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

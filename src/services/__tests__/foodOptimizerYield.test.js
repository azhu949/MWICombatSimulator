import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFoodOptimizerSearch } from '../foodOptimizerSearch.js';

const NativeMessageChannel = globalThis.MessageChannel;
afterEach(() => vi.unstubAllGlobals());

function start() {
  const items = Array.from({ length: 10 }, (_, index) => ({
    hrid: `food-${index}`,
    kind: 'mp',
    restore: 50,
    price: index + 1,
    thresholds: [2, 1],
  }));
  const stop = vi.fn();
  const evaluate = vi.fn();
  const search = createFoodOptimizerSearch({
    request: {
      activePlayerId: '1',
      rounds: 1,
      seeds: [1],
      payload: { players: [{ hrid: 'player1', food: [null, null, null] }], simulationTimeLimit: 600e9 },
    },
    items,
    foodSlots: 3,
    workerLimit: 1,
    workerFactory: () => ({
      stop,
      async call(message) {
        if (message.type === 'init') return;
        evaluate(message.candidate);
        expect(message.candidate).toBeNull();
        const sample = {
          seed: 1,
          deaths: 0,
          ranOutOfMana: false,
          stoppedEarly: false,
          simulatedTime: 600e9,
          foodUsed: {},
          costPerHour: 0,
          unusedFoodThresholds: { hp: 1, mp: 1 },
          equivalentThresholds: null,
        };
        return {
          ...sample,
          feasible: true,
          rejected: '',
          roundsCompleted: 1,
          simulatedRounds: 1,
          reusedRounds: 0,
          samples: [sample],
        };
      },
    }),
  });
  return { search, stop, evaluate };
}

function installChannel({ failPost = false, onDelivery = () => {} } = {}) {
  const channels = [];
  vi.stubGlobal(
    'MessageChannel',
    class {
      constructor() {
        this.port1 = { close: vi.fn(), onmessage: null, onmessageerror: null };
        this.port2 = {
          close: vi.fn(),
          postMessage: () => {
            if (failPost) throw new Error('channel unavailable');
            setTimeout(() => {
              onDelivery();
              this.port1.onmessage({ data: null });
            }, 0);
          },
        };
        channels.push(this);
      }
    },
  );
  return channels;
}

function expectClosed(channels) {
  expect(channels.length).toBeGreaterThan(0);
  for (const channel of channels) {
    expect(channel.port1.close).toHaveBeenCalledTimes(1);
    expect(channel.port2.close).toHaveBeenCalledTimes(1);
  }
}

describe('food optimizer task-boundary yielding', () => {
  it('keeps complete results and accounting identical with native channels and the timer fallback', async () => {
    vi.stubGlobal('MessageChannel', undefined);
    const timer = await start().search.done;
    vi.stubGlobal('MessageChannel', NativeMessageChannel);
    const { search, evaluate, stop } = start();
    const channel = await search.done;
    expect(channel).toMatchObject({ status: 'completed', complete: true });
    expect(channel.stats).toStrictEqual(timer.stats);
    expect(channel.baseline).toStrictEqual(timer.baseline);
    expect(channel.topResults).toStrictEqual(timer.topResults);
    expect(channel.stats.completedCandidates).toBe(channel.stats.totalCandidates);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalled();
  });

  it('closes every channel after a successful yield', async () => {
    const channels = installChannel();
    expect((await start().search.done).status).toBe('completed');
    expectClosed(channels);
  });

  it('closes failed channels and completes through the timer fallback', async () => {
    const channels = installChannel({ failPost: true });
    expect((await start().search.done).status).toBe('completed');
    expectClosed(channels);
  });

  it('cancels from a queued task during entirely reused work and releases both ports', async () => {
    let state;
    const channels = installChannel({ onDelivery: () => state.search.cancel() });
    state = start();
    const report = await state.search.done;
    expect(report).toMatchObject({ status: 'cancelled', complete: false });
    expect(report.stats.completedCandidates).toBeLessThan(report.stats.totalCandidates);
    expect(state.stop).toHaveBeenCalled();
    expectClosed(channels);
  });
});

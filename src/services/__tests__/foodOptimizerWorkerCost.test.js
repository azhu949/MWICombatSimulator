import { afterEach, describe, expect, it, vi } from 'vitest';

const { evaluate, createEvaluator } = vi.hoisted(() => ({ evaluate: vi.fn(), createEvaluator: vi.fn() }));
vi.mock('../foodOptimizerSimulation.js', () => ({ createFoodOptimizerEvaluator: createEvaluator }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('food optimizer worker cost control', () => {
  it('forwards the dispatched cutoff and preserves cost-stop progress and results', async () => {
    const result = { pruned: 'cost', feasible: null, rejected: '', costLowerBound: 70 };
    const progress = { round: 1, progress: 0, simulatedRounds: 1, reusedRounds: 0, pruned: 'cost' };
    evaluate.mockImplementation(async (candidate, deaths, onProgress) => {
      onProgress(progress);
      return result;
    });
    createEvaluator.mockReturnValue(evaluate);
    const worker = { postMessage: vi.fn() };
    vi.stubGlobal('self', worker);
    await import('../../foodOptimizerWorker.js');
    const request = { searchMode: 'top10' };
    await worker.onmessage({ data: { type: 'init', request, sharedRounds: true } });
    const candidate = { signature: 'food@mp:50' };
    const reusableSamples = [];
    await worker.onmessage({ data: { candidate, baselineDeaths: 0, reusableSamples, costCutoff: 50 } });
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledWith(candidate, 0, expect.any(Function), reusableSamples, 50);
    expect(worker.postMessage.mock.calls.map(([message]) => message)).toEqual([
      { type: 'result' },
      { type: 'progress', ...progress },
      { type: 'result', result },
    ]);
  });
});

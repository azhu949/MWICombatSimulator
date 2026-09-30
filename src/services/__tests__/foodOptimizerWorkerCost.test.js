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
    await import('../../worker.js');
    const request = { searchMode: 'top10' };
    await worker.onmessage({ data: { type: 'init', request, sharedRounds: true } });
    const candidate = { signature: 'food@mp:50' };
    const reusableSamples = [];
    await worker.onmessage({ data: { candidate, deathBudget: 0, reusableSamples, costCutoff: 50 } });
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledWith(candidate, 0, expect.any(Function), reusableSamples, 50);
    expect(worker.postMessage.mock.calls.map(([message]) => message)).toEqual([
      { type: 'result' },
      { type: 'progress', ...progress },
      { type: 'result', result },
    ]);
  });

  it('rejects an overlapping evaluate message while one is in flight', async () => {
    let release;
    evaluate.mockImplementation(async () => await new Promise((resolve) => (release = resolve)));
    createEvaluator.mockReturnValue(evaluate);
    const worker = { postMessage: vi.fn() };
    vi.stubGlobal('self', worker);
    // 重新加载 worker 入口模块，使其 onmessage 处理器绑定到这个桩。
    vi.resetModules();
    await import('../../worker.js');
    await worker.onmessage({ data: { type: 'init', request: {}, sharedRounds: true } });
    const first = worker.onmessage({ data: { candidate: 1, deathBudget: 0 } });
    // 第二条消息在第一次评估仍挂起时到达。
    await worker.onmessage({ data: { candidate: 2, deathBudget: 0 } });
    expect(worker.postMessage.mock.calls.map(([message]) => message)).toContainEqual(
      expect.objectContaining({ type: 'error', error: expect.stringMatching(/Overlapping message/) }),
    );
    release();
    await first;
    // 正在进行的评估仍会完成，并在此后上报结果。
    expect(worker.postMessage.mock.calls.map(([message]) => message).at(-1)).toMatchObject({ type: 'result' });
  });
});

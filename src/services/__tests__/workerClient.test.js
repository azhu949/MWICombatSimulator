import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerClient } from '../workerClient.js';

class FakeWorker {
  static instances = [];

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.postMessage = vi.fn();
    this.terminate = vi.fn();
    this.onmessage = null;
    this.onerror = null;
    FakeWorker.instances.push(this);
  }

  emit(data) {
    this.onmessage?.({ data });
  }
}

describe('workerClient', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    global.Worker = FakeWorker;
  });

  it('routes single simulation messages', () => {
    const client = new WorkerClient();
    const onProgress = vi.fn();
    const onResult = vi.fn();

    client.startSimulation(
      {
        type: 'start_simulation',
        workerId: 'w1',
        players: [],
        zone: { zoneHrid: '/actions/combat/fly', difficultyTier: 0 },
        labyrinth: null,
        simulationTimeLimit: 100,
        extra: { mooPass: false, comExp: 0, comDrop: 0, enableHpMpVisualization: true },
      },
      { onProgress, onResult },
    );

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledTimes(1);

    FakeWorker.instances[0].emit({ type: 'simulation_progress', progress: 0.5 });
    FakeWorker.instances[0].emit({ type: 'simulation_result', simResult: { encounters: 1 } });

    expect(onProgress).toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith({ encounters: 1 });
  });

  it('batches payloads in one realm, posting the next only after a reply (§54)', () => {
    const client = new WorkerClient();
    const onResult = vi.fn();
    const onError = vi.fn();
    const onComplete = vi.fn();
    const payloads = [{ workerId: 'w#r1' }, { workerId: 'w#r2' }];

    client.startSimulationBatch(payloads, { onResult, onError, onComplete });

    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0];
    // 串行投递：第二条要等第一条的结果回来才发出（同一 realm 不许并跑两场）。
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenLastCalledWith(payloads[0]);

    worker.emit({ type: 'simulation_result', simResult: { encounters: 1 } });
    expect(onResult).toHaveBeenLastCalledWith({ encounters: 1 }, 0);
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    expect(worker.postMessage).toHaveBeenLastCalledWith(payloads[1]);

    // 单场失败不打断整批：继续跑下一条，然后收尾。
    worker.emit({ type: 'simulation_error', error: 'boom' });
    expect(onError).toHaveBeenLastCalledWith('boom', 1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('aborts the batch run and discards the realm on engine_unavailable (§reuse)', () => {
    const client = new WorkerClient();
    const onError = vi.fn();
    const onAbort = vi.fn();
    const onComplete = vi.fn();
    const payloads = [{ workerId: 'w#r1' }, { workerId: 'w#r2' }];

    client.startSimulationBatch(payloads, { onError, onAbort, onComplete });

    expect(FakeWorker.instances).toHaveLength(1);
    const first = FakeWorker.instances[0];
    expect(first.postMessage).toHaveBeenCalledTimes(1);
    expect(first.postMessage).toHaveBeenLastCalledWith(payloads[0]);

    // realm 级 sticky 失败（errorCode='engine_unavailable'）：中止投递、弃置 realm、
    // 走 onAbort（在飞 index=0），而不是按单场失败继续跑下一条。
    first.emit({ type: 'simulation_error', error: 'engine down', errorCode: 'engine_unavailable' });

    expect(onError).not.toHaveBeenCalled();
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onAbort).toHaveBeenCalledWith('engine down', 0);
    expect(first.postMessage).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    expect(first.terminate).toHaveBeenCalledTimes(1);

    // 弃置后：下一次批量请求重建新 realm（不复用被污染的旧 realm）。
    client.startSimulationBatch([{ workerId: 'w#r3' }], {});
    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[1].postMessage).toHaveBeenCalledTimes(1);
    client.stopSimulation();
  });

  it('stops posting after a realm-level crash and reports the in-flight index (§54)', () => {
    const client = new WorkerClient();
    const onAbort = vi.fn();
    const payloads = [{ workerId: 'w#r1' }, { workerId: 'w#r2' }];

    client.startSimulationBatch(payloads, { onAbort });

    const worker = FakeWorker.instances[0];
    expect(worker.postMessage).toHaveBeenCalledTimes(1);

    worker.onerror(new Error('realm exploded'));

    expect(onAbort).toHaveBeenCalledWith('realm exploded', 0);
    // 崩溃之后不再投递（realm 已经不在）。
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
  });

  it('routes multi simulation messages', () => {
    const client = new WorkerClient();
    const onItemResult = vi.fn();
    const onBatchResult = vi.fn();

    client.startMultiSimulation(
      {
        type: 'start_simulation_all_zones',
        players: [],
        zones: [{ zoneHrid: '/actions/combat/fly', difficultyTier: 0 }],
        simulationTimeLimit: 100,
        extra: { mooPass: false, comExp: 0, comDrop: 0, enableHpMpVisualization: false },
      },
      { onItemResult, onBatchResult },
    );

    expect(FakeWorker.instances).toHaveLength(1);

    FakeWorker.instances[0].emit({
      type: 'simulation_item_result',
      index: 0,
      zoneHrid: '/actions/combat/fly',
      difficultyTier: 0,
      simResult: { encounters: 1 },
    });
    FakeWorker.instances[0].emit({ type: 'simulation_result_allZones', simResults: [{ encounters: 2 }] });

    expect(onItemResult).toHaveBeenCalledWith({
      type: 'simulation_item_result',
      index: 0,
      zoneHrid: '/actions/combat/fly',
      difficultyTier: 0,
      simResult: { encounters: 1 },
    });
    expect(onBatchResult).toHaveBeenCalledWith([{ encounters: 2 }], 'simulation_result_allZones');
  });

  it('passes parallelWorkerLimit to the multi worker payload', () => {
    const client = new WorkerClient();

    client.startMultiSimulation(
      {
        type: 'start_simulation_all_zones',
        players: [],
        zones: [{ zoneHrid: '/actions/combat/fly', difficultyTier: 0 }],
        simulationTimeLimit: 100,
        extra: { mooPass: false, comExp: 0, comDrop: 0, enableHpMpVisualization: false },
        parallelWorkerLimit: 3,
      },
      {},
    );

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        parallelWorkerLimit: 3,
      }),
    );
  });

  it('reuses an idle healthy realm for the next single run (§reuse)', () => {
    const client = new WorkerClient();
    client.startSimulation({ workerId: 'w1' }, {});
    FakeWorker.instances[0].emit({ type: 'simulation_result', simResult: { encounters: 1 } });

    client.startSimulation({ workerId: 'w2' }, {});

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].terminate).not.toHaveBeenCalled();
    expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledTimes(2);
    client.stopSimulation();
  });

  it('discards the realm on user stop, then rebuilds on the next run (§reuse)', () => {
    const client = new WorkerClient();
    client.startSimulation({ workerId: 'w1' }, {});
    FakeWorker.instances[0].emit({ type: 'simulation_result', simResult: {} });

    client.stopSimulation();
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);

    client.startSimulation({ workerId: 'w2' }, {});
    expect(FakeWorker.instances).toHaveLength(2);
    client.stopSimulation();
  });

  it('discards a failed realm (simulation_error) and rebuilds on the next run (§reuse)', () => {
    const client = new WorkerClient();
    const onError = vi.fn();
    client.startSimulation({ workerId: 'w1' }, { onError });
    FakeWorker.instances[0].emit({ type: 'simulation_error', error: 'wasm unavailable' });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);

    client.startSimulation({ workerId: 'w2' }, {});
    expect(FakeWorker.instances).toHaveLength(2);
    client.stopSimulation();
  });

  it('discards a crashed realm (worker.onerror) and rebuilds on the next run (§reuse)', () => {
    const client = new WorkerClient();
    const onError = vi.fn();
    client.startSimulation({ workerId: 'w1' }, { onError });
    FakeWorker.instances[0].onerror(new Error('crash'));

    expect(onError).toHaveBeenCalledWith('crash');
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);

    client.startSimulation({ workerId: 'w2' }, {});
    expect(FakeWorker.instances).toHaveLength(2);
    client.stopSimulation();
  });

  it('never posts into a busy realm: a second start terminates and rebuilds (§reuse)', () => {
    const client = new WorkerClient();
    client.startSimulation({ workerId: 'w1' }, {});
    // 第一条还没结算就再点「开始」：终止旧 realm 重建（与旧行为一致），绝不并发投递。
    client.startSimulation({ workerId: 'w2' }, {});

    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
    expect(FakeWorker.instances[1].postMessage).toHaveBeenCalledTimes(1);
    client.stopSimulation();
  });

  it('settles the superseded single run with a cancellation error instead of hanging (§supersede)', () => {
    const client = new WorkerClient();
    const onError = vi.fn();
    client.startSimulation({ workerId: 'w1' }, { onError });
    // 被新请求抢占：旧 realm 终止前，旧运行以 cancelled 错误显式收尾（不再静默挂起）。
    client.startSimulation({ workerId: 'w2' }, {});

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({ code: 'cancelled' });
    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
    client.stopSimulation();
  });

  it('settles the superseded batch run through onAbort with the in-flight index (§supersede)', () => {
    const client = new WorkerClient();
    const onAbort = vi.fn();
    client.startSimulationBatch([{ workerId: 'a' }, { workerId: 'b' }], { onAbort });
    client.startSimulation({ workerId: 'w2' }, {});

    expect(onAbort).toHaveBeenCalledTimes(1);
    const [error, index] = onAbort.mock.calls[0];
    expect(error).toMatchObject({ code: 'cancelled' });
    expect(index).toBe(0);
    client.stopSimulation();
  });

  it('settles the superseded multi run with a cancellation error instead of hanging (§supersede)', () => {
    const client = new WorkerClient();
    const onError = vi.fn();
    client.startMultiSimulation({ type: 'start_simulation_all_zones' }, { onError });
    client.startSimulation({ workerId: 'w2' }, {});

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({ code: 'cancelled' });
    client.stopSimulation();
  });

  it('rebuilds when the worker kind switches (single -> multi) (§reuse)', () => {
    const client = new WorkerClient();
    client.startSimulation({ workerId: 'w1' }, {});
    FakeWorker.instances[0].emit({ type: 'simulation_result', simResult: {} });

    client.startMultiSimulation({ type: 'start_simulation_all_zones' }, {});
    expect(FakeWorker.instances).toHaveLength(2);
    client.stopSimulation();
  });

  it('reuses an idle healthy multi realm across multi runs (§reuse)', () => {
    const client = new WorkerClient();
    client.startMultiSimulation({ type: 'start_simulation_all_zones' }, {});
    FakeWorker.instances[0].emit({ type: 'simulation_result_allZones', simResults: [] });

    client.startMultiSimulation({ type: 'start_simulation_all_zones' }, {});

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].terminate).not.toHaveBeenCalled();
    expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledTimes(2);
    client.stopSimulation();
  });

  it('discards a failed multi realm (simulation_error) and rebuilds on the next run (§reuse)', () => {
    const client = new WorkerClient();
    const onError = vi.fn();
    client.startMultiSimulation({ type: 'start_simulation_all_zones' }, { onError });
    FakeWorker.instances[0].emit({ type: 'simulation_error', error: 'batch failed' });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);

    client.startMultiSimulation({ type: 'start_simulation_all_zones' }, {});
    expect(FakeWorker.instances).toHaveLength(2);
    client.stopSimulation();
  });

  it('reuses the same realm across sequential batches (§reuse)', () => {
    const client = new WorkerClient();
    client.startSimulationBatch([{ workerId: 'a' }], {});
    FakeWorker.instances[0].emit({ type: 'simulation_result', simResult: {} });

    client.startSimulationBatch([{ workerId: 'b' }], {});

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledTimes(2);
    client.stopSimulation();
  });

  it('evicts the realm after the idle window, then rebuilds on the next run (§reuse)', () => {
    vi.useFakeTimers();
    try {
      const client = new WorkerClient({ idleEvictMs: 1000 });
      client.startSimulation({ workerId: 'w1' }, {});
      FakeWorker.instances[0].emit({ type: 'simulation_result', simResult: {} });

      vi.advanceTimersByTime(1000);
      expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);

      client.startSimulation({ workerId: 'w2' }, {});
      expect(FakeWorker.instances).toHaveLength(2);
      client.stopSimulation();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the pending idle timer when a run reuses the realm (§reuse)', () => {
    vi.useFakeTimers();
    try {
      const client = new WorkerClient({ idleEvictMs: 1000 });
      client.startSimulation({ workerId: 'w1' }, {});
      FakeWorker.instances[0].emit({ type: 'simulation_result', simResult: {} });

      vi.advanceTimersByTime(500);
      client.startSimulation({ workerId: 'w2' }, {}); // 复用：清除旧定时器
      vi.advanceTimersByTime(600); // 越过原定时器到期点
      expect(FakeWorker.instances[0].terminate).not.toHaveBeenCalled();

      FakeWorker.instances[0].emit({ type: 'simulation_result', simResult: {} });
      vi.advanceTimersByTime(1000); // 新定时器到期
      expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
      client.stopSimulation();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rebuilds when the run-count cap is reached (§reuse)', () => {
    const client = new WorkerClient({ maxRuns: 2 });
    client.startSimulation({ workerId: 'r1' }, {});
    FakeWorker.instances[0].emit({ type: 'simulation_result', simResult: {} });
    client.startSimulation({ workerId: 'r2' }, {}); // 复用（1 < 2）
    FakeWorker.instances[0].emit({ type: 'simulation_result', simResult: {} });

    client.startSimulation({ workerId: 'r3' }, {}); // 到限重建
    expect(FakeWorker.instances).toHaveLength(2);
    client.stopSimulation();
  });

  it('discards a silent realm via the run stall watchdog and rebuilds on the next run (§stall)', () => {
    vi.useFakeTimers();
    try {
      const client = new WorkerClient({ stallTimeoutMs: 1000 });
      const onError = vi.fn();
      client.startSimulation({ workerId: 'w1' }, { onError });

      expect(FakeWorker.instances).toHaveLength(1);
      vi.advanceTimersByTime(999);
      expect(FakeWorker.instances[0].terminate).not.toHaveBeenCalled();

      // 静默超窗：realm 判死弃置，在飞运行以 realm_stall 显式收尾（不再永久悬挂）。
      vi.advanceTimersByTime(1);
      expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toMatchObject({ code: 'realm_stall' });

      // 弃置后：下一次请求重建新 realm。
      client.startSimulation({ workerId: 'w2' }, {});
      expect(FakeWorker.instances).toHaveLength(2);
      client.stopSimulation();
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts a silent batch through onAbort with the in-flight index (§stall)', () => {
    vi.useFakeTimers();
    try {
      const client = new WorkerClient({ stallTimeoutMs: 1000 });
      const onAbort = vi.fn();
      const onComplete = vi.fn();
      const payloads = [{ workerId: 'a' }, { workerId: 'b' }];
      client.startSimulationBatch(payloads, { onAbort, onComplete });

      expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1000);

      // 静默超窗：在飞的那一条按 realm 级失败上报（onAbort + 当前 index），本批不再投递。
      expect(onAbort).toHaveBeenCalledTimes(1);
      const [error, index] = onAbort.mock.calls[0];
      expect(error).toMatchObject({ code: 'realm_stall' });
      expect(index).toBe(0);
      expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
      expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledTimes(1);
      expect(onComplete).not.toHaveBeenCalled();
      client.stopSimulation();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes the stall window on each message and clears it when the run settles (§stall)', () => {
    vi.useFakeTimers();
    try {
      const client = new WorkerClient({ stallTimeoutMs: 1000 });
      const onError = vi.fn();
      client.startSimulation({ workerId: 'w1' }, { onError });

      // 接近窗口时收到 progress：自最后一条消息重新起算，不触发。
      vi.advanceTimersByTime(900);
      FakeWorker.instances[0].emit({ type: 'simulation_progress', progress: 0.5 });
      vi.advanceTimersByTime(900);
      expect(onError).not.toHaveBeenCalled();
      expect(FakeWorker.instances[0].terminate).not.toHaveBeenCalled();

      // 自最后一条消息累计超过窗口：触发判死。
      vi.advanceTimersByTime(100);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toMatchObject({ code: 'realm_stall' });

      // 下一次运行正常出结果：结算时清掉看门狗，此后超窗不再触发。
      client.startSimulation({ workerId: 'w2' }, { onError });
      vi.advanceTimersByTime(900);
      FakeWorker.instances[1].emit({ type: 'simulation_result', simResult: {} });
      vi.advanceTimersByTime(5000);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(FakeWorker.instances[1].terminate).not.toHaveBeenCalled();
      client.stopSimulation();
    } finally {
      vi.useRealTimers();
    }
  });
});

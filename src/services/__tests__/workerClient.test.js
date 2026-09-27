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
});

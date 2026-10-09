import { afterEach, describe, expect, it, vi } from 'vitest';
import sharedWorkerClient from '../workerClient.js';
import {
  DEDICATED_SINGLE_POOL_MAX_IDLE_PER_SCOPE,
  DEDICATED_WORKER_SCOPE_ADVISOR,
  DEDICATED_WORKER_SCOPE_EXPERIMENTAL,
  DEDICATED_WORKER_SCOPE_HOME_MULTI_ROUND,
  DEDICATED_WORKER_SCOPE_QUEUE,
  DEDICATED_WORKER_SCOPE_TRIGGER_OPTIMIZER,
  cancelDedicatedWorkerRuns,
  cancelSharedWorkerRun,
  createWorkerRunCancellationError,
  hasSharedWorkerRunInProgress,
  isWorkerRunCancelledError,
  resetDedicatedSingleClientPools,
  runMultiSimulationPayloadWithDedicatedWorker,
  runSharedMultiSimulationPayload,
  runSharedSingleSimulationPayload,
  runSimulationBatchWithDedicatedWorker,
  runSingleSimulationPayloadWithDedicatedWorker,
  stopAdvisorWorkerRuns,
  stopQueueWorkerClients,
  stopTriggerOptimizerWorkerRuns,
  supportsSimulationBatch,
} from '../simulatorWorkerRuns.js';

class FakeWorkerClient {
  static instances = [];

  constructor() {
    this.handlers = {};
    this.stopSimulation = vi.fn();
    FakeWorkerClient.instances.push(this);
  }

  startSimulation(payload, handlers = {}) {
    this.payload = payload;
    this.handlers = handlers;
  }

  startMultiSimulation(payload, handlers = {}) {
    this.payload = payload;
    this.handlers = handlers;
  }

  startSimulationBatch(payloads, handlers = {}) {
    this.payloads = Array.isArray(payloads) ? payloads : [];
    this.batchHandlers = handlers;
  }

  emitBatchProgress(data) {
    this.batchHandlers?.onProgress?.(data);
  }

  emitBatchResult(simResult, index) {
    this.batchHandlers?.onResult?.(simResult, index);
  }

  emitBatchError(error, index) {
    this.batchHandlers?.onError?.(error, index);
  }

  emitBatchAbort(error, index) {
    this.batchHandlers?.onAbort?.(error, index);
  }

  emitBatchComplete() {
    this.batchHandlers?.onComplete?.();
  }

  emit(type, ...args) {
    this.handlers[type]?.(...args);
  }
}

// 真实 WorkerClient 的「共享保活单例」用例需要替换全局 Web Worker（JS 环境无原生实现）。
class FakeSimulationWorker {
  static instances = [];

  constructor(url, options) {
    this.url = String(url);
    this.options = options;
    this.postMessage = vi.fn();
    this.terminate = vi.fn();
    this.onmessage = null;
    this.onerror = null;
    FakeSimulationWorker.instances.push(this);
  }
}

afterEach(() => {
  FakeSimulationWorker.instances = [];
  FakeWorkerClient.instances = [];
  cancelDedicatedWorkerRuns();
  cancelSharedWorkerRun();
  // 池化（2026-10-04）：生产路径的批量/单场调用都会经 scope 级保活池，跨用例必须清池
  // （终止池内 client），防模块级池状态泄漏到后续用例。
  resetDedicatedSingleClientPools();
});

describe('simulatorWorkerRuns', () => {
  it('resolves dedicated single runs and stops the client exactly once', async () => {
    const promise = runSingleSimulationPayloadWithDedicatedWorker({ type: 'start_simulation' }, vi.fn(), {
      scope: DEDICATED_WORKER_SCOPE_QUEUE,
      WorkerClientCtor: FakeWorkerClient,
    });
    const client = FakeWorkerClient.instances[0];

    client.emit('onProgress', { progress: 0.5 });
    client.emit('onResult', { encounters: 3 });
    client.emit('onResult', { encounters: 4 });

    await expect(promise).resolves.toEqual({ encounters: 3 });
    expect(client.stopSimulation).toHaveBeenCalledTimes(1);
  });

  it('exposes a scoped handle for cancelling a dedicated run before startup', async () => {
    let runHandle = null;
    const promise = runSingleSimulationPayloadWithDedicatedWorker({ type: 'start_simulation' }, vi.fn(), {
      scope: DEDICATED_WORKER_SCOPE_EXPERIMENTAL,
      WorkerClientCtor: FakeWorkerClient,
      onHandle: (handle) => {
        runHandle = handle;
        handle.cancel();
      },
    });
    const client = FakeWorkerClient.instances[0];

    expect(runHandle?.scope).toBe(DEDICATED_WORKER_SCOPE_EXPERIMENTAL);
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    expect(client.payload).toBeUndefined();
    expect(client.stopSimulation).toHaveBeenCalledTimes(1);
  });

  it('keeps an experimental dedicated run isolated from an active shared run', async () => {
    const sharedClient = new FakeWorkerClient();
    const sharedPromise = runSharedSingleSimulationPayload({ type: 'shared' }, vi.fn(), { workerClient: sharedClient });
    let experimentalRunHandle = null;
    const experimentalPromise = runSingleSimulationPayloadWithDedicatedWorker({ type: 'experimental' }, vi.fn(), {
      scope: DEDICATED_WORKER_SCOPE_EXPERIMENTAL,
      WorkerClientCtor: FakeWorkerClient,
      onHandle: (handle) => {
        experimentalRunHandle = handle;
      },
    });

    experimentalRunHandle.cancel();

    await expect(experimentalPromise).rejects.toMatchObject({ code: 'cancelled' });
    expect(sharedClient.stopSimulation).not.toHaveBeenCalled();
    expect(hasSharedWorkerRunInProgress()).toBe(true);

    sharedClient.emit('onResult', { encounters: 5 });
    await expect(sharedPromise).resolves.toEqual({ encounters: 5 });
    expect(hasSharedWorkerRunInProgress()).toBe(false);
  });

  it('returns normalized multi-run results while preserving item callbacks (§reuse)', async () => {
    const onItemResult = vi.fn();
    const promise = runMultiSimulationPayloadWithDedicatedWorker({ type: 'start_simulation_all_zones' }, vi.fn(), {
      scope: DEDICATED_WORKER_SCOPE_ADVISOR,
      onItemResult,
      WorkerClientCtor: FakeWorkerClient,
    });
    const client = FakeWorkerClient.instances[0];
    const item = { index: 1, simResult: { encounters: 5 } };

    client.emit('onItemResult', item);
    client.emit('onBatchResult', [{ encounters: 5 }], 'simulation_result_allZones');

    await expect(promise).resolves.toEqual({
      simResults: [{ encounters: 5 }],
      batchResultType: 'simulation_result_allZones',
    });
    expect(onItemResult).toHaveBeenCalledWith(item);
    // 正常完成：不弃置 realm（下次调用可复用同一 realm —— §reuse）。
    expect(client.stopSimulation).not.toHaveBeenCalled();
  });

  it('discards the realm when a multi run is cancelled through the scoped handle (§reuse)', async () => {
    const promise = runMultiSimulationPayloadWithDedicatedWorker({ type: 'start_simulation_all_zones' }, vi.fn(), {
      scope: DEDICATED_WORKER_SCOPE_ADVISOR,
      WorkerClientCtor: FakeWorkerClient,
    });
    const client = FakeWorkerClient.instances[0];

    stopAdvisorWorkerRuns();

    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    expect(client.stopSimulation).toHaveBeenCalledTimes(1);
  });

  it('discards the realm when a multi run fails (§reuse)', async () => {
    const promise = runMultiSimulationPayloadWithDedicatedWorker({ type: 'start_simulation_all_zones' }, vi.fn(), {
      scope: DEDICATED_WORKER_SCOPE_ADVISOR,
      WorkerClientCtor: FakeWorkerClient,
    });
    const client = FakeWorkerClient.instances[0];

    client.emit('onError', 'realm exploded');

    await expect(promise).rejects.toBe('realm exploded');
    expect(client.stopSimulation).toHaveBeenCalledTimes(1);
  });

  it('discards the realm when the multi progress callback throws', async () => {
    const progressError = new Error('progress failed');
    const promise = runMultiSimulationPayloadWithDedicatedWorker(
      { type: 'start_simulation_all_zones' },
      () => {
        throw progressError;
      },
      {
        scope: DEDICATED_WORKER_SCOPE_ADVISOR,
        WorkerClientCtor: FakeWorkerClient,
      },
    );
    const client = FakeWorkerClient.instances[0];

    client.emit('onProgress', { progress: 0.25 });

    await expect(promise).rejects.toBe(progressError);
    // 回调抛错 = 消费端故障域：终止止损（弃置 realm），作为 batch 路径同语义的对照锚定。
    expect(client.stopSimulation).toHaveBeenCalledTimes(1);
  });

  it('defaults to the shared keep-alive client so realms survive across calls (§reuse)', async () => {
    const startSpy = vi.spyOn(sharedWorkerClient, 'startMultiSimulation').mockImplementation(() => {});
    const stopSpy = vi.spyOn(sharedWorkerClient, 'stopSimulation');
    try {
      const promise = runMultiSimulationPayloadWithDedicatedWorker({ type: 'start_simulation_all_zones' }, vi.fn(), {});
      expect(startSpy).toHaveBeenCalledTimes(1);
      const handlers = startSpy.mock.calls[0][1];

      handlers.onBatchResult([{ encounters: 2 }], 'simulation_result_allZones');

      await expect(promise).resolves.toEqual({
        simResults: [{ encounters: 2 }],
        batchResultType: 'simulation_result_allZones',
      });
      expect(stopSpy).not.toHaveBeenCalled();
    } finally {
      startSpy.mockRestore();
      stopSpy.mockRestore();
    }
  });

  it('cancels only dedicated runs matching the requested scope', async () => {
    const queuePromise = runSingleSimulationPayloadWithDedicatedWorker({ type: 'queue' }, vi.fn(), {
      scope: DEDICATED_WORKER_SCOPE_QUEUE,
      WorkerClientCtor: FakeWorkerClient,
    });
    const advisorPromise = runSingleSimulationPayloadWithDedicatedWorker({ type: 'advisor' }, vi.fn(), {
      scope: DEDICATED_WORKER_SCOPE_ADVISOR,
      WorkerClientCtor: FakeWorkerClient,
    });

    stopQueueWorkerClients();

    await expect(queuePromise).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(isWorkerRunCancelledError(createWorkerRunCancellationError())).toBe(true);

    const advisorClient = FakeWorkerClient.instances[1];
    advisorClient.emit('onResult', { encounters: 2 });
    await expect(advisorPromise).resolves.toEqual({ encounters: 2 });
  });

  it('cancels advisor runs and shared runs with the existing cancellation code', async () => {
    const advisorPromise = runSingleSimulationPayloadWithDedicatedWorker({ type: 'advisor' }, vi.fn(), {
      scope: DEDICATED_WORKER_SCOPE_ADVISOR,
      WorkerClientCtor: FakeWorkerClient,
    });
    stopAdvisorWorkerRuns();
    await expect(advisorPromise).rejects.toMatchObject({
      code: 'cancelled',
    });

    const sharedClient = new FakeWorkerClient();
    const sharedPromise = runSharedSingleSimulationPayload({ type: 'shared' }, vi.fn(), { workerClient: sharedClient });
    cancelSharedWorkerRun();

    await expect(sharedPromise).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(sharedClient.stopSimulation).toHaveBeenCalledTimes(1);
  });

  it('exposes a handle for cancelling the specific shared run', async () => {
    const sharedClient = new FakeWorkerClient();
    let runHandle = null;
    const sharedPromise = runSharedSingleSimulationPayload({ type: 'shared' }, vi.fn(), {
      workerClient: sharedClient,
      onHandle: (handle) => {
        runHandle = handle;
      },
    });

    expect(runHandle).toBeTruthy();
    runHandle.cancel();

    await expect(sharedPromise).rejects.toMatchObject({ code: 'cancelled' });
    expect(sharedClient.stopSimulation).toHaveBeenCalledTimes(1);
  });

  it('does not start a shared worker when onHandle cancels synchronously', async () => {
    const sharedClient = new FakeWorkerClient();
    const startSimulation = vi.spyOn(sharedClient, 'startSimulation');
    const sharedPromise = runSharedSingleSimulationPayload({ type: 'shared' }, vi.fn(), {
      workerClient: sharedClient,
      onHandle: (handle) => handle.cancel(),
    });

    await expect(sharedPromise).rejects.toMatchObject({ code: 'cancelled' });
    expect(startSimulation).not.toHaveBeenCalled();
    expect(sharedClient.stopSimulation).toHaveBeenCalledTimes(1);
    expect(hasSharedWorkerRunInProgress()).toBe(false);
  });

  it('does not stop a worker when onHandle throws before startup', async () => {
    const sharedClient = new FakeWorkerClient();
    const callbackError = new Error('handle registration failed');
    const sharedPromise = runSharedSingleSimulationPayload({ type: 'shared' }, vi.fn(), {
      workerClient: sharedClient,
      onHandle: () => {
        throw callbackError;
      },
    });

    await expect(sharedPromise).rejects.toBe(callbackError);
    expect(sharedClient.stopSimulation).not.toHaveBeenCalled();
    expect(hasSharedWorkerRunInProgress()).toBe(false);
  });

  it('supersedes a pending shared run with a cancellation error when a new shared run starts', async () => {
    const firstClient = new FakeWorkerClient();
    const firstPromise = runSharedSingleSimulationPayload({ type: 'start_simulation', workerId: 'first' }, vi.fn(), {
      workerClient: firstClient,
    });
    expect(hasSharedWorkerRunInProgress()).toBe(true);

    const secondClient = new FakeWorkerClient();
    const secondPromise = runSharedSingleSimulationPayload({ type: 'start_simulation', workerId: 'second' }, vi.fn(), {
      workerClient: secondClient,
    });

    await expect(firstPromise).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(firstClient.stopSimulation).toHaveBeenCalledTimes(1);

    // 被取代的运行不得清除最新运行的句柄。
    expect(hasSharedWorkerRunInProgress()).toBe(true);
    secondClient.emit('onResult', { encounters: 7 });
    await expect(secondPromise).resolves.toEqual({ encounters: 7 });
    expect(secondClient.stopSimulation).not.toHaveBeenCalled();
    expect(hasSharedWorkerRunInProgress()).toBe(false);

    // cancelSharedWorkerRun 仍只针对最新的句柄。
    const thirdClient = new FakeWorkerClient();
    const thirdPromise = runSharedSingleSimulationPayload({ type: 'start_simulation', workerId: 'third' }, vi.fn(), {
      workerClient: thirdClient,
    });
    cancelSharedWorkerRun();

    await expect(thirdPromise).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(hasSharedWorkerRunInProgress()).toBe(false);
  });

  it('rejects and cleans up when a progress callback throws', async () => {
    const progressError = new Error('progress failed');
    const promise = runSingleSimulationPayloadWithDedicatedWorker(
      {},
      () => {
        throw progressError;
      },
      {
        WorkerClientCtor: FakeWorkerClient,
      },
    );
    const client = FakeWorkerClient.instances[0];
    client.emit('onProgress', { progress: 0.25 });

    await expect(promise).rejects.toBe(progressError);
    expect(client.stopSimulation).toHaveBeenCalledTimes(1);
  });

  it('detects batch capability of the production client vs a batch-less stub', () => {
    class BatchLessClient {}

    expect(supportsSimulationBatch(undefined)).toBe(true);
    expect(supportsSimulationBatch(BatchLessClient)).toBe(false);
  });

  it('collects per-index batch results/errors from one client', async () => {
    const promise = runSimulationBatchWithDedicatedWorker([{ id: 1 }, { id: 2 }], vi.fn(), {
      scope: DEDICATED_WORKER_SCOPE_TRIGGER_OPTIMIZER,
      WorkerClientCtor: FakeWorkerClient,
    });
    const client = FakeWorkerClient.instances[0];
    expect(client.payloads).toEqual([{ id: 1 }, { id: 2 }]);

    client.emitBatchResult({ encounters: 1 }, 0);
    client.emitBatchError('boom', 1);
    client.emitBatchComplete();

    await expect(promise).resolves.toEqual({ simResults: [{ encounters: 1 }, null], errors: [null, 'boom'] });
    // 正常完成：保活 realm（下次调用复用 —— §reuse），不再收尾弃置。
    expect(client.stopSimulation).not.toHaveBeenCalled();
  });

  it('restarts the realm for the remaining payloads after a realm-level crash', async () => {
    const promise = runSimulationBatchWithDedicatedWorker([{ id: 1 }, { id: 2 }, { id: 3 }], vi.fn(), {
      scope: DEDICATED_WORKER_SCOPE_TRIGGER_OPTIMIZER,
      WorkerClientCtor: FakeWorkerClient,
    });
    const first = FakeWorkerClient.instances[0];
    first.emitBatchResult({ encounters: 1 }, 0);
    first.emitBatchAbort('realm exploded', 1);

    // 在飞的那一条记失败，新 realm 只带剩下的 payload（Ctor 注入路径：换新实例）。
    const second = FakeWorkerClient.instances[1];
    expect(second.payloads).toEqual([{ id: 3 }]);
    second.emitBatchResult({ encounters: 3 }, 0);
    second.emitBatchComplete();

    await expect(promise).resolves.toEqual({
      simResults: [{ encounters: 1 }, null, { encounters: 3 }],
      errors: [null, 'realm exploded', null],
    });
    expect(first.stopSimulation).toHaveBeenCalledTimes(1);
  });

  it('restarts with a fresh realm when the engine is unavailable mid-batch (§reuse)', async () => {
    const originalWorker = global.Worker;
    global.Worker = FakeSimulationWorker;
    try {
      const promise = runSimulationBatchWithDedicatedWorker([{ id: 1 }, { id: 2 }, { id: 3 }], vi.fn(), {});
      const first = FakeSimulationWorker.instances[0];

      // 第一场：wasm 引擎在本 realm 加载失败（realm 级 sticky）→ 该条记为失败，弃置 realm，
      // 消费端 onAbort 通道自动换新 realm 续跑剩余条目（生产代码无需改动即对接）。
      first.onmessage({ data: { type: 'simulation_error', error: 'engine down', errorCode: 'engine_unavailable' } });
      expect(first.terminate).toHaveBeenCalledTimes(1);

      const second = FakeSimulationWorker.instances[1];
      second.onmessage({ data: { type: 'simulation_result', simResult: { encounters: 2 } } });
      second.onmessage({ data: { type: 'simulation_result', simResult: { encounters: 3 } } });

      await expect(promise).resolves.toEqual({
        simResults: [null, { encounters: 2 }, { encounters: 3 }],
        errors: ['engine down', null, null],
      });
      // 成功收尾的续跑 realm 保活（下次调用复用），不被弃置。
      expect(second.terminate).not.toHaveBeenCalled();
    } finally {
      sharedWorkerClient.stopSimulation();
      global.Worker = originalWorker;
    }
  });

  it('cancels the whole batch through the scoped handle', async () => {
    const promise = runSimulationBatchWithDedicatedWorker([{ id: 1 }], vi.fn(), {
      scope: DEDICATED_WORKER_SCOPE_TRIGGER_OPTIMIZER,
      WorkerClientCtor: FakeWorkerClient,
    });
    stopTriggerOptimizerWorkerRuns();

    const error = await promise.catch((reason) => reason);
    expect(isWorkerRunCancelledError(error)).toBe(true);
    expect(FakeWorkerClient.instances[0].stopSimulation).toHaveBeenCalledTimes(1);
  });

  it('reports every settled item through the optional onItemSettled callback', async () => {
    const settled = [];
    const promise = runSimulationBatchWithDedicatedWorker([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }], vi.fn(), {
      scope: DEDICATED_WORKER_SCOPE_TRIGGER_OPTIMIZER,
      WorkerClientCtor: FakeWorkerClient,
      onItemSettled: (index, error) => {
        settled.push([index, error]);
      },
    });
    const client = FakeWorkerClient.instances[0];
    client.emitBatchResult({ encounters: 1 }, 0);
    client.emitBatchAbort('realm exploded', 1);

    // realm 级崩溃后换新 realm，只带剩下的 payload（全局 index 2、3）。
    const second = FakeWorkerClient.instances[1];
    expect(second.payloads).toEqual([{ id: 3 }, { id: 4 }]);
    second.emitBatchResult({ encounters: 3 }, 0);
    second.emitBatchError('boom', 1);
    second.emitBatchComplete();

    await expect(promise).resolves.toEqual({
      simResults: [{ encounters: 1 }, null, { encounters: 3 }, null],
      errors: [null, 'realm exploded', null, 'boom'],
    });
    // 正常完成：保活 realm，不弃置。
    expect(second.stopSimulation).not.toHaveBeenCalled();
    expect(settled).toEqual([
      [0, null],
      [1, 'realm exploded'],
      [2, null],
      [3, 'boom'],
    ]);
  });

  it('discards the batch realm when the progress callback throws', async () => {
    const progressError = new Error('progress failed');
    const promise = runSimulationBatchWithDedicatedWorker(
      [{ id: 1 }, { id: 2 }],
      () => {
        throw progressError;
      },
      {
        scope: DEDICATED_WORKER_SCOPE_TRIGGER_OPTIMIZER,
        WorkerClientCtor: FakeWorkerClient,
      },
    );
    const client = FakeWorkerClient.instances[0];

    client.emitBatchProgress({ progress: 0.25 });

    await expect(promise).rejects.toBe(progressError);
    // 回调抛错 = 消费端故障域：终止止损（弃置 realm），与 multi 路径统一，防回归锚定。
    expect(client.stopSimulation).toHaveBeenCalledTimes(1);
  });

  it('discards the batch realm when the onItemSettled callback throws', async () => {
    const settledError = new Error('item settled failed');
    const promise = runSimulationBatchWithDedicatedWorker([{ id: 1 }, { id: 2 }], vi.fn(), {
      scope: DEDICATED_WORKER_SCOPE_TRIGGER_OPTIMIZER,
      WorkerClientCtor: FakeWorkerClient,
      onItemSettled: () => {
        throw settledError;
      },
    });
    const client = FakeWorkerClient.instances[0];

    client.emitBatchResult({ encounters: 1 }, 0);

    await expect(promise).rejects.toBe(settledError);
    // 回调抛错 = 消费端故障域：终止止损（弃置 realm），与 multi 路径统一，防回归锚定。
    expect(client.stopSimulation).toHaveBeenCalledTimes(1);
  });

  it('defaults to the scope keep-alive pool for batches and reuses the realm (§reuse)', async () => {
    vi.stubGlobal('Worker', FakeSimulationWorker);
    try {
      const scope = DEDICATED_WORKER_SCOPE_HOME_MULTI_ROUND;
      const first = runSimulationBatchWithDedicatedWorker([{ id: 1 }, { id: 2 }], vi.fn(), { scope });
      const firstWorker = FakeSimulationWorker.instances[0];
      expect(firstWorker).toBeTruthy();

      firstWorker.onmessage({ data: { type: 'simulation_result', simResult: { encounters: 1 } } });
      firstWorker.onmessage({ data: { type: 'simulation_result', simResult: { encounters: 2 } } });
      await expect(first).resolves.toEqual({
        simResults: [{ encounters: 1 }, { encounters: 2 }],
        errors: [null, null],
      });
      // 正常完成：realm 保活归还池（不 terminate）。
      expect(firstWorker.terminate).not.toHaveBeenCalled();

      // 第二个串行批量：复用归还的空闲 realm，不新建 worker。
      const second = runSimulationBatchWithDedicatedWorker([{ id: 3 }], vi.fn(), { scope });
      expect(FakeSimulationWorker.instances).toHaveLength(1);
      firstWorker.onmessage({ data: { type: 'simulation_result', simResult: { encounters: 3 } } });
      await expect(second).resolves.toEqual({ simResults: [{ encounters: 3 }], errors: [null] });
      expect(firstWorker.terminate).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('isolates concurrent batch calls on the production pool (no cross-supersede) (§pool)', async () => {
    vi.stubGlobal('Worker', FakeSimulationWorker);
    try {
      // 同一 scope 的两个并发批量调用各自持有一实例：后到的绝不抢占先到的
      //（池化前二者共享「共享保活单例」，后者会把前者以 cancelled supersede 掉）。
      const scope = 'test-batch-concurrency';
      const promiseA = runSimulationBatchWithDedicatedWorker([{ id: 1 }], vi.fn(), { scope });
      const promiseB = runSimulationBatchWithDedicatedWorker([{ id: 2 }], vi.fn(), { scope });

      const workerA = FakeSimulationWorker.instances[0];
      const workerB = FakeSimulationWorker.instances[1];
      expect(workerA).toBeTruthy();
      expect(workerB).toBeTruthy();

      workerA.onmessage({ data: { type: 'simulation_result', simResult: { encounters: 1 } } });
      workerB.onmessage({ data: { type: 'simulation_result', simResult: { encounters: 2 } } });

      await expect(promiseA).resolves.toEqual({ simResults: [{ encounters: 1 }], errors: [null] });
      await expect(promiseB).resolves.toEqual({ simResults: [{ encounters: 2 }], errors: [null] });
      // 两个运行都没有被对方抢占终止。
      expect(workerA.terminate).not.toHaveBeenCalled();
      expect(workerB.terminate).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('settles a superseded batch promise with cancellation instead of hanging (§supersede)', async () => {
    const originalWorker = global.Worker;
    global.Worker = FakeSimulationWorker;
    try {
      // 注入路径显式共享同一实例：锚定「同一实例被两个运行先后使用」时旧 promise 被显式取消
      // 收尾、绝不挂起（生产路径已池化，并发批量不再共享实例——见并发隔离用例）。
      const options = { workerClient: sharedWorkerClient };
      const firstPromise = runSimulationBatchWithDedicatedWorker([{ id: 1 }], vi.fn(), options);
      const firstWorker = FakeSimulationWorker.instances[0];
      // 后到的运行（同一实例）抢占：旧 promise 必须被显式取消收尾，而不是永久挂起。
      const secondPromise = runSimulationBatchWithDedicatedWorker([{ id: 2 }, { id: 3 }], vi.fn(), options);

      await expect(firstPromise).rejects.toMatchObject({ code: 'cancelled' });
      expect(firstWorker.terminate).toHaveBeenCalledTimes(1);

      // 新 batch 继续正常完成，且不被旧运行的收尾误杀。
      const secondWorker = FakeSimulationWorker.instances[1];
      secondWorker.onmessage({ data: { type: 'simulation_result', simResult: { encounters: 2 } } });
      secondWorker.onmessage({ data: { type: 'simulation_result', simResult: { encounters: 3 } } });
      await expect(secondPromise).resolves.toEqual({
        simResults: [{ encounters: 2 }, { encounters: 3 }],
        errors: [null, null],
      });
      expect(secondWorker.terminate).not.toHaveBeenCalled();
    } finally {
      sharedWorkerClient.stopSimulation();
      global.Worker = originalWorker;
    }
  });

  it('settles a superseded multi promise with cancellation instead of hanging (§supersede)', async () => {
    const originalWorker = global.Worker;
    global.Worker = FakeSimulationWorker;
    try {
      const firstPromise = runMultiSimulationPayloadWithDedicatedWorker(
        { type: 'start_simulation_all_zones' },
        vi.fn(),
        {},
      );
      const firstWorker = FakeSimulationWorker.instances[0];
      // 注入路径显式共享同一实例发起后续运行：多区域入口仍走共享保活单例（批量生产路径已
      // 池化、不再与多区域共享实例），本用例锚定「共享实例被抢占」的 supersede 防御。
      const secondPromise = runSimulationBatchWithDedicatedWorker([{ id: 1 }], vi.fn(), {
        workerClient: sharedWorkerClient,
      });

      await expect(firstPromise).rejects.toMatchObject({ code: 'cancelled' });
      expect(firstWorker.terminate).toHaveBeenCalledTimes(1);

      // 抢占者的 realm 不被旧运行的取消收尾误杀（不能走 discardRealm 分支）。
      const secondWorker = FakeSimulationWorker.instances[1];
      secondWorker.onmessage({ data: { type: 'simulation_result', simResult: { encounters: 9 } } });
      await expect(secondPromise).resolves.toEqual({ simResults: [{ encounters: 9 }], errors: [null] });
      expect(secondWorker.terminate).not.toHaveBeenCalled();
    } finally {
      sharedWorkerClient.stopSimulation();
      global.Worker = originalWorker;
    }
  });
});

// 单场专用运行的生产路径保活池：正常完成归还 scope 级池复用（不新建 realm），
// 失败域弃置；注入桩路径语义不变（不进池）。生产路径不注入任何 Ctor / 实例，
// 经 vi.stubGlobal('Worker') 用 FakeSimulationWorker 统计真实 realm 创建数。
describe('dedicated single run keep-alive pool', () => {
  afterEach(() => {
    // 跨用例清池：终止池内残留 client，防模块级池状态泄漏到其它用例。
    resetDedicatedSingleClientPools();
  });

  it('reuses the same realm across sequential production runs (§reuse)', async () => {
    vi.stubGlobal('Worker', FakeSimulationWorker);
    try {
      const scope = DEDICATED_WORKER_SCOPE_QUEUE;
      const first = runSingleSimulationPayloadWithDedicatedWorker({ type: 'start_simulation' }, vi.fn(), { scope });
      const firstWorker = FakeSimulationWorker.instances[0];
      firstWorker.onmessage({ data: { type: 'simulation_result', simResult: { encounters: 1 } } });
      await expect(first).resolves.toEqual({ encounters: 1 });

      // 正常完成：realm 归还池保活（不 terminate），下一场复用同一 realm。
      const second = runSingleSimulationPayloadWithDedicatedWorker({ type: 'start_simulation' }, vi.fn(), { scope });
      expect(FakeSimulationWorker.instances.length).toBe(1);
      firstWorker.onmessage({ data: { type: 'simulation_result', simResult: { encounters: 2 } } });
      await expect(second).resolves.toEqual({ encounters: 2 });

      expect(FakeSimulationWorker.instances.length).toBe(1);
      expect(firstWorker.terminate).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('discards the realm on failure and acquires a fresh one for the next run', async () => {
    vi.stubGlobal('Worker', FakeSimulationWorker);
    try {
      const scope = DEDICATED_WORKER_SCOPE_QUEUE;
      const first = runSingleSimulationPayloadWithDedicatedWorker({ type: 'start_simulation' }, vi.fn(), { scope });
      const firstWorker = FakeSimulationWorker.instances[0];
      // 真 client 在 onError 前已 finishRun(healthy:false) terminate；settle 侧的
      // stopSimulation 是幂等空操作（保留调用以与注入路径收尾语义统一）。
      firstWorker.onmessage({ data: { type: 'simulation_error', error: 'boom' } });

      await expect(first).rejects.toBe('boom');
      expect(firstWorker.terminate).toHaveBeenCalledTimes(1);

      // 失败域不归还：下一场 acquire 池空，新建 realm。
      const second = runSingleSimulationPayloadWithDedicatedWorker({ type: 'start_simulation' }, vi.fn(), { scope });
      expect(FakeSimulationWorker.instances.length).toBe(2);
      const secondWorker = FakeSimulationWorker.instances[1];
      secondWorker.onmessage({ data: { type: 'simulation_result', simResult: { encounters: 3 } } });
      await expect(second).resolves.toEqual({ encounters: 3 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('scales out for concurrent runs and reuses pooled realms afterwards', async () => {
    vi.stubGlobal('Worker', FakeSimulationWorker);
    try {
      const scope = DEDICATED_WORKER_SCOPE_QUEUE;
      // 并发两场：池空各自 new（绝不向同一 realm 并发投递两场）。
      const firstWave = [
        runSingleSimulationPayloadWithDedicatedWorker({ type: 'start_simulation' }, vi.fn(), { scope }),
        runSingleSimulationPayloadWithDedicatedWorker({ type: 'start_simulation' }, vi.fn(), { scope }),
      ];
      expect(FakeSimulationWorker.instances.length).toBe(2);
      FakeSimulationWorker.instances[0].onmessage({
        data: { type: 'simulation_result', simResult: { encounters: 1 } },
      });
      FakeSimulationWorker.instances[1].onmessage({
        data: { type: 'simulation_result', simResult: { encounters: 2 } },
      });
      await Promise.all(firstWave);

      // 第二波同样并发两场：全部命中池内复用，不再新建 realm。
      const secondWave = [
        runSingleSimulationPayloadWithDedicatedWorker({ type: 'start_simulation' }, vi.fn(), { scope }),
        runSingleSimulationPayloadWithDedicatedWorker({ type: 'start_simulation' }, vi.fn(), { scope }),
      ];
      expect(FakeSimulationWorker.instances.length).toBe(2);
      FakeSimulationWorker.instances[0].onmessage({
        data: { type: 'simulation_result', simResult: { encounters: 3 } },
      });
      FakeSimulationWorker.instances[1].onmessage({
        data: { type: 'simulation_result', simResult: { encounters: 4 } },
      });
      await Promise.all(secondWave);

      expect(FakeSimulationWorker.instances.length).toBe(2);
      expect(FakeSimulationWorker.instances[0].terminate).not.toHaveBeenCalled();
      expect(FakeSimulationWorker.instances[1].terminate).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('raises the per-scope idle capacity to the configured parallel limit', async () => {
    vi.stubGlobal('Worker', FakeSimulationWorker);
    try {
      const scope = DEDICATED_WORKER_SCOPE_EXPERIMENTAL;
      const poolCapacity = DEDICATED_SINGLE_POOL_MAX_IDLE_PER_SCOPE + 4;
      const runWave = async () => {
        const promises = Array.from({ length: poolCapacity }, () =>
          runSingleSimulationPayloadWithDedicatedWorker({ type: 'start_simulation' }, vi.fn(), { scope, poolCapacity }),
        );
        expect(FakeSimulationWorker.instances.length).toBe(poolCapacity);
        for (const worker of Array.from(FakeSimulationWorker.instances)) {
          worker.onmessage({ data: { type: 'simulation_result', simResult: { encounters: 1 } } });
        }
        await Promise.all(promises);
      };

      await runWave();
      expect(FakeSimulationWorker.instances.length).toBe(poolCapacity);
      expect(FakeSimulationWorker.instances.filter((worker) => worker.terminate.mock.calls.length > 0)).toHaveLength(0);

      await runWave();
      expect(FakeSimulationWorker.instances.length).toBe(poolCapacity);
      expect(FakeSimulationWorker.instances.filter((worker) => worker.terminate.mock.calls.length > 0)).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the injected stub path out of the pool (regression anchor)', async () => {
    const scope = DEDICATED_WORKER_SCOPE_QUEUE;
    const first = runSingleSimulationPayloadWithDedicatedWorker({ type: 'start_simulation' }, vi.fn(), {
      scope,
      WorkerClientCtor: FakeWorkerClient,
    });
    const firstClient = FakeWorkerClient.instances[0];
    firstClient.emit('onResult', { encounters: 1 });
    await expect(first).resolves.toEqual({ encounters: 1 });
    expect(firstClient.stopSimulation).toHaveBeenCalledTimes(1);

    // 注入路径语义不变：每次 new、settle 无条件 stop、绝不进池（第二场是新实例）。
    const second = runSingleSimulationPayloadWithDedicatedWorker({ type: 'start_simulation' }, vi.fn(), {
      scope,
      WorkerClientCtor: FakeWorkerClient,
    });
    expect(FakeWorkerClient.instances.length).toBe(2);
    const secondClient = FakeWorkerClient.instances[1];
    secondClient.emit('onResult', { encounters: 2 });
    await expect(second).resolves.toEqual({ encounters: 2 });
    expect(secondClient.stopSimulation).toHaveBeenCalledTimes(1);
    expect(firstClient.stopSimulation).toHaveBeenCalledTimes(1);
  });

  it('caps the idle pool per scope and releases excess realms immediately (no parked realms)', async () => {
    vi.stubGlobal('Worker', FakeSimulationWorker);
    try {
      const scope = DEDICATED_WORKER_SCOPE_EXPERIMENTAL;
      // 2026-10-04 修复锚定：超限归还者必须立即终止回收，不再"既不复用也不终止"地
      // 悬挂等待 5min 空闲自燃（大批量运行下那会造成未终止 realm 无界累积）。
      const poolLimit = DEDICATED_SINGLE_POOL_MAX_IDLE_PER_SCOPE;
      const waveSize = poolLimit + 1;
      const runWave = async () => {
        const promises = [];
        for (let index = 0; index < waveSize; index += 1) {
          promises.push(
            runSingleSimulationPayloadWithDedicatedWorker({ type: 'start_simulation' }, vi.fn(), { scope }),
          );
        }
        // 给当前全部实例派发 result：在跑的各自结算；已终止 / 未进池的旧实例已被
        // settled 幂等防护挡住，重复消息只会空转。
        for (const worker of Array.from(FakeSimulationWorker.instances)) {
          worker.onmessage({ data: { type: 'simulation_result', simResult: { encounters: 1 } } });
        }
        await Promise.all(promises);
      };

      await runWave();
      expect(FakeSimulationWorker.instances.length).toBe(waveSize);
      // 第一波恰好 1 个超限归还者被立即终止（其余全部进池保活）。
      expect(FakeSimulationWorker.instances.filter((worker) => worker.terminate.mock.calls.length > 0).length).toBe(1);

      // 第二波同量并发：poolLimit 次复用 + 1 次新建（新者完成后再被回收），池容量保持。
      await runWave();
      expect(FakeSimulationWorker.instances.length).toBe(waveSize + 1);
      expect(FakeSimulationWorker.instances.filter((worker) => worker.terminate.mock.calls.length > 0).length).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('releases an idle-expired pooled realm immediately on acquire (lazy expiry path)', async () => {
    // fake timers：把系统时钟拨过 5min 空闲期而不触发定时器（模拟浏览器节流 / 冻结
    // 形态下 idle 定时器未跑）——只有 acquire 的惰性检查能发现过期，故必须 fake 时钟。
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeSimulationWorker);
    try {
      const scope = DEDICATED_WORKER_SCOPE_EXPERIMENTAL;
      const first = runSingleSimulationPayloadWithDedicatedWorker({ type: 'start_simulation' }, vi.fn(), { scope });
      FakeSimulationWorker.instances[0].onmessage({
        data: { type: 'simulation_result', simResult: { encounters: 1 } },
      });
      await expect(first).resolves.toEqual({ encounters: 1 });

      // 拨快系统时钟越过空闲回收期（setSystemTime 只改时钟，不跑定时器）。
      vi.setSystemTime(Date.now() + 6 * 60 * 1000);

      const second = runSingleSimulationPayloadWithDedicatedWorker({ type: 'start_simulation' }, vi.fn(), { scope });
      // acquire 惰性检测到过期：旧 realm 立即终止回收，改为新建 realm（不悬挂等待）。
      expect(FakeSimulationWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
      expect(FakeSimulationWorker.instances.length).toBe(2);
      FakeSimulationWorker.instances[1].onmessage({
        data: { type: 'simulation_result', simResult: { encounters: 2 } },
      });
      await expect(second).resolves.toEqual({ encounters: 2 });
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

// 手动 multi 路径（首页全迷宫 / 全区域）的共享句柄包装：runSharedMultiSimulationPayload
// 与 runSharedSingleSimulationPayload 同款注册 / 取代 / 取消语义，仅回调形状不同
//（onBatchResult / onItemResult）。此前 store 直连 startMultiSimulation 不注册句柄，
// hasSharedWorkerRunInProgress() 对手动运行全盲；这里锚定句柄可见性、收尾语义与取代链。
describe('shared multi run handle', () => {
  it('resolves normalized batch results, keeps the handle visible while running, and never stops the client on success', async () => {
    const client = new FakeWorkerClient();
    const onItemResult = vi.fn();
    const promise = runSharedMultiSimulationPayload({ type: 'start_simulation_all_zones' }, vi.fn(), {
      workerClient: client,
      onItemResult,
    });
    const item = { index: 0, simResult: { encounters: 4 } };

    // 运行期间共享句柄必须可见：这是全部「只查 hasSharedWorkerRunInProgress」的
    // 纵深防线（触发器优化器服务层闸门等）对手动 multi 运行生效的前提。
    expect(hasSharedWorkerRunInProgress()).toBe(true);

    client.emit('onItemResult', item);
    client.emit('onProgress', { progress: 0.5 });
    client.emit('onBatchResult', [{ encounters: 4 }], 'simulation_result_allZones');

    await expect(promise).resolves.toEqual({
      simResults: [{ encounters: 4 }],
      batchResultType: 'simulation_result_allZones',
    });
    expect(onItemResult).toHaveBeenCalledWith(item);
    // settle 之后句柄注销：防线恢复放行。
    expect(hasSharedWorkerRunInProgress()).toBe(false);
    // 正常完成保活 realm：不 stopWorker。
    expect(client.stopSimulation).not.toHaveBeenCalled();
  });

  it('rejects with the cancellation code and stops the client exactly once when cancelSharedWorkerRun is invoked', async () => {
    const client = new FakeWorkerClient();
    const promise = runSharedMultiSimulationPayload({ type: 'start_simulation_all_zones' }, vi.fn(), {
      workerClient: client,
    });

    // 用户「停止」：terminate realm（stopWorker=true）并以 cancelled 收尾。
    cancelSharedWorkerRun();

    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    expect(client.stopSimulation).toHaveBeenCalledTimes(1);
    expect(hasSharedWorkerRunInProgress()).toBe(false);
  });

  it('does not stop the client when onError receives a cancelled error (realm owned by the preemptor)', async () => {
    const client = new FakeWorkerClient();
    const promise = runSharedMultiSimulationPayload({ type: 'start_simulation_all_zones' }, vi.fn(), {
      workerClient: client,
    });

    // 被新请求抢占（supersede）：realm 已易主，stopWorker 会误杀抢占者，必须只 reject。
    const supersededError = new Error('Realm superseded by a newer run.');
    supersededError.code = 'cancelled';
    client.emit('onError', supersededError);

    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    expect(client.stopSimulation).not.toHaveBeenCalled();
    expect(hasSharedWorkerRunInProgress()).toBe(false);
  });

  it('supersedes a pending shared multi run with a cancellation error when a new shared run starts', async () => {
    const firstClient = new FakeWorkerClient();
    const firstPromise = runSharedMultiSimulationPayload(
      { type: 'start_simulation_all_zones', runId: 'first' },
      vi.fn(),
      {
        workerClient: firstClient,
      },
    );
    expect(hasSharedWorkerRunInProgress()).toBe(true);

    const secondClient = new FakeWorkerClient();
    const secondPromise = runSharedMultiSimulationPayload(
      { type: 'start_simulation_all_zones', runId: 'second' },
      vi.fn(),
      { workerClient: secondClient },
    );

    // 被取代的旧运行以 cancelled 收尾（用户取消语义，terminate 旧 realm），
    // 且不得清除最新运行的句柄。
    await expect(firstPromise).rejects.toMatchObject({ code: 'cancelled' });
    expect(firstClient.stopSimulation).toHaveBeenCalledTimes(1);
    expect(hasSharedWorkerRunInProgress()).toBe(true);

    secondClient.emit('onBatchResult', [{ encounters: 8 }], 'simulation_result_allZones');
    await expect(secondPromise).resolves.toEqual({
      simResults: [{ encounters: 8 }],
      batchResultType: 'simulation_result_allZones',
    });
    expect(secondClient.stopSimulation).not.toHaveBeenCalled();
    expect(hasSharedWorkerRunInProgress()).toBe(false);
  });
});

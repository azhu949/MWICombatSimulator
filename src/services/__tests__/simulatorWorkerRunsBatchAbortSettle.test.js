// 回归锚定（2026-10-02）：批量路径 onAbort 换 realm 续跑时，realm 重建可能同步抛错
//（Ctor 桩重建失败 / new Worker 资源耗尽）。旧实现的 onAbort 分支中「重建 client +
// 递归 startRealmBatch()」没有 try/catch 兜底，且此刻运行看门狗已随 finishRun(healthy:false)
// 清除 —— 同步异常逃逸出 workerClient 的消息/错误处理器后，批 promise 永久挂起、无任何兜底。
// 本文件锚定修复后的收尾语义：任何同步抛错都收敛为整批 reject，而不是挂起或逃逸。
import { afterEach, describe, expect, it, vi } from 'vitest';
import sharedWorkerClient from '../workerClient.js';
import {
  DEDICATED_WORKER_SCOPE_HOME_MULTI_ROUND,
  cancelDedicatedWorkerRuns,
  runSimulationBatchWithDedicatedWorker,
} from '../simulatorWorkerRuns.js';

// 第二次构造才抛错的 Worker 桩：第一次（正常起步）成功，onAbort 换 realm 的重建失败。
class FailOnSecondConstructionWorker {
  static instances = [];
  static constructionCount = 0;

  constructor(url, options) {
    FailOnSecondConstructionWorker.constructionCount += 1;
    if (FailOnSecondConstructionWorker.constructionCount > 1) {
      throw new Error('Worker construction failed: simulated resource exhaustion');
    }
    this.url = String(url);
    this.options = options;
    this.postMessage = vi.fn();
    this.terminate = vi.fn();
    this.onmessage = null;
    this.onerror = null;
    FailOnSecondConstructionWorker.instances.push(this);
  }

  static reset() {
    FailOnSecondConstructionWorker.instances = [];
    FailOnSecondConstructionWorker.constructionCount = 0;
  }
}

// 第二次构造才抛错的 client 桩（WorkerClientCtor 注入形态，与生产 new Worker 同构）。
class FailOnSecondConstructionClient {
  static instances = [];
  static constructionCount = 0;

  constructor() {
    FailOnSecondConstructionClient.constructionCount += 1;
    if (FailOnSecondConstructionClient.constructionCount > 1) {
      throw new Error('stub client construction failed');
    }
    this.payloads = [];
    this.batchHandlers = {};
    this.stopSimulation = vi.fn();
    FailOnSecondConstructionClient.instances.push(this);
  }

  startSimulationBatch(payloads, handlers = {}) {
    this.payloads = Array.isArray(payloads) ? payloads : [];
    this.batchHandlers = handlers;
  }

  emitBatchAbort(error, index) {
    this.batchHandlers?.onAbort?.(error, index);
  }

  static reset() {
    FailOnSecondConstructionClient.instances = [];
    FailOnSecondConstructionClient.constructionCount = 0;
  }
}

// 观察批 promise 在窗口期内是否结算：挂起时返回 'pending'，比超时失败输出更可读。
async function observeSettlement(promise, timeoutMs = 200) {
  let timer = null;
  const outcome = await Promise.race([
    promise.then(
      (value) => ({ status: 'resolved', value }),
      (error) => ({ status: 'rejected', error }),
    ),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ status: 'pending' }), timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  return outcome;
}

afterEach(() => {
  FailOnSecondConstructionWorker.reset();
  FailOnSecondConstructionClient.reset();
  vi.unstubAllGlobals();
  cancelDedicatedWorkerRuns();
  sharedWorkerClient.stopSimulation();
});

describe('simulatorWorkerRuns batch realm-rebuild failure', () => {
  it('rejects the batch promise when rebuilding the realm throws synchronously (production path)', async () => {
    vi.stubGlobal('Worker', FailOnSecondConstructionWorker);
    sharedWorkerClient.stopSimulation();

    const promise = runSimulationBatchWithDedicatedWorker([{ id: 1 }, { id: 2 }], vi.fn(), {
      scope: DEDICATED_WORKER_SCOPE_HOME_MULTI_ROUND,
    });
    const firstWorker = FailOnSecondConstructionWorker.instances[0];

    try {
      // 事件处理器形态：旧实现中构造错误从 worker.onerror 处理器同步逃逸（另有独立用例断言）。
      firstWorker.onerror(new Error('realm crashed'));
    } catch (error) {
      // 逃逸证据由下方 observeSettlement 单独断言：此处吞掉以观察 promise 的最终归宿。
    }

    const outcome = await observeSettlement(promise);
    // 修复前：'pending'（永久挂起）；修复后：以 realm 重建错误 reject。
    expect(outcome.status).toBe('rejected');
    expect(outcome.error?.message).toContain('simulated resource exhaustion');
  });

  it('does not let a synchronous realm-rebuild error escape the worker error handler', async () => {
    vi.stubGlobal('Worker', FailOnSecondConstructionWorker);
    sharedWorkerClient.stopSimulation();

    const promise = runSimulationBatchWithDedicatedWorker([{ id: 1 }, { id: 2 }], vi.fn(), {
      scope: DEDICATED_WORKER_SCOPE_HOME_MULTI_ROUND,
    });
    const firstWorker = FailOnSecondConstructionWorker.instances[0];

    let thrownError = null;
    try {
      firstWorker.onerror(new Error('realm crashed'));
    } catch (error) {
      thrownError = error;
    }

    // 修复前：同步异常逃逸出事件处理器（真实浏览器中成为 uncaught error）；修复后：null。
    expect(thrownError).toBeNull();
    // 且整批必须以重建错误收尾而非挂起。
    await expect(promise).rejects.toThrow('simulated resource exhaustion');
  });

  it('rejects the batch promise when the injected client ctor throws during realm rebuild', async () => {
    const promise = runSimulationBatchWithDedicatedWorker([{ id: 1 }, { id: 2 }], vi.fn(), {
      scope: DEDICATED_WORKER_SCOPE_HOME_MULTI_ROUND,
      WorkerClientCtor: FailOnSecondConstructionClient,
    });
    const firstClient = FailOnSecondConstructionClient.instances[0];

    try {
      firstClient.emitBatchAbort('realm exploded', 0);
    } catch (error) {
      // 旧实现：桩构造错误同样逃逸（生产路径由 new Worker 扮演同一角色）。
    }

    const outcome = await observeSettlement(promise);
    // 修复前：'pending'；修复后：以桩构造错误 reject。
    expect(outcome.status).toBe('rejected');
    expect(outcome.error?.message).toContain('stub client construction failed');
  });
});

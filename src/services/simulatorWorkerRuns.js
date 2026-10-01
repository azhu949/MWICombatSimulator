import sharedWorkerClient, { WorkerClient } from './workerClient.js';

export const DEDICATED_WORKER_SCOPE_QUEUE = 'queue';
export const DEDICATED_WORKER_SCOPE_ADVISOR = 'advisor';
export const DEDICATED_WORKER_SCOPE_EXPERIMENTAL = 'experimental';
// 技能触发器优化器：每个候选评估各起一个专用 worker（设计 §3.2/§4.1）。
export const DEDICATED_WORKER_SCOPE_TRIGGER_OPTIMIZER = 'trigger-optimizer';
// 首页单目标「多轮模拟」：全部播种轮次收进一个专用 realm（批量入口）跑完，由 store 聚合。
export const DEDICATED_WORKER_SCOPE_HOME_MULTI_ROUND = 'home-multi-round';

const dedicatedWorkerRuns = new Set();
let sharedWorkerRunHandle = null;

export function createWorkerRunCancellationError(message = 'Simulation cancelled.') {
  const error = new Error(message);
  error.code = 'cancelled';
  return error;
}

export function isWorkerRunCancelledError(error) {
  return Boolean(error?.code === 'cancelled');
}

function registerDedicatedWorkerRun(workerRunHandle) {
  if (workerRunHandle) {
    dedicatedWorkerRuns.add(workerRunHandle);
  }
}

function unregisterDedicatedWorkerRun(workerRunHandle) {
  if (workerRunHandle) {
    dedicatedWorkerRuns.delete(workerRunHandle);
  }
}

export function cancelDedicatedWorkerRuns(
  predicate = () => true,
  cancellationError = createWorkerRunCancellationError(),
) {
  for (const workerRunHandle of Array.from(dedicatedWorkerRuns)) {
    if (!predicate(workerRunHandle)) {
      continue;
    }
    try {
      workerRunHandle.cancel(cancellationError);
    } catch (error) {
      // 清理专属 worker 时忽略取消错误
    }
  }
}

export function stopQueueWorkerClients() {
  cancelDedicatedWorkerRuns((workerRunHandle) => workerRunHandle.scope === DEDICATED_WORKER_SCOPE_QUEUE);
}

export function stopAdvisorWorkerRuns() {
  cancelDedicatedWorkerRuns((workerRunHandle) => workerRunHandle.scope === DEDICATED_WORKER_SCOPE_ADVISOR);
}

// 用户点「停止」时由 store 调用（设计 §4.3）：取消所有触发器优化器专用 worker
// 运行，在途任务以 code:'cancelled' 拒绝，搜索层据此收尾而非上报失败。
export function stopTriggerOptimizerWorkerRuns() {
  cancelDedicatedWorkerRuns((workerRunHandle) => workerRunHandle.scope === DEDICATED_WORKER_SCOPE_TRIGGER_OPTIMIZER);
}

// 用户点「停止」时由 store 调用：取消首页多轮模拟的专用批运行（整批以 code:'cancelled' 拒绝）。
export function stopHomeMultiRoundWorkerRuns() {
  cancelDedicatedWorkerRuns((workerRunHandle) => workerRunHandle.scope === DEDICATED_WORKER_SCOPE_HOME_MULTI_ROUND);
}

// 首页多轮批运行是否在途：startSimulation 的防重入检查使用——批运行不在共享运行句柄里，
// 若不加这一项，多轮运行期间再点「开始」会并发启动第二个批运行。
export function hasHomeMultiRoundWorkerRunInProgress() {
  for (const workerRunHandle of dedicatedWorkerRuns) {
    if (workerRunHandle.scope === DEDICATED_WORKER_SCOPE_HOME_MULTI_ROUND) {
      return true;
    }
  }
  return false;
}

function unregisterSharedWorkerRun(workerRunHandle) {
  if (sharedWorkerRunHandle === workerRunHandle) {
    sharedWorkerRunHandle = null;
  }
}

export function cancelSharedWorkerRun(cancellationError = createWorkerRunCancellationError()) {
  if (!sharedWorkerRunHandle) {
    return;
  }

  try {
    sharedWorkerRunHandle.cancel(cancellationError);
  } catch (error) {
    // 清理共享 worker 时忽略取消错误
  }
}

export function hasSharedWorkerRunInProgress() {
  return Boolean(sharedWorkerRunHandle);
}

export function runSingleSimulationPayloadWithDedicatedWorker(payload, onProgress = () => {}, options = {}) {
  const ClientCtor = typeof options?.WorkerClientCtor === 'function' ? options.WorkerClientCtor : WorkerClient;
  return new Promise((resolve, reject) => {
    const dedicatedClient = new ClientCtor();
    const scope = String(options?.scope || DEDICATED_WORKER_SCOPE_QUEUE);
    let settled = false;
    let workerRunHandle = null;

    const settle = (callback, value) => {
      if (settled) {
        return;
      }

      settled = true;

      try {
        dedicatedClient.stopSimulation();
      } catch (error) {
        // 收尾专属 worker 时忽略停止错误
      }

      unregisterDedicatedWorkerRun(workerRunHandle);
      callback(value);
    };

    workerRunHandle = {
      scope,
      cancel: (error = createWorkerRunCancellationError()) => {
        settle(reject, error);
      },
    };
    registerDedicatedWorkerRun(workerRunHandle);

    if (typeof options?.onHandle === 'function') {
      try {
        options.onHandle(workerRunHandle);
      } catch (error) {
        settle(reject, error);
        return;
      }
    }

    if (settled) {
      return;
    }

    try {
      dedicatedClient.startSimulation(payload, {
        onProgress: (data) => {
          if (settled) {
            return;
          }
          try {
            onProgress(data);
          } catch (error) {
            settle(reject, error);
          }
        },
        onResult: (simResult) => {
          settle(resolve, simResult);
        },
        onError: (error) => {
          settle(reject, error);
        },
      });
    } catch (error) {
      settle(reject, error);
    }
  });
}

// 批量能力探测（§54，2026-09-27）：生产 WorkerClient 有 startSimulationBatch（一个 realm 跑完
// 一次评估的全部种子）；测试注入的桩通常只有 startSimulation/stopSimulation —— 调用方据此
// 决定走批量还是逐场路径（逐场路径的语义完全不变）。
export function supportsSimulationBatch(WorkerClientCtor) {
  const Ctor = typeof WorkerClientCtor === 'function' ? WorkerClientCtor : WorkerClient;
  return typeof Ctor?.prototype?.startSimulationBatch === 'function';
}

// §54（2026-09-27）批量入口：一个 realm 跑完 list 里的全部 payload（每条 = 一场模拟）。
// 与 runSingleSimulationPayloadWithDedicatedWorker 的取消语义、scope、handle 注册完全一致
// （stopTriggerOptimizerWorkerRuns 一样能定向取消、以 code:'cancelled' 拒绝整批），区别只在
// 「realm 只建一次」—— 生产端每建一个 realm 都要付一次模块加载（装置实测 ≈0.43s/场，占单场
// 墙钟约一半），而一次评估的 N 场本来就是串行跑的，收进同一个 realm 不改变任何样本
// （装置 parity 16/16 逐位一致，见设计 §54）。
// 返回 Promise<{ simResults, errors }>：与 payloads 等长；失败位 simResults[i] = null、
// errors[i] = 失败原因（调用方按 createDegenerateMetrics 处置，与逐场路径的 catch 分支同款）。
// realm 级崩溃：把在飞的那一条记为失败，换一个新 realm 接着跑剩下的 —— 与「每场新建 realm」
// 形态的失败传播等价（那一场退化为失败样本，其余照跑）。
// 正确性前提（评审检查项）：引擎在同一 realm 连续两次 simulate 之间没有会改变结果的状态
// 残留（共享 buff 对象不得就地改写、模块级缓存不得跨场积累等）。该前提由
// src/services/__tests__/simulatorRealmReuseParity.test.js 在常规流水线内锚定：
// 同一批种子「同 realm 连跑」与「每场全新 realm」的 simResult 逐位一致 ——
// 改动引擎引入任何非确定性残留时该测试即红。
export function runSimulationBatchWithDedicatedWorker(payloads, onProgress = () => {}, options = {}) {
  const ClientCtor = typeof options?.WorkerClientCtor === 'function' ? options.WorkerClientCtor : WorkerClient;
  const list = Array.isArray(payloads) ? payloads : [];
  return new Promise((resolve, reject) => {
    const scope = String(options?.scope || DEDICATED_WORKER_SCOPE_QUEUE);
    const simResults = new Array(list.length).fill(null);
    const errors = new Array(list.length).fill(null);
    let settled = false;
    let nextIndex = 0;
    let client = new ClientCtor();
    let workerRunHandle = null;

    const settle = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;

      try {
        client.stopSimulation();
      } catch (error) {
        // 收尾专属 worker 时忽略停止错误（与逐场路径同款）
      }

      unregisterDedicatedWorkerRun(workerRunHandle);
      callback(value);
    };

    workerRunHandle = {
      scope,
      cancel: (error = createWorkerRunCancellationError()) => settle(reject, error),
    };
    registerDedicatedWorkerRun(workerRunHandle);

    // 「单条已结算」可选回调：每条 payload 出结果/失败/中止时按 index 恰好触发一次
    // （中止换 realm 续跑的形态下，在飞的那条先记为失败）。纯增量——既有调用方不传
    // 就是零行为；回调抛错与 onProgress 同款处理（拒绝整批）。
    const notifyItemSettled = (itemIndex, error) => {
      const callback = options?.onItemSettled;
      if (typeof callback !== 'function') {
        return;
      }
      try {
        callback(itemIndex, error);
      } catch (callbackError) {
        settle(reject, callbackError);
      }
    };

    const startRealmBatch = () => {
      if (settled) {
        return;
      }
      if (nextIndex >= list.length) {
        settle(resolve, { simResults, errors });
        return;
      }
      const base = nextIndex;
      const activeClient = client;
      activeClient.startSimulationBatch(list.slice(base), {
        onProgress: (data) => {
          if (settled) {
            return;
          }
          try {
            onProgress(data);
          } catch (error) {
            settle(reject, error);
          }
        },
        onResult: (simResult, offset) => {
          simResults[base + offset] = simResult;
          nextIndex = base + offset + 1;
          notifyItemSettled(base + offset, null);
        },
        onError: (error, offset) => {
          errors[base + offset] = error;
          nextIndex = base + offset + 1;
          notifyItemSettled(base + offset, error);
        },
        onAbort: (error, offset) => {
          // realm 级崩溃：在飞的那一条记失败，换一个新 realm 从下一条继续（见上方说明）。
          if (settled) {
            return;
          }
          const failedIndex = base + Math.max(0, Number(offset) || 0);
          errors[failedIndex] = error;
          nextIndex = failedIndex + 1;
          notifyItemSettled(failedIndex, error);

          try {
            activeClient.stopSimulation();
          } catch (stopError) {
            // 崩溃的 realm 可能已经不在：忽略
          }

          client = new ClientCtor();
          startRealmBatch();
        },
        onComplete: () => settle(resolve, { simResults, errors }),
      });
    };

    try {
      startRealmBatch();
    } catch (error) {
      settle(reject, error);
    }
  });
}

export function runMultiSimulationPayloadWithDedicatedWorker(payload, onProgress = () => {}, options = {}) {
  const ClientCtor = typeof options?.WorkerClientCtor === 'function' ? options.WorkerClientCtor : WorkerClient;
  return new Promise((resolve, reject) => {
    const dedicatedClient = new ClientCtor();
    const scope = String(options?.scope || DEDICATED_WORKER_SCOPE_QUEUE);
    const onItemResult = typeof options?.onItemResult === 'function' ? options.onItemResult : () => {};
    let settled = false;
    let workerRunHandle = null;

    const settle = (callback, value) => {
      if (settled) {
        return;
      }

      settled = true;

      try {
        dedicatedClient.stopSimulation();
      } catch (error) {
        // 收尾专属 worker 时忽略停止错误
      }

      unregisterDedicatedWorkerRun(workerRunHandle);
      callback(value);
    };

    workerRunHandle = {
      scope,
      cancel: (error = createWorkerRunCancellationError()) => {
        settle(reject, error);
      },
    };
    registerDedicatedWorkerRun(workerRunHandle);

    try {
      dedicatedClient.startMultiSimulation(payload, {
        onProgress: (data) => {
          if (settled) {
            return;
          }
          try {
            onProgress(data);
          } catch (error) {
            settle(reject, error);
          }
        },
        onItemResult: (data) => {
          if (settled) {
            return;
          }
          try {
            onItemResult(data);
          } catch (error) {
            settle(reject, error);
          }
        },
        onBatchResult: (simResults, batchResultType) => {
          settle(resolve, {
            simResults: Array.isArray(simResults) ? simResults : [],
            batchResultType: String(batchResultType || ''),
          });
        },
        onError: (error) => {
          settle(reject, error);
        },
      });
    } catch (error) {
      settle(reject, error);
    }
  });
}

export function runSharedSingleSimulationPayload(payload, onProgress = () => {}, options = {}) {
  const workerClient = options?.workerClient || sharedWorkerClient;
  return new Promise((resolve, reject) => {
    let settled = false;
    let workerRunHandle = null;

    const settle = (callback, value, stopWorker = false) => {
      if (settled) {
        return;
      }

      settled = true;

      if (stopWorker) {
        try {
          workerClient.stopSimulation();
        } catch (error) {
          // 收尾共享 worker 时忽略停止错误
        }
      }

      unregisterSharedWorkerRun(workerRunHandle);
      callback(value);
    };

    workerRunHandle = {
      cancel: (error = createWorkerRunCancellationError()) => {
        settle(reject, error, true);
      },
    };
    if (sharedWorkerRunHandle) {
      // 取代先前的共享运行：以取消错误收尾，使其在共享客户端复用时
      // 不会挂起，然后接管。
      sharedWorkerRunHandle.cancel(createWorkerRunCancellationError('Superseded by a new shared worker run.'));
    }
    sharedWorkerRunHandle = workerRunHandle;

    if (typeof options?.onHandle === 'function') {
      try {
        options.onHandle(workerRunHandle);
      } catch (error) {
        // 回调在 startSimulation 之前运行，因此本次运行没有
        // 需要在此停止的 worker。
        settle(reject, error);
        return;
      }
    }

    if (settled) {
      return;
    }

    try {
      workerClient.startSimulation(payload, {
        onProgress: (data) => {
          if (settled) {
            return;
          }
          try {
            onProgress(data);
          } catch (error) {
            settle(reject, error, true);
          }
        },
        onResult: (simResult) => {
          settle(resolve, simResult);
        },
        onError: (error) => {
          settle(reject, error);
        },
      });
    } catch (error) {
      settle(reject, error, true);
    }
  });
}

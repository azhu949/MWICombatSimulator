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

// ── 单场专用运行的生产路径保活池（2026-10-02）──
// 背景：本入口的生产路径此前每场 new 一个 WorkerClient、settle 无条件 stopSimulation，
// 即每场都重建 realm（worker bundle + wasm 加载/编译，装置实测 ≈0.43s/场，约占单场
// 墙钟一半）。批量（runSimulationBatchWithDedicatedWorker）与多区域
// （runMultiSimulationPayloadWithDedicatedWorker）入口已默认走共享保活单例，这里按
// scope 分池为单场路径补齐同样的复用收益：
// - acquire：从该 scope 的空闲池 LIFO 取一个可复用 client（canReuseRealm('single')），
//   跳过并弃掉不可复用的死引用（5min 空闲自燃 terminate 后的空壳、达 maxRuns 上限者、
//   超空闲期者——其终止/回收均由 client 自身机制完成，无需额外 stop）；池空则 new。
// - release：仅正常完成（onResult）归还；失败域（取消 / onError / 回调抛错 /
//   startSimulation 同步抛错）由调用方 stopSimulation 弃置，绝不归还。
// 「一个 realm 同一时刻只跑一场」不受影响：归还发生在 settle 同步段（真 client 的
// finishRun 已先行复位 busy），acquire 只会取到非 busy 实例；并发超出池容量的场次
// 各自 new 新 client。
// 池内只可能是真 WorkerClient（import 自 './workerClient.js' 的类）；注入路径
// （options.workerClient / options.WorkerClientCtor）完全不进池。
// 正确性前提（同 realm 连跑无跨场状态残留）由
// src/services/__tests__/simulatorRealmReuseParity.test.js 在常规流水线锚定。
const dedicatedSingleClientPools = new Map();
// 按作用域的空闲池容量上限：并行 lane 数可能大于保活价值（queue 并行池、评估器
// 并发），4 个空闲 realm 足以覆盖常见复用且限制驻留内存；超出的实例不归还池，由
// 该 client 自身的 5min 空闲自动回收兜底释放。
const DEDICATED_SINGLE_POOL_MAX_IDLE_PER_SCOPE = 4;

// 取用：LIFO（栈顶是最近归还者，局部性最好）；不可复用的实例直接弃掉引用。
function acquireDedicatedSingleClient(scope) {
  const pool = dedicatedSingleClientPools.get(scope);
  while (pool && pool.length > 0) {
    const client = pool.pop();
    if (client.canReuseRealm('single')) {
      return client;
    }
  }
  return new WorkerClient();
}

// 归还：仅 healthy 且池未达上限时 push；否则不归还（失败域已由调用方
// stopSimulation 弃置；超上限者留给其自身 5min 空闲自动回收）。
function releaseDedicatedSingleClient(scope, client, { healthy }) {
  if (!healthy) {
    return;
  }
  const pool = dedicatedSingleClientPools.get(scope) || [];
  if (pool.length >= DEDICATED_SINGLE_POOL_MAX_IDLE_PER_SCOPE) {
    return;
  }
  pool.push(client);
  dedicatedSingleClientPools.set(scope, pool);
}

// 测试专用：跨用例清池（遍历终止各池内 client 后清空 Map），防模块级状态泄漏
// 到后续用例。生产代码不调用。
export function resetDedicatedSingleClientPools() {
  for (const pool of dedicatedSingleClientPools.values()) {
    for (const client of pool) {
      try {
        client.stopSimulation();
      } catch (error) {
        // 测试清理时忽略终止错误
      }
    }
  }
  dedicatedSingleClientPools.clear();
}

// 单场专用入口：一条 start_simulation payload 跑一场，resolve 该场 simResult。
// 客户端来源（优先级从高到低）：
// 1) options.workerClient 实例注入（测试）：直接使用该实例 —— settle 无条件
//    stopSimulation、不进池，与既有语义完全一致；
// 2) options.WorkerClientCtor 注入（旧测试桩）：每次 new 一个专用实例 —— 收尾语义
//    同上，不进池；
// 3) 生产路径（无任何注入）：从 scope 级保活池 acquire（见上方池注释块）—— 正常
//    完成归还池供后续复用（不调 stopSimulation）；失败域调 stopSimulation 弃置且
//    不归还（真 client 的 onError 前置 finishRun(healthy:false) 已 terminate，此时
//    stopSimulation 是幂等空操作，保留调用以与注入路径的收尾语义统一）。
// 取消语义、workerRunHandle 注册/注销、onHandle 回调、settled 幂等防护均保持不变；
// 同 realm 连跑的正确性前提由 simulatorRealmReuseParity.test.js 锚定。
export function runSingleSimulationPayloadWithDedicatedWorker(payload, onProgress = () => {}, options = {}) {
  return new Promise((resolve, reject) => {
    const scope = String(options?.scope || DEDICATED_WORKER_SCOPE_QUEUE);
    let dedicatedClient;
    let pooled = false;
    if (options?.workerClient) {
      dedicatedClient = options.workerClient;
    } else if (typeof options?.WorkerClientCtor === 'function') {
      dedicatedClient = new options.WorkerClientCtor();
    } else {
      dedicatedClient = acquireDedicatedSingleClient(scope);
      pooled = true;
    }
    let settled = false;
    let workerRunHandle = null;

    const settle = (callback, value, { healthy = false } = {}) => {
      if (settled) {
        return;
      }

      settled = true;

      if (pooled && healthy) {
        // 生产池路径正常完成：不终止 realm，归还池（真 client 的 finishRun 已在
        // onResult 回调前复位 busy 并挂 5min 空闲自动回收）。
        releaseDedicatedSingleClient(scope, dedicatedClient, { healthy: true });
      } else {
        try {
          dedicatedClient.stopSimulation();
        } catch (error) {
          // 收尾专属 worker 时忽略停止错误
        }
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
          settle(resolve, simResult, { healthy: true });
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
// 改动引擎引入任何非确定性残留时该测试即红。（该测试在切片 21B 曾随 JS 引擎物理
// 删除，2026-10-01 以 wasm 形态重建。）
export function runSimulationBatchWithDedicatedWorker(payloads, onProgress = () => {}, options = {}) {
  const list = Array.isArray(payloads) ? payloads : [];
  return new Promise((resolve, reject) => {
    const scope = String(options?.scope || DEDICATED_WORKER_SCOPE_QUEUE);
    const simResults = new Array(list.length).fill(null);
    const errors = new Array(list.length).fill(null);
    let settled = false;
    let nextIndex = 0;
    // realm 复用（2026-10-01）：默认共享保活单例 —— 正常完成后 realm 保活（下次调用复用）；
    // Ctor 注入是测试桩路径（每次 new 专用实例，语义不变）。
    let client = resolveRunWorkerClient(options);
    let workerRunHandle = null;

    const settle = (callback, value, { discardRealm = false } = {}) => {
      if (settled) {
        return;
      }
      settled = true;

      if (discardRealm) {
        try {
          client.stopSimulation();
        } catch (error) {
          // 收尾批量 realm 时忽略停止错误（取消 / 失败域弃置，与逐场路径同款）
        }
      }

      unregisterDedicatedWorkerRun(workerRunHandle);
      callback(value);
    };

    workerRunHandle = {
      scope,
      cancel: (error = createWorkerRunCancellationError()) => settle(reject, error, { discardRealm: true }),
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
        // 回调抛错属消费端故障域：统一为终止止损，与 multi 路径（runMultiSimulationPayloadWithDedicatedWorker）
        // 一致。promise 已拒绝且取消链已注销，保活跑完剩余条目只是无谓 CPU 消耗。
        settle(reject, callbackError, { discardRealm: true });
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
            // 回调抛错属消费端故障域：统一为终止止损，与 multi 路径（runMultiSimulationPayloadWithDedicatedWorker）
            // 一致。promise 已拒绝且取消链已注销，保活跑完剩余条目只是无谓 CPU 消耗。
            settle(reject, error, { discardRealm: true });
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
          if (isWorkerRunCancelledError(error)) {
            // 被新请求抢占（supersede）：realm 已易主，不得换 realm 续跑（会与抢占者
            // 来回互杀），整批以取消错误收尾——保证 promise 不静默挂起。
            settle(reject, error);
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

          // 换 realm 续跑：重建 client（Ctor 注入路径）与递归投递都可能同步抛错（new Worker
          // 资源耗尽 / 桩构造失败），且此处已无看门狗兜底（finishRun 已清除）——必须收敛为
          // 整批拒绝，否则异常逃逸出本回调，批 promise 永久挂起（与下方初次调用同款处理）。
          try {
            // 共享保活单例：终止后复用同一客户端实例（其内部在下次请求时自动重建 realm）；
            // Ctor 注入（测试桩路径）保留「换新实例」的既有语义。
            if (typeof options?.WorkerClientCtor === 'function' || options?.workerClient) {
              client =
                typeof options?.WorkerClientCtor === 'function' ? new options.WorkerClientCtor() : options.workerClient;
            }
            startRealmBatch();
          } catch (error) {
            settle(reject, error);
          }
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

// 运行客户端解析（2026-10-01 realm 复用）：显式注入的 workerClient 实例优先（测试）；
// 其次 WorkerClientCtor（旧测试桩注入，每次 new 一个专用实例）；否则共享保活单例 ——
// 复用「空闲且健康」的 realm，省掉每次调用重建 realm 的固定开销（engine 的加载 / 编译；
// 复用一致性由 simulatorRealmReuseParity.test.js 锚定）。
function resolveRunWorkerClient(options) {
  if (options?.workerClient) {
    return options.workerClient;
  }
  if (typeof options?.WorkerClientCtor === 'function') {
    return new options.WorkerClientCtor();
  }
  return sharedWorkerClient;
}

// 多区域 / 全迷宫专用入口（advisor 扫描、首页全区域各调用此入口）：把一条
// start_simulation_all_zones / all_labyrinths 消息交给 multi worker 跑完一批。
// realm 复用（2026-10-01）：默认走共享保活单例 —— 正常完成后 realm 保活（父 realm +
// 子 worker 池跨调用复用）；取消 / 失败 / 同步异常显式弃置（下次调用重建）。
export function runMultiSimulationPayloadWithDedicatedWorker(payload, onProgress = () => {}, options = {}) {
  return new Promise((resolve, reject) => {
    const client = resolveRunWorkerClient(options);
    const scope = String(options?.scope || DEDICATED_WORKER_SCOPE_QUEUE);
    const onItemResult = typeof options?.onItemResult === 'function' ? options.onItemResult : () => {};
    let settled = false;
    let workerRunHandle = null;

    const settle = (callback, value, { discardRealm = false } = {}) => {
      if (settled) {
        return;
      }

      settled = true;

      if (discardRealm) {
        try {
          client.stopSimulation();
        } catch (error) {
          // 收尾 realm 时忽略停止错误
        }
      }

      unregisterDedicatedWorkerRun(workerRunHandle);
      callback(value);
    };

    workerRunHandle = {
      scope,
      cancel: (error = createWorkerRunCancellationError()) => {
        settle(reject, error, { discardRealm: true });
      },
    };
    registerDedicatedWorkerRun(workerRunHandle);

    try {
      client.startMultiSimulation(payload, {
        onProgress: (data) => {
          if (settled) {
            return;
          }
          try {
            onProgress(data);
          } catch (error) {
            settle(reject, error, { discardRealm: true });
          }
        },
        onItemResult: (data) => {
          if (settled) {
            return;
          }
          try {
            onItemResult(data);
          } catch (error) {
            settle(reject, error, { discardRealm: true });
          }
        },
        onBatchResult: (simResults, batchResultType) => {
          settle(resolve, {
            simResults: Array.isArray(simResults) ? simResults : [],
            batchResultType: String(batchResultType || ''),
          });
        },
        onError: (error) => {
          if (isWorkerRunCancelledError(error)) {
            // 被新请求抢占（supersede）：realm 已易主，不能按失败域弃置（discardRealm 的
            // stopSimulation 会误杀抢占者的 realm），整单以取消错误收尾。
            settle(reject, error);
            return;
          }
          settle(reject, error, { discardRealm: true });
        },
      });
    } catch (error) {
      settle(reject, error, { discardRealm: true });
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

// 手动 multi 路径（首页全迷宫 / 全区域）的共享运行句柄注册入口：镜像上方
// runSharedSingleSimulationPayload 的注册 / 取代 / 取消语义，把一条
// start_simulation_all_zones / all_labyrinths 消息经共享客户端跑完一批。此前
// store 的这两条路径直连 workerClient.startMultiSimulation、不注册任何运行句柄，
// 导致 hasSharedWorkerRunInProgress() 在手动运行期间恒为 false——所有只查该函数
// 的纵深防线（触发器优化器服务层闸门等）看不到手动运行，形成跨功能互斥盲区。
// 取代语义：新的共享运行开始时先以 cancelled 错误收尾旧句柄（realm 已被新请求
// 抢占，不 stopWorker，防误杀抢占者），再接管共享句柄；用户「停止」经
// cancelSharedWorkerRun 以 cancelled 拒绝并 terminate realm（stopWorker=true）。
// 与 runMultiSimulationPayloadWithDedicatedWorker（专用 / 池化路径，advisor 扫描
// 与各批量入口使用，scope 定向取消）的分工：本函数只面向共享保活客户端上的
// multi 手动运行，不进 dedicated 句柄集。
export function runSharedMultiSimulationPayload(payload, onProgress = () => {}, options = {}) {
  const workerClient = options?.workerClient || sharedWorkerClient;
  return new Promise((resolve, reject) => {
    const onItemResult = typeof options?.onItemResult === 'function' ? options.onItemResult : () => {};
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
        // 回调在 startMultiSimulation 之前运行，因此本次运行没有
        // 需要在此停止的 worker。
        settle(reject, error);
        return;
      }
    }

    if (settled) {
      return;
    }

    try {
      workerClient.startMultiSimulation(payload, {
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
        onItemResult: (data) => {
          if (settled) {
            return;
          }
          try {
            onItemResult(data);
          } catch (error) {
            settle(reject, error, true);
          }
        },
        onBatchResult: (simResults, batchResultType) => {
          // 正常完成：保活 realm（父 realm + 子 worker 池跨调用复用），
          // 不 stopWorker。
          settle(resolve, {
            simResults: Array.isArray(simResults) ? simResults : [],
            batchResultType: String(batchResultType || ''),
          });
        },
        onError: (error) => {
          // 与 single 版同口径：真实 WorkerClient 的 simulation_error / onerror
          // 已在内部 finishRun(healthy:false) 弃置 realm，这里不额外 stopWorker；
          // 被抢占（cancelled）时 realm 已易主，同样绝不 stopWorker。
          settle(reject, error);
        },
      });
    } catch (error) {
      settle(reject, error, true);
    }
  });
}

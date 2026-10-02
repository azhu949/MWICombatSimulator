// 多区域 / 全迷宫并行批处理器（父 worker 入口）。
//
// 保活与池化（2026-10-01）：
//   - 父 realm 跨批保活：不再在一批结束后 self.close()；等待下一条批消息。
//   - 子 worker 池化：任务成功后子 worker 回池（子 realm 里 wasm 引擎已加载，
//     省掉每任务重建的加载/编译）；失败/取消的子树弃置（terminate），不回池 ——
//     异常路径整批失败由主线程弃置父 realm 统一回收（见下）。
//   - 生命周期与回收归主线程 WorkerClient 统一管：空闲超时 / 次数上限 / 用户停止
//     都会 terminate 父 realm，子 worker 随父级联终止（2026-10-01 实测：Chrome/
//     Electron 下 classic 与 module 子 worker 均级联终止——父 terminate / self.close
//     后子 worker 停止运行）。因此本文件不自行 close，也不做池的持久化回收。
//   - busy 门：保活后的防重叠防线 —— 上一批未结束时收到新批消息说明上游异常
//     （主线程 WorkerClient 与 store 层各有防重入），回 simulation_error 让主线程
//     弃置重建，而不是并发跑批。
//   - 死信防线（2026-10-02）：池化取用前 prewarm_ping 存活校验（见 POOL_PING_TIMEOUT_MS），
//     任务投递后挂静默看门狗（见 CHILD_TASK_STALL_TIMEOUT_MS）——闲置子 realm 若被浏览器
//     回收，postMessage 不抛错也不回消息，两道防线保证判死弃置而不是整批永久挂起。
export function emitAggregateProgress(workerScope, progressState) {
  const values = Object.values(progressState);
  const totalProgress = values.length > 0 ? values.reduce((acc, progress) => acc + progress, 0) / values.length : 0;
  workerScope.postMessage({ type: 'simulation_progress', progress: totalProgress });
}

function normalizeWorkerError(error) {
  return error?.message || String(error);
}

function terminateChildWorker(worker) {
  try {
    worker?.terminate?.();
  } catch (error) {
    // 清理子 worker 时忽略其终止错误
  }
}

function getHardwareWorkerLimit() {
  const rawLimit = Number(globalThis?.navigator?.hardwareConcurrency || 1);
  if (!Number.isFinite(rawLimit) || rawLimit <= 0) {
    return 1;
  }
  return Math.max(1, Math.floor(rawLimit));
}

function getEffectiveWorkerLimit(eventData = {}, targetCount = 0) {
  const normalizedTargetCount = Math.max(0, Math.floor(Number(targetCount || 0)));
  if (normalizedTargetCount <= 0) {
    return 0;
  }

  const hardwareWorkerLimit = getHardwareWorkerLimit();
  const requestedWorkerLimit = Math.floor(Number(eventData?.parallelWorkerLimit));
  if (!Number.isFinite(requestedWorkerLimit) || requestedWorkerLimit <= 0) {
    return Math.min(hardwareWorkerLimit, normalizedTargetCount);
  }

  return Math.min(hardwareWorkerLimit, normalizedTargetCount, requestedWorkerLimit);
}

function buildMultiSimulationConfig(eventData = {}) {
  if (eventData?.type === 'start_simulation_all_zones') {
    return {
      resultType: 'simulation_result_allZones',
      targets: Array.isArray(eventData.zones) ? eventData.zones : [],
      buildProgressKey: (zone) => `${zone.zoneHrid}#${zone.difficultyTier}`,
      buildWorkerMessage: (zone) => ({
        type: 'start_simulation',
        players: eventData.players,
        zone,
        extra: eventData.extra,
        simulationTimeLimit: eventData.simulationTimeLimit,
        // 切片 18：主线程批量消息的 wasm 开关原样透传给每个子 worker。
        ...(eventData.useWasmEngine === true ? { useWasmEngine: true } : {}),
        ...(eventData.simulationContext && typeof eventData.simulationContext === 'object'
          ? { simulationContext: eventData.simulationContext }
          : {}),
      }),
      buildItemResult: (zone, index, simResult) => ({
        type: 'simulation_item_result',
        index,
        zone,
        zoneHrid: zone.zoneHrid,
        difficultyTier: zone.difficultyTier,
        simResult,
      }),
    };
  }

  if (eventData?.type === 'start_simulation_all_labyrinths') {
    return {
      resultType: 'simulation_result_allLabyrinths',
      targets: Array.isArray(eventData.labyrinths) ? eventData.labyrinths : [],
      buildProgressKey: (labyrinth) => `${labyrinth.labyrinthHrid}#${labyrinth.roomLevel}`,
      buildWorkerMessage: (labyrinth) => ({
        type: 'start_simulation',
        players: eventData.players,
        labyrinth,
        extra: eventData.extra,
        simulationTimeLimit: eventData.simulationTimeLimit,
        // 切片 18：主线程批量消息的 wasm 开关原样透传给每个子 worker。
        ...(eventData.useWasmEngine === true ? { useWasmEngine: true } : {}),
        ...(eventData.simulationContext && typeof eventData.simulationContext === 'object'
          ? { simulationContext: eventData.simulationContext }
          : {}),
      }),
      buildItemResult: (labyrinth, index, simResult) => ({
        type: 'simulation_item_result',
        index,
        labyrinth,
        labyrinthHrid: labyrinth.labyrinthHrid,
        roomLevel: labyrinth.roomLevel,
        simResult,
      }),
    };
  }

  return null;
}

// ── 死信防线（2026-10-02）──
// 池化 / 保活复用引入的暴露面：闲置子 worker 可能被浏览器回收（如 OOM），此时 postMessage
// 既不抛错也不回消息；worker.js 的 wasm 路径在 result 前又没有流式 progress（整场静默），
// 「正在计算」与「已死」只能靠上限时间窗区分。两道防线：
//   1. 池化取用前先做 prewarm_ping 存活校验（复用 worker.js 既有握手，零协议扩散）；
//   2. 任务投递后挂静默看门狗，超窗判死并按失败向上传播（父层整批失败）。
export const POOL_PING_TIMEOUT_MS = 1000;

// 静默看门狗窗口：wasm 无流式 progress → 静默期 ≈ 单场计算时长上限，窗口取远大于任何
// 合法单场模拟的值（30 分钟），防误杀优先；真实死信只影响用户的等待时长。
export const CHILD_TASK_STALL_TIMEOUT_MS = 30 * 60 * 1000;

// ── 子 worker 池（保活改造）──
// 池内成员 = 已完成任务、等待复用的子 worker（LIFO 取用）。任务成功的子 worker 回池；
// 失败/取消的子 worker 直接 terminate（不回池，「一个子 realm 同一时刻只跑一场」且
// 失败域不复用）。
const idleChildWorkers = [];

// 批末池收缩的最小保留数（两层回收边界的本层参数，2026-10-02）：
//   - 本层（父 realm 内）：每批结束时把池收缩到 min(池大小, 本批 maxWorkers)，批末快速
//     降掉内存高水位 —— 高 parallelWorkerLimit 批跑完后，池中每个子 worker 都持有已增长的
//     wasm 线性内存，若不收缩，空闲期会整批滞留，低内存设备承压；
//   - 上层（主线程 WorkerClient）：idleEvictMs（默认 5 分钟，见
//     src/services/workerClient.js 的 DEFAULT_IDLE_EVICT_MS）空闲超时 terminate 父 realm，
//     子 worker 随父级联终止 —— 本层收缩后保留的残余由上层兜底回收。
// 本常量是收缩目标的下限：至少保留这么多个最近使用的热 worker，避免空批 / 异常批
// （maxWorkers 为 0）把热池清成零，导致下一批冷启动。
const IDLE_CHILD_POOL_MIN_KEEP = 1;

// 当前在跑批次的 token（busy 门）；null = 空闲可接收下一批。
let activeBatchToken = null;

// 池化 worker 存活校验：发 prewarm_ping 等 prewarm_pong（无副作用、立即回包）。
// true = 存活（临时 handler 已解绑，后续由 runTask 重新绑定任务 handler）；
// false = 超时 / onerror / 发送失败判死（调用方 terminate 后新建替补）。
function verifyChildWorkerLiveness(worker) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (alive) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      // 等待结束必须解绑临时 handler（池内闲置期不接收/处理任何消息）。
      worker.onmessage = null;
      worker.onerror = null;
      resolve(alive);
    };
    timer = setTimeout(() => finish(false), POOL_PING_TIMEOUT_MS);
    // 先绑 handler 再 postMessage：同步回包（已就绪的 worker）也要能接住。
    worker.onmessage = (event) => {
      if (event?.data?.type === 'prewarm_pong') {
        finish(true);
      }
    };
    worker.onerror = () => finish(false);
    try {
      worker.postMessage({ type: 'prewarm_ping' });
    } catch (error) {
      finish(false);
    }
  });
}

async function acquireChildWorker() {
  const pooledWorker = idleChildWorkers.pop();
  if (!pooledWorker) {
    // 池空：新建的 worker 无从闲置回收，不做 ping。
    return new Worker(new URL('worker.js', import.meta.url), { type: 'module' });
  }
  const alive = await verifyChildWorkerLiveness(pooledWorker);
  if (alive) {
    return pooledWorker;
  }
  // 池中 worker 已死（闲置期被回收/崩溃）：弃置后新建替补。
  terminateChildWorker(pooledWorker);
  return new Worker(new URL('worker.js', import.meta.url), { type: 'module' });
}

// 取用配套闸（§abort-race 约定的结构化封装）：acquire 返回后必须立刻过 aborted 检查，
// 该约定此前散落在 runTask 内的手工 if —— 任何后续改动在 acquire 与检查之间引入新
// await 或新逻辑都会绕过它，回归为「残留 lane 白跑一场 + 30 分钟看门狗超时 + busy 门
// 锁死」。封装后 runTask 只能经由本函数取得子 worker，约定不可绕过。
// 返回 null = 本 lane 所属批次已中止：刚取得的子 worker 即使通过了存活校验也被弃置
//（状态未知，不回池——见下方弃置点注释），调用方直接返回。
async function acquireChildWorkerForBatch(isAborted) {
  const worker = await acquireChildWorker();
  if (isAborted()) {
    // 弃置已取得的子 worker：可能刚通过 prewarm 存活校验（活着），但本 lane 归属旧批
    // 闭包、aborted 恒为真，投递只会白跑一场且结果被 aborted 早退丢弃；terminate 幂等，
    // 不回池（回池会让「已绑定下一批期望」的池混入旧批 worker）。
    terminateChildWorker(worker);
    return null;
  }
  return worker;
}

function releaseChildWorker(worker) {
  // 回池前解绑上一任务的处理器：池中闲置期间不接收/处理任何消息（新任务取用时重新绑定）。
  worker.onmessage = null;
  worker.onerror = null;
  idleChildWorkers.push(worker);
}

// 批末池收缩：把池收缩到 keepCount 个（两层回收边界说明见 IDLE_CHILD_POOL_MIN_KEEP 处
// 注释）。池是 LIFO（push/pop 都在数组尾部，尾部 = 最近使用）：收缩必须从头部（最久未用
// 端）shift 出来 terminate，保留最近使用的热 worker。调用点在批 finally —— 此时所有 lane
// 已 settle（Promise.all 已结束），无在途 acquire 竞争，可以安全改写池。
function shrinkIdleChildWorkerPool(keepCount) {
  const normalizedKeepCount = Math.max(IDLE_CHILD_POOL_MIN_KEEP, Math.floor(Number(keepCount) || 0));
  while (idleChildWorkers.length > normalizedKeepCount) {
    terminateChildWorker(idleChildWorkers.shift());
  }
}

/// 测试注入：清空池与 busy 门（避免用例间共享模块级状态）。
export function resetMultiWorkerPoolForTests() {
  idleChildWorkers.length = 0;
  activeBatchToken = null;
}

export async function handleMultiSimulationMessage(eventData = {}, workerScope = globalThis) {
  const config = buildMultiSimulationConfig(eventData);
  if (!config) {
    return;
  }

  // busy 门：保活后父 realm 可能收到重叠批消息（上游异常）；大声失败让主线程弃置重建。
  if (activeBatchToken) {
    workerScope.postMessage({
      type: 'simulation_error',
      error: new Error('multi worker is busy with an in-flight batch; rebuild the realm.'),
    });
    return;
  }
  const batchToken = {};
  activeBatchToken = batchToken;

  const progressState = Object.fromEntries(config.targets.map((target) => [config.buildProgressKey(target), 0]));
  const taskQueue = config.targets.map((target, index) => ({ index, target }));
  const results = new Array(config.targets.length);
  const activeTaskControls = new Set();
  let aborted = false;
  // 本批并发上限：声明提升到 try 外（初值 0），保证 aborted 批 / 取值异常的批在 finally
  // 里也能拿到本批收缩目标（见 finally 的批末池收缩）。
  let maxWorkers = 0;

  const cancelActiveTasks = (error) => {
    for (const taskControl of Array.from(activeTaskControls)) {
      try {
        taskControl.cancel(error);
      } catch (cancelError) {
        // 清理活动任务控制器时忽略任务取消错误
      }
    }
  };

  const runTask = async ({ index, target }) => {
    const progressKey = config.buildProgressKey(target);
    // 兄弟 lane 失败/中止可能落在本 lane 的 acquire 等待期（池空微任务间隙 / 池内 prewarm
    // ping 窗口）：此时 taskControl 尚未注册，cancelActiveTasks 覆盖不到本 lane。恢复后由
    // acquireChildWorkerForBatch 的 aborted 闸统一弃置并返回 null（约定说明见该函数注释）。
    const simulationWorker = await acquireChildWorkerForBatch(() => aborted);
    if (!simulationWorker) {
      return;
    }
    let taskControl = null;

    try {
      const simResult = await new Promise((resolve, reject) => {
        let settled = false;
        // 静默看门狗 timer：每次任务投递后启动，结算前清理（见文件顶部死信防线说明）。
        let stallTimer = null;
        const clearStallTimer = () => {
          if (stallTimer !== null) {
            clearTimeout(stallTimer);
            stallTimer = null;
          }
        };
        const settle = (callback, value, { keepWorker = false } = {}) => {
          if (settled) {
            return;
          }
          settled = true;
          // 成功 / 失败 / 取消 / 看门狗任一结算路径都必须清理看门狗，不得残留 timer。
          clearStallTimer();
          activeTaskControls.delete(taskControl);
          if (keepWorker) {
            // 任务成功：子 worker 回池等待下一个任务（保活复用的核心）。
            releaseChildWorker(simulationWorker);
          } else {
            // 失败 / 取消：弃置子 worker（子 realm 状态未知或任务未完成）。
            terminateChildWorker(simulationWorker);
          }
          callback(value);
        };

        // 静默看门狗：自「最后一条消息」起算；窗口内无任何来自该子 worker 的消息即判死。
        const armStallWatchdog = () => {
          clearStallTimer();
          stallTimer = setTimeout(() => {
            // 超窗判死：reject 明确错误 → runTask 失败分支弃置子 worker → 顶层向主线程
            // 上报 simulation_error（父层整批失败）。
            settle(
              reject,
              new Error(`Child worker stalled: no message within ${CHILD_TASK_STALL_TIMEOUT_MS}ms; realm discarded.`),
            );
          }, CHILD_TASK_STALL_TIMEOUT_MS);
        };

        taskControl = {
          cancel: (error) => {
            settle(reject, error);
          },
        };
        activeTaskControls.add(taskControl);

        simulationWorker.onmessage = (workerEvent) => {
          if (aborted || settled) {
            return;
          }

          // 任何消息（progress/result/error）都是存活信号：静默窗口自最后一条消息重新起算。
          armStallWatchdog();

          const data = workerEvent.data ?? {};
          if (data.type === 'simulation_result') {
            progressState[progressKey] = 1;
            emitAggregateProgress(workerScope, progressState);
            workerScope.postMessage(config.buildItemResult(target, index, data.simResult));
            settle(resolve, data.simResult, { keepWorker: true });
            return;
          }

          if (data.type === 'simulation_progress') {
            progressState[progressKey] = Number(data.progress || 0);
            emitAggregateProgress(workerScope, progressState);
            return;
          }

          if (data.type === 'simulation_error') {
            settle(reject, data.error);
          }
        };

        simulationWorker.onerror = (error) => {
          settle(reject, normalizeWorkerError(error));
        };

        try {
          // 先武装看门狗再投递：postMessage 不抛错也不回消息的静默死信由看门狗兜底。
          armStallWatchdog();
          simulationWorker.postMessage(config.buildWorkerMessage(target));
        } catch (error) {
          settle(reject, error);
        }
      });

      results[index] = simResult;
    } catch (error) {
      aborted = true;
      cancelActiveTasks(error);
      throw error;
    }
  };

  const processTaskQueue = async () => {
    while (!aborted && taskQueue.length > 0) {
      const nextTask = taskQueue.shift();
      if (!nextTask) {
        return;
      }
      // eslint-disable-next-line no-await-in-loop
      await runTask(nextTask);
    }
  };

  try {
    maxWorkers = getEffectiveWorkerLimit(eventData, config.targets.length);
    const workers = Array.from({ length: maxWorkers }, () => processTaskQueue());
    await Promise.all(workers);
    if (!aborted) {
      workerScope.postMessage({ type: config.resultType, simResults: results });
    }
  } catch (error) {
    cancelActiveTasks(error);
    workerScope.postMessage({ type: 'simulation_error', error });
  } finally {
    if (activeBatchToken === batchToken) {
      activeBatchToken = null;
    }
    // 批末池收缩（两层回收边界的本层）：把池降到本批并发上限 min(池大小, 本批 maxWorkers)，
    // 防止高并发批跑完后子 worker（各含已增长的 wasm 线性内存）在空闲期整批滞留，等上层
    // （主线程 WorkerClient idleEvictMs，默认 5 分钟）terminate 父 realm 才级联回收。
    shrinkIdleChildWorkerPool(maxWorkers);
    // 注意：不再 closeWorkerScope() —— 父 realm 保活（回收由主线程 WorkerClient 统一管，
    // terminate 父时子 worker 级联终止）。
  }
}

const workerScope = globalThis;
if (workerScope && typeof workerScope.postMessage === 'function') {
  workerScope.onmessage = async function (event) {
    await handleMultiSimulationMessage(event.data, workerScope);
  };
}

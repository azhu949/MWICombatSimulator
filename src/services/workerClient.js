/**
 * @typedef {Object} SingleSimulationWorkerPayload
 * @property {"start_simulation"} type
 * @property {string} workerId
 * @property {Array<any>} players
 * @property {{ zoneHrid: string, difficultyTier: number } | null} zone
 * @property {{ labyrinthHrid: string, roomLevel: number, crates: string[] } | null} labyrinth
 * @property {number} simulationTimeLimit
 * @property {{ mooPass: boolean, comExp: number, comDrop: number, enableHpMpVisualization: boolean }} extra
 * @property {{ isGuildTrial?: boolean }} [simulationContext]
 */

/**
 * @typedef {Object} MultiZoneSimulationWorkerPayload
 * @property {"start_simulation_all_zones"} type
 * @property {Array<any>} players
 * @property {Array<{ zoneHrid: string, difficultyTier: number }>} zones
 * @property {number} [parallelWorkerLimit]
 * @property {number} simulationTimeLimit
 * @property {{ mooPass: boolean, comExp: number, comDrop: number, enableHpMpVisualization: boolean }} extra
 * @property {{ isGuildTrial?: boolean }} [simulationContext]
 */

/**
 * @typedef {Object} MultiLabyrinthSimulationWorkerPayload
 * @property {"start_simulation_all_labyrinths"} type
 * @property {Array<any>} players
 * @property {Array<{ labyrinthHrid: string, roomLevel: number, crates: string[] }>} labyrinths
 * @property {number} [parallelWorkerLimit]
 * @property {number} simulationTimeLimit
 * @property {{ mooPass: boolean, comExp: number, comDrop: number, enableHpMpVisualization: boolean }} extra
 * @property {{ isGuildTrial?: boolean }} [simulationContext]
 */

// ── realm 复用（2026-10-01）──
// 背景：旧的每次「开始模拟」都会 terminate 旧 realm + new Worker —— 新 realm 要重新付
// worker bundle 加载 + wasm 加载/编译（线上冷点击 ≈0.8~1s 网络往返；本地只剩编译）。
// 引擎结果与 realm 的新旧无关（「同 realm 连跑 vs 每场全新 realm」逐位一致由
// simulatorRealmReuseParity.test.js 在常规流水线锚定），因此：**空闲且健康的 realm
// 直接复用投递**，把新 realm 的冷启动税降为「每会话一次（或回收后一次）」。
//
// 复用规则（「一个 realm 同一时刻只跑一场」仍是硬约束）：
// - 可复用 = worker 存在 && 类型匹配 && 空闲（busy=false）&&
//   未达次数上限 && 未超空闲期限。失败域从不「标记不健康后保留」——一律经 finishRun
//   即时弃置，因此无独立健康状态位。busy 时的新请求**终止重建**：绝不并发投递，
//   旧 realm 在 terminate 前会先以 cancelled 错误显式收尾其在飞运行（supersede，
//   见 ensureWorker 的 discardError）——旧运行的 promise 可观测地取消，不再静默挂起。
// - 弃置（terminate，下一次请求自动重建）的触发：
//   · simulation_error —— wasm 引擎失败。逐场 / 多区域路径一律弃置；批量路径按 errorCode
//     分流（见 startSimulationBatch）：engine_unavailable 为 realm 级 sticky 失败（worker.js
//     内 wasm 加载失败被本 realm 的模块缓存记住，不可恢复，复用只会连续失败）→ 弃置并中止
//     本批；round_error 为单场级失败 → 继续投递下一条；
//   · worker.onerror —— realm 崩溃；
//   · 用户「停止」（stopSimulation 语义不变：terminate）；
//   · 运行停滞看门狗 —— 投递后 stallTimeoutMs 窗口内无任何回包（复用 realm 可能已被
//     浏览器回收：postMessage 不抛错也不回消息）→ 以 realm_stall 错误显式收尾并弃置；
//   · 回收策略 —— 连续承载 maxRuns 次请求、或空闲 idleEvictMs 后自动弃置
//     （模块级缓存 / wasm 线性内存的卫生边界，非正确性需求）。
// - 调用方收尾约定（各 run 的 finally / 错误分支）：不得终止「未使用过本 client」或
//   「正常完成」的共享 realm —— 保活即收益；失败 / 取消的弃置由取消链与失败域按归属完成。
// - REUSABLE_WORKER_KINDS = 'single'（worker.js）+ 'multi'（multiWorker.js）：multi 父
//   realm 已完成跨批保活改造（不再 self.close()；空闲子 worker 池化复用），弃置依赖父
//   terminate 的级联终止（2026-10-01 实测：classic/module 子 worker 均随父级联终止）。
const REUSABLE_WORKER_KINDS = new Set(['single', 'multi']);
const DEFAULT_MAX_RUNS = 50;
const DEFAULT_IDLE_EVICT_MS = 5 * 60 * 1000;
// 运行静默窗口：worker.js 的 wasm 路径在 result 前完全静默（无流式 progress），
// 「正在计算」与「已死」只能靠上限时间窗区分。默认 30 分钟 = 远大于任何合法单场模拟，
// 防误杀优先；投递后窗口内无任何回包即判死弃置（<=0 表示关闭）。
export const DEFAULT_STALL_TIMEOUT_MS = 30 * 60 * 1000;

// 抢占错误（对齐共享运行被取代时的 supersede 语义，code='cancelled'）：「一个 realm
// 同一时刻只跑一场」是硬约束——新请求到来时旧 realm 被 terminate，但旧运行必须先被
// 显式收尾（而不是静默挂起），调用方按既有取消口径处理。
function createSupersededRealmError() {
  const error = new Error('Realm superseded by a newer run.');
  error.code = 'cancelled';
  return error;
}

// 运行停滞错误（code='realm_stall'）：复用 realm 在运行窗口内完全静默——等待中的 realm
// 可能已被浏览器回收（如 OOM），postMessage 不抛错也不回消息。与 'cancelled' 刻意区分：
// cancelled = 被新请求抢占、消费端不重试；realm_stall = realm 级失败，批量消费端据此换
// 新 realm 续跑剩余条目（见 simulatorWorkerRuns 的 onAbort 分流）。
function createRealmStallError() {
  const error = new Error('Realm stalled: no message within the stall window; realm discarded.');
  error.code = 'realm_stall';
  return error;
}

export class WorkerClient {
  /**
   * @param {{ maxRuns?: number, idleEvictMs?: number, stallTimeoutMs?: number }} [options]
   *   maxRuns：同一 realm 最多连续承载的请求数（到限后下一次请求重建）；
   *   idleEvictMs：空闲多久后自动弃置 realm（毫秒；<=0 表示关闭空闲回收）；
   *   stallTimeoutMs：运行静默窗口（毫秒；<=0 表示关闭）——投递后窗口内无任何回包即判死
   *     弃置（防浏览器回收导致的永久静默挂起），默认见 DEFAULT_STALL_TIMEOUT_MS。
   */
  constructor({
    maxRuns = DEFAULT_MAX_RUNS,
    idleEvictMs = DEFAULT_IDLE_EVICT_MS,
    stallTimeoutMs = DEFAULT_STALL_TIMEOUT_MS,
  } = {}) {
    this.maxRuns = Number.isFinite(maxRuns) && maxRuns > 0 ? Math.floor(maxRuns) : DEFAULT_MAX_RUNS;
    this.idleEvictMs = Number.isFinite(idleEvictMs) && idleEvictMs > 0 ? Math.floor(idleEvictMs) : 0;
    this.stallTimeoutMs = Number.isFinite(stallTimeoutMs) && stallTimeoutMs > 0 ? Math.floor(stallTimeoutMs) : 0;
    this.worker = null;
    this.workerKind = '';
    this.busy = false;
    this.runsCompleted = 0;
    this.lastSettledAt = 0;
    this.idleTimer = null;
    // 运行静默看门狗：timer + 当前绑定的 realm（timer 回调据此判定 realm 是否已换）。
    this.stallTimer = null;
    this.stallWorker = null;
    // 当前在飞运行的「被抢占作废」回调：realm 因新请求被终止时先触发它，
    // 让旧运行以明确错误结算（默认 null = 无在飞运行）。
    this.inFlightDiscard = null;
  }

  /// 复用判定：realm 存在、类型匹配且可复用、空闲、未达上限、未超空闲期。
  canReuseRealm(kind) {
    return Boolean(
      this.worker &&
      this.workerKind === kind &&
      REUSABLE_WORKER_KINDS.has(kind) &&
      !this.busy &&
      this.runsCompleted < this.maxRuns &&
      !this.isIdleRealmExpired(),
    );
  }

  /// 惰性过期检查：兜底「空闲定时器被浏览器节流/冻结而未触发」的形态。
  isIdleRealmExpired() {
    return this.idleEvictMs > 0 && this.lastSettledAt > 0 && Date.now() - this.lastSettledAt >= this.idleEvictMs;
  }

  /// 取得可用的 realm：命中复用则原样返回（清除空闲定时器），否则终止旧 realm 重建。
  ensureWorker(kind) {
    if (this.canReuseRealm(kind)) {
      this.clearIdleEviction();
      return this.worker;
    }
    // 不可复用的旧 realm 被收起：若其上有在飞运行（busy），先以 cancelled 错误
    // 显式收尾（supersede），避免旧运行的 promise / 回调静默挂起。
    this.stopSimulation({ discardError: createSupersededRealmError() });
    this.worker =
      kind === 'multi'
        ? new Worker(new URL('../multiWorker.js', import.meta.url), { type: 'module' })
        : new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
    this.workerKind = kind;
    this.runsCompleted = 0;
    return this.worker;
  }

  /// 启动运行静默看门狗：监视 worker 在 stallTimeoutMs 窗口内的回包；超窗即弃置 realm。
  /// 每次投递（或收到消息刷新）时调用；stallTimeoutMs <= 0 时不武装。
  armStallWatchdog(worker) {
    this.clearStallWatchdog();
    if (this.stallTimeoutMs <= 0) {
      return;
    }
    this.stallWorker = worker;
    this.stallTimer = setTimeout(() => {
      const stalledWorker = this.stallWorker;
      this.stallTimer = null;
      this.stallWorker = null;
      // 过期看门狗（realm 已换/已弃置）：直接忽略。
      if (!stalledWorker || this.worker !== stalledWorker) {
        return;
      }
      // 超窗判死：stopSimulation 先 terminate 并复位状态，再以 realm_stall 错误通知在飞
      // 运行（single/multi → onError；批量 → onAbort，消费端据此换新 realm 续跑剩余条目）。
      this.stopSimulation({ discardError: createRealmStallError() });
    }, this.stallTimeoutMs);
  }

  /// 收到该次运行的消息：静默窗口自最后一条消息重新起算（仅刷新正在监视同一 realm 的看门狗）。
  refreshStallWatchdog(worker) {
    if (this.stallTimer === null || this.stallWorker !== worker) {
      return;
    }
    this.armStallWatchdog(worker);
  }

  /// 清理运行看门狗：任何结算（finishRun）与弃置（stopSimulation）路径都必须调用。
  clearStallWatchdog() {
    if (this.stallTimer !== null) {
      clearTimeout(this.stallTimer);
    }
    this.stallTimer = null;
    this.stallWorker = null;
  }

  /// 一次请求结算：复位 busy、推进计数；失败域或不支持复用的类型立即弃置，否则保活并挂空闲回收。
  finishRun(worker, { healthy = true } = {}) {
    if (this.worker !== worker) {
      return; // 已被弃置/替换：忽略过期结算
    }
    // 运行已结算（成功/失败/取消任一分支）：撤销运行看门狗，不得残留 timer。
    this.clearStallWatchdog();
    // 当前运行已结算：撤销「被抢占作废」回调（避免后续终止重复通知）。
    this.inFlightDiscard = null;
    this.busy = false;
    if (!healthy || !REUSABLE_WORKER_KINDS.has(this.workerKind)) {
      this.stopSimulation();
      return;
    }
    this.runsCompleted += 1;
    this.lastSettledAt = Date.now();
    this.scheduleIdleEviction();
  }

  scheduleIdleEviction() {
    this.clearIdleEviction();
    if (!this.worker || this.idleEvictMs <= 0) {
      return;
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      // 空闲到期：主动释放 realm（terminate 后下一次请求自动重建）。
      this.stopSimulation();
    }, this.idleEvictMs);
  }

  clearIdleEviction() {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /**
   * @param {SingleSimulationWorkerPayload} payload
   * @param {{ onProgress?: Function, onResult?: Function, onError?: Function }} handlers
   */
  startSimulation(payload, handlers = {}) {
    const worker = this.ensureWorker('single');
    this.busy = true;

    worker.onmessage = (event) => {
      if (this.worker !== worker) {
        return;
      }
      // 任何消息都是存活信号：刷新运行静默看门狗。
      this.refreshStallWatchdog(worker);
      const data = event.data ?? {};

      switch (data.type) {
        case 'simulation_progress':
          handlers.onProgress?.(data);
          break;
        case 'simulation_result':
          this.finishRun(worker);
          handlers.onResult?.(data.simResult);
          break;
        case 'simulation_error':
          this.finishRun(worker, { healthy: false });
          handlers.onError?.(data.error);
          break;
        default:
          break;
      }
    };

    worker.onerror = (error) => {
      if (this.worker !== worker) {
        return;
      }
      this.finishRun(worker, { healthy: false });
      handlers.onError?.(error?.message || String(error));
    };

    // 被抢占（busy 时新请求重建 realm）时：先以 cancelled 错误通知本次运行，
    // 再由 stopSimulation 完成终止（见 ensureWorker / stopSimulation）。
    this.inFlightDiscard = (error) => handlers.onError?.(error);
    // 先武装运行看门狗再投递：postMessage 不抛错也不回消息的静默死信由看门狗兜底。
    this.armStallWatchdog(worker);
    worker.postMessage(payload);
  }

  /**
   * 批量模拟（§54，2026-09-27）：一个 realm 里按顺序跑完 payloads —— **上一条结果（或失败）
   * 回来才发下一条**。串行投递是硬约束：worker.js 的 onmessage 是 async，并发投递会让同一
   * realm 里同时跑两个模拟，并把 installSeedScope 换上的全局 Math.random 互相覆盖
   * （「一个 realm 同一时刻只跑一场」是播种的安全前提，见 worker.js 的复用说明）。
   *
   * realm 复用（2026-10-01）：本方法经由 ensureWorker('single') 取得 realm —— 空闲且健康
   * 时复用现有 realm 投递，否则终止重建（见文件顶部说明）。
   *
   * handlers: { onProgress(data, index), onResult(simResult, index), onError(errorMessage, index),
   *             onAbort(errorMessage, index), onComplete() }
   * simulation_error 按 errorCode 分流（两类语义见 worker.js 上报处）：
   *   onError = 单场级失败（errorCode='round_error' 或字段缺省）→ 本批继续跑下一条（与逐场
   *             路径的失败传播一致：那一场退化为失败样本，其余照跑）；
   *   onAbort = realm 级失败：worker.onerror（realm 崩溃），或 simulation_error +
   *             errorCode='engine_unavailable'（wasm 引擎加载失败已被本 realm 缓存，复用只会
   *             连续失败）→ 本批停止投递并弃置 realm，index = 在飞的那一条（调用方据此决定
   *             是否换新 realm 续跑）。
   */
  startSimulationBatch(payloads, handlers = {}) {
    const worker = this.ensureWorker('single');
    this.busy = true;

    const list = Array.isArray(payloads) ? payloads : [];
    let index = -1;
    let aborted = false;

    const postNext = () => {
      index += 1;
      if (index >= list.length) {
        this.finishRun(worker);
        handlers.onComplete?.();
        return;
      }
      // 先武装运行看门狗再投递：静默死信（对方不抛错也不回消息）由看门狗兜底。
      this.armStallWatchdog(worker);
      worker.postMessage(list[index]);
    };

    worker.onmessage = (event) => {
      if (aborted || this.worker !== worker) {
        return;
      }
      // 任何消息都是存活信号：刷新运行静默看门狗。
      this.refreshStallWatchdog(worker);
      const data = event.data ?? {};

      switch (data.type) {
        case 'simulation_progress':
          handlers.onProgress?.(data, index);
          break;
        case 'simulation_result':
          handlers.onResult?.(data.simResult, index);
          postNext();
          break;
        case 'simulation_error':
          if (data.errorCode === 'engine_unavailable') {
            // realm 级 sticky 失败：wasm 引擎加载失败已被本 realm 缓存，继续投递只会连续
            // 失败。中止本批并弃置 realm（finishRun 会 terminate 并复位状态；它先清空
            // inFlightDiscard，故不会重复触发 supersede 回调），再按 onAbort 语义通知在飞的
            // 那一条——消费端记录该条失败并从下一条换新 realm 续跑。
            aborted = true;
            this.finishRun(worker, { healthy: false });
            handlers.onAbort?.(data.error, index);
            break;
          }
          handlers.onError?.(data.error, index);
          postNext();
          break;
        default:
          break;
      }
    };

    worker.onerror = (error) => {
      if (aborted || this.worker !== worker) {
        return;
      }
      aborted = true;
      this.finishRun(worker, { healthy: false });
      handlers.onAbort?.(error?.message || String(error), index);
    };

    // 被抢占时：以 cancelled 错误按 onAbort 语义通知在飞的那一条（offset = 当前
    // index），由包装层收敛为整批取消（见 simulatorWorkerRuns 的 onAbort 分流）。
    this.inFlightDiscard = (error) => handlers.onAbort?.(error, index);
    postNext();
  }

  /**
   * @param {MultiZoneSimulationWorkerPayload | MultiLabyrinthSimulationWorkerPayload} payload
   * @param {{ onProgress?: Function, onItemResult?: Function, onBatchResult?: Function, onError?: Function }} handlers
   */
  startMultiSimulation(payload, handlers = {}) {
    const worker = this.ensureWorker('multi');
    this.busy = true;

    worker.onmessage = (event) => {
      if (this.worker !== worker) {
        return;
      }
      // 任何消息都是存活信号：刷新运行静默看门狗。
      this.refreshStallWatchdog(worker);
      const data = event.data ?? {};

      switch (data.type) {
        case 'simulation_progress':
          handlers.onProgress?.(data);
          break;
        case 'simulation_item_result':
          handlers.onItemResult?.(data);
          break;
        case 'simulation_result_allZones':
        case 'simulation_result_allLabyrinths':
          this.finishRun(worker);
          handlers.onBatchResult?.(data.simResults ?? [], data.type);
          break;
        case 'simulation_error':
          this.finishRun(worker, { healthy: false });
          handlers.onError?.(data.error);
          break;
        default:
          break;
      }
    };

    worker.onerror = (error) => {
      if (this.worker !== worker) {
        return;
      }
      this.finishRun(worker, { healthy: false });
      handlers.onError?.(error?.message || String(error));
    };

    // 被抢占（busy 时新请求重建 realm）时：先以 cancelled 错误通知本次运行。
    this.inFlightDiscard = (error) => handlers.onError?.(error);
    // 先武装运行看门狗再投递：postMessage 不抛错也不回消息的静默死信由看门狗兜底。
    this.armStallWatchdog(worker);
    worker.postMessage(payload);
  }

  /// 弃置当前 realm（terminate）并复位全部状态；对 null realm 幂等。
  /// 语义：用户「停止」= 弃置（停止后重开重建 realm，属接受的边界）；失败域与回收同理。
  /// discardError：在飞运行的显式收尾错误（supersede / 判死）来源有二——「被新请求抢占」
  /// （ensureWorker，code='cancelled'）与「运行停滞看门狗」（armStallWatchdog，
  /// code='realm_stall'）；上层 promise 可观测地取消而非静默挂起。默认 null 保持既有
  /// 静默语义（用户停止等路径由各自的取消链负责结算）。
  stopSimulation({ discardError = null } = {}) {
    this.clearIdleEviction();
    // 任何弃置路径都不得残留运行看门狗 timer。
    this.clearStallWatchdog();
    const discard = this.inFlightDiscard;
    this.inFlightDiscard = null;
    if (!this.worker) {
      return;
    }

    this.worker.terminate();
    this.worker = null;
    this.workerKind = '';
    this.busy = false;
    this.runsCompleted = 0;
    this.lastSettledAt = 0;

    if (discard && discardError) {
      discard(discardError);
    }
  }
}

const workerClient = new WorkerClient();
export default workerClient;

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHILD_TASK_STALL_TIMEOUT_MS,
  handleMultiSimulationMessage,
  POOL_PING_TIMEOUT_MS,
  resetMultiWorkerPoolForTests,
} from '../multiWorker.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// fake timers 下不能依赖真实 setTimeout 的 tick()：用微任务轮转刷新挂起的 promise 链。
const flushMicrotasks = async () => {
  for (let index = 0; index < 20; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};

class FakeChildWorker {
  static instances = [];

  // 池化取用会先发 prewarm_ping 做存活校验：默认即时回 prewarm_pong（模拟真实 worker
  // 握手）；置 false（实例属性或静态开关）可构造「闲置期被回收、不回 pong 的死 worker」。
  static autoPong = true;

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.onmessage = null;
    this.onerror = null;
    this.autoPong = null;
    // 任务消息默认不自动响应：由用例手动 emit 驱动（串行、确定）。
    this.postMessage = vi.fn((message) => {
      const autoPong = this.autoPong ?? FakeChildWorker.autoPong;
      if (autoPong && message?.type === 'prewarm_ping') {
        this.emit({ type: 'prewarm_pong' });
      }
    });
    this.terminate = vi.fn();
    FakeChildWorker.instances.push(this);
  }

  emit(data) {
    this.onmessage?.({ data });
  }

  fail(error) {
    this.onerror?.(error);
  }
}

function createWorkerScope() {
  return {
    postMessage: vi.fn(),
    close: vi.fn(),
  };
}

function createBatchMessage(overrides = {}) {
  return {
    type: 'start_simulation_all_zones',
    players: [],
    zones: [{ zoneHrid: '/actions/combat/fly', difficultyTier: 0 }],
    simulationTimeLimit: 100,
    extra: { mooPass: false, comExp: 0, comDrop: 0, enableHpMpVisualization: false },
    ...overrides,
  };
}

describe('multiWorker', () => {
  let originalWorker;
  let originalNavigatorDescriptor;

  beforeEach(() => {
    FakeChildWorker.instances = [];
    FakeChildWorker.autoPong = true;
    originalWorker = globalThis.Worker;
    originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

    globalThis.Worker = FakeChildWorker;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { hardwareConcurrency: 2 },
    });
  });

  afterEach(() => {
    // 池与 busy 门是模块级状态：用例间重置，避免串扰。
    resetMultiWorkerPoolForTests();

    if (typeof originalWorker === 'undefined') {
      delete globalThis.Worker;
    } else {
      globalThis.Worker = originalWorker;
    }

    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    } else {
      delete globalThis.navigator;
    }

    vi.restoreAllMocks();
  });

  it('terminates sibling child workers when one multi-run task fails', async () => {
    const workerScope = createWorkerScope();

    const runPromise = handleMultiSimulationMessage(
      createBatchMessage({
        zones: [
          { zoneHrid: '/actions/combat/fly', difficultyTier: 0 },
          { zoneHrid: '/actions/combat/slime', difficultyTier: 0 },
        ],
      }),
      workerScope,
    );
    await tick();

    expect(FakeChildWorker.instances).toHaveLength(2);
    FakeChildWorker.instances[0].emit({ type: 'simulation_error', error: 'forced failure' });

    await runPromise;

    expect(FakeChildWorker.instances[0].terminate).toHaveBeenCalled();
    expect(FakeChildWorker.instances[1].terminate).toHaveBeenCalled();
    expect(workerScope.postMessage).toHaveBeenCalledWith({
      type: 'simulation_error',
      error: 'forced failure',
    });
    // 保活改造：父 realm 不再随批结束 close（回收由主线程 terminate 统一管）。
    expect(workerScope.close).not.toHaveBeenCalled();
  });

  it('respects parallelWorkerLimit: a single lane reuses one child worker for all targets', async () => {
    const workerScope = createWorkerScope();

    const runPromise = handleMultiSimulationMessage(
      createBatchMessage({
        zones: [
          { zoneHrid: '/actions/combat/fly', difficultyTier: 0 },
          { zoneHrid: '/actions/combat/slime', difficultyTier: 0 },
          { zoneHrid: '/actions/combat/bat', difficultyTier: 0 },
        ],
        parallelWorkerLimit: 1,
      }),
      workerScope,
    );
    await tick();

    expect(FakeChildWorker.instances).toHaveLength(1);
    const child = FakeChildWorker.instances[0];
    // 池化复用会先发 prewarm_ping 做存活校验：只统计真正的任务投递（start_simulation）。
    const startCalls = () => child.postMessage.mock.calls.filter(([message]) => message?.type === 'start_simulation');

    child.emit({ type: 'simulation_result', simResult: { encounters: 0 } });
    await tick();
    expect(startCalls()).toHaveLength(2);

    child.emit({ type: 'simulation_result', simResult: { encounters: 1 } });
    await tick();
    expect(startCalls()).toHaveLength(3);

    child.emit({ type: 'simulation_result', simResult: { encounters: 2 } });
    await runPromise;

    // 全程一个子 realm（成功回池复用）；正常完成不 terminate。
    expect(FakeChildWorker.instances).toHaveLength(1);
    expect(child.terminate).not.toHaveBeenCalled();
    expect(workerScope.postMessage).toHaveBeenCalledWith({
      type: 'simulation_result_allZones',
      simResults: [{ encounters: 0 }, { encounters: 1 }, { encounters: 2 }],
    });
  });

  it('keeps the parent alive and reuses pooled child workers across batches (§keep-alive)', async () => {
    const workerScope = createWorkerScope();

    const firstBatch = handleMultiSimulationMessage(createBatchMessage(), workerScope);
    await tick();
    const child = FakeChildWorker.instances[0];
    child.emit({ type: 'simulation_result', simResult: { encounters: 1 } });
    await firstBatch;

    expect(child.terminate).not.toHaveBeenCalled();
    expect(workerScope.close).not.toHaveBeenCalled();

    const secondBatch = handleMultiSimulationMessage(createBatchMessage(), workerScope);
    await tick();
    // 第二批复用池中的同一子 worker（没有新建实例）。
    expect(FakeChildWorker.instances).toHaveLength(1);
    child.emit({ type: 'simulation_result', simResult: { encounters: 2 } });
    await secondBatch;

    expect(workerScope.postMessage).toHaveBeenLastCalledWith({
      type: 'simulation_result_allZones',
      simResults: [{ encounters: 2 }],
    });
  });

  it('rejects an overlapping batch loudly (busy gate, §keep-alive)', async () => {
    const workerScope = createWorkerScope();

    const firstBatch = handleMultiSimulationMessage(createBatchMessage(), workerScope);
    await tick();

    await handleMultiSimulationMessage(createBatchMessage(), workerScope);

    expect(workerScope.postMessage).toHaveBeenCalledWith({
      type: 'simulation_error',
      error: expect.any(Error),
    });

    FakeChildWorker.instances[0].emit({ type: 'simulation_result', simResult: { encounters: 1 } });
    await firstBatch;
  });

  it('forwards player scroll configuration and simulation context to each child', async () => {
    const players = [
      {
        hrid: 'player1',
        combatScrolls: { '/items/seal_of_damage': { quantity: 2 } },
      },
    ];
    const workerScope = createWorkerScope();

    const runPromise = handleMultiSimulationMessage(
      createBatchMessage({ players, simulationContext: { isGuildTrial: true } }),
      workerScope,
    );
    await tick();

    expect(FakeChildWorker.instances[0].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        players,
        simulationContext: { isGuildTrial: true },
      }),
    );

    FakeChildWorker.instances[0].emit({ type: 'simulation_result', simResult: { encounters: 0 } });
    await runPromise;
  });

  // 切片 18：主线程批量消息的 wasm 开关（useWasmEngine）必须透传给每个子 worker，
  // 否则批量扫描永远落在 JS 引擎上。
  it('forwards the wasm engine switch to each child worker', async () => {
    const workerScope = createWorkerScope();

    const firstBatch = handleMultiSimulationMessage(createBatchMessage({ useWasmEngine: true }), workerScope);
    await tick();

    const child = FakeChildWorker.instances[0];
    expect(child.postMessage).toHaveBeenCalledWith(expect.objectContaining({ useWasmEngine: true }));

    child.emit({ type: 'simulation_result', simResult: { encounters: 0 } });
    await firstBatch;

    // 未开启时不注入该字段（保持消息形状最小化）；第二批复用同一子 worker。
    const secondBatch = handleMultiSimulationMessage(
      createBatchMessage({
        type: 'start_simulation_all_labyrinths',
        zones: undefined,
        labyrinths: [{ labyrinthHrid: '/monsters/cyclops', roomLevel: 100 }],
      }),
      workerScope,
    );
    await tick();

    expect(FakeChildWorker.instances).toHaveLength(1);
    // 池化复用会先发 prewarm_ping：只取任务投递（start_simulation）消息核对转发形状。
    const startCalls = child.postMessage.mock.calls.filter(([message]) => message?.type === 'start_simulation');
    expect(startCalls).toHaveLength(2);
    const forwarded = startCalls[1][0];
    expect(forwarded.type).toBe('start_simulation');
    expect(forwarded.useWasmEngine).toBeUndefined();

    child.emit({ type: 'simulation_result', simResult: { encounters: 0 } });
    await secondBatch;
  });

  it('discards a pooled child that no longer answers the liveness ping, then completes with a fresh one (§pool)', async () => {
    vi.useFakeTimers();
    try {
      const workerScope = createWorkerScope();

      // 第一批：池空 → 新建 worker（不 ping），正常完成后回池。
      const firstBatch = handleMultiSimulationMessage(createBatchMessage(), workerScope);
      await flushMicrotasks();
      const staleChild = FakeChildWorker.instances[0];
      staleChild.emit({ type: 'simulation_result', simResult: { encounters: 1 } });
      await firstBatch;

      // 池中 worker 在闲置期被浏览器回收：prewarm_ping 不再回 pong。
      staleChild.autoPong = false;

      const secondBatch = handleMultiSimulationMessage(createBatchMessage(), workerScope);
      await flushMicrotasks();
      // 取用池中 worker 先 ping；未确认存活前不投递任务。
      expect(staleChild.postMessage).toHaveBeenLastCalledWith({ type: 'prewarm_ping' });

      // ping 超窗：判死弃置，新建替补 worker 承接本批任务。
      await vi.advanceTimersByTimeAsync(POOL_PING_TIMEOUT_MS);
      await flushMicrotasks();
      expect(staleChild.terminate).toHaveBeenCalled();
      expect(FakeChildWorker.instances).toHaveLength(2);
      const freshChild = FakeChildWorker.instances[1];
      expect(freshChild.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'start_simulation' }));

      freshChild.emit({ type: 'simulation_result', simResult: { encounters: 2 } });
      await secondBatch;
      expect(workerScope.postMessage).toHaveBeenLastCalledWith({
        type: 'simulation_result_allZones',
        simResults: [{ encounters: 2 }],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails the batch when a delivered child task stays silent past the stall window (§stall)', async () => {
    vi.useFakeTimers();
    try {
      const workerScope = createWorkerScope();

      const runPromise = handleMultiSimulationMessage(createBatchMessage(), workerScope);
      await flushMicrotasks();
      const child = FakeChildWorker.instances[0];
      expect(child.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'start_simulation' }));

      // 任务投递后完全静默（wasm 路径无流式 progress，正常任务 result 前也静默）：未到窗口不误杀。
      await vi.advanceTimersByTimeAsync(CHILD_TASK_STALL_TIMEOUT_MS - 1);
      expect(child.terminate).not.toHaveBeenCalled();

      // 超过静默窗口：判死弃置子 worker，并按失败向上传播（workerScope 收到 simulation_error）。
      await vi.advanceTimersByTimeAsync(1);
      await runPromise;

      expect(child.terminate).toHaveBeenCalled();
      expect(workerScope.postMessage).toHaveBeenCalledWith({
        type: 'simulation_error',
        error: expect.any(Error),
      });
      const errorPayload = workerScope.postMessage.mock.calls.find(
        ([message]) => message?.type === 'simulation_error',
      )?.[0]?.error;
      expect(String(errorPayload?.message ?? errorPayload)).toContain('stalled');
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes the child stall window on every message and only fails after full silence (§stall)', async () => {
    vi.useFakeTimers();
    try {
      const workerScope = createWorkerScope();

      const runPromise = handleMultiSimulationMessage(createBatchMessage(), workerScope);
      await flushMicrotasks();
      const child = FakeChildWorker.instances[0];

      // 接近窗口时收到 progress：静默窗口自最后一条消息重新起算，不触发判死。
      await vi.advanceTimersByTimeAsync(CHILD_TASK_STALL_TIMEOUT_MS - 1);
      child.emit({ type: 'simulation_progress', progress: 0.5 });
      await vi.advanceTimersByTimeAsync(CHILD_TASK_STALL_TIMEOUT_MS - 1);
      expect(child.terminate).not.toHaveBeenCalled();

      // 自最后一条消息再超过一个完整窗口：判死弃置，整批失败。
      await vi.advanceTimersByTimeAsync(1);
      await runPromise;

      expect(child.terminate).toHaveBeenCalled();
      expect(workerScope.postMessage).toHaveBeenCalledWith({
        type: 'simulation_error',
        error: expect.any(Error),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips delivery when a sibling lane fails during this lane acquire wait (§abort-race)', async () => {
    vi.useFakeTimers();
    try {
      const workerScope = createWorkerScope();

      // 第一批：单个 zone 正常完成，子 worker 回池（busy 门随批结束释放）。
      const firstBatch = handleMultiSimulationMessage(createBatchMessage(), workerScope);
      await flushMicrotasks();
      const pooledChild = FakeChildWorker.instances[0];
      pooledChild.emit({ type: 'simulation_result', simResult: { encounters: 1 } });
      await firstBatch;

      // 构造死池：闲置 worker 不再回 prewarm_pong，取用方将卡满整个 ping 超窗。
      pooledChild.autoPong = false;

      // 第二批：两个 zone、双 lane。lane A pop 池中 worker → 卡在 ping 窗口（此时
      // taskControl 尚未注册）；lane B 池空 → 立即新建 worker 并投递 start_simulation。
      const runPromise = handleMultiSimulationMessage(
        createBatchMessage({
          zones: [
            { zoneHrid: '/actions/combat/fly', difficultyTier: 0 },
            { zoneHrid: '/actions/combat/slime', difficultyTier: 0 },
          ],
        }),
        workerScope,
      );
      await flushMicrotasks();
      expect(FakeChildWorker.instances).toHaveLength(2);
      const freshChild = FakeChildWorker.instances[1];
      const freshStartCalls = freshChild.postMessage.mock.calls.filter(
        ([message]) => message?.type === 'start_simulation',
      );
      expect(freshStartCalls).toHaveLength(1);

      // lane B 失败：aborted=true，但取消覆盖不到还卡在 ping 里的 lane A。
      freshChild.emit({ type: 'simulation_error', error: 'forced failure' });
      await flushMicrotasks();

      // ping 超窗：池 worker 判死弃置、新建替补；替补必须因 aborted 直接弃置、不投递。
      await vi.advanceTimersByTimeAsync(POOL_PING_TIMEOUT_MS);
      await flushMicrotasks();

      expect(pooledChild.terminate).toHaveBeenCalled();
      expect(FakeChildWorker.instances).toHaveLength(3);
      const replacementChild = FakeChildWorker.instances[2];
      const replacementStartCalls = replacementChild.postMessage.mock.calls.filter(
        ([message]) => message?.type === 'start_simulation',
      );
      expect(replacementStartCalls).toHaveLength(0);
      expect(replacementChild.terminate).toHaveBeenCalled();

      // 修复后批 promise 立即完成（busy 门释放），不再卡 30 分钟静默看门狗。
      await runPromise;
      expect(workerScope.postMessage).toHaveBeenCalledWith({
        type: 'simulation_error',
        error: 'forced failure',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  // 与上一用例互补的闸锚定：上一用例覆盖「ping 超窗后替补 worker」路径，本用例覆盖
  // 「存活校验已通过、闸检查还挂在恢复微任务上」的间隙 —— acquire 的 await 恢复与
  // aborted 检查之间不存在任何可投递窗口。（备忘录原设想的「池空双 lane 均 new Worker」
  // 拓扑在确定性微任务语义下不存在该窗口：两个 lane 的闸检查必先于两个 lane 的投递，
  // 故改用本构造，取舍见任务汇报。）
  it('skips delivery when a sibling lane fails in the acquire-resume microtask gap (§abort-race)', async () => {
    vi.useFakeTimers();
    try {
      const workerScope = createWorkerScope();

      // 两个 lane、三个 zone：lane A 承接 zone0，lane B 承接 zone1；lane A 首场成功回池后
      // 立刻取走队尾 zone2 —— pop 自己刚回池的 worker（pong 同步回包），闸检查落在
      // acquire 的恢复微任务上。
      const runPromise = handleMultiSimulationMessage(
        createBatchMessage({
          zones: [
            { zoneHrid: '/actions/combat/fly', difficultyTier: 0 },
            { zoneHrid: '/actions/combat/slime', difficultyTier: 0 },
            { zoneHrid: '/actions/combat/bat', difficultyTier: 0 },
          ],
        }),
        workerScope,
      );
      await flushMicrotasks();
      expect(FakeChildWorker.instances).toHaveLength(2);
      const laneAChild = FakeChildWorker.instances[0];
      const laneBChild = FakeChildWorker.instances[1];
      const laneAStartCalls = () =>
        laneAChild.postMessage.mock.calls.filter(([message]) => message?.type === 'start_simulation');
      expect(laneAStartCalls()).toHaveLength(1);

      // lane A 首场成功：子 worker 回池，lane A 随即进入第二场的 acquire。
      laneAChild.emit({ type: 'simulation_result', simResult: { encounters: 1 } });
      // 单跳微任务：只让 lane A 第一场结算完成（worker 已回池），第二场 acquire 尚未
      // 开始。此刻注入兄弟失败 —— lane B 的 aborted=true 会落在 lane A 第二场 acquire
      // 的等待期内生效（后续微任务里 pop 到刚回池的 worker、pong 同步回包后，闸检查
      // 还挂在恢复微任务上）。多跑几轮 acquire 早已完成、闸早已通过，断言会失败而非
      // 假绿；少跑则第一场尚未结算，构造不成立。
      await Promise.resolve();

      // 在该微任务间隙内兄弟 lane 失败：aborted=true，但 lane A 第二场的 taskControl
      // 尚未注册，cancelActiveTasks 覆盖不到这个残留 lane。
      laneBChild.emit({ type: 'simulation_error', error: 'forced failure' });

      await flushMicrotasks();
      await runPromise;

      // 残留 lane 恢复后由闸统一弃置：第二场不投递（start_simulation 恒为 1）、worker
      //（已通过存活校验的那个）被 terminate 而不是回池。
      expect(laneAStartCalls()).toHaveLength(1);
      expect(laneAChild.terminate).toHaveBeenCalled();
      expect(laneBChild.terminate).toHaveBeenCalled();
      // 批 promise 以 simulation_error 正常收尾，不再挂 30 分钟静默看门狗。
      expect(workerScope.postMessage).toHaveBeenCalledWith({
        type: 'simulation_error',
        error: 'forced failure',
      });

      // busy 门已随批释放：第二小批可正常接收（不回 busy 类 simulation_error —— busy 的
      // error 是 Error 实例，业务失败这里是字符串，可区分）。
      const busyErrorCalls = workerScope.postMessage.mock.calls.filter(
        ([message]) => message?.type === 'simulation_error' && message?.error instanceof Error,
      );
      expect(busyErrorCalls).toHaveLength(0);

      const secondBatch = handleMultiSimulationMessage(createBatchMessage(), workerScope);
      await flushMicrotasks();
      // 上一批两个子 worker 均被弃置（不回池）：第二小批池空新建实例承接。
      expect(FakeChildWorker.instances).toHaveLength(3);
      FakeChildWorker.instances[2].emit({ type: 'simulation_result', simResult: { encounters: 2 } });
      await secondBatch;
      expect(workerScope.postMessage).toHaveBeenLastCalledWith({
        type: 'simulation_result_allZones',
        simResults: [{ encounters: 2 }],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  // 批末池收缩（§pool-shrink）：高并发批跑完后，池中每个子 worker 都持有已增长的 wasm
  // 线性内存；空闲期不得按高水位滞留到上层（主线程 WorkerClient idleEvictMs，默认
  // 5 分钟）terminate 父 realm 才级联回收 —— 批末应立即收缩到本批并发上限。
  it('shrinks the idle pool to the batch worker limit at batch end, keeping the recently used (§pool-shrink)', async () => {
    // 本用例需要 4 路并发（beforeEach 默认 mock 为 2，用例内覆盖，afterEach 统一还原）。
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { hardwareConcurrency: 4 },
    });
    const workerScope = createWorkerScope();

    // 第一批：4 个 zone、4 路 lane → 4 个子 worker 全部成功回池；批末收缩目标 = 本批
    // maxWorkers = 4，池大小未超目标，无 terminate（低目标批跑完不误伤热池）。
    const firstBatch = handleMultiSimulationMessage(
      createBatchMessage({
        zones: [
          { zoneHrid: '/actions/combat/fly', difficultyTier: 0 },
          { zoneHrid: '/actions/combat/slime', difficultyTier: 0 },
          { zoneHrid: '/actions/combat/bat', difficultyTier: 0 },
          { zoneHrid: '/actions/combat/wolf', difficultyTier: 0 },
        ],
      }),
      workerScope,
    );
    await tick();
    expect(FakeChildWorker.instances).toHaveLength(4);
    // 按完成顺序依次回池：instances[3] 最后回池 = 池尾（LIFO 最近使用端）。
    for (const child of FakeChildWorker.instances) {
      child.emit({ type: 'simulation_result', simResult: { encounters: 1 } });
    }
    await firstBatch;
    for (const child of FakeChildWorker.instances) {
      expect(child.terminate).not.toHaveBeenCalled();
    }

    // 第二批：parallelWorkerLimit=1、单 zone → 复用池尾（最近使用）的那个子 worker，
    // 不新建实例；批末池收缩到 1 → 多余 3 个从最久未用端被 terminate。
    const secondBatch = handleMultiSimulationMessage(
      createBatchMessage({
        zones: [{ zoneHrid: '/actions/combat/fly', difficultyTier: 0 }],
        parallelWorkerLimit: 1,
      }),
      workerScope,
    );
    await tick();
    expect(FakeChildWorker.instances).toHaveLength(4);
    const reusedChild = FakeChildWorker.instances[3];
    const reusedStartCalls = reusedChild.postMessage.mock.calls.filter(
      ([message]) => message?.type === 'start_simulation',
    );
    // 第一批承接 1 场 + 第二批承接 1 场：第二批复用的正是池尾那个，没有新建。
    expect(reusedStartCalls).toHaveLength(2);
    reusedChild.emit({ type: 'simulation_result', simResult: { encounters: 2 } });
    await secondBatch;

    // 收缩只命中最久未用的 3 个（各恰好一次），第二批复用的热 worker 保留。
    const evictedChildren = FakeChildWorker.instances.slice(0, 3);
    for (const child of evictedChildren) {
      expect(child.terminate).toHaveBeenCalledTimes(1);
    }
    expect(reusedChild.terminate).not.toHaveBeenCalled();
    expect(workerScope.postMessage).toHaveBeenLastCalledWith({
      type: 'simulation_result_allZones',
      simResults: [{ encounters: 2 }],
    });
  });
});

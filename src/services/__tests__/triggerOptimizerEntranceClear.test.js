import { afterEach, describe, expect, it } from 'vitest';
import {
  SHARED_RUN_BUSY_ERROR,
  TRIGGER_OPTIMIZER_BUSY_ERROR,
  appendTriggerOptimizerRobustness,
  appendTriggerOptimizerVerification,
  optimizeTriggers,
  verifyTriggerOptimizerRobustness,
} from '../triggerOptimizerSearch.js';
import { registerTriggerOptimizerRun, unregisterTriggerOptimizerRun } from '../triggerOptimizerRunRegistry.js';
import {
  DEDICATED_WORKER_SCOPE_HOME_MULTI_ROUND,
  cancelSharedWorkerRun,
  runSharedSingleSimulationPayload,
  runSimulationBatchWithDedicatedWorker,
  stopHomeMultiRoundWorkerRuns,
} from '../simulatorWorkerRuns.js';

// 服务层四入口的闸门统一化回归（assertTriggerOptimizerEntranceClear 单点）：
// 逐入口断言三种在途状态都被拦截：触发器运行注册表 / 共享 realm 句柄 / 首页多轮批句柄。
// 此前 4 处为手工复制的重复检查，新增运行时标志易漏改——本文件即防漏项锚点。
class StubWorkerClient {
  startSimulation() {}
  stopSimulation() {}
}

// 悬空的批运行桩：startSimulationBatch 不回调，句柄保持注册
//（与 simulatorBusyEntranceCoverage.test.js 的同款桩用途一致）。
class HangingBatchWorkerClient {
  startSimulationBatch() {}
  stopSimulation() {}
}

describe('trigger optimizer service entrance gate covers all four entries', () => {
  let sharedRunPromise = null;

  afterEach(async () => {
    cancelSharedWorkerRun();
    if (sharedRunPromise) {
      await sharedRunPromise.catch(() => {});
      sharedRunPromise = null;
    }
  });

  it('rejects every entry while the trigger optimizer run registry is occupied', async () => {
    const run = registerTriggerOptimizerRun({ cancelRequested: false });
    try {
      await expect(optimizeTriggers({})).rejects.toThrow(TRIGGER_OPTIMIZER_BUSY_ERROR);
      await expect(verifyTriggerOptimizerRobustness({})).rejects.toThrow(TRIGGER_OPTIMIZER_BUSY_ERROR);
      await expect(appendTriggerOptimizerVerification({})).rejects.toThrow(TRIGGER_OPTIMIZER_BUSY_ERROR);
      await expect(appendTriggerOptimizerRobustness({})).rejects.toThrow(TRIGGER_OPTIMIZER_BUSY_ERROR);
    } finally {
      unregisterTriggerOptimizerRun(run);
    }
  });

  it('rejects every entry while the shared worker run handle is active', async () => {
    sharedRunPromise = runSharedSingleSimulationPayload({ type: 'start_simulation' }, () => {}, {
      workerClient: new StubWorkerClient(),
    });

    await expect(optimizeTriggers({})).rejects.toThrow(SHARED_RUN_BUSY_ERROR);
    await expect(verifyTriggerOptimizerRobustness({})).rejects.toThrow(SHARED_RUN_BUSY_ERROR);
    await expect(appendTriggerOptimizerVerification({})).rejects.toThrow(SHARED_RUN_BUSY_ERROR);
    await expect(appendTriggerOptimizerRobustness({})).rejects.toThrow(SHARED_RUN_BUSY_ERROR);
  });

  it('rejects every entry while a home multi-round batch is in flight', async () => {
    // 首页多轮批注册的是 scope='home-multi-round' 的专用句柄（不注册共享句柄）；
    // 经真实运行入口 + 不结算的 Ctor 桩构造在途状态，保证测的是真实注册 → 判定可见的链路。
    const batch = runSimulationBatchWithDedicatedWorker([{ id: 1 }], () => {}, {
      scope: DEDICATED_WORKER_SCOPE_HOME_MULTI_ROUND,
      WorkerClientCtor: HangingBatchWorkerClient,
    });
    const settled = batch.catch(() => {});
    try {
      await expect(optimizeTriggers({})).rejects.toThrow(SHARED_RUN_BUSY_ERROR);
      await expect(verifyTriggerOptimizerRobustness({})).rejects.toThrow(SHARED_RUN_BUSY_ERROR);
      await expect(appendTriggerOptimizerVerification({})).rejects.toThrow(SHARED_RUN_BUSY_ERROR);
      await expect(appendTriggerOptimizerRobustness({})).rejects.toThrow(SHARED_RUN_BUSY_ERROR);
    } finally {
      stopHomeMultiRoundWorkerRuns();
      await settled;
    }
  });
});

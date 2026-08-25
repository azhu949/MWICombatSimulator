/**
 * 在共享的下一索引计数器上运行固定数量的并发工作器。
 * 每个任务恰好由一个工作器拾取；下一个任务索引总是在前一个任务
 * 完成前预留，因此任务不会重叠。
 *
 * 错误语义与普通 Promise.all 一致：首个任务失败会拒绝整个池，
 * 其余在途任务不会被强制取消。
 *
 * @param {Object} options
 * @param {number} options.taskCount  任务总数（索引为 0..taskCount-1）。
 * @param {number} options.workerLimit 期望的并发工作器数量。
 * @param {(index: number) => Promise<any>} options.runTask 单个索引的任务体。
 * @param {() => void} [options.ensureActive] 可选守卫，在每个任务预留前调用
 *        （例如取消检查）。抛出异常将中止整个池。
 * @param {boolean} [options.clampWorkerCount=true] 为 true 时工作器数量
 *        钳制到 taskCount；为 false 时按请求的限额原样派生
 *        （多余的工作器立即退出，不触碰任何任务）。
 * @returns {Promise<void>}
 */
export async function runParallelWorkerPool({
  taskCount,
  workerLimit,
  runTask,
  ensureActive,
  clampWorkerCount = true,
}) {
  const limit = Math.max(1, Number(workerLimit) || 1);
  const workerCount = clampWorkerCount ? Math.min(limit, taskCount) : limit;
  let nextIndex = 0;

  const workerLoop = async () => {
    while (nextIndex < taskCount) {
      ensureActive?.();
      const currentIndex = nextIndex;
      nextIndex += 1;
      // eslint-disable-next-line no-await-in-loop
      await runTask(currentIndex);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => workerLoop()));
}

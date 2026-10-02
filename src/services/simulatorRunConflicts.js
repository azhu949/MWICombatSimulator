// 跨功能运行冲突判定（防重入 / 忙碌清单的单一事实源，2026-10-02 收口）。
//
// 背景：互斥判定此前散落为 6 处以上手工维护的标志清单（手动模拟双检、队列基线双检、
// 队列运行、advisor 双检、触发器服务层、UI 禁用），各清单字段集不同，新增运行标志
// 时须逐处补齐——近期两次补漏（scanInFlight / runtime.isRunning 分别补入多处）即为
// 代价。这里把 store 侧判定合并为单点：
//   · isSimulationBusy          完整版：store 运行态 + 模块级 worker realm 句柄；
//   · isReactiveSimulationBusy  响应式版：仅 store 运行态（供 Vue computed 引用；
//     模块级句柄是普通变量、变化不触发重算，UI 若引用完整版会在句柄注销后缓存陈旧
//     结果——triggerOptimizer 的 serviceRunInFlight 响应式锚点即为此类事故的补救）。
// 新增运行标志时：store 态登记进 isReactiveSimulationBusy、模块级句柄登记进
// isSimulationBusy，并在 src/stores/__tests__/simulatorBusyEntranceCoverage.test.js
// 的入口覆盖清单里补一条断言，防止再次散落。
//
// 与既有集中式先例的分工：foodOptimizerBusy / triggerOptimizerBusy 各自还包含自身
// 子运行态（robustness / verifyAppend / serviceRunInFlight）与 pricing.isLoading 等
// 专属条件，保持原样并由自身维护；触发器服务层看不到 store，其入口双检查由
// triggerOptimizerSearch 内的 assertTriggerOptimizerEntranceClear 承担（同样单点化）。
import { hasHomeMultiRoundWorkerRunInProgress, hasSharedWorkerRunInProgress } from './simulatorWorkerRuns.js';

// 仅 store 内的运行态（全部是响应式字段，UI computed 与 store 闸门共用）。
// options.ignoreAdvisorScanInFlight：advisor 自身扫描进入 executeAdvisorScan 时
// scanInFlight 已置位（runAdvisorScan 在首个 await 前同步关窗），其自身闸门必须
// 忽略该项，否则每次进入都会把自己拦下。
export function isReactiveSimulationBusy(store, options = {}) {
  if (!store) return false;
  const ignoreAdvisorScanInFlight = options?.ignoreAdvisorScanInFlight === true;
  return Boolean(
    store.runtime?.isRunning ||
    store.isAnyQueueRunning ||
    store.advisor?.runtime?.isRunning ||
    (!ignoreAdvisorScanInFlight && store.advisor?.runtime?.scanInFlight) ||
    store.foodOptimizer?.runtime?.isRunning ||
    store.triggerOptimizer?.runtime?.isRunning,
  );
}

// 完整版：store 运行态 + 模块级 worker realm 句柄（共享运行句柄 / 首页多轮批运行）。
export function isSimulationBusy(store, options = {}) {
  return (
    isReactiveSimulationBusy(store, options) || hasSharedWorkerRunInProgress() || hasHomeMultiRoundWorkerRunInProgress()
  );
}

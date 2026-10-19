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
// 例外：文件末尾的 dungeonCalculatorRunInFlight 响应式锚点（2026-10-17 登记）不并入
// 上述两份判定——计算器自身入口闸门引用它们，并入会在其运行期间自我判忙；该锚点只服务
// 顶栏模式按钮的 disabled 展示，写入侧由 dungeonCalculatorStore 镜像、消费侧见 App.vue。
import {
  hasDungeonCalculatorWorkerRunInProgress,
  hasHomeMultiRoundWorkerRunInProgress,
  hasSharedWorkerRunInProgress,
} from './simulatorWorkerRuns.js';
import { hasBudgetOptimizerRunInProgress } from './budgetOptimizerRunRegistry.js';
import { ref } from 'vue';

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
    store.triggerOptimizer?.runtime?.isRunning ||
    // 预算优化（2026-10-04 登记）：store 运行态是响应式字段，UI computed 与 store 闸门共用。
    store.budgetOptimizer?.runtime?.isRunning,
  );
}

// 完整版：store 运行态 + 模块级 worker realm 句柄（共享运行句柄 / 首页多轮批运行 / 预算优化注册表）。
export function isSimulationBusy(store, options = {}) {
  return (
    isReactiveSimulationBusy(store, options) ||
    hasSharedWorkerRunInProgress() ||
    hasHomeMultiRoundWorkerRunInProgress() ||
    // 计算器「模拟每轮时长」批运行（2026-10-10 登记）：模块级句柄，与首页多轮同列
    //（UI 侧运行反馈由计算器页面自身的响应式运行态承担）。
    hasDungeonCalculatorWorkerRunInProgress() ||
    // 预算优化注册表：搜索进行中 = 专属 worker 池占用（模块级普通变量，与其它句柄同列）。
    hasBudgetOptimizerRunInProgress()
  );
}

// 计算器「模拟每轮时长」运行态的响应式锚点（2026-10-17 登记，顶栏模式切换盲区修复）：
// 该运行态是 dungeonCalculatorStore.simulation.isRunning（另一个 store 的响应式字段），
// 不在上面的响应式清单内。顶栏模式按钮若直接 import 该 store 消费它，会把它依赖的
// services/dungeonProfitCalculator.js（6 份游戏数据 JSON）一并拉进主包，故以本 ref 桥接：
//   · 写入侧（dungeonCalculatorStore）：watch 跟随 simulation.isRunning 镜像整个运行区间
//     （导入窗口 / 批运行 / finally 复位全覆盖），行内不得手工散补；
//   · 消费侧（App.vue 顶栏模式按钮）：并入 gameModeSwitchLocked 的 disabled 计算。
// 契约：本锚点不并入 isReactiveSimulationBusy / isSimulationBusy（理由见文件头注释），
// 模块级句柄登记与点击时刻完整版兜底保持原样。
export const dungeonCalculatorRunInFlight = ref(false);

export function setDungeonCalculatorRunInFlight(value) {
  dungeonCalculatorRunInFlight.value = value === true;
}

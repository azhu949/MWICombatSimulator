// 预算优化 —— 运行注册表（模块级单运行标志的单一事实源，照 triggerOptimizerRunRegistry 模式）。
//
// 归属说明：搜索层（budgetOptimizerSearch）与 store 层（simulatorBudgetOptimizerActions）都需要
// **同步**访问「是否有预算优化搜索在运行」与「取消当前搜索」；但搜索模块静态依赖较重
// （playerMapper / 模拟链），store 不能静态 import 它；workerRuns 也不能反向依赖搜索模块
//（会形成循环）。因此这份轻量状态独立成本模块：只依赖 simulatorWorkerRuns（轻量），两侧共同引用。
//
// cancelBudgetOptimizerRun：置 cancelRequested 标志（让搜索在下一个检查点收尾为 cancelled，
// 而不是继续跑到完成）并终止所有 budget-optimizer scope 的专用 worker 运行。
// 没有运行时调用是空操作。

import { stopBudgetOptimizerWorkerRuns } from './simulatorWorkerRuns.js';

let activeRun = null;

export function registerBudgetOptimizerRun(run) {
  activeRun = run ?? null;
  return activeRun;
}

export function unregisterBudgetOptimizerRun(run) {
  if (activeRun === run) {
    activeRun = null;
  }
}

export function hasBudgetOptimizerRunInProgress() {
  return activeRun !== null;
}

export function cancelBudgetOptimizerRun() {
  if (!activeRun) {
    return;
  }
  activeRun.cancelRequested = true;
  stopBudgetOptimizerWorkerRuns();
}

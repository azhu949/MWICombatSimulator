// 技能触发器优化器 —— 运行注册表（模块级单运行标志的单一事实源）。
//
// 归属说明：搜索层（triggerOptimizerSearch）与 store 层
// （simulatorTriggerOptimizerActions）都需要**同步**访问「是否有触发器优化搜索
// 在运行」与「取消当前搜索」；但搜索模块静态依赖较重（playerMapper / 模拟链），
// store 不能静态 import 它（会破坏既有的懒加载策略），workerRuns 也不能反向依赖
// 搜索模块（会形成循环）。因此这份轻量状态独立成本模块：只依赖
// simulatorWorkerRuns（轻量），两侧共同引用。
//
// cancelTriggerOptimizerRun：置 cancelRequested 标志（让搜索在下一个检查点
// 收尾为 cancelled，而不是继续跑到完成）并终止所有 trigger-optimizer scope 的
// 专用 worker 运行。没有运行时调用是空操作。

import { stopTriggerOptimizerWorkerRuns } from './simulatorWorkerRuns.js';

let activeRun = null;

export function registerTriggerOptimizerRun(run) {
  activeRun = run ?? null;
  return activeRun;
}

export function unregisterTriggerOptimizerRun(run) {
  if (activeRun === run) {
    activeRun = null;
  }
}

export function hasTriggerOptimizerRunInProgress() {
  return activeRun !== null;
}

export function cancelTriggerOptimizerRun() {
  if (!activeRun) {
    return;
  }
  activeRun.cancelRequested = true;
  stopTriggerOptimizerWorkerRuns();
}

// 玩家配置写入串行器（2026-10-03）：导入/快照恢复类入口在同步实现下天然互斥；改为按需
// 加载（await 动态 import、await 资产分刷新）后，await 窗口内可被其它来源插队——用户手动
// 导入、快照恢复、主站桥接消息各自推进，先发起者在 await 之后才执行的破坏性动作（桥接侧
// clearPlayerSlots 清空「导入前预判」的槽位）会晚于后发起者的写入落地，把刚写入的槽位整槽清空。
//
// 契约：runExclusive 保证各操作按「调用顺序」串行——先发起者的操作返回之后，才启动后发起者
// 的操作；且交棒落到下一个宏任务，因此先发起者的调用方在 await 之后的后置动作（微任务续体）
// 必然已经执行完毕。交棒粒度必须是宏任务而不能是微任务：到达后置动作的 Promise 层数不可控
// （Pinia 的 action 包装会套 ret.then(...).catch(...)，async 函数的 return 还会多一次采纳），
// 若在微任务里直接交棒，后发起者的操作会抢在先发起者的后置动作之前落地，清除动作仍会误伤。
//
// 失败语义：操作自身的拒绝原样回给本次调用方（调用方自行 try/catch 或 .catch），队列不吞异常、
// 只负责顺序，失败后继续承接下一次调用。
//
// 重入约束：串行器不可重入——被包裹的操作内部不得再调用同样被包裹的入口，否则内层排队等待外层
// 完成而死锁。当前三个入口 importSoloConfig / importGroupConfig / loadPlayerDataSnapshot 互不
// 调用（loadPlayerDataSnapshot 用的是 importExportMapper 的纯函数 parseSoloImportConfig），
// 新增被包裹入口前必须复核这一点。
function deferToNextTask() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function createSerialMutationQueue() {
  let chain = Promise.resolve();
  return function runExclusive(operation) {
    const result = chain.then(operation, operation);
    // 队列只跟踪「交棒时机」：一次失败不得阻断后续调用；拒绝仍由 result 回给调用方。
    chain = result.then(deferToNextTask, deferToNextTask);
    return result;
  };
}

// store 三个玩家配置整体替换入口共用的进程内单例；桥接侧「await 之后才执行清除动作」所依赖的
// 排序不变量建立在该单例上（见 tampermonkeyImportBridge 的对应注释与回归用例
// __tests__/importLinkSerialization.test.js）。
export const runPlayerConfigMutationExclusive = createSerialMutationQueue();

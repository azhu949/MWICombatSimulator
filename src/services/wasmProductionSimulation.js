// 切片 5-B：生产路径 A/B 接线（WASM 引擎 / JS 引擎）。
//
// 契约（与 `wasmProductionBridge.js` / `worker.js` / `foodOptimizerSimulation.js` 成对维护）：
// - 调用方必须显式传 `useWasmEngine: true` 才会尝试 wasm 引擎；未开启时直接返回 `null`（走 JS）。
//   切片 18 起生产载荷默认带 true（见 simulationDomain / advisorDomain /
//   foodOptimizerSnapshot / simulatorSimulationActions / advisorRunExecution），
//   本函数的显式契约不变——显式 false / 缺省仍完整保留 JS 路径（测试与实验载荷用）。
// - 任何「不可用 / 不支持 / 运行失败」都返回 `null`，由调用方静默回退 JS 引擎：
//   · 引擎加载失败（`engine/pkg` 未构建、部署产物不含 wasm、加载异常）→ 本 realm 记住
//     「不可用」，后续请求不再重复尝试加载；
//   · 配置不受支持（副本 / 迷宫 / 卷轴 / 公会试炼 / 无区域）→ 见 `getProductionSupport`；
//   · 快照或运行时抛错（非有限数、缺模板、缺技能定义等）→ 同样回退，绝不让页面不可用。
// - wasm 引擎覆盖的轮次边界随切片 12/13/14 扩大：提前停止（`shouldStop` 的空蓝/死亡预算
//   谓词）由 Rust `earlyStop` 承接；阈值观察器（`observeFoodOptimizerThresholds` /
//   `observeInactiveFoodThresholds`）由 Rust `observers` 导出承接（纯读，simResult 不变）；
//   切片 14 起 full-result（经验记账 / 掉落上下文桶 / 1000-tick 时序快照 / 激怒层数）与
//   `logCombatEvents` / `enableHpMpVisualization` 组合也可走 wasm——时序随 simResult 的
//   `timeSeriesData` 一次性返回，代价是**没有流式 progress**（进度条 0→完成直跳，
//   图表在结束时才渲染）。仍留在 JS 的只有成本上界观察器
//   （`observeFoodOptimizerCostBound`，依赖 JS 运行时状态）。
// - 同一输入 + 同一 seed 下两侧结果逐字段一致（`wasmEngineProductionParity.test.js`）；
//   wasm 路径自带确定性，不需要 `Math.random` 播种作用域，也不消耗它。
import { loadWasmEngine } from './wasmEngineLoader.js';
import { buildProductionRequest, getProductionSupport, runWasmProductionSimulation } from './wasmProductionBridge.js';

let enginePromise = null;
let engineUnavailable = false;
let lastFallbackReason = '';

/// 诊断信息（测试与性能报告使用；不影响模拟行为）。
export function getWasmProductionDiagnostics() {
  return { engineUnavailable, lastFallbackReason };
}

/// 测试注入：直接给定引擎（`null` 表示加载失败），跳过真实加载路径。
export function setWasmProductionEngineForTests(engine) {
  enginePromise = Promise.resolve(engine ?? null);
  engineUnavailable = !engine;
  lastFallbackReason = '';
}

function loadEngine() {
  if (!enginePromise) {
    enginePromise = loadWasmEngine().then((engine) => {
      if (!engine) engineUnavailable = true;
      return engine;
    });
  }
  return enginePromise;
}

/**
 * 尝试用 wasm 引擎跑一轮生产模拟；返回 `{ simResult, observers }`（`observers` 未开启时
 * 为 null；Rust `SimResultState.to_value()` / `ObserverState.to_value()` 形状）。
 * 返回 `null` 表示调用方应当回退 JS 引擎（`getWasmProductionDiagnostics().lastFallbackReason`
 * 给出原因，便于日志 / UI 展示）。
 */
export async function tryRunWasmProductionRound({
  useWasmEngine = false,
  players,
  zone,
  labyrinth = null,
  isDungeon = false,
  simulationContext = null,
  seed,
  simulationTimeLimit,
  options = {},
}) {
  if (useWasmEngine !== true) {
    lastFallbackReason = 'disabled';
    return null;
  }

  const support = getProductionSupport({ zone, labyrinth, isDungeon, simulationContext, options });
  if (!support.supported) {
    lastFallbackReason = support.reason;
    return null;
  }

  if (engineUnavailable) {
    lastFallbackReason = 'engine_unavailable';
    return null;
  }
  const engine = await loadEngine();
  if (!engine) {
    lastFallbackReason = 'engine_unavailable';
    return null;
  }

  try {
    const request = buildProductionRequest({ players, zone, labyrinth, seed, simulationTimeLimit, options });
    const output = runWasmProductionSimulation(engine, request);
    lastFallbackReason = '';
    return output;
  } catch (error) {
    lastFallbackReason = `run_error: ${error?.message ?? String(error)}`;
    return null;
  }
}

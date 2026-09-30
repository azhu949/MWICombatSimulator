// 切片 5-B：生产路径 WASM 引擎接线（引擎 wasm-only，切片 21A/B）。
//
// 契约（与 `wasmProductionBridge.js` / `worker.js` / `foodOptimizerSimulation.js` 成对维护）：
// - 调用方必须显式传 `useWasmEngine: true` 才会尝试 wasm 引擎；未开启时直接返回 `null`
//   （测试用它构造拒绝路径，如 wiring 的 disabled 诊断码）。生产调用方（worker.js）
//   无条件传 true（切片 21A 起 JS 引擎已删除，不再有 JS 分支）。
// - 任何「不可用 / 不支持 / 运行失败」都返回 `null`，由调用方处置（worker 硬失败：
//   · 引擎加载失败（`engine/pkg` 未构建、部署产物不含 wasm、加载异常）→ 本 realm 记住
//   「不可用」，后续请求不再重复尝试加载；
//   · 配置不受支持（公会试炼 / 无区域——生产不可达的预留语义）→ 见 `getProductionSupport`；
//   · 快照或运行时抛错（非有限数、缺模板、缺技能定义等）→ 同样返回 null，调用方
//     （worker）按审计定案 D1 硬失败上报 simulation_error，不再有 JS 回退。
// - wasm 引擎覆盖的轮次边界随切片 12/13/14/20 扩大：提前停止（`shouldStop` 的空蓝/死亡
//   预算谓词）由 Rust `earlyStop` 承接；阈值观察器（`observeFoodOptimizerThresholds` /
//   `observeInactiveFoodThresholds`）由 Rust `observers` 导出承接（纯读，simResult 不变）；
//   切片 14 起 full-result（经验记账 / 掉落上下文桶 / 1000-tick 时序快照 / 激怒层数）与
//   `logCombatEvents` / `enableHpMpVisualization` 组合也可走 wasm——时序随 simResult 的
//   `timeSeriesData` 一次性返回，代价是**没有流式 progress**（进度条 0→完成直跳，
//   图表在结束时才渲染）；切片 20 起成本上界观察器（`observeFoodOptimizerCostBound`）
//   由 Rust `costBound` 承接（价格快照由桥侧预解析，停止结论/下界走独立输出字段）。
//   仍留在 JS 的只有公会试炼与无区域。
// - 同一输入 + 同一 seed 下输出确定，形状由 golden 快照锁定
//   （`wasmEngineProductionParity.test.js`，切片 21B 起对 golden 对账）；
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
 * 尝试用 wasm 引擎跑一轮生产模拟；返回 `{ simResult, observers, costBound }`（`observers` /
 * `costBound` 未开启时为 null；Rust `SimResultState.to_value()` / `ObserverState.to_value()` /
 * `cost_bound_output()` 形状）。
 * 返回 `null` 表示本轮 wasm 运行不可用（`getWasmProductionDiagnostics().lastFallbackReason`
 * 给出原因，便于日志 / UI 展示；生产调用方 worker 硬失败，无 JS 回退）。
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

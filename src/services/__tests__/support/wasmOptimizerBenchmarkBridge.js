// `scripts/benchmark-food-optimizer-wasm.mjs` 的 esbuild 入口之一（worker 侧使用）。
//
// esbuild 的 splitting 让本文件与 foodOptimizerSimulation.js 共享同一 chunk 图，
// Node 对同一文件 URL 只实例化一次模块：因此这里注入的引擎实例，就是
// `tryRunWasmProductionRound` 在候选轮里读取的实例。若模块被复制成两份实例，
// 注入会静默失效、A/B 读数会退化为「两边都走 JS」——基准脚本因此在 worker 侧
// 每次评估后都检查 `getWasmProductionDiagnostics()`，任何回退都大声失败。
export { loadWasmEngine } from '../../wasmEngineLoader.js';
export { getWasmProductionDiagnostics, setWasmProductionEngineForTests } from '../../wasmProductionSimulation.js';

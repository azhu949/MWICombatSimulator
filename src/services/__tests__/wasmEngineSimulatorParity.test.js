// 切片 4 parity：Rust `CombatSimulator`（战斗主循环：事件/技能/触发器/消耗品）与 JS
// `combatSimulator.js` 的**全轨迹精确对账**（事件流水 + simResult 调用流水 + 单位快照）。
//
// 前置：npm run build:wasm 产出 engine/pkg；未构建时整组跳过（CI 无 Rust 环境也保持绿色）。
//
// 对账契约（与 `engine/src/sim_probe.rs` 成对维护）：
// - `Math.random` 在整轮模拟期间被替换为 `createSeededRandom(seed)`（Rust 为 `Mulberry32`）；
// - 事件流水 `{time,type,source,target,hrid,value}` 逐条比对（含遭遇战/复活/DoT/CC/诅咒）；
// - simResult 调用流水逐条比对（攻击/治疗/法力/死亡/遭遇战结束/空蓝等）；
// - 单位快照（HP/MP/面板/增益注册表/CC 状态/技能与消耗品 lastUsed/法力记账）逐字比对。
//
// 注意：该测试锁定 JS 引擎的既有怪癖（随机数消费顺序、`parry` 抽样、`mayhem` 判定、
// 格挡时仍记 `'autoAttack'` 等）。JS 侧行为变更必须两侧同步，否则本测试立即翻红——这是刻意的。
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadWasmEngine } from '../wasmEngineLoader.js';
import {
  buildFuzzScenario,
  buildScenarioRequest,
  buildTargetedScenarioA,
  buildTargetedScenarioB,
  findSimulationDivergence,
  runJsScenario,
} from './support/wasmSimulatorParitySupport.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const pkgDir = resolve(root, 'engine', 'pkg');
const gluePath = resolve(pkgDir, 'mwi_combat_engine.js');
const wasmPath = resolve(pkgDir, 'mwi_combat_engine_bg.wasm');
const wasmPackageBuilt = existsSync(gluePath) && existsSync(wasmPath);

let enginePromise = null;
function getEngine() {
  if (!enginePromise) {
    enginePromise = loadWasmEngine({
      glueUrl: pathToFileURL(gluePath).href,
      // Node 无法 fetch file:// URL，直接注入 wasm 字节；浏览器端可用默认路径。
      moduleOrPath: readFile(wasmPath),
    }).then((engine) => {
      expect(engine, 'wasm engine must load when engine/pkg exists').not.toBeNull();
      return engine;
    });
  }
  return enginePromise;
}

async function runParity(engine, scenario) {
  const jsResult = await runJsScenario(scenario);
  const rustOutput = JSON.parse(engine.run_simulator_operations(JSON.stringify(buildScenarioRequest(scenario))));
  const rustResult = rustOutput.results[0];
  expect(findSimulationDivergence(jsResult, rustResult)).toBeNull();
  return { jsResult, rustResult };
}

describe.runIf(wasmPackageBuilt)('wasm engine slice-4 parity (combat main loop)', () => {
  it('reproduces the mixed attrition scenario (abilities, DoT, CC, curse/fury/weaken, thorns, food)', async () => {
    const engine = await getEngine();
    const { jsResult } = await runParity(engine, buildTargetedScenarioA());

    // 场景必须真的跑到主要路径上（防止退化成空转对账）。
    // 注意：45s 战斗窗口触达不到 60s 首次激怒 tick（enrageTick 由场景 B 覆盖）。
    expect(jsResult.eventCount).toBeGreaterThan(300);
    const eventTypes = new Set(jsResult.eventTrace.map((entry) => entry.type));
    expect(eventTypes.has('autoAttack')).toBe(true);
    expect(eventTypes.has('abilityCastEndEvent')).toBe(true);
    expect(eventTypes.has('regenTick')).toBe(true);
    expect(eventTypes.has('damageOverTime')).toBe(true);
    expect(eventTypes.has('stunExpiration')).toBe(true);
    expect(eventTypes.has('combatStart')).toBe(true);
    expect(jsResult.resultCalls.some((call) => call.method === 'addConsumableUse')).toBe(true);
    expect(jsResult.units.some((unit) => unit.combatBuffKeys.length > 0)).toBe(true);
  });

  it('reproduces the wipe and respawn scenario (encounter end, player respawn)', async () => {
    const engine = await getEngine();
    const { jsResult } = await runParity(engine, buildTargetedScenarioB());

    const eventTypes = new Set(jsResult.eventTrace.map((entry) => entry.type));
    expect(eventTypes.has('playerRespawn')).toBe(true);
    expect(eventTypes.has('enrageTick')).toBe(true);
    expect(jsResult.resultCalls.some((call) => call.method === 'addDeath')).toBe(true);
  });

  it('reproduces fuzz scenarios identically (3 seeds)', async () => {
    const engine = await getEngine();
    for (const seed of [5, 17, 33]) {
      const scenario = buildFuzzScenario(seed);
      const jsResult = await runJsScenario(scenario);
      const rustOutput = JSON.parse(engine.run_simulator_operations(JSON.stringify(buildScenarioRequest(scenario))));
      const rustResult = rustOutput.results[0];
      expect(findSimulationDivergence(jsResult, rustResult), `fuzz seed ${seed} must match exactly`).toBeNull();
      expect(jsResult.eventCount, `fuzz seed ${seed} must process events`).toBeGreaterThan(50);
    }
  });
});

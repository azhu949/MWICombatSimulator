// 切片 4 parity → 切片 21B（定案 D2）golden 快照：Rust `CombatSimulator`
// （战斗主循环：事件/技能/触发器/消耗品）探针的**全轨迹输出**（事件流水 +
// simResult 调用流水 + 单位快照）与 `fixtures/golden/simulator-*.json` 的固定期望
// 对账。JS 引擎已删除；行为语义回归防线在 cargo test（engine/src/*.rs）。
//
// 再生成：node scripts/generate-wasm-golden.mjs。
// 前置：npm run build:wasm 产出 engine/pkg；未构建时整组跳过。
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
} from './support/wasmSimulatorParitySupport.js';
import { expectMatchesGolden } from './support/goldenSnapshot.js';

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
      moduleOrPath: readFile(wasmPath),
    }).then((engine) => {
      expect(engine, 'wasm engine must load when engine/pkg exists').not.toBeNull();
      return engine;
    });
  }
  return enginePromise;
}

function runRustScenario(engine, scenario) {
  const rustOutput = JSON.parse(engine.run_simulator_operations(JSON.stringify(buildScenarioRequest(scenario))));
  const rustResult = rustOutput.results[0];
  expect(rustResult.error ?? null, 'rust probe scenario must not fail').toBeNull();
  return rustResult;
}

describe.runIf(wasmPackageBuilt)('wasm engine slice-4 golden (combat main loop)', () => {
  it('matches the golden trace of the mixed attrition scenario (abilities, DoT, CC, curse/fury/weaken, thorns, food)', async () => {
    const engine = await getEngine();
    const rustResult = runRustScenario(engine, buildTargetedScenarioA());
    expectMatchesGolden('simulator-targeted-a', rustResult);

    // 场景必须真的跑到主要路径上（防止退化成空转对账）。
    // 注意：45s 战斗窗口触达不到 60s 首次激怒 tick（enrageTick 由场景 B 覆盖）。
    expect(rustResult.eventCount).toBeGreaterThan(300);
    const eventTypes = new Set(rustResult.eventTrace.map((entry) => entry.type));
    expect(eventTypes.has('autoAttack')).toBe(true);
    expect(eventTypes.has('abilityCastEndEvent')).toBe(true);
    expect(eventTypes.has('regenTick')).toBe(true);
    expect(eventTypes.has('damageOverTime')).toBe(true);
    expect(eventTypes.has('stunExpiration')).toBe(true);
    expect(eventTypes.has('combatStart')).toBe(true);
    expect(rustResult.resultCalls.some((call) => call.method === 'addConsumableUse')).toBe(true);
    expect(rustResult.units.some((unit) => unit.combatBuffKeys.length > 0)).toBe(true);
  });

  it('matches the golden trace of the wipe and respawn scenario (encounter end, player respawn)', async () => {
    const engine = await getEngine();
    const rustResult = runRustScenario(engine, buildTargetedScenarioB());
    expectMatchesGolden('simulator-targeted-b', rustResult);

    const eventTypes = new Set(rustResult.eventTrace.map((entry) => entry.type));
    expect(eventTypes.has('playerRespawn')).toBe(true);
    expect(eventTypes.has('enrageTick')).toBe(true);
    expect(rustResult.resultCalls.some((call) => call.method === 'addDeath')).toBe(true);
  });

  it('matches the golden traces of fuzz scenarios (3 seeds)', async () => {
    const engine = await getEngine();
    for (const seed of [5, 17, 33]) {
      const rustResult = runRustScenario(engine, buildFuzzScenario(seed));
      expectMatchesGolden(`simulator-fuzz-${seed}`, rustResult);
      expect(rustResult.eventCount, `fuzz seed ${seed} must process events`).toBeGreaterThan(50);
    }
  });
});

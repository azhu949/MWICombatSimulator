// 切片 3 parity：Rust CombatUnit（属性结算 + 增益生命周期）与 JS 实现的**精确对账**（无统计容差）。
//
// 前置：npm run build:wasm 产出 engine/pkg；未构建时整组跳过（CI 无 Rust 环境也保持绿色）。
// 覆盖：
// - 结算分支：等级/生命/法力/命中/伤害/闪避/抗性/regen/施法/掉落/威胁（含 ratio==0 覆盖分支）；
// - 增益生命周期：源替换（REPLACE 级联清除）、最强源（STRONGEST）交接与平局、过期扫描、
//   legacy（无源）过期、clearBuffs/clearCCs、永久增益装配与 clearBuffs 的克隆语义、bulwark；
// - 校验报错：策略冲突、未支持的最强源、非法策略值、缺失 duration——错误类别与消息逐字一致。
//
// 注意：该测试同时锁定 combatUnit.js 的既有怪癖。若未来 JS 侧修改这些行为
// （级联清除、平局规则、tenacity 缺失语义等），本测试会失败——这是刻意的：
// 移植以「逐位 parity」为前提，行为变更必须两侧同步。
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadWasmEngine } from '../wasmEngineLoader.js';
import {
  buildFuzzCombatUnitOps,
  buildTargetedCombatUnitOps,
  driveJsCombatUnit,
} from './support/wasmCombatUnitParitySupport.js';
import { findTraceDivergence } from './support/wasmEngineParitySupport.js';

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

describe.runIf(wasmPackageBuilt)('wasm engine slice-3 parity (CombatUnit: stat resolution + buff lifecycle)', () => {
  it('replays the targeted combat-unit script identically', async () => {
    const engine = await getEngine();
    const ops = buildTargetedCombatUnitOps();
    const jsTrace = driveJsCombatUnit(ops);
    const rustTrace = JSON.parse(engine.run_unit_operations(JSON.stringify(ops)));
    expect(findTraceDivergence(jsTrace, rustTrace), 'targeted script traces must match exactly').toBeNull();
    // 脚本必须覆盖到真实结算（防止退化成全 null 轨迹的空转对账）。
    const snapshots = jsTrace.filter((entry) => entry.op === 'snapshotUnit');
    expect(snapshots.length).toBeGreaterThanOrEqual(8);
    // 锁定期望命中的校验错误（类别 + 消息逐字），Rust 轨迹已在上面做过逐项对账。
    const errors = jsTrace.filter((entry) => entry.error).map((entry) => `${entry.error.name}: ${entry.error.message}`);
    expect(errors).toEqual([
      'TypeError: Strongest-source policy is unsupported for /fuzz/policy',
      'TypeError: Strongest-source policy is unsupported for /fuzz/not_aura',
      'Error: CombatUnit buff source policy mismatch for /buff_uniques/guardian_aura_armor: replace vs strongest',
      'TypeError: Unsupported buff source policy: bogus',
      'TypeError: CombatUnit buff duration must be a finite number for /fuzz/no_duration',
    ]);
  });

  it('replays fuzz combat-unit scripts identically (3 seeds x 800 ops)', async () => {
    const engine = await getEngine();
    for (const seed of [3, 11, 29]) {
      const ops = buildFuzzCombatUnitOps(seed, 800);
      const jsTrace = driveJsCombatUnit(ops);
      const rustTrace = JSON.parse(engine.run_unit_operations(JSON.stringify(ops)));
      expect(findTraceDivergence(jsTrace, rustTrace), `fuzz seed ${seed} traces must match exactly`).toBeNull();
    }
  });
});

// 切片 2 parity：Rust 事件队列 / mulberry32 与 JS 实现的**精确对账**（无统计容差）。
//
// 前置：npm run build:wasm 产出 engine/pkg；未构建时整组跳过（CI 无 Rust 环境也保持绿色）。
// 覆盖：
// - mulberry32 随机流逐位一致（JS createSeededRandom ↔ Rust Mulberry32）；
// - hashSeed / deriveSeedSet 数值一致；
// - 事件队列在相同操作脚本下（含 tie 顺序、身份移除、按类型/单位清除）轨迹逐项一致。
//
// 注意：该测试同时锁定 heap-js 的行为。若未来升级 heap-js 导致事件顺序变化，
// 本测试会失败——这是刻意的：引擎对同时间事件顺序敏感，升级必须伴随回归评估。
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createSeededRandom, deriveSeedSet, hashSeed } from '../seededRandom.js';
import { loadWasmEngine } from '../wasmEngineLoader.js';
import {
  buildFuzzEventQueueOps,
  buildTargetedEventQueueOps,
  driveJsEventQueue,
  findTraceDivergence,
} from './support/wasmEngineParitySupport.js';

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

describe.runIf(wasmPackageBuilt)('wasm engine slice-2 parity (JS vs Rust)', () => {
  it('matches the mulberry32 stream bit for bit', async () => {
    const engine = await getEngine();
    for (const seed of [0, 1, 42, 0xdeadbeef, 4294967295]) {
      const expected = [];
      const rng = createSeededRandom(seed);
      for (let index = 0; index < 1000; index += 1) expected.push(rng());
      expect(Array.from(engine.rng_probe(seed, 1000))).toEqual(expected);
    }
  });

  it('matches hashSeed (ascii / CJK / empty)', async () => {
    const engine = await getEngine();
    for (const text of ['', 'hello', '中文测试', '/actions/combat/sorcerers_tower#4']) {
      expect(engine.hash_seed_probe(text)).toBe(hashSeed(text));
    }
  });

  it('matches deriveSeedSet', async () => {
    const engine = await getEngine();
    for (const [seed, count] of [
      [0, 5],
      [1, 3],
      [123, 0],
      [987654321, 8],
    ]) {
      expect(Array.from(engine.derive_seed_set_probe(seed, count))).toEqual(deriveSeedSet(seed, count));
    }
  });

  it('replays the targeted event-queue script identically', async () => {
    const engine = await getEngine();
    const ops = buildTargetedEventQueueOps();
    const jsTrace = driveJsEventQueue(ops);
    const rustTrace = JSON.parse(engine.run_event_queue_operations(JSON.stringify(ops)));
    expect(findTraceDivergence(jsTrace, rustTrace), 'targeted script traces must match exactly').toBeNull();
  });

  it('replays fuzz event-queue scripts identically (2000 ops x 2 seeds)', async () => {
    const engine = await getEngine();
    for (const seed of [1, 7]) {
      const ops = buildFuzzEventQueueOps(seed, 2000);
      const jsTrace = driveJsEventQueue(ops);
      const rustTrace = JSON.parse(engine.run_event_queue_operations(JSON.stringify(ops)));
      expect(findTraceDivergence(jsTrace, rustTrace), `fuzz seed ${seed} traces must match exactly`).toBeNull();
    }
  });
});

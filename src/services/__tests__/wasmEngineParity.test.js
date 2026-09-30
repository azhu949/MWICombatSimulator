// 切片 2 parity → 切片 21B（定案 D2）：mulberry32 / hashSeed / deriveSeedSet 仍是
// 双实现精确对账（JS `seededRandom.js` 保留——worker 种子派生在生产使用）；
// 事件队列操作脚本（含 tie 顺序、身份移除、按类型/单位清除）改为与 golden 快照
// 对账（JS EventQueue 已随 A 层删除，堆序语义由 Rust 单测与 golden 承载）。
//
// 注意：该测试同时锁定 wasm 引擎的队列行为。升级 wasm-bindgen / Rust 编译器导致
// 事件顺序变化时本测试会失败——这是刻意的：引擎对同时间事件顺序敏感，升级必须
// 伴随回归评估（node scripts/generate-wasm-golden.mjs 再生成 + review）。
//
// 前置：npm run build:wasm 产出 engine/pkg；未构建时整组跳过（CI 无 Rust 环境也保持绿色）。
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createSeededRandom, deriveSeedSet, hashSeed } from '../seededRandom.js';
import { loadWasmEngine } from '../wasmEngineLoader.js';
import { buildFuzzEventQueueOps, buildTargetedEventQueueOps } from './support/wasmEngineParitySupport.js';
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

  it('replays the targeted event-queue script against the golden trace', async () => {
    const engine = await getEngine();
    const ops = buildTargetedEventQueueOps();
    const rustTrace = JSON.parse(engine.run_event_queue_operations(JSON.stringify(ops)));
    expectMatchesGolden('eventqueue-targeted', rustTrace);
  });

  it('replays fuzz event-queue scripts against the golden traces (2000 ops x 2 seeds)', async () => {
    const engine = await getEngine();
    for (const seed of [1, 7]) {
      const ops = buildFuzzEventQueueOps(seed, 2000);
      const rustTrace = JSON.parse(engine.run_event_queue_operations(JSON.stringify(ops)));
      expectMatchesGolden(`eventqueue-fuzz-${seed}`, rustTrace);
    }
  });
});

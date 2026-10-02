import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getGlueUrlCandidates, loadWasmEngine } from '../wasmEngineLoader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const pkgDir = resolve(root, 'engine', 'pkg');
const gluePath = resolve(pkgDir, 'mwi_combat_engine.js');
const wasmPath = resolve(pkgDir, 'mwi_combat_engine_bg.wasm');
const wasmPackageBuilt = existsSync(gluePath) && existsSync(wasmPath);

describe('wasmEngineLoader', () => {
  it('returns null instead of throwing when the wasm package is unavailable (JS fallback path)', async () => {
    const engine = await loadWasmEngine({ glueUrl: new URL('./missing-wasm-package.js', import.meta.url).href });
    expect(engine).toBeNull();
  });

  it.runIf(wasmPackageBuilt)('loads the built wasm package and exposes the bridge probe', async () => {
    const engine = await loadWasmEngine({
      glueUrl: pathToFileURL(gluePath).href,
      // Node 无法 fetch file:// URL，直接注入 wasm 字节；浏览器端可用默认路径。
      moduleOrPath: await readFile(wasmPath),
    });
    expect(engine).not.toBeNull();
    expect(engine.bridge_probe(2, 3)).toContain('2+3=5');
  });

  it('dev 布局：两级上跳候选在前（胜出候选优先，省掉落空 404）', () => {
    const urls = getGlueUrlCandidates({
      dev: true,
      moduleUrl: 'http://localhost:5173/src/services/wasmEngineLoader.js',
    });
    expect(urls).toEqual([
      'http://localhost:5173/engine/pkg/mwi_combat_engine.js',
      'http://localhost:5173/src/engine/pkg/mwi_combat_engine.js',
    ]);
  });

  it('打包布局（含 GitHub Pages 子路径）：一级上跳候选在前，另一条作为兜底保留', () => {
    const urls = getGlueUrlCandidates({
      dev: false,
      moduleUrl: 'https://user.github.io/mwisim/assets/worker-abc123.js',
    });
    expect(urls).toEqual([
      'https://user.github.io/mwisim/engine/pkg/mwi_combat_engine.js',
      'https://user.github.io/engine/pkg/mwi_combat_engine.js',
    ]);
  });
});

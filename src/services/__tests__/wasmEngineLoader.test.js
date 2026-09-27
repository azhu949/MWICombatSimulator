import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadWasmEngine } from '../wasmEngineLoader.js';

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
});

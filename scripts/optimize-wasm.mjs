// Post-processes the wasm-pack output with wasm-opt (binaryen) at -O4.
// Slice 10 verified: identical parity (17/17), no benchmark regression, and a
// ~12.6% size cut. binaryen ships a Node CLI wrapper (bin/wasm-opt has no .exe
// extension), so it must be spawned through the node binary itself.
// node scripts/optimize-wasm.mjs
import { spawnSync } from 'node:child_process';
import { renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wasmPath = resolve(root, 'engine', 'pkg', 'mwi_combat_engine_bg.wasm');
const tempPath = `${wasmPath}.opt`;
const wasmOptCli = resolve(root, 'node_modules', 'binaryen', 'bin', 'wasm-opt');

let before;
try {
  before = statSync(wasmPath).size;
} catch {
  console.error(`WASM output missing at ${wasmPath}. Run: wasm-pack build engine --target web`);
  process.exit(1);
}

// Write to a temp file first, then rename: keeps engine/pkg from ever holding
// a truncated module if the optimizer is interrupted mid-write.
const result = spawnSync(process.execPath, [wasmOptCli, wasmPath, '-O4', '-o', tempPath], {
  stdio: 'inherit',
});
if (result.status !== 0) {
  try {
    unlinkSync(tempPath);
  } catch {
    // No temp file was produced; nothing to clean up.
  }
  console.error(`wasm-opt failed with exit code ${result.status}`);
  process.exit(result.status ?? 1);
}
renameSync(tempPath, wasmPath);

const after = statSync(wasmPath).size;
const delta = ((after - before) / before) * 100;
console.log(`wasm-opt -O4: ${before} -> ${after} bytes (${delta.toFixed(1)}%)`);

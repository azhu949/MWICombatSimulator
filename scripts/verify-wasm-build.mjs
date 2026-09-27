// Verifies the Rust/WASM engine build chain end to end (slice 1).
// Loads engine/pkg produced by `npm run build:wasm`, initializes it in Node,
// and calls the bridge probe export. Fails loudly if the package is missing,
// so the WASM side of the engine can never rot silently.
// node scripts/verify-wasm-build.mjs
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = resolve(root, 'engine', 'pkg');
const gluePath = resolve(pkgDir, 'mwi_combat_engine.js');
const wasmPath = resolve(pkgDir, 'mwi_combat_engine_bg.wasm');

try {
  await access(gluePath);
  await access(wasmPath);
} catch {
  console.error(`WASM package missing at ${pkgDir}. Run: npm run build:wasm`);
  process.exit(1);
}

const glue = await import(pathToFileURL(gluePath).href);
// wasm-pack web target: initSync accepts the module bytes directly, which keeps
// this verification free of fetch/file-URL differences between Node versions.
glue.initSync({ module: await readFile(wasmPath) });

const probe = glue.bridge_probe(2, 3);
assert.equal(typeof probe, 'string', 'bridge_probe must return a string');
assert(probe.includes('2+3=5'), `bridge_probe returned unexpected value: ${probe}`);

console.log(`WASM build chain OK: ${probe}`);

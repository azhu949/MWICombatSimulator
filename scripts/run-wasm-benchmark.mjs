// 运行切片 6 的 WASM / JS 生产路径性能对照基准（设置环境变量后转发给 vitest）。
// 用法：npm run benchmark:wasm-engine
//     可选环境变量：WASM_BENCH_ROUNDS / WASM_BENCH_HOURS / WASM_BENCH_SEED
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = 'src/services/__tests__/wasmEngineBenchmark.test.js';
const vitestBin = resolve(root, 'node_modules', 'vitest', 'vitest.mjs');

const result = spawnSync(process.execPath, [vitestBin, 'run', target, '--reporter=basic'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, WASM_BENCH: '1' },
});

process.exit(result.status ?? 1);

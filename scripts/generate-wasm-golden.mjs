// 切片 21B（定案 D2）：再生成 wasm golden 快照。
//
// 用法：node scripts/generate-wasm-golden.mjs [vitest 过滤参数...]
// 不带参数时跑全部 golden 套件；以 GOLDEN_UPDATE=1 运行，缺失/过期的期望 JSON
// 会被当前引擎输出覆盖。提交前务必人工 review diff——golden 变化必须能归因到
// 有意的行为/数据变更（否则是回归）。
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vitestBin = resolve(root, 'node_modules', 'vitest', 'vitest.mjs');
const targets = [
  'src/services/__tests__/wasmEngineProductionParity.test.js',
  'src/services/__tests__/wasmEngineSimulatorParity.test.js',
  'src/services/__tests__/wasmEngineParity.test.js',
];
const extra = process.argv.slice(2);

const result = spawnSync(
  process.execPath,
  [vitestBin, 'run', ...(extra.length ? extra : targets), '--reporter=basic'],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, GOLDEN_UPDATE: '1' },
  },
);

process.exit(result.status ?? 1);

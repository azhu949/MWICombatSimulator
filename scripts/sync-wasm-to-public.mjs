// 把 wasm-pack + wasm-opt 的产物同步到 public/engine/pkg（切片 18）。
// public 目录由 vite 接管：dev 下映射到站点根（/engine/pkg/...），
// 构建时原样拷进 dist/engine/pkg——提交进仓库的是这份同步副本，
// CI 无 Rust 工具链也能构建出带 wasm 引擎的部署产物。
// node scripts/sync-wasm-to-public.mjs（build:wasm 的最后一步）
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = resolve(root, 'engine', 'pkg');
const targetDir = resolve(root, 'public', 'engine', 'pkg');
// 运行时只需这两个文件（.d.ts / package.json / README 不进部署产物）。
const files = ['mwi_combat_engine.js', 'mwi_combat_engine_bg.wasm'];

mkdirSync(targetDir, { recursive: true });
for (const file of files) {
  const target = resolve(targetDir, file);
  copyFileSync(resolve(sourceDir, file), target);
  console.log(`sync-wasm: ${file} ${statSync(target).size} bytes -> public/engine/pkg`);
}

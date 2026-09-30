// 切片 21B（定案 D2）：golden 快照比较助手。
//
// JS 引擎删除后，parity 测试从「JS vs Rust 双引擎对账」改为「固定输入 → 固定期望 JSON」：
// 期望值以当前 wasm 引擎输出生成并提交进仓库（fixtures/golden/*.json），之后任何
// 输出漂移（引擎行为变化 / 游戏数据表变化 / 桥序列化变化）都会翻红。
//
// 再生成：node scripts/generate-wasm-golden.mjs（内部以 GOLDEN_UPDATE=1 跑 vitest，
// 覆盖全部 golden 文件）。提交前务必人工 review diff——golden 变化必须能归因到
// 有意的行为/数据变更。
//
// 行为语义的回归防线在 cargo test（engine/src/*.rs，128+ 用例）；本套只锁
// 「wasm 输出字节不漂移」。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

const goldenDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'golden');
const UPDATE = process.env.GOLDEN_UPDATE === '1';

export function expectMatchesGolden(name, actual) {
  const file = resolve(goldenDir, `${name}.json`);
  // JSON 往返归一：undefined 自有属性消失——与 Rust to_value 的「键不存在」语义一致。
  const value = JSON.parse(JSON.stringify(actual));
  if (UPDATE) {
    mkdirSync(goldenDir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  if (!existsSync(file)) {
    throw new Error(
      `Golden snapshot missing: ${name}.json — run "node scripts/generate-wasm-golden.mjs" to create it.`,
    );
  }
  expect(value).toEqual(JSON.parse(readFileSync(file, 'utf8')));
}

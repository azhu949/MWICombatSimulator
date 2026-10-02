// Rust/WASM 引擎加载器（切片 1：基建；切片 5 接入 worker 时按需扩展缓存策略）。
//
// 设计约束：
// - engine/pkg 是可选的本地构建产物（git 忽略，见 package.json 的 build:wasm）。
//   加载失败（未构建 / 部署产物未包含）必须静默返回 null，由调用方回退纯 JS 引擎，
//   绝不让页面/worker 因 wasm 缺失而不可用。
// - 产物路径用变量拼接，避免 Vite 在构建期静态解析 new URL(...) 字面量，
//   导致「pkg 不存在就无法构建」。
export async function loadWasmEngine({ glueUrl, moduleOrPath } = {}) {
  const urls = glueUrl ? [glueUrl] : getGlueUrlCandidates();
  for (const url of urls) {
    try {
      const glue = await import(/* @vite-ignore */ url);
      // wasm-bindgen web target 的初始化函数：不传参时自行 fetch 相对 wasm；
      // 传入字节（Node 无法 fetch file:// URL）时用对象参数形式。
      await glue.default(moduleOrPath === undefined ? undefined : { module_or_path: moduleOrPath });
      return glue;
    } catch {
      // 缺产物 / 初始化失败都视作该候选不可用，继续尝试下一个。
    }
  }
  return null;
}

// 引擎产物的部署位是 public/engine/pkg（切片 18）：dev 下 vite 把 public 映射到
// 站点根、构建时原样拷进 dist/engine/pkg，CI 无 Rust 工具链也能产出带 wasm 的
// dist（产物随仓库提交）。两个候选对应两种布局（上跳级数不同）；此前固定把两级
// 上跳排前，在 GitHub Pages 子路径（user.github.io/<repo>/）下每次新建 realm 都先
// 打一条 404（越出 <repo>/ 前缀），2026-10-01 起改为**胜出候选优先**。
const GLUE_URL_SEGMENTS_SOURCE = ['..', '..', 'engine', 'pkg', 'mwi_combat_engine.js'];
const GLUE_URL_SEGMENTS_BUNDLE = ['..', 'engine', 'pkg', 'mwi_combat_engine.js'];

/**
 * 候选 URL 按序尝试（每 realm 首次加载各命中其一；落空的候选只 404 一次）。
 * 顺序 = 胜出候选排首位：
 * - dev / Node（源码布局：本模块位于 src/services/，两级上跳 = 站点根）：`../..` 优先；
 * - 构建产物（打包布局：worker bundle 位于 assets/，一级上跳 = 站点根）：`..` 优先。
 * 兜底保留另一条：判定失准时（import.meta.env 缺失等）仍能加载（只付一次 404）。
 * 判定与 enginePrewarm.buildEnginePrewarmUrls 的 `dev ? '../..' : '..'` 同款 ——
 * 预热 URL 必须与这里胜出候选一致（HTTP 缓存 / 代码缓存按 URL 为键）。
 */
export function getGlueUrlCandidates({ dev = Boolean(import.meta.env?.DEV), moduleUrl = import.meta.url } = {}) {
  const ordered = dev
    ? [GLUE_URL_SEGMENTS_SOURCE, GLUE_URL_SEGMENTS_BUNDLE]
    : [GLUE_URL_SEGMENTS_BUNDLE, GLUE_URL_SEGMENTS_SOURCE];
  return ordered.map((segments) => new URL(segments.join('/'), moduleUrl).href);
}

// Rust/WASM 引擎加载器（切片 1：基建；切片 5 接入 worker 时按需扩展缓存策略）。
//
// 设计约束：
// - engine/pkg 是可选的本地构建产物（git 忽略，见 package.json 的 build:wasm）。
//   加载失败（未构建 / 部署产物未包含）必须静默返回 null，由调用方回退纯 JS 引擎，
//   绝不让页面/worker 因 wasm 缺失而不可用。
// - 产物路径用变量拼接，避免 Vite 在构建期静态解析 new URL(...) 字面量，
//   导致「pkg 不存在就无法构建」。
export async function loadWasmEngine({ glueUrl, moduleOrPath } = {}) {
  const url = glueUrl ?? defaultGlueUrl();
  try {
    const glue = await import(/* @vite-ignore */ url);
    // wasm-bindgen web target 的初始化函数：不传参时自行 fetch 相对 wasm；
    // 传入字节（Node 无法 fetch file:// URL）时用对象参数形式。
    await glue.default(moduleOrPath === undefined ? undefined : { module_or_path: moduleOrPath });
    return glue;
  } catch {
    return null;
  }
}

function defaultGlueUrl() {
  const segments = ['..', '..', 'engine', 'pkg', 'mwi_combat_engine.js'];
  return new URL(segments.join('/'), import.meta.url).href;
}

// 首次点击「开始模拟」冷启动卡顿的预热模块（2026-10-01）。
//
// 背景：每次点击都会 new Worker 新建 realm（workerClient.js），worker 收到
// start_simulation 后才按需加载 wasm 引擎（wasmEngineLoader.js）。因此首次点击
// 要串行支付：worker bundle（约 3.7MB）+ glue JS + wasm 二进制（约 800KB）的
// 冷下载与冷编译；第二次起这些资源全部命中浏览器 HTTP 缓存 / 代码缓存，所以
// 不再卡。本模块把这笔「冷启动税」挪到页面加载完成的空闲时间预付：
//   1) WebAssembly.compileStreaming 预编译 wasm —— 暖 HTTP 缓存 + 代码缓存（跨 realm 共享）；
//   2) fetch glue JS —— 暖 worker 内动态 import 的同一 URL；
//   3) 起一个瞬时 worker（与生产同一入口，Vite worker 插件按入口去重、共享同一
//      chunk URL），ping/pong 握手确认 bundle 下载并执行完毕后 terminate ——
//      暖 worker bundle 的 HTTP 缓存。
// 全部失败路径静默：预热只是「提前交税」，失败时体验退化为现状，不会更糟；
// 也不改变任何模拟行为（预热 worker 不接收 start_simulation，与模拟 worker 隔离）。

const ENGINE_PKG_DIR = 'engine/pkg';
const GLUE_FILE = 'mwi_combat_engine.js';
const WASM_FILE = 'mwi_combat_engine_bg.wasm';

/// 构建预热 URL。落点必须与 worker 侧 wasmEngineLoader 的**胜出候选**同一 URL
/// （HTTP 缓存 / 代码缓存按 URL 为键）：
/// - dev：本模块位于 src/services/，与 loader 同目录 —— 两级上跳 = 站点根（vite 把
///   public/ 映射到根），与 loader 的 ['..','..','engine','pkg'] 候选一致；
/// - 打包：本模块混入 assets/ 下的主 chunk —— 一级上跳 = 站点根，与 worker bundle
///   （assets/worker-*.js）内 loader 的胜出候选 ['..','engine','pkg'] 一致；
///   相对跳层天然适配 GitHub Pages 子路径（base: './'），不能用 BASE_URL 拼绝对路径。
export function buildEnginePrewarmUrls({ moduleUrl = import.meta.url, dev = import.meta.env.DEV } = {}) {
  const base = (dev ? '../..' : '..') + '/';
  return {
    glueUrl: new URL(`${base}${ENGINE_PKG_DIR}/${GLUE_FILE}`, moduleUrl).href,
    wasmUrl: new URL(`${base}${ENGINE_PKG_DIR}/${WASM_FILE}`, moduleUrl).href,
  };
}

/**
 * 预热 wasm 引擎资源。返回诊断信息（不抛错）：
 * `{ ok, glueFetched, wasmCompiled, reason }` —— `ok` 以 wasm 编译成功为准
 * （glue 是 13KB 的小文件，失败只损失一点 HTTP 缓存热度，不算失败）。
 */
export async function prewarmWasmEngine({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  wasm = globalThis.WebAssembly,
  urls = buildEnginePrewarmUrls(),
} = {}) {
  const result = { ok: false, glueFetched: false, wasmCompiled: false, reason: '' };
  if (typeof fetchImpl !== 'function' || !wasm) {
    result.reason = 'unsupported';
    return result;
  }

  // glue JS：worker 里 wasmEngineLoader 动态 import 的同一 URL。
  try {
    const glueResponse = await fetchImpl(urls.glueUrl);
    if (glueResponse?.ok) result.glueFetched = true;
  } catch {
    // 静默：预热失败不影响功能。
  }

  try {
    const wasmResponse = await fetchImpl(urls.wasmUrl);
    if (!wasmResponse?.ok) {
      result.reason = `wasm_http_${wasmResponse?.status ?? 'unknown'}`;
      return result;
    }
    let compiled = false;
    if (typeof wasm.compileStreaming === 'function') {
      try {
        // 只编译不实例化：wasm-bindgen 模块带 wbg 函数导入，实例化需要 glue 提供
        // imports；而代码缓存写入发生在编译阶段，链接是廉价操作，无需真正实例化。
        await wasm.compileStreaming(Promise.resolve(wasmResponse));
        compiled = true;
      } catch {
        compiled = false; // MIME 不符等场景，走非流式兜底（重取命中 HTTP 缓存）。
      }
    }
    if (!compiled) {
      if (typeof wasm.compile !== 'function') {
        result.reason = 'unsupported_compile';
        return result;
      }
      const bytesResponse = await fetchImpl(urls.wasmUrl);
      await wasm.compile(await bytesResponse.arrayBuffer());
    }
    result.wasmCompiled = true;
    result.ok = true;
    return result;
  } catch (error) {
    result.reason = `wasm_${error?.name ?? 'error'}`;
    return result;
  }
}

/// 与 workerClient.js 完全相同的入口字面量：Vite worker 插件按入口（src/worker.js）
/// 去重，这里与生产路径共享同一个 worker chunk URL（暖同一 HTTP 缓存条目）。
function createDefaultPrewarmWorker() {
  return new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
}

/**
 * 预热 worker bundle：起一个瞬时 worker，握手确认 bundle 已下载执行，随即
 * terminate（不执行任何模拟）。返回 `{ ok, reason }`（不抛错）。
 */
export async function prewarmWorkerBundle({ createWorker = createDefaultPrewarmWorker, timeoutMs = 60000 } = {}) {
  if (typeof createWorker !== 'function') {
    return { ok: false, reason: 'unsupported' };
  }
  let worker;
  try {
    worker = createWorker();
  } catch {
    return { ok: false, reason: 'worker_spawn_failed' };
  }
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (ok, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        worker.terminate();
      } catch {
        // terminate 失败无需处理：worker 空闲挂起，开销可忽略。
      }
      resolve({ ok, reason });
    };
    const timer = setTimeout(() => finish(false, 'timeout'), timeoutMs);
    worker.onmessage = (event) => {
      if (event?.data?.type === 'prewarm_pong') finish(true, 'pong');
    };
    worker.onerror = () => finish(false, 'worker_error');
    try {
      // 消息会在 worker 启动完成（bundle 下载 + 执行）后才被处理，
      // 收到回包即证明冷启动资源已进缓存。
      worker.postMessage({ type: 'prewarm_ping' });
    } catch {
      finish(false, 'post_failed');
    }
  });
}

function runPrewarms(options) {
  try {
    prewarmWasmEngine(options).catch(() => {});
    prewarmWorkerBundle(options).catch(() => {});
  } catch {
    // 预热永远不能影响功能。
  }
}

/**
 * 页面加载完成后在空闲时间调度一次预热（幂等，重复调用直接返回 false）。
 * 等待 load 事件是为了不与首屏资源竞争带宽；requestIdleCallback 不可用时
 * 退化为定时器。所有依赖（fetch / Worker / window / document）均可注入，供测试。
 */
export function scheduleEnginePrewarm(options = {}) {
  if (prewarmScheduled) return false;
  prewarmScheduled = true;

  const scheduleIdle = () => {
    const ric =
      typeof options.requestIdleCallback === 'function'
        ? options.requestIdleCallback
        : typeof globalThis.requestIdleCallback === 'function'
          ? globalThis.requestIdleCallback.bind(globalThis)
          : null;
    if (ric) {
      ric(() => runPrewarms(options), { timeout: options.idleTimeoutMs ?? 3000 });
    } else {
      setTimeout(() => runPrewarms(options), options.idleFallbackMs ?? 1500);
    }
  };

  const windowImpl = options.window ?? (typeof window !== 'undefined' ? window : undefined);
  const documentImpl = options.document ?? (typeof document !== 'undefined' ? document : undefined);

  if (!windowImpl || documentImpl?.readyState === 'complete') {
    scheduleIdle();
  } else {
    windowImpl.addEventListener('load', scheduleIdle, { once: true });
  }
  return true;
}

let prewarmScheduled = false;

/// 测试注入：重置幂等门闩。
export function resetEnginePrewarmForTests() {
  prewarmScheduled = false;
}

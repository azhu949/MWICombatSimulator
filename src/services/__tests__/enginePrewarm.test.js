import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildEnginePrewarmUrls,
  prewarmWasmEngine,
  prewarmWorkerBundle,
  scheduleEnginePrewarm,
  resetEnginePrewarmForTests,
} from '../enginePrewarm.js';
import { getGlueUrlCandidates } from '../wasmEngineLoader.js';

const RESPONSE = { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };

function createWasmStub({ compileStreamingResult = Promise.resolve({}) } = {}) {
  return {
    compile: vi.fn(async () => {}),
    compileStreaming: vi.fn(() => compileStreamingResult),
  };
}

describe('buildEnginePrewarmUrls', () => {
  it('dev 布局：与 wasmEngineLoader 同目录，两级上跳到站点根', () => {
    const urls = buildEnginePrewarmUrls({
      moduleUrl: 'http://localhost:5173/src/services/enginePrewarm.js',
      dev: true,
    });
    expect(urls.glueUrl).toBe('http://localhost:5173/engine/pkg/mwi_combat_engine.js');
    expect(urls.wasmUrl).toBe('http://localhost:5173/engine/pkg/mwi_combat_engine_bg.wasm');
  });

  it('打包布局：模块位于 assets/，一级上跳到站点根（含 GitHub Pages 子路径）', () => {
    const urls = buildEnginePrewarmUrls({
      moduleUrl: 'https://user.github.io/mwisim/assets/index-B123.js',
      dev: false,
    });
    expect(urls.glueUrl).toBe('https://user.github.io/mwisim/engine/pkg/mwi_combat_engine.js');
    expect(urls.wasmUrl).toBe('https://user.github.io/mwisim/engine/pkg/mwi_combat_engine_bg.wasm');
  });
});

// 缓存键一致性（2026-10-01）：预热 URL 必须与 worker 侧 wasmEngineLoader 的
// **胜出候选**同一 URL —— 否则预热的 HTTP 缓存 / 代码缓存对 realm 内加载无效。
// 两模块各自以「dev ? '../..' : '..'」判定布局，此套断言把双方的胜出 URL 锁在一起。
describe('loader 与 prewarm 的胜出 URL 一致性', () => {
  it('dev：两模块同目录，两级上跳命中同一 glue URL', () => {
    const loaderCandidates = getGlueUrlCandidates({
      dev: true,
      moduleUrl: 'http://localhost:5173/src/services/wasmEngineLoader.js',
    });
    const prewarmUrls = buildEnginePrewarmUrls({
      moduleUrl: 'http://localhost:5173/src/services/enginePrewarm.js',
      dev: true,
    });
    expect(loaderCandidates[0]).toBe(prewarmUrls.glueUrl);
  });

  it('打包：worker bundle 与主 chunk 同处 assets/，一级上跳命中同一 glue URL', () => {
    const loaderCandidates = getGlueUrlCandidates({
      dev: false,
      moduleUrl: 'https://user.github.io/mwisim/assets/worker-abc123.js',
    });
    const prewarmUrls = buildEnginePrewarmUrls({
      moduleUrl: 'https://user.github.io/mwisim/assets/index-B123.js',
      dev: false,
    });
    expect(loaderCandidates[0]).toBe(prewarmUrls.glueUrl);
  });
});

describe('prewarmWasmEngine', () => {
  const URLS = buildEnginePrewarmUrls({ moduleUrl: 'https://a.com/assets/enginePrewarm.js', dev: false });

  it('compileStreaming 成功：ok=true、wasmCompiled=true、glueFetched=true', async () => {
    const fetchImpl = vi.fn(async () => RESPONSE);
    const wasm = createWasmStub();
    const result = await prewarmWasmEngine({ fetchImpl, wasm, urls: URLS });
    expect(result).toEqual({ ok: true, glueFetched: true, wasmCompiled: true, reason: '' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(wasm.compileStreaming).toHaveBeenCalledTimes(1);
    expect(wasm.compile).not.toHaveBeenCalled();
  });

  it('compileStreaming 失败时用非流式 compile 兜底（第二次 fetch 命中 HTTP 缓存）', async () => {
    const fetchImpl = vi.fn(async () => RESPONSE);
    const wasm = createWasmStub({ compileStreamingResult: Promise.reject(new TypeError('mime')) });
    const result = await prewarmWasmEngine({ fetchImpl, wasm, urls: URLS });
    expect(result.ok).toBe(true);
    expect(wasm.compile).toHaveBeenCalledTimes(1);
  });

  it('compileStreaming 缺失时直接走 compile 分支', async () => {
    const fetchImpl = vi.fn(async () => RESPONSE);
    const wasm = { compile: vi.fn(async () => {}) };
    const result = await prewarmWasmEngine({ fetchImpl, wasm, urls: URLS });
    expect(result.ok).toBe(true);
    expect(wasm.compile).toHaveBeenCalledTimes(1);
  });

  it('wasm HTTP 失败：ok=false 且 reason 带 http 状态', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }));
    const result = await prewarmWasmEngine({ fetchImpl, wasm: createWasmStub(), urls: URLS });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('wasm_http_404');
  });

  it('glue 拉取失败不阻塞 wasm 预热', async () => {
    const fetchImpl = vi.fn(async (url) => (url.endsWith('.wasm') ? RESPONSE : Promise.reject(new Error('glue down'))));
    const result = await prewarmWasmEngine({ fetchImpl, wasm: createWasmStub(), urls: URLS });
    expect(result).toEqual({ ok: true, glueFetched: false, wasmCompiled: true, reason: '' });
  });

  it('缺 fetch/WebAssembly 时静默返回 unsupported', async () => {
    // 显式传 null（而非 undefined，undefined 会触发解构默认值拿到 Node 自带实现）。
    const result = await prewarmWasmEngine({ fetchImpl: null, wasm: null, urls: {} });
    expect(result).toEqual({ ok: false, glueFetched: false, wasmCompiled: false, reason: 'unsupported' });
  });

  it('wasm 编译抛错时返回带原因的对象而非抛出', async () => {
    const fetchImpl = vi.fn(async () => RESPONSE);
    const wasm = {
      compile: vi.fn(async () => {
        throw new Error('x');
      }),
      compileStreaming: vi.fn(() => Promise.reject(new RangeError('bad module'))),
    };
    const result = await prewarmWasmEngine({ fetchImpl, wasm, urls: URLS });
    expect(result.ok).toBe(false);
    // compileStreaming 的 RangeError 被捕获后走 compile 兜底，最终记录的是 compile 的错误。
    expect(result.reason).toBe('wasm_Error');
  });
});

describe('prewarmWorkerBundle', () => {
  function createHandshakeWorker() {
    const worker = {
      onmessage: null,
      onerror: null,
      postMessage: vi.fn((message) => {
        if (message?.type === 'prewarm_ping') {
          queueMicrotask(() => worker.onmessage?.({ data: { type: 'prewarm_pong' } }));
        }
      }),
      terminate: vi.fn(),
    };
    return worker;
  }

  it('pong 握手成功：ok=true 并 terminate', async () => {
    const worker = createHandshakeWorker();
    const result = await prewarmWorkerBundle({ createWorker: () => worker, timeoutMs: 1000 });
    expect(result).toEqual({ ok: true, reason: 'pong' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('worker error：ok=false 且仍 terminate', async () => {
    const worker = {
      onmessage: null,
      onerror: null,
      postMessage: vi.fn(() => queueMicrotask(() => worker.onerror?.(new Error('boom')))),
      terminate: vi.fn(),
    };
    const result = await prewarmWorkerBundle({ createWorker: () => worker, timeoutMs: 1000 });
    expect(result).toEqual({ ok: false, reason: 'worker_error' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('超时：ok=false 且仍 terminate', async () => {
    vi.useFakeTimers();
    try {
      const worker = { onmessage: null, onerror: null, postMessage: vi.fn(), terminate: vi.fn() };
      const pending = prewarmWorkerBundle({ createWorker: () => worker, timeoutMs: 50 });
      await vi.advanceTimersByTimeAsync(51);
      const result = await pending;
      expect(result).toEqual({ ok: false, reason: 'timeout' });
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('createWorker 缺失时返回 unsupported', async () => {
    // 显式传 null：undefined 会触发解构默认值拿到真实工厂函数。
    const result = await prewarmWorkerBundle({ createWorker: null, timeoutMs: 10 });
    expect(result).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('createWorker 抛错时返回 worker_spawn_failed', async () => {
    const result = await prewarmWorkerBundle({
      createWorker: () => {
        throw new Error('no worker');
      },
      timeoutMs: 10,
    });
    expect(result).toEqual({ ok: false, reason: 'worker_spawn_failed' });
  });
});

describe('scheduleEnginePrewarm', () => {
  beforeEach(() => {
    resetEnginePrewarmForTests();
  });

  afterEach(() => {
    resetEnginePrewarmForTests();
  });

  function createOptions(overrides = {}) {
    return {
      fetchImpl: vi.fn(async () => RESPONSE),
      wasm: createWasmStub(),
      createWorker: vi.fn(() => {
        throw new Error('no worker');
      }),
      requestIdleCallback: vi.fn((cb) => cb()),
      document: { readyState: 'complete' },
      window: undefined,
      ...overrides,
    };
  }

  it('document complete 时直接调度 idle 回调并触发两路预热', async () => {
    const options = createOptions();
    expect(scheduleEnginePrewarm(options)).toBe(true);
    expect(options.requestIdleCallback).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(options.fetchImpl).toHaveBeenCalled());
    expect(options.createWorker).toHaveBeenCalled();
  });

  it('window 未加载完成时挂 load 监听（不与首屏资源竞争带宽）', () => {
    const listeners = [];
    const fakeWindow = { addEventListener: vi.fn((_, handler) => listeners.push(handler)) };
    const options = createOptions({ document: { readyState: 'loading' }, window: fakeWindow });
    expect(scheduleEnginePrewarm(options)).toBe(true);
    expect(options.requestIdleCallback).not.toHaveBeenCalled();
    expect(fakeWindow.addEventListener).toHaveBeenCalledWith('load', expect.any(Function), { once: true });
    listeners[0]();
    expect(options.requestIdleCallback).toHaveBeenCalledTimes(1);
  });

  it('幂等：第二次调用直接返回 false，不重复预热', () => {
    const options = createOptions();
    expect(scheduleEnginePrewarm(options)).toBe(true);
    expect(scheduleEnginePrewarm(options)).toBe(false);
    expect(options.requestIdleCallback).toHaveBeenCalledTimes(1);
  });

  it('无 requestIdleCallback 时退化为 setTimeout 调度', () => {
    vi.useFakeTimers();
    try {
      const options = createOptions({ requestIdleCallback: undefined });
      expect(scheduleEnginePrewarm(options)).toBe(true);
      expect(options.fetchImpl).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1600);
      expect(options.fetchImpl).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

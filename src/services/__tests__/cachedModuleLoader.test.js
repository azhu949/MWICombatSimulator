import { describe, expect, it, vi } from 'vitest';
import { createCachedModuleLoader } from '../cachedModuleLoader.js';

// loadPlayerMapperModule 的缓存语义回归：并发去重 + 失败清缓存可重试。
// 旧实现一次 reject 即永久缓存，Home 模拟/advisor/queue 三个功能整会话
// 持续失败，只能刷新恢复。
describe('createCachedModuleLoader', () => {
  it('deduplicates concurrent callers onto one in-flight import and caches success', async () => {
    let resolveImport;
    const importModule = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve;
        }),
    );
    const load = createCachedModuleLoader(importModule);

    // 并发三连调：飞行中的导入只发起一次。
    const first = load();
    const second = load();
    const third = load();
    expect(importModule).toHaveBeenCalledTimes(1);

    resolveImport({ value: 42 });
    expect(await first).toBe(await second);
    expect((await third).value).toBe(42);

    // 成功后缓存复用：不再发起新导入。
    await load();
    expect(importModule).toHaveBeenCalledTimes(1);
  });

  it('clears the cache on rejection so the next load retries and recovers', async () => {
    let attempts = 0;
    const importModule = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('weak network blip');
      }
      return { value: 7 };
    });
    const load = createCachedModuleLoader(importModule);

    // 第一次失败：调用方收到拒绝。
    await expect(load()).rejects.toThrow('weak network blip');
    expect(importModule).toHaveBeenCalledTimes(1);

    // 缓存已清：第二次调用真实重试并成功（瞬态失败会话内自愈）。
    const module = await load();
    expect(module.value).toBe(7);
    expect(importModule).toHaveBeenCalledTimes(2);
  });

  it('re-attempts on every call while the import keeps failing (no permanent brick)', async () => {
    const importModule = vi.fn(async () => {
      throw new Error('chunk 404 after redeploy');
    });
    const load = createCachedModuleLoader(importModule);

    await expect(load()).rejects.toThrow('chunk 404 after redeploy');
    await expect(load()).rejects.toThrow('chunk 404 after redeploy');
    await expect(load()).rejects.toThrow('chunk 404 after redeploy');
    // 每次调用都重新发起（无永久缓存的 rejected promise），而不是复用同一拒绝。
    expect(importModule).toHaveBeenCalledTimes(3);
  });
});

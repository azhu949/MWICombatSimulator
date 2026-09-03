// 缓存式动态模块加载器：飞行中的导入被并发调用共享（去重），成功后缓存供
// 后续调用复用；失败自动清缓存，下次调用重新发起导入。瞬态失败（弱网抖动）
// 在会话内自愈；持久失败（重新部署后旧 chunk 404）每次真实重试并向上报错
// ——均优于「一次 reject 即永久缓存，整会话持续失败，只能刷新恢复」。
// importModule 需返回 Promise（如 () => import('./module.js')）。
export function createCachedModuleLoader(importModule) {
  let cachedPromise = null;
  return function load() {
    if (!cachedPromise) {
      cachedPromise = importModule();
      // 失败清缓存：已持有该 rejected promise 的调用方照常收到拒绝；清空后
      // 的下一次调用重新发起导入。清理回调只可能由当前缓存的 promise 触发，
      // 后续成功缓存的新 promise 不会被误清（新 promise 仅在旧清理执行后才
      // 可能被创建）。
      cachedPromise.catch(() => {
        cachedPromise = null;
      });
    }
    return cachedPromise;
  };
}

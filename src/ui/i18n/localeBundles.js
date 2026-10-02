// 语言包按需加载层：默认语言（zh）由 i18n.js 静态内联进首屏 chunk；其余语言
// 在此登记懒加载器，仅当用户实际切到该语言时才加载其 common / translation。
// why：zh 与 en 的键已完全对齐，任一语言会话都不会用到另一语言的数据——
// 四个语言包全量静态打进主入口，会让首屏为未使用的语言白白多背一份完整翻译数据。

export const DEFAULT_LANGUAGE = 'zh';

// 路径相对本文件（src/ui/i18n/）指向仓库根 locales/ 下的语言目录。
// 负模式排除默认语言：其数据由 i18n.js 内联，重复登记只会产出用不到的动态 chunk。
const commonModules = import.meta.glob(['../../../locales/*/common.json', '!../../../locales/zh/common.json']);
const translationModules = import.meta.glob([
  '../../../locales/*/translation.official.generated.json',
  '!../../../locales/zh/translation.official.generated.json',
]);

function buildLoaderMap(modules) {
  const loaders = new Map();
  for (const [modulePath, loadModule] of Object.entries(modules)) {
    const pathSegments = modulePath.split('/');
    // 形如 ../../../locales/<lang>/common.json：倒数第二段即语言码
    loaders.set(pathSegments[pathSegments.length - 2], loadModule);
  }
  return loaders;
}

const commonLoaders = buildLoaderMap(commonModules);
const translationLoaders = buildLoaderMap(translationModules);

/**
 * 动态加载指定语言的完整语言包（common 与 translation 两个 JSON 并行拉取）。
 * 默认语言（zh）不在此登记——请直接使用 i18n.js 的内联数据。
 */
export async function loadLocaleBundle(language) {
  const loadCommon = commonLoaders.get(language);
  const loadTranslation = translationLoaders.get(language);
  if (!loadCommon || !loadTranslation) {
    throw new Error(`Unknown locale bundle: ${language}`);
  }

  const [commonModule, translationModule] = await Promise.all([loadCommon(), loadTranslation()]);
  return {
    common: commonModule.default,
    translation: translationModule.default,
  };
}

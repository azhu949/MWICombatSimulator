import i18next from 'i18next';
import zhCommon from '../../../locales/zh/common.json';
import zhTranslation from '../../../locales/zh/translation.official.generated.json';
import { DEFAULT_LANGUAGE, loadLocaleBundle } from './localeBundles.js';

let initialized = false;

// 懒加载语言包的请求缓存（lang -> Promise<bundle>）：保证并发预载只触发一次
// 动态 import。默认语言（zh）在模块顶部静态内联，不进此缓存。
const bundlePromises = new Map();

// 已注入 i18next 的语言集合：init 前经 i18next.init 的 resources 注入；init 后
// 新增语言只能经 addResourceBundle 注入（resources 仅在 init 时被读取）。
const registeredLanguages = new Set();

export function resolveInitialLanguage(
  storedLanguage = typeof localStorage === 'undefined' ? null : localStorage.getItem('i18nextLng'),
) {
  return storedLanguage === 'zh' || storedLanguage === 'en' ? storedLanguage : DEFAULT_LANGUAGE;
}

function getBundlePromise(language) {
  if (!bundlePromises.has(language)) {
    const request = loadLocaleBundle(language).catch((error) => {
      // 加载失败不保留缓存，允许下次切换时重试
      bundlePromises.delete(language);
      throw error;
    });
    bundlePromises.set(language, request);
  }
  return bundlePromises.get(language);
}

/**
 * 确保指定语言的资源在 i18next 中可用；语言切换前调用（产品路径见
 * useI18nText.setLanguage），重复调用幂等。
 * 前置条件：无——init 尚未完成时会先自行完成 init，再注入资源。语言码仅 'zh' / 'en'；
 * 其它值（含 'en-US' 之类区域变体）按默认语言处理。
 * why：i18next 的 changeLanguage 只切当前语言、不会加载资源——目标语言的资源
 * 缺席时整页会回退成 key，所以懒加载语言必须在切换前补齐。
 */
export async function ensureLanguageBundle(language) {
  const targetLanguage = resolveInitialLanguage(language);
  // init 尚未完成时先补齐 init：否则语言包会被真的下载，却因 i18next 未初始化而
  // 无处注入（init 之前 addResourceBundle 不可用），调用方会误以为资源已就绪。
  if (!initialized) {
    await initI18n();
  }

  // 默认语言（zh）随主入口内联、init 时即已注册，此处为空操作。
  if (registeredLanguages.has(targetLanguage)) {
    return;
  }

  const bundle = await getBundlePromise(targetLanguage);
  // init 之后新增的语言只能经 addResourceBundle 注入。
  i18next.addResourceBundle(targetLanguage, 'common', bundle.common, true, true);
  i18next.addResourceBundle(targetLanguage, 'translation', bundle.translation, true, true);
  registeredLanguages.add(targetLanguage);
}

let initPromise = null;

/**
 * 初始化 i18next；并发调用复用同一个 in-flight promise，完成后返回 i18next 实例。
 * 产品路径见 main.js 的 bootstrap。
 */
export function initI18n() {
  if (!initPromise) {
    initPromise = performInit().catch((error) => {
      // init 失败不保留缓存，允许下次调用重试（沿用既有「失败后 initialized 仍为 false」的语义）。
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

async function performInit() {
  if (initialized) {
    return i18next;
  }

  const initialLanguage = resolveInitialLanguage();
  const resources = {
    [DEFAULT_LANGUAGE]: {
      common: zhCommon,
      translation: zhTranslation,
    },
  };
  registeredLanguages.add(DEFAULT_LANGUAGE);

  // 初始语言包加载失败时降级为默认语言：否则 init 会抛错、bootstrap 中断、应用永不挂载。
  // 降级不改写 localStorage，用户偏好保留，下次启动仍会重新尝试加载。
  let effectiveLanguage = initialLanguage;
  if (initialLanguage !== DEFAULT_LANGUAGE) {
    try {
      const bundle = await getBundlePromise(initialLanguage);
      resources[initialLanguage] = {
        common: bundle.common,
        translation: bundle.translation,
      };
      registeredLanguages.add(initialLanguage);
    } catch (error) {
      console.warn('[i18n] Failed to load the initial locale bundle, falling back to the default language.', error);
      effectiveLanguage = DEFAULT_LANGUAGE;
    }
  }

  await i18next.init({
    lng: effectiveLanguage,
    // 回退语言显式关闭：en 语言包按需懒加载（见 localeBundles.js），zh 会话下不在
    // resources 中，跨语言回退本就不可达；zh/en 键已完全对齐，缺键由调用方兜底
    // 文案（useI18nText.t 的 defaultValue）处理，故不再保留名义上的 'en' 回退。
    fallbackLng: false,
    debug: false,
    showSupportNotice: false,
    interpolation: {
      escapeValue: false,
    },
    ns: ['common', 'translation'],
    defaultNS: 'common',
    fallbackNS: ['translation'],
    resources,
  });

  initialized = true;
  return i18next;
}

export default i18next;

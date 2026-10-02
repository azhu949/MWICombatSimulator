import { onMounted, onUnmounted, ref } from 'vue';
import i18next, { ensureLanguageBundle, resolveInitialLanguage } from '../i18n/i18n.js';

const language = ref(resolveInitialLanguage());

function onLanguageChanged(nextLanguage) {
  language.value = nextLanguage;
}

export function useI18nText() {
  onMounted(() => {
    language.value = i18next.language || 'zh';
    i18next.on('languageChanged', onLanguageChanged);
  });

  onUnmounted(() => {
    i18next.off('languageChanged', onLanguageChanged);
  });

  function t(key, fallback = '', options = {}) {
    const currentLanguage = language.value || i18next.language || 'zh';
    const defaultValue = fallback || key;
    const translated = i18next.t(key, {
      lng: currentLanguage,
      ...options,
      defaultValue,
    });
    if (!translated || translated === key) {
      return defaultValue;
    }
    return translated;
  }

  async function setLanguage(nextLanguage) {
    const languageToUse = nextLanguage === 'zh' ? 'zh' : 'en';
    // 先确保目标语言资源可用（zh 内联在主入口，en 首次切到时才拉取语言包）：
    // i18next 的 changeLanguage 只切当前语言、不会加载资源，资源缺席时整页会回退成 key。
    await ensureLanguageBundle(languageToUse);
    await i18next.changeLanguage(languageToUse);
    localStorage.setItem('i18nextLng', languageToUse);
  }

  return {
    language,
    t,
    setLanguage,
  };
}

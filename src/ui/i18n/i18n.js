import i18next from 'i18next';
import enCommon from '../../../locales/en/common.json';
import enTranslation from '../../../locales/en/translation.official.generated.json';
import zhCommon from '../../../locales/zh/common.json';
import zhTranslation from '../../../locales/zh/translation.official.generated.json';

let initialized = false;

export function resolveInitialLanguage(
  storedLanguage = typeof localStorage === 'undefined' ? null : localStorage.getItem('i18nextLng'),
) {
  return storedLanguage === 'zh' || storedLanguage === 'en' ? storedLanguage : 'zh';
}

export async function initI18n() {
  if (initialized) {
    return i18next;
  }

  const initialLanguage = resolveInitialLanguage();

  await i18next.init({
    lng: initialLanguage,
    fallbackLng: 'en',
    debug: false,
    showSupportNotice: false,
    interpolation: {
      escapeValue: false,
    },
    ns: ['common', 'translation'],
    defaultNS: 'common',
    fallbackNS: ['translation'],
    resources: {
      en: {
        common: enCommon,
        translation: enTranslation,
      },
      zh: {
        common: zhCommon,
        translation: zhTranslation,
      },
    },
  });

  initialized = true;
  return i18next;
}

export default i18next;

import i18next from "i18next";
import enCommon from "../../../locales/en/common.json";
import zhCommon from "../../../locales/zh/common.json";
import { loadTranslationBundles } from "./translationBundle.js";

let initialized = false;

export async function initI18n() {
    if (initialized) {
        return i18next;
    }

    const storedLanguage = localStorage.getItem("i18nextLng");
    const initialLanguage = storedLanguage === "zh" || storedLanguage === "en" ? storedLanguage : "en";

    await i18next.init({
        lng: initialLanguage,
        fallbackLng: "en",
        debug: false,
        interpolation: {
            escapeValue: false,
        },
        ns: ["common", "translation"],
        defaultNS: "common",
        fallbackNS: ["translation"],
        resources: {
            en: {
                common: enCommon,
                translation: {},
            },
            zh: {
                common: zhCommon,
                translation: {},
            },
        },
    });

    try {
        const translationBundles = await loadTranslationBundles();
        i18next.addResourceBundle("en", "translation", translationBundles.en, true, true);
        i18next.addResourceBundle("zh", "translation", translationBundles.zh, true, true);
    } catch (error) {
        console.warn("Failed to load translation bundle", error);
    }

    initialized = true;
    return i18next;
}

export default i18next;

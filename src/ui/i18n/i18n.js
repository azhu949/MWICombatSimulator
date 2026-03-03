import i18next from "i18next";
import enCommon from "../../../locales/en/common.json";
import zhCommon from "../../../locales/zh/common.json";
import { loadLegacyTranslationBundles } from "./legacyTranslationBundle.js";

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
        const legacyBundles = await loadLegacyTranslationBundles();
        i18next.addResourceBundle("en", "translation", legacyBundles.en, true, true);
        i18next.addResourceBundle("zh", "translation", legacyBundles.zh, true, true);
    } catch (error) {
        // Keep UI usable when legacy bundle loading fails; fields will fall back to game data names.
        console.warn("Failed to load legacy translation bundle", error);
    }

    initialized = true;
    return i18next;
}

export default i18next;

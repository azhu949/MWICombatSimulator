import { onMounted, onUnmounted, ref } from "vue";
import i18next, { resolveInitialLanguage } from "../i18n/i18n.js";

const language = ref(resolveInitialLanguage());

function onLanguageChanged(nextLanguage) {
    language.value = nextLanguage;
}

export function useI18nText() {
    onMounted(() => {
        language.value = i18next.language || "zh";
        i18next.on("languageChanged", onLanguageChanged);
    });

    onUnmounted(() => {
        i18next.off("languageChanged", onLanguageChanged);
    });

    function t(key, fallback = "", options = {}) {
        const currentLanguage = language.value || i18next.language || "zh";
        const translated = i18next.t(key, {
            lng: currentLanguage,
            ...options,
        });
        if (!translated || translated === key) {
            return fallback || key;
        }
        return translated;
    }

    async function setLanguage(nextLanguage) {
        const languageToUse = nextLanguage === "zh" ? "zh" : "en";
        await i18next.changeLanguage(languageToUse);
        localStorage.setItem("i18nextLng", languageToUse);
    }

    return {
        language,
        t,
        setLanguage,
    };
}

import {
    getBuffTypeName as getIndexedBuffTypeName,
    getItemCategoryName as getIndexedItemCategoryName,
    getItemName as getIndexedItemName,
    getSkillName as getIndexedSkillName,
} from "../../shared/gameDataIndex.js";
import { useI18nText } from "./useI18nText.js";

function coerceText(value) {
    if (value == null) {
        return "";
    }

    return String(value);
}

function normalizeSkillHrid(skillKey) {
    const normalized = coerceText(skillKey).trim();
    if (!normalized) {
        return "";
    }

    if (normalized.startsWith("/skills/")) {
        return `/skills/${normalized.slice("/skills/".length).toLowerCase()}`;
    }

    const shortKey = normalized.split("/").filter(Boolean).pop() || normalized;
    return `/skills/${shortKey.toLowerCase()}`;
}

function isUnresolvedTranslation(value, keys) {
    const normalized = coerceText(value).trim();
    return keys.some((key) => (
        normalized === key
        || normalized === key.split(":").slice(1).join(":")
    ));
}

export function useGameDataText() {
    const { t } = useI18nText();

    function getBuffTypeName(buffTypeHrid, fallbackName = "") {
        const rawHrid = coerceText(buffTypeHrid).trim();
        const fallbackText = coerceText(fallbackName);

        if (!rawHrid) {
            return fallbackText;
        }

        const translationKey = `buffTypeNames.${rawHrid}`;
        const translated = t(translationKey, translationKey);
        if (translated !== translationKey) {
            return translated;
        }

        return getIndexedBuffTypeName(rawHrid, fallbackText);
    }

    function getSkillName(skillKey, fallbackName = "") {
        const rawSkillKey = coerceText(skillKey).trim();
        const fallbackText = coerceText(fallbackName);

        if (!rawSkillKey) {
            return fallbackText;
        }

        const normalizedHrid = normalizeSkillHrid(rawSkillKey);
        if (normalizedHrid) {
            const translationKey = `skillNames.${normalizedHrid}`;
            const translated = t(translationKey, translationKey);
            if (translated !== translationKey) {
                return translated;
            }
        }

        return getIndexedSkillName(rawSkillKey, fallbackText);
    }

    function getItemCategoryName(categoryHrid, fallbackName = "") {
        const rawHrid = coerceText(categoryHrid).trim();
        const fallbackText = coerceText(fallbackName);

        if (!rawHrid) {
            return fallbackText;
        }

        const translationKey = `itemCategoryNames.${rawHrid}`;
        const translated = t(translationKey, translationKey);
        if (translated !== translationKey) {
            return translated;
        }

        return getIndexedItemCategoryName(rawHrid, fallbackText);
    }

    function getItemName(itemHrid, fallbackName = "") {
        const rawHrid = coerceText(itemHrid).trim();
        const fallbackText = coerceText(fallbackName).trim();

        if (!rawHrid) {
            return fallbackText;
        }

        const translationKeys = [
            `translation:itemNames.${rawHrid}`,
            `itemNames.${rawHrid}`,
        ];
        for (const translationKey of translationKeys) {
            const translated = t(translationKey, translationKey);
            if (translated && !isUnresolvedTranslation(translated, translationKeys)) {
                return translated;
            }
        }

        return getIndexedItemName(rawHrid, fallbackText);
    }

    return {
        getBuffTypeName,
        getItemName,
        getSkillName,
        getItemCategoryName,
    };
}

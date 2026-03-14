import { normalizeAbilityDefinitionHrid, resolveAbilityDefinition } from "../../combatsimulator/abilityDefinitionResolver.js";
import { useI18nText } from "./useI18nText.js";

function coerceText(value) {
    if (value == null) {
        return "";
    }

    return String(value);
}

function readDefinitionText(abilityHrid, key) {
    const definition = resolveAbilityDefinition(abilityHrid);
    const value = definition?.[key];
    return typeof value === "string" && value.length > 0 ? value : "";
}

export function useAbilityText() {
    const { t } = useI18nText();

    function getAbilityName(abilityHrid, fallbackName = "") {
        const rawHrid = coerceText(abilityHrid);
        const fallbackText = coerceText(fallbackName);

        if (!rawHrid) {
            return fallbackText;
        }

        const normalizedHrid = normalizeAbilityDefinitionHrid(rawHrid);
        if (normalizedHrid) {
            const translationKey = `abilityNames.${normalizedHrid}`;
            const translated = t(translationKey, translationKey);
            if (translated !== translationKey) {
                return translated;
            }
        }

        const definitionName = readDefinitionText(rawHrid, "name");
        if (definitionName) {
            return definitionName;
        }

        if (fallbackText) {
            return fallbackText;
        }

        return rawHrid;
    }

    function getAbilityDescription(abilityHrid, fallbackDescription = "") {
        const rawHrid = coerceText(abilityHrid);
        const fallbackText = coerceText(fallbackDescription);

        if (!rawHrid) {
            return fallbackText;
        }

        const normalizedHrid = normalizeAbilityDefinitionHrid(rawHrid);
        if (normalizedHrid) {
            const translationKey = `abilityDescriptions.${normalizedHrid}`;
            const translated = t(translationKey, translationKey);
            if (translated !== translationKey) {
                return translated;
            }
        }

        const definitionDescription = readDefinitionText(rawHrid, "description");
        if (definitionDescription) {
            return definitionDescription;
        }

        if (fallbackText) {
            return fallbackText;
        }

        return "";
    }

    return {
        getAbilityName,
        getAbilityDescription,
    };
}

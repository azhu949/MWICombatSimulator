import {
    getAbilityName as getIndexedAbilityName,
    getActionName as getIndexedActionName,
    getBuffTypeName as getIndexedBuffTypeName,
    getHouseRoomName as getIndexedHouseRoomName,
    getItemCategoryName as getIndexedItemCategoryName,
    getItemName as getIndexedItemName,
    getMonsterName as getIndexedMonsterName,
    getSkillName as getIndexedSkillName,
} from "../../shared/gameDataIndex.js";
import { normalizeAbilityDefinitionHrid, resolveAbilityDefinition } from "../../combatsimulator/abilityDefinitionResolver.js";
import { getGuildShrineName as getIndexedGuildShrineName } from "../../shared/guildBuffs.js";
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

    function getOfficialGameText(resourceKey, hrid, fallbackText = "", options = {}) {
        const rawHrid = coerceText(hrid).trim();
        const normalizedFallback = coerceText(fallbackText);
        if (!rawHrid) {
            return normalizedFallback;
        }

        const translationKey = `translation:${resourceKey}.${rawHrid}`;
        const translated = t(
            translationKey,
            translationKey,
            options.language ? { lng: options.language } : {},
        );
        if (!isUnresolvedTranslation(translated, [translationKey])) {
            return translated;
        }

        return normalizedFallback || (options.fallbackToHrid === false ? "" : rawHrid);
    }

    function getAbilityName(abilityHrid, fallbackName = "") {
        const rawHrid = coerceText(abilityHrid).trim();
        if (!rawHrid) {
            return coerceText(fallbackName);
        }
        const normalizedHrid = normalizeAbilityDefinitionHrid(rawHrid) || rawHrid;
        return getOfficialGameText(
            "abilityNames",
            normalizedHrid,
            getIndexedAbilityName(normalizedHrid, coerceText(fallbackName)),
        );
    }

    function getAbilityDescription(abilityHrid, fallbackDescription = "") {
        const rawHrid = coerceText(abilityHrid).trim();
        if (!rawHrid) {
            return coerceText(fallbackDescription);
        }
        const normalizedHrid = normalizeAbilityDefinitionHrid(rawHrid) || rawHrid;
        const definitionDescription = coerceText(resolveAbilityDefinition(normalizedHrid)?.description);
        return getOfficialGameText(
            "abilityDescriptions",
            normalizedHrid,
            definitionDescription || coerceText(fallbackDescription),
            { fallbackToHrid: false },
        );
    }

    function getActionName(actionHrid, fallbackName = "") {
        const rawHrid = coerceText(actionHrid).trim();
        return getOfficialGameText(
            "actionNames",
            rawHrid,
            getIndexedActionName(rawHrid, coerceText(fallbackName)),
        );
    }

    function getBuffTypeName(buffTypeHrid, fallbackName = "") {
        const rawHrid = coerceText(buffTypeHrid).trim();
        const fallbackText = coerceText(fallbackName);

        if (!rawHrid) {
            return fallbackText;
        }

        return getOfficialGameText("buffTypeNames", rawHrid, getIndexedBuffTypeName(rawHrid, fallbackText));
    }

    function getSkillName(skillKey, fallbackName = "") {
        const rawSkillKey = coerceText(skillKey).trim();
        const fallbackText = coerceText(fallbackName);

        if (!rawSkillKey) {
            return fallbackText;
        }

        const normalizedHrid = normalizeSkillHrid(rawSkillKey);
        if (normalizedHrid) {
            return getOfficialGameText("skillNames", normalizedHrid, getIndexedSkillName(rawSkillKey, fallbackText));
        }

        return getIndexedSkillName(rawSkillKey, fallbackText);
    }

    function getItemCategoryName(categoryHrid, fallbackName = "") {
        const rawHrid = coerceText(categoryHrid).trim();
        const fallbackText = coerceText(fallbackName);

        if (!rawHrid) {
            return fallbackText;
        }

        return getOfficialGameText(
            "itemCategoryNames",
            rawHrid,
            getIndexedItemCategoryName(rawHrid, fallbackText),
        );
    }

    function getEquipmentTypeName(equipmentTypeHrid, fallbackName = "") {
        const rawHrid = coerceText(equipmentTypeHrid).trim();
        return getOfficialGameText("equipmentTypeNames", rawHrid, coerceText(fallbackName));
    }

    function getEquipmentSlotName(slotKey, fallbackName = "") {
        const rawSlotKey = coerceText(slotKey).trim();
        if (!rawSlotKey) {
            return coerceText(fallbackName);
        }
        const equipmentTypeKey = rawSlotKey === "weapon"
            ? "main_hand"
            : rawSlotKey.replace(/^\/equipment_types\//, "");
        const fallback = coerceText(fallbackName) || equipmentTypeKey
            .split("_")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
        return getEquipmentTypeName(`/equipment_types/${equipmentTypeKey}`, fallback);
    }

    function getCombatStatName(statKey, fallbackName = "") {
        const rawKey = coerceText(statKey).trim();
        return getOfficialGameText("combatStats", rawKey, coerceText(fallbackName));
    }

    function getItemName(itemHrid, fallbackName = "") {
        const rawHrid = coerceText(itemHrid).trim();
        const fallbackText = coerceText(fallbackName).trim();

        if (!rawHrid) {
            return fallbackText;
        }

        return getOfficialGameText("itemNames", rawHrid, getIndexedItemName(rawHrid, fallbackText));
    }

    function getMonsterName(monsterHrid, fallbackName = "") {
        const rawHrid = coerceText(monsterHrid).trim();
        return getOfficialGameText(
            "monsterNames",
            rawHrid,
            getIndexedMonsterName(rawHrid, coerceText(fallbackName)),
        );
    }

    function getHouseRoomName(roomHrid, fallbackName = "") {
        const rawHrid = coerceText(roomHrid).trim();
        return getOfficialGameText(
            "houseRoomNames",
            rawHrid,
            getIndexedHouseRoomName(rawHrid, coerceText(fallbackName)),
        );
    }

    function getGuildShrineName(shrineHrid, fallbackName = "") {
        const rawHrid = coerceText(shrineHrid).trim();
        return getOfficialGameText(
            "guildShrineNames",
            rawHrid,
            getIndexedGuildShrineName(rawHrid, coerceText(fallbackName)),
        );
    }

    function getAchievementName(achievementHrid, fallbackName = "") {
        return getOfficialGameText("achievementNames", achievementHrid, fallbackName);
    }

    function getAchievementTierName(tierHrid, fallbackName = "") {
        return getOfficialGameText("achievementTierNames", tierHrid, fallbackName);
    }

    return {
        getAbilityDescription,
        getAbilityName,
        getActionName,
        getAchievementName,
        getAchievementTierName,
        getBuffTypeName,
        getCombatStatName,
        getEquipmentSlotName,
        getEquipmentTypeName,
        getGuildShrineName,
        getHouseRoomName,
        getItemName,
        getMonsterName,
        getOfficialGameText,
        getSkillName,
        getItemCategoryName,
    };
}

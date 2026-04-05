import gameDataIndex from "./gameDataIndex.generated.json";
import buffTypeDetailMap from "../combatsimulator/data/buffTypeDetailMap.json";
import itemCategoryDetailMap from "../combatsimulator/data/itemCategoryDetailMap.json";
import skillDetailMap from "../combatsimulator/data/skillDetailMap.json";

export const LEVEL_KEYS = gameDataIndex?.metadata?.levelKeys || [];
export const EQUIPMENT_SLOT_KEYS = gameDataIndex?.metadata?.equipmentSlotKeys || [];

export const itemDetailIndex = gameDataIndex?.itemDetailIndex || {};
export const itemVendorPriceByHrid = gameDataIndex?.itemVendorPriceByHrid || {};
export const abilityDetailIndex = gameDataIndex?.abilityDetailIndex || {};
export const actionDetailIndex = gameDataIndex?.actionDetailIndex || {};
export const monsterDetailIndex = gameDataIndex?.monsterDetailIndex || {};
export const houseRoomDetailIndex = gameDataIndex?.houseRoomDetailIndex || {};
export const buffTypeDetailIndex = buffTypeDetailMap || {};
export const skillDetailIndex = skillDetailMap || {};
export const itemCategoryDetailIndex = itemCategoryDetailMap || {};

export const levelExperienceTable = Array.isArray(gameDataIndex?.levelExperienceTable) ? gameDataIndex.levelExperienceTable : [];
export const abilityBookInfoByAbilityHrid = gameDataIndex?.abilityBookInfoByAbilityHrid || {};

export const equipmentOptionsBySlot = gameDataIndex?.equipmentBySlot || {};
export const foodOptions = Array.isArray(gameDataIndex?.foodOptions) ? gameDataIndex.foodOptions : [];
export const drinkOptions = Array.isArray(gameDataIndex?.drinkOptions) ? gameDataIndex.drinkOptions : [];
export const abilityOptions = Array.isArray(gameDataIndex?.abilityOptions) ? gameDataIndex.abilityOptions : [];
export const specialAbilityOptions = Array.isArray(gameDataIndex?.specialAbilityOptions) ? gameDataIndex.specialAbilityOptions : [];
export const zoneOptions = Array.isArray(gameDataIndex?.zones) ? gameDataIndex.zones : [];
export const dungeonOptions = Array.isArray(gameDataIndex?.dungeons) ? gameDataIndex.dungeons : [];
export const groupZoneHrids = Array.isArray(gameDataIndex?.groupZoneHrids) ? gameDataIndex.groupZoneHrids : [];
export const soloZoneHrids = Array.isArray(gameDataIndex?.soloZoneHrids) ? gameDataIndex.soloZoneHrids : [];
export const labyrinthOptions = Array.isArray(gameDataIndex?.labyrinthOptions) ? gameDataIndex.labyrinthOptions : [];
export const houseRoomOptions = Array.isArray(gameDataIndex?.houseRoomOptions) ? gameDataIndex.houseRoomOptions : [];
export const houseRoomHrids = Array.isArray(gameDataIndex?.houseRoomHrids) ? gameDataIndex.houseRoomHrids : [];
export const labyrinthCrateOptions = gameDataIndex?.labyrinthCrates || { coffee: [], food: [], tea: [] };

function normalizeSkillHrid(skillKey) {
    const normalized = String(skillKey || "").trim();
    if (!normalized) {
        return "";
    }

    if (normalized.startsWith("/skills/")) {
        return `/skills/${normalized.slice("/skills/".length).toLowerCase()}`;
    }

    const shortKey = normalized.split("/").filter(Boolean).pop() || normalized;
    return `/skills/${shortKey.toLowerCase()}`;
}

export function getItemName(hrid, fallback = "") {
    const normalized = String(hrid || "");
    if (!normalized) {
        return String(fallback || "");
    }
    return String(itemDetailIndex?.[normalized]?.name || fallback || normalized);
}

export function getAbilityName(hrid, fallback = "") {
    const normalized = String(hrid || "");
    if (!normalized) {
        return String(fallback || "");
    }
    return String(abilityDetailIndex?.[normalized]?.name || fallback || normalized);
}

export function getActionName(hrid, fallback = "") {
    const normalized = String(hrid || "");
    if (!normalized) {
        return String(fallback || "");
    }
    return String(actionDetailIndex?.[normalized]?.name || fallback || normalized);
}

export function getMonsterName(hrid, fallback = "") {
    const normalized = String(hrid || "");
    if (!normalized) {
        return String(fallback || "");
    }
    return String(monsterDetailIndex?.[normalized]?.name || fallback || normalized);
}

export function getHouseRoomName(hrid, fallback = "") {
    const normalized = String(hrid || "");
    if (!normalized) {
        return String(fallback || "");
    }
    return String(houseRoomDetailIndex?.[normalized]?.name || fallback || normalized);
}

export function getBuffTypeName(hrid, fallback = "") {
    const normalized = String(hrid || "").trim();
    if (!normalized) {
        return String(fallback || "");
    }
    return String(buffTypeDetailIndex?.[normalized]?.name || fallback || normalized);
}

export function getSkillName(skillKey, fallback = "") {
    const raw = String(skillKey || "").trim();
    if (!raw) {
        return String(fallback || "");
    }

    const normalizedHrid = normalizeSkillHrid(raw);
    return String(skillDetailIndex?.[normalizedHrid]?.name || fallback || raw);
}

export function getItemCategoryName(hrid, fallback = "") {
    const normalized = String(hrid || "").trim();
    if (!normalized) {
        return String(fallback || "");
    }
    return String(itemCategoryDetailIndex?.[normalized]?.name || fallback || normalized);
}

export function getSortedHouseRoomOptions() {
    return houseRoomOptions;
}

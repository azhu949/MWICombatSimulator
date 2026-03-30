import gameDataIndex from "./gameDataIndex.generated.json";

export const LEVEL_KEYS = gameDataIndex?.metadata?.levelKeys || [];
export const EQUIPMENT_SLOT_KEYS = gameDataIndex?.metadata?.equipmentSlotKeys || [];

export const itemDetailIndex = gameDataIndex?.itemDetailIndex || {};
export const itemVendorPriceByHrid = gameDataIndex?.itemVendorPriceByHrid || {};
export const abilityDetailIndex = gameDataIndex?.abilityDetailIndex || {};
export const actionDetailIndex = gameDataIndex?.actionDetailIndex || {};
export const monsterDetailIndex = gameDataIndex?.monsterDetailIndex || {};
export const houseRoomDetailIndex = gameDataIndex?.houseRoomDetailIndex || {};

export const abilityXpLevels = Array.isArray(gameDataIndex?.abilityXpLevels) ? gameDataIndex.abilityXpLevels : [];
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

export function getSortedHouseRoomOptions() {
    return houseRoomOptions;
}

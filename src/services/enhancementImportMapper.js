import achievementDetailMap from "../combatsimulator/data/achievementDetailMap.json";
import { enhancementData } from "../shared/gameDataIndex.js";

const ENHANCING_ACTION_TYPE_HRID = "/action_types/enhancing";
const ENHANCING_SKILL_HRID = "/skills/enhancing";
const OBSERVATORY_HRID = "/house_rooms/observatory";
const COMMUNITY_ENHANCING_HRID = "/community_buff_types/enhancing_speed";
const COMMUNITY_EXPERIENCE_HRID = "/community_buff_types/experience";
const NOVICE_TIER_HRID = "/achievement_tiers/novice";
const CHAMPION_TIER_HRID = "/achievement_tiers/champion";
const NOVICE_BUFF_HRID = "/buff_uniques/achievement_novice_experience";
const CHAMPION_BUFF_HRID = "/buff_uniques/achievement_champion_enhancing_success";
const ENHANCING_TEA_HRIDS = new Set([
    "/items/enhancing_tea",
    "/items/super_enhancing_tea",
    "/items/ultra_enhancing_tea",
]);
const WISDOM_DRINK_HRIDS = new Set([
    "/items/wisdom_tea",
    "/items/wisdom_coffee",
]);
const DEFAULT_SUPPORT_SLOT_KEYS = [
    "enhancing_tool",
    "hands",
    "body",
    "legs",
    "pouch",
    "neck",
    "back",
    "charm",
];

function isPlainObject(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(source, key) {
    return isPlainObject(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function normalizeHrid(value) {
    return String(value || "").trim();
}

function clampInteger(value, minimum, maximum, fallback = minimum) {
    const parsed = Number(value);
    const normalized = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
    return Math.min(maximum, Math.max(minimum, normalized));
}

function toValueList(source) {
    if (Array.isArray(source)) {
        return source;
    }
    if (isPlainObject(source)) {
        return Object.values(source);
    }
    return [];
}

function toKeyedEntries(source) {
    if (Array.isArray(source)) {
        return source.map((value, index) => [String(index), value]);
    }
    if (isPlainObject(source)) {
        return Object.entries(source);
    }
    return [];
}

function payloadSources(payload) {
    const safePayload = isPlainObject(payload) ? payload : {};
    const profile = isPlainObject(safePayload.profile) ? safePayload.profile : null;
    return profile ? [profile, safePayload] : [safePayload];
}

function readFirstField(sources, fieldNames) {
    for (const fieldName of fieldNames) {
        for (const source of sources) {
            if (hasOwn(source, fieldName)) {
                return { present: true, value: source[fieldName] };
            }
        }
    }
    return { present: false, value: undefined };
}

function resolveItemEntry(rawEntry) {
    if (!rawEntry || typeof rawEntry !== "object") {
        return null;
    }
    if (isPlainObject(rawEntry.currentItem)) {
        return rawEntry.currentItem;
    }
    if (isPlainObject(rawEntry.item)) {
        return rawEntry.item;
    }
    return rawEntry;
}

function resolveSlotHrid(rawSlot) {
    if (typeof rawSlot === "string") {
        return normalizeHrid(rawSlot);
    }
    if (isPlainObject(rawSlot)) {
        return normalizeHrid(rawSlot.itemHrid || rawSlot.hrid || rawSlot.currentItem?.itemHrid);
    }
    return "";
}

function supportSlotFromEquipmentType(equipmentType) {
    return normalizeHrid(equipmentType).split("/").filter(Boolean).pop() || "";
}

function compareEquipmentCandidates(left, right) {
    if (left.isEquipped !== right.isEquipped) {
        return left.isEquipped ? 1 : -1;
    }

    const leftItemLevel = Number(left.supportItem?.itemLevel || 0);
    const rightItemLevel = Number(right.supportItem?.itemLevel || 0);
    if (leftItemLevel !== rightItemLevel) {
        return leftItemLevel - rightItemLevel;
    }

    if (left.enhancementLevel !== right.enhancementLevel) {
        return left.enhancementLevel - right.enhancementLevel;
    }

    const leftSortIndex = Number(left.supportItem?.sortIndex || 0);
    const rightSortIndex = Number(right.supportItem?.sortIndex || 0);
    if (leftSortIndex !== rightSortIndex) {
        return leftSortIndex - rightSortIndex;
    }

    return left.itemHrid.localeCompare(right.itemHrid);
}

function buildEquipmentSlots(rawItems, currentConfig) {
    const supportItems = Array.isArray(enhancementData?.supportEquipment)
        ? enhancementData.supportEquipment
        : [];
    const supportByHrid = new Map(supportItems.map((item) => [normalizeHrid(item?.hrid), item]));
    const discoveredSlots = supportItems.map((item) => supportSlotFromEquipmentType(item?.equipmentType));
    const currentSlots = isPlainObject(currentConfig?.equipmentSlots)
        ? Object.keys(currentConfig.equipmentSlots)
        : [];
    const slotKeys = Array.from(new Set([
        ...DEFAULT_SUPPORT_SLOT_KEYS,
        ...discoveredSlots,
        ...currentSlots,
    ].filter(Boolean)));
    const equipmentSlots = Object.fromEntries(slotKeys.map((slot) => [slot, {
        itemHrid: "",
        enhancementLevel: 0,
    }]));
    const selectedCandidates = new Map();

    for (const rawEntry of toValueList(rawItems)) {
        const entry = resolveItemEntry(rawEntry);
        if (!entry || Number(entry.count ?? rawEntry?.count ?? 1) === 0) {
            continue;
        }

        const itemHrid = normalizeHrid(entry.itemHrid || entry.hrid || rawEntry?.itemHrid);
        const supportItem = supportByHrid.get(itemHrid);
        const slot = supportSlotFromEquipmentType(supportItem?.equipmentType);
        if (!itemHrid || !slot || !equipmentSlots[slot]) {
            continue;
        }

        const itemLocationHrid = normalizeHrid(entry.itemLocationHrid || rawEntry?.itemLocationHrid);
        const equippedLocationHrid = `/item_locations/${slot}`;
        const isEquipped = itemLocationHrid === equippedLocationHrid;
        const isInInventory = !itemLocationHrid || itemLocationHrid === "/item_locations/inventory";
        if (!isEquipped && !isInInventory) {
            continue;
        }

        const candidate = {
            itemHrid,
            enhancementLevel: clampInteger(
                entry.enhancementLevel ?? rawEntry?.enhancementLevel,
                0,
                20,
                0,
            ),
            isEquipped,
            supportItem,
        };
        const selected = selectedCandidates.get(slot);
        if (!selected || compareEquipmentCandidates(candidate, selected) > 0) {
            selectedCandidates.set(slot, candidate);
        }
    }

    for (const [slot, candidate] of selectedCandidates) {
        equipmentSlots[slot] = {
            itemHrid: candidate.itemHrid,
            enhancementLevel: candidate.enhancementLevel,
        };
    }

    return equipmentSlots;
}

function buildHousePatch(rawHouseRooms) {
    const levels = {};
    for (const [roomKey, rawValue] of toKeyedEntries(rawHouseRooms)) {
        const roomHrid = normalizeHrid(
            rawValue?.houseRoomHrid
            || rawValue?.roomHrid
            || rawValue?.hrid
            || roomKey,
        );
        if (!roomHrid) {
            continue;
        }
        levels[roomHrid] = Math.max(0, Math.trunc(Number(rawValue?.level ?? rawValue) || 0));
    }

    const globalRoomHrids = Array.isArray(enhancementData?.housing?.globalExperience?.roomHrids)
        ? enhancementData.housing.globalExperience.roomHrids
        : Object.keys(levels);
    const otherRoomLevels = globalRoomHrids
        .filter((roomHrid) => roomHrid !== OBSERVATORY_HRID)
        .reduce((sum, roomHrid) => sum + Math.max(0, Number(levels[roomHrid] || 0)), 0);

    return {
        observatoryLevel: clampInteger(levels[OBSERVATORY_HRID], 0, 8, 0),
        otherRoomLevels: Math.trunc(otherRoomLevels),
    };
}

function buildCommunityPatch(rawCommunityBuffs) {
    const levels = new Map();
    for (const [buffKey, rawValue] of toKeyedEntries(rawCommunityBuffs)) {
        const buffHrid = normalizeHrid(
            rawValue?.hrid
            || rawValue?.communityBuffTypeHrid
            || rawValue?.buffHrid
            || buffKey,
        );
        if (!buffHrid) {
            continue;
        }
        levels.set(buffHrid, clampInteger(rawValue?.level ?? rawValue, 0, 20, 0));
    }

    return {
        communityEnhancingLevel: levels.get(COMMUNITY_ENHANCING_HRID) || 0,
        communityExperienceLevel: levels.get(COMMUNITY_EXPERIENCE_HRID) || 0,
    };
}

function containsHrid(source, targetHrid, seen = new WeakSet()) {
    if (typeof source === "string") {
        return source === targetHrid;
    }
    if (!source || typeof source !== "object" || seen.has(source)) {
        return false;
    }
    seen.add(source);
    return Object.values(source).some((value) => containsHrid(value, targetHrid, seen));
}

function buildAchievementCompletionMap(rawAchievements) {
    const completionMap = {};
    for (const [achievementKey, rawValue] of toKeyedEntries(rawAchievements)) {
        const achievementHrid = normalizeHrid(
            rawValue?.achievementHrid
            || rawValue?.hrid
            || achievementKey,
        );
        if (!achievementHrid) {
            continue;
        }
        completionMap[achievementHrid] = rawValue === true
            || rawValue?.isCompleted === true
            || rawValue?.completed === true;
    }
    return completionMap;
}

function isAchievementTierComplete(completionMap, tierHrid) {
    const tierAchievements = Object.values(achievementDetailMap || {})
        .filter((achievement) => achievement?.tierHrid === tierHrid);
    return tierAchievements.length > 0
        && tierAchievements.every((achievement) => completionMap[achievement.hrid] === true);
}

function buildAchievementPatch(rawAchievements, rawAchievementBuffs, hasAchievementBuffs) {
    const completionMap = buildAchievementCompletionMap(rawAchievements);
    const completedNoviceTier = isAchievementTierComplete(completionMap, NOVICE_TIER_HRID);
    const completedChampionTier = isAchievementTierComplete(completionMap, CHAMPION_TIER_HRID);
    if (hasAchievementBuffs) {
        return {
            noviceAchievement: containsHrid(rawAchievementBuffs, NOVICE_BUFF_HRID) || completedNoviceTier,
            championAchievement: containsHrid(rawAchievementBuffs, CHAMPION_BUFF_HRID) || completedChampionTier,
        };
    }

    return {
        noviceAchievement: completedNoviceTier,
        championAchievement: completedChampionTier,
    };
}

function buildDrinkPatch(rawDrinkSlotsMap) {
    const rawSlots = toValueList(rawDrinkSlotsMap?.[ENHANCING_ACTION_TYPE_HRID]);
    const drinkHrids = rawSlots.map(resolveSlotHrid).filter(Boolean);
    return {
        teaHrid: drinkHrids.find((hrid) => ENHANCING_TEA_HRIDS.has(hrid)) || "",
        blessedTea: drinkHrids.includes("/items/blessed_tea"),
        wisdomTea: drinkHrids.some((hrid) => WISDOM_DRINK_HRIDS.has(hrid)),
    };
}

export function buildMainSiteEnhancementImport(payload, currentConfig = {}) {
    const sources = payloadSources(payload);
    const configPatch = {};
    const importedSections = [];

    const skills = readFirstField(sources, ["characterSkills"]);
    if (skills.present) {
        const enhancingSkill = toValueList(skills.value).find((skill) => (
            normalizeHrid(skill?.skillHrid || skill?.hrid) === ENHANCING_SKILL_HRID
        ));
        if (enhancingSkill) {
            configPatch.skillLevel = clampInteger(enhancingSkill.level, 1, 200, 1);
            importedSections.push("skill");
        }
    }

    const items = readFirstField(sources, ["characterItems", "wearableItemMap"]);
    if (items.present) {
        configPatch.equipmentSlots = buildEquipmentSlots(items.value, currentConfig);
        importedSections.push("equipment");
    }

    const drinks = readFirstField(sources, ["actionTypeDrinkSlotsMap"]);
    if (drinks.present) {
        Object.assign(configPatch, buildDrinkPatch(drinks.value));
        importedSections.push("drinks");
    }

    const houseRooms = readFirstField(sources, ["characterHouseRoomMap", "houseRooms"]);
    if (houseRooms.present) {
        Object.assign(configPatch, buildHousePatch(houseRooms.value));
        importedSections.push("housing");
    }

    const communityBuffs = readFirstField(sources, ["communityBuffs"]);
    if (communityBuffs.present) {
        Object.assign(configPatch, buildCommunityPatch(communityBuffs.value));
        importedSections.push("community");
    }

    const achievements = readFirstField(sources, ["characterAchievements", "achievements"]);
    const achievementBuffs = readFirstField(sources, ["achievementActionTypeBuffsMap"]);
    if (achievements.present || achievementBuffs.present) {
        Object.assign(configPatch, buildAchievementPatch(
            achievements.value,
            achievementBuffs.value,
            achievementBuffs.present,
        ));
        importedSections.push("achievements");
    }

    const character = readFirstField(sources, ["character", "sharableCharacter"]);
    return {
        characterName: normalizeHrid(character.value?.name),
        configPatch,
        importedSections,
    };
}

export function mapMainSiteEnhancementConfig(payload, currentConfig = {}) {
    return buildMainSiteEnhancementImport(payload, currentConfig).configPatch;
}

import itemDetailMap from "../combatsimulator/data/itemDetailMap.json";
import actionDetailMap from "../combatsimulator/data/actionDetailMap.json";
import combatMonsterDetailMap from "../combatsimulator/data/combatMonsterDetailMap.json";
import { createEmptyPlayerConfig, createEmptySkillExperienceMap, EQUIPMENT_SLOT_KEYS, LEVEL_KEYS } from "./playerMapper.js";
import { sanitizeTriggerList, sanitizeTriggerMap } from "./triggerMapper.js";

const NON_WEAPON_SLOTS = EQUIPMENT_SLOT_KEYS.filter((slot) => slot !== "weapon");

const LEGACY_ABILITY_ALIAS_MAP = {
    "/abilities/aqua_aura": "/abilities/mystic_aura",
    "/abilities/flame_aura": "/abilities/mystic_aura",
    "/abilities/sylvan_aura": "/abilities/mystic_aura",
    "/abilities/arcane_reflection": "/abilities/retribution",
};

function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizeAbilityHrid(abilityHrid) {
    const raw = String(abilityHrid || "");
    return LEGACY_ABILITY_ALIAS_MAP[raw] || raw;
}

function clampEnhancementLevel(level) {
    const parsed = Math.floor(toFiniteNumber(level, 0));
    return parsed < 0 ? 0 : parsed;
}

function normalizeSkillExperience(value) {
    if (value == null || value === "") {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return null;
    }

    return parsed;
}

function getWeaponItemLocationFromHrid(itemHrid) {
    const type = itemDetailMap[itemHrid]?.equipmentDetail?.type || "";
    if (type === "/equipment_types/two_hand") {
        return "/item_locations/two_hand";
    }
    return "/item_locations/main_hand";
}

function getDefaultLegacySimulationSettings(simulationSettings) {
    return {
        zone: String(simulationSettings?.zoneHrid || ""),
        dungeon: String(simulationSettings?.dungeonHrid || ""),
        difficulty: String(toFiniteNumber(simulationSettings?.difficultyTier, 0)),
        simulationTime: String(toFiniteNumber(simulationSettings?.simulationTimeHours, 24)),
        labyrinth: String(simulationSettings?.labyrinthHrid || ""),
        roomLevel: String(toFiniteNumber(simulationSettings?.roomLevel, 100)),
    };
}

function getLegacyAbilityEntryCount(rawAbilities) {
    if (Array.isArray(rawAbilities)) {
        return Object.keys(rawAbilities).length;
    }

    if (rawAbilities && typeof rawAbilities === "object") {
        return Object.keys(rawAbilities).filter((key) => /^\d+$/.test(String(key))).length;
    }

    return 0;
}

function detectLegacyAbilityIndexOffset(rawAbilities) {
    if (Array.isArray(rawAbilities)) {
        if (rawAbilities[0] != null) {
            return 0;
        }
        if (rawAbilities[1] != null) {
            return 1;
        }
        return 0;
    }

    if (rawAbilities && typeof rawAbilities === "object") {
        if (Object.prototype.hasOwnProperty.call(rawAbilities, 0) || Object.prototype.hasOwnProperty.call(rawAbilities, "0")) {
            return 0;
        }
        if (Object.prototype.hasOwnProperty.call(rawAbilities, 1) || Object.prototype.hasOwnProperty.call(rawAbilities, "1")) {
            return 1;
        }
    }

    return 0;
}

function getLegacyAbilityEntry(rawAbilities, absoluteIndex) {
    if (absoluteIndex < 0) {
        return null;
    }

    if (Array.isArray(rawAbilities)) {
        return rawAbilities[absoluteIndex] ?? null;
    }

    if (rawAbilities && typeof rawAbilities === "object") {
        return rawAbilities[absoluteIndex] ?? rawAbilities[String(absoluteIndex)] ?? null;
    }

    return null;
}

function sanitizePlayerConfig(raw, fallbackPlayer) {
    const fallback = deepClone(fallbackPlayer || createEmptyPlayerConfig(1));
    const source = raw && typeof raw === "object" ? raw : {};
    const sourceSkillExperience = source.skillExperience && typeof source.skillExperience === "object"
        ? source.skillExperience
        : null;

    const normalized = deepClone(fallback);
    normalized.id = String(source.id || fallback.id);
    normalized.name = String(source.name || fallback.name || `Player ${normalized.id}`);
    normalized.selected = source.selected == null ? fallback.selected : Boolean(source.selected);

    for (const key of LEVEL_KEYS) {
        normalized.levels[key] = Math.max(1, Math.floor(toFiniteNumber(source.levels?.[key], fallback.levels[key] || 1)));
        normalized.skillExperience[key] = sourceSkillExperience
            ? normalizeSkillExperience(sourceSkillExperience[key])
            : null;
    }

    for (const slot of EQUIPMENT_SLOT_KEYS) {
        const sourceSlot = source.equipment?.[slot] ?? {};
        normalized.equipment[slot] = {
            itemHrid: String(sourceSlot.itemHrid || ""),
            enhancementLevel: clampEnhancementLevel(sourceSlot.enhancementLevel),
        };
    }

    normalized.food = [0, 1, 2].map((index) => String(source.food?.[index] || ""));
    normalized.drinks = [0, 1, 2].map((index) => String(source.drinks?.[index] || ""));

    normalized.abilities = [0, 1, 2, 3, 4].map((index) => {
        const sourceAbility = source.abilities?.[index] ?? {};
        return {
            abilityHrid: normalizeAbilityHrid(sourceAbility.abilityHrid || sourceAbility.ability || ""),
            level: Math.max(1, Math.floor(toFiniteNumber(sourceAbility.level, 1))),
        };
    });

    normalized.triggerMap = sanitizeTriggerMap(source.triggerMap ?? fallback.triggerMap ?? {});

    normalized.houseRooms = source.houseRooms && typeof source.houseRooms === "object"
        ? deepClone(source.houseRooms)
        : deepClone(fallback.houseRooms);

    normalized.achievements = Object.prototype.hasOwnProperty.call(source, "achievements")
        ? (source.achievements && typeof source.achievements === "object"
            ? deepClone(source.achievements)
            : {})
        : deepClone(fallback.achievements ?? {});

    return normalized;
}

function applyLegacySoloToPlayer(legacySoloPayload, fallbackPlayer) {
    const fallback = deepClone(fallbackPlayer || createEmptyPlayerConfig(1));
    const payload = legacySoloPayload && typeof legacySoloPayload === "object" ? legacySoloPayload : {};

    const merged = deepClone(fallback);
    merged.skillExperience = createEmptySkillExperienceMap();

    for (const key of LEVEL_KEYS) {
        const sourceKey = `${key}Level`;
        const fallbackValue = fallback.levels[key] || 1;
        let value = payload.player?.[sourceKey];

        if (key === "melee" && (value == null || value === "") && payload.player?.powerLevel != null) {
            value = payload.player.powerLevel;
        }

        merged.levels[key] = Math.max(1, Math.floor(toFiniteNumber(value, fallbackValue)));
    }

    const equipmentEntries = Array.isArray(payload.player?.equipment) ? payload.player.equipment : [];
    for (const slot of EQUIPMENT_SLOT_KEYS) {
        merged.equipment[slot] = {
            itemHrid: "",
            enhancementLevel: 0,
        };
    }

    for (const entry of equipmentEntries) {
        const location = String(entry?.itemLocationHrid || "");
        const itemHrid = String(entry?.itemHrid || "");
        const enhancementLevel = clampEnhancementLevel(entry?.enhancementLevel);

        if (!location || !itemHrid) {
            continue;
        }

        if (location === "/item_locations/main_hand" || location === "/item_locations/two_hand") {
            merged.equipment.weapon = { itemHrid, enhancementLevel };
            continue;
        }

        const slot = location.replace("/item_locations/", "");
        if (NON_WEAPON_SLOTS.includes(slot)) {
            merged.equipment[slot] = { itemHrid, enhancementLevel };
        }
    }

    const foodEntries = payload.food?.["/action_types/combat"];
    const drinkEntries = payload.drinks?.["/action_types/combat"];

    for (let i = 0; i < 3; i++) {
        merged.food[i] = String(foodEntries?.[i]?.itemHrid || "");
        merged.drinks[i] = String(drinkEntries?.[i]?.itemHrid || "").replace("power", "melee");
    }

    const legacyAbilities = payload.abilities;
    const hasSpecialAbilitySlot = getLegacyAbilityEntryCount(legacyAbilities) === 5;
    const abilityIndexOffset = detectLegacyAbilityIndexOffset(legacyAbilities);

    for (let i = 0; i < 5; i++) {
        const legacyIndex = hasSpecialAbilitySlot ? i : (i - 1);
        const sourceAbility = getLegacyAbilityEntry(legacyAbilities, legacyIndex + abilityIndexOffset) ?? {};
        merged.abilities[i] = {
            abilityHrid: normalizeAbilityHrid(sourceAbility.abilityHrid || sourceAbility.ability || ""),
            level: Math.max(1, Math.floor(toFiniteNumber(sourceAbility.level, 1))),
        };
    }

    merged.triggerMap = sanitizeTriggerMap(payload.triggerMap ?? fallback.triggerMap ?? {});

    merged.houseRooms = payload.houseRooms && typeof payload.houseRooms === "object"
        ? deepClone(payload.houseRooms)
        : deepClone(fallback.houseRooms);

    merged.achievements = Object.prototype.hasOwnProperty.call(payload, "achievements")
        ? (payload.achievements && typeof payload.achievements === "object"
            ? deepClone(payload.achievements)
            : {})
        : deepClone(fallback.achievements ?? {});

    return merged;
}

const SHAREABLE_PROFILE_COMBAT_ACTION_TYPE_HRID = "/action_types/combat";

function resolveShareableProfileSource(parsed) {
    if (!parsed || typeof parsed !== "object") {
        return null;
    }

    const wrappedProfile = parsed?.profile;
    if (wrappedProfile && typeof wrappedProfile === "object" && wrappedProfile?.sharableCharacter) {
        return wrappedProfile;
    }

    return parsed;
}

function isShareableProfilePayload(parsed) {
    const source = resolveShareableProfileSource(parsed);
    return Boolean(source?.sharableCharacter && Array.isArray(source?.characterSkills));
}

function mapShareableSkillHridToLevelKey(skillHrid) {
    const normalized = String(skillHrid || "").trim();
    if (!normalized.startsWith("/skills/")) {
        return "";
    }

    const key = normalized.slice("/skills/".length);
    if (key === "power") {
        return "melee";
    }

    return LEVEL_KEYS.includes(key) ? key : "";
}

function scoreShareableLoadoutCandidate(candidate) {
    const actionTypeHrid = String(candidate?.actionTypeHrid || "");
    let score = 0;

    if (actionTypeHrid === SHAREABLE_PROFILE_COMBAT_ACTION_TYPE_HRID) {
        score += 8;
    }
    if (candidate?.isDefault === true) {
        score += 4;
    }
    if (Array.isArray(candidate?.foodItemHrids)) {
        score += 2;
    }
    if (Array.isArray(candidate?.drinkItemHrids)) {
        score += 2;
    }
    if (candidate?.consumableCombatTriggersMap && typeof candidate.consumableCombatTriggersMap === "object") {
        score += 1;
    }
    if (candidate?.abilityCombatTriggersMap && typeof candidate.abilityCombatTriggersMap === "object") {
        score += 1;
    }

    return score;
}

function buildShareableProfileLoadoutCandidates(profile) {
    const candidates = [];

    function pushCandidate(candidate) {
        if (!candidate || typeof candidate !== "object" || candidates.includes(candidate)) {
            return;
        }

        candidates.push(candidate);
    }

    pushCandidate(profile?.currentCombatLoadout);
    pushCandidate(profile?.combatLoadout);
    pushCandidate(profile?.currentLoadout);
    pushCandidate(profile?.loadout);

    const mappedLoadouts = profile?.characterLoadoutMap && typeof profile.characterLoadoutMap === "object"
        ? Object.values(profile.characterLoadoutMap)
            .filter((candidate) => candidate && typeof candidate === "object")
            .sort((left, right) => scoreShareableLoadoutCandidate(right) - scoreShareableLoadoutCandidate(left))
        : [];

    for (const candidate of mappedLoadouts) {
        pushCandidate(candidate);
    }

    pushCandidate(profile);

    return candidates;
}

function pickShareableCandidateValue(candidates, resolvers, fallbackValue = null) {
    for (const candidate of candidates) {
        for (const resolve of resolvers) {
            const value = resolve(candidate);
            if (value != null) {
                return value;
            }
        }
    }

    return fallbackValue;
}

function extractShareableFoodItemHrids(candidates, parsed) {
    const mainSiteFoodItemHrids = Array.isArray(parsed?.mainSiteConsumables?.foodItemHrids)
        ? parsed.mainSiteConsumables.foodItemHrids
        : null;
    if (mainSiteFoodItemHrids) {
        return [0, 1, 2].map((index) => String(mainSiteFoodItemHrids[index] || ""));
    }

    const resolved = pickShareableCandidateValue(candidates, [
        (candidate) => Array.isArray(candidate?.foodItemHrids) ? candidate.foodItemHrids : null,
        (candidate) => Array.isArray(candidate?.combatConsumables?.foodItemHrids)
            ? candidate.combatConsumables.foodItemHrids
            : null,
        (candidate) => Array.isArray(candidate?.foodHrids) ? candidate.foodHrids : null,
    ], []);

    return [0, 1, 2].map((index) => String(resolved?.[index] || ""));
}

function extractShareableDrinkItemHrids(candidates, parsed) {
    const mainSiteDrinkItemHrids = Array.isArray(parsed?.mainSiteConsumables?.drinkItemHrids)
        ? parsed.mainSiteConsumables.drinkItemHrids
        : null;
    if (mainSiteDrinkItemHrids) {
        return [0, 1, 2].map((index) => String(mainSiteDrinkItemHrids[index] || ""));
    }

    const resolved = pickShareableCandidateValue(candidates, [
        (candidate) => Array.isArray(candidate?.drinkItemHrids) ? candidate.drinkItemHrids : null,
        (candidate) => Array.isArray(candidate?.combatConsumables?.drinkItemHrids)
            ? candidate.combatConsumables.drinkItemHrids
            : null,
        (candidate) => Array.isArray(candidate?.drinkHrids) ? candidate.drinkHrids : null,
    ], []);

    return [0, 1, 2].map((index) => String(resolved?.[index] || ""));
}

function extractShareableTriggerMap(candidates, parsed) {
    const triggerMap = {};

    const mainSiteConsumableTriggerMap = parsed?.mainSiteConsumables?.consumableCombatTriggersMap;
    if (mainSiteConsumableTriggerMap && typeof mainSiteConsumableTriggerMap === "object" && !Array.isArray(mainSiteConsumableTriggerMap)) {
        for (const [targetHrid, triggerList] of Object.entries(mainSiteConsumableTriggerMap)) {
            const hrid = String(targetHrid || "").trim();
            if (!hrid) {
                continue;
            }
            triggerMap[hrid] = sanitizeTriggerList(triggerList);
        }
    }

    const mainSiteAbilityTriggerMap = parsed?.mainSiteConsumables?.abilityCombatTriggersMap;
    if (mainSiteAbilityTriggerMap && typeof mainSiteAbilityTriggerMap === "object" && !Array.isArray(mainSiteAbilityTriggerMap)) {
        for (const [targetHrid, triggerList] of Object.entries(mainSiteAbilityTriggerMap)) {
            const hrid = String(targetHrid || "").trim();
            if (!hrid) {
                continue;
            }
            triggerMap[hrid] = sanitizeTriggerList(triggerList);
        }
    }

    for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const candidate = candidates[index];
        const rawMaps = [
            candidate?.consumableCombatTriggersMap,
            candidate?.abilityCombatTriggersMap,
            candidate?.triggerMap,
            candidate?.combatConsumables?.consumableCombatTriggersMap,
            candidate?.combatAbilities?.abilityCombatTriggersMap,
        ];

        for (const rawMap of rawMaps) {
            if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) {
                continue;
            }

            for (const [targetHrid, triggerList] of Object.entries(rawMap)) {
                const hrid = String(targetHrid || "").trim();
                if (!hrid) {
                    continue;
                }

                triggerMap[hrid] = sanitizeTriggerList(triggerList);
            }
        }
    }

    return triggerMap;
}

function extractShareableHouseRooms(profile, fallbackPlayer) {
    const hasShareableHouseRooms = Object.prototype.hasOwnProperty.call(profile || {}, "characterHouseRoomMap")
        || Object.prototype.hasOwnProperty.call(profile || {}, "houseRooms");
    if (!hasShareableHouseRooms) {
        return undefined;
    }

    const sourceMap = profile?.characterHouseRoomMap && typeof profile.characterHouseRoomMap === "object"
        ? profile.characterHouseRoomMap
        : (profile?.houseRooms && typeof profile.houseRooms === "object" ? profile.houseRooms : {});

    const baseline = fallbackPlayer?.houseRooms && typeof fallbackPlayer.houseRooms === "object"
        ? deepClone(fallbackPlayer.houseRooms)
        : {};

    for (const roomHrid of Object.keys(baseline)) {
        baseline[roomHrid] = 0;
    }

    for (const [roomHrid, rawValue] of Object.entries(sourceMap)) {
        const normalizedHrid = String(roomHrid || "").trim();
        if (!normalizedHrid) {
            continue;
        }

        const level = Math.max(0, Math.floor(toFiniteNumber(rawValue?.level ?? rawValue, 0)));
        baseline[normalizedHrid] = level;
    }

    return baseline;
}

function extractShareableAchievements(profile) {
    const hasShareableAchievements = Object.prototype.hasOwnProperty.call(profile || {}, "characterAchievements")
        || Object.prototype.hasOwnProperty.call(profile || {}, "achievements");
    if (!hasShareableAchievements) {
        return undefined;
    }

    if (Array.isArray(profile?.characterAchievements)) {
        const achievementMap = {};

        for (const entry of profile.characterAchievements) {
            const achievementHrid = String(entry?.achievementHrid || "").trim();
            if (!achievementHrid || entry?.isCompleted !== true) {
                continue;
            }

            achievementMap[achievementHrid] = true;
        }

        return achievementMap;
    }

    if (profile?.achievements && typeof profile.achievements === "object") {
        return deepClone(profile.achievements);
    }

    return {};
}

function extractShareableSimulationSettings(parsed, existingSimulationSettings) {
    const baseline = deepClone(existingSimulationSettings || {});
    const actionHrid = normalizeActionValueToHrid(parsed?.mainSiteCombat?.actionHrid || "");
    if (!actionHrid) {
        return baseline;
    }

    const action = actionDetailMap[actionHrid];
    if (!action || String(action?.type || "") !== "/action_types/combat") {
        return baseline;
    }

    const maxDifficulty = Math.max(0, Math.floor(toFiniteNumber(action?.maxDifficulty, 0)));
    const difficultyTier = clampEnhancementLevel(parsed?.mainSiteCombat?.difficultyTier);

    baseline.mode = "zone";
    baseline.useDungeon = Boolean(action?.combatZoneInfo?.isDungeon);
    baseline.difficultyTier = Math.max(0, Math.min(maxDifficulty, difficultyTier));

    if (baseline.useDungeon) {
        baseline.dungeonHrid = actionHrid;
    } else {
        baseline.zoneHrid = actionHrid;
    }

    baseline.runScope = "single";
    return baseline;
}

function importShareableProfile(parsed, existingPlayer, existingSimulationSettings) {
    const profile = resolveShareableProfileSource(parsed);
    const fallbackPlayer = deepClone(existingPlayer || createEmptyPlayerConfig(1));
    const candidateLoadouts = buildShareableProfileLoadoutCandidates(profile);
    const rawPlayer = {
        id: String(fallbackPlayer.id || "1"),
        name: String(profile?.sharableCharacter?.name || profile?.name || fallbackPlayer.name || `Player ${fallbackPlayer.id}`),
        levels: Object.fromEntries(LEVEL_KEYS.map((key) => [key, 1])),
        skillExperience: createEmptySkillExperienceMap(),
        equipment: {},
        food: extractShareableFoodItemHrids(candidateLoadouts, parsed),
        drinks: extractShareableDrinkItemHrids(candidateLoadouts, parsed),
        abilities: Array.from({ length: 5 }, () => ({ abilityHrid: "", level: 1 })),
    };

    for (const skill of Array.isArray(profile?.characterSkills) ? profile.characterSkills : []) {
        const levelKey = mapShareableSkillHridToLevelKey(skill?.skillHrid);
        if (!levelKey) {
            continue;
        }

        rawPlayer.levels[levelKey] = Math.max(1, Math.floor(toFiniteNumber(skill?.level, 1)));
        rawPlayer.skillExperience[levelKey] = normalizeSkillExperience(skill?.experience);
    }

    const wearableEntries = profile?.wearableItemMap && typeof profile.wearableItemMap === "object"
        ? Object.values(profile.wearableItemMap)
        : [];
    for (const rawEntry of wearableEntries) {
        const entry = rawEntry?.currentItem && typeof rawEntry.currentItem === "object"
            ? rawEntry.currentItem
            : rawEntry;
        const location = String(entry?.itemLocationHrid || "").trim();
        const itemHrid = String(entry?.itemHrid || "").trim();
        const enhancementLevel = clampEnhancementLevel(entry?.enhancementLevel);

        if (!location || !itemHrid) {
            continue;
        }

        if (location === "/item_locations/main_hand" || location === "/item_locations/two_hand") {
            rawPlayer.equipment.weapon = { itemHrid, enhancementLevel };
            continue;
        }

        const slot = location.replace("/item_locations/", "");
        if (NON_WEAPON_SLOTS.includes(slot)) {
            rawPlayer.equipment[slot] = { itemHrid, enhancementLevel };
        }
    }

    const equippedAbilities = Array.isArray(profile?.equippedAbilities)
        ? profile.equippedAbilities
        : [];
    for (const rawAbility of equippedAbilities) {
        const slotNumber = Math.max(1, Math.min(5, Math.floor(toFiniteNumber(rawAbility?.slotNumber, 0))));
        if (!slotNumber) {
            continue;
        }

        rawPlayer.abilities[slotNumber - 1] = {
            abilityHrid: normalizeAbilityHrid(rawAbility?.abilityHrid || rawAbility?.ability || ""),
            level: Math.max(1, Math.floor(toFiniteNumber(rawAbility?.level, 1))),
        };
    }

    const triggerMap = extractShareableTriggerMap(candidateLoadouts, parsed);
    if (Object.keys(triggerMap).length > 0) {
        rawPlayer.triggerMap = triggerMap;
    }

    const houseRooms = extractShareableHouseRooms(profile, fallbackPlayer);
    if (houseRooms !== undefined) {
        rawPlayer.houseRooms = houseRooms;
    }

    const achievements = extractShareableAchievements(profile);
    if (achievements !== undefined) {
        rawPlayer.achievements = achievements;
    }

    return {
        player: sanitizePlayerConfig(rawPlayer, fallbackPlayer),
        simulationSettings: extractShareableSimulationSettings(parsed, existingSimulationSettings),
        detectedFormat: "main-site-share-profile",
    };
}

export function createLegacySoloPayload(playerConfig, simulationSettings) {
    const player = sanitizePlayerConfig(playerConfig, playerConfig);
    const equipment = [];

    for (const slot of NON_WEAPON_SLOTS) {
        const setting = player.equipment?.[slot];
        if (!setting?.itemHrid) {
            continue;
        }

        equipment.push({
            itemLocationHrid: `/item_locations/${slot}`,
            itemHrid: setting.itemHrid,
            enhancementLevel: clampEnhancementLevel(setting.enhancementLevel),
        });
    }

    const weapon = player.equipment?.weapon;
    if (weapon?.itemHrid) {
        equipment.push({
            itemLocationHrid: getWeaponItemLocationFromHrid(weapon.itemHrid),
            itemHrid: weapon.itemHrid,
            enhancementLevel: clampEnhancementLevel(weapon.enhancementLevel),
        });
    }

    const legacySimSettings = getDefaultLegacySimulationSettings(simulationSettings);

    return {
        player: {
            attackLevel: player.levels.attack,
            magicLevel: player.levels.magic,
            meleeLevel: player.levels.melee,
            rangedLevel: player.levels.ranged,
            defenseLevel: player.levels.defense,
            staminaLevel: player.levels.stamina,
            intelligenceLevel: player.levels.intelligence,
            equipment,
        },
        food: {
            "/action_types/combat": player.food.map((itemHrid) => ({ itemHrid: itemHrid || "" })),
        },
        drinks: {
            "/action_types/combat": player.drinks.map((itemHrid) => ({ itemHrid: itemHrid || "" })),
        },
        abilities: player.abilities.map((ability) => ({
            abilityHrid: ability.abilityHrid || "",
            level: String(Math.max(1, Math.floor(toFiniteNumber(ability.level, 1)))),
        })),
        triggerMap: sanitizeTriggerMap(player.triggerMap || {}),
        ...legacySimSettings,
        houseRooms: deepClone(player.houseRooms || {}),
        achievements: deepClone(player.achievements || {}),
    };
}

export function exportGroupConfig(players, simulationSettings, format = "modern") {
    const playerList = Array.isArray(players) ? players : [];

    if (format === "legacy") {
        const result = {};
        for (const player of playerList) {
            const playerId = String(player?.id || "");
            if (!playerId) {
                continue;
            }
            result[playerId] = JSON.stringify(createLegacySoloPayload(player, simulationSettings));
        }
        return JSON.stringify(result, null, 2);
    }

    return JSON.stringify(
        {
            version: 2,
            format: "mwi-vue-group",
            simulationSettings: deepClone(simulationSettings || {}),
            players: playerList.map((player) => sanitizePlayerConfig(player, player)),
        },
        null,
        2
    );
}

export function exportSoloConfig(player, simulationSettings, format = "legacy") {
    const payload = format === "modern"
        ? {
            version: 2,
            format: "mwi-vue-solo",
            simulationSettings: deepClone(simulationSettings || {}),
            player: sanitizePlayerConfig(player, player),
        }
        : createLegacySoloPayload(player, simulationSettings);

    return JSON.stringify(payload, null, 2);
}

function parseJsonText(text) {
    const raw = String(text || "").trim();
    if (!raw) {
        throw new Error("Input is empty.");
    }

    return JSON.parse(raw);
}

function normalizeActionValueToHrid(value) {
    const source = String(value || "").trim();
    if (!source) {
        return "";
    }
    if (source.startsWith("/actions/")) {
        return source;
    }

    const normalized = source.toLowerCase();
    for (const action of Object.values(actionDetailMap || {})) {
        const actionName = String(action?.name || "").trim().toLowerCase();
        if (actionName && actionName === normalized) {
            return String(action?.hrid || source);
        }
    }
    return source;
}

function normalizeMonsterValueToHrid(value) {
    const source = String(value || "").trim();
    if (!source) {
        return "";
    }
    if (source.startsWith("/monsters/")) {
        return source;
    }

    const normalized = source.toLowerCase();
    for (const monster of Object.values(combatMonsterDetailMap || {})) {
        const monsterName = String(monster?.name || "").trim().toLowerCase();
        if (monsterName && monsterName === normalized) {
            return String(monster?.hrid || source);
        }
    }
    return source;
}

function normalizeImportedSimulationSettings(raw, existingSettings) {
    const baseline = deepClone(existingSettings || {});
    const source = raw && typeof raw === "object" ? raw : {};

    const hasLegacyKeys = ["zone", "dungeon", "difficulty", "simulationTime", "labyrinth", "roomLevel"].some((key) => key in source);

    if (hasLegacyKeys) {
        const hasZoneKey = Object.prototype.hasOwnProperty.call(source, "zone");
        const hasDungeonKey = Object.prototype.hasOwnProperty.call(source, "dungeon");
        const hasLabyrinthKey = Object.prototype.hasOwnProperty.call(source, "labyrinth");

        const zoneHrid = hasZoneKey ? normalizeActionValueToHrid(source.zone) : String(baseline.zoneHrid || "");
        const dungeonHrid = hasDungeonKey ? normalizeActionValueToHrid(source.dungeon) : String(baseline.dungeonHrid || "");
        const labyrinthHrid = hasLabyrinthKey ? normalizeMonsterValueToHrid(source.labyrinth) : String(baseline.labyrinthHrid || "");

        baseline.zoneHrid = zoneHrid;
        baseline.dungeonHrid = dungeonHrid;
        baseline.difficultyTier = Math.max(0, Math.floor(toFiniteNumber(source.difficulty, baseline.difficultyTier || 0)));
        baseline.simulationTimeHours = Math.max(1, Math.floor(toFiniteNumber(source.simulationTime, baseline.simulationTimeHours || 24)));
        baseline.labyrinthHrid = labyrinthHrid;
        baseline.roomLevel = Math.max(20, Math.floor(toFiniteNumber(source.roomLevel, baseline.roomLevel || 100)));

        // Legacy exports always include labyrinth; do not let that force labyrinth mode when zone/dungeon exists.
        if (dungeonHrid) {
            baseline.mode = "zone";
            baseline.useDungeon = true;
        } else if (zoneHrid) {
            baseline.mode = "zone";
            baseline.useDungeon = false;
        } else if (labyrinthHrid) {
            baseline.mode = "labyrinth";
            baseline.useDungeon = false;
        }

        baseline.runScope = "single";
        return baseline;
    }

    if (source.simulationSettings && typeof source.simulationSettings === "object") {
        return {
            ...baseline,
            ...deepClone(source.simulationSettings),
        };
    }

    return baseline;
}

export function importGroupConfig(text, existingPlayers, existingSimulationSettings) {
    const parsed = parseJsonText(text);
    const playersById = Object.fromEntries((existingPlayers || []).map((player) => [String(player.id), deepClone(player)]));

    if (parsed && parsed.version === 2 && Array.isArray(parsed.players)) {
        for (const importedPlayer of parsed.players) {
            const playerId = String(importedPlayer?.id || "");
            if (!playersById[playerId]) {
                continue;
            }
            playersById[playerId] = sanitizePlayerConfig(importedPlayer, playersById[playerId]);
        }

        return {
            players: Object.values(playersById),
            simulationSettings: normalizeImportedSimulationSettings(parsed, existingSimulationSettings),
            detectedFormat: "modern-group",
        };
    }

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const candidateKeys = ["1", "2", "3", "4", "5", "player1", "player2", "player3", "player4", "player5"];
        const hasLegacyPlayerMap = candidateKeys.some((key) => Object.prototype.hasOwnProperty.call(parsed, key));

        if (hasLegacyPlayerMap) {
            for (const id of ["1", "2", "3", "4", "5"]) {
                const rawValue = parsed[id] ?? parsed[`player${id}`];
                if (!rawValue) {
                    continue;
                }

                let legacySoloPayload = rawValue;
                if (typeof rawValue === "string") {
                    legacySoloPayload = parseJsonText(rawValue);
                }

                if (!legacySoloPayload || typeof legacySoloPayload !== "object") {
                    continue;
                }

                playersById[id] = applyLegacySoloToPlayer(legacySoloPayload, playersById[id]);
            }

            return {
                players: Object.values(playersById),
                simulationSettings: normalizeImportedSimulationSettings(parsed, existingSimulationSettings),
                detectedFormat: "legacy-group",
            };
        }
    }

    throw new Error("Unsupported group import format.");
}

export function importSoloConfig(text, existingPlayer, existingSimulationSettings) {
    const parsed = parseJsonText(text);

    if (isShareableProfilePayload(parsed)) {
        return importShareableProfile(parsed, existingPlayer, existingSimulationSettings);
    }

    if (parsed && parsed.version === 2 && parsed.player) {
        return {
            player: sanitizePlayerConfig(parsed.player, existingPlayer),
            simulationSettings: normalizeImportedSimulationSettings(parsed, existingSimulationSettings),
            detectedFormat: "modern-solo",
        };
    }

    if (parsed && parsed.player) {
        return {
            player: applyLegacySoloToPlayer(parsed, existingPlayer),
            simulationSettings: normalizeImportedSimulationSettings(parsed, existingSimulationSettings),
            detectedFormat: "legacy-solo",
        };
    }

    if (parsed && typeof parsed === "object" && parsed.levels && parsed.equipment) {
        return {
            player: sanitizePlayerConfig(parsed, existingPlayer),
            simulationSettings: normalizeImportedSimulationSettings(parsed, existingSimulationSettings),
            detectedFormat: "modern-player-only",
        };
    }

    throw new Error("Unsupported solo import format.");
}

import jStat from "jstat";

const DEFAULT_SUCCESS_RATES = [
    0.5, 0.45, 0.45, 0.4, 0.4, 0.4, 0.35, 0.35, 0.35, 0.35,
    0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3,
];

const DEFAULT_TOTAL_BONUS_MULTIPLIERS = [
    0, 1, 2.1, 3.3, 4.6, 6, 7.5, 9.1, 10.8, 12.6,
    14.5, 16.7, 19.2, 22, 25.1, 28.5, 32.2, 36.2, 40.5, 45.1, 50,
];

export const ENHANCEMENT_PERCENTILES = Object.freeze([25, 50, 75, 90, 95, 99]);
export const DEFAULT_MONTE_CARLO_SAMPLES = 32768;
export const MONTE_CARLO_LOAD_THRESHOLD = 10_000_000;
export const MONTE_CARLO_HARD_TRANSITION_LIMIT = 20_000_000;

const EPSILON = 1e-12;
const DEFAULT_DRINK_DURATION_SECONDS = 300;
const NANOSECONDS_PER_SECOND = 1_000_000_000;

function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function toNonNegativeNumber(value, fallback = 0) {
    return Math.max(0, toFiniteNumber(value, fallback));
}

function toInteger(value, fallback = 0) {
    return Math.trunc(toFiniteNumber(value, fallback));
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function normalizeBoolean(value, fallback = false) {
    if (value == null) {
        return fallback;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["false", "0", "off", "no"].includes(normalized)) {
            return false;
        }
        if (["true", "1", "on", "yes"].includes(normalized)) {
            return true;
        }
    }
    return Boolean(value);
}

function normalizeHrid(value) {
    return String(value || "").trim();
}

function findByHrid(collection, hrid) {
    const normalizedHrid = normalizeHrid(hrid);
    if (!normalizedHrid) {
        return null;
    }
    if (Array.isArray(collection)) {
        return collection.find((entry) => normalizeHrid(entry?.hrid) === normalizedHrid) || null;
    }
    if (collection && typeof collection === "object") {
        return collection[normalizedHrid]
            || Object.values(collection).find((entry) => normalizeHrid(entry?.hrid) === normalizedHrid)
            || null;
    }
    return null;
}

function normalizeSelection(entry) {
    if (typeof entry === "string") {
        return { itemHrid: normalizeHrid(entry), enhancementLevel: 0 };
    }
    if (!entry || typeof entry !== "object") {
        return null;
    }
    const itemHrid = normalizeHrid(entry.itemHrid || entry.hrid || entry.item?.hrid || entry.value);
    if (!itemHrid || entry.enabled === false || entry.selected === false) {
        return null;
    }
    return {
        itemHrid,
        enhancementLevel: clamp(toInteger(entry.enhancementLevel ?? entry.level, 0), 0, 20),
    };
}

function normalizeEquipmentSelections(rawEquipment) {
    const entries = Array.isArray(rawEquipment)
        ? rawEquipment
        : rawEquipment && typeof rawEquipment === "object"
            ? Object.values(rawEquipment)
            : [];
    return entries.map(normalizeSelection).filter(Boolean);
}

function normalizeMarkupRate(config) {
    if (config.markupRate != null) {
        return toNonNegativeNumber(config.markupRate, 0);
    }
    return toNonNegativeNumber(
        config.markupPercent ?? config.percentRate ?? config.percent_rate,
        0
    ) / 100;
}

function normalizeProtectionThreshold(value, targetLevel) {
    if (value == null || value === "" || value === false || value === "none") {
        return null;
    }
    const parsed = toInteger(value, targetLevel);
    return parsed >= 2 && parsed < targetLevel ? parsed : null;
}

export function normalizeEnhancementConfig(rawConfig = {}, enhancementData = {}) {
    const targetLevel = clamp(toInteger(rawConfig.targetLevel ?? rawConfig.stopAt, 1), 1, 20);
    const startLevel = clamp(toInteger(rawConfig.startLevel, 0), 0, targetLevel - 1);
    const teaHrid = normalizeHrid(
        rawConfig.enhancingTeaHrid
        || rawConfig.teaHrid
        || (rawConfig.teaEnhancing ? "/items/enhancing_tea" : "")
        || (rawConfig.teaSuperEnhancing ? "/items/super_enhancing_tea" : "")
        || (rawConfig.teaUltraEnhancing ? "/items/ultra_enhancing_tea" : "")
    );
    const explicitConcentration = rawConfig.drinkConcentrationMultiplier ?? rawConfig.guzzlingConcentration;
    const rawCommunitySpeedLevel = rawConfig.communitySpeedLevel
        ?? rawConfig.communityEnhancingLevel
        ?? rawConfig.enhancingCommunityBuffLevel;
    const rawCommunityExperienceLevel = rawConfig.communityExperienceLevel
        ?? rawConfig.experienceCommunityBuffLevel;

    return {
        itemHrid: normalizeHrid(rawConfig.itemHrid || rawConfig.selectedItemHrid || rawConfig.selectedItem),
        startLevel,
        targetLevel,
        protectAt: normalizeProtectionThreshold(rawConfig.protectAt ?? rawConfig.protectionLevel, targetLevel),
        protectionItemHrid: normalizeHrid(rawConfig.protectionItemHrid || rawConfig.protectItemHrid),
        skillLevel: clamp(toInteger(rawConfig.skillLevel ?? rawConfig.enhancingLevel, 1), 1, 200),
        observatoryLevel: clamp(toInteger(rawConfig.observatoryLevel, 0), 0, 8),
        otherRoomLevelsTotal: Math.max(0, toInteger(
            rawConfig.otherRoomLevelsTotal ?? rawConfig.otherRoomLevels,
            0
        )),
        houseRoomLevels: rawConfig.houseRoomLevels && typeof rawConfig.houseRoomLevels === "object"
            ? { ...rawConfig.houseRoomLevels }
            : {},
        communitySpeedEnabled: normalizeBoolean(
            rawConfig.communitySpeedEnabled ?? rawConfig.useEnhancingCommunityBuff,
            toFiniteNumber(rawCommunitySpeedLevel, 0) > 0
        ),
        communitySpeedLevel: clamp(toInteger(
            rawCommunitySpeedLevel,
            1
        ), 1, 20),
        communityExperienceEnabled: normalizeBoolean(
            rawConfig.communityExperienceEnabled ?? rawConfig.useExperienceCommunityBuff,
            toFiniteNumber(rawCommunityExperienceLevel, 0) > 0
        ),
        communityExperienceLevel: clamp(toInteger(
            rawCommunityExperienceLevel,
            1
        ), 1, 20),
        noviceAchievement: normalizeBoolean(rawConfig.noviceAchievement, false),
        championAchievement: normalizeBoolean(rawConfig.championAchievement, false),
        equipment: normalizeEquipmentSelections(
            rawConfig.equipment
            ?? rawConfig.equipmentSlots
            ?? rawConfig.supportEquipment
            ?? rawConfig.equipmentSelections
        ),
        enhancingTeaHrid: teaHrid,
        blessedEnabled: normalizeBoolean(
            rawConfig.blessedEnabled
            ?? rawConfig.blessedTeaEnabled
            ?? rawConfig.blessedTea
            ?? rawConfig.teaBlessed,
            false
        ),
        wisdomEnabled: normalizeBoolean(
            rawConfig.wisdomEnabled
            ?? rawConfig.wisdomTeaEnabled
            ?? rawConfig.wisdomTea
            ?? rawConfig.teaWisdom,
            false
        ),
        drinkConcentrationMultiplier: explicitConcentration == null
            ? null
            : Math.max(1, toFiniteNumber(explicitConcentration, 1)),
        hourlyRate: toNonNegativeNumber(rawConfig.hourlyRate ?? rawConfig.laborRatePerHour, 0),
        markupRate: normalizeMarkupRate(rawConfig),
        budget: toNonNegativeNumber(rawConfig.budget, 0),
        sampleCount: clamp(
            toInteger(rawConfig.sampleCount ?? rawConfig.samples, DEFAULT_MONTE_CARLO_SAMPLES),
            1,
            1_000_000
        ),
        seed: rawConfig.seed ?? 1,
        priceOverrides: rawConfig.priceOverrides && typeof rawConfig.priceOverrides === "object"
            ? { ...rawConfig.priceOverrides }
            : {},
        startingItemPriceOverride: rawConfig.startingItemPriceOverride == null
            ? null
            : toNonNegativeNumber(rawConfig.startingItemPriceOverride, 0),
        actionBaseSeconds: Math.max(
            EPSILON,
            toFiniteNumber(rawConfig.actionBaseSeconds ?? enhancementData?.actionBaseSeconds, 12)
        ),
    };
}

function normalizeMultiplierTable(enhancementData) {
    const table = enhancementData?.totalBonusMultipliers;
    return Array.isArray(table) && table.length > 0 ? table : DEFAULT_TOTAL_BONUS_MULTIPLIERS;
}

function getEnhancingDrinks(enhancementData) {
    return enhancementData?.enhancingDrinks || enhancementData?.drinks || [];
}

function getHousing(enhancementData) {
    return enhancementData?.housing || enhancementData?.house || {};
}

export function resolveBuffValue(buff, level = 1, channel = "flat") {
    if (!buff || level <= 0) {
        return 0;
    }
    const normalizedLevel = Math.max(1, toInteger(level, 1));
    const baseKey = channel === "ratio" ? "ratioBoost" : "flatBoost";
    const levelKey = channel === "ratio" ? "ratioBoostLevelBonus" : "flatBoostLevelBonus";
    return toFiniteNumber(buff[baseKey], 0)
        + (normalizedLevel - 1) * toFiniteNumber(buff[levelKey], 0);
}

export function resolveEnhancedStat(equipment, statName, enhancementLevel, totalBonusMultipliers) {
    if (!equipment) {
        return 0;
    }
    const level = clamp(toInteger(enhancementLevel, 0), 0, 20);
    const multipliers = Array.isArray(totalBonusMultipliers)
        ? totalBonusMultipliers
        : DEFAULT_TOTAL_BONUS_MULTIPLIERS;
    const multiplier = toFiniteNumber(multipliers[level], 0);
    const stats = equipment.stats
        || equipment.noncombatStats
        || equipment.equipmentDetail?.noncombatStats
        || {};
    const enhancementBonuses = equipment.enhancementBonuses
        || equipment.noncombatEnhancementBonuses
        || equipment.equipmentDetail?.noncombatEnhancementBonuses
        || {};
    return toFiniteNumber(stats[statName], 0)
        + toFiniteNumber(enhancementBonuses[statName], 0) * multiplier;
}

export function resolveEquipmentStats(config, enhancementData = {}) {
    const normalizedConfig = normalizeEnhancementConfig(config, enhancementData);
    const multipliers = normalizeMultiplierTable(enhancementData);
    const totals = {};

    for (const selection of normalizedConfig.equipment || []) {
        const equipment = findByHrid(enhancementData?.supportEquipment, selection.itemHrid);
        if (!equipment) {
            continue;
        }
        const stats = equipment.stats
            || equipment.noncombatStats
            || equipment.equipmentDetail?.noncombatStats
            || {};
        const bonuses = equipment.enhancementBonuses
            || equipment.noncombatEnhancementBonuses
            || equipment.equipmentDetail?.noncombatEnhancementBonuses
            || {};
        const statNames = new Set([...Object.keys(stats), ...Object.keys(bonuses)]);
        for (const statName of statNames) {
            totals[statName] = toFiniteNumber(totals[statName], 0)
                + resolveEnhancedStat(equipment, statName, selection.enhancementLevel, multipliers);
        }
    }

    return totals;
}

function getBuff(entry) {
    return entry?.buff || entry;
}

function findBuff(collection, predicate) {
    const entries = Array.isArray(collection) ? collection : Object.values(collection || {});
    for (const entry of entries) {
        const buffs = Array.isArray(entry?.buffs)
            ? entry.buffs
            : Array.isArray(entry?.actionBuffs)
                ? entry.actionBuffs
                : [getBuff(entry)];
        for (const buff of buffs) {
            if (buff && predicate(buff, entry)) {
                return buff;
            }
        }
    }
    return null;
}

function buffsForDrink(drink) {
    if (!drink) {
        return [];
    }
    const raw = drink.buffs || drink.consumableDetail?.buffs || [];
    return Array.isArray(raw) ? raw : [raw];
}

function drinkDurationSeconds(drink) {
    const directDuration = toFiniteNumber(
        drink?.durationSeconds ?? drink?.buffDurationSeconds,
        0,
    );
    if (directDuration > 0) {
        return directDuration;
    }
    const buffDurations = buffsForDrink(drink)
        .map((buff) => {
            const normalized = toFiniteNumber(buff?.durationSeconds, 0);
            return normalized > 0
                ? normalized
                : toFiniteNumber(buff?.duration, 0) / NANOSECONDS_PER_SECOND;
        })
        .filter((duration) => duration > 0);
    return buffDurations.length > 0
        ? Math.min(...buffDurations)
        : DEFAULT_DRINK_DURATION_SECONDS;
}

function selectedEnhancementDrinks(config, enhancementData) {
    const drinks = getEnhancingDrinks(enhancementData);
    const selected = [findByHrid(drinks, config.enhancingTeaHrid)];
    if (config.blessedEnabled) {
        selected.push(findByHrid(drinks, "/items/blessed_tea"));
    }
    if (config.wisdomEnabled) {
        selected.push(
            findByHrid(drinks, "/items/wisdom_tea")
            || findByHrid(drinks, "/items/wisdom_coffee"),
        );
    }
    return Array.from(new Map(
        selected
            .filter((drink) => normalizeHrid(drink?.hrid))
            .map((drink) => [normalizeHrid(drink.hrid), drink]),
    ).values());
}

function typeIncludes(buff, fragment) {
    return normalizeHrid(buff?.typeHrid).includes(fragment);
}

function resolveHouseWisdom(config, enhancementData) {
    const house = getHousing(enhancementData);
    let wisdom = 0;
    const observatory = house.observatory || {};
    const observatoryWisdom = findBuff(observatory.globalBuffs, (buff) => typeIncludes(buff, "wisdom"));
    wisdom += resolveBuffValue(observatoryWisdom, config.observatoryLevel, "flat");

    const roomEntries = Array.isArray(house.globalExperienceByRoom)
        ? house.globalExperienceByRoom
        : Object.values(house.globalExperienceByRoom || {});
    const compactGlobalExperience = house.globalExperience || {};
    const explicitlyConfiguredRooms = new Set();
    for (const [roomHrid, rawLevel] of Object.entries(config.houseRoomLevels || {})) {
        const level = Math.max(0, toInteger(rawLevel, 0));
        if (level <= 0 || roomHrid === "/house_rooms/observatory") {
            continue;
        }
        const room = findByHrid(roomEntries, roomHrid);
        const buff = compactGlobalExperience.buff || findBuff(
            room?.globalBuffs || room?.buffs || room,
            (candidate) => typeIncludes(candidate, "wisdom")
        );
        wisdom += resolveBuffValue(buff, level, "flat");
        explicitlyConfiguredRooms.add(roomHrid);
    }

    const aggregateLevels = Math.max(0, config.otherRoomLevelsTotal);
    if (aggregateLevels > 0) {
        const representative = roomEntries.find((room) => !explicitlyConfiguredRooms.has(normalizeHrid(room?.hrid)));
        const buff = compactGlobalExperience.buff || findBuff(
            representative?.globalBuffs || representative?.buffs || representative,
            (candidate) => typeIncludes(candidate, "wisdom")
        );
        if (buff) {
            const perLevel = resolveBuffValue(buff, 1, "flat");
            wisdom += perLevel * aggregateLevels;
        }
    }
    return wisdom;
}

function findAchievementBuff(enhancementData, tierFragment, typeFragment) {
    return findBuff(enhancementData?.achievementBuffs, (buff, entry) => {
        const tier = normalizeHrid(entry?.tierHrid || entry?.hrid || entry?.name).toLowerCase();
        return tier.includes(tierFragment) && typeIncludes(buff, typeFragment);
    });
}

function findCommunityBuff(enhancementData, hridFragment, typeFragment) {
    return findBuff(enhancementData?.communityBuffs, (buff, entry) => {
        const hrid = normalizeHrid(entry?.hrid || entry?.name).toLowerCase();
        return hrid.includes(hridFragment) && typeIncludes(buff, typeFragment);
    });
}

export function resolveEnhancementBonuses(rawConfig, enhancementData = {}) {
    const config = normalizeEnhancementConfig(rawConfig, enhancementData);
    const item = findByHrid(enhancementData?.enhanceableItems, config.itemHrid) || {};
    const itemLevel = Math.max(1, toInteger(item.itemLevel, 1));
    const equipmentStats = resolveEquipmentStats(config, enhancementData);
    const concentration = config.drinkConcentrationMultiplier == null
        ? Math.max(1, 1 + toFiniteNumber(equipmentStats.drinkConcentration, 0))
        : config.drinkConcentrationMultiplier;

    const drinks = getEnhancingDrinks(enhancementData);
    const enhancingTea = findByHrid(drinks, config.enhancingTeaHrid);
    const enhancingTeaBuffs = buffsForDrink(enhancingTea);
    const teaLevel = enhancingTeaBuffs
        .filter((buff) => typeIncludes(buff, "enhancing_level"))
        .reduce((sum, buff) => sum + resolveBuffValue(buff, 1, "flat"), 0) * concentration;
    const teaSpeed = enhancingTeaBuffs
        .filter((buff) => typeIncludes(buff, "action_speed"))
        .reduce((sum, buff) => sum + resolveBuffValue(buff, 1, "flat"), 0) * concentration;
    const effectiveSkillLevel = config.skillLevel + teaLevel;
    const skillSuccessRatio = effectiveSkillLevel >= itemLevel
        ? 0.0005 * (effectiveSkillLevel - itemLevel)
        : -0.5 * (1 - effectiveSkillLevel / itemLevel);

    const observatory = getHousing(enhancementData).observatory || {};
    const observatorySuccessBuff = findBuff(
        observatory.actionBuffs,
        (buff) => typeIncludes(buff, "enhancing_success")
    );
    const observatorySpeedBuff = findBuff(
        observatory.actionBuffs,
        (buff) => typeIncludes(buff, "action_speed")
    );
    const observatorySuccessRatio = resolveBuffValue(observatorySuccessBuff, config.observatoryLevel, "ratio");
    const observatorySpeed = resolveBuffValue(observatorySpeedBuff, config.observatoryLevel, "flat");
    const championBuff = config.championAchievement
        ? findAchievementBuff(enhancementData, "champion", "enhancing_success")
        : null;
    const championSuccessRatio = resolveBuffValue(championBuff, 1, "ratio")
        + resolveBuffValue(championBuff, 1, "flat");
    const equipmentSuccessRatio = toFiniteNumber(equipmentStats.enhancingSuccess, 0);
    const totalSuccessRatio = skillSuccessRatio
        + observatorySuccessRatio
        + championSuccessRatio
        + equipmentSuccessRatio;

    const skillSpeed = Math.max(0, (effectiveSkillLevel - itemLevel) / 100);
    const equipmentSpeed = toFiniteNumber(equipmentStats.enhancingSpeed, 0)
        + toFiniteNumber(equipmentStats.skillingSpeed, 0)
        + toFiniteNumber(equipmentStats.actionSpeed, 0);
    const communitySpeedBuff = config.communitySpeedEnabled
        ? findCommunityBuff(enhancementData, "enhancing", "action_speed")
        : null;
    const communitySpeed = resolveBuffValue(communitySpeedBuff, config.communitySpeedLevel, "flat");
    const actionSpeed = skillSpeed + observatorySpeed + equipmentSpeed + teaSpeed + communitySpeed;

    const wisdomDrink = findByHrid(drinks, "/items/wisdom_tea")
        || findByHrid(drinks, "/items/wisdom_coffee");
    const wisdomTea = config.wisdomEnabled
        ? buffsForDrink(wisdomDrink)
            .filter((buff) => typeIncludes(buff, "wisdom"))
            .reduce((sum, buff) => sum + resolveBuffValue(buff, 1, "flat"), 0) * concentration
        : 0;
    const communityExperienceBuff = config.communityExperienceEnabled
        ? findCommunityBuff(enhancementData, "experience", "wisdom")
        : null;
    const communityWisdom = resolveBuffValue(
        communityExperienceBuff,
        config.communityExperienceLevel,
        "flat"
    );
    const noviceBuff = config.noviceAchievement
        ? findAchievementBuff(enhancementData, "novice", "wisdom")
        : null;
    const achievementWisdom = resolveBuffValue(noviceBuff, 1, "flat");
    const equipmentWisdom = toFiniteNumber(equipmentStats.enhancingExperience, 0)
        + toFiniteNumber(equipmentStats.skillingExperience, 0)
        + toFiniteNumber(equipmentStats.wisdom, 0);
    const houseWisdom = resolveHouseWisdom(config, enhancementData);
    const wisdom = wisdomTea + communityWisdom + achievementWisdom + equipmentWisdom + houseWisdom;

    const blessedDrink = findByHrid(drinks, "/items/blessed_tea");
    const blessedChance = config.blessedEnabled
        ? clamp(
            buffsForDrink(blessedDrink)
                .filter((buff) => typeIncludes(buff, "blessed"))
                .reduce((sum, buff) => sum + resolveBuffValue(buff, 1, "flat"), 0) * concentration,
            0,
            1
        )
        : 0;

    return {
        itemLevel,
        equipmentStats,
        drinkConcentrationMultiplier: concentration,
        effectiveSkillLevel,
        successRatio: totalSuccessRatio,
        successRatioComponents: {
            skill: skillSuccessRatio,
            observatory: observatorySuccessRatio,
            equipment: equipmentSuccessRatio,
            champion: championSuccessRatio,
        },
        actionSpeed,
        actionSpeedComponents: {
            skill: skillSpeed,
            observatory: observatorySpeed,
            equipment: equipmentSpeed,
            enhancingTea: teaSpeed,
            community: communitySpeed,
        },
        actionSeconds: config.actionBaseSeconds / Math.max(EPSILON, 1 + actionSpeed),
        wisdom,
        wisdomMultiplier: Math.max(0, 1 + wisdom),
        wisdomComponents: {
            equipment: equipmentWisdom,
            tea: wisdomTea,
            house: houseWisdom,
            community: communityWisdom,
            novice: achievementWisdom,
        },
        blessedChance,
    };
}

function normalizeSuccessRates(enhancementData) {
    const source = Array.isArray(enhancementData?.successRates)
        ? enhancementData.successRates
        : DEFAULT_SUCCESS_RATES;
    return Array.from({ length: 20 }, (_, index) => {
        const raw = toFiniteNumber(source[index], DEFAULT_SUCCESS_RATES[index]);
        return clamp(raw > 1 ? raw / 100 : raw, 0, 1);
    });
}

export function calculateBaseEnhancingExperience(itemLevel, currentLevel) {
    return 1.4 * (1 + Math.max(0, toInteger(currentLevel, 0))) * (10 + Math.max(1, toInteger(itemLevel, 1)));
}

export function buildEnhancementTransitionModel(rawConfig, enhancementData = {}) {
    const config = normalizeEnhancementConfig(rawConfig, enhancementData);
    const bonuses = resolveEnhancementBonuses(config, enhancementData);
    const baseRates = normalizeSuccessRates(enhancementData);
    const stateCount = config.targetLevel;
    const Q = Array.from({ length: stateCount }, () => Array(stateCount).fill(0));
    const outcomes = Array.from({ length: stateCount }, () => []);
    const successChances = [];

    for (let currentLevel = 0; currentLevel < stateCount; currentLevel += 1) {
        const successChance = clamp(baseRates[currentLevel] * (1 + bonuses.successRatio), 0, 1);
        const blessedProbability = successChance * bonuses.blessedChance;
        const regularSuccessProbability = successChance - blessedProbability;
        const failProbability = 1 - successChance;
        const failureLevel = config.protectAt != null && currentLevel >= config.protectAt
            ? Math.max(0, currentLevel - 1)
            : 0;
        const baseExperience = calculateBaseEnhancingExperience(bonuses.itemLevel, currentLevel);

        successChances.push(successChance);
        const candidates = [
            {
                type: "blessed",
                probability: blessedProbability,
                toLevel: Math.min(config.targetLevel, currentLevel + 2),
                usesProtection: false,
                experience: baseExperience * bonuses.wisdomMultiplier,
            },
            {
                type: "success",
                probability: regularSuccessProbability,
                toLevel: Math.min(config.targetLevel, currentLevel + 1),
                usesProtection: false,
                experience: baseExperience * bonuses.wisdomMultiplier,
            },
            {
                type: "failure",
                probability: failProbability,
                toLevel: failureLevel,
                usesProtection: config.protectAt != null && currentLevel >= config.protectAt,
                experience: baseExperience * 0.1 * bonuses.wisdomMultiplier,
            },
        ];

        for (const outcome of candidates) {
            if (outcome.probability <= EPSILON) {
                continue;
            }
            outcome.absorbed = outcome.toLevel >= config.targetLevel;
            outcomes[currentLevel].push(outcome);
            if (!outcome.absorbed) {
                Q[currentLevel][outcome.toLevel] += outcome.probability;
            }
        }
    }

    return {
        config,
        item: findByHrid(enhancementData?.enhanceableItems, config.itemHrid),
        bonuses,
        startLevel: config.startLevel,
        targetLevel: config.targetLevel,
        protectAt: config.protectAt,
        successChances,
        Q,
        outcomes,
        costContext: null,
    };
}

function solveLinearSystem(matrix, vector) {
    const normalizedMatrix = matrix.map((row) => row.map((value) => toFiniteNumber(value, 0)));
    const normalizedVector = vector.map((value) => [toFiniteNumber(value, 0)]);
    const inverse = jStat.inv(normalizedMatrix);
    if (!Array.isArray(inverse) || inverse.length !== vector.length) {
        throw new Error("Enhancement transition matrix is singular; the target cannot be reached.");
    }
    const solved = jStat.multiply(inverse, normalizedVector);
    const result = vector.length === 1
        ? [toFiniteNumber(solved, Number.NaN)]
        : solved.map((row) => toFiniteNumber(Array.isArray(row) ? row[0] : row, Number.NaN));
    if (result.some((value) => !Number.isFinite(value))) {
        throw new Error("Enhancement transition matrix is singular; the target cannot be reached.");
    }
    return result;
}

function identityMinusQ(model, transpose = false) {
    const size = model.Q.length;
    return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => {
        const qValue = transpose ? model.Q[column][row] : model.Q[row][column];
        return (row === column ? 1 : 0) - qValue;
    }));
}

export function calculateExpectedStateVisits(model, startLevel = model?.startLevel) {
    const size = model?.Q?.length || 0;
    if (size === 0) {
        return [];
    }
    const start = clamp(toInteger(startLevel, 0), 0, size - 1);
    const source = Array(size).fill(0);
    source[start] = 1;
    return solveLinearSystem(identityMinusQ(model, true), source).map((value) => Math.max(0, value));
}

export const expectedStateVisits = calculateExpectedStateVisits;

function priceEntryValue(entry, source) {
    if (!entry || typeof entry !== "object") {
        return -1;
    }
    const rawValue = source === "ask"
        ? entry.ask ?? entry.a
        : source === "bid"
            ? entry.bid ?? entry.b
            : entry.vendor;
    if (rawValue == null || (typeof rawValue === "string" && rawValue.trim() === "")) {
        return -1;
    }
    return toFiniteNumber(rawValue, -1);
}

function valueFromPriceEntry(entry, mode, requestedSources = null, overrideEntry = null) {
    const defaultSources = mode === "bid"
        ? ["bid", "ask", "vendor"]
        : ["ask", "bid", "vendor"];
    const sources = Array.isArray(requestedSources) && requestedSources.length > 0
        ? requestedSources.filter((source) => ["ask", "bid", "vendor"].includes(source))
        : defaultSources;
    for (const source of sources) {
        const overridePrice = priceEntryValue(overrideEntry, source);
        if (overridePrice >= 0) {
            return { price: overridePrice, source: "override", priceSide: source, available: true };
        }
        const price = priceEntryValue(entry, source);
        if (price >= 0) {
            return { price, source, priceSide: source, available: true };
        }
    }
    return { price: null, source: "missing", available: false };
}

function resolveOverride(overrides, itemHrid, level) {
    if (!overrides || typeof overrides !== "object") {
        return null;
    }
    const levelKeys = level == null
        ? []
        : [`${itemHrid}:${level}`, `${itemHrid}@${level}`];
    for (const key of levelKeys) {
        if (overrides[key] != null) {
            return overrides[key];
        }
    }
    const direct = overrides[itemHrid];
    if (level != null && direct && typeof direct === "object" && direct[level] != null) {
        return direct[level];
    }
    return level == null || level === 0 ? direct : null;
}

export function resolveEnhancementPrice(pricing = {}, itemHrid, options = {}) {
    const hrid = normalizeHrid(itemHrid);
    const mode = options.mode === "bid" ? "bid" : "ask";
    const level = options.level == null ? null : Math.max(0, toInteger(options.level, 0));
    const overrides = { ...(pricing.overrides || {}), ...(options.overrides || {}) };
    const override = options.override ?? resolveOverride(overrides, hrid, level);
    const objectOverride = override != null && typeof override === "object" && (
        override.ask != null
        || override.bid != null
        || override.a != null
        || override.b != null
    ) ? override : null;
    if (override != null && typeof override !== "object") {
        return {
            price: toNonNegativeNumber(override, 0),
            source: "override",
            available: true,
            itemHrid: hrid,
            level,
        };
    }

    if (level != null) {
        const quote = pricing.enhancementQuotesByItem?.[hrid]?.[String(level)]
            || pricing.enhancementQuotes?.[hrid]?.[String(level)];
        if (quote) {
            const resolved = valueFromPriceEntry(quote, mode, options.sources, objectOverride);
            return {
                ...resolved,
                source: resolved.available && resolved.source !== "override"
                    ? `enhancement_${resolved.source}`
                    : resolved.source,
                itemHrid: hrid,
                level,
            };
        }
        if (options.directLevelOnly || level > 0) {
            const resolvedOverride = valueFromPriceEntry(null, mode, options.sources, objectOverride);
            if (resolvedOverride.available) {
                return { ...resolvedOverride, itemHrid: hrid, level };
            }
            return { price: null, source: "missing", available: false, itemHrid: hrid, level };
        }
    }

    const table = pricing.priceTable || pricing;
    const resolved = valueFromPriceEntry(table?.[hrid], mode, options.sources, objectOverride);
    return { ...resolved, itemHrid: hrid, level };
}

function mergePriceOverrides(config, pricing) {
    return { ...(pricing?.overrides || {}), ...(config?.priceOverrides || {}) };
}

function enhancementCatalogItem(enhancementData, itemHrid) {
    return findByHrid(enhancementData?.enhanceableItems, itemHrid)
        || findByHrid(enhancementData?.protectionItems, itemHrid)
        || findByHrid(enhancementData?.materialItems, itemHrid)
        || null;
}

function expectedDropCount(drop) {
    const dropRate = Math.max(0, toFiniteNumber(drop?.dropRate, 0));
    const minCount = Math.max(0, toFiniteNumber(drop?.minCount, 0));
    const maxCount = Math.max(0, toFiniteNumber(drop?.maxCount, 0));
    return dropRate * (minCount + maxCount) / 2;
}

function requiredAcquisitionInputPrice(pricing, itemHrid, overrides) {
    const hrid = normalizeHrid(itemHrid);
    if (!hrid) {
        return { price: 0, source: "none", available: true, itemHrid: hrid };
    }
    return resolveEnhancementPrice(pricing, hrid, {
        mode: "ask",
        overrides,
        sources: ["ask"],
    });
}

export function estimateEnhancementAcquisitionValue(itemHrid, enhancementData = {}, pricing = {}, options = {}) {
    const hrid = normalizeHrid(itemHrid);
    const acquisition = enhancementData?.acquisition || {};
    const sources = Array.isArray(acquisition?.sourcesByItemHrid?.[hrid])
        ? acquisition.sourcesByItemHrid[hrid]
        : [];
    const item = enhancementCatalogItem(enhancementData, hrid) || {};
    const vendorFloor = toNonNegativeNumber(item?.sellPrice, 0);
    const overrides = { ...(pricing?.overrides || {}), ...(options?.overrides || {}) };
    const estimates = [];
    const missingInputHrids = new Set();

    for (const source of sources) {
        if (source?.type !== "dungeon_openable") {
            continue;
        }
        const openable = acquisition?.openablesByHrid?.[source.containerHrid];
        if (!openable) {
            continue;
        }
        const containerExpectedCount = Math.max(0, toFiniteNumber(source.containerDropRate, 0))
            * (Math.max(0, toFiniteNumber(source.containerMinCount, 0))
                + Math.max(0, toFiniteNumber(source.containerMaxCount, 0))) / 2;
        const targetDrops = Array.isArray(source.itemDrops) && source.itemDrops.length > 0
            ? source.itemDrops
            : (openable.drops || []).filter((drop) => normalizeHrid(drop?.itemHrid) === hrid);
        const targetExpectedCountPerContainer = targetDrops.reduce(
            (sum, drop) => sum + expectedDropCount(drop),
            0,
        );
        const targetExpectedCountPerAttempt = containerExpectedCount * targetExpectedCountPerContainer;
        if (containerExpectedCount <= 0 || targetExpectedCountPerAttempt <= 0) {
            continue;
        }

        const entryKey = requiredAcquisitionInputPrice(pricing, source.entryKeyItemHrid, overrides);
        const openKey = requiredAcquisitionInputPrice(pricing, openable.openKeyItemHrid, overrides);
        if (!entryKey.available || !openKey.available) {
            if (!entryKey.available && source.entryKeyItemHrid) {
                missingInputHrids.add(source.entryKeyItemHrid);
            }
            if (!openKey.available && openable.openKeyItemHrid) {
                missingInputHrids.add(openable.openKeyItemHrid);
            }
            continue;
        }

        let otherLootValuePerContainer = 0;
        const otherLootDetails = [];
        for (const drop of openable.drops || []) {
            const dropItemHrid = normalizeHrid(drop?.itemHrid);
            if (!dropItemHrid || dropItemHrid === hrid) {
                continue;
            }
            const expectedCount = expectedDropCount(drop);
            if (expectedCount <= 0) {
                continue;
            }
            const liquidation = resolveEnhancementPrice(pricing, dropItemHrid, {
                mode: "bid",
                overrides,
                sources: ["bid", "vendor"],
            });
            const unitPrice = liquidation.available ? liquidation.price : 0;
            const expectedValue = expectedCount * unitPrice;
            otherLootValuePerContainer += expectedValue;
            otherLootDetails.push({
                itemHrid: dropItemHrid,
                expectedCount,
                unitPrice,
                expectedValue,
                priceSource: liquidation.available ? liquidation.source : "missing",
            });
        }

        const grossCostPerAttempt = entryKey.price + containerExpectedCount * openKey.price;
        const otherLootValuePerAttempt = containerExpectedCount * otherLootValuePerContainer;
        const netCostPerAttempt = grossCostPerAttempt - otherLootValuePerAttempt;
        const residualValue = netCostPerAttempt / targetExpectedCountPerAttempt;
        const price = Math.max(vendorFloor, toFiniteNumber(residualValue, vendorFloor));
        estimates.push({
            itemHrid: hrid,
            price,
            source: "acquisition_estimate",
            available: true,
            estimated: true,
            autoEligible: false,
            vendorFloor,
            expectedContainers: 1 / targetExpectedCountPerContainer,
            expectedAttempts: 1 / targetExpectedCountPerAttempt,
            targetExpectedCountPerContainer,
            targetExpectedCountPerAttempt,
            containerExpectedCount,
            grossCostPerAttempt,
            otherLootValuePerContainer,
            otherLootValuePerAttempt,
            netCostPerAttempt,
            actionHrid: source.actionHrid,
            difficultyTier: source.difficultyTier,
            entryKeyItemHrid: source.entryKeyItemHrid,
            entryKeyPrice: entryKey.price,
            entryKeyPriceSource: entryKey.source,
            containerHrid: source.containerHrid,
            openKeyItemHrid: openable.openKeyItemHrid,
            openKeyPrice: openKey.price,
            openKeyPriceSource: openKey.source,
            otherLootDetails,
        });
    }

    estimates.sort((left, right) => left.price - right.price
        || left.expectedAttempts - right.expectedAttempts
        || String(left.actionHrid).localeCompare(String(right.actionHrid)));
    if (estimates.length > 0) {
        return { ...estimates[0], alternatives: estimates };
    }
    return {
        itemHrid: hrid,
        price: null,
        source: "acquisition_missing",
        available: false,
        estimated: true,
        autoEligible: false,
        vendorFloor,
        missingInputHrids: Array.from(missingInputHrids),
    };
}

export function resolveStartingItemPrice(config, enhancementData, pricing) {
    if (config.startingItemPriceOverride != null) {
        return {
            price: config.startingItemPriceOverride,
            source: "override",
            available: true,
            itemHrid: config.itemHrid,
            level: config.startLevel,
        };
    }
    const item = enhancementCatalogItem(enhancementData, config.itemHrid);
    const direct = resolveEnhancementPrice(pricing, config.itemHrid, {
        mode: "ask",
        level: config.startLevel,
        directLevelOnly: config.startLevel > 0,
        overrides: mergePriceOverrides(config, pricing),
        sources: item?.isTradable === false ? ["ask"] : null,
    });
    if ((direct.available && direct.source === "override") || item?.isTradable !== false) {
        return direct;
    }
    if (config.startLevel > 0) {
        return { ...direct, price: null, source: "missing", available: false };
    }
    return estimateEnhancementAcquisitionValue(config.itemHrid, enhancementData, pricing, {
        overrides: mergePriceOverrides(config, pricing),
    });
}

export function resolveProtectionCandidates(rawConfig, enhancementData = {}, pricing = {}) {
    const config = normalizeEnhancementConfig(rawConfig, enhancementData);
    const item = findByHrid(enhancementData?.enhanceableItems, config.itemHrid) || {};
    const hrids = Array.from(new Set([
        "/items/mirror_of_protection",
        config.itemHrid,
        ...(Array.isArray(item.protectionItemHrids) ? item.protectionItemHrids : []),
    ].map(normalizeHrid).filter(Boolean)));
    const overrides = mergePriceOverrides(config, pricing);
    const candidates = hrids.map((itemHrid) => {
        const item = enhancementCatalogItem(enhancementData, itemHrid);
        const direct = resolveEnhancementPrice(pricing, itemHrid, {
            mode: "ask",
            overrides,
            sources: ["ask"],
        });
        if (direct.available && direct.source === "override") {
            return {
                itemHrid,
                isTradable: item?.isTradable ?? null,
                ...direct,
                autoEligible: true,
                estimated: false,
            };
        }
        if (item?.isTradable !== false && direct.available) {
            return {
                itemHrid,
                isTradable: item?.isTradable ?? null,
                ...direct,
                autoEligible: true,
                estimated: false,
            };
        }
        const estimate = estimateEnhancementAcquisitionValue(itemHrid, enhancementData, pricing, { overrides });
        return {
            itemHrid,
            isTradable: item?.isTradable ?? null,
            ...estimate,
            autoEligible: false,
        };
    });
    candidates.sort((left, right) => {
        if (left.autoEligible !== right.autoEligible) {
            return left.autoEligible ? -1 : 1;
        }
        if (left.available !== right.available) {
            return left.available ? -1 : 1;
        }
        return toFiniteNumber(left.price, Infinity) - toFiniteNumber(right.price, Infinity)
            || left.itemHrid.localeCompare(right.itemHrid);
    });
    return candidates;
}

function addMaterialCount(target, itemHrid, amount) {
    const hrid = normalizeHrid(itemHrid);
    if (!hrid || amount <= 0) {
        return;
    }
    target[hrid] = toFiniteNumber(target[hrid], 0) + amount;
}

function calculateCostContext(config, model, enhancementData, pricing, expectedActions, expectedProtections) {
    const item = model.item || {};
    const costs = Array.isArray(item.enhancementCosts) ? item.enhancementCosts : [];
    const overrides = mergePriceOverrides(config, pricing);
    const perActionMaterials = {};
    const materialPriceDetails = [];
    const consumableDetails = [];
    const missingMaterialHrids = [];
    let materialCostPerAction = 0;
    let consumableCostPerAction = 0;
    let coinPerAction = 0;

    for (const cost of costs) {
        const itemHrid = normalizeHrid(cost?.itemHrid);
        const count = toNonNegativeNumber(cost?.count, 0);
        if (!itemHrid || count <= 0) {
            continue;
        }
        addMaterialCount(perActionMaterials, itemHrid, count);
        if (itemHrid === "/items/coin") {
            coinPerAction += count;
            continue;
        }
        const resolved = resolveEnhancementPrice(pricing, itemHrid, { mode: "ask", overrides });
        const unitPrice = resolved.available ? resolved.price : 0;
        if (!resolved.available) {
            missingMaterialHrids.push(itemHrid);
        }
        materialCostPerAction += count * unitPrice;
        materialPriceDetails.push({ itemHrid, count, unitPrice, priceSource: resolved.source, available: resolved.available });
    }

    const concentration = Math.max(
        1,
        toFiniteNumber(model?.bonuses?.drinkConcentrationMultiplier, 1),
    );
    for (const drink of selectedEnhancementDrinks(config, enhancementData)) {
        const itemHrid = normalizeHrid(drink?.hrid);
        const durationSeconds = drinkDurationSeconds(drink);
        const effectiveDurationSeconds = durationSeconds / concentration;
        const count = model.bonuses.actionSeconds / Math.max(EPSILON, effectiveDurationSeconds);
        addMaterialCount(perActionMaterials, itemHrid, count);
        const resolved = resolveEnhancementPrice(pricing, itemHrid, { mode: "ask", overrides });
        const unitPrice = resolved.available ? resolved.price : 0;
        if (!resolved.available) {
            missingMaterialHrids.push(itemHrid);
        }
        const costPerAction = count * unitPrice;
        materialCostPerAction += costPerAction;
        consumableCostPerAction += costPerAction;
        const detail = {
            kind: "consumable",
            itemHrid,
            count,
            unitPrice,
            costPerAction,
            durationSeconds,
            effectiveDurationSeconds,
            priceSource: resolved.source,
            available: resolved.available,
        };
        materialPriceDetails.push(detail);
        consumableDetails.push(detail);
    }

    const protectionCandidates = resolveProtectionCandidates(config, enhancementData, pricing);
    let selectedProtection = config.protectionItemHrid
        ? protectionCandidates.find((candidate) => candidate.itemHrid === config.protectionItemHrid)
        : protectionCandidates.find((candidate) => candidate.autoEligible);
    selectedProtection ||= {
        itemHrid: config.protectionItemHrid,
        price: null,
        source: config.protectionItemHrid ? "invalid_protection" : "missing",
        available: false,
        autoEligible: false,
    };
    const requiresProtectionPrice = model.protectAt != null && expectedProtections > EPSILON;
    const materialPricesAvailable = missingMaterialHrids.length === 0;
    const protectionPriceAvailable = !requiresProtectionPrice || selectedProtection.available;
    const incrementalCostAvailable = materialPricesAvailable && protectionPriceAvailable;
    const protectionCost = model.protectAt == null
        ? 0
        : selectedProtection.available
            ? toNonNegativeNumber(selectedProtection.price, 0)
            : null;
    const laborPerAction = config.hourlyRate * model.bonuses.actionSeconds / 3600;
    const stepCost = materialCostPerAction + coinPerAction;
    const rawIncrementalCost = incrementalCostAvailable
        ? expectedActions * (stepCost + laborPerAction)
            + expectedProtections * toNonNegativeNumber(protectionCost, 0)
        : null;
    const markupMultiplier = 1 + config.markupRate;
    const startingItem = resolveStartingItemPrice(config, enhancementData, pricing);
    const expectedMaterialCounts = Object.fromEntries(
        Object.entries(perActionMaterials).map(([itemHrid, count]) => [itemHrid, count * expectedActions])
    );

    return {
        perActionMaterials,
        expectedMaterialCounts,
        materialPriceDetails,
        consumableDetails,
        materialPricesAvailable,
        missingMaterialHrids,
        materialCostPerAction,
        consumableCostPerAction,
        coinPerAction,
        stepCost,
        laborPerAction,
        protectionItem: selectedProtection,
        protectionCost,
        protectionPriceAvailable,
        incrementalCostAvailable,
        costAvailable: incrementalCostAvailable,
        startingItem,
        markupMultiplier,
        rawIncrementalCost,
        incrementalCost: incrementalCostAvailable ? rawIncrementalCost * markupMultiplier : null,
        totalInvestment: startingItem.available && incrementalCostAvailable
            ? (startingItem.price + rawIncrementalCost) * markupMultiplier
            : null,
    };
}

export function analyzeEnhancementStrategy(rawConfig, enhancementData = {}, pricing = {}) {
    const config = normalizeEnhancementConfig(rawConfig, enhancementData);
    const model = buildEnhancementTransitionModel(config, enhancementData);
    const stateVisits = calculateExpectedStateVisits(model);
    const expectedActions = stateVisits.reduce((sum, value) => sum + value, 0);
    let expectedProtections = 0;
    let expectedResets = 0;
    let expectedExperience = 0;

    for (let state = 0; state < stateVisits.length; state += 1) {
        for (const outcome of model.outcomes[state]) {
            expectedExperience += stateVisits[state] * outcome.probability * outcome.experience;
            if (outcome.usesProtection) {
                expectedProtections += stateVisits[state] * outcome.probability;
            }
            if (state > 0 && outcome.type === "failure" && outcome.toLevel === 0) {
                expectedResets += stateVisits[state] * outcome.probability;
            }
        }
    }

    const cost = calculateCostContext(
        config,
        model,
        enhancementData,
        pricing,
        expectedActions,
        expectedProtections
    );
    model.costContext = cost;
    const expectedSeconds = expectedActions * model.bonuses.actionSeconds;

    return {
        config,
        model,
        protectAt: model.protectAt,
        stateVisits,
        successChances: model.successChances,
        expectedActions,
        expectedProtections,
        expectedResets,
        expectedExperience,
        expectedSeconds,
        experiencePerHour: expectedSeconds > 0 ? expectedExperience * 3600 / expectedSeconds : 0,
        ...cost,
        rawMaterialCost: cost.incrementalCostAvailable
            ? expectedActions * (cost.materialCostPerAction + cost.coinPerAction)
                + expectedProtections * toNonNegativeNumber(cost.protectionCost, 0)
            : null,
        laborCost: expectedActions * cost.laborPerAction,
        totalCost: cost.totalInvestment,
    };
}

export function analyzeEnhancementStrategies(rawConfig, enhancementData = {}, pricing = {}) {
    const config = normalizeEnhancementConfig(rawConfig, enhancementData);
    const thresholds = [null];
    for (let protectAt = 2; protectAt < config.targetLevel; protectAt += 1) {
        thresholds.push(protectAt);
    }
    const strategies = thresholds.map((protectAt) => analyzeEnhancementStrategy(
        { ...config, protectAt },
        enhancementData,
        pricing
    ));
    const sortableCost = (strategy) => {
        const totalInvestment = strategy?.totalInvestment;
        if (totalInvestment != null && Number.isFinite(Number(totalInvestment))) {
            return Number(totalInvestment);
        }
        const incrementalCost = strategy?.incrementalCost;
        return incrementalCost != null && Number.isFinite(Number(incrementalCost))
            ? Number(incrementalCost)
            : Infinity;
    };
    const recommendedStrategy = strategies.reduce((best, strategy) => (
        !best || sortableCost(strategy) < sortableCost(best) ? strategy : best
    ), null);
    return {
        config,
        protectionCandidates: resolveProtectionCandidates(config, enhancementData, pricing),
        strategies,
        recommendedStrategy,
    };
}

function rewardResolver(reward) {
    if (typeof reward === "function") {
        return reward;
    }
    if (typeof reward === "number") {
        return () => reward;
    }
    if (typeof reward === "string") {
        return (outcome) => toFiniteNumber(outcome?.rewards?.[reward] ?? outcome?.[reward], 0);
    }
    const descriptor = reward && typeof reward === "object" ? reward : {};
    return (outcome) => toFiniteNumber(descriptor.perAction, 0)
        + (outcome?.usesProtection ? toFiniteNumber(descriptor.perProtection, 0) : 0)
        + toFiniteNumber(descriptor.byType?.[outcome?.type], 0);
}

export function calculateRewardMoments(model, reward = { perAction: 1 }) {
    const size = model?.Q?.length || 0;
    if (size === 0) {
        return { mean: 0, secondMoment: 0, variance: 0, standardDeviation: 0, stateMeans: [], stateSecondMoments: [] };
    }
    const resolveReward = rewardResolver(reward);
    const immediateMeans = Array(size).fill(0);
    for (let state = 0; state < size; state += 1) {
        immediateMeans[state] = model.outcomes[state].reduce(
            (sum, outcome) => sum + outcome.probability * resolveReward(outcome, state, model),
            0
        );
    }
    const matrix = identityMinusQ(model, false);
    const stateMeans = solveLinearSystem(matrix, immediateMeans);
    const secondRhs = Array(size).fill(0);
    for (let state = 0; state < size; state += 1) {
        for (const outcome of model.outcomes[state]) {
            const value = resolveReward(outcome, state, model);
            const continuation = outcome.absorbed ? 0 : stateMeans[outcome.toLevel];
            secondRhs[state] += outcome.probability * (value * value + 2 * value * continuation);
        }
    }
    const stateSecondMoments = solveLinearSystem(matrix, secondRhs);
    const start = model.startLevel;
    const initial = toFiniteNumber(reward?.initial, 0);
    const processMean = stateMeans[start];
    const processSecondMoment = stateSecondMoments[start];
    const mean = processMean + initial;
    const secondMoment = processSecondMoment + 2 * initial * processMean + initial * initial;
    const variance = Math.max(0, secondMoment - mean * mean);
    return {
        mean,
        secondMoment,
        variance,
        standardDeviation: Math.sqrt(variance),
        stateMeans,
        stateSecondMoments,
    };
}

export function calculateStrategyCostMoments(strategy) {
    const context = strategy?.model?.costContext || strategy;
    if (context?.materialPricesAvailable === false) {
        throw new Error("A price is required for every enhancement material.");
    }
    if (context?.incrementalCostAvailable === false || context?.costAvailable === false) {
        throw new Error("A priced protection item is required for cost analysis.");
    }
    if (context?.startingItem?.available === false) {
        throw new Error("A direct market quote or price override is required for the starting enhancement level.");
    }
    const markup = toFiniteNumber(context?.markupMultiplier, 1);
    const initial = context?.startingItem?.available
        ? toNonNegativeNumber(context.startingItem.price, 0) * markup
        : 0;
    return calculateRewardMoments(strategy.model, {
        perAction: (toFiniteNumber(context?.stepCost, 0) + toFiniteNumber(context?.laborPerAction, 0)) * markup,
        perProtection: toFiniteNumber(context?.protectionCost, 0) * markup,
        initial,
    });
}

function regularizedGammaP(shape, value) {
    if (!(shape > 0) || value <= 0) {
        return 0;
    }
    if (!Number.isFinite(value)) {
        return 1;
    }
    return clamp(jStat.gamma.cdf(value, shape, 1), 0, 1);
}

function gammaQuantile(probability, shape, scale) {
    if (probability <= 0) {
        return 0;
    }
    if (probability >= 1) {
        return Infinity;
    }
    return jStat.gamma.inv(probability, shape, scale);
}

function normalizePercentiles(percentiles) {
    const source = Array.isArray(percentiles) && percentiles.length > 0
        ? percentiles
        : ENHANCEMENT_PERCENTILES;
    return source.map((value) => clamp(toFiniteNumber(value, 0), 0, 100));
}

export function fitGammaRisk(moments, options = {}) {
    const mean = Math.max(0, toFiniteNumber(moments?.mean, 0));
    const variance = Math.max(0, toFiniteNumber(moments?.variance, 0));
    const offset = Math.max(0, toFiniteNumber(options.offset, 0));
    const variableMean = Math.max(0, mean - offset);
    const percentiles = normalizePercentiles(options.percentiles);
    const budget = options.budget == null ? null : toNonNegativeNumber(options.budget, 0);
    const quantiles = {};

    if (variance <= EPSILON || variableMean <= EPSILON) {
        for (const percentile of percentiles) {
            quantiles[String(percentile)] = mean;
        }
        return {
            method: "moment_gamma",
            approximate: true,
            mean,
            variance,
            standardDeviation: Math.sqrt(variance),
            shape: Infinity,
            scale: 0,
            offset,
            quantiles,
            budgetProbability: budget == null ? null : (budget + EPSILON >= mean ? 1 : 0),
            sampleCount: 0,
            actualSamples: 0,
            transitions: 0,
            seed: options.seed ?? null,
        };
    }

    const shape = variableMean * variableMean / variance;
    const scale = variance / variableMean;
    for (const percentile of percentiles) {
        quantiles[String(percentile)] = offset + gammaQuantile(percentile / 100, shape, scale);
    }
    const budgetProbability = budget == null
        ? null
        : budget <= offset
            ? 0
            : regularizedGammaP(shape, (budget - offset) / scale);
    return {
        method: "moment_gamma",
        approximate: true,
        mean,
        variance,
        standardDeviation: Math.sqrt(variance),
        shape,
        scale,
        offset,
        quantiles,
        budgetProbability,
        sampleCount: 0,
        actualSamples: 0,
        transitions: 0,
        seed: options.seed ?? null,
    };
}

function hashSeed(seed) {
    if (typeof seed === "number" && Number.isFinite(seed)) {
        return seed >>> 0;
    }
    const value = String(seed ?? "1");
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

export function createSeededRandom(seed = 1) {
    let state = hashSeed(seed);
    return function seededRandom() {
        state = (state + 0x6D2B79F5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function chooseOutcome(outcomes, randomValue) {
    let cumulative = 0;
    for (const outcome of outcomes) {
        cumulative += outcome.probability;
        if (randomValue < cumulative + EPSILON) {
            return outcome;
        }
    }
    return outcomes[outcomes.length - 1];
}

function normalizeTrialArguments(input, rngOrOptions, maybeOptions) {
    const model = input?.model || input;
    const strategy = input?.model ? input : null;
    const rng = typeof rngOrOptions === "function"
        ? rngOrOptions
        : typeof rngOrOptions?.random === "function"
            ? rngOrOptions.random
            : Math.random;
    const options = typeof rngOrOptions === "function"
        ? (maybeOptions || {})
        : (rngOrOptions || {});
    const context = strategy?.model?.costContext || model?.costContext || {};
    return { model, rng, options, context };
}

function resolveTrialCostParameters(context, options = {}) {
    const markup = toFiniteNumber(options.markupMultiplier, context.markupMultiplier ?? 1);
    const stepCost = toNonNegativeNumber(options.stepCost, context.stepCost ?? 0);
    const laborPerAction = toNonNegativeNumber(options.laborPerAction, context.laborPerAction ?? 0);
    const protectionCost = toNonNegativeNumber(options.protectionCost, context.protectionCost ?? 0);
    const startingItemCost = options.startingItemCost != null
        ? toNonNegativeNumber(options.startingItemCost, 0)
        : context.startingItem?.available
            ? toNonNegativeNumber(context.startingItem.price, 0)
            : 0;
    return {
        markup,
        stepCost,
        laborPerAction,
        protectionCost,
        startingItemCost,
        materialCostPerAction: toNonNegativeNumber(context.materialCostPerAction, 0),
        coinPerAction: toNonNegativeNumber(context.coinPerAction, 0),
    };
}

function buildCompletedTrial(model, costParameters, actions, protections, experience, finalLevel) {
    const {
        markup,
        stepCost,
        laborPerAction,
        protectionCost,
        startingItemCost,
        materialCostPerAction,
        coinPerAction,
    } = costParameters;
    const rawIncrementalCost = actions * (stepCost + laborPerAction) + protections * protectionCost;
    const seconds = actions * model.bonuses.actionSeconds;
    return {
        exceeded: false,
        transitions: actions,
        actions,
        protections,
        experience,
        seconds,
        experiencePerHour: seconds > 0 ? experience * 3600 / seconds : 0,
        finalLevel,
        materialCost: actions * materialCostPerAction,
        coinCost: actions * coinPerAction,
        laborCost: actions * laborPerAction,
        protectionMaterialCost: protections * protectionCost,
        rawIncrementalCost,
        incrementalCost: rawIncrementalCost * markup,
        totalCost: (startingItemCost + rawIncrementalCost) * markup,
    };
}

export function runEnhancementTrial(input, rngOrOptions, maybeOptions) {
    const { model, rng, options, context } = normalizeTrialArguments(input, rngOrOptions, maybeOptions);
    if (!model?.outcomes?.length) {
        throw new Error("A valid enhancement transition model is required.");
    }
    if (context?.materialPricesAvailable === false && options.stepCost == null) {
        throw new Error("A price is required for every enhancement material.");
    }
    if (
        (context?.incrementalCostAvailable === false || context?.costAvailable === false)
        && options.protectionCost == null
    ) {
        throw new Error("A priced protection item is required for cost analysis.");
    }
    if (context?.startingItem?.available === false && options.startingItemCost == null) {
        throw new Error("A direct market quote or price override is required for the starting enhancement level.");
    }
    const maxTransitions = Math.max(1, toInteger(options.maxTransitions, MONTE_CARLO_HARD_TRANSITION_LIMIT));
    const costParameters = resolveTrialCostParameters(context, options);
    let currentLevel = model.startLevel;
    let actions = 0;
    let protections = 0;
    let experience = 0;

    while (currentLevel < model.targetLevel) {
        if (actions >= maxTransitions) {
            return {
                exceeded: true,
                transitions: actions,
                actions,
                protections,
                experience,
                finalLevel: currentLevel,
            };
        }
        const randomValue = clamp(toFiniteNumber(rng(), 0), 0, 1 - Number.EPSILON);
        const outcome = chooseOutcome(model.outcomes[currentLevel], randomValue);
        actions += 1;
        experience += outcome.experience;
        if (outcome.usesProtection) {
            protections += 1;
        }
        currentLevel = outcome.toLevel;
    }

    return buildCompletedTrial(
        model,
        costParameters,
        actions,
        protections,
        experience,
        currentLevel
    );
}

function percentileIndex(length, percentile) {
    return clamp(Math.ceil((percentile / 100) * length) - 1, 0, Math.max(0, length - 1));
}

export function summarizeMonteCarloTrials(trials, options = {}) {
    const validTrials = (Array.isArray(trials) ? trials : [])
        .filter((trial) => trial && !trial.exceeded && Number.isFinite(trial.totalCost))
        .slice()
        .sort((left, right) => left.totalCost - right.totalCost);
    const percentiles = normalizePercentiles(options.percentiles);
    const quantiles = {};
    for (const percentile of percentiles) {
        const selected = validTrials[percentileIndex(validTrials.length, percentile)] || null;
        quantiles[String(percentile)] = selected ? { ...selected } : null;
    }
    const budget = options.budget == null ? null : toNonNegativeNumber(options.budget, 0);
    const budgetProbability = budget == null || validTrials.length === 0
        ? null
        : validTrials.filter((trial) => trial.totalCost <= budget).length / validTrials.length;
    const mean = validTrials.length === 0
        ? 0
        : validTrials.reduce((sum, trial) => sum + trial.totalCost, 0) / validTrials.length;
    const variance = validTrials.length <= 1
        ? 0
        : validTrials.reduce((sum, trial) => sum + (trial.totalCost - mean) ** 2, 0) / validTrials.length;
    return {
        method: "monte_carlo",
        approximate: false,
        mean,
        variance,
        standardDeviation: Math.sqrt(variance),
        quantiles,
        budgetProbability,
        actualSamples: validTrials.length,
    };
}

function findOriginalQuantileIndex(totalCosts, length, sortedCosts, sortedIndex) {
    const selectedCost = sortedCosts[sortedIndex];
    let occurrence = 0;
    for (let index = sortedIndex - 1; index >= 0 && sortedCosts[index] === selectedCost; index -= 1) {
        occurrence += 1;
    }
    for (let index = 0; index < length; index += 1) {
        if (totalCosts[index] !== selectedCost) {
            continue;
        }
        if (occurrence === 0) {
            return index;
        }
        occurrence -= 1;
    }
    return -1;
}

export function createMonteCarloTrialAccumulator(input, options = {}) {
    const model = input?.model || input;
    const context = input?.model ? input.model?.costContext || {} : model?.costContext || {};
    if (!model?.outcomes?.length) {
        throw new Error("A valid enhancement transition model is required.");
    }
    const capacity = clamp(
        toInteger(options.sampleCount ?? input?.config?.sampleCount, DEFAULT_MONTE_CARLO_SAMPLES),
        1,
        1_000_000
    );
    const costParameters = resolveTrialCostParameters(context, options);
    const totalCosts = new Float64Array(capacity);
    const actionCounts = new Uint32Array(capacity);
    const protectionCounts = new Uint32Array(capacity);
    const experiences = new Float64Array(capacity);
    let length = 0;

    function add(trial) {
        if (!trial || trial.exceeded || !Number.isFinite(trial.totalCost)) {
            throw new Error("Only completed finite enhancement trials can be summarized.");
        }
        if (length >= capacity) {
            throw new RangeError("Monte Carlo trial accumulator capacity was exceeded.");
        }
        totalCosts[length] = trial.totalCost;
        actionCounts[length] = clamp(toInteger(trial.actions, 0), 0, 0xFFFFFFFF);
        protectionCounts[length] = clamp(toInteger(trial.protections, 0), 0, 0xFFFFFFFF);
        experiences[length] = toFiniteNumber(trial.experience, 0);
        length += 1;
    }

    function trialAt(index) {
        if (index < 0 || index >= length) {
            return null;
        }
        return {
            ...buildCompletedTrial(
                model,
                costParameters,
                actionCounts[index],
                protectionCounts[index],
                experiences[index],
                model.targetLevel
            ),
            totalCost: totalCosts[index],
        };
    }

    function summarize(summaryOptions = options) {
        const percentiles = normalizePercentiles(summaryOptions.percentiles);
        const quantiles = {};
        const sortedCosts = totalCosts.slice(0, length).sort();
        for (const percentile of percentiles) {
            if (length === 0) {
                quantiles[String(percentile)] = null;
                continue;
            }
            const sortedIndex = percentileIndex(length, percentile);
            const originalIndex = findOriginalQuantileIndex(totalCosts, length, sortedCosts, sortedIndex);
            quantiles[String(percentile)] = trialAt(originalIndex);
        }

        const budget = summaryOptions.budget == null
            ? null
            : toNonNegativeNumber(summaryOptions.budget, 0);
        let total = 0;
        let budgetMatches = 0;
        for (let index = 0; index < length; index += 1) {
            total += totalCosts[index];
            if (budget != null && totalCosts[index] <= budget) {
                budgetMatches += 1;
            }
        }
        const mean = length === 0 ? 0 : total / length;
        let squaredDifferenceTotal = 0;
        for (let index = 0; index < length; index += 1) {
            squaredDifferenceTotal += (totalCosts[index] - mean) ** 2;
        }
        const variance = length <= 1 ? 0 : squaredDifferenceTotal / length;
        return {
            method: "monte_carlo",
            approximate: false,
            mean,
            variance,
            standardDeviation: Math.sqrt(variance),
            quantiles,
            budgetProbability: budget == null || length === 0 ? null : budgetMatches / length,
            actualSamples: length,
        };
    }

    return {
        add,
        summarize,
        trialAt,
        get length() {
            return length;
        },
        get capacity() {
            return capacity;
        },
        get storageByteLength() {
            return totalCosts.byteLength
                + actionCounts.byteLength
                + protectionCounts.byteLength
                + experiences.byteLength;
        },
    };
}

export function runMonteCarloTrials(input, options = {}) {
    const model = input?.model || input;
    const sampleCount = clamp(
        toInteger(options.sampleCount ?? input?.config?.sampleCount, DEFAULT_MONTE_CARLO_SAMPLES),
        1,
        1_000_000
    );
    const seed = options.seed ?? input?.config?.seed ?? 1;
    const random = typeof options.random === "function" ? options.random : createSeededRandom(seed);
    const hardTransitionLimit = Math.max(
        1,
        toInteger(options.hardTransitionLimit, MONTE_CARLO_HARD_TRANSITION_LIMIT)
    );
    const includeTrials = options.includeTrials !== false;
    const trials = includeTrials ? [] : null;
    const compactTrials = includeTrials
        ? null
        : createMonteCarloTrialAccumulator(input, { ...options, sampleCount });
    let completed = 0;
    let transitions = 0;
    let exceeded = false;
    let cancelled = false;

    for (let index = 0; index < sampleCount; index += 1) {
        if (typeof options.shouldCancel === "function" && options.shouldCancel()) {
            cancelled = true;
            break;
        }
        const remaining = hardTransitionLimit - transitions;
        if (remaining <= 0) {
            exceeded = true;
            break;
        }
        const trial = runEnhancementTrial(input, random, {
            ...options,
            maxTransitions: remaining,
        });
        transitions += trial.transitions;
        if (trial.exceeded) {
            exceeded = true;
            break;
        }
        if (includeTrials) {
            trials.push(trial);
        } else {
            compactTrials.add(trial);
        }
        completed += 1;
        if (typeof options.onProgress === "function") {
            options.onProgress({ completed, total: sampleCount, transitions });
        }
    }

    const summary = includeTrials
        ? summarizeMonteCarloTrials(trials, options)
        : compactTrials.summarize(options);
    return {
        ...summary,
        seed,
        sampleCount,
        actualSamples: completed,
        transitions,
        exceeded,
        cancelled,
        trials: includeTrials ? trials : undefined,
        estimatedTransitions: toFiniteNumber(options.estimatedTransitions, 0),
    };
}

export function analyzeEnhancementRisk(strategy, options = {}) {
    const sampleCount = clamp(
        toInteger(options.sampleCount ?? strategy?.config?.sampleCount, DEFAULT_MONTE_CARLO_SAMPLES),
        1,
        1_000_000
    );
    const estimatedTransitions = strategy.expectedActions * sampleCount;
    const seed = options.seed ?? strategy?.config?.seed ?? 1;
    const budget = options.budget ?? strategy?.config?.budget;
    const moments = calculateStrategyCostMoments(strategy);
    const initialOffset = strategy.startingItem?.available
        ? strategy.startingItem.price * strategy.markupMultiplier
        : 0;
    if (estimatedTransitions >= toFiniteNumber(options.loadThreshold, MONTE_CARLO_LOAD_THRESHOLD)) {
        return {
            ...fitGammaRisk(moments, { ...options, budget, seed, offset: initialOffset }),
            estimatedTransitions,
            fallbackReason: "estimated_load",
        };
    }
    const simulation = runMonteCarloTrials(strategy, {
        ...options,
        sampleCount,
        seed,
        budget,
        estimatedTransitions,
    });
    if (simulation.exceeded) {
        return {
            ...fitGammaRisk(moments, { ...options, budget, seed, offset: initialOffset }),
            estimatedTransitions,
            transitions: simulation.transitions,
            actualSamples: simulation.actualSamples,
            fallbackReason: "hard_transition_limit",
        };
    }
    return simulation;
}

function normalizeDirectPlans(rawPlans) {
    if (Array.isArray(rawPlans)) {
        return Object.fromEntries(rawPlans.map((plan, level) => [level, plan]));
    }
    return rawPlans && typeof rawPlans === "object" ? rawPlans : {};
}

function directPlanCost(plan) {
    if (typeof plan === "number") {
        return toNonNegativeNumber(plan, Infinity);
    }
    return toNonNegativeNumber(plan?.cost ?? plan?.totalCost ?? plan?.totalInvestment, Infinity);
}

function directRequirementKey(itemHrid, level) {
    return itemHrid ? `${itemHrid}@${level}` : String(level);
}

function createDirectRequirements(itemHrid, level, directPlan, unitCost) {
    const key = directRequirementKey(itemHrid, level);
    return {
        [key]: {
            type: "direct",
            itemHrid,
            level,
            count: 1,
            unitCost,
            directPlan,
        },
    };
}

function addDirectRequirements(left, right) {
    const result = {};
    for (const source of [left, right]) {
        for (const [key, requirement] of Object.entries(source || {})) {
            const count = toNonNegativeNumber(requirement?.count, 0);
            if (result[key]) {
                result[key].count += count;
            } else {
                result[key] = { ...requirement, count };
            }
        }
    }
    return result;
}

function requirementCounts(requirements) {
    return Object.fromEntries(
        Object.entries(requirements || {}).map(([key, requirement]) => [key, requirement.count])
    );
}

export function planPhilosophersMirror(rawPlans, rawOptions = {}) {
    let options = rawOptions;
    let plansInput = rawPlans;
    if (rawPlans && !Array.isArray(rawPlans) && rawPlans.directPlans) {
        options = rawPlans;
        plansInput = rawPlans.directPlans;
    }
    const directPlans = normalizeDirectPlans(plansInput);
    const inferredTarget = Math.max(0, ...Object.keys(directPlans).map((key) => toInteger(key, 0)));
    const targetLevel = clamp(toInteger(options.targetLevel, inferredTarget), 0, 20);
    const rawMirrorPrice = Number(options.mirrorPrice);
    const mirrorPrice = rawMirrorPrice === Infinity
        ? Infinity
        : toNonNegativeNumber(rawMirrorPrice, 0);
    const mirrorActionCost = toNonNegativeNumber(options.mirrorActionCost, 0);
    const itemHrid = normalizeHrid(options.itemHrid);
    const baseItemHrid = normalizeHrid(options.baseItemHrid) || itemHrid;
    const basePlan = Array.isArray(options.basePlan?.levels) ? options.basePlan : null;
    const levels = [];

    for (let level = 0; level <= targetLevel; level += 1) {
        const directPlan = directPlans[level];
        const directCost = directPlanCost(directPlan);
        const directRequirements = createDirectRequirements(itemHrid, level, directPlan, directCost);
        let selected = {
            level,
            cost: directCost,
            method: "direct",
            directPlan,
            directRequirements,
            directPlanCounts: requirementCounts(directRequirements),
            mirrorCount: 0,
            mirrorItemCost: 0,
            mirrorLaborCost: 0,
        };
        const lowerBasePlan = level >= 2
            ? basePlan?.levels?.[level - 2] || levels[level - 2]
            : null;
        if (level >= 2 && lowerBasePlan && levels[level - 1]) {
            const mirrorCost = lowerBasePlan.cost
                + levels[level - 1].cost
                + mirrorPrice
                + mirrorActionCost;
            if (mirrorCost < directCost) {
                const combinedRequirements = addDirectRequirements(
                    lowerBasePlan.directRequirements,
                    levels[level - 1].directRequirements
                );
                selected = {
                    level,
                    cost: mirrorCost,
                    method: "mirror",
                    directPlan: null,
                    directRequirements: combinedRequirements,
                    directPlanCounts: requirementCounts(combinedRequirements),
                    mirrorCount: lowerBasePlan.mirrorCount + levels[level - 1].mirrorCount + 1,
                    mirrorItemCost: lowerBasePlan.mirrorItemCost
                        + levels[level - 1].mirrorItemCost
                        + mirrorPrice,
                    mirrorLaborCost: lowerBasePlan.mirrorLaborCost
                        + levels[level - 1].mirrorLaborCost
                        + mirrorActionCost,
                    inputs: [level - 2, level - 1],
                    baseInput: { itemHrid: baseItemHrid, level: level - 2 },
                    primaryInput: { itemHrid, level: level - 1 },
                };
            }
        }
        levels.push(selected);
    }

    const target = levels[targetLevel];
    const requirements = Object.values(target?.directRequirements || {})
        .filter((requirement) => requirement.count > 0)
        .map(({ directPlan, ...requirement }) => ({
            ...requirement,
            totalCost: requirement.unitCost * requirement.count,
        }));
    if ((target?.mirrorCount || 0) > 0) {
        const mirrorTotalCost = target.mirrorItemCost + target.mirrorLaborCost;
        requirements.push({
            type: "mirror",
            itemHrid: options.mirrorItemHrid || "/items/philosophers_mirror",
            count: target.mirrorCount,
            unitCost: mirrorTotalCost / target.mirrorCount,
            itemUnitCost: mirrorPrice,
            actionUnitCost: target.mirrorLaborCost / target.mirrorCount,
            totalCost: mirrorTotalCost,
        });
    }
    return {
        targetLevel,
        itemHrid,
        baseItemHrid,
        mirrorPrice,
        mirrorActionCost,
        mirrorLaborCost: target?.mirrorLaborCost || 0,
        levels,
        target,
        cost: target?.cost ?? Infinity,
        method: target?.method || "direct",
        requirements,
    };
}

export function calculateDecompositionValue(input = {}, enhancementData = {}, pricing = {}) {
    const item = input.item
        || findByHrid(enhancementData?.enhanceableItems, input.itemHrid)
        || {};
    const itemLevel = Math.max(1, toInteger(input.itemLevel ?? item.itemLevel, 1));
    const targetLevel = clamp(toInteger(input.targetLevel ?? input.enhancementLevel, 0), 0, 20);
    const essenceItemHrid = input.essenceItemHrid || "/items/enhancing_essence";
    const resolvedPrice = input.essenceBid == null
        ? resolveEnhancementPrice(pricing, essenceItemHrid, {
            mode: "bid",
            overrides: input.priceOverrides,
            sources: ["bid", "vendor"],
        })
        : { price: toNonNegativeNumber(input.essenceBid, 0), source: "override", available: true };
    const essenceCount = Math.floor(Math.round(
        2 * (0.5 + 0.1 * (1.05 ** itemLevel)) * (2 ** targetLevel)
    ));
    const grossValue = essenceCount * toNonNegativeNumber(resolvedPrice.price, 0);
    const returnRate = clamp(toFiniteNumber(input.returnRate, 0.78), 0, 1);
    return {
        itemLevel,
        targetLevel,
        essenceItemHrid,
        essenceCount,
        essenceBid: resolvedPrice.price,
        priceSource: resolvedPrice.source,
        priceAvailable: resolvedPrice.available,
        grossValue,
        returnRate,
        value: grossValue * returnRate,
    };
}

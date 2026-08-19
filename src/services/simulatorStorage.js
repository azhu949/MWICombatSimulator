import {
    actionDetailIndex,
    getActionName as getIndexedActionName,
    getMonsterName as getIndexedMonsterName,
    monsterDetailIndex,
} from "../shared/gameDataIndex.js";
import { EQUIPMENT_SLOT_KEYS, LEVEL_KEYS } from "../shared/playerConfig.js";
import { normalizeCombatScrolls } from "../shared/combatScrolls.js";
import {
    createDefaultPriceTable,
    normalizePriceMode,
    PRICE_MODE_ASK,
    PRICE_MODE_BID,
} from "./marketPriceService.js";
import {
    getDefaultQueueRuntimeSettings,
    normalizeQueueRuntimeSettings,
    normalizeQueueSettings,
} from "./queueScoring.js";
import { normalizeEquipmentSetQueueChanges } from "./queueVariants.js";
import { getVendorPriceByItemHrid } from "./queueUpgradeCost.js";
import { clamp, clampPositiveInteger, deepClone, isPlainObject, toFiniteNumber } from "./utils.js";

const EQUIPMENT_SET_STORAGE_KEY = "mwi.equipmentSets.v2";
const PRICE_SETTINGS_STORAGE_KEY = "mwi.price.settings.v1";
const PRICE_MARKET_CACHE_STORAGE_KEY = "mwi.price.marketCache.v1";
const SIMULATION_UI_STORAGE_KEY = "mwi.simulation.ui.v1";
const QUEUE_SETTINGS_STORAGE_KEY = "mwi.queue.settings.v1";
const QUEUE_SETTINGS_STORAGE_VERSION = 1;
const QUEUE_RUN_SETTINGS_STORAGE_KEY = "mwi.queue.runSettings.v1";
const QUEUE_RUN_SETTINGS_STORAGE_VERSION = 1;
const PLAYER_DATA_SNAPSHOT_STORAGE_KEY = "mwi.player.data.snapshot.v1";
const PLAYER_DATA_SNAPSHOT_STORAGE_VERSION = 1;
const PLAYER_ACHIEVEMENTS_STORAGE_KEY = "mwi.player.achievements.v1";
const PLAYER_ACHIEVEMENTS_STORAGE_VERSION = 1;
const QUEUE_PLAYER_IDS = ["1", "2", "3", "4", "5"];

function hasJsonStorageChanged(before, after) {
    return JSON.stringify(before) !== JSON.stringify(after);
}

export function getLocalStorage(storage) {
    if (storage !== undefined) {
        return storage || null;
    }
    try {
        return globalThis?.localStorage || null;
    } catch (error) {
        return null;
    }
}

export function isLocalStorageAvailable(storage) {
    return Boolean(getLocalStorage(storage));
}

export function createLocalStorageUnavailableError() {
    return new Error("localStorage unavailable");
}

export function readJsonStorage(storageKey, options = {}) {
    const storage = getLocalStorage(options.storage);
    const fallback = options.fallback ?? {};
    const requirePlainObject = options.requirePlainObject !== false;
    if (!storage) {
        return fallback;
    }

    try {
        const raw = storage.getItem(storageKey);
        if (!raw) {
            return fallback;
        }
        const parsed = JSON.parse(raw);
        if (requirePlainObject && !isPlainObject(parsed)) {
            return fallback;
        }
        return parsed;
    } catch (error) {
        return fallback;
    }
}

export function getStorageItem(storageKey, options = {}) {
    const storage = getLocalStorage(options.storage);
    const fallback = options.fallback ?? null;
    if (!storage) {
        if (options.throwIfUnavailable === true) {
            throw createLocalStorageUnavailableError();
        }
        return fallback;
    }
    try {
        const rawValue = storage.getItem(storageKey);
        if (rawValue == null || rawValue === "") {
            return fallback;
        }
        return rawValue;
    } catch (error) {
        if (options.throwIfUnavailable === true) {
            throw error;
        }
        return fallback;
    }
}

export function setJsonStorage(storageKey, value, options = {}) {
    const storage = getLocalStorage(options.storage);
    if (!storage) {
        if (options.throwIfUnavailable === true) {
            throw createLocalStorageUnavailableError();
        }
        return false;
    }
    const serializedValue = JSON.stringify(value);
    try {
        storage.setItem(storageKey, serializedValue);
        return true;
    } catch (error) {
        if (options.throwIfUnavailable === true) {
            throw error;
        }
        return false;
    }
}

export function removeStorageItem(storageKey, options = {}) {
    const storage = getLocalStorage(options.storage);
    if (!storage) {
        if (options.throwIfUnavailable === true) {
            throw createLocalStorageUnavailableError();
        }
        return false;
    }
    try {
        storage.removeItem(storageKey);
        return true;
    } catch (error) {
        if (options.throwIfUnavailable === true) {
            throw error;
        }
        return false;
    }
}

export function normalizeSimulationUiSettings(rawSettings) {
    const source = isPlainObject(rawSettings) ? rawSettings : {};
    return {
        mooPass: Boolean(source.mooPass),
        comExpEnabled: Boolean(source.comExpEnabled),
        comExp: clamp(Math.floor(toFiniteNumber(source.comExp, 20)), 1, 99),
        comDropEnabled: Boolean(source.comDropEnabled),
        comDrop: clamp(Math.floor(toFiniteNumber(source.comDrop, 20)), 1, 99),
        combatScrollsEnabled: Boolean(source.combatScrollsEnabled),
        enableHpMpVisualization: Boolean(source.enableHpMpVisualization),
    };
}

export function loadSimulationUiSettingsFromStorage() {
    const stored = readJsonStorage(SIMULATION_UI_STORAGE_KEY);
    return normalizeSimulationUiSettings({
        mooPass: true,
        comExpEnabled: true,
        comDropEnabled: true,
        combatScrollsEnabled: false,
        enableHpMpVisualization: true,
        ...stored,
    });
}

export function persistSimulationUiSettingsToStorage(settings) {
    const normalized = normalizeSimulationUiSettings(settings);
    setJsonStorage(SIMULATION_UI_STORAGE_KEY, normalized);
}

export function normalizeAchievementFlags(rawAchievements) {
    const source = isPlainObject(rawAchievements) ? rawAchievements : {};
    const normalized = {};

    for (const [achievementHrid, unlocked] of Object.entries(source)) {
        const normalizedHrid = String(achievementHrid || "").trim();
        if (!normalizedHrid || !Boolean(unlocked)) {
            continue;
        }
        normalized[normalizedHrid] = true;
    }

    return normalized;
}

export function normalizeStoredPlayerAchievementsMap(rawPlayerAchievements) {
    const source = isPlainObject(rawPlayerAchievements) ? rawPlayerAchievements : {};
    const normalized = {};

    for (const playerId of QUEUE_PLAYER_IDS) {
        const normalizedAchievements = normalizeAchievementFlags(source[playerId]);
        if (Object.keys(normalizedAchievements).length > 0) {
            normalized[playerId] = normalizedAchievements;
        }
    }

    return normalized;
}

export function collectPlayerAchievementsById(players) {
    const normalized = {};

    for (const player of players || []) {
        const playerId = String(player?.id || "").trim();
        if (!QUEUE_PLAYER_IDS.includes(playerId)) {
            continue;
        }

        const achievements = normalizeAchievementFlags(player?.achievements);
        if (Object.keys(achievements).length > 0) {
            normalized[playerId] = achievements;
        }
    }

    return normalized;
}

export function loadPlayerAchievementsFromStorage() {
    const payload = readJsonStorage(PLAYER_ACHIEVEMENTS_STORAGE_KEY);
    if (payload.version != null && Number(payload.version) !== PLAYER_ACHIEVEMENTS_STORAGE_VERSION) {
        return {};
    }

    const sourceMap = isPlainObject(payload.achievementsByPlayer)
        ? payload.achievementsByPlayer
        : payload;

    return normalizeStoredPlayerAchievementsMap(sourceMap);
}

export function persistPlayerAchievementsToStorage(players) {
    const achievementsByPlayer = collectPlayerAchievementsById(players);
    if (Object.keys(achievementsByPlayer).length <= 0) {
        removeStorageItem(PLAYER_ACHIEVEMENTS_STORAGE_KEY);
        return;
    }

    setJsonStorage(PLAYER_ACHIEVEMENTS_STORAGE_KEY, {
        version: PLAYER_ACHIEVEMENTS_STORAGE_VERSION,
        achievementsByPlayer,
    });
}

export function clearPlayerAchievementsFromStorage() {
    removeStorageItem(PLAYER_ACHIEVEMENTS_STORAGE_KEY);
}

export function applyPersistedAchievementsToPlayers(players, achievementsByPlayer) {
    const normalizedAchievementsByPlayer = normalizeStoredPlayerAchievementsMap(achievementsByPlayer);
    return (players || []).map((player) => {
        const playerId = String(player?.id || "").trim();
        return {
            ...player,
            achievements: deepClone(normalizedAchievementsByPlayer[playerId] ?? {}),
        };
    });
}

export function normalizePriceOverrideValue(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return null;
    }
    return parsed;
}

export function normalizePriceOverrideMap(rawOverrides) {
    const source = isPlainObject(rawOverrides) ? rawOverrides : {};
    const normalized = {};

    for (const [rawHrid, rawEntry] of Object.entries(source)) {
        const hrid = String(rawHrid || "");
        if (!hrid || !isPlainObject(rawEntry)) {
            continue;
        }

        const entry = {};
        const ask = normalizePriceOverrideValue(rawEntry.ask);
        const bid = normalizePriceOverrideValue(rawEntry.bid);

        if (ask !== null) {
            entry.ask = ask;
        }
        if (bid !== null) {
            entry.bid = bid;
        }

        if (Object.keys(entry).length > 0) {
            normalized[hrid] = entry;
        }
    }

    return normalized;
}

export function normalizeEnhancementQuotesByItem(rawQuotes) {
    const source = isPlainObject(rawQuotes) ? rawQuotes : {};
    const normalized = {};

    for (const [rawHrid, rawLevelMap] of Object.entries(source)) {
        const hrid = String(rawHrid || "");
        if (!hrid || !isPlainObject(rawLevelMap)) {
            continue;
        }

        const quoteMap = {};
        for (const [rawLevel, rawQuote] of Object.entries(rawLevelMap)) {
            const level = Math.floor(toFiniteNumber(rawLevel, -1));
            if (!Number.isFinite(level) || level < 0 || !isPlainObject(rawQuote)) {
                continue;
            }

            const ask = toFiniteNumber(rawQuote?.ask, -1);
            const bid = toFiniteNumber(rawQuote?.bid, -1);
            const averagePrice = toFiniteNumber(rawQuote?.averagePrice, -1);
            const volume = toFiniteNumber(rawQuote?.volume, 0);
            if (ask < 0 && bid < 0 && !(averagePrice > 0 && volume > 0)) {
                continue;
            }

            quoteMap[String(level)] = {
                ask,
                bid,
                averagePrice,
                volume,
            };
        }

        if (Object.keys(quoteMap).length > 0) {
            normalized[hrid] = quoteMap;
        }
    }

    return normalized;
}

export function normalizeEnhancementLevelsByItem(rawLevels) {
    const source = isPlainObject(rawLevels) ? rawLevels : {};
    const normalized = {};

    for (const [rawHrid, rawLevelList] of Object.entries(source)) {
        const hrid = String(rawHrid || "");
        if (!hrid || !Array.isArray(rawLevelList)) {
            continue;
        }

        const levels = Array.from(new Set(rawLevelList
            .map((value) => Math.floor(toFiniteNumber(value, -1)))
            .filter((value) => Number.isFinite(value) && value > 0)))
            .sort((a, b) => a - b);

        if (levels.length > 0) {
            normalized[hrid] = levels;
        }
    }

    return normalized;
}

export function cloneBasePriceTable(basePriceTable) {
    const source = isPlainObject(basePriceTable) ? basePriceTable : {};
    const clone = {};

    for (const [rawHrid, rawEntry] of Object.entries(source)) {
        const hrid = String(rawHrid || "");
        if (!hrid) {
            continue;
        }

        clone[hrid] = {
            ask: toFiniteNumber(rawEntry?.ask, -1),
            bid: toFiniteNumber(rawEntry?.bid, -1),
            vendor: Math.max(0, toFiniteNumber(rawEntry?.vendor, getVendorPriceByItemHrid(hrid))),
        };
    }

    return clone;
}

export function applyPriceOverridesToTable(basePriceTable, overrides) {
    const table = cloneBasePriceTable(basePriceTable);
    const normalizedOverrides = normalizePriceOverrideMap(overrides);

    for (const [hrid, overrideEntry] of Object.entries(normalizedOverrides)) {
        const targetEntry = table[hrid] || {
            ask: -1,
            bid: -1,
            vendor: getVendorPriceByItemHrid(hrid),
        };

        if (Object.prototype.hasOwnProperty.call(overrideEntry, "ask")) {
            targetEntry.ask = overrideEntry.ask;
        }
        if (Object.prototype.hasOwnProperty.call(overrideEntry, "bid")) {
            targetEntry.bid = overrideEntry.bid;
        }

        table[hrid] = targetEntry;
    }

    return table;
}

export function rehydratePricingTable(pricingState) {
    const source = pricingState && typeof pricingState === "object" ? pricingState : {};
    source.priceTable = applyPriceOverridesToTable(source.basePriceTable, source.overrides);
}

export function normalizePricingSettings(raw) {
    const source = isPlainObject(raw) ? raw : {};
    return {
        consumableMode: normalizePriceMode(source.consumableMode, PRICE_MODE_ASK),
        dropMode: normalizePriceMode(source.dropMode, PRICE_MODE_BID),
        overrides: normalizePriceOverrideMap(source.overrides),
    };
}

export function normalizeMarketCachePayload(raw) {
    const source = isPlainObject(raw) ? raw : {};
    return {
        basePriceTable: cloneBasePriceTable(source.basePriceTable),
        enhancementQuotesByItem: normalizeEnhancementQuotesByItem(source.enhancementQuotesByItem),
        enhancementLevelsByItem: normalizeEnhancementLevelsByItem(source.enhancementLevelsByItem),
        marketTimestamp: Math.max(0, toFiniteNumber(source.marketTimestamp, 0)),
        lastFetchedAt: Math.max(0, toFiniteNumber(source.lastFetchedAt, 0)),
        sourceUrl: String(source.sourceUrl || ""),
    };
}

export function loadMarketCacheFromStorage() {
    const payload = normalizeMarketCachePayload(readJsonStorage(PRICE_MARKET_CACHE_STORAGE_KEY));
    if (Object.keys(payload.basePriceTable).length === 0 || payload.lastFetchedAt <= 0) {
        return null;
    }
    return payload;
}

export function persistMarketCacheToStorage(cachePayload) {
    const normalized = normalizeMarketCachePayload(cachePayload);
    setJsonStorage(PRICE_MARKET_CACHE_STORAGE_KEY, normalized);
}

export function clearMarketCacheFromStorage() {
    removeStorageItem(PRICE_MARKET_CACHE_STORAGE_KEY);
}

export function loadPricingSettingsFromStorage() {
    const parsed = readJsonStorage(PRICE_SETTINGS_STORAGE_KEY);
    return normalizePricingSettings(parsed);
}

export function persistPricingSettingsToStorage(settings) {
    const normalized = normalizePricingSettings(settings);
    setJsonStorage(PRICE_SETTINGS_STORAGE_KEY, normalized);
}

export function createPricingState() {
    const settings = loadPricingSettingsFromStorage();
    const cachedMarket = loadMarketCacheFromStorage();
    const basePriceTable = cachedMarket?.basePriceTable || createDefaultPriceTable();
    return {
        consumableMode: settings.consumableMode,
        dropMode: settings.dropMode,
        overrides: settings.overrides,
        basePriceTable,
        priceTable: applyPriceOverridesToTable(basePriceTable, settings.overrides),
        enhancementQuotesByItem: normalizeEnhancementQuotesByItem(cachedMarket?.enhancementQuotesByItem),
        enhancementLevelsByItem: normalizeEnhancementLevelsByItem(cachedMarket?.enhancementLevelsByItem),
        marketTimestamp: Number(cachedMarket?.marketTimestamp || 0),
        lastFetchedAt: Number(cachedMarket?.lastFetchedAt || 0),
        sourceUrl: String(cachedMarket?.sourceUrl || ""),
        isLoading: false,
        error: "",
    };
}

export function createProfitPricingOptions(pricingState) {
    return {
        consumableMode: normalizePriceMode(pricingState?.consumableMode, PRICE_MODE_ASK),
        dropMode: normalizePriceMode(pricingState?.dropMode, PRICE_MODE_BID),
        priceTable: pricingState?.priceTable ?? null,
    };
}

export function loadQueueRuntimeSettingsFromStorage() {
    const defaults = getDefaultQueueRuntimeSettings();
    if (!isLocalStorageAvailable()) {
        return defaults;
    }

    try {
        const rawValue = getStorageItem(QUEUE_SETTINGS_STORAGE_KEY);
        if (!rawValue) {
            return defaults;
        }

        const parsed = JSON.parse(rawValue);
        if (!isPlainObject(parsed) || parsed.version !== QUEUE_SETTINGS_STORAGE_VERSION) {
            return defaults;
        }

        return normalizeQueueRuntimeSettings({
            finalWeights: parsed.finalWeights,
            costScoreGoldPerPointMode: parsed.costScoreGoldPerPointMode,
            parallelWorkerLimit: parsed.parallelWorkerLimit,
        });
    } catch (error) {
        return defaults;
    }
}

export function persistQueueRuntimeSettingsToStorage(settings) {
    const normalized = normalizeQueueRuntimeSettings(settings);
    const payload = {
        version: QUEUE_SETTINGS_STORAGE_VERSION,
        savedAt: Date.now(),
        finalWeights: {
            ...normalized.finalWeights,
        },
        costScoreGoldPerPointMode: normalized.costScoreGoldPerPointMode,
        parallelWorkerLimit: normalized.parallelWorkerLimit,
    };
    setJsonStorage(QUEUE_SETTINGS_STORAGE_KEY, payload, { throwIfUnavailable: true });
    return normalized;
}

export function loadQueueRunSettingsByPlayerFromStorage() {
    if (!isLocalStorageAvailable()) {
        return {};
    }

    try {
        const rawValue = getStorageItem(QUEUE_RUN_SETTINGS_STORAGE_KEY);
        if (!rawValue) {
            return {};
        }

        const parsed = JSON.parse(rawValue);
        if (!isPlainObject(parsed) || parsed.version !== QUEUE_RUN_SETTINGS_STORAGE_VERSION) {
            return {};
        }

        const normalized = {};
        for (const playerId of QUEUE_PLAYER_IDS) {
            if (!isPlainObject(parsed.byPlayer?.[playerId])) {
                continue;
            }
            normalized[playerId] = normalizeQueueSettings(parsed.byPlayer[playerId]);
        }
        return normalized;
    } catch (error) {
        return {};
    }
}

export function persistQueueRunSettingsByPlayerToStorage(queueStateByPlayer = {}) {
    const byPlayer = {};
    for (const playerId of QUEUE_PLAYER_IDS) {
        byPlayer[playerId] = normalizeQueueSettings(queueStateByPlayer?.[playerId]?.settings);
    }

    const payload = {
        version: QUEUE_RUN_SETTINGS_STORAGE_VERSION,
        savedAt: Date.now(),
        byPlayer,
    };
    setJsonStorage(QUEUE_RUN_SETTINGS_STORAGE_KEY, payload, { throwIfUnavailable: true });
    return byPlayer;
}

export function snapshotPlayerDataMap(rawPlayerDataMap) {
    const result = {};
    for (const playerId of QUEUE_PLAYER_IDS) {
        const sourceValue = rawPlayerDataMap?.[playerId];
        result[playerId] = typeof sourceValue === "string" ? sourceValue : "";
    }
    return result;
}

function hasAnyTruthyValue(source) {
    if (!isPlainObject(source)) {
        return false;
    }
    return Object.values(source).some((value) => Boolean(value));
}

function hasMeaningfulModernPlayerData(player) {
    if (!isPlainObject(player)) {
        return false;
    }

    for (const key of LEVEL_KEYS) {
        if (toFiniteNumber(player?.levels?.[key], 1) > 1) {
            return true;
        }
    }

    for (const slot of EQUIPMENT_SLOT_KEYS) {
        const itemHrid = String(player?.equipment?.[slot]?.itemHrid || "");
        const enhancementLevel = toFiniteNumber(player?.equipment?.[slot]?.enhancementLevel, 0);
        if (itemHrid || enhancementLevel > 0) {
            return true;
        }
    }

    if ((player.food || []).some((itemHrid) => String(itemHrid || "").trim().length > 0)) {
        return true;
    }
    if ((player.drinks || []).some((itemHrid) => String(itemHrid || "").trim().length > 0)) {
        return true;
    }
    if ((player.abilities || []).some((entry) => String(entry?.abilityHrid || "").trim().length > 0 || toFiniteNumber(entry?.level, 1) > 1)) {
        return true;
    }

    if (isPlainObject(player.triggerMap) && Object.keys(player.triggerMap).length > 0) {
        return true;
    }
    if (isPlainObject(player.houseRooms) && Object.values(player.houseRooms).some((value) => toFiniteNumber(value, 0) > 0)) {
        return true;
    }
    if (isPlainObject(player.guildBuffs) && Object.values(player.guildBuffs).some((value) => toFiniteNumber(value, 0) > 0)) {
        return true;
    }
    if (hasAnyTruthyValue(player.achievements)) {
        return true;
    }
    if (Object.keys(normalizeCombatScrolls(player.combatScrolls)).length > 0) {
        return true;
    }

    return false;
}

export function hasMeaningfulPlayerSnapshotData(parsedSnapshot) {
    if (!isPlainObject(parsedSnapshot)) {
        return false;
    }

    // modern player-only payload
    if (isPlainObject(parsedSnapshot.levels) || isPlainObject(parsedSnapshot.equipment)) {
        return hasMeaningfulModernPlayerData(parsedSnapshot);
    }

    if (isPlainObject(parsedSnapshot.player)) {
        if (isPlainObject(parsedSnapshot.player.levels) || isPlainObject(parsedSnapshot.player.equipment)) {
            return hasMeaningfulModernPlayerData(parsedSnapshot.player);
        }
    }

    return false;
}

export function normalizeStoredPlayerDataMap(rawPlayerDataMap, allowPartial = true) {
    if (!isPlainObject(rawPlayerDataMap)) {
        return null;
    }

    const result = {};
    let savedCount = 0;
    for (const playerId of QUEUE_PLAYER_IDS) {
        const playerDataValue = rawPlayerDataMap[playerId];
        if (playerDataValue == null || playerDataValue === "") {
            if (allowPartial) {
                continue;
            }
            return null;
        }

        if (typeof playerDataValue !== "string" || playerDataValue.trim().length === 0) {
            if (allowPartial) {
                continue;
            }
            return null;
        }

        try {
            const parsedSnapshot = JSON.parse(playerDataValue);
            if (!hasMeaningfulPlayerSnapshotData(parsedSnapshot)) {
                if (allowPartial) {
                    continue;
                }
                return null;
            }
        } catch (error) {
            if (allowPartial) {
                continue;
            }
            return null;
        }

        result[playerId] = playerDataValue;
        savedCount += 1;
    }

    if (!allowPartial && savedCount !== QUEUE_PLAYER_IDS.length) {
        return null;
    }
    if (savedCount === 0) {
        return null;
    }
    return result;
}

export function upsertPlayerDataSnapshotToStorage(normalizedPlayerDataMap) {
    const normalized = normalizeStoredPlayerDataMap(normalizedPlayerDataMap, true);
    if (!normalized) {
        removeStorageItem(PLAYER_DATA_SNAPSHOT_STORAGE_KEY, { throwIfUnavailable: true });
        return 0;
    }

    const payload = {
        version: PLAYER_DATA_SNAPSHOT_STORAGE_VERSION,
        savedAt: Date.now(),
        playerDataMap: normalized,
    };
    setJsonStorage(PLAYER_DATA_SNAPSHOT_STORAGE_KEY, payload, { throwIfUnavailable: true });
    return payload.savedAt;
}

export function clearPlayerDataSnapshotFromStorage() {
    removeStorageItem(PLAYER_DATA_SNAPSHOT_STORAGE_KEY, { throwIfUnavailable: true });
}

export function loadPlayerDataSnapshotFromStorage() {
    if (!isLocalStorageAvailable()) {
        return { status: "error", savedAt: 0, playerDataMap: {} };
    }

    const rawValue = getStorageItem(PLAYER_DATA_SNAPSHOT_STORAGE_KEY);
    if (!rawValue) {
        return { status: "not_found", savedAt: 0, playerDataMap: {} };
    }

    try {
        const parsed = JSON.parse(rawValue);
        if (!isPlainObject(parsed) || parsed.version !== PLAYER_DATA_SNAPSHOT_STORAGE_VERSION) {
            return { status: "invalid", savedAt: 0, playerDataMap: {} };
        }

        const normalizedPlayerDataMap = normalizeStoredPlayerDataMap(parsed.playerDataMap, true);
        if (!normalizedPlayerDataMap) {
            return { status: "invalid", savedAt: 0, playerDataMap: {} };
        }

        return {
            status: "ok",
            savedAt: toFiniteNumber(parsed.savedAt, 0),
            playerDataMap: normalizedPlayerDataMap,
        };
    } catch (error) {
        return { status: "invalid", savedAt: 0, playerDataMap: {} };
    }
}

export function savePlayerDataSnapshotToStorage(rawPlayerDataMap) {
    const normalizedPlayerDataMap = normalizeStoredPlayerDataMap(snapshotPlayerDataMap(rawPlayerDataMap), true);
    if (!normalizedPlayerDataMap || Object.keys(normalizedPlayerDataMap).length === 0) {
        throw new Error("invalid player data snapshot");
    }
    return upsertPlayerDataSnapshotToStorage(normalizedPlayerDataMap);
}

export function createPlayerDataSnapshotState() {
    const loadResult = loadPlayerDataSnapshotFromStorage();
    if (loadResult.status !== "ok") {
        return {
            savedAt: 0,
            playerDataMap: {},
        };
    }

    return {
        savedAt: Number(loadResult.savedAt || 0),
        playerDataMap: loadResult.playerDataMap || {},
    };
}

function normalizeActionSnapshotValueToHrid(rawValue) {
    const source = String(rawValue || "").trim();
    if (!source) {
        return "";
    }
    if (source.startsWith("/actions/")) {
        return source;
    }

    const normalized = source.toLowerCase();
    for (const action of Object.values(actionDetailIndex || {})) {
        const actionName = String(action?.name || "").trim().toLowerCase();
        if (actionName && actionName === normalized) {
            return String(action?.hrid || source);
        }
    }

    return source;
}

function normalizeMonsterSnapshotValueToHrid(rawValue) {
    const source = String(rawValue || "").trim();
    if (!source) {
        return "";
    }
    if (source.startsWith("/monsters/")) {
        return source;
    }

    const normalized = source.toLowerCase();
    for (const monster of Object.values(monsterDetailIndex || {})) {
        const monsterName = String(monster?.name || "").trim().toLowerCase();
        if (monsterName && monsterName === normalized) {
            return String(monster?.hrid || source);
        }
    }

    return source;
}

export function parsePlayerSnapshotSummary(playerDataJson) {
    try {
        const parsed = JSON.parse(playerDataJson);
        const modernSettings = isPlainObject(parsed?.simulationSettings) ? parsed.simulationSettings : null;
        const zoneHrid = normalizeActionSnapshotValueToHrid(modernSettings?.zoneHrid);
        const dungeonHrid = normalizeActionSnapshotValueToHrid(modernSettings?.dungeonHrid);
        const labyrinthHrid = normalizeMonsterSnapshotValueToHrid(modernSettings?.labyrinthHrid);
        const difficultyRaw = String(modernSettings?.difficultyTier ?? "");
        const difficultyDisplay = difficultyRaw
            ? (difficultyRaw.startsWith("T") ? difficultyRaw : `T${difficultyRaw}`)
            : "-";
        const zoneFallback = String(modernSettings?.zoneHrid || zoneHrid || "-");
        const dungeonFallback = String(modernSettings?.dungeonHrid || dungeonHrid || "-");
        const labyrinthFallback = String(modernSettings?.labyrinthHrid || labyrinthHrid || "-");

        return {
            zoneHrid,
            dungeonHrid,
            labyrinthHrid,
            zone: getIndexedActionName(zoneHrid, zoneFallback),
            dungeon: getIndexedActionName(dungeonHrid, dungeonFallback),
            difficulty: difficultyDisplay,
            simulationTime: String(modernSettings?.simulationTimeHours ?? "-"),
            labyrinth: getIndexedMonsterName(labyrinthHrid, labyrinthFallback),
            roomLevel: String(modernSettings?.roomLevel ?? "-"),
        };
    } catch (error) {
        return {
            zoneHrid: "",
            dungeonHrid: "",
            labyrinthHrid: "",
            zone: "-",
            dungeon: "-",
            difficulty: "-",
            simulationTime: "-",
            labyrinth: "-",
            roomLevel: "-",
        };
    }
}

export function loadEquipmentSetsFromStorage() {
    const modernData = readJsonStorage(EQUIPMENT_SET_STORAGE_KEY);
    const source = modernData;

    const normalized = {};
    for (const [rawName, rawEntry] of Object.entries(source)) {
        const name = String(rawName || "").trim();
        if (!name) {
            continue;
        }

        const entry = isPlainObject(rawEntry) ? rawEntry : {};
        const hasModernShape = isPlainObject(rawEntry) && Object.prototype.hasOwnProperty.call(rawEntry, "queueChanges");
        if (!hasModernShape) {
            continue;
        }

        normalized[name] = {
            savedAt: clampPositiveInteger(entry.savedAt, Date.now()),
            queueChanges: normalizeEquipmentSetQueueChanges(entry.queueChanges),
        };
    }

    if (hasJsonStorageChanged(source, normalized)) {
        persistEquipmentSetsToStorage(normalized);
    }
    return normalized;
}

export function persistEquipmentSetsToStorage(equipmentSets) {
    const source = isPlainObject(equipmentSets) ? equipmentSets : {};
    const normalized = {};
    for (const [rawName, rawEntry] of Object.entries(source)) {
        const name = String(rawName || "").trim();
        if (!name) {
            continue;
        }
        const entry = isPlainObject(rawEntry) ? rawEntry : {};
        normalized[name] = {
            savedAt: clampPositiveInteger(entry.savedAt, Date.now()),
            queueChanges: normalizeEquipmentSetQueueChanges(entry.queueChanges),
        };
    }
    setJsonStorage(EQUIPMENT_SET_STORAGE_KEY, normalized);
}

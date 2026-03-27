import { defineStore } from "pinia";
import {
    abilityBookInfoByAbilityHrid,
    abilityDetailIndex,
    abilityOptions,
    abilityXpLevels,
    actionDetailIndex,
    drinkOptions,
    dungeonOptions,
    equipmentOptionsBySlot,
    foodOptions,
    getAbilityName as getIndexedAbilityName,
    getActionName as getIndexedActionName,
    getHouseRoomName as getIndexedHouseRoomName,
    getItemName as getIndexedItemName,
    getMonsterName as getIndexedMonsterName,
    groupZoneHrids,
    houseRoomDetailIndex,
    itemDetailIndex,
    labyrinthCrateOptions,
    labyrinthOptions,
    monsterDetailIndex,
    soloZoneHrids,
    zoneOptions,
} from "../shared/gameDataIndex.js";
import { createEmptyPlayerConfig, EQUIPMENT_SLOT_KEYS, LEVEL_KEYS } from "../shared/playerConfig.js";
import workerClient, { WorkerClient } from "../services/workerClient.js";
import { estimateNoRngProfit } from "../services/profitEstimator.js";
import {
    createDefaultPriceTable,
    fetchMarketPriceTable,
    normalizePriceMode,
    PRICE_MODE_ASK,
    PRICE_MODE_BID,
    PRICE_MODE_VENDOR,
} from "../services/marketPriceService.js";
import {
    exportGroupConfig,
    exportSoloConfig,
    importGroupConfig as parseGroupImportConfig,
    importSoloConfig as parseSoloImportConfig,
} from "../services/importExportMapper.js";
import {
    ensureTriggerMapEntry,
    getDefaultTriggerDtosForHrid,
    sanitizeTriggerList,
    sanitizeTriggerMap,
} from "../services/triggerMapper.js";
import {
    ADVISOR_GOAL_PRESET_BALANCED,
    ADVISOR_GOAL_PRESET_CUSTOM,
    buildAdvisorMetricSummary,
    buildAdvisorTopCards,
    getAdvisorPresetWeights,
    normalizeAdvisorGoalPreset,
    normalizeAdvisorWeights,
    rankAdvisorRows,
} from "../services/advisorScoring.js";

const ONE_SECOND = 1e9;
const ONE_HOUR = 60 * 60 * ONE_SECOND;

const RUN_SCOPE_SINGLE = "single";
const RUN_SCOPE_ALL_GROUP_ZONES = "all_group_zones";
const RUN_SCOPE_ALL_SOLO_ZONES = "all_solo_zones";
const RUN_SCOPE_ALL_LABYRINTHS = "all_labyrinths";
const ABILITY_BOOK_CATEGORY_HRID = "/item_categories/ability_book";
const LABYRINTH_COFFEE_CRATE_HRIDS = ["/items/basic_coffee_crate", "/items/advanced_coffee_crate", "/items/expert_coffee_crate"];
const LABYRINTH_FOOD_CRATE_HRIDS = ["/items/basic_food_crate", "/items/advanced_food_crate", "/items/expert_food_crate"];

const EQUIPMENT_SET_STORAGE_KEY = "mwi.equipmentSets.v2";
const EQUIPMENT_SET_QUEUE_CHANGES_VERSION = 1;
const PRICE_SETTINGS_STORAGE_KEY = "mwi.price.settings.v1";
const PRICE_MARKET_CACHE_STORAGE_KEY = "mwi.price.marketCache.v1";
const SIMULATION_UI_STORAGE_KEY = "mwi.simulation.ui.v1";
const QUEUE_SETTINGS_STORAGE_KEY = "mwi.queue.settings.v1";
const QUEUE_SETTINGS_STORAGE_VERSION = 1;
const PLAYER_DATA_SNAPSHOT_STORAGE_KEY = "mwi.player.data.snapshot.v1";
const PLAYER_DATA_SNAPSHOT_STORAGE_VERSION = 1;
const PLAYER_ACHIEVEMENTS_STORAGE_KEY = "mwi.player.achievements.v1";
const PLAYER_ACHIEVEMENTS_STORAGE_VERSION = 1;
const QUEUE_PLAYER_IDS = ["1", "2", "3", "4", "5"];
const QUEUE_PARALLEL_WORKER_LIMIT_MIN = 1;
const QUEUE_PARALLEL_WORKER_LIMIT_MAX = 64;
const QUEUE_WEIGHT_SUM_EPSILON = 1e-6;
const QUEUE_MULTI_ROUND_DEFAULT_PARALLEL_WORKERS = 4;
const QUEUE_MULTI_ROUND_METRIC_KEYS = ["dps", "dailyNoRngProfit", "xpPerHour", "killsPerHour"];
const QUEUE_MULTI_ROUND_WINSORIZE_PCT = 0.05;
const QUEUE_MULTI_ROUND_MEDIAN_BLEND_WEIGHT = 0.5;
const QUEUE_MULTI_ROUND_CONFIDENCE_SIZE_SCALE = 8;
const QUEUE_MULTI_ROUND_CONFIDENCE_PENALTY_STRENGTH = 0.35;
const QUEUE_MULTI_ROUND_SCORE_MIN = 5;
const QUEUE_MULTI_ROUND_SCORE_MAX = 95;
const QUEUE_MULTI_ROUND_SCORE_TIE = 50;
const QUEUE_MULTI_ROUND_SCORE_INVALID = 0;
const QUEUE_MULTI_ROUND_FINAL_WEIGHT_PERFORMANCE = 0.4;
const QUEUE_MULTI_ROUND_FINAL_WEIGHT_STABILITY = 0.2;
const QUEUE_MULTI_ROUND_FINAL_WEIGHT_COST = 0.4;
const QUEUE_COST_SCORE_WEIGHT_UPGRADE = 0.25;
const QUEUE_COST_SCORE_WEIGHT_PURCHASE_DAYS = 0.35;
const QUEUE_COST_SCORE_WEIGHT_GOLD_PER_POINT = 0.4;
const ADVISOR_REFINE_TOP_COUNT_DEFAULT = 8;
const ADVISOR_REFINE_ROUNDS_DEFAULT = 10;
const ADVISOR_REFINE_TOP_COUNT_MIN = 1;
const ADVISOR_REFINE_TOP_COUNT_MAX = 32;
const ADVISOR_REFINE_ROUNDS_MIN = 1;
const ADVISOR_REFINE_ROUNDS_MAX = 30;
const DEDICATED_WORKER_SCOPE_QUEUE = "queue";
const DEDICATED_WORKER_SCOPE_ADVISOR = "advisor";
const dedicatedWorkerRuns = new Set();
let sharedWorkerRunHandle = null;
let abilityUpgradeReferenceLoadPromise = null;
let playerMapperModulePromise = null;

function loadPlayerMapperModule() {
    if (!playerMapperModulePromise) {
        playerMapperModulePromise = import("../services/playerMapper.js");
    }
    return playerMapperModulePromise;
}

function createWorkerRunCancellationError(message = "Simulation cancelled.") {
    const error = new Error(message);
    error.code = "cancelled";
    return error;
}

function isWorkerRunCancelledError(error) {
    return Boolean(error?.code === "cancelled");
}

function registerDedicatedWorkerRun(workerRunHandle) {
    if (workerRunHandle) {
        dedicatedWorkerRuns.add(workerRunHandle);
    }
}

function unregisterDedicatedWorkerRun(workerRunHandle) {
    if (workerRunHandle) {
        dedicatedWorkerRuns.delete(workerRunHandle);
    }
}

function cancelDedicatedWorkerRuns(predicate = () => true, cancellationError = createWorkerRunCancellationError()) {
    for (const workerRunHandle of Array.from(dedicatedWorkerRuns)) {
        if (!predicate(workerRunHandle)) {
            continue;
        }
        try {
            workerRunHandle.cancel(cancellationError);
        } catch (error) {
            // ignore cancel errors while cleaning dedicated workers
        }
    }
}

function stopQueueWorkerClients() {
    cancelDedicatedWorkerRuns((workerRunHandle) => workerRunHandle.scope === DEDICATED_WORKER_SCOPE_QUEUE);
}

function stopAdvisorWorkerRuns() {
    cancelDedicatedWorkerRuns((workerRunHandle) => workerRunHandle.scope === DEDICATED_WORKER_SCOPE_ADVISOR);
}

function unregisterSharedWorkerRun(workerRunHandle) {
    if (sharedWorkerRunHandle === workerRunHandle) {
        sharedWorkerRunHandle = null;
    }
}

function cancelSharedWorkerRun(cancellationError = createWorkerRunCancellationError()) {
    if (!sharedWorkerRunHandle) {
        return;
    }

    try {
        sharedWorkerRunHandle.cancel(cancellationError);
    } catch (error) {
        // ignore cancel errors while cleaning shared workers
    }
}

function runSingleSimulationPayloadWithDedicatedWorker(payload, onProgress = () => {}, options = {}) {
    return new Promise((resolve, reject) => {
        const dedicatedClient = new WorkerClient();
        const scope = String(options?.scope || DEDICATED_WORKER_SCOPE_QUEUE);
        let settled = false;
        let workerRunHandle = null;

        const settle = (callback, value) => {
            if (settled) {
                return;
            }

            settled = true;

            try {
                dedicatedClient.stopSimulation();
            } catch (error) {
                // ignore stop errors while settling dedicated workers
            }

            unregisterDedicatedWorkerRun(workerRunHandle);
            callback(value);
        };

        workerRunHandle = {
            scope,
            cancel: (error = createWorkerRunCancellationError()) => {
                settle(reject, error);
            },
        };
        registerDedicatedWorkerRun(workerRunHandle);

        try {
            dedicatedClient.startSimulation(payload, {
                onProgress: (data) => {
                    if (settled) {
                        return;
                    }
                    try {
                        onProgress(data);
                    } catch (error) {
                        settle(reject, error);
                    }
                },
                onResult: (simResult) => {
                    settle(resolve, simResult);
                },
                onError: (error) => {
                    settle(reject, error);
                },
            });
        } catch (error) {
            settle(reject, error);
        }
    });
}

function runMultiSimulationPayloadWithDedicatedWorker(payload, onProgress = () => {}, options = {}) {
    return new Promise((resolve, reject) => {
        const dedicatedClient = new WorkerClient();
        const scope = String(options?.scope || DEDICATED_WORKER_SCOPE_QUEUE);
        const onItemResult = typeof options?.onItemResult === "function" ? options.onItemResult : () => {};
        let settled = false;
        let workerRunHandle = null;

        const settle = (callback, value) => {
            if (settled) {
                return;
            }

            settled = true;

            try {
                dedicatedClient.stopSimulation();
            } catch (error) {
                // ignore stop errors while settling dedicated workers
            }

            unregisterDedicatedWorkerRun(workerRunHandle);
            callback(value);
        };

        workerRunHandle = {
            scope,
            cancel: (error = createWorkerRunCancellationError()) => {
                settle(reject, error);
            },
        };
        registerDedicatedWorkerRun(workerRunHandle);

        try {
            dedicatedClient.startMultiSimulation(payload, {
                onProgress: (data) => {
                    if (settled) {
                        return;
                    }
                    try {
                        onProgress(data);
                    } catch (error) {
                        settle(reject, error);
                    }
                },
                onItemResult: (data) => {
                    if (settled) {
                        return;
                    }
                    try {
                        onItemResult(data);
                    } catch (error) {
                        settle(reject, error);
                    }
                },
                onBatchResult: (simResults, batchResultType) => {
                    settle(resolve, {
                        simResults: Array.isArray(simResults) ? simResults : [],
                        batchResultType: String(batchResultType || ""),
                    });
                },
                onError: (error) => {
                    settle(reject, error);
                },
            });
        } catch (error) {
            settle(reject, error);
        }
    });
}

function runSharedSingleSimulationPayload(payload, onProgress = () => {}) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let workerRunHandle = null;

        const settle = (callback, value, stopWorker = false) => {
            if (settled) {
                return;
            }

            settled = true;

            if (stopWorker) {
                try {
                    workerClient.stopSimulation();
                } catch (error) {
                    // ignore stop errors while settling shared workers
                }
            }

            unregisterSharedWorkerRun(workerRunHandle);
            callback(value);
        };

        workerRunHandle = {
            cancel: (error = createWorkerRunCancellationError()) => {
                settle(reject, error, true);
            },
        };
        sharedWorkerRunHandle = workerRunHandle;

        try {
            workerClient.startSimulation(payload, {
                onProgress: (data) => {
                    if (settled) {
                        return;
                    }
                    try {
                        onProgress(data);
                    } catch (error) {
                        settle(reject, error, true);
                    }
                },
                onResult: (simResult) => {
                    settle(resolve, simResult);
                },
                onError: (error) => {
                    settle(reject, error);
                },
            });
        } catch (error) {
            settle(reject, error, true);
        }
    });
}

function sortByNameThenLevel(a, b) {
    if (a.itemLevel !== b.itemLevel) {
        return a.itemLevel - b.itemLevel;
    }
    return a.name.localeCompare(b.name);
}

function resolveFoodConsumableSortGroup(option) {
    const itemHrid = String(option?.hrid || "");
    const item = itemDetailIndex?.[itemHrid];
    const hitpointRestore = Number(item?.hitpointRestore ?? 0);
    const manapointRestore = Number(item?.manapointRestore ?? 0);
    const recoveryDuration = Number(item?.recoveryDuration ?? 0);

    if (hitpointRestore > 0 && manapointRestore <= 0) {
        return recoveryDuration > 0 ? 1 : 0;
    }

    if (manapointRestore > 0 && hitpointRestore <= 0) {
        return recoveryDuration > 0 ? 3 : 2;
    }

    return 99;
}

function getEquipmentOptionsBySlot() {
    return equipmentOptionsBySlot;
}

function getConsumableOptions(categoryHrid) {
    if (categoryHrid === "/item_categories/food") {
        return foodOptions;
    }

    if (categoryHrid === "/item_categories/drink") {
        return drinkOptions;
    }

    return [];
}

function getAbilityOptions() {
    return abilityOptions;
}

function getZoneOptions() {
    return { zones: zoneOptions, dungeons: dungeonOptions };
}

function getLabyrinthOptions() {
    return labyrinthOptions;
}

function getAllNonDungeonActions() {
    return Object.values(actionDetailIndex)
        .filter((action) => action.type === "/action_types/combat")
        .filter((action) => action.category !== "/action_categories/combat/dungeons")
        .sort((a, b) => Number(a.sortIndex ?? 0) - Number(b.sortIndex ?? 0));
}

function getZoneHridsBySpawnCount(targetSpawnCount) {
    return getAllNonDungeonActions()
        .filter((action) => {
            const maxSpawnCount = Number(action?.combatZoneInfo?.fightInfo?.randomSpawnInfo?.maxSpawnCount ?? 0);
            return targetSpawnCount > 1 ? maxSpawnCount > 1 : maxSpawnCount === 1;
        })
        .map((action) => String(action.hrid || ""))
        .filter(Boolean);
}

function normalizeZoneSelection(selectedHrids, allHrids) {
    const allSet = new Set((allHrids || []).map((value) => String(value || "")).filter(Boolean));
    const selected = Array.isArray(selectedHrids) ? selectedHrids : [];
    return Array.from(new Set(selected
        .map((value) => String(value || ""))
        .filter((value) => allSet.has(value))));
}

function normalizeLabyrinthCrates(rawCrates) {
    const source = isPlainObject(rawCrates) ? rawCrates : {};
    const coffee = String(source.coffee || "");
    const food = String(source.food || "");
    return {
        coffee: LABYRINTH_COFFEE_CRATE_HRIDS.includes(coffee) ? coffee : "",
        food: LABYRINTH_FOOD_CRATE_HRIDS.includes(food) ? food : "",
    };
}

function buildZoneTargetsByScope(runScope, selectedZoneHrids = []) {
    let actions = getAllNonDungeonActions();

    if (runScope === RUN_SCOPE_ALL_GROUP_ZONES) {
        actions = actions.filter((action) => Number(action?.combatZoneInfo?.fightInfo?.randomSpawnInfo?.maxSpawnCount ?? 0) > 1);
    }

    if (runScope === RUN_SCOPE_ALL_SOLO_ZONES) {
        actions = actions.filter((action) => Number(action?.combatZoneInfo?.fightInfo?.randomSpawnInfo?.maxSpawnCount ?? 0) === 1);
    }

    const selectedSet = new Set((selectedZoneHrids || []).map((hrid) => String(hrid || "")).filter(Boolean));
    if (selectedSet.size > 0) {
        actions = actions.filter((action) => selectedSet.has(String(action?.hrid || "")));
    }

    return actions.flatMap((action) => {
        const maxDifficulty = Number(action.maxDifficulty ?? 0);
        const zoneHrid = action.hrid;
        const results = [];

        for (let difficultyTier = 0; difficultyTier <= maxDifficulty; difficultyTier++) {
            results.push({ zoneHrid, difficultyTier });
        }

        return results;
    });
}

function buildAllLabyrinthTargets(crates = []) {
    const labyrinthMonsters = Object.values(monsterDetailIndex)
        .filter((monster) => monster.isLabyrinthMonster === true)
        .sort((a, b) => Number(a.sortIndex ?? 0) - Number(b.sortIndex ?? 0));

    const normalizedCrates = Array.isArray(crates)
        ? crates.map((value) => String(value || "")).filter(Boolean)
        : [];

    return labyrinthMonsters.flatMap((monster) => {
        const labyrinths = [];
        for (let roomLevel = 40; roomLevel <= 220; roomLevel += 20) {
            labyrinths.push({
                labyrinthHrid: monster.hrid,
                roomLevel,
                crates: [...normalizedCrates],
            });
        }
        return labyrinths;
    });
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function summarizeResult(simResult, selectedPlayers, pricingOptions = {}) {
    const hours = Math.max(1e-9, Number(simResult?.simulatedTime ?? 0) / ONE_HOUR);
    const skills = ["stamina", "intelligence", "attack", "magic", "ranged", "melee", "defense"];

    return selectedPlayers.map((player) => {
        const playerHrid = `player${player.id}`;
        const experienceMap = simResult?.experienceGained?.[playerHrid] ?? {};
        const totalExperience = Object.values(experienceMap).reduce((sum, value) => sum + Number(value || 0), 0);
        const deathsPerHour = Number(simResult?.deaths?.[playerHrid] ?? 0) / hours;
        const encountersPerHour = Number(simResult?.encounters ?? 0) / hours;
        const profit = estimateNoRngProfit(simResult, playerHrid, pricingOptions);
        const skillXpPerHour = {};

        for (const skill of skills) {
            skillXpPerHour[`${skill}XpPerHour`] = Number(experienceMap?.[skill] || 0) / hours;
        }

        return {
            playerHrid,
            playerName: player.name,
            encountersPerHour,
            deathsPerHour,
            totalXpPerHour: totalExperience / hours,
            profitPerHour: profit.profit / hours,
            revenuePerHour: profit.revenue / hours,
            expensesPerHour: profit.expenses / hours,
            totalExperience,
            noRngRevenue: profit.revenue,
            expenses: profit.expenses,
            noRngProfit: profit.profit,
            ...skillXpPerHour,
        };
    });
}

function summarizeBatchResults(simResults, selectedPlayers, pricingOptions = {}) {
    const actionOrderMap = new Map(getAllNonDungeonActions().map((action, index) => [String(action?.hrid || ""), index]));
    const labyrinthOrderMap = new Map(
        Object.values(monsterDetailIndex)
            .filter((monster) => monster.isLabyrinthMonster === true)
            .sort((a, b) => Number(a.sortIndex ?? 0) - Number(b.sortIndex ?? 0))
            .map((monster, index) => [String(monster?.hrid || ""), index])
    );
    const playerOrderMap = new Map((selectedPlayers || []).map((player, index) => [`player${player.id}`, index]));

    const orderedResults = (simResults || []).slice().sort((left, right) => {
        const leftIsLabyrinth = Boolean(left?.isLabyrinth);
        const rightIsLabyrinth = Boolean(right?.isLabyrinth);

        if (leftIsLabyrinth !== rightIsLabyrinth) {
            return leftIsLabyrinth ? 1 : -1;
        }

        if (leftIsLabyrinth && rightIsLabyrinth) {
            const leftLabyrinthOrder = labyrinthOrderMap.get(String(left?.labyrinthName || "")) ?? Number.MAX_SAFE_INTEGER;
            const rightLabyrinthOrder = labyrinthOrderMap.get(String(right?.labyrinthName || "")) ?? Number.MAX_SAFE_INTEGER;
            if (leftLabyrinthOrder !== rightLabyrinthOrder) {
                return leftLabyrinthOrder - rightLabyrinthOrder;
            }

            return Number(left?.roomLevel || 0) - Number(right?.roomLevel || 0);
        }

        const leftZoneOrder = actionOrderMap.get(String(left?.zoneName || "")) ?? Number.MAX_SAFE_INTEGER;
        const rightZoneOrder = actionOrderMap.get(String(right?.zoneName || "")) ?? Number.MAX_SAFE_INTEGER;
        if (leftZoneOrder !== rightZoneOrder) {
            return leftZoneOrder - rightZoneOrder;
        }

        return Number(left?.difficultyTier || 0) - Number(right?.difficultyTier || 0);
    });

    const rows = [];

    orderedResults.forEach((simResult, runIndex) => {
        const zoneName = simResult?.isLabyrinth ? simResult?.labyrinthName : simResult?.zoneName;
        const difficulty = simResult?.isLabyrinth ? simResult?.roomLevel : simResult?.difficultyTier;

        const playerRows = summarizeResult(simResult, selectedPlayers, pricingOptions);
        playerRows.sort((left, right) => {
            const leftOrder = playerOrderMap.get(String(left?.playerHrid || "")) ?? Number.MAX_SAFE_INTEGER;
            const rightOrder = playerOrderMap.get(String(right?.playerHrid || "")) ?? Number.MAX_SAFE_INTEGER;
            return leftOrder - rightOrder;
        });
        playerRows.forEach((playerRow) => {
            rows.push({
                rowId: `${runIndex}-${playerRow.playerHrid}`,
                runIndex,
                zoneName: zoneName || "-",
                zoneOrder: simResult?.isLabyrinth
                    ? (labyrinthOrderMap.get(String(zoneName || "")) ?? Number.MAX_SAFE_INTEGER)
                    : (actionOrderMap.get(String(zoneName || "")) ?? Number.MAX_SAFE_INTEGER),
                difficulty,
                ...playerRow,
            });
        });
    });

    return rows;
}

function buildSimulationExtra(simulationSettings) {
    return {
        mooPass: Boolean(simulationSettings.mooPass),
        comExp: simulationSettings.comExpEnabled ? Number(simulationSettings.comExp || 20) : 0,
        comDrop: simulationSettings.comDropEnabled ? Number(simulationSettings.comDrop || 20) : 0,
        enableHpMpVisualization: Boolean(simulationSettings.enableHpMpVisualization),
    };
}

function buildQueueBaselineSettings(simulationSettings = {}) {
    const useDungeon = Boolean(simulationSettings.useDungeon);
    const regularZoneHrid = String(simulationSettings.zoneHrid || "");
    const dungeonHrid = String(simulationSettings.dungeonHrid || "");
    const selectedZoneHrid = useDungeon ? dungeonHrid : regularZoneHrid;

    return {
        mode: String(simulationSettings.mode || "zone"),
        runScope: String(simulationSettings.runScope || RUN_SCOPE_SINGLE),
        simDungeon: useDungeon,
        zoneHrid: selectedZoneHrid,
        regularZoneHrid,
        dungeonHrid,
        difficultyTier: Math.max(0, Math.floor(toFiniteNumber(simulationSettings.difficultyTier, 0))),
        simulationTimeHours: Math.max(1, Math.floor(toFiniteNumber(simulationSettings.simulationTimeHours, 24))),
        extra: buildSimulationExtra(simulationSettings),
    };
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

function readJsonStorage(storageKey) {
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw);
        return isPlainObject(parsed) ? parsed : {};
    } catch (error) {
        return {};
    }
}

function normalizeSimulationUiSettings(rawSettings) {
    const source = isPlainObject(rawSettings) ? rawSettings : {};
    return {
        mooPass: Boolean(source.mooPass),
        comExpEnabled: Boolean(source.comExpEnabled),
        comExp: clamp(Math.floor(toFiniteNumber(source.comExp, 20)), 1, 99),
        comDropEnabled: Boolean(source.comDropEnabled),
        comDrop: clamp(Math.floor(toFiniteNumber(source.comDrop, 20)), 1, 99),
    };
}

function loadSimulationUiSettingsFromStorage() {
    const stored = readJsonStorage(SIMULATION_UI_STORAGE_KEY);
    return normalizeSimulationUiSettings({
        mooPass: true,
        comExpEnabled: true,
        comDropEnabled: true,
        ...stored,
    });
}

function persistSimulationUiSettingsToStorage(settings) {
    if (typeof localStorage === "undefined") {
        return;
    }
    const normalized = normalizeSimulationUiSettings(settings);
    localStorage.setItem(SIMULATION_UI_STORAGE_KEY, JSON.stringify(normalized));
}

function normalizeAchievementFlags(rawAchievements) {
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

function normalizeStoredPlayerAchievementsMap(rawPlayerAchievements) {
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

function collectPlayerAchievementsById(players) {
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

function loadPlayerAchievementsFromStorage() {
    const payload = readJsonStorage(PLAYER_ACHIEVEMENTS_STORAGE_KEY);
    if (payload.version != null && Number(payload.version) !== PLAYER_ACHIEVEMENTS_STORAGE_VERSION) {
        return {};
    }

    const sourceMap = isPlainObject(payload.achievementsByPlayer)
        ? payload.achievementsByPlayer
        : payload;

    return normalizeStoredPlayerAchievementsMap(sourceMap);
}

function persistPlayerAchievementsToStorage(players) {
    if (typeof localStorage === "undefined") {
        return;
    }

    const achievementsByPlayer = collectPlayerAchievementsById(players);
    if (Object.keys(achievementsByPlayer).length <= 0) {
        localStorage.removeItem(PLAYER_ACHIEVEMENTS_STORAGE_KEY);
        return;
    }

    localStorage.setItem(PLAYER_ACHIEVEMENTS_STORAGE_KEY, JSON.stringify({
        version: PLAYER_ACHIEVEMENTS_STORAGE_VERSION,
        achievementsByPlayer,
    }));
}

function clearPlayerAchievementsFromStorage() {
    if (typeof localStorage === "undefined") {
        return;
    }

    localStorage.removeItem(PLAYER_ACHIEVEMENTS_STORAGE_KEY);
}

function applyPersistedAchievementsToPlayers(players, achievementsByPlayer) {
    const normalizedAchievementsByPlayer = normalizeStoredPlayerAchievementsMap(achievementsByPlayer);
    return (players || []).map((player) => {
        const playerId = String(player?.id || "").trim();
        return {
            ...player,
            achievements: deepClone(normalizedAchievementsByPlayer[playerId] ?? {}),
        };
    });
}

function getVendorPriceByItemHrid(itemHrid) {
    const hrid = String(itemHrid || "");
    if (!hrid) {
        return 0;
    }
    return Math.max(0, toFiniteNumber(itemDetailIndex?.[hrid]?.sellPrice, 0));
}

function normalizePriceOverrideValue(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return null;
    }
    return parsed;
}

function normalizePriceOverrideMap(rawOverrides) {
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

function normalizeEnhancementQuotesByItem(rawQuotes) {
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
            if (ask < 0 && bid < 0) {
                continue;
            }

            quoteMap[String(level)] = {
                ask,
                bid,
            };
        }

        if (Object.keys(quoteMap).length > 0) {
            normalized[hrid] = quoteMap;
        }
    }

    return normalized;
}

function normalizeEnhancementLevelsByItem(rawLevels) {
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

function cloneBasePriceTable(basePriceTable) {
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

function applyPriceOverridesToTable(basePriceTable, overrides) {
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

function rehydratePricingTable(pricingState) {
    const source = pricingState && typeof pricingState === "object" ? pricingState : {};
    source.priceTable = applyPriceOverridesToTable(source.basePriceTable, source.overrides);
}

function normalizePricingSettings(raw) {
    const source = isPlainObject(raw) ? raw : {};
    return {
        consumableMode: normalizePriceMode(source.consumableMode, PRICE_MODE_ASK),
        dropMode: normalizePriceMode(source.dropMode, PRICE_MODE_BID),
        overrides: normalizePriceOverrideMap(source.overrides),
    };
}

function normalizeMarketCachePayload(raw) {
    const source = isPlainObject(raw) ? raw : {};
    return {
        basePriceTable: cloneBasePriceTable(source.basePriceTable),
        enhancementQuotesByItem: normalizeEnhancementQuotesByItem(source.enhancementQuotesByItem),
        enhancementLevelsByItem: normalizeEnhancementLevelsByItem(source.enhancementLevelsByItem),
        lastFetchedAt: Math.max(0, toFiniteNumber(source.lastFetchedAt, 0)),
        sourceUrl: String(source.sourceUrl || ""),
    };
}

function loadMarketCacheFromStorage() {
    const payload = normalizeMarketCachePayload(readJsonStorage(PRICE_MARKET_CACHE_STORAGE_KEY));
    if (Object.keys(payload.basePriceTable).length === 0 || payload.lastFetchedAt <= 0) {
        return null;
    }
    return payload;
}

function persistMarketCacheToStorage(cachePayload) {
    if (typeof localStorage === "undefined") {
        return;
    }
    const normalized = normalizeMarketCachePayload(cachePayload);
    localStorage.setItem(PRICE_MARKET_CACHE_STORAGE_KEY, JSON.stringify(normalized));
}

function clearMarketCacheFromStorage() {
    if (typeof localStorage === "undefined") {
        return;
    }
    localStorage.removeItem(PRICE_MARKET_CACHE_STORAGE_KEY);
}

function loadPricingSettingsFromStorage() {
    const parsed = readJsonStorage(PRICE_SETTINGS_STORAGE_KEY);
    return normalizePricingSettings(parsed);
}

function persistPricingSettingsToStorage(settings) {
    const normalized = normalizePricingSettings(settings);
    localStorage.setItem(PRICE_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
}

function createPricingState() {
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
        lastFetchedAt: Number(cachedMarket?.lastFetchedAt || 0),
        sourceUrl: String(cachedMarket?.sourceUrl || ""),
        isLoading: false,
        error: "",
    };
}

function createProfitPricingOptions(pricingState) {
    return {
        consumableMode: normalizePriceMode(pricingState?.consumableMode, PRICE_MODE_ASK),
        dropMode: normalizePriceMode(pricingState?.dropMode, PRICE_MODE_BID),
        priceTable: pricingState?.priceTable ?? null,
    };
}

function getDefaultQueueRuntimeSettings() {
    return {
        finalWeights: {
            performance: QUEUE_MULTI_ROUND_FINAL_WEIGHT_PERFORMANCE,
            stability: QUEUE_MULTI_ROUND_FINAL_WEIGHT_STABILITY,
            cost: QUEUE_MULTI_ROUND_FINAL_WEIGHT_COST,
        },
        parallelWorkerLimit: QUEUE_MULTI_ROUND_DEFAULT_PARALLEL_WORKERS,
    };
}

function normalizeQueueScoreWeights(scoreWeights) {
    const defaults = getDefaultQueueRuntimeSettings().finalWeights;
    const performance = Number(scoreWeights?.performance);
    const stability = Number(scoreWeights?.stability);
    const cost = Number(scoreWeights?.cost);

    if (
        !Number.isFinite(performance)
        || !Number.isFinite(stability)
        || !Number.isFinite(cost)
        || performance < 0
        || stability < 0
        || cost < 0
        || performance > 1
        || stability > 1
        || cost > 1
    ) {
        return {
            ...defaults,
        };
    }

    const weightSum = performance + stability + cost;
    if (Math.abs(weightSum - 1) > QUEUE_WEIGHT_SUM_EPSILON) {
        return {
            ...defaults,
        };
    }

    return {
        performance,
        stability,
        cost,
    };
}

function normalizeParallelWorkerLimit(value, maxLimit = QUEUE_PARALLEL_WORKER_LIMIT_MAX) {
    const parsed = Math.floor(toFiniteNumber(value, QUEUE_MULTI_ROUND_DEFAULT_PARALLEL_WORKERS));
    const hardMax = clamp(
        Math.floor(toFiniteNumber(maxLimit, QUEUE_PARALLEL_WORKER_LIMIT_MAX)),
        QUEUE_PARALLEL_WORKER_LIMIT_MIN,
        QUEUE_PARALLEL_WORKER_LIMIT_MAX
    );
    return clamp(parsed, QUEUE_PARALLEL_WORKER_LIMIT_MIN, hardMax);
}

function getDetectedHardwareCoreCount() {
    const hardwareConcurrency = Number(typeof navigator !== "undefined" ? navigator.hardwareConcurrency : NaN);
    if (!Number.isFinite(hardwareConcurrency) || hardwareConcurrency <= 0) {
        return null;
    }
    return Math.max(1, Math.floor(hardwareConcurrency));
}

function getParallelWorkerHardMaxForCurrentMachine() {
    const detectedCoreCount = getDetectedHardwareCoreCount();
    if (!Number.isFinite(detectedCoreCount)) {
        return QUEUE_PARALLEL_WORKER_LIMIT_MAX;
    }
    return clamp(detectedCoreCount, QUEUE_PARALLEL_WORKER_LIMIT_MIN, QUEUE_PARALLEL_WORKER_LIMIT_MAX);
}

function getRecommendedParallelWorkerLimit() {
    const detectedCoreCount = getDetectedHardwareCoreCount();
    const upperBound = Number.isFinite(detectedCoreCount)
        ? Math.min(QUEUE_PARALLEL_WORKER_LIMIT_MAX, detectedCoreCount)
        : QUEUE_PARALLEL_WORKER_LIMIT_MAX;
    return clamp(
        QUEUE_MULTI_ROUND_DEFAULT_PARALLEL_WORKERS,
        QUEUE_PARALLEL_WORKER_LIMIT_MIN,
        upperBound
    );
}

function normalizeQueueRuntimeSettings(settings) {
    return {
        finalWeights: normalizeQueueScoreWeights(settings?.finalWeights),
        parallelWorkerLimit: normalizeParallelWorkerLimit(settings?.parallelWorkerLimit),
    };
}

function loadQueueRuntimeSettingsFromStorage() {
    const defaults = getDefaultQueueRuntimeSettings();
    if (typeof localStorage === "undefined") {
        return defaults;
    }

    try {
        const rawValue = localStorage.getItem(QUEUE_SETTINGS_STORAGE_KEY);
        if (!rawValue) {
            return defaults;
        }

        const parsed = JSON.parse(rawValue);
        if (!isPlainObject(parsed) || parsed.version !== QUEUE_SETTINGS_STORAGE_VERSION) {
            return defaults;
        }

        return normalizeQueueRuntimeSettings({
            finalWeights: parsed.finalWeights,
            parallelWorkerLimit: parsed.parallelWorkerLimit,
        });
    } catch (error) {
        return defaults;
    }
}

function persistQueueRuntimeSettingsToStorage(settings) {
    if (typeof localStorage === "undefined") {
        throw new Error("localStorage unavailable");
    }

    const normalized = normalizeQueueRuntimeSettings(settings);
    const payload = {
        version: QUEUE_SETTINGS_STORAGE_VERSION,
        savedAt: Date.now(),
        finalWeights: {
            ...normalized.finalWeights,
        },
        parallelWorkerLimit: normalized.parallelWorkerLimit,
    };
    localStorage.setItem(QUEUE_SETTINGS_STORAGE_KEY, JSON.stringify(payload));
    return normalized;
}

function snapshotPlayerDataMap(rawPlayerDataMap) {
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
    if (hasAnyTruthyValue(player.achievements)) {
        return true;
    }

    return false;
}

function hasMeaningfulPlayerSnapshotData(parsedSnapshot) {
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

function normalizeStoredPlayerDataMap(rawPlayerDataMap, allowPartial = true) {
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

function upsertPlayerDataSnapshotToStorage(normalizedPlayerDataMap) {
    if (typeof localStorage === "undefined") {
        throw new Error("localStorage unavailable");
    }

    const normalized = normalizeStoredPlayerDataMap(normalizedPlayerDataMap, true);
    if (!normalized) {
        localStorage.removeItem(PLAYER_DATA_SNAPSHOT_STORAGE_KEY);
        return 0;
    }

    const payload = {
        version: PLAYER_DATA_SNAPSHOT_STORAGE_VERSION,
        savedAt: Date.now(),
        playerDataMap: normalized,
    };
    localStorage.setItem(PLAYER_DATA_SNAPSHOT_STORAGE_KEY, JSON.stringify(payload));
    return payload.savedAt;
}

function clearPlayerDataSnapshotFromStorage() {
    if (typeof localStorage === "undefined") {
        throw new Error("localStorage unavailable");
    }
    localStorage.removeItem(PLAYER_DATA_SNAPSHOT_STORAGE_KEY);
}

function loadPlayerDataSnapshotFromStorage() {
    if (typeof localStorage === "undefined") {
        return { status: "error", savedAt: 0, playerDataMap: {} };
    }

    const rawValue = localStorage.getItem(PLAYER_DATA_SNAPSHOT_STORAGE_KEY);
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

function savePlayerDataSnapshotToStorage(rawPlayerDataMap) {
    if (typeof localStorage === "undefined") {
        throw new Error("localStorage unavailable");
    }

    const normalizedPlayerDataMap = normalizeStoredPlayerDataMap(snapshotPlayerDataMap(rawPlayerDataMap), true);
    if (!normalizedPlayerDataMap || Object.keys(normalizedPlayerDataMap).length === 0) {
        throw new Error("invalid player data snapshot");
    }
    return upsertPlayerDataSnapshotToStorage(normalizedPlayerDataMap);
}

function createPlayerDataSnapshotState() {
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

function parsePlayerSnapshotSummary(playerDataJson) {
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

function clampPositiveInteger(value, fallback = 0) {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed) || parsed < 0) {
        return fallback;
    }
    return parsed;
}

function createEquipmentSetSnapshotFromPlayer(player) {
    const source = player && typeof player === "object" ? player : createEmptyPlayerConfig(1);

    return {
        levels: deepClone(source.levels ?? {}),
        equipment: deepClone(source.equipment ?? {}),
        food: deepClone(source.food ?? ["", "", ""]),
        drinks: deepClone(source.drinks ?? ["", "", ""]),
        abilities: deepClone(source.abilities ?? [
            { abilityHrid: "", level: 1 },
            { abilityHrid: "", level: 1 },
            { abilityHrid: "", level: 1 },
            { abilityHrid: "", level: 1 },
            { abilityHrid: "", level: 1 },
        ]),
        triggerMap: sanitizeTriggerMap(source.triggerMap ?? {}),
        houseRooms: deepClone(source.houseRooms ?? {}),
        achievements: deepClone(source.achievements ?? {}),
    };
}

function normalizeEquipmentSetSnapshot(rawSet, fallbackPlayerId = "1") {
    const source = isPlainObject(rawSet) ? rawSet : null;
    if (!source) {
        return null;
    }

    const fallback = createEmptyPlayerConfig(String(fallbackPlayerId || "1"));
    const normalized = deepClone(fallback);

    for (const key of LEVEL_KEYS) {
        normalized.levels[key] = Math.max(1, clampPositiveInteger(source.levels?.[key], fallback.levels[key] || 1));
    }

    for (const slot of EQUIPMENT_SLOT_KEYS) {
        const sourceSlot = source.equipment?.[slot] ?? {};
        const rawItemHrid = sourceSlot.itemHrid ?? sourceSlot.equipment ?? "";
        normalized.equipment[slot] = {
            itemHrid: String(rawItemHrid || ""),
            enhancementLevel: clampPositiveInteger(sourceSlot.enhancementLevel, 0),
        };
    }

    normalized.food = [0, 1, 2].map((index) => {
        const value = source.food?.[index] ?? source.food?.[String(index)] ?? "";
        return String(value || "");
    });

    normalized.drinks = [0, 1, 2].map((index) => {
        const value = source.drinks?.[index] ?? source.drinks?.[String(index)] ?? "";
        return String(value || "");
    });

    normalized.abilities = [0, 1, 2, 3, 4].map((index) => {
        const sourceAbility = source.abilities?.[index] ?? source.abilities?.[String(index)] ?? {};
        return {
            abilityHrid: String(sourceAbility.abilityHrid ?? sourceAbility.ability ?? ""),
            level: Math.max(1, clampPositiveInteger(sourceAbility.level, 1)),
        };
    });

    normalized.triggerMap = sanitizeTriggerMap(source.triggerMap ?? {});

    normalized.houseRooms = isPlainObject(source.houseRooms)
        ? deepClone(source.houseRooms)
        : deepClone(fallback.houseRooms);

    normalized.achievements = isPlainObject(source.achievements)
        ? deepClone(source.achievements)
        : {};

    return normalized;
}

function normalizeEquipmentSetQueueChangeTarget(rawTarget) {
    if (!isPlainObject(rawTarget)) {
        return null;
    }

    const kind = String(rawTarget.kind || "");
    if (kind === "level") {
        const key = String(rawTarget.key || "");
        if (!LEVEL_KEYS.includes(key)) {
            return null;
        }
        return {
            kind: "level",
            key,
            level: Math.max(1, clampPositiveInteger(rawTarget.level, 1)),
        };
    }

    if (kind === "equipment") {
        const slot = String(rawTarget.slot || "");
        if (!EQUIPMENT_SLOT_KEYS.includes(slot)) {
            return null;
        }
        return {
            kind: "equipment",
            slot,
            itemHrid: String(rawTarget.itemHrid || ""),
            enhancementLevel: clampPositiveInteger(rawTarget.enhancementLevel, 0),
        };
    }

    if (kind === "food" || kind === "drink") {
        const index = Math.floor(toFiniteNumber(rawTarget.index, -1));
        if (!Number.isInteger(index) || index < 0 || index > 2) {
            return null;
        }
        return {
            kind,
            index,
            itemHrid: String(rawTarget.itemHrid || ""),
        };
    }

    if (kind === "ability") {
        const index = Math.floor(toFiniteNumber(rawTarget.index, -1));
        if (!Number.isInteger(index) || index < 0 || index > 4) {
            return null;
        }
        return {
            kind: "ability",
            index,
            abilityHrid: String(rawTarget.abilityHrid || ""),
            level: Math.max(1, clampPositiveInteger(rawTarget.level, 1)),
        };
    }

    return null;
}

function normalizeEquipmentSetQueueChanges(rawQueueChanges) {
    const source = isPlainObject(rawQueueChanges) ? rawQueueChanges : {};
    const rawItems = Array.isArray(source.items) ? source.items : [];
    const normalizedItems = [];

    for (let i = 0; i < rawItems.length; i++) {
        const rawItem = isPlainObject(rawItems[i]) ? rawItems[i] : {};
        const itemName = String(rawItem.name || "").trim();
        const rawTargets = Array.isArray(rawItem.targets) ? rawItem.targets : [];
        const targets = rawTargets
            .map((rawTarget) => normalizeEquipmentSetQueueChangeTarget(rawTarget))
            .filter((target) => Boolean(target));
        if (targets.length <= 0) {
            continue;
        }
        normalizedItems.push({
            name: itemName || `Variant ${normalizedItems.length + 1}`,
            targets,
        });
    }

    return {
        version: EQUIPMENT_SET_QUEUE_CHANGES_VERSION,
        items: normalizedItems,
    };
}

function serializeQueueChangeToTarget(change) {
    if (!isPlainObject(change)) {
        return null;
    }

    if (change.kind === "level") {
        return normalizeEquipmentSetQueueChangeTarget({
            kind: "level",
            key: String(change.key || ""),
            level: Number(change.afterLevel),
        });
    }
    if (change.kind === "equipment") {
        return normalizeEquipmentSetQueueChangeTarget({
            kind: "equipment",
            slot: String(change.slot || ""),
            itemHrid: String(change.afterItemHrid || ""),
            enhancementLevel: Number(change.afterEnhancementLevel || 0),
        });
    }
    if (change.kind === "food" || change.kind === "drink") {
        return normalizeEquipmentSetQueueChangeTarget({
            kind: change.kind,
            index: Number(change.index),
            itemHrid: String(change.afterItemHrid || ""),
        });
    }
    if (change.kind === "ability") {
        return normalizeEquipmentSetQueueChangeTarget({
            kind: "ability",
            index: Number(change.index),
            abilityHrid: String(change.afterAbilityHrid || ""),
            level: Number(change.afterLevel || 1),
        });
    }
    return null;
}

function buildEquipmentSetQueueChangesFromQueueState(queueState) {
    const baselineSnapshot = queueState?.baseline?.snapshot ?? null;
    const queueItems = Array.isArray(queueState?.items) ? queueState.items : [];
    if (!baselineSnapshot || queueItems.length <= 0) {
        return {
            version: EQUIPMENT_SET_QUEUE_CHANGES_VERSION,
            items: [],
        };
    }

    const serializedItems = [];
    for (let i = 0; i < queueItems.length; i++) {
        const item = queueItems[i];
        const diff = computeQueueChangeSummary(baselineSnapshot, item?.snapshot);
        const targets = (Array.isArray(diff?.changes) ? diff.changes : [])
            .map((change) => serializeQueueChangeToTarget(change))
            .filter((target) => Boolean(target));
        if (targets.length <= 0) {
            continue;
        }

        const fallbackName = deriveQueueVariantNameFromLabels(diff?.labels, serializedItems.length + 1);
        serializedItems.push({
            name: String(item?.name || "").trim() || fallbackName,
            targets,
        });
    }

    return {
        version: EQUIPMENT_SET_QUEUE_CHANGES_VERSION,
        items: serializedItems,
    };
}

function applyQueueChangeTargetToSnapshot(snapshot, target) {
    if (!snapshot || !target) {
        return false;
    }

    if (target.kind === "level") {
        const levelKey = String(target.key || "");
        if (!LEVEL_KEYS.includes(levelKey)) {
            return false;
        }
        snapshot.levels[levelKey] = Math.max(1, clampPositiveInteger(target.level, 1));
        return true;
    }

    if (target.kind === "equipment") {
        const slot = String(target.slot || "");
        if (!EQUIPMENT_SLOT_KEYS.includes(slot)) {
            return false;
        }
        snapshot.equipment[slot] = {
            itemHrid: String(target.itemHrid || ""),
            enhancementLevel: clampPositiveInteger(target.enhancementLevel, 0),
        };
        return true;
    }

    if (target.kind === "food" || target.kind === "drink") {
        const index = Math.floor(toFiniteNumber(target.index, -1));
        if (!Number.isInteger(index) || index < 0 || index > 2) {
            return false;
        }
        snapshot[target.kind][index] = String(target.itemHrid || "");
        return true;
    }

    if (target.kind === "ability") {
        const index = Math.floor(toFiniteNumber(target.index, -1));
        if (!Number.isInteger(index) || index < 0 || index > 4) {
            return false;
        }
        snapshot.abilities[index] = {
            abilityHrid: String(target.abilityHrid || ""),
            level: Math.max(1, clampPositiveInteger(target.level, 1)),
        };
        return true;
    }

    return false;
}

function buildQueueItemsFromQueueChangeTemplates(baseSnapshot, queueChangeItems = []) {
    if (!baseSnapshot || !Array.isArray(queueChangeItems) || queueChangeItems.length <= 0) {
        return [];
    }

    const builtItems = [];
    for (let index = 0; index < queueChangeItems.length; index++) {
        const queueChangeItem = isPlainObject(queueChangeItems[index]) ? queueChangeItems[index] : {};
        const targets = Array.isArray(queueChangeItem.targets) ? queueChangeItem.targets : [];
        const targetSnapshot = deepClone(baseSnapshot);
        let appliedCount = 0;
        for (const target of targets) {
            if (applyQueueChangeTargetToSnapshot(targetSnapshot, target)) {
                appliedCount += 1;
            }
        }
        if (appliedCount <= 0) {
            continue;
        }

        const summary = computeQueueChangeSummary(baseSnapshot, targetSnapshot);
        if (summary.count <= 0) {
            continue;
        }

        builtItems.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: String(queueChangeItem.name || "").trim() || deriveQueueVariantNameFromLabels(summary.labels, builtItems.length + 1),
            snapshot: targetSnapshot,
            changes: Array.isArray(summary.labels) ? summary.labels : [],
            changeDetails: Array.isArray(summary.changes) ? deepClone(summary.changes) : [],
            createdAt: Date.now(),
        });
    }

    return builtItems;
}

function loadEquipmentSetsFromStorage() {
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

    persistEquipmentSetsToStorage(normalized);
    return normalized;
}

function persistEquipmentSetsToStorage(equipmentSets) {
    if (typeof localStorage === "undefined") {
        return;
    }
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
    localStorage.setItem(EQUIPMENT_SET_STORAGE_KEY, JSON.stringify(normalized));
}

function createQueuePlayerState() {
    return {
        baseline: null,
        items: [],
        results: [],
        rawRuns: [],
        ranking: [],
        enhancementUpgradeCosts: {},
        abilityUpgradeCosts: {},
        settings: {
            rounds: 30,
            medianBlend: 0.5,
            weightProfit: 0.5,
            weightXp: 0.3,
            weightDeathSafety: 0.2,
            executionMode: "parallel",
        },
        isRunning: false,
        progress: 0,
        error: "",
        lastRunAt: 0,
        lastRunStatus: "idle",
        runId: 0,
        cancelRequested: false,
    };
}

function buildQueuePartySelectedPlayers(players = [], activePlayerId = "1") {
    const normalizedActivePlayerId = String(activePlayerId || "1");
    const safePlayers = Array.isArray(players) ? players : [];
    const selectedPlayers = [];
    let activeIncluded = false;

    for (const player of safePlayers) {
        if (!player) {
            continue;
        }

        const clonedPlayer = deepClone(player);
        const isActivePlayer = String(clonedPlayer.id || "") === normalizedActivePlayerId;
        if (!isActivePlayer && clonedPlayer.selected !== true) {
            continue;
        }

        clonedPlayer.selected = true;
        selectedPlayers.push(clonedPlayer);
        activeIncluded = activeIncluded || isActivePlayer;
    }

    if (!activeIncluded) {
        const activePlayer = safePlayers.find((player) => String(player?.id || "") === normalizedActivePlayerId);
        if (activePlayer) {
            const clonedPlayer = deepClone(activePlayer);
            clonedPlayer.selected = true;
            selectedPlayers.unshift(clonedPlayer);
        }
    }

    return selectedPlayers;
}

function buildQueuePartyComparisonPlayers(players = [], activePlayerId = "1") {
    const normalizedActivePlayerId = String(activePlayerId || "1");
    return buildQueuePartySelectedPlayers(players, activePlayerId)
        .filter((player) => String(player?.id || "") !== normalizedActivePlayerId)
        .map((player) => ({
            ...deepClone(player),
            selected: true,
        }))
        .sort((left, right) => String(left?.id || "").localeCompare(String(right?.id || "")));
}

function buildQueuePartySignature(players = [], activePlayerId = "1") {
    return JSON.stringify(buildQueuePartyComparisonPlayers(players, activePlayerId));
}

function createQueuePartySnapshot(players = [], activePlayerId = "1") {
    const selectedPlayers = buildQueuePartySelectedPlayers(players, activePlayerId);
    return {
        selectedPlayers,
        signature: buildQueuePartySignature(selectedPlayers, activePlayerId),
        createdAt: Date.now(),
    };
}

function normalizeAdvisorFilters(rawFilters = {}) {
    const source = isPlainObject(rawFilters) ? rawFilters : {};
    return {
        includeGroupZones: source.includeGroupZones !== false,
        includeSoloZones: Boolean(source.includeSoloZones),
        refineTopEnabled: source.refineTopEnabled !== false,
        refineTopCount: clamp(
            Math.floor(toFiniteNumber(source.refineTopCount, ADVISOR_REFINE_TOP_COUNT_DEFAULT)),
            ADVISOR_REFINE_TOP_COUNT_MIN,
            ADVISOR_REFINE_TOP_COUNT_MAX
        ),
        refineRounds: clamp(
            Math.floor(toFiniteNumber(source.refineRounds, ADVISOR_REFINE_ROUNDS_DEFAULT)),
            ADVISOR_REFINE_ROUNDS_MIN,
            ADVISOR_REFINE_ROUNDS_MAX
        ),
    };
}

function createAdvisorState() {
    return {
        filters: normalizeAdvisorFilters(),
        goalPreset: ADVISOR_GOAL_PRESET_BALANCED,
        customWeights: getAdvisorPresetWeights(ADVISOR_GOAL_PRESET_BALANCED),
        quickRows: [],
        refinedRows: [],
        topCards: [],
        metricPlayerId: "",
        metricPlayerName: "",
        runtime: {
            isRunning: false,
            phase: "idle",
            progress: 0,
            startedAt: 0,
            elapsedSeconds: 0,
            quickCompleted: 0,
            quickTotal: 0,
            refineCompleted: 0,
            refineTotal: 0,
            lastRunAt: 0,
            runId: 0,
            cancelRequested: false,
        },
        error: "",
    };
}

function buildAdvisorTargetId(targetType, targetHrid, targetLevel) {
    return `${String(targetType || "zone")}:${String(targetHrid || "")}#${Math.floor(toFiniteNumber(targetLevel, 0))}`;
}

function createAdvisorZoneCandidate(zoneTarget, category, order) {
    const zoneHrid = String(zoneTarget?.zoneHrid || "");
    const difficultyTier = Math.max(0, Math.floor(toFiniteNumber(zoneTarget?.difficultyTier, 0)));
    return {
        id: buildAdvisorTargetId("zone", zoneHrid, difficultyTier),
        order,
        targetType: "zone",
        category,
        targetHrid: zoneHrid,
        targetName: getIndexedActionName(zoneHrid, zoneHrid),
        difficultyTier,
        roomLevel: null,
        isRefined: false,
        refineRounds: 0,
        successfulRounds: 0,
    };
}

function resolveAdvisorMetricPlayer(selectedPlayers = [], preferredPlayerId = "1") {
    const safePlayers = Array.isArray(selectedPlayers) ? selectedPlayers.filter(Boolean) : [];
    const normalizedPreferredId = String(preferredPlayerId || "1");
    const preferredPlayer = safePlayers.find((player) => String(player?.id || "") === normalizedPreferredId);
    const fallbackPlayer = preferredPlayer || safePlayers[0] || null;
    const resolvedId = String(fallbackPlayer?.id || normalizedPreferredId || "1");
    return {
        id: resolvedId,
        name: String(fallbackPlayer?.name || `Player ${resolvedId}`),
    };
}

function summarizeAdvisorTargetResult(simResult, selectedPlayers, preferredPlayerId, pricingOptions = {}) {
    const playerRows = summarizeResult(simResult, selectedPlayers, pricingOptions);
    const hours = Math.max(1e-9, Number(simResult?.simulatedTime ?? 0) / ONE_HOUR);
    const metricPlayer = resolveAdvisorMetricPlayer(selectedPlayers, preferredPlayerId);
    const metricPlayerHrid = toPlayerHrid(metricPlayer.id);
    const metricRow = playerRows.find((row) => row?.playerHrid === metricPlayerHrid) || playerRows[0] || null;
    return {
        playerRows,
        metricPlayerId: metricPlayer.id,
        metricPlayerName: metricPlayer.name,
        profitPerHour: toFiniteNumber(metricRow?.profitPerHour, 0),
        xpPerHour: toFiniteNumber(metricRow?.totalXpPerHour, 0),
        killsPerHour: playerRows.length > 0
            ? toFiniteNumber(playerRows[0]?.encountersPerHour, 0)
            : (toFiniteNumber(simResult?.encounters, 0) / hours),
        deathsPerHour: toFiniteNumber(metricRow?.deathsPerHour, 0),
    };
}

function buildAdvisorBaseRow(candidate, sample) {
    return {
        ...candidate,
        profitPerHour: toFiniteNumber(sample?.profitPerHour, 0),
        xpPerHour: toFiniteNumber(sample?.xpPerHour, 0),
        killsPerHour: toFiniteNumber(sample?.killsPerHour, 0),
        deathsPerHour: toFiniteNumber(sample?.deathsPerHour, 0),
        reasons: [],
        normalizedMetrics: {
            profitPerHour: 0,
            xpPerHour: 0,
            killsPerHour: 0,
            safety: 0,
        },
        finalScore: 0,
        baseFinalScore: 0,
        confidenceScore: null,
        confidencePenaltyFactor: 1,
        stabilityScore: 50,
        metricSummary: null,
    };
}

function buildAdvisorCandidates(filters = {}) {
    const normalizedFilters = normalizeAdvisorFilters(filters);
    const candidates = [];
    let order = 0;

    if (normalizedFilters.includeSoloZones) {
        const soloTargets = buildZoneTargetsByScope(RUN_SCOPE_ALL_SOLO_ZONES);
        for (const zoneTarget of soloTargets) {
            candidates.push(createAdvisorZoneCandidate(zoneTarget, "solo_zone", order));
            order += 1;
        }
    }

    if (normalizedFilters.includeGroupZones) {
        const groupTargets = buildZoneTargetsByScope(RUN_SCOPE_ALL_GROUP_ZONES);
        for (const zoneTarget of groupTargets) {
            candidates.push(createAdvisorZoneCandidate(zoneTarget, "group_zone", order));
            order += 1;
        }
    }

    return candidates;
}

function createAdvisorSimulationPayload(candidate, players, simulationTimeLimit, extra) {
    return {
        type: "start_simulation",
        workerId: Math.floor(Math.random() * 1e9).toString(),
        players,
        zone: {
            zoneHrid: candidate.targetHrid,
            difficultyTier: Math.max(0, Math.floor(toFiniteNumber(candidate.difficultyTier, 0))),
        },
        labyrinth: null,
        simulationTimeLimit,
        extra,
    };
}

function buildAdvisorRowFromRoundMetrics(candidate, roundMetrics = [], options = {}) {
    const safeRounds = Array.isArray(roundMetrics) ? roundMetrics.filter(Boolean) : [];
    const metricSummary = buildAdvisorMetricSummary(safeRounds);
    const fallbackSample = safeRounds[safeRounds.length - 1] || {};
    const profitSummary = metricSummary?.profitPerHour || {};
    const xpSummary = metricSummary?.xpPerHour || {};
    const killsSummary = metricSummary?.killsPerHour || {};
    const deathsSummary = metricSummary?.deathsPerHour || {};
    const sample = {
        profitPerHour: Number.isFinite(profitSummary.robustMean) ? profitSummary.robustMean : fallbackSample?.profitPerHour,
        xpPerHour: Number.isFinite(xpSummary.robustMean) ? xpSummary.robustMean : fallbackSample?.xpPerHour,
        killsPerHour: Number.isFinite(killsSummary.robustMean) ? killsSummary.robustMean : fallbackSample?.killsPerHour,
        deathsPerHour: Number.isFinite(deathsSummary.robustMean) ? deathsSummary.robustMean : fallbackSample?.deathsPerHour,
    };

    return {
        ...buildAdvisorBaseRow(candidate, sample),
        isRefined: options.isRefined === true,
        refineRounds: Math.max(0, Math.floor(toFiniteNumber(options.refineRounds, candidate?.refineRounds ?? 0))),
        successfulRounds: safeRounds.length,
        metricSummary,
    };
}

function buildAdvisorPartialErrorText(stageLabel, failedCandidates = []) {
    const safeStageLabel = String(stageLabel || "scan");
    const failedCount = Array.isArray(failedCandidates) ? failedCandidates.length : 0;
    if (failedCount <= 0) {
        return "";
    }
    return `${failedCount} target(s) failed during ${safeStageLabel}. Showing successful results only.`;
}

function createQueueStateByPlayer(playerList) {
    const stateByPlayer = {};
    for (const player of playerList) {
        stateByPlayer[String(player.id)] = createQueuePlayerState();
    }
    return stateByPlayer;
}

function createImportedProfileByPlayer() {
    const importedByPlayer = {};
    for (const playerId of QUEUE_PLAYER_IDS) {
        importedByPlayer[playerId] = false;
    }
    return importedByPlayer;
}

function createImportedBaselineByPlayer() {
    const baselineByPlayer = {};
    for (const playerId of QUEUE_PLAYER_IDS) {
        baselineByPlayer[playerId] = null;
    }
    return baselineByPlayer;
}

function getEquipmentTransitionCostKey(slotKey, beforeItemHrid, beforeLevel, afterItemHrid, afterLevel) {
    return `${slotKey}|${beforeItemHrid}|${beforeLevel}|${afterItemHrid}|${afterLevel}`;
}

function readEquipmentTransitionCostFromMap(costMap, slotKey, beforeItemHrid, beforeLevel, afterItemHrid, afterLevel) {
    const transitionCostKey = getEquipmentTransitionCostKey(slotKey, beforeItemHrid, beforeLevel, afterItemHrid, afterLevel);

    if (Object.prototype.hasOwnProperty.call(costMap, transitionCostKey)) {
        return {
            value: costMap[transitionCostKey],
            transitionCostKey,
        };
    }

    return {
        value: null,
        transitionCostKey,
    };
}

function writeEquipmentTransitionCostToMap(costMap, slotKey, beforeItemHrid, beforeLevel, afterItemHrid, afterLevel, value) {
    const transitionCostKey = getEquipmentTransitionCostKey(slotKey, beforeItemHrid, beforeLevel, afterItemHrid, afterLevel);
    costMap[transitionCostKey] = value;

    return transitionCostKey;
}

function getAbilityUpgradeCostKey(abilitySlot, abilityHrid, fromLevel, toLevel) {
    return `${abilitySlot}|${abilityHrid}|${fromLevel}|${toLevel}`;
}

function formatQueueSkillNameFromKey(skillKey) {
    const normalized = String(skillKey || "").trim().toLowerCase();
    if (!normalized) {
        return "";
    }
    const map = {
        stamina: "Stamina",
        intelligence: "Intelligence",
        attack: "Attack",
        melee: "Melee",
        defense: "Defense",
        ranged: "Ranged",
        magic: "Magic",
    };
    if (map[normalized]) {
        return map[normalized];
    }
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatQueueItemNameFromHrid(itemHrid) {
    const hrid = String(itemHrid || "");
    if (!hrid) {
        return "None";
    }
    return getIndexedItemName(hrid, hrid);
}

function formatQueueAbilityNameFromHrid(abilityHrid) {
    const hrid = String(abilityHrid || "");
    if (!hrid) {
        return "None";
    }
    return getIndexedAbilityName(hrid, hrid);
}

function formatQueueEquipmentSlotName(slotKey) {
    const normalized = String(slotKey || "").trim().toLowerCase();
    const map = {
        head: "Head",
        body: "Body",
        legs: "Legs",
        feet: "Feet",
        hands: "Hands",
        weapon: "Weapon",
        off_hand: "Off Hand",
        pouch: "Pouch",
        neck: "Neck",
        earrings: "Earrings",
        ring: "Ring",
        back: "Back",
        charm: "Charm",
    };
    if (map[normalized]) {
        return map[normalized];
    }
    return normalized || "Equipment";
}

function formatQueueHouseRoomNameFromHrid(roomHrid) {
    const hrid = String(roomHrid || "");
    if (!hrid) {
        return "House Room";
    }
    return getIndexedHouseRoomName(hrid, hrid);
}

function computeQueueChangeSummary(baselinePlayer, candidatePlayer) {
    const baseline = baselinePlayer || {};
    const candidate = candidatePlayer || {};
    const labels = [];
    const changes = [];

    const pushChange = (label, change) => {
        labels.push(label);
        changes.push(change);
    };

    for (const key of LEVEL_KEYS) {
        const before = Number(baseline?.levels?.[key] ?? 1);
        const after = Number(candidate?.levels?.[key] ?? 1);
        if (before !== after) {
            pushChange(`${formatQueueSkillNameFromKey(key)} Level: ${before} -> ${after}`, {
                kind: "level",
                key,
                beforeLevel: before,
                afterLevel: after,
            });
        }
    }

    for (const slot of EQUIPMENT_SLOT_KEYS) {
        const beforeSlot = baseline?.equipment?.[slot] ?? { itemHrid: "", enhancementLevel: 0 };
        const afterSlot = candidate?.equipment?.[slot] ?? { itemHrid: "", enhancementLevel: 0 };
        const beforeItem = String(beforeSlot.itemHrid || "");
        const afterItem = String(afterSlot.itemHrid || "");
        const beforeEnh = Number(beforeSlot.enhancementLevel || 0);
        const afterEnh = Number(afterSlot.enhancementLevel || 0);

        if (beforeItem !== afterItem || beforeEnh !== afterEnh) {
            pushChange(
                `${formatQueueEquipmentSlotName(slot)}: ${formatQueueItemNameFromHrid(beforeItem)}(+${beforeEnh}) -> ${formatQueueItemNameFromHrid(afterItem)}(+${afterEnh})`,
                {
                kind: "equipment",
                slot,
                beforeItemHrid: beforeItem,
                afterItemHrid: afterItem,
                beforeEnhancementLevel: beforeEnh,
                afterEnhancementLevel: afterEnh,
                }
            );
        }
    }

    for (let i = 0; i < 3; i++) {
        const beforeFood = String(baseline?.food?.[i] || "");
        const afterFood = String(candidate?.food?.[i] || "");
        if (beforeFood !== afterFood) {
            pushChange(`Food ${i + 1}: ${formatQueueItemNameFromHrid(beforeFood)} -> ${formatQueueItemNameFromHrid(afterFood)}`, {
                kind: "food",
                index: i,
                beforeItemHrid: beforeFood,
                afterItemHrid: afterFood,
            });
        }

        const beforeDrink = String(baseline?.drinks?.[i] || "");
        const afterDrink = String(candidate?.drinks?.[i] || "");
        if (beforeDrink !== afterDrink) {
            pushChange(`Drink ${i + 1}: ${formatQueueItemNameFromHrid(beforeDrink)} -> ${formatQueueItemNameFromHrid(afterDrink)}`, {
                kind: "drink",
                index: i,
                beforeItemHrid: beforeDrink,
                afterItemHrid: afterDrink,
            });
        }
    }

    for (let i = 0; i < 5; i++) {
        const beforeAbility = baseline?.abilities?.[i] ?? { abilityHrid: "", level: 1 };
        const afterAbility = candidate?.abilities?.[i] ?? { abilityHrid: "", level: 1 };
        const beforeHrid = String(beforeAbility.abilityHrid || "");
        const afterHrid = String(afterAbility.abilityHrid || "");
        const beforeLevel = Number(beforeAbility.level || 1);
        const afterLevel = Number(afterAbility.level || 1);

        if (beforeHrid !== afterHrid || beforeLevel !== afterLevel) {
            pushChange(
                `Ability ${i + 1}: ${formatQueueAbilityNameFromHrid(beforeHrid)}(Lv${beforeLevel}) -> ${formatQueueAbilityNameFromHrid(afterHrid)}(Lv${afterLevel})`,
                {
                kind: "ability",
                index: i,
                beforeAbilityHrid: beforeHrid,
                afterAbilityHrid: afterHrid,
                beforeLevel,
                afterLevel,
                }
            );
        }
    }

    for (const room of Object.values(houseRoomDetailIndex || {})) {
        const roomHrid = String(room?.hrid || "");
        if (!roomHrid) {
            continue;
        }

        const beforeLevel = Math.max(0, Math.floor(toFiniteNumber(baseline?.houseRooms?.[roomHrid], 0)));
        const afterLevel = Math.max(0, Math.floor(toFiniteNumber(candidate?.houseRooms?.[roomHrid], 0)));
        if (beforeLevel !== afterLevel) {
            pushChange(
                `${formatQueueHouseRoomNameFromHrid(roomHrid)}: Lv${beforeLevel} -> Lv${afterLevel}`,
                {
                    kind: "house_room",
                    roomHrid,
                    beforeLevel,
                    afterLevel,
                }
            );
        }
    }

    return {
        count: labels.length,
        labels,
        changes,
    };
}

function deriveQueueVariantNameFromLabels(labels, fallbackIndex = 1) {
    const safeLabels = (Array.isArray(labels) ? labels : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean);

    if (safeLabels.length === 1) {
        return safeLabels[0];
    }
    if (safeLabels.length > 1) {
        return `${safeLabels[0]} (+${safeLabels.length - 1})`;
    }
    return `Variant ${Math.max(1, Math.floor(toFiniteNumber(fallbackIndex, 1)))}`;
}

function applySingleQueueChange(snapshot, targetSnapshot, change) {
    if (!snapshot || !targetSnapshot || !change) {
        return false;
    }

    if (change.kind === "level") {
        const levelKey = String(change.key || "");
        if (!LEVEL_KEYS.includes(levelKey)) {
            return false;
        }
        snapshot.levels[levelKey] = Number(targetSnapshot?.levels?.[levelKey] ?? snapshot.levels[levelKey] ?? 1);
        return true;
    }

    if (change.kind === "equipment") {
        const slot = String(change.slot || "");
        if (!EQUIPMENT_SLOT_KEYS.includes(slot)) {
            return false;
        }
        snapshot.equipment[slot] = deepClone(targetSnapshot?.equipment?.[slot] ?? snapshot.equipment?.[slot] ?? {
            itemHrid: "",
            enhancementLevel: 0,
        });
        return true;
    }

    if (change.kind === "food") {
        const index = Number(change.index);
        if (!Number.isInteger(index) || index < 0 || index > 2) {
            return false;
        }
        snapshot.food[index] = String(targetSnapshot?.food?.[index] || "");
        return true;
    }

    if (change.kind === "drink") {
        const index = Number(change.index);
        if (!Number.isInteger(index) || index < 0 || index > 2) {
            return false;
        }
        snapshot.drinks[index] = String(targetSnapshot?.drinks?.[index] || "");
        return true;
    }

    if (change.kind === "ability") {
        const index = Number(change.index);
        if (!Number.isInteger(index) || index < 0 || index > 4) {
            return false;
        }
        snapshot.abilities[index] = deepClone(targetSnapshot?.abilities?.[index] ?? snapshot.abilities?.[index] ?? {
            abilityHrid: "",
            level: 1,
        });
        return true;
    }

    if (change.kind === "house_room") {
        const roomHrid = String(change.roomHrid || "");
        if (!roomHrid || !Object.prototype.hasOwnProperty.call(houseRoomDetailIndex || {}, roomHrid)) {
            return false;
        }
        if (!isPlainObject(snapshot.houseRooms)) {
            snapshot.houseRooms = {};
        }
        snapshot.houseRooms[roomHrid] = clampPositiveInteger(targetSnapshot?.houseRooms?.[roomHrid], 0);
        return true;
    }

    return false;
}

function buildQueueVariantSnapshotsFromChanges(baselineSnapshot, targetSnapshot, changeSummary) {
    const safeSummary = changeSummary && typeof changeSummary === "object" ? changeSummary : { count: 0, changes: [] };
    if (!baselineSnapshot || !targetSnapshot || safeSummary.count <= 0) {
        return [];
    }

    const changes = Array.isArray(safeSummary.changes) ? safeSummary.changes : [];
    if (changes.length <= 1) {
        const labels = Array.isArray(safeSummary.labels) ? safeSummary.labels : [];
        const changeDetails = Array.isArray(safeSummary.changes) ? deepClone(safeSummary.changes) : [];
        return [{
            snapshot: deepClone(targetSnapshot),
            labels,
            name: deriveQueueVariantNameFromLabels(labels, 1),
            changeDetails,
        }];
    }

    const variants = [];
    const seenSignatures = new Set();

    for (const change of changes) {
        const variantSnapshot = deepClone(baselineSnapshot);
        if (!applySingleQueueChange(variantSnapshot, targetSnapshot, change)) {
            continue;
        }

        const variantDiff = computeQueueChangeSummary(baselineSnapshot, variantSnapshot);
        if (variantDiff.count <= 0) {
            continue;
        }

        const signature = JSON.stringify(variantDiff.labels);
        if (seenSignatures.has(signature)) {
            continue;
        }
        seenSignatures.add(signature);
        const labels = Array.isArray(variantDiff.labels) ? variantDiff.labels : [];
        const changeDetails = Array.isArray(variantDiff.changes) ? deepClone(variantDiff.changes) : [];
        variants.push({
            snapshot: variantSnapshot,
            labels,
            name: deriveQueueVariantNameFromLabels(labels, variants.length + 1),
            changeDetails,
        });
    }

    if (variants.length === 0) {
        const labels = Array.isArray(safeSummary.labels) ? safeSummary.labels : [];
        const changeDetails = Array.isArray(safeSummary.changes) ? deepClone(safeSummary.changes) : [];
        return [{
            snapshot: deepClone(targetSnapshot),
            labels,
            name: deriveQueueVariantNameFromLabels(labels, 1),
            changeDetails,
        }];
    }

    return variants;
}

function summarizeQueueBaselineMetrics(summaryRow = null) {
    const encountersPerHour = Number(summaryRow?.encountersPerHour || 0);
    const totalXpPerHour = Number(summaryRow?.totalXpPerHour || 0);
    const profitPerHour = Number(summaryRow?.profitPerHour || 0);

    return {
        encountersPerHour,
        deathsPerHour: Number(summaryRow?.deathsPerHour || 0),
        totalXpPerHour,
        profitPerHour,
        dps: 0,
        killsPerHour: encountersPerHour,
        xpPerHour: totalXpPerHour,
        dailyProfit: profitPerHour * 24,
        dailyNoRngProfit: profitPerHour * 24,
    };
}

function getMean(values) {
    if (!values.length) {
        return 0;
    }
    return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function getMedian(values) {
    if (!values.length) {
        return 0;
    }
    const sorted = [...values].map((value) => Number(value || 0)).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
}

function getStdDev(values, meanValue) {
    if (!values.length) {
        return 0;
    }
    const variance = values.reduce((sum, value) => {
        const delta = Number(value || 0) - meanValue;
        return sum + delta * delta;
    }, 0) / values.length;
    return Math.sqrt(variance);
}

function resolveSimResultPlayerHrid(simResult, preferredPlayerId = "1") {
    const preferredPlayerHrid = toPlayerHrid(preferredPlayerId);
    const candidateMaps = [
        simResult?.experienceGained,
        simResult?.deaths,
        simResult?.attacks,
        simResult?.consumablesUsed,
    ];

    for (const sourceMap of candidateMaps) {
        if (sourceMap && Object.prototype.hasOwnProperty.call(sourceMap, preferredPlayerHrid)) {
            return preferredPlayerHrid;
        }
    }

    for (const sourceMap of candidateMaps) {
        if (!sourceMap || typeof sourceMap !== "object") {
            continue;
        }
        const firstKey = Object.keys(sourceMap).find((key) => String(key || "").startsWith("player"));
        if (firstKey) {
            return firstKey;
        }
    }

    return preferredPlayerHrid;
}

function toPlayerHrid(playerId = "1") {
    const normalizedPlayerId = String(playerId || "1").replace(/^player/i, "") || "1";
    return `player${normalizedPlayerId}`;
}

function computeQueueMetrics(simResult, preferredPlayerId, pricingOptions = {}) {
    const playerHrid = resolveSimResultPlayerHrid(simResult, preferredPlayerId);
    const simulatedHours = Math.max(1e-9, toFiniteNumber(simResult?.simulatedTime, 0) / ONE_HOUR);
    const simulatedSeconds = Math.max(1e-9, toFiniteNumber(simResult?.simulatedTime, 0) / ONE_SECOND);

    let totalDamage = 0;
    const playerAttacks = simResult?.attacks?.[playerHrid] ?? {};
    for (const attackSources of Object.values(playerAttacks)) {
        const sourceCasts = attackSources && typeof attackSources === "object" ? attackSources : {};
        for (const castMap of Object.values(sourceCasts)) {
            const castCounts = castMap && typeof castMap === "object" ? castMap : {};
            for (const [damageText, count] of Object.entries(castCounts)) {
                if (damageText === "miss") {
                    continue;
                }
                totalDamage += toFiniteNumber(damageText, 0) * toFiniteNumber(count, 0);
            }
        }
    }

    const totalExperience = Object.values(simResult?.experienceGained?.[playerHrid] ?? {})
        .reduce((sum, value) => sum + toFiniteNumber(value, 0), 0);

    const profit = estimateNoRngProfit(simResult, playerHrid, pricingOptions);
    const killsPerHour = toFiniteNumber(simResult?.encounters, 0) / simulatedHours;
    const dailyNoRngProfit = toFiniteNumber(profit?.profit, 0) / simulatedHours * 24;

    return {
        dps: toFiniteNumber(totalDamage / simulatedSeconds, 0),
        killsPerHour: toFiniteNumber(killsPerHour, 0),
        xpPerHour: toFiniteNumber(totalExperience / simulatedHours, 0),
        dailyProfit: toFiniteNumber(dailyNoRngProfit, 0),
        dailyNoRngProfit: toFiniteNumber(dailyNoRngProfit, 0),
    };
}

function computeQueueMetricDeltas(metrics = {}, baselineMetrics = {}) {
    const deltas = {};
    const metricKeys = Object.keys(metrics);
    for (const key of metricKeys) {
        const baselineValue = toFiniteNumber(baselineMetrics?.[key], 0);
        const currentValue = toFiniteNumber(metrics?.[key], 0);
        const deltaAbs = currentValue - baselineValue;
        const deltaPct = Math.abs(baselineValue) <= 1e-9 ? null : (deltaAbs / baselineValue) * 100;
        deltas[key] = {
            abs: toFiniteNumber(deltaAbs, 0),
            pct: Number.isFinite(deltaPct) ? deltaPct : null,
        };
    }
    return deltas;
}

function resolveItemPriceFromPricingState(pricingState, itemHrid, side = "ask") {
    const hrid = String(itemHrid || "");
    if (!hrid) {
        return 0;
    }

    const entry = pricingState?.priceTable?.[hrid] ?? {
        ask: -1,
        bid: -1,
        vendor: getVendorPriceByItemHrid(hrid),
    };
    const ask = toFiniteNumber(entry?.ask, -1);
    const bid = toFiniteNumber(entry?.bid, -1);
    const vendor = Math.max(0, toFiniteNumber(entry?.vendor, getVendorPriceByItemHrid(hrid)));

    if (side === "bid") {
        if (bid > 0) {
            return bid;
        }
        if (vendor > 0) {
            return vendor;
        }
        return ask > 0 ? ask : 0;
    }

    if (ask > 0) {
        return ask;
    }
    if (vendor > 0) {
        return vendor;
    }
    return bid > 0 ? bid : 0;
}

function computeEnhancementUpgradeCost(itemHrid, fromLevel, toLevel, pricingState) {
    const hrid = String(itemHrid || "");
    const safeFromLevel = Math.max(0, Math.floor(toFiniteNumber(fromLevel, 0)));
    const safeToLevel = Math.max(0, Math.floor(toFiniteNumber(toLevel, 0)));
    if (!hrid || safeToLevel <= safeFromLevel) {
        return 0;
    }

    const enhancementCosts = itemDetailIndex?.[hrid]?.enhancementCosts;
    if (!Array.isArray(enhancementCosts) || enhancementCosts.length === 0) {
        return 0;
    }

    const perLevelCost = enhancementCosts.reduce((sum, costEntry) => {
        const count = Math.max(0, toFiniteNumber(costEntry?.count, 0));
        const materialHrid = String(costEntry?.itemHrid || "");
        if (!materialHrid || count <= 0) {
            return sum;
        }
        const unitPrice = materialHrid === "/items/coin"
            ? 1
            : resolveItemPriceFromPricingState(pricingState, materialHrid, "ask");
        return sum + count * Math.max(0, unitPrice);
    }, 0);

    if (perLevelCost <= 0) {
        return 0;
    }
    return perLevelCost * (safeToLevel - safeFromLevel);
}

function resolveEnhancementLevelPriceFromPricingState(itemHrid, level, pricingState, preferredSide = "ask") {
    const hrid = String(itemHrid || "");
    const normalizedLevel = Math.max(0, Math.floor(toFiniteNumber(level, 0)));
    if (!hrid) {
        return -1;
    }

    const quoteMap = pricingState?.enhancementQuotesByItem?.[hrid];
    if (isPlainObject(quoteMap)) {
        const tryQuote = (targetLevel) => {
            const quote = quoteMap[String(targetLevel)];
            if (!isPlainObject(quote)) {
                return -1;
            }
            const ask = toFiniteNumber(quote.ask, -1);
            const bid = toFiniteNumber(quote.bid, -1);
            if (preferredSide === "bid") {
                return bid >= 0 ? bid : ask;
            }
            return ask >= 0 ? ask : bid;
        };

        const directPrice = tryQuote(normalizedLevel);
        if (directPrice >= 0) {
            return directPrice;
        }

        const candidateLevels = Object.keys(quoteMap)
            .map((value) => Math.floor(toFiniteNumber(value, -1)))
            .filter((value) => Number.isFinite(value) && value >= 0)
            .sort((a, b) => Math.abs(a - normalizedLevel) - Math.abs(b - normalizedLevel) || a - b);

        for (const candidateLevel of candidateLevels) {
            const candidatePrice = tryQuote(candidateLevel);
            if (candidatePrice >= 0) {
                return candidatePrice;
            }
        }
    }

    const basePrice = resolveItemPriceFromPricingState(
        pricingState,
        hrid,
        preferredSide === "bid" ? "bid" : "ask"
    );
    if (normalizedLevel <= 0) {
        return basePrice >= 0 ? basePrice : -1;
    }

    // Fallback for items without per-level market quotes.
    const enhancementCost = computeEnhancementUpgradeCost(hrid, 0, normalizedLevel, pricingState);
    const approximated = Math.max(0, basePrice + enhancementCost);
    return Number.isFinite(approximated) ? approximated : -1;
}

function computeDefaultEquipmentTransitionCost(beforeItemHrid, beforeLevel, afterItemHrid, afterLevel, pricingState) {
    const targetItemHrid = String(afterItemHrid || "");
    if (!targetItemHrid) {
        return 0;
    }

    const safeBeforeLevel = Math.max(0, Math.floor(toFiniteNumber(beforeLevel, 0)));
    const safeAfterLevel = Math.max(0, Math.floor(toFiniteNumber(afterLevel, 0)));
    let buyCost = resolveEnhancementLevelPriceFromPricingState(targetItemHrid, safeAfterLevel, pricingState, "ask");
    if (buyCost < 0) {
        buyCost = resolveItemPriceFromPricingState(pricingState, targetItemHrid, "ask")
            + computeEnhancementUpgradeCost(targetItemHrid, 0, safeAfterLevel, pricingState);
    }

    const sourceItemHrid = String(beforeItemHrid || "");
    let sellValue = 0;
    if (sourceItemHrid) {
        sellValue = resolveEnhancementLevelPriceFromPricingState(sourceItemHrid, safeBeforeLevel, pricingState, "bid");
        if (sellValue < 0) {
            sellValue = resolveItemPriceFromPricingState(pricingState, sourceItemHrid, "bid")
                + computeEnhancementUpgradeCost(sourceItemHrid, 0, safeBeforeLevel, pricingState);
        }
    }

    return Math.max(0, buyCost - sellValue);
}

function ensureAbilityUpgradeReferenceGlobals() {
    const target = typeof window !== "undefined" ? window : globalThis;
    if (!Array.isArray(target.jigsAbilityXpLevels)) {
        target.jigsAbilityXpLevels = [];
    }
    if (!target.jigsSpellBookXpByName || typeof target.jigsSpellBookXpByName !== "object" || Array.isArray(target.jigsSpellBookXpByName)) {
        target.jigsSpellBookXpByName = {};
    }
    return target;
}

function hasAbilityUpgradeReferenceDataLoaded() {
    const globalRef = ensureAbilityUpgradeReferenceGlobals();
    return Array.isArray(globalRef.jigsAbilityXpLevels) && globalRef.jigsAbilityXpLevels.length > 1;
}

function getAbilityXpForLevel(level) {
    const abilityXpLevels = ensureAbilityUpgradeReferenceGlobals().jigsAbilityXpLevels;
    if (!Array.isArray(abilityXpLevels)) {
        return null;
    }

    const normalizedLevel = Math.floor(toFiniteNumber(level, -1));
    if (!Number.isInteger(normalizedLevel) || normalizedLevel < 0 || normalizedLevel >= abilityXpLevels.length) {
        return null;
    }

    const xpValue = Number(abilityXpLevels[normalizedLevel]);
    return Number.isFinite(xpValue) ? xpValue : null;
}

function getSpellBookXpForAbility(abilityHrid) {
    const normalizedAbilityHrid = String(abilityHrid || "");
    if (!normalizedAbilityHrid) {
        return 0;
    }

    const directBookInfo = abilityBookInfoByAbilityHrid[normalizedAbilityHrid];
    if (directBookInfo?.xpPerBook > 0) {
        return directBookInfo.xpPerBook;
    }

    const abilityName = getIndexedAbilityName(normalizedAbilityHrid, "");
    if (!abilityName) {
        return 0;
    }

    const spellBookXpMap = ensureAbilityUpgradeReferenceGlobals().jigsSpellBookXpByName;
    if (!spellBookXpMap || typeof spellBookXpMap !== "object") {
        return 0;
    }

    const lowerAbilityName = abilityName.toLowerCase();
    const matchedKey = Object.keys(spellBookXpMap).find((key) => String(key || "").toLowerCase() === lowerAbilityName);
    const xpPerBook = matchedKey ? Number(spellBookXpMap[matchedKey]) : 0;
    return Number.isFinite(xpPerBook) && xpPerBook > 0 ? xpPerBook : 0;
}

function resolveAbilityBookPriceFromPricingState(pricingState, abilityHrid) {
    const normalizedAbilityHrid = String(abilityHrid || "");
    const bookItemHrid = String(abilityBookInfoByAbilityHrid?.[normalizedAbilityHrid]?.itemHrid || "");
    if (!bookItemHrid) {
        return null;
    }

    const dropMode = normalizePriceMode(pricingState?.dropMode, PRICE_MODE_BID);
    if (dropMode === PRICE_MODE_VENDOR) {
        const vendorFallback = toFiniteNumber(itemDetailIndex?.[bookItemHrid]?.sellPrice, 0);
        const vendorPrice = Math.max(0, toFiniteNumber(pricingState?.priceTable?.[bookItemHrid]?.vendor, vendorFallback));
        return Number.isFinite(vendorPrice) ? vendorPrice : null;
    }

    const side = dropMode === PRICE_MODE_ASK ? "ask" : "bid";
    const marketPrice = resolveItemPriceFromPricingState(pricingState, bookItemHrid, side);
    return Number.isFinite(marketPrice) ? Math.max(0, marketPrice) : null;
}

function computeDefaultAbilityUpgradeCost(baseAbility, toLevel, pricingState) {
    const abilityHrid = String(baseAbility?.abilityHrid || "");
    const fromLevel = Math.max(1, Math.floor(toFiniteNumber(baseAbility?.level, 1)));
    const targetLevel = Math.max(1, Math.floor(toFiniteNumber(toLevel, 1)));
    if (!abilityHrid || targetLevel <= fromLevel) {
        return 0;
    }

    const startXp = getAbilityXpForLevel(fromLevel);
    const endXp = getAbilityXpForLevel(targetLevel);
    if (startXp == null || endXp == null) {
        return null;
    }

    const xpNeeded = endXp - startXp;
    if (xpNeeded <= 0) {
        return 0;
    }

    const xpPerBook = getSpellBookXpForAbility(abilityHrid);
    if (!Number.isFinite(xpPerBook) || xpPerBook <= 0) {
        return null;
    }

    const booksNeeded = Math.ceil(xpNeeded / xpPerBook);
    if (!Number.isFinite(booksNeeded) || booksNeeded <= 0) {
        return 0;
    }

    const pricePerBook = resolveAbilityBookPriceFromPricingState(pricingState, abilityHrid);
    if (!Number.isFinite(pricePerBook) || pricePerBook < 0) {
        return null;
    }

    const totalCost = booksNeeded * pricePerBook;
    return totalCost > 0 ? totalCost : 0;
}

function normalizeHouseRoomLevelMap(source) {
    const normalizedSource = isPlainObject(source) ? source : {};
    const normalized = {};

    for (const room of Object.values(houseRoomDetailIndex || {})) {
        const roomHrid = String(room?.hrid || "");
        if (!roomHrid) {
            continue;
        }
        normalized[roomHrid] = clampPositiveInteger(normalizedSource[roomHrid], 0);
    }

    return normalized;
}

function resolveHouseRoomMaterialPricing(itemHrid, pricingState) {
    const normalizedItemHrid = String(itemHrid || "");
    if (!normalizedItemHrid) {
        return {
            unitPrice: 0,
            priced: false,
        };
    }

    if (normalizedItemHrid === "/items/coin") {
        return {
            unitPrice: 1,
            priced: true,
        };
    }

    const resolvedPrice = Math.max(0, toFiniteNumber(
        resolveItemPriceFromPricingState(pricingState, normalizedItemHrid, "ask"),
        0
    ));

    return {
        unitPrice: resolvedPrice,
        priced: resolvedPrice > 0,
    };
}

function buildHouseRoomUpgradeCostPreview(baseHouseRooms, targetHouseRooms, pricingState) {
    const normalizedBase = normalizeHouseRoomLevelMap(baseHouseRooms);
    const normalizedTarget = normalizeHouseRoomLevelMap(targetHouseRooms);
    const roomDetails = Object.values(houseRoomDetailIndex || {})
        .slice()
        .sort((left, right) => (
            Number(left?.sortIndex ?? 0) - Number(right?.sortIndex ?? 0)
            || String(left?.name || "").localeCompare(String(right?.name || ""))
        ));
    const roomRows = [];
    const materialCountMap = {};

    for (const room of roomDetails) {
        const roomHrid = String(room?.hrid || "");
        if (!roomHrid) {
            continue;
        }

        const fromLevel = clampPositiveInteger(normalizedBase[roomHrid], 0);
        const toLevel = clampPositiveInteger(normalizedTarget[roomHrid], 0);
        if (toLevel <= fromLevel) {
            continue;
        }

        const roomMaterialCountMap = {};
        const upgradeCostsMap = isPlainObject(room?.upgradeCostsMap) ? room.upgradeCostsMap : {};

        for (let level = fromLevel + 1; level <= toLevel; level++) {
            const levelCosts = Array.isArray(upgradeCostsMap[String(level)]) ? upgradeCostsMap[String(level)] : [];
            for (const costEntry of levelCosts) {
                const itemHrid = String(costEntry?.itemHrid || "");
                const count = Math.max(0, toFiniteNumber(costEntry?.count, 0));
                if (!itemHrid || count <= 0) {
                    continue;
                }

                roomMaterialCountMap[itemHrid] = toFiniteNumber(roomMaterialCountMap[itemHrid], 0) + count;
                materialCountMap[itemHrid] = toFiniteNumber(materialCountMap[itemHrid], 0) + count;
            }
        }

        const subtotal = Object.entries(roomMaterialCountMap).reduce((sum, [itemHrid, count]) => {
            const safeCount = Math.max(0, toFiniteNumber(count, 0));
            if (safeCount <= 0) {
                return sum;
            }
            const pricing = resolveHouseRoomMaterialPricing(itemHrid, pricingState);
            return sum + (pricing.priced ? safeCount * pricing.unitPrice : 0);
        }, 0);

        roomRows.push({
            roomHrid,
            fromLevel,
            toLevel,
            subtotal: toFiniteNumber(subtotal, 0),
        });
    }

    const materials = Object.entries(materialCountMap)
        .map(([itemHrid, count]) => {
            const safeCount = Math.max(0, toFiniteNumber(count, 0));
            const pricing = resolveHouseRoomMaterialPricing(itemHrid, pricingState);
            const subtotal = pricing.priced ? safeCount * pricing.unitPrice : 0;
            return {
                itemHrid,
                count: safeCount,
                unitPrice: pricing.unitPrice,
                subtotal: toFiniteNumber(subtotal, 0),
                priced: pricing.priced,
            };
        })
        .filter((entry) => entry.count > 0)
        .sort((left, right) => {
            if (left.itemHrid === "/items/coin" && right.itemHrid !== "/items/coin") {
                return -1;
            }
            if (right.itemHrid === "/items/coin" && left.itemHrid !== "/items/coin") {
                return 1;
            }
            return Number(right.subtotal || 0) - Number(left.subtotal || 0)
                || getIndexedItemName(left.itemHrid, left.itemHrid).localeCompare(
                    getIndexedItemName(right.itemHrid, right.itemHrid)
                );
        });

    const coinCost = materials.reduce((sum, entry) => (
        entry.itemHrid === "/items/coin" ? sum + entry.subtotal : sum
    ), 0);
    const materialValue = materials.reduce((sum, entry) => (
        entry.itemHrid !== "/items/coin" && entry.priced ? sum + entry.subtotal : sum
    ), 0);

    return {
        rooms: roomRows,
        materials,
        totals: {
            coinCost: toFiniteNumber(coinCost, 0),
            materialValue: toFiniteNumber(materialValue, 0),
            totalCost: toFiniteNumber(coinCost + materialValue, 0),
        },
    };
}

function computeQueueItemUpgradeCost(baselineSnapshot, targetSnapshot, pricingState, options = {}) {
    if (!baselineSnapshot || !targetSnapshot) {
        return 0;
    }

    const enhancementCostMap = isPlainObject(options?.enhancementCostMap) ? options.enhancementCostMap : {};
    const abilityCostMap = isPlainObject(options?.abilityCostMap) ? options.abilityCostMap : {};
    let totalCost = 0;
    let hasUnknownAbilityUpgradeCost = false;

    for (const slotKey of EQUIPMENT_SLOT_KEYS) {
        const beforeEquipment = baselineSnapshot?.equipment?.[slotKey] ?? { itemHrid: "", enhancementLevel: 0 };
        const afterEquipment = targetSnapshot?.equipment?.[slotKey] ?? { itemHrid: "", enhancementLevel: 0 };
        const beforeItemHrid = String(beforeEquipment?.itemHrid || "");
        const afterItemHrid = String(afterEquipment?.itemHrid || "");
        const beforeLevel = Math.max(0, Math.floor(toFiniteNumber(beforeEquipment?.enhancementLevel, 0)));
        const afterLevel = Math.max(0, Math.floor(toFiniteNumber(afterEquipment?.enhancementLevel, 0)));

        if (beforeItemHrid === afterItemHrid && beforeLevel === afterLevel) {
            continue;
        }

        const savedCostResult = readEquipmentTransitionCostFromMap(
            enhancementCostMap,
            slotKey,
            beforeItemHrid,
            beforeLevel,
            afterItemHrid,
            afterLevel
        );
        const estimatedCost = savedCostResult.value != null
            ? toFiniteNumber(savedCostResult.value, 0)
            : computeDefaultEquipmentTransitionCost(
                beforeItemHrid,
                beforeLevel,
                afterItemHrid,
                afterLevel,
                pricingState
            );

        totalCost += Math.max(0, estimatedCost);
    }

    for (let i = 0; i < 5; i++) {
        const beforeAbility = baselineSnapshot?.abilities?.[i] ?? { abilityHrid: "", level: 1 };
        const afterAbility = targetSnapshot?.abilities?.[i] ?? { abilityHrid: "", level: 1 };
        const beforeHrid = String(beforeAbility?.abilityHrid || "");
        const afterHrid = String(afterAbility?.abilityHrid || "");
        const beforeLevel = Math.max(1, Math.floor(toFiniteNumber(beforeAbility?.level, 1)));
        const afterLevel = Math.max(1, Math.floor(toFiniteNumber(afterAbility?.level, 1)));

        if (!afterHrid) {
            continue;
        }

        const fromLevel = beforeHrid && beforeHrid === afterHrid ? beforeLevel : 1;
        if (afterLevel <= fromLevel) {
            continue;
        }

        const costKey = getAbilityUpgradeCostKey(i, afterHrid, fromLevel, afterLevel);
        const defaultCost = computeDefaultAbilityUpgradeCost({
            abilityHrid: afterHrid,
            level: fromLevel,
        }, afterLevel, pricingState);
        let estimatedCost = null;
        if (Object.prototype.hasOwnProperty.call(abilityCostMap, costKey)) {
            estimatedCost = toFiniteNumber(abilityCostMap[costKey], 0);
        } else if (defaultCost == null) {
            hasUnknownAbilityUpgradeCost = true;
        } else {
            estimatedCost = toFiniteNumber(defaultCost, 0);
        }

        if (estimatedCost == null) {
            continue;
        }
        totalCost += Math.max(0, estimatedCost);
    }

    const houseRoomUpgradePreview = buildHouseRoomUpgradeCostPreview(
        baselineSnapshot?.houseRooms,
        targetSnapshot?.houseRooms,
        pricingState
    );
    totalCost += Math.max(0, toFiniteNumber(houseRoomUpgradePreview?.totals?.totalCost, 0));

    if (hasUnknownAbilityUpgradeCost) {
        return null;
    }

    return toFiniteNumber(totalCost, 0);
}

function computePurchaseDaysByBaselineProfit(upgradeCost, baselineDailyNoRngProfit) {
    const safeCost = toFiniteNumber(upgradeCost, 0);
    const safeBaselineProfit = toFiniteNumber(baselineDailyNoRngProfit, 0);
    if (safeCost <= 0 || safeBaselineProfit <= 0) {
        return null;
    }
    return safeCost / safeBaselineProfit;
}

function computeGoldPerPoint01Pct(upgradeCost, deltaInfo) {
    const safeCost = toFiniteNumber(upgradeCost, 0);
    if (safeCost <= 0 || deltaInfo?.pct == null) {
        return null;
    }
    const pctValue = Number(deltaInfo.pct);
    if (!Number.isFinite(pctValue) || pctValue <= 0) {
        return null;
    }
    return safeCost / (pctValue * 100);
}

function computePercentileFromSorted(sortedValues, percentile) {
    if (!Array.isArray(sortedValues) || sortedValues.length === 0) {
        return 0;
    }
    if (sortedValues.length === 1) {
        return sortedValues[0];
    }

    const clampedPercentile = clamp(toFiniteNumber(percentile, 0), 0, 1);
    const rawIndex = (sortedValues.length - 1) * clampedPercentile;
    const lowerIndex = Math.floor(rawIndex);
    const upperIndex = Math.ceil(rawIndex);
    if (lowerIndex === upperIndex) {
        return sortedValues[lowerIndex];
    }

    const interpolation = rawIndex - lowerIndex;
    return sortedValues[lowerIndex] + (sortedValues[upperIndex] - sortedValues[lowerIndex]) * interpolation;
}

function computeArithmeticMean(values, fallback = 0) {
    if (!Array.isArray(values) || values.length === 0) {
        return fallback;
    }
    return values.reduce((sum, value) => sum + toFiniteNumber(value, 0), 0) / values.length;
}

function winsorizeValues(values, winsorizePct = 0) {
    const numericValues = (values ?? []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
    if (numericValues.length === 0) {
        return [];
    }

    const safePct = clamp(toFiniteNumber(winsorizePct, 0), 0, 0.49);
    if (safePct <= 0 || numericValues.length < 3) {
        return [...numericValues];
    }

    const sorted = [...numericValues].sort((a, b) => a - b);
    const lower = computePercentileFromSorted(sorted, safePct);
    const upper = computePercentileFromSorted(sorted, 1 - safePct);
    return numericValues.map((value) => clamp(value, lower, upper));
}

function computeConfidenceFromValues(values, centerValue) {
    const numericValues = (values ?? []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
    const sampleCount = numericValues.length;
    if (sampleCount <= 1) {
        return 0;
    }

    const mean = computeArithmeticMean(numericValues, 0);
    const variance = numericValues.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / sampleCount;
    const std = Math.sqrt(Math.max(0, variance));
    const ciHalfWidth95 = 1.96 * std / Math.sqrt(sampleCount);
    const scaleBase = Math.max(Math.abs(toFiniteNumber(centerValue, 0)), std, 1e-6);
    const intervalConfidence = 1 / (1 + ciHalfWidth95 / scaleBase);

    const sizeScale = Math.max(1, toFiniteNumber(QUEUE_MULTI_ROUND_CONFIDENCE_SIZE_SCALE, 8));
    const sizeConfidence = 1 - Math.exp(-1 * (sampleCount - 1) / sizeScale);
    return clamp(intervalConfidence * sizeConfidence, 0, 1);
}

function summarizeMetric(values, deltaPctValues) {
    const safeValues = (values ?? []).map((value) => toFiniteNumber(value, 0));
    const blendWeight = clamp(toFiniteNumber(QUEUE_MULTI_ROUND_MEDIAN_BLEND_WEIGHT, 0.5), 0, 1);
    const meanWeight = 1 - blendWeight;
    if (safeValues.length === 0) {
        return {
            mean: 0,
            winsorizedMean: 0,
            robustMean: 0,
            min: 0,
            max: 0,
            std: 0,
            p50: 0,
            p90: 0,
            cv: 1,
            robustCv: 1,
            meanDeltaPct: 0,
            rawMeanDeltaPct: 0,
            winsorizedMeanDeltaPct: 0,
            medianDeltaPct: 0,
            robustMeanDeltaPct: 0,
            confidence: 0,
            confidenceDeltaPct: 0,
            sampleCount: 0,
            deltaSampleCount: 0,
        };
    }

    const rawMean = computeArithmeticMean(safeValues, 0);
    const winsorizedValues = winsorizeValues(safeValues, QUEUE_MULTI_ROUND_WINSORIZE_PCT);
    const winsorizedMean = computeArithmeticMean(winsorizedValues, rawMean);
    const sortedValues = [...winsorizedValues].sort((a, b) => a - b);
    const p50 = computePercentileFromSorted(sortedValues, 0.5);
    const p90 = computePercentileFromSorted(sortedValues, 0.9);
    const robustMean = meanWeight * winsorizedMean + blendWeight * p50;

    const min = Math.min(...winsorizedValues);
    const max = Math.max(...winsorizedValues);
    const variance = winsorizedValues.reduce((sum, value) => sum + ((value - robustMean) ** 2), 0) / winsorizedValues.length;
    const std = Math.sqrt(Math.max(0, variance));
    const robustCv = Math.abs(robustMean) > 1e-9 ? Math.abs(std / robustMean) : 1;
    const confidence = computeConfidenceFromValues(winsorizedValues, robustMean);

    const safeDeltaPctValues = (deltaPctValues ?? []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
    const rawMeanDeltaPct = computeArithmeticMean(safeDeltaPctValues, 0);
    const winsorizedDeltaPctValues = winsorizeValues(safeDeltaPctValues, QUEUE_MULTI_ROUND_WINSORIZE_PCT);
    const winsorizedMeanDeltaPct = computeArithmeticMean(winsorizedDeltaPctValues, rawMeanDeltaPct);
    const sortedDeltaValues = [...winsorizedDeltaPctValues].sort((a, b) => a - b);
    const medianDeltaPct = sortedDeltaValues.length > 0 ? computePercentileFromSorted(sortedDeltaValues, 0.5) : rawMeanDeltaPct;
    const robustMeanDeltaPct = meanWeight * winsorizedMeanDeltaPct + blendWeight * medianDeltaPct;
    const confidenceDeltaPct = computeConfidenceFromValues(winsorizedDeltaPctValues, robustMeanDeltaPct);

    return {
        mean: toFiniteNumber(rawMean, 0),
        winsorizedMean: toFiniteNumber(winsorizedMean, 0),
        robustMean: toFiniteNumber(robustMean, 0),
        min: toFiniteNumber(min, 0),
        max: toFiniteNumber(max, 0),
        std: toFiniteNumber(std, 0),
        p50: toFiniteNumber(p50, 0),
        p90: toFiniteNumber(p90, 0),
        cv: toFiniteNumber(robustCv, 1),
        robustCv: toFiniteNumber(robustCv, 1),
        meanDeltaPct: toFiniteNumber(robustMeanDeltaPct, 0),
        rawMeanDeltaPct: toFiniteNumber(rawMeanDeltaPct, 0),
        winsorizedMeanDeltaPct: toFiniteNumber(winsorizedMeanDeltaPct, 0),
        medianDeltaPct: toFiniteNumber(medianDeltaPct, 0),
        robustMeanDeltaPct: toFiniteNumber(robustMeanDeltaPct, 0),
        confidence: toFiniteNumber(confidence, 0),
        confidenceDeltaPct: toFiniteNumber(confidenceDeltaPct, 0),
        sampleCount: safeValues.length,
        deltaSampleCount: safeDeltaPctValues.length,
    };
}

function buildQueueItemMetricSummary(roundResults = []) {
    const metricSummary = {};
    for (const metricKey of QUEUE_MULTI_ROUND_METRIC_KEYS) {
        const metricValues = roundResults.map((result) => toFiniteNumber(result?.metrics?.[metricKey], 0));
        const deltaPctValues = roundResults.map((result) => Number(result?.deltas?.[metricKey]?.pct));
        metricSummary[metricKey] = summarizeMetric(metricValues, deltaPctValues);
    }
    return metricSummary;
}

function rankScoreList(rawValues, options = {}) {
    const higherIsBetter = options.higherIsBetter !== false;
    const logScale = Boolean(options.logScale);
    const invalidScore = toFiniteNumber(options.invalidScore, QUEUE_MULTI_ROUND_SCORE_INVALID);
    const tieScore = toFiniteNumber(options.tieScore, QUEUE_MULTI_ROUND_SCORE_TIE);
    const minScore = toFiniteNumber(options.minScore, QUEUE_MULTI_ROUND_SCORE_MIN);
    const maxScore = toFiniteNumber(options.maxScore, QUEUE_MULTI_ROUND_SCORE_MAX);
    const clampedMinScore = Math.min(minScore, maxScore);
    const clampedMaxScore = Math.max(minScore, maxScore);

    const preparedValues = rawValues.map((value) => {
        if (value == null) {
            return null;
        }
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return null;
        }
        if (logScale) {
            return Math.log1p(Math.max(0, numeric));
        }
        return numeric;
    });

    const invalidFlags = preparedValues.map((value) => value == null);
    const validEntries = preparedValues
        .map((value, index) => ({ value, index }))
        .filter((entry) => Number.isFinite(entry.value));

    if (validEntries.length === 0) {
        return {
            scores: rawValues.map(() => invalidScore),
            invalidFlags,
        };
    }
    if (validEntries.length === 1) {
        return {
            scores: preparedValues.map((value) => (value == null ? invalidScore : tieScore)),
            invalidFlags,
        };
    }

    validEntries.sort((a, b) => a.value - b.value);
    const rankByIndex = new Map();
    const tieEpsilon = 1e-12;
    let cursor = 0;
    while (cursor < validEntries.length) {
        let nextCursor = cursor;
        while (
            nextCursor + 1 < validEntries.length
            && Math.abs(validEntries[nextCursor + 1].value - validEntries[cursor].value) <= tieEpsilon
        ) {
            nextCursor += 1;
        }

        const averageRank = (cursor + nextCursor) / 2;
        for (let rankIndex = cursor; rankIndex <= nextCursor; rankIndex++) {
            rankByIndex.set(validEntries[rankIndex].index, averageRank);
        }
        cursor = nextCursor + 1;
    }

    const denominator = Math.max(1, validEntries.length - 1);
    const scoreRange = clampedMaxScore - clampedMinScore;
    const scores = preparedValues.map((value, index) => {
        if (value == null) {
            return invalidScore;
        }
        const rankValue = toFiniteNumber(rankByIndex.get(index), 0);
        const percentile = higherIsBetter ? rankValue / denominator : 1 - rankValue / denominator;
        const rankedScore = clampedMinScore + percentile * scoreRange;
        return clamp(rankedScore, clampedMinScore, clampedMaxScore);
    });

    return {
        scores,
        invalidFlags,
    };
}

function createEmptyQueueCostInsights() {
    return {
        totalUpgradeCost: null,
        purchaseDays: null,
        goldPerPoint01Pct: {},
        goldPerPoint01PctAvg: null,
    };
}

function buildQueueItemCostInsights(queueState, queueItemSnapshot, metricSummary, pricingState) {
    const baselineSnapshot = queueState?.baseline?.snapshot ?? null;
    const totalUpgradeCostRaw = computeQueueItemUpgradeCost(
        baselineSnapshot,
        queueItemSnapshot,
        pricingState,
        {
            enhancementCostMap: queueState?.enhancementUpgradeCosts,
            abilityCostMap: queueState?.abilityUpgradeCosts,
        }
    );
    const totalUpgradeCost = totalUpgradeCostRaw != null && Number.isFinite(Number(totalUpgradeCostRaw))
        ? Math.max(0, toFiniteNumber(totalUpgradeCostRaw, 0))
        : null;
    const purchaseDays = computePurchaseDaysByBaselineProfit(totalUpgradeCost, queueState?.baseline?.metrics?.dailyNoRngProfit);

    const goldPerPoint01Pct = {};
    for (const metricKey of QUEUE_MULTI_ROUND_METRIC_KEYS) {
        const robustDeltaPct = Number(metricSummary?.[metricKey]?.robustMeanDeltaPct);
        const fallbackDeltaPct = Number(metricSummary?.[metricKey]?.meanDeltaPct);
        const meanDeltaPct = Number.isFinite(robustDeltaPct) ? robustDeltaPct : fallbackDeltaPct;
        goldPerPoint01Pct[metricKey] = computeGoldPerPoint01Pct(totalUpgradeCost, { pct: meanDeltaPct });
    }

    const validGoldValues = Object.values(goldPerPoint01Pct).filter((value) => Number.isFinite(value) && value > 0);
    const goldPerPoint01PctAvg = validGoldValues.length > 0
        ? validGoldValues.reduce((sum, value) => sum + value, 0) / validGoldValues.length
        : null;

    return {
        totalUpgradeCost,
        purchaseDays,
        goldPerPoint01Pct,
        goldPerPoint01PctAvg,
    };
}

function buildMultiRoundRanking(metricSummaryByQueueItem, scoreWeights = getDefaultQueueRuntimeSettings().finalWeights) {
    const normalizedScoreWeights = normalizeQueueScoreWeights(scoreWeights);
    const normalizedScoresByMetric = {};
    const invalidFlagsByMetric = {};

    for (const metricKey of QUEUE_MULTI_ROUND_METRIC_KEYS) {
        const scoreValues = metricSummaryByQueueItem.map((entry) => {
            const robustDeltaPct = Number(entry.metricSummary?.[metricKey]?.robustMeanDeltaPct);
            const fallbackDeltaPct = Number(entry.metricSummary?.[metricKey]?.meanDeltaPct);
            if (Number.isFinite(robustDeltaPct)) {
                return robustDeltaPct;
            }
            if (Number.isFinite(fallbackDeltaPct)) {
                return fallbackDeltaPct;
            }
            return null;
        });

        const rankedMetricScores = rankScoreList(scoreValues, {
            higherIsBetter: true,
            tieScore: QUEUE_MULTI_ROUND_SCORE_TIE,
            invalidScore: QUEUE_MULTI_ROUND_SCORE_INVALID,
            minScore: QUEUE_MULTI_ROUND_SCORE_MIN,
            maxScore: QUEUE_MULTI_ROUND_SCORE_MAX,
        });
        normalizedScoresByMetric[metricKey] = rankedMetricScores.scores;
        invalidFlagsByMetric[metricKey] = rankedMetricScores.invalidFlags;
    }

    const stabilityRawValues = metricSummaryByQueueItem.map((entry) => {
        const cvValues = QUEUE_MULTI_ROUND_METRIC_KEYS
            .map((metricKey) => {
                const robustCv = Number(entry.metricSummary?.[metricKey]?.robustCv);
                const fallbackCv = Number(entry.metricSummary?.[metricKey]?.cv);
                if (Number.isFinite(robustCv)) {
                    return robustCv;
                }
                if (Number.isFinite(fallbackCv)) {
                    return fallbackCv;
                }
                return null;
            })
            .filter((value) => Number.isFinite(value));
        if (cvValues.length === 0) {
            return null;
        }
        return cvValues.reduce((sum, value) => sum + value, 0) / cvValues.length;
    });
    const stabilityScores = rankScoreList(stabilityRawValues, {
        higherIsBetter: false,
        tieScore: QUEUE_MULTI_ROUND_SCORE_TIE,
        invalidScore: QUEUE_MULTI_ROUND_SCORE_INVALID,
        minScore: QUEUE_MULTI_ROUND_SCORE_MIN,
        maxScore: QUEUE_MULTI_ROUND_SCORE_MAX,
    });

    const upgradeCostScores = rankScoreList(
        metricSummaryByQueueItem.map((entry) => entry.costInsights?.totalUpgradeCost),
        {
            higherIsBetter: false,
            logScale: true,
            tieScore: QUEUE_MULTI_ROUND_SCORE_TIE,
            invalidScore: QUEUE_MULTI_ROUND_SCORE_INVALID,
            minScore: QUEUE_MULTI_ROUND_SCORE_MIN,
            maxScore: QUEUE_MULTI_ROUND_SCORE_MAX,
        }
    );
    const purchaseDaysScores = rankScoreList(
        metricSummaryByQueueItem.map((entry) => entry.costInsights?.purchaseDays),
        {
            higherIsBetter: false,
            logScale: true,
            tieScore: QUEUE_MULTI_ROUND_SCORE_TIE,
            invalidScore: QUEUE_MULTI_ROUND_SCORE_INVALID,
            minScore: QUEUE_MULTI_ROUND_SCORE_MIN,
            maxScore: QUEUE_MULTI_ROUND_SCORE_MAX,
        }
    );
    const avgGoldScores = rankScoreList(
        metricSummaryByQueueItem.map((entry) => entry.costInsights?.goldPerPoint01PctAvg),
        {
            higherIsBetter: false,
            logScale: true,
            tieScore: QUEUE_MULTI_ROUND_SCORE_TIE,
            invalidScore: QUEUE_MULTI_ROUND_SCORE_INVALID,
            minScore: QUEUE_MULTI_ROUND_SCORE_MIN,
            maxScore: QUEUE_MULTI_ROUND_SCORE_MAX,
        }
    );

    const ranked = metricSummaryByQueueItem.map((entry, index) => {
        const performanceScores = QUEUE_MULTI_ROUND_METRIC_KEYS.map((metricKey) => (
            toFiniteNumber(normalizedScoresByMetric?.[metricKey]?.[index], QUEUE_MULTI_ROUND_SCORE_INVALID)
        ));
        const performanceScore = performanceScores.reduce((sum, value) => sum + value, 0) / Math.max(1, performanceScores.length);

        const performanceInvalidMetricKeys = QUEUE_MULTI_ROUND_METRIC_KEYS
            .filter((metricKey) => Boolean(invalidFlagsByMetric?.[metricKey]?.[index]));
        const performanceInvalid = performanceInvalidMetricKeys.length > 0;
        const stabilityScore = toFiniteNumber(stabilityScores?.scores?.[index], QUEUE_MULTI_ROUND_SCORE_INVALID);
        const stabilityInvalid = Boolean(stabilityScores?.invalidFlags?.[index]);

        const confidenceList = QUEUE_MULTI_ROUND_METRIC_KEYS.map((metricKey) => {
            const confidenceDeltaPct = Number(entry.metricSummary?.[metricKey]?.confidenceDeltaPct);
            const fallbackConfidence = Number(entry.metricSummary?.[metricKey]?.confidence);
            return clamp(toFiniteNumber(Number.isFinite(confidenceDeltaPct) ? confidenceDeltaPct : fallbackConfidence, 0), 0, 1);
        });
        const avgConfidence = confidenceList.reduce((sum, value) => sum + value, 0) / Math.max(1, confidenceList.length);

        const upgradeCostScore = toFiniteNumber(upgradeCostScores?.scores?.[index], QUEUE_MULTI_ROUND_SCORE_INVALID);
        const purchaseDaysScore = toFiniteNumber(purchaseDaysScores?.scores?.[index], QUEUE_MULTI_ROUND_SCORE_INVALID);
        const avgGoldScore = toFiniteNumber(avgGoldScores?.scores?.[index], QUEUE_MULTI_ROUND_SCORE_INVALID);
        const costScore = (
            QUEUE_COST_SCORE_WEIGHT_UPGRADE * upgradeCostScore
            + QUEUE_COST_SCORE_WEIGHT_PURCHASE_DAYS * purchaseDaysScore
            + QUEUE_COST_SCORE_WEIGHT_GOLD_PER_POINT * avgGoldScore
        );
        const costInvalid = Boolean(upgradeCostScores?.invalidFlags?.[index])
            || Boolean(purchaseDaysScores?.invalidFlags?.[index])
            || Boolean(avgGoldScores?.invalidFlags?.[index]);

        const invalidReasons = [];
        for (const metricKey of performanceInvalidMetricKeys) {
            invalidReasons.push(`performance.${metricKey}.invalidDeltaPct`);
        }
        if (stabilityInvalid) {
            invalidReasons.push("stability.invalidAvgCv");
        }
        if (upgradeCostScores?.invalidFlags?.[index]) {
            invalidReasons.push("cost.invalidUpgradeCost");
        }
        if (purchaseDaysScores?.invalidFlags?.[index]) {
            invalidReasons.push("cost.invalidPurchaseDays");
        }
        if (avgGoldScores?.invalidFlags?.[index]) {
            invalidReasons.push("cost.invalidGoldPerPoint01PctAvg");
        }

        const baseFinalScore = (
            normalizedScoreWeights.performance * performanceScore
            + normalizedScoreWeights.stability * stabilityScore
            + normalizedScoreWeights.cost * costScore
        );
        const confidencePenaltyStrength = clamp(toFiniteNumber(QUEUE_MULTI_ROUND_CONFIDENCE_PENALTY_STRENGTH, 0.35), 0, 1);
        const confidencePenaltyFactor = clamp(
            (1 - confidencePenaltyStrength) + confidencePenaltyStrength * avgConfidence,
            0,
            1
        );
        const finalScore = baseFinalScore * confidencePenaltyFactor;

        return {
            queueItemId: entry.queueItemId,
            displayName: entry.displayName,
            order: entry.order,
            finalScore: toFiniteNumber(finalScore, 0),
            baseFinalScore: toFiniteNumber(baseFinalScore, 0),
            performanceScore: toFiniteNumber(performanceScore, 0),
            stabilityScore: toFiniteNumber(stabilityScore, 0),
            costScore: toFiniteNumber(costScore, 0),
            confidenceScore: toFiniteNumber(avgConfidence * 100, 0),
            confidencePenaltyFactor: toFiniteNumber(confidencePenaltyFactor, 1),
            scoreFlags: {
                performanceInvalid,
                stabilityInvalid,
                costInvalid,
                invalidReasons,
            },
            rawComponentScores: {
                performanceByMetric: Object.fromEntries(
                    QUEUE_MULTI_ROUND_METRIC_KEYS.map((metricKey, metricIndex) => [metricKey, performanceScores[metricIndex]])
                ),
                stabilityAvgCv: stabilityRawValues[index],
                costByMetric: {
                    upgradeCost: upgradeCostScore,
                    purchaseDays: purchaseDaysScore,
                    avgGoldPerPoint01Pct: avgGoldScore,
                },
            },
            metricSummary: entry.metricSummary,
            costInsights: entry.costInsights,
        };
    });

    ranked.sort((a, b) => {
        if (b.finalScore !== a.finalScore) {
            return b.finalScore - a.finalScore;
        }

        const bProfit = toFiniteNumber(b.metricSummary?.dailyNoRngProfit?.mean, 0);
        const aProfit = toFiniteNumber(a.metricSummary?.dailyNoRngProfit?.mean, 0);
        if (bProfit !== aProfit) {
            return bProfit - aProfit;
        }

        const bDps = toFiniteNumber(b.metricSummary?.dps?.mean, 0);
        const aDps = toFiniteNumber(a.metricSummary?.dps?.mean, 0);
        if (bDps !== aDps) {
            return bDps - aDps;
        }

        return a.order - b.order;
    });

    ranked.forEach((entry, index) => {
        entry.rank = index + 1;
    });

    return ranked;
}

function normalizeQueueSettings(settings) {
    const rounds = clamp(Math.floor(toFiniteNumber(settings?.rounds, 30)), 1, 200);
    const medianBlend = clamp(toFiniteNumber(settings?.medianBlend, 0.5), 0, 1);
    const weightProfit = Math.max(0, toFiniteNumber(settings?.weightProfit, 0.5));
    const weightXp = Math.max(0, toFiniteNumber(settings?.weightXp, 0.3));
    const weightDeathSafety = Math.max(0, toFiniteNumber(settings?.weightDeathSafety, 0.2));
    const weightSum = weightProfit + weightXp + weightDeathSafety || 1;
    const executionModeRaw = settings?.executionMode;
    const executionMode = executionModeRaw == null
        ? "parallel"
        : (executionModeRaw === "parallel" ? "parallel" : "serial");

    return {
        rounds,
        medianBlend,
        weightProfit: weightProfit / weightSum,
        weightXp: weightXp / weightSum,
        weightDeathSafety: weightDeathSafety / weightSum,
        executionMode,
    };
}

function resolveQueueRowRoundCount(row = {}) {
    const samples = QUEUE_MULTI_ROUND_METRIC_KEYS.map((metricKey) => toFiniteNumber(row?.metricSummary?.[metricKey]?.sampleCount, 0));
    return Math.max(0, ...samples);
}

function buildQueueEntriesFromState(queueState) {
    const baselineSnapshot = queueState?.baseline?.snapshot ?? null;
    if (!baselineSnapshot) {
        return [];
    }

    return (Array.isArray(queueState?.items) ? queueState.items : []).map((item, index) => {
        const summary = computeQueueChangeSummary(baselineSnapshot, item?.snapshot);
        const fallbackLabels = Array.isArray(summary?.labels) ? summary.labels : [];
        const fallbackChangeDetails = Array.isArray(summary?.changes) ? summary.changes : [];
        const changes = Array.isArray(item?.changes) && item.changes.length > 0
            ? item.changes
            : fallbackLabels;
        const changeDetails = Array.isArray(item?.changeDetails) && item.changeDetails.length > 0
            ? deepClone(item.changeDetails)
            : deepClone(fallbackChangeDetails);
        const itemName = String(item?.name || "").trim();
        const label = itemName || deriveQueueVariantNameFromLabels(changes, index + 1);

        return {
            id: item?.id,
            label,
            snapshot: deepClone(item?.snapshot),
            changes,
            changeDetails,
        };
    }).filter((entry) => Boolean(entry.id));
}

function sortQueueRawRuns(rows = [], entrySortIndexById = new Map()) {
    return (Array.isArray(rows) ? rows.slice() : []).sort((a, b) => {
        const roundDiff = Number(a?.round || 0) - Number(b?.round || 0);
        if (roundDiff !== 0) {
            return roundDiff;
        }
        return (entrySortIndexById.get(a?.id) ?? 999) - (entrySortIndexById.get(b?.id) ?? 999);
    });
}

function queueChangeNeedsAbilityUpgradeReference(change) {
    if (String(change?.kind || "") !== "ability") {
        return false;
    }

    const afterHrid = String(change?.afterAbilityHrid || "");
    if (!afterHrid) {
        return false;
    }

    const beforeHrid = String(change?.beforeAbilityHrid || "");
    const beforeLevel = Math.max(1, Math.floor(toFiniteNumber(change?.beforeLevel, 1)));
    const afterLevel = Math.max(1, Math.floor(toFiniteNumber(change?.afterLevel, 1)));
    const fromLevel = beforeHrid && beforeHrid === afterHrid ? beforeLevel : 1;
    return afterLevel > fromLevel;
}

function queueEntriesNeedAbilityUpgradeReference(entries = []) {
    return (entries ?? []).some((entry) => (
        Array.isArray(entry?.changeDetails)
        && entry.changeDetails.some((change) => queueChangeNeedsAbilityUpgradeReference(change))
    ));
}

function buildQueueRankedRowsFromSampleState({
    entries = [],
    rawRuns = [],
    queueSettings,
    queueState,
    baselineMetrics,
    pricingState,
    scoreWeights,
    includeEmptyEntries = false,
}) {
    const safeEntries = Array.isArray(entries) ? entries : [];
    if (safeEntries.length === 0) {
        return [];
    }

    const entrySortIndexById = new Map(safeEntries.map((entry, index) => [entry.id, index]));
    const variantSamplesById = new Map(safeEntries.map((entry) => [entry.id, []]));
    for (const rawRun of Array.isArray(rawRuns) ? rawRuns : []) {
        const entryId = String(rawRun?.id || "");
        if (!variantSamplesById.has(entryId)) {
            continue;
        }
        variantSamplesById.get(entryId).push(rawRun);
    }

    const sourceEntries = includeEmptyEntries
        ? safeEntries
        : safeEntries.filter((entry) => (variantSamplesById.get(entry.id) || []).length > 0);

    if (sourceEntries.length === 0) {
        return [];
    }

    const safeQueueSettings = normalizeQueueSettings(queueSettings);
    const normalizedScoreWeights = normalizeQueueScoreWeights(scoreWeights);
    const variantAggregates = sourceEntries.map((entry) => {
        const variantSamples = (variantSamplesById.get(entry.id) || [])
            .slice()
            .sort((a, b) => Number(a?.round || 0) - Number(b?.round || 0));
        const profits = variantSamples.map((sample) => sample.profitPerHour);
        const xps = variantSamples.map((sample) => sample.totalXpPerHour);
        const deaths = variantSamples.map((sample) => sample.deathsPerHour);
        const meanProfit = getMean(profits);
        const medianProfit = getMedian(profits);
        const meanXp = getMean(xps);
        const meanDeaths = getMean(deaths);
        const stdProfit = getStdDev(profits, meanProfit);
        const coefficientOfVariation = Math.abs(meanProfit) > 1e-9 ? (stdProfit / Math.abs(meanProfit)) : stdProfit;
        const stability = 1 / (1 + coefficientOfVariation);
        const scoringProfitPerHour = meanProfit * (1 - safeQueueSettings.medianBlend) + medianProfit * safeQueueSettings.medianBlend;

        return {
            id: entry.id,
            label: entry.label,
            changeCount: entry.changes.length,
            changes: entry.changes,
            changeDetails: Array.isArray(entry.changeDetails) ? deepClone(entry.changeDetails) : [],
            rounds: variantSamples.length,
            meanProfitPerHour: meanProfit,
            medianProfitPerHour: medianProfit,
            stdProfitPerHour: stdProfit,
            scoringProfitPerHour,
            meanXpPerHour: meanXp,
            meanDeathsPerHour: meanDeaths,
            stability,
            sampleResults: variantSamples,
        };
    });
    const variantAggregateById = new Map(variantAggregates.map((entry) => [entry.id, entry]));
    const metricSummaryByQueueItem = sourceEntries.map((entry) => {
        const roundResults = (variantSamplesById.get(entry.id) || [])
            .map((sample) => ({
                metrics: sample.metrics,
                deltas: sample.deltas,
            }));
        const metricSummary = buildQueueItemMetricSummary(roundResults);
        return {
            queueItemId: entry.id,
            displayName: entry.label,
            order: entrySortIndexById.get(entry.id) ?? 0,
            metricSummary,
            costInsights: buildQueueItemCostInsights(queueState, entry.snapshot, metricSummary, pricingState),
        };
    });
    const multiRoundRanking = buildMultiRoundRanking(metricSummaryByQueueItem, normalizedScoreWeights);
    const baselineDailyNoRngProfitPerDay = toFiniteNumber(
        baselineMetrics?.dailyNoRngProfit,
        0
    );
    const baselineScoringProfit = baselineDailyNoRngProfitPerDay / 24;
    const baselineDps = toFiniteNumber(
        baselineMetrics?.dps,
        0
    );
    const baselineXpPerHour = toFiniteNumber(
        baselineMetrics?.xpPerHour,
        0
    );
    const baselineKillsPerHour = toFiniteNumber(
        baselineMetrics?.killsPerHour,
        0
    );

    return multiRoundRanking.map((entry) => {
        const aggregate = variantAggregateById.get(entry.queueItemId) || {
            id: entry.queueItemId,
            label: entry.displayName,
            changeCount: 0,
            changes: [],
            rounds: 0,
            meanProfitPerHour: toFiniteNumber(entry.metricSummary?.dailyNoRngProfit?.mean, 0) / 24,
            medianProfitPerHour: toFiniteNumber(entry.metricSummary?.dailyNoRngProfit?.p50, 0) / 24,
            stdProfitPerHour: toFiniteNumber(entry.metricSummary?.dailyNoRngProfit?.std, 0) / 24,
            scoringProfitPerHour: toFiniteNumber(entry.metricSummary?.dailyNoRngProfit?.robustMean, 0) / 24,
            meanXpPerHour: toFiniteNumber(entry.metricSummary?.xpPerHour?.mean, 0),
            meanDeathsPerHour: 0,
            stability: 0,
        };

        const scoringProfitPerHour = toFiniteNumber(aggregate.scoringProfitPerHour, 0);
        const deltaProfitPerHour = scoringProfitPerHour - baselineScoringProfit;
        const deltaProfitPct = Math.abs(baselineScoringProfit) > 1e-9
            ? (deltaProfitPerHour / baselineScoringProfit) * 100
            : 0;

        const metricSummary = entry.metricSummary ?? {};
        const dailyNoRngProfitPerDay = toFiniteNumber(metricSummary?.dailyNoRngProfit?.mean, 0);
        const dps = toFiniteNumber(metricSummary?.dps?.mean, 0);
        const xpPerHour = toFiniteNumber(metricSummary?.xpPerHour?.mean, 0);
        const killsPerHour = toFiniteNumber(metricSummary?.killsPerHour?.mean, 0);

        return {
            id: entry.queueItemId,
            label: entry.displayName,
            rank: entry.rank,
            order: entry.order,
            score: toFiniteNumber(entry.finalScore, 0) / 100,
            finalScore: toFiniteNumber(entry.finalScore, 0),
            baseFinalScore: toFiniteNumber(entry.baseFinalScore, 0),
            performanceScore: toFiniteNumber(entry.performanceScore, 0),
            stabilityScore: toFiniteNumber(entry.stabilityScore, 0),
            costScore: toFiniteNumber(entry.costScore, 0),
            confidenceScore: toFiniteNumber(entry.confidenceScore, 0),
            confidencePenaltyFactor: toFiniteNumber(entry.confidencePenaltyFactor, 1),
            scoreFlags: entry.scoreFlags ?? {
                performanceInvalid: false,
                stabilityInvalid: false,
                costInvalid: false,
                invalidReasons: [],
            },
            rawComponentScores: entry.rawComponentScores ?? {},
            changeCount: aggregate.changeCount,
            changes: aggregate.changes,
            changeDetails: Array.isArray(aggregate.changeDetails) ? deepClone(aggregate.changeDetails) : [],
            rounds: aggregate.rounds || resolveQueueRowRoundCount(entry),
            meanProfitPerHour: toFiniteNumber(aggregate.meanProfitPerHour, 0),
            medianProfitPerHour: toFiniteNumber(aggregate.medianProfitPerHour, 0),
            stdProfitPerHour: toFiniteNumber(aggregate.stdProfitPerHour, 0),
            scoringProfitPerHour,
            meanXpPerHour: toFiniteNumber(aggregate.meanXpPerHour, xpPerHour),
            meanDeathsPerHour: toFiniteNumber(aggregate.meanDeathsPerHour, 0),
            stability: toFiniteNumber(aggregate.stability, 0),
            deltaProfitPerHour: toFiniteNumber(deltaProfitPerHour, 0),
            deltaProfitPct: toFiniteNumber(deltaProfitPct, 0),
            dailyNoRngProfitPerDay,
            deltaDailyNoRngProfitPerDay: dailyNoRngProfitPerDay - baselineDailyNoRngProfitPerDay,
            deltaDailyNoRngProfitPct: toFiniteNumber(metricSummary?.dailyNoRngProfit?.meanDeltaPct, 0),
            dps,
            deltaDpsPerSecond: dps - baselineDps,
            deltaDpsPct: toFiniteNumber(metricSummary?.dps?.meanDeltaPct, 0),
            xpPerHour,
            deltaXpPerHour: xpPerHour - baselineXpPerHour,
            deltaXpPct: toFiniteNumber(metricSummary?.xpPerHour?.meanDeltaPct, 0),
            killsPerHour,
            deltaKillsPerHour: killsPerHour - baselineKillsPerHour,
            deltaKillsPct: toFiniteNumber(metricSummary?.killsPerHour?.meanDeltaPct, 0),
            metricSummary,
            costInsights: entry.costInsights ?? createEmptyQueueCostInsights(),
        };
    });
}

/**
 * @typedef {Object} SimulatorStoreState
 * @property {Array<any>} players
 * @property {string} activePlayerId
 * @property {Object} simulationSettings
 * @property {{ isRunning: boolean, progress: number, error: string, startedAt: number, elapsedSeconds: number, workerMode: "single" | "multi" }} runtime
 * @property {{ simResult: any, simResults: Array<any>, summaryRows: Array<any>, batchRows: Array<any>, batchResultType: string, activeResultPlayerHrid: string, timeSeriesData: any }} results
 */

export const useSimulatorStore = defineStore("simulator", {
    state: () => {
        const playerAchievementsById = loadPlayerAchievementsFromStorage();
        const playerList = applyPersistedAchievementsToPlayers(
            [1, 2, 3, 4, 5].map((id) => createEmptyPlayerConfig(id)),
            playerAchievementsById,
        );
        const simulationUiSettings = loadSimulationUiSettingsFromStorage();
        const { zones, dungeons } = getZoneOptions();
        const labyrinths = getLabyrinthOptions();
        const initialGroupZoneHrids = groupZoneHrids;
        const initialSoloZoneHrids = soloZoneHrids;

        return {
            players: playerList,
            activePlayerId: "1",
            options: {
                equipmentBySlot: getEquipmentOptionsBySlot(),
                food: getConsumableOptions("/item_categories/food"),
                drinks: getConsumableOptions("/item_categories/drink"),
                abilities: getAbilityOptions(),
                zones,
                dungeons,
                labyrinths,
                labyrinthCrates: {
                    coffee: labyrinthCrateOptions.coffee,
                    food: labyrinthCrateOptions.food,
                },
            },
            simulationSettings: {
                mode: "zone",
                runScope: RUN_SCOPE_SINGLE,
                useDungeon: false,
                zoneHrid: zones[0]?.hrid ?? "",
                dungeonHrid: dungeons[0]?.hrid ?? "",
                difficultyTier: 0,
                labyrinthHrid: labyrinths[0]?.hrid ?? "",
                roomLevel: 100,
                simulationTimeHours: 24,
                mooPass: simulationUiSettings.mooPass,
                comExpEnabled: simulationUiSettings.comExpEnabled,
                comExp: simulationUiSettings.comExp,
                comDropEnabled: simulationUiSettings.comDropEnabled,
                comDrop: simulationUiSettings.comDrop,
                enableHpMpVisualization: true,
                selectedGroupZoneHrids: initialGroupZoneHrids,
                selectedSoloZoneHrids: initialSoloZoneHrids,
                labyrinthCrates: normalizeLabyrinthCrates({}),
            },
            runtime: {
                isRunning: false,
                progress: 0,
                error: "",
                startedAt: 0,
                elapsedSeconds: 0,
                workerMode: "single",
                completionNoticeId: 0,
            },
            results: {
                simResult: null,
                simResults: [],
                summaryRows: [],
                batchRows: [],
                batchResultType: "",
                activeResultPlayerHrid: "player1",
                timeSeriesData: null,
            },
            advisor: createAdvisorState(),
            queue: {
                byPlayer: createQueueStateByPlayer(playerList),
                importedProfileByPlayer: createImportedProfileByPlayer(),
                importedBaselineByPlayer: createImportedBaselineByPlayer(),
            },
            queueRuntime: loadQueueRuntimeSettingsFromStorage(),
            playerDataSnapshot: createPlayerDataSnapshotState(),
            equipmentSets: loadEquipmentSetsFromStorage(),
            pricing: createPricingState(),
            abilityUpgradeReferenceVersion: 0,
            ui: {
                language: localStorage.getItem("i18nextLng") || "en",
            },
        };
    },
    getters: {
        activePlayer(state) {
            return state.players.find((player) => player.id === state.activePlayerId) ?? state.players[0];
        },
        selectedPlayers(state) {
            return state.players.filter((player) => player.selected);
        },
        resolvedAdvisorMetricPlayer(state) {
            const selectedPlayers = state.players
                .filter((player) => player.selected)
                .map((player) => ({ id: player.id, name: player.name }));
            return resolveAdvisorMetricPlayer(selectedPlayers, state.activePlayerId);
        },
        currentActionOptions(state) {
            if (state.simulationSettings.mode === "labyrinth") {
                return state.options.labyrinths;
            }
            return state.simulationSettings.useDungeon ? state.options.dungeons : state.options.zones;
        },
        groupZoneOptions(state) {
            return (state.options.zones || []).filter((zone) => (
                Number(actionDetailIndex?.[zone?.hrid]?.maxSpawnCount ?? 0) > 1
            ));
        },
        soloZoneOptions(state) {
            return (state.options.zones || []).filter((zone) => (
                Number(actionDetailIndex?.[zone?.hrid]?.maxSpawnCount ?? 0) === 1
            ));
        },
        currentMaxDifficulty(state) {
            if (state.simulationSettings.mode === "labyrinth") {
                return 0;
            }

            const targetHrid = state.simulationSettings.useDungeon ? state.simulationSettings.dungeonHrid : state.simulationSettings.zoneHrid;
            const source = state.simulationSettings.useDungeon ? state.options.dungeons : state.options.zones;
            const action = source.find((entry) => entry.hrid === targetHrid);
            return Number(action?.maxDifficulty ?? 0);
        },
        availableRunScopes(state) {
            if (state.simulationSettings.mode === "labyrinth") {
                return [
                    { value: RUN_SCOPE_SINGLE, label: "Single labyrinth" },
                    { value: RUN_SCOPE_ALL_LABYRINTHS, label: "All labyrinths" },
                ];
            }

            return [
                { value: RUN_SCOPE_SINGLE, label: "Single target" },
                { value: RUN_SCOPE_ALL_GROUP_ZONES, label: "All group zones" },
                { value: RUN_SCOPE_ALL_SOLO_ZONES, label: "All solo zones" },
            ];
        },
        activeResultRow(state) {
            return state.results.summaryRows.find((row) => row.playerHrid === state.results.activeResultPlayerHrid) ?? null;
        },
        activeQueueState(state) {
            return state.queue.byPlayer[state.activePlayerId] ?? createQueuePlayerState();
        },
        activeQueuePartyStatus(state) {
            const queueState = state.queue.byPlayer[state.activePlayerId] ?? createQueuePlayerState();
            const hasBaselineSnapshot = Boolean(queueState?.baseline?.snapshot);
            if (!hasBaselineSnapshot) {
                return {
                    hasMismatch: false,
                    messageKey: "",
                    memberNames: [],
                };
            }
            const baselinePartyPlayers = Array.isArray(queueState?.baseline?.partySnapshot?.selectedPlayers)
                ? queueState.baseline.partySnapshot.selectedPlayers
                : [];
            const memberNames = baselinePartyPlayers
                .map((player) => String(player?.name || `Player ${player?.id || ""}`).trim())
                .filter(Boolean);
            const selectedTeammateCount = buildQueuePartyComparisonPlayers(state.players, state.activePlayerId).length;
            if (baselinePartyPlayers.length <= 0) {
                return {
                    hasMismatch: selectedTeammateCount > 0,
                    messageKey: selectedTeammateCount > 0 ? "common:queue.partyChangedSinceBaseline" : "",
                    memberNames: [],
                };
            }

            const baselineSignature = String(
                queueState?.baseline?.partySnapshot?.signature
                || buildQueuePartySignature(baselinePartyPlayers, state.activePlayerId)
            );
            const currentSignature = buildQueuePartySignature(state.players, state.activePlayerId);
            const hasMismatch = baselineSignature !== currentSignature;
            return {
                hasMismatch,
                messageKey: hasMismatch ? "common:queue.partyChangedSinceBaseline" : "",
                memberNames,
            };
        },
        activeImportedBaselineSnapshot(state) {
            return state.queue.importedBaselineByPlayer?.[state.activePlayerId] ?? null;
        },
        isAnyQueueRunning(state) {
            return Object.values(state.queue.byPlayer).some((queueState) => Boolean(queueState?.isRunning));
        },
        detectedHardwareCoreCount() {
            return getDetectedHardwareCoreCount();
        },
        queueParallelWorkerHardMax() {
            return getParallelWorkerHardMaxForCurrentMachine();
        },
        queueParallelWorkerRecommended() {
            return getRecommendedParallelWorkerLimit();
        },
        equipmentSetEntries(state) {
            return Object.entries(state.equipmentSets || {})
                .map(([name, entry]) => ({
                    name,
                    savedAt: Number(entry?.savedAt ?? 0),
                    queueChangeCount: Array.isArray(entry?.queueChanges?.items)
                        ? entry.queueChanges.items.length
                        : 0,
                }))
                .sort((a, b) => b.savedAt - a.savedAt || a.name.localeCompare(b.name));
        },
        playerDataSnapshotRows(state) {
            const sourceMap = state.playerDataSnapshot?.playerDataMap || {};
            return QUEUE_PLAYER_IDS.map((playerId) => {
                const rawText = sourceMap[playerId];
                const hasSnapshot = typeof rawText === "string" && rawText.trim().length > 0;
                const summary = hasSnapshot ? parsePlayerSnapshotSummary(rawText) : null;
                return {
                    playerId,
                    hasSnapshot,
                    zoneHrid: summary?.zoneHrid || "",
                    dungeonHrid: summary?.dungeonHrid || "",
                    labyrinthHrid: summary?.labyrinthHrid || "",
                    zone: summary?.zone || "-",
                    dungeon: summary?.dungeon || "-",
                    difficulty: summary?.difficulty || "-",
                    simulationTime: summary?.simulationTime || "-",
                    labyrinth: summary?.labyrinth || "-",
                    roomLevel: summary?.roomLevel || "-",
                };
            });
        },
    },
    actions: {
        ensureQueueState(playerId = this.activePlayerId) {
            const normalizedId = String(playerId || this.activePlayerId);
            if (!this.queue.byPlayer[normalizedId]) {
                this.queue.byPlayer[normalizedId] = createQueuePlayerState();
            }
            return this.queue.byPlayer[normalizedId];
        },
        syncActiveResultPlayerToActivePlayer(playerId = this.activePlayerId) {
            const targetPlayerHrid = toPlayerHrid(playerId);
            const summaryRow = Array.isArray(this.results.summaryRows)
                ? this.results.summaryRows.find((row) => String(row?.playerHrid || "") === targetPlayerHrid)
                : null;
            this.results.activeResultPlayerHrid = summaryRow?.playerHrid || targetPlayerHrid;
            return this.results.activeResultPlayerHrid;
        },
        setImportedProfileState(playerId, imported = true) {
            const normalizedId = String(playerId || "");
            if (!normalizedId) {
                return false;
            }
            if (!this.queue.importedProfileByPlayer || typeof this.queue.importedProfileByPlayer !== "object") {
                this.queue.importedProfileByPlayer = createImportedProfileByPlayer();
            }
            this.queue.importedProfileByPlayer[normalizedId] = Boolean(imported);
            if (!imported) {
                this.setImportedBaselineSnapshot(normalizedId, null);
            }
            return true;
        },
        setImportedBaselineSnapshot(playerId, snapshot = null) {
            const normalizedId = String(playerId || "");
            if (!normalizedId) {
                return false;
            }
            if (!this.queue.importedBaselineByPlayer || typeof this.queue.importedBaselineByPlayer !== "object") {
                this.queue.importedBaselineByPlayer = createImportedBaselineByPlayer();
            }
            this.queue.importedBaselineByPlayer[normalizedId] = isPlainObject(snapshot)
                ? deepClone(snapshot)
                : null;
            return true;
        },
        clearOtherPlayersForSoloImport(targetPlayerId = this.activePlayerId) {
            const normalizedTargetId = String(targetPlayerId || this.activePlayerId);
            const hasTargetPlayer = this.players.some((player) => String(player.id) === normalizedTargetId);
            if (!hasTargetPlayer) {
                return false;
            }

            this.players = this.players.map((player) => {
                if (String(player.id) === normalizedTargetId) {
                    return player;
                }

                const clearedPlayer = createEmptyPlayerConfig(player.id);
                clearedPlayer.selected = false;
                return clearedPlayer;
            });

            if (!this.queue.byPlayer || typeof this.queue.byPlayer !== "object") {
                this.queue.byPlayer = createQueueStateByPlayer(this.players);
            }

            for (const player of this.players) {
                if (String(player.id) === normalizedTargetId) {
                    continue;
                }

                this.queue.byPlayer[String(player.id)] = createQueuePlayerState();
                this.setImportedProfileState(player.id, false);
            }

            this.persistPlayerAchievements();
            return true;
        },
        clearPlayerSlots(playerIds = []) {
            const normalizedIds = Array.from(new Set(
                (Array.isArray(playerIds) ? playerIds : [])
                    .map((playerId) => String(playerId || "").trim())
                    .filter((playerId) => this.players.some((player) => String(player.id) === playerId))
            ));
            if (normalizedIds.length === 0) {
                return false;
            }

            const targetIdSet = new Set(normalizedIds);
            this.players = this.players.map((player) => {
                if (!targetIdSet.has(String(player.id))) {
                    return player;
                }

                const clearedPlayer = createEmptyPlayerConfig(player.id);
                clearedPlayer.selected = false;
                return clearedPlayer;
            });

            if (!this.queue.byPlayer || typeof this.queue.byPlayer !== "object") {
                this.queue.byPlayer = createQueueStateByPlayer(this.players);
            }

            for (const playerId of normalizedIds) {
                this.queue.byPlayer[playerId] = createQueuePlayerState();
                this.setImportedProfileState(playerId, false);
            }

            this.persistPlayerAchievements();
            return true;
        },
        getMarketEnhancementLevelsForItem(itemHrid) {
            const hrid = String(itemHrid || "");
            if (!hrid) {
                return [];
            }
            const levels = this.pricing?.enhancementLevelsByItem?.[hrid];
            if (!Array.isArray(levels)) {
                return [];
            }
            return Array.from(new Set(levels
                .map((value) => Math.floor(toFiniteNumber(value, -1)))
                .filter((value) => Number.isFinite(value) && value > 0)))
                .sort((a, b) => a - b);
        },
        applyActivePlayerEquipmentEnhancementFromMarket(slotKey, enhancementLevel) {
            const normalizedSlotKey = String(slotKey || "");
            if (!EQUIPMENT_SLOT_KEYS.includes(normalizedSlotKey)) {
                return false;
            }

            const player = this.activePlayer;
            if (!player?.equipment?.[normalizedSlotKey]) {
                return false;
            }

            player.equipment[normalizedSlotKey].enhancementLevel = clampPositiveInteger(enhancementLevel, 0);
            return true;
        },
        resolveActivePlayerEquipmentUpgradeCostDraft(slotKey) {
            const normalizedSlotKey = String(slotKey || "");
            if (!EQUIPMENT_SLOT_KEYS.includes(normalizedSlotKey)) {
                return null;
            }

            const queueState = this.ensureQueueState(this.activePlayerId);
            const baselineSnapshot = queueState?.baseline?.snapshot ?? null;
            if (!baselineSnapshot) {
                return null;
            }

            const baselineEquipment = baselineSnapshot?.equipment?.[normalizedSlotKey] ?? { itemHrid: "", enhancementLevel: 0 };
            const currentEquipment = this.activePlayer?.equipment?.[normalizedSlotKey] ?? { itemHrid: "", enhancementLevel: 0 };
            const beforeItemHrid = String(baselineEquipment?.itemHrid || "");
            const afterItemHrid = String(currentEquipment?.itemHrid || "");
            const beforeLevel = Math.max(0, Math.floor(toFiniteNumber(baselineEquipment?.enhancementLevel, 0)));
            const afterLevel = Math.max(0, Math.floor(toFiniteNumber(currentEquipment?.enhancementLevel, 0)));
            const hasChanged = beforeItemHrid !== afterItemHrid || beforeLevel !== afterLevel;

            if (!hasChanged || !afterItemHrid) {
                return null;
            }

            const costMap = isPlainObject(queueState.enhancementUpgradeCosts) ? queueState.enhancementUpgradeCosts : {};
            const savedCostResult = readEquipmentTransitionCostFromMap(
                costMap,
                normalizedSlotKey,
                beforeItemHrid,
                beforeLevel,
                afterItemHrid,
                afterLevel
            );

            const costValue = savedCostResult.value != null
                ? savedCostResult.value
                : computeDefaultEquipmentTransitionCost(
                    beforeItemHrid,
                    beforeLevel,
                    afterItemHrid,
                    afterLevel,
                    this.pricing
                );

            return {
                slotKey: normalizedSlotKey,
                transitionCostKey: savedCostResult.transitionCostKey,
                beforeItemHrid,
                afterItemHrid,
                beforeLevel,
                afterLevel,
                cost: toFiniteNumber(costValue, 0),
            };
        },
        setActivePlayerEquipmentUpgradeCost(slotKey, rawCost) {
            const draft = this.resolveActivePlayerEquipmentUpgradeCostDraft(slotKey);
            if (!draft) {
                return false;
            }

            const queueState = this.ensureQueueState(this.activePlayerId);
            const costMap = isPlainObject(queueState.enhancementUpgradeCosts)
                ? { ...queueState.enhancementUpgradeCosts }
                : {};

            const normalizedCost = Math.max(0, toFiniteNumber(rawCost, 0));
            writeEquipmentTransitionCostToMap(
                costMap,
                draft.slotKey,
                draft.beforeItemHrid,
                draft.beforeLevel,
                draft.afterItemHrid,
                draft.afterLevel,
                normalizedCost
            );
            queueState.enhancementUpgradeCosts = costMap;
            return true;
        },
        resolveActivePlayerAbilityUpgradeCostDraft(slotIndex) {
            const index = Math.floor(toFiniteNumber(slotIndex, -1));
            if (!Number.isInteger(index) || index < 0 || index >= 5) {
                return null;
            }

            // Keep draft reactive when ability XP/book reference data loads asynchronously.
            this.abilityUpgradeReferenceVersion;

            const queueState = this.ensureQueueState(this.activePlayerId);
            const baselineSnapshot = queueState?.baseline?.snapshot ?? null;
            if (!baselineSnapshot) {
                return null;
            }

            const baselineAbility = baselineSnapshot?.abilities?.[index] ?? { abilityHrid: "", level: 1 };
            const currentAbility = this.activePlayer?.abilities?.[index] ?? { abilityHrid: "", level: 1 };
            const baselineHrid = String(baselineAbility?.abilityHrid || "");
            const currentHrid = String(currentAbility?.abilityHrid || "");
            const baselineLevel = Math.max(1, Math.floor(toFiniteNumber(baselineAbility?.level, 1)));
            const currentLevel = Math.max(1, Math.floor(toFiniteNumber(currentAbility?.level, 1)));

            if (!currentHrid) {
                return null;
            }

            const fromLevel = baselineHrid && baselineHrid === currentHrid ? baselineLevel : 1;
            if (currentLevel <= fromLevel) {
                return null;
            }

            const costKey = getAbilityUpgradeCostKey(index, currentHrid, fromLevel, currentLevel);
            const costMap = isPlainObject(queueState.abilityUpgradeCosts) ? queueState.abilityUpgradeCosts : {};
            const hasSavedCost = Object.prototype.hasOwnProperty.call(costMap, costKey);
            const cost = hasSavedCost
                ? toFiniteNumber(costMap[costKey], 0)
                : toFiniteNumber(computeDefaultAbilityUpgradeCost({
                    abilityHrid: currentHrid,
                    level: fromLevel,
                }, currentLevel, this.pricing), 0);

            return {
                slotIndex: index,
                costKey,
                abilityHrid: currentHrid,
                fromLevel,
                toLevel: currentLevel,
                cost,
            };
        },
        setActivePlayerAbilityUpgradeCost(slotIndex, rawCost) {
            const draft = this.resolveActivePlayerAbilityUpgradeCostDraft(slotIndex);
            if (!draft) {
                return false;
            }

            const queueState = this.ensureQueueState(this.activePlayerId);
            const costMap = isPlainObject(queueState.abilityUpgradeCosts)
                ? { ...queueState.abilityUpgradeCosts }
                : {};
            costMap[draft.costKey] = Math.max(0, toFiniteNumber(rawCost, 0));
            queueState.abilityUpgradeCosts = costMap;
            return true;
        },
        previewHouseRoomUpgradeCost(baseHouseRooms, targetHouseRooms) {
            return buildHouseRoomUpgradeCostPreview(baseHouseRooms, targetHouseRooms, this.pricing);
        },
        validateQueueRuntimeSettingsInput(payload = {}) {
            const performancePct = Number(payload.performancePct);
            const stabilityPct = Number(payload.stabilityPct);
            const costPct = Number(payload.costPct);

            if (
                !Number.isFinite(performancePct)
                || !Number.isFinite(stabilityPct)
                || !Number.isFinite(costPct)
                || performancePct < 0
                || stabilityPct < 0
                || costPct < 0
                || performancePct > 100
                || stabilityPct > 100
                || costPct > 100
            ) {
                return {
                    ok: false,
                    messageKey: "common:settingsPage.queueSaveErrorInvalidWeight",
                };
            }

            const weightSum = performancePct + stabilityPct + costPct;
            if (Math.abs(weightSum - 100) > QUEUE_WEIGHT_SUM_EPSILON) {
                return {
                    ok: false,
                    messageKey: "common:settingsPage.queueSaveErrorWeightSum",
                };
            }

            const parallelWorkerLimitRaw = Number(payload.parallelWorkerLimit);
            const hardMaxForMachine = getParallelWorkerHardMaxForCurrentMachine();
            if (
                !Number.isInteger(parallelWorkerLimitRaw)
                || parallelWorkerLimitRaw < QUEUE_PARALLEL_WORKER_LIMIT_MIN
                || parallelWorkerLimitRaw > hardMaxForMachine
            ) {
                const detectedCoreCount = getDetectedHardwareCoreCount();
                if (Number.isFinite(detectedCoreCount) && parallelWorkerLimitRaw > detectedCoreCount) {
                    return {
                        ok: false,
                        messageKey: "common:settingsPage.queueSaveErrorParallelLimitByCore",
                        messageOptions: {
                            cores: detectedCoreCount,
                        },
                    };
                }

                return {
                    ok: false,
                    messageKey: "common:settingsPage.queueSaveErrorParallelLimit",
                    messageOptions: {
                        min: QUEUE_PARALLEL_WORKER_LIMIT_MIN,
                        max: hardMaxForMachine,
                    },
                };
            }

            return {
                ok: true,
                settings: {
                    finalWeights: {
                        performance: performancePct / 100,
                        stability: stabilityPct / 100,
                        cost: costPct / 100,
                    },
                    parallelWorkerLimit: parallelWorkerLimitRaw,
                },
            };
        },
        saveQueueRuntimeSettings(payload = {}) {
            const validated = this.validateQueueRuntimeSettingsInput(payload);
            if (!validated.ok) {
                return validated;
            }

            try {
                const normalized = persistQueueRuntimeSettingsToStorage(validated.settings);
                this.queueRuntime = normalized;
                return {
                    ok: true,
                    settings: normalized,
                };
            } catch (error) {
                return {
                    ok: false,
                    messageKey: "common:settingsPage.queueSaveErrorStorage",
                };
            }
        },
        resetQueueRuntimeSettings() {
            try {
                const defaults = getDefaultQueueRuntimeSettings();
                const normalized = persistQueueRuntimeSettingsToStorage(defaults);
                this.queueRuntime = normalized;
                return {
                    ok: true,
                    settings: normalized,
                };
            } catch (error) {
                return {
                    ok: false,
                    messageKey: "common:settingsPage.queueSaveErrorStorage",
                };
            }
        },
        refreshPlayerDataSnapshot() {
            this.playerDataSnapshot = createPlayerDataSnapshotState();
            return this.playerDataSnapshot;
        },
        savePlayerDataSnapshot() {
            const snapshotMap = {};
            for (const player of this.players) {
                const playerId = String(player.id || "");
                if (!playerId) {
                    continue;
                }
                snapshotMap[playerId] = exportSoloConfig(player, this.simulationSettings);
            }

            try {
                savePlayerDataSnapshotToStorage(snapshotMap);
                this.playerDataSnapshot = createPlayerDataSnapshotState();
                return {
                    ok: true,
                    savedAt: this.playerDataSnapshot.savedAt,
                    messageKey: "common:settingsPage.playerSaveSuccess",
                };
            } catch (error) {
                return {
                    ok: false,
                    messageKey: "common:settingsPage.playerSaveError",
                };
            }
        },
        loadPlayerDataSnapshot() {
            const loadResult = loadPlayerDataSnapshotFromStorage();
            if (loadResult.status === "not_found") {
                this.playerDataSnapshot = createPlayerDataSnapshotState();
                return {
                    ok: false,
                    messageKey: "common:settingsPage.playerLoadNotFound",
                };
            }

            if (loadResult.status !== "ok") {
                this.playerDataSnapshot = createPlayerDataSnapshotState();
                return {
                    ok: false,
                    messageKey: "common:settingsPage.playerLoadInvalid",
                };
            }

            const loadedPlayerIds = Object.keys(loadResult.playerDataMap || {});
            if (loadedPlayerIds.length === 0) {
                this.playerDataSnapshot = createPlayerDataSnapshotState();
                return {
                    ok: false,
                    messageKey: "common:settingsPage.playerLoadInvalid",
                };
            }

            try {
                let nextPlayers = [...this.players];
                let preferredSimulationSettings = null;
                let fallbackSimulationSettings = null;

                for (const playerId of loadedPlayerIds) {
                    const snapshotText = loadResult.playerDataMap[playerId];
                    const sourcePlayer = nextPlayers.find((player) => String(player.id) === String(playerId))
                        || createEmptyPlayerConfig(playerId);

                    const parsed = parseSoloImportConfig(snapshotText, sourcePlayer, this.simulationSettings);
                    nextPlayers = nextPlayers.map((player) => (
                        String(player.id) === String(playerId) ? parsed.player : player
                    ));

                    if (!fallbackSimulationSettings && parsed?.simulationSettings) {
                        fallbackSimulationSettings = {
                            ...parsed.simulationSettings,
                        };
                    }
                    if (String(playerId) === String(this.activePlayerId) && parsed?.simulationSettings) {
                        preferredSimulationSettings = {
                            ...parsed.simulationSettings,
                        };
                    }

                    this.queue.byPlayer[String(playerId)] = createQueuePlayerState();
                    this.setImportedProfileState(playerId, true);
                    this.setImportedBaselineSnapshot(playerId, parsed.player);
                }

                this.players = this.players.map((player) => {
                    const resolved = nextPlayers.find((candidate) => String(candidate.id) === String(player.id));
                    return resolved || player;
                });
                this.persistPlayerAchievements();

                const nextSimulationSettings = preferredSimulationSettings || fallbackSimulationSettings;
                if (nextSimulationSettings) {
                    this.simulationSettings = {
                        ...this.simulationSettings,
                        ...nextSimulationSettings,
                    };
                    // Restoring player data should default to regular zone view for immediate editing.
                    this.simulationSettings.mode = "zone";
                    this.simulationSettings.useDungeon = false;
                    if (!this.simulationSettings.zoneHrid) {
                        this.simulationSettings.zoneHrid = String(this.options?.zones?.[0]?.hrid || "");
                    }
                    this.normalizeRunScope();
                    this.normalizeDifficulty();
                }

                this.playerDataSnapshot = {
                    savedAt: Number(loadResult.savedAt || 0),
                    playerDataMap: loadResult.playerDataMap || {},
                };

                return {
                    ok: true,
                    savedAt: this.playerDataSnapshot.savedAt,
                    loadedPlayerIds,
                    messageKey: "common:settingsPage.playerLoadSuccess",
                };
            } catch (error) {
                this.playerDataSnapshot = createPlayerDataSnapshotState();
                return {
                    ok: false,
                    messageKey: "common:settingsPage.playerLoadInvalid",
                };
            }
        },
        deleteSinglePlayerDataSnapshot(playerId) {
            const targetPlayerId = String(playerId || "");
            if (!targetPlayerId) {
                return {
                    ok: false,
                    messageKey: "common:settingsPage.playerDeleteError",
                };
            }

            const loadResult = loadPlayerDataSnapshotFromStorage();
            if (loadResult.status !== "ok") {
                this.playerDataSnapshot = createPlayerDataSnapshotState();
                return {
                    ok: false,
                    messageKey: "common:settingsPage.playerLoadNotFound",
                };
            }

            const nextPlayerDataMap = {
                ...(loadResult.playerDataMap || {}),
            };
            if (!Object.prototype.hasOwnProperty.call(nextPlayerDataMap, targetPlayerId)) {
                return {
                    ok: false,
                    messageKey: "common:settingsPage.playerLoadNotFound",
                };
            }

            delete nextPlayerDataMap[targetPlayerId];

            try {
                if (Object.keys(nextPlayerDataMap).length === 0) {
                    clearPlayerDataSnapshotFromStorage();
                } else {
                    upsertPlayerDataSnapshotToStorage(nextPlayerDataMap);
                }

                this.playerDataSnapshot = createPlayerDataSnapshotState();
                return {
                    ok: true,
                    messageKey: "common:settingsPage.playerDeleteSingleSuccess",
                    messageOptions: {
                        playerId: targetPlayerId,
                    },
                };
            } catch (error) {
                return {
                    ok: false,
                    messageKey: "common:settingsPage.playerDeleteError",
                };
            }
        },
        deleteAllPlayerDataSnapshots() {
            try {
                clearPlayerDataSnapshotFromStorage();
                this.playerDataSnapshot = createPlayerDataSnapshotState();
                return {
                    ok: true,
                    messageKey: "common:settingsPage.playerDeleteAllSuccess",
                };
            } catch (error) {
                return {
                    ok: false,
                    messageKey: "common:settingsPage.playerDeleteError",
                };
            }
        },
        persistPlayerAchievements() {
            persistPlayerAchievementsToStorage(this.players);
        },
        clearPersistedPlayerAchievements() {
            clearPlayerAchievementsFromStorage();
        },
        ensureActivePlayerTriggerDefaults(targetHrid) {
            const hrid = String(targetHrid || "");
            if (!hrid) {
                return [];
            }

            const player = this.activePlayer;
            if (!player) {
                return [];
            }

            if (!isPlainObject(player.triggerMap)) {
                player.triggerMap = {};
            }

            const triggers = ensureTriggerMapEntry(player.triggerMap, hrid);
            player.triggerMap[hrid] = sanitizeTriggerList(triggers);
            return deepClone(player.triggerMap[hrid]);
        },
        getActivePlayerTriggers(targetHrid) {
            const hrid = String(targetHrid || "");
            if (!hrid) {
                return [];
            }

            const triggerMap = isPlainObject(this.activePlayer?.triggerMap) ? this.activePlayer.triggerMap : {};
            return deepClone(sanitizeTriggerList(triggerMap[hrid]));
        },
        setActivePlayerTriggers(targetHrid, triggerList) {
            const hrid = String(targetHrid || "");
            if (!hrid) {
                return [];
            }

            const player = this.activePlayer;
            if (!player) {
                return [];
            }

            if (!isPlainObject(player.triggerMap)) {
                player.triggerMap = {};
            }

            player.triggerMap[hrid] = sanitizeTriggerList(triggerList);
            return deepClone(player.triggerMap[hrid]);
        },
        resetActivePlayerTriggersToDefault(targetHrid) {
            const hrid = String(targetHrid || "");
            if (!hrid) {
                return [];
            }

            const player = this.activePlayer;
            if (!player) {
                return [];
            }

            if (!isPlainObject(player.triggerMap)) {
                player.triggerMap = {};
            }

            player.triggerMap[hrid] = sanitizeTriggerList(getDefaultTriggerDtosForHrid(hrid));
            return deepClone(player.triggerMap[hrid]);
        },
        refreshEquipmentSets() {
            this.equipmentSets = loadEquipmentSetsFromStorage();
            return this.equipmentSetEntries;
        },
        saveEquipmentSet(name, playerId = this.activePlayerId) {
            const setName = String(name || "").trim();
            if (!setName) {
                throw new Error("Equipment set name is empty.");
            }

            const normalizedPlayerId = String(playerId || this.activePlayerId);
            const queueState = this.ensureQueueState(normalizedPlayerId);
            const queueChanges = normalizeEquipmentSetQueueChanges(
                buildEquipmentSetQueueChangesFromQueueState(queueState)
            );

            this.equipmentSets = {
                ...this.equipmentSets,
                [setName]: {
                    savedAt: Date.now(),
                    queueChanges,
                },
            };
            persistEquipmentSetsToStorage(this.equipmentSets);
            return this.equipmentSets[setName];
        },
        loadEquipmentSet() {
            return false;
        },
        importEquipmentSetQueueChanges(name, playerId = this.activePlayerId) {
            const setName = String(name || "").trim();
            if (!setName) {
                return {
                    ok: false,
                    importedCount: 0,
                    messageKey: "common:vue.settings.msgQueueChangesImportFailed",
                };
            }

            const entry = this.equipmentSets?.[setName];
            if (!entry) {
                return {
                    ok: false,
                    importedCount: 0,
                    messageKey: "common:vue.settings.msgQueueChangesImportFailed",
                };
            }

            const normalizedPlayerId = String(playerId || this.activePlayerId);
            const sourcePlayer = this.players.find((player) => String(player.id) === normalizedPlayerId);
            if (!sourcePlayer) {
                return {
                    ok: false,
                    importedCount: 0,
                    messageKey: "common:vue.settings.msgQueueChangesImportFailed",
                };
            }

            const queueChanges = normalizeEquipmentSetQueueChanges(entry.queueChanges);
            if (!Array.isArray(queueChanges.items) || queueChanges.items.length <= 0) {
                return {
                    ok: false,
                    importedCount: 0,
                    messageKey: "common:vue.settings.msgQueueChangesImportEmpty",
                };
            }

            const currentBaselineSnapshot = createEquipmentSetSnapshotFromPlayer(sourcePlayer);
            const importedItems = buildQueueItemsFromQueueChangeTemplates(currentBaselineSnapshot, queueChanges.items);
            if (importedItems.length <= 0) {
                return {
                    ok: false,
                    importedCount: 0,
                    messageKey: "common:vue.settings.msgQueueChangesImportEmpty",
                };
            }

            const queueState = this.ensureQueueState(normalizedPlayerId);
            queueState.baseline = {
                snapshot: deepClone(currentBaselineSnapshot),
                settings: buildQueueBaselineSettings(this.simulationSettings),
                metrics: null,
                simResult: null,
                createdAt: Date.now(),
            };
            queueState.items = importedItems;
            queueState.results = [];
            queueState.rawRuns = [];
            queueState.ranking = [];
            queueState.enhancementUpgradeCosts = {};
            queueState.abilityUpgradeCosts = {};
            queueState.isRunning = false;
            queueState.progress = 0;
            queueState.error = "";
            queueState.lastRunAt = 0;

            return {
                ok: true,
                importedCount: importedItems.length,
                messageKey: "common:vue.settings.msgQueueChangesImported",
            };
        },
        deleteEquipmentSet(name) {
            const setName = String(name || "").trim();
            if (!setName || !this.equipmentSets?.[setName]) {
                return false;
            }

            const nextSets = { ...this.equipmentSets };
            delete nextSets[setName];
            this.equipmentSets = nextSets;
            persistEquipmentSetsToStorage(this.equipmentSets);
            return true;
        },
        buildSingleSimulationPayload(playersToSim) {
            this.normalizeDifficulty();

            const simulationTimeHours = Math.max(1, Number(this.simulationSettings.simulationTimeHours || 24));
            const simulationTimeLimit = simulationTimeHours * ONE_HOUR;
            const extra = buildSimulationExtra(this.simulationSettings);

            let zone = null;
            let labyrinth = null;

            if (this.simulationSettings.mode === "labyrinth") {
                labyrinth = {
                    labyrinthHrid: this.simulationSettings.labyrinthHrid,
                    roomLevel: Math.max(20, Number(this.simulationSettings.roomLevel || 100)),
                    crates: this.getActiveLabyrinthCrates(),
                };
            } else {
                const zoneHrid = this.simulationSettings.useDungeon
                    ? this.simulationSettings.dungeonHrid
                    : this.simulationSettings.zoneHrid;

                zone = {
                    zoneHrid,
                    difficultyTier: Number(this.simulationSettings.difficultyTier || 0),
                };
            }

            return {
                type: "start_simulation",
                workerId: Math.floor(Math.random() * 1e9).toString(),
                players: playersToSim,
                zone,
                labyrinth,
                simulationTimeLimit,
                extra,
            };
        },
        runSingleSimulationPayload(payload, onProgress = () => {}) {
            return runSharedSingleSimulationPayload(payload, onProgress);
        },
        runSingleSimulationPayloadWithDedicatedWorker(payload, onProgress = () => {}, options = {}) {
            return runSingleSimulationPayloadWithDedicatedWorker(payload, onProgress, options);
        },
        async setQueueBaselineForActivePlayer(options = {}) {
            const queueState = this.ensureQueueState(this.activePlayerId);

            const shouldRunSimulation = options?.runSimulation === true;
            const preserveQueueItems = options?.preserveQueueItems !== false;
            const activePlayerId = String(this.activePlayerId);
            const activePlayer = this.players.find((player) => String(player.id) === activePlayerId) ?? this.activePlayer;
            const partySnapshot = createQueuePartySnapshot(this.players, activePlayerId);
            const preservedQueueItems = preserveQueueItems && Array.isArray(queueState.items)
                ? queueState.items.slice()
                : [];

            if (!activePlayer) {
                throw new Error("Active player is missing.");
            }

            if (!shouldRunSimulation) {
                queueState.baseline = {
                    snapshot: deepClone(this.activePlayer),
                    partySnapshot,
                    settings: buildQueueBaselineSettings(this.simulationSettings),
                    metrics: null,
                    simResult: null,
                    createdAt: Date.now(),
                };
                queueState.items = preserveQueueItems ? preservedQueueItems : [];
                queueState.results = [];
                queueState.rawRuns = [];
                queueState.ranking = [];
                queueState.enhancementUpgradeCosts = {};
                queueState.abilityUpgradeCosts = {};
                queueState.error = "";
                queueState.progress = 0;
                queueState.lastRunStatus = "idle";
                queueState.cancelRequested = false;
                return queueState.baseline;
            }

            if (this.queue.importedProfileByPlayer?.[activePlayerId] !== true) {
                throw new Error("common:queue.requireImportBeforeBaseline");
            }

            if (this.runtime.isRunning || this.isAnyQueueRunning || this.advisor.runtime?.isRunning) {
                throw new Error("Another simulation is already running.");
            }

            if (this.simulationSettings.runScope !== RUN_SCOPE_SINGLE) {
                throw new Error("Queue baseline requires run scope to be Single target.");
            }

            if (this.simulationSettings.mode === "labyrinth") {
                throw new Error("Queue baseline does not support labyrinth mode yet.");
            }

            const scenarioPlayers = partySnapshot.selectedPlayers.map((player) => ({
                ...deepClone(player),
                selected: true,
            }));
            const { buildPlayersForSimulation } = await loadPlayerMapperModule();
            const playersToSim = buildPlayersForSimulation(scenarioPlayers);
            if (playersToSim.length === 0) {
                throw new Error("Unable to build player simulation data.");
            }

            const selectedPlayersSnapshot = [{ id: activePlayerId, name: activePlayer?.name || `Player ${activePlayerId}` }];
            const pricingOptions = createProfitPricingOptions(this.pricing);
            const payload = this.buildSingleSimulationPayload(playersToSim);
            const startedAt = Date.now();

            queueState.isRunning = true;
            queueState.cancelRequested = false;
            queueState.progress = 0;
            queueState.error = "";
            this.runtime.isRunning = true;
            this.runtime.progress = 0;
            this.runtime.error = "";
            this.runtime.startedAt = startedAt;
            this.runtime.elapsedSeconds = 0;
            this.runtime.workerMode = "single";

            try {
                const simResult = await this.runSingleSimulationPayload(payload, (data) => {
                    const progress = clamp(Number(data.progress || 0), 0, 1);
                    queueState.progress = progress;
                    this.runtime.progress = progress;
                    this.runtime.elapsedSeconds = (Date.now() - startedAt) / 1000;
                });

                const summaryRow = summarizeResult(simResult, selectedPlayersSnapshot, pricingOptions)[0] || null;
                const summaryMetrics = summarizeQueueBaselineMetrics(summaryRow);
                const queueMetrics = computeQueueMetrics(simResult, activePlayerId, pricingOptions);
                queueState.baseline = {
                    snapshot: deepClone(this.activePlayer),
                    partySnapshot,
                    settings: buildQueueBaselineSettings(this.simulationSettings),
                    metrics: {
                        ...summaryMetrics,
                        ...queueMetrics,
                    },
                    simResult,
                    createdAt: Date.now(),
                };
                queueState.items = preserveQueueItems ? preservedQueueItems : [];
                queueState.results = [];
                queueState.rawRuns = [];
                queueState.ranking = [];
                queueState.enhancementUpgradeCosts = {};
                queueState.abilityUpgradeCosts = {};
                queueState.progress = 1;
                queueState.lastRunStatus = "idle";
                this.runtime.progress = 1;
                return queueState.baseline;
            } catch (error) {
                if (isWorkerRunCancelledError(error)) {
                    queueState.error = "";
                    this.runtime.error = "";
                    throw error;
                }
                const errorMessage = typeof error === "string" ? error : (error?.message || JSON.stringify(error));
                queueState.error = errorMessage;
                throw new Error(errorMessage);
            } finally {
                queueState.isRunning = false;
                queueState.cancelRequested = false;
                this.runtime.isRunning = false;
                this.runtime.elapsedSeconds = (Date.now() - startedAt) / 1000;
                workerClient.stopSimulation();
            }
        },
        addActivePlayerToQueue() {
            const queueState = this.ensureQueueState(this.activePlayerId);
            if (this.activeQueuePartyStatus?.hasMismatch) {
                queueState.error = this.activeQueuePartyStatus.messageKey || "common:queue.partyChangedSinceBaseline";
                return [];
            }
            if (!queueState.baseline?.snapshot) {
                return [];
            }

            const snapshot = deepClone(this.activePlayer);
            const changeSummary = computeQueueChangeSummary(queueState.baseline.snapshot, snapshot);
            if (changeSummary.count === 0) {
                return [];
            }

            const variants = buildQueueVariantSnapshotsFromChanges(queueState.baseline.snapshot, snapshot, changeSummary);
            if (variants.length === 0) {
                return [];
            }

            const appendedItems = variants.map((variant) => {
                const fallbackName = `Variant ${queueState.items.length + 1}`;
                const nextItem = {
                    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    name: String(variant?.name || fallbackName),
                    snapshot: deepClone(variant.snapshot),
                    changes: Array.isArray(variant.labels) ? variant.labels : [],
                    changeDetails: Array.isArray(variant.changeDetails) ? deepClone(variant.changeDetails) : [],
                    createdAt: Date.now(),
                };
                queueState.items.push(nextItem);
                return nextItem;
            });

            // Keep parity with legacy flow: after queueing current diff, return editor state to baseline.
            const baselineSnapshot = queueState.baseline?.snapshot ?? null;
            if (baselineSnapshot) {
                const currentActive = this.players.find((player) => String(player.id) === this.activePlayerId);
                const currentSelected = currentActive?.selected ?? true;
                const activePlayerId = String(this.activePlayerId);
                this.players = this.players.map((player) => {
                    if (String(player.id) !== activePlayerId) {
                        return player;
                    }
                    return {
                        ...deepClone(baselineSnapshot),
                        id: activePlayerId,
                        selected: currentSelected,
                    };
                });
            }
            queueState.results = [];
            queueState.rawRuns = [];
            queueState.ranking = [];
            queueState.error = "";
            queueState.lastRunStatus = "idle";
            return appendedItems;
        },
        updateActiveQueueSettings(partialSettings = {}) {
            const queueState = this.ensureQueueState(this.activePlayerId);
            queueState.settings = normalizeQueueSettings({
                ...queueState.settings,
                ...partialSettings,
            });
            return queueState.settings;
        },
        removeQueueItem(itemId) {
            const queueState = this.ensureQueueState(this.activePlayerId);
            queueState.items = queueState.items.filter((item) => item.id !== itemId);
        },
        clearActiveQueue() {
            const queueState = this.ensureQueueState(this.activePlayerId);
            queueState.items = [];
            queueState.results = [];
            queueState.rawRuns = [];
            queueState.ranking = [];
            queueState.progress = 0;
            queueState.error = "";
            queueState.lastRunStatus = "idle";
        },
        loadQueueSnapshotToActivePlayer(snapshotId) {
            const queueState = this.ensureQueueState(this.activePlayerId);
            const activePlayerId = String(this.activePlayerId);
            const currentActive = this.players.find((player) => String(player.id) === activePlayerId);
            const currentSelected = currentActive?.selected ?? true;

            const normalizedSnapshotId = String(snapshotId || "").trim();
            if (!normalizedSnapshotId) {
                return false;
            }
            const targetSnapshot = queueState.items.find((item) => item.id === normalizedSnapshotId)?.snapshot ?? null;

            if (!targetSnapshot) {
                return false;
            }

            this.players = this.players.map((player) => {
                if (String(player.id) !== activePlayerId) {
                    return player;
                }
                return {
                    ...deepClone(targetSnapshot),
                    id: activePlayerId,
                    selected: currentSelected,
                };
            });
            this.persistPlayerAchievements();

            return true;
        },
        async refreshQueueResultsFromRawRuns(options = {}) {
            const playerId = String(options?.playerId || this.activePlayerId);
            const queueState = this.ensureQueueState(playerId);
            const entries = buildQueueEntriesFromState(queueState);
            const entrySortIndexById = new Map(entries.map((entry, index) => [entry.id, index]));
            const includeEmptyEntries = options?.includeEmptyEntries === true;
            const allowReferenceLoad = options?.allowReferenceLoad !== false;

            if (entries.length === 0) {
                queueState.results = [];
                queueState.ranking = [];
                if (options?.sortRawRuns !== false) {
                    queueState.rawRuns = [];
                }
                return [];
            }

            if (
                allowReferenceLoad
                && queueEntriesNeedAbilityUpgradeReference(entries)
                && !hasAbilityUpgradeReferenceDataLoaded()
            ) {
                await this.ensureAbilityUpgradeReferenceDataLoaded();
            }

            const queueSettings = normalizeQueueSettings(queueState.settings);
            queueState.settings = queueSettings;
            const baselineMetrics = isPlainObject(queueState?.baseline?.metrics) ? queueState.baseline.metrics : {};
            const rankedRows = buildQueueRankedRowsFromSampleState({
                entries,
                rawRuns: queueState.rawRuns,
                queueSettings,
                queueState,
                baselineMetrics,
                pricingState: this.pricing,
                scoreWeights: this.queueRuntime?.finalWeights,
                includeEmptyEntries,
            });

            queueState.results = rankedRows;
            queueState.ranking = rankedRows;
            if (options?.sortRawRuns !== false) {
                queueState.rawRuns = sortQueueRawRuns(queueState.rawRuns, entrySortIndexById);
            }
            if (options?.updateLastRunAt === true) {
                queueState.lastRunAt = Date.now();
            }

            return rankedRows;
        },
        async runActiveQueue() {
            const queueState = this.ensureQueueState(this.activePlayerId);
            queueState.error = "";

            if (this.runtime.isRunning || this.isAnyQueueRunning || this.advisor.runtime?.isRunning) {
                queueState.error = "Another simulation is already running.";
                return [];
            }

            if (this.simulationSettings.runScope !== RUN_SCOPE_SINGLE) {
                queueState.error = "Queue run requires run scope to be Single target.";
                return [];
            }

            if (!queueState.baseline?.snapshot) {
                queueState.error = "Set baseline first.";
                return [];
            }

            if (this.activeQueuePartyStatus?.hasMismatch) {
                queueState.error = this.activeQueuePartyStatus.messageKey || "common:queue.partyChangedSinceBaseline";
                return [];
            }

            if (queueState.items.length === 0) {
                queueState.error = "Queue is empty.";
                return [];
            }

            const queueSettings = normalizeQueueSettings(queueState.settings);
            queueState.settings = queueSettings;
            const executionMode = queueSettings.executionMode === "parallel" ? "parallel" : "serial";

            const activePlayerId = String(this.activePlayerId);
            const basePlayer = this.players.find((player) => String(player.id) === activePlayerId) ?? this.activePlayer;
            const selectedPlayersSnapshot = [{ id: activePlayerId, name: basePlayer?.name || `Player ${activePlayerId}` }];
            const pricingOptions = createProfitPricingOptions(this.pricing);
            const queueRunId = Number(queueState.runId || 0) + 1;
            const startedAt = Date.now();
            const recomputedBaselineMetrics = queueState?.baseline?.simResult
                ? computeQueueMetrics(queueState.baseline.simResult, activePlayerId, pricingOptions)
                : null;

            if (queueState?.baseline) {
                queueState.baseline.metrics = {
                    ...(isPlainObject(queueState.baseline.metrics) ? queueState.baseline.metrics : {}),
                    ...(isPlainObject(recomputedBaselineMetrics) ? recomputedBaselineMetrics : {}),
                };
            }
            const baselineMetrics = isPlainObject(queueState?.baseline?.metrics) ? queueState.baseline.metrics : {};

            const entries = buildQueueEntriesFromState(queueState);

            queueState.isRunning = true;
            queueState.runId = queueRunId;
            queueState.cancelRequested = false;
            queueState.progress = 0;
            queueState.results = [];
            queueState.rawRuns = [];
            queueState.ranking = [];
            queueState.lastRunStatus = "running";
            this.runtime.isRunning = true;
            this.runtime.progress = 0;
            this.runtime.error = "";
            this.runtime.startedAt = startedAt;
            this.runtime.elapsedSeconds = 0;
            this.runtime.workerMode = "single";

            const roundCount = queueSettings.rounds;
            const totalRuns = entries.length * roundCount;
            let completedRuns = 0;
            const runProgressByRunKey = new Map();
            const isCurrentQueueRun = () => Number(queueState.runId || 0) === queueRunId;
            const isActiveQueueRun = () => isCurrentQueueRun() && queueState.cancelRequested !== true;
            const ensureCurrentQueueRun = () => {
                if (!isCurrentQueueRun()) {
                    throw createWorkerRunCancellationError("Queue run cancelled.");
                }
            };
            const ensureQueueRunNotCancelled = () => {
                if (!isActiveQueueRun()) {
                    throw createWorkerRunCancellationError("Queue run cancelled.");
                }
            };
            const queueParallelWorkerLimit = executionMode === "parallel"
                ? Math.max(
                    1,
                    Math.min(
                        normalizeParallelWorkerLimit(this.queueRuntime?.parallelWorkerLimit, this.queueParallelWorkerHardMax),
                        entries.length
                    )
                )
                : 1;

            const REALTIME_RANKING_THROTTLE_MS = 250;
            let lastRealtimeRankingAt = 0;
            const updateQueueRunProgress = () => {
                if (!isCurrentQueueRun()) {
                    return;
                }
                const inProgress = Array.from(runProgressByRunKey.values())
                    .reduce((sum, value) => sum + clamp(Number(value || 0), 0, 1), 0);
                const overall = (completedRuns + inProgress) / totalRuns;
                queueState.progress = clamp(overall, 0, 1);
                this.runtime.progress = queueState.progress;
                this.runtime.elapsedSeconds = (Date.now() - startedAt) / 1000;
            };
            const updateRealtimeRanking = (force = false) => {
                if (!isCurrentQueueRun()) {
                    return;
                }
                const now = Date.now();
                if (!force && now - lastRealtimeRankingAt < REALTIME_RANKING_THROTTLE_MS) {
                    return;
                }
                const realtimeRows = buildQueueRankedRowsFromSampleState({
                    entries,
                    rawRuns: queueState.rawRuns,
                    queueSettings,
                    queueState,
                    baselineMetrics,
                    pricingState: this.pricing,
                    scoreWeights: this.queueRuntime?.finalWeights,
                    includeEmptyEntries: false,
                });
                if (realtimeRows.length <= 0) {
                    return;
                }
                queueState.results = realtimeRows;
                queueState.ranking = realtimeRows;
                lastRealtimeRankingAt = now;
            };

            const buildScenarioPlayers = (entrySnapshot) => {
                const basePartyPlayers = Array.isArray(queueState?.baseline?.partySnapshot?.selectedPlayers)
                    && queueState.baseline.partySnapshot.selectedPlayers.length > 0
                    ? queueState.baseline.partySnapshot.selectedPlayers
                    : buildQueuePartySelectedPlayers(this.players, activePlayerId);
                const scenarioPlayers = basePartyPlayers.map((player) => ({
                    ...deepClone(player),
                    selected: true,
                }));

                const activeIndex = scenarioPlayers.findIndex((player) => String(player.id) === activePlayerId);
                if (activeIndex === -1) {
                    throw new Error("Unable to locate active player for queue run.");
                }

                scenarioPlayers[activeIndex] = {
                    ...deepClone(entrySnapshot),
                    id: activePlayerId,
                    selected: true,
                    name: entrySnapshot?.name || selectedPlayersSnapshot[0].name,
                };

                return scenarioPlayers;
            };

            const runEntryRound = async (entry, roundIndex) => {
                ensureQueueRunNotCancelled();
                const runKey = `${entry.id}-${roundIndex + 1}`;
                runProgressByRunKey.set(runKey, 0);
                updateQueueRunProgress();
                let completedSuccessfully = false;

                try {
                    const { buildPlayersForSimulation } = await loadPlayerMapperModule();
                    const playersToSim = buildPlayersForSimulation(buildScenarioPlayers(entry.snapshot));
                    const payload = this.buildSingleSimulationPayload(playersToSim);
                    const runSingle = executionMode === "parallel"
                        ? this.runSingleSimulationPayloadWithDedicatedWorker
                        : this.runSingleSimulationPayload;

                    const simResult = await runSingle(payload, (data) => {
                        if (!isActiveQueueRun()) {
                            return;
                        }
                        runProgressByRunKey.set(runKey, clamp(Number(data.progress || 0), 0, 1));
                        updateQueueRunProgress();
                    });

                    ensureCurrentQueueRun();
                    const summary = summarizeResult(simResult, selectedPlayersSnapshot, pricingOptions)[0] || {};
                    const metrics = computeQueueMetrics(simResult, activePlayerId, pricingOptions);
                    const deltas = computeQueueMetricDeltas(metrics, baselineMetrics);

                    const sampleRow = {
                        id: entry.id,
                        label: entry.label,
                        changes: Array.isArray(entry.changes) ? [...entry.changes] : [],
                        changeDetails: Array.isArray(entry.changeDetails) ? deepClone(entry.changeDetails) : [],
                        round: roundIndex + 1,
                        metrics,
                        deltas,
                        ...summary,
                    };
                    queueState.rawRuns.push(sampleRow);
                    completedSuccessfully = true;
                    updateRealtimeRanking(false);
                } finally {
                    runProgressByRunKey.delete(runKey);
                    if (completedSuccessfully) {
                        completedRuns += 1;
                    }
                    updateQueueRunProgress();
                }
            };

            try {
                for (let roundIndex = 0; roundIndex < roundCount; roundIndex++) {
                    ensureQueueRunNotCancelled();
                    if (executionMode === "parallel" && entries.length > 1) {
                        let nextEntryIndex = 0;
                        const workerCount = Math.max(1, Math.min(queueParallelWorkerLimit, entries.length));
                        const workerLoop = async () => {
                            while (nextEntryIndex < entries.length) {
                                ensureQueueRunNotCancelled();
                                const currentEntryIndex = nextEntryIndex;
                                nextEntryIndex += 1;
                                const entry = entries[currentEntryIndex];
                                // eslint-disable-next-line no-await-in-loop
                                await runEntryRound(entry, roundIndex);
                            }
                        };
                        await Promise.all(Array.from({ length: workerCount }, () => workerLoop()));
                        continue;
                    }

                    for (const entry of entries) {
                        ensureQueueRunNotCancelled();
                        // eslint-disable-next-line no-await-in-loop
                        await runEntryRound(entry, roundIndex);
                    }
                }

                ensureQueueRunNotCancelled();
                const rankedRows = await this.refreshQueueResultsFromRawRuns({
                    playerId: activePlayerId,
                    includeEmptyEntries: true,
                    allowReferenceLoad: true,
                    sortRawRuns: true,
                    updateLastRunAt: true,
                });
                queueState.lastRunStatus = "completed";
                return rankedRows;
            } catch (error) {
                if (isWorkerRunCancelledError(error)) {
                    queueState.error = "";
                    this.runtime.error = "";
                    queueState.lastRunStatus = "cancelled";
                    if (queueState.rawRuns.length > 0) {
                        try {
                            return await this.refreshQueueResultsFromRawRuns({
                                playerId: activePlayerId,
                                includeEmptyEntries: false,
                                allowReferenceLoad: false,
                                sortRawRuns: true,
                                updateLastRunAt: false,
                            });
                        } catch (refreshError) {
                            // keep the best partial ranking we already have if cancelled refresh fails
                        }
                    }
                    return Array.isArray(queueState.ranking) ? queueState.ranking : [];
                }
                queueState.lastRunStatus = "failed";
                queueState.error = typeof error === "string" ? error : (error?.message || JSON.stringify(error));
                return [];
            } finally {
                if (isCurrentQueueRun()) {
                    queueState.isRunning = false;
                    queueState.cancelRequested = false;
                }
                this.runtime.isRunning = false;
                this.runtime.elapsedSeconds = (Date.now() - startedAt) / 1000;
                workerClient.stopSimulation();
                stopQueueWorkerClients();
            }
        },
        setActivePlayer(id) {
            this.activePlayerId = String(id);
            this.ensureQueueState(this.activePlayerId);
            if (!Object.prototype.hasOwnProperty.call(this.queue.importedProfileByPlayer, this.activePlayerId)) {
                this.setImportedProfileState(this.activePlayerId, false);
            }
            const player = this.activePlayer;
            if (player && !isPlainObject(player.triggerMap)) {
                player.triggerMap = {};
            }
            this.syncActiveResultPlayerToActivePlayer(this.activePlayerId);
        },
        setConsumablePriceMode(mode) {
            this.pricing.consumableMode = normalizePriceMode(mode, PRICE_MODE_ASK);
            persistPricingSettingsToStorage(this.pricing);
        },
        setDropPriceMode(mode) {
            this.pricing.dropMode = normalizePriceMode(mode, PRICE_MODE_BID);
            persistPricingSettingsToStorage(this.pricing);
        },
        setPriceOverride(itemHrid, patch) {
            const hrid = String(itemHrid || "");
            const sourcePatch = isPlainObject(patch) ? patch : {};
            const hasAskPatch = Object.prototype.hasOwnProperty.call(sourcePatch, "ask");
            const hasBidPatch = Object.prototype.hasOwnProperty.call(sourcePatch, "bid");
            if (!hrid || (!hasAskPatch && !hasBidPatch)) {
                return false;
            }

            const nextOverrides = {
                ...normalizePriceOverrideMap(this.pricing.overrides),
            };
            const nextEntry = {
                ...(nextOverrides[hrid] || {}),
            };

            if (Object.prototype.hasOwnProperty.call(sourcePatch, "ask")) {
                const normalizedAsk = normalizePriceOverrideValue(sourcePatch.ask);
                if (normalizedAsk === null) {
                    delete nextEntry.ask;
                } else {
                    nextEntry.ask = normalizedAsk;
                }
            }

            if (Object.prototype.hasOwnProperty.call(sourcePatch, "bid")) {
                const normalizedBid = normalizePriceOverrideValue(sourcePatch.bid);
                if (normalizedBid === null) {
                    delete nextEntry.bid;
                } else {
                    nextEntry.bid = normalizedBid;
                }
            }

            if (Object.keys(nextEntry).length > 0) {
                nextOverrides[hrid] = nextEntry;
            } else {
                delete nextOverrides[hrid];
            }

            this.pricing.overrides = nextOverrides;
            rehydratePricingTable(this.pricing);
            persistPricingSettingsToStorage(this.pricing);
            return true;
        },
        resetPriceOverride(itemHrid) {
            const hrid = String(itemHrid || "");
            const currentOverrides = this.pricing.overrides || {};
            if (!hrid || !Object.prototype.hasOwnProperty.call(currentOverrides, hrid)) {
                return false;
            }

            const nextOverrides = {
                ...normalizePriceOverrideMap(currentOverrides),
            };
            delete nextOverrides[hrid];

            this.pricing.overrides = nextOverrides;
            rehydratePricingTable(this.pricing);
            persistPricingSettingsToStorage(this.pricing);
            return true;
        },
        resetAllPriceOverrides() {
            if (Object.keys(this.pricing.overrides || {}).length === 0) {
                return false;
            }

            this.pricing.overrides = {};
            rehydratePricingTable(this.pricing);
            persistPricingSettingsToStorage(this.pricing);
            return true;
        },
        async fetchMarketPrices() {
            if (this.pricing.isLoading) {
                return null;
            }

            this.pricing.isLoading = true;
            this.pricing.error = "";

            try {
                const result = await fetchMarketPriceTable();
                this.pricing.basePriceTable = cloneBasePriceTable(result.priceTable);
                this.pricing.enhancementQuotesByItem = normalizeEnhancementQuotesByItem(result.enhancementQuotesByItem);
                this.pricing.enhancementLevelsByItem = normalizeEnhancementLevelsByItem(result.enhancementLevelsByItem);
                rehydratePricingTable(this.pricing);
                this.pricing.lastFetchedAt = Number(result.fetchedAt || Date.now());
                this.pricing.sourceUrl = String(result.sourceUrl || "");
                persistMarketCacheToStorage({
                    basePriceTable: this.pricing.basePriceTable,
                    enhancementQuotesByItem: this.pricing.enhancementQuotesByItem,
                    enhancementLevelsByItem: this.pricing.enhancementLevelsByItem,
                    lastFetchedAt: this.pricing.lastFetchedAt,
                    sourceUrl: this.pricing.sourceUrl,
                });
                return {
                    sourceUrl: this.pricing.sourceUrl,
                    lastFetchedAt: this.pricing.lastFetchedAt,
                };
            } catch (error) {
                this.pricing.error = typeof error === "string" ? error : (error?.message || "Fetch market prices failed.");
                throw error;
            } finally {
                this.pricing.isLoading = false;
            }
        },
        resetPricesToVendorDefaults() {
            this.pricing.basePriceTable = createDefaultPriceTable();
            this.pricing.enhancementQuotesByItem = {};
            this.pricing.enhancementLevelsByItem = {};
            rehydratePricingTable(this.pricing);
            this.pricing.lastFetchedAt = 0;
            this.pricing.sourceUrl = "";
            this.pricing.error = "";
            clearMarketCacheFromStorage();
        },
        async ensureMarketPricesLoaded(forceRefresh = false) {
            if (this.pricing.isLoading) {
                return null;
            }

            if (forceRefresh) {
                try {
                    return await this.fetchMarketPrices();
                } catch (error) {
                    return null;
                }
            }

            const hasEnhancementQuotes = Object.keys(this.pricing?.enhancementQuotesByItem || {}).length > 0;
            const hasEnhancementLevels = Object.keys(this.pricing?.enhancementLevelsByItem || {}).length > 0;
            const hasEnhancementData = hasEnhancementQuotes || hasEnhancementLevels;
            const hasCachedPriceTable = this.pricing.lastFetchedAt > 0 || Boolean(this.pricing.sourceUrl);

            // Legacy cache may contain only level-0 price table without enhancement-level quotes.
            if (hasCachedPriceTable && hasEnhancementData) {
                return null;
            }

            try {
                return await this.fetchMarketPrices();
            } catch (error) {
                return null;
            }
        },
        async ensureAbilityUpgradeReferenceDataLoaded(forceRefresh = false) {
            const globalRef = ensureAbilityUpgradeReferenceGlobals();
            const hasCachedAbilityXp = hasAbilityUpgradeReferenceDataLoaded();
            const hasCachedSpellBookXp = globalRef.jigsSpellBookXpByName
                && typeof globalRef.jigsSpellBookXpByName === "object"
                && Object.keys(globalRef.jigsSpellBookXpByName).length > 0;
            const hasCachedReference = hasCachedAbilityXp && (hasCachedSpellBookXp || Object.keys(abilityBookInfoByAbilityHrid).length > 0);

            if (hasCachedReference && !forceRefresh) {
                return {
                    loaded: true,
                    source: "cache",
                };
            }

            if (abilityUpgradeReferenceLoadPromise && !forceRefresh) {
                return abilityUpgradeReferenceLoadPromise;
            }

            const loadTask = (async () => {
                try {
                    const bundledXpLevels = Array.isArray(abilityXpLevels)
                        ? abilityXpLevels.map((value) => toFiniteNumber(value, 0))
                        : [];
                    if (bundledXpLevels.length <= 1) {
                        return {
                            loaded: false,
                            source: "bundle",
                            error: "Bundled ability XP levels are missing or invalid.",
                        };
                    }

                    globalRef.jigsAbilityXpLevels = bundledXpLevels;
                    this.abilityUpgradeReferenceVersion = Date.now();
                    const queueStates = Object.entries(this.queue?.byPlayer || {})
                        .filter(([, queueState]) => Array.isArray(queueState?.rawRuns) && queueState.rawRuns.length > 0);

                    await Promise.all(queueStates.map(async ([playerId, queueState]) => {
                        await this.refreshQueueResultsFromRawRuns({
                            playerId,
                            includeEmptyEntries: queueState?.isRunning !== true && queueState?.lastRunStatus === "completed",
                            allowReferenceLoad: false,
                            sortRawRuns: false,
                            updateLastRunAt: false,
                        });
                    }));

                    return {
                        loaded: true,
                        source: "bundle",
                    };
                } catch (error) {
                    return {
                        loaded: false,
                        source: "bundle",
                        error: typeof error === "string" ? error : (error?.message || "Failed to load ability upgrade references."),
                    };
                } finally {
                    abilityUpgradeReferenceLoadPromise = null;
                }
            })();

            abilityUpgradeReferenceLoadPromise = loadTask;
            return loadTask;
        },
        setLanguage(language) {
            this.ui.language = language === "zh" ? "zh" : "en";
        },
        exportGroupConfig() {
            return exportGroupConfig(this.players, this.simulationSettings);
        },
        exportSoloConfig(playerId) {
            const targetId = String(playerId || this.activePlayerId);
            const targetPlayer = this.players.find((player) => player.id === targetId) || this.activePlayer;
            return exportSoloConfig(targetPlayer, this.simulationSettings);
        },
        importGroupConfig(text) {
            const result = parseGroupImportConfig(text, this.players, this.simulationSettings);
            const byId = Object.fromEntries(result.players.map((player) => [String(player.id), player]));
            this.players = this.players.map((player) => byId[String(player.id)] || player);
            this.persistPlayerAchievements();
            result.players.forEach((player) => {
                this.setImportedProfileState(player.id, true);
                this.setImportedBaselineSnapshot(player.id, player);
            });
            this.simulationSettings = {
                ...this.simulationSettings,
                ...result.simulationSettings,
            };
            this.normalizeRunScope();
            this.normalizeDifficulty();
            return result;
        },
        importSoloConfig(text, playerId) {
            const targetId = String(playerId || this.activePlayerId);
            const currentPlayer = this.players.find((player) => player.id === targetId) || this.activePlayer;
            const result = parseSoloImportConfig(text, currentPlayer, this.simulationSettings);

            this.players = this.players.map((player) => (player.id === targetId ? result.player : player));
            this.persistPlayerAchievements();
            this.setImportedProfileState(targetId, true);
            this.setImportedBaselineSnapshot(targetId, result.player);
            this.simulationSettings = {
                ...this.simulationSettings,
                ...result.simulationSettings,
            };
            this.normalizeRunScope();
            this.normalizeDifficulty();
            return result;
        },
        setSimulationMode(mode) {
            this.simulationSettings.mode = mode === "labyrinth" ? "labyrinth" : "zone";
            this.normalizeRunScope();
            this.normalizeDifficulty();
        },
        setRunScope(scope) {
            this.simulationSettings.runScope = String(scope || RUN_SCOPE_SINGLE);
            this.normalizeRunScope();
        },
        normalizeBatchSelections() {
            const groupHrids = this.groupZoneOptions.map((zone) => String(zone.hrid || ""));
            const soloHrids = this.soloZoneOptions.map((zone) => String(zone.hrid || ""));
            this.simulationSettings.selectedGroupZoneHrids = normalizeZoneSelection(
                this.simulationSettings.selectedGroupZoneHrids,
                groupHrids
            );
            this.simulationSettings.selectedSoloZoneHrids = normalizeZoneSelection(
                this.simulationSettings.selectedSoloZoneHrids,
                soloHrids
            );
            this.simulationSettings.labyrinthCrates = normalizeLabyrinthCrates(this.simulationSettings.labyrinthCrates);
        },
        setSelectedGroupZoneHrids(hrids = []) {
            const allHrids = this.groupZoneOptions.map((zone) => String(zone.hrid || ""));
            this.simulationSettings.selectedGroupZoneHrids = normalizeZoneSelection(hrids, allHrids);
        },
        setSelectedSoloZoneHrids(hrids = []) {
            const allHrids = this.soloZoneOptions.map((zone) => String(zone.hrid || ""));
            this.simulationSettings.selectedSoloZoneHrids = normalizeZoneSelection(hrids, allHrids);
        },
        toggleSelectedGroupZoneHrid(zoneHrid, checked) {
            const hrid = String(zoneHrid || "");
            if (!hrid) {
                return;
            }
            const current = new Set(this.simulationSettings.selectedGroupZoneHrids || []);
            if (checked) {
                current.add(hrid);
            } else {
                current.delete(hrid);
            }
            this.setSelectedGroupZoneHrids(Array.from(current));
        },
        toggleSelectedSoloZoneHrid(zoneHrid, checked) {
            const hrid = String(zoneHrid || "");
            if (!hrid) {
                return;
            }
            const current = new Set(this.simulationSettings.selectedSoloZoneHrids || []);
            if (checked) {
                current.add(hrid);
            } else {
                current.delete(hrid);
            }
            this.setSelectedSoloZoneHrids(Array.from(current));
        },
        setLabyrinthCrate(crateType, itemHrid) {
            const normalized = normalizeLabyrinthCrates({
                ...this.simulationSettings.labyrinthCrates,
                [crateType]: itemHrid,
            });
            this.simulationSettings.labyrinthCrates = normalized;
        },
        getActiveLabyrinthCrates() {
            const crates = this.simulationSettings.labyrinthCrates || {};
            const values = [String(crates.coffee || ""), String(crates.food || "")].filter(Boolean);
            return Array.from(new Set(values));
        },
        normalizeSimulationBuffLevels() {
            this.simulationSettings.comExp = clamp(Math.floor(toFiniteNumber(this.simulationSettings.comExp, 20)), 1, 99);
            this.simulationSettings.comDrop = clamp(Math.floor(toFiniteNumber(this.simulationSettings.comDrop, 20)), 1, 99);
        },
        persistSimulationUiSettings() {
            this.normalizeSimulationBuffLevels();
            persistSimulationUiSettingsToStorage(this.simulationSettings);
        },
        normalizeRunScope() {
            const scope = this.simulationSettings.runScope;
            this.normalizeBatchSelections();

            if (this.simulationSettings.mode === "labyrinth") {
                if (scope !== RUN_SCOPE_SINGLE && scope !== RUN_SCOPE_ALL_LABYRINTHS) {
                    this.simulationSettings.runScope = RUN_SCOPE_SINGLE;
                }
                this.simulationSettings.useDungeon = false;
                return;
            }

            if (
                scope !== RUN_SCOPE_SINGLE
                && scope !== RUN_SCOPE_ALL_GROUP_ZONES
                && scope !== RUN_SCOPE_ALL_SOLO_ZONES
            ) {
                this.simulationSettings.runScope = RUN_SCOPE_SINGLE;
            }

            if (this.simulationSettings.runScope !== RUN_SCOPE_SINGLE) {
                this.simulationSettings.useDungeon = false;
            }
        },
        normalizeDifficulty() {
            const maxDifficulty = Math.min(5, this.currentMaxDifficulty);
            this.simulationSettings.difficultyTier = clamp(Number(this.simulationSettings.difficultyTier || 0), 0, maxDifficulty);
        },
        resetResultsForRun() {
            this.results.simResult = null;
            this.results.simResults = [];
            this.results.summaryRows = [];
            this.results.batchRows = [];
            this.results.batchResultType = "";
            this.results.timeSeriesData = null;
            this.syncActiveResultPlayerToActivePlayer(this.activePlayerId);
        },
        resetAdvisorState() {
            this.advisor = createAdvisorState();
            return this.advisor;
        },
        rerankAdvisorResults(options = {}) {
            const normalizedGoalPreset = normalizeAdvisorGoalPreset(options.goalPreset ?? this.advisor.goalPreset);
            const normalizedCustomWeights = normalizeAdvisorWeights(
                options.customWeights ?? this.advisor.customWeights,
                ADVISOR_GOAL_PRESET_BALANCED
            );
            const quickRowsSource = Array.isArray(options.quickRows) ? options.quickRows : this.advisor.quickRows;
            const refinedRowsSource = Array.isArray(options.refinedRows) ? options.refinedRows : this.advisor.refinedRows;
            const rankedQuickRows = rankAdvisorRows(quickRowsSource, {
                goalPreset: normalizedGoalPreset,
                customWeights: normalizedCustomWeights,
            });
            const quickRankById = new Map(rankedQuickRows.map((row, index) => [row.id, index + 1]));
            const rankedRefinedRows = rankAdvisorRows(refinedRowsSource, {
                goalPreset: normalizedGoalPreset,
                customWeights: normalizedCustomWeights,
                quickRankById,
            });
            const activeRows = rankedRefinedRows.length > 0 ? rankedRefinedRows : rankedQuickRows;

            this.advisor.goalPreset = normalizedGoalPreset;
            this.advisor.customWeights = normalizedCustomWeights;
            this.advisor.quickRows = rankedQuickRows;
            this.advisor.refinedRows = rankedRefinedRows;
            this.advisor.topCards = buildAdvisorTopCards(activeRows);
            return activeRows;
        },
        async runAdvisorScan() {
            this.advisor.error = "";

            if (this.runtime.isRunning || this.isAnyQueueRunning || this.advisor.runtime?.isRunning) {
                this.advisor.error = "Another simulation is already running.";
                return [];
            }

            const selectedPlayersSnapshot = this.selectedPlayers.map((player) => ({ id: player.id, name: player.name }));
            if (selectedPlayersSnapshot.length === 0) {
                this.advisor.error = "Please select at least one player.";
                return [];
            }

            const { buildPlayersForSimulation } = await loadPlayerMapperModule();
            const playersToSim = buildPlayersForSimulation(this.players);
            if (playersToSim.length === 0) {
                this.advisor.error = "Unable to build player simulation data.";
                return [];
            }

            const normalizedFilters = normalizeAdvisorFilters(this.advisor.filters);
            const normalizedGoalPreset = normalizeAdvisorGoalPreset(this.advisor.goalPreset);
            const normalizedCustomWeights = normalizeAdvisorWeights(this.advisor.customWeights, ADVISOR_GOAL_PRESET_BALANCED);
            const candidates = buildAdvisorCandidates(normalizedFilters);
            const metricPlayer = resolveAdvisorMetricPlayer(selectedPlayersSnapshot, this.activePlayerId);

            this.advisor.filters = normalizedFilters;
            this.advisor.goalPreset = normalizedGoalPreset;
            this.advisor.customWeights = normalizedCustomWeights;
            this.advisor.quickRows = [];
            this.advisor.refinedRows = [];
            this.advisor.topCards = [];
            this.advisor.metricPlayerId = metricPlayer.id;
            this.advisor.metricPlayerName = metricPlayer.name;

            if (candidates.length === 0) {
                this.advisor.error = "No advisor targets available for the current filters.";
                return [];
            }

            const simulationTimeHours = Math.max(1, Number(this.simulationSettings.simulationTimeHours || 24));
            const simulationTimeLimit = simulationTimeHours * ONE_HOUR;
            const extra = {
                ...buildSimulationExtra(this.simulationSettings),
                enableHpMpVisualization: false,
            };
            const pricingOptions = createProfitPricingOptions(this.pricing);
            const refineTopCount = normalizedFilters.refineTopEnabled
                ? Math.min(normalizedFilters.refineTopCount, candidates.length)
                : 0;
            const refineTotal = refineTopCount * normalizedFilters.refineRounds;
            const totalWorkUnits = Math.max(1, candidates.length + refineTotal);
            const startedAt = Date.now();
            const runId = Number(this.advisor.runtime?.runId || 0) + 1;
            let quickCompleted = 0;
            let refineCompleted = 0;
            const errorMessages = [];
            const quickRowsById = new Map();
            const refinedRowsById = new Map();

            this.advisor.runtime.runId = runId;
            this.advisor.runtime.cancelRequested = false;

            const isCurrentAdvisorRun = () => Number(this.advisor.runtime?.runId || 0) === runId;
            const isActiveAdvisorRun = () => isCurrentAdvisorRun() && this.advisor.runtime?.cancelRequested !== true;
            const getAdvisorRowsForReturn = () => (
                Array.isArray(this.advisor.refinedRows) && this.advisor.refinedRows.length > 0
                    ? this.advisor.refinedRows
                    : this.advisor.quickRows
            );
            const ensureActiveAdvisorRun = () => {
                if (!isActiveAdvisorRun()) {
                    throw createWorkerRunCancellationError("Advisor scan cancelled.");
                }
            };

            const updateAdvisorRuntime = (phase, quickFraction = 0, refineFraction = 0) => {
                if (!isActiveAdvisorRun()) {
                    return;
                }

                this.advisor.runtime.isRunning = true;
                this.advisor.runtime.phase = phase;
                this.advisor.runtime.startedAt = startedAt;
                this.advisor.runtime.elapsedSeconds = (Date.now() - startedAt) / 1000;
                this.advisor.runtime.quickCompleted = quickCompleted;
                this.advisor.runtime.quickTotal = candidates.length;
                this.advisor.runtime.refineCompleted = refineCompleted;
                this.advisor.runtime.refineTotal = refineTotal;
                this.advisor.runtime.runId = runId;
                this.advisor.runtime.cancelRequested = false;
                const completedUnits = quickCompleted + quickFraction + refineCompleted + refineFraction;
                this.advisor.runtime.progress = clamp(completedUnits / totalWorkUnits, 0, 1);
            };

            const rerankLiveQuickRows = () => {
                if (!isActiveAdvisorRun()) {
                    return;
                }

                this.rerankAdvisorResults({
                    goalPreset: normalizedGoalPreset,
                    customWeights: normalizedCustomWeights,
                    quickRows: Array.from(quickRowsById.values()),
                    refinedRows: [],
                });
            };

            const rerankLiveRefinedRows = () => {
                if (!isActiveAdvisorRun()) {
                    return;
                }

                const mergedRows = this.advisor.quickRows.map((row) => refinedRowsById.get(row.id) || row);
                this.rerankAdvisorResults({
                    goalPreset: normalizedGoalPreset,
                    customWeights: normalizedCustomWeights,
                    quickRows: this.advisor.quickRows,
                    refinedRows: mergedRows,
                });
            };

            const storeQuickResult = (candidate, simResult) => {
                if (!candidate || quickRowsById.has(candidate.id) || !simResult) {
                    return false;
                }

                const sample = summarizeAdvisorTargetResult(simResult, selectedPlayersSnapshot, metricPlayer.id, pricingOptions);
                quickRowsById.set(candidate.id, buildAdvisorRowFromRoundMetrics(candidate, [sample], {
                    isRefined: false,
                    refineRounds: 0,
                }));
                quickCompleted += 1;
                updateAdvisorRuntime("quick_scan", 0, 0);
                rerankLiveQuickRows();
                return true;
            };

            const collectQuickRows = async (batchCandidates, payloadBuilder, stageLabel) => {
                if (batchCandidates.length === 0) {
                    return;
                }

                try {
                    await runMultiSimulationPayloadWithDedicatedWorker(
                        payloadBuilder(),
                        (data) => {
                            if (!isActiveAdvisorRun()) {
                                return;
                            }

                            const completedUnits = clamp(Number(data?.progress || 0), 0, 1) * batchCandidates.length;
                            const partialUnits = Math.max(0, completedUnits - quickCompleted);
                            updateAdvisorRuntime("quick_scan", partialUnits, 0);
                        },
                        {
                            scope: DEDICATED_WORKER_SCOPE_ADVISOR,
                            onItemResult: (data) => {
                                ensureActiveAdvisorRun();
                                const candidate = batchCandidates[Number(data?.index)];
                                if (!candidate) {
                                    return;
                                }
                                storeQuickResult(candidate, data?.simResult);
                            },
                        }
                    );
                } catch (batchError) {
                    if (isWorkerRunCancelledError(batchError)) {
                        throw batchError;
                    }

                    const failedCandidates = [];
                    for (const candidate of batchCandidates) {
                        if (quickRowsById.has(candidate.id)) {
                            continue;
                        }

                        try {
                            const simResult = await runSingleSimulationPayloadWithDedicatedWorker(
                                createAdvisorSimulationPayload(candidate, playersToSim, simulationTimeLimit, extra),
                                (data) => {
                                    if (!isActiveAdvisorRun()) {
                                        return;
                                    }

                                    updateAdvisorRuntime("quick_scan", clamp(Number(data?.progress || 0), 0, 1), 0);
                                },
                                { scope: DEDICATED_WORKER_SCOPE_ADVISOR }
                            );
                            ensureActiveAdvisorRun();
                            storeQuickResult(candidate, simResult);
                        } catch (error) {
                            if (isWorkerRunCancelledError(error)) {
                                throw error;
                            }
                            failedCandidates.push(candidate);
                        } finally {
                            if (!quickRowsById.has(candidate.id)) {
                                quickCompleted += 1;
                                updateAdvisorRuntime("quick_scan", 0, 0);
                            }
                        }
                    }
                    const partialError = buildAdvisorPartialErrorText(stageLabel, failedCandidates);
                    if (partialError) {
                        errorMessages.push(partialError);
                    }
                }
            };

            try {
                updateAdvisorRuntime("quick_scan", 0, 0);
                await collectQuickRows(
                    candidates,
                    () => ({
                        type: "start_simulation_all_zones",
                        players: playersToSim,
                        zones: candidates.map((candidate) => ({
                            zoneHrid: candidate.targetHrid,
                            difficultyTier: candidate.difficultyTier,
                        })),
                        simulationTimeLimit,
                        extra,
                    }),
                    "quick scan"
                );

                if (quickRowsById.size === 0) {
                    throw new Error(errorMessages[0] || "Advisor scan did not produce any successful result.");
                }

                ensureActiveAdvisorRun();
                rerankLiveQuickRows();

                if (normalizedFilters.refineTopEnabled && refineTopCount > 0) {
                    updateAdvisorRuntime("refine_top", 0, 0);
                    const quickRowsForRefine = this.advisor.quickRows.slice(0, refineTopCount);
                    const roundMetricsById = new Map(quickRowsForRefine.map((row) => [row.id, []]));
                    const refineParallelWorkerLimit = Math.max(
                        1,
                        Math.min(
                            normalizeParallelWorkerLimit(this.queueRuntime?.parallelWorkerLimit, this.queueParallelWorkerHardMax),
                            quickRowsForRefine.length
                        )
                    );

                    const runRefineRoundForRow = async (row) => {
                        try {
                            const simResult = await runSingleSimulationPayloadWithDedicatedWorker(
                                createAdvisorSimulationPayload(row, playersToSim, simulationTimeLimit, extra),
                                () => {},
                                { scope: DEDICATED_WORKER_SCOPE_ADVISOR }
                            );
                            ensureActiveAdvisorRun();
                            const roundMetrics = roundMetricsById.get(row.id) || [];
                            roundMetrics.push(summarizeAdvisorTargetResult(simResult, selectedPlayersSnapshot, metricPlayer.id, pricingOptions));
                            roundMetricsById.set(row.id, roundMetrics);
                            if (roundMetrics.length >= normalizedFilters.refineRounds) {
                                refinedRowsById.set(row.id, buildAdvisorRowFromRoundMetrics(row, roundMetrics, {
                                    isRefined: true,
                                    refineRounds: normalizedFilters.refineRounds,
                                }));
                                rerankLiveRefinedRows();
                            }
                        } catch (error) {
                            if (isWorkerRunCancelledError(error)) {
                                throw error;
                            }
                            // keep best-effort quick result if refinement partially fails
                        } finally {
                            refineCompleted += 1;
                            updateAdvisorRuntime("refine_top", 0, 0);
                        }
                    };

                    for (let roundIndex = 0; roundIndex < normalizedFilters.refineRounds; roundIndex += 1) {
                        if (refineParallelWorkerLimit > 1 && quickRowsForRefine.length > 1) {
                            let nextRowIndex = 0;
                            const workerLoop = async () => {
                                while (nextRowIndex < quickRowsForRefine.length) {
                                    const currentRowIndex = nextRowIndex;
                                    nextRowIndex += 1;
                                    const row = quickRowsForRefine[currentRowIndex];
                                    // eslint-disable-next-line no-await-in-loop
                                    await runRefineRoundForRow(row);
                                }
                            };
                            await Promise.all(Array.from({ length: refineParallelWorkerLimit }, () => workerLoop()));
                            continue;
                        }

                        for (const row of quickRowsForRefine) {
                            // eslint-disable-next-line no-await-in-loop
                            await runRefineRoundForRow(row);
                        }
                    }

                    const refinedFailures = quickRowsForRefine.filter((row) => !refinedRowsById.has(row.id));
                    const refinePartialError = buildAdvisorPartialErrorText("refine step", refinedFailures);
                    if (refinePartialError) {
                        errorMessages.push(refinePartialError);
                    }

                    ensureActiveAdvisorRun();
                    rerankLiveRefinedRows();
                }

                ensureActiveAdvisorRun();
                this.advisor.error = errorMessages.join(" ").trim();
                this.advisor.runtime.isRunning = false;
                this.advisor.runtime.phase = "done";
                this.advisor.runtime.progress = 1;
                this.advisor.runtime.elapsedSeconds = (Date.now() - startedAt) / 1000;
                this.advisor.runtime.lastRunAt = Date.now();
                this.advisor.runtime.cancelRequested = false;
                this.advisor.runtime.quickCompleted = quickCompleted;
                this.advisor.runtime.quickTotal = candidates.length;
                this.advisor.runtime.refineCompleted = refineCompleted;
                this.advisor.runtime.refineTotal = refineTotal;
                return getAdvisorRowsForReturn();
            } catch (error) {
                if (!isCurrentAdvisorRun()) {
                    return [];
                }

                if (isWorkerRunCancelledError(error) || this.advisor.runtime?.cancelRequested === true) {
                    this.advisor.error = "";
                    this.advisor.runtime.isRunning = false;
                    this.advisor.runtime.phase = "cancelled";
                    this.advisor.runtime.elapsedSeconds = (Date.now() - startedAt) / 1000;
                    this.advisor.runtime.quickCompleted = quickCompleted;
                    this.advisor.runtime.quickTotal = candidates.length;
                    this.advisor.runtime.refineCompleted = refineCompleted;
                    this.advisor.runtime.refineTotal = refineTotal;
                    return getAdvisorRowsForReturn();
                }

                this.advisor.error = typeof error === "string"
                    ? error
                    : (error?.message || JSON.stringify(error));
                this.advisor.runtime.isRunning = false;
                this.advisor.runtime.phase = "idle";
                this.advisor.runtime.progress = 0;
                this.advisor.runtime.elapsedSeconds = (Date.now() - startedAt) / 1000;
                this.advisor.runtime.cancelRequested = false;
                return [];
            }
        },
        stopAdvisorScan() {
            if (!this.advisor.runtime?.isRunning) {
                return false;
            }

            this.advisor.error = "";
            this.advisor.runtime.cancelRequested = true;
            this.advisor.runtime.isRunning = false;
            this.advisor.runtime.phase = "cancelled";
            this.advisor.runtime.elapsedSeconds = this.advisor.runtime.startedAt > 0
                ? (Date.now() - this.advisor.runtime.startedAt) / 1000
                : 0;
            stopAdvisorWorkerRuns();
            return true;
        },
        applyAdvisorTarget(row) {
            const targetType = String(row?.targetType || "zone");
            if (targetType !== "zone") {
                return false;
            }

            this.simulationSettings.mode = "zone";
            this.simulationSettings.runScope = RUN_SCOPE_SINGLE;
            this.simulationSettings.useDungeon = false;
            this.simulationSettings.zoneHrid = String(row?.targetHrid || this.simulationSettings.zoneHrid || "");
            this.simulationSettings.difficultyTier = Math.max(0, Math.floor(toFiniteNumber(row?.difficultyTier, this.simulationSettings.difficultyTier || 0)));
            this.normalizeDifficulty();
            return true;
        },
        stopSimulation() {
            const queueRunInProgress = this.isAnyQueueRunning;
            const advisorRunInProgress = Boolean(this.advisor.runtime?.isRunning);
            const manualRunInProgress = Boolean(this.runtime.isRunning && !queueRunInProgress && !advisorRunInProgress);

            for (const queueState of Object.values(this.queue.byPlayer)) {
                if (queueState?.isRunning) {
                    queueState.cancelRequested = true;
                }
            }
            cancelSharedWorkerRun();
            workerClient.stopSimulation();
            stopQueueWorkerClients();
            if (manualRunInProgress) {
                this.runtime.isRunning = false;
                this.runtime.progress = 0;
                this.runtime.startedAt = 0;
                this.runtime.elapsedSeconds = 0;
                this.runtime.workerMode = "single";
            }
            if (advisorRunInProgress) {
                this.stopAdvisorScan();
            }
        },
        async startSimulation() {
            this.runtime.error = "";
            this.normalizeRunScope();

            if (this.isAnyQueueRunning) {
                this.runtime.error = "Queue run is in progress. Stop queue run before starting a manual simulation.";
                return;
            }

            if (this.advisor.runtime?.isRunning) {
                this.runtime.error = "Advisor scan is in progress. Stop the advisor scan before starting a manual simulation.";
                return;
            }

            const selectedPlayersSnapshot = this.selectedPlayers.map((player) => ({ id: player.id, name: player.name }));

            if (selectedPlayersSnapshot.length === 0) {
                this.runtime.error = "Please select at least one player.";
                return;
            }

            const { buildPlayersForSimulation } = await loadPlayerMapperModule();
            const playersToSim = buildPlayersForSimulation(this.players);
            if (playersToSim.length === 0) {
                this.runtime.error = "Unable to build player simulation data.";
                return;
            }

            this.normalizeDifficulty();

            const simulationTimeHours = Math.max(1, Number(this.simulationSettings.simulationTimeHours || 24));
            const simulationTimeLimit = simulationTimeHours * ONE_HOUR;
            const extra = buildSimulationExtra(this.simulationSettings);
            const runScope = this.simulationSettings.runScope;
            const pricingOptions = createProfitPricingOptions(this.pricing);
            const startedAt = Date.now();

            this.runtime.isRunning = true;
            this.runtime.progress = 0;
            this.runtime.startedAt = startedAt;
            this.runtime.elapsedSeconds = 0;
            this.runtime.workerMode = runScope === RUN_SCOPE_SINGLE ? "single" : "multi";
            this.resetResultsForRun();

            const onProgress = (data) => {
                this.runtime.progress = clamp(Number(data.progress || 0), 0, 1);
                this.runtime.elapsedSeconds = (Date.now() - startedAt) / 1000;
                if (data.timeSeriesData) {
                    this.results.timeSeriesData = data.timeSeriesData;
                }
            };

            const onError = (error) => {
                this.runtime.isRunning = false;
                this.runtime.error = typeof error === "string" ? error : JSON.stringify(error);
            };

            if (runScope === RUN_SCOPE_SINGLE) {
                let zone = null;
                let labyrinth = null;

                if (this.simulationSettings.mode === "labyrinth") {
                    labyrinth = {
                        labyrinthHrid: this.simulationSettings.labyrinthHrid,
                        roomLevel: Math.max(20, Number(this.simulationSettings.roomLevel || 100)),
                        crates: this.getActiveLabyrinthCrates(),
                    };
                } else {
                    const zoneHrid = this.simulationSettings.useDungeon
                        ? this.simulationSettings.dungeonHrid
                        : this.simulationSettings.zoneHrid;

                    zone = {
                        zoneHrid,
                        difficultyTier: Number(this.simulationSettings.difficultyTier || 0),
                    };
                }

                workerClient.startSimulation(
                    {
                        type: "start_simulation",
                        workerId: Math.floor(Math.random() * 1e9).toString(),
                        players: playersToSim,
                        zone,
                        labyrinth,
                        simulationTimeLimit,
                        extra,
                    },
                    {
                        onProgress,
                        onResult: (simResult) => {
                            this.runtime.progress = 1;
                            this.runtime.isRunning = false;
                            this.runtime.elapsedSeconds = (Date.now() - startedAt) / 1000;
                            this.results.simResult = simResult;
                            this.results.timeSeriesData = simResult?.timeSeriesData ?? this.results.timeSeriesData;
                            this.results.summaryRows = summarizeResult(simResult, selectedPlayersSnapshot, pricingOptions);
                            this.syncActiveResultPlayerToActivePlayer(this.activePlayerId);
                            this.runtime.completionNoticeId += 1;
                        },
                        onError,
                    }
                );

                return;
            }

            if (runScope === RUN_SCOPE_ALL_LABYRINTHS) {
                const labyrinths = buildAllLabyrinthTargets(this.getActiveLabyrinthCrates());
                if (labyrinths.length === 0) {
                    this.runtime.isRunning = false;
                    this.runtime.error = "No labyrinth targets available.";
                    return;
                }

                workerClient.startMultiSimulation(
                    {
                        type: "start_simulation_all_labyrinths",
                        players: playersToSim,
                        labyrinths,
                        simulationTimeLimit,
                        extra,
                    },
                    {
                        onProgress,
                        onBatchResult: (simResults, batchResultType) => {
                            this.runtime.progress = 1;
                            this.runtime.isRunning = false;
                            this.runtime.elapsedSeconds = (Date.now() - startedAt) / 1000;
                            this.results.simResults = simResults;
                            this.results.batchRows = summarizeBatchResults(simResults, selectedPlayersSnapshot, pricingOptions);
                            this.results.batchResultType = batchResultType || "simulation_result_allLabyrinths";
                            this.runtime.completionNoticeId += 1;
                        },
                        onError,
                    }
                );

                return;
            }

            const selectedZoneHrids = runScope === RUN_SCOPE_ALL_GROUP_ZONES
                ? this.simulationSettings.selectedGroupZoneHrids
                : this.simulationSettings.selectedSoloZoneHrids;
            const zones = buildZoneTargetsByScope(runScope, selectedZoneHrids);
            if (zones.length === 0) {
                this.runtime.isRunning = false;
                this.runtime.error = "No zone targets available for current run scope.";
                return;
            }

            workerClient.startMultiSimulation(
                {
                    type: "start_simulation_all_zones",
                    players: playersToSim,
                    zones,
                    simulationTimeLimit,
                    extra,
                },
                {
                    onProgress,
                    onBatchResult: (simResults, batchResultType) => {
                        this.runtime.progress = 1;
                        this.runtime.isRunning = false;
                        this.runtime.elapsedSeconds = (Date.now() - startedAt) / 1000;
                        this.results.simResults = simResults;
                        this.results.batchRows = summarizeBatchResults(simResults, selectedPlayersSnapshot, pricingOptions);
                        this.results.batchResultType = batchResultType || "simulation_result_allZones";
                        this.runtime.completionNoticeId += 1;
                    },
                    onError,
                }
            );
        },
    },
});

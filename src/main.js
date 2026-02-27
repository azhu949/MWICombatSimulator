import Equipment from "./combatsimulator/equipment.js";
import Player from "./combatsimulator/player.js";
import abilityDetailMap from "./combatsimulator/data/abilityDetailMap.json";
import itemDetailMap from "./combatsimulator/data/itemDetailMap.json";
import houseRoomDetailMap from "./combatsimulator/data/houseRoomDetailMap.json";
import Ability from "./combatsimulator/ability.js";
import Consumable from "./combatsimulator/consumable.js";
import HouseRoom from "./combatsimulator/houseRoom"
import combatTriggerDependencyDetailMap from "./combatsimulator/data/combatTriggerDependencyDetailMap.json";
import combatTriggerConditionDetailMap from "./combatsimulator/data/combatTriggerConditionDetailMap.json";
import combatTriggerComparatorDetailMap from "./combatsimulator/data/combatTriggerComparatorDetailMap.json";
import abilitySlotsLevelRequirementList from "./combatsimulator/data/abilitySlotsLevelRequirementList.json";
import actionDetailMap from "./combatsimulator/data/actionDetailMap.json";
import combatMonsterDetailMap from "./combatsimulator/data/combatMonsterDetailMap.json";
import damageTypeDetailMap from "./combatsimulator/data/damageTypeDetailMap.json";
import combatStyleDetailMap from "./combatsimulator/data/combatStyleDetailMap.json";
import openableLootDropMap from "./combatsimulator/data/openableLootDropMap.json";
import achievementTierMap from "./combatsimulator/data/achievementTierDetailMap.json"
import achievementDetailMap from "./combatsimulator/data/achievementDetailMap.json"

import patchNote from "../patchNote.json";
import api from "./app/runtime/api.js";
import { bindStateBindings } from "./app/runtime/state.js";
import { bindConstants } from "./app/runtime/constants.js";
import { registerWorkerModule } from "./app/features/worker.js";
import { registerEquipmentModule } from "./app/features/equipment.js";
import { registerCombatStatsModule } from "./app/features/combatStats.js";
import { registerLevelModule } from "./app/features/level.js";
import { registerFoodModule } from "./app/features/food.js";
import { registerDrinksModule } from "./app/features/drinks.js";
import { registerAbilitiesModule } from "./app/features/abilities.js";
import { registerTriggerModule } from "./app/features/trigger.js";
import { registerZonesModule } from "./app/features/zones.js";
import { registerSimulationResultModule } from "./app/features/simulationResult.js";
import { registerChartsModule } from "./app/features/charts.js";
import { registerSimulationControlsModule } from "./app/features/simulationControls.js";
import { registerWipeEventsModule } from "./app/features/wipeEvents.js";
import { registerEquipmentSetsModule } from "./app/features/equipmentSets.js";
import { registerImportExportSettingsModule } from "./app/features/importExportSettings.js";
import { registerBaselineQueueModule } from "./app/features/baselineQueue.js";

registerWorkerModule(api);
registerEquipmentModule(api);
registerCombatStatsModule(api);
registerLevelModule(api);
registerFoodModule(api);
registerDrinksModule(api);
registerAbilitiesModule(api);
registerTriggerModule(api);
registerZonesModule(api);
registerSimulationResultModule(api);
registerChartsModule(api);
registerSimulationControlsModule(api);
registerWipeEventsModule(api);
registerEquipmentSetsModule(api);
registerImportExportSettingsModule(api);
registerBaselineQueueModule(api);

const ONE_SECOND = 1e9;
const ONE_HOUR = 60 * 60 * ONE_SECOND;

let buttonStartSimulation = document.getElementById("buttonStartSimulation");
let buttonStopSimulation = document.getElementById("buttonStopSimulation");
let progressbar = document.getElementById("simulationProgressBar");
let simStartTime = 0;

let worker = new Worker(new URL("worker.js", import.meta.url));
let multiWorker = new Worker(new URL("multiWorker.js", import.meta.url));
let workerPool = [];

let player = new Player();
let selectedPlayers = [];
let food = [null, null, null];
let drinks = [null, null, null];
let abilities = [null, null, null, null];
let triggerMap = {};
let modalTriggers = [];
let currentSimResults = {};

let currentPlayerTabId = '1';
let playerDataMap = {
    "1": "{\"player\":{\"attackLevel\":1,\"magicLevel\":1,\"meleeLevel\":1,\"rangedLevel\":1,\"defenseLevel\":1,\"staminaLevel\":1,\"intelligenceLevel\":1,\"equipment\":[]},\"food\":{\"/action_types/combat\":[{\"itemHrid\":\"\"},{\"itemHrid\":\"\"},{\"itemHrid\":\"\"}]},\"drinks\":{\"/action_types/combat\":[{\"itemHrid\":\"\"},{\"itemHrid\":\"\"},{\"itemHrid\":\"\"}]},\"abilities\":[{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"}],\"triggerMap\":{},\"zone\":\"/actions/combat/fly\",\"simulationTime\":\"24\",\"houseRooms\":{\"/house_rooms/dairy_barn\":0,\"/house_rooms/garden\":0,\"/house_rooms/log_shed\":0,\"/house_rooms/forge\":0,\"/house_rooms/workshop\":0,\"/house_rooms/sewing_parlor\":0,\"/house_rooms/kitchen\":0,\"/house_rooms/brewery\":0,\"/house_rooms/laboratory\":0,\"/house_rooms/dining_room\":0,\"/house_rooms/library\":0,\"/house_rooms/dojo\":0,\"/house_rooms/gym\":0,\"/house_rooms/armory\":0,\"/house_rooms/archery_range\":0,\"/house_rooms/mystical_study\":0,\"/house_rooms/observatory\":0},\"achievements\":{}}",
    "2": "{\"player\":{\"attackLevel\":1,\"magicLevel\":1,\"meleeLevel\":1,\"rangedLevel\":1,\"defenseLevel\":1,\"staminaLevel\":1,\"intelligenceLevel\":1,\"equipment\":[]},\"food\":{\"/action_types/combat\":[{\"itemHrid\":\"\"},{\"itemHrid\":\"\"},{\"itemHrid\":\"\"}]},\"drinks\":{\"/action_types/combat\":[{\"itemHrid\":\"\"},{\"itemHrid\":\"\"},{\"itemHrid\":\"\"}]},\"abilities\":[{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"}],\"triggerMap\":{},\"zone\":\"/actions/combat/fly\",\"simulationTime\":\"24\",\"houseRooms\":{\"/house_rooms/dairy_barn\":0,\"/house_rooms/garden\":0,\"/house_rooms/log_shed\":0,\"/house_rooms/forge\":0,\"/house_rooms/workshop\":0,\"/house_rooms/sewing_parlor\":0,\"/house_rooms/kitchen\":0,\"/house_rooms/brewery\":0,\"/house_rooms/laboratory\":0,\"/house_rooms/dining_room\":0,\"/house_rooms/library\":0,\"/house_rooms/dojo\":0,\"/house_rooms/gym\":0,\"/house_rooms/armory\":0,\"/house_rooms/archery_range\":0,\"/house_rooms/mystical_study\":0,\"/house_rooms/observatory\":0},\"achievements\":{}}",
    "3": "{\"player\":{\"attackLevel\":1,\"magicLevel\":1,\"meleeLevel\":1,\"rangedLevel\":1,\"defenseLevel\":1,\"staminaLevel\":1,\"intelligenceLevel\":1,\"equipment\":[]},\"food\":{\"/action_types/combat\":[{\"itemHrid\":\"\"},{\"itemHrid\":\"\"},{\"itemHrid\":\"\"}]},\"drinks\":{\"/action_types/combat\":[{\"itemHrid\":\"\"},{\"itemHrid\":\"\"},{\"itemHrid\":\"\"}]},\"abilities\":[{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"}],\"triggerMap\":{},\"zone\":\"/actions/combat/fly\",\"simulationTime\":\"24\",\"houseRooms\":{\"/house_rooms/dairy_barn\":0,\"/house_rooms/garden\":0,\"/house_rooms/log_shed\":0,\"/house_rooms/forge\":0,\"/house_rooms/workshop\":0,\"/house_rooms/sewing_parlor\":0,\"/house_rooms/kitchen\":0,\"/house_rooms/brewery\":0,\"/house_rooms/laboratory\":0,\"/house_rooms/dining_room\":0,\"/house_rooms/library\":0,\"/house_rooms/dojo\":0,\"/house_rooms/gym\":0,\"/house_rooms/armory\":0,\"/house_rooms/archery_range\":0,\"/house_rooms/mystical_study\":0,\"/house_rooms/observatory\":0},\"achievements\":{}}",
    "4": "{\"player\":{\"attackLevel\":1,\"magicLevel\":1,\"meleeLevel\":1,\"rangedLevel\":1,\"defenseLevel\":1,\"staminaLevel\":1,\"intelligenceLevel\":1,\"equipment\":[]},\"food\":{\"/action_types/combat\":[{\"itemHrid\":\"\"},{\"itemHrid\":\"\"},{\"itemHrid\":\"\"}]},\"drinks\":{\"/action_types/combat\":[{\"itemHrid\":\"\"},{\"itemHrid\":\"\"},{\"itemHrid\":\"\"}]},\"abilities\":[{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"}],\"triggerMap\":{},\"zone\":\"/actions/combat/fly\",\"simulationTime\":\"24\",\"houseRooms\":{\"/house_rooms/dairy_barn\":0,\"/house_rooms/garden\":0,\"/house_rooms/log_shed\":0,\"/house_rooms/forge\":0,\"/house_rooms/workshop\":0,\"/house_rooms/sewing_parlor\":0,\"/house_rooms/kitchen\":0,\"/house_rooms/brewery\":0,\"/house_rooms/laboratory\":0,\"/house_rooms/dining_room\":0,\"/house_rooms/library\":0,\"/house_rooms/dojo\":0,\"/house_rooms/gym\":0,\"/house_rooms/armory\":0,\"/house_rooms/archery_range\":0,\"/house_rooms/mystical_study\":0,\"/house_rooms/observatory\":0},\"achievements\":{}}",
    "5": "{\"player\":{\"attackLevel\":1,\"magicLevel\":1,\"meleeLevel\":1,\"rangedLevel\":1,\"defenseLevel\":1,\"staminaLevel\":1,\"intelligenceLevel\":1,\"equipment\":[]},\"food\":{\"/action_types/combat\":[{\"itemHrid\":\"\"},{\"itemHrid\":\"\"},{\"itemHrid\":\"\"}]},\"drinks\":{\"/action_types/combat\":[{\"itemHrid\":\"\"},{\"itemHrid\":\"\"},{\"itemHrid\":\"\"}]},\"abilities\":[{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"}],\"triggerMap\":{},\"zone\":\"/actions/combat/fly\",\"simulationTime\":\"24\",\"houseRooms\":{\"/house_rooms/dairy_barn\":0,\"/house_rooms/garden\":0,\"/house_rooms/log_shed\":0,\"/house_rooms/forge\":0,\"/house_rooms/workshop\":0,\"/house_rooms/sewing_parlor\":0,\"/house_rooms/kitchen\":0,\"/house_rooms/brewery\":0,\"/house_rooms/laboratory\":0,\"/house_rooms/dining_room\":0,\"/house_rooms/library\":0,\"/house_rooms/dojo\":0,\"/house_rooms/gym\":0,\"/house_rooms/armory\":0,\"/house_rooms/archery_range\":0,\"/house_rooms/mystical_study\":0,\"/house_rooms/observatory\":0},\"achievements\":{}}"
};
window.revenue = 0;
window.noRngRevenue = 0;
window.expenses = 0;
window.profit = 0;
window.noRngProfit = 0;

const QUEUE_PLAYER_IDS = ["1", "2", "3", "4", "5"];
const PLAYER_HRID_LIST = ["player1", "player2", "player3", "player4", "player5"];
const LEVEL_KEYS = ["stamina", "intelligence", "attack", "melee", "defense", "ranged", "magic"];
const EQUIPMENT_SLOT_KEYS = ["head", "body", "legs", "feet", "hands", "off_hand", "pouch", "neck", "earrings", "ring", "back", "charm"];
const TRIGGER_CHANGE_LABEL_PREFIX = "Trigger ";
const JIGS_DATA_URL = "https://gist.githubusercontent.com/JigglyMoose/79db9d275a73a26dec30305865692525/raw/jigs_data.json";
const ABILITY_BOOK_CATEGORY_HRID = "/item_categories/ability_book";
const QUEUE_MULTI_ROUND_DEFAULT = 30;
const QUEUE_MULTI_ROUND_MIN = 1;
const QUEUE_MULTI_ROUND_MAX = 200;
const QUEUE_MULTI_ROUND_METRIC_KEYS = ["dps", "dailyNoRngProfit", "xpPerHour", "killsPerHour"];
const QUEUE_MULTI_ROUND_DEFAULT_PARALLEL_WORKERS = 4;
const QUEUE_MULTI_ROUND_WINSORIZE_PCT = 0.05;
const QUEUE_MULTI_ROUND_MEDIAN_BLEND_WEIGHT = 0.5;
const QUEUE_MULTI_ROUND_CONFIDENCE_SIZE_SCALE = 8;
const QUEUE_MULTI_ROUND_CONFIDENCE_PENALTY_STRENGTH = 0.35;
const QUEUE_MULTI_ROUND_SCORE_MIN = 5;
const QUEUE_MULTI_ROUND_SCORE_MAX = 95;
const QUEUE_MULTI_ROUND_SCORE_TIE = 50;
const QUEUE_MULTI_ROUND_SCORE_INVALID = 0;
const QUEUE_MULTI_ROUND_FINAL_WEIGHT_PERFORMANCE = 0.40;
const QUEUE_MULTI_ROUND_FINAL_WEIGHT_STABILITY = 0.20;
const QUEUE_MULTI_ROUND_FINAL_WEIGHT_COST = 0.40;
const QUEUE_SETTINGS_STORAGE_KEY = "mwi.queue.settings.v1";
const QUEUE_SETTINGS_STORAGE_VERSION = 1;
const PLAYER_DATA_SNAPSHOT_STORAGE_KEY = "mwi.player.data.snapshot.v1";
const PLAYER_DATA_SNAPSHOT_STORAGE_VERSION = 1;
const QUEUE_PARALLEL_WORKER_LIMIT_MIN = 1;
const QUEUE_PARALLEL_WORKER_LIMIT_MAX = 64;
const QUEUE_WEIGHT_SUM_EPSILON = 1e-6;
const SIMULATION_SETTING_DEFAULTS = Object.freeze({
    zone: "/actions/combat/fly",
    dungeon: "",
    difficulty: "0",
    simulationTime: "24",
    labyrinth: "",
    roomLevel: "100",
});
let abilityBookInfoByAbilityHrid = {};

const WATCHED_CONTROL_IDS = new Set([
    ...LEVEL_KEYS.map((key) => "inputLevel_" + key),
    ...EQUIPMENT_SLOT_KEYS.flatMap((key) => ["selectEquipment_" + key, "inputEquipmentEnhancementLevel_" + key]),
    "selectEquipment_weapon",
    "inputEquipmentEnhancementLevel_weapon",
    ...[0, 1, 2].flatMap((i) => ["selectFood_" + i, "selectDrink_" + i, "buttonFoodTrigger_" + i, "buttonDrinkTrigger_" + i]),
    ...[0, 1, 2, 3, 4].flatMap((i) => ["selectAbility_" + i, "inputAbilityLevel_" + i, "buttonAbilityTrigger_" + i]),
]);

let queueStateByPlayer = {};
let importedProfileByPlayer = Object.fromEntries(QUEUE_PLAYER_IDS.map((playerId) => [playerId, false]));
let activeLeftPage = "home";
let queueRuntimeSettings = {};
window.jigsAbilityXpLevels = [];
window.jigsSpellBookXpByName = {};

let LabyrinthSupplyItems = {
    TeaCrates: ["/items/basic_tea_crate", "/items/advanced_tea_crate", "/items/expert_tea_crate"],
    CoffeeCrates: ["/items/basic_coffee_crate", "/items/advanced_coffee_crate", "/items/expert_coffee_crate"],
    FoodCrates: ["/items/basic_food_crate", "/items/advanced_food_crate", "/items/expert_food_crate"]
};

let isLabyrinthSim = false;

let combatCharts = {
    hpChart: null,
    mpChart: null
};

let lastUpdateTime = 0;
const UPDATE_INTERVAL = 1000; // 每秒更新一次图表

// #region Baseline Queue

bindConstants({
    Equipment,
    Player,
    Ability,
    Consumable,
    HouseRoom,
    abilityDetailMap,
    itemDetailMap,
    houseRoomDetailMap,
    combatTriggerDependencyDetailMap,
    combatTriggerConditionDetailMap,
    combatTriggerComparatorDetailMap,
    abilitySlotsLevelRequirementList,
    actionDetailMap,
    combatMonsterDetailMap,
    damageTypeDetailMap,
    combatStyleDetailMap,
    openableLootDropMap,
    achievementTierMap,
    achievementDetailMap,
    patchNote,
    ONE_SECOND,
    ONE_HOUR,
    QUEUE_PLAYER_IDS,
    PLAYER_HRID_LIST,
    LEVEL_KEYS,
    EQUIPMENT_SLOT_KEYS,
    TRIGGER_CHANGE_LABEL_PREFIX,
    JIGS_DATA_URL,
    ABILITY_BOOK_CATEGORY_HRID,
    QUEUE_MULTI_ROUND_DEFAULT,
    QUEUE_MULTI_ROUND_MIN,
    QUEUE_MULTI_ROUND_MAX,
    QUEUE_MULTI_ROUND_METRIC_KEYS,
    QUEUE_MULTI_ROUND_DEFAULT_PARALLEL_WORKERS,
    QUEUE_MULTI_ROUND_WINSORIZE_PCT,
    QUEUE_MULTI_ROUND_MEDIAN_BLEND_WEIGHT,
    QUEUE_MULTI_ROUND_CONFIDENCE_SIZE_SCALE,
    QUEUE_MULTI_ROUND_CONFIDENCE_PENALTY_STRENGTH,
    QUEUE_MULTI_ROUND_SCORE_MIN,
    QUEUE_MULTI_ROUND_SCORE_MAX,
    QUEUE_MULTI_ROUND_SCORE_TIE,
    QUEUE_MULTI_ROUND_SCORE_INVALID,
    QUEUE_MULTI_ROUND_FINAL_WEIGHT_PERFORMANCE,
    QUEUE_MULTI_ROUND_FINAL_WEIGHT_STABILITY,
    QUEUE_MULTI_ROUND_FINAL_WEIGHT_COST,
    QUEUE_SETTINGS_STORAGE_KEY,
    QUEUE_SETTINGS_STORAGE_VERSION,
    PLAYER_DATA_SNAPSHOT_STORAGE_KEY,
    PLAYER_DATA_SNAPSHOT_STORAGE_VERSION,
    QUEUE_PARALLEL_WORKER_LIMIT_MIN,
    QUEUE_PARALLEL_WORKER_LIMIT_MAX,
    QUEUE_WEIGHT_SUM_EPSILON,
    SIMULATION_SETTING_DEFAULTS,
    WATCHED_CONTROL_IDS,
    UPDATE_INTERVAL,
});

bindStateBindings({
    buttonStartSimulation: { get: () => buttonStartSimulation, set: (value) => { buttonStartSimulation = value; } },
    buttonStopSimulation: { get: () => buttonStopSimulation, set: (value) => { buttonStopSimulation = value; } },
    progressbar: { get: () => progressbar, set: (value) => { progressbar = value; } },
    simStartTime: { get: () => simStartTime, set: (value) => { simStartTime = value; } },
    worker: { get: () => worker, set: (value) => { worker = value; } },
    multiWorker: { get: () => multiWorker, set: (value) => { multiWorker = value; } },
    workerPool: { get: () => workerPool, set: (value) => { workerPool = value; } },
    player: { get: () => player, set: (value) => { player = value; } },
    selectedPlayers: { get: () => selectedPlayers, set: (value) => { selectedPlayers = value; } },
    food: { get: () => food, set: (value) => { food = value; } },
    drinks: { get: () => drinks, set: (value) => { drinks = value; } },
    abilities: { get: () => abilities, set: (value) => { abilities = value; } },
    triggerMap: { get: () => triggerMap, set: (value) => { triggerMap = value; } },
    modalTriggers: { get: () => modalTriggers, set: (value) => { modalTriggers = value; } },
    currentSimResults: { get: () => currentSimResults, set: (value) => { currentSimResults = value; } },
    currentPlayerTabId: { get: () => currentPlayerTabId, set: (value) => { currentPlayerTabId = value; } },
    playerDataMap: { get: () => playerDataMap, set: (value) => { playerDataMap = value; } },
    abilityBookInfoByAbilityHrid: { get: () => abilityBookInfoByAbilityHrid, set: (value) => { abilityBookInfoByAbilityHrid = value; } },
    queueStateByPlayer: { get: () => queueStateByPlayer, set: (value) => { queueStateByPlayer = value; } },
    importedProfileByPlayer: { get: () => importedProfileByPlayer, set: (value) => { importedProfileByPlayer = value; } },
    activeLeftPage: { get: () => activeLeftPage, set: (value) => { activeLeftPage = value; } },
    queueRuntimeSettings: { get: () => queueRuntimeSettings, set: (value) => { queueRuntimeSettings = value; } },
    LabyrinthSupplyItems: { get: () => LabyrinthSupplyItems, set: (value) => { LabyrinthSupplyItems = value; } },
    isLabyrinthSim: { get: () => isLabyrinthSim, set: (value) => { isLabyrinthSim = value; } },
    combatCharts: { get: () => combatCharts, set: (value) => { combatCharts = value; } },
    lastUpdateTime: { get: () => lastUpdateTime, set: (value) => { lastUpdateTime = value; } },
});

abilityBookInfoByAbilityHrid = buildAbilityBookInfoByAbilityHrid();
queueStateByPlayer = createInitialQueueState();
queueRuntimeSettings = loadQueueSettingsFromStorageOrDefault();

bootstrapEquipmentDomBindings();
bootstrapSimulationResultDomBindings();
bootstrapSimulationControlsDomBindings();
bootstrapGlobalErrorUiBindings();

initEquipmentSection();
initHouseRoomsModal();
initAchievementsModal();
initLevelSection();
initFoodSection();
initDrinksSection();
initAbilitiesSection();
initZones();
initDungeons();
initLabyrinth();
initTriggerModal();
initSimulationControls();
initEquipmentSetsModal();
initErrorHandling();
initImportExportModal();
initDamageDoneTaken();
initPatchNotes();
initExtraBuffSection();
initHpMpVisualization();
initLeftMenuNavigation();
initBaselineQueueControls();
initSettingsPageControls();
playerDataMap = normalizePlayerDataMapSimulationSettings(playerDataMap);

updateState();
updateUI();
renderQueueViewsForCurrentPlayer();
fetchAbilityUpgradeReferenceData();
fetchPrices();

// #endregion

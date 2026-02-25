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
    "1": "{\"player\":{\"attackLevel\":1,\"magicLevel\":1,\"meleeLevel\":1,\"rangedLevel\":1,\"defenseLevel\":1,\"staminaLevel\":1,\"intelligenceLevel\":1,\"equipment\":[]},\"food\":{\"/action_types/combat\":[{\"itemHrid\":\"\"},{\"itemHrid\":\"\"},{\"itemHrid\":\"\"}]},\"drinks\":{\"/action_types/combat\":[{\"itemHrid\":\"\"},{\"itemHrid\":\"\"},{\"itemHrid\":\"\"}]},\"abilities\":[{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"}],\"triggerMap\":{},\"zone\":\"/actions/combat/fly\",\"simulationTime\":\"100\",\"houseRooms\":{\"/house_rooms/dairy_barn\":0,\"/house_rooms/garden\":0,\"/house_rooms/log_shed\":0,\"/house_rooms/forge\":0,\"/house_rooms/workshop\":0,\"/house_rooms/sewing_parlor\":0,\"/house_rooms/kitchen\":0,\"/house_rooms/brewery\":0,\"/house_rooms/laboratory\":0,\"/house_rooms/dining_room\":0,\"/house_rooms/library\":0,\"/house_rooms/dojo\":0,\"/house_rooms/gym\":0,\"/house_rooms/armory\":0,\"/house_rooms/archery_range\":0,\"/house_rooms/mystical_study\":0,\"/house_rooms/observatory\":0},\"achievements\":{}}",
    "2": "{\"player\":{\"attackLevel\":1,\"magicLevel\":1,\"meleeLevel\":1,\"rangedLevel\":1,\"defenseLevel\":1,\"staminaLevel\":1,\"intelligenceLevel\":1,\"equipment\":[]},\"food\":{\"/action_types/combat\":[{\"itemHrid\":\"\"},{\"itemHrid\":\"\"},{\"itemHrid\":\"\"}]},\"drinks\":{\"/action_types/combat\":[{\"itemHrid\":\"\"},{\"itemHrid\":\"\"},{\"itemHrid\":\"\"}]},\"abilities\":[{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"}],\"triggerMap\":{},\"zone\":\"/actions/combat/fly\",\"simulationTime\":\"100\",\"houseRooms\":{\"/house_rooms/dairy_barn\":0,\"/house_rooms/garden\":0,\"/house_rooms/log_shed\":0,\"/house_rooms/forge\":0,\"/house_rooms/workshop\":0,\"/house_rooms/sewing_parlor\":0,\"/house_rooms/kitchen\":0,\"/house_rooms/brewery\":0,\"/house_rooms/laboratory\":0,\"/house_rooms/dining_room\":0,\"/house_rooms/library\":0,\"/house_rooms/dojo\":0,\"/house_rooms/gym\":0,\"/house_rooms/armory\":0,\"/house_rooms/archery_range\":0,\"/house_rooms/mystical_study\":0,\"/house_rooms/observatory\":0},\"achievements\":{}}",
    "3": "{\"player\":{\"attackLevel\":1,\"magicLevel\":1,\"meleeLevel\":1,\"rangedLevel\":1,\"defenseLevel\":1,\"staminaLevel\":1,\"intelligenceLevel\":1,\"equipment\":[]},\"food\":{\"/action_types/combat\":[{\"itemHrid\":\"\"},{\"itemHrid\":\"\"},{\"itemHrid\":\"\"}]},\"drinks\":{\"/action_types/combat\":[{\"itemHrid\":\"\"},{\"itemHrid\":\"\"},{\"itemHrid\":\"\"}]},\"abilities\":[{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"}],\"triggerMap\":{},\"zone\":\"/actions/combat/fly\",\"simulationTime\":\"100\",\"houseRooms\":{\"/house_rooms/dairy_barn\":0,\"/house_rooms/garden\":0,\"/house_rooms/log_shed\":0,\"/house_rooms/forge\":0,\"/house_rooms/workshop\":0,\"/house_rooms/sewing_parlor\":0,\"/house_rooms/kitchen\":0,\"/house_rooms/brewery\":0,\"/house_rooms/laboratory\":0,\"/house_rooms/dining_room\":0,\"/house_rooms/library\":0,\"/house_rooms/dojo\":0,\"/house_rooms/gym\":0,\"/house_rooms/armory\":0,\"/house_rooms/archery_range\":0,\"/house_rooms/mystical_study\":0,\"/house_rooms/observatory\":0},\"achievements\":{}}",
    "4": "{\"player\":{\"attackLevel\":1,\"magicLevel\":1,\"meleeLevel\":1,\"rangedLevel\":1,\"defenseLevel\":1,\"staminaLevel\":1,\"intelligenceLevel\":1,\"equipment\":[]},\"food\":{\"/action_types/combat\":[{\"itemHrid\":\"\"},{\"itemHrid\":\"\"},{\"itemHrid\":\"\"}]},\"drinks\":{\"/action_types/combat\":[{\"itemHrid\":\"\"},{\"itemHrid\":\"\"},{\"itemHrid\":\"\"}]},\"abilities\":[{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"}],\"triggerMap\":{},\"zone\":\"/actions/combat/fly\",\"simulationTime\":\"100\",\"houseRooms\":{\"/house_rooms/dairy_barn\":0,\"/house_rooms/garden\":0,\"/house_rooms/log_shed\":0,\"/house_rooms/forge\":0,\"/house_rooms/workshop\":0,\"/house_rooms/sewing_parlor\":0,\"/house_rooms/kitchen\":0,\"/house_rooms/brewery\":0,\"/house_rooms/laboratory\":0,\"/house_rooms/dining_room\":0,\"/house_rooms/library\":0,\"/house_rooms/dojo\":0,\"/house_rooms/gym\":0,\"/house_rooms/armory\":0,\"/house_rooms/archery_range\":0,\"/house_rooms/mystical_study\":0,\"/house_rooms/observatory\":0},\"achievements\":{}}",
    "5": "{\"player\":{\"attackLevel\":1,\"magicLevel\":1,\"meleeLevel\":1,\"rangedLevel\":1,\"defenseLevel\":1,\"staminaLevel\":1,\"intelligenceLevel\":1,\"equipment\":[]},\"food\":{\"/action_types/combat\":[{\"itemHrid\":\"\"},{\"itemHrid\":\"\"},{\"itemHrid\":\"\"}]},\"drinks\":{\"/action_types/combat\":[{\"itemHrid\":\"\"},{\"itemHrid\":\"\"},{\"itemHrid\":\"\"}]},\"abilities\":[{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"},{\"abilityHrid\":\"\",\"level\":\"1\"}],\"triggerMap\":{},\"zone\":\"/actions/combat/fly\",\"simulationTime\":\"100\",\"houseRooms\":{\"/house_rooms/dairy_barn\":0,\"/house_rooms/garden\":0,\"/house_rooms/log_shed\":0,\"/house_rooms/forge\":0,\"/house_rooms/workshop\":0,\"/house_rooms/sewing_parlor\":0,\"/house_rooms/kitchen\":0,\"/house_rooms/brewery\":0,\"/house_rooms/laboratory\":0,\"/house_rooms/dining_room\":0,\"/house_rooms/library\":0,\"/house_rooms/dojo\":0,\"/house_rooms/gym\":0,\"/house_rooms/armory\":0,\"/house_rooms/archery_range\":0,\"/house_rooms/mystical_study\":0,\"/house_rooms/observatory\":0},\"achievements\":{}}"
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
const abilityBookInfoByAbilityHrid = buildAbilityBookInfoByAbilityHrid();

const WATCHED_CONTROL_IDS = new Set([
    ...LEVEL_KEYS.map((key) => "inputLevel_" + key),
    ...EQUIPMENT_SLOT_KEYS.flatMap((key) => ["selectEquipment_" + key, "inputEquipmentEnhancementLevel_" + key]),
    "selectEquipment_weapon",
    "inputEquipmentEnhancementLevel_weapon",
    ...[0, 1, 2].flatMap((i) => ["selectFood_" + i, "selectDrink_" + i, "buttonFoodTrigger_" + i, "buttonDrinkTrigger_" + i]),
    ...[0, 1, 2, 3, 4].flatMap((i) => ["selectAbility_" + i, "inputAbilityLevel_" + i, "buttonAbilityTrigger_" + i]),
]);

let queueStateByPlayer = createInitialQueueState();
let importedProfileByPlayer = Object.fromEntries(QUEUE_PLAYER_IDS.map((playerId) => [playerId, false]));
let activeLeftPage = "home";
window.jigsAbilityXpLevels = [];
window.jigsSpellBookXpByName = {};

// #region Worker

function onWorkerMessage(event) {
    switch (event.data.type) {
        case "simulation_result":
            progressbar.style.width = "100%";
            progressbar.innerHTML = "100% (" + ((Date.now() - simStartTime) / 1000).toFixed(2) + "s)";
            window.lastSimulationResult = event.data.simResult;
            console.log("[MWI_SIM_RESULT_OBJECT]", event.data.simResult);
            console.log("[MWI_SIM_RESULT_JSON]", JSON.stringify(event.data.simResult));
            showSimulationResult(event.data.simResult);
            updateContent();
            buttonStartSimulation.disabled = false;
            buttonStopSimulation.style.display = 'none';
            document.getElementById('buttonShowAllSimData').style.display = 'none';
            break;
        case "simulation_progress":
            let progress = Math.floor(100 * event.data.progress);
            progressbar.style.width = progress + "%";
            progressbar.innerHTML = progress + "% (" + ((Date.now() - simStartTime) / 1000).toFixed(2) + "s)";
            // 实时更新图表
            if (event.data.timeSeriesData && document.getElementById('hpMpVisualizationToggle').checked) {
                updateChartsRealtime(event.data.timeSeriesData);
            }
            break;
        case "simulation_error":
            showErrorModal(event.data.error.toString());
            break;
    }
};

function onMultiWorkerMessage(event) {
    switch (event.data.type) {
        case "simulation_result_allZones":
            progressbar.style.width = "100%";
            progressbar.innerHTML = "100% (" + ((Date.now() - simStartTime) / 1000).toFixed(2) + "s)";
            window.lastAllZonesSimulationResults = event.data.simResults;
            console.log("[MWI_SIM_ALL_ZONES_OBJECT]", event.data.simResults);
            console.log("[MWI_SIM_ALL_ZONES_JSON]", JSON.stringify(event.data.simResults));
            showAllSimulationResults(event.data.simResults);
            updateContent();
            buttonStartSimulation.disabled = false;
            buttonStopSimulation.style.display = 'none';
            document.getElementById('buttonShowAllSimData').style.display = 'block';
            break;
        case "simulation_progress":
            let progress = Math.floor(100 * event.data.progress);
            progressbar.style.width = progress + "%";
            progressbar.innerHTML = progress + "% (" + ((Date.now() - simStartTime) / 1000).toFixed(2) + "s)";
            break;
        case "simulation_error":
            showErrorModal(event.data.error.toString());
            break;
    }
};

// #endregion

// #region Equipment

function buildAbilityBookInfoByAbilityHrid() {
    let result = {};

    for (const item of Object.values(itemDetailMap)) {
        if (item?.categoryHrid !== ABILITY_BOOK_CATEGORY_HRID) {
            continue;
        }

        const abilityHrid = item?.abilityBookDetail?.abilityHrid ?? "";
        if (!abilityHrid) {
            continue;
        }

        const xpPerBook = Number(item?.abilityBookDetail?.experienceGain ?? 0);
        result[abilityHrid] = {
            itemHrid: item.hrid ?? "",
            itemName: item.name ?? "",
            xpPerBook: Number.isFinite(xpPerBook) && xpPerBook > 0 ? xpPerBook : 0,
        };
    }

    return result;
}

function initEquipmentSection() {
    ["head", "body", "legs", "feet", "hands", "main_hand", "two_hand", "off_hand", "pouch", "neck", "earrings", "ring", "back", "charm"].forEach((type) => {
        initEquipmentSelect(type);
        initEnhancementLevelInput(type);
    });
    initEquipmentEnhancementHintPlaceholders();
}

function initEquipmentSelect(equipmentType) {
    let selectId = "selectEquipment_";
    if (equipmentType == "main_hand" || equipmentType == "two_hand") {
        selectId += "weapon";
    } else {
        selectId += equipmentType;
    }
    let selectElement = document.getElementById(selectId);

    let gameEquipment = Object.values(itemDetailMap)
        .filter((item) => item.categoryHrid == "/item_categories/equipment")
        .filter((item) => item.equipmentDetail.type == "/equipment_types/" + equipmentType)
        .sort((a, b) => a.sortIndex - b.sortIndex);

    for (const equipment of Object.values(gameEquipment)) {
        let opt = new Option(equipment.name, equipment.hrid);
        opt.setAttribute("data-i18n", "itemNames." + equipment.hrid);
        selectElement.add(opt);
    }

    selectElement.addEventListener("change", (event) => {
        equipmentSelectHandler(event, equipmentType);
    });
}

function initHouseRoomsModal() {
    let houseRoomsList = document.getElementById("houseRoomsList");
    let newChildren = [];
    let houseRooms = Object.values(houseRoomDetailMap).sort((a, b) => a.sortIndex - b.sortIndex);
    player.houseRooms = {};

    for (const room of Object.values(houseRooms)) {
        player.houseRooms[room.hrid] = 0;

        let row = createElement("div", "row mb-2");

        let nameCol = createElement("div", "col-md-4 offset-md-3 align-self-center", room.name);
        nameCol.setAttribute("data-i18n", "houseRoomNames." + room.hrid);
        row.appendChild(nameCol);

        let levelCol = createElement("div", "col-md-2");
        let levelInput = createHouseInput(room.hrid);

        levelInput.addEventListener("input", function (e) {
            let inputValue = e.target.value;
            const hrid = e.target.dataset.houseHrid;
            player.houseRooms[hrid] = parseInt(inputValue);
        });

        levelCol.appendChild(levelInput);
        row.appendChild(levelCol);

        newChildren.push(row);
    }

    houseRoomsList.replaceChildren(...newChildren);
}

function createHouseInput(hrid) {
    let levelInput = document.createElement("input");
    levelInput.className = "form-control";
    levelInput.type = "number";
    levelInput.placeholder = 0;
    levelInput.min = 0;
    levelInput.max = 8;
    levelInput.step = 1;
    levelInput.dataset.houseHrid = hrid;

    return levelInput;
}

function refreshAchievementStatics() {
    let tierMap = Object.values(achievementTierMap).sort((a, b) => a.sortIndex - b.sortIndex);
    for(const tier of Object.values(tierMap)) {
        const checks = document.querySelectorAll(`input[data-achievement-hrid][data-tier="${tier.sortIndex}"]`);
        const done = Array.from(checks).filter(cb => cb.checked).length;
        const total = checks.length;

        const stat = document.getElementById(`AchTier${tier.sortIndex}Statics`);
        stat.innerText = `(${done}/${total})`;
        if (done == total) {
            // set to green
            stat.classList.remove("text-secondary");
            stat.classList.add("text-success");
        } else {
            // set to secondary
            stat.classList.remove("text-success");
            stat.classList.add("text-secondary");
        }
    }
}

function initAchievementsModal(){
    let achievementsList = document.getElementById("achievementsList");
    let newChildren = [];
    player.achievements = {};

    let tierMap = Object.values(achievementTierMap).sort((a, b) => a.sortIndex - b.sortIndex);
    for(const tier of Object.values(tierMap)) {
        let detailMap = Object.values(achievementDetailMap).filter((detail) => detail.tierHrid == tier.hrid).sort((a, b) => a.sortIndex - b.sortIndex);
        let detailMapCount = detailMap.length;
        if (detailMapCount <= 0) continue;

        let card = createElement("div", "card");
        let cardHeader = createElement("div", "card-header d-flex align-items-center");

        let cardTitle = createElement("a", "btn", tier.name);
        cardTitle.setAttribute("data-bs-toggle","collapse");
        cardTitle.setAttribute("href", `#AchTier${tier.sortIndex}`);
        cardTitle.setAttribute("data-i18n", "achievementTierNames."+tier.hrid);
        cardHeader.appendChild(cardTitle);

        let bufDesc = createElement("div", "small text-secondary");
        let buffName = createElement("i", "");
        buffName.setAttribute("data-i18n", "buffTypeNames."+tier["buff"].typeHrid);
        bufDesc.appendChild(buffName);
        let buffValue = createElement("i", "");
        buffValue.innerText = ":+" + parseFloat(tier["buff"].ratioBoost==0?tier["buff"].flatBoost:tier["buff"].ratioBoost)*100 + "%";
        bufDesc.appendChild(buffValue);
        cardHeader.appendChild(bufDesc);

        let cardStatics = createElement("div", "ms-auto btn", `(0/${detailMapCount})`);
        cardStatics.id = `AchTier${tier.sortIndex}Statics`;
        cardStatics.dataset.checked = "true";
        cardStatics.addEventListener("click", function (e) {
            const checks = document.querySelectorAll(`input[data-achievement-hrid][data-tier="${tier.sortIndex}"]`);
            for (const check of checks) {
                check.checked = cardStatics.dataset.checked == "true";
                const hrid = check.dataset.achievementHrid;
                player.achievements[hrid] = check.checked;
            }
            cardStatics.dataset.checked = cardStatics.dataset.checked == "true" ? "false" : "true";
            refreshAchievementStatics();
        });
        cardHeader.appendChild(cardStatics);

        card.appendChild(cardHeader);

        let cardMain = createElement("div", "collapse");
        cardMain.id = `AchTier${tier.sortIndex}`;
        let cardBody = createElement("div", "card-body");

        for (const detail of Object.values(detailMap)) {
            let row = createElement("div", "row mb-2");

            let formCheck = createElement("div", "form-check");
            let input = createElement("input", "form-check-input");
            input.setAttribute("type", "checkbox");
            input.setAttribute("data-tier", tier.sortIndex);
            input.id = `AchDetail${detail.sortIndex}`;
            input.dataset.achievementHrid = detail.hrid;
            input.addEventListener("change", function (e) {
                const hrid = e.target.dataset.achievementHrid;
                player.achievements[hrid] = e.target.checked;

                refreshAchievementStatics();
            });
            formCheck.appendChild(input);

            let name = createElement("label", "form-check-label", detail.name);
            name.setAttribute("data-i18n", "achievementNames." + detail.hrid);
            name.setAttribute("for", `AchDetail${detail.sortIndex}`);
            formCheck.appendChild(name);
            row.appendChild(formCheck);
            cardBody.appendChild(row);
        }
        cardMain.appendChild(cardBody);
        card.appendChild(cardMain);

        newChildren.push(card);
    }

    achievementsList.replaceChildren(...newChildren);
}

function initEnhancementLevelInput(equipmentType) {
    let inputId = "inputEquipmentEnhancementLevel_";
    if (equipmentType == "main_hand" || equipmentType == "two_hand") {
        inputId += "weapon";
    } else {
        inputId += equipmentType;
    }

    let inputElement = document.getElementById(inputId);
    inputElement.value = 0;
    inputElement.addEventListener("change", enhancementLevelInputHandler);
}

function equipmentSelectHandler(event, type) {
    let equipmentType = "/equipment_types/" + type;

    if (!event.target.value) {
        updateEquipmentState();
        updateUI();
        return;
    }

    let gameItem = itemDetailMap[event.target.value];

    // Weapon select has two handlers because of mainhand and twohand weapons. Ignore the handler with the wrong type
    if (gameItem.equipmentDetail.type != equipmentType) {
        return;
    }

    if (type == "two_hand") {
        document.getElementById("selectEquipment_off_hand").value = "";
        document.getElementById("inputEquipmentEnhancementLevel_off_hand").value = 0;
    }
    if (type == "off_hand" && player.equipment["/equipment_types/two_hand"]) {
        document.getElementById("selectEquipment_weapon").value = "";
        document.getElementById("inputEquipmentEnhancementLevel_weapon").value = 0;
    }

    updateEquipmentState();
    updateUI();
}

function enhancementLevelInputHandler() {
    updateEquipmentState();
    updateUI();
}

function initEquipmentEnhancementHintPlaceholders() {
    const selectTypes = ["head", "body", "legs", "feet", "hands", "weapon", "off_hand", "pouch", "neck", "earrings", "ring", "back", "charm"];
    for (const selectType of selectTypes) {
        const selectElement = document.getElementById("selectEquipment_" + selectType);
        const enhancementInput = getEnhancementInputElementBySelectType(selectType);
        if (!selectElement || !enhancementInput) {
            continue;
        }

        const legacyHint = document.getElementById("marketEnhancementHint_" + selectType);
        if (legacyHint) {
            legacyHint.remove();
        }

        const buttonHintId = "marketEnhancementButtons_" + selectType;
        if (!document.getElementById(buttonHintId)) {
            const buttonHintElement = document.createElement("div");
            buttonHintElement.id = buttonHintId;
            buttonHintElement.className = "mt-1";
            buttonHintElement.style.minHeight = "1.1rem";
            buttonHintElement.style.whiteSpace = "normal";
            buttonHintElement.style.overflowWrap = "anywhere";
            buttonHintElement.style.wordBreak = "break-word";
            buttonHintElement.style.lineHeight = "1.2";
            buttonHintElement.style.maxWidth = "100%";
            selectElement.parentElement.appendChild(buttonHintElement);
        }

        const costHintId = "marketEnhancementCost_" + selectType;
        if (!document.getElementById(costHintId)) {
            const costHintElement = document.createElement("div");
            costHintElement.id = costHintId;
            costHintElement.className = "mt-1";
            costHintElement.style.minHeight = "1.1rem";
            costHintElement.style.maxWidth = "100%";
            enhancementInput.parentElement.appendChild(costHintElement);
        }
    }
}

function initAbilityUpgradeCostPlaceholders() {
    for (let i = 0; i < 5; i++) {
        const abilityLevelInput = document.getElementById("inputAbilityLevel_" + i);
        const abilityRow = abilityLevelInput?.closest(".row");
        if (!abilityLevelInput) {
            continue;
        }

        const costHintId = "abilityUpgradeCost_" + i;
        if (!document.getElementById(costHintId)) {
            const costHintElement = document.createElement("div");
            costHintElement.id = costHintId;
            costHintElement.style.maxWidth = "100%";
            if (abilityRow) {
                abilityRow.insertAdjacentElement("afterend", costHintElement);
            } else {
                abilityLevelInput.parentElement.appendChild(costHintElement);
            }
        }
    }
}

function getMarketEnhancementLevelsForItem(itemHrid) {
    const levels = window.marketEnhancementLevelsByItem?.[itemHrid];
    if (!Array.isArray(levels)) {
        return [];
    }

    return levels
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => a - b);
}

function getEnhancementInputElementBySelectType(selectType) {
    return document.getElementById("inputEquipmentEnhancementLevel_" + selectType);
}

function getBaselineEquipmentForSelectType(selectType) {
    const baselineSnapshot = getCurrentPlayerQueueState()?.baseline?.snapshot;
    if (!baselineSnapshot?.equipment) {
        return null;
    }

    if (selectType === "weapon") {
        return baselineSnapshot.equipment.weapon ?? null;
    }

    return baselineSnapshot.equipment[selectType] ?? null;
}

function getBaselineSkillForAbilitySlot(slotIndex) {
    const baselineSnapshot = getCurrentPlayerQueueState()?.baseline?.snapshot;
    if (!Array.isArray(baselineSnapshot?.skills)) {
        return null;
    }

    return baselineSnapshot.skills[slotIndex] ?? null;
}

function getEnhancementUpgradeCostKey(selectType, itemHrid, fromLevel, toLevel) {
    return `${selectType}|${itemHrid}|${fromLevel}|${toLevel}`;
}

function getCurrentPlayerEnhancementCostMap() {
    const queueState = getCurrentPlayerQueueState();
    if (!queueState.enhancementUpgradeCosts || typeof queueState.enhancementUpgradeCosts !== "object") {
        queueState.enhancementUpgradeCosts = {};
    }
    return queueState.enhancementUpgradeCosts;
}

function getAbilityUpgradeCostKey(abilitySlot, abilityHrid, fromLevel, toLevel) {
    return `${abilitySlot}|${abilityHrid}|${fromLevel}|${toLevel}`;
}

function getCurrentPlayerAbilityCostMap() {
    const queueState = getCurrentPlayerQueueState();
    if (!queueState.abilityUpgradeCosts || typeof queueState.abilityUpgradeCosts !== "object") {
        queueState.abilityUpgradeCosts = {};
    }
    return queueState.abilityUpgradeCosts;
}

function resolveEnhancementLevelPrice(itemHrid, level, preferredMode = "ask") {
    const quoteMap = window.marketEnhancementQuotesByItem?.[itemHrid];
    if (!quoteMap || typeof quoteMap !== "object") {
        return -1;
    }

    const tryLevelPrice = (targetLevel) => {
        const quote = quoteMap[String(targetLevel)];
        if (!quote) {
            return -1;
        }

        const ask = toFiniteNumber(quote.ask, -1);
        const bid = toFiniteNumber(quote.bid, -1);
        if (preferredMode === "bid") {
            return bid !== -1 ? bid : ask;
        }
        return ask !== -1 ? ask : bid;
    };

    const directPrice = tryLevelPrice(level);
    if (directPrice !== -1) {
        return directPrice;
    }

    const levelCandidates = Object.keys(quoteMap)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => Math.abs(a - level) - Math.abs(b - level) || a - b);

    for (const candidateLevel of levelCandidates) {
        const candidatePrice = tryLevelPrice(candidateLevel);
        if (candidatePrice !== -1) {
            return candidatePrice;
        }
    }

    return -1;
}

function computeDefaultEnhancementUpgradeCost(itemHrid, fromLevel, toLevel) {
    if (!itemHrid || !Number.isFinite(fromLevel) || !Number.isFinite(toLevel) || toLevel <= fromLevel) {
        return 0;
    }

    const fromPrice = resolveEnhancementLevelPrice(itemHrid, fromLevel, "bid");
    const toPrice = resolveEnhancementLevelPrice(itemHrid, toLevel, "ask");
    if (fromPrice === -1 || toPrice === -1) {
        return 0;
    }

    const upgradeCost = toPrice - fromPrice;
    return upgradeCost > 0 ? upgradeCost : 0;
}

function getAbilityXpForLevel(level) {
    const abilityXpLevels = window.jigsAbilityXpLevels;
    if (!Array.isArray(abilityXpLevels)) {
        return null;
    }

    const normalizedLevel = Number(level);
    if (!Number.isFinite(normalizedLevel) || normalizedLevel < 0 || normalizedLevel >= abilityXpLevels.length) {
        return null;
    }

    const xpValue = Number(abilityXpLevels[normalizedLevel]);
    return Number.isFinite(xpValue) ? xpValue : null;
}

function getSpellBookXpForAbility(abilityHrid) {
    const bookInfo = abilityBookInfoByAbilityHrid[abilityHrid];
    if (bookInfo?.xpPerBook > 0) {
        return bookInfo.xpPerBook;
    }

    const abilityName = abilityDetailMap[abilityHrid]?.name ?? "";
    if (!abilityName) {
        return 0;
    }

    const spellBookXpMap = window.jigsSpellBookXpByName;
    if (!spellBookXpMap || typeof spellBookXpMap !== "object") {
        return 0;
    }

    const matchedKey = Object.keys(spellBookXpMap).find((key) => key.toLowerCase() === abilityName.toLowerCase());
    const xpPerBook = matchedKey ? Number(spellBookXpMap[matchedKey]) : 0;
    return Number.isFinite(xpPerBook) && xpPerBook > 0 ? xpPerBook : 0;
}

function computeDefaultAbilityUpgradeCost(baseSkill, toLevel) {
    const abilityHrid = baseSkill?.abilityHrid ?? "";
    const fromLevel = Number(baseSkill?.level ?? 1);
    if (!abilityHrid || !Number.isFinite(fromLevel) || !Number.isFinite(toLevel) || toLevel <= fromLevel) {
        return 0;
    }

    const startXp = getAbilityXpForLevel(fromLevel);
    const endXp = getAbilityXpForLevel(toLevel);
    if (startXp == null || endXp == null) {
        return null;
    }

    const xpNeeded = endXp - startXp;
    if (xpNeeded <= 0) {
        return 0;
    }

    const xpPerBook = getSpellBookXpForAbility(abilityHrid);
    if (!xpPerBook) {
        return null;
    }

    const booksNeeded = Math.ceil(xpNeeded / xpPerBook);
    if (!Number.isFinite(booksNeeded) || booksNeeded <= 0) {
        return 0;
    }

    const bookItemHrid = abilityBookInfoByAbilityHrid[abilityHrid]?.itemHrid ?? "";
    if (!bookItemHrid) {
        return null;
    }

    const pricePerBook = resolveMarketplacePrice(bookItemHrid, "selectPrices_drops");
    if (pricePerBook === -1) {
        return null;
    }

    const totalCost = booksNeeded * pricePerBook;
    return totalCost > 0 ? totalCost : 0;
}

function applyEquipmentEnhancementFromMarket(selectType, enhancementLevel) {
    const enhancementInput = getEnhancementInputElementBySelectType(selectType);
    if (!enhancementInput) {
        return;
    }

    enhancementInput.value = String(enhancementLevel);
    updateEquipmentState();
    updateUI();
}

function refreshEquipmentEnhancementHints() {
    const selectTypes = ["head", "body", "legs", "feet", "hands", "weapon", "off_hand", "pouch", "neck", "earrings", "ring", "back", "charm"];
    for (const selectType of selectTypes) {
        const selectElement = document.getElementById("selectEquipment_" + selectType);
        const buttonHintElement = document.getElementById("marketEnhancementButtons_" + selectType);
        const costHintElement = document.getElementById("marketEnhancementCost_" + selectType);
        const enhancementInput = getEnhancementInputElementBySelectType(selectType);
        if (!selectElement || !buttonHintElement || !costHintElement || !enhancementInput) {
            continue;
        }

        buttonHintElement.replaceChildren();
        costHintElement.replaceChildren();

        const itemHrid = selectElement.value;
        if (!itemHrid) {
            continue;
        }

        const levels = getMarketEnhancementLevelsForItem(itemHrid);
        if (levels.length === 0) {
            continue;
        }

        const buttonContainer = document.createElement("div");
        buttonContainer.className = "d-flex flex-wrap gap-1";
        const currentLevel = Number(enhancementInput.value);
        for (const level of levels) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = `btn btn-sm ${currentLevel === level ? "btn-primary" : "btn-outline-secondary"}`;
            button.style.padding = "0 0.35rem";
            button.textContent = `+${level}`;
            button.addEventListener("click", () => applyEquipmentEnhancementFromMarket(selectType, level));
            buttonContainer.appendChild(button);
        }
        buttonHintElement.appendChild(buttonContainer);

        const baselineEquipment = getBaselineEquipmentForSelectType(selectType);
        const baselineItemHrid = baselineEquipment?.itemHrid ?? "";
        const baselineLevel = Number(baselineEquipment?.enhancementLevel ?? 0);
        const shouldShowUpgradeCost = Boolean(
            baselineItemHrid
            && baselineItemHrid === itemHrid
            && Number.isFinite(currentLevel)
            && currentLevel > baselineLevel
        );

        if (shouldShowUpgradeCost) {
            const costMap = getCurrentPlayerEnhancementCostMap();
            const costKey = getEnhancementUpgradeCostKey(selectType, itemHrid, baselineLevel, currentLevel);
            let savedCost;
            if (Object.prototype.hasOwnProperty.call(costMap, costKey)) {
                savedCost = costMap[costKey];
            } else {
                const defaultCost = computeDefaultEnhancementUpgradeCost(itemHrid, baselineLevel, currentLevel);
                savedCost = String(defaultCost);
                costMap[costKey] = savedCost;
            }

            const costContainer = document.createElement("div");
            costContainer.className = "mt-1";

            const labelRow = document.createElement("div");
            labelRow.className = "small text-secondary";
            costContainer.appendChild(labelRow);

            const costInput = document.createElement("input");
            costInput.type = "number";
            costInput.step = "any";
            costInput.min = "0";
            costInput.className = "form-control form-control-sm";
            costInput.style.maxWidth = "140px";
            costInput.value = String(savedCost);

            const updateCostPreview = () => {
                const numericCost = toFiniteNumber(costInput.value, 0);
                labelRow.textContent = `${i18next.t("common:equipment.upgradeCost")}: ${formatCompactKMBValue(numericCost, 1)}`;
            };
            updateCostPreview();

            const inputRow = document.createElement("div");
            inputRow.className = "mt-1";
            inputRow.appendChild(costInput);
            costContainer.appendChild(inputRow);

            costInput.addEventListener("input", () => {
                costMap[costKey] = costInput.value;
                updateCostPreview();
            });

            costHintElement.appendChild(costContainer);
        }
    }
}

function refreshAbilityUpgradeCostHints() {
    for (let i = 0; i < 5; i++) {
        const abilitySelect = document.getElementById("selectAbility_" + i);
        const abilityLevelInput = document.getElementById("inputAbilityLevel_" + i);
        const costHintElement = document.getElementById("abilityUpgradeCost_" + i);
        if (!abilitySelect || !abilityLevelInput || !costHintElement) {
            continue;
        }

        costHintElement.replaceChildren();

        const abilityHrid = abilitySelect.value;
        if (!abilityHrid) {
            continue;
        }

        const baselineSkill = getBaselineSkillForAbilitySlot(i);
        const baselineAbilityHrid = baselineSkill?.abilityHrid ?? "";
        const baselineLevel = Number(baselineSkill?.level ?? 1);
        const currentLevel = Number(abilityLevelInput.value);
        const shouldShowUpgradeCost = Boolean(
            baselineAbilityHrid
            && baselineAbilityHrid === abilityHrid
            && Number.isFinite(currentLevel)
            && currentLevel > baselineLevel
        );

        if (!shouldShowUpgradeCost) {
            continue;
        }

        const costMap = getCurrentPlayerAbilityCostMap();
        const costKey = getAbilityUpgradeCostKey(i, abilityHrid, baselineLevel, currentLevel);
        let savedCost;
        if (Object.prototype.hasOwnProperty.call(costMap, costKey)) {
            savedCost = costMap[costKey];
        } else {
            const defaultCost = computeDefaultAbilityUpgradeCost(baselineSkill, currentLevel);
            savedCost = String(defaultCost ?? 0);
            if (defaultCost != null) {
                costMap[costKey] = savedCost;
            }
        }

        const costContainer = document.createElement("div");
        costContainer.className = "mb-2";

        const labelRow = document.createElement("div");
        labelRow.className = "small text-secondary";
        costContainer.appendChild(labelRow);

        const costInput = document.createElement("input");
        costInput.type = "number";
        costInput.step = "any";
        costInput.min = "0";
        costInput.className = "form-control form-control-sm";
        costInput.style.maxWidth = "140px";
        costInput.value = String(savedCost);

        const updateCostPreview = () => {
            const numericCost = toFiniteNumber(costInput.value, 0);
            labelRow.textContent = `${i18next.t("common:equipment.upgradeCost")}: ${formatCompactKMBValue(numericCost, 1)}`;
        };
        updateCostPreview();

        const inputRow = document.createElement("div");
        inputRow.className = "mt-1";
        inputRow.appendChild(costInput);
        costContainer.appendChild(inputRow);

        costInput.addEventListener("input", () => {
            costMap[costKey] = costInput.value;
            updateCostPreview();
        });

        costHintElement.appendChild(costContainer);
    }
}

function updateEquipmentState() {
    ["head", "body", "legs", "feet", "hands", "main_hand", "two_hand", "off_hand", "pouch", "neck", "earrings", "ring", "back", "charm"].forEach((type) => {
        let equipmentType = "/equipment_types/" + type;
        let selectType = type;
        if (type == "main_hand" || type == "two_hand") {
            selectType = "weapon";
        }

        let equipmentSelect = document.getElementById("selectEquipment_" + selectType);
        let equipmentHrid = equipmentSelect.value;

        if (!equipmentHrid) {
            player.equipment[equipmentType] = null;
            return;
        }

        let gameItem = itemDetailMap[equipmentHrid];

        // Clear old weapon if a weapon of a different type is equipped
        if (gameItem.equipmentDetail.type != equipmentType) {
            player.equipment[equipmentType] = null;
            return;
        }

        let enhancementLevel = Number(document.getElementById("inputEquipmentEnhancementLevel_" + selectType).value);
        player.equipment[equipmentType] = new Equipment(gameItem.hrid, enhancementLevel);
    });
}

document.getElementById("selectEquipment_set").onchange = changeEquipmentSetListener;

function changeEquipmentSetListener() {
    let value = this.value
    let optgroupType = this.options[this.selectedIndex].parentNode.label;

    ["head", "body", "legs", "feet", "hands"].forEach((type) => {
        let selectType = type;

        let currentEquipment = document.getElementById("selectEquipment_" + selectType);
        if (type === "feet") {
            type = "_boots";
        }
        if (type === "hands") {
            if (optgroupType === "RANGED") {
                type = "_bracers";
            } else if (optgroupType === "MAGIC") {
                type = "_gloves";
            } else {
                type = "_gauntlets";
            }
        }
        if (type === "head") {
            if (optgroupType === "RANGED") {
                type = "_hood";
            } else if (optgroupType === "MAGIC") {
                type = "_hat";
            } else {
                type = "_helmet";
            }
        }
        if (type === "legs") {
            if (optgroupType === "RANGED") {
                type = "_chaps";
            } else if (optgroupType === "MAGIC") {
                type = "_robe_bottoms";
            } else {
                type = "_plate_legs";
            }
        }
        if (type === "body") {
            if (optgroupType === "RANGED") {
                type = "_tunic";
            } else if (optgroupType === "MAGIC") {
                type = "_robe_top";
            } else {
                type = "_plate_body";
            }
        }
        currentEquipment.value = "/items/" + value.toLowerCase() + type;
    });
    updateEquipmentState();
    updateUI();
}

// #endregion

// #region Combat Stats

function updateCombatStatsUI() {
    player.updateCombatDetails();

    let combatStyleElement = document.getElementById("combatStat_combatStyleHrid");
    let combatStyle = player.combatDetails.combatStats.combatStyleHrid;
    combatStyleElement.setAttribute("data-i18n", "combatStyleNames." + combatStyle);
    combatStyleElement.innerHTML = combatStyleDetailMap[combatStyle].name;

    let damageTypeElement = document.getElementById("combatStat_damageType");
    let damageType = damageTypeDetailMap[player.combatDetails.combatStats.damageType];
    damageTypeElement.setAttribute("data-i18n", "damageTypeNames." + damageType.hrid);
    damageTypeElement.innerHTML = damageType.name;

    let attackIntervalElement = document.getElementById("combatStat_attackInterval");
    attackIntervalElement.innerHTML = (player.combatDetails.combatStats.attackInterval / 1e9).toLocaleString() + "s";

    let primaryTrainingElement = document.getElementById("combatStat_primaryTraining");
    let primaryTraining = player.combatDetails.combatStats.primaryTraining;
    primaryTrainingElement.setAttribute("data-i18n", "skillNames." + primaryTraining);
    primaryTrainingElement.innerHTML = primaryTraining;

    let focusTrainingElement = document.getElementById("combatStat_focusTraining");
    let focusTraining = player.combatDetails.combatStats.focusTraining;
    if (focusTraining) {
        focusTrainingElement.setAttribute("data-i18n", "skillNames." + focusTraining);
    } else {
        focusTrainingElement.setAttribute("data-i18n", "characterSelectPage.slots.empty");
    }
    focusTrainingElement.innerHTML = focusTraining;

    [
        "maxHitpoints",
        "maxManapoints",
        "stabAccuracyRating",
        "stabMaxDamage",
        "slashAccuracyRating",
        "slashMaxDamage",
        "smashAccuracyRating",
        "smashMaxDamage",
        "rangedAccuracyRating",
        "rangedMaxDamage",
        "magicAccuracyRating",
        "magicMaxDamage",
        "defensiveMaxDamage",
        "stabEvasionRating",
        "slashEvasionRating",
        "smashEvasionRating",
        "rangedEvasionRating",
        "magicEvasionRating",
        "totalArmor",
        "totalWaterResistance",
        "totalNatureResistance",
        "totalFireResistance",
        "totalThreat"
    ].forEach((stat) => {
        let element = document.getElementById("combatStat_" + stat);
        element.innerHTML = Math.floor(player.combatDetails[stat]);
    });

    [
        "abilityHaste",
        "tenacity"
    ].forEach((stat) => {
        let element = document.getElementById("combatStat_" + stat);
        element.innerHTML = Math.floor(player.combatDetails.combatStats[stat]);
    });

    [
        "physicalAmplify",
        "waterAmplify",
        "natureAmplify",
        "fireAmplify",
        "healingAmplify",
        "lifeSteal",
        "hpRegenPer10",
        "mpRegenPer10",
        "physicalThorns",
        "elementalThorns",
        "criticalRate",
        "criticalDamage",
        "combatExperience",
        "taskDamage",
        "armorPenetration",
        "waterPenetration",
        "naturePenetration",
        "firePenetration",
        "manaLeech",
        "castSpeed",
        "parry",
        "mayhem",
        "pierce",
        "curse",
        "fury",
        "weaken",
        "ripple",
        "bloom",
        "blaze",
        "attackSpeed",
        "autoAttackDamage",
        "abilityDamage",
        "drinkConcentration",
        "foodHaste",
        "staminaExperience",
        "intelligenceExperience",
        "attackExperience",
        "defenseExperience",
        "meleeExperience",
        "rangedExperience",
        "magicExperience"

    ].forEach((stat) => {
        let element = document.getElementById("combatStat_" + stat);
        let value = (100 * player.combatDetails.combatStats[stat]).toLocaleString([], {
            minimumFractionDigits: 0,
            maximumFractionDigits: 4,
        });
        element.innerHTML = value + "%";
    });
}

// #endregion

// #region Level

function initLevelSection() {
    ["stamina", "intelligence", "attack", "melee", "defense", "ranged", "magic"].forEach((skill) => {
        let levelInput = document.getElementById("inputLevel_" + skill);
        levelInput.value = 1;
        levelInput.addEventListener("change", levelInputHandler);
    });
}

function levelInputHandler() {
    updateLevels();
    updateUI();
}

function updateLevels() {
    ["stamina", "intelligence", "attack", "melee", "defense", "ranged", "magic"].forEach((skill) => {
        let levelInput = document.getElementById("inputLevel_" + skill);
        player[skill + "Level"] = Number(levelInput.value);
    });
    updateCombatLevel();
}

function calcCombatLevel(staminaLevel, intelligenceLevel, defenseLevel, attackLevel, meleeLevel, rangedLevel, magicLevel) {
    return 0.1 * (staminaLevel + intelligenceLevel + attackLevel + defenseLevel + Math.max(meleeLevel, rangedLevel, magicLevel)) + 
        0.5 * Math.max(attackLevel, defenseLevel, meleeLevel, rangedLevel, magicLevel)
    ;
}


function updateCombatLevel() {
    let staminaLevel = player["staminaLevel"];
    let intelligenceLevel = player["intelligenceLevel"];
    let defenseLevel = player["defenseLevel"];
    let attackLevel = player["attackLevel"];
    let meleeLevel = player["meleeLevel"];
    let rangedLevel = player["rangedLevel"];
    let magicLevel = player["magicLevel"];

    let levelInput = document.getElementById("inputLevel_combat");
    levelInput.value = parseFloat(calcCombatLevel(staminaLevel, intelligenceLevel, defenseLevel, attackLevel, meleeLevel, rangedLevel, magicLevel).toFixed(1));
}

// #endregion

// #region Food

function initFoodSection() {
    for (let i = 0; i < 3; i++) {
        let element = document.getElementById("selectFood_" + i);

        let gameFoods = Object.values(itemDetailMap)
            .filter((item) => item.categoryHrid == "/item_categories/food")
            .sort((a, b) => a.sortIndex - b.sortIndex);

        for (const food of Object.values(gameFoods)) {
            let opt = new Option(food.name, food.hrid);
            opt.setAttribute("data-i18n", "itemNames." + food.hrid);
            element.add(opt);
        }

        element.addEventListener("change", foodSelectHandler);
    }
}

function foodSelectHandler() {
    updateFoodState();
    updateUI();
}

function updateFoodState() {
    for (let i = 0; i < 3; i++) {
        let foodSelect = document.getElementById("selectFood_" + i);
        food[i] = foodSelect.value;
        if (food[i] && !triggerMap[food[i]]) {
            let gameItem = itemDetailMap[food[i]];
            triggerMap[food[i]] = structuredClone(gameItem.consumableDetail.defaultCombatTriggers);
        }
    }
}

function updateFoodUI() {
    for (let i = 0; i < 3; i++) {
        let selectElement = document.getElementById("selectFood_" + i);
        let triggerButton = document.getElementById("buttonFoodTrigger_" + i);

        selectElement.disabled = i >= player.combatDetails.combatStats.foodSlots;
        triggerButton.disabled = i >= player.combatDetails.combatStats.foodSlots || !food[i];
    }
}

// #endregion

// #region Drinks

function initDrinksSection() {
    for (let i = 0; i < 3; i++) {
        let element = document.getElementById("selectDrink_" + i);

        let gameDrinks = Object.values(itemDetailMap)
            .filter((item) => item.categoryHrid == "/item_categories/drink")
            .filter((item) => item.consumableDetail.usableInActionTypeMap["/action_types/combat"])
            .sort((a, b) => a.sortIndex - b.sortIndex);

        for (const drink of Object.values(gameDrinks)) {
            let opt = new Option(drink.name, drink.hrid);
            opt.setAttribute("data-i18n", "itemNames." + drink.hrid);
            element.add(opt);
        }

        element.addEventListener("change", drinkSelectHandler);
    }
}

function drinkSelectHandler() {
    updateDrinksState();
    updateDrinksUI();
}

function updateDrinksState() {
    for (let i = 0; i < 3; i++) {
        let drinkSelect = document.getElementById("selectDrink_" + i);
        drinks[i] = drinkSelect.value;
        if (drinks[i] && !triggerMap[drinks[i]]) {
            let gameItem = itemDetailMap[drinks[i]];
            triggerMap[drinks[i]] = structuredClone(gameItem.consumableDetail.defaultCombatTriggers);
        }
    }
}

function updateDrinksUI() {
    for (let i = 0; i < 3; i++) {
        let selectElement = document.getElementById("selectDrink_" + i);
        let triggerButton = document.getElementById("buttonDrinkTrigger_" + i);

        selectElement.disabled = i >= player.combatDetails.combatStats.drinkSlots;
        triggerButton.disabled = i >= player.combatDetails.combatStats.drinkSlots || !drinks[i];
    }
}

// #endregion

// #region Abilities

function initAbilitiesSection() {
    for (let i = 0; i < 5; i++) {
        let selectElement = document.getElementById("selectAbility_" + i);
        let inputElement = document.getElementById("inputAbilityLevel_" + i);

        inputElement.value = 1;

        let gameAbilities;
        if (i == 0) {
            gameAbilities = Object.values(abilityDetailMap).filter(x => x.isSpecialAbility).sort((a, b) => a.sortIndex - b.sortIndex);
        } else {
            gameAbilities = Object.values(abilityDetailMap).filter(x => !x.isSpecialAbility).sort((a, b) => a.sortIndex - b.sortIndex);
        }


        for (const ability of Object.values(gameAbilities)) {
            let opt = new Option(ability.name, ability.hrid);
            opt.setAttribute("data-i18n", "abilityNames." + ability.hrid);
            selectElement.add(opt);
        }

        selectElement.addEventListener("change", abilitySelectHandler);
        inputElement.addEventListener("input", refreshAbilityUpgradeCostHints);
        inputElement.addEventListener("change", refreshAbilityUpgradeCostHints);
    }

    initAbilityUpgradeCostPlaceholders();
}

function abilitySelectHandler() {
    updateAbilityState();
    updateAbilityUI();
}

function updateAbilityState() {
    for (let i = 0; i < 5; i++) {
        let abilitySelect = document.getElementById("selectAbility_" + i);
        abilities[i] = abilitySelect.value;
        if (abilities[i] && !triggerMap[abilities[i]]) {
            let gameAbility = abilityDetailMap[abilities[i]];
            triggerMap[abilities[i]] = structuredClone(gameAbility.defaultCombatTriggers);
        }
    }
}

function updateAbilityUI() {
    for (let i = 0; i < 5; i++) {
        let selectElement = document.getElementById("selectAbility_" + i);
        let inputElement = document.getElementById("inputAbilityLevel_" + i);
        let triggerButton = document.getElementById("buttonAbilityTrigger_" + i);

        selectElement.disabled = player.intelligenceLevel < abilitySlotsLevelRequirementList[i + 1];
        inputElement.disabled = player.intelligenceLevel < abilitySlotsLevelRequirementList[i + 1];
        triggerButton.disabled = player.intelligenceLevel < abilitySlotsLevelRequirementList[i + 1] || !abilities[i];
        let moveUpButton = document.getElementById("selectAbilityMoveUp_" + i);
        moveUpButton.onclick = () => swapAbilityOrder(i, -1);
    }

    refreshAbilityUpgradeCostHints();
}

function swapAbilityOrder(abilityIndex, step) {
    const swapIndex = abilityIndex + step;
    if (swapIndex < 0 || swapIndex > 4) {
        return;
    }

    let abilitySelect = document.getElementById("selectAbility_" + abilityIndex);
    let abilityLevelInput = document.getElementById("inputAbilityLevel_" + abilityIndex);

    const tempAbility = abilities[abilityIndex];
    abilities[abilityIndex] = abilities[swapIndex];
    abilities[swapIndex] = tempAbility;

    const tempLevel = abilityLevelInput.value;
    abilityLevelInput.value = document.getElementById("inputAbilityLevel_" + swapIndex).value;
    document.getElementById("inputAbilityLevel_" + swapIndex).value = tempLevel;

    abilitySelect.value = document.getElementById("selectAbility_" + (swapIndex)).value;
    document.getElementById("selectAbility_" + swapIndex).value = abilities[swapIndex];

    updateAbilityState();
    updateAbilityUI();
}

// #endregion

// #region Trigger

function initTriggerModal() {
    let modal = document.getElementById("triggerModal");
    modal.addEventListener("show.bs.modal", (event) => triggerModalShownHandler(event));

    let triggerSaveButton = document.getElementById("buttonTriggerModalSave");
    triggerSaveButton.addEventListener("click", (event) => triggerModalSaveHandler(event));

    let triggerAddButton = document.getElementById("buttonAddTrigger");
    triggerAddButton.addEventListener("click", (event) => triggerAddButtonHandler(event));

    let triggerDefaultButton = document.getElementById("buttonDefaultTrigger");
    triggerDefaultButton.addEventListener("click", (event) => triggerDefaultButtonHandler(event));

    for (let i = 0; i < 4; i++) {
        let triggerDependencySelect = document.getElementById("selectTriggerDependency_" + i);
        let triggerConditionSelect = document.getElementById("selectTriggerCondition_" + i);
        let triggerComparatorSelect = document.getElementById("selectTriggerComparator_" + i);
        let triggerValueInput = document.getElementById("inputTriggerValue_" + i);
        let triggerRemoveButton = document.getElementById("buttonRemoveTrigger_" + i);

        triggerDependencySelect.addEventListener("change", (event) => triggerDependencySelectHandler(event, i));
        triggerConditionSelect.addEventListener("change", (event) => triggerConditionSelectHandler(event, i));
        triggerComparatorSelect.addEventListener("change", (event) => triggerComparatorSelectHander(event, i));
        triggerValueInput.addEventListener("change", (event) => triggerValueInputHandler(event, i));
        triggerRemoveButton.addEventListener("click", (event) => triggerRemoveButtonHandler(event, i));
    }
}

function triggerModalShownHandler(event) {
    let triggerButton = event.relatedTarget;

    let triggerType = triggerButton.getAttribute("data-bs-triggertype");
    let triggerIndex = Number(triggerButton.getAttribute("data-bs-triggerindex"));

    let triggerTarget;
    switch (triggerType) {
        case "food":
            triggerTarget = food[triggerIndex];
            break;
        case "drink":
            triggerTarget = drinks[triggerIndex];
            break;
        case "ability":
            triggerTarget = abilities[triggerIndex];
            break;
    }

    let triggerTargetnput = document.getElementById("inputModalTriggerTarget");
    triggerTargetnput.value = triggerTarget;
    modalTriggers = triggerMap[triggerTarget];
    updateTriggerModal();
}

function triggerModalSaveHandler(event) {
    let triggerTargetnput = document.getElementById("inputModalTriggerTarget");
    let triggerTarget = triggerTargetnput.value;

    triggerMap[triggerTarget] = modalTriggers;
    refreshHomeDiffHighlight();
}

function triggerDependencySelectHandler(event, index) {
    modalTriggers[index].dependencyHrid = event.target.value;
    modalTriggers[index].conditionHrid = "";
    modalTriggers[index].comparatorHrid = "";
    modalTriggers[index].value = 0;

    updateTriggerModal();
}

function triggerConditionSelectHandler(event, index) {
    modalTriggers[index].conditionHrid = event.target.value;
    modalTriggers[index].comparatorHrid = "";
    modalTriggers[index].value = 0;

    updateTriggerModal();
}

function triggerComparatorSelectHander(event, index) {
    modalTriggers[index].comparatorHrid = event.target.value;

    updateTriggerModal();
}

function triggerValueInputHandler(event, index) {
    modalTriggers[index].value = Number(event.target.value);

    updateTriggerModal();
}

function triggerRemoveButtonHandler(event, index) {
    modalTriggers.splice(index, 1);

    updateTriggerModal();
}

function triggerAddButtonHandler(event) {
    if (modalTriggers.length == 4) {
        return;
    }

    modalTriggers.push({
        dependencyHrid: "",
        conditionHrid: "",
        comparatorHrid: "",
        value: 0,
    });

    updateTriggerModal();
}

function triggerDefaultButtonHandler(event) {
    let triggerTargetnput = document.getElementById("inputModalTriggerTarget");
    let triggerTarget = triggerTargetnput.value;

    if (triggerTarget.startsWith("/items/")) {
        modalTriggers = structuredClone(itemDetailMap[triggerTarget].consumableDetail.defaultCombatTriggers);
    } else {
        modalTriggers = structuredClone(abilityDetailMap[triggerTarget].defaultCombatTriggers);
    }

    updateTriggerModal();
}

function updateTriggerModal() {
    let triggerStartTextElement = document.getElementById("triggerStartText");
    if (modalTriggers.length == 0) {
        triggerStartTextElement.innerHTML = "Activate as soon as it's off cooldown";
    } else {
        triggerStartTextElement.innerHTML = "Activate when:";
    }

    let triggerAddButton = document.getElementById("buttonAddTrigger");
    triggerAddButton.disabled = modalTriggers.length == 4;

    let triggersValid = true;

    for (let i = 0; i < 4; i++) {
        let triggerElement = document.getElementById("modalTrigger_" + i);

        if (!modalTriggers[i]) {
            hideElement(triggerElement);
            continue;
        }

        showElement(triggerElement);

        let triggerDependencySelect = document.getElementById("selectTriggerDependency_" + i);
        let triggerConditionSelect = document.getElementById("selectTriggerCondition_" + i);
        let triggerComparatorSelect = document.getElementById("selectTriggerComparator_" + i);
        let triggerValueInput = document.getElementById("inputTriggerValue_" + i);

        showElement(triggerDependencySelect);
        fillTriggerDependencySelect(triggerDependencySelect);

        if (modalTriggers[i].dependencyHrid == "") {
            hideElement(triggerConditionSelect);
            hideElement(triggerComparatorSelect);
            hideElement(triggerValueInput);
            triggersValid = false;
            continue;
        }

        triggerDependencySelect.value = modalTriggers[i].dependencyHrid;
        showElement(triggerConditionSelect);
        fillTriggerConditionSelect(triggerConditionSelect, modalTriggers[i].dependencyHrid);

        if (modalTriggers[i].conditionHrid == "") {
            hideElement(triggerComparatorSelect);
            hideElement(triggerValueInput);
            triggersValid = false;
            continue;
        }

        triggerConditionSelect.value = modalTriggers[i].conditionHrid;
        showElement(triggerComparatorSelect);
        fillTriggerComparatorSelect(triggerComparatorSelect, modalTriggers[i].conditionHrid);

        if (modalTriggers[i].comparatorHrid == "") {
            hideElement(triggerValueInput);
            triggersValid = false;
            continue;
        }

        triggerComparatorSelect.value = modalTriggers[i].comparatorHrid;

        if (combatTriggerComparatorDetailMap[modalTriggers[i].comparatorHrid].allowValue) {
            showElement(triggerValueInput);
            triggerValueInput.value = modalTriggers[i].value;
        } else {
            hideElement(triggerValueInput);
        }
    }

    let triggerSaveButton = document.getElementById("buttonTriggerModalSave");
    triggerSaveButton.disabled = !triggersValid;

    updateContent();
}

function fillTriggerDependencySelect(element) {
    element.length = 0;
    element.add(new Option("", ""));

    for (const dependency of Object.values(combatTriggerDependencyDetailMap).sort(
        (a, b) => a.sortIndex - b.sortIndex
    )) {
        let opt = new Option(dependency.name, dependency.hrid);
        opt.setAttribute("data-i18n", "combatTriggerDependencyNames." + dependency.hrid);
        element.add(opt);
    }
}

function fillTriggerConditionSelect(element, dependencyHrid) {
    let dependency = combatTriggerDependencyDetailMap[dependencyHrid];

    let conditions;
    if (dependency.isSingleTarget) {
        conditions = Object.values(combatTriggerConditionDetailMap).filter((condition) => condition.isSingleTarget);
    } else {
        conditions = Object.values(combatTriggerConditionDetailMap).filter((condition) => condition.isMultiTarget);
    }

    element.length = 0;
    element.add(new Option("", ""));

    for (const condition of Object.values(conditions).sort((a, b) => a.sortIndex - b.sortIndex)) {
        let opt = new Option(condition.name, condition.hrid);
        opt.setAttribute("data-i18n", "combatTriggerConditionNames." + condition.hrid);
        element.add(opt);
    }
}

function fillTriggerComparatorSelect(element, conditionHrid) {
    let condition = combatTriggerConditionDetailMap[conditionHrid];

    let comparators = condition.allowedComparatorHrids.map((hrid) => combatTriggerComparatorDetailMap[hrid]);

    element.length = 0;
    element.add(new Option("", ""));

    for (const comparator of Object.values(comparators).sort((a, b) => a.sortIndex - b.sortIndex)) {
        let opt = new Option(comparator.name, comparator.hrid);
        opt.setAttribute("data-i18n", "combatTriggerComparatorNames." + comparator.hrid);
        element.add(opt);
    }
}

function hideElement(element) {
    element.classList.remove("d-flex");
    element.classList.add("d-none");
}

function showElement(element) {
    element.classList.remove("d-none");
    element.classList.add("d-flex");
}

// #endregion

// #region Zones

function initZones() {
    let zoneSelect = document.getElementById("selectZone");

    // TOOD dungeon wave spawns
    let gameZones = Object.values(actionDetailMap)
        .filter((action) => action.type == "/action_types/combat" && action.category != "/action_categories/combat/dungeons")
        .sort((a, b) => a.sortIndex - b.sortIndex);

    for (const zone of Object.values(gameZones)) {
        let opt = new Option(zone.name, zone.hrid);
        opt.setAttribute("data-i18n", "actionNames." + zone.hrid);
        zoneSelect.add(opt);
    }


    let zoneCheckBox = document.getElementById("zoneCheckBox");
    let checkAllZonesToggle = document.getElementById('checkAllZones');

    let simAllZonesToggle = document.getElementById("simAllZoneToggle");
    simAllZonesToggle.addEventListener("change", (event) => {
        if (simAllZonesToggle.checked) {
            zoneCheckBox.classList.remove("d-none");
            zoneCheckBox.querySelectorAll(".zone-checkbox").forEach(checkbox => checkbox.checked = true);
            checkAllZonesToggle.checked = true;
        } else {
            zoneCheckBox.classList.add("d-none");
        }
    });

    let zoneHrids = Object.values(actionDetailMap)
        .filter((action) => action.type == "/action_types/combat" && action.category != "/action_categories/combat/dungeons" && action.combatZoneInfo.fightInfo.randomSpawnInfo.maxSpawnCount > 1)
        .sort((a, b) => a.sortIndex - b.sortIndex)
        .flat();

    for (const zoneHrid of zoneHrids) {
        const newZone = document.createElement('div');
        newZone.classList.add('form-check');
        newZone.innerHTML = `
            <input class="form-check-input zone-checkbox" type="checkbox" id="${zoneHrid.hrid}">
            <label class="form-check-label" for="${zoneHrid.hrid}" data-i18n="actionNames.${zoneHrid.hrid}">
                ${zoneHrid.name}
            </label>
        `;
        zoneCheckBox.append(newZone);
    }

    let checkZoneToggles = document.querySelectorAll('.zone-checkbox');
    checkAllZonesToggle.addEventListener('change', () => {
        checkZoneToggles.forEach(cb => cb.checked = checkAllZonesToggle.checked);
    });

    checkZoneToggles.forEach(cb =>
        cb.addEventListener('change', () => {
            checkAllZonesToggle.checked = [...checkZoneToggles].every(x => x.checked);
        })
    );


    let soloCheckBox = document.getElementById("soloCheckBox");
    let checkAllSolosToggle = document.getElementById('checkAllSolos');

    let simAllSoloToggle = document.getElementById("simAllSoloToggle");
    simAllSoloToggle.addEventListener("change", (event) => {
        if (simAllSoloToggle.checked) {
            soloCheckBox.classList.remove("d-none");
            soloCheckBox.querySelectorAll(".solo-checkbox").forEach(checkbox => checkbox.checked = true);
            checkAllSolosToggle.checked = true;
        } else {
            soloCheckBox.classList.add("d-none");
        }
    });

    let soloHrids = Object.values(actionDetailMap)
        .filter((action) => action.type == "/action_types/combat" && action.category != "/action_categories/combat/dungeons" && action.combatZoneInfo.fightInfo.randomSpawnInfo.maxSpawnCount == 1)
        .sort((a, b) => a.sortIndex - b.sortIndex)
        .flat();

    for (const zoneHrid of soloHrids) {
        const newZone = document.createElement('div');
        newZone.classList.add('form-check');
        newZone.innerHTML = `
            <input class="form-check-input solo-checkbox" type="checkbox" id="${zoneHrid.hrid}">
            <label class="form-check-label" for="${zoneHrid.hrid}" data-i18n="actionNames.${zoneHrid.hrid}">
                ${zoneHrid.name}
            </label>
        `;
        soloCheckBox.append(newZone);
    }

    let checkSoloToggles = document.querySelectorAll('.solo-checkbox');
    checkAllSolosToggle.addEventListener('change', () => {
        checkSoloToggles.forEach(cb => cb.checked = checkAllSolosToggle.checked);
    });

    checkSoloToggles.forEach(cb =>
        cb.addEventListener('change', () => {
            checkAllSolosToggle.checked = [...checkSoloToggles].every(x => x.checked);
        })
    );
}

function initDungeons() {
    let dungeonSelect = document.getElementById("selectDungeon");

    let gameDungeons = Object.values(actionDetailMap)
        .filter((action) => action.type == "/action_types/combat" && action.category == "/action_categories/combat/dungeons")
        .sort((a, b) => a.sortIndex - b.sortIndex);

    for (const dungeon of Object.values(gameDungeons)) {
        let opt = new Option(dungeon.name, dungeon.hrid);
        opt.setAttribute("data-i18n", "actionNames." + dungeon.hrid);
        dungeonSelect.add(opt);
    }
}

// #endregion

// #region Simulation Result

function createDamageDoneAccordion(enemyIndex) {
    const accordionDiv = createElement('div', 'row d-none', '', `simulationResultDamageDoneAccordionEnemy${enemyIndex}`);

    const colDiv = createElement('div', 'col');
    const accordionMainDiv = createElement('div', 'accordion');
    const accordionItemDiv = createElement('div', 'accordion-item');

    const headerH2 = createElement('h2', 'accordion-header');
    const button = createElement('button', 'accordion-button collapsed',
        `<b>Damage Done (Enemy ${enemyIndex})</b>`,
        `buttonSimulationResultDamageDoneAccordionEnemy${enemyIndex}`
    );
    button.setAttribute('type', 'button');
    button.setAttribute('data-bs-toggle', 'collapse');
    button.setAttribute('data-bs-target', `#collapseDamageDone${enemyIndex}`);
    button.style.padding = '0.5em';

    const collapseDiv = createElement('div', 'accordion-collapse collapse', '', `collapseDamageDone${enemyIndex}`);
    const accordionBodyDiv = createElement('div', 'accordion-body');

    const headerRow = createElement('div', 'row');
    headerRow.innerHTML = `
        <div class="col-md-5"><b data-i18n="common:simulationResults.source">Source</b></div>
        <div class="col-md-3 text-end"><b data-i18n="common:simulationResults.hitChance">Hitchance</b></div>
        <div class="col-md-2 text-end"><b>DPS</b></div>
        <div class="col-md-2 text-end"><b>%</b></div>
    `;

    const resultDiv = createElement('div', '', '', `simulationResultDamageDoneEnemy${enemyIndex}`);

    accordionBodyDiv.appendChild(headerRow);
    accordionBodyDiv.appendChild(resultDiv);
    collapseDiv.appendChild(accordionBodyDiv);
    headerH2.appendChild(button);
    accordionItemDiv.appendChild(headerH2);
    accordionItemDiv.appendChild(collapseDiv);
    accordionMainDiv.appendChild(accordionItemDiv);
    colDiv.appendChild(accordionMainDiv);
    accordionDiv.appendChild(colDiv);

    return accordionDiv;
}
function createDamageTakenAccordion(enemyIndex) {
    const accordionDiv = createElement('div', 'row d-none', '', `simulationResultDamageTakenAccordionEnemy${enemyIndex}`);

    const colDiv = createElement('div', 'col');
    const accordionMainDiv = createElement('div', 'accordion');
    const accordionItemDiv = createElement('div', 'accordion-item');

    const headerH2 = createElement('h2', 'accordion-header');
    const button = createElement('button', 'accordion-button collapsed',
        `<b>Damage Taken (Enemy ${enemyIndex})</b>`,
        `buttonSimulationResultDamageTakenAccordionEnemy${enemyIndex}`
    );
    button.setAttribute('type', 'button');
    button.setAttribute('data-bs-toggle', 'collapse');
    button.setAttribute('data-bs-target', `#collapseDamageTaken${enemyIndex}`);
    button.style.padding = '0.5em';

    const collapseDiv = createElement('div', 'accordion-collapse collapse', '', `collapseDamageTaken${enemyIndex}`);
    const accordionBodyDiv = createElement('div', 'accordion-body');

    const headerRow = createElement('div', 'row');
    headerRow.innerHTML = `
        <div class="col-md-5"><b data-i18n="common:simulationResults.source">Source</b></div>
        <div class="col-md-3 text-end"><b data-i18n="common:simulationResults.hitChance">Hitchance</b></div>
        <div class="col-md-2 text-end"><b>DPS</b></div>
        <div class="col-md-2 text-end"><b>%</b></div>
    `;

    const resultDiv = createElement('div', '', '', `simulationResultDamageTakenEnemy${enemyIndex}`);

    accordionBodyDiv.appendChild(headerRow);
    accordionBodyDiv.appendChild(resultDiv);
    collapseDiv.appendChild(accordionBodyDiv);
    headerH2.appendChild(button);
    accordionItemDiv.appendChild(headerH2);
    accordionItemDiv.appendChild(collapseDiv);
    accordionMainDiv.appendChild(accordionItemDiv);
    colDiv.appendChild(accordionMainDiv);
    accordionDiv.appendChild(colDiv);

    return accordionDiv;
}


function initDamageDoneTaken() {
    for (let i = 64; i > 0; i--) {
        document.getElementById("simulationResultTotalDamageDone").insertAdjacentElement('afterend', createDamageDoneAccordion(i));
        document.getElementById("simulationResultTotalDamageTaken").insertAdjacentElement('afterend', createDamageTakenAccordion(i));
    }
}

function toFiniteNumber(value, fallback = 0) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
}

function hasPlayerDataInSimResult(simResult, playerHrid) {
    if (!simResult || !playerHrid) {
        return false;
    }

    return simResult.dropRateMultiplier?.[playerHrid] != null
        || simResult.experienceGained?.[playerHrid] != null
        || simResult.attacks?.[playerHrid] != null
        || simResult.consumablesUsed?.[playerHrid] != null
        || simResult.manaUsed?.[playerHrid] != null
        || simResult.debuffOnLevelGap?.[playerHrid] != null;
}

function resolveSimResultPlayerHrid(simResult, preferredPlayerId = currentPlayerTabId) {
    if (!simResult) {
        return null;
    }

    const preferredPlayerHrid = "player" + preferredPlayerId;
    if (hasPlayerDataInSimResult(simResult, preferredPlayerHrid)) {
        return preferredPlayerHrid;
    }

    const selectedCandidate = selectedPlayers
        .map((playerId) => "player" + playerId)
        .find((playerHrid) => hasPlayerDataInSimResult(simResult, playerHrid));
    if (selectedCandidate) {
        return selectedCandidate;
    }

    const playerMaps = [
        simResult.dropRateMultiplier,
        simResult.experienceGained,
        simResult.attacks,
        simResult.consumablesUsed,
        simResult.manaUsed,
        simResult.debuffOnLevelGap,
    ];

    for (const mapObject of playerMaps) {
        if (!mapObject) {
            continue;
        }
        const firstPlayerKey = Object.keys(mapObject).find((key) => PLAYER_HRID_LIST.includes(key));
        if (firstPlayerKey) {
            return firstPlayerKey;
        }
    }

    return null;
}

function showSimulationResult(simResult) {
    currentSimResults = simResult;
    let expensesModalTable = document.querySelector("#expensesTable > tbody");
    expensesModalTable.innerHTML = '<th data-i18n=\"marketplacePanel.item\">Item</th><th data-i18n=\"marketplacePanel.price\">Price</th><th data-i18n=\"common:amount\">Amount</th><th data-i18n=\"common:total\">Total</th>';
    let revenueModalTable = document.querySelector("#revenueTable > tbody");
    revenueModalTable.innerHTML = '<th data-i18n=\"marketplacePanel.item\">Item</th><th data-i18n=\"marketplacePanel.price\">Price</th><th data-i18n=\"common:amount\">Amount</th><th data-i18n=\"common:total\">Total</th>';
    let noRngRevenueModalTable = document.querySelector("#noRngRevenueTable > tbody");
    noRngRevenueModalTable.innerHTML = '<th data-i18n=\"marketplacePanel.item\">Item</th><th data-i18n=\"marketplacePanel.price\">Price</th><th data-i18n=\"common:amount\">Amount</th><th data-i18n=\"common:total\">Total</th>';
    let playerToDisplay = resolveSimResultPlayerHrid(simResult, currentPlayerTabId);
    if (!playerToDisplay) {
        return;
    }

    showKills(simResult, playerToDisplay);
    showDeaths(simResult, playerToDisplay);
    showExperienceGained(simResult, playerToDisplay);
    showConsumablesUsed(simResult, playerToDisplay);
    refreshMetricCardsVisibility();
    showHpSpent(simResult, playerToDisplay);
    showManaUsed(simResult, playerToDisplay);
    showHitpointsGained(simResult, playerToDisplay);
    showManapointsGained(simResult, playerToDisplay);
    showDamageDone(simResult, playerToDisplay);
    showDamageTaken(simResult, playerToDisplay);
    renderWipeEvents(simResult);
    window.profit = window.revenue - window.expenses;
    document.getElementById('profitSpan').innerText = window.profit.toLocaleString();
    document.getElementById('profitPreview').innerText = window.profit.toLocaleString();
    document.getElementById('expensesPreview').innerText = window.expenses.toLocaleString();
    document.getElementById('revenuePreview').innerText = window.revenue.toLocaleString();
    window.noRngProfit = window.noRngRevenue - window.expenses;
    document.getElementById('noRngProfitSpan').innerText = window.noRngProfit.toLocaleString();
    document.getElementById('noRngProfitPreview').innerText = window.noRngProfit.toLocaleString();
    
    // 显示战斗图表
    if (document.getElementById('hpMpVisualizationToggle').checked) {
        renderCombatCharts(simResult);
    }
}

function refreshMetricCardsVisibility() {
    const mappings = [
        { cardId: "metricCardDeaths", bodyId: "simulationResultPlayerDeaths" },
        { cardId: "metricCardExperience", bodyId: "simulationResultExperienceGain" },
        { cardId: "metricCardConsumables", bodyId: "simulationResultConsumablesUsed" },
    ];

    for (const mapping of mappings) {
        const card = document.getElementById(mapping.cardId);
        const body = document.getElementById(mapping.bodyId);
        if (!card || !body) {
            continue;
        }
        const hasData = body.children.length > 0 || body.textContent.trim() !== "";
        card.classList.toggle("d-none", !hasData);
    }
}

function showAllSimulationResults(simResults) {
    let displaySimResults = manipulateSimResultsDataForDisplay(simResults);
    updateAllSimsModal(displaySimResults);
}

// #region 战斗图表功能

let combatCharts = {
    hpChart: null,
    mpChart: null
};

let lastUpdateTime = 0;
const UPDATE_INTERVAL = 1000; // 每秒更新一次图表

// 实时更新图表
function updateChartsRealtime(timeSeriesData) {
    // 节流：避免过于频繁的更新
    const now = Date.now();
    if (now - lastUpdateTime < UPDATE_INTERVAL) {
        return;
    }
    lastUpdateTime = now;
    
    if (!timeSeriesData || !timeSeriesData.timestamps || timeSeriesData.timestamps.length === 0) {
        return;
    }
    
    // 显示图表容器
    const container = document.getElementById('combatChartsContainer');
    if (container) {
        container.classList.remove('d-none');
    }
    
    // 如果图表不存在，先创建
    if (!combatCharts.hpChart || !combatCharts.mpChart) {
        initializeRealtimeCharts();
        // 等待下一次更新周期再更新数据
        return;
    }
    
    const timeLabels = timeSeriesData.timestamps.map(t => (t / ONE_SECOND).toFixed(1));
    const playerIds = Object.keys(timeSeriesData.players);
    
    // 生成颜色方案
    const colors = [
        { border: 'rgb(75, 192, 192)', bg: 'rgba(75, 192, 192, 0.2)' },
        { border: 'rgb(255, 99, 132)', bg: 'rgba(255, 99, 132, 0.2)' },
        { border: 'rgb(54, 162, 235)', bg: 'rgba(54, 162, 235, 0.2)' },
        { border: 'rgb(255, 206, 86)', bg: 'rgba(255, 206, 86, 0.2)' },
        { border: 'rgb(153, 102, 255)', bg: 'rgba(153, 102, 255, 0.2)' }
    ];
    
    // 重建datasets以确保完整更新
    const hpDatasets = playerIds.map((playerId, index) => {
        const playerData = timeSeriesData.players[playerId];
        return {
            label: playerId + ' HP',
            data: playerData.hp,
            borderColor: colors[index % colors.length].border,
            backgroundColor: colors[index % colors.length].bg,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.1
        };
    });
    
    const mpDatasets = playerIds.map((playerId, index) => {
        const playerData = timeSeriesData.players[playerId];
        return {
            label: playerId + ' MP',
            data: playerData.mp,
            borderColor: colors[index % colors.length].border,
            backgroundColor: colors[index % colors.length].bg,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.1
        };
    });
    
    // 更新HP图表
    combatCharts.hpChart.data.labels = timeLabels;
    combatCharts.hpChart.data.datasets = hpDatasets;
    combatCharts.hpChart.options.plugins.legend.display = true;
    combatCharts.hpChart.options.plugins.title.text = i18next.t('common:Experiment.hpOverTime');
    combatCharts.hpChart.update('none');
    
    // 更新MP图表
    combatCharts.mpChart.data.labels = timeLabels;
    combatCharts.mpChart.data.datasets = mpDatasets;
    combatCharts.mpChart.options.plugins.legend.display = true;
    combatCharts.mpChart.options.plugins.title.text = i18next.t('common:Experiment.mpOverTime');
    combatCharts.mpChart.update('none');
}

function renderCombatCharts(simResult) {
    // 显示图表容器
    const container = document.getElementById('combatChartsContainer');
    if (container) {
        container.classList.remove('d-none');
    }
    
    if (!simResult.timeSeriesData || !simResult.timeSeriesData.timestamps || simResult.timeSeriesData.timestamps.length === 0) {
        // 显示空状态
        showEmptyCharts();
        return;
    }
    
    const timeLabels = simResult.timeSeriesData.timestamps.map(t => (t / ONE_SECOND).toFixed(1));
    
    // 获取所有玩家
    const playerIds = Object.keys(simResult.timeSeriesData.players);
    
    // 生成颜色方案
    const colors = [
        { border: 'rgb(75, 192, 192)', bg: 'rgba(75, 192, 192, 0.2)' },
        { border: 'rgb(255, 99, 132)', bg: 'rgba(255, 99, 132, 0.2)' },
        { border: 'rgb(54, 162, 235)', bg: 'rgba(54, 162, 235, 0.2)' },
        { border: 'rgb(255, 206, 86)', bg: 'rgba(255, 206, 86, 0.2)' },
        { border: 'rgb(153, 102, 255)', bg: 'rgba(153, 102, 255, 0.2)' }
    ];
    
    // HP图表
    destroyChart('hpChart');
    const hpDatasets = playerIds.map((playerId, index) => {
        const playerData = simResult.timeSeriesData.players[playerId];
        return {
            label: playerId + ' HP',
            data: playerData.hp,
            borderColor: colors[index % colors.length].border,
            backgroundColor: colors[index % colors.length].bg,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.1
        };
    });
    
    combatCharts.hpChart = new Chart(document.getElementById('hpChart'), {
        type: 'line',
        data: {
            labels: timeLabels,
            datasets: hpDatasets
        },
        options: getChartOptions(i18next.t('common:Experiment.hpOverTime'), i18next.t('common:Experiment.timeInSeconds'), 'HP')
    });
    
    // MP图表
    destroyChart('mpChart');
    const mpDatasets = playerIds.map((playerId, index) => {
        const playerData = simResult.timeSeriesData.players[playerId];
        return {
            label: playerId + ' MP',
            data: playerData.mp,
            borderColor: colors[index % colors.length].border,
            backgroundColor: colors[index % colors.length].bg,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.1
        };
    });
    
    combatCharts.mpChart = new Chart(document.getElementById('mpChart'), {
        type: 'line',
        data: {
            labels: timeLabels,
            datasets: mpDatasets
        },
        options: getChartOptions(i18next.t('common:Experiment.mpOverTime'), i18next.t('common:Experiment.timeInSeconds'), 'MP')
    });
}

function destroyChart(chartName) {
    if (combatCharts[chartName]) {
        combatCharts[chartName].destroy();
        combatCharts[chartName] = null;
    }
}

function getChartOptions(title, xLabel, yLabel) {
    return {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
            legend: {
                display: true,
                position: 'top',
                labels: {
                    color: '#eee',
                    font: {
                        size: 11
                    }
                }
            },
            title: {
                display: true,
                text: title,
                color: '#eee',
                font: {
                    size: 14
                }
            }
        },
        scales: {
            x: {
                display: true,
                title: {
                    display: true,
                    text: xLabel,
                    color: '#eee'
                },
                ticks: {
                    color: '#ccc',
                    maxTicksLimit: 10
                },
                grid: {
                    color: 'rgba(255, 255, 255, 0.1)'
                }
            },
            y: {
                display: true,
                title: {
                    display: true,
                    text: yLabel,
                    color: '#eee'
                },
                ticks: {
                    color: '#ccc'
                },
                grid: {
                    color: 'rgba(255, 255, 255, 0.1)'
                }
            }
        },
        interaction: {
            intersect: false,
            mode: 'index'
        }
    };
}

// 初始化实时图表（用于模拟过程中更新）
function initializeRealtimeCharts() {
    // 销毁现有图表
    destroyChart('hpChart');
    destroyChart('mpChart');
    
    const hpCanvas = document.getElementById('hpChart');
    const mpCanvas = document.getElementById('mpChart');
    
    if (!hpCanvas || !mpCanvas) {
        console.warn('图表canvas元素未找到');
        return;
    }
    
    // 显示等待状态
    const emptyOptions = {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
            legend: { display: false },
            title: {
                display: true,
                text: i18next.t('common:Experiment.waitingForData'),
                color: '#888',
                font: { size: 14 }
            }
        },
        scales: {
            x: {
                display: true,
                ticks: { color: '#555' },
                grid: { color: 'rgba(255, 255, 255, 0.05)' }
            },
            y: {
                display: true,
                ticks: { color: '#555' },
                grid: { color: 'rgba(255, 255, 255, 0.05)' }
            }
        }
    };
    
    try {
        combatCharts.hpChart = new Chart(hpCanvas, {
            type: 'line',
            data: { labels: [], datasets: [] },
            options: emptyOptions
        });
        
        combatCharts.mpChart = new Chart(mpCanvas, {
            type: 'line',
            data: { labels: [], datasets: [] },
            options: emptyOptions
        });
    } catch (e) {
        console.error('创建图表时出错:', e);
    }
}

// 显示空图表状态
function showEmptyCharts() {
    initializeRealtimeCharts();
}

// 初始化HP/MP可视化开关事件
function initHpMpVisualization() {
    const toggle = document.getElementById('hpMpVisualizationToggle');
    const container = document.getElementById('combatChartsContainer');

    const enableHpMpVisualization = localStorage.getItem('enableHpMpVisualization');
    if (enableHpMpVisualization === 'true') {
        toggle.checked = true;
        container.classList.remove('d-none');
        showEmptyCharts();
    }
    
    if (toggle && container) {
        toggle.addEventListener('change', function() {
            if (this.checked) {
                container.classList.remove('d-none');
                showEmptyCharts();
            } else {
                container.classList.add('d-none');
                destroyChart('hpChart');
                destroyChart('mpChart');
            }
            localStorage.setItem('enableHpMpVisualization', this.checked);
        });
    }
}

// #endregion

function manipulateSimResultsDataForDisplay(simResults) {
    let displaySimResults = [];
    for (let i = 0; i < simResults.length; i++) {
        for (let j = 0; j < selectedPlayers.length; j++) {
            let playerToDisplay = "player" + selectedPlayers[j].toString();
            let simResult = simResults[i];
            let hoursSimulated = simResult.simulatedTime / ONE_HOUR;
            let zoneName = simResult.zoneName;
            let difficultyTier = simResult.difficultyTier;
            let encountersPerHour = (simResult.encounters / hoursSimulated).toFixed(1);
            let playerDeaths = simResult.deaths[playerToDisplay] ?? 0;
            let deathsPerHour = (playerDeaths / hoursSimulated).toFixed(2);

            let totalExperience = 0;
            if (simResult.experienceGained[playerToDisplay]) {
                totalExperience = Object.values(simResult.experienceGained[playerToDisplay]).reduce((prev, cur) => prev + cur, 0);
            }
            let totalExperiencePerHour = (totalExperience / hoursSimulated).toFixed(0);

            let experiencePerHour = {};
            const skills = ["Stamina", "Intelligence", "Attack", "Melee", "Defense", "Ranged", "Magic"];
            skills.forEach((skill) => {
                const skillLower = skill.toLowerCase();
                let experience = simResult.experienceGained[playerToDisplay]?.[skillLower] ?? 0;
                let experiencePerHourValue = 0;
                if (experience != 0) {
                    experiencePerHourValue = (experience / hoursSimulated).toFixed(0);
                }
                experiencePerHour[skill] = experiencePerHourValue;
            });
            getDropProfit(simResult, playerToDisplay);
            let noRngRevenue = simResult["noRngRevenue"];
            let noRngProfit = simResult["noRngProfit"];
            let expenses = simResult["expenses"];

            let displaySimRow = {
                "ZoneName": zoneName, "DifficultyTier": difficultyTier, "Player": playerToDisplay, "Encounters": encountersPerHour, "Deaths": deathsPerHour,
                "TotalExperience": totalExperiencePerHour, "Stamina": experiencePerHour["Stamina"],
                "Intelligence": experiencePerHour["Intelligence"], "Attack": experiencePerHour["Attack"],
                "Magic": experiencePerHour["Magic"], "Ranged": experiencePerHour["Ranged"],
                "Melee": experiencePerHour["Melee"], "Defense": experiencePerHour["Defense"],
                "noRngRevenue": noRngRevenue,
                "expenses": expenses,
                "noRngProfit": noRngProfit
            };
            displaySimResults.push(displaySimRow);
        }
    }
    return displaySimResults;
}

function fidDropAmount(dropAmount) {
  if (Number.isInteger(dropAmount)) return dropAmount;

  const intPart   = Math.floor(dropAmount);
  const fracPart  = dropAmount - intPart;
  return Math.random() < fracPart ? intPart + 1 : intPart;
}

function calcDropMaps(simResult, playerToDisplay) {
    const preferredId = String(playerToDisplay ?? currentPlayerTabId).replace("player", "");
    const resolvedPlayerToDisplay = resolveSimResultPlayerHrid(simResult, preferredId) ?? playerToDisplay ?? "player1";

    let dropRateMultiplier = toFiniteNumber(simResult.dropRateMultiplier?.[resolvedPlayerToDisplay], 1);
    let rareFindMultiplier = toFiniteNumber(simResult.rareFindMultiplier?.[resolvedPlayerToDisplay], 1);
    let combatDropQuantity = toFiniteNumber(simResult.combatDropQuantity?.[resolvedPlayerToDisplay], 0);
    let debuffOnLevelGap = toFiniteNumber(simResult.debuffOnLevelGap?.[resolvedPlayerToDisplay], 0);

    let numberOfPlayers = Math.max(1, toFiniteNumber(simResult.numberOfPlayers, 1));
    let monsters = Object.keys(simResult.deaths ?? {})
        .filter(enemy => enemy !== "player1" && enemy !== "player2" && enemy !== "player3" && enemy !== "player4" && enemy !== "player5")
        .sort();

    const totalDropMap = new Map();
    const noRngTotalDropMap = new Map();
    for (const monster of monsters) {
        const deathsCount = Math.max(0, Math.floor(toFiniteNumber(simResult.deaths?.[monster], 0)));
        if (deathsCount <= 0) {
            continue;
        }
        const dropMap = new Map();
        const rareDropMap = new Map();
        if (combatMonsterDetailMap[monster].dropTable) {
            for (const drop of combatMonsterDetailMap[monster].dropTable) {
                const difficultyTier = toFiniteNumber(simResult.difficultyTier, 0);
                if (drop.minDifficultyTier > difficultyTier) {
                    continue;
                }

                let multiplier = 1.0 + 0.1 * difficultyTier;
                let dropRate = Math.min(1.0, multiplier * (toFiniteNumber(drop.dropRate, 0) + toFiniteNumber(drop.dropRatePerDifficultyTier, 0) * difficultyTier));
                if (dropRate <= 0) continue;

                dropMap.set(drop.itemHrid, { "dropRate": Math.min(1.0, dropRate * dropRateMultiplier), "number": 0, "dropMin": drop.minCount, "dropMax": drop.maxCount, "noRngDropAmount": 0 });
            }
            if (combatMonsterDetailMap[monster].rareDropTable)
                for (const drop of combatMonsterDetailMap[monster].rareDropTable) {
                    const difficultyTier = toFiniteNumber(simResult.difficultyTier, 0);
                    if (drop.minDifficultyTier > difficultyTier) {
                        continue;
                    }
                    rareDropMap.set(drop.itemHrid, { "dropRate": toFiniteNumber(drop.dropRate, 0) * rareFindMultiplier, "number": 0, "dropMin": drop.minCount, "dropMax": drop.maxCount, "noRngDropAmount": 0 });
                }

            for (let dropObject of dropMap.values()) {
                const dropMidAmount = (toFiniteNumber(dropObject.dropMax, 0) + toFiniteNumber(dropObject.dropMin, 0)) / 2;
                dropObject.noRngDropAmount += deathsCount * toFiniteNumber(dropObject.dropRate, 0) * dropMidAmount * (1 + debuffOnLevelGap) * (1 + combatDropQuantity) / numberOfPlayers;

            }
            for (let dropObject of rareDropMap.values()) {
                const dropMidAmount = (toFiniteNumber(dropObject.dropMax, 0) + toFiniteNumber(dropObject.dropMin, 0)) / 2;
                dropObject.noRngDropAmount += deathsCount * toFiniteNumber(dropObject.dropRate, 0) * dropMidAmount * (1 + debuffOnLevelGap) * (1 + combatDropQuantity) / numberOfPlayers;
            }

            for (let i = 0; i < deathsCount; i++) {
                for (let dropObject of dropMap.values()) {
                    let chance = Math.random();
                    if (chance <= dropObject.dropRate / numberOfPlayers) {
                        let amount = Math.floor(Math.random() * (toFiniteNumber(dropObject.dropMax, 0) - toFiniteNumber(dropObject.dropMin, 0) + 1) + toFiniteNumber(dropObject.dropMin, 0)) * (1 + debuffOnLevelGap) * (1 + combatDropQuantity);
                        dropObject.number = dropObject.number + fidDropAmount(amount);
                    }
                }
                for (let dropObject of rareDropMap.values()) {
                    let chance = Math.random();
                    if (chance <= dropObject.dropRate / numberOfPlayers) {
                        let amount = Math.floor(Math.random() * (toFiniteNumber(dropObject.dropMax, 0) - toFiniteNumber(dropObject.dropMin, 0) + 1) + toFiniteNumber(dropObject.dropMin, 0)) * (1 + debuffOnLevelGap) * (1 + combatDropQuantity);
                        dropObject.number = dropObject.number + fidDropAmount(amount);
                    }
                }
            }
            for (let [name, dropObject] of dropMap.entries()) {
                if (totalDropMap.has(name)) {
                    totalDropMap.set(name, totalDropMap.get(name) + dropObject.number);
                } else {
                    totalDropMap.set(name, dropObject.number);
                }
                if (noRngTotalDropMap.has(name)) {
                    noRngTotalDropMap.set(name, noRngTotalDropMap.get(name) + dropObject.noRngDropAmount);
                } else {
                    noRngTotalDropMap.set(name, dropObject.noRngDropAmount);
                }
            }
            for (let [name, dropObject] of rareDropMap.entries()) {
                if (totalDropMap.has(name)) {
                    totalDropMap.set(name, totalDropMap.get(name) + dropObject.number);
                } else {
                    totalDropMap.set(name, dropObject.number);
                }
                if (noRngTotalDropMap.has(name)) {
                    noRngTotalDropMap.set(name, noRngTotalDropMap.get(name) + dropObject.noRngDropAmount);
                } else {
                    noRngTotalDropMap.set(name, dropObject.noRngDropAmount);
                }
            }
        }
    }

    return { totalDropMap, noRngTotalDropMap };
}

function getProfitDropMaps(simResult, playerToDisplay) {
    const preferredId = String(playerToDisplay ?? currentPlayerTabId).replace("player", "");
    const resolvedPlayerToDisplay = resolveSimResultPlayerHrid(simResult, preferredId) ?? playerToDisplay ?? "player1";

    if (simResult?.isDungeon) {
        return {
            playerToDisplay: resolvedPlayerToDisplay,
            totalDropMap: new Map(),
            noRngTotalDropMap: new Map(),
        };
    }

    if (!simResult.__profitDropMapsCache) {
        simResult.__profitDropMapsCache = {};
    }

    const cached = simResult.__profitDropMapsCache[resolvedPlayerToDisplay];
    if (cached) {
        return {
            playerToDisplay: resolvedPlayerToDisplay,
            totalDropMap: new Map(cached.totalDropEntries),
            noRngTotalDropMap: new Map(cached.noRngTotalDropEntries),
        };
    }

    const computed = calcDropMaps(simResult, resolvedPlayerToDisplay);
    simResult.__profitDropMapsCache[resolvedPlayerToDisplay] = {
        totalDropEntries: Array.from(computed.totalDropMap.entries()),
        noRngTotalDropEntries: Array.from(computed.noRngTotalDropMap.entries()),
    };

    return {
        playerToDisplay: resolvedPlayerToDisplay,
        totalDropMap: new Map(computed.totalDropMap),
        noRngTotalDropMap: new Map(computed.noRngTotalDropMap),
    };
}

function getDropProfit(simResult, playerToDisplay) {
    let { totalDropMap, noRngTotalDropMap, playerToDisplay: resolvedPlayerToDisplay } = getProfitDropMaps(simResult, playerToDisplay);

    let noRngTotal = 0;
    for (let [name, dropAmount] of noRngTotalDropMap.entries()) {
        let price = -1;
        let revenueSetting = document.getElementById('selectPrices_drops').value;
        if (window.prices) {
            let item = window.prices[name];
            if (item) {
                if (revenueSetting == 'bid') {
                    if (item['bid'] !== -1) {
                        price = item['bid'];
                    } else if (item['ask'] !== -1) {
                        price = item['ask'];
                    }
                } else if (revenueSetting == 'ask') {
                    if (item['ask'] !== -1) {
                        price = item['ask'];
                    } else if (item['bid'] !== -1) {
                        price = item['bid'];
                    }
                }
                if (price == -1) {
                    price = item['vendor'];
                }
            }
        }
        noRngTotal += price * dropAmount;
    }

    let consumablesUsed = simResult.consumablesUsed?.[resolvedPlayerToDisplay];

    if (consumablesUsed) {
        consumablesUsed = Object.entries(consumablesUsed).sort((a, b) => b[1] - a[1]);
    } else {
        consumablesUsed = [];
    }

    let expenses = 0;
    for (const [consumable, amount] of consumablesUsed) {
        let price = -1;
        let expensesSetting = document.getElementById('selectPrices_consumables').value;
        if (window.prices) {
            let item = window.prices[consumable];
            if (item) {
                if (expensesSetting == 'bid') {
                    if (item['bid'] !== -1) {
                        price = item['bid'];
                    } else if (item['ask'] !== -1) {
                        price = item['ask'];
                    }
                } else if (expensesSetting == 'ask') {
                    if (item['ask'] !== -1) {
                        price = item['ask'];
                    } else if (item['bid'] !== -1) {
                        price = item['bid'];
                    }
                }
                if (price == -1) {
                    price = item['vendor'];
                }
            }
        }
        expenses += price * amount;
    }

    simResult["noRngRevenue"] = (noRngTotal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    simResult["expenses"] = (expenses).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    simResult["noRngProfit"] = (noRngTotal - expenses).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function updateAllSimsModal(data) {
    const tableBody = document.getElementById('allZonesData').getElementsByTagName('tbody')[0];
    tableBody.innerHTML = '';
    data.forEach(item => {
        const row = document.createElement('tr');

        Object.keys(item).forEach(key => {
            const cell = document.createElement('td');
            cell.textContent = item[key];
            if (key === 'ZoneName') {
                cell.setAttribute("data-i18n", "actionNames." + item[key]);
            }
            row.appendChild(cell);
        });

        tableBody.appendChild(row);
    });

    const table = document.getElementById('allZonesData');
    const rows = table.getElementsByTagName('tr');
    const numCols = rows[0].cells.length;

    // 遍历每一列
    for (let col = 5; col < numCols; col++) {
        let max = -Infinity;
        let maxCell = null;

        // 找到最大值及其单元格
        for (let row = 1; row < rows.length; row++) {
            const cell = rows[row].cells[col];
            const value = parseFloat(cell.textContent.replace(/,/g, ''));
            if (value > max) {
                max = value;
                maxCell = cell;
            }
        }

        // 将最大值单元格的背景色设置为绿色
        if (maxCell && max != 0) {
            maxCell.style.backgroundColor = 'green';
            maxCell.style.color = 'white'; // 设置文字颜色为白色以提高可读性
        }
    }
}

let currentSortColumn = null;
let currentSortDirection = 'desc';

function sortTable(tableId, columnIndex, direction) {
    const table = document.getElementById(tableId);
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));

    const sortedRows = rows.sort((rowA, rowB) => {
        const cellA = rowA.children[columnIndex].textContent.trim().replace(/[\s,]/g, '');
        const cellB = rowB.children[columnIndex].textContent.trim().replace(/[\s,]/g, '');

        const valueA = parseFloat(cellA.replace(/,/g, ''));
        const valueB = parseFloat(cellB.replace(/,/g, ''));

        return direction === 'asc' ? valueA - valueB : valueB - valueA;
    });

    sortedRows.forEach(row => tbody.appendChild(row));
    updateSortIndicators(tableId, columnIndex, direction);
}

function updateSortIndicators(tableId, columnIndex, direction) {
    const headers = document.querySelectorAll(`#${tableId} th`);
    headers.forEach((header, index) => {
        header.classList.remove('sort-asc', 'sort-desc');
        if (index === columnIndex) {
            header.classList.add(direction === 'asc' ? 'sort-asc' : 'sort-desc');
        }
    });
}

document.querySelectorAll('#allZonesData th').forEach((header, index) => {
    if (index === 0) return;
    if (index === 1) return;
    if (index === 2) return;

    header.addEventListener('click', () => {
        if (currentSortColumn === index) {
            currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            currentSortColumn = index;
            currentSortDirection = 'desc';
        }
        sortTable('allZonesData', currentSortColumn, currentSortDirection);
    });
});

document.getElementById('buttonExportResults').addEventListener('click', function () {
    var table = document.getElementById('allZonesData');
    var csv = [];
    var rows = table.querySelectorAll('tr');

    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var cols = row.querySelectorAll('th, td');
        var csvRow = [];

        cols.forEach(function (col) {
            csvRow.push('"' + col.innerText.replace(/"/g, '""') + '"');
        });

        csv.push(csvRow.join(','));
    }

    var csvFile = new Blob([csv.join('\n')], { type: 'text/csv' });
    var downloadLink = document.createElement('a');
    downloadLink.download = 'simData.csv';
    downloadLink.href = URL.createObjectURL(csvFile);
    downloadLink.style.display = 'none';
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
});

function showKills(simResult, playerToDisplay) {
    let resultDiv = document.getElementById("simulationResultKills");
    let dropsResultDiv = document.getElementById("simulationResultDrops");
    let noRngDropsResultDiv = document.getElementById("noRngDrops");
    let newChildren = [];
    let newDropChildren = [];
    let newNoRngDropChildren = [];

    let hoursSimulated = simResult.simulatedTime / ONE_HOUR;
    let encountersPerHour = 0;
    let encountersRow = null;
    if (simResult.isDungeon) {
        let wavesCompletedRow = createRow(["col-md-6", "col-md-6 text-end"], ["Max Wave Reached", simResult.maxWaveReached]);
        wavesCompletedRow.firstElementChild.setAttribute("data-i18n", "common:simulationResults.maxWaveReached");
        newChildren.push(wavesCompletedRow);
        let completedDungeonsRow = createRow(["col-md-6", "col-md-6 text-end"], ["Completed Dungeons", simResult.dungeonsCompleted]);
        completedDungeonsRow.firstElementChild.setAttribute("data-i18n", "common:simulationResults.dungeonsCompleted");
        newChildren.push(completedDungeonsRow);
        if (simResult.dungeonsFailed > 0) {
            let failedDungeonsRow = createRow(["col-md-6", "col-md-6 text-end"], ["Failed Dungeons", simResult.dungeonsFailed]);
            failedDungeonsRow.firstElementChild.setAttribute("data-i18n", "common:simulationResults.dungeonsFailed");
            newChildren.push(failedDungeonsRow);
        }
        // 使用最后一轮完成时间来计算平均时间，避免未完成轮次的时间被计入
        let dungeonHoursSimulated = simResult.lastDungeonFinishTime > 0 
            ? simResult.lastDungeonFinishTime / ONE_HOUR 
            : hoursSimulated;
        encountersPerHour = (simResult.dungeonsCompleted / dungeonHoursSimulated).toFixed(1);
        let averageTime = (dungeonHoursSimulated * 60 / simResult.dungeonsCompleted).toFixed(1);
        encountersRow = createRow(["col-md-6", "col-md-6 text-end"], ["Average Time", averageTime]);
        encountersRow.firstElementChild.setAttribute("data-i18n", "common:simulationResults.averageTime");
        if (simResult.minDungenonTime > 0) {
            let minimumTime = (simResult.minDungenonTime / ONE_SECOND / 60).toFixed(1);
            let minimumTimeRow = createRow(["col-md-6", "col-md-6 text-end"], ["Minimum Time", minimumTime]);
            minimumTimeRow.firstElementChild.setAttribute("data-i18n", "common:simulationResults.minimumTime");
            newChildren.push(minimumTimeRow);
        }
    } else {
        // 使用最后一场战斗完成时间来计算，避免未完成战斗的时间被计入
        let encounterHoursSimulated = simResult.lastEncounterFinishTime > 0 
            ? simResult.lastEncounterFinishTime / ONE_HOUR 
            : hoursSimulated;
        encountersPerHour = (simResult.encounters / encounterHoursSimulated).toFixed(1);
        encountersRow = createRow(["col-md-6", "col-md-6 text-end"], ["Encounters", encountersPerHour]);
        encountersRow.firstElementChild.setAttribute("data-i18n", "common:simulationResults.encounters");
    }

    if (simResult.maxEnrageStack > 0) {
        let enrageRow = createRow(["col-md-6", "col-md-6 text-end"], ["Max Enrage Stack", simResult.maxEnrageStack]);
        enrageRow.firstElementChild.setAttribute("data-i18n", "common:simulationResults.maxEnrageStack");
        newChildren.push(enrageRow);
    }

    if (simResult.debuffOnLevelGap[playerToDisplay] != 0) {
        let debuffOnLevelGapRow = createRow(["col-md-6", "col-md-6 text-end"], ["Debuff on Level Gap", (simResult.debuffOnLevelGap[playerToDisplay] * 100).toFixed(1) + "%"]);
        debuffOnLevelGapRow.firstElementChild.setAttribute("data-i18n", "common:simulationResults.debuffOnLevelGap");
        newChildren.push(debuffOnLevelGapRow);
    }

    newChildren.push(encountersRow);

    Object.keys(simResult.deaths)
        .filter(enemy => enemy !== "player1" && enemy !== "player2" && enemy !== "player3" && enemy !== "player4" && enemy !== "player5")
        .sort()
        .forEach(monster => {
            let killsPerHour = (simResult.deaths[monster] / hoursSimulated).toFixed(1);
            let monsterRow = createRow(
                ["col-md-6", "col-md-6 text-end"],
                [combatMonsterDetailMap[monster].name, killsPerHour]
            );
            monsterRow.firstElementChild.setAttribute("data-i18n", "monsterNames." + monster);
            newChildren.push(monsterRow);
        });

    let { totalDropMap, noRngTotalDropMap } = getProfitDropMaps(simResult, playerToDisplay);

    let revenueModalTable = document.querySelector("#revenueTable > tbody");
    let total = 0;
    for (let [name, dropAmount] of totalDropMap.entries()) {
        let dropRow = createRow(
            ["col-md-6", "col-md-6 text-end"],
            [name, dropAmount.toLocaleString()]
        );
        dropRow.firstElementChild.setAttribute("data-i18n", "itemNames." + name);
        newDropChildren.push(dropRow);

        let tableRow = '<tr class="' + name.replace(/\s+/g, '') + '"><td data-i18n="itemNames.';
        tableRow += name;
        tableRow += '"></td><td contenteditable="true">';
        let price = -1;
        let revenueSetting = document.getElementById('selectPrices_drops').value;
        if (window.prices) {
            let item = window.prices[name];
            if (item) {
                if (revenueSetting == 'bid') {
                    if (item['bid'] !== -1) {
                        price = item['bid'];
                    } else if (item['ask'] !== -1) {
                        price = item['ask'];
                    }
                } else if (revenueSetting == 'ask') {
                    if (item['ask'] !== -1) {
                        price = item['ask'];
                    } else if (item['bid'] !== -1) {
                        price = item['bid'];
                    }
                }
                if (price == -1) {
                    price = item['vendor'];
                }
            }
        }
        tableRow += price;
        tableRow += '</td><td>';
        tableRow += dropAmount;
        tableRow += '</td><td>';
        tableRow += price * dropAmount;
        tableRow += '</td></tr>';
        revenueModalTable.innerHTML += tableRow;
        total += price * dropAmount;
    }



    let noRngRevenueModalTable = document.querySelector("#noRngRevenueTable > tbody");
    let noRngTotal = 0;
    for (let [name, dropAmount] of noRngTotalDropMap.entries()) {
        let noRngDropRow = createRow(
            ["col-md-6", "col-md-6 text-end"],
            [name, dropAmount.toLocaleString()]
        );
        noRngDropRow.firstElementChild.setAttribute("data-i18n", "itemNames." + name);
        newNoRngDropChildren.push(noRngDropRow);

        let tableRow = '<tr class="' + name.replace(/\s+/g, '') + '"><td data-i18n="itemNames.';
        tableRow += name;
        tableRow += '"></td><td contenteditable="true">';
        let price = -1;
        let revenueSetting = document.getElementById('selectPrices_drops').value;
        if (window.prices) {
            let item = window.prices[name];
            if (item) {
                if (revenueSetting == 'bid') {
                    if (item['bid'] !== -1) {
                        price = item['bid'];
                    } else if (item['ask'] !== -1) {
                        price = item['ask'];
                    }
                } else if (revenueSetting == 'ask') {
                    if (item['ask'] !== -1) {
                        price = item['ask'];
                    } else if (item['bid'] !== -1) {
                        price = item['bid'];
                    }
                }
                if (price == -1) {
                    price = item['vendor'];
                }
            }
        }
        tableRow += price;
        tableRow += '</td><td>';
        tableRow += dropAmount;
        tableRow += '</td><td>';
        tableRow += price * dropAmount;
        tableRow += '</td></tr>';
        noRngRevenueModalTable.innerHTML += tableRow;
        noRngTotal += price * dropAmount;
    }

    document.getElementById('revenueSpan').innerText = total.toLocaleString();
    window.revenue = total;
    document.getElementById('noRngRevenueSpan').innerText = noRngTotal.toLocaleString();
    window.noRngRevenue = noRngTotal;

    let resultAccordion = document.getElementById("noRngDropsAccordion");
    showElement(resultAccordion);

    resultDiv.replaceChildren(...newChildren);
    dropsResultDiv.replaceChildren(...newDropChildren);
    noRngDropsResultDiv.replaceChildren(...newNoRngDropChildren);
}

function showDeaths(simResult, playerToDisplay) {
    let resultDiv = document.getElementById("simulationResultPlayerDeaths");

    let hoursSimulated = simResult.simulatedTime / ONE_HOUR;
    let playerDeaths = simResult.deaths[playerToDisplay] ?? 0;
    let deathsPerHour = (playerDeaths / hoursSimulated).toFixed(2);

    let deathRow = createRow(["col-md-6", "col-md-6 text-end"], ["Player", deathsPerHour]);
    deathRow.firstElementChild.setAttribute("data-i18n", "common:player");
    resultDiv.replaceChildren(deathRow);
}

function showExperienceGained(simResult, playerToDisplay) {
    let resultDiv = document.getElementById("simulationResultExperienceGain");
    let newChildren = [];

    let hoursSimulated = simResult.simulatedTime / ONE_HOUR;

    let totalExperience = 0;
    if (simResult.experienceGained[playerToDisplay]) {
        totalExperience = Object.values(simResult.experienceGained[playerToDisplay]).reduce((prev, cur) => prev + cur, 0);
    }
    let totalExperiencePerHour = (totalExperience / hoursSimulated).toFixed(0);
    let totalRow = createRow(["col-md-6", "col-md-6 text-end"], ["Total", totalExperiencePerHour]);
    totalRow.firstElementChild.setAttribute("data-i18n", "common:total");
    newChildren.push(totalRow);

    ["Stamina", "Intelligence", "Attack", "Melee", "Defense", "Ranged", "Magic"].forEach((skill) => {
        let experience = simResult.experienceGained[playerToDisplay]?.[skill.toLowerCase()] ?? 0;
        if (experience == 0) {
            return;
        }
        let experiencePerHour = (experience / hoursSimulated).toFixed(0);
        let experienceRow = createRow(["col-md-6", "col-md-6 text-end"], [skill, experiencePerHour]);
        experienceRow.firstElementChild.setAttribute("data-i18n", "leaderboardCategoryNames." + skill.toLowerCase());
        newChildren.push(experienceRow);
    });

    resultDiv.replaceChildren(...newChildren);
}

function showHpSpent(simResult, playerToDisplay) {
    let hpSpentHeadingDiv = document.getElementById("simulationHpSpentHeading");
    hpSpentHeadingDiv.classList.add("d-none");
    let hpSpentDiv = document.getElementById("simulationHpSpent");
    hpSpentDiv.classList.add("d-none");

    if (simResult.hitpointsSpent[playerToDisplay]) {
        let hoursSimulated = simResult.simulatedTime / ONE_HOUR;
        let hpSpentSources = [];
        for (const source of Object.keys(simResult.hitpointsSpent[playerToDisplay])) {
            let hpSpentPerHour = (simResult.hitpointsSpent[playerToDisplay][source] / hoursSimulated).toFixed(2);
            let hpSpentRow = createRow(["col-md-6", "col-md-6 text-end"], [abilityDetailMap[source].name, hpSpentPerHour]);
            hpSpentRow.firstElementChild.setAttribute("data-i18n", "abilityNames." + source);
            hpSpentSources.push(hpSpentRow);
        }
        hpSpentDiv.replaceChildren(...hpSpentSources);
        hpSpentHeadingDiv.classList.remove("d-none");
        hpSpentDiv.classList.remove("d-none");
    }
}

function showConsumablesUsed(simResult, playerToDisplay) {
    let resultDiv = document.getElementById("simulationResultConsumablesUsed");
    let newChildren = [];

    let hoursSimulated = simResult.simulatedTime / ONE_HOUR;

    if (!simResult.consumablesUsed[playerToDisplay]) {
        resultDiv.replaceChildren(...newChildren);
        window.expenses = 0;
        return;
    }

    let consumablesUsed = Object.entries(simResult.consumablesUsed[playerToDisplay]).sort((a, b) => b[1] - a[1]);

    let expensesModalTable = document.querySelector("#expensesTable > tbody");
    let total = 0;
    for (const [consumable, amount] of consumablesUsed) {
        let consumablesPerHour = (amount / hoursSimulated).toFixed(0);
        let consumableRow = createRow(
            ["col-md-6", "col-md-6 text-end"],
            [itemDetailMap[consumable].name, consumablesPerHour]
        );
        consumableRow.firstElementChild.setAttribute("data-i18n", "itemNames." + consumable);
        newChildren.push(consumableRow);

        let tableRow = '<tr class="' + consumable + '"><td data-i18n="itemNames.';
        tableRow += consumable;
        tableRow += '"></td><td contenteditable="true">';
        let price = -1;
        let expensesSetting = document.getElementById('selectPrices_consumables').value;
        if (window.prices) {
            let item = window.prices[consumable];
            if (item) {
                if (expensesSetting == 'bid') {
                    if (item['bid'] !== -1) {
                        price = item['bid'];
                    } else if (item['ask'] !== -1) {
                        price = item['ask'];
                    }
                } else if (expensesSetting == 'ask') {
                    if (item['ask'] !== -1) {
                        price = item['ask'];
                    } else if (item['bid'] !== -1) {
                        price = item['bid'];
                    }
                }
                if (price == -1) {
                    price = item['vendor'];
                }
            }
        }
        tableRow += price;
        tableRow += '</td><td>';
        tableRow += amount;
        tableRow += '</td><td>';
        tableRow += price * amount;
        tableRow += '</td></tr>';
        expensesModalTable.innerHTML += tableRow;
        total += price * amount;
    }

    document.getElementById('expensesSpan').innerText = total.toLocaleString();
    window.expenses = total;

    resultDiv.replaceChildren(...newChildren);
}

function showManaUsed(simResult, playerToDisplay) {
    let resultDiv = document.getElementById("simulationResultManaUsed");
    let newChildren = [];

    let hoursSimulated = simResult.simulatedTime / ONE_HOUR;

    if (!simResult.manaUsed || !simResult.manaUsed[playerToDisplay]) {
        resultDiv.replaceChildren(...newChildren);
        return;
    }

    let playerManaUsed = simResult.manaUsed[playerToDisplay];

    for (let ability in playerManaUsed) {
        let manaUsed = playerManaUsed[ability];
        let manaPerHour = (manaUsed / hoursSimulated).toFixed(0);
        let castsPerHour = (manaPerHour / abilityDetailMap[ability].manaCost).toFixed(2);
        castsPerHour = " (" + castsPerHour + ")";

        let manaRow = createRow(
            ["col-md-6", "col-md-2", "col-md-4 text-end"],
            [ability.split("/")[2].replaceAll("_", " "), castsPerHour, manaPerHour]
        );
        manaRow.firstElementChild.setAttribute("data-i18n", "abilityNames." + ability);
        newChildren.push(manaRow);
    }

    resultDiv.replaceChildren(...newChildren);
}

function showHitpointsGained(simResult, playerToDisplay) {
    let resultDiv = document.getElementById("simulationResultHealthRestored");
    let newChildren = [];

    let secondsSimulated = simResult.simulatedTime / ONE_SECOND;

    if (!simResult.hitpointsGained[playerToDisplay]) {
        resultDiv.replaceChildren(...newChildren);
        return;
    }

    let hitpointsGained = Object.entries(simResult.hitpointsGained[playerToDisplay]).sort((a, b) => b[1] - a[1]);

    let totalHitpointsGained = hitpointsGained.reduce((prev, cur) => prev + cur[1], 0);
    let totalHitpointsPerSecond = (totalHitpointsGained / secondsSimulated).toFixed(2);
    let totalRow = createRow(
        ["col-md-6", "col-md-3 text-end", "col-md-3 text-end"],
        ["Total", totalHitpointsPerSecond, "100%"]
    );
    totalRow.firstElementChild.setAttribute("data-i18n", "common:total");
    newChildren.push(totalRow);

    for (const [source, amount] of hitpointsGained) {
        if (amount == 0) {
            continue;
        }

        let sourceText;
        let sourceFullHrid;
        switch (source) {
            case "regen":
                sourceText = "Regen";
                sourceFullHrid = "combatStats.hpRegenPer10";
                break;
            case "lifesteal":
                sourceText = "Life Steal";
                sourceFullHrid = "combatStats.lifeSteal";
                break;
            case "bloom":
                sourceText = "Bloom";
                sourceFullHrid = "combatStats.bloom";
                break;
            default:
                if (itemDetailMap[source]) {
                    sourceText = itemDetailMap[source].name;
                    sourceFullHrid = "itemNames." + source;
                } else if (abilityDetailMap[source]) {
                    sourceText = abilityDetailMap[source].name;
                    sourceFullHrid = "abilityNames." + source;
                }
                break;
        }
        let hitpointsPerSecond = (amount / secondsSimulated).toFixed(2);
        let percentage = ((100 * amount) / totalHitpointsGained).toFixed(0);

        let row = createRow(
            ["col-md-6", "col-md-3 text-end", "col-md-3 text-end"],
            [sourceText, hitpointsPerSecond, percentage + "%"]
        );
        row.firstElementChild.setAttribute("data-i18n", sourceFullHrid);
        newChildren.push(row);
    }

    resultDiv.replaceChildren(...newChildren);
}

function showManapointsGained(simResult, playerToDisplay) {
    let resultDiv = document.getElementById("simulationResultManaRestored");
    let newChildren = [];

    let secondsSimulated = simResult.simulatedTime / ONE_SECOND;

    if (!simResult.manapointsGained[playerToDisplay]) {
        resultDiv.replaceChildren(...newChildren);
        return;
    }

    let manapointsGained = Object.entries(simResult.manapointsGained[playerToDisplay]).sort((a, b) => b[1] - a[1]);

    let totalManapointsGained = manapointsGained.reduce((prev, cur) => prev + cur[1], 0);
    let totalManapointsPerSecond = (totalManapointsGained / secondsSimulated).toFixed(2);
    let totalRow = createRow(
        ["col-md-6", "col-md-3 text-end", "col-md-3 text-end"],
        ["Total", totalManapointsPerSecond, "100%"]
    );
    totalRow.firstElementChild.setAttribute("data-i18n", "common:total");
    newChildren.push(totalRow);

    for (const [source, amount] of manapointsGained) {
        if (amount == 0) {
            continue;
        }

        let sourceText;
        let sourceFullHrid;
        switch (source) {
            case "regen":
                sourceText = "Regen";
                sourceFullHrid = "combatStats.mpRegenPer10";
                break;
            case "manaLeech":
                sourceText = "Mana Leech";
                sourceFullHrid = "combatStats.manaLeech";
                break;
            case "ripple":
                sourceText = "Ripple";
                sourceFullHrid = "combatStats.ripple";
                break;
            default:
                sourceText = itemDetailMap[source].name;
                sourceFullHrid = "itemNames." + source;
                break;
        }
        let manapointsPerSecond = (amount / secondsSimulated).toFixed(2);
        let percentage = ((100 * amount) / totalManapointsGained).toFixed(0);

        let row = createRow(
            ["col-md-6", "col-md-3 text-end", "col-md-3 text-end"],
            [sourceText, manapointsPerSecond, percentage + "%"]
        );
        row.firstElementChild.setAttribute("data-i18n", sourceFullHrid);
        newChildren.push(row);
    }

    let ranOutOfManaText = simResult.playerRanOutOfMana[playerToDisplay] ? "Yes" : "No";
    let ranOutOfManaRow = createRow(["col-md-6", "col-md-6 text-end"], ["Ran out of mana", ranOutOfManaText]);
    ranOutOfManaRow.firstElementChild.setAttribute("data-i18n", "common:simulationResults.ranOutOfMana");
    ranOutOfManaRow.lastElementChild.setAttribute("data-i18n", "common:simulationResults." + ranOutOfManaText);
    newChildren.push(ranOutOfManaRow);

    if (simResult.playerRanOutOfMana[playerToDisplay]) {
        let ranOutOfManaStat = simResult.playerRanOutOfManaTime[playerToDisplay]; // {isOutOfMana: false, startTimeForOutOfMana:0, totalTimeForOutOfMana:0};
        let totalTimeForOut = ranOutOfManaStat.totalTimeForOutOfMana + (ranOutOfManaStat.isOutOfMana ? (simResult.simulatedTime - ranOutOfManaStat.startTimeForOutOfMana) : 0);

        let ranOutOfManaStatRow = createRow(
            ["col-md-6", "col-md-6 text-end"],
            [
                "Run Out Ratio",
                (totalTimeForOut / simResult.simulatedTime * 100).toFixed(2) + "%"
            ]
        );
        ranOutOfManaStatRow.firstElementChild.setAttribute("data-i18n", "common:simulationResults.ranOutOfManaRatio");
        newChildren.push(ranOutOfManaStatRow);
    }

    resultDiv.replaceChildren(...newChildren);
}

function showDamageDone(simResult, playerToDisplay) {
    let totalDamageDone = {};
    let enemyIndex = 1;

    let totalSecondsSimulated = simResult.simulatedTime / ONE_SECOND;

    for (let i = 1; i < 64; i++) {
        let accordion = document.getElementById("simulationResultDamageDoneAccordionEnemy" + i);
        hideElement(accordion);
    }

    let bossTimeHeadingDiv = document.getElementById("simulationBossTimeHeading");
    bossTimeHeadingDiv.classList.add("d-none");
    let bossTimeDiv = document.getElementById("simulationBossTime");
    bossTimeDiv.classList.add("d-none");

    if (!simResult.attacks[playerToDisplay]) {
        return;
    }

    for (const [target, abilities] of Object.entries(simResult.attacks[playerToDisplay])) {
        let targetDamageDone = {};

        const i = simResult.timeSpentAlive.findIndex(e => e.name === target);
        let aliveSecondsSimulated = simResult.timeSpentAlive[i].timeSpentAlive / ONE_SECOND;

        for (const [ability, abilityCasts] of Object.entries(abilities)) {
            let casts = Object.values(abilityCasts).reduce((prev, cur) => prev + cur, 0);
            let misses = abilityCasts["miss"] ?? 0;
            let damage = Object.entries(abilityCasts)
                .filter((entry) => entry[0] != "miss")
                .reduce((prev, cur) => prev + Number(cur[0]) * cur[1], 0);

            targetDamageDone[ability] = {
                casts,
                misses,
                damage,
            };
            if (totalDamageDone[ability]) {
                totalDamageDone[ability].casts += casts;
                totalDamageDone[ability].misses += misses;
                totalDamageDone[ability].damage += damage;
            } else {
                totalDamageDone[ability] = {
                    casts,
                    misses,
                    damage,
                };
            }
        }

        let resultDiv = document.getElementById("simulationResultDamageDoneEnemy" + enemyIndex);
        createDamageTable(resultDiv, targetDamageDone, aliveSecondsSimulated);

        let resultAccordion = document.getElementById("simulationResultDamageDoneAccordionEnemy" + enemyIndex);
        showElement(resultAccordion);

        let resultAccordionButton = document.getElementById(
            "buttonSimulationResultDamageDoneAccordionEnemy" + enemyIndex
        );
        let targetName = combatMonsterDetailMap[target].name;
        resultAccordionButton.innerHTML = "<b><span data-i18n=\"common:simulationResults.damageDone\">Damage Done</span> (" + "<span data-i18n=\"monsterNames." + target + "\">" + targetName + "</span>" + ")</b>";

        if (simResult.bossSpawns.includes(target)) {
            let hoursSpentOnBoss = (aliveSecondsSimulated / 60 / 60).toFixed(2);
            let percentSpentOnBoss = (aliveSecondsSimulated / totalSecondsSimulated * 100).toFixed(2);

            let bossRow = createRow(["col-md-6", "col-md-6 text-end"], [targetName, hoursSpentOnBoss + "h(" + percentSpentOnBoss + "%)"]);
            bossRow.firstElementChild.setAttribute("data-i18n", "monsterNames." + target);
            bossTimeDiv.replaceChildren(bossRow);

            bossTimeHeadingDiv.classList.remove("d-none");
            bossTimeDiv.classList.remove("d-none");
        }

        enemyIndex++;
    }

    if (simResult.isDungeon) {
        let newChildren = [];
        for (const waveName of simResult.bossSpawns) {
            // waveName is something like "#15,/monsters/jackalope,/monsters/butterjerry"
            let waveNumber = waveName.split(",")[0];
            const idx = simResult.timeSpentAlive.findIndex(e => e.name === waveNumber);
            if (idx == -1 || simResult.timeSpentAlive[idx].count == 0) {
                continue;
            }
            let aliveSecondsSimulated = simResult.timeSpentAlive[idx].timeSpentAlive / ONE_SECOND / simResult.timeSpentAlive[idx].count;
            let bossRow = createRow(["col-md-6", "col-md-2", "col-md-4 text-end"], [waveNumber, simResult.timeSpentAlive[idx].count, aliveSecondsSimulated.toFixed(1) + "s"]);
            newChildren.push(bossRow);
        }
        if (newChildren.length > 0) {
            bossTimeHeadingDiv.classList.remove("d-none");
            bossTimeDiv.classList.remove("d-none");
            bossTimeDiv.replaceChildren(...newChildren);
        }
    }

    let totalResultDiv = document.getElementById("simulationResultTotalDamageDone");
    createDamageTable(totalResultDiv, totalDamageDone, totalSecondsSimulated);
}

function showDamageTaken(simResult, playerToDisplay) {
    let totalDamageTaken = {};
    let enemyIndex = 1;

    let totalSecondsSimulated = simResult.simulatedTime / ONE_SECOND;

    for (let i = 1; i < 64; i++) {
        let accordion = document.getElementById("simulationResultDamageTakenAccordionEnemy" + i);
        hideElement(accordion);
    }

    for (const [source, targets] of Object.entries(simResult.attacks)) {
        const validSources = ["player1", "player2", "player3", "player4", "player5"];
        if (validSources.includes(source)) {
            continue;
        }
        const i = simResult.timeSpentAlive.findIndex(e => e.name === source);
        let aliveSecondsSimulated = simResult.timeSpentAlive[i].timeSpentAlive / ONE_SECOND;
        let sourceDamageTaken = {};
        if (targets[playerToDisplay] && Object.keys(targets[playerToDisplay]).length > 0) {
            for (const [ability, abilityCasts] of Object.entries(targets[playerToDisplay])) {
                let casts = Object.values(abilityCasts).reduce((prev, cur) => prev + cur, 0);
                let misses = abilityCasts["miss"] ?? 0;
                let damage = Object.entries(abilityCasts)
                    .filter((entry) => entry[0] != "miss")
                    .reduce((prev, cur) => prev + Number(cur[0]) * cur[1], 0);

                sourceDamageTaken[ability] = {
                    casts,
                    misses,
                    damage,
                };
                if (totalDamageTaken[ability]) {
                    totalDamageTaken[ability].casts += casts;
                    totalDamageTaken[ability].misses += misses;
                    totalDamageTaken[ability].damage += damage;
                } else {
                    totalDamageTaken[ability] = {
                        casts,
                        misses,
                        damage,
                    };
                }
            }
        }

        let resultDiv = document.getElementById("simulationResultDamageTakenEnemy" + enemyIndex);
        createDamageTable(resultDiv, sourceDamageTaken, aliveSecondsSimulated);

        let resultAccordion = document.getElementById("simulationResultDamageTakenAccordionEnemy" + enemyIndex);
        showElement(resultAccordion);

        let resultAccordionButton = document.getElementById(
            "buttonSimulationResultDamageTakenAccordionEnemy" + enemyIndex
        );
        let sourceName = combatMonsterDetailMap[source].name;
        resultAccordionButton.innerHTML = "<b><span data-i18n=\"common:simulationResults.damageTaken\">Damage Taken</span> (" + "<span data-i18n=\"monsterNames." + source + "\">" + sourceName + "</span>" + ")</b>";

        enemyIndex++;
    }

    let totalResultDiv = document.getElementById("simulationResultTotalDamageTaken");
    createDamageTable(totalResultDiv, totalDamageTaken, totalSecondsSimulated);
}

function createDamageTable(resultDiv, damageDone, secondsSimulated) {
    let newChildren = [];

    let sortedDamageDone = Object.entries(damageDone).sort((a, b) => b[1].damage - a[1].damage);

    let totalCasts = sortedDamageDone.reduce((prev, cur) => prev + cur[1].casts, 0);
    let totalMisses = sortedDamageDone.reduce((prev, cur) => prev + cur[1].misses, 0);
    let totalDamage = sortedDamageDone.reduce((prev, cur) => prev + cur[1].damage, 0);
    let totalHitChance = ((100 * (totalCasts - totalMisses)) / totalCasts).toFixed(1);
    let totalDamagePerSecond = (totalDamage / secondsSimulated).toFixed(2);

    let totalRow = createRow(
        ["col-md-5", "col-md-3 text-end", "col-md-2 text-end", "col-md-2 text-end"],
        ["Total", totalHitChance + "%", totalDamagePerSecond, "100%"]
    );
    totalRow.firstElementChild.setAttribute("data-i18n", "common:total");
    newChildren.push(totalRow);

    for (const [ability, damageInfo] of sortedDamageDone) {
        let abilityText;
        let abilityFullHrid;
        switch (ability) {
            case "autoAttack":
                abilityText = "Auto Attack";
                abilityFullHrid = "combatUnit.autoAttack";
                break;
            case "parry":
                abilityText = "Parry Attack";
                abilityFullHrid = "common:simulationResults.parryAttack";
                break;
            case "damageOverTime":
                abilityText = "Damage Over Time";
                abilityFullHrid = "common:simulationResults.damageOverTime";
                break;
            case "physicalThorns":
                abilityText = "Physical Thorns";
                abilityFullHrid = "combatStats.physicalThorns";
                break;
            case "elementalThorns":
                abilityText = "Elemental Thorns";
                abilityFullHrid = "combatStats.elementalThorns";
                break;
            case "retaliation":
                abilityText = "Retaliation";
                abilityFullHrid = "combatStats.retaliation";
                break;
            case 'blaze':
                abilityText = "Blaze";
                abilityFullHrid = "combatStats.blaze";
                break;
            default:
                abilityText = abilityDetailMap[ability].name;
                abilityFullHrid = "abilityNames." + ability;
                break;
        }

        let hitChance = ((100 * (damageInfo.casts - damageInfo.misses)) / damageInfo.casts).toFixed(1);
        let damagePerSecond = (damageInfo.damage / secondsSimulated).toFixed(2);
        let percentage = ((100 * damageInfo.damage) / totalDamage).toFixed(0);

        let row = createRow(
            ["col-md-5", "col-md-3 text-end", "col-md-2 text-end", "col-md-2 text-end"],
            [abilityText, hitChance + "%", damagePerSecond, percentage + "%"]
        );
        row.firstElementChild.setAttribute("data-i18n", abilityFullHrid);
        newChildren.push(row);
    }

    resultDiv.replaceChildren(...newChildren);
}

function createRow(columnClassNames, columnValues) {
    let row = createElement("div", "row");

    for (let i = 0; i < columnClassNames.length; i++) {
        let column = createElement("div", columnClassNames[i], columnValues[i]);
        row.appendChild(column);
    }

    return row;
}

function createElement(tagName, className, innerHTML = "", id = "") {
    let element = document.createElement(tagName);
    element.className = className;
    element.innerHTML = innerHTML;
    if (id) element.id = id;
    return element;
}

// #endregion

// #region Simulation Controls

document.addEventListener('DOMContentLoaded', function () {
    const simDungeonToggle = document.getElementById('simDungeonToggle');
    const playerContainer = document.getElementById('playerCheckBox');

    function addPlayers() {
        const player4 = document.createElement('div');
        player4.classList.add('form-check');
        player4.innerHTML = `
            <input class="form-check-input player-checkbox" type="checkbox" id="player4">
            <label class="form-check-label" for="player4">
                Player 4
            </label>
        `;

        const player5 = document.createElement('div');
        player5.classList.add('form-check');
        player5.innerHTML = `
            <input class="form-check-input player-checkbox" type="checkbox" id="player5">
            <label class="form-check-label" for="player5">
                Player 5
            </label>
        `;

        playerContainer.appendChild(player4);
        playerContainer.appendChild(player5);
    }

    function removePlayers() {
        const player4 = document.getElementById('player4');
        const player5 = document.getElementById('player5');
        if (player4) player4.parentElement.remove();
        if (player5) player5.parentElement.remove();
    }

    function updatePlayerNames() {
        const tabLinks = document.querySelectorAll('#playerTab .nav-link');
        tabLinks.forEach((tabLink, index) => {
            const label = document.querySelector(`label[for="player${index + 1}"]`);
            if (label) {
                label.textContent = tabLink.textContent.trim();
            }
        });
    }

    function updatePlayersCheckbox(isCheck) {
        const boxes = playerContainer.querySelectorAll('.player-checkbox');
        boxes.forEach((checkBox) => { checkBox.checked = isCheck });
    }

    function updateDifficultySelect(isCheck) {
        const difficultySelect = document.getElementById('selectDifficulty');
        // disable last four option
        if (isCheck && Number(difficultySelect.value) >= 3) {
            difficultySelect.value = 0;
        }
        for (let i = 3; i < difficultySelect.options.length; i++) {
            difficultySelect.options[i].disabled = isCheck;
        }
    }

    simDungeonToggle.addEventListener('change', function () {
        if (simDungeonToggle.checked) {
            addPlayers();
            updatePlayersCheckbox(true);
            updateDifficultySelect(true);
        } else {
            removePlayers();
            updatePlayersCheckbox(false);
            updateDifficultySelect(false);
        }
        updatePlayerNames();
    });

    document.getElementById('buttonSimulationSetup').addEventListener('click', function () {
        updatePlayerNames();
    });
});

function onTabChange(event) {
    const nextPlayerTabId = event.target.getAttribute('href').substring(7);
    savePreviousPlayer(currentPlayerTabId);
    updateNextPlayer(nextPlayerTabId);
    currentPlayerTabId = nextPlayerTabId;
    updateState();
    updateUI();
    renderQueueViewsForCurrentPlayer();
    if (Object.keys(currentSimResults).length !== 0) {
        showSimulationResult(currentSimResults);
    }

    updateContent();
}

document.querySelectorAll('#playerTab .nav-link').forEach(tab => {
    tab.addEventListener('shown.bs.tab', onTabChange);
});

function initSimulationControls() {
    let simulationTimeInput = document.getElementById("inputSimulationTime");
    simulationTimeInput.value = 24;

    buttonStartSimulation.addEventListener("click", (event) => {
        let invalidElements = document.querySelectorAll(":invalid");
        if (invalidElements.length > 0) {
            invalidElements.forEach((element) => element.reportValidity());
            return;
        }
        savePreviousPlayer(currentPlayerTabId);

        const simDungeonToggle = document.getElementById("simDungeonToggle");
        const checkboxes = document.querySelectorAll('.player-checkbox');
        selectedPlayers = [];
        checkboxes.forEach(checkbox => {
            if (checkbox.checked) {
                const playerNumber = parseInt(checkbox.id.replace('player', ''));
                selectedPlayers.push(playerNumber);
            }
        });

        if (selectedPlayers.length === 0) {
            alert("You need to select at least one player to sim.");
            return;
        }
        // buttonStartSimulation.disabled = true;
        buttonStopSimulation.style.display = 'block';
        startSimulation(selectedPlayers);
    });

    buttonStopSimulation.style.display = 'none';
    buttonStopSimulation.addEventListener("click", (event) => {
        progressbar.style.width = "0%";
        progressbar.innerHTML = "0%";
        if (worker) {
            worker.terminate();
        }
        worker = new Worker(new URL("worker.js", import.meta.url));

        if (multiWorker) {
            multiWorker.terminate();
        }
        multiWorker = new Worker(new URL("multiWorker.js", import.meta.url));

        for (let worker of workerPool) {
            worker.worker.terminate();
        }

        buttonStartSimulation.disabled = false;
        buttonStopSimulation.style.display = 'none';
    });
}

function startSimulation(selectedPlayers) {
    let playersToSim = buildPlayersForSimulation(selectedPlayers);
    if (playersToSim.length === 0) {
        alert("Failed to build player simulation data.");
        return;
    }

    let extra = {};
    extra.mooPass = document.getElementById("mooPassToggle").checked;
    extra.comExp = 0;
    if (document.getElementById("comExpToggle").checked) {
        extra.comExp = Number(document.getElementById("comExpInput").value);
    }
    extra.comDrop = 0;
    if (document.getElementById("comDropToggle").checked) {
        extra.comDrop = Number(document.getElementById("comDropInput").value);
    }
    extra.enableHpMpVisualization = document.getElementById("hpMpVisualizationToggle").checked;

    let simAllZonesToggle = document.getElementById("simAllZoneToggle");
    let simAllSoloToggle = document.getElementById("simAllSoloToggle");
    let simDungeonToggle = document.getElementById("simDungeonToggle");
    let zoneSelect = document.getElementById("selectZone");
    let dungeonSelect = document.getElementById("selectDungeon");
    let difficultySelect = document.getElementById("selectDifficulty");
    let simulationTimeInput = document.getElementById("inputSimulationTime");
    let simulationTimeLimit = Number(simulationTimeInput.value) * ONE_HOUR;
    buttonStopSimulation.style.display = 'block';
    if (!simAllZonesToggle.checked && !simAllSoloToggle.checked) {
        let zoneHrid = zoneSelect.value;
        let difficultyTier = Number(difficultySelect.value);
        if (simDungeonToggle.checked) {
            zoneHrid = dungeonSelect.value;
        }
        let workerMessage = {
            type: "start_simulation",
            workerId: Math.floor(Math.random() * 1e9).toString(),
            players: playersToSim,
            zone: { zoneHrid: zoneHrid, difficultyTier: difficultyTier },
            simulationTimeLimit: simulationTimeLimit,
            extra : extra
        };
        simStartTime = Date.now();
        if (!worker) {
            worker = new Worker(new URL("multiWorker.js", import.meta.url));
        }
        worker.onmessage = onWorkerMessage;
        worker.postMessage(workerMessage);
    } else {
        let targetHrids = {};

        if (simAllZonesToggle.checked) {
            Object.values(actionDetailMap)
                .filter(a =>
                    a.type === "/action_types/combat" &&
                    a.category !== "/action_categories/combat/dungeons" &&
                    a.combatZoneInfo.fightInfo.randomSpawnInfo.maxSpawnCount > 1 &&
                    document.getElementById(a.hrid)?.checked
                )
                .forEach(a => { targetHrids[a.hrid] = a; });
        }

        if (simAllSoloToggle.checked) {
            Object.values(actionDetailMap)
                .filter(a =>
                    a.type === "/action_types/combat" &&
                    a.category !== "/action_categories/combat/dungeons" &&
                    a.combatZoneInfo.fightInfo.randomSpawnInfo.maxSpawnCount === 1 &&
                    document.getElementById(a.hrid)?.checked
                )
                .forEach(a => { targetHrids[a.hrid] = a; });
        }

        let simHrids = Object.values(targetHrids)
            .sort((a, b) => a.sortIndex - b.sortIndex)
            .map(action => {
                let result = [];
                for (let difficultyTier = 0; difficultyTier <= action.maxDifficulty; difficultyTier++) {
                    result.push({ zoneHrid: action.hrid, difficultyTier: difficultyTier });
                }
                return result;
            })
            .flat();

        let workerMessage = {
            type: "start_simulation_all_zones",
            workerId: Math.floor(Math.random() * 1e9).toString(),
            players: playersToSim,
            zones: simHrids,
            simulationTimeLimit: simulationTimeLimit,
            extra: extra
        };
        simStartTime = Date.now();
        if (!multiWorker) {
            multiWorker = new Worker(new URL("multiWorker.js", import.meta.url));
        }
        multiWorker.onmessage = onMultiWorkerMessage;
        multiWorker.postMessage(workerMessage);
    }
}

function parsePlayerJson(playerJson, hrid) {
    let playerData = {
        hrid: hrid,
        food: [],
        drinks: [],
        abilities: [],
        ...playerJson.player,
        houseRooms: playerJson.houseRooms ?? {},
        achievements: playerJson.achievements ?? {},
    };
    playerData.equipment = {};
    const triggerMap = playerJson.triggerMap ?? {};
    const playerEquipment = playerJson.player?.equipment ?? [];
    ["head", "body", "legs", "feet", "hands", "off_hand", "pouch", "neck", "earrings", "ring", "back", "main_hand", "two_hand", "charm"].forEach((type) => {
        let currentEquipment = playerEquipment.find(item => item.itemLocationHrid === "/item_locations/" + type);
        if (currentEquipment){
            playerData.equipment[`/equipment_types/${type}`] = new Equipment(currentEquipment.itemHrid, currentEquipment.enhancementLevel);
        }
    });

    for (const foodHrid of (playerJson.food?.["/action_types/combat"] ?? [])) {
        if (foodHrid.itemHrid === "") continue;
        const food = new Consumable(foodHrid.itemHrid, triggerMap[foodHrid.itemHrid]);
        playerData.food.push(food);
    }
    for (const drinkHrid of (playerJson.drinks?.["/action_types/combat"] ?? [])) {
        if (drinkHrid.itemHrid === "") continue;
        const drink = new Consumable(drinkHrid.itemHrid, triggerMap[drinkHrid.itemHrid]);
        playerData.drinks.push(drink);
    }
    for (const ability of (playerJson.abilities ?? [])) {
        if (ability.abilityHrid === "") continue;
        const abilityLevel = Number(ability.level);
        const abilityHrid = ability.abilityHrid;
        if (abilityLevel > 0) {
            const abilityObj = new Ability(abilityHrid, abilityLevel, triggerMap[abilityHrid]);
            playerData.abilities.push(abilityObj);
        }
    }
    const player = Player.createFromDTO(playerData)
    player.updateCombatDetails();
    return player;
}
// read JSON file to simulate
document.getElementById("buttonUploadJSONSimulate").addEventListener("click", (event) => {
    let extra = {};
    extra.mooPass = document.getElementById("mooPassToggle").checked;
    extra.comExp = 0;
    if (document.getElementById("comExpToggle").checked) {
        extra.comExp = Number(document.getElementById("comExpInput").value);
    }
    extra.comDrop = 0;
    if (document.getElementById("comDropToggle").checked) {
        extra.comDrop = Number(document.getElementById("comDropInput").value);
    }

    let fileInput = document.getElementById("inputUploadJSONSimulation");
    let file = fileInput.files[0];
    if (!file) {
        alert("Please select a file to upload.");
        return;
    }

    let reader = new FileReader();
    reader.onload = function (event) {
        let fileContent = event.target.result;
        const jsonDataList = JSON.parse(fileContent);
        try {
            const simDataList = [];
            for (const key in jsonDataList) {
                if (jsonDataList[key].cases) {
                    const cases = getProductCases(jsonDataList[key], jsonDataList[key].cases);
                    simDataList.push(...cases);
                } else {
                    simDataList.push(jsonDataList[key]);
                }
            }
            for (const key in simDataList) {
                const jsonData = simDataList[key];
                if (!jsonData || !jsonData.zone || !jsonData.players) {
                    alert("Invalid JSON file format. Please ensure it contains a 'simulationResult' property.");
                    return;
                }
                const playersToSim = Object.values(jsonData.players).map(
                    (player, index) => parsePlayerJson(player, `player${index + 1}`)
                );

                let maxPlayerCombatLevel = 1.0;
                for (let player of playersToSim) {
                    player.combatLevel = calcCombatLevel(player.staminaLevel, player.intelligenceLevel, player.defenseLevel, player.attackLevel, player.meleeLevel, player.rangedLevel, player.magicLevel);
                    maxPlayerCombatLevel = Math.max(maxPlayerCombatLevel, player.combatLevel);
                }

                for (let player of playersToSim) {
                    if ((maxPlayerCombatLevel / player.combatLevel) > 1.2) {
                        const maxDebuffOnLevelGap = 0.9;
                        let levelPercent = Math.floor(((maxPlayerCombatLevel / player.combatLevel) - 1.2) * 100) / 100;
                        player.debuffOnLevelGap = -1 * Math.min(maxDebuffOnLevelGap, 3 * levelPercent);
                        console.log("player " + player.hrid + " debuff on level gap: " + player.debuffOnLevelGap * 100 + "% for " + (maxPlayerCombatLevel / player.combatLevel));
                    }
                    else {
                        player.debuffOnLevelGap = 0;
                    }
                }

                const simulationTimeLimit = (jsonData.simulationTimeLimit || 24) * ONE_HOUR;
                const simName = jsonData.name || `Json ${key}`;
                const zoneHrid = jsonData.zone;
                if (zoneHrid === "all") {
                    let targetHrids = {};

                    if (simAllZonesToggle.checked) {
                        Object.values(actionDetailMap)
                            .filter(a =>
                                a.type === "/action_types/combat" &&
                                a.category !== "/action_categories/combat/dungeons" &&
                                a.combatZoneInfo.fightInfo.randomSpawnInfo.maxSpawnCount > 1
                            )
                            .forEach(a => { targetHrids[a.hrid] = a; });
                    }

                    let simHrids = Object.values(targetHrids)
                        .sort((a, b) => a.sortIndex - b.sortIndex)
                        .map(action => {
                            let result = [];
                            for (let difficultyTier = 0; difficultyTier <= action.maxDifficulty; difficultyTier++) {
                                result.push({ zoneHrid: action.hrid, difficultyTier: difficultyTier });
                            }
                            return result;
                        })
                        .flat();

                    let workerMessage = {
                        simulationName: simName,
                        type: "start_simulation_all_zones",
                        workerId: Math.floor(Math.random() * 1e9).toString(),
                        players: playersToSim,
                        zones: simHrids,
                        simulationTimeLimit: simulationTimeLimit,
                        extra : extra
                    };
                    const worker = new Worker(new URL("worker.js", import.meta.url)); 
                    worker.onmessage = mainWorkerOnMessage;
                    worker.postMessage(workerMessage);
                    customAlert("Simulation task Created", "info")
                    workerPool.push({
                        workerId: workerMessage.workerId,
                        worker: worker,
                    });
                } else {
                    let difficultyTier = jsonData.difficultyTier || 0;
                    let workerMessage = {
                        simulationName: simName,
                        type: "start_simulation",
                        workerId: Math.floor(Math.random() * 1e9).toString(),
                        players: playersToSim,
                        zone: { zoneHrid: zoneHrid, difficultyTier: difficultyTier },
                        simulationTimeLimit: simulationTimeLimit,
                        extra : extra
                    };
                    const worker = new Worker(new URL("worker.js", import.meta.url)); 
                    worker.onmessage = mainWorkerOnMessage;
                    worker.postMessage(workerMessage);
                    customAlert("Simulation task Created", "info")
                    workerPool.push({
                        workerId: workerMessage.workerId,
                        worker: worker,
                    });
                }
            }
        } catch (error) {
            // alert("Error parsing JSON file: " + error.message);
            customAlert("Error parsing JSON file: " + error.message, "danger");
        }
    }
    reader.readAsText(file);
});


// #endregion

// #region WipeEvents

function renderWipeEvents(simResult) {
    const selector = document.getElementById('wipeEventSelector');
    const logsContainer = document.getElementById('wipeLogsContainer');
    const waveBadge = document.getElementById('wipeWaveBadge');
    const timeInfo = document.getElementById('wipeTimeInfo');

    selector.innerHTML = '';
    logsContainer.innerHTML = '';

    if (!simResult.wipeEvents || simResult.wipeEvents.length === 0) {
        selector.innerHTML = `<option value="-1" data-i18n="common:noWipeEvents">No Wipe Events</option>`;
        logsContainer.innerHTML = `<div class="text-center py-4" data-i18n="common:noWipeEventsDetected">No Wipe Events Detected</div>`;
        waveBadge.textContent = '';
        timeInfo.textContent = '';
        return;
    }

    simResult.wipeEvents.forEach((event, index) => {
        const wave = event.wave || '?';
        // const time = (event.simulationTime / 1e9).toFixed(2);
        // const timestamp = new Date(event.timestamp).toLocaleTimeString();

        const option = document.createElement('option');
        option.value = index;
        option.textContent = `#${index + 1} - 波次: ${wave}`;
        selector.appendChild(option);
    });

    selector.value = 0;
    renderSelectedWipeEvent(0, simResult);

    selector.addEventListener('change', () => {
        renderSelectedWipeEvent(selector.value, simResult);
    });
}

// 渲染选中的团灭事件
function renderSelectedWipeEvent(index, simResult) {
    const logsContainer = document.getElementById('wipeLogsContainer');
    const waveBadge = document.getElementById('wipeWaveBadge');
    const timeInfo = document.getElementById('wipeTimeInfo');

    logsContainer.innerHTML = '';

    if (index < 0 || index >= simResult.wipeEvents.length) {
        logsContainer.innerHTML = `<div class="text-center py-4" data-i18n="common:noWipeEvents">No Wipe Events</div>`;
        waveBadge.textContent = '';
        timeInfo.textContent = '';
        return;
    }

    const wipeEvent = simResult.wipeEvents[index];
    const wave = wipeEvent.wave || '?';
    const time = (wipeEvent.simulationTime / 1e9).toFixed(2);
    const timestamp = new Date(wipeEvent.timestamp).toLocaleString();

    waveBadge.textContent = `波次: ${wave}`;
    timeInfo.textContent = `模拟时间: ${time}s | 记录时间: ${timestamp}`;

    const logsByTime = groupLogsByTime(wipeEvent.logs);

    const baseTime = logsByTime.length > 0 ? logsByTime[0].time : 0;

    logsByTime.forEach(group => {
        const timeGroupElement = document.createElement('div');
        timeGroupElement.className = 'log-time-group';

        const relativeTime = (group.time - baseTime) / 1e9;

        // 时间标题
        const timeHeader = document.createElement('div');
        timeHeader.className = 'log-time-header';
        timeHeader.textContent = `[${relativeTime.toFixed(2)}s] [Wave#${group.wave}]`;
        timeGroupElement.appendChild(timeHeader);

        // 事件列表
        const eventsList = document.createElement('div');
        eventsList.className = 'log-events';

        const damagedPlayers = new Set();

        group.logs.forEach(log => {
            const eventElement = document.createElement('div');
            eventElement.className = 'log-event';

            damagedPlayers.add(log.target);

            const sourceSpan = document.createElement('span');
            sourceSpan.className = 'log-source';
            if (log.ability === "damageOverTime") {
                sourceSpan.textContent = log.target;
            } else if(log.source == 'UNKNOWN_SOURCE') {
                sourceSpan.textContent = 'UNKNOWN';
            } else {
                sourceSpan.setAttribute('data-i18n', `monsterNames.${log.source}`);
                sourceSpan.textContent = log.source;
            }

            const castSpan = document.createElement('span');
            castSpan.className = 'log-cast';
            castSpan.setAttribute('data-i18n', `common:cast`);
            castSpan.textContent = ' cast ';

            const abilitySpan = document.createElement('span');
            abilitySpan.className = 'log-ability';
            if (log.ability === "autoAttack") {
                abilitySpan.setAttribute('data-i18n', 'combatUnit.autoAttack');
                abilitySpan.textContent = 'Auto Attack';
            } else if (log.ability === "physicalThorns") {
                abilitySpan.setAttribute('data-i18n', `combatStats.physicalThorns`);
                abilitySpan.textContent = 'Physical Thorns';
            } else if (log.ability === "elementalThorns") {
                abilitySpan.setAttribute('data-i18n', `combatStats.elementalThorns`);
                abilitySpan.textContent = 'Elemental Thorns';
            } else if (log.ability === "retaliation") {
                abilitySpan.setAttribute('data-i18n', `combatStats.retaliation`);
                abilitySpan.textContent = 'Retaliation';
            } else if (log.ability === "damageOverTime") {
                abilitySpan.setAttribute('data-i18n', `common:simulationResults.damageOverTime`);
                abilitySpan.textContent = 'Damage Over Time';
            } else {
                abilitySpan.setAttribute('data-i18n', `abilityNames.${log.ability}`);
                abilitySpan.textContent = log.ability;
            }

            const toSpan = document.createElement('span');
            toSpan.className = 'log-to';
            toSpan.setAttribute('data-i18n', `common:to`);
            toSpan.textContent = ' to ';

            const targetSpan = document.createElement('span');
            targetSpan.className = 'log-target';
            targetSpan.textContent = log.target;

            const dealDamageSpan = document.createElement('span');
            dealDamageSpan.className = 'log-deal-damage';
            dealDamageSpan.setAttribute('data-i18n', `common:dealDamage`);
            dealDamageSpan.textContent = ' deal damage ';

            const damageDoneSpan = document.createElement('span');
            damageDoneSpan.className = 'log-damage-done';
            damageDoneSpan.textContent = log.damage;
            if (log.isCrit) {
                damageDoneSpan.style.fontWeight = 'bold';
                damageDoneSpan.textContent += '!!!';
            }

            eventElement.appendChild(sourceSpan);
            eventElement.appendChild(castSpan);
            eventElement.appendChild(abilitySpan);
            eventElement.appendChild(toSpan);
            eventElement.appendChild(targetSpan);
            eventElement.appendChild(dealDamageSpan);
            eventElement.appendChild(damageDoneSpan);
            eventElement.appendChild(document.createTextNode(` , HP ${log.beforeHp} → ${log.afterHp}`));

            eventsList.appendChild(eventElement);
        });

        timeGroupElement.appendChild(eventsList);

        const lastLog = group.logs[group.logs.length - 1];
        const playersHpElement = document.createElement('div');

        const playerHpTitle = document.createElement('span');
        playerHpTitle.className = 'log-players-hp';
        playerHpTitle.setAttribute('data-i18n', `common:playersHp`);
        playerHpTitle.textContent = 'Players HP: ';
        playersHpElement.appendChild(playerHpTitle);

        lastLog.playersHp.forEach((player, idx) => {
            const playerElement = document.createElement('span');
            playerElement.className = 'log-player-hp';
            playerElement.textContent = `${player.hrid}: ${player.current}/${player.max}`;

            if (player.current <= 0) {
                playerElement.style.color = darkModeToggle.checked ? '#FF6347' : '#CC0000';
            } else if (damagedPlayers.has(player.hrid)) {
                playerElement.style.color = darkModeToggle.checked ? '#00BFFF' : '#007BFF';
            }

            if (idx > 0) {
                playersHpElement.appendChild(document.createTextNode(' | '));
            }
            playersHpElement.appendChild(playerElement);
        });
        const spacer = document.createElement('div');
        spacer.style.height = '15px';
        logsContainer.appendChild(spacer);
        timeGroupElement.appendChild(playersHpElement);
        logsContainer.appendChild(timeGroupElement);
    });

    // 更新汉化
    updateContent()
}

// 按时间分组日志
function groupLogsByTime(logs) {
    const groups = [];
    let currentGroup = null;

    logs.forEach(log => {
        if (!currentGroup || currentGroup.time !== log.time) {
            currentGroup = {
                time: log.time,
                wave: log.wave,
                logs: [log]
            };
            groups.push(currentGroup);
        } else {
            currentGroup.logs.push(log);
        }
    });

    groups.forEach(group => {
        let hpMap = {};
        if (group.logs.length > 0) {
            group.logs[0].playersHp.forEach(p => {
                hpMap[p.hrid] = { current: p.current, max: p.max };
            });
        }
        group.logs.forEach(log => {
            if (hpMap[log.target]) {
                hpMap[log.target].current = log.afterHp;
            }
        });
        group.logs.forEach(log => {
            log.playersHp = Object.entries(hpMap).map(([hrid, val]) => ({
                hrid,
                current: val.current,
                max: val.max
            }));
        });
    });

    return groups;
}

// #endregion


// #region Equipment Sets

function initEquipmentSetsModal() {
    let equipmentSetsModal = document.getElementById("equipmentSetsModal");
    equipmentSetsModal.addEventListener("show.bs.modal", equipmentSetsModalShownHandler);

    let equipmentSetNameInput = document.getElementById("inputEquipmentSetName");
    equipmentSetNameInput.addEventListener("input", (event) => equipmentSetNameChangedHandler(event));

    let createEquipmentSetButton = document.getElementById("buttonCreateNewEquipmentSet");
    createEquipmentSetButton.addEventListener("click", createNewEquipmentSetHandler);
}

function equipmentSetsModalShownHandler() {
    resetNewEquipmentSetControls();
    updateEquipmentSetList();
}

function resetNewEquipmentSetControls() {
    let equipmentSetNameInput = document.getElementById("inputEquipmentSetName");
    equipmentSetNameInput.value = "";

    let createEquipmentSetButton = document.getElementById("buttonCreateNewEquipmentSet");
    createEquipmentSetButton.disabled = true;
}

function updateEquipmentSetList() {
    let newChildren = [];
    let equipmentSets = loadEquipmentSets();

    for (const equipmentSetName of Object.keys(equipmentSets)) {
        let row = createElement("div", "row mb-2");

        let nameCol = createElement("div", "col align-self-center", equipmentSetName);
        row.appendChild(nameCol);

        let loadButtonCol = createElement("div", "col-md-auto");
        let loadButton = createElement("button", "btn btn-primary", "Load");
        loadButton.setAttribute("data-i18n", "common:controls.load");
        loadButton.setAttribute("type", "button");
        loadButton.addEventListener("click", (_) => loadEquipmentSetHandler(equipmentSetName));
        loadButtonCol.appendChild(loadButton);
        row.appendChild(loadButtonCol);

        let saveButtonCol = createElement("div", "col-md-auto");
        let saveButton = createElement("button", "btn btn-primary", "Save");
        saveButton.setAttribute("data-i18n", "common:controls.save");
        saveButton.setAttribute("type", "button");
        saveButton.addEventListener("click", (_) => updateEquipmentSetHandler(equipmentSetName));
        saveButtonCol.appendChild(saveButton);
        row.appendChild(saveButtonCol);

        let deleteButtonCol = createElement("div", "col-md-auto");
        let deleteButton = createElement("button", "btn btn-danger", "Delete");
        deleteButton.setAttribute("data-i18n", "common:controls.delete");
        deleteButton.setAttribute("type", "button");
        deleteButton.addEventListener("click", (_) => deleteEquipmentSetHandler(equipmentSetName));
        deleteButtonCol.appendChild(deleteButton);
        row.appendChild(deleteButtonCol);

        newChildren.push(row);
    }

    let equipmentSetList = document.getElementById("equipmentSetList");
    equipmentSetList.replaceChildren(...newChildren);

    updateContent();
}

function equipmentSetNameChangedHandler(event) {
    let invalid = false;

    if (event.target.value.length == 0) {
        invalid = true;
    }

    let equipmentSets = loadEquipmentSets();
    if (equipmentSets[event.target.value]) {
        invalid = true;
    }

    let createEquipmentSetButton = document.getElementById("buttonCreateNewEquipmentSet");
    createEquipmentSetButton.disabled = invalid;
}

function createNewEquipmentSetHandler() {
    let equipmentSetNameInput = document.getElementById("inputEquipmentSetName");
    let equipmentSetName = equipmentSetNameInput.value;

    let equipmentSet = getEquipmentSetFromUI();
    let equipmentSets = loadEquipmentSets();
    equipmentSets[equipmentSetName] = equipmentSet;
    saveEquipmentSets(equipmentSets);

    resetNewEquipmentSetControls();
    updateEquipmentSetList();
}

function loadEquipmentSetHandler(name) {
    let equipmentSets = loadEquipmentSets();
    loadEquipmentSetIntoUI(equipmentSets[name]);
}

function updateEquipmentSetHandler(name) {
    let equipmentSet = getEquipmentSetFromUI();
    let equipmentSets = loadEquipmentSets();
    equipmentSets[name] = equipmentSet;
    saveEquipmentSets(equipmentSets);
}

function deleteEquipmentSetHandler(name) {
    let equipmentSets = loadEquipmentSets();
    delete equipmentSets[name];
    saveEquipmentSets(equipmentSets);

    updateEquipmentSetList();
}

function loadEquipmentSets() {
    return JSON.parse(localStorage.getItem("equipmentSets")) ?? {};
}

function saveEquipmentSets(equipmentSets) {
    localStorage.setItem("equipmentSets", JSON.stringify(equipmentSets));
}

function getEquipmentSetFromUI() {
    let equipmentSet = {
        levels: {},
        equipment: {},
        food: {},
        drinks: {},
        abilities: {},
        triggerMap: {},
        houseRooms: {},
        achievements: {},
    };

    ["stamina", "intelligence", "attack", "melee", "defense", "ranged", "magic"].forEach((skill) => {
        let levelInput = document.getElementById("inputLevel_" + skill);
        equipmentSet.levels[skill] = Number(levelInput.value);
    });

    ["head", "body", "legs", "feet", "hands", "weapon", "off_hand", "pouch", "neck", "earrings", "ring", "back", "charm"].forEach((type) => {
        let equipmentSelect = document.getElementById("selectEquipment_" + type);
        let enhancementLevelInput = document.getElementById("inputEquipmentEnhancementLevel_" + type);

        equipmentSet.equipment[type] = {
            equipment: equipmentSelect.value,
            enhancementLevel: Number(enhancementLevelInput.value),
        };
    });

    for (let i = 0; i < 3; i++) {
        let foodSelect = document.getElementById("selectFood_" + i);
        equipmentSet.food[i] = foodSelect.value;
    }

    for (let i = 0; i < 3; i++) {
        let drinkSelect = document.getElementById("selectDrink_" + i);
        equipmentSet.drinks[i] = drinkSelect.value;
    }

    for (let i = 0; i < 5; i++) {
        let abilitySelect = document.getElementById("selectAbility_" + i);
        let abilityLevelInput = document.getElementById("inputAbilityLevel_" + i);
        equipmentSet.abilities[i] = {
            ability: abilitySelect.value,
            level: Number(abilityLevelInput.value),
        };
    }

    equipmentSet.triggerMap = triggerMap;

    equipmentSet.houseRooms = player.houseRooms;
    equipmentSet.achievements = player.achievements;

    return equipmentSet;
}

function fixTriggerMap(triggerMap) {
    let delKeys = []
    for (const key of Object.keys(triggerMap)) {
        let err = false;
        if (null == triggerMap[key]) {
            triggerMap[key] = [];
        }
        for (const trigger of triggerMap[key]) {
            if (!combatTriggerConditionDetailMap[trigger.conditionHrid]) {
                err = true;
                break;
            }
        }
        if (err) {
            delKeys.push(key);
        }
    }
    for (const key of delKeys) {
        delete triggerMap[key];
    }
}

function loadEquipmentSetIntoUI(equipmentSet) {
    ["stamina", "intelligence", "attack", "melee", "defense", "ranged", "magic"].forEach((skill) => {
        let levelInput = document.getElementById("inputLevel_" + skill);
        if (skill == "melee" && !equipmentSet.levels["meleeLevel"] && equipmentSet.levels["powerLevel"]) {
            equipmentSet.levels["meleeLevel"] = equipmentSet.levels["powerLevel"];
        }
        levelInput.value = equipmentSet.levels[skill] ?? 1;
    });

    ["head", "body", "legs", "feet", "hands", "weapon", "off_hand", "pouch", "neck", "earrings", "ring", "back", "charm"].forEach((type) => {
        let equipmentSelect = document.getElementById("selectEquipment_" + type);
        let enhancementLevelInput = document.getElementById("inputEquipmentEnhancementLevel_" + type);

        let currentEquipment = equipmentSet.equipment[type];
        if (currentEquipment !== undefined) {
            equipmentSelect.value = currentEquipment.equipment;
            enhancementLevelInput.value = currentEquipment.enhancementLevel;
        } else {
            equipmentSelect.value = "";
            enhancementLevelInput.value = 0;
        }
    });

    for (let i = 0; i < 3; i++) {
        let foodSelect = document.getElementById("selectFood_" + i);
        foodSelect.value = equipmentSet.food[i];
    }

    for (let i = 0; i < 3; i++) {
        let drinkSelect = document.getElementById("selectDrink_" + i);
        drinkSelect.value = equipmentSet.drinks[i].replace("power", "melee");
    }

    let hasSpecial = false;
    if (equipmentSet.abilities && Object.keys(equipmentSet.abilities).length == 5) {
        hasSpecial = true;
    }

    for (let i = 0; i < (hasSpecial ? 5 : 4); i++) {
        let abilitySlot = hasSpecial ? i : (i + 1);
        let abilitySelect = document.getElementById("selectAbility_" + abilitySlot);
        let abilityLevelInput = document.getElementById("inputAbilityLevel_" + abilitySlot);

        if (hasSpecial && i == 0 && (
            equipmentSet.abilities[i].ability == "/abilities/aqua_aura" ||
            equipmentSet.abilities[i].ability == "/abilities/flame_aura" ||
            equipmentSet.abilities[i].ability == "/abilities/sylvan_aura"
        )
        ) {
            equipmentSet.abilities[i].ability = "/abilities/mystic_aura";
        }

        if (equipmentSet.abilities[i].ability == "/abilities/arcane_reflection") {
            equipmentSet.abilities[i].ability = "/abilities/retribution";
        }

        abilitySelect.value = equipmentSet.abilities[i].ability;
        abilityLevelInput.value = equipmentSet.abilities[i].level;
    }

    triggerMap = equipmentSet.triggerMap;
    fixTriggerMap(triggerMap);

    if (equipmentSet.houseRooms) {
        for (const room in equipmentSet.houseRooms) {
            const field = document.querySelector('[data-house-hrid="' + room + '"]');
            if (equipmentSet.houseRooms[room]) {
                field.value = equipmentSet.houseRooms[room];
            } else {
                field.value = '';
            }
        }
        player.houseRooms = equipmentSet.houseRooms;
    } else {
        let houseRooms = Object.values(houseRoomDetailMap);
        for (const room of Object.values(houseRooms)) {
            const field = document.querySelector('[data-house-hrid="' + room.hrid + '"]');
            field.value = '';
            player.houseRooms[room.hrid] = 0;
        }
    }

    if (equipmentSet.achievements) {
        for (const achievement in equipmentSet.achievements) {
            const field = document.querySelector('[data-achievement-hrid="' + achievement + '"]');
            if (equipmentSet.achievements[achievement]) {
                field.checked = true;
            } else {
                field.checked = false;
            }
            player.achievements[achievement] = field.checked;
        }
    } else {
        let achievements = Object.values(achievementDetailMap);
        for (const detail of Object.values(achievements)) {
            const field = document.querySelector('[data-achievement-hrid="' + detail.hrid + '"]');
            field.checked = false;
            player.achievements[detail.hrid] = false;
        }
    }
    refreshAchievementStatics();

    updateState();
    updateUI();

    updateContent();
}

// #endregion

// #region Error Handling

function initErrorHandling() {
    window.addEventListener("error", (event) => {
        showErrorModal(event.message);
    });

    let copyErrorButton = document.getElementById("buttonCopyError");
    copyErrorButton.addEventListener("click", (event) => {
        let errorInput = document.getElementById("inputError");
        navigator.clipboard.writeText(errorInput.value);
    });
}

function initImportExportModal() {
    let exportSetButton = document.getElementById("buttonExportSet");
    exportSetButton.addEventListener("click", (event) => {
        savePreviousPlayer(currentPlayerTabId);
        const activeTab = document.querySelector('#importTab .nav-link.active');
        if (activeTab.id === 'group-combat-tab') {
            doGroupExport();
        } else if (activeTab.id === 'solo-tab') {
            doSoloExport();
        }
    });

    let importSetButton = document.getElementById("buttonImportSet");
    importSetButton.addEventListener("click", (event) => {
        const activeTab = document.querySelector('#importTab .nav-link.active');
        if (activeTab.id === 'group-combat-tab') {
            doGroupImport();
        } else if (activeTab.id === 'solo-tab') {
            doSoloImport();
        }
        updateState();
        updateUI();
        resetImportInputs();
    });
}

function resetImportInputs() {
    document.getElementById('inputSetGroupCombatAll').value = '';
    document.getElementById('inputSetGroupCombatplayer1').value = '';
    document.getElementById('inputSetGroupCombatplayer2').value = '';
    document.getElementById('inputSetGroupCombatplayer3').value = '';
    document.getElementById('inputSetGroupCombatplayer4').value = '';
    document.getElementById('inputSetGroupCombatplayer5').value = '';
    document.getElementById('inputSetSolo').value = '';
}

function doGroupExport() {
    try {
        navigator.clipboard.writeText(JSON.stringify(playerDataMap)).then(() => alert("Current Group has been copied to clipboard."));
    } catch (err) {
        alert('Error copying to clipboard: ' + err);
    }
}

function doSoloExport() {
    let zoneSelect = document.getElementById("selectZone");
    let simulationTimeInput = document.getElementById("inputSimulationTime");
    let equipmentArray = [];
    for (const item in player.equipment) {
        if (player.equipment[item] != null) {
            equipmentArray.push({
                "itemLocationHrid": player.equipment[item].gameItem.equipmentDetail.type.replaceAll("equipment_types", "item_locations"),
                "itemHrid": player.equipment[item].hrid,
                "enhancementLevel": player.equipment[item].enhancementLevel
            });
        }
    }
    let playerArray = {
        "attackLevel": player.attackLevel,
        "magicLevel": player.magicLevel,
        "meleeLevel": player.meleeLevel,
        "rangedLevel": player.rangedLevel,
        "defenseLevel": player.defenseLevel,
        "staminaLevel": player.staminaLevel,
        "intelligenceLevel": player.intelligenceLevel,
        "equipment": equipmentArray
    };
    let abilitiesArray = [];
    for (let i = 0; i < 5; i++) {
        let abilityLevelInput = document.getElementById("inputAbilityLevel_" + i);
        let abilityName = document.getElementById("selectAbility_" + i);
        abilitiesArray[i] = { "abilityHrid": abilityName.value, "level": abilityLevelInput.value };
    }
    let drinksArray = [];
    for (let i = 0; i < drinks?.length; i++) {
        drinksArray.push({ "itemHrid": drinks[i] });
    }
    let foodArray = [];
    for (let i = 0; i < food?.length; i++) {
        foodArray.push({ "itemHrid": food[i] });
    }
    let state = {
        player: playerArray,
        food: { "/action_types/combat": foodArray },
        drinks: { "/action_types/combat": drinksArray },
        abilities: abilitiesArray,
        triggerMap: triggerMap,
        zone: zoneSelect.value,
        simulationTime: simulationTimeInput.value,
        houseRooms: player.houseRooms,
        achievements: player.achievements
    };
    try {
        navigator.clipboard.writeText(JSON.stringify(state)).then(() => alert("Current set has been copied to clipboard."));
    } catch (err) {
        alert('Error copying to clipboard: ' + err);
    }
}

function setPlayerData(playerId, inputElementId) {
    const inputElement = document.getElementById(inputElementId);
    const value = inputElement ? inputElement.value.trim() : "";

    // Only set the value in the map if it's not null, undefined, or empty
    if (value) {
        playerDataMap[playerId] = value;
        return true;
    }
    return false;
}

function doGroupImport() {
    let needUpdateCurrentTab = false;
    let updatedPlayerIds = [];
    const value = document.getElementById("inputSetGroupCombatAll")?.value || "";
    if (!value.trim()) {
        for (let i of ['1', '2', '3', '4', '5']) {
            if (setPlayerData(i, "inputSetGroupCombatplayer" + i)) {
                updatedPlayerIds.push(i);
                importedProfileByPlayer[i] = true;
                if (currentPlayerTabId == i) {
                    needUpdateCurrentTab = true;
                }
            }
        }
    } else {
        playerDataMap = JSON.parse(value);
        updatedPlayerIds = [...QUEUE_PLAYER_IDS];
        for (const playerId of QUEUE_PLAYER_IDS) {
            importedProfileByPlayer[playerId] = true;
        }
        needUpdateCurrentTab = true;
    }

    for (const playerId of updatedPlayerIds) {
        resetPlayerQueueState(playerId);
    }

    if (needUpdateCurrentTab) {
        updateNextPlayer(currentPlayerTabId);
    }

    renderQueueViewsForCurrentPlayer();
}

function doSoloImport() {
    let importSet = document.getElementById("inputSetSolo").value;
    importSet = JSON.parse(importSet);
    ["stamina", "intelligence", "attack", "melee", "defense", "ranged", "magic"].forEach((skill) => {
        let levelInput = document.getElementById("inputLevel_" + skill);
        if (skill == "melee" && !importSet.player["meleeLevel"] && importSet.player["powerLevel"]) {
            importSet.player["meleeLevel"] = importSet.player["powerLevel"];
        }
        levelInput.value = importSet.player[skill + "Level"];
    });

    ["head", "body", "legs", "feet", "hands", "off_hand", "pouch", "neck", "earrings", "ring", "back", "charm"].forEach((type) => {
        let equipmentSelect = document.getElementById("selectEquipment_" + type);
        let enhancementLevelInput = document.getElementById("inputEquipmentEnhancementLevel_" + type);
        let currentEquipment = importSet.player.equipment.find(item => item.itemLocationHrid === "/item_locations/" + type);
        if (currentEquipment !== undefined) {
            equipmentSelect.value = currentEquipment.itemHrid;
            enhancementLevelInput.value = currentEquipment.enhancementLevel;
        } else {
            equipmentSelect.value = "";
            enhancementLevelInput.value = 0;
        }
    });

    let weaponSelect = document.getElementById("selectEquipment_weapon");
    let weaponEnhancementLevelInput = document.getElementById("inputEquipmentEnhancementLevel_weapon");
    let mainhandWeapon = importSet.player.equipment.find(item => item.itemLocationHrid === "/item_locations/main_hand");
    let twohandWeapon = importSet.player.equipment.find(item => item.itemLocationHrid === "/item_locations/two_hand");
    if (mainhandWeapon !== undefined) {
        weaponSelect.value = mainhandWeapon.itemHrid;
        weaponEnhancementLevelInput.value = mainhandWeapon.enhancementLevel;
    } else if (twohandWeapon !== undefined) {
        weaponSelect.value = twohandWeapon.itemHrid;
        weaponEnhancementLevelInput.value = twohandWeapon.enhancementLevel;
    } else {
        weaponSelect.value = "";
        weaponEnhancementLevelInput.value = 0;
    }
    importSet.drinks = importSet.drinks["/action_types/combat"];
    importSet.food = importSet.food["/action_types/combat"];
    for (let i = 0; i < 3; i++) {
        let drinkSelect = document.getElementById("selectDrink_" + i);
        let foodSelect = document.getElementById("selectFood_" + i);
        if (importSet.drinks[i] != null) {
            drinkSelect.value = importSet.drinks[i].itemHrid.replace('power', 'melee');
        } else {
            drinkSelect.value = "";
        }
        if (importSet.food[i] != null) {
            foodSelect.value = importSet.food[i].itemHrid;
        } else {
            foodSelect.value = "";
        }
    }

    let hasSpecial = false;
    if (importSet.abilities && Object.keys(importSet.abilities).length == 5) {
        hasSpecial = true;
    }

    for (let i = 0; i < (hasSpecial ? 5 : 4); i++) {
        let abilitySlot = hasSpecial ? i : (i + 1);
        let abilitySelect = document.getElementById("selectAbility_" + abilitySlot);
        let abilityLevelInput = document.getElementById("inputAbilityLevel_" + abilitySlot);

        if (hasSpecial && i == 0 && (
            importSet.abilities[i].abilityHrid == "/abilities/aqua_aura" ||
            importSet.abilities[i].abilityHrid == "/abilities/flame_aura" ||
            importSet.abilities[i].abilityHrid == "/abilities/sylvan_aura"
        )
        ) {
            importSet.abilities[i].abilityHrid = "/abilities/mystic_aura";
        }

        if (importSet.abilities[i].abilityHrid == "/abilities/arcane_reflection") {
            importSet.abilities[i].abilityHrid = "/abilities/retribution";
        }

        if (importSet.abilities[i] != null) {
            abilitySelect.value = importSet.abilities[i].abilityHrid;
            abilityLevelInput.value = String(importSet.abilities[i].level);
        } else {
            abilitySelect.value = "";
            abilityLevelInput.value = "1";
        }
    }

    if (importSet.triggerMap) {
        triggerMap = importSet.triggerMap;
        fixTriggerMap(triggerMap);
    }

    if (importSet.houseRooms) {
        for (const room in importSet.houseRooms) {
            const field = document.querySelector('[data-house-hrid="' + room + '"]');
            if (importSet.houseRooms[room]) {
                field.value = importSet.houseRooms[room];
            } else {
                field.value = '';
            }
        }
        player.houseRooms = importSet.houseRooms;
    } else {
        let houseRooms = Object.values(houseRoomDetailMap);
        for (const room of Object.values(houseRooms)) {
            const field = document.querySelector('[data-house-hrid="' + room.hrid + '"]');
            field.value = '';
            player.houseRooms[room.hrid] = 0;
        }
    }

    if (importSet.achievements) {
        for (const achievement in importSet.achievements) {
            const field = document.querySelector('[data-achievement-hrid="' + achievement + '"]');
            if (importSet.achievements[achievement]) {
                field.checked = true;
            } else {
                field.checked = false;
            }
            player.achievements[achievement] = field.checked;
        }
    } else {
        let achievements = Object.values(achievementDetailMap);
        for (const detail of Object.values(achievements)) {
            const field = document.querySelector('[data-achievement-hrid="' + detail.hrid + '"]');
            field.checked = false;
            player.achievements[detail.hrid] = false;
        }
    }
    refreshAchievementStatics();

    if ("zone" in importSet) {
        let zoneSelect = document.getElementById("selectZone");
        zoneSelect.value = importSet["zone"];
    }

    if ("simulationTime" in importSet) {
        let simulationDuration = document.getElementById("inputSimulationTime");
        simulationDuration.value = importSet["simulationTime"];
    }

    importedProfileByPlayer[currentPlayerTabId] = true;
    resetPlayerQueueState(currentPlayerTabId);
    renderQueueViewsForCurrentPlayer();
}

function savePreviousPlayer(playerId) {
    let zoneSelect = document.getElementById("selectZone");
    let simulationTimeInput = document.getElementById("inputSimulationTime");
    let equipmentArray = [];
    for (const item in player.equipment) {
        if (player.equipment[item] != null) {
            equipmentArray.push({
                "itemLocationHrid": player.equipment[item].gameItem.equipmentDetail.type.replaceAll("equipment_types", "item_locations"),
                "itemHrid": player.equipment[item].hrid,
                "enhancementLevel": player.equipment[item].enhancementLevel
            });
        }
    }
    let playerArray = {
        "attackLevel": player.attackLevel,
        "magicLevel": player.magicLevel,
        "meleeLevel": player.meleeLevel,
        "rangedLevel": player.rangedLevel,
        "defenseLevel": player.defenseLevel,
        "staminaLevel": player.staminaLevel,
        "intelligenceLevel": player.intelligenceLevel,
        "equipment": equipmentArray
    };
    let abilitiesArray = [];
    for (let i = 0; i < 5; i++) {
        let abilityLevelInput = document.getElementById("inputAbilityLevel_" + i);
        let abilityName = document.getElementById("selectAbility_" + i);
        abilitiesArray[i] = { "abilityHrid": abilityName.value, "level": abilityLevelInput.value };
    }
    let drinksArray = [];
    for (let i = 0; i < drinks?.length; i++) {
        drinksArray.push({ "itemHrid": drinks[i] });
    }
    let foodArray = [];
    for (let i = 0; i < food?.length; i++) {
        foodArray.push({ "itemHrid": food[i] });
    }
    let state = {
        player: playerArray,
        food: { "/action_types/combat": foodArray },
        drinks: { "/action_types/combat": drinksArray },
        abilities: abilitiesArray,
        triggerMap: triggerMap,
        zone: zoneSelect.value,
        simulationTime: simulationTimeInput.value,
        houseRooms: player.houseRooms,
        achievements: player.achievements
    };
    try {
        playerDataMap[playerId] = JSON.stringify(state);
    } catch (err) {
        alert('Error copying to clipboard: ' + err);
    }
}

function updateNextPlayer(currentPlayerNumber) {
    let playerImportData = playerDataMap[currentPlayerNumber];
    let importSet = JSON.parse(playerImportData);
    ["stamina", "intelligence", "attack", "melee", "defense", "ranged", "magic"].forEach((skill) => {
        let levelInput = document.getElementById("inputLevel_" + skill);
        if (skill == "melee" && !importSet.player["meleeLevel"] && importSet.player["powerLevel"]) {
            importSet.player["meleeLevel"] = importSet.player["powerLevel"];
        }
        levelInput.value = importSet.player[skill + "Level"];
    });

    ["head", "body", "legs", "feet", "hands", "off_hand", "pouch", "neck", "earrings", "ring", "back", "charm"].forEach((type) => {

        let equipmentSelect = document.getElementById("selectEquipment_" + type);
        let enhancementLevelInput = document.getElementById("inputEquipmentEnhancementLevel_" + type);
        let currentEquipment = importSet.player.equipment.find(item => item.itemLocationHrid === "/item_locations/" + type);
        if (currentEquipment !== undefined) {
            equipmentSelect.value = currentEquipment.itemHrid;
            enhancementLevelInput.value = currentEquipment.enhancementLevel;
        } else {
            equipmentSelect.value = "";
            enhancementLevelInput.value = 0;
        }
    });

    let weaponSelect = document.getElementById("selectEquipment_weapon");
    let weaponEnhancementLevelInput = document.getElementById("inputEquipmentEnhancementLevel_weapon");
    let mainhandWeapon = importSet.player.equipment.find(item => item.itemLocationHrid === "/item_locations/main_hand");
    let twohandWeapon = importSet.player.equipment.find(item => item.itemLocationHrid === "/item_locations/two_hand");
    if (mainhandWeapon !== undefined) {
        weaponSelect.value = mainhandWeapon.itemHrid;
        weaponEnhancementLevelInput.value = mainhandWeapon.enhancementLevel;
    } else if (twohandWeapon !== undefined) {
        weaponSelect.value = twohandWeapon.itemHrid;
        weaponEnhancementLevelInput.value = twohandWeapon.enhancementLevel;
    } else {
        weaponSelect.value = "";
        weaponEnhancementLevelInput.value = 0;
    }
    importSet.drinks = importSet.drinks["/action_types/combat"];
    importSet.food = importSet.food["/action_types/combat"];
    for (let i = 0; i < 3; i++) {
        let drinkSelect = document.getElementById("selectDrink_" + i);
        let foodSelect = document.getElementById("selectFood_" + i);
        if (importSet.drinks[i] != null) {
            drinkSelect.value = importSet.drinks[i].itemHrid.replace('power', 'melee');
        } else {
            drinkSelect.value = "";
        }
        if (importSet.food[i] != null) {
            foodSelect.value = importSet.food[i].itemHrid;
        } else {
            foodSelect.value = "";
        }
    }

    let hasSpecial = false;
    if (importSet.abilities && Object.keys(importSet.abilities).length == 5) {
        hasSpecial = true;
    }

    for (let i = 0; i < (hasSpecial ? 5 : 4); i++) {
        let abilitySlot = hasSpecial ? i : (i + 1);
        let abilitySelect = document.getElementById("selectAbility_" + abilitySlot);
        let abilityLevelInput = document.getElementById("inputAbilityLevel_" + abilitySlot);

        if (hasSpecial && i == 0 && (
            importSet.abilities[i].abilityHrid == "/abilities/aqua_aura" ||
            importSet.abilities[i].abilityHrid == "/abilities/flame_aura" ||
            importSet.abilities[i].abilityHrid == "/abilities/sylvan_aura"
        )
        ) {
            importSet.abilities[i].abilityHrid = "/abilities/mystic_aura";
        }

        if (importSet.abilities[i].abilityHrid == "/abilities/arcane_reflection") {
            importSet.abilities[i].abilityHrid = "/abilities/retribution";
        }

        if (importSet.abilities[i] != null) {
            abilitySelect.value = importSet.abilities[i].abilityHrid;
            abilityLevelInput.value = String(importSet.abilities[i].level);
        } else {
            abilitySelect.value = "";
            abilityLevelInput.value = "1";
        }
    }

    if (importSet.triggerMap) {
        triggerMap = importSet.triggerMap;
        fixTriggerMap(triggerMap);
    }

    { // reset all houseRooms
        let houseRooms = Object.values(houseRoomDetailMap);
        for (const room of Object.values(houseRooms)) {
            const field = document.querySelector('[data-house-hrid="' + room.hrid + '"]');
            field.value = '';
            player.houseRooms[room.hrid] = 0;
        }
    }
    if (importSet.houseRooms) {
        for (const room in importSet.houseRooms) {
            const field = document.querySelector('[data-house-hrid="' + room + '"]');
            if (importSet.houseRooms[room]) {
                field.value = importSet.houseRooms[room];
            } else {
                field.value = '';
            }
        }
        player.houseRooms = importSet.houseRooms;
    }

    { // reset all achievements
        let achievements = Object.values(achievementDetailMap);
        for (const detail of Object.values(achievements)) {
            const field = document.querySelector('[data-achievement-hrid="' + detail.hrid + '"]');
            field.checked = false;
            player.achievements[detail.hrid] = false;
        }
    }
    if (importSet.achievements) {
        for (const achievement in importSet.achievements) {
            const field = document.querySelector('[data-achievement-hrid="' + achievement + '"]');
            if (importSet.achievements[achievement]) {
                field.checked = true;
                player.achievements[achievement] = true;
            } else {
                field.checked = false;
                player.achievements[achievement] = false;
            }
        }
    }
    refreshAchievementStatics();
}

function showErrorModal(error) {
    let zoneSelect = document.getElementById("selectZone");
    let simulationTimeInput = document.getElementById("inputSimulationTime");

    let state = {
        error: error,
        player: player,
        food: food,
        drinks: drinks,
        abilities: abilities,
        triggerMap: triggerMap,
        modalTriggers: modalTriggers,
        zone: zoneSelect.value,
        simulationTime: simulationTimeInput.value,
    };

    for (let i = 0; i < 5; i++) {
        let abilityLevelInput = document.getElementById("inputAbilityLevel_" + i);
        state["abilityLevel" + i] = abilityLevelInput.value;
    }

    let errorInput = document.getElementById("inputError");
    errorInput.value = JSON.stringify(state);

    let errorModal = new bootstrap.Modal(document.getElementById("errorModal"));
    errorModal.show();
}

window.prices;

async function fetchAbilityUpgradeReferenceData() {
    try {
        const response = await fetch(JIGS_DATA_URL, { mode: "cors" });
        if (!response.ok) {
            return;
        }

        const data = await response.json();
        if (Array.isArray(data?.abilityXp)) {
            window.jigsAbilityXpLevels = data.abilityXp.map((value) => Number(value));
        }

        if (data?.spellBookXp && typeof data.spellBookXp === "object") {
            window.jigsSpellBookXpByName = data.spellBookXp;
        }

        refreshAbilityUpgradeCostHints();
    } catch (error) {
        console.warn("Failed to fetch ability upgrade reference data", error);
    }
}

async function fetchPrices() {
    let response = null;
    try {
        response = await fetch('https://www.milkywayidle.com/game_data/marketplace.json'
            , {
                mode: 'cors'
            }
        );
        if (!response.ok) {
            console.log('Error fetching prices');
        }
    } catch (error) {
        console.error(error);
    }

    if (response == null) {
        try {
            response = await fetch('https://www.milkywayidlecn.com/game_data/marketplace.json'
                , {
                    mode: 'cors'
                }
            );
            if (!response.ok) {
                console.log('Error fetching prices');
            }
        } catch (error) {
            console.error(error);
        }
    }

    if (!response || !response.ok) {
        return;
    }

    try {

        let btn = document.querySelector('#buttonGetPrices');
        btn.style.backgroundColor = 'green';

        const pricesJson = await response.json();

        const priceTmp = pricesJson['marketData'];
        window.prices = {};
        window.marketEnhancementLevelsByItem = {};
        window.marketEnhancementQuotesByItem = {};
        for (const item in itemDetailMap) {
            const hrid = itemDetailMap[item].hrid;
            if (hrid in priceTmp) {
                window.prices[hrid] = { "ask": -1, "bid": -1, "vendor": itemDetailMap[item].sellPrice };
                const enhancementQuotes = {};
                for (const [levelKey, levelQuote] of Object.entries(priceTmp[hrid] ?? {})) {
                    enhancementQuotes[levelKey] = {
                        ask: toFiniteNumber(levelQuote?.a, -1),
                        bid: toFiniteNumber(levelQuote?.b, -1),
                    };
                }
                if (Object.keys(enhancementQuotes).length > 0) {
                    window.marketEnhancementQuotesByItem[hrid] = enhancementQuotes;
                }
                const enhancementLevels = Object.keys(priceTmp[hrid] ?? {})
                    .map((levelKey) => Number(levelKey))
                    .filter((levelValue) => Number.isFinite(levelValue) && levelValue > 0)
                    .sort((a, b) => a - b);
                if (enhancementLevels.length > 0) {
                    window.marketEnhancementLevelsByItem[hrid] = enhancementLevels;
                }
                if (priceTmp[hrid]['0']) {
                    window.prices[hrid].ask = priceTmp[hrid]['0'].a;
                    window.prices[hrid].bid = priceTmp[hrid]['0'].b;
                }
            }
        } 

        window.prices["/items/coin"] = { "ask": 1, "bid": 1, "vendor": 1 };

        window.prices["/items/small_treasure_chest"] = {
            "ask": openableLootDropMap["/items/small_treasure_chest"].map((item) => {
                return item.itemHrid in window.prices ? window.prices[item.itemHrid].ask * item.dropRate * (item.maxCount + item.minCount) / 2 : 0;
            }).reduce((a, b) => a + b, 0),
            "bid": openableLootDropMap["/items/small_treasure_chest"].map((item) => {
                return item.itemHrid in window.prices ? window.prices[item.itemHrid].bid * item.dropRate * (item.maxCount + item.minCount) / 2 : 0;
            }).reduce((a, b) => a + b, 0),
            "vendor": openableLootDropMap["/items/small_treasure_chest"].map((item) => {
                return item.itemHrid in window.prices ? window.prices[item.itemHrid].vendor : 0;
            }).reduce((a, b) => a + b, 0),
        };

        window.prices["/items/medium_treasure_chest"] = {
            "ask": openableLootDropMap["/items/medium_treasure_chest"].map((item) => {
                return item.itemHrid in window.prices ? window.prices[item.itemHrid].ask * item.dropRate * (item.maxCount + item.minCount) / 2 : 0;
            }).reduce((a, b) => a + b, 0),
            "bid": openableLootDropMap["/items/medium_treasure_chest"].map((item) => {
                return item.itemHrid in window.prices ? window.prices[item.itemHrid].bid * item.dropRate * (item.maxCount + item.minCount) / 2 : 0;
            }).reduce((a, b) => a + b, 0),
            "vendor": openableLootDropMap["/items/medium_treasure_chest"].map((item) => {
                return item.itemHrid in window.prices ? window.prices[item.itemHrid].vendor : 0;
            }).reduce((a, b) => a + b, 0),
        };

        window.prices["/items/large_treasure_chest"] = {
            "ask": openableLootDropMap["/items/large_treasure_chest"].map((item) => {
                return item.itemHrid in window.prices ? window.prices[item.itemHrid].ask * item.dropRate * (item.maxCount + item.minCount) / 2 : 0;
            }).reduce((a, b) => a + b, 0),
            "bid": openableLootDropMap["/items/large_treasure_chest"].map((item) => {
                return item.itemHrid in window.prices ? window.prices[item.itemHrid].bid * item.dropRate * (item.maxCount + item.minCount) / 2 : 0;
            }).reduce((a, b) => a + b, 0),
            "vendor": openableLootDropMap["/items/large_treasure_chest"].map((item) => {
                return item.itemHrid in window.prices ? window.prices[item.itemHrid].vendor : 0;
            }).reduce((a, b) => a + b, 0),
        };

        refreshEquipmentEnhancementHints();
        refreshAbilityUpgradeCostHints();

    } catch (error) {
        console.error(error);
    }
}

document.getElementById("buttonGetPrices").onclick = async () => {
    await fetchPrices();
};

document.addEventListener("input", (e) => {
    let element = e.target;
    if (element.tagName == "TD" && element.parentNode.parentNode.parentNode.classList.value.includes('profit-table')) {
        let tableId = element.parentNode.parentNode.parentNode.id;
        let row = element.parentNode.querySelectorAll('td');
        let item = row[0].getAttribute('data-i18n').split('.')[1];
        let newPrice = element.innerText;

        let revenueSetting = document.getElementById('selectPrices_drops').value;
        let expensesSetting = document.getElementById('selectPrices_consumables').value;

        let expensesDifference = 0;
        let revenueDifference = 0;
        let noRngRevenueDifference = 0;

        if (tableId == 'expensesTable') {
            expensesDifference = updateTable('expensesTable', item, newPrice);
            if (revenueSetting == expensesSetting) {
                revenueDifference = updateTable('revenueTable', item, newPrice);
                noRngRevenueDifference = updateTable('noRngRevenueTable', item, newPrice);
            }
            if (window.prices) {
                if (!window.prices[item]) window.prices[item] = { "ask": -1, "bid": -1, "vendor": itemDetailMap[item].sellPrice };
                if (expensesSetting == 'bid') {
                    window.prices[item]['bid'] = newPrice;
                } else {
                    window.prices[item]['ask'] = newPrice;
                }
            }
        } else {
            revenueDifference = updateTable('revenueTable', item, newPrice);
            noRngRevenueDifference = updateTable('noRngRevenueTable', item, newPrice);
            if (revenueSetting == expensesSetting) {
                expensesDifference = updateTable('expensesTable', item, newPrice);
            }
            if (window.prices) {
                if (!window.prices[item]) window.prices[item] = { "ask": -1, "bid": -1, "vendor": itemDetailMap[item].sellPrice };
                if (revenueSetting == 'bid') {
                    window.prices[item]['bid'] = newPrice;
                } else {
                    window.prices[item]['ask'] = newPrice;
                }
            }
        }

        window.expenses += expensesDifference;
        document.getElementById('expensesSpan').innerText = window.expenses.toLocaleString();
        document.getElementById('expensesPreview').innerText = window.expenses.toLocaleString();
        window.revenue += revenueDifference;
        document.getElementById('revenueSpan').innerText = window.revenue.toLocaleString();
        document.getElementById('revenuePreview').innerText = window.revenue.toLocaleString();
        window.noRngRevenue += noRngRevenueDifference;
        document.getElementById('noRngRevenueSpan').innerText = window.noRngRevenue.toLocaleString();

        window.profit = window.revenue - window.expenses;
        document.getElementById('profitPreview').innerText = window.profit.toLocaleString();
        document.getElementById('profitSpan').innerText = window.profit.toLocaleString();
        window.noRngProfit = window.noRngRevenue - window.expenses;
        document.getElementById('noRngProfitSpan').innerText = window.noRngProfit.toLocaleString();
        document.getElementById('noRngProfitPreview').innerText = window.noRngProfit.toLocaleString();
    }
});

function updateTable(tableId, item, price) {
    let row = document.querySelector('#' + tableId + ' .' + CSS.escape(item));
    if (row == null) {
        return 0;
    }

    row = row.querySelectorAll('td');
    let priceTd = row[1];
    let amountTd = row[2];
    let totalTd = row[3];
    let oldTotal = totalTd.innerText;
    let newTotal = price * amountTd.innerText;

    if (priceTd.innerText != price) {
        priceTd.innerText = price;
    }
    totalTd.innerText = newTotal;

    return newTotal - oldTotal;
}

// #endregion

function initPatchNotes() {
    const patchNotesRows = document.getElementById("patchNotes");
    for (const pn in patchNote) {
        const patchNoteContainer = document.createElement("div");
        patchNotesRows.setAttribute('class', 'col-12 mb-4');

        const patchNoteElement = document.createElement("h6");
        patchNoteElement.innerHTML = pn;
        const patchNoteList = document.createElement("ul");
        for (const note of patchNote[pn]) {
            const noteElement = document.createElement("li");
            noteElement.innerHTML = note;
            patchNoteList.appendChild(noteElement);
        }
        patchNoteContainer.appendChild(patchNoteElement);
        patchNoteContainer.appendChild(patchNoteList);

        patchNotesRows.appendChild(patchNoteContainer);
    }
}

function initExtraBuffSection() {
    // mooPass
    let mooPassToggle = document.getElementById("mooPassToggle");
    let mooPass = localStorage.getItem('mooPass');
    if (mooPass) {
        mooPassToggle.checked = Boolean(mooPass);
    }
    mooPassToggle.onchange = () => {
        localStorage.setItem('mooPass', mooPassToggle.checked);
    }
    
    // comExp
    let comExpToggle = document.getElementById("comExpToggle");
    let comExpInput = document.getElementById("comExpInput");
    let comExp = localStorage.getItem('comExp');
    if (comExp) {
        let comExpNumber = Number(comExp);
        if (comExpNumber > 0) {
            comExpToggle.checked = true;
            comExpInput.value = comExpNumber;
        } else {
            comExpToggle.checked = false;
            comExpInput.disabled = true;
        }
    }
    const updateComExp = () => {
        if (comExpToggle.checked) {
            let comExp = Number(comExpInput.value);
            localStorage.setItem('comExp', comExp); 
            comExpInput.disabled = false;
        } else {
            localStorage.setItem('comExp', 0);
            comExpInput.disabled = true;
        }
    }
    comExpToggle.onchange = updateComExp;
    comExpInput.onchange = updateComExp;

    // comDrop
    let comDropToggle = document.getElementById("comDropToggle");
    let comDropInput = document.getElementById("comDropInput");
    let comDrop = localStorage.getItem('comDrop');
    if (comDrop) {
        let comDropNumber = Number(comDrop);
        if (comDropNumber > 0) {
            comDropToggle.checked = true;
            comDropInput.value = comDropNumber;
        } else {
            comDropToggle.checked = false;
            comDropInput.disabled = true;
        }
    }
    const updateComDrop = () => {
        if (comDropToggle.checked) {
            let comDrop = Number(comDropInput.value);
            localStorage.setItem('comDrop', comDrop); 
            comDropInput.disabled = false;
        } else {
            localStorage.setItem('comDrop', 0);
            comDropInput.disabled = true;
        }
    }
    comDropToggle.onchange = updateComDrop;
    comDropInput.onchange = updateComDrop;
}


function updateState() {
    updateEquipmentState();
    updateLevels();
    updateFoodState();
    updateDrinksState();
    updateAbilityState();
}

function updateUI() {
    updateCombatStatsUI();
    updateFoodUI();
    updateDrinksUI();
    updateAbilityUI();
    refreshEquipmentEnhancementHints();

    updateContent();
    refreshHomeDiffHighlight();
}

const darkModeToggle = document.getElementById('darkModeToggle');
const body = document.body;

if (localStorage.getItem('darkModeEnabled') === 'true') {
    body.classList.add('dark-mode');
    const tables = document.getElementsByClassName('profit-table');
    for (const table of tables) {
        table.classList.toggle('table-striped');
    }
    darkModeToggle.checked = true;
}

darkModeToggle.addEventListener('change', () => {
    body.classList.toggle('dark-mode');
    const tables = document.getElementsByClassName('profit-table');
    for (const table of tables) {
        table.classList.toggle('table-striped');
    }
    localStorage.setItem('darkModeEnabled', darkModeToggle.checked);
});

function updateContent() {
    document.querySelectorAll('[data-i18n]').forEach(function (element) {
        const key = element.getAttribute('data-i18n');
        if (key) {
            element.textContent = i18next.t(key);
        }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (element) {
        const key = element.getAttribute('data-i18n-placeholder');
        if (key) {
            element.placeholder = i18next.t(key);
        }
    });

    document.querySelectorAll('option[data-i18n]').forEach(function (element) {
        const key = element.getAttribute('data-i18n');
        if (key) {
            element.textContent = i18next.t(key);
        }
    });
}

if (typeof i18next !== "undefined" && i18next?.on) {
    i18next.on("languageChanged", () => {
        updateContent();
        refreshAbilityUpgradeCostHints();
        refreshEquipmentEnhancementHints();
        renderQueueViewsForCurrentPlayer();
    });
}

// #region Baseline Queue

function createEmptyPlayerQueueState() {
    return {
        baseline: null,
        queueItems: [],
        runResults: [],
        multiRoundResults: null,
        enhancementUpgradeCosts: {},
        abilityUpgradeCosts: {},
        isRunning: false,
    };
}

function createInitialQueueState() {
    let result = {};
    for (const playerId of QUEUE_PLAYER_IDS) {
        result[playerId] = createEmptyPlayerQueueState();
    }
    return result;
}

function getCurrentPlayerQueueState() {
    return queueStateByPlayer[currentPlayerTabId];
}

function resetPlayerQueueState(playerId) {
    queueStateByPlayer[playerId] = createEmptyPlayerQueueState();
}

function initLeftMenuNavigation() {
    const menuHome = document.getElementById("leftMenuHome");
    const menuQueue = document.getElementById("leftMenuQueue");
    const menuResults = document.getElementById("leftMenuResults");
    const menuMultiResults = document.getElementById("leftMenuMultiResults");

    if (!menuHome || !menuQueue || !menuResults || !menuMultiResults) {
        return;
    }

    menuHome.addEventListener("click", () => switchLeftPage("home"));
    menuQueue.addEventListener("click", () => switchLeftPage("queue"));
    menuResults.addEventListener("click", () => switchLeftPage("results"));
    menuMultiResults.addEventListener("click", () => switchLeftPage("multiResults"));
    switchLeftPage("home");
}

function switchLeftPage(pageName) {
    activeLeftPage = pageName;

    const pageHome = document.getElementById("pageHome");
    const pageQueue = document.getElementById("pageQueue");
    const pageResults = document.getElementById("pageResults");
    const pageMultiResults = document.getElementById("pageMultiResults");
    const menuHome = document.getElementById("leftMenuHome");
    const menuQueue = document.getElementById("leftMenuQueue");
    const menuResults = document.getElementById("leftMenuResults");
    const menuMultiResults = document.getElementById("leftMenuMultiResults");

    if (
        !pageHome
        || !pageQueue
        || !pageResults
        || !pageMultiResults
        || !menuHome
        || !menuQueue
        || !menuResults
        || !menuMultiResults
    ) {
        return;
    }

    pageHome.classList.toggle("d-none", pageName !== "home");
    pageQueue.classList.toggle("d-none", pageName !== "queue");
    pageResults.classList.toggle("d-none", pageName !== "results");
    pageMultiResults.classList.toggle("d-none", pageName !== "multiResults");

    menuHome.classList.toggle("active", pageName === "home");
    menuQueue.classList.toggle("active", pageName === "queue");
    menuResults.classList.toggle("active", pageName === "results");
    menuMultiResults.classList.toggle("active", pageName === "multiResults");

    if (pageName === "multiResults") {
        renderMultiRoundResultsForCurrentPlayer();
    }
}

function initBaselineQueueControls() {
    const buttonSetBaseline = document.getElementById("buttonSetBaseline");
    const buttonSetBaselineInModal = document.getElementById("buttonSetBaselineInModal");
    const buttonAddToQueue = document.getElementById("buttonAddToQueue");
    const buttonRunQueue = document.getElementById("buttonRunQueue");
    const buttonConfirmRunQueue = document.getElementById("buttonConfirmRunQueue");
    const buttonClearQueue = document.getElementById("buttonClearQueue");
    const queueList = document.getElementById("queueList");
    const selectQueueRoundPreset = document.getElementById("selectQueueRoundPreset");
    const inputQueueRoundCustom = document.getElementById("inputQueueRoundCustom");
    const queueRoundCustomRow = document.getElementById("queueRoundCustomRow");
    const selectQueueExecutionMode = document.getElementById("selectQueueExecutionMode");

    if (
        !buttonSetBaseline
        || !buttonSetBaselineInModal
        || !buttonAddToQueue
        || !buttonRunQueue
        || !buttonConfirmRunQueue
        || !buttonClearQueue
        || !queueList
        || !selectQueueRoundPreset
        || !inputQueueRoundCustom
        || !queueRoundCustomRow
        || !selectQueueExecutionMode
    ) {
        return;
    }

    buttonSetBaseline.addEventListener("click", handleSetBaselineClick);
    buttonSetBaselineInModal.addEventListener("click", handleSetBaselineClick);
    buttonAddToQueue.addEventListener("click", handleAddToQueueClick);
    buttonRunQueue.addEventListener("click", handleRunQueueButtonClick);
    buttonConfirmRunQueue.addEventListener("click", handleRunQueueConfirmClick);
    buttonClearQueue.addEventListener("click", handleClearQueueClick);

    queueList.addEventListener("click", handleQueueListClick);
    selectQueueRoundPreset.value = String(QUEUE_MULTI_ROUND_DEFAULT);
    inputQueueRoundCustom.value = String(QUEUE_MULTI_ROUND_DEFAULT);
    selectQueueRoundPreset.addEventListener("change", syncQueueRoundCustomInputVisibility);
    selectQueueExecutionMode.value = "parallel";
    syncQueueRoundCustomInputVisibility();

    const watchedControlSelector = Array.from(WATCHED_CONTROL_IDS)
        .map((id) => "#" + CSS.escape(id))
        .join(",");

    document.addEventListener("change", (event) => {
        if (event.target && event.target.matches(watchedControlSelector)) {
            refreshHomeDiffHighlight();
        }
    }, true);

    document.addEventListener("input", (event) => {
        if (event.target && event.target.matches(watchedControlSelector)) {
            refreshHomeDiffHighlight();
        }
    }, true);
}

function queueNotice(messageKey) {
    alert(i18next.t(messageKey));
}

function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function normalizeQueueRoundCountValue(value) {
    const parsed = Math.floor(toFiniteNumber(value, QUEUE_MULTI_ROUND_DEFAULT));
    return clampNumber(parsed, QUEUE_MULTI_ROUND_MIN, QUEUE_MULTI_ROUND_MAX);
}

function normalizeQueueRoundCustomInput() {
    const input = document.getElementById("inputQueueRoundCustom");
    if (!input) {
        return QUEUE_MULTI_ROUND_DEFAULT;
    }

    const normalized = normalizeQueueRoundCountValue(input.value);
    input.value = String(normalized);
    return normalized;
}

function syncQueueRoundCustomInputVisibility() {
    const presetSelect = document.getElementById("selectQueueRoundPreset");
    const customRow = document.getElementById("queueRoundCustomRow");
    if (!presetSelect || !customRow) {
        return;
    }

    const useCustom = presetSelect.value === "custom";
    customRow.classList.toggle("d-none", !useCustom);
    if (useCustom) {
        normalizeQueueRoundCustomInput();
    }
}

function handleRunQueueButtonClick() {
    const modalElement = document.getElementById("runQueueModal");
    if (!modalElement || typeof bootstrap === "undefined" || !bootstrap?.Modal) {
        handleRunQueueClick();
        return;
    }

    syncQueueRoundCustomInputVisibility();
    const modalInstance = bootstrap.Modal.getOrCreateInstance(modalElement);
    modalInstance.show();
}

function handleRunQueueConfirmClick() {
    const modalElement = document.getElementById("runQueueModal");
    if (modalElement && typeof bootstrap !== "undefined" && bootstrap?.Modal) {
        const modalInstance = bootstrap.Modal.getOrCreateInstance(modalElement);
        modalInstance.hide();
    }

    handleRunQueueClick();
}

function getQueueMultiRoundConfigFromUI() {
    const presetSelect = document.getElementById("selectQueueRoundPreset");
    const selectedRoundPreset = presetSelect?.value ?? String(QUEUE_MULTI_ROUND_DEFAULT);
    const roundCount = selectedRoundPreset === "custom"
        ? normalizeQueueRoundCustomInput()
        : normalizeQueueRoundCountValue(selectedRoundPreset);
    const executionModeSelect = document.getElementById("selectQueueExecutionMode");
    const executionMode = executionModeSelect?.value === "serial" ? "serial" : "parallel";

    return {
        roundCount,
        executionMode,
    };
}

function getCurrentPlayerStateFromUI() {
    updateState();
    savePreviousPlayer(currentPlayerTabId);
    return JSON.parse(playerDataMap[currentPlayerTabId]);
}

function buildSnapshotFromUI() {
    const currentState = getCurrentPlayerStateFromUI();
    return buildSnapshotFromState(currentState);
}

function buildSnapshotFromState(state) {
    return {
        state: structuredClone(state),
        levels: extractLevelSnapshot(state),
        equipment: extractEquipmentSnapshot(state),
        food: extractFoodSnapshot(state),
        drinks: extractDrinkSnapshot(state),
        skills: extractSkillSnapshot(state),
        triggerMap: extractRelevantTriggerSnapshot(state),
    };
}

initEquipmentSection();
initHouseRoomsModal();
initAchievementsModal();
initLevelSection();
initFoodSection();
initDrinksSection();
initAbilitiesSection();
initZones();
initDungeons();
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

updateState();
updateUI();
renderQueueViewsForCurrentPlayer();
fetchAbilityUpgradeReferenceData();
fetchPrices();

function extractLevelSnapshot(state) {
    let levels = {};
    for (const key of LEVEL_KEYS) {
        levels[key] = Number(state.player?.[key + "Level"] ?? 1);
    }
    return levels;
}

function extractEquipmentSnapshot(state) {
    let equipment = {};
    for (const key of EQUIPMENT_SLOT_KEYS) {
        equipment[key] = {
            itemHrid: "",
            enhancementLevel: 0,
        };
    }
    equipment.weapon = {
        itemHrid: "",
        enhancementLevel: 0,
        location: "",
    };

    for (const item of (state.player?.equipment ?? [])) {
        const itemLocation = item.itemLocationHrid?.replace("/item_locations/", "");
        if (!itemLocation) {
            continue;
        }

        if (itemLocation === "main_hand" || itemLocation === "two_hand") {
            equipment.weapon = {
                itemHrid: item.itemHrid ?? "",
                enhancementLevel: Number(item.enhancementLevel ?? 0),
                location: itemLocation,
            };
            continue;
        }

        if (equipment[itemLocation]) {
            equipment[itemLocation] = {
                itemHrid: item.itemHrid ?? "",
                enhancementLevel: Number(item.enhancementLevel ?? 0),
            };
        }
    }

    return equipment;
}

function extractFoodSnapshot(state) {
    let foods = ["", "", ""];
    const foodList = state.food?.["/action_types/combat"] ?? [];
    for (let i = 0; i < 3; i++) {
        foods[i] = foodList[i]?.itemHrid ?? "";
    }
    return foods;
}

function extractDrinkSnapshot(state) {
    let drinks = ["", "", ""];
    const drinkList = state.drinks?.["/action_types/combat"] ?? [];
    for (let i = 0; i < 3; i++) {
        drinks[i] = drinkList[i]?.itemHrid ?? "";
    }
    return drinks;
}

function extractSkillSnapshot(state) {
    let skills = [];
    const abilityList = state.abilities ?? [];
    for (let i = 0; i < 5; i++) {
        skills.push({
            abilityHrid: abilityList[i]?.abilityHrid ?? "",
            level: Number(abilityList[i]?.level ?? 1),
        });
    }
    return skills;
}

function extractRelevantTriggerSnapshot(state) {
    let triggerSubset = {};
    const allTriggerMap = state.triggerMap ?? {};
    const relatedKeys = new Set([
        ...extractFoodSnapshot(state).filter((value) => value),
        ...extractDrinkSnapshot(state).filter((value) => value),
        ...extractSkillSnapshot(state).map((value) => value.abilityHrid).filter((value) => value),
    ]);

    for (const key of relatedKeys) {
        triggerSubset[key] = structuredClone(allTriggerMap[key] ?? []);
    }

    return triggerSubset;
}

function buildFixedSettingsFromUI() {
    const simAllZoneToggle = document.getElementById("simAllZoneToggle");
    const simAllSoloToggle = document.getElementById("simAllSoloToggle");
    const simDungeonToggle = document.getElementById("simDungeonToggle");
    const zoneSelect = document.getElementById("selectZone");
    const dungeonSelect = document.getElementById("selectDungeon");
    const difficultySelect = document.getElementById("selectDifficulty");
    const simulationTimeInput = document.getElementById("inputSimulationTime");
    const mooPassToggle = document.getElementById("mooPassToggle");
    const comExpToggle = document.getElementById("comExpToggle");
    const comExpInput = document.getElementById("comExpInput");
    const comDropToggle = document.getElementById("comDropToggle");
    const comDropInput = document.getElementById("comDropInput");
    const hpMpVisualizationToggle = document.getElementById("hpMpVisualizationToggle");

    if (simAllZoneToggle.checked || simAllSoloToggle.checked) {
        throw new Error(i18next.t("common:queue.baselineOnlySingleScene"));
    }

    const simDungeon = simDungeonToggle.checked;
    return {
        simDungeon,
        zoneHrid: simDungeon ? dungeonSelect.value : zoneSelect.value,
        difficultyTier: Number(difficultySelect.value),
        simulationTimeHours: Number(simulationTimeInput.value),
        extra: {
            mooPass: mooPassToggle.checked,
            comExp: comExpToggle.checked ? Number(comExpInput.value) : 0,
            comDrop: comDropToggle.checked ? Number(comDropInput.value) : 0,
            enableHpMpVisualization: hpMpVisualizationToggle.checked,
        },
    };
}

function runSinglePlayerSimulation(snapshot, settings, playerId, options = {}) {
    return new Promise((resolve, reject) => {
        const workerInstance = new Worker(new URL("worker.js", import.meta.url));
        const muteProgressBar = Boolean(options?.muteProgressBar);
        const onProgress = typeof options?.onProgress === "function" ? options.onProgress : null;
        const normalizedPlayerId = String(playerId);
        const playerToSim = buildPlayerFromStateForSimulation(snapshot.state, normalizedPlayerId);
        applyDebuffOnLevelGap([playerToSim]);

        const workerMessage = {
            type: "start_simulation",
            workerId: Math.floor(Math.random() * 1e9).toString(),
            players: [playerToSim],
            zone: {
                zoneHrid: settings.zoneHrid,
                difficultyTier: settings.difficultyTier,
            },
            simulationTimeLimit: settings.simulationTimeHours * ONE_HOUR,
            extra: settings.extra,
        };

        workerInstance.onmessage = (event) => {
            switch (event.data.type) {
                case "simulation_result":
                    workerInstance.terminate();
                    resolve(event.data.simResult);
                    break;
                case "simulation_progress":
                    if (!muteProgressBar) {
                        progressbar.style.width = Math.floor(event.data.progress * 100) + "%";
                    }
                    if (onProgress) {
                        try {
                            onProgress(event.data.progress);
                        } catch (callbackError) {
                            console.warn("runSinglePlayerSimulation progress callback failed", callbackError);
                        }
                    }
                    break;
                case "simulation_error":
                    workerInstance.terminate();
                    reject(event.data.error);
                    break;
            }
        };

        workerInstance.onerror = (error) => {
            workerInstance.terminate();
            reject(error);
        };

        workerInstance.postMessage(workerMessage);
    });
}

function resolveMarketplacePrice(itemHrid, selectorId) {
    let price = -1;
    const mode = document.getElementById(selectorId).value;

    if (!window.prices) {
        return price;
    }

    const item = window.prices[itemHrid];
    if (!item) {
        return price;
    }

    if (mode == "bid") {
        if (item["bid"] !== -1) {
            price = item["bid"];
        } else if (item["ask"] !== -1) {
            price = item["ask"];
        }
    } else if (mode == "ask") {
        if (item["ask"] !== -1) {
            price = item["ask"];
        } else if (item["bid"] !== -1) {
            price = item["bid"];
        }
    }

    if (price == -1) {
        price = item["vendor"];
    }

    return toFiniteNumber(price, -1);
}

function computeProfitTotals(simResult, playerToDisplay) {
    const { totalDropMap, noRngTotalDropMap, playerToDisplay: resolvedPlayerToDisplay } = getProfitDropMaps(simResult, playerToDisplay);
    let randomRevenue = 0;
    let noRngRevenue = 0;
    let expenses = 0;

    for (const [itemHrid, amount] of totalDropMap.entries()) {
        randomRevenue += resolveMarketplacePrice(itemHrid, "selectPrices_drops") * toFiniteNumber(amount, 0);
    }

    for (const [itemHrid, amount] of noRngTotalDropMap.entries()) {
        noRngRevenue += resolveMarketplacePrice(itemHrid, "selectPrices_drops") * toFiniteNumber(amount, 0);
    }

    const consumablesUsed = simResult.consumablesUsed?.[resolvedPlayerToDisplay] ?? {};
    for (const [consumable, amount] of Object.entries(consumablesUsed)) {
        expenses += resolveMarketplacePrice(consumable, "selectPrices_consumables") * toFiniteNumber(amount, 0);
    }

    return {
        randomRevenue: toFiniteNumber(randomRevenue, 0),
        noRngRevenue: toFiniteNumber(noRngRevenue, 0),
        expenses: toFiniteNumber(expenses, 0),
        randomProfit: toFiniteNumber(randomRevenue - expenses, 0),
        noRngProfit: toFiniteNumber(noRngRevenue - expenses, 0),
    };
}

function computeEncountersPerHour(simResult) {
    const hoursSimulated = toFiniteNumber(simResult?.simulatedTime, 0) / ONE_HOUR;
    const safeHours = hoursSimulated > 0 ? hoursSimulated : 1;

    if (simResult?.isDungeon) {
        const dungeonsCompleted = toFiniteNumber(simResult.dungeonsCompleted, 0);
        const dungeonHoursSimulated = toFiniteNumber(simResult.lastDungeonFinishTime, 0) > 0
            ? toFiniteNumber(simResult.lastDungeonFinishTime, 0) / ONE_HOUR
            : safeHours;
        const safeDungeonHours = dungeonHoursSimulated > 0 ? dungeonHoursSimulated : 1;
        return toFiniteNumber(dungeonsCompleted / safeDungeonHours, 0);
    }

    const encounters = toFiniteNumber(simResult?.encounters, 0);
    const encounterHoursSimulated = toFiniteNumber(simResult?.lastEncounterFinishTime, 0) > 0
        ? toFiniteNumber(simResult.lastEncounterFinishTime, 0) / ONE_HOUR
        : safeHours;
    const safeEncounterHours = encounterHoursSimulated > 0 ? encounterHoursSimulated : 1;
    return toFiniteNumber(encounters / safeEncounterHours, 0);
}

function getLocalizedZoneName(zoneHrid) {
    if (!zoneHrid) {
        return "";
    }

    const i18nKey = "actionNames." + zoneHrid;
    const translated = i18next.t(i18nKey);
    if (translated && translated !== i18nKey) {
        return translated;
    }

    return actionDetailMap[zoneHrid]?.name ?? zoneHrid;
}

function computeMetrics(simResult, playerToDisplay) {
    const preferredId = String(playerToDisplay ?? currentPlayerTabId).replace("player", "");
    const resolvedPlayerToDisplay = resolveSimResultPlayerHrid(simResult, preferredId) ?? playerToDisplay ?? "player1";

    const simulatedHours = toFiniteNumber(simResult.simulatedTime, 0) / ONE_HOUR;
    const simulatedSeconds = toFiniteNumber(simResult.simulatedTime, 0) / ONE_SECOND;
    const safeHours = simulatedHours > 0 ? simulatedHours : 1;
    const safeSeconds = simulatedSeconds > 0 ? simulatedSeconds : 1;

    let totalDamage = 0;
    const playerAttacks = simResult.attacks?.[resolvedPlayerToDisplay] ?? {};
    for (const abilities of Object.values(playerAttacks)) {
        for (const abilityCasts of Object.values(abilities)) {
            totalDamage += Object.entries(abilityCasts)
                .filter((entry) => entry[0] !== "miss")
                .reduce((prev, cur) => prev + toFiniteNumber(cur[0], 0) * toFiniteNumber(cur[1], 0), 0);
        }
    }

    const totalExperience = Object.values(simResult.experienceGained?.[resolvedPlayerToDisplay] ?? {})
        .reduce((prev, cur) => prev + toFiniteNumber(cur, 0), 0);

    const profits = computeProfitTotals(simResult, resolvedPlayerToDisplay);
    const encountersPerHour = computeEncountersPerHour(simResult);

    return {
        dps: toFiniteNumber(totalDamage / safeSeconds, 0),
        killsPerHour: encountersPerHour,
        xpPerHour: toFiniteNumber(totalExperience / safeHours, 0),
        dailyProfit: toFiniteNumber(profits.randomProfit / safeHours * 24, 0),
        dailyNoRngProfit: toFiniteNumber(profits.noRngProfit / safeHours * 24, 0),
    };
}

function computeMetricDeltas(metrics, baselineMetrics) {
    let result = {};
    for (const key of Object.keys(metrics)) {
        const baselineValue = Number(baselineMetrics[key] ?? 0);
        const currentValue = Number(metrics[key] ?? 0);
        const deltaAbs = currentValue - baselineValue;
        const deltaPct = baselineValue === 0 ? null : (deltaAbs / baselineValue * 100);
        result[key] = {
            abs: deltaAbs,
            pct: deltaPct,
        };
    }
    return result;
}

function stableStringify(value) {
    return JSON.stringify(sortObjectKeysDeep(value));
}

function sortObjectKeysDeep(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => sortObjectKeysDeep(entry));
    }

    if (value && typeof value === "object") {
        let result = {};
        for (const key of Object.keys(value).sort()) {
            result[key] = sortObjectKeysDeep(value[key]);
        }
        return result;
    }

    return value;
}

function diffSnapshots(baseSnapshot, targetSnapshot) {
    let changes = [];

    for (const key of LEVEL_KEYS) {
        if (baseSnapshot.levels[key] !== targetSnapshot.levels[key]) {
            changes.push({
                category: "profession",
                label: key.toUpperCase(),
                beforeValue: String(baseSnapshot.levels[key]),
                afterValue: String(targetSnapshot.levels[key]),
                controlIds: ["inputLevel_" + key],
            });
        }
    }

    const equipmentKeys = [...EQUIPMENT_SLOT_KEYS, "weapon"];
    for (const key of equipmentKeys) {
        const beforeValue = baseSnapshot.equipment[key];
        const afterValue = targetSnapshot.equipment[key];
        if (stableStringify(beforeValue) !== stableStringify(afterValue)) {
            let controlIds = [];
            if (key === "weapon") {
                controlIds = ["selectEquipment_weapon", "inputEquipmentEnhancementLevel_weapon"];
            } else {
                controlIds = ["selectEquipment_" + key, "inputEquipmentEnhancementLevel_" + key];
            }

            changes.push({
                category: "item",
                label: key,
                beforeValue: stringifyEquipmentValue(beforeValue),
                afterValue: stringifyEquipmentValue(afterValue),
                controlIds,
            });
        }
    }

    for (let i = 0; i < 3; i++) {
        if (baseSnapshot.food[i] !== targetSnapshot.food[i]) {
            changes.push({
                category: "food",
                label: "Food " + (i + 1),
                beforeValue: baseSnapshot.food[i] || "-",
                afterValue: targetSnapshot.food[i] || "-",
                controlIds: ["selectFood_" + i, "buttonFoodTrigger_" + i],
            });
        }

        if (baseSnapshot.drinks[i] !== targetSnapshot.drinks[i]) {
            changes.push({
                category: "drink",
                label: "Drink " + (i + 1),
                beforeValue: baseSnapshot.drinks[i] || "-",
                afterValue: targetSnapshot.drinks[i] || "-",
                controlIds: ["selectDrink_" + i, "buttonDrinkTrigger_" + i],
            });
        }
    }

    for (let i = 0; i < 5; i++) {
        const beforeSkill = baseSnapshot.skills[i];
        const afterSkill = targetSnapshot.skills[i];
        if (stableStringify(beforeSkill) !== stableStringify(afterSkill)) {
            changes.push({
                category: "skill",
                label: "Ability " + (i + 1),
                beforeValue: stringifySkillValue(beforeSkill),
                afterValue: stringifySkillValue(afterSkill),
                controlIds: ["selectAbility_" + i, "inputAbilityLevel_" + i, "buttonAbilityTrigger_" + i],
            });
        }
    }

    const triggerKeys = new Set([...Object.keys(baseSnapshot.triggerMap), ...Object.keys(targetSnapshot.triggerMap)]);
    for (const triggerKey of triggerKeys) {
        const beforeTriggers = baseSnapshot.triggerMap[triggerKey] ?? [];
        const afterTriggers = targetSnapshot.triggerMap[triggerKey] ?? [];
        if (stableStringify(beforeTriggers) !== stableStringify(afterTriggers)) {
            const currentIds = getTriggerControlIdsForKey(targetSnapshot, triggerKey);
            const fallbackIds = getTriggerControlIdsForKey(baseSnapshot, triggerKey);
            const controlIds = currentIds.length > 0 ? currentIds : fallbackIds;
            changes.push({
                category: "trigger",
                label: TRIGGER_CHANGE_LABEL_PREFIX + triggerKey,
                beforeValue: shortenText(stableStringify(beforeTriggers), 80),
                afterValue: shortenText(stableStringify(afterTriggers), 80),
                controlIds,
            });
        }
    }

    return changes;
}

function getTriggerControlIdsForKey(snapshot, triggerKey) {
    let controlIds = [];

    for (let i = 0; i < snapshot.food.length; i++) {
        if (snapshot.food[i] === triggerKey) {
            controlIds.push("buttonFoodTrigger_" + i);
        }
    }

    for (let i = 0; i < snapshot.drinks.length; i++) {
        if (snapshot.drinks[i] === triggerKey) {
            controlIds.push("buttonDrinkTrigger_" + i);
        }
    }

    for (let i = 0; i < snapshot.skills.length; i++) {
        if (snapshot.skills[i].abilityHrid === triggerKey) {
            controlIds.push("buttonAbilityTrigger_" + i);
        }
    }

    return controlIds;
}

function stringifyEquipmentValue(equipmentValue) {
    if (!equipmentValue || !equipmentValue.itemHrid) {
        return "-";
    }

    if (equipmentValue.location) {
        return `${equipmentValue.location}:${equipmentValue.itemHrid}(+${equipmentValue.enhancementLevel})`;
    }

    return `${equipmentValue.itemHrid}(+${equipmentValue.enhancementLevel})`;
}

function stringifySkillValue(skillValue) {
    if (!skillValue || !skillValue.abilityHrid) {
        return "-";
    }
    return `${skillValue.abilityHrid}(Lv.${skillValue.level})`;
}

function shortenText(text, maxLength) {
    if (text.length <= maxLength) {
        return text;
    }
    return text.substring(0, maxLength - 3) + "...";
}

function formatMetricValue(value, digits = 2) {
    const safeValue = toFiniteNumber(value, 0);
    return safeValue.toLocaleString(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
}

function formatCompactKMBValue(value, digits = 1) {
    const safeValue = toFiniteNumber(value, 0);
    const absValue = Math.abs(safeValue);
    const sign = safeValue < 0 ? "-" : "";
    const formatPart = (numberValue) => toFiniteNumber(numberValue, 0).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: digits,
    });

    if (absValue >= 1e6) {
        return sign + formatPart(absValue / 1e6) + "m";
    }
    if (absValue >= 1e3) {
        return sign + formatPart(absValue / 1e3) + "k";
    }

    return sign + formatPart(absValue);
}

function formatQueueMetricValue(metricKey, value, digits = 2) {
    if (metricKey === "dailyNoRngProfit" || metricKey === "xpPerHour") {
        return formatCompactKMBValue(value, 1);
    }
    return formatMetricValue(value, digits);
}

function computeQueueItemUpgradeCost(queueState, queueItem) {
    const baselineSnapshot = queueState?.baseline?.snapshot;
    const targetSnapshot = queueItem?.snapshot;
    if (!baselineSnapshot || !targetSnapshot) {
        return 0;
    }

    const enhancementCostMap = queueState?.enhancementUpgradeCosts ?? {};
    const abilityCostMap = queueState?.abilityUpgradeCosts ?? {};
    let totalCost = 0;

    for (const slotKey of [...EQUIPMENT_SLOT_KEYS, "weapon"]) {
        const beforeEquipment = baselineSnapshot.equipment?.[slotKey] ?? null;
        const afterEquipment = targetSnapshot.equipment?.[slotKey] ?? null;
        const beforeItemHrid = beforeEquipment?.itemHrid ?? "";
        const afterItemHrid = afterEquipment?.itemHrid ?? "";
        const beforeLevel = Number(beforeEquipment?.enhancementLevel ?? 0);
        const afterLevel = Number(afterEquipment?.enhancementLevel ?? 0);

        if (
            !beforeItemHrid
            || !afterItemHrid
            || beforeItemHrid !== afterItemHrid
            || !Number.isFinite(beforeLevel)
            || !Number.isFinite(afterLevel)
            || afterLevel <= beforeLevel
        ) {
            continue;
        }

        const selectType = slotKey === "weapon" ? "weapon" : slotKey;
        const costKey = getEnhancementUpgradeCostKey(selectType, afterItemHrid, beforeLevel, afterLevel);
        const estimatedCost = Object.prototype.hasOwnProperty.call(enhancementCostMap, costKey)
            ? toFiniteNumber(enhancementCostMap[costKey], 0)
            : toFiniteNumber(computeDefaultEnhancementUpgradeCost(afterItemHrid, beforeLevel, afterLevel), 0);

        totalCost += Math.max(0, estimatedCost);
    }

    for (let i = 0; i < 5; i++) {
        const beforeSkill = baselineSnapshot.skills?.[i] ?? null;
        const afterSkill = targetSnapshot.skills?.[i] ?? null;
        const beforeAbilityHrid = beforeSkill?.abilityHrid ?? "";
        const afterAbilityHrid = afterSkill?.abilityHrid ?? "";
        const beforeLevel = Number(beforeSkill?.level ?? 1);
        const afterLevel = Number(afterSkill?.level ?? 1);

        if (
            !beforeAbilityHrid
            || !afterAbilityHrid
            || beforeAbilityHrid !== afterAbilityHrid
            || !Number.isFinite(beforeLevel)
            || !Number.isFinite(afterLevel)
            || afterLevel <= beforeLevel
        ) {
            continue;
        }

        const costKey = getAbilityUpgradeCostKey(i, afterAbilityHrid, beforeLevel, afterLevel);
        const defaultCost = computeDefaultAbilityUpgradeCost(beforeSkill, afterLevel);
        const estimatedCost = Object.prototype.hasOwnProperty.call(abilityCostMap, costKey)
            ? toFiniteNumber(abilityCostMap[costKey], 0)
            : toFiniteNumber(defaultCost, 0);

        totalCost += Math.max(0, estimatedCost);
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

function formatPurchaseDuration(daysValue) {
    if (!Number.isFinite(daysValue) || daysValue == null || daysValue < 0) {
        return "-";
    }

    const hoursValue = daysValue * 24;
    if (hoursValue < 24) {
        return `${formatMetricValue(hoursValue, 1)}h`;
    }

    return `${formatMetricValue(daysValue, 1)}d`;
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

function buildGoldPerPoint01PctRangeMap(rowDataList, metricKeys) {
    let rangeMap = {};
    for (const metricKey of metricKeys) {
        const values = rowDataList
            .map((rowData) => rowData.goldPerPoint01Pct?.[metricKey])
            .filter((value) => Number.isFinite(value) && value > 0);

        if (values.length === 0) {
            rangeMap[metricKey] = null;
            continue;
        }

        rangeMap[metricKey] = {
            min: Math.min(...values),
            max: Math.max(...values),
        };
    }

    return rangeMap;
}

function formatDelta(deltaInfo, digits = 2, compactAbs = false) {
    const abs = Number(deltaInfo.abs ?? 0);
    const sign = abs > 0 ? "+" : "";
    const absText = sign + (compactAbs ? formatCompactKMBValue(abs, 1) : formatMetricValue(abs, digits));
    if (deltaInfo.pct == null) {
        return {
            text: absText,
            className: "",
        };
    }

    const pct = Number(deltaInfo.pct);
    const pctSign = pct > 0 ? "+" : "";
    const pctText = pctSign + formatMetricValue(pct, 2) + "%";
    return {
        text: `${absText} (${pctText})`,
        className: "",
    };
}

function setQueueRunningState(isRunning) {
    const state = getCurrentPlayerQueueState();
    state.isRunning = isRunning;
    const buttonSetBaseline = document.getElementById("buttonSetBaseline");
    const buttonSetBaselineInModal = document.getElementById("buttonSetBaselineInModal");
    const buttonAddToQueue = document.getElementById("buttonAddToQueue");
    const buttonRunQueue = document.getElementById("buttonRunQueue");
    const buttonConfirmRunQueue = document.getElementById("buttonConfirmRunQueue");
    const buttonClearQueue = document.getElementById("buttonClearQueue");
    const selectQueueRoundPreset = document.getElementById("selectQueueRoundPreset");
    const inputQueueRoundCustom = document.getElementById("inputQueueRoundCustom");
    const selectQueueExecutionMode = document.getElementById("selectQueueExecutionMode");

    if (!buttonSetBaseline || !buttonSetBaselineInModal || !buttonAddToQueue || !buttonRunQueue || !buttonClearQueue) {
        return;
    }

    buttonSetBaseline.disabled = isRunning;
    buttonSetBaselineInModal.disabled = isRunning;
    buttonAddToQueue.disabled = isRunning;
    buttonRunQueue.disabled = isRunning;
    if (buttonConfirmRunQueue) {
        buttonConfirmRunQueue.disabled = isRunning;
    }
    buttonClearQueue.disabled = isRunning;
    if (selectQueueRoundPreset) {
        selectQueueRoundPreset.disabled = isRunning;
    }
    if (inputQueueRoundCustom) {
        inputQueueRoundCustom.disabled = isRunning;
    }
    if (selectQueueExecutionMode) {
        selectQueueExecutionMode.disabled = isRunning;
    }
}

async function handleSetBaselineClick() {
    const queueState = getCurrentPlayerQueueState();
    if (queueState.isRunning) {
        return;
    }

    if (!importedProfileByPlayer[currentPlayerTabId]) {
        queueNotice("common:queue.requireImportBeforeBaseline");
        return;
    }

    let snapshot;
    let settings;
    try {
        snapshot = buildSnapshotFromUI();
        settings = buildFixedSettingsFromUI();
    } catch (error) {
        alert(error.message ?? String(error));
        return;
    }

    setQueueRunningState(true);
    progressbar.style.width = "0%";
    progressbar.innerHTML = i18next.t("common:queue.baselineRunning");

    try {
        const simResult = await runSinglePlayerSimulation(snapshot, settings, currentPlayerTabId);
        const playerToDisplay = "player" + currentPlayerTabId;
        const metrics = computeMetrics(simResult, playerToDisplay);
        queueState.baseline = {
            snapshot,
            settings,
            simResult,
            metrics,
            createdAt: Date.now(),
        };
        queueState.runResults = [];
        queueState.multiRoundResults = null;
        queueState.enhancementUpgradeCosts = {};
        queueState.abilityUpgradeCosts = {};
        window.lastSimulationResult = simResult;
        showSimulationResult(simResult);
        refreshAbilityUpgradeCostHints();
        refreshEquipmentEnhancementHints();
        updateContent();
        progressbar.style.width = "100%";
        progressbar.innerHTML = "100%";
        renderQueueViewsForCurrentPlayer();
        queueNotice("common:queue.baselineDone");
    } catch (error) {
        alert(error?.toString() ?? "baseline simulation failed");
    } finally {
        setQueueRunningState(false);
    }
}

function buildPlayerFromStateForSimulation(state, playerId) {
    const playerHrid = "player" + playerId;
    const playerState = state ?? {};

    let playerData = {
        hrid: playerHrid,
        food: [null, null, null],
        drinks: [null, null, null],
        abilities: [null, null, null, null, null],
        ...playerState.player,
        houseRooms: playerState.houseRooms ?? {},
        achievements: playerState.achievements ?? {},
    };
    playerData.equipment = {};

    const triggerMapForState = playerState.triggerMap ?? {};
    const playerEquipment = playerState.player?.equipment ?? [];
    ["head", "body", "legs", "feet", "hands", "off_hand", "pouch", "neck", "earrings", "ring", "back", "main_hand", "two_hand", "charm"].forEach((type) => {
        let currentEquipment = playerEquipment.find(item => item.itemLocationHrid === "/item_locations/" + type);
        if (currentEquipment) {
            playerData.equipment[`/equipment_types/${type}`] = new Equipment(currentEquipment.itemHrid, currentEquipment.enhancementLevel);
        }
    });

    let simulationPlayer = Player.createFromDTO(playerData);
    simulationPlayer.updateCombatDetails();
    simulationPlayer.hrid = playerHrid;

    const foodEntries = playerState.food?.["/action_types/combat"] ?? [];
    const drinkEntries = playerState.drinks?.["/action_types/combat"] ?? [];
    const abilityEntries = playerState.abilities ?? [];

    for (let i = 0; i < 3; i++) {
        const foodHrid = foodEntries[i]?.itemHrid ?? "";
        if (foodHrid && i < simulationPlayer.combatDetails.combatStats.foodSlots) {
            simulationPlayer.food[i] = new Consumable(foodHrid, triggerMapForState[foodHrid]);
        } else {
            simulationPlayer.food[i] = null;
        }

        const drinkHrid = drinkEntries[i]?.itemHrid ?? "";
        if (drinkHrid && i < simulationPlayer.combatDetails.combatStats.drinkSlots) {
            simulationPlayer.drinks[i] = new Consumable(drinkHrid, triggerMapForState[drinkHrid]);
        } else {
            simulationPlayer.drinks[i] = null;
        }
    }

    for (let i = 0; i < 5; i++) {
        const abilityEntry = abilityEntries[i] ?? {};
        const abilityHrid = abilityEntry.abilityHrid ?? "";
        const abilityLevel = toFiniteNumber(abilityEntry.level, 0);
        if (abilityHrid && abilityLevel > 0 && simulationPlayer.intelligenceLevel >= abilitySlotsLevelRequirementList[i + 1]) {
            simulationPlayer.abilities[i] = new Ability(abilityHrid, abilityLevel, triggerMapForState[abilityHrid]);
        } else {
            simulationPlayer.abilities[i] = null;
        }
    }

    return simulationPlayer;
}

function applyDebuffOnLevelGap(playersToSim) {
    let maxPlayerCombatLevel = 1;
    for (let currentPlayer of playersToSim) {
        currentPlayer.combatLevel = calcCombatLevel(currentPlayer.staminaLevel, currentPlayer.intelligenceLevel, currentPlayer.defenseLevel, currentPlayer.attackLevel, currentPlayer.meleeLevel, currentPlayer.rangedLevel, currentPlayer.magicLevel);
        maxPlayerCombatLevel = Math.max(maxPlayerCombatLevel, currentPlayer.combatLevel);
    }

    for (let currentPlayer of playersToSim) {
        if ((maxPlayerCombatLevel / currentPlayer.combatLevel) > 1.2) {
            const maxDebuffOnLevelGap = 0.9;
            let levelPercent = (maxPlayerCombatLevel / currentPlayer.combatLevel) - 1.2;
            currentPlayer.debuffOnLevelGap = -1 * Math.min(maxDebuffOnLevelGap, 3 * levelPercent);
            console.log("player " + currentPlayer.hrid + " debuff on level gap: " + currentPlayer.debuffOnLevelGap * 100 + "% for " + (maxPlayerCombatLevel / currentPlayer.combatLevel));
        } else {
            currentPlayer.debuffOnLevelGap = 0;
        }
    }
}

function buildPlayersForSimulation(playerIds) {
    let playersToSim = [];
    const normalizedIds = Array.from(new Set((playerIds ?? []).map((id) => String(id)).filter((id) => QUEUE_PLAYER_IDS.includes(id))));

    for (const playerId of normalizedIds) {
        const playerStateJson = playerDataMap[playerId];
        if (!playerStateJson) {
            continue;
        }

        let playerState = {};
        try {
            playerState = JSON.parse(playerStateJson);
        } catch (error) {
            console.warn("Invalid player state JSON for player", playerId, error);
            continue;
        }

        playersToSim.push(buildPlayerFromStateForSimulation(playerState, playerId));
    }

    applyDebuffOnLevelGap(playersToSim);
    return playersToSim;
}

function handleAddToQueueClick() {
    const queueState = getCurrentPlayerQueueState();
    if (!queueState.baseline) {
        queueNotice("common:queue.queueNoBaseline");
        return;
    }

    const snapshot = buildSnapshotFromUI();
    const changes = diffSnapshots(queueState.baseline.snapshot, snapshot);
    if (changes.length === 0) {
        queueNotice("common:queue.queueNoDiff");
        return;
    }

    const queueEntries = buildQueueEntriesForChanges(queueState.baseline.snapshot, snapshot, changes);
    for (const entry of queueEntries) {
        pushQueueItem(queueState, entry.snapshot, entry.changes);
    }
    queueState.multiRoundResults = null;

    restoreCurrentPlayerToBaselineSnapshot();
    renderQueueViewsForCurrentPlayer();
}

function restoreCurrentPlayerToBaselineSnapshot() {
    const queueState = getCurrentPlayerQueueState();
    const baselineState = queueState?.baseline?.snapshot?.state;
    if (!baselineState) {
        return;
    }

    try {
        playerDataMap[currentPlayerTabId] = JSON.stringify(baselineState);
        updateNextPlayer(currentPlayerTabId);
        updateState();
        updateUI();
        clearHomeDiffHighlight();
    } catch (error) {
        console.warn("failed to restore baseline snapshot after queue add", error);
    }
}

function pushQueueItem(queueState, snapshot, changes) {
    const queueItemNumber = queueState.queueItems.length + 1;
    queueState.queueItems.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: "",
        order: queueItemNumber,
        snapshot,
        changes,
        createdAt: Date.now(),
    });
}

function buildQueueEntriesForChanges(baseSnapshot, targetSnapshot, changes) {
    if (!Array.isArray(changes) || changes.length <= 1) {
        return [{ snapshot: targetSnapshot, changes }];
    }

    let entries = [];
    const seenSignatures = new Set();

    for (const change of changes) {
        const singleSnapshot = buildSingleChangeSnapshot(baseSnapshot, targetSnapshot, change);
        if (!singleSnapshot) {
            continue;
        }

        const singleChanges = diffSnapshots(baseSnapshot, singleSnapshot);
        if (singleChanges.length === 0) {
            continue;
        }

        const signature = stableStringify(singleChanges.map((entry) => ({
            category: entry.category,
            label: entry.label,
            beforeValue: entry.beforeValue,
            afterValue: entry.afterValue,
        })));
        if (seenSignatures.has(signature)) {
            continue;
        }

        seenSignatures.add(signature);
        entries.push({
            snapshot: singleSnapshot,
            changes: singleChanges,
        });
    }

    if (entries.length === 0) {
        return [{ snapshot: targetSnapshot, changes }];
    }

    return entries;
}

function buildSingleChangeSnapshot(baseSnapshot, targetSnapshot, change) {
    if (!change) {
        return null;
    }

    const baseState = structuredClone(baseSnapshot?.state ?? {});
    const targetState = targetSnapshot?.state ?? {};
    baseState.player = baseState.player ?? {};
    baseState.triggerMap = baseState.triggerMap ?? {};

    switch (change.category) {
        case "profession": {
            const skillKey = String(change.label ?? "").toLowerCase();
            if (!LEVEL_KEYS.includes(skillKey)) {
                return null;
            }
            baseState.player[skillKey + "Level"] = Number(targetState.player?.[skillKey + "Level"] ?? baseState.player[skillKey + "Level"] ?? 1);
            break;
        }
        case "item": {
            syncEquipmentChangeIntoState(baseState, targetState, String(change.label ?? ""));
            break;
        }
        case "food": {
            const index = parseOneBasedIndex(change.label);
            if (index < 0 || index >= 3) {
                return null;
            }
            ensureCombatConsumableState(baseState, "food", 3);
            const targetEntry = targetState.food?.["/action_types/combat"]?.[index] ?? { itemHrid: "" };
            baseState.food["/action_types/combat"][index] = structuredClone(targetEntry);
            syncTriggerForHridFromState(baseState, targetState, targetEntry.itemHrid);
            break;
        }
        case "drink": {
            const index = parseOneBasedIndex(change.label);
            if (index < 0 || index >= 3) {
                return null;
            }
            ensureCombatConsumableState(baseState, "drinks", 3);
            const targetEntry = targetState.drinks?.["/action_types/combat"]?.[index] ?? { itemHrid: "" };
            baseState.drinks["/action_types/combat"][index] = structuredClone(targetEntry);
            syncTriggerForHridFromState(baseState, targetState, targetEntry.itemHrid);
            break;
        }
        case "skill": {
            const index = parseOneBasedIndex(change.label);
            if (index < 0 || index >= 5) {
                return null;
            }
            ensureAbilityState(baseState, 5);
            const targetEntry = targetState.abilities?.[index] ?? { abilityHrid: "", level: 1 };
            baseState.abilities[index] = structuredClone(targetEntry);
            syncTriggerForHridFromState(baseState, targetState, targetEntry.abilityHrid);
            break;
        }
        case "trigger": {
            const triggerHrid = extractTriggerHridFromChange(change);
            if (!triggerHrid) {
                return null;
            }
            if (Object.prototype.hasOwnProperty.call(targetState.triggerMap ?? {}, triggerHrid)) {
                baseState.triggerMap[triggerHrid] = structuredClone(targetState.triggerMap[triggerHrid] ?? []);
            } else {
                delete baseState.triggerMap[triggerHrid];
            }
            break;
        }
        default:
            return null;
    }

    return buildSnapshotFromState(baseState);
}

function parseOneBasedIndex(label) {
    const text = String(label ?? "");
    const match = text.match(/(\d+)/);
    if (!match) {
        return -1;
    }
    return Number(match[1]) - 1;
}

function ensureCombatConsumableState(state, key, size) {
    state[key] = state[key] ?? {};
    state[key]["/action_types/combat"] = state[key]["/action_types/combat"] ?? [];

    while (state[key]["/action_types/combat"].length < size) {
        state[key]["/action_types/combat"].push({ itemHrid: "" });
    }
}

function ensureAbilityState(state, size) {
    state.abilities = state.abilities ?? [];
    while (state.abilities.length < size) {
        state.abilities.push({ abilityHrid: "", level: 1 });
    }
}

function syncTriggerForHridFromState(state, targetState, hrid) {
    if (!hrid) {
        return;
    }

    state.triggerMap = state.triggerMap ?? {};
    if (Object.prototype.hasOwnProperty.call(targetState.triggerMap ?? {}, hrid)) {
        state.triggerMap[hrid] = structuredClone(targetState.triggerMap[hrid] ?? []);
    } else if (!Object.prototype.hasOwnProperty.call(state.triggerMap, hrid)) {
        state.triggerMap[hrid] = [];
    }
}

function syncEquipmentChangeIntoState(state, targetState, slotLabel) {
    state.player = state.player ?? {};
    state.player.equipment = Array.isArray(state.player.equipment) ? state.player.equipment : [];
    const targetEquipment = Array.isArray(targetState.player?.equipment) ? targetState.player.equipment : [];
    const stateEquipment = Array.isArray(state.player?.equipment) ? state.player.equipment : [];

    const hasEquippedAtLocation = (equipmentList, locationKey) => {
        const locationHrid = "/item_locations/" + locationKey;
        return equipmentList.some((entry) => entry.itemLocationHrid === locationHrid && entry.itemHrid);
    };

    const syncLocation = (locationKey) => {
        const locationHrid = "/item_locations/" + locationKey;
        state.player.equipment = state.player.equipment.filter((entry) => entry.itemLocationHrid !== locationHrid);
        const targetEntry = targetEquipment.find((entry) => entry.itemLocationHrid === locationHrid);
        if (targetEntry && targetEntry.itemHrid) {
            state.player.equipment.push(structuredClone(targetEntry));
        }
    };

    if (slotLabel === "weapon") {
        syncLocation("main_hand");
        syncLocation("two_hand");
        // Off-hand should follow weapon change only when two-hand is involved.
        // This avoids unrelated off-hand changes being bundled into one queue entry.
        const baseHasTwoHand = hasEquippedAtLocation(stateEquipment, "two_hand");
        const targetHasTwoHand = hasEquippedAtLocation(targetEquipment, "two_hand");
        if (baseHasTwoHand || targetHasTwoHand) {
            syncLocation("off_hand");
        }
        return;
    }

    if (slotLabel) {
        syncLocation(slotLabel);
    }
}

function updateQueueRunProgressBar(completedRuns, totalRuns, messageText = "") {
    const safeTotal = Math.max(1, toFiniteNumber(totalRuns, 1));
    const safeCompleted = clampNumber(Math.floor(toFiniteNumber(completedRuns, 0)), 0, safeTotal);
    const progress = Math.floor(safeCompleted / safeTotal * 100);
    progressbar.style.width = progress + "%";

    const prefix = messageText ? (messageText + " ") : "";
    progressbar.innerHTML = `${progress}% (${safeCompleted}/${safeTotal}) ${prefix}`.trim();
}

function getQueueRunErrorMessage(error) {
    if (typeof error === "string") {
        return error;
    }
    if (error?.message) {
        return error.message;
    }
    return String(error ?? "unknown error");
}

async function runQueueItemSimulation(queueItem, queueState, options = {}) {
    const simResult = await runSinglePlayerSimulation(
        queueItem.snapshot,
        queueState.baseline.settings,
        currentPlayerTabId,
        options
    );
    const playerToDisplay = "player" + currentPlayerTabId;
    const metrics = computeMetrics(simResult, playerToDisplay);
    const deltas = computeMetricDeltas(metrics, queueState.baseline.metrics);

    return {
        queueItemId: queueItem.id,
        metrics,
        deltas,
        simResult,
        finishedAt: Date.now(),
    };
}

async function runQueueSingleRound(queueState) {
    queueState.runResults = [];
    queueState.multiRoundResults = null;
    progressbar.style.width = "0%";
    progressbar.innerHTML = i18next.t("common:queue.queueRunning");

    for (let i = 0; i < queueState.queueItems.length; i++) {
        const queueItem = queueState.queueItems[i];
        const roundResult = await runQueueItemSimulation(queueItem, queueState);
        queueState.runResults.push(roundResult);

        const progress = Math.floor(((i + 1) / queueState.queueItems.length) * 100);
        progressbar.style.width = progress + "%";
        progressbar.innerHTML = progress + "%";
    }
}

function resolveQueueParallelWorkerCount(roundCount) {
    const hardwareConcurrency = toFiniteNumber(
        typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 0,
        QUEUE_MULTI_ROUND_DEFAULT_PARALLEL_WORKERS
    );
    const maxWorkers = Math.max(1, Math.floor(hardwareConcurrency));
    return Math.max(1, Math.min(QUEUE_MULTI_ROUND_DEFAULT_PARALLEL_WORKERS, maxWorkers, roundCount));
}

async function runQueueItemRoundsSerial(queueItem, queueState, roundCount, onRoundCompleted) {
    let roundResults = [];
    for (let roundIndex = 0; roundIndex < roundCount; roundIndex++) {
        const runResult = await runQueueItemSimulation(queueItem, queueState, { muteProgressBar: true });
        roundResults.push(runResult);
        if (typeof onRoundCompleted === "function") {
            onRoundCompleted(runResult, roundIndex);
        }
    }
    return roundResults;
}

async function runQueueItemRoundsParallel(queueItem, queueState, roundCount, parallelWorkers, onRoundCompleted) {
    let roundResults = new Array(roundCount);
    let failedRounds = [];
    let nextRoundIndex = 0;

    const workerLoop = async () => {
        while (true) {
            const currentRoundIndex = nextRoundIndex;
            nextRoundIndex += 1;
            if (currentRoundIndex >= roundCount) {
                return;
            }

            try {
                const runResult = await runQueueItemSimulation(queueItem, queueState, { muteProgressBar: true });
                roundResults[currentRoundIndex] = runResult;
                if (typeof onRoundCompleted === "function") {
                    onRoundCompleted(runResult, currentRoundIndex);
                }
            } catch (error) {
                failedRounds.push({
                    roundIndex: currentRoundIndex,
                    error,
                });
            }
        }
    };

    const workerCount = Math.max(1, Math.min(parallelWorkers, roundCount));
    await Promise.all(Array.from({ length: workerCount }, () => workerLoop()));

    for (const failedRound of failedRounds) {
        try {
            const runResult = await runQueueItemSimulation(queueItem, queueState, { muteProgressBar: true });
            roundResults[failedRound.roundIndex] = runResult;
            if (typeof onRoundCompleted === "function") {
                onRoundCompleted(runResult, failedRound.roundIndex);
            }
        } catch (retryError) {
            const roundText = failedRound.roundIndex + 1;
            const errorText = getQueueRunErrorMessage(retryError);
            throw new Error(`Queue item "${queueItem.id}" round ${roundText} failed after retry: ${errorText}`);
        }
    }

    const hasMissingResult = roundResults.some((entry) => !entry);
    if (hasMissingResult) {
        throw new Error(`Queue item "${queueItem.id}" has incomplete multi-round results.`);
    }

    return roundResults;
}

async function runQueueRoundSerial(queueItemMetaList, queueState, roundIndex, onItemCompleted) {
    const roundResultByQueueItemId = new Map();

    for (const queueItemMeta of queueItemMetaList) {
        const runResult = await runQueueItemSimulation(queueItemMeta.item, queueState, { muteProgressBar: true });
        roundResultByQueueItemId.set(queueItemMeta.item.id, runResult);
        if (typeof onItemCompleted === "function") {
            onItemCompleted(queueItemMeta, roundIndex, runResult);
        }
    }

    return roundResultByQueueItemId;
}

async function runQueueRoundParallel(queueItemMetaList, queueState, roundIndex, parallelWorkers, onItemCompleted) {
    const roundResultByQueueItemId = new Map();
    let failedItems = [];
    let nextItemIndex = 0;
    let nextEmitIndex = 0;
    const pendingResultsByIndex = new Map();

    const emitReadyResults = () => {
        while (pendingResultsByIndex.has(nextEmitIndex)) {
            const readyResult = pendingResultsByIndex.get(nextEmitIndex);
            pendingResultsByIndex.delete(nextEmitIndex);
            nextEmitIndex += 1;

            roundResultByQueueItemId.set(readyResult.queueItemMeta.item.id, readyResult.runResult);
            if (typeof onItemCompleted === "function") {
                onItemCompleted(readyResult.queueItemMeta, roundIndex, readyResult.runResult);
            }
        }
    };

    const workerLoop = async () => {
        while (true) {
            const currentItemIndex = nextItemIndex;
            nextItemIndex += 1;
            if (currentItemIndex >= queueItemMetaList.length) {
                return;
            }

            const queueItemMeta = queueItemMetaList[currentItemIndex];
            try {
                const runResult = await runQueueItemSimulation(queueItemMeta.item, queueState, { muteProgressBar: true });
                pendingResultsByIndex.set(currentItemIndex, { queueItemMeta, runResult });
                emitReadyResults();
            } catch (error) {
                failedItems.push({
                    queueItemMeta,
                    itemIndex: currentItemIndex,
                    error,
                });
            }
        }
    };

    const workerCount = Math.max(1, Math.min(parallelWorkers, queueItemMetaList.length));
    await Promise.all(Array.from({ length: workerCount }, () => workerLoop()));

    for (const failedItem of failedItems) {
        try {
            const runResult = await runQueueItemSimulation(failedItem.queueItemMeta.item, queueState, { muteProgressBar: true });
            pendingResultsByIndex.set(failedItem.itemIndex, { queueItemMeta: failedItem.queueItemMeta, runResult });
            emitReadyResults();
        } catch (retryError) {
            const errorText = getQueueRunErrorMessage(retryError);
            throw new Error(`Queue item "${failedItem.queueItemMeta.item.id}" round ${roundIndex + 1} failed after retry: ${errorText}`);
        }
    }

    for (const queueItemMeta of queueItemMetaList) {
        if (!roundResultByQueueItemId.has(queueItemMeta.item.id)) {
            throw new Error(`Queue item "${queueItemMeta.item.id}" has missing result in round ${roundIndex + 1}.`);
        }
    }

    return roundResultByQueueItemId;
}

function computePercentileFromSorted(sortedValues, percentile) {
    if (!Array.isArray(sortedValues) || sortedValues.length === 0) {
        return 0;
    }

    if (sortedValues.length === 1) {
        return sortedValues[0];
    }

    const clampedPercentile = clampNumber(toFiniteNumber(percentile, 0), 0, 1);
    const rawIndex = (sortedValues.length - 1) * clampedPercentile;
    const lowerIndex = Math.floor(rawIndex);
    const upperIndex = Math.ceil(rawIndex);

    if (lowerIndex === upperIndex) {
        return sortedValues[lowerIndex];
    }

    const interpolation = rawIndex - lowerIndex;
    return sortedValues[lowerIndex] + (sortedValues[upperIndex] - sortedValues[lowerIndex]) * interpolation;
}

function summarizeMetric(values, deltaPctValues) {
    const safeValues = values.map((value) => toFiniteNumber(value, 0));
    if (safeValues.length === 0) {
        return {
            mean: 0,
            min: 0,
            max: 0,
            std: 0,
            p50: 0,
            p90: 0,
            cv: 1,
            meanDeltaPct: 0,
        };
    }

    const sum = safeValues.reduce((acc, cur) => acc + cur, 0);
    const mean = sum / safeValues.length;
    const min = Math.min(...safeValues);
    const max = Math.max(...safeValues);
    const variance = safeValues.reduce((acc, cur) => acc + ((cur - mean) ** 2), 0) / safeValues.length;
    const std = Math.sqrt(Math.max(0, variance));
    const cv = Math.abs(mean) > 1e-9 ? Math.abs(std / mean) : 1;
    const sorted = [...safeValues].sort((a, b) => a - b);
    const p50 = computePercentileFromSorted(sorted, 0.5);
    const p90 = computePercentileFromSorted(sorted, 0.9);

    const safeDeltaPctValues = deltaPctValues.filter((value) => Number.isFinite(value));
    const meanDeltaPct = safeDeltaPctValues.length > 0
        ? safeDeltaPctValues.reduce((acc, cur) => acc + cur, 0) / safeDeltaPctValues.length
        : 0;

    return {
        mean: toFiniteNumber(mean, 0),
        min: toFiniteNumber(min, 0),
        max: toFiniteNumber(max, 0),
        std: toFiniteNumber(std, 0),
        p50: toFiniteNumber(p50, 0),
        p90: toFiniteNumber(p90, 0),
        cv: toFiniteNumber(cv, 1),
        meanDeltaPct: toFiniteNumber(meanDeltaPct, 0),
    };
}

function buildQueueItemMetricSummary(roundResults) {
    let metricSummary = {};
    for (const metricKey of QUEUE_MULTI_ROUND_METRIC_KEYS) {
        const metricValues = roundResults.map((result) => toFiniteNumber(result?.metrics?.[metricKey], 0));
        const deltaPctValues = roundResults.map((result) => Number(result?.deltas?.[metricKey]?.pct));
        metricSummary[metricKey] = summarizeMetric(metricValues, deltaPctValues);
    }
    return metricSummary;
}

function normalizeScoreList(rawValues, options = {}) {
    const higherIsBetter = options.higherIsBetter !== false;
    const logScale = Boolean(options.logScale);
    const invalidScore = toFiniteNumber(options.invalidScore, 0);
    const tieScore = toFiniteNumber(options.tieScore, 50);

    const preparedValues = rawValues.map((value) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return null;
        }

        if (logScale) {
            return Math.log1p(Math.max(0, numeric));
        }

        return numeric;
    });

    const finiteValues = preparedValues.filter((value) => Number.isFinite(value));
    if (finiteValues.length === 0) {
        return rawValues.map(() => invalidScore);
    }

    const minValue = Math.min(...finiteValues);
    const maxValue = Math.max(...finiteValues);
    if (maxValue <= minValue) {
        return preparedValues.map((value) => (value == null ? invalidScore : tieScore));
    }

    return preparedValues.map((value) => {
        if (value == null) {
            return invalidScore;
        }

        const ratio = higherIsBetter
            ? (value - minValue) / (maxValue - minValue)
            : (maxValue - value) / (maxValue - minValue);
        return clampNumber(ratio * 100, 0, 100);
    });
}

function buildQueueItemCostInsights(queueState, queueItem, metricSummary) {
    const totalUpgradeCost = toFiniteNumber(computeQueueItemUpgradeCost(queueState, queueItem), 0);
    const purchaseDays = computePurchaseDaysByBaselineProfit(totalUpgradeCost, queueState?.baseline?.metrics?.dailyNoRngProfit);

    let goldPerPoint01Pct = {};
    for (const metricKey of QUEUE_MULTI_ROUND_METRIC_KEYS) {
        const meanDeltaPct = Number(metricSummary?.[metricKey]?.meanDeltaPct);
        goldPerPoint01Pct[metricKey] = computeGoldPerPoint01Pct(totalUpgradeCost, { pct: meanDeltaPct });
    }

    const validGoldValues = Object.values(goldPerPoint01Pct).filter((value) => Number.isFinite(value) && value > 0);
    const goldPerPoint01PctAvg = validGoldValues.length > 0
        ? validGoldValues.reduce((acc, cur) => acc + cur, 0) / validGoldValues.length
        : null;

    return {
        totalUpgradeCost,
        purchaseDays,
        goldPerPoint01Pct,
        goldPerPoint01PctAvg,
    };
}

function buildMultiRoundRanking(metricSummaryByQueueItem) {
    const normalizedScoresByMetric = {};

    for (const metricKey of QUEUE_MULTI_ROUND_METRIC_KEYS) {
        const scoreValues = metricSummaryByQueueItem.map((entry) => toFiniteNumber(entry.metricSummary?.[metricKey]?.meanDeltaPct, 0));
        normalizedScoresByMetric[metricKey] = normalizeScoreList(scoreValues, {
            higherIsBetter: true,
            tieScore: 50,
            invalidScore: 0,
        });
    }

    const upgradeCostScores = normalizeScoreList(
        metricSummaryByQueueItem.map((entry) => entry.costInsights?.totalUpgradeCost),
        {
            higherIsBetter: false,
            logScale: true,
            tieScore: 50,
            invalidScore: 0,
        }
    );
    const purchaseDaysScores = normalizeScoreList(
        metricSummaryByQueueItem.map((entry) => entry.costInsights?.purchaseDays),
        {
            higherIsBetter: false,
            logScale: true,
            tieScore: 50,
            invalidScore: 0,
        }
    );
    const avgGoldScores = normalizeScoreList(
        metricSummaryByQueueItem.map((entry) => entry.costInsights?.goldPerPoint01PctAvg),
        {
            higherIsBetter: false,
            logScale: true,
            tieScore: 50,
            invalidScore: 0,
        }
    );

    const ranked = metricSummaryByQueueItem.map((entry, index) => {
        const performanceScores = QUEUE_MULTI_ROUND_METRIC_KEYS.map((metricKey) => {
            return toFiniteNumber(normalizedScoresByMetric?.[metricKey]?.[index], 50);
        });
        const performanceScore = performanceScores.reduce((acc, cur) => acc + cur, 0) / Math.max(1, performanceScores.length);

        const cvList = QUEUE_MULTI_ROUND_METRIC_KEYS.map((metricKey) => {
            return toFiniteNumber(entry.metricSummary?.[metricKey]?.cv, 1);
        });
        const avgCv = cvList.reduce((acc, cur) => acc + cur, 0) / Math.max(1, cvList.length);
        const stabilityScore = clampNumber(100 * (1 - Math.min(avgCv, 1)), 0, 100);

        // Cost score weights:
        // upgrade cost 25% + purchase time 35% + gold per 0.01% 40%
        const costScore = (
            0.25 * toFiniteNumber(upgradeCostScores[index], 0)
            + 0.35 * toFiniteNumber(purchaseDaysScores[index], 0)
            + 0.40 * toFiniteNumber(avgGoldScores[index], 0)
        );

        // Final score weights:
        // performance 55% + stability 20% + cost efficiency 25%
        const finalScore = 0.55 * performanceScore + 0.20 * stabilityScore + 0.25 * costScore;

        return {
            queueItemId: entry.queueItemId,
            displayName: entry.displayName,
            order: entry.order,
            finalScore: toFiniteNumber(finalScore, 0),
            performanceScore: toFiniteNumber(performanceScore, 0),
            stabilityScore: toFiniteNumber(stabilityScore, 0),
            costScore: toFiniteNumber(costScore, 0),
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

function resolveQueueExecutionModeText(executionMode) {
    return executionMode === "serial"
        ? i18next.t("common:queue.modeSerial")
        : i18next.t("common:queue.modeParallel");
}

async function runQueueMultiRound(queueState, runConfig) {
    const queueItemMetaList = queueState.queueItems.map((item, index) => ({
        item,
        displayName: getQueueItemDisplayName(item, index + 1),
        order: index,
    }));

    const totalRuns = queueItemMetaList.length * runConfig.roundCount;
    let completedRuns = 0;
    const startedAt = Date.now();
    const parallelWorkers = runConfig.executionMode === "parallel"
        ? resolveQueueParallelWorkerCount(queueItemMetaList.length)
        : 1;

    const updateProgress = () => {
        completedRuns += 1;
        updateQueueRunProgressBar(completedRuns, totalRuns, i18next.t("common:queue.queueRunning"));
    };

    queueState.runResults = [];
    queueState.multiRoundResults = {
        config: {
            roundCount: runConfig.roundCount,
            executionMode: runConfig.executionMode,
            parallelWorkers,
            startedAt,
            finishedAt: null,
        },
        baselineMetrics: structuredClone(queueState.baseline.metrics),
        ranking: [],
        rawRows: [],
    };
    updateQueueRunProgressBar(0, totalRuns, i18next.t("common:queue.queueRunning"));
    if (activeLeftPage === "multiResults") {
        renderMultiRoundResultsForCurrentPlayer();
    }

    let rawRows = queueState.multiRoundResults.rawRows;
    const roundResultsByQueueItem = new Map(queueItemMetaList.map((meta) => [meta.item.id, []]));

    const onRoundCompleted = (queueItemMeta, roundIndex, runResult) => {
        const queueItemId = queueItemMeta.item.id;
        const resultList = roundResultsByQueueItem.get(queueItemId) ?? [];
        resultList.push(runResult);
        roundResultsByQueueItem.set(queueItemId, resultList);

        updateProgress();
        rawRows.push({
            queueItemId,
            displayName: queueItemMeta.displayName,
            queueOrder: queueItemMeta.order,
            roundIndex: roundIndex + 1,
            metrics: runResult?.metrics,
            deltas: runResult?.deltas,
        });
        rawRows.sort((a, b) => {
            const roundDiff = toFiniteNumber(a?.roundIndex, 0) - toFiniteNumber(b?.roundIndex, 0);
            if (roundDiff !== 0) {
                return roundDiff;
            }
            return toFiniteNumber(a?.queueOrder, 0) - toFiniteNumber(b?.queueOrder, 0);
        });

        const realtimeMetricSummaryByQueueItem = queueItemMetaList
            .map((meta) => {
                const queueItemResults = roundResultsByQueueItem.get(meta.item.id) ?? [];
                if (queueItemResults.length === 0) {
                    return null;
                }

                const metricSummary = buildQueueItemMetricSummary(queueItemResults);
                return {
                    queueItemId: meta.item.id,
                    displayName: meta.displayName,
                    order: meta.order,
                    metricSummary,
                    costInsights: buildQueueItemCostInsights(queueState, meta.item, metricSummary),
                };
            })
            .filter(Boolean);

        queueState.multiRoundResults.ranking = realtimeMetricSummaryByQueueItem.length > 0
            ? buildMultiRoundRanking(realtimeMetricSummaryByQueueItem)
            : [];

        if (activeLeftPage === "multiResults") {
            renderMultiRoundResultsForCurrentPlayer();
        }
    };

    for (let roundIndex = 0; roundIndex < runConfig.roundCount; roundIndex++) {
        if (runConfig.executionMode === "parallel") {
            await runQueueRoundParallel(queueItemMetaList, queueState, roundIndex, parallelWorkers, onRoundCompleted);
        } else {
            await runQueueRoundSerial(queueItemMetaList, queueState, roundIndex, onRoundCompleted);
        }

        const metricSummaryByQueueItem = queueItemMetaList.map((queueItemMeta) => {
            const queueItem = queueItemMeta.item;
            const roundResults = roundResultsByQueueItem.get(queueItem.id) ?? [];
            const metricSummary = buildQueueItemMetricSummary(roundResults);
            return {
                queueItemId: queueItem.id,
                displayName: queueItemMeta.displayName,
                order: queueItemMeta.order,
                metricSummary,
                costInsights: buildQueueItemCostInsights(queueState, queueItem, metricSummary),
            };
        });

        queueState.multiRoundResults.ranking = buildMultiRoundRanking(metricSummaryByQueueItem);
        if (activeLeftPage === "multiResults") {
            renderMultiRoundResultsForCurrentPlayer();
        }
    }

    const finalMetricSummaryByQueueItem = queueItemMetaList.map((queueItemMeta) => {
        const queueItem = queueItemMeta.item;
        const roundResults = roundResultsByQueueItem.get(queueItem.id) ?? [];
        const metricSummary = buildQueueItemMetricSummary(roundResults);
        return {
            queueItemId: queueItem.id,
            displayName: queueItemMeta.displayName,
            order: queueItemMeta.order,
            metricSummary,
            costInsights: buildQueueItemCostInsights(queueState, queueItem, metricSummary),
        };
    });

    queueState.multiRoundResults.config.finishedAt = Date.now();
    queueState.multiRoundResults.ranking = buildMultiRoundRanking(finalMetricSummaryByQueueItem);
}

async function handleRunQueueClick() {
    const queueState = getCurrentPlayerQueueState();
    if (!queueState.baseline) {
        queueNotice("common:queue.queueNoBaseline");
        return;
    }

    if (queueState.queueItems.length === 0) {
        queueNotice("common:queue.emptyQueue");
        return;
    }

    const runConfig = getQueueMultiRoundConfigFromUI();

    setQueueRunningState(true);
    try {
        if (runConfig.roundCount <= 1) {
            await runQueueSingleRound(queueState);
            renderQueueViewsForCurrentPlayer();
            switchLeftPage("results");
            queueNotice("common:queue.queueRunDone");
        } else {
            await runQueueMultiRound(queueState, runConfig);
            renderQueueViewsForCurrentPlayer();
            switchLeftPage("multiResults");
            queueNotice("common:multiRound.runDone");
        }
    } catch (error) {
        alert(error?.toString() ?? "queue run failed");
    } finally {
        setQueueRunningState(false);
    }
}

function handleClearQueueClick() {
    const queueState = getCurrentPlayerQueueState();
    queueState.queueItems = [];
    queueState.runResults = [];
    queueState.multiRoundResults = null;
    renderQueueViewsForCurrentPlayer();
    queueNotice("common:queue.queueCleared");
}

function handleQueueListClick(event) {
    const deleteButton = event.target.closest("[data-queue-item-id]");
    if (!deleteButton) {
        return;
    }

    const queueState = getCurrentPlayerQueueState();
    const queueItemId = deleteButton.getAttribute("data-queue-item-id");
    queueState.queueItems = queueState.queueItems.filter((item) => item.id !== queueItemId);
    queueState.runResults = queueState.runResults.filter((item) => item.queueItemId !== queueItemId);
    queueState.multiRoundResults = null;
    renderQueueViewsForCurrentPlayer();
}

function translateI18nKeyOrFallback(i18nKey, fallbackText) {
    const translated = i18next.t(i18nKey);
    return translated && translated !== i18nKey ? translated : fallbackText;
}

function getQueueItemDisplayName(item, fallbackIndex) {
    const derivedName = deriveQueueItemDisplayNameFromChanges(item?.changes ?? []);
    if (derivedName) {
        return derivedName;
    }

    const order = item?.order ?? fallbackIndex;
    return `${i18next.t("common:queue.queueItem")} ${order}`;
}

function resolveQueueItemDisplayNameById(queueState, queueItemId, fallbackText = "") {
    const queueItems = queueState?.queueItems ?? [];
    const queueItemIndex = queueItems.findIndex((item) => item.id === queueItemId);
    if (queueItemIndex >= 0) {
        return getQueueItemDisplayName(queueItems[queueItemIndex], queueItemIndex + 1);
    }

    if (fallbackText) {
        return fallbackText;
    }

    return queueItemId ?? "";
}

function deriveQueueItemDisplayNameFromChanges(changes) {
    if (!Array.isArray(changes) || changes.length === 0) {
        return "";
    }

    const categoryPriority = {
        item: 0,
        food: 1,
        drink: 2,
        skill: 3,
        trigger: 4,
        profession: 5,
    };

    const sortedChanges = [...changes].sort((a, b) => {
        const aPriority = categoryPriority[a?.category] ?? 99;
        const bPriority = categoryPriority[b?.category] ?? 99;
        return aPriority - bPriority;
    });

    let displayCandidates = [];
    for (const change of sortedChanges) {
        const candidate = deriveSingleQueueChangeDisplayName(change);
        if (candidate) {
            displayCandidates.push(candidate);
        }
    }

    const uniqueCandidates = Array.from(new Set(displayCandidates));
    if (uniqueCandidates.length === 0) {
        return "";
    }

    if (uniqueCandidates.length === 1) {
        return uniqueCandidates[0];
    }

    return i18next.t("common:queue.itemNameWithMore", {
        name: uniqueCandidates[0],
        count: uniqueCandidates.length - 1,
    });
}

function deriveSingleQueueChangeDisplayName(change) {
    if (!change) {
        return "";
    }

    if (change.category === "profession") {
        return localizeQueueChangeLabel(change);
    }

    if (change.category === "skill") {
        const beforeParsed = parseSkillChangeValue(change.beforeValue);
        const afterParsed = parseSkillChangeValue(change.afterValue);
        if (
            beforeParsed?.abilityHrid
            && afterParsed?.abilityHrid
            && beforeParsed.abilityHrid === afterParsed.abilityHrid
            && Number.isFinite(beforeParsed.level)
            && Number.isFinite(afterParsed.level)
        ) {
            const abilityName = localizeHridDisplayName(afterParsed.abilityHrid);
            const booksNeeded = computeAbilityBooksNeededForRange(afterParsed.abilityHrid, beforeParsed.level, afterParsed.level);
            if (booksNeeded != null) {
                return i18next.t("common:queue.skillLevelChangeWithBooks", {
                    name: abilityName,
                    from: beforeParsed.level,
                    to: afterParsed.level,
                    books: booksNeeded,
                });
            }
            return i18next.t("common:queue.skillLevelChange", {
                name: abilityName,
                from: beforeParsed.level,
                to: afterParsed.level,
            });
        }
    }

    if (change.category === "item") {
        const beforeParsed = parseEquipmentChangeValue(change.beforeValue);
        const afterParsed = parseEquipmentChangeValue(change.afterValue);
        if (beforeParsed?.itemHrid && afterParsed?.itemHrid && beforeParsed.itemHrid === afterParsed.itemHrid) {
            const itemName = localizeHridDisplayName(beforeParsed.itemHrid);
            return i18next.t("common:queue.itemEnhancementChange", {
                name: itemName,
                from: beforeParsed.enhancementLevel,
                to: afterParsed.enhancementLevel,
            });
        }

        const label = localizeQueueChangeLabel(change);
        const beforeText = localizeQueueChangeValue(change.beforeValue);
        const afterText = localizeQueueChangeValue(change.afterValue);

        const hasBefore = beforeText && beforeText !== "-";
        const hasAfter = afterText && afterText !== "-";
        if (hasBefore && hasAfter) {
            return `${label}: ${beforeText} -> ${afterText}`;
        }
        if (hasAfter) {
            return `${label}: ${afterText}`;
        }
        if (hasBefore) {
            return `${label}: ${beforeText}`;
        }

        return label;
    }

    if (change.category === "trigger") {
        const triggerHrid = extractTriggerHridFromChange(change);
        if (triggerHrid) {
            return localizeHridDisplayName(triggerHrid);
        }
        return i18next.t("common:queue.triggerLabel");
    }

    const preferredValue = pickPreferredChangedValue(change);
    if (!preferredValue) {
        return "";
    }

    const hrid = extractHridFromText(preferredValue);
    if (hrid) {
        return localizeHridDisplayName(hrid);
    }

    const localizedValue = localizeQueueChangeValue(preferredValue);
    if (localizedValue && localizedValue !== "-") {
        return localizedValue;
    }

    return localizeQueueChangeLabel(change);
}

function parseEquipmentChangeValue(value) {
    if (value == null) {
        return null;
    }

    const text = String(value).trim();
    if (!text || text === "-") {
        return null;
    }

    const match = text.match(/^(?:([a-z_]+):)?(\/items\/[a-z0-9_]+)\(\+([^)]+)\)$/i);
    if (!match) {
        return null;
    }

    return {
        slotKey: match[1] ?? "",
        itemHrid: match[2],
        enhancementLevel: match[3],
    };
}

function parseSkillChangeValue(value) {
    if (value == null) {
        return null;
    }

    const text = String(value).trim();
    if (!text || text === "-") {
        return null;
    }

    const match = text.match(/^(\/abilities\/[a-z0-9_]+)\(Lv\.([^)]+)\)$/i);
    if (!match) {
        return null;
    }

    const levelValue = Number(match[2]);
    if (!Number.isFinite(levelValue)) {
        return null;
    }

    return {
        abilityHrid: match[1],
        level: levelValue,
    };
}

function computeAbilityBooksNeededForRange(abilityHrid, fromLevel, toLevel) {
    if (
        !abilityHrid
        || !Number.isFinite(fromLevel)
        || !Number.isFinite(toLevel)
        || toLevel <= fromLevel
    ) {
        return null;
    }

    const startXp = getAbilityXpForLevel(fromLevel);
    const endXp = getAbilityXpForLevel(toLevel);
    if (startXp == null || endXp == null) {
        return null;
    }

    const xpNeeded = endXp - startXp;
    if (xpNeeded <= 0) {
        return 0;
    }

    const xpPerBook = getSpellBookXpForAbility(abilityHrid);
    if (!xpPerBook) {
        return null;
    }

    const booksNeeded = Math.ceil(xpNeeded / xpPerBook);
    return Number.isFinite(booksNeeded) && booksNeeded >= 0 ? booksNeeded : null;
}

function pickPreferredChangedValue(change) {
    const afterValue = normalizeChangeValue(change?.afterValue);
    if (afterValue) {
        return afterValue;
    }

    return normalizeChangeValue(change?.beforeValue);
}

function normalizeChangeValue(value) {
    if (value == null) {
        return "";
    }

    const text = String(value).trim();
    if (!text || text === "-") {
        return "";
    }

    return text;
}

function extractHridFromText(text) {
    if (!text) {
        return "";
    }

    const match = String(text).match(/\/(?:items|abilities|actions)\/[a-z0-9_]+/i);
    return match ? match[0] : "";
}

function extractTriggerHridFromChange(change) {
    const label = String(change?.label ?? "");
    if (label.startsWith(TRIGGER_CHANGE_LABEL_PREFIX)) {
        return label.substring(TRIGGER_CHANGE_LABEL_PREFIX.length);
    }

    return extractHridFromText(change?.afterValue) || extractHridFromText(change?.beforeValue);
}

function localizeHridDisplayName(hrid) {
    if (!hrid) {
        return hrid;
    }

    const keys = [
        "itemNames." + hrid,
        "abilityNames." + hrid,
        "actionNames." + hrid,
    ];

    for (const key of keys) {
        const translated = i18next.t(key);
        if (translated && translated !== key) {
            return translated;
        }
    }

    return hrid;
}

function localizeQueueCategory(category) {
    return translateI18nKeyOrFallback("common:queue.changeCategory." + category, category);
}

function localizeEquipmentSlotLabel(slotKey) {
    const slotI18nMap = {
        head: "characterItemsUtil.head",
        body: "characterItemsUtil.body",
        legs: "characterItemsUtil.legs",
        feet: "characterItemsUtil.feet",
        hands: "characterItemsUtil.hands",
        off_hand: "characterItemsUtil.offHand",
        pouch: "characterItemsUtil.pouch",
        neck: "characterItemsUtil.neck",
        earrings: "characterItemsUtil.earrings",
        ring: "characterItemsUtil.ring",
        back: "characterItemsUtil.back",
        charm: "characterItemsUtil.charm",
        main_hand: "characterItemsUtil.mainHand",
        two_hand: "characterItemsUtil.mainHand",
        weapon: "characterItemsUtil.mainHand",
    };

    const i18nKey = slotI18nMap[slotKey];
    if (!i18nKey) {
        return slotKey;
    }

    return translateI18nKeyOrFallback(i18nKey, slotKey);
}

function localizeQueueChangeLabel(change) {
    if (!change) {
        return "";
    }

    if (change.category === "profession") {
        const skillKey = String(change.label ?? "").toLowerCase();
        return translateI18nKeyOrFallback("skillNames./skills/" + skillKey, change.label);
    }

    if (change.category === "item") {
        return localizeEquipmentSlotLabel(change.label);
    }

    if (change.category === "food") {
        const index = Number(String(change.label).replace(/\D/g, "")) || 1;
        return i18next.t("common:queue.foodSlot", { index });
    }

    if (change.category === "drink") {
        const index = Number(String(change.label).replace(/\D/g, "")) || 1;
        return i18next.t("common:queue.drinkSlot", { index });
    }

    if (change.category === "skill") {
        const index = Number(String(change.label).replace(/\D/g, "")) || 1;
        return i18next.t("common:queue.abilitySlot", { index });
    }

    if (change.category === "trigger") {
        if (String(change.label).startsWith(TRIGGER_CHANGE_LABEL_PREFIX)) {
            const triggerHrid = String(change.label).substring(TRIGGER_CHANGE_LABEL_PREFIX.length);
            return `${i18next.t("common:queue.triggerLabel")} ${localizeHridDisplayName(triggerHrid)}`;
        }
        return i18next.t("common:queue.triggerLabel");
    }

    return change.label;
}

function localizeQueueChangeValue(value) {
    if (value == null) {
        return "-";
    }

    const text = String(value);
    if (!text || text === "-") {
        return "-";
    }

    const equipmentMatch = text.match(/^(?:([a-z_]+):)?(\/items\/[a-z0-9_]+)\(\+([^)]+)\)$/i);
    if (equipmentMatch) {
        const itemHrid = equipmentMatch[2];
        const enhancement = equipmentMatch[3];
        const itemName = localizeHridDisplayName(itemHrid);
        return `${itemName}(+${enhancement})`;
    }

    const abilityMatch = text.match(/^(\/abilities\/[a-z0-9_]+)\(Lv\.([^)]+)\)$/i);
    if (abilityMatch) {
        return `${localizeHridDisplayName(abilityMatch[1])}(Lv.${abilityMatch[2]})`;
    }

    if (/^\/(items|abilities|actions)\//.test(text)) {
        return localizeHridDisplayName(text);
    }

    return text;
}

function renderQueueViewsForCurrentPlayer() {
    renderBaselineSummary();
    renderQueueList();
    renderQueueResults();
    renderMultiRoundResultsForCurrentPlayer();
    refreshHomeDiffHighlight();
}

function renderBaselineSummary() {
    const baselineSummary = document.getElementById("baselineSummary");
    if (!baselineSummary) {
        return;
    }

    const queueState = getCurrentPlayerQueueState();
    if (!queueState.baseline) {
        baselineSummary.innerHTML = `<span class="text-secondary">${i18next.t("common:queue.emptyBaseline")}</span>`;
        return;
    }

    const baseline = queueState.baseline;
    const settings = baseline.settings;
    const zoneName = getLocalizedZoneName(settings.zoneHrid);
    const metrics = baseline.metrics;

    baselineSummary.innerHTML = `
        <div class="queue-summary-grid">
            <div class="mb-1"><span class="label">${i18next.t("common:queue.settingZone")}:</span> ${zoneName}</div>
            <div class="mb-1"><span class="label">${i18next.t("common:queue.settingDifficulty")}:</span> T${settings.difficultyTier}</div>
            <div class="mb-1"><span class="label">${i18next.t("common:queue.settingDuration")}:</span> ${settings.simulationTimeHours}h</div>
            <div class="mb-1"><span class="label">${i18next.t("common:queue.metricDps")}:</span> ${formatMetricValue(metrics.dps, 2)}</div>
            <div class="mb-1"><span class="label">${i18next.t("common:queue.dailyNoRngProfit")}:</span> ${formatQueueMetricValue("dailyNoRngProfit", metrics.dailyNoRngProfit, 2)}</div>
            <div class="mb-1"><span class="label">${i18next.t("common:simulationResults.xpPerHour")}:</span> ${formatQueueMetricValue("xpPerHour", metrics.xpPerHour, 0)}</div>
            <div class="mb-1"><span class="label">${i18next.t("common:simulationResults.killPerHour")}:</span> ${formatMetricValue(metrics.killsPerHour, 1)}</div>
        </div>
    `;
}

function renderQueueList() {
    const queueList = document.getElementById("queueList");
    if (!queueList) {
        return;
    }

    const queueState = getCurrentPlayerQueueState();
    if (queueState.queueItems.length === 0) {
        queueList.innerHTML = `<span class="text-secondary">${i18next.t("common:queue.emptyQueue")}</span>`;
        return;
    }

    queueList.replaceChildren();
    queueState.queueItems.forEach((item, index) => {
        const wrapper = document.createElement("div");
        wrapper.className = "border rounded p-2 mb-2";

        const titleRow = document.createElement("div");
        titleRow.className = "d-flex justify-content-between align-items-center mb-2";

        const title = document.createElement("b");
        title.textContent = getQueueItemDisplayName(item, index + 1);
        titleRow.appendChild(title);

        const removeButton = document.createElement("button");
        removeButton.className = "btn btn-sm btn-outline-danger";
        removeButton.type = "button";
        removeButton.textContent = i18next.t("common:controls.delete");
        removeButton.setAttribute("data-queue-item-id", item.id);
        titleRow.appendChild(removeButton);
        wrapper.appendChild(titleRow);

        const categoryRow = document.createElement("div");
        const categories = Array.from(new Set(item.changes.map((change) => change.category)));
        for (const category of categories) {
            const badge = document.createElement("span");
            badge.className = "queue-change-badge";
            badge.textContent = localizeQueueCategory(category);
            categoryRow.appendChild(badge);
        }
        wrapper.appendChild(categoryRow);

        const detailContainer = document.createElement("div");
        detailContainer.className = "small text-secondary mt-2";
        item.changes.forEach((change) => {
            const line = document.createElement("div");
            line.textContent = `${localizeQueueChangeLabel(change)}: ${localizeQueueChangeValue(change.beforeValue)} -> ${localizeQueueChangeValue(change.afterValue)}`;
            detailContainer.appendChild(line);
        });
        wrapper.appendChild(detailContainer);

        queueList.appendChild(wrapper);
    });
}

function renderQueueResults() {
    const tableBody = document.getElementById("queueResultsTableBody");
    const summary = document.getElementById("queueResultsSummary");
    if (!tableBody || !summary) {
        return;
    }

    const queueState = getCurrentPlayerQueueState();
    tableBody.replaceChildren();

    if (!queueState.baseline) {
        summary.innerHTML = `<span class="text-secondary">${i18next.t("common:queue.emptyBaseline")}</span>`;
        return;
    }

    const baseline = queueState.baseline.metrics;
    summary.innerHTML = `
        <span class="me-3"><b>${i18next.t("common:queue.baselineDps")}:</b> ${formatMetricValue(baseline.dps, 2)}</span>
        <span class="me-3"><b>${i18next.t("common:queue.dailyNoRngProfit")}:</b> ${formatQueueMetricValue("dailyNoRngProfit", baseline.dailyNoRngProfit, 2)}</span>
        <span class="me-3"><b>${i18next.t("common:simulationResults.xpPerHour")}:</b> ${formatQueueMetricValue("xpPerHour", baseline.xpPerHour, 0)}</span>
        <span><b>${i18next.t("common:simulationResults.killPerHour")}:</b> ${formatMetricValue(baseline.killsPerHour, 1)}</span>
    `;

    if (queueState.runResults.length === 0) {
        const emptyRow = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 15;
        cell.className = "text-secondary";
        cell.textContent = i18next.t("common:queue.emptyResults");
        emptyRow.appendChild(cell);
        tableBody.appendChild(emptyRow);
        return;
    }

    const queueItemMap = new Map(queueState.queueItems.map((item, index) => [item.id, {
        item,
        displayName: getQueueItemDisplayName(item, index + 1),
    }]));

    const metricKeys = ["dps", "dailyNoRngProfit", "xpPerHour", "killsPerHour"];
    const rowDataList = queueState.runResults.map((runResult) => {
        const queueItem = queueItemMap.get(runResult.queueItemId);
        const totalUpgradeCost = computeQueueItemUpgradeCost(queueState, queueItem?.item);
        return {
            runResult,
            queueItem,
            totalUpgradeCost,
            purchaseDays: computePurchaseDaysByBaselineProfit(totalUpgradeCost, baseline.dailyNoRngProfit),
            goldPerPoint01Pct: {
                dps: computeGoldPerPoint01Pct(totalUpgradeCost, runResult.deltas?.dps),
                dailyNoRngProfit: computeGoldPerPoint01Pct(totalUpgradeCost, runResult.deltas?.dailyNoRngProfit),
                xpPerHour: computeGoldPerPoint01Pct(totalUpgradeCost, runResult.deltas?.xpPerHour),
                killsPerHour: computeGoldPerPoint01Pct(totalUpgradeCost, runResult.deltas?.killsPerHour),
            },
        };
    });
    const goldPerPoint01PctRangeMap = buildGoldPerPoint01PctRangeMap(rowDataList, metricKeys);

    for (const rowData of rowDataList) {
        const row = document.createElement("tr");
        const runResult = rowData.runResult;
        const queueItem = rowData.queueItem;

        appendTextCell(row, queueItem?.displayName ?? runResult.queueItemId);
        appendTextCell(row, rowData.totalUpgradeCost > 0 ? formatCompactKMBValue(rowData.totalUpgradeCost, 1) : "-");
        appendTextCell(row, formatPurchaseDuration(rowData.purchaseDays));
        appendTextCell(row, formatMetricValue(runResult.metrics.dps, 2));
        appendDeltaCell(row, runResult.deltas.dps, 2);
        appendGoldPerPoint01PctCell(row, rowData.goldPerPoint01Pct.dps, goldPerPoint01PctRangeMap.dps);
        appendTextCell(row, formatQueueMetricValue("dailyNoRngProfit", runResult.metrics.dailyNoRngProfit, 2));
        appendDeltaCell(row, runResult.deltas.dailyNoRngProfit, 2, true);
        appendGoldPerPoint01PctCell(row, rowData.goldPerPoint01Pct.dailyNoRngProfit, goldPerPoint01PctRangeMap.dailyNoRngProfit);
        appendTextCell(row, formatQueueMetricValue("xpPerHour", runResult.metrics.xpPerHour, 0));
        appendDeltaCell(row, runResult.deltas.xpPerHour, 0, true);
        appendGoldPerPoint01PctCell(row, rowData.goldPerPoint01Pct.xpPerHour, goldPerPoint01PctRangeMap.xpPerHour);
        appendTextCell(row, formatMetricValue(runResult.metrics.killsPerHour, 1));
        appendDeltaCell(row, runResult.deltas.killsPerHour, 1);
        appendGoldPerPoint01PctCell(row, rowData.goldPerPoint01Pct.killsPerHour, goldPerPoint01PctRangeMap.killsPerHour);

        tableBody.appendChild(row);
    }
}

function appendEmptyTableRow(tableBody, colSpan, messageText) {
    const emptyRow = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = colSpan;
    cell.className = "text-secondary";
    cell.textContent = messageText;
    emptyRow.appendChild(cell);
    tableBody.appendChild(emptyRow);
}

function formatDeltaPctText(deltaInfo, digits = 2) {
    const pct = Number(deltaInfo?.pct);
    if (!Number.isFinite(pct)) {
        return "-";
    }

    const sign = pct > 0 ? "+" : "";
    return `${sign}${formatMetricValue(pct, digits)}%`;
}

function appendDeltaPctCell(row, deltaInfo, digits = 2) {
    const cell = document.createElement("td");
    const pct = Number(deltaInfo?.pct);
    cell.textContent = formatDeltaPctText(deltaInfo, digits);
    if (Number.isFinite(pct)) {
        if (pct > 0) {
            cell.classList.add("delta-positive");
        } else if (pct < 0) {
            cell.classList.add("delta-negative");
        }
    }
    row.appendChild(cell);
}

function resolveMultiRoundRankingRowClass(rank) {
    switch (Number(rank)) {
        case 1:
            return "multi-round-rank-top-1";
        case 2:
            return "multi-round-rank-top-2";
        case 3:
            return "multi-round-rank-top-3";
        case 4:
            return "multi-round-rank-top-4";
        case 5:
            return "multi-round-rank-top-5";
        default:
            return "";
    }
}

function renderMultiRoundResultsForCurrentPlayer() {
    const summaryDiv = document.getElementById("multiRoundSummary");
    const rankingTableBody = document.getElementById("multiRoundRankingTableBody");
    const rawTableBody = document.getElementById("multiRoundRawTableBody");
    if (!summaryDiv || !rankingTableBody || !rawTableBody) {
        return;
    }

    const queueState = getCurrentPlayerQueueState();
    const multiRoundResults = queueState?.multiRoundResults;

    rankingTableBody.replaceChildren();
    rawTableBody.replaceChildren();

    if (!multiRoundResults) {
        summaryDiv.innerHTML = `<span class="text-secondary">${i18next.t("common:multiRound.noData")}</span>`;
        appendEmptyTableRow(rankingTableBody, 14, i18next.t("common:multiRound.noData"));
        appendEmptyTableRow(rawTableBody, 10, i18next.t("common:multiRound.noData"));
        return;
    }

    const config = multiRoundResults.config ?? {};
    const baselineMetrics = multiRoundResults.baselineMetrics ?? {};
    const rawRows = Array.isArray(multiRoundResults.rawRows) ? multiRoundResults.rawRows : [];
    const finishedAtText = Number.isFinite(config.finishedAt) ? new Date(config.finishedAt).toLocaleString() : "-";
    const totalRuns = rawRows.length;
    const totalRoundCount = Math.max(0, Math.floor(toFiniteNumber(config.roundCount, 0)));
    const simCountByQueueItemId = new Map();
    for (const rawRowData of rawRows) {
        const queueItemId = String(rawRowData?.queueItemId ?? "");
        if (!queueItemId) {
            continue;
        }
        simCountByQueueItemId.set(queueItemId, (simCountByQueueItemId.get(queueItemId) ?? 0) + 1);
    }

    summaryDiv.innerHTML = `
        <div class="multi-round-summary-grid">
            <div class="mb-1"><span class="label">${i18next.t("common:multiRound.configRoundCount")}:</span> ${config.roundCount}</div>
            <div class="mb-1"><span class="label">${i18next.t("common:multiRound.configExecutionMode")}:</span> ${resolveQueueExecutionModeText(config.executionMode)}</div>
            <div class="mb-1"><span class="label">${i18next.t("common:multiRound.configParallelWorkers")}:</span> ${config.parallelWorkers}</div>
            <div class="mb-1"><span class="label">${i18next.t("common:multiRound.configTotalRuns")}:</span> ${totalRuns}</div>
            <div class="mb-1"><span class="label">${i18next.t("common:multiRound.configFinishedAt")}:</span> ${finishedAtText}</div>
            <div class="mb-1"><span class="label">${i18next.t("common:multiRound.baselineRef")}:</span> DPS ${formatMetricValue(baselineMetrics.dps, 2)} / ${i18next.t("common:queue.dailyNoRngProfit")} ${formatQueueMetricValue("dailyNoRngProfit", baselineMetrics.dailyNoRngProfit, 2)} / XP/h ${formatQueueMetricValue("xpPerHour", baselineMetrics.xpPerHour, 0)} / Kills/h ${formatMetricValue(baselineMetrics.killsPerHour, 1)}</div>
            <div class="mb-1"><span class="label">${i18next.t("common:multiRound.scoreModel")}:</span> ${i18next.t("common:multiRound.scoreModelValue")}</div>
            <div class="small text-secondary mt-1">
                <div>${i18next.t("common:multiRound.scoreModelParamPerformance")}</div>
                <div>${i18next.t("common:multiRound.scoreModelParamStability")}</div>
                <div>${i18next.t("common:multiRound.scoreModelParamCost")}</div>
            </div>
        </div>
    `;

    if (!Array.isArray(multiRoundResults.ranking) || multiRoundResults.ranking.length === 0) {
        appendEmptyTableRow(rankingTableBody, 14, i18next.t("common:multiRound.noData"));
    } else {
        const rankingFragment = document.createDocumentFragment();
        for (const entry of multiRoundResults.ranking) {
            const row = document.createElement("tr");
            const rankingRowClass = resolveMultiRoundRankingRowClass(entry.rank);
            if (rankingRowClass) {
                row.classList.add(rankingRowClass);
            }
            const localizedDisplayName = resolveQueueItemDisplayNameById(
                queueState,
                entry.queueItemId,
                entry.displayName ?? entry.queueItemId
            );
            const simDoneCount = Math.max(0, Math.floor(toFiniteNumber(simCountByQueueItemId.get(entry.queueItemId), 0)));
            const simCountText = totalRoundCount > 0
                ? `${simDoneCount}/${totalRoundCount}`
                : String(simDoneCount);
            appendTextCell(row, String(entry.rank));
            appendTextCell(row, localizedDisplayName);
            appendTextCell(row, simCountText);
            appendTextCell(row, formatMetricValue(entry.finalScore, 2));
            appendTextCell(row, formatMetricValue(entry.performanceScore, 2));
            appendTextCell(row, formatMetricValue(entry.stabilityScore, 2));
            appendTextCell(row, formatMetricValue(entry.costScore, 2));
            appendTextCell(row, entry.costInsights?.totalUpgradeCost > 0 ? formatCompactKMBValue(entry.costInsights.totalUpgradeCost, 1) : "-");
            appendTextCell(row, formatPurchaseDuration(entry.costInsights?.purchaseDays));
            appendTextCell(row, Number.isFinite(entry.costInsights?.goldPerPoint01PctAvg) && entry.costInsights.goldPerPoint01PctAvg > 0 ? formatCompactKMBValue(entry.costInsights.goldPerPoint01PctAvg, 1) : "-");
            appendTextCell(row, formatMetricValue(entry.metricSummary?.dps?.mean, 2));
            appendTextCell(row, formatQueueMetricValue("dailyNoRngProfit", entry.metricSummary?.dailyNoRngProfit?.mean, 2));
            appendTextCell(row, formatQueueMetricValue("xpPerHour", entry.metricSummary?.xpPerHour?.mean, 0));
            appendTextCell(row, formatMetricValue(entry.metricSummary?.killsPerHour?.mean, 1));
            rankingFragment.appendChild(row);
        }
        rankingTableBody.appendChild(rankingFragment);
    }

    if (rawRows.length === 0) {
        appendEmptyTableRow(rawTableBody, 10, i18next.t("common:multiRound.noData"));
        return;
    }

    const rawFragment = document.createDocumentFragment();
    for (const rawRowData of rawRows) {
        const row = document.createElement("tr");
        const localizedDisplayName = resolveQueueItemDisplayNameById(
            queueState,
            rawRowData.queueItemId,
            rawRowData.displayName ?? rawRowData.queueItemId
        );
        appendTextCell(row, localizedDisplayName);
        appendTextCell(row, String(rawRowData.roundIndex));
        appendTextCell(row, formatMetricValue(rawRowData.metrics?.dps, 2));
        appendDeltaPctCell(row, rawRowData.deltas?.dps);
        appendTextCell(row, formatQueueMetricValue("dailyNoRngProfit", rawRowData.metrics?.dailyNoRngProfit, 2));
        appendDeltaPctCell(row, rawRowData.deltas?.dailyNoRngProfit);
        appendTextCell(row, formatQueueMetricValue("xpPerHour", rawRowData.metrics?.xpPerHour, 0));
        appendDeltaPctCell(row, rawRowData.deltas?.xpPerHour);
        appendTextCell(row, formatMetricValue(rawRowData.metrics?.killsPerHour, 1));
        appendDeltaPctCell(row, rawRowData.deltas?.killsPerHour);
        rawFragment.appendChild(row);
    }
    rawTableBody.appendChild(rawFragment);
}

function appendTextCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = value == null || value === "" ? "-" : value;
    row.appendChild(cell);
}

function appendDeltaCell(row, deltaInfo, digits, compactAbs = false) {
    const cell = document.createElement("td");
    const delta = formatDelta(deltaInfo, digits, compactAbs);
    cell.textContent = delta.text;
    row.appendChild(cell);
}

function appendGoldPerPoint01PctCell(row, value, rangeInfo) {
    const cell = document.createElement("td");
    const safeValue = Number(value);
    const isValidValue = Number.isFinite(safeValue) && safeValue > 0;
    cell.textContent = isValidValue ? formatCompactKMBValue(safeValue, 1) : "-";

    if (
        isValidValue
        && rangeInfo
        && Number.isFinite(rangeInfo.min)
        && Number.isFinite(rangeInfo.max)
        && rangeInfo.min < rangeInfo.max
    ) {
        const epsilon = 1e-9;
        if (Math.abs(safeValue - rangeInfo.min) <= epsilon) {
            cell.classList.add("queue-ratio-best");
        } else if (Math.abs(safeValue - rangeInfo.max) <= epsilon) {
            cell.classList.add("queue-ratio-worst");
        }
    }

    row.appendChild(cell);
}

function clearHomeDiffHighlight() {
    for (const controlId of WATCHED_CONTROL_IDS) {
        const element = document.getElementById(controlId);
        if (element) {
            element.classList.remove("baseline-diff");
        }
    }
}

function refreshHomeDiffHighlight() {
    clearHomeDiffHighlight();

    const queueState = getCurrentPlayerQueueState();
    if (!queueState || !queueState.baseline) {
        return;
    }

    try {
        const currentSnapshot = buildSnapshotFromUI();
        const changes = diffSnapshots(queueState.baseline.snapshot, currentSnapshot);
        const changedControlIds = new Set(changes.flatMap((change) => change.controlIds ?? []));
        changedControlIds.forEach((controlId) => {
            const element = document.getElementById(controlId);
            if (element) {
                element.classList.add("baseline-diff");
            }
        });
    } catch (error) {
        console.warn("failed to refresh diff highlight", error);
    }
}

// #endregion

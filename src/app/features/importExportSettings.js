// Auto-generated from src/main.js (Error Handling)

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

function getFirstSelectOptionValue(selectElement) {
    const options = Array.from(selectElement?.options ?? []);
    if (options.length === 0) {
        return "";
    }
    return String(options[0]?.value ?? "");
}

function resolveNormalizedSelectValue(selectElement, value, fallbackValue = "") {
    const options = Array.from(selectElement?.options ?? []);
    if (options.length === 0) {
        return String(fallbackValue ?? "");
    }

    const desiredValue = String(value ?? "");
    if (options.some((option) => option.value === desiredValue)) {
        return desiredValue;
    }

    const fallback = String(fallbackValue ?? "");
    if (options.some((option) => option.value === fallback)) {
        return fallback;
    }

    return String(options[0].value ?? "");
}

function getDefaultSimulationSettings() {
    const zoneSelect = document.getElementById("selectZone");
    const dungeonSelect = document.getElementById("selectDungeon");
    const difficultySelect = document.getElementById("selectDifficulty");
    const simulationTimeInput = document.getElementById("inputSimulationTime");
    const labyrinthSelect = document.getElementById("selectLabyrinth");
    const roomLevelInput = document.getElementById("inputRoomLevel");

    const simulationTimeDefault = simulationTimeInput?.value ?? simulationTimeInput?.defaultValue ?? SIMULATION_SETTING_DEFAULTS.simulationTime;
    const roomLevelDefault = roomLevelInput?.value ?? roomLevelInput?.defaultValue ?? SIMULATION_SETTING_DEFAULTS.roomLevel;

    return {
        zone: resolveNormalizedSelectValue(zoneSelect, SIMULATION_SETTING_DEFAULTS.zone, getFirstSelectOptionValue(zoneSelect)),
        dungeon: resolveNormalizedSelectValue(dungeonSelect, SIMULATION_SETTING_DEFAULTS.dungeon, getFirstSelectOptionValue(dungeonSelect)),
        difficulty: resolveNormalizedSelectValue(difficultySelect, SIMULATION_SETTING_DEFAULTS.difficulty, getFirstSelectOptionValue(difficultySelect)),
        simulationTime: String(simulationTimeDefault ?? SIMULATION_SETTING_DEFAULTS.simulationTime),
        labyrinth: resolveNormalizedSelectValue(labyrinthSelect, SIMULATION_SETTING_DEFAULTS.labyrinth, getFirstSelectOptionValue(labyrinthSelect)),
        roomLevel: String(roomLevelDefault ?? SIMULATION_SETTING_DEFAULTS.roomLevel),
    };
}

function normalizeSimulationSettings(rawSettings) {
    const settings = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
    const defaults = getDefaultSimulationSettings();
    const zoneSelect = document.getElementById("selectZone");
    const dungeonSelect = document.getElementById("selectDungeon");
    const difficultySelect = document.getElementById("selectDifficulty");
    const labyrinthSelect = document.getElementById("selectLabyrinth");

    return {
        zone: resolveNormalizedSelectValue(zoneSelect, settings.zone, defaults.zone),
        dungeon: resolveNormalizedSelectValue(dungeonSelect, settings.dungeon, defaults.dungeon),
        difficulty: resolveNormalizedSelectValue(difficultySelect, settings.difficulty, defaults.difficulty),
        simulationTime: String(settings.simulationTime ?? defaults.simulationTime),
        labyrinth: resolveNormalizedSelectValue(labyrinthSelect, settings.labyrinth, defaults.labyrinth),
        roomLevel: String(settings.roomLevel ?? defaults.roomLevel),
    };
}

function normalizePlayerDataJsonSimulationSettings(playerDataJson) {
    if (typeof playerDataJson !== "string" || playerDataJson.trim().length === 0) {
        return playerDataJson;
    }

    try {
        const parsed = JSON.parse(playerDataJson);
        if (!parsed || typeof parsed !== "object") {
            return playerDataJson;
        }

        const normalizedSimulationSettings = normalizeSimulationSettings(parsed);
        return JSON.stringify({
            ...parsed,
            ...normalizedSimulationSettings,
        });
    } catch (error) {
        return playerDataJson;
    }
}

function normalizePlayerDataMapSimulationSettings(rawPlayerDataMap) {
    const snapshot = snapshotPlayerDataMap(rawPlayerDataMap);
    const normalized = {};
    for (const playerId of QUEUE_PLAYER_IDS) {
        normalized[playerId] = normalizePlayerDataJsonSimulationSettings(snapshot[playerId]);
    }
    return normalized;
}

function collectSimulationSettingsFromUI() {
    const zoneSelect = document.getElementById("selectZone");
    const dungeonSelect = document.getElementById("selectDungeon");
    const difficultySelect = document.getElementById("selectDifficulty");
    const simulationTimeInput = document.getElementById("inputSimulationTime");
    const labyrinthSelect = document.getElementById("selectLabyrinth");
    const roomLevelInput = document.getElementById("inputRoomLevel");

    return normalizeSimulationSettings({
        zone: zoneSelect?.value ?? "",
        dungeon: dungeonSelect?.value ?? "",
        difficulty: difficultySelect?.value ?? "",
        simulationTime: simulationTimeInput?.value ?? "",
        labyrinth: labyrinthSelect?.value ?? "",
        roomLevel: roomLevelInput?.value ?? "",
    });
}

function setSelectValueIfOptionExists(selectElement, value) {
    if (!selectElement || value == null) {
        return;
    }

    const targetValue = String(value);
    const hasOption = Array.from(selectElement.options ?? []).some((option) => option.value === targetValue);
    if (hasOption) {
        selectElement.value = targetValue;
    }
}

function applySimulationSettingsToUI(settings) {
    const normalizedSettings = normalizeSimulationSettings(settings);
    const zoneSelect = document.getElementById("selectZone");
    const dungeonSelect = document.getElementById("selectDungeon");
    const difficultySelect = document.getElementById("selectDifficulty");
    const simulationTimeInput = document.getElementById("inputSimulationTime");
    const labyrinthSelect = document.getElementById("selectLabyrinth");
    const roomLevelInput = document.getElementById("inputRoomLevel");

    setSelectValueIfOptionExists(zoneSelect, normalizedSettings.zone);
    setSelectValueIfOptionExists(dungeonSelect, normalizedSettings.dungeon);
    setSelectValueIfOptionExists(difficultySelect, normalizedSettings.difficulty);
    setSelectValueIfOptionExists(labyrinthSelect, normalizedSettings.labyrinth);
    if (simulationTimeInput) {
        simulationTimeInput.value = normalizedSettings.simulationTime;
    }
    if (roomLevelInput) {
        roomLevelInput.value = normalizedSettings.roomLevel;
    }
}

function doSoloExport() {
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
        ...collectSimulationSettingsFromUI(),
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

    playerDataMap = normalizePlayerDataMapSimulationSettings(playerDataMap);

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
            if (!field) continue;
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
            if (!field) continue;
            field.checked = false;
            player.achievements[detail.hrid] = false;
        }
    }
    refreshAchievementStatics();

    applySimulationSettingsToUI(importSet);

    importedProfileByPlayer[currentPlayerTabId] = true;
    resetPlayerQueueState(currentPlayerTabId);
    renderQueueViewsForCurrentPlayer();
}

function savePreviousPlayer(playerId) {
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
        ...collectSimulationSettingsFromUI(),
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
            if (!field) continue;
            field.checked = false;
            player.achievements[detail.hrid] = false;
        }
    }
    if (importSet.achievements) {
        for (const achievement in importSet.achievements) {
            const field = document.querySelector('[data-achievement-hrid="' + achievement + '"]');
            if (!field) continue;
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

    applySimulationSettingsToUI(importSet);
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

function updateContent() {
    document.querySelectorAll('[data-i18n]').forEach(function (element) {
        const key = element.getAttribute('data-i18n');
        if (key) {
            const translated = i18next.t(key);
            if (translated && translated !== key) {
                element.textContent = translated;
            } else {
                const fallback = element.getAttribute("data-i18n-fallback");
                if (fallback) {
                    element.textContent = fallback;
                }
            }
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
            const translated = i18next.t(key);
            if (translated && translated !== key) {
                element.textContent = translated;
            } else {
                const fallback = element.getAttribute("data-i18n-fallback");
                if (fallback) {
                    element.textContent = fallback;
                }
            }
        }
    });
}

function resolveI18nText(messageKey, options = {}) {
    if (typeof i18next === "undefined" || !i18next?.t) {
        return messageKey;
    }
    return i18next.t(messageKey, options);
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
        return structuredClone(defaults);
    }

    const total = performance + stability + cost;
    if (Math.abs(total - 1) > QUEUE_WEIGHT_SUM_EPSILON) {
        return structuredClone(defaults);
    }

    return {
        performance,
        stability,
        cost,
    };
}

function normalizeParallelWorkerLimit(value) {
    const parsed = Math.floor(toFiniteNumber(value, QUEUE_MULTI_ROUND_DEFAULT_PARALLEL_WORKERS));
    return clampNumber(parsed, QUEUE_PARALLEL_WORKER_LIMIT_MIN, QUEUE_PARALLEL_WORKER_LIMIT_MAX);
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
    return Math.max(QUEUE_PARALLEL_WORKER_LIMIT_MIN, Math.min(QUEUE_PARALLEL_WORKER_LIMIT_MAX, detectedCoreCount));
}

function getRecommendedParallelWorkerLimit() {
    const detectedCoreCount = getDetectedHardwareCoreCount();
    const upperBound = Number.isFinite(detectedCoreCount)
        ? Math.min(QUEUE_PARALLEL_WORKER_LIMIT_MAX, detectedCoreCount)
        : QUEUE_PARALLEL_WORKER_LIMIT_MAX;
    return Math.max(
        QUEUE_PARALLEL_WORKER_LIMIT_MIN,
        Math.min(QUEUE_MULTI_ROUND_DEFAULT_PARALLEL_WORKERS, upperBound)
    );
}

function refreshParallelWorkerHint() {
    const hintElement = document.getElementById("settingsParallelWorkerHint");
    const inputParallelWorkerLimit = document.getElementById("inputParallelWorkerLimit");
    if (!hintElement || !inputParallelWorkerLimit) {
        return;
    }

    const detectedCoreCount = getDetectedHardwareCoreCount();
    const hardMax = getParallelWorkerHardMaxForCurrentMachine();
    const recommended = getRecommendedParallelWorkerLimit();
    inputParallelWorkerLimit.max = String(hardMax);

    if (Number.isFinite(detectedCoreCount)) {
        hintElement.textContent = resolveI18nText("common:settingsPage.parallelWorkerHint", {
            cores: detectedCoreCount,
            recommended,
        });
    } else {
        hintElement.textContent = resolveI18nText("common:settingsPage.parallelWorkerHintUnknown", {
            recommended,
        });
    }
}

function normalizeQueueRuntimeSettings(settings) {
    return {
        finalWeights: normalizeQueueScoreWeights(settings?.finalWeights),
        parallelWorkerLimit: normalizeParallelWorkerLimit(settings?.parallelWorkerLimit),
    };
}

function loadQueueSettingsFromStorageOrDefault() {
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
        if (!parsed || parsed.version !== QUEUE_SETTINGS_STORAGE_VERSION) {
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

function saveQueueSettingsToStorage(settings) {
    if (typeof localStorage === "undefined") {
        throw new Error("localStorage unavailable");
    }

    const normalized = normalizeQueueRuntimeSettings(settings);
    const payload = {
        version: QUEUE_SETTINGS_STORAGE_VERSION,
        savedAt: Date.now(),
        finalWeights: structuredClone(normalized.finalWeights),
        parallelWorkerLimit: normalized.parallelWorkerLimit,
    };
    localStorage.setItem(QUEUE_SETTINGS_STORAGE_KEY, JSON.stringify(payload));
    return normalized;
}

function snapshotPlayerDataMap(rawPlayerDataMap) {
    let result = {};
    for (const playerId of QUEUE_PLAYER_IDS) {
        const sourceValue = rawPlayerDataMap?.[playerId];
        result[playerId] = typeof sourceValue === "string" ? sourceValue : "";
    }
    return result;
}

function normalizeStoredPlayerDataMap(rawPlayerDataMap, options = {}) {
    const allowPartial = options.allowPartial !== false;
    if (!rawPlayerDataMap || typeof rawPlayerDataMap !== "object") {
        return null;
    }

    let result = {};
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
            JSON.parse(playerDataValue);
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

    const normalized = normalizeStoredPlayerDataMap(normalizedPlayerDataMap, { allowPartial: true });
    if (!normalized) {
        localStorage.removeItem(PLAYER_DATA_SNAPSHOT_STORAGE_KEY);
        return null;
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
        return { status: "error" };
    }

    const rawValue = localStorage.getItem(PLAYER_DATA_SNAPSHOT_STORAGE_KEY);
    if (!rawValue) {
        return { status: "not_found" };
    }

    try {
        const parsed = JSON.parse(rawValue);
        if (!parsed || parsed.version !== PLAYER_DATA_SNAPSHOT_STORAGE_VERSION) {
            return { status: "invalid" };
        }

        const normalizedPlayerDataMap = normalizeStoredPlayerDataMap(parsed.playerDataMap, { allowPartial: true });
        if (!normalizedPlayerDataMap) {
            return { status: "invalid" };
        }

        return {
            status: "ok",
            savedAt: toFiniteNumber(parsed.savedAt, 0),
            playerDataMap: normalizedPlayerDataMap,
        };
    } catch (error) {
        return { status: "invalid" };
    }
}

function savePlayerDataSnapshotToStorage(rawPlayerDataMap) {
    if (typeof localStorage === "undefined") {
        throw new Error("localStorage unavailable");
    }

    const normalizedPlayerDataMap = normalizeStoredPlayerDataMap(
        snapshotPlayerDataMap(rawPlayerDataMap),
        { allowPartial: true }
    );
    if (!normalizedPlayerDataMap || Object.keys(normalizedPlayerDataMap).length === 0) {
        throw new Error("invalid player data snapshot");
    }

    return upsertPlayerDataSnapshotToStorage(normalizedPlayerDataMap);
}

function setSettingsStatusText(elementId, messageKey, tone = "secondary", options = {}) {
    const statusElement = document.getElementById(elementId);
    if (!statusElement) {
        return;
    }

    statusElement.classList.remove("text-secondary", "text-success", "text-danger");
    if (tone === "success") {
        statusElement.classList.add("text-success");
    } else if (tone === "danger") {
        statusElement.classList.add("text-danger");
    } else {
        statusElement.classList.add("text-secondary");
    }

    statusElement.textContent = resolveI18nText(messageKey, options);
}

function setSettingsQueueStatus(messageKey, tone = "secondary", options = {}) {
    setSettingsStatusText("settingsQueueStatus", messageKey, tone, options);
}

function setSettingsPlayerDataStatus(messageKey, tone = "secondary", options = {}) {
    setSettingsStatusText("settingsPlayerDataStatus", messageKey, tone, options);
}

function parsePlayerSnapshotSummary(playerDataJson) {
    try {
        const parsed = JSON.parse(playerDataJson);
        const zoneHrid = String(parsed?.zone ?? "");
        const localizedZone = zoneHrid ? getLocalizedZoneName(zoneHrid) : "";
        const zoneDisplay = localizedZone || zoneHrid || "-";
        const dungeonHrid = String(parsed?.dungeon ?? "");
        const localizedDungeon = dungeonHrid ? getLocalizedZoneName(dungeonHrid) : "";
        const dungeonDisplay = localizedDungeon || dungeonHrid || "-";
        const difficultyRaw = String(parsed?.difficulty ?? "");
        const difficultyDisplay = difficultyRaw
            ? (difficultyRaw.startsWith("T") ? difficultyRaw : `T${difficultyRaw}`)
            : "-";
        const labyrinthHrid = String(parsed?.labyrinth ?? "");
        const labyrinthI18nKey = "monsterNames." + labyrinthHrid;
        const localizedLabyrinth = labyrinthHrid ? i18next.t(labyrinthI18nKey) : "";
        const labyrinthFallbackName = combatMonsterDetailMap[labyrinthHrid]?.name ?? "";
        const labyrinthDisplay = labyrinthHrid
            ? ((localizedLabyrinth && localizedLabyrinth !== labyrinthI18nKey) ? localizedLabyrinth : (labyrinthFallbackName || labyrinthHrid))
            : "-";
        const roomLevelRaw = String(parsed?.roomLevel ?? "");
        const roomLevelDisplay = roomLevelRaw || "-";
        return {
            zone: zoneDisplay,
            zoneHrid,
            dungeon: dungeonDisplay,
            dungeonHrid,
            difficulty: difficultyDisplay,
            labyrinth: labyrinthDisplay,
            labyrinthHrid,
            roomLevel: roomLevelDisplay,
            simulationTime: String(parsed?.simulationTime ?? "-"),
        };
    } catch (error) {
        return {
            zone: "-",
            zoneHrid: "",
            dungeon: "-",
            dungeonHrid: "",
            difficulty: "-",
            labyrinth: "-",
            labyrinthHrid: "",
            roomLevel: "-",
            simulationTime: "-",
        };
    }
}

function escapeHtml(rawText) {
    return String(rawText ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function createSnapshotHeaderText(savedAt) {
    const savedAtText = savedAt > 0 ? new Date(savedAt).toLocaleString() : "-";
    return resolveI18nText("common:settingsPage.playerSnapshotSavedAt", { time: savedAtText });
}

function renderPlayerSnapshotList() {
    const container = document.getElementById("settingsPlayerSnapshotList");
    if (!container) {
        return;
    }

    const loadResult = loadPlayerDataSnapshotFromStorage();
    if (loadResult.status !== "ok") {
        container.innerHTML = `<div class="text-secondary">${resolveI18nText("common:settingsPage.playerSnapshotNoData")}</div>`;
        return;
    }

    const playerDataSnapshot = loadResult.playerDataMap ?? {};
    const titleText = resolveI18nText("common:settingsPage.playerSnapshotTitle");
    const headerText = createSnapshotHeaderText(loadResult.savedAt);
    const tableHeadPlayer = resolveI18nText("common:settingsPage.playerSnapshotTablePlayer");
    const tableHeadZone = resolveI18nText("common:settingsPage.playerSnapshotTableZone");
    const tableHeadDungeon = resolveI18nText("common:settingsPage.playerSnapshotTableDungeon");
    const tableHeadDifficulty = resolveI18nText("common:settingsPage.playerSnapshotTableDifficulty");
    const tableHeadDuration = resolveI18nText("common:settingsPage.playerSnapshotTableDuration");
    const tableHeadLabyrinth = resolveI18nText("common:settingsPage.playerSnapshotTableLabyrinth");
    const tableHeadRoomLevel = resolveI18nText("common:settingsPage.playerSnapshotTableRoomLevel");
    const tableHeadActions = resolveI18nText("common:settingsPage.playerSnapshotTableActions");
    const deleteActionText = resolveI18nText("common:settingsPage.deleteSinglePlayerConfig");
    const missingText = resolveI18nText("common:settingsPage.playerSnapshotMissing");

    const tableRowsHtml = QUEUE_PLAYER_IDS.map((playerId) => {
        const playerDataJson = playerDataSnapshot[playerId];
        if (!playerDataJson) {
            return `
                <tr>
                    <td>Player ${escapeHtml(playerId)}</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td><span class="text-secondary">${missingText}</span></td>
                </tr>
            `;
        }

        const summary = parsePlayerSnapshotSummary(playerDataJson);
        return `
            <tr>
                <td>Player ${escapeHtml(playerId)}</td>
                <td>${escapeHtml(summary.zone)}</td>
                <td>${escapeHtml(summary.dungeon)}</td>
                <td>${escapeHtml(summary.difficulty)}</td>
                <td>${escapeHtml(summary.simulationTime)}</td>
                <td>${escapeHtml(summary.labyrinth)}</td>
                <td>${escapeHtml(summary.roomLevel)}</td>
                <td>
                    <button type="button" class="btn btn-sm btn-outline-danger" data-player-snapshot-delete="${playerId}">
                        ${deleteActionText}
                    </button>
                </td>
            </tr>
        `;
    }).join("");

    container.innerHTML = `
        <div class="small text-secondary mb-2">${titleText} - ${headerText}</div>
        <div class="table-responsive">
            <table class="table table-bordered table-sm mb-0">
                <thead>
                    <tr>
                        <th>${tableHeadPlayer}</th>
                        <th>${tableHeadZone}</th>
                        <th>${tableHeadDungeon}</th>
                        <th>${tableHeadDifficulty}</th>
                        <th>${tableHeadDuration}</th>
                        <th>${tableHeadLabyrinth}</th>
                        <th>${tableHeadRoomLevel}</th>
                        <th>${tableHeadActions}</th>
                    </tr>
                </thead>
                <tbody>${tableRowsHtml}</tbody>
            </table>
        </div>
    `;

    container.querySelectorAll("[data-player-snapshot-delete]").forEach((buttonElement) => {
        buttonElement.addEventListener("click", () => {
            const playerId = String(buttonElement.getAttribute("data-player-snapshot-delete") ?? "");
            if (!playerId) {
                return;
            }
            handleDeleteSinglePlayerConfigSnapshotClick(playerId);
        });
    });
}

function formatWeightPercent(weightValue) {
    return Number((toFiniteNumber(weightValue, 0) * 100).toFixed(2)).toString();
}

function syncQueueSettingsInputsFromRuntime() {
    const inputScoreWeightPerformance = document.getElementById("inputScoreWeightPerformance");
    const inputScoreWeightStability = document.getElementById("inputScoreWeightStability");
    const inputScoreWeightCost = document.getElementById("inputScoreWeightCost");
    const inputParallelWorkerLimit = document.getElementById("inputParallelWorkerLimit");
    if (!inputScoreWeightPerformance || !inputScoreWeightStability || !inputScoreWeightCost || !inputParallelWorkerLimit) {
        return;
    }

    const normalizedSettings = normalizeQueueRuntimeSettings(queueRuntimeSettings);
    const hardMaxForMachine = getParallelWorkerHardMaxForCurrentMachine();
    inputScoreWeightPerformance.value = formatWeightPercent(normalizedSettings.finalWeights.performance);
    inputScoreWeightStability.value = formatWeightPercent(normalizedSettings.finalWeights.stability);
    inputScoreWeightCost.value = formatWeightPercent(normalizedSettings.finalWeights.cost);
    inputParallelWorkerLimit.value = String(Math.min(normalizedSettings.parallelWorkerLimit, hardMaxForMachine));
    refreshParallelWorkerHint();
}

function readQueueSettingsFromForm() {
    const inputScoreWeightPerformance = document.getElementById("inputScoreWeightPerformance");
    const inputScoreWeightStability = document.getElementById("inputScoreWeightStability");
    const inputScoreWeightCost = document.getElementById("inputScoreWeightCost");
    const inputParallelWorkerLimit = document.getElementById("inputParallelWorkerLimit");
    if (!inputScoreWeightPerformance || !inputScoreWeightStability || !inputScoreWeightCost || !inputParallelWorkerLimit) {
        return {
            ok: false,
            messageKey: "common:settingsPage.queueSaveErrorMissingControls",
        };
    }

    const performancePct = Number(inputScoreWeightPerformance.value);
    const stabilityPct = Number(inputScoreWeightStability.value);
    const costPct = Number(inputScoreWeightCost.value);
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

    const parallelWorkerLimitRaw = Number(inputParallelWorkerLimit.value);
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
}

function handleSaveQueueSettingsClick() {
    const readResult = readQueueSettingsFromForm();
    if (!readResult.ok) {
        const messageText = resolveI18nText(readResult.messageKey, readResult.messageOptions ?? {});
        setSettingsQueueStatus(readResult.messageKey, "danger", readResult.messageOptions ?? {});
        alert(messageText);
        return;
    }

    try {
        queueRuntimeSettings = saveQueueSettingsToStorage(readResult.settings);
        syncQueueSettingsInputsFromRuntime();
        setSettingsQueueStatus("common:settingsPage.queueSaveSuccess", "success");
    } catch (error) {
        const messageText = resolveI18nText("common:settingsPage.queueSaveErrorStorage");
        setSettingsQueueStatus("common:settingsPage.queueSaveErrorStorage", "danger");
        alert(messageText);
    }
}

function handleResetQueueSettingsClick() {
    try {
        queueRuntimeSettings = saveQueueSettingsToStorage(getDefaultQueueRuntimeSettings());
        syncQueueSettingsInputsFromRuntime();
        setSettingsQueueStatus("common:settingsPage.queueResetSuccess", "success");
    } catch (error) {
        const messageText = resolveI18nText("common:settingsPage.queueSaveErrorStorage");
        setSettingsQueueStatus("common:settingsPage.queueSaveErrorStorage", "danger");
        alert(messageText);
    }
}

function handleSavePlayerConfigsClick() {
    savePreviousPlayer(currentPlayerTabId);
    playerDataMap = normalizePlayerDataMapSimulationSettings(playerDataMap);
    try {
        savePlayerDataSnapshotToStorage(playerDataMap);
        setSettingsPlayerDataStatus("common:settingsPage.playerSaveSuccess", "success");
        renderPlayerSnapshotList();
    } catch (error) {
        const messageText = resolveI18nText("common:settingsPage.playerSaveError");
        setSettingsPlayerDataStatus("common:settingsPage.playerSaveError", "danger");
        alert(messageText);
    }
}

function handleLoadPlayerConfigsClick() {
    const loadResult = loadPlayerDataSnapshotFromStorage();
    if (loadResult.status === "not_found") {
        setSettingsPlayerDataStatus("common:settingsPage.playerLoadNotFound", "danger");
        renderPlayerSnapshotList();
        return;
    }
    if (loadResult.status !== "ok") {
        setSettingsPlayerDataStatus("common:settingsPage.playerLoadInvalid", "danger");
        renderPlayerSnapshotList();
        return;
    }

    const loadedPlayerIds = Object.keys(loadResult.playerDataMap ?? {});
    if (loadedPlayerIds.length === 0) {
        setSettingsPlayerDataStatus("common:settingsPage.playerLoadInvalid", "danger");
        renderPlayerSnapshotList();
        return;
    }

    const mergedPlayerDataMap = snapshotPlayerDataMap(playerDataMap);
    for (const playerId of loadedPlayerIds) {
        mergedPlayerDataMap[playerId] = loadResult.playerDataMap[playerId];
    }
    playerDataMap = normalizePlayerDataMapSimulationSettings(mergedPlayerDataMap);

    for (const playerId of loadedPlayerIds) {
        importedProfileByPlayer[playerId] = true;
        resetPlayerQueueState(playerId);
    }

    updateNextPlayer(currentPlayerTabId);
    updateState();
    updateUI();
    renderQueueViewsForCurrentPlayer();

    const savedAtText = loadResult.savedAt > 0
        ? new Date(loadResult.savedAt).toLocaleString()
        : "-";
    setSettingsPlayerDataStatus("common:settingsPage.playerLoadSuccess", "success", { time: savedAtText });
    renderPlayerSnapshotList();
}

function handleDeleteSinglePlayerConfigSnapshotClick(playerId) {
    const loadResult = loadPlayerDataSnapshotFromStorage();
    if (loadResult.status !== "ok") {
        setSettingsPlayerDataStatus("common:settingsPage.playerLoadNotFound", "danger");
        renderPlayerSnapshotList();
        return;
    }

    const nextPlayerDataMap = { ...(loadResult.playerDataMap ?? {}) };
    delete nextPlayerDataMap[playerId];

    try {
        if (Object.keys(nextPlayerDataMap).length === 0) {
            clearPlayerDataSnapshotFromStorage();
        } else {
            upsertPlayerDataSnapshotToStorage(nextPlayerDataMap);
        }
        setSettingsPlayerDataStatus("common:settingsPage.playerDeleteSingleSuccess", "success", { playerId });
        renderPlayerSnapshotList();
    } catch (error) {
        const messageText = resolveI18nText("common:settingsPage.playerDeleteError");
        setSettingsPlayerDataStatus("common:settingsPage.playerDeleteError", "danger");
        alert(messageText);
    }
}

function handleDeleteAllPlayerConfigsClick() {
    try {
        clearPlayerDataSnapshotFromStorage();
        setSettingsPlayerDataStatus("common:settingsPage.playerDeleteAllSuccess", "success");
        renderPlayerSnapshotList();
    } catch (error) {
        const messageText = resolveI18nText("common:settingsPage.playerDeleteError");
        setSettingsPlayerDataStatus("common:settingsPage.playerDeleteError", "danger");
        alert(messageText);
    }
}

function initSettingsPageControls() {
    const buttonSaveQueueSettings = document.getElementById("buttonSaveQueueSettings");
    const buttonResetQueueSettings = document.getElementById("buttonResetQueueSettings");
    const buttonSavePlayerConfigs = document.getElementById("buttonSavePlayerConfigs");
    const buttonLoadPlayerConfigs = document.getElementById("buttonLoadPlayerConfigs");
    const buttonDeletePlayerConfigs = document.getElementById("buttonDeletePlayerConfigs");
    const inputScoreWeightPerformance = document.getElementById("inputScoreWeightPerformance");
    const inputScoreWeightStability = document.getElementById("inputScoreWeightStability");
    const inputScoreWeightCost = document.getElementById("inputScoreWeightCost");
    const inputParallelWorkerLimit = document.getElementById("inputParallelWorkerLimit");
    const settingsParallelWorkerHint = document.getElementById("settingsParallelWorkerHint");
    const settingsQueueStatus = document.getElementById("settingsQueueStatus");
    const settingsPlayerDataStatus = document.getElementById("settingsPlayerDataStatus");
    const settingsPlayerSnapshotList = document.getElementById("settingsPlayerSnapshotList");

    if (
        !buttonSaveQueueSettings
        || !buttonResetQueueSettings
        || !buttonSavePlayerConfigs
        || !buttonLoadPlayerConfigs
        || !buttonDeletePlayerConfigs
        || !inputScoreWeightPerformance
        || !inputScoreWeightStability
        || !inputScoreWeightCost
        || !inputParallelWorkerLimit
        || !settingsParallelWorkerHint
        || !settingsQueueStatus
        || !settingsPlayerDataStatus
        || !settingsPlayerSnapshotList
    ) {
        return;
    }

    syncQueueSettingsInputsFromRuntime();
    refreshParallelWorkerHint();
    setSettingsQueueStatus("common:settingsPage.statusReady");
    setSettingsPlayerDataStatus("common:settingsPage.statusReady");
    renderPlayerSnapshotList();

    buttonSaveQueueSettings.addEventListener("click", handleSaveQueueSettingsClick);
    buttonResetQueueSettings.addEventListener("click", handleResetQueueSettingsClick);
    buttonSavePlayerConfigs.addEventListener("click", handleSavePlayerConfigsClick);
    buttonLoadPlayerConfigs.addEventListener("click", handleLoadPlayerConfigsClick);
    buttonDeletePlayerConfigs.addEventListener("click", handleDeleteAllPlayerConfigsClick);
}

function bootstrapGlobalErrorUiBindings() {
    window.prices;

    document.getElementById("buttonGetPrices").onclick = async () => {
        await fetchPrices();
    };

    document.addEventListener("input", (e) => {
        let element = e.target;
        if (element.tagName == "TD" && element.parentNode.parentNode.parentNode.classList.value.includes("profit-table")) {
            let tableId = element.parentNode.parentNode.parentNode.id;
            let row = element.parentNode.querySelectorAll("td");
            let item = row[0].getAttribute("data-i18n").split(".")[1];
            let newPrice = element.innerText;

            let revenueSetting = document.getElementById("selectPrices_drops").value;
            let expensesSetting = document.getElementById("selectPrices_consumables").value;

            let expensesDifference = 0;
            let revenueDifference = 0;
            let noRngRevenueDifference = 0;

            if (tableId == "expensesTable") {
                expensesDifference = updateTable("expensesTable", item, newPrice);
                if (revenueSetting == expensesSetting) {
                    revenueDifference = updateTable("revenueTable", item, newPrice);
                    noRngRevenueDifference = updateTable("noRngRevenueTable", item, newPrice);
                }
                if (window.prices) {
                    if (!window.prices[item]) window.prices[item] = { "ask": -1, "bid": -1, "vendor": itemDetailMap[item].sellPrice };
                    if (expensesSetting == "bid") {
                        window.prices[item]["bid"] = newPrice;
                    } else {
                        window.prices[item]["ask"] = newPrice;
                    }
                }
            } else {
                revenueDifference = updateTable("revenueTable", item, newPrice);
                noRngRevenueDifference = updateTable("noRngRevenueTable", item, newPrice);
                if (revenueSetting == expensesSetting) {
                    expensesDifference = updateTable("expensesTable", item, newPrice);
                }
                if (window.prices) {
                    if (!window.prices[item]) window.prices[item] = { "ask": -1, "bid": -1, "vendor": itemDetailMap[item].sellPrice };
                    if (revenueSetting == "bid") {
                        window.prices[item]["bid"] = newPrice;
                    } else {
                        window.prices[item]["ask"] = newPrice;
                    }
                }
            }

            window.expenses += expensesDifference;
            document.getElementById("expensesSpan").innerText = window.expenses.toLocaleString();
            document.getElementById("expensesPreview").innerText = window.expenses.toLocaleString();
            window.revenue += revenueDifference;
            document.getElementById("revenueSpan").innerText = window.revenue.toLocaleString();
            document.getElementById("revenuePreview").innerText = window.revenue.toLocaleString();
            window.noRngRevenue += noRngRevenueDifference;
            document.getElementById("noRngRevenueSpan").innerText = window.noRngRevenue.toLocaleString();

            window.profit = window.revenue - window.expenses;
            document.getElementById("profitPreview").innerText = window.profit.toLocaleString();
            document.getElementById("profitSpan").innerText = window.profit.toLocaleString();
            window.noRngProfit = window.noRngRevenue - window.expenses;
            document.getElementById("noRngProfitSpan").innerText = window.noRngProfit.toLocaleString();
            document.getElementById("noRngProfitPreview").innerText = window.noRngProfit.toLocaleString();
        }
    });

    const darkModeToggle = document.getElementById("darkModeToggle");
    const body = document.body;

    if (localStorage.getItem("darkModeEnabled") === "true") {
        body.classList.add("dark-mode");
        const tables = document.getElementsByClassName("profit-table");
        for (const table of tables) {
            table.classList.toggle("table-striped");
        }
        darkModeToggle.checked = true;
    }

    darkModeToggle.addEventListener("change", () => {
        body.classList.toggle("dark-mode");
        const tables = document.getElementsByClassName("profit-table");
        for (const table of tables) {
            table.classList.toggle("table-striped");
        }
        localStorage.setItem("darkModeEnabled", darkModeToggle.checked);
    });

    if (typeof i18next !== "undefined" && i18next?.on) {
        i18next.on("languageChanged", () => {
            updateContent();
            refreshAbilityUpgradeCostHints();
            refreshEquipmentEnhancementHints();
            renderQueueViewsForCurrentPlayer();
            renderPlayerSnapshotList();
            refreshParallelWorkerHint();
        });
    }
}

export function registerImportExportSettingsModule(api) {
    api.registerFunctions({
        initErrorHandling,
        initImportExportModal,
        resetImportInputs,
        doGroupExport,
        getFirstSelectOptionValue,
        resolveNormalizedSelectValue,
        getDefaultSimulationSettings,
        normalizeSimulationSettings,
        normalizePlayerDataJsonSimulationSettings,
        normalizePlayerDataMapSimulationSettings,
        collectSimulationSettingsFromUI,
        setSelectValueIfOptionExists,
        applySimulationSettingsToUI,
        doSoloExport,
        setPlayerData,
        doGroupImport,
        doSoloImport,
        savePreviousPlayer,
        updateNextPlayer,
        showErrorModal,
        fetchAbilityUpgradeReferenceData,
        fetchPrices,
        updateTable,
        initPatchNotes,
        initExtraBuffSection,
        updateState,
        updateUI,
        updateContent,
        resolveI18nText,
        getDefaultQueueRuntimeSettings,
        normalizeQueueScoreWeights,
        normalizeParallelWorkerLimit,
        getDetectedHardwareCoreCount,
        getParallelWorkerHardMaxForCurrentMachine,
        getRecommendedParallelWorkerLimit,
        refreshParallelWorkerHint,
        normalizeQueueRuntimeSettings,
        loadQueueSettingsFromStorageOrDefault,
        saveQueueSettingsToStorage,
        snapshotPlayerDataMap,
        normalizeStoredPlayerDataMap,
        upsertPlayerDataSnapshotToStorage,
        clearPlayerDataSnapshotFromStorage,
        loadPlayerDataSnapshotFromStorage,
        savePlayerDataSnapshotToStorage,
        setSettingsStatusText,
        setSettingsQueueStatus,
        setSettingsPlayerDataStatus,
        parsePlayerSnapshotSummary,
        escapeHtml,
        createSnapshotHeaderText,
        renderPlayerSnapshotList,
        formatWeightPercent,
        syncQueueSettingsInputsFromRuntime,
        readQueueSettingsFromForm,
        handleSaveQueueSettingsClick,
        handleResetQueueSettingsClick,
        handleSavePlayerConfigsClick,
        handleLoadPlayerConfigsClick,
        handleDeleteSinglePlayerConfigSnapshotClick,
        handleDeleteAllPlayerConfigsClick,
        initSettingsPageControls,
        bootstrapGlobalErrorUiBindings
    });
}

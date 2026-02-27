// Auto-generated from src/main.js (Equipment Sets)

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
            if (!field) continue;
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
            if (!field) continue;
            field.checked = false;
            player.achievements[detail.hrid] = false;
        }
    }
    refreshAchievementStatics();

    updateState();
    updateUI();

    updateContent();
}

export function registerEquipmentSetsModule(api) {
    api.registerFunctions({
        initEquipmentSetsModal,
        equipmentSetsModalShownHandler,
        resetNewEquipmentSetControls,
        updateEquipmentSetList,
        equipmentSetNameChangedHandler,
        createNewEquipmentSetHandler,
        loadEquipmentSetHandler,
        updateEquipmentSetHandler,
        deleteEquipmentSetHandler,
        loadEquipmentSets,
        saveEquipmentSets,
        getEquipmentSetFromUI,
        fixTriggerMap,
        loadEquipmentSetIntoUI
    });
}

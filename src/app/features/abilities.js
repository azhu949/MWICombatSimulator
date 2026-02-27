// Auto-generated from src/main.js (Abilities)

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

export function registerAbilitiesModule(api) {
    api.registerFunctions({
        initAbilitiesSection,
        abilitySelectHandler,
        updateAbilityState,
        updateAbilityUI,
        swapAbilityOrder
    });
}

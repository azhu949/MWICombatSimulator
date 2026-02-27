// Auto-generated from src/main.js (Level)

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

export function registerLevelModule(api) {
    api.registerFunctions({
        initLevelSection,
        levelInputHandler,
        updateLevels,
        calcCombatLevel,
        updateCombatLevel
    });
}

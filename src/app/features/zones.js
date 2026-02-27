// Auto-generated from src/main.js (Zones)

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

function getLocalizedTextOrFallback(i18nKey, fallbackText) {
    const translated = i18next.t(i18nKey);
    if (translated && translated !== i18nKey) {
        return translated;
    }
    return fallbackText;
}

function initLabyrinth() {
    let labyrinthSelect = document.getElementById("selectLabyrinth");
    if (!labyrinthSelect) {
        return;
    }

    let gameLabyrinths = Object.values(combatMonsterDetailMap)
        .filter((monster) => monster.isLabyrinthMonster === true)
        .sort((a, b) => a.sortIndex - b.sortIndex);

    for (const labyrinth of Object.values(gameLabyrinths)) {
        const key = "monsterNames." + labyrinth.hrid;
        const fallbackName = labyrinth.name ?? labyrinth.hrid;
        let opt = new Option(getLocalizedTextOrFallback(key, fallbackName), labyrinth.hrid);
        opt.setAttribute("data-i18n", key);
        opt.setAttribute("data-i18n-fallback", fallbackName);
        labyrinthSelect.add(opt);
    }

    Object.keys(LabyrinthSupplyItems).forEach((categoryKey) => {
        const items = LabyrinthSupplyItems[categoryKey];
        const categorySelect = document.getElementById("select" + categoryKey);
        if (!categorySelect) return;

        items.forEach((item) => {
            const key = "itemNames." + item;
            const fallbackName = itemDetailMap[item]?.name ?? item;
            let opt = new Option(getLocalizedTextOrFallback(key, fallbackName), item);
            opt.setAttribute("data-i18n", key);
            opt.setAttribute("data-i18n-fallback", fallbackName);
            categorySelect.add(opt);
        });
    });

    const simLabyrinthToggle = document.getElementById("simLabyrinthToggle");
    const simAllLabyrinthsToggle = document.getElementById("simAllLabyrinthsToggle");
    const labyrinthSupplyItemsBox = document.getElementById("labyrinthSupplyItemsBox");
    if (!simLabyrinthToggle || !simAllLabyrinthsToggle || !labyrinthSupplyItemsBox) {
        return;
    }

    const updateLabyrinthToggle = () => {
        const inLabyrinthMode = simLabyrinthToggle.checked || simAllLabyrinthsToggle.checked;
        if (isLabyrinthSim === inLabyrinthMode) return;
        labyrinthSupplyItemsBox.classList.toggle("d-none", !inLabyrinthMode);
        isLabyrinthSim = inLabyrinthMode;
    };

    simLabyrinthToggle.onchange = updateLabyrinthToggle;
    simAllLabyrinthsToggle.onchange = updateLabyrinthToggle;
    updateLabyrinthToggle();
}

export function registerZonesModule(api) {
    api.registerFunctions({
        initZones,
        initDungeons,
        getLocalizedTextOrFallback,
        initLabyrinth
    });
}

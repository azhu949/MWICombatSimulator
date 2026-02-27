// Auto-generated from src/main.js (Baseline Queue)

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
    const menuSettings = document.getElementById("leftMenuSettings");

    if (!menuHome || !menuQueue || !menuResults || !menuMultiResults || !menuSettings) {
        return;
    }

    menuHome.addEventListener("click", () => switchLeftPage("home"));
    menuQueue.addEventListener("click", () => switchLeftPage("queue"));
    menuResults.addEventListener("click", () => switchLeftPage("results"));
    menuMultiResults.addEventListener("click", () => switchLeftPage("multiResults"));
    menuSettings.addEventListener("click", () => switchLeftPage("settings"));
    switchLeftPage("home");
}

function switchLeftPage(pageName) {
    activeLeftPage = pageName;

    const pageHome = document.getElementById("pageHome");
    const pageQueue = document.getElementById("pageQueue");
    const pageResults = document.getElementById("pageResults");
    const pageMultiResults = document.getElementById("pageMultiResults");
    const pageSettings = document.getElementById("pageSettings");
    const menuHome = document.getElementById("leftMenuHome");
    const menuQueue = document.getElementById("leftMenuQueue");
    const menuResults = document.getElementById("leftMenuResults");
    const menuMultiResults = document.getElementById("leftMenuMultiResults");
    const menuSettings = document.getElementById("leftMenuSettings");

    if (
        !pageHome
        || !pageQueue
        || !pageResults
        || !pageMultiResults
        || !pageSettings
        || !menuHome
        || !menuQueue
        || !menuResults
        || !menuMultiResults
        || !menuSettings
    ) {
        return;
    }

    pageHome.classList.toggle("d-none", pageName !== "home");
    pageQueue.classList.toggle("d-none", pageName !== "queue");
    pageResults.classList.toggle("d-none", pageName !== "results");
    pageMultiResults.classList.toggle("d-none", pageName !== "multiResults");
    pageSettings.classList.toggle("d-none", pageName !== "settings");

    menuHome.classList.toggle("active", pageName === "home");
    menuQueue.classList.toggle("active", pageName === "queue");
    menuResults.classList.toggle("active", pageName === "results");
    menuMultiResults.classList.toggle("active", pageName === "multiResults");
    menuSettings.classList.toggle("active", pageName === "settings");

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
    const simLabyrinthToggle = document.getElementById("simLabyrinthToggle");
    const simAllLabyrinthsToggle = document.getElementById("simAllLabyrinthsToggle");
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

    if (simLabyrinthToggle?.checked || simAllLabyrinthsToggle?.checked) {
        throw new Error(i18next.t("common:queue.baselineNoLabyrinth"));
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
        const workerInstance = new Worker(new URL("../../worker.js", import.meta.url));
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
        const beforeLevelRaw = Number(beforeEquipment?.enhancementLevel ?? 0);
        const afterLevelRaw = Number(afterEquipment?.enhancementLevel ?? 0);
        const beforeLevel = Number.isFinite(beforeLevelRaw) ? beforeLevelRaw : 0;
        const afterLevel = Number.isFinite(afterLevelRaw) ? afterLevelRaw : 0;

        const hasChanged = beforeItemHrid !== afterItemHrid || beforeLevel !== afterLevel;
        if (!hasChanged || !afterItemHrid) {
            continue;
        }

        const selectType = slotKey === "weapon" ? "weapon" : slotKey;
        const savedCostResult = readEquipmentTransitionCostFromMap(
            enhancementCostMap,
            selectType,
            beforeItemHrid,
            beforeLevel,
            afterItemHrid,
            afterLevel
        );
        const estimatedCost = savedCostResult.value != null
            ? toFiniteNumber(savedCostResult.value, 0)
            : toFiniteNumber(computeDefaultEquipmentTransitionCost(beforeItemHrid, beforeLevel, afterItemHrid, afterLevel), 0);

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
    const detectedCoreCount = getDetectedHardwareCoreCount();
    const maxWorkers = Number.isFinite(detectedCoreCount)
        ? Math.max(1, Math.floor(detectedCoreCount))
        : QUEUE_PARALLEL_WORKER_LIMIT_MAX;
    const normalizedRoundCount = Math.max(1, Math.floor(toFiniteNumber(roundCount, 1)));
    const configuredLimit = normalizeParallelWorkerLimit(queueRuntimeSettings?.parallelWorkerLimit);
    return Math.max(1, Math.min(configuredLimit, maxWorkers, normalizedRoundCount));
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

function computeArithmeticMean(values, fallback = 0) {
    if (!Array.isArray(values) || values.length === 0) {
        return fallback;
    }
    return values.reduce((acc, cur) => acc + toFiniteNumber(cur, 0), 0) / values.length;
}

function winsorizeValues(values, winsorizePct = 0) {
    const safeValues = (values ?? []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
    if (safeValues.length === 0) {
        return [];
    }

    const safeWinsorizePct = clampNumber(toFiniteNumber(winsorizePct, 0), 0, 0.49);
    if (safeWinsorizePct <= 0 || safeValues.length < 3) {
        return [...safeValues];
    }

    const sorted = [...safeValues].sort((a, b) => a - b);
    const lower = computePercentileFromSorted(sorted, safeWinsorizePct);
    const upper = computePercentileFromSorted(sorted, 1 - safeWinsorizePct);
    return safeValues.map((value) => clampNumber(value, lower, upper));
}

function computeConfidenceFromValues(values, centerValue) {
    const safeValues = (values ?? []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
    const sampleCount = safeValues.length;
    if (sampleCount <= 1) {
        return 0;
    }

    const mean = computeArithmeticMean(safeValues, 0);
    const variance = safeValues.reduce((acc, cur) => acc + ((cur - mean) ** 2), 0) / sampleCount;
    const std = Math.sqrt(Math.max(0, variance));
    const ciHalfWidth95 = 1.96 * std / Math.sqrt(sampleCount);
    const scaleBase = Math.max(Math.abs(toFiniteNumber(centerValue, 0)), std, 1e-6);
    const intervalConfidence = 1 / (1 + ciHalfWidth95 / scaleBase);

    const sizeScale = Math.max(1, toFiniteNumber(QUEUE_MULTI_ROUND_CONFIDENCE_SIZE_SCALE, 8));
    const sizeConfidence = 1 - Math.exp(-1 * (sampleCount - 1) / sizeScale);

    return clampNumber(intervalConfidence * sizeConfidence, 0, 1);
}

function summarizeMetric(values, deltaPctValues) {
    const safeValues = values.map((value) => toFiniteNumber(value, 0));
    const blendWeight = clampNumber(toFiniteNumber(QUEUE_MULTI_ROUND_MEDIAN_BLEND_WEIGHT, 0.5), 0, 1);
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
    const sorted = [...winsorizedValues].sort((a, b) => a - b);
    const p50 = computePercentileFromSorted(sorted, 0.5);
    const p90 = computePercentileFromSorted(sorted, 0.9);
    const robustMean = meanWeight * winsorizedMean + blendWeight * p50;

    const min = Math.min(...winsorizedValues);
    const max = Math.max(...winsorizedValues);
    const variance = winsorizedValues.reduce((acc, cur) => acc + ((cur - robustMean) ** 2), 0) / winsorizedValues.length;
    const std = Math.sqrt(Math.max(0, variance));
    const robustCv = Math.abs(robustMean) > 1e-9 ? Math.abs(std / robustMean) : 1;
    const confidence = computeConfidenceFromValues(winsorizedValues, robustMean);

    const safeDeltaPctValues = deltaPctValues.filter((value) => Number.isFinite(value)).map((value) => Number(value));
    const rawMeanDeltaPct = computeArithmeticMean(safeDeltaPctValues, 0);
    const winsorizedDeltaPctValues = winsorizeValues(safeDeltaPctValues, QUEUE_MULTI_ROUND_WINSORIZE_PCT);
    const winsorizedMeanDeltaPct = computeArithmeticMean(winsorizedDeltaPctValues, rawMeanDeltaPct);
    const sortedDelta = [...winsorizedDeltaPctValues].sort((a, b) => a - b);
    const medianDeltaPct = sortedDelta.length > 0 ? computePercentileFromSorted(sortedDelta, 0.5) : rawMeanDeltaPct;
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

function buildQueueItemMetricSummary(roundResults) {
    let metricSummary = {};
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
        const percentile = higherIsBetter
            ? rankValue / denominator
            : 1 - rankValue / denominator;
        const rankedScore = clampedMinScore + percentile * scoreRange;
        return clampNumber(rankedScore, clampedMinScore, clampedMaxScore);
    });

    return {
        scores,
        invalidFlags,
    };
}

function buildQueueItemCostInsights(queueState, queueItem, metricSummary) {
    const totalUpgradeCost = toFiniteNumber(computeQueueItemUpgradeCost(queueState, queueItem), 0);
    const purchaseDays = computePurchaseDaysByBaselineProfit(totalUpgradeCost, queueState?.baseline?.metrics?.dailyNoRngProfit);

    let goldPerPoint01Pct = {};
    for (const metricKey of QUEUE_MULTI_ROUND_METRIC_KEYS) {
        const robustDeltaPct = Number(metricSummary?.[metricKey]?.robustMeanDeltaPct);
        const meanDeltaPct = Number.isFinite(robustDeltaPct)
            ? robustDeltaPct
            : Number(metricSummary?.[metricKey]?.meanDeltaPct);
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

function buildMultiRoundRanking(metricSummaryByQueueItem, scoreWeights = queueRuntimeSettings?.finalWeights) {
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
        return cvValues.reduce((acc, cur) => acc + cur, 0) / cvValues.length;
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
        const performanceScores = QUEUE_MULTI_ROUND_METRIC_KEYS.map((metricKey) => {
            return toFiniteNumber(normalizedScoresByMetric?.[metricKey]?.[index], QUEUE_MULTI_ROUND_SCORE_INVALID);
        });
        const performanceScore = performanceScores.reduce((acc, cur) => acc + cur, 0) / Math.max(1, performanceScores.length);

        const performanceInvalidMetricKeys = QUEUE_MULTI_ROUND_METRIC_KEYS
            .filter((metricKey) => Boolean(invalidFlagsByMetric?.[metricKey]?.[index]));
        const performanceInvalid = performanceInvalidMetricKeys.length > 0;
        const stabilityScore = toFiniteNumber(stabilityScores?.scores?.[index], QUEUE_MULTI_ROUND_SCORE_INVALID);
        const stabilityInvalid = Boolean(stabilityScores?.invalidFlags?.[index]);

        const confidenceList = QUEUE_MULTI_ROUND_METRIC_KEYS.map((metricKey) => {
            const confidenceDeltaPct = Number(entry.metricSummary?.[metricKey]?.confidenceDeltaPct);
            const fallbackConfidence = Number(entry.metricSummary?.[metricKey]?.confidence);
            return clampNumber(
                toFiniteNumber(Number.isFinite(confidenceDeltaPct) ? confidenceDeltaPct : fallbackConfidence, 0),
                0,
                1
            );
        });
        const avgConfidence = confidenceList.reduce((acc, cur) => acc + cur, 0) / Math.max(1, confidenceList.length);

        // Cost score weights:
        // upgrade cost 25% + purchase time 35% + gold per 0.01% 40%
        const upgradeCostScore = toFiniteNumber(upgradeCostScores?.scores?.[index], QUEUE_MULTI_ROUND_SCORE_INVALID);
        const purchaseDaysScore = toFiniteNumber(purchaseDaysScores?.scores?.[index], QUEUE_MULTI_ROUND_SCORE_INVALID);
        const avgGoldScore = toFiniteNumber(avgGoldScores?.scores?.[index], QUEUE_MULTI_ROUND_SCORE_INVALID);
        const costScore = (
            0.25 * upgradeCostScore
            + 0.35 * purchaseDaysScore
            + 0.40 * avgGoldScore
        );
        const costInvalid = Boolean(upgradeCostScores?.invalidFlags?.[index])
            || Boolean(purchaseDaysScores?.invalidFlags?.[index])
            || Boolean(avgGoldScores?.invalidFlags?.[index]);

        let invalidReasons = [];
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

        // Final score weights:
        // performance/stability/cost weights come from runtime settings.
        const baseFinalScore = (
            normalizedScoreWeights.performance * performanceScore
            + normalizedScoreWeights.stability * stabilityScore
            + normalizedScoreWeights.cost * costScore
        );
        const confidencePenaltyStrength = clampNumber(
            toFiniteNumber(QUEUE_MULTI_ROUND_CONFIDENCE_PENALTY_STRENGTH, 0.35),
            0,
            1
        );
        const confidencePenaltyFactor = clampNumber(
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
    const scoreWeights = normalizeQueueScoreWeights(queueRuntimeSettings?.finalWeights);
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
            scoreWeights: structuredClone(scoreWeights),
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
            ? buildMultiRoundRanking(realtimeMetricSummaryByQueueItem, scoreWeights)
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

        queueState.multiRoundResults.ranking = buildMultiRoundRanking(metricSummaryByQueueItem, scoreWeights);
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
    queueState.multiRoundResults.ranking = buildMultiRoundRanking(finalMetricSummaryByQueueItem, scoreWeights);
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

        if (beforeParsed?.itemHrid && afterParsed?.itemHrid) {
            const beforeItemName = localizeHridDisplayName(beforeParsed.itemHrid);
            const afterItemName = localizeHridDisplayName(afterParsed.itemHrid);
            return `${beforeItemName} -> ${afterItemName}(+${afterParsed.enhancementLevel})`;
        }

        if (afterParsed?.itemHrid) {
            const itemName = localizeHridDisplayName(afterParsed.itemHrid);
            return `${itemName}(+${afterParsed.enhancementLevel})`;
        }

        if (beforeParsed?.itemHrid) {
            const itemName = localizeHridDisplayName(beforeParsed.itemHrid);
            return `${itemName}(+${beforeParsed.enhancementLevel})`;
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
            return String(translated).trim();
        }
    }

    return String(hrid).trim();
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
    const robustWinsorPctText = formatMetricValue(QUEUE_MULTI_ROUND_WINSORIZE_PCT * 100, 1);
    const robustMeanWeightPctText = formatMetricValue((1 - QUEUE_MULTI_ROUND_MEDIAN_BLEND_WEIGHT) * 100, 0);
    const robustMedianWeightPctText = formatMetricValue(QUEUE_MULTI_ROUND_MEDIAN_BLEND_WEIGHT * 100, 0);
    const confidencePenaltyBasePctText = formatMetricValue((1 - QUEUE_MULTI_ROUND_CONFIDENCE_PENALTY_STRENGTH) * 100, 0);
    const confidencePenaltyWeightPctText = formatMetricValue(QUEUE_MULTI_ROUND_CONFIDENCE_PENALTY_STRENGTH * 100, 0);
    const activeScoreWeights = normalizeQueueScoreWeights(config.scoreWeights ?? queueRuntimeSettings?.finalWeights);
    const finalWeightPerformancePctText = formatMetricValue(activeScoreWeights.performance * 100, 0);
    const finalWeightStabilityPctText = formatMetricValue(activeScoreWeights.stability * 100, 0);
    const finalWeightCostPctText = formatMetricValue(activeScoreWeights.cost * 100, 0);
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
            <div class="mb-1"><span class="label">${i18next.t("common:multiRound.scoreModelWeights")}:</span> ${i18next.t("common:multiRound.scoreModelWeightsValue", { performance: finalWeightPerformancePctText, stability: finalWeightStabilityPctText, cost: finalWeightCostPctText })}</div>
            <div class="small text-secondary mt-1">
                <div>${i18next.t("common:multiRound.scoreModelParamPerformance")}</div>
                <div>${i18next.t("common:multiRound.scoreModelParamStability")}</div>
                <div>${i18next.t("common:multiRound.scoreModelParamCost")}</div>
                <div>${i18next.t("common:multiRound.scoreModelParamRobustWinsorize", { winsorPct: robustWinsorPctText })}</div>
                <div>${i18next.t("common:multiRound.scoreModelParamRobustMedianBlend", { meanWeight: robustMeanWeightPctText, medianWeight: robustMedianWeightPctText })}</div>
                <div>${i18next.t("common:multiRound.scoreModelParamRobustConfidencePenalty", { baseWeight: confidencePenaltyBasePctText, penaltyWeight: confidencePenaltyWeightPctText })}</div>
                <div>${i18next.t("common:multiRound.scoreInvalidZeroLegend")}</div>
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
            appendScoreCell(row, entry.performanceScore, shouldMarkInvalidZeroScore(entry?.scoreFlags?.performanceInvalid, entry.performanceScore));
            appendScoreCell(row, entry.stabilityScore, shouldMarkInvalidZeroScore(entry?.scoreFlags?.stabilityInvalid, entry.stabilityScore));
            appendScoreCell(row, entry.costScore, shouldMarkInvalidZeroScore(entry?.scoreFlags?.costInvalid, entry.costScore));
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

function shouldMarkInvalidZeroScore(invalidFlag, scoreValue) {
    if (!invalidFlag) {
        return false;
    }

    const safeScoreValue = toFiniteNumber(scoreValue, QUEUE_MULTI_ROUND_SCORE_INVALID);
    return Math.abs(safeScoreValue - QUEUE_MULTI_ROUND_SCORE_INVALID) <= 1e-9;
}

function appendScoreCell(row, scoreValue, markInvalidZero = false) {
    const cell = document.createElement("td");
    const scoreText = formatMetricValue(scoreValue, 2);
    if (markInvalidZero && scoreText !== "-") {
        cell.textContent = `${scoreText}*`;
        cell.title = i18next.t("common:multiRound.scoreInvalidZeroTooltip");
    } else {
        cell.textContent = scoreText;
    }
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

export function registerBaselineQueueModule(api) {
    api.registerFunctions({
        createEmptyPlayerQueueState,
        createInitialQueueState,
        getCurrentPlayerQueueState,
        resetPlayerQueueState,
        initLeftMenuNavigation,
        switchLeftPage,
        initBaselineQueueControls,
        queueNotice,
        clampNumber,
        normalizeQueueRoundCountValue,
        normalizeQueueRoundCustomInput,
        syncQueueRoundCustomInputVisibility,
        handleRunQueueButtonClick,
        handleRunQueueConfirmClick,
        getQueueMultiRoundConfigFromUI,
        getCurrentPlayerStateFromUI,
        buildSnapshotFromUI,
        buildSnapshotFromState,
        extractLevelSnapshot,
        extractEquipmentSnapshot,
        extractFoodSnapshot,
        extractDrinkSnapshot,
        extractSkillSnapshot,
        extractRelevantTriggerSnapshot,
        buildFixedSettingsFromUI,
        runSinglePlayerSimulation,
        resolveMarketplacePrice,
        computeProfitTotals,
        computeEncountersPerHour,
        getLocalizedZoneName,
        computeMetrics,
        computeMetricDeltas,
        stableStringify,
        sortObjectKeysDeep,
        diffSnapshots,
        getTriggerControlIdsForKey,
        stringifyEquipmentValue,
        stringifySkillValue,
        shortenText,
        formatMetricValue,
        formatCompactKMBValue,
        formatQueueMetricValue,
        computeQueueItemUpgradeCost,
        computePurchaseDaysByBaselineProfit,
        formatPurchaseDuration,
        computeGoldPerPoint01Pct,
        buildGoldPerPoint01PctRangeMap,
        formatDelta,
        setQueueRunningState,
        handleSetBaselineClick,
        buildPlayerFromStateForSimulation,
        applyDebuffOnLevelGap,
        buildPlayersForSimulation,
        handleAddToQueueClick,
        restoreCurrentPlayerToBaselineSnapshot,
        pushQueueItem,
        buildQueueEntriesForChanges,
        buildSingleChangeSnapshot,
        parseOneBasedIndex,
        ensureCombatConsumableState,
        ensureAbilityState,
        syncTriggerForHridFromState,
        syncEquipmentChangeIntoState,
        updateQueueRunProgressBar,
        getQueueRunErrorMessage,
        runQueueItemSimulation,
        runQueueSingleRound,
        resolveQueueParallelWorkerCount,
        runQueueItemRoundsSerial,
        runQueueItemRoundsParallel,
        runQueueRoundSerial,
        runQueueRoundParallel,
        computePercentileFromSorted,
        computeArithmeticMean,
        winsorizeValues,
        computeConfidenceFromValues,
        summarizeMetric,
        buildQueueItemMetricSummary,
        rankScoreList,
        buildQueueItemCostInsights,
        buildMultiRoundRanking,
        resolveQueueExecutionModeText,
        runQueueMultiRound,
        handleRunQueueClick,
        handleClearQueueClick,
        handleQueueListClick,
        translateI18nKeyOrFallback,
        getQueueItemDisplayName,
        resolveQueueItemDisplayNameById,
        deriveQueueItemDisplayNameFromChanges,
        deriveSingleQueueChangeDisplayName,
        parseEquipmentChangeValue,
        parseSkillChangeValue,
        computeAbilityBooksNeededForRange,
        pickPreferredChangedValue,
        normalizeChangeValue,
        extractHridFromText,
        extractTriggerHridFromChange,
        localizeHridDisplayName,
        localizeQueueCategory,
        localizeEquipmentSlotLabel,
        localizeQueueChangeLabel,
        localizeQueueChangeValue,
        renderQueueViewsForCurrentPlayer,
        renderBaselineSummary,
        renderQueueList,
        renderQueueResults,
        appendEmptyTableRow,
        formatDeltaPctText,
        appendDeltaPctCell,
        resolveMultiRoundRankingRowClass,
        renderMultiRoundResultsForCurrentPlayer,
        appendTextCell,
        shouldMarkInvalidZeroScore,
        appendScoreCell,
        appendDeltaCell,
        appendGoldPerPoint01PctCell,
        clearHomeDiffHighlight,
        refreshHomeDiffHighlight
    });
}

// Auto-generated from src/main.js (Simulation Controls)

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
        worker = new Worker(new URL("../../worker.js", import.meta.url));

        if (multiWorker) {
            multiWorker.terminate();
        }
        multiWorker = new Worker(new URL("../../multiWorker.js", import.meta.url));

        for (let worker of workerPool) {
            worker.worker.terminate();
        }

        buttonStartSimulation.disabled = false;
        buttonStopSimulation.style.display = 'none';
    });
}

function startSimulation(selectedPlayers) {
    const simLabyrinthToggle = document.getElementById("simLabyrinthToggle");
    const simAllLabyrinthsToggle = document.getElementById("simAllLabyrinthsToggle");

    let playersToSim = buildPlayersForSimulation(selectedPlayers);
    if (playersToSim.length === 0) {
        alert("Failed to build player simulation data.");
        return;
    }

    if (simLabyrinthToggle?.checked || simAllLabyrinthsToggle?.checked) {
        playersToSim.forEach((playerToSim) => {
            playerToSim.food = [null, null, null];
            playerToSim.drinks = [null, null, null];
        });
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
    let labyrinthSelect = document.getElementById("selectLabyrinth");
    let roomLevelInput = document.getElementById("inputRoomLevel");
    let simulationTimeInput = document.getElementById("inputSimulationTime");
    let simulationTimeLimit = Number(simulationTimeInput.value) * ONE_HOUR;

    let crates = [];
    Object.keys(LabyrinthSupplyItems).forEach((categoryKey) => {
        const categorySelect = document.getElementById("select" + categoryKey);
        if (!categorySelect) return;
        if (categorySelect.value !== "") {
            crates.push(categorySelect.value);
        }
    });

    buttonStopSimulation.style.display = 'block';

    if (!simAllZonesToggle.checked && !simAllSoloToggle.checked && !simAllLabyrinthsToggle?.checked) {
        let simZone = null;
        let simLabyrinth = null;

        if (simLabyrinthToggle?.checked) {
            const labyrinthHrid = labyrinthSelect.value;
            const roomLevel = Number(roomLevelInput.value);
            simLabyrinth = { labyrinthHrid: labyrinthHrid, roomLevel: roomLevel, crates: crates };
        } else {
            let zoneHrid = zoneSelect.value;
            let difficultyTier = Number(difficultySelect.value);
            if (simDungeonToggle.checked) {
                zoneHrid = dungeonSelect.value;
            }
            simZone = { zoneHrid: zoneHrid, difficultyTier: difficultyTier };
        }

        let workerMessage = {
            type: "start_simulation",
            workerId: Math.floor(Math.random() * 1e9).toString(),
            players: playersToSim,
            zone: simZone,
            labyrinth: simLabyrinth,
            simulationTimeLimit: simulationTimeLimit,
            extra : extra
        };
        simStartTime = Date.now();
        if (!worker) {
            worker = new Worker(new URL("../../worker.js", import.meta.url));
        }
        worker.onmessage = onWorkerMessage;
        worker.postMessage(workerMessage);
    } else if (simAllLabyrinthsToggle?.checked) {
        let gameLabyrinths = Object.values(combatMonsterDetailMap)
            .filter((monster) => monster.isLabyrinthMonster === true)
            .sort((a, b) => a.sortIndex - b.sortIndex);

        let simHrids = gameLabyrinths
            .map((monster) => {
                let result = [];
                // floor 1 is room level 20-40, then +20 per floor
                for (let roomLevel = 40; roomLevel <= 220; roomLevel += 20) {
                    result.push({ labyrinthHrid: monster.hrid, roomLevel: roomLevel, crates: crates });
                }
                return result;
            })
            .flat();

        let workerMessage = {
            type: "start_simulation_all_labyrinths",
            workerId: Math.floor(Math.random() * 1e9).toString(),
            players: playersToSim,
            labyrinths: simHrids,
            simulationTimeLimit: simulationTimeLimit,
            extra: extra
        };
        simStartTime = Date.now();
        if (!multiWorker) {
            multiWorker = new Worker(new URL("../../multiWorker.js", import.meta.url));
        }
        multiWorker.onmessage = onMultiWorkerMessage;
        multiWorker.postMessage(workerMessage);
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
            multiWorker = new Worker(new URL("../../multiWorker.js", import.meta.url));
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

function bootstrapSimulationControlsDomBindings() {
    document.addEventListener("DOMContentLoaded", function () {
        const simDungeonToggle = document.getElementById("simDungeonToggle");
        const simLabyrinthToggle = document.getElementById("simLabyrinthToggle");
        const simAllLabyrinthsToggle = document.getElementById("simAllLabyrinthsToggle");
        const playerContainer = document.getElementById("playerCheckBox");
        const labyrinthSupplyItemsBox = document.getElementById("labyrinthSupplyItemsBox");

        function addPlayers() {
            const player4 = document.createElement("div");
            player4.classList.add("form-check");
            player4.innerHTML = `
            <input class="form-check-input player-checkbox" type="checkbox" id="player4">
            <label class="form-check-label" for="player4">
                Player 4
            </label>
        `;

            const player5 = document.createElement("div");
            player5.classList.add("form-check");
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
            const player4 = document.getElementById("player4");
            const player5 = document.getElementById("player5");
            if (player4) player4.parentElement.remove();
            if (player5) player5.parentElement.remove();
        }

        function updatePlayerNames() {
            const tabLinks = document.querySelectorAll("#playerTab .nav-link");
            tabLinks.forEach((tabLink, index) => {
                const label = document.querySelector(`label[for="player${index + 1}"]`);
                if (label) {
                    label.textContent = tabLink.textContent.trim();
                }
            });
        }

        function updatePlayersCheckbox(isCheck) {
            const boxes = playerContainer.querySelectorAll(".player-checkbox");
            boxes.forEach((checkBox) => {
                checkBox.checked = isCheck;
            });
        }

        function updateDifficultySelect(isCheck) {
            const difficultySelect = document.getElementById("selectDifficulty");
            if (isCheck && Number(difficultySelect.value) >= 3) {
                difficultySelect.value = 0;
            }
            for (let i = 3; i < difficultySelect.options.length; i++) {
                difficultySelect.options[i].disabled = isCheck;
            }
        }

        function setLabyrinthMode(enabled) {
            if (labyrinthSupplyItemsBox) {
                labyrinthSupplyItemsBox.classList.toggle("d-none", !enabled);
            }
            if (enabled) {
                simDungeonToggle.checked = false;
                removePlayers();
                updatePlayersCheckbox(false);
                updateDifficultySelect(false);
            }
            updatePlayerNames();
        }

        simDungeonToggle.addEventListener("change", function () {
            if (simDungeonToggle.checked) {
                if (simLabyrinthToggle) simLabyrinthToggle.checked = false;
                if (simAllLabyrinthsToggle) simAllLabyrinthsToggle.checked = false;
                setLabyrinthMode(false);
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

        if (simLabyrinthToggle && simAllLabyrinthsToggle) {
            simLabyrinthToggle.addEventListener("change", () => {
                if (simLabyrinthToggle.checked) {
                    simAllLabyrinthsToggle.checked = false;
                    setLabyrinthMode(true);
                } else if (!simAllLabyrinthsToggle.checked) {
                    setLabyrinthMode(false);
                }
            });

            simAllLabyrinthsToggle.addEventListener("change", () => {
                if (simAllLabyrinthsToggle.checked) {
                    simLabyrinthToggle.checked = false;
                    setLabyrinthMode(true);
                } else if (!simLabyrinthToggle.checked) {
                    setLabyrinthMode(false);
                }
            });

            if (simLabyrinthToggle.checked || simAllLabyrinthsToggle.checked) {
                setLabyrinthMode(true);
            }
        }

        document.getElementById("buttonSimulationSetup").addEventListener("click", function () {
            updatePlayerNames();
        });
    });

    document.querySelectorAll("#playerTab .nav-link").forEach((tab) => {
        tab.addEventListener("shown.bs.tab", onTabChange);
    });

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
                            extra: extra
                        };
                        const worker = new Worker(new URL("../../worker.js", import.meta.url));
                        worker.onmessage = mainWorkerOnMessage;
                        worker.postMessage(workerMessage);
                        customAlert("Simulation task Created", "info");
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
                            extra: extra
                        };
                        const worker = new Worker(new URL("../../worker.js", import.meta.url));
                        worker.onmessage = mainWorkerOnMessage;
                        worker.postMessage(workerMessage);
                        customAlert("Simulation task Created", "info");
                        workerPool.push({
                            workerId: workerMessage.workerId,
                            worker: worker,
                        });
                    }
                }
            } catch (error) {
                customAlert("Error parsing JSON file: " + error.message, "danger");
            }
        };
        reader.readAsText(file);
    });
}

export function registerSimulationControlsModule(api) {
    api.registerFunctions({
        onTabChange,
        initSimulationControls,
        startSimulation,
        parsePlayerJson,
        bootstrapSimulationControlsDomBindings
    });
}

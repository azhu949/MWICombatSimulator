// Auto-generated from src/main.js (Equipment)

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

function getEquipmentTransitionCostKey(selectType, beforeItemHrid, beforeLevel, afterItemHrid, afterLevel) {
    return `${selectType}|${beforeItemHrid}|${beforeLevel}|${afterItemHrid}|${afterLevel}`;
}

function getLegacyEnhancementCostKeyForTransition(selectType, beforeItemHrid, beforeLevel, afterItemHrid, afterLevel) {
    if (
        !afterItemHrid
        || beforeItemHrid !== afterItemHrid
        || !Number.isFinite(beforeLevel)
        || !Number.isFinite(afterLevel)
        || afterLevel <= beforeLevel
    ) {
        return "";
    }

    return getEnhancementUpgradeCostKey(selectType, afterItemHrid, beforeLevel, afterLevel);
}

function readEquipmentTransitionCostFromMap(costMap, selectType, beforeItemHrid, beforeLevel, afterItemHrid, afterLevel) {
    const transitionCostKey = getEquipmentTransitionCostKey(selectType, beforeItemHrid, beforeLevel, afterItemHrid, afterLevel);
    const legacyCostKey = getLegacyEnhancementCostKeyForTransition(selectType, beforeItemHrid, beforeLevel, afterItemHrid, afterLevel);

    if (Object.prototype.hasOwnProperty.call(costMap, transitionCostKey)) {
        return {
            value: costMap[transitionCostKey],
            transitionCostKey,
            legacyCostKey,
        };
    }

    if (legacyCostKey && Object.prototype.hasOwnProperty.call(costMap, legacyCostKey)) {
        return {
            value: costMap[legacyCostKey],
            transitionCostKey,
            legacyCostKey,
        };
    }

    return {
        value: null,
        transitionCostKey,
        legacyCostKey,
    };
}

function writeEquipmentTransitionCostToMap(costMap, selectType, beforeItemHrid, beforeLevel, afterItemHrid, afterLevel, costValue) {
    const transitionCostKey = getEquipmentTransitionCostKey(selectType, beforeItemHrid, beforeLevel, afterItemHrid, afterLevel);
    costMap[transitionCostKey] = costValue;

    const legacyCostKey = getLegacyEnhancementCostKeyForTransition(selectType, beforeItemHrid, beforeLevel, afterItemHrid, afterLevel);
    if (legacyCostKey) {
        costMap[legacyCostKey] = costValue;
    }
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

function computeDefaultEquipmentTransitionCost(beforeItemHrid, beforeLevel, afterItemHrid, afterLevel) {
    if (!afterItemHrid) {
        return 0;
    }

    const normalizedBeforeLevel = Number.isFinite(beforeLevel) ? beforeLevel : 0;
    const normalizedAfterLevel = Number.isFinite(afterLevel) ? afterLevel : 0;
    const buyPrice = resolveEnhancementLevelPrice(afterItemHrid, normalizedAfterLevel, "ask");
    if (buyPrice === -1) {
        return 0;
    }

    let sellPrice = 0;
    if (beforeItemHrid) {
        const resolvedSellPrice = resolveEnhancementLevelPrice(beforeItemHrid, normalizedBeforeLevel, "bid");
        sellPrice = resolvedSellPrice === -1 ? 0 : resolvedSellPrice;
    }

    const transitionCost = buyPrice - sellPrice;
    return transitionCost > 0 ? transitionCost : 0;
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
        const currentLevelRaw = Number(enhancementInput.value);
        const currentLevel = Number.isFinite(currentLevelRaw) ? currentLevelRaw : 0;
        if (itemHrid) {
            const levels = getMarketEnhancementLevelsForItem(itemHrid);
            if (levels.length > 0) {
                const buttonContainer = document.createElement("div");
                buttonContainer.className = "d-flex flex-wrap gap-1";
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
            }
        }

        if (!itemHrid) {
            continue;
        }

        const baselineSnapshot = getCurrentPlayerQueueState()?.baseline?.snapshot;
        if (!baselineSnapshot) {
            continue;
        }

        const baselineEquipment = getBaselineEquipmentForSelectType(selectType);
        const baselineItemHrid = baselineEquipment?.itemHrid ?? "";
        const baselineLevelRaw = Number(baselineEquipment?.enhancementLevel ?? 0);
        const baselineLevel = Number.isFinite(baselineLevelRaw) ? baselineLevelRaw : 0;
        const hasChangedFromBaseline = baselineItemHrid !== itemHrid || baselineLevel !== currentLevel;
        const shouldShowUpgradeCost = Boolean(
            hasChangedFromBaseline
            && Number.isFinite(currentLevel)
        );

        if (shouldShowUpgradeCost) {
            const costMap = getCurrentPlayerEnhancementCostMap();
            const savedCostResult = readEquipmentTransitionCostFromMap(
                costMap,
                selectType,
                baselineItemHrid,
                baselineLevel,
                itemHrid,
                currentLevel
            );
            let savedCost;
            if (savedCostResult.value != null) {
                savedCost = savedCostResult.value;
                if (!Object.prototype.hasOwnProperty.call(costMap, savedCostResult.transitionCostKey)) {
                    writeEquipmentTransitionCostToMap(
                        costMap,
                        selectType,
                        baselineItemHrid,
                        baselineLevel,
                        itemHrid,
                        currentLevel,
                        savedCost
                    );
                }
            } else {
                const defaultCost = computeDefaultEquipmentTransitionCost(
                    baselineItemHrid,
                    baselineLevel,
                    itemHrid,
                    currentLevel
                );
                savedCost = String(defaultCost);
                writeEquipmentTransitionCostToMap(
                    costMap,
                    selectType,
                    baselineItemHrid,
                    baselineLevel,
                    itemHrid,
                    currentLevel,
                    savedCost
                );
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
                writeEquipmentTransitionCostToMap(
                    costMap,
                    selectType,
                    baselineItemHrid,
                    baselineLevel,
                    itemHrid,
                    currentLevel,
                    costInput.value
                );
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

function bootstrapEquipmentDomBindings() {
    const equipmentSetSelect = document.getElementById("selectEquipment_set");
    if (equipmentSetSelect) {
        equipmentSetSelect.onchange = changeEquipmentSetListener;
    }
}

export function registerEquipmentModule(api) {
    api.registerFunctions({
        buildAbilityBookInfoByAbilityHrid,
        initEquipmentSection,
        initEquipmentSelect,
        initHouseRoomsModal,
        createHouseInput,
        refreshAchievementStatics,
        initAchievementsModal,
        initEnhancementLevelInput,
        equipmentSelectHandler,
        enhancementLevelInputHandler,
        initEquipmentEnhancementHintPlaceholders,
        initAbilityUpgradeCostPlaceholders,
        getMarketEnhancementLevelsForItem,
        getEnhancementInputElementBySelectType,
        getBaselineEquipmentForSelectType,
        getBaselineSkillForAbilitySlot,
        getEnhancementUpgradeCostKey,
        getEquipmentTransitionCostKey,
        getLegacyEnhancementCostKeyForTransition,
        readEquipmentTransitionCostFromMap,
        writeEquipmentTransitionCostToMap,
        getCurrentPlayerEnhancementCostMap,
        getAbilityUpgradeCostKey,
        getCurrentPlayerAbilityCostMap,
        resolveEnhancementLevelPrice,
        computeDefaultEnhancementUpgradeCost,
        computeDefaultEquipmentTransitionCost,
        getAbilityXpForLevel,
        getSpellBookXpForAbility,
        computeDefaultAbilityUpgradeCost,
        applyEquipmentEnhancementFromMarket,
        refreshEquipmentEnhancementHints,
        refreshAbilityUpgradeCostHints,
        updateEquipmentState,
        changeEquipmentSetListener,
        bootstrapEquipmentDomBindings
    });
}

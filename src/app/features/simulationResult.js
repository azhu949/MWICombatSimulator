// Auto-generated from src/main.js (Simulation Result)

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

    const isLabyrinth = simResults?.[0]?.isLabyrinth ?? false;
    const table = document.getElementById("allZonesData");
    const rows = table?.getElementsByTagName("tr");
    if (!rows || rows.length === 0) {
        return;
    }

    if (isLabyrinth) {
        const encountersCol = 3;
        for (let row = 1; row < rows.length; row++) {
            const cell = rows[row].cells[encountersCol];
            const value = parseFloat(cell.textContent.replace(/,/g, ""));
            if (value >= 30) {
                cell.style.backgroundColor = "green";
                cell.style.color = "white";
            }
        }
        return;
    }

    const numCols = rows[0].cells.length;
    for (let col = 5; col < numCols; col++) {
        let max = -Infinity;
        let maxCell = null;

        for (let row = 1; row < rows.length; row++) {
            const cell = rows[row].cells[col];
            const value = parseFloat(cell.textContent.replace(/,/g, ""));
            if (value > max) {
                max = value;
                maxCell = cell;
            }
        }

        if (maxCell && max !== 0) {
            maxCell.style.backgroundColor = "green";
            maxCell.style.color = "white";
        }
    }
}

function bootstrapSimulationResultDomBindings() {
    let currentSortColumn = null;
    let currentSortDirection = "desc";

    document.querySelectorAll("#allZonesData th").forEach((header, index) => {
        if (index === 0) return;
        if (index === 1) return;
        if (index === 2) return;

        header.addEventListener("click", () => {
            if (currentSortColumn === index) {
                currentSortDirection = currentSortDirection === "asc" ? "desc" : "asc";
            } else {
                currentSortColumn = index;
                currentSortDirection = "desc";
            }
            sortTable("allZonesData", currentSortColumn, currentSortDirection);
        });
    });

    const exportButton = document.getElementById("buttonExportResults");
    if (!exportButton) {
        return;
    }

    exportButton.addEventListener("click", () => {
        let table = document.getElementById("allZonesData");
        let csv = [];
        let rows = table.querySelectorAll("tr");

        for (let i = 0; i < rows.length; i++) {
            let row = rows[i];
            let cols = row.querySelectorAll("th, td");
            let csvRow = [];

            cols.forEach((col) => {
                csvRow.push("\"" + col.innerText.replace(/"/g, "\"\"") + "\"");
            });

            csv.push(csvRow.join(","));
        }

        let csvFile = new Blob([csv.join("\n")], { type: "text/csv" });
        let downloadLink = document.createElement("a");
        downloadLink.download = "simData.csv";
        downloadLink.href = URL.createObjectURL(csvFile);
        downloadLink.style.display = "none";
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
    });
}

export function registerSimulationResultModule(api) {
    api.registerFunctions({
        createDamageDoneAccordion,
        createDamageTakenAccordion,
        initDamageDoneTaken,
        toFiniteNumber,
        hasPlayerDataInSimResult,
        resolveSimResultPlayerHrid,
        showSimulationResult,
        refreshMetricCardsVisibility,
        showAllSimulationResults,
        bootstrapSimulationResultDomBindings
    });
}

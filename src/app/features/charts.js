// Auto-generated from src/main.js (战斗图表功能)

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

function showEmptyCharts() {
    initializeRealtimeCharts();
}

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

function manipulateSimResultsDataForDisplay(simResults) {
    let displaySimResults = [];
    for (let i = 0; i < simResults.length; i++) {
        for (let j = 0; j < selectedPlayers.length; j++) {
            let playerToDisplay = "player" + selectedPlayers[j].toString();
            let simResult = simResults[i];
            let hoursSimulated = simResult.simulatedTime / ONE_HOUR;
            let zoneName = simResult.zoneName;
            let difficultyTier = simResult.difficultyTier;
            if (simResult.isLabyrinth) {
                zoneName = simResult.labyrinthName;
                difficultyTier = simResult.roomLevel;
            }
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
                if (cell.textContent.startsWith("/action")) {
                    cell.setAttribute("data-i18n", "actionNames." + item[key]);
                } else if (cell.textContent.startsWith("/monsters")) {
                    cell.setAttribute("data-i18n", "monsterNames." + item[key]);
                }
            }
            row.appendChild(cell);
        });

        tableBody.appendChild(row);
    });
}

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

export function registerChartsModule(api) {
    api.registerFunctions({
        updateChartsRealtime,
        renderCombatCharts,
        destroyChart,
        getChartOptions,
        initializeRealtimeCharts,
        showEmptyCharts,
        initHpMpVisualization,
        manipulateSimResultsDataForDisplay,
        fidDropAmount,
        calcDropMaps,
        getProfitDropMaps,
        getDropProfit,
        updateAllSimsModal,
        sortTable,
        updateSortIndicators,
        showKills,
        showDeaths,
        showExperienceGained,
        showHpSpent,
        showConsumablesUsed,
        showManaUsed,
        showHitpointsGained,
        showManapointsGained,
        showDamageDone,
        showDamageTaken,
        createDamageTable,
        createRow,
        createElement
    });
}

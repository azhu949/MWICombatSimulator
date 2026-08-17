import {
    actionDetailIndex,
    monsterDetailIndex,
} from "../shared/gameDataIndex.js";
import {
    LABYRINTH_BATCH_ROOM_LEVEL_MIN,
    LABYRINTH_BATCH_ROOM_LEVEL_STEP,
    LABYRINTH_COFFEE_CRATE_HRIDS,
    LABYRINTH_FOOD_CRATE_HRIDS,
    LABYRINTH_ROOM_LEVEL_DEFAULT,
    LABYRINTH_ROOM_LEVEL_MAX,
    LABYRINTH_ROOM_LEVEL_MIN,
    LABYRINTH_TEA_CRATE_HRIDS,
} from "../shared/labyrinthConfig.js";
import { estimateNoRngProfit } from "./profitEstimator.js";
import { normalizeQueueSettings } from "./queueScoring.js";
import { toFiniteNumber } from "./utils.js";

export const ONE_SECOND = 1e9;
export const ONE_HOUR = 60 * 60 * ONE_SECOND;

export const RUN_SCOPE_SINGLE = "single";
export const RUN_SCOPE_ALL_GROUP_ZONES = "all_group_zones";
export const RUN_SCOPE_ALL_SOLO_ZONES = "all_solo_zones";
export const RUN_SCOPE_ALL_LABYRINTHS = "all_labyrinths";

export {
    LABYRINTH_BATCH_ROOM_LEVEL_MIN,
    LABYRINTH_BATCH_ROOM_LEVEL_STEP,
    LABYRINTH_COFFEE_CRATE_HRIDS,
    LABYRINTH_FOOD_CRATE_HRIDS,
    LABYRINTH_ROOM_LEVEL_DEFAULT,
    LABYRINTH_ROOM_LEVEL_MAX,
    LABYRINTH_ROOM_LEVEL_MIN,
    LABYRINTH_TEA_CRATE_HRIDS,
} from "../shared/labyrinthConfig.js";

let cachedNonDungeonActions = null;

function createDefaultWorkerId(random = Math.random) {
    const randomValue = Number(typeof random === "function" ? random() : Math.random());
    const safeRandom = Number.isFinite(randomValue) ? randomValue : Math.random();
    return Math.floor(safeRandom * 1e9).toString();
}

export function getAllNonDungeonActions() {
    if (!cachedNonDungeonActions) {
        cachedNonDungeonActions = Object.values(actionDetailIndex)
            .filter((action) => action.type === "/action_types/combat")
            .filter((action) => action.category !== "/action_categories/combat/dungeons")
            .sort((a, b) => Number(a.sortIndex ?? 0) - Number(b.sortIndex ?? 0));
    }
    return cachedNonDungeonActions.slice();
}

export function normalizeZoneSelection(selectedHrids, allHrids) {
    const allSet = new Set((allHrids || []).map((value) => String(value || "")).filter(Boolean));
    const selected = Array.isArray(selectedHrids) ? selectedHrids : [];
    return Array.from(new Set(selected
        .map((value) => String(value || ""))
        .filter((value) => allSet.has(value))));
}

export function normalizeLabyrinthCrates(rawCrates) {
    const source = rawCrates && typeof rawCrates === "object" && !Array.isArray(rawCrates) ? rawCrates : {};
    const coffee = String(source.coffee || "");
    const food = String(source.food || "");
    const tea = String(source.tea || "");
    return {
        coffee: LABYRINTH_COFFEE_CRATE_HRIDS.includes(coffee) ? coffee : "",
        food: LABYRINTH_FOOD_CRATE_HRIDS.includes(food) ? food : "",
        tea: LABYRINTH_TEA_CRATE_HRIDS.includes(tea) ? tea : "",
    };
}

export function buildZoneTargetsByScope(runScope, selectedZoneHrids = []) {
    let actions = getAllNonDungeonActions();

    if (runScope === RUN_SCOPE_ALL_GROUP_ZONES) {
        actions = actions.filter((action) => Number(action?.combatZoneInfo?.fightInfo?.randomSpawnInfo?.maxSpawnCount ?? 0) > 1);
    }

    if (runScope === RUN_SCOPE_ALL_SOLO_ZONES) {
        actions = actions.filter((action) => Number(action?.combatZoneInfo?.fightInfo?.randomSpawnInfo?.maxSpawnCount ?? 0) === 1);
    }

    const selectedSet = new Set((selectedZoneHrids || []).map((hrid) => String(hrid || "")).filter(Boolean));
    if (selectedSet.size > 0) {
        actions = actions.filter((action) => selectedSet.has(String(action?.hrid || "")));
    }

    return actions.flatMap((action) => {
        const maxDifficulty = Number(action.maxDifficulty ?? 0);
        const zoneHrid = action.hrid;
        const results = [];

        for (let difficultyTier = 0; difficultyTier <= maxDifficulty; difficultyTier++) {
            results.push({ zoneHrid, difficultyTier });
        }

        return results;
    });
}

export function buildAllLabyrinthTargets(crates = []) {
    const labyrinthMonsters = Object.values(monsterDetailIndex)
        .filter((monster) => monster.isLabyrinthMonster === true)
        .sort((a, b) => Number(a.sortIndex ?? 0) - Number(b.sortIndex ?? 0));

    const normalizedCrates = Array.isArray(crates)
        ? crates.map((value) => String(value || "")).filter(Boolean)
        : [];

    return labyrinthMonsters.flatMap((monster) => {
        const labyrinths = [];
        for (
            let roomLevel = LABYRINTH_BATCH_ROOM_LEVEL_MIN;
            roomLevel <= LABYRINTH_ROOM_LEVEL_MAX;
            roomLevel += LABYRINTH_BATCH_ROOM_LEVEL_STEP
        ) {
            labyrinths.push({
                labyrinthHrid: monster.hrid,
                roomLevel,
                crates: [...normalizedCrates],
            });
        }
        return labyrinths;
    });
}

export function summarizeResult(simResult, selectedPlayers, pricingOptions = {}) {
    const hours = Math.max(1e-9, Number(simResult?.simulatedTime ?? 0) / ONE_HOUR);
    const skills = ["stamina", "intelligence", "attack", "magic", "ranged", "melee", "defense"];

    return selectedPlayers.map((player) => {
        const playerHrid = `player${player.id}`;
        const experienceMap = simResult?.experienceGained?.[playerHrid] ?? {};
        const totalExperience = Object.values(experienceMap).reduce((sum, value) => sum + Number(value || 0), 0);
        const deathsPerHour = Number(simResult?.deaths?.[playerHrid] ?? 0) / hours;
        const encountersPerHour = Number(simResult?.encounters ?? 0) / hours;
        const profit = estimateNoRngProfit(simResult, playerHrid, pricingOptions);
        const skillXpPerHour = {};

        for (const skill of skills) {
            skillXpPerHour[`${skill}XpPerHour`] = Number(experienceMap?.[skill] || 0) / hours;
        }

        return {
            playerHrid,
            playerName: player.name,
            encountersPerHour,
            deathsPerHour,
            totalXpPerHour: totalExperience / hours,
            profitPerHour: profit.profit / hours,
            revenuePerHour: profit.revenue / hours,
            expensesPerHour: profit.expenses / hours,
            totalExperience,
            noRngRevenue: profit.revenue,
            expenses: profit.expenses,
            noRngProfit: profit.profit,
            ...skillXpPerHour,
        };
    });
}

export function summarizeBatchResults(simResults, selectedPlayers, pricingOptions = {}) {
    const actionOrderMap = new Map(getAllNonDungeonActions().map((action, index) => [String(action?.hrid || ""), index]));
    const labyrinthOrderMap = new Map(
        Object.values(monsterDetailIndex)
            .filter((monster) => monster.isLabyrinthMonster === true)
            .sort((a, b) => Number(a.sortIndex ?? 0) - Number(b.sortIndex ?? 0))
            .map((monster, index) => [String(monster?.hrid || ""), index])
    );
    const playerOrderMap = new Map((selectedPlayers || []).map((player, index) => [`player${player.id}`, index]));

    const orderedResults = (simResults || []).slice().sort((left, right) => {
        const leftIsLabyrinth = Boolean(left?.isLabyrinth);
        const rightIsLabyrinth = Boolean(right?.isLabyrinth);

        if (leftIsLabyrinth !== rightIsLabyrinth) {
            return leftIsLabyrinth ? 1 : -1;
        }

        if (leftIsLabyrinth && rightIsLabyrinth) {
            const leftLabyrinthOrder = labyrinthOrderMap.get(String(left?.labyrinthName || "")) ?? Number.MAX_SAFE_INTEGER;
            const rightLabyrinthOrder = labyrinthOrderMap.get(String(right?.labyrinthName || "")) ?? Number.MAX_SAFE_INTEGER;
            if (leftLabyrinthOrder !== rightLabyrinthOrder) {
                return leftLabyrinthOrder - rightLabyrinthOrder;
            }

            return Number(left?.roomLevel || 0) - Number(right?.roomLevel || 0);
        }

        const leftZoneOrder = actionOrderMap.get(String(left?.zoneName || "")) ?? Number.MAX_SAFE_INTEGER;
        const rightZoneOrder = actionOrderMap.get(String(right?.zoneName || "")) ?? Number.MAX_SAFE_INTEGER;
        if (leftZoneOrder !== rightZoneOrder) {
            return leftZoneOrder - rightZoneOrder;
        }

        return Number(left?.difficultyTier || 0) - Number(right?.difficultyTier || 0);
    });

    const rows = [];

    orderedResults.forEach((simResult, runIndex) => {
        const zoneName = simResult?.isLabyrinth ? simResult?.labyrinthName : simResult?.zoneName;
        const difficulty = simResult?.isLabyrinth ? simResult?.roomLevel : simResult?.difficultyTier;

        const playerRows = summarizeResult(simResult, selectedPlayers, pricingOptions);
        playerRows.sort((left, right) => {
            const leftOrder = playerOrderMap.get(String(left?.playerHrid || "")) ?? Number.MAX_SAFE_INTEGER;
            const rightOrder = playerOrderMap.get(String(right?.playerHrid || "")) ?? Number.MAX_SAFE_INTEGER;
            return leftOrder - rightOrder;
        });
        playerRows.forEach((playerRow) => {
            rows.push({
                rowId: `${runIndex}-${playerRow.playerHrid}`,
                runIndex,
                zoneName: zoneName || "-",
                zoneOrder: simResult?.isLabyrinth
                    ? (labyrinthOrderMap.get(String(zoneName || "")) ?? Number.MAX_SAFE_INTEGER)
                    : (actionOrderMap.get(String(zoneName || "")) ?? Number.MAX_SAFE_INTEGER),
                difficulty,
                ...playerRow,
            });
        });
    });

    return rows;
}

export function buildSimulationExtra(simulationSettings) {
    return {
        mooPass: Boolean(simulationSettings.mooPass),
        comExp: simulationSettings.comExpEnabled ? Number(simulationSettings.comExp || 20) : 0,
        comDrop: simulationSettings.comDropEnabled ? Number(simulationSettings.comDrop || 20) : 0,
        enableHpMpVisualization: Boolean(simulationSettings.enableHpMpVisualization),
        combatScrollsEnabled: Boolean(simulationSettings.combatScrollsEnabled),
    };
}

export function buildSingleSimulationPayload(playersToSim, simulationSettings, activeLabyrinthCrates = [], options = {}) {
    const simulationTimeHours = Math.max(1, toFiniteNumber(simulationSettings?.simulationTimeHours, 24));
    const simulationTimeLimit = simulationTimeHours * ONE_HOUR;
    const extra = options.extra ?? buildSimulationExtra(simulationSettings || {});

    let zone = null;
    let labyrinth = null;

    if (simulationSettings?.mode === "labyrinth") {
        labyrinth = {
            labyrinthHrid: simulationSettings.labyrinthHrid,
            roomLevel: Math.max(
                LABYRINTH_ROOM_LEVEL_MIN,
                toFiniteNumber(simulationSettings.roomLevel, LABYRINTH_ROOM_LEVEL_DEFAULT),
            ),
            crates: activeLabyrinthCrates,
        };
    } else {
        const zoneHrid = simulationSettings?.useDungeon
            ? simulationSettings?.dungeonHrid
            : simulationSettings?.zoneHrid;

        zone = {
            zoneHrid,
            difficultyTier: Math.max(0, Math.floor(toFiniteNumber(simulationSettings?.difficultyTier, 0))),
        };
    }

    const simulationContext = options.simulationContext && typeof options.simulationContext === "object"
        ? { ...options.simulationContext }
        : (options.isGuildTrial === true ? { isGuildTrial: true } : null);

    const payload = {
        type: "start_simulation",
        workerId: options.workerId ?? createDefaultWorkerId(options.random),
        players: playersToSim,
        zone,
        labyrinth,
        simulationTimeLimit,
        extra,
    };

    if (simulationContext) {
        payload.simulationContext = simulationContext;
    }

    return payload;
}

export function buildQueueBaselineSettings(simulationSettings = {}, queueSettings = null) {
    const useDungeon = Boolean(simulationSettings.useDungeon);
    const regularZoneHrid = String(simulationSettings.zoneHrid || "");
    const dungeonHrid = String(simulationSettings.dungeonHrid || "");
    const selectedZoneHrid = useDungeon ? dungeonHrid : regularZoneHrid;
    const normalizedQueueSettings = normalizeQueueSettings(queueSettings);

    return {
        mode: String(simulationSettings.mode || "zone"),
        runScope: String(simulationSettings.runScope || RUN_SCOPE_SINGLE),
        simDungeon: useDungeon,
        zoneHrid: selectedZoneHrid,
        regularZoneHrid,
        dungeonHrid,
        difficultyTier: Math.max(0, Math.floor(toFiniteNumber(simulationSettings.difficultyTier, 0))),
        simulationTimeHours: Math.max(1, Math.floor(toFiniteNumber(simulationSettings.simulationTimeHours, 24))),
        baselineRounds: normalizedQueueSettings.baselineRounds,
        extra: buildSimulationExtra(simulationSettings),
    };
}

export function summarizeQueueBaselineMetrics(summaryRow = null) {
    const encountersPerHour = Number(summaryRow?.encountersPerHour || 0);
    const totalXpPerHour = Number(summaryRow?.totalXpPerHour || 0);
    const profitPerHour = Number(summaryRow?.profitPerHour || 0);

    return {
        encountersPerHour,
        deathsPerHour: Number(summaryRow?.deathsPerHour || 0),
        totalXpPerHour,
        profitPerHour,
        dps: 0,
        killsPerHour: encountersPerHour,
        xpPerHour: totalXpPerHour,
        dailyProfit: profitPerHour * 24,
        dailyNoRngProfit: profitPerHour * 24,
    };
}

export function toPlayerHrid(playerId = "1") {
    const normalizedPlayerId = String(playerId || "1").replace(/^player/i, "") || "1";
    return `player${normalizedPlayerId}`;
}

export function resolveSimResultPlayerHrid(simResult, preferredPlayerId = "1") {
    const preferredPlayerHrid = toPlayerHrid(preferredPlayerId);
    const candidateMaps = [
        simResult?.experienceGained,
        simResult?.deaths,
        simResult?.attacks,
        simResult?.consumablesUsed,
    ];

    for (const sourceMap of candidateMaps) {
        if (sourceMap && Object.prototype.hasOwnProperty.call(sourceMap, preferredPlayerHrid)) {
            return preferredPlayerHrid;
        }
    }

    for (const sourceMap of candidateMaps) {
        if (!sourceMap || typeof sourceMap !== "object") {
            continue;
        }
        const firstKey = Object.keys(sourceMap).find((key) => String(key || "").startsWith("player"));
        if (firstKey) {
            return firstKey;
        }
    }

    return preferredPlayerHrid;
}

export function computeQueueMetrics(simResult, preferredPlayerId, pricingOptions = {}) {
    const playerHrid = resolveSimResultPlayerHrid(simResult, preferredPlayerId);
    const simulatedHours = Math.max(1e-9, toFiniteNumber(simResult?.simulatedTime, 0) / ONE_HOUR);
    const simulatedSeconds = Math.max(1e-9, toFiniteNumber(simResult?.simulatedTime, 0) / ONE_SECOND);

    let totalDamage = 0;
    const playerAttacks = simResult?.attacks?.[playerHrid] ?? {};
    for (const attackSources of Object.values(playerAttacks)) {
        const sourceCasts = attackSources && typeof attackSources === "object" ? attackSources : {};
        for (const castMap of Object.values(sourceCasts)) {
            const castCounts = castMap && typeof castMap === "object" ? castMap : {};
            for (const [damageText, count] of Object.entries(castCounts)) {
                if (damageText === "miss") {
                    continue;
                }
                totalDamage += toFiniteNumber(damageText, 0) * toFiniteNumber(count, 0);
            }
        }
    }

    const totalExperience = Object.values(simResult?.experienceGained?.[playerHrid] ?? {})
        .reduce((sum, value) => sum + toFiniteNumber(value, 0), 0);

    const profit = estimateNoRngProfit(simResult, playerHrid, pricingOptions);
    const killsPerHour = toFiniteNumber(simResult?.encounters, 0) / simulatedHours;
    const dailyNoRngProfit = toFiniteNumber(profit?.profit, 0) / simulatedHours * 24;

    return {
        dps: toFiniteNumber(totalDamage / simulatedSeconds, 0),
        killsPerHour: toFiniteNumber(killsPerHour, 0),
        xpPerHour: toFiniteNumber(totalExperience / simulatedHours, 0),
        dailyProfit: toFiniteNumber(dailyNoRngProfit, 0),
        dailyNoRngProfit: toFiniteNumber(dailyNoRngProfit, 0),
    };
}

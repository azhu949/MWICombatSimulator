import { getActionName as getIndexedActionName } from "../shared/gameDataIndex.js";
import {
    ADVISOR_GOAL_PRESET_BALANCED,
    buildAdvisorMetricSummary,
    getAdvisorPresetWeights,
} from "./advisorScoring.js";
import {
    ONE_HOUR,
    RUN_SCOPE_ALL_GROUP_ZONES,
    RUN_SCOPE_ALL_SOLO_ZONES,
    buildZoneTargetsByScope,
    summarizeResult,
    toPlayerHrid,
} from "./simulationDomain.js";
import { clamp, toFiniteNumber } from "./utils.js";

export const ADVISOR_REFINE_TOP_COUNT_DEFAULT = 8;
export const ADVISOR_REFINE_ROUNDS_DEFAULT = 20;
export const ADVISOR_REFINE_TOP_COUNT_MIN = 1;
export const ADVISOR_REFINE_TOP_COUNT_MAX = 32;
export const ADVISOR_REFINE_ROUNDS_MIN = 1;
export const ADVISOR_REFINE_ROUNDS_MAX = 30;
export const ADVISOR_QUICK_ROUNDS_DEFAULT = 3;
export const ADVISOR_QUICK_ROUNDS_MIN = 1;
export const ADVISOR_QUICK_ROUNDS_MAX = 10;

function createDefaultWorkerId(random = Math.random) {
    const randomValue = Number(typeof random === "function" ? random() : Math.random());
    const safeRandom = Number.isFinite(randomValue) ? randomValue : Math.random();
    return Math.floor(safeRandom * 1e9).toString();
}

export function normalizeAdvisorFilters(rawFilters = {}) {
    const source = rawFilters != null && typeof rawFilters === "object" && !Array.isArray(rawFilters) ? rawFilters : {};
    return {
        includeGroupZones: source.includeGroupZones !== false,
        includeSoloZones: Boolean(source.includeSoloZones),
        refineTopEnabled: source.refineTopEnabled !== false,
        refineTopCount: clamp(
            Math.floor(toFiniteNumber(source.refineTopCount, ADVISOR_REFINE_TOP_COUNT_DEFAULT)),
            ADVISOR_REFINE_TOP_COUNT_MIN,
            ADVISOR_REFINE_TOP_COUNT_MAX
        ),
        refineRounds: clamp(
            Math.floor(toFiniteNumber(source.refineRounds, ADVISOR_REFINE_ROUNDS_DEFAULT)),
            ADVISOR_REFINE_ROUNDS_MIN,
            ADVISOR_REFINE_ROUNDS_MAX
        ),
        quickRounds: clamp(
            Math.floor(toFiniteNumber(source.quickRounds, ADVISOR_QUICK_ROUNDS_DEFAULT)),
            ADVISOR_QUICK_ROUNDS_MIN,
            ADVISOR_QUICK_ROUNDS_MAX
        ),
    };
}

export function createAdvisorState() {
    return {
        filters: normalizeAdvisorFilters(),
        goalPreset: ADVISOR_GOAL_PRESET_BALANCED,
        customWeights: getAdvisorPresetWeights(ADVISOR_GOAL_PRESET_BALANCED),
        quickRows: [],
        refinedRows: [],
        topCards: [],
        metricPlayerId: "",
        metricPlayerName: "",
        runtime: {
            isRunning: false,
            phase: "idle",
            progress: 0,
            startedAt: 0,
            elapsedSeconds: 0,
            quickCompleted: 0,
            quickTotal: 0,
            refineCompleted: 0,
            refineTotal: 0,
            lastRunAt: 0,
            runId: 0,
            cancelRequested: false,
        },
        error: "",
    };
}

export function buildAdvisorTargetId(targetType, targetHrid, targetLevel) {
    return `${String(targetType || "zone")}:${String(targetHrid || "")}#${Math.floor(toFiniteNumber(targetLevel, 0))}`;
}

export function createAdvisorZoneCandidate(zoneTarget, category, order) {
    const zoneHrid = String(zoneTarget?.zoneHrid || "");
    const difficultyTier = Math.max(0, Math.floor(toFiniteNumber(zoneTarget?.difficultyTier, 0)));
    return {
        id: buildAdvisorTargetId("zone", zoneHrid, difficultyTier),
        order,
        targetType: "zone",
        category,
        targetHrid: zoneHrid,
        targetName: getIndexedActionName(zoneHrid, zoneHrid),
        difficultyTier,
        roomLevel: null,
        isRefined: false,
        refineRounds: 0,
        successfulRounds: 0,
    };
}

export function resolveAdvisorMetricPlayer(selectedPlayers = [], preferredPlayerId = "1") {
    const safePlayers = Array.isArray(selectedPlayers) ? selectedPlayers.filter(Boolean) : [];
    const normalizedPreferredId = String(preferredPlayerId || "1");
    const preferredPlayer = safePlayers.find((player) => String(player?.id || "") === normalizedPreferredId);
    const fallbackPlayer = preferredPlayer || safePlayers[0] || null;
    const resolvedId = String(fallbackPlayer?.id || normalizedPreferredId || "1");
    return {
        id: resolvedId,
        name: String(fallbackPlayer?.name || `Player ${resolvedId}`),
    };
}

export function summarizeAdvisorTargetResult(simResult, selectedPlayers, preferredPlayerId, pricingOptions = {}) {
    const playerRows = summarizeResult(simResult, selectedPlayers, pricingOptions);
    const hours = Math.max(1e-9, Number(simResult?.simulatedTime ?? 0) / ONE_HOUR);
    const metricPlayer = resolveAdvisorMetricPlayer(selectedPlayers, preferredPlayerId);
    const metricPlayerHrid = toPlayerHrid(metricPlayer.id);
    const metricRow = playerRows.find((row) => row?.playerHrid === metricPlayerHrid) || playerRows[0] || null;
    const fallbackKillsPerHour = toFiniteNumber(simResult?.encounters, 0) / hours;
    return {
        playerRows,
        metricPlayerId: metricPlayer.id,
        metricPlayerName: metricPlayer.name,
        profitPerHour: toFiniteNumber(metricRow?.profitPerHour, 0),
        xpPerHour: toFiniteNumber(metricRow?.totalXpPerHour, 0),
        killsPerHour: toFiniteNumber(metricRow?.encountersPerHour, fallbackKillsPerHour),
        deathsPerHour: toFiniteNumber(metricRow?.deathsPerHour, 0),
    };
}

export function buildAdvisorBaseRow(candidate, sample) {
    return {
        ...candidate,
        profitPerHour: toFiniteNumber(sample?.profitPerHour, 0),
        xpPerHour: toFiniteNumber(sample?.xpPerHour, 0),
        killsPerHour: toFiniteNumber(sample?.killsPerHour, 0),
        deathsPerHour: toFiniteNumber(sample?.deathsPerHour, 0),
        reasons: [],
        normalizedMetrics: {
            profitPerHour: 0,
            xpPerHour: 0,
            killsPerHour: 0,
            safety: 0,
        },
        finalScore: 0,
        baseFinalScore: 0,
        confidenceScore: null,
        confidencePenaltyFactor: 1,
        stabilityScore: 50,
        metricSummary: null,
    };
}

function resolveAdvisorRoundMetricValue(summary = {}, fallbackValue = 0) {
    return Number.isFinite(summary?.robustMean)
        ? toFiniteNumber(summary.robustMean, 0)
        : toFiniteNumber(fallbackValue, 0);
}

export function buildAdvisorCandidates(filters = {}) {
    const normalizedFilters = normalizeAdvisorFilters(filters);
    const candidates = [];
    let order = 0;

    if (normalizedFilters.includeSoloZones) {
        const soloTargets = buildZoneTargetsByScope(RUN_SCOPE_ALL_SOLO_ZONES);
        for (const zoneTarget of soloTargets) {
            candidates.push(createAdvisorZoneCandidate(zoneTarget, "solo_zone", order));
            order += 1;
        }
    }

    if (normalizedFilters.includeGroupZones) {
        const groupTargets = buildZoneTargetsByScope(RUN_SCOPE_ALL_GROUP_ZONES);
        for (const zoneTarget of groupTargets) {
            candidates.push(createAdvisorZoneCandidate(zoneTarget, "group_zone", order));
            order += 1;
        }
    }

    return candidates;
}

export function createAdvisorSimulationPayload(candidate, players, simulationTimeLimit, extra, options = {}) {
    return {
        type: "start_simulation",
        workerId: options.workerId ?? createDefaultWorkerId(options.random),
        players,
        zone: {
            zoneHrid: candidate.targetHrid,
            difficultyTier: Math.max(0, Math.floor(toFiniteNumber(candidate.difficultyTier, 0))),
        },
        labyrinth: null,
        simulationTimeLimit,
        extra,
    };
}

export function buildAdvisorRowFromRoundMetrics(candidate, roundMetrics = [], options = {}) {
    const safeRounds = Array.isArray(roundMetrics) ? roundMetrics.filter(Boolean) : [];
    const metricSummary = buildAdvisorMetricSummary(safeRounds);
    const fallbackSample = safeRounds[safeRounds.length - 1] || {};
    const profitSummary = metricSummary?.profitPerHour || {};
    const xpSummary = metricSummary?.xpPerHour || {};
    const killsSummary = metricSummary?.killsPerHour || {};
    const deathsSummary = metricSummary?.deathsPerHour || {};
    const sample = {
        profitPerHour: resolveAdvisorRoundMetricValue(profitSummary, fallbackSample?.profitPerHour),
        xpPerHour: resolveAdvisorRoundMetricValue(xpSummary, fallbackSample?.xpPerHour),
        killsPerHour: resolveAdvisorRoundMetricValue(killsSummary, fallbackSample?.killsPerHour),
        deathsPerHour: resolveAdvisorRoundMetricValue(deathsSummary, fallbackSample?.deathsPerHour),
    };

    return {
        ...buildAdvisorBaseRow(candidate, sample),
        isRefined: options.isRefined === true,
        refineRounds: Math.max(0, Math.floor(toFiniteNumber(options.refineRounds, candidate?.refineRounds ?? 0))),
        successfulRounds: safeRounds.length,
        metricSummary,
    };
}

export function buildAdvisorPartialErrorText(stageLabel, failedCandidates = []) {
    const safeStageLabel = String(stageLabel || "scan");
    const failedCount = Array.isArray(failedCandidates) ? failedCandidates.length : 0;
    if (failedCount <= 0) {
        return "";
    }
    return `${failedCount} target(s) failed during ${safeStageLabel}. Showing successful results only.`;
}

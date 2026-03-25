const ADVISOR_SCORE_MIN = 5;
const ADVISOR_SCORE_MAX = 95;
const ADVISOR_SCORE_TIE = 50;
const ADVISOR_SCORE_INVALID = 0;
const ADVISOR_WINSORIZE_PCT = 0.05;
const ADVISOR_MEDIAN_BLEND_WEIGHT = 0.5;
const ADVISOR_CONFIDENCE_SIZE_SCALE = 8;
const ADVISOR_CONFIDENCE_PENALTY_STRENGTH = 0.35;
const ADVISOR_REASON_TOP_PICK_LIMIT = 3;

export const ADVISOR_GOAL_PRESET_BALANCED = "balanced";
export const ADVISOR_GOAL_PRESET_PROFIT = "profit";
export const ADVISOR_GOAL_PRESET_XP = "xp";
export const ADVISOR_GOAL_PRESET_SAFE = "safe";
export const ADVISOR_GOAL_PRESET_CUSTOM = "custom";

export const ADVISOR_GOAL_PRESET_OPTIONS = [
    ADVISOR_GOAL_PRESET_BALANCED,
    ADVISOR_GOAL_PRESET_PROFIT,
    ADVISOR_GOAL_PRESET_XP,
    ADVISOR_GOAL_PRESET_SAFE,
    ADVISOR_GOAL_PRESET_CUSTOM,
];

export const ADVISOR_WEIGHT_KEYS = ["profitPerHour", "xpPerHour", "safety"];
export const ADVISOR_RAW_METRIC_KEYS = ["profitPerHour", "xpPerHour", "killsPerHour", "deathsPerHour"];
const ADVISOR_SCORING_METRIC_KEYS = ["profitPerHour", "xpPerHour", "deathsPerHour"];

const ADVISOR_PRESET_WEIGHT_MAP = Object.freeze({
    [ADVISOR_GOAL_PRESET_BALANCED]: Object.freeze({
        profitPerHour: 0.484615,
        xpPerHour: 0.415385,
        safety: 0.1,
    }),
    [ADVISOR_GOAL_PRESET_PROFIT]: Object.freeze({
        profitPerHour: 0.7875,
        xpPerHour: 0.1125,
        safety: 0.1,
    }),
    [ADVISOR_GOAL_PRESET_XP]: Object.freeze({
        profitPerHour: 0.18,
        xpPerHour: 0.72,
        safety: 0.1,
    }),
    [ADVISOR_GOAL_PRESET_SAFE]: Object.freeze({
        profitPerHour: 0.45,
        xpPerHour: 0.45,
        safety: 0.1,
    }),
});

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function computeArithmeticMean(values, fallback = 0) {
    if (!Array.isArray(values) || values.length === 0) {
        return fallback;
    }
    return values.reduce((sum, value) => sum + toFiniteNumber(value, 0), 0) / values.length;
}

function computePercentileFromSorted(sortedValues, percentile) {
    if (!Array.isArray(sortedValues) || sortedValues.length === 0) {
        return 0;
    }

    const safePercentile = clamp(toFiniteNumber(percentile, 0), 0, 1);
    const rawIndex = (sortedValues.length - 1) * safePercentile;
    const lowerIndex = Math.floor(rawIndex);
    const upperIndex = Math.ceil(rawIndex);
    if (lowerIndex === upperIndex) {
        return sortedValues[lowerIndex];
    }

    const interpolation = rawIndex - lowerIndex;
    return sortedValues[lowerIndex] + (sortedValues[upperIndex] - sortedValues[lowerIndex]) * interpolation;
}

function winsorizeValues(values, winsorizePct = 0) {
    const numericValues = (values ?? []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
    if (numericValues.length === 0) {
        return [];
    }

    const safePct = clamp(toFiniteNumber(winsorizePct, 0), 0, 0.49);
    if (safePct <= 0 || numericValues.length < 3) {
        return [...numericValues];
    }

    const sorted = [...numericValues].sort((a, b) => a - b);
    const lower = computePercentileFromSorted(sorted, safePct);
    const upper = computePercentileFromSorted(sorted, 1 - safePct);
    return numericValues.map((value) => clamp(value, lower, upper));
}

function computeConfidenceFromValues(values, centerValue) {
    const numericValues = (values ?? []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
    const sampleCount = numericValues.length;
    if (sampleCount <= 1) {
        return 0;
    }

    const mean = computeArithmeticMean(numericValues, 0);
    const variance = numericValues.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / sampleCount;
    const std = Math.sqrt(Math.max(0, variance));
    const ciHalfWidth95 = 1.96 * std / Math.sqrt(sampleCount);
    const scaleBase = Math.max(Math.abs(toFiniteNumber(centerValue, 0)), std, 1e-6);
    const intervalConfidence = 1 / (1 + ciHalfWidth95 / scaleBase);
    const sizeConfidence = 1 - Math.exp(-1 * (sampleCount - 1) / ADVISOR_CONFIDENCE_SIZE_SCALE);
    return clamp(intervalConfidence * sizeConfidence, 0, 1);
}

function summarizeMetric(values) {
    const safeValues = (values ?? []).map((value) => toFiniteNumber(value, 0));
    const blendWeight = clamp(toFiniteNumber(ADVISOR_MEDIAN_BLEND_WEIGHT, 0.5), 0, 1);
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
            confidence: 0,
            sampleCount: 0,
        };
    }

    const rawMean = computeArithmeticMean(safeValues, 0);
    const winsorizedValues = winsorizeValues(safeValues, ADVISOR_WINSORIZE_PCT);
    const winsorizedMean = computeArithmeticMean(winsorizedValues, rawMean);
    const sortedValues = [...winsorizedValues].sort((a, b) => a - b);
    const p50 = computePercentileFromSorted(sortedValues, 0.5);
    const p90 = computePercentileFromSorted(sortedValues, 0.9);
    const robustMean = meanWeight * winsorizedMean + blendWeight * p50;
    const min = Math.min(...winsorizedValues);
    const max = Math.max(...winsorizedValues);
    const variance = winsorizedValues.reduce((sum, value) => sum + ((value - robustMean) ** 2), 0) / winsorizedValues.length;
    const std = Math.sqrt(Math.max(0, variance));
    const robustCv = Math.abs(robustMean) > 1e-9 ? Math.abs(std / robustMean) : 1;
    const confidence = computeConfidenceFromValues(winsorizedValues, robustMean);

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
        confidence: toFiniteNumber(confidence, 0),
        sampleCount: safeValues.length,
    };
}

function rankScoreList(rawValues, options = {}) {
    const higherIsBetter = options.higherIsBetter !== false;
    const invalidScore = toFiniteNumber(options.invalidScore, ADVISOR_SCORE_INVALID);
    const tieScore = toFiniteNumber(options.tieScore, ADVISOR_SCORE_TIE);
    const minScore = toFiniteNumber(options.minScore, ADVISOR_SCORE_MIN);
    const maxScore = toFiniteNumber(options.maxScore, ADVISOR_SCORE_MAX);
    const clampedMinScore = Math.min(minScore, maxScore);
    const clampedMaxScore = Math.max(minScore, maxScore);

    const preparedValues = rawValues.map((value) => {
        if (value == null) {
            return null;
        }
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
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
        for (let rankIndex = cursor; rankIndex <= nextCursor; rankIndex += 1) {
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
        const percentile = higherIsBetter ? rankValue / denominator : 1 - rankValue / denominator;
        return clamp(clampedMinScore + percentile * scoreRange, clampedMinScore, clampedMaxScore);
    });

    return {
        scores,
        invalidFlags,
    };
}

function resolveMetricSummaryValue(row, metricKey) {
    const robustMean = Number(row?.metricSummary?.[metricKey]?.robustMean);
    if (Number.isFinite(robustMean)) {
        return robustMean;
    }
    const mean = Number(row?.metricSummary?.[metricKey]?.mean);
    if (Number.isFinite(mean)) {
        return mean;
    }
    const raw = Number(row?.[metricKey]);
    return Number.isFinite(raw) ? raw : null;
}

function resolveAverageConfidence(row) {
    if (!row?.metricSummary || typeof row.metricSummary !== "object") {
        return null;
    }

    const values = ADVISOR_SCORING_METRIC_KEYS
        .map((metricKey) => Number(row?.metricSummary?.[metricKey]?.confidence))
        .filter((value) => Number.isFinite(value));
    if (values.length === 0) {
        return null;
    }
    return clamp(computeArithmeticMean(values, 0), 0, 1);
}

function resolveAverageRobustCv(row) {
    if (!row?.metricSummary || typeof row.metricSummary !== "object") {
        return null;
    }

    const values = ADVISOR_SCORING_METRIC_KEYS
        .map((metricKey) => Number(row?.metricSummary?.[metricKey]?.robustCv))
        .filter((value) => Number.isFinite(value));
    if (values.length === 0) {
        return null;
    }
    return computeArithmeticMean(values, 0);
}

function getSortedBestRow(rows, selector, direction = "desc") {
    const sourceRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
    if (sourceRows.length === 0) {
        return null;
    }

    return sourceRows.slice().sort((left, right) => {
        const leftValue = toFiniteNumber(selector(left), direction === "asc" ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER);
        const rightValue = toFiniteNumber(selector(right), direction === "asc" ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER);
        if (leftValue !== rightValue) {
            return direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
        }
        return Number(left?.rank || 0) - Number(right?.rank || 0);
    })[0] || null;
}

export function normalizeAdvisorGoalPreset(preset) {
    const normalized = String(preset || "").trim().toLowerCase();
    if (ADVISOR_GOAL_PRESET_OPTIONS.includes(normalized)) {
        return normalized;
    }
    return ADVISOR_GOAL_PRESET_BALANCED;
}

export function getAdvisorPresetWeights(preset) {
    const normalizedPreset = normalizeAdvisorGoalPreset(preset);
    if (normalizedPreset === ADVISOR_GOAL_PRESET_CUSTOM) {
        return { ...ADVISOR_PRESET_WEIGHT_MAP[ADVISOR_GOAL_PRESET_BALANCED] };
    }
    return { ...ADVISOR_PRESET_WEIGHT_MAP[normalizedPreset] };
}

export function normalizeAdvisorWeights(rawWeights = {}, fallbackPreset = ADVISOR_GOAL_PRESET_BALANCED) {
    const fallbackWeights = getAdvisorPresetWeights(fallbackPreset);
    const fallbackProfit = Math.max(0, toFiniteNumber(fallbackWeights.profitPerHour, 0));
    const fallbackXp = Math.max(0, toFiniteNumber(fallbackWeights.xpPerHour, 0));
    const fallbackAdjustableSum = fallbackProfit + fallbackXp;
    const safeFallbackProfit = fallbackAdjustableSum > 1e-9 ? fallbackProfit : 0.45;
    const safeFallbackXp = fallbackAdjustableSum > 1e-9 ? fallbackXp : 0.45;

    const profitInput = Math.max(0, toFiniteNumber(rawWeights?.profitPerHour, safeFallbackProfit));
    const xpInput = Math.max(0, toFiniteNumber(rawWeights?.xpPerHour, safeFallbackXp));
    const adjustableSum = profitInput + xpInput;

    if (adjustableSum <= 1e-9) {
        return { ...fallbackWeights };
    }

    return {
        profitPerHour: profitInput / adjustableSum * 0.9,
        xpPerHour: xpInput / adjustableSum * 0.9,
        safety: 0.1,
    };
}

export function resolveAdvisorWeights(goalPreset, customWeights = {}) {
    const normalizedPreset = normalizeAdvisorGoalPreset(goalPreset);
    if (normalizedPreset === ADVISOR_GOAL_PRESET_CUSTOM) {
        return normalizeAdvisorWeights(customWeights, ADVISOR_GOAL_PRESET_BALANCED);
    }
    return getAdvisorPresetWeights(normalizedPreset);
}

export function buildAdvisorMetricSummary(roundMetrics = []) {
    const safeRounds = Array.isArray(roundMetrics) ? roundMetrics : [];
    const summary = {};
    for (const metricKey of ADVISOR_RAW_METRIC_KEYS) {
        summary[metricKey] = summarizeMetric(safeRounds.map((entry) => entry?.[metricKey]));
    }
    return summary;
}

export function rankAdvisorRows(rows = [], options = {}) {
    const safeRows = Array.isArray(rows) ? rows.filter(Boolean).map((row) => ({ ...row })) : [];
    if (safeRows.length === 0) {
        return [];
    }

    const weights = resolveAdvisorWeights(options?.goalPreset, options?.customWeights);
    const quickRankById = options?.quickRankById instanceof Map ? options.quickRankById : new Map();

    const profitScores = rankScoreList(
        safeRows.map((row) => resolveMetricSummaryValue(row, "profitPerHour")),
        { higherIsBetter: true }
    );
    const xpScores = rankScoreList(
        safeRows.map((row) => resolveMetricSummaryValue(row, "xpPerHour")),
        { higherIsBetter: true }
    );
    const safetyScores = rankScoreList(
        safeRows.map((row) => resolveMetricSummaryValue(row, "deathsPerHour")),
        { higherIsBetter: false }
    );
    const stabilityScores = rankScoreList(
        safeRows.map((row) => resolveAverageRobustCv(row)),
        { higherIsBetter: false, tieScore: ADVISOR_SCORE_TIE }
    );

    const rankedRows = safeRows.map((row, index) => {
        const normalizedMetrics = {
            profitPerHour: toFiniteNumber(profitScores?.scores?.[index], ADVISOR_SCORE_INVALID),
            xpPerHour: toFiniteNumber(xpScores?.scores?.[index], ADVISOR_SCORE_INVALID),
            safety: toFiniteNumber(safetyScores?.scores?.[index], ADVISOR_SCORE_INVALID),
        };
        const baseFinalScore = (
            normalizedMetrics.profitPerHour * weights.profitPerHour
            + normalizedMetrics.xpPerHour * weights.xpPerHour
            + normalizedMetrics.safety * weights.safety
        );

        const avgConfidence = resolveAverageConfidence(row);
        const confidencePenaltyFactor = avgConfidence == null
            ? 1
            : clamp((1 - ADVISOR_CONFIDENCE_PENALTY_STRENGTH) + ADVISOR_CONFIDENCE_PENALTY_STRENGTH * avgConfidence, 0, 1);
        const finalScore = baseFinalScore * confidencePenaltyFactor;

        return {
            ...row,
            normalizedMetrics,
            baseFinalScore: toFiniteNumber(baseFinalScore, 0),
            finalScore: toFiniteNumber(finalScore, 0),
            confidenceScore: avgConfidence == null ? null : toFiniteNumber(avgConfidence * 100, 0),
            confidencePenaltyFactor: toFiniteNumber(confidencePenaltyFactor, 1),
            stabilityScore: toFiniteNumber(stabilityScores?.scores?.[index], ADVISOR_SCORE_TIE),
        };
    });

    rankedRows.sort((left, right) => {
        if (right.finalScore !== left.finalScore) {
            return right.finalScore - left.finalScore;
        }
        if (toFiniteNumber(right.profitPerHour, 0) !== toFiniteNumber(left.profitPerHour, 0)) {
            return toFiniteNumber(right.profitPerHour, 0) - toFiniteNumber(left.profitPerHour, 0);
        }
        if (toFiniteNumber(right.xpPerHour, 0) !== toFiniteNumber(left.xpPerHour, 0)) {
            return toFiniteNumber(right.xpPerHour, 0) - toFiniteNumber(left.xpPerHour, 0);
        }
        if (toFiniteNumber(left.deathsPerHour, 0) !== toFiniteNumber(right.deathsPerHour, 0)) {
            return toFiniteNumber(left.deathsPerHour, 0) - toFiniteNumber(right.deathsPerHour, 0);
        }
        return toFiniteNumber(left.order, 0) - toFiniteNumber(right.order, 0);
    });

    rankedRows.forEach((row, index) => {
        row.rank = index + 1;
    });

    const bestProfitRow = getSortedBestRow(rankedRows, (row) => row.profitPerHour, "desc");
    const bestXpRow = getSortedBestRow(rankedRows, (row) => row.xpPerHour, "desc");
    const safestRow = getSortedBestRow(rankedRows, (row) => row.deathsPerHour, "asc");

    rankedRows.forEach((row) => {
        const reasons = [];
        if (bestProfitRow?.id === row.id) {
            reasons.push("top_profit");
        }
        if (bestXpRow?.id === row.id) {
            reasons.push("top_xp");
        }
        if (safestRow?.id === row.id) {
            reasons.push("safest");
        }
        if (Number(row.rank || 0) > 0 && Number(row.rank || 0) <= ADVISOR_REASON_TOP_PICK_LIMIT) {
            reasons.push("top_pick");
        }
        if (row.isRefined && quickRankById.has(row.id) && Number(row.rank || 0) < Number(quickRankById.get(row.id) || 0)) {
            reasons.push("validated");
        }
        row.reasons = reasons;
    });

    return rankedRows;
}

export function buildAdvisorTopCards(rows = []) {
    const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
    if (safeRows.length === 0) {
        return [];
    }

    const cards = [];
    const bestOverall = safeRows[0] || null;
    const bestProfit = getSortedBestRow(safeRows, (row) => row.profitPerHour, "desc");
    const bestXp = getSortedBestRow(safeRows, (row) => row.xpPerHour, "desc");
    const safest = getSortedBestRow(safeRows, (row) => row.deathsPerHour, "asc");

    const definitions = [
        { key: "overall", titleKey: "best_overall", row: bestOverall },
        { key: "profit", titleKey: "best_profit", row: bestProfit },
        { key: "xp", titleKey: "best_xp", row: bestXp },
        { key: "safe", titleKey: "safest", row: safest },
    ];

    for (const definition of definitions) {
        if (!definition.row) {
            continue;
        }
        cards.push({
            key: definition.key,
            titleKey: definition.titleKey,
            rowId: definition.row.id,
            targetName: definition.row.targetName,
            targetType: definition.row.targetType,
            category: definition.row.category,
            score: toFiniteNumber(definition.row.finalScore, 0),
            confidenceScore: definition.row.confidenceScore,
        });
    }

    return cards;
}

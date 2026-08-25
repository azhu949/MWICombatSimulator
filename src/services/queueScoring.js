import { MARKET_HISTORY_PRICE_SOURCE } from './marketHistoryService.js';
import { resolveQueuePerformanceSubweights } from '../shared/queuePerformanceWeights.js';
import {
  computeArithmeticMean,
  computeConfidenceFromValues,
  computePercentileFromSorted,
  winsorizeValues,
} from './robustStats.js';
import { clamp, deepClone, isPlainObject, toFiniteNumber } from './utils.js';

export const QUEUE_PARALLEL_WORKER_LIMIT_MIN = 1;
export const QUEUE_PARALLEL_WORKER_LIMIT_MAX = 64;
export const QUEUE_WEIGHT_SUM_EPSILON = 1e-6;
export const QUEUE_MULTI_ROUND_DEFAULT_PARALLEL_WORKERS = 4;
export const QUEUE_MULTI_ROUND_METRIC_KEYS = ['dps', 'dailyNoRngProfit', 'xpPerHour', 'killsPerHour'];
export const QUEUE_BASELINE_METRIC_KEYS = [
  'encountersPerHour',
  'deathsPerHour',
  'totalXpPerHour',
  'profitPerHour',
  ...QUEUE_MULTI_ROUND_METRIC_KEYS,
];
export const QUEUE_COST_SCORE_GOLD_METRIC_STRICT = 'strict';
export const QUEUE_COST_SCORE_GOLD_METRIC_COMPOSITE = 'composite';
export const OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE = 'official_hourly_average';
export const MANUAL_EQUIPMENT_PRICE_SOURCE = 'manual';
export const MANUAL_PRICE_WARNING_CODE = 'manual_price';

const QUEUE_MULTI_ROUND_WINSORIZE_PCT = 0.05;
const QUEUE_MULTI_ROUND_MEDIAN_BLEND_WEIGHT = 0.5;
const QUEUE_MULTI_ROUND_CONFIDENCE_SIZE_SCALE = 8;
const QUEUE_MULTI_ROUND_CONFIDENCE_PENALTY_STRENGTH = 0.35;
const QUEUE_MULTI_ROUND_SCORE_MIN = 5;
const QUEUE_MULTI_ROUND_SCORE_MAX = 95;
const QUEUE_MULTI_ROUND_SCORE_TIE = 50;
const QUEUE_MULTI_ROUND_SCORE_INVALID = 0;
const QUEUE_MULTI_ROUND_FINAL_WEIGHT_PERFORMANCE = 0.4;
const QUEUE_MULTI_ROUND_FINAL_WEIGHT_STABILITY = 0.2;
const QUEUE_MULTI_ROUND_FINAL_WEIGHT_COST = 0.4;
const QUEUE_COST_SCORE_WEIGHT_UPGRADE = 0.25;
const QUEUE_COST_SCORE_WEIGHT_PURCHASE_DAYS = 0.35;
const QUEUE_COST_SCORE_WEIGHT_GOLD_PER_POINT = 0.4;

function getMean(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function getMedian(values) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].map((value) => Number(value || 0)).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function getStdDev(values, meanValue) {
  if (!values.length) {
    return 0;
  }
  const variance =
    values.reduce((sum, value) => {
      const delta = Number(value || 0) - meanValue;
      return sum + delta * delta;
    }, 0) / values.length;
  return Math.sqrt(variance);
}

export function getDefaultQueueRuntimeSettings() {
  return {
    finalWeights: {
      performance: QUEUE_MULTI_ROUND_FINAL_WEIGHT_PERFORMANCE,
      stability: QUEUE_MULTI_ROUND_FINAL_WEIGHT_STABILITY,
      cost: QUEUE_MULTI_ROUND_FINAL_WEIGHT_COST,
    },
    costScoreGoldPerPointMode: QUEUE_COST_SCORE_GOLD_METRIC_STRICT,
    parallelWorkerLimit: QUEUE_MULTI_ROUND_DEFAULT_PARALLEL_WORKERS,
  };
}

export function isQueueCostScoreGoldMetricMode(value) {
  return value === QUEUE_COST_SCORE_GOLD_METRIC_STRICT || value === QUEUE_COST_SCORE_GOLD_METRIC_COMPOSITE;
}

export function normalizeQueueCostScoreGoldMetricMode(value) {
  return value === QUEUE_COST_SCORE_GOLD_METRIC_COMPOSITE
    ? QUEUE_COST_SCORE_GOLD_METRIC_COMPOSITE
    : QUEUE_COST_SCORE_GOLD_METRIC_STRICT;
}

export function normalizeQueueScoreWeights(scoreWeights) {
  const defaults = getDefaultQueueRuntimeSettings().finalWeights;
  const performance = Number(scoreWeights?.performance);
  const stability = Number(scoreWeights?.stability);
  const cost = Number(scoreWeights?.cost);

  if (
    !Number.isFinite(performance) ||
    !Number.isFinite(stability) ||
    !Number.isFinite(cost) ||
    performance < 0 ||
    stability < 0 ||
    cost < 0 ||
    performance > 1 ||
    stability > 1 ||
    cost > 1
  ) {
    return {
      ...defaults,
    };
  }

  const weightSum = performance + stability + cost;
  if (Math.abs(weightSum - 1) > QUEUE_WEIGHT_SUM_EPSILON) {
    return {
      ...defaults,
    };
  }

  return {
    performance,
    stability,
    cost,
  };
}

export function haveQueueScoreWeightsChanged(previousWeights, nextWeights) {
  const normalizedPrevious = normalizeQueueScoreWeights(previousWeights);
  const normalizedNext = normalizeQueueScoreWeights(nextWeights);
  return (
    Math.abs(normalizedPrevious.performance - normalizedNext.performance) > QUEUE_WEIGHT_SUM_EPSILON ||
    Math.abs(normalizedPrevious.stability - normalizedNext.stability) > QUEUE_WEIGHT_SUM_EPSILON ||
    Math.abs(normalizedPrevious.cost - normalizedNext.cost) > QUEUE_WEIGHT_SUM_EPSILON
  );
}

export function haveQueueRuntimeRankingSettingsChanged(previousSettings, nextSettings) {
  const normalizedPrevious = normalizeQueueRuntimeSettings(previousSettings);
  const normalizedNext = normalizeQueueRuntimeSettings(nextSettings);
  return (
    haveQueueScoreWeightsChanged(normalizedPrevious.finalWeights, normalizedNext.finalWeights) ||
    normalizedPrevious.costScoreGoldPerPointMode !== normalizedNext.costScoreGoldPerPointMode
  );
}

export function haveQueueRunRankingSettingsChanged(previousSettings, nextSettings) {
  const normalizedPrevious = normalizeQueueSettings(previousSettings);
  const normalizedNext = normalizeQueueSettings(nextSettings);
  return (
    Math.abs(normalizedPrevious.medianBlend - normalizedNext.medianBlend) > QUEUE_WEIGHT_SUM_EPSILON ||
    Math.abs(normalizedPrevious.weightProfit - normalizedNext.weightProfit) > QUEUE_WEIGHT_SUM_EPSILON ||
    Math.abs(normalizedPrevious.weightXp - normalizedNext.weightXp) > QUEUE_WEIGHT_SUM_EPSILON ||
    Math.abs(normalizedPrevious.weightDeathSafety - normalizedNext.weightDeathSafety) > QUEUE_WEIGHT_SUM_EPSILON
  );
}

export function normalizeParallelWorkerLimit(value, maxLimit = QUEUE_PARALLEL_WORKER_LIMIT_MAX) {
  const parsed = Math.floor(toFiniteNumber(value, QUEUE_MULTI_ROUND_DEFAULT_PARALLEL_WORKERS));
  const hardMax = clamp(
    Math.floor(toFiniteNumber(maxLimit, QUEUE_PARALLEL_WORKER_LIMIT_MAX)),
    QUEUE_PARALLEL_WORKER_LIMIT_MIN,
    QUEUE_PARALLEL_WORKER_LIMIT_MAX,
  );
  return clamp(parsed, QUEUE_PARALLEL_WORKER_LIMIT_MIN, hardMax);
}

export function normalizeQueueRuntimeSettings(settings) {
  return {
    finalWeights: normalizeQueueScoreWeights(settings?.finalWeights),
    costScoreGoldPerPointMode: normalizeQueueCostScoreGoldMetricMode(settings?.costScoreGoldPerPointMode),
    parallelWorkerLimit: normalizeParallelWorkerLimit(settings?.parallelWorkerLimit),
  };
}

export function getDefaultQueueRunSettings() {
  return {
    rounds: 30,
    baselineRounds: 1,
    medianBlend: 0.5,
    weightProfit: 0.5,
    weightXp: 0.3,
    weightDeathSafety: 0.2,
    executionMode: 'parallel',
  };
}

export function getQueuePerformanceMetricWeights(queueSettings = getDefaultQueueRunSettings()) {
  return resolveQueuePerformanceSubweights(queueSettings, getDefaultQueueRunSettings()).byMetric;
}

export function normalizeQueueSettings(settings) {
  const defaults = getDefaultQueueRunSettings();
  const rounds = clamp(Math.floor(toFiniteNumber(settings?.rounds, defaults.rounds)), 1, 200);
  const baselineRounds = clamp(Math.floor(toFiniteNumber(settings?.baselineRounds, defaults.baselineRounds)), 1, 200);
  const medianBlend = clamp(toFiniteNumber(settings?.medianBlend, defaults.medianBlend), 0, 1);
  // 队列性能子权重被刻意归一化到 10 个十分位上。
  const normalizedPerformanceWeights = resolveQueuePerformanceSubweights(settings, defaults);
  const executionModeRaw = settings?.executionMode;
  const executionMode =
    executionModeRaw == null ? defaults.executionMode : executionModeRaw === 'parallel' ? 'parallel' : 'serial';

  return {
    rounds,
    baselineRounds,
    medianBlend,
    weightProfit: normalizedPerformanceWeights.weightProfit,
    weightXp: normalizedPerformanceWeights.weightXp,
    weightDeathSafety: normalizedPerformanceWeights.weightDeathSafety,
    executionMode,
  };
}

function computePurchaseDaysByBaselineProfit(upgradeCost, baselineDailyNoRngProfit) {
  const safeCost = toFiniteNumber(upgradeCost, 0);
  const safeBaselineProfit = toFiniteNumber(baselineDailyNoRngProfit, 0);
  if (safeCost <= 0 || safeBaselineProfit <= 0) {
    return null;
  }
  return safeCost / safeBaselineProfit;
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

export function summarizeMetric(values, deltaPctValues, medianBlend = QUEUE_MULTI_ROUND_MEDIAN_BLEND_WEIGHT) {
  const safeValues = (values ?? []).map((value) => toFiniteNumber(value, 0));
  const blendWeight = clamp(toFiniteNumber(medianBlend, QUEUE_MULTI_ROUND_MEDIAN_BLEND_WEIGHT), 0, 1);
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
      rawMeanDeltaPct: 0,
      winsorizedMeanDeltaPct: 0,
      medianDeltaPct: 0,
      robustMeanDeltaPct: 0,
      meanDeltaPct: 0,
      confidence: 0,
      confidenceDeltaPct: 0,
      sampleCount: 0,
      deltaSampleCount: 0,
    };
  }

  const rawMean = computeArithmeticMean(safeValues, 0);
  const winsorizedValues = winsorizeValues(safeValues, QUEUE_MULTI_ROUND_WINSORIZE_PCT);
  const winsorizedMean = computeArithmeticMean(winsorizedValues, rawMean);
  const sortedValues = [...winsorizedValues].sort((a, b) => a - b);
  const p50 = computePercentileFromSorted(sortedValues, 0.5);
  const p90 = computePercentileFromSorted(sortedValues, 0.9);
  const robustMean = meanWeight * winsorizedMean + blendWeight * p50;

  const min = Math.min(...winsorizedValues);
  const max = Math.max(...winsorizedValues);
  const variance =
    winsorizedValues.reduce((sum, value) => sum + (value - robustMean) ** 2, 0) / winsorizedValues.length;
  const std = Math.sqrt(Math.max(0, variance));
  const robustCv = Math.abs(robustMean) > 1e-9 ? Math.abs(std / robustMean) : 1;
  const confidence = computeConfidenceFromValues(winsorizedValues, robustMean, {
    confidenceSizeScale: QUEUE_MULTI_ROUND_CONFIDENCE_SIZE_SCALE,
  });

  const safeDeltaPctValues = (deltaPctValues ?? [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  const rawMeanDeltaPct = computeArithmeticMean(safeDeltaPctValues, 0);
  const winsorizedDeltaPctValues = winsorizeValues(safeDeltaPctValues, QUEUE_MULTI_ROUND_WINSORIZE_PCT);
  const winsorizedMeanDeltaPct = computeArithmeticMean(winsorizedDeltaPctValues, rawMeanDeltaPct);
  const sortedDeltaValues = [...winsorizedDeltaPctValues].sort((a, b) => a - b);
  const medianDeltaPct =
    sortedDeltaValues.length > 0 ? computePercentileFromSorted(sortedDeltaValues, 0.5) : rawMeanDeltaPct;
  const robustMeanDeltaPct = meanWeight * winsorizedMeanDeltaPct + blendWeight * medianDeltaPct;
  const confidenceDeltaPct = computeConfidenceFromValues(winsorizedDeltaPctValues, robustMeanDeltaPct, {
    confidenceSizeScale: QUEUE_MULTI_ROUND_CONFIDENCE_SIZE_SCALE,
  });
  const normalizedRobustMeanDeltaPct = toFiniteNumber(robustMeanDeltaPct, 0);

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
    rawMeanDeltaPct: toFiniteNumber(rawMeanDeltaPct, 0),
    winsorizedMeanDeltaPct: toFiniteNumber(winsorizedMeanDeltaPct, 0),
    medianDeltaPct: toFiniteNumber(medianDeltaPct, 0),
    robustMeanDeltaPct: normalizedRobustMeanDeltaPct,
    // 持久化队列摘要的旧版别名；新代码应读取 robustMeanDeltaPct。
    meanDeltaPct: normalizedRobustMeanDeltaPct,
    confidence: toFiniteNumber(confidence, 0),
    confidenceDeltaPct: toFiniteNumber(confidenceDeltaPct, 0),
    sampleCount: safeValues.length,
    deltaSampleCount: safeDeltaPctValues.length,
  };
}

export function buildMetricSummaryForKeys(
  roundResults = [],
  metricKeys = QUEUE_MULTI_ROUND_METRIC_KEYS,
  includeDeltaPct = true,
  medianBlend = QUEUE_MULTI_ROUND_MEDIAN_BLEND_WEIGHT,
) {
  const metricSummary = {};
  for (const metricKey of metricKeys) {
    const metricValues = roundResults.map((result) => toFiniteNumber(result?.metrics?.[metricKey], 0));
    const deltaPctValues = includeDeltaPct
      ? roundResults.map((result) => Number(result?.deltas?.[metricKey]?.pct))
      : [];
    metricSummary[metricKey] = summarizeMetric(metricValues, deltaPctValues, medianBlend);
  }
  return metricSummary;
}

export function buildQueueItemMetricSummary(roundResults = [], medianBlend = QUEUE_MULTI_ROUND_MEDIAN_BLEND_WEIGHT) {
  return buildMetricSummaryForKeys(roundResults, QUEUE_MULTI_ROUND_METRIC_KEYS, true, medianBlend);
}

export function buildQueueBaselineMetricSummary(
  roundResults = [],
  medianBlend = QUEUE_MULTI_ROUND_MEDIAN_BLEND_WEIGHT,
) {
  return buildMetricSummaryForKeys(roundResults, QUEUE_BASELINE_METRIC_KEYS, false, medianBlend);
}

export function resolveMetricSummaryAggregateValue(metricSummaryEntry, medianBlend = null) {
  if (medianBlend != null) {
    const blendWeight = clamp(toFiniteNumber(medianBlend, QUEUE_MULTI_ROUND_MEDIAN_BLEND_WEIGHT), 0, 1);
    const meanWeight = 1 - blendWeight;
    const winsorizedMean = Number(metricSummaryEntry?.winsorizedMean);
    const p50 = Number(metricSummaryEntry?.p50);
    if (Number.isFinite(winsorizedMean) && Number.isFinite(p50)) {
      return meanWeight * winsorizedMean + blendWeight * p50;
    }
  }

  const robustMean = Number(metricSummaryEntry?.robustMean);
  if (Number.isFinite(robustMean)) {
    return robustMean;
  }

  const meanValue = Number(metricSummaryEntry?.mean);
  if (Number.isFinite(meanValue)) {
    return meanValue;
  }

  return 0;
}

export function buildAggregatedMetricsFromMetricSummary(metricSummary = {}, metricKeys = [], medianBlend = null) {
  const metrics = {};
  for (const metricKey of metricKeys) {
    metrics[metricKey] = toFiniteNumber(resolveMetricSummaryAggregateValue(metricSummary?.[metricKey], medianBlend), 0);
  }
  return metrics;
}

export function buildQueueBaselineAggregate(roundResults = [], medianBlend = QUEUE_MULTI_ROUND_MEDIAN_BLEND_WEIGHT) {
  const metricSummary = buildQueueBaselineMetricSummary(roundResults, medianBlend);
  return {
    metricSummary,
    metrics: buildAggregatedMetricsFromMetricSummary(metricSummary, QUEUE_BASELINE_METRIC_KEYS, medianBlend),
  };
}

export function resolveQueueBaselineMetricsForSettings(baseline = null, queueSettings = getDefaultQueueRunSettings()) {
  if (!isPlainObject(baseline)) {
    return null;
  }

  if (isPlainObject(baseline.metricSummary)) {
    const normalizedQueueSettings = normalizeQueueSettings(queueSettings);
    return buildAggregatedMetricsFromMetricSummary(
      baseline.metricSummary,
      QUEUE_BASELINE_METRIC_KEYS,
      normalizedQueueSettings.medianBlend,
    );
  }

  return isPlainObject(baseline.metrics) ? baseline.metrics : null;
}

export function hasAggregatedQueueBaselineMetrics(baseline = null) {
  if (!isPlainObject(baseline)) {
    return false;
  }

  if (!isPlainObject(baseline.metricSummary)) {
    return false;
  }

  const completedRounds = Math.max(0, Math.floor(toFiniteNumber(baseline.completedRounds, 0)));
  if (completedRounds <= 0) {
    return false;
  }

  return QUEUE_MULTI_ROUND_METRIC_KEYS.every((metricKey) => Number.isFinite(Number(baseline?.metrics?.[metricKey])));
}

export function rankScoreList(rawValues, options = {}) {
  const higherIsBetter = options.higherIsBetter !== false;
  const logScale = Boolean(options.logScale);
  const invalidScore = toFiniteNumber(options.invalidScore, QUEUE_MULTI_ROUND_SCORE_INVALID);
  const tieScore = toFiniteNumber(options.tieScore, QUEUE_MULTI_ROUND_SCORE_TIE);
  const minScore = toFiniteNumber(options.minScore, QUEUE_MULTI_ROUND_SCORE_MIN);
  const maxScore = toFiniteNumber(options.maxScore, QUEUE_MULTI_ROUND_SCORE_MAX);
  const clampedMinScore = Math.min(minScore, maxScore);
  const clampedMaxScore = Math.max(minScore, maxScore);

  const preparedValues = rawValues.map((value) => {
    if (value == null) {
      return null;
    }
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
      nextCursor + 1 < validEntries.length &&
      Math.abs(validEntries[nextCursor + 1].value - validEntries[cursor].value) <= tieEpsilon
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
    const percentile = higherIsBetter ? rankValue / denominator : 1 - rankValue / denominator;
    const rankedScore = clampedMinScore + percentile * scoreRange;
    return clamp(rankedScore, clampedMinScore, clampedMaxScore);
  });

  return {
    scores,
    invalidFlags,
  };
}

export function createEmptyQueueCostInsights() {
  return {
    totalUpgradeCost: null,
    purchaseDays: null,
    goldPerPoint01Pct: {},
    goldPerPoint01PctAvg: null,
    compositeDeltaPct: null,
    compositeGoldPerPoint01Pct: null,
    equipmentSaleValue: null,
    equipmentBuyPrice: null,
    equipmentNetCost: null,
    upgradePriceSource: null,
    manualPriceSlots: [],
  };
}

export function resolveUpgradePriceSourceFromInspections(inspections = []) {
  const contributingInspections = inspections.filter((inspection) => inspection.targetAskAvailable);
  if (contributingInspections.length === 0) {
    return { upgradePriceSource: null, manualPriceSlots: [] };
  }
  const manualInspections = contributingInspections.filter(
    (inspection) => inspection.targetPriceSource === MANUAL_EQUIPMENT_PRICE_SOURCE,
  );
  const hasManual = manualInspections.length > 0;
  const hasMarketConfirmed = contributingInspections.some(
    (inspection) =>
      inspection.targetPriceSource === OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE ||
      inspection.targetPriceSource === MARKET_HISTORY_PRICE_SOURCE,
  );
  const hasExactAsk = contributingInspections.some((inspection) => inspection.targetPriceSource === 'ask');

  let upgradePriceSource = null;
  if (hasManual) {
    upgradePriceSource = hasExactAsk || hasMarketConfirmed ? 'mixed_manual' : 'manual';
  } else if (hasMarketConfirmed) {
    upgradePriceSource = hasExactAsk ? 'mixed_market' : 'market';
  } else if (hasExactAsk) {
    upgradePriceSource = 'ask';
  }

  return {
    upgradePriceSource,
    manualPriceSlots: manualInspections.map((inspection) => ({
      slotKey: inspection.slotKey,
      itemHrid: inspection.afterItemHrid,
      enhancementLevel: inspection.afterLevel,
      price: inspection.confirmedPrice?.price ?? null,
    })),
  };
}

export function resolveQueueMetricSummaryDeltaPct(metricSummary = {}, metricKey = '') {
  const robustDeltaPct = Number(metricSummary?.[metricKey]?.robustMeanDeltaPct);
  if (Number.isFinite(robustDeltaPct)) {
    return robustDeltaPct;
  }

  const fallbackDeltaPct = Number(metricSummary?.[metricKey]?.meanDeltaPct);
  if (Number.isFinite(fallbackDeltaPct)) {
    return fallbackDeltaPct;
  }

  return null;
}

export function computeWeightedQueueMetricAverage(metricValues = {}, metricWeights = {}) {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const metricKey of QUEUE_MULTI_ROUND_METRIC_KEYS) {
    const weight = Math.max(0, toFiniteNumber(metricWeights?.[metricKey], 0));
    if (weight <= 0) {
      continue;
    }

    const value = Number(metricValues?.[metricKey]);
    if (!Number.isFinite(value)) {
      return null;
    }

    weightedSum += value * weight;
    totalWeight += weight;
  }

  if (totalWeight <= 0) {
    return null;
  }

  return weightedSum / totalWeight;
}

export function buildQueueItemCostInsights(
  queueState,
  queueItemSnapshot,
  metricSummary,
  pricingState,
  queueSettings,
  confirmedEquipmentPrices = [],
  dependencies = {},
) {
  const baselineSnapshot = queueState?.baseline?.snapshot ?? null;
  const inspectQueueEquipmentPricing = dependencies.inspectQueueEquipmentPricing;
  const computeQueueItemUpgradeCost = dependencies.computeQueueItemUpgradeCost;
  const equipmentInspections =
    typeof inspectQueueEquipmentPricing === 'function'
      ? inspectQueueEquipmentPricing(baselineSnapshot, queueItemSnapshot, pricingState, confirmedEquipmentPrices)
      : [];
  const { upgradePriceSource, manualPriceSlots } = resolveUpgradePriceSourceFromInspections(equipmentInspections);
  let equipmentSaleValue = null;
  let equipmentBuyPrice = null;
  if (equipmentInspections.length > 0) {
    const hasMissingTargetAsk = equipmentInspections.some(
      (inspection) => inspection.targetAsk == null || !Number.isFinite(Number(inspection.targetAsk)),
    );
    if (!hasMissingTargetAsk) {
      equipmentSaleValue = equipmentInspections.reduce(
        (sum, inspection) => sum + Math.max(0, toFiniteNumber(inspection.baselineSaleValue, 0)),
        0,
      );
      equipmentBuyPrice = equipmentInspections.reduce(
        (sum, inspection) => sum + Math.max(0, toFiniteNumber(inspection.targetAsk, 0)),
        0,
      );
    }
  }
  const equipmentNetCost =
    equipmentSaleValue != null && equipmentBuyPrice != null
      ? Math.max(0, toFiniteNumber(equipmentBuyPrice, 0) - toFiniteNumber(equipmentSaleValue, 0))
      : null;
  const totalUpgradeCostRaw =
    typeof computeQueueItemUpgradeCost === 'function'
      ? computeQueueItemUpgradeCost(baselineSnapshot, queueItemSnapshot, pricingState, {
          abilityCostMap: queueState?.abilityUpgradeCosts,
          confirmedEquipmentPrices,
        })
      : null;
  const totalUpgradeCost =
    totalUpgradeCostRaw != null && Number.isFinite(Number(totalUpgradeCostRaw))
      ? Math.max(0, toFiniteNumber(totalUpgradeCostRaw, 0))
      : null;
  const purchaseDays = computePurchaseDaysByBaselineProfit(
    totalUpgradeCost,
    queueState?.baseline?.metrics?.dailyNoRngProfit,
  );

  const goldPerPoint01Pct = {};
  for (const metricKey of QUEUE_MULTI_ROUND_METRIC_KEYS) {
    const resolvedDeltaPct = resolveQueueMetricSummaryDeltaPct(metricSummary, metricKey);
    goldPerPoint01Pct[metricKey] = computeGoldPerPoint01Pct(totalUpgradeCost, { pct: resolvedDeltaPct });
  }

  const goldValues = QUEUE_MULTI_ROUND_METRIC_KEYS.map((metricKey) => goldPerPoint01Pct[metricKey]);
  const goldPerPoint01PctAvg =
    goldValues.length === QUEUE_MULTI_ROUND_METRIC_KEYS.length &&
    goldValues.every((value) => Number.isFinite(value) && value > 0)
      ? goldValues.reduce((sum, value) => sum + value, 0) / goldValues.length
      : null;
  const compositeDeltaByMetric = Object.fromEntries(
    QUEUE_MULTI_ROUND_METRIC_KEYS.map((metricKey) => [
      metricKey,
      resolveQueueMetricSummaryDeltaPct(metricSummary, metricKey),
    ]),
  );
  const compositeDeltaPct = computeWeightedQueueMetricAverage(
    compositeDeltaByMetric,
    getQueuePerformanceMetricWeights(queueSettings),
  );
  const compositeGoldPerPoint01Pct = computeGoldPerPoint01Pct(totalUpgradeCost, { pct: compositeDeltaPct });

  return {
    totalUpgradeCost,
    purchaseDays,
    goldPerPoint01Pct,
    goldPerPoint01PctAvg,
    compositeDeltaPct,
    compositeGoldPerPoint01Pct,
    equipmentSaleValue,
    equipmentBuyPrice,
    equipmentNetCost,
    upgradePriceSource,
    manualPriceSlots,
  };
}

export function buildMultiRoundRanking(
  metricSummaryByQueueItem,
  queueRuntimeSettings = getDefaultQueueRuntimeSettings(),
  queueSettings = getDefaultQueueRunSettings(),
) {
  const normalizedQueueRuntimeSettings = normalizeQueueRuntimeSettings(
    isPlainObject(queueRuntimeSettings) && isPlainObject(queueRuntimeSettings.finalWeights)
      ? queueRuntimeSettings
      : { finalWeights: queueRuntimeSettings },
  );
  const normalizedScoreWeights = normalizedQueueRuntimeSettings.finalWeights;
  const costScoreGoldPerPointMode = normalizedQueueRuntimeSettings.costScoreGoldPerPointMode;
  const performanceMetricWeights = getQueuePerformanceMetricWeights(queueSettings);
  const normalizedScoresByMetric = {};
  const invalidFlagsByMetric = {};

  for (const metricKey of QUEUE_MULTI_ROUND_METRIC_KEYS) {
    const scoreValues = metricSummaryByQueueItem.map((entry) => {
      return resolveQueueMetricSummaryDeltaPct(entry.metricSummary, metricKey);
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
    const cvValues = QUEUE_MULTI_ROUND_METRIC_KEYS.map((metricKey) => {
      const robustCv = Number(entry.metricSummary?.[metricKey]?.robustCv);
      const fallbackCv = Number(entry.metricSummary?.[metricKey]?.cv);
      if (Number.isFinite(robustCv)) {
        return robustCv;
      }
      if (Number.isFinite(fallbackCv)) {
        return fallbackCv;
      }
      return null;
    }).filter((value) => Number.isFinite(value));
    if (cvValues.length === 0) {
      return null;
    }
    return cvValues.reduce((sum, value) => sum + value, 0) / cvValues.length;
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
    },
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
    },
  );
  const strictGoldScores = rankScoreList(
    metricSummaryByQueueItem.map((entry) => entry.costInsights?.goldPerPoint01PctAvg),
    {
      higherIsBetter: false,
      logScale: true,
      tieScore: QUEUE_MULTI_ROUND_SCORE_TIE,
      invalidScore: QUEUE_MULTI_ROUND_SCORE_INVALID,
      minScore: QUEUE_MULTI_ROUND_SCORE_MIN,
      maxScore: QUEUE_MULTI_ROUND_SCORE_MAX,
    },
  );
  const compositeGoldScores = rankScoreList(
    metricSummaryByQueueItem.map((entry) => entry.costInsights?.compositeGoldPerPoint01Pct),
    {
      higherIsBetter: false,
      logScale: true,
      tieScore: QUEUE_MULTI_ROUND_SCORE_TIE,
      invalidScore: QUEUE_MULTI_ROUND_SCORE_INVALID,
      minScore: QUEUE_MULTI_ROUND_SCORE_MIN,
      maxScore: QUEUE_MULTI_ROUND_SCORE_MAX,
    },
  );

  const ranked = metricSummaryByQueueItem.map((entry, index) => {
    const performanceScoresByMetric = Object.fromEntries(
      QUEUE_MULTI_ROUND_METRIC_KEYS.map((metricKey) => [
        metricKey,
        toFiniteNumber(normalizedScoresByMetric?.[metricKey]?.[index], QUEUE_MULTI_ROUND_SCORE_INVALID),
      ]),
    );
    const performanceScore = toFiniteNumber(
      computeWeightedQueueMetricAverage(performanceScoresByMetric, performanceMetricWeights),
      QUEUE_MULTI_ROUND_SCORE_INVALID,
    );

    const performanceInvalidMetricKeys = QUEUE_MULTI_ROUND_METRIC_KEYS.filter(
      (metricKey) => performanceMetricWeights[metricKey] > 0 && Boolean(invalidFlagsByMetric?.[metricKey]?.[index]),
    );
    const performanceInvalid = performanceInvalidMetricKeys.length > 0;
    const stabilityScore = toFiniteNumber(stabilityScores?.scores?.[index], QUEUE_MULTI_ROUND_SCORE_INVALID);
    const stabilityInvalid = Boolean(stabilityScores?.invalidFlags?.[index]);

    const confidenceByMetric = Object.fromEntries(
      QUEUE_MULTI_ROUND_METRIC_KEYS.map((metricKey) => {
        const confidenceDeltaPct = Number(entry.metricSummary?.[metricKey]?.confidenceDeltaPct);
        const fallbackConfidence = Number(entry.metricSummary?.[metricKey]?.confidence);
        const confidenceValue = clamp(
          toFiniteNumber(Number.isFinite(confidenceDeltaPct) ? confidenceDeltaPct : fallbackConfidence, 0),
          0,
          1,
        );
        return [metricKey, confidenceValue];
      }),
    );
    const avgConfidence = toFiniteNumber(
      computeWeightedQueueMetricAverage(confidenceByMetric, performanceMetricWeights),
      0,
    );

    const upgradeCostScore = toFiniteNumber(upgradeCostScores?.scores?.[index], QUEUE_MULTI_ROUND_SCORE_INVALID);
    const purchaseDaysScore = toFiniteNumber(purchaseDaysScores?.scores?.[index], QUEUE_MULTI_ROUND_SCORE_INVALID);
    const strictGoldScore = toFiniteNumber(strictGoldScores?.scores?.[index], QUEUE_MULTI_ROUND_SCORE_INVALID);
    const compositeGoldScore = toFiniteNumber(compositeGoldScores?.scores?.[index], QUEUE_MULTI_ROUND_SCORE_INVALID);
    const selectedGoldScore =
      costScoreGoldPerPointMode === QUEUE_COST_SCORE_GOLD_METRIC_COMPOSITE ? compositeGoldScore : strictGoldScore;
    const selectedGoldInvalid =
      costScoreGoldPerPointMode === QUEUE_COST_SCORE_GOLD_METRIC_COMPOSITE
        ? Boolean(compositeGoldScores?.invalidFlags?.[index])
        : Boolean(strictGoldScores?.invalidFlags?.[index]);
    const costScore =
      QUEUE_COST_SCORE_WEIGHT_UPGRADE * upgradeCostScore +
      QUEUE_COST_SCORE_WEIGHT_PURCHASE_DAYS * purchaseDaysScore +
      QUEUE_COST_SCORE_WEIGHT_GOLD_PER_POINT * selectedGoldScore;
    const costInvalid =
      Boolean(upgradeCostScores?.invalidFlags?.[index]) ||
      Boolean(purchaseDaysScores?.invalidFlags?.[index]) ||
      selectedGoldInvalid;

    const invalidReasons = [];
    for (const metricKey of performanceInvalidMetricKeys) {
      invalidReasons.push(`performance.${metricKey}.invalidDeltaPct`);
    }
    if (stabilityInvalid) {
      invalidReasons.push('stability.invalidAvgCv');
    }
    if (upgradeCostScores?.invalidFlags?.[index]) {
      invalidReasons.push('cost.invalidUpgradeCost');
    }
    if (purchaseDaysScores?.invalidFlags?.[index]) {
      invalidReasons.push('cost.invalidPurchaseDays');
    }
    if (selectedGoldInvalid) {
      invalidReasons.push(
        costScoreGoldPerPointMode === QUEUE_COST_SCORE_GOLD_METRIC_COMPOSITE
          ? 'cost.invalidCompositeGoldPerPoint01Pct'
          : 'cost.invalidGoldPerPoint01PctAvg',
      );
    }

    const baseFinalScore =
      normalizedScoreWeights.performance * performanceScore +
      normalizedScoreWeights.stability * stabilityScore +
      normalizedScoreWeights.cost * costScore;
    const confidencePenaltyStrength = clamp(toFiniteNumber(QUEUE_MULTI_ROUND_CONFIDENCE_PENALTY_STRENGTH, 0.35), 0, 1);
    const confidencePenaltyFactor = clamp(
      1 - confidencePenaltyStrength + confidencePenaltyStrength * avgConfidence,
      0,
      1,
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
        performanceByMetric: performanceScoresByMetric,
        performanceWeights: {
          ...performanceMetricWeights,
        },
        stabilityAvgCv: stabilityRawValues[index],
        costByMetric: {
          upgradeCost: upgradeCostScore,
          purchaseDays: purchaseDaysScore,
          avgGoldPerPoint01Pct: strictGoldScore,
          compositeGoldPerPoint01Pct: compositeGoldScore,
          selectedGoldPerPoint01PctScore: selectedGoldScore,
          selectedGoldPerPointMode: costScoreGoldPerPointMode,
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

function resolveQueueRowRoundCount(row = {}) {
  const samples = QUEUE_MULTI_ROUND_METRIC_KEYS.map((metricKey) =>
    toFiniteNumber(row?.metricSummary?.[metricKey]?.sampleCount, 0),
  );
  return Math.max(0, ...samples);
}

export function buildQueueRankedRowsFromSampleState({
  entries = [],
  rawRuns = [],
  queueSettings,
  queueState,
  baselineMetrics,
  pricingState,
  queueRuntimeSettings,
  includeEmptyEntries = false,
  costDependencies = {},
}) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  if (safeEntries.length === 0) {
    return [];
  }

  const entrySortIndexById = new Map(safeEntries.map((entry, index) => [entry.id, index]));
  const variantSamplesById = new Map(safeEntries.map((entry) => [entry.id, []]));
  for (const rawRun of Array.isArray(rawRuns) ? rawRuns : []) {
    const entryId = String(rawRun?.id || '');
    if (!variantSamplesById.has(entryId)) {
      continue;
    }
    variantSamplesById.get(entryId).push(rawRun);
  }

  const sourceEntries = includeEmptyEntries
    ? safeEntries
    : safeEntries.filter((entry) => (variantSamplesById.get(entry.id) || []).length > 0);

  if (sourceEntries.length === 0) {
    return [];
  }

  const safeQueueSettings = normalizeQueueSettings(queueSettings);
  const variantAggregates = sourceEntries.map((entry) => {
    const variantSamples = (variantSamplesById.get(entry.id) || [])
      .slice()
      .sort((a, b) => Number(a?.round || 0) - Number(b?.round || 0));
    const profits = variantSamples.map((sample) => sample.profitPerHour);
    const meanProfit = getMean(profits);
    const medianProfit = getMedian(profits);
    const stdProfit = getStdDev(profits, meanProfit);
    const coefficientOfVariation = Math.abs(meanProfit) > 1e-9 ? stdProfit / Math.abs(meanProfit) : stdProfit;
    const stability = 1 / (1 + coefficientOfVariation);
    const scoringProfitPerHour =
      meanProfit * (1 - safeQueueSettings.medianBlend) + medianProfit * safeQueueSettings.medianBlend;

    return {
      id: entry.id,
      label: entry.label,
      changeCount: entry.changes.length,
      changes: entry.changes,
      changeDetails: Array.isArray(entry.changeDetails) ? deepClone(entry.changeDetails) : [],
      rounds: variantSamples.length,
      scoringProfitPerHour,
      stability,
      sampleResults: variantSamples,
    };
  });
  const variantAggregateById = new Map(variantAggregates.map((entry) => [entry.id, entry]));
  const metricSummaryByQueueItem = sourceEntries.map((entry) => {
    const roundResults = (variantSamplesById.get(entry.id) || []).map((sample) => ({
      metrics: sample.metrics,
      deltas: sample.deltas,
    }));
    const metricSummary = buildQueueItemMetricSummary(roundResults, safeQueueSettings.medianBlend);
    return {
      queueItemId: entry.id,
      displayName: entry.label,
      order: entrySortIndexById.get(entry.id) ?? 0,
      metricSummary,
      costInsights: buildQueueItemCostInsights(
        queueState,
        entry.snapshot,
        metricSummary,
        pricingState,
        safeQueueSettings,
        entry.confirmedEquipmentPrices,
        costDependencies,
      ),
    };
  });
  const multiRoundRanking = buildMultiRoundRanking(metricSummaryByQueueItem, queueRuntimeSettings, safeQueueSettings);
  const baselineDailyNoRngProfitPerDay = toFiniteNumber(baselineMetrics?.dailyNoRngProfit, 0);
  const baselineScoringProfit = baselineDailyNoRngProfitPerDay / 24;
  const baselineDps = toFiniteNumber(baselineMetrics?.dps, 0);
  const baselineXpPerHour = toFiniteNumber(baselineMetrics?.xpPerHour, 0);
  const baselineKillsPerHour = toFiniteNumber(baselineMetrics?.killsPerHour, 0);

  return multiRoundRanking.map((entry) => {
    const aggregate = variantAggregateById.get(entry.queueItemId) || {
      id: entry.queueItemId,
      label: entry.displayName,
      changeCount: 0,
      changes: [],
      rounds: 0,
      scoringProfitPerHour: toFiniteNumber(entry.metricSummary?.dailyNoRngProfit?.robustMean, 0) / 24,
      stability: 0,
    };

    const scoringProfitPerHour = toFiniteNumber(aggregate.scoringProfitPerHour, 0);
    const scoringDeltaProfitPerHour = scoringProfitPerHour - baselineScoringProfit;
    const scoringDeltaProfitPct =
      Math.abs(baselineScoringProfit) > 1e-9 ? (scoringDeltaProfitPerHour / baselineScoringProfit) * 100 : 0;

    const metricSummary = entry.metricSummary ?? {};
    const dailyNoRngProfitPerDay = toFiniteNumber(metricSummary?.dailyNoRngProfit?.robustMean, 0);
    const deltaDailyNoRngProfitPerDay = dailyNoRngProfitPerDay - baselineDailyNoRngProfitPerDay;
    const deltaDailyNoRngProfitPct = toFiniteNumber(
      resolveQueueMetricSummaryDeltaPct(metricSummary, 'dailyNoRngProfit'),
      0,
    );
    const dps = toFiniteNumber(metricSummary?.dps?.mean, 0);
    const xpPerHour = toFiniteNumber(metricSummary?.xpPerHour?.mean, 0);
    const killsPerHour = toFiniteNumber(metricSummary?.killsPerHour?.mean, 0);

    return {
      id: entry.queueItemId,
      label: entry.displayName,
      rank: entry.rank,
      order: entry.order,
      score: toFiniteNumber(entry.finalScore, 0) / 100,
      finalScore: toFiniteNumber(entry.finalScore, 0),
      baseFinalScore: toFiniteNumber(entry.baseFinalScore, 0),
      performanceScore: toFiniteNumber(entry.performanceScore, 0),
      stabilityScore: toFiniteNumber(entry.stabilityScore, 0),
      costScore: toFiniteNumber(entry.costScore, 0),
      confidenceScore: toFiniteNumber(entry.confidenceScore, 0),
      confidencePenaltyFactor: toFiniteNumber(entry.confidencePenaltyFactor, 1),
      scoreFlags: entry.scoreFlags ?? {
        performanceInvalid: false,
        stabilityInvalid: false,
        costInvalid: false,
        invalidReasons: [],
      },
      rawComponentScores: entry.rawComponentScores ?? {},
      changeCount: aggregate.changeCount,
      changes: aggregate.changes,
      changeDetails: Array.isArray(aggregate.changeDetails) ? deepClone(aggregate.changeDetails) : [],
      rounds: aggregate.rounds || resolveQueueRowRoundCount(entry),
      scoringProfitPerHour,
      scoringDeltaProfitPerHour: toFiniteNumber(scoringDeltaProfitPerHour, 0),
      scoringDeltaProfitPct: toFiniteNumber(scoringDeltaProfitPct, 0),
      stability: toFiniteNumber(aggregate.stability, 0),
      deltaProfitPerHour: toFiniteNumber(deltaDailyNoRngProfitPerDay / 24, 0),
      deltaProfitPct: deltaDailyNoRngProfitPct,
      dailyNoRngProfitPerDay,
      deltaDailyNoRngProfitPerDay,
      deltaDailyNoRngProfitPct,
      dps,
      deltaDpsPerSecond: dps - baselineDps,
      deltaDpsPct: toFiniteNumber(resolveQueueMetricSummaryDeltaPct(metricSummary, 'dps'), 0),
      xpPerHour,
      deltaXpPerHour: xpPerHour - baselineXpPerHour,
      deltaXpPct: toFiniteNumber(resolveQueueMetricSummaryDeltaPct(metricSummary, 'xpPerHour'), 0),
      killsPerHour,
      deltaKillsPerHour: killsPerHour - baselineKillsPerHour,
      deltaKillsPct: toFiniteNumber(resolveQueueMetricSummaryDeltaPct(metricSummary, 'killsPerHour'), 0),
      metricSummary,
      costInsights: entry.costInsights ?? createEmptyQueueCostInsights(),
    };
  });
}

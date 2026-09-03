import {
  computeArithmeticMean,
  computeConfidenceFromValues,
  computePercentileFromSorted,
  winsorizeValues,
} from './robustStats.js';

const ADVISOR_SCORE_MIN = 5;
const ADVISOR_SCORE_MAX = 95;
const ADVISOR_SCORE_TIE = 50;
const ADVISOR_SCORE_INVALID = 0;
const ADVISOR_WINSORIZE_PCT = 0.05;
const ADVISOR_MEDIAN_BLEND_WEIGHT = 0.5;
const ADVISOR_CONFIDENCE_SIZE_SCALE = 3;
const ADVISOR_CONFIDENCE_PENALTY_STRENGTH = 0.15;
const ADVISOR_REASON_TOP_PICK_LIMIT = 3;

export const ADVISOR_GOAL_PRESET_BALANCED = 'balanced';
export const ADVISOR_GOAL_PRESET_PROFIT = 'profit';
export const ADVISOR_GOAL_PRESET_XP = 'xp';
export const ADVISOR_GOAL_PRESET_SAFE = 'safe';
export const ADVISOR_GOAL_PRESET_CUSTOM = 'custom';
export const ADVISOR_GOAL_PRESET_IRONCOW = 'ironcow';

export const ADVISOR_GOAL_PRESET_OPTIONS = [
  ADVISOR_GOAL_PRESET_BALANCED,
  ADVISOR_GOAL_PRESET_PROFIT,
  ADVISOR_GOAL_PRESET_XP,
  ADVISOR_GOAL_PRESET_SAFE,
  ADVISOR_GOAL_PRESET_CUSTOM,
  ADVISOR_GOAL_PRESET_IRONCOW,
];

export const ADVISOR_WEIGHT_KEYS = ['profitPerHour', 'xpPerHour', 'safety'];
// dropsPerHour 仅进入 buildAdvisorMetricSummary 的逐指标聚合（铁牛模式的
// 展示与评分读 metricSummary.dropsPerHour）；铁牛模式的置信度/稳定性均值键
// 见下方 ADVISOR_IRONCOW_SCORING_METRIC_KEYS（防止全 0 掉落稀释老模式置信度
// 造成排名回归，非铁牛模式仍用 ADVISOR_SCORING_METRIC_KEYS）。
export const ADVISOR_RAW_METRIC_KEYS = ['profitPerHour', 'xpPerHour', 'killsPerHour', 'deathsPerHour', 'dropsPerHour'];
const ADVISOR_SCORING_METRIC_KEYS = ['profitPerHour', 'xpPerHour', 'deathsPerHour'];
const ADVISOR_IRONCOW_SCORING_METRIC_KEYS = ['dropsPerHour', 'xpPerHour', 'deathsPerHour'];

// 铁牛默认三维权重：掉落 0.45 / 经验 0.45 / 安全 0.1（收益维度不参与评分）。
export const ADVISOR_IRONCOW_DEFAULT_WEIGHTS = Object.freeze({
  dropsPerHour: 0.45,
  xpPerHour: 0.45,
  safety: 0.1,
});
// 铁牛权重和的兜底容差：UI 负责校验三权和恰为 1（≠1 不应用），评分层对
// 非法和（|sum-1| > 0.001）回退默认 0.45/0.45/0.1。AdvisorPage 的实时
// 校验与应用复用该导出常量（单一事实源），防止本地字面量漂移导致
// 「UI 校验通过、服务层却静默回退默认权重」。
export const ADVISOR_IRONCOW_WEIGHT_SUM_TOLERANCE = 0.001;

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
  [ADVISOR_GOAL_PRESET_IRONCOW]: Object.freeze({
    dropsPerHour: 0.45,
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
  const variance =
    winsorizedValues.reduce((sum, value) => sum + (value - robustMean) ** 2, 0) / winsorizedValues.length;
  const std = Math.sqrt(Math.max(0, variance));
  const robustCv = Math.abs(robustMean) > 1e-9 ? Math.abs(std / robustMean) : 1;
  const confidence = computeConfidenceFromValues(winsorizedValues, robustMean, {
    confidenceSizeScale: ADVISOR_CONFIDENCE_SIZE_SCALE,
  });

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
      nextCursor + 1 < validEntries.length &&
      Math.abs(validEntries[nextCursor + 1].value - validEntries[cursor].value) <= tieEpsilon
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

function resolveAverageConfidence(row, metricKeys = ADVISOR_SCORING_METRIC_KEYS) {
  if (!row?.metricSummary || typeof row.metricSummary !== 'object') {
    return null;
  }

  const values = metricKeys
    .map((metricKey) => Number(row?.metricSummary?.[metricKey]?.confidence))
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return null;
  }
  return clamp(computeArithmeticMean(values, 0), 0, 1);
}

function resolveAverageRobustCv(row, metricKeys = ADVISOR_SCORING_METRIC_KEYS) {
  if (!row?.metricSummary || typeof row.metricSummary !== 'object') {
    return null;
  }

  const values = metricKeys
    .map((metricKey) => Number(row?.metricSummary?.[metricKey]?.robustCv))
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return null;
  }
  return computeArithmeticMean(values, 0);
}

function getSortedBestRow(rows, selector, direction = 'desc') {
  const sourceRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (sourceRows.length === 0) {
    return null;
  }

  return (
    sourceRows.slice().sort((left, right) => {
      const leftValue = toFiniteNumber(
        selector(left),
        direction === 'asc' ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER,
      );
      const rightValue = toFiniteNumber(
        selector(right),
        direction === 'asc' ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER,
      );
      if (leftValue !== rightValue) {
        return direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
      }
      return Number(left?.rank || 0) - Number(right?.rank || 0);
    })[0] || null
  );
}

export function normalizeAdvisorGoalPreset(preset) {
  const normalized = String(preset || '')
    .trim()
    .toLowerCase();
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
    profitPerHour: (profitInput / adjustableSum) * 0.9,
    xpPerHour: (xpInput / adjustableSum) * 0.9,
    safety: 0.1,
  };
}

// 铁牛权重清洗：各值有限非负（非法/缺失按 0 计），|sum-1| 超容差回退默认
// 0.45/0.45/0.1。UI 负责保证三权和恰为 1，这里仅是评分层兜底。
export function normalizeIroncowWeights(rawWeights) {
  const source = rawWeights != null && typeof rawWeights === 'object' ? rawWeights : {};
  const dropsPerHour = Math.max(0, toFiniteNumber(source.dropsPerHour, 0));
  const xpPerHour = Math.max(0, toFiniteNumber(source.xpPerHour, 0));
  const safety = Math.max(0, toFiniteNumber(source.safety, 0));

  if (Math.abs(dropsPerHour + xpPerHour + safety - 1) > ADVISOR_IRONCOW_WEIGHT_SUM_TOLERANCE) {
    return { ...ADVISOR_IRONCOW_DEFAULT_WEIGHTS };
  }

  return { dropsPerHour, xpPerHour, safety };
}

export function resolveAdvisorWeights(goalPreset, customWeights = {}, ironcowWeights = null) {
  const normalizedPreset = normalizeAdvisorGoalPreset(goalPreset);
  if (normalizedPreset === ADVISOR_GOAL_PRESET_IRONCOW) {
    return normalizeIroncowWeights(ironcowWeights);
  }
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

  const isIroncow = normalizeAdvisorGoalPreset(options?.goalPreset) === ADVISOR_GOAL_PRESET_IRONCOW;
  const weights = resolveAdvisorWeights(options?.goalPreset, options?.customWeights, options?.ironcowWeights);
  // 置信度/稳定性均值键按模式切换：铁牛用掉落/经验/死亡，其余模式保持
  // profit/xp/deaths（防止全 0 掉落稀释老模式置信度造成排名回归）。
  const scoringMetricKeys = isIroncow ? ADVISOR_IRONCOW_SCORING_METRIC_KEYS : ADVISOR_SCORING_METRIC_KEYS;
  const quickRankById = options?.quickRankById instanceof Map ? options.quickRankById : new Map();

  const profitScores = rankScoreList(
    safeRows.map((row) => resolveMetricSummaryValue(row, 'profitPerHour')),
    { higherIsBetter: true },
  );
  const xpScores = rankScoreList(
    safeRows.map((row) => resolveMetricSummaryValue(row, 'xpPerHour')),
    { higherIsBetter: true },
  );
  const safetyScores = rankScoreList(
    safeRows.map((row) => resolveMetricSummaryValue(row, 'deathsPerHour')),
    { higherIsBetter: false },
  );
  const dropsScores = rankScoreList(
    safeRows.map((row) => resolveMetricSummaryValue(row, 'dropsPerHour')),
    { higherIsBetter: true },
  );
  const stabilityScores = rankScoreList(
    safeRows.map((row) => resolveAverageRobustCv(row, scoringMetricKeys)),
    { higherIsBetter: false, tieScore: ADVISOR_SCORE_TIE },
  );

  const rankedRows = safeRows.map((row, index) => {
    const normalizedMetrics = {
      profitPerHour: toFiniteNumber(profitScores?.scores?.[index], ADVISOR_SCORE_INVALID),
      xpPerHour: toFiniteNumber(xpScores?.scores?.[index], ADVISOR_SCORE_INVALID),
      safety: toFiniteNumber(safetyScores?.scores?.[index], ADVISOR_SCORE_INVALID),
      dropsPerHour: toFiniteNumber(dropsScores?.scores?.[index], ADVISOR_SCORE_INVALID),
    };
    // 铁牛综合分 = 掉落分×dropsPerHour + 经验分×xpPerHour + 安全分×safety，
    // 收益维度不参与评分；非铁牛数学保持不变（drops 权重按 0 处理）。
    const baseFinalScore = isIroncow
      ? normalizedMetrics.dropsPerHour * weights.dropsPerHour +
        normalizedMetrics.xpPerHour * weights.xpPerHour +
        normalizedMetrics.safety * weights.safety
      : normalizedMetrics.profitPerHour * weights.profitPerHour +
        normalizedMetrics.xpPerHour * weights.xpPerHour +
        normalizedMetrics.safety * weights.safety;

    const avgConfidence = resolveAverageConfidence(row, scoringMetricKeys);
    const confidencePenaltyFactor =
      avgConfidence == null
        ? 1
        : clamp(1 - ADVISOR_CONFIDENCE_PENALTY_STRENGTH + ADVISOR_CONFIDENCE_PENALTY_STRENGTH * avgConfidence, 0, 1);
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
    // 平手裁决：铁牛 → 掉落降序 → 经验降序 → 死亡升序 → order；其余保持现状。
    if (isIroncow) {
      if (toFiniteNumber(right.dropsPerHour, 0) !== toFiniteNumber(left.dropsPerHour, 0)) {
        return toFiniteNumber(right.dropsPerHour, 0) - toFiniteNumber(left.dropsPerHour, 0);
      }
    } else if (toFiniteNumber(right.profitPerHour, 0) !== toFiniteNumber(left.profitPerHour, 0)) {
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

  // 理由徽章：铁牛模式下 top_profit 让位给 top_drops（掉落最大行），
  // top_xp / safest / top_pick / validated 规则不变。
  const bestProfitRow = isIroncow ? null : getSortedBestRow(rankedRows, (row) => row.profitPerHour, 'desc');
  const bestDropsRow = isIroncow ? getSortedBestRow(rankedRows, (row) => row.dropsPerHour, 'desc') : null;
  const bestXpRow = getSortedBestRow(rankedRows, (row) => row.xpPerHour, 'desc');
  const safestRow = getSortedBestRow(rankedRows, (row) => row.deathsPerHour, 'asc');

  rankedRows.forEach((row) => {
    const reasons = [];
    if (bestProfitRow?.id === row.id) {
      reasons.push('top_profit');
    }
    if (bestDropsRow?.id === row.id) {
      reasons.push('top_drops');
    }
    if (bestXpRow?.id === row.id) {
      reasons.push('top_xp');
    }
    if (safestRow?.id === row.id) {
      reasons.push('safest');
    }
    if (Number(row.rank || 0) > 0 && Number(row.rank || 0) <= ADVISOR_REASON_TOP_PICK_LIMIT) {
      reasons.push('top_pick');
    }
    if (row.isRefined && quickRankById.has(row.id) && Number(row.rank || 0) < Number(quickRankById.get(row.id) || 0)) {
      reasons.push('validated');
    }
    row.reasons = reasons;
  });

  return rankedRows;
}

export function buildAdvisorTopCards(rows = [], options = {}) {
  const safeRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (safeRows.length === 0) {
    return [];
  }

  // 规范化后的 options.preset 为 'ironcow' 时第 4 张卡由「最安全」改为「掉落最佳」
  // （与 rankAdvisorRows 的 goalPreset 口径一致，容忍 'IRONCOW' 等非规范写法）；
  // 未传 options（或非铁牛）时输出与历史行为完全一致。
  const isIroncow = normalizeAdvisorGoalPreset(options?.preset) === ADVISOR_GOAL_PRESET_IRONCOW;
  const cards = [];
  const bestOverall = safeRows[0] || null;
  const bestProfit = getSortedBestRow(safeRows, (row) => row.profitPerHour, 'desc');
  const bestXp = getSortedBestRow(safeRows, (row) => row.xpPerHour, 'desc');
  const safest = getSortedBestRow(safeRows, (row) => row.deathsPerHour, 'asc');
  const bestDrops = isIroncow ? getSortedBestRow(safeRows, (row) => row.dropsPerHour, 'desc') : null;

  const definitions = [
    { key: 'overall', titleKey: 'best_overall', row: bestOverall },
    { key: 'profit', titleKey: 'best_profit', row: bestProfit },
    { key: 'xp', titleKey: 'best_xp', row: bestXp },
    isIroncow
      ? { key: 'drops', titleKey: 'best_drops', row: bestDrops }
      : { key: 'safe', titleKey: 'safest', row: safest },
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

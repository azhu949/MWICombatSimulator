import { clamp, toFiniteNumber } from './utils.js';

export function computeArithmeticMean(values, fallback = 0) {
  if (!Array.isArray(values) || values.length === 0) {
    return fallback;
  }
  return values.reduce((sum, value) => sum + toFiniteNumber(value, 0), 0) / values.length;
}

export function computePercentileFromSorted(sortedValues, percentile) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) {
    return 0;
  }
  if (sortedValues.length === 1) {
    return sortedValues[0];
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

export function winsorizeValues(values, winsorizePct = 0) {
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

export function computeConfidenceFromValues(values, centerValue, options = {}) {
  const numericValues = (values ?? []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
  const sampleCount = numericValues.length;
  if (sampleCount <= 1) {
    return 0;
  }

  const mean = computeArithmeticMean(numericValues, 0);
  const variance = numericValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sampleCount;
  const std = Math.sqrt(Math.max(0, variance));
  const ciHalfWidth95 = (1.96 * std) / Math.sqrt(sampleCount);
  const scaleBase = Math.max(Math.abs(toFiniteNumber(centerValue, 0)), std, 1e-6);
  const intervalConfidence = 1 / (1 + ciHalfWidth95 / scaleBase);
  const sizeScale = Math.max(1, toFiniteNumber(options?.confidenceSizeScale, 1));
  const sizeConfidence = 1 - Math.exp((-1 * (sampleCount - 1)) / sizeScale);
  return clamp(intervalConfidence * sizeConfidence, 0, 1);
}

// summarizeSeries 的默认参数与 queueScoring.js 的队列多轮统计常量对齐：
// QUEUE_MULTI_ROUND_WINSORIZE_PCT = 0.05、QUEUE_MULTI_ROUND_MEDIAN_BLEND_WEIGHT = 0.5、
// QUEUE_MULTI_ROUND_CONFIDENCE_SIZE_SCALE = 8。queueScoring 单向 import 本模块，反向 import
// 会形成循环依赖，故此处复制数值；两侧任一改动时必须同步（由 robustStats.test.js 的交叉锚定
// 用例把关）。
const SERIES_DEFAULT_WINSORIZE_PCT = 0.05;
const SERIES_DEFAULT_MEDIAN_BLEND = 0.5;
const SERIES_DEFAULT_CONFIDENCE_SIZE_SCALE = 8;

// 对一组模拟结果做稳健聚合（winsorize + 中位数融合 + 95% 置信区间），口径与队列评分
// summarizeMetric（queueScoring.js）一致，供首页多轮模拟等通用场景复用：
//   - mean：原始算术均值；
//   - winsorizePct：双侧去极值比例（默认 0.05，内部再 clamp 到 [0, 0.49]）；
//   - winsorizedMean / p50：去极值序列的均值与中位数；
//   - robustMean = (1 - medianBlend) * winsorizedMean + medianBlend * p50（medianBlend 默认 0.5）；
//   - min / max：去极值序列的最小值与最大值；
//   - std：以 robustMean 为中心、按样本数（而非 n-1）求总体标准差，与队列口径一致；
//   - ciHalfWidth95 = 1.96 * std / sqrt(n)，ciLow / ciHigh = robustMean 减/加该半宽；
//   - confidence：复用 computeConfidenceFromValues（confidenceSizeScale 默认 8，与队列口径一致）。
// 输入的非有限值按 0 计入（与 summarizeMetric 同口径）；空数组返回全零结构（sampleCount = 0），
// n = 1 时 std 与 CI 半宽为 0。options 缺省或非法时回落到上述默认值。
export function summarizeSeries(values, options = {}) {
  const safeValues = (values ?? []).map((value) => toFiniteNumber(value, 0));
  if (safeValues.length === 0) {
    return {
      sampleCount: 0,
      mean: 0,
      winsorizedMean: 0,
      p50: 0,
      robustMean: 0,
      min: 0,
      max: 0,
      std: 0,
      ciHalfWidth95: 0,
      ciLow: 0,
      ciHigh: 0,
      confidence: 0,
    };
  }

  const medianBlend = clamp(toFiniteNumber(options?.medianBlend, SERIES_DEFAULT_MEDIAN_BLEND), 0, 1);
  const meanWeight = 1 - medianBlend;

  const mean = computeArithmeticMean(safeValues, 0);
  const winsorizedValues = winsorizeValues(
    safeValues,
    toFiniteNumber(options?.winsorizePct, SERIES_DEFAULT_WINSORIZE_PCT),
  );
  const winsorizedMean = computeArithmeticMean(winsorizedValues, mean);
  const sortedValues = [...winsorizedValues].sort((a, b) => a - b);
  const p50 = computePercentileFromSorted(sortedValues, 0.5);
  const robustMean = meanWeight * winsorizedMean + medianBlend * p50;

  const min = Math.min(...winsorizedValues);
  const max = Math.max(...winsorizedValues);
  const variance =
    winsorizedValues.reduce((sum, value) => sum + (value - robustMean) ** 2, 0) / winsorizedValues.length;
  const std = Math.sqrt(Math.max(0, variance));
  const ciHalfWidth95 = (1.96 * std) / Math.sqrt(winsorizedValues.length);
  const confidence = computeConfidenceFromValues(winsorizedValues, robustMean, {
    confidenceSizeScale: toFiniteNumber(options?.confidenceSizeScale, SERIES_DEFAULT_CONFIDENCE_SIZE_SCALE),
  });

  return {
    sampleCount: safeValues.length,
    mean: toFiniteNumber(mean, 0),
    winsorizedMean: toFiniteNumber(winsorizedMean, 0),
    p50: toFiniteNumber(p50, 0),
    robustMean: toFiniteNumber(robustMean, 0),
    min: toFiniteNumber(min, 0),
    max: toFiniteNumber(max, 0),
    std: toFiniteNumber(std, 0),
    ciHalfWidth95: toFiniteNumber(ciHalfWidth95, 0),
    ciLow: toFiniteNumber(robustMean - ciHalfWidth95, 0),
    ciHigh: toFiniteNumber(robustMean + ciHalfWidth95, 0),
    confidence: toFiniteNumber(confidence, 0),
  };
}

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

import { describe, expect, it } from 'vitest';
import {
  computeArithmeticMean,
  computeConfidenceFromValues,
  computePercentileFromSorted,
  summarizeSeries,
  winsorizeValues,
} from '../robustStats.js';
import { summarizeMetric } from '../queueScoring.js';

describe('robustStats', () => {
  it('computes finite means and interpolated percentiles', () => {
    expect(computeArithmeticMean([1, '2', Number.NaN, 5], 0)).toBe(2);
    expect(computeArithmeticMean([], 9)).toBe(9);
    expect(computePercentileFromSorted([10, 20, 30], 0.25)).toBe(15);
    expect(computePercentileFromSorted([10, 20, 30], 0.9)).toBe(28);
  });

  it('winsorizes numeric values by clamping to percentile bounds', () => {
    expect(winsorizeValues([1, 2, 100], 0.25)).toEqual([1.5, 2, 51]);
    expect(winsorizeValues([1, Number.NaN, 3], 0.25)).toEqual([1, 3]);
  });

  it('scales confidence by caller-provided sample size settings', () => {
    const values = [10, 12, 14, 16];
    const fastConfidence = computeConfidenceFromValues(values, 13, { confidenceSizeScale: 3 });
    const slowConfidence = computeConfidenceFromValues(values, 13, { confidenceSizeScale: 8 });

    expect(fastConfidence).toBeGreaterThan(slowConfidence);
    expect(fastConfidence).toBeGreaterThan(0);
    expect(fastConfidence).toBeLessThanOrEqual(1);
  });
});

describe('summarizeSeries', () => {
  // 手算锚定（winsorizePct 默认 0.05，n = 5）：排序 [0,1,2,3,100]，
  // 下界 p05 = 0 + (1-0)*0.2 = 0.2，上界 p95 = 3 + (100-3)*0.8 = 80.6，
  // 去极值序列 [0.2,1,2,3,80.6]，winsorizedMean = 86.8/5 = 17.36，p50 = 2，
  // robustMean = 0.5*17.36 + 0.5*2 = 9.68。
  it('winsorizes outliers and blends the winsorized mean with the median', () => {
    const summary = summarizeSeries([0, 1, 2, 3, 100]);

    expect(summary.sampleCount).toBe(5);
    expect(summary.mean).toBeCloseTo(21.2, 10);
    expect(summary.winsorizedMean).toBeCloseTo(17.36, 10);
    expect(summary.p50).toBeCloseTo(2, 10);
    expect(summary.robustMean).toBeCloseTo(9.68, 10);
    expect(summary.min).toBeCloseTo(0.2, 10);
    expect(summary.max).toBeCloseTo(80.6, 10);
  });

  // 手算锚定（偏差基于去极值序列、以 robustMean = 9.68 为中心、除以 n = 5）：
  // variance = (89.8704 + 75.3424 + 58.9824 + 44.6224 + 5029.6464) / 5 = 1059.6928，
  // std = sqrt(1059.6928) ≈ 32.552923，
  // ciHalfWidth95 = 1.96 * 32.552923 / sqrt(5) ≈ 28.533895，
  // ciLow ≈ 9.68 - 28.533895 = -18.853895，ciHigh ≈ 9.68 + 28.533895 = 38.213895。
  it('anchors the 95% interval on the winsorized series', () => {
    const summary = summarizeSeries([0, 1, 2, 3, 100]);

    expect(summary.std).toBeCloseTo(32.552923, 4);
    expect(summary.ciHalfWidth95).toBeCloseTo(28.533895, 3);
    expect(summary.ciLow).toBeCloseTo(-18.853895, 3);
    expect(summary.ciHigh).toBeCloseTo(38.213895, 3);
    expect(summary.ciLow).toBeCloseTo(summary.robustMean - summary.ciHalfWidth95, 12);
    expect(summary.ciHigh).toBeCloseTo(summary.robustMean + summary.ciHalfWidth95, 12);
  });

  it('returns a zeroed structure for empty input', () => {
    expect(summarizeSeries([])).toEqual({
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
    });
    expect(summarizeSeries(null).sampleCount).toBe(0);
    expect(summarizeSeries(undefined).sampleCount).toBe(0);
  });

  it('keeps a single sample at zero spread with zero CI half-width', () => {
    expect(summarizeSeries([7])).toMatchObject({
      sampleCount: 1,
      mean: 7,
      winsorizedMean: 7,
      p50: 7,
      robustMean: 7,
      min: 7,
      max: 7,
      std: 0,
      ciHalfWidth95: 0,
      ciLow: 7,
      ciHigh: 7,
      confidence: 0,
    });
  });

  // n < 3 时 winsorizeValues 不截断，去极值序列即原始序列 [2,4]：
  // winsorizedMean = 3，p50 = 3，robustMean = 3，std = sqrt((1+1)/2) = 1，
  // ciHalfWidth95 = 1.96 / sqrt(2) ≈ 1.385929，ciLow ≈ 1.614071，ciHigh ≈ 4.385929。
  it('does not winsorize with two samples (n = 2 keeps raw values)', () => {
    const summary = summarizeSeries([2, 4]);

    expect(summary.sampleCount).toBe(2);
    expect(summary.mean).toBeCloseTo(3, 12);
    expect(summary.winsorizedMean).toBeCloseTo(3, 12);
    expect(summary.p50).toBeCloseTo(3, 12);
    expect(summary.robustMean).toBeCloseTo(3, 12);
    expect(summary.std).toBeCloseTo(1, 12);
    expect(summary.ciHalfWidth95).toBeCloseTo(1.385929, 5);
    expect(summary.ciLow).toBeCloseTo(1.614071, 5);
    expect(summary.ciHigh).toBeCloseTo(4.385929, 5);
    expect(summary.confidence).toBeGreaterThan(0);
    expect(summary.confidence).toBeLessThanOrEqual(1);
  });

  it('honors medianBlend and winsorizePct options', () => {
    const medianOnly = summarizeSeries([0, 1, 2, 3, 100], { medianBlend: 1 });
    const meanOnly = summarizeSeries([0, 1, 2, 3, 100], { medianBlend: 0 });
    const noWinsorize = summarizeSeries([0, 1, 2, 3, 100], { winsorizePct: 0 });

    expect(medianOnly.robustMean).toBeCloseTo(2, 10);
    expect(meanOnly.robustMean).toBeCloseTo(17.36, 10);
    expect(noWinsorize.winsorizedMean).toBeCloseTo(21.2, 10);
    expect(noWinsorize.max).toBeCloseTo(100, 10);
  });

  it('reuses the computeConfidenceFromValues contract and scales with confidenceSizeScale', () => {
    const values = [0, 1, 2, 3, 100];
    const summary = summarizeSeries(values);
    const winsorized = winsorizeValues(values, 0.05);

    expect(summary.confidence).toBe(
      computeConfidenceFromValues(winsorized, summary.robustMean, { confidenceSizeScale: 8 }),
    );
    // 手算：intervalConfidence = 1 / (1 + 27.728431 / 31.634007) ≈ 0.532896，
    // sizeConfidence = 1 - exp(-(5-1)/8) = 1 - exp(-0.5) ≈ 0.393469，
    // confidence ≈ 0.532896 * 0.393469 ≈ 0.209678。
    expect(summary.confidence).toBeCloseTo(0.209678, 4);
    expect(summarizeSeries(values, { confidenceSizeScale: 2 }).confidence).toBeGreaterThan(
      summarizeSeries(values, { confidenceSizeScale: 16 }).confidence,
    );
  });

  // 交叉锚定：同输入下 summarizeSeries 与队列评分 summarizeMetric(values, [], 0.5) 的共同字段
  // 应逐位一致；本用例同时充当「两侧口径漂移」的报警器（robustStats.js 复制的默认常量
  // 若与 queueScoring.js 脱钩，这里会失败）。
  it('mirrors summarizeMetric(values, [], 0.5) field by field', () => {
    const cases = [[0, 1, 2, 3, 100], [2, 4], [7], [...Array(20).fill(1), 1000], [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5]];

    for (const values of cases) {
      const series = summarizeSeries(values);
      const metric = summarizeMetric(values, [], 0.5);

      expect(series.sampleCount).toBe(metric.sampleCount);
      expect(series.mean).toBe(metric.mean);
      expect(series.winsorizedMean).toBe(metric.winsorizedMean);
      expect(series.p50).toBe(metric.p50);
      expect(series.robustMean).toBe(metric.robustMean);
      expect(series.min).toBe(metric.min);
      expect(series.max).toBe(metric.max);
      expect(series.std).toBe(metric.std);
      expect(series.confidence).toBe(metric.confidence);
    }
  });
});

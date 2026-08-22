import { describe, expect, it } from 'vitest';
import {
  computeArithmeticMean,
  computeConfidenceFromValues,
  computePercentileFromSorted,
  winsorizeValues,
} from '../robustStats.js';

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

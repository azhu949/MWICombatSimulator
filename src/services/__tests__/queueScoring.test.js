import { describe, expect, it, vi } from 'vitest';
import {
  MANUAL_EQUIPMENT_PRICE_SOURCE,
  QUEUE_COST_SCORE_GOLD_METRIC_COMPOSITE,
  buildQueueBaselineAggregate,
  buildQueueItemCostInsights,
  buildQueueRankedRowsFromSampleState,
  normalizeQueueRuntimeSettings,
  normalizeQueueSettings,
  rankScoreList,
  resolveQueueMetricSummaryDeltaPct,
  summarizeMetric,
} from '../queueScoring.js';

function createMetricSummaryEntry(deltaPct, overrides = {}) {
  return {
    mean: 100,
    winsorizedMean: 100,
    robustMean: 100,
    min: 100,
    max: 100,
    std: 0,
    p50: 100,
    p90: 100,
    cv: 0,
    robustCv: 0,
    meanDeltaPct: deltaPct,
    rawMeanDeltaPct: deltaPct,
    winsorizedMeanDeltaPct: deltaPct,
    medianDeltaPct: deltaPct,
    robustMeanDeltaPct: deltaPct,
    confidence: 1,
    confidenceDeltaPct: 1,
    sampleCount: 3,
    deltaSampleCount: 3,
    ...overrides,
  };
}

function createQueueMetricSummary(deltas = {}) {
  return {
    dps: createMetricSummaryEntry(deltas.dps ?? 0),
    dailyNoRngProfit: createMetricSummaryEntry(deltas.dailyNoRngProfit ?? 0),
    xpPerHour: createMetricSummaryEntry(deltas.xpPerHour ?? 0),
    killsPerHour: createMetricSummaryEntry(deltas.killsPerHour ?? 0),
  };
}

describe('queueScoring', () => {
  it('normalizes queue run and runtime settings with the existing bounds', () => {
    expect(
      normalizeQueueSettings({
        rounds: 0,
        baselineRounds: 500,
        medianBlend: 2,
        weightProfit: 0.25,
        weightXp: 0.85,
        executionMode: 'unknown',
      }),
    ).toEqual({
      rounds: 1,
      baselineRounds: 200,
      medianBlend: 1,
      weightProfit: 0.2,
      weightXp: 0.8,
      weightDeathSafety: 0,
      executionMode: 'serial',
      baselineSaleSide: 'bid',
    });

    const runtime = normalizeQueueRuntimeSettings({
      finalWeights: {
        performance: 0.3,
        stability: 0.3,
        cost: 0.4,
      },
      costScoreGoldPerPointMode: QUEUE_COST_SCORE_GOLD_METRIC_COMPOSITE,
      parallelWorkerLimit: 999,
    });

    expect(runtime.finalWeights).toEqual({
      performance: 0.3,
      stability: 0.3,
      cost: 0.4,
    });
    expect(runtime.costScoreGoldPerPointMode).toBe(QUEUE_COST_SCORE_GOLD_METRIC_COMPOSITE);
    expect(runtime.parallelWorkerLimit).toBe(64);
  });

  it('ranks values with stable tie handling and explicit invalid flags', () => {
    const higherScores = rankScoreList([10, null, 20, 20], {
      higherIsBetter: true,
      minScore: 0,
      maxScore: 100,
      tieScore: 50,
      invalidScore: -1,
    });

    expect(higherScores.scores).toEqual([0, -1, 75, 75]);
    expect(higherScores.invalidFlags).toEqual([false, true, false, false]);

    const lowerScores = rankScoreList([100, 10, 10, Number.NaN], {
      higherIsBetter: false,
      minScore: 0,
      maxScore: 100,
      tieScore: 50,
      invalidScore: -1,
    });

    expect(lowerScores.scores).toEqual([0, 75, 75, -1]);
    expect(lowerScores.invalidFlags).toEqual([false, false, false, true]);
  });

  it('summarizes single-sample metrics with zero confidence', () => {
    const summary = summarizeMetric([42], [12.5], 0.5);

    expect(summary).toMatchObject({
      mean: 42,
      winsorizedMean: 42,
      robustMean: 42,
      min: 42,
      max: 42,
      p50: 42,
      p90: 42,
      rawMeanDeltaPct: 12.5,
      winsorizedMeanDeltaPct: 12.5,
      medianDeltaPct: 12.5,
      robustMeanDeltaPct: 12.5,
      confidence: 0,
      confidenceDeltaPct: 0,
      sampleCount: 1,
      deltaSampleCount: 1,
    });
  });

  it('summarizes non-finite values as zero while ignoring missing delta percentages', () => {
    const summary = summarizeMetric(
      [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      [undefined, Number.NaN],
      0.5,
    );

    expect(summary.mean).toBe(0);
    expect(summary.winsorizedMean).toBe(0);
    expect(summary.robustMean).toBe(0);
    expect(summary.sampleCount).toBe(3);
    expect(summary.deltaSampleCount).toBe(0);
    expect(summary.rawMeanDeltaPct).toBe(0);
    expect(summary.robustMeanDeltaPct).toBe(0);
    expect(summary.confidenceDeltaPct).toBe(0);
  });

  it('winsorizes extreme metric and delta outliers before robust aggregation', () => {
    const values = [...Array(20).fill(1), 1000];
    const deltas = [...Array(20).fill(2), 500];
    const summary = summarizeMetric(values, deltas, 0.5);

    expect(summary.mean).toBeCloseTo(1020 / 21, 6);
    expect(summary.winsorizedMean).toBe(1);
    expect(summary.p50).toBe(1);
    expect(summary.p90).toBe(1);
    expect(summary.robustMean).toBe(1);
    expect(summary.max).toBe(1);
    expect(summary.rawMeanDeltaPct).toBeCloseTo(540 / 21, 6);
    expect(summary.winsorizedMeanDeltaPct).toBe(2);
    expect(summary.medianDeltaPct).toBe(2);
    expect(summary.robustMeanDeltaPct).toBe(2);
    expect(summary.meanDeltaPct).toBe(summary.robustMeanDeltaPct);
  });

  it('resolves robust delta percentages before legacy mean aliases', () => {
    expect(
      resolveQueueMetricSummaryDeltaPct(
        {
          dps: {
            robustMeanDeltaPct: 12,
            meanDeltaPct: 99,
          },
        },
        'dps',
      ),
    ).toBe(12);

    expect(
      resolveQueueMetricSummaryDeltaPct(
        {
          dps: {
            meanDeltaPct: 7,
          },
        },
        'dps',
      ),
    ).toBe(7);

    expect(
      resolveQueueMetricSummaryDeltaPct(
        {
          dps: {
            robustMeanDeltaPct: Number.NaN,
            meanDeltaPct: 5,
          },
        },
        'dps',
      ),
    ).toBe(5);

    expect(
      resolveQueueMetricSummaryDeltaPct(
        {
          dps: {},
        },
        'dps',
      ),
    ).toBeNull();
  });

  it('aggregates multi-round baseline metrics with median blend statistics', () => {
    const aggregate = buildQueueBaselineAggregate(
      [
        {
          metrics: {
            encountersPerHour: 10,
            deathsPerHour: 1,
            totalXpPerHour: 100,
            profitPerHour: 50,
            dps: 100,
            dailyNoRngProfit: 100,
            xpPerHour: 100,
            killsPerHour: 10,
          },
        },
        {
          metrics: {
            encountersPerHour: 20,
            deathsPerHour: 2,
            totalXpPerHour: 200,
            profitPerHour: 100,
            dps: 200,
            dailyNoRngProfit: 200,
            xpPerHour: 200,
            killsPerHour: 20,
          },
        },
        {
          metrics: {
            encountersPerHour: 30,
            deathsPerHour: 3,
            totalXpPerHour: 300,
            profitPerHour: 150,
            dps: 300,
            dailyNoRngProfit: 300,
            xpPerHour: 300,
            killsPerHour: 30,
          },
        },
      ],
      0.5,
    );

    expect(aggregate.metrics.dailyNoRngProfit).toBeCloseTo(200, 6);
    expect(aggregate.metrics.dps).toBeCloseTo(200, 6);
    expect(aggregate.metricSummary.dailyNoRngProfit.sampleCount).toBe(3);
    expect(aggregate.metricSummary.dailyNoRngProfit.deltaSampleCount).toBe(0);
    expect(aggregate.metricSummary.dailyNoRngProfit.confidence).toBeGreaterThan(0);
  });

  it('builds cost insights using injected equipment and upgrade-cost dependencies', () => {
    const baselineSnapshot = { id: 'baseline' };
    const targetSnapshot = { id: 'target' };
    const pricingState = { priceTable: {} };
    const confirmedEquipmentPrices = [{ itemHrid: '/items/manual', enhancementLevel: 2, price: 200 }];
    const inspectQueueEquipmentPricing = vi.fn(() => [
      {
        targetAskAvailable: true,
        targetPriceSource: 'ask',
        baselineSaleValue: 50,
        targetAsk: 150,
        slotKey: 'weapon',
        afterItemHrid: '/items/ask',
        afterLevel: 1,
      },
      {
        targetAskAvailable: true,
        targetPriceSource: MANUAL_EQUIPMENT_PRICE_SOURCE,
        confirmedPrice: { price: 200 },
        baselineSaleValue: 0,
        targetAsk: 200,
        slotKey: 'body',
        afterItemHrid: '/items/manual',
        afterLevel: 2,
      },
    ]);
    const computeQueueItemUpgradeCost = vi.fn(() => 5000);

    const insights = buildQueueItemCostInsights(
      {
        baseline: {
          snapshot: baselineSnapshot,
          metrics: { dailyNoRngProfit: 1000 },
        },
        abilityUpgradeCosts: { ability: 123 },
      },
      targetSnapshot,
      createQueueMetricSummary({
        dps: 10,
        dailyNoRngProfit: 20,
        xpPerHour: 30,
        killsPerHour: 40,
      }),
      pricingState,
      { weightProfit: 0.5, weightXp: 0.3 },
      confirmedEquipmentPrices,
      {
        inspectQueueEquipmentPricing,
        computeQueueItemUpgradeCost,
      },
    );

    expect(inspectQueueEquipmentPricing).toHaveBeenCalledWith(
      baselineSnapshot,
      targetSnapshot,
      pricingState,
      confirmedEquipmentPrices,
      { saleSide: 'bid' },
    );
    expect(computeQueueItemUpgradeCost).toHaveBeenCalledWith(baselineSnapshot, targetSnapshot, pricingState, {
      abilityCostMap: { ability: 123 },
      confirmedEquipmentPrices,
      saleSide: 'bid',
    });
    expect(insights.totalUpgradeCost).toBe(5000);
    expect(insights.purchaseDays).toBe(5);
    expect(insights.equipmentSaleValue).toBe(50);
    expect(insights.equipmentBuyPrice).toBe(350);
    expect(insights.equipmentNetCost).toBe(300);
    expect(insights.manualPriceSlots).toEqual([
      {
        slotKey: 'body',
        itemHrid: '/items/manual',
        enhancementLevel: 2,
        price: 200,
      },
    ]);
    expect(insights.goldPerPoint01Pct.dps).toBeCloseTo(5, 6);
    expect(insights.compositeDeltaPct).toBeCloseTo(24, 6);
    expect(insights.compositeGoldPerPoint01Pct).toBeCloseTo(5000 / 2400, 6);
  });

  it('builds ranked queue rows without reading store state directly', () => {
    const rows = buildQueueRankedRowsFromSampleState({
      entries: [
        {
          id: 'profit',
          label: 'Profit Variant',
          changes: ['profit'],
          changeDetails: [{ kind: 'equipment' }],
          snapshot: { upgradeCost: 100 },
          confirmedEquipmentPrices: [],
        },
        {
          id: 'xp',
          label: 'XP Variant',
          changes: ['xp'],
          changeDetails: [{ kind: 'ability' }],
          snapshot: { upgradeCost: 100 },
          confirmedEquipmentPrices: [],
        },
      ],
      rawRuns: [
        {
          id: 'profit',
          round: 1,
          profitPerHour: 150,
          metrics: {
            dps: 100,
            dailyNoRngProfit: 3600,
            xpPerHour: 100,
            killsPerHour: 100,
          },
          deltas: {
            dps: { pct: 0 },
            dailyNoRngProfit: { pct: 50 },
            xpPerHour: { pct: 0 },
            killsPerHour: { pct: 0 },
          },
        },
        {
          id: 'xp',
          round: 1,
          profitPerHour: 100,
          metrics: {
            dps: 100,
            dailyNoRngProfit: 2400,
            xpPerHour: 200,
            killsPerHour: 100,
          },
          deltas: {
            dps: { pct: 0 },
            dailyNoRngProfit: { pct: 0 },
            xpPerHour: { pct: 100 },
            killsPerHour: { pct: 0 },
          },
        },
      ],
      queueSettings: {
        rounds: 1,
        baselineRounds: 1,
        medianBlend: 0.5,
        weightProfit: 0.8,
        weightXp: 0.1,
        executionMode: 'parallel',
      },
      queueState: {
        baseline: {
          snapshot: { id: 'baseline' },
          metrics: {
            dailyNoRngProfit: 2400,
            dps: 100,
            xpPerHour: 100,
            killsPerHour: 100,
          },
        },
        abilityUpgradeCosts: {},
      },
      baselineMetrics: {
        dailyNoRngProfit: 2400,
        dps: 100,
        xpPerHour: 100,
        killsPerHour: 100,
      },
      pricingState: {},
      queueRuntimeSettings: {
        finalWeights: {
          performance: 1,
          stability: 0,
          cost: 0,
        },
        costScoreGoldPerPointMode: 'strict',
        parallelWorkerLimit: 1,
      },
      costDependencies: {
        inspectQueueEquipmentPricing: () => [],
        computeQueueItemUpgradeCost: (baselineSnapshot, targetSnapshot) => targetSnapshot.upgradeCost,
      },
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('profit');
    expect(rows[0].rank).toBe(1);
    expect(rows[0].deltaDailyNoRngProfitPct).toBeCloseTo(50, 6);
    expect(rows[0].costInsights.totalUpgradeCost).toBe(100);
    expect(rows[0].changeDetails).toEqual([{ kind: 'equipment' }]);
    expect(rows[1].id).toBe('xp');
  });

  it('keeps visible profit deltas on the robust metric basis while preserving scoring deltas', () => {
    const baselineMetrics = {
      dailyNoRngProfit: 2400,
      dps: 100,
      xpPerHour: 100,
      killsPerHour: 100,
    };
    const createRawRun = (round, dailyNoRngProfit) => ({
      id: 'outlier',
      round,
      profitPerHour: dailyNoRngProfit / 24,
      metrics: {
        dps: 100,
        dailyNoRngProfit,
        xpPerHour: 100,
        killsPerHour: 100,
      },
      deltas: {
        dps: { pct: 0 },
        dailyNoRngProfit: {
          pct: ((dailyNoRngProfit - baselineMetrics.dailyNoRngProfit) / baselineMetrics.dailyNoRngProfit) * 100,
        },
        xpPerHour: { pct: 0 },
        killsPerHour: { pct: 0 },
      },
    });

    const rows = buildQueueRankedRowsFromSampleState({
      entries: [
        {
          id: 'outlier',
          label: 'Outlier Variant',
          changes: ['profit'],
          changeDetails: [],
          snapshot: {},
          confirmedEquipmentPrices: [],
        },
      ],
      rawRuns: [...Array.from({ length: 20 }, (_, index) => createRawRun(index + 1, 2400)), createRawRun(21, 24000)],
      queueSettings: {
        rounds: 21,
        baselineRounds: 1,
        medianBlend: 0,
        weightProfit: 1,
        weightXp: 0,
        executionMode: 'serial',
      },
      queueState: {
        baseline: {
          snapshot: { id: 'baseline' },
          metrics: baselineMetrics,
        },
        abilityUpgradeCosts: {},
      },
      baselineMetrics,
      pricingState: {},
      queueRuntimeSettings: {
        finalWeights: {
          performance: 1,
          stability: 0,
          cost: 0,
        },
        costScoreGoldPerPointMode: 'strict',
        parallelWorkerLimit: 1,
      },
      costDependencies: {
        inspectQueueEquipmentPricing: () => [],
        computeQueueItemUpgradeCost: () => null,
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].dailyNoRngProfitPerDay).toBeCloseTo(2400, 6);
    expect(rows[0].deltaDailyNoRngProfitPerDay).toBeCloseTo(0, 6);
    expect(rows[0].deltaDailyNoRngProfitPct).toBeCloseTo(0, 6);
    expect(rows[0].deltaProfitPerHour).toBeCloseTo(0, 6);
    expect(rows[0].deltaProfitPct).toBeCloseTo(0, 6);
    expect(rows[0].scoringProfitPerHour).toBeCloseTo((20 * 100 + 1000) / 21, 6);
    expect(rows[0].scoringDeltaProfitPerHour).toBeCloseTo((20 * 100 + 1000) / 21 - 100, 6);
    expect(rows[0].scoringDeltaProfitPct).toBeCloseTo((((20 * 100 + 1000) / 21 - 100) / 100) * 100, 6);
  });
});

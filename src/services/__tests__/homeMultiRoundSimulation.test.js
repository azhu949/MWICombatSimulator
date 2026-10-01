import { describe, expect, it } from 'vitest';
import {
  HOME_MULTI_ROUND_DEFAULT_ROUNDS,
  HOME_MULTI_ROUND_SEED_BASE,
  aggregateMultiRoundRows,
  buildMultiRoundPayloads,
  clampSimulationRounds,
} from '../homeMultiRoundSimulation.js';
import { deriveSeedSet } from '../seededRandom.js';
import { summarizeSeries } from '../robustStats.js';

describe('clampSimulationRounds', () => {
  it('默认 1、向下取整、钳到 [1,100]', () => {
    expect(clampSimulationRounds(undefined)).toBe(HOME_MULTI_ROUND_DEFAULT_ROUNDS);
    expect(clampSimulationRounds(null)).toBe(HOME_MULTI_ROUND_DEFAULT_ROUNDS);
    expect(clampSimulationRounds('abc')).toBe(HOME_MULTI_ROUND_DEFAULT_ROUNDS);
    expect(clampSimulationRounds(7.9)).toBe(7);
    expect(clampSimulationRounds(0)).toBe(1);
    expect(clampSimulationRounds(-3)).toBe(1);
    expect(clampSimulationRounds(100)).toBe(100);
    expect(clampSimulationRounds(101)).toBe(100);
  });
});

describe('buildMultiRoundPayloads', () => {
  const template = {
    type: 'start_simulation',
    workerId: 'home-single',
    players: [{ hrid: 'player1' }],
    zone: { zoneHrid: '/actions/combat/farm', difficultyTier: 2 },
    labyrinth: null,
    simulationTimeLimit: 3600,
    extra: { mooPass: true },
  };

  it('种子确定性：同输入两次调用种子集相同；rounds 5→10 时前 5 个种子不变', () => {
    const first = buildMultiRoundPayloads(template, 5).map((payload) => payload.seed);
    const second = buildMultiRoundPayloads(template, 5).map((payload) => payload.seed);
    const extended = buildMultiRoundPayloads(template, 10).map((payload) => payload.seed);

    expect(first).toEqual(second);
    expect(first).toEqual(deriveSeedSet(HOME_MULTI_ROUND_SEED_BASE, 5));
    expect(extended.slice(0, 5)).toEqual(first);
    expect(new Set(first).size).toBe(5);
  });

  it('份数、seed 注入与其余字段保持模板原样（浅克隆）', () => {
    const payloads = buildMultiRoundPayloads(template, 3);
    const seeds = deriveSeedSet(HOME_MULTI_ROUND_SEED_BASE, 3);

    expect(payloads).toHaveLength(3);
    payloads.forEach((payload, index) => {
      expect(payload.seed).toBe(seeds[index]);
      expect(payload.type).toBe('start_simulation');
      expect(payload.workerId).toBe(`home-single#r${index + 1}`);
      expect(payload.players).toBe(template.players);
      expect(payload.zone).toBe(template.zone);
      expect(payload.labyrinth).toBeNull();
      expect(payload.simulationTimeLimit).toBe(3600);
      expect(payload.extra).toBe(template.extra);
    });

    // 模板自身不被写入 seed。
    expect(template.seed).toBeUndefined();
  });

  it('seed 为归一后的 uint32', () => {
    for (const payload of buildMultiRoundPayloads(template, 20)) {
      expect(Number.isInteger(payload.seed)).toBe(true);
      expect(payload.seed).toBeGreaterThanOrEqual(0);
      expect(payload.seed).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

function buildSummaryRow(overrides = {}) {
  return {
    playerHrid: 'player1',
    playerName: '甲',
    simulatedTime: 3600,
    encountersPerHour: 100,
    deathsPerHour: 0,
    totalXpPerHour: 1000,
    profitPerHour: 10,
    revenuePerHour: 20,
    expensesPerHour: 10,
    totalExperience: 1000,
    noRngRevenue: 20,
    expenses: 10,
    noRngProfit: 10,
    staminaXpPerHour: 1000,
    ...overrides,
  };
}

describe('aggregateMultiRoundRows', () => {
  it('数值指标 = 对成功轮的 summarizeSeries.robustMean；身份字段原样', () => {
    const round1 = [buildSummaryRow({ staminaXpPerHour: 3000, encountersPerHour: 300 })];
    const round3 = [buildSummaryRow({ staminaXpPerHour: 1000, encountersPerHour: 100 })];
    // 轮 2 失败被调用方剔除：传入轮号 1、3。
    const { aggregatedRows, playerStats } = aggregateMultiRoundRows([round1, round3], [1, 3]);

    const expectedStamina = summarizeSeries([3000, 1000]);
    expect(aggregatedRows).toHaveLength(1);
    expect(aggregatedRows[0].playerHrid).toBe('player1');
    expect(aggregatedRows[0].playerName).toBe('甲');
    expect(aggregatedRows[0].staminaXpPerHour).toBe(expectedStamina.robustMean);
    expect(aggregatedRows[0].encountersPerHour).toBe(summarizeSeries([300, 100]).robustMean);
    expect(aggregatedRows[0].simulatedTime).toBe(summarizeSeries([3600, 3600]).robustMean);

    expect(playerStats).toHaveLength(1);
    const staminaStats = playerStats[0].metrics.staminaXpPerHour;
    expect(staminaStats.values).toEqual([3000, 1000]);
    expect(staminaStats.rounds).toEqual([1, 3]);
    expect(staminaStats.robustMean).toBe(expectedStamina.robustMean);
    expect(staminaStats.p50).toBe(expectedStamina.p50);
    expect(staminaStats.confidence).toBe(expectedStamina.confidence);
  });

  it('单成功轮：聚合值等于该轮原值，n = 1 时 CI 半宽为 0', () => {
    const row = buildSummaryRow({ staminaXpPerHour: 777 });
    const { aggregatedRows, playerStats } = aggregateMultiRoundRows([[row]], [2]);

    expect(aggregatedRows[0].staminaXpPerHour).toBe(777);
    const staminaStats = playerStats[0].metrics.staminaXpPerHour;
    expect(staminaStats.sampleCount).toBe(1);
    expect(staminaStats.ciHalfWidth95).toBe(0);
    expect(staminaStats.rounds).toEqual([2]);
  });

  it('多玩家各自聚合、顺序按首次出现保留；空输入返回空数组', () => {
    const round1 = [
      buildSummaryRow({ staminaXpPerHour: 100 }),
      buildSummaryRow({ playerHrid: 'player2', playerName: '乙', staminaXpPerHour: 200 }),
    ];
    const round2 = [
      buildSummaryRow({ staminaXpPerHour: 300 }),
      buildSummaryRow({ playerHrid: 'player2', playerName: '乙', staminaXpPerHour: 400 }),
    ];

    const { aggregatedRows, playerStats } = aggregateMultiRoundRows([round1, round2]);
    expect(aggregatedRows.map((row) => row.playerHrid)).toEqual(['player1', 'player2']);
    expect(aggregatedRows[0].staminaXpPerHour).toBe(summarizeSeries([100, 300]).robustMean);
    expect(aggregatedRows[1].staminaXpPerHour).toBe(summarizeSeries([200, 400]).robustMean);
    // 缺省轮号按 1..n 顺序编号。
    expect(playerStats[0].metrics.staminaXpPerHour.rounds).toEqual([1, 2]);

    expect(aggregateMultiRoundRows([])).toEqual({ aggregatedRows: [], playerStats: [] });
    expect(aggregateMultiRoundRows(null)).toEqual({ aggregatedRows: [], playerStats: [] });
  });
});

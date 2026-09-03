import { describe, expect, it } from 'vitest';
import {
  ADVISOR_GOAL_PRESET_BALANCED,
  ADVISOR_GOAL_PRESET_CUSTOM,
  ADVISOR_GOAL_PRESET_IRONCOW,
  ADVISOR_GOAL_PRESET_OPTIONS,
  ADVISOR_GOAL_PRESET_PROFIT,
  ADVISOR_GOAL_PRESET_SAFE,
  ADVISOR_GOAL_PRESET_XP,
  ADVISOR_IRONCOW_DEFAULT_WEIGHTS,
  buildAdvisorTopCards,
  getAdvisorPresetWeights,
  normalizeAdvisorGoalPreset,
  normalizeAdvisorWeights,
  normalizeIroncowWeights,
  rankAdvisorRows,
  resolveAdvisorWeights,
} from '../advisorScoring.js';

describe('advisorScoring', () => {
  it('exposes stable three-metric preset weights and normalizes custom weights', () => {
    expect(getAdvisorPresetWeights(ADVISOR_GOAL_PRESET_BALANCED)).toEqual({
      profitPerHour: 0.484615,
      xpPerHour: 0.415385,
      safety: 0.1,
    });
    expect(getAdvisorPresetWeights(ADVISOR_GOAL_PRESET_PROFIT)).toEqual({
      profitPerHour: 0.7875,
      xpPerHour: 0.1125,
      safety: 0.1,
    });
    expect(getAdvisorPresetWeights(ADVISOR_GOAL_PRESET_XP)).toEqual({
      profitPerHour: 0.18,
      xpPerHour: 0.72,
      safety: 0.1,
    });
    expect(getAdvisorPresetWeights(ADVISOR_GOAL_PRESET_SAFE)).toEqual({
      profitPerHour: 0.45,
      xpPerHour: 0.45,
      safety: 0.1,
    });

    const normalized = normalizeAdvisorWeights(
      {
        profitPerHour: 3,
        xpPerHour: 1,
      },
      ADVISOR_GOAL_PRESET_CUSTOM,
    );
    expect(normalized.profitPerHour).toBeCloseTo(0.675, 6);
    expect(normalized.xpPerHour).toBeCloseTo(0.225, 6);
    expect(normalized.safety).toBeCloseTo(0.1, 6);
    expect(normalized.profitPerHour + normalized.xpPerHour + normalized.safety).toBeCloseTo(1, 6);
  });

  it('ranks lower deaths as safer', () => {
    const rows = rankAdvisorRows(
      [
        {
          id: 'fragile',
          order: 0,
          profitPerHour: 100,
          xpPerHour: 100,
          killsPerHour: 20,
          deathsPerHour: 4,
        },
        {
          id: 'safe',
          order: 1,
          profitPerHour: 100,
          xpPerHour: 100,
          killsPerHour: 20,
          deathsPerHour: 0.2,
        },
      ],
      {
        goalPreset: ADVISOR_GOAL_PRESET_SAFE,
      },
    );

    expect(rows[0].id).toBe('safe');
    expect(rows[0].normalizedMetrics.safety).toBeGreaterThan(rows[1].normalizedMetrics.safety);
  });

  it('does not let kills per hour change ranking score', () => {
    const rows = rankAdvisorRows(
      [
        {
          id: 'low-kills',
          order: 0,
          profitPerHour: 500,
          xpPerHour: 300,
          killsPerHour: 5,
          deathsPerHour: 0.5,
        },
        {
          id: 'high-kills',
          order: 1,
          profitPerHour: 500,
          xpPerHour: 300,
          killsPerHour: 500,
          deathsPerHour: 0.5,
        },
      ],
      {
        goalPreset: ADVISOR_GOAL_PRESET_BALANCED,
      },
    );

    expect(rows[0].id).toBe('low-kills');
    expect(rows[1].id).toBe('high-kills');
    expect(rows[0].finalScore).toBeCloseTo(rows[1].finalScore, 6);
  });

  it('keeps tie ordering stable and adds validated reasons for improved refined rows', () => {
    const refinedRows = rankAdvisorRows(
      [
        {
          id: 'validated-row',
          order: 0,
          isRefined: true,
          profitPerHour: 400,
          xpPerHour: 400,
          killsPerHour: 40,
          deathsPerHour: 0.1,
        },
        {
          id: 'former-best',
          order: 1,
          profitPerHour: 200,
          xpPerHour: 200,
          killsPerHour: 20,
          deathsPerHour: 1,
        },
        {
          id: 'third',
          order: 2,
          profitPerHour: 100,
          xpPerHour: 100,
          killsPerHour: 10,
          deathsPerHour: 2,
        },
      ],
      {
        goalPreset: ADVISOR_GOAL_PRESET_PROFIT,
        quickRankById: new Map([
          ['validated-row', 3],
          ['former-best', 1],
          ['third', 2],
        ]),
      },
    );

    expect(refinedRows[0].id).toBe('validated-row');
    expect(refinedRows[0].reasons).toContain('validated');
    expect(refinedRows[0].reasons).toContain('top_pick');
  });

  it('registers the ironcow preset with drop/xp/safety weights', () => {
    expect(ADVISOR_GOAL_PRESET_OPTIONS).toContain(ADVISOR_GOAL_PRESET_IRONCOW);
    expect(normalizeAdvisorGoalPreset('IRONCOW')).toBe(ADVISOR_GOAL_PRESET_IRONCOW);
    expect(getAdvisorPresetWeights(ADVISOR_GOAL_PRESET_IRONCOW)).toEqual({
      dropsPerHour: 0.45,
      xpPerHour: 0.45,
      safety: 0.1,
    });
    expect(getAdvisorPresetWeights(ADVISOR_GOAL_PRESET_IRONCOW)).toEqual({
      ...ADVISOR_IRONCOW_DEFAULT_WEIGHTS,
    });
  });

  it('resolves ironcow weights with fallback on illegal sums', () => {
    const custom = { dropsPerHour: 0.2, xpPerHour: 0.7, safety: 0.1 };
    expect(resolveAdvisorWeights(ADVISOR_GOAL_PRESET_IRONCOW, {}, custom)).toEqual(custom);
    expect(resolveAdvisorWeights(ADVISOR_GOAL_PRESET_IRONCOW, {}, null)).toEqual({
      ...ADVISOR_IRONCOW_DEFAULT_WEIGHTS,
    });
    // 三权和 ≠ 1 → 回退默认 0.45/0.45/0.1
    expect(
      resolveAdvisorWeights(
        ADVISOR_GOAL_PRESET_IRONCOW,
        {},
        {
          dropsPerHour: 0.5,
          xpPerHour: 0.2,
          safety: 0.1,
        },
      ),
    ).toEqual({ ...ADVISOR_IRONCOW_DEFAULT_WEIGHTS });
    // 缺失字段按 0 计，和偏移同样回退
    expect(resolveAdvisorWeights(ADVISOR_GOAL_PRESET_IRONCOW, {}, {})).toEqual({
      ...ADVISOR_IRONCOW_DEFAULT_WEIGHTS,
    });
    // 负值钳为 0 后再按和校验
    expect(normalizeIroncowWeights({ dropsPerHour: -5, xpPerHour: 3, safety: 3 })).toEqual({
      ...ADVISOR_IRONCOW_DEFAULT_WEIGHTS,
    });
    // 容差内（|sum-1| ≤ 0.001）原样保留清洗后的值
    expect(normalizeIroncowWeights({ dropsPerHour: 0.451, xpPerHour: 0.449, safety: 0.1 })).toEqual({
      dropsPerHour: 0.451,
      xpPerHour: 0.449,
      safety: 0.1,
    });
    // 非铁牛分支行为与现状完全一致
    expect(resolveAdvisorWeights(ADVISOR_GOAL_PRESET_SAFE)).toEqual(getAdvisorPresetWeights(ADVISOR_GOAL_PRESET_SAFE));
  });

  it('ranks ironcow rows by the drop/xp/safety weights and ignores profit', () => {
    const rows = [
      {
        id: 'p',
        order: 0,
        profitPerHour: 5000,
        xpPerHour: 100,
        killsPerHour: 10,
        deathsPerHour: 1,
        dropsPerHour: 30,
      },
      {
        id: 'q',
        order: 1,
        profitPerHour: 4000,
        xpPerHour: 300,
        killsPerHour: 10,
        deathsPerHour: 1,
        dropsPerHour: 20,
      },
      {
        id: 'r',
        order: 2,
        profitPerHour: 3000,
        xpPerHour: 200,
        killsPerHour: 10,
        deathsPerHour: 1,
        dropsPerHour: 10,
      },
    ];

    // 默认权重 0.45/0.45/0.1：q 的经验优势（名次分 95 vs p 的 5）胜过 p 的掉落优势
    const defaultRanked = rankAdvisorRows(rows, { goalPreset: ADVISOR_GOAL_PRESET_IRONCOW });
    expect(defaultRanked.map((row) => row.id)).toEqual(['q', 'p', 'r']);
    expect(defaultRanked[0].normalizedMetrics.dropsPerHour).toBeDefined();
    expect(defaultRanked.map((row) => row.normalizedMetrics.dropsPerHour)).toEqual([50, 95, 5]);

    // 掉落主导权重 0.8/0.1/0.1 让 p 反超
    const dropHeavyRanked = rankAdvisorRows(rows, {
      goalPreset: ADVISOR_GOAL_PRESET_IRONCOW,
      ironcowWeights: { dropsPerHour: 0.8, xpPerHour: 0.1, safety: 0.1 },
    });
    expect(dropHeavyRanked.map((row) => row.id)).toEqual(['p', 'q', 'r']);

    // 同样的行在 profit 预设下按收益排序（非铁牛回归保护）
    const profitRanked = rankAdvisorRows(rows, { goalPreset: ADVISOR_GOAL_PRESET_PROFIT });
    expect(profitRanked.map((row) => row.id)).toEqual(['p', 'q', 'r']);
  });

  it('breaks ironcow score ties by drops instead of profit', () => {
    const rows = [
      {
        id: 'x',
        order: 0,
        profitPerHour: 999999,
        xpPerHour: 200,
        killsPerHour: 10,
        deathsPerHour: 1,
        dropsPerHour: 5,
      },
      {
        id: 'y',
        order: 1,
        profitPerHour: 1,
        xpPerHour: 100,
        killsPerHour: 10,
        deathsPerHour: 1,
        dropsPerHour: 15,
      },
    ];

    const ranked = rankAdvisorRows(rows, { goalPreset: ADVISOR_GOAL_PRESET_IRONCOW });
    // 两行铁牛维度互补（掉落/经验名次互换）→ 综合分打平；
    // 平手裁决按掉落降序 → y 在前，且悬殊的利润差不影响铁牛排序。
    expect(ranked[0].finalScore).toBeCloseTo(ranked[1].finalScore, 6);
    expect(ranked[0].id).toBe('y');
    expect(ranked[0].dropsPerHour).toBe(15);
  });

  it('switches confidence metric keys by preset', () => {
    const buildRow = (id, order, dropsConfidence) => ({
      id,
      order,
      profitPerHour: 100,
      xpPerHour: 100,
      killsPerHour: 10,
      deathsPerHour: 1,
      dropsPerHour: 10,
      metricSummary: {
        profitPerHour: { confidence: 0.5, robustCv: 0.2 },
        xpPerHour: { confidence: 0.5, robustCv: 0.2 },
        deathsPerHour: { confidence: 0.5, robustCv: 0.2 },
        dropsPerHour: { confidence: dropsConfidence, robustCv: 0.2 },
      },
    });
    const rows = [buildRow('low', 0, 0.1), buildRow('high', 1, 0.9)];

    // 铁牛：dropsPerHour 置信度进入均值 → high 的置信惩罚更小、综合分更高
    const ironcowRanked = rankAdvisorRows(rows, { goalPreset: ADVISOR_GOAL_PRESET_IRONCOW });
    expect(ironcowRanked[0].id).toBe('high');
    expect(ironcowRanked[0].confidenceScore).toBeGreaterThan(ironcowRanked[1].confidenceScore);
    expect(ironcowRanked[0].finalScore).toBeGreaterThan(ironcowRanked[1].finalScore);

    // 非铁牛（防回归）：dropsPerHour 置信度不进入均值 → 掉落置信度差异不改变分数
    const balancedRanked = rankAdvisorRows(rows, { goalPreset: ADVISOR_GOAL_PRESET_BALANCED });
    expect(balancedRanked[0].finalScore).toBeCloseTo(balancedRanked[1].finalScore, 6);
    expect(balancedRanked[0].confidenceScore).toBeCloseTo(balancedRanked[1].confidenceScore, 6);
  });

  it('awards top_drops instead of top_profit reasons in ironcow mode', () => {
    const rows = [
      {
        id: 'profit-king',
        order: 0,
        profitPerHour: 9000,
        xpPerHour: 100,
        killsPerHour: 10,
        deathsPerHour: 1,
        dropsPerHour: 1,
      },
      {
        id: 'drop-king',
        order: 1,
        profitPerHour: 10,
        xpPerHour: 100,
        killsPerHour: 10,
        deathsPerHour: 1,
        dropsPerHour: 50,
      },
    ];

    const ironcowRanked = rankAdvisorRows(rows, { goalPreset: ADVISOR_GOAL_PRESET_IRONCOW });
    const ironcowReasons = ironcowRanked.flatMap((row) => row.reasons);
    expect(ironcowReasons).toContain('top_drops');
    expect(ironcowReasons).not.toContain('top_profit');
    expect(ironcowRanked.find((row) => row.reasons.includes('top_drops')).id).toBe('drop-king');

    const balancedRanked = rankAdvisorRows(rows, { goalPreset: ADVISOR_GOAL_PRESET_BALANCED });
    const balancedReasons = balancedRanked.flatMap((row) => row.reasons);
    expect(balancedReasons).toContain('top_profit');
    expect(balancedReasons).not.toContain('top_drops');
  });

  it('swaps the fourth top card to best drops for ironcow', () => {
    const rows = rankAdvisorRows(
      [
        {
          id: 'profit-king',
          order: 0,
          targetName: 'Profit Zone',
          targetType: 'zone',
          category: 'group_zone',
          profitPerHour: 9000,
          xpPerHour: 100,
          killsPerHour: 10,
          deathsPerHour: 1,
          dropsPerHour: 1,
        },
        {
          id: 'drop-king',
          order: 1,
          targetName: 'Drop Zone',
          targetType: 'zone',
          category: 'group_zone',
          profitPerHour: 10,
          xpPerHour: 100,
          killsPerHour: 10,
          deathsPerHour: 1,
          dropsPerHour: 50,
        },
      ],
      { goalPreset: ADVISOR_GOAL_PRESET_IRONCOW },
    );

    const cards = buildAdvisorTopCards(rows, { preset: ADVISOR_GOAL_PRESET_IRONCOW });
    expect(cards.map((card) => card.key)).toEqual(['overall', 'profit', 'xp', 'drops']);
    expect(cards[3]).toMatchObject({
      key: 'drops',
      titleKey: 'best_drops',
      rowId: 'drop-king',
      targetName: 'Drop Zone',
      targetType: 'zone',
      category: 'group_zone',
    });
    expect(cards[3].score).toBe(rows.find((row) => row.id === 'drop-king').finalScore);
    expect(cards[3]).toHaveProperty('confidenceScore');

    // 未传 options 时输出与现状一致（第 4 张仍为最安全）
    const legacyCards = buildAdvisorTopCards(rows);
    expect(legacyCards.map((card) => card.key)).toEqual(['overall', 'profit', 'xp', 'safe']);
    expect(legacyCards[3]).toMatchObject({ key: 'safe', titleKey: 'safest' });

    // 非铁牛 preset 信号同样走现状分支
    const balancedCards = buildAdvisorTopCards(rows, { preset: ADVISOR_GOAL_PRESET_BALANCED });
    expect(balancedCards.map((card) => card.key)).toEqual(['overall', 'profit', 'xp', 'safe']);

    // preset 非规范大小写经入口规范化后仍走铁牛分支（防御口径与 rankAdvisorRows 一致）
    const uppercaseCards = buildAdvisorTopCards(rows, { preset: 'IRONCOW' });
    expect(uppercaseCards.map((card) => card.key)).toEqual(['overall', 'profit', 'xp', 'drops']);
  });
});

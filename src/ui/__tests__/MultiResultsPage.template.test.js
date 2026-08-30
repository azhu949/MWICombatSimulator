import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const multiResultsPageSource = readFileSync(new URL('../pages/MultiResultsPage.vue', import.meta.url), 'utf8');

describe('MultiResultsPage baseline summary copy', () => {
  it('explains that baseline summary values come from robust multi-round aggregation', () => {
    expect(multiResultsPageSource).toMatch(/t\(\s*'common:queue\.baselineSummaryAggregationHint',/);
  });

  it('uses compact amounts for baseline profit and XP', () => {
    expect(multiResultsPageSource).toContain('value: formatCompactCurrency(metrics?.dailyNoRngProfit)');
    expect(multiResultsPageSource).toContain('value: formatCompactCurrency(metrics?.xpPerHour)');
  });

  it('shows the selected cost score metric and uses a dynamic cost score header', () => {
    expect(multiResultsPageSource).toContain(
      "t('common:multiRound.scoreModelParamCostGoldMetricSelected', '', { mode: currentCostScoreModeLabel })",
    );
    expect(multiResultsPageSource).toContain('const costScoreColumnHeader = computed(() =>');
    expect(multiResultsPageSource).toContain('{{ costScoreColumnHeader }}');
    expect(multiResultsPageSource).toContain('costScoreColumnHeader.value');
  });

  it('uses official equipment type names for configuration changes', () => {
    expect(multiResultsPageSource).toContain('getEquipmentSlotName');
    expect(multiResultsPageSource).not.toContain('SLOT_LABEL_FALLBACK_MAP');
    expect(multiResultsPageSource).not.toContain('characterItemsUtil.mainHand');
  });

  it('flags equipment prices by method in the ranking table and export', () => {
    expect(multiResultsPageSource).toContain('v-for="badge in getBuyPriceBadges(row)"');
    expect(multiResultsPageSource).toContain('function getBuyPriceBadges(row)');
    expect(multiResultsPageSource).toContain("t('common:multiRound.manualPriceBadge', 'Manual')");
    expect(multiResultsPageSource).toContain("t('common:queue.priceMethodLeft1', 'Left 1')");
    expect(multiResultsPageSource).toContain("t('common:queue.priceMethodRight1', 'Right 1')");
    expect(multiResultsPageSource).toContain("t('common:queue.priceMethodMirror', 'Mirror')");
    expect(multiResultsPageSource).toMatch(/common:multiRound\.manualPriceTooltip/);
    expect(multiResultsPageSource).toContain('formatEquipmentBuyPriceForExport(row)');
  });

  it('shows equipment sale value, buy price and net cost columns with an upgrade cost composition tooltip', () => {
    expect(multiResultsPageSource).toContain(
      "t('common:vue.queue.equipmentSaleValue', 'Replaced Equipment Sale Value')",
    );
    expect(multiResultsPageSource).toContain("t('common:vue.queue.equipmentBuyPrice', 'Target Equipment Buy Price')");
    expect(multiResultsPageSource).toContain("t('common:vue.queue.equipmentNetCost', 'Equipment Net Cost')");
    expect(multiResultsPageSource).toMatch(/t\(\s*'common:vue\.queue\.upgradeCostComposition',/);
    expect(multiResultsPageSource).toContain('row.costInsights?.equipmentSaleValue');
    expect(multiResultsPageSource).toContain('row.costInsights?.equipmentBuyPrice');
    expect(multiResultsPageSource).toContain('row.costInsights?.equipmentNetCost');
    expect(multiResultsPageSource).not.toContain('upgradePriceBefore');
    expect(multiResultsPageSource).not.toContain('upgradePriceAfter');
  });

  it('shows daily expected profit before hourly profit delta and includes it in the export', () => {
    const dailyProfitHeader = multiResultsPageSource.indexOf(
      "t('common:queue.dailyNoRngProfit', 'Daily No RNG Profit')",
    );
    const deltaProfitHeader = multiResultsPageSource.indexOf(
      "t('common:vue.queue.deltaProfitPerHour', 'Delta Profit/h')",
    );
    expect(dailyProfitHeader).toBeGreaterThan(-1);
    expect(deltaProfitHeader).toBeGreaterThan(dailyProfitHeader);
    expect(multiResultsPageSource).toContain('formatCompactCurrency(row.dailyNoRngProfitPerDay)');
    expect(multiResultsPageSource).toContain("key: 'dailyNoRngProfitPerDay'");
    expect(multiResultsPageSource).toContain(
      'dailyNoRngProfitPerDay: formatCompactCurrency(row?.dailyNoRngProfitPerDay)',
    );
  });
});

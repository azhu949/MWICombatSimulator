import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const settingsPageSource = readFileSync(new URL('../pages/SettingsPage.vue', import.meta.url), 'utf8');

describe('SettingsPage baseline round defaults', () => {
  it('keeps sticky tabs below the measured application shell', () => {
    expect(settingsPageSource).toContain('top: var(--app-sticky-shell-height, 3rem)');
    expect(settingsPageSource).not.toContain('sticky top-14');
  });

  it('uses 1 as the default baseline round preset and draft value', () => {
    expect(settingsPageSource).toContain('baselineRounds: 1,');
    expect(settingsPageSource).toContain("const queueBaselineRoundPreset = ref('1');");
    expect(settingsPageSource).toContain('queueRunDraft.baselineRounds = Number(source.baselineRounds ?? 1);');
  });

  it('offers 1 as a selectable preset for baseline rounds', () => {
    expect(settingsPageSource).toContain('<SelectItem value="1">1</SelectItem>');
    expect(settingsPageSource).toContain("['1', '5', '10', '20', '30', '50', '100', '200']");
  });

  it('includes a saved cost score metric control in queue runtime settings', () => {
    expect(settingsPageSource).toContain('v-model="queueRuntimeDraft.costScoreGoldPerPointMode"');
    expect(settingsPageSource).toContain("const DEFAULT_COST_SCORE_GOLD_METRIC_MODE = 'strict';");
    expect(settingsPageSource).toContain('costScoreGoldPerPointMode: DEFAULT_COST_SCORE_GOLD_METRIC_MODE,');
    expect(settingsPageSource).toMatch(
      /queueRuntimeDraft\.costScoreGoldPerPointMode = normalizeCostScoreGoldPerPointMode\(\s*nextSettings\?\.costScoreGoldPerPointMode,/,
    );
    expect(settingsPageSource).toContain('costScoreGoldPerPointMode: queueRuntimeDraft.costScoreGoldPerPointMode,');
  });

  it('caps profit and xp edits so their combined weight never exceeds one', () => {
    expect(settingsPageSource).toContain(':max="queueRunWeightProfitMax"');
    expect(settingsPageSource).toContain(':max="queueRunWeightXpMax"');
    expect(settingsPageSource).toContain('@change="applyQueueRunWeightInput(\'weightProfit\')"');
    expect(settingsPageSource).toContain('@change="applyQueueRunWeightInput(\'weightXp\')"');
    expect(settingsPageSource).toContain(
      'const constrainedWeights = constrainEditedQueuePerformanceWeights(queueRunDraft, changedKey);',
    );
  });

  it('splits queue configuration into scoring, execution, and sampling boards', () => {
    expect(settingsPageSource).toContain("t('common:settingsPage.queueScoringSectionTitle', 'Scoring Model')");
    expect(settingsPageSource).toContain("t('common:settingsPage.queueExecutionSectionTitle', 'Execution & Workers')");
    expect(settingsPageSource).toContain(
      "t('common:settingsPage.queueSamplingSectionTitle', 'Sampling & Aggregation')",
    );
    expect(settingsPageSource).toContain("t('common:settingsPage.queueSectionSaveTag', 'Save')");
    expect(settingsPageSource).toContain("t('common:settingsPage.queueSectionAutoTag', 'Auto')");
  });

  it('explains median blend and keeps performance subweights inside the scoring board', () => {
    expect(settingsPageSource).toContain(
      "t('common:settingsPage.performanceSubweightsTitle', 'Performance Priorities')",
    );
    expect(settingsPageSource).toMatch(/t\(\s*'common:settingsPage\.medianBlendHint'\s*,/);
    expect(settingsPageSource).toContain(
      'Lower values lean toward the robust average across all rounds. Higher values lean toward the median, which better represents a typical round when outliers appear.',
    );
    expect(settingsPageSource).toContain(
      "t('common:settingsPage.medianBlendBreakdown', '', queueMedianBlendExplanationText)",
    );
    expect(settingsPageSource).toContain('const queueMedianBlendExplanationText = computed(() =>');
  });

  it('resets both queue run settings and runtime settings from the shared reset button', () => {
    expect(settingsPageSource).toContain('@click="resetQueueSettings"');
    expect(settingsPageSource).toContain('const result = simulator.resetQueueSettingsToDefaults();');
    expect(settingsPageSource).toContain('syncQueueRunDraft(result.queueSettings);');
    expect(settingsPageSource).toContain('syncQueueRuntimeDraft(result.runtimeSettings);');
  });

  it('searches prices by official Chinese and English item names plus HRID', () => {
    expect(settingsPageSource).toContain("formatOfficialItemName(row.hrid, 'zh').toLowerCase().includes(keyword)");
    expect(settingsPageSource).toContain("formatOfficialItemName(row.hrid, 'en').toLowerCase().includes(keyword)");
    expect(settingsPageSource).toContain('row.hrid.toLowerCase().includes(keyword)');
    expect(settingsPageSource).toContain('{ language: targetLanguage }');
    expect(settingsPageSource).not.toContain('row.name.toLowerCase().includes(keyword)');
  });

  it('disables both pricing mode selects with the G1 joint guard (S-1)', () => {
    // 宽容正则锚定（prettier 可能折行加长后的属性行）：两 Select 必须绑定
    // pricingSettingsDisabled，且该 computed 为 G1 五条件联合判定（与
    // HomeSimulationPanel.pricingControlsDisabled / store isPricingMutationBlocked 同口径）。
    expect(settingsPageSource).toMatch(
      /<Select\s+v-model="consumablePriceModeProxy"\s+:disabled="pricingSettingsDisabled">/,
    );
    expect(settingsPageSource).toMatch(/<Select\s+v-model="dropPriceModeProxy"\s+:disabled="pricingSettingsDisabled">/);
    // G-1 收口（2026-09-05）：Edit Prices 按钮同口径禁用——override 三写点经
    // rehydrate 整体换 priceTable 引用，运行中可改即与 mode 同款口径分裂。
    expect(settingsPageSource).toContain('const pricingSettingsDisabled = computed(');
    expect(settingsPageSource).toMatch(
      /<button\s+type="button"\s+class="button-secondary"\s+:disabled="pricingSettingsDisabled"\s+@click="openEditPricesModal = true"\s*>/,
    );
    // G-1 复审补充（2026-09-05）：Reset Vendor Prices 按钮同口径禁用——vendor 重置
    // 换 basePriceTable+priceTable 双引用并双清行情缓存，运行中可点即同款分裂。
    expect(settingsPageSource).toMatch(
      /<button\s+type="button"\s+class="button-secondary"\s+:disabled="pricingSettingsDisabled"\s+@click="resetPricesToVendor"\s*>/,
    );
    expect(settingsPageSource).toContain('simulator.pricing.isLoading ||');
    expect(settingsPageSource).toContain('simulator.runtime.isRunning ||');
    expect(settingsPageSource).toContain('simulator.isAnyQueueRunning ||');
    expect(settingsPageSource).toContain('simulator.advisor.runtime?.isRunning === true ||');
    expect(settingsPageSource).toContain('simulator.advisor.runtime?.scanInFlight === true,');
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const settingsPageSource = readFileSync(new URL("../pages/SettingsPage.vue", import.meta.url), "utf8");

describe("SettingsPage baseline round defaults", () => {
    it("uses 1 as the default baseline round preset and draft value", () => {
        expect(settingsPageSource).toContain('baselineRounds: 1,');
        expect(settingsPageSource).toContain('const queueBaselineRoundPreset = ref("1");');
        expect(settingsPageSource).toContain('queueRunDraft.baselineRounds = Number(source.baselineRounds ?? 1);');
    });

    it("offers 1 as a selectable preset for baseline rounds", () => {
        expect(settingsPageSource).toContain('<option value="1">1</option>');
        expect(settingsPageSource).toContain('["1", "5", "10", "20", "30", "50", "100", "200"]');
    });

    it("includes a saved cost score metric control in queue runtime settings", () => {
        expect(settingsPageSource).toContain('v-model="queueRuntimeDraft.costScoreGoldPerPointMode"');
        expect(settingsPageSource).toContain('const DEFAULT_COST_SCORE_GOLD_METRIC_MODE = "strict";');
        expect(settingsPageSource).toContain('costScoreGoldPerPointMode: DEFAULT_COST_SCORE_GOLD_METRIC_MODE,');
        expect(settingsPageSource).toContain('queueRuntimeDraft.costScoreGoldPerPointMode = normalizeCostScoreGoldPerPointMode(nextSettings?.costScoreGoldPerPointMode);');
        expect(settingsPageSource).toContain('costScoreGoldPerPointMode: queueRuntimeDraft.costScoreGoldPerPointMode,');
    });

    it("caps profit and xp edits so their combined weight never exceeds one", () => {
        expect(settingsPageSource).toContain(':max="queueRunWeightProfitMax"');
        expect(settingsPageSource).toContain(':max="queueRunWeightXpMax"');
        expect(settingsPageSource).toContain("@change=\"applyQueueRunWeightInput('weightProfit')\"");
        expect(settingsPageSource).toContain("@change=\"applyQueueRunWeightInput('weightXp')\"");
        expect(settingsPageSource).toContain("const constrainedWeights = constrainEditedQueuePerformanceWeights(queueRunDraft, changedKey);");
    });

    it("splits queue configuration into scoring, execution, and sampling boards", () => {
        expect(settingsPageSource).toContain('t("common:settingsPage.queueScoringSectionTitle", "Scoring Model")');
        expect(settingsPageSource).toContain('t("common:settingsPage.queueExecutionSectionTitle", "Execution & Workers")');
        expect(settingsPageSource).toContain('t("common:settingsPage.queueSamplingSectionTitle", "Sampling & Aggregation")');
        expect(settingsPageSource).toContain('t("common:settingsPage.queueSectionSaveTag", "Save")');
        expect(settingsPageSource).toContain('t("common:settingsPage.queueSectionAutoTag", "Auto")');
    });

    it("explains median blend and keeps performance subweights inside the scoring board", () => {
        expect(settingsPageSource).toContain('t("common:settingsPage.performanceSubweightsTitle", "Performance Priorities")');
        expect(settingsPageSource).toContain('t("common:settingsPage.medianBlendHint", "Lower values lean toward the robust average across all rounds. Higher values lean toward the median, which better represents a typical round when outliers appear.")');
        expect(settingsPageSource).toContain('t("common:settingsPage.medianBlendBreakdown", "", queueMedianBlendExplanationText)');
        expect(settingsPageSource).toContain("const queueMedianBlendExplanationText = computed(() =>");
    });

    it("resets both queue run settings and runtime settings from the shared reset button", () => {
        expect(settingsPageSource).toContain('@click="resetQueueSettings"');
        expect(settingsPageSource).toContain("const result = simulator.resetQueueSettingsToDefaults();");
        expect(settingsPageSource).toContain("syncQueueRunDraft(result.queueSettings);");
        expect(settingsPageSource).toContain("syncQueueRuntimeDraft(result.runtimeSettings);");
    });

    it("searches prices by official Chinese and English item names plus HRID", () => {
        expect(settingsPageSource).toContain('formatOfficialItemName(row.hrid, "zh").toLowerCase().includes(keyword)');
        expect(settingsPageSource).toContain('formatOfficialItemName(row.hrid, "en").toLowerCase().includes(keyword)');
        expect(settingsPageSource).toContain("row.hrid.toLowerCase().includes(keyword)");
        expect(settingsPageSource).toContain("{ language: targetLanguage }");
        expect(settingsPageSource).not.toContain("row.name.toLowerCase().includes(keyword)");
    });
});

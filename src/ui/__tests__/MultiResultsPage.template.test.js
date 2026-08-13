import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const multiResultsPageSource = readFileSync(new URL("../pages/MultiResultsPage.vue", import.meta.url), "utf8");

describe("MultiResultsPage baseline summary copy", () => {
    it("explains that baseline summary values come from robust multi-round aggregation", () => {
        expect(multiResultsPageSource).toContain('t("common:queue.baselineSummaryAggregationHint"');
    });

    it("shows the selected cost score metric and uses a dynamic cost score header", () => {
        expect(multiResultsPageSource).toContain('t("common:multiRound.scoreModelParamCostGoldMetricSelected", "", { mode: currentCostScoreModeLabel })');
        expect(multiResultsPageSource).toContain('const costScoreColumnHeader = computed(() =>');
        expect(multiResultsPageSource).toContain('{{ costScoreColumnHeader }}');
        expect(multiResultsPageSource).toContain('costScoreColumnHeader.value');
    });

    it("uses official equipment type names for configuration changes", () => {
        expect(multiResultsPageSource).toContain("getEquipmentSlotName");
        expect(multiResultsPageSource).not.toContain("SLOT_LABEL_FALLBACK_MAP");
        expect(multiResultsPageSource).not.toContain("characterItemsUtil.mainHand");
    });

    it("flags manually entered equipment prices in the ranking table and export", () => {
        expect(multiResultsPageSource).toContain('v-if="hasManualUpgradePrice(row)"');
        expect(multiResultsPageSource).toContain('t("common:multiRound.manualPriceBadge", "Manual")');
        expect(multiResultsPageSource).toContain('"common:multiRound.manualPriceTooltip"');
        expect(multiResultsPageSource).toContain("formatEquipmentBuyPriceForExport(row)");
    });

    it("shows equipment sale value, buy price and net cost columns with an upgrade cost composition tooltip", () => {
        expect(multiResultsPageSource).toContain('t("common:vue.queue.equipmentSaleValue", "Replaced Equipment Sale Value")');
        expect(multiResultsPageSource).toContain('t("common:vue.queue.equipmentBuyPrice", "Target Equipment Buy Price")');
        expect(multiResultsPageSource).toContain('t("common:vue.queue.equipmentNetCost", "Equipment Net Cost")');
        expect(multiResultsPageSource).toContain('t(\'common:vue.queue.upgradeCostComposition\'');
        expect(multiResultsPageSource).toContain('row.costInsights?.equipmentSaleValue');
        expect(multiResultsPageSource).toContain('row.costInsights?.equipmentBuyPrice');
        expect(multiResultsPageSource).toContain('row.costInsights?.equipmentNetCost');
        expect(multiResultsPageSource).not.toContain("upgradePriceBefore");
        expect(multiResultsPageSource).not.toContain("upgradePriceAfter");
    });
});

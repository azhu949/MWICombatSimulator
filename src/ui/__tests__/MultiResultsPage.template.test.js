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
});

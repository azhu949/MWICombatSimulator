import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const queuePageSource = readFileSync(new URL("../pages/QueuePage.vue", import.meta.url), "utf8");

describe("QueuePage progress presentation", () => {
    it("keeps queue progress as a percentage summary without rendering a duplicate progress bar", () => {
        expect(queuePageSource).toContain('t("common:vue.queue.queueProgress", "Queue Progress")');
        expect(queuePageSource).toContain('{{ Math.floor((queueState.progress || 0) * 100) }}%');
        expect(queuePageSource).not.toContain('width: `${Math.floor((queueState.progress || 0) * 100)}%`');
    });

    it("explains that baseline summary values come from robust multi-round aggregation", () => {
        expect(queuePageSource).toContain('t("common:queue.baselineSummaryAggregationHint"');
    });

    it("uses official equipment type names for queue changes", () => {
        expect(queuePageSource).toContain("getEquipmentSlotName");
        expect(queuePageSource).toContain('getItemCategoryName("/item_categories/food", "Food")');
        expect(queuePageSource).toContain('getItemCategoryName("/item_categories/drink", "Drink")');
        expect(queuePageSource).not.toContain("SLOT_LABEL_FALLBACK_MAP");
        expect(queuePageSource).not.toContain("characterItemsUtil.mainHand");
    });
});

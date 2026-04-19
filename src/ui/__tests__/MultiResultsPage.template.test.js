import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const multiResultsPageSource = readFileSync(new URL("../pages/MultiResultsPage.vue", import.meta.url), "utf8");

describe("MultiResultsPage baseline summary copy", () => {
    it("explains that baseline summary values come from robust multi-round aggregation", () => {
        expect(multiResultsPageSource).toContain('t("common:queue.baselineSummaryAggregationHint"');
    });
});

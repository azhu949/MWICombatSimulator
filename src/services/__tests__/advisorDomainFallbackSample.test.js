import { describe, expect, it, vi } from "vitest";

vi.mock("../advisorScoring.js", async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        buildAdvisorMetricSummary: () => ({
            profitPerHour: { robustMean: Number.NaN },
            xpPerHour: { robustMean: Number.POSITIVE_INFINITY },
            killsPerHour: { robustMean: undefined },
            deathsPerHour: { robustMean: Number.NaN },
        }),
    };
});

import { buildAdvisorRowFromRoundMetrics } from "../advisorDomain.js";

describe("advisorDomain fallback samples", () => {
    it("normalizes fallback sample metrics when robust means are unavailable", () => {
        const row = buildAdvisorRowFromRoundMetrics({
            id: "zone:/actions/combat/test#0",
            targetType: "zone",
            category: "solo_zone",
            targetHrid: "/actions/combat/test",
            targetName: "Test Zone",
            difficultyTier: 0,
        }, [
            {
                profitPerHour: 1,
                xpPerHour: 2,
                killsPerHour: 3,
                deathsPerHour: 4,
            },
            {
                profitPerHour: "123.5",
                xpPerHour: Number.POSITIVE_INFINITY,
                killsPerHour: "not-a-number",
                deathsPerHour: null,
            },
        ]);

        expect(row.profitPerHour).toBe(123.5);
        expect(row.xpPerHour).toBe(0);
        expect(row.killsPerHour).toBe(0);
        expect(row.deathsPerHour).toBe(0);
    });
});

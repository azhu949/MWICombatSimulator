import { describe, expect, it } from "vitest";
import {
    ADVISOR_GOAL_PRESET_BALANCED,
    ADVISOR_GOAL_PRESET_CUSTOM,
    ADVISOR_GOAL_PRESET_PROFIT,
    ADVISOR_GOAL_PRESET_SAFE,
    ADVISOR_GOAL_PRESET_XP,
    getAdvisorPresetWeights,
    normalizeAdvisorWeights,
    rankAdvisorRows,
} from "../advisorScoring.js";

describe("advisorScoring", () => {
    it("exposes stable three-metric preset weights and normalizes custom weights", () => {
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

        const normalized = normalizeAdvisorWeights({
            profitPerHour: 3,
            xpPerHour: 1,
        }, ADVISOR_GOAL_PRESET_CUSTOM);
        expect(normalized.profitPerHour).toBeCloseTo(0.675, 6);
        expect(normalized.xpPerHour).toBeCloseTo(0.225, 6);
        expect(normalized.safety).toBeCloseTo(0.1, 6);
        expect(normalized.profitPerHour + normalized.xpPerHour + normalized.safety).toBeCloseTo(1, 6);
    });

    it("ranks lower deaths as safer", () => {
        const rows = rankAdvisorRows([
            {
                id: "fragile",
                order: 0,
                profitPerHour: 100,
                xpPerHour: 100,
                killsPerHour: 20,
                deathsPerHour: 4,
            },
            {
                id: "safe",
                order: 1,
                profitPerHour: 100,
                xpPerHour: 100,
                killsPerHour: 20,
                deathsPerHour: 0.2,
            },
        ], {
            goalPreset: ADVISOR_GOAL_PRESET_SAFE,
        });

        expect(rows[0].id).toBe("safe");
        expect(rows[0].normalizedMetrics.safety).toBeGreaterThan(rows[1].normalizedMetrics.safety);
    });

    it("does not let kills per hour change ranking score", () => {
        const rows = rankAdvisorRows([
            {
                id: "low-kills",
                order: 0,
                profitPerHour: 500,
                xpPerHour: 300,
                killsPerHour: 5,
                deathsPerHour: 0.5,
            },
            {
                id: "high-kills",
                order: 1,
                profitPerHour: 500,
                xpPerHour: 300,
                killsPerHour: 500,
                deathsPerHour: 0.5,
            },
        ], {
            goalPreset: ADVISOR_GOAL_PRESET_BALANCED,
        });

        expect(rows[0].id).toBe("low-kills");
        expect(rows[1].id).toBe("high-kills");
        expect(rows[0].finalScore).toBeCloseTo(rows[1].finalScore, 6);
    });

    it("keeps tie ordering stable and adds validated reasons for improved refined rows", () => {
        const refinedRows = rankAdvisorRows([
            {
                id: "validated-row",
                order: 0,
                isRefined: true,
                profitPerHour: 400,
                xpPerHour: 400,
                killsPerHour: 40,
                deathsPerHour: 0.1,
            },
            {
                id: "former-best",
                order: 1,
                profitPerHour: 200,
                xpPerHour: 200,
                killsPerHour: 20,
                deathsPerHour: 1,
            },
            {
                id: "third",
                order: 2,
                profitPerHour: 100,
                xpPerHour: 100,
                killsPerHour: 10,
                deathsPerHour: 2,
            },
        ], {
            goalPreset: ADVISOR_GOAL_PRESET_PROFIT,
            quickRankById: new Map([
                ["validated-row", 3],
                ["former-best", 1],
                ["third", 2],
            ]),
        });

        expect(refinedRows[0].id).toBe("validated-row");
        expect(refinedRows[0].reasons).toContain("validated");
        expect(refinedRows[0].reasons).toContain("top_pick");
    });
});

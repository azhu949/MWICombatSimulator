import { describe, expect, it, vi } from "vitest";

import { buildCombatStatBreakdownParts, COMBAT_PREVIEW_RECONCILIATION_EPSILON } from "../lib/combatStatBreakdown.js";

function makeDeps(overrides = {}) {
    return {
        formatDelta: vi.fn((stat) => `Δ${stat.deltaValue}`),
        formatValue: vi.fn((value) => `V${value}`),
        formatHighlightLabel: vi.fn((source) => source.sourceName || "label"),
        t: vi.fn((key, fallback) => fallback),
        ...overrides,
    };
}

describe("buildCombatStatBreakdownParts", () => {
    it("builds a base part and one source part with i18n-formatted text", () => {
        const breakdown = {
            baseValue: 100,
            finalValue: 106,
            format: "int",
            reconciliationDelta: 0,
            sources: [{
                sourceKey: "guild-buff-1",
                sourceName: "Shrine of Force",
                deltaValue: 6,
            }],
        };

        const result = buildCombatStatBreakdownParts(breakdown, "stabMaxDamage", makeDeps());

        expect(result.hasSources).toBe(true);
        expect(result.value).toBe("V106");
        expect(result.breakdownParts).toHaveLength(2);
        expect(result.breakdownParts[0]).toEqual({
            key: "base-stabMaxDamage",
            kind: "base",
            text: "Base V100",
        });
        expect(result.breakdownParts[1]).toEqual({
            key: "guild-buff-1-stabMaxDamage",
            kind: "source",
            text: "Δ6 (Shrine of Force)",
        });
        expect(result.breakdownText).toBe("Base V100 Δ6 (Shrine of Force)");
    });

    it("appends a reconciliation part when the delta exceeds the epsilon", () => {
        const breakdown = {
            baseValue: 100,
            finalValue: 107,
            format: "int",
            reconciliationDelta: 1,
            sources: [{
                sourceKey: "scroll-1",
                sourceName: "Scroll",
                deltaValue: 6,
            }],
        };

        const result = buildCombatStatBreakdownParts(breakdown, "maxHitpoints", makeDeps());

        expect(result.breakdownParts).toHaveLength(3);
        expect(result.breakdownParts[2].kind).toBe("reconciliation");
        expect(result.breakdownParts[2].text).toBe("Δ1 (Adjustment)");
    });

    it("skips the reconciliation part when the delta is within the epsilon", () => {
        const breakdown = {
            baseValue: 100,
            finalValue: 106,
            format: "int",
            reconciliationDelta: COMBAT_PREVIEW_RECONCILIATION_EPSILON / 2,
            sources: [],
        };

        const result = buildCombatStatBreakdownParts(breakdown, "maxHitpoints", makeDeps());

        expect(result.breakdownParts).toHaveLength(1);
        expect(result.hasSources).toBe(false);
    });

    it("uses the localized source format from t()", () => {
        const breakdown = {
            baseValue: 0,
            finalValue: 5,
            format: "int",
            reconciliationDelta: 0,
            sources: [{ sourceKey: "s1", sourceName: "Src", deltaValue: 5 }],
        };

        const deps = makeDeps({
            t: vi.fn((key, fallback) => {
                if (key === "common:vue.home.combatStatSourceFormat") {
                    return "{{delta}}【{{source}}】";
                }
                return fallback;
            }),
        });

        const result = buildCombatStatBreakdownParts(breakdown, "key", deps);

        expect(result.breakdownParts[1].text).toBe("Δ5【Src】");
    });

    it("reports hasSources=false when there are no sources and no reconciliation", () => {
        const breakdown = {
            baseValue: 50,
            finalValue: 50,
            format: "int",
            reconciliationDelta: 0,
            sources: [],
        };

        const result = buildCombatStatBreakdownParts(breakdown, "key", makeDeps());

        expect(result.hasSources).toBe(false);
        expect(result.breakdownParts).toHaveLength(1);
    });
});

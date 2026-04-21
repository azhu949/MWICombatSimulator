import { describe, expect, it } from "vitest";
import {
    constrainEditedQueuePerformanceWeights,
    resolveQueuePerformanceSubweights,
} from "../queuePerformanceWeights.js";

describe("queuePerformanceWeights", () => {
    it("rounds valid profit/xp weights to a single decimal place", () => {
        const resolved = resolveQueuePerformanceSubweights({
            weightProfit: 0.25,
            weightXp: 0.35,
        });

        expect(resolved.weightProfit).toBeCloseTo(0.3, 6);
        expect(resolved.weightXp).toBeCloseTo(0.4, 6);
        expect(resolved.weightDeathSafety).toBeCloseTo(0.3, 6);
        expect(resolved.weightDps).toBeCloseTo(0.15, 6);
        expect(resolved.weightKills).toBeCloseTo(0.15, 6);
    });

    it("normalizes oversized profit/xp weights onto 0.1 steps", () => {
        const resolved = resolveQueuePerformanceSubweights({
            weightProfit: 0.25,
            weightXp: 0.85,
        });

        expect(resolved.weightProfit).toBeCloseTo(0.2, 6);
        expect(resolved.weightXp).toBeCloseTo(0.8, 6);
        expect(resolved.weightDeathSafety).toBeCloseTo(0, 6);
    });

    it("keeps fully normalized oversized weights on 0.1 steps without leaking remainder to dps or kills", () => {
        const resolved = resolveQueuePerformanceSubweights({
            weightProfit: 0.3,
            weightXp: 1.7,
        });

        expect(resolved.weightProfit).toBeCloseTo(0.1, 6);
        expect(resolved.weightXp).toBeCloseTo(0.9, 6);
        expect(resolved.weightDeathSafety).toBeCloseTo(0, 6);
        expect(resolved.weightDps).toBeCloseTo(0, 6);
        expect(resolved.weightKills).toBeCloseTo(0, 6);
    });

    it("caps the edited weight so profit and xp cannot exceed one together", () => {
        const profitEdited = constrainEditedQueuePerformanceWeights({
            weightProfit: 0.6,
            weightXp: 0.7,
        }, "weightProfit");
        const xpEdited = constrainEditedQueuePerformanceWeights({
            weightProfit: 0.6,
            weightXp: 0.7,
        }, "weightXp");

        expect(profitEdited).toEqual({
            weightProfit: 0.3,
            weightXp: 0.7,
        });
        expect(xpEdited).toEqual({
            weightProfit: 0.6,
            weightXp: 0.4,
        });
    });

    it("rounds both weights to a single decimal place before applying edit constraints", () => {
        const profitEdited = constrainEditedQueuePerformanceWeights({
            weightProfit: 0.3,
            weightXp: 0.35,
        }, "weightProfit");
        const xpEdited = constrainEditedQueuePerformanceWeights({
            weightProfit: 0.25,
            weightXp: 0.4,
        }, "weightXp");

        expect(profitEdited).toEqual({
            weightProfit: 0.3,
            weightXp: 0.4,
        });
        expect(xpEdited).toEqual({
            weightProfit: 0.3,
            weightXp: 0.4,
        });
    });

    it("never rounds the edited weight above the remaining 0.1-step budget", () => {
        const profitEdited = constrainEditedQueuePerformanceWeights({
            weightProfit: 0.65,
            weightXp: 0.4,
        }, "weightProfit");
        const xpEdited = constrainEditedQueuePerformanceWeights({
            weightProfit: 0.7,
            weightXp: 0.35,
        }, "weightXp");

        expect(profitEdited).toEqual({
            weightProfit: 0.6,
            weightXp: 0.4,
        });
        expect(xpEdited).toEqual({
            weightProfit: 0.7,
            weightXp: 0.3,
        });
    });
});

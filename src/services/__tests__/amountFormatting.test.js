import { describe, expect, it } from "vitest";
import {
    convertAmountFromBaseUnits,
    convertAmountToBaseUnits,
    formatCompactAmount,
} from "../amountFormatting.js";

describe("formatCompactAmount", () => {
    it("uses fixed K, M, and B amount suffixes", () => {
        expect(formatCompactAmount(999)).toBe("999");
        expect(formatCompactAmount(1_000)).toBe("1K");
        expect(formatCompactAmount(12_500)).toBe("12.5K");
        expect(formatCompactAmount(1_250_000)).toBe("1.25M");
        expect(formatCompactAmount(1_500_000_000)).toBe("1.5B");
    });

    it("supports locale-independent lowercase units", () => {
        expect(formatCompactAmount(12_500, { locale: "zh-CN", unitCase: "lower" })).toBe("12.5k");
        expect(formatCompactAmount(1_250_000, { locale: "zh-CN", unitCase: "lower" })).toBe("1.25m");
        expect(formatCompactAmount(1_500_000_000, { locale: "zh-CN", unitCase: "lower" })).toBe("1.5b");
    });

    it("supports negative amounts and invalid placeholders", () => {
        expect(formatCompactAmount(-2_500_000)).toBe("-2.5M");
        expect(formatCompactAmount(Number.NaN)).toBe("—");
    });

    it("promotes values that would round to the next unit", () => {
        expect(formatCompactAmount(999_999)).toBe("1M");
        expect(formatCompactAmount(999_999_999)).toBe("1B");
    });

    it("converts numeric inputs with explicit K, M, and B units", () => {
        expect(convertAmountToBaseUnits(10, "K")).toBe(10_000);
        expect(convertAmountToBaseUnits(10, "M")).toBe(10_000_000);
        expect(convertAmountToBaseUnits(1.5, "B")).toBe(1_500_000_000);
        expect(convertAmountFromBaseUnits(1_500_000_000, "M")).toBe(1_500);
        expect(convertAmountFromBaseUnits(1_500_000_000, "B")).toBe(1.5);
        expect(convertAmountToBaseUnits(10, "G")).toBeNull();
    });
});

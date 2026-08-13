import { describe, expect, it } from "vitest";
import { evaluateManualPriceDraft, normalizeManualPriceDraft } from "../queueManualPriceValidation.js";

describe("normalizeManualPriceDraft", () => {
    it("keeps digit-only input unchanged", () => {
        expect(normalizeManualPriceDraft("12345")).toEqual({ normalized: "12345", containsLetters: false });
    });

    it("strips non-digit characters and flags letters", () => {
        expect(normalizeManualPriceDraft("12a3b")).toEqual({ normalized: "123", containsLetters: true });
        expect(normalizeManualPriceDraft("1,000")).toEqual({ normalized: "1000", containsLetters: false });
        expect(normalizeManualPriceDraft("12.5")).toEqual({ normalized: "125", containsLetters: false });
        expect(normalizeManualPriceDraft("1三2")).toEqual({ normalized: "12", containsLetters: true });
    });

    it("removes leading zeros but keeps a lone zero", () => {
        expect(normalizeManualPriceDraft("007")).toEqual({ normalized: "7", containsLetters: false });
        expect(normalizeManualPriceDraft("0")).toEqual({ normalized: "0", containsLetters: false });
    });

    it("treats empty and missing input as an empty draft", () => {
        expect(normalizeManualPriceDraft("")).toEqual({ normalized: "", containsLetters: false });
        expect(normalizeManualPriceDraft(undefined)).toEqual({ normalized: "", containsLetters: false });
    });
});

describe("evaluateManualPriceDraft", () => {
    it("accepts a positive safe integer draft with a safe multiplier", () => {
        expect(evaluateManualPriceDraft("12", 1000)).toEqual({ valid: true, draftNumber: 12, actualPrice: 12000 });
        expect(evaluateManualPriceDraft("9007199254740991", 1).valid).toBe(true);
    });

    it("rejects empty, zero, negative, and non-numeric drafts", () => {
        for (const draft of ["", "0", "-5", "abc", "1.5"]) {
            expect(evaluateManualPriceDraft(draft, 1000).valid).toBe(false);
        }
    });

    it("rejects non-safe integer drafts", () => {
        expect(evaluateManualPriceDraft("9007199254740993", 1).valid).toBe(false);
    });

    it("rejects multiplication overflow beyond MAX_SAFE_INTEGER", () => {
        expect(evaluateManualPriceDraft("9007199254740991", 1000).valid).toBe(false);
        expect(evaluateManualPriceDraft("99999999999999999999", 1000).valid).toBe(false);
    });

    it("rejects overflow with the billion unit multiplier at the boundary", () => {
        expect(evaluateManualPriceDraft("9007199", 1_000_000_000).valid).toBe(true);
        expect(evaluateManualPriceDraft("9007200", 1_000_000_000).valid).toBe(false);
    });

    it("uses the default k multiplier when omitted", () => {
        expect(evaluateManualPriceDraft("5")).toEqual({ valid: true, draftNumber: 5, actualPrice: 5000 });
    });
});

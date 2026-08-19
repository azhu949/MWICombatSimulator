import { describe, expect, it } from "vitest";
import { formatCurrency } from "../components/home/homeFormatters.js";

describe("home formatters", () => {
    it.each([NaN, Infinity, -Infinity, "NaN", "invalid"])(
        "renders non-finite currency value %s as unavailable",
        (value) => {
            expect(formatCurrency(value)).toBe("-");
        },
    );

    it.each([null, undefined, ""])("keeps the zero fallback for empty currency value %s", (value) => {
        expect(formatCurrency(value)).toBe("0");
    });

    it("rounds and localizes finite currency values", () => {
        expect(formatCurrency(1234.6)).toBe(
            (1234.6).toLocaleString(undefined, {
                maximumFractionDigits: 0,
            }),
        );
    });
});

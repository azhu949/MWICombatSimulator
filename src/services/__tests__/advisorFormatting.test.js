import { describe, expect, it } from "vitest";
import { formatAdvisorCompactValue, formatAdvisorDailyProfitValue } from "../advisorFormatting.js";

describe("advisorFormatting", () => {
    it("formats compact values with two decimals", () => {
        expect(formatAdvisorCompactValue(999)).toBe("999.00");
        expect(formatAdvisorCompactValue(1234)).toBe("1.23K");
        expect(formatAdvisorCompactValue(1250000)).toBe("1.25M");
    });

    it("formats daily profit from hourly profit", () => {
        expect(formatAdvisorDailyProfitValue(1000)).toBe("24.00K");
        expect(formatAdvisorDailyProfitValue(0)).toBe("0.00");
    });
});

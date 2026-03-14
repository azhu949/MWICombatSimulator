import { beforeEach, describe, expect, it, vi } from "vitest";

let mockTranslations = {};

vi.mock("../useI18nText.js", () => ({
    useI18nText: () => ({
        t(key, fallback = "") {
            if (Object.prototype.hasOwnProperty.call(mockTranslations, key)) {
                return mockTranslations[key];
            }

            return fallback || key;
        },
    }),
}));

import { useAbilityText } from "../useAbilityText.js";

describe("useAbilityText", () => {
    beforeEach(() => {
        mockTranslations = {};
    });

    it("falls back to resolved english ability metadata when local translation keys are absent", () => {
        const { getAbilityName, getAbilityDescription } = useAbilityText();

        expect(getAbilityName("/abilities/aqua_arrow")).toBe("Aqua Arrow");
        expect(getAbilityDescription("/abilities/aqua_arrow")).toBe("Shoots an arrow made of water at the targeted enemy");
    });

    it("prefers translated ability name and description when the current language provides them", () => {
        mockTranslations = {
            "abilityNames./abilities/aqua_arrow": "流水箭",
            "abilityDescriptions./abilities/aqua_arrow": "向目标敌人射出水箭",
        };

        const { getAbilityName, getAbilityDescription } = useAbilityText();

        expect(getAbilityName("/abilities/aqua_arrow")).toBe("流水箭");
        expect(getAbilityDescription("/abilities/aqua_arrow")).toBe("向目标敌人射出水箭");
    });

    it("never leaks raw i18n keys when the current language is missing ability copy", () => {
        const { getAbilityName, getAbilityDescription } = useAbilityText();

        expect(getAbilityName("/abilities/aqua_arrow")).not.toBe("abilityNames./abilities/aqua_arrow");
        expect(getAbilityDescription("/abilities/aqua_arrow")).not.toBe("abilityDescriptions./abilities/aqua_arrow");
    });

    it("uses fallback arguments and final defaults for unknown abilities", () => {
        const { getAbilityName, getAbilityDescription } = useAbilityText();

        expect(getAbilityName("/abilities/unknown_custom")).toBe("/abilities/unknown_custom");
        expect(getAbilityName("/abilities/unknown_custom", "Custom Ability")).toBe("Custom Ability");
        expect(getAbilityDescription("/abilities/unknown_custom")).toBe("");
        expect(getAbilityDescription("/abilities/unknown_custom", "Custom Description")).toBe("Custom Description");
    });
});


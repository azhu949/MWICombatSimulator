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

import { useGameDataText } from "../useGameDataText.js";

describe("useGameDataText", () => {
    beforeEach(() => {
        mockTranslations = {};
    });

    it("falls back to official game data labels when translation keys are absent", () => {
        const { getBuffTypeName, getItemName, getSkillName, getItemCategoryName } = useGameDataText();

        expect(getBuffTypeName("/buff_types/wisdom")).toBe("Wisdom");
        expect(getItemName("/items/gatherer_cape")).toBe("Gatherer Cape");
        expect(getSkillName("/skills/attack")).toBe("Attack");
        expect(getSkillName("attack")).toBe("Attack");
        expect(getItemCategoryName("/item_categories/equipment")).toBe("Equipment");
    });

    it("prefers translated labels when the current language provides them", () => {
        mockTranslations = {
            "buffTypeNames./buff_types/wisdom": "智慧",
            "translation:itemNames./items/gatherer_cape": "采集者斗篷",
            "skillNames./skills/attack": "攻击",
            "itemCategoryNames./item_categories/equipment": "装备",
        };

        const { getBuffTypeName, getItemName, getSkillName, getItemCategoryName } = useGameDataText();

        expect(getBuffTypeName("/buff_types/wisdom")).toBe("智慧");
        expect(getItemName("/items/gatherer_cape")).toBe("采集者斗篷");
        expect(getSkillName("/skills/attack")).toBe("攻击");
        expect(getSkillName("attack")).toBe("攻击");
        expect(getItemCategoryName("/item_categories/equipment")).toBe("装备");
    });

    it("never leaks raw i18n keys when local translations are missing", () => {
        mockTranslations = {
            "translation:itemNames./items/gatherer_cape": "itemNames./items/gatherer_cape",
        };

        const { getBuffTypeName, getItemName, getSkillName, getItemCategoryName } = useGameDataText();

        expect(getBuffTypeName("/buff_types/wisdom")).not.toBe("buffTypeNames./buff_types/wisdom");
        expect(getItemName("/items/gatherer_cape")).toBe("Gatherer Cape");
        expect(getSkillName("/skills/attack")).not.toBe("skillNames./skills/attack");
        expect(getItemCategoryName("/item_categories/equipment")).not.toBe("itemCategoryNames./item_categories/equipment");
    });

    it("uses the provided item category fallback for unknown categories", () => {
        const { getItemCategoryName } = useGameDataText();

        expect(getItemCategoryName("/item_categories/custom_unknown", "Custom Category")).toBe("Custom Category");
    });
});

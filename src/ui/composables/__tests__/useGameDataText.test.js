import { beforeEach, describe, expect, it, vi } from "vitest";

let mockTranslations = {};

vi.mock("../useI18nText.js", () => ({
    useI18nText: () => ({
        t(key, fallback = "", options = {}) {
            const languageKey = options.lng ? `${options.lng}:${key}` : "";
            if (languageKey && Object.prototype.hasOwnProperty.call(mockTranslations, languageKey)) {
                return mockTranslations[languageKey];
            }
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
        const { getAbilityDescription, getAbilityName, getActionName, getBuffTypeName, getCombatStatName, getEquipmentSlotName, getEquipmentTypeName, getGuildShrineName, getItemName, getMonsterName, getSkillName, getItemCategoryName } = useGameDataText();

        expect(getAbilityName("/abilities/aqua_arrow")).toBe("Aqua Arrow");
        expect(getAbilityDescription("/abilities/aqua_arrow")).toBe("Shoots an arrow made of water at the targeted enemy");
        expect(getActionName("/actions/alchemy/coinify")).toBe("Coinify");
        expect(getBuffTypeName("/buff_types/wisdom")).toBe("Wisdom");
        expect(getCombatStatName("retaliation", "Retaliation")).toBe("Retaliation");
        expect(getEquipmentTypeName("/equipment_types/pouch", "Pouch")).toBe("Pouch");
        expect(getEquipmentSlotName("weapon", "Main Hand")).toBe("Main Hand");
        expect(getGuildShrineName("/guild_shrines/force")).toBe("Shrine of Force");
        expect(getItemName("/items/gatherer_cape")).toBe("Gatherer Cape");
        expect(getMonsterName("/monsters/abyssal_imp")).toBe("Abyssal Imp");
        expect(getSkillName("/skills/attack")).toBe("Attack");
        expect(getSkillName("attack")).toBe("Attack");
        expect(getItemCategoryName("/item_categories/equipment")).toBe("Equipment");
    });

    it("prefers translated labels when the current language provides them", () => {
        mockTranslations = {
            "translation:abilityNames./abilities/aqua_arrow": "流水箭",
            "translation:abilityDescriptions./abilities/aqua_arrow": "向目标敌人射出水箭",
            "translation:buffTypeNames./buff_types/wisdom": "智慧",
            "translation:combatStats.retaliation": "反伤",
            "translation:equipmentTypeNames./equipment_types/main_hand": "主手",
            "translation:equipmentTypeNames./equipment_types/pouch": "袋子",
            "translation:equipmentTypeNames./equipment_types/two_hand": "双手",
            "translation:guildShrineNames./guild_shrines/force": "力量神龛",
            "translation:itemNames./items/gatherer_cape": "采集者披风",
            "translation:skillNames./skills/attack": "攻击",
            "translation:itemCategoryNames./item_categories/equipment": "装备",
        };

        const { getAbilityDescription, getAbilityName, getBuffTypeName, getCombatStatName, getEquipmentSlotName, getEquipmentTypeName, getGuildShrineName, getItemName, getSkillName, getItemCategoryName } = useGameDataText();

        expect(getAbilityName("/abilities/aqua_arrow")).toBe("流水箭");
        expect(getAbilityDescription("/abilities/aqua_arrow")).toBe("向目标敌人射出水箭");
        expect(getBuffTypeName("/buff_types/wisdom")).toBe("智慧");
        expect(getCombatStatName("retaliation")).toBe("反伤");
        expect(getEquipmentTypeName("/equipment_types/pouch")).toBe("袋子");
        expect(getEquipmentSlotName("weapon")).toBe("主手");
        expect(getEquipmentSlotName("two_hand")).toBe("双手");
        expect(getGuildShrineName("/guild_shrines/force")).toBe("力量神龛");
        expect(getItemName("/items/gatherer_cape")).toBe("采集者披风");
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
        const { getAbilityDescription, getAbilityName, getItemCategoryName } = useGameDataText();

        expect(getItemCategoryName("/item_categories/custom_unknown", "Custom Category")).toBe("Custom Category");
        expect(getAbilityName("/abilities/unknown_custom")).toBe("/abilities/unknown_custom");
        expect(getAbilityName("/abilities/unknown_custom", "Custom Ability")).toBe("Custom Ability");
        expect(getAbilityDescription("/abilities/unknown_custom")).toBe("");
        expect(getAbilityDescription("/abilities/unknown_custom", "Custom Description")).toBe("Custom Description");
    });

    it("can resolve the official English item name independently of the active language", () => {
        mockTranslations = {
            "translation:itemNames./items/gatherer_cape": "采集者披风",
            "en:translation:itemNames./items/gatherer_cape": "Gatherer Cape",
            "zh:translation:itemNames./items/gatherer_cape": "采集者披风",
        };
        const { getOfficialGameText } = useGameDataText();

        expect(getOfficialGameText("itemNames", "/items/gatherer_cape")).toBe("采集者披风");
        expect(getOfficialGameText("itemNames", "/items/gatherer_cape", "", { language: "zh" })).toBe("采集者披风");
        expect(getOfficialGameText("itemNames", "/items/gatherer_cape", "", { language: "en" })).toBe("Gatherer Cape");
    });
});

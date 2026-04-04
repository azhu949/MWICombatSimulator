import { describe, expect, it } from "vitest";
import { EQUIPMENT_SLOT_KEYS, createEmptyPlayerConfig } from "../../shared/playerConfig.js";
import { buildStaticPriceCatalog, createCombatPreviewPlayerConfig } from "../pageOptimizationHelpers.js";

function cloneValue(value) {
    return JSON.parse(JSON.stringify(value));
}

describe("pageOptimizationHelpers", () => {
    it("creates a combat preview config that ignores unrelated player fields", () => {
        const basePlayer = createEmptyPlayerConfig("1");
        const firstEquipmentSlot = EQUIPMENT_SLOT_KEYS[0];
        basePlayer.levels.attack = 99;
        basePlayer.food[0] = "/items/basic_food";
        basePlayer.drinks[0] = "/items/basic_drink";
        basePlayer.abilities[0] = { abilityHrid: "/abilities/punch", level: 80 };
        basePlayer.triggerMap = {
            "/abilities/punch": [
                {
                    dependencyHrid: "/trigger_dependencies/current_hp",
                    conditionHrid: "/trigger_conditions/number",
                    comparatorHrid: "/trigger_comparators/less_than",
                    value: 50,
                },
            ],
        };
        basePlayer.houseRooms["/house_rooms/kitchen"] = 3;
        basePlayer.achievements["/achievements/total_level_100"] = true;
        if (firstEquipmentSlot) {
            basePlayer.equipment[firstEquipmentSlot] = {
                itemHrid: "/items/training_sword",
                enhancementLevel: 7,
            };
        }

        const left = {
            ...cloneValue(basePlayer),
            name: "Left",
            selected: false,
            skillExperience: {
                attack: 123456,
            },
        };
        const right = {
            ...cloneValue(basePlayer),
            name: "Right",
            selected: true,
            skillExperience: {
                attack: 1,
            },
        };

        expect(createCombatPreviewPlayerConfig(left)).toEqual(createCombatPreviewPlayerConfig(right));
        expect(createCombatPreviewPlayerConfig(left)).toEqual(expect.objectContaining({
            id: "1",
            selected: true,
        }));
    });

    it("builds a stable static price catalog from item details", () => {
        const catalog = buildStaticPriceCatalog(
            {
                knownA: {
                    hrid: "/items/alpha",
                    categoryHrid: "/item_categories/armor",
                    name: "Alpha Armor",
                },
                duplicate: {
                    hrid: "/items/alpha",
                    categoryHrid: "/item_categories/armor",
                    name: "Alpha Duplicate",
                },
                knownB: {
                    hrid: "/items/zulu",
                    categoryHrid: "/item_categories/weapons",
                    name: "Zulu Blade",
                },
            },
            {
                formatPriceCategoryName: (categoryHrid) => (
                    categoryHrid === "/item_categories/armor" ? "Armor" : "Weapons"
                ),
                formatPriceItemName: (itemHrid, fallbackName) => `${fallbackName}:${itemHrid}`,
            },
        );

        expect(catalog).toEqual([
            {
                hrid: "/items/alpha",
                categoryHrid: "/item_categories/armor",
                categoryName: "Armor",
                name: "Alpha Armor:/items/alpha",
            },
            {
                hrid: "/items/zulu",
                categoryHrid: "/item_categories/weapons",
                categoryName: "Weapons",
                name: "Zulu Blade:/items/zulu",
            },
        ]);
    });

    it("preserves legacy trinket metadata for combat preview consumers", () => {
        const player = createEmptyPlayerConfig("1");
        player.equipment.trinket = {
            itemHrid: "/items/expert_task_badge",
            enhancementLevel: 3,
        };

        const previewConfig = createCombatPreviewPlayerConfig(player);

        expect(previewConfig.equipment.trinket).toEqual({
            itemHrid: "/items/expert_task_badge",
            enhancementLevel: 3,
        });
    });
});

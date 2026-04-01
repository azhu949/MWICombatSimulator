import { describe, expect, it } from "vitest";
import {
    EQUIPMENT_SLOT_KEYS,
    equipmentOptionsBySlot,
    getAbilityName,
    getItemName,
    getSortedHouseRoomOptions,
    itemDetailIndex,
    labyrinthCrateOptions,
    levelExperienceTable,
} from "../gameDataIndex.js";

describe("gameDataIndex", () => {
    it("returns stable item and ability labels", () => {
        expect(typeof getItemName("/items/basic_food")).toBe("string");
        expect(typeof getAbilityName("/abilities/mystic_aura")).toBe("string");
    });

    it("exposes sorted house room options and item summaries", () => {
        const rooms = getSortedHouseRoomOptions();

        expect(Array.isArray(rooms)).toBe(true);
        expect(rooms.length).toBeGreaterThan(0);
        expect(rooms[0]).toHaveProperty("hrid");
        expect(rooms[0]).toHaveProperty("name");

        expect(itemDetailIndex["/items/coin"]).toMatchObject({
            hrid: "/items/coin",
            name: "Coin",
        });
    });

    it("includes coffee, food, and tea labyrinth crate options", () => {
        expect(labyrinthCrateOptions.coffee.map((item) => item.hrid)).toEqual([
            "/items/basic_coffee_crate",
            "/items/advanced_coffee_crate",
            "/items/expert_coffee_crate",
        ]);
        expect(labyrinthCrateOptions.food.map((item) => item.hrid)).toEqual([
            "/items/basic_food_crate",
            "/items/advanced_food_crate",
            "/items/expert_food_crate",
        ]);
        expect(labyrinthCrateOptions.tea.map((item) => item.hrid)).toEqual([
            "/items/basic_tea_crate",
            "/items/advanced_tea_crate",
            "/items/expert_tea_crate",
        ]);
    });

    it("exposes level experience thresholds", () => {
        expect(Array.isArray(levelExperienceTable)).toBe(true);
        expect(levelExperienceTable[1]).toBe(0);
        expect(levelExperienceTable[2]).toBe(33);
    });

    it("does not expose trinket equipment options in combat simulator slots", () => {
        expect(EQUIPMENT_SLOT_KEYS).not.toContain("trinket");
        expect(equipmentOptionsBySlot.trinket).toBeUndefined();
    });
});

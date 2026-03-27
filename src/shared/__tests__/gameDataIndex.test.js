import { describe, expect, it } from "vitest";
import {
    getAbilityName,
    getItemName,
    getSortedHouseRoomOptions,
    itemDetailIndex,
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
});

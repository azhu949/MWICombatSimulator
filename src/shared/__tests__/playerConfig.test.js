import { describe, expect, it } from "vitest";
import { houseRoomHrids } from "../gameDataIndex.js";
import { ensurePlayerAdvancedState } from "../playerConfig.js";

describe("player config normalization", () => {
    it("keeps only known house rooms and normalizes their levels", () => {
        const knownRoomHrid = houseRoomHrids[0];
        const unknownRoomHrid = "/house_rooms/removed_or_misspelled";
        const player = {
            houseRooms: {
                [knownRoomHrid]: "3.9",
                [unknownRoomHrid]: 7,
            },
        };

        ensurePlayerAdvancedState(player);

        expect(player.houseRooms[knownRoomHrid]).toBe(3);
        expect(player.houseRooms).not.toHaveProperty(unknownRoomHrid);
        expect(Object.keys(player.houseRooms)).toEqual(houseRoomHrids);
    });
});

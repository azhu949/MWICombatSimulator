import { describe, expect, it } from "vitest";
import { skillingData } from "../../shared/gameDataIndex.js";
import { buildMainSiteSkillingImport, normalizeSkillingProfile } from "../skillingImportMapper.js";

describe("skillingImportMapper", () => {
    it("normalizes skills, inventory, equipment instances, and buff sources", () => {
        const result = buildMainSiteSkillingImport({
            character: { name: "Workshop Hero" },
            characterSkills: [
                { skillHrid: "/skills/brewing", level: 17, experience: 2200 },
                { skillHrid: "/skills/crafting", level: 30, experience: 11814 },
            ],
            characterItems: [
                { hash: "beans", itemHrid: "/items/robusta_coffee_bean", itemLocationHrid: "/item_locations/inventory", count: 25 },
                { hash: "tool", itemHrid: "/items/cheese_pot", itemLocationHrid: "/item_locations/brewing_tool", enhancementLevel: 3, count: 1 },
                { currentItem: { hash: "neck", itemHrid: "/items/necklace_of_wisdom", itemLocationHrid: "/item_locations/inventory", enhancementLevel: 7, count: 1 } },
                { hash: "refine", itemHrid: "/items/anchorbound_plate_body", itemLocationHrid: "/item_locations/inventory", enhancementLevel: 12, count: 1 },
                { hash: "listed", itemHrid: "/items/cheese_pot", itemLocationHrid: "/item_locations/market", enhancementLevel: 20, count: 1 },
            ],
            houseActionTypeBuffsMap: {
                "/action_types/brewing": [{ typeHrid: "/buff_types/efficiency", flatBoost: 0.03 }],
            },
            communityActionTypeBuffsMap: {
                "/action_types/brewing": [{ typeHrid: "/buff_types/wisdom", flatBoost: 0.04 }],
            },
            personalActionTypeBuffsMap: {
                "/action_types/brewing": [{
                    buff: { typeHrid: "/buff_types/rare_find", flatBoost: 0.05 },
                    startTime: "2026-01-01T00:00:00Z",
                    duration: 1_000_000_000,
                }],
            },
            actionTypeDrinkSlotsMap: {
                "/action_types/brewing": [{
                    slotIndex: 0,
                    itemHrid: "/items/ultra_brewing_tea",
                    isActive: true,
                    duration: 300,
                }],
            },
            characterGuildBuffMap: {
                "/guild_buffs/force_skilling": 5,
            },
            guildBuildingLevelMap: {
                "/guild_shrines/force": 3,
            },
        }, 1234);

        expect(result.detectedFormat).toBe("main-site-skilling-character");
        expect(result.profile.characterName).toBe("Workshop Hero");
        expect(result.profile.importedAt).toBe(1234);
        expect(result.profile.skills["/skills/brewing"]).toEqual({ level: 17, experience: 2200 });
        expect(result.profile.skills["/skills/total_level"].level).toBe(47);
        expect(result.profile.inventory["/items/robusta_coffee_bean"]).toBe(25);
        expect(result.profile.inventory["/items/necklace_of_wisdom"]).toBe(1);
        expect(result.profile.inventory["/items/cheese_pot"]).toBeUndefined();
        expect(result.profile.equipment).toEqual(expect.arrayContaining([
            expect.objectContaining({ itemHrid: "/items/cheese_pot", enhancementLevel: 3, isEquipped: true }),
            expect.objectContaining({ itemHrid: "/items/necklace_of_wisdom", enhancementLevel: 7, isEquipped: false }),
            expect.objectContaining({ itemHrid: "/items/anchorbound_plate_body", enhancementLevel: 12, isEquipped: false }),
        ]));
        expect(result.profile.equipment.some((item) => item.id === "listed")).toBe(false);
        expect(result.profile.buffsBySource.house["/action_types/brewing"][0]).toMatchObject({
            typeHrid: "/buff_types/efficiency",
            flatBoost: 0.03,
        });
        expect(result.profile.buffsBySource.personal["/action_types/brewing"][0]).toMatchObject({
            typeHrid: "/buff_types/rare_find",
            flatBoost: 0.05,
            startTime: "2026-01-01T00:00:00Z",
            duration: 1_000_000_000,
        });
        expect(result.profile.buffsBySource.guild["/action_types/brewing"][0]).toMatchObject({
            uniqueHrid: "/buff_uniques/efficiency_guild_buff",
            typeHrid: "/buff_types/efficiency",
            flatBoost: 0.015,
        });
        expect(result.profile.drinkSlotsByActionType["/action_types/brewing"]).toEqual([{
            slotIndex: 0,
            itemHrid: "/items/ultra_brewing_tea",
            isActive: true,
        }]);
        expect(result.importedSections).toContain("drinkSlots");
    });

    it("rejects shareable profiles that do not contain the current inventory", () => {
        expect(() => buildMainSiteSkillingImport({
            profile: {
                sharableCharacter: { name: "Shared" },
                characterSkills: [{ skillHrid: "/skills/brewing", level: 10 }],
            },
        })).toThrow(/current-character skilling data/i);
    });

    it("keeps legacy string drink slots with an unknown active state", () => {
        const profile = normalizeSkillingProfile({
            actionTypeDrinkSlotsMap: {
                "/action_types/brewing": ["/items/brewing_tea", ""],
            },
        });

        expect(profile.drinkSlotsByActionType["/action_types/brewing"]).toEqual([{
            slotIndex: 0,
            itemHrid: "/items/brewing_tea",
            isActive: null,
        }]);
    });

    it("keeps malformed optional collections empty", () => {
        const profile = normalizeSkillingProfile({ characterSkills: null, characterItems: null });
        expect(profile.inventory).toEqual({});
        expect(profile.equipment).toEqual([]);
        expect(profile.buffsBySource.mooPass).toEqual({});
        expect(profile.drinkSlotsByActionType).toEqual({});
        expect(profile.buffsBySource.guild).toEqual(Object.fromEntries(
            skillingData.actionTypeHrids.map((actionTypeHrid) => [actionTypeHrid, []]),
        ));
    });
});

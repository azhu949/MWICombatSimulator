import { describe, expect, it, vi } from "vitest";
import achievementDetailMap from "../../combatsimulator/data/achievementDetailMap.json";
import {
    buildMainSiteEnhancementImport,
    mapMainSiteEnhancementConfig,
} from "../enhancementImportMapper.js";
import { applyTampermonkeyEnhancementImportMessage } from "../tampermonkeyImportBridge.js";

function createCurrentConfig() {
    return {
        itemHrid: "/items/chance_cape",
        targetLevel: 12,
        laborRatePerHour: 123,
        equipmentSlots: {
            enhancing_tool: { itemHrid: "/items/cheese_enhancer", enhancementLevel: 1 },
            hands: { itemHrid: "/items/enchanted_gloves", enhancementLevel: 2 },
            body: { itemHrid: "", enhancementLevel: 0 },
            legs: { itemHrid: "", enhancementLevel: 0 },
            pouch: { itemHrid: "", enhancementLevel: 0 },
            neck: { itemHrid: "", enhancementLevel: 0 },
            back: { itemHrid: "", enhancementLevel: 0 },
            charm: { itemHrid: "", enhancementLevel: 0 },
        },
    };
}

describe("enhancementImportMapper", () => {
    it("maps current main-site character bonuses into enhancement configuration", () => {
        const payload = {
            character: { name: "Enhancing Hero" },
            characterSkills: [
                { skillHrid: "/skills/enhancing", level: 137 },
            ],
            characterItems: [
                {
                    hash: "tool",
                    itemLocationHrid: "/item_locations/enhancing_tool",
                    itemHrid: "/items/celestial_enhancer",
                    enhancementLevel: 4,
                    count: 1,
                },
                {
                    hash: "body",
                    itemLocationHrid: "/item_locations/inventory",
                    itemHrid: "/items/enhancers_top",
                    enhancementLevel: 3,
                    count: 1,
                },
                {
                    hash: "inventory-cape",
                    itemLocationHrid: "/item_locations/inventory",
                    itemHrid: "/items/chance_cape",
                    enhancementLevel: 9,
                    count: 1,
                },
                {
                    hash: "inventory-wisdom-necklace",
                    itemLocationHrid: "/item_locations/inventory",
                    itemHrid: "/items/necklace_of_wisdom",
                    enhancementLevel: 10,
                    count: 1,
                },
                {
                    hash: "inventory-philosophers-necklace",
                    itemLocationHrid: "/item_locations/inventory",
                    itemHrid: "/items/philosophers_necklace",
                    enhancementLevel: 0,
                    count: 1,
                },
            ],
            actionTypeDrinkSlotsMap: {
                "/action_types/enhancing": [
                    "/items/ultra_enhancing_tea",
                    { itemHrid: "/items/blessed_tea" },
                    "/items/wisdom_tea",
                ],
            },
            characterHouseRoomMap: {
                observatory: { houseRoomHrid: "/house_rooms/observatory", level: 6 },
                garden: { houseRoomHrid: "/house_rooms/garden", level: 4 },
                library: { houseRoomHrid: "/house_rooms/library", level: 3 },
            },
            communityBuffs: [
                { hrid: "/community_buff_types/enhancing_speed", level: 12 },
                { communityBuffTypeHrid: "/community_buff_types/experience", level: 9 },
            ],
            achievementActionTypeBuffsMap: {
                "/action_types/enhancing": [
                    { uniqueHrid: "/buff_uniques/achievement_champion_enhancing_success" },
                    { nested: { uniqueHrid: "/buff_uniques/achievement_novice_experience" } },
                ],
            },
        };

        const result = buildMainSiteEnhancementImport(payload, createCurrentConfig());

        expect(result.characterName).toBe("Enhancing Hero");
        expect(result.importedSections).toEqual([
            "skill",
            "equipment",
            "drinks",
            "housing",
            "community",
            "achievements",
        ]);
        expect(result.configPatch).toMatchObject({
            skillLevel: 137,
            observatoryLevel: 6,
            otherRoomLevels: 7,
            communityEnhancingLevel: 12,
            communityExperienceLevel: 9,
            noviceAchievement: true,
            championAchievement: true,
            teaHrid: "/items/ultra_enhancing_tea",
            blessedTea: true,
            wisdomTea: true,
        });
        expect(result.configPatch.equipmentSlots.enhancing_tool).toEqual({
            itemHrid: "/items/celestial_enhancer",
            enhancementLevel: 4,
        });
        expect(result.configPatch.equipmentSlots.body).toEqual({
            itemHrid: "/items/enhancers_top",
            enhancementLevel: 3,
        });
        expect(result.configPatch.equipmentSlots.back).toEqual({
            itemHrid: "/items/chance_cape",
            enhancementLevel: 9,
        });
        expect(result.configPatch.equipmentSlots.neck).toEqual({
            itemHrid: "/items/philosophers_necklace",
            enhancementLevel: 0,
        });
    });

    it("prefers equipped enhancement gear over higher-tier inventory alternatives", () => {
        const patch = mapMainSiteEnhancementConfig({
            characterItems: [
                {
                    hash: "equipped-necklace",
                    itemLocationHrid: "/item_locations/neck",
                    itemHrid: "/items/necklace_of_wisdom",
                    enhancementLevel: 2,
                    count: 1,
                },
                {
                    hash: "inventory-necklace",
                    itemLocationHrid: "/item_locations/inventory",
                    itemHrid: "/items/philosophers_necklace",
                    enhancementLevel: 10,
                    count: 1,
                },
            ],
        }, createCurrentConfig());

        expect(patch.equipmentSlots.neck).toEqual({
            itemHrid: "/items/necklace_of_wisdom",
            enhancementLevel: 2,
        });
    });

    it("clears previously selected character bonuses when the main-site fields are explicitly empty", () => {
        const patch = mapMainSiteEnhancementConfig({
            characterItems: [],
            actionTypeDrinkSlotsMap: {
                "/action_types/enhancing": [],
            },
            characterHouseRoomMap: {},
            communityBuffs: [],
            achievementActionTypeBuffsMap: {},
        }, createCurrentConfig());

        expect(patch.equipmentSlots.enhancing_tool).toEqual({ itemHrid: "", enhancementLevel: 0 });
        expect(patch.equipmentSlots.hands).toEqual({ itemHrid: "", enhancementLevel: 0 });
        expect(patch).toMatchObject({
            teaHrid: "",
            blessedTea: false,
            wisdomTea: false,
            observatoryLevel: 0,
            otherRoomLevels: 0,
            communityEnhancingLevel: 0,
            communityExperienceLevel: 0,
            noviceAchievement: false,
            championAchievement: false,
        });
    });

    it("falls back to completed achievement tiers when the server buff map is unavailable", () => {
        const tierAchievements = Object.values(achievementDetailMap)
            .filter((achievement) => (
                achievement.tierHrid === "/achievement_tiers/novice"
                || achievement.tierHrid === "/achievement_tiers/champion"
            ))
            .map((achievement) => ({
                achievementHrid: achievement.hrid,
                isCompleted: true,
            }));

        const completePatch = mapMainSiteEnhancementConfig({
            characterAchievements: tierAchievements,
        });
        expect(completePatch.noviceAchievement).toBe(true);
        expect(completePatch.championAchievement).toBe(true);

        const completeWithUnknownServerMap = mapMainSiteEnhancementConfig({
            characterAchievements: tierAchievements,
            achievementActionTypeBuffsMap: {},
        });
        expect(completeWithUnknownServerMap.noviceAchievement).toBe(true);
        expect(completeWithUnknownServerMap.championAchievement).toBe(true);

        const incompleteChampion = tierAchievements.filter((entry) => (
            entry.achievementHrid !== "/achievements/enhance_level_90_to_10"
        ));
        const incompletePatch = mapMainSiteEnhancementConfig({
            characterAchievements: incompleteChampion,
        });
        expect(incompletePatch.noviceAchievement).toBe(true);
        expect(incompletePatch.championAchievement).toBe(false);
    });

    it("applies only the imported character setup through the Tampermonkey bridge", () => {
        const enhancement = {
            config: createCurrentConfig(),
            patchConfig: vi.fn(function patchConfig(patch) {
                Object.assign(this.config, patch);
            }),
        };

        const result = applyTampermonkeyEnhancementImportMessage(enhancement, {
            payload: {
                character: { name: "Bridge Hero" },
                characterSkills: [{ skillHrid: "/skills/enhancing", level: 155 }],
                communityBuffs: [],
            },
        });

        expect(result.detectedFormat).toBe("main-site-enhancement-character");
        expect(result.message).toContain("Bridge Hero");
        expect(enhancement.patchConfig).toHaveBeenCalledTimes(1);
        expect(enhancement.config.skillLevel).toBe(155);
        expect(enhancement.config.itemHrid).toBe("/items/chance_cape");
        expect(enhancement.config.targetLevel).toBe(12);
        expect(enhancement.config.laborRatePerHour).toBe(123);
    });
});

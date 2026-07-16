import { describe, expect, it } from "vitest";
import {
    buffTypeDetailIndex,
    EQUIPMENT_SLOT_KEYS,
    equipmentOptionsBySlot,
    enhancementData,
    getAbilityName,
    getBuffTypeName,
    getItemName,
    getItemCategoryName,
    getSkillName,
    getSortedHouseRoomOptions,
    itemDetailIndex,
    itemCategoryDetailIndex,
    labyrinthCrateOptions,
    levelExperienceTable,
    skillDetailIndex,
    skillingData,
} from "../gameDataIndex.js";

describe("gameDataIndex", () => {
    it("returns stable item and ability labels", () => {
        expect(typeof getItemName("/items/basic_food")).toBe("string");
        expect(typeof getAbilityName("/abilities/mystic_aura")).toBe("string");
    });

    it("exposes buff, skill, and item category labels from official detail maps", () => {
        expect(buffTypeDetailIndex["/buff_types/wisdom"]).toMatchObject({
            hrid: "/buff_types/wisdom",
            name: "Wisdom",
        });
        expect(skillDetailIndex["/skills/attack"]).toMatchObject({
            hrid: "/skills/attack",
            name: "Attack",
        });
        expect(itemCategoryDetailIndex["/item_categories/equipment"]).toMatchObject({
            hrid: "/item_categories/equipment",
            name: "Equipment",
        });

        expect(getBuffTypeName("/buff_types/wisdom")).toBe("Wisdom");
        expect(getSkillName("/skills/attack")).toBe("Attack");
        expect(getSkillName("attack")).toBe("Attack");
        expect(getItemCategoryName("/item_categories/equipment")).toBe("Equipment");
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

    it("exposes a compact read-only enhancement data index", () => {
        expect(Object.isFrozen(enhancementData)).toBe(true);
        expect(Object.isFrozen(enhancementData.enhanceableItems)).toBe(true);
        expect(Object.isFrozen(enhancementData.enhanceableItems[0])).toBe(true);
        expect(enhancementData.successRates).toHaveLength(20);
        expect(enhancementData.successRates[0]).toBe(0.5);
        expect(enhancementData.successRates[19]).toBe(0.3);
        expect(enhancementData.totalBonusMultipliers).toHaveLength(21);
        expect(enhancementData.totalBonusMultipliers[20]).toBe(50);
        expect(enhancementData.actionBaseSeconds).toBe(12);

        const enchantedGloves = enhancementData.enhanceableItems.find(
            (item) => item.hrid === "/items/enchanted_gloves",
        );
        expect(enchantedGloves).toMatchObject({
            itemLevel: 60,
            equipmentType: "/equipment_types/hands",
        });
        expect(enchantedGloves.enhancementCosts).toContainEqual({
            itemHrid: "/items/coin",
            count: 319,
        });
        expect(enchantedGloves.protectionItemHrids).toContain("/items/chrono_sphere");

        expect(enhancementData.materialItems.some((item) => item.hrid === "/items/coin")).toBe(true);
        expect(enhancementData.materialItems.some(
            (item) => item.hrid === enhancementData.specialItemHrids.philosophersMirror,
        )).toBe(true);
        expect(enhancementData.protectionItems.some(
            (item) => item.hrid === enhancementData.specialItemHrids.mirrorOfProtection,
        )).toBe(true);
    });

    it("includes data-driven enhancement equipment, drinks, and external buffs", () => {
        const celestialEnhancer = enhancementData.supportEquipment.find(
            (item) => item.hrid === "/items/celestial_enhancer",
        );
        expect(celestialEnhancer.noncombatStats).toMatchObject({
            enhancingSuccess: 0.042,
            enhancingExperience: 0.04,
        });
        expect(celestialEnhancer.noncombatEnhancementBonuses.enhancingSuccess).toBeCloseTo(0.00084);
        expect(enhancementData.supportEquipment.some(
            (item) => item.hrid === "/items/philosophers_necklace",
        )).toBe(true);
        expect(enhancementData.supportEquipment.find(
            (item) => item.hrid === "/items/guzzling_pouch",
        )).toMatchObject({
            noncombatStats: { drinkConcentration: 0.1 },
            noncombatEnhancementBonuses: { drinkConcentration: 0.002 },
        });

        const drinkHrids = enhancementData.enhancingDrinks.map((item) => item.hrid);
        expect(drinkHrids).toEqual(expect.arrayContaining([
            "/items/enhancing_tea",
            "/items/super_enhancing_tea",
            "/items/ultra_enhancing_tea",
            "/items/blessed_tea",
            "/items/wisdom_tea",
        ]));
        expect(enhancementData.enhancingDrinks.find(
            (item) => item.hrid === "/items/enhancing_tea",
        )).toMatchObject({ durationSeconds: 300 });

        expect(enhancementData.housing.observatory.actionBuffs.map((buff) => buff.typeHrid)).toEqual(
            expect.arrayContaining(["/buff_types/action_speed", "/buff_types/enhancing_success"]),
        );
        expect(enhancementData.housing.globalExperience.roomHrids).toContain("/house_rooms/observatory");
        expect(enhancementData.housing.globalExperience.buff).toMatchObject({
            typeHrid: "/buff_types/wisdom",
            flatBoost: 0.0005,
            flatBoostLevelBonus: 0.0005,
        });

        expect(enhancementData.communityBuffs.map((entry) => entry.hrid)).toEqual([
            "/community_buff_types/experience",
            "/community_buff_types/enhancing_speed",
        ]);
        expect(enhancementData.achievementBuffs.map((entry) => entry.hrid)).toEqual([
            "/achievement_tiers/novice",
            "/achievement_tiers/champion",
        ]);
    });

    it("indexes dungeon chest acquisition paths for non-tradable enhancement items", () => {
        expect(Object.isFrozen(enhancementData.acquisition)).toBe(true);
        expect(enhancementData.acquisition.sourcesByItemHrid["/items/enchanted_cloak"]).toContainEqual(
            expect.objectContaining({
                type: "dungeon_openable",
                actionHrid: "/actions/combat/enchanted_fortress",
                entryKeyItemHrid: "/items/enchanted_entry_key",
                containerHrid: "/items/enchanted_chest",
                containerDropRate: 1,
                itemDrops: [expect.objectContaining({
                    itemHrid: "/items/enchanted_cloak",
                    dropRate: 0.04,
                    minCount: 1,
                    maxCount: 1,
                })],
            }),
        );
        expect(enhancementData.acquisition.openablesByHrid["/items/enchanted_chest"]).toMatchObject({
            openKeyItemHrid: "/items/enchanted_chest_key",
            drops: expect.arrayContaining([
                expect.objectContaining({ itemHrid: "/items/enchanted_chest_key", dropRate: 0.02 }),
                expect.objectContaining({ itemHrid: "/items/enchanted_cloak", dropRate: 0.04 }),
            ]),
        });
        expect(enhancementData.acquisition.sourcesByItemHrid["/items/chimerical_quiver"]).toBeDefined();
        expect(enhancementData.acquisition.sourcesByItemHrid["/items/sinister_cape"]).toBeDefined();
    });

    it("exposes compact gathering and production actions, equipment, and drinks", () => {
        expect(Object.isFrozen(skillingData)).toBe(true);
        expect(skillingData.skillHrids).toEqual([
            "/skills/foraging",
            "/skills/brewing",
            "/skills/cheesesmithing",
            "/skills/cooking",
            "/skills/crafting",
            "/skills/tailoring",
        ]);
        expect(skillingData.actions).toHaveLength(680);
        expect(skillingData.actions.find((action) => action.hrid === "/actions/foraging/egg")).toMatchObject({
            baseTimeSeconds: 6,
            levelRequirement: { skillHrid: "/skills/foraging", level: 1 },
            experienceGain: { skillHrid: "/skills/foraging", value: 5 },
            dropTable: [{ itemHrid: "/items/egg", dropRate: 1, minCount: 1, maxCount: 6 }],
        });
        expect(skillingData.actions.find((action) => action.hrid === "/actions/brewing/alchemy_tea")).toMatchObject({
            baseTimeSeconds: 9,
            levelRequirement: { skillHrid: "/skills/brewing", level: 17 },
            experienceGain: { skillHrid: "/skills/brewing", value: 21 },
            outputItems: [{ itemHrid: "/items/alchemy_tea", count: 1 }],
        });
        expect(skillingData.actions.find(
            (action) => action.hrid === "/actions/tailoring/artificer_cape_refined",
        )).toMatchObject({
            upgradeItemHrid: "/items/artificer_cape",
            retainAllEnhancement: true,
        });
        expect(skillingData.equipment.find((item) => item.hrid === "/items/guzzling_pouch")).toMatchObject({
            equipmentType: "/equipment_types/pouch",
            drinkSlots: 2,
            noncombatStats: { drinkConcentration: 0.1 },
        });
        expect(skillingData.equipmentItemHrids).toContain("/items/anchorbound_plate_body");
        expect(skillingData.equipment.find((item) => item.hrid === "/items/ring_of_gathering")).toMatchObject({
            equipmentType: "/equipment_types/ring",
            noncombatStats: { gatheringQuantity: 0.02 },
        });
        expect(skillingData.drinks.find((item) => item.hrid === "/items/gathering_tea")).toMatchObject({
            usableInActionTypeMap: { "/action_types/foraging": true },
            buffs: [expect.objectContaining({ typeHrid: "/buff_types/gathering", flatBoost: 0.15 })],
        });
        expect(skillingData.drinks.find((item) => item.hrid === "/items/artisan_tea")).toMatchObject({
            durationSeconds: 300,
            usableInActionTypeMap: { "/action_types/crafting": true },
        });
        expect(skillingData.totalBonusMultipliers[20]).toBe(50);
    });
});

import { describe, expect, it } from "vitest";
import actionDetailMap from "../../combatsimulator/data/actionDetailMap.json";
import abilityDetailMap from "../../combatsimulator/data/abilityDetailMap.json";
import itemDetailMap from "../../combatsimulator/data/itemDetailMap.json";
import { createEmptyPlayerConfig } from "../playerMapper.js";
import {
    createLegacySoloPayload,
    exportGroupConfig,
    importGroupConfig,
    importSoloConfig,
} from "../importExportMapper.js";
import { createMainSiteShareProfileFixture } from "./fixtures/mainSiteShareProfileFixture.js";

function createSimulationSettings() {
    return {
        mode: "zone",
        runScope: "single",
        useDungeon: false,
        zoneHrid: "/actions/combat/fly",
        dungeonHrid: "",
        difficultyTier: 1,
        labyrinthHrid: "",
        roomLevel: 100,
        simulationTimeHours: 24,
        mooPass: false,
        comExpEnabled: false,
        comExp: 1,
        comDropEnabled: false,
        comDrop: 1,
        enableHpMpVisualization: true,
    };
}

function findFirstEquipmentItemByType(equipmentTypeHrid) {
    const item = Object.values(itemDetailMap).find((entry) => (
        entry?.categoryHrid === "/item_categories/equipment"
        && String(entry?.equipmentDetail?.type || "") === equipmentTypeHrid
    ));
    return item?.hrid ?? "";
}

function findFirstFoodWithDefaultTriggers() {
    const item = Object.values(itemDetailMap).find((entry) => (
        entry?.categoryHrid === "/item_categories/food"
        && Array.isArray(entry?.consumableDetail?.defaultCombatTriggers)
        && entry.consumableDetail.defaultCombatTriggers.length > 0
    ));
    return item?.hrid ?? "";
}

function findFirstDrinkWithDefaultTriggers() {
    const item = Object.values(itemDetailMap).find((entry) => (
        entry?.categoryHrid === "/item_categories/drink"
        && Array.isArray(entry?.consumableDetail?.defaultCombatTriggers)
        && entry.consumableDetail.defaultCombatTriggers.length > 0
    ));
    return item?.hrid ?? "";
}

function findFirstAbilityWithDefaultTriggers() {
    const ability = Object.values(abilityDetailMap).find((entry) => (
        !entry?.isSpecialAbility
        && Array.isArray(entry?.defaultCombatTriggers)
        && entry.defaultCombatTriggers.length > 0
    ));
    return ability?.hrid ?? "";
}

function findFirstCombatAction(isDungeon = false) {
    const action = Object.values(actionDetailMap).find((entry) => (
        String(entry?.type || "") === "/action_types/combat"
        && Boolean(entry?.combatZoneInfo?.isDungeon) === isDungeon
        && Number(entry?.maxDifficulty ?? 0) >= 0
    ));
    return action?.hrid ?? "";
}

describe("importExportMapper", () => {
    it("creates legacy solo payload", () => {
        const player = createEmptyPlayerConfig(1);
        player.levels.attack = 20;
        player.food[0] = "/items/apple";
        player.triggerMap["/items/apple"] = [];

        const payload = createLegacySoloPayload(player, createSimulationSettings());

        expect(payload.player.attackLevel).toBe(20);
        expect(payload.food["/action_types/combat"]).toHaveLength(3);
        expect(payload.abilities).toHaveLength(5);
        expect(payload.triggerMap["/items/apple"]).toEqual([]);
        expect(payload.simulationTime).toBe("24");
    });

    it("imports legacy solo payload", () => {
        const player = createEmptyPlayerConfig(2);

        const legacyPayload = {
            player: {
                attackLevel: 33,
                magicLevel: 7,
                meleeLevel: 11,
                rangedLevel: 5,
                defenseLevel: 19,
                staminaLevel: 25,
                intelligenceLevel: 13,
                equipment: [],
            },
            food: { "/action_types/combat": [{ itemHrid: "" }, { itemHrid: "" }, { itemHrid: "" }] },
            drinks: { "/action_types/combat": [{ itemHrid: "" }, { itemHrid: "" }, { itemHrid: "" }] },
            abilities: [{ abilityHrid: "", level: "1" }, { abilityHrid: "", level: "1" }, { abilityHrid: "", level: "1" }, { abilityHrid: "", level: "1" }, { abilityHrid: "", level: "1" }],
            zone: "/actions/combat/fly",
            difficulty: "2",
            simulationTime: "12",
            houseRooms: player.houseRooms,
            achievements: {},
        };

        const result = importSoloConfig(JSON.stringify(legacyPayload), player, createSimulationSettings());

        expect(result.detectedFormat).toBe("legacy-solo");
        expect(result.player.levels.attack).toBe(33);
        expect(result.simulationSettings.difficultyTier).toBe(2);
        expect(result.simulationSettings.simulationTimeHours).toBe(12);
    });

    it("imports legacy solo payload with 4 abilities into slots 2-5", () => {
        const player = createEmptyPlayerConfig(2);
        const legacyPayload = {
            player: {
                attackLevel: 1,
                magicLevel: 1,
                meleeLevel: 1,
                rangedLevel: 1,
                defenseLevel: 1,
                staminaLevel: 1,
                intelligenceLevel: 1,
                equipment: [],
            },
            food: { "/action_types/combat": [{ itemHrid: "" }, { itemHrid: "" }, { itemHrid: "" }] },
            drinks: { "/action_types/combat": [{ itemHrid: "" }, { itemHrid: "" }, { itemHrid: "" }] },
            abilities: {
                1: { abilityHrid: "/abilities/slash", level: "3" },
                2: { abilityHrid: "/abilities/quick_shot", level: "4" },
                3: { abilityHrid: "/abilities/fireball", level: "5" },
                4: { abilityHrid: "/abilities/heal", level: "6" },
            },
            zone: "/actions/combat/fly",
            difficulty: "1",
            simulationTime: "24",
            houseRooms: player.houseRooms,
            achievements: {},
        };

        const result = importSoloConfig(JSON.stringify(legacyPayload), player, createSimulationSettings());

        expect(result.detectedFormat).toBe("legacy-solo");
        expect(result.player.abilities[0].abilityHrid).toBe("");
        expect(result.player.abilities[1].abilityHrid).toBe("/abilities/slash");
        expect(result.player.abilities[1].level).toBe(3);
        expect(result.player.abilities[4].abilityHrid).toBe("/abilities/heal");
        expect(result.player.abilities[4].level).toBe(6);
    });

    it("imports legacy solo payload using ability key", () => {
        const player = createEmptyPlayerConfig(2);
        const legacyPayload = {
            player: {
                attackLevel: 1,
                magicLevel: 1,
                meleeLevel: 1,
                rangedLevel: 1,
                defenseLevel: 1,
                staminaLevel: 1,
                intelligenceLevel: 1,
                equipment: [],
            },
            food: { "/action_types/combat": [{ itemHrid: "" }, { itemHrid: "" }, { itemHrid: "" }] },
            drinks: { "/action_types/combat": [{ itemHrid: "" }, { itemHrid: "" }, { itemHrid: "" }] },
            abilities: [
                { ability: "/abilities/mystic_aura", level: "1" },
                { ability: "/abilities/slash", level: "2" },
                { ability: "/abilities/quick_shot", level: "3" },
                { ability: "/abilities/fireball", level: "4" },
                { ability: "/abilities/heal", level: "5" },
            ],
            zone: "/actions/combat/fly",
            difficulty: "1",
            simulationTime: "24",
            houseRooms: player.houseRooms,
            achievements: {},
        };

        const result = importSoloConfig(JSON.stringify(legacyPayload), player, createSimulationSettings());

        expect(result.detectedFormat).toBe("legacy-solo");
        expect(result.player.abilities[0].abilityHrid).toBe("/abilities/mystic_aura");
        expect(result.player.abilities[1].abilityHrid).toBe("/abilities/slash");
    });

    it("imports modern group payload", () => {
        const players = [1, 2, 3, 4, 5].map((id) => createEmptyPlayerConfig(id));
        const settings = createSimulationSettings();

        const exported = exportGroupConfig(players, settings, "modern");
        const parsed = JSON.parse(exported);
        parsed.players[0].name = "Edited Player";
        parsed.simulationSettings.simulationTimeHours = 6;

        const result = importGroupConfig(JSON.stringify(parsed), players, settings);

        expect(result.detectedFormat).toBe("modern-group");
        expect(result.players[0].name).toBe("Edited Player");
        expect(result.simulationSettings.simulationTimeHours).toBe(6);
    });

    it("preserves trigger map in modern payload", () => {
        const players = [1, 2, 3, 4, 5].map((id) => createEmptyPlayerConfig(id));
        const settings = createSimulationSettings();
        players[0].triggerMap["/items/apple"] = [];

        const exported = exportGroupConfig(players, settings, "modern");
        const result = importGroupConfig(exported, players, settings);

        expect(result.players[0].triggerMap["/items/apple"]).toEqual([]);
    });

    it("imports main-site shareable profile payload", () => {
        const player = createEmptyPlayerConfig(4);
        const settings = createSimulationSettings();
        const headItemHrid = findFirstEquipmentItemByType("/equipment_types/head");
        const weaponItemHrid = findFirstEquipmentItemByType("/equipment_types/two_hand");
        const foodItemHrid = findFirstFoodWithDefaultTriggers();
        const drinkItemHrid = findFirstDrinkWithDefaultTriggers();
        const abilityHrid = findFirstAbilityWithDefaultTriggers();
        const dungeonActionHrid = findFirstCombatAction(true);
        const houseRoomHrid = Object.keys(player.houseRooms)[0];
        const achievementHrid = "/achievements/total_level_100";

        expect(headItemHrid).toBeTruthy();
        expect(weaponItemHrid).toBeTruthy();
        expect(foodItemHrid).toBeTruthy();
        expect(drinkItemHrid).toBeTruthy();
        expect(abilityHrid).toBeTruthy();
        expect(dungeonActionHrid).toBeTruthy();
        expect(houseRoomHrid).toBeTruthy();

        const payload = {
            profile: createMainSiteShareProfileFixture({
            skills: {
                stamina: 44,
                intelligence: 55,
                attack: 66,
                melee: 77,
                defense: 88,
                ranged: 33,
                magic: 22,
            },
            wearableItemMap: {
                head: {
                    itemLocationHrid: "/item_locations/head",
                    itemHrid: headItemHrid,
                    enhancementLevel: 3,
                },
                weapon: {
                    itemLocationHrid: "/item_locations/two_hand",
                    itemHrid: weaponItemHrid,
                    enhancementLevel: 7,
                },
            },
            equippedAbilities: [
                {
                    slotNumber: 1,
                    abilityHrid,
                    level: 9,
                    experience: 0,
                },
            ],
            foodItemHrids: [foodItemHrid, "", ""],
            drinkItemHrids: [drinkItemHrid, "", ""],
            consumableCombatTriggersMap: {
                [foodItemHrid]: itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers,
                [drinkItemHrid]: itemDetailMap[drinkItemHrid].consumableDetail.defaultCombatTriggers,
            },
            abilityCombatTriggersMap: {
                [abilityHrid]: abilityDetailMap[abilityHrid].defaultCombatTriggers,
            },
            characterHouseRoomMap: {
                [houseRoomHrid]: {
                    level: 4,
                },
            },
            characterAchievements: [
                {
                    achievementHrid,
                    progress: 1,
                    isCompleted: true,
                },
            ],
            }),
            mainSiteCombat: {
                actionHrid: dungeonActionHrid,
                difficultyTier: 2,
            },
        };

        const result = importSoloConfig(JSON.stringify(payload), player, settings);

        expect(result.detectedFormat).toBe("main-site-share-profile");
        expect(result.player.name).toBe("Main Site Hero");
        expect(result.player.levels.stamina).toBe(44);
        expect(result.player.levels.intelligence).toBe(55);
        expect(result.player.levels.attack).toBe(66);
        expect(result.player.levels.melee).toBe(77);
        expect(result.player.levels.defense).toBe(88);
        expect(result.player.levels.ranged).toBe(33);
        expect(result.player.levels.magic).toBe(22);
        expect(result.player.equipment.head.itemHrid).toBe(headItemHrid);
        expect(result.player.equipment.head.enhancementLevel).toBe(3);
        expect(result.player.equipment.weapon.itemHrid).toBe(weaponItemHrid);
        expect(result.player.equipment.weapon.enhancementLevel).toBe(7);
        expect(result.player.food[0]).toBe(foodItemHrid);
        expect(result.player.drinks[0]).toBe(drinkItemHrid);
        expect(result.player.abilities[0].abilityHrid).toBe(abilityHrid);
        expect(result.player.abilities[0].level).toBe(9);
        expect(result.player.triggerMap[foodItemHrid]).toEqual(itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers);
        expect(result.player.triggerMap[drinkItemHrid]).toEqual(itemDetailMap[drinkItemHrid].consumableDetail.defaultCombatTriggers);
        expect(result.player.triggerMap[abilityHrid]).toEqual(abilityDetailMap[abilityHrid].defaultCombatTriggers);
        expect(result.player.houseRooms[houseRoomHrid]).toBe(4);
        expect(result.player.achievements[achievementHrid]).toBe(true);
        expect(result.simulationSettings.mode).toBe("zone");
        expect(result.simulationSettings.useDungeon).toBe(true);
        expect(result.simulationSettings.dungeonHrid).toBe(dungeonActionHrid);
        expect(result.simulationSettings.difficultyTier).toBe(2);
        expect(result.simulationSettings.simulationTimeHours).toBe(settings.simulationTimeHours);
    });

    it("prefers runtime main-site consumables when shareable profile omits food and drinks", () => {
        const player = createEmptyPlayerConfig(2);
        const settings = createSimulationSettings();
        const foodItemHrid = findFirstFoodWithDefaultTriggers();
        const drinkItemHrid = findFirstDrinkWithDefaultTriggers();

        expect(foodItemHrid).toBeTruthy();
        expect(drinkItemHrid).toBeTruthy();

        const payload = {
            profile: createMainSiteShareProfileFixture({
                foodItemHrids: ["", "", ""],
                drinkItemHrids: ["", "", ""],
                consumableCombatTriggersMap: {},
            }),
            mainSiteConsumables: {
                foodItemHrids: [foodItemHrid, "", ""],
                drinkItemHrids: [drinkItemHrid, "", ""],
                consumableCombatTriggersMap: {
                    [foodItemHrid]: itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers,
                    [drinkItemHrid]: itemDetailMap[drinkItemHrid].consumableDetail.defaultCombatTriggers,
                },
                abilityCombatTriggersMap: {},
            },
        };

        const result = importSoloConfig(JSON.stringify(payload), player, settings);

        expect(result.player.food[0]).toBe(foodItemHrid);
        expect(result.player.drinks[0]).toBe(drinkItemHrid);
        expect(result.player.triggerMap[foodItemHrid]).toEqual(itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers);
        expect(result.player.triggerMap[drinkItemHrid]).toEqual(itemDetailMap[drinkItemHrid].consumableDetail.defaultCombatTriggers);
    });
});

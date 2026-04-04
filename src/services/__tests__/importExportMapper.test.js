import { describe, expect, it } from "vitest";
import actionDetailMap from "../../combatsimulator/data/actionDetailMap.json";
import abilityDetailMap from "../../combatsimulator/data/abilityDetailMap.json";
import itemDetailMap from "../../combatsimulator/data/itemDetailMap.json";
import { createEmptyPlayerConfig } from "../playerMapper.js";
import {
    exportGroupConfig,
    exportSoloConfig,
    importGroupConfig,
    importSoloConfig,
} from "../importExportMapper.js";
import {
    createMainSiteCurrentCharacterFixture,
    createMainSiteShareProfileFixture,
} from "./fixtures/mainSiteShareProfileFixture.js";

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

function findFirstSpecialAbility() {
    const ability = Object.values(abilityDetailMap).find((entry) => entry?.isSpecialAbility === true);
    return ability?.hrid ?? "";
}

function findAnotherStandardAbility(excludedHrid = "") {
    const excluded = String(excludedHrid || "");
    const ability = Object.values(abilityDetailMap).find((entry) => (
        !entry?.isSpecialAbility
        && String(entry?.hrid || "") !== excluded
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

function createConfiguredPlayer(id = 1) {
    const player = createEmptyPlayerConfig(id);
    player.levels.attack = 33;
    player.levels.magic = 44;
    player.levels.stamina = 55;
    player.equipment.head = {
        itemHrid: findFirstEquipmentItemByType("/equipment_types/head"),
        enhancementLevel: 3,
    };
    player.food[0] = findFirstFoodWithDefaultTriggers();
    player.drinks[0] = findFirstDrinkWithDefaultTriggers();
    player.abilities[0] = {
        abilityHrid: findFirstAbilityWithDefaultTriggers(),
        level: 7,
    };
    player.triggerMap[player.food[0]] = [];
    player.houseRooms[Object.keys(player.houseRooms)[0]] = 2;
    player.achievements = { "/achievements/test": true };
    return player;
}

describe("importExportMapper", () => {
    it("exports modern group payload", () => {
        const players = [createConfiguredPlayer(1), createConfiguredPlayer(2)];
        const settings = createSimulationSettings();

        const exported = exportGroupConfig(players, settings);
        const parsed = JSON.parse(exported);

        expect(parsed.version).toBe(2);
        expect(parsed.format).toBe("mwi-vue-group");
        expect(parsed.players).toHaveLength(2);
        expect(parsed.players[0].levels.attack).toBe(33);
        expect(parsed.simulationSettings.zoneHrid).toBe(settings.zoneHrid);
    });

    it("exports modern solo payload", () => {
        const player = createConfiguredPlayer(1);
        const settings = createSimulationSettings();

        const exported = exportSoloConfig(player, settings);
        const parsed = JSON.parse(exported);

        expect(parsed.version).toBe(2);
        expect(parsed.format).toBe("mwi-vue-solo");
        expect(parsed.player.levels.magic).toBe(44);
        expect(parsed.player.food[0]).toBe(player.food[0]);
    });

    it("imports modern group payload", () => {
        const players = [createConfiguredPlayer(1), createConfiguredPlayer(2)];
        const settings = {
            ...createSimulationSettings(),
            zoneHrid: findFirstCombatAction(false),
            dungeonHrid: findFirstCombatAction(true),
            difficultyTier: 2,
        };

        const result = importGroupConfig(exportGroupConfig(players, settings), players, createSimulationSettings());

        expect(result.detectedFormat).toBe("modern-group");
        expect(result.players[0].levels.attack).toBe(33);
        expect(result.simulationSettings.zoneHrid).toBe(settings.zoneHrid);
        expect(result.simulationSettings.difficultyTier).toBe(2);
    });

    it("imports modern solo payload", () => {
        const player = createConfiguredPlayer(1);
        const settings = {
            ...createSimulationSettings(),
            zoneHrid: findFirstCombatAction(false),
            simulationTimeHours: 12,
        };

        const result = importSoloConfig(exportSoloConfig(player, settings), createEmptyPlayerConfig(1), createSimulationSettings());

        expect(result.detectedFormat).toBe("modern-solo");
        expect(result.player.levels.attack).toBe(33);
        expect(result.player.skillExperience.attack).toBeNull();
        expect(result.simulationSettings.zoneHrid).toBe(settings.zoneHrid);
        expect(result.simulationSettings.simulationTimeHours).toBe(12);
    });

    it("imports legacy solo payload for manual paste compatibility", () => {
        const fallbackPlayer = createEmptyPlayerConfig(1);
        fallbackPlayer.achievements = { "/achievements/existing": true };

        const legacyPayload = {
            player: {
                attackLevel: 117,
                magicLevel: 125,
                meleeLevel: 66,
                rangedLevel: 52,
                defenseLevel: 112,
                staminaLevel: 103,
                intelligenceLevel: 102,
                equipment: [
                    {
                        itemLocationHrid: "/item_locations/head",
                        itemHrid: "/items/magicians_hat",
                        enhancementLevel: 6,
                    },
                    {
                        itemLocationHrid: "/item_locations/main_hand",
                        itemHrid: "/items/blazing_trident",
                        enhancementLevel: 10,
                    },
                    {
                        itemLocationHrid: "/item_locations/off_hand",
                        itemHrid: "/items/bishops_codex",
                        enhancementLevel: 5,
                    },
                ],
            },
            food: {
                "/action_types/combat": [
                    { itemHrid: "/items/star_fruit_gummy" },
                    { itemHrid: "/items/dragon_fruit_yogurt" },
                    { itemHrid: "/items/marsberry_cake" },
                ],
            },
            drinks: {
                "/action_types/combat": [
                    { itemHrid: "/items/wisdom_coffee" },
                    { itemHrid: "/items/super_magic_coffee" },
                    { itemHrid: "/items/channeling_coffee" },
                ],
            },
            abilities: [
                { abilityHrid: "/abilities/mystic_aura", level: 26 },
                { abilityHrid: "/abilities/elemental_affinity", level: 60 },
                { abilityHrid: "/abilities/firestorm", level: 60 },
                { abilityHrid: "/abilities/flame_blast", level: 70 },
                { abilityHrid: "/abilities/fireball", level: 70 },
            ],
            triggerMap: {
                "/abilities/mystic_aura": [],
            },
            houseRooms: {
                "/house_rooms/archery_range": 1,
            },
            zone: "/actions/combat/jungle_planet",
            difficulty: "2",
            simulationTime: "12",
        };

        const result = importSoloConfig(JSON.stringify(legacyPayload), fallbackPlayer, createSimulationSettings());

        expect(result.detectedFormat).toBe("legacy-solo");
        expect(result.player.levels.attack).toBe(117);
        expect(result.player.equipment.weapon.itemHrid).toBe("/items/blazing_trident");
        expect(result.player.food[0]).toBe("/items/star_fruit_gummy");
        expect(result.player.abilities[4].abilityHrid).toBe("/abilities/fireball");
        expect(result.player.achievements).toEqual({ "/achievements/existing": true });
        expect(result.simulationSettings.zoneHrid).toBe("/actions/combat/jungle_planet");
        expect(result.simulationSettings.difficultyTier).toBe(2);
        expect(result.simulationSettings.simulationTimeHours).toBe(12);
    });

    it("normalizes legacy item location hrids before mapping equipment slots", () => {
        const fallbackPlayer = createEmptyPlayerConfig(1);
        const legacyPayload = {
            player: {
                equipment: [
                    {
                        itemLocationHrid: " /item_locations/head ",
                        itemHrid: "/items/magicians_hat",
                        enhancementLevel: 6,
                    },
                    {
                        itemLocationHrid: " /item_locations/main_hand ",
                        itemHrid: "/items/blazing_trident",
                        enhancementLevel: 10,
                    },
                ],
            },
        };

        const result = importSoloConfig(JSON.stringify(legacyPayload), fallbackPlayer, createSimulationSettings());

        expect(result.detectedFormat).toBe("legacy-solo");
        expect(result.player.equipment.head.itemHrid).toBe("/items/magicians_hat");
        expect(result.player.equipment.weapon.itemHrid).toBe("/items/blazing_trident");
    });

    it("preserves legacy trinket item locations for preview-only task badge highlights", () => {
        const fallbackPlayer = createEmptyPlayerConfig(1);
        const legacyPayload = {
            player: {
                equipment: [
                    {
                        itemLocationHrid: "/item_locations/trinket",
                        itemHrid: "/items/basic_task_badge",
                        enhancementLevel: 2,
                    },
                ],
            },
        };

        const result = importSoloConfig(JSON.stringify(legacyPayload), fallbackPlayer, createSimulationSettings());

        expect(result.detectedFormat).toBe("legacy-solo");
        expect(result.player.equipment.trinket).toEqual({
            itemHrid: "/items/basic_task_badge",
            enhancementLevel: 2,
        });
    });

    it("clears fallback preview-only trinkets when a legacy import omits them", () => {
        const fallbackPlayer = createEmptyPlayerConfig(1);
        fallbackPlayer.equipment.trinket = {
            itemHrid: "/items/expert_task_badge",
            enhancementLevel: 4,
        };

        const legacyPayload = {
            player: {
                equipment: [],
            },
        };

        const result = importSoloConfig(JSON.stringify(legacyPayload), fallbackPlayer, createSimulationSettings());

        expect(result.detectedFormat).toBe("legacy-solo");
        expect(result.player.equipment.trinket).toEqual({
            itemHrid: "",
            enhancementLevel: 0,
        });
    });

    it("imports modern player-only payload", () => {
        const player = createConfiguredPlayer(2);

        const result = importSoloConfig(JSON.stringify(player), createEmptyPlayerConfig(2), createSimulationSettings());

        expect(result.detectedFormat).toBe("modern-player-only");
        expect(result.player.levels.attack).toBe(33);
        expect(result.simulationSettings.zoneHrid).toBe(createSimulationSettings().zoneHrid);
    });

    it("clears fallback preview-only trinkets when a modern player-only import omits them", () => {
        const fallbackPlayer = createEmptyPlayerConfig(2);
        fallbackPlayer.equipment.trinket = {
            itemHrid: "/items/expert_task_badge",
            enhancementLevel: 4,
        };

        const importedPlayer = createConfiguredPlayer(2);

        const result = importSoloConfig(JSON.stringify(importedPlayer), fallbackPlayer, createSimulationSettings());

        expect(result.detectedFormat).toBe("modern-player-only");
        expect(result.player.equipment.trinket).toEqual({
            itemHrid: "",
            enhancementLevel: 0,
        });
    });

    it("imports main-site share profile payload", () => {
        const fallbackPlayer = createEmptyPlayerConfig(3);
        const abilityHrid = findFirstAbilityWithDefaultTriggers();
        const specialAbilityHrid = findFirstSpecialAbility();
        const zoneActionHrid = findFirstCombatAction(false);

        expect(abilityHrid).toBeTruthy();
        expect(specialAbilityHrid).toBeTruthy();

        const fixture = {
            ...createMainSiteShareProfileFixture({
                characterName: "Fixture Hero",
                equippedAbilities: [
                    {
                        slotNumber: 1,
                        abilityHrid,
                        level: 6,
                    },
                    {
                        abilityHrid: specialAbilityHrid,
                        level: 4,
                    },
                ],
            }),
            mainSiteCombat: {
                actionHrid: zoneActionHrid,
                difficultyTier: 1,
            },
        };

        const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

        expect(result.detectedFormat).toBe("main-site-share-profile");
        expect(result.player.id).toBe("3");
        expect(result.player.name).toBe("Fixture Hero");
        expect(result.player.abilities[0]).toEqual({
            abilityHrid: specialAbilityHrid,
            level: 4,
        });
        expect(result.player.abilities[1]).toEqual({
            abilityHrid,
            level: 6,
        });
        expect(result.simulationSettings.zoneHrid).toBe(zoneActionHrid);
    });

    it("imports main-site current character payload", () => {
        const fallbackPlayer = createEmptyPlayerConfig(4);
        const headItemHrid = findFirstEquipmentItemByType("/equipment_types/head");
        const weaponItemHrid = findFirstEquipmentItemByType("/equipment_types/two_hand");
        const foodItemHrid = findFirstFoodWithDefaultTriggers();
        const drinkItemHrid = findFirstDrinkWithDefaultTriggers();
        const abilityHrid = findFirstAbilityWithDefaultTriggers();
        const specialAbilityHrid = findFirstSpecialAbility();
        const zoneActionHrid = findFirstCombatAction(false);
        const houseRoomHrid = Object.keys(fallbackPlayer.houseRooms)[0];

        expect(specialAbilityHrid).toBeTruthy();

        const fixture = {
            ...createMainSiteCurrentCharacterFixture({
                characterName: "Current Fixture Hero",
                skills: {
                    stamina: 16,
                    intelligence: 26,
                    attack: 36,
                    melee: 46,
                    defense: 56,
                    ranged: 66,
                    magic: 76,
                },
                skillExperience: {
                    stamina: 1600,
                    intelligence: 2600,
                    attack: 3600,
                    melee: 4600,
                    defense: 5600,
                    ranged: 6600,
                    magic: 7600,
                },
                characterItems: [
                    {
                        itemLocationHrid: "/item_locations/head",
                        itemHrid: headItemHrid,
                        enhancementLevel: 3,
                    },
                    {
                        currentItem: {
                            itemLocationHrid: "/item_locations/two_hand",
                            itemHrid: weaponItemHrid,
                            enhancementLevel: 4,
                        },
                    },
                ],
                combatAbilities: [
                    {
                        abilityHrid: specialAbilityHrid,
                        level: 9,
                    },
                    {
                        abilityHrid,
                        level: 7,
                    },
                ],
                actionTypeFoodSlotsMap: {
                    "/action_types/combat": [foodItemHrid, "", ""],
                },
                actionTypeDrinkSlotsMap: {
                    "/action_types/combat": [drinkItemHrid, "", ""],
                },
                consumableCombatTriggersMap: {
                    [foodItemHrid]: itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers,
                    [drinkItemHrid]: itemDetailMap[drinkItemHrid].consumableDetail.defaultCombatTriggers,
                },
                abilityCombatTriggersMap: {
                    [abilityHrid]: abilityDetailMap[abilityHrid].defaultCombatTriggers,
                },
                characterHouseRoomMap: {
                    "11": {
                        houseRoomHrid,
                        level: 4,
                    },
                },
                characterAchievements: {
                    "7": {
                        achievementHrid: "/achievements/current_fixture",
                        isCompleted: true,
                    },
                },
            }),
            mainSiteCombat: {
                actionHrid: zoneActionHrid,
                difficultyTier: 2,
            },
        };

        const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

        expect(result.detectedFormat).toBe("main-site-current-character");
        expect(result.player.id).toBe("4");
        expect(result.player.name).toBe("Current Fixture Hero");
        expect(result.player.levels.stamina).toBe(16);
        expect(result.player.skillExperience.magic).toBe(7600);
        expect(result.player.equipment.head.itemHrid).toBe(headItemHrid);
        expect(result.player.equipment.weapon.itemHrid).toBe(weaponItemHrid);
        expect(result.player.food[0]).toBe(foodItemHrid);
        expect(result.player.drinks[0]).toBe(drinkItemHrid);
        expect(result.player.abilities[0]).toEqual({
            abilityHrid: specialAbilityHrid,
            level: 9,
        });
        expect(result.player.abilities[1]).toEqual({
            abilityHrid,
            level: 7,
        });
        expect(result.player.triggerMap[foodItemHrid]).toEqual(itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers);
        expect(result.player.triggerMap[abilityHrid]).toEqual(abilityDetailMap[abilityHrid].defaultCombatTriggers);
        expect(result.player.houseRooms[houseRoomHrid]).toBe(4);
        expect(result.player.achievements["/achievements/current_fixture"]).toBe(true);
        expect(result.simulationSettings.zoneHrid).toBe(zoneActionHrid);
        expect(result.simulationSettings.difficultyTier).toBe(2);
    });

    it("preserves main-site current character trinkets for homepage preview data", () => {
        const fallbackPlayer = createEmptyPlayerConfig(12);
        const fixture = createMainSiteCurrentCharacterFixture({
            characterItems: [
                {
                    itemLocationHrid: "/item_locations/trinket",
                    itemHrid: "/items/expert_task_badge",
                    enhancementLevel: 4,
                },
            ],
        });

        const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

        expect(result.detectedFormat).toBe("main-site-current-character");
        expect(result.player.equipment.trinket).toEqual({
            itemHrid: "/items/expert_task_badge",
            enhancementLevel: 4,
        });
    });

    it("clears fallback preview-only trinkets when current-character imports omit them", () => {
        const fallbackPlayer = createEmptyPlayerConfig(12);
        fallbackPlayer.equipment.trinket = {
            itemHrid: "/items/expert_task_badge",
            enhancementLevel: 4,
        };

        const fixture = createMainSiteCurrentCharacterFixture({
            characterItems: [],
        });

        const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

        expect(result.detectedFormat).toBe("main-site-current-character");
        expect(result.player.equipment.trinket).toEqual({
            itemHrid: "",
            enhancementLevel: 0,
        });
    });

    it("imports shareable profile food and drinks from combatConsumables arrays in cached profiles", () => {
        const fallbackPlayer = createEmptyPlayerConfig(11);
        const foodItemHrid = findFirstFoodWithDefaultTriggers();
        const drinkItemHrid = findFirstDrinkWithDefaultTriggers();

        expect(foodItemHrid).toBeTruthy();
        expect(drinkItemHrid).toBeTruthy();

        const fixture = createMainSiteShareProfileFixture({
            characterName: "Cached Shareable Consumables Hero",
            foodItemHrids: ["", "", ""],
            drinkItemHrids: ["", "", ""],
        });
        delete fixture.foodItemHrids;
        delete fixture.drinkItemHrids;
        fixture.combatConsumables = [
            { itemHrid: foodItemHrid },
            { itemHrid: drinkItemHrid },
        ];

        const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

        expect(result.detectedFormat).toBe("main-site-share-profile");
        expect(result.player.food[0]).toBe(foodItemHrid);
        expect(result.player.drinks[0]).toBe(drinkItemHrid);
    });

    it("clears fallback triggers when a shareable profile explicitly provides empty trigger maps", () => {
        const fallbackPlayer = createEmptyPlayerConfig(9);
        const foodItemHrid = findFirstFoodWithDefaultTriggers();
        const abilityHrid = findFirstAbilityWithDefaultTriggers();

        expect(foodItemHrid).toBeTruthy();
        expect(abilityHrid).toBeTruthy();

        fallbackPlayer.triggerMap = {
            [foodItemHrid]: itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers,
            [abilityHrid]: abilityDetailMap[abilityHrid].defaultCombatTriggers,
        };

        const fixture = createMainSiteShareProfileFixture({
            characterName: "Explicit Empty Shareable Triggers",
            consumableCombatTriggersMap: {},
            abilityCombatTriggersMap: {},
        });

        const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

        expect(result.detectedFormat).toBe("main-site-share-profile");
        expect(result.player.triggerMap).toEqual({});
    });

    it("clears fallback triggers when a current-character payload explicitly provides empty trigger maps", () => {
        const fallbackPlayer = createEmptyPlayerConfig(10);
        const foodItemHrid = findFirstFoodWithDefaultTriggers();
        const abilityHrid = findFirstAbilityWithDefaultTriggers();

        expect(foodItemHrid).toBeTruthy();
        expect(abilityHrid).toBeTruthy();

        fallbackPlayer.triggerMap = {
            [foodItemHrid]: itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers,
            [abilityHrid]: abilityDetailMap[abilityHrid].defaultCombatTriggers,
        };

        const fixture = createMainSiteCurrentCharacterFixture({
            characterName: "Explicit Empty Current Triggers",
            actionTypeFoodSlotsMap: {
                "/action_types/combat": ["", "", ""],
            },
            actionTypeDrinkSlotsMap: {
                "/action_types/combat": ["", "", ""],
            },
            consumableCombatTriggersMap: {},
            abilityCombatTriggersMap: {},
        });

        const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

        expect(result.detectedFormat).toBe("main-site-current-character");
        expect(result.player.triggerMap).toEqual({});
    });

    it("imports partial current-character trigger payloads without falling back to stale triggers", () => {
        const fallbackPlayer = createEmptyPlayerConfig(12);
        const foodItemHrid = findFirstFoodWithDefaultTriggers();
        const abilityHrid = findFirstAbilityWithDefaultTriggers();

        expect(foodItemHrid).toBeTruthy();
        expect(abilityHrid).toBeTruthy();

        fallbackPlayer.triggerMap = {
            [foodItemHrid]: itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers,
            [abilityHrid]: abilityDetailMap[abilityHrid].defaultCombatTriggers,
        };

        const fixture = createMainSiteCurrentCharacterFixture({
            characterName: "Partial Current Trigger Payload",
            actionTypeFoodSlotsMap: {
                "/action_types/combat": [foodItemHrid, "", ""],
            },
            actionTypeDrinkSlotsMap: {
                "/action_types/combat": ["", "", ""],
            },
            consumableCombatTriggersMap: {
                [foodItemHrid]: itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers,
            },
        });

        const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

        expect(result.detectedFormat).toBe("main-site-current-character");
        expect(result.player.triggerMap).toEqual({
            [foodItemHrid]: itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers,
        });
    });

    it("imports main-site share profile payload with zero-based explicit ability slots", () => {
        const fallbackPlayer = createEmptyPlayerConfig(5);
        const standardAbilityHrid = findFirstAbilityWithDefaultTriggers();
        const secondAbilityHrid = findAnotherStandardAbility(standardAbilityHrid);
        const specialAbilityHrid = findFirstSpecialAbility();

        expect(standardAbilityHrid).toBeTruthy();
        expect(secondAbilityHrid).toBeTruthy();
        expect(specialAbilityHrid).toBeTruthy();

        const fixture = createMainSiteShareProfileFixture({
            characterName: "Zero Based Share Hero",
            equippedAbilities: [
                {
                    abilityHrid: specialAbilityHrid,
                    level: 11,
                    slotIndex: 0,
                },
                {
                    abilityHrid: standardAbilityHrid,
                    level: 7,
                    slotIndex: 1,
                },
                {
                    abilityHrid: secondAbilityHrid,
                    level: 5,
                    slotIndex: 2,
                },
            ],
        });

        const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

        expect(result.detectedFormat).toBe("main-site-share-profile");
        expect(result.player.abilities[0]).toEqual({
            abilityHrid: specialAbilityHrid,
            level: 11,
        });
        expect(result.player.abilities[1]).toEqual({
            abilityHrid: standardAbilityHrid,
            level: 7,
        });
        expect(result.player.abilities[2]).toEqual({
            abilityHrid: secondAbilityHrid,
            level: 5,
        });
    });

    it("imports main-site current character payload with zero-based explicit ability slots", () => {
        const fallbackPlayer = createEmptyPlayerConfig(6);
        const standardAbilityHrid = findFirstAbilityWithDefaultTriggers();
        const secondAbilityHrid = findAnotherStandardAbility(standardAbilityHrid);
        const specialAbilityHrid = findFirstSpecialAbility();

        expect(standardAbilityHrid).toBeTruthy();
        expect(secondAbilityHrid).toBeTruthy();
        expect(specialAbilityHrid).toBeTruthy();

        const fixture = createMainSiteCurrentCharacterFixture({
            characterName: "Zero Based Current Hero",
            combatAbilities: [
                {
                    abilityHrid: specialAbilityHrid,
                    level: 9,
                    slotIndex: 0,
                },
                {
                    abilityHrid: standardAbilityHrid,
                    level: 6,
                    slotIndex: 1,
                },
                {
                    abilityHrid: secondAbilityHrid,
                    level: 4,
                    slotIndex: 2,
                },
            ],
        });

        const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

        expect(result.detectedFormat).toBe("main-site-current-character");
        expect(result.player.abilities[0]).toEqual({
            abilityHrid: specialAbilityHrid,
            level: 9,
        });
        expect(result.player.abilities[1]).toEqual({
            abilityHrid: standardAbilityHrid,
            level: 6,
        });
        expect(result.player.abilities[2]).toEqual({
            abilityHrid: secondAbilityHrid,
            level: 4,
        });
    });

    it("imports main-site share profile payload with zero-based standard ability slots and no explicit special ability", () => {
        const fallbackPlayer = createEmptyPlayerConfig(7);
        const firstAbilityHrid = findFirstAbilityWithDefaultTriggers();
        const secondAbilityHrid = findAnotherStandardAbility(firstAbilityHrid);

        expect(firstAbilityHrid).toBeTruthy();
        expect(secondAbilityHrid).toBeTruthy();

        const fixture = createMainSiteShareProfileFixture({
            characterName: "Zero Based Standard Share Hero",
            equippedAbilities: [
                {
                    abilityHrid: firstAbilityHrid,
                    level: 8,
                    slotIndex: 0,
                },
                {
                    abilityHrid: secondAbilityHrid,
                    level: 6,
                    slotIndex: 1,
                },
            ],
        });

        const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

        expect(result.detectedFormat).toBe("main-site-share-profile");
        expect(result.player.abilities[0]).toEqual({
            abilityHrid: "",
            level: 1,
        });
        expect(result.player.abilities[1]).toEqual({
            abilityHrid: firstAbilityHrid,
            level: 8,
        });
        expect(result.player.abilities[2]).toEqual({
            abilityHrid: secondAbilityHrid,
            level: 6,
        });
    });

    it("imports main-site current character payload with zero-based standard ability slots and no explicit special ability", () => {
        const fallbackPlayer = createEmptyPlayerConfig(8);
        const firstAbilityHrid = findFirstAbilityWithDefaultTriggers();
        const secondAbilityHrid = findAnotherStandardAbility(firstAbilityHrid);

        expect(firstAbilityHrid).toBeTruthy();
        expect(secondAbilityHrid).toBeTruthy();

        const fixture = createMainSiteCurrentCharacterFixture({
            characterName: "Zero Based Standard Current Hero",
            combatAbilities: [
                {
                    abilityHrid: firstAbilityHrid,
                    level: 10,
                    slotIndex: 0,
                },
                {
                    abilityHrid: secondAbilityHrid,
                    level: 7,
                    slotIndex: 1,
                },
            ],
        });

        const result = importSoloConfig(JSON.stringify(fixture), fallbackPlayer, createSimulationSettings());

        expect(result.detectedFormat).toBe("main-site-current-character");
        expect(result.player.abilities[0]).toEqual({
            abilityHrid: "",
            level: 1,
        });
        expect(result.player.abilities[1]).toEqual({
            abilityHrid: firstAbilityHrid,
            level: 10,
        });
        expect(result.player.abilities[2]).toEqual({
            abilityHrid: secondAbilityHrid,
            level: 7,
        });
    });
});

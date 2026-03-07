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

    it("imports modern player-only payload", () => {
        const player = createConfiguredPlayer(2);

        const result = importSoloConfig(JSON.stringify(player), createEmptyPlayerConfig(2), createSimulationSettings());

        expect(result.detectedFormat).toBe("modern-player-only");
        expect(result.player.levels.attack).toBe(33);
        expect(result.simulationSettings.zoneHrid).toBe(createSimulationSettings().zoneHrid);
    });

    it("imports main-site share profile payload", () => {
        const fallbackPlayer = createEmptyPlayerConfig(3);
        const zoneActionHrid = findFirstCombatAction(false);
        const fixture = {
            ...createMainSiteShareProfileFixture({
            characterName: "Fixture Hero",
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
        expect(result.simulationSettings.zoneHrid).toBe(zoneActionHrid);
    });
});

import { describe, expect, it } from "vitest";
import { createEmptyPlayerConfig } from "../playerMapper.js";
import {
    createLegacySoloPayload,
    exportGroupConfig,
    importGroupConfig,
    importSoloConfig,
} from "../importExportMapper.js";

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
});

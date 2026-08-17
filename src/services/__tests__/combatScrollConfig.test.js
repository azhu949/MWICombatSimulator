import { describe, expect, it } from "vitest";
import Player from "../../combatsimulator/player.js";
import { createEmptyPlayerConfig } from "../../shared/playerConfig.js";
import { buildPlayersForSimulation } from "../playerMapper.js";
import {
    exportGroupConfig,
    exportSoloConfig,
    importGroupConfig,
    importSoloConfig,
} from "../importExportMapper.js";

function settings() {
    return { mode: "zone", zoneHrid: "/actions/combat/fly", simulationTimeHours: 1 };
}

describe("combat scroll configuration contract", () => {
    it("round-trips finite and unlimited quantities for solo and group configs", () => {
        const player = createEmptyPlayerConfig(1);
        player.combatScrolls = {
            "/items/seal_of_damage": { quantity: 3 },
            "/items/seal_of_wisdom": { quantity: null },
        };

        const solo = importSoloConfig(exportSoloConfig(player, settings()), createEmptyPlayerConfig(1), settings());
        expect(solo.player.combatScrolls).toEqual(player.combatScrolls);

        const group = importGroupConfig(
            exportGroupConfig([player], settings()),
            [createEmptyPlayerConfig(1)],
            settings()
        );
        expect(group.players[0].combatScrolls).toEqual(player.combatScrolls);
    });

    it("defaults missing fields to disabled and filters invalid imported quantities", () => {
        const fallback = createEmptyPlayerConfig(1);
        fallback.combatScrolls = {
            "/items/seal_of_damage": { quantity: 8 },
        };
        const payload = {
            version: 2,
            format: "mwi-vue-solo",
            player: {
                ...createEmptyPlayerConfig(1),
                combatScrolls: {
                    "/items/seal_of_damage": { quantity: 0 },
                    "/items/seal_of_wisdom": { quantity: "" },
                    "/items/seal_of_action_speed": { quantity: 2 },
                    "/items/unknown": { quantity: 2 },
                },
            },
        };

        const result = importSoloConfig(JSON.stringify(payload), fallback, settings());
        expect(result.player.combatScrolls).toEqual({
            "/items/seal_of_wisdom": { quantity: null },
        });

        delete payload.player.combatScrolls;
        const missing = importSoloConfig(JSON.stringify(payload), fallback, settings());
        expect(missing.player.combatScrolls).toEqual({});
    });

    it("keeps manual scrolls through main-site imports but never imports active buff maps", () => {
        const fallback = createEmptyPlayerConfig(1);
        fallback.combatScrolls = {
            "/items/seal_of_rare_find": { quantity: null },
        };
        const payload = {
            character: { name: "Imported" },
            characterSkills: [],
            characterItems: [],
            personalActionTypeBuffsMap: {
                "/action_types/combat": {
                    "/personal_buff_types/damage": true,
                },
            },
        };
        const result = importSoloConfig(JSON.stringify(payload), fallback, settings());
        expect(result.player.combatScrolls).toEqual(fallback.combatScrolls);
    });

    it("preserves missing legacy scrolls while honoring an explicit empty configuration", () => {
        const fallback = createEmptyPlayerConfig(1);
        fallback.combatScrolls = {
            "/items/seal_of_rare_find": { quantity: null },
        };
        const payload = {
            player: {
                attackLevel: 50,
            },
        };

        const missing = importSoloConfig(JSON.stringify(payload), fallback, settings());
        expect(missing.detectedFormat).toBe("legacy-solo");
        expect(missing.player.combatScrolls).toEqual(fallback.combatScrolls);

        const explicitEmpty = importSoloConfig(
            JSON.stringify({ ...payload, combatScrolls: {} }),
            fallback,
            settings()
        );
        expect(explicitEmpty.player.combatScrolls).toEqual({});
    });

    it("carries the normalized map through simulation and worker DTO creation", () => {
        const config = createEmptyPlayerConfig(1);
        config.combatScrolls = {
            "/items/seal_of_attack_speed": { quantity: 2 },
            "/items/seal_of_wisdom": { quantity: null },
        };
        const [player] = buildPlayersForSimulation([config]);
        expect(player.combatScrolls).toEqual(config.combatScrolls);

        const roundtrip = Player.createFromDTO(structuredClone(player));
        expect(roundtrip.combatScrolls).toEqual(config.combatScrolls);
    });
});

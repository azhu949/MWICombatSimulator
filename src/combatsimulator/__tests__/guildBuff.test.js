import { describe, expect, it } from "vitest";

import GuildBuff from "../guildBuff.js";
import Player from "../player.js";
import { buildPlayersForSimulation, createEmptyPlayerConfig } from "../../services/playerMapper.js";
import { combatGuildBuffHrids, normalizeGuildBuffLevels } from "../../shared/guildBuffs.js";

const EXPECTED_LEVEL_VALUES = {
    "/guild_buffs/force_combat": [{ typeHrid: "/buff_types/damage", field: "ratioBoost", level1: 0.003, level20: 0.06 }],
    "/guild_buffs/tempo_combat": [
        { typeHrid: "/buff_types/attack_speed", field: "ratioBoost", level1: 0.004, level20: 0.08 },
        { typeHrid: "/buff_types/cast_speed", field: "flatBoost", level1: 0.004, level20: 0.08 },
    ],
    "/guild_buffs/spirit_combat": [
        { typeHrid: "/buff_types/max_hitpoints", field: "ratioBoost", level1: 0.01, level20: 0.2 },
        { typeHrid: "/buff_types/max_manapoints", field: "ratioBoost", level1: 0.01, level20: 0.2 },
    ],
    "/guild_buffs/rarity_combat": [{ typeHrid: "/buff_types/rare_find", field: "flatBoost", level1: 0.01, level20: 0.2 }],
    "/guild_buffs/scholar_combat": [{ typeHrid: "/buff_types/wisdom", field: "flatBoost", level1: 0.005, level20: 0.1 }],
};

function buildPlayer(guildBuffLevels = {}) {
    const config = createEmptyPlayerConfig(1);
    config.selected = true;
    config.levels = Object.fromEntries(Object.keys(config.levels).map((key) => [key, 100]));
    config.guildBuffs = normalizeGuildBuffLevels(guildBuffLevels);
    return buildPlayersForSimulation([config])[0];
}

function activatePermanentBuffs(player) {
    player.zoneBuffs = [];
    player.extraBuffs = [];
    player.generatePermanentBuffs();
    player.reset(0);
    return player;
}

describe("guild shrine combat buffs", () => {
    it("builds every official combat buff at levels 1 and 20", () => {
        expect(combatGuildBuffHrids).toEqual(Object.keys(EXPECTED_LEVEL_VALUES));

        for (const [guildBuffHrid, expectedBuffs] of Object.entries(EXPECTED_LEVEL_VALUES)) {
            const level1 = new GuildBuff(guildBuffHrid, 1);
            const level20 = new GuildBuff(guildBuffHrid, 20);

            expect(level1.buffs).toHaveLength(expectedBuffs.length);
            expect(level20.buffs).toHaveLength(expectedBuffs.length);
            for (const expected of expectedBuffs) {
                const first = level1.buffs.find((buff) => buff.typeHrid === expected.typeHrid);
                const maxed = level20.buffs.find((buff) => buff.typeHrid === expected.typeHrid);
                expect(first?.[expected.field]).toBeCloseTo(expected.level1, 8);
                expect(maxed?.[expected.field]).toBeCloseTo(expected.level20, 8);
            }
        }
    });

    it("normalizes missing, negative, and over-cap levels", () => {
        const normalized = normalizeGuildBuffLevels({
            "/guild_buffs/force_combat": -4,
            "/guild_buffs/tempo_combat": 99,
        });

        expect(normalized["/guild_buffs/force_combat"]).toBe(0);
        expect(normalized["/guild_buffs/tempo_combat"]).toBe(20);
        expect(normalized["/guild_buffs/spirit_combat"]).toBe(0);
    });

    it("applies all five shrine effects to derived combat stats", () => {
        const baseline = activatePermanentBuffs(buildPlayer());
        const maxed = activatePermanentBuffs(buildPlayer(
            Object.fromEntries(combatGuildBuffHrids.map((hrid) => [hrid, 20]))
        ));

        expect(maxed.combatDetails.smashMaxDamage / baseline.combatDetails.smashMaxDamage).toBeCloseTo(1.06, 8);
        expect(maxed.combatDetails.combatStats.attackInterval).toBeLessThan(baseline.combatDetails.combatStats.attackInterval);
        expect(maxed.combatDetails.combatStats.castSpeed - baseline.combatDetails.combatStats.castSpeed).toBeCloseTo(0.08, 8);
        expect(maxed.combatDetails.maxHitpoints).toBe(Math.floor(baseline.combatDetails.maxHitpoints * 1.2));
        expect(maxed.combatDetails.maxManapoints).toBe(Math.floor(baseline.combatDetails.maxManapoints * 1.2));
        expect(maxed.combatDetails.combatStats.combatRareFind - baseline.combatDetails.combatStats.combatRareFind).toBeCloseTo(0.2, 8);
        expect(maxed.combatDetails.combatStats.combatExperience - baseline.combatDetails.combatStats.combatExperience).toBeCloseTo(0.1, 8);
    });

    it("preserves shrine buffs through the worker DTO roundtrip", () => {
        const levels = Object.fromEntries(combatGuildBuffHrids.map((hrid, index) => [hrid, index + 2]));
        const direct = activatePermanentBuffs(buildPlayer(levels));
        const roundtrip = activatePermanentBuffs(Player.createFromDTO(structuredClone(buildPlayer(levels))));

        expect(roundtrip.guildBuffs.map((guildBuff) => [guildBuff.hrid, guildBuff.level]))
            .toEqual(direct.guildBuffs.map((guildBuff) => [guildBuff.hrid, guildBuff.level]));
        expect(roundtrip.combatDetails.maxHitpoints).toBe(direct.combatDetails.maxHitpoints);
        expect(roundtrip.combatDetails.combatStats.attackInterval).toBe(direct.combatDetails.combatStats.attackInterval);
        expect(roundtrip.combatDetails.combatStats.combatExperience).toBe(direct.combatDetails.combatStats.combatExperience);
    });
});

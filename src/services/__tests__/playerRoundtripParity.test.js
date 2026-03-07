import { describe, expect, it } from "vitest";
import achievementDetailMap from "../../combatsimulator/data/achievementDetailMap.json";
import achievementTierDetailMap from "../../combatsimulator/data/achievementTierDetailMap.json";
import CombatSimulator from "../../combatsimulator/combatSimulator.js";
import Player from "../../combatsimulator/player.js";
import Zone from "../../combatsimulator/zone.js";
import { importSoloConfig } from "../importExportMapper.js";
import { buildPlayersForSimulation, createEmptyPlayerConfig } from "../playerMapper.js";
import legacySoloJunglePlanetFixture from "./fixtures/legacySoloJunglePlanetFixture.json";

const ONE_HOUR = 60 * 60 * 1e9;
const FIXTURE_ZONE_HRID = "/actions/combat/jungle_planet";
const FIXTURE_DIFFICULTY_TIER = 1;
const FIXTURE_SIMULATION_HOURS = 24;

function createSimulationSettings() {
    return {
        mode: "zone",
        runScope: "single",
        useDungeon: false,
        zoneHrid: FIXTURE_ZONE_HRID,
        dungeonHrid: "",
        difficultyTier: FIXTURE_DIFFICULTY_TIER,
        labyrinthHrid: "",
        roomLevel: 100,
        simulationTimeHours: FIXTURE_SIMULATION_HOURS,
        mooPass: false,
        comExpEnabled: false,
        comExp: 1,
        comDropEnabled: false,
        comDrop: 1,
        enableHpMpVisualization: false,
    };
}

function createSeededRandom(seed = 1) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

async function withSeededRandom(seed, callback) {
    const originalRandom = Math.random;
    Math.random = createSeededRandom(seed);

    try {
        return await callback();
    } finally {
        Math.random = originalRandom;
    }
}

function createCompletedAchievementMapForFirstTier() {
    const firstTier = Object.values(achievementTierDetailMap)[0];
    const tierAchievements = Object.values(achievementDetailMap)
        .filter((detail) => detail.tierHrid === firstTier?.hrid);

    expect(firstTier).toBeTruthy();
    expect(tierAchievements.length).toBeGreaterThan(0);

    return Object.fromEntries(tierAchievements.map((achievement) => [achievement.hrid, true]));
}

function createImportedPlayerConfig(overrides = {}) {
    const result = importSoloConfig(
        JSON.stringify(legacySoloJunglePlanetFixture),
        createEmptyPlayerConfig(1),
        createSimulationSettings()
    );

    return {
        ...result.player,
        selected: true,
        ...overrides,
    };
}

function createSimulationPlayer(overrides = {}) {
    const [player] = buildPlayersForSimulation([createImportedPlayerConfig(overrides)]);
    return player;
}

function activatePermanentBuffs(player) {
    player.zoneBuffs = [];
    player.extraBuffs = [];
    player.generatePermanentBuffs();
    player.reset(0);
    return player;
}

function capturePermanentBuffCombatStats(player) {
    return {
        combatExperience: player.combatDetails.combatStats.combatExperience,
        combatRareFind: player.combatDetails.combatStats.combatRareFind,
        castSpeed: player.combatDetails.combatStats.castSpeed,
        hpRegenPer10: player.combatDetails.combatStats.hpRegenPer10,
        mpRegenPer10: player.combatDetails.combatStats.mpRegenPer10,
    };
}

async function runDeterministicSimulation(player, seed) {
    const zone = new Zone(FIXTURE_ZONE_HRID, FIXTURE_DIFFICULTY_TIER);
    player.zoneBuffs = zone?.buffs || [];
    player.extraBuffs = [];

    return withSeededRandom(seed, async () => {
        const simulator = new CombatSimulator([player], zone, null, { enableHpMpVisualization: false });
        return simulator.simulate(FIXTURE_SIMULATION_HOURS * ONE_HOUR);
    });
}

function totalExperience(simResult, playerHrid = "player1") {
    return Object.values(simResult?.experienceGained?.[playerHrid] ?? {})
        .reduce((sum, value) => sum + Number(value || 0), 0);
}

describe("player worker roundtrip parity", () => {
    it("preserves imported legacy permanent buffs across worker roundtrip", () => {
        const achievementMap = createCompletedAchievementMapForFirstTier();
        const directPlayer = activatePermanentBuffs(createSimulationPlayer({ achievements: achievementMap }));
        const roundtripPlayer = activatePermanentBuffs(Player.createFromDTO(structuredClone(directPlayer)));

        expect(directPlayer.houseRooms).toHaveLength(roundtripPlayer.houseRooms.length);
        expect(directPlayer.houseRooms.length).toBeGreaterThan(0);
        expect(directPlayer.achievements?.buffs?.length).toBeGreaterThan(0);
        expect(roundtripPlayer.achievements?.buffs?.length).toBe(directPlayer.achievements?.buffs?.length);
        expect(capturePermanentBuffCombatStats(roundtripPlayer)).toEqual(capturePermanentBuffCombatStats(directPlayer));
    });

    it("matches deterministic combat results after worker roundtrip for the jungle planet legacy fixture", async () => {
        const seed = 20260307;
        const directResult = await runDeterministicSimulation(createSimulationPlayer(), seed);
        const roundtripResult = await runDeterministicSimulation(
            Player.createFromDTO(structuredClone(createSimulationPlayer())),
            seed
        );

        expect(roundtripResult.encounters).toBe(directResult.encounters);
        expect(roundtripResult.deaths?.player1 ?? 0).toBe(directResult.deaths?.player1 ?? 0);
        expect(totalExperience(roundtripResult)).toBe(totalExperience(directResult));
    });
});

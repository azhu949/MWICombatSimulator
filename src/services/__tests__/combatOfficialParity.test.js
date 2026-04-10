import { describe, expect, it, vi } from "vitest";
import CombatSimulator from "../../combatsimulator/combatSimulator.js";
import Trigger from "../../combatsimulator/trigger.js";
import Zone from "../../combatsimulator/zone.js";
import itemDetailMap from "../../combatsimulator/data/itemDetailMap.json";
import { buildSimulationExtraBuffs } from "../../shared/simulationExtraBuffs.js";
import { importSoloConfig } from "../importExportMapper.js";
import { buildPlayersForSimulation, createEmptyPlayerConfig } from "../playerMapper.js";
import junglePlanetOfficialParityUser from "./fixtures/junglePlanetOfficialParityUser.json";

const ONE_SECOND = 1e9;
const ONE_HOUR = 60 * 60 * ONE_SECOND;
const PARITY_SEEDS = Array.from({ length: 20 }, (_, index) => 20260410 + index);
const OFFICIAL_TARGET_EPH = 195.6;
const OFFICIAL_TOLERANCE = 1.0;

const importedParityConfig = importSoloConfig(
    JSON.stringify(junglePlanetOfficialParityUser),
    createEmptyPlayerConfig(1),
    {}
);

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

function buildParityExtra(settings = {}) {
    return {
        mooPass: Boolean(settings?.mooPass),
        comExp: settings?.comExpEnabled ? Number(settings?.comExp || 20) : 0,
        comDrop: settings?.comDropEnabled ? Number(settings?.comDrop || 20) : 0,
    };
}

function createParitySimulationContext() {
    const playerConfig = structuredClone(importedParityConfig.player);
    const settings = structuredClone(importedParityConfig.simulationSettings);
    const [player] = buildPlayersForSimulation([{ ...playerConfig, selected: true }]);
    const zone = new Zone(settings.zoneHrid, settings.difficultyTier);

    player.zoneBuffs = zone?.buffs || [];
    player.extraBuffs = buildSimulationExtraBuffs(buildParityExtra(settings));

    return {
        player,
        settings,
        zone,
    };
}

async function runParitySimulation(seed) {
    const { player, settings, zone } = createParitySimulationContext();

    return withSeededRandom(seed, async () => {
        const simulator = new CombatSimulator([player], zone, null, { enableHpMpVisualization: false });
        const simResult = await simulator.simulate(Math.max(1, Number(settings.simulationTimeHours || 24)) * ONE_HOUR);
        const simulatedHours = Math.max(1e-9, Number(simResult?.simulatedTime ?? 0) / ONE_HOUR);
        const totalExperience = Object.values(simResult?.experienceGained?.player1 ?? {})
            .reduce((sum, value) => sum + Number(value || 0), 0);

        return {
            totalXpPerHour: totalExperience / simulatedHours,
            encountersPerHour: Number(simResult?.encounters ?? 0) / simulatedHours,
        };
    });
}

function summarizeMetric(samples) {
    const safeSamples = samples.map((value) => Number(value || 0));
    return {
        mean: safeSamples.reduce((sum, value) => sum + value, 0) / Math.max(1, safeSamples.length),
        min: Math.min(...safeSamples),
        max: Math.max(...safeSamples),
    };
}

function createStubUnit(currentHitpoints) {
    return {
        combatDetails: {
            currentHitpoints,
            maxHitpoints: Math.max(1, currentHitpoints),
            currentManapoints: 0,
            maxManapoints: 0,
        },
        combatBuffs: {},
        isStunned: false,
        stunExpireTime: null,
        isBlinded: false,
        blindExpireTime: null,
        isSilenced: false,
        silenceExpireTime: null,
    };
}

describe("combat official parity", () => {
    it("keeps the next encounter from starting before the zone cadence floor", () => {
        const simulator = new CombatSimulator([], { baseTimeCost: 15 * ONE_SECOND }, null, { enableHpMpVisualization: false });
        simulator.encounterStartTime = 10 * ONE_SECOND;
        simulator.simulationTime = 18 * ONE_SECOND;

        expect(simulator.calculateNextEncounterRespawnTime()).toBe(22 * ONE_SECOND);
    });

    it("still uses the existing kill plus respawn cadence when the fight already exceeded the base time cost", () => {
        const simulator = new CombatSimulator([], { baseTimeCost: 15 * ONE_SECOND }, null, { enableHpMpVisualization: false });
        simulator.encounterStartTime = 10 * ONE_SECOND;
        simulator.simulationTime = 26 * ONE_SECOND;

        expect(simulator.calculateNextEncounterRespawnTime()).toBe(29 * ONE_SECOND);
    });

    it("keeps all-enemies current-hp triggers on summed active hp", () => {
        const trigger = new Trigger(
            "/combat_trigger_dependencies/all_enemies",
            "/combat_trigger_conditions/current_hp",
            "/combat_trigger_comparators/greater_than_equal",
            500
        );

        const enemies = [createStubUnit(300), createStubUnit(250)];
        expect(trigger.isActive(createStubUnit(1), null, [], enemies, 0)).toBe(true);
    });

    it("keeps expert task badges out of combat simulation builds", () => {
        const player = createEmptyPlayerConfig(1);
        const taskBadge = itemDetailMap["/items/expert_task_badge"];

        expect(taskBadge).toBeTruthy();

        player.equipment.trinket = {
            itemHrid: taskBadge.hrid,
            enhancementLevel: 0,
        };

        const [simulationPlayer] = buildPlayersForSimulation([player]);

        expect(simulationPlayer.equipment["/equipment_types/trinket"]).toBeUndefined();
        expect(simulationPlayer.combatDetails.combatStats.taskDamage).toBe(0);
    });

    it("matches the official jungle planet eph band for the provided user build", { timeout: 300000 }, async () => {
        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        try {
            const samples = [];
            for (const seed of PARITY_SEEDS) {
                samples.push(await runParitySimulation(seed));
            }

            const totalXpPerHour = summarizeMetric(samples.map((sample) => sample.totalXpPerHour));
            const encountersPerHour = summarizeMetric(samples.map((sample) => sample.encountersPerHour));

            expect(totalXpPerHour.min).toBeLessThanOrEqual(totalXpPerHour.mean);
            expect(totalXpPerHour.max).toBeGreaterThanOrEqual(totalXpPerHour.mean);
            expect(encountersPerHour.min).toBeLessThanOrEqual(encountersPerHour.mean);
            expect(encountersPerHour.max).toBeGreaterThanOrEqual(encountersPerHour.mean);
            expect(totalXpPerHour.mean).toBeGreaterThan(0);
            expect(encountersPerHour.mean).toBeGreaterThanOrEqual(OFFICIAL_TARGET_EPH - OFFICIAL_TOLERANCE);
            expect(encountersPerHour.mean).toBeLessThanOrEqual(OFFICIAL_TARGET_EPH + OFFICIAL_TOLERANCE);
        } finally {
            consoleSpy.mockRestore();
        }
    });
});

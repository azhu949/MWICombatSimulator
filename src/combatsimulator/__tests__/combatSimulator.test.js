import { describe, expect, it } from "vitest";
import CombatSimulator from "../combatSimulator.js";
import Zone from "../zone.js";

describe("CombatSimulator", () => {
    it("uses the fixed encounter respawn interval instead of the zone base time cost", () => {
        const simulator = new CombatSimulator([], new Zone("/actions/combat/sorcerers_tower", 4), null, {});

        simulator.simulationTime = 1e9;
        simulator.encounterStartTime = 0;

        expect(simulator.calculateNextEncounterRespawnTime()).toBe(4e9);
    });
});

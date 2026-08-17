import { describe, expect, it } from "vitest";
import CombatSimulator from "../combatSimulator.js";
import Zone from "../zone.js";
import EventQueue from "../events/eventQueue.js";

class BoundaryProbeSimulator extends CombatSimulator {
    constructor(eventTimes) {
        super([], null, null, {});
        this.eventTimes = eventTimes;
        this.processedEventTimes = [];
    }

    reset() {
        super.reset();
        this.processedEventTimes = [];
        for (const time of this.eventTimes) {
            this.eventQueue.addEvent({ type: "boundaryProbe", time });
        }
    }

    async processEvent(event) {
        this.simulationTime = event.time;
        if (event.type === "boundaryProbe") {
            this.processedEventTimes.push(event.time);
        }
    }
}

describe("CombatSimulator", () => {
    it("uses the fixed encounter respawn interval instead of the zone base time cost", () => {
        const simulator = new CombatSimulator([], new Zone("/actions/combat/sorcerers_tower", 4), null, {});

        simulator.simulationTime = 1e9;
        simulator.encounterStartTime = 0;

        expect(simulator.calculateNextEncounterRespawnTime()).toBe(4e9);
    });

    it("treats the simulation horizon as half-open", async () => {
        const simulator = new BoundaryProbeSimulator([99, 100, 101]);

        const result = await simulator.simulate(100);

        expect(simulator.processedEventTimes).toEqual([99]);
        expect(simulator.eventQueue.peekNextEvent()).toMatchObject({ time: 100 });
        expect(result.simulatedTime).toBe(100);
    });

    it("emits initial and terminal progress for a zero-length simulation", async () => {
        const simulator = new BoundaryProbeSimulator([0, 1]);
        const progressValues = [];
        simulator.addEventListener("progress", (event) => {
            progressValues.push(event.detail.progress);
        });

        const result = await simulator.simulate(0);

        expect(simulator.processedEventTimes).toEqual([]);
        expect(result.simulatedTime).toBe(0);
        expect(progressValues).toEqual([0, 1]);
    });

    it("dispatches terminal progress when the horizon ends before a periodic tick", async () => {
        const simulator = new BoundaryProbeSimulator([99]);
        const progressValues = [];
        simulator.addEventListener("progress", (event) => {
            progressValues.push(event.detail.progress);
        });

        await simulator.simulate(100);

        expect(progressValues.at(-1)).toBe(1);
    });

    it("peeks the earliest event without removing it", () => {
        const queue = new EventQueue();
        const later = { type: "later", time: 20 };
        const earlier = { type: "earlier", time: 10 };
        queue.addEvent(later);
        queue.addEvent(earlier);

        expect(queue.peekNextEvent()).toBe(earlier);
        expect(queue.getNextEvent()).toBe(earlier);
        expect(queue.getNextEvent()).toBe(later);
    });
});

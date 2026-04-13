import { describe, expect, it } from "vitest";
import Zone from "../zone.js";

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

describe("Zone", () => {
    it("can repeat normal monsters within a Sorcerer's Tower encounter", async () => {
        await withSeededRandom(20260413, async () => {
            let foundRepeatedEncounter = false;

            for (let index = 0; index < 200; index += 1) {
                const zone = new Zone("/actions/combat/sorcerers_tower", 4);
                const monsterHrids = zone.getRandomEncounter().map((monster) => monster.hrid);

                if (new Set(monsterHrids).size < monsterHrids.length) {
                    foundRepeatedEncounter = true;
                    break;
                }
            }

            expect(foundRepeatedEncounter).toBe(true);
        });
    });

    it("allows repeated normal monsters within a Jungle Planet encounter", async () => {
        await withSeededRandom(20260413, async () => {
            let foundRepeatedEncounter = false;

            for (let index = 0; index < 200; index += 1) {
                const zone = new Zone("/actions/combat/jungle_planet", 2);
                const monsterHrids = zone.getRandomEncounter().map((monster) => monster.hrid);

                if (new Set(monsterHrids).size < monsterHrids.length) {
                    foundRepeatedEncounter = true;
                    break;
                }
            }

            expect(foundRepeatedEncounter).toBe(true);
        });
    });
});

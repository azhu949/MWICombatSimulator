import { describe, expect, it, vi } from "vitest";
import { ONE_HOUR } from "../simulationDomain.js";
import { summarizeAdvisorTargetResult } from "../advisorDomain.js";

vi.mock("../simulationDomain.js", async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        summarizeResult: () => [
            {
                playerHrid: "player1",
                playerName: "One",
                encountersPerHour: 7,
                profitPerHour: 100,
                totalXpPerHour: 200,
                deathsPerHour: 1,
            },
            {
                playerHrid: "player2",
                playerName: "Two",
                encountersPerHour: 23,
                profitPerHour: 300,
                totalXpPerHour: 400,
                deathsPerHour: 5,
            },
        ],
    };
});

describe("advisorDomain metric player summary", () => {
    it("takes kills per hour from the resolved metric player row", () => {
        const sample = summarizeAdvisorTargetResult({
            simulatedTime: ONE_HOUR,
            encounters: 999,
        }, [
            { id: "1", name: "One" },
            { id: "2", name: "Two" },
        ], "2");

        expect(sample.metricPlayerId).toBe("2");
        expect(sample.killsPerHour).toBe(23);
        expect(sample.profitPerHour).toBe(300);
        expect(sample.xpPerHour).toBe(400);
        expect(sample.deathsPerHour).toBe(5);
    });
});

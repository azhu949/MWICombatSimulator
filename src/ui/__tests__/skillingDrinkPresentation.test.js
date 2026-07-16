import { describe, expect, it } from "vitest";
import { buildSkillingDrinkStatuses } from "../skillingDrinkPresentation.js";

describe("skillingDrinkPresentation", () => {
    it("describes newly consumed drinks and their ending remainder", () => {
        expect(buildSkillingDrinkStatuses({
            drinks: [{ itemHrid: "/items/artisan_tea", count: 1, carriedDurationSeconds: 0 }],
            endingDrinkState: {
                itemsByHrid: { "/items/artisan_tea": { remainingSeconds: 291 } },
            },
        })).toEqual([{
            itemHrid: "/items/artisan_tea",
            consumedCount: 1,
            continued: false,
            endingKnown: true,
            remainingSeconds: 291,
            usedUp: false,
        }]);
    });

    it("distinguishes a continued drink from an additional consumed drink", () => {
        expect(buildSkillingDrinkStatuses({
            drinks: [{ itemHrid: "/items/artisan_tea", count: 0, carriedDurationSeconds: 291 }],
            endingDrinkState: {
                itemsByHrid: { "/items/artisan_tea": { remainingSeconds: 282 } },
            },
        })[0]).toMatchObject({
            consumedCount: 0,
            continued: true,
            remainingSeconds: 282,
            usedUp: false,
        });
        expect(buildSkillingDrinkStatuses({
            drinks: [{ itemHrid: "/items/artisan_tea", count: 2, carriedDurationSeconds: 30 }],
            endingDrinkState: {
                itemsByHrid: { "/items/artisan_tea": { remainingSeconds: 120 } },
            },
        })[0]).toMatchObject({
            consumedCount: 2,
            continued: true,
            remainingSeconds: 120,
        });
    });

    it("reports a known exhausted drink without treating unknown state as exhausted", () => {
        expect(buildSkillingDrinkStatuses({
            drinks: [{ itemHrid: "/items/artisan_tea", count: 111 }],
            endingDrinkState: {
                itemsByHrid: { "/items/artisan_tea": { remainingSeconds: 0 } },
            },
        })[0]).toMatchObject({ endingKnown: true, usedUp: true });
        expect(buildSkillingDrinkStatuses({
            drinks: [{ itemHrid: "/items/artisan_tea", count: 1 }],
        })[0]).toMatchObject({ endingKnown: false, usedUp: false });
    });

    it("keeps exhaustion known when a merged route ends with a no-drink tail", () => {
        expect(buildSkillingDrinkStatuses({
            drinks: [{ itemHrid: "/items/artisan_tea", count: 1 }],
            endingDrinkState: null,
            phases: [
                {
                    drinks: [{ itemHrid: "/items/artisan_tea", count: 1 }],
                    endingDrinkState: {
                        itemsByHrid: { "/items/artisan_tea": { remainingSeconds: 0 } },
                    },
                },
                { drinks: [], endingDrinkState: null },
            ],
        })[0]).toMatchObject({
            endingKnown: true,
            remainingSeconds: 0,
            usedUp: true,
        });
    });

    it("keeps independent status for multiple drinks in a merged stage", () => {
        const statuses = buildSkillingDrinkStatuses({
            drinks: [
                { itemHrid: "/items/artisan_tea", count: 2, carriedDurationSeconds: 30 },
                { itemHrid: "/items/wisdom_tea", count: 0, carriedDurationSeconds: 180 },
            ],
            endingDrinkState: {
                itemsByHrid: {
                    "/items/artisan_tea": { remainingSeconds: 120 },
                    "/items/wisdom_tea": { remainingSeconds: 0 },
                },
            },
        });

        expect(statuses).toEqual([
            expect.objectContaining({
                itemHrid: "/items/artisan_tea",
                consumedCount: 2,
                continued: true,
                remainingSeconds: 120,
                usedUp: false,
            }),
            expect.objectContaining({
                itemHrid: "/items/wisdom_tea",
                consumedCount: 0,
                continued: true,
                remainingSeconds: 0,
                usedUp: true,
            }),
        ]);
    });
});

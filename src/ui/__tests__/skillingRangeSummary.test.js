import { describe, expect, it } from "vitest";
import { buildSkillingRangeSummary } from "../skillingRangeSummary.js";

function equipment(itemHrid) {
    return [{
        equipmentType: "/equipment_types/tool",
        itemHrid,
        enhancementLevel: 10,
    }];
}

describe("skillingRangeSummary", () => {
    it("aggregates a configured level range without double-counting nested phases", () => {
        const segments = [
            {
                fromLevel: 94,
                toLevel: 95,
                actionHrid: "/actions/tailoring/shadow_leather",
                completionCount: 5,
                gainedExperience: 50,
                durationHours: 1,
                netCost: 70,
                purchaseCost: 100,
                drinkPurchaseCost: 40,
                materialPurchaseCost: 60,
                opportunityCost: 20,
                outputValue: 50,
                equipmentChanges: 1,
                equipment: equipment("/items/star_shears"),
                inputItems: [{
                    itemHrid: "/items/shadow_hide",
                    count: 10,
                    ownedCount: 4,
                    purchaseCount: 6,
                    opportunityCost: 20,
                    purchaseCost: 60,
                    purchaseUnitPrice: 10,
                }],
                outputItems: [{
                    itemHrid: "/items/tailoring_essence",
                    count: 2,
                    liquidationValue: 20,
                    liquidationUnitPrice: 10,
                }],
                drinks: [{
                    itemHrid: "/items/ultimate_tailoring_tea",
                    count: 2,
                    carriedDurationSeconds: 30,
                }],
            },
            {
                fromLevel: 95,
                toLevel: 97,
                actionHrid: "/actions/tailoring/shadow_leather",
                completionCount: 5,
                gainedExperience: 70,
                durationHours: 2,
                netCost: 190,
                purchaseCost: 220,
                drinkPurchaseCost: 40,
                materialPurchaseCost: 180,
                opportunityCost: 30,
                outputValue: 60,
                equipmentChanges: 2,
                inputItems: [{
                    itemHrid: "/items/shadow_hide",
                    count: 15,
                    ownedCount: 1,
                    purchaseCount: 14,
                    opportunityCost: 8,
                    purchaseCost: 168,
                    purchaseUnitPrice: 12,
                }],
                outputItems: [{
                    itemHrid: "/items/tailoring_essence",
                    count: 3,
                    liquidationValue: 33,
                    liquidationUnitPrice: 11,
                }],
                drinks: [{ itemHrid: "/items/ultimate_tailoring_tea", count: 3 }],
                equipmentStrategies: [
                    {
                        fromLevel: 95,
                        toLevel: 96,
                        equipment: equipment("/items/star_shears"),
                        completionCount: 2,
                        gainedExperience: 20,
                        durationHours: 0.5,
                    },
                    {
                        fromLevel: 96,
                        toLevel: 97,
                        equipment: equipment("/items/sacred_chisel"),
                        completionCount: 3,
                        gainedExperience: 50,
                        durationHours: 1.5,
                    },
                ],
                endingDrinkState: {
                    itemsByHrid: {
                        "/items/ultimate_tailoring_tea": { remainingSeconds: 45 },
                    },
                },
                phases: [
                    {
                        fromLevel: 95,
                        toLevel: 96,
                        actionHrid: "/actions/tailoring/shadow_leather",
                        completionCount: 2,
                        gainedExperience: 20,
                        durationHours: 0.5,
                        equipment: equipment("/items/star_shears"),
                    },
                    {
                        fromLevel: 96,
                        toLevel: 97,
                        actionHrid: "/actions/tailoring/moon_leather",
                        completionCount: 3,
                        gainedExperience: 50,
                        durationHours: 1.5,
                        equipment: equipment("/items/sacred_chisel"),
                    },
                ],
            },
        ];

        const summary = buildSkillingRangeSummary(segments, { startLevel: 94, targetLevel: 100 });

        expect(summary).toMatchObject({
            fromLevel: 94,
            toLevel: 100,
            completionCount: 10,
            gainedExperience: 120,
            durationHours: 3,
            netCost: 260,
            purchaseCost: 320,
            drinkPurchaseCost: 80,
            materialPurchaseCost: 240,
            opportunityCost: 50,
            outputValue: 110,
            equipmentChanges: 3,
            requiredCompletionCount: 10,
            estimatedLevelDurationHours: 3,
            costPerExperience: 260 / 120,
            materialPurchaseCostPerExperience: 2,
            experiencePerHour: 40,
            actionHrids: ["/actions/tailoring/shadow_leather"],
            phaseCount: 2,
            isRangeSummary: true,
        });
        expect(summary.inputItems).toEqual([expect.objectContaining({
            itemHrid: "/items/shadow_hide",
            count: 25,
            ownedCount: 5,
            purchaseCount: 20,
            opportunityCost: 28,
            purchaseCost: 228,
            opportunityUnitPrice: 5.6,
            purchaseUnitPrice: 11.4,
        })]);
        expect(summary.outputItems).toEqual([expect.objectContaining({
            itemHrid: "/items/tailoring_essence",
            count: 5,
            liquidationValue: 53,
            liquidationUnitPrice: 10.6,
        })]);
        expect(summary.drinks).toEqual([expect.objectContaining({
            itemHrid: "/items/ultimate_tailoring_tea",
            count: 5,
            carriedDurationSeconds: 30,
        })]);
        expect(summary.phases).toHaveLength(2);
        expect(summary.phases[0]).not.toBe(segments[0]);
        expect(summary.phases[1]).not.toBe(segments[1]);
        expect(summary.phases[1].phases).toBe(segments[1].phases);
        expect(summary.endingDrinkState).toBe(segments[1].endingDrinkState);
    });

    it("keeps enhancement rows separate and merges only adjacent equipment strategies", () => {
        const segments = [
            {
                fromLevel: 10,
                toLevel: 11,
                actionHrid: "/actions/a",
                completionCount: 2,
                equipment: equipment("/items/tool_a"),
                inputItems: [
                    { itemHrid: "/items/charm", enhancementLevel: 10, count: 2 },
                    { itemHrid: "", count: 999 },
                ],
                outputItems: [],
                drinks: [],
            },
            {
                fromLevel: 11,
                toLevel: 12,
                actionHrid: "/actions/a",
                completionCount: 3,
                equipmentStrategies: [{
                    equipment: equipment("/items/tool_a"),
                    completionCount: 3,
                    durationHours: 1,
                    gainedExperience: 30,
                    fromLevel: 11,
                    toLevel: 12,
                }],
                inputItems: [
                    { itemHrid: "/items/charm", enhancementLevel: 10, count: 3 },
                    { itemHrid: "/items/charm", enhancementLevel: 11, count: 4 },
                ],
                outputItems: [],
                drinks: [],
            },
            {
                fromLevel: 12,
                toLevel: 13,
                actionHrid: "/actions/b",
                completionCount: 4,
                equipment: equipment("/items/tool_b"),
                inputItems: [],
                outputItems: [],
                drinks: [],
            },
            {
                fromLevel: 13,
                toLevel: 14,
                actionHrid: "/actions/a",
                completionCount: 5,
                equipment: equipment("/items/tool_a"),
                inputItems: [],
                outputItems: [],
                drinks: [],
            },
        ];
        const before = structuredClone(segments);

        const summary = buildSkillingRangeSummary(segments);

        expect(summary.inputItems).toEqual([
            expect.objectContaining({ enhancementLevel: 10, count: 5 }),
            expect.objectContaining({ enhancementLevel: 11, count: 4 }),
        ]);
        expect(summary.equipmentStrategies.map((strategy) => ({
            itemHrid: strategy.equipment[0]?.itemHrid,
            completionCount: strategy.completionCount,
            fromLevel: strategy.fromLevel,
            toLevel: strategy.toLevel,
        }))).toEqual([
            { itemHrid: "/items/tool_a", completionCount: 5, fromLevel: 10, toLevel: 12 },
            { itemHrid: "/items/tool_b", completionCount: 4, fromLevel: 12, toLevel: 13 },
            { itemHrid: "/items/tool_a", completionCount: 5, fromLevel: 13, toLevel: 14 },
        ]);
        expect(summary).toMatchObject({
            fromLevel: 10,
            toLevel: 14,
            actionHrids: ["/actions/a", "/actions/b"],
            phaseCount: 4,
        });
        expect(segments).toEqual(before);
    });

    it("normalizes invalid totals and returns null when there are no segments", () => {
        expect(buildSkillingRangeSummary(null)).toBeNull();
        expect(buildSkillingRangeSummary([null, undefined])).toBeNull();

        expect(buildSkillingRangeSummary([{
            fromLevel: 1,
            toLevel: 2,
            actionHrid: " /actions/a ",
            completionCount: "not-a-number",
            gainedExperience: 0,
            durationHours: 0,
            netCost: Number.NaN,
        }], { startLevel: "", targetLevel: false })).toMatchObject({
            fromLevel: 1,
            toLevel: 2,
            completionCount: 0,
            gainedExperience: 0,
            durationHours: 0,
            netCost: 0,
            costPerExperience: 0,
            experiencePerHour: 0,
            actionHrids: ["/actions/a"],
            phaseCount: 1,
        });
    });
});

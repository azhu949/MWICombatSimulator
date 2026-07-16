import { describe, expect, it } from "vitest";
import { itemDetailIndex, levelExperienceTable, skillingData } from "../../shared/gameDataIndex.js";
import {
    SKILLING_BALANCED_COST_TOLERANCE,
    SKILLING_OPTIMIZATION_MODE_BALANCED,
    SKILLING_OPTIMIZATION_MODE_COST,
    SKILLING_OPTIMIZATION_MODE_SPEED,
    buildSkillingOverview,
    buildSkillingEquipmentLoadouts,
    calculateSkillingActionCandidate,
    collapseDrinkOnlyLevelPhases,
    collectSkillingProfileBonuses,
    compareCandidates,
    normalizeSkillingBalancedCostTolerance,
    normalizeSkillingOptimizationMode,
    planSkillingSkill,
    planSkillingUpgrades,
    resolveEnhancedEquipmentStats,
    resolveSkillingPrice,
} from "../skillingPlanner.js";

const SKILL_HRID = "/skills/brewing";
const ACTION_TYPE_HRID = "/action_types/brewing";

function priceTable(entries = {}) {
    return {
        "/items/coin": { ask: 1, bid: 1, vendor: 1 },
        ...entries,
    };
}

function emptyLoadout(patch = {}) {
    return {
        items: [],
        bonuses: { actionSpeed: 0, efficiency: 0, outputQuantity: 0, experience: 0, essenceFind: 0, rareFind: 0 },
        drinkSlots: 1,
        drinkConcentration: 0,
        equipmentChanges: 0,
        ...patch,
    };
}

function action(patch = {}) {
    return {
        hrid: "/actions/brewing/test",
        name: "Test Brew",
        type: ACTION_TYPE_HRID,
        sortIndex: 1,
        levelRequirement: { skillHrid: SKILL_HRID, level: 1 },
        baseTimeSeconds: 2,
        experienceGain: { skillHrid: SKILL_HRID, value: 10 },
        inputItems: [{ itemHrid: "/items/raw", count: 10 }],
        outputItems: [{ itemHrid: "/items/product", count: 1 }],
        upgradeItemHrid: "/items/base",
        essenceDropTable: [{ itemHrid: "/items/essence", dropRate: 0.5, minCount: 1, maxCount: 1 }],
        rareDropTable: [{ itemHrid: "/items/rare", dropRate: 0.1, minCount: 1, maxCount: 3 }],
        ...patch,
    };
}

function displayPhase(patch = {}) {
    return {
        actionHrid: "/actions/brewing/test",
        actionSortIndex: 1,
        equipmentSignature: "tool-a",
        externalBonusSignature: "external-a",
        drinkSignature: "drink-a",
        bonusSignature: "bonus-a",
        fromLevel: 94,
        toLevel: 94,
        completionCount: 1,
        requiredCompletionCount: 1,
        gainedExperience: 10,
        durationHours: 1,
        estimatedLevelDurationHours: 1,
        netCost: 1,
        costPerExperience: 0.1,
        opportunityCost: 1,
        purchaseCost: 1,
        drinkPurchaseCost: 0,
        materialPurchaseCost: 1,
        materialPurchaseCostPerExperience: 0.1,
        outputValue: 0,
        experiencePerHour: 10,
        inputItems: [],
        outputItems: [],
        drinks: [],
        equipment: [],
        bonuses: {},
        endingDrinkState: null,
        equipmentChanges: 0,
        ...patch,
    };
}

describe("skillingPlanner", () => {
    it("collapses drink-only phases within each consecutive base-strategy run", () => {
        const phases = [
            displayPhase(),
            displayPhase({ drinkSignature: "drink-b", bonusSignature: "bonus-b" }),
            displayPhase({
                equipmentSignature: "tool-b",
                drinkSignature: "drink-a",
                bonusSignature: "bonus-a",
            }),
            displayPhase({
                equipmentSignature: "tool-b",
                drinkSignature: "drink-b",
                bonusSignature: "bonus-b",
            }),
            displayPhase({
                equipmentSignature: "tool-b",
                externalBonusSignature: "external-b",
                drinkSignature: "drink-a",
                bonusSignature: "bonus-a",
            }),
            displayPhase({
                equipmentSignature: "tool-b",
                externalBonusSignature: "external-b",
                drinkSignature: "drink-b",
                bonusSignature: "bonus-b",
            }),
            displayPhase({
                actionHrid: "/actions/brewing/other",
                equipmentSignature: "tool-b",
                externalBonusSignature: "external-b",
                drinkSignature: "drink-a",
                bonusSignature: "bonus-a",
            }),
            displayPhase({
                actionHrid: "/actions/brewing/other",
                equipmentSignature: "tool-b",
                externalBonusSignature: "external-b",
                drinkSignature: "drink-b",
                bonusSignature: "bonus-b",
            }),
        ];

        const result = collapseDrinkOnlyLevelPhases(phases);

        expect(result).toHaveLength(4);
        expect(result.map((segment) => segment.phases)).toEqual([
            phases.slice(0, 2),
            phases.slice(2, 4),
            phases.slice(4, 6),
            phases.slice(6, 8),
        ]);
        expect(result.map((segment) => segment.completionCount)).toEqual([2, 2, 2, 2]);
        expect(result.map((segment) => segment.drinkSignature)).toEqual([
            "drink-a~drink-b",
            "drink-a~drink-b",
            "drink-a~drink-b",
            "drink-a~drink-b",
        ]);
    });

    it("preserves a bonus strategy change when the drink loadout does not change", () => {
        const phases = [
            displayPhase(),
            displayPhase({ bonusSignature: "bonus-from-other-source" }),
        ];

        const result = collapseDrinkOnlyLevelPhases(phases);

        expect(result).toEqual(phases);
        expect(result.every((segment) => segment.phases == null)).toBe(true);
    });

    it("normalizes optimization modes and defaults unknown values to cost", () => {
        expect(normalizeSkillingOptimizationMode("SPEED")).toBe(SKILLING_OPTIMIZATION_MODE_SPEED);
        expect(normalizeSkillingOptimizationMode("BALANCED")).toBe(SKILLING_OPTIMIZATION_MODE_BALANCED);
        expect(normalizeSkillingOptimizationMode(SKILLING_OPTIMIZATION_MODE_COST)).toBe(SKILLING_OPTIMIZATION_MODE_COST);
        expect(normalizeSkillingOptimizationMode("unknown")).toBe(SKILLING_OPTIMIZATION_MODE_COST);
        expect(normalizeSkillingOptimizationMode()).toBe(SKILLING_OPTIMIZATION_MODE_COST);
        expect(SKILLING_BALANCED_COST_TOLERANCE).toBe(0.1);
    });

    it("normalizes balanced cost tolerances with a safe default and clamped bounds", () => {
        expect(normalizeSkillingBalancedCostTolerance()).toBe(SKILLING_BALANCED_COST_TOLERANCE);
        expect(normalizeSkillingBalancedCostTolerance(null)).toBe(SKILLING_BALANCED_COST_TOLERANCE);
        expect(normalizeSkillingBalancedCostTolerance("")).toBe(SKILLING_BALANCED_COST_TOLERANCE);
        expect(normalizeSkillingBalancedCostTolerance("invalid")).toBe(SKILLING_BALANCED_COST_TOLERANCE);
        expect(normalizeSkillingBalancedCostTolerance(Number.NaN)).toBe(SKILLING_BALANCED_COST_TOLERANCE);
        expect(normalizeSkillingBalancedCostTolerance(Number.POSITIVE_INFINITY))
            .toBe(SKILLING_BALANCED_COST_TOLERANCE);
        expect(normalizeSkillingBalancedCostTolerance(Symbol("invalid")))
            .toBe(SKILLING_BALANCED_COST_TOLERANCE);
        expect(normalizeSkillingBalancedCostTolerance(false)).toBe(SKILLING_BALANCED_COST_TOLERANCE);
        expect(normalizeSkillingBalancedCostTolerance(-0.25)).toBe(0);
        expect(normalizeSkillingBalancedCostTolerance(1.25)).toBe(1);
        expect(normalizeSkillingBalancedCostTolerance("0.2")).toBe(0.2);
    });

    it("ranks speed candidates by rounded required action duration before throughput and cost", () => {
        const candidates = [{
            actionHrid: "/actions/brewing/rounded_slower",
            requiredCompletionCount: 2.1,
            actionsPerHour: 12,
            experiencePerHour: 200,
            costPerExperience: 1,
            purchaseCost: 1,
            equipmentChanges: 0,
            actionSortIndex: 1,
            drinks: [],
        }, {
            actionHrid: "/actions/brewing/fewer_actions",
            requiredCompletionCount: 2,
            actionsPerHour: 10,
            experiencePerHour: 100,
            costPerExperience: 2,
            purchaseCost: 2,
            equipmentChanges: 0,
            actionSortIndex: 2,
            drinks: [],
        }];

        expect([...candidates]
            .sort((left, right) => compareCandidates(left, right, SKILLING_OPTIMIZATION_MODE_COST))[0]
            .actionHrid).toBe("/actions/brewing/rounded_slower");
        expect([...candidates]
            .sort((left, right) => compareCandidates(left, right, SKILLING_OPTIMIZATION_MODE_SPEED))[0]
            .actionHrid).toBe("/actions/brewing/fewer_actions");
    });

    it("uses realistic purchase and liquidation prices", () => {
        expect(resolveSkillingPrice(priceTable({
            "/items/raw": { ask: 120, bid: 100, vendor: 105 },
        }), "/items/raw")).toMatchObject({
            purchasePrice: 120,
            liquidationPrice: 105,
        });
        expect(resolveSkillingPrice(priceTable(), "/items/coin").liquidationPrice).toBe(1);
        expect(resolveSkillingPrice(priceTable({
            "/items/taxed": { ask: 120, bid: 100, vendor: 0 },
        }), "/items/taxed").liquidationPrice).toBe(98);
    });

    it("uses the base market bid as the floor when an enhanced item has no exact bid", () => {
        const prices = priceTable({
            "/items/base_gear": { ask: 120_000, bid: 120_000, vendor: 4_368 },
        });
        expect(resolveSkillingPrice(prices, "/items/base_gear", 0.02, {}, 7)).toMatchObject({
            purchasePrice: null,
            liquidationPrice: 117_600,
            hasExactEnhancementBid: false,
            liquidationSource: "base_bid_floor",
        });
        expect(resolveSkillingPrice(prices, "/items/base_gear", 0.02, {
            "/items/base_gear": { "7": { ask: 500_000 } },
        }, 7)).toMatchObject({
            purchasePrice: 500_000,
            liquidationPrice: 117_600,
            hasExactEnhancementBid: false,
        });
        expect(resolveSkillingPrice(prices, "/items/base_gear", 0.02, {
            "/items/base_gear": { "7": { ask: 500_000, bid: 400_000 } },
        }, 7)).toMatchObject({
            liquidationPrice: 392_000,
            hasExactEnhancementBid: true,
            liquidationSource: "market_bid",
        });
    });

    it("applies enhancement total multipliers to noncombat equipment stats", () => {
        const stats = resolveEnhancedEquipmentStats(
            { enhancementLevel: 2 },
            { noncombatStats: { brewingSpeed: 0.1 }, noncombatEnhancementBonuses: { brewingSpeed: 0.01 } },
            [0, 1, 2.1],
        );
        expect(stats.brewingSpeed).toBeCloseTo(0.121, 10);
    });

    it("keeps wearable inventory loadouts with different reservation identities", () => {
        const data = {
            totalBonusMultipliers: [0, 1],
            equipment: [
                { hrid: "/items/slow", equipmentType: "/equipment_types/brewing_tool", levelRequirements: [{ skillHrid: SKILL_HRID, level: 1 }], noncombatStats: { brewingSpeed: 0.1 }, noncombatEnhancementBonuses: {} },
                { hrid: "/items/fast", equipmentType: "/equipment_types/brewing_tool", levelRequirements: [{ skillHrid: SKILL_HRID, level: 5 }], noncombatStats: { brewingSpeed: 0.2 }, noncombatEnhancementBonuses: {} },
            ],
        };
        const profile = {
            equipment: [
                { id: "slow", itemHrid: "/items/slow", enhancementLevel: 0, isEquipped: false },
                { id: "fast", itemHrid: "/items/fast", enhancementLevel: 0, isEquipped: false },
            ],
        };
        const loadouts = buildSkillingEquipmentLoadouts(profile, SKILL_HRID, {
            [SKILL_HRID]: { level: 5 },
        }, data);
        expect(loadouts).toHaveLength(3);
        expect(loadouts.map((loadout) => loadout.items[0]?.itemHrid || "").sort()).toEqual([
            "",
            "/items/fast",
            "/items/slow",
        ]);

        const prunedLoadouts = buildSkillingEquipmentLoadouts(profile, SKILL_HRID, {
            [SKILL_HRID]: { level: 5 },
        }, data, {
            "/items/slow": 1,
            "/items/fast": 1,
        }, new Set());
        expect(prunedLoadouts).toHaveLength(1);
        expect(prunedLoadouts[0].items[0].itemHrid).toBe("/items/fast");
    });

    it("keeps gathering-quantity equipment in foraging loadouts", () => {
        const skillHrid = "/skills/foraging";
        const itemHrid = "/items/ring_of_gathering";
        const loadouts = buildSkillingEquipmentLoadouts({
            equipment: [{ id: "gathering-ring", itemHrid, enhancementLevel: 0, count: 1, isEquipped: false }],
        }, skillHrid, {
            [skillHrid]: { level: 1 },
        }, {
            totalBonusMultipliers: [0],
            equipment: [{
                hrid: itemHrid,
                equipmentType: "/equipment_types/ring",
                levelRequirements: [],
                drinkSlots: 0,
                noncombatStats: { gatheringQuantity: 0.2 },
                noncombatEnhancementBonuses: {},
            }],
        }, {
            [itemHrid]: 1,
        }, new Set());

        expect(loadouts).toHaveLength(1);
        expect(loadouts[0].items[0].itemHrid).toBe(itemHrid);
        expect(loadouts[0].bonuses.outputQuantity).toBeCloseTo(0.2);

        const productionLoadouts = buildSkillingEquipmentLoadouts({
            equipment: [{ id: "gathering-ring", itemHrid, enhancementLevel: 0, count: 1, isEquipped: false }],
        }, SKILL_HRID, {
            [SKILL_HRID]: { level: 1 },
        }, {
            totalBonusMultipliers: [0],
            equipment: [{
                hrid: itemHrid,
                equipmentType: "/equipment_types/ring",
                levelRequirements: [],
                drinkSlots: 0,
                noncombatStats: { gatheringQuantity: 0.2 },
                noncombatEnhancementBonuses: {},
            }],
        }, {
            [itemHrid]: 1,
        }, new Set());
        expect(productionLoadouts).toHaveLength(1);
        expect(productionLoadouts[0].items).toEqual([]);
    });

    it("keeps lower-experience loadouts when they are cheaper for profitable actions", () => {
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [],
            totalBonusMultipliers: [0],
            equipment: [{
                hrid: "/items/wisdom_charm",
                equipmentType: "/equipment_types/charm",
                levelRequirements: [],
                drinkSlots: 0,
                noncombatStats: { brewingExperience: 1 },
                noncombatEnhancementBonuses: {},
            }],
            actions: [action({
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                inputItems: [{ itemHrid: "/items/raw", count: 1 }],
                outputItems: [{ itemHrid: "/items/product", count: 1 }],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            })],
        };
        const profile = {
            skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
            inventory: { "/items/wisdom_charm": 1 },
            equipment: [{
                id: "wisdom-charm",
                itemHrid: "/items/wisdom_charm",
                enhancementLevel: 0,
                count: 1,
                isEquipped: false,
            }],
            buffsBySource: {},
        };

        const loadouts = buildSkillingEquipmentLoadouts(
            profile,
            SKILL_HRID,
            profile.skills,
            data,
            profile.inventory,
            new Set(),
        );
        expect(loadouts.map((loadout) => loadout.items.map((item) => item.itemHrid))).toEqual([
            [],
            ["/items/wisdom_charm"],
        ]);

        const result = planSkillingSkill({
            profile,
            skillHrid: SKILL_HRID,
            targetLevel: 2,
            priceTable: priceTable({
                "/items/raw": { ask: 10, bid: 10, vendor: 0 },
                "/items/product": { ask: 20, bid: 20, vendor: 0 },
            }),
            data,
        });

        expect(result.status).toBe("ok");
        expect(result.segments[0].equipment).toEqual([]);
        expect(result.segments[0].completionCount).toBe(4);
        expect(result.totalNetCost).toBeCloseTo(-38.4, 10);
    });

    it("selects the cheapest route by default and the shortest rounded route in speed mode", () => {
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [],
            equipment: [],
            totalBonusMultipliers: [0],
            actions: [
                action({
                    hrid: "/actions/brewing/cheap_slow",
                    baseTimeSeconds: 60,
                    experienceGain: { skillHrid: SKILL_HRID, value: 33 },
                    inputItems: [{ itemHrid: "/items/cheap_material", count: 1 }],
                    outputItems: [],
                    upgradeItemHrid: "",
                    essenceDropTable: [],
                    rareDropTable: [],
                    sortIndex: 1,
                }),
                action({
                    hrid: "/actions/brewing/expensive_fast",
                    baseTimeSeconds: 10,
                    experienceGain: { skillHrid: SKILL_HRID, value: 20 },
                    inputItems: [{ itemHrid: "/items/expensive_material", count: 1 }],
                    outputItems: [],
                    upgradeItemHrid: "",
                    essenceDropTable: [],
                    rareDropTable: [],
                    sortIndex: 2,
                }),
            ],
        };
        const profile = {
            skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
            inventory: {},
            equipment: [],
            buffsBySource: {},
        };
        const prices = priceTable({
            "/items/cheap_material": { ask: 1, bid: 1, vendor: 0 },
            "/items/expensive_material": { ask: 100, bid: 100, vendor: 0 },
        });
        const costPlan = planSkillingSkill({
            profile,
            skillHrid: SKILL_HRID,
            targetLevel: 2,
            priceTable: prices,
            data,
        });
        const speedPlan = planSkillingSkill({
            profile,
            skillHrid: SKILL_HRID,
            targetLevel: 2,
            priceTable: prices,
            data,
            optimizationMode: SKILLING_OPTIMIZATION_MODE_SPEED,
        });
        const speedUpgrades = planSkillingUpgrades({
            profile,
            targetLevels: { [SKILL_HRID]: 2 },
            priceTable: prices,
            data,
            optimizationMode: SKILLING_OPTIMIZATION_MODE_SPEED,
            balancedCostTolerance: 0.2,
        });

        expect(costPlan.optimizationMode).toBe(SKILLING_OPTIMIZATION_MODE_COST);
        expect(costPlan.segments[0].actionHrid).toBe("/actions/brewing/cheap_slow");
        expect(costPlan.alternatives[0].actionHrid).toBe("/actions/brewing/cheap_slow");
        expect(speedPlan.optimizationMode).toBe(SKILLING_OPTIMIZATION_MODE_SPEED);
        expect(speedPlan.segments[0].actionHrid).toBe("/actions/brewing/expensive_fast");
        expect(speedPlan.alternatives[0].actionHrid).toBe("/actions/brewing/expensive_fast");
        expect(speedPlan.alternatives[0].estimatedLevelDurationHours)
            .toBe(speedPlan.alternatives[0].requiredCompletionCount / speedPlan.alternatives[0].actionsPerHour);
        expect(speedPlan.totalDurationHours).toBeLessThan(costPlan.totalDurationHours);
        expect(speedUpgrades.optimizationMode).toBe(SKILLING_OPTIMIZATION_MODE_SPEED);
        expect(speedUpgrades.balancedCostTolerance).toBe(0.2);
        expect(speedUpgrades.plansBySkill[SKILL_HRID].optimizationMode).toBe(SKILLING_OPTIMIZATION_MODE_SPEED);
        expect(speedUpgrades.plansBySkill[SKILL_HRID].balancedCostTolerance).toBe(0.2);
        expect(speedUpgrades.plansBySkill[SKILL_HRID].segments[0].actionHrid)
            .toBe("/actions/brewing/expensive_fast");
    });

    it("selects the fastest candidate within 10% of the lowest negative cost per experience", () => {
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [],
            equipment: [],
            totalBonusMultipliers: [0],
            actions: [
                action({
                    hrid: "/actions/brewing/cheapest_slow",
                    baseTimeSeconds: 60,
                    experienceGain: { skillHrid: SKILL_HRID, value: 33 },
                    inputItems: [],
                    outputItems: [{ itemHrid: "/items/cheapest_output", count: 1 }],
                    upgradeItemHrid: "",
                    essenceDropTable: [],
                    rareDropTable: [],
                    sortIndex: 1,
                }),
                action({
                    hrid: "/actions/brewing/boundary_fast",
                    baseTimeSeconds: 30,
                    experienceGain: { skillHrid: SKILL_HRID, value: 33 },
                    inputItems: [],
                    outputItems: [{ itemHrid: "/items/boundary_output", count: 1 }],
                    upgradeItemHrid: "",
                    essenceDropTable: [],
                    rareDropTable: [],
                    sortIndex: 2,
                }),
                action({
                    hrid: "/actions/brewing/fastest_expensive",
                    baseTimeSeconds: 10,
                    experienceGain: { skillHrid: SKILL_HRID, value: 33 },
                    inputItems: [{ itemHrid: "/items/expensive_material", count: 1 }],
                    outputItems: [],
                    upgradeItemHrid: "",
                    essenceDropTable: [],
                    rareDropTable: [],
                    sortIndex: 3,
                }),
            ],
        };
        const result = planSkillingSkill({
            profile: {
                skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
                inventory: {},
                equipment: [],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 2,
            priceTable: priceTable({
                "/items/cheapest_output": { ask: 0, bid: 0, vendor: 3_300 },
                "/items/boundary_output": { ask: 0, bid: 0, vendor: 2_970 },
                "/items/expensive_material": { ask: 10_000, bid: 0, vendor: 0 },
            }),
            data,
            optimizationMode: SKILLING_OPTIMIZATION_MODE_BALANCED,
        });

        expect(result.optimizationMode).toBe(SKILLING_OPTIMIZATION_MODE_BALANCED);
        expect(result.segments[0].actionHrid).toBe("/actions/brewing/boundary_fast");
        expect(result.alternatives.map((candidate) => candidate.actionHrid)).toEqual([
            "/actions/brewing/boundary_fast",
            "/actions/brewing/cheapest_slow",
            "/actions/brewing/fastest_expensive",
        ]);
        expect(result.costPerExperience).toBe(-90);
        expect(result.totalPurchaseCost).toBe(0);
        expect(result.totalDrinkPurchaseCost).toBe(0);
        expect(result.totalMaterialPurchaseCost).toBe(0);
        expect(result.materialPurchaseCostPerExperience).toBe(0);
    });

    it("applies the balanced cost band against the global whole-level baseline", () => {
        const speedDrink = {
            hrid: "/items/speed_drink",
            sortIndex: 1,
            durationSeconds: 20_000,
            usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
            buffs: [{
                uniqueHrid: "/buff_uniques/speed_drink",
                typeHrid: "/buff_types/action_speed",
                flatBoost: 3,
            }],
        };
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [speedDrink],
            equipment: [],
            totalBonusMultipliers: [0],
            actions: [
                action({
                    hrid: "/actions/brewing/medium",
                    baseTimeSeconds: 14_400 / 33,
                    experienceGain: { skillHrid: SKILL_HRID, value: 1 },
                    inputItems: [{ itemHrid: "/items/medium_material", count: 1 }],
                    outputItems: [],
                    upgradeItemHrid: "",
                    essenceDropTable: [],
                    rareDropTable: [],
                    sortIndex: 1,
                }),
                action({
                    hrid: "/actions/brewing/cheapest",
                    baseTimeSeconds: 18_000,
                    experienceGain: { skillHrid: SKILL_HRID, value: 33 },
                    inputItems: [{ itemHrid: "/items/cheapest_material", count: 1 }],
                    outputItems: [],
                    upgradeItemHrid: "",
                    essenceDropTable: [],
                    rareDropTable: [],
                    sortIndex: 2,
                }),
            ],
        };
        const result = planSkillingSkill({
            profile: {
                skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
                inventory: {},
                equipment: [],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 2,
            priceTable: priceTable({
                "/items/medium_material": { ask: 50, bid: 0, vendor: 0 },
                "/items/cheapest_material": { ask: 1_617, bid: 0, vendor: 0 },
                "/items/speed_drink": { ask: 165, bid: 0, vendor: 0 },
            }),
            data,
            optimizationMode: SKILLING_OPTIMIZATION_MODE_BALANCED,
        });

        expect(result.status).toBe("ok");
        expect(result.balancedCostTolerance).toBe(SKILLING_BALANCED_COST_TOLERANCE);
        expect(result.segments[0]).toMatchObject({
            actionHrid: "/actions/brewing/medium",
            costPerExperience: 50,
            durationHours: 4,
            drinks: [],
        });
        expect(result.alternatives.map((candidate) => candidate.actionHrid)).toEqual([
            "/actions/brewing/medium",
            "/actions/brewing/cheapest",
        ]);
        expect(result.alternatives[0]).toMatchObject({
            costPerExperience: 50,
            durationHours: 4,
            drinks: [],
        });
        expect(result.alternatives[1]).toMatchObject({
            costPerExperience: 49,
            durationHours: 5,
            drinks: [],
        });

        const zeroToleranceResult = planSkillingSkill({
            profile: {
                skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
                inventory: {},
                equipment: [],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 2,
            priceTable: priceTable({
                "/items/medium_material": { ask: 50, bid: 0, vendor: 0 },
                "/items/cheapest_material": { ask: 1_617, bid: 0, vendor: 0 },
                "/items/speed_drink": { ask: 165, bid: 0, vendor: 0 },
            }),
            data,
            optimizationMode: SKILLING_OPTIMIZATION_MODE_BALANCED,
            balancedCostTolerance: 0,
        });
        expect(zeroToleranceResult.balancedCostTolerance).toBe(0);
        expect(zeroToleranceResult.segments[0]).toMatchObject({
            actionHrid: "/actions/brewing/cheapest",
            costPerExperience: 49,
            durationHours: 5,
        });

        const inBandSpeedResult = planSkillingSkill({
            profile: {
                skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
                inventory: {},
                equipment: [],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 2,
            priceTable: priceTable({
                "/items/medium_material": { ask: 50, bid: 0, vendor: 0 },
                "/items/cheapest_material": { ask: 1_617, bid: 0, vendor: 0 },
                "/items/speed_drink": { ask: 99, bid: 0, vendor: 0 },
            }),
            data,
            optimizationMode: SKILLING_OPTIMIZATION_MODE_BALANCED,
        });
        expect(inBandSpeedResult.segments[0]).toMatchObject({
            actionHrid: "/actions/brewing/medium",
            costPerExperience: 53,
            durationHours: 1,
            drinks: [expect.objectContaining({ itemHrid: "/items/speed_drink", count: 1 })],
        });
    });

    it("spends the balanced budget on only part of a repeated speed-drink run", () => {
        const speedDrink = {
            hrid: "/items/speed_drink",
            sortIndex: 1,
            durationSeconds: 300,
            usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
            buffs: [{
                uniqueHrid: "/buff_uniques/speed_drink",
                typeHrid: "/buff_types/action_speed",
                flatBoost: 1,
            }],
        };
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [speedDrink],
            equipment: [],
            totalBonusMultipliers: [0],
            actions: [action({
                hrid: "/actions/brewing/budgeted_speed_drink",
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 1 },
                inputItems: [{ itemHrid: "/items/raw", count: 1 }],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            })],
        };
        const planWithTolerance = (balancedCostTolerance) => planSkillingSkill({
            profile: {
                skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
                inventory: {},
                equipment: [],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 2,
            priceTable: priceTable({
                "/items/raw": { ask: 100, bid: 0, vendor: 0 },
                "/items/speed_drink": { ask: 330, bid: 0, vendor: 0 },
            }),
            data,
            optimizationMode: SKILLING_OPTIMIZATION_MODE_BALANCED,
            balancedCostTolerance,
            now: 0,
        });
        const countSpeedDrinks = (plan) => plan.segments
            .flatMap((segment) => segment.drinks || [])
            .filter((drink) => drink.itemHrid === "/items/speed_drink")
            .reduce((sum, drink) => sum + drink.count, 0);
        const result = planWithTolerance(0.1);

        expect(result.status).toBe("ok");
        expect(result.costPerExperience).toBeCloseTo(110, 10);
        expect(result.totalDurationHours).toBeCloseTo(28 / 60, 10);
        expect(countSpeedDrinks(result)).toBe(1);

        const zeroToleranceResult = planWithTolerance(0);
        expect(zeroToleranceResult.costPerExperience).toBeCloseTo(100, 10);
        expect(zeroToleranceResult.totalDurationHours).toBeCloseTo(33 / 60, 10);
        expect(countSpeedDrinks(zeroToleranceResult)).toBe(0);

        const twentyPercentResult = planWithTolerance(0.2);
        expect(twentyPercentResult.costPerExperience).toBeCloseTo(120, 10);
        expect(twentyPercentResult.totalDurationHours).toBeCloseTo(23 / 60, 10);
        expect(countSpeedDrinks(twentyPercentResult)).toBe(2);
    });

    it("uses the cheapest generated whole-level trajectory as the balanced baseline", () => {
        const wisdomDrink = {
            hrid: "/items/wisdom_drink",
            sortIndex: 1,
            durationSeconds: 300,
            usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
            buffs: [{
                uniqueHrid: "/buff_uniques/wisdom_drink",
                typeHrid: "/buff_types/wisdom",
                flatBoost: 1,
            }],
        };
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [wisdomDrink],
            equipment: [],
            totalBonusMultipliers: [0],
            actions: [
                action({
                    hrid: "/actions/brewing/stateful",
                    baseTimeSeconds: 60,
                    experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                    inputItems: [{ itemHrid: "/items/stateful_material", count: 1 }],
                    outputItems: [],
                    upgradeItemHrid: "",
                    essenceDropTable: [],
                    rareDropTable: [],
                    sortIndex: 1,
                }),
                action({
                    hrid: "/actions/brewing/short_expensive",
                    baseTimeSeconds: 30,
                    experienceGain: { skillHrid: SKILL_HRID, value: 33 },
                    inputItems: [{ itemHrid: "/items/short_material", count: 1 }],
                    outputItems: [],
                    upgradeItemHrid: "",
                    essenceDropTable: [],
                    rareDropTable: [],
                    sortIndex: 2,
                }),
            ],
        };
        const now = Date.parse("2026-01-01T00:00:00Z");
        const result = planSkillingSkill({
            profile: {
                skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
                inventory: { "/items/stateful_material": 2 },
                equipment: [],
                buffsBySource: {
                    personal: {
                        [ACTION_TYPE_HRID]: [{
                            typeHrid: "/buff_types/rare_find",
                            flatBoost: 1,
                            startTime: "2026-01-01T00:00:00Z",
                            duration: 60_000_000_000,
                        }],
                    },
                },
            },
            skillHrid: SKILL_HRID,
            targetLevel: 2,
            priceTable: priceTable({
                "/items/stateful_material": { ask: 1_000, bid: 0, vendor: 0 },
                "/items/short_material": { ask: 330, bid: 0, vendor: 0 },
                "/items/wisdom_drink": { ask: 100, bid: 0, vendor: 0 },
            }),
            data,
            optimizationMode: SKILLING_OPTIMIZATION_MODE_BALANCED,
            now,
        });

        expect(result.status).toBe("ok");
        expect(result.segments.every((segment) => (
            segment.actionHrid === "/actions/brewing/stateful"
        ))).toBe(true);
        expect(result.segments.reduce((sum, segment) => sum + segment.completionCount, 0)).toBe(2);
        expect(result.costPerExperience).toBe(2.5);
        expect(result.totalDurationHours).toBeCloseTo(2 / 60, 10);
        expect(result.alternatives.map((candidate) => candidate.actionHrid)).toEqual([
            "/actions/brewing/stateful",
            "/actions/brewing/short_expensive",
        ]);
        expect(result.alternatives[1].costPerExperience).toBeGreaterThan(2.75);
    });

    it("applies the balanced cost tolerance to positive, negative, and zero baselines", () => {
        function balancedCandidate(actionHrid, costPerExperience, estimatedLevelDurationHours) {
            return {
                actionHrid,
                costPerExperience,
                estimatedLevelDurationHours,
                materialPurchaseCostPerExperience: costPerExperience,
                purchaseCost: Math.max(0, costPerExperience),
                equipmentChanges: 0,
                actionSortIndex: 0,
                drinks: [],
            };
        }
        function rankedCosts(candidates, baseline, balancedCostTolerance) {
            return [...candidates]
                .sort((left, right) => compareCandidates(
                    left,
                    right,
                    SKILLING_OPTIMIZATION_MODE_BALANCED,
                    baseline,
                    balancedCostTolerance,
                ))
                .map((candidate) => candidate.costPerExperience);
        }

        expect(rankedCosts([
            balancedCandidate("positive-baseline", 100, 10),
            balancedCandidate("positive-boundary", 110, 5),
            balancedCandidate("positive-outside", 110.01, 1),
        ], 100)).toEqual([110, 100, 110.01]);
        expect(rankedCosts([
            balancedCandidate("negative-baseline", -100, 10),
            balancedCandidate("negative-boundary", -90, 5),
            balancedCandidate("negative-outside", -89.99, 1),
        ], -100)).toEqual([-90, -100, -89.99]);
        expect(rankedCosts([
            balancedCandidate("zero-baseline", 0, 10),
            balancedCandidate("zero-tie", 0, 5),
            balancedCandidate("zero-outside", 0.01, 1),
        ], 0)).toEqual([0, 0, 0.01]);
        expect(rankedCosts([
            balancedCandidate("zero-tolerance-baseline", 100, 10),
            balancedCandidate("zero-tolerance-faster", 100.01, 1),
        ], 100, 0)).toEqual([100, 100.01]);
        expect(rankedCosts([
            balancedCandidate("twenty-percent-baseline", 100, 10),
            balancedCandidate("twenty-percent-boundary", 120, 5),
            balancedCandidate("twenty-percent-outside", 120.01, 1),
        ], 100, 0.2)).toEqual([120, 100, 120.01]);
        expect(rankedCosts([
            balancedCandidate("negative-twenty-percent-baseline", -100, 10),
            balancedCandidate("negative-twenty-percent-boundary", -80, 5),
            balancedCandidate("negative-twenty-percent-outside", -79.99, 1),
        ], -100, 0.2)).toEqual([-80, -100, -79.99]);

        const fallbackCandidates = [
            balancedCandidate("fallback-cheapest", 100, 10),
            balancedCandidate("fallback-faster", 109, 1),
        ];
        expect([...fallbackCandidates]
            .sort((left, right) => compareCandidates(left, right, SKILLING_OPTIMIZATION_MODE_BALANCED))
            .map((candidate) => candidate.costPerExperience)).toEqual([100, 109]);
        expect([
            balancedCandidate("fallback-negative-cheapest", -100, 10),
            balancedCandidate("fallback-negative-faster", -90, 1),
        ].sort((left, right) => compareCandidates(left, right, SKILLING_OPTIMIZATION_MODE_BALANCED))
            .map((candidate) => candidate.costPerExperience)).toEqual([-100, -90]);
    });

    it("returns the normalized optimization mode for complete plans", () => {
        const result = planSkillingSkill({
            profile: {
                skills: { [SKILL_HRID]: { level: 2, experience: levelExperienceTable[2] } },
                inventory: {},
                equipment: [],
            },
            skillHrid: SKILL_HRID,
            targetLevel: 2,
            priceTable: priceTable(),
            data: { actions: [], equipment: [] },
            optimizationMode: "SPEED",
            balancedCostTolerance: 2,
        });

        expect(result.status).toBe("complete");
        expect(result.optimizationMode).toBe(SKILLING_OPTIMIZATION_MODE_SPEED);
        expect(result.balancedCostTolerance).toBe(1);
    });

    it("keeps distinct enhancement reservations and consumes the cheaper instance", () => {
        const materialHrid = "/items/material_pouch";
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [],
            totalBonusMultipliers: Array(13).fill(0),
            equipment: [{
                hrid: materialHrid,
                equipmentType: "/equipment_types/pouch",
                levelRequirements: [],
                drinkSlots: 0,
                noncombatStats: { brewingSpeed: 0.1 },
                noncombatEnhancementBonuses: {},
            }],
            equipmentItemHrids: [materialHrid, "/items/upgraded_pouch"],
            actions: [action({
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 33 },
                inputItems: [],
                outputItems: [{ itemHrid: "/items/upgraded_pouch", count: 1 }],
                upgradeItemHrid: materialHrid,
                essenceDropTable: [],
                rareDropTable: [],
            })],
        };
        const profile = {
            skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
            inventory: { [materialHrid]: 2 },
            equipment: [
                { id: "plain", itemHrid: materialHrid, enhancementLevel: 0, count: 1, isEquipped: false },
                { id: "enhanced", itemHrid: materialHrid, enhancementLevel: 12, count: 1, isEquipped: false },
            ],
            buffsBySource: {},
        };

        const loadouts = buildSkillingEquipmentLoadouts(
            profile,
            SKILL_HRID,
            { [SKILL_HRID]: { level: 1 } },
            data,
            profile.inventory,
            new Set([materialHrid]),
        );
        expect(loadouts.map((loadout) => loadout.items[0]?.enhancementLevel ?? null)).toEqual([null, 0, 12]);

        const result = planSkillingSkill({
            profile,
            skillHrid: SKILL_HRID,
            targetLevel: 2,
            priceTable: priceTable({
                [materialHrid]: { ask: 100, bid: 100, vendor: 0 },
                "/items/upgraded_pouch": { ask: 0, bid: 0, vendor: 0 },
            }),
            enhancementQuotesByItem: {
                [materialHrid]: { "12": { ask: 1100, bid: 1000 } },
            },
            data,
        });

        expect(result.status).toBe("ok");
        expect(result.segments[0].equipment).toEqual([
            expect.objectContaining({ id: "enhanced", enhancementLevel: 12 }),
        ]);
        expect(result.segments[0].consumedEquipment).toEqual([
            expect.objectContaining({ id: "plain", enhancementLevel: 0, count: 1 }),
        ]);
        expect(result.segments[0].inputItems).toEqual([
            expect.objectContaining({ itemHrid: materialHrid, enhancementLevel: 0, opportunityCost: 98 }),
        ]);
    });

    it("purchases a plain upgrade base instead of destroying an enhanced item without an exact bid", () => {
        const baseHrid = "/items/base_gear";
        const candidate = calculateSkillingActionCandidate({
            action: action({
                experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                inputItems: [],
                outputItems: [{ itemHrid: "/items/upgraded_gear", count: 1 }],
                upgradeItemHrid: baseHrid,
                essenceDropTable: [],
                rareDropTable: [],
            }),
            skillHrid: SKILL_HRID,
            skillLevel: 1,
            experienceNeeded: 10,
            inventory: { [baseHrid]: 1 },
            equipmentInstances: [{
                id: "enhanced-base",
                itemHrid: baseHrid,
                enhancementLevel: 7,
                count: 1,
                isEquipped: false,
            }],
            equipmentLoadout: emptyLoadout(),
            priceTable: priceTable({
                [baseHrid]: { ask: 120_000, bid: 120_000, vendor: 4_368 },
                "/items/upgraded_gear": { ask: 0, bid: 0, vendor: 0 },
            }),
        });

        expect(candidate.available).toBe(true);
        expect(candidate.consumedEquipment).toEqual([]);
        expect(candidate.inputItems).toEqual([
            expect.objectContaining({
                itemHrid: baseHrid,
                enhancementLevel: 0,
                ownedCount: 0,
                purchaseCount: 1,
                purchaseCost: 120_000,
            }),
        ]);
    });

    it("protects expensive enhanced bases but allows known cheaper or enhancement-retaining inputs", () => {
        const baseHrid = "/items/base_gear";
        function buildCandidate({ enhancedBid, retainAllEnhancement = false }) {
            return calculateSkillingActionCandidate({
                action: action({
                    experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                    inputItems: [],
                    outputItems: [{ itemHrid: "/items/upgraded_gear", count: 1 }],
                    upgradeItemHrid: baseHrid,
                    retainAllEnhancement,
                    essenceDropTable: [],
                    rareDropTable: [],
                }),
                skillHrid: SKILL_HRID,
                skillLevel: 1,
                experienceNeeded: 10,
                inventory: { [baseHrid]: 1 },
                equipmentInstances: [{
                    id: "enhanced-base",
                    itemHrid: baseHrid,
                    enhancementLevel: 7,
                    count: 1,
                    isEquipped: false,
                }],
                equipmentLoadout: emptyLoadout(),
                priceTable: priceTable({
                    [baseHrid]: { ask: 120_000, bid: 120_000, vendor: 4_368 },
                    "/items/upgraded_gear": { ask: 0, bid: 0, vendor: 0 },
                }),
                enhancementQuotesByItem: enhancedBid == null ? {} : {
                    [baseHrid]: { "7": { ask: enhancedBid, bid: enhancedBid } },
                },
            });
        }

        const expensive = buildCandidate({ enhancedBid: 400_000 });
        expect(expensive.consumedEquipment).toEqual([]);
        expect(expensive.inputItems).toEqual([
            expect.objectContaining({ enhancementLevel: 0, purchaseCount: 1 }),
        ]);

        const cheaper = buildCandidate({ enhancedBid: 100_000 });
        expect(cheaper.consumedEquipment).toEqual([
            expect.objectContaining({ id: "enhanced-base", enhancementLevel: 7 }),
        ]);

        const retained = buildCandidate({ enhancedBid: null, retainAllEnhancement: true });
        expect(retained.consumedEquipment).toEqual([
            expect.objectContaining({ id: "enhanced-base", enhancementLevel: 7 }),
        ]);
        expect(retained.outputItems).toEqual([
            expect.objectContaining({ itemHrid: "/items/upgraded_gear", enhancementLevel: 7 }),
        ]);
    });

    it("applies the action floor, xp rounding, artisan, upgrade, and expected drops", () => {
        const candidate = calculateSkillingActionCandidate({
            action: action(),
            skillHrid: SKILL_HRID,
            skillLevel: 1,
            experienceNeeded: 10,
            inventory: { "/items/raw": 9, "/items/base": 1 },
            equipmentLoadout: emptyLoadout({ bonuses: { actionSpeed: 10, efficiency: 0, experience: 0.03, essenceFind: 0.2, rareFind: 0.5 } }),
            externalBonuses: { artisan: 0.1, outputQuantity: 0.2, experience: 0.08, efficiency: 0.1 },
            priceTable: priceTable({
                "/items/raw": { ask: 10, bid: 10, vendor: 0 },
                "/items/base": { ask: 20, bid: 20, vendor: 0 },
                "/items/product": { ask: 100, bid: 100, vendor: 0 },
                "/items/essence": { ask: 10, bid: 10, vendor: 0 },
                "/items/rare": { ask: 50, bid: 50, vendor: 0 },
            }),
        });
        expect(candidate.actionSeconds).toBe(3);
        expect(candidate.experiencePerAction).toBe(11.1);
        expect(candidate.inputItems.find((item) => item.itemHrid === "/items/raw").count).toBeCloseTo(9);
        expect(candidate.inputItems.find((item) => item.itemHrid === "/items/base").count).toBe(1);
        expect(candidate.outputItems.find((item) => item.itemHrid === "/items/product").count).toBeCloseTo(1.2);
        expect(candidate.outputItems.find((item) => item.itemHrid === "/items/essence").count).toBeCloseTo(0.6);
        expect(candidate.outputItems.find((item) => item.itemHrid === "/items/rare").count).toBeCloseTo(0.3);
    });

    it("values foraging drop tables with gathering quantity", () => {
        const candidate = calculateSkillingActionCandidate({
            action: action({
                hrid: "/actions/foraging/test",
                type: "/action_types/foraging",
                levelRequirement: { skillHrid: "/skills/foraging", level: 1 },
                experienceGain: { skillHrid: "/skills/foraging", value: 10 },
                inputItems: [],
                outputItems: [],
                dropTable: [{ itemHrid: "/items/gathered", dropRate: 0.5, minCount: 2, maxCount: 4 }],
                upgradeItemHrid: "",
            }),
            skillHrid: "/skills/foraging",
            skillLevel: 1,
            experienceNeeded: 10,
            inventory: {},
            equipmentLoadout: emptyLoadout(),
            externalBonuses: { outputQuantity: 0.2 },
            priceTable: priceTable({
                "/items/gathered": { ask: 10, bid: 10, vendor: 0 },
                "/items/essence": { ask: 10, bid: 10, vendor: 0 },
                "/items/rare": { ask: 50, bid: 50, vendor: 0 },
            }),
        });

        expect(candidate.outputItems.find((item) => item.itemHrid === "/items/gathered").count).toBeCloseTo(1.8);
        expect(candidate.outputItems.find((item) => item.itemHrid === "/items/essence").count).toBeCloseTo(0.5);
        expect(candidate.outputItems.find((item) => item.itemHrid === "/items/rare").count).toBeCloseTo(0.2);
    });

    it("excludes a candidate when inventory is short and no ask exists", () => {
        const candidate = calculateSkillingActionCandidate({
            action: action({ inputItems: [{ itemHrid: "/items/missing", count: 2 }], upgradeItemHrid: "", essenceDropTable: [], rareDropTable: [] }),
            skillHrid: SKILL_HRID,
            skillLevel: 1,
            experienceNeeded: 10,
            inventory: { "/items/missing": 1 },
            equipmentLoadout: emptyLoadout(),
            priceTable: priceTable({ "/items/missing": { ask: -1, bid: 5, vendor: 0 }, "/items/product": { ask: 1, bid: 1, vendor: 0 } }),
        });
        expect(candidate.available).toBe(false);
        expect(candidate.missingPriceHrids).toEqual(["/items/missing"]);
    });

    it("combines persistent Buff sources and excludes expired temporary Buffs", () => {
        const now = Date.parse("2026-01-01T00:00:00Z");
        const profile = {
            buffsBySource: {
                house: {
                    [ACTION_TYPE_HRID]: [{ typeHrid: "/buff_types/efficiency", flatBoost: 0.1, duration: 0 }],
                },
                community: {
                    [ACTION_TYPE_HRID]: [{ typeHrid: "/buff_types/wisdom", flatBoost: 0.2, duration: 0 }],
                },
                personal: {
                    [ACTION_TYPE_HRID]: [{
                        typeHrid: "/buff_types/rare_find",
                        flatBoost: 0.3,
                        startTime: "2025-01-01T00:00:00Z",
                        duration: 1_000_000_000,
                    }],
                },
            },
        };

        const result = collectSkillingProfileBonuses(profile, ACTION_TYPE_HRID, SKILL_HRID, now);

        expect(result.totals.efficiency).toBeCloseTo(0.1);
        expect(result.totals.experience).toBeCloseTo(0.2);
        expect(result.totals.rareFind).toBe(0);
        expect(result.expiredBuffCount).toBe(1);
    });

    it("collects gathering and processing Buffs only for gathering skills", () => {
        const profile = {
            buffsBySource: {
                community: {
                    "/action_types/foraging": [
                        { typeHrid: "/buff_types/gathering", flatBoost: 0.15, duration: 0 },
                        { typeHrid: "/buff_types/processing", flatBoost: 0.2, duration: 0 },
                    ],
                },
            },
        };

        const foraging = collectSkillingProfileBonuses(
            profile,
            "/action_types/foraging",
            "/skills/foraging",
        );
        expect(foraging.totals.outputQuantity).toBeCloseTo(0.15);
        expect(foraging.totals.processing).toBeCloseTo(0.2);

        const brewing = collectSkillingProfileBonuses(
            profile,
            "/action_types/foraging",
            SKILL_HRID,
        );
        expect(brewing.totals.outputQuantity).toBe(0);
        expect(brewing.totals.processing).toBe(0);
    });

    it("replans actions after an active temporary Buff expires", () => {
        const now = Date.parse("2026-01-01T00:00:00Z");
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [],
            equipment: [],
            totalBonusMultipliers: [0],
            actions: [action({
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                inputItems: [],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            })],
        };
        const result = planSkillingSkill({
            profile: {
                skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
                inventory: {},
                equipment: [],
                buffsBySource: {
                    personal: {
                        [ACTION_TYPE_HRID]: [{
                            typeHrid: "/buff_types/wisdom",
                            flatBoost: 1,
                            startTime: "2026-01-01T00:00:00Z",
                            duration: 60_000_000_000,
                        }],
                    },
                },
            },
            skillHrid: SKILL_HRID,
            targetLevel: 2,
            priceTable: priceTable(),
            data,
            now,
        });

        expect(result.status).toBe("ok");
        expect(result.expiredBuffCount).toBe(0);
        expect(result.segments).toHaveLength(2);
        expect(result.segments[0]).toMatchObject({
            fromLevel: 1,
            toLevel: 1,
            completionCount: 1,
            experiencePerAction: 20,
        });
        expect(result.segments[0].bonuses.experience).toBe(1);
        expect(result.segments[1]).toMatchObject({
            fromLevel: 1,
            toLevel: 2,
            completionCount: 2,
            experiencePerAction: 10,
        });
        expect(result.segments[1].bonuses.experience).toBe(0);
        expect(result.totalDurationHours).toBeCloseTo(3 / 60, 10);
    });

    it("keeps the whole-level recipe choice while reapplying stats after a Buff expires", () => {
        const now = Date.parse("2026-01-01T00:00:00Z");
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [],
            equipment: [],
            totalBonusMultipliers: [0],
            actions: [
                action({
                    hrid: "/actions/brewing/buff_value",
                    baseTimeSeconds: 60,
                    experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                    inputItems: [{ itemHrid: "/items/value_raw", count: 1 }],
                    outputItems: [],
                    upgradeItemHrid: "",
                    essenceDropTable: [{ itemHrid: "/items/value_essence", dropRate: 1, minCount: 1, maxCount: 1 }],
                    rareDropTable: [],
                    sortIndex: 1,
                }),
                action({
                    hrid: "/actions/brewing/stable",
                    baseTimeSeconds: 60,
                    experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                    inputItems: [{ itemHrid: "/items/stable_raw", count: 1 }],
                    outputItems: [],
                    upgradeItemHrid: "",
                    essenceDropTable: [],
                    rareDropTable: [],
                    sortIndex: 2,
                }),
            ],
        };
        const result = planSkillingSkill({
            profile: {
                skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
                inventory: {},
                equipment: [],
                buffsBySource: {
                    personal: {
                        [ACTION_TYPE_HRID]: [{
                            typeHrid: "/buff_types/essence_find",
                            flatBoost: 9,
                            startTime: "2026-01-01T00:00:00Z",
                            duration: 60_000_000_000,
                        }],
                    },
                },
            },
            skillHrid: SKILL_HRID,
            targetLevel: 2,
            priceTable: priceTable({
                "/items/value_raw": { ask: 100, bid: 0, vendor: 0 },
                "/items/stable_raw": { ask: 50, bid: 0, vendor: 0 },
                "/items/value_essence": { ask: 20, bid: 20, vendor: 20 },
            }),
            data,
            now,
        });

        expect(result.status).toBe("ok");
        expect(result.segments).toHaveLength(2);
        expect(result.segments.map((segment) => segment.actionHrid)).toEqual([
            "/actions/brewing/buff_value",
            "/actions/brewing/buff_value",
        ]);
        expect(result.segments.map((segment) => segment.completionCount)).toEqual([1, 3]);
        expect(result.segments.map((segment) => segment.bonuses.essenceFind)).toEqual([9, 0]);
        expect(result.totalNetCost).toBe(140);
    });

    it("keeps staged equipment metadata on whole-level alternatives", () => {
        const now = Date.parse("2026-01-01T00:00:00Z");
        const essenceToolHrid = "/items/essence_tool";
        const wisdomToolHrid = "/items/wisdom_tool";
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [],
            equipment: [
                {
                    hrid: essenceToolHrid,
                    equipmentType: "/equipment_types/brewing_tool",
                    levelRequirements: [],
                    noncombatStats: { skillingEssenceFind: 2 },
                    noncombatEnhancementBonuses: {},
                },
                {
                    hrid: wisdomToolHrid,
                    equipmentType: "/equipment_types/brewing_tool",
                    levelRequirements: [],
                    noncombatStats: { wisdom: 1 },
                    noncombatEnhancementBonuses: {},
                },
            ],
            totalBonusMultipliers: [0],
            actions: [action({
                baseTimeSeconds: 3_600,
                experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                inputItems: [{ itemHrid: "/items/raw", count: 1 }],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [{ itemHrid: "/items/essence", dropRate: 1, minCount: 1, maxCount: 1 }],
                rareDropTable: [],
            })],
        };
        const result = planSkillingSkill({
            profile: {
                skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
                inventory: { [essenceToolHrid]: 1, [wisdomToolHrid]: 1 },
                equipment: [
                    { id: "essence-tool", itemHrid: essenceToolHrid, enhancementLevel: 0, count: 1, isEquipped: false },
                    { id: "wisdom-tool", itemHrid: wisdomToolHrid, enhancementLevel: 0, count: 1, isEquipped: false },
                ],
                buffsBySource: {
                    personal: {
                        [ACTION_TYPE_HRID]: [{
                            typeHrid: "/buff_types/essence_find",
                            flatBoost: 10,
                            startTime: "2026-01-01T00:00:00Z",
                            duration: 3_600_000_000_000,
                        }],
                    },
                },
            },
            skillHrid: SKILL_HRID,
            targetLevel: 2,
            priceTable: priceTable({
                "/items/raw": { ask: 100, bid: 0, vendor: 0 },
                "/items/essence": { ask: 10, bid: 10, vendor: 0 },
            }),
            data,
            feeRate: 0,
            now,
        });

        expect(result.status).toBe("ok");
        expect(result.segments.map((segment) => segment.equipment[0]?.itemHrid)).toEqual([
            essenceToolHrid,
            wisdomToolHrid,
        ]);
        expect(result.alternatives[0]).toMatchObject({
            completionCount: 3,
            costPerExperience: 3,
        });
        expect(result.alternatives[0].equipmentStrategies.map((strategy) => ({
            itemHrid: strategy.equipment[0]?.itemHrid,
            completionCount: strategy.completionCount,
        }))).toEqual([
            { itemHrid: essenceToolHrid, completionCount: 1 },
            { itemHrid: wisdomToolHrid, completionCount: 2 },
        ]);
    });

    it("magnifies drink effects and shortens duration with concentration", () => {
        const candidate = calculateSkillingActionCandidate({
            action: action({
                baseTimeSeconds: 600,
                inputItems: [],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            }),
            skillHrid: SKILL_HRID,
            skillLevel: 1,
            experienceNeeded: 100,
            inventory: {},
            equipmentLoadout: emptyLoadout({ drinkConcentration: 1 }),
            drinkLoadout: [{
                hrid: "/items/speed_drink",
                durationSeconds: 300,
                buffs: [{ typeHrid: "/buff_types/action_speed", flatBoost: 0.5 }],
            }],
            priceTable: priceTable({ "/items/speed_drink": { ask: 1, bid: 0, vendor: 0 } }),
        });

        expect(candidate.bonuses.actionSpeed).toBe(1);
        expect(candidate.actionSeconds).toBe(300);
        expect(candidate.drinks[0].effectiveDurationSeconds).toBe(150);
        expect(candidate.completionCount).toBe(1);
        expect(candidate.drinks[0].count).toBe(1);
    });

    it("keeps full-level projections separate from a drink-window initial batch", () => {
        const candidate = calculateSkillingActionCandidate({
            action: action({
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                inputItems: [],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            }),
            skillHrid: SKILL_HRID,
            skillLevel: 1,
            experienceNeeded: 1_000,
            inventory: {},
            equipmentLoadout: emptyLoadout(),
            drinkLoadout: [{
                hrid: "/items/window_drink",
                durationSeconds: 300,
                buffs: [],
            }],
            priceTable: priceTable({
                "/items/window_drink": { ask: 0, bid: 0, vendor: 0 },
            }),
        });

        expect(candidate.requiredCompletionCount).toBe(100);
        expect(candidate.completionCount).toBe(5);
        expect(candidate.drinkWindowLimited).toBe(true);
        expect(candidate.estimatedLevelDurationHours)
            .toBe(candidate.requiredCompletionCount / candidate.actionsPerHour);
        expect(candidate.durationHours).toBe(candidate.completionCount / candidate.actionsPerHour);
    });

    it("does not stack a planned drink with an active Buff from the same unique group", () => {
        const now = Date.parse("2026-01-01T00:00:00Z");
        const wisdomTea = {
            hrid: "/items/wisdom_tea",
            sortIndex: 1,
            durationSeconds: 300,
            usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
            buffs: [{
                uniqueHrid: "/buff_uniques/wisdom_tea",
                typeHrid: "/buff_types/wisdom",
                flatBoost: 1,
            }],
        };
        const efficiencyTea = {
            hrid: "/items/efficiency_tea",
            sortIndex: 2,
            durationSeconds: 300,
            usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
            buffs: [{
                uniqueHrid: "/buff_uniques/efficiency_tea",
                typeHrid: "/buff_types/efficiency",
                flatBoost: 0.5,
            }],
        };
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [wisdomTea, efficiencyTea],
            equipment: [],
            totalBonusMultipliers: [0],
            actions: [action({
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                inputItems: [],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            })],
        };
        const result = planSkillingSkill({
            profile: {
                skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
                inventory: {},
                equipment: [],
                drinkSlotsByActionType: {
                    [ACTION_TYPE_HRID]: [{
                        slotIndex: 0,
                        itemHrid: wisdomTea.hrid,
                        isActive: null,
                    }],
                },
                buffsBySource: {
                    personal: {
                        [ACTION_TYPE_HRID]: [{
                            ...wisdomTea.buffs[0],
                            startTime: "2026-01-01T00:00:00Z",
                            duration: 60_000_000_000,
                        }],
                    },
                },
            },
            skillHrid: SKILL_HRID,
            targetLevel: 2,
            priceTable: priceTable({
                "/items/wisdom_tea": { ask: 0, bid: 0, vendor: 0 },
                "/items/efficiency_tea": { ask: 0, bid: 0, vendor: 0 },
            }),
            data,
            now,
        });

        expect(result.segments[0]).toMatchObject({ experiencePerAction: 20, drinks: [] });
        expect(result.segments[1].drinks).toEqual([
            expect.objectContaining({ itemHrid: "/items/wisdom_tea", count: 1 }),
        ]);
    });

    it("excludes unsupported Processing Tea from foraging candidates", () => {
        const skillHrid = "/skills/foraging";
        const actionTypeHrid = "/action_types/foraging";
        const processingTea = {
            hrid: "/items/processing_tea",
            sortIndex: 1,
            durationSeconds: 300,
            usableInActionTypeMap: { [actionTypeHrid]: true },
            buffs: [{
                uniqueHrid: "/buff_uniques/processing_tea",
                typeHrid: "/buff_types/processing",
                flatBoost: 0.15,
            }],
        };
        const result = planSkillingSkill({
            profile: {
                skills: { [skillHrid]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
                inventory: {},
                equipment: [],
                buffsBySource: {},
            },
            skillHrid,
            targetLevel: 2,
            priceTable: priceTable({
                [processingTea.hrid]: { ask: 0, bid: 0, vendor: 0 },
            }),
            data: {
                skillHrids: [skillHrid],
                drinks: [processingTea],
                equipment: [],
                totalBonusMultipliers: [0],
                actions: [action({
                    hrid: "/actions/foraging/test",
                    type: actionTypeHrid,
                    levelRequirement: { skillHrid, level: 1 },
                    experienceGain: { skillHrid, value: 10 },
                    inputItems: [],
                    outputItems: [],
                    dropTable: [],
                    upgradeItemHrid: "",
                    essenceDropTable: [],
                    rareDropTable: [],
                })],
            },
        });

        expect(result.status).toBe("ok");
        expect([...result.segments, ...result.alternatives].every((candidate) => (
            candidate.drinks.every((drink) => drink.itemHrid !== processingTea.hrid)
        ))).toBe(true);
    });

    it("reuses remaining drink duration across level boundaries", () => {
        const speedDrink = {
            hrid: "/items/speed_drink",
            sortIndex: 1,
            durationSeconds: 300,
            usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
            buffs: [{
                uniqueHrid: "/buff_uniques/speed_drink",
                typeHrid: "/buff_types/action_speed",
                flatBoost: 1,
            }],
        };
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [speedDrink],
            equipment: [],
            totalBonusMultipliers: [0],
            actions: [action({
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                inputItems: [],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            })],
        };
        const result = planSkillingSkill({
            profile: {
                skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
                inventory: {},
                equipment: [],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 3,
            priceTable: priceTable({ "/items/speed_drink": { ask: 0, bid: 0, vendor: 0 } }),
            data,
        });

        expect(result.status).toBe("ok");
        expect(result.segments).toHaveLength(1);
        expect(result.segments[0].drinks).toEqual([
            expect.objectContaining({ itemHrid: "/items/speed_drink", count: 1 }),
        ]);
    });

    it("charges one new drink when the final action starts before its first expiration", () => {
        const wisdomDrink = {
            hrid: "/items/wisdom_drink",
            sortIndex: 1,
            durationSeconds: 300,
            usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
            buffs: [{
                uniqueHrid: "/buff_uniques/wisdom_drink",
                typeHrid: "/buff_types/wisdom",
                flatBoost: 1,
            }],
        };
        const candidate = calculateSkillingActionCandidate({
            action: action({
                baseTimeSeconds: 70,
                experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                inputItems: [{ itemHrid: "/items/raw", count: 1 }],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            }),
            skillHrid: SKILL_HRID,
            skillLevel: 1,
            experienceNeeded: 100,
            inventory: {},
            equipmentLoadout: emptyLoadout(),
            drinkLoadout: [wisdomDrink],
            priceTable: priceTable({
                "/items/raw": { ask: 10, bid: 0, vendor: 0 },
                "/items/wisdom_drink": { ask: 20, bid: 0, vendor: 0 },
            }),
        });

        expect(candidate.completionCount).toBe(5);
        expect(candidate.drinks).toEqual([
            expect.objectContaining({ itemHrid: "/items/wisdom_drink", count: 1 }),
        ]);
        expect(candidate.netCost).toBe(70);
    });

    it("excludes selected drink purchases from material purchase cost", () => {
        const candidate = calculateSkillingActionCandidate({
            action: action({
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                inputItems: [{ itemHrid: "/items/raw", count: 1 }],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            }),
            skillHrid: SKILL_HRID,
            skillLevel: 1,
            experienceNeeded: 20,
            inventory: {},
            equipmentLoadout: emptyLoadout(),
            drinkLoadout: [{
                hrid: "/items/test_drink",
                durationSeconds: 300,
                buffs: [],
            }],
            priceTable: priceTable({
                "/items/raw": { ask: 100, bid: 0, vendor: 0 },
                "/items/test_drink": { ask: 50, bid: 0, vendor: 0 },
            }),
        });

        expect(candidate.purchaseCost).toBe(250);
        expect(candidate.drinkPurchaseCost).toBe(50);
        expect(candidate.materialPurchaseCost).toBe(200);
        expect(candidate.materialPurchaseCostPerExperience).toBe(10);
    });

    it("only excludes the consumed drink share when an item is also a recipe material", () => {
        const candidate = calculateSkillingActionCandidate({
            action: action({
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                inputItems: [{ itemHrid: "/items/brewing_tea", count: 2 }],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            }),
            skillHrid: SKILL_HRID,
            skillLevel: 1,
            experienceNeeded: 20,
            inventory: { "/items/brewing_tea": 3 },
            equipmentLoadout: emptyLoadout(),
            drinkLoadout: [{
                hrid: "/items/brewing_tea",
                durationSeconds: 300,
                buffs: [],
            }],
            priceTable: priceTable({
                "/items/brewing_tea": { ask: 50, bid: 0, vendor: 0 },
            }),
        });

        expect(candidate.inputItems).toEqual([
            expect.objectContaining({
                itemHrid: "/items/brewing_tea",
                count: 5,
                ownedCount: 3,
                purchaseCount: 2,
                purchaseCost: 100,
            }),
        ]);
        expect(candidate.drinks).toEqual([
            expect.objectContaining({ itemHrid: "/items/brewing_tea", count: 1 }),
        ]);
        expect(candidate.drinkPurchaseCost).toBe(50);
        expect(candidate.materialPurchaseCost).toBe(50);
        expect(candidate.materialPurchaseCostPerExperience).toBe(2.5);
    });

    it("renews drinks on action starts and preserves the last drink's remaining time", () => {
        const candidate = calculateSkillingActionCandidate({
            action: action({
                baseTimeSeconds: 70,
                experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                inputItems: [],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            }),
            skillHrid: SKILL_HRID,
            skillLevel: 1,
            experienceNeeded: 120,
            inventory: {},
            equipmentLoadout: emptyLoadout(),
            drinkLoadout: [{
                hrid: "/items/wisdom_drink",
                durationSeconds: 300,
                buffs: [{ typeHrid: "/buff_types/wisdom", flatBoost: 1 }],
            }],
            renewDrinkHrids: ["/items/wisdom_drink"],
            priceTable: priceTable({
                "/items/wisdom_drink": { ask: 0, bid: 0, vendor: 0 },
            }),
        });

        expect(candidate.completionCount).toBe(6);
        expect(candidate.drinks[0].count).toBe(2);
        expect(candidate.endingDrinkState.itemsByHrid["/items/wisdom_drink"].remainingSeconds).toBe(230);
    });

    it("carries remaining drink duration into a different action without consuming another drink", () => {
        const wisdomDrink = {
            hrid: "/items/wisdom_drink",
            durationSeconds: 300,
            buffs: [],
        };
        const firstCandidate = calculateSkillingActionCandidate({
            action: action({
                hrid: "/actions/brewing/first",
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                inputItems: [],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            }),
            skillHrid: SKILL_HRID,
            skillLevel: 1,
            experienceNeeded: 10,
            inventory: {},
            equipmentLoadout: emptyLoadout(),
            drinkLoadout: [wisdomDrink],
            priceTable: priceTable({ "/items/wisdom_drink": { ask: 0, bid: 0, vendor: 0 } }),
        });
        const secondCandidate = calculateSkillingActionCandidate({
            action: action({
                hrid: "/actions/brewing/second",
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                inputItems: [],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            }),
            skillHrid: SKILL_HRID,
            skillLevel: 1,
            experienceNeeded: 10,
            inventory: {},
            equipmentLoadout: emptyLoadout(),
            drinkLoadout: [wisdomDrink],
            drinkState: firstCandidate.endingDrinkState,
            priceTable: priceTable({ "/items/wisdom_drink": { ask: 0, bid: 0, vendor: 0 } }),
        });

        expect(firstCandidate.drinks[0]).toMatchObject({ count: 1, carriedDurationSeconds: 0 });
        expect(firstCandidate.endingDrinkState.itemsByHrid["/items/wisdom_drink"].remainingSeconds).toBe(240);
        expect(secondCandidate.drinks[0]).toMatchObject({ count: 0, carriedDurationSeconds: 240 });
        expect(secondCandidate.endingDrinkState.itemsByHrid["/items/wisdom_drink"].remainingSeconds).toBe(180);
    });

    it("reuses only completed-cycle outputs in a repeated batch ledger", () => {
        const essenceHrid = "/items/test_essence";
        const candidate = calculateSkillingActionCandidate({
            action: action({
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 1 },
                inputItems: [{ itemHrid: essenceHrid, count: 1 }],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [{ itemHrid: essenceHrid, dropRate: 0.1, minCount: 1, maxCount: 1 }],
                rareDropTable: [],
            }),
            skillHrid: SKILL_HRID,
            skillLevel: 1,
            experienceNeeded: 30,
            inventory: { [essenceHrid]: 0.5 },
            equipmentLoadout: emptyLoadout(),
            drinkLoadout: [{
                hrid: "/items/wisdom_drink",
                durationSeconds: 300,
                buffs: [{ typeHrid: "/buff_types/wisdom", flatBoost: 1 }],
            }],
            renewDrinkHrids: ["/items/wisdom_drink"],
            inventoryReuseCompletionInterval: 5,
            priceTable: priceTable({
                [essenceHrid]: { ask: 100, bid: 0, vendor: 0 },
                "/items/wisdom_drink": { ask: 0, bid: 0, vendor: 0 },
            }),
        });
        const essenceInput = candidate.inputItems.find((row) => row.itemHrid === essenceHrid);

        expect(candidate.completionCount).toBe(15);
        expect(essenceInput.purchaseCount).toBeCloseTo(13.5, 10);
        expect(candidate.purchaseCost).toBeCloseTo(1350, 10);
        expect(candidate.inventoryDelta[essenceHrid]).toBeCloseTo(0, 10);
    });

    it("does not use surplus future outputs to fund the first batch cycle", () => {
        const essenceHrid = "/items/test_essence";
        const candidate = calculateSkillingActionCandidate({
            action: action({
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 1 },
                inputItems: [{ itemHrid: essenceHrid, count: 1 }],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [{ itemHrid: essenceHrid, dropRate: 2, minCount: 1, maxCount: 1 }],
                rareDropTable: [],
            }),
            skillHrid: SKILL_HRID,
            skillLevel: 1,
            experienceNeeded: 30,
            inventory: {},
            equipmentLoadout: emptyLoadout(),
            drinkLoadout: [{
                hrid: "/items/wisdom_drink",
                durationSeconds: 300,
                buffs: [{ typeHrid: "/buff_types/wisdom", flatBoost: 1 }],
            }],
            renewDrinkHrids: ["/items/wisdom_drink"],
            inventoryReuseCompletionInterval: 5,
            priceTable: priceTable({
                [essenceHrid]: { ask: 100, bid: 0, vendor: 0 },
                "/items/wisdom_drink": { ask: 0, bid: 0, vendor: 0 },
            }),
        });
        const essenceInput = candidate.inputItems.find((row) => row.itemHrid === essenceHrid);

        expect(essenceInput.purchaseCount).toBe(5);
        expect(candidate.purchaseCost).toBe(500);
        expect(candidate.inventoryDelta[essenceHrid]).toBe(20);
    });

    it("keeps a cheaper no-drink tail inside the same displayed recipe stage", () => {
        const wisdomDrink = {
            hrid: "/items/wisdom_drink",
            sortIndex: 1,
            durationSeconds: 300,
            usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
            buffs: [{
                uniqueHrid: "/buff_uniques/wisdom_drink",
                typeHrid: "/buff_types/wisdom",
                flatBoost: 1,
            }],
        };
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [wisdomDrink],
            equipment: [],
            totalBonusMultipliers: [0],
            actions: [action({
                levelRequirement: { skillHrid: SKILL_HRID, level: 9 },
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                inputItems: [{ itemHrid: "/items/raw", count: 1 }],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            })],
        };
        const result = planSkillingSkill({
            profile: {
                skills: {
                    [SKILL_HRID]: { level: 9, experience: 641 },
                    "/skills/total_level": { level: 9 },
                },
                inventory: {},
                equipment: [],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 10,
            priceTable: priceTable({
                "/items/raw": { ask: 10, bid: 0, vendor: 0 },
                "/items/wisdom_drink": { ask: 41, bid: 0, vendor: 0 },
            }),
            data,
        });

        expect(result.status).toBe("ok");
        expect(result.totalNetCost).toBe(141);
        expect(result.segments).toHaveLength(1);
        expect(result.segments.flatMap((segment) => segment.drinks || []))
            .toEqual([expect.objectContaining({ itemHrid: "/items/wisdom_drink", count: 1 })]);
        expect(result.segments[0].phases).toHaveLength(2);
        expect(result.segments[0].phases.at(-1).drinks).toEqual([]);

        const multiLevelResult = planSkillingSkill({
            profile: {
                skills: {
                    [SKILL_HRID]: { level: 9, experience: 641 },
                    "/skills/total_level": { level: 9 },
                },
                inventory: {},
                equipment: [],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 11,
            priceTable: priceTable({
                "/items/raw": { ask: 10, bid: 0, vendor: 0 },
                "/items/wisdom_drink": { ask: 41, bid: 0, vendor: 0 },
            }),
            data,
        });
        expect(multiLevelResult.status).toBe("ok");
        expect(multiLevelResult.segments).toHaveLength(1);
        expect(multiLevelResult.segments[0].phases.length).toBeGreaterThan(2);
        expect(multiLevelResult.segments[0].phases.reduce((sum, phase) => (
            sum + phase.completionCount
        ), 0)).toBe(multiLevelResult.segments[0].completionCount);
        expect(multiLevelResult.segments[0].phases.reduce((sum, phase) => (
            sum + phase.netCost
        ), 0)).toBeCloseTo(multiLevelResult.segments[0].netCost, 10);
    });

    it("chooses one recipe for the whole level instead of switching only for the tail", () => {
        const wisdomDrink = {
            hrid: "/items/wisdom_drink",
            sortIndex: 1,
            durationSeconds: 300,
            usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
            buffs: [{
                uniqueHrid: "/buff_uniques/wisdom_drink",
                typeHrid: "/buff_types/wisdom",
                flatBoost: 1,
            }],
        };
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [wisdomDrink],
            equipment: [],
            totalBonusMultipliers: [0],
            actions: [
                action({
                    hrid: "/actions/brewing/steady",
                    baseTimeSeconds: 60,
                    experienceGain: { skillHrid: SKILL_HRID, value: 1 },
                    inputItems: [{ itemHrid: "/items/steady_material", count: 1 }],
                    outputItems: [],
                    upgradeItemHrid: "",
                    essenceDropTable: [],
                    rareDropTable: [],
                    sortIndex: 1,
                }),
                action({
                    hrid: "/actions/brewing/burst",
                    baseTimeSeconds: 60,
                    experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                    inputItems: [{ itemHrid: "/items/burst_material", count: 1 }],
                    outputItems: [],
                    upgradeItemHrid: "",
                    essenceDropTable: [],
                    rareDropTable: [],
                    sortIndex: 2,
                }),
            ],
        };
        const result = planSkillingSkill({
            profile: {
                skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
                inventory: {},
                equipment: [],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 2,
            priceTable: priceTable({
                "/items/steady_material": { ask: 10, bid: 0, vendor: 0 },
                "/items/burst_material": { ask: 150, bid: 0, vendor: 0 },
                "/items/wisdom_drink": { ask: 20, bid: 0, vendor: 0 },
            }),
            data,
        });

        expect(result.status).toBe("ok");
        expect(result.segments).toHaveLength(1);
        expect(result.segments[0]).toMatchObject({
            actionHrid: "/actions/brewing/steady",
            completionCount: 17,
            gainedExperience: 34,
            netCost: 250,
        });
        expect(result.segments[0].drinks).toEqual([
            expect.objectContaining({ itemHrid: "/items/wisdom_drink", count: 4 }),
        ]);
        expect(result.segments[0].endingDrinkState.itemsByHrid["/items/wisdom_drink"].remainingSeconds)
            .toBe(180);
        expect(result.alternatives[0].actionHrid).toBe("/actions/brewing/steady");
    });

    it("allows legitimate levels with more drink cycles than the fixed safety floor", () => {
        const loopItemHrid = "/items/loop_tool";
        const speedDrink = {
            hrid: "/items/speed_drink",
            sortIndex: 1,
            durationSeconds: 300,
            usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
            buffs: [{
                uniqueHrid: "/buff_uniques/speed_drink",
                typeHrid: "/buff_types/action_speed",
                flatBoost: 1,
            }],
        };
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [speedDrink],
            equipment: [{
                hrid: loopItemHrid,
                equipmentType: "/equipment_types/brewing_tool",
                levelRequirements: [],
                noncombatStats: {},
                noncombatEnhancementBonuses: {},
            }],
            equipmentItemHrids: [loopItemHrid],
            totalBonusMultipliers: [0],
            actions: [action({
                levelRequirement: { skillHrid: SKILL_HRID, level: 27 },
                baseTimeSeconds: 600,
                experienceGain: { skillHrid: SKILL_HRID, value: 1 },
                inputItems: [],
                outputItems: [{ itemHrid: loopItemHrid, count: 1 }],
                upgradeItemHrid: loopItemHrid,
                essenceDropTable: [],
                rareDropTable: [],
            })],
        };
        const result = planSkillingSkill({
            profile: {
                skills: {
                    [SKILL_HRID]: { level: 27, experience: levelExperienceTable[27] },
                    "/skills/total_level": { level: 27 },
                },
                inventory: { [loopItemHrid]: 1 },
                equipment: [{
                    id: "loop-tool",
                    itemHrid: loopItemHrid,
                    enhancementLevel: 0,
                    count: 1,
                    isEquipped: false,
                }],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 28,
            priceTable: priceTable({
                [loopItemHrid]: { ask: 0, bid: 0, vendor: 0 },
                "/items/speed_drink": { ask: 0, bid: 0, vendor: 0 },
            }),
            data,
            optimizationMode: SKILLING_OPTIMIZATION_MODE_SPEED,
        });
        const expectedCompletionCount = levelExperienceTable[28] - levelExperienceTable[27];

        expect(expectedCompletionCount).toBeGreaterThan(900);
        expect(result.status).toBe("ok");
        expect(result.segments).toHaveLength(1);
        expect(result.segments[0].completionCount).toBe(expectedCompletionCount);
        expect(result.segments[0].drinks).toEqual([
            expect.objectContaining({ itemHrid: "/items/speed_drink", count: expectedCompletionCount }),
        ]);
        expect(result.endingInventory[loopItemHrid]).toBe(1);
        expect(result.endingEquipment).toEqual([
            expect.objectContaining({ itemHrid: loopItemHrid, enhancementLevel: 0, count: 1 }),
        ]);
    });

    it("ranks recipes by simulated whole-level totals instead of the first drink window", () => {
        const wisdomDrink = {
            hrid: "/items/wisdom_drink",
            sortIndex: 1,
            durationSeconds: 300,
            usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
            buffs: [{
                uniqueHrid: "/buff_uniques/wisdom_drink",
                typeHrid: "/buff_types/wisdom",
                flatBoost: 1,
            }],
        };
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [wisdomDrink],
            equipment: [],
            totalBonusMultipliers: [0],
            actions: [
                action({
                    hrid: "/actions/brewing/steady",
                    baseTimeSeconds: 60,
                    experienceGain: { skillHrid: SKILL_HRID, value: 1 },
                    inputItems: [{ itemHrid: "/items/steady_material", count: 1 }],
                    outputItems: [],
                    upgradeItemHrid: "",
                    essenceDropTable: [],
                    rareDropTable: [],
                    sortIndex: 1,
                }),
                action({
                    hrid: "/actions/brewing/burst",
                    baseTimeSeconds: 60,
                    experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                    inputItems: [{ itemHrid: "/items/burst_material", count: 1 }],
                    outputItems: [],
                    upgradeItemHrid: "",
                    essenceDropTable: [],
                    rareDropTable: [],
                    sortIndex: 2,
                }),
            ],
        };
        const result = planSkillingSkill({
            profile: {
                skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
                inventory: {},
                equipment: [],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 2,
            priceTable: priceTable({
                "/items/steady_material": { ask: 30, bid: 0, vendor: 0 },
                "/items/burst_material": { ask: 454, bid: 0, vendor: 0 },
                "/items/wisdom_drink": { ask: 100, bid: 0, vendor: 0 },
            }),
            data,
        });

        expect(result.status).toBe("ok");
        expect(result.segments).toHaveLength(1);
        expect(result.segments[0]).toMatchObject({
            actionHrid: "/actions/brewing/burst",
            completionCount: 2,
            gainedExperience: 40,
            netCost: 1_008,
        });
        expect(result.costPerExperience).toBe(25.2);
        expect(result.alternatives[0]).toMatchObject({
            actionHrid: "/actions/brewing/burst",
            completionCount: 2,
            requiredCompletionCount: 2,
            costPerExperience: 25.2,
            fullLevelCandidate: true,
        });
    });

    it("keeps the final drink state when adjacent cycles merge into one segment", () => {
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [{
                hrid: "/items/wisdom_drink",
                sortIndex: 1,
                durationSeconds: 300,
                usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
                buffs: [{
                    uniqueHrid: "/buff_uniques/wisdom_drink",
                    typeHrid: "/buff_types/wisdom",
                    flatBoost: 1,
                }],
            }],
            equipment: [],
            totalBonusMultipliers: [0],
            actions: [action({
                levelRequirement: { skillHrid: SKILL_HRID, level: 9 },
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                inputItems: [],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            })],
        };
        const result = planSkillingSkill({
            profile: {
                skills: {
                    [SKILL_HRID]: { level: 9, experience: 641 },
                    "/skills/total_level": { level: 9 },
                },
                inventory: {},
                equipment: [],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 10,
            priceTable: priceTable({
                "/items/wisdom_drink": { ask: 0, bid: 0, vendor: 0 },
            }),
            data,
        });

        expect(result.segments).toHaveLength(1);
        expect(result.segments[0].drinks[0].count).toBe(2);
        expect(result.segments[0].endingDrinkState.itemsByHrid["/items/wisdom_drink"].remainingSeconds)
            .toBe(120);
    });

    it("batches repeated full drink cycles within a long level", () => {
        const wisdomDrink = {
            hrid: "/items/wisdom_drink",
            sortIndex: 1,
            durationSeconds: 300,
            usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
            buffs: [{
                uniqueHrid: "/buff_uniques/wisdom_drink",
                typeHrid: "/buff_types/wisdom",
                flatBoost: 1,
            }],
        };
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [wisdomDrink],
            equipment: [],
            totalBonusMultipliers: [0],
            actions: [action({
                levelRequirement: { skillHrid: SKILL_HRID, level: 50 },
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 1 },
                inputItems: [],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            })],
        };
        const result = planSkillingSkill({
            profile: {
                skills: {
                    [SKILL_HRID]: { level: 50, experience: levelExperienceTable[50] },
                    "/skills/total_level": { level: 50 },
                },
                inventory: {},
                equipment: [],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 51,
            priceTable: priceTable({
                "/items/wisdom_drink": { ask: 0, bid: 0, vendor: 0 },
            }),
            data,
        });
        const totalDrinkCount = result.segments
            .flatMap((segment) => segment.drinks || [])
            .reduce((sum, drink) => sum + drink.count, 0);

        expect(result.status).toBe("ok");
        expect(result.totalExperience).toBe(levelExperienceTable[51] - levelExperienceTable[50]);
        expect(totalDrinkCount).toBe(989);
    });

    it("batches staggered drink renewals without exceeding the iteration limit", () => {
        const drinks = [5340, 5820, 6000].map((durationSeconds, index) => ({
            hrid: `/items/staggered_wisdom_${index}`,
            sortIndex: index,
            durationSeconds,
            usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
            buffs: [{
                uniqueHrid: `/buff_uniques/staggered_wisdom_${index}`,
                typeHrid: "/buff_types/wisdom",
                flatBoost: 1,
            }],
        }));
        const pouchHrid = "/items/three_drink_pouch";
        const data = {
            skillHrids: [SKILL_HRID],
            drinks,
            equipment: [{
                hrid: pouchHrid,
                equipmentType: "/equipment_types/pouch",
                levelRequirements: [],
                drinkSlots: 2,
                noncombatStats: {},
                noncombatEnhancementBonuses: {},
            }],
            totalBonusMultipliers: [0],
            actions: [action({
                levelRequirement: { skillHrid: SKILL_HRID, level: 199 },
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 1 },
                inputItems: [],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            })],
        };
        const result = planSkillingSkill({
            profile: {
                skills: {
                    [SKILL_HRID]: { level: 199, experience: levelExperienceTable[199] },
                    "/skills/total_level": { level: 199 },
                },
                inventory: { [pouchHrid]: 1 },
                equipment: [{
                    id: "pouch",
                    itemHrid: pouchHrid,
                    enhancementLevel: 0,
                    count: 1,
                    isEquipped: false,
                }],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 200,
            priceTable: priceTable(Object.fromEntries([
                [pouchHrid, { ask: 0, bid: 0, vendor: 0 }],
                ...drinks.map((drink) => [drink.hrid, { ask: 0, bid: 0, vendor: 0 }]),
            ])),
            data,
        });

        expect(result.status).toBe("ok");
        const requiredExperience = levelExperienceTable[200] - levelExperienceTable[199];
        expect(result.totalExperience).toBeGreaterThanOrEqual(requiredExperience);
        expect(result.totalExperience).toBeLessThan(requiredExperience + 4);
        expect(result.segments[0].drinks).toHaveLength(3);
    });

    it("does not batch an unconfirmed carried drink past its first expiration", () => {
        const drinks = [60, 120, 180].map((durationSeconds, index) => ({
            hrid: `/items/renewal_choice_${index}`,
            sortIndex: index,
            durationSeconds,
            usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
            buffs: [{
                uniqueHrid: `/buff_uniques/renewal_choice_${index}`,
                typeHrid: "/buff_types/wisdom",
                flatBoost: 1,
            }],
        }));
        const pouchHrid = "/items/three_drink_pouch";
        const expensiveDrinkHrid = drinks[2].hrid;
        const data = {
            skillHrids: [SKILL_HRID],
            drinks,
            equipment: [{
                hrid: pouchHrid,
                equipmentType: "/equipment_types/pouch",
                levelRequirements: [],
                drinkSlots: 2,
                noncombatStats: {},
                noncombatEnhancementBonuses: {},
            }],
            totalBonusMultipliers: [0],
            actions: [action({
                levelRequirement: { skillHrid: SKILL_HRID, level: 50 },
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                inputItems: [{ itemHrid: "/items/raw", count: 1 }],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            })],
        };
        const result = planSkillingSkill({
            profile: {
                skills: {
                    [SKILL_HRID]: { level: 50, experience: levelExperienceTable[50] },
                    "/skills/total_level": { level: 50 },
                },
                inventory: { [pouchHrid]: 1, [expensiveDrinkHrid]: 1 },
                equipment: [{
                    id: "pouch",
                    itemHrid: pouchHrid,
                    enhancementLevel: 0,
                    count: 1,
                    isEquipped: false,
                }],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 51,
            priceTable: priceTable(Object.fromEntries([
                ["/items/raw", { ask: 1, bid: 0, vendor: 0 }],
                [expensiveDrinkHrid, { ask: 100, bid: 0, vendor: 0 }],
                ...drinks.slice(0, 2).map((drink) => [drink.hrid, { ask: 0, bid: 0, vendor: 0 }]),
            ])),
            data,
        });
        const expensiveDrinkRows = result.segments
            .flatMap((segment) => segment.drinks || [])
            .filter((drink) => drink.itemHrid === expensiveDrinkHrid);

        expect(result.status).toBe("ok");
        expect(result.totalNetCost).toBe(329);
        expect(expensiveDrinkRows.reduce((sum, drink) => sum + drink.count, 0)).toBe(1);
    });

    it("rechecks a carried drink's price before its next renewal", () => {
        const drinks = [300, 420, 1200].map((durationSeconds, index) => ({
            hrid: `/items/carried_price_${index}`,
            sortIndex: index,
            durationSeconds,
            usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
            buffs: [{
                uniqueHrid: `/buff_uniques/carried_price_${index}`,
                typeHrid: "/buff_types/wisdom",
                flatBoost: 1,
            }],
        }));
        const pouchHrid = "/items/three_drink_pouch";
        const expensiveDrinkHrid = drinks[0].hrid;
        const data = {
            skillHrids: [SKILL_HRID],
            drinks,
            equipment: [{
                hrid: pouchHrid,
                equipmentType: "/equipment_types/pouch",
                levelRequirements: [],
                drinkSlots: 2,
                noncombatStats: {},
                noncombatEnhancementBonuses: {},
            }],
            totalBonusMultipliers: [0],
            actions: [action({
                levelRequirement: { skillHrid: SKILL_HRID, level: 50 },
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                inputItems: [],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            })],
        };
        const result = planSkillingSkill({
            profile: {
                skills: {
                    [SKILL_HRID]: { level: 50, experience: levelExperienceTable[50] },
                    "/skills/total_level": { level: 50 },
                },
                inventory: { [pouchHrid]: 1, [expensiveDrinkHrid]: 2 },
                equipment: [{
                    id: "pouch",
                    itemHrid: pouchHrid,
                    enhancementLevel: 0,
                    count: 1,
                    isEquipped: false,
                }],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 51,
            priceTable: priceTable(Object.fromEntries([
                [expensiveDrinkHrid, { ask: 100, bid: 0, vendor: 0 }],
                ...drinks.slice(1).map((drink) => [drink.hrid, { ask: 0, bid: 0, vendor: 0 }]),
            ])),
            data,
        });
        const expensiveDrinkRows = result.segments
            .flatMap((segment) => segment.drinks || [])
            .filter((drink) => drink.itemHrid === expensiveDrinkHrid);
        const purchasedExpensiveDrinks = result.segments
            .flatMap((segment) => segment.inputItems || [])
            .filter((row) => row.itemHrid === expensiveDrinkHrid)
            .reduce((sum, row) => sum + row.purchaseCount, 0);

        expect(result.status).toBe("ok");
        expect(result.totalNetCost).toBe(0);
        expect(expensiveDrinkRows.reduce((sum, drink) => sum + drink.count, 0)).toBe(2);
        expect(purchasedExpensiveDrinks).toBe(0);
    });

    it("replans when owned drinks run out instead of batching into purchases", () => {
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [{
                hrid: "/items/wisdom_drink",
                sortIndex: 1,
                durationSeconds: 300,
                usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
                buffs: [{
                    uniqueHrid: "/buff_uniques/wisdom_drink",
                    typeHrid: "/buff_types/wisdom",
                    flatBoost: 1,
                }],
            }],
            equipment: [],
            totalBonusMultipliers: [0],
            actions: [action({
                levelRequirement: { skillHrid: SKILL_HRID, level: 50 },
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                inputItems: [{ itemHrid: "/items/raw", count: 1 }],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            })],
        };
        const result = planSkillingSkill({
            profile: {
                skills: {
                    [SKILL_HRID]: { level: 50, experience: levelExperienceTable[50] },
                    "/skills/total_level": { level: 50 },
                },
                inventory: { "/items/wisdom_drink": 95 },
                equipment: [],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 51,
            priceTable: priceTable({
                "/items/raw": { ask: 1, bid: 0, vendor: 0 },
                "/items/wisdom_drink": { ask: 100, bid: 0, vendor: 0 },
            }),
            data,
        });
        const drinkRows = result.segments
            .flatMap((segment) => segment.drinks || [])
            .filter((drink) => drink.itemHrid === "/items/wisdom_drink");
        const purchasedDrinkCount = result.segments
            .flatMap((segment) => segment.inputItems || [])
            .filter((row) => row.itemHrid === "/items/wisdom_drink")
            .reduce((sum, row) => sum + row.purchaseCount, 0);

        expect(result.status).toBe("ok");
        expect(result.totalNetCost).toBe(514);
        expect(drinkRows.reduce((sum, drink) => sum + drink.count, 0)).toBe(95);
        expect(purchasedDrinkCount).toBe(0);
    });

    it("does not use same-item outputs as batch-start inventory", () => {
        const essenceHrid = "/items/test_essence";
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [{
                hrid: "/items/wisdom_drink",
                sortIndex: 1,
                durationSeconds: 300,
                usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
                buffs: [{
                    uniqueHrid: "/buff_uniques/wisdom_drink",
                    typeHrid: "/buff_types/wisdom",
                    flatBoost: 1,
                }],
            }],
            equipment: [],
            totalBonusMultipliers: [0],
            actions: [action({
                levelRequirement: { skillHrid: SKILL_HRID, level: 9 },
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 1 },
                inputItems: [{ itemHrid: essenceHrid, count: 1 }],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [{ itemHrid: essenceHrid, dropRate: 0.1, minCount: 1, maxCount: 1 }],
                rareDropTable: [],
            })],
        };
        const result = planSkillingSkill({
            profile: {
                skills: {
                    [SKILL_HRID]: { level: 9, experience: 761 },
                    "/skills/total_level": { level: 9 },
                },
                inventory: { [essenceHrid]: 14 },
                equipment: [],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 10,
            priceTable: priceTable({
                [essenceHrid]: { ask: 100, bid: 0, vendor: 0 },
                "/items/wisdom_drink": { ask: 0, bid: 0, vendor: 0 },
            }),
            data,
        });

        expect(result.status).toBe("ok");
        expect(result.totalPurchaseCost).toBe(0);
        expect(result.endingInventory[essenceHrid]).toBeCloseTo(0.5, 10);
    });

    it("batches a stable mix of reused outputs and purchases", () => {
        const essenceHrid = "/items/test_essence";
        let progressCalls = 0;
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [{
                hrid: "/items/wisdom_drink",
                sortIndex: 1,
                durationSeconds: 300,
                usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
                buffs: [{
                    uniqueHrid: "/buff_uniques/wisdom_drink",
                    typeHrid: "/buff_types/wisdom",
                    flatBoost: 1,
                }],
            }],
            equipment: [],
            totalBonusMultipliers: [0],
            actions: [action({
                levelRequirement: { skillHrid: SKILL_HRID, level: 199 },
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 1 },
                inputItems: [{ itemHrid: essenceHrid, count: 1 }],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [{ itemHrid: essenceHrid, dropRate: 0.1, minCount: 1, maxCount: 1 }],
                rareDropTable: [],
            })],
        };
        const result = planSkillingSkill({
            profile: {
                skills: {
                    [SKILL_HRID]: { level: 199, experience: levelExperienceTable[199] },
                    "/skills/total_level": { level: 199 },
                },
                inventory: {},
                equipment: [],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 200,
            priceTable: priceTable({
                [essenceHrid]: { ask: 0, bid: 0, vendor: 0 },
                "/items/wisdom_drink": { ask: 0, bid: 0, vendor: 0 },
            }),
            data,
            onProgress: () => {
                progressCalls += 1;
            },
        });

        expect(result.status).toBe("ok");
        expect(progressCalls).toBeLessThan(10);
    });

    it("batches full cycles up to a non-aligned external Buff expiration", () => {
        const now = Date.parse("2026-01-01T00:00:00Z");
        let progressCalls = 0;
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [{
                hrid: "/items/wisdom_drink",
                sortIndex: 1,
                durationSeconds: 300,
                usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
                buffs: [{
                    uniqueHrid: "/buff_uniques/wisdom_drink",
                    typeHrid: "/buff_types/wisdom",
                    flatBoost: 1,
                }],
            }],
            equipment: [],
            totalBonusMultipliers: [0],
            actions: [action({
                levelRequirement: { skillHrid: SKILL_HRID, level: 199 },
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 1 },
                inputItems: [],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            })],
        };
        const result = planSkillingSkill({
            profile: {
                skills: {
                    [SKILL_HRID]: { level: 199, experience: levelExperienceTable[199] },
                    "/skills/total_level": { level: 199 },
                },
                inventory: {},
                equipment: [],
                buffsBySource: {
                    house: {
                        [ACTION_TYPE_HRID]: [{
                            typeHrid: "/buff_types/essence_find",
                            flatBoost: 0.1,
                            startTime: "2026-01-01T00:00:00Z",
                            duration: 1_000_001 * 1_000_000_000,
                        }],
                    },
                },
            },
            skillHrid: SKILL_HRID,
            targetLevel: 200,
            priceTable: priceTable({
                "/items/wisdom_drink": { ask: 0, bid: 0, vendor: 0 },
            }),
            data,
            now,
            onProgress: () => {
                progressCalls += 1;
            },
        });

        expect(result.status).toBe("ok");
        expect(progressCalls).toBeLessThan(10);
        expect(result.segments.some((segment) => segment.bonuses.essenceFind === 0)).toBe(true);
    });

    it("keeps an active drink when a later level adds a non-conflicting drink slot", () => {
        const drinks = [
            {
                hrid: "/items/speed_drink",
                sortIndex: 1,
                durationSeconds: 300,
                usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
                buffs: [{
                    uniqueHrid: "/buff_uniques/speed_drink",
                    typeHrid: "/buff_types/action_speed",
                    flatBoost: 1,
                }],
            },
            {
                hrid: "/items/wisdom_drink",
                sortIndex: 2,
                durationSeconds: 300,
                usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
                buffs: [{
                    uniqueHrid: "/buff_uniques/wisdom_drink",
                    typeHrid: "/buff_types/wisdom",
                    flatBoost: 1,
                }],
            },
        ];
        const data = {
            skillHrids: [SKILL_HRID],
            drinks,
            equipment: [{
                hrid: "/items/level_two_pouch",
                equipmentType: "/equipment_types/pouch",
                levelRequirements: [{ skillHrid: SKILL_HRID, level: 2 }],
                drinkSlots: 1,
                noncombatStats: {},
                noncombatEnhancementBonuses: {},
            }],
            totalBonusMultipliers: [0],
            actions: [action({
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                inputItems: [],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            })],
        };
        const result = planSkillingSkill({
            profile: {
                skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
                inventory: { "/items/level_two_pouch": 1 },
                equipment: [{
                    id: "pouch",
                    itemHrid: "/items/level_two_pouch",
                    enhancementLevel: 0,
                    count: 1,
                    isEquipped: false,
                }],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 3,
            priceTable: priceTable({
                "/items/speed_drink": { ask: 0, bid: 0, vendor: 0 },
                "/items/wisdom_drink": { ask: 0, bid: 0, vendor: 0 },
            }),
            data,
        });
        const speedDrinkCount = result.segments
            .flatMap((segment) => segment.drinks || [])
            .filter((drink) => drink.itemHrid === "/items/speed_drink")
            .reduce((sum, drink) => sum + drink.count, 0);

        expect(result.status).toBe("ok");
        expect(result.segments).toHaveLength(2);
        expect(result.segments[1].drinks).toEqual(expect.arrayContaining([
            expect.objectContaining({ itemHrid: "/items/speed_drink", count: 0 }),
            expect.objectContaining({ itemHrid: "/items/wisdom_drink", count: 1 }),
        ]));
        expect(speedDrinkCount).toBe(1);
    });

    it("returns partial totals when a later level is blocked by a missing ask", () => {
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [],
            equipment: [],
            totalBonusMultipliers: [0],
            actions: [action({
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 33 },
                inputItems: [{ itemHrid: "/items/raw", count: 1 }],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            })],
        };
        const result = planSkillingSkill({
            profile: {
                skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
                inventory: { "/items/raw": 1 },
                equipment: [],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 3,
            priceTable: priceTable({ "/items/raw": { ask: -1, bid: 10, vendor: 0 } }),
            data,
        });

        expect(result.status).toBe("blocked");
        expect(result.optimizationMode).toBe(SKILLING_OPTIMIZATION_MODE_COST);
        expect(result.balancedCostTolerance).toBe(SKILLING_BALANCED_COST_TOLERANCE);
        expect(result.segments).toHaveLength(1);
        expect(result.missingPriceHrids).toEqual(["/items/raw"]);
        expect(result).toMatchObject({
            totalNetCost: 9.8,
            totalPurchaseCost: 0,
            totalOpportunityCost: 9.8,
            totalOutputValue: 0,
            totalDurationHours: 1 / 60,
            totalExperience: 33,
        });
        expect(result.costPerExperience).toBeCloseTo(9.8 / 33, 10);
        expect(result.experiencePerHour).toBeCloseTo(1980, 10);
    });

    it("does not report missing prices from unselected candidates", () => {
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [],
            equipment: [],
            totalBonusMultipliers: [0],
            actions: [
                action({
                    hrid: "/actions/brewing/available",
                    experienceGain: { skillHrid: SKILL_HRID, value: 33 },
                    inputItems: [],
                    outputItems: [],
                    upgradeItemHrid: "",
                    essenceDropTable: [],
                    rareDropTable: [],
                    sortIndex: 1,
                }),
                action({
                    hrid: "/actions/brewing/missing",
                    experienceGain: { skillHrid: SKILL_HRID, value: 33 },
                    inputItems: [{ itemHrid: "/items/missing", count: 1 }],
                    outputItems: [],
                    upgradeItemHrid: "",
                    essenceDropTable: [],
                    rareDropTable: [],
                    sortIndex: 2,
                }),
            ],
        };
        const result = planSkillingSkill({
            profile: {
                skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
                inventory: {},
                equipment: [],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 2,
            priceTable: priceTable({ "/items/missing": { ask: -1, bid: 0, vendor: 0 } }),
            data,
        });

        expect(result.status).toBe("ok");
        expect(result.segments[0].actionHrid).toBe("/actions/brewing/available");
        expect(result.missingPriceHrids).toEqual([]);
    });

    it("replans after leveling and reuses produced upgrade items", () => {
        const data = {
            skillHrids: [SKILL_HRID],
            actionTypeHrids: [ACTION_TYPE_HRID],
            equipment: [],
            drinks: [],
            totalBonusMultipliers: [0],
            actions: [
                action({
                    hrid: "/actions/brewing/base",
                    levelRequirement: { skillHrid: SKILL_HRID, level: 1 },
                    baseTimeSeconds: 10,
                    experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                    inputItems: [{ itemHrid: "/items/raw", count: 1 }],
                    outputItems: [{ itemHrid: "/items/intermediate", count: 1 }],
                    upgradeItemHrid: "",
                    essenceDropTable: [],
                    rareDropTable: [],
                    sortIndex: 1,
                }),
                action({
                    hrid: "/actions/brewing/upgrade",
                    levelRequirement: { skillHrid: SKILL_HRID, level: 2 },
                    baseTimeSeconds: 10,
                    experienceGain: { skillHrid: SKILL_HRID, value: 20 },
                    inputItems: [],
                    outputItems: [{ itemHrid: "/items/final", count: 1 }],
                    upgradeItemHrid: "/items/intermediate",
                    essenceDropTable: [],
                    rareDropTable: [],
                    sortIndex: 2,
                }),
            ],
        };
        const result = planSkillingSkill({
            profile: {
                skills: {
                    [SKILL_HRID]: { level: 1, experience: 0 },
                    "/skills/total_level": { level: 1, experience: null },
                },
                inventory: { "/items/raw": 10 },
                equipment: [],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 3,
            priceTable: priceTable({
                "/items/raw": { ask: 10, bid: 10, vendor: 0 },
                "/items/intermediate": { ask: 10, bid: 10, vendor: 0 },
                "/items/final": { ask: 100, bid: 100, vendor: 0 },
            }),
            data,
        });
        expect(result.status).toBe("ok");
        expect(result.segments.map((segment) => segment.actionHrid)).toEqual([
            "/actions/brewing/base",
            "/actions/brewing/upgrade",
        ]);
        expect(result.segments[1].inputItems.find((item) => item.itemHrid === "/items/intermediate").purchaseCount).toBe(0);
        expect(result.totalNetCost).toBeLessThan(0);
    });

    it("carries cross-level experience, depletes inventory, and merges a stable route", () => {
        const data = {
            skillHrids: [SKILL_HRID],
            equipment: [],
            drinks: [],
            totalBonusMultipliers: [0],
            actions: [action({
                hrid: "/actions/brewing/stable",
                baseTimeSeconds: 10,
                experienceGain: { skillHrid: SKILL_HRID, value: 40 },
                inputItems: [{ itemHrid: "/items/raw", count: 1 }],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            })],
        };
        const result = planSkillingSkill({
            profile: {
                skills: {
                    [SKILL_HRID]: { level: 1, experience: 0 },
                    "/skills/total_level": { level: 5, experience: null },
                },
                inventory: { "/items/raw": 1 },
                equipment: [],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 3,
            priceTable: priceTable({ "/items/raw": { ask: 10, bid: 10, vendor: 0 } }),
            data,
        });

        expect(result.segments).toHaveLength(1);
        expect(result.segments[0]).toMatchObject({ fromLevel: 1, toLevel: 3, completionCount: 2, gainedExperience: 80 });
        expect(result.segments[0].inputItems[0]).toMatchObject({ ownedCount: 1, purchaseCount: 1 });
        expect(result.segments[0].drinkPurchaseCost).toBe(0);
        expect(result.segments[0].materialPurchaseCost).toBe(10);
        expect(result.totalDrinkPurchaseCost).toBe(0);
        expect(result.totalMaterialPurchaseCost).toBe(10);
        expect(result.materialPurchaseCostPerExperience).toBeCloseTo(10 / 80, 10);
    });

    it("rechecks skill and total-level equipment requirements after leveling", () => {
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [],
            totalBonusMultipliers: [0],
            equipment: [{
                hrid: "/items/unlocked_tool",
                equipmentType: "/equipment_types/brewing_tool",
                levelRequirements: [
                    { skillHrid: SKILL_HRID, level: 2 },
                    { skillHrid: "/skills/total_level", level: 6 },
                ],
                noncombatStats: { brewingSpeed: 1 },
                noncombatEnhancementBonuses: {},
            }],
            actions: [action({
                hrid: "/actions/brewing/leveling",
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                inputItems: [],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            })],
        };
        const result = planSkillingSkill({
            profile: {
                skills: {
                    [SKILL_HRID]: { level: 1, experience: 0 },
                    "/skills/total_level": { level: 5, experience: null },
                },
                inventory: { "/items/unlocked_tool": 1 },
                equipment: [{ id: "tool", itemHrid: "/items/unlocked_tool", enhancementLevel: 0, isEquipped: false }],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 3,
            priceTable: priceTable(),
            data,
        });

        expect(result.segments).toHaveLength(2);
        expect(result.segments[0].equipment).toEqual([]);
        expect(result.segments[1].equipment[0].itemHrid).toBe("/items/unlocked_tool");
        expect(result.segments[1].actionSeconds).toBe(30);
    });

    it("uses a pouch to select distinct drinks up to the available slots", () => {
        const drinks = ["wisdom", "speed"].map((name, index) => ({
            hrid: `/items/${name}_drink`,
            sortIndex: index,
            durationSeconds: 300,
            usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
            buffs: [{
                typeHrid: name === "wisdom" ? "/buff_types/wisdom" : "/buff_types/action_speed",
                flatBoost: 0.2,
            }],
        }));
        const data = {
            skillHrids: [SKILL_HRID],
            drinks,
            totalBonusMultipliers: [0],
            equipment: [{
                hrid: "/items/test_pouch",
                equipmentType: "/equipment_types/pouch",
                levelRequirements: [],
                drinkSlots: 1,
                noncombatStats: {},
                noncombatEnhancementBonuses: {},
            }],
            actions: [action({
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                inputItems: [],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            })],
        };
        const result = planSkillingSkill({
            profile: {
                skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
                inventory: { "/items/test_pouch": 1 },
                equipment: [{ id: "pouch", itemHrid: "/items/test_pouch", enhancementLevel: 0, isEquipped: false }],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 2,
            priceTable: priceTable({
                "/items/wisdom_drink": { ask: 0, bid: 0, vendor: 0 },
                "/items/speed_drink": { ask: 0, bid: 0, vendor: 0 },
            }),
            data,
        });

        expect(result.segments[0].drinkSlots).toBe(2);
        expect(result.segments[0].drinks.map((drink) => drink.itemHrid).sort()).toEqual([
            "/items/speed_drink",
            "/items/wisdom_drink",
        ]);
    });

    it("does not stack drinks that share a Buff unique HRID", () => {
        const drinks = [
            {
                hrid: "/items/weak_tea",
                sortIndex: 1,
                durationSeconds: 300,
                usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
                buffs: [{ uniqueHrid: "/buff_uniques/skill_tea", typeHrid: "/buff_types/wisdom", flatBoost: 0.1 }],
            },
            {
                hrid: "/items/strong_tea",
                sortIndex: 2,
                durationSeconds: 300,
                usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
                buffs: [{ uniqueHrid: "/buff_uniques/skill_tea", typeHrid: "/buff_types/wisdom", flatBoost: 0.2 }],
            },
            {
                hrid: "/items/speed_tea",
                sortIndex: 3,
                durationSeconds: 300,
                usableInActionTypeMap: { [ACTION_TYPE_HRID]: true },
                buffs: [{ uniqueHrid: "/buff_uniques/speed_tea", typeHrid: "/buff_types/action_speed", flatBoost: 0.2 }],
            },
        ];
        const data = {
            skillHrids: [SKILL_HRID],
            drinks,
            totalBonusMultipliers: [0],
            equipment: [{
                hrid: "/items/test_pouch",
                equipmentType: "/equipment_types/pouch",
                levelRequirements: [],
                drinkSlots: 2,
                noncombatStats: {},
                noncombatEnhancementBonuses: {},
            }],
            actions: [action({
                baseTimeSeconds: 60,
                experienceGain: { skillHrid: SKILL_HRID, value: 10 },
                inputItems: [],
                outputItems: [],
                upgradeItemHrid: "",
                essenceDropTable: [],
                rareDropTable: [],
            })],
        };
        const result = planSkillingSkill({
            profile: {
                skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
                inventory: { "/items/test_pouch": 1 },
                equipment: [{ id: "pouch", itemHrid: "/items/test_pouch", enhancementLevel: 0, isEquipped: false }],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 2,
            priceTable: priceTable({
                "/items/weak_tea": { ask: 0, bid: 0, vendor: 0 },
                "/items/strong_tea": { ask: 0, bid: 0, vendor: 0 },
                "/items/speed_tea": { ask: 0, bid: 0, vendor: 0 },
            }),
            data,
        });

        expect(result.segments[0].drinkSlots).toBe(3);
        expect(result.segments[0].drinks.map((drink) => drink.itemHrid).sort()).toEqual([
            "/items/speed_tea",
            "/items/strong_tea",
        ]);
    });

    it("retains an unequipped loadout when the equipment can be consumed by the recipe", () => {
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [],
            totalBonusMultipliers: [0],
            equipment: [{
                hrid: "/items/material_pouch",
                equipmentType: "/equipment_types/pouch",
                levelRequirements: [],
                drinkSlots: 1,
                noncombatStats: {},
                noncombatEnhancementBonuses: {},
            }],
            actions: [action({
                experienceGain: { skillHrid: SKILL_HRID, value: 33 },
                inputItems: [],
                outputItems: [{ itemHrid: "/items/upgraded_pouch", count: 1 }],
                upgradeItemHrid: "/items/material_pouch",
                essenceDropTable: [],
                rareDropTable: [],
            })],
        };
        const result = planSkillingSkill({
            profile: {
                skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
                inventory: { "/items/material_pouch": 1 },
                equipment: [{ id: "pouch", itemHrid: "/items/material_pouch", enhancementLevel: 0, isEquipped: false }],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 2,
            priceTable: priceTable({
                "/items/material_pouch": { ask: -1, bid: 100, vendor: 0 },
                "/items/upgraded_pouch": { ask: -1, bid: 0, vendor: 0 },
            }),
            data,
        });

        expect(result.status).toBe("ok");
        expect(result.segments[0].equipment).toEqual([]);
        expect(result.segments[0].inputItems[0]).toMatchObject({ ownedCount: 1, purchaseCount: 0 });
    });

    it("can unequip and consume the currently worn upgrade item", () => {
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [],
            totalBonusMultipliers: [0],
            equipment: [{
                hrid: "/items/worn_pouch",
                equipmentType: "/equipment_types/pouch",
                levelRequirements: [],
                drinkSlots: 1,
                noncombatStats: {},
                noncombatEnhancementBonuses: {},
            }],
            equipmentItemHrids: ["/items/worn_pouch", "/items/upgraded_pouch"],
            actions: [action({
                experienceGain: { skillHrid: SKILL_HRID, value: 33 },
                inputItems: [],
                outputItems: [{ itemHrid: "/items/upgraded_pouch", count: 1 }],
                upgradeItemHrid: "/items/worn_pouch",
                essenceDropTable: [],
                rareDropTable: [],
            })],
        };
        const result = planSkillingSkill({
            profile: {
                skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
                inventory: {},
                equipment: [{
                    id: "worn",
                    itemHrid: "/items/worn_pouch",
                    equipmentType: "/equipment_types/pouch",
                    enhancementLevel: 0,
                    count: 1,
                    isEquipped: true,
                }],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 2,
            priceTable: priceTable({
                "/items/worn_pouch": { ask: -1, bid: 100, vendor: 0 },
                "/items/upgraded_pouch": { ask: -1, bid: 0, vendor: 0 },
            }),
            data,
        });

        expect(result.status).toBe("ok");
        expect(result.segments[0].equipment).toEqual([]);
        expect(result.segments[0].inputItems[0]).toMatchObject({ ownedCount: 1, purchaseCount: 0 });
        expect(result.endingEquipment.some((item) => item.id === "worn")).toBe(false);
    });

    it("equips skilling gear produced by an earlier level", () => {
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [],
            totalBonusMultipliers: [0],
            equipment: [{
                hrid: "/items/produced_charm",
                equipmentType: "/equipment_types/charm",
                levelRequirements: [{ skillHrid: SKILL_HRID, level: 2 }],
                drinkSlots: 0,
                noncombatStats: { brewingExperience: 1 },
                noncombatEnhancementBonuses: {},
            }],
            equipmentItemHrids: ["/items/produced_charm"],
            actions: [
                action({
                    hrid: "/actions/brewing/make_charm",
                    levelRequirement: { skillHrid: SKILL_HRID, level: 1 },
                    experienceGain: { skillHrid: SKILL_HRID, value: 33 },
                    inputItems: [],
                    outputItems: [{ itemHrid: "/items/produced_charm", count: 1 }],
                    upgradeItemHrid: "",
                    essenceDropTable: [],
                    rareDropTable: [],
                    sortIndex: 1,
                }),
                action({
                    hrid: "/actions/brewing/train",
                    levelRequirement: { skillHrid: SKILL_HRID, level: 2 },
                    experienceGain: { skillHrid: SKILL_HRID, value: 43 },
                    inputItems: [],
                    outputItems: [],
                    upgradeItemHrid: "",
                    essenceDropTable: [],
                    rareDropTable: [],
                    sortIndex: 2,
                }),
            ],
        };
        const result = planSkillingSkill({
            profile: {
                skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
                inventory: {},
                equipment: [],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 3,
            priceTable: priceTable({
                "/items/produced_charm": { ask: 0, bid: 0, vendor: 0 },
            }),
            data,
        });

        expect(result.status).toBe("ok");
        expect(result.segments).toHaveLength(2);
        expect(result.segments[1].equipment).toEqual([
            expect.objectContaining({ itemHrid: "/items/produced_charm", enhancementLevel: 0 }),
        ]);
        expect(result.segments[1].experiencePerAction).toBe(86);
    });

    it("preserves enhancement and uses enhanced quotes for retained upgrade outputs", () => {
        const candidate = calculateSkillingActionCandidate({
            action: action({
                experienceGain: { skillHrid: SKILL_HRID, value: 33 },
                inputItems: [],
                outputItems: [{ itemHrid: "/items/refined_cape", count: 1 }],
                upgradeItemHrid: "/items/base_cape",
                retainAllEnhancement: true,
                essenceDropTable: [],
                rareDropTable: [],
            }),
            skillHrid: SKILL_HRID,
            skillLevel: 1,
            experienceNeeded: 33,
            inventory: { "/items/base_cape": 1 },
            equipmentInstances: [{
                id: "cape",
                itemHrid: "/items/base_cape",
                enhancementLevel: 12,
                count: 1,
                isEquipped: false,
            }],
            equipmentLoadout: emptyLoadout(),
            priceTable: priceTable({
                "/items/base_cape": { ask: 100, bid: 100, vendor: 0 },
                "/items/refined_cape": { ask: 200, bid: 200, vendor: 0 },
            }),
            enhancementQuotesByItem: {
                "/items/base_cape": { "12": { ask: 1100, bid: 1000 } },
                "/items/refined_cape": { "12": { ask: 2100, bid: 2000 } },
            },
        });

        expect(candidate.inputItems[0].opportunityCost).toBe(980);
        expect(candidate.inputItems[0].enhancementLevel).toBe(12);
        expect(candidate.outputItems[0]).toMatchObject({
            itemHrid: "/items/refined_cape",
            enhancementLevel: 12,
            liquidationValue: 1960,
        });
        expect(candidate.netCost).toBe(-980);
        expect(candidate.consumedEquipment).toEqual([
            expect.objectContaining({ id: "cape", enhancementLevel: 12, count: 1 }),
        ]);
    });

    it("does not re-equip an inventory item consumed by an earlier level", () => {
        const data = {
            skillHrids: [SKILL_HRID],
            drinks: [],
            totalBonusMultipliers: [0],
            equipment: [{
                hrid: "/items/consumed_charm",
                equipmentType: "/equipment_types/charm",
                levelRequirements: [],
                drinkSlots: 0,
                noncombatStats: { brewingExperience: 0.5 },
                noncombatEnhancementBonuses: {},
            }],
            actions: [
                action({
                    hrid: "/actions/brewing/consume_charm",
                    levelRequirement: { skillHrid: SKILL_HRID, level: 1 },
                    experienceGain: { skillHrid: SKILL_HRID, value: 33 },
                    inputItems: [],
                    outputItems: [],
                    upgradeItemHrid: "/items/consumed_charm",
                    essenceDropTable: [],
                    rareDropTable: [],
                    sortIndex: 1,
                }),
                action({
                    hrid: "/actions/brewing/after_consumption",
                    levelRequirement: { skillHrid: SKILL_HRID, level: 2 },
                    experienceGain: { skillHrid: SKILL_HRID, value: 43 },
                    inputItems: [],
                    outputItems: [],
                    upgradeItemHrid: "",
                    essenceDropTable: [],
                    rareDropTable: [],
                    sortIndex: 2,
                }),
            ],
        };
        const result = planSkillingSkill({
            profile: {
                skills: { [SKILL_HRID]: { level: 1, experience: 0 }, "/skills/total_level": { level: 1 } },
                inventory: { "/items/consumed_charm": 1 },
                equipment: [{ id: "charm", itemHrid: "/items/consumed_charm", enhancementLevel: 0, isEquipped: false }],
                buffsBySource: {},
            },
            skillHrid: SKILL_HRID,
            targetLevel: 3,
            priceTable: priceTable({
                "/items/consumed_charm": { ask: -1, bid: 0, vendor: 0 },
            }),
            data,
        });

        expect(result.status).toBe("ok");
        expect(result.segments).toHaveLength(2);
        expect(result.segments[0].equipment).toEqual([]);
        expect(result.segments[1].equipment).toEqual([]);
        expect(result.endingInventory["/items/consumed_charm"]).toBeUndefined();
    });

    it("plans one real level for all six indexed skilling skills", () => {
        const supportedSkills = skillingData.skillHrids;
        const profile = {
            skills: Object.fromEntries([
                ...supportedSkills.map((skillHrid) => [skillHrid, { level: 1, experience: 0 }]),
                ["/skills/total_level", { level: supportedSkills.length, experience: null }],
            ]),
            inventory: {},
            equipment: [],
            buffsBySource: {},
        };
        const realPriceTable = Object.fromEntries(Object.values(itemDetailIndex).map((item) => [item.hrid, {
            ask: Math.max(100, Number(item.sellPrice || 0)),
            bid: 80,
            vendor: Math.max(0, Number(item.sellPrice || 0)),
        }]));
        const result = planSkillingUpgrades({
            profile,
            targetLevels: Object.fromEntries(supportedSkills.map((skillHrid) => [skillHrid, 2])),
            priceTable: realPriceTable,
            now: 1234,
        });

        expect(Object.keys(result.plansBySkill)).toEqual(supportedSkills);
        expect(result.skillHrids).toEqual(supportedSkills);
        expect(result.overview).toHaveLength(6);
        expect(Object.values(result.plansBySkill).every((plan) => plan.status === "ok")).toBe(true);
        const foragingSegment = result.plansBySkill["/skills/foraging"].segments[0];
        const foragingAction = skillingData.actions.find((actionEntry) => actionEntry.hrid === foragingSegment.actionHrid);
        expect(foragingAction.dropTable.some((drop) => (
            foragingSegment.outputItems.some((output) => output.itemHrid === drop.itemHrid && output.count > 0)
        ))).toBe(true);
    });

    it("filters requested skills in indexed order and rejects an empty valid selection", () => {
        const supportedSkills = skillingData.skillHrids;
        const profile = {
            skills: Object.fromEntries([
                ...supportedSkills.map((skillHrid) => [skillHrid, { level: 1, experience: 0 }]),
                ["/skills/total_level", { level: supportedSkills.length, experience: null }],
            ]),
            inventory: {},
            equipment: [],
            buffsBySource: {},
        };
        const selectedSkillHrids = [
            supportedSkills[5],
            "/skills/not_supported",
            supportedSkills[1],
            supportedSkills[5],
        ];
        const result = planSkillingUpgrades({
            profile,
            targetLevels: Object.fromEntries(supportedSkills.map((skillHrid) => [skillHrid, 1])),
            priceTable: {},
            skillHrids: selectedSkillHrids,
        });

        expect(result.skillHrids).toEqual([supportedSkills[1], supportedSkills[5]]);
        expect(Object.keys(result.plansBySkill)).toEqual(result.skillHrids);
        expect(() => planSkillingUpgrades({
            profile,
            targetLevels: {},
            priceTable: {},
            skillHrids: ["/skills/not_supported"],
        })).toThrow("No valid skilling skills were selected.");
    });

    it("finishes scoped progress when the selected skill needs no work", () => {
        const skillHrid = skillingData.skillHrids[0];
        const progressEvents = [];
        const result = planSkillingUpgrades({
            profile: {
                skills: {
                    [skillHrid]: { level: 1, experience: 0 },
                    "/skills/total_level": { level: 1, experience: null },
                },
                inventory: {},
                equipment: [],
                buffsBySource: {},
            },
            targetLevels: { [skillHrid]: 1 },
            priceTable: {},
            skillHrids: [skillHrid],
            onProgress: (progress) => progressEvents.push(progress),
        });

        expect(result.plansBySkill[skillHrid].status).toBe("complete");
        expect(progressEvents.at(-1)).toMatchObject({
            skillHrid,
            skillIndex: 0,
            skillCount: 1,
            overallProgress: 1,
        });
    });

    it("plans a real high-level tailoring level with one whole-level recipe", () => {
        const tailoringHrid = "/skills/tailoring";
        const realPriceTable = Object.fromEntries(Object.values(itemDetailIndex).map((item) => [item.hrid, {
            ask: Math.max(100, Number(item.sellPrice || 0)),
            bid: 80,
            vendor: Math.max(0, Number(item.sellPrice || 0)),
        }]));
        const profile = {
            skills: {
                [tailoringHrid]: { level: 94, experience: levelExperienceTable[94] },
                "/skills/total_level": { level: 94 },
            },
            inventory: {},
            equipment: [],
            buffsBySource: {},
        };
        const result = planSkillingSkill({
            profile,
            skillHrid: tailoringHrid,
            targetLevel: 95,
            priceTable: realPriceTable,
        });
        const balancedResult = planSkillingSkill({
            profile,
            skillHrid: tailoringHrid,
            targetLevel: 95,
            priceTable: realPriceTable,
            optimizationMode: SKILLING_OPTIMIZATION_MODE_BALANCED,
        });

        expect(result.status).toBe("ok");
        expect(result.segments).toHaveLength(1);
        expect(new Set(result.segments.map((segment) => segment.actionHrid)).size).toBe(1);
        expect(result.alternatives.length).toBeGreaterThan(1);
        expect(result.alternatives.every((candidate) => (
            candidate.fullLevelCandidate === true
            && candidate.completionCount === candidate.requiredCompletionCount
        ))).toBe(true);
        expect(balancedResult.status).toBe("ok");
        expect(balancedResult.segments).toHaveLength(1);
        expect(balancedResult.costPerExperience).toBeLessThanOrEqual(
            result.costPerExperience + Math.abs(result.costPerExperience) * SKILLING_BALANCED_COST_TOLERANCE + 1e-9,
        );
    });

    it("reuses real drink duration across a multi-level production plan", () => {
        const profile = {
            skills: Object.fromEntries([
                ...skillingData.skillHrids.map((skillHrid) => [skillHrid, { level: 1, experience: 0 }]),
                ["/skills/total_level", { level: skillingData.skillHrids.length, experience: null }],
            ]),
            inventory: {},
            equipment: [],
            buffsBySource: {},
        };
        const zeroPriceTable = Object.fromEntries(Object.values(itemDetailIndex).map((item) => [item.hrid, {
            ask: 0,
            bid: 0,
            vendor: 0,
        }]));
        const result = planSkillingSkill({
            profile,
            skillHrid: SKILL_HRID,
            targetLevel: 10,
            priceTable: zeroPriceTable,
        });
        const ultraTeaCount = result.segments
            .flatMap((segment) => segment.drinks || [])
            .filter((drink) => drink.itemHrid === "/items/ultra_brewing_tea")
            .reduce((sum, drink) => sum + drink.count, 0);

        expect(result.status).toBe("ok");
        expect(result.totalDurationHours * 3600).toBeGreaterThan(300);
        expect(result.totalDurationHours * 3600).toBeLessThanOrEqual(600);
        expect(ultraTeaCount).toBe(2);
    });

    it("ranks only actionable plans with earned experience", () => {
        const overview = buildSkillingOverview({
            complete: { status: "complete", skillHrid: "/skills/complete", totalExperience: 0, costPerExperience: 0 },
            blocked: { status: "blocked", skillHrid: "/skills/blocked" },
            normal: { status: "ok", skillHrid: "/skills/normal", totalExperience: 100, costPerExperience: 5, experiencePerHour: 10 },
            profitable: { status: "ok", skillHrid: "/skills/profitable", totalExperience: 100, costPerExperience: -1, experiencePerHour: 5 },
        });

        expect(overview.map((plan) => plan.skillHrid)).toEqual([
            "/skills/profitable",
            "/skills/normal",
        ]);
    });

    it("ranks speed overviews by duration, throughput, cost, and skill HRID", () => {
        const plans = {
            slow: { status: "ok", skillHrid: "/skills/slow", totalExperience: 100, totalDurationHours: 2, experiencePerHour: 1_000, costPerExperience: -100 },
            lowThroughput: { status: "ok", skillHrid: "/skills/low_throughput", totalExperience: 100, totalDurationHours: 1, experiencePerHour: 50, costPerExperience: -100 },
            expensive: { status: "ok", skillHrid: "/skills/expensive", totalExperience: 100, totalDurationHours: 1, experiencePerHour: 100, costPerExperience: 5 },
            tieB: { status: "ok", skillHrid: "/skills/tie_b", totalExperience: 100, totalDurationHours: 1, experiencePerHour: 100, costPerExperience: 1 },
            tieA: { status: "ok", skillHrid: "/skills/tie_a", totalExperience: 100, totalDurationHours: 1, experiencePerHour: 100, costPerExperience: 1 },
        };

        expect(buildSkillingOverview(plans, SKILLING_OPTIMIZATION_MODE_SPEED)
            .map((plan) => plan.skillHrid)).toEqual([
            "/skills/tie_a",
            "/skills/tie_b",
            "/skills/expensive",
            "/skills/low_throughput",
            "/skills/slow",
        ]);
    });

    it("ranks balanced overviews by cost and then duration without a cross-skill tolerance", () => {
        const plans = {
            cheapestSlow: {
                status: "ok",
                skillHrid: "/skills/cheapest_slow",
                totalExperience: 100,
                totalDurationHours: 10,
                costPerExperience: 1,
            },
            cheapestFast: {
                status: "ok",
                skillHrid: "/skills/cheapest_fast",
                totalExperience: 100,
                totalDurationHours: 5,
                costPerExperience: 1,
            },
            slightlyHigherFastest: {
                status: "ok",
                skillHrid: "/skills/slightly_higher_fastest",
                totalExperience: 100,
                totalDurationHours: 1,
                costPerExperience: 1.05,
            },
            expensiveInstant: {
                status: "ok",
                skillHrid: "/skills/expensive_instant",
                totalExperience: 100,
                totalDurationHours: 0.1,
                costPerExperience: 100,
            },
        };

        expect(buildSkillingOverview(plans, SKILLING_OPTIMIZATION_MODE_BALANCED)
            .map((plan) => plan.skillHrid)).toEqual([
            "/skills/cheapest_fast",
            "/skills/cheapest_slow",
            "/skills/slightly_higher_fastest",
            "/skills/expensive_instant",
        ]);
    });
});

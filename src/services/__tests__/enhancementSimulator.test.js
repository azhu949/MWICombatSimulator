import { describe, expect, it } from "vitest";
import {
    analyzeEnhancementRisk,
    analyzeEnhancementStrategies,
    analyzeEnhancementStrategy,
    buildEnhancementTransitionModel,
    calculateDecompositionValue,
    calculateRewardMoments,
    calculateStrategyCostMoments,
    createMonteCarloTrialAccumulator,
    createSeededRandom,
    estimateEnhancementAcquisitionValue,
    fitGammaRisk,
    normalizeEnhancementConfig,
    planPhilosophersMirror,
    resolveEnhancedStat,
    resolveEnhancementBonuses,
    resolveEnhancementPrice,
    resolveProtectionCandidates,
    runEnhancementTrial,
    runMonteCarloTrials,
    summarizeMonteCarloTrials,
} from "../enhancementSimulator.js";

const enhancementData = {
    successRates: [
        0.5, 0.45, 0.45, 0.4, 0.4, 0.4, 0.35, 0.35, 0.35, 0.35,
        0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3,
    ],
    totalBonusMultipliers: [0, 1, 2.1, 3.3, 4.6, 6, 7.5, 9.1, 10.8, 12.6, 14.5, 16.7, 19.2, 22, 25.1, 28.5, 32.2, 36.2, 40.5, 45.1, 50],
    actionBaseSeconds: 12,
    enhanceableItems: [{
        hrid: "/items/test_sword",
        name: "Test Sword",
        itemLevel: 10,
        enhancementCosts: [
            { itemHrid: "/items/dust", count: 2 },
            { itemHrid: "/items/coin", count: 3 },
        ],
        protectionItemHrids: ["/items/test_protector"],
    }],
    supportEquipment: [{
        hrid: "/items/test_enhancer",
        stats: {
            enhancingSuccess: 0.01,
            enhancingSpeed: 0.02,
            enhancingExperience: 0.03,
            drinkConcentration: 0.1,
        },
        enhancementBonuses: {
            enhancingSuccess: 0.001,
            enhancingSpeed: 0.002,
            enhancingExperience: 0.003,
            drinkConcentration: 0.01,
        },
    }],
    drinks: [
        {
            hrid: "/items/enhancing_tea",
            durationSeconds: 300,
            buffs: [
                { typeHrid: "/buff_types/enhancing_level", flatBoost: 3 },
                { typeHrid: "/buff_types/action_speed", flatBoost: 0.02 },
            ],
        },
        {
            hrid: "/items/blessed_tea",
            durationSeconds: 300,
            buffs: [{ typeHrid: "/buff_types/blessed", flatBoost: 0.01 }],
        },
        {
            hrid: "/items/wisdom_tea",
            durationSeconds: 300,
            buffs: [{ typeHrid: "/buff_types/wisdom", flatBoost: 0.12 }],
        },
    ],
    house: {
        observatory: {
            actionBuffs: [
                {
                    typeHrid: "/buff_types/enhancing_success",
                    ratioBoost: 0.0005,
                    ratioBoostLevelBonus: 0.0005,
                },
                {
                    typeHrid: "/buff_types/action_speed",
                    flatBoost: 0.01,
                    flatBoostLevelBonus: 0.01,
                },
            ],
            globalBuffs: [{
                typeHrid: "/buff_types/wisdom",
                flatBoost: 0.0005,
                flatBoostLevelBonus: 0.0005,
            }],
        },
        globalExperienceByRoom: [{
            hrid: "/house_rooms/forge",
            globalBuffs: [{
                typeHrid: "/buff_types/wisdom",
                flatBoost: 0.0005,
                flatBoostLevelBonus: 0.0005,
            }],
        }],
    },
    communityBuffs: [
        {
            hrid: "/community_buff_types/enhancing_speed",
            buff: { typeHrid: "/buff_types/action_speed", flatBoost: 0.2, flatBoostLevelBonus: 0.005 },
        },
        {
            hrid: "/community_buff_types/experience",
            buff: { typeHrid: "/buff_types/wisdom", flatBoost: 0.2, flatBoostLevelBonus: 0.005 },
        },
    ],
    achievementBuffs: [
        {
            hrid: "/achievement_tiers/novice",
            buff: { typeHrid: "/buff_types/wisdom", flatBoost: 0.02 },
        },
        {
            hrid: "/achievement_tiers/champion",
            buff: { typeHrid: "/buff_types/enhancing_success", ratioBoost: 0.002 },
        },
    ],
};

const pricing = {
    priceTable: {
        "/items/test_sword": { ask: 1000, bid: 900, vendor: 50 },
        "/items/dust": { ask: 10, bid: 8, vendor: 2 },
        "/items/coin": { ask: 1, bid: 1, vendor: 1 },
        "/items/mirror_of_protection": { ask: 120, bid: 100, vendor: 50 },
        "/items/test_protector": { ask: 100, bid: 80, vendor: 40 },
        "/items/enhancing_tea": { ask: 30, bid: 25, vendor: 20 },
        "/items/blessed_tea": { ask: 40, bid: 35, vendor: 20 },
        "/items/wisdom_tea": { ask: 50, bid: 45, vendor: 20 },
        "/items/enhancing_essence": { ask: 8, bid: 5, vendor: 1 },
    },
    enhancementQuotesByItem: {
        "/items/test_sword": {
            "2": { ask: 1500, bid: 1400 },
        },
    },
};

const nonTradableCloakHrid = "/items/non_tradable_cloak";
const acquisitionEnhancementData = {
    ...enhancementData,
    enhanceableItems: [
        ...enhancementData.enhanceableItems,
        {
            hrid: nonTradableCloakHrid,
            name: "Non-tradable Cloak",
            itemLevel: 80,
            sellPrice: 100_000,
            isTradable: false,
            enhancementCosts: [
                { itemHrid: "/items/dust", count: 2 },
                { itemHrid: "/items/coin", count: 3 },
            ],
            protectionItemHrids: [],
        },
    ],
    protectionItems: [{
        hrid: "/items/mirror_of_protection",
        name: "Mirror of Protection",
        isTradable: true,
        sellPrice: 50,
    }],
    acquisition: {
        openablesByHrid: {
            "/items/test_chest": {
                hrid: "/items/test_chest",
                openKeyItemHrid: "/items/test_chest_key",
                drops: [
                    { itemHrid: nonTradableCloakHrid, dropRate: 0.04, minCount: 1, maxCount: 1 },
                    { itemHrid: "/items/other_loot", dropRate: 1, minCount: 1, maxCount: 1 },
                    { itemHrid: "/items/test_chest_key", dropRate: 0.02, minCount: 1, maxCount: 1 },
                ],
            },
        },
        sourcesByItemHrid: {
            [nonTradableCloakHrid]: [{
                type: "dungeon_openable",
                itemHrid: nonTradableCloakHrid,
                actionHrid: "/actions/combat/test_dungeon",
                difficultyTier: 0,
                entryKeyItemHrid: "/items/test_entry_key",
                containerHrid: "/items/test_chest",
                containerDropRate: 1,
                containerMinCount: 1,
                containerMaxCount: 1,
                itemDrops: [{ itemHrid: nonTradableCloakHrid, dropRate: 0.04, minCount: 1, maxCount: 1 }],
            }],
        },
    },
};

const acquisitionPricing = {
    priceTable: {
        ...pricing.priceTable,
        [nonTradableCloakHrid]: { ask: -1, bid: -1, vendor: 100_000 },
        "/items/test_entry_key": { ask: 960_000, bid: 940_000, vendor: 50_000 },
        "/items/test_chest_key": { ask: 4_300_000, bid: 4_200_000, vendor: 500_000 },
        "/items/other_loot": { ask: 9_000_000, bid: 3_909_650, vendor: 10 },
        "/items/mirror_of_protection": { ask: 10_000_000, bid: 9_800_000, vendor: 200_000 },
    },
};

function baseConfig(overrides = {}) {
    return {
        itemHrid: "/items/test_sword",
        skillLevel: 10,
        startLevel: 0,
        targetLevel: 3,
        ...overrides,
    };
}

describe("enhancementSimulator", () => {
    it("normalizes target/start and live bonus bounds with default sample settings", () => {
        const config = normalizeEnhancementConfig({
            startLevel: 20,
            targetLevel: 30,
            skillLevel: 999,
            communityEnhancingLevel: 999,
            communityExperienceLevel: 999,
            markupPercent: 15,
        });
        expect(config.targetLevel).toBe(20);
        expect(config.startLevel).toBe(19);
        expect(config.skillLevel).toBe(200);
        expect(config.communitySpeedLevel).toBe(20);
        expect(config.communityExperienceLevel).toBe(20);
        expect(config.markupRate).toBe(0.15);
        expect(config.sampleCount).toBe(32768);
        expect(normalizeEnhancementConfig({ skillLevel: 0 }).skillLevel).toBe(1);
    });

    it("accepts the enhancement page/store configuration aliases", () => {
        const config = normalizeEnhancementConfig({
            equipmentSlots: {
                tool: { itemHrid: "/items/test_enhancer", enhancementLevel: 4 },
                empty: { itemHrid: "", enhancementLevel: 0 },
            },
            communityEnhancingLevel: 3,
            communityExperienceLevel: 0,
            blessedTea: true,
            wisdomTea: true,
            laborRatePerHour: 7200,
        });
        expect(config.equipment).toEqual([{ itemHrid: "/items/test_enhancer", enhancementLevel: 4 }]);
        expect(config.communitySpeedEnabled).toBe(true);
        expect(config.communitySpeedLevel).toBe(3);
        expect(config.communityExperienceEnabled).toBe(false);
        expect(config.blessedEnabled).toBe(true);
        expect(config.wisdomEnabled).toBe(true);
        expect(config.hourlyRate).toBe(7200);
    });

    it("resolves data-driven equipment and buff bonuses", () => {
        expect(resolveEnhancedStat(enhancementData.supportEquipment[0], "enhancingSuccess", 2, enhancementData.totalBonusMultipliers))
            .toBeCloseTo(0.0121, 10);

        const bonuses = resolveEnhancementBonuses(baseConfig({
            equipment: [{ itemHrid: "/items/test_enhancer", enhancementLevel: 2 }],
            enhancingTeaHrid: "/items/enhancing_tea",
            blessedEnabled: true,
            wisdomEnabled: true,
            observatoryLevel: 2,
            otherRoomLevelsTotal: 10,
            communitySpeedEnabled: true,
            communitySpeedLevel: 2,
            communityExperienceEnabled: true,
            communityExperienceLevel: 2,
            noviceAchievement: true,
            championAchievement: true,
        }), enhancementData);

        expect(bonuses.drinkConcentrationMultiplier).toBeCloseTo(1.121, 10);
        expect(bonuses.effectiveSkillLevel).toBeCloseTo(13.363, 10);
        expect(bonuses.successRatioComponents.observatory).toBe(0.001);
        expect(bonuses.successRatioComponents.champion).toBe(0.002);
        expect(bonuses.blessedChance).toBeCloseTo(0.01121, 10);
        expect(bonuses.wisdomComponents.house).toBeCloseTo(0.006, 10);
        expect(bonuses.actionSeconds).toBeLessThan(12);
    });

    it("applies the low-skill penalty and clamps final success chances", () => {
        const lowSkill = resolveEnhancementBonuses(baseConfig({ skillLevel: 1 }), enhancementData);
        expect(lowSkill.successRatioComponents.skill).toBeCloseTo(-0.45, 10);
        const lowSkillModel = buildEnhancementTransitionModel(baseConfig({ skillLevel: 1 }), enhancementData);
        expect(lowSkillModel.successChances[0]).toBeCloseTo(0.275, 10);

        const cappedData = {
            ...enhancementData,
            successRates: Array(20).fill(1),
            supportEquipment: [{
                hrid: "/items/overpowered_enhancer",
                stats: { enhancingSuccess: 10 },
            }],
        };
        const cappedModel = buildEnhancementTransitionModel(baseConfig({
            equipment: [{ itemHrid: "/items/overpowered_enhancer" }],
        }), cappedData);
        expect(cappedModel.successChances.every((chance) => chance === 1)).toBe(true);
    });

    it("matches the +1, +3 unprotected, and protect-at-2 golden expectations", () => {
        const plusOne = analyzeEnhancementStrategy(baseConfig({ targetLevel: 1 }), enhancementData, pricing);
        const unprotected = analyzeEnhancementStrategy(baseConfig({ protectAt: null }), enhancementData, pricing);
        const protectedAtTwo = analyzeEnhancementStrategy(baseConfig({ protectAt: 2 }), enhancementData, pricing);

        expect(plusOne.expectedActions).toBeCloseTo(2, 10);
        expect(plusOne.expectedResets).toBe(0);
        expect(unprotected.expectedActions).toBeCloseTo(17.037037037, 9);
        expect(unprotected.expectedResets).toBeCloseTo(3.938271605, 9);
        expect(protectedAtTwo.expectedActions).toBeCloseTo(14.592592593, 9);
        expect(protectedAtTwo.expectedProtections).toBeCloseTo(1.222222222, 9);
        expect(protectedAtTwo.expectedResets).toBeCloseTo(2.716049383, 9);
        expect(protectedAtTwo.expectedResets).toBeLessThan(unprotected.expectedResets);
    });

    it("supports arbitrary starts, blessed target overshoot, and +20", () => {
        const fromTwo = analyzeEnhancementStrategy(baseConfig({ startLevel: 2, protectAt: 2 }), enhancementData, pricing);
        expect(fromTwo.expectedActions).toBeLessThan(14.592592593);
        expect(fromTwo.startingItem.price).toBe(1500);
        expect(fromTwo.startingItem.source).toBe("enhancement_ask");

        const regular = analyzeEnhancementStrategy(baseConfig({ targetLevel: 2 }), enhancementData, pricing);
        const blessed = analyzeEnhancementStrategy(baseConfig({ targetLevel: 2, blessedEnabled: true }), enhancementData, pricing);
        expect(blessed.expectedActions).toBeLessThan(regular.expectedActions);
        expect(blessed.model.outcomes[1].some((outcome) => outcome.type === "blessed" && outcome.absorbed)).toBe(true);

        const plusTwenty = analyzeEnhancementStrategy(baseConfig({ targetLevel: 20, protectAt: 2 }), enhancementData, pricing);
        expect(plusTwenty.expectedActions).toBeGreaterThan(0);
        expect(Number.isFinite(plusTwenty.expectedActions)).toBe(true);
    });

    it("marks an enhanced starting item missing without a same-level quote", () => {
        const result = analyzeEnhancementStrategy(baseConfig({ startLevel: 1 }), enhancementData, pricing);
        expect(result.startingItem.available).toBe(false);
        expect(result.totalInvestment).toBeNull();
        expect(result.incrementalCost).toBeGreaterThan(0);
    });

    it("accepts compact ask/bid aliases in price overrides", () => {
        const result = analyzeEnhancementStrategy(baseConfig({
            priceOverrides: {
                "/items/dust": { a: 99, b: 88 },
            },
        }), enhancementData, pricing);
        expect(result.materialPriceDetails.find((entry) => entry.itemHrid === "/items/dust"))
            .toMatchObject({ unitPrice: 99, priceSource: "override" });
    });

    it("keeps side-specific overrides isolated until the requested market side is missing", () => {
        const overrides = { "/items/dust": { bid: 7 } };
        expect(resolveEnhancementPrice(pricing, "/items/dust", {
            mode: "ask",
            overrides,
        })).toMatchObject({ price: 10, source: "ask", priceSide: "ask" });
        expect(resolveEnhancementPrice(pricing, "/items/dust", {
            mode: "bid",
            overrides,
        })).toMatchObject({ price: 7, source: "override", priceSide: "bid" });

        const missingAskPricing = {
            priceTable: {
                "/items/dust": { ask: -1, bid: 8, vendor: 2 },
            },
        };
        expect(resolveEnhancementPrice(missingAskPricing, "/items/dust", {
            mode: "ask",
            overrides,
        })).toMatchObject({ price: 7, source: "override", priceSide: "bid" });
    });

    it("prices selected teas from action time, duration, and drink concentration", () => {
        const result = analyzeEnhancementStrategy(baseConfig({
            targetLevel: 1,
            equipment: [{ itemHrid: "/items/test_enhancer", enhancementLevel: 2 }],
            enhancingTeaHrid: "/items/enhancing_tea",
            blessedEnabled: true,
            wisdomEnabled: true,
        }), enhancementData, pricing);
        const concentration = result.model.bonuses.drinkConcentrationMultiplier;
        const expectedCountPerAction = result.model.bonuses.actionSeconds * concentration / 300;
        const expectedConsumableCostPerAction = expectedCountPerAction * (30 + 40 + 50);

        for (const itemHrid of [
            "/items/enhancing_tea",
            "/items/blessed_tea",
            "/items/wisdom_tea",
        ]) {
            expect(result.perActionMaterials[itemHrid]).toBeCloseTo(expectedCountPerAction, 12);
            expect(result.expectedMaterialCounts[itemHrid]).toBeCloseTo(
                result.expectedActions * expectedCountPerAction,
                10,
            );
        }
        expect(result.consumableDetails).toHaveLength(3);
        expect(result.consumableCostPerAction).toBeCloseTo(expectedConsumableCostPerAction, 10);
        expect(result.materialCostPerAction).toBeCloseTo(20 + expectedConsumableCostPerAction, 10);
        expect(calculateStrategyCostMoments(result).mean).toBeCloseTo(result.totalInvestment, 8);

        const trial = runEnhancementTrial(result, () => 0, { maxTransitions: 10 });
        expect(trial.materialCost).toBeCloseTo(result.materialCostPerAction, 10);
    });

    it("estimates a non-tradable dungeon chest item from acquisition asks and other-loot bids", () => {
        const estimate = estimateEnhancementAcquisitionValue(
            nonTradableCloakHrid,
            acquisitionEnhancementData,
            acquisitionPricing,
        );

        expect(estimate).toMatchObject({
            source: "acquisition_estimate",
            available: true,
            autoEligible: false,
            expectedContainers: 25,
            expectedAttempts: 25,
            grossCostPerAttempt: 5_260_000,
            otherLootValuePerContainer: 3_993_650,
            netCostPerAttempt: 1_266_350,
            actionHrid: "/actions/combat/test_dungeon",
            containerHrid: "/items/test_chest",
        });
        expect(estimate.price).toBeCloseTo(31_658_750, 6);
        expect(estimate.otherLootDetails).toEqual(expect.arrayContaining([
            expect.objectContaining({
                itemHrid: "/items/other_loot",
                unitPrice: 3_909_650,
                priceSource: "bid",
            }),
            expect.objectContaining({
                itemHrid: "/items/test_chest_key",
                expectedValue: 84_000,
            }),
        ]));
        expect(estimate.otherLootDetails.some((drop) => drop.itemHrid === nonTradableCloakHrid)).toBe(false);
    });

    it("uses vendor liquidation only after a missing bid and requires asks for acquisition inputs", () => {
        const vendorPricing = {
            priceTable: {
                ...acquisitionPricing.priceTable,
                "/items/other_loot": { ask: 99_000_000, bid: -1, vendor: 1_000_000 },
            },
        };
        const vendorEstimate = estimateEnhancementAcquisitionValue(
            nonTradableCloakHrid,
            acquisitionEnhancementData,
            vendorPricing,
        );
        expect(vendorEstimate.otherLootDetails.find((drop) => drop.itemHrid === "/items/other_loot"))
            .toMatchObject({ unitPrice: 1_000_000, priceSource: "vendor" });

        const missingAskPricing = {
            priceTable: {
                ...acquisitionPricing.priceTable,
                "/items/test_entry_key": { ask: -1, bid: 940_000, vendor: 50_000 },
            },
        };
        expect(estimateEnhancementAcquisitionValue(
            nonTradableCloakHrid,
            acquisitionEnhancementData,
            missingAskPricing,
        )).toMatchObject({
            available: false,
            source: "acquisition_missing",
            missingInputHrids: ["/items/test_entry_key"],
        });
    });

    it("clamps acquisition estimates to vendor value and chooses the cheapest complete route", () => {
        const highLootPricing = {
            priceTable: {
                ...acquisitionPricing.priceTable,
                "/items/other_loot": { ask: 20_000_000, bid: 20_000_000, vendor: 10 },
            },
        };
        expect(estimateEnhancementAcquisitionValue(
            nonTradableCloakHrid,
            acquisitionEnhancementData,
            highLootPricing,
        )).toMatchObject({ price: 100_000, vendorFloor: 100_000 });

        const pricingWithAlternative = {
            priceTable: {
                ...acquisitionPricing.priceTable,
                "/items/cheap_entry_key": { ask: 10_000, bid: 9_000, vendor: 1 },
                "/items/cheap_chest_key": { ask: 10_000, bid: 9_000, vendor: 1 },
            },
        };
        const dataWithAlternative = {
            ...acquisitionEnhancementData,
            acquisition: {
                openablesByHrid: {
                    ...acquisitionEnhancementData.acquisition.openablesByHrid,
                    "/items/cheap_chest": {
                        hrid: "/items/cheap_chest",
                        openKeyItemHrid: "/items/cheap_chest_key",
                        drops: [{ itemHrid: nonTradableCloakHrid, dropRate: 0.04, minCount: 1, maxCount: 1 }],
                    },
                },
                sourcesByItemHrid: {
                    [nonTradableCloakHrid]: [
                        ...acquisitionEnhancementData.acquisition.sourcesByItemHrid[nonTradableCloakHrid],
                        {
                            type: "dungeon_openable",
                            itemHrid: nonTradableCloakHrid,
                            actionHrid: "/actions/combat/cheap_dungeon",
                            entryKeyItemHrid: "/items/cheap_entry_key",
                            containerHrid: "/items/cheap_chest",
                            containerDropRate: 1,
                            containerMinCount: 1,
                            containerMaxCount: 1,
                            itemDrops: [{ itemHrid: nonTradableCloakHrid, dropRate: 0.04, minCount: 1, maxCount: 1 }],
                        },
                    ],
                },
            },
        };
        const estimate = estimateEnhancementAcquisitionValue(
            nonTradableCloakHrid,
            dataWithAlternative,
            pricingWithAlternative,
        );
        expect(estimate).toMatchObject({
            price: 500_000,
            vendorFloor: 100_000,
            actionHrid: "/actions/combat/cheap_dungeon",
        });
        expect(estimate.alternatives).toHaveLength(2);
    });

    it("keeps acquisition estimates out of auto protection but uses them when explicitly selected", () => {
        const cheapEstimatePricing = {
            priceTable: {
                ...acquisitionPricing.priceTable,
                "/items/other_loot": { ask: 20_000_000, bid: 20_000_000, vendor: 10 },
            },
        };
        const candidates = resolveProtectionCandidates({
            itemHrid: nonTradableCloakHrid,
            targetLevel: 3,
        }, acquisitionEnhancementData, cheapEstimatePricing);
        expect(candidates.find((candidate) => candidate.itemHrid === nonTradableCloakHrid)).toMatchObject({
            price: 100_000,
            source: "acquisition_estimate",
            available: true,
            autoEligible: false,
        });

        const automatic = analyzeEnhancementStrategy({
            itemHrid: nonTradableCloakHrid,
            skillLevel: 10,
            targetLevel: 3,
            protectAt: 2,
        }, acquisitionEnhancementData, cheapEstimatePricing);
        expect(automatic.protectionItem).toMatchObject({
            itemHrid: "/items/mirror_of_protection",
            source: "ask",
            autoEligible: true,
        });
        expect(automatic.startingItem).toMatchObject({
            price: 100_000,
            source: "acquisition_estimate",
        });

        const manual = analyzeEnhancementStrategy({
            itemHrid: nonTradableCloakHrid,
            skillLevel: 10,
            targetLevel: 3,
            protectAt: 2,
            protectionItemHrid: nonTradableCloakHrid,
        }, acquisitionEnhancementData, cheapEstimatePricing);
        expect(manual.protectionItem).toMatchObject({
            itemHrid: nonTradableCloakHrid,
            price: 100_000,
            source: "acquisition_estimate",
        });
        expect(manual.protectionCost).toBe(100_000);

        const overridden = analyzeEnhancementStrategy({
            itemHrid: nonTradableCloakHrid,
            skillLevel: 10,
            targetLevel: 3,
            protectAt: 2,
            priceOverrides: { [nonTradableCloakHrid]: 5_000_000 },
        }, acquisitionEnhancementData, cheapEstimatePricing);
        expect(overridden.protectionItem).toMatchObject({
            itemHrid: nonTradableCloakHrid,
            price: 5_000_000,
            source: "override",
            autoEligible: true,
        });
    });

    it("rejects a configured protection item outside the current item's candidates", () => {
        const invalidProtectionHrid = "/items/unrelated_protector";
        const result = analyzeEnhancementStrategy(baseConfig({
            protectAt: 2,
            protectionItemHrid: invalidProtectionHrid,
        }), enhancementData, {
            ...pricing,
            priceTable: {
                ...pricing.priceTable,
                [invalidProtectionHrid]: { ask: 1, bid: 1, vendor: 1 },
            },
        });

        expect(result.protectionItem).toMatchObject({
            itemHrid: invalidProtectionHrid,
            source: "invalid_protection",
            available: false,
        });
        expect(result.protectionCost).toBeNull();
        expect(result.incrementalCost).toBeNull();
    });

    it("leaves protection costs missing instead of treating unavailable protection as free", () => {
        const unavailablePricing = {
            priceTable: {
                ...acquisitionPricing.priceTable,
                "/items/mirror_of_protection": { ask: -1, bid: 9_800_000, vendor: 200_000 },
                "/items/test_entry_key": { ask: -1, bid: 940_000, vendor: 50_000 },
            },
        };
        const result = analyzeEnhancementStrategies({
            itemHrid: nonTradableCloakHrid,
            skillLevel: 10,
            targetLevel: 3,
        }, acquisitionEnhancementData, unavailablePricing);
        const protectedStrategy = result.strategies.find((strategy) => strategy.protectAt === 2);

        expect(protectedStrategy).toMatchObject({
            protectionCost: null,
            rawIncrementalCost: null,
            incrementalCost: null,
            totalInvestment: null,
            incrementalCostAvailable: false,
        });
        expect(protectedStrategy.expectedActions).toBeGreaterThan(0);
        expect(protectedStrategy.expectedProtections).toBeGreaterThan(0);
        expect(result.recommendedStrategy.protectAt).toBeNull();
        expect(() => calculateStrategyCostMoments(protectedStrategy)).toThrow(/priced protection item/i);
    });

    it("does not estimate an enhanced non-tradable starting item without a direct quote", () => {
        const result = analyzeEnhancementStrategy({
            itemHrid: nonTradableCloakHrid,
            skillLevel: 10,
            startLevel: 1,
            targetLevel: 3,
        }, acquisitionEnhancementData, acquisitionPricing);
        expect(result.startingItem).toMatchObject({ available: false, source: "missing", level: 1 });
        expect(result.totalInvestment).toBeNull();
        expect(() => calculateStrategyCostMoments(result)).toThrow(/starting enhancement level/i);
        expect(() => analyzeEnhancementRisk(result, { sampleCount: 8 })).toThrow(/starting enhancement level/i);
    });

    it("marks strategies unavailable when a required enhancement material has no price", () => {
        const missingMaterialPricing = {
            ...pricing,
            priceTable: {
                ...pricing.priceTable,
                "/items/dust": { ask: -1, bid: -1, vendor: -1 },
            },
        };
        const result = analyzeEnhancementStrategy(baseConfig(), enhancementData, missingMaterialPricing);

        expect(result).toMatchObject({
            materialPricesAvailable: false,
            missingMaterialHrids: ["/items/dust"],
            rawIncrementalCost: null,
            incrementalCost: null,
            totalInvestment: null,
        });
        expect(result.expectedActions).toBeGreaterThan(0);
        expect(() => calculateStrategyCostMoments(result)).toThrow(/enhancement material/i);
        expect(() => runEnhancementTrial(result, createSeededRandom(1))).toThrow(/enhancement material/i);
    });

    it("keeps incremental and total cost identities consistent", () => {
        const result = analyzeEnhancementStrategy(baseConfig({
            protectAt: 2,
            hourlyRate: 3600,
            markupRate: 0.1,
        }), enhancementData, pricing);
        const expectedRaw = result.expectedActions * (23 + 12) + result.expectedProtections * 100;
        expect(result.rawIncrementalCost).toBeCloseTo(expectedRaw, 8);
        expect(result.incrementalCost).toBeCloseTo(expectedRaw * 1.1, 8);
        expect(result.totalInvestment).toBeCloseTo((1000 + expectedRaw) * 1.1, 8);
        expect(result.expectedMaterialCounts["/items/dust"]).toBeCloseTo(result.expectedActions * 2, 8);
        expect(result.expectedMaterialCounts["/items/coin"]).toBeCloseTo(result.expectedActions * 3, 8);
    });

    it("compares no-protection and each useful protection threshold", () => {
        const result = analyzeEnhancementStrategies(baseConfig({ targetLevel: 5 }), enhancementData, pricing);
        expect(result.strategies.map((strategy) => strategy.protectAt)).toEqual([null, 2, 3, 4]);
        expect(result.protectionCandidates[0].itemHrid).toBe("/items/test_protector");
        expect(result.recommendedStrategy).not.toBeNull();
    });

    it("computes exact reward moments and a bounded Gamma risk approximation", () => {
        const strategy = analyzeEnhancementStrategy(baseConfig({ protectAt: 2 }), enhancementData, pricing);
        const actionMoments = calculateRewardMoments(strategy.model, { perAction: 1 });
        expect(actionMoments.mean).toBeCloseTo(strategy.expectedActions, 9);
        expect(actionMoments.variance).toBeGreaterThan(0);

        const costMoments = calculateStrategyCostMoments(strategy);
        expect(costMoments.mean).toBeCloseTo(strategy.totalInvestment, 8);
        const risk = fitGammaRisk(costMoments, { budget: costMoments.mean, offset: 1000 });
        expect(risk.method).toBe("moment_gamma");
        expect(risk.quantiles["25"]).toBeLessThan(risk.quantiles["99"]);
        expect(risk.budgetProbability).toBeGreaterThan(0);
        expect(risk.budgetProbability).toBeLessThan(1);
    });

    it("uses a seeded/injected RNG for reproducible coherent trials", () => {
        const strategy = analyzeEnhancementStrategy(baseConfig({ protectAt: 2 }), enhancementData, pricing);
        const first = runMonteCarloTrials(strategy, { sampleCount: 200, seed: "same", budget: 2000 });
        const second = runMonteCarloTrials(strategy, { sampleCount: 200, seed: "same", budget: 2000 });
        expect(first.trials).toEqual(second.trials);
        expect(first.quantiles["50"]).toEqual(first.trials.slice().sort((a, b) => a.totalCost - b.totalCost)[99]);
        expect(first.budgetProbability).toBeGreaterThanOrEqual(0);
        expect(first.budgetProbability).toBeLessThanOrEqual(1);

        const rng = createSeededRandom(7);
        const oneTrial = runEnhancementTrial(strategy, rng, { maxTransitions: 10000 });
        expect(oneTrial.exceeded).toBe(false);
        expect(oneTrial.finalLevel).toBe(3);
    });

    it("keeps the seeded Monte Carlo mean close to the exact Markov expectation", () => {
        const strategy = analyzeEnhancementStrategy(baseConfig({ protectAt: 2 }), enhancementData, pricing);
        const simulation = runMonteCarloTrials(strategy, {
            sampleCount: 8192,
            seed: "mean-tolerance",
            includeTrials: false,
        });
        const relativeError = Math.abs(simulation.mean - strategy.totalInvestment) / strategy.totalInvestment;
        expect(relativeError).toBeLessThan(0.03);
    });

    it("keeps exact Monte Carlo results while using compact storage when trials are omitted", () => {
        const strategy = analyzeEnhancementStrategy(baseConfig({ protectAt: 2 }), enhancementData, pricing);
        const options = {
            sampleCount: 1024,
            seed: "compact-parity",
            budget: 2000,
        };
        const full = runMonteCarloTrials(strategy, options);
        const compact = runMonteCarloTrials(strategy, { ...options, includeTrials: false });
        const { trials, ...fullSummary } = full;

        expect(compact).toEqual({ ...fullSummary, trials: undefined });
        expect(trials).toHaveLength(options.sampleCount);

        const accumulator = createMonteCarloTrialAccumulator(strategy, { sampleCount: 1024 });
        expect(accumulator.capacity).toBe(1024);
        expect(accumulator.storageByteLength).toBe(1024 * 24);
    });

    it("reports transition caps and can summarize independently generated batches", () => {
        const model = buildEnhancementTransitionModel(baseConfig({ targetLevel: 20 }), enhancementData);
        const capped = runEnhancementTrial(model, () => 0.999999, { maxTransitions: 3 });
        expect(capped).toMatchObject({ exceeded: true, transitions: 3 });

        const summary = summarizeMonteCarloTrials([
            { totalCost: 30, actions: 3 },
            { totalCost: 10, actions: 1 },
            { totalCost: 20, actions: 2 },
        ], { percentiles: [50], budget: 20 });
        expect(summary.quantiles["50"]).toMatchObject({ totalCost: 20, actions: 2 });
        expect(summary.budgetProbability).toBeCloseTo(2 / 3, 10);
    });

    it("returns exact budget-probability boundaries for Monte Carlo samples", () => {
        const trials = [
            { totalCost: 10, actions: 1 },
            { totalCost: 20, actions: 2 },
            { totalCost: 30, actions: 3 },
        ];
        expect(summarizeMonteCarloTrials(trials, { budget: 9 }).budgetProbability).toBe(0);
        expect(summarizeMonteCarloTrials(trials, { budget: 30 }).budgetProbability).toBe(1);
    });

    it("switches to moment-Gamma when estimated Monte Carlo work is high", () => {
        const strategy = analyzeEnhancementStrategy(baseConfig({ targetLevel: 20, protectAt: 2 }), enhancementData, pricing);
        const risk = analyzeEnhancementRisk(strategy, { sampleCount: 32768, loadThreshold: 1 });
        expect(risk.method).toBe("moment_gamma");
        expect(risk.fallbackReason).toBe("estimated_load");
        expect(risk.estimatedTransitions).toBeGreaterThan(1);
    });

    it("plans recursive Philosopher's Mirror combinations", () => {
        const result = planPhilosophersMirror({
            targetLevel: 3,
            mirrorPrice: 5,
            directPlans: [10, 20, 100, 200],
        });
        expect(result.levels[2]).toMatchObject({ method: "mirror", cost: 35, mirrorCount: 1 });
        expect(result.target).toMatchObject({ method: "mirror", cost: 60, mirrorCount: 2 });
        expect(result.target.directPlanCounts).toEqual({ "0": 1, "1": 2 });
        expect(result.requirements.find((entry) => entry.type === "mirror")).toMatchObject({ count: 2, totalCost: 10 });
    });

    it("uses the declared base item plan for Philosopher's Mirror inputs", () => {
        const basePlan = planPhilosophersMirror({
            targetLevel: 1,
            itemHrid: "/items/base_sword",
            mirrorPrice: 5,
            directPlans: [3, 7],
        });
        const result = planPhilosophersMirror({
            targetLevel: 2,
            itemHrid: "/items/refined_sword",
            baseItemHrid: "/items/base_sword",
            basePlan,
            mirrorPrice: 10,
            directPlans: [100, 120, 500],
        });

        expect(result.target).toMatchObject({ method: "mirror", cost: 133, mirrorCount: 1 });
        expect(result.requirements).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: "direct",
                itemHrid: "/items/base_sword",
                level: 0,
                count: 1,
            }),
            expect.objectContaining({
                type: "direct",
                itemHrid: "/items/refined_sword",
                level: 1,
                count: 1,
            }),
        ]));
    });

    it("charges labor for each Philosopher's Mirror enhancement action", () => {
        const result = planPhilosophersMirror({
            targetLevel: 2,
            mirrorPrice: 5,
            mirrorActionCost: 7,
            directPlans: [10, 20, 100],
        });

        expect(result.target).toMatchObject({ method: "mirror", cost: 42, mirrorCount: 1 });
        expect(result.requirements.find((entry) => entry.type === "mirror")).toMatchObject({
            count: 1,
            itemUnitCost: 5,
            actionUnitCost: 7,
            unitCost: 12,
            totalCost: 12,
        });
    });

    it("does not treat an unavailable Philosopher's Mirror as free", () => {
        const result = planPhilosophersMirror({
            targetLevel: 2,
            mirrorPrice: Infinity,
            directPlans: [10, 20, 100],
        });
        expect(result.target).toMatchObject({ method: "direct", cost: 100, mirrorCount: 0 });
    });

    it("calculates decomposition value from item level, enhancement, bid, and return rate", () => {
        const result = calculateDecompositionValue({
            itemHrid: "/items/test_sword",
            targetLevel: 3,
        }, enhancementData, pricing);
        const expectedCount = Math.floor(Math.round(2 * (0.5 + 0.1 * (1.05 ** 10)) * (2 ** 3)));
        expect(result.essenceCount).toBe(expectedCount);
        expect(result.essenceBid).toBe(5);
        expect(result.value).toBeCloseTo(expectedCount * 5 * 0.78, 10);
    });

    it("falls back from a missing decomposition bid to vendor instead of ask", () => {
        const result = calculateDecompositionValue({
            itemHrid: "/items/test_sword",
            targetLevel: 3,
        }, enhancementData, {
            priceTable: {
                "/items/enhancing_essence": { ask: 999, bid: -1, vendor: 2 },
            },
        });

        expect(result).toMatchObject({
            essenceBid: 2,
            priceSource: "vendor",
            priceAvailable: true,
        });
        expect(result.grossValue).toBe(result.essenceCount * 2);
    });
});

import { describe, expect, it } from "vitest";
import { itemDetailIndex, levelExperienceTable, skillingData } from "../../shared/gameDataIndex.js";
import {
    buildSkillingOverview,
    buildSkillingEquipmentLoadouts,
    calculateSkillingActionCandidate,
    collectSkillingProfileBonuses,
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
        bonuses: { actionSpeed: 0, efficiency: 0, experience: 0, essenceFind: 0, rareFind: 0 },
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

describe("skillingPlanner", () => {
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

    it("switches to the cheaper no-drink tail after the first drink expires", () => {
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
        expect(result.segments.flatMap((segment) => segment.drinks || []))
            .toEqual([expect.objectContaining({ itemHrid: "/items/wisdom_drink", count: 1 })]);
        expect(result.segments.at(-1).drinks).toEqual([]);
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

    it("plans one real level for all five indexed production skills", () => {
        const productionSkills = skillingData.skillHrids;
        const profile = {
            skills: Object.fromEntries([
                ...productionSkills.map((skillHrid) => [skillHrid, { level: 1, experience: 0 }]),
                ["/skills/total_level", { level: 5, experience: null }],
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
            targetLevels: Object.fromEntries(productionSkills.map((skillHrid) => [skillHrid, 2])),
            priceTable: realPriceTable,
            now: 1234,
        });

        expect(Object.keys(result.plansBySkill)).toEqual(productionSkills);
        expect(result.overview).toHaveLength(5);
        expect(Object.values(result.plansBySkill).every((plan) => plan.status === "ok")).toBe(true);
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
});

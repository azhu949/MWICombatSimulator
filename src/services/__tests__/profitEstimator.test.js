import { describe, expect, it } from "vitest";
import { buildNoRngProfitBreakdown, buildRandomProfitBreakdown, estimateNoRngProfit } from "../profitEstimator.js";

describe("profitEstimator", () => {
    it("uses consumable ask price when consumableMode is ask", () => {
        const simResult = {
            deaths: {},
            consumablesUsed: {
                player1: {
                    "/items/coin": 3,
                },
            },
        };

        const result = estimateNoRngProfit(simResult, "player1", {
            consumableMode: "ask",
            priceTable: {
                "/items/coin": { ask: 5, bid: 2, vendor: 1 },
            },
        });

        expect(result.revenue).toBe(0);
        expect(result.expenses).toBe(15);
        expect(result.profit).toBe(-15);
    });

    it("falls back to ask when bid is unavailable", () => {
        const simResult = {
            deaths: {},
            consumablesUsed: {
                player1: {
                    "/items/coin": 4,
                },
            },
        };

        const result = estimateNoRngProfit(simResult, "player1", {
            consumableMode: "bid",
            priceTable: {
                "/items/coin": { ask: 3, bid: -1, vendor: 1 },
            },
        });

        expect(result.expenses).toBe(12);
        expect(result.profit).toBe(-12);
    });

    it("falls back to vendor when ask and bid are unavailable", () => {
        const simResult = {
            deaths: {},
            consumablesUsed: {
                player1: {
                    "/items/coin": 7,
                },
            },
        };

        const result = estimateNoRngProfit(simResult, "player1", {
            consumableMode: "ask",
            priceTable: {
                "/items/coin": { ask: -1, bid: -1, vendor: 2 },
            },
        });

        expect(result.expenses).toBe(14);
        expect(result.profit).toBe(-14);
    });

    it("returns line-item breakdown for consumable expenses", () => {
        const simResult = {
            deaths: {},
            consumablesUsed: {
                player1: {
                    "/items/coin": 2.5,
                },
            },
        };

        const breakdown = buildNoRngProfitBreakdown(simResult, "player1", {
            consumableMode: "bid",
            priceTable: {
                "/items/coin": { ask: 9, bid: 4, vendor: 1 },
            },
        });

        expect(breakdown.revenue).toBe(0);
        expect(breakdown.expenses).toBe(10);
        expect(breakdown.profit).toBe(-10);
        expect(breakdown.revenueItems).toEqual([]);
        expect(breakdown.expenseItems).toHaveLength(1);
        expect(breakdown.expenseItems[0]).toMatchObject({
            itemHrid: "/items/coin",
            amount: 2.5,
            unitPrice: 4,
            totalValue: 10,
        });
    });

    it("returns empty breakdown for null result", () => {
        const breakdown = buildNoRngProfitBreakdown(null, "player1", {});

        expect(breakdown).toEqual({
            revenueItems: [],
            expenseItems: [],
            revenue: 0,
            expenses: 0,
            profit: 0,
        });
    });

    it("ignores dungeon drops for no-RNG revenue to match legacy behavior", () => {
        const breakdown = buildNoRngProfitBreakdown({
            isDungeon: true,
            deaths: {
                "/monsters/abyssal_imp": 999,
            },
            consumablesUsed: {
                player1: {
                    "/items/coin": 3,
                },
            },
        }, "player1", {
            dropMode: "bid",
            consumableMode: "ask",
            priceTable: {
                "/items/coin": { ask: 1, bid: 1, vendor: 1 },
            },
        });

        expect(breakdown.revenue).toBe(0);
        expect(breakdown.expenses).toBe(3);
        expect(breakdown.profit).toBe(-3);
    });

    it("ignores dungeon drops for random revenue to match legacy behavior", () => {
        const breakdown = buildRandomProfitBreakdown({
            isDungeon: true,
            deaths: {
                "/monsters/abyssal_imp": 999,
            },
            consumablesUsed: {
                player1: {
                    "/items/coin": 2,
                },
            },
        }, "player1", {
            dropMode: "bid",
            consumableMode: "ask",
            priceTable: {
                "/items/coin": { ask: 1, bid: 1, vendor: 1 },
            },
            useDropCache: false,
            randomSource: () => 0,
        });

        expect(breakdown.revenue).toBe(0);
        expect(breakdown.expenses).toBe(2);
        expect(breakdown.profit).toBe(-2);
    });
});

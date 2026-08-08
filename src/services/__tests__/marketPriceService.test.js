import { afterEach, describe, expect, it, vi } from "vitest";
import { extractEnhancementDataFromMarketData, fetchMarketPriceTable } from "../marketPriceService.js";

describe("marketPriceService request timeout", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("aborts a stalled source and continues with the fallback marketplace", async () => {
        vi.useFakeTimers();
        let firstSignal = null;
        const fetchImpl = vi.fn((url, options = {}) => {
            if (url.includes("milkywayidle.com")) {
                firstSignal = options.signal;
                return new Promise(() => {});
            }
            return Promise.resolve({
                ok: true,
                json: async () => ({
                    marketData: {
                        "/items/test": { "0": { a: 12, b: 10 } },
                    },
                }),
            });
        });

        const resultPromise = fetchMarketPriceTable(fetchImpl, { requestTimeoutMs: 25 });
        await vi.advanceTimersByTimeAsync(25);
        const result = await resultPromise;

        expect(firstSignal?.aborted).toBe(true);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(result.sourceUrl).toContain("milkywayidlecn.com");
        expect(result.priceTable["/items/test"]).toMatchObject({ ask: 12, bid: 10 });
    });

    it("times out stalled response parsing before trying the fallback source", async () => {
        vi.useFakeTimers();
        const fetchImpl = vi.fn((url) => Promise.resolve({
            ok: true,
            json: url.includes("milkywayidle.com")
                ? () => new Promise(() => {})
                : async () => ({ marketData: {} }),
        }));

        const resultPromise = fetchMarketPriceTable(fetchImpl, { requestTimeoutMs: 25 });
        await vi.advanceTimersByTimeAsync(25);
        const result = await resultPromise;

        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(result.sourceUrl).toContain("milkywayidlecn.com");
    });

    it("rejects after every marketplace source reaches its timeout", async () => {
        vi.useFakeTimers();
        const signals = [];
        const fetchImpl = vi.fn((url, options = {}) => {
            signals.push(options.signal);
            return new Promise(() => {});
        });

        const resultPromise = fetchMarketPriceTable(fetchImpl, { requestTimeoutMs: 25 });
        const rejection = expect(resultPromise).rejects.toThrow("Price request timed out");
        await vi.advanceTimersByTimeAsync(50);
        await rejection;

        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(signals).toHaveLength(2);
        expect(signals.every((signal) => signal?.aborted)).toBe(true);
    });
});

describe("market enhancement levels", () => {
    it("keeps bid-only quotes but only exposes levels with a positive ask", () => {
        const result = extractEnhancementDataFromMarketData({
            "/items/test": {
                "3": { a: -1, b: 25 },
                "4": { a: 100, b: 80 },
                "5": { a: 0, b: 40 },
            },
        });

        expect(result.enhancementQuotesByItem["/items/test"]["3"]).toEqual({ ask: -1, bid: 25 });
        expect(result.enhancementQuotesByItem["/items/test"]["5"]).toEqual({ ask: 0, bid: 40 });
        expect(result.enhancementLevelsByItem["/items/test"]).toEqual([4]);
    });
});

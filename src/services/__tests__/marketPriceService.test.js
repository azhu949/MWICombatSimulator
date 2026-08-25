import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyMarketSaleFee,
  applyMarketSaleFeeByRate,
  BAG_OF_10_COWBELLS_HRID,
  extractEnhancementDataFromMarketData,
  fetchMarketPriceTable,
  getMarketSaleFeeRate,
  isMarketSaleSource,
  MARKET_SALE_FEE_ROUNDING_MODE,
  resolveMarketSalePrice,
  validateSpecialMarketFeeRateHrids,
} from '../marketPriceService.js';

describe('marketPriceService request timeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts a stalled source and continues with the fallback marketplace', async () => {
    vi.useFakeTimers();
    let firstSignal = null;
    const fetchImpl = vi.fn((url, options = {}) => {
      if (url.includes('milkywayidle.com')) {
        firstSignal = options.signal;
        return new Promise(() => {});
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          marketData: {
            '/items/test': { 0: { a: 12, b: 10 } },
          },
        }),
      });
    });

    const resultPromise = fetchMarketPriceTable(fetchImpl, { requestTimeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    const result = await resultPromise;

    expect(firstSignal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.sourceUrl).toContain('milkywayidlecn.com');
    expect(result.priceTable['/items/test']).toMatchObject({ ask: 12, bid: 10 });
  });

  it('times out stalled response parsing before trying the fallback source', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((url) =>
      Promise.resolve({
        ok: true,
        json: url.includes('milkywayidle.com') ? () => new Promise(() => {}) : async () => ({ marketData: {} }),
      }),
    );

    const resultPromise = fetchMarketPriceTable(fetchImpl, { requestTimeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    const result = await resultPromise;

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.sourceUrl).toContain('milkywayidlecn.com');
  });

  it('rejects after every marketplace source reaches its timeout', async () => {
    vi.useFakeTimers();
    const signals = [];
    const fetchImpl = vi.fn((url, options = {}) => {
      signals.push(options.signal);
      return new Promise(() => {});
    });

    const resultPromise = fetchMarketPriceTable(fetchImpl, { requestTimeoutMs: 25 });
    const rejection = expect(resultPromise).rejects.toThrow('Price request timed out');
    await vi.advanceTimersByTimeAsync(50);
    await rejection;

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal?.aborted)).toBe(true);
  });
});

describe('market enhancement levels', () => {
  it('keeps bid-only quotes but only exposes levels with a positive ask', () => {
    const result = extractEnhancementDataFromMarketData({
      '/items/test': {
        3: { a: -1, b: 25 },
        4: { a: 100, b: 80 },
        5: { a: 0, b: 40 },
      },
    });

    expect(result.enhancementQuotesByItem['/items/test']['3']).toMatchObject({ ask: -1, bid: 25 });
    expect(result.enhancementQuotesByItem['/items/test']['5']).toMatchObject({ ask: 0, bid: 40 });
    expect(result.enhancementLevelsByItem['/items/test']).toEqual([4]);
  });

  it('keeps valid hourly averages and ignores invalid trade data', () => {
    const result = extractEnhancementDataFromMarketData({
      '/items/test': {
        6: { a: -1, b: -1, p: 123.5, v: 4 },
        7: { a: -1, b: -1, p: 200, v: 0 },
        8: { a: -1, b: -1, p: 0, v: 5 },
      },
    });

    expect(result.enhancementQuotesByItem['/items/test']['6']).toEqual({
      ask: -1,
      bid: -1,
      averagePrice: 123.5,
      volume: 4,
    });
    expect(result.enhancementQuotesByItem['/items/test']['7']).toBeUndefined();
    expect(result.enhancementQuotesByItem['/items/test']['8']).toBeUndefined();
  });

  it('returns the official market timestamp', async () => {
    const result = await fetchMarketPriceTable(async () => ({
      ok: true,
      json: async () => ({ marketData: {}, timestamp: 1_786_238_142 }),
    }));

    expect(result.marketTimestamp).toBe(1_786_238_142);
  });
});

describe('market sale fee rates', () => {
  it('returns the special 18% rate only for the Bag of 10 Cowbells', () => {
    expect(getMarketSaleFeeRate('/items/bag_of_10_cowbells')).toBe(0.18);
    expect(getMarketSaleFeeRate('/items/coin')).toBe(0.05);
    expect(getMarketSaleFeeRate('/items/unknown_item')).toBe(0.05);
    expect(getMarketSaleFeeRate('')).toBe(0.05);
    expect(getMarketSaleFeeRate(null)).toBe(0.05);
  });

  it('applies the default 5% fee when no special item is involved', () => {
    expect(applyMarketSaleFee(100)).toBeCloseTo(95, 10);
    expect(applyMarketSaleFee(100, '/items/coin')).toBeCloseTo(95, 10);
    expect(applyMarketSaleFee(100, '/items/unknown_item')).toBeCloseTo(95, 10);
  });

  it('applies the 18% fee to Bag of 10 Cowbells sales', () => {
    expect(applyMarketSaleFee(100, '/items/bag_of_10_cowbells')).toBeCloseTo(82, 10);
    expect(applyMarketSaleFee(0, '/items/bag_of_10_cowbells')).toBe(0);
    expect(applyMarketSaleFee(-50, '/items/bag_of_10_cowbells')).toBe(0);
  });

  it('taxes Bag of 10 Cowbells bids at 18% through resolveMarketSalePrice', () => {
    const priceTable = {
      '/items/bag_of_10_cowbells': { ask: 120, bid: 100, vendor: 0 },
      '/items/plain': { ask: 120, bid: 100, vendor: 0 },
    };
    expect(resolveMarketSalePrice(priceTable, '/items/bag_of_10_cowbells', 'bid')).toBeCloseTo(82, 10);
    expect(resolveMarketSalePrice(priceTable, '/items/plain', 'bid')).toBeCloseTo(95, 10);

    // 商店销售保持免税，即使是特殊费率的物品。
    const vendorTable = {
      '/items/bag_of_10_cowbells': { ask: 120, bid: 100, vendor: 50 },
    };
    expect(resolveMarketSalePrice(vendorTable, '/items/bag_of_10_cowbells', 'vendor')).toBe(50);
  });

  it('exposes the special-rate hrid as a named constant', () => {
    expect(BAG_OF_10_COWBELLS_HRID).toBe('/items/bag_of_10_cowbells');
    expect(getMarketSaleFeeRate(BAG_OF_10_COWBELLS_HRID)).toBe(0.18);
    expect(applyMarketSaleFee(100, BAG_OF_10_COWBELLS_HRID)).toBeCloseTo(82, 10);
  });

  it('validates special-rate hrids against the item index', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 真实游戏数据包含该 hrid，因此不会报告任何内容。
    expect(validateSpecialMarketFeeRateHrids()).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();

    // 缺失的 hrid 会被报告并警告，而不是静默回退到 5%。
    expect(validateSpecialMarketFeeRateHrids({})).toEqual([BAG_OF_10_COWBELLS_HRID]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain(BAG_OF_10_COWBELLS_HRID);

    warnSpy.mockRestore();
  });

  it('recognizes market execution sources subject to the sale tax', () => {
    expect(isMarketSaleSource('bid')).toBe(true);
    expect(isMarketSaleSource('enhancement_bid')).toBe(true);
    expect(isMarketSaleSource('ask')).toBe(true);
    expect(isMarketSaleSource('enhancement_ask')).toBe(true);
    expect(isMarketSaleSource('BID')).toBe(true);

    expect(isMarketSaleSource('vendor')).toBe(false);
    expect(isMarketSaleSource('enhancement_vendor')).toBe(false);
    expect(isMarketSaleSource('override')).toBe(false);
    expect(isMarketSaleSource('acquisition_estimate')).toBe(false);
    expect(isMarketSaleSource('')).toBe(false);
    expect(isMarketSaleSource(null)).toBe(false);
    expect(isMarketSaleSource(undefined)).toBe(false);
  });

  it('keeps the bid -> ask -> vendor fallback taxed consistently in resolveMarketSalePrice', () => {
    const table = {
      '/items/ask_only': { ask: 200, bid: -1, vendor: 30 },
      '/items/vendor_only': { ask: -1, bid: -1, vendor: 40 },
      '/items/missing': null,
    };

    // bid 模式：bid 缺失 -> 回退到 ask 仍是市场销售，需征税。
    expect(resolveMarketSalePrice(table, '/items/ask_only', 'bid')).toBeCloseTo(200 * 0.95, 10);

    // ask 模式：ask 优先。
    expect(resolveMarketSalePrice(table, '/items/ask_only', 'ask')).toBeCloseTo(200 * 0.95, 10);

    // 无市场报价 -> 回退到商店价格保持免税。
    expect(resolveMarketSalePrice(table, '/items/vendor_only', 'bid')).toBe(40);
    expect(resolveMarketSalePrice(table, '/items/vendor_only', 'ask')).toBe(40);

    // 缺失条目回退到商店价格索引（未知物品为 0）。
    expect(resolveMarketSalePrice(table, '/items/missing', 'bid')).toBe(0);
  });

  it('rounds taxed prices to whole coins', () => {
    expect(MARKET_SALE_FEE_ROUNDING_MODE).toBe('round');

    expect(applyMarketSaleFeeByRate(100, 0.05)).toBe(95);
    expect(applyMarketSaleFeeByRate(97, 0.05)).toBe(92); // 92.15 -> 92
    expect(applyMarketSaleFeeByRate(10, 0.05)).toBe(10); // 9.5 -> 10
    expect(applyMarketSaleFeeByRate(0, 0.05)).toBe(0);
    expect(applyMarketSaleFeeByRate(-50, 0.05)).toBe(0);

    expect(applyMarketSaleFee(97)).toBe(92);
    expect(applyMarketSaleFee(100, BAG_OF_10_COWBELLS_HRID)).toBe(82);
    expect(
      resolveMarketSalePrice({ '/items/fractional': { ask: -1, bid: 97, vendor: 0 } }, '/items/fractional', 'bid'),
    ).toBe(92);
  });

  it('defends against malformed entries and out-of-range fee rates', () => {
    const junk = { '/items/junk': { ask: 'abc', bid: -5, vendor: -10 } };
    expect(resolveMarketSalePrice(junk, '/items/junk', 'bid')).toBe(0);
    expect(resolveMarketSalePrice(junk, '/items/junk', 'ask')).toBe(0);
    expect(resolveMarketSalePrice(junk, '/items/junk', 'vendor')).toBe(0);
    expect(resolveMarketSalePrice({}, '', 'bid')).toBe(0);

    expect(applyMarketSaleFeeByRate(100, -0.5)).toBe(100); // 负税率钳制为 0
    expect(applyMarketSaleFeeByRate(100, 1.5)).toBe(0); // 超 100% 税率 -> 0
    expect(applyMarketSaleFeeByRate(100, Number.NaN)).toBe(100); // 非法税率按 0 处理
  });
});

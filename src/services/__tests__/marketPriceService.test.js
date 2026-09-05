import { afterEach, describe, expect, it, vi } from 'vitest';
import openableLootDropMap from '../../combatsimulator/data/openableLootDropMap.json';
import {
  applyMarketSaleFee,
  applyMarketSaleFeeByRate,
  BAG_OF_10_COWBELLS_HRID,
  createDefaultPriceTable,
  COWBELL_HRID,
  extractEnhancementDataFromMarketData,
  fetchMarketPriceTable,
  getMarketSaleFeeRate,
  hydratePriceTableWithMarketData,
  isMarketSaleSource,
  MARKET_SALE_FEE_ROUNDING_MODE,
  MIRROR_OF_PROTECTION_HRID,
  NON_TRADABLE_CAPE_HRIDS,
  normalizeTaxMode,
  rebuildSyntheticEntriesInTable,
  resolveMarketPrice,
  resolveMarketSalePrice,
  TAX_MODE_MARKET,
  TAX_MODE_NONE,
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
  it('T16 特殊费率表：铃袋/牛铃 18%、coin/宝箱 0（牛铃 18% 修订 §9）', () => {
    expect(getMarketSaleFeeRate(BAG_OF_10_COWBELLS_HRID)).toBe(0.18);
    // 决策①：单颗牛铃按铃袋 18% 口径（宝箱内容物是单颗牛铃而非铃袋，铃袋键够不到）。
    expect(getMarketSaleFeeRate(COWBELL_HRID)).toBe(0.18);
    // 决策③：金币免税；宝箱 0 = 合成价税内嵌、卖出不再二次征税（防 18%+5% 复合）。
    expect(getMarketSaleFeeRate('/items/coin')).toBe(0);
    expect(getMarketSaleFeeRate('/items/small_treasure_chest')).toBe(0);
    expect(getMarketSaleFeeRate('/items/medium_treasure_chest')).toBe(0);
    expect(getMarketSaleFeeRate('/items/large_treasure_chest')).toBe(0);
    // 普通物品与缺键输入维持默认 5%。
    expect(getMarketSaleFeeRate('/items/plain')).toBe(0.05);
    expect(getMarketSaleFeeRate('/items/unknown_item')).toBe(0.05);
    expect(getMarketSaleFeeRate('')).toBe(0.05);
    expect(getMarketSaleFeeRate(null)).toBe(0.05);
    // 净额因子：牛铃 ×0.82、宝箱免税保面值。
    expect(applyMarketSaleFee(100, COWBELL_HRID)).toBeCloseTo(82, 10);
    expect(applyMarketSaleFee(1000, '/items/large_treasure_chest')).toBe(1000);
  });

  it('applies the default 5% fee when no special item is involved', () => {
    expect(applyMarketSaleFee(100)).toBeCloseTo(95, 10);
    // coin 免税（决策③，牛铃 18% 修订 §4）：费率表 0 → 净额 = 面值，不再走默认 5%。
    expect(applyMarketSaleFee(100, '/items/coin')).toBeCloseTo(100, 10);
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

    // 缺失的 hrid 会被报告并警告，而不是静默回退到默认费率——牛铃 18% 修订后的
    // 全部 6 个键（铃袋、牛铃、coin、3 宝箱，按费率表插入序）纳入守卫。
    expect(validateSpecialMarketFeeRateHrids({})).toEqual([
      BAG_OF_10_COWBELLS_HRID,
      COWBELL_HRID,
      '/items/coin',
      '/items/small_treasure_chest',
      '/items/medium_treasure_chest',
      '/items/large_treasure_chest',
    ]);
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

// ===== 不可交易物估值注入与计税模式（设计 §6 测试矩阵 T1-T9 + 牛铃 18% 修订 §9 T16-T20/T22）=====
// fixture：铃袋/镜固定报价。宝箱合成基线（牛铃 18% 修订 §8.3）：默认档（'market'，
// 逐内容净额合成）关档小/中/大 = 19230/45525/100560、开档 = 42,263.8/106369/217902；
// 'none' 档（税前 = pre-feature 公式）关档 = 19650/46500/102300、开档 = 47740/120700/245400。
const BAG_MARKET_DATA = {
  [BAG_OF_10_COWBELLS_HRID]: { 0: { a: 1090000, b: 1060000 } },
};
const MIRROR_MARKET_DATA = {
  [MIRROR_OF_PROTECTION_HRID]: { 0: { a: 150000, b: 123456 } },
};
const TREASURE_CHEST_KEYS = [
  '/items/small_treasure_chest',
  '/items/medium_treasure_chest',
  '/items/large_treasure_chest',
];
// 宝箱牛铃期望数（openableLootDropMap 手算：0.1×中点 + 0.01×中点）。
const CHEST_COWBELL_EXPECTED_COUNTS = {
  '/items/small_treasure_chest': 0.265,
  '/items/medium_treasure_chest': 0.7,
  '/items/large_treasure_chest': 1.35,
};
// 单颗牛铃净额（'market' 档，费率表 18%）：round(106000 × 0.82) = 86,920
//（牛铃 18% 修订 §8.1；vs 现状经宝箱传导 5% 的 100,700 为 −13.68%）。
const COWBELL_NET_PRICE = 86920;

function toFinite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// 手算宝箱合成值（与 computeChestExpectedValue 同结构同顺序逐项复算）：牛铃按
// 注入价、其余内容物取基准（关闭档）表税前价，再逐内容按 hrid 费率折净额
//（牛铃 18% 修订 §1.2a，'market' 默认档口径：牛铃 ×0.82、coin/宝箱 ×1、其余
// ×0.95）——交叉验证注入值确实流入了合成且求值顺序逐位一致（T1）。
function expectedChestValueWithCowbell(referenceTable, chestHrid, mode, cowbellPrice) {
  const drops = Array.isArray(openableLootDropMap[chestHrid]) ? openableLootDropMap[chestHrid] : [];
  let total = 0;
  for (const drop of drops) {
    const dropRate = Math.max(0, toFinite(drop?.dropRate, 0));
    const minCount = Math.max(0, toFinite(drop?.minCount, 0));
    const maxCount = Math.max(0, toFinite(drop?.maxCount, 0));
    const expectedCount = (minCount + maxCount) / 2;
    const gross =
      drop?.itemHrid === COWBELL_HRID ? cowbellPrice : resolveMarketPrice(referenceTable, drop?.itemHrid, mode);
    const unit = applyMarketSaleFee(gross, drop?.itemHrid);
    total += unit * dropRate * expectedCount;
  }
  return Math.max(0, toFinite(total, 0));
}

describe('non-tradable valuation and tax modes（设计 §6 T1-T9）', () => {
  it('T1 牛铃注入先于宝箱合成，按铃袋买单价/10 写入 vendor 列', () => {
    const onTable = hydratePriceTableWithMarketData(BAG_MARKET_DATA, undefined, { nonTradableValuation: true });
    const offTable = hydratePriceTableWithMarketData(BAG_MARKET_DATA);

    // C 案注入形态：ask/bid 恒 -1（不可市场挂单），vendor = round(袋 bid / 10)。
    expect(onTable[COWBELL_HRID]).toEqual({ ask: -1, bid: -1, vendor: 106000 });
    expect(offTable[COWBELL_HRID]).toEqual({ ask: -1, bid: -1, vendor: 0 });

    // 宝箱合成吃到牛铃：三列合成值与「牛铃净额 86,920 + 其余内容物净额」的手算
    // 期望逐位一致（'market' 默认档逐内容净额口径）；合成价增量 = 86,920 × 期望
    // 牛铃数（0.265/0.700/1.350 → 23,033.8/60,844/117,342，牛铃 18% 修订 §8.2）。
    for (const chestHrid of TREASURE_CHEST_KEYS) {
      for (const mode of ['ask', 'bid', 'vendor']) {
        expect(onTable[chestHrid][mode]).toBe(expectedChestValueWithCowbell(offTable, chestHrid, mode, 106000));
      }
      expect(onTable[chestHrid].bid - offTable[chestHrid].bid).toBeCloseTo(
        COWBELL_NET_PRICE * CHEST_COWBELL_EXPECTED_COUNTS[chestHrid],
        6,
      );
    }
  });

  it('T2 铃袋缺价或买单价非正时跳过牛铃注入并保持现状口径', () => {
    // variant 2/3 的 a>0 且 b≤0 即 ask-only 单边（脚本侧 convertMarketDataToItemValues
    // 此时会兜底取单边公允价）；本项目刻意不兜底（审计 S-4 定案：ask 是买入价，
    // 估值「持有的牛铃」偏乐观），保持「诚实缺价」现口径——若放宽须同步修订本
    // 测试、T3 与设计文档定案。
    const variants = [
      { '/items/raw_bass': { 0: { a: 300, b: 250 } } }, // 袋条目缺失
      { [BAG_OF_10_COWBELLS_HRID]: { 0: { a: 1090000, b: -1 } } }, // ask-only 单边（bid=-1）
      { [BAG_OF_10_COWBELLS_HRID]: { 0: { a: 1090000, b: 0 } } }, // ask-only 单边（bid=0）
    ];

    for (const marketData of variants) {
      const onTable = hydratePriceTableWithMarketData(marketData, undefined, { nonTradableValuation: true });
      const offTable = hydratePriceTableWithMarketData(marketData);

      expect(onTable[COWBELL_HRID]).toEqual({ ask: -1, bid: -1, vendor: 0 });
      for (const chestHrid of TREASURE_CHEST_KEYS) {
        expect(onTable[chestHrid]).toEqual(offTable[chestHrid]);
      }
    }
  });

  it('T3 披风按镜买单价注入，镜缺价保持商店兜底且与牛铃注入相互独立', () => {
    const onWithMirror = hydratePriceTableWithMarketData(MIRROR_MARKET_DATA, undefined, {
      nonTradableValuation: true,
    });
    for (const capeHrid of NON_TRADABLE_CAPE_HRIDS) {
      expect(onWithMirror[capeHrid]).toEqual({ ask: -1, bid: -1, vendor: 123456 });
    }

    // 镜缺价：保持 itemDetail 静态收购价兜底（现状形态）。
    const onWithoutMirror = hydratePriceTableWithMarketData({}, undefined, { nonTradableValuation: true });
    for (const capeHrid of NON_TRADABLE_CAPE_HRIDS) {
      expect(onWithoutMirror[capeHrid]).toEqual({ ask: -1, bid: -1, vendor: 100000 });
    }

    // 镜 bid 非正（0）同样跳过注入。
    const onWithZeroMirror = hydratePriceTableWithMarketData(
      { [MIRROR_OF_PROTECTION_HRID]: { 0: { a: 150000, b: 0 } } },
      undefined,
      { nonTradableValuation: true },
    );
    expect(onWithZeroMirror['/items/chimerical_quiver']).toEqual({ ask: -1, bid: -1, vendor: 100000 });

    // 两段注入相互独立：有袋无镜 → 仅牛铃；有镜无袋 → 仅披风。
    const bagOnly = hydratePriceTableWithMarketData(BAG_MARKET_DATA, undefined, { nonTradableValuation: true });
    expect(bagOnly[COWBELL_HRID].vendor).toBe(106000);
    expect(bagOnly['/items/chimerical_quiver']).toEqual({ ask: -1, bid: -1, vendor: 100000 });

    const mirrorOnly = hydratePriceTableWithMarketData(MIRROR_MARKET_DATA, undefined, {
      nonTradableValuation: true,
    });
    expect(mirrorOnly[COWBELL_HRID]).toEqual({ ask: -1, bid: -1, vendor: 0 });
    expect(mirrorOnly['/items/chimerical_quiver'].vendor).toBe(123456);
  });

  it('T4 注入与重建从不改写铃袋与镜的报价（防污染不变量 §1.4）', () => {
    const marketData = { ...BAG_MARKET_DATA, ...MIRROR_MARKET_DATA };
    const offTable = hydratePriceTableWithMarketData(marketData);
    const onTable = hydratePriceTableWithMarketData(marketData, undefined, { nonTradableValuation: true });

    expect(onTable[BAG_OF_10_COWBELLS_HRID]).toEqual({ ask: 1090000, bid: 1060000, vendor: 0 });
    expect(onTable[MIRROR_OF_PROTECTION_HRID]).toEqual({ ask: 150000, bid: 123456, vendor: 200000 });
    expect(onTable[BAG_OF_10_COWBELLS_HRID]).toEqual(offTable[BAG_OF_10_COWBELLS_HRID]);
    expect(onTable[MIRROR_OF_PROTECTION_HRID]).toEqual(offTable[MIRROR_OF_PROTECTION_HRID]);

    // rebuild 剥离重导出同样不触碰两个只读键（SYNTHETIC_ENTRY_HRIDS 不含袋/镜）。
    rebuildSyntheticEntriesInTable(onTable, { nonTradableValuation: true });
    expect(onTable[BAG_OF_10_COWBELLS_HRID]).toEqual({ ask: 1090000, bid: 1060000, vendor: 0 });
    expect(onTable[MIRROR_OF_PROTECTION_HRID]).toEqual({ ask: 150000, bid: 123456, vendor: 200000 });
  });

  it('T5 开关关闭时三路径产物同口径逐位一致（净额合成基线），rebuild 幂等', async () => {
    // 新模型默认档基线（牛铃 18% 修订 §8.3，'market' 逐内容净额合成）：默认表下
    // 三种宝箱合成值三列同值，coin 合成 {1,1,1}，牛铃/披风为 itemDetail 基础形态
    //（牛铃 vendor=0、披风 100000）。pre-feature 税前锚点 19650/46500/102300
    // 迁移到下方显式 {taxMode:'none'} 断言。
    const defaults = createDefaultPriceTable();
    expect(defaults['/items/coin']).toEqual({ ask: 1, bid: 1, vendor: 1 });
    expect(defaults[COWBELL_HRID]).toEqual({ ask: -1, bid: -1, vendor: 0 });
    expect(defaults['/items/chimerical_quiver']).toEqual({ ask: -1, bid: -1, vendor: 100000 });
    expect(defaults['/items/small_treasure_chest']).toEqual({ ask: 19230, bid: 19230, vendor: 19230 });
    expect(defaults['/items/medium_treasure_chest']).toEqual({ ask: 45525, bid: 45525, vendor: 45525 });
    expect(defaults['/items/large_treasure_chest']).toEqual({ ask: 100560, bid: 100560, vendor: 100560 });

    // 不传 options（既有调用形态）与显式 { nonTradableValuation: false } 全表逐位一致。
    expect(createDefaultPriceTable({ nonTradableValuation: false })).toEqual(defaults);

    const marketData = { ...BAG_MARKET_DATA, ...MIRROR_MARKET_DATA };
    expect(hydratePriceTableWithMarketData(marketData)).toEqual(
      hydratePriceTableWithMarketData(marketData, undefined, { nonTradableValuation: false }),
    );

    const fetchImpl = async () => ({ ok: true, json: async () => ({ marketData, timestamp: 1 }) });
    const fetchedDefault = await fetchMarketPriceTable(fetchImpl);
    const fetchedExplicitOff = await fetchMarketPriceTable(fetchImpl, { nonTradableValuation: false });
    expect(fetchedDefault.priceTable).toEqual(fetchedExplicitOff.priceTable);
    expect(fetchedDefault.priceTable[COWBELL_HRID]).toEqual({ ask: -1, bid: -1, vendor: 0 });
    expect(fetchedDefault.priceTable['/items/large_treasure_chest']).toEqual(defaults['/items/large_treasure_chest']);

    // pre-feature 合成值锚点迁移（牛铃 18% 修订 §9-T5）：'none' 档税前聚合 =
    // 旧模型基线 19650/46500/102300（三列同值）；默认档不再等于旧值（税费已内嵌）。
    const noneDefaults = createDefaultPriceTable({ nonTradableValuation: false, taxMode: TAX_MODE_NONE });
    expect(noneDefaults['/items/small_treasure_chest']).toEqual({ ask: 19650, bid: 19650, vendor: 19650 });
    expect(noneDefaults['/items/medium_treasure_chest']).toEqual({ ask: 46500, bid: 46500, vendor: 46500 });
    expect(noneDefaults['/items/large_treasure_chest']).toEqual({ ask: 102300, bid: 102300, vendor: 102300 });

    // rebuild 幂等：对关闭档表连跑两次（不传 options / 显式 false）逐位不变。
    const offHydrated = hydratePriceTableWithMarketData(marketData);
    const snapshot = JSON.stringify(offHydrated);
    rebuildSyntheticEntriesInTable(offHydrated);
    expect(JSON.stringify(offHydrated)).toBe(snapshot);
    rebuildSyntheticEntriesInTable(offHydrated, { nonTradableValuation: false });
    expect(JSON.stringify(offHydrated)).toBe(snapshot);
  });

  it('T6 rebuild 剥离旧缓存烘焙值并按当前开关重导出', () => {
    const marketData = { ...BAG_MARKET_DATA, ...MIRROR_MARKET_DATA };
    const freshOnTable = hydratePriceTableWithMarketData(marketData, undefined, { nonTradableValuation: true });

    // 旧缓存形态 A：开关关时代写入（宝箱值不含牛铃 + 牛铃 vendor=0）。
    const staleOffCache = JSON.parse(JSON.stringify(hydratePriceTableWithMarketData(marketData)));
    rebuildSyntheticEntriesInTable(staleOffCache, { nonTradableValuation: true });
    expect(staleOffCache[COWBELL_HRID]).toEqual({ ask: -1, bid: -1, vendor: 106000 });
    for (const chestHrid of TREASURE_CHEST_KEYS) {
      expect(staleOffCache[chestHrid]).toEqual(freshOnTable[chestHrid]);
    }

    // 旧缓存形态 B：开关开时代写入（含牛铃值）→ 现在关 → 与同行情同档重算一致。
    const staleOnCache = JSON.parse(JSON.stringify(freshOnTable));
    const legacyReference = hydratePriceTableWithMarketData(marketData);
    rebuildSyntheticEntriesInTable(staleOnCache, { nonTradableValuation: false });
    expect(staleOnCache[COWBELL_HRID]).toEqual({ ask: -1, bid: -1, vendor: 0 });
    expect(staleOnCache['/items/chance_cape']).toEqual({ ask: -1, bid: -1, vendor: 100000 });
    for (const chestHrid of TREASURE_CHEST_KEYS) {
      expect(staleOnCache[chestHrid]).toEqual(legacyReference[chestHrid]);
    }
    // 非合成键（铃袋/镜等行情快照）原样保留，不参与剥离重算。
    expect(staleOnCache[BAG_OF_10_COWBELLS_HRID]).toEqual(freshOnTable[BAG_OF_10_COWBELLS_HRID]);
    expect(staleOnCache[MIRROR_OF_PROTECTION_HRID]).toEqual(freshOnTable[MIRROR_OF_PROTECTION_HRID]);
  });

  it('T7 taxMode market 与既有三参直调逐值一致（非宝箱项现状锚点）', () => {
    const table = {
      [BAG_OF_10_COWBELLS_HRID]: { ask: 120, bid: 100, vendor: 50 },
      '/items/plain': { ask: 120, bid: 100, vendor: 0 },
      '/items/ask_only': { ask: 200, bid: -1, vendor: 30 },
      '/items/vendor_only': { ask: -1, bid: -1, vendor: 40 },
      '/items/coin': { ask: 1, bid: 1, vendor: 1 },
      '/items/junk': { ask: 'abc', bid: -5, vendor: -10 },
      '/items/missing': null,
    };

    for (const hrid of Object.keys(table)) {
      for (const mode of ['bid', 'ask', 'vendor']) {
        const threeParam = resolveMarketSalePrice(table, hrid, mode);
        expect(resolveMarketSalePrice(table, hrid, mode, TAX_MODE_MARKET)).toBe(threeParam);
        // 大小写归一同样落到 'market' 档。
        expect(resolveMarketSalePrice(table, hrid, mode, 'MARKET')).toBe(threeParam);
      }
    }

    // 既有断言矩阵锚点（与上方 describe 中的 18%/5%/兜底用例同口径；表内无宝箱
    // 条目、coin {1,1,1} 两模型同值 1）零变化——宝箱/coin 的新 'market' 行为由
    // T16/T17/T22 锚定（牛铃 18% 修订 §9-T7 收窄）。
    expect(resolveMarketSalePrice(table, BAG_OF_10_COWBELLS_HRID, 'bid')).toBe(82);
    expect(resolveMarketSalePrice(table, '/items/plain', 'bid')).toBe(95);
    expect(resolveMarketSalePrice(table, '/items/vendor_only', 'bid')).toBe(40);
    expect(resolveMarketSalePrice(table, '/items/missing', 'bid')).toBe(0);
    expect(resolveMarketSalePrice(table, '/items/coin', 'bid')).toBe(1);
  });

  it('T8 taxMode market 对 vendor 来源免税、coin 恒免税、特殊费率仅作用市场来源', () => {
    const table = {
      '/items/vendor_only': { ask: -1, bid: -1, vendor: 40 },
      [BAG_OF_10_COWBELLS_HRID]: { ask: -1, bid: -1, vendor: 50 },
      '/items/plain': { ask: 200, bid: 100, vendor: 1 },
      '/items/coin': { ask: 200, bid: 100, vendor: 1 },
    };

    // vendor 来源免税（bid/ask/vendor 三模式的来源链都解析到 vendor 列）：
    // 2026-09-04 两档决策移除 'all' 后，vendor 兜底不再有应税档（原 'all' 为 38）。
    expect(resolveMarketSalePrice(table, '/items/vendor_only', 'bid', TAX_MODE_MARKET)).toBe(40);
    expect(resolveMarketSalePrice(table, '/items/vendor_only', 'ask', TAX_MODE_MARKET)).toBe(40);
    expect(resolveMarketSalePrice(table, '/items/vendor_only', 'vendor', TAX_MODE_MARKET)).toBe(40);

    // 铃袋 18% 特殊费率只作用于市场成交来源：vendor 兜底列免税 50（原 'all' 为 41）。
    expect(resolveMarketSalePrice(table, BAG_OF_10_COWBELLS_HRID, 'bid', TAX_MODE_MARKET)).toBe(50);

    // coin 恒免税（决策③：费率表 0）——市场来源 bid 净额 100，vendor 模式免税 1。
    expect(resolveMarketSalePrice(table, '/items/coin', 'bid', TAX_MODE_MARKET)).toBe(100);
    expect(resolveMarketSalePrice(table, '/items/coin', 'vendor', TAX_MODE_MARKET)).toBe(1);

    // ask/bid 市场来源照常计税。
    expect(resolveMarketSalePrice(table, '/items/plain', 'bid', TAX_MODE_MARKET)).toBe(95);
    expect(resolveMarketSalePrice(table, '/items/plain', 'ask', TAX_MODE_MARKET)).toBe(190);
  });

  it('T9 taxMode none 全免税与 normalizeTaxMode 白名单', () => {
    const table = {
      '/items/plain': { ask: 200, bid: 100, vendor: 40 },
      [BAG_OF_10_COWBELLS_HRID]: { ask: 120, bid: 100, vendor: 50 },
      '/items/junk': { ask: 'abc', bid: -5, vendor: -10 },
    };

    // 三模式全免税：一律返回税前 resolveMarketPrice（含 vendor 来源与特殊费率物品）。
    expect(resolveMarketSalePrice(table, '/items/plain', 'bid', TAX_MODE_NONE)).toBe(100);
    expect(resolveMarketSalePrice(table, '/items/plain', 'ask', TAX_MODE_NONE)).toBe(200);
    expect(resolveMarketSalePrice(table, '/items/plain', 'vendor', TAX_MODE_NONE)).toBe(40);
    expect(resolveMarketSalePrice(table, BAG_OF_10_COWBELLS_HRID, 'bid', TAX_MODE_NONE)).toBe(100);
    expect(resolveMarketSalePrice(table, '/items/junk', 'bid', TAX_MODE_NONE)).toBe(0);
    expect(resolveMarketSalePrice({}, '', 'bid', TAX_MODE_NONE)).toBe(0);

    // 白名单：仅 'none' 是合法显式档位，其余（含存量 'all'/'ALL'/大小写变体/
    // 空值）回退 fallback（2026-09-04 两档决策：存量 'all' 自动归一为 'market'）。
    expect(normalizeTaxMode('none')).toBe(TAX_MODE_NONE);
    expect(normalizeTaxMode('MARKET')).toBe(TAX_MODE_MARKET);
    expect(normalizeTaxMode('all')).toBe(TAX_MODE_MARKET);
    expect(normalizeTaxMode('ALL')).toBe(TAX_MODE_MARKET);
    expect(normalizeTaxMode('')).toBe(TAX_MODE_MARKET);
    expect(normalizeTaxMode(null)).toBe(TAX_MODE_MARKET);
    expect(normalizeTaxMode(undefined)).toBe(TAX_MODE_MARKET);
    expect(normalizeTaxMode('bogus')).toBe(TAX_MODE_MARKET);
    expect(normalizeTaxMode('bogus', TAX_MODE_NONE)).toBe(TAX_MODE_NONE);
  });

  it('T17 宝箱卖出免二次征税（防复合回归，牛铃 18% 修订 §1.2b）', () => {
    // 手写宝箱条目（模拟 override 面值）：市场来源卖出按费率表 0 免税 = 面值，
    // 防回退到旧「宝箱整体 5%」模型的 950（防 18%+5% 复合的回归锚点）。
    const table = { '/items/large_treasure_chest': { ask: 1000, bid: 1000, vendor: 1 } };
    expect(resolveMarketSalePrice(table, '/items/large_treasure_chest', 'bid', TAX_MODE_MARKET)).toBe(1000);
    expect(resolveMarketSalePrice(table, '/items/large_treasure_chest', 'bid', TAX_MODE_NONE)).toBe(1000);

    // 合成 fixture 宝箱（开关开，'market' 档）卖出 = round(净额合成和)：小箱合成层
    // 精确 42,263.8 → 卖出取整 42,264；中/大箱 106,369/217,902（修订 §8.3 卖出列）。
    const onTable = hydratePriceTableWithMarketData(BAG_MARKET_DATA, undefined, { nonTradableValuation: true });
    expect(resolveMarketSalePrice(onTable, '/items/small_treasure_chest', 'bid')).toBe(42264);
    expect(resolveMarketSalePrice(onTable, '/items/medium_treasure_chest', 'bid')).toBe(106369);
    expect(resolveMarketSalePrice(onTable, '/items/large_treasure_chest', 'bid')).toBe(217902);
  });

  it('T18 宝箱合成逐内容净额矩阵：开/关档合成层精确值与箱内 coin 免税锚点（修订 §8）', () => {
    const onTable = hydratePriceTableWithMarketData(BAG_MARKET_DATA, undefined, { nonTradableValuation: true });
    const offTable = hydratePriceTableWithMarketData(BAG_MARKET_DATA);

    // 开档（含牛铃净额 86,920）合成层精确值：小箱 42,263.8、中/大箱 106,369/217,902。
    expect(onTable['/items/small_treasure_chest'].bid).toBeCloseTo(42263.8, 6);
    expect(onTable['/items/medium_treasure_chest'].bid).toBeCloseTo(106369, 6);
    expect(onTable['/items/large_treasure_chest'].bid).toBeCloseTo(217902, 6);

    // 关档（牛铃 vendor=0）合成层：19230/45525/100560（修订 §8.3 合成层精确值）。
    expect(offTable['/items/small_treasure_chest'].bid).toBeCloseTo(19230, 6);
    expect(offTable['/items/medium_treasure_chest'].bid).toBeCloseTo(45525, 6);
    expect(offTable['/items/large_treasure_chest'].bid).toBeCloseTo(100560, 6);

    // 逐内容分解锚点（大箱，修订 §8.4）：箱内 coin 按面值 1 免税全额计入
    //（期望金币数 67,500 = 45,000 + 22,500）；宝石单位净额 = round(vendor × 0.95)
    //（pearl 3,800 等 6 项，净额和 33,060）；牛铃单位净额 = 86,920 → 净贡献 117,342。
    const largeDrops = openableLootDropMap['/items/large_treasure_chest'];
    let coinContribution = 0;
    let gemNetContribution = 0;
    let cowbellNetContribution = 0;
    for (const drop of largeDrops) {
      const expectedCount = (toFinite(drop?.minCount, 0) + toFinite(drop?.maxCount, 0)) / 2;
      const factor = Math.max(0, toFinite(drop?.dropRate, 0)) * expectedCount;
      if (drop?.itemHrid === '/items/coin') {
        coinContribution += factor;
      } else if (drop?.itemHrid === COWBELL_HRID) {
        cowbellNetContribution += applyMarketSaleFee(106000, COWBELL_HRID) * factor;
      } else {
        gemNetContribution +=
          applyMarketSaleFee(resolveMarketPrice(offTable, drop?.itemHrid, 'bid'), drop?.itemHrid) * factor;
      }
    }
    expect(coinContribution).toBeCloseTo(67500, 6);
    expect(cowbellNetContribution).toBeCloseTo(117342, 6);
    expect(gemNetContribution).toBeCloseTo(33060, 6);
    expect(coinContribution + gemNetContribution).toBeCloseTo(offTable['/items/large_treasure_chest'].bid, 6);
    expect(coinContribution + gemNetContribution + cowbellNetContribution).toBeCloseTo(
      onTable['/items/large_treasure_chest'].bid,
      6,
    );
  });

  it('T19 宝箱合成跟随 taxMode：none 税前、market 净额（修订 §3）', () => {
    // 'none' 档：税前聚合（= pre-feature 合成公式）——开档 47,740/120,700/245,400、
    // 关档 19,650/46,500/102,300（修订 §8.3 'none' 列；关档即旧模型 T5 基线锚点）。
    const noneOn = hydratePriceTableWithMarketData(BAG_MARKET_DATA, undefined, {
      nonTradableValuation: true,
      taxMode: TAX_MODE_NONE,
    });
    const noneOff = hydratePriceTableWithMarketData(BAG_MARKET_DATA, undefined, { taxMode: TAX_MODE_NONE });
    expect(noneOn['/items/small_treasure_chest'].bid).toBeCloseTo(47740, 6);
    expect(noneOn['/items/medium_treasure_chest'].bid).toBeCloseTo(120700, 6);
    expect(noneOn['/items/large_treasure_chest'].bid).toBeCloseTo(245400, 6);
    expect(noneOff['/items/small_treasure_chest'].bid).toBeCloseTo(19650, 6);
    expect(noneOff['/items/medium_treasure_chest'].bid).toBeCloseTo(46500, 6);
    expect(noneOff['/items/large_treasure_chest'].bid).toBeCloseTo(102300, 6);
  });

  it('T20 三路径（fetch/hydrate/createDefault）taxMode 线程化：缺省 market 净额、显式 none 税前（修订 §3.5）', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ marketData: BAG_MARKET_DATA, timestamp: 1 }) });

    // fetch 缺省 taxMode → 'market' 净额合成；显式 'none' → 税前——与 hydrate 同构。
    const fetchedDefault = await fetchMarketPriceTable(fetchImpl, { nonTradableValuation: true });
    const fetchedNone = await fetchMarketPriceTable(fetchImpl, {
      nonTradableValuation: true,
      taxMode: TAX_MODE_NONE,
    });
    expect(fetchedDefault.priceTable['/items/large_treasure_chest'].bid).toBeCloseTo(217902, 6);
    expect(fetchedNone.priceTable['/items/large_treasure_chest'].bid).toBeCloseTo(245400, 6);
    expect(fetchedDefault.priceTable).toEqual(
      hydratePriceTableWithMarketData(BAG_MARKET_DATA, undefined, { nonTradableValuation: true }),
    );
    expect(fetchedNone.priceTable).toEqual(
      hydratePriceTableWithMarketData(BAG_MARKET_DATA, undefined, {
        nonTradableValuation: true,
        taxMode: TAX_MODE_NONE,
      }),
    );

    // createDefaultPriceTable 同构：缺省净额（关档 100,560）、显式 'none' 税前（102,300）。
    expect(createDefaultPriceTable()['/items/large_treasure_chest'].bid).toBeCloseTo(100560, 6);
    expect(createDefaultPriceTable({ taxMode: TAX_MODE_NONE })['/items/large_treasure_chest'].bid).toBeCloseTo(
      102300,
      6,
    );
  });

  it('T22 coin 两档统一免税（费率表 0，牛铃 18% 修订 §4）', () => {
    const table = { '/items/coin': { ask: 100, bid: 100, vendor: 1 } };
    expect(resolveMarketSalePrice(table, '/items/coin', 'bid', TAX_MODE_MARKET)).toBe(100);
    expect(resolveMarketSalePrice(table, '/items/coin', 'bid', TAX_MODE_NONE)).toBe(100);
  });

  it('T23 hydrate 幂等：任意 baseTable 产物与同行情同档 fresh 表一致（G-1 回归锚点）', () => {
    const marketData = { ...BAG_MARKET_DATA, ...MIRROR_MARKET_DATA };

    // 开时期表作为 baseTable + 切关：旧注入值必须被清除。修复前 cowbell.vendor
    // 残留 106000 并静默流入宝箱合成（大箱 bid 偏高 117,342 = 86,920 × 1.35）。
    const onTable = hydratePriceTableWithMarketData(marketData, undefined, { nonTradableValuation: true });
    const rehydratedOff = hydratePriceTableWithMarketData(marketData, onTable, { nonTradableValuation: false });
    const freshOff = hydratePriceTableWithMarketData(marketData);
    expect(rehydratedOff[COWBELL_HRID]).toEqual({ ask: -1, bid: -1, vendor: 0 });
    expect(rehydratedOff['/items/chance_cape']).toEqual({ ask: -1, bid: -1, vendor: 100000 });
    for (const chestHrid of TREASURE_CHEST_KEYS) {
      expect(rehydratedOff[chestHrid]).toEqual(freshOff[chestHrid]);
    }
    expect(rehydratedOff).toEqual(freshOff);

    // 反向：关时期表 + 切开 → 与 fresh on 表一致（袋/镜注入正常生效）。
    const offTable = hydratePriceTableWithMarketData(marketData);
    const rehydratedOn = hydratePriceTableWithMarketData(marketData, offTable, { nonTradableValuation: true });
    const freshOn = hydratePriceTableWithMarketData(marketData, undefined, { nonTradableValuation: true });
    expect(rehydratedOn[COWBELL_HRID]).toEqual({ ask: -1, bid: -1, vendor: 106000 });
    expect(rehydratedOn['/items/chance_cape']).toEqual({ ask: -1, bid: -1, vendor: 123456 });
    expect(rehydratedOn).toEqual(freshOn);

    // 自反：同 options 重复调用（开+开 / 关+关）逐位不变。
    expect(hydratePriceTableWithMarketData(marketData, onTable, { nonTradableValuation: true })).toEqual(freshOn);
    expect(hydratePriceTableWithMarketData(marketData, offTable, { nonTradableValuation: false })).toEqual(freshOff);
  });
});

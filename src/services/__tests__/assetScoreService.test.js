import { describe, expect, it, vi } from 'vitest';
import {
  ASSET_SCORE_SOURCES,
  COST_RESULT_CACHE_LIMIT,
  POUCH_DRINK_ENHANCEMENT_BONUSES,
  assetScoreEquals,
  computeAcquisitionInputPrice,
  computeAssetScoreConfigSignature,
  computeGuildTokenValue,
  computePlayerAssetScore,
  computeShopCurrencyValue,
  computeEnhancedEquipmentCost,
  formatAssetScoreGold,
  formatScoreValue,
  formatAssetScoreLabel,
  listShopCurrencyRewardEntries,
  resolveAssetItemValue,
  resolveCraftingTeaLessResource,
  resolveEquipmentAssetValue,
  resolveOfficialMarketItemValue,
  sanitizeAssetScorePayload,
} from '../assetScoreService.js';
import { itemDetailIndex } from '../../shared/gameDataIndex.js';
import houseRoomDetailMap from '../../combatsimulator/data/houseRoomDetailMap.json';
import itemDetailMap from '../../combatsimulator/data/itemDetailMap.json';
import { combatGuildBuffHrids } from '../../shared/guildBuffs.js';
import { createEmptyPlayerConfig } from '../../shared/playerConfig.js';

function createPricing(overrides = {}) {
  return {
    priceTable: {},
    enhancementQuotesByItem: {},
    marketItemValues: {},
    lastFetchedAt: Date.now(),
    ...overrides,
  };
}

// 从真实游戏数据中动态选取测试条目，避免硬编码 hrid 在数据更新后失效。
const enhanceableEntry = Object.values(itemDetailIndex).find(
  (item) =>
    Array.isArray(item?.enhancementCosts) && item.enhancementCosts.length > 0 && Number(item?.sellPrice || 0) > 0,
);
const vendorOnlyEntry = Object.values(itemDetailIndex).find((item) => Number(item?.sellPrice || 0) > 0);
const combatRoomEntry = Object.values(houseRoomDetailMap).find(
  (room) => room?.usableInActionTypeMap?.['/action_types/combat'] === true && String(room?.hrid || ''),
);

// 成本法（④）的前置条件是起始件（+0）与每种强化材料都有价（totalInvestment 需
// startingItem.available && materialPricesAvailable）。现实行情中基础件挂在主价表、
// 材料有挂单，缺的通常只是高强化等级本身的行情——本 helper 模拟该场景：给基础件与
// enhancementCosts 材料注入价格，目标强化等级保持无挂单/无成交。
// 另外理想玩家参数（ultra/blessed 茶）的茶水消耗也按材料定价，缺价会让全策略不可用；
// refined 物品按 base 计成本（起始件/材料表都取 base），helper 相应做 base 感知。
function createCostPricing(itemHrid, { baseAsk = 1000, materialAsk = 50 } = {}) {
  const baseItemHrid = itemHrid.endsWith('_refined') ? itemHrid.replace(/_refined$/, '') : itemHrid;
  const priceTable = {
    [itemHrid]: { ask: baseAsk, bid: baseAsk },
    [baseItemHrid]: { ask: baseAsk, bid: baseAsk },
  };
  const costs = Array.isArray(itemDetailIndex[baseItemHrid]?.enhancementCosts)
    ? itemDetailIndex[baseItemHrid].enhancementCosts
    : itemDetailIndex[itemHrid]?.enhancementCosts;
  for (const cost of Array.isArray(costs) ? costs : []) {
    const materialHrid = String(cost?.itemHrid || '');
    if (materialHrid && materialHrid !== '/items/coin' && !priceTable[materialHrid]) {
      priceTable[materialHrid] = { ask: materialAsk, bid: materialAsk };
    }
  }
  priceTable['/items/ultra_enhancing_tea'] = { ask: 1000, bid: 1000 };
  priceTable['/items/blessed_tea'] = { ask: 1000, bid: 1000 };
  return createPricing({ priceTable });
}

describe('resolveOfficialMarketItemValue', () => {
  it('读取按物品×强化等级组织的官方估算值', () => {
    const pricing = createPricing({ marketItemValues: { '/items/foo': { 0: 100, 2: 250 } } });
    expect(resolveOfficialMarketItemValue(pricing, '/items/foo', 0)).toBe(100);
    expect(resolveOfficialMarketItemValue(pricing, '/items/foo', 2)).toBe(250);
    expect(resolveOfficialMarketItemValue(pricing, '/items/foo', 1)).toBe(0);
    expect(resolveOfficialMarketItemValue(pricing, '/items/bar', 0)).toBe(0);
  });
});

describe('resolveAssetItemValue 六级取价链', () => {
  it('① 官方估算市场价值优先', () => {
    const pricing = createPricing({
      marketItemValues: { '/items/foo': { 2: 500 } },
      enhancementQuotesByItem: { '/items/foo': { 2: { ask: 100, bid: 60 } } },
    });
    expect(resolveAssetItemValue(pricing, '/items/foo', 2)).toEqual({
      price: 500,
      source: ASSET_SCORE_SOURCES.OFFICIAL_ESTIMATE,
    });
  });

  // N5 联动：payload marketEstimateSource='synthetic'（主站脚本回落合成中价）时
  // 官方估算命中的 hrid 切换为 SYNTHETIC_MID 标签；无标注 hrid 保持官方估算
  // （向后兼容，与历史行为一致）。数值口径零改动（两用例 price 相同）。
  it('① 官方估算命中按 hrid 来源映射切换标签：synthetic → SYNTHETIC_MID，无标注保持 official', () => {
    const pricing = createPricing({
      marketItemValues: { '/items/foo': { 2: 500 }, '/items/bar': { 2: 300 } },
      marketItemValueSources: { '/items/foo': 'synthetic' },
    });
    expect(resolveAssetItemValue(pricing, '/items/foo', 2)).toEqual({
      price: 500,
      source: ASSET_SCORE_SOURCES.SYNTHETIC_MID,
    });
    expect(resolveAssetItemValue(pricing, '/items/bar', 2)).toEqual({
      price: 300,
      source: ASSET_SCORE_SOURCES.OFFICIAL_ESTIMATE,
    });
  });

  // 【一般-5】（2026-09-02）等级级来源覆盖：marketItemValueSourcesByLevel 命中该等级
  // → SYNTHETIC_MID（物品级标注保持 official 的混合物品）；未命中等级回落物品级标注。
  it('① 等级级来源覆盖优先于物品级标注：命中等级 → SYNTHETIC_MID，未命中 → official', () => {
    const pricing = createPricing({
      marketItemValues: { '/items/foo': { 0: 100, 2: 500 } },
      marketItemValueSources: { '/items/foo': 'official' },
      marketItemValueSourcesByLevel: { '/items/foo': { 2: 'synthetic' } },
    });
    expect(resolveAssetItemValue(pricing, '/items/foo', 2)).toEqual({
      price: 500,
      source: ASSET_SCORE_SOURCES.SYNTHETIC_MID,
    });
    expect(resolveAssetItemValue(pricing, '/items/foo', 0)).toEqual({
      price: 100,
      source: ASSET_SCORE_SOURCES.OFFICIAL_ESTIMATE,
    });
  });

  it('② 双边挂单取 (ask+bid)/2，单边取单边', () => {
    const both = createPricing({
      enhancementQuotesByItem: { '/items/foo': { 1: { ask: 100, bid: 60 } } },
    });
    expect(resolveAssetItemValue(both, '/items/foo', 1)).toEqual({
      price: 80,
      source: ASSET_SCORE_SOURCES.MARKET_QUOTE,
    });

    const single = createPricing({
      enhancementQuotesByItem: { '/items/foo': { 1: { ask: 100, bid: -1 } } },
    });
    expect(resolveAssetItemValue(single, '/items/foo', 1).price).toBe(100);
  });

  it('③ 无官方估算时使用行情平均成交价 p', () => {
    const pricing = createPricing({
      enhancementQuotesByItem: { '/items/foo': { 1: { ask: -1, bid: -1, averagePrice: 300, volume: 5 } } },
    });
    expect(resolveAssetItemValue(pricing, '/items/foo', 1)).toEqual({
      price: 300,
      source: ASSET_SCORE_SOURCES.MARKET_TRADE,
    });
  });

  it('④ 目标强化等级无行情时走完整模型成本法（基础件/材料可定价）', () => {
    expect(enhanceableEntry).toBeTruthy();
    const pricing = createCostPricing(enhanceableEntry.hrid);
    const cost = computeEnhancedEquipmentCost(pricing, enhanceableEntry.hrid, 2);
    expect(cost.available).toBe(true);
    expect(cost.price).toBeGreaterThan(0);
    const resolved = resolveAssetItemValue(pricing, enhanceableEntry.hrid, 2);
    expect(resolved.source).toBe(ASSET_SCORE_SOURCES.COST);
    expect(resolved.price).toBe(cost.price);
  });

  it('④ 成本法不读手动价格：overrides 字段与合并 priceTable 双通道都不影响资产分', () => {
    expect(enhanceableEntry).toBeTruthy();
    const hrid = enhanceableEntry.hrid;
    const base = createCostPricing(hrid);
    const baseCost = computeEnhancedEquipmentCost(base, hrid, 2);
    expect(baseCost.available).toBe(true);
    expect(baseCost.price).toBeGreaterThan(0);

    // 生产形状（setPriceOverride → applyPriceOverridesToTable / rehydrate）：手动价格
    // 同时落在 pricing.overrides 字段与「烘焙后的合并 priceTable」，且 store 的
    // pricing 恒带干净基表 basePriceTable。资产分必须双通道都不读（2026-08-31 修复）：
    // 通道 A——buildCostModelPricing 出口剔除 overrides：否则模拟器 resolveEnhancementPrice
    //   的 override 短路直接改写材料/保护品取价；
    // 通道 B——resolveQuoteEntry 对 level-0 挂单优先读 basePriceTable：否则合并表里的
    //   手动价格经 fairPriceOf / computeAcquisitionInputPrice 注入成本模型 priceTable，
    //   并经 market_quote 层改写 level-0 估值。
    // 两次调用各自 createCostPricing（所有 pricing 字段引用均不同）→ 缓存失效、真实重算。
    const withOverrides = createCostPricing(hrid);
    const overrideMap = {
      '/items/mirror_of_protection': { ask: 1e12, bid: 1e12 },
      '/items/philosophers_mirror': { ask: 1e12, bid: 1e12 },
      '/items/ultra_enhancing_tea': { ask: 1e12, bid: 1e12 },
      '/items/blessed_tea': { ask: 1e12, bid: 1e12 },
      [hrid]: { ask: 1e12, bid: 1e12 },
    };
    const baseItemHrid = hrid.endsWith('_refined') ? hrid.replace(/_refined$/, '') : hrid;
    const costs = Array.isArray(itemDetailIndex[baseItemHrid]?.enhancementCosts)
      ? itemDetailIndex[baseItemHrid].enhancementCosts
      : itemDetailIndex[hrid]?.enhancementCosts;
    for (const cost of Array.isArray(costs) ? costs : []) {
      const materialHrid = String(cost?.itemHrid || '');
      if (materialHrid && materialHrid !== '/items/coin') {
        overrideMap[materialHrid] = { ask: 1e12, bid: 1e12 };
      }
    }
    // store 同构：基表干净，合并表烘焙手动价（applyPriceOverridesToTable 语义——
    // override 条目直接覆写 ask/bid，基表不含任何手动价格）。
    withOverrides.basePriceTable = withOverrides.priceTable;
    const mergedPriceTable = { ...withOverrides.priceTable };
    for (const [overrideHrid, overrideEntry] of Object.entries(overrideMap)) {
      mergedPriceTable[overrideHrid] = { ask: overrideEntry.ask, bid: overrideEntry.bid };
    }
    withOverrides.priceTable = mergedPriceTable;
    withOverrides.overrides = overrideMap;

    const overrideCost = computeEnhancedEquipmentCost(withOverrides, hrid, 2);
    expect(overrideCost.available).toBe(true);
    expect(overrideCost.price).toBe(baseCost.price);

    // 资产分取价链入口同样不受手动价格影响（COST 来源同价）。
    const resolved = resolveAssetItemValue(withOverrides, hrid, 2);
    expect(resolved.source).toBe(ASSET_SCORE_SOURCES.COST);
    expect(resolved.price).toBe(baseCost.price);

    // 通道 B 直接回归锚点：level-0 通用取价链（房屋材料/技能书/商店货币等）读基表
    // 而非合并表——手动价格不得经 MARKET_QUOTE 来源泄入（通道 B 回归时此处读到 1e12）。
    const levelZero = resolveAssetItemValue(withOverrides, hrid, 0);
    expect(levelZero.source).toBe(ASSET_SCORE_SOURCES.MARKET_QUOTE);
    expect(levelZero.price).toBe(1000);
  });

  // B5 回归锁定：贤者镜双镜流（computePhilosopherEnhancementCost）与普通策略在
  // computeEnhancedEquipmentCost 内的 Math.min 竞争，此前整条集成路径零行为锁定——
  // 变异实验实证：集成回归恒返 0 时全量 1255 项测试仍全部通过。正例构造「双镜流必胜」
  // 行情（基件 10 / 材料 100000 / 镜中价 100）：+2 镜流成本 = 起始件 +0 + 普通 +1 段 + 镜，
  // 远低于普通 0→2 直接强化（两段材料 + 失败重打，材料单价主导）。+2 为最小可判别等级
  // （镜流下限），同时覆盖 targetLevel 档路径（level===targetLevel 时 directPlans 经
  // directPlanCache 命中——2026-09-02 一般-3 改造后与外层 normalCost 共用记忆化单元）。
  it('④ 贤者镜双镜流参与成本竞争：低价镜胜出，成本 = 起始件 + 普通 +1 段 + 镜中价（B5 回归）', () => {
    expect(enhanceableEntry).toBeTruthy();
    const hrid = enhanceableEntry.hrid;
    // 镜单价走 buildCostModelPricing 的 fair 链（官方估算 ?? 挂单中价）：非对称 120/80
    // → 中价 100，同时锁定「取中价而非单边」语义。
    const withMirror = createCostPricing(hrid, { baseAsk: 10, materialAsk: 100000 });
    withMirror.priceTable['/items/philosophers_mirror'] = { ask: 120, bid: 80 };
    const noMirror = createCostPricing(hrid, { baseAsk: 10, materialAsk: 100000 });
    const normalOnly1 = computeEnhancedEquipmentCost(noMirror, hrid, 1).price;
    const normalOnly2 = computeEnhancedEquipmentCost(noMirror, hrid, 2).price;
    expect(normalOnly1).toBeGreaterThan(0);
    expect(normalOnly2).toBeGreaterThan(0);

    const baseItemHrid = hrid.endsWith('_refined') ? hrid.replace(/_refined$/, '') : hrid;
    const basePrice = computeAcquisitionInputPrice(withMirror, baseItemHrid, 0);
    expect(basePrice).toBeGreaterThan(0);
    // 整数守卫：basePrice 带小数时 Math.round 与整数分量相加的交换性破坏，下方精确
    // 断言会以 ±1 误差非诊断性失败——夹具前提破坏应在守卫处清晰报错（第 35 轮③模式）。
    expect(Number.isInteger(basePrice)).toBe(true);
    // 夹具前提守卫（与 DP 胜出条件同式）：镜流 +2 成本 = basePrice + direct1 + 100，
    // 须严格小于普通 0→2 成本 direct2 镜流才胜出。用派生 basePrice 而非硬编码基件价，
    // 数据更新改变起始件获取成本时守卫仍与真实胜出条件一致。
    expect(normalOnly2).toBeGreaterThan(basePrice + normalOnly1 + 100);

    const mirrorCost = computeEnhancedEquipmentCost(withMirror, hrid, 2);
    expect(mirrorCost.available).toBe(true);
    // 精确值 = 起始件获取成本 + 普通强化 +1 段 + 镜中价。refined 件的精炼段常数在
    // normalOnly1 与镜流输出两侧同加相消；basePrice 与镜价均为整数时 Math.round 可交换。
    expect(mirrorCost.price).toBe(basePrice + normalOnly1 + 100);
    expect(mirrorCost.price).toBeLessThan(normalOnly2);
  });

  it('④ 贤者镜高价时双镜流让位：成本等于普通策略值，镜行情不污染普通策略（B5 回归对照）', () => {
    expect(enhanceableEntry).toBeTruthy();
    const hrid = enhanceableEntry.hrid;
    // 表内无贤者镜（缺价）→ 双镜流不可用，成本法保持 available 且等于普通策略值。
    const noMirror = createCostPricing(hrid);
    const normalOnly2 = computeEnhancedEquipmentCost(noMirror, hrid, 2).price;
    expect(normalOnly2).toBeGreaterThan(0);

    // 镜价 1e12 → DP 真实求解但竞争必败：普通策略值不受贤者镜行情污染（防「镜成本被
    // 无条件加总/取 max」类回归——与 Math.min 竞争语义互补的正反两面）。
    const expensiveMirror = createCostPricing(hrid);
    expensiveMirror.priceTable['/items/philosophers_mirror'] = { ask: 1e12, bid: 1e12 };
    const expensiveCost = computeEnhancedEquipmentCost(expensiveMirror, hrid, 2);
    expect(expensiveCost.available).toBe(true);
    expect(expensiveCost.price).toBe(normalOnly2);
  });

  it('④ 市场证据优先：有挂单/成交时不再使用成本模型', () => {
    expect(enhanceableEntry).toBeTruthy();
    const hrid = enhanceableEntry.hrid;
    const modelCost = computeEnhancedEquipmentCost(createCostPricing(hrid), hrid, 1).price;
    expect(modelCost).toBeGreaterThan(0);

    // 挂单存在即用挂单（无论与模型成本差多少——市场证据优先于模型推断）。
    const quoteOnly = createPricing({
      enhancementQuotesByItem: { [hrid]: { 1: { ask: modelCost * 3, bid: modelCost * 3 } } },
    });
    expect(resolveAssetItemValue(quoteOnly, hrid, 1)).toEqual({
      price: modelCost * 3,
      source: ASSET_SCORE_SOURCES.MARKET_QUOTE,
    });

    // 无挂单但有成交记录 → 用成交均价。
    const tradeOnly = createPricing({
      enhancementQuotesByItem: { [hrid]: { 1: { ask: -1, bid: -1, averagePrice: modelCost / 5, volume: 3 } } },
    });
    expect(resolveAssetItemValue(tradeOnly, hrid, 1)).toEqual({
      price: modelCost / 5,
      source: ASSET_SCORE_SOURCES.MARKET_TRADE,
    });
  });

  it('市场证据并存：挂单中价优先于成交均价（钉死 ②>③ 顺序）', () => {
    // 通用取价链（level≥1，挂单与成交同读 per-level 行情）：并存时挂单 (ask+bid)/2 = 80 优先，
    // 成交均价 300 被跳过（doc §3.2 与实现一致；doc §2#7 曾写反，由工作流 C 改写）。
    const both = createPricing({
      enhancementQuotesByItem: { '/items/foo': { 1: { ask: 100, bid: 60, averagePrice: 300, volume: 5 } } },
    });
    expect(resolveAssetItemValue(both, '/items/foo', 1)).toEqual({
      price: 80,
      source: ASSET_SCORE_SOURCES.MARKET_QUOTE,
    });

    // 装备降级链对照（2026-08-31 复审防坑：resolveQuoteEntry 按 level 分源——level=0 读
    // priceTable，成交均价恒读 enhancementQuotesByItem）：挂单放 priceTable、成交放 per-level 表。
    const equipmentBoth = createPricing({
      priceTable: { '/items/foo': { ask: 100, bid: 60 } },
      enhancementQuotesByItem: { '/items/foo': { 0: { ask: -1, bid: -1, averagePrice: 300, volume: 5 } } },
    });
    expect(resolveEquipmentAssetValue(equipmentBoth, '/items/foo', 0)).toEqual({
      price: 80,
      source: ASSET_SCORE_SOURCES.MARKET_QUOTE,
    });
  });

  it('⑥ 无任何行情时兜底到商店售价，未知物品返回 missing', () => {
    expect(vendorOnlyEntry).toBeTruthy();
    const pricing = createPricing();
    expect(resolveAssetItemValue(pricing, vendorOnlyEntry.hrid, 0)).toEqual({
      price: Number(vendorOnlyEntry.sellPrice),
      source: ASSET_SCORE_SOURCES.VENDOR,
    });
    expect(resolveAssetItemValue(pricing, '/items/__nonexistent__', 0)).toEqual({
      price: 0,
      source: ASSET_SCORE_SOURCES.MISSING,
    });
  });

  it('⑤ 不可交易信用点按捐献获取成本兜底（每点 = 一批材料总价 ÷ creditCount）', () => {
    const allConversions = Object.values(itemDetailMap).flatMap((item) =>
      Array.isArray(item?.guildCreditConversions)
        ? item.guildCreditConversions
            .filter((conversion) => conversion?.creditItemHrid && item?.hrid)
            .map((conversion) => ({
              creditItemHrid: conversion.creditItemHrid,
              sourceHrid: item.hrid,
              itemCount: Number(conversion.itemCount),
              creditCount: Number(conversion.creditCount),
            }))
        : [],
    );
    expect(allConversions.length).toBeGreaterThan(0);
    const creditItemHrid = allConversions[0].creditItemHrid;
    // 公会令牌被排除（其价值源自信用点，会造成循环估值）。
    const sources = allConversions.filter(
      (entry) => entry.creditItemHrid === creditItemHrid && entry.sourceHrid !== '/items/guild_token',
    );
    expect(sources.length).toBeGreaterThan(0);
    // 所有来源材料统一挂单价 1000：每点成本 = 1000 × min(itemCount / creditCount)。
    // ⑤ 出口保留小数不取整（#32：Math.round 曾把 <0.5/点的路线塌缩为 0），断言随之
    // 不做取整（pirate_essence 2→3 路线 = 666.67/点这类非整数路线为真实 min 候选）。
    const priceTable = {};
    for (const source of sources) {
      priceTable[source.sourceHrid] = { ask: 1000, bid: 1000 };
    }
    const pricing = createPricing({ priceTable });
    const resolved = resolveAssetItemValue(pricing, creditItemHrid, 0);
    const expectedUnitCost = Math.min(...sources.map((source) => (1000 * source.itemCount) / source.creditCount));
    expect(resolved.source).toBe(ASSET_SCORE_SOURCES.ACQUISITION);
    expect(resolved.price).toBeCloseTo(expectedUnitCost, 9);
  });

  it('⑤ 公会令牌价值 = 兑换信用点路线的最大单位价值', () => {
    const pricing = createPricing({
      marketItemValues: {
        '/items/brown_guild_credit': { 0: 1000 },
        '/items/purple_guild_credit': { 0: 5000 },
      },
    });
    // 1 token = 10 brown credit（1000×10/1 = 10000）；1 token = 1 purple credit（5000）→ 取 max。
    expect(computeGuildTokenValue(pricing)).toBe(10000);
    // 无行情时信用点仍可经来源材料 vendor 售价兜底，令牌价值为正。
    expect(computeGuildTokenValue(createPricing())).toBeGreaterThan(0);
  });

  it('⑤ 单位成本保留小数不取整：来源 vendor 兜底的亚整数路线不得塌零（#32 回归）', () => {
    // 动态定位「卖店价换算单位成本最小」的捐献路线（现数据为 brown credit 的
    // pathbreaker/pathfinder/pathseeker_lodestone：卖店 1000 金捐得 6000 点 ≈ 0.167/点）。
    // 空行情下来源材料经 ⑥ vendor 兜底全部可定价（112/112 有卖店价，逐项核验
    // 2026-09-01），min 单位成本即 vendor 基最小值。#32 复审前 Math.round 曾把该
    // 亚整数塌缩为 0（{price:0, source:'acquisition'} 自相矛盾态）→ 神龛 brown 成本
    // 被误判缺价、行挂虚假 incomplete——锁定出口保留小数（MWITools 同为小数）。
    let target = null;
    for (const item of Object.values(itemDetailMap)) {
      const sellPrice = Number(item?.sellPrice || 0);
      if (!(sellPrice > 0)) continue;
      for (const conversion of Array.isArray(item?.guildCreditConversions) ? item.guildCreditConversions : []) {
        const itemCount = Number(conversion?.itemCount || 0);
        const creditCount = Number(conversion?.creditCount || 0);
        if (!conversion?.creditItemHrid || itemCount <= 0 || creditCount <= 0) continue;
        const unitCost = (sellPrice * itemCount) / creditCount;
        if (!target || unitCost < target.unitCost) {
          target = { creditItemHrid: String(conversion.creditItemHrid), unitCost };
        }
      }
    }
    // 前提守卫：用例语义依赖真实数据存在亚整数单位成本路线（数据更新后若不再成立，
    // 本用例失效点应落在此行而非断言本身）。
    expect(target).toBeTruthy();
    expect(target.unitCost).toBeLessThan(0.5);
    const resolved = resolveAssetItemValue(createPricing(), target.creditItemHrid, 0);
    expect(resolved.source).toBe(ASSET_SCORE_SOURCES.ACQUISITION);
    expect(resolved.price).toBeCloseTo(target.unitCost, 9);
    expect(resolved.price).toBeGreaterThan(0);
  });

  it('装备估值：官方估算与强化成本偏差≤20%用估算，>20%信成本法（MWITools 同款择优）', () => {
    expect(enhanceableEntry).toBeTruthy();
    const hrid = enhanceableEntry.hrid;
    const modelCost = computeEnhancedEquipmentCost(createCostPricing(hrid), hrid, 1).price;
    expect(modelCost).toBeGreaterThan(0);

    // 守卫已开启（成本法输入按获取成本定价 + 理想玩家策略枚举，量级与官方估算一致）：
    // 偏差 10%（≤20%）采用官方估算；偏差 100%（>20%）信成本法（MWITools 同款择优）。
    const near = createCostPricing(hrid);
    near.marketItemValues = { [hrid]: { 1: modelCost * 1.1 } };
    expect(resolveEquipmentAssetValue(near, hrid, 1, 'weapon')).toEqual({
      price: modelCost * 1.1,
      source: ASSET_SCORE_SOURCES.OFFICIAL_ESTIMATE,
    });

    const far = createCostPricing(hrid);
    far.marketItemValues = { [hrid]: { 1: modelCost * 2 } };
    expect(resolveEquipmentAssetValue(far, hrid, 1, 'weapon')).toEqual({
      price: modelCost,
      source: ASSET_SCORE_SOURCES.COST,
    });

    // 成本法输入无官方估算、无制作渠道时不可算（获取成本为 0 且无挂单材料），退回官方估算。
    const costUnavailable = createPricing({
      marketItemValues: { [hrid]: { 1: 500 } },
      enhancementQuotesByItem: {},
    });
    const fallback = resolveEquipmentAssetValue(costUnavailable, hrid, 1, 'weapon');
    expect(fallback.source).toBe(ASSET_SCORE_SOURCES.OFFICIAL_ESTIMATE);
    expect(fallback.price).toBe(500);

    // 无官方估算（未透传）时按通用链降级：挂单优先于成本法。
    const noFair = createCostPricing(hrid);
    expect(resolveEquipmentAssetValue(noFair, hrid, 1, 'weapon').source).toBe(ASSET_SCORE_SOURCES.COST);
    const quoteFallback = createPricing({
      enhancementQuotesByItem: { [hrid]: { 1: { ask: 700, bid: 700 } } },
    });
    expect(resolveEquipmentAssetValue(quoteFallback, hrid, 1, 'weapon')).toEqual({
      price: 700,
      source: ASSET_SCORE_SOURCES.MARKET_QUOTE,
    });
  });
});

describe('computeEnhancedEquipmentCost 结果记忆化（U2+G2）', () => {
  it('同入参重复调用返回同一结果对象（缓存命中）', () => {
    expect(enhanceableEntry).toBeTruthy();
    const pricing = createCostPricing(enhanceableEntry.hrid);
    const first = computeEnhancedEquipmentCost(pricing, enhanceableEntry.hrid, 2);
    const second = computeEnhancedEquipmentCost(pricing, enhanceableEntry.hrid, 2);
    expect(first.available).toBe(true);
    // 命中缓存：共享同一结果对象（消费方只读约定下的性能语义）。
    expect(second).toBe(first);
  });

  it('pricing 任一消费字段替换后缓存失效重算（marketItemValues/priceTable/enhancementQuotesByItem）', () => {
    expect(enhanceableEntry).toBeTruthy();
    const hrid = enhanceableEntry.hrid;
    const base = createCostPricing(hrid);
    const first = computeEnhancedEquipmentCost(base, hrid, 2);
    expect(first.available).toBe(true);

    // ① marketItemValues 替换 → 失效重算（官方估算参与材料/起始件公平价）。
    const officialSwapped = { ...base, marketItemValues: { [hrid]: { 2: first.price / 2 } } };
    expect(computeEnhancedEquipmentCost(officialSwapped, hrid, 2)).not.toBe(first);

    // ② priceTable 替换 → 失效重算，数值跟随新数据（起始件挂单价 ×3 → 成本显著上升）。
    const tableSwapped = createCostPricing(hrid, { baseAsk: 3000 });
    const third = computeEnhancedEquipmentCost(tableSwapped, hrid, 2);
    expect(third).not.toBe(first);
    expect(third.price).toBeGreaterThan(first.price);

    // ③ enhancementQuotesByItem 替换 → 失效重算（入指纹守护「引用替换」约定的失效面）。
    const quotesSwapped = { ...base, enhancementQuotesByItem: { [hrid]: { 2: { ask: 1, bid: 1 } } } };
    expect(computeEnhancedEquipmentCost(quotesSwapped, hrid, 2)).not.toBe(first);
  });

  it('protection/lessResource/depth 不同入参各自独立缓存（depth 必须入键）', () => {
    expect(enhanceableEntry).toBeTruthy();
    const hrid = enhanceableEntry.hrid;
    const pricing = createCostPricing(hrid);
    const plain = computeEnhancedEquipmentCost(pricing, hrid, 2);
    const withProtection = computeEnhancedEquipmentCost(pricing, hrid, 2, 0, {
      protectionItemHrid: '/items/mirror_of_protection',
    });
    const withLessResource = computeEnhancedEquipmentCost(pricing, hrid, 2, 0, { refinementLessResource: 0.1 });
    const withDepth = computeEnhancedEquipmentCost(pricing, hrid, 2, 1);
    // 各键独立计算：四个不同键得四个独立结果对象，互不串缓存。
    expect(new Set([plain, withProtection, withLessResource, withDepth]).size).toBe(4);
    // 同键重复调用仍命中。
    expect(computeEnhancedEquipmentCost(pricing, hrid, 2)).toBe(plain);
    expect(
      computeEnhancedEquipmentCost(pricing, hrid, 2, 0, { protectionItemHrid: '/items/mirror_of_protection' }),
    ).toBe(withProtection);
  });

  it('缓存达到上限后整表清空（超限插入清除全部旧键——非 LRU、非不逐出）', () => {
    // depth=2 命中 uncached 的深度短路（恒返 unavailable、不读行情内容），LIMIT+1 次
    // 调用开销可忽略；键以 itemHrid 区分（键五要素的其余四要素恒定）。pricing 用空
    // createPricing()——本用例只需引用同一性、不依赖任何动态夹具（防夹具缺失型 TypeError）。
    // 上限值从生产导出直取，常量调整时测试自动跟随（防字面值漂移，同 #32 常量导出先例）。
    const pricing = createPricing();
    const middleIndex = Math.floor(COST_RESULT_CACHE_LIMIT / 2);
    const probe = (index) => computeEnhancedEquipmentCost(pricing, `/items/__cache_probe_${index}`, 1, 2);
    const first = probe(0);
    const middle = probe(middleIndex);
    for (let i = 1; i < COST_RESULT_CACHE_LIMIT; i += 1) {
      probe(i);
    }
    // 恰好 LIMIT 个键：首键与中间键均命中缓存（同一结果对象）。
    expect(probe(0)).toBe(first);
    expect(probe(middleIndex)).toBe(middle);
    // 第 LIMIT+1 个新键触发整表清空：首键与中间键一并被逐出（重算产生新对象）——
    // LRU 逐出只会逐出最旧的 probe(0)、保留中间键，「整表清空」由此与 LRU 区分。
    const overflow = probe(COST_RESULT_CACHE_LIMIT);
    expect(probe(0)).not.toBe(first);
    expect(probe(middleIndex)).not.toBe(middle);
    // 清空后缓存继续工作：溢出键仍命中。
    expect(probe(COST_RESULT_CACHE_LIMIT)).toBe(overflow);
  });
});

describe('computePlayerAssetScore 四分项聚合', () => {
  it('无任何资产数据时返回 null', () => {
    expect(computePlayerAssetScore(createEmptyPlayerConfig(1), createPricing())).toBeNull();
    expect(computePlayerAssetScore(null, createPricing())).toBeNull();
  });

  it('装备分项：按取价链计价并保留来源标记', () => {
    expect(enhanceableEntry).toBeTruthy();
    const player = createEmptyPlayerConfig(1);
    player.equipment.weapon = { itemHrid: enhanceableEntry.hrid, enhancementLevel: 0 };
    const result = computePlayerAssetScore(player, createPricing());
    expect(result).not.toBeNull();
    expect(result.items.equipment).toHaveLength(1);
    expect(result.items.equipment[0]).toMatchObject({
      slotKey: 'weapon',
      itemHrid: enhanceableEntry.hrid,
      source: ASSET_SCORE_SOURCES.VENDOR,
    });
    expect(result.sections.equipment).toBe(Number(enhanceableEntry.sellPrice));
    expect(result.total).toBeCloseTo(Number(enhanceableEntry.sellPrice) / 1_000_000, 5);
    // 快照携带当前配置签名（行情不可用时 store 守卫据此判断保留或重算）。
    expect(result.configSignature).toBe(computeAssetScoreConfigSignature(player));
  });

  it('房屋/神龛/技能书分项：有数据即聚合，参考数据缺失不崩溃', () => {
    expect(combatRoomEntry).toBeTruthy();
    // combatGuildBuffHrids 同为数据派生动态夹具（guildBuffDetailMap 过滤 isCombat），
    // 其缺失时神龛行静默为空、失败定位在 toHaveLength 而非夹具本身——就地守卫防漂移。
    expect(combatGuildBuffHrids[0]).toBeTruthy();
    const player = createEmptyPlayerConfig(1);
    player.houseRooms[combatRoomEntry.hrid] = 1;
    player.guildBuffs[combatGuildBuffHrids[0]] = 1;
    const result = computePlayerAssetScore(player, createPricing());
    expect(result).not.toBeNull();
    expect(result.items.houseRooms).toHaveLength(1);
    expect(result.items.shrine).toHaveLength(1);
    expect(result.sections.house).toBeGreaterThanOrEqual(0);
    expect(result.sections.shrine).toBeGreaterThanOrEqual(0);
    // incomplete 生成端直接断言（此前仅 sanitize 端透传有用例）。房屋：材料全部有
    // vendor 卖店价（逐项核验 2026-09-01），空行情下经 ⑥ 兜底全部可得 → 行完整（false）。
    expect(result.items.houseRooms[0].incomplete).toBe(false);
    // 神龛：force_combat 的信用点成本含 brown_guild_credit。第 35 轮曾断言空行情下
    // incomplete=true，归因为「捐献来源全部无卖店价」——#32 复审核验该归因不成立
    //（112/112 来源有卖店价，逐项核验 2026-09-01），真因是 ⑤ 出口 Math.round 把
    // lodestone 路线（1000÷6000 ≈ 0.167/点）塌缩为 0、信用点被误判缺价；塌零修复后
    // 八种信用点空行情下均经 ⑥ vendor 兜底取得正价 → 行完整（false）。「信用点缺价」
    // 分支随之退化为防御分支（与上方房屋材料同判），tooltip 缺失标注的生成路径由
    // 技能书「参考数据缺失」用例（未知 abilityHrid）继续锁定。
    expect(result.items.shrine[0].incomplete).toBe(false);
    // 正对照（语义保持）：给 brown_guild_credit 注入行情后神龛行同样完整（false）——
    // 锁定「① 级估算命中时缺失标注同样消除」。
    const pricedBrown = computePlayerAssetScore(
      player,
      createPricing({ marketItemValues: { '/items/brown_guild_credit': { 0: 100 } } }),
    );
    expect(pricedBrown.items.shrine[0].incomplete).toBe(false);
  });

  it('技能书 incomplete 生成路径：参考数据缺失 → 行挂 incomplete 且分项为 0', () => {
    // 未知 abilityHrid 命中 abilityBookInvestment 的参考数据缺失分支（书本信息缺失 →
    // value 0 + incomplete true）——生成端 incomplete 不依赖行情注入的确定性触达分支
    // （神龛/房屋的缺价分支经 #32 塌零修复后均属防御分支：八种信用点与房屋材料的
    // 输入空行情下均可经 ⑥ vendor 兜底定价，见聚合用例注释）。tooltip 缺失标注消费
    // 该字段。
    const player = createEmptyPlayerConfig(1);
    player.abilities = [{ abilityHrid: '/abilities/__not_in_data__', level: 1 }];
    const result = computePlayerAssetScore(player, createPricing());
    expect(result).not.toBeNull();
    expect(result.items.abilities).toHaveLength(1);
    expect(result.items.abilities[0]).toMatchObject({
      abilityHrid: '/abilities/__not_in_data__',
      value: 0,
      incomplete: true,
    });
    expect(result.sections.abilities).toBe(0);
  });
});

describe('格式化与载荷校验', () => {
  it('formatAssetScoreLabel / formatAssetScoreGold / formatScoreValue', () => {
    // MWITools formatScore 口径：>100 四舍五入整数+千分位；≤100 一位小数；无 M 后缀。
    expect(formatScoreValue(45.2)).toBe('45.2');
    expect(formatScoreValue(99.9)).toBe('99.9');
    // >100 即四舍五入（100.4 > 100 → 100），分界与 MWITools 严格一致。
    expect(formatScoreValue(100.4)).toBe('100');
    expect(formatScoreValue(100.9)).toBe('101');
    expect(formatScoreValue(9505.4)).toBe('9,505');
    expect(formatScoreValue(1354.5)).toBe('1,355');
    expect(formatScoreValue(0)).toBe('0.0');
    expect(formatAssetScoreLabel({ total: 45.2 })).toBe('45.2');
    expect(formatAssetScoreLabel({ total: 9505.4 })).toBe('9,505');
    // 合计优先用 totalGold 换算后一次舍入（浮点总分舍入），镜像 MWITools 展示层舍入语义。
    expect(formatAssetScoreLabel({ total: 9533.9, totalGold: 9_533_900_000 })).toBe('9,534');
    expect(formatAssetScoreGold(45_200_000)).toBe('45.2');
    expect(formatAssetScoreGold(320_000_000)).toBe('320');
    expect(formatAssetScoreGold(460_700_000)).toBe('461');
    expect(formatAssetScoreGold(1_354_500_000)).toBe('1,355');
    expect(formatAssetScoreGold(172_800_000)).toBe('173');
    expect(formatAssetScoreGold(7_545_900_000)).toBe('7,546');
    expect(formatAssetScoreGold(123_456)).toBe('0.1');
    expect(formatAssetScoreGold(0)).toBe('0');
  });

  it('sanitizeAssetScorePayload：合法保留、非法丢弃', () => {
    const valid = {
      version: 1,
      total: 45.2,
      totalGold: 45_200_000,
      sections: { equipment: 1, house: 2, abilities: 3, shrine: 4 },
      items: { equipment: [], houseRooms: [], abilities: [], shrine: [] },
      computedAt: 123,
    };
    expect(sanitizeAssetScorePayload(valid)).toEqual(valid);
    // 配置签名：非空字符串透传；无签名字段/空白签名时不添加该键（旧格式载荷形状不变）。
    expect(sanitizeAssetScorePayload({ ...valid, configSignature: 'v1:["sig"]' })).toEqual({
      ...valid,
      configSignature: 'v1:["sig"]',
    });
    expect(Object.keys(sanitizeAssetScorePayload(valid))).not.toContain('configSignature');
    expect(sanitizeAssetScorePayload({ ...valid, configSignature: '   ' })).toEqual(valid);
    expect(sanitizeAssetScorePayload({ ...valid, version: 2 })).toBeNull();
    expect(sanitizeAssetScorePayload(null)).toBeNull();
    expect(sanitizeAssetScorePayload({ total: 'x' })).toBeNull();
  });

  it('sanitizeAssetScorePayload：items 元素按行白名单归一（未知字段丢弃、数值归一）', () => {
    const base = {
      version: 1,
      total: 1,
      totalGold: 1_000_000,
      sections: { equipment: 1_000_000, house: 0, abilities: 0, shrine: 0 },
      items: {
        equipment: [
          {
            slotKey: 'weapon',
            itemHrid: '/items/foo',
            enhancementLevel: '1',
            value: '123',
            source: 'official_estimate',
            hack: 'x',
          },
        ],
        houseRooms: [],
        abilities: [],
        shrine: [],
      },
      computedAt: 1,
    };
    const sanitized = sanitizeAssetScorePayload(base);
    // 输出行仅含白名单 5 字段：字符串数值归一为数字、未知字段丢弃。
    expect(sanitized.items.equipment).toEqual([
      { slotKey: 'weapon', itemHrid: '/items/foo', enhancementLevel: 1, value: 123, source: 'official_estimate' },
    ]);
  });

  it('sanitizeAssetScorePayload：装备行强化等级钳到游戏上限 20（超限/负数/小数）', () => {
    const base = {
      version: 1,
      total: 1,
      totalGold: 1_000_000,
      sections: { equipment: 0, house: 0, abilities: 0, shrine: 0 },
      items: {
        equipment: [
          { slotKey: 'weapon', itemHrid: '/items/a', enhancementLevel: 999, value: 1, source: 'vendor' },
          { slotKey: 'head', itemHrid: '/items/b', enhancementLevel: 20, value: 2, source: 'vendor' },
          { slotKey: 'offhand', itemHrid: '/items/c', enhancementLevel: -3, value: 3, source: 'vendor' },
          { slotKey: 'trinket', itemHrid: '/items/d', enhancementLevel: 20.7, value: 4, source: 'vendor' },
        ],
        houseRooms: [],
        abilities: [],
        shrine: [],
      },
      computedAt: 1,
    };
    const sanitized = sanitizeAssetScorePayload(base);
    // 超限值钳到游戏上限 20（与成本法内部钳制一致，行元数据 +N 与计价不再背离）；
    // 合法 20 原样保留；负数钳 0；小数向下取整。
    expect(sanitized.items.equipment.map((row) => row.enhancementLevel)).toEqual([20, 20, 0, 20]);
  });

  it('sanitizeAssetScorePayload：非法元素剔除、合法元素保留（不整体丢弃）', () => {
    const base = {
      version: 1,
      total: 1,
      totalGold: 1_000_000,
      sections: { equipment: 0, house: 0, abilities: 0, shrine: 0 },
      items: {
        equipment: [
          null,
          'junk',
          42,
          { itemHrid: '' },
          { slotKey: 'weapon', itemHrid: '/items/keep', enhancementLevel: 0, value: 5, source: 'vendor' },
        ],
        houseRooms: [null, { roomHrid: '/rooms/keep', level: 1, value: 2, incomplete: false }],
        abilities: [],
        shrine: [],
      },
      computedAt: 1,
    };
    const sanitized = sanitizeAssetScorePayload(base);
    expect(sanitized.items.equipment).toHaveLength(1);
    expect(sanitized.items.equipment[0].itemHrid).toBe('/items/keep');
    expect(sanitized.items.houseRooms).toHaveLength(1);
    expect(sanitized.items.houseRooms[0].roomHrid).toBe('/rooms/keep');
  });

  it('sanitizeAssetScorePayload：恶意膨胀元素被归一为小行、超限个数被截断', () => {
    const huge = { itemHrid: '/items/big' };
    for (let i = 0; i < 200; i += 1) {
      huge[`pad${i}`] = 'x'.repeat(1000);
    }
    const row = (index) => ({
      slotKey: 'weapon',
      itemHrid: `/items/many_${index}`,
      enhancementLevel: 0,
      value: 1,
      source: 'vendor',
    });
    const base = {
      version: 1,
      total: 1,
      totalGold: 1_000_000,
      sections: { equipment: 0, house: 0, abilities: 0, shrine: 0 },
      items: {
        equipment: [huge, ...Array.from({ length: 25 }, (_, i) => row(i))],
        houseRooms: [],
        abilities: [],
        shrine: [],
      },
      computedAt: 1,
    };
    const sanitized = sanitizeAssetScorePayload(base);
    // 膨胀元素归一为 ≤5 个标量字段的行（pad* 键全部丢弃）。
    expect(sanitized.items.equipment[0]).toEqual({
      slotKey: '',
      itemHrid: '/items/big',
      enhancementLevel: 0,
      value: 0,
      source: ASSET_SCORE_SOURCES.MISSING,
    });
    // 超出白名单上限（20）的个数截断。
    expect(sanitized.items.equipment).toHaveLength(20);
  });

  it('sanitizeAssetScorePayload：source 非法值降级为 missing', () => {
    const base = {
      version: 1,
      total: 1,
      totalGold: 1_000_000,
      sections: { equipment: 0, house: 0, abilities: 0, shrine: 0 },
      items: {
        equipment: [
          { slotKey: 'weapon', itemHrid: '/items/foo', enhancementLevel: 0, value: 9, source: 'hacked_source' },
        ],
        houseRooms: [],
        abilities: [],
        shrine: [],
      },
      computedAt: 1,
    };
    expect(sanitizeAssetScorePayload(base).items.equipment[0].source).toBe(ASSET_SCORE_SOURCES.MISSING);
  });

  it('sanitizeAssetScorePayload：保留 incomplete 字段（tooltip 缺失标注依赖）；items/sections 失配仍放行', () => {
    const base = {
      version: 1,
      total: 1,
      totalGold: 1_000_000,
      // 失配：sections 全 0 而 items 有行——sanitize 只做形状归一，不做一致性校验（快照语义）。
      sections: { equipment: 0, house: 0, abilities: 0, shrine: 0 },
      items: {
        equipment: [],
        houseRooms: [{ roomHrid: '/rooms/x', level: 1, value: 0, incomplete: true }],
        abilities: [{ abilityHrid: '/abilities/x', level: 1, bookItemHrid: '/items/x', value: 0, incomplete: true }],
        shrine: [{ guildBuffHrid: '/guild_buffs/x', level: 1, value: 0, incomplete: true }],
      },
      computedAt: 1,
    };
    const sanitized = sanitizeAssetScorePayload(base);
    expect(sanitized.items.houseRooms[0].incomplete).toBe(true);
    expect(sanitized.items.abilities[0].incomplete).toBe(true);
    expect(sanitized.items.shrine[0].incomplete).toBe(true);
    expect(sanitized.items.houseRooms).toHaveLength(1);
    // 旧快照缺 incomplete 字段时归一为 false（UI optional chaining 容错已有）。
    const legacy = sanitizeAssetScorePayload({
      ...base,
      items: { ...base.items, houseRooms: [{ roomHrid: '/rooms/x', level: 1, value: 0 }] },
    });
    expect(legacy.items.houseRooms[0].incomplete).toBe(false);
  });

  it('assetScoreEquals 忽略 computedAt，避免重算守卫误判', () => {
    const base = {
      version: 1,
      total: 1,
      totalGold: 1_000_000,
      sections: { equipment: 1_000_000, house: 0, abilities: 0, shrine: 0 },
      items: { equipment: [], houseRooms: [], abilities: [], shrine: [] },
    };
    expect(assetScoreEquals({ ...base, computedAt: 1 }, { ...base, computedAt: 2 })).toBe(true);
    expect(assetScoreEquals(base, { ...base, total: 2, totalGold: 2_000_000 })).toBe(false);
    expect(assetScoreEquals(null, null)).toBe(true);
    expect(assetScoreEquals(base, null)).toBe(false);
  });
});

describe('computeAssetScoreConfigSignature 配置签名', () => {
  it('相同配置生成相同签名；影响资产分的输入变化时签名变化', () => {
    // 就地守卫（同取价链用例惯例）：动态夹具随游戏数据选取，数据变更导致夹具缺失时
    // 给出清晰失败而非 -t 过滤运行下的 TypeError。
    expect(vendorOnlyEntry).toBeTruthy();
    expect(combatRoomEntry).toBeTruthy();
    expect(enhanceableEntry).toBeTruthy();
    const buildPlayer = () => {
      const player = createEmptyPlayerConfig(1);
      player.equipment.weapon = { itemHrid: vendorOnlyEntry.hrid, enhancementLevel: 0 };
      player.houseRooms[combatRoomEntry.hrid] = 1;
      return player;
    };
    // 稳定：同配置（重建的等价对象）签名一致。
    expect(computeAssetScoreConfigSignature(buildPlayer())).toBe(computeAssetScoreConfigSignature(buildPlayer()));

    const base = computeAssetScoreConfigSignature(buildPlayer());

    // 强化等级变化 → 签名变化。
    const leveledUp = buildPlayer();
    leveledUp.equipment.weapon.enhancementLevel = 1;
    expect(computeAssetScoreConfigSignature(leveledUp)).not.toBe(base);

    // 装备物品变化 → 签名变化。
    const swapped = createEmptyPlayerConfig(1);
    swapped.equipment.weapon = { itemHrid: enhanceableEntry.hrid, enhancementLevel: 0 };
    swapped.houseRooms[combatRoomEntry.hrid] = 1;
    expect(computeAssetScoreConfigSignature(swapped)).not.toBe(base);

    // 房屋等级变化 → 签名变化。
    const houseDowngraded = buildPlayer();
    houseDowngraded.houseRooms[combatRoomEntry.hrid] = 0;
    expect(computeAssetScoreConfigSignature(houseDowngraded)).not.toBe(base);

    // 工匠茶（精炼折扣输入）变化 → 签名变化。
    const withTea = buildPlayer();
    withTea.craftingTeaSlots = { cooking: ['/items/artisan_tea'] };
    expect(computeAssetScoreConfigSignature(withTea)).not.toBe(base);

    // 非工匠茶（不影响精炼折扣，非资产分输入）变化 → 签名不变。
    const withOtherTea = buildPlayer();
    withOtherTea.craftingTeaSlots = { cooking: ['/items/cooking_tea'] };
    expect(computeAssetScoreConfigSignature(withOtherTea)).toBe(base);
  });

  it('非战斗房间与未知房间不进入签名（与 compute 战斗房间过滤对齐，一般-4）', () => {
    const nonCombatRoomEntry = Object.values(houseRoomDetailMap).find(
      (room) => room?.usableInActionTypeMap?.['/action_types/combat'] !== true && String(room?.hrid || ''),
    );
    expect(combatRoomEntry).toBeTruthy();
    expect(nonCombatRoomEntry).toBeTruthy();
    const buildPlayer = () => {
      const player = createEmptyPlayerConfig(1);
      player.equipment.weapon = { itemHrid: vendorOnlyEntry.hrid, enhancementLevel: 0 };
      player.houseRooms[combatRoomEntry.hrid] = 1;
      return player;
    };
    const base = computeAssetScoreConfigSignature(buildPlayer());

    // 新增/升级非战斗房间（厨房等生产房间）→ 非资产分输入 → 签名不变：行情不可用
    // 守卫（simulatorStore refreshAssetScores）据此保留仍有效的快照，App.vue 重算
    // 触发器也不会被非战斗房间编辑空触发。
    const withNonCombatRoom = buildPlayer();
    withNonCombatRoom.houseRooms[nonCombatRoomEntry.hrid] = 3;
    expect(computeAssetScoreConfigSignature(withNonCombatRoom)).toBe(base);

    // 未知房间 hrid（houseRoomDetailMap 查不到）→ compute 消费不到 → 签名同样不变。
    const withUnknownRoom = buildPlayer();
    withUnknownRoom.houseRooms['/house_rooms/unknown_room'] = 2;
    expect(computeAssetScoreConfigSignature(withUnknownRoom)).toBe(base);

    // 对照：战斗房间变化仍必须变签名（覆盖收窄不误伤战斗房间追踪）。
    const withCombatRoomUpgraded = buildPlayer();
    withCombatRoomUpgraded.houseRooms[combatRoomEntry.hrid] = 2;
    expect(computeAssetScoreConfigSignature(withCombatRoomUpgraded)).not.toBe(base);
  });

  it('忽略与资产分无关的配置差异（名称/等级/食物/饮品/成就）', () => {
    expect(vendorOnlyEntry).toBeTruthy();
    const player = createEmptyPlayerConfig(1);
    player.equipment.weapon = { itemHrid: vendorOnlyEntry.hrid, enhancementLevel: 0 };
    const other = createEmptyPlayerConfig(1);
    other.equipment.weapon = { itemHrid: vendorOnlyEntry.hrid, enhancementLevel: 0 };
    other.name = 'Renamed Hero';
    other.levels.melee = 90;
    other.food = ['/items/food_attack_dex_5', '', ''];
    other.achievements = { '/achievements/total_level_100': 1 };
    expect(computeAssetScoreConfigSignature(other)).toBe(computeAssetScoreConfigSignature(player));
  });

  it('排序确定性：houseRooms 键序与 abilities 数组顺序不同 → 签名相同', () => {
    expect(combatRoomEntry).toBeTruthy();
    // 签名目标之一是「忽略声明顺序/槽位重排噪音」（见 computeAssetScoreConfigSignature
    // 注释）；本用例锁定排序器确定性，防未来回归为依赖声明顺序或区域设置的比较。
    const combatRoomHrids = Object.values(houseRoomDetailMap)
      .filter((room) => room?.usableInActionTypeMap?.['/action_types/combat'] === true)
      .map((room) => String(room?.hrid || ''))
      .filter(Boolean);
    const roomA = combatRoomEntry.hrid;
    // 显式选另一个战斗房间：签名只覆盖战斗房间，若误取非战斗房间本用例会退化为平凡相等。
    const roomB = combatRoomHrids.find((hrid) => hrid !== roomA) ?? roomA;

    const first = createEmptyPlayerConfig(1);
    first.abilities = [
      { abilityHrid: '/abilities/speed_aura', level: 3 },
      { abilityHrid: '/abilities/blaze', level: 2 },
      { abilityHrid: '/abilities/aqua_arrow', level: 1 },
    ];
    first.houseRooms = { [roomB]: 1, [roomA]: 2 };

    const second = createEmptyPlayerConfig(1);
    second.abilities = [
      { abilityHrid: '/abilities/aqua_arrow', level: 1 },
      { abilityHrid: '/abilities/speed_aura', level: 3 },
      { abilityHrid: '/abilities/blaze', level: 2 },
    ];
    second.houseRooms = { [roomA]: 2, [roomB]: 1 };

    expect(computeAssetScoreConfigSignature(second)).toBe(computeAssetScoreConfigSignature(first));
  });
});

describe('computeShopCurrencyValue 商店货币估值（第 15 轮）', () => {
  it('取「花掉令牌」的最优兑换率（非 1:1 essence 路线）', () => {
    const pricing = createPricing({
      marketItemValues: {
        '/items/enchanted_essence': { 0: 1000 },
        '/items/royal_cloth': { 0: 2_600_000 },
      },
    });
    // essence 1:1 → 1000/token；royal_cloth 2000 token/个 → 1300/token；取 max = 1300。
    expect(computeShopCurrencyValue(pricing, '/items/enchanted_token')).toBe(1300);
  });

  it('无行情时奖励按 vendor 卖店价兜底（essence 1:1 → 500/token，MWITools 同款）', () => {
    expect(computeShopCurrencyValue(createPricing(), '/items/enchanted_token')).toBe(500);
  });

  it('coin 由调用方计价为 1，空 hrid 返回 0', () => {
    expect(computeShopCurrencyValue(createPricing(), '/items/coin')).toBe(0);
    expect(computeShopCurrencyValue(createPricing(), '')).toBe(0);
  });
});

describe('computeShopCurrencyValue 防兑换环（A2 修复：visiting 接线）', () => {
  it('真实三表数据零「奖励为商店货币」条目——环递归分支不可达的数据前提（哨兵）', () => {
    expect(listShopCurrencyRewardEntries()).toEqual([]);
  });

  it('令牌→令牌环：环上条目按 0 计、取非环路线最优值、递归终止（mock 商店表）', async () => {
    // mock 宇宙：e1: 100 token_a → 50 token_b（环边 a→b）；e2: 80 token_b → 40 token_a
    //（环边 b→a）；e3: 1 token_b → 3 cycle_essence（token_b 的非环真实路线）。
    // token_a 带官方估算 999：若奖励令牌误走通用取价链（修复前行为），e2 的奖励
    // token_a 会按 999 计 → token_b = 40×999/80 = 499.5（错环语义）；接线后奖励令牌
    // 经 visiting 递归（MWITools getShopCurrencyValue 的 context 同语义），token_a 的
    // e1 奖励 token_b 已在 visiting → 环上条目按 0 计 → e2 贡献 0 → token_b = 300。
    vi.resetModules();
    vi.doMock('../../combatsimulator/data/shopItemDetailMap.json', () => ({
      default: {
        entry_ab: { itemHrid: '/items/token_b', outputCount: 50, costs: [{ itemHrid: '/items/token_a', count: 100 }] },
        entry_ba: { itemHrid: '/items/token_a', outputCount: 40, costs: [{ itemHrid: '/items/token_b', count: 80 }] },
        entry_bEssence: {
          itemHrid: '/items/cycle_essence',
          outputCount: 3,
          costs: [{ itemHrid: '/items/token_b', count: 1 }],
        },
      },
    }));
    vi.doMock('../../combatsimulator/data/taskShopItemDetailMap.json', () => ({ default: {} }));
    vi.doMock('../../combatsimulator/data/labyrinthShopItemDetailMap.json', () => ({ default: {} }));
    try {
      const { computeShopCurrencyValue: computeCyclic } = await import('../assetScoreService.js');
      const pricing = createPricing({
        marketItemValues: {
          '/items/token_a': { 0: 999 },
          '/items/cycle_essence': { 0: 100 },
        },
      });
      expect(computeCyclic(pricing, '/items/token_b')).toBe(300);
      // token_a 经 e1 以 token_b 计价：50×300 ÷ 100 = 150（修复前 e1 奖励 token_b 经
      // 通用链取价为 0 → token_a = 0；两组断言与修复前的 499.5/0 均不同，可区分接线前后）。
      expect(computeCyclic(pricing, '/items/token_a')).toBe(150);
    } finally {
      vi.doUnmock('../../combatsimulator/data/shopItemDetailMap.json');
      vi.doUnmock('../../combatsimulator/data/taskShopItemDetailMap.json');
      vi.doUnmock('../../combatsimulator/data/labyrinthShopItemDetailMap.json');
      vi.resetModules();
    }
  });
});

describe('商店兑换获取成本链（base 披风，第 15 轮）', () => {
  // base 披风不可交易、无配方，仅能用 27000 enchanted_token 换购；令牌价值取最优
  // 兑换率（royal_cloth 2000 换路线）；精炼需 100×enchanted_refinement_shard。
  function createCloakPricing() {
    return createPricing({
      marketItemValues: {
        '/items/enchanted_essence': { 0: 1337.5 },
        '/items/bear_essence': { 0: 115.5 },
        '/items/sorcerer_essence': { 0: 214.5 },
        '/items/golem_essence': { 0: 180 },
        '/items/abyssal_essence': { 0: 183.5 },
        '/items/royal_cloth': { 0: 2_735_000 },
        '/items/enchanted_refinement_shard': { 0: 2_432_500 },
        '/items/mirror_of_protection': { 0: 10_250_000 },
        '/items/philosophers_mirror': { 0: 627_500_000 },
        '/items/ultra_enhancing_tea': { 0: 13_350 },
        '/items/blessed_tea': { 0: 1900 },
      },
    });
  }

  it('令牌价值 = 最优兑换率（royal_cloth 路线 1367.5 优于 essence 1:1 的 1337.5）', () => {
    expect(computeShopCurrencyValue(createCloakPricing(), '/items/enchanted_token')).toBe(1367.5);
  });

  it('base 披风 +5 走成本法（商店兑换起始件 + 精炼碎片），不再落 vendor 卖店价', () => {
    const resolved = resolveEquipmentAssetValue(createCloakPricing(), '/items/enchanted_cloak_refined', 5, 'back');
    expect(resolved.source).toBe(ASSET_SCORE_SOURCES.COST);
    // 下限 = 起始件 27000×1367.5 ≈ 36.9M + 精炼 100×2.4325M = 243.25M ≈ 280.2M；
    // 0→5 强化成本（含背部强制保护镜）另计，总量必然高于该下限。
    expect(resolved.price).toBeGreaterThan(280_000_000);
  });

  it('精炼碎片缺价 → 成本法 unavailable，不再呈现静默低估的「完整」成本（审计 #4）', () => {
    const full = createCloakPricing();
    // 碎片无制作配方、无商店兑换渠道（actionDetailMap 无产出方），marketItemValues 是
    // 唯一价源——删除该条目即构造「强化材料有价、仅精炼碎片缺价」的部分行情场景。
    const rest = { ...full.marketItemValues };
    delete rest['/items/enchanted_refinement_shard'];
    const withoutShard = createPricing({ marketItemValues: rest });
    const costComplete = computeEnhancedEquipmentCost(full, '/items/enchanted_cloak_refined', 5, 0, {
      protectionItemHrid: '/items/mirror_of_protection',
    });
    const costMissing = computeEnhancedEquipmentCost(withoutShard, '/items/enchanted_cloak_refined', 5, 0, {
      protectionItemHrid: '/items/mirror_of_protection',
    });
    expect(costComplete.available).toBe(true);
    expect(costComplete.price).toBeGreaterThan(280_000_000);
    // 修复前：精炼段静默跳过缺价碎片 → available 仍 true、成本缺 ~243M 却呈现为
    //「完整」值；修复后与 MWITools hasMissingRequiredPrice → unavailableResult
    // 同口径（mwitools-src L33905-33914）。
    expect(costMissing.available).toBe(false);
    expect(costMissing.price).toBe(0);
    // 装备估值不再走 COST：沿降级链落 vendor 卖店价（100k），诚实呈现而非
    // 缺 240M 精炼段的伪完整成本。
    const resolved = resolveEquipmentAssetValue(withoutShard, '/items/enchanted_cloak_refined', 5, 'back');
    expect(resolved.source).toBe(ASSET_SCORE_SOURCES.VENDOR);
    expect(resolved.price).toBe(100_000);
  });
});

describe('工匠茶精炼折扣（对齐 MWITools projectAction 的 lessResource 茶效）', () => {
  // 工匠茶 flat 0.1 × 加浓浓度（pouch +7：1 + 0.1 + 0.002 ×
  // POUCH_DRINK_ENHANCEMENT_BONUSES[7] = 1.100364，对齐 MWITools ENHANCEMENT_BONUSES 口径）。
  const CRAFTING_LESS_RESOURCE = 0.1 * (1 + 0.1 + 0.002 * POUCH_DRINK_ENHANCEMENT_BONUSES[7]);
  // 精炼碎片（enchanted_refinement_shard）夹具价：精炼段 100 个的折扣对账与它联动。
  const REFINEMENT_SHARD_PRICE = 2_434_000;

  function createArtisanPricing() {
    return createPricing({
      marketItemValues: {
        '/items/enchanted_essence': { 0: 1341 },
        '/items/bear_essence': { 0: 116 },
        '/items/sorcerer_essence': { 0: 216 },
        '/items/golem_essence': { 0: 182 },
        '/items/abyssal_essence': { 0: 183 },
        '/items/royal_cloth': { 0: 5_461_000 },
        '/items/enchanted_refinement_shard': { 0: REFINEMENT_SHARD_PRICE },
        '/items/mirror_of_protection': { 0: 10_260_000 },
        '/items/philosophers_mirror': { 0: 638_600_000 },
        '/items/ultra_enhancing_tea': { 0: 13_420 },
        '/items/blessed_tea': { 0: 3370 },
      },
    });
  }

  it('computeEnhancedEquipmentCost：lessResource 抵扣精炼碎片（差值 = 100×2.434M×lessResource）', () => {
    const pricing = createArtisanPricing();
    const full = computeEnhancedEquipmentCost(pricing, '/items/enchanted_cloak_refined', 5, 0, {
      protectionItemHrid: '/items/mirror_of_protection',
    });
    const discounted = computeEnhancedEquipmentCost(pricing, '/items/enchanted_cloak_refined', 5, 0, {
      protectionItemHrid: '/items/mirror_of_protection',
      refinementLessResource: CRAFTING_LESS_RESOURCE,
    });
    expect(full.available).toBe(true);
    expect(discounted.available).toBe(true);
    // 对账锁定（±1 容差，预期 ≈26,782,860）：full.price − discounted.price = 两次独立
    // Math.round 之差（强化段浮点链不 round、精炼段各自 round 收口），理论最大偏差为 1，
    // 故不做 round 收口/裸 toBe；对齐 MWITools ENHANCEMENT_BONUSES 口径后折扣量
    // 26,782,859.76 非整数，与 MWITools 面板装备差（26M）同源同量级。
    expect(
      Math.abs(full.price - discounted.price - 100 * REFINEMENT_SHARD_PRICE * CRAFTING_LESS_RESOURCE),
    ).toBeLessThanOrEqual(1);
  });

  it('resolveCraftingTeaLessResource：无工匠茶返回 0', () => {
    const player = createEmptyPlayerConfig(1);
    player.equipment.pouch = { itemHrid: '/items/guzzling_pouch', enhancementLevel: 7 };
    expect(resolveCraftingTeaLessResource(player)).toBe(0);
  });

  it('resolveCraftingTeaLessResource：工匠茶 + pouch 槽为空不加浓（0.1）', () => {
    const player = createEmptyPlayerConfig(1);
    player.craftingTeaSlots = { '/action_types/tailoring': ['/items/artisan_tea'] };
    expect(resolveCraftingTeaLessResource(player)).toBe(0.1);
  });

  it('resolveCraftingTeaLessResource：工匠茶 + 非暴饮之囊（gluttonous_pouch +7）不加浓（0.1）', () => {
    const player = createEmptyPlayerConfig(1);
    player.equipment.pouch = { itemHrid: '/items/gluttonous_pouch', enhancementLevel: 7 };
    player.craftingTeaSlots = { '/action_types/tailoring': ['/items/artisan_tea'] };
    expect(resolveCraftingTeaLessResource(player)).toBe(0.1);
  });

  it('resolveCraftingTeaLessResource：暴饮之囊 +7 加浓对齐 MWITools 口径（≈0.1100364）', () => {
    const player = createEmptyPlayerConfig(1);
    player.equipment.pouch = { itemHrid: '/items/guzzling_pouch', enhancementLevel: 7 };
    player.craftingTeaSlots = { '/action_types/tailoring': ['/items/artisan_tea'] };
    expect(resolveCraftingTeaLessResource(player)).toBeCloseTo(0.1100364, 4);
  });

  it('computePlayerAssetScore：craftingTeaSlots 工匠茶 + 暴饮之囊 +7 传导折扣', () => {
    const player = createEmptyPlayerConfig(9);
    player.equipment.back = { itemHrid: '/items/enchanted_cloak_refined', enhancementLevel: 5 };
    player.equipment.pouch = { itemHrid: '/items/guzzling_pouch', enhancementLevel: 7 };
    player.craftingTeaSlots = { '/action_types/tailoring': ['/items/artisan_tea'] };
    const score = computePlayerAssetScore(player, createArtisanPricing());
    const back = score.items.equipment.find((item) => item.slotKey === 'back');
    expect(back).toBeTruthy();
    expect(back.source).toBe(ASSET_SCORE_SOURCES.COST);
    // 折扣后披风 ≈ 362.8M（>= 355M 且 < 370M）；未折扣会是 389.6M。
    expect(back.value).toBeGreaterThan(355_000_000);
    expect(back.value).toBeLessThan(370_000_000);
  });
});

describe('技能书口径（对齐 MWITools calculateAbilityScore：累计经验 ÷ 每本 + 1，一位小数）', () => {
  it('fireball 3 级 = table[3]=76 ÷ 50 + 1 = 2.5 本', () => {
    const player = createEmptyPlayerConfig(3);
    player.abilities = [
      { abilityHrid: '/abilities/fireball', level: 3 },
      { abilityHrid: '', level: 1 },
      { abilityHrid: '', level: 1 },
      { abilityHrid: '', level: 1 },
      { abilityHrid: '', level: 1 },
    ];
    const pricing = createPricing({
      marketItemValues: { '/items/fireball': { 0: 2_000_000 } },
    });
    const score = computePlayerAssetScore(player, pricing);
    // 2.5 本 × 2M = 5,000,000（旧 ceil 口径会是 2 本 × 2M = 4M——本测试锁定 +1 本语义）。
    expect(score.sections.abilities).toBe(5_000_000);
    // 完整路径的 incomplete 生成断言：书本有价 → 行完整（false）。
    expect(score.items.abilities[0].incomplete).toBe(false);
  });
});

// 探针（tmp/verify-charm-divergence.mjs）依赖的取价语义回归锁定：
// upgrade 型配方的输入计数 = inputItems.count + 1（MWITools getDirectInputs 对
// upgradeItemHrid 命中 inputItems 时 count+1）。本地实现形态是「upgrade 单独加一次
// + inputItems 再算 N 次」，表面像重复计数 12.5%，实为双边同式（advanced charm =
// 9×basic 而非 8×）；未来若有人「修复」这个看似的重复计数，探针与 MWITools 的
// 对比将产生系统性假差异，故锁定。
describe('computeAcquisitionInputPrice 的 upgrade 型配方计数语义', () => {
  it('upgrade 命中 inputItems 时总计数 = count+1：advanced_alchemy_charm = 9×basic（非 8×）', () => {
    // 只有 basic_alchemy_charm 有公允价（trainee 不可交易无行情），advanced 的制作候选
    // 必然下探到 basic：upgrade(/items/basic_alchemy_charm) 1 次 + inputItems 8 次 = 9 次。
    const basicHrid = '/items/basic_alchemy_charm';
    const advancedHrid = '/items/advanced_alchemy_charm';
    const basicPrice = 1_000_000;
    const pricing = createPricing({
      priceTable: {
        [basicHrid]: { ask: basicPrice, bid: basicPrice },
      },
    });
    const advanced = computeAcquisitionInputPrice(pricing, advancedHrid, 0);
    // 若误删 upgrade 单独计次（只算 inputItems 8 次），值会是 8_000_000。
    expect(advanced).toBe(9 * basicPrice);
    // 对照：无配方的叶子（trainee）直接回落公允价。
    const traineeHrid = '/items/trainee_alchemy_charm';
    const traineePrice = 250_000;
    const pricingWithTrainee = createPricing({
      priceTable: {
        [traineeHrid]: { ask: traineePrice, bid: traineePrice },
      },
    });
    expect(computeAcquisitionInputPrice(pricingWithTrainee, traineeHrid, 0)).toBe(traineePrice);
  });

  it('craft 链 depth>2 截断（分歧③）：gm/master 制作链深跳超限且无公允价时诚实返 0', () => {
    // grandmaster_alchemy_charm 链：gm←master←expert←advanced←basic←essence（5 跳）。
    // 只有 essence 有挂单价时，本地制作候选在 depth>2 截断——gm 层制作候选不可得，
    // 回落公允价路径；公允价也无（无行情）→ 0。该断言锁定「截断后不 crash、诚实返 0」，
    // 与探针全链递归形成可解释的差异面（分歧③）。
    const gmHrid = '/items/grandmaster_alchemy_charm';
    const essenceHrid = '/items/alchemy_essence';
    const pricing = createPricing({
      priceTable: {
        [essenceHrid]: { ask: 1000, bid: 1000 },
      },
    });
    expect(computeAcquisitionInputPrice(pricing, gmHrid, 0)).toBe(0);
    // 上一层 master（链深 4 跳、仍被截断于 basic 前）同样不可得。
    const masterHrid = '/items/master_alchemy_charm';
    expect(computeAcquisitionInputPrice(pricing, masterHrid, 0)).toBe(0);
  });
});

// 地下城收益计算器单测：纯函数注入价格表，不触网；锚点值为手工核算值。
import { describe, expect, it } from 'vitest';
import actionDetailMap from '../../combatsimulator/data/actionDetailMap.json';
import itemDetailMap from '../../combatsimulator/data/itemDetailMap.json';
import openableLootDropMap from '../../combatsimulator/data/openableLootDropMap.json';
import {
  buildDungeonCatalog,
  compareDungeons,
  computeChestOpenExpectation,
  computeConsumablesCost,
  computeDailyProfit,
  computeDungeonRunProfit,
  resolveArtisanTeaDiscount,
  resolveChestKeyCost,
  resolveEntryKeyCost,
  resolveRefinementChestRate,
  resolveTokenUnitValue,
} from '../dungeonProfitCalculator.js';
import {
  COWBELL_HRID,
  createDefaultPriceTable,
  NON_TRADABLE_CAPE_HRIDS,
  resolveMarketPrice,
  resolveMarketSalePrice,
  TAX_MODE_MARKET,
} from '../marketPriceService.js';

const DUNGEON_HRIDS = {
  chimerical: '/actions/combat/chimerical_den',
  enchanted: '/actions/combat/enchanted_fortress',
  pirate: '/actions/combat/pirate_cove',
  sinister: '/actions/combat/sinister_circus',
};

const catalog = buildDungeonCatalog();
const catalogByHrid = new Map(catalog.map((entry) => [entry.actionHrid, entry]));

// 全零价格表：所有物品 ask/bid = -1、vendor = 0（价格完全由用例注入，避免 itemDetail 收购价干扰）。
function createZeroPriceTable() {
  const table = createDefaultPriceTable();
  for (const hrid of Object.keys(table)) {
    table[hrid] = { ask: -1, bid: -1, vendor: 0 };
  }
  return table;
}

function patchQuotes(table, quotes) {
  for (const [hrid, quote] of Object.entries(quotes)) {
    table[hrid] = { ask: quote.ask ?? -1, bid: quote.bid ?? -1, vendor: quote.vendor ?? 0 };
  }
  return table;
}

// chimerical 专用报价（其余物品保持 0），端到端净利可逐项手算。
const CHIMERICAL_QUOTES = {
  '/items/chimerical_entry_key': { ask: 30000, bid: 28000 },
  '/items/chimerical_chest_key': { ask: 410000, bid: 400000 },
  '/items/chimerical_essence': { ask: 5000, bid: 4800 },
  '/items/chimerical_refinement_shard': { ask: 380000, bid: 360000 },
};

// 精算表：全零 + chimerical 报价（large_treasure_chest 合成价也为 0，便于手算）。
const curatedTable = patchQuotes(createZeroPriceTable(), CHIMERICAL_QUOTES);

// 现实档表：默认表（保留 large_treasure_chest 合成价 100,908 与不可交易物兜底）叠加部分行情。
const FIXTURE_QUOTES = {
  ...CHIMERICAL_QUOTES,
  '/items/jade': { ask: 3000, bid: 2800 },
  '/items/sunstone': { ask: 90000, bid: 80000 },
  '/items/griffin_leather': { ask: 1200000, bid: 1000000 },
  '/items/umbral_leather': { ask: 25, bid: 20 },
  '/items/beast_leather': { ask: 30, bid: 24 },
  '/items/blue_key_fragment': { ask: 62000, bid: 60000 },
  '/items/green_key_fragment': { ask: 57000, bid: 55000 },
  '/items/purple_key_fragment': { ask: 72000, bid: 70000 },
  '/items/white_key_fragment': { ask: 67000, bid: 65000 },
};
const fixtureTable = patchQuotes(createDefaultPriceTable(), FIXTURE_QUOTES);

function findItemRow(result, itemHrid) {
  return result.items.find((row) => row.itemHrid === itemHrid) || null;
}

function isDescendingBy(rows, key) {
  return rows.every((row, index) => index === 0 || rows[index - 1][key] >= row[key]);
}

describe('buildDungeonCatalog 地牢目录', () => {
  it('构建 4 条地牢档案，门票/主箱/精炼箱/宝箱钥匙/代币 hrid 与数据一致', () => {
    expect(catalog).toHaveLength(4);

    const chimerical = catalogByHrid.get(DUNGEON_HRIDS.chimerical);
    expect(chimerical.name).toBe('Chimerical Den');
    expect(chimerical.keyItemHrid).toBe('/items/chimerical_entry_key');
    expect(chimerical.chestHrid).toBe('/items/chimerical_chest');
    expect(chimerical.refinementChestHrid).toBe('/items/chimerical_refinement_chest');
    expect(chimerical.chestKeyHrid).toBe('/items/chimerical_chest_key');
    expect(chimerical.tokenHrid).toBe('/items/chimerical_token');

    // 四地牢的 hrid 命名规律一致（门票/宝箱/宝箱钥匙/代币）。
    const expected = [
      ['chimerical', 'chimerical'],
      ['enchanted', 'enchanted'],
      ['pirate', 'pirate'],
      ['sinister', 'sinister'],
    ];
    for (const [key, slug] of expected) {
      const entry = catalogByHrid.get(DUNGEON_HRIDS[key]);
      expect(entry).toBeTruthy();
      expect(entry.keyItemHrid).toBe(`/items/${slug}_entry_key`);
      expect(entry.chestHrid).toBe(`/items/${slug}_chest`);
      expect(entry.chestKeyHrid).toBe(`/items/${slug}_chest_key`);
      expect(entry.refinementChestHrid).toBe(`/items/${slug}_refinement_chest`);
      expect(entry.tokenHrid).toBe(`/items/${slug}_token`);
      // 引擎侧 rewardDropTable 第二条即精炼箱（负基础掉率 + 每档增量）。
      expect(entry.refinementChestDropRate).toBe(-0.3);
      expect(entry.refinementChestDropRatePerTier).toBe(0.6);
      expect(entry.mainChestDropRate).toBe(1);
      expect(entry.maxPartySize).toBe(5);
      expect(entry.maxDifficulty).toBe(2);
    }
  });

  it('默认每轮分钟数 = maxWaves × 15s / 60（12.5 / 16.25 / 16.25 / 15）', () => {
    const wavesByHrid = {
      [DUNGEON_HRIDS.chimerical]: 50,
      [DUNGEON_HRIDS.enchanted]: 65,
      [DUNGEON_HRIDS.pirate]: 65,
      [DUNGEON_HRIDS.sinister]: 60,
    };
    const minutesByHrid = {
      [DUNGEON_HRIDS.chimerical]: 12.5,
      [DUNGEON_HRIDS.enchanted]: 16.25,
      [DUNGEON_HRIDS.pirate]: 16.25,
      [DUNGEON_HRIDS.sinister]: 15,
    };
    const largeChestMaxByHrid = {
      [DUNGEON_HRIDS.chimerical]: 5,
      [DUNGEON_HRIDS.enchanted]: 7,
      [DUNGEON_HRIDS.pirate]: 8,
      [DUNGEON_HRIDS.sinister]: 6,
    };
    const entryCraftLevelByHrid = {
      [DUNGEON_HRIDS.chimerical]: 70,
      [DUNGEON_HRIDS.enchanted]: 85,
      [DUNGEON_HRIDS.pirate]: 90,
      [DUNGEON_HRIDS.sinister]: 80,
    };

    for (const entry of catalog) {
      expect(entry.maxWaves).toBe(wavesByHrid[entry.actionHrid]);
      expect(entry.baseTimeCostSeconds).toBe(15);
      expect(entry.defaultRunMinutes).toBeCloseTo(minutesByHrid[entry.actionHrid], 12);
      expect(entry.largeChestMaxCount).toBe(largeChestMaxByHrid[entry.actionHrid]);
      expect(entry.entryCraftLevel).toBe(entryCraftLevelByHrid[entry.actionHrid]);
      expect(entry.chestKeyCraftLevel).toBeGreaterThan(0);
    }
  });

  it('数据不变量：精炼箱公式、2% 钥匙回收、主箱与精炼箱共用同一把钥匙', () => {
    for (const entry of catalog) {
      const action = actionDetailMap[entry.actionHrid];
      const rewardDropTable = action.combatZoneInfo.dungeonInfo.rewardDropTable;
      expect(rewardDropTable[0].itemHrid).toBe(entry.chestHrid);
      expect(rewardDropTable[0].dropRate).toBe(1);
      // 精炼箱掉率公式常数逐地牢与 resolveRefinementChestRate 的取值一致。
      expect(rewardDropTable[1].itemHrid).toBe(entry.refinementChestHrid);
      expect(rewardDropTable[1].dropRate).toBe(-0.3);
      expect(rewardDropTable[1].dropRatePerDifficultyTier).toBe(0.6);
      expect(action.combatZoneInfo.isDungeon).toBe(true);

      // 宝箱钥匙：主箱与精炼箱 openKeyItemHrid 相同，且钥匙只从主箱 2% 回收。
      expect(itemDetailMap[entry.chestHrid].openKeyItemHrid).toBe(entry.chestKeyHrid);
      expect(itemDetailMap[entry.refinementChestHrid].openKeyItemHrid).toBe(entry.chestKeyHrid);
      expect(entry.chestKeyRecoveryPerChest).toBeCloseTo(0.02, 12);
      expect(openableLootDropMap[entry.refinementChestHrid].some((d) => d.itemHrid.endsWith('_chest_key'))).toBe(false);
      // 地牢怪物零散掉落不存在：产出全部来自 rewardDropTable。
      expect(action.dropTable).toBeNull();
      expect(action.essenceDropTable).toBeNull();
      expect(action.rareDropTable).toBeNull();
    }
  });

  it('目录记忆化：重复调用返回同一实例，且内容不变', () => {
    const snapshot = JSON.stringify(catalog);
    expect(buildDungeonCatalog()).toBe(catalog);
    expect(JSON.stringify(buildDungeonCatalog())).toBe(snapshot);
  });
});

describe('resolveRefinementChestRate 精炼箱掉率', () => {
  it('T0/T1/T2 = 0 / 0.3 / 0.9（官方公式 -0.3 + 0.6 × 档）', () => {
    expect(resolveRefinementChestRate(0, null)).toBe(0);
    expect(resolveRefinementChestRate(1, null)).toBeCloseTo(0.3, 12);
    expect(resolveRefinementChestRate(2, null)).toBeCloseTo(0.9, 12);
    expect(resolveRefinementChestRate(0, undefined)).toBe(0);
    expect(resolveRefinementChestRate(1, '')).toBeCloseTo(0.3, 12);
  });

  it('override 非空（含 0）时优先，越界值钳制到 [0, 1]', () => {
    expect(resolveRefinementChestRate(2, 0)).toBe(0);
    expect(resolveRefinementChestRate(0, 0.33)).toBeCloseTo(0.33, 12);
    expect(resolveRefinementChestRate(1, 0.75)).toBeCloseTo(0.75, 12);
    expect(resolveRefinementChestRate(2, 1.5)).toBe(1);
    expect(resolveRefinementChestRate(2, -2)).toBe(0);
    expect(resolveRefinementChestRate(3, null)).toBe(1);
  });

  it('对象覆盖（对齐脚本侧逐档精炼率）：按档位取值，缺档 / 非法值回落官方公式', () => {
    const perTier = { 0: 0, 1: 0.33, 2: 1.0 };
    expect(resolveRefinementChestRate(0, perTier)).toBe(0);
    expect(resolveRefinementChestRate(1, perTier)).toBeCloseTo(0.33, 12);
    expect(resolveRefinementChestRate(2, perTier)).toBe(1);

    // 缺档（对象只给了 tier 1）→ 其余档位回落官方公式 -0.3 + 0.6 × tier。
    expect(resolveRefinementChestRate(2, { 1: 0.33 })).toBeCloseTo(0.9, 12);
    expect(resolveRefinementChestRate(0, { 1: 0.33 })).toBe(0);
    // 非法对象值（非有限 / null）同样回落公式，不落入标量路径。
    expect(resolveRefinementChestRate(1, { 1: 'abc' })).toBeCloseTo(0.3, 12);
    expect(resolveRefinementChestRate(2, { 2: null })).toBeCloseTo(0.9, 12);
    // 对象值同样钳制到 [0, 1]。
    expect(resolveRefinementChestRate(1, { 1: 1.5 })).toBe(1);
    expect(resolveRefinementChestRate(2, { 2: -2 })).toBe(0);
  });

  it('标量 / null 回归：对象分支不改变既有路径（含 0 覆盖与钳制）', () => {
    expect(resolveRefinementChestRate(2, 0)).toBe(0);
    expect(resolveRefinementChestRate(0, 0.33)).toBeCloseTo(0.33, 12);
    expect(resolveRefinementChestRate(2, 1.5)).toBe(1);
    expect(resolveRefinementChestRate(1, null)).toBeCloseTo(0.3, 12);
    expect(resolveRefinementChestRate(1, '')).toBeCloseTo(0.3, 12);
  });
});

describe('computeChestOpenExpectation 开箱期望', () => {
  it('chimerical_chest：精华 750、代币 487.5、大宝箱 0.9、宝箱钥匙 0.02（同 hrid 已聚合）', () => {
    const expectation = computeChestOpenExpectation('/items/chimerical_chest', 1);
    const byHrid = new Map(expectation.map((row) => [row.itemHrid, row.expectedQty]));

    // 精华 = 1×[400,800] + 0.05×[2000,4000] = 600 + 150；代币 = 375 + 112.5。
    expect(byHrid.get('/items/chimerical_essence')).toBeCloseTo(750, 9);
    expect(byHrid.get('/items/chimerical_token')).toBeCloseTo(487.5, 9);
    expect(byHrid.get('/items/large_treasure_chest')).toBeCloseTo(0.9, 9);
    expect(byHrid.get('/items/chimerical_chest_key')).toBeCloseTo(0.02, 12);
    expect(byHrid.get('/items/jade')).toBeCloseTo(7.5, 9);
    expect(byHrid.get('/items/sunstone')).toBeCloseTo(0.5, 9);
    // 同一 hrid 只出现一行（聚合后不重复）。
    expect(expectation.filter((row) => row.itemHrid === '/items/chimerical_essence')).toHaveLength(1);
  });

  it('large_treasure_chest：金币期望 67,500、牛铃期望 1.35', () => {
    const expectation = computeChestOpenExpectation('/items/large_treasure_chest', 1);
    const byHrid = new Map(expectation.map((row) => [row.itemHrid, row.expectedQty]));

    expect(byHrid.get('/items/coin')).toBeCloseTo(67500, 6); // 45000 + 0.1×225000
    expect(byHrid.get(COWBELL_HRID)).toBeCloseTo(1.35, 9); // 0.75 + 0.6
    expect(byHrid.get('/items/pearl')).toBeCloseTo(1.2, 9); // 0.6×2
  });

  it('精炼箱仅产出本地牢精炼碎片（1×[1,2] + 0.05×[5,10] = 1.875）', () => {
    for (const entry of catalog) {
      const expectation = computeChestOpenExpectation(entry.refinementChestHrid, 1);
      expect(expectation).toHaveLength(1);
      expect(expectation[0].itemHrid).toBe(entry.refinementChestHrid.replace('_chest', '_shard'));
      expect(expectation[0].expectedQty).toBeCloseTo(1.875, 9);
    }
  });

  it('社区 buff 倍率乘到全部产出数量（L20 = 1.295）', () => {
    const base = computeChestOpenExpectation('/items/chimerical_chest', 1);
    const buffed = computeChestOpenExpectation('/items/chimerical_chest', 1.295);
    const buffedByHrid = new Map(buffed.map((row) => [row.itemHrid, row.expectedQty]));

    expect(buffed).toHaveLength(base.length);
    for (const row of base) {
      expect(buffedByHrid.get(row.itemHrid) / row.expectedQty).toBeCloseTo(1.295, 12);
    }
  });

  it('未知 / 空宝箱返回空数组', () => {
    expect(computeChestOpenExpectation('/items/not_a_chest', 1)).toEqual([]);
    expect(computeChestOpenExpectation('', 1)).toEqual([]);
    expect(computeChestOpenExpectation(null, 1)).toEqual([]);
  });
});

describe('resolveTokenUnitValue 代币估值', () => {
  it('取「可交易商店物净卖价 ÷ 兑换成本」的最大值（精华 1:1 参与估值）', () => {
    // essence 净额 bid = round(4800×0.96) = 4608（1:1）；griffin_leather 净额 = round(1000000×0.96) = 960000 ÷ 600 = 1600。
    expect(resolveTokenUnitValue(fixtureTable, 'bid', '/items/chimerical_token')).toBeCloseTo(4608, 9);
    // ask 侧：essence 4800（1:1）vs griffin_leather 1152000÷600 = 1920。
    expect(resolveTokenUnitValue(fixtureTable, 'ask', '/items/chimerical_token')).toBeCloseTo(4800, 9);
    // 单列核对：估值至少不低于精华净卖价（1:1 商店物）。
    expect(resolveTokenUnitValue(fixtureTable, 'bid', '/items/chimerical_token')).toBeGreaterThanOrEqual(
      resolveMarketSalePrice(fixtureTable, '/items/chimerical_essence', 'bid', TAX_MODE_MARKET),
    );
  });

  it('排除 NON_TRADABLE_CAPE_HRIDS 披风类（quiver 高价不抬高估值）', () => {
    expect(NON_TRADABLE_CAPE_HRIDS).toContain('/items/chimerical_quiver');
    const withExpensiveQuiver = patchQuotes(fixtureTable, {
      '/items/chimerical_quiver': { ask: 400000000, bid: 200000000 },
    });

    // 若未排除，quiver 估值 = round(200000000×0.96) ÷ 35000 ≈ 5485.7 > 4608。
    expect(resolveTokenUnitValue(withExpensiveQuiver, 'bid', '/items/chimerical_token')).toBeCloseTo(4608, 9);
  });

  it('无候选 / 空 token / 无行情时返回 0', () => {
    expect(resolveTokenUnitValue(fixtureTable, 'bid', '')).toBe(0);
    expect(resolveTokenUnitValue(fixtureTable, 'bid', '/items/chimerical_entry_key')).toBe(0);
    expect(resolveTokenUnitValue(createZeroPriceTable(), 'bid', '/items/chimerical_token')).toBe(0);
  });
});

describe('resolveEntryKeyCost 门票钥匙成本', () => {
  it('market：按 buyMode 取门票单价，买入不扣税', () => {
    const ask = resolveEntryKeyCost({
      priceTable: fixtureTable,
      keyHrid: '/items/chimerical_entry_key',
      keySource: 'market',
      buyMode: 'ask',
    });
    expect(ask.source).toBe('market');
    expect(ask.basis).toBe('market');
    expect(ask.cost).toBe(30000);
    expect(ask.breakdown).toEqual([
      { itemHrid: '/items/chimerical_entry_key', count: 1, unitPrice: 30000, subtotal: 30000 },
    ]);

    const bid = resolveEntryKeyCost({
      priceTable: fixtureTable,
      keyHrid: '/items/chimerical_entry_key',
      keySource: 'market',
      buyMode: 'bid',
    });
    expect(bid.cost).toBe(28000);
  });

  it('craft：Σ 材料 buyMode 价 + coin 面值（材料 ×100）', () => {
    const craft = resolveEntryKeyCost({
      priceTable: fixtureTable,
      keyHrid: '/items/chimerical_entry_key',
      keySource: 'craft',
      buyMode: 'bid',
    });

    expect(craft.basis).toBe('craft');
    expect(craft.hasCraftRecipe).toBe(true);
    expect(craft.craftLevel).toBe(70);
    // coin 100,000（面值）+ umbral_leather 100×20 + beast_leather 100×24 = 104,400。
    expect(craft.cost).toBe(104400);
    expect(craft.breakdown).toEqual([
      { itemHrid: '/items/coin', count: 100000, unitPrice: 1, subtotal: 100000 },
      { itemHrid: '/items/umbral_leather', count: 100, unitPrice: 20, subtotal: 2000 },
      { itemHrid: '/items/beast_leather', count: 100, unitPrice: 24, subtotal: 2400 },
    ]);

    const craftAsk = resolveEntryKeyCost({
      priceTable: fixtureTable,
      keyHrid: '/items/chimerical_entry_key',
      keySource: 'craft',
      buyMode: 'ask',
    });
    expect(craftAsk.cost).toBe(105500); // 100000 + 100×25 + 100×30
  });

  it('hybrid 来源已移除：legacy 值归一为 market（含缺配方的 craft 防御分支）', () => {
    // 2026-10-12 用户裁决：钥匙来源只保留 market / craft，hybrid 选项整体移除；
    // 旧持久化数据里的 'hybrid' 归一为 market（与未知值同路径）。
    const legacyHybrid = resolveEntryKeyCost({
      priceTable: fixtureTable,
      keyHrid: '/items/chimerical_entry_key',
      keySource: 'hybrid',
      buyMode: 'bid',
    });
    expect(legacyHybrid.source).toBe('market');
    expect(legacyHybrid.basis).toBe('market');
    expect(legacyHybrid.cost).toBe(28000);
    expect(legacyHybrid.breakdown).toEqual([
      { itemHrid: '/items/chimerical_entry_key', count: 1, unitPrice: 28000, subtotal: 28000 },
    ]);

    // 缺配方时 craft 同样回退市场价（防御分支保留）。
    const noRecipe = resolveEntryKeyCost({
      priceTable: fixtureTable,
      keyHrid: '/items/griffin_leather',
      keySource: 'craft',
      buyMode: 'bid',
    });
    expect(noRecipe.hasCraftRecipe).toBe(false);
    expect(noRecipe.basis).toBe('market');
    expect(noRecipe.cost).toBe(resolveMarketPrice(fixtureTable, '/items/griffin_leather', 'bid'));
  });

  it('工匠茶材料折扣：只作用于 craft，market 来源不受影响', () => {
    const craftBase = resolveEntryKeyCost({
      priceTable: fixtureTable,
      keyHrid: '/items/chimerical_entry_key',
      keySource: 'craft',
      buyMode: 'bid',
    });
    expect(craftBase.cost).toBe(104400); // coin 100,000 + umbral 2,000 + beast 2,400
    expect(craftBase.materialMultiplier).toBe(1);

    // 勾选工匠茶（无暴饮）：lessResource = 0.1 → 每项材料 ×0.9（coin 一并参与）。
    const withTea = resolveEntryKeyCost({
      priceTable: fixtureTable,
      keyHrid: '/items/chimerical_entry_key',
      keySource: 'craft',
      buyMode: 'bid',
      artisanTea: true,
    });
    expect(withTea.materialMultiplier).toBeCloseTo(0.9, 12);
    expect(withTea.cost).toBeCloseTo(104400 * 0.9, 6); // 93,960
    expect(withTea.breakdown[0].itemHrid).toBe('/items/coin');
    expect(withTea.breakdown[0].unitPrice).toBeCloseTo(0.9, 12); // coin 面值 1 × 0.9
    expect(withTea.breakdown[0].subtotal).toBeCloseTo(90000, 6);
    expect(withTea.breakdown[1].subtotal).toBeCloseTo(1800, 6);
    expect(withTea.breakdown[2].subtotal).toBeCloseTo(2160, 6);

    // 未勾选工匠茶时暴饮之囊不产生任何折扣（加浓只在茶生效时参与）。
    const pouchOnly = resolveEntryKeyCost({
      priceTable: fixtureTable,
      keyHrid: '/items/chimerical_entry_key',
      keySource: 'craft',
      buyMode: 'bid',
      artisanTea: false,
      guzzlingPouch: true,
      guzzlingLevel: 7,
    });
    expect(pouchOnly.materialMultiplier).toBe(1);
    expect(pouchOnly.cost).toBe(104400);

    // market 来源（买成品钥匙）不受工匠茶 / 暴饮影响。
    const marketWithTea = resolveEntryKeyCost({
      priceTable: fixtureTable,
      keyHrid: '/items/chimerical_entry_key',
      keySource: 'market',
      buyMode: 'bid',
      artisanTea: true,
      guzzlingPouch: true,
      guzzlingLevel: 20,
    });
    expect(marketWithTea.cost).toBe(28000);
    expect(marketWithTea.breakdown).toEqual([
      { itemHrid: '/items/chimerical_entry_key', count: 1, unitPrice: 28000, subtotal: 28000 },
    ]);

    // 宝箱钥匙自制同口径：4 碎片 ×1 = 250,000 → 工匠茶 0.9 后 225,000。
    const chestWithTea = resolveEntryKeyCost({
      priceTable: fixtureTable,
      keyHrid: '/items/chimerical_chest_key',
      keySource: 'craft',
      buyMode: 'bid',
      artisanTea: true,
    });
    expect(chestWithTea.cost).toBeCloseTo(225000, 6);
    expect(chestWithTea.breakdown).toHaveLength(4);
  });

  it('来源归一：未知 keySource 回退 market', () => {
    const result = resolveEntryKeyCost({
      priceTable: fixtureTable,
      keyHrid: '/items/chimerical_entry_key',
      keySource: 'bogus',
      buyMode: 'bid',
    });
    expect(result.source).toBe('market');
    expect(result.cost).toBe(28000);
  });
});

describe('resolveArtisanTeaDiscount 工匠茶 / 暴饮之囊折扣', () => {
  it('未使用工匠茶：恒无折扣（materialMultiplier = 1）', () => {
    expect(resolveArtisanTeaDiscount({}).materialMultiplier).toBe(1);
    expect(resolveArtisanTeaDiscount({ artisanTea: false }).materialMultiplier).toBe(1);
    expect(
      resolveArtisanTeaDiscount({ artisanTea: false, guzzlingPouch: true, guzzlingLevel: 20 }).materialMultiplier,
    ).toBe(1);
    // 非布尔 true 不开启（仅显式 true 生效，与两对齐开关同款口径）。
    expect(resolveArtisanTeaDiscount({ artisanTea: 'true' }).materialMultiplier).toBe(1);
  });

  it('仅工匠茶：lessResource = flatBoost 0.1（读数据，非硬编码）', () => {
    const result = resolveArtisanTeaDiscount({ artisanTea: true });
    expect(result.drinkConcentration).toBe(0);
    expect(result.lessResource).toBeCloseTo(0.1, 12);
    expect(result.materialMultiplier).toBeCloseTo(0.9, 12);
  });

  it('工匠茶 + 暴饮之囊：加浓对齐游戏内实测（+5 → 11.2% / +6 → 11.5% / +7 → 11.82%）', () => {
    // 加浓浓度 = 0.1（noncombatStats）+ 0.002（noncombatEnhancementBonuses）× 通用强化倍率表[等级]。
    // 实测锚点（2026-10-12 用户游戏内读数）逐值锁定通用倍率表口径：
    //   +5 → 0.1 + 0.002×6 = 0.112；+6 → 0.1 + 0.002×7.5 = 0.115；+7 → 0.1 + 0.002×9.1 = 0.1182。
    const level5 = resolveArtisanTeaDiscount({ artisanTea: true, guzzlingPouch: true, guzzlingLevel: 5 });
    expect(level5.drinkConcentration).toBeCloseTo(0.112, 12);
    expect(level5.lessResource).toBeCloseTo(0.1112, 12);
    expect(level5.materialMultiplier).toBeCloseTo(0.8888, 12);

    const level6 = resolveArtisanTeaDiscount({ artisanTea: true, guzzlingPouch: true, guzzlingLevel: 6 });
    expect(level6.drinkConcentration).toBeCloseTo(0.115, 12);
    expect(level6.lessResource).toBeCloseTo(0.1115, 12);

    const level7 = resolveArtisanTeaDiscount({ artisanTea: true, guzzlingPouch: true, guzzlingLevel: 7 });
    expect(level7.drinkConcentration).toBeCloseTo(0.1182, 12);
    expect(level7.lessResource).toBeCloseTo(0.11182, 12);
    expect(level7.materialMultiplier).toBeCloseTo(0.88818, 12);

    // +0 暴饮之囊仍参与加浓（通用表 [0] = 0 → 浓度 = 基础 0.1）。
    const level0 = resolveArtisanTeaDiscount({ artisanTea: true, guzzlingPouch: true, guzzlingLevel: 0 });
    expect(level0.drinkConcentration).toBeCloseTo(0.1, 12);
    expect(level0.materialMultiplier).toBeCloseTo(0.89, 12);

    // 逐级单调：等级越高折扣越大（加浓浓度单调不减）。
    let previous = -1;
    for (let level = 0; level <= 20; level += 1) {
      const discount = resolveArtisanTeaDiscount({ artisanTea: true, guzzlingPouch: true, guzzlingLevel: level });
      expect(discount.drinkConcentration).toBeGreaterThanOrEqual(previous);
      previous = discount.drinkConcentration;
    }
    // +20（通用表 [20] = 50）：浓度 = 0.1 + 0.002×50 = 0.2，折扣 0.12。
    const level20 = resolveArtisanTeaDiscount({ artisanTea: true, guzzlingPouch: true, guzzlingLevel: 20 });
    expect(level20.drinkConcentration).toBeCloseTo(0.2, 12);
    expect(level20.lessResource).toBeCloseTo(0.12, 12);
  });

  it('等级越界钳制到 [0, 20]；脏值按 0 处理；折扣上限 1', () => {
    const over = resolveArtisanTeaDiscount({ artisanTea: true, guzzlingPouch: true, guzzlingLevel: 999 });
    expect(over.drinkConcentration).toBeCloseTo(0.2, 12);
    const negative = resolveArtisanTeaDiscount({ artisanTea: true, guzzlingPouch: true, guzzlingLevel: -5 });
    expect(negative.drinkConcentration).toBeCloseTo(0.1, 12);
    const dirty = resolveArtisanTeaDiscount({ artisanTea: true, guzzlingPouch: true, guzzlingLevel: 'abc' });
    expect(dirty.drinkConcentration).toBeCloseTo(0.1, 12);
    // lessResource 恒钳制在 [0, 1]（当前数据 0.1×(1+0.2) = 0.12，远未触顶）。
    for (const level of [0, 10, 20]) {
      const discount = resolveArtisanTeaDiscount({ artisanTea: true, guzzlingPouch: true, guzzlingLevel: level });
      expect(discount.lessResource).toBeGreaterThanOrEqual(0);
      expect(discount.lessResource).toBeLessThanOrEqual(1);
    }
  });
});

describe('resolveChestKeyCost 宝箱钥匙成本', () => {
  it('回收开启：keysPerRun=1 时净系数 0.98（gross × 0.98）', () => {
    const result = resolveChestKeyCost({
      priceTable: fixtureTable,
      keyHrid: '/items/chimerical_chest_key',
      keySource: 'market',
      buyMode: 'bid',
      keysPerRun: 1,
    });

    expect(result.unitCost).toBe(400000);
    expect(result.gross).toBe(400000);
    expect(result.net).toBe(392000);
    expect(result.recoveryRate).toBeCloseTo(0.98, 12);
    expect(result.net).toBeCloseTo(result.gross * 0.98, 6);
  });

  it('回收关闭：net = gross，recoveryRate = 1', () => {
    const result = resolveChestKeyCost({
      priceTable: fixtureTable,
      keyHrid: '/items/chimerical_chest_key',
      keySource: 'market',
      buyMode: 'bid',
      keysPerRun: 1,
      recovery: false,
    });

    expect(result.recoveryDiscountEnabled).toBe(false);
    // 折减开关与回收量上报解耦：关闭折减不改回收量（缺省 0.02 × mainChestsPerRun = 0.02）。
    expect(result.recoveredKeysPerRun).toBeCloseTo(0.02, 12);
    expect(result.net).toBe(result.gross);
    expect(result.recoveryRate).toBe(1);
  });

  it('T2 多把钥匙（主箱 1 + 精炼箱 0.9）：净额 = gross − 回收钥匙价值', () => {
    const result = resolveChestKeyCost({
      priceTable: fixtureTable,
      keyHrid: '/items/chimerical_chest_key',
      keySource: 'market',
      buyMode: 'bid',
      keysPerRun: 1.9,
    });

    expect(result.gross).toBe(760000);
    expect(result.recoveredKeysPerRun).toBeCloseTo(0.02, 12);
    expect(result.net).toBe(752000); // 760,000 − 0.02×400,000
    expect(result.recoveryRate).toBeCloseTo(752000 / 760000, 12);
  });

  it('craft 来源 + 回收：净额按自制成本折减', () => {
    const result = resolveChestKeyCost({
      priceTable: fixtureTable,
      keyHrid: '/items/chimerical_chest_key',
      keySource: 'craft',
      buyMode: 'bid',
      keysPerRun: 1,
    });

    expect(result.basis).toBe('craft');
    expect(result.unitCost).toBe(250000);
    expect(result.gross).toBe(250000);
    expect(result.net).toBe(245000);
  });
});

describe('computeDungeonRunProfit 端到端', () => {
  const baseParams = {
    dungeonHrid: DUNGEON_HRIDS.chimerical,
    difficultyTier: 2,
    priceTable: curatedTable,
    buyMode: 'ask',
    sellMode: 'bid',
    keySource: 'market',
    partySize: 5,
  };

  it('T2 手算锚点：毛收入 6,285,600 / 门票 30,000 / 宝箱钥匙 770,800 / 净利 5,484,800', () => {
    const result = computeDungeonRunProfit(baseParams);

    // 精华 750×4608 = 3,456,000；代币 487.5×4608 = 2,246,400；
    // 精炼碎片 1.875×0.9 = 1.6875 ×345,600 = 583,200（其余物品价格为 0）。
    // 开箱返还的宝箱钥匙不计入收入（净消耗口径：回收只体现为成本侧折减）。
    expect(result.grossIncome).toBeCloseTo(6285600, 6);
    expect(result.entryKeyCost).toBe(30000);
    expect(result.chestKeyGrossCost).toBe(779000); // 1.9 × 410,000
    expect(result.chestKeyCost).toBeCloseTo(770800, 6); // 779,000 − 0.02×410,000
    expect(result.totalCost).toBeCloseTo(800800, 6);
    expect(result.perRunProfit).toBeCloseTo(5484800, 6);
    expect(result.refinementRate).toBeCloseTo(0.9, 12);
    expect(result.buffMultiplier).toBe(1);
    expect(result.mainChestCount).toBe(1);
    expect(result.refinementChestCount).toBeCloseTo(0.9, 12);
    expect(result.runMinutes).toBeCloseTo(12.5, 12);
    expect(result.partySize).toBe(5);
  });

  it('每日消耗品成本按每日轮数摊入每轮成本与净利（MST 同款口径）', () => {
    const baseline = computeDungeonRunProfit(baseParams);
    // T2 默认时长 12.5 分钟 → 115.2 轮/天；每日 11.52M 金币摊到每轮 = 100,000。
    const withConsumables = computeDungeonRunProfit({ ...baseParams, dailyConsumablesCost: 11_520_000 });

    expect(withConsumables.dailyConsumablesCost).toBe(11_520_000);
    expect(withConsumables.consumablesCostPerRun).toBeCloseTo(100000, 6);
    expect(withConsumables.totalCost).toBeCloseTo(baseline.totalCost + 100000, 6);
    expect(withConsumables.perRunProfit).toBeCloseTo(baseline.perRunProfit - 100000, 6);
    // 默认 0：不传该参数时口径与旧结果完全一致（回归锚点）。
    expect(baseline.dailyConsumablesCost).toBe(0);
    expect(baseline.consumablesCostPerRun).toBe(0);
  });

  it('T2 产物明细：精华/代币/大宝箱/回收钥匙逐行锚点', () => {
    const result = computeDungeonRunProfit({
      ...baseParams,
      priceTable: fixtureTable,
      sellMode: 'bid',
    });

    const essence = findItemRow(result, '/items/chimerical_essence');
    expect(essence.qty).toBeCloseTo(750, 9);
    expect(essence.unitPrice).toBe(4608); // round(4800 × 0.96)
    expect(essence.subtotal).toBeCloseTo(3456000, 6);
    expect(essence.taxRate).toBe(0.04);
    expect(essence.priceSource).toBe('market_sale');

    const token = findItemRow(result, '/items/chimerical_token');
    expect(token.qty).toBeCloseTo(487.5, 9);
    expect(token.unitPrice).toBe(4608); // 商店兑换物估值，非市场成交来源
    expect(token.taxRate).toBeNull();
    expect(token.priceSource).toBe('shop_token_exchange');
    expect(token.subtotal).toBeCloseTo(2246400, 6);

    // large_treasure_chest 直接取价格表合成条目价（100,908，费率 0），不拆金币/牛铃。
    const largeChest = findItemRow(result, '/items/large_treasure_chest');
    expect(largeChest.qty).toBeCloseTo(0.9, 9);
    expect(largeChest.unitPrice).toBe(100908);
    expect(result.items.some((row) => row.itemHrid === COWBELL_HRID)).toBe(false);

    // 开箱返还的宝箱钥匙不再作为产出行（净消耗口径：回收只体现为成本侧折减，防收入/成本双计）。
    expect(findItemRow(result, '/items/chimerical_chest_key')).toBeNull();

    // 宝箱本体也作为产出行（不可交易、价格为 0），精炼箱数量 = 精炼率。
    const mainChest = findItemRow(result, '/items/chimerical_chest');
    expect(mainChest.qty).toBe(1);
    expect(mainChest.isChest).toBe(true);
    expect(mainChest.unitPrice).toBe(0);
    const refinementChest = findItemRow(result, '/items/chimerical_refinement_chest');
    expect(refinementChest.qty).toBeCloseTo(0.9, 12);
    expect(refinementChest.unitPrice).toBe(0);

    // 毛收入 = 逐行小计之和。
    const rowSum = result.items.reduce((sum, row) => sum + row.subtotal, 0);
    expect(result.grossIncome).toBeCloseTo(rowSum, 6);
  });

  it('T0 无精炼箱：净利 5,270,600（宝箱钥匙 1 把，碎片收益为 0）', () => {
    const result = computeDungeonRunProfit({ ...baseParams, difficultyTier: 0 });

    expect(result.refinementRate).toBe(0);
    expect(result.chestKeyGrossCost).toBe(410000);
    expect(result.chestKeyCost).toBeCloseTo(401800, 6);
    expect(result.grossIncome).toBeCloseTo(5702400, 6); // 3,456,000 + 2,246,400
    expect(result.perRunProfit).toBeCloseTo(5270600, 6);
    expect(findItemRow(result, '/items/chimerical_refinement_chest')).toBeNull();
  });

  it('4 买卖组合逐组合净利：bid 买 + ask 卖最优，ask 买 + bid 卖最差', () => {
    const combos = [
      { buyMode: 'ask', sellMode: 'bid', expected: 5484800, label: 'ask/bid' },
      { buyMode: 'bid', sellMode: 'bid', expected: 5505600, label: 'bid/bid' },
      { buyMode: 'ask', sellMode: 'ask', expected: 5754800, label: 'ask/ask' },
      { buyMode: 'bid', sellMode: 'ask', expected: 5775600, label: 'bid/ask' },
    ];
    const results = combos.map((combo) => ({
      ...combo,
      result: computeDungeonRunProfit({ ...baseParams, buyMode: combo.buyMode, sellMode: combo.sellMode }),
    }));

    for (const { result, expected, label } of results) {
      expect(result.perRunProfit, label).toBeCloseTo(expected, 6);
    }

    const best = results.find((combo) => combo.label === 'bid/ask').result;
    const worst = results.find((combo) => combo.label === 'ask/bid').result;
    expect(best.perRunProfit).toBeGreaterThan(worst.perRunProfit);
    expect(best.entryKeyCost).toBeLessThan(worst.entryKeyCost); // 买入侧影响成本
    expect(best.grossIncome).toBeGreaterThan(worst.grossIncome); // 卖出侧影响收入
  });

  it('社区 buff L20（箱数模型）：箱数 ×1.295 → 毛收入 ×1.295，成本侧钥匙与门票同步放大', () => {
    const off = computeDungeonRunProfit(baseParams);
    const on = computeDungeonRunProfit({ ...baseParams, communityBuffLevel: 20 });

    expect(off.buffMultiplier).toBe(1);
    expect(on.buffMultiplier).toBeCloseTo(1.295, 12);
    // 产出与成本同乘 1.295：箱数放大后钥匙数同步放大（1.9 → 2.4605），毛收入比 = 1.295。
    expect(on.grossIncome / off.grossIncome).toBeCloseTo(1.295, 12);
    expect(on.chestKeyGrossCost / off.chestKeyGrossCost).toBeCloseTo(1.295, 12);
    // 门票 = 普通宝箱数（2026-10-15 裁决）：buff 放大箱数后门票同步（1 → 1.295 张）。
    expect(on.entryKeyCostDetail.keysPerRun).toBeCloseTo(1.295, 12);
    expect(on.entryKeyCost).toBeCloseTo(off.entryKeyCost * 1.295, 6);
  });

  it('箱数模型：社区 buff 放大每轮箱数，不放大单箱内容物（防双重放大）', () => {
    const off = computeDungeonRunProfit(baseParams);
    const on = computeDungeonRunProfit({ ...baseParams, communityBuffLevel: 20 });

    // 箱数放大：L20 = 1.295 → 主箱 1.295、精炼箱 0.9 × 1.295 = 1.1655。
    expect(off.mainChestCount).toBe(1);
    expect(off.refinementChestCount).toBeCloseTo(0.9, 12);
    expect(on.mainChestCount).toBeCloseTo(1.295, 12);
    expect(on.refinementChestCount).toBeCloseTo(1.1655, 12);

    // 单箱期望不受 buff 影响：逐产物数量比 = 箱数比（1.295），而非 1.295²。
    for (const itemHrid of ['/items/chimerical_essence', '/items/chimerical_token']) {
      expect(findItemRow(on, itemHrid).qty / findItemRow(off, itemHrid).qty).toBeCloseTo(1.295, 12);
    }

    // 成本侧随箱数同步放大：宝箱钥匙 = (1.295 + 1.1655) × 单价；回收量按主箱数放大（0.02 × 1.295）。
    expect(on.chestKeyCostDetail.keysPerRun).toBeCloseTo(2.4605, 12);
    expect(on.chestKeyCostDetail.recoveredKeysPerRun).toBeCloseTo(0.0259, 12);
    // 门票随箱数同步放大（1 → 1.295 张；精炼箱不消耗门票）。
    expect(on.entryKeyCost).toBeCloseTo(off.entryKeyCost * 1.295, 6);
  });

  it('buff=0（缺省）与旧口径逐位一致：箱数 1 / 精炼率、钥匙数 1 + 精炼率', () => {
    const legacy = computeDungeonRunProfit(baseParams);

    expect(legacy.buffMultiplier).toBe(1);
    expect(legacy.mainChestCount).toBe(1);
    expect(legacy.refinementChestCount).toBeCloseTo(0.9, 12);
    expect(legacy.chestKeyCostDetail.keysPerRun).toBeCloseTo(1.9, 12);
    expect(legacy.chestKeyCostDetail.recoveredKeysPerRun).toBeCloseTo(0.02, 12);
    // 5 人满编：人数因子 1，门票 = 1 张（30,000）——与旧口径逐位一致。
    expect(legacy.entryKeyCostDetail.keysPerRun).toBeCloseTo(1, 12);
    expect(legacy.entryKeyCost).toBe(30000);
    expect(legacy.perRunProfit).toBeCloseTo(5484800, 6);
  });

  it('队伍人数平分箱数（官方公式 5 ÷ 人数）：1 人 = 5 倍箱数，门票 = 普通箱数', () => {
    // 5 人（缺省）：人数因子 1，与原口径逐位一致；1 人：箱数 ×5。
    const five = computeDungeonRunProfit(baseParams);
    const one = computeDungeonRunProfit({ ...baseParams, partySize: 1 });

    expect(five.mainChestCount).toBe(1);
    expect(one.mainChestCount).toBeCloseTo(5, 12);
    expect(one.refinementChestCount).toBeCloseTo(4.5, 12);
    // 所有产物按箱数线性放大：毛收入 ×5。
    expect(one.grossIncome).toBeCloseTo(five.grossIncome * 5, 6);

    // 门票 = 普通宝箱数（精炼箱不消耗）：1 人 = 5 张 = 150,000（30,000/张）。
    expect(five.entryKeyCostDetail.keysPerRun).toBeCloseTo(1, 12);
    expect(one.entryKeyCostDetail.keysPerRun).toBeCloseTo(5, 12);
    expect(one.entryKeyCost).toBeCloseTo(150000, 6);

    // 宝箱钥匙 = 主箱 5 + 精炼箱 4.5 = 9.5 把；回收按主箱 0.02 × 5 = 0.1 把折减。
    expect(one.chestKeyCostDetail.keysPerRun).toBeCloseTo(9.5, 12);
    expect(one.chestKeyCostDetail.recoveredKeysPerRun).toBeCloseTo(0.1, 12);

    // 3 人：人数因子 5/3。
    const three = computeDungeonRunProfit({ ...baseParams, partySize: 3 });
    expect(three.mainChestCount).toBeCloseTo(5 / 3, 12);
    expect(three.entryKeyCost).toBeCloseTo((5 / 3) * 30000, 6);
  });

  it('回收开关关闭：宝箱钥匙成本 = gross，净利下降 0.02 × 单价', () => {
    const on = computeDungeonRunProfit(baseParams);
    const off = computeDungeonRunProfit({ ...baseParams, chestKeyRecovery: false });

    expect(off.chestKeyCost).toBeCloseTo(off.chestKeyGrossCost, 6);
    expect(on.perRunProfit - off.perRunProfit).toBeCloseTo(0.02 * 410000, 6);

    // cost 落点回归锚点：折减开关开启且折减生效；回收量恒为真实回收量（0.02 × 主箱数）。
    expect(on.chestKeyCostDetail.recoveryDiscountEnabled).toBe(true);
    expect(off.chestKeyCostDetail.recoveryDiscountEnabled).toBe(false);
    expect(on.chestKeyCost).toBeLessThan(on.chestKeyGrossCost);
    expect(on.chestKeyCostDetail.recoveredKeysPerRun).toBeCloseTo(0.02 * on.mainChestCount, 12);
    expect(off.chestKeyCostDetail.recoveredKeysPerRun).toBeCloseTo(0.02 * off.mainChestCount, 12);
  });

  it('income 回收落点：成本侧毛额 + 收入侧计入返还钥匙行（默认 cost 不受影响）', () => {
    const cost = computeDungeonRunProfit(baseParams);
    const income = computeDungeonRunProfit({ ...baseParams, chestKeyRecoveryMode: 'income' });
    const keyHrid = '/items/chimerical_chest_key';

    // 默认口径：不传参数时结果字段回显 'cost'（既有数值逐位不变）。
    expect(cost.chestKeyRecoveryMode).toBe('cost');
    expect(income.chestKeyRecoveryMode).toBe('income');

    // 成本侧取毛额（无回收折减）。
    expect(income.chestKeyCost).toBe(income.chestKeyGrossCost);
    expect(income.chestKeyCost).toBeCloseTo(cost.chestKeyGrossCost, 6);

    // 字段契约（2026-10-15 拆分）：income 落点下回收量仍为真实回收量（不再归零），
    // 成本侧是否折减由独立布尔表达——下游不得再把 recoveredKeysPerRun 当折减开关读。
    expect(income.chestKeyCostDetail.recoveredKeysPerRun).toBeCloseTo(0.02 * income.mainChestCount, 12);
    expect(income.chestKeyCostDetail.recoveryDiscountEnabled).toBe(false);
    expect(cost.chestKeyCostDetail.recoveryDiscountEnabled).toBe(true);

    // 收入侧计入返还钥匙行：qty = 0.02 × 主箱数 = 0.02，按 sellMode 市场净价定价。
    const recoveredRow = findItemRow(income, keyHrid);
    expect(recoveredRow).not.toBeNull();
    expect(recoveredRow.qty).toBeCloseTo(0.02, 12);
    expect(recoveredRow.unitPrice).toBe(384000); // round(400000 × 0.96)
    expect(findItemRow(cost, keyHrid)).toBeNull();

    // 恒等式（逐项分解）：收入侧增量 = 回收数 × 卖净价；成本侧增量 = 回收数 × 买单价。
    const { recoveredKeysPerRun, unitCost } = cost.chestKeyCostDetail;
    const netSalePrice = resolveMarketSalePrice(baseParams.priceTable, keyHrid, 'bid', TAX_MODE_MARKET);
    expect(netSalePrice).toBe(384000); // round(400000 × 0.96)
    expect(recoveredKeysPerRun).toBeCloseTo(0.02, 12);
    expect(income.grossIncome - cost.grossIncome).toBeCloseTo(recoveredKeysPerRun * netSalePrice, 6);
    expect(income.totalCost - cost.totalCost).toBeCloseTo(recoveredKeysPerRun * unitCost, 6);
    expect(income.perRunProfit - cost.perRunProfit).toBeCloseTo(
      recoveredKeysPerRun * netSalePrice - recoveredKeysPerRun * unitCost,
      6,
    );
  });

  it('income 模式 ask 卖出侧同构；回收关闭时与 cost 模式口径一致', () => {
    const keyHrid = '/items/chimerical_chest_key';
    const costAsk = computeDungeonRunProfit({ ...baseParams, sellMode: 'ask' });
    const incomeAsk = computeDungeonRunProfit({ ...baseParams, sellMode: 'ask', chestKeyRecoveryMode: 'income' });
    const { recoveredKeysPerRun, unitCost } = costAsk.chestKeyCostDetail;
    const netSalePriceAsk = resolveMarketSalePrice(baseParams.priceTable, keyHrid, 'ask', TAX_MODE_MARKET);
    expect(incomeAsk.grossIncome - costAsk.grossIncome).toBeCloseTo(recoveredKeysPerRun * netSalePriceAsk, 6);
    expect(incomeAsk.perRunProfit - costAsk.perRunProfit).toBeCloseTo(
      recoveredKeysPerRun * netSalePriceAsk - recoveredKeysPerRun * unitCost,
      6,
    );

    // 回收关闭：income 落点不生效，与 cost + chestKeyRecovery:false 逐值一致（除模式回显）。
    const costOff = computeDungeonRunProfit({ ...baseParams, chestKeyRecovery: false });
    const incomeOff = computeDungeonRunProfit({
      ...baseParams,
      chestKeyRecovery: false,
      chestKeyRecoveryMode: 'income',
    });
    expect(incomeOff.chestKeyCost).toBeCloseTo(costOff.chestKeyCost, 6);
    expect(incomeOff.grossIncome).toBeCloseTo(costOff.grossIncome, 6);
    expect(incomeOff.totalCost).toBeCloseTo(costOff.totalCost, 6);
    expect(incomeOff.perRunProfit).toBeCloseTo(costOff.perRunProfit, 6);
    expect(incomeOff.chestKeyCost).toBeCloseTo(incomeOff.chestKeyGrossCost, 6);
    expect(findItemRow(incomeOff, keyHrid)).toBeNull();
  });

  it('价格表缺行情：缺价物品按 vendor 兜底（不伪造行情）', () => {
    const result = computeDungeonRunProfit({ ...baseParams, priceTable: createDefaultPriceTable() });

    const essence = findItemRow(result, '/items/chimerical_essence');
    expect(essence.unitPrice).toBe(200); // itemDetail sellPrice，vendor 来源免税
    expect(essence.priceSource).toBe('market_sale');
    expect(result.items.some((row) => row.itemHrid === '/items/chimerical_token')).toBe(true);
  });

  it('runMinutes / partySize 覆盖 + 日收益折算；未知地牢返回 null', () => {
    const customized = computeDungeonRunProfit({ ...baseParams, runMinutes: 25, partySize: 3 });

    expect(customized.runMinutes).toBe(25);
    expect(customized.partySize).toBe(3);
    expect(customized.perMemberDaily).toBeCloseTo(customized.perRunProfit * (1440 / 25), 6);
    expect(customized.teamDaily).toBeCloseTo(customized.perMemberDaily * 3, 6);
    // 每日成本 = 每轮总成本 × 每日轮数（与每日利润同源折算：每日利润 = 每日收入 − 每日成本）。
    expect(customized.runsPerDay).toBeCloseTo(1440 / 25, 9);
    expect(customized.dailyCost).toBeCloseTo(customized.totalCost * (1440 / 25), 6);
    expect(customized.perMemberDaily + customized.dailyCost).toBeCloseTo(customized.grossIncome * (1440 / 25), 6);

    // 缺省 partySize = 5、runMinutes = 目录默认值。
    const defaults = computeDungeonRunProfit(baseParams);
    expect(defaults.partySize).toBe(5);
    expect(defaults.teamDaily).toBeCloseTo(defaults.perMemberDaily * 5, 6);
    expect(defaults.dailyCost).toBeCloseTo(defaults.totalCost * defaults.runsPerDay, 6);

    // 消耗品并入每日成本（每轮总成本已含消耗品摊薄值）。
    const withConsumables = computeDungeonRunProfit({ ...baseParams, dailyConsumablesCost: 11_520_000 });
    expect(withConsumables.dailyCost).toBeCloseTo(withConsumables.totalCost * withConsumables.runsPerDay, 6);
    expect(withConsumables.dailyCost).toBeGreaterThan(defaults.dailyCost);

    // partySize 钳制到 [1, maxPartySize]。
    expect(computeDungeonRunProfit({ ...baseParams, partySize: 0 }).partySize).toBe(1);
    expect(computeDungeonRunProfit({ ...baseParams, partySize: 9 }).partySize).toBe(5);

    expect(computeDungeonRunProfit({ ...baseParams, dungeonHrid: '/actions/combat/not_a_dungeon' })).toBeNull();
    expect(computeDungeonRunProfit({})).toBeNull();
  });

  it('difficultyTier 钳制到 [0, maxDifficulty]', () => {
    expect(computeDungeonRunProfit({ ...baseParams, difficultyTier: 5 }).difficultyTier).toBe(2);
    expect(computeDungeonRunProfit({ ...baseParams, difficultyTier: -1 }).difficultyTier).toBe(0);
  });

  it('runMinutes 直调 -Infinity 回落目录默认（toFiniteNumber fallback，引擎收敛语义保持）', () => {
    const negativeInfinity = computeDungeonRunProfit({ ...baseParams, runMinutes: -Infinity });
    expect(negativeInfinity.runMinutes).toBeCloseTo(12.5, 12);
    expect(negativeInfinity.runsPerDay).toBeCloseTo(1440 / 12.5, 9);
  });
});

describe('computeDailyProfit 日收益', () => {
  it('perMemberDaily = 每轮净利 × 1440 ÷ 每轮分钟数，teamDaily × 队伍人数', () => {
    const tenMinutes = computeDailyProfit(1000, 10, 5);
    expect(tenMinutes.runsPerDay).toBe(144);
    expect(tenMinutes.perMemberDaily).toBe(144000);
    expect(tenMinutes.teamDaily).toBe(720000);
    expect(tenMinutes.partySize).toBe(5);

    const twelveAndHalf = computeDailyProfit(1000, 12.5, 5);
    expect(twelveAndHalf.runsPerDay).toBeCloseTo(115.2, 9);
    expect(twelveAndHalf.perMemberDaily).toBeCloseTo(115200, 6);
    expect(twelveAndHalf.teamDaily).toBeCloseTo(576000, 6);
  });

  it('partySize 覆盖 1-5 并钳制；runMinutes 非法值按 0 轮处理', () => {
    for (let partySize = 1; partySize <= 5; partySize += 1) {
      const result = computeDailyProfit(1000, 30, partySize);
      expect(result.partySize).toBe(partySize);
      expect(result.perMemberDaily).toBe(48000);
      expect(result.teamDaily).toBe(48000 * partySize);
    }

    expect(computeDailyProfit(1000, 30, 0).partySize).toBe(1);
    expect(computeDailyProfit(1000, 30, 9).partySize).toBe(5);
    expect(computeDailyProfit(1000, 30, undefined).partySize).toBe(5);

    const zero = computeDailyProfit(1000, 0, 5);
    expect(zero.runsPerDay).toBe(0);
    expect(zero.perMemberDaily).toBe(0);
    expect(zero.teamDaily).toBe(0);

    const negative = computeDailyProfit(-5000, 10, 2);
    expect(negative.perMemberDaily).toBe(-720000);
    expect(negative.teamDaily).toBe(-1440000);
  });
});

describe('compareDungeons 批量对比', () => {
  it('4 地牢 × T0/T1/T2 共 12 行，按 perRunProfit 降序且字段齐备', () => {
    const rows = compareDungeons({ priceTable: fixtureTable, buyMode: 'ask', sellMode: 'bid' }, 'perRunProfit');

    expect(rows).toHaveLength(12);
    expect(new Set(rows.map((row) => `${row.dungeonHrid}#${row.difficultyTier}`)).size).toBe(12);
    expect(isDescendingBy(rows, 'perRunProfit')).toBe(true);
    expect(rows[0].perRunProfit).toBeCloseTo(Math.max(...rows.map((row) => row.perRunProfit)), 6);

    const top = rows[0];
    expect(top.dungeonHrid).toBe(DUNGEON_HRIDS.chimerical);
    expect(top.difficultyTier).toBe(2);
    expect(top.runMinutes).toBeCloseTo(12.5, 12); // 缺省用各自地牢的默认每轮分钟数
    expect(top.teamDaily).toBeCloseTo(top.perMemberDaily * 5, 6);
    expect(top.refinementRate).toBeCloseTo(0.9, 12);
    expect(top.totalCost).toBeCloseTo(top.grossIncome - top.perRunProfit, 6);
    // 每日成本随行透传（= 每轮总成本 × 该行每日轮数），批量对比的「每日成本」列直接读它。
    expect(top.dailyCost).toBeCloseTo(top.totalCost * (1440 / top.runMinutes), 6);
    for (const row of rows) {
      expect(row.dailyCost).toBeCloseTo(row.totalCost * (1440 / row.runMinutes), 6);
    }

    // 每日产出列所需字段逐行透传（2026-10-15）：每日轮数 = 1440 ÷ 每轮分钟；
    // 主箱 / 精炼箱为每轮箱数，页面按「箱数 × 每日轮数」换算每日产量。
    expect(top.runsPerDay).toBeCloseTo(1440 / top.runMinutes, 6);
    expect(top.mainChestCount).toBeGreaterThan(0);
    expect(top.refinementChestCount).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.runsPerDay).toBeCloseTo(1440 / row.runMinutes, 6);
    }

    // T0 行精炼率为 0、且同地牢内 T2 ≥ T1 ≥ T0（增量收益单调）。
    const chimericalRows = rows.filter((row) => row.dungeonHrid === DUNGEON_HRIDS.chimerical);
    expect(chimericalRows.map((row) => row.difficultyTier)).toEqual([2, 1, 0]);
    expect(chimericalRows.find((row) => row.difficultyTier === 0).refinementRate).toBe(0);
  });

  it('排序键可切换（perRunProfit / perMemberDaily / teamDaily），各自单调不增', () => {
    const base = { priceTable: fixtureTable, buyMode: 'ask', sellMode: 'bid' };
    const byRun = compareDungeons(base, 'perRunProfit');
    const byMember = compareDungeons(base, 'perMemberDaily');
    const byTeam = compareDungeons(base, 'teamDaily');

    expect(isDescendingBy(byMember, 'perMemberDaily')).toBe(true);
    expect(isDescendingBy(byTeam, 'teamDaily')).toBe(true);
    expect(byMember[0].perMemberDaily).toBeCloseTo(Math.max(...byMember.map((row) => row.perMemberDaily)), 6);

    // 行集合与逐地牢数值一致，仅顺序可能不同。
    const keyOf = (row) => `${row.dungeonHrid}#${row.difficultyTier}`;
    expect(new Set(byMember.map(keyOf))).toEqual(new Set(byRun.map(keyOf)));
    expect(new Set(byTeam.map(keyOf))).toEqual(new Set(byRun.map(keyOf)));

    // 排序键确实参与排序：每轮净利最快的 chimerical（12.5 分钟）在日收益口径下更靠前。
    const rankOfChimericalT2 = (rows) => rows.findIndex((row) => keyOf(row) === `${DUNGEON_HRIDS.chimerical}#2`);
    expect(rankOfChimericalT2(byMember)).toBeLessThanOrEqual(rankOfChimericalT2(byRun));
    expect(byRun.map((row) => row.perRunProfit)).not.toEqual(byMember.map((row) => row.perMemberDaily));
  });

  it('未知排序键回退 perRunProfit；baseParams 可覆盖 runMinutes 与 partySize', () => {
    const fallback = compareDungeons({ priceTable: fixtureTable }, 'unknown_key');
    expect(isDescendingBy(fallback, 'perRunProfit')).toBe(true);

    const withOverrides = compareDungeons({ priceTable: fixtureTable, runMinutes: 20, partySize: 2 }, 'perMemberDaily');
    expect(withOverrides.every((row) => row.runMinutes === 20)).toBe(true);
    expect(withOverrides.every((row) => row.perMemberDaily === row.perRunProfit * 72)).toBe(true);
  });

  it('runMinutesByDungeonTier 按行取值：未设置行回落统一覆盖或各自默认', () => {
    const rows = compareDungeons(
      {
        priceTable: fixtureTable,
        buyMode: 'ask',
        sellMode: 'bid',
        runMinutes: 20,
        runMinutesByDungeonTier: {
          [DUNGEON_HRIDS.chimerical]: { 2: 10 },
          [DUNGEON_HRIDS.sinister]: { 0: 5 },
        },
      },
      'perRunProfit',
    );
    const findRow = (hrid, tier) => rows.find((row) => row.dungeonHrid === hrid && row.difficultyTier === tier);

    // 已设置行用行级覆盖值，日收益按行级时长折算。
    const chimericalT2 = findRow(DUNGEON_HRIDS.chimerical, 2);
    expect(chimericalT2.runMinutes).toBe(10);
    expect(chimericalT2.perMemberDaily).toBeCloseTo(chimericalT2.perRunProfit * (1440 / 10), 6);

    // 同地牢未设置的档位回落统一覆盖值 20；未设置的地牢同样回落统一覆盖值。
    expect(findRow(DUNGEON_HRIDS.chimerical, 1).runMinutes).toBe(20);
    expect(findRow(DUNGEON_HRIDS.sinister, 0).runMinutes).toBe(5);
    expect(findRow(DUNGEON_HRIDS.sinister, 2).runMinutes).toBe(20);

    // 行级非法值（0 / 非数）不生效：回落各自地牢默认值。
    const fallbackRows = compareDungeons(
      {
        priceTable: fixtureTable,
        buyMode: 'ask',
        sellMode: 'bid',
        runMinutesByDungeonTier: { [DUNGEON_HRIDS.chimerical]: { 2: 0, 1: 'bad' } },
      },
      'perRunProfit',
    );
    expect(
      fallbackRows.find((row) => row.dungeonHrid === DUNGEON_HRIDS.chimerical && row.difficultyTier === 2).runMinutes,
    ).toBeCloseTo(12.5, 12);
    expect(
      fallbackRows.find((row) => row.dungeonHrid === DUNGEON_HRIDS.chimerical && row.difficultyTier === 1).runMinutes,
    ).toBeCloseTo(12.5, 12);

    // 排序不受时长覆盖影响：仍是 12 行、perRunProfit 降序。
    expect(rows).toHaveLength(12);
    expect(isDescendingBy(rows, 'perRunProfit')).toBe(true);
  });

  it('统一覆盖 runMinutes 非正数不生效：负数 / 0 均回落各行默认，每日指标与每轮口径自洽', () => {
    const base = { priceTable: fixtureTable, buyMode: 'ask', sellMode: 'bid' };
    const keyOf = (row) => `${row.dungeonHrid}#${row.difficultyTier}`;
    const baselineRows = compareDungeons(base);
    const negativeRows = compareDungeons({ ...base, runMinutes: -5 });
    const zeroRows = compareDungeons({ ...base, runMinutes: 0 });

    // 统一覆盖负数 / 0 均跳过该级覆盖：逐行回落各自 defaultRunMinutes，与无覆盖基线逐位一致。
    expect(negativeRows.map(keyOf)).toEqual(baselineRows.map(keyOf));
    const fields = [
      'runMinutes',
      'runsPerDay',
      'perRunProfit',
      'totalCost',
      'perMemberDaily',
      'teamDaily',
      'dailyCost',
    ];
    for (const field of fields) {
      expect(negativeRows.map((row) => row[field])).toEqual(baselineRows.map((row) => row[field]));
      expect(zeroRows.map((row) => row[field])).toEqual(baselineRows.map((row) => row[field]));
    }

    // 修复锚点：负数不再经引擎收敛为 0 分钟（每天 0 轮的失衡行），而是取回默认时长参与换算。
    const top = negativeRows.find((row) => row.dungeonHrid === DUNGEON_HRIDS.chimerical && row.difficultyTier === 2);
    expect(top.runMinutes).toBeCloseTo(12.5, 12);
    expect(top.runsPerDay).toBeCloseTo(1440 / top.runMinutes, 9);
    expect(top.perMemberDaily).toBeCloseTo(top.perRunProfit * (1440 / top.runMinutes), 6);
    expect(top.teamDaily).toBeCloseTo(top.perMemberDaily * 5, 6);
    expect(top.dailyCost).toBeCloseTo(top.totalCost * (1440 / top.runMinutes), 6);
    expect(top.dailyCost).toBeGreaterThan(0);
  });

  it('每行透传门票 / 宝箱钥匙 / 消耗品三个成本分项，且 totalCost = 三项之和', () => {
    const rows = compareDungeons(
      {
        priceTable: fixtureTable,
        buyMode: 'ask',
        sellMode: 'bid',
        dailyConsumablesCost: 11_520_000,
        runMinutes: 12,
      },
      'perRunProfit',
    );

    expect(rows).toHaveLength(12);
    for (const row of rows) {
      // 每日 11.52M ÷ 120 轮/天 = 96,000 每轮（统一 12 分钟覆盖下逐行相同）。
      expect(row.consumablesCostPerRun).toBeCloseTo(96000, 6);
      expect(row.totalCost).toBeCloseTo(row.entryKeyCost + row.chestKeyCost + row.consumablesCostPerRun, 6);
      expect(row.totalCost).toBeCloseTo(row.grossIncome - row.perRunProfit, 6);
    }

    // chimerical T2 精确锚点：门票 30,000（ask）+ 宝箱钥匙 770,800（净）+ 消耗品 96,000。
    const chimericalT2 = rows.find((row) => row.dungeonHrid === DUNGEON_HRIDS.chimerical && row.difficultyTier === 2);
    expect(chimericalT2.entryKeyCost).toBe(30000);
    expect(chimericalT2.chestKeyCost).toBeCloseTo(770800, 6);
    expect(chimericalT2.totalCost).toBeCloseTo(896800, 6);
  });

  it('consumablesCostPerRunByDungeonTier 按行覆盖模拟实测消耗品花费（0 为合法实测值）', () => {
    const rows = compareDungeons(
      {
        priceTable: fixtureTable,
        buyMode: 'ask',
        sellMode: 'bid',
        dailyConsumablesCost: 11_520_000,
        runMinutes: 12,
        consumablesCostPerRunByDungeonTier: {
          [DUNGEON_HRIDS.chimerical]: { 2: 500_000, 1: 0 },
        },
      },
      'perRunProfit',
    );
    const findRow = (hrid, tier) => rows.find((row) => row.dungeonHrid === hrid && row.difficultyTier === tier);

    // 有实测值的行：逐行覆盖每日摊薄值（96,000）。
    expect(findRow(DUNGEON_HRIDS.chimerical, 2).consumablesCostPerRun).toBe(500_000);
    // 0 是合法实测值（模拟未吃到消耗品）：覆盖为 0 而非回落 96,000。
    expect(findRow(DUNGEON_HRIDS.chimerical, 1).consumablesCostPerRun).toBe(0);
    // 未覆盖的行回落每日摊薄值。
    expect(findRow(DUNGEON_HRIDS.chimerical, 0).consumablesCostPerRun).toBeCloseTo(96000, 6);
    expect(findRow(DUNGEON_HRIDS.sinister, 2).consumablesCostPerRun).toBeCloseTo(96000, 6);
    // totalCost 与分项自洽。
    expect(findRow(DUNGEON_HRIDS.chimerical, 2).totalCost).toBeCloseTo(
      findRow(DUNGEON_HRIDS.chimerical, 2).entryKeyCost + findRow(DUNGEON_HRIDS.chimerical, 2).chestKeyCost + 500_000,
      6,
    );
  });

  it('keySourceBreakdown：商店购买 / 自制双口径的每日成本、每日利润与利润差价自洽', () => {
    const rows = compareDungeons(
      {
        priceTable: fixtureTable,
        buyMode: 'ask',
        sellMode: 'bid',
        dailyConsumablesCost: 11_520_000,
        runMinutes: 12,
      },
      'perRunProfit',
    );
    const row = rows.find((item) => item.dungeonHrid === DUNGEON_HRIDS.chimerical && item.difficultyTier === 2);
    const runsPerDay = 1440 / 12;

    // 商店购买口径 = 现有行字段（口径不变锚点）：每日成本与 dailyCost、每日利润与 perMemberDaily 逐位一致。
    expect(row.keySourceBreakdown.market.perRunCost).toBeCloseTo(row.totalCost, 6);
    expect(row.keySourceBreakdown.market.dailyCost).toBeCloseTo(row.dailyCost, 6);
    expect(row.keySourceBreakdown.market.dailyProfit).toBeCloseTo(row.perMemberDaily, 6);

    // 自制口径独立复算：两把钥匙各自按 craft 单价重算（宝箱钥匙含 2% 回收折减）。
    const entryCraft = resolveEntryKeyCost({
      priceTable: fixtureTable,
      keyHrid: catalogByHrid.get(DUNGEON_HRIDS.chimerical).keyItemHrid,
      keySource: 'craft',
      buyMode: 'ask',
    });
    const chestCraft = resolveChestKeyCost({
      priceTable: fixtureTable,
      keyHrid: catalogByHrid.get(DUNGEON_HRIDS.chimerical).chestKeyHrid,
      keySource: 'craft',
      buyMode: 'ask',
      keysPerRun: 1 + row.refinementRate,
      recovery: true,
      recoveredKeysPerRun: catalogByHrid.get(DUNGEON_HRIDS.chimerical).chestKeyRecoveryPerChest,
    });
    const craftPerRun = entryCraft.cost + chestCraft.net + row.consumablesCostPerRun;

    expect(row.keySourceBreakdown.craft.perRunCost).toBeCloseTo(craftPerRun, 6);
    expect(row.keySourceBreakdown.craft.dailyCost).toBeCloseTo(craftPerRun * runsPerDay, 6);
    expect(row.keySourceBreakdown.craft.dailyProfit).toBeCloseTo((row.grossIncome - craftPerRun) * runsPerDay, 6);

    // 利润差价 = 自制每日利润 − 商店购买每日利润 =（市场每轮成本 − 自制每轮成本）× 每日轮数。
    expect(row.keySourceBreakdown.profitDelta).toBeCloseTo(
      row.keySourceBreakdown.craft.dailyProfit - row.keySourceBreakdown.market.dailyProfit,
      6,
    );
    expect(row.keySourceBreakdown.profitDelta).toBeCloseTo((row.totalCost - craftPerRun) * runsPerDay, 6);

    // 12 行全部带双口径（收入侧与消耗品两口径同值，故差额只来自钥匙）。
    for (const item of rows) {
      expect(item.keySourceBreakdown.market.perRunCost).toBeCloseTo(item.totalCost, 6);
      expect(item.keySourceBreakdown.profitDelta).toBeCloseTo(
        (item.keySourceBreakdown.market.perRunCost - item.keySourceBreakdown.craft.perRunCost) *
          (1440 / item.runMinutes),
        6,
      );
    }
  });
});

describe('computeConsumablesCost 模拟消耗品折算', () => {
  it('整队汇总：Σ 全部单位 × 市场价（buyMode 取价），空 / 脏值安全', () => {
    const table = patchQuotes(createZeroPriceTable(), {
      '/items/marsberry_cake': { ask: 1500, bid: 1400 },
      '/items/channeling_coffee': { ask: 300, bid: 280 },
    });

    // 两个单位各吃不同物品：整队相加后再乘各自价格。
    expect(
      computeConsumablesCost(
        {
          player1: { '/items/marsberry_cake': 57, '/items/channeling_coffee': 14 },
          player2: { '/items/marsberry_cake': 10 },
        },
        table,
        'ask',
      ),
    ).toBe(67 * 1500 + 14 * 300);

    // bid 取价（成本侧另一档）。
    expect(computeConsumablesCost({ player1: { '/items/marsberry_cake': 2 } }, table, 'bid')).toBe(2800);

    // 空表 / 未知物品（价格为 0）/ 负数与脏值：不炸且不计入。
    expect(computeConsumablesCost({}, table, 'ask')).toBe(0);
    expect(computeConsumablesCost(null, table, 'ask')).toBe(0);
    expect(computeConsumablesCost({ player1: { '/items/nope': 5, '/items/marsberry_cake': -3 } }, table, 'ask')).toBe(
      0,
    );
  });
});

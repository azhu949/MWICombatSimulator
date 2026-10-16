// 地下城收益计算器：纯函数引擎（无 Vue / DOM / 组件依赖，可在 worker 中调用）。
//
// 语义与数据口径要点：全部取价与计税委托 marketPriceService（费率常量、计税与宝箱合成价
// 一律不在此复制）：
// - 成本侧 resolveMarketPrice（买入不扣税）；
// - 收入侧 resolveMarketSalePrice（市场来源计税，coin/宝箱费率 0，牛铃 18%）；
// - 代币不可交易，按商店兑换物净卖价估值。
//
// 数据源：actionDetailMap.json（地牢 dungeonInfo，生成索引缺该投影）、
// openableLootDropMap.json（开箱表）、shopItemDetailMap.json（地牢商店兑换比）、
// communityBuffTypeDetailMap.json（社区 buff 系数）、itemDetailMap.json（工匠茶 /
// 暴饮之囊的非战斗浓度数据）、enhancementLevelTotalBonusMultiplierTable.json
// （暴饮之囊加浓的逐级强化倍率）。
import actionDetailMap from '../combatsimulator/data/actionDetailMap.json';
import communityBuffTypeDetailMap from '../combatsimulator/data/communityBuffTypeDetailMap.json';
import enhancementLevelTotalBonusMultiplierTable from '../combatsimulator/data/enhancementLevelTotalBonusMultiplierTable.json';
import itemDetailMap from '../combatsimulator/data/itemDetailMap.json';
import openableLootDropMap from '../combatsimulator/data/openableLootDropMap.json';
import shopItemDetailMap from '../combatsimulator/data/shopItemDetailMap.json';
import { getItemName } from '../shared/gameDataIndex.js';
import {
  getMarketSaleFeeRate,
  NON_TRADABLE_CAPE_HRIDS,
  normalizePriceMode,
  PRICE_MODE_ASK,
  PRICE_MODE_BID,
  resolveMarketPrice,
  resolveMarketSalePrice,
  TAX_MODE_MARKET,
} from './marketPriceService.js';

/**
 * @typedef {Object} PriceTable 市场价格表（marketPriceService.createDefaultPriceTable / hydrate 产物）
 * @typedef {Object} ItemExpectation 单宝箱开箱期望产物（同 itemHrid 已聚合）
 * @property {string} itemHrid
 * @property {number} expectedQty 期望数量 = Σ dropRate × (minCount + maxCount) / 2 × buffMultiplier
 */

export const DUNGEON_KEY_SOURCE_MARKET = 'market';
export const DUNGEON_KEY_SOURCE_CRAFT = 'craft';

const DUNGEON_ACTION_CATEGORY = '/action_categories/combat/dungeons';
const DUNGEON_KEY_CRAFT_CATEGORY = '/action_categories/crafting/dungeon_keys';
const DUNGEON_SHOP_CATEGORY = '/shop_categories/dungeon';
const COMBAT_DROP_QUANTITY_BUFF_HRID = '/community_buff_types/combat_drop_quantity';
const COIN_HRID = '/items/coin';
const LARGE_TREASURE_CHEST_HRID = '/items/large_treasure_chest';
const CHEST_KEY_SUFFIX = '_chest_key';
const TOKEN_SUFFIX = '_token';
const REFINEMENT_CHEST_MARKER = '_refinement_chest';

// 工匠茶：非战斗茶，buff flatBoost = 0.1（材料 lessResource 折扣）。
const ARTISAN_TEA_HRID = '/items/artisan_tea';
const ARTISAN_BUFF_TYPE_HRID = '/buff_types/artisan';
// 暴饮之囊：袋装备，加浓饮品浓度——基础 0.1 + 每级 0.002 × 强化倍率表[等级]。
// 强化倍率表 = enhancementLevelTotalBonusMultiplierTable（游戏通用强化倍率表，0-20 级）。
const GUZZLING_POUCH_HRID = '/items/guzzling_pouch';
const MAX_ENHANCEMENT_LEVEL = 20;

// 精炼箱掉率公式常数：四地牢 rewardDropTable 第二条同值（-0.3 / +0.6/档），
// 由测试的数据不变量逐地牢锁定；resolveRefinementChestRate 无地牢参数，故取模块常量。
const REFINEMENT_CHEST_BASE_DROP_RATE = -0.3;
const REFINEMENT_CHEST_DROP_RATE_PER_TIER = 0.6;
// 宝箱钥匙开箱回收锚点：四主箱开箱表内 own chest_key 0.02×[1,1]。
// 目录构建时按数据现值重算（chestKeyRecoveryPerChest），本常量仅作缺省兜底。
const CHEST_KEY_RECOVERY_PER_MAIN_CHEST = 0.02;
const DEFAULT_PARTY_SIZE = 5;
const MAX_PARTY_SIZE = 5;
const MAX_COMMUNITY_BUFF_LEVEL = 20;
const MINUTES_PER_DAY = 1440;

const TOKEN_HRIDS = new Set();
const TOKEN_EXCLUDED_HRIDS = new Set(NON_TRADABLE_CAPE_HRIDS);

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFiniteNumberOrNull(value) {
  if (value == null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function expectedDropCount(drop) {
  const dropRate = Math.max(0, toFiniteNumber(drop?.dropRate, 0));
  const minCount = Math.max(0, toFiniteNumber(drop?.minCount, 0));
  const maxCount = Math.max(0, toFiniteNumber(drop?.maxCount, 0));
  return (dropRate * (minCount + maxCount)) / 2;
}

function normalizeKeySource(source) {
  const normalized = String(source || '').toLowerCase();
  if (normalized === DUNGEON_KEY_SOURCE_CRAFT) {
    return DUNGEON_KEY_SOURCE_CRAFT;
  }
  return DUNGEON_KEY_SOURCE_MARKET;
}

function addToTotals(totals, order, itemHrid, qty) {
  if (!itemHrid || !(qty > 0)) {
    return;
  }
  if (!totals.has(itemHrid)) {
    totals.set(itemHrid, 0);
    order.push(itemHrid);
  }
  totals.set(itemHrid, totals.get(itemHrid) + qty);
}

// 钥匙自制配方索引：outputItems[0].itemHrid（= 钥匙 hrid）→ 配方材料与制作等级。
// 扫描 crafting/dungeon_keys 类别（8 条：4 门票 + 4 宝箱钥匙），不在服务层硬编码配方。
const keyCraftRecipeByOutputHrid = buildKeyCraftRecipeIndex();

function buildKeyCraftRecipeIndex() {
  const index = new Map();

  for (const action of Object.values(actionDetailMap || {})) {
    if (action?.category !== DUNGEON_KEY_CRAFT_CATEGORY) {
      continue;
    }

    const inputItems = (Array.isArray(action?.inputItems) ? action.inputItems : [])
      .map((input) => ({
        itemHrid: String(input?.itemHrid || ''),
        count: Math.max(0, toFiniteNumber(input?.count, 0)),
      }))
      .filter((input) => input.itemHrid && input.count > 0);

    for (const output of Array.isArray(action?.outputItems) ? action.outputItems : []) {
      const outputHrid = String(output?.itemHrid || '');
      if (!outputHrid) {
        continue;
      }
      index.set(outputHrid, {
        actionHrid: String(action?.hrid || ''),
        level: Math.max(0, toFiniteNumber(action?.levelRequirement?.level, 0)),
        skillHrid: String(action?.levelRequirement?.skillHrid || ''),
        outputCount: Math.max(1, toFiniteNumber(output?.count, 1)),
        inputItems,
      });
    }
  }

  return index;
}

/**
 * @typedef {Object} DungeonCatalogEntry 地牢静态档案（只读，勿修改返回对象）
 * @property {string} actionHrid 例 /actions/combat/chimerical_den
 * @property {string} name
 * @property {string} keyItemHrid 门票钥匙
 * @property {string} chestHrid 主宝箱
 * @property {string} chestKeyHrid 宝箱钥匙（主箱与精炼箱共用）
 * @property {string} refinementChestHrid 精炼宝箱
 * @property {number} refinementChestDropRate 精炼箱基础掉率（-0.3）
 * @property {number} refinementChestDropRatePerTier 每档增量（0.6）
 * @property {number} mainChestDropRate 主箱掉率（恒 1）
 * @property {number} largeChestMaxCount 主箱内 large_treasure_chest 的 maxCount（5/6/7/8）
 * @property {number} maxWaves
 * @property {number} maxDifficulty 恒 2
 * @property {number} maxPartySize 恒 5
 * @property {number} baseTimeCostSeconds 每波秒数（15）
 * @property {number} defaultRunMinutes maxWaves × baseTimeCostSeconds / 60
 * @property {string} tokenHrid 本地牢代币
 * @property {number} chestKeyRecoveryPerChest 单主箱开箱期望回收的宝箱钥匙数（0.02）
 * @property {number} entryCraftLevel 门票自制等级（70/85/90/80）
 * @property {number} chestKeyCraftLevel 宝箱钥匙自制等级
 * @property {number} sortIndex
 */

let cachedDungeonCatalog = null;

function buildDungeonCatalogInternal() {
  const entries = [];

  for (const action of Object.values(actionDetailMap || {})) {
    if (action?.category !== DUNGEON_ACTION_CATEGORY) {
      continue;
    }

    const dungeonInfo = action?.combatZoneInfo?.dungeonInfo;
    const rewardDrops = Array.isArray(dungeonInfo?.rewardDropTable) ? dungeonInfo.rewardDropTable : [];
    if (!dungeonInfo || rewardDrops.length === 0) {
      continue;
    }

    const mainChestDrop =
      rewardDrops.find((drop) => !String(drop?.itemHrid || '').includes(REFINEMENT_CHEST_MARKER)) || null;
    const refinementDrop =
      rewardDrops.find((drop) => String(drop?.itemHrid || '').includes(REFINEMENT_CHEST_MARKER)) || null;
    const chestHrid = String(mainChestDrop?.itemHrid || '');
    if (!chestHrid) {
      continue;
    }

    const chestDrops = Array.isArray(openableLootDropMap?.[chestHrid]) ? openableLootDropMap[chestHrid] : [];
    const largeChestDrop =
      chestDrops.find((drop) => String(drop?.itemHrid || '') === LARGE_TREASURE_CHEST_HRID) || null;
    const chestKeyDrops = chestDrops.filter((drop) => String(drop?.itemHrid || '').endsWith(CHEST_KEY_SUFFIX));
    const tokenDrop = chestDrops.find((drop) => String(drop?.itemHrid || '').endsWith(TOKEN_SUFFIX)) || null;
    const keyItemHrid = String(dungeonInfo?.keyItemHrid || '');
    const chestKeyHrid = String(chestKeyDrops[0]?.itemHrid || '');
    const baseTimeCostSeconds = Math.max(0, toFiniteNumber(action?.baseTimeCost, 0) / 1_000_000_000);
    const maxWaves = Math.max(0, toFiniteNumber(dungeonInfo?.maxWaves, 0));

    entries.push({
      actionHrid: String(action?.hrid || ''),
      name: String(action?.name || ''),
      keyItemHrid,
      chestHrid,
      chestKeyHrid,
      refinementChestHrid: String(refinementDrop?.itemHrid || ''),
      refinementChestDropRate: toFiniteNumber(refinementDrop?.dropRate, REFINEMENT_CHEST_BASE_DROP_RATE),
      refinementChestDropRatePerTier: toFiniteNumber(
        refinementDrop?.dropRatePerDifficultyTier,
        REFINEMENT_CHEST_DROP_RATE_PER_TIER,
      ),
      mainChestDropRate: toFiniteNumber(mainChestDrop?.dropRate, 1),
      largeChestMaxCount: Math.max(0, toFiniteNumber(largeChestDrop?.maxCount, 0)),
      maxWaves,
      maxDifficulty: Math.max(0, toFiniteNumber(action?.maxDifficulty, 0)),
      maxPartySize: clamp(toFiniteNumber(action?.maxPartySize, DEFAULT_PARTY_SIZE), 1, MAX_PARTY_SIZE),
      baseTimeCostSeconds,
      defaultRunMinutes: (maxWaves * baseTimeCostSeconds) / 60,
      tokenHrid: String(tokenDrop?.itemHrid || ''),
      chestKeyRecoveryPerChest: chestKeyDrops.reduce((sum, drop) => sum + expectedDropCount(drop), 0),
      entryCraftLevel: keyCraftRecipeByOutputHrid.get(keyItemHrid)?.level ?? 0,
      chestKeyCraftLevel: keyCraftRecipeByOutputHrid.get(chestKeyHrid)?.level ?? 0,
      sortIndex: toFiniteNumber(action?.sortIndex, 0),
    });
  }

  entries.sort((a, b) => a.sortIndex - b.sortIndex);
  return entries;
}

/**
 * 扫描 actionDetailMap 构建 4 地牢静态档案数组（按 sortIndex 排序，结果记忆化）。
 * @returns {DungeonCatalogEntry[]} 只读数组，调用方不得修改
 */
export function buildDungeonCatalog() {
  if (!cachedDungeonCatalog) {
    cachedDungeonCatalog = buildDungeonCatalogInternal();
    for (const entry of cachedDungeonCatalog) {
      if (entry.tokenHrid) {
        TOKEN_HRIDS.add(entry.tokenHrid);
      }
    }
  }
  return cachedDungeonCatalog;
}

/**
 * 精炼箱掉率：override 非空时优先取 override（标量含 0；或按档位对象 override[tier]，
 * 用于对齐脚本侧逐档精炼率），否则 max(0, dropRate + perTier × 档位)
 * 即 max(0, -0.3 + 0.6 × tier)（T0=0 / T1=0.3 / T2=0.9）。
 * @param {number} difficultyTier 0|1|2（超出 0-2 由公式自然外推）
 * @param {number|{[tier: number]: number}|null|undefined|''} override 覆盖值：
 *   number = 全档位统一覆盖；对象 = 按难度档位覆盖；null/undefined/'' = 官方公式
 * @returns {number} 精炼箱掉率，钳制到 [0, 1]
 */
export function resolveRefinementChestRate(difficultyTier, override) {
  const tier = toFiniteNumber(difficultyTier, 0);
  if (override != null && typeof override === 'object') {
    const perTier = toFiniteNumberOrNull(override[tier]);
    if (perTier != null) {
      return clamp(perTier, 0, 1);
    }
    // 对象缺档 / 非有限值：回落官方公式（不再走标量路径）。
    return clamp(REFINEMENT_CHEST_BASE_DROP_RATE + REFINEMENT_CHEST_DROP_RATE_PER_TIER * tier, 0, 1);
  }
  const normalizedOverride = toFiniteNumberOrNull(override);
  const rate =
    normalizedOverride != null
      ? normalizedOverride
      : REFINEMENT_CHEST_BASE_DROP_RATE + REFINEMENT_CHEST_DROP_RATE_PER_TIER * tier;
  return clamp(rate, 0, 1);
}

/**
 * 社区 buff 箱数倍率：关闭（level <= 0）为 1；L 级 = 1 + flatBoost + flatBoostLevelBonus × (L-1)，
 * L20 = 1.295（flatBoost 0.2 / bonus 0.005 取自 communityBuffTypeDetailMap）。
 * 2026-10-11 用户裁决：按社区口径作用于「每轮宝箱数量」（箱数 ×倍率），不再放大开箱内容物数量。
 * @param {number} communityBuffLevel 0 = 关闭，1-20 级（超过 20 按 20 钳制）
 * @returns {number}
 */
function resolveCommunityBuffMultiplier(communityBuffLevel) {
  const level = Math.max(0, Math.floor(toFiniteNumber(communityBuffLevel, 0)));
  if (level <= 0) {
    return 1;
  }

  const buff = communityBuffTypeDetailMap?.[COMBAT_DROP_QUANTITY_BUFF_HRID]?.buff || {};
  const cappedLevel = Math.min(MAX_COMMUNITY_BUFF_LEVEL, level);
  const ratioBoost = toFiniteNumber(buff?.ratioBoost, 0);
  const flatBoost = toFiniteNumber(buff?.flatBoost, 0);
  const flatBoostLevelBonus = toFiniteNumber(buff?.flatBoostLevelBonus, 0);
  return 1 + ratioBoost + flatBoost + flatBoostLevelBonus * (cappedLevel - 1);
}

/**
 * 单宝箱开箱期望产物（查 openableLootDropMap），同一 itemHrid 的多条掉落条目聚合为一条。
 * 期望数量 = dropRate × (minCount + maxCount) / 2 × buffMultiplier。
 * 注意：引擎主流程已改为「箱数模型」（社区 buff 作用于每轮箱数，见 computeDungeonRunProfit），
 * 该处恒传 1；本参数仅作通用期望倍率保留，buff 场景勿重复传入（防双重放大）。
 * @param {string} chestHrid 宝箱物品 hrid
 * @param {number} [buffMultiplier=1] 期望数量倍率（默认 1）
 * @returns {ItemExpectation[]} 按开箱表首次出现顺序；未知 / 空宝箱返回 []
 */
export function computeChestOpenExpectation(chestHrid, buffMultiplier = 1) {
  const drops = Array.isArray(openableLootDropMap?.[String(chestHrid || '')])
    ? openableLootDropMap[String(chestHrid || '')]
    : [];
  const multiplier = Math.max(0, toFiniteNumber(buffMultiplier, 1));
  const totals = new Map();
  const order = [];

  for (const drop of drops) {
    const itemHrid = String(drop?.itemHrid || '');
    addToTotals(totals, order, itemHrid, expectedDropCount(drop) * multiplier);
  }

  return order.map((itemHrid) => ({ itemHrid, expectedQty: totals.get(itemHrid) }));
}

/**
 * 代币单枚估值：max(可交易商店物净卖价 ÷ 兑换成本)，候选集为该代币在
 * /shop_categories/dungeon 的全部商店条目，排除 NON_TRADABLE_CAPE_HRIDS 披风类。
 * 代币本身不可交易（sellPrice 0），精华等 1:1 商店物自然被 max 覆盖。
 * @param {PriceTable} priceTable
 * @param {'bid'|'ask'} sellMode 卖出侧取价模式
 * @param {string} tokenHrid 代币 hrid
 * @returns {number} 代币单价（无候选 / 无价时为 0）
 */
export function resolveTokenUnitValue(priceTable, sellMode, tokenHrid) {
  const token = String(tokenHrid || '');
  if (!token) {
    return 0;
  }

  const mode = normalizePriceMode(sellMode, PRICE_MODE_BID);
  let best = 0;

  for (const shopItem of Object.values(shopItemDetailMap || {})) {
    if (shopItem?.category !== DUNGEON_SHOP_CATEGORY) {
      continue;
    }

    const tokenCost = (Array.isArray(shopItem?.costs) ? shopItem.costs : []).find(
      (cost) => String(cost?.itemHrid || '') === token,
    );
    const costCount = Math.max(0, toFiniteNumber(tokenCost?.count, 0));
    const itemHrid = String(shopItem?.itemHrid || '');
    if (!tokenCost || costCount <= 0 || !itemHrid || TOKEN_EXCLUDED_HRIDS.has(itemHrid)) {
      continue;
    }

    const netSalePrice = resolveMarketSalePrice(priceTable, itemHrid, mode, TAX_MODE_MARKET);
    best = Math.max(best, netSalePrice / costCount);
  }

  return best;
}

// 配方材料单价：coin 按面值 1 计，其余按 buyMode 取市场价（买入不扣税）。
function resolveMaterialUnitPrice(priceTable, itemHrid, buyMode) {
  if (String(itemHrid || '') === COIN_HRID) {
    return 1;
  }
  return resolveMarketPrice(priceTable, itemHrid, buyMode);
}

/**
 * 工匠茶材料折扣：非战斗茶「工匠茶」的 lessResource 抵扣，只作用于钥匙自制配方的
 * 材料成本（含 coin），不作用于市场购买价。
 * - lessResource = 工匠茶 flatBoost × (1 + 暴饮之囊加浓浓度)，钳制到 [0, 1]；
 * - 加浓浓度 = noncombatStats.drinkConcentration（0.1）+ noncombatEnhancementBonuses
 *   .drinkConcentration（0.002）× 通用强化倍率表[等级]。
 * 加浓逐级口径由游戏内实测锁定（2026-10-12 用户实测：+5 → 11.2% / +6 → 11.5% /
 * +7 → 11.82%，与 enhancementLevelTotalBonusMultiplierTable[5/6/7] = 6 / 7.5 / 9.1
 * 逐值吻合；MWITools 的 POUCH_DRINK_ENHANCEMENT_BONUSES 专用表恰为通用表的 1/50，
 * 资产分侧口径偏低，本引擎不沿用）。未勾选工匠茶 / 未勾选暴饮之囊时浓度系数为 1。
 * @param {Object} [params]
 * @param {boolean} [params.artisanTea=false] 是否使用工匠茶（false = 无折扣）
 * @param {boolean} [params.guzzlingPouch=false] 是否使用暴饮之囊（加浓）
 * @param {number} [params.guzzlingLevel=0] 暴饮之囊强化等级（0-20，越界钳制）
 * @returns {{materialMultiplier: number, lessResource: number, drinkConcentration: number}}
 *   materialMultiplier = 1 − lessResource，乘在自制配方的每项材料单价上
 */
export function resolveArtisanTeaDiscount({ artisanTea, guzzlingPouch, guzzlingLevel } = {}) {
  if (artisanTea !== true) {
    return { materialMultiplier: 1, lessResource: 0, drinkConcentration: 0 };
  }

  const artisanBuff = (itemDetailMap?.[ARTISAN_TEA_HRID]?.consumableDetail?.buffs || []).find(
    (buff) => String(buff?.typeHrid || '') === ARTISAN_BUFF_TYPE_HRID,
  );
  const artisanFlatBoost = Math.max(0, toFiniteNumber(artisanBuff?.flatBoost, 0));

  let drinkConcentration = 0;
  if (guzzlingPouch === true) {
    const pouchDetail = itemDetailMap?.[GUZZLING_POUCH_HRID]?.equipmentDetail || {};
    const baseConcentration = Math.max(0, toFiniteNumber(pouchDetail?.noncombatStats?.drinkConcentration, 0));
    const concentrationPerLevel = Math.max(
      0,
      toFiniteNumber(pouchDetail?.noncombatEnhancementBonuses?.drinkConcentration, 0),
    );
    const level = clamp(Math.floor(toFiniteNumber(guzzlingLevel, 0)), 0, MAX_ENHANCEMENT_LEVEL);
    const levelMultiplier = Math.max(0, toFiniteNumber(enhancementLevelTotalBonusMultiplierTable?.[level], 0));
    drinkConcentration = baseConcentration + concentrationPerLevel * levelMultiplier;
  }

  const lessResource = clamp(artisanFlatBoost * (1 + drinkConcentration), 0, 1);
  return { materialMultiplier: 1 - lessResource, lessResource, drinkConcentration };
}

// 钥匙成本两来源公共求值：market = buyMode 单价；craft = Σ 材料 buyMode 价 × 工匠茶折扣 ÷ 产出数量。
function resolveKeyCostBySource({ priceTable, keyHrid, keySource, buyMode, artisanTea, guzzlingPouch, guzzlingLevel }) {
  const hrid = String(keyHrid || '');
  const mode = normalizePriceMode(buyMode, PRICE_MODE_ASK);
  const normalizedSource = normalizeKeySource(keySource);
  const marketUnitPrice = resolveMarketPrice(priceTable, hrid, mode);
  const marketBreakdown = hrid
    ? [{ itemHrid: hrid, count: 1, unitPrice: marketUnitPrice, subtotal: marketUnitPrice }]
    : [];
  const recipe = keyCraftRecipeByOutputHrid.get(hrid) || null;

  let craftCost = null;
  let craftBreakdown = [];
  let materialMultiplier = 1;
  if (recipe) {
    materialMultiplier = resolveArtisanTeaDiscount({ artisanTea, guzzlingPouch, guzzlingLevel }).materialMultiplier;
    craftBreakdown = recipe.inputItems.map((input) => {
      // 工匠茶折扣按脚本口径乘在每项材料上（coin 一并参与：金币同样属于材料成本）。
      const unitPrice = resolveMaterialUnitPrice(priceTable, input.itemHrid, mode) * materialMultiplier;
      return { itemHrid: input.itemHrid, count: input.count, unitPrice, subtotal: unitPrice * input.count };
    });
    const materialCost = craftBreakdown.reduce((sum, row) => sum + row.subtotal, 0);
    craftCost = materialCost / recipe.outputCount;
  }

  let basis = DUNGEON_KEY_SOURCE_MARKET;
  let cost = marketUnitPrice;
  let breakdown = marketBreakdown;
  // 缺配方时回退市场价（8 把地牢钥匙配方齐备，此为防御分支）。
  if (normalizedSource === DUNGEON_KEY_SOURCE_CRAFT && craftCost != null) {
    basis = DUNGEON_KEY_SOURCE_CRAFT;
    cost = craftCost;
    breakdown = craftBreakdown;
  }

  return {
    source: normalizedSource,
    basis,
    cost,
    marketCost: marketUnitPrice,
    craftCost,
    materialMultiplier,
    breakdown,
    keyHrid: hrid,
    hasCraftRecipe: Boolean(recipe),
    craftLevel: recipe?.level ?? 0,
  };
}

/**
 * 门票钥匙成本（2026-10-15 裁决）：
 * - market：门票 buyMode 单价；
 * - craft：Σ 配方材料 buyMode 价 × 工匠茶折扣（÷ 配方产出数量），coin 按面值一并参与折扣；
 * - gross = 单把成本 × keysPerRun（门票按官方机制随「收到的普通宝箱数」消耗，精炼箱不计；
 *   keysPerRun 缺省 1；单把语义字段 cost / marketCost / craftCost 不受数量影响）。
 * @param {Object} params
 * @param {PriceTable} params.priceTable
 * @param {string} params.keyHrid 门票钥匙 hrid
 * @param {'market'|'craft'} [params.keySource='market']
 * @param {'ask'|'bid'} [params.buyMode='ask'] 成本侧取价模式（买入不扣税）
 * @param {number} [params.keysPerRun=1] 每轮消耗门票数（= 每轮普通宝箱数；2026-10-15 起按箱数）
 * @param {boolean} [params.artisanTea=false] 是否使用工匠茶（材料折扣，只作用于 craft）
 * @param {boolean} [params.guzzlingPouch=false] 是否使用暴饮之囊（加浓工匠茶折扣）
 * @param {number} [params.guzzlingLevel=0] 暴饮之囊强化等级（0-20）
 * @returns {{source: string, basis: string, cost: number, marketCost: number, craftCost: number|null,
 *   materialMultiplier: number, gross: number, unitCost: number, keysPerRun: number,
 *   breakdown: Array<{itemHrid: string, count: number, unitPrice: number, subtotal: number}>,
 *   keyHrid: string, hasCraftRecipe: boolean, craftLevel: number}}
 */
export function resolveEntryKeyCost(params = {}) {
  const base = resolveKeyCostBySource(params);
  const keysPerRun = Math.max(0, toFiniteNumber(params.keysPerRun, 1));
  return { ...base, gross: base.cost * keysPerRun, unitCost: base.cost, keysPerRun };
}

/**
 * 宝箱钥匙成本：两来源同门票，再按开箱 2% 回收折减（净消耗口径）。
 * net = gross − 回收钥匙数 × 单价（仅当 recoveryDiscountEnabled 为 true 时折减）；
 * keysPerRun=1 时即 gross × 0.98（成本侧回收率 0.98）。
 * 回收落点由调用方决定，两种口径互斥（防收入/成本双计）：
 * - 成本侧折减（recovery 为 true，对应 chestKeyRecoveryMode='cost'）：收入侧剔除返还钥匙行；
 * - 收入侧计入（recovery 为 false，对应 chestKeyRecoveryMode='income'）：成本侧取毛额，返还钥匙
 *   价值走收入行；本函数此时照常上报回收量，只是不做成本侧折减。
 * @param {Object} params
 * @param {PriceTable} params.priceTable
 * @param {string} params.keyHrid 宝箱钥匙 hrid
 * @param {'market'|'craft'} [params.keySource='market']
 * @param {'ask'|'bid'} [params.buyMode='ask']
 * @param {number} [params.keysPerRun=1] 每轮消耗钥匙数（主箱 1 + 精炼箱掉率）
 * @param {boolean} [params.recovery=true] 是否在成本侧按回收折减（= 返回的 recoveryDiscountEnabled）；
 *   不影响 recoveredKeysPerRun 的上报数量
 * @param {number} [params.recoveredKeysPerRun] 每轮回收钥匙数，缺省 0.02 × mainChestsPerRun；
 *   恒为真实回收量，不随折减开关归零（需要按 0 计量时显式传 0）
 * @param {number} [params.mainChestsPerRun=1] 每轮主箱数（回收来源，精炼箱不回钥匙）
 * @param {boolean} [params.artisanTea=false] 是否使用工匠茶（材料折扣，只作用于 craft）
 * @param {boolean} [params.guzzlingPouch=false] 是否使用暴饮之囊（加浓工匠茶折扣）
 * @param {number} [params.guzzlingLevel=0] 暴饮之囊强化等级（0-20）
 * @returns {{source: string, basis: string, gross: number, net: number, recoveryRate: number,
 *   unitCost: number, keysPerRun: number, recoveredKeysPerRun: number, recoveryDiscountEnabled: boolean,
 *   materialMultiplier: number,
 *   breakdown: Array<{itemHrid: string, count: number, unitPrice: number, subtotal: number}>, keyHrid: string}}
 *   语义：recoveredKeysPerRun 恒为真实回收量（不随折减开关归零）；recoveryDiscountEnabled 是净额（net）
 *   唯一的折减开关，也是收入侧口径下判断「回收价值是否已走收入行」的依据；recoveryRate 为成本侧
 *   净 / 毛比（未折减时恒为 1；收入侧口径下回收价值不在本明细内体现）。
 */
export function resolveChestKeyCost(params = {}) {
  const base = resolveKeyCostBySource(params);
  const keysPerRun = Math.max(0, toFiniteNumber(params.keysPerRun, 1));
  const mainChestsPerRun = Math.max(0, toFiniteNumber(params.mainChestsPerRun, 1));
  // 成本侧折减开关：与「回收量上报」解耦——收入侧落点下回收量照常上报，只是不在成本侧折减。
  const recoveryDiscountEnabled = params.recovery !== false;
  const recoveredKeysPerRun = Math.max(
    0,
    toFiniteNumber(params.recoveredKeysPerRun, CHEST_KEY_RECOVERY_PER_MAIN_CHEST * mainChestsPerRun),
  );
  const gross = base.cost * keysPerRun;
  const net = recoveryDiscountEnabled ? Math.max(0, gross - base.cost * recoveredKeysPerRun) : gross;

  return {
    ...base,
    gross,
    net,
    recoveryRate: gross > 0 ? net / gross : 1,
    unitCost: base.cost,
    keysPerRun,
    recoveredKeysPerRun,
    recoveryDiscountEnabled,
  };
}

/**
 * @typedef {Object} DungeonProfitParams 每轮收益计算参数
 * @property {string} dungeonHrid 地牢动作 hrid（buildDungeonCatalog 的 actionHrid）
 * @property {0|1|2} [difficultyTier=0] 难度档，自动钳制到 [0, maxDifficulty]
 * @property {PriceTable} priceTable 价格表（必填，纯函数注入）
 * @property {'ask'|'bid'} [buyMode='ask'] 买入侧（成本）取价模式
 * @property {'bid'|'ask'} [sellMode='bid'] 卖出侧（收入）取价模式
 * @property {'market'|'craft'} [keySource='market'] 两把钥匙的基础来源
 * @property {'market'|'craft'} [entryKeySource] 门票来源（覆盖 keySource）
 * @property {'market'|'craft'} [chestKeySource] 宝箱钥匙来源（覆盖 keySource）
 * @property {boolean} [artisanTea=false] 是否使用工匠茶（钥匙自制配方的材料折扣；
 *   只作用于 craft 来源，market 来源不受影响）
 * @property {boolean} [guzzlingPouch=false] 是否使用暴饮之囊（加浓工匠茶折扣）
 * @property {number} [guzzlingLevel=0] 暴饮之囊强化等级（0-20，越界钳制）
 * @property {number|null} [refinementRateOverride=null] 精炼箱掉率覆盖（null = 官方公式）
 * @property {boolean} [chestKeyRecovery=true] 宝箱钥匙 2% 回收开关
 * @property {'cost'|'income'} [chestKeyRecoveryMode='cost'] 回收落点（默认关 = 现状净消耗口径）：
 *   'cost' = 成本侧按回收折减（收入侧剔除返还钥匙行）；'income' = 成本侧取毛额 + 收入侧计入
 *   返还钥匙行（按 sellMode 市场净价定价；对齐脚本侧口径，默认关）。
 *   落点在明细中体现为 chestKeyCostDetail.recoveryDiscountEnabled（成本侧是否折减）；
 *   chestKeyCostDetail.recoveredKeysPerRun 与落点无关，恒为真实回收量
 *   本产品 builder（dungeonCalculatorStore.js 的 buildParams）恒传 'income'（2026-10-15 用户裁决：不再提供配置）。
 *   引擎默认 'cost' 仅为引擎级行为锚点，不代表本产品默认口径。
 * @property {number} [communityBuffLevel=0] 社区 buff 等级（0=关，1-20；按社区口径放大每轮箱数）
 * @property {number} [runMinutes] 每轮分钟数，缺省 maxWaves × 15s / 60
 * @property {number} [partySize=5] 队伍人数，钳制到 [1, maxPartySize]
 * @property {number} [dailyConsumablesCost=0] 每日消耗品成本（金币；食物 / 饮品等，玩家个人口径）
 * @property {number|null} [consumablesCostPerRunOverride=null] 每轮消耗品成本覆盖（金币；模拟实测
 *   写回值，按当前选中角色「窗口内花费 ÷ 窗口内通关次数」折算），有限非负数生效——0 是合法覆盖，
 *   非空时优先于 dailyConsumablesCost 的摊薄值
 */

/**
 * 每轮收益主计算：产物明细、毛收入、两把钥匙成本与每轮净利。
 * 产出 = mainChestCount 主箱 + refinementChestCount 精炼箱：官方箱数公式 = 5 ÷ 队伍人数 ×
 * (1 + CDQ)，即每人箱数按人数平分（2026-10-15 用户裁决）；社区 buff 按社区口径放大「每轮箱数」。
 * 门票（进本钥匙）按官方机制随「收到的普通宝箱数」消耗（2026-10-15 用户裁决，推翻 10-11「恒 1 张」：
 * 进入不消耗、通关结算按箱数扣；精炼箱不消耗门票）。
 * large_treasure_chest 直接取价格表合成条目价（费率 0，不二次征税）。
 * @param {DungeonProfitParams} params
 * @returns {Object|null} 未知地牢返回 null
 */
export function computeDungeonRunProfit(params = {}) {
  const catalog = buildDungeonCatalog();
  const entry = catalog.find((item) => item.actionHrid === String(params.dungeonHrid || '')) || null;
  if (!entry) {
    return null;
  }

  const priceTable = params.priceTable && typeof params.priceTable === 'object' ? params.priceTable : {};
  const buyMode = normalizePriceMode(params.buyMode, PRICE_MODE_ASK);
  const sellMode = normalizePriceMode(params.sellMode, PRICE_MODE_BID);
  const difficultyTier = clamp(Math.floor(toFiniteNumber(params.difficultyTier, 0)), 0, entry.maxDifficulty);
  const refinementRate = resolveRefinementChestRate(difficultyTier, params.refinementRateOverride);
  // 宝箱钥匙回收落点（默认 'cost' = 现状净消耗口径）：
  // - 'cost'：成本侧按回收折减（resolveChestKeyCost 净额），收入侧剔除返还钥匙行；
  // - 'income'：成本侧取毛额（无折减），返还钥匙行计入收入（下方循环按 sellMode 市场净价定价）。
  const recoveryEnabled = params.chestKeyRecovery !== false;
  const chestKeyRecoveryMode = params.chestKeyRecoveryMode === 'income' ? 'income' : 'cost';
  const buffMultiplier = resolveCommunityBuffMultiplier(params.communityBuffLevel);
  const runMinutes = Math.max(0, toFiniteNumber(params.runMinutes, entry.defaultRunMinutes) || entry.defaultRunMinutes);
  const partySize = clamp(Math.floor(toFiniteNumber(params.partySize, DEFAULT_PARTY_SIZE)), 1, entry.maxPartySize);

  // 产物期望（箱数模型，官方公式 + 社区口径）：官方箱数公式 Chests = 5 ÷ 队伍人数 × (1 + CDQ)——
  // 每次通关的宝箱产出按队伍人数平分（人越少每人分得越多）；每人箱数 = max(0, 主箱掉率) × 5 ÷ 人数
  // × buff 倍率、精炼箱数 = 精炼率 × 5 ÷ 人数 × buff 倍率（2026-10-15 用户裁决对齐官方/工具箱；
  // 5 人满编时人数因子为 1，与旧口径逐位一致）；
  // 开箱内容物按「单箱期望 × 箱数」累入，单箱期望恒传 1（不再单独乘 buff，防双重放大）。
  const partySizeFactor = MAX_PARTY_SIZE / partySize;
  const mainChestCount = Math.max(0, entry.mainChestDropRate) * partySizeFactor * buffMultiplier;
  const refinementChestCount = refinementRate * partySizeFactor * buffMultiplier;
  const totals = new Map();
  const order = [];
  const chestPlan = [
    { chestHrid: entry.chestHrid, count: mainChestCount },
    { chestHrid: entry.refinementChestHrid, count: refinementChestCount },
  ];

  for (const plan of chestPlan) {
    // 宝箱本体按数量累入产出（主箱箱体不可交易、价格为 0）。
    addToTotals(totals, order, plan.chestHrid, plan.count);
    for (const expectation of computeChestOpenExpectation(plan.chestHrid, 1)) {
      // 开箱返还的宝箱钥匙行落点（默认 'cost' 净消耗口径——收入与成本两口径只能取一，
      // 防双计）：
      // - 'cost'：不单独计入收入，其价值通过成本侧「回收折减」体现；
      // - 'income'：计入收入（下方循环按 sellMode 市场净价定价），成本侧相应取毛额不折减。
      if (expectation.itemHrid === entry.chestKeyHrid && !(recoveryEnabled && chestKeyRecoveryMode === 'income')) {
        continue;
      }
      addToTotals(totals, order, expectation.itemHrid, expectation.expectedQty * plan.count);
    }
  }

  const tokenUnitValueCache = new Map();
  const items = [];
  let grossIncome = 0;

  for (const itemHrid of order) {
    const qty = totals.get(itemHrid);
    const isToken = TOKEN_HRIDS.has(itemHrid);
    let unitPrice = 0;
    let priceSource = 'market_sale';

    if (isToken) {
      // 代币不可交易：按商店兑换物净卖价估值，非市场成交来源、不另计 4% 税。
      if (!tokenUnitValueCache.has(itemHrid)) {
        tokenUnitValueCache.set(itemHrid, resolveTokenUnitValue(priceTable, sellMode, itemHrid));
      }
      unitPrice = tokenUnitValueCache.get(itemHrid);
      priceSource = 'shop_token_exchange';
    } else {
      unitPrice = resolveMarketSalePrice(priceTable, itemHrid, sellMode, TAX_MODE_MARKET);
    }

    const subtotal = qty * unitPrice;
    grossIncome += subtotal;
    items.push({
      itemHrid,
      itemName: getItemName(itemHrid),
      qty,
      unitPrice,
      subtotal,
      taxRate: isToken ? null : getMarketSaleFeeRate(itemHrid),
      priceSource,
      isChest: itemHrid === entry.chestHrid || itemHrid === entry.refinementChestHrid,
    });
  }

  const entryKeySource = params.entryKeySource ?? params.keySource;
  const chestKeySource = params.chestKeySource ?? params.keySource;
  // 工匠茶 / 暴饮之囊：只作用于两把钥匙的自制（craft）配方材料成本，市场购买价不受影响。
  const artisanDiscountParams = {
    artisanTea: params.artisanTea === true,
    guzzlingPouch: params.guzzlingPouch === true,
    guzzlingLevel: params.guzzlingLevel,
  };
  const entryKeyCostDetail = resolveEntryKeyCost({
    priceTable,
    keyHrid: entry.keyItemHrid,
    keySource: entryKeySource,
    buyMode,
    // 门票按官方机制随「收到的普通宝箱数」消耗（2026-10-15 裁决）：每轮门票数 = 每轮主箱数
    //（精炼箱不消耗门票）；人数因子与社区 buff 已含在 mainChestCount 内。
    keysPerRun: mainChestCount,
    ...artisanDiscountParams,
  });
  // 每轮宝箱钥匙数：主箱数 + 精炼箱数（精炼箱与主箱共用同一把钥匙；箱数随社区 buff 放大，
  // 钥匙消耗同步放大）；
  // 回收只来自主箱（精炼箱开箱表无 chest_key），故回收量按主箱数计；
  // 回收折减仅在 'cost' 落点启用（收入侧已剔除返还钥匙行）；'income' 模式成本侧取毛额、
  // 回收价值走收入侧钥匙行（两者互斥；成本侧折减开关 = 上方局部 recoveryEnabled 且落点为 'cost'）。
  const chestKeysPerRun = mainChestCount + refinementChestCount;
  const chestKeyCostDetail = resolveChestKeyCost({
    priceTable,
    keyHrid: entry.chestKeyHrid,
    keySource: chestKeySource,
    buyMode,
    keysPerRun: chestKeysPerRun,
    recovery: recoveryEnabled && chestKeyRecoveryMode === 'cost',
    recoveredKeysPerRun: entry.chestKeyRecoveryPerChest * mainChestCount,
    ...artisanDiscountParams,
  });

  // 每日消耗品成本（食物 / 饮品等，MST 工具箱同款口径）：每日固定支出，不随每轮分钟摊薄，
  // 故按每日成本 ÷ 每日轮数摊到每轮（净利与成本明细同一口径；「每日」为玩家个人支出）。
  // 模拟实测覆盖（consumablesCostPerRunOverride）优先：模拟已按「该角色窗口内花费 ÷ 窗口内通关
  // 次数」折算成每轮值（药钱归属吃药的该角色本人），无需再按每日轮数摊薄；0 是合法覆盖值。
  const dailyConsumablesCost = Math.max(0, toFiniteNumber(params.dailyConsumablesCost, 0));
  const runsPerDay = runMinutes > 0 ? MINUTES_PER_DAY / runMinutes : 0;
  const overrideConsumablesCostPerRun = toFiniteNumberOrNull(params.consumablesCostPerRunOverride);
  const consumablesCostPerRun =
    overrideConsumablesCostPerRun != null
      ? Math.max(0, overrideConsumablesCostPerRun)
      : runsPerDay > 0
        ? dailyConsumablesCost / runsPerDay
        : 0;

  const totalCost = entryKeyCostDetail.gross + chestKeyCostDetail.net + consumablesCostPerRun;
  const perRunProfit = grossIncome - totalCost;
  const daily = computeDailyProfit(perRunProfit, runMinutes, partySize);

  return {
    dungeonHrid: entry.actionHrid,
    dungeonName: entry.name,
    difficultyTier,
    refinementRate,
    // 箱数模型回显：每轮主箱数 / 精炼箱数（= 基础数量 × buff 倍率；buff=1 时 1 / refinementRate）。
    mainChestCount,
    refinementChestCount,
    buffMultiplier,
    buyMode,
    sellMode,
    entryKeySource: entryKeyCostDetail.source,
    chestKeySource: chestKeyCostDetail.source,
    // 工匠茶 / 暴饮之囊回显：materialMultiplier = 1 − lessResource，只作用于 craft 来源。
    artisanTea: artisanDiscountParams.artisanTea,
    guzzlingPouch: artisanDiscountParams.guzzlingPouch,
    guzzlingLevel: clamp(Math.floor(toFiniteNumber(artisanDiscountParams.guzzlingLevel, 0)), 0, MAX_ENHANCEMENT_LEVEL),
    runMinutes,
    partySize,
    tokenHrid: entry.tokenHrid,
    tokenUnitValue: entry.tokenHrid ? (tokenUnitValueCache.get(entry.tokenHrid) ?? 0) : 0,
    items,
    grossIncome,
    entryKeyCost: entryKeyCostDetail.gross,
    chestKeyCost: chestKeyCostDetail.net,
    chestKeyGrossCost: chestKeyCostDetail.gross,
    chestKeyRecoveryMode,
    dailyConsumablesCost,
    consumablesCostPerRun,
    // 模拟实测覆盖回显（null = 未覆盖，消耗品成本来自 dailyConsumablesCost 摊薄）。
    consumablesCostPerRunOverride: overrideConsumablesCostPerRun,
    totalCost,
    perRunProfit,
    perMemberDaily: daily.perMemberDaily,
    teamDaily: daily.teamDaily,
    runsPerDay: daily.runsPerDay,
    // 每日成本 = 每轮总成本（门票 + 宝箱钥匙净 + 消耗品）× 每日轮数；
    // 与 perMemberDaily（每日利润）同源折算，两者之差即每日收入。
    dailyCost: totalCost * runsPerDay,
    // 批量对比的「商店购买 / 自制」双口径（收入侧与消耗品成本与钥匙来源无关，
    // 两口径只差门票 + 宝箱钥匙两项，故由已解析明细直接推导，不重跑产物求值）。
    keySourceBreakdown: resolveKeySourceBreakdown({
      entryKeyCostDetail,
      chestKeyCostDetail,
      consumablesCostPerRun,
      grossIncome,
      runsPerDay,
    }),
    entryKeyCostDetail,
    chestKeyCostDetail,
  };
}

/**
 * 双口径派生：把已解析的门票 / 宝箱钥匙明细折算成「商店购买」与「自制」两套口径的
 * 每轮成本、每日成本与每日利润（供批量对比的两组列直接取用）。
 *
 * - 收入侧（grossIncome）与消耗品成本不随钥匙来源变化，两口径下同值；
 * - 门票 / 宝箱钥匙均按明细中各自的 keysPerRun 重算（门票 = 普通箱数，2026-10-15 裁决）；
 * - 宝箱钥匙按各自单价重算开箱 2% 回收折减（keysPerRun / recoveredKeysPerRun 取自明细，
 *   折减开关取明细的 recoveryDiscountEnabled——与数量上报解耦）；
 * - 某把钥匙缺自制配方时自制口径回落市场单价（与 resolveKeyCostBySource 的防御分支一致）；
 * - profitDelta = 自制每日利润 − 商店购买每日利润，正值表示自制更划算。
 *
 * @param {Object} params
 * @param {Object} params.entryKeyCostDetail resolveEntryKeyCost 的返回值
 * @param {Object} params.chestKeyCostDetail resolveChestKeyCost 的返回值
 * @param {number} params.consumablesCostPerRun 每轮消耗品成本（金币）
 * @param {number} params.grossIncome 每轮毛收入（金币）
 * @param {number} params.runsPerDay 每日轮数
 * @returns {{market: {perRunCost: number, dailyCost: number, dailyProfit: number},
 *   craft: {perRunCost: number, dailyCost: number, dailyProfit: number},
 *   profitDelta: number}}
 */
function resolveKeySourceBreakdown({
  entryKeyCostDetail,
  chestKeyCostDetail,
  consumablesCostPerRun,
  grossIncome,
  runsPerDay,
}) {
  const entryUnit = resolveKeySourceUnitCosts(entryKeyCostDetail);
  const chestUnit = resolveKeySourceUnitCosts(chestKeyCostDetail);
  const entryKeysPerRun = Math.max(0, toFiniteNumber(entryKeyCostDetail?.keysPerRun, 1));
  const chestKeysPerRun = Math.max(0, toFiniteNumber(chestKeyCostDetail?.keysPerRun, 1));
  const recoveredKeysPerRun = Math.max(0, toFiniteNumber(chestKeyCostDetail?.recoveredKeysPerRun, 0));
  const recoveryDiscount = chestKeyCostDetail?.recoveryDiscountEnabled === true;
  const consumables = Math.max(0, toFiniteNumber(consumablesCostPerRun, 0));
  const income = toFiniteNumber(grossIncome, 0);
  const runs = Math.max(0, toFiniteNumber(runsPerDay, 0));

  // 宝箱钥匙按来源重算净消耗：回收折减按「单价 × 回收把数」抵减毛额。
  const chestNetCost = (unitCost) => {
    const gross = unitCost * chestKeysPerRun;
    return recoveryDiscount ? Math.max(0, gross - unitCost * recoveredKeysPerRun) : gross;
  };

  const buildBasis = (unitCosts) => {
    const perRunCost = unitCosts.entry * entryKeysPerRun + chestNetCost(unitCosts.chest) + consumables;
    return {
      perRunCost,
      dailyCost: perRunCost * runs,
      dailyProfit: (income - perRunCost) * runs,
    };
  };

  const market = buildBasis({ entry: entryUnit.market, chest: chestUnit.market });
  const craft = buildBasis({ entry: entryUnit.craft, chest: chestUnit.craft });

  return {
    market,
    craft,
    profitDelta: craft.dailyProfit - market.dailyProfit,
  };
}

// 单把钥匙的两种来源单价：market 恒有值；craft 缺配方时为 null（回落 market）。
function resolveKeySourceUnitCosts(detail) {
  const market = Math.max(0, toFiniteNumber(detail?.marketCost, 0));
  const craft = toFiniteNumberOrNull(detail?.craftCost);
  return { market, craft: craft == null ? market : Math.max(0, craft) };
}

/**
 * 日收益折算：perMemberDaily = perRunProfit × (1440 / runMinutes)；teamDaily = perMemberDaily × partySize。
 * @param {number} perRunProfit 单人单轮净利
 * @param {number} runMinutes 每轮分钟数（<= 0 视为 0 轮/天）
 * @param {number} [partySize=5] 队伍人数，钳制到 [1, 5]
 * @returns {{perMemberDaily: number, teamDaily: number, runsPerDay: number, partySize: number}}
 */
export function computeDailyProfit(perRunProfit, runMinutes, partySize = DEFAULT_PARTY_SIZE) {
  const minutes = Math.max(0, toFiniteNumber(runMinutes, 0));
  const size = clamp(Math.floor(toFiniteNumber(partySize, DEFAULT_PARTY_SIZE)), 1, MAX_PARTY_SIZE);
  const runsPerDay = minutes > 0 ? MINUTES_PER_DAY / minutes : 0;
  const perMemberDaily = toFiniteNumber(perRunProfit, 0) * runsPerDay;

  return {
    perMemberDaily,
    teamDaily: perMemberDaily * size,
    runsPerDay,
    partySize: size,
  };
}

/**
 * 模拟实测消耗品花费：Σ 全部单位（整队）Σ 物品数量 × 市场价（买入不扣税，成本侧口径）。
 * consumablesUsed 为战斗模拟结果字段（{ [unitHrid]: { [itemHrid]: count } }，副本 / 区域通用），
 * 汇总口径与 profitEstimator 的消耗品成本一致（不过滤分类：引擎只记录实际吃掉的药 / 饮料）。
 * @param {Object} consumablesUsed
 * @param {PriceTable} priceTable
 * @param {'ask'|'bid'} [priceMode='ask'] 成本侧取价模式
 * @returns {number} 金币总额（无消耗 / 无价时为 0）
 */
export function computeConsumablesCost(consumablesUsed, priceTable, priceMode = PRICE_MODE_ASK) {
  const mode = normalizePriceMode(priceMode, PRICE_MODE_ASK);
  let total = 0;

  for (const unitTable of Object.values(consumablesUsed || {})) {
    for (const [itemHrid, count] of Object.entries(unitTable || {})) {
      total += Math.max(0, toFiniteNumber(count, 0)) * Math.max(0, resolveMarketPrice(priceTable, itemHrid, mode));
    }
  }

  return total;
}

// 行级每轮分钟解析：runMinutesByDungeonTier[hrid][tier]（行级覆盖）优先，其次统一覆盖
// baseParams.runMinutes，最后回落该行 defaultRunMinutes；两级覆盖同口径——仅有限正数生效
//（负数 / 0 / 非有限值跳过该级覆盖），防统一覆盖负数经引擎收敛为 0 分钟、产生「每轮成本
// 为正但每天 0 轮」的失衡行（每日利润与每日成本恒 0，而行仍参与排序）。
function resolveRowRunMinutes(baseParams, entry, tier) {
  const overrideValue = toFiniteNumberOrNull(baseParams?.runMinutesByDungeonTier?.[entry.actionHrid]?.[tier]);
  if (overrideValue !== null && overrideValue > 0) {
    return overrideValue;
  }
  const unifiedValue = toFiniteNumberOrNull(baseParams?.runMinutes);
  if (unifiedValue !== null && unifiedValue > 0) {
    return unifiedValue;
  }
  return entry.defaultRunMinutes;
}

// 行级模拟实测消耗品花费解析：consumablesCostPerRunByDungeonTier[hrid][tier] 命中即返回
//（0 为合法实测值——模拟未吃到消耗品，需要覆盖每日摊薄），否则返回 null 由引擎回落摊薄口径。
function resolveRowConsumablesCostOverride(baseParams, entry, tier) {
  const rowValue = toFiniteNumberOrNull(baseParams?.consumablesCostPerRunByDungeonTier?.[entry.actionHrid]?.[tier]);
  return rowValue != null && rowValue >= 0 ? rowValue : null;
}

/**
 * 批量对比 4 地牢 × T0/T1/T2（共 12 行），按 sortBy 降序；同值时按目录顺序 + 档位升序稳定排序。
 * 每行每轮分钟的解析优先级：runMinutesByDungeonTier[hrid][tier]（行级覆盖，有限正数才生效）
 * > baseParams.runMinutes（统一覆盖，同样仅有限正数生效）> 该行的 defaultRunMinutes；
 * 两级覆盖的非法值（负数 / 0 / 非有限数）均跳过该级、回落下一级，口径与行级覆盖一致。
 * @param {Omit<DungeonProfitParams, 'dungeonHrid'|'difficultyTier'> & {
 *   runMinutesByDungeonTier?: Record<string, Record<string, number>>,
 *   consumablesCostPerRunByDungeonTier?: Record<string, Record<string, number>>,
 * }} [baseParams] 批量公共参数（runMinutesByDungeonTier = 4 地牢 × T0/T1/T2 的行级覆盖；
 *   consumablesCostPerRunByDungeonTier = 同形状的模拟实测消耗品花费行级覆盖）
 * @param {'perRunProfit'|'perMemberDaily'|'teamDaily'} [sortBy='perRunProfit']
 * @returns {Array<{dungeonHrid: string, dungeonName: string, difficultyTier: number, refinementRate: number,
 *   runMinutes: number, grossIncome: number, entryKeyCost: number, chestKeyCost: number,
 *   consumablesCostPerRun: number, totalCost: number, perRunProfit: number,
 *   perMemberDaily: number, teamDaily: number, dailyCost: number,
 *   runsPerDay: number, mainChestCount: number, refinementChestCount: number,
 *   keySourceBreakdown: {market: {perRunCost: number, dailyCost: number, dailyProfit: number},
 *     craft: {perRunCost: number, dailyCost: number, dailyProfit: number}, profitDelta: number}>}
 */
export function compareDungeons(baseParams = {}, sortBy = 'perRunProfit') {
  const sortKey = ['perRunProfit', 'perMemberDaily', 'teamDaily'].includes(sortBy) ? sortBy : 'perRunProfit';
  const rows = [];

  buildDungeonCatalog().forEach((entry, catalogIndex) => {
    for (let tier = 0; tier <= entry.maxDifficulty; tier += 1) {
      const result = computeDungeonRunProfit({
        ...baseParams,
        dungeonHrid: entry.actionHrid,
        difficultyTier: tier,
        runMinutes: resolveRowRunMinutes(baseParams, entry, tier),
        // 模拟实测消耗品花费按「地牢 × 档位」逐行解析；无模拟值时透传 null（引擎回落每日摊薄口径）。
        consumablesCostPerRunOverride: resolveRowConsumablesCostOverride(baseParams, entry, tier),
      });
      if (!result) {
        continue;
      }
      rows.push({
        dungeonHrid: result.dungeonHrid,
        dungeonName: result.dungeonName,
        difficultyTier: result.difficultyTier,
        refinementRate: result.refinementRate,
        runMinutes: result.runMinutes,
        grossIncome: result.grossIncome,
        entryKeyCost: result.entryKeyCost,
        chestKeyCost: result.chestKeyCost,
        consumablesCostPerRun: result.consumablesCostPerRun,
        totalCost: result.totalCost,
        perRunProfit: result.perRunProfit,
        perMemberDaily: result.perMemberDaily,
        teamDaily: result.teamDaily,
        dailyCost: result.dailyCost,
        // 每日产出列（2026-10-15）：每日轮数 / 每轮普通宝箱数 / 每轮精炼宝箱数；
        // 「每日门票 = 主箱数 × 每日轮数（门票按箱数消耗）」由页面按需换算。
        runsPerDay: result.runsPerDay,
        mainChestCount: result.mainChestCount,
        refinementChestCount: result.refinementChestCount,
        // 商店购买 / 自制双口径：批量对比的每日成本、每日利润与利润差价列直接取这里。
        keySourceBreakdown: result.keySourceBreakdown,
        catalogIndex,
      });
    }
  });

  rows.sort((a, b) => {
    const diff = toFiniteNumber(b[sortKey], 0) - toFiniteNumber(a[sortKey], 0);
    if (diff !== 0) {
      return diff;
    }
    if (a.catalogIndex !== b.catalogIndex) {
      return a.catalogIndex - b.catalogIndex;
    }
    return a.difficultyTier - b.difficultyTier;
  });

  return rows.map(({ catalogIndex, ...row }) => row);
}

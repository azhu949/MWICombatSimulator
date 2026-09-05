import openableLootDropMap from '../combatsimulator/data/openableLootDropMap.json';
import { itemDetailIndex, itemVendorPriceByHrid } from '../shared/gameDataIndex.js';

export const PRICE_MODE_ASK = 'ask';
export const PRICE_MODE_BID = 'bid';
export const PRICE_MODE_VENDOR = 'vendor';
export const MARKET_PRICE_SNAPSHOT_MAX_AGE_MS = 90 * 60_000;
export const MARKET_PRICE_REFRESH_ATTEMPT_COOLDOWN_MS = 60_000;
export const MARKET_SALE_FEE_RATE = 0.05;

// 装备价格来源归一化常量。原定义于 queueScoring.js，此处下沉以供 queueScoring 与
// queueUpgradeCost 共享，避免两模块互相 import 形成循环依赖。
export const OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE = 'official_hourly_average';
export const MANUAL_EQUIPMENT_PRICE_SOURCE = 'manual';
export const MANUAL_PRICE_WARNING_CODE = 'manual_price';

// 官方游戏指南：成功交易按卖方净收益的 5% 征税（袋装 10 牛铃为 18%）。
// 市场 API 不暴露单物品费率，因此特殊费率在此按 hrid 维护。
// 若 API 将来暴露单物品税率字段，应改回数据驱动查询，而不使用此映射。
// 2026-09-04 牛铃 18% 修订（.snow/research/cowbell-18pct-tax-model-design.md）：
// 单颗牛铃与铃袋按 18%、coin 与 3 种宝箱按 0 计入费率表——coin 免税与牛铃按铃袋
// 口径 18% 是用户产品决策；宝箱 0 = 宝箱合成价已逐内容内嵌税费、卖出不再二次
// 征税（防 18%+5% 复合）。
export const BAG_OF_10_COWBELLS_HRID = '/items/bag_of_10_cowbells';

// 不可交易物特殊估值（报告 §5.1/§6-5 漏算定案，设计 §1-§3）：牛铃与 7 件战斗
// 披风不可在市场交易，直接按 hrid 取价恒为 vendor 兜底（牛铃 0、披风 100,000），
// 导致 3 种宝箱合成价漏算牛铃价值（当前行情漏算约 2.8/7.4/14.3 万金每小/中/大箱）。
// 注入层在 nonTradableValuation 开启时改写为代理估值（写入 vendor 列，§2 C 案）：
// 牛铃 = round(铃袋 bid / 10)（一袋 10 颗）、披风 = round(保护之镜 bid)（镜是披风
// 升级耗材，bid=可立即变现的机会价值口径）。ask/bid 恒 -1 → 三种取价模式的来源
// 链解析到 vendor → isMarketSaleSource('vendor')===false → 免税——vendor 列本身
// 即来源标记，零新标记机制；用户手动 override 后写 ask/bid 按市场来源计税为
// 语义 A 的正确行为，无需特判。牛铃 18% 修订后，resolve 层「vendor 来源免税」
// 语义不变（直接解析牛铃无利润链消费点，见设计文档 §7），但宝箱合成层对该
// 注入值改按 hrid 费率净额计价（B 案扁平费率，见 computeChestExpectedValue）。
export const COWBELL_HRID = '/items/cowbell';
export const MIRROR_OF_PROTECTION_HRID = '/items/mirror_of_protection';
export const NON_TRADABLE_CAPE_HRIDS = Object.freeze([
  '/items/chimerical_quiver',
  '/items/sinister_cape',
  '/items/enchanted_cloak',
  '/items/gatherer_cape',
  '/items/artificer_cape',
  '/items/culinary_cape',
  '/items/chance_cape',
]);

// 不可交易估值键全集（牛铃 + 7 披风）：addSyntheticEntries 注入前的无条件复位
// 范围（G-1 修复）——先复位基础形态再按开关注入，使该函数单独调用（hydrate 路径）
// 与 rebuild 路径同为幂等。
const NON_TRADABLE_VALUATION_ENTRY_HRIDS = Object.freeze([COWBELL_HRID, ...NON_TRADABLE_CAPE_HRIDS]);

// 利润链收入侧计税模式（两档，2026-09-04 用户产品决策：移除原三档中的
// 'all'「全部来源计税」档，仅保留「计税」与「不计税」）：
// - 'market'（默认）：仅市场成交来源（ask/bid，含 override 烘焙与宝箱合成条目）
//   计税，vendor 兜底等非市场来源免税；宝箱合成条目因费率表 0 卖出免税（税已
//   内嵌合成价）、coin 因费率表 0 两档统一免税（修订 §4）；
// - 'none'：收入侧全免税（毛利口径）——宝箱合成同为税前（修订 §3.1 矩阵）。
// 'market' 是显式档位（向后兼容锚点）；存量 'all' 落盘值经 normalizeTaxMode
// 白名单归一为 'market'（即移除前 'all' 的 vendor 免税+合成净额口径）。成本侧
//（resolveConsumablePrice）不含税是 D2 定案，任何档位不影响成本侧。
export const TAX_MODE_MARKET = 'market';
export const TAX_MODE_NONE = 'none';

const COIN_HRID = '/items/coin';

// 3 种战利品宝箱：合成层 computeChestExpectedValue 的对象，同时是费率表的
// 「税内嵌、卖出免税」键——两处共用，故定义于费率表之前（牛铃 18% 修订 §1.2b）。
const TREASURE_CHEST_HRIDS = [
  '/items/small_treasure_chest',
  '/items/medium_treasure_chest',
  '/items/large_treasure_chest',
];

// 特殊市场费率表（牛铃 18% 修订 §1.2b，2026-09-04 用户产品决策：
// .snow/research/cowbell-18pct-tax-model-design.md）：
// - 铃袋/单颗牛铃 0.18：牛铃计价按铃袋口径保守计税（决策①）；宝箱内容物是
//   单颗牛铃而非铃袋，铃袋键够不到箱内牛铃，故必须新增牛铃键（修订 §2.2 验证②）；
// - coin 0：金币免税（决策③）——resolve 层与宝箱合成层共用同一费率，两档统一；
// - 3 宝箱 0：宝箱合成价逐内容净额计价、税已内嵌，卖出按费率 0 不再二次征税
//   （防 18%+5% 复合，修订 §1.2b/§1.3-2）。
const SPECIAL_MARKET_FEE_RATE_BY_HRID = Object.freeze({
  [BAG_OF_10_COWBELLS_HRID]: 0.18,
  [COWBELL_HRID]: 0.18,
  [COIN_HRID]: 0,
  ...Object.fromEntries(TREASURE_CHEST_HRIDS.map((hrid) => [hrid, 0])),
});

export function getMarketSaleFeeRate(itemHrid) {
  return SPECIAL_MARKET_FEE_RATE_BY_HRID[String(itemHrid || '')] ?? MARKET_SALE_FEE_RATE;
}

// 启动守卫：官方 hrid 若被重命名或移除，将静默回退到默认 5% 费率。
// 返回未知特殊 hrid 的列表。
export function validateSpecialMarketFeeRateHrids(index = itemDetailIndex) {
  const missing = Object.keys(SPECIAL_MARKET_FEE_RATE_BY_HRID).filter((hrid) => !index?.[hrid]);
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      '[marketPriceService] Special market fee rates reference unknown item hrids: ' +
        `${missing.join(', ')}. Those items fall back to the default fee rate.`,
    );
  }
  return missing;
}

const MARKETPLACE_SOURCE_URLS = [
  'https://www.milkywayidle.com/game_data/marketplace.json',
  'https://www.milkywayidlecn.com/game_data/marketplace.json',
];
export const MARKETPLACE_REQUEST_TIMEOUT_MS = 10_000;

// 合成键全集（设计 §1.3）：coin / 3 宝箱 / 牛铃 / 7 披风——rebuildSyntheticEntriesInTable
// 剥离重导出的操作范围。刻意【不含】铃袋与保护之镜：注入层只读这两个条目、永不写
// （§1.4 防污染不变量——脚本 L2945-2947 的教训是袋的迭代完成值写回市场表后，
// 牛铃=袋/10 会引用被污染的袋价；本项目以「只读不写 + 测试 T4 逐位锚定」防护）。
const SYNTHETIC_ENTRY_HRIDS = Object.freeze([
  COIN_HRID,
  ...TREASURE_CHEST_HRIDS,
  COWBELL_HRID,
  ...NON_TRADABLE_CAPE_HRIDS,
]);

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getVendorPriceByItemHrid(itemHrid) {
  return Math.max(0, toFiniteNumber(itemVendorPriceByHrid?.[itemHrid], 0));
}

// 合成条目复位为基础形态（ask/bid=-1、vendor=itemDetail 静态收购价——与
// createDefaultPriceTable 的建表初值同式）。rebuildSyntheticEntriesInTable（全键剥离）
// 与 addSyntheticEntries（牛铃/披风段，G-1 修复）共用，保证「合成层写入」统一为
// 先复位再注入的幂等模式。
function resetSyntheticEntryToBase(table, hrid) {
  table[hrid] = { ask: -1, bid: -1, vendor: getVendorPriceByItemHrid(hrid) };
}

export function normalizePriceMode(mode, fallback = PRICE_MODE_BID) {
  const normalized = String(mode || '').toLowerCase();
  if (normalized === PRICE_MODE_ASK || normalized === PRICE_MODE_BID || normalized === PRICE_MODE_VENDOR) {
    return normalized;
  }
  return fallback;
}

// 计税模式白名单归一（与 normalizePriceMode 同风格）：仅 'none' 是合法显式
// 档位，其余（''/null/'bogus'/存量 'all'/大小写变体）一律回退 fallback（默认
// 'market' = 现状锚点，旧设置无键即得该默认；2026-09-04 两档决策下存量 'all'
// 落盘值据此自动归一为 'market'）。
export function normalizeTaxMode(mode, fallback = TAX_MODE_MARKET) {
  const normalized = String(mode || '').toLowerCase();
  return normalized === TAX_MODE_NONE ? normalized : fallback;
}

// 市场报价成交（ask/bid）属于应税的市场销售；vendor、override 与 estimated
// 来源则不是。"enhancement_" 前缀只是 resolveEnhancementPrice 附加在
// 底层来源上的装饰，匹配前需将其剥离。
// 注意：此处 override 仅指强化链的独立 override 来源（面值免税）；利润链的
// 手动改价经 applyPriceOverridesToTable 烘焙进 ask/bid 后来源即市场价，
// 按语义 A（2026-09-04 §6-6 定案）正常含税。
// 注意：skillingPlanner 的 liquidationSource 词汇（"market_bid" /
// "base_bid_floor"）是另一套已含税约定——不要在此添加这些值，
// 否则会导致已含税的价格被二次征税。
export function isMarketSaleSource(source) {
  const normalized = String(source || '')
    .toLowerCase()
    .replace(/^enhancement_/, '');
  return normalized === 'ask' || normalized === 'bid';
}

// 按来源感知的优先级解析，供所有需要知道价格来源的消费方共用
// （bid 模式：bid -> ask -> vendor；ask 模式：ask -> bid -> vendor；vendor 模式：vendor）。
function resolveEntrySourceByMode(entry, mode) {
  const normalizedMode = normalizePriceMode(mode, PRICE_MODE_BID);
  const ask = toFiniteNumber(entry?.ask, -1);
  const bid = toFiniteNumber(entry?.bid, -1);
  const vendor = Math.max(0, toFiniteNumber(entry?.vendor, 0));

  if (normalizedMode === PRICE_MODE_VENDOR) {
    return { price: vendor, source: 'vendor' };
  }

  if (normalizedMode === PRICE_MODE_BID) {
    if (bid >= 0) {
      return { price: bid, source: 'bid' };
    }
    if (ask >= 0) {
      return { price: ask, source: 'ask' };
    }
    return { price: vendor, source: 'vendor' };
  }

  if (ask >= 0) {
    return { price: ask, source: 'ask' };
  }
  if (bid >= 0) {
    return { price: bid, source: 'bid' };
  }
  return { price: vendor, source: 'vendor' };
}

function resolveEntryByMode(entry, mode) {
  return resolveEntrySourceByMode(entry, mode).price;
}

export function resolveMarketPrice(priceTable, itemHrid, mode = PRICE_MODE_BID) {
  const hrid = String(itemHrid || '');
  if (!hrid) {
    return 0;
  }

  const entry = priceTable?.[hrid];
  if (!entry) {
    return getVendorPriceByItemHrid(hrid);
  }

  return Math.max(0, toFiniteNumber(resolveEntryByMode(entry, mode), 0));
}

// 计税后的价格像游戏内结算一样舍入为整数金币。官方确切的舍入规则
// 无法从外部验证；此处使用 "round"（四舍五入），若游戏实际为向下取整，
// 可在此切换为 "floor"。
export const MARKET_SALE_FEE_ROUNDING_MODE = 'round';

export function applyMarketSaleFeeByRate(price, feeRate) {
  const numericPrice = Math.max(0, toFiniteNumber(price, 0));
  const numericRate = Math.max(0, toFiniteNumber(feeRate, 0));
  const raw = Math.max(0, numericPrice * (1 - numericRate));
  return MARKET_SALE_FEE_ROUNDING_MODE === 'floor' ? Math.floor(raw) : Math.round(raw);
}

export function applyMarketSaleFee(price, itemHrid) {
  return applyMarketSaleFeeByRate(price, getMarketSaleFeeRate(itemHrid));
}

// 解析通过市场出售物品的净收益。
// 市场成交（bid/ask）需缴纳市场交易税；商店出售则不需要。
// 第 4 参 taxMode（两档，2026-09-04 决策移除 'all'，默认 'market'；既有三参
// 直调对非宝箱/非 coin 项零变化）：
// - 'market'：仅市场成交来源计税；宝箱合成条目与 coin 因费率表 0 免税（修订 §4）；
// - 'none'：全免税（短路为税前 resolveMarketPrice，毛利口径）。
// 仅利润链收入侧消费本函数；成本侧走 resolveMarketPrice 不含税（D2 定案勿改）。
export function resolveMarketSalePrice(priceTable, itemHrid, mode = PRICE_MODE_BID, taxMode = TAX_MODE_MARKET) {
  const hrid = String(itemHrid || '');
  const normalizedMode = normalizePriceMode(mode, PRICE_MODE_BID);
  const normalizedTaxMode = normalizeTaxMode(taxMode);
  if (!hrid) {
    return 0;
  }
  if (normalizedTaxMode === TAX_MODE_NONE) {
    return resolveMarketPrice(priceTable, hrid, normalizedMode);
  }

  const entry = priceTable?.[hrid];
  const resolved = entry ? resolveEntrySourceByMode(entry, normalizedMode) : null;
  const taxable = isMarketSaleSource(resolved?.source);
  if (!resolved || !taxable) {
    return resolveMarketPrice(priceTable, hrid, normalizedMode);
  }
  // coin 免税由费率表 0 统一表达（牛铃 18% 修订 §4，'market' 档与合成层同口径）。
  return applyMarketSaleFee(resolved.price, hrid);
}

// 宝箱期望值 = Σ 内容项净额 × dropRate × 期望数（牛铃 18% 修订 §1.2a/§2 B 案：
// .snow/research/cowbell-18pct-tax-model-design.md）。'none' 档税前聚合
//（毛利口径，= pre-feature 合成公式）；'market' 档对每个内容项按其 hrid
// 费率折净额（扁平因子、不区分来源：牛铃/铃袋 ×0.82、coin/宝箱 ×1、其余 ×0.95）
// ——「牛铃在宝箱内也按 18%」（决策④）的唯一落点就在此处：宝箱合成价是宝箱
// 收入的唯一载体，卖出一层无从区分内容。逐内容单位净额复用 applyMarketSaleFee
//（round 整数化，与游戏内单件卖出结算同构，勿改⑧ MARKET_SALE_FEE_ROUNDING_MODE）。
function computeChestExpectedValue(table, chestHrid, mode, taxMode = TAX_MODE_MARKET) {
  const drops = Array.isArray(openableLootDropMap[chestHrid]) ? openableLootDropMap[chestHrid] : [];
  let total = 0;

  for (const drop of drops) {
    const dropRate = Math.max(0, toFiniteNumber(drop?.dropRate, 0));
    const minCount = Math.max(0, toFiniteNumber(drop?.minCount, 0));
    const maxCount = Math.max(0, toFiniteNumber(drop?.maxCount, 0));
    const expectedCount = (minCount + maxCount) / 2;
    const gross = resolveMarketPrice(table, drop?.itemHrid, mode);
    // B 案（修订 §2）：'none' 档税前；'market' 档逐内容按 hrid 费率净额。
    // taxMode 由 addSyntheticEntries 归一后传入（服务级默认 'market'）。
    const unit = taxMode === TAX_MODE_NONE ? gross : applyMarketSaleFee(gross, drop?.itemHrid);
    total += unit * dropRate * expectedCount;
  }

  return Math.max(0, toFiniteNumber(total, 0));
}

// 合成条目注入（原设计 §1.3 定案方案 a + 牛铃 18% 修订 §3）：注入顺序
// coin → 不可交易估值 → 宝箱合成。顺序由函数体顺序保证：牛铃/披风注入位于宝箱
// 循环之前 → 宝箱合成按 resolveMarketPrice 取内容物价时吃到牛铃 vendor 注入值。
// 牛铃 18% 修订（原勿改 §7-7「宝箱恒税前聚合 + 整体卖出计 5%」被用户产品决策
// 显式推翻）：宝箱合成改为逐内容按 hrid 费率净额计价——原 C 案「vendor 注入即
// 免税」的合成层税语义就此修订（resolve 层 vendor 来源免税不变，见上方注入注释）。
// 只消费表内数据（铃袋/镜 bid 已在水合产物中）→ 开关/税档切换对表剥离重导出即可
// 即时生效，无需重拉行情。options.nonTradableValuation 默认 false（服务层保守
// 默认，与用户侧默认 true 刻意分离）；options.taxMode 服务级默认 'market'
//（与 resolveMarketSalePrice 第 4 参默认对齐，避免同档两义；'none' 税前锚点
// 须显式传入——修订 §3.5）。
// 函数幂等（G-1 修复）：coin/宝箱无条件重写，牛铃/披风先无条件复位基础形态再按
// 开关注入——以「开关开」时期构建的表为 baseTable 再以关闭档调用（hydrate 路径）
// 时，旧注入值被清除而非静默流入宝箱合成；产物与同行情同档 fresh 表逐位一致。
function addSyntheticEntries(table, options = {}) {
  const taxMode = normalizeTaxMode(options.taxMode);
  table[COIN_HRID] = { ask: 1, bid: 1, vendor: 1 };

  // 幂等复位（G-1 修复）：无条件清除牛铃/披风的旧合成值——此前仅 rebuild 路径
  // 有前置剥离，hydrate 以「开」时期表为 baseTable 切关时残留注入值会污染宝箱
  // 合成。先复位再按开关注入：关闭或来源缺价（bid≤0）跳过注入即保持基础形态
  //（诚实缺价语义不变）；必须先于宝箱合成循环执行。coin/宝箱本函数无条件重写，
  // 无需复位。
  for (const hrid of NON_TRADABLE_VALUATION_ENTRY_HRIDS) {
    resetSyntheticEntryToBase(table, hrid);
  }

  if (options.nonTradableValuation === true) {
    // 牛铃：铃袋缺价 / bid ≤ 0 → 跳过注入，保持基础形态 {ask:-1,bid:-1,vendor:0}
    //（诚实缺价，不伪造）。读取的是袋的原始市场 bid（水合产物），只读不写（§1.4）。
    // 审计 S-4（2026-09-05）定案：ask-only 单边（a>0、b≤0）刻意【不】兜底取 ask——
    // ask 是买入价，用于估值「持有的牛铃」方向乐观，与「bid=可立即变现」的注入
    // 口径冲突；与脚本侧 convertMarketDataToItemValues（单边公允价兜底，MWITools
    // getFairValue 同口径）的差异是有意的保守选择，行为由 T2 显式锚定。未来若
    // 放宽，须同步修订 T2/T3 与设计文档定案（non-tradable-valuation-design.md
    // §6 测试矩阵 T2/T3 定义；验收 non-tradable-valuation-acceptance.md）。
    const bagBid = toFiniteNumber(table[BAG_OF_10_COWBELLS_HRID]?.bid, -1);
    if (bagBid > 0) {
      table[COWBELL_HRID] = { ask: -1, bid: -1, vendor: Math.round(bagBid / 10) };
    }

    // 披风：镜缺价 / bid ≤ 0 → 跳过注入，7 件保持基础形态 {…,vendor:100000}
    //（itemDetail 静态收购价，即现状兜底）。与牛铃注入相互独立（两段独立 if）。
    const mirrorBid = toFiniteNumber(table[MIRROR_OF_PROTECTION_HRID]?.bid, -1);
    if (mirrorBid > 0) {
      for (const capeHrid of NON_TRADABLE_CAPE_HRIDS) {
        table[capeHrid] = { ask: -1, bid: -1, vendor: Math.round(mirrorBid) };
      }
    }
  }

  for (const chestHrid of TREASURE_CHEST_HRIDS) {
    table[chestHrid] = {
      ask: computeChestExpectedValue(table, chestHrid, PRICE_MODE_ASK, taxMode),
      bid: computeChestExpectedValue(table, chestHrid, PRICE_MODE_BID, taxMode),
      vendor: computeChestExpectedValue(table, chestHrid, PRICE_MODE_VENDOR, taxMode),
    };
  }
}

// 合成键剥离 + 重导出（设计 §1.3 + 牛铃 18% 修订 §3.5）：把 SYNTHETIC_ENTRY_HRIDS
// 全部重置为基础形态（ask/bid=-1、vendor=itemDetail 静态收购价：牛铃 0、披风
// 100,000、宝箱 0；coin 随注入重写），再按「当前表内行情 + 当前开关/税档」重导出。
// 供 createPricingState（旧缓存恢复：旧缓存烘焙的宝箱合成值不含牛铃或为旧口径）
// 与开关/税档切换 action 复用：
// - 旧缓存 + 开关开 → 宝箱重建含牛铃，不需要重新拉取行情（袋/镜 bid 已在缓存表）；
// - 旧缓存 + 开关关 → 与同行情同档重导出一致（税档随 options 线程化，防丢档）。
// 对任意表幂等（G-1 修复后 addSyntheticEntries 自带牛铃/披风前置复位，与本函数的
// 全键剥离形成双保险）；缓存本身不回写（快照保留原貌，重导出恒在内存侧执行）。
export function rebuildSyntheticEntriesInTable(table, options = {}) {
  if (!table || typeof table !== 'object') {
    return table;
  }

  for (const hrid of SYNTHETIC_ENTRY_HRIDS) {
    resetSyntheticEntryToBase(table, hrid);
  }
  addSyntheticEntries(table, options);
  return table;
}

export function createDefaultPriceTable(options = {}) {
  const table = {};

  for (const item of Object.values(itemDetailIndex || {})) {
    const hrid = String(item?.hrid || '');
    if (!hrid) {
      continue;
    }

    table[hrid] = {
      ask: -1,
      bid: -1,
      vendor: getVendorPriceByItemHrid(hrid),
    };
  }

  addSyntheticEntries(table, options);
  return table;
}

// baseTable 默认值无需携带开关/税档：coin/宝箱由 addSyntheticEntries 无条件重写，
// 牛铃/披风先被无条件复位为基础形态再按开关注入（G-1 修复后 addSyntheticEntries
// 幂等），baseTable 中的旧合成值（含「开关开」时期的注入值）一律被清除——产物
// 与同行情同档 fresh 表逐位一致（设计 §1.3）；options
//（nonTradableValuation/taxMode）透传 addSyntheticEntries，税档缺省 'market'。
export function hydratePriceTableWithMarketData(marketData, baseTable = createDefaultPriceTable(), options = {}) {
  const table = { ...baseTable };
  const source = marketData && typeof marketData === 'object' ? marketData : {};

  for (const [hrid, levelQuotes] of Object.entries(source)) {
    const levelZero = levelQuotes?.['0'];
    if (!levelZero || typeof levelZero !== 'object') {
      continue;
    }

    const existing = table[hrid] || {
      ask: -1,
      bid: -1,
      vendor: getVendorPriceByItemHrid(hrid),
    };

    table[hrid] = {
      ask: toFiniteNumber(levelZero.a, existing.ask),
      bid: toFiniteNumber(levelZero.b, existing.bid),
      vendor: Math.max(0, toFiniteNumber(existing.vendor, 0)),
    };
  }

  addSyntheticEntries(table, options);
  return table;
}

function normalizeEnhancementQuoteEntry(rawQuote) {
  if (!rawQuote || typeof rawQuote !== 'object') {
    return null;
  }
  const ask = toFiniteNumber(rawQuote?.a, -1);
  const bid = toFiniteNumber(rawQuote?.b, -1);
  const averagePrice = toFiniteNumber(rawQuote?.p, -1);
  const volume = toFiniteNumber(rawQuote?.v, 0);
  if (ask < 0 && bid < 0 && !(averagePrice > 0 && volume > 0)) {
    return null;
  }
  return {
    ask,
    bid,
    averagePrice,
    volume,
  };
}

export function extractEnhancementDataFromMarketData(marketData) {
  const source = marketData && typeof marketData === 'object' ? marketData : {};
  const enhancementQuotesByItem = {};
  const enhancementLevelsByItem = {};

  for (const [rawHrid, rawLevelQuotes] of Object.entries(source)) {
    const hrid = String(rawHrid || '');
    if (!hrid || !rawLevelQuotes || typeof rawLevelQuotes !== 'object') {
      continue;
    }

    const quoteMap = {};
    const levels = [];

    for (const [rawLevel, rawQuote] of Object.entries(rawLevelQuotes)) {
      const level = Number(rawLevel);
      // 强化等级游戏上限 20（倍率表 21 元素 0-20 级；与 simulatorStorage 的
      // normalizeEnhancementQuotesByItem/normalizeEnhancementLevelsByItem 同口径）。
      // 此为行情抓取路径，与导入/缓存恢复不同源；超限键会让「市场强化」按钮
      // 出现 +N 并携带脏行情数据，直接丢弃。
      if (!Number.isFinite(level) || level < 0 || level > 20) {
        continue;
      }

      const normalizedQuote = normalizeEnhancementQuoteEntry(rawQuote);
      if (!normalizedQuote) {
        continue;
      }

      quoteMap[String(level)] = normalizedQuote;
      if (level > 0 && normalizedQuote.ask > 0) {
        levels.push(level);
      }
    }

    if (Object.keys(quoteMap).length > 0) {
      enhancementQuotesByItem[hrid] = quoteMap;
    }
    if (levels.length > 0) {
      enhancementLevelsByItem[hrid] = Array.from(new Set(levels)).sort((a, b) => a - b);
    }
  }

  return {
    enhancementQuotesByItem,
    enhancementLevelsByItem,
  };
}

async function fetchMarketplacePayload(fetchImpl, url, requestTimeoutMs) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutMs = Math.max(1, toFiniteNumber(requestTimeoutMs, MARKETPLACE_REQUEST_TIMEOUT_MS));
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      controller?.abort();
      const error = new Error(`Price request timed out after ${timeoutMs}ms: ${url}`);
      error.name = 'TimeoutError';
      reject(error);
    }, timeoutMs);
  });
  const requestPromise = (async () => {
    const response = await fetchImpl(url, {
      mode: 'cors',
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response?.ok) {
      throw new Error(`Price request failed: ${response?.status || 'unknown'}`);
    }
    return response.json();
  })();

  try {
    return await Promise.race([requestPromise, timeoutPromise]);
  } finally {
    if (timeoutId != null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

// nonTradableValuation 默认 false（设计 §1.3：服务层保守默认，与用户侧默认 true
// 刻意分离）；taxMode 默认 'market'（牛铃 18% 修订 §3.5-6：税口径是产品定案，
// 与 resolveMarketSalePrice 第 4 参默认对齐、避免同档两义，'none' 税前锚点须
// 显式传入）。store 行情拉取路径按用户设置传入两键。
export async function fetchMarketPriceTable(
  fetchImpl = globalThis.fetch,
  { requestTimeoutMs = MARKETPLACE_REQUEST_TIMEOUT_MS, nonTradableValuation = false, taxMode = TAX_MODE_MARKET } = {},
) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch API is unavailable in current environment.');
  }

  let lastError = null;

  for (const url of MARKETPLACE_SOURCE_URLS) {
    try {
      const payload = await fetchMarketplacePayload(fetchImpl, url, requestTimeoutMs);
      const marketData = payload?.marketData;
      const priceTable = hydratePriceTableWithMarketData(marketData, undefined, {
        nonTradableValuation,
        taxMode,
      });
      const { enhancementQuotesByItem, enhancementLevelsByItem } = extractEnhancementDataFromMarketData(marketData);
      return {
        sourceUrl: url,
        fetchedAt: Date.now(),
        marketTimestamp: Math.max(0, toFiniteNumber(payload?.timestamp, 0)),
        priceTable,
        enhancementQuotesByItem,
        enhancementLevelsByItem,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Unable to fetch market prices.');
}

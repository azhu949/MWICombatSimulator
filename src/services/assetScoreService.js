// 资产分（Gear Score）计算模块。
// 设计口径（2026-08-30 共识，同日经真实数据对账校准）：
// - 四分项：穿戴装备 + 战斗房屋 + 技能书（练到当前等级的已投入）+ 战斗神龛，合计 ÷ 1M（单位 M）。
// - 单件取价链（六级回退，市场证据优先于模型推断，对齐 MWITools Combat Gear Score 口径）：
//   ① 官方估算市场价值（WS market_item_values_updated 透传，按 物品×强化等级）
//   ② 当前挂单 (ask+bid)/2，单边取单边（marketplace.json per-level）
//   ③ 该等级真实成交均价 p——市场实际成交是最硬的估值证据
//   ④ 成本法（强化装备专属）：完整马尔可夫模型重建「从 0 强到 N」的总投入
//      （skillLevel=itemLevel 中性近似、protectAt=2），仅连成交记录都没有时兜底
//   ⑤ 获取成本兜底（公会信用点等不可交易资产）：捐献来源物品的机会成本
//      （credit 单价 = min(来源物品计价 × itemCount / creditCount)，即一批总价 ÷ 得到的点数）
//   ⑥ 商店售价 sellPrice 最终兜底。
// - 穿戴装备额外走装备专用择优（对齐 MWITools getAssetValueInternal）：官方估算与完整强化
//   成本偏差 ≤20% 用官方估算，偏差更大信成本法；背部装备强化成本强制计入保护之镜。
import {
  abilityBookInfoByAbilityHrid,
  enhancementData,
  itemDetailIndex,
  levelExperienceTable,
} from '../shared/gameDataIndex.js';
// 注意：生成的 houseRoomDetailIndex 出于体积考虑精简掉了 usableInActionTypeMap，
// 战斗房间判定必须读原始 houseRoomDetailMap。
import houseRoomDetailMap from '../combatsimulator/data/houseRoomDetailMap.json';
// 原始物品表：生成的 itemDetailIndex 精简掉了 guildCreditConversions（捐献换公会信用点），
// 神龛等不可交易资产的「获取成本」兜底需要它。
import itemDetailMap from '../combatsimulator/data/itemDetailMap.json';
// 原始制作配方表：成本法输入的「制作获取成本」需要 outputItems/inputItems/upgradeItemHrid
// 全字段（生成索引有精简风险，直接读原始表；bundle 已包含该数据，零增量）。
import actionDetailMap from '../combatsimulator/data/actionDetailMap.json';
// 原始商店表（NPC/任务/迷宫商店）：资产分的「商店兑换获取成本」渠道需要——
// base 披风等不可交易装备仅能用地下城令牌换购，配方与行情均无价。与 itemDetailMap
// 同性质的静态游戏数据，bundle 内置、无需脚本透传。
import shopItemDetailMap from '../combatsimulator/data/shopItemDetailMap.json';
import taskShopItemDetailMap from '../combatsimulator/data/taskShopItemDetailMap.json';
import labyrinthShopItemDetailMap from '../combatsimulator/data/labyrinthShopItemDetailMap.json';
import { EQUIPMENT_SLOT_KEYS } from '../shared/playerConfig.js';
import { combatGuildBuffHrids, guildBuffDetailIndex } from '../shared/guildBuffs.js';
import { analyzeEnhancementStrategies, planPhilosophersMirror } from './enhancementSimulator.js';
import { resolveRecentTradeAverage } from './queueUpgradeCost.js';

export const ASSET_SCORE_UNIT = 1_000_000;
export const ASSET_SCORE_VERSION = 1;

export const ASSET_SCORE_SOURCES = Object.freeze({
  OFFICIAL_ESTIMATE: 'official_estimate',
  // 官方估算命中但 payload 级来源标记为 'synthetic'（主站脚本回落合成中价，
  // 见 mwi-main-site-import.user.js N5 / importExportMapper 提取注释）——
  // 数值口径与 OFFICIAL_ESTIMATE 完全一致，仅 tooltip/明细的来源标签区分。
  SYNTHETIC_MID: 'synthetic_mid',
  MARKET_TRADE: 'market_trade',
  MARKET_QUOTE: 'market_quote',
  COST: 'cost',
  ACQUISITION: 'acquisition',
  VENDOR: 'vendor',
  MISSING: 'missing',
});

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPositiveNumber(value) {
  const parsed = toFiniteNumber(value, 0);
  return parsed > 0 ? parsed : 0;
}

function clampLevel(value) {
  const parsed = Math.floor(toFiniteNumber(value, 0));
  return parsed < 0 ? 0 : parsed;
}

// 游戏强化等级上限 20（倍率表 enhancementLevelTotalBonusMultiplierTable 共 21 元素
// 0-20 级，见 docs/init-client-data-key-reference.md #55；enhancementSimulator
// normalizeEnhancementConfig 对 targetLevel 同口径 clamp(..., 1, 20)、
// enhancementImportMapper clampInteger(..., 0, 20, 0)、EnhancementPage 输入
// Math.min(20, ...)）。手注/旧载荷的超限值必须钳到 20，否则行元数据
//（App.vue +{{ enhancementLevel }}）与计价（成本法内部已钳 20）不一致，且官方
// 估算/挂单 lookup 键（"999" 等）永失命中、强制落入成本法。
const MAX_ENHANCEMENT_LEVEL = 20;

// 强化等级专用钳制（0..20）：仅用于 enhancementLevel / 强化 targetLevel 语义。
// 通用 clampLevel 保留 0..∞ 语义（houseRooms/abilities/guildBuffs 等级共用，
// 各自上界不同：房间 ≤8、能力 ≤5、祭坛 ≤20），不得被强化上限劫持。
function clampEnhancementLevel(value) {
  const parsed = Math.floor(toFiniteNumber(value, 0));
  return Math.min(Math.max(parsed, 0), MAX_ENHANCEMENT_LEVEL);
}

// 码点序比较：不依赖运行时区域设置（localeCompare 默认 locale 随环境变化，
// 理论上可产生跨机器签名漂移）。配置签名要求严格确定性，此处按 UTF-16
// 码元逐位比较，任何环境结果一致。
function compareStringsByCodePoint(left, right) {
  const a = String(left);
  const b = String(right);
  if (a === b) {
    return 0;
  }
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = a.charCodeAt(index) - b.charCodeAt(index);
    if (diff !== 0) {
      return diff;
    }
  }
  return a.length - b.length;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// ① 官方估算市场价值：payload.marketItemValues 形如 { [itemHrid]: { [强化等级]: 价值 } }。
export function resolveOfficialMarketItemValue(pricing, itemHrid, enhancementLevel) {
  const hrid = String(itemHrid || '');
  if (!hrid) {
    return 0;
  }
  const byItem = pricing?.marketItemValues?.[hrid];
  if (!isPlainObject(byItem)) {
    return 0;
  }
  return toPositiveNumber(byItem[String(clampEnhancementLevel(enhancementLevel))]);
}

// 官方估算命中后的来源标签：主站载荷的 payload 级 marketEstimateSource='synthetic'
//（官方估算整体为空、脚本回落合成中价）时，该物品估值实为合成中价，tooltip/明细按
// 实际来源区分显示；旧载荷/复制粘贴载荷/遗留行情缓存无来源标注（pricing.
// marketItemValueSources 缺该 hrid）时按官方估算显示——与历史行为一致（向后兼容）。
// 只切换标签，数值口径零影响（synthetic 与 official 共用 marketItemValues 容器）。
// 来源映射随市场缓存持久化（A3 修复：applyImportedMarketItemValues
// 维护、行情重置随缓存双清、createPricingState 恢复）——重启后来源真值不丢，
// 旧缓存/无 REST 行情（lastFetchedAt=0）无该标注时按官方估算显示（向后兼容）。
// 【一般-5】（2026-09-02）等级级优先：混合物品（官方估算仅覆盖部分等级，其余由合成
// 中价补齐）的等级级真值在 pricing.marketItemValueSourcesByLevel（{ [hrid]:
// { [level]: 'synthetic' } } 稀疏覆盖，上游 syntheticLevelKeys 清单）——命中该等级先
// 返回合成中价，未命中回落物品级标注（「物品级 official + 部分等级 synthetic」的
// 混合表达由此成立；enhancementLevel 经 clampEnhancementLevel 归一，与
// resolveOfficialMarketItemValue 的取值键同口径）。
function resolveOfficialEstimateSource(pricing, itemHrid, enhancementLevel = 0) {
  const byLevel = pricing?.marketItemValueSourcesByLevel?.[itemHrid];
  if (isPlainObject(byLevel) && byLevel[String(clampEnhancementLevel(enhancementLevel))] === 'synthetic') {
    return ASSET_SCORE_SOURCES.SYNTHETIC_MID;
  }
  return pricing?.marketItemValueSources?.[itemHrid] === 'synthetic'
    ? ASSET_SCORE_SOURCES.SYNTHETIC_MID
    : ASSET_SCORE_SOURCES.OFFICIAL_ESTIMATE;
}

// 读取某强化等级的挂单报价：等级 0 用主价表，等级 > 0 用 per-level 行情
//（enhancementQuotesByItem 不与手动价格合并，恒为净行情）。
// 手动价格双通道拦截之一（2026-08-31 修复，另一处在 buildCostModelPricing 出口）：
// store 的 pricing.priceTable 是 applyPriceOverridesToTable(basePriceTable,
// overrides) 的合并产物——手动价格已烘焙进 ask/bid，直接读会让手动价格经
// fairPriceOf / computeAcquisitionInputPrice / market_quote 层泄入资产分，违反
//「手动价格仅影响队列/升级成本」口径与「同配置必同值」的签名前提。level-0 优先读
// 干净基表 basePriceTable（store 恒有：状态构建/行情导入/重置均为整体换新引用）；
// 无基表的形状（服务级直调 / 测试直传原始行情表）退回 priceTable，行为不变。
function resolveQuoteEntry(pricing, itemHrid, enhancementLevel) {
  const hrid = String(itemHrid || '');
  if (!hrid) {
    return null;
  }
  if (enhancementLevel === 0) {
    const table = pricing?.basePriceTable ?? pricing?.priceTable;
    const entry = table?.[hrid];
    return isPlainObject(entry) ? entry : null;
  }
  const quote = pricing?.enhancementQuotesByItem?.[hrid]?.[String(enhancementLevel)];
  return isPlainObject(quote) ? quote : null;
}

// ③ 挂单口径：(ask+bid)/2，单边取单边。
function resolveQuoteMidPrice(quote) {
  const ask = toPositiveNumber(quote?.ask ?? quote?.a);
  const bid = toPositiveNumber(quote?.bid ?? quote?.b);
  if (ask > 0 && bid > 0) {
    return (ask + bid) / 2;
  }
  return Math.max(ask, bid);
}

// ④ 成本法：复用强化模拟器的完整马尔可夫转移模型（含失败降级重打、逐级成功率），
// 计算从 0 级强化到 N 级的总投入（起始件价格 + 期望材料/金币成本）。
// v1 的「线性 1/成功率」简化公式经真实对账系统性低估高强装备（约 0.55x），已废弃；
// 保护镜口径已启用（见下方 protectAt 参数）。

// 成本法输入的「获取成本」（对齐 MWITools acquisitionCostValue）：
// min(公允价值, 制作获取成本, 商店兑换成本)；公允价值 = 官方估算 ?? 挂单中价
//（MWITools getAssetFairValue 同式）。注意不能用 `itemVendorPriceByHrid`（那是
// 卖店价，三叉戟卖店 500 万 vs 市价 12 亿）；商店数据用内置静态表（见下方商店块）。
// 关键意义：保护镜玩家挂单 1025 万/个，成本法若按挂单计保护品会乘性爆炸
//（对账曾得装备分 ×2.7）；透传官方估算后保护镜按官方估算参与 min，成本回落到
// 与官方估算可比的量级。商店兑换渠道已并入 computeAcquisitionInputPrice（见商店块）。
let actionOutputIndexCache = null;
function getActionOutputIndex() {
  if (actionOutputIndexCache) {
    return actionOutputIndexCache;
  }
  const index = {};
  for (const action of Object.values(actionDetailMap || {})) {
    for (const output of Array.isArray(action?.outputItems) ? action.outputItems : []) {
      const outputHrid = String(output?.itemHrid || '');
      const outputCount = Math.max(0, toFiniteNumber(output?.count, 0));
      if (!outputHrid || outputCount <= 0) {
        continue;
      }
      (index[outputHrid] ??= []).push({ action, outputCount });
    }
  }
  actionOutputIndexCache = index;
  return index;
}

// ===== 商店兑换渠道（对齐 MWITools getShopAcquisitionValue / getShopCurrencyValue）=====
// 静态商店条目：NPC/任务/迷宫三表合并（MWITools getShopDetails 同源）。
const STATIC_SHOP_ENTRY_LIST = [
  ...Object.values(shopItemDetailMap || {}),
  ...Object.values(taskShopItemDetailMap || {}),
  ...Object.values(labyrinthShopItemDetailMap || {}),
];

// 归一化商店费用记录（MWITools normalizeCostRecords 同式）：主表是 costs 数组，
// task/labyrinth 表是单数 cost 对象。
function normalizeShopCosts(entry) {
  const raw = entry?.costs ?? entry?.cost ?? entry?.costItems;
  if (Array.isArray(raw)) {
    return raw;
  }
  if (raw && typeof raw === 'object' && (raw.itemHrid || raw.hrid)) {
    return [raw];
  }
  return [];
}

// 归一化商店奖励记录（MWITools normalizeRewardRecords 同式）：单奖励 itemHrid，
// 数量取 outputCount/itemCount（迷宫商店 essence 一换十），缺省 1。
function normalizeShopRewards(entry) {
  const itemHrid = String(entry?.itemHrid || '');
  if (!itemHrid) {
    return [];
  }
  return [
    {
      itemHrid,
      count: Math.max(1, toFiniteNumber(entry?.outputCount ?? entry?.itemCount, 1)),
    },
  ];
}

// 商店条目统一数据源：三张商店表在构建期合并为静态表（第 15 轮裁决「脚本无需透传」；
// 原 pricing.shopItemDetails / shopItemDetailMap 覆盖通道因零生产者于 2026-08-31 删除，
// 见 2026-08-31 审计 G3 节结论）。
function getShopEntryList() {
  return STATIC_SHOP_ENTRY_LIST;
}

// 商店货币集合：在任一商店条目中作为费用的非 coin 物品（覆盖 MWITools 硬编码的
// chimerical/sinister/enchanted/pirate/task/labyrinth 六种令牌，随静态数据自洽）。
let shopCurrencyHridsCache = null;
function getShopCurrencyHrids() {
  if (!shopCurrencyHridsCache) {
    const hrids = new Set();
    for (const entry of STATIC_SHOP_ENTRY_LIST) {
      for (const cost of normalizeShopCosts(entry)) {
        const costHrid = String(cost?.itemHrid || '');
        if (costHrid && costHrid !== '/items/coin') {
          hrids.add(costHrid);
        }
      }
    }
    shopCurrencyHridsCache = hrids;
  }
  return shopCurrencyHridsCache;
}

// 商店条目单项取价（奖励与其它费用共用，2026-09-01 审计 A2 接线）：coin 恒为 1；
// 商店货币改走 computeShopCurrencyValue 递归并透传 visiting（对齐 MWITools
// getShopCurrencyValue 的奖励/费用经 getAssetValueInternal 的 SHOP_CURRENCY_HRIDS
// 分支取价，mwitools-src L8752/L8758/L8828-8829）；其余物品走完整取价链
//（resolveAssetItemValue level-0 通用链——各渠道均为静态数据查询，不会回流本函数
// 或获取成本链，普通物品条目结构上不构成兑换环，无需环防护）。
function priceShopEntryItem(pricing, itemHrid, depth, visiting) {
  if (itemHrid === '/items/coin') {
    return 1;
  }
  if (getShopCurrencyHrids().has(itemHrid)) {
    return computeShopCurrencyValue(pricing, itemHrid, depth, visiting);
  }
  return resolveAssetItemValue(pricing, itemHrid, 0, depth).price;
}

// 商店货币（地下城令牌等）的价值：max((Σ奖励价值 − 其它费用) ÷ 货币数量)。
// 令牌不可交易无行情，价值取「花掉它」的最优兑换率（如 enchanted_token 的最优
// 路线是 2000 换 royal_cloth，而非 1:1 换 essence）。奖励/其它费用经
// priceShopEntryItem 取价；visiting 集合在「奖励/其它费用本身是商店货币」的递归
// 路径上防兑换估值环（环上条目按 0 计，MWITools getAssetValueInternal 的 context
// 语义）；depth > 2 为递归防爆上限。当前官方三表数据零「奖励为商店货币」条目、
// 零多令牌费用条目，环递归分支不可达、接线零行为影响（数据不变量由
// listShopCurrencyRewardEntries 哨兵测试锁定，未来数据引入令牌奖励时测试转红）。
export function computeShopCurrencyValue(pricing, currencyHrid, depth = 0, visiting = null) {
  const hrid = String(currencyHrid || '');
  if (!hrid || hrid === '/items/coin' || depth > 2) {
    return 0;
  }
  const activeVisiting = visiting ?? new Set();
  if (activeVisiting.has(hrid)) {
    return 0;
  }
  activeVisiting.add(hrid);
  let best = 0;
  for (const entry of getShopEntryList()) {
    const costs = normalizeShopCosts(entry);
    const targetCost = costs.find((cost) => String(cost?.itemHrid || '') === hrid);
    const targetCount = Math.max(0, toFiniteNumber(targetCost?.count, 0));
    if (!(targetCount > 0)) {
      continue;
    }
    let rewardValue = 0;
    for (const reward of normalizeShopRewards(entry)) {
      if (reward.itemHrid === hrid) {
        continue;
      }
      rewardValue += priceShopEntryItem(pricing, reward.itemHrid, depth + 1, activeVisiting) * reward.count;
    }
    let otherCostValue = 0;
    let complete = true;
    for (const cost of costs) {
      const costHrid = String(cost?.itemHrid || '');
      const count = Math.max(0, toFiniteNumber(cost?.count, 0));
      if (!costHrid || count <= 0 || costHrid === hrid) {
        continue;
      }
      const unit = priceShopEntryItem(pricing, costHrid, depth + 1, activeVisiting);
      if (!(unit > 0)) {
        // 其它费用缺价时放弃该条目（MWITools 按 0 计会高估令牌，这里取保守口径）。
        complete = false;
        break;
      }
      otherCostValue += unit * count;
    }
    if (complete) {
      best = Math.max(best, Math.max(0, rewardValue - otherCostValue) / targetCount);
    }
  }
  activeVisiting.delete(hrid);
  return best;
}

// 商店奖励为商店货币的条目清单（A2 审计哨兵，纯导出、零行为改动——先例见
// COST_RESULT_CACHE_LIMIT / ENHANCED_EQUIPMENT_FAIR_DEVIATION）：兑换估值成环的
// 必要条件是「存在奖励为商店货币的条目」（其它费用为令牌的分支仅在与该条件叠加时
// 才可能参与成环，单独出现只会被 depth > 2 界定、无法闭环），当前官方数据恒为空；
// 官方数据未来引入「令牌换令牌」条目时本清单非空、不变量测试转红，提示复核环语义。
export function listShopCurrencyRewardEntries() {
  return getShopEntryList().filter((entry) => {
    const rewardHrid = String(entry?.itemHrid || '');
    return rewardHrid && getShopCurrencyHrids().has(rewardHrid);
  });
}

// 导出说明（2026-09-01，探针补强）：升为模块导出，供 tmp/verify-charm-divergence.mjs
// 分歧探针与单测直接取「本地口径基件价」——探针若自行复刻本函数会随实现演进漂移，
// 失去对比意义；纯导出、零行为改动。
export function computeAcquisitionInputPrice(pricing, itemHrid, depth = 0) {
  const hrid = String(itemHrid || '');
  if (!hrid) {
    return 0;
  }
  if (hrid === '/items/coin') {
    return 1;
  }
  // 深度保护：制作配方/商店兑换链上限（防循环/爆炸），耗尽后该候选放弃、交由其余渠道。
  if (depth > 2) {
    return 0;
  }

  const candidates = [];
  // 公允价值 = 官方估算 ?? 挂单中价（MWITools getAssetFairValue 同式：官方估算
  // 优先，缺省时按 (ask+bid)/2 直接从市场买入——守护碎片等可交易材料的购入价）。
  const official = resolveOfficialMarketItemValue(pricing, hrid, 0);
  const fair = official > 0 ? official : resolveQuoteMidPrice(resolveQuoteEntry(pricing, hrid, 0));
  if (fair > 0) {
    candidates.push(fair);
  }

  // 制作获取成本：产出该物品的配方取最便宜（输入递归取获取成本；升级配方
  // upgradeItemHrid 的基件同样按获取成本计，MWITools getCraftedAcquisitionValue 同式）。
  const recipes = getActionOutputIndex()[hrid] || [];
  for (const { action, outputCount } of recipes) {
    let total = 0;
    let complete = true;
    const upgradeHrid = String(action?.upgradeItemHrid || '');
    if (upgradeHrid) {
      const upgradePrice = computeAcquisitionInputPrice(pricing, upgradeHrid, depth + 1);
      if (upgradePrice > 0) {
        total += upgradePrice;
      } else {
        complete = false;
      }
    }
    for (const input of Array.isArray(action?.inputItems) ? action.inputItems : []) {
      const inputHrid = String(input?.itemHrid || '');
      const count = Math.max(0, toFiniteNumber(input?.count, 0));
      if (!inputHrid || count <= 0) {
        continue;
      }
      const inputPrice = computeAcquisitionInputPrice(pricing, inputHrid, depth + 1);
      if (inputPrice <= 0) {
        complete = false;
        continue;
      }
      total += inputPrice * count;
    }
    if (complete && total > 0) {
      candidates.push(total / outputCount);
    }
  }

  // 商店兑换获取成本（MWITools getShopAcquisitionValue 同式）：奖励该物品的商店
  // 条目取 min(Σ 费用×单价 ÷ 奖励数量)。费用为 coin 计 1；为商店货币（地下城令牌）
  // 计其兑换价值（computeShopCurrencyValue）；其余物品递归取获取成本。base 披风等
  // 「仅商店可换」的不可交易装备由此获得真实重建成本（此前只能落到 vendor 卖店价）。
  let bestShop = Number.POSITIVE_INFINITY;
  for (const entry of getShopEntryList()) {
    const rewards = normalizeShopRewards(entry);
    if (rewards.length !== 1 || rewards[0].itemHrid !== hrid) {
      continue;
    }
    let shopTotal = 0;
    let shopComplete = true;
    for (const cost of normalizeShopCosts(entry)) {
      const costHrid = String(cost?.itemHrid || '');
      const count = Math.max(0, toFiniteNumber(cost?.count, 0));
      if (!costHrid || count <= 0) {
        continue;
      }
      let unit = 0;
      if (costHrid === '/items/coin') {
        unit = 1;
      } else if (getShopCurrencyHrids().has(costHrid)) {
        unit = computeShopCurrencyValue(pricing, costHrid, depth + 1);
      } else {
        unit = computeAcquisitionInputPrice(pricing, costHrid, depth + 1);
      }
      if (!(unit > 0)) {
        shopComplete = false;
        break;
      }
      shopTotal += unit * count;
    }
    if (shopComplete && shopTotal > 0) {
      bestShop = Math.min(bestShop, shopTotal / rewards[0].count);
    }
  }
  if (Number.isFinite(bestShop) && bestShop > 0) {
    candidates.push(bestShop);
  }

  return candidates.length > 0 ? Math.min(...candidates) : 0;
}

// MWITools calculateEnhancementPlan 的取价角色分叉（源码 L33886-33941 逐行对齐，
// 第 16 轮校准——第 15 轮「全部按获取成本 min」曾把强化材料/保护品错误地按
// 制作/商店兑换路线压价，chrono 成本偏离为 493M 而 MWITools 理论约 296M，
// 20% 择优边界两侧取价不同导致装备分差 104M）：
// - 起始件（+0）：获取成本 min(公允价值, 商店兑换, 制作)（acquisitionCostValue 同式）
// - ⚠ 唯一未复刻例外：MWITools 对 `_charm`
//   基件不走上一行获取成本式，改走 charmBaseCost craft-only 递归（mwitools-src L33886-33894：
//   嵌套 charm 递归 + 茶摊销 + 嵌套缺价即 unavailable）；本地维持获取成本式，四点分歧
//   与重估触发条件的检测已自动化为 tmp/verify-charm-divergence.mjs 探针（本地偏高/择优
//   翻向逐件输出，npx vite-node 运行）。
// - 强化材料：市场公平价 = 官方估算 ?? 挂单中价；缺价不可交易才退商店 coin 直购
// - 保护品候选（保护镜/物品自身/专属保护品）：市场公平价，缺价则该候选不可选
//   （不做制作/商店兜底——MWITools 同式）；注意 chrono_sphere 等专属保护品
//   （~1.4M）远比保护镜（~10M）便宜，min 择优时它们才是动力学上的真保护价
// - 强化茶（ultra/blessed）与贤者镜：市场公平价；茶缺价 → 成本法 unavailable、
//   贤者镜缺价 → 双镜流不可用
// 任何获取不到的项【剔除】，绝不落 vendor 卖店价。
function buildCostModelPricing(pricing, itemHrid, protectionItemHrid) {
  const baseHrid = String(itemHrid || '');
  // 注意：必须读原始 itemDetailMap——生成的 itemDetailIndex 精简掉了
  // protectionItemHrids（与 guildCreditConversions 同病），会让 chrono_sphere 等
  // 专属保护品不进价格表、模拟器退而选保护镜（10.25M vs 1.425M，成本翻倍+）。
  const detail = itemDetailMap?.[baseHrid] ?? itemDetailIndex?.[baseHrid];
  const materialHrids = new Set();
  for (const cost of Array.isArray(detail?.enhancementCosts) ? detail.enhancementCosts : []) {
    const inputHrid = String(cost?.itemHrid || '');
    if (inputHrid && inputHrid !== '/items/coin') {
      materialHrids.add(inputHrid);
    }
  }
  // 保护品候选与强化模拟器的 resolveProtectionCandidates 对齐：保护镜 + 物品自身 + 专属保护品。
  const protectionHrids = [
    '/items/mirror_of_protection',
    baseHrid,
    ...(Array.isArray(detail?.protectionItemHrids) ? detail.protectionItemHrids : []),
  ].filter(Boolean);
  const philosophersMirrorHrid = enhancementData?.specialItemHrids?.philosophersMirror || '/items/philosophers_mirror';
  const fairHrids = new Set([...materialHrids, ...protectionHrids]);
  if (philosophersMirrorHrid && philosophersMirrorHrid !== '/items/coin') {
    fairHrids.add(philosophersMirrorHrid);
  }
  for (const teaHrid of ['/items/ultra_enhancing_tea', '/items/blessed_tea']) {
    if (teaHrid && teaHrid !== '/items/coin') {
      fairHrids.add(teaHrid);
    }
  }

  // 市场公平价（MWITools getAssetFairValue 同式）：官方估算 ?? 挂单中价。
  const fairPriceOf = (hrid) => {
    const official = resolveOfficialMarketItemValue(pricing, hrid, 0);
    return official > 0 ? official : resolveQuoteMidPrice(resolveQuoteEntry(pricing, hrid, 0));
  };

  const priceTable = {};
  // 起始件：按获取成本（含商店兑换/制作），对齐 plan 的 getFairValue = acquisitionCostValue。
  const basePrice = computeAcquisitionInputPrice(pricing, baseHrid, 0);
  if (basePrice > 0) {
    priceTable[baseHrid] = { ask: basePrice, bid: basePrice };
  }

  for (const fairHrid of fairHrids) {
    if (!fairHrid) {
      continue;
    }
    const fair = fairPriceOf(fairHrid);
    if (fair > 0) {
      priceTable[fairHrid] = { ask: fair, bid: fair };
      continue;
    }
    // 仅强化材料的不可交易兜底：商店单条 coin 费用直购价（MWITools
    // nonTradableCoinShopPrice）；保护品/茶/贤者镜不做该兜底。
    if (materialHrids.has(fairHrid)) {
      const coinShopPrice = resolveSingleCoinShopPrice(fairHrid);
      if (coinShopPrice > 0) {
        priceTable[fairHrid] = { ask: coinShopPrice, bid: coinShopPrice };
      }
    }
    // 无任何价格：不注入，模拟器判 missing（→ 成本法 unavailable / 该保护候选
    // 不可选 / 双镜流不可用）——与 MWITools plan 行为一致。
  }
  // 显式剔除 overrides：成本法取价链不得读 pricing.overrides（手动价格仅影响
  // 队列/升级成本）——spread 会把 pricing.overrides 透传给强化模拟器，而其
  // resolveEnhancementPrice/mergePriceOverrides 一旦 override 命中即短路
  // quotes/priceTable，用户手动价格会直接改写成本法输入，与「同配置必同值」
  // 的签名前提矛盾。必须写在 spread 之后以覆盖透传值。手动价格的另一条通道
  //（烘焙进合并 priceTable 的 ask/bid）由 resolveQuoteEntry 的 basePriceTable
  // 优先拦截，见彼处注释。
  return { ...(pricing || {}), priceTable, overrides: {} };
}

// 不可交易物品的商店单条 coin 费用直购价（对齐 MWITools nonTradableCoinShopPrice
// 的 isTradable 门控）：isTradable === true 的可交易物品直接返回 0——可交易物品
// 的价值应由市场公允价决定，公允价缺失时判 missing（成本法 unavailable），不能用
// coin 直购价冒充市场价值。门控数据源为原始 itemDetailMap（本模块已导入；实测
// 957 条中 872 条 isTradable: true、85 条缺字段——官方数据以「缺字段」而非显式
// false 表达不可交易，故必须严格 === true 判断：若误用 !== false 会把缺字段的
// trainee_*_charm 等 17 个强化材料一并拦掉，该兜底将彻底失效）。当前数据快照下
// 「可交易强化材料 ∩ 单coin商店条目」为空集（可交易的 cheese_*/wooden_* 直购
// 条目均非强化材料），门控为零行为差异的防御性对齐——商店表/itemDetailMap 随
// 官方快照更新后自动与 MWITools 保持同行为。
function resolveSingleCoinShopPrice(itemHrid) {
  if (itemDetailMap?.[itemHrid]?.isTradable === true) {
    return 0;
  }
  let best = Number.POSITIVE_INFINITY;
  for (const entry of STATIC_SHOP_ENTRY_LIST) {
    if (String(entry?.itemHrid || '') !== itemHrid) {
      continue;
    }
    const costs = normalizeShopCosts(entry);
    if (costs.length !== 1 || String(costs[0]?.itemHrid || '') !== '/items/coin' || !(Number(costs[0]?.count) > 0)) {
      continue;
    }
    best = Math.min(best, Number(costs[0].count));
  }
  return Number.isFinite(best) ? best : 0;
}

// 理想强化玩家参数（对齐 MWITools calculateEnhancementPlan 的 ENHANCEMENT_PROFILE）：
// 140 级玩家、+14 天体强化器（enhancingSuccess）、+10 强化身上下衣/+10 附魔手套/
// +5 灵巧披风（enhancingSpeed）、超级强化茶（等级/速度）+ 祝福茶（失败保护几率）。
// 这些装备与茶均在 enhancementData 的 supportEquipment/enhancingDrinks 中有加成数据。
const IDEAL_ENHANCER_PROFILE = Object.freeze({
  skillLevel: 140,
  observatoryLevel: 8,
  equipment: Object.freeze([
    { itemHrid: '/items/celestial_enhancer', enhancementLevel: 14 },
    { itemHrid: '/items/enhancers_top', enhancementLevel: 10 },
    { itemHrid: '/items/enhancers_bottoms', enhancementLevel: 10 },
    { itemHrid: '/items/enchanted_gloves', enhancementLevel: 10 },
    { itemHrid: '/items/chance_cape_refined', enhancementLevel: 5 },
  ]),
  enhancingTeaHrid: '/items/ultra_enhancing_tea',
  blessedEnabled: true,
});

// 暴饮之囊 drinkConcentration 的逐级加成表：逐值对齐 MWITools ENHANCEMENT_BONUSES
//（tmp/mwitools-src.user.js L4070-4090；该表在 MWITools 中唯一消费点即
// getDrinkConcentrationMultiplier L4343，为加浓专用表，与通用强化总加成倍率表
// enhancementLevelTotalBonusMultiplierTable 仅在低等级（[0]-[8]/[10]）恰成 50 倍，
// 高等级语义分叉，故直接引入原表、不做换算——2026-08-31 审计 G1 回炉修订）。
export const POUCH_DRINK_ENHANCEMENT_BONUSES = Object.freeze([
  0, 0.02, 0.042, 0.066, 0.092, 0.12, 0.15, 0.182, 0.216, 0.255, 0.29, 0.33, 0.372, 0.416, 0.462, 0.51, 0.56, 0.612,
  0.666, 0.722, 0.78,
]);

// 精炼动作的「工匠茶」材料折扣（对齐 MWITools getEffectiveTeaEffects + projectAction 的
// effectiveCount）：玩家非战斗茶槽含 artisan_tea 时，精炼材料按 lessResource 抵扣——
// lessResource = 0.1（工匠茶 flat）× 加浓浓度（pouch：1 + 0.1 + 0.002×强化系数），上限 1。
// 真实对账：披风精炼 100 碎片经 +7 暴饮之囊加浓（加浓系数 ≈1.100364，对齐 MWITools
// ENHANCEMENT_BONUSES 口径）抵扣后仅 89.0 个，精炼段 243.4M → 216.6M，正是与 MWITools
// 面板 26M 装备差的机制（第 15 轮对账按旧口径 1.1182× 记录为 88.8 个 / 216.2M）。
export function resolveCraftingTeaLessResource(player) {
  const craftingTeaSlots = isPlainObject(player?.craftingTeaSlots) ? player.craftingTeaSlots : {};
  const hasArtisanTea = Object.values(craftingTeaSlots).some(
    (slots) => Array.isArray(slots) && slots.some((entry) => String(entry?.itemHrid ?? entry) === '/items/artisan_tea'),
  );
  if (!hasArtisanTea) {
    return 0;
  }
  // 门控：只有暴饮之囊带 drinkConcentration 加浓（其余 5 种 pouch 无此词条；
  // gluttonous_pouch 的 noncombatStats 为空，实测见 01 报告）。无 pouch / 非暴饮之囊
  // 时浓度系数为 1，lessResource = 0.1（与 MWITools getDrinkConcentrationMultiplier
  // 的 `!pouch → return 1` 同行为；注意 +0 的暴饮之囊仍参与加浓，两侧一致）。
  if (String(player?.equipment?.pouch?.itemHrid || '') !== '/items/guzzling_pouch') {
    return Math.min(1, 0.1);
  }
  const pouchLevel = clampEnhancementLevel(player?.equipment?.pouch?.enhancementLevel);
  const enhBonus = toFiniteNumber(POUCH_DRINK_ENHANCEMENT_BONUSES[pouchLevel], 0);
  // 加浓系数对齐 MWITools getDrinkConcentrationMultiplier（1 + base + enhancement ×
  // ENHANCEMENT_BONUSES[level]）：base=0.1、enhancement=0.002、[7]=0.182 → +7 得
  // 1.100364。旧实现直接用通用强化倍率表原值（+7 得 1.1182），比 MWITools 多折扣约
  // 0.43M/披风，2026-08-31 修正（01 报告 G1 节）。若真实对账推翻，回退点仅此一处公式。
  const concentration = Math.max(1, 1 + 0.1 + 0.002 * enhBonus);
  return Math.min(1, Math.max(0, 0.1 * concentration));
}

// refined 装备的精炼材料成本（base → refined 升级配方的输入材料；base 本身不计——
// 已按 +0 起始件计价，与 MWITools refinementCostComponents 同口径）。
// 返回 { total, complete }：complete 是精炼段的完整性标记——任一必需输入缺价，或
// refined 物品找不到精炼配方，均为 false，由调用方传导为成本法整体 unavailable。
// 口径对齐：MWITools calculateEnhancementPlan 对精炼组件缺价置
// hasMissingRequiredPrice → unavailableResult（mwitools-src L33905-33914），对配方
// 缺失置 refiningRecipe === null → unavailableResult（L33860）——与强化段「注入不了
// 的项剔除 → 模拟器判 missing → unavailable」同一完整性口径。绝不能静默跳过缺价
// 输入：披风精炼需 100×碎片（~240M），静默跳过会让 refined 装备成本被系统性低估、
// 却仍以 available 的「完整」值呈现（2026-08-31 审计 #4）。
function computeRefinementCost(pricing, refinedItemHrid, baseItemHrid, depth = 0, lessResource = 0) {
  if (!refinedItemHrid.endsWith('_refined')) {
    // 非 refined 物品没有精炼段（MWITools refinementRecipe 对 itemHrid ===
    // baseItemHrid 返回空配方），完整性恒为 true、成本恒为 0。
    return { total: 0, complete: true };
  }
  const reduction = Math.min(1, Math.max(0, toFiniteNumber(lessResource, 0)));
  let total = 0;
  let found = false;
  let complete = true;
  for (const action of Object.values(actionDetailMap || {})) {
    if (String(action?.upgradeItemHrid || '') !== baseItemHrid) {
      continue;
    }
    const outputs = Array.isArray(action?.outputItems) ? action.outputItems : [];
    if (!outputs.some((output) => String(output?.itemHrid || '') === refinedItemHrid)) {
      continue;
    }
    found = true;
    for (const input of Array.isArray(action?.inputItems) ? action.inputItems : []) {
      const inputHrid = String(input?.itemHrid || '');
      const count = Math.max(0, toFiniteNumber(input?.count, 0));
      if (!inputHrid || count <= 0) {
        continue;
      }
      const effectiveCount = count * (1 - reduction);
      const price = inputHrid === '/items/coin' ? 1 : computeAcquisitionInputPrice(pricing, inputHrid, depth + 1);
      if (price > 0) {
        total += price * effectiveCount;
      } else {
        // 缺价输入置缺失标记并向上传导（不再静默跳过）——MWITools L33908 同款。
        complete = false;
      }
    }
  }
  // refined 物品找不到精炼配方 → complete false（MWITools L33860 同口径；生产数据
  // 全量 refined 物品均有配方，该分支仅防御数据缺口）。
  return { total: found ? total : 0, complete: found ? complete : false };
}

// —— 成本法结果记忆化（2026-08-31 审计 U2+G2；同日复查修订指纹字段与失效面）——
// 失效前提（生产代码约定，违反则必须改深比较或显式失效）：pricing 的三个消费字段
// marketItemValues /（basePriceTable ?? priceTable）/ enhancementQuotesByItem 变更时
// 均为「整体替换新引用」——写点经 2026-08-31 复审核实：simulatorPricingActions.js 的
// 行情导入（L133-137：basePriceTable 与 priceTable 同步换新）、重置（L172-177）、
// marketItemValues 合并（变更时整体替换、值不变时保持引用，见 simulatorPricingActions.js
// 的 applyImportedMarketItemValues——#23 合并前值比较跳过），simulatorStorage.js 的状态构建。
// override 三写点（setPriceOverride / resetPriceOverride / resetAllPriceOverrides → rehydrate）
// 只重建 priceTable、不动 basePriceTable
//——资产分不读手动价格（resolveQuoteEntry 优先基表，见 #5 边界），故 override 写点
// 不再入失效面（缓存值仍有效）；rehydrate 重建的 priceTable 同理不入指纹。无基表的
// 形状（服务级直调/测试直传行情表）退回 priceTable 引用。
// 若未来出现原地 mutate，需改深比较或显式失效。
// 静态游戏数据（itemDetailMap 等）运行时不变，不入指纹。
// depth 必须入键（uncached 内 depth > 1 短路与递归语义依赖）。缓存返回共享对象，
// 调用方只读（现状即如此：消费方只读 .price/.available）。
// 上限导出：记忆化测试按生产值驱动「超限整表清空」边界（防字面值漂移，同 #32
// ENHANCED_EQUIPMENT_FAIR_DEVIATION 的纯导出先例，零行为改动）。
export const COST_RESULT_CACHE_LIMIT = 500;
let costResultCache = new Map();
// 直接强化最优投入记忆化（2026-09-02 审计【一般-3】性能｜贤者镜双镜流逐级 DP）：
// philosopher DP 的 directPlans 与外层 normalCost 同源（同一 analyzeEnhancementStrategies
// 调用的 recommendedStrategy.totalInvestment），但原实现把「目标等级」与「中间等级」
// 当作两个割裂的记忆化单元——为 +N 计算时逐级算过的 1..N-1 分析随调用丢弃，任何
// 新的 (itemHrid, N') 未缓存调用（同款不同级 / 同款同级不同 refinementLessResource /
// 行情指纹失效后重算）都要从 1 重付到 N'-1（单件未缓存枚举量约 O(Σ L⁴)，
// analyzeEnhancementStrategies 内部无缓存）。此缓存把记忆化单元统一为
// (baseItemHrid, level, protectionItemHrid)：目标/中间等级在同一行情指纹期内至多
// 各付一次完整枚举。
// - 键输入闭包：skillLevel=f(itemHrid)、策略参数=IDEAL_ENHANCER_PROFILE 常量、
//   startingItemPrice/modelPricing=f(pricing 引用 + itemHrid + protection)——pricing
//   三消费字段均为整体替换写点（见 computeEnhancedEquipmentCost 上方失效面注释），
//   同一 refs 指纹期内键完备；depth 不入键（强化段不消费 depth，仅精炼段用）。
// - 值为 recommendedStrategy.totalInvestment 数字（0=不可用；消费方按原口径还原：
//   normalCost/合成比较过滤 >0，DP 还原 Infinity——取值表达式与原 normalCost/
//   directPlans 两处逐字符同源，strategy.totalCost 本就是 totalInvestment 的拷贝，
//   零数值口径变化）。
// - 失效与 costResultCache 同一 refs 指纹（computeEnhancedEquipmentCost 失效分支
//   同步清空）；超限整表清空同策略、共用 COST_RESULT_CACHE_LIMIT。
let directPlanCache = new Map();
let costCacheRefs = null;

export function computeEnhancedEquipmentCost(pricing, itemHrid, targetLevel, depth = 0, options = {}) {
  const refs = [
    pricing?.marketItemValues ?? null,
    // 与 resolveQuoteEntry 的 level-0 读取同源（优先 basePriceTable）：override
    // 写点只重建 priceTable、不动基表 → 手动价格变更不再清缓存（缓存值仍有效）；
    // 行情导入/重置整体换新基表引用照常失效。
    pricing?.basePriceTable ?? pricing?.priceTable ?? null,
    pricing?.enhancementQuotesByItem ?? null,
  ];
  if (costCacheRefs === null || costCacheRefs.some((ref, index) => ref !== refs[index])) {
    costCacheRefs = refs;
    costResultCache = new Map();
    directPlanCache = new Map();
  }
  const key = [
    String(itemHrid || ''),
    clampEnhancementLevel(targetLevel),
    depth,
    String(options?.protectionItemHrid || ''),
    toFiniteNumber(options?.refinementLessResource, 0),
  ].join('|');
  if (costResultCache.has(key)) {
    return costResultCache.get(key);
  }
  const result = computeEnhancedEquipmentCostUncached(pricing, itemHrid, targetLevel, depth, options);
  if (costResultCache.size >= COST_RESULT_CACHE_LIMIT) {
    costResultCache.clear();
  }
  costResultCache.set(key, result);
  return result;
}

function computeEnhancedEquipmentCostUncached(pricing, itemHrid, targetLevel, depth = 0, options = {}) {
  const hrid = String(itemHrid || '');
  const level = clampEnhancementLevel(targetLevel);
  if (level <= 0 || depth > 1) {
    return { price: 0, available: false };
  }

  try {
    // refined 装备按 base 计成本：起始件为 base +0（官方估算/获取成本），材料表用 base 的
    // enhancementCosts，精炼材料单独累加——与 MWITools 的 baseItemHrid/refinementCost 同口径。
    const baseItemHrid = hrid.endsWith('_refined') ? hrid.replace(/_refined$/, '') : hrid;
    // skillLevel 取「理想玩家 140 级」与物品等级的较大者（超过 140 的装备保持零惩罚底线）：
    // 强化惩罚公式为 skillLevel < itemLevel 时 -0.5×(1-skill/itemLevel)——低技能对高等级
    // 装备会连锁放大动作数与保护品消耗（真实对账曾算出 +12 = 8.9e12 金）。
    const baseItemLevel = Math.max(1, Math.floor(toFiniteNumber(itemDetailIndex?.[baseItemHrid]?.itemLevel, 1)));
    // 成本法输入按「获取成本」定价（min(官方估算 ?? 挂单中价, 制作, 商店兑换)）：
    // 保护镜等消耗品若按玩家挂单价计，强化成本会乘性爆炸（真实对账曾得装备分 ×2.7）。
    const modelPricing = buildCostModelPricing(pricing, baseItemHrid, options.protectionItemHrid);
    // 起始件按获取成本显式传入（对齐 MWITools plan 的 getFairValue = acquisitionCostValue）：
    // 模拟器对不可交易起始件默认走「开箱获取」估算（宝箱→钥匙→entry_key 合成链），
    // base 披风这类仅商店可换的装备会因 entry_key 缺价判 acquisition_missing，导致全部
    // 强化策略不可用（实测披风 +5 落到 vendor 10 万卖店价）。成本模型已按商店兑换链
    // 算出真实获取成本（27000 令牌 ≈ 73.8M），直接覆盖传入；可交易基件该值与注入
    // priceTable 的获取成本一致，行为不变。
    const startingItemPrice = computeAcquisitionInputPrice(pricing, baseItemHrid, 0);
    const sharedConfig = {
      itemHrid: baseItemHrid,
      startLevel: 0,
      ...(startingItemPrice > 0 ? { startingItemPriceOverride: startingItemPrice } : {}),
      skillLevel: Math.max(IDEAL_ENHANCER_PROFILE.skillLevel, baseItemLevel),
      // MWITools ENHANCEMENT_PROFILE: houseLevel 8（观测台成功/速度加成，
      // houseSuccessPerLevel 5e-4 + houseSpeedPerLevel 0.01）——第 16 轮对账发现
      // 缺失该加成会让高强装备的成功率整体低约 0.4 个点、动作数偏多（chrono +12
      // 成本 493M vs 理论 296M 的组件之一）。观测台 buff 由 enhancementData 按
      // 等级解析（resolveBuffValue(_, level, ...)），与 MWITools 常量同源。
      observatoryLevel: IDEAL_ENHANCER_PROFILE.observatoryLevel,
      equipment: IDEAL_ENHANCER_PROFILE.equipment,
      enhancingTeaHrid: IDEAL_ENHANCER_PROFILE.enhancingTeaHrid,
      blessedEnabled: IDEAL_ENHANCER_PROFILE.blessedEnabled,
      ...(options.protectionItemHrid ? { protectionItemHrid: options.protectionItemHrid } : {}),
    };

    // 策略枚举对齐 MWITools calculateEnhancementPlan：普通策略（无保护 / +2..N-1
    // 保护）与贤者镜双镜流（philosopher 模式：philosopherStartLevel × protectLevel
    // 双重枚举，低价贤者镜替代高价保护流）共同竞争最小总投入。此前只枚举普通策略，
    // +12 等高等级装备的成本被高估、与官方估算的偏差超过 20% 阈值，导致本应用
    // 官方估算的装备错走成本法（实测 chrono_gloves +12 成本 306.8M vs 挂单 310.5M）。
    // normalCost 经 getDirectEnhancementInvestment 取值：targetLevel 自身的枚举与
    // philosopher 逐级 DP 的中间等级共用同一记忆化单元（键输入闭包见 directPlanCache
    // 声明处注释），本调用之后任何同 (itemHrid, level, protection) 消费方零枚举复用。
    const normalCost = getDirectEnhancementInvestment(baseItemHrid, level, sharedConfig, modelPricing);
    const philosopherCost = computePhilosopherEnhancementCost(sharedConfig, modelPricing, level);
    const enhancementTotal = Math.min(
      ...(normalCost > 0 ? [normalCost] : []),
      ...(philosopherCost > 0 ? [philosopherCost] : []),
    );
    if (!Number.isFinite(enhancementTotal) || enhancementTotal <= 0) {
      return { price: 0, available: false };
    }
    // 精炼材料按原始 pricing 取价（完整挂单表 + 商店兑换候选），而非过滤后的
    // modelPricing——精炼碎片不在强化材料集里，用原始表才能拿到行情中价。
    const refinement = computeRefinementCost(
      pricing,
      hrid,
      baseItemHrid,
      depth,
      toFiniteNumber(options?.refinementLessResource, 0),
    );
    // 精炼段缺价/缺配方 → 成本法整体 unavailable：缺任一必要输入即非完整重建成本，
    // 宁可弃用成本法让估值回退市场证据链，也不呈现静默低估却标记「完整」的值
    //（对齐 MWITools hasMissingRequiredPrice → unavailableResult L33914，与强化段
    //「模拟器判 missing → unavailable」同口径——2026-08-31 审计 #4）。
    if (!refinement.complete) {
      return { price: 0, available: false };
    }
    const total = enhancementTotal + refinement.total;
    if (total <= 0) {
      return { price: 0, available: false };
    }
    return { price: Math.round(total), available: true };
  } catch (error) {
    // 强化数据或行情缺失时退回市场价/商店价路径，不让成本法阻断整体计算。
    return { price: 0, available: false };
  }
}

// 直接强化最优投入记忆化取值（强化段唯一枚举入口）：目标等级（normalCost）与
// philosopher DP 的中间等级（directPlans）共用同一记忆化单元。取值表达式与原
// normalCost / directPlans 两处逐字符同源（strategy.totalCost 本就是 totalInvestment
// 的拷贝，?? 回退仅为保持原形状）；冷缓存首算的枚举总量与原实现一致（0..N 各一次），
// 同一行情指纹期内同 (itemHrid, level, protection) 的后续消费方零枚举复用。
function getDirectEnhancementInvestment(baseItemHrid, level, sharedConfig, modelPricing) {
  const key = [baseItemHrid, level, sharedConfig.protectionItemHrid || ''].join('|');
  if (directPlanCache.has(key)) {
    return directPlanCache.get(key);
  }
  const analysis = analyzeEnhancementStrategies({ ...sharedConfig, targetLevel: level }, enhancementData, modelPricing);
  const investment = toPositiveNumber(
    analysis?.recommendedStrategy?.totalInvestment ?? analysis?.recommendedStrategy?.totalCost,
  );
  if (directPlanCache.size >= COST_RESULT_CACHE_LIMIT) {
    directPlanCache.clear();
  }
  directPlanCache.set(key, investment);
  return investment;
}

// 贤者镜双镜流成本（MWITools philosopher 模式的本地等价实现）：复用强化模拟器的
// planPhilosophersMirror DP——对每个目标等级比较「直接强化」与「(N-2 件) + (N-1 件)
// + 贤者镜合成」的成本取最小。贤者镜单价对齐 MWITools 的 marketPrice（挂单 ask）：
// 获取成本（制作配方口径）在原料无估算时会塌缩，且注入 priceTable 失败后模拟器
// 会落到 vendor 卖店价（贤者镜 1000 万 vs 市价 642M，实测把 +12 成本压到 12.5M 的
// 套娃漏洞）。挂单价缺失时该模式直接不可用。
// directPlans 全部经 getDirectEnhancementInvestment 取值（2026-09-02 审计【一般-3】）：
// targetLevel 档与外层 normalCost 同键必命中缓存；中间等级命中后跨调用复用——
// 原实现仅 targetLevel 复用外层分析、1..N-1 每次完整枚举且结果随调用丢弃。
function computePhilosopherEnhancementCost(sharedConfig, modelPricing, targetLevel) {
  if (targetLevel < 2) {
    return 0;
  }
  const mirrorHrid = enhancementData?.specialItemHrids?.philosophersMirror || '/items/philosophers_mirror';
  const mirrorAsk = toPositiveNumber(
    modelPricing?.priceTable?.[mirrorHrid]?.ask ?? modelPricing?.priceTable?.[mirrorHrid]?.a,
  );
  if (mirrorAsk <= 0) {
    return 0;
  }

  // 每个等级的「直接强化」最优成本（普通策略枚举的推荐值），供 DP 合成。
  const directPlans = [];
  for (let level = 0; level <= targetLevel; level += 1) {
    if (level === 0) {
      const startingAsk = toPositiveNumber(
        modelPricing?.priceTable?.[sharedConfig.itemHrid]?.ask ?? modelPricing?.priceTable?.[sharedConfig.itemHrid]?.a,
      );
      directPlans[level] = startingAsk > 0 ? { cost: startingAsk } : { cost: Infinity };
      continue;
    }
    // targetLevel 档与外层 normalCost 同键（同 itemHrid/level/protection），必命中
    // directPlanCache——原 L2「复用外层 precomputedAnalysis」优化的自然推广：原先
    // 仅 targetLevel 复用、中间等级 1..N-1 每次现算且结果随调用丢弃，现统一入缓存。
    const investment = getDirectEnhancementInvestment(sharedConfig.itemHrid, level, sharedConfig, modelPricing);
    directPlans[level] = investment > 0 ? { cost: investment } : { cost: Infinity };
  }

  const mirrorPlan = planPhilosophersMirror({
    targetLevel,
    itemHrid: sharedConfig.itemHrid,
    baseItemHrid: sharedConfig.itemHrid,
    mirrorItemHrid: mirrorHrid,
    mirrorPrice: mirrorAsk,
    mirrorActionCost: 0,
    directPlans,
  });
  const planCost = toPositiveNumber(mirrorPlan?.cost);
  return Number.isFinite(planCost) ? planCost : 0;
}

// 单件取价链（见文件头注释）。返回 { price, source }。
export function resolveAssetItemValue(pricing, itemHrid, enhancementLevel = 0, depth = 0) {
  const hrid = String(itemHrid || '');
  const level = clampEnhancementLevel(enhancementLevel);
  if (!hrid || depth > 2) {
    return { price: 0, source: ASSET_SCORE_SOURCES.MISSING };
  }

  // 金币是计价货币，恒为 1（与 queueUpgradeCost.resolveHouseRoomMaterialPricing 同口径；
  // 官方数据中 coin 的 sellPrice 为 0，不做特判会让含金币材料/成本法全部判为缺价）。
  if (hrid === '/items/coin') {
    return { price: 1, source: ASSET_SCORE_SOURCES.VENDOR };
  }

  const official = resolveOfficialMarketItemValue(pricing, hrid, level);
  if (official > 0) {
    return { price: official, source: resolveOfficialEstimateSource(pricing, hrid, level) };
  }

  // ② 当前挂单（现价）：(ask+bid)/2，单边取单边。
  const direct = resolveQuoteMidPrice(resolveQuoteEntry(pricing, hrid, level));
  if (direct > 0) {
    return { price: direct, source: ASSET_SCORE_SOURCES.MARKET_QUOTE };
  }

  // ③ 该等级的真实成交均价——市场实际成交是最硬的估值证据，优先于任何模型推断
  //（真实对账验证：MWITools 官方估算量级 ≈ 成交均价；成本模型不知道玩家实际的
  // 保护品/加成策略，系统性偏高，只做「连成交记录都没有」时的兜底）。
  const tradeAverage = resolveRecentTradeAverage(pricing, hrid, level);
  if (toPositiveNumber(tradeAverage?.price) > 0) {
    return { price: toPositiveNumber(tradeAverage.price), source: ASSET_SCORE_SOURCES.MARKET_TRADE };
  }

  if (level > 0) {
    const cost = computeEnhancedEquipmentCost(pricing, hrid, level, depth);
    if (cost.available && cost.price > 0) {
      return { price: cost.price, source: ASSET_SCORE_SOURCES.COST };
    }
  }

  // ⑤ 获取成本兜底（公会信用点等不可交易资产：捐献来源物品的机会成本）。
  // 不取整（MWITools getGuildCreditValue 同为小数，2026-09-01 审计 #32 复审修复）：
  // 单位成本可低于 0.5 金（现数据最廉路线 pathbreaker/pathfinder/pathseeker_lodestone
  // 卖店 1000 金捐得 6000 brown credit ≈ 0.167/点），Math.round 会把它塌缩为 0——
  // 返回 { price: 0, source: 'acquisition' } 的自相矛盾态，信用点被下游误判缺价
  //（神龛 brown 成本整段丢弃 + 虚假 incomplete 标注）。行级/分项聚合端自有取整
  //（sanitizeXxxRow / sections），此处保留精度不影响载荷整数化。
  const acquisitionCost = computeGuildCreditAcquisitionCost(pricing, hrid, depth);
  if (acquisitionCost > 0) {
    return { price: acquisitionCost, source: ASSET_SCORE_SOURCES.ACQUISITION };
  }

  // ⑥ 商店售价兜底。
  const vendor = Math.max(0, toFiniteNumber(itemDetailIndex?.[hrid]?.sellPrice, 0));
  if (vendor > 0) {
    return { price: vendor, source: ASSET_SCORE_SOURCES.VENDOR };
  }

  return { price: 0, source: ASSET_SCORE_SOURCES.MISSING };
}

// 高强化装备的官方估算与重建成本偏差阈值：≤20% 视为两者一致（用官方估算）；
// 偏差更大时 MWITools 选择信成本法（getAssetValueInternal 同款规则）。
// 导出说明（2026-09-01，探针复审补强）：与 computeAcquisitionInputPrice 同理，
// 供 tmp/verify-charm-divergence.mjs 翻向检查直取生产阈值——探针若复刻 0.2 字面值会随
// 阈值演进漂移；纯导出、零行为改动。
export const ENHANCED_EQUIPMENT_FAIR_DEVIATION = 0.2;

// 成本择优启用前提：成本法输入需按「获取成本/官方估算」定价且策略参数与 MWITools
// 同款（理想玩家 ENHANCEMENT_PROFILE + 策略枚举取最小总成本）——现已全部就位：
// 保护镜等消耗品经 computeAcquisitionInputPrice 取 min(官方估算, 制作)，强化策略经
// analyzeEnhancementStrategies 枚举（无保护/+2..N-1 保护）取最小投入，对账显示
// 成本与官方估算量级一致（装备分 ×0.991 vs MWITools）。
const SHOP_ACQUISITION_AVAILABLE = true;

// 穿戴装备专用估值（2026-08-30 对齐 MWITools getAssetValueInternal 装备分支）：
// 高强化（level>0）装备先算完整强化成本，与官方估算择优——|估算-成本|/成本 ≤ 20% 用官方估算，
// 偏差更大时信成本法（官方估算可能滞后/保守，成本法反映真实重建投入；成本法对背部装备
// 强制计入保护之镜）。成本不可算时退回官方估算；无官方估算（未透传 marketItemValues）时
// 按通用取价链降级（挂单→成交→成本法→获取成本→商店价）。
export function resolveEquipmentAssetValue(pricing, itemHrid, enhancementLevel, slotKey = '', depth = 0, options = {}) {
  const hrid = String(itemHrid || '');
  const level = clampEnhancementLevel(enhancementLevel);
  if (!hrid || depth > 2) {
    return { price: 0, source: ASSET_SCORE_SOURCES.MISSING };
  }
  if (hrid === '/items/coin') {
    return { price: 1, source: ASSET_SCORE_SOURCES.VENDOR };
  }

  const official = resolveOfficialMarketItemValue(pricing, hrid, level);
  const isEquipment = Boolean(itemDetailIndex?.[hrid]?.equipmentDetail);
  if (level > 0 && isEquipment && official > 0 && SHOP_ACQUISITION_AVAILABLE) {
    // 官方估算可用且商店成本渠道就绪 → 与 MWITools 同场景，执行成本择优。
    const cost = computeEnhancedEquipmentCost(pricing, hrid, level, depth, {
      protectionItemHrid: slotKey === 'back' ? '/items/mirror_of_protection' : '',
      refinementLessResource: toFiniteNumber(options?.refinementLessResource, 0),
    });
    if (cost.available && cost.price > 0) {
      const deviation = Math.abs(official - cost.price) / cost.price;
      if (deviation <= ENHANCED_EQUIPMENT_FAIR_DEVIATION) {
        return { price: official, source: resolveOfficialEstimateSource(pricing, hrid, level) };
      }
      return { price: cost.price, source: ASSET_SCORE_SOURCES.COST };
    }
  }
  if (official > 0) {
    return { price: official, source: resolveOfficialEstimateSource(pricing, hrid, level) };
  }

  // 无官方估算（未透传 marketItemValues）时的降级链：挂单→成交→成本法→获取成本→商店价。
  // 注意不能在无估算时字面套用 MWITools 择优（它运行时必有估算，缺失即罢工），
  // 否则挂单/成交证据会被成本法跳过、装备分系统性暴涨。
  const direct = resolveQuoteMidPrice(resolveQuoteEntry(pricing, hrid, level));
  if (direct > 0) {
    return { price: direct, source: ASSET_SCORE_SOURCES.MARKET_QUOTE };
  }
  const tradeAverage = resolveRecentTradeAverage(pricing, hrid, level);
  if (toPositiveNumber(tradeAverage?.price) > 0) {
    return { price: toPositiveNumber(tradeAverage.price), source: ASSET_SCORE_SOURCES.MARKET_TRADE };
  }
  if (level > 0) {
    // 背部装备与 MWITools getEnhancedEquipmentCost 一致，强制按保护之镜计保护成本
    //（forcedProtectionItemHrid）——无官方估算走降级链的背部装备同样不能漏。
    const cost = computeEnhancedEquipmentCost(pricing, hrid, level, depth, {
      protectionItemHrid: slotKey === 'back' ? '/items/mirror_of_protection' : '',
      refinementLessResource: toFiniteNumber(options?.refinementLessResource, 0),
    });
    if (cost.available && cost.price > 0) {
      return { price: cost.price, source: ASSET_SCORE_SOURCES.COST };
    }
  }
  // 同上不取整（防亚整数单位成本塌零；装备并非 creditItemHrid，此层现数据不可达，
  // 仅作与 resolveAssetItemValue 同口径的防御分支保留）。
  const acquisitionCost = computeGuildCreditAcquisitionCost(pricing, hrid, depth);
  if (acquisitionCost > 0) {
    return { price: acquisitionCost, source: ASSET_SCORE_SOURCES.ACQUISITION };
  }
  const vendor = Math.max(0, toFiniteNumber(itemDetailIndex?.[hrid]?.sellPrice, 0));
  if (vendor > 0) {
    return { price: vendor, source: ASSET_SCORE_SOURCES.VENDOR };
  }
  return { price: 0, source: ASSET_SCORE_SOURCES.MISSING };
}

// 公会信用点等不可交易资产没有市场价，用「捐献获取成本」兜底（公式对齐 MWITools 的
// getGuildCreditValue：min 语义、排除 guild_token 防循环）：捐一批 itemCount 个材料得
// creditCount 个信用点，credit 单价 = min(来源物品计价 × itemCount / creditCount)
// ——即一批总价 ÷ 得到的点数。返回值保留小数（见 resolveAssetItemValue ⑤ 出口注释，
// 出口不取整，取整只发生在行级/分项聚合端）。
// 来源取价口径决策（2026-09-01 审计 #32 复审落档，有意与 MWITools 不同）：来源物品
// 走完整取价链（①②③⑤⑥）而非其 fair-only（getAssetFairValue = 官方估算??挂单中价，
// 缺价即跳过该来源）。差异只在「来源既无官方估算也无挂单、但有成交/vendor 价」时
// 显现，且 min 语义下方向恒为我们 ≤ 对方：透传主场景来源材料官方估算全覆盖、两侧
// 逐位一致；降级/部分快照场景多出的 ③⑥ 候选是有意的「机会成本 + 诚实降级」语义
//（vendor 卖店价正是捐献机会成本的合理定价）。勿对齐
// fair-only——那会让无行情时全部信用点塌 0（令牌/神龛随之清零），违背既有测试
// 钉死的 vendor 兜底语义。来源本身是信用点的 ⑤ 递归在真实数据中不存在（8 种信用点
// 均非捐献来源，探针核验 2026-09-01），depth 守卫仅为防御。
let guildCreditAcquisitionIndexCache = null;
function getGuildCreditAcquisitionIndex() {
  if (guildCreditAcquisitionIndexCache) {
    return guildCreditAcquisitionIndexCache;
  }
  const index = {};
  for (const item of Object.values(itemDetailMap || {})) {
    const sourceHrid = String(item?.hrid || '');
    const conversions = Array.isArray(item?.guildCreditConversions) ? item.guildCreditConversions : [];
    for (const conversion of conversions) {
      const creditItemHrid = String(conversion?.creditItemHrid || '');
      const itemCount = Math.max(0, toFiniteNumber(conversion?.itemCount, 0));
      const creditCount = Math.max(0, toFiniteNumber(conversion?.creditCount, 0));
      if (!creditItemHrid || !sourceHrid || itemCount <= 0 || creditCount <= 0) {
        continue;
      }
      (index[creditItemHrid] ??= []).push({ sourceHrid, itemCount, creditCount });
    }
  }
  guildCreditAcquisitionIndexCache = index;
  return index;
}

function computeGuildCreditAcquisitionCost(pricing, itemHrid, depth) {
  if (depth > 1) {
    return 0;
  }
  const sources = getGuildCreditAcquisitionIndex()[String(itemHrid || '')];
  if (!Array.isArray(sources) || sources.length === 0) {
    return 0;
  }
  let best = 0;
  for (const source of sources) {
    // 公会令牌的价值本身就是从信用点换算来的，作为信用点来源会循环估值（MWITools 同样排除）。
    if (source.sourceHrid === '/items/guild_token') {
      continue;
    }
    const priced = resolveAssetItemValue(pricing, source.sourceHrid, 0, depth + 1);
    if (priced.price <= 0) {
      continue;
    }
    // 捐一批 itemCount 个材料得 creditCount 个信用点：每点成本 = 一批总价 ÷ creditCount。
    // 真实对账（2026-08-30）曾因分子分母写反（×creditCount/itemCount）算出 1.81x 偏差。
    const unitCost = (priced.price * source.itemCount) / source.creditCount;
    if (best === 0 || unitCost < best) {
      best = unitCost;
    }
  }
  return best;
}

// 公会令牌价值 = 其兑换信用点的最大路线价值（对齐 MWITools getGuildTokenValue）：
// 1 个令牌可按 guildCreditConversions 兑换若干信用点（如 1 token = 10 brown credit），
// 取各路线「信用点价值 × creditCount ÷ tokenCount」的最大者。
export function computeGuildTokenValue(pricing, depth = 0) {
  if (depth > 1) {
    return 0;
  }
  const detail = itemDetailMap?.['/items/guild_token'] || null;
  const conversions = Array.isArray(detail?.guildCreditConversions) ? detail.guildCreditConversions : [];
  let best = 0;
  for (const conversion of conversions) {
    const creditItemHrid = String(conversion?.creditItemHrid || '');
    const tokenCount = Math.max(0, toFiniteNumber(conversion?.guildTokenCount ?? conversion?.itemCount, 0));
    const creditCount = Math.max(0, toFiniteNumber(conversion?.creditCount, 0));
    if (!creditItemHrid || tokenCount <= 0 || creditCount <= 0) {
      continue;
    }
    const creditValue = resolveAssetItemValue(pricing, creditItemHrid, 0, depth + 1).price;
    if (creditValue <= 0) {
      continue;
    }
    const unitValue = (creditValue * creditCount) / tokenCount;
    if (unitValue > best) {
      best = unitValue;
    }
  }
  return best;
}

// 市场数据是否可用（用于决定保留导入携带的资产分还是重新计算）。
export function isPricingDataAvailableForAssetScore(pricing) {
  return Boolean(
    toFiniteNumber(pricing?.lastFetchedAt, 0) > 0 ||
    Object.keys(pricing?.enhancementQuotesByItem || {}).length > 0 ||
    Object.keys(pricing?.marketItemValues || {}).length > 0,
  );
}

function sumHouseRoomInvestment(pricing, roomDetail, level) {
  const upgradeCostsMap = isPlainObject(roomDetail?.upgradeCostsMap) ? roomDetail.upgradeCostsMap : {};
  let roomValue = 0;
  let incomplete = false;
  for (let costLevel = 1; costLevel <= level; costLevel++) {
    const levelCosts = Array.isArray(upgradeCostsMap[String(costLevel)]) ? upgradeCostsMap[String(costLevel)] : [];
    for (const costEntry of levelCosts) {
      const itemHrid = String(costEntry?.itemHrid || '');
      const count = Math.max(0, toFiniteNumber(costEntry?.count, 0));
      if (!itemHrid || count <= 0) {
        continue;
      }
      if (itemHrid === '/items/coin') {
        roomValue += count;
        continue;
      }
      const priced = resolveAssetItemValue(pricing, itemHrid, 0);
      if (priced.price <= 0) {
        incomplete = true;
        continue;
      }
      roomValue += count * priced.price;
    }
  }
  return { value: roomValue, incomplete };
}

function sumGuildBuffInvestment(pricing, buffHrid, level) {
  const detail = guildBuffDetailIndex?.[String(buffHrid || '')] || null;
  const levelCosts = isPlainObject(detail?.levelCosts) ? detail.levelCosts : {};
  let buffValue = 0;
  let incomplete = false;
  for (let costLevel = 1; costLevel <= level; costLevel++) {
    const creditCosts = Array.isArray(levelCosts[String(costLevel)]?.creditCosts)
      ? levelCosts[String(costLevel)].creditCosts
      : [];
    for (const credit of creditCosts) {
      const itemHrid = String(credit?.itemHrid || '');
      const count = Math.max(0, toFiniteNumber(credit?.count, 0));
      if (!itemHrid || count <= 0) {
        continue;
      }
      const priced = resolveAssetItemValue(pricing, itemHrid, 0);
      if (priced.price <= 0) {
        incomplete = true;
        continue;
      }
      buffValue += count * priced.price;
    }
    // 公会令牌成本计入神龛（2026-08-30 口径修订，对齐 MWITools getGuildShrineValues：
    // 旧口径有意排除令牌，但 MWITools 将其按「兑换信用点最大路线价值」计入，
    // 排除它导致真实对账神龛只有对方的一半）。
    const guildTokenCount = Math.max(0, toFiniteNumber(levelCosts[String(costLevel)]?.guildTokenCost, 0));
    if (guildTokenCount > 0) {
      const tokenValue = computeGuildTokenValue(pricing);
      if (tokenValue <= 0) {
        incomplete = true;
      } else {
        buffValue += guildTokenCount * tokenValue;
      }
    }
  }
  return { value: buffValue, incomplete };
}

// 配置签名口径版本：签名算法/覆盖面变化时递增，使旧快照签名失效（触发重算，安全方向）。
// 注：houseRooms/abilities 按码点序排序（compareStringsByCodePoint，不依赖运行时区域设置）。
// 对现有 ASCII hrid 数据其输出与 localeCompare 完全一致，故不递增版本号——快照保留语义
// 不受扰动（仅当跨环境排序确实不同时，签名内容不同 → 自动失效重算，签名机制本职）。
// 2026-09-02 一般-4：houseRooms 覆盖从「全部 >0 房间」收窄为「战斗可用房间」同理不递增
// 版本号——无非战斗房间的配置新旧签名逐字节相同（快照保留不受扰动）；含非战斗房间的
// 配置签名必然变化 → 升级后首次刷新一次性安全重算（签名机制本职，失败方向安全）。若递增
// 版本号反而令全部旧快照失配，行情不可用时会被降级重算覆盖——恰是本次修复要消除的退化。
const ASSET_SCORE_CONFIG_SIGNATURE_VERSION = 1;

// 玩家配置中影响资产分取值输入的规范签名（稳定序列化字符串）。
// 覆盖面与 computePlayerAssetScore 的玩家输入严格一致（houseRooms 经
// isCombatHouseRoomDetail 与房屋消费过滤同源耦合，2026-09-02 一般-4 修复）：
// - equipment（槽位/物品/强化等级，EQUIPMENT_SLOT_KEYS 固定槽序）；
// - houseRooms（战斗可用房间 >0，按 hrid 排序忽略声明顺序；非战斗房间不进入
//   computePlayerAssetScore 的消费——修改厨房等生产房间不影响资产分，也不应使快照失配）；
// - abilities（非空技能槽位，按 hrid 排序忽略槽位重排噪音）；
// - guildBuffs（>0 的战斗神龛）；
// - 工匠茶精炼折扣：以 resolveCraftingTeaLessResource 的数值进入签名——compute 的
//   实际输入就是该数值（非工匠茶的变化不影响资产分），同时避免跨导入时
//   sanitizeCraftingTeaSlots 归一化形状差异造成的签名漂移（pouch 强化联动已在 equipment 内）。
// 不含行情（pricing）输入：行情可用时 refreshAssetScores 总是重算；不可用时取价链
// 只依赖静态数据（vendor/detailMap），同配置必同值；资产分取价链不读手动价格
//（双拦截，均 2026-08-31 修复：buildCostModelPricing 出口剔除 overrides 字段 +
// resolveQuoteEntry 对 level-0 挂单优先读 basePriceTable——store 的 priceTable 已合并
// 手动价格；手动价格仅影响队列/升级成本）。
// 用途：行情不可用时快照仅在「签名与当前配置一致」时保留（导入携带兜底），
// 配置一变即视为过时，交由重算路径处理。
export function computeAssetScoreConfigSignature(player) {
  const safePlayer = isPlainObject(player) ? player : {};
  const equipment = EQUIPMENT_SLOT_KEYS.map((slotKey) => {
    const entry = safePlayer.equipment?.[slotKey];
    return [slotKey, String(entry?.itemHrid || ''), clampEnhancementLevel(entry?.enhancementLevel)];
  });
  // 只覆盖战斗可用房间：与 computePlayerAssetScore 的房屋消费过滤（isCombatHouseRoomDetail）
  // 同一谓词——非战斗房间不进入资产分计算，也不进入签名（2026-09-02 一般-4 修复）。
  // 未知房间 hrid（houseRoomDetailMap 查不到）同样不进入签名，与 compute 只遍历
  // detailMap 的消费方式对齐。
  const houseRooms = Object.entries(isPlainObject(safePlayer.houseRooms) ? safePlayer.houseRooms : {})
    .map(([roomHrid, level]) => [String(roomHrid), clampLevel(level)])
    .filter(([roomHrid, level]) => level > 0 && isCombatHouseRoomDetail(houseRoomDetailMap?.[roomHrid]))
    .sort((left, right) => compareStringsByCodePoint(left[0], right[0]));
  const abilities = (Array.isArray(safePlayer.abilities) ? safePlayer.abilities : [])
    .map((ability) => [String(ability?.abilityHrid || ''), Math.max(1, clampLevel(ability?.level))])
    .filter(([abilityHrid]) => abilityHrid)
    .sort((left, right) => compareStringsByCodePoint(left[0], right[0]));
  const guildBuffs = combatGuildBuffHrids
    .map((buffHrid) => [String(buffHrid), clampLevel(safePlayer.guildBuffs?.[buffHrid])])
    .filter(([, level]) => level > 0);
  return JSON.stringify([
    ASSET_SCORE_CONFIG_SIGNATURE_VERSION,
    equipment,
    houseRooms,
    abilities,
    guildBuffs,
    resolveCraftingTeaLessResource(safePlayer),
  ]);
}

// 战斗房间判定（资产分房屋消费的唯一过滤源）：computePlayerAssetScore 的房屋消费
// 循环与 computeAssetScoreConfigSignature 的签名覆盖共用同一谓词，保证「签名覆盖面 =
// 计算实际输入」不因两侧各自演化而漂移（2026-09-02 一般-4 修复：此前签名覆盖全部 >0
// 房间而计算只消费战斗房间，行情不可用守卫下修改厨房等非战斗房间会无谓丢弃仍有效的
// 导入快照）。
function isCombatHouseRoomDetail(roomDetail) {
  return roomDetail?.usableInActionTypeMap?.['/action_types/combat'] === true;
}

// 计算单个玩家的资产分。玩家没有任何资产相关数据时返回 null（UI 隐藏）。
export function computePlayerAssetScore(player, pricing) {
  const safePlayer = isPlainObject(player) ? player : {};

  const equipmentItems = [];
  let equipmentTotal = 0;
  // 精炼装备的材料折扣（工匠茶 lessResource × 暴饮之囊加浓）——玩家配置驱动，
  // 与 MWITools plan 的 refinementCostComponents（projectAction 投影）同口径。
  const craftingTeaLessResource = resolveCraftingTeaLessResource(safePlayer);
  for (const slotKey of EQUIPMENT_SLOT_KEYS) {
    const entry = safePlayer.equipment?.[slotKey];
    const itemHrid = String(entry?.itemHrid || '');
    if (!itemHrid) {
      continue;
    }
    const level = clampEnhancementLevel(entry?.enhancementLevel);
    // 穿戴装备走装备专用估值（官方估算 vs 强化成本择优 + 背部装备强制保护镜）。
    const resolved = resolveEquipmentAssetValue(pricing, itemHrid, level, slotKey, 0, {
      refinementLessResource: craftingTeaLessResource,
    });
    equipmentTotal += resolved.price;
    equipmentItems.push({
      slotKey,
      itemHrid,
      enhancementLevel: level,
      value: Math.round(resolved.price),
      source: resolved.source,
    });
  }

  const houseRooms = [];
  let houseTotal = 0;
  for (const roomDetail of Object.values(houseRoomDetailMap || {})) {
    const roomHrid = String(roomDetail?.hrid || '');
    if (!roomHrid) {
      continue;
    }
    if (!isCombatHouseRoomDetail(roomDetail)) {
      continue;
    }
    const level = clampLevel(safePlayer.houseRooms?.[roomHrid]);
    if (level <= 0) {
      continue;
    }
    const invested = sumHouseRoomInvestment(pricing, roomDetail, level);
    houseTotal += invested.value;
    houseRooms.push({
      roomHrid,
      level,
      value: Math.round(invested.value),
      incomplete: invested.incomplete,
    });
  }

  const abilityRows = [];
  let abilitiesTotal = 0;
  for (const ability of Array.isArray(safePlayer.abilities) ? safePlayer.abilities : []) {
    const abilityHrid = String(ability?.abilityHrid || '');
    if (!abilityHrid) {
      continue;
    }
    const level = Math.max(1, clampLevel(ability?.level));
    const bookItemHrid = String(abilityBookInfoByAbilityHrid?.[abilityHrid]?.itemHrid || '');
    const invested = abilityBookInvestment(pricing, abilityHrid, level);
    abilitiesTotal += invested.value;
    abilityRows.push({
      abilityHrid,
      level,
      bookItemHrid,
      value: Math.round(invested.value),
      incomplete: invested.incomplete,
    });
  }

  const shrineRows = [];
  let shrineTotal = 0;
  for (const buffHrid of combatGuildBuffHrids) {
    const level = clampLevel(safePlayer.guildBuffs?.[buffHrid]);
    if (level <= 0) {
      continue;
    }
    const invested = sumGuildBuffInvestment(pricing, buffHrid, level);
    shrineTotal += invested.value;
    shrineRows.push({
      guildBuffHrid: buffHrid,
      level,
      value: Math.round(invested.value),
      incomplete: invested.incomplete,
    });
  }

  const hasAssetData =
    equipmentItems.length > 0 || houseRooms.length > 0 || abilityRows.length > 0 || shrineRows.length > 0;
  if (!hasAssetData) {
    return null;
  }

  const totalGold = Math.round(equipmentTotal + houseTotal + abilitiesTotal + shrineTotal);
  return {
    version: ASSET_SCORE_VERSION,
    total: Math.round((totalGold / ASSET_SCORE_UNIT) * 10) / 10,
    totalGold,
    sections: {
      equipment: Math.round(equipmentTotal),
      house: Math.round(houseTotal),
      abilities: Math.round(abilitiesTotal),
      shrine: Math.round(shrineTotal),
    },
    items: {
      equipment: equipmentItems.slice(0, 20),
      houseRooms: houseRooms.slice(0, 50),
      abilities: abilityRows.slice(0, 10),
      shrine: shrineRows.slice(0, 20),
    },
    computedAt: Date.now(),
    // 当前配置签名：行情不可用时 store 守卫据此判断快照是否仍与配置对应（导入携带兜底）。
    configSignature: computeAssetScoreConfigSignature(safePlayer),
  };
}

// 技能书已投入成本（练到当前等级所需书本的市价）。
// MWITools calculateAbilityScore 同款口径（L9948-9962）：所需经验 = levelExperienceTable 等级累计值
//（表[1] = 0，无需减起始），本数 = 累计经验 ÷ 每本经验 **+ 1 本**（不取整、保留一位小数）；
// 每本经验取 abilityBookInfoByAbilityHrid.xpPerBook（50/500 两档，与 MWITools 硬编码一致）；
// 书本单价走资产分取价链（比队列模块的单一 bid 口径更完整）。参考数据缺失时返回 null。
function abilityBookInvestment(pricing, abilityHrid, level) {
  const bookInfo = abilityBookInfoByAbilityHrid?.[String(abilityHrid || '')] || null;
  const bookItemHrid = String(bookInfo?.itemHrid || '');
  const xpPerBook = Math.max(0, toFiniteNumber(bookInfo?.xpPerBook, 0));
  if (!bookItemHrid || xpPerBook <= 0 || !Array.isArray(levelExperienceTable) || levelExperienceTable.length <= 1) {
    return { value: 0, incomplete: true };
  }

  const endXp = level < levelExperienceTable.length ? toFiniteNumber(levelExperienceTable[level], -1) : -1;
  if (endXp < 0) {
    return { value: 0, incomplete: true };
  }

  // MWITools needExp / abilityPerBookExp + 1，再 toFixed(1)——额外的第 1 本。
  const booksNeeded = Number((endXp / xpPerBook + 1).toFixed(1));
  if (!Number.isFinite(booksNeeded) || booksNeeded <= 0) {
    return { value: 0, incomplete: true };
  }

  const priced = resolveAssetItemValue(pricing, bookItemHrid, 0);
  if (priced.price <= 0) {
    return { value: 0, incomplete: true };
  }

  return { value: booksNeeded * priced.price, incomplete: false };
}

// MWITools formatScore 同款舍入口径（输入单位 M）：
//   >100  → 四舍五入整数 + 千分位（9,505）
//   ≤100  → 保留一位小数（45.2）
export function formatScoreValue(valueM) {
  const numericValue = toFiniteNumber(valueM, 0);
  if (numericValue > 100) {
    return Math.round(numericValue).toLocaleString('en-US');
  }
  return numericValue.toFixed(1);
}

// 展示格式：9,534 —— MWITools 面板同款纯数字（无前缀 / 无 M 后缀）。
// 优先用 totalGold（金币整数和）换算 M 后一次舍入，镜像 MWITools「浮点求和后展示层再舍入」语义，
// 避免 total 字段（0.1M 精度快照）二次舍入在 .x5 边界可能产生的 ±1 偏差。
export function formatAssetScoreLabel(assetScore) {
  const totalGold = toFiniteNumber(assetScore?.totalGold, Number.NaN);
  const totalM = Number.isFinite(totalGold) ? totalGold / ASSET_SCORE_UNIT : toFiniteNumber(assetScore?.total, 0);
  return formatScoreValue(totalM);
}
// 金币数值展示：转为 M 后按 MWITools 舍入口径显示（tooltip 分项与明细面板用，与 MWITools 面板数字直接可比）。
export function formatAssetScoreGold(value) {
  const amount = Math.max(0, Math.round(toFiniteNumber(value, 0)));
  if (amount === 0) {
    return '0';
  }
  return formatScoreValue(amount / ASSET_SCORE_UNIT);
}

// 行级白名单归一（与顶层重建同语义：未知字段丢弃、形状归一、超限截断、非法元素剔除）。
// incomplete 必须保留（PlayerCardsStrip tooltip 的缺失分项标注依赖它，04 方案 2.5/2.6）；
// 各行字段集与 computePlayerAssetScore 的自产行逐字段一致，合法载荷 round-trip 不变，
// assetScoreEquals（sanitize 幂等）语义不变。
function normalizeScoreRows(list, sanitizeRow, limit) {
  if (!Array.isArray(list)) {
    return [];
  }
  return list.map(sanitizeRow).filter(Boolean).slice(0, limit);
}

function sanitizeEquipmentItemRow(raw) {
  if (!isPlainObject(raw)) {
    return null;
  }
  const itemHrid = String(raw.itemHrid || '').trim();
  if (!itemHrid) {
    return null;
  }
  return {
    slotKey: String(raw.slotKey || ''),
    itemHrid,
    enhancementLevel: clampEnhancementLevel(raw.enhancementLevel),
    value: Math.max(0, Math.round(toFiniteNumber(raw.value, 0))),
    source: Object.values(ASSET_SCORE_SOURCES).includes(raw.source) ? raw.source : ASSET_SCORE_SOURCES.MISSING,
  };
}

function sanitizeHouseRoomRow(raw) {
  if (!isPlainObject(raw)) {
    return null;
  }
  const roomHrid = String(raw.roomHrid || '').trim();
  if (!roomHrid) {
    return null;
  }
  return {
    roomHrid,
    level: clampLevel(raw.level),
    value: Math.max(0, Math.round(toFiniteNumber(raw.value, 0))),
    incomplete: raw.incomplete === true,
  };
}

function sanitizeAbilityRow(raw) {
  if (!isPlainObject(raw)) {
    return null;
  }
  const abilityHrid = String(raw.abilityHrid || '').trim();
  if (!abilityHrid) {
    return null;
  }
  return {
    abilityHrid,
    level: clampLevel(raw.level),
    bookItemHrid: String(raw.bookItemHrid || ''),
    value: Math.max(0, Math.round(toFiniteNumber(raw.value, 0))),
    incomplete: raw.incomplete === true,
  };
}

function sanitizeShrineRow(raw) {
  if (!isPlainObject(raw)) {
    return null;
  }
  const guildBuffHrid = String(raw.guildBuffHrid || '').trim();
  if (!guildBuffHrid) {
    return null;
  }
  return {
    guildBuffHrid,
    level: clampLevel(raw.level),
    value: Math.max(0, Math.round(toFiniteNumber(raw.value, 0))),
    incomplete: raw.incomplete === true,
  };
}

// 持久化/导入时的资产分载荷校验：形状合法则原样保留（快照语义），否则丢弃（触发重算）。
export function sanitizeAssetScorePayload(raw) {
  if (!isPlainObject(raw) || Number(raw.version) !== ASSET_SCORE_VERSION) {
    return null;
  }
  const total = toFiniteNumber(raw.total, -1);
  const totalGold = toFiniteNumber(raw.totalGold, -1);
  const sections = isPlainObject(raw.sections) ? raw.sections : null;
  const items = isPlainObject(raw.items) ? raw.items : null;
  if (total < 0 || totalGold < 0 || !sections || !items) {
    return null;
  }
  const payload = {
    version: ASSET_SCORE_VERSION,
    total,
    totalGold: Math.round(totalGold),
    sections: {
      equipment: Math.max(0, Math.round(toFiniteNumber(sections.equipment, 0))),
      house: Math.max(0, Math.round(toFiniteNumber(sections.house, 0))),
      abilities: Math.max(0, Math.round(toFiniteNumber(sections.abilities, 0))),
      shrine: Math.max(0, Math.round(toFiniteNumber(sections.shrine, 0))),
    },
    items: {
      equipment: normalizeScoreRows(items.equipment, sanitizeEquipmentItemRow, 20),
      houseRooms: normalizeScoreRows(items.houseRooms, sanitizeHouseRoomRow, 50),
      abilities: normalizeScoreRows(items.abilities, sanitizeAbilityRow, 10),
      shrine: normalizeScoreRows(items.shrine, sanitizeShrineRow, 20),
    },
    computedAt: Math.max(0, Math.round(toFiniteNumber(raw.computedAt, 0))),
  };
  // 配置签名（v1.1+ 快照携带）：非空字符串才透传；旧格式快照无此字段时不添加该键，
  // 保持载荷形状向后兼容（store 守卫对无签名快照维持旧兜底行为）。
  const configSignature = String(raw.configSignature || '').trim();
  if (configSignature) {
    payload.configSignature = configSignature;
  }
  return payload;
}

// 两个资产分载荷是否等价（忽略 computedAt，供写入守卫挡同值写回——避免无谓的
// 引用替换与 UI 重渲染；deep watch 时代该守卫兼防 computedAt 漂移导致的写回循环，
// 改签名触发向量后快照写回不在 watch 依赖内、循环已不可能）。
export function assetScoreEquals(left, right) {
  const leftPayload = sanitizeAssetScorePayload(left);
  const rightPayload = sanitizeAssetScorePayload(right);
  if (leftPayload === null && rightPayload === null) {
    return true;
  }
  if (leftPayload === null || rightPayload === null) {
    return false;
  }
  const { computedAt: _leftComputedAt, ...leftRest } = leftPayload;
  const { computedAt: _rightComputedAt, ...rightRest } = rightPayload;
  return JSON.stringify(leftRest) === JSON.stringify(rightRest);
}

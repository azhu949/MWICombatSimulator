// 资产分（Gear Score）轻层模块：首屏常驻的共享常量与轻函数（展示格式化 / 载荷
// 校验 / 玩家配置签名 / 工匠茶折扣 / 输入归一）。
// 分层动机（2026-10-03 候选 A）：assetScoreService 的重计算链（强化模拟器成本法 +
// 商店/制作取价 + 成本缓存）改为按需动态加载（simulatorStore.loadAssetScoreModule），
// 不再进入首屏 index chunk；调用方（App.vue / 玩家卡片 / 导入导出 / store 快照守卫）
// 与测试所需的轻符号留在本模块，随首屏常驻。总下载量中性：重链在「首次资产分
// 刷新 / 导入导出」时按需拉取一次并缓存。
// 口径边界（2026-10-03 核验）：上述「下沉」只覆盖 assetScoreService 重计算链，不含
// 数据表下沉——房屋原始表 houseRoomDetailMap.json 仍随首屏加载，实际落点是
// playerMapper chunk（首屏 modulepreload 项，被 index chunk 静态 import）。该状态早于
// 本次拆分即存在（combatsimulator 战斗模块的静态引用为主因），本模块对它的静态引用
// 不改变其首屏归属。可复核锚点：dist/index.html 的 modulepreload 两项（gameData、
// playerMapper，文件名带哈希）；tmp/chunk-report-full.json 中 playerMapper chunk 下的
// houseRoomDetailMap.json 条目（rendered 90436 / original 172150）与本模块在 index
// chunk 下的条目。详见 docs/build-chunking.md。
// 单向依赖约定：本模块不得 import assetScoreService.js（依赖方向恒为 重 → 轻）。
// 全部函数实现搬迁自 assetScoreService 的原有私有副本（逐字保留），两侧数值口径
// 由既有测试锁定同值，禁止各自演化。
import { EQUIPMENT_SLOT_KEYS } from '../shared/playerConfig.js';
import { combatGuildBuffHrids } from '../shared/guildBuffs.js';
// 房屋原始表：生成的 houseRoomDetailIndex 精简掉了 usableInActionTypeMap，战斗房间
// 判定（配置签名与 computePlayerAssetScore 共用同一谓词）必须读原始 houseRoomDetailMap。
// 落点补充：该静态依赖把表挂在 playerMapper chunk（首屏预加载，见上），不因轻层常驻
// index chunk 而变为按需数据；真正下沉需另行立项（见 docs/build-chunking.md 口径边界）。
import houseRoomDetailMap from '../combatsimulator/data/houseRoomDetailMap.json';

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

// —— 输入归一与通用小工具（轻/重两侧共用：此处定义，assetScoreService 引用）——
export function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clampLevel(value) {
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
export function clampEnhancementLevel(value) {
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

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

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
export function isCombatHouseRoomDetail(roomDetail) {
  return roomDetail?.usableInActionTypeMap?.['/action_types/combat'] === true;
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

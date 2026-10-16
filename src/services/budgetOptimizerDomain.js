// 预算优化（Budget Optimizer）—— 纯领域模块。
//
// 职责：
//   1) 设置归一化与校验（预算/区间/范围开关/优化目标/搜索档）；
//   2) 候选枚举与成本预计算：主角的装备槽（当前物品强化档 / 精炼版）、
//      已装备技能等级、战斗房子等级；成本全部复用 queueUpgradeCost 的定价口径
//      （装备 = 直购 Ask 链 − 旧件卖出抵扣；技能 = 技能书；房子 = 升级材料），
//      与队列/成本弹窗同源，不开第二套成本模型；
//   3) 配对随机数种子集（createBudgetOptimizerSeedSet）：基线与全部候选共享同一组种子；
//   4) 输入指纹（createBudgetOptimizerInput / Signature）供报告过期判定。
//
// 口径要点（用户确认）：
//   - 只优化主角（当前激活角色）；候选只枚举主角槽位；队友不产生候选；
//   - 预算是整份配置的净支出合计（买新 − 卖旧），上限 = budget × (1 + bandRatio) 为硬约束；
//   - 价值 = Δ主角目标指标点估计（DPS / 利润 / 经验；由搜索层按 objective 评估后注入），
//     "接近预算"仅作展示口径。

import {
  EQUIPMENT_SLOT_KEYS,
  abilityBookInfoByAbilityHrid,
  getAbilityName,
  getHouseRoomName,
  getItemName,
  houseRoomHrids,
  levelExperienceTable,
} from '../shared/gameDataIndex.js';
import actionDetailMap from '../combatsimulator/data/actionDetailMap.json';
import itemDetailMap from '../combatsimulator/data/itemDetailMap.json';
// 原始房屋表：生成的 houseRoomDetailIndex 出于体积考虑精简掉了 usableInActionTypeMap，
// 战斗房间判定与升级材料表必须读原始表（与 assetScoreService 同款落点口径）。
import houseRoomDetailMap from '../combatsimulator/data/houseRoomDetailMap.json';
import {
  buildHouseRoomUpgradeCostPreview,
  computeDefaultAbilityUpgradeCost,
  ensureAbilityUpgradeReferenceGlobals,
  hasAbilityUpgradeReferenceDataLoaded,
  resolveEquipmentTransitionPricing,
} from './queueUpgradeCost.js';
import { deriveSeedSet, hashSeed } from './seededRandom.js';
// 买入口径来源白名单（2026-10-16 契约边界下沉）：估值分支来源门兜底使用（见 buildBudgetCandidates JSDoc）。
import { BUY_SIDE_ASSET_SCORE_SOURCES } from './assetScorePresentation.js';
import { deepClone, isPlainObject, normalizeBaselineSaleSide, toFiniteNumber } from './utils.js';

// ── 常量 ──────────────────────────────────────────────────────────────
export const BUDGET_OPTIMIZER_DEFAULT_BUDGET_COINS = 1_000_000_000;
export const BUDGET_OPTIMIZER_DEFAULT_BAND_RATIO = 0.2;
export const BUDGET_OPTIMIZER_MAX_BAND_RATIO = 0.5;
export const BUDGET_OPTIMIZER_DEFAULT_SIMULATION_HOURS = 24;
export const BUDGET_OPTIMIZER_MIN_SIMULATION_HOURS = 1;
export const BUDGET_OPTIMIZER_MAX_SIMULATION_HOURS = 72;
export const BUDGET_OPTIMIZER_DEFAULT_MAX_LEVEL_UP = 8;
export const BUDGET_OPTIMIZER_MIN_MAX_LEVEL_UP = 1;
export const BUDGET_OPTIMIZER_MAX_MAX_LEVEL_UP = 10;
export const BUDGET_OPTIMIZER_DEFAULT_MAX_HOUSE_UP = 5;
export const BUDGET_OPTIMIZER_MIN_MAX_HOUSE_UP = 1;
export const BUDGET_OPTIMIZER_MAX_MAX_HOUSE_UP = 8;
// 强化等级业务上限（与 queueUpgradeCost 的注释口径一致：业务上限 20）。
export const BUDGET_OPTIMIZER_MAX_ENHANCEMENT_LEVEL = 20;
// 升级链单次运行的步数上限（安全阀）：每步至少花费 1 金币，理论上预算/最小成本决定步数；
// 极端行情下（候选成本极小）步数可能失控，此上限强制收束 —— 到顶后报告 stopReason='step-limit'，
// 用户可再次「开始」从当前配置继续（已应用的步骤已写回主角配置）。
// 用户可通过 stepLimitMode='custom' 把上限降到 maxChainSteps（1 ~ 本安全阀）；'unlimited'（默认）
// = 用完预算，即维持本安全阀语义。
export const BUDGET_OPTIMIZER_MAX_CHAIN_STEPS = 40;
// 链步数上限模式（设置字段 stepLimitMode）：
//   'unlimited' = 用完预算（默认，跑到安全阀/无可买项）；
//   'preset'    = 快捷预设步数（5/10/15，存 maxChainSteps）；
//   'custom'    = 自定义步数（maxChainSteps 1 ~ 安全阀）。
// preset 与 custom 分开存：UI 下拉以 (mode, maxChainSteps) 派生选中项 —— 若二者合并，
// 当步数恰为 5/10/15 时「自定义」选项会被预设项遮蔽（选中后显示弹回「N 步」，输入框出不来）。
export const BUDGET_OPTIMIZER_STEP_LIMIT_MODE_UNLIMITED = 'unlimited';
export const BUDGET_OPTIMIZER_STEP_LIMIT_MODE_PRESET = 'preset';
export const BUDGET_OPTIMIZER_STEP_LIMIT_MODE_CUSTOM = 'custom';
// 白名单（归一化回退与校验共用）。
export const BUDGET_OPTIMIZER_STEP_LIMIT_MODES = Object.freeze([
  BUDGET_OPTIMIZER_STEP_LIMIT_MODE_UNLIMITED,
  BUDGET_OPTIMIZER_STEP_LIMIT_MODE_PRESET,
  BUDGET_OPTIMIZER_STEP_LIMIT_MODE_CUSTOM,
]);
// 快捷预设（UI 下拉的 5 / 10 / 15）与自定义输入的缺省值；范围 1 ~ MAX_CHAIN_STEPS。
export const BUDGET_OPTIMIZER_STEP_LIMIT_PRESETS = Object.freeze([5, 10, 15]);
export const BUDGET_OPTIMIZER_MIN_CHAIN_STEPS = 1;
export const BUDGET_OPTIMIZER_DEFAULT_CHAIN_STEPS = 10;
// 链报告里每一步保留的候选明细条数上限（报告要持久化，候选池大 × 步数多会撑爆 localStorage；
// 截取按证据分档 + 性价比排序取头部，被截掉的只计入计数；2026-10-08 由 50 降到 15 ——
// 弹窗直接展示快照，条数多了一屏扫不完）。
export const BUDGET_OPTIMIZER_STEP_CANDIDATES_LIMIT = 15;
// 缺价诊断明细的条数上限（与候选快照 15 条同款：报告要持久化，防 localStorage 爆）。超限条目
// 不丢弃计数 —— diagnostics.skippedNoPrice 仍为全量，超限条数记入 skippedNoPriceDetailsTruncated，
// UI 据此提示「另有 N 条未展示」。
export const BUDGET_OPTIMIZER_SKIPPED_DETAILS_LIMIT = 60;
// 缺价跳过的原因标记（2026-10-16）：装备分支里「估值可得但不足以支撑正净支出」与「完全无价」是两类
// 原因，共用同一条 skippedNoPrice 通道（总数语义不变）；明细条目只在非默认原因上携带 reason 标记
// （结构化 token，文案由 UI 按当前语言现场解析，不固化进 domain/报告），旧条目 / 旧报告不带该字段。
export const BUDGET_OPTIMIZER_SKIP_REASON_FAIR_VALUE_BELOW_SALE = 'fair-value-below-sale';

// 优化目标（设置字段 objective）：利润（每日无随机利润）/ DPS / 经验（每小时经验）。
export const BUDGET_OPTIMIZER_OBJECTIVE_DPS = 'dps';
export const BUDGET_OPTIMIZER_OBJECTIVE_PROFIT = 'profit';
export const BUDGET_OPTIMIZER_OBJECTIVE_XP = 'xp';
// 默认优化目标 = 归一化缺省与非法值回退口径（UI 下拉默认选中项）。
export const BUDGET_OPTIMIZER_DEFAULT_OBJECTIVE = BUDGET_OPTIMIZER_OBJECTIVE_PROFIT;
// 白名单（归一化回退与校验共用）；顺序即 UI 下拉顺序：利润 → DPS → 经验。
export const BUDGET_OPTIMIZER_OBJECTIVES = Object.freeze([
  BUDGET_OPTIMIZER_OBJECTIVE_PROFIT,
  BUDGET_OPTIMIZER_OBJECTIVE_DPS,
  BUDGET_OPTIMIZER_OBJECTIVE_XP,
]);
// 优化目标 → 配对统计指标键（评估管道 AGGREGATED_METRIC_KEYS 的子集）：
// 主排序键（racing 排序 / DP 价值 / 联合复核 / nextBest）都按目标指标取数。
export const BUDGET_OPTIMIZER_OBJECTIVE_METRIC_KEYS = Object.freeze({
  [BUDGET_OPTIMIZER_OBJECTIVE_DPS]: 'dps',
  [BUDGET_OPTIMIZER_OBJECTIVE_PROFIT]: 'dailyNoRngProfit',
  [BUDGET_OPTIMIZER_OBJECTIVE_XP]: 'xpPerHour',
});

// 目标 → 指标键的解析（非法/缺失回退默认目标 profit，与设置归一化同口径）。
export function resolveBudgetObjectiveMetricKey(objective) {
  return (
    BUDGET_OPTIMIZER_OBJECTIVE_METRIC_KEYS[String(objective || '')] ||
    BUDGET_OPTIMIZER_OBJECTIVE_METRIC_KEYS[BUDGET_OPTIMIZER_DEFAULT_OBJECTIVE]
  );
}

export const BUDGET_OPTIMIZER_PRESET_FAST = 'fast';
export const BUDGET_OPTIMIZER_PRESET_STANDARD = 'standard';
// 精细档（2026-10-09，用户诉求「结果更稳」）：三层样本量 6 → 24 → 60 形成梯度，选择噪声相对
// 标准档降约 18%（√(16/24)），代价约 +50% 耗时；与「定选显著性门槛」开关配合使用最佳。
// 现有两档参数保持不动（既有报告的场次锚定不受影响）。
export const BUDGET_OPTIMIZER_PRESET_FINE = 'fine';
// 搜索档位：粗筛种子数 / 精筛种子总数（含复用的粗筛样本）/ 链终复验种子数（链结束后对链
// 终点配置用 verify 盐独立测量的样本量 —— 它是给用户的「最终测量值」，要比筛选样本大一个
// 量级，否则复验自身的噪声不比账面推算好多少）/ 精筛保留比例（乐观上界排序后保留的比例）。
export const BUDGET_OPTIMIZER_PRESETS = Object.freeze({
  [BUDGET_OPTIMIZER_PRESET_FAST]: Object.freeze({
    screenSeeds: 2,
    refineSeeds: 8,
    verifySeeds: 24,
    refineKeepRatio: 0.5,
    refineKeepMin: 6,
  }),
  [BUDGET_OPTIMIZER_PRESET_STANDARD]: Object.freeze({
    screenSeeds: 4,
    refineSeeds: 16,
    verifySeeds: 50,
    refineKeepRatio: 0.6,
    refineKeepMin: 12,
  }),
  [BUDGET_OPTIMIZER_PRESET_FINE]: Object.freeze({
    screenSeeds: 6,
    refineSeeds: 24,
    verifySeeds: 60,
    refineKeepRatio: 0.6,
    refineKeepMin: 12,
  }),
});

// 种子盐：粗筛 / 精筛 / 链终复验三段相互独立；复验用独立盐是「样本分割」——
// 链终点配置的提升不能再用「挑出它的那批样本」来测量（选择性偏差），必须换一批新种子。
export const BUDGET_OPTIMIZER_SEED_SALT_SCREEN = 'budget-optimizer.screen.v1';
export const BUDGET_OPTIMIZER_SEED_SALT_REFINE = 'budget-optimizer.refine.v1';
export const BUDGET_OPTIMIZER_SEED_SALT_VERIFY = 'budget-optimizer.verify.v1';

export const BUDGET_OPTIMIZER_BUSY_ERROR = 'common:budgetOptimizer.busy';
export const BUDGET_OPTIMIZER_WORKER_ID = 'budget-optimizer';

// ── 设置 ──────────────────────────────────────────────────────────────

// fallback 默认取 min 保持旧行为；显式传产品默认值（如 bandRatio ±20%）时不要把缺省读成
// min——否则 BUDGET_OPTIMIZER_DEFAULT_BAND_RATIO 永远不可达，区间上限静默塌成预算本身。
function clampNumber(value, min, max, fallback = min) {
  const safe = toFiniteNumber(value, fallback);
  return Math.min(max, Math.max(min, safe));
}

function clampInt(value, min, max, fallback = min) {
  const safe = Math.floor(toFiniteNumber(value, fallback));
  return Math.min(max, Math.max(min, safe));
}

export function normalizeBudgetOptimizerSettings(raw = {}) {
  const source = isPlainObject(raw) ? raw : {};
  const partyIds = Array.isArray(source.partyPlayerIds) ? source.partyPlayerIds : [];
  // 白名单必须查键名：Object.values 得到的是档位对象数组，includes('fast') 恒为 false，
  // 会让"快速"档被静默回退成标准档（搜索强度设置形同虚设）。
  const presetKeys = Object.keys(BUDGET_OPTIMIZER_PRESETS);
  return {
    budgetCoins: Math.max(0, toFiniteNumber(source.budgetCoins, BUDGET_OPTIMIZER_DEFAULT_BUDGET_COINS)),
    bandRatio: clampNumber(source.bandRatio, 0, BUDGET_OPTIMIZER_MAX_BAND_RATIO, BUDGET_OPTIMIZER_DEFAULT_BAND_RATIO),
    simulationHours: clampInt(
      source.simulationHours,
      BUDGET_OPTIMIZER_MIN_SIMULATION_HOURS,
      BUDGET_OPTIMIZER_MAX_SIMULATION_HOURS,
      BUDGET_OPTIMIZER_DEFAULT_SIMULATION_HOURS,
    ),
    partyPlayerIds: [...new Set(partyIds.map((id) => String(id || '')).filter(Boolean))],
    enableEquipment: source.enableEquipment !== false,
    enableAbilities: source.enableAbilities !== false,
    enableHouses: source.enableHouses !== false,
    objective: BUDGET_OPTIMIZER_OBJECTIVES.includes(source.objective)
      ? source.objective
      : BUDGET_OPTIMIZER_DEFAULT_OBJECTIVE,
    maxLevelUp: clampInt(
      source.maxLevelUp,
      BUDGET_OPTIMIZER_MIN_MAX_LEVEL_UP,
      BUDGET_OPTIMIZER_MAX_MAX_LEVEL_UP,
      BUDGET_OPTIMIZER_DEFAULT_MAX_LEVEL_UP,
    ),
    maxHouseUp: clampInt(
      source.maxHouseUp,
      BUDGET_OPTIMIZER_MIN_MAX_HOUSE_UP,
      BUDGET_OPTIMIZER_MAX_MAX_HOUSE_UP,
      BUDGET_OPTIMIZER_DEFAULT_MAX_HOUSE_UP,
    ),
    searchPreset: presetKeys.includes(source.searchPreset) ? source.searchPreset : BUDGET_OPTIMIZER_PRESET_STANDARD,
    stepLimitMode: BUDGET_OPTIMIZER_STEP_LIMIT_MODES.includes(source.stepLimitMode)
      ? source.stepLimitMode
      : BUDGET_OPTIMIZER_STEP_LIMIT_MODE_UNLIMITED,
    maxChainSteps: clampInt(
      source.maxChainSteps,
      BUDGET_OPTIMIZER_MIN_CHAIN_STEPS,
      BUDGET_OPTIMIZER_MAX_CHAIN_STEPS,
      BUDGET_OPTIMIZER_DEFAULT_CHAIN_STEPS,
    ),
    // 定选显著性门槛（2026-10-09 起默认开启）：只认显式 false 关闭（与范围开关同款语义）；
    // 开启后定选只接受配对 t 检验显著为正的候选，滤掉「点估计碰巧为正」的噪声升级。
    pickSignificanceGate: source.pickSignificanceGate !== false,
  };
}

// 整数字段（simulationHours / maxLevelUp / maxHouseUp / maxChainSteps）必须为整数：归一化侧
// clampInt 会把小数静默 floor，校验侧显式拒绝，避免「输入 3.5、显示 3.5、实际按 3 运行」的
// 显示与生效值脱节（与 food 优化器 isValidFoodOptimizerSettings 的整数字段校验同口径）。
export function isValidBudgetOptimizerSettings(settings) {
  if (!isPlainObject(settings)) return false;
  if (!(toFiniteNumber(settings.budgetCoins, 0) > 0)) return false;
  if (!(
    toFiniteNumber(settings.bandRatio, -1) >= 0 &&
    toFiniteNumber(settings.bandRatio, 1) <= BUDGET_OPTIMIZER_MAX_BAND_RATIO
  ))
    return false;
  const hours = toFiniteNumber(settings.simulationHours, 0);
  if (
    !Number.isInteger(hours) ||
    !(hours >= BUDGET_OPTIMIZER_MIN_SIMULATION_HOURS && hours <= BUDGET_OPTIMIZER_MAX_SIMULATION_HOURS)
  )
    return false;
  const maxLevelUp = toFiniteNumber(settings.maxLevelUp, 0);
  if (
    !Number.isInteger(maxLevelUp) ||
    !(maxLevelUp >= BUDGET_OPTIMIZER_MIN_MAX_LEVEL_UP && maxLevelUp <= BUDGET_OPTIMIZER_MAX_MAX_LEVEL_UP)
  )
    return false;
  const maxHouseUp = toFiniteNumber(settings.maxHouseUp, 0);
  if (
    !Number.isInteger(maxHouseUp) ||
    !(maxHouseUp >= BUDGET_OPTIMIZER_MIN_MAX_HOUSE_UP && maxHouseUp <= BUDGET_OPTIMIZER_MAX_MAX_HOUSE_UP)
  )
    return false;
  if (!BUDGET_OPTIMIZER_OBJECTIVES.includes(String(settings.objective || ''))) return false;
  if (!BUDGET_OPTIMIZER_STEP_LIMIT_MODES.includes(String(settings.stepLimitMode || ''))) return false;
  const maxChainSteps = toFiniteNumber(settings.maxChainSteps, 0);
  if (
    !Number.isInteger(maxChainSteps) ||
    !(maxChainSteps >= BUDGET_OPTIMIZER_MIN_CHAIN_STEPS && maxChainSteps <= BUDGET_OPTIMIZER_MAX_CHAIN_STEPS)
  )
    return false;
  return Object.prototype.hasOwnProperty.call(BUDGET_OPTIMIZER_PRESETS, String(settings.searchPreset || ''));
}

export function resolveBudgetOptimizerPreset(settings) {
  const normalized = normalizeBudgetOptimizerSettings(settings);
  return (
    BUDGET_OPTIMIZER_PRESETS[normalized.searchPreset] || BUDGET_OPTIMIZER_PRESETS[BUDGET_OPTIMIZER_PRESET_STANDARD]
  );
}

// 链步数上限：'unlimited'（用完预算，默认）= 安全阀 MAX_CHAIN_STEPS；'preset' / 'custom' =
// 用户步数（仍被安全阀钳制，不超过 MAX_CHAIN_STEPS）。搜索层的循环边界与 step-limit 判定共用本口径。
export function resolveBudgetOptimizerStepCap(settings) {
  const normalized = normalizeBudgetOptimizerSettings(settings);
  if (
    normalized.stepLimitMode !== BUDGET_OPTIMIZER_STEP_LIMIT_MODE_PRESET &&
    normalized.stepLimitMode !== BUDGET_OPTIMIZER_STEP_LIMIT_MODE_CUSTOM
  ) {
    return BUDGET_OPTIMIZER_MAX_CHAIN_STEPS;
  }
  return clampInt(
    normalized.maxChainSteps,
    BUDGET_OPTIMIZER_MIN_CHAIN_STEPS,
    BUDGET_OPTIMIZER_MAX_CHAIN_STEPS,
    BUDGET_OPTIMIZER_MAX_CHAIN_STEPS,
  );
}

// 预算硬上限：净支出必须 ≤ budget × (1 + bandRatio)。缺省 bandRatio 与设置层归一化口径
// 一致（产品默认 ±20%）——否则原始设置缺字段时上限会塌成预算本身，与 UI 显示脱节。
export function resolveBudgetHigh(settings) {
  const budget = Math.max(0, toFiniteNumber(settings?.budgetCoins, 0));
  const ratio = clampNumber(
    settings?.bandRatio,
    0,
    BUDGET_OPTIMIZER_MAX_BAND_RATIO,
    BUDGET_OPTIMIZER_DEFAULT_BAND_RATIO,
  );
  return budget * (1 + ratio);
}

// ── 成本参考数据（技能书经验表）────────────────────────────────────────

// computeDefaultAbilityUpgradeCost 依赖全局的 jigsLevelExperienceTable（历史命名）；
// 数据本身就在 bundle 的 levelExperienceTable 里，这里做一次幂等注入。
export function ensureBudgetOptimizerCostReference() {
  const globalRef = ensureAbilityUpgradeReferenceGlobals();
  if (!Array.isArray(globalRef.jigsLevelExperienceTable) || globalRef.jigsLevelExperienceTable.length <= 1) {
    globalRef.jigsLevelExperienceTable = Array.isArray(levelExperienceTable)
      ? levelExperienceTable.map((value) => toFiniteNumber(value, 0))
      : [];
  }
  return hasAbilityUpgradeReferenceDataLoaded();
}

// ── 精炼家族（普通版 ↔ 精炼版）────────────────────────────────────────

let refineFamilyCache = null;

function getRefineFamilyMap() {
  if (refineFamilyCache) return refineFamilyCache;
  const baseToRefined = new Map();
  for (const action of Object.values(actionDetailMap || {})) {
    if (action?.retainAllEnhancement !== true) continue;
    const base = String(action?.upgradeItemHrid || '');
    const refined = (Array.isArray(action?.outputItems) ? action.outputItems : []).find(
      (entry) => itemDetailMap?.[entry?.itemHrid]?.equipmentDetail,
    )?.itemHrid;
    if (!base || !refined) continue;
    const refinedHrid = String(refined);
    baseToRefined.set(base, refinedHrid);
  }
  refineFamilyCache = { baseToRefined };
  return refineFamilyCache;
}

// ── 槽位辅助 ──────────────────────────────────────────────────────────

function isTwoHandWeapon(hrid) {
  return String(itemDetailMap?.[String(hrid || '')]?.equipmentDetail?.type || '') === '/equipment_types/two_hand';
}

// ── 候选枚举 ──────────────────────────────────────────────────────────

function equipmentCandidateId(slotKey, hrid, level) {
  return `equip:${slotKey}:${hrid}:${level}`;
}

// 缺价明细入账（2026-10-09）：明细条数不超过 BUDGET_OPTIMIZER_SKIPPED_DETAILS_LIMIT，超限只累加
// truncated 计数（skippedNoPrice 由调用方全量 +1）—— 保证「总计数 = 已展示 + 另有 N 条」精确成立，
// 报告体积不随候选规模膨胀。
function recordSkippedNoPriceDetail(diagnostics, entry) {
  if (diagnostics.skippedNoPriceDetails.length < BUDGET_OPTIMIZER_SKIPPED_DETAILS_LIMIT) {
    diagnostics.skippedNoPriceDetails.push(entry);
    return;
  }
  diagnostics.skippedNoPriceDetailsTruncated += 1;
}

/**
 * 生成全部候选。返回 { candidates, diagnostics }：
 *   candidates: [{ id, groupKey, kind, label, fromLabel, toLabel, cost, costDetail, effect }]
 *   diagnostics:{ skippedNoPrice, skippedNoPriceDetails, skippedNoPriceDetailsTruncated,
 *                 skippedFairValueBelowSale, fallbackFairValue, totalCandidates,
 *                 counts:{equipment,ability,house} }
 *   其中 skippedNoPrice = 因缺可用成本被丢弃的候选总数（语义不变）；
 *   skippedFairValueBelowSale = 其中的子集：「估值可得，但估值 ≤ 旧件卖出抵扣、无法支撑正净支出」
 *   （2026-10-16 诊断分流），其余为完全缺价；子集条目同时带 reason 标记（见下方常量）。
 *
 * 可选参数（升级链模式）：
 *   - budgetHighOverride：剩余额度剪枝（单候选成本必须 ≤ min(bandHigh, 剩余额度)）。
 *     链的剩余额度只会 ≤ bandHigh，min 只是防御调用方传错。
 *   - basePlayerConfig：链起点配置。maxLevelUp / maxHouseUp 的等级上限相对链起点计算
 *     而不是当前配置 —— 链逐步推进后当前等级不断提高，若相对每步起点，链会把等级一路
 *     推到满级，超出用户「最多比现在高 N 级」的设置意图。缺省时退化为旧行为（相对当前）。
 *   - fairValueResolver（估值回退，2026-10-08）：(itemHrid, enhancementLevel, context) =>
 *     { price, source } | null。装备/技能候选在买入侧完全缺价（cost 不可得）时，改按
 *     MWITools 装备价值口径估值（官方估算 → 挂单中价 → 成交均价 → 强化成本法 → …）参与
 *     搜索，尽量不因缺价跳过；估值仍不可得、或（装备）估值 ≤ 旧件卖出抵扣无法支撑正净
 *     支出（2026-10-16 修复，假免费防线）时照旧跳过。缺省（未注入）行为与旧版完全一致。
 *     契约边界（2026-10-16 起来源门下沉为域层兜底）：resolver 返回值带非空 source 时，域层按
 *     「买入成本口径」白名单 BUY_SIDE_ASSET_SCORE_SOURCES（ASSET_SCORE_SOURCES 六成员：
 *     official_estimate / synthetic_mid（官方估算与其合成中价标记）、market_quote（挂单中价）、
 *     market_trade（成交均价）、cost（强化成本法）、acquisition（获取成本））做来源门：
 *     不在白名单内的来源（如 vendor 商店卖店价——资产残值/回收价语义，不是买入成本）按
 *     「估值不可得」照旧跳过，绝不进数值门。缺 source（空串/undefined）放行——本契约只约定
 *     resolver「只应返回」买入口径来源（提示性约束，未强制 source 必填），而真实估值链全部
 *     分支必带 source，缺 source 不构成假买入价风险。调用方（store 侧 resolver 工厂）的
 *     vendor 过滤由此降级为双保险保留（详见下方估值分支旁注）。
 *     context: { kind: 'equipment', slotKey } | { kind: 'ability' }（供 resolver 区分取价函数）。
 *   - saleSide：装备候选旧件卖出抵扣的取价口径（'bid'/'ask'，经 normalizeBaselineSaleSide
 *     归一化，脏值回退 'bid'）。2026-10-09 接通全局 baselineSaleSide 设置：store 组装 input
 *     （读 activeQueueState.settings）→ search 透传至此，与队列页/成本弹窗同口径；
 *     抵扣口径同时纳入输入指纹（见 createBudgetOptimizerInput）。
 */
export function buildBudgetCandidates({
  playerConfig,
  pricingState,
  settings,
  saleSide = 'bid',
  budgetHighOverride,
  basePlayerConfig,
  fairValueResolver,
} = {}) {
  // 归一化加固（2026-10-09）：缺省 'bid' 语义不能被脏值绕过（如调用方直接透传原始设置）。
  const normalizedSaleSide = normalizeBaselineSaleSide(saleSide);
  const config = isPlainObject(playerConfig) ? playerConfig : {};
  // 链起点（缺省 = 当前配置，旧行为）：等级上限（maxLevelUp / maxHouseUp）相对它计算。
  const baseConfig = isPlainObject(basePlayerConfig) ? basePlayerConfig : config;
  const normalizedSettings = normalizeBudgetOptimizerSettings(settings);
  // 预算上限：设置口径（bandHigh）为默认；升级链模式传入「剩余额度」覆盖 —— 单候选剪枝按
  // min(bandHigh, override) 收紧（链的剩余额度只会 ≤ bandHigh，min 只是防御调用方传错）。
  const override = toFiniteNumber(budgetHighOverride, Number.POSITIVE_INFINITY);
  const budgetHigh = Math.min(resolveBudgetHigh(normalizedSettings), Math.max(0, override));
  const candidates = [];
  const diagnostics = {
    skippedNoPrice: 0,
    // 缺价候选明细（结构化 effect，UI 按当前语言现场解析展示名 —— 展示名不进 domain/报告）；
    // 超过 BUDGET_OPTIMIZER_SKIPPED_DETAILS_LIMIT 的部分只计入下方 truncated 计数。
    skippedNoPriceDetails: [],
    skippedNoPriceDetailsTruncated: 0,
    // 估值救回计数：买入侧缺价但 fairValueResolver 给出估值、得以参与搜索的候选数。
    fallbackFairValue: 0,
    // 「估值不足」跳过计数（2026-10-16）：skippedNoPrice 的子集 —— 估值可得但估值 ≤ 旧件卖出抵扣、
    // 无法支撑正净支出。与「完全缺价」区分开，供 UI 与事后排查分辨两类原因。
    skippedFairValueBelowSale: 0,
    totalCandidates: 0,
    counts: { equipment: 0, ability: 0, house: 0 },
  };

  if (normalizedSettings.enableEquipment) {
    buildEquipmentCandidates({
      config,
      pricingState,
      settings: normalizedSettings,
      saleSide: normalizedSaleSide,
      budgetHigh,
      baseConfig,
      candidates,
      diagnostics,
      fairValueResolver,
    });
  }
  if (normalizedSettings.enableAbilities) {
    buildAbilityCandidates({
      config,
      pricingState,
      settings: normalizedSettings,
      budgetHigh,
      baseConfig,
      candidates,
      diagnostics,
      fairValueResolver,
    });
  }
  if (normalizedSettings.enableHouses) {
    buildHouseCandidates({
      config,
      pricingState,
      settings: normalizedSettings,
      budgetHigh,
      baseConfig,
      candidates,
      diagnostics,
    });
  }

  diagnostics.totalCandidates = candidates.length;
  return { candidates, diagnostics };
}

function buildEquipmentCandidates({
  config,
  pricingState,
  settings,
  saleSide,
  budgetHigh,
  baseConfig,
  candidates,
  diagnostics,
  fairValueResolver,
}) {
  for (const slotKey of EQUIPMENT_SLOT_KEYS) {
    // 双手武器时副手位不可用（副手候选会生成非法组合）。
    if (slotKey === 'off_hand' && isTwoHandWeapon(config?.equipment?.weapon?.itemHrid)) continue;

    const current = isPlainObject(config?.equipment?.[slotKey]) ? config.equipment[slotKey] : {};
    const currentHrid = String(current?.itemHrid || '');
    const currentLevel = clampInt(current?.enhancementLevel, 0, BUDGET_OPTIMIZER_MAX_ENHANCEMENT_LEVEL, 0);
    // 等级上限相对链起点（缺省 = 当前）：见 buildBudgetCandidates 的 basePlayerConfig 说明。
    const baseLevel = clampInt(
      baseConfig?.equipment?.[slotKey]?.enhancementLevel,
      0,
      BUDGET_OPTIMIZER_MAX_ENHANCEMENT_LEVEL,
      currentLevel,
    );
    const currentLabel = currentHrid ? `${getItemName(currentHrid, currentHrid)} +${currentLevel}` : '空';
    const slotCandidates = [];
    const seenTargets = new Set();

    const tryAdd = (hrid, level) => {
      if (!hrid) return;
      if (level < 0 || level > BUDGET_OPTIMIZER_MAX_ENHANCEMENT_LEVEL) return;
      if (hrid === currentHrid && level === currentLevel) return;
      const targetKey = `${hrid}|${level}`;
      if (seenTargets.has(targetKey)) return;
      seenTargets.add(targetKey);
      const pricing = resolveEquipmentTransitionPricing(currentHrid, currentLevel, hrid, level, pricingState, [], {
        saleSide,
      });
      // 成本口径（2026-10-08 估值回退）：优先走队列同源的直购链（精确 ask / 用户确认价）；
      // 买入侧完全缺价（cost 不可得）时，改按 MWITools 装备价值口径估值（fairValueResolver：
      // 官方估算 → 挂单中价 → 成交均价 → 强化成本法 → 获取成本 → 商店价）当买入成本，
      // 抵扣仍用原链的旧件卖出抵扣（缺价按 0，保守不低估净支出）。估值也不可得时照旧跳过。
      const directCostAvailable = pricing?.cost != null && Number.isFinite(Number(pricing.cost));
      const saleValue = Math.max(0, toFiniteNumber(pricing?.baselineSaleValue, 0));
      let cost = directCostAvailable ? Math.max(0, Number(pricing.cost)) : null;
      let priceSource = directCostAvailable ? String(pricing.targetPriceSource || '') : '';
      let estimatedByFairValue = false;
      // 「估值可得但不足以支撑正净支出」标记（2026-10-16 诊断分流）：只在下方的数值门未过时置真；
      // fairPrice === 0（resolver 也给不出值）仍算完全缺价，不置真。
      let fairValueBelowSale = false;
      if (cost == null && typeof fairValueResolver === 'function') {
        const fair = fairValueResolver(hrid, level, { kind: 'equipment', slotKey });
        // 来源门兜底（2026-10-16 契约边界下沉）：带非空 source 且不在买入白名单内的返回值（如
        // vendor 商店卖店价——资产残值语义，非买入成本）视同「估值不可得」，按 0 价走下方
        // 完全缺价记账，不进数值门、不置 fairValueBelowSale（「估值不足」子计数语义只属于
        // 「估值可得但数值不足」，见 diagnostics 字段声明）。缺 source 放行：契约未强制
        // source 必填，真实估值链全部分支必带 source（理由详见函数头 JSDoc）。
        const fairSource = String(fair?.source || '');
        const buySideSource = !fairSource || BUY_SIDE_ASSET_SCORE_SOURCES.has(fairSource);
        const fairPrice = buySideSource ? toFiniteNumber(fair?.price, 0) : 0;
        // 估值分支要求净支出为正（2026-10-16 修复）：`估值 − 旧件卖出抵扣 ≤ 0` 只在两侧
        // 都是可成交实价时才构成「免费/白赚」证据；估值不是买入报价，低失真估值会得出
        // 「估值 ≤ 旧件实价」的假免费（真实事故：魔术师帽★ +20 落商店卖店价 350 万 ≤
        // +12 实价卖出抵扣 → 净支出钳 0 → 搜索层按「免费项」定选、界面显示花费 0）。
        // 估值不足以支撑正净支出时按缺价跳过（该估值无法支撑任何成本结论）。
        // 旁注（2026-10-16 来源门已下沉为域层兜底）：本分支对带非空 source 的返回值按买入
        // 白名单来源门拦截，vendor 被拒后不再触发「估值不足」记账，数值校验只对白名单
        // 来源生效（详见函数头 JSDoc）。测试「估值回退来源门…」的 (a)/(c) 段锚定拦截行为。
        if (fairPrice > saleValue) {
          cost = fairPrice - saleValue;
          priceSource = String(fair?.source || 'fair_value');
          estimatedByFairValue = true;
          diagnostics.fallbackFairValue += 1;
        } else if (fairPrice > 0) {
          // 估值可得但估值 ≤ 旧件卖出抵扣（含相等：数值门要求严格大于）→ 该估值支撑不了任何成本
          // 结论，按缺价跳过；这与「完全无价」不是同一原因，留给下方记账分流。
          fairValueBelowSale = true;
        }
      }
      if (cost == null) {
        diagnostics.skippedNoPrice += 1;
        // 原因分流（2026-10-16）：skippedNoPrice 仍为「因缺可用成本被丢弃」的总数；「估值不足」子集
        // 另计数并给明细打 reason 标记，完全缺价的条目保持旧形状（仅 kind + effect）。
        const skippedDetail = {
          kind: 'equipment',
          effect: { type: 'equipment', slotKey, itemHrid: hrid, enhancementLevel: level },
        };
        if (fairValueBelowSale) {
          diagnostics.skippedFairValueBelowSale += 1;
          skippedDetail.reason = BUDGET_OPTIMIZER_SKIP_REASON_FAIR_VALUE_BELOW_SALE;
        }
        recordSkippedNoPriceDetail(diagnostics, skippedDetail);
        return;
      }
      if (cost > budgetHigh) return;
      slotCandidates.push({
        id: equipmentCandidateId(slotKey, hrid, level),
        groupKey: `equip:${slotKey}`,
        kind: 'equipment',
        label: `${getItemName(hrid, hrid)} +${level}`,
        fromLabel: currentLabel,
        // 应用前状态（结构化）：报告透传给 UI 做本地化名称展示（应用路径仍按 id 反查，不读它）。
        fromEffect: { type: 'equipment', slotKey, itemHrid: currentHrid, enhancementLevel: currentLevel },
        toLabel: `${getItemName(hrid, hrid)} +${level}`,
        cost,
        costDetail: {
          targetAsk:
            directCostAvailable && Number.isFinite(Number(pricing.targetAsk)) ? Number(pricing.targetAsk) : null,
          saleValue,
          priceSource,
          estimatedByFairValue,
        },
        effect: { type: 'equipment', slotKey, itemHrid: hrid, enhancementLevel: level },
      });
    };

    if (currentHrid) {
      // 等级上限 = min(业务上限 20, 链起点等级 + maxLevelUp)（baseLevel 缺省退化为 currentLevel）。
      const maxLevel = Math.min(
        BUDGET_OPTIMIZER_MAX_ENHANCEMENT_LEVEL,
        Math.max(currentLevel, baseLevel + settings.maxLevelUp),
      );
      // 1) 当前物品的强化档位（逐级）。
      for (let level = currentLevel + 1; level <= maxLevel; level += 1) tryAdd(currentHrid, level);
      // 2) 精炼版（0 档起；价格剪枝后自然只留下预算内的档位）。
      const refinedHrid = getRefineFamilyMap().baseToRefined.get(currentHrid);
      if (refinedHrid) {
        for (let level = 0; level <= maxLevel; level += 1) tryAdd(refinedHrid, level);
      }
    }

    if (slotCandidates.length === 0) continue;
    candidates.push(...slotCandidates);
    diagnostics.counts.equipment += slotCandidates.length;
  }
}

function buildAbilityCandidates({
  config,
  pricingState,
  settings,
  budgetHigh,
  baseConfig,
  candidates,
  diagnostics,
  fairValueResolver,
}) {
  const abilities = Array.isArray(config?.abilities) ? config.abilities : [];
  const baseAbilities = Array.isArray(baseConfig?.abilities) ? baseConfig.abilities : [];
  const seenAbilityHrids = new Set();
  abilities.forEach((ability) => {
    const abilityHrid = String(ability?.abilityHrid || '');
    if (!abilityHrid || seenAbilityHrids.has(abilityHrid)) return;
    seenAbilityHrids.add(abilityHrid);
    const fromLevel = Math.max(1, Math.floor(toFiniteNumber(ability?.level, 1)));
    // 等级上限相对链起点（缺省 = 当前等级，旧行为）。
    const baseLevel = Math.max(
      1,
      Math.floor(
        toFiniteNumber(
          baseAbilities.find((entry) => String(entry?.abilityHrid || '') === abilityHrid)?.level,
          fromLevel,
        ),
      ),
    );
    const maxLevel = Math.max(fromLevel, baseLevel + settings.maxLevelUp);
    const name = getAbilityName(abilityHrid, abilityHrid);
    // 技能书物品（MWITools 口径估值回退用）：书价缺价时经 resolver 估值兜底。
    const bookItemHrid = String(abilityBookInfoByAbilityHrid?.[abilityHrid]?.itemHrid || '');
    const list = [];
    for (let level = fromLevel + 1; level <= maxLevel; level += 1) {
      let cost = computeDefaultAbilityUpgradeCost({ abilityHrid, level: fromLevel }, level, pricingState);
      let estimatedByFairValue = false;
      if ((cost == null || !Number.isFinite(Number(cost))) && typeof fairValueResolver === 'function' && bookItemHrid) {
        // 书价回退（2026-10-08）：技能书在行情里无 ask/bid/vendor 时，按 MWITools 装备价值
        // 口径（官方估算 → 挂单中价 → 成交均价 → 商店价）估书价，参与搜索。原链有价时
        // computeDefaultAbilityUpgradeCost 直接成功，不走这里（估值绝不覆盖实价）。
        const fair = fairValueResolver(bookItemHrid, 0, { kind: 'ability', abilityHrid });
        // 来源门兜底（同装备估值分支，2026-10-16 下沉）：非买入口径来源（如 vendor 商店价）视同
        // 估值不可得，bookPrice 为 0 时下方不触发、走缺价记账；缺 source 放行（理由见函数头 JSDoc）。
        const fairSource = String(fair?.source || '');
        const buySideSource = !fairSource || BUY_SIDE_ASSET_SCORE_SOURCES.has(fairSource);
        const bookPrice = buySideSource ? toFiniteNumber(fair?.price, 0) : 0;
        if (bookPrice > 0) {
          const fallbackCost = computeDefaultAbilityUpgradeCost(
            { abilityHrid, level: fromLevel },
            level,
            pricingState,
            { fallbackBookPrice: bookPrice },
          );
          if (fallbackCost != null && Number.isFinite(Number(fallbackCost))) {
            cost = fallbackCost;
            estimatedByFairValue = true;
            diagnostics.fallbackFairValue += 1;
          }
        }
      }
      if (cost == null || !Number.isFinite(Number(cost))) {
        diagnostics.skippedNoPrice += 1;
        recordSkippedNoPriceDetail(diagnostics, {
          kind: 'ability',
          effect: { type: 'ability', abilityHrid, level },
        });
        continue;
      }
      const safeCost = Math.max(0, Number(cost));
      if (safeCost > budgetHigh) continue;
      list.push({
        id: `ability:${abilityHrid}:${level}`,
        groupKey: `ability:${abilityHrid}`,
        kind: 'ability',
        label: `${name} Lv.${level}`,
        fromLabel: `${name} Lv.${fromLevel}`,
        fromEffect: { type: 'ability', abilityHrid, level: fromLevel },
        toLabel: `${name} Lv.${level}`,
        cost: safeCost,
        costDetail: estimatedByFairValue ? { estimatedByFairValue: true } : null,
        effect: { type: 'ability', abilityHrid, level },
      });
    }
    if (list.length === 0) return;
    candidates.push(...list);
    diagnostics.counts.ability += list.length;
  });
}

function buildHouseCandidates({ config, pricingState, settings, budgetHigh, baseConfig, candidates, diagnostics }) {
  const rooms = isPlainObject(config?.houseRooms) ? config.houseRooms : {};
  const baseRooms = isPlainObject(baseConfig?.houseRooms) ? baseConfig.houseRooms : {};
  for (const roomHrid of Array.isArray(houseRoomHrids) ? houseRoomHrids : []) {
    const room = houseRoomDetailMap?.[roomHrid];
    if (!room) continue;
    if (room?.usableInActionTypeMap?.['/action_types/combat'] !== true) continue;
    const upgradeCostsMap = isPlainObject(room?.upgradeCostsMap) ? room.upgradeCostsMap : {};
    const maxLevel = Math.max(0, ...Object.keys(upgradeCostsMap).map((key) => Number(key) || 0));
    if (maxLevel <= 0) continue;
    const fromLevel = clampInt(rooms?.[roomHrid], 0, maxLevel, 0);
    // 等级上限相对链起点（缺省 = 当前等级，旧行为）。
    const baseLevel = clampInt(baseRooms?.[roomHrid], 0, maxLevel, fromLevel);
    const topLevel = Math.min(maxLevel, Math.max(fromLevel, baseLevel + settings.maxHouseUp));
    const name = getHouseRoomName(roomHrid, roomHrid);
    const list = [];
    for (let level = fromLevel + 1; level <= topLevel; level += 1) {
      const preview = buildHouseRoomUpgradeCostPreview({ [roomHrid]: fromLevel }, { [roomHrid]: level }, pricingState);
      // 房子缺价判定（2026-10-09 修正）：preview.totals.totalCost 恒为有限数（缺价材料按 0 计入，
      // 见 queueUpgradeCost.buildHouseRoomUpgradeCostPreview），不能据此判缺价；改用 materials[].priced
      //（与房子升级预览弹窗的缺价口径一致）。任一非 coin 材料缺价即跳过，与装备/技能分支的诚实缺价语义对齐。
      const previewMaterials = Array.isArray(preview?.materials) ? preview.materials : [];
      const unpricedMaterials = previewMaterials
        .filter((entry) => entry.itemHrid !== '/items/coin' && entry.priced !== true)
        .map((entry) => entry.itemHrid);
      const rawCost = preview?.totals?.totalCost;
      if (unpricedMaterials.length > 0 || rawCost == null || !Number.isFinite(Number(rawCost))) {
        diagnostics.skippedNoPrice += 1;
        recordSkippedNoPriceDetail(diagnostics, {
          kind: 'house',
          effect: { type: 'house', roomHrid, level },
          unpricedMaterials,
        });
        continue;
      }
      const cost = Math.max(0, Number(rawCost));
      if (cost > budgetHigh) continue;
      list.push({
        id: `house:${roomHrid}:${level}`,
        groupKey: `house:${roomHrid}`,
        kind: 'house',
        label: `${name} ${level} 级`,
        fromLabel: `${name} ${fromLevel} 级`,
        fromEffect: { type: 'house', roomHrid, level: fromLevel },
        toLabel: `${name} ${level} 级`,
        cost,
        costDetail: null,
        effect: { type: 'house', roomHrid, level },
      });
    }
    if (list.length === 0) continue;
    candidates.push(...list);
    diagnostics.counts.house += list.length;
  }
}

// ── 配置补丁应用（供评估管道复用；纯数据 effect → 配置变更）──────────────

export function applyBudgetEffectToPlayerConfig(playerConfig, effect) {
  const config = isPlainObject(playerConfig) ? playerConfig : {};
  if (!config.equipment || typeof config.equipment !== 'object') config.equipment = {};
  if (!Array.isArray(config.abilities)) config.abilities = [];
  if (!isPlainObject(config.houseRooms)) config.houseRooms = {};
  if (!isPlainObject(effect)) return config;
  if (effect.type === 'equipment') {
    const slotKey = String(effect.slotKey || '');
    if (!slotKey) return config;
    config.equipment[slotKey] = {
      itemHrid: String(effect.itemHrid || ''),
      enhancementLevel: clampInt(effect.enhancementLevel, 0, BUDGET_OPTIMIZER_MAX_ENHANCEMENT_LEVEL, 0),
    };
    return config;
  }
  if (effect.type === 'ability') {
    const abilityHrid = String(effect.abilityHrid || '');
    // 与装备/房子分支同口径：空 hrid 的补丁会让配置里多出一条无主技能条目（导入脏数据/
    // 调用方笔误），"没匹配到就追加"只对非空 hrid 生效。
    if (!abilityHrid) return config;
    const level = Math.max(1, Math.floor(toFiniteNumber(effect.level, 1)));
    let matched = false;
    for (const ability of config.abilities) {
      if (String(ability?.abilityHrid || '') === abilityHrid) {
        ability.level = level;
        matched = true;
      }
    }
    if (!matched) config.abilities.push({ abilityHrid, level });
    return config;
  }
  if (effect.type === 'house') {
    const roomHrid = String(effect.roomHrid || '');
    if (!roomHrid) return config;
    config.houseRooms[roomHrid] = Math.max(0, Math.floor(toFiniteNumber(effect.level, 0)));
    return config;
  }
  return config;
}

// ── 种子集（配对随机数）───────────────────────────────────────────────

function simulatedTargetKey(simulationSettings) {
  const mode = String(simulationSettings?.mode ?? 'zone');
  if (mode === 'labyrinth') {
    return `lab:${simulationSettings?.labyrinthHrid ?? ''}:${simulationSettings?.roomLevel ?? ''}`;
  }
  return simulationSettings?.useDungeon
    ? `dungeon:${simulationSettings?.dungeonHrid ?? ''}`
    : `zone:${simulationSettings?.zoneHrid ?? ''}`;
}

// 种子键只取"与搜索过程无关的稳定上下文"：玩家 id + 目标 + 难度 + 时长 + 盐 + 步号。
// 刻意排除主角的装备/技能/房子（候选会在搜索中改变它们）与队友配置 —— 基线与每个候选
// 共享同一随机流，配对差才有意义（与触发优化器同款原则）。
// step（升级链模式）：链的每一步是一次独立实验，步号入键让步与步之间样本独立；
// 缺省（不传）与旧行为完全一致（单次搜索）。
export function createBudgetOptimizerSeedSet({ playerId, simulationSettings, salt, count, step } = {}) {
  const simulation = isPlainObject(simulationSettings) ? simulationSettings : {};
  const key = [
    String(playerId ?? ''),
    simulatedTargetKey(simulation),
    String(simulation.difficultyTier ?? ''),
    String(simulation.simulationTimeHours ?? ''),
    String(salt || ''),
    step == null ? '' : `step${Math.max(0, Math.floor(toFiniteNumber(step, 0)))}`,
  ].join('|');
  return deriveSeedSet(hashSeed(key), Math.max(1, Math.floor(toFiniteNumber(count, 1))));
}

// ── 输入指纹 ──────────────────────────────────────────────────────────

// 报告过期判定用的玩家配置摘要：剔除派生/展示字段（assetScore 快照随行情变，不参与）。
function sanitizeConfigForSignature(config) {
  const source = isPlainObject(config) ? config : {};
  return {
    id: String(source.id || ''),
    levels: deepClone(source.levels || {}),
    equipment: deepClone(source.equipment || {}),
    abilities: deepClone(source.abilities || []),
    houseRooms: deepClone(source.houseRooms || {}),
    food: deepClone(source.food || []),
    drinks: deepClone(source.drinks || []),
    triggerMap: deepClone(source.triggerMap || {}),
    combatScrolls: deepClone(source.combatScrolls || {}),
    guildBuffs: deepClone(source.guildBuffs || {}),
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function createBudgetOptimizerInput(playerConfig, simulationSettings, extras = {}) {
  const simulation = isPlainObject(simulationSettings) ? simulationSettings : {};
  const teammates = Array.isArray(extras?.teammates) ? extras.teammates : [];
  return {
    playerConfig: sanitizeConfigForSignature(playerConfig),
    teammates: teammates.map((teammate) => sanitizeConfigForSignature(teammate)),
    simulationSettings: {
      mode: String(simulation.mode || 'zone'),
      useDungeon: Boolean(simulation.useDungeon),
      zoneHrid: String(simulation.zoneHrid || ''),
      dungeonHrid: String(simulation.dungeonHrid || ''),
      difficultyTier: Math.max(0, Math.floor(toFiniteNumber(simulation.difficultyTier, 0))),
      simulationTimeHours: Math.max(
        1,
        Math.floor(toFiniteNumber(simulation.simulationTimeHours, BUDGET_OPTIMIZER_DEFAULT_SIMULATION_HOURS)),
      ),
    },
    settings: normalizeBudgetOptimizerSettings(extras?.settings),
    // 抵扣口径纳指纹（2026-10-09，用户决策）：baselineSaleSide 切换会改变候选净支出与
    // budgetHigh 剪枝，口径变化必须让旧报告过期一次（归一化后恒为 'bid'/'ask'，缺省 'bid'；
    // store 层 snapshotBudgetOptimizerInput 从 activeQueueState.settings 读取并传入）。
    saleSide: normalizeBaselineSaleSide(extras?.saleSide),
  };
}

export function createBudgetOptimizerInputSignature(input) {
  return stableStringify(input);
}

// ── 报告版本 ──────────────────────────────────────────────────────────
//
// v1（2026-10-04）：单步推荐报告（nextBest/plans/curve）。
// v2（2026-10-04）：升级链报告（steps/totalCost/stopReason；nextBest/plans/curve 移除）——
//   结构不兼容，storage 层版本闸门会把旧报告回落为空结果（不迁移）。

export const BUDGET_OPTIMIZER_REPORT_VERSION = 2;

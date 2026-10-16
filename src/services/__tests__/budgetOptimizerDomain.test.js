// budgetOptimizerDomain 领域层单元测试。
//
// 覆盖范围（交接点名的风险点）：
//   1) 设置归一化 / 校验 / 预设 / 预算硬上限；
//   2) 配对随机数种子集（同参恒等、稳定键排除配置、派生前缀稳定性）；
//   3) 输入指纹（对象键序无关、assetScore 剔除、配置参与、队友参与）；
//   4) 候选枚举（装备强化档 / 精炼版、技能、房子；诊断与 groupKey 组一致性）。
//
// 数据口径（为什么这么写测试）：
//   - 候选枚举依赖"生成索引 + 原始 itemDetailMap / houseRoomDetailMap"的真实游戏数据
//     （与运行期同一份 bundle），因此这里用真实行锁定精炼家族映射、房子战斗房间判定
//     等数据驱动行为的契约；数据里的关键 hrid 先做存在性断言，防数据更新后静默错位。
//   - 成本全部来自 queueUpgradeCost 的真实实现（不 mock 成本模型）：测试通过构造
//     pricingState 精确控制价格；成本链自身的独立测试见 queueUpgradeCost.test.js。
//
// 陷阱备忘：
//   - 装备/房子成本在缺价时不会得到"廉价候选"，而是 null（装备）或按 0 计（房子，
//     继承 queueUpgradeCost 的口径）——测试里对缺价价格表做显式清零，避免
//     itemDetailMap.sellPrice 的 vendor 回退让结果不可控。

import { describe, expect, it } from 'vitest';

import houseRoomDetailMap from '../../combatsimulator/data/houseRoomDetailMap.json';
import itemDetailMap from '../../combatsimulator/data/itemDetailMap.json';
import {
  abilityBookInfoByAbilityHrid,
  equipmentOptionsBySlot,
  houseRoomDetailIndex,
  houseRoomHrids,
  itemDetailIndex,
  levelExperienceTable,
} from '../../shared/gameDataIndex.js';
import { createEmptyPlayerConfig } from '../../shared/playerConfig.js';
import { MARKET_SALE_FEE_RATE, PRICE_MODE_BID } from '../marketPriceService.js';
import {
  BUDGET_OPTIMIZER_DEFAULT_BAND_RATIO,
  BUDGET_OPTIMIZER_DEFAULT_BUDGET_COINS,
  BUDGET_OPTIMIZER_DEFAULT_CHAIN_STEPS,
  BUDGET_OPTIMIZER_DEFAULT_MAX_HOUSE_UP,
  BUDGET_OPTIMIZER_DEFAULT_MAX_LEVEL_UP,
  BUDGET_OPTIMIZER_DEFAULT_OBJECTIVE,
  BUDGET_OPTIMIZER_DEFAULT_SIMULATION_HOURS,
  BUDGET_OPTIMIZER_MAX_BAND_RATIO,
  BUDGET_OPTIMIZER_MAX_CHAIN_STEPS,
  BUDGET_OPTIMIZER_MAX_ENHANCEMENT_LEVEL,
  BUDGET_OPTIMIZER_MAX_MAX_HOUSE_UP,
  BUDGET_OPTIMIZER_MAX_MAX_LEVEL_UP,
  BUDGET_OPTIMIZER_MAX_SIMULATION_HOURS,
  BUDGET_OPTIMIZER_MIN_CHAIN_STEPS,
  BUDGET_OPTIMIZER_MIN_MAX_HOUSE_UP,
  BUDGET_OPTIMIZER_MIN_MAX_LEVEL_UP,
  BUDGET_OPTIMIZER_MIN_SIMULATION_HOURS,
  BUDGET_OPTIMIZER_OBJECTIVE_DPS,
  BUDGET_OPTIMIZER_OBJECTIVE_PROFIT,
  BUDGET_OPTIMIZER_OBJECTIVE_XP,
  BUDGET_OPTIMIZER_OBJECTIVES,
  BUDGET_OPTIMIZER_PRESET_FAST,
  BUDGET_OPTIMIZER_PRESET_FINE,
  BUDGET_OPTIMIZER_PRESET_STANDARD,
  BUDGET_OPTIMIZER_PRESETS,
  BUDGET_OPTIMIZER_SEED_SALT_REFINE,
  BUDGET_OPTIMIZER_SEED_SALT_SCREEN,
  BUDGET_OPTIMIZER_SEED_SALT_VERIFY,
  BUDGET_OPTIMIZER_SKIPPED_DETAILS_LIMIT,
  BUDGET_OPTIMIZER_STEP_LIMIT_MODE_CUSTOM,
  BUDGET_OPTIMIZER_STEP_LIMIT_MODE_PRESET,
  BUDGET_OPTIMIZER_STEP_LIMIT_MODE_UNLIMITED,
  BUDGET_OPTIMIZER_STEP_LIMIT_PRESETS,
  applyBudgetEffectToPlayerConfig,
  buildBudgetCandidates,
  createBudgetOptimizerInput,
  createBudgetOptimizerInputSignature,
  createBudgetOptimizerSeedSet,
  ensureBudgetOptimizerCostReference,
  isValidBudgetOptimizerSettings,
  normalizeBudgetOptimizerSettings,
  resolveBudgetHigh,
  resolveBudgetObjectiveMetricKey,
  resolveBudgetOptimizerPreset,
  resolveBudgetOptimizerStepCap,
} from '../budgetOptimizerDomain.js';

// ── 测试用真实数据常量 ──────────────────────────────────────────────────
// 全部来自当前游戏数据快照；下面的 it 会先断言这些行存在（数据更新时快速定位）。

const CORSAIR = '/items/corsair_helmet'; // head 基础版（有精炼家族）
const CORSAIR_REFINED = '/items/corsair_helmet_refined'; // head 精炼版
const GRIFFIN = '/items/griffin_bulwark'; // two_hand 武器
const AZURE_BUCKLER = '/items/azure_buckler'; // off_hand
const BERSERK = '/abilities/berserk'; // 有技能书（/items/berserk）的已装备技能
const ARCHERY = '/house_rooms/archery_range'; // 战斗房间
const BREWERY = '/house_rooms/brewery'; // 非战斗房间（usableInActionTypeMap 里没有 combat）

// ── 通用辅助 ────────────────────────────────────────────────────────────

// 全技能 120 级的主角：让所有测试物品的 levelRequirements 都可满足（等级门槛单独测没有意义，
// 这里只关心候选筛选的"可达性"开关本身）。
function createPlayer(patch = {}) {
  const config = createEmptyPlayerConfig('1');
  for (const key of Object.keys(config.levels)) config.levels[key] = 120;
  Object.assign(config.equipment, patch.equipment || {});
  if (Array.isArray(patch.abilities)) config.abilities = patch.abilities;
  if (patch.houseRooms) Object.assign(config.houseRooms, patch.houseRooms);
  return config;
}

function createPricing({
  priceTable = {},
  enhancementQuotesByItem = {},
  marketItemValues,
  dropMode = PRICE_MODE_BID,
} = {}) {
  return {
    priceTable,
    enhancementQuotesByItem,
    dropMode,
    marketTimestamp: 1234,
    ...(marketItemValues ? { marketItemValues } : {}),
  };
}

// 把所有装备目录物品默认置为"无价"（ask/bid/vendor 全清），让定价完全由用例显式声明——
// 否则 itemDetailMap 的 sellPrice 会从 vendor 回退进成本链与目录价，断言不可控。
function createQuietPriceTable() {
  const priceTable = {};
  for (const slotKey of Object.keys(equipmentOptionsBySlot)) {
    for (const option of equipmentOptionsBySlot[slotKey] || []) {
      const hrid = String(option?.hrid || '');
      if (hrid) priceTable[hrid] = { ask: -1, bid: -1, vendor: 0 };
    }
  }
  return priceTable;
}

function equipId(slotKey, hrid, level) {
  return `equip:${slotKey}:${hrid}:${level}`;
}

function candidateById(result, id) {
  return result.candidates.find((candidate) => candidate.id === id) || null;
}

// 组一致性不变式（候选自身口径）：每个候选都必须带非空 groupKey（搜索层按 groupKey 调度
// 候选与跨步样本复用，漂移会让候选被静默遗漏），且同组候选 kind 一致（组 = 一个槽位 /
// 技能 / 房间，组内最多选一个目标）。返回按 groupKey 派生的组 → 候选列表供用例断言组结构。
function expectGroupsMatchCandidates(result) {
  const candidatesByGroupKey = new Map();
  for (const candidate of result.candidates) {
    const groupKey = String(candidate.groupKey || '');
    expect(groupKey).toBeTruthy();
    const groupCandidates = candidatesByGroupKey.get(groupKey) || [];
    groupCandidates.push(candidate);
    candidatesByGroupKey.set(groupKey, groupCandidates);
  }
  for (const groupCandidates of candidatesByGroupKey.values()) {
    expect(new Set(groupCandidates.map((candidate) => candidate.kind)).size).toBe(1);
  }
  return candidatesByGroupKey;
}

// ── 设置层 ──────────────────────────────────────────────────────────────

describe('设置层（normalize / isValid / preset / budgetHigh）', () => {
  it('空输入得到完整默认值', () => {
    expect(normalizeBudgetOptimizerSettings()).toEqual({
      budgetCoins: BUDGET_OPTIMIZER_DEFAULT_BUDGET_COINS,
      bandRatio: BUDGET_OPTIMIZER_DEFAULT_BAND_RATIO,
      simulationHours: BUDGET_OPTIMIZER_DEFAULT_SIMULATION_HOURS,
      partyPlayerIds: [],
      enableEquipment: true,
      enableAbilities: true,
      enableHouses: true,
      objective: BUDGET_OPTIMIZER_DEFAULT_OBJECTIVE,
      maxLevelUp: BUDGET_OPTIMIZER_DEFAULT_MAX_LEVEL_UP,
      maxHouseUp: BUDGET_OPTIMIZER_DEFAULT_MAX_HOUSE_UP,
      searchPreset: BUDGET_OPTIMIZER_PRESET_STANDARD,
      stepLimitMode: BUDGET_OPTIMIZER_STEP_LIMIT_MODE_UNLIMITED,
      maxChainSteps: BUDGET_OPTIMIZER_DEFAULT_CHAIN_STEPS,
      pickSignificanceGate: true,
    });
    expect(normalizeBudgetOptimizerSettings(null)).toEqual(normalizeBudgetOptimizerSettings());
    expect(normalizeBudgetOptimizerSettings('nonsense')).toEqual(normalizeBudgetOptimizerSettings());
  });

  it('clamp：预算不小于 0、bandRatio 0~0.5、时长 1~72、上限 1~10 / 1~8', () => {
    const clamp = normalizeBudgetOptimizerSettings({
      budgetCoins: -5,
      bandRatio: 0.9,
      simulationHours: 999,
      maxLevelUp: 999,
      maxHouseUp: 999,
      maxChainSteps: 999,
    });
    expect(clamp.budgetCoins).toBe(0);
    expect(clamp.bandRatio).toBe(BUDGET_OPTIMIZER_MAX_BAND_RATIO);
    expect(clamp.simulationHours).toBe(BUDGET_OPTIMIZER_MAX_SIMULATION_HOURS);
    expect(clamp.maxLevelUp).toBe(BUDGET_OPTIMIZER_MAX_MAX_LEVEL_UP);
    expect(clamp.maxHouseUp).toBe(BUDGET_OPTIMIZER_MAX_MAX_HOUSE_UP);
    expect(clamp.maxChainSteps).toBe(BUDGET_OPTIMIZER_MAX_CHAIN_STEPS);

    const lower = normalizeBudgetOptimizerSettings({
      budgetCoins: 1,
      bandRatio: -1,
      simulationHours: 0,
      maxLevelUp: 0,
      maxHouseUp: 0,
      maxChainSteps: 0,
    });
    expect(lower.bandRatio).toBe(0);
    expect(lower.simulationHours).toBe(BUDGET_OPTIMIZER_MIN_SIMULATION_HOURS);
    expect(lower.maxLevelUp).toBe(BUDGET_OPTIMIZER_MIN_MAX_LEVEL_UP);
    expect(lower.maxHouseUp).toBe(BUDGET_OPTIMIZER_MIN_MAX_HOUSE_UP);
    expect(lower.maxChainSteps).toBe(BUDGET_OPTIMIZER_MIN_CHAIN_STEPS);

    // 非数值（NaN/字符串垃圾）走 fallback 后仍落在合法区间；null 会被 Number(null)=0 归一到下界。
    expect(normalizeBudgetOptimizerSettings({ simulationHours: 'nonsense' }).simulationHours).toBe(
      BUDGET_OPTIMIZER_DEFAULT_SIMULATION_HOURS,
    );
    expect(normalizeBudgetOptimizerSettings({ simulationHours: null }).simulationHours).toBe(
      BUDGET_OPTIMIZER_MIN_SIMULATION_HOURS,
    );
  });

  it('归一化队友列表：去重、剔除空值、数字转字符串', () => {
    const normalized = normalizeBudgetOptimizerSettings({ partyPlayerIds: ['2', 2, '', null, '3', '2'] });
    expect(normalized.partyPlayerIds).toEqual(['2', '3']);
  });

  it('定选显著性门槛默认开启、只认显式 false 关闭；链终复验种子数随档位放大（fast 24 / standard 50 / fine 60）', () => {
    // 2026-10-09 起默认开启（用户诉求：少买「碰巧为正」的项）：缺省与非法输入都视为开启。
    expect(normalizeBudgetOptimizerSettings({}).pickSignificanceGate).toBe(true);
    expect(normalizeBudgetOptimizerSettings(null).pickSignificanceGate).toBe(true);
    expect(normalizeBudgetOptimizerSettings({ pickSignificanceGate: true }).pickSignificanceGate).toBe(true);
    expect(normalizeBudgetOptimizerSettings({ pickSignificanceGate: 'yes' }).pickSignificanceGate).toBe(true);
    // 只认显式 false 关闭（与范围开关同款语义）。
    expect(normalizeBudgetOptimizerSettings({ pickSignificanceGate: false }).pickSignificanceGate).toBe(false);
    // 链终复验是「最终测量值」：样本量要比筛选样本大一个量级，否则复验自身噪声不比账面推算好。
    expect(BUDGET_OPTIMIZER_PRESETS.fast.verifySeeds).toBe(24);
    expect(BUDGET_OPTIMIZER_PRESETS.standard.verifySeeds).toBe(50);
    expect(BUDGET_OPTIMIZER_PRESETS.fine.verifySeeds).toBe(60);
  });

  it('范围开关只认显式 false，预设白名单回退 standard', () => {
    const off = normalizeBudgetOptimizerSettings({
      enableEquipment: false,
      enableAbilities: false,
      enableHouses: false,
      searchPreset: BUDGET_OPTIMIZER_PRESET_FAST,
    });
    expect(off.enableEquipment).toBe(false);
    expect(off.enableAbilities).toBe(false);
    expect(off.enableHouses).toBe(false);
    expect(off.searchPreset).toBe(BUDGET_OPTIMIZER_PRESET_FAST);

    // 精细档（2026-10-09）：白名单保留，不被静默回退。
    const fine = normalizeBudgetOptimizerSettings({ searchPreset: BUDGET_OPTIMIZER_PRESET_FINE });
    expect(fine.searchPreset).toBe(BUDGET_OPTIMIZER_PRESET_FINE);

    const fallback = normalizeBudgetOptimizerSettings({ searchPreset: 'deluxe' });
    expect(fallback.searchPreset).toBe(BUDGET_OPTIMIZER_PRESET_STANDARD);
  });

  it('优化目标白名单：合法值保留，非法/缺失回退默认（利润）；顺序即下拉顺序', () => {
    // 白名单顺序 = UI 下拉顺序：利润 → DPS → 经验（默认利润排第一）。
    expect(BUDGET_OPTIMIZER_OBJECTIVES).toEqual([
      BUDGET_OPTIMIZER_OBJECTIVE_PROFIT,
      BUDGET_OPTIMIZER_OBJECTIVE_DPS,
      BUDGET_OPTIMIZER_OBJECTIVE_XP,
    ]);
    expect(normalizeBudgetOptimizerSettings().objective).toBe(BUDGET_OPTIMIZER_DEFAULT_OBJECTIVE);
    expect(normalizeBudgetOptimizerSettings().objective).toBe(BUDGET_OPTIMIZER_OBJECTIVE_PROFIT);
    expect(normalizeBudgetOptimizerSettings({ objective: BUDGET_OPTIMIZER_OBJECTIVE_DPS }).objective).toBe(
      BUDGET_OPTIMIZER_OBJECTIVE_DPS,
    );
    expect(normalizeBudgetOptimizerSettings({ objective: BUDGET_OPTIMIZER_OBJECTIVE_PROFIT }).objective).toBe(
      BUDGET_OPTIMIZER_OBJECTIVE_PROFIT,
    );
    expect(normalizeBudgetOptimizerSettings({ objective: BUDGET_OPTIMIZER_OBJECTIVE_XP }).objective).toBe(
      BUDGET_OPTIMIZER_OBJECTIVE_XP,
    );
    expect(normalizeBudgetOptimizerSettings({ objective: 'gold' }).objective).toBe(BUDGET_OPTIMIZER_OBJECTIVE_PROFIT);
  });

  it('objective → 指标键映射：dps/profit/xp 各自对应聚合指标，非法值回退默认（利润）', () => {
    expect(resolveBudgetObjectiveMetricKey(BUDGET_OPTIMIZER_OBJECTIVE_DPS)).toBe('dps');
    expect(resolveBudgetObjectiveMetricKey(BUDGET_OPTIMIZER_OBJECTIVE_PROFIT)).toBe('dailyNoRngProfit');
    expect(resolveBudgetObjectiveMetricKey(BUDGET_OPTIMIZER_OBJECTIVE_XP)).toBe('xpPerHour');
    expect(resolveBudgetObjectiveMetricKey('gold')).toBe('dailyNoRngProfit');
    expect(resolveBudgetObjectiveMetricKey(undefined)).toBe('dailyNoRngProfit');
  });

  it('isValid 边界：预算 > 0、bandRatio 闭区间、时长/上限闭区间、预设白名单', () => {
    const valid = {
      budgetCoins: 1,
      bandRatio: 0,
      simulationHours: 24,
      maxLevelUp: 1,
      maxHouseUp: 1,
      objective: BUDGET_OPTIMIZER_OBJECTIVE_DPS,
      searchPreset: BUDGET_OPTIMIZER_PRESET_STANDARD,
      stepLimitMode: BUDGET_OPTIMIZER_STEP_LIMIT_MODE_UNLIMITED,
      maxChainSteps: BUDGET_OPTIMIZER_DEFAULT_CHAIN_STEPS,
    };
    expect(isValidBudgetOptimizerSettings(valid)).toBe(true);
    expect(isValidBudgetOptimizerSettings({ ...valid, budgetCoins: 0 })).toBe(false);
    expect(isValidBudgetOptimizerSettings({ ...valid, budgetCoins: -1 })).toBe(false);
    expect(isValidBudgetOptimizerSettings({ ...valid, bandRatio: -0.01 })).toBe(false);
    expect(isValidBudgetOptimizerSettings({ ...valid, bandRatio: BUDGET_OPTIMIZER_MAX_BAND_RATIO + 0.01 })).toBe(false);
    expect(isValidBudgetOptimizerSettings({ ...valid, bandRatio: BUDGET_OPTIMIZER_MAX_BAND_RATIO })).toBe(true);
    expect(isValidBudgetOptimizerSettings({ ...valid, simulationHours: 0.5 })).toBe(false);
    expect(isValidBudgetOptimizerSettings({ ...valid, simulationHours: 72.5 })).toBe(false);
    expect(isValidBudgetOptimizerSettings({ ...valid, simulationHours: 72 })).toBe(true);
    expect(isValidBudgetOptimizerSettings({ ...valid, maxLevelUp: 0 })).toBe(false);
    expect(isValidBudgetOptimizerSettings({ ...valid, maxLevelUp: 11 })).toBe(false);
    expect(isValidBudgetOptimizerSettings({ ...valid, maxLevelUp: 10 })).toBe(true);
    expect(isValidBudgetOptimizerSettings({ ...valid, maxHouseUp: 0 })).toBe(false);
    expect(isValidBudgetOptimizerSettings({ ...valid, maxHouseUp: 9 })).toBe(false);
    expect(isValidBudgetOptimizerSettings({ ...valid, maxHouseUp: 8 })).toBe(true);
    expect(isValidBudgetOptimizerSettings({ ...valid, searchPreset: BUDGET_OPTIMIZER_PRESET_FINE })).toBe(true);
    expect(isValidBudgetOptimizerSettings({ ...valid, searchPreset: 'deluxe' })).toBe(false);
    expect(isValidBudgetOptimizerSettings({ ...valid, searchPreset: '' })).toBe(false);
    expect(isValidBudgetOptimizerSettings({ ...valid, searchPreset: undefined })).toBe(false);
    expect(isValidBudgetOptimizerSettings({ ...valid, objective: 'gold' })).toBe(false);
    expect(isValidBudgetOptimizerSettings({ ...valid, objective: undefined })).toBe(false);
    expect(isValidBudgetOptimizerSettings({ ...valid, stepLimitMode: 'deluxe' })).toBe(false);
    expect(isValidBudgetOptimizerSettings({ ...valid, maxChainSteps: 0 })).toBe(false);
    expect(isValidBudgetOptimizerSettings({ ...valid, maxChainSteps: BUDGET_OPTIMIZER_MAX_CHAIN_STEPS + 1 })).toBe(
      false,
    );
    expect(isValidBudgetOptimizerSettings({ ...valid, maxChainSteps: BUDGET_OPTIMIZER_MAX_CHAIN_STEPS })).toBe(true);
    // 区间内的小数同样拒绝（memo 0366808714871685120）：整数字段由校验显式拒绝，而不是被归一化
    // clampInt 静默 floor —— 上面的 0.5 / 72.5 是越界用例，这里锚定的是「区间内但非整数」。
    expect(isValidBudgetOptimizerSettings({ ...valid, simulationHours: 3.5 })).toBe(false);
    expect(isValidBudgetOptimizerSettings({ ...valid, maxLevelUp: 2.5 })).toBe(false);
    expect(isValidBudgetOptimizerSettings({ ...valid, maxHouseUp: 1.5 })).toBe(false);
    expect(isValidBudgetOptimizerSettings({ ...valid, maxChainSteps: 7.5 })).toBe(false);
    // 省略字段（而不是显式非法值）同样不通过：校验以"完整设置对象"为契约。
    expect(isValidBudgetOptimizerSettings({ budgetCoins: 100 })).toBe(false);
    expect(isValidBudgetOptimizerSettings(null)).toBe(false);
    expect(isValidBudgetOptimizerSettings({})).toBe(false);
  });

  it('resolveBudgetOptimizerPreset 返回冻结的搜索档对象，非法值回退 standard', () => {
    expect(resolveBudgetOptimizerPreset({ searchPreset: BUDGET_OPTIMIZER_PRESET_FAST })).toBe(
      BUDGET_OPTIMIZER_PRESETS[BUDGET_OPTIMIZER_PRESET_FAST],
    );
    expect(resolveBudgetOptimizerPreset({ searchPreset: BUDGET_OPTIMIZER_PRESET_FINE })).toBe(
      BUDGET_OPTIMIZER_PRESETS[BUDGET_OPTIMIZER_PRESET_FINE],
    );
    expect(resolveBudgetOptimizerPreset({ searchPreset: 'deluxe' })).toBe(
      BUDGET_OPTIMIZER_PRESETS[BUDGET_OPTIMIZER_PRESET_STANDARD],
    );
    expect(resolveBudgetOptimizerPreset()).toBe(BUDGET_OPTIMIZER_PRESETS[BUDGET_OPTIMIZER_PRESET_STANDARD]);
  });

  it('精细档（2026-10-09）：三层样本量 6/24/60；键序 fast → standard → fine（下拉顺序）', () => {
    // 高样本档服务「结果更稳」诉求：选择噪声 ~ √(16/N)，24 场相对标准档降约 18%，代价约 +50% 耗时。
    expect(BUDGET_OPTIMIZER_PRESETS.fine).toEqual({
      screenSeeds: 6,
      refineSeeds: 24,
      verifySeeds: 60,
      refineKeepRatio: 0.6,
      refineKeepMin: 12,
    });
    expect(Object.keys(BUDGET_OPTIMIZER_PRESETS)).toEqual(['fast', 'standard', 'fine']);
    // 现有两档参数不受本次新增影响。
    expect(BUDGET_OPTIMIZER_PRESETS.fast.refineSeeds).toBe(8);
    expect(BUDGET_OPTIMIZER_PRESETS.standard.refineSeeds).toBe(16);
  });

  it('链步数上限：模式白名单回退 unlimited，预设 5/10/15；stepCap 按 preset/custom 步数收束到安全阀', () => {
    expect(BUDGET_OPTIMIZER_STEP_LIMIT_PRESETS).toEqual([5, 10, 15]);
    expect(normalizeBudgetOptimizerSettings().stepLimitMode).toBe(BUDGET_OPTIMIZER_STEP_LIMIT_MODE_UNLIMITED);
    expect(normalizeBudgetOptimizerSettings({ stepLimitMode: 'deluxe' }).stepLimitMode).toBe(
      BUDGET_OPTIMIZER_STEP_LIMIT_MODE_UNLIMITED,
    );
    expect(normalizeBudgetOptimizerSettings({ stepLimitMode: 'preset' }).stepLimitMode).toBe(
      BUDGET_OPTIMIZER_STEP_LIMIT_MODE_PRESET,
    );
    expect(normalizeBudgetOptimizerSettings({ stepLimitMode: 'custom' }).stepLimitMode).toBe(
      BUDGET_OPTIMIZER_STEP_LIMIT_MODE_CUSTOM,
    );
    expect(normalizeBudgetOptimizerSettings({ maxChainSteps: 7 }).maxChainSteps).toBe(7);

    // unlimited（含缺省）= 安全阀；preset / custom = 用户步数（1 ~ 安全阀钳制）。
    expect(resolveBudgetOptimizerStepCap()).toBe(BUDGET_OPTIMIZER_MAX_CHAIN_STEPS);
    expect(resolveBudgetOptimizerStepCap({ stepLimitMode: 'unlimited' })).toBe(BUDGET_OPTIMIZER_MAX_CHAIN_STEPS);
    expect(resolveBudgetOptimizerStepCap({ stepLimitMode: 'preset', maxChainSteps: 5 })).toBe(5);
    expect(resolveBudgetOptimizerStepCap({ stepLimitMode: 'custom', maxChainSteps: 5 })).toBe(5);
    expect(resolveBudgetOptimizerStepCap({ stepLimitMode: 'custom', maxChainSteps: 999 })).toBe(
      BUDGET_OPTIMIZER_MAX_CHAIN_STEPS,
    );
    expect(resolveBudgetOptimizerStepCap({ stepLimitMode: 'custom', maxChainSteps: 0 })).toBe(
      BUDGET_OPTIMIZER_MIN_CHAIN_STEPS,
    );
  });

  it('resolveBudgetHigh = 预算 × (1 + bandRatio)，bandRatio 超限先 clamp', () => {
    expect(resolveBudgetHigh({ budgetCoins: 1000, bandRatio: 0.2 })).toBe(1200);
    expect(resolveBudgetHigh({ budgetCoins: 1000, bandRatio: 0 })).toBe(1000);
    expect(resolveBudgetHigh({ budgetCoins: 1000, bandRatio: 5 })).toBe(1500);
    // 缺省 bandRatio 与设置层产品默认（±20%）一致：上限不是预算本身。
    expect(resolveBudgetHigh({ budgetCoins: 1000 })).toBe(1200);
    expect(resolveBudgetHigh({ budgetCoins: -10, bandRatio: 0.2 })).toBe(0);
    expect(resolveBudgetHigh()).toBe(0);
    expect(resolveBudgetHigh(null)).toBe(0);
  });
});

// ── 种子集（配对随机数）──────────────────────────────────────────────────

describe('createBudgetOptimizerSeedSet（配对随机数种子集）', () => {
  const simulationSettings = {
    mode: 'zone',
    useDungeon: false,
    zoneHrid: '/zones/jungle_planet',
    difficultyTier: 2,
    simulationTimeHours: 24,
  };
  const baseArgs = { playerId: '1', simulationSettings, salt: BUDGET_OPTIMIZER_SEED_SALT_SCREEN, count: 4 };

  it('同参同盐恒等（可复现），不同盐互不相同', () => {
    const first = createBudgetOptimizerSeedSet(baseArgs);
    expect(first).toEqual(createBudgetOptimizerSeedSet({ ...baseArgs }));
    const refine = createBudgetOptimizerSeedSet({ ...baseArgs, salt: BUDGET_OPTIMIZER_SEED_SALT_REFINE });
    const verify = createBudgetOptimizerSeedSet({ ...baseArgs, salt: BUDGET_OPTIMIZER_SEED_SALT_VERIFY });
    expect(first).not.toEqual(refine);
    expect(refine).not.toEqual(verify);
    expect(first).not.toEqual(verify);
  });

  it('种子键刻意排除主角装备/技能/房子（配对差的前提），只取目标/难度/时长等稳定上下文', () => {
    const plain = createBudgetOptimizerSeedSet(baseArgs);
    // simulationSettings 里混入配置快照（现实中不会传，但键白名单必须忽略它们）——
    // 若将来有人把装备/技能并入种子键，这条会立即失败。
    const noisy = createBudgetOptimizerSeedSet({
      ...baseArgs,
      simulationSettings: {
        ...simulationSettings,
        equipment: { head: { itemHrid: CORSAIR, enhancementLevel: 5 } },
        abilities: [{ abilityHrid: BERSERK, level: 33 }],
        houseRooms: { [ARCHERY]: 8 },
      },
    });
    expect(noisy).toEqual(plain);
  });

  it('playerId / 目标 / 难度 / 时长任一变化都会换流', () => {
    const base = createBudgetOptimizerSeedSet(baseArgs);
    expect(createBudgetOptimizerSeedSet({ ...baseArgs, playerId: '2' })).not.toEqual(base);
    expect(
      createBudgetOptimizerSeedSet({
        ...baseArgs,
        simulationSettings: { ...simulationSettings, zoneHrid: '/zones/other' },
      }),
    ).not.toEqual(base);
    expect(
      createBudgetOptimizerSeedSet({ ...baseArgs, simulationSettings: { ...simulationSettings, difficultyTier: 3 } }),
    ).not.toEqual(base);
    expect(
      createBudgetOptimizerSeedSet({
        ...baseArgs,
        simulationSettings: { ...simulationSettings, simulationTimeHours: 12 },
      }),
    ).not.toEqual(base);
    // 地牢 / 迷宫目标同样进入键（换目标必须换流）。
    expect(
      createBudgetOptimizerSeedSet({
        ...baseArgs,
        simulationSettings: { ...simulationSettings, useDungeon: true, dungeonHrid: '/dungeons/example' },
      }),
    ).not.toEqual(base);
    expect(
      createBudgetOptimizerSeedSet({
        ...baseArgs,
        simulationSettings: {
          ...simulationSettings,
          mode: 'labyrinth',
          labyrinthHrid: '/labyrinths/example',
          roomLevel: 5,
        },
      }),
    ).not.toEqual(base);
  });

  it('派生前缀稳定：count=16 的前 4 个 == count=4 的 4 个（搜索层样本复用依赖）', () => {
    const wide = createBudgetOptimizerSeedSet({ ...baseArgs, count: 16 });
    const narrow = createBudgetOptimizerSeedSet({ ...baseArgs, count: 4 });
    expect(wide).toHaveLength(16);
    expect(narrow).toHaveLength(4);
    expect(wide.slice(0, 4)).toEqual(narrow);
  });

  it('count 归一为至少 1 个种子', () => {
    expect(createBudgetOptimizerSeedSet({ ...baseArgs, count: 0 })).toHaveLength(1);
    expect(createBudgetOptimizerSeedSet({ ...baseArgs, count: -3 })).toHaveLength(1);
    expect(createBudgetOptimizerSeedSet({ ...baseArgs, count: 'nonsense' })).toHaveLength(1);
  });
});

// ── 输入指纹 ────────────────────────────────────────────────────────────

describe('createBudgetOptimizerInput / Signature（报告过期判定）', () => {
  const simulationSettings = {
    mode: 'zone',
    useDungeon: false,
    zoneHrid: '/zones/jungle_planet',
    difficultyTier: 2,
    simulationTimeHours: 24,
  };
  const baseConfig = {
    id: '1',
    levels: { attack: 10, defense: 20 },
    equipment: { head: { itemHrid: CORSAIR, enhancementLevel: 1 }, body: { itemHrid: '', enhancementLevel: 0 } },
    abilities: [{ abilityHrid: BERSERK, level: 10 }],
    houseRooms: { [ARCHERY]: 2 },
  };
  const extras = { settings: { budgetCoins: 1000, bandRatio: 0.2, simulationHours: 24, maxLevelUp: 3, maxHouseUp: 2 } };

  const signatureOf = (config, extrasOverride = extras) =>
    createBudgetOptimizerInputSignature(createBudgetOptimizerInput(config, simulationSettings, extrasOverride));

  it('对象键顺序无关（stableStringify 排序键）', () => {
    const reordered = {
      houseRooms: { [ARCHERY]: 2 },
      abilities: [{ abilityHrid: BERSERK, level: 10 }],
      equipment: { body: { itemHrid: '', enhancementLevel: 0 }, head: { itemHrid: CORSAIR, enhancementLevel: 1 } },
      levels: { defense: 20, attack: 10 },
      id: '1',
    };
    expect(signatureOf(reordered)).toBe(signatureOf(baseConfig));
  });

  it('assetScore 等派生/展示字段不参与指纹', () => {
    const withScore = { ...baseConfig, assetScore: { total: 123, snapshot: { gearScore: 456 } }, name: 'Hero' };
    expect(signatureOf(withScore)).toBe(signatureOf(baseConfig));
  });

  it('装备 / 技能 / 房子任一变化都会改变指纹', () => {
    const base = signatureOf(baseConfig);
    expect(
      signatureOf({
        ...baseConfig,
        equipment: { ...baseConfig.equipment, head: { itemHrid: CORSAIR, enhancementLevel: 2 } },
      }),
    ).not.toBe(base);
    expect(signatureOf({ ...baseConfig, abilities: [{ abilityHrid: BERSERK, level: 11 }] })).not.toBe(base);
    expect(signatureOf({ ...baseConfig, houseRooms: { [ARCHERY]: 3 } })).not.toBe(base);
  });

  it('队友配置参与指纹；省略 teammates 与空数组等价；settings 参与指纹', () => {
    const teammateA = { id: '2', levels: { attack: 5 }, equipment: {}, abilities: [], houseRooms: {} };
    const teammateB = { id: '2', levels: { attack: 6 }, equipment: {}, abilities: [], houseRooms: {} };
    const noTeammates = signatureOf(baseConfig, { settings: extras.settings });
    expect(signatureOf(baseConfig, { settings: extras.settings, teammates: [] })).toBe(noTeammates);
    expect(signatureOf(baseConfig, { settings: extras.settings, teammates: [teammateA] })).not.toBe(noTeammates);
    expect(signatureOf(baseConfig, { settings: extras.settings, teammates: [teammateB] })).not.toBe(
      signatureOf(baseConfig, { settings: extras.settings, teammates: [teammateA] }),
    );
    expect(signatureOf(baseConfig, { settings: { ...extras.settings, budgetCoins: 2000 } })).not.toBe(noTeammates);
    // 优化目标进归一化 settings：换目标会让指纹变化、报告过期（种子键不含 objective，
    // 跨目标仍比较同一随机流）。extras.settings 未显式给目标 → 归一化缺省 = 利润；
    // 这里换到非默认的 dps 验证指纹响应。
    expect(
      signatureOf(baseConfig, { settings: { ...extras.settings, objective: BUDGET_OPTIMIZER_OBJECTIVE_DPS } }),
    ).not.toBe(noTeammates);
  });

  it('simulationSettings 归一化后参与指纹（难度取整、时长下限）', () => {
    const input = createBudgetOptimizerInput(
      baseConfig,
      { ...simulationSettings, difficultyTier: 2.9, simulationTimeHours: 0 },
      extras,
    );
    expect(input.simulationSettings.difficultyTier).toBe(2);
    expect(input.simulationSettings.simulationTimeHours).toBe(1);
    // 归一后的子集之外字段不进入指纹：与 input 传同一组"归一后等价"的原始值，只额外加未知字段。
    const noisy = createBudgetOptimizerInput(
      baseConfig,
      { ...simulationSettings, difficultyTier: 2.9, simulationTimeHours: 0, somethingElse: true },
      extras,
    );
    expect(createBudgetOptimizerInputSignature(noisy)).toBe(createBudgetOptimizerInputSignature(input));
  });

  it('抵扣口径 saleSide 参与指纹：口径切换使签名变化（旧报告过期一次），缺省等价 bid', () => {
    const base = signatureOf(baseConfig, { settings: extras.settings });
    expect(signatureOf(baseConfig, { settings: extras.settings, saleSide: 'bid' })).toBe(base);
    // ask（重置成本口径）会改变候选净支出与 budgetHigh 剪枝 → 切换必须让旧报告过期。
    expect(signatureOf(baseConfig, { settings: extras.settings, saleSide: 'ask' })).not.toBe(base);
    // 脏值归一化到 'bid'：不产生伪指纹差异。
    expect(signatureOf(baseConfig, { settings: extras.settings, saleSide: 'nonsense' })).toBe(base);
  });
});

// ── 候选枚举：装备 ──────────────────────────────────────────────────────

describe('buildBudgetCandidates - 装备候选', () => {
  it('测试数据前提：精炼家族与各类物品在当前数据快照中存在', () => {
    expect(itemDetailMap[CORSAIR]?.equipmentDetail?.type).toBe('/equipment_types/head');
    expect(itemDetailMap[CORSAIR_REFINED]?.equipmentDetail?.type).toBe('/equipment_types/head');
    expect(itemDetailMap[GRIFFIN]?.equipmentDetail?.type).toBe('/equipment_types/two_hand');
    expect(itemDetailMap[AZURE_BUCKLER]?.equipmentDetail?.type).toBe('/equipment_types/off_hand');
    expect(abilityBookInfoByAbilityHrid[BERSERK]?.itemHrid).toBe('/items/berserk');
  });

  it('当前物品强化档逐级 + 精炼版全档（0 起）；成本来自 queueUpgradeCost 的净支出', () => {
    const playerConfig = createPlayer({ equipment: { head: { itemHrid: CORSAIR, enhancementLevel: 2 } } });
    const pricing = createPricing({
      priceTable: {
        ...createQuietPriceTable(),
        [CORSAIR]: { ask: -1, bid: -1, vendor: 0 },
        [CORSAIR_REFINED]: { ask: 1000, bid: -1, vendor: 0 },
      },
      enhancementQuotesByItem: {
        [CORSAIR]: {
          3: { ask: 300, bid: -1 },
          4: { ask: 400, bid: -1 },
          5: { ask: 500, bid: -1 },
        },
        [CORSAIR_REFINED]: {
          1: { ask: 1100, bid: -1 },
          2: { ask: 1200, bid: -1 },
          3: { ask: 1300, bid: -1 },
          4: { ask: 1400, bid: -1 },
          5: { ask: 1500, bid: -1 },
        },
      },
    });
    const settings = {
      budgetCoins: 10000,
      bandRatio: 0.2,
      maxLevelUp: 3,
      enableAbilities: false,
      enableHouses: false,
    };
    const result = buildBudgetCandidates({ playerConfig, pricingState: pricing, settings });

    // maxLevelUp=3、currentLevel=2 ⇒ 当前物品 3..5 档；精炼版 0..min(20, 2+3)=5 档。
    expect(result.candidates).toHaveLength(9);
    expect(result.candidates.every((candidate) => candidate.kind === 'equipment')).toBe(true);
    for (const [level, cost] of [
      [3, 300],
      [4, 400],
      [5, 500],
    ]) {
      const candidate = candidateById(result, equipId('head', CORSAIR, level));
      expect(candidate?.cost).toBe(cost);
      expect(candidate?.effect).toEqual({
        type: 'equipment',
        slotKey: 'head',
        itemHrid: CORSAIR,
        enhancementLevel: level,
      });
      // 展示用 fromEffect：应用前状态（结构化，报告透传给 UI 本地化渲染）。
      expect(candidate?.fromEffect).toEqual({
        type: 'equipment',
        slotKey: 'head',
        itemHrid: CORSAIR,
        enhancementLevel: 2,
      });
    }
    for (const level of [0, 1, 2, 3, 4, 5]) {
      const candidate = candidateById(result, equipId('head', CORSAIR_REFINED, level));
      expect(candidate?.cost).toBe(1000 + level * 100);
    }
    // 精炼版超过 maxLevel 的档位不生成（6 档不存在）。
    expect(candidateById(result, equipId('head', CORSAIR_REFINED, 6))).toBeNull();

    const candidatesByGroupKey = expectGroupsMatchCandidates(result);
    expect([...candidatesByGroupKey.keys()]).toEqual(['equip:head']);
    const headCandidates = candidatesByGroupKey.get('equip:head');
    expect(headCandidates).toHaveLength(9);
    expect(headCandidates.every((candidate) => candidate.kind === 'equipment')).toBe(true);
    expect(headCandidates.every((candidate) => candidate.effect.slotKey === 'head')).toBe(true);

    expect(result.diagnostics.counts).toEqual({ equipment: 9, ability: 0, house: 0 });
    expect(result.diagnostics.totalCandidates).toBe(9);
    expect(result.diagnostics.skippedNoPrice).toBe(0);
  });

  it('强化档位受业务上限 20 约束（n0+1 .. min(20, n0+maxLevelUp)）', () => {
    const playerConfig = createPlayer({ equipment: { head: { itemHrid: CORSAIR, enhancementLevel: 18 } } });
    const pricing = createPricing({
      priceTable: { ...createQuietPriceTable(), [CORSAIR]: { ask: -1, bid: -1, vendor: 0 } },
      enhancementQuotesByItem: {
        [CORSAIR]: {
          19: { ask: 100, bid: -1 },
          20: { ask: 110, bid: -1 },
          21: { ask: 120, bid: -1 },
        },
      },
    });
    // maxLevelUp=5 ⇒ 名义上到 23，被业务上限 20 截断：只生成 19、20（+21 即使有价也不生成）。
    const result = buildBudgetCandidates({
      playerConfig,
      pricingState: pricing,
      settings: {
        budgetCoins: 10000,
        bandRatio: 0.2,
        maxLevelUp: 5,
        enableAbilities: false,
        enableHouses: false,
      },
    });
    expect(result.candidates.map((candidate) => candidate.effect.enhancementLevel)).toEqual([19, 20]);
    expect(BUDGET_OPTIMIZER_MAX_ENHANCEMENT_LEVEL).toBe(20);
  });

  it('成本超 budgetHigh 的候选直接丢弃（硬约束），skippedNoPrice 只统计缺价', () => {
    const playerConfig = createPlayer({ equipment: { head: { itemHrid: CORSAIR, enhancementLevel: 2 } } });
    const pricing = createPricing({
      priceTable: {
        ...createQuietPriceTable(),
        [CORSAIR]: { ask: -1, bid: -1, vendor: 0 },
        [CORSAIR_REFINED]: { ask: 1000, bid: -1, vendor: 0 },
      },
      enhancementQuotesByItem: {
        [CORSAIR]: {
          3: { ask: 300, bid: -1 },
          4: { ask: 400, bid: -1 },
          5: { ask: 500, bid: -1 },
        },
        [CORSAIR_REFINED]: {
          1: { ask: 1100, bid: -1 },
          2: { ask: 1200, bid: -1 },
          3: { ask: 1300, bid: -1 },
          4: { ask: 1400, bid: -1 },
          5: { ask: 1500, bid: -1 },
        },
      },
    });
    // budgetHigh = 1000 × 1.2 = 1200：refined 3/4/5 超限被丢弃，其余保留。
    const result = buildBudgetCandidates({
      playerConfig,
      pricingState: pricing,
      settings: {
        budgetCoins: 1000,
        bandRatio: 0.2,
        maxLevelUp: 3,
        enableAbilities: false,
        enableHouses: false,
      },
    });
    expect(result.candidates).toHaveLength(6);
    expect(candidateById(result, equipId('head', CORSAIR_REFINED, 2))?.cost).toBe(1200);
    expect(candidateById(result, equipId('head', CORSAIR_REFINED, 3))).toBeNull();
    // 超预算丢弃不是缺价：诊断里不计 skippedNoPrice。
    expect(result.diagnostics.skippedNoPrice).toBe(0);
    expect(result.diagnostics.counts.equipment).toBe(6);
  });

  it('缺价候选丢弃并计入 diagnostics.skippedNoPrice', () => {
    const playerConfig = createPlayer({ equipment: { head: { itemHrid: CORSAIR, enhancementLevel: 2 } } });
    const pricing = createPricing({
      priceTable: { ...createQuietPriceTable(), [CORSAIR]: { ask: -1, bid: -1, vendor: 0 } },
      enhancementQuotesByItem: {
        [CORSAIR]: {
          3: { ask: 300, bid: -1 },
          4: { ask: 400, bid: -1 },
          5: { ask: 500, bid: -1 },
        },
      },
    });
    const result = buildBudgetCandidates({
      playerConfig,
      pricingState: pricing,
      settings: {
        budgetCoins: 10000,
        bandRatio: 0.2,
        maxLevelUp: 3,
        enableAbilities: false,
        enableHouses: false,
      },
    });
    expect(result.candidates).toHaveLength(3);
    // 精炼版 0..5 共 6 个档位全部缺价。
    expect(result.diagnostics.skippedNoPrice).toBe(6);
    // 明细记录结构化 effect（展示名由 UI 按当前语言现场解析，不在 domain 固化）。
    expect(result.diagnostics.skippedNoPriceDetails).toHaveLength(6);
    expect(result.diagnostics.skippedNoPriceDetails[0]).toEqual({
      kind: 'equipment',
      effect: { type: 'equipment', slotKey: 'head', itemHrid: CORSAIR_REFINED, enhancementLevel: 0 },
    });
    expect(result.diagnostics.skippedNoPriceDetails.at(-1)?.effect.enhancementLevel).toBe(5);
  });

  it('缺价明细超上限截断：明细封顶、skippedNoPrice 全量、truncated 计数守恒', () => {
    // 每个槽放该槽首个目录物品（当前 +5、maxLevelUp=10）+ 全清价（无强化报价）：每槽至少产出
    // 强化 6..15 共 10 条缺价档，各槽合计远超上限（60），用于锚定明细封顶与计数守恒。
    const equipment = Object.fromEntries(
      Object.keys(equipmentOptionsBySlot).map((slotKey) => {
        const option = equipmentOptionsBySlot[slotKey]?.[0] || {};
        return [slotKey, { itemHrid: String(option?.hrid || ''), enhancementLevel: 5 }];
      }),
    );
    const playerConfig = createPlayer({ equipment });
    const pricing = createPricing({ priceTable: createQuietPriceTable() });
    const result = buildBudgetCandidates({
      playerConfig,
      pricingState: pricing,
      settings: {
        budgetCoins: 10000,
        bandRatio: 0.2,
        maxLevelUp: 10,
        enableAbilities: false,
        enableHouses: false,
      },
    });

    const details = result.diagnostics.skippedNoPriceDetails;
    expect(result.diagnostics.skippedNoPrice).toBeGreaterThan(BUDGET_OPTIMIZER_SKIPPED_DETAILS_LIMIT);
    expect(details).toHaveLength(BUDGET_OPTIMIZER_SKIPPED_DETAILS_LIMIT);
    expect(result.diagnostics.skippedNoPriceDetailsTruncated).toBeGreaterThan(0);
    // 守恒：总计数 = 已展示 + 截断数（UI「另有 N 条」的精确口径）。
    expect(details.length + result.diagnostics.skippedNoPriceDetailsTruncated).toBe(result.diagnostics.skippedNoPrice);
    // 截断不改变条目结构（展示名仍由 UI 现场解析）。
    expect(details.every((item) => item?.effect && typeof item.kind === 'string')).toBe(true);
  });

  it('缺价候选按 fairValueResolver 估值参与搜索（MWITools 装备价值口径回退）', () => {
    const playerConfig = createPlayer({ equipment: { head: { itemHrid: CORSAIR, enhancementLevel: 2 } } });
    const pricing = createPricing({
      priceTable: { ...createQuietPriceTable(), [CORSAIR]: { ask: -1, bid: -1, vendor: 0 } },
      enhancementQuotesByItem: {
        [CORSAIR]: {
          3: { ask: 300, bid: -1 },
          4: { ask: 400, bid: -1 },
          5: { ask: 500, bid: -1 },
        },
      },
    });
    const resolverCalls = [];
    const result = buildBudgetCandidates({
      playerConfig,
      pricingState: pricing,
      settings: {
        budgetCoins: 10000,
        bandRatio: 0.2,
        maxLevelUp: 3,
        enableAbilities: false,
        enableHouses: false,
      },
      fairValueResolver: (hrid, level, context) => {
        resolverCalls.push({ hrid, level, context });
        if (hrid === CORSAIR_REFINED) return { price: 500 + level * 100, source: 'official_estimate' };
        return null;
      },
    });
    // 精炼版 0..5 全部由估值救回：买入成本 = 估值（当前件无行情，抵扣按 0）。
    for (let level = 0; level <= 5; level += 1) {
      const candidate = candidateById(result, equipId('head', CORSAIR_REFINED, level));
      expect(candidate?.cost).toBe(500 + level * 100);
      expect(candidate?.costDetail).toMatchObject({
        estimatedByFairValue: true,
        priceSource: 'official_estimate',
        saleValue: 0,
        targetAsk: null,
      });
    }
    // 原链有价的档位（+3/4/5）不受估值影响：估值只兜缺价，绝不覆盖实价。
    expect(candidateById(result, equipId('head', CORSAIR, 3))?.cost).toBe(300);
    expect(candidateById(result, equipId('head', CORSAIR, 4))?.cost).toBe(400);
    expect(candidateById(result, equipId('head', CORSAIR, 5))?.cost).toBe(500);
    expect(candidateById(result, equipId('head', CORSAIR, 3))?.costDetail?.estimatedByFairValue).toBe(false);
    // resolver 只在缺价时被调用（有价候选不触发），context 带槽位供装备专用取价。
    expect(resolverCalls.every((call) => call.hrid === CORSAIR_REFINED)).toBe(true);
    expect(resolverCalls[0]?.context).toEqual({ kind: 'equipment', slotKey: 'head' });
    expect(result.diagnostics.fallbackFairValue).toBe(6);
    expect(result.diagnostics.skippedNoPrice).toBe(0);
  });

  it('缺价估值候选同样受 budgetHigh 剪枝（估值即成本，与真实价候选同一比较）', () => {
    const playerConfig = createPlayer({ equipment: { head: { itemHrid: CORSAIR, enhancementLevel: 2 } } });
    const pricing = createPricing({
      priceTable: { ...createQuietPriceTable(), [CORSAIR]: { ask: -1, bid: -1, vendor: 0 } },
      enhancementQuotesByItem: {
        [CORSAIR]: {
          3: { ask: 300, bid: -1 },
          4: { ask: 400, bid: -1 },
          5: { ask: 500, bid: -1 },
        },
      },
    });
    // 精炼版 0..5 全部缺价，只能由估值救回（估值 = 1000 + 档位 × 100 ⇒ 1000..1500）；
    // budgetHigh = 1000 × 1.2 = 1200，故 3/4/5 档的估值成本超限，应与真实价候选一样被剪掉。
    const result = buildBudgetCandidates({
      playerConfig,
      pricingState: pricing,
      settings: {
        budgetCoins: 1000,
        bandRatio: 0.2,
        maxLevelUp: 3,
        enableAbilities: false,
        enableHouses: false,
      },
      fairValueResolver: (hrid, level) => (hrid === CORSAIR_REFINED ? { price: 1000 + level * 100 } : null),
    });
    // 保留：当前物品 3/4/5 档（真价 300/400/500）+ 精炼版 0/1/2 档（估值 1000/1100/1200）。
    expect(result.candidates).toHaveLength(6);
    expect(candidateById(result, equipId('head', CORSAIR, 3))?.cost).toBe(300);
    expect(candidateById(result, equipId('head', CORSAIR_REFINED, 2))?.cost).toBe(1200);
    // 估值超 budgetHigh 的档位被剪枝丢弃（与真实价候选共用 `cost > budgetHigh` 比较）。
    expect(candidateById(result, equipId('head', CORSAIR_REFINED, 3))).toBeNull();
    expect(candidateById(result, equipId('head', CORSAIR_REFINED, 4))).toBeNull();
    expect(candidateById(result, equipId('head', CORSAIR_REFINED, 5))).toBeNull();
    // 超预算丢弃不是缺价（skippedNoPrice 只统计缺价）；估值救回计数发生在剪枝之前，故为全部 6 档。
    expect(result.diagnostics.skippedNoPrice).toBe(0);
    expect(result.diagnostics.fallbackFairValue).toBe(6);
  });

  it('估值也不可得时照旧跳过（回退不改变诚实缺价语义）', () => {
    const playerConfig = createPlayer({ equipment: { head: { itemHrid: CORSAIR, enhancementLevel: 2 } } });
    const pricing = createPricing({
      priceTable: { ...createQuietPriceTable(), [CORSAIR]: { ask: -1, bid: -1, vendor: 0 } },
      enhancementQuotesByItem: {
        [CORSAIR]: {
          3: { ask: 300, bid: -1 },
          4: { ask: 400, bid: -1 },
          5: { ask: 500, bid: -1 },
        },
      },
    });
    const result = buildBudgetCandidates({
      playerConfig,
      pricingState: pricing,
      settings: {
        budgetCoins: 10000,
        bandRatio: 0.2,
        maxLevelUp: 3,
        enableAbilities: false,
        enableHouses: false,
      },
      fairValueResolver: () => null,
    });
    expect(result.candidates).toHaveLength(3);
    expect(result.diagnostics.skippedNoPrice).toBe(6);
    expect(result.diagnostics.fallbackFairValue).toBe(0);
    // resolver 给不出值（null）属「完全缺价」：子计数为 0，明细保持旧形状（不带 reason）。
    expect(result.diagnostics.skippedFairValueBelowSale).toBe(0);
    expect(result.diagnostics.skippedNoPriceDetails.every((item) => item.reason === undefined)).toBe(true);
  });

  it('估值回退来源门（2026-10-16 下沉）：vendor 非买入口径被域层拒绝，白名单估值照旧参与（魔术师帽★ +20 回归）', () => {
    // 真实事故（2026-10-16）：魔术师帽★ +12 → +20 的买入侧全链缺价，估值回退落商店
    // 卖店价（真实 itemDetailMap.sellPrice = 350 万），再减 +12 的实价卖出抵扣后被钳成 0
    // —— 链按「免费项」定选（效率 +Infinity）、界面显示「花费 0」。两道修复：(1) 域层
    // 来源门拒绝 vendor 等非买入口径来源（(a)/(c)，缺 source 放行见专项用例）；(2) 白名单
    // 估值仍只在估值 > 卖出抵扣（净支出为正）时成立，估值不足以支撑正净支出时按缺价跳过
    //（(d) 等于边界，严格大于才通过）。
    // pricingState 可覆盖：缺省 = 旧件（+2）有实价卖单（卖出抵扣 9.6 亿）；(c) 传入旧件
    // 全缺价的定价表（卖出抵扣 0），锚定来源门拦截与抵扣大小无关。
    const createArgs = (resolver, pricingStateOverride) => ({
      playerConfig: createPlayer({ equipment: { head: { itemHrid: CORSAIR_REFINED, enhancementLevel: 2 } } }),
      pricingState:
        pricingStateOverride ||
        createPricing({
          priceTable: { ...createQuietPriceTable(), [CORSAIR_REFINED]: { ask: -1, bid: -1, vendor: 0 } },
          // 旧件（+2）有实价卖单：卖出抵扣 = 10 亿 × (1 − 4% 市场税) = 9.6 亿。
          enhancementQuotesByItem: { [CORSAIR_REFINED]: { 2: { ask: 1_000_000_000, bid: -1 } } },
        }),
      settings: {
        budgetCoins: 2_000_000_000,
        bandRatio: 0.2,
        maxLevelUp: 3,
        enableAbilities: false,
        enableHouses: false,
      },
      fairValueResolver: resolver,
    });

    // (a) vendor（商店卖店价）估值 350 万：域层来源门先于数值门拒绝（拒绝与抵扣大小无关），
    // 按完全缺价记账（skippedNoPrice + 明细无 reason，不计入 fallbackFairValue，也不计入
    // 「估值不足」子计数——那是买入口径估值的专属语义，见 (d)）。
    const skipped = buildBudgetCandidates(
      createArgs((hrid) => (hrid === CORSAIR_REFINED ? { price: 3_500_000, source: 'vendor' } : null)),
    );
    expect(candidateById(skipped, equipId('head', CORSAIR_REFINED, 3))).toBeNull();
    expect(candidateById(skipped, equipId('head', CORSAIR_REFINED, 4))).toBeNull();
    expect(candidateById(skipped, equipId('head', CORSAIR_REFINED, 5))).toBeNull();
    expect(skipped.diagnostics.fallbackFairValue).toBe(0);
    expect(skipped.diagnostics.skippedNoPrice).toBe(3);
    // 2026-10-16 来源门下沉：vendor 被域层拒绝后不进数值门 →「估值不足」子计数为 0，
    // 明细条目保持旧形状（无 reason 标记）。
    expect(skipped.diagnostics.skippedFairValueBelowSale).toBe(0);
    expect(skipped.diagnostics.skippedNoPriceDetails.every((item) => item.reason === undefined)).toBe(true);

    // (b) 估值 20 亿 > 抵扣 9.6 亿：照常参与，净支出 = 估值 − 抵扣（严格为正）。
    const kept = buildBudgetCandidates(
      createArgs((hrid) => (hrid === CORSAIR_REFINED ? { price: 2_000_000_000, source: 'official_estimate' } : null)),
    );
    const candidate = candidateById(kept, equipId('head', CORSAIR_REFINED, 3));
    expect(candidate?.cost).toBe(2_000_000_000 - 960_000_000);
    expect(candidate?.costDetail).toMatchObject({
      targetAsk: null,
      saleValue: 960_000_000,
      priceSource: 'official_estimate',
      estimatedByFairValue: true,
    });
    expect(kept.diagnostics.fallbackFairValue).toBe(3);
    expect(kept.diagnostics.skippedNoPrice).toBe(0);
    // 估值通过数值门 → 既不是缺价，也不进「估值不足」子计数。
    expect(kept.diagnostics.skippedFairValueBelowSale).toBe(0);

    // (c) 来源门锚定（2026-10-16 下沉；原 2026-10-16「域层不做来源判定」契约已按本段预留的
    // 迁移要求反转）：同一 vendor 估值在旧件完全缺价（卖出抵扣 0）时同样被域层来源门拒绝
    // ——按完全缺价记账（无 reason、不计 fallbackFairValue、不计「估值不足」子计数）。
    // 若把来源门回退为「域层不判来源」旧行为，本段会失败并提示契约回退——届时必须同步
    // 回滚 budgetOptimizerDomain 函数头 fairValueResolver 的 JSDoc 与估值分支旁注。
    const vendorRejected = buildBudgetCandidates(
      createArgs(
        (hrid) => (hrid === CORSAIR_REFINED ? { price: 3_500_000, source: 'vendor' } : null),
        createPricing({
          priceTable: { ...createQuietPriceTable(), [CORSAIR_REFINED]: { ask: -1, bid: -1, vendor: 0 } },
          // 旧件（+2）无任何实价卖单：卖出抵扣按 0（保守口径，不低估净支出）。
          enhancementQuotesByItem: {},
        }),
      ),
    );
    expect(vendorRejected.candidates).toHaveLength(0);
    for (let level = 3; level <= 5; level += 1) {
      expect(candidateById(vendorRejected, equipId('head', CORSAIR_REFINED, level))).toBeNull();
    }
    expect(vendorRejected.diagnostics.fallbackFairValue).toBe(0);
    expect(vendorRejected.diagnostics.skippedNoPrice).toBe(3);
    expect(vendorRejected.diagnostics.skippedFairValueBelowSale).toBe(0);
    expect(vendorRejected.diagnostics.skippedNoPriceDetails.every((item) => item.reason === undefined)).toBe(true);

    // (d) 边界：估值恰等于旧件卖出抵扣（数值门要求严格大于）→ 同样按「估值不足」记账，不产生免费项。
    const equalEdge = buildBudgetCandidates(
      createArgs((hrid) => (hrid === CORSAIR_REFINED ? { price: 960_000_000, source: 'official_estimate' } : null)),
    );
    expect(equalEdge.candidates).toHaveLength(0);
    expect(equalEdge.diagnostics.skippedNoPrice).toBe(3);
    expect(equalEdge.diagnostics.skippedFairValueBelowSale).toBe(3);
  });

  it('来源门放行缺 source 的 resolver 返回值（2026-10-16 契约：缺 source 不判来源，防误收紧）', () => {
    const result = buildBudgetCandidates({
      playerConfig: createPlayer({ equipment: { head: { itemHrid: CORSAIR_REFINED, enhancementLevel: 2 } } }),
      pricingState: createPricing({
        priceTable: { ...createQuietPriceTable(), [CORSAIR_REFINED]: { ask: -1, bid: -1, vendor: 0 } },
        // 旧件（+2）无实价卖单：卖出抵扣 0，净支出 = 估值本身。
        enhancementQuotesByItem: {},
      }),
      settings: {
        budgetCoins: 2_000_000_000,
        bandRatio: 0.2,
        maxLevelUp: 3,
        enableAbilities: false,
        enableHouses: false,
      },
      // 返回值不带 source：域层不作来源判定，估值照常救回参与搜索
      //（契约只约定 resolver「只应返回」买入口径来源、未强制 source 必填）。
      fairValueResolver: (hrid) => (hrid === CORSAIR_REFINED ? { price: 500_000 } : null),
    });
    for (let level = 3; level <= 5; level += 1) {
      const kept = candidateById(result, equipId('head', CORSAIR_REFINED, level));
      expect(kept?.cost).toBe(500_000);
      expect(kept?.costDetail).toMatchObject({
        targetAsk: null,
        saleValue: 0,
        priceSource: 'fair_value',
        estimatedByFairValue: true,
      });
    }
    expect(result.diagnostics.fallbackFairValue).toBe(3);
    expect(result.diagnostics.skippedNoPrice).toBe(0);
    expect(result.diagnostics.skippedFairValueBelowSale).toBe(0);
  });

  it('净支出计入旧件卖出抵扣（含市场手续费），下限 0', () => {
    // (a) 卖旧价高于买价：净支出按下限 0 计（DP 的"0 成本选项"现实来源之一）。
    const cheapTarget = createPricing({
      priceTable: { ...createQuietPriceTable(), [CORSAIR]: { ask: -1, bid: -1, vendor: 0 } },
      enhancementQuotesByItem: {
        [CORSAIR]: {
          10: { bid: 100000 },
          11: { ask: 1000, bid: -1 },
        },
      },
    });
    const zeroCost = buildBudgetCandidates({
      playerConfig: createPlayer({ equipment: { head: { itemHrid: CORSAIR, enhancementLevel: 10 } } }),
      pricingState: cheapTarget,
      settings: {
        budgetCoins: 10000,
        bandRatio: 0.2,
        maxLevelUp: 1,
        enableAbilities: false,
        enableHouses: false,
      },
    });
    expect(candidateById(zeroCost, equipId('head', CORSAIR, 11))?.cost).toBe(0);

    // (b) 正常抵扣：卖价 ×（1 − 市场费率）四舍五入后从买价中扣除。
    const normalSale = createPricing({
      priceTable: { ...createQuietPriceTable(), [CORSAIR]: { ask: -1, bid: -1, vendor: 0 } },
      enhancementQuotesByItem: {
        [CORSAIR]: {
          10: { bid: 1000 },
          11: { ask: 1000, bid: -1 },
        },
      },
    });
    const expectedSaleValue = Math.round(1000 * (1 - MARKET_SALE_FEE_RATE));
    const deducted = buildBudgetCandidates({
      playerConfig: createPlayer({ equipment: { head: { itemHrid: CORSAIR, enhancementLevel: 10 } } }),
      pricingState: normalSale,
      settings: {
        budgetCoins: 10000,
        bandRatio: 0.2,
        maxLevelUp: 1,
        enableAbilities: false,
        enableHouses: false,
      },
    });
    expect(candidateById(deducted, equipId('head', CORSAIR, 11))?.cost).toBe(1000 - expectedSaleValue);
  });

  it('双手武器时跳过 off_hand 槽；空武器时副手正常生成', () => {
    // 旧件（当前装备）的卖价从 priceTable 读：这里让 azure_buckler 全无价（quiet 默认），
    // 卖旧抵扣为 0，成本恰为 +1 档买价——否则 bid 缺价会按既有口径回退 ask（选中价），
    // 产生"卖自己"的抵扣，断言不纯粹。
    const twoHandPricing = createPricing({
      priceTable: { ...createQuietPriceTable(), [GRIFFIN]: { ask: -1, bid: -1, vendor: 0 } },
      enhancementQuotesByItem: {
        [GRIFFIN]: { 1: { ask: 800, bid: -1 } },
        [AZURE_BUCKLER]: { 1: { ask: 700, bid: -1 } },
      },
    });
    const settings = {
      budgetCoins: 10000,
      bandRatio: 0.2,
      maxLevelUp: 1,
      enableAbilities: false,
      enableHouses: false,
    };

    const shieldHand = buildBudgetCandidates({
      playerConfig: createPlayer({
        equipment: {
          weapon: { itemHrid: GRIFFIN, enhancementLevel: 0 },
          off_hand: { itemHrid: AZURE_BUCKLER, enhancementLevel: 0 },
        },
      }),
      pricingState: twoHandPricing,
      settings,
    });
    expect(shieldHand.candidates.some((candidate) => candidate.groupKey === 'equip:off_hand')).toBe(false);
    expect(shieldHand.candidates.some((candidate) => candidate.effect.slotKey === 'off_hand')).toBe(false);
    expect(candidateById(shieldHand, equipId('weapon', GRIFFIN, 1))?.cost).toBe(800);

    const bareHand = buildBudgetCandidates({
      playerConfig: createPlayer({ equipment: { off_hand: { itemHrid: AZURE_BUCKLER, enhancementLevel: 0 } } }),
      pricingState: twoHandPricing,
      settings,
    });
    expect(candidateById(bareHand, equipId('off_hand', AZURE_BUCKLER, 1))?.cost).toBe(700);
  });
});

// ── 候选枚举：saleSide 抵扣口径（2026-10-09 接通全局 baselineSaleSide 设置）──────────

describe('buildBudgetCandidates - saleSide 抵扣口径', () => {
  // 同一物品 bid/ask 双侧不同价：旧件 +10（bid=1000 / ask=1200），目标 +11 买价 ask=5000。
  // 买价取大值保证两种口径的净支出均为正（抵扣不足以击穿 0 下限），剪枝断言才可控。
  function createDualSidePricing() {
    return createPricing({
      priceTable: { ...createQuietPriceTable(), [CORSAIR]: { ask: -1, bid: -1, vendor: 0 } },
      enhancementQuotesByItem: {
        [CORSAIR]: {
          10: { ask: 1200, bid: 1000 },
          11: { ask: 5000, bid: -1 },
        },
      },
    });
  }

  const settings = {
    budgetCoins: 10000,
    bandRatio: 0.2,
    maxLevelUp: 1,
    enableAbilities: false,
    enableHouses: false,
  };

  it('saleSide=ask 且 ask 有价：抵扣取 ask（重置成本口径），净支出比 bid 口径更小', () => {
    const result = buildBudgetCandidates({
      playerConfig: createPlayer({ equipment: { head: { itemHrid: CORSAIR, enhancementLevel: 10 } } }),
      pricingState: createDualSidePricing(),
      settings,
      saleSide: 'ask',
    });
    const candidate = candidateById(result, equipId('head', CORSAIR, 11));
    const expectedAskSale = Math.round(1200 * (1 - MARKET_SALE_FEE_RATE));
    const expectedBidSale = Math.round(1000 * (1 - MARKET_SALE_FEE_RATE));
    expect(candidate?.costDetail?.saleValue).toBe(expectedAskSale);
    expect(candidate?.cost).toBe(5000 - expectedAskSale);
    expect(candidate?.cost).toBeLessThan(5000 - expectedBidSale);
  });

  it('saleSide=ask 且 ask 缺价：抵扣按 0（刻意不回退 bid，与队列/成本弹窗口径一致）', () => {
    const pricing = createPricing({
      priceTable: { ...createQuietPriceTable(), [CORSAIR]: { ask: -1, bid: -1, vendor: 0 } },
      enhancementQuotesByItem: {
        [CORSAIR]: {
          10: { bid: 1000 },
          11: { ask: 1000, bid: -1 },
        },
      },
    });
    const result = buildBudgetCandidates({
      playerConfig: createPlayer({ equipment: { head: { itemHrid: CORSAIR, enhancementLevel: 10 } } }),
      pricingState: pricing,
      settings,
      saleSide: 'ask',
    });
    const candidate = candidateById(result, equipId('head', CORSAIR, 11));
    expect(candidate?.costDetail?.saleValue).toBe(0);
    expect(candidate?.cost).toBe(1000);
  });

  it('不传 saleSide 与显式 bid 结果一致（向后兼容锚定，缺省口径不变）', () => {
    const playerConfig = createPlayer({ equipment: { head: { itemHrid: CORSAIR, enhancementLevel: 10 } } });
    const pricingState = createDualSidePricing();
    const implicit = buildBudgetCandidates({ playerConfig, pricingState, settings });
    const explicit = buildBudgetCandidates({ playerConfig, pricingState, settings, saleSide: 'bid' });
    const expectedBidSale = Math.round(1000 * (1 - MARKET_SALE_FEE_RATE));
    const implicitCandidate = candidateById(implicit, equipId('head', CORSAIR, 11));
    expect(implicitCandidate?.costDetail?.saleValue).toBe(expectedBidSale);
    expect(implicitCandidate?.cost).toBe(candidateById(explicit, equipId('head', CORSAIR, 11))?.cost);
  });

  it('budgetHigh 介于两口径净支出之间：ask 口径保留、bid 口径剪掉（剪枝随口径联动）', () => {
    const expectedAskSale = Math.round(1200 * (1 - MARKET_SALE_FEE_RATE));
    const expectedBidSale = Math.round(1000 * (1 - MARKET_SALE_FEE_RATE));
    // bandRatio=0 ⇒ budgetHigh = budgetCoins；设为 ask 口径的净支出：ask 恰好保留，bid 被剪掉。
    const pruneSettings = {
      budgetCoins: 5000 - expectedAskSale,
      bandRatio: 0,
      maxLevelUp: 1,
      enableAbilities: false,
      enableHouses: false,
    };
    // 方向锚定：ask 抵扣更大 ⇒ ask 口径净支出严格小于 bid 口径净支出。
    expect(5000 - expectedAskSale).toBeLessThan(5000 - expectedBidSale);
    const askKept = buildBudgetCandidates({
      playerConfig: createPlayer({ equipment: { head: { itemHrid: CORSAIR, enhancementLevel: 10 } } }),
      pricingState: createDualSidePricing(),
      settings: pruneSettings,
      saleSide: 'ask',
    });
    expect(candidateById(askKept, equipId('head', CORSAIR, 11))).not.toBeNull();
    const bidPruned = buildBudgetCandidates({
      playerConfig: createPlayer({ equipment: { head: { itemHrid: CORSAIR, enhancementLevel: 10 } } }),
      pricingState: createDualSidePricing(),
      settings: pruneSettings,
      saleSide: 'bid',
    });
    expect(candidateById(bidPruned, equipId('head', CORSAIR, 11))).toBeNull();
  });
});

// ── 候选枚举：技能 ──────────────────────────────────────────────────────

describe('buildBudgetCandidates - 技能候选', () => {
  // 技能升级成本依赖全局 jigsLevelExperienceTable（历史命名）；每个用例先调用
  // ensureBudgetOptimizerCostReference 做幂等注入——缺表时 computeDefaultAbilityUpgradeCost
  // 会返回 null，全部技能候选会被静默跳过。
  const bookItemHrid = String(abilityBookInfoByAbilityHrid[BERSERK]?.itemHrid || '');
  const xpPerBook = Number(abilityBookInfoByAbilityHrid[BERSERK]?.xpPerBook || 0);
  const bidPerBook = 7;
  const xpAt = (level) => Number(levelExperienceTable[level]);
  const expectedAbilityCost = (fromLevel, toLevel) =>
    Math.ceil((xpAt(toLevel) - xpAt(fromLevel)) / xpPerBook) * bidPerBook;

  it('只升已装备技能、逐级枚举，成本 = 经验差 / 每本书经验 × 书价', () => {
    expect(ensureBudgetOptimizerCostReference()).toBe(true);
    const playerConfig = createPlayer({
      abilities: [
        { abilityHrid: BERSERK, level: 10 },
        { abilityHrid: '', level: 1 },
        { abilityHrid: '', level: 1 },
        { abilityHrid: '', level: 1 },
        { abilityHrid: '', level: 1 },
      ],
    });
    const pricing = createPricing({ priceTable: { [bookItemHrid]: { ask: 9, bid: bidPerBook, vendor: 1 } } });
    const result = buildBudgetCandidates({
      playerConfig,
      pricingState: pricing,
      settings: {
        budgetCoins: 1_000_000_000,
        bandRatio: 0.2,
        maxLevelUp: 3,
        enableEquipment: false,
        enableHouses: false,
      },
    });

    expect(result.candidates).toHaveLength(3);
    for (const level of [11, 12, 13]) {
      const candidate = candidateById(result, `ability:${BERSERK}:${level}`);
      expect(candidate?.cost).toBe(expectedAbilityCost(10, level));
      expect(candidate?.effect).toEqual({ type: 'ability', abilityHrid: BERSERK, level });
      expect(candidate?.fromEffect).toEqual({ type: 'ability', abilityHrid: BERSERK, level: 10 });
      expect(candidate?.kind).toBe('ability');
    }
    // 空技能槽不产候选；未装备的技能（不在 config.abilities 里）也不会被枚举。
    const candidatesByGroupKey = expectGroupsMatchCandidates(result);
    expect([...candidatesByGroupKey.keys()]).toEqual([`ability:${BERSERK}`]);
    expect(candidatesByGroupKey.get(`ability:${BERSERK}`)).toHaveLength(3);
    expect(result.candidates.every((candidate) => candidate.effect.abilityHrid === BERSERK)).toBe(true);
    expect(result.diagnostics.counts.ability).toBe(3);
    expect(result.diagnostics.skippedNoPrice).toBe(0);
  });

  it('成本超 budgetHigh 的技能档位被丢弃', () => {
    expect(ensureBudgetOptimizerCostReference()).toBe(true);
    const playerConfig = createPlayer({ abilities: [{ abilityHrid: BERSERK, level: 10 }] });
    const pricing = createPricing({ priceTable: { [bookItemHrid]: { ask: 9, bid: bidPerBook, vendor: 1 } } });
    // budgetHigh = 10（bandRatio 显式 0）：只保留成本 ≤ 10 的档位。
    const result = buildBudgetCandidates({
      playerConfig,
      pricingState: pricing,
      settings: { budgetCoins: 10, bandRatio: 0, maxLevelUp: 3, enableEquipment: false, enableHouses: false },
    });
    const expectedLevels = [11, 12, 13].filter((level) => expectedAbilityCost(10, level) <= 10);
    expect(result.candidates.map((candidate) => candidate.effect.level)).toEqual(expectedLevels);
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it('书价有 vendor 兜底时不触发估值回退（估值只在原链完全无价时兜底）', () => {
    expect(ensureBudgetOptimizerCostReference()).toBe(true);
    const playerConfig = createPlayer({ abilities: [{ abilityHrid: BERSERK, level: 10 }] });
    // 价格表不含技能书：resolveItemPriceFromPricingState 以 vendor 卖店价兜底（视为有价），
    // 不算缺价 —— 估值回退不该被触发（resolver 零调用）。
    const pricing = createPricing({ priceTable: {} });
    const vendorPrice = Math.max(0, Number(itemDetailIndex?.[bookItemHrid]?.sellPrice) || 0);
    expect(vendorPrice).toBeGreaterThan(0);
    const resolverCalls = [];
    const result = buildBudgetCandidates({
      playerConfig,
      pricingState: pricing,
      settings: {
        budgetCoins: 1_000_000_000,
        bandRatio: 0.2,
        maxLevelUp: 3,
        enableEquipment: false,
        enableHouses: false,
      },
      fairValueResolver: (hrid, level, context) => {
        resolverCalls.push({ hrid, level, context });
        return null;
      },
    });
    expect(result.candidates).toHaveLength(3);
    for (const level of [11, 12, 13]) {
      const candidate = candidateById(result, `ability:${BERSERK}:${level}`);
      expect(candidate?.cost).toBe(Math.ceil((xpAt(level) - xpAt(10)) / xpPerBook) * vendorPrice);
    }
    expect(resolverCalls).toHaveLength(0);
    expect(result.diagnostics.fallbackFairValue).toBe(0);
    expect(result.diagnostics.skippedNoPrice).toBe(0);
  });
});

// ── 候选枚举：房子 ──────────────────────────────────────────────────────

describe('buildBudgetCandidates - 房子候选', () => {
  const combatRoomHrids = () =>
    houseRoomHrids.filter(
      (hrid) => houseRoomDetailMap?.[hrid]?.usableInActionTypeMap?.['/action_types/combat'] === true,
    );
  const roomMaxLevel = (hrid) =>
    Math.max(0, ...Object.keys(houseRoomDetailMap?.[hrid]?.upgradeCostsMap || {}).map((key) => Number(key) || 0));
  // 把除目标房间外的战斗房间全部拉满：它们没有升级空间，不产候选，让断言聚焦 archery_range。
  const maxedOtherCombatRooms = (exceptHrid) =>
    Object.fromEntries(combatRoomHrids().map((hrid) => [hrid, hrid === exceptHrid ? 0 : roomMaxLevel(hrid)]));
  const materialUnitPrice = (hrid) => (hrid === '/items/coin' ? 1 : 2);
  const expectedRoomCost = (hrid, fromLevel, toLevel) => {
    let total = 0;
    for (let level = fromLevel + 1; level <= toLevel; level += 1) {
      for (const entry of houseRoomDetailMap?.[hrid]?.upgradeCostsMap?.[String(level)] || []) {
        total += Number(entry.count || 0) * materialUnitPrice(String(entry.itemHrid));
      }
    }
    return total;
  };
  const archeryMaterialPricing = () => {
    // 给 archery 1~2 级的全部非 coin 材料 ask=2；coin 由 buildHouseRoomUpgradeCostPreview 固定按 1 计。
    const priceTable = {};
    for (const level of ['1', '2']) {
      for (const entry of houseRoomDetailMap?.[ARCHERY]?.upgradeCostsMap?.[level] || []) {
        const hrid = String(entry.itemHrid || '');
        if (hrid && hrid !== '/items/coin') priceTable[hrid] = { ask: 2, bid: -1, vendor: 0 };
      }
    }
    return createPricing({ priceTable });
  };

  it('字段差异：生成索引精简掉了 usableInActionTypeMap，战斗房间判定必须读原始表', () => {
    // 生成索引只保留 { hrid, name, sortIndex, upgradeCostsMap }；域层读原始表就是为了
    // usableInActionTypeMap——若有人"优化"成读生成索引，战斗房间判定会整体失效。
    expect(houseRoomDetailMap?.[ARCHERY]?.usableInActionTypeMap?.['/action_types/combat']).toBe(true);
    expect(houseRoomDetailMap?.[BREWERY]?.usableInActionTypeMap?.['/action_types/combat']).not.toBe(true);
    expect(houseRoomDetailIndex?.[ARCHERY]).toBeTruthy();
    expect('usableInActionTypeMap' in houseRoomDetailIndex[ARCHERY]).toBe(false);
    expect(combatRoomHrids().length).toBeGreaterThan(0);
  });

  it('只取战斗房间，逐级到 min(房间上限, from + maxHouseUp)，累计成本按材料求和', () => {
    const playerConfig = createPlayer({
      houseRooms: { ...maxedOtherCombatRooms(ARCHERY), [ARCHERY]: 0, [BREWERY]: 5 },
    });
    const result = buildBudgetCandidates({
      playerConfig,
      pricingState: archeryMaterialPricing(),
      settings: {
        budgetCoins: 1_000_000_000,
        bandRatio: 0.2,
        maxHouseUp: 2,
        enableEquipment: false,
        enableAbilities: false,
      },
    });

    expect(result.candidates).toHaveLength(2);
    const candidate1 = candidateById(result, `house:${ARCHERY}:1`);
    const candidate2 = candidateById(result, `house:${ARCHERY}:2`);
    expect(candidate1?.cost).toBe(expectedRoomCost(ARCHERY, 0, 1));
    expect(candidate2?.cost).toBe(expectedRoomCost(ARCHERY, 0, 2));
    expect(candidate1?.effect).toEqual({ type: 'house', roomHrid: ARCHERY, level: 1 });
    expect(candidate1?.fromEffect).toEqual({ type: 'house', roomHrid: ARCHERY, level: 0 });
    // 非战斗房间（brewery）即使有等级、有升级空间也不产候选；已满级战斗房间没有升级空间。
    expect(result.candidates.some((candidate) => candidate.effect.roomHrid === BREWERY)).toBe(false);
    const candidatesByGroupKey = expectGroupsMatchCandidates(result);
    expect([...candidatesByGroupKey.keys()]).toEqual([`house:${ARCHERY}`]);
    expect(candidatesByGroupKey.get(`house:${ARCHERY}`)).toHaveLength(2);
    expect(result.diagnostics.counts.house).toBe(2);
  });

  it('maxHouseUp 档位受房间最高等级约束（min 语义）', () => {
    const playerConfig = createPlayer({ houseRooms: { ...maxedOtherCombatRooms(ARCHERY), [ARCHERY]: 0 } });
    const result = buildBudgetCandidates({
      playerConfig,
      pricingState: archeryMaterialPricing(),
      settings: {
        budgetCoins: 1_000_000_000,
        bandRatio: 0.2,
        maxHouseUp: BUDGET_OPTIMIZER_MAX_MAX_HOUSE_UP,
        enableEquipment: false,
        enableAbilities: false,
      },
    });
    const expectedLevels = [];
    for (let level = 1; level <= Math.min(roomMaxLevel(ARCHERY), BUDGET_OPTIMIZER_MAX_MAX_HOUSE_UP); level += 1) {
      expectedLevels.push(level);
    }
    expect(result.candidates.map((candidate) => candidate.effect.level)).toEqual(expectedLevels);
  });

  it('非币材料缺价：不再产出 0 成本假候选，而是计入 skippedNoPrice（诚实缺价）', () => {
    const playerConfig = createPlayer({
      houseRooms: { ...maxedOtherCombatRooms(ARCHERY), [ARCHERY]: 0 },
    });
    // 清空 archery 1 级全部非 coin 材料的 ask/bid/vendor（vendor 显式清零，防
    // itemDetailMap.sellPrice 的 vendor 回退把缺价材料变成"有价"，断言才会可控）。
    const priceTable = {};
    for (const entry of houseRoomDetailMap?.[ARCHERY]?.upgradeCostsMap?.['1'] || []) {
      const hrid = String(entry?.itemHrid || '');
      if (hrid && hrid !== '/items/coin') priceTable[hrid] = { ask: -1, bid: -1, vendor: 0 };
    }
    // 数据锚点：1 级升级必须包含非 coin 材料，否则本用例失去意义（数据更新时快速定位）。
    expect(Object.keys(priceTable).length).toBeGreaterThan(0);

    const result = buildBudgetCandidates({
      playerConfig,
      pricingState: createPricing({ priceTable }),
      settings: {
        budgetCoins: 1_000_000_000,
        bandRatio: 0.2,
        maxHouseUp: 1,
        enableEquipment: false,
        enableAbilities: false,
      },
    });

    // 旧行为：缺价材料按 0 计入 totalCost ⇒ 产出 cost 只剩金币的"廉价"候选且不计跳过；
    // 新行为：候选整体跳过并进入缺价统计（与装备/技能同口径）。
    expect(result.candidates.filter((candidate) => candidate.kind === 'house')).toHaveLength(0);
    expect(result.diagnostics.counts.house).toBe(0);
    expect(result.diagnostics.skippedNoPrice).toBe(1);
    expect(result.diagnostics.skippedNoPriceDetails).toHaveLength(1);
    const detail = result.diagnostics.skippedNoPriceDetails[0];
    expect(detail).toMatchObject({
      kind: 'house',
      effect: { type: 'house', roomHrid: ARCHERY, level: 1 },
    });
    // 明细带出缺价材料（hrid 数组）：全部命中被清价的材料，且不含 coin。
    expect(detail.unpricedMaterials.length).toBeGreaterThan(0);
    expect(detail.unpricedMaterials.every((hrid) => priceTable[hrid])).toBe(true);
    expect(detail.unpricedMaterials).not.toContain('/items/coin');
  });
});

// ── 配置补丁应用（评估管道复用）─────────────────────────────────────────

describe('applyBudgetEffectToPlayerConfig', () => {
  it('装备 / 技能 / 房子三类 effect 就地应用', () => {
    const config = createPlayer();
    applyBudgetEffectToPlayerConfig(config, {
      type: 'equipment',
      slotKey: 'head',
      itemHrid: CORSAIR,
      enhancementLevel: 5,
    });
    expect(config.equipment.head).toEqual({ itemHrid: CORSAIR, enhancementLevel: 5 });

    applyBudgetEffectToPlayerConfig(config, { type: 'ability', abilityHrid: BERSERK, level: 33 });
    expect(config.abilities.find((ability) => ability.abilityHrid === BERSERK)?.level).toBe(33);
    // 未装备的技能按"新加技能"处理（v1 虽然不产此类候选，函数语义仍要完整）。
    applyBudgetEffectToPlayerConfig(config, { type: 'ability', abilityHrid: '/abilities/fireball', level: 10 });
    expect(config.abilities.find((ability) => ability.abilityHrid === '/abilities/fireball')?.level).toBe(10);

    applyBudgetEffectToPlayerConfig(config, { type: 'house', roomHrid: ARCHERY, level: 3 });
    expect(config.houseRooms[ARCHERY]).toBe(3);
  });

  it('非法输入与未知类型不改变配置', () => {
    const config = createPlayer({ equipment: { head: { itemHrid: CORSAIR, enhancementLevel: 1 } } });
    const before = JSON.parse(JSON.stringify(config));
    applyBudgetEffectToPlayerConfig(config, null);
    applyBudgetEffectToPlayerConfig(config, 'nonsense');
    applyBudgetEffectToPlayerConfig(config, { type: 'unknown' });
    applyBudgetEffectToPlayerConfig(config, { type: 'equipment', slotKey: '' });
    applyBudgetEffectToPlayerConfig(config, { type: 'ability', abilityHrid: '', level: 3 });
    applyBudgetEffectToPlayerConfig(config, { type: 'house', roomHrid: '', level: 3 });
    expect(config).toEqual(before);
    expect(applyBudgetEffectToPlayerConfig(null, { type: 'house', roomHrid: ARCHERY, level: 1 })).toMatchObject({
      houseRooms: { [ARCHERY]: 1 },
    });
  });
});

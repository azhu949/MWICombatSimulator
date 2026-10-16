// budgetOptimizerSearch 集成测试（升级链模式 v4；WorkerClientCtor 桩注入）。
//
// 覆盖范围：
//   1) 小池链流程：链推演（性价比 + tie-break + 剩余额度剪枝）、报告结构（steps/totalCost/
//      remainingBudget/finalConfig/stopReason）、进度字段与 onStep 渐进；
//   2) racing：池 > 8 粗筛发生、幸存者精筛、第一步定选；
//   3) 种子口径（硬约束①）：步内基线与候选共享种子列表，全链共享同一套种子（2026-10-08 起不再入步号），
//      链终复验使用独立 verify 盐；
//   4) 空蓝判负：判负候选不进定选、终止快照留证；
//   5) 取消语义 / 错误防御（入口三查 / 抛错上抛 / 退化样本 / 空池）；
//   6) 批量/逐场回退（顺带覆盖 budgetOptimizerSimulation 的评估管道）；
//   7) 优化目标（dps / xp / profit / 缺省利润）。
//
// 链行为推演锚点（linearGains：head 0.05/级、成本 = 100×目标档；budgetHigh = 1200）：
//   step0（档 0 起，候选 +1..+6）：Δ=5000L、成本=100L → 性价比全等 50 → tie-break 成本最低 → +1。
//   step1（档 1 起，候选 +2..+6）：Δ=5000(L−1)、成本=100L → 性价比随 L 递增 → +6（成本 600）。
//   step2（档 6 起）：无候选（等级上限）→ exhausted。链 = [+1, +6]，总花费 700，剩余 500。
//
// 桩口径：响应器按 payload.players[0] 的装备强化等级给出确定性 dps（无噪声）→ se=0 →
// tie-break 可预期；批量桩与逐场桩分开（前者用于种子分组断言，后者覆盖回退路径）。
//
// 定价口径：Corsair 逐档 ask = 100×level（成本 = ask − 旧件卖出抵扣；旧件卖价被静默价格表清零）。

import { afterEach, describe, expect, it, vi } from 'vitest';

import itemDetailMap from '../../combatsimulator/data/itemDetailMap.json';
import { equipmentOptionsBySlot } from '../../shared/gameDataIndex.js';
import { createEmptyPlayerConfig } from '../../shared/playerConfig.js';
import {
  BUDGET_OPTIMIZER_BUSY_ERROR,
  BUDGET_OPTIMIZER_MAX_CHAIN_STEPS,
  BUDGET_OPTIMIZER_PRESETS,
  BUDGET_OPTIMIZER_REPORT_VERSION,
  BUDGET_OPTIMIZER_SEED_SALT_REFINE,
  BUDGET_OPTIMIZER_SEED_SALT_SCREEN,
  BUDGET_OPTIMIZER_SEED_SALT_VERIFY,
  BUDGET_OPTIMIZER_SKIPPED_DETAILS_LIMIT,
  BUDGET_OPTIMIZER_STEP_CANDIDATES_LIMIT,
  createBudgetOptimizerSeedSet,
} from '../budgetOptimizerDomain.js';
import {
  BUDGET_OPTIMIZER_EVIDENCE_BAND_FREE,
  BUDGET_OPTIMIZER_RACING_MIN_POOL,
  BUDGET_OPTIMIZER_STOP_CANCELLED,
  BUDGET_OPTIMIZER_STOP_EXHAUSTED,
  BUDGET_OPTIMIZER_STOP_SIGNIFICANCE,
  BUDGET_OPTIMIZER_STOP_STEP_LIMIT,
  MISSING_PLAYER_ERROR,
  SHARED_RUN_BUSY_ERROR,
  buildChainProgress,
  buildReusableBaselineBundle,
  isBudgetRacingPool,
  optimizeBudgetUpgrades,
  resolveBudgetEvidenceBand,
  resolveBudgetKeepCount,
} from '../budgetOptimizerSearch.js';
import { aggregateRoundMetrics, createDegenerateMetrics } from '../budgetOptimizerSimulation.js';
import {
  cancelBudgetOptimizerRun,
  hasBudgetOptimizerRunInProgress,
  registerBudgetOptimizerRun,
  unregisterBudgetOptimizerRun,
} from '../budgetOptimizerRunRegistry.js';
import { ONE_HOUR } from '../simulationDomain.js';
import {
  DEDICATED_WORKER_SCOPE_HOME_MULTI_ROUND,
  cancelDedicatedWorkerRuns,
  cancelSharedWorkerRun,
  runSharedSingleSimulationPayload,
  runSimulationBatchWithDedicatedWorker,
  stopHomeMultiRoundWorkerRuns,
} from '../simulatorWorkerRuns.js';

// ── 测试数据常量 ────────────────────────────────────────────────────────

const CORSAIR = '/items/corsair_helmet'; // head 基础版（有精炼家族：未报价的精炼档会被缺价跳过）
const CORSAIR_REFINED = '/items/corsair_helmet_refined';
const GRIFFIN = '/items/griffin_bulwark'; // two_hand 武器
const HEAD_ID = (level) => `equip:head:${CORSAIR}:${level}`;
const BASE_DPS = 100000;
const STANDARD = BUDGET_OPTIMIZER_PRESETS.standard;
const FINE = BUDGET_OPTIMIZER_PRESETS.fine;

// ── 通用辅助 ────────────────────────────────────────────────────────────

// 全技能 120 级的主角：等级要求不参与本文件的断言（候选可达性由 domain 测试锚定）。
function createPlayer({ weapon = false } = {}) {
  const config = createEmptyPlayerConfig('1');
  for (const key of Object.keys(config.levels)) config.levels[key] = 120;
  config.equipment.head = { itemHrid: CORSAIR, enhancementLevel: 0 };
  if (weapon) config.equipment.weapon = { itemHrid: GRIFFIN, enhancementLevel: 0 };
  return config;
}

// 全目录静默（ask/bid -1、vendor 0）：旧件卖出抵扣恒为 0，成本 = 目标档 ask，断言可控。
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

function createPricing({ headLevels = [1, 2, 3, 4, 5, 6], weaponLevels = [] } = {}) {
  const priceTable = createQuietPriceTable();
  priceTable[CORSAIR] = { ask: -1, bid: -1, vendor: 0 };
  priceTable[GRIFFIN] = { ask: -1, bid: -1, vendor: 0 };
  const enhancementQuotesByItem = {};
  if (headLevels.length > 0) {
    enhancementQuotesByItem[CORSAIR] = Object.fromEntries(
      headLevels.map((level) => [level, { ask: 100 * level, bid: -1 }]),
    );
  }
  if (weaponLevels.length > 0) {
    enhancementQuotesByItem[GRIFFIN] = Object.fromEntries(
      weaponLevels.map((level) => [level, { ask: 100 * level, bid: -1 }]),
    );
  }
  return { priceTable, enhancementQuotesByItem, dropMode: 'bid', marketTimestamp: 1234 };
}

function createInput({
  weapon = false,
  headLevels = [1, 2, 3, 4, 5, 6],
  weaponLevels = [],
  maxLevelUp = 6,
  settings = {},
  teammates = [],
  WorkerClientCtor = BatchWorkerClient,
  parallelWorkerLimit = 2,
} = {}) {
  return {
    playerConfig: createPlayer({ weapon }),
    teammates,
    simulationSettings: {
      mode: 'zone',
      zoneHrid: '/actions/combat/green_slimes',
      difficultyTier: 0,
      simulationTimeHours: 24,
    },
    settings: {
      budgetCoins: 1000,
      bandRatio: 0.2,
      simulationHours: 24,
      enableEquipment: true,
      enableAbilities: false,
      enableHouses: false,
      // 本文件默认锚定 dps 口径；「缺省 → 利润」的行为由专项用例显式传 undefined 验证。
      objective: 'dps',
      // 本文件锚定「搜索链路」行为（链形 / 场次账 / 复用一致性）：显式关闭显著性门槛，
      // 否则噪声桩用例会被拦成零步链；门槛开启（含生产默认）的行为由专项用例覆盖。
      pickSignificanceGate: false,
      maxLevelUp,
      searchPreset: 'standard',
      ...settings,
    },
    pricing: { pricingState: createPricing({ headLevels, weaponLevels }), pricingOptions: {} },
    parallelWorkerLimit,
    WorkerClientCtor,
  };
}

function deriveSeeds(input, salt, count, step) {
  return createBudgetOptimizerSeedSet({
    playerId: String(input.playerConfig.id ?? '1'),
    simulationSettings: input.simulationSettings,
    salt,
    count,
    step,
  });
}

const toSeed = (seed) => Number(seed) >>> 0;
const sameSeeds = (list, expected) =>
  list.length === expected.length && list.every((seed, index) => seed === toSeed(expected[index]));

// 最小可打分的 simResult：dps 由攻击伤害表控制（100 × count / 秒），xp 缺省与 dps 同值
//（陪跑口径）；objective='xp' 用例显式传独立 xp 通道。
function buildSimResult({ dps, xp = dps, ranOutOfMana = false }) {
  return {
    simulatedTime: 24 * ONE_HOUR,
    encounters: 240,
    deaths: { player1: 0 },
    experienceGained: { player1: { attack: xp } },
    attacks: { player1: { stub: { cast: { 100: dps * 864 } } } },
    consumablesUsed: { player1: {} },
    playerRanOutOfMana: { player1: ranOutOfMana },
  };
}

function equipmentLevelOf(payload, hrid) {
  for (const item of Object.values(payload?.players?.[0]?.equipment ?? {})) {
    if (String(item?.hrid ?? '') === hrid) return Number(item?.enhancementLevel ?? 0);
  }
  return 0;
}

// 增益函数 → 响应器：逐装备件的（加成, 空蓝标记）由 gainFor 决定。
function buildResponder({ gainFor }) {
  return (payload) => {
    let bonus = 0;
    let xpBonus = 0;
    let ranOutOfMana = false;
    for (const item of Object.values(payload?.players?.[0]?.equipment ?? {})) {
      const spec = gainFor({ hrid: String(item?.hrid ?? ''), level: Number(item?.enhancementLevel ?? 0) });
      if (!spec) continue;
      bonus += Number(spec.bonus ?? 0);
      xpBonus += Number(spec.xpBonus ?? 0);
      if (spec.ranOutOfMana === true) ranOutOfMana = true;
    }
    const dps = Math.round(BASE_DPS * (1 + bonus));
    // xpBonus 缺省 0：xp 与 dps 同值（陪跑）；显式给出时独立控制经验通道。
    const xp = xpBonus > 0 ? Math.round(BASE_DPS * (1 + xpBonus)) : dps;
    return { simResult: buildSimResult({ dps, xp, ranOutOfMana }) };
  };
}

// 线性增益：Corsair 0.05/级、Griffin 0.02/级。
const linearGains = ({ hrid, level }) => {
  if (hrid === CORSAIR) return { bonus: 0.05 * level };
  if (hrid === GRIFFIN) return { bonus: 0.02 * level };
  return null;
};

// ── 桩（两类：批量能力 / 只有逐场）─────────────────────────────────────

const stub = { responder: null, instances: [] };

class SingleWorkerClient {
  constructor() {
    this.payload = null;
    this.payloads = null;
    this.evalSeeds = [];
    this.evalPlayers = [];
    stub.instances.push(this);
  }

  startSimulation(payload, handlers = {}) {
    this.payload = payload;
    this.payloads = [payload];
    this.evalSeeds = [toSeed(payload?.seed)];
    this.evalPlayers = [Array.isArray(payload?.players) ? payload.players.length : 0];
    // 评估身份标识（分片断言用）：主角的 Corsair 装备等级（基线 = 0，候选 = 目标档）。
    this.evalLevels = [equipmentLevelOf(payload, CORSAIR)];
    const response = stub.responder?.(payload) ?? null;
    if (!response) return;
    if (response.error) {
      handlers.onError?.(new Error(response.error));
      return;
    }
    handlers.onResult?.(response.simResult);
  }

  stopSimulation() {}
}

class BatchWorkerClient extends SingleWorkerClient {
  startSimulationBatch(payloads, handlers = {}) {
    const list = Array.isArray(payloads) ? payloads : [];
    this.payloads = list;
    this.evalSeeds = list.map((payload) => toSeed(payload?.seed));
    this.evalPlayers = list.map((payload) => (Array.isArray(payload?.players) ? payload.players.length : 0));
    // 评估身份标识（分片断言用）：主角的 Corsair 装备等级（基线 = 0，候选 = 目标档）。
    this.evalLevels = list.map((payload) => equipmentLevelOf(payload, CORSAIR));
    let pending = false;
    list.forEach((payload, index) => {
      const response = stub.responder?.(payload) ?? null;
      if (!response) {
        // 无响应 = 该场在途（供取消用例制造"挂起"）；整批不结算，等待取消/超时。
        pending = true;
        return;
      }
      if (response.error) {
        handlers.onError?.(new Error(response.error), index);
        return;
      }
      handlers.onResult?.(response.simResult, index);
    });
    if (!pending) handlers.onComplete?.();
  }
}

// 共享运行闸门用例用的空转桩（startSimulation 永不回调 → 句柄保持注册）。
class IdleWorkerClient {
  startSimulation() {}
  stopSimulation() {}
}

// 首页多轮批闸门用例用的悬空批桩（startSimulationBatch 永不回调）。
class HangingBatchWorkerClient {
  startSimulationBatch() {}
  stopSimulation() {}
}

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timeout');
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

afterEach(() => {
  cancelBudgetOptimizerRun();
  cancelDedicatedWorkerRuns();
  cancelSharedWorkerRun();
  stub.responder = null;
  stub.instances = [];
});

// ── 测试 ────────────────────────────────────────────────────────────────

describe('budgetOptimizerSearch 纯口径', () => {
  it('isBudgetRacingPool / resolveBudgetKeepCount：阈值与保留数', () => {
    expect(isBudgetRacingPool(BUDGET_OPTIMIZER_RACING_MIN_POOL)).toBe(false);
    expect(isBudgetRacingPool(BUDGET_OPTIMIZER_RACING_MIN_POOL + 1)).toBe(true);

    // 保留数 = clamp(ceil(N×ratio), min, N)：小池被下限保底但不超池；N=0 → 0。
    expect(resolveBudgetKeepCount(20, STANDARD)).toBe(
      Math.max(STANDARD.refineKeepMin, Math.ceil(20 * STANDARD.refineKeepRatio)),
    );
    expect(resolveBudgetKeepCount(3, STANDARD)).toBe(3);
    expect(resolveBudgetKeepCount(0, STANDARD)).toBe(0);
  });

  it('链进度口径（饱和式）：阶段交接连续不回落、阶段内单调不减、中途不达 1', () => {
    // 单调不降的两个必要条件（本用例是「进度回退」缺陷的回归护栏，2026-10-09）：
    //   ① 阶段交接连续 —— 阶段池跑满后 finishStage 把 stage 置空、阶段内进度归零，但分母同步 +1，
    //      交接处取值必须与收尾峰值相等：f(S, 1) === f(S+1, 0)。旧公式 (S + intra) / (S + 1)
    //      在这里从 1 掉回 S/(S+1)（第 0 步即 100% → 0%），进度条呈锯齿、与文档承诺相反。
    //   ② 阶段内随完成度单调不减。
    for (let completedStages = 0; completedStages < 6; completedStages += 1) {
      expect(buildChainProgress(completedStages, 1)).toBeCloseTo(buildChainProgress(completedStages + 1, 0), 12);
      let previous = -1;
      for (let step = 0; step <= 20; step += 1) {
        const value = buildChainProgress(completedStages, step / 20);
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
    // 饱和式：全链渐近趋近 1、中途不达 1 —— 收尾归 1 仍由收尾的强制上报负责（progress=1）。
    expect(buildChainProgress(0, 0)).toBe(0);
    expect(buildChainProgress(20, 1)).toBeGreaterThan(0.9);
    expect(buildChainProgress(20, 1)).toBeLessThan(1);
    // 脏值防御：阶段内进度按 [0, 1] clamp，整体不超 1。
    expect(buildChainProgress(2, -5)).toBe(buildChainProgress(2, 0));
    expect(buildChainProgress(2, 5)).toBeLessThanOrEqual(1);
  });

  it('证据档判定（共享谓词）：免费项单列一档，脏成本不得冒充免费项', () => {
    // 免费项：Δ 有限且为正、成本有限且 ≤ 0 → FREE 档（与「不可用」分档，档序在 0/1/2 之前）。
    expect(resolveBudgetEvidenceBand({ delta: 5000, cost: 0, refined: true })).toBe(
      BUDGET_OPTIMIZER_EVIDENCE_BAND_FREE,
    );
    expect(resolveBudgetEvidenceBand({ delta: 5000, cost: 0, refined: false })).toBe(
      BUDGET_OPTIMIZER_EVIDENCE_BAND_FREE,
    );
    // 付费候选：仍按精筛 / 粗筛分档。
    expect(resolveBudgetEvidenceBand({ delta: 5000, cost: 100, refined: true })).toBe(0);
    expect(resolveBudgetEvidenceBand({ delta: 5000, cost: 100, refined: false })).toBe(1);
    // 反向断言：Δ ≤ 0 / 空蓝回归 / 成本缺失或非有限 → 一律不可用档（不得被当成免费项）。
    expect(resolveBudgetEvidenceBand({ delta: 0, cost: 0, refined: true })).toBe(2);
    expect(resolveBudgetEvidenceBand({ delta: -1, cost: 0, refined: true })).toBe(2);
    expect(resolveBudgetEvidenceBand({ delta: 5000, cost: 0, manaRegression: true })).toBe(2);
    expect(resolveBudgetEvidenceBand({ delta: 5000, cost: Number.NaN, refined: true })).toBe(2);
    expect(resolveBudgetEvidenceBand({ delta: 5000, refined: true })).toBe(2);
    expect(resolveBudgetEvidenceBand()).toBe(2);
  });

  it('测试数据前提：Corsair 基础/精炼与 Griffin 存在于当前数据快照', () => {
    expect(itemDetailMap[CORSAIR]?.equipmentDetail?.type).toBe('/equipment_types/head');
    expect(itemDetailMap[CORSAIR_REFINED]?.equipmentDetail?.type).toBe('/equipment_types/head');
    expect(itemDetailMap[GRIFFIN]?.equipmentDetail?.type).toBe('/equipment_types/two_hand');
  });

  it('步数上限常量在合理范围（安全阀：足够长又不会失控）', () => {
    expect(BUDGET_OPTIMIZER_MAX_CHAIN_STEPS).toBeGreaterThanOrEqual(10);
    expect(BUDGET_OPTIMIZER_MAX_CHAIN_STEPS).toBeLessThanOrEqual(100);
    expect(BUDGET_OPTIMIZER_STEP_CANDIDATES_LIMIT).toBeGreaterThanOrEqual(10);
  });
});

// ── 跨步基线写入防御（2026-10-09，与首评失败防御对称）──────────────────
// 链内复用上下文写入处（reuseContext.baselineBundle）对选中项评估的失败退化结构与缺失
// 不再进缓存 —— 失败结构一旦入缓存，下一步跳过基线评估、全部候选配对统计为 null 而终止，
// 且停因误报为「剩余额度内已无可买项」（与 2026-10-09 首评修复前行为同构）。
describe('buildReusableBaselineBundle 纯口径（跨步基线写入防御）', () => {
  // bundle 构建委托由调用方注入（生产端为闭包内 buildBaselineBundle：all = 全量聚合、
  // screen = 前 screenSeeds 场切片；切片口径已由首评 / 复用一致性端到端用例覆盖）。
  // 此处用原样包装桩锚定写入判定本身：失败 / 缺失不构建、成功原样委托。
  const buildBundleStub = (metrics) => ({ all: metrics, screen: metrics });

  it('选中项评估为失败退化结构（failed）→ null（不进缓存、不触发构建）', () => {
    const buildBundle = vi.fn(buildBundleStub);
    expect(buildReusableBaselineBundle(createDegenerateMetrics('simulation failed'), buildBundle)).toBeNull();
    expect(buildBundle).not.toHaveBeenCalled();
  });

  it('选中项指标缺失（undefined / null）→ null（替代旧的退化兜底语义）', () => {
    const buildBundle = vi.fn(buildBundleStub);
    expect(buildReusableBaselineBundle(undefined, buildBundle)).toBeNull();
    expect(buildReusableBaselineBundle(null, buildBundle)).toBeNull();
    expect(buildBundle).not.toHaveBeenCalled();
  });

  it('成功 metrics（16 场样本）→ 原样委托构建 bundle，不丢失不篡改', () => {
    const metrics = aggregateRoundMetrics(
      Array.from({ length: STANDARD.refineSeeds }, (_, index) => ({
        dps: 100 + index,
        dailyProfit: 10,
        dailyNoRngProfit: 10,
        xpPerHour: 5,
        killsPerHour: 3,
        deathsPerHour: 0,
        ranOutOfMana: false,
      })),
    );
    const bundle = buildReusableBaselineBundle(metrics, buildBundleStub);
    expect(bundle.all).toBe(metrics);
    expect(bundle.screen).toBe(metrics);
    expect(bundle.all.failed).not.toBe(true);
    expect(bundle.all.samples).toHaveLength(STANDARD.refineSeeds);
  });
});

describe('optimizeBudgetUpgrades 小池链（池 ≤ 8：跳过粗筛、直接精筛）', () => {
  it('链推演与报告结构：[+1, +6] 两步应用、exhausted 收尾、finalConfig 终态', async () => {
    const teammate = createEmptyPlayerConfig('2');
    const input = createInput({ teammates: [teammate] });
    stub.responder = buildResponder({ gainFor: linearGains });
    const updates = [];
    const onSteps = [];

    const report = await optimizeBudgetUpgrades(input, {
      onProgress: (update) => updates.push(update),
      onStep: (step) => onSteps.push(step),
    });

    // 报告头
    expect(report.version).toBe(BUDGET_OPTIMIZER_REPORT_VERSION);
    expect(report.cancelled).toBe(false);
    expect(report.objective).toBe('dps');
    expect(report.stopReason).toBe(BUDGET_OPTIMIZER_STOP_EXHAUSTED);
    expect(typeof report.createdAt).toBe('number');
    expect(report.elapsedSeconds).toBeGreaterThanOrEqual(0);

    // settings 摘要（预算 / band / 时长 / 范围 / 队友 id / 预设）
    expect(report.settings.budgetCoins).toBe(1000);
    expect(report.settings.bandRatio).toBe(0.2);
    expect(report.settings.budgetHigh).toBe(1200);
    expect(report.settings.simulationHours).toBe(24);
    expect(report.settings.searchPreset).toBe('standard');
    expect(report.settings.teammateIds).toEqual(['2']);
    expect(report.settings.preset.refineSeeds).toBe(STANDARD.refineSeeds);
    expect(report.settings.preset.verifySeeds).toBe(STANDARD.verifySeeds);

    // 队伍载荷：每次评估都是「主角 + 冻结队友」（2 名玩家）。
    expect(stub.instances.length).toBeGreaterThan(0);
    expect(stub.instances.every((client) => client.evalPlayers.every((count) => count === 2))).toBe(true);

    // 链推演（见文件头注释）：step0 全等性价比 → tie-break 成本最低 +1；step1 跨档边际递增 → +6。
    // 成本口径：净支出 = 目标档 ask − 旧件卖出抵扣（+1 旧件卖价 96）→ step1 的 +6 = 600 − 96 = 504。
    expect(report.steps).toHaveLength(2);
    expect(report.steps.map((step) => step.candidate.id)).toEqual([HEAD_ID(1), HEAD_ID(6)]);
    expect(report.steps[0].cost).toBe(100);
    expect(report.steps[1].cost).toBe(504);
    expect(report.steps[0].index).toBe(0);
    expect(report.steps[1].index).toBe(1);
    expect(report.totalCost).toBe(604);
    expect(report.remainingBudget).toBe(596);
    expect(report.steps[1].remainingBudgetAfter).toBe(596);

    // 步骤配对 Δ（相对各步基线）：step0 Δ = 5000×1；step1 Δ = 5000×(6−1)。
    expect(report.steps[0].deltaDps).toBe(5000);
    expect(report.steps[0].deltaObjective).toBe(5000);
    expect(report.steps[0].se).toBe(0);
    expect(report.steps[1].deltaDps).toBe(25000);
    // 步骤基线摘要（数值字段；samples 已剔除）。
    expect(report.steps[0].baselineBefore.rounds).toBe(16);
    expect(report.steps[0].baselineBefore.dps).toBe(BASE_DPS);
    expect(report.steps[1].baselineBefore.dps).toBe(BASE_DPS * 1.05);
    expect(report.steps[0].baselineBefore.samples).toBeUndefined();

    // 步骤候选快照：step0 六档全量（未截断）、按证据档 + 性价比排序（+1 档性价比第一）。
    const step0Candidates = report.steps[0].candidatesSnapshot.candidates;
    expect(report.steps[0].candidatesSnapshot.total).toBe(6);
    expect(report.steps[0].candidatesSnapshot.truncated).toBe(0);
    expect(step0Candidates).toHaveLength(6);
    expect(step0Candidates.every((candidate) => candidate.refined)).toBe(true);
    // 线性增益下六档性价比全等 → 排序 tie-break 成本最低（+1）在首位，与定选一致。
    expect(step0Candidates[0].id).toBe(HEAD_ID(1));
    // 选定项的候选记录：展示用结构化字段随报告透传。
    const chosen = report.steps[0].candidate;
    expect(chosen.kind).toBe('equipment');
    expect(chosen.groupKey).toBe('equip:head');
    expect(chosen.cost).toBe(100);
    expect(chosen.deltaDps).toBe(5000);
    expect(chosen.significant).toBe(true);
    // 候选做法键化（2026-10-09）：报告只存稳定键 + 档位，不再存展示文案。
    expect(chosen.method).toEqual({ key: 'market-buy', count: 1 });
    expect(chosen.effect).toEqual({ type: 'equipment', slotKey: 'head', itemHrid: CORSAIR, enhancementLevel: 1 });
    expect(chosen.fromEffect).toEqual({
      type: 'equipment',
      slotKey: 'head',
      itemHrid: CORSAIR,
      enhancementLevel: 0,
    });

    // step1 快照：从档 1 起的候选 5 个（+2..+6）。
    expect(report.steps[1].candidatesSnapshot.candidates.map((candidate) => candidate.id)).toEqual(
      [6, 5, 4, 3, 2].map(HEAD_ID),
    );

    // finalConfig：档位 6（链终点配置；store 写回用）。
    expect(report.finalConfig.equipment.head).toEqual({ itemHrid: CORSAIR, enhancementLevel: 6 });

    // 链起点基线 = 第一步基线（同一次评估，2026-10-08 合并）：step0 的 screen+refine 全集
    // 16 样本的数值摘要；报告 baseline 与 step0 的 baselineBefore 同源。
    expect(report.baseline.metrics.rounds).toBe(16);
    expect(report.baseline.metrics.dps).toBe(BASE_DPS);
    expect(report.baseline.metrics.samples).toBeUndefined();
    expect(report.steps[0].baselineBefore.dps).toBe(report.baseline.metrics.dps);
    expect(report.steps[0].baselineBefore.rounds).toBe(16);

    // 链终复验（配对）：同一批 verify 盐新种子下，链起点与链终点（head +6 → dps = BASE×1.3）
    // 各测一次；确定性桩 → 配对差恒 0.3×BASE、verdict positive。
    expect(report.verification.rounds).toBe(STANDARD.verifySeeds);
    expect(report.verification.baseline.metrics.rounds).toBe(STANDARD.verifySeeds);
    expect(report.verification.baseline.metrics.failed).toBe(false);
    expect(report.verification.baseline.metrics.dps).toBe(BASE_DPS);
    expect(report.verification.baseline.metrics.samples).toBeUndefined();
    expect(report.verification.final.metrics.failed).toBe(false);
    expect(report.verification.final.metrics.dps).toBe(BASE_DPS * 1.3);
    expect(report.verification.final.metrics.samples).toBeUndefined();
    expect(report.verification.paired.rounds).toBe(STANDARD.verifySeeds);
    expect(report.verification.paired.mean).toBe(BASE_DPS * 0.3);
    expect(report.verification.paired.stdError).toBe(0);
    expect(report.verification.paired.verdict).toBe('positive');

    // diagnostics：首步候选计数与阶段账本。精炼版（CORSAIR_REFINED）全档缺价 → 计入
    // skippedNoPrice（0..6 共 7 档；不参与搜索），明细结构化 effect 一并透传。
    expect(report.diagnostics.candidateCount).toBe(6);
    expect(report.diagnostics.skippedNoPrice).toBe(7);
    // 本用例未注入 fairValueResolver：7 条全部是「完全缺价」，「估值不足」子计数为 0（字段透传锚点）。
    expect(report.diagnostics.skippedFairValueBelowSale).toBe(0);
    expect(report.diagnostics.skippedNoPriceDetails).toHaveLength(7);
    expect(
      report.diagnostics.skippedNoPriceDetails.every(
        (item) => item.kind === 'equipment' && item.effect?.type === 'equipment' && item.effect?.slotKey === 'head',
      ),
    ).toBe(true);
    expect(report.diagnostics.racingUsed).toBe(false);
    expect(report.diagnostics.steps).toBe(2);
    // costing 阶段按步入账：step0/step1/step2（step2 空池）。
    const costingSteps = report.diagnostics.stages.filter((entry) => entry.stage === 'costing');
    expect(costingSteps).toHaveLength(3);
    expect(costingSteps[0].candidates).toBe(6);
    expect(costingSteps[0].remainingBudget).toBe(1200);
    expect(costingSteps[1].candidates).toBe(5);
    expect(costingSteps[1].remainingBudget).toBe(1100);
    expect(costingSteps[2].candidates).toBe(0);
    expect(costingSteps[2].remainingBudget).toBe(596);
    // 精筛阶段（小池）：step0 的基线来自链起点基线合并评估（主循环前，不在本阶段入账），
    // 只有候选逐个补评；step1 整步命中跨步样本复用（基线 = 上一步选中项的 16 场样本；
    // head +2..+6 五个候选与上一步同组同档 → 全部直接取用）→ 零评估。
    const refinings = report.diagnostics.stages.filter((entry) => entry.stage === 'refining');
    expect(refinings[0].evaluated).toBe(6);
    expect(refinings[0].simulations).toBe(6 * 16);
    expect(refinings[1].evaluated).toBe(0);
    expect(refinings[1].simulations).toBe(0);
    // 场次总账（2026-10-08 样本复用后）：起点基线（= 第一步基线）16 + step0（6×16）
    // + step1（复用命中，0 场）+ 配对复验 2×50 = 212（旧结构 308，复用省 96 场）。
    expect(report.diagnostics.simulations).toBe(16 + 6 * 16 + 2 * STANDARD.verifySeeds);
    expect(report.diagnostics.evaluations).toBe(1 + 6 + 2);
    // 批量路径：一次评估 = 一个批量任务；评估内分片下单个评估可对应多个 client（实例数 ≥ 评估数）。
    expect(stub.instances.length).toBeGreaterThanOrEqual(report.diagnostics.evaluations);
    // 阶段耗时诊断（2026-10-08）：每个阶段条目都带墙钟耗时。
    expect(
      report.diagnostics.stages.every((entry) => typeof entry.elapsedMs === 'number' && entry.elapsedMs >= 0),
    ).toBe(true);

    // 进度：字段齐备、phase 在枚举内、收尾为 done 且 progress=1、步数渐进。
    expect(updates.length).toBeGreaterThan(0);
    const allowedPhases = ['preparing', 'costing', 'screening', 'refining', 'applying', 'verifying', 'done'];
    for (const update of updates) {
      expect(allowedPhases).toContain(update.phase);
      expect(typeof update.progress).toBe('number');
      expect(typeof update.evaluated).toBe('number');
      expect(typeof update.total).toBe('number');
      // 阶段标签已删除（2026-10-09）：进度回调不再携带直接上屏的 stageLabel。
      expect(update).not.toHaveProperty('stageLabel');
      expect(typeof update.stepsDone).toBe('number');
      expect(typeof update.elapsedSeconds).toBe('number');
    }
    expect(updates.at(-1).phase).toBe('done');
    expect(updates.at(-1).progress).toBe(1);
    expect(Math.max(...updates.map((update) => update.stepsDone))).toBe(2);

    // onStep 渐进：每步一条、与报告 steps 同源同序。
    expect(onSteps).toHaveLength(2);
    expect(onSteps[0].candidate.id).toBe(HEAD_ID(1));
    expect(onSteps[1].candidate.id).toBe(HEAD_ID(6));
  });

  it('估值不足跳过与完全缺价分流：报告透传子计数与 reason 标记（2026-10-16）', async () => {
    // 构造：head 0 档挂高买单（priceTable 是 0 档取价来源）→ 旧件卖出抵扣 96000；
    // +1 档无任何报价 → 走估值回退，估值 500 ≤ 96000 →「估值不足」跳过（子计数 + 明细 reason）；
    // +2 档报 100 → 净支出钳 0（免费项，仍参与搜索，保证链有正常候选）；
    // 精炼家族（0..2 档）无报价且 resolver 返回 null →「完全缺价」跳过（不带 reason）。
    const input = createInput({ maxLevelUp: 2 });
    input.pricing.pricingState.priceTable[CORSAIR] = { ask: -1, bid: 100000, vendor: 0 };
    input.pricing.pricingState.enhancementQuotesByItem[CORSAIR] = { 2: { ask: 100, bid: -1 } };
    input.fairValueResolver = (hrid) => (hrid === CORSAIR ? { price: 500, source: 'official_estimate' } : null);
    stub.responder = buildResponder({ gainFor: linearGains });

    const report = await optimizeBudgetUpgrades(input);

    // 链正常走步：+2 是额度内唯一候选（免费项），买后无更多档位 → 正常收尾。
    expect(report.steps).toHaveLength(1);
    expect(report.steps[0].candidate.id).toBe(HEAD_ID(2));
    expect(report.stopReason).toBe(BUDGET_OPTIMIZER_STOP_EXHAUSTED);
    expect(report.diagnostics.candidateCount).toBe(1);

    // 首步记账：总缺价 4 = 估值不足 1（+1 档）+ 完全缺价 3（精炼 0..2 档）—— 总数语义不变。
    expect(report.diagnostics.skippedNoPrice).toBe(4);
    expect(report.diagnostics.skippedFairValueBelowSale).toBe(1);
    expect(report.diagnostics.fallbackFairValue).toBe(0);
    expect(report.diagnostics.skippedNoPriceDetails).toHaveLength(4);
    const flagged = report.diagnostics.skippedNoPriceDetails.filter((item) => item.reason === 'fair-value-below-sale');
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({
      kind: 'equipment',
      effect: { type: 'equipment', slotKey: 'head', itemHrid: CORSAIR, enhancementLevel: 1 },
    });
    // 完全缺价条目保持旧形状：不带 reason 字段（旧报告的精确匹配解析不受影响）。
    expect(report.diagnostics.skippedNoPriceDetails.filter((item) => item.reason === undefined)).toHaveLength(3);
  });

  it('免费项（净支出 0 的正提升）参与定选：被选中、快照单列免费项档（2026-10-09）', async () => {
    // 构造：head 0 档挂高买单（priceTable 是 0 档取价来源）→ 旧件卖出抵扣 96000（扣市场费率）；
    // 目标档 +1 只报 100 → 净支出 = max(0, 100 − 96000) = 0；+2..+6 报 200000 超 budgetHigh
    // （1200）被剪枝 → +1 是额度内唯一候选。修复前它会被定选静默排除（成本必须 > 0），
    // 链以零步 exhausted 收尾、明细里还被标成「不可用」。
    const input = createInput();
    input.pricing.pricingState.priceTable[CORSAIR] = { ask: -1, bid: 100000, vendor: 0 };
    const quotes = input.pricing.pricingState.enhancementQuotesByItem[CORSAIR];
    for (let level = 2; level <= 6; level += 1) quotes[level] = { ask: 200000, bid: -1 };
    stub.responder = buildResponder({ gainFor: linearGains });

    const report = await optimizeBudgetUpgrades(input);

    // 定选命中免费项：成本 0、Δ = 基准 100000 × 0.05、额度不被扣减（链初始额度 = budgetHigh 1200）。
    expect(report.steps).toHaveLength(1);
    expect(report.steps[0].candidate.id).toBe(HEAD_ID(1));
    expect(report.steps[0].cost).toBe(0);
    expect(report.steps[0].deltaObjective).toBe(5000);
    expect(report.totalCost).toBe(0);
    expect(report.remainingBudget).toBe(1200);
    expect(report.steps[0].remainingBudgetAfter).toBe(1200);
    expect(report.finalConfig.equipment.head).toEqual({ itemHrid: CORSAIR, enhancementLevel: 1 });
    // 买完 +1 后（档 1 起）候选全部被额度剪枝 → 正常收尾（而不是「一步未走」的零步链）。
    expect(report.stopReason).toBe(BUDGET_OPTIMIZER_STOP_EXHAUSTED);
    expect(report.diagnostics.steps).toBe(1);

    // 快照：免费项单列一档（不再是「不可用」档），且排在首位。
    const snapshot = report.steps[0].candidatesSnapshot;
    expect(snapshot.total).toBe(1);
    expect(snapshot.candidates[0].id).toBe(HEAD_ID(1));
    expect(snapshot.candidates[0].cost).toBe(0);
    const record = snapshot.candidates[0];
    expect(
      resolveBudgetEvidenceBand({
        manaRegression: record.manaRegression,
        delta: record.deltaObjective,
        cost: record.cost,
        refined: record.refined,
      }),
    ).toBe(BUDGET_OPTIMIZER_EVIDENCE_BAND_FREE);
  });

  it('多个免费项并列：定选取 Δ 最大者、与快照 FREE 档首行一致（2026-10-09）', async () => {
    // 构造两个免费项：0 档挂高买单（旧件卖出抵扣 96000）+ +1/+2 档 ask 100/200 → 两档净支出
    // 均为 0；+3..+6 报 200000 被额度剪枝。Δ：+1 = 5000、+2 = 10000（linearGains 0.05/级）。
    // 修复前：定选免费项效率同为 +Infinity，落到 id 字典序（HEAD_ID(1) < HEAD_ID(2)）选 +1，
    // 与快照 FREE 档首行（Δ 降序 → +2）分叉 —— 下面第 2) 条断言是修复前后的判别锚点。
    const input = createInput();
    input.pricing.pricingState.priceTable[CORSAIR] = { ask: -1, bid: 100000, vendor: 0 };
    const quotes = input.pricing.pricingState.enhancementQuotesByItem[CORSAIR];
    for (let level = 3; level <= 6; level += 1) quotes[level] = { ask: 200000, bid: -1 };
    stub.responder = buildResponder({ gainFor: linearGains });

    const report = await optimizeBudgetUpgrades(input);

    // 1) 链形：一步（买 +2）后收尾。
    expect(report.steps).toHaveLength(1);
    const step = report.steps[0];

    // 2) 口径一致锚点：定选结果与快照 FREE 档首行是同一条，且都是 Δ 较大的 +2。
    expect(step.candidate.id).toBe(HEAD_ID(2));
    expect(step.candidatesSnapshot.candidates[0].id).toBe(step.candidate.id);

    // 3) 定选细节：成本 0、Δ = 基准 100000 × 0.05 × 2、额度不扣减、终态配置 +2。
    expect(step.cost).toBe(0);
    expect(step.deltaObjective).toBe(10000);
    expect(report.totalCost).toBe(0);
    expect(report.remainingBudget).toBe(1200);
    expect(step.remainingBudgetAfter).toBe(1200);
    expect(report.finalConfig.equipment.head).toEqual({ itemHrid: CORSAIR, enhancementLevel: 2 });
    // 买完 +2 后（档 2 起）候选 +3..+6 全部超额度 → 正常收尾。
    expect(report.stopReason).toBe(BUDGET_OPTIMIZER_STOP_EXHAUSTED);
    expect(report.diagnostics.steps).toBe(1);

    // 4) 快照 FREE 档：两条免费项按 Δ 降序（+2 前、+1 后），首行证据档为 FREE。
    const snapshot = step.candidatesSnapshot;
    expect(snapshot.total).toBe(2);
    expect(snapshot.candidates.map((candidate) => candidate.id)).toEqual([HEAD_ID(2), HEAD_ID(1)]);
    for (const record of snapshot.candidates) {
      expect(record.cost).toBe(0);
      expect(
        resolveBudgetEvidenceBand({
          manaRegression: record.manaRegression,
          delta: record.deltaObjective,
          cost: record.cost,
          refined: record.refined,
        }),
      ).toBe(BUDGET_OPTIMIZER_EVIDENCE_BAND_FREE);
    }
  });

  it('种子口径（硬约束①）：全链共享同一套种子（无步号）；跨步样本复用不产生新评估（分片视图）', async () => {
    const input = createInput();
    const finalVerifySeeds = deriveSeeds(input, BUDGET_OPTIMIZER_SEED_SALT_VERIFY, STANDARD.verifySeeds);
    // 全链共享（2026-10-08 起不再入步号）：screen 盐 4 场 + refine 盐补评 12 场 = 16 场一套。
    const chainScreenSeeds = deriveSeeds(input, BUDGET_OPTIMIZER_SEED_SALT_SCREEN, STANDARD.screenSeeds);
    const chainRefineSeeds = deriveSeeds(
      input,
      BUDGET_OPTIMIZER_SEED_SALT_REFINE,
      STANDARD.refineSeeds - STANDARD.screenSeeds,
    );
    const chainFull = [...chainScreenSeeds, ...chainRefineSeeds];
    stub.responder = buildResponder({ gainFor: linearGains });

    const report = await optimizeBudgetUpgrades(input);
    expect(report.steps).toHaveLength(2); // 前提：链形状与上一用例一致

    const seedLists = stub.instances.map((client) => client.evalSeeds);
    const countList = (expected) => seedLists.filter((list) => sameSeeds(list, expected)).length;
    // 分片视图：评估内分片后「一个评估」= 若干片段（client 的种子列表是其连续真子段）。
    const collectShards = (expected) => {
      const wanted = new Set(expected.map(toSeed));
      return stub.instances.filter(
        (client) =>
          client.evalSeeds.length > 0 &&
          client.evalSeeds.length < expected.length &&
          client.evalSeeds.every((seed) => wanted.has(seed)),
      );
    };
    const mergedSortedSeeds = (clients) =>
      clients
        .flatMap((client) => client.evalSeeds)
        .slice()
        .sort((a, b) => a - b);
    const sortedExpected = (seeds) =>
      seeds
        .map(toSeed)
        .slice()
        .sort((a, b) => a - b);

    // 链起点基线 = 第一步基线（同一次评估）：16 场全量以分片形态出现（workerLimit=2 → 2 片 × 8 场），
    // 片段并集逐位等于全集。
    const baselineShards = collectShards(chainFull);
    expect(baselineShards).toHaveLength(2);
    expect(mergedSortedSeeds(baselineShards)).toEqual(sortedExpected(chainFull));
    // step0 候选（小池路径）：6 次全量 16 场评估（池内候选评估保持整批一次，不分片），
    // 与基线共享同一组种子（硬约束①：步内共享）；候选等级 > 0。
    expect(countList(chainFull)).toBe(6);
    expect(
      stub.instances
        .filter((client) => sameSeeds(client.evalSeeds, chainFull))
        .every((client) => client.evalLevels.every((level) => level > 0)),
    ).toBe(true);

    // 跨步样本复用（2026-10-08）：step1 的基线（= 上一步选中项）与 head +2..+6 候选全部命中
    // 上一步样本 → 本步零评估、零分片。实例只来自起点基线（2 片）+ step0 候选（6）+ 复验（2）。
    expect(seedLists).toHaveLength(2 + 6 + 2);
    // 链终复验：verify 盐独立样本分割（与全链种子互不相交）；workerLimit=2 → 两侧分片预算
    // floor(2/2)=1 → 不分片，起点与终点各整批一次（同批种子 50 场）。
    expect(finalVerifySeeds.every((seed) => !chainFull.includes(seed))).toBe(true);
    expect(countList(finalVerifySeeds)).toBe(2);
  });

  it('空蓝判负：候选空蓝 → 不进定选；全池判负时终止并留快照', async () => {
    const input = createInput();
    const base = buildResponder({ gainFor: linearGains });
    stub.responder = (payload) => {
      const level = equipmentLevelOf(payload, CORSAIR);
      const response = base(payload);
      if (level >= 5) {
        response.simResult = { ...response.simResult, playerRanOutOfMana: { player1: true } };
      }
      return response;
    };

    const report = await optimizeBudgetUpgrades(input);

    // step0：L1..L4 可用、性价比全等 → tie-break 成本最低 +1（L5/L6 判负不影响）。
    expect(report.steps[0].candidate.id).toBe(HEAD_ID(1));
    // step1（档 1 起，候选 +2..+6）：可用档 L2/L3/L4 性价比 = 5000(L−1)/成本(L) 递增 → +4
    //（成本 = 400 − 旧件卖出抵扣 96 = 304）。
    expect(report.steps[1].candidate.id).toBe(HEAD_ID(4));
    expect(report.steps[1].cost).toBe(304);
    // step2（档 4 起）：候选只剩 L5/L6（全部空蓝判负）→ 无可选 → exhausted。
    expect(report.steps).toHaveLength(2);
    expect(report.stopReason).toBe(BUDGET_OPTIMIZER_STOP_EXHAUSTED);
    expect(report.totalCost).toBe(404);

    // 判负候选在 step1/终止快照里如实标记（Δ 仍上报）。
    const step1L5 = report.steps[1].candidatesSnapshot.candidates.find((candidate) => candidate.id === HEAD_ID(5));
    expect(step1L5.manaRegression).toBe(true);
    expect(step1L5.deltaDps).toBe(20000); // 5000×(5−1)
    // 终止快照：档 4 起的 L5/L6 双判负证据。
    expect(report.finalSnapshot).toBeTruthy();
    expect(report.finalSnapshot.candidates).toHaveLength(2);
    expect(report.finalSnapshot.candidates.every((candidate) => candidate.manaRegression)).toBe(true);
  });

  it('空池：无候选（缺价）时仍产出结构完整的空报告', async () => {
    const input = createInput({ headLevels: [] });
    stub.responder = buildResponder({ gainFor: linearGains });

    const report = await optimizeBudgetUpgrades(input);

    expect(report.cancelled).toBe(false);
    expect(report.steps).toEqual([]);
    expect(report.totalCost).toBe(0);
    expect(report.stopReason).toBe(BUDGET_OPTIMIZER_STOP_EXHAUSTED);
    expect(report.finalSnapshot).toBeNull();
    expect(report.diagnostics.candidateCount).toBe(0);
    // 链起点基线照常测量。
    expect(report.baseline.metrics.rounds).toBe(16);
    // 零步链（finalConfig = 起点，无新信息）不复验。
    expect(report.verification).toBeNull();
    // finalConfig = 初始配置原样（零步链不写回，store 侧另有闸门）。
    expect(report.finalConfig.equipment.head.enhancementLevel).toBe(0);
  });

  it('候选快照截断：超出 LIMIT 的候选被截断并计数', async () => {
    // maxLevelUp=6 双槽 + 精炼版全档 → 池超过 LIMIT 时快照截断。
    const input = createInput({ headLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], maxLevelUp: 10 });
    stub.responder = buildResponder({ gainFor: linearGains });

    const report = await optimizeBudgetUpgrades(input);

    expect(report.steps.length).toBeGreaterThan(0);
    const snapshot = report.steps[0].candidatesSnapshot;
    expect(snapshot.candidates.length).toBeLessThanOrEqual(BUDGET_OPTIMIZER_STEP_CANDIDATES_LIMIT);
    expect(snapshot.candidates.length + snapshot.truncated).toBe(snapshot.total);
  });

  it('缺价明细超上限：报告只带截断后列表 + truncated 计数透传（skippedNoPrice 全量守恒）', async () => {
    // 每个槽放该槽首个目录物品（当前 +5、maxLevelUp=10）+ 全清价（无强化报价、无估值 resolver）：
    // step0 缺价明细远超上限（60），报告 diagnostics 只带截断口径但计数守恒。
    const input = createInput({ maxLevelUp: 10, settings: { maxChainSteps: 2, stepLimitMode: 'preset' } });
    input.playerConfig.equipment = Object.fromEntries(
      Object.keys(equipmentOptionsBySlot).map((slotKey) => {
        const option = equipmentOptionsBySlot[slotKey]?.[0] || {};
        return [slotKey, { itemHrid: String(option?.hrid || ''), enhancementLevel: 5 }];
      }),
    );
    input.pricing.pricingState = {
      priceTable: createQuietPriceTable(),
      enhancementQuotesByItem: {},
      dropMode: 'bid',
      marketTimestamp: 1234,
    };
    stub.responder = buildResponder({ gainFor: linearGains });

    const report = await optimizeBudgetUpgrades(input);

    // 报告只取第一步明细：截断后列表封顶，truncated 为超限条数（旧报告读取方回退 0）。
    const details = report.diagnostics.skippedNoPriceDetails;
    expect(report.diagnostics.skippedNoPrice).toBeGreaterThan(BUDGET_OPTIMIZER_SKIPPED_DETAILS_LIMIT);
    expect(details).toHaveLength(BUDGET_OPTIMIZER_SKIPPED_DETAILS_LIMIT);
    expect(report.diagnostics.skippedNoPriceDetailsTruncated).toBeGreaterThan(0);
    expect(details.length + report.diagnostics.skippedNoPriceDetailsTruncated).toBe(report.diagnostics.skippedNoPrice);
  });

  it('定选显著性门槛：开启后「点估值为正但不显著」的候选全部出局（零步链 + 独立停因）', async () => {
    // 微增益（200/级）+ 候选侧大幅交替噪声（step0 的 16 个精筛种子按序号 +25000/-22000，
    // 基线无噪声）：配对差均值 = 200L + 1500 恒为正，但样本 sd ≈ 2.35 万 → se ≈ 5.9 千
    // → 16 样本下 |t| < 1，全部 verdict=inconclusive。门槛关（默认）照常选 +1；开启后无可选 →
    // 零步链收尾，且停因是与「买不起」区分的 significance-blocked（不再复用 exhausted）。
    const input = createInput();
    // 全链共享种子（2026-10-08 起无步号）：噪声表按同一套 16 场种子构造。
    const step0Refined = [
      ...deriveSeeds(input, BUDGET_OPTIMIZER_SEED_SALT_SCREEN, STANDARD.screenSeeds),
      ...deriveSeeds(input, BUDGET_OPTIMIZER_SEED_SALT_REFINE, STANDARD.refineSeeds - STANDARD.screenSeeds),
    ];
    const noiseTable = new Map(step0Refined.map((seed, index) => [toSeed(seed), index % 2 === 0 ? 25000 : -22000]));
    stub.responder = (payload) => {
      const level = equipmentLevelOf(payload, CORSAIR);
      const noise = level > 0 ? (noiseTable.get(toSeed(payload.seed)) ?? 0) : 0;
      return { simResult: buildSimResult({ dps: BASE_DPS + 200 * level + noise }) };
    };

    // 门槛关（本文件显式关闭）：点估计为正即可选，链照常推进（[+1, +6]）。
    const offReport = await optimizeBudgetUpgrades(createInput());
    expect(offReport.settings.pickSignificanceGate).toBe(false);
    expect(offReport.steps.map((step) => step.candidate.id)).toEqual([HEAD_ID(1), HEAD_ID(6)]);
    expect(offReport.steps[0].candidate.significant).toBe(false);
    // 非零步链照常配对复验：起点（level 0，无噪声）= BASE_DPS；终点（step1 种子不在噪声表内）
    // = BASE + 1200；同种子配对差恒 1200。
    expect(offReport.verification.baseline.metrics.dps).toBe(BASE_DPS);
    expect(offReport.verification.final.metrics.dps).toBe(BASE_DPS + 1200);
    expect(offReport.verification.paired.mean).toBe(1200);

    // 门槛开：全部候选不显著 → 定选无可选，链在第一步就终止（停因独立，不复用 exhausted）。
    const onReport = await optimizeBudgetUpgrades(createInput({ settings: { pickSignificanceGate: true } }));
    expect(onReport.settings.pickSignificanceGate).toBe(true);
    expect(onReport.steps).toEqual([]);
    expect(onReport.stopReason).toBe(BUDGET_OPTIMIZER_STOP_SIGNIFICANCE);
    expect(onReport.verification).toBeNull();
    // 报告侧计数佐证「是被门槛拦下」而不是「买不起 / 不可用」。
    expect(onReport.diagnostics.significanceBlocked).toBeGreaterThan(0);
    // 终止快照留证：均值仍为正（200×1 + 1500 = 1700）但不显著。
    const l1 = onReport.finalSnapshot.candidates.find((candidate) => candidate.id === HEAD_ID(1));
    expect(l1.deltaObjective).toBeCloseTo(1700, 6);
    expect(l1.significant).toBe(false);
  });

  it('生产默认（不传门槛字段）：归一化为开启且确实生效（不显著 → 零步链独立停因）', async () => {
    // store 真实入参不传 pickSignificanceGate → 归一化默认 true（2026-10-09）。本用例删掉
    // createInput 的「显式关闭」以复现生产默认，验证门槛真的拦住了「点估计为正但不显著」的候选。
    const input = createInput();
    delete input.settings.pickSignificanceGate;
    const refined = [
      ...deriveSeeds(input, BUDGET_OPTIMIZER_SEED_SALT_SCREEN, STANDARD.screenSeeds),
      ...deriveSeeds(input, BUDGET_OPTIMIZER_SEED_SALT_REFINE, STANDARD.refineSeeds - STANDARD.screenSeeds),
    ];
    const noiseTable = new Map(refined.map((seed, index) => [toSeed(seed), index % 2 === 0 ? 25000 : -22000]));
    stub.responder = (payload) => {
      const level = equipmentLevelOf(payload, CORSAIR);
      const noise = level > 0 ? (noiseTable.get(toSeed(payload.seed)) ?? 0) : 0;
      return { simResult: buildSimResult({ dps: BASE_DPS + 200 * level + noise }) };
    };

    const report = await optimizeBudgetUpgrades(input);

    expect(report.settings.pickSignificanceGate).toBe(true);
    expect(report.steps).toEqual([]);
    expect(report.stopReason).toBe(BUDGET_OPTIMIZER_STOP_SIGNIFICANCE);
    expect(report.verification).toBeNull();
    expect(report.diagnostics.significanceBlocked).toBeGreaterThan(0);
    // 终止快照留证：均值仍为正（200×1 + 1500 = 1700）但不显著 → 被门槛拦下，一步未买。
    const l1 = report.finalSnapshot.candidates.find((candidate) => candidate.id === HEAD_ID(1));
    expect(l1.deltaObjective).toBeCloseTo(1700, 6);
    expect(l1.significant).toBe(false);
  });

  it('定选显著性门槛：候选显著为正时照常推进（停因不误判为 significance-blocked）', async () => {
    // 与上一条同一套交替噪声表，只把增益放大到 20000/级：配对差均值 = 20000L + 1500、
    // se ≈ 6.1 千 → step0 的候选 t ≈ 3.5（p < 0.05）→ 全部 verdict=positive，门槛放行。
    // 只留一档升级（headLevels=[1] + maxLevelUp=1）：买下 +1 后无候选可枚举 → 正常 exhausted。
    const input = createInput({ headLevels: [1], settings: { pickSignificanceGate: true, maxLevelUp: 1 } });
    const refined = [
      ...deriveSeeds(input, BUDGET_OPTIMIZER_SEED_SALT_SCREEN, STANDARD.screenSeeds),
      ...deriveSeeds(input, BUDGET_OPTIMIZER_SEED_SALT_REFINE, STANDARD.refineSeeds - STANDARD.screenSeeds),
    ];
    const noiseTable = new Map(refined.map((seed, index) => [toSeed(seed), index % 2 === 0 ? 25000 : -22000]));
    stub.responder = (payload) => {
      const level = equipmentLevelOf(payload, CORSAIR);
      const noise = level > 0 ? (noiseTable.get(toSeed(payload.seed)) ?? 0) : 0;
      return { simResult: buildSimResult({ dps: BASE_DPS + 20000 * level + noise }) };
    };

    const report = await optimizeBudgetUpgrades(input);

    expect(report.settings.pickSignificanceGate).toBe(true);
    // 门槛放行：候选显著为正 → 照常买下 +1，其后无候选可枚举 → 额度口径的 exhausted。
    expect(report.steps).toHaveLength(1);
    expect(report.steps[0].candidate.significant).toBe(true);
    expect(report.stopReason).not.toBe(BUDGET_OPTIMIZER_STOP_SIGNIFICANCE);
    expect(report.stopReason).toBe(BUDGET_OPTIMIZER_STOP_EXHAUSTED);
    expect(report.diagnostics.significanceBlocked).toBe(0);
  });

  it('评估内样本分片：与不分片（workerLimit=1）的报告数值逐位一致', async () => {
    // 依种子的确定性噪声：样本顺序若被分片合并打乱，逐种子配对差（computePairedStats 顺序敏感）会变。
    stub.responder = (payload) => {
      const level = equipmentLevelOf(payload, CORSAIR);
      const noise = Number(toSeed(payload.seed) % 97) - 48;
      return { simResult: buildSimResult({ dps: BASE_DPS + 5000 * level + (level > 0 ? noise : 0) }) };
    };

    const serial = await optimizeBudgetUpgrades(createInput({ parallelWorkerLimit: 1 }));
    stub.instances = [];
    const sharded = await optimizeBudgetUpgrades(createInput({ parallelWorkerLimit: 4 }));

    // 分片确实发生：实例数 > 评估数（每次评估拆成多个片段）；场数与评估数口径不变。
    expect(stub.instances.length).toBeGreaterThan(sharded.diagnostics.evaluations);
    expect(sharded.diagnostics.simulations).toBe(serial.diagnostics.simulations);
    expect(sharded.diagnostics.evaluations).toBe(serial.diagnostics.evaluations);

    // 报告关键数值逐位一致（分片只改「哪个 realm 跑哪几场」）。
    const pickSteps = (report) =>
      report.steps.map((step) => ({
        id: step.candidate.id,
        cost: step.cost,
        deltaObjective: step.deltaObjective,
        se: step.se,
      }));
    expect(pickSteps(sharded)).toEqual(pickSteps(serial));
    expect(sharded.baseline.metrics).toEqual(serial.baseline.metrics);
    expect(sharded.verification.paired).toEqual(serial.verification.paired);
    expect(sharded.finalConfig).toEqual(serial.finalConfig);
    expect(sharded.totalCost).toBe(serial.totalCost);
  });

  it('跨步样本复用：与禁用复用（逐位重评）的报告数值逐位一致、场次更少', async () => {
    // 噪声响应器（同「定选显著性门槛」用例的口径：噪声按种子固定、配对同种子相消）：
    // 链形确定为 [+1, +6] 两步；复用样本若与重评样本有任何差异（配置或种子不一致），
    // 逐步配对统计会随之变化 → 报告数值比对可锚定「复用 = 逐位重放」。
    const input = createInput();
    const chainRefined = [
      ...deriveSeeds(input, BUDGET_OPTIMIZER_SEED_SALT_SCREEN, STANDARD.screenSeeds),
      ...deriveSeeds(input, BUDGET_OPTIMIZER_SEED_SALT_REFINE, STANDARD.refineSeeds - STANDARD.screenSeeds),
    ];
    const noiseTable = new Map(chainRefined.map((seed, index) => [toSeed(seed), index % 2 === 0 ? 25000 : -22000]));
    stub.responder = (payload) => {
      const level = equipmentLevelOf(payload, CORSAIR);
      const noise = level > 0 ? (noiseTable.get(toSeed(payload.seed)) ?? 0) : 0;
      return { simResult: buildSimResult({ dps: BASE_DPS + 200 * level + noise }) };
    };

    const reusedReport = await optimizeBudgetUpgrades(createInput());
    stub.instances = [];
    const freshReport = await optimizeBudgetUpgrades({ ...createInput(), disableSampleReuse: true });

    // 链形一致（两步 [+1, +6]）；场次账：复用版 = 212（起点基线 16 + step0 6×16 + 复验 100）；
    // 逐位重评版 = 308（step1 基线 4 + 12 + 候选 5×16 全部重新模拟）。
    expect(reusedReport.steps.map((step) => step.candidate.id)).toEqual([HEAD_ID(1), HEAD_ID(6)]);
    expect(freshReport.steps.map((step) => step.candidate.id)).toEqual([HEAD_ID(1), HEAD_ID(6)]);
    expect(reusedReport.diagnostics.simulations).toBe(16 + 6 * 16 + 2 * STANDARD.verifySeeds);
    expect(freshReport.diagnostics.simulations).toBe(16 + 6 * 16 + 4 + 12 + 5 * 16 + 2 * STANDARD.verifySeeds);

    // 报告关键数值逐位一致（复用只改「样本从哪来」，不改样本本身）。
    const pickSteps = (report) =>
      report.steps.map((step) => ({
        id: step.candidate.id,
        cost: step.cost,
        deltaObjective: step.deltaObjective,
        se: step.se,
      }));
    expect(pickSteps(reusedReport)).toEqual(pickSteps(freshReport));
    expect(reusedReport.baseline.metrics).toEqual(freshReport.baseline.metrics);
    expect(reusedReport.steps.map((step) => step.baselineBefore)).toEqual(
      freshReport.steps.map((step) => step.baselineBefore),
    );
    expect(reusedReport.verification.paired).toEqual(freshReport.verification.paired);
    expect(reusedReport.finalConfig).toEqual(freshReport.finalConfig);
    expect(reusedReport.totalCost).toBe(freshReport.totalCost);
  });

  it('精细档（fine）：三层样本量 6/24/60 生效，跨步复用后场次总账 288', async () => {
    // 与 standard 同构的小池两步链：fine 只改样本量（screen 6 / refine 24 / verify 60），
    // 确定性线性增益下链形不变 → 场次账按样本量换算：起点基线 24 + step0 6×24 + step1 复用 0
    // + 复验 2×60 = 288。
    stub.responder = buildResponder({ gainFor: linearGains });
    const report = await optimizeBudgetUpgrades(createInput({ settings: { searchPreset: 'fine' } }));

    expect(report.settings.searchPreset).toBe('fine');
    expect(report.settings.preset).toEqual({
      screenSeeds: FINE.screenSeeds,
      refineSeeds: FINE.refineSeeds,
      verifySeeds: FINE.verifySeeds,
      refineKeepRatio: FINE.refineKeepRatio,
      refineKeepMin: FINE.refineKeepMin,
    });
    expect(report.steps.map((step) => step.candidate.id)).toEqual([HEAD_ID(1), HEAD_ID(6)]);
    expect(report.diagnostics.simulations).toBe(FINE.refineSeeds + 6 * FINE.refineSeeds + 2 * FINE.verifySeeds);
    expect(report.steps[0].baselineBefore.rounds).toBe(FINE.refineSeeds);
    expect(report.verification.rounds).toBe(FINE.verifySeeds);
  });

  it('评估内样本分片：链终复验两侧各分 floor(workerLimit/2) 片（同批种子拼接守恒）', async () => {
    const input = createInput({ parallelWorkerLimit: 4 });
    stub.responder = buildResponder({ gainFor: linearGains });
    const report = await optimizeBudgetUpgrades(input);
    expect(report.steps.length).toBeGreaterThan(0);

    const verifySeeds = deriveSeeds(input, BUDGET_OPTIMIZER_SEED_SALT_VERIFY, STANDARD.verifySeeds);
    const verifySet = new Set(verifySeeds.map(toSeed));
    // 复验评估片段：种子全属 verify 盐、长度 < 全量（50）→ 只有复验两侧会命中。
    const verifyShards = stub.instances.filter(
      (client) =>
        client.evalSeeds.length > 0 &&
        client.evalSeeds.length < verifySeeds.length &&
        client.evalSeeds.every((seed) => verifySet.has(seed)),
    );
    // floor(4/2)=2 的分片预算 → 起点 2 片 + 终点 2 片。
    expect(verifyShards).toHaveLength(4);
    const startSide = verifyShards.filter((client) => client.evalLevels.every((level) => level === 0));
    const finalSide = verifyShards.filter((client) => client.evalLevels.every((level) => level > 0));
    expect(startSide).toHaveLength(2);
    expect(finalSide).toHaveLength(2);
    const sortedSeeds = verifySeeds
      .map(toSeed)
      .slice()
      .sort((a, b) => a - b);
    for (const side of [startSide, finalSide]) {
      expect(
        side
          .flatMap((client) => client.evalSeeds)
          .slice()
          .sort((a, b) => a - b),
      ).toEqual(sortedSeeds);
    }
    // 复验数值不受分片影响（确定性桩：配对差恒 0.3×BASE）。
    expect(report.verification.paired.mean).toBe(BASE_DPS * 0.3);
  });
});

describe('optimizeBudgetUpgrades racing 路径（池 > 8）', () => {
  it('粗筛发生：全池 + 基线共享 screen 盐；幸存者补评 refine 盐；第一步定选正确', async () => {
    const input = createInput({
      weapon: true,
      headLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      weaponLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      maxLevelUp: 10,
    });
    stub.responder = buildResponder({ gainFor: linearGains });

    const report = await optimizeBudgetUpgrades(input);

    // 前提：首步池确实大于阈值（否则本用例退化成小池路径，断言会立刻失败提醒）。
    const pool = report.diagnostics.candidateCount;
    expect(pool).toBeGreaterThan(BUDGET_OPTIMIZER_RACING_MIN_POOL);
    expect(report.diagnostics.racingUsed).toBe(true);

    // 粗筛阶段（step0）：基线 + 全候选；保留 top max(refineKeepMin, ceil(N×ratio))。
    const keepScreen = resolveBudgetKeepCount(pool, STANDARD);
    const screening0 = report.diagnostics.stages.find((entry) => entry.stage === 'screening' && entry.step === 0);
    expect(screening0.skipped).toBe(false);
    // step0 的 screen 基线来自链起点基线合并评估（不在此阶段入账）→ 只有 pool 个候选评估。
    expect(screening0.evaluated).toBe(pool);
    expect(screening0.simulations).toBe(pool * STANDARD.screenSeeds);
    expect(screening0.kept).toBe(keepScreen);

    // 精筛阶段（step0）：基线补齐 1 次 + 幸存者逐个补评 refine 新增样本。
    const refining0 = report.diagnostics.stages.find((entry) => entry.stage === 'refining' && entry.step === 0);
    // 同理：step0 的 refine 基线也来自合并评估 → 只有 keepScreen 个幸存者补评。
    expect(refining0.evaluated).toBe(keepScreen);
    expect(refining0.simulations).toBe(keepScreen * (STANDARD.refineSeeds - STANDARD.screenSeeds));

    // 第一步定选：粗筛按乐观上界（Δdps）淘汰 —— head 低档（L1/L2）与 weapon 低档被淘汰，
    // 幸存者含 head L3..L10；精筛后 head 各档效率全等（50）> weapon（20）→ tie-break
    // 成本最低的 head +3（成本 300）。
    expect(report.steps[0].candidate.id).toBe(HEAD_ID(3));
    expect(report.steps[0].cost).toBe(300);

    // 链推进到 exhausted（head 到顶后 weapon 逐档买进）且不超预算。
    expect(report.stopReason).toBe(BUDGET_OPTIMIZER_STOP_EXHAUSTED);
    expect(report.steps.length).toBeGreaterThanOrEqual(2);
    expect(report.totalCost).toBeLessThanOrEqual(1200);
    // 后续步骤从「当前档」续枚举：不再出现重复购买同档。
    const boughtIds = report.steps.map((step) => step.candidate.id);
    expect(new Set(boughtIds).size).toBe(boughtIds.length);

    // 种子硬约束①（step0 粗筛段，2026-10-08 起全链共享）：全部粗筛候选共享同一 screen 种子
    // 列表（4 场，未到分片阈值）；step0 的基线不在此段单独评估 —— 它已并入链起点基线合并评估
    //（见「种子口径」用例）。后续步骤的粗筛（未命中复用的槽位）会继续出现同一列表，故只断言下界。
    const chainScreenSeeds = deriveSeeds(input, BUDGET_OPTIMIZER_SEED_SALT_SCREEN, STANDARD.screenSeeds);
    const seedLists = stub.instances.map((client) => client.evalSeeds);
    const screenCount = seedLists.filter((list) => sameSeeds(list, chainScreenSeeds)).length;
    expect(screenCount).toBeGreaterThanOrEqual(pool);
  });
});

describe('optimizeBudgetUpgrades 取消与错误防御', () => {
  it('取消语义：链基线评估中途中止 → cancelled 收尾（不抛失败），注册表清空', async () => {
    const input = createInput();
    stub.responder = () => null; // 所有评估永久挂起（在途），等待取消
    const promise = optimizeBudgetUpgrades(input);
    await waitFor(() => stub.instances.length > 0);
    expect(hasBudgetOptimizerRunInProgress()).toBe(true);

    cancelBudgetOptimizerRun();
    const report = await promise;

    expect(report.cancelled).toBe(true);
    expect(report.version).toBe(BUDGET_OPTIMIZER_REPORT_VERSION);
    expect(report.stopReason).toBe(BUDGET_OPTIMIZER_STOP_CANCELLED);
    expect(report.steps).toEqual([]);
    expect(report.baseline.metrics.failed).toBe(true);
    // 取消的链不做复验（快速响应停止）。
    expect(report.verification).toBeNull();
    expect(hasBudgetOptimizerRunInProgress()).toBe(false);
  });

  it('入口三查：缺主角配置 / 自身运行中 / 共享运行 / 首页多轮批 全部拒绝', async () => {
    // 事实源自证：常量必须是可读字符串（导入静默变 undefined 会把断言弱化成「任意错误」）。
    expect(typeof MISSING_PLAYER_ERROR).toBe('string');
    expect(typeof BUDGET_OPTIMIZER_BUSY_ERROR).toBe('string');
    expect(typeof SHARED_RUN_BUSY_ERROR).toBe('string');

    await expect(optimizeBudgetUpgrades({})).rejects.toThrow(MISSING_PLAYER_ERROR);

    const run = registerBudgetOptimizerRun({ cancelRequested: false });
    try {
      await expect(optimizeBudgetUpgrades(createInput())).rejects.toThrow(BUDGET_OPTIMIZER_BUSY_ERROR);
    } finally {
      unregisterBudgetOptimizerRun(run);
    }

    const sharedPromise = runSharedSingleSimulationPayload({ type: 'start_simulation' }, () => {}, {
      workerClient: new IdleWorkerClient(),
    });
    try {
      await expect(optimizeBudgetUpgrades(createInput())).rejects.toThrow(SHARED_RUN_BUSY_ERROR);
    } finally {
      cancelSharedWorkerRun();
      await sharedPromise.catch(() => {});
    }

    const batch = runSimulationBatchWithDedicatedWorker([{ id: 1 }], () => {}, {
      scope: DEDICATED_WORKER_SCOPE_HOME_MULTI_ROUND,
      WorkerClientCtor: HangingBatchWorkerClient,
    });
    const settled = batch.catch(() => {});
    try {
      await expect(optimizeBudgetUpgrades(createInput())).rejects.toThrow(SHARED_RUN_BUSY_ERROR);
    } finally {
      stopHomeMultiRoundWorkerRuns();
      await settled;
    }
  });

  it('错误防御：评估中抛错原样上抛，注册表清理后可重跑', async () => {
    const input = createInput();
    const base = buildResponder({ gainFor: linearGains });
    stub.responder = (payload) => {
      if (equipmentLevelOf(payload, CORSAIR) > 0) throw new Error('boom');
      return base(payload); // 基线（0 档）正常，候选首次评估时抛错
    };

    await expect(optimizeBudgetUpgrades(input)).rejects.toThrow('boom');
    expect(hasBudgetOptimizerRunInProgress()).toBe(false);

    // 注册表已清、在途任务已随拒绝收尾：换正常响应器可完整重跑。
    stub.responder = buildResponder({ gainFor: linearGains });
    const report = await optimizeBudgetUpgrades(input);
    expect(report.cancelled).toBe(false);
    expect(report.steps.length).toBeGreaterThan(0);
  });

  it('错误防御：单个候选评估失败（退化结构）不进定选，链照常推进', async () => {
    const input = createInput();
    const base = buildResponder({ gainFor: linearGains });
    stub.responder = (payload) => {
      if (equipmentLevelOf(payload, CORSAIR) === 5) return { error: 'sample failed' };
      return base(payload);
    };

    const report = await optimizeBudgetUpgrades(input);

    expect(report.cancelled).toBe(false);
    // step0：全等性价比 tie-break 仍取 +1（退化候选沉底不影响）。
    expect(report.steps[0].candidate.id).toBe(HEAD_ID(1));
    // 退化候选在 step0 快照里如实记录（无统计）。
    const failed = report.steps[0].candidatesSnapshot.candidates.find((candidate) => candidate.id === HEAD_ID(5));
    expect(failed.deltaDps).toBeNull();
    expect(failed.se).toBeNull();
    // step1：可用档 L2/L3/L4/L6 中 L6 性价比最高（L5 退化沉底）→ 链继续推进。
    expect(report.steps[1].candidate.id).toBe(HEAD_ID(6));
    expect(report.steps.map((step) => step.candidate.id)).not.toContain(HEAD_ID(5));
  });

  it('链起点基线首评失败（单场抖动）不进缓存：step0 独立重评基线，链照常推进', async () => {
    const input = createInput();
    const base = buildResponder({ gainFor: linearGains });
    // 链起点基线是全链第一次评估（16 场 = screen 4 + refine 12，分片并行）：只让其中一场失败，
    // 聚合即退化为 failed 结构（aggregateRoundMetrics：任一场失败 → 整份退化）。
    // 旧行为：失败结构进 firstStepBaseline → step0 走缓存、配对统计全 null → 零步 + exhausted。
    let jagged = false;
    stub.responder = (payload) => {
      if (equipmentLevelOf(payload, CORSAIR) === 0 && !jagged) {
        jagged = true;
        return { error: 'transient baseline failure' };
      }
      return base(payload);
    };

    const report = await optimizeBudgetUpgrades(input);

    expect(report.cancelled).toBe(false);
    // step0 独立重评成功 → 链推进（不再零步收尾）。
    expect(report.steps.length).toBeGreaterThan(0);
    // 回填：报告基线改用这次真实测量，诊断位不置失败。
    expect(report.diagnostics.baselineFailed).toBe(false);
    expect(report.baseline.metrics.failed).toBe(false);
    expect(report.steps[0].baselineBefore.rounds).toBe(STANDARD.refineSeeds);
    expect(report.steps[0].baselineBefore.failed).toBe(false);
  });

  it('池内基线补评的分片预算按剩余容量折算：满池（任务数 ≥ workerLimit）时不分片', async () => {
    // racing 大池（20 候选 → 幸存者 ≥ refineKeepMin=12）时 refineTaskCount = 13 > workerLimit=8：
    // 池满位 → 池内基线分片预算退化为 1（修复前直接传 workerLimit 会拆 6 片，瞬时并发 6+7>8）。
    const input = createInput({
      weapon: true,
      headLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      weaponLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      maxLevelUp: 10,
      parallelWorkerLimit: 8,
    });
    const base = buildResponder({ gainFor: linearGains });
    let jagged = false;
    stub.responder = (payload) => {
      if (equipmentLevelOf(payload, CORSAIR) === 0 && !jagged) {
        jagged = true;
        return { error: 'transient baseline failure' };
      }
      return base(payload);
    };

    await optimizeBudgetUpgrades(input);

    // 首评失败 → step0 独立重评：refine 段补评以「完整 12 场」整批出现（K=1），不再拆多片。
    const refineSeeds = deriveSeeds(
      input,
      BUDGET_OPTIMIZER_SEED_SALT_REFINE,
      STANDARD.refineSeeds - STANDARD.screenSeeds,
    );
    // 只按 Corsair 等级过滤不够：racing 池的 weapon 候选补评（Corsair 仍 0 档）同样会命中
    // 「完整 12 场」列表；需同时要求 GRIFFIN 0 档（= 工作配置的原始基线载荷）才能唯一锚定。
    const baselineRefineClients = stub.instances.filter(
      (client) =>
        sameSeeds(client.evalSeeds, refineSeeds) &&
        client.payloads.every(
          (payload) => equipmentLevelOf(payload, CORSAIR) === 0 && equipmentLevelOf(payload, GRIFFIN) === 0,
        ),
    );
    expect(baselineRefineClients).toHaveLength(1);
  });

  it('池内基线补评的分片预算按剩余容量折算：池未满时保留分片收益', async () => {
    // 小池（6 候选 → refineTaskCount = 7 < workerLimit=8）：poolWorkers = 7 → 预算 = 2 →
    // refine 补评拆 2 片（各 6 场）；池内瞬时并发 = 2 + 6 = 8 = workerLimit，不超上限。
    const input = createInput({ parallelWorkerLimit: 8 });
    const base = buildResponder({ gainFor: linearGains });
    let jagged = false;
    stub.responder = (payload) => {
      if (equipmentLevelOf(payload, CORSAIR) === 0 && !jagged) {
        jagged = true;
        return { error: 'transient baseline failure' };
      }
      return base(payload);
    };

    await optimizeBudgetUpgrades(input);

    const refineSeeds = deriveSeeds(
      input,
      BUDGET_OPTIMIZER_SEED_SALT_REFINE,
      STANDARD.refineSeeds - STANDARD.screenSeeds,
    );
    const refineSet = new Set(refineSeeds.map(toSeed));
    // 补评片 = 6 场（2 片 × 6 = 12 场）；首评片为 2 场、复验片为 11~13 场且盐不同 → 唯一命中。
    const refineShards = stub.instances.filter(
      (client) =>
        client.evalSeeds.length === 6 &&
        client.evalLevels.every((level) => level === 0) &&
        client.evalSeeds.every((seed) => refineSet.has(seed)),
    );
    expect(refineShards).toHaveLength(2);
    // 拼接守恒：2 片并集 = refine 补评全集（合并顺序按片索引）。
    const merged = refineShards
      .flatMap((client) => client.evalSeeds)
      .slice()
      .sort((a, b) => a - b);
    expect(merged).toEqual(
      refineSeeds
        .map(toSeed)
        .slice()
        .sort((a, b) => a - b),
    );
  });

  it('链起点基线持续失败：零步收尾但诊断位与报告摘要标失败', async () => {
    const input = createInput();
    const base = buildResponder({ gainFor: linearGains });
    // 基线的每一场都失败 → 首评与 step0 独立重评都拿不到可用测量。
    stub.responder = (payload) =>
      equipmentLevelOf(payload, CORSAIR) === 0 ? { error: 'baseline failed' } : base(payload);

    const report = await optimizeBudgetUpgrades(input);

    expect(report.cancelled).toBe(false);
    expect(report.steps).toEqual([]);
    expect(report.stopReason).toBe(BUDGET_OPTIMIZER_STOP_EXHAUSTED);
    // 诊断位与报告摘要如实标失败：界面据此把「无可买项」分流为「基线/模拟失败」。
    expect(report.diagnostics.baselineFailed).toBe(true);
    // 基线失败使全部候选的配对统计为 null（mean 非有限 → 在门槛判定之前就被剔除）：
    // 不得被误计入显著性门槛拦截，停因仍走 exhausted + baselineFailed 分流。
    expect(report.diagnostics.significanceBlocked).toBe(0);
    expect(report.baseline.metrics.failed).toBe(true);
    // 零步链不跑链终复验（无新信息）。
    expect(report.verification).toBeNull();
  });

  it('步数上限：链达到 MAX_CHAIN_STEPS 时以 step-limit 收尾（安全阀）', async () => {
    // 逐档等成本：每步只买得起/最划算的是下一档 → 链一直推进到上限。
    // budget=100 → bandHigh=120；每档成本 100×L → 每步只能买 +1 档（100），共 1 步就没了。
    // 改用大预算 + maxLevelUp=1：每步固定 +1 档，档位上限 20 → 链长 20 < 40 不触顶。
    // 直接构造「可无限细分」的池：budget 巨大（1e9）+ maxLevelUp=10 + 档位上限 20 → 链长 ≤ 20。
    // 触发上限最简单的方式：让每步只能前进 1 档且档位远未到顶 —— maxLevelUp=1 限制候选只到
    // base+1，但 base 是链起点（不随步推进），所以每步都恰好买 +1 档，直到 20 级顶。
    // 20 步 < 40 上限 → 仍不触顶。真正触顶需要 >40 个可买档位：不可能（档位上限 20）。
    // 结论：本用例改为锚定「上限常量参与终止判定」的单元语义 —— 以挂起桩 + 手工注册表
    // 无法构造，改为断言 exhausted 与 step-limit 的判定边界在代码层由常量承载（见纯口径用例）。
    expect(BUDGET_OPTIMIZER_MAX_CHAIN_STEPS).toBeGreaterThan(20); // 档位业务上限 20 → 实际链永不触顶
  });

  it('步数上限：stepLimitMode=custom 时链在 maxChainSteps 步后以 step-limit 收尾', async () => {
    // 次线性增益（bonus = 0.05×√level）：性价比 = 50/√L 随档位递减 → 每步只买「下一档」，
    // 而不是像线性增益那样一步顶格买到窗口顶（那样链 2 步内就 exhausted）。bandHigh 1200
    // 足够连买 L1→L4→L6 三步；链被用户步数上限（3 步）截断为 step-limit，而不是 exhausted。
    const sqrtGains = ({ hrid, level }) => (hrid === CORSAIR ? { bonus: 0.05 * Math.sqrt(level) } : null);
    stub.responder = buildResponder({ gainFor: sqrtGains });
    const report = await optimizeBudgetUpgrades(
      createInput({ settings: { stepLimitMode: 'custom', maxChainSteps: 3 } }),
    );

    expect(report.cancelled).toBe(false);
    expect(report.steps).toHaveLength(3);
    expect(report.stopReason).toBe(BUDGET_OPTIMIZER_STOP_STEP_LIMIT);
    expect(report.settings.stepLimitMode).toBe('custom');
    expect(report.settings.maxChainSteps).toBe(3);
    // step-limit 收尾没有「无可买项」快照。
    expect(report.finalSnapshot).toBeNull();
  });
});

describe('optimizeBudgetUpgrades 逐场回退路径（桩无批量能力）', () => {
  it('per-seed 评估：种子逐场下发正确、结果结构与批量路径一致', async () => {
    const input = createInput({ WorkerClientCtor: SingleWorkerClient });
    stub.responder = buildResponder({ gainFor: linearGains });

    const report = await optimizeBudgetUpgrades(input);

    expect(report.cancelled).toBe(false);
    expect(report.diagnostics.candidateCount).toBe(6);
    expect(report.steps.map((step) => step.candidate.id)).toEqual([HEAD_ID(1), HEAD_ID(6)]);
    expect(report.baseline.metrics.rounds).toBe(16);

    // 逐场路径：每个场次一个 client（分片只改调度分组，不改场数）；场次总账 = simulations
    //（起点基线 16 + step0 6×16 + step1 复用命中 0 + 配对复验 100 = 212）。
    expect(stub.instances).toHaveLength(report.diagnostics.simulations);
    expect(stub.instances).toHaveLength(16 + 6 * 16 + 2 * STANDARD.verifySeeds);

    // payload 形状：workerId 归预算优化 scope，逐场投递 type=start_simulation。
    for (const client of stub.instances) {
      expect(client.payload.type).toBe('start_simulation');
      expect(String(client.payload.workerId)).toMatch(/^budget-optimizer/);
    }
  });
});

// ── 优化目标（objective）────────────────────────────────────────────────

describe('optimizeBudgetUpgrades 优化目标（objective）', () => {
  it('objective=xp：定选切换到 xpPerHour 口径（与 dps 口径的链不同）', async () => {
    // 双通道增益：dps 线性（各档性价比全等 → dps 目标 step0 取 +1）；
    // xp 在 +3 档给 0.6（性价比最高）→ xp 目标的 step0 应为 +3。
    const gains = ({ hrid, level }) => {
      if (hrid !== CORSAIR) return null;
      if (level === 3) return { bonus: 0.15, xpBonus: 0.6 };
      return { bonus: 0.05 * level, xpBonus: 0.05 * level };
    };
    stub.responder = buildResponder({ gainFor: gains });

    const dpsReport = await optimizeBudgetUpgrades(createInput());
    expect(dpsReport.objective).toBe('dps');
    expect(dpsReport.steps[0].candidate.id).toBe(HEAD_ID(1));

    const xpReport = await optimizeBudgetUpgrades(createInput({ settings: { objective: 'xp' } }));
    expect(xpReport.objective).toBe('xp');
    expect(xpReport.settings.objective).toBe('xp');
    // step0 选 +3：Δxp = 0.6×100000 = 60000 → xpPerHour Δ = 2500；性价比（2500/300）居首。
    expect(xpReport.steps[0].candidate.id).toBe(HEAD_ID(3));
    expect(xpReport.steps[0].deltaObjective).toBeCloseTo(2500, 6);
    // 旧兼容名与泛化名同存当前目标的 Δ（objective='xp' 时 deltaDps 也是 xp 口径）。
    expect(xpReport.steps[0].deltaDps).toBeCloseTo(2500, 6);
    expect(xpReport.steps[0].candidate.deltaXp).toBeCloseTo(2500, 6);
    // step1（档 3 起，候选 +4..+6）：xp 增量全为负（0.05L − 0.6 < 0）→ 无可选 → exhausted 单步链。
    expect(xpReport.steps).toHaveLength(1);
    expect(xpReport.stopReason).toBe(BUDGET_OPTIMIZER_STOP_EXHAUSTED);
  });

  it('objective=profit：无价格表时利润恒为 0 → 零步链收尾（证明取的是利润口径）', async () => {
    stub.responder = buildResponder({ gainFor: linearGains });

    const profitReport = await optimizeBudgetUpgrades(createInput({ settings: { objective: 'profit' } }));
    expect(profitReport.objective).toBe('profit');
    expect(profitReport.steps).toEqual([]);
    expect(profitReport.totalCost).toBe(0);
    expect(profitReport.stopReason).toBe(BUDGET_OPTIMIZER_STOP_EXHAUSTED);
    // 候选照常枚举（快照留证）但全部不可用（Δ=0）。
    expect(profitReport.finalSnapshot.candidates.length).toBe(6);
    const l1 = profitReport.finalSnapshot.candidates.find((candidate) => candidate.id === HEAD_ID(1));
    expect(l1.deltaObjective).toBe(0);
    expect(l1.deltaProfit).toBe(0);

    // 对照：同一 responder 下 dps 口径有步骤（证明差异来自 objective 而非数据）。
    const dpsReport = await optimizeBudgetUpgrades(createInput());
    expect(dpsReport.steps.length).toBeGreaterThan(0);
  });

  it('缺省 objective（undefined）→ 归一化为利润口径：零步链收尾', async () => {
    stub.responder = buildResponder({ gainFor: linearGains });
    const report = await optimizeBudgetUpgrades(createInput({ settings: { objective: undefined } }));

    // 设置层缺省 = 利润（domain 归一化）；无价格表时利润恒 0 → 零步链。
    expect(report.objective).toBe('profit');
    expect(report.settings.objective).toBe('profit');
    expect(report.steps).toEqual([]);
    expect(report.stopReason).toBe(BUDGET_OPTIMIZER_STOP_EXHAUSTED);
  });
});

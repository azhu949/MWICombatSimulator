// 预算优化 —— 模拟层（payload 构建 + 专用 worker 调用 + 指标提取）。
//
// 模式照 triggerOptimizerSimulation.js：
//   buildBudgetCandidatePayload  克隆主角配置 → 应用候选 effects（装备/技能/房子）
//                                → 与冻结队友一起 buildPlayersForSimulation → buildSingleSimulationPayload
//   evaluateBudgetPayload        用 budget-optimizer scope 的专用 worker 跑一场评估：默认把本次
//                                评估的全部种子收进**一个** worker realm（批量路径，省掉每场一次
//                                realm 新建的固定开销；注入的桩没有批量能力时回退到逐场路径），
//                                基线与全部候选共享同一组 seeds = 公共随机数（配对差的前提）
//   aggregateRoundMetrics        多轮聚合口径：数值取均值、空蓝计数、任一轮失败即失败、保留逐轮样本
//   collectMetrics               simResult → { dps, dailyNoRngProfit, xpPerHour,
//                                killsPerHour, deathsPerHour, ranOutOfMana }（按主角结算）
//
// 容错风格对齐 triggerOptimizerSimulation：模拟失败/指标缺失时返回可打分的退化结构
//（createDegenerateMetrics）；取消错误（code:'cancelled'）必须原样上抛，由搜索层按 code 判定。
//
// 队伍口径（用户确认）：只改主角（players[0]），队友配置冻结、原样进模拟（"只模拟主角、带上队友"）。

import { buildPlayersForSimulation } from './playerMapper.js';
import {
  ONE_HOUR,
  buildSimulationExtra,
  buildSingleSimulationPayload,
  computeQueueMetrics,
  resolveSimResultPlayerHrid,
} from './simulationDomain.js';
import { applyBudgetEffectToPlayerConfig, BUDGET_OPTIMIZER_WORKER_ID } from './budgetOptimizerDomain.js';
import { deriveSeedSet, hashSeed } from './seededRandom.js';
import { deepClone, isPlainObject, toFiniteNumber } from './utils.js';
import {
  DEDICATED_WORKER_SCOPE_BUDGET_OPTIMIZER,
  isWorkerRunCancelledError,
  runSimulationBatchWithDedicatedWorker,
  runSingleSimulationPayloadWithDedicatedWorker,
  supportsSimulationBatch,
} from './simulatorWorkerRuns.js';

// 把一组候选 effects 应用到主角配置的克隆体上（基线 = 空数组，效果为"原样"）。
// buildPlayersForSimulation 只构建 selected 玩家，因此克隆体强制 selected:true。
export function applyBudgetEffectsToPlayerConfig(playerConfig, effects = []) {
  const config = deepClone(isPlainObject(playerConfig) ? playerConfig : {});
  config.selected = true;
  for (const effect of Array.isArray(effects) ? effects : []) {
    applyBudgetEffectToPlayerConfig(config, effect);
  }
  return config;
}

// 产出可投递给专用 worker 的 payload：主角（应用候选）+ 冻结队友（原样，只补 selected）。
// players[0] 恒为主角（player1），指标按主角结算（preferredPlayerId）。
export function buildBudgetCandidatePayload(playerConfig, simulationSettings, extra, effects = [], options = {}) {
  const config = applyBudgetEffectsToPlayerConfig(playerConfig, effects);
  const teammates = (Array.isArray(options.teammates) ? options.teammates : []).filter((mate) => isPlainObject(mate));
  const partyConfigs = [
    config,
    ...teammates.map((mate) => {
      const clone = deepClone(mate);
      clone.selected = true;
      return clone;
    }),
  ];
  const players = buildPlayersForSimulation(partyConfigs);
  const settings = isPlainObject(simulationSettings) ? simulationSettings : {};
  const baseExtra = isPlainObject(extra) ? extra : buildSimulationExtra(settings);
  const payload = buildSingleSimulationPayload(players, settings, [], {
    workerId: BUDGET_OPTIMIZER_WORKER_ID,
    extra: { ...baseExtra, enableHpMpVisualization: false },
  });
  payload.logCombatEvents = false;
  if (Number.isFinite(Number(options.seed))) payload.seed = Number(options.seed) >>> 0;
  return payload;
}

// 指标缺失/模拟失败时的退化结构：全零指标 + failed 标记（与触发优化器同款）。
export function createDegenerateMetrics(reason) {
  return {
    dps: 0,
    dailyNoRngProfit: 0,
    xpPerHour: 0,
    killsPerHour: 0,
    deathsPerHour: 0,
    ranOutOfMana: false,
    ranOutOfManaCount: 0,
    rounds: 0,
    samples: [],
    failed: true,
    error: String(reason || 'Simulation failed.'),
  };
}

// simResult → 打分指标（按主角结算）：
//   dps/dailyNoRngProfit/xpPerHour/killsPerHour 取自 computeQueueMetrics，
//   deathsPerHour 由 simResult.deaths / 小时换算（summarizeResult 同口径），
//   ranOutOfMana 是空蓝强否决标记。
export function collectMetrics(simResult, context = {}) {
  if (!isPlainObject(simResult)) return createDegenerateMetrics('Missing simulation result.');
  const pricingOptions = isPlainObject(context.pricingOptions) ? context.pricingOptions : {};
  const preferredPlayerId = context.preferredPlayerId;
  try {
    const queueMetrics = computeQueueMetrics(simResult, preferredPlayerId, pricingOptions);
    const playerHrid = resolveSimResultPlayerHrid(simResult, preferredPlayerId);
    const hours = Math.max(1e-9, Number(simResult.simulatedTime || 0) / ONE_HOUR);
    const deaths = Number(simResult.deaths?.[playerHrid] || 0) / hours;
    return {
      ...queueMetrics,
      deathsPerHour: Number.isFinite(deaths) ? deaths : 0,
      ranOutOfMana: simResult.playerRanOutOfMana?.[playerHrid] === true,
    };
  } catch (error) {
    return createDegenerateMetrics(error?.message || String(error));
  }
}

// 参与多轮聚合的数值指标清单（与 computeQueueMetrics + deathsPerHour 的产出同源）。
export const AGGREGATED_METRIC_KEYS = [
  'dps',
  'dailyProfit',
  'dailyNoRngProfit',
  'xpPerHour',
  'killsPerHour',
  'deathsPerHour',
];

// 单轮抽样里保留给「配对统计」的字段。
function pickSampleMetrics(metrics) {
  const sample = {};
  for (const key of AGGREGATED_METRIC_KEYS) sample[key] = toFiniteNumber(metrics?.[key], 0);
  sample.ranOutOfMana = metrics?.ranOutOfMana === true;
  return sample;
}

// 某一轮抽样的 payload：写入该轮的确定性种子（公共随机数的实际入口）。
function buildSeededPayload(payload, seed, round) {
  const base = isPlainObject(payload) ? payload : {};
  const next = { ...base, workerId: `${String(base.workerId || BUDGET_OPTIMIZER_WORKER_ID)}#r${round + 1}` };
  if (Number.isFinite(Number(seed))) next.seed = Number(seed) >>> 0;
  return next;
}

// N 场抽样的聚合口径：数值 = 算术均值；空蓝 = 任一场出现即标记；任一场失败 = 整体退化为失败
// 结构（把失败抽样混进均值会得到不可信也不可复现的分数）；samples = 逐轮指标（配对统计原料）。
export function aggregateRoundMetrics(samples) {
  const list = Array.isArray(samples) ? samples.filter((sample) => isPlainObject(sample)) : [];
  if (list.length === 0) return createDegenerateMetrics('No simulation rounds were evaluated.');
  const failed = list.find((sample) => sample.failed === true);
  if (failed) return createDegenerateMetrics(failed.error || 'Simulation failed.');
  const metrics = {};
  for (const key of AGGREGATED_METRIC_KEYS) {
    const total = list.reduce((sum, sample) => sum + toFiniteNumber(sample[key]), 0);
    metrics[key] = toFiniteNumber(total / list.length);
  }
  return {
    ...metrics,
    ranOutOfMana: list.some((sample) => sample.ranOutOfMana === true),
    ranOutOfManaCount: list.filter((sample) => sample.ranOutOfMana === true).length,
    rounds: list.length,
    samples: list.map(pickSampleMetrics),
  };
}

// seeds 的解析口径：显式给了非空数组 → 用它（搜索层正常路径，同一评估内共享同一组种子）；
// 否则按 count 从 payload.workerId 派生一组确定性种子（只服务于测试/防御路径）。
export function resolveBudgetEvaluationSeeds(payload, seeds, count = 1) {
  const provided = Array.isArray(seeds) ? seeds.filter((seed) => Number.isFinite(Number(seed))) : [];
  if (provided.length > 0) return provided.map((seed) => Number(seed) >>> 0);
  const fallbackCount = Math.max(1, Math.floor(toFiniteNumber(count, 1)));
  return deriveSeedSet(
    hashSeed(`budget-fallback:${String(payload?.workerId ?? BUDGET_OPTIMIZER_WORKER_ID)}`),
    fallbackCount,
  );
}

// 用 budget-optimizer scope 的专用 worker 跑每个种子一场抽样并聚合指标。
// **同一评估（基线 / 基线 + 候选）必须传同一组 seeds**，否则配对性失效。
// WorkerClientCtor 是测试桩注入点（生产环境走真实 WorkerClient）。
// 取消错误原样上抛：调用方用 isWorkerRunCancelledError 判定，不当失败处理。
export async function evaluateBudgetPayload(
  payload,
  { WorkerClientCtor, pricingOptions, preferredPlayerId, seeds, poolCapacity, rounds } = {},
) {
  const resolvedSeeds = resolveBudgetEvaluationSeeds(payload, seeds, rounds);
  // 批量路径：一次评估的 N 场收进同一个 realm（生产端每建一个 realm 都要付模块加载固定开销）。
  if (resolvedSeeds.length > 1 && supportsSimulationBatch(WorkerClientCtor)) {
    const batchPayloads = resolvedSeeds.map((seed, round) => buildSeededPayload(payload, seed, round));
    // scope 级保活池容量与并行工作集对齐（批量入口按 scope 池化，2026-10-04）。
    const batchOptions = { scope: DEDICATED_WORKER_SCOPE_BUDGET_OPTIMIZER };
    if (poolCapacity !== undefined) batchOptions.poolCapacity = poolCapacity;
    if (typeof WorkerClientCtor === 'function') batchOptions.WorkerClientCtor = WorkerClientCtor;
    const batch = await runSimulationBatchWithDedicatedWorker(batchPayloads, () => {}, batchOptions);
    const batchSamples = [];
    for (let index = 0; index < batchPayloads.length; index += 1) {
      const error = batch.errors?.[index];
      batchSamples.push(
        error
          ? createDegenerateMetrics(error)
          : collectMetrics(batch.simResults?.[index], { pricingOptions, preferredPlayerId }),
      );
    }
    return aggregateRoundMetrics(batchSamples);
  }
  const samples = [];
  for (let round = 0; round < resolvedSeeds.length; round += 1) {
    const options = { scope: DEDICATED_WORKER_SCOPE_BUDGET_OPTIMIZER };
    if (poolCapacity !== undefined) {
      options.poolCapacity = poolCapacity;
    }
    if (typeof WorkerClientCtor === 'function') options.WorkerClientCtor = WorkerClientCtor;
    try {
      const simResult = await runSingleSimulationPayloadWithDedicatedWorker(
        buildSeededPayload(payload, resolvedSeeds[round], round),
        () => {},
        options,
      );
      samples.push(collectMetrics(simResult, { pricingOptions, preferredPlayerId }));
    } catch (error) {
      if (isWorkerRunCancelledError(error)) throw error;
      samples.push(createDegenerateMetrics(error?.message || 'Simulation failed.'));
    }
  }
  return aggregateRoundMetrics(samples);
}

// 首页「单目标多轮模拟」执行链路的纯函数层：
//   buildMultiRoundPayloads  克隆单轮 payload 模板 → 逐轮注入确定性种子（公共随机数）；
//   aggregateMultiRoundRows  「每轮 summarizeResult 行数组」→ 稳健聚合行 + 每玩家每指标统计。
//
// 聚合口径与队列多轮排名（queueScoring）对齐：winsorize(5%) + 中位数融合(0.5) + 置信度，
// 统一由 robustStats.summarizeSeries 承载（默认参数以该模块为准，勿在此另立常量）。
//
// 执行链路的其余部分（批运行注册、取消、结果写入）在 store（simulatorSimulationActions.js）
// 与 simulatorWorkerRuns.js，本模块保持纯函数以便单测直接锚定。

import { deriveSeedSet } from './seededRandom.js';
import { summarizeSeries } from './robustStats.js';
import { clamp, toFiniteNumber } from './utils.js';

// 首页多轮模拟的固定基种子：同样的输入配置 + 同样的轮数必然得到同一组逐轮种子
// （deriveSeedSet 语义：增删轮次不改变已存在轮次的种子）。改这个值会让既有输入配置
// 无法再复现同一组结果，非数据迁移不要动。
export const HOME_MULTI_ROUND_SEED_BASE = 20261001;

// 重复次数契约（与 store 字段登记一致）：默认 1、整数、有效范围 [1,100]。
// store 不做 clamp，读取端统一走本模块的 clampSimulationRounds。
export const HOME_MULTI_ROUND_DEFAULT_ROUNDS = 1;
export const HOME_MULTI_ROUND_MIN_ROUNDS = 1;
export const HOME_MULTI_ROUND_MAX_ROUNDS = 100;

// 读取端兜底：非有限值回落默认 1；向下取整后钳到 [1,100]。
export function clampSimulationRounds(value) {
  const numeric = toFiniteNumber(value ?? HOME_MULTI_ROUND_DEFAULT_ROUNDS, HOME_MULTI_ROUND_DEFAULT_ROUNDS);
  return clamp(Math.floor(numeric), HOME_MULTI_ROUND_MIN_ROUNDS, HOME_MULTI_ROUND_MAX_ROUNDS);
}

// 把单轮 payload 模板克隆 rounds 份并逐份注入种子：
//   seed     = deriveSeedSet(seedBase, rounds)[i] >>> 0（worker.js 给了 seed 即完全确定性，
//              不再随机采种）；
//   workerId = 模板 workerId + "#r{轮次}"（仅供日志区分轮次；随机流只由 payload.seed 决定，
//              与触发器优化器 buildSeededPayload 同款）；
// 其余字段保持模板原样（浅克隆；players 等字段与优化器先例一致保持引用共享——
// worker 端对每个玩家的 DTO 都会 structuredClone 后再建 Player）。
export function buildMultiRoundPayloads(basePayload, rounds, seedBase = HOME_MULTI_ROUND_SEED_BASE) {
  const template = basePayload && typeof basePayload === 'object' ? basePayload : {};
  const total = clampSimulationRounds(rounds);
  const seeds = deriveSeedSet(seedBase, total);

  return seeds.map((seed, round) => {
    const payload = { ...template };
    payload.seed = seed >>> 0;
    payload.workerId = `${String(template.workerId || 'home-multi-round')}#r${round + 1}`;
    return payload;
  });
}

// summarizeResult 行里不参与数值聚合的字段（身份字段原样保留；其余有限数值字段一律
// 按数值指标处理——包括 summarizeResult 未来新增的指标，不需要在这里逐项登记）。
const NON_METRIC_ROW_KEYS = new Set(['playerHrid', 'playerName']);

// 聚合「每轮 summarizeResult 行数组」（失败轮由调用方剔除后再传入）：
//   aggregatedRows  与 summarizeResult 行同构的聚合行（数值指标 = summarizeSeries.robustMean，
//                   身份字段取首轮值），直接写入 results.summaryRows 供现有结果视图消费；
//   playerStats     每玩家每指标的完整统计：values = 该指标的成功轮序列，
//                   rounds = 与 values 平行的 1-based 原始轮号（失败轮跳号），
//                   其余字段为 summarizeSeries 的 12 项稳健统计。
// roundNumbers 为可选参数：与 roundRowsList 平行、元素为该行数组的 1-based 原始轮号；
// 缺省时按 1..n 顺序编号。玩家顺序按首次出现的轮次/行序保留；没有任何行时返回空数组。
export function aggregateMultiRoundRows(roundRowsList, roundNumbers = null) {
  const roundsList = Array.isArray(roundRowsList) ? roundRowsList.filter(Array.isArray) : [];
  const playerOrder = [];
  const templateRowByPlayer = new Map();
  const metricSeriesByPlayer = new Map();
  const metricRoundsByPlayer = new Map();

  for (let listIndex = 0; listIndex < roundsList.length; listIndex += 1) {
    const requestedRound = Number(roundNumbers?.[listIndex]);
    const roundNumber = Number.isFinite(requestedRound) ? Math.floor(requestedRound) : listIndex + 1;

    for (const row of roundsList[listIndex]) {
      if (!row || typeof row !== 'object') {
        continue;
      }
      const playerHrid = String(row.playerHrid || '');
      if (!playerHrid) {
        continue;
      }
      if (!templateRowByPlayer.has(playerHrid)) {
        templateRowByPlayer.set(playerHrid, row);
        metricSeriesByPlayer.set(playerHrid, new Map());
        metricRoundsByPlayer.set(playerHrid, new Map());
        playerOrder.push(playerHrid);
      }

      const metricSeries = metricSeriesByPlayer.get(playerHrid);
      const metricRounds = metricRoundsByPlayer.get(playerHrid);
      for (const [key, value] of Object.entries(row)) {
        if (NON_METRIC_ROW_KEYS.has(key)) {
          continue;
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          continue;
        }
        if (!metricSeries.has(key)) {
          metricSeries.set(key, []);
          metricRounds.set(key, []);
        }
        metricSeries.get(key).push(value);
        metricRounds.get(key).push(roundNumber);
      }
    }
  }

  const aggregatedRows = [];
  const playerStats = [];

  for (const playerHrid of playerOrder) {
    const templateRow = templateRowByPlayer.get(playerHrid);
    const metricSeries = metricSeriesByPlayer.get(playerHrid);
    const metricRounds = metricRoundsByPlayer.get(playerHrid);

    const aggregatedRow = {};
    for (const [key, value] of Object.entries(templateRow)) {
      if (NON_METRIC_ROW_KEYS.has(key)) {
        aggregatedRow[key] = value;
        continue;
      }
      // 数值指标 = 对成功轮的稳健融合；非数值/缺测字段保留首轮原值。
      aggregatedRow[key] = metricSeries.has(key) ? summarizeSeries(metricSeries.get(key)).robustMean : value;
    }

    const metrics = {};
    for (const [key, values] of metricSeries) {
      metrics[key] = {
        values: [...values],
        rounds: [...metricRounds.get(key)],
        ...summarizeSeries(values),
      };
    }

    aggregatedRows.push(aggregatedRow);
    playerStats.push({
      playerHrid,
      playerName: templateRow.playerName,
      metrics,
    });
  }

  return { aggregatedRows, playerStats };
}

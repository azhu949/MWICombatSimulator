// 技能触发器优化器 —— 模拟层（payload 构建 + 专用 worker 调用 + 指标提取）。
//
// 本模块把「候选」翻译成「一场可运行的模拟」：
//   buildCandidatePayload  克隆玩家配置 → 只按候选改一个技能的 triggerMap
//                          （applyTriggerStateToTriggerMap 的四态语义，设计 §1/§3.1）
//                          → buildPlayersForSimulation → buildSingleSimulationPayload
//   evaluatePayload        用 trigger-optimizer scope 的专用 worker 跑一场评估：默认把本次
//                          评估的全部种子收进**一个** worker realm（§54 批量路径，省掉每场
//                          一次 realm 新建的固定开销；注入的桩没有批量能力时回退到逐场路径），
//                          同一槽的基线与全部候选共享同一组 seeds = 公共随机数，
//                          按 aggregateRoundMetrics 聚合打分指标与逐轮样本
//   aggregateRoundMetrics  多轮聚合口径：数值取均值、空蓝计数、任一轮失败即失败、保留逐轮样本
//   collectMetrics         simResult → { dps, dailyNoRngProfit, xpPerHour,
//                          killsPerHour, deathsPerHour, ranOutOfMana }
//
// 容错风格对齐 foodOptimizerEvaluation：模拟失败/指标缺失时返回可打分的
// 退化结构（createDegenerateMetrics），搜索层永远拿到一个能喂给 scoreCandidate
// 的对象，而不是异常。取消错误（code:'cancelled'）必须原样上抛，由搜索层
// 按 code 判定，不得被吞成「模拟失败」。
//
// payload.players 是引擎 Player 对象（buildPlayersForSimulation 的输出），
// 候选改的是 triggerMap（配置侧），由 playerMapper 的注入逻辑等价地落到
// Player.abilities[i].triggers（设计 §3.1 的 B 写法）。

import { buildPlayersForSimulation } from './playerMapper.js';
import {
  ONE_HOUR,
  buildSimulationExtra,
  buildSingleSimulationPayload,
  computeQueueMetrics,
  resolveSimResultPlayerHrid,
} from './simulationDomain.js';
import { applyTriggerStateToTriggerMap, ensureTriggerMapEntry } from './triggerMapper.js';
import { deepClone, isPlainObject, toFiniteNumber } from './utils.js';
import { normalizeTriggerOptimizerRounds, TRIGGER_OPTIMIZER_DEFAULT_ROUNDS } from './triggerOptimizerDomain.js';
import { deriveSeedSet, hashSeed } from './seededRandom.js';
import {
  DEDICATED_WORKER_SCOPE_TRIGGER_OPTIMIZER,
  isWorkerRunCancelledError,
  runSimulationBatchWithDedicatedWorker,
  runSingleSimulationPayloadWithDedicatedWorker,
  supportsSimulationBatch,
} from './simulatorWorkerRuns.js';
import { getFoodOptimizerResources } from './foodOptimizerSimulation.js';
import Monster from '../combatsimulator/monster.js';
import Zone from '../combatsimulator/zone.js';

// payload.workerId：worker 内部按 workerId 派生随机流（设计 §3.2 的 RNG 隔离说明）。
export const TRIGGER_OPTIMIZER_WORKER_ID = 'trigger-optimizer';

// 候选的 triggerMap 落盘状态（与 triggerMapper 的 getEffectiveTriggerState 同源）：
//   triggers 为 null/undefined → default（删键）
//   空数组                     → disabled（写 []，引擎语义=冷却好了立即释放，设计 §1.1）
//   非空数组                   → custom（写 sanitize 后的条目）
function resolveCandidateState(candidate) {
  if (!candidate) return null;
  if (candidate.triggers === null || candidate.triggers === undefined) return 'default';
  return Array.isArray(candidate.triggers) && candidate.triggers.length === 0 ? 'disabled' : 'custom';
}

// 就地把一个候选应用到 triggerMap（返回同一个 map 对象，供搜索层更新工作配置与
// 最终 bestTriggerMap 复用）。applyTriggerStateToTriggerMap 的 default 分支是删键、
// disabled 分支写 []、custom 分支跑 sanitizeTriggerList —— 与候选生成器的自查口径
// 完全同源，候选 triggers 已 sanitize，这里再跑一次是幂等的。
export function applyCandidateToTriggerMap(triggerMap, candidate) {
  const map = isPlainObject(triggerMap) ? triggerMap : {};
  const state = resolveCandidateState(candidate);
  if (!state) return map;
  applyTriggerStateToTriggerMap(map, String(candidate.abilityHrid || ''), state, candidate.triggers);
  return map;
}

// 克隆玩家配置并应用候选（candidate=null 表示基线：当前 triggerMap 原样不动）。
// buildPlayersForSimulation 只构建 selected 玩家，因此克隆体强制 selected:true。
export function applyCandidateToPlayerConfig(playerConfig, candidate) {
  const source = isPlainObject(playerConfig) ? playerConfig : {};
  const config = deepClone(source);
  config.selected = true;
  if (!isPlainObject(config.triggerMap)) config.triggerMap = {};
  applyCandidateToTriggerMap(config.triggerMap, candidate);
  return config;
}

// 读取某技能当前的触发器条目（缺失时补默认 DTO 并 sanitize），供搜索层构建
// 「当前配置」锚点。注意它会写入传入的 map，调用方需要传入可变副本。
export function readCurrentTriggers(triggerMap, abilityHrid) {
  const map = isPlainObject(triggerMap) ? triggerMap : {};
  return ensureTriggerMapEntry(map, String(abilityHrid || ''));
}

// 产出可投递给专用 worker 的 payload：zone/labyrinth/time/extra 由
// buildSingleSimulationPayload 按模拟设置序列化，players 是引擎 Player 对象。
//
// 三个优化器专属的 payload 调整（都在此处集中，避免散落）：
//   seed            —— 确定性播种，公共随机数的载体（worker.js 的 installSeedScope）。
//   logCombatEvents —— 关掉：wipe 日志与逐事件控制台输出对只读指标毫无价值。
//   enableHpMpVisualization —— 强制 false：首页若开着血蓝曲线，每场都会把整条时间
//                              序列 postMessage 回来，在「候选数 × 轮数」次评估下
//                              是纯浪费（优化器只读汇总指标）。
//   options.teammates —— 队伍载荷（2026-09-27，设计 §59）：**冻结队友配置**数组（口径 A：
//                      整队进模拟、只改主角触发器）。空数组 = 现状单人载荷，行为逐值不变。
export function buildCandidatePayload(playerConfig, simulationSettings, extra, candidate, options = {}) {
  const config = applyCandidateToPlayerConfig(playerConfig, candidate);
  // 队友只走 applyCandidateToPlayerConfig(teammate, null)：克隆 + 补 triggerMap + 强制
  // selected（buildPlayersForSimulation 只构建 selected 玩家），**不应用任何候选** —— 候选
  // 只改主角，队友的装备 / 技能 / 触发器原样进模拟。players[0] 恒为主角（player1）。
  const teammates = Array.isArray(options.teammates) ? options.teammates.filter((mate) => isPlainObject(mate)) : [];
  const partyConfigs = [config, ...teammates.map((mate) => applyCandidateToPlayerConfig(mate, null))];
  const players = buildPlayersForSimulation(partyConfigs);
  const settings = isPlainObject(simulationSettings) ? simulationSettings : {};
  const baseExtra = isPlainObject(extra) ? extra : buildSimulationExtra(settings);
  const payload = buildSingleSimulationPayload(players, settings, [], {
    workerId: TRIGGER_OPTIMIZER_WORKER_ID,
    extra: { ...baseExtra, enableHpMpVisualization: false },
  });
  payload.logCombatEvents = false;
  if (Number.isFinite(Number(options.seed))) payload.seed = Number(options.seed) >>> 0;
  return payload;
}

// 指标缺失/模拟失败时的退化结构：全零指标 + failed 标记。
// scoreCandidate 对全零指标相对正基线会打出负分，因此退化候选自然被淘汰，
// 搜索不会因为单个 worker 崩溃而中断（foodOptimizerEvaluation 的容错风格）。
// samples 为空数组：配对统计（信号/噪声）拿不到样本时上层退化为「无信号」。
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

// simResult → 打分指标（设计 §2.3）：
//   dps/dailyNoRngProfit/xpPerHour/killsPerHour 取自 computeQueueMetrics，
//   deathsPerHour 直接由 simResult.deaths / 小时 换算（summarizeResult 同口径），
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
const AGGREGATED_METRIC_KEYS = ['dps', 'dailyProfit', 'dailyNoRngProfit', 'xpPerHour', 'killsPerHour', 'deathsPerHour'];

// 单轮抽样里保留给「配对统计」的字段（聚合后仍逐轮留在 samples 里，供打分侧算
// 「改进是信号还是噪声」，见 triggerOptimizerScoring.computePairedStats）。
function pickSampleMetrics(metrics) {
  const sample = {};
  for (const key of AGGREGATED_METRIC_KEYS) sample[key] = toFiniteNumber(metrics?.[key], 0);
  sample.ranOutOfMana = metrics?.ranOutOfMana === true;
  return sample;
}

// 某一轮抽样的 payload：写入该轮的确定性种子（公共随机数的实际入口）。
// workerId 仍带上轮次后缀：它是 worker.js 之外路径（如日志/调试）里唯一的轮次标识，
// 保留可读性，且不参与随机流（随机流只由 payload.seed 决定）。
function buildSeededPayload(payload, seed, round) {
  const base = isPlainObject(payload) ? payload : {};
  const next = { ...base, workerId: `${String(base.workerId || TRIGGER_OPTIMIZER_WORKER_ID)}#r${round + 1}` };
  if (Number.isFinite(Number(seed))) next.seed = Number(seed) >>> 0;
  return next;
}

// N 场抽样的聚合口径：
//   数值指标 = 算术均值（每场时长相同，所以「累计死亡 ÷ 总时长」与死亡率的均值等价）；
//   空蓝     = 任一场出现即标记（**判负不在这里决定**：打分侧只在「基线不空蓝而候选空蓝」
//              时才判负，否则基线自己空蓝的候选会被系统性误杀）；
//   任一场失败 = 整体退化为失败结构（把失败抽样混进均值会得到既不可信也不可复现的分数，
//              还会让「候选被采纳」建立在空气数据上）；没有抽样同样退化。
//   samples  = 逐轮指标，配对统计的原料（同种子下第 i 轮可与参考的第 i 轮直接相减）。
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
    // 聚合自证的抽样场数（UI/报告据此说明「这是几轮抽样」）。
    rounds: list.length,
    samples: list.map(pickSampleMetrics),
  };
}

// 用 trigger-optimizer scope 的专用 worker 跑每个种子一场抽样并聚合指标。
// seeds 决定该次评估的随机流：**同一槽的基线与全部候选必须传同一组 seeds**，
// 否则配对性失效、噪声重新占主导（见 triggerOptimizerDomain.createTriggerOptimizerSeedSet）。
// WorkerClientCtor 是测试桩注入点（生产环境走真实 WorkerClient）。
// 取消错误原样上抛：调用方用 isWorkerRunCancelledError 判定，不当失败处理。
export async function evaluatePayload(
  payload,
  { WorkerClientCtor, pricingOptions, preferredPlayerId, seeds, rounds = TRIGGER_OPTIMIZER_DEFAULT_ROUNDS } = {},
) {
  const resolvedSeeds = resolveEvaluationSeeds(payload, seeds, rounds);
  // §54（2026-09-27）：默认走「一次评估一个 realm」的批量路径 —— 生产端每建一个 realm 都要
  // 付一次模块加载（装置实测 ≈0.43s/场、约占单场墙钟一半），而一次评估的 N 场本来就是串行
  // 跑的，收进同一个 realm 不改变任何样本（装置 parity 16/16 逐位一致）。注入的测试桩没有
  // startSimulationBatch 时回退到逐场路径 —— 既有测试与桩的语义完全不变；单场评估
  //（rounds = 1）没有可摊薄的固定开销，也走原路径。
  if (resolvedSeeds.length > 1 && supportsSimulationBatch(WorkerClientCtor)) {
    const batchPayloads = resolvedSeeds.map((seed, round) => buildSeededPayload(payload, seed, round));
    const batchOptions = { scope: DEDICATED_WORKER_SCOPE_TRIGGER_OPTIMIZER };
    if (typeof WorkerClientCtor === 'function') batchOptions.WorkerClientCtor = WorkerClientCtor;
    const batch = await runSimulationBatchWithDedicatedWorker(batchPayloads, () => {}, batchOptions);
    const batchSamples = [];
    for (let index = 0; index < batchPayloads.length; index += 1) {
      // 单场失败 → 退化结构（与逐场路径的 catch 分支同款）；取消已在批量入口处整批拒绝。
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
    const options = { scope: DEDICATED_WORKER_SCOPE_TRIGGER_OPTIMIZER };
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

// seeds 的解析口径：
//   显式给了非空数组 → 用它（搜索层/复验层的正常路径，同一槽内共享同一组种子）；
//   否则按 rounds 从 payload.workerId 派生一组**确定性**种子——只服务于测试与
//   旧调用方，生产路径永远显式传 seeds（否则配对性无从保证）。
export function resolveEvaluationSeeds(payload, seeds, rounds = TRIGGER_OPTIMIZER_DEFAULT_ROUNDS) {
  const provided = Array.isArray(seeds) ? seeds.filter((seed) => Number.isFinite(Number(seed))) : [];
  if (provided.length > 0) return provided.map((seed) => Number(seed) >>> 0);
  const count = normalizeTriggerOptimizerRounds(rounds);
  return deriveSeedSet(hashSeed(`fallback:${String(payload?.workerId ?? TRIGGER_OPTIMIZER_WORKER_ID)}`), count);
}

// 区域怪物的血量尺度（2026-09-18 新增）：数值类「敌方血量」候选的阈值必须换算自
// **真实怪物血量**，与玩家 maxHp 无关。上一版用玩家 maxHp × 百分比 去近似目标血量，
// 结果是对 500 血的丛林小怪写出 439 的「斩杀线」≈ 恒真（白跑一场模拟），对 4400 血的
// BOSS 又完全是另一个意思——候选的阈值实际上靠运气。
//
// 数据源刻意走引擎自己的口径（不读原始 JSON 猜）：
//   Zone（刷新表 + boss 刷新）→ Monster（**难度缩放后**的属性）。
// 注意难度会改血量：丛林小怪 tier0 = 500、tier4 = 2500，所以必须用同难度构造。
//   min   最小怪血量 —— 「小怪」尺度（斩杀线、单目标防浪费阈值）
//   max   最大怪血量 —— 阈值合法区间上界
//   group 区域随机刷新的怪物血量之和 —— 「一整波」尺度（AOE 的敌方总血量阈值）
//   waveSize 一波怪的**上限**人数（randomSpawnInfo.maxSpawnCount，见 zone.js
//            buildEncounterFromSpawnInfo 的循环上界；实际人数还会被 maxTotalStrength
//            提前截断）—— 「已死怪数」类候选的阈值上界（2026-09-20，设计 §22）。
// 任何失败都返回 null：候选生成器会跳过敌方血量类候选，其余候选不受影响。
export function resolveEnemyHpScale(payload) {
  // 未知区域 hrid 会让 Zone/Monster 构造函数直接抛错（引擎按 actionDetailMap 索引），
  // 而这条路径是**可选增强**：任何失败都必须降级为 null，让候选生成器跳过敌方血量类
  // 候选，绝不能让一个错填的区域 hrid 把整次搜索带崩。
  try {
    const zoneHrid = String(payload?.zone?.zoneHrid ?? '');
    if (!zoneHrid) return null;
    const difficultyTier = Number(payload?.zone?.difficultyTier) || 0;
    const zone = new Zone(zoneHrid, difficultyTier);
    const spawnInfo = zone?.monsterSpawnInfo;
    if (!spawnInfo) return null;
    const readHp = (spawn) => {
      const hrid = String(spawn?.combatMonsterHrid ?? '');
      if (!hrid) return 0;
      const monster = new Monster(hrid, difficultyTier);
      monster.updateCombatDetails();
      return toFiniteNumber(monster.combatDetails?.maxHitpoints, 0);
    };
    const randomSpawns = Array.isArray(spawnInfo.randomSpawnInfo?.spawns) ? spawnInfo.randomSpawnInfo.spawns : [];
    const bossSpawns = Array.isArray(spawnInfo.bossSpawns) ? spawnInfo.bossSpawns : [];
    const randomHp = randomSpawns.map(readHp).filter((hp) => hp > 0);
    const bossHp = bossSpawns.map(readHp).filter((hp) => hp > 0);
    const allHp = [...randomHp, ...bossHp];
    if (allHp.length === 0) return null;
    const group = randomHp.reduce((sum, hp) => sum + hp, 0);
    const waveSize = Math.floor(toFiniteNumber(spawnInfo.randomSpawnInfo?.maxSpawnCount, 0));
    return {
      min: Math.min(...allHp),
      max: Math.max(...allHp),
      group: group > 0 ? group : Math.max(...allHp),
      // 读不到（缺字段/非数字）→ 0：调用方据此跳过「已死怪数」类候选，
      // 而不是拿 0 当上界生成一批恒假的候选。
      waveSize: waveSize > 0 ? waveSize : 0,
    };
  } catch (error) {
    return null;
  }
}

// 数值类候选（current_hp/missing_hp 等）的 value 是绝对值，必须取自基线模拟的
// 真实战斗属性（设计 §6.3）。走 getFoodOptimizerResources 同款路径：构造模拟器
// → reset → initializeCombatPlayers → 读 maxHitpoints/maxManapoints。
// 该路径不吃迷宫输入（食物优化器自身的限制）且依赖完整游戏数据，任何失败都
// 降级为返回 null —— 候选生成器会跳过数值类候选，只保留非数值锚点。
// enemyHp 是 2026-09-18 新增的第二个尺度来源（敌方血量，见上方注释）。
export function resolveOptimizerResources(payload, preferredPlayerId) {
  try {
    const resources = getFoodOptimizerResources({ activePlayerId: preferredPlayerId, payload });
    const maxHp = Number(resources?.maxHp);
    const maxMp = Number(resources?.maxMp);
    if (!Number.isFinite(maxHp) && !Number.isFinite(maxMp)) return null;
    let enemyHp = null;
    try {
      enemyHp = resolveEnemyHpScale(payload);
    } catch (error) {
      enemyHp = null;
    }
    return {
      maxHp: Number.isFinite(maxHp) ? maxHp : null,
      maxMp: Number.isFinite(maxMp) ? maxMp : null,
      // 敌方血量尺度独立降级：读不到时只跳过「敌方血量」类候选，数值锚点照旧。
      enemyHp,
    };
  } catch (error) {
    return null;
  }
}

// 技能触发器优化器 —— 搜索引擎（配对 coordinate descent + 并行 worker 池）。
//
// 纯异步函数，不依赖 Vue/store。算法：
//   1. 用**搜索种子集**评估基线（当前 triggerMap）→ reference = 基线
//      （reference 是「当前工作配置在同一组种子下的指标」，是后续全部比较的配对参考）
//   2. 每一轮按槽优先级逐技能扫一遍：并行评估该技能的全部候选（其余槽保持当前最优，
//      且**沿用同一组种子**）→ 每个候选的 paired = 与 reference 的逐轮配对统计
//      → 分数 = 候选聚合指标 vs reference 聚合指标（**增量分**）→ 取最优
//   3. 采纳条件见 shouldAdoptCandidate（增量分 ≥ 最小效应量 且 配对证据过噪声地板）；
//      采纳后 **reference 直接换成 winner 的指标** —— winner 与 reference 只差这一个槽，
//      所以它的指标就是「新工作配置」的指标，**零额外模拟**即可保持配对链不断。
//      注意 winner.score 是相对**当时** reference 的增量分：它既不是「相对基线的总分」
//      （报告总分由 buildImprovement 按基线参考系现算），也不能当后续槽的门槛 ——
//      跨参考系比较会把每个槽的门槛抬高，系统性压制多槽叠加（实测缺陷 + 修正：设计 §16.9）。
//   4. 一轮无改进 → 固定点；否则继续，最多 maxRounds 轮
//   4b. 跨槽联合探针（设计 §19.11）：每轮槽循环结束后，对合格槽对各评估一次**联合配置**
//      （两个候选同时应用，相对轮起参考比较）——单槽增量的证据在低轮数下功效不足
//      （实测 AB vs 已采纳的 B p=0.107），联合比较把一对配置的收益并进同一分子后能过闸；
//      采纳时两槽一起写回（已落地的成员幂等）。
//   5. 复验：换**另一组种子**重跑「基线 vs 最优」并做配对比较，回答
//      「这个提升在新随机流下还成立吗」。搜索期的提升若只是某组种子的运气，这一步会把它
//      暴露出来（旧实现没有这一步，报告里的提升无法证伪）。
//
// 为什么必须配对：见 services/seededRandom.js 与 triggerOptimizerDomain.createTriggerOptimizerSeedSet。
// 未播种时「候选 vs 基线」的差异里随机噪声占主导，优化器实际在挑「哪次抽样运气好」，
// 这既让结论不可复现，也正是「应用后与预期不符」的根因。
//
// 取消（设计 §4.3）：模块级单运行标志 + cancelTriggerOptimizerRun()，
// 取消时置标志并 stopTriggerOptimizerWorkerRuns()，在途任务以 code:'cancelled'
// 拒绝；optimizeTriggers 每个任务预留前都调 ensureActive，取消抛
// createWorkerRunCancellationError，搜索层捕获后按 cancelled 语义收尾，不把它当失败。
//
// 并发互斥：自身重入与共享 worker 运行冲突时直接报短理由拒绝（对齐
// simulatorSimulationActions.startSimulation 的互斥校验风格），不硬冲。
// 队列/顾问/食物优化器的互斥由 store 层的 busy 闸门负责（设计 §4.2）。

import { runParallelWorkerPool } from './workerPool.js';
import { normalizeParallelWorkerLimit, QUEUE_PARALLEL_WORKER_LIMIT_MAX } from './queueScoring.js';
import {
  DISTANCE_ANCHOR,
  buildCandidateConfigs,
  buildRefinedCandidates,
  buildRefinementCandidates,
} from './triggerOptimizerCandidates.js';
import {
  TRIGGER_OPTIMIZER_DEEP_DIVE_ROUNDS,
  TRIGGER_OPTIMIZER_RACING_KEEP,
  TRIGGER_OPTIMIZER_RACING_MIN_POOL,
  TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS,
  TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS,
  TRIGGER_OPTIMIZER_SCREEN_ROUNDS,
  TRIGGER_OPTIMIZER_SEED_SALT_DEEP_DIVE,
  TRIGGER_OPTIMIZER_SEED_SALT_ROBUSTNESS,
  TRIGGER_OPTIMIZER_SEED_SALT_SCREEN,
  TRIGGER_OPTIMIZER_SEED_SALT_SEARCH,
  TRIGGER_OPTIMIZER_SEED_SALT_VERIFY,
  TRIGGER_OPTIMIZER_SEED_SALT_VERIFY_APPEND,
  TRIGGER_OPTIMIZER_VERIFY_ROUNDS,
  createTriggerOptimizerSeedSet,
  normalizeTriggerOptimizerRounds,
  normalizeTriggerOptimizerVerifyRounds,
  normalizeTriggerOptimizerAppendPlan,
  normalizeTriggerOptimizerRobustnessAppendRounds,
  normalizeTriggerOptimizerRobustnessPlan,
  normalizeTriggerOptimizerRobustnessRounds,
  normalizeTriggerOptimizerSettings,
} from './triggerOptimizerDomain.js';
import {
  compareCandidates,
  computePairedStats,
  isAdoptionBlockedByEvidence,
  scoreCandidate,
  shouldAdoptCandidate,
  summarizeDeltas,
} from './triggerOptimizerScoring.js';
import {
  aggregateRoundMetrics,
  applyCandidateToPlayerConfig,
  applyCandidateToTriggerMap,
  buildCandidatePayload,
  evaluatePayload,
  resolveOptimizerResources,
} from './triggerOptimizerSimulation.js';
import {
  createWorkerRunCancellationError,
  hasHomeMultiRoundWorkerRunInProgress,
  hasSharedWorkerRunInProgress,
  isWorkerRunCancelledError,
} from './simulatorWorkerRuns.js';
import {
  cancelTriggerOptimizerRun,
  hasTriggerOptimizerRunInProgress,
  registerTriggerOptimizerRun,
  unregisterTriggerOptimizerRun,
} from './triggerOptimizerRunRegistry.js';
import { deepClone, isPlainObject, toFiniteNumber } from './utils.js';

// 进度上报节流（设计 §10：150ms，仿 foodOptimizerSearch 的 publish）。
const PROGRESS_THROTTLE_MS = 150;

const TRIGGER_OPTIMIZER_BUSY_ERROR = 'Trigger optimizer is already running.';
const SHARED_RUN_BUSY_ERROR = 'Another simulation is in progress.';
const MISSING_PLAYER_ERROR = 'Player configuration is required.';
const MISSING_TRIGGER_MAP_ERROR = 'Both the search-start and the best trigger maps are required.';

// 服务层入口闸门（4 个公开入口共用）：触发器运行注册表 + 共享 realm 句柄 + 首页多轮批
// 句柄三查——模块级句柄与 isSimulationBusy 的清单保持同集（新增模块级运行标志时在这里
// 同步，store 侧清单见 simulatorRunConflicts.js）。store 层 triggerOptimizerBusy 是主
// 闸门；本函数覆盖服务层可见的模块级事实，防止绕过 store 的直接调用穿透纵深防线
//（首页多轮批只注册专用句柄，漏查会与它在共享保活单例上互相 supersede、多轮批被静默取消）。
function assertTriggerOptimizerEntranceClear() {
  if (hasTriggerOptimizerRunInProgress()) throw new Error(TRIGGER_OPTIMIZER_BUSY_ERROR);
  if (hasSharedWorkerRunInProgress()) throw new Error(SHARED_RUN_BUSY_ERROR);
  if (hasHomeMultiRoundWorkerRunInProgress()) throw new Error(SHARED_RUN_BUSY_ERROR);
}

// 自适应阈值精炼的级数上限（B2，2026-09-19）：步长序列 ±10 → ±5 → ±5 …
// 网格间隔 25 个百分点 ⇒ 内部最优最多偏离「最佳格点」±12.5pp；第 1 级覆盖 10pp、之后每级
// 5pp，4 级累计可行走 25pp（整个网格跨度）。同时是成本护栏：每级 2 次评估，每槽每次
// 采纳最多 8 次（典型 1~2 级）。步长下限 5pp 的实证（2026-09-24 二分对照无提升）见 §32。
export const TRIGGER_OPTIMIZER_REFINEMENT_MAX_LEVELS = 4;

// 槽优先级（设计 §7.3）：特殊技能槽（index 0）最先，然后按角色预期影响排序。
const ROLE_PRIORITY = {
  damage: 0,
  buff: 1,
  debuff: 2,
  defense: 3,
  healing: 4,
  aura: 5,
  unknown: 6,
};

// 模块级运行状态由 triggerOptimizerRunRegistry 承载（store 层需要同步访问，
// 且不能静态 import 本模块——见注册表的归属说明）。此处 re-export，保持既有
// 调用方（含测试）从本模块导入的路径不变。
export { cancelTriggerOptimizerRun, hasTriggerOptimizerRunInProgress };

function slotPriority(choice) {
  if (choice.slotIndex === 0) return -1; // 特殊技能槽
  return ROLE_PRIORITY[choice.role] ?? ROLE_PRIORITY.unknown;
}

function prioritizeChoices(choices) {
  return [...choices].sort(
    (left, right) => slotPriority(left) - slotPriority(right) || left.slotIndex - right.slotIndex,
  );
}

function resolveWeights(source, settings) {
  // 接受 {weightProfit, weightXp}（或 resolveQueuePerformanceSubweights 的完整输出），
  // 缺省回落到设置里的目标权重。
  if (isPlainObject(source) && Object.keys(source).length > 0) return source;
  return settings.objectiveWeights;
}

function createProgressPublisher(onProgress, startedAt) {
  let lastPublishAt = 0;
  return (payload, force = false) => {
    if (typeof onProgress !== 'function') return;
    const now = Date.now();
    if (!force && now - lastPublishAt < PROGRESS_THROTTLE_MS) return;
    lastPublishAt = now;
    onProgress({ ...payload, elapsedSeconds: (now - startedAt) / 1000 });
  };
}

// 候选在报告里的唯一键：**槽位 + 签名**。
// 只按签名做键会串味：不同技能完全可能生成同一份触发器列表（例如两个技能都取
// 「自身蓝量 >= 30%」），共用一条记录会让 A 技能的分数显示在 B 技能的候选行上。
function candidateKey(slotIndex, signature) {
  return `${Number(slotIndex)}|${String(signature ?? '')}`;
}

// 外部传入基线（input.baselineMetrics）的复用前提是**配对性**：它必须带与本次
// settings.rounds 等长的逐轮样本（samples）。否则 computePairedStats 直接返回 null →
// 采纳闸门（hasAdoptionEvidence）永远拒绝采纳，搜索会静默退化成「只看不采纳」。
// 宁可重新评估一次基线（成本 = rounds 场模拟），也不接受无法配对的参考。
function resolveReusableBaselineMetrics(candidate, rounds) {
  if (!isPlainObject(candidate) || Object.keys(candidate).length === 0) return null;
  const samples = Array.isArray(candidate.samples) ? candidate.samples : null;
  if (!samples || samples.length !== Number(rounds)) return null;
  return candidate;
}

// 「同一位玩家 + 另一份 triggerMap」的配置（换难度复核用）：先走 applyCandidateToPlayerConfig
// 拿到带 selected:true 的深拷贝副本（与搜索期构建 payload 的路径完全一致），再把整份 map 换掉。
// 整份替换而不是逐键 apply：复核的对照是**报告里的两份 map 快照**（含「键被删掉 = 回落到游戏
// 默认触发器」这一语义），逐键应用做不到「删除」。
function configWithTriggerMap(playerConfig, triggerMap) {
  const config = applyCandidateToPlayerConfig(playerConfig, null);
  config.triggerMap = deepClone(isPlainObject(triggerMap) ? triggerMap : {});
  return config;
}

// ── racing 分级采样（2026-09-24，设计 §30；§20.1 路线③）────────────────────────
// 大候选池先粗筛（SCREEN_ROUNDS 场、独立盐）、幸存者再精测（settings.rounds 场、search 盐）。
// 粗筛必须换盐：「谁进精测」正是用粗筛样本选出来的（select on A），精测的采纳统计若混入
// 粗筛样本就是可选停时（§21 的教训）——两组样本天然分割，精测的 t 检验才有效。
// 安全性依据（§20.1 自助实测）：n=2 粗筛保留 top-3 时真最优 100% 不被淘汰；残余风险是
// 漏采、不是误采（无提升槽的假采纳 ≈ 0%）。
// 队伍载荷（2026-09-27，设计 §59）：input.teammates = **冻结队友配置**数组（口径 A：整队模拟、
// 只改主角触发器）。搜索 / 复核 / 追加复验四条链路共用本解析器，保证「复核用的载荷与搜索时逐字段
// 一致」—— 否则复核结论会在另一个载荷上得出，与报告自证的适用范围不符。空数组 = 单人载荷。
function resolveSearchTeammates(input) {
  return isPlainObject(input) && Array.isArray(input.teammates)
    ? input.teammates.filter((mate) => isPlainObject(mate))
    : [];
}

export function isRacingPool(candidateCount) {
  return Number(candidateCount) > TRIGGER_OPTIMIZER_RACING_MIN_POOL;
}

// 幸存者 = 粗筛 top-K ∪ 锚点（distance 0：「当前配置」/「游戏默认」）。锚点必须保送：
// 它们是「保持现状」的语义锚（报告的「本槽最优」要能落回 0 分锚点上），粗筛里被噪声
// 挤出 top-K 不等于不值得精测。返回值保持粗筛排名顺序（确定性）。
export function pickRacingSurvivors(entries) {
  const ranked = entries.filter(Boolean).sort(compareCandidates);
  const picked = new Set();
  for (const entry of ranked) {
    if (picked.size >= TRIGGER_OPTIMIZER_RACING_KEEP) break;
    picked.add(entry);
  }
  for (const entry of ranked) {
    if (Number(entry?.distance) === DISTANCE_ANCHOR) picked.add(entry);
  }
  return ranked.filter((entry) => picked.has(entry));
}

// optimizeTriggers(input, callbacks)
//
// input = {
//   playerConfig,        // 必填：玩家配置（store.players 里的形态，含 abilities/triggerMap）
//   simulationSettings,  // 必填：首页模拟设置（zone/difficulty/time/extra 由它序列化）
//   extra,               // 可选：直接覆盖 payload.extra
//   weights,             // 可选：{weightProfit, weightXp,...}，缺省取 settings.objectiveWeights
//   settings,            // 可选：优化器设置（maxRounds/candidateLimit/rounds/lockedAbilityHrids/…）
//   baselineMetrics,     // 可选：复用已评估过的基线指标 —— **必须是在搜索种子集下、
//                        //   且带 settings.rounds 条逐轮样本（samples）**的指标，否则
//                        //   配对性无从成立、采纳闸门会永远拒绝（见
//                        //   resolveReusableBaselineMetrics）。生产路径不传，现场评估。
//   pricing,             // 可选：{priceTable, consumableMode} 或 pricingOptions，供利润口径
//   parallelWorkerLimit, // 可选：期望并行 worker 数（normalizeParallelWorkerLimit 归一）
//   parallelWorkerHardMax, // 可选：硬上限（store.queueParallelWorkerHardMax）
//   WorkerClientCtor,    // 可选：测试桩注入点
// }
//
// callbacks = { onProgress, onRound, onCancel }
//   onProgress(update)  节流 150ms；update = { phase, progress, elapsedSeconds, round,
//                       slotIndex, abilityHrid, role, workerLimit, evaluations,
//                       totalEvaluations, simulations, totalSimulations, bestScore }
//   onRound(round, summary) 每轮结束；summary = { round, improvedSlots, bestScore, evaluations }
//   onCancel()          搜索被取消时调用一次
//
// 返回（始终 resolve，取消也返回结构化结果）：
//   { cancelled, rounds, perAbilityChoices, metricsByCandidate, deepDives, jointAdoptions,
//     adoptedSlots, baselineMetrics, referenceMetrics, bestTriggerMap, improvement, verification,
//     resourcesAvailable, evidenceBlocked, roundLimitReached, evaluations, simulations,
//     evaluationRounds, maxConcurrentWorkers, workerLimit, elapsedSeconds, error,
//     baselineTriggerMap, evaluationScope }
// baselineTriggerMap（2026-09-23，设计 §29）：**搜索起点配置**的 triggerMap 快照。搜索过程中
// workingConfig 是克隆体、bestTriggerMap 原地改写，报告里原本没有任何字段能复原「起点长什么样」，
// 而换难度复核要的正是「最优 vs 起点」这一对配置。键缺失 = 该技能用游戏默认触发器。
// evaluationScope：本报告的适用范围（实际目标 hrid + 难度 + 时长）—— 触发器是全局技能配置，
// 而搜索只在单目标上评估，UI 与应用者都必须知道结论是在哪个区域/难度上得出的。
// deepDives（2026-09-19 设计 §18.1；2026-09-20 改独立种子，设计 §21）：被噪声地板拦下的
// 槽级最优候选的加密复核记录（每槽最多一条）——用独立盐的 6 轮新样本重判，通过则采纳
// （记录 adopted=true，并带上本次用的 seeds）；仍不足则 adopted=false，报告据此说明
// 「不是没找到，是证据不够」。
// jointAdoptions（2026-09-19，设计 §19.11）：被**联合采纳**的槽对记录（只含采纳成功的，
// 每采纳一条；含相对轮起参考的统计量与相对当前工作配置的边际均值）——单槽增量证据不足、
// 但一对配置相对轮起参考显著时，两槽一起落地。
export async function optimizeTriggers(input = {}, callbacks = {}) {
  assertTriggerOptimizerEntranceClear();

  const playerConfig = isPlainObject(input.playerConfig) ? input.playerConfig : null;
  if (!playerConfig) throw new Error(MISSING_PLAYER_ERROR);

  const { onProgress, onRound, onCancel } = callbacks || {};
  const simulationSettings = isPlainObject(input.simulationSettings) ? input.simulationSettings : {};
  const extra = input.extra;
  const settings = normalizeTriggerOptimizerSettings(input.settings);
  const weights = resolveWeights(input.weights, settings);
  const pricing = isPlainObject(input.pricing) ? input.pricing : {};
  const pricingOptions = isPlainObject(pricing.pricingOptions)
    ? pricing.pricingOptions
    : isPlainObject(pricing.priceTable)
      ? pricing
      : {};
  const preferredPlayerId = String(playerConfig.id ?? '1');
  const WorkerClientCtor = typeof input.WorkerClientCtor === 'function' ? input.WorkerClientCtor : undefined;
  const workerLimit = normalizeParallelWorkerLimit(
    input.parallelWorkerLimit ?? settings.parallelWorkerLimit,
    input.parallelWorkerHardMax ?? settings.parallelWorkerHardMax ?? QUEUE_PARALLEL_WORKER_LIMIT_MAX,
  );

  // 三套种子：粗筛 lane（racing，设计 §30）、精测 lane（配对参考链）与复验期（独立随机流）。
  // 见 seededRandom.js 与 triggerOptimizerDomain 的种子集说明（各盐必须互不相同）。
  const seedContext = { playerId: preferredPlayerId, playerConfig, simulationSettings };
  const screenSeeds = createTriggerOptimizerSeedSet({
    ...seedContext,
    salt: TRIGGER_OPTIMIZER_SEED_SALT_SCREEN,
    count: TRIGGER_OPTIMIZER_SCREEN_ROUNDS,
  });
  const searchSeeds = createTriggerOptimizerSeedSet({
    ...seedContext,
    salt: TRIGGER_OPTIMIZER_SEED_SALT_SEARCH,
    count: settings.rounds,
  });
  const verifySeeds = createTriggerOptimizerSeedSet({
    ...seedContext,
    salt: TRIGGER_OPTIMIZER_SEED_SALT_VERIFY,
    count: TRIGGER_OPTIMIZER_VERIFY_ROUNDS,
  });

  const run = { cancelRequested: false };
  registerTriggerOptimizerRun(run);
  // 计时原点：调用方（store）把自己的运行起点放进 input.startedAt，报告与每次进度上报的
  // elapsedSeconds 就与页面「自点击开始搜索」的时钟同口径 —— 否则准备段（动态导入 +
  // 构建模拟玩家）只算在页面侧、不在报告里，跑完那一刻数字会往回缩一截。
  // 缺省仍退回自己的起点（旧调用方与测试的语义不变）。
  const startedAt = Number(input.startedAt) || Date.now();
  const publish = createProgressPublisher(onProgress, startedAt);

  const metricsByCandidate = {};
  const roundSummaries = [];
  const perAbilityChoices = [];
  // 深挖记录（设计 §18.1）：每个被噪声地板拦下的槽最多一条，随报告上抛。
  const deepDives = [];
  // 跨槽联合采纳记录（设计 §19.11）：只记**真正被采纳**的联合对（每次采纳一条），形如
  // { round, slots, abilityHrids, rounds, score, mean, stdError, pValue, verdict,
  //   marginalMean, adoptedSlots }。数组原地累积，finally 不需要快照（与 deepDives 同款；
  //   adoptedSlots 是 Set 且被整体读走，才有快照问题）。
  const jointAdoptions = [];
  // 真正被采纳过的槽位（2026-09-19 实测补记）：`chosen` 会记录「槽内最优」——即使它因
  // 证据不足没被采纳。UI 若只看 chosen 就会给一个**没被采纳**的候选挂「推荐」徽章，
  // 与同屏的「证据不足 / 已优化 0 / N」自相矛盾。这里单独记账，UI 用它决定是否推荐。
  const adoptedSlots = new Set();
  // 复用外部基线的门槛见 resolveReusableBaselineMetrics：必须带等长逐轮样本（配对前提）。
  let baselineMetrics = resolveReusableBaselineMetrics(input.baselineMetrics, settings.rounds);
  let referenceMetrics = baselineMetrics;
  // 粗筛参考（racing，设计 §30）：当前工作配置在粗筛种子下的测量。lazy —— 只有真正
  // 启用粗筛的槽需要它，小候选池路径一次都不付这两场模拟的成本；采纳后由 winner 的
  // 粗筛测量接续（零额外模拟），精炼/联合采纳改写配置时置空、由下一个粗筛槽按需补测。
  let referenceScreenMetrics = null;
  let workingConfig = null;
  let bestTriggerMap = null;
  let best = null;
  let choices = [];
  let evaluations = 0;
  // 实际模拟场次 = 评估次数 × 重复次数（进度与结果都按它展示，见设计 §5.3）。
  let simulations = 0;
  let activeTasks = 0;
  let maxConcurrentWorkers = 0;
  let verification = null;
  let resourcesAvailable = false;
  // 有没有「分数明显更高、但配对证据不足 → 未采纳」的槽：报告与 UI 据此区分
  // 「真的没有更优配置」与「样本不足没敢采纳」（两者文案不同，见 evidenceBlocked）。
  let evidenceBlocked = false;

  // 「轮数上限截断」标记（2026-09-19，设计 §19.8）：搜索跑满 maxRounds 且**最后一轮仍有
  // 采纳**时置位 —— 循环的早停口径是「一整轮零采纳」，因上限退出意味着固定点还没到、
  // 结果可能没搜完。报告把这一条上抛给 UI，用户才知道「还能再搜」。
  // ⚠️ 必须定义在函数体级（而非 try 内）：finally 里的报告组装要用它，而 catch/finally
  // 访问不到 try 内声明的 let —— 本文件 cumulativeScore 上方有同款说明，勿再踩。
  let roundLimitReached = false;
  // 本次是否启用过粗筛（池子大的槽才会）：随报告上抛（finally 回填），UI/测试据此
  // 核对采样口径。⚠️ 同样必须函数体级声明。
  let racingUsed = false;

  // 最优分口径（2026-09-18 修正，设计 §16.9）：`best.score` 是**增量分**（相对它当时那个
  // reference），不是「最优配置相对基线」的总分 —— 旧实现把它直接当总分上抛，采纳多槽时
  // UI 的「最优得分」只显示最后一笔增量（实测：两次采纳 0.0189 + 0.0247 后仍只显示 0.0247），
  // 且与同屏展示的指标差值（deltas = best − baseline）不同源。
  // 这里统一按**基线这一参考系**现算（纯算术，零额外模拟）：进度 bestScore 与报告的
  // improvement.score 同源；累计 paired 同样按该参考系算出。
  // 定义在函数体级（而非 try 内）：取消/异常收尾分支也要用（catch 块访问不到 try 内的 const）。
  const cumulativeScore = (entry) => scoreCandidate(entry?.metrics ?? baselineMetrics, weights, baselineMetrics);
  const buildImprovement = (entry) => {
    if (!entry) return null;
    return summarizeDeltas(
      { metrics: baselineMetrics, score: scoreCandidate(baselineMetrics, weights, baselineMetrics) },
      {
        metrics: entry.metrics,
        score: cumulativeScore(entry),
        signature: entry.signature ?? 'baseline',
        paired: computePairedStats(entry.metrics, baselineMetrics, weights),
      },
    );
  };

  // 结论适用范围（2026-09-23，设计 §29）：报告自证「这份结论是在哪个目标、哪个难度上得出的」。
  // 触发器写的是全局技能配置，而搜索只在**单一目标**上评估 —— 换难度复核（verifyTriggerOptimizerRobustness）
  // 与 UI 的适用范围标注都读这里，取代「拿当前首页设置去猜当时跑的是什么」。zoneHrid 已按 useDungeon
  // 解析成实际目标 hrid（不再是 zone/dungeon 两个候选键），仿真设置可直接由它重建。
  const evaluationScope = {
    zoneHrid: String(
      (simulationSettings.useDungeon ? simulationSettings.dungeonHrid : simulationSettings.zoneHrid) || '',
    ),
    useDungeon: Boolean(simulationSettings.useDungeon),
    difficultyTier: Math.max(0, Math.floor(toFiniteNumber(simulationSettings.difficultyTier, 0))),
    simulationHours: Math.max(0, Number(simulationSettings.simulationTimeHours) || 0),
    // 队伍载荷（2026-09-27，设计 §59）：报告自证「这份结论是在单人还是整队（哪些队友）上得出的」。
    // 只留 id / name 快照（名字取运行时刻的，玩家后来改名不会改写历史报告）。
    party: resolveSearchTeammates(input)
      .map((mate) => ({ id: String(mate.id ?? ''), name: String(mate.name ?? '') }))
      .filter((entry) => entry.id !== ''),
  };

  const result = {
    cancelled: false,
    rounds: 0,
    perAbilityChoices,
    metricsByCandidate,
    // 深挖记录：{ slotIndex, abilityHrid, rounds, score, mean, stdError, pValue, verdict, adopted }[]。
    deepDives,
    // 跨槽联合采纳记录（设计 §19.11）：只含被采纳的联合对；骨架为空，原地累积（无需 finally 快照）。
    jointAdoptions,
    // 真正被采纳过的槽位（UI 用它决定是否挂「推荐」；chosen 里可能含未被采纳的槽内最优）。
    // ⚠️ 这里只是骨架，真正的值在 finally 里取快照（对象创建时集合还是空的）。
    adoptedSlots: [],
    baselineMetrics: null,
    referenceMetrics: null,
    bestTriggerMap: null,
    // 搜索起点配置（换难度复核的对照侧）与适用范围：前者在 finally 里取快照，
    // 后者由入参算出即可（见上方 evaluationScope 的说明）。
    baselineTriggerMap: null,
    evaluationScope,
    improvement: null,
    verification: null,
    resourcesAvailable: false,
    // 存在「分数足够高但配对证据不足 → 未采纳」的候选（UI 用不同文案说明原因）。
    evidenceBlocked: false,
    // 「轮数上限截断」（2026-09-19，设计 §19.8）：骨架值 false，真正的值在 finally 里回填。
    roundLimitReached: false,
    lockedAbilityHrids: settings.lockedAbilityHrids,
    evaluations: 0,
    simulations: 0,
    // 每次精测评估的抽样轮数（重复次数）：结果里带上它，报告才能自证口径。
    // racing（设计 §30）后另有粗筛 lane：screenRounds 场、只决定「谁进精测」。
    evaluationRounds: settings.rounds,
    screenRounds: TRIGGER_OPTIMIZER_SCREEN_ROUNDS,
    racingKeep: TRIGGER_OPTIMIZER_RACING_KEEP,
    // 本次是否真的启用过粗筛（骨架值 false，真正的值在 finally 里回填）。
    racingUsed: false,
    maxConcurrentWorkers: 0,
    workerLimit,
    elapsedSeconds: 0,
    error: '',
  };

  const ensureActive = () => {
    if (run.cancelRequested) throw createWorkerRunCancellationError();
  };

  // lane='decide'（精测，settings.rounds 场）/ 'screen'（粗筛，SCREEN_ROUNDS 场，设计 §30）。
  // 覆盖口径：精测记录**总是**顶掉粗筛记录（决定性证据上屏）；同 lane 只在分数更高时覆盖
  // —— 后续轮次的「自己 vs 自己」0 分复核点不得抹掉已采纳候选的正分记录（既有口径）。
  const recordMetrics = (choice, candidate, metrics, score, paired, lane = 'decide') => {
    const signature = candidate?.signature;
    if (!signature) return;
    const key = candidateKey(choice.slotIndex, signature);
    const existing = metricsByCandidate[key];
    const record = {
      metrics,
      score,
      paired,
      // 采样口径自证：sampleRounds = 该记录实际的抽样场数。候选表据此标注「粗筛」行，
      // 免得把 2 轮的噪声统计与精测统计混读（依据必须绑定产生它的那批测量）。
      lane,
      sampleRounds: toFiniteNumber(metrics?.rounds, 0),
      slotIndex: choice.slotIndex,
      candidate: deepClone(candidate),
    };
    if (!existing) {
      metricsByCandidate[key] = record;
      return;
    }
    if (lane === 'decide' && existing.lane === 'screen') {
      metricsByCandidate[key] = record;
      return;
    }
    if (lane === existing.lane && score > existing.score) {
      metricsByCandidate[key] = record;
    }
  };

  // 评估一个候选配置：payload 由「工作配置 + 单槽候选」构建，种子缺省固定为**精测**种子集
  // （粗筛 lane 显式传 screenSeeds；深挖路径显式传自己的独立盐种子，见 runDeepDive）。
  const evaluateConfig = async (config, candidate, seeds = searchSeeds) => {
    const payload = buildCandidatePayload(config, simulationSettings, extra, candidate, {
      teammates: resolveSearchTeammates(input),
    });
    return evaluatePayload(payload, { WorkerClientCtor, pricingOptions, preferredPlayerId, seeds });
  };

  let phase = 'error';

  try {
    // ── 基线 ─────────────────────────────────────────────────────
    publish({ phase: 'baseline', progress: 0, workerLimit, evaluations: 0, totalEvaluations: 0 }, true);
    const baselinePayload = buildCandidatePayload(playerConfig, simulationSettings, extra, null, {
      teammates: resolveSearchTeammates(input),
    });
    if (!referenceMetrics) {
      referenceMetrics = await evaluatePayload(baselinePayload, {
        WorkerClientCtor,
        pricingOptions,
        preferredPlayerId,
        seeds: searchSeeds,
      });
    }
    ensureActive();
    baselineMetrics = referenceMetrics;
    result.baselineMetrics = baselineMetrics;
    evaluations += 1;
    // 复用外部传入的基线指标时不额外跑模拟，但仍按一次评估计入进度（既有口径）。
    simulations += settings.rounds;

    // 数值类候选的绝对值换算需要基线模拟的真实战斗属性（设计 §6.3）。
    // 失败时降级为 null：候选生成器跳过需要绝对值的候选，只保留锚点与
    // 「无需绝对值」的组合候选（不会退化成只有两个锚点）。resourcesAvailable 会随
    // 报告上抛，UI 据此提示「数值类候选本次不可用」——静默降级是最难排查的一类问题。
    const resources = resolveOptimizerResources(baselinePayload, preferredPlayerId);
    resourcesAvailable = Boolean(resources);
    choices = buildCandidateConfigs(playerConfig, {
      ...settings,
      ...(resources ? { resources } : {}),
    });

    workingConfig = applyCandidateToPlayerConfig(playerConfig, null);
    bestTriggerMap = deepClone(workingConfig.triggerMap);
    const baselineScore = scoreCandidate(baselineMetrics, weights, baselineMetrics);
    best = { metrics: baselineMetrics, score: baselineScore, signature: 'baseline', distance: 0, paired: null };
    metricsByCandidate.baseline = { metrics: baselineMetrics, score: baselineScore, paired: null, slotIndex: -1 };

    const prioritized = prioritizeChoices(choices);
    for (const choice of prioritized) perAbilityChoices.push({ ...choice, chosen: null });
    // 锁定槽不参与搜索：候选照旧上报（UI 要展示其当前配置），但搜索跳过。
    const searchableChoices = perAbilityChoices.filter((choice) => choice.locked !== true);
    // 槽位 → 报告用的最终选择（见下方采纳分支的「不要覆盖」说明）。
    const chosenBySlot = new Map();
    // 深挖资格（设计 §18.1）：只有「搜索轮数 < 深挖轮数」时才值得扩轮——用户手填的更大
    // 轮数已经把样本覆盖到位，再扩一次没有增量意义。集合按槽位记账，每个槽每次运行最多
    // 深挖一次（在真正触发时才从集合里删除，见下方采纳分支）。
    const deepDiveSlots =
      settings.rounds < TRIGGER_OPTIMIZER_DEEP_DIVE_ROUNDS
        ? new Set(searchableChoices.map((choice) => choice.slotIndex))
        : new Set();

    // 预估评估总数（基线 + 每轮每槽候选数之和 + 精炼 + 深挖 + 复验 2 次），仅作进度分母；
    // 提前停止时进度不会到 1，最终强制发布时置 1。
    // racing（设计 §30）后每槽每轮分两段评估：大候选池 = 全池粗筛 1 次 + 幸存者（top-K ∪
    // 锚点保送，≤ KEEP+2 条）精测 1 次；小池 = 全池精测（原口径，零行为变化）。
    const candidatesPerRound = searchableChoices.reduce((total, choice) => {
      const count = choice.candidates.length;
      return total + (isRacingPool(count) ? count + Math.min(count, TRIGGER_OPTIMIZER_RACING_KEEP + 2) : count);
    }, 0);
    // 粗筛参考（lazy）：存在 racing 槽时多 1 次评估 / SCREEN_ROUNDS 场。精炼/联合采纳改写配置后
    // 还可能补测（每个改写槽后至多一次），这里只按一次计 —— 分母偏小只会让进度条提前到 1
    //（钳制），评估/场次计数器仍是精确值。
    const racingSlotCount = searchableChoices.filter((choice) => isRacingPool(choice.candidates.length)).length;
    const estimatedScreenReference = racingSlotCount > 0 ? 1 : 0;
    // 精炼只在「候选被采纳」后触发，且多级行走的评估数无法精确预估（级数上限 4 ⇒ 上限 8 次
    // 评估，典型 1~2 级 = 2~4 次）：这里按每槽每轮 4 次取典型值（保守侧——实际只在采纳时发生，
    // 签名去重还会压缩重复；即使走得更远，也只会让进度条提前到 1（钳制），评估/场次计数器仍是
    // 精确值）。级数上限直接引用常量，避免「上限改了、分母没跟着改」的静默漂移。
    const refinableSlotCount = searchableChoices.filter((choice) =>
      choice.candidates.some((candidate) => buildRefinedCandidates(candidate, resources).length > 0),
    ).length;
    const estimatedRefinements = TRIGGER_OPTIMIZER_REFINEMENT_MAX_LEVELS * refinableSlotCount * settings.maxRounds;
    // 深挖是「每槽最多一次 × 2 次评估（参考 + 候选）」，按上界计入分母（同上，偏大安全）。
    const estimatedDeepDives = deepDiveSlots.size * 2;
    // 跨槽联合探针（设计 §19.11）：每轮最多 C(可搜槽数, 2) 次评估（单槽输入天然为 0）。
    // 实际只在「存在未落地且增量为正的成员」时才探（多数轮次为 0 次），这里按上界计入分母，
    // 与精炼/深挖的估算同款（偏大安全：提前到 1 只会让进度条钳制，实际计数器仍是精确值）。
    const jointPairCount = (searchableChoices.length * (searchableChoices.length - 1)) / 2;
    const estimatedJointProbes = jointPairCount * settings.maxRounds;
    const totalEvaluations =
      1 +
      estimatedScreenReference +
      settings.maxRounds * candidatesPerRound +
      estimatedRefinements +
      estimatedDeepDives +
      estimatedJointProbes +
      2;
    // 复验的 2 次评估各跑 TRIGGER_OPTIMIZER_VERIFY_ROUNDS 场（与 settings.rounds 无关）；
    // 深挖的 2 次评估各跑 TRIGGER_OPTIMIZER_DEEP_DIVE_ROUNDS 场（同样与 settings.rounds 无关）。
    // 场次估算同理分段（设计 §30）：粗筛段每条 SCREEN_ROUNDS 场、精测段每条 settings.rounds 场。
    const simulationsPerRound = searchableChoices.reduce((total, choice) => {
      const count = choice.candidates.length;
      return (
        total +
        (isRacingPool(count)
          ? count * TRIGGER_OPTIMIZER_SCREEN_ROUNDS +
            Math.min(count, TRIGGER_OPTIMIZER_RACING_KEEP + 2) * settings.rounds
          : count * settings.rounds)
      );
    }, 0);
    const totalSimulations =
      settings.rounds +
      estimatedScreenReference * TRIGGER_OPTIMIZER_SCREEN_ROUNDS +
      settings.maxRounds * simulationsPerRound +
      (estimatedRefinements + estimatedJointProbes) * settings.rounds +
      estimatedDeepDives * TRIGGER_OPTIMIZER_DEEP_DIVE_ROUNDS +
      2 * TRIGGER_OPTIMIZER_VERIFY_ROUNDS;

    // 报告/进度用的最优分口径：cumulativeScore / buildImprovement 定义在函数体级
    // （取消收尾分支也要用，见上方说明）。
    const publishSearch = (round, choice) =>
      publish({
        phase,
        round,
        slotIndex: choice?.slotIndex,
        abilityHrid: choice?.abilityHrid,
        role: choice?.role,
        // 精炼评估数是估算上界（见上），多轮重复采纳时实际值可能超出：钳到 1 避免
        // 进度条倒走或超过 100%，收尾时仍然强制发布 1。
        progress: Math.min(1, evaluations / totalEvaluations),
        workerLimit,
        evaluations,
        totalEvaluations,
        simulations,
        totalSimulations,
        bestScore: cumulativeScore(best),
      });

    // ── 深挖（2026-09-19 新增 §18.1；2026-09-20 改独立种子，设计 §21）────────────
    // 触发条件：某个槽的最优候选「增量分 ≥ 最小效应量、但配对证据没过噪声地板」
    // （isAdoptionBlockedByEvidence）。这类候选在旧实现里只有一个结局——报告写
    // 「有候选更高分，但证据不足」，用户既不知道该不该信，也不知道能不能再测准。
    // 实测（2026-09-18/19）：被 2 轮/3 轮拦下的候选在 5~6 轮下通过噪声地板并被独立
    // 复验确认（p = 0.0131）——「被拦」里有真提升，值得再多花 12 场。
    //
    // 判据数据必须**独立于筛选过程**：旧实现复用同一盐的搜索种子（稳定前缀 ⇒ 相同数据
    // 的延长线），于是「只挑看着快过线的候选加密」本身就把 p 值推乐观（可选停时）。
    // 现在改用独立盐 TRIGGER_OPTIMIZER_SEED_SALT_DEEP_DIVE 的 6 轮**全新**样本：筛选看
    // 在 A 组上、判据只看 B 组，B 组与「谁被复核」的决策无关 ⇒ t 检验有效。
    //
    // 成本：2 次评估 × DEEP_DIVE_ROUNDS 场（默认 12 场），只在被拦时触发、每槽最多一次。
    // 参考侧必须重测：搜索期的参考只有 settings.rounds 条逐轮样本，配对要求等长（换盐
    // 之后两侧都得重新生成样本，单次深挖的成本与旧实现相同）。
    // 参考配置 = 本槽开跑时的当前工作配置（此刻 winner 尚未应用 → workingConfig 就是它）。
    // 已知边界（不要过度解读）：护栏是「每槽一次 + 轮数固定」与最终的独立复验（判负一律
    // 不可应用）；「只复核被拦候选」的多重比较风险由独立样本消解——检验在 B 组上无偏。
    let deepDiveSeeds = null;
    const resolveDeepDiveSeeds = () =>
      (deepDiveSeeds ??= createTriggerOptimizerSeedSet({
        ...seedContext,
        salt: TRIGGER_OPTIMIZER_SEED_SALT_DEEP_DIVE,
        count: TRIGGER_OPTIMIZER_DEEP_DIVE_ROUNDS,
      }));

    const runDeepDive = async (choice, candidate, round) => {
      const seeds = resolveDeepDiveSeeds();
      ensureActive();
      const deepReference = await evaluateConfig(workingConfig, null, seeds);
      evaluations += 1;
      simulations += TRIGGER_OPTIMIZER_DEEP_DIVE_ROUNDS;
      publishSearch(round, choice);
      ensureActive();
      const deepCandidate = await evaluateConfig(workingConfig, candidate, seeds);
      evaluations += 1;
      simulations += TRIGGER_OPTIMIZER_DEEP_DIVE_ROUNDS;
      publishSearch(round, choice);
      const paired = computePairedStats(deepCandidate, deepReference, weights);
      const score = scoreCandidate(deepCandidate, weights, deepReference);
      const entry = { ...candidate, metrics: deepCandidate, score, paired };
      return {
        slotIndex: choice.slotIndex,
        abilityHrid: choice.abilityHrid,
        role: choice.role,
        rounds: TRIGGER_OPTIMIZER_DEEP_DIVE_ROUNDS,
        // 本次复核实际使用的种子（独立盐派生）：报告自证「判据用的是新样本」，
        // 测试据此断言与搜索期/复验种子互不相同（设计 §21）。
        seeds: [...seeds],
        score,
        mean: paired?.score?.mean ?? null,
        stdError: paired?.score?.stdError ?? null,
        pValue: paired?.score?.pValue ?? null,
        verdict: String(paired?.score?.verdict ?? 'unknown'),
        // 深挖采纳判据与槽级采纳**同源**（shouldAdoptCandidate）：最小效应量 + 噪声地板。
        adopted: shouldAdoptCandidate(entry),
      };
    };

    // ── coordinate descent（配对参考链）──────────────────────────────
    // racing 分级采样辅助（设计 §30）：粗筛 lane 与精测 lane 共用，供下方槽循环调用。
    //
    // 粗筛参考（lazy）：粗筛比较同样要配对 —— 「当前工作配置」在**粗筛种子**下的测量。
    // 槽级采纳后直接接续 winner 的粗筛测量（零额外模拟）；精炼/联合采纳改写配置后置空，
    // 由下一个粗筛槽按需补测（SCREEN_ROUNDS 场）。round 由调用方传入（闭包看不到循环变量）。
    const ensureScreenReference = async (round) => {
      if (referenceScreenMetrics) return referenceScreenMetrics;
      ensureActive();
      try {
        referenceScreenMetrics = await evaluateConfig(workingConfig, null, screenSeeds);
      } finally {
        evaluations += 1;
        simulations += TRIGGER_OPTIMIZER_SCREEN_ROUNDS;
        publishSearch(round, null);
      }
      return referenceScreenMetrics;
    };

    // 并行评估一组候选并记账（粗筛/精测共用）：lane='screen' 用粗筛种子 × SCREEN_ROUNDS 场、
    // lane='decide' 用精测种子 × settings.rounds 场；paired/score 都相对**同 lane** 的 reference
    //（配对口径不变）。返回 { entries, metricsBySignature }（entries 与 list 对齐，失败位为 null；
    // metricsBySignature：signature → 该 lane 的 metrics，供采纳后接续粗筛参考）。
    const evaluateCandidateSet = async (choice, list, seeds, lane, reference, laneRounds, round) => {
      const entries = new Array(list.length);
      const metricsBySignature = new Map();
      if (list.length === 0) return { entries, metricsBySignature };
      await runParallelWorkerPool({
        taskCount: list.length,
        workerLimit: Math.min(workerLimit, list.length),
        ensureActive,
        runTask: async (index) => {
          activeTasks += 1;
          maxConcurrentWorkers = Math.max(maxConcurrentWorkers, activeTasks);
          try {
            const candidate = list[index];
            // 其余槽保持当前最优配置（workingConfig），只换本槽的触发器。
            const metrics = await evaluateConfig(workingConfig, candidate, seeds);
            // 配对统计必须在打分之前算好：compareCandidates / shouldAdoptCandidate 都要用。
            const paired = computePairedStats(metrics, reference, weights);
            const score = scoreCandidate(metrics, weights, reference);
            const entry = { ...candidate, metrics, score, paired };
            entries[index] = entry;
            metricsBySignature.set(String(candidate.signature), metrics);
            recordMetrics(choice, candidate, metrics, score, paired, lane);
          } finally {
            activeTasks -= 1;
            evaluations += 1;
            simulations += laneRounds;
            publishSearch(round, choice);
          }
        },
      });
      return { entries, metricsBySignature };
    };

    // 「轮数上限截断」标记在函数体级声明（见 evidenceBlocked 旁的说明）。
    for (let round = 1; round <= settings.maxRounds; round += 1) {
      ensureActive();
      phase = 'searching';
      publishSearch(round, null);

      const improvedSlots = [];
      // 跨槽联合探针（设计 §19.11）的本轮簿记：联合比较与单槽比较共用**轮起参考系**；
      // 成员候选取本轮各槽 top-1；adoptedThisRound 记本轮已落地的槽（成员幂等 / 防重复记账）。
      const roundStartReference = referenceMetrics;
      const roundWinnerBySlot = new Map();
      const adoptedThisRound = new Set();
      for (const choice of searchableChoices) {
        ensureActive();
        const candidates = choice.candidates;
        // 参考指标：本槽开跑时的「当前工作配置」指标（= 上一轮/上一槽采纳后的 winner 指标）。
        // 与候选共享同一组种子，因此 comparison 是配对的。
        const reference = referenceMetrics;
        // racing 分级采样（设计 §30）：候选池大时先粗筛（独立盐、SCREEN_ROUNDS 场，只决定
        // 「谁进精测」）→ 幸存者（top-K ∪ 锚点保送）再精测（search 盐、settings.rounds 场，
        // 采纳判据只看这段 —— 粗筛样本不进判据，select on A / test on B）；小池直接全池精测
        //（原口径，零行为变化）。
        const useRacing = isRacingPool(candidates.length);
        let entries;
        // 幸存者的粗筛测量（signature → metrics）：采纳分支据此把粗筛参考零成本接到 winner 上。
        let screenMetricsBySignature = new Map();
        if (useRacing) {
          racingUsed = true;
          const screenReference = await ensureScreenReference(round);
          const screened = await evaluateCandidateSet(
            choice,
            candidates,
            screenSeeds,
            'screen',
            screenReference,
            TRIGGER_OPTIMIZER_SCREEN_ROUNDS,
            round,
          );
          screenMetricsBySignature = screened.metricsBySignature;
          const survivors = pickRacingSurvivors(screened.entries);
          const decided = await evaluateCandidateSet(
            choice,
            survivors,
            searchSeeds,
            'decide',
            reference,
            settings.rounds,
            round,
          );
          entries = decided.entries;
        } else {
          ({ entries } = await evaluateCandidateSet(
            choice,
            candidates,
            searchSeeds,
            'decide',
            reference,
            settings.rounds,
            round,
          ));
        }

        // 每槽取最优（compareCandidates 的全序保证并列时优先「配对信号强 + 改动更小」）。
        const winner = entries.filter(Boolean).sort(compareCandidates)[0];
        // 本轮 top-1 记进槽位表：联合探针的成员候选来源（未采纳的槽直接用它；已采纳的槽用
        // 已落地的最终形态，见探针前的 resolveJointMember）。
        roundWinnerBySlot.set(choice.slotIndex, winner ?? null);
        // 分数够高但配对证据不足 → 先按「深挖」扩轮复核一次（每槽最多一次，见上方
        // runDeepDive 的说明）；扩轮后证据仍不足才不采纳。报告据此能说出原因（否则用户
        // 只看到「未找到更优配置」，不知道是「真的没有」还是「样本不足」）。
        // ⚠️ 槽级采纳**不传** best：winner.score 是「相对当前工作配置」的增量分，而
        // best.score 是上一个被采纳候选在它自己参考系里的分，两者不同源（跨参考系比较
        // 会把每个槽的门槛抬高 best.score + MIN_ADOPT_SCORE，实测压制多槽叠加，
        // 见 triggerOptimizerScoring.shouldAdoptCandidate 与设计 §16.9）。
        let deepDive = null;
        if (winner && isAdoptionBlockedByEvidence(winner) && deepDiveSlots.has(choice.slotIndex)) {
          deepDiveSlots.delete(choice.slotIndex);
          deepDive = await runDeepDive(choice, winner, round);
          deepDives.push(deepDive);
        }
        const adoptWinner = Boolean(winner) && (shouldAdoptCandidate(winner) || deepDive?.adopted === true);
        if (winner && !adoptWinner && isAdoptionBlockedByEvidence(winner)) evidenceBlocked = true;
        if (adoptWinner) {
          adoptedThisRound.add(choice.slotIndex);
          applyCandidateToTriggerMap(workingConfig.triggerMap, winner);
          applyCandidateToTriggerMap(bestTriggerMap, winner);
          // best 只承担「报告里最优配置」的职责：它的 metrics 是累计后的最优工作配置指标。
          // 注意 best.score 是**增量分**（相对它当时的 reference），不可当总分、亦不可当
          // 后续槽的门槛 —— 报告总分由 buildImprovement 按基线参考系现算。
          best = winner;
          // 配对链延续的关键：winner 与 reference 只差这一个槽，所以 winner 的指标
          // 就是「采纳后的工作配置」在同一组种子下的指标 —— 下一槽直接拿它当参考，
          // **零额外模拟**，且配对性完整保留。
          referenceMetrics = winner.metrics;
          // 粗筛参考同步接续（设计 §30）：winner 的粗筛测量就是「采纳后的工作配置」在粗筛种子
          // 下的指标（同一份配置、换随机流）—— 零额外模拟。非 racing 路径没有粗筛测量 → 置空，
          // 由下一个粗筛槽按需补测。
          referenceScreenMetrics = screenMetricsBySignature.get(String(winner.signature)) ?? null;
          if (!improvedSlots.includes(choice.slotIndex)) improvedSlots.push(choice.slotIndex);
          adoptedSlots.add(choice.slotIndex);
          // 采纳者的分数是相对**当时**参考算出来的（有意义的正提升），必须记下来。
          chosenBySlot.set(choice.slotIndex, winner);

          // ── 自适应阈值精炼（设计 §6.3；多级迭代 B2，2026-09-19）──────────────
          // 固定阈值网格粒度粗（25 个百分点），最优阈值常落在格点之间。这里对「刚被采纳的
          // 单条件数值类候选」做**多级**邻域搜索：第 1 级 ±10、之后 ±5（下限），每级只在
          // 上一级被证明更优（严格采纳）后才继续 —— 成本只花在还在改进的槽上；签名去重让
          // 「已走过的点」自动跳过（自然终止），级数另有安全上限（见常量注释）。精炼候选与
          // 该槽其它候选共享同一个 reference 与同一组 searchSeeds（配对口径不变），因此
          // shouldAdoptCandidate(refineWinner, refineBase) 是同一标尺下的「严格更优」判定。
          let refineBase = winner;
          for (let level = 0; level < TRIGGER_OPTIMIZER_REFINEMENT_MAX_LEVELS; level += 1) {
            const refinements = buildRefinedCandidates(refineBase, choice, resources, { level });
            if (refinements.length === 0) break;
            const refineEntries = new Array(refinements.length);
            await runParallelWorkerPool({
              taskCount: refinements.length,
              workerLimit: Math.min(workerLimit, refinements.length),
              ensureActive,
              runTask: async (index) => {
                activeTasks += 1;
                maxConcurrentWorkers = Math.max(maxConcurrentWorkers, activeTasks);
                try {
                  const candidate = refinements[index];
                  // workingConfig 已应用上一级候选，这里只把本槽触发器换成本级精炼阈值。
                  const metrics = await evaluateConfig(workingConfig, candidate);
                  const paired = computePairedStats(metrics, reference, weights);
                  const score = scoreCandidate(metrics, weights, reference);
                  const entry = { ...candidate, metrics, score, paired };
                  refineEntries[index] = entry;
                  recordMetrics(choice, candidate, metrics, score, paired);
                } finally {
                  activeTasks -= 1;
                  evaluations += 1;
                  simulations += settings.rounds;
                  publishSearch(round, choice);
                }
              },
            });

            const refineWinner = refineEntries.filter(Boolean).sort(compareCandidates)[0];
            if (refineWinner && isAdoptionBlockedByEvidence(refineWinner, refineBase)) evidenceBlocked = true;
            // 精炼候选写回候选表：UI 的候选表才能展示它们（分数/paired 已由 recordMetrics
            // 记录），且后续级/下一轮不会重复评估同一配置（签名去重）。未被采纳的精炼候选
            // 分数必然 ≤ refineBase，下一轮不会被误采纳。
            choice.candidates.push(...refinements);
            if (!refineWinner || !shouldAdoptCandidate(refineWinner, refineBase)) break;
            applyCandidateToTriggerMap(workingConfig.triggerMap, refineWinner);
            applyCandidateToTriggerMap(bestTriggerMap, refineWinner);
            best = refineWinner;
            // 精炼者的指标就是「换掉本槽阈值后的工作配置」指标：继续延续配对链，并成为
            // 下一级精炼的基准（同参考系比较的第二个参数）。
            referenceMetrics = refineWinner.metrics;
            // 精炼采纳改写了本槽阈值：旧的粗筛测量对不上这份配置了 → 置空，由下一个粗筛槽
            // 按需补测（SCREEN_ROUNDS 场，设计 §30）。
            referenceScreenMetrics = null;
            chosenBySlot.set(choice.slotIndex, refineWinner);
            adoptedSlots.add(choice.slotIndex);
            refineBase = refineWinner;
          }
        } else if (!chosenBySlot.has(choice.slotIndex)) {
          // 从未被采纳的槽：记下本轮最优，UI 才有的可展示（分数 ≤ 0 = 不如当前配置）。
          chosenBySlot.set(choice.slotIndex, winner ?? null);
        }
        // 注意：采纳后**不要**用后续轮次的 winner 覆盖 chosen。后续轮次里该槽已是
        // 「自己 vs 自己」，分数必然为 0，覆盖会把已经拿到的真实提升从报告里抹掉，
        // 让用户看到「优化了但每项都是 0.0000」——这正是「效果不佳」的观感来源之一。
      }

      // ── 跨槽联合探针（C，2026-09-19，设计 §19.11）────────────────────────
      // 动机（§19.10 熊图 2×2 实测）：两槽交互真实但温和且**次可加**（近似交互项 −0.038）；
      // 漏掉联合提升的根因不是没有协同，而是**增量证据的统计功效**——AB vs 已采纳的 B 在
      // 10 轮下仍 p=0.107，而同一对配置相对现状的联合提升显著（p=0.0118）。逐槽增量判据
      // 永远等不到那一步；联合评估把一对配置的收益并进同一个分子，功效就够了。
      // 规则：
      //   · 成员资格 = 本轮已采纳（收益计入联合，且按其**已落地形态**参与，精炼后的形态不丢）
      //     或 未采纳且增量分为正（待救候选）。两者都不是的槽 —— 包括已采纳的槽在后续轮次里
      //     重新评估出的「分数≈0 的中性复核点」—— 不构成有意义的一对：既省成本，也避免把
      //     已落地的配置换回一个未证明的候选。
      //   · 一对里至少有一个成员是「未采纳」的：两笔都已落地时联合配置就是当前工作配置，
      //     没有可新增的内容。
      //   · 判据 = 联合配置相对**轮起参考**的增量（shouldAdoptCandidate，含噪声地板）且
      //     相对**当前工作配置**的边际均值 > 0（防有害搭车）。联合判据的功效来自「一对配置
      //     合计的收益」；边际项只做符号检查、不要求显著（那正是被功效卡住的地方）。
      //   · 采纳 = 两槽一起写回；已落地的成员是幂等 no-op。联合配置的指标就是采纳后的工作
      //     配置指标 → 直接沿用（零额外模拟延续配对链，与槽级采纳同一手法）。
      // 成本：每轮 ≤ C(可搜槽数, 2) 次评估（5 槽 = 10 次 ≈ +11%），且只在存在合格成员时才跑。
      // 已知边界（勿过度解读）：成员不做精炼；相对轮起参考意味着同轮其它已采纳槽的收益有
      // 轻度「搭车」（由边际符号检查与最终独立复验兜底）。
      const resolveJointMember = (slotIndex) => {
        const winner = roundWinnerBySlot.get(slotIndex);
        if (!winner) return null;
        if (adoptedThisRound.has(slotIndex)) return chosenBySlot.get(slotIndex) ?? winner;
        const score = Number(winner.score);
        return Number.isFinite(score) && score > 0 ? winner : null;
      };
      for (let leftIndex = 0; leftIndex < searchableChoices.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < searchableChoices.length; rightIndex += 1) {
          const leftChoice = searchableChoices[leftIndex];
          const rightChoice = searchableChoices[rightIndex];
          const leftMember = resolveJointMember(leftChoice.slotIndex);
          const rightMember = resolveJointMember(rightChoice.slotIndex);
          if (!leftMember || !rightMember) continue;
          if (adoptedThisRound.has(leftChoice.slotIndex) && adoptedThisRound.has(rightChoice.slotIndex)) {
            continue;
          }
          ensureActive();
          // 联合配置 = 当前工作配置 + 两个成员候选同时应用（已落地的成员是幂等 no-op）。
          const jointConfig = applyCandidateToPlayerConfig(workingConfig, leftMember);
          applyCandidateToTriggerMap(jointConfig.triggerMap, rightMember);
          let jointMetrics;
          try {
            jointMetrics = await evaluateConfig(jointConfig, null);
          } finally {
            evaluations += 1;
            simulations += settings.rounds;
            publishSearch(round, null);
          }
          ensureActive();
          const paired = computePairedStats(jointMetrics, roundStartReference, weights);
          const score = scoreCandidate(jointMetrics, weights, roundStartReference);
          const entry = { metrics: jointMetrics, score, paired };
          const marginal = computePairedStats(jointMetrics, referenceMetrics, weights);
          const marginalMean = Number(marginal?.score?.mean);
          const hasPositiveMarginal = Number.isFinite(marginalMean) && marginalMean > 0;
          if (!shouldAdoptCandidate(entry) || !hasPositiveMarginal) {
            // 证据不足时同样上抛「为什么没采纳」（与槽级采纳同一语义）；边际不满足时不置位：
            // 那是「这一对不值得」，不是「样本不够」。
            if (isAdoptionBlockedByEvidence(entry) && hasPositiveMarginal) evidenceBlocked = true;
            continue;
          }
          const adoptedNow = [];
          for (const [choice, member] of [
            [leftChoice, leftMember],
            [rightChoice, rightMember],
          ]) {
            if (adoptedThisRound.has(choice.slotIndex)) continue;
            applyCandidateToTriggerMap(workingConfig.triggerMap, member);
            applyCandidateToTriggerMap(bestTriggerMap, member);
            chosenBySlot.set(choice.slotIndex, member);
            adoptedSlots.add(choice.slotIndex);
            adoptedThisRound.add(choice.slotIndex);
            if (!improvedSlots.includes(choice.slotIndex)) improvedSlots.push(choice.slotIndex);
            adoptedNow.push(choice.slotIndex);
          }
          // 联合配置就是采纳后的工作配置：指标直接沿用（零额外模拟延续配对链）。
          referenceMetrics = jointMetrics;
          // 联合采纳同时改写了两槽触发器：旧的粗筛测量对不上这份配置 → 置空，下一个粗筛槽
          // 按需补测（SCREEN_ROUNDS 场，设计 §30）。
          referenceScreenMetrics = null;
          best = {
            metrics: jointMetrics,
            score,
            paired,
            signature: `joint:${String(leftMember.signature)}|${String(rightMember.signature)}`,
          };
          jointAdoptions.push({
            round,
            slots: [leftChoice.slotIndex, rightChoice.slotIndex],
            abilityHrids: [String(leftChoice.abilityHrid), String(rightChoice.abilityHrid)],
            rounds: settings.rounds,
            score,
            mean: paired?.score?.mean ?? null,
            stdError: paired?.score?.stdError ?? null,
            pValue: paired?.score?.pValue ?? null,
            verdict: String(paired?.score?.verdict ?? 'unknown'),
            marginalMean: Number.isFinite(marginalMean) ? marginalMean : null,
            adoptedSlots: adoptedNow,
          });
        }
      }

      const summary = {
        round,
        improvedSlots,
        bestScore: best.score,
        evaluations,
      };
      roundSummaries.push(summary);
      onRound?.(round, summary);
      publishSearch(round, null);

      // 走满上限：最后一轮仍在采纳 → 固定点还没到（早停口径是「一整轮零采纳」），结果可能
      // 没搜完。报告据此上抛（设计 §19.8），UI 给出「提高上限 / 换精细档再跑」的下一步。
      if (round === settings.maxRounds && improvedSlots.length > 0) roundLimitReached = true;

      // 固定点：一轮内没有任何槽被改进 → 停止（设计 §7.2）。
      if (improvedSlots.length === 0) break;
    }

    // 回填报告用选择：采纳过的槽保留「采纳时的 winner」（有意义的正分数），
    // 从未采纳的槽保留最后一轮的最优（分数 ≤ 0，UI 据此显示「保持当前配置」）。
    for (const choice of perAbilityChoices) {
      choice.chosen = chosenBySlot.get(choice.slotIndex) ?? null;
    }

    result.rounds = roundSummaries.length;

    // ── 独立复验 ───────────────────────────────────────────────────
    // 用**另一组种子**重跑「基线 vs 最优」，回答「提升在新随机流下还成立吗」。
    // 搜索期的最好结果若只是某组种子的运气，这一步会给出 inconclusive/negative。
    // 轮数固定为 TRIGGER_OPTIMIZER_VERIFY_ROUNDS（6）：只跑两个配置，成本
    // 2 × 6 = 12 场模拟，却换来自由度 5 的 t 检验与真实的 p 值 —— 搜索期因为成本
    // 只能廉价抽样（默认 2 轮），统计功效集中花在最终结论上是更划算的分配。
    ensureActive();
    phase = 'verifying';
    publish({ phase, progress: evaluations / totalEvaluations, workerLimit, evaluations, totalEvaluations }, true);
    const verifyBaseline = await evaluatePayload(
      buildCandidatePayload(playerConfig, simulationSettings, extra, null, {
        teammates: resolveSearchTeammates(input),
      }),
      {
        WorkerClientCtor,
        pricingOptions,
        preferredPlayerId,
        seeds: verifySeeds,
      },
    );
    evaluations += 1;
    simulations += TRIGGER_OPTIMIZER_VERIFY_ROUNDS;
    ensureActive();
    const verifyBest = await evaluatePayload(
      buildCandidatePayload(workingConfig, simulationSettings, extra, null, {
        teammates: resolveSearchTeammates(input),
      }),
      {
        WorkerClientCtor,
        pricingOptions,
        preferredPlayerId,
        seeds: verifySeeds,
      },
    );
    evaluations += 1;
    simulations += TRIGGER_OPTIMIZER_VERIFY_ROUNDS;
    const verifyPaired = computePairedStats(verifyBest, verifyBaseline, weights);
    verification = {
      baselineMetrics: verifyBaseline,
      bestMetrics: verifyBest,
      paired: verifyPaired,
      verdict: verifyPaired?.score?.verdict ?? 'unknown',
      seeds: verifySeeds,
      rounds: TRIGGER_OPTIMIZER_VERIFY_ROUNDS,
    };

    // 报告总分按**基线参考系**现算（口径说明见 buildImprovement）。
    result.improvement = buildImprovement(best);
    result.verification = verification;
    phase = 'done';
  } catch (error) {
    if (run.cancelRequested || isWorkerRunCancelledError(error)) {
      result.cancelled = true;
      phase = 'cancelled';
      result.rounds = roundSummaries.length;
      result.improvement = buildImprovement(best);
      onCancel?.();
    } else {
      result.error = error?.message || String(error);
      result.cancelled = false;
      publish({ phase: 'error', progress: evaluations, workerLimit, evaluations, error: result.error }, true);
      throw error;
    }
  } finally {
    unregisterTriggerOptimizerRun(run);
    result.evaluations = evaluations;
    result.simulations = simulations;
    // racing 回填（设计 §30）：骨架值 false，真正的值在这里取（racingUsed 是函数体级 let，
    // 与 adoptedSlots 的 finally 快照同款）。
    result.racingUsed = racingUsed;
    result.maxConcurrentWorkers = maxConcurrentWorkers;
    result.bestTriggerMap = bestTriggerMap;
    // 搜索起点配置（2026-09-23，设计 §29）：换难度复核要拿它当对照。这里也走**快照**语义
    // （deepClone）：playerConfig 是调用方的对象，报告不该与它共享引用（深挖/精炼路径都会
    // 写 workingConfig 的克隆体，但报告持有原件仍然危险——调用方后续复用同一对象就会被串改）。
    result.baselineTriggerMap = deepClone(isPlainObject(playerConfig.triggerMap) ? playerConfig.triggerMap : {});
    result.referenceMetrics = referenceMetrics;
    result.resourcesAvailable = resourcesAvailable;
    result.evidenceBlocked = evidenceBlocked;
    // 「轮数上限截断」标记（设计 §19.8）：搜索跑满 maxRounds 且最后一轮仍有采纳（赋值点见
    // 轮次循环收尾）。报告是唯一数据源：store/UI 都从 result 读，不另设运行期状态。
    result.roundLimitReached = roundLimitReached;
    // ⚠️ 必须在这里再取一次快照：result 对象在搜索**开始前**创建，那时 adoptedSlots 还是
    // 空集合；只在字面量里 `[...adoptedSlots]` 会把「创建时的空数组」永远留在报告里
    // （浏览器实测：深挖采纳了 flame_blast，报告 adoptedSlots 却是 []，UI 因此给已采纳的槽
    // 显示「保持当前配置」）。
    result.adoptedSlots = [...adoptedSlots];
    result.elapsedSeconds = (Date.now() - startedAt) / 1000;
    if (!result.cancelled && !result.error) {
      publish(
        {
          phase,
          progress: 1,
          round: roundSummaries.length,
          workerLimit,
          evaluations,
          totalEvaluations: evaluations || 1,
        },
        true,
      );
    } else if (result.cancelled) {
      publish({ phase: 'cancelled', round: roundSummaries.length, workerLimit, evaluations }, true);
    }
  }

  return result;
}

// ── 换难度稳健性复核（2026-09-23，设计 §29）────────────────────────────────────
// 触发器写的是**全局技能配置**（store 的 applyTriggerOptimizerResult 直接改 activePlayer.triggerMap），
// 而搜索只在「一个区域 + 一个难度」上评估过 —— 结论完全可能只在那一个难度成立（设计 §19.5 实测：
// 同一角色的区域间噪声差 20 倍）。本函数把「最优配置 vs 搜索起点配置」搬到另一个难度上，用**独立盐**
// 的种子重跑一组新样本做配对评估，回答「换个难度，这笔提升还成立吗」。
//
// 三条口径与搜索期同源（否则复核结论与主结论不同尺度、无法对照）：
//   · 两个配置共享**同一组**种子（公共随机数）⇒ 逐轮配对差；
//   · 指标提取、打分与显著性全部走 evaluatePayload + computePairedStats（同一实现）；
//   · 种子由「目标难度 + 独立盐」派生 ⇒ 与搜索期/复验期样本完全不重叠（样本分割，p 值有效）。
// 成本：2 次评估 × rounds（缺省 TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS = 6；调用方按需反解到
// TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS = 16，见设计 §49 / §63）= 6~32 场模拟。
// 已知边界（勿过度解读）：只复核**相邻一个难度**，且不回答「结论对其它区域是否成立」。
//
// input = { playerConfig, simulationSettings, extra, settings?, weights?, pricing?,
//           bestTriggerMap, baselineTriggerMap, startedAt? }
// options = { targetTier, rounds?, plan?, WorkerClientCtor?, onProgress? }
// 返回（取消也 resolve；真正的失败抛出，与 optimizeTriggers 同款）：
//   { difficultyTier, zoneHrid, rounds, plan?, seeds, baselineMetrics, bestMetrics, paired, verdict,
//     scoreDelta, profitDelta, evaluations, simulations, elapsedSeconds, cancelled, error }
export async function verifyTriggerOptimizerRobustness(input = {}, options = {}) {
  assertTriggerOptimizerEntranceClear();

  const playerConfig = isPlainObject(input.playerConfig) ? input.playerConfig : null;
  if (!playerConfig) throw new Error(MISSING_PLAYER_ERROR);
  const bestTriggerMap = isPlainObject(input.bestTriggerMap) ? input.bestTriggerMap : null;
  const baselineTriggerMap = isPlainObject(input.baselineTriggerMap) ? input.baselineTriggerMap : null;
  if (!bestTriggerMap || !baselineTriggerMap) throw new Error(MISSING_TRIGGER_MAP_ERROR);

  const settings = normalizeTriggerOptimizerSettings(input.settings);
  const weights = resolveWeights(input.weights, settings);
  const pricing = isPlainObject(input.pricing) ? input.pricing : {};
  const pricingOptions = isPlainObject(pricing.pricingOptions)
    ? pricing.pricingOptions
    : isPlainObject(pricing.priceTable)
      ? pricing
      : {};
  const preferredPlayerId = String(playerConfig.id ?? '1');
  const WorkerClientCtor =
    typeof options.WorkerClientCtor === 'function'
      ? options.WorkerClientCtor
      : typeof input.WorkerClientCtor === 'function'
        ? input.WorkerClientCtor
        : undefined;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  // ⚠️ 必须用**复核口径**的归一化：搜索口径（normalizeTriggerOptimizerRounds）管的是「每候选的抽样
  // 重复次数」，与复核的「新现场从零跑几轮」不同语义；混用会把「反解说这次要 16 轮」静默钳成
  // 搜索上限 12 轮（历史上搜索上限 10 时曾把 12 钳成 10），与装置里验证过的 A′ 口径不符
  // （设计 §49；§47 同款教训）。
  const rounds = normalizeTriggerOptimizerRobustnessRounds(
    Number.isFinite(Number(options.rounds)) ? options.rounds : TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS,
  );
  // 本次复核的执行计划快照（2026-09-25，设计 §49）：净化后随 result.plan 留档；调用方没带或
  // 不自洽时为 null —— 不留档，也不影响本次复核本身。
  const planSnapshot = normalizeTriggerOptimizerRobustnessPlan(options.plan, rounds);
  const source = isPlainObject(input.simulationSettings) ? input.simulationSettings : {};
  const requestedTier = Number(options.targetTier);
  const difficultyTier = Math.max(
    0,
    Math.floor(Number.isFinite(requestedTier) ? requestedTier : toFiniteNumber(source.difficultyTier, 0)),
  );
  // 目标难度的仿真设置：**只换难度**，区域/时长/模式与搜索期逐字段一致（否则差异里混进了
  // 「换了图」或「换了时长」这类额外变量，复核结论就不再是「难度」这一个变量的答案）。
  const simulationSettings = { ...source, difficultyTier };

  const seedContext = { playerId: preferredPlayerId, playerConfig, simulationSettings };
  const seeds = createTriggerOptimizerSeedSet({
    ...seedContext,
    salt: TRIGGER_OPTIMIZER_SEED_SALT_ROBUSTNESS,
    count: rounds,
  });

  const run = { cancelRequested: false };
  registerTriggerOptimizerRun(run);
  const startedAt = Number(input.startedAt) || Date.now();
  const publish = createProgressPublisher(onProgress, startedAt);
  const result = {
    difficultyTier,
    zoneHrid: String(
      (simulationSettings.useDungeon ? simulationSettings.dungeonHrid : simulationSettings.zoneHrid) || '',
    ),
    rounds,
    // 复核计划快照（2026-09-25，设计 §49）：轮数已从固定 6 轮变成按需反解，报告要能回答「这次
    // 跑了几轮、上限/成本护栏有没有咬住」。净化失败（缺项/不自洽）时不留档。
    ...(planSnapshot ? { plan: planSnapshot } : {}),
    // 本次复核实际使用的种子：报告自证「判据用的是新样本」（与深挖/复验同款）。
    seeds: [...seeds],
    baselineMetrics: null,
    bestMetrics: null,
    paired: null,
    verdict: 'unknown',
    scoreDelta: null,
    profitDelta: null,
    evaluations: 0,
    simulations: 0,
    elapsedSeconds: 0,
    cancelled: false,
    error: '',
  };

  const ensureActive = () => {
    if (run.cancelRequested) throw createWorkerRunCancellationError();
  };
  const evaluate = async (config) => {
    ensureActive();
    const metrics = await evaluatePayload(
      buildCandidatePayload(config, simulationSettings, input.extra, null, {
        teammates: resolveSearchTeammates(input),
      }),
      {
        WorkerClientCtor,
        pricingOptions,
        preferredPlayerId,
        seeds,
      },
    );
    result.evaluations += 1;
    result.simulations += rounds;
    publish(
      {
        phase: 'robustness',
        progress: result.evaluations / 2,
        rounds,
        difficultyTier,
        evaluations: result.evaluations,
        simulations: result.simulations,
      },
      true,
    );
    return metrics;
  };

  try {
    publish({ phase: 'robustness', progress: 0, rounds, difficultyTier, evaluations: 0, simulations: 0 }, true);
    // 对照侧（搜索起点）先跑：两者共享同一组种子，先后顺序不影响配对性；取消发生在中间时，
    // 「对照组已就位、结论缺失」也比反过来更容易读。
    result.baselineMetrics = await evaluate(configWithTriggerMap(playerConfig, baselineTriggerMap));
    result.bestMetrics = await evaluate(configWithTriggerMap(playerConfig, bestTriggerMap));
    const paired = computePairedStats(result.bestMetrics, result.baselineMetrics, weights);
    result.paired = paired;
    result.verdict = String(paired?.score?.verdict ?? 'unknown');
    result.scoreDelta = Number.isFinite(Number(paired?.score?.mean)) ? Number(paired.score.mean) : null;
    result.profitDelta = Number.isFinite(Number(paired?.metrics?.dailyNoRngProfit?.mean))
      ? Number(paired.metrics.dailyNoRngProfit.mean)
      : null;
  } catch (error) {
    if (run.cancelRequested || isWorkerRunCancelledError(error)) {
      result.cancelled = true;
    } else {
      result.error = error?.message || String(error);
      throw error;
    }
  } finally {
    unregisterTriggerOptimizerRun(run);
    result.elapsedSeconds = (Date.now() - startedAt) / 1000;
  }

  return result;
}

// 追加复验的前置校验错误：报告缺逐轮样本（旧报告 / 退化结构）时无从合并重检。定义在唯一
// 使用它的函数旁（文件顶部的错误常量区留给跨函数共用的那几个）。
const MISSING_VERIFICATION_ERROR =
  'The report is missing verification samples, so no further verification can be appended.';

// ── 追加复验（2026-09-24，设计 §31）──────────────────────────────────────────
// 首轮复验判 inconclusive ≠「没有提升」，只是「这几轮样本不足以判定」。旧口径到此为止，
// 用户既看不出结论悬着、也没有下一步。本函数提供「再采一组独立样本，与首轮合并后重新检验」：
//   · **不换难度**（与换难度稳健性复核的区别）：回答的是「这批证据够不够」，不是「换个难度
//     还成立吗」—— simulationSettings 原样使用，唯一变量是样本量；
//   · 种子 = verify-append 盐 + `.v${attempt}`：追加样本与 search/screen/verify/deep-dive/
//     robustness 全不相交，且每次追加互不相交 —— 「要不要追加」是拿上一轮结论做的决定
//     （select on A），追加样本必须独立于那个决定，否则就是可选停时（§21 的教训）；
//   · 判据是**合并重检**（首轮 + 本次样本一起进 computePairedStats，自由度 5 → 11），
//     不是只看新增样本：合并才有更高功效把 inconclusive 追成明确结论。合并重检相当于
//     「最多追加 N 次」的序贯检验，其假阳性率是否仍达标由 §31 的 bootstrap 实证把关
//     （判据：真提升的确认率上升且假阳性率不升，否则本特性整体撤下）。
// 成本：2 次评估 × rounds（缺省 TRIGGER_OPTIMIZER_VERIFY_ROUNDS = 6 → 12 场模拟；调用方按
// planTriggerOptimizerVerificationAppend 的自适应计划传更大值，上限 TRIGGER_OPTIMIZER_VERIFY_MAX_ROUNDS）。
//
// input = { playerConfig, simulationSettings, extra, settings?, weights?, pricing?,
//           bestTriggerMap, baselineTriggerMap, verification, startedAt?, WorkerClientCtor? }
// options = { attempt, rounds?, WorkerClientCtor?, onProgress? }
// 返回合并后的 verification 形态（取消也 resolve；真正的失败抛出，与 optimizeTriggers 同款）：
//   { ...旧字段, baselineMetrics, bestMetrics, paired, verdict, rounds, seeds, attempts,
//     evaluations, simulations, elapsedSeconds, cancelled, error }
// attempts 逐次追加 { attempt, rounds, seeds, paired, verdict, mergedRounds, mergedVerdict, plan? }：
// 前几项是**本次追加样本自身**的统计、后两项是合并后的总轮数与结论 —— 两条口径都留档，
// 读者能分清「新增样本说了什么」与「合并后说了什么」；plan 是**本轮执行计划快照**（2026-09-25，
// 设计 §48）：轮数自适应（§47）之后，「这次补了几轮、上限/护栏有没有咬住」必须进报告才能事后
// 复盘 —— 计划由调用方（store）算好后从 options.plan 传入，服务层只净化不重算（口径的事实源
// 只有 scoring 的 planTriggerOptimizerVerificationAppend，服务层重算会把口径分叉成两套）。
// §50（2026-09-26）之后快照还含累计预算与累计已花（spentSimulations / cumulativeBudgetSimulations /
// limitedBy）—— 字段的白名单与校验在 domain 的 normalizeTriggerOptimizerAppendPlan，服务层不感知
// 具体字段，只负责「净化通过才留档」。
export async function appendTriggerOptimizerVerification(input = {}, options = {}) {
  assertTriggerOptimizerEntranceClear();

  const playerConfig = isPlainObject(input.playerConfig) ? input.playerConfig : null;
  if (!playerConfig) throw new Error(MISSING_PLAYER_ERROR);
  const bestTriggerMap = isPlainObject(input.bestTriggerMap) ? input.bestTriggerMap : null;
  const baselineTriggerMap = isPlainObject(input.baselineTriggerMap) ? input.baselineTriggerMap : null;
  if (!bestTriggerMap || !baselineTriggerMap) throw new Error(MISSING_TRIGGER_MAP_ERROR);

  // 合并重检的原料 = 首轮复验的逐轮样本。缺 samples（旧报告 / 退化结构）或两侧轮数不齐就无从
  // 配对 —— 宁可明确报错，也不要把「无从合并」悄悄当成「没有变化」。
  const previous = isPlainObject(input.verification) ? input.verification : null;
  const previousBaselineSamples = Array.isArray(previous?.baselineMetrics?.samples)
    ? previous.baselineMetrics.samples
    : null;
  const previousBestSamples = Array.isArray(previous?.bestMetrics?.samples) ? previous.bestMetrics.samples : null;
  if (
    !previousBaselineSamples ||
    !previousBestSamples ||
    previousBaselineSamples.length === 0 ||
    previousBaselineSamples.length !== previousBestSamples.length
  ) {
    throw new Error(MISSING_VERIFICATION_ERROR);
  }
  const previousSeeds = Array.isArray(previous.seeds) ? previous.seeds : [];
  const previousAttempts = Array.isArray(previous.attempts) ? previous.attempts : [];

  const settings = normalizeTriggerOptimizerSettings(input.settings);
  const weights = resolveWeights(input.weights, settings);
  const pricing = isPlainObject(input.pricing) ? input.pricing : {};
  const pricingOptions = isPlainObject(pricing.pricingOptions)
    ? pricing.pricingOptions
    : isPlainObject(pricing.priceTable)
      ? pricing
      : {};
  const preferredPlayerId = String(playerConfig.id ?? '1');
  const WorkerClientCtor =
    typeof options.WorkerClientCtor === 'function'
      ? options.WorkerClientCtor
      : typeof input.WorkerClientCtor === 'function'
        ? input.WorkerClientCtor
        : undefined;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  // ⚠️ 必须用**复验口径**的归一化：搜索口径（normalizeTriggerOptimizerRounds）管的是「每候选的抽样
  // 重复次数」，与追加复验的「补几轮」不同语义；它的上限（10 轮，2026-09-27 起 12）远小于复验上限
  // （TRIGGER_OPTIMIZER_VERIFY_MAX_ROUNDS = 24）—— 混用会把「反解说这次要 18 轮」静默钳成小值，
  // 与装置里验证过的 A′ 口径不符（设计 §47）。
  const rounds = normalizeTriggerOptimizerVerifyRounds(
    Number.isFinite(Number(options.rounds)) ? options.rounds : TRIGGER_OPTIMIZER_VERIFY_ROUNDS,
  );
  const attempt = Math.max(1, Math.floor(toFiniteNumber(options.attempt, 1)));
  // 本轮执行计划快照（2026-09-25，设计 §48）：净化后随 attempts 条目留档；不自洽（或调用方
  // 没带）时为 null —— 不留档，也不影响本次追加本身。
  const planSnapshot = normalizeTriggerOptimizerAppendPlan(options.plan, rounds);
  // 不换难度：simulationSettings 原样（换难度是 verifyTriggerOptimizerRobustness 回答的问题）。
  const simulationSettings = isPlainObject(input.simulationSettings) ? input.simulationSettings : {};

  const seedContext = { playerId: preferredPlayerId, playerConfig, simulationSettings };
  const seeds = createTriggerOptimizerSeedSet({
    ...seedContext,
    salt: `${TRIGGER_OPTIMIZER_SEED_SALT_VERIFY_APPEND}.v${attempt}`,
    count: rounds,
  });

  const run = { cancelRequested: false };
  registerTriggerOptimizerRun(run);
  const startedAt = Number(input.startedAt) || Date.now();
  const publish = createProgressPublisher(onProgress, startedAt);
  // 取消/失败时原样带回旧字段（= 「什么都没追加」），只有合并重检成功才覆盖结论字段。
  const result = {
    ...previous,
    attempts: [...previousAttempts],
    seeds: [...previousSeeds],
    evaluations: 0,
    simulations: 0,
    elapsedSeconds: 0,
    cancelled: false,
    error: '',
  };

  const ensureActive = () => {
    if (run.cancelRequested) throw createWorkerRunCancellationError();
  };
  const evaluate = async (config) => {
    ensureActive();
    const metrics = await evaluatePayload(
      buildCandidatePayload(config, simulationSettings, input.extra, null, {
        teammates: resolveSearchTeammates(input),
      }),
      {
        WorkerClientCtor,
        pricingOptions,
        preferredPlayerId,
        seeds,
      },
    );
    result.evaluations += 1;
    result.simulations += rounds;
    publish(
      {
        phase: 'verify-append',
        progress: result.evaluations / 2,
        rounds,
        attempt,
        evaluations: result.evaluations,
        simulations: result.simulations,
      },
      true,
    );
    return metrics;
  };

  try {
    publish({ phase: 'verify-append', progress: 0, rounds, attempt, evaluations: 0, simulations: 0 }, true);
    // 对照侧（搜索起点）先跑：与稳健性复核同款理由 —— 取消发生在中间时，
    // 「对照组已就位、结论缺失」比反过来更容易读。
    const newBaseline = await evaluate(configWithTriggerMap(playerConfig, baselineTriggerMap));
    const newBest = await evaluate(configWithTriggerMap(playerConfig, bestTriggerMap));

    // 本次追加样本自身的统计（留档：读者要能分清「新增样本说了什么」）。
    const attemptPaired = computePairedStats(newBest, newBaseline, weights);
    // 合并重检：判据看的是首轮 + 本次的全部样本（自由度 5 → 11），功效高于只看新增样本。
    const mergedBaseline = aggregateRoundMetrics([...previousBaselineSamples, ...newBaseline.samples]);
    const mergedBest = aggregateRoundMetrics([...previousBestSamples, ...newBest.samples]);
    const mergedPaired = computePairedStats(mergedBest, mergedBaseline, weights);
    const mergedRounds = previousBaselineSamples.length + newBaseline.samples.length;
    const mergedVerdict = String(mergedPaired?.score?.verdict ?? 'unknown');

    result.baselineMetrics = mergedBaseline;
    result.bestMetrics = mergedBest;
    result.paired = mergedPaired;
    result.verdict = mergedVerdict;
    result.rounds = mergedRounds;
    result.seeds = [...previousSeeds, ...seeds];
    result.attempts = [
      ...previousAttempts,
      {
        attempt,
        rounds,
        seeds: [...seeds],
        paired: attemptPaired,
        verdict: String(attemptPaired?.score?.verdict ?? 'unknown'),
        mergedRounds,
        mergedVerdict,
        // 计划快照（§48）：只有净化通过（字段齐全、类型对、plannedRounds === rounds）才写。
        ...(planSnapshot ? { plan: planSnapshot } : {}),
      },
    ];
  } catch (error) {
    if (run.cancelRequested || isWorkerRunCancelledError(error)) {
      result.cancelled = true;
    } else {
      result.error = error?.message || String(error);
      throw error;
    }
  } finally {
    unregisterTriggerOptimizerRun(run);
    result.elapsedSeconds = (Date.now() - startedAt) / 1000;
  }

  return result;
}

// 复核追加的前置校验错误：报告缺复核的逐轮样本（旧报告 / 退化结构）时无从合并重检。定义在唯一
// 使用它的函数旁（与 MISSING_VERIFICATION_ERROR 同款理由）。
const MISSING_ROBUSTNESS_ERROR =
  'The report is missing robustness samples, so no further robustness check can be appended.';

// ── 复核追加（2026-09-26，设计 §51）──────────────────────────────────────────
// 复核（§29/§49）每次都是「换难度 + 独立盐 + 2 次评估 × 自适应 6~12 轮」的一次性评估；旧口径下
// 「再点一次复核」= 同盐复跑 ⇒ 逐值相同的样本（§51 实测：同盐两次派生逐值相同，成本 2 × 首跑
// 轮数、信息增量 0 —— 纯白烧）。本函数改为**换盐追加**：新样本与首跑样本合并重检，把「换个难度
// 这笔提升还成立吗」的结论继续加固（装置 §51 S2 臂实测：首跑未达显著 → 合并后明确 = 97.6%；
// 按需只补 n* 的 S1 臂 = 89.4% ⇒ 生产取「补到上限」口径，见 planTriggerOptimizerRobustnessAppend）。
//   · 不换难度：沿用首跑复核的目标难度（options.targetTier / input.targetTier /
//     simulationSettings.difficultyTier 依次解析，与首跑同款口径；调用方必须传与首跑相同的难度，
//     否则新旧样本不同源、合并无意义 —— store 传的就是复核记录里的 difficultyTier）；
//   · 种子盐 = robustness 盐 + `.r${attempt}`：追加样本与首跑、与其它各阶段全不相交，且每次追加
//     互不相交 —— 「要不要追加」是拿已合并结论做的决定（select on A），新样本必须独立于那个决定，
//     否则就是可选停时（§21 的教训）；
//   · 判据是**合并重检**：首跑 + 本次样本一起进 computePairedStats（6 轮 → 上限 16 轮，自由度
//     5 → 15），不是只看新增样本；合并重检相当于「最多追加 N 次」的序贯检验，其假阳性率是否仍
//     达标由 §31 的 bootstrap 口径把关（§51 实测：三臂假阳性率均 0.0%，未升高）。
// 成本：2 次评估 × rounds（调用方按 planTriggerOptimizerRobustnessAppend 传 1..16 轮）。
//
// input = { playerConfig, simulationSettings, extra, settings?, weights?, pricing?,
//           bestTriggerMap, baselineTriggerMap, previousRobustness, targetTier?, startedAt?,
//           WorkerClientCtor? }
//   previousRobustness：首跑（或上一次追加后）的复核记录 —— 必须带两侧逐轮样本（samples）。
// options = { attempt, rounds?, targetTier?, plan?, WorkerClientCtor?, onProgress? }
// 返回合并后的复核形态（取消也 resolve；真正的失败抛出，与 optimizeTriggers 同款）：
//   { ...旧字段, difficultyTier, rounds, seeds, baselineMetrics, bestMetrics, paired, verdict,
//     scoreDelta, profitDelta, attempts, evaluations, simulations, elapsedSeconds, cancelled,
//     error }
// attempts 逐次追加 { attempt, rounds, seeds, paired, verdict, mergedRounds, mergedVerdict, plan? }：
// 前几项是**本次追加样本自身**的统计、后两项是合并后的总轮数与结论 —— 两条口径都留档，读者能分清
// 「新增样本说了什么」与「合并后说了什么」；plan 是**本轮执行计划快照**（§51：zeroDiff / atCap /
// limitedBy / 累计预算与已花）—— 计划由调用方（store）算好后从 options.plan 传入，服务层只净化
// 不重算（口径的事实源只有 scoring 的 planTriggerOptimizerRobustnessAppend；字段白名单与校验在
// domain 的 normalizeTriggerOptimizerRobustnessPlan）。
export async function appendTriggerOptimizerRobustness(input = {}, options = {}) {
  assertTriggerOptimizerEntranceClear();

  const playerConfig = isPlainObject(input.playerConfig) ? input.playerConfig : null;
  if (!playerConfig) throw new Error(MISSING_PLAYER_ERROR);
  const bestTriggerMap = isPlainObject(input.bestTriggerMap) ? input.bestTriggerMap : null;
  const baselineTriggerMap = isPlainObject(input.baselineTriggerMap) ? input.baselineTriggerMap : null;
  if (!bestTriggerMap || !baselineTriggerMap) throw new Error(MISSING_TRIGGER_MAP_ERROR);

  // 合并重检的原料 = 首跑复核的逐轮样本。缺 samples（旧报告 / 退化结构）或两侧轮数不齐就无从
  // 配对 —— 宁可明确报错，也不要把「无从合并」悄悄当成「没有变化」。
  const previous = isPlainObject(input.previousRobustness) ? input.previousRobustness : null;
  const previousBaselineSamples = Array.isArray(previous?.baselineMetrics?.samples)
    ? previous.baselineMetrics.samples
    : null;
  const previousBestSamples = Array.isArray(previous?.bestMetrics?.samples) ? previous.bestMetrics.samples : null;
  if (
    !previousBaselineSamples ||
    !previousBestSamples ||
    previousBaselineSamples.length === 0 ||
    previousBaselineSamples.length !== previousBestSamples.length
  ) {
    throw new Error(MISSING_ROBUSTNESS_ERROR);
  }
  const previousSeeds = Array.isArray(previous.seeds) ? previous.seeds : [];
  const previousAttempts = Array.isArray(previous.attempts) ? previous.attempts : [];

  const settings = normalizeTriggerOptimizerSettings(input.settings);
  const weights = resolveWeights(input.weights, settings);
  const pricing = isPlainObject(input.pricing) ? input.pricing : {};
  const pricingOptions = isPlainObject(pricing.pricingOptions)
    ? pricing.pricingOptions
    : isPlainObject(pricing.priceTable)
      ? pricing
      : {};
  const preferredPlayerId = String(playerConfig.id ?? '1');
  const WorkerClientCtor =
    typeof options.WorkerClientCtor === 'function'
      ? options.WorkerClientCtor
      : typeof input.WorkerClientCtor === 'function'
        ? input.WorkerClientCtor
        : undefined;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  // ⚠️ 必须用**复核追加口径**的归一化：搜索口径（normalizeTriggerOptimizerRounds）管的是「每候选的
  // 抽样重复次数」，与「这一次补几轮」不同语义；混用会把「补到上限 16 轮」静默钳成搜索上限
  // 12 轮（历史上搜索上限 10 时曾把 12 钳成 10），与装置里验证过的 S2 口径不符（§49 / §47 同款教训）。
  const rounds = normalizeTriggerOptimizerRobustnessAppendRounds(
    Number.isFinite(Number(options.rounds)) ? options.rounds : TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS,
  );
  const attempt = Math.max(1, Math.floor(toFiniteNumber(options.attempt, 1)));
  // 本轮执行计划快照（§51）：净化后随 attempts 条目留档；不自洽（或调用方没带）时为 null ——
  // 不留档，也不影响本次追加本身。
  const planSnapshot = normalizeTriggerOptimizerRobustnessPlan(options.plan, rounds);
  const source = isPlainObject(input.simulationSettings) ? input.simulationSettings : {};
  const requestedTier = Number(options.targetTier);
  const inputTier = Number(input.targetTier);
  const difficultyTier = Math.max(
    0,
    Math.floor(
      Number.isFinite(requestedTier)
        ? requestedTier
        : Number.isFinite(inputTier)
          ? inputTier
          : toFiniteNumber(source.difficultyTier, 0),
    ),
  );
  // 目标难度的仿真设置：口径与首跑一致（区域/时长/模式逐字段沿用调用方传入的 simulationSettings，
  // 唯一变量是**新样本**）——否则差异里混进了额外变量，合并结论就不再是「同一难度」的答案。
  const simulationSettings = { ...source, difficultyTier };

  const seedContext = { playerId: preferredPlayerId, playerConfig, simulationSettings };
  // 换盐追加（§51）：`.r${attempt}` 与首跑（robustness 盐）、复验追加（.v）、搜索/复验/深挖全不相交。
  const seeds = createTriggerOptimizerSeedSet({
    ...seedContext,
    salt: `${TRIGGER_OPTIMIZER_SEED_SALT_ROBUSTNESS}.r${attempt}`,
    count: rounds,
  });

  const run = { cancelRequested: false };
  registerTriggerOptimizerRun(run);
  const startedAt = Number(input.startedAt) || Date.now();
  const publish = createProgressPublisher(onProgress, startedAt);
  // 取消/失败时原样带回旧字段（= 「什么都没追加」），只有合并重检成功才覆盖结论字段。
  const result = {
    ...previous,
    attempts: [...previousAttempts],
    seeds: [...previousSeeds],
    evaluations: 0,
    simulations: 0,
    elapsedSeconds: 0,
    cancelled: false,
    error: '',
  };

  const ensureActive = () => {
    if (run.cancelRequested) throw createWorkerRunCancellationError();
  };
  const evaluate = async (config) => {
    ensureActive();
    const metrics = await evaluatePayload(
      buildCandidatePayload(config, simulationSettings, input.extra, null, {
        teammates: resolveSearchTeammates(input),
      }),
      {
        WorkerClientCtor,
        pricingOptions,
        preferredPlayerId,
        seeds,
      },
    );
    result.evaluations += 1;
    result.simulations += rounds;
    publish(
      {
        phase: 'robustness-append',
        progress: result.evaluations / 2,
        rounds,
        attempt,
        difficultyTier,
        evaluations: result.evaluations,
        simulations: result.simulations,
      },
      true,
    );
    return metrics;
  };

  try {
    publish(
      { phase: 'robustness-append', progress: 0, rounds, attempt, difficultyTier, evaluations: 0, simulations: 0 },
      true,
    );
    // 对照侧（搜索起点）先跑：与复核/追加复验同款理由 —— 取消发生在中间时，
    // 「对照组已就位、结论缺失」比反过来更容易读。
    const newBaseline = await evaluate(configWithTriggerMap(playerConfig, baselineTriggerMap));
    const newBest = await evaluate(configWithTriggerMap(playerConfig, bestTriggerMap));

    // 本次追加样本自身的统计（留档：读者要能分清「新增样本说了什么」）。
    const attemptPaired = computePairedStats(newBest, newBaseline, weights);
    // 合并重检：判据看的是首跑 + 本次的全部样本（自由度 5 → 11），功效高于只看新增样本。
    const mergedBaseline = aggregateRoundMetrics([...previousBaselineSamples, ...newBaseline.samples]);
    const mergedBest = aggregateRoundMetrics([...previousBestSamples, ...newBest.samples]);
    const mergedPaired = computePairedStats(mergedBest, mergedBaseline, weights);
    const mergedRounds = previousBaselineSamples.length + newBaseline.samples.length;
    const mergedVerdict = String(mergedPaired?.score?.verdict ?? 'unknown');

    // 难度以本次实际解析到的值为准（正常调用 = 首跑记录里的难度）；记录里的其余字段（zoneHrid /
    // 首跑计划 plan 等）走上面的展开原样保留 —— 追加不换难度，也不覆盖首跑的执行计划。
    result.difficultyTier = difficultyTier;
    result.baselineMetrics = mergedBaseline;
    result.bestMetrics = mergedBest;
    result.paired = mergedPaired;
    result.verdict = mergedVerdict;
    result.rounds = mergedRounds;
    result.seeds = [...previousSeeds, ...seeds];
    // 分数 / 利润差的派生口径与首跑一致（都取当前 paired 统计的均值）。
    result.scoreDelta = Number.isFinite(Number(mergedPaired?.score?.mean)) ? Number(mergedPaired.score.mean) : null;
    result.profitDelta = Number.isFinite(Number(mergedPaired?.metrics?.dailyNoRngProfit?.mean))
      ? Number(mergedPaired.metrics.dailyNoRngProfit.mean)
      : null;
    result.attempts = [
      ...previousAttempts,
      {
        attempt,
        rounds,
        seeds: [...seeds],
        paired: attemptPaired,
        verdict: String(attemptPaired?.score?.verdict ?? 'unknown'),
        mergedRounds,
        mergedVerdict,
        // 计划快照（§51）：只有净化通过（字段齐全、类型对、plannedRounds === rounds）才写。
        ...(planSnapshot ? { plan: planSnapshot } : {}),
      },
    ];
  } catch (error) {
    if (run.cancelRequested || isWorkerRunCancelledError(error)) {
      result.cancelled = true;
    } else {
      result.error = error?.message || String(error);
      throw error;
    }
  } finally {
    unregisterTriggerOptimizerRun(run);
    result.elapsedSeconds = (Date.now() - startedAt) / 1000;
  }

  return result;
}

export {
  TRIGGER_OPTIMIZER_BUSY_ERROR,
  SHARED_RUN_BUSY_ERROR,
  MISSING_TRIGGER_MAP_ERROR,
  MISSING_VERIFICATION_ERROR,
  MISSING_ROBUSTNESS_ERROR,
};

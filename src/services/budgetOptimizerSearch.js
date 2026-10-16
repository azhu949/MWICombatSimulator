// 预算优化（Budget Optimizer）—— 搜索引擎（升级链模式）。
//
// v4 升级链（2026-10-04，用户需求）：一次运行自动把预算花完 ——
//   循环 { 剩余额度下枚举候选 → racing 筛选 → 选出性价比最高的一项 → 内存中应用到工作配置
//          → 扣减剩余额度 → 上报一步（onStep，含该步候选明细快照） }
//   直到满足终止条件（stopReason）：
//     - exhausted：剩余额度内已无可买项（预算基本用完 / 买无可买）；
//     - step-limit：达到链步数上限（用户设定 stepLimitMode='custom' 的 maxChainSteps，或缺省
//       'unlimited'（用完预算）的安全阀 BUDGET_OPTIMIZER_MAX_CHAIN_STEPS；可再点开始续跑）；
//     - cancelled：用户停止（已完成的步骤记录完整，写回照常进行）。
//   链结束后由 store 把工作配置整体写回主角并压一条撤销快照（服务层不碰 store）。
//
// 与 v1~v3 单步/组合模式的差异：
//   - 不再做组合规划（背包 DP / Top-K 联合复核已从搜索流程与 domain 整体移除）；
//   - 报告不再有 nextBest / plans / curve，改为 steps[]（每步一份候选明细快照）+ 汇总字段；
//   - 每步的配对基线 = 上一步应用后的配置在当步种子集下的评估（步内配对比较不受影响）。
//
// 单步内部流程（照 v2 精筛口径）：
//   1) 成本预计算（buildBudgetCandidates：剩余额度剪枝 + 链起点等级上限；净支出下限 0，
//      故成本 0 的「免费项」会进入候选池）；
//   2) racing：粗筛（全候选 × screen 样本）→ 幸存者精筛（补评 refine 新增样本到全量）；
//      池 ≤ BUDGET_OPTIMIZER_RACING_MIN_POOL 时跳过粗筛直接精筛；
//   3) 定选：精筛过、非空蓝回归、正提升、成本 ≤ 剩余额度的候选中性价比第一
//      （免费项 = 成本 0，按约定效率 +Infinity 优先，不再被静默排除）。
//
// 并行结构（2026-10-08）：
//   - 候选级：粗筛 / 精筛的评估各为一个批量任务（一个 realm 串行跑该配置的全部样本），
//     池内并发 workerLimit 个（runEvaluationPool）；
//   - 基线并入池：每步的基线评估（screen 段 / refine 段补评）不再单独 await，而是与候选评估
//     同池并行 —— 基线整批只有 4~12 场，单独跑时其余 worker 空转；配对统计改在池结束后统一
//     计算（基线此时必已就绪），统计输入不变；
//   - 评估内样本分片：基线 / 链终复验这类「少配置、多场次」的评估，样本 ≥ 阈值时拆成 K 片
//     并发下池（resolveBudgetEvaluationShardSize；复验两个配置各分 floor(workerLimit/2) 片）——
//     旧结构里这些评估整批只占 1~2 个 worker，是链跑主要的并行空洞；池内基线（screening /
//     refining 补评）按池内剩余容量折算分片预算（2026-10-09），满池不分片、峰值 ≤ workerLimit；
//   - 分片只改「哪个 realm 跑哪几场」：种子集合与样本合并顺序（按片索引）不变，
//     配对统计输入逐位一致。
//
// 种子口径（与 domain.createBudgetOptimizerSeedSet 配套）：
//   - 粗筛：screen 盐前 screenSeeds 个（standard=4 / fast=2）；精筛：样本总数 = refineSeeds
//     （standard=16 / fast=8）= 粗筛样本复用 + refine 盐补评；**全链共享同一套种子**
//     （2026-10-08 起不再入步号）—— 样本复用要求「同一配置 + 同一批种子」可跨步命中；
//     代价只是逐步 Δ 的相关性（展示层面），链终复验用独立盐，最终结论不受影响；
//   - 跨步样本复用（2026-10-08）：候选 effect 是绝对目标（「head 升到 L」），上一步选中槽位的
//     后续档位与本步基线，在配置层面与上一步样本完全相同（种子共享）→ 直接取用不再模拟
//     （命中 16 场全量整段免评；命中 4 场片段则免粗筛段、精筛段补评）；
//   - 链起点基线 = 第一步基线（同一次评估，2026-10-08 合并）：step0 的 screen + refine 补齐全集
//     （16 场），报告 baseline 与 step0 的 baselineBefore 同源；链终复验用 verify 盐新种子
//     （独立样本分割：链终点配置的提升不能用「挑出它的那批样本」来测量，防选择性偏差）。
//
// 硬约束（不变）：
//   ① 步内配对：同一步的基线与全部候选共享完全相同的种子列表 —— 每步只派生一次、到处复用；
//   ② 空蓝判负：「基线不空蓝而候选空蓝」的候选判负，不参与定选；
//   ③ 成本上限：每步选定项成本 ≤ 当步剩余额度（bandHigh 汇总硬约束的逐步投影）。
//
// 取消：注册表 + stopBudgetOptimizerWorkerRuns；在途任务以 code:'cancelled' 拒绝，本模块捕获
// 后收敛为 cancelled 语义（不抛失败），其余错误原样上抛。取消时已完成步骤保留在报告里，
// store 仍会把工作配置写回（已应用步骤的既成事实，撤销走统一入口）。
//
// 进度：onProgress 节流 150ms；phase 枚举 preparing|costing|screening|refining|applying|verifying|done；
// progress = (已完成阶段数 + 当前阶段内进度) / (已完成阶段数 + 1 + 当前阶段内进度)（链长未知的饱和式
// 近似：单调不降 —— 阶段交接处 f(S,1) = f(S+1,0)，中途不达 1；收尾归 1 由强制上报负责）。

import { runParallelWorkerPool } from './workerPool.js';
import { normalizeParallelWorkerLimit, QUEUE_PARALLEL_WORKER_LIMIT_MAX } from './queueScoring.js';
import {
  applyBudgetEffectToPlayerConfig,
  BUDGET_OPTIMIZER_BUSY_ERROR,
  BUDGET_OPTIMIZER_REPORT_VERSION,
  BUDGET_OPTIMIZER_SEED_SALT_REFINE,
  BUDGET_OPTIMIZER_SEED_SALT_SCREEN,
  BUDGET_OPTIMIZER_SEED_SALT_VERIFY,
  BUDGET_OPTIMIZER_STEP_CANDIDATES_LIMIT,
  buildBudgetCandidates,
  createBudgetOptimizerSeedSet,
  ensureBudgetOptimizerCostReference,
  normalizeBudgetOptimizerSettings,
  resolveBudgetHigh,
  resolveBudgetObjectiveMetricKey,
  resolveBudgetOptimizerPreset,
  resolveBudgetOptimizerStepCap,
} from './budgetOptimizerDomain.js';
import {
  aggregateRoundMetrics,
  buildBudgetCandidatePayload,
  createDegenerateMetrics,
  evaluateBudgetPayload,
} from './budgetOptimizerSimulation.js';
import {
  hasBudgetOptimizerRunInProgress,
  registerBudgetOptimizerRun,
  unregisterBudgetOptimizerRun,
} from './budgetOptimizerRunRegistry.js';
import {
  createWorkerRunCancellationError,
  hasHomeMultiRoundWorkerRunInProgress,
  hasSharedWorkerRunInProgress,
  isWorkerRunCancelledError,
} from './simulatorWorkerRuns.js';
import { computePairedStats } from './triggerOptimizerScoring.js';
import { deepClone, isPlainObject, normalizeBaselineSaleSide, toFiniteNumber } from './utils.js';

// ── 常量 ──────────────────────────────────────────────────────────────

// 进度上报节流（150ms，与触发优化器同款）。
const PROGRESS_THROTTLE_MS = 150;

// racing 粗筛的启用阈值：候选池 ≤ 8 时，粗筛的固定成本（一次全池评估）相对于精筛不划算，
// 跳过粗筛直接精筛。
export const BUDGET_OPTIMIZER_RACING_MIN_POOL = 8;

// 评估内样本分片阈值（2026-10-08）：一次评估的样本数 ≥ 该值时，样本可拆成多片并发下池。
// 只对「单独 await 的少配置评估」启用（链起点基线 / 每步基线 / 链终复验）——这些评估整批
// 只占 1~2 个 worker，是链跑主要的并行空洞；池内的候选评估已满并发，不再分片（否则与
// 外层并发相乘）。分片只改「哪个 realm 跑哪几场」：种子集合与样本合并顺序（按片索引）
// 不变，配对统计输入逐位一致。
export const BUDGET_OPTIMIZER_EVALUATION_SHARD_MIN_SEEDS = 8;

// 乐观上界的噪声倍数：mean + 3×se（考虑统计不确定性；与触发优化器 racing 的实测经验同口径）。
const BUDGET_OPTIMIZER_RACING_NOISE_MULTIPLIER = 3;

// 候选「做法」键（2026-10-09 键化，报告结构化口径）：装备 = 市场直购档位；技能 = 技能书；
// 房子 = 材料升级。报告只存稳定键与档位（见 resolveCandidateMethod），展示文案由 UI 按当前语言组装。
export const BUDGET_OPTIMIZER_METHOD_MARKET_BUY = 'market-buy';
export const BUDGET_OPTIMIZER_METHOD_ABILITY_BOOK = 'ability-book';
export const BUDGET_OPTIMIZER_METHOD_HOUSE_UPGRADE = 'house-upgrade';

// 步骤候选明细的证据分档（导出供 UI 复用同一判定，避免镜像复制）：
//   FREE（-1）免费项 —— 净支出 ≤ 0 且 Δ 为正的提升（旧件卖价高于新件买价）：性价比分母无定义，
//              档内按 Δ 降序、不参与 %/B 排序；
//   0：精筛且可用；1：粗筛（证据不足）；2：不可用（空蓝回归 / 负提升 / 无效值）。
export const BUDGET_OPTIMIZER_EVIDENCE_BAND_FREE = -1;

// 证据档判定（纯函数，导出供页面复用；字段由调用方按各自口径取好 —— 搜索层读报告记录，
// UI 允许旧报告回退旧兼容名 deltaDps）。成本必须显式为有限数：脏值（缺失 / 非有限）按不可用档，
// 绝不与「免费项」混淆。
export function resolveBudgetEvidenceBand({ manaRegression, delta, cost, refined } = {}) {
  if (manaRegression) return 2;
  const numericDelta = Number(delta);
  const numericCost = Number(cost);
  if (!Number.isFinite(numericDelta) || numericDelta <= 0) return 2;
  if (!Number.isFinite(numericCost)) return 2;
  if (numericCost <= 0) return BUDGET_OPTIMIZER_EVIDENCE_BAND_FREE;
  return refined === true ? 0 : 1;
}

// 报告 stopReason 枚举（导出供 store/UI/测试引用）：
//   exhausted            剩余额度内已无可买项（正常收尾；空池 / 全不可用 / 买不起共用）
//   step-limit           步数上限（安全阀）
//   cancelled            用户停止
//   significance-blocked 显著性门槛在终止当步拦下了全部「买得起」的候选（与「买不起」严格区分）
export const BUDGET_OPTIMIZER_STOP_EXHAUSTED = 'exhausted';
export const BUDGET_OPTIMIZER_STOP_STEP_LIMIT = 'step-limit';
export const BUDGET_OPTIMIZER_STOP_CANCELLED = 'cancelled';
export const BUDGET_OPTIMIZER_STOP_SIGNIFICANCE = 'significance-blocked';

// 共享运行冲突的拒因（与触发优化器同文案）：导出供 store/测试断言同一份事实源。
export const SHARED_RUN_BUSY_ERROR = 'Another simulation is in progress.';
export const MISSING_PLAYER_ERROR = 'Player configuration is required.';

// 链进度：链长未知（exhausted 才停），用「已完成阶段数 + 当前阶段内进度」的饱和式比值近似：
//   progress = (S + intra) / (S + 1 + intra) = 1 - 1 / (S + 1 + intra)
// 单调不降由两个性质保证（导出供测试锚定，2026-10-09）：
//   ① 阶段交接连续：f(S, 1) === f(S+1, 0) —— 阶段池跑满后 finishStage 把 stage 置空、阶段内进度
//      归零，但分母同步 +1，取值不回落（旧公式 (S + intra) / (S + 1) 在交接处从 1 掉回 S/(S+1)：
//      第 0 步进度条冲到 100% 后立即回落到 0%，随后每步重复，与本文件承诺的「单调不降」相反）；
//   ② 阶段内进度只增（stage.done 只加不减）。
// 饱和式同时保证中途不达 1：progress=1 只由收尾的强制上报（emit({ progress: 1 }, true)）发布。
export function buildChainProgress(completedStages, intraStageRatio) {
  const intra = Math.min(1, Math.max(0, toFiniteNumber(intraStageRatio, 0)));
  const completed = Math.max(0, toFiniteNumber(completedStages, 0));
  return Math.min(1, (completed + intra) / (completed + 1 + intra));
}

// ── 纯辅助 ────────────────────────────────────────────────────────────

// 候选池是否大到值得做 racing 粗筛（导出供测试与文档引用）。
export function isBudgetRacingPool(candidateCount) {
  return Number(candidateCount) > BUDGET_OPTIMIZER_RACING_MIN_POOL;
}

// 保留数量 = clamp(ceil(N × refineKeepRatio), refineKeepMin, N)——粗筛与精筛共用同一口径。
export function resolveBudgetKeepCount(poolSize, preset) {
  const total = Math.max(0, Math.floor(toFiniteNumber(poolSize, 0)));
  if (total === 0) return 0;
  const ratioKeep = Math.ceil(total * Math.max(0, toFiniteNumber(preset?.refineKeepRatio, 0)));
  const minKeep = Math.max(1, Math.floor(toFiniteNumber(preset?.refineKeepMin, 1)));
  return Math.min(total, Math.max(minKeep, ratioKeep));
}

// 评估分片大小：使片数 ≤ maxShards 的最小片长（下限 2 —— 每片一场时调度固定开销占比过高）；
// 返回 0 表示不分片（样本数 < 分片阈值 / 并行预算 < 2 / 单片即全量）。
export function resolveBudgetEvaluationShardSize(seedCount, maxShards) {
  const total = Math.max(0, Math.floor(toFiniteNumber(seedCount, 0)));
  const limit = Math.max(1, Math.floor(toFiniteNumber(maxShards, 1)));
  if (total < BUDGET_OPTIMIZER_EVALUATION_SHARD_MIN_SEEDS || limit < 2) return 0;
  const size = Math.max(2, Math.ceil(total / limit));
  return size < total ? size : 0;
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

// 配对统计的目标指标摘要：{ rounds, mean, stdError, t, pValue, verdict }（缺失时 null）。
function objectiveSummaryOf(paired, metricKey) {
  return paired?.metrics?.[metricKey] ?? null;
}

// 空蓝判负：逐种子的「基线不空蓝 → 候选空蓝」计数 > 0。
function hasManaRegression(paired) {
  return toFiniteNumber(paired?.manaRegressions, 0) > 0;
}

// 阶段统计合并（样本复用 + 基线补齐共用）：
//   - 任一侧是失败结构 → 合并结果同样失败（配对要求等长，诚实失败）；
//   - 两侧样本按 [前段…, 后段…] 顺序拼接后走 aggregateRoundMetrics（与评估管道同一聚合口径）。
function mergeEvaluationMetrics(...parts) {
  const list = parts.filter((part) => part && typeof part === 'object');
  if (list.length === 0) return createDegenerateMetrics('No simulation rounds were evaluated.');
  const failed = list.find((part) => part.failed === true);
  if (failed) return createDegenerateMetrics(failed.error || 'Simulation failed.');
  const samples = list.flatMap((part) => (Array.isArray(part.samples) ? part.samples : []));
  if (samples.length === 0) return createDegenerateMetrics('No simulation rounds were evaluated.');
  return aggregateRoundMetrics(samples);
}

// 跨步复用的基线包构建（2026-10-09，与首评失败防御对称）：选中项评估为失败退化结构
//（aggregateRoundMetrics 口径：任一场模拟失败即整份退化）或缺失时不进缓存 —— 失败结构一旦
// 写入 reuseContext.baselineBundle，下一步 baselineFromCache=true 跳过基线评估，全部候选配对
// 统计为 null 而终止（且停因误报为「剩余额度内已无可买项」）；置 null 强制下一步走「无缓存
// 重评」分支，抖动不阻断链。bundle 构建委托给注入的 buildBundle（闭包内 buildBaselineBundle：
// all = 全量样本聚合，screen = 前 screenSeeds 场切片），本函数只承载写入侧的失败判定。
export function buildReusableBaselineBundle(chosenMetrics, buildBundle) {
  if (chosenMetrics == null || chosenMetrics.failed === true) return null;
  return buildBundle(chosenMetrics);
}

// 候选「做法」（报告结构化口径，2026-10-09 键化）：{ key, count } —— key 为稳定键
//（market-buy / ability-book / house-upgrade，空串 = 未知做法），count 为可选档位
//（装备强化等级；无档位时为 null）。展示文案由 UI 按当前语言组装；旧报告该字段是旧中文文本，
// 读取方需容忍字符串形态。
function resolveCandidateMethod(candidate) {
  if (candidate?.kind === 'equipment') {
    const level = Number(candidate?.effect?.enhancementLevel);
    return { key: BUDGET_OPTIMIZER_METHOD_MARKET_BUY, count: Number.isFinite(level) ? level : null };
  }
  if (candidate?.kind === 'ability') return { key: BUDGET_OPTIMIZER_METHOD_ABILITY_BOOK, count: null };
  if (candidate?.kind === 'house') return { key: BUDGET_OPTIMIZER_METHOD_HOUSE_UPGRADE, count: null };
  return { key: '', count: null };
}

// 排序条目的「乐观上界」：mean + 3×se；无配对统计 → -Infinity（沉底）；空蓝回归直接判负。
function rankEntryFor(candidate, stats, metricKey) {
  const paired = stats?.paired ?? null;
  const summary = objectiveSummaryOf(paired, metricKey);
  const mean = Number(summary?.mean);
  const se = Number(summary?.stdError);
  const disqualified = hasManaRegression(paired);
  let bound = Number.NEGATIVE_INFINITY;
  if (!disqualified && Number.isFinite(mean)) {
    // se 缺失（单样本）时退回点估计：宁可用弱证据排序，也不把候选误沉底。
    bound = Number.isFinite(se) ? mean + BUDGET_OPTIMIZER_RACING_NOISE_MULTIPLIER * se : mean;
  }
  return {
    candidate,
    stats: stats ?? null,
    paired,
    disqualified,
    mean: Number.isFinite(mean) ? mean : Number.NEGATIVE_INFINITY,
    bound,
  };
}

// 全序比较器（确定性）：乐观上界 → 点估计 → 成本低者优先 → id 字典序。
// 注意 -Infinity - -Infinity = NaN（falsy），会自然落到下一级比较，不会卡在 NaN 上。
function compareRankEntries(left, right) {
  const leftId = String(left?.candidate?.id ?? '');
  const rightId = String(right?.candidate?.id ?? '');
  return (
    right.bound - left.bound ||
    right.mean - left.mean ||
    toFiniteNumber(left?.candidate?.cost, 0) - toFiniteNumber(right?.candidate?.cost, 0) ||
    (leftId < rightId ? -1 : leftId > rightId ? 1 : 0)
  );
}

// 评估期间的模块级单运行闸门：三查（预算注册表 + 共享 realm + 首页多轮批）。
function assertBudgetOptimizerEntranceClear() {
  if (hasBudgetOptimizerRunInProgress()) throw new Error(BUDGET_OPTIMIZER_BUSY_ERROR);
  if (hasSharedWorkerRunInProgress()) throw new Error(SHARED_RUN_BUSY_ERROR);
  if (hasHomeMultiRoundWorkerRunInProgress()) throw new Error(SHARED_RUN_BUSY_ERROR);
}

// 有限数才上抛，NaN/Infinity 一律 null（报告是持久化数据，不能带非 JSON 友好的值）。
function finiteOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// 候选记录（步骤明细快照里的行，照 v3 buildCandidateRecord 口径）。
function buildCandidateRecord(candidate, chosenStats, objectiveMetricKey, refinedSet) {
  const paired = chosenStats?.paired ?? null;
  const objective = objectiveSummaryOf(paired, objectiveMetricKey);
  const mean = Number(objective?.mean);
  const se = Number(objective?.stdError);
  return {
    id: candidate.id,
    groupKey: candidate.groupKey,
    kind: candidate.kind,
    label: candidate.label,
    fromLabel: candidate.fromLabel ?? '',
    toLabel: candidate.toLabel ?? '',
    // 结构化 from/to 状态：**仅供 UI 展示**（名称/等级由 UI 按当前语言现场组装）；
    // 应用载荷不进报告（store 写回用报告的 finalConfig，不按候选 id 反查）。
    effect: candidate.effect ?? null,
    fromEffect: candidate.fromEffect ?? null,
    cost: candidate.cost,
    method: resolveCandidateMethod(candidate),
    costDetail: candidate.costDetail ?? null,
    // deltaDps（旧兼容名）与 deltaObjective（泛化名）同存当前目标的 Δ 均值；
    // deltaProfit / deltaXp 始终为对应指标自身口径。
    deltaDps: Number.isFinite(mean) ? mean : null,
    deltaObjective: Number.isFinite(mean) ? mean : null,
    se: Number.isFinite(se) ? se : null,
    deltaProfit: finiteOrNull(paired?.metrics?.dailyNoRngProfit?.mean),
    deltaXp: finiteOrNull(paired?.metrics?.xpPerHour?.mean),
    significant: String(objective?.verdict ?? '') === 'positive',
    refined: refinedSet.has(candidate.id),
    rounds: toFiniteNumber(chosenStats?.metrics?.rounds, 0),
    manaRegression: hasManaRegression(paired),
  };
}

// 步骤候选明细快照：按证据分档 + 性价比排序后截取头部 LIMIT 条（报告要持久化，候选池大 ×
// 步数多会撑爆 localStorage）。档序：FREE（-1）= 免费项（净支出 ≤ 0 的正提升）；
// 0 = 精筛且可用；1 = 粗筛（证据不足）；2 = 不可用（空蓝回归 / 负提升 / 无效值）。
function evidenceRankOfRecord(record) {
  return resolveBudgetEvidenceBand({
    manaRegression: record?.manaRegression,
    delta: record?.deltaObjective,
    cost: record?.cost,
    refined: record?.refined,
  });
}

// 付费候选的性价比（Δ目标 / 成本，供 0/1 档内排序用）。免费项（成本 ≤ 0）按约定取 +Infinity
// ——「白拿的提升」效率最高，与定选口径（pickBestCandidate）一致；免费项档内的次序由
// compareFreeByDeltaThenId 承载（定选与快照两处共享）；缺失 / 非法值仍沉底。
function efficiencyOfRecord(record) {
  const delta = Number(record?.deltaObjective);
  const cost = Number(record?.cost);
  if (!Number.isFinite(delta) || !Number.isFinite(cost)) return Number.NEGATIVE_INFINITY;
  if (!(cost > 0)) return Number.POSITIVE_INFINITY;
  return delta / cost;
}

function recordDeltaOf(record) {
  const delta = Number(record?.deltaObjective);
  return Number.isFinite(delta) ? delta : Number.NEGATIVE_INFINITY;
}

function idCompare(left, right) {
  const leftId = String(left?.id ?? '');
  const rightId = String(right?.id ?? '');
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

// 免费项内部排序口径（定选 pickBestCandidate 与快照 FREE 档共享同一比较器，防两处口径漂移）：
// Δ 降序 —— 「白拿的提升」大者优先；并列按 id 字典序（确定性）。定选侧 delta 为有限正数
//（入池前已过滤 mean 有限且 > 0）；快照侧经 recordDeltaOf 兜底，极端并列可能产生 NaN（falsy）
// 自然落到 id 兜底，与快照原有口径逐位一致。
function compareFreeByDeltaThenId(leftDelta, rightDelta, leftId, rightId) {
  const leftKey = String(leftId ?? '');
  const rightKey = String(rightId ?? '');
  return rightDelta - leftDelta || (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0);
}

function buildStepCandidatesSnapshot(candidates, refineStatsById, screenStatsById, objectiveMetricKey) {
  const refinedSet = new Set(refineStatsById.keys());
  const pickStatsFor = (id) => refineStatsById.get(id) ?? screenStatsById.get(id) ?? null;
  const records = candidates.map((candidate) =>
    buildCandidateRecord(candidate, pickStatsFor(candidate.id), objectiveMetricKey, refinedSet),
  );
  const ranked = [...records].sort((left, right) => {
    const leftRank = evidenceRankOfRecord(left);
    const rightRank = evidenceRankOfRecord(right);
    if (leftRank !== rightRank) return leftRank - rightRank;
    if (leftRank === BUDGET_OPTIMIZER_EVIDENCE_BAND_FREE || leftRank === 2) {
      // 免费项档 / 不可用档内部：Δ 降序（免费项 = 白拿的提升大者靠前；不可用档 = 损失小者靠前），
      // 并列按 id —— 与定选免费项共享 compareFreeByDeltaThenId（UI 明细表直接消费本快照序，
      // 口径同源）；两档都不比较 %/B（成本 ≤ 0 时分母无定义）。
      return compareFreeByDeltaThenId(recordDeltaOf(left), recordDeltaOf(right), left.id, right.id);
    }
    return (
      efficiencyOfRecord(right) - efficiencyOfRecord(left) ||
      toFiniteNumber(left.cost, 0) - toFiniteNumber(right.cost, 0) ||
      idCompare(left, right)
    );
  });
  const limited = ranked.slice(0, BUDGET_OPTIMIZER_STEP_CANDIDATES_LIMIT);
  return {
    candidates: limited,
    total: records.length,
    truncated: Math.max(0, records.length - limited.length),
  };
}

// ── 主入口 ────────────────────────────────────────────────────────────

// optimizeBudgetUpgrades(input, callbacks)
//
// input = {
//   playerConfig,        // 必填：主角配置（store.players 里的形态；链的工作配置起点）
//   teammates,           // 可选：冻结队友配置数组（整队模拟；只改主角）
//   simulationSettings,  // 必填：首页模拟设置子集（zone/dungeon + 难度 + 时长）
//   extra,               // 可选：直接覆盖 payload.extra（缺省由 buildSimulationExtra 生成）
//   settings,            // 可选：优化器设置（预算/band/范围开关/预设/时长/队友勾选）
//   pricing: { pricingState, pricingOptions }, // 前者供候选成本，后者供收益口径
//   parallelWorkerLimit / parallelWorkerHardMax, // 并行 worker 上限
//   startedAt,           // 可选：store 侧计时原点（报告/进度的 elapsedSeconds 同口径）
//   WorkerClientCtor,    // 可选：测试桩注入点
// }
// callbacks = { onProgress, onCancel, onStep }
//   onStep(step)：每完成一步立刻上报该步记录；取消时不重放（已完成步骤早已逐个上报过）。
//
// 返回报告（取消也 resolve，含已完成步骤）：
// {
//   version: 2, createdAt, elapsedSeconds, cancelled, objective: 'dps'|'profit'|'xp',
//   stopReason: 'exhausted' | 'step-limit' | 'cancelled' | 'significance-blocked',
//   settings: { ...归一化设置, budgetHigh, preset, teammateIds },
//   baseline: { metrics: 数值摘要 },            // 链起点（原始主角配置）基线 = 第一步基线（同一次评估）
//   verification: { rounds, baseline: { metrics }, final: { metrics }, paired } | null,
//                                 // 链终复验（配对口径）：起点与终点配置用 verify 盐同一批新种子
//                                 // 各测一次，paired = 终点 − 起点的逐种子配对差摘要
//                                 //（可选字段，取消/零步链/旧报告为 null；任一侧失败 paired 为 null）
//   steps: [ { index, candidate, cost, deltaObjective, deltaDps, se, baselineBefore,
//              candidatesSnapshot: { candidates, total, truncated }, remainingBudgetAfter,
//              elapsedSeconds } ],
//   totalCost, remainingBudget,
//   finalSnapshot,       // 终止那次（无可买项）的候选快照 —— 「为什么停」的证据；step-limit 时为 null
//   finalConfig,         // 应用全部步骤后的主角配置（store 链结束写回用）
//   diagnostics: { skippedNoPrice, candidateCount, stages, simulations, evaluations,
//                  maxConcurrentWorkers, racingUsed, significanceBlocked, steps },
//                  // significanceBlocked = 终止当步被显著性门槛拦下的「买得起但不显著」候选数
//                  //（> 0 且门槛开启 → stopReason = significance-blocked）
//                  // stages[] = { stage, evaluated, simulations, elapsedMs, ... }；
//                  // elapsedMs 为阶段墙钟耗时（2026-10-08 新增的诊断字段）
// }
// inputSignature/stale/appliedInputSignature 不在本报告：由 store 层负责（照 trigger 分工）。
export async function optimizeBudgetUpgrades(input = {}, callbacks = {}) {
  assertBudgetOptimizerEntranceClear();

  const initialPlayerConfig = isPlainObject(input.playerConfig) ? input.playerConfig : null;
  if (!initialPlayerConfig) throw new Error(MISSING_PLAYER_ERROR);

  const { onProgress, onCancel, onStep } = callbacks || {};
  const simulationSettings = isPlainObject(input.simulationSettings) ? input.simulationSettings : {};
  const extra = input.extra;
  const settings = normalizeBudgetOptimizerSettings(input.settings);
  const preset = resolveBudgetOptimizerPreset(settings);
  const objectiveMetricKey = resolveBudgetObjectiveMetricKey(settings.objective);
  // 定选显著性门槛（设置开关，2026-10-09 起默认开启）：开启后定选只接受配对 t 检验显著为正的候选
  //（verdict === 'positive'，即 p < 0.05），滤掉「均值碰巧为正」的噪声升级。
  const requireSignificance = settings.pickSignificanceGate === true;
  const pricing = isPlainObject(input.pricing) ? input.pricing : {};
  const pricingState = isPlainObject(pricing.pricingState) ? pricing.pricingState : {};
  const pricingOptions = isPlainObject(pricing.pricingOptions) ? pricing.pricingOptions : {};
  // 抵扣口径（2026-10-09 接通全局 baselineSaleSide 设置）：store 从 activeQueueState.settings
  // 读取并组装进 input；归一化仅接受 'ask'，其余（含缺省）一律 'bid'，与队列页/成本弹窗同口径。
  // domain 的 buildBudgetCandidates 内部另有二次归一化兜底。
  const saleSide = normalizeBaselineSaleSide(input.saleSide);
  // 估值回退（2026-10-08）：装备/技能候选买入侧缺价时按 MWITools 装备价值口径估值参与搜索。
  // 由 store 层动态加载 assetScoreService 后注入（重链不进本 chunk）；缺省 = 旧行为（缺价跳过）。
  const fairValueResolver = typeof input.fairValueResolver === 'function' ? input.fairValueResolver : undefined;
  const teammates = (Array.isArray(input.teammates) ? input.teammates : []).filter((mate) => isPlainObject(mate));
  const preferredPlayerId = String(initialPlayerConfig.id ?? '1');
  const WorkerClientCtor = typeof input.WorkerClientCtor === 'function' ? input.WorkerClientCtor : undefined;
  // 样本复用开关（2026-10-08）：生产默认启用；测试传 disableSampleReuse=true 走「逐位重评」
  // 对照路径（复用样本与重评样本构造性一致，报告数值应逐位相同）。
  const sampleReuseEnabled = input.disableSampleReuse !== true;
  const workerLimit = normalizeParallelWorkerLimit(
    input.parallelWorkerLimit,
    input.parallelWorkerHardMax ?? QUEUE_PARALLEL_WORKER_LIMIT_MAX,
  );
  const budgetHigh = resolveBudgetHigh(settings);
  // 链步数上限：'unlimited'（用完预算，缺省）= 安全阀；'custom' = 用户设定的 maxChainSteps。
  const stepCap = resolveBudgetOptimizerStepCap(settings);
  // 链起点（等级上限基准）：maxLevelUp / maxHouseUp 相对它计算，防止链把等级推过用户设置意图。
  const basePlayerConfig = deepClone(initialPlayerConfig);

  const run = { cancelRequested: false };
  registerBudgetOptimizerRun(run);
  const startedAt = Number(input.startedAt) || Date.now();
  const publish = createProgressPublisher(onProgress, startedAt);

  // ── 运行状态 ────────────────────────────────────────────────────────
  let phase = 'preparing';
  let evaluations = 0;
  let simulations = 0;
  let activeTasks = 0;
  let maxConcurrentWorkers = 0;
  let workingConfig = deepClone(initialPlayerConfig); // 链的工作配置（逐步应用）
  let remainingBudget = budgetHigh;
  const steps = [];
  const stages = [];
  let stage = null;
  // 已完成阶段数：链进度的分母基准。链长未知，按「阶段」而非「步」记账 —— 同一步内 screening →
  // refining 的阶段内进度会归零，只有分母随阶段完成同步 +1，阶段交接处才不会回落（见 buildChainProgress）。
  // 只在本闭包的 finishStage 自增：costing 是同步块（手动 push 到 stages），不计入。
  let stageCount = 0;
  let racingUsed = false;
  let cancelled = false;
  let fatalError = null;
  let firstStepCandidateCount = 0;
  let firstStepSkippedNoPrice = 0;
  let firstStepSkippedNoPriceDetails = [];
  let firstStepSkippedNoPriceDetailsTruncated = 0; // 第一步缺价明细超上限被截掉的条数（报告透传）
  let firstStepFallbackFairValue = 0; // 第一步估值救回的候选数（缺价但按估值参与搜索）
  // 第一步「估值不足」跳过的候选数（skippedNoPrice 的子集；2026-10-16 诊断分流，报告透传）。
  let firstStepSkippedFairValueBelowSale = 0;
  let chainBaselineMetrics = null; // 链起点基线（报告 baseline 字段）
  // 第一步基线缓存（{ all, screen }）：链起点基线与第一步基线是同一次评估（2026-10-08 合并），
  // 主循环前算出；step0 的 screen 基线取 all 的样本子集（前 screenSeeds 场），不重复评估。
  let firstStepBaseline = null;
  // 跨步样本复用上下文（2026-10-08）：上一步选中项落地后写入 —— { pickedGroupKey,
  // baselineBundle, screenMetricsById, refinedMetricsById }；下一步对同组候选与基线直接取用
  //（同配置 + 同种子 → 样本逐位一致），省掉重复模拟。null = 无可复用（step0 或上一步未选中）。
  let reuseContext = null;
  let verificationResult = null; // 链终复验（起点/终点原始指标 + 配对统计；取消/零步链保持 null）
  let finalSnapshot = null; // 终止那次（无可买项）的候选快照
  let finalGateBlocked = 0; // 终止那次被显著性门槛拦下的候选数（报告 stopReason 分流依据）

  const ensureActive = () => {
    if (run.cancelRequested) throw createWorkerRunCancellationError();
  };

  // 进度快照：phase + 链进度（已完成阶段数 + 当前阶段内进度）+ 当前阶段计数 + 已完成步数。
  const emit = (extraFields = {}, force = false) => {
    const stageDone = stage ? stage.done : 0;
    const stageTotal = stage ? stage.total : 0;
    const intra = stageTotal > 0 ? stageDone / stageTotal : 0;
    publish(
      {
        phase,
        progress: buildChainProgress(stageCount, intra),
        evaluated: stageDone,
        total: stageTotal,
        stepsDone: steps.length,
        ...extraFields,
      },
      force,
    );
  };

  const beginStage = (name, total = 0) => {
    stage = {
      name,
      total: Math.max(0, Math.floor(total)),
      done: 0,
      startedAtMs: Date.now(),
      startEvaluations: evaluations,
      startSimulations: simulations,
    };
  };

  const finishStage = (extraFields = {}) => {
    if (!stage) return;
    stages.push({
      stage: stage.name,
      evaluated: evaluations - stage.startEvaluations,
      simulations: simulations - stage.startSimulations,
      // 阶段墙钟耗时（诊断用，2026-10-08 加）：定位瓶颈（粗筛 / 精筛 / 复验哪一段最烧时间）。
      elapsedMs: Math.max(0, Date.now() - stage.startedAtMs),
      ...extraFields,
    });
    stage = null;
    // 阶段完成入账：阶段内进度随之归零，但进度分母 +1 —— 交接处取值连续（见 buildChainProgress）。
    stageCount += 1;
  };

  const accountEvaluation = (seedCount) => {
    evaluations += 1;
    simulations += Math.max(0, Math.floor(toFiniteNumber(seedCount, 0)));
  };

  // 单次评估：构建 payload（指定配置应用 effects + 冻结队友）→ 专用 worker（批量优先，逐场回退）。
  // config 参数化（配对复验需要）：链内评估传工作配置；链终复验对「起点 / 终点」各评一次
  //（同一批 verify 盐种子），evaluateEffects 保持旧的「工作配置」签名作薄别名。
  // shardConcurrency（2026-10-08）：> 1 时启用评估内样本分片 —— 样本数 ≥ 分片阈值即把
  //「一个配置 × N 场」拆成 K 片（K ≤ shardConcurrency）并发下池（每片一个批量调用、各持一个
  // realm），少配置多场次的评估也能吃满 worker 池。样本按片索引顺序合并，统计口径不变。
  // shardConcurrency 必须是「该评估可用的并发预算」：池内调用点（screening / refining 的基线）按
  // 池内剩余容量折算（resolvePoolShardBudget），不得直接传 workerLimit —— 否则分片与同池候选的
  // 并发相加会突破池容量；池内候选评估保持整批一次。
  const evaluateConfigEffects = async (config, effects, seeds, { shardConcurrency = 0 } = {}) => {
    ensureActive();
    const payload = buildBudgetCandidatePayload(config, simulationSettings, extra, effects, { teammates });
    const options = {
      WorkerClientCtor,
      pricingOptions,
      preferredPlayerId,
      poolCapacity: workerLimit,
    };
    const seedList = Array.isArray(seeds) ? seeds : [];
    const shardSize = resolveBudgetEvaluationShardSize(seedList.length, shardConcurrency);
    if (shardSize <= 0) {
      return evaluateBudgetPayload(payload, { ...options, seeds: seedList });
    }
    const shards = [];
    for (let start = 0; start < seedList.length; start += shardSize) {
      shards.push(seedList.slice(start, start + shardSize));
    }
    const parts = new Array(shards.length).fill(null);
    await runEvaluationPool(shards.length, async (index) => {
      parts[index] = await evaluateBudgetPayload(payload, { ...options, seeds: shards[index] });
    });
    return mergeEvaluationMetrics(...parts);
  };
  const evaluateEffects = (effects, seeds, options) => evaluateConfigEffects(workingConfig, effects, seeds, options);

  // 链种子派生（2026-10-08 起全链共享：不再入步号）——全链一套 screen 盐 + refine 盐补评。
  // 样本复用要求「同一配置 + 同一批种子」可跨步命中（上一步评估过的配置在本步直接复用，
  // 见 reuseContext）；原「步号入键、每步独立实验」的代价只是逐步 Δ 之间的相关性（展示
  // 层面），链终复验用独立 verify 盐，最终结论不受影响。链起点基线（第一步基线）与各步
  // 共用同一派生，两处必须出自同一调用，否则配对失效。
  const deriveChainSeeds = () => {
    const seedContext = { playerId: preferredPlayerId, simulationSettings };
    const screenSeeds = createBudgetOptimizerSeedSet({
      ...seedContext,
      salt: BUDGET_OPTIMIZER_SEED_SALT_SCREEN,
      count: preset.screenSeeds,
    });
    const refineExtraCount = Math.max(0, Math.floor(preset.refineSeeds) - Math.floor(preset.screenSeeds));
    const refineExtraSeeds =
      refineExtraCount > 0
        ? createBudgetOptimizerSeedSet({
            ...seedContext,
            salt: BUDGET_OPTIMIZER_SEED_SALT_REFINE,
            count: refineExtraCount,
          })
        : [];
    return { screenSeeds, refineExtraSeeds, refinedSeeds: [...screenSeeds, ...refineExtraSeeds] };
  };
  const chainSeeds = deriveChainSeeds();

  // 16 场全量样本 → screen 段片段（前 screenSeeds 场）的聚合：切片口径 = 样本顺序
  // [screen…, refine…]（由种子集合顺序保证）。失败 / 样本不足 → 退化结构（与「单独评估
  // 基线失败」的旧语义一致）。
  const screenScreenSliceOf = (metrics) => {
    const samples = Array.isArray(metrics?.samples) ? metrics.samples : [];
    const screenCount = Math.max(1, Math.floor(toFiniteNumber(preset.screenSeeds, 1)));
    if (metrics?.failed === true || samples.length < screenCount) {
      return createDegenerateMetrics(metrics?.error || 'Baseline evaluation failed.');
    }
    return aggregateRoundMetrics(samples.slice(0, screenCount));
  };

  // 基线缓存包（all = 全量样本聚合；screen = 前 screenSeeds 场的子集聚合）：链起点基线
  // （第一步）与跨步复用（上一步选中项的样本）共用同一构建口径。
  const buildBaselineBundle = (metrics) => ({ all: metrics, screen: screenScreenSliceOf(metrics) });

  // 并行评估池：workerLimit 钳到任务数；每个任务预留前过 ensureActive（取消即中止全池）。
  const runEvaluationPool = async (taskCount, runTask) => {
    if (taskCount <= 0) return;
    await runParallelWorkerPool({
      taskCount,
      workerLimit: Math.min(workerLimit, taskCount),
      ensureActive,
      runTask: async (index) => {
        activeTasks += 1;
        maxConcurrentWorkers = Math.max(maxConcurrentWorkers, activeTasks);
        try {
          await runTask(index);
        } finally {
          activeTasks -= 1;
        }
      },
    });
  };

  // 池内评估的分片预算（2026-10-09）：池内调用点（screening / refining 的基线）的 shardConcurrency
  // 必须是「该评估可用的并发预算」—— 池会派生 poolWorkers = min(workerLimit, taskCount) 个 worker，
  // 基线之外的并发任务最多占 poolWorkers − 1 个，故分片预算 = max(1, workerLimit − (poolWorkers − 1))：
  // 满池（任务数 ≥ workerLimit）时退化为 1（不分片，瞬时并发峰值 = workerLimit）；池未满时保留分片收益。
  const resolvePoolShardBudget = (taskCount) =>
    Math.max(1, workerLimit - (Math.min(workerLimit, Math.max(1, taskCount)) - 1));

  // 数值摘要（报告用）：剔除 samples（配对统计原料留在内存，报告只留数值）。
  // null/失败结构 → rounds 0 + failed 标记（取消/失败时链基线可能没有可用数据）。
  const metricSummaryOf = (metrics) => ({
    dps: finiteOrNull(metrics?.dps),
    dailyProfit: finiteOrNull(metrics?.dailyProfit),
    dailyNoRngProfit: finiteOrNull(metrics?.dailyNoRngProfit),
    xpPerHour: finiteOrNull(metrics?.xpPerHour),
    killsPerHour: finiteOrNull(metrics?.killsPerHour),
    deathsPerHour: finiteOrNull(metrics?.deathsPerHour),
    ranOutOfMana: metrics?.ranOutOfMana === true,
    ranOutOfManaCount: toFiniteNumber(metrics?.ranOutOfManaCount, 0),
    rounds: toFiniteNumber(metrics?.rounds, 0),
    failed: metrics == null ? true : metrics.failed === true,
  });

  // ── 单步：在 remainingBudget 额度内选出并应用性价比最高的一项 ──────────
  // 返回 { picked: true, stepRecord } 或 { picked: false, snapshot, gateBlocked }（无可买项 /
  // 被显著性门槛拦下 → 链终止依据；gateBlocked 供报告切分 significance-blocked 停因）。
  const runChainStep = async (stepIndex) => {
    // 1) 成本预计算（剩余额度剪枝 + 链起点等级上限）。
    const costingStartedAtMs = Date.now();
    phase = 'costing';
    emit({}, true);
    ensureActive();
    const built = buildBudgetCandidates({
      playerConfig: workingConfig,
      pricingState,
      settings,
      saleSide,
      budgetHighOverride: remainingBudget,
      basePlayerConfig,
      fairValueResolver,
    });
    const candidates = built.candidates;
    const skippedNoPriceHere = toFiniteNumber(built.diagnostics?.skippedNoPrice, 0);
    if (stepIndex === 0) {
      firstStepCandidateCount = candidates.length;
      firstStepSkippedNoPrice = skippedNoPriceHere;
      // 缺价明细只取第一步（链上每步枚举的候选几乎相同，重复记录只膨胀报告）。
      firstStepSkippedNoPriceDetails = Array.isArray(built.diagnostics?.skippedNoPriceDetails)
        ? built.diagnostics.skippedNoPriceDetails
        : [];
      firstStepSkippedNoPriceDetailsTruncated = toFiniteNumber(built.diagnostics?.skippedNoPriceDetailsTruncated, 0);
      firstStepFallbackFairValue = toFiniteNumber(built.diagnostics?.fallbackFairValue, 0);
      firstStepSkippedFairValueBelowSale = toFiniteNumber(built.diagnostics?.skippedFairValueBelowSale, 0);
    }
    stages.push({
      stage: 'costing',
      evaluated: 0,
      simulations: 0,
      elapsedMs: Math.max(0, Date.now() - costingStartedAtMs),
      step: stepIndex,
      candidates: candidates.length,
      skippedNoPrice: skippedNoPriceHere,
      remainingBudget,
    });
    if (candidates.length === 0) {
      // 额度内已枚举不出候选（预算耗尽 / 全部超额度）：终止，无快照可留；门槛无候选可拦。
      return { picked: false, snapshot: null, gateBlocked: 0 };
    }

    // 2) 种子（全链共享一套，见 deriveChainSeeds 注释）；步内基线与候选共享同一列表（硬约束①）。
    const { screenSeeds, refineExtraSeeds, refinedSeeds } = chainSeeds;

    // 3) 基线（screen 样本）+ racing 粗筛（池大时）。
    //    基线来源（2026-10-08）：step0 = 链起点基线缓存；step>0 = 上一步复用的样本包（同配置
    //    + 同种子 → 直接可用）；都没有才评估（分片）。基线评估与候选评估**同池并行**——基线
    //    整批只有 screenSeeds 场（standard=4），单独 await 会让池空转；基线任务占据池索引 0，
    //    候选任务随后；配对统计改在池结束后统一计算（基线此时必已就绪）。
    //    候选复用（2026-10-08）：与上一步选中项同组（groupKey 相同）的候选，其配置在上一步
    //    已评估过 —— 命中 16 场全量则切出 screen 片段免评；命中 4 场片段则免评本段（精筛段补评）。
    phase = 'screening';
    const isFirstStep = stepIndex === 0;
    const reuse = !isFirstStep && sampleReuseEnabled ? reuseContext : null;
    const baselineBundle = isFirstStep ? firstStepBaseline : (reuse?.baselineBundle ?? null);
    const baselineFromCache = baselineBundle !== null;
    const canReuseCandidate = (candidate) => reuse !== null && candidate.groupKey === reuse.pickedGroupKey;
    const racingUsedHere = isBudgetRacingPool(candidates.length);
    if (racingUsedHere) racingUsed = true;
    const screenBaselinePending = !baselineFromCache;
    const screenBaselineOffset = screenBaselinePending ? 1 : 0;
    const screenTaskCount = screenBaselineOffset + (racingUsedHere ? candidates.length : 0);
    // 池内基线分片预算按剩余容量折算（resolvePoolShardBudget）：不得直接传 workerLimit。
    const screenShardBudget = resolvePoolShardBudget(screenTaskCount);
    beginStage('screening', screenTaskCount);
    emit({}, true);
    let baselineScreenMetrics = baselineFromCache ? baselineBundle.screen : null;
    const screenMetricsById = new Map();
    await runEvaluationPool(screenTaskCount, async (index) => {
      try {
        if (screenBaselinePending && index === 0) {
          baselineScreenMetrics = await evaluateEffects([], screenSeeds, { shardConcurrency: screenShardBudget });
          accountEvaluation(screenSeeds.length);
          return;
        }
        const candidate = candidates[index - screenBaselineOffset];
        if (canReuseCandidate(candidate)) {
          const reusedRefine = reuse.refinedMetricsById.get(candidate.id);
          if (reusedRefine) {
            // 16 场全量命中：切出 screen 段片段（样本顺序 [screen…, refine…]），本段免评。
            screenMetricsById.set(candidate.id, screenScreenSliceOf(reusedRefine));
            return;
          }
          const reusedScreen = reuse.screenMetricsById.get(candidate.id);
          if (reusedScreen) {
            // 4 场片段命中：本段免评（精筛段补评 refine 段）。
            screenMetricsById.set(candidate.id, reusedScreen);
            return;
          }
        }
        const metrics = await evaluateEffects([candidate.effect], screenSeeds);
        screenMetricsById.set(candidate.id, metrics);
        accountEvaluation(screenSeeds.length);
      } finally {
        if (stage) stage.done += 1;
        emit();
      }
    });

    // 池结束后统一配对（基线必已就绪；统计输入与串行版本逐位一致）。
    const screenStatsById = new Map();
    if (racingUsedHere) {
      for (const candidate of candidates) {
        const metrics = screenMetricsById.get(candidate.id);
        if (metrics) {
          screenStatsById.set(candidate.id, {
            metrics,
            paired: computePairedStats(metrics, baselineScreenMetrics),
          });
        }
      }
    }

    let refineTargets = candidates;
    if (racingUsedHere) {
      const rankedScreen = candidates
        .map((candidate) => rankEntryFor(candidate, screenStatsById.get(candidate.id), objectiveMetricKey))
        .sort(compareRankEntries);
      const kept = rankedScreen.slice(0, resolveBudgetKeepCount(rankedScreen.length, preset));
      finishStage({ step: stepIndex, kept: kept.length, skipped: false });
      refineTargets = kept.map((entry) => entry.candidate);
    } else {
      finishStage({ step: stepIndex, kept: candidates.length, skipped: true });
    }
    emit({}, true);

    // 4) 精筛（样本总数 = refineSeeds；粗筛样本复用 + 新增补评）。
    //    基线补评（refine 段）同样并入本阶段池（2026-10-08 并行化）：基线只有 refineExtraSeeds
    //    场，单独 await 时占不满池；并入后与幸存者评估共享并发。配对统计池后统一做。
    //    候选复用：命中上一步的 16 场全量时整段免评；命中 4 场片段时本段补评 refine 段后合并
    //   （复用条目不计入评估/场次账，只有真正发生的补评才入账）。
    phase = 'refining';
    const refineBaselinePending = !baselineFromCache && refineExtraSeeds.length > 0;
    const refineBaselineOffset = refineBaselinePending ? 1 : 0;
    const refineTaskCount = refineBaselineOffset + refineTargets.length;
    // 池内基线分片预算按剩余容量折算（resolvePoolShardBudget）：不得直接传 workerLimit。
    const refineShardBudget = resolvePoolShardBudget(refineTaskCount);
    beginStage('refining', refineTaskCount);
    emit({}, true);

    //    链起点 / 上一步复用的全量基线来自 baselineBundle（16 场 = screen + refine 两段样本）；
    //    其余步的 refine 段补评与候选补评同池并行，池后与 screen 段合并。
    let baselineRefineExtraMetrics = null;
    const refinePartsById = new Map();
    await runEvaluationPool(refineTaskCount, async (index) => {
      try {
        if (refineBaselinePending && index === 0) {
          baselineRefineExtraMetrics = await evaluateEffects([], refineExtraSeeds, {
            shardConcurrency: refineShardBudget,
          });
          accountEvaluation(refineExtraSeeds.length);
          return;
        }
        const candidate = refineTargets[index - refineBaselineOffset];
        // 复用优先：上一步已评估的同 id 全量样本直接可用（配置与种子都相同）。
        if (canReuseCandidate(candidate)) {
          const reusedRefine = reuse.refinedMetricsById.get(candidate.id);
          if (reusedRefine) {
            refinePartsById.set(candidate.id, { reused: reusedRefine });
            return;
          }
        }
        if (racingUsedHere) {
          if (refineExtraSeeds.length > 0) {
            const extraMetrics = await evaluateEffects([candidate.effect], refineExtraSeeds);
            refinePartsById.set(candidate.id, { screen: screenMetricsById.get(candidate.id), extra: extraMetrics });
          } else {
            refinePartsById.set(candidate.id, {
              carried: screenMetricsById.get(candidate.id) ?? createDegenerateMetrics('Missing screening metrics.'),
            });
          }
          accountEvaluation(refineExtraSeeds.length);
        } else {
          // 小池路径：候选没有粗筛样本，直接用全量样本一次评估（对齐基线合并样本的顺序）；
          // 若上一步只留下 screen 段片段（racing 未幸存），补评 refine 段后合并，避免重评 4 场。
          const reusedScreen = canReuseCandidate(candidate) ? reuse.screenMetricsById.get(candidate.id) : null;
          if (reusedScreen && refineExtraSeeds.length > 0) {
            const extraMetrics = await evaluateEffects([candidate.effect], refineExtraSeeds);
            refinePartsById.set(candidate.id, { screen: reusedScreen, extra: extraMetrics });
            accountEvaluation(refineExtraSeeds.length);
          } else {
            const metrics = await evaluateEffects([candidate.effect], refinedSeeds);
            refinePartsById.set(candidate.id, { full: metrics });
            accountEvaluation(refinedSeeds.length);
          }
        }
      } finally {
        if (stage) stage.done += 1;
        emit();
      }
    });

    // 池后统一：基线合并（若本阶段补评）+ 全部候选配对（基线必已就绪）。
    let baselineMetrics = baselineScreenMetrics;
    if (refineExtraSeeds.length > 0) {
      baselineMetrics = baselineFromCache
        ? baselineBundle.all
        : mergeEvaluationMetrics(baselineScreenMetrics, baselineRefineExtraMetrics);
    }
    // 链起点基线首评失败、step0 独立重评成功：报告 baseline 改用这次真实测量 —— 否则报告会停在
    // failed 的 0 值（界面看起来像一次真实测量）。持续失败时不回填，由 diagnostics.baselineFailed 分流。
    if (isFirstStep && chainBaselineMetrics?.failed === true && baselineMetrics?.failed !== true) {
      chainBaselineMetrics = baselineMetrics;
    }
    const refineStatsById = new Map();
    for (const candidate of refineTargets) {
      const part = refinePartsById.get(candidate.id);
      if (!part) continue;
      const metrics =
        'reused' in part
          ? part.reused
          : 'full' in part
            ? part.full
            : 'extra' in part
              ? mergeEvaluationMetrics(part.screen, part.extra)
              : part.carried;
      refineStatsById.set(candidate.id, { metrics, paired: computePairedStats(metrics, baselineMetrics) });
    }
    finishStage({ step: stepIndex, kept: refineStatsById.size });
    emit({}, true);

    // 5) 候选明细快照（无论是否选中都保留 —— 每一步的「详情」数据）。
    const snapshot = buildStepCandidatesSnapshot(
      candidates,
      refineStatsById,
      racingUsedHere ? screenStatsById : new Map(),
      objectiveMetricKey,
    );

    // 6) 定选：精筛过、非空蓝、正提升、成本 ≤ 剩余额度的性价比第一（显著性门槛开启时
    //    还要求配对 t 检验显著为正）。
    const pickResult = pickBestCandidate(
      candidates,
      refineStatsById,
      objectiveMetricKey,
      remainingBudget,
      requireSignificance,
    );
    if (!pickResult.best) {
      // 有候选但无可选（全部空蓝/负提升/超额度，或全部被显著性门槛拦下）：终止，快照留档供
      // UI 展示「为什么停」；gateBlocked 供报告区分「买不起」与「不显著」两种停因。
      return { picked: false, snapshot, gateBlocked: pickResult.gateBlocked };
    }
    const pick = pickResult.best;

    // 7) 应用到工作配置（内存中；写回由 store 在链结束后统一做）。
    phase = 'applying';
    emit({}, true);
    ensureActive();
    const chosenStats = refineStatsById.get(pick.candidate.id);
    applyBudgetEffectToPlayerConfig(workingConfig, pick.candidate.effect);
    remainingBudget = Math.max(0, remainingBudget - toFiniteNumber(pick.candidate.cost, 0));

    // 复用上下文（2026-10-08）：本步评估过的「配置 → 样本」留给下一步直接复用。
    // 命中条件：下一步候选与本次选中项同组（groupKey 相同）——组内 effect 是绝对目标，
    //「本步工作配置 + 该候选」与「下一步工作配置 + 同 id 候选」是同一配置；种子全链共享，
    // 样本因此可逐位复用。baselineBundle 供下一步基线直接取用（= 选中项的 16 场样本）。
    reuseContext = {
      pickedGroupKey: String(pick.candidate.groupKey ?? ''),
      baselineBundle: buildReusableBaselineBundle(chosenStats?.metrics, buildBaselineBundle),
      screenMetricsById: new Map(screenMetricsById),
      refinedMetricsById: new Map([...refineStatsById].map(([id, entry]) => [id, entry.metrics])),
    };
    const objective = objectiveSummaryOf(chosenStats?.paired, objectiveMetricKey);
    const stepRecord = {
      index: stepIndex,
      candidate: buildCandidateRecord(pick.candidate, chosenStats, objectiveMetricKey, new Set(refineStatsById.keys())),
      cost: toFiniteNumber(pick.candidate.cost, 0),
      deltaObjective: finiteOrNull(objective?.mean),
      deltaDps: finiteOrNull(objective?.mean),
      se: finiteOrNull(objective?.stdError),
      baselineBefore: metricSummaryOf(baselineMetrics),
      candidatesSnapshot: snapshot,
      remainingBudgetAfter: remainingBudget,
      elapsedSeconds: (Date.now() - startedAt) / 1000,
    };
    return { picked: true, stepRecord };
  };
  // 注：runChainStep 函数体不吞错误 —— 任何阶段抛出的错误统一由主循环的 catch 收敛语义。

  // 定选：性价比第一（效率 = Δ目标/成本）；排除空蓝回归 / 非正提升 / 成本缺失或为负 /
  // 成本超剩余额度 / 未精筛（粗筛淘汰，证据不足）。免费项（成本 0：旧件卖价高于新件买价）按
  // 约定效率 +Infinity 参与定选 —— 白拿的提升优先，不再被静默排除。
  // requireSignificance 开启时额外要求配对 t 检验显著为正（verdict === 'positive' 即 p < 0.05；
  // verdict 缺失/unknown 一律视为不达标）——「宁缺毋滥」开关：滤掉均值碰巧为正的噪声候选，
  // 代价是链可能提前终止。付费项并列时成本低优先、再按 id 字典序（确定性）；免费项之间按
  // Δ 降序、id 兜底（compareFreeByDeltaThenId，与快照 FREE 档共享同一口径）。
  // 返回统一结构 { best: { candidate, efficiency } | null, gateBlocked }：gateBlocked = 被显著性
  // 门槛拦下的「买得起但不显著」候选数（报告据此把该停因与「买不起」区分开）。
  function pickBestCandidate(candidates, refineStatsById, metricKey, remaining, requireSignificance) {
    const eligible = [];
    let gateBlocked = 0;
    for (const candidate of candidates) {
      const stats = refineStatsById.get(candidate.id);
      if (!stats) continue;
      const entry = rankEntryFor(candidate, stats, metricKey);
      const mean = Number(entry.mean);
      // 成本显式取值：非有限 / 负值直接排除 —— 不做 Number(…, 0) 兜底，缺字段或脏值不得被当成免费项。
      const rawCost = Number(candidate.cost);
      if (entry.disqualified || !Number.isFinite(mean) || mean <= 0) continue;
      if (!Number.isFinite(rawCost) || rawCost < 0) continue;
      // 额度剔除先于门槛判定（两者都是纯过滤，eligible 集合逐位不变）：顺序决定计数口径 ——
      // 门槛计数只归因「买得起却不显著」，不把「不显著且买不起」算进门槛拦截。
      if (rawCost > remaining) continue;
      if (requireSignificance) {
        const verdict = String(objectiveSummaryOf(entry.paired, metricKey)?.verdict ?? '');
        if (verdict !== 'positive') {
          gateBlocked += 1;
          continue;
        }
      }
      // 免费项（成本 0）的效率按约定取 +Infinity（白拿提升优先）；免费项之间的次序不靠
      // 效率差（Infinity − Infinity = NaN），由共享口径 compareFreeByDeltaThenId 承载。
      const efficiency = rawCost > 0 ? mean / rawCost : Number.POSITIVE_INFINITY;
      eligible.push({ id: candidate.id, cost: rawCost, efficiency, delta: mean });
    }
    eligible.sort((left, right) => {
      // 双免费项：效率同为 +Infinity，直接走免费项口径（Δ 降序 → id 兜底）——与快照 FREE 档
      // 首行同序，「已选定」与弹窗最优行一致。
      if (left.cost <= 0 && right.cost <= 0) {
        return compareFreeByDeltaThenId(left.delta, right.delta, left.id, right.id);
      }
      // 其余路径行为不变：效率降序（单免费 +Infinity 对付费有限值自然排前）→ 成本低优先 → id。
      return (
        right.efficiency - left.efficiency ||
        left.cost - right.cost ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
      );
    });
    if (eligible.length === 0) return { best: null, gateBlocked };
    const best = eligible[0];
    return {
      best: {
        candidate: candidates.find((entry) => entry.id === best.id) ?? null,
        efficiency: best.efficiency,
      },
      gateBlocked,
    };
  }

  // 链终复验 → 报告摘要（JSON 安全）：baseline / final = 起点与终点配置在同一批 verify 盐种子
  // 下的测量（与报告顶层 baseline 同构：{ metrics: 数值摘要 }，含 failed 标记），paired =
  // 终点 − 起点的逐种子配对差摘要（目标指标口径：无偏 Δ + 噪声地板 + 显著性）。任一评估失败
  // → samples 缺失/不等长 → computePairedStats 返回 null → paired 留空，UI 按字段逐级回退。
  const buildVerificationReport = () => {
    if (!verificationResult) return null;
    const { verifyBaselineMetrics, verifyFinalMetrics, verifyPaired } = verificationResult;
    const paired = verifyPaired?.metrics?.[objectiveMetricKey] ?? null;
    return {
      rounds: toFiniteNumber(verifyFinalMetrics?.rounds ?? verifyBaselineMetrics?.rounds, 0),
      baseline: { metrics: metricSummaryOf(verifyBaselineMetrics) },
      final: { metrics: metricSummaryOf(verifyFinalMetrics) },
      paired: paired
        ? {
            rounds: toFiniteNumber(paired.rounds, 0),
            mean: finiteOrNull(paired.mean),
            stdError: finiteOrNull(paired.stdError),
            pValue: finiteOrNull(paired.pValue),
            verdict: String(paired.verdict || ''),
          }
        : null,
    };
  };

  try {
    // ── 链循环 ─────────────────────────────────────────────────────────
    emit({ progress: 0 }, true);
    ensureActive();
    ensureBudgetOptimizerCostReference();

    // 链起点基线（原始配置）= 第一步基线（同一次评估，2026-10-08 合并）：
    // 旧的「链起点基线（screen 盐 16 场，步号缺省）+ 第一步基线（screen 4 场 + refine 补齐 12 场）」
    // 是对同一配置的两次重复评估（共 32 场）；合并后 = step0 的 screen+refine 全集一次评估
    //（16 场，分片并行），省 16 场。报告 baseline 与第一步 baselineBefore 同源。
    // 失败不阻断链（2026-10-09 修正）：首评失败（抛错，或任一场模拟失败使聚合退化为失败结构）
    // **不写入** firstStepBaseline —— 失败结构一旦进缓存，step0 会因 baselineFromCache=true 跳过
    // 基线评估，全部候选配对统计为 null 而零步收尾（且被误报为「剩余额度内已无可买项」）。
    // 置 null 后 step0 走「无缓存」分支独立重评基线（screen 样本 + 精筛段补评 refine 新增样本，
    // 与候选共享同一批种子）——抖动不阻断链；持续失败时链路照常收尾，但报告记 failed 摘要并置
    // diagnostics.baselineFailed，由界面分流说明。
    try {
      const firstStepBaselineMetrics = await evaluateConfigEffects(workingConfig, [], chainSeeds.refinedSeeds, {
        shardConcurrency: workerLimit,
      });
      accountEvaluation(chainSeeds.refinedSeeds.length);
      chainBaselineMetrics = firstStepBaselineMetrics;
      // 退化的聚合结构（任一场模拟失败即整份退化，aggregateRoundMetrics 口径）同样属于首评失败。
      firstStepBaseline =
        firstStepBaselineMetrics?.failed === true ? null : buildBaselineBundle(firstStepBaselineMetrics);
    } catch (error) {
      if (isWorkerRunCancelledError(error)) throw error;
      const degenerate = createDegenerateMetrics(error?.message || 'Baseline evaluation failed.');
      chainBaselineMetrics = degenerate;
      firstStepBaseline = null;
    }

    for (let stepIndex = 0; stepIndex < stepCap; stepIndex += 1) {
      const outcome = await runChainStep(stepIndex);
      if (!outcome.picked) {
        finalSnapshot = outcome.snapshot ?? null;
        // 终止成因：门槛在当步拦下的「买得起但不显著」候选数（> 0 且门槛开启 → 走独立停因）。
        finalGateBlocked = toFiniteNumber(outcome.gateBlocked, 0);
        break; // exhausted / significance-blocked：剩余额度内已无「可买且可用」的升级项
      }
      steps.push(outcome.stepRecord);
      if (typeof onStep === 'function') onStep(outcome.stepRecord);
      emit({}, true);
    }

    // ── 链终复验（配对口径）：用 verify 盐的同一批新种子，对「链起点」与「链终点」两个配置
    // 各测一次，逐种子配对差分 → 无偏的最终提升测量（mean/se/verdict）──
    // 动机：各步 Δ 是「选中候选的自评」（赢者诅咒 + 逐步累加），推算的「优化后」只是账面值；
    // 若只复验终点，Δ 的分母仍是链起点基线的小样本估计（且与终点不同随机流），起点自身的
    // 运气与盐间差异会直接混进复验 Δ —— 起点/终点必须同种子配对。
    // 取消（快速响应停止）与零步链（finalConfig = 起点，无新信息）不跑；评估失败按退化结构
    // 进报告（paired 缺失，UI 回退）；取消错误原样上抛 → 主 catch 收敛为 cancelled 报告。
    if (!cancelled && steps.length > 0 && preset.verifySeeds > 0) {
      phase = 'verifying';
      beginStage('verifying', 2);
      emit({}, true);
      try {
        const verifySeeds = createBudgetOptimizerSeedSet({
          playerId: preferredPlayerId,
          simulationSettings,
          salt: BUDGET_OPTIMIZER_SEED_SALT_VERIFY,
          count: preset.verifySeeds,
        });
        const verifyResults = [null, null];
        await runEvaluationPool(2, async (index) => {
          // 同一批种子分别测「链起点配置」与「链终点配置」——逐种子配对差的前提。
          // 两个任务并发，各自的分片预算 = floor(workerLimit / 2)：两侧合计不超过池容量。
          const config = index === 0 ? deepClone(initialPlayerConfig) : workingConfig;
          const shardConcurrency = Math.max(1, Math.floor(workerLimit / 2));
          verifyResults[index] = await evaluateConfigEffects(config, [], verifySeeds, { shardConcurrency });
          accountEvaluation(verifySeeds.length);
        });
        verificationResult = {
          verifyBaselineMetrics: verifyResults[0],
          verifyFinalMetrics: verifyResults[1],
          verifyPaired: computePairedStats(verifyResults[1], verifyResults[0]),
        };
      } catch (error) {
        if (isWorkerRunCancelledError(error)) throw error;
        verificationResult = null; // 意外失败：放弃复验（不阻断报告），UI 回退账面口径。
      } finally {
        if (stage) stage.done += 2;
        emit({}, true);
      }
      finishStage();
    }
  } catch (error) {
    if (run.cancelRequested || isWorkerRunCancelledError(error)) {
      // 取消不算失败：收敛为 cancelled 语义，已完成步骤仍然自洽。
      cancelled = true;
      if (typeof onCancel === 'function') onCancel();
    } else {
      fatalError = error;
    }
  } finally {
    unregisterBudgetOptimizerRun(run);
  }

  if (fatalError) throw fatalError;

  // ── 报告组装 + 收尾 ─────────────────────────────────────────────────
  const hitStepLimit = !cancelled && steps.length >= stepCap;
  const report = {
    version: BUDGET_OPTIMIZER_REPORT_VERSION,
    createdAt: Date.now(),
    elapsedSeconds: (Date.now() - startedAt) / 1000,
    cancelled,
    // 优化目标（'dps' | 'profit' | 'xp'）：主指标字段（deltaObjective*）与旧兼容名（deltaDps*）
    // 都按它取数；UI 据此切换文案与基线口径。
    objective: settings.objective,
    // 优先级：cancelled > step-limit > significance-blocked > exhausted（门槛拦下全部「买得起」
    // 的候选时不再与「剩余额度内已无可买项」合并，用户可据此判断该放宽门槛还是确实买不起）。
    stopReason: cancelled
      ? BUDGET_OPTIMIZER_STOP_CANCELLED
      : hitStepLimit
        ? BUDGET_OPTIMIZER_STOP_STEP_LIMIT
        : requireSignificance && finalGateBlocked > 0
          ? BUDGET_OPTIMIZER_STOP_SIGNIFICANCE
          : BUDGET_OPTIMIZER_STOP_EXHAUSTED,
    settings: {
      ...settings,
      budgetHigh,
      preset: {
        screenSeeds: preset.screenSeeds,
        refineSeeds: preset.refineSeeds,
        verifySeeds: preset.verifySeeds,
        refineKeepRatio: preset.refineKeepRatio,
        refineKeepMin: preset.refineKeepMin,
      },
      teammateIds: teammates.map((mate) => String(mate.id ?? '')).filter(Boolean),
    },
    baseline: { metrics: metricSummaryOf(chainBaselineMetrics) },
    // 链终复验（可选字段；旧报告/取消/零步链为 null，UI 回退账面推算口径）：
    // baseline / final = 起点与终点配置在同一批 verify 盐种子下的测量（起点也复验，Δ 的
    // 分母不再依赖链起点基线的小样本估计）；paired = 终点 − 起点的逐种子配对差摘要。
    verification: buildVerificationReport(),
    steps,
    totalCost: steps.reduce((sum, step) => sum + toFiniteNumber(step.cost, 0), 0),
    remainingBudget,
    // 终止那次（无可买项）的候选快照：exhausted 时展示「最后还剩什么、为什么没买」；
    // step-limit / cancelled / 首步即空池时为 null。
    finalSnapshot,
    // 链终点配置：store 在链结束后把它整体写回主角（含全部已应用步骤），撤销压一条快照。
    finalConfig: deepClone(workingConfig),
    diagnostics: {
      skippedNoPrice: firstStepSkippedNoPrice,
      skippedNoPriceDetails: firstStepSkippedNoPriceDetails,
      skippedNoPriceDetailsTruncated: firstStepSkippedNoPriceDetailsTruncated,
      // 「估值不足」子集计数（2026-10-16）：skippedNoPrice 里估值可得但无法支撑正净支出的条数，
      // 与「完全缺价」区分（明细条目的 reason 标记为同一分流的逐条口径）。
      skippedFairValueBelowSale: firstStepSkippedFairValueBelowSale,
      fallbackFairValue: firstStepFallbackFairValue,
      candidateCount: firstStepCandidateCount,
      stages: [...stages],
      simulations,
      evaluations,
      maxConcurrentWorkers,
      racingUsed,
      // 链起点基线最终不可用（首评失败且 step0 独立重评也失败）：界面据此把零步链的停因 / 空态
      // 文案分流为「基线（模拟）失败」，不再复用「剩余额度内已无可买项」。
      baselineFailed: chainBaselineMetrics?.failed === true,
      // 终止当步被显著性门槛拦下的候选数（> 0 且门槛开启 → stopReason = significance-blocked）：
      // 供界面与事后排查把「不显著」与「剩余额度内已无可买项」区分开。
      significanceBlocked: finalGateBlocked,
      steps: steps.length,
    },
  };

  if (cancelled) {
    // 取消时强制补一次收尾进度（phase 保持最后阶段；store 依据报告 cancelled 切状态）。
    emit({}, true);
  } else {
    phase = 'done';
    emit({ progress: 1 }, true);
  }
  return report;
}

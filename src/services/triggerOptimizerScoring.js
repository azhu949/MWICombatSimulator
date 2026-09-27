// 技能触发器优化器 —— 打分（纯函数）。
//
// 把模拟产出的指标（computeQueueMetrics + deathsPerHour + playerRanOutOfMana + 逐轮
// samples）喂给目标函数，产出候选分数、排序比较、配对统计（信号/噪声）与 UI 用的
// delta 集合。全部纯函数，可离线单测；不依赖 worker / store / vue。
//
// 两层结果，用途不同，不要混：
//   1. 聚合分 scoreCandidate —— 候选的**聚合指标**相对**参考的聚合指标**打分。
//      搜索的采纳判据用它（数值是「相对基线的对数压缩」，2 倍提升 ≈ +1 分）。
//   2. 配对统计 computePairedStats —— 用逐轮样本按种子对齐相减，给出均值、标准误与
//      t 值。这才是「这个提升是真信号，还是这组种子的运气」的答案，直接喂给 UI。
//      上一版没有第 2 层，用户看到的「提升」既无法证伪也无法交叉验证。
//
// 第 2 层还有第二个用途（2026-09-18）：**采纳闸门**。shouldAdoptCandidate 现在要求
// 增量分高出最小效应量、且配对证据超过噪声地板（hasAdoptionEvidence）——没有证据就
// 保持现状。上一版只要求「配对信号不是 negative」，而 rounds<2 时 verdict 恒 unknown、
// rounds=2 时几乎恒 inconclusive，闸门形同虚设 → 采纳退化成在噪声里取最大值，实测
// 会把 +49% 的噪声报成提升。
// 门槛还必须与候选分**同参考系**（同日晚间实测复盘修正）：旧实现拿「上一个被采纳候选在
// 它自己那个参考系里的分」当门槛，等于每采纳一个槽就把其余槽的门槛抬高 MIN_ADOPT_SCORE，
// 系统性压制多槽叠加 —— 详见 shouldAdoptCandidate 上方注释与设计 §16.9。
//
// 复合分口径（与队列多轮打分同源，权重来自 shared/queuePerformanceWeights）：
//   score = Σ_m byMetric[m] * clamp(log2(1 + Δ_m/max(|base_m|,floor_m)), -1, 1)
//           - weightDeathSafety * max(deaths - deaths_base, 0) / max(deaths_base, 2.0)
//           + weightDeathSafety * min(1, max(deaths_base - deaths, 0) / max(deaths_base, 2.0)) * CREDIT
//           （+ 空蓝修复加分；空蓝回归 → -Infinity）
// 详见 triggerOptimizerDomain.computeObjectiveScore（公式唯一实现处）。
// 死亡的奖励与惩罚对称：增加死亡被惩罚、减少死亡被奖励（用户目标包含「死亡更低」）。

import jStat from 'jstat';

import { resolveQueuePerformanceSubweights } from '../shared/queuePerformanceWeights.js';
import {
  TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS,
  TRIGGER_OPTIMIZER_METRIC_KEYS,
  TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS,
  TRIGGER_OPTIMIZER_SCORE_EPSILON,
  TRIGGER_OPTIMIZER_VERIFY_APPEND_BUDGET_RATIO,
  TRIGGER_OPTIMIZER_VERIFY_APPEND_CUMULATIVE_BUDGET_RATIO,
  TRIGGER_OPTIMIZER_VERIFY_ROUNDS,
  computeObjectiveScore,
} from './triggerOptimizerDomain.js';
import { toFiniteNumber } from './utils.js';

// 配对统计覆盖的指标：四个目标指标 + 死亡（死亡项在目标函数里有奖有惩，逐轮
// 配对统计把它一并算出来，供 UI 展示「死亡率是否真的下降」）。
const PAIRED_METRIC_KEYS = [...TRIGGER_OPTIMIZER_METRIC_KEYS, 'deathsPerHour'];

// 显著性水平：双侧 5%。
export const TRIGGER_OPTIMIZER_SIGNIFICANCE_LEVEL = 0.05;

// ── 采纳闸门（2026-09-18 加固，实测教训）────────────────────────────────────
// 旧判据 = 「聚合分严格更大（eps=1e-9）且配对信号不是 negative」。问题：rounds<2 时
// 配对统计给不出标准误（verdict 恒 unknown），rounds=2（dof=1）时 t 要 ≥12.7 才显著
// （verdict 几乎恒 inconclusive）——「不是 negative」这道闸门实际上永远为真，采纳
// 退化成「在噪声里取最大值」。真实实测：快速档（rounds=1）把 +49% 利润的噪声报成
// 「提升」，标准档在一个已调优角色上采纳了 +0.00078 分的改动，复验（6 轮换种子）却
// 判它显著更差（p=0.022）。
//
// 现在的闸门要求**两条同时成立**：
//   ① 统计噪声地板：配对均值必须超过标准误的 NOISE_MULTIPLIER 倍（近似 |t| > 2），
//      或配对 t 检验直接给出 positive；没有逐轮样本（rounds<2 / 参考无 samples）时
//      **一律不采纳**——「样本不足」的正确处置是保持现状，不是赌一把。
//      注意这不是显著性声明（dof=1 时 2×SE 远达不到 p<0.05），显著性声明只由复验
//      的 6 轮 t 检验给出；这里是「比噪声大」的下限。
//   ② 最小效应量：增量分必须达到 MIN_ADOPT_SCORE。分数是**加权对数尺度**（默认权重
//      利润 0.5 / XP 0.3 / DPS 0.1 / 击杀 0.1），换算成单指标相对变化
//      （2^(0.01/w) − 1）是：利润 ≥ 1.4%、XP ≥ 2.3%、DPS 或击杀 ≥ 7.2%，避免把
//      「分数上刚好大一点点」的抖动当改进。
//   ③ 同参考系：门槛只允许与候选分**同参考系**的量比较（见 shouldAdoptCandidate）。
export const TRIGGER_OPTIMIZER_ADOPTION_NOISE_MULTIPLIER = 2;
export const TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE = 0.01;

// 双侧 p 值（Student-t，自由度 = 轮数 - 1）。
// 刻意**不**用「|t| ≥ 2 ≈ 95%」这类近似：那只在大样本下成立，而本功能默认
// 只有 2 轮抽样（自由度 1，t 要 12.7 才达 p<0.05）。用 jstat 算真实 p 值，
// 轮数少时结论自然保守 —— 这正是我们想让用户看到的（「样本不足」而不是假阳性）。
export function pairedPValue(t, rounds) {
  if (!Number.isFinite(t)) return 0;
  const dof = Number(rounds) - 1;
  if (!(dof >= 1)) return null;
  const cdf = jStat.studentt.cdf(Math.abs(t), dof);
  return Math.min(1, Math.max(0, 2 * (1 - cdf)));
}

// metrics：{ dps, dailyNoRngProfit, xpPerHour, killsPerHour, deathsPerHour, ranOutOfMana? }
// weights：{ weightProfit, weightXp }（或 resolveQueuePerformanceSubweights 的完整输出）；
//           缺省时回落到产品默认权重（0.5/0.3/0.2）。
// baselineMetrics：配对参考（**同一组种子**下的基线指标）的同结构指标；缺失视为全 0。
export function scoreCandidate(metrics, weights, baselineMetrics = {}) {
  return computeObjectiveScore(metrics, weights ?? TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS, baselineMetrics);
}

function scoreOf(entry) {
  const value = Number(entry?.score);
  // -Infinity 是合法的否决分，必须保留；NaN 视为最差。
  return Number.isFinite(value) ? value : -Infinity;
}

function metricOf(entry, key) {
  return toFiniteNumber(entry?.metrics?.[key], 0);
}

function distanceOf(entry) {
  const value = Number(entry?.distance);
  // 未携带距离信息的候选按「自定义改动」处理，让携带 0（默认/当前锚点）的候选并列时优先。
  return Number.isFinite(value) ? value : 2;
}

function compareSignature(left, right) {
  const a = String(left?.signature ?? '');
  const b = String(right?.signature ?? '');
  return a < b ? -1 : a > b ? 1 : 0;
}

// 排序比较（升序数组用 .sort(compareCandidates) 得到「分数高 → 改动小」的顺序）：
//   1. 分数高者优先（-Infinity 沉底）
//   2. 并列时配对信号更强者优先（有统计支撑的候选优先于「分数一样但说不清」的）
//   3. 再并列时利润高者优先（设计 §5.2 的确定性 tie-break）
//   4. 再并列时 DPS 高者优先
//   5. 仍并列时改动更小/更接近基线的候选优先（搜索确定收敛，避免在等价候选间抖动）
//   6. 最后按签名字典序（全序兜底，绝不返回 0）
export function compareCandidates(a, b) {
  return (
    scoreOf(b) - scoreOf(a) ||
    signalRank(b) - signalRank(a) ||
    metricOf(b, 'dailyNoRngProfit') - metricOf(a, 'dailyNoRngProfit') ||
    metricOf(b, 'dps') - metricOf(a, 'dps') ||
    distanceOf(a) - distanceOf(b) ||
    compareSignature(a, b)
  );
}

// 配对信号排序权重：positive=2 / inconclusive=1 / unknown=0 / negative=-1。
function signalRank(entry) {
  switch (entry?.paired?.score?.verdict) {
    case 'positive':
      return 2;
    case 'inconclusive':
      return 1;
    case 'negative':
      return -1;
    default:
      return 0;
  }
}

// 逐轮样本的统计摘要（mean / 标准误 / t / 自由度 / 双侧 p 值 / 结论）。
//   rounds < 2 → 标准误无从估计：t = null、pValue = null、verdict = 'unknown'
//                （UI 必须据此提示「重复次数不足，无法判断显著性」，而不是给个假结论）。
//   出现 -Infinity（空蓝回归）→ 直接判 negative，不做统计（确定性的否决比均值更有意义）。
//   所有差值完全相同且非 0 → 标准误 0 → t = ±Infinity → p = 0 → 明确的 positive/negative。
export function summarizeSamples(values) {
  const list = Array.isArray(values) ? values : [];
  const rounds = list.length;
  if (rounds === 0) {
    return { rounds: 0, mean: null, stdError: null, t: null, dof: null, pValue: null, verdict: 'unknown' };
  }
  const finite = list.filter((value) => Number.isFinite(value));
  if (finite.length !== rounds) {
    return {
      rounds,
      mean: Number.NEGATIVE_INFINITY,
      stdError: null,
      t: null,
      dof: rounds - 1,
      pValue: null,
      verdict: 'negative',
    };
  }
  const mean = finite.reduce((sum, value) => sum + value, 0) / rounds;
  if (rounds < 2) {
    return { rounds, mean, stdError: null, t: null, dof: 0, pValue: null, verdict: 'unknown' };
  }
  const variance = finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (rounds - 1);
  const stdError = Math.sqrt(Math.max(0, variance) / rounds);
  const t = stdError > 0 ? mean / stdError : mean === 0 ? 0 : Math.sign(mean) * Number.POSITIVE_INFINITY;
  const pValue = pairedPValue(t, rounds);
  const verdict =
    pValue !== null && pValue < TRIGGER_OPTIMIZER_SIGNIFICANCE_LEVEL
      ? mean > 0
        ? 'positive'
        : 'negative'
      : 'inconclusive';
  return { rounds, mean, stdError, t, dof: rounds - 1, pValue, verdict };
}

// 配对统计：候选 vs 参考的**逐轮**差（按种子下标对齐相减）。
//   前置条件：candidateMetrics.samples 与 referenceMetrics.samples 长度相同且第 i 轮
//   使用同一个种子。长度不等（例如其中一方是退化结构）→ 返回 null，UI 显示「无统计」。
//   score 的口径与主打分一致（逐轮分别套 computeObjectiveScore），因此
//   score.verdict 就是「聚合分上的提升是否显著」的答案。
export function computePairedStats(candidateMetrics, referenceMetrics, weights) {
  const candidateSamples = Array.isArray(candidateMetrics?.samples) ? candidateMetrics.samples : [];
  const referenceSamples = Array.isArray(referenceMetrics?.samples) ? referenceMetrics.samples : [];
  if (candidateSamples.length === 0 || candidateSamples.length !== referenceSamples.length) return null;

  const roundScores = candidateSamples.map((sample, index) =>
    computeObjectiveScore(sample, weights ?? TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS, referenceSamples[index]),
  );
  const metrics = {};
  for (const key of PAIRED_METRIC_KEYS) {
    metrics[key] = summarizeSamples(
      candidateSamples.map(
        (sample, index) => toFiniteNumber(sample?.[key], 0) - toFiniteNumber(referenceSamples[index]?.[key], 0),
      ),
    );
  }
  // 空蓝配对：只统计「参考不空蓝 → 候选空蓝」的回归轮数（参考自己空蓝不算退步）。
  let manaRegressions = 0;
  let manaRecoveries = 0;
  for (let index = 0; index < candidateSamples.length; index += 1) {
    const candidateOut = candidateSamples[index]?.ranOutOfMana === true;
    const referenceOut = referenceSamples[index]?.ranOutOfMana === true;
    if (candidateOut && !referenceOut) manaRegressions += 1;
    if (!candidateOut && referenceOut) manaRecoveries += 1;
  }
  return {
    rounds: candidateSamples.length,
    score: summarizeSamples(roundScores),
    metrics,
    manaRegressions,
    manaRecoveries,
  };
}

// 配对证据是否支持「采纳」（噪声地板，见文件上方 ADOPTION_NOISE_MULTIPLIER 的说明）：
//   positive          → t 检验显著，直接支持；
//   negative          → 逐轮证据一致指向更差，明确拒绝；
//   inconclusive/unknown → 只有 |mean| > MULTIPLIER × stdError 才算「比噪声大」；
//                          缺 mean/stdError（rounds<2、参考无 samples）→ 不支持。
export function hasAdoptionEvidence(paired) {
  const summary = paired?.score;
  if (!summary) return false;
  if (summary.verdict === 'negative') return false;
  if (summary.verdict === 'positive') return true;
  // 类型必须先严格判 number：rounds < 2 时 summarizeSamples 给的是 `stdError: null`，
  // 而 Number(null) === 0 → 「|mean| > 2 × 0」会恒真，噪声地板被悄悄拆掉（rounds=1 的
  // 假提升正是这么漏进来的）。缺标准误 = 无从估计噪声 → 一律不支持。
  const { mean, stdError } = summary;
  if (typeof mean !== 'number' || typeof stdError !== 'number') return false;
  if (!Number.isFinite(mean) || !Number.isFinite(stdError) || stdError < 0) return false;
  return Math.abs(mean) > TRIGGER_OPTIMIZER_ADOPTION_NOISE_MULTIPLIER * stdError;
}

// 参照分解析：门槛所需的参照分必须与候选分**同参考系**。
//   null / undefined → 参照就是「当前工作配置」，其增量分恒为 0（槽级采纳的常规入口）；
//   显式传入 → 必须是同参考系下的有限分数（精炼采纳传同槽 winner）；
//   非法（NaN / 不可解析）→ 返回 null，调用方一律不采纳（宁可不改，也不在错参考系上判）。
function resolveReferenceScore(reference) {
  if (reference === null || reference === undefined) return 0;
  const value = Number(reference?.score);
  return Number.isFinite(value) ? value : null;
}

// 采纳判据（搜索层唯一入口，避免判据散落）：
//   1. 增量分必须达到最小效应量 MIN_ADOPT_SCORE —— eps=1e-9 的旧门槛在噪声面前等于零门槛；
//   2. 必须有配对证据（hasAdoptionEvidence）：逐轮样本缺失、或均值没超过噪声地板时
//      一律不采纳。宁可保持现状，也不要把某组种子的运气写进报告（这正是「应用后与
//      预期不符」的常见来源）。
//
// ⚠️ 比较必须**同参考系**（2026-09-18 实测复盘修正，设计 §16.9）：
// 搜索层每个候选的 score 都是「以本槽开跑时的当前工作配置为参考」的增量分（与参考相同 = 0 分）。
// 旧实现把它与 `best.score`（= 上一个被采纳候选在**它自己那个参考系**里的增量分）相减，
// 跨参考系比较 ⇒ 每采纳一个槽就把其余所有槽的门槛抬高 best.score + MIN_ADOPT_SCORE，
// 越靠后的槽越难被采纳（系统性压制多槽叠加）。两处实测反例：
//   · 采纳 flame_blast-800（+0.0189）后，firestorm-800 的 +0.02474（SE 0.00097、
//     p=0.00155，全轮统计证据最强）被 0.0189+0.01 拦掉，搜索随即在「无改进」处收敛，
//     只落地较弱配置；
//   · 把 flame_blast-800 预置为基线后，同一候选立刻被采纳（门槛回到 0 + MIN_ADOPT_SCORE），
//     反证被拦掉的是真提升。
// reference 只允许传同参考系的分：槽级采纳不传（= 当前工作配置的 0 分）；精炼候选与该槽
// 其它候选共享同一个 reference，因此传同槽 winner 是合法的同参考系比较。
export function shouldAdoptCandidate(candidate, reference = null) {
  const score = Number(candidate?.score);
  if (!Number.isFinite(score)) return false;
  const referenceScore = resolveReferenceScore(reference);
  if (referenceScore === null) return false;
  if (!(score - referenceScore >= TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE)) return false;
  return hasAdoptionEvidence(candidate?.paired);
}

// 「候选分数明显更高，但配对证据不足 → 未采纳」：报告据此区分
// 「真的找不到更优配置」与「样本不足没敢采纳」（UI 文案不同，见 evidenceBlocked）。
// reference 口径与 shouldAdoptCandidate 完全一致（必须同参考系）。
export function isAdoptionBlockedByEvidence(candidate, reference = null) {
  const score = Number(candidate?.score);
  if (!Number.isFinite(score)) return false;
  const referenceScore = resolveReferenceScore(reference);
  if (referenceScore === null) return false;
  if (!(score - referenceScore >= TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE)) return false;
  return !hasAdoptionEvidence(candidate?.paired);
}

// ── 复验否决闸门（结果可应用性的唯一口径）──────────────────────────────────
// 独立复验（另一组种子 × 6 轮）判 negative = 「换一组随机流后，最优配置比基线显著更差」。
// 这样的结果**不允许被应用**：搜索期的正分只是某组种子的运气。UI（应用按钮）与 store
// （applyTriggerOptimizerResult）都用本函数，避免两处各判一次、判据漂移。
export function isTriggerOptimizerResultRejected(results) {
  return String(results?.verification?.verdict ?? '') === 'negative';
}

function percentDelta(current, baseline) {
  const left = toFiniteNumber(current, 0);
  const right = toFiniteNumber(baseline, 0);
  const denominator = Math.max(Math.abs(right), 1);
  return ((left - right) / denominator) * 100;
}

// 产出 UI 用的 delta 集合：相对基线的绝对差与百分比差。
// baseline / candidate 形如 { metrics, score, signature }（candidate 可含 distance/paired）。
export function summarizeDeltas(baseline, candidate) {
  const baseMetrics = baseline?.metrics ?? null;
  const candidateMetrics = candidate?.metrics ?? null;
  const deltas = {};
  for (const key of TRIGGER_OPTIMIZER_METRIC_KEYS) {
    const current = toFiniteNumber(candidateMetrics?.[key], 0);
    const base = toFiniteNumber(baseMetrics?.[key], 0);
    deltas[key] = {
      absolute: current - base,
      percent: percentDelta(current, base),
    };
  }
  const deathsAbsolute =
    toFiniteNumber(candidateMetrics?.deathsPerHour, 0) - toFiniteNumber(baseMetrics?.deathsPerHour, 0);
  const score = Number(candidate?.score);
  const scoreDelta = score - Number(baseline?.score ?? 0);
  return {
    score: Number.isFinite(score) ? score : -Infinity,
    scoreDelta,
    improved: Number.isFinite(scoreDelta) && scoreDelta > TRIGGER_OPTIMIZER_SCORE_EPSILON,
    metrics: candidateMetrics,
    signature: String(candidate?.signature ?? ''),
    deltas,
    deathsAbsolute,
    // 配对统计随 delta 一起上抛：UI 据此显示「提升是否显著」，而不是只给一个孤立的分数差。
    paired: candidate?.paired ?? null,
  };
}

// ── 可检测下限（2026-09-20，设计 §20.2）─────────────────────────────────────
// 把「本次设置到底能确认多大的提升」变成可展示的数字：由某个候选（通常是推荐配置）
// 的配对统计反推两个门槛：
//   噪声地板 = 2×SE       —— 采纳闸门的口径（「比噪声大」）；
//   显著门槛 = t(n−1)×SE  —— p<0.05 的口径（结论卡上那个 p 值对应的最小效应）。
// 两者都随轮数收敛，但方式不同：地板 ∝ 1/√n，显著门槛还要再乘 t(n−1)——低轮数下后者
// 退化得极快（实测丛林 tier0：24h × 2 轮的显著门槛 ≈9.2% 利润，× 5 轮降到 ≈1.2%）。
// 这正是「搜不出提升」的定量解释，也是档位轮数口径（TRIGGER_OPTIMIZER_PRESETS）的依据。
//
// 利润换算（profitPercent）：分数是加权对数尺度（score = Σ w_m · log2(1 + 相对变化)），
// 因此「这段分数全部由利润项贡献」时对应 2^(v / w_profit) − 1 —— 混合指标下只作量级参考。
export function resolveTriggerOptimizerDetectionFloor(paired, weights, options = {}) {
  const summary = paired?.score ?? null;
  // 轮数优先取调用方给的（本次运行的 settings.rounds），无效时回落到配对统计自带的轮数。
  const explicit = Math.floor(Number(options?.rounds ?? 0));
  const rounds = explicit >= 2 ? explicit : Math.floor(Number(summary?.rounds ?? 0));
  const stdError = Number(summary?.stdError);
  if (!(rounds >= 2) || !Number.isFinite(stdError) || !(stdError > 0)) return null;
  const weightProfit = resolveProfitScoreWeight(weights);
  const noiseFloor = TRIGGER_OPTIMIZER_ADOPTION_NOISE_MULTIPLIER * stdError;
  return {
    rounds,
    stdError,
    noiseFloor,
    significanceFloor: tCritical(rounds) * stdError,
    weightProfit,
    profitPercent: weightProfit > 0 ? (Math.pow(2, noiseFloor / weightProfit) - 1) * 100 : null,
  };
}

// 提高到 targetRounds 轮后的下限（同一 σ 估计的纯缩放：SE ∝ 1/√n，显著门槛再乘
// t(n−1)）。用途：结论卡上给一条可执行的下一步（「提到 10 轮 → 下限降到 ≈X%」）。
export function projectTriggerOptimizerDetectionFloor(floor, targetRounds) {
  const target = Math.floor(Number(targetRounds));
  if (!floor || !(target >= 2) || target <= Number(floor.rounds)) return null;
  const scale = Math.sqrt(Number(floor.rounds) / target);
  const weightProfit = Number(floor.weightProfit) || 0;
  const noiseFloor = Number(floor.noiseFloor) * scale;
  return {
    rounds: target,
    noiseFloor,
    significanceFloor: tCritical(target) * Number(floor.stdError) * scale,
    profitPercent: weightProfit > 0 ? (Math.pow(2, noiseFloor / weightProfit) - 1) * 100 : null,
  };
}

// 反解：让给定效应量（分数）**过采纳闸门**至少要多少轮（2026-09-25，设计 §45）。
// 口径与 projectTriggerOptimizerDetectionFloor 同源（同一 σ 估计 + 同一 ∝1/√n 缩放）：
//   采纳闸门要求「|mean| > NOISE_MULTIPLIER × SE」，而第 n 轮的 SE = σ/√n、σ = SE(当前轮) × √轮数
//   ⇒ 要让目标效应过闸，需 2σ/√n ≤ effect ⇔ n ≥ 轮数 × (2 × SE / effect)²。
//   这里取满足该式的**最小整数轮数**（向上取整：不给一个差一点点的建议）。
//   ⚠️ n 与「当前 SE 的平方」成反比：漏掉 √轮数 这一项会把所需轮数算小一个量级（实现时踩过）。
//   口径归属（2026-09-26，设计 §52）：本函数走**采纳口径**（噪声地板 2×SE：比噪声大、不是显著性
//   声明）；「判成 p<0.05 明确结论要多少轮」是另一把尺子 —— 见 resolveTriggerOptimizerRoundsForSignificance。
// 三种结果（调用方据此改口，而不是一律说「提到上限」）：
//   satisfied=true —— 当前轮数的下限已 ≤ 目标（无需改轮数）；
//   capped=false    —— 提到 rounds 轮即可；
//   capped=true     —— 连上限都不够（rounds 钳到上限，noiseFloor 仍 > 目标）⇒ 文案必须说
//                      「这个量级在当前设置下确认不了」，而不是给一个做不到的下一步。
// 非法输入（缺 σ / 轮数 < 2 / effect 非有限正数）一律 null：宁可不出这一行，也不编一个假建议。
export function resolveTriggerOptimizerRoundsForEffect(floor, effect, maxRounds) {
  if (!floor) return null;
  const stdError = Number(floor.stdError);
  const rounds = Math.floor(Number(floor.rounds));
  const target = Number(effect);
  if (!(rounds >= 2) || !Number.isFinite(stdError) || !(stdError > 0)) return null;
  if (!Number.isFinite(target) || !(target > 0)) return null;
  const weightProfit = Number(floor.weightProfit) || 0;
  const describe = (value, source) => ({
    rounds: value,
    noiseFloor: Number(source?.noiseFloor ?? floor.noiseFloor),
    significanceFloor: Number(source?.significanceFloor ?? floor.significanceFloor),
    profitPercent: source?.profitPercent ?? floor.profitPercent,
  });
  const base = {
    satisfied: false,
    capped: false,
    effect: target,
    effectProfitPercent: weightProfit > 0 ? (Math.pow(2, target / weightProfit) - 1) * 100 : null,
  };
  if (target >= Number(floor.noiseFloor)) return { ...base, ...describe(rounds, floor), satisfied: true };
  const required = Math.ceil(rounds * ((TRIGGER_OPTIMIZER_ADOPTION_NOISE_MULTIPLIER * stdError) / target) ** 2 - 1e-9);
  const cap = Math.floor(Number(maxRounds));
  const limit = Number.isFinite(cap) && cap >= 2 ? Math.max(cap, rounds) : rounds;
  const capped = required > limit;
  // 防御：任何情况下都不给「比现在更少轮数」的建议。
  const chosen = capped ? limit : Math.max(required, rounds + 1);
  const projected = chosen > rounds ? projectTriggerOptimizerDetectionFloor(floor, chosen) : null;
  return { ...base, ...describe(chosen, projected), capped };
}

// 反解：把给定效应量（分数）判成 **p<0.05 的明确结论** 至少要多少轮（2026-09-26，设计 §52）。
// 与上面的 resolveTriggerOptimizerRoundsForEffect 是**同一形状的两把尺子**（同一 σ 估计 + 同一
// ∝1/√n 缩放），区别只在判据：
//   采纳口径（上面那个）：噪声地板 2×SE —— 「比噪声大」，采纳闸门用；**不是**显著性声明；
//   判定口径（本函数）：显著门槛 t(n−1)×SE —— 与逐轮 verdict / §47 / §49 同一把尺子。
// ⚠️ n ≤ 61 时 t(n−1) > 2 ⇒ 两把尺子在全部可达轮数内（搜索 ≤10 / 复核 ≤12 / 复验 ≤24）不可能
// 给出同一个答案：过噪声地板只说明「可被采纳」，要判成明确结论必须按本函数（或复验）补样本。
// 显著性条件：effect > t(n−1) × SE(n)，SE(n) = SE(当前轮) × √(当前轮 / n)；取满足该式的
// **最小整数 n**（门槛随 n 单调下降 ⇒ 从当前轮数向上扫到的第一个解就是最小解）。
// 返回 { satisfied, capped, rounds, effect }：
//   satisfied=true —— 当前轮数下已够判成明确结论（rounds = 当前轮数，无需再提）；
//   capped=true    —— 上限以内无解（rounds = 上限）：调用方不要给做不到的下一步；
//   其余           —— 提到 rounds 轮即可（rounds > 当前轮数）。
// 非法输入（缺 σ / 轮数 < 2 / effect 非有限正数）一律 null：宁可不出这一行，也不编一个假建议。
export function resolveTriggerOptimizerRoundsForSignificance(floor, effect, maxRounds) {
  const stdError = Number(floor?.stdError);
  const rounds = Math.floor(Number(floor?.rounds));
  const target = Number(effect);
  if (!(rounds >= 2) || !Number.isFinite(stdError) || !(stdError > 0)) return null;
  if (!Number.isFinite(target) || !(target > 0)) return null;
  const base = { satisfied: false, capped: false, effect: target };
  if (tCritical(rounds) * stdError < target) return { ...base, satisfied: true, rounds };
  const cap = Math.floor(Number(maxRounds));
  const limit = Number.isFinite(cap) && cap >= 2 ? Math.max(cap, rounds) : rounds;
  for (let n = rounds + 1; n <= limit; n += 1) {
    if (tCritical(n) * stdError * Math.sqrt(rounds / n) < target) return { ...base, rounds: n };
  }
  return { ...base, capped: true, rounds: limit };
}

// 反解：把**已经观测到的效应量**判成明确结论（positive / negative）至少需要多少轮
// （2026-09-25，设计 §47）。与 §45 的反解同源（同一 σ ∝ 1/√n 缩放），但目标不同：
//   §45 问「多大的效应能被采纳闸门看见」——口径 2×SE（噪声地板）；
//   本函数问「这批样本要多大才能给出 p<0.05 的明确结论」——口径 t(n−1)×SE（与结论卡同一把尺子）。
// 显著性条件：|mean| > t(n−1) × SE(n)，而 SE(n) = SE(当前轮) × √(当前轮 / n)
//   ⇒ 取满足该式的**最小整数 n**（不给差一点点的方案）。
// 返回 { decisive, extend, capped, currentRounds, capRounds, requiredRounds, targetRounds, mean, stdError }：
//   decisive    —— 已经是 positive/negative，无需追加；
//   extend      —— 追加到 targetRounds（= requiredRounds ≤ 上限）即可判成明确结论；
//   capped      —— 连上限都不够（requiredRounds = null、targetRounds = 上限）：调用方**不要**白花
//                  样本，把所需轮数如实上屏（与 §45 的 capped 分支同一处置原则）；
//   capRounds   —— **上限本身**（≥ currentRounds；调用方没给合法上限时退化成 currentRounds =
//                  无从追加）。要拿「上限」时必须读这个字段：它只在 capped 时恰好等于 targetRounds，
//                  非 capped 时 targetRounds 是「反解所需轮数」—— 张冠李戴会让保底轮数与成本护栏的
//                  对比基准一起错位（见 planTriggerOptimizerVerificationAppend 的说明）。
// 非法输入（缺 mean / 标准误为负或非有限、轮数 < 2）一律 null：宁可不出方案，也不编一个假的。
// 零差是**合法退化**、不是非法输入（2026-09-26，设计 §50 B-1）：stdError = 0（逐轮差恒 0）时同轮数
// 下标准误永远是 0，t×SE 恒为 0 ⇒ 再加多少轮都判不出，这正是 capped 的定义。旧实现把它当非法输入
// 返回 null，调用方于是回落「每次 +6 轮」兜底 —— 这条路径不受 24 轮上限约束（零差样本永远
// inconclusive、按钮一直在），可以无限追加；实测（§50 装置）零差案例在现状下平均烧 36 场买 0 次
// 判出。现在与其它 capped 同出口：补到上限、再由成本护栏钳住累计总额。
export function resolveTriggerOptimizerVerificationRounds(summary, maxRounds) {
  const rounds = Math.floor(Number(summary?.rounds));
  const mean = Number(summary?.mean);
  const stdError = Number(summary?.stdError);
  if (!(rounds >= 2) || !Number.isFinite(mean) || !Number.isFinite(stdError) || stdError < 0) return null;
  const cap = Math.floor(Number(maxRounds));
  const capRounds = Number.isFinite(cap) && cap >= 2 ? Math.max(cap, rounds) : rounds;
  const base = { currentRounds: rounds, capRounds, mean, stdError, requiredRounds: rounds, targetRounds: rounds };
  const verdict = String(summary?.verdict ?? '');
  if (verdict === 'positive' || verdict === 'negative') {
    return { ...base, decisive: true, extend: false, capped: false };
  }
  // 零差（B-1）：恒判不出 ⇒ capped（requiredRounds = null、目标 = 上限），见上方注释。
  if (stdError === 0) {
    return { ...base, decisive: false, extend: false, capped: true, requiredRounds: null, targetRounds: capRounds };
  }
  const effect = Math.abs(mean);
  let required = null;
  if (effect > 0) {
    for (let n = rounds + 1; n <= capRounds; n += 1) {
      if (tCritical(n) * stdError * Math.sqrt(rounds / n) < effect) {
        required = n;
        break;
      }
    }
  }
  if (required === null) {
    return { ...base, decisive: false, extend: false, capped: true, requiredRounds: null, targetRounds: capRounds };
  }
  return { ...base, decisive: false, extend: true, capped: false, requiredRounds: required, targetRounds: required };
}

// 追加复验的**执行计划**（2026-09-25，设计 §47；累计护栏 2026-09-26，设计 §50 B-2）：把上面的反解
// 按实测胜出的 A′ 口径折成「这一次到底追加多少轮」，并把成本护栏一并吃掉。store（真的去跑）与页面
//（上屏说将要跑多少）共用这一份计划 ——「文案说的轮数」与「实际追加的轮数」因此不可能分裂成两套口径。
//   A′ 口径（设计 §47 实测：5/5 槽解析率 ≥ 现状 12 轮、假阳性不升）：目标总轮数 = clamp(n*, 保底, 上限)
//     · n* = 反解所需轮数（口径 |mean| > t(n−1) × SE，见上）；
//     · 保底 = 2 × TRIGGER_OPTIMIZER_VERIFY_ROUNDS（= 现状口径 12 轮：自适应绝不比今天少花样本）；
//     · capped（上限也不够 / 零差）→ 目标就是上限：反解已经说「再多也判不出来」，实测的处置是补到上限。
//       ⚠️ 别改成 A 臂的「capped 就不花样本」—— 那一臂在本轮对照里 5/5 槽解析率都低于现状，未采用。
//   成本护栏（判据③；两级，2026-09-26 设计 §50 B-2 升级）：
//     · 单次：本次追加场次 2 × plannedRounds ≤ 整轮 × 20%（§47 口径不变）；
//     · 累计：**累计已花（options.spentSimulations）+ 本次 ≤ 整轮 × 40%**（§50 实测胜出：累计 20%
//       收太紧、合计解析率 −11~13pp；40% 的合计解析率与现状持平且成本低 11%）。
//     咬住时把轮数往下钳（宁可结论仍是 inconclusive，也不超预算），limitedBy 记下最终瓶颈是谁
//     （'single' / 'cumulative'）；拿不到整轮场次（老报告）= 不限：如实返回 null，不假装有护栏。
// 返回 { decisive, capped, budgetLimited, limitedBy, currentRounds, requiredRounds, capRounds,
//        targetRounds, plannedRounds, plannedSimulations, budgetSimulations,
//        cumulativeBudgetSimulations, spentSimulations }。
// 退化输入（反解为 null）→ 同样返回 null：调用方保持今天的固定 6 轮，不编一份计划。
export function planTriggerOptimizerVerificationAppend(summary, options = {}) {
  const plan = resolveTriggerOptimizerVerificationRounds(summary, options?.maxRounds);
  if (!plan) return null;
  // 上限直接取反解给的 capRounds（= 调用方上限与当前轮数的较大者）——**不要**用 targetRounds 顶替：
  // 两者只在 capped 时相等，非 capped 时 targetRounds 是「反解所需轮数」，拿它当上限会让下面的
  // minRounds 被压到反解值以下（保底 12 轮失效：反解说 9 轮就够时只补 3 轮，比今天的 12 轮口径
  // 还少），上屏的「上限 N 轮」也会跟着错。
  const capRounds = plan.capRounds;
  const minOption = Math.floor(Number(options?.minRounds));
  const minRounds = Math.min(
    capRounds,
    Math.max(plan.currentRounds, Number.isFinite(minOption) ? minOption : TRIGGER_OPTIMIZER_VERIFY_ROUNDS * 2),
  );
  const targetRounds = plan.decisive
    ? plan.currentRounds
    : plan.capped
      ? capRounds
      : Math.min(capRounds, Math.max(plan.requiredRounds, minRounds));
  let plannedRounds = Math.max(0, targetRounds - plan.currentRounds);
  const wholeRun = Number(options?.wholeRunSimulations);
  const hasWholeRun = Number.isFinite(wholeRun) && wholeRun > 0;
  const budgetSimulations = hasWholeRun ? Math.floor(wholeRun * TRIGGER_OPTIMIZER_VERIFY_APPEND_BUDGET_RATIO) : null;
  const cumulativeBudgetSimulations = hasWholeRun
    ? Math.floor(wholeRun * TRIGGER_OPTIMIZER_VERIFY_APPEND_CUMULATIVE_BUDGET_RATIO)
    : null;
  const spentOption = Number(options?.spentSimulations);
  const spentSimulations = Number.isFinite(spentOption) && spentOption > 0 ? Math.floor(spentOption) : 0;
  let budgetLimited = false;
  let limitedBy = null;
  if (plannedRounds > 0) {
    if (budgetSimulations !== null) {
      const allowedRounds = Math.floor(budgetSimulations / 2);
      if (plannedRounds > allowedRounds) {
        plannedRounds = Math.max(0, allowedRounds);
        budgetLimited = true;
        limitedBy = 'single';
      }
    }
    if (cumulativeBudgetSimulations !== null) {
      const allowedRounds = Math.floor(Math.max(0, cumulativeBudgetSimulations - spentSimulations) / 2);
      if (plannedRounds > allowedRounds) {
        plannedRounds = Math.max(0, allowedRounds);
        budgetLimited = true;
        limitedBy = 'cumulative';
      }
    }
  }
  return {
    decisive: plan.decisive,
    capped: plan.capped,
    budgetLimited,
    limitedBy,
    currentRounds: plan.currentRounds,
    requiredRounds: plan.requiredRounds,
    capRounds,
    targetRounds: plan.currentRounds + plannedRounds,
    plannedRounds,
    plannedSimulations: plannedRounds * 2,
    budgetSimulations,
    cumulativeBudgetSimulations,
    spentSimulations,
  };
}

// 复核轮数的反解（2026-09-25，设计 §49）：拿报告里已有的效应量证据（独立复验的配对统计），
// 反解「换到相邻难度重测时，至少要跑多少轮才能把同量级的效应判成明确结论」。
// 与 §47 的 resolveTriggerOptimizerVerificationRounds 同源（同一把 t×SE 尺子、同一 σ ∝ 1/√n
// 缩放），但**语义不同**：那个函数回答「在已有样本上还要**追加**多少」（已判明确就不追加）；
// 本函数回答「新现场**从零**要跑多少轮」—— 先验是不是已判明确都要给出一个轮数，因为复核
// 一定要换难度重测（这正是它要回答的问题）。先验跨难度的外推是本口径的诚实边界（设计 §49）：
// 反解说 9 轮，不等于「9 轮在新难度一定够」（两难度的噪声尺度可能不同，区域间实测差过 20 倍）。
// 返回 { currentRounds, capRounds, mean, stdError, requiredRounds, capped }：
//   requiredRounds —— 最小充分轮数（≥ 2）；反解在 cap 内无解时 capped = true、requiredRounds = null
//   （调用方补到上限，与 §47 的 A′ 口径同款处置）。
// 非法输入（缺 mean / 标准误非正、轮数 < 2）一律 null：宁可不出方案，也不编一个假的。
export function resolveTriggerOptimizerRobustnessRounds(summary, maxRounds) {
  const rounds = Math.floor(Number(summary?.rounds));
  const mean = Number(summary?.mean);
  const stdError = Number(summary?.stdError);
  if (!(rounds >= 2) || !Number.isFinite(mean) || !Number.isFinite(stdError) || !(stdError > 0)) return null;
  const cap = Math.floor(Number(maxRounds));
  const capRounds = Number.isFinite(cap) && cap >= 2 ? cap : rounds;
  const effect = Math.abs(mean);
  let requiredRounds = null;
  if (effect > 0) {
    for (let n = 2; n <= capRounds; n += 1) {
      if (tCritical(n) * stdError * Math.sqrt(rounds / n) < effect) {
        requiredRounds = n;
        break;
      }
    }
  }
  return { currentRounds: rounds, capRounds, mean, stdError, requiredRounds, capped: requiredRounds === null };
}

// 复核的**执行计划**（2026-09-25，设计 §49）：把上面的反解按实测口径折成「这一次复核到底
// 跑多少轮」，并把成本护栏一并吃掉。store（真的去跑）与页面（上屏说将要跑多少）共用这一份
// 计划 ——「文案说的轮数」与「实际执行的轮数」因此不可能分裂成两套口径。
//   A′ 口径（设计 §49）：
//     · 保底 = min(上限, max(现状 6 轮, 先验轮数)) —— 自适应绝不比今天少花样本；
//     · capped（上限也不够）→ 目标就是上限：补到上限（§47 的 A′ 教训）；
//     · 否则目标 = clamp(n*, 保底, 上限)。
//   成本护栏（复用 §47 的 20% 比例，单一事实源）：复核**相对现状多花的**场次
//   2 × (plannedRounds − 保底) ≤ 整轮场次 × 20%；咬住时把轮数往下钳，但**不低于保底**
//   （复核是用户主动点的检查，护栏限制的只是「多花多少」，不像 §47 允许把追加钳到零）。
//   拿不到整轮场次（旧报告）= 不限：如实返回 budgetSimulations = null，不假装有护栏。
// 返回 { capped, budgetLimited, currentRounds, requiredRounds, capRounds, plannedRounds,
//        plannedSimulations, budgetSimulations }（requiredRounds 在 capped 时为 null）。
// 退化输入（反解为 null）→ null：调用方保持今天的固定 6 轮，不编一份计划。
export function planTriggerOptimizerRobustnessRounds(summary, options = {}) {
  const plan = resolveTriggerOptimizerRobustnessRounds(summary, options?.maxRounds);
  if (!plan) return null;
  const floorRounds = Math.min(plan.capRounds, Math.max(TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS, plan.currentRounds));
  const targetRounds = plan.capped
    ? plan.capRounds
    : Math.min(plan.capRounds, Math.max(plan.requiredRounds, floorRounds));
  let plannedRounds = targetRounds;
  const wholeRun = Number(options?.wholeRunSimulations);
  const budgetSimulations =
    Number.isFinite(wholeRun) && wholeRun > 0
      ? Math.floor(wholeRun * TRIGGER_OPTIMIZER_VERIFY_APPEND_BUDGET_RATIO)
      : null;
  let budgetLimited = false;
  if (budgetSimulations !== null && plannedRounds > floorRounds) {
    const allowedRounds = floorRounds + Math.floor(budgetSimulations / 2);
    if (plannedRounds > allowedRounds) {
      plannedRounds = allowedRounds;
      budgetLimited = true;
    }
  }
  return {
    capped: plan.capped,
    budgetLimited,
    currentRounds: plan.currentRounds,
    requiredRounds: plan.requiredRounds,
    capRounds: plan.capRounds,
    plannedRounds,
    plannedSimulations: plannedRounds * 2,
    budgetSimulations,
  };
}

// 复核**追加**的执行计划（2026-09-26，设计 §51 B-2）：复跑不再重算同一批种子（恒等白烧），而是
// 换盐追加新样本、与首跑样本合并重检。口径（装置实测胜出，§51）：
//   · 目标 = **补到复核上限**（TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS）：实测「首跑未达显著 →
//     明确」= 97.6%（按需补 n* 的臂只有 89.4%，差 8.2pp ⇒ 不采用按需）；总轮数不越上限 ⇒
//     复核成本上界 = 2 × 上限（2026-09-27 上限 12 → 16 后为 ≤ 2 × 16 = 32 场），只是把「白烧」
//     换成真样本。
//   · 零差出口（§51 Q2 实测）：目标难度的当前统计 stdError = 0（逐轮差恒 0）⇒ 同轮数下 SE 恒为 0、
//     任何追加都判不出（实测零差案例 6 轮 / 12 轮判出次数均为 0）⇒ plannedRounds = 0 且
//     zeroDiff = true：调用方明示出口，不花样本。
//   · 已达上限 ⇒ plannedRounds = 0 且 atCap = true（再加也不越上限：复核上限是**总量**上限）。
//   · 两级护栏（与追加复验共用同一组比例常量，单一事实源）：本次追加场次 2 × plannedRounds ≤
//     整轮 × 20%；（累计已花 + 本次）≤ 整轮 × 40%。咬住时往下钳（宁可结论仍不明确，也不超预算），
//     limitedBy 记下最终瓶颈（'single' / 'cumulative'）。拿不到整轮场次（旧报告）= 不限：如实返回
//     budgetSimulations = null，不假装有护栏。
// 返回 { zeroDiff, atCap, capped, budgetLimited, limitedBy, currentRounds, capRounds, requiredRounds,
//        plannedRounds, plannedSimulations, budgetSimulations, cumulativeBudgetSimulations,
//        spentSimulations }（capped = true：本计划的目标就是上限，与 §49 的 capped 语义同款；
//        requiredRounds 恒为 null —— 复核追加不做反解，目标就是上限）。
// 退化输入（缺 rounds / 轮数 < 2）→ null：调用方不追加，也不编一份计划。
export function planTriggerOptimizerRobustnessAppend(summary, options = {}) {
  const currentRounds = Math.floor(Number(summary?.rounds));
  if (!(currentRounds >= 2)) return null;
  const capOption = Math.floor(Number(options?.maxRounds));
  const capRounds = Number.isFinite(capOption) && capOption >= 2 ? Math.max(capOption, currentRounds) : currentRounds;
  const stdError = Number(summary?.stdError);
  const zeroDiff = Number.isFinite(stdError) && stdError === 0;
  const atCap = currentRounds >= capRounds;
  let plannedRounds = zeroDiff || atCap ? 0 : capRounds - currentRounds;
  const wholeRun = Number(options?.wholeRunSimulations);
  const hasWholeRun = Number.isFinite(wholeRun) && wholeRun > 0;
  const budgetSimulations = hasWholeRun ? Math.floor(wholeRun * TRIGGER_OPTIMIZER_VERIFY_APPEND_BUDGET_RATIO) : null;
  const cumulativeBudgetSimulations = hasWholeRun
    ? Math.floor(wholeRun * TRIGGER_OPTIMIZER_VERIFY_APPEND_CUMULATIVE_BUDGET_RATIO)
    : null;
  const spentOption = Number(options?.spentSimulations);
  const spentSimulations = Number.isFinite(spentOption) && spentOption > 0 ? Math.floor(spentOption) : 0;
  let budgetLimited = false;
  let limitedBy = null;
  if (plannedRounds > 0) {
    if (budgetSimulations !== null) {
      const allowedRounds = Math.floor(budgetSimulations / 2);
      if (plannedRounds > allowedRounds) {
        plannedRounds = Math.max(0, allowedRounds);
        budgetLimited = true;
        limitedBy = 'single';
      }
    }
    if (cumulativeBudgetSimulations !== null) {
      const allowedRounds = Math.floor(Math.max(0, cumulativeBudgetSimulations - spentSimulations) / 2);
      if (plannedRounds > allowedRounds) {
        plannedRounds = Math.max(0, allowedRounds);
        budgetLimited = true;
        limitedBy = 'cumulative';
      }
    }
  }
  return {
    zeroDiff,
    atCap,
    capped: true,
    budgetLimited,
    limitedBy,
    currentRounds,
    requiredRounds: null,
    capRounds,
    plannedRounds,
    plannedSimulations: plannedRounds * 2,
    budgetSimulations,
    cumulativeBudgetSimulations,
    spentSimulations,
  };
}

// 双侧 95% 的 t 临界值（自由度 = 轮数 − 1）；jstat 给出异常值时回落到正态近似 1.96。
function tCritical(rounds) {
  const dof = Number(rounds) - 1;
  if (!(dof >= 1)) return 1.96;
  const value = jStat.studentt.inv(0.975, dof);
  return Number.isFinite(value) && value > 0 ? value : 1.96;
}

// 利润项在复合分里的权重（用于把分数门槛换算成「利润百分比」）；缺失/非正 → 0
// （调用方据此把 profitPercent 置空，而不是除零造出一个假数字）。
function resolveProfitScoreWeight(weights) {
  const subweights = weights?.byMetric
    ? weights
    : resolveQueuePerformanceSubweights(weights, TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS);
  const value = Number(subweights?.byMetric?.dailyNoRngProfit);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

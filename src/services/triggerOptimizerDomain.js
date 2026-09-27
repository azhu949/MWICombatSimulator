// 技能触发器优化器 —— 领域层（纯函数 + 常量 + 状态工厂）。
//
// 本模块是「候选生成 + 打分」链路的唯一口径来源：设置归一化/校验、输入快照、
// 输入指纹（报告过期判定）、候选签名、目标函数（对数归一化 + 死亡惩罚）。
// 依赖只来自 shared/、services/（utils/triggerMapper/queuePerformanceWeights），
// 不引入 worker / store / vue，保持可离线单测。
//
// 语义依据见 docs/trigger-optimizer-design.md：
// - triggerMap[hrid] = [] 是「冷却好了立即释放」，不是禁用（§1.1）。
// - 「保持默认」= 删键（applyTriggerStateToTriggerMap 的 default 分支）。
// - 数值类触发器 value 是绝对值（current_hp/missing_hp/current_mp/missing_mp）。
// - 死亡增加被惩罚、减少被奖励（对称，见 computeDeathReductionCredit）；空蓝直接判负。
//   引擎里死亡有真实成本（复活停摆 + 清增益），dps/xp 已部分反映，死亡项是偏好性
//   加权：让「利润相当但更安全」的候选能胜出，而不是把死亡折算成全额利润。

import { resolveQueuePerformanceSubweights } from '../shared/queuePerformanceWeights.js';
import { clamp, deepClone, isPlainObject, toFiniteNumber } from './utils.js';
import { sanitizeTriggerList } from './triggerMapper.js';
import { deriveSeedSet, hashSeed } from './seededRandom.js';
import { COMBAT_PLAYER_KEYS } from './foodOptimizerSnapshot.js';

// 重复次数：每次候选评估跑几场独立抽样后聚合（设计 §5.3）。
// 默认 5（2026-09-20 从 2 提升，依据 §20 的功效实测）：采纳闸门的地板（|mean| > 2×SE
// 的临界值）≈ 2σ(T)/√n，而实测 σ(T)·√T ≈ 常数 ⇒ 地板只由**总模拟小时数** W = n·T 决定
// （与「时长怎么切分」无关）；但「p < 0.05」的显著门槛还要乘 t(n−1)：
//   n=2 → t = 12.7（24h 下要 ≈9.2% 利润才显著，搜索期 verdict 几乎恒 inconclusive）、
//   n=5 → t = 2.78（≈1.2%）、n=6 → t = 2.57（≈1.0%）。
// ⚠️ 不要在长时长上退回 2 轮：2 轮不是「便宜」，是「dof=1 的检验没有功效」。实测自助
// （190~15504 个种子子集）：同一份真提升 +1.9% 利润，n=2 有 6.8% 的子集报「证据不足」、
// n=5 降到 0；n=2 的 top-1 命中率 84%，n=5 是 97%（详见 docs §20）。
// 上限 12（2026-09-27 从 10 提升，依据设计 §60.5 的 C1-② 实测）：队伍载荷下「重复次数」是把
// 判据链真检出率拉回默认水平的唯一旋钮 —— 5 轮 64.6% / 8 轮 77.6% / 10 轮 83.0% / 12 轮 86.2%
// （判据线 = 单人 5 轮 93.2% − 10pp = 83.2%；8 轮不达标、10 轮实质平齐 −0.2pp、12 轮达标）。
// 只放宽**上限**（让用户够得着提示里的建议），不提升任何档位的默认轮数（档位 = 默认成本，
// 另行拍板）。
export const TRIGGER_OPTIMIZER_DEFAULT_ROUNDS = 5;
export const TRIGGER_OPTIMIZER_MIN_ROUNDS = 1;
export const TRIGGER_OPTIMIZER_MAX_ROUNDS = 12;

// 「可用的最少抽样轮数」= 2：配对统计要估标准误至少要两个样本，而采纳闸门
// （triggerOptimizerScoring.hasAdoptionEvidence）要求配对证据超过噪声地板。
// rounds = 1 时 verdict 恒为 unknown → 任何候选都无法被采纳 → 该档位只是烧机器，
// 报出来的「提升」全是噪声（实测：rounds=1 曾把 +49% 利润的噪声报成提升）。
// 因此下限保留 1（用户显式手填时不被静默改写），但预设档位不会给出 1。
export const TRIGGER_OPTIMIZER_MIN_USABLE_ROUNDS = 2;

// coordinate descent 的搜索轮次上限（每个 pass 扫一遍全部技能槽）。
// 设计文档 §7.2 使用的字段名是 maxPasses；本模块以 maxRounds 为规范键并接受
// maxPasses 作为持久化别名（两种拼写在 normalizeTriggerOptimizerSettings 里归一）。
export const TRIGGER_OPTIMIZER_DEFAULT_MAX_ROUNDS = 2;
export const TRIGGER_OPTIMIZER_MIN_MAX_ROUNDS = 1;
export const TRIGGER_OPTIMIZER_MAX_MAX_ROUNDS = 5;

// 每技能候选上限（含「默认」「当前」「立即释放」锚点与合取组合候选）。
// 默认 10（2026-09-17 从 8 提升）：本轮新增了 ≤3 条组合候选，8 个名额会被
// 「2 个锚点 + 单条件候选」占满，组合候选一条都进不来（它们永远排在末尾）。
// 10 = 2 锚点 + 5 单条件 + 3 组合，正好装下最常见的角色网格。
export const TRIGGER_OPTIMIZER_DEFAULT_CANDIDATE_LIMIT = 10;
export const TRIGGER_OPTIMIZER_MIN_CANDIDATE_LIMIT = 2;
//
// 上限 20（2026-09-20 从 16 提升，设计 §22.3）：输出角色的完整网格在「波内进度」候选
// （number_of_dead_units）加入后是 19 条 —— 2 锚点 + 13 单条件 + 4 组合。16 会在精细档
// **刚好**把尾部 3 条（蓝量台阶 enoughMp、自身残血 lowHp ×2）挤掉：候选表不是「加和」
// 而是「替换」，等于用未验证的新方向换掉既有方向。20 让精细档重新装下完整网格，
// 新族变成净增量。上限只是**预算钳制**，不会强行生成候选 —— 快速档 6 / 标准档 10 的
// 候选表与改动前逐条相同（实测，§22.3）。代价只在精细档：输出角色的候选从 16 → 19，
// 上界估算场次 +25%（实际只涨输出槽那 3 条）。
export const TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT = 20;

// 复验用的抽样轮数：**与 settings.rounds 解耦**，固定 6。
// 理由：搜索期需要对「每个候选 × 每轮」都跑模拟，成本随轮数线性放大，所以搜索轮数
// 由档位按时长配置（2026-09-20 起 5~10 轮，见 TRIGGER_OPTIMIZER_PRESETS）；而复验只对
// 「基线 vs 最优」两个配置跑，6 轮只要 12 场模拟，换来自由度 5 的 t 检验（t ≥ 2.57 即
// p < 0.05）—— 统计功效花在最终结论上最划算。
export const TRIGGER_OPTIMIZER_VERIFY_ROUNDS = 6;
// 复验轮数的**上限**（2026-09-25，设计 §47）：自适应的追加不允许超过它。上限的作用不是「再多
// 采一点」，而是给「反解说需要几百轮」这类情形一个**明确出口**：不花样本、如实上屏，
// 而不是无限加码（复验的 2 次评估会随轮数线性变贵）。
export const TRIGGER_OPTIMIZER_VERIFY_MAX_ROUNDS = 24;
// 追加复验的**成本护栏**（2026-09-25，设计 §47 判据③）：一次追加最多花掉「整轮运行」估算的
// 20%。依据是实测量级：A′ 口径在熊熊 T0 是 +14.4 场/槽，而快档整轮只跑 ~74 场 ——
// 没有护栏时「补到 24 轮」相当于整轮的 48%，对快档是数量级错误。预算由调用方拿报告里的整轮
// 场次（results.simulations）现算，本常量只定义比例（唯一事实源）。
export const TRIGGER_OPTIMIZER_VERIFY_APPEND_BUDGET_RATIO = 0.2;
// 追加复验的**累计**成本护栏（2026-09-26，设计 §50 B-2）：所有追加合计 ≤ 整轮运行估算的 40%。
// 实测依据（§50 装置：4h / 32 种子 / 500 试验；策略 = 一路未达显著就点到停）：单次护栏之外，
// 现状的累计成本没有显式上限（只有 24 轮上限推出的隐式 36 场 = 快档 74 场的 49%），且零差路径
// （stdError = 0）连这个隐式上限都绕开、可以无限追加。实测对照：累计 20% 收得太紧（合计解析率
// −11~13pp，全是 null 桶的负向判出让位给 inconclusive）；40% 的合计解析率与现状持平
//（−0.2~0.0pp）而成本反而低 11%（零差案例 36 → 28 场、重尾提前停），假阳性不升 ⇒ 取 40%。
// 预算拿报告里的整轮场次（results.simulations）现算；累计已花由调用方按 attempts 求和。
export const TRIGGER_OPTIMIZER_VERIFY_APPEND_CUMULATIVE_BUDGET_RATIO = 0.4;

// 「深挖」加密复核的轮数（2026-09-19 新增 §18.1；2026-09-20 改为独立种子，设计 §21）：
// 搜索期某个槽的最优候选分数够了、但配对证据没过噪声地板时，用**独立的深挖种子盐**
// 把该候选与参考各重跑 TRIGGER_OPTIMIZER_DEEP_DIVE_ROUNDS 轮**全新样本**再判一次
// （成本 = 2 次评估 × 6 场 = 12 场，只在被拦时触发、每槽最多一次）。
//
// ⚠️ 为什么必须是独立种子（2026-09-20 修正）：旧实现复用同一盐的搜索种子集 ——
// deriveSeedSet 是稳定前缀，所以那 6 轮的前 N 个种子与搜索期完全相同，等于把
// **参与了「谁被复核」决策的那批数据**接着当判据用，属于可选停时，p 值偏乐观。
// 换成独立盐 = 样本分割（筛选看在 A 组上、判据只看 B 组）：B 组与「谁被复核」这个
// 事件无关 ⇒ 这次 t 检验的 p 值有效；代价是放弃复用搜索期样本，但两侧本来都要重测，
// 单次深挖的成本不变。
//
// 搜索轮数已经 ≥ 6 时（用户手填的更大值）深挖没有增量意义——新样本的检验功效还不如
// 刚失败的那一次，搜索层会直接跳过。
export const TRIGGER_OPTIMIZER_DEEP_DIVE_ROUNDS = 6;

// 「换难度稳健性复核」的轮数（2026-09-23 新增，设计 §29）：触发器是**全局技能配置**，
// 而搜索只在单一区域 + 单一难度上评估 —— 结论完全有可能只在那一个难度成立。复核把
// 「最优配置 vs 搜索起点配置」搬到相邻难度上重跑一组**新样本**（独立盐）做配对评估。
// 6 轮的含义（2026-09-25，设计 §49 起）：**保底轮数** —— 自适应复核绝不比它少花样本
// （只跑两个配置，2 次评估 × 6 场 = 12 场模拟，换来自由度 5 的 t 检验）；不复用
// settings.rounds —— 这是**结论级**检查，不是重跑一次搜索。
export const TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS = 6;
// 复核轮数的**上限**（2026-09-25，设计 §49；2026-09-27 按 §63 实施项 ① 从 12 提升到 16）：
// 自适应复核 / 换盐追加的总量上限不允许超过它。16 的实测依据（§63-②，队伍载荷）：12 轮
// 88.6% 未达「同档位单人 − 10pp」判据线，16 轮 99.0% 达标 ⇒ 现状上限 12 正是绑住队伍载荷
// 复核功率的约束。最坏成本随之锁在 2 × 16 = 32 场（原 2 × 12 = 24）；反解说「上限也不够」
// 时补到上限（§47 A′ 口径的教训：cap 之内买到的那部分解析率正是自适应的意义，不要改成
// 「不花样本」）。单人侧实测 ≤12 已 100% ⇒ 上调只在「先验说不够」时生效，属「允许更贵」
// 而非「默认更贵」。
export const TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS = 16;

// 模拟时长：默认与 store.simulationSettings.simulationTimeHours 的默认值（24）对齐。
export const TRIGGER_OPTIMIZER_DEFAULT_SIMULATION_HOURS = 24;
export const TRIGGER_OPTIMIZER_MIN_SIMULATION_HOURS = 1;
export const TRIGGER_OPTIMIZER_MAX_SIMULATION_HOURS = 168;

// 队伍载荷的队友数上限（2026-09-27，设计 §59）：引擎的玩家 hrid = player1..player5
// （profitEstimator / SimulationResultsView 的 PLAYER_HRIDS 同口径）⇒ 主角之外最多 4 名队友。
// 上限只是护栏：设置里多出的 id 在归一化时被截断，不会喂给引擎。
export const TRIGGER_OPTIMIZER_MAX_PARTY_TEAMMATES = 4;

// ── 搜索强度预设（设计 §5.4）─────────────────────────────────────────────────
// 预设是 (candidateLimit, maxRounds, rounds) 三个旋钮的捆绑，**不单独持久化**：
// 设置里没有 preset 字段，当前三元组匹配不上任何预设时就是「自定义」。这样只有
// 一个事实源（三个数值），不会出现「下拉说精细、数值却是快速」的状态漂移。
export const TRIGGER_OPTIMIZER_PRESET_FAST = 'fast';
export const TRIGGER_OPTIMIZER_PRESET_STANDARD = 'standard';
export const TRIGGER_OPTIMIZER_PRESET_FINE = 'fine';
export const TRIGGER_OPTIMIZER_PRESET_CUSTOM = 'custom';

// 三档预设 = (candidateLimit, maxRounds, 时长→轮数表)。standard 必须等于产品的三个
// 默认常量（由测试锁定）：默认预设 = 现有行为，用户不动此三元组以外的高级项时不会被
// 悄悄变快或变慢。
//
// ⚠️ fast 档的 rounds = 2（2026-09-18 从 1 提到 2，**这一项不是可选参数**）：
// 采纳闸门要求「配对证据超过噪声地板」，而 rounds < 2 时配对统计给不出标准误
// （verdict 恒 unknown）→ 任何候选都无法被采纳，快速档会变成一个只烧机器、永远
// 报「未找到更优配置」的死档。早先 rounds=1 的「速度优势」本身就是把噪声当提升
// （实测：+49% 利润的假象），不是真的快。
//
// ── 时长自适应轮数（2026-09-20 按功效实测重定，设计 §20.1）──────────────────────
// 口径从「全局推荐值 × 基础轮数」的两段式改为**每档自带一张「时长 → 轮数」表**
// （边界 ≤4h / ≤8h；更长时长用该档的 rounds 兜底）。依据（只读实验：4h/8h/24h ×
// 20 稳定种子 × 真实 worker，见 docs §20）：
//   · 采纳地板（2×SE）≈ 2σ(T)/√n，实测 σ(T)·√T ≈ 常数 ⇒ 地板 ∝ 1/√(n·T)：
//     「总模拟小时数」是唯一的统计货币，与「时长怎么切分」无关；
//   · 每模拟小时的墙钟成本随时长下降（实测 4h 0.378 s/模拟小时、24h 0.209 s/模拟小时）
//     ⇒ 长时长不必等比放大轮数就能拿到更低的地板；
//   · t(n−1) 在低轮数下是灾难：n=2 要 12.7（24h 下 ≈9.2% 利润才显著）、n=5 只要 2.78。
// 三档按「结论强度」分档（地板为丛林 tier0 实测标定；利润口径 ≈ 2^(2·分数) − 1；8h 一列按
// σ(8h) = 0.0122 由地板公式推出，与 σ·√T 恒定的自洽检查：W = 48 的两组同值 ≈1.4%）：
//   fast      先看一眼：               地板 ≈ 2.0% / 2.0% / 1.4%（4h / 8h / 24h）
//   standard  可信结论（产品默认档）：  地板 ≈ 1.6% / 1.4% / 0.86%
//   fine      尽量找最优：             地板 ≈ 1.4% / 1.1% / 0.79%
export const TRIGGER_OPTIMIZER_PRESETS = Object.freeze([
  Object.freeze({
    id: TRIGGER_OPTIMIZER_PRESET_FAST,
    candidateLimit: 6,
    maxRounds: 1,
    // 兜底轮数（长时长）+ 短时长加密表（保持历史行为：4h → 5、8h → 3）。
    rounds: TRIGGER_OPTIMIZER_MIN_USABLE_ROUNDS,
    durationRounds: Object.freeze([
      Object.freeze({ maxHours: 4, rounds: 5 }),
      Object.freeze({ maxHours: 8, rounds: 3 }),
    ]),
  }),
  Object.freeze({
    id: TRIGGER_OPTIMIZER_PRESET_STANDARD,
    candidateLimit: TRIGGER_OPTIMIZER_DEFAULT_CANDIDATE_LIMIT,
    maxRounds: TRIGGER_OPTIMIZER_DEFAULT_MAX_ROUNDS,
    rounds: TRIGGER_OPTIMIZER_DEFAULT_ROUNDS,
    durationRounds: Object.freeze([
      Object.freeze({ maxHours: 4, rounds: 8 }),
      Object.freeze({ maxHours: 8, rounds: 6 }),
    ]),
  }),
  Object.freeze({
    id: TRIGGER_OPTIMIZER_PRESET_FINE,
    candidateLimit: TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
    maxRounds: 3,
    // 长时长 6 轮（与复验的 6 轮口径对齐）；短时长 10 轮 —— **不跟随 2026-09-27 的上限 10→12**：
    // 档位轮数 = 所有选「精细」用户的默认成本，动它属于「改默认」，与「放宽上限让用户手调」
    // 是两件事（§60.5 C1-② 只证了 12 轮单项收益，未拍板档位变重）。
    rounds: 6,
    durationRounds: Object.freeze([
      Object.freeze({ maxHours: 4, rounds: 10 }),
      Object.freeze({ maxHours: 8, rounds: 10 }),
    ]),
  }),
]);

// 某档预设在给定时长下的有效轮数：命中该档的时长表就用表里的值，否则用该档的兜底
// 轮数（= 长时长口径），最后钳到合法区间。归一化口径与设置层一致（非法时长回落到
// 产品默认时长 24h，不抛不猜）。
export function resolveTriggerOptimizerPresetRounds(preset, hours) {
  const numeric = toFiniteNumber(hours, TRIGGER_OPTIMIZER_DEFAULT_SIMULATION_HOURS);
  const table = Array.isArray(preset?.durationRounds) ? preset.durationRounds : [];
  const hit = table.find((entry) => numeric <= toFiniteNumber(entry?.maxHours, 0));
  const fallback = toFiniteNumber(preset?.rounds, TRIGGER_OPTIMIZER_DEFAULT_ROUNDS);
  return clamp(toFiniteNumber(hit?.rounds, fallback), TRIGGER_OPTIMIZER_MIN_ROUNDS, TRIGGER_OPTIMIZER_MAX_ROUNDS);
}

// 「标准档」按时长给出的推荐轮数（= 产品默认档口径）。保留这个入口是因为「默认设置
// 必须命中标准档」这条不变式需要它：normalize 的兜底值 = 它在默认时长（24h）下的取值。
export function resolveRecommendedTriggerOptimizerRounds(hours) {
  const preset = TRIGGER_OPTIMIZER_PRESETS.find((entry) => entry.id === TRIGGER_OPTIMIZER_PRESET_STANDARD);
  return preset ? resolveTriggerOptimizerPresetRounds(preset, hours) : TRIGGER_OPTIMIZER_DEFAULT_ROUNDS;
}

// 预设 id → 三个旋钮的部分设置（未知 id 返回 null，调用方据此忽略该次选择）。
// hours 缺省按产品默认时长（24h）解析 → 取该档的长时长口径（rounds 兜底值），
// 旧调用方（不传 hours）语义不变。
export function getTriggerOptimizerPresetSettings(presetId, hours) {
  const preset = TRIGGER_OPTIMIZER_PRESETS.find((entry) => entry.id === presetId);
  if (!preset) return null;
  return {
    candidateLimit: preset.candidateLimit,
    maxRounds: preset.maxRounds,
    rounds: resolveTriggerOptimizerPresetRounds(preset, hours),
  };
}

// 当前设置命中的预设 id；匹配不上任何预设 → 'custom'。先归一化再比对：字符串数字
// 与越界值按归一化结果判定，和界面显示的数值同源（下拉不会显示与数值不符的档位）。
// rounds 的比对走**该设置自己的 simulationHours**（时长自适应口径，见上）。
export function resolveTriggerOptimizerPresetId(settings) {
  const normalized = normalizeTriggerOptimizerSettings(settings);
  const preset = TRIGGER_OPTIMIZER_PRESETS.find(
    (entry) =>
      entry.candidateLimit === normalized.candidateLimit &&
      entry.maxRounds === normalized.maxRounds &&
      resolveTriggerOptimizerPresetRounds(entry, normalized.simulationHours) === normalized.rounds,
  );
  return preset?.id ?? TRIGGER_OPTIMIZER_PRESET_CUSTOM;
}

// 优化目标范围：MVP 只做已装备技能（abilities），结构上预留全物品（all）。
export const TRIGGER_OPTIMIZER_TARGET_SCOPE_ABILITIES = 'abilities';
export const TRIGGER_OPTIMIZER_TARGET_SCOPE_ALL = 'all';
export const TRIGGER_OPTIMIZER_DEFAULT_TARGET_SCOPE = TRIGGER_OPTIMIZER_TARGET_SCOPE_ABILITIES;
const TARGET_SCOPES = [TRIGGER_OPTIMIZER_TARGET_SCOPE_ABILITIES, TRIGGER_OPTIMIZER_TARGET_SCOPE_ALL];

// 目标函数常量（设计 §5.2）。
// 死亡参考量：次/小时。惩罚与奖励共用同一个分母口径，保证对称。
export const TRIGGER_OPTIMIZER_DEATH_REFERENCE = 2.0;
// 死亡减少的奖励系数：与惩罚项对称（惩罚按 1.0 计入负分，减少按本系数计入正分）。
// 默认 1.0：基线死 5/h、候选死 0/h 且 weightDeathSafety=1 时，奖励恰好 = 1 分
// （与「某指标翻倍」的 +1 分同量级）；weightDeathSafety=0.2 的默认权重下上限 0.2 分，
// 量级低于四大指标，作为「利润相当时的偏好性加权」而非主导项。
export const TRIGGER_OPTIMIZER_DEATH_REDUCTION_CREDIT = 1.0;
// 归一化尺度常量已迁移到下方「配对打分口径」区块（TRIGGER_OPTIMIZER_RELATIVE_LOG_SCALE
// + TRIGGER_OPTIMIZER_METRIC_FLOORS），旧的 TRIGGER_OPTIMIZER_LOG2_SCALE 已删除。
// 搜索采纳阈值：只有严格更优（超过 eps）的候选才覆盖当前最优（设计 §7.2）。
// 注意：设计文档 §5.2 把它交叉引用到 queueScoring.js 的 QUEUE_WEIGHT_SUM_EPSILON，
// 但该常量在源码里是 1e-6；搜索口径按 §7.2 的 1e-9 独立定义，以源码为准。
export const TRIGGER_OPTIMIZER_SCORE_EPSILON = 1e-9;

// 复合分口径的四个指标（与 QUEUE_MULTI_ROUND_METRIC_KEYS 一致）。
export const TRIGGER_OPTIMIZER_METRIC_KEYS = ['dps', 'dailyNoRngProfit', 'xpPerHour', 'killsPerHour'];

// ─ 配对打分口径（2026-09-17 重构）────────────────────────────────────────────
// 旧口径 norm = clamp(log2((m+1)/(baseline+1)), -1, 1) 有两个硬缺陷：
//   ① 负值被 Math.max(0, …) 钳零 —— 基线亏损 5000/h、候选亏损 200/h 时两者都变 0，
//      「把亏损压小」这类真实改进完全不被打分奖励；
//   ② (m+1)/(base+1) 在基线为负时会翻转符号（base=-3001 → 分母 -3000），
//      候选越差反而得分越高，属于静默的错误排序。
// 新口径直接吃**配对差**（候选与基线跑在同一组种子下，见 services/seededRandom.js）：
//   relative = (m_candidate - m_baseline) / max(|m_baseline|, floor_metric)
//   norm     = clamp(log2(1 + relative) / RELATIVE_LOG_SCALE, -1, 1)
// 语义：相对基线翻倍 = +1 分；相对基线腰斩 = -1 分；对称、对负基线正确、量纲无关。
// 量纲地板 floor 只在基线接近 0 时起作用，避免「基线 0 利润」把 1 点差异放大成满分。
export const TRIGGER_OPTIMIZER_RELATIVE_LOG_SCALE = 1.0;
export const TRIGGER_OPTIMIZER_METRIC_FLOORS = Object.freeze({
  dps: 1000,
  dailyNoRngProfit: 10000,
  xpPerHour: 1000,
  killsPerHour: 1,
});
// 空蓝（蓝耗崩盘）在配对视角下是**回归**才判负：基线自己也空蓝时，候选空蓝不算退步。
// 反向（基线空蓝、候选不空蓝）是真进步，给一个固定加分让它能浮出水面。
export const TRIGGER_OPTIMIZER_MANA_RECOVERY_BONUS = 0.25;

// 默认目标权重：复用 shared/queuePerformanceWeights 的默认结构
// （weightProfit 0.5 / weightXp 0.3 / weightDeathSafety 0.2，子权重和 = 1）。
export const TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS = Object.freeze({
  weightProfit: 0.5,
  weightXp: 0.3,
  weightDeathSafety: 0.2,
});

// 输入快照里参与指纹的模拟设置子集（其余 UI 态不影响结果）。
const INPUT_SIMULATION_KEYS = [
  'mode',
  'runScope',
  'useDungeon',
  'zoneHrid',
  'dungeonHrid',
  'difficultyTier',
  'labyrinthHrid',
  'roomLevel',
  'simulationTimeHours',
  'combatScrollsEnabled',
  // 额外增益口径（2026-09-27）：月卡与社区经验 / 掉落倍率随 buildSimulationExtra 进入
  // 每场模拟（shared/simulationExtraBuffs.js 注入永久 buff），直接改变 xpPerHour /
  // 利润 / 击杀口径。此前指纹遗漏这五个字段：改月卡或社区 buff 后既有报告不会
  // 过期、仍可被应用，违背「配置变化 → 结果过期」承诺（与 foodOptimizerSnapshot
  // 把整个 extra 纳入输入签名的做法对齐；enableHpMpVisualization 为纯可视化字段、
  // 不影响结果，刻意不纳入，避免假性过期）。
  'mooPass',
  'comExpEnabled',
  'comExp',
  'comDropEnabled',
  'comDrop',
];

// 数值类设置的统一归一化口径：非有限数或越界一律回落到产品默认（不 clamp 到
// 边界）——与 normalizeFoodOptimizerRounds 同款「脏数据跟随产品默认」，
// 避免 -5 小时这种脏值被静默当成「1 小时」跑出一份误导性的结果。
function normalizeBoundedNumber(value, fallback, min, max, requireInteger = false) {
  const parsed = Number(value);
  if (typeof value === 'boolean' || value === null || value === undefined) return fallback;
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min || parsed > max) return fallback;
  return requireInteger && !Number.isInteger(parsed) ? fallback : parsed;
}

function normalizeMaxRounds(value) {
  return normalizeBoundedNumber(
    value,
    TRIGGER_OPTIMIZER_DEFAULT_MAX_ROUNDS,
    TRIGGER_OPTIMIZER_MIN_MAX_ROUNDS,
    TRIGGER_OPTIMIZER_MAX_MAX_ROUNDS,
    true,
  );
}

// 重复次数的归一化口径：唯一对外入口（搜索层/模拟层都用它，不再各自解析一遍）。
export function normalizeTriggerOptimizerRounds(value) {
  return normalizeBoundedNumber(
    value,
    TRIGGER_OPTIMIZER_DEFAULT_ROUNDS,
    TRIGGER_OPTIMIZER_MIN_ROUNDS,
    TRIGGER_OPTIMIZER_MAX_ROUNDS,
    true,
  );
}

// 复验轮数的归一化口径（2026-09-25，设计 §47）：**不能**复用 normalizeTriggerOptimizerRounds ——
// 那个口径的上限是搜索期的「重复次数」上限（10 轮），而自适应追加的合法区间是 1..上限（24 轮）。
// 混用会让「反解说这次要 18 轮」被静默钳成 10 轮，与装置里验证过的 A′ 口径不符。
export function normalizeTriggerOptimizerVerifyRounds(value) {
  return normalizeBoundedNumber(value, TRIGGER_OPTIMIZER_VERIFY_ROUNDS, 1, TRIGGER_OPTIMIZER_VERIFY_MAX_ROUNDS, true);
}

// 追加复验的**累计已花场次**（2026-09-26，设计 §50 B-2）：attempts 各条记录的 rounds 即「本次追加
// 几轮/侧」，每轮双侧 = 2 场模拟 ⇒ 累计 = Σ(2 × rounds)。口径与装置一致：只数**追加**部分，
// 不含首轮复验的 12 场 —— 20% / 40% 护栏的实测数字就是按这个口径标的，store（真的去跑）与页面
//（上屏说将要跑多少）必须用同一个值，否则「文案里的预算」与「实际扣的预算」会分裂。
export function resolveTriggerOptimizerAppendSpentSimulations(attempts) {
  if (!Array.isArray(attempts)) return 0;
  return attempts.reduce((sum, item) => {
    const rounds = Number(item?.rounds);
    return Number.isFinite(rounds) && rounds > 0 ? sum + Math.floor(rounds) * 2 : sum;
  }, 0);
}

// 追加复验的**执行计划快照**净化（2026-09-25，设计 §48；累计字段 2026-09-26，设计 §50）：报告里的
// attempts[i].plan 要能事后回答「这次补了几轮、上限/护栏有没有咬住、累计预算花到哪」—— 调用方
//（store）把自适应计划的输出原样交进来留档。口径：白名单取字段 + 逐项校验类型，任何缺项/类型不符
// **整份丢弃**（返回 null）——宁可不留档，也不留半截或自相矛盾的计划。自洽闸门：plannedRounds 必须
// 等于这一条实际执行的 rounds（服务层归一化后的值），否则「计划的那件事」与「真正跑的那件事」不是
// 同一个（例如越界值被归一化回落），留档它只会误导复盘。
export function normalizeTriggerOptimizerAppendPlan(raw, rounds) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const snapshot = {};
  for (const key of ['decisive', 'capped', 'budgetLimited']) {
    if (typeof raw[key] !== 'boolean') return null;
    snapshot[key] = raw[key];
  }
  // 成本护栏的瓶颈（2026-09-26，设计 §50 B-2）：未咬 = null；单次护栏 = 'single'；累计护栏 =
  // 'cumulative'。枚举之外整份丢弃（宁可不留档，也不留一个没定义的来源）。
  if (raw.limitedBy === null || raw.limitedBy === undefined) {
    snapshot.limitedBy = null;
  } else if (raw.limitedBy === 'single' || raw.limitedBy === 'cumulative') {
    snapshot.limitedBy = raw.limitedBy;
  } else {
    return null;
  }
  for (const key of [
    'currentRounds',
    'capRounds',
    'targetRounds',
    'plannedRounds',
    'plannedSimulations',
    'spentSimulations',
  ]) {
    const value = Number(raw[key]);
    if (!Number.isFinite(value)) return null;
    snapshot[key] = value;
  }
  // 可空项：capped（上限也不够）时反解没有解 —— requiredRounds = null；拿不到整轮场次时护栏
  // 不存在 —— budgetSimulations / cumulativeBudgetSimulations = null。二者 null 合法，其它值
  // 必须是有限数字。
  for (const key of ['requiredRounds', 'budgetSimulations', 'cumulativeBudgetSimulations']) {
    if (raw[key] === null || raw[key] === undefined) {
      snapshot[key] = null;
      continue;
    }
    const value = Number(raw[key]);
    if (!Number.isFinite(value)) return null;
    snapshot[key] = value;
  }
  if (snapshot.plannedRounds !== rounds) return null;
  return snapshot;
}

// 复核轮数的归一化口径（2026-09-25，设计 §49）：**不能**复用 normalizeTriggerOptimizerRounds ——
// 两者语义不同（搜索口径 = 每候选的抽样重复次数，上限 TRIGGER_OPTIMIZER_MAX_ROUNDS；本口径 =
// 「新现场从零跑几轮」，上限独立为 TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS）。历史上搜索上限
// 10 < 复核上限，混用曾把「要 12 轮」静默钳成 10 轮；2026-09-27 起两个上限分别是 12 / 16
// （搜索上限当天从 10 提到 12，复核上限随后按 §63 从 12 提到 16），数值不再巧合相同 ——
// 口径独立的结构必须保留（§47 同款教训）。
export function normalizeTriggerOptimizerRobustnessRounds(value, maxRounds = TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS) {
  return normalizeBoundedNumber(value, TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS, 1, maxRounds, true);
}

// 复核**追加**轮数的归一化口径（2026-09-26，设计 §51）：合法区间与首跑相同（1..上限 16），但**语义
// 不同** —— 首跑是「新现场从零跑几轮」，追加是「这一次补几轮」。单独命名而不是复用上面那个：§47/§49
// 的教训是两套口径可以长得像、但含义不同，将来任一方改动（如追加允许更小粒度）时不会静默串味；
// 也**不能**复用 normalizeTriggerOptimizerRounds（搜索口径 = 每候选抽样重复次数，与「补几轮」不同语义；
// 历史上它的上限 10 / 12 会把「补到上限 16」静默钳短）。
// 缺省回落保底 6 轮（服务层兜底口径）：正常路径由计划（planTriggerOptimizerRobustnessAppend）给出
// 1..16 的轮数，常量的事实源仍然只在服务层。
export function normalizeTriggerOptimizerRobustnessAppendRounds(
  value,
  maxRounds = TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS,
) {
  return normalizeBoundedNumber(value, TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS, 1, maxRounds, true);
}

// 复核**执行计划快照**的净化（2026-09-25，设计 §49；追加计划字段 2026-09-26，设计 §51）：与 §48 的
// 追加复验同款口径 —— 报告要能事后回答「这次复核跑了几轮、是反解出来的还是被上限/成本护栏咬住」。
// 白名单取字段 + 逐项校验类型，任何缺项/类型不符**整份丢弃**（返回 null）：宁可不留档，也不留半截
// 或自相矛盾的计划。自洽闸门：plannedRounds 必须等于这一条实际执行的 rounds（服务层归一化后的值）。
// 注意本项**没有** decisive/targetRounds —— 复核语义是「新现场从零跑多少轮」，先验已判明确也
// 照样给轮数（复核一定要换难度重测），那两个字段在这里没有意义。
// 追加计划的额外字段（§51）按**可选**处理（首跑的 §49 计划没有它们）：zeroDiff / atCap 缺省 false，
// limitedBy 缺省 null，spentSimulations / cumulativeBudgetSimulations 缺省 null —— 缺了不丢整份，
// 因为「这次跑了几轮」这个主证据在 §49 字段里，追加细节只是补注。
export function normalizeTriggerOptimizerRobustnessPlan(raw, rounds) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const snapshot = {};
  for (const key of ['capped', 'budgetLimited']) {
    if (typeof raw[key] !== 'boolean') return null;
    snapshot[key] = raw[key];
  }
  for (const key of ['currentRounds', 'capRounds', 'plannedRounds', 'plannedSimulations']) {
    const value = Number(raw[key]);
    if (!Number.isFinite(value)) return null;
    snapshot[key] = value;
  }
  // 可空项：capped（上限也不够）时反解没有解 —— requiredRounds = null；拿不到整轮场次时护栏
  // 不存在 —— budgetSimulations = null。二者 null 合法，其它值必须是有限数字。
  for (const key of ['requiredRounds', 'budgetSimulations']) {
    if (raw[key] === null || raw[key] === undefined) {
      snapshot[key] = null;
      continue;
    }
    const value = Number(raw[key]);
    if (!Number.isFinite(value)) return null;
    snapshot[key] = value;
  }
  // 追加计划的可选补注（§51）
  for (const key of ['zeroDiff', 'atCap']) {
    if (raw[key] === undefined) {
      snapshot[key] = false;
      continue;
    }
    if (typeof raw[key] !== 'boolean') return null;
    snapshot[key] = raw[key];
  }
  if (raw.limitedBy === undefined || raw.limitedBy === null) {
    snapshot.limitedBy = null;
  } else if (raw.limitedBy === 'single' || raw.limitedBy === 'cumulative') {
    snapshot.limitedBy = raw.limitedBy;
  } else {
    return null;
  }
  for (const key of ['spentSimulations', 'cumulativeBudgetSimulations']) {
    if (raw[key] === null || raw[key] === undefined) {
      snapshot[key] = null;
      continue;
    }
    const value = Number(raw[key]);
    if (!Number.isFinite(value)) return null;
    snapshot[key] = value;
  }
  if (snapshot.plannedRounds !== rounds) return null;
  return snapshot;
}

function normalizeCandidateLimit(value) {
  return normalizeBoundedNumber(
    value,
    TRIGGER_OPTIMIZER_DEFAULT_CANDIDATE_LIMIT,
    TRIGGER_OPTIMIZER_MIN_CANDIDATE_LIMIT,
    TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
    true,
  );
}

function normalizeSimulationHours(value) {
  return normalizeBoundedNumber(
    value,
    TRIGGER_OPTIMIZER_DEFAULT_SIMULATION_HOURS,
    TRIGGER_OPTIMIZER_MIN_SIMULATION_HOURS,
    TRIGGER_OPTIMIZER_MAX_SIMULATION_HOURS,
  );
}

function normalizeTargetScope(value) {
  return TARGET_SCOPES.includes(value) ? value : TRIGGER_OPTIMIZER_DEFAULT_TARGET_SCOPE;
}

// 「锁定（不优化）的技能」——用户按结果快速调整策略的入口：把已经满意的技能固定住，
// 下一轮只搜索其余技能。存 hrid（不是槽位下标）：槽位顺序/等级闸门变化后语义仍稳定。
// 去重 + 排序，保证设置对象在语义相同的情况下指纹一致（不会因为勾选顺序不同判过期）。
function normalizeLockedAbilityHrids(value) {
  if (!Array.isArray(value)) return [];
  const hrids = value.map((entry) => String(entry ?? '').trim()).filter((hrid) => hrid.length > 0);
  return Array.from(new Set(hrids)).sort();
}

// 队友集合（2026-09-27，设计 §59）：参与整队模拟的**其它玩家 id**（主角自身不在其中，
// 它在载荷里固定是 player1）。去重但**保留勾选顺序**（顺序决定 player2 / player3… 的 hrid
// 分配，必须稳定）；超出上限的部分截断。
function normalizePartyPlayerIds(value) {
  if (!Array.isArray(value)) return [];
  const ids = value.map((entry) => String(entry ?? '').trim()).filter((id) => id.length > 0);
  return Array.from(new Set(ids)).slice(0, TRIGGER_OPTIMIZER_MAX_PARTY_TEAMMATES);
}

// 设置归一化的唯一入口：缺失/非法字段回落到产品默认（脏数据跟随默认，不另设
// 第二个魔法数，与 foodOptimizerDomain 的「单一魔法数」原则一致）。持久化键里
// 用设计文档 §8.1 的命名（maxPasses / maxCandidatesPerAbility）时同样被接受。
export function normalizeTriggerOptimizerSettings(source = {}) {
  const raw = isPlainObject(source) ? source : {};
  const rawWeights = isPlainObject(raw.objectiveWeights) ? raw.objectiveWeights : {};
  const resolved = resolveQueuePerformanceSubweights(
    { weightProfit: rawWeights.weightProfit, weightXp: rawWeights.weightXp },
    TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS,
  );
  return {
    objectiveWeights: {
      weightProfit: resolved.weightProfit,
      weightXp: resolved.weightXp,
      weightDeathSafety: resolved.weightDeathSafety,
    },
    maxRounds: normalizeMaxRounds(raw.maxPasses ?? raw.maxRounds),
    rounds: normalizeTriggerOptimizerRounds(raw.rounds),
    simulationHours: normalizeSimulationHours(raw.simulationHours),
    candidateLimit: normalizeCandidateLimit(raw.maxCandidatesPerAbility ?? raw.candidateLimit),
    targetScope: normalizeTargetScope(raw.targetScope),
    lockedAbilityHrids: normalizeLockedAbilityHrids(raw.lockedAbilityHrids),
    // 队伍载荷（2026-09-27，设计 §59）：空数组 = 单人载荷（现状，零行为变化）。
    partyPlayerIds: normalizePartyPlayerIds(raw.partyPlayerIds),
  };
}

function isValidWeightPair(profit, xp) {
  return (
    profit !== '' &&
    profit != null &&
    typeof profit !== 'boolean' &&
    xp !== '' &&
    xp != null &&
    typeof xp !== 'boolean' &&
    Number(profit) >= 0 &&
    Number(profit) <= 1 &&
    Number(xp) >= 0 &&
    Number(xp) <= 1 &&
    Number(profit) + Number(xp) <= 1 + 1e-9
  );
}

function isValidRange(value, min, max) {
  return (
    value !== '' &&
    value != null &&
    typeof value !== 'boolean' &&
    Number.isFinite(Number(value)) &&
    Number(value) >= min &&
    Number(value) <= max
  );
}

// 锁定技能清单校验：缺省（未勾选任何技能）合法；显式给非数组或含空串/非字符串即非法。
function isValidLockedAbilityHrids(value) {
  if (value === undefined || value === null || value === '') return true;
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0);
}

// 队友集合校验：缺省（单人载荷）合法；显式给非数组或含空串 / 非字符串即非法。
function isValidPartyPlayerIds(value) {
  if (value === undefined || value === null || value === '') return true;
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0);
}

// 设置校验（页面输入框绑定它，与 isValidFoodOptimizerSettings 同款：只拒绝显式非法值）。
export function isValidTriggerOptimizerSettings(settings) {
  const raw = isPlainObject(settings) ? settings : {};
  const weights = isPlainObject(raw.objectiveWeights) ? raw.objectiveWeights : {};
  const scope = raw.targetScope ?? TRIGGER_OPTIMIZER_DEFAULT_TARGET_SCOPE;
  return (
    isValidWeightPair(weights.weightProfit, weights.weightXp) &&
    isValidRange(raw.maxPasses ?? raw.maxRounds, TRIGGER_OPTIMIZER_MIN_MAX_ROUNDS, TRIGGER_OPTIMIZER_MAX_MAX_ROUNDS) &&
    isValidRange(raw.rounds, TRIGGER_OPTIMIZER_MIN_ROUNDS, TRIGGER_OPTIMIZER_MAX_ROUNDS) &&
    isValidRange(
      raw.maxCandidatesPerAbility ?? raw.candidateLimit,
      TRIGGER_OPTIMIZER_MIN_CANDIDATE_LIMIT,
      TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
    ) &&
    isValidRange(raw.simulationHours, TRIGGER_OPTIMIZER_MIN_SIMULATION_HOURS, TRIGGER_OPTIMIZER_MAX_SIMULATION_HOURS) &&
    TARGET_SCOPES.includes(scope) &&
    isValidLockedAbilityHrids(raw.lockedAbilityHrids) &&
    isValidPartyPlayerIds(raw.partyPlayerIds)
  );
}

// Pinia state 工厂：settings 可被 store 持久化的值覆盖
// （simulatorStorage 的 loadTriggerOptimizerSettingsFromStorage 产出脏值时自动回落）。
export function createTriggerOptimizerState(persistedSettings = null) {
  return {
    settings: normalizeTriggerOptimizerSettings(persistedSettings),
    runtime: {
      isRunning: false,
      progress: 0,
      startedAt: null,
      elapsedSeconds: 0,
      error: '',
      cancelRequested: false,
      completionNoticeId: null,
    },
    results: createEmptyResult(),
  };
}

// 结果结构工厂：一次搜索运行的报告骨架。baseline/perAbilityChoices 由搜索引擎
// 填充；metricsByCandidate 以「槽位 + 候选签名」为键，供 UI 展开详情。
// verification 是搜索结束后用**另一组种子**做的独立复验（见 search 层）。
export function createEmptyResult() {
  return {
    baseline: null,
    perAbilityChoices: [],
    metricsByCandidate: {},
    rounds: TRIGGER_OPTIMIZER_DEFAULT_ROUNDS,
    bestSignature: '',
    bestTriggerMap: null,
    // 搜索起点配置（2026-09-23，设计 §29）：换难度复核的对照侧。搜索层在收尾时取快照
    // （playerConfig.triggerMap 的深拷贝），UI/复核都读它 —— 报告因此能复原「改之前长什么样」。
    baselineTriggerMap: null,
    // 结论适用范围（2026-09-23，设计 §29）：实际目标 hrid / 难度 / 时长。触发器是全局技能配置，
    // 而搜索只在单目标上评估 —— UI 的「结论适用范围」块与换难度复核都从这里取口径。
    evaluationScope: null,
    // 换难度稳健性复核结果（2026-09-23，设计 §29）：由 store 的 runTriggerOptimizerRobustness
    // 写入，形如 { difficultyTier, zoneHrid, rounds, seeds, baselineMetrics, bestMetrics, paired,
    // verdict, scoreDelta, profitDelta, createdAt }。只对**这一份报告**有意义（换报告即失效）。
    robustness: null,
    passes: [],
    improvedSlots: [],
    verification: null,
    // 「深挖」加密复核记录（2026-09-19 设计 §18.1；2026-09-20 改独立种子，设计 §21）：
    // 每个被噪声地板拦下的槽最多一条，形如
    // { slotIndex, abilityHrid, rounds, seeds, mean, stdError, pValue, verdict, score, adopted }。
    // seeds = 该次复核实际使用的 DEEP_DIVE_ROUNDS 个种子（独立盐派生）——UI/测试据此自证
    // 「判据用的是与筛选无关的新样本」。
    deepDives: [],
    // 「轮数上限截断」（2026-09-19，设计 §19.8）：搜索跑满 maxRounds 且**最后一轮仍有采纳**时
    // 置位 —— 早停口径是「一整轮零采纳」，走到上限说明固定点还没到、结果可能没搜完。
    // UI 据此提示「提高搜索轮数上限或用精细档再跑」。
    roundLimitReached: false,
    // 跨槽联合采纳记录（2026-09-19，设计 §19.11）：只含被采纳的联合对，形如
    // { round, slots, abilityHrids, rounds, score, mean, stdError, pValue, verdict,
    //   marginalMean, adoptedSlots }。UI 用它解释「提升里包含联合采纳的贡献」。
    jointAdoptions: [],
    // racing 分级采样（2026-09-24，设计 §30）：粗筛抽样场数 / 幸存者名额 / 本次是否
    // 真的启用过粗筛（候选池小的槽走原路径，见 TRIGGER_OPTIMIZER_RACING_MIN_POOL）。
    // 报告自证采样口径：候选表里「粗筛」行的统计与精测行不同源，UI 据此标注。
    screenRounds: TRIGGER_OPTIMIZER_SCREEN_ROUNDS,
    racingKeep: TRIGGER_OPTIMIZER_RACING_KEEP,
    racingUsed: false,
    createdAt: 0,
    stale: false,
  };
}

// 深冻结 triggerMap（键 → 触发器条目数组）：基线快照必须不可变，供后续撤销
// （revert）与「写回」路径安全引用。冻结的是普通 JSON 结构，structuredClone
// 仍可正常拷贝（克隆结果不再冻结）。
function deepFreezeTriggerMap(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(deepFreezeTriggerMap));
  }
  if (isPlainObject(value)) {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([key, child]) => [String(key), deepFreezeTriggerMap(child)])),
    );
  }
  return value;
}

function extractSimulationSnapshot(simulationSettings) {
  const source = isPlainObject(simulationSettings) ? simulationSettings : {};
  return Object.fromEntries(INPUT_SIMULATION_KEYS.map((key) => [key, deepClone(source[key] ?? null)]));
}

// 输入归一化 + 基线快照：拷贝玩家配置里**参与模拟的战斗键**（与 foodOptimizerSnapshot
// 的 COMBAT_PLAYER_KEYS 同一份清单），并冻结基线 triggerMap。引擎/搜索一律吃拷贝，
// 绝不改原件。options.settings 为优化器设置（归一化后随输入一起参与指纹，权重变化
// 即让既有报告过期）。
//
// 为什么不能 deepClone 整个玩家：玩家对象上挂着 assetScore 这类**派生字段**——
// 行情/资产管线会在任意时刻异步重算并写入（内含 computedAt 时间戳）。把它算进指纹，
// 每次资产重算都会让未过期的报告「过期」；实测后果：应用优化结果后资产重算触发
// 签名漂移 → sticky 过期标志置位 → 「撤销」按钮消失（2026-09-17 浏览器冒烟发现）。
// 队友输入快照（2026-09-27，设计 §59）：与主角**同一份** COMBAT_PLAYER_KEYS（含各自的
// triggerMap —— 队友自己的触发器同样改变整队输出），同样排除 assetScore 这类派生字段
// （理由与主角一致，见上方说明）。换队友、改队友装备 / 技能 / 触发器都会让指纹变化 ⇒ 报告过期。
function extractTeammateSnapshots(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((mate) => isPlainObject(mate))
    .map((mate) => ({
      playerId: String(mate.id ?? ''),
      player: deepClone(Object.fromEntries(COMBAT_PLAYER_KEYS.map((key) => [key, mate[key] ?? null]))),
    }));
}

export function createOptimizerInput(player, simulationSettings = {}, options = {}) {
  const source = isPlainObject(player) ? player : {};
  const resolvedOptions = isPlainObject(options) ? options : {};
  return {
    playerId: String(source.id ?? ''),
    player: deepClone(Object.fromEntries(COMBAT_PLAYER_KEYS.map((key) => [key, source[key] ?? null]))),
    // 队伍载荷（2026-09-27，设计 §59）：空数组 = 单人载荷。本键**恒发**，输入形状不随队伍
    // 变化；指纹语义 = 「这份结论是在什么载荷上得出的」。
    teammates: extractTeammateSnapshots(resolvedOptions.teammates),
    baselineTriggerMap: deepFreezeTriggerMap(source.triggerMap ?? {}),
    simulation: extractSimulationSnapshot(simulationSettings),
    settings: normalizeTriggerOptimizerSettings(resolvedOptions.settings),
  };
}

// 输入指纹：递归排序键后 JSON 序列化（仿 createFoodOptimizerInputSignature）。
// 相同输入必产出相同指纹；键顺序、数组顺序外的任何变化都会让指纹变化，
// store 据此判定报告过期（stale）。
export function createTriggerOptimizerInputSignature(input) {
  function ordered(value) {
    if (Array.isArray(value)) return value.map(ordered);
    if (isPlainObject(value)) {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, ordered(value[key])]),
      );
    }
    return value;
  }
  return JSON.stringify(ordered(input));
}

// 候选签名：default（删键）与 []（立即释放）是两个固定锚点，其余取 sanitize 后
// 的触发器条目序列化——sanitize 是四态折叠的唯一口径，签名必须与它同源。
export function buildTriggerCandidateSignature(triggers) {
  if (triggers === null || triggers === undefined) return 'default';
  return JSON.stringify(sanitizeTriggerList(triggers));
}

// ─ 种子集（公共随机数 / CRN）────────────────────────────────────────────────
// 七套种子，用途不同、必须互不相同（salt 进 key 参与 hash ⇒ 各组种子天然错开）：
//   screen：racing 粗筛 lane（2026-09-24，设计 §30）使用。必须与 search 独立：粗筛参与了
//           「谁进精测」的决策（select on A），精测统计若混入粗筛样本就是可选停时
//           （§21 的教训）——换盐 = 样本分割（粗筛看 A 组、精测判据只看 B 组）。
//   search：搜索期精测 lane 使用。基线与该槽全部候选共享同一组种子 → 打分吃的是配对差。
//   deepDive：被噪声地板拦下的候选做**加密复核**时使用。必须是独立盐（2026-09-20 修正，
//           设计 §21）：搜索期那几轮参与了「谁被复核」的决策，拿它们或它们的延长线
//           再判一次就是可选停时；换盐 = 样本分割（筛选看 A 组、判据只看 B 组）。
//   verify：搜索结束后的**独立复验**使用。换一组种子重跑「基线 vs 最优」，
//           若提升在新种子下依然成立，说明结论不是某组种子的运气（见 §复验）。
//   verify-append：**追加复验**使用（2026-09-24，设计 §31）：首轮复验判 inconclusive 时再采
//           一组样本、与首轮样本合并后重新检验。必须独立盐，且每次 attempt 再进一层版本号
//           （`.v${attempt}`）——「要不要追加」是拿首轮结论做的决定（select on A），追加样本与
//           首轮同盐就是可选停时；换盐让追加样本独立于那个决定。合并重检把首轮样本一并算进
//           判据，其假阳性率是否仍达标由 §31 的 bootstrap 实证把关（判据：不高于单次复验）。
//   robustness：换难度稳健性复核使用（2026-09-23，设计 §29）。与 deepDive 同理必须是独立盐：
//           候选是**在原难度上筛出来的**，拿搜索期/复验期的种子再判一次就是把筛选数据当判据；
//           换盐 = 样本分割（筛选看 A 组、判据只看 B 组），t 检验才有效。
//           另外种子键里带 difficultyTier（见 createTriggerOptimizerSeedSet 的 key），
//           所以「换难度」本身就换了一组新随机流 —— 盐独立只是把这件事写死、不靠巧合。
export const TRIGGER_OPTIMIZER_SEED_SALT_SCREEN = 'trigger-optimizer.screen.v1';
export const TRIGGER_OPTIMIZER_SEED_SALT_SEARCH = 'trigger-optimizer.search.v1';
export const TRIGGER_OPTIMIZER_SEED_SALT_DEEP_DIVE = 'trigger-optimizer.deep-dive.v1';
export const TRIGGER_OPTIMIZER_SEED_SALT_VERIFY = 'trigger-optimizer.verify.v1';
// 追加复验的盐基名：实际用的是 `${此常量}.v${attempt}`（attempt 从 1 递进）——每次追加的样本
// 互不相交，也与 search / screen / verify / deep-dive / robustness 全不相交。
export const TRIGGER_OPTIMIZER_SEED_SALT_VERIFY_APPEND = 'trigger-optimizer.verify-append';
export const TRIGGER_OPTIMIZER_SEED_SALT_ROBUSTNESS = 'trigger-optimizer.robustness.v1';

// ─ racing 分级采样（2026-09-24，设计 §30；§20.1 路线③）────────────────────────
// 大候选池先粗筛、幸存者再精测。三个常量的口径：
//   SCREEN_ROUNDS  ：粗筛抽样场数（2）—— §20.1 实测的筛子规格（n=2 全量筛）。
//   RACING_KEEP    ：幸存者名额（3）—— §20.1 自助实测「n=2 粗筛保留 top-3 时真最优
//                    100% 不被淘汰」；残余风险是漏采、不是误采（假采纳 ≈ 0%）。
//   RACING_MIN_POOL：候选数**超过**它才启用粗筛。小池里「粗筛全部 + 精测幸存者」比
//                    「全部精测」更贵（幸存率高、筛不掉几个），且粗筛只该在池子大时划算。
export const TRIGGER_OPTIMIZER_SCREEN_ROUNDS = 2;
export const TRIGGER_OPTIMIZER_RACING_KEEP = 3;
export const TRIGGER_OPTIMIZER_RACING_MIN_POOL = 8;

// 由**与搜索过程无关的稳定上下文**派生种子（玩家 id + 已佩戴技能 hrid 列表 + 区域/
// 难度/时长），刻意排除 triggerMap：搜索过程中 triggerMap 会不断变化，若把指纹里的
// triggerMap 算进种子，候选就会各自跑在不同随机流上，配对性立刻失效（这是本功能
// 早期版本「结论不可复现」的根因之一）。
//
// 派生是确定性的：同样的输入 → 同样的种子集 → 同样的结论（可复现，可交叉验证）。
export function createTriggerOptimizerSeedSet({
  playerId,
  playerConfig,
  simulationSettings,
  salt = TRIGGER_OPTIMIZER_SEED_SALT_SEARCH,
  count,
} = {}) {
  const abilities = (Array.isArray(playerConfig?.abilities) ? playerConfig.abilities : [])
    .map((ability) => String(ability?.abilityHrid ?? ''))
    .filter(Boolean)
    .join(',');
  const simulation = isPlainObject(simulationSettings) ? simulationSettings : {};
  const key = [
    String(playerId ?? ''),
    abilities,
    simulatedTargetKey(simulation),
    String(simulation.difficultyTier ?? ''),
    String(simulation.simulationTimeHours ?? ''),
    String(salt),
  ].join('|');
  return deriveSeedSet(hashSeed(key), count);
}

// 区域标识：副本与普通区域互斥（与 buildSingleSimulationPayload 的取用口径一致）。
function simulatedTargetKey(simulation) {
  const mode = String(simulation.mode ?? 'zone');
  if (mode === 'labyrinth') return `lab:${simulation.labyrinthHrid ?? ''}:${simulation.roomLevel ?? ''}`;
  return simulation.useDungeon ? `dungeon:${simulation.dungeonHrid ?? ''}` : `zone:${simulation.zoneHrid ?? ''}`;
}

// 单指标配对归一化：相对基线的对数压缩，钳到 [-1, 1]。
//   relative = (current - baseline) / max(|baseline|, floor)   // 相对变化量，可为负
//   norm     = clamp(log2(1 + relative) / RELATIVE_LOG_SCALE, -1, 1)
// relative ≤ -1（跌幅超过基线本身）钳到 -1；relative 极大时由 clamp 收到 1。
// 不再对指标做 Math.max(0, …) 钳零：负利润/负基线的改进必须能被奖励。
function normalizePairedMetric(current, baseline, metricKey) {
  const base = toFiniteNumber(baseline, 0);
  const value = toFiniteNumber(current, 0);
  const floor = toFiniteNumber(TRIGGER_OPTIMIZER_METRIC_FLOORS[metricKey], 0);
  const scale = Math.max(Math.abs(base), Math.abs(floor));
  if (!(scale > 0)) return 0;
  const relative = (value - base) / scale;
  if (relative <= -1) return -1;
  return clamp(Math.log2(1 + relative) / TRIGGER_OPTIMIZER_RELATIVE_LOG_SCALE, -1, 1);
}

// 死亡惩罚：只惩罚比基线增加的死亡，不奖励减少（防送死流）；基线死亡数低于
// 参考量时按参考量折算，低死亡区域也有足够惩罚梯度。
function computeDeathPenalty(deathsPerHour, baselineDeathsPerHour, weightDeathSafety) {
  const current = Math.max(0, toFiniteNumber(deathsPerHour));
  const baseline = Math.max(0, toFiniteNumber(baselineDeathsPerHour));
  const excess = Math.max(0, current - baseline);
  return (
    Math.max(0, toFiniteNumber(weightDeathSafety)) * (excess / Math.max(baseline, TRIGGER_OPTIMIZER_DEATH_REFERENCE))
  );
}

// 死亡减少的奖励（与 computeDeathPenalty 对称）：基线死得越多、候选死得越少，
// 奖励越高，上限 CREDIT × weightDeathSafety。与惩罚共用同一个分母口径，因此
// 「基线 5/h → 候选 0/h」与「基线 1/h → 候选 0/h」的奖励都受参考量约束。
//
// 为什么需要它（2026-09-18）：旧口径只惩罚增加，用户目标里的「死亡更低」完全
// 不得分——基线死 5/h、候选死 1/h 时贡献为 0，优化器无从区分「利润相当但更安全」
// 的候选。注意重叠：引擎里死亡有真实成本（复活停摆 + 清增益 + 清控制，见
// combatSimulator.js），dps/xp 已部分反映死亡代价，所以本项是偏好性加权，
// 量级刻意低于四大指标，不构成「送死换分」的逆向激励（增加死亡仍被惩罚）。
function computeDeathReductionCredit(deathsPerHour, baselineDeathsPerHour, weightDeathSafety) {
  const current = Math.max(0, toFiniteNumber(deathsPerHour));
  const baseline = Math.max(0, toFiniteNumber(baselineDeathsPerHour));
  const reduction = Math.max(0, baseline - current);
  if (reduction <= 0) return 0;
  const weight = Math.max(0, toFiniteNumber(weightDeathSafety));
  return (
    weight *
    Math.min(1, reduction / Math.max(baseline, TRIGGER_OPTIMIZER_DEATH_REFERENCE)) *
    TRIGGER_OPTIMIZER_DEATH_REDUCTION_CREDIT
  );
}

// 目标函数（配对口径）：
//   norm_m(c)       = clamp(log2(1 + (m(c)-m(base))/max(|m(base)|,floor_m)), -1, 1)
//   deathPenalty    = weightDeathSafety * max(deaths - deaths_base, 0) / max(deaths_base, 2.0)
//   deathCredit     = weightDeathSafety * min(1, max(deaths_base - deaths, 0) / max(deaths_base, 2.0)) * CREDIT
//   空蓝回归         → -Infinity（基线不空蓝而候选空蓝）
//   空蓝修复         → +MANA_RECOVERY_BONUS（基线空蓝而候选不空蓝）
//   score = Σ_m byMetric[m] * norm_m(c) - deathPenalty + deathCredit (+ manaBonus)
// weights 既接受原始 {weightProfit, weightXp}，也接受 resolveQueuePerformanceSubweights
// 的完整输出（含 byMetric）。
//
// baselineMetrics 必须是**同一组种子**下的基线指标（配对前提，见 seededRandom.js）；
// 传入非同源基线时打分仍然可算，但失去噪声抵消能力。
export function computeObjectiveScore(metrics, weights, baselineMetrics = {}) {
  const source = isPlainObject(metrics) ? metrics : {};
  const baseline = isPlainObject(baselineMetrics) ? baselineMetrics : {};
  const baselineRanOutOfMana = baseline.ranOutOfMana === true;
  if (source.ranOutOfMana === true && !baselineRanOutOfMana) return -Infinity;
  const subweights = weights?.byMetric
    ? weights
    : resolveQueuePerformanceSubweights(weights, TRIGGER_OPTIMIZER_DEFAULT_OBJECTIVE_WEIGHTS);
  let score = 0;
  for (const key of TRIGGER_OPTIMIZER_METRIC_KEYS) {
    score += (subweights.byMetric[key] || 0) * normalizePairedMetric(source[key], baseline[key], key);
  }
  score -= computeDeathPenalty(source.deathsPerHour, baseline.deathsPerHour, subweights.weightDeathSafety);
  score += computeDeathReductionCredit(source.deathsPerHour, baseline.deathsPerHour, subweights.weightDeathSafety);
  if (baselineRanOutOfMana && source.ranOutOfMana !== true) score += TRIGGER_OPTIMIZER_MANA_RECOVERY_BONUS;
  return score;
}

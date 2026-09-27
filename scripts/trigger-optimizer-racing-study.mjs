// racing 有效性实证研究（2026-09-24，设计 §30.8）：两段式采样（粗筛/精测）到底让结果更准了吗？
//
// 用法（不启动应用/服务器；引擎跑在本文件派生的 worker_threads 里）：
//   node scripts/trigger-optimizer-racing-study.mjs
//   node scripts/trigger-optimizer-racing-study.mjs --hours=0.1 --seeds=8 --rounds=2 --trials=20   # 冒烟
// 参数：--hours=4 --tier=0 --seeds=32 --rounds=5 --trials=500 --workers=<并行度> --slots=2,3
//      --refine-family/--refine-min/--refine-max/--refine-steps（§32 精炼步长对照）；
//      --coverage-family/--coverage-percents（§33 候选覆盖缺口量化：all_enemies + lowest_hp_percentage）；
//      （§57 组合内单腿精炼量化自动开启：对池里的 2 腿候选展开内部数值腿邻域 + 行走回放，无参数。）
//      --cross-zones=/actions/combat/x,...（§58 跨区域适用性量化：默认四档 = 结构梯度 + 极端对照
//      bear_with_it / aqua_planet（近尺度正对照）/ vampire / fly；`--cross-zones=0` 关闭。每个目标区域
//      采「源池全候选」的真值样本（源搜索种子）+ 生产 robustness 盐复核样本（复核轮数 = 生产上限常量，评测取 6 / 上限轮前缀；本节实测时为 12 轮）；
//      另采源区域同款复核样本作同区域对照 —— 判据与口径见输出段「跨区域适用性」注释。）
//      --party=parity（§59 队伍载荷评估：队友 = 官方向导存档（法系真实数据），整队模拟、只改主角
//      触发器、队友配置冻结；`--party=0` 关闭。只追加「基线 + 每槽候选」的队伍样本，判据见输出段。）
//      --party-stats=1（§60 队伍载荷统计口径对照 C1：复用 --party=parity 的两套 CRN 样本，回放生产
//      判据链比较「假采纳率 / 真检出率 / 噪声尺度」；须与 --party=parity 同用，判据见输出段）
//      --party-stats-rounds=5,8,12（C1-② 轮数补偿 A/B：同一批样本逐值复算不同轮数下的检出 / 假采纳，
//      预注册判据 R1/R2 见输出段；缺省 = 只用 --rounds）
//      --party-checks=1（§63 队伍载荷复核链：换难度复核（A′）的虚报 / 功率 + 搜索期复验（首轮 6 轮）
//      的否决 / 虚报，队伍 vs 单人同源对照；须与 --party=parity 同用；队伍复核样本 = 生产 robustness
//      盐 × 相邻难度的单独采样趟；预注册判据 A1/A2/B1/B2 见输出段「队伍载荷复核链」）
//      --party-checks-rounds=6,8,12,16,24,32（§63-② 复核轮数补偿：对共同分类 real 桶按固定档位逐值
//      复算判成立率（同一批 perm、纯回放零新采样），回答「加轮数能不能把队伍复核的功率拉回」；
//      补充判据 S1 与 null 桶安全参考见输出段）
//      --reuse-study=1（§62 跨运行样本复用量化 S4：同输入重跑 / 应用 winner 后重跑的可复用评估占比；
//      结构化测量（不额外跑仿真），预注册判据 P1/P2 见输出段）
//      --timing-study=1（§61 成本分解 S1：T 曲线 / 阶段计时 / 主线程占用 / 并行度曲线；参数
//      --timing-hours=1,4,8,12,24、--timing-reps、--timing-eval-seeds、--timing-curve-keys、
//      --timing-curve-seeds、--timing-workers=1,2,4,8,12,16；生产零改动，只读量化）
//      --realm-study=1 --realm-seeds=16（§54 worker realm 复用对照：每场新 realm vs 每个评估一个 realm，
//      含「同种子逐位一致」parity 自证与省时投影；跑了本段就提前返回，不进入批量采样）
//
// 方法（§20.1 同款实证路线，只读生产代码、零产品行为改动）：
//   1. 真实战斗引擎（trigger-optimizer-racing-study.engine.mjs，与 src/worker.js 逐行同构）
//      对「基线 + 每槽全部真实候选」在 N 个真实 CRN 种子上各采一轮逐轮样本；
//   2. bootstrap 随机把种子切成互不相交的 粗筛(SCREEN_ROUNDS) / 精测(rounds) / 留出(其余) 三组
//      —— select on A / test on B，与生产的样本分割同构；
//   3. 用**生产同款**打分/闸门/筛选（scoreCandidate / computePairedStats / shouldAdoptCandidate /
//      compareCandidates / pickRacingSurvivors）回放两条路径：
//        旧路径：全候选进精测、取最高分（racing 之前的全精测行为）；
//        racing：粗筛 top-K ∪ 锚点 的幸存者才进精测（判据只看精测样本）。
//   4. 每次试验记录「报告分（精测样本）」与「真实分（留出样本，独立于筛选与判据）」，跨试验统计：
//        选择偏差（winner's curse）= mean(报告分 − 真实分) —— 本轮要验证的核心命题；
//        漏采率 = P(真最优不在幸存者)；选中真最优率；regret = 真最优真实分 − 选中者真实分；
//        假采纳率 = P(采纳 且 选中者真实分 ≤ 0)；
//        成本 = 每槽每轮模拟场次（旧 vs racing，解析值）。
//   5. 槽位按全体种子的「真实分」分类：有真提升槽（看准确率/漏采/regret）与无提升槽（看假采纳）。
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

// 精炼步长对照研究的**对照臂**步长（百分点/级）：默认就是 2026-09-24 被否决的二分序列 ——
// 实测无提升（设计 §32），故生产仍是 10/5/5/5（下限 5pp）。`--refine-steps=10,5,2,1` 可换。
// 生产臂永远直接调 buildRefinedCandidates（生产步长由脚本实测，不写死）。
const REFINE_ALT_STEPS_DEFAULT = [10, 5, 2, 1];

if (!isMainThread) {
  // worker 分支（与 benchmark-food-optimizer.mjs 同款：本文件即 worker 入口）。
  // 一次消息收一批 job，逐种子跑真实引擎 + collectMetrics，回一批逐轮样本。
  const { collectMetrics, runPayload } = await import(workerData.engineUrl);
  parentPort.on('message', async (data) => {
    try {
      const results = [];
      // returnRaw（§54 realm 对照专用）：把原始 simResult 一并回传，供「复用 realm 是否改变
      // 结果」的逐位 parity 自证；其余分段不开 —— 它们只要 collectMetrics 的样本，回传原始
      // 结果只是白费带宽。reportTiming（§61 成本分解专用）额外回传逐场分阶段耗时。
      const returnRaw = Boolean(workerData?.returnRaw);
      const reportTiming = Boolean(workerData?.reportTiming);
      for (const job of data.jobs) {
        const samples = [];
        const simResults = returnRaw ? [] : null;
        const timings = reportTiming ? [] : null;
        for (const seed of job.seeds) {
          const runStartedAt = reportTiming ? performance.now() : 0;
          const simResult = await runPayload({ ...job.payload, seed });
          const runMs = reportTiming ? performance.now() - runStartedAt : 0;
          const metricsStartedAt = reportTiming ? performance.now() : 0;
          samples.push(collectMetrics(simResult, workerData.metricsContext));
          if (timings) timings.push({ runMs, metricsMs: performance.now() - metricsStartedAt });
          if (simResults) simResults.push(simResult);
        }
        const result = { key: job.key, samples };
        if (simResults) result.simResults = simResults;
        if (timings) result.timings = timings;
        results.push(result);
      }
      parentPort.postMessage({ results });
    } catch (error) {
      parentPort.postMessage({ error: error?.stack || String(error) });
    }
  });
  // reportReady（§61 realm 启动计时专用）：模块（引擎）加载就绪后立刻回一条 ready，
  // 让主线程能单独测出「new Worker → 首次 import 就绪」的固定开销。
  if (workerData?.reportReady) parentPort.postMessage({ ready: true });
} else {
  await main();
}

function parseArgs(argv) {
  const args = {
    hours: 4,
    tier: 0,
    seeds: 32,
    rounds: 5,
    trials: 500,
    workers: Math.max(1, availableParallelism() - 1),
    slots: [2, 3],
    // 精炼步长对照研究：目标家族（候选 labelKey 后缀）、1pp 采样区间与对照臂步长。
    refineFamily: 'enemyGroupHp',
    refineMin: 5,
    refineMax: 95,
    refineSteps: REFINE_ALT_STEPS_DEFAULT,
    // 候选覆盖缺口量化（§33）：目标槽用哪个家族锚定（必须落在 --slots 的某个槽里）+ 缺口族要试的
    // 百分比网格（每档都产 LTE/GTE 两向）。
    coverageFamily: 'enemyGroupHp',
    coveragePercents: [20, 40, 60, 80],
    // 阈值网格适配（§36）：换区域跑（怪物血量结构不同）时用 `--zone`，`--probe=1` 只打印该区域的
    // enemyHp 结构与各槽候选规模（不采样），用于挑「结构不同」的区域。
    zone: '/actions/combat/jungle_planet',
    // §58 跨区域适用性量化：目标区域列表（默认四档 = 结构梯度 + 极端对照：bear_with_it 更难更多怪 /
    // aqua_planet 同结构近尺度（正对照）/ vampire 单怪 2200 / fly 单怪 50；`--cross-zones=0` 关闭）。
    crossZones: [
      '/actions/combat/bear_with_it',
      '/actions/combat/aqua_planet',
      '/actions/combat/vampire',
      '/actions/combat/fly',
    ],
    probe: false,
    // §59 队伍载荷评估：`parity` = 用官方向导存档当队友（口径 A：整队模拟、只改主角触发器）。
    party: '',
    // §60 队伍载荷统计口径对照（C1）：与 --party=parity 同用，复用两套 CRN 样本回放生产判据链。
    partyStats: false,
    // C1-② 轮数补偿 A/B（复用 C1 样本逐值复算）：待测轮数列表（缺省 = 只用 --rounds）。
    partyStatsRounds: [],
    // §63 队伍载荷复核链（复核 A′ 虚报/功率 + 复验首轮否决/虚报）：与 --party=parity 同用。
    partyChecks: false,
    // §63-② 复核轮数补偿：待测固定档位列表（缺省 = 不开本段）。
    partyChecksRounds: [],
    // §62 跨运行样本复用量化（S4）：结构化重叠测量，不额外跑仿真。
    reuseStudy: false,
    // §61 成本分解（S1）：T 曲线小时点 / 每点复测次数 / 每次评估场数 / 并行度曲线规模与工人数。
    timingStudy: false,
    timingHours: [1, 4, 8, 12, 24],
    timingReps: 3,
    timingEvalSeeds: 4,
    timingCurveKeys: 12,
    timingCurveSeeds: 6,
    timingWorkers: [1, 2, 4, 8, 12, 16],
    // §54 worker realm 复用对照：只跑该段并提前返回（不进入批量采样）。realmSeeds = 对照场数。
    realmStudy: false,
    realmSeeds: 16,
  };
  for (const token of argv) {
    const match = /^--([\w-]+)=(.+)$/.exec(token);
    if (!match) continue;
    const [, key, raw] = match;
    if (key === 'slots') args.slots = raw.split(',').map(Number).filter(Number.isFinite);
    else if (key === 'refine-family') args.refineFamily = raw;
    else if (key === 'refine-steps') args.refineSteps = raw.split(',').map(Number).filter(Number.isFinite);
    else if (key === 'coverage-family') args.coverageFamily = raw;
    else if (key === 'coverage-percents') args.coveragePercents = raw.split(',').map(Number).filter(Number.isFinite);
    else if (key === 'zone') args.zone = raw;
    else if (key === 'cross-zones')
      args.crossZones =
        raw === '0'
          ? []
          : raw
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean);
    else if (key === 'probe') args.probe = raw !== '0';
    else if (key === 'party') args.party = raw;
    else if (key === 'party-stats') args.partyStats = raw !== '0';
    else if (key === 'party-stats-rounds') args.partyStatsRounds = raw.split(',').map(Number).filter(Number.isFinite);
    else if (key === 'party-checks') args.partyChecks = raw !== '0';
    else if (key === 'party-checks-rounds') args.partyChecksRounds = raw.split(',').map(Number).filter(Number.isFinite);
    else if (key === 'reuse-study') args.reuseStudy = raw !== '0';
    else if (key === 'timing-study') args.timingStudy = raw !== '0';
    else if (key === 'timing-hours') args.timingHours = raw.split(',').map(Number).filter(Number.isFinite);
    else if (key === 'timing-workers') args.timingWorkers = raw.split(',').map(Number).filter(Number.isFinite);
    else if (key === 'timing-reps') args.timingReps = Number(raw);
    else if (key === 'timing-eval-seeds') args.timingEvalSeeds = Number(raw);
    else if (key === 'timing-curve-keys') args.timingCurveKeys = Number(raw);
    else if (key === 'timing-curve-seeds') args.timingCurveSeeds = Number(raw);
    else if (key === 'realm-study') args.realmStudy = raw !== '0';
    else if (key === 'realm-seeds') args.realmSeeds = Number(raw);
    else args[key] = Number(raw);
  }
  return args;
}

// 确定性 LCG（试验切分可复现；引擎随机流由 payload.seed 单独控制，互不干扰）。
function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shuffle(list, rng) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 函数声明（不是 const 箭头）：顶层 await main() 在模块求值中途执行，const 声明会进 TDZ。
function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

// worker_threads 静态分片收集：targets = [{ key, payload, seeds }]，每片一进一出两条消息。
function collectSamples(engineUrl, metricsContext, targets, workerCount) {
  const slices = Array.from({ length: Math.max(1, workerCount) }, () => []);
  targets.forEach((target, index) => slices[index % Math.max(1, workerCount)].push(target));
  const collected = new Map();
  return Promise.all(
    slices
      .filter((slice) => slice.length > 0)
      .map(
        (slice) =>
          new Promise((resolveJob, rejectJob) => {
            const worker = new Worker(new URL(import.meta.url), { workerData: { engineUrl, metricsContext } });
            worker.on('message', (message) => {
              if (message?.error) {
                rejectJob(new Error(message.error));
                return;
              }
              for (const result of message.results || []) collected.set(result.key, result.samples);
              worker.terminate();
              resolveJob();
            });
            worker.on('error', rejectJob);
            worker.postMessage({ jobs: slice });
          }),
      ),
  ).then(() => collected);
}

// ── §54 worker realm 复用对照的测量器（2026-09-27，设计 §54）────────────────────
// 生产形态：evaluatePayload 逐个种子调 runSingleSimulationPayloadWithDedicatedWorker，
// 每次调用都 `new Worker` 一个全新 realm → 跑 **1 场** → terminate（workerClient.js 的
// startSimulation 语义）。本测量器把一批种子按 groupSize 分组跑完：组内串行 await（与生产
// evaluatePayload 的逐种子循环同款），组间 terminate 且不 await（与生产 stopSimulation 的
// fire-and-forget 同款，让下一组的启动与上一组的销毁重叠）。
//   groupSize = 1            ⇒ 每场一个新 realm（当前生产形态 F）
//   groupSize = args.rounds  ⇒ 一次评估一个 realm（拟实施形态 E）
//   groupSize = seeds.length ⇒ 单 realm 跑满（固定开销参照 R）
// 返回逐场耗时、原始 simResult（parity 自证）与 collectMetrics 样本。
async function measureRealmPass({ engineUrl, metricsContext, payload, seeds, groupSize }) {
  const perSimMs = [];
  const simResults = [];
  const samples = [];
  const pendingTerminations = [];
  const groups = [];
  for (let index = 0; index < seeds.length; index += groupSize) {
    groups.push(seeds.slice(index, index + groupSize));
  }
  for (const group of groups) {
    // worker 入口必须是**本文件**（它的 !isMainThread 分支再动态 import engineUrl 跑引擎）——
    // 不能直接把 engineUrl 当入口：那是纯引擎 bundle，没有消息循环，进程会立刻退出。
    // Node 的 Worker 又只接受绝对路径或 URL 对象，本文件用 import.meta.url 包一层。
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { engineUrl, metricsContext, returnRaw: true },
    });
    let settle = null;
    let failure = null;
    worker.on('message', (message) => {
      const handler = settle;
      settle = null;
      handler?.(message);
    });
    worker.on('error', (error) => {
      failure = error;
      const handler = settle;
      settle = null;
      handler?.({ error: error?.stack || String(error) });
    });
    for (const seed of group) {
      if (failure) throw failure;
      const startedAt = performance.now();
      const message = await new Promise((resolveMessage) => {
        settle = resolveMessage;
        worker.postMessage({ jobs: [{ key: `realm|${seed}`, payload: { ...payload, seed }, seeds: [seed] }] });
      });
      const elapsedMs = performance.now() - startedAt;
      if (message?.error) throw new Error(`realm 对照：worker 报错\n${message.error}`);
      const result = message?.results?.[0] ?? null;
      perSimMs.push(elapsedMs);
      simResults.push(result?.simResults?.[0] ?? null);
      samples.push(result?.samples?.[0] ?? null);
    }
    pendingTerminations.push(worker.terminate());
  }
  await Promise.all(pendingTerminations);
  return { perSimMs, simResults, samples, groupCount: groups.length };
}

// 逐位比较用的规范化序列化（键排序；数值原样书写）：JSON.stringify 会把 NaN/Infinity 落成
// null，两种坏值就「看起来相等」了 —— parity 自证不接受这种模糊。
function stableStringify(value) {
  if (typeof value === 'number') return `n:${String(value)}`;
  if (typeof value === 'string') return `s:${JSON.stringify(value)}`;
  if (typeof value === 'boolean') return `b:${String(value)}`;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return `${typeof value}:${String(value)}`;
}

// 中位数（§60 σ 汇总用；只吃有限值）。
function median(values) {
  const list = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (list.length === 0) return NaN;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 === 1 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

// 最小二乘直线拟合（§61 T 曲线；x = 模拟小时，y = ms/场）。
function fitLine(points) {
  const valid = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const n = valid.length;
  if (n < 2) return { slope: NaN, intercept: NaN, n };
  const sx = valid.reduce((sum, point) => sum + point.x, 0);
  const sy = valid.reduce((sum, point) => sum + point.y, 0);
  const sxx = valid.reduce((sum, point) => sum + point.x * point.x, 0);
  const sxy = valid.reduce((sum, point) => sum + point.x * point.y, 0);
  const denominator = n * sxx - sx * sx;
  if (denominator === 0) return { slope: NaN, intercept: NaN, n };
  const slope = (n * sxy - sx * sy) / denominator;
  return { slope, intercept: (sy - slope * sx) / n, n };
}

// ── §61 成本分解测量器（S1，2026-09-27）─────────────────────────────────────
// 单独测一次「new Worker → 引擎就绪」：worker 加载完引擎后回一条 ready（模块级协议见文件顶部
// worker 分支）。terminations 收集 terminate() promise，避免 fire-and-forget 的 worker 泄漏。
async function measureRealmStart({ engineUrl, metricsContext, terminations }) {
  const startedAt = performance.now();
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { engineUrl, metricsContext, reportReady: true },
  });
  await new Promise((resolveReady, rejectReady) => {
    let settled = false;
    worker.on('message', (message) => {
      if (!settled && message?.ready) {
        settled = true;
        resolveReady();
      }
    });
    worker.on('error', (error) => {
      if (!settled) {
        settled = true;
        rejectReady(error);
      }
    });
  });
  const elapsedMs = performance.now() - startedAt;
  terminations.push(worker.terminate());
  return elapsedMs;
}

// 一次「生产形态评估」的分阶段耗时：realm 启动（new Worker → 就绪）/ postMessage 往返 /
// 引擎 runPayload（逐场，worker 侧上报）/ collectMetrics（逐场，worker 侧上报）。
// 往返里含消息序列化、调度与样本回传的反序列化；主线程侧 payload 构建由调用方另行计时。
async function measureTimedEvaluation({ engineUrl, metricsContext, payload, seeds, terminations }) {
  const realmStartedAt = performance.now();
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { engineUrl, metricsContext, reportReady: true, reportTiming: true },
  });
  const inbox = [];
  let failure = null;
  let wake = null;
  worker.on('message', (message) => {
    inbox.push(message);
    const resolveWake = wake;
    wake = null;
    resolveWake?.();
  });
  worker.on('error', (error) => {
    failure = error;
    const resolveWake = wake;
    wake = null;
    resolveWake?.();
  });
  const waitMessage = async () => {
    while (inbox.length === 0) {
      if (failure) throw failure;
      await new Promise((resolveWait) => {
        wake = resolveWait;
      });
    }
    return inbox.shift();
  };
  const ready = await waitMessage();
  assert.ok(ready?.ready === true, '成本分解：realm 未按预期就绪（ready 消息缺失）');
  const realmStartMs = performance.now() - realmStartedAt;
  const messageStartedAt = performance.now();
  worker.postMessage({ jobs: [{ key: 'timing', payload, seeds }] });
  const message = await waitMessage();
  const messageMs = performance.now() - messageStartedAt;
  if (message?.error) throw new Error(`成本分解：worker 报错\n${message.error}`);
  // worker 回的是 { results: [jobResult] } 外层包（与 collectSamples 同构），这里按单 job 解包。
  const result = message?.results?.[0] ?? null;
  const timings = Array.isArray(result?.timings) ? result.timings : [];
  assert.equal(timings.length, seeds.length, '成本分解：worker 未回传全部逐场计时');
  const runMs = timings.map((entry) => entry.runMs);
  const metricsMs = timings.map((entry) => entry.metricsMs);
  const roundtripMs =
    messageMs - runMs.reduce((sum, value) => sum + value, 0) - metricsMs.reduce((sum, value) => sum + value, 0);
  terminations.push(worker.terminate());
  return { realmStartMs, messageMs, runMs, metricsMs, roundtripMs, mainWallMs: realmStartMs + messageMs };
}

// ── §61 成本分解主流程（S1，2026-09-27）────────────────────────────────────
// 问题：§20.3 的成本模型（0.66s 固定 + 0.18s/模拟小时，2026-09-20 串行标定）早于 §54/§55/§56
// 的批量 realm / 并行度自适应 —— 「钱花在哪」没有一张实测分解表。只读量化，生产零改动：
//   T1 T 曲线：T = --timing-hours（默认 1/4/8/12/24）× reps 次「一次评估」，拟合
//      每场墙钟 = intercept + slope × T；判据：|slope − 180ms| ≥ 20% × 180 ⇒ 老模型失效（写档新值）。
//   T2 阶段分解：realm 启动 / payload 构建 / 引擎 runPayload / collectMetrics / postMessage 往返；
//      判据：任一阶段 ≥ 20% 单场总成本（在 T = args.hours 点判定）⇒ 列为可优化点。
//   T3 并行度曲线：workers ∈ --timing-workers（默认 1/2/4/8/12/16，钳到 availableParallelism）的
//      场/s；判据：> 8 工人收益 < 5% ⇒ 关闭「worker 池化 / 提上限」方向。
//   T4 主线程占用率：performance.eventLoopUtilization（主线程事件循环）；判据：曲线各点最大 ≥ 50%
//      ⇒ 主线程列为并列可优化点（食物优化器的教训：主线程才是关键路径）。
async function runTimingStudy({
  engine,
  engineUrl,
  playerConfig,
  preferredPlayerId,
  simulationSettings,
  baselinePayload,
  seeds,
  slotContexts,
  args,
}) {
  const metricsContext = { preferredPlayerId, pricingOptions: {} };
  const eluSupported = typeof performance.eventLoopUtilization === 'function';
  const terminations = [];
  const evalSeedCount = Math.max(2, Math.floor(args.timingEvalSeeds) || 4);
  const hoursList = [...new Set(args.timingHours.filter((value) => Number.isFinite(value) && value > 0))].sort(
    (a, b) => a - b,
  );
  if (hoursList.length === 0) hoursList.push(args.hours);
  const maxWorkers = availableParallelism();
  console.log('');
  console.log(
    `§61 成本分解（S1）：T = ${hoursList.join('/')}h × ${Math.max(1, args.timingReps)} 复 × ${evalSeedCount} 场/评估；` +
      `机器并行度 ${maxWorkers}；工作负载 = 基线 payload（与主采样同夹具 / 区域 / 难度）`,
  );

  // ① realm 启动（隔离测量：new Worker → 引擎就绪，不含模拟）
  const realmStartSamples = [];
  for (let index = 0; index < 6; index += 1) {
    realmStartSamples.push(await measureRealmStart({ engineUrl, metricsContext, terminations }));
  }
  console.log(
    `  realm 启动（new Worker → 引擎就绪）：${realmStartSamples.length} 次，均值 ${mean(realmStartSamples).toFixed(
      0,
    )} ms，最小 ${Math.min(...realmStartSamples).toFixed(0)} / 最大 ${Math.max(...realmStartSamples).toFixed(0)} ms`,
  );

  // ② T 曲线 + 阶段分解
  const points = [];
  for (const hours of hoursList) {
    const settingsForHours = { ...simulationSettings, simulationTimeHours: hours };
    const buildSamples = [];
    let payload = null;
    for (let index = 0; index < 3; index += 1) {
      const buildStartedAt = performance.now();
      payload = engine.buildCandidatePayload(playerConfig, settingsForHours, undefined, null);
      buildSamples.push(performance.now() - buildStartedAt);
    }
    const evalSeeds = seeds.slice(0, evalSeedCount);
    const realmStarts = [];
    const runList = [];
    const metricsList = [];
    const roundtripList = [];
    const wallList = [];
    for (let rep = 0; rep < Math.max(1, args.timingReps); rep += 1) {
      const measured = await measureTimedEvaluation({
        engineUrl,
        metricsContext,
        payload,
        seeds: evalSeeds,
        terminations,
      });
      realmStarts.push(measured.realmStartMs);
      runList.push(...measured.runMs);
      metricsList.push(...measured.metricsMs);
      roundtripList.push(measured.roundtripMs);
      wallList.push(measured.mainWallMs);
    }
    const point = {
      hours,
      buildMs: mean(buildSamples),
      realmStartMs: mean(realmStarts),
      runMs: mean(runList),
      metricsMs: mean(metricsList),
      roundtripMs: mean(roundtripList) / evalSeeds.length,
      wallPerSim: mean(wallList) / evalSeeds.length,
    };
    points.push(point);
    console.log(
      `  T=${hours}h：墙钟 ${point.wallPerSim.toFixed(0)} ms/场｜realm ${point.realmStartMs.toFixed(
        0,
      )} + 引擎 ${point.runMs.toFixed(0)} + 聚合 ${point.metricsMs.toFixed(0)} + 往返 ${point.roundtripMs.toFixed(
        1,
      )}（按 ${evalSeeds.length} 场/评估摊薄）｜payload 构建 ${point.buildMs.toFixed(1)} ms`,
    );
  }
  const wallFit = fitLine(points.map((point) => ({ x: point.hours, y: point.wallPerSim })));
  const engineFit = fitLine(points.map((point) => ({ x: point.hours, y: point.runMs })));
  const slopeDeviation = Number.isFinite(wallFit.slope) ? Math.abs(wallFit.slope - 180) / 180 : NaN;
  const interceptDeviation = Number.isFinite(wallFit.intercept) ? Math.abs(wallFit.intercept - 660) / 660 : NaN;
  console.log(
    `  T 曲线拟合（ms/场）：墙钟 = ${Number.isFinite(wallFit.intercept) ? wallFit.intercept.toFixed(0) : '—'} + ${
      Number.isFinite(wallFit.slope) ? wallFit.slope.toFixed(1) : '—'
    } × T｜引擎侧 = ${Number.isFinite(engineFit.intercept) ? engineFit.intercept.toFixed(0) : '—'} + ${
      Number.isFinite(engineFit.slope) ? engineFit.slope.toFixed(1) : '—'
    } × T`,
  );
  console.log(
    `    对照 §20.3 老模型 660 + 180 × T（2026-09-20 串行标定）：斜率偏差 ${
      Number.isFinite(slopeDeviation) ? `${(slopeDeviation * 100).toFixed(1)}%` : '—'
    }，截距偏差 ${Number.isFinite(interceptDeviation) ? `${(interceptDeviation * 100).toFixed(1)}%` : '—'}`,
  );

  // ③ 阶段占比（T = args.hours 点判定；含 payload 构建，分母 = 单场总成本）
  const focus = points.reduce(
    (best, point) => (Math.abs(point.hours - args.hours) < Math.abs(best.hours - args.hours) ? point : best),
    points[0],
  );
  const stageRows = [
    { label: 'realm 启动', ms: focus.realmStartMs / evalSeedCount },
    { label: 'payload 构建', ms: focus.buildMs / evalSeedCount },
    { label: '引擎 runPayload', ms: focus.runMs },
    { label: 'collectMetrics', ms: focus.metricsMs },
    { label: 'postMessage 往返', ms: focus.roundtripMs },
  ];
  const stageTotal = stageRows.reduce((sum, row) => sum + row.ms, 0);
  const hotStages = [];
  console.log(`  阶段分解（T=${focus.hours}h，单场摊薄，占比 ≥ 20% 记为可优化点）：`);
  for (const row of stageRows) {
    const share = stageTotal > 0 ? row.ms / stageTotal : NaN;
    if (Number.isFinite(share) && share >= 0.2) hotStages.push(row.label);
    console.log(
      `    ${row.label.padEnd(18)}${row.ms.toFixed(1).padStart(9)} ms${(share * 100).toFixed(1).padStart(8)}%`,
    );
  }

  // ④ 并行度曲线 + 主线程占用率
  const curvePayloads = [{ key: 'baseline', payload: baselinePayload }];
  const interleaved = [];
  const maxPool = Math.max(...slotContexts.map((slot) => slot.candidates.length));
  for (let index = 0; index < maxPool; index += 1) {
    for (const slot of slotContexts) {
      if (slot.candidates[index]) interleaved.push({ slot, candidate: slot.candidates[index] });
    }
  }
  for (const entry of interleaved) {
    if (curvePayloads.length >= Math.max(2, args.timingCurveKeys)) break;
    curvePayloads.push({
      key: `${entry.slot.slotIndex}|${entry.candidate.signature}`,
      payload: engine.buildCandidatePayload(playerConfig, simulationSettings, undefined, entry.candidate),
    });
  }
  const curveSeeds = seeds.slice(0, Math.max(2, args.timingCurveSeeds));
  const curveTargets = curvePayloads.map((entry) => ({ key: entry.key, payload: entry.payload, seeds: curveSeeds }));
  const workerCounts = [
    ...new Set(
      args.timingWorkers
        .filter((value) => Number.isFinite(value) && value >= 1)
        .map((value) => Math.min(Math.floor(value), maxWorkers)),
    ),
  ].sort((a, b) => a - b);
  // 预热：首个 worker 仍要付模块加载的冷启动（esbuild 产物已缓存）；预热不入账。
  await collectSamples(
    engineUrl,
    metricsContext,
    curveTargets.slice(0, 2).map((entry) => ({ ...entry, seeds: curveSeeds.slice(0, 2) })),
    2,
  );
  const curve = [];
  const eluSamples = [];
  console.log(
    `  并行度曲线（${curvePayloads.length} 场景 × ${curveSeeds.length} 轮 = ${curveTargets.length * curveSeeds.length} 场/点）：`,
  );
  for (const workers of workerCounts) {
    const eluBefore = eluSupported ? performance.eventLoopUtilization() : null;
    const startedAt = performance.now();
    await collectSamples(engineUrl, metricsContext, curveTargets, workers);
    const wallMs = performance.now() - startedAt;
    const utilization = eluBefore ? performance.eventLoopUtilization(eluBefore).utilization : NaN;
    const rate = (curveTargets.length * curveSeeds.length) / (wallMs / 1000);
    curve.push({ workers, wallMs, rate, utilization });
    if (Number.isFinite(utilization)) eluSamples.push(utilization);
    console.log(
      `    ${String(workers).padStart(2)} 工人：${(wallMs / 1000).toFixed(1)}s → ${rate.toFixed(1)} 场/s（相对 ${
        curve[0].workers
      } 工人 ×${(rate / curve[0].rate).toFixed(2)}）｜主线程占用率 ${
        Number.isFinite(utilization) ? `${(utilization * 100).toFixed(1)}%` : '—'
      }`,
    );
  }
  const base8 = [...curve].filter((point) => point.workers <= 8).pop() ?? null;
  const above8 = curve.filter((point) => point.workers > 8);
  const bestAbove8 = above8.length ? above8.reduce((best, point) => (point.rate > best.rate ? point : best)) : null;
  const gainAbove8 = base8 && bestAbove8 ? bestAbove8.rate / base8.rate - 1 : NaN;
  const maxElu = eluSamples.length > 0 ? Math.max(...eluSamples) : NaN;
  const gateT1 = Number.isFinite(slopeDeviation) && slopeDeviation >= 0.2;
  const gateT2 = hotStages.length > 0;
  const gateT3 = !bestAbove8 || (Number.isFinite(gainAbove8) && gainAbove8 < 0.05);
  const gateT4 = Number.isFinite(maxElu) && maxElu >= 0.5;
  console.log('  预注册判据（S1，开跑前写死）：');
  console.log(
    `    T1 成本斜率偏差 ${Number.isFinite(slopeDeviation) ? `${(slopeDeviation * 100).toFixed(1)}%` : '—'} ⇒ ${
      gateT1
        ? `≥ 20% ⇒ 老成本模型失效，重标定为 ${wallFit.intercept.toFixed(0)} + ${wallFit.slope.toFixed(1)} × T ms/场`
        : '< 20% ⇒ 老斜率仍可用'
    }`,
  );
  console.log(
    `    T2 阶段占比 ⇒ ${gateT2 ? `过线（≥ 20%）：${hotStages.join(' / ')}，列为可优化点` : '无阶段 ≥ 20%，无需专项'}`,
  );
  console.log(
    `    T3 并行度 ⇒ ${base8 ? base8.workers : '—'} 工人 ${base8 ? base8.rate.toFixed(1) : '—'} 场/s vs ${
      bestAbove8 ? `${bestAbove8.workers}` : '—'
    } 工人 ${bestAbove8 ? bestAbove8.rate.toFixed(1) : '—'} 场/s（收益 ${
      Number.isFinite(gainAbove8) ? `${(gainAbove8 * 100).toFixed(1)}%` : '不可测'
    }）⇒ ${gateT3 ? '收益 < 5% ⇒ 关闭「worker 池化 / 提上限」方向' : '收益 ≥ 5% ⇒ 保留池化候选'}`,
  );
  console.log(
    `    T4 主线程占用率（曲线各点最大）${Number.isFinite(maxElu) ? `${(maxElu * 100).toFixed(1)}%` : '—'} ⇒ ${
      gateT4 ? '≥ 50% ⇒ 主线程列为并列优化点' : '未过 50%'
    }`,
  );
  await Promise.all(terminations);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const screenRounds = 2; // 与 TRIGGER_OPTIMIZER_SCREEN_ROUNDS 同步（打包后从引擎读真值）
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const output = join(tmpdir(), 'mwi-trigger-optimizer-racing-study');
  await mkdir(output, { recursive: true });
  const { build } = await import('esbuild');
  await build({
    absWorkingDir: root,
    entryPoints: { engine: 'scripts/trigger-optimizer-racing-study.engine.mjs' },
    outdir: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    outExtension: { '.js': '.mjs' },
    logLevel: 'silent',
  });
  const engineUrl = pathToFileURL(resolve(output, 'engine.mjs')).href;
  const engine = await import(engineUrl);
  const SCREEN = engine.TRIGGER_OPTIMIZER_SCREEN_ROUNDS;
  const KEEP = engine.TRIGGER_OPTIMIZER_RACING_KEEP;
  const MIN_POOL = engine.TRIGGER_OPTIMIZER_RACING_MIN_POOL;
  const REFINEMENT_LEVELS = engine.TRIGGER_OPTIMIZER_REFINEMENT_MAX_LEVELS;
  assert.equal(screenRounds, SCREEN, '研究常量与生产 TRIGGER_OPTIMIZER_SCREEN_ROUNDS 漂移');
  // 精炼的级数上限就是成本护栏（每级 ≤2 次评估）：研究按 4 级、8 次评估的上界做同预算对照。
  assert.equal(REFINEMENT_LEVELS, 4, '研究假设的精炼级数上限（成本护栏）漂移');
  assert(
    args.seeds >= args.rounds + SCREEN + 2,
    `--seeds 至少要 rounds + 粗筛 ${SCREEN} + 留出 2 = ${args.rounds + SCREEN + 2}`,
  );

  // ── 研究输入：玩家夹具固定（与 §20.1/§29.8 同一角色），区域/难度用 --zone/--tier 切换 ──
  //（§36 的「换区域」就是换 --zone：怪物血量结构随区域变，阈值网格的适配问题在区域侧）。
  const simulationSettings = {
    mode: 'zone',
    runScope: 'single',
    useDungeon: false,
    zoneHrid: args.zone,
    dungeonHrid: '',
    difficultyTier: args.tier,
    labyrinthHrid: '',
    roomLevel: 100,
    simulationTimeHours: args.hours,
    mooPass: false,
    comExpEnabled: false,
    comExp: 1,
    comDropEnabled: false,
    comDrop: 1,
    enableHpMpVisualization: false,
  };
  const settings = engine.normalizeTriggerOptimizerSettings({ maxRounds: 1, candidateLimit: 20, rounds: args.rounds });
  const weights = settings.objectiveWeights;
  const imported = engine.importSoloConfig(
    JSON.stringify(engine.modernPlayerJunglePlanetFixture),
    engine.createEmptyPlayerConfig(1),
    simulationSettings,
  );
  const playerConfig = { ...imported.player, id: '1', selected: true };
  const preferredPlayerId = '1';

  // 与搜索层同一条链：基线 payload → resolveOptimizerResources → buildCandidateConfigs。
  const baselinePayload = engine.buildCandidatePayload(playerConfig, simulationSettings, undefined, null);
  const resources = engine.resolveOptimizerResources(baselinePayload, preferredPlayerId);
  assert(resources, 'resolveOptimizerResources 失败：夹具/区域组合不再产出战斗属性');
  const choices = engine.buildCandidateConfigs(playerConfig, { ...settings, resources });

  // 区域侦察（--probe=1）：只打印该区域/难度的怪物血量结构与各槽候选规模，**不采样** ——
  // 用它挑「血量结构不同」的区域跑 §36（单怪图 waveSize=1 vs 多怪图、min/group 比例等）。
  if (args.probe) {
    console.log(
      `区域 ${args.zone} tier ${args.tier}：enemyHp = ${JSON.stringify(resources.enemyHp)}` +
        `｜玩家 maxHp=${resources.maxHp} maxMp=${resources.maxMp}`,
    );
    for (const choice of choices) {
      console.log(
        `  槽 ${choice.slotIndex}（${choice.abilityHrid}，${choice.role}）：候选 ${choice.candidates.length} 条（生成 ${choice.generatedCandidates}）`,
      );
    }
    return;
  }
  const seeds = engine.createTriggerOptimizerSeedSet({
    playerId: preferredPlayerId,
    playerConfig,
    simulationSettings,
    salt: 'trigger-optimizer.racing-study.v1',
    count: args.seeds,
  });

  // ── §54 对照段：worker realm 复用（模拟速度，2026-09-27）─────────────────────
  // 研究问题：生产每跑**一场**模拟就新建一个 worker realm（triggerOptimizerSimulation.js 的
  // evaluatePayload 逐种子调 runSingleSimulationPayloadWithDedicatedWorker → new Worker →
  // 1 场 → terminate）。把「一次评估内的 N 个种子」收进同一个 realm，能不能在**结果逐位不变**
  // 的前提下省掉这份固定开销？
  // 三臂 + 复测（同一夹具、同一 payload、同一批种子；全部串行以隔离单场成本）：
  //   F  每场新 realm（= 当前生产形态）
  //   E  每评估一个 realm（= 拟实施形态；按 --rounds 分组、组内种子串行）
  //   R  单 realm 跑满全部种子（固定开销的参照/上界）
  //   F2 复测（机器负载/热漂移会让单次测量不可信，用 F↔F2 差值自证）
  // 预注册判据（本轮开跑前写死，不由结果反推）：
  //   G1（硬门槛·安全性）F 与 E 在同一 (payload, seed) 上的 simResult 逐位相同；任一不等
  //                      ⇒ 引擎在复用 realm 下有跨模拟状态 ⇒ 放弃实施。
  //   G2（机制大小）      mean(F) − mean(E) ≥ 5% × mean(F)（否则没有收益可分）。
  //   G3（决策门槛）      按生产标准 4h 调用图（676 场 / 85 评估 / 并行 4；§20.4 实测基准
  //                      墙钟 190.4s）投影省时 ≥ 15% ⇒ 值得改生产代码。
  // 诚实边界：node worker_threads ≠ 浏览器 Worker —— 本段只证明「机制成立 + 量级」；生产收益
  // 以应用内 A/B（同一设置两次运行：报告核心字段逐位一致 + 已用时间对比）为准。
  if (args.realmStudy) {
    const studySeeds = seeds.slice(0, Math.max(2, args.realmSeeds));
    const realmMetricsContext = { preferredPlayerId, pricingOptions: {} };
    const evalGroupSize = Math.max(1, args.rounds);
    console.log('');
    console.log(
      `§54 worker realm 复用对照开始：${studySeeds.length} 个种子 × ${args.hours}h（同一 payload，仅换 seed）；` +
        `E 臂按 ${evalGroupSize} 场/评估分组`,
    );
    const passes = [
      ['F 每场新 realm（当前生产）', 1],
      [`E 每评估一个 realm（拟实施，${evalGroupSize} 场/组）`, evalGroupSize],
      ['R 单 realm 跑满（参照）', studySeeds.length],
      ['F2 每场新 realm（复测）', 1],
    ];
    const measured = [];
    for (const [label, groupSize] of passes) {
      const passStartedAt = Date.now();
      const pass = await measureRealmPass({
        engineUrl,
        metricsContext: realmMetricsContext,
        payload: baselinePayload,
        seeds: studySeeds,
        groupSize,
      });
      const wallMs = Date.now() - passStartedAt;
      measured.push({ label, groupSize, wallMs, ...pass });
      console.log(
        `  ${label}：${pass.perSimMs.length} 场 / ${(wallMs / 1000).toFixed(1)}s，` +
          `均值 ${mean(pass.perSimMs).toFixed(0)} ms/场（首场 ${pass.perSimMs[0]?.toFixed(0) ?? '—'} ms，` +
          `组数 ${pass.groupCount}）`,
      );
    }
    const [freshPass, evalPass, singlePass, freshAgainPass] = measured;
    // G1：F 与 E 在同一 (payload, seed) 上必须逐位相同（首个不一致的种子位置上报）。
    let parityMismatch = -1;
    for (let index = 0; index < studySeeds.length; index += 1) {
      if (stableStringify(freshPass.simResults[index]) !== stableStringify(evalPass.simResults[index])) {
        parityMismatch = index;
        break;
      }
    }
    const freshMean = mean(freshPass.perSimMs);
    const evalMean = mean(evalPass.perSimMs);
    const singleMean = mean(singlePass.perSimMs);
    const freshAgainMean = mean(freshAgainPass.perSimMs);
    // 固定开销的两个独立估计：① F−E 的单场差按「E 摊薄了 1/组大小」放大回整份；
    // ② R 的首场（含 realm 启动与模块加载）减去组内其余场的均值。
    const fixedFromDelta =
      evalGroupSize > 1 ? (freshMean - evalMean) * (evalGroupSize / (evalGroupSize - 1)) : freshMean - evalMean;
    const singleRest = singlePass.perSimMs.slice(1);
    const fixedFromSingle = singleRest.length > 0 ? singlePass.perSimMs[0] - mean(singleRest) : NaN;
    const fixedMs = Math.max(0, fixedFromDelta);
    // G3 的投影口径写死（生产标准 4h + 默认并行 4 的历史实测，见 §20.4/§38）：
    //   省时 = (场次 − 评估数) × 每场固定开销 ÷ 并行度；基准 = 190.4s。
    const PROJECTED_SIMS = 676;
    const PROJECTED_EVALS = 85;
    const PROJECTED_WORKERS = 4;
    const BASELINE_SECONDS = 190.4;
    const savedSeconds = ((PROJECTED_SIMS - PROJECTED_EVALS) * fixedMs) / 1000 / PROJECTED_WORKERS;
    const savedPercent = (savedSeconds / BASELINE_SECONDS) * 100;
    const g1 = parityMismatch < 0;
    const g2 = freshMean > 0 && freshMean - evalMean >= 0.05 * freshMean;
    const g3 = savedPercent >= 15;
    console.log('');
    console.log(
      '预注册判据（开跑前写死）：G1 F↔E 同种子 simResult 逐位一致；G2 mean(F) − mean(E) ≥ 5% × mean(F)；' +
        'G3 省时投影 ≥ 15%',
    );
    console.log(
      `G1 ${g1 ? '通过' : `失败（第 ${parityMismatch} 个种子起不一致）`}｜F↔E parity ${
        g1 ? `${studySeeds.length}/${studySeeds.length} 逐位一致` : '存在不一致'
      }`,
    );
    console.log(
      `G2 ${g2 ? '通过' : '失败'}｜mean(F) ${freshMean.toFixed(0)} vs mean(E) ${evalMean.toFixed(0)} ms/场` +
        `（差 ${(freshMean - evalMean).toFixed(0)} ms，${(((freshMean - evalMean) / freshMean) * 100).toFixed(1)}%）`,
    );
    console.log(
      `  每场固定开销估计：F−E 放大 ${Number.isFinite(fixedFromDelta) ? fixedFromDelta.toFixed(0) : '—'} ms｜` +
        `R 首场−其余均值 ${Number.isFinite(fixedFromSingle) ? fixedFromSingle.toFixed(0) : '—'} ms`,
    );
    console.log(
      `  复测稳定性：F ${freshMean.toFixed(0)} vs F2 ${freshAgainMean.toFixed(0)} ms/场` +
        `（差 ${Math.abs(freshMean - freshAgainMean).toFixed(0)} ms）｜R（单 realm）${singleMean.toFixed(0)} ms/场`,
    );
    console.log(
      `G3 ${g3 ? '通过' : '失败'}｜投影（${PROJECTED_SIMS} 场 / ${PROJECTED_EVALS} 评估 / 并行 ${PROJECTED_WORKERS}）` +
        `省 ${savedSeconds.toFixed(1)}s ≈ 基准 ${BASELINE_SECONDS}s 的 ${savedPercent.toFixed(1)}%`,
    );
    console.log(
      `判读：${
        g1 && g2 && g3
          ? '三条全过 ⇒ 值得实施（装置只证机制与量级；生产收益以应用内 A/B 为准）'
          : '有硬条件未过 ⇒ 按判据不实施'
      }`,
    );
    return;
  }

  const slotContexts = [];
  for (const slotIndex of args.slots) {
    const choice = choices.find((entry) => entry.slotIndex === slotIndex);
    assert(choice, `槽位 ${slotIndex} 不在候选生成结果里`);
    assert(
      engine.isRacingPool(choice.candidates.length),
      `槽位 ${slotIndex} 候选池 ${choice.candidates.length} ≤ ${MIN_POOL}：不是 racing 场景，选别的槽`,
    );
    slotContexts.push({
      slotIndex,
      abilityHrid: choice.abilityHrid,
      role: choice.role,
      candidates: choice.candidates,
      // 过 candidateLimit **之前**的条数（§28 的截断透明化字段）：截断代价分析（§34）要用。
      generated: choice.generatedCandidates,
    });
  }

  // ── §61 成本分解（S1，2026-09-27；只读量化，生产零改动）────────────────────────
  // 口径与预注册判据见 runTimingStudy 头注释与输出段；默认关闭，随 --timing-study=1 开启。
  if (args.timingStudy) {
    await runTimingStudy({
      engine,
      engineUrl,
      playerConfig,
      preferredPlayerId,
      simulationSettings,
      baselinePayload,
      seeds,
      slotContexts,
      args,
    });
  }

  // ── 精炼步长对照研究：把目标家族在 1pp 分辨率上的真实响应曲线采出来 ─────────
  // 研究问题（设计 §32）：**同预算**（级数上限不变、每级 ≤2 次评估）下，生产的步长序列
  // 10/5/5/5（下限 5pp）与对照序列（--refine-steps，默认 10/5/2/1，2026-09-24 被否决的二分）
  // 哪条行走规则落到的阈值真实分更高。做法：用生产 buildRefinedCandidates 把该家族的可达阈值在
  // 1pp 网格上全展开（每个新节点的邻居仍由生产函数生成 ⇒ 采样点与行走实际会评估的点逐字节一致），
  // 逐点真实采样，再把两条行走规则在同一批样本上回放（同起点、同参考系、同决策种子，唯一差别是
  // 每级步长），并对齐自检「对照臂取点 = 生产生成的候选」。
  const refineStudy = (() => {
    const labelKey = `common:triggerOptimizer.candidate.${args.refineFamily}`;
    const slot = slotContexts.find((entry) => entry.candidates.some((candidate) => candidate.labelKey === labelKey));
    assert(slot, `--refine-family=${args.refineFamily} 在槽 ${args.slots.join('/')} 里没有候选（换家族或 --slots）`);
    const familyCandidates = slot.candidates.filter((candidate) => candidate.labelKey === labelKey);
    const ctx = { slotIndex: slot.slotIndex, abilityHrid: slot.abilityHrid, role: slot.role, candidates: [] };
    const bySignature = new Map();
    const queue = [familyCandidates[0]];
    while (queue.length > 0) {
      const node = queue.shift();
      if (bySignature.has(node.signature)) continue;
      bySignature.set(node.signature, node);
      for (let level = 0; level < REFINEMENT_LEVELS; level += 1) {
        for (const probe of engine.buildRefinedCandidates(node, ctx, resources, { level })) {
          if (!bySignature.has(probe.signature)) queue.push(probe);
        }
      }
    }
    // 百分比读数：percent 类标签直接用插值参数；绝对值类（敌方血量）由生产的 ±10pp 邻域反推尺度
    // ——不在研究脚本里写死换算表（写死就等于测另一套口径）。
    const hasPercentParams = familyCandidates.every((candidate) =>
      Number.isFinite(Number(candidate.labelParams?.percent)),
    );
    let unitsPerPercent = 0;
    if (!hasPercentParams) {
      const scaleSeed = familyCandidates.find(
        (candidate) => engine.buildRefinedCandidates(candidate, ctx, resources, { level: 0 }).length === 2,
      );
      assert(scaleSeed, `家族 ${args.refineFamily} 的 ±10pp 邻域两侧都被 clamp：反推不出百分比尺度`);
      const probeValues = engine
        .buildRefinedCandidates(scaleSeed, ctx, resources, { level: 0 })
        .map((candidate) => Number(candidate.labelParams.value))
        .sort((a, b) => a - b);
      unitsPerPercent = (probeValues[1] - probeValues[0]) / 20;
      assert(unitsPerPercent > 0, `家族 ${args.refineFamily} 的百分比尺度反推失败`);
    }
    const percentOf = (candidate) =>
      hasPercentParams ? Number(candidate.labelParams.percent) : Number(candidate.labelParams.value) / unitsPerPercent;
    const sweepRaw = [...bySignature.values()]
      .filter((candidate) => {
        const percent = percentOf(candidate);
        return percent >= args.refineMin - 1e-9 && percent <= args.refineMax + 1e-9;
      })
      .sort((a, b) => percentOf(a) - percentOf(b));
    // **按整数百分比去重**（2026-09-24，aqua_planet group = 2330 的实测教训）：敌方血量类家族的
    // 精炼走「value → 百分比 → ±step → value」的往返换算（buildRefinementCandidates 的
    // REFINE_ENEMY_HP_SPECS 分支），尺度不是 100 的整数倍时每级都带一点取整漂移 ⇒ BFS 闭包里同一名义
    // 百分比会裂成多个相邻取整值（实测 2116 点坍缩到 38 个整数百分比）。研究只需要每个百分比一个代表
    //（它们只差 ≤12 个绝对值 ≈ 0.5pp），否则采样量按闭包大小爆炸（69568 场）。生产只走 4 级
    // ≤ 8 次评估，不受漂移影响（§24 的口径）。
    const sweepByPercent = new Map();
    for (const candidate of sweepRaw) {
      const percent = Math.round(percentOf(candidate));
      if (!sweepByPercent.has(percent)) sweepByPercent.set(percent, candidate);
    }
    const sweep = [...sweepByPercent.values()].sort((a, b) => percentOf(a) - percentOf(b));
    // 闭包是否被去重压缩过（= 发生过取整漂移）：那时网格取点与生产的 ±step 邻域会差半个格点，
    // §32 的对照臂不可信 —— 跳过它（生产臂与 §36 的网格天花板不受影响）。
    const sweepLossy = sweepByPercent.size !== sweepRaw.length;
    // 起点 = 区间内的 5pp 格点（两条规则都从格点起步；家族的真实网格候选是其中的「现实起点」子集）。
    // 按**四舍五入后的百分比**判格点：去重后的代表可能带小数百分比（取整漂移），用它判会误判空起点。
    const startPoints = sweep.filter((candidate) => Math.round(percentOf(candidate)) % 5 === 0);
    // 起点与行走全程都留在采样区间内：两端各有 clamp（5% / 95%）兜底，越界跳过只可能来自
    // 人为收窄 --refine-min/--refine-max（表格里会报出来，默认区间下必然是 0）。
    const gridSignatures = new Set(familyCandidates.map((candidate) => candidate.signature));
    assert(sweep.length > 0 && startPoints.length > 0, '精炼扫描没有可回放的起点：检查 --refine-family/区间');
    // 网格索引 + 对照臂取点：按 percent ± step 取到**同一批生产候选**（不在脚本里重写换算/
    // 取整口径），clamp 与生产一致（[5,95]）。网格粒度由生产步长决定，见下方 latticeStep。
    const byPercent = new Map();
    for (const candidate of sweep) {
      const percent = Math.round(percentOf(candidate));
      if (!byPercent.has(percent)) byPercent.set(percent, candidate);
    }
    // 对照臂可用性：只有当闭包里每个候选各占一个整数百分比（无取整漂移）时，网格取点才能精确复现
    // 生产的 ±step 邻域。aqua_planet（group = 2330 ⇒ unitsPerPercent = 23.3）会漂移半个格点
    //（1387 vs 1398），那时跳过 §32 的对照臂。
    const controlArmUsable = !sweepLossy;
    const lookupProbes = (base, step, visited) => {
      const center = Math.round(percentOf(base));
      const targets = [center - step, center + step]
        .map((percent) => Math.min(95, Math.max(5, Math.round(percent))))
        .filter((percent) => percent !== center);
      return [...new Set(targets)]
        .map((percent) => byPercent.get(percent))
        .filter((candidate) => candidate && !visited.has(candidate.signature));
    };
    // 生产实测步长（level → 百分点）：在中间起点上量生产函数实际落到的百分点差 —— 报告与
    // 「对照臂取点」的一致性自检都靠它（不写死生产步长，生产改了这里跟着变）。
    const baseForSteps = sweep[Math.floor(sweep.length / 2)];
    const productionSteps = Array.from({ length: REFINEMENT_LEVELS }, (_, level) => {
      const deltas = engine
        .buildRefinedCandidates(baseForSteps, ctx, resources, { level })
        .map((candidate) => Math.abs(percentOf(candidate) - percentOf(baseForSteps)));
      return deltas.length > 0 ? Math.min(...deltas) : 0;
    });
    // 一致性自检：把对照臂的步长设成**生产实测步长**时，两条臂必须取到同一批候选 —— 证明
    // 「网格取点」与生产生成的是同一批对象，对照才成立（收窄窗口会让取点落在窗口外，故跳过）。
    // **两档口径**（2026-09-24，aqua_planet group = 2330 的实测教训）：绝对值类家族的「值 ↔ 百分比」
    // 换算带取整（enemyHpThreshold 会 round），当尺度不是 100 的整数倍（unitsPerPercent = 23.3）时，
    // 同一百分比的两次取整会差 1 个绝对值（757 vs 758）—— 那不是取点漂移。这种情况下退到「同构 +
    // 值差 ≤ 1」的对齐自检，并把两类计数分开打印（逐字节一致的组数 / 取整容差组数）。
    const signatureText = (probes) =>
      probes
        .map((candidate) => candidate.signature)
        .sort()
        .join('|');
    const alignedWithinOneUnit = (left, right) => {
      if (left.length !== right.length) return false;
      const shapeOf = (list) =>
        [...list]
          .map((candidate) => {
            const [trigger] = candidate.triggers;
            return `${trigger.dependencyHrid}|${trigger.conditionHrid}|${trigger.comparatorHrid}`;
          })
          .sort()
          .join('||');
      if (shapeOf(left) !== shapeOf(right)) return false;
      const valuesOf = (list) => list.map((candidate) => Number(candidate.triggers[0].value)).sort((a, b) => a - b);
      const leftValues = valuesOf(left);
      const rightValues = valuesOf(right);
      return leftValues.every((value, index) => Math.abs(value - rightValues[index]) <= 1);
    };
    let alignmentChecks = 0;
    let roundingTolerantChecks = 0;
    if (args.refineMin === 5 && args.refineMax === 95 && controlArmUsable) {
      for (const ratio of [0.25, 0.5, 0.75]) {
        const base = sweep[Math.min(sweep.length - 1, Math.floor(sweep.length * ratio))];
        for (let level = 0; level < REFINEMENT_LEVELS; level += 1) {
          const controlProbes = lookupProbes(base, productionSteps[level], new Set());
          const produced = engine.buildRefinedCandidates(base, ctx, resources, { level });
          if (signatureText(controlProbes) === signatureText(produced)) {
            alignmentChecks += 1;
            continue;
          }
          assert(
            alignedWithinOneUnit(controlProbes, produced),
            `对照臂取点与生产不一致（level ${level}）：${signatureText(controlProbes)} vs ${signatureText(produced)}`,
          );
          roundingTolerantChecks += 1;
        }
      }
    }
    // 采样网格的最小步长（百分点）：BFS 只走**生产步长**，所以网格粒度就是生产能落到的粒度
    //（生产 10/5 下限 5 ⇒ 5pp 网格；只有临时放开下限才会出现 1pp 网格）。对照臂的步长必须落在
    // 这个网格上，否则取不到点 —— 那时明确跳过对照臂并说明原因，不打印退化的对照表。
    const gcd = (a, b) => (b === 0 ? Math.abs(a) : gcd(b, a % b));
    const latticeStep = sweep.reduce((step, candidate, index) => {
      if (index === 0) return step;
      const percent = Math.round(percentOf(candidate));
      const previous = Math.round(percentOf(sweep[index - 1]));
      if (percent === previous) return step;
      return step === 0 ? percent - previous : gcd(step, percent - previous);
    }, 0);
    const altStepsOnLattice =
      latticeStep > 0 &&
      args.refineSteps.every((step) => Number.isInteger(step) && step > 0 && step % latticeStep === 0);
    console.log(
      `精炼扫描（${args.refineFamily} @ 槽 ${slot.slotIndex}）：${sweep.length} 个 ${latticeStep}pp 网格阈值（${percentOf(
        sweep[0],
      ).toFixed(2)}% ~ ${percentOf(sweep[sweep.length - 1]).toFixed(2)}%），回放起点 ${startPoints.length} 个；` +
        `生产实测步长 ${productionSteps.join('/')}pp，对照步长 ${args.refineSteps.join('/')}pp，取点对齐自检 ` +
        `${alignmentChecks + roundingTolerantChecks} 组${
          !controlArmUsable
            ? '（网格取点有损：跳过）'
            : alignmentChecks === 0 && roundingTolerantChecks === 0
              ? '（收窄窗口：跳过）'
              : `（逐字节一致 ${alignmentChecks} 组、取整容差 ≤1 ${roundingTolerantChecks} 组）`
        }`,
    );
    return {
      slotIndex: slot.slotIndex,
      abilityHrid: slot.abilityHrid,
      ctx,
      bySignature,
      sweep,
      startPoints,
      gridSignatures,
      percentOf,
      lookupProbes,
      productionSteps,
      latticeStep,
      altStepsOnLattice,
      controlArmUsable,
    };
  })();

  // ── 候选覆盖缺口：合成「敌方最残血百分比门」（2026-09-24，设计 §33）────────────
  // 缺口：候选生成器里有**队友侧**的百分比门（all_allies + lowest_hp_percentage，见
  // triggerOptimizerCandidates.js 的 defenseCandidates），却**没有敌方侧**同款
  // （all_enemies + lowest_hp_percentage）—— 它在游戏数据里是合法的多目标组合
  // （combatTriggerConditionDetailMap：lowest_hp_percentage = isMultiTarget，比较器 GTE/LTE），
  // 引擎语义 = 「敌方最残血**活体**的血量百分比」（无活体时初值 200%，trigger.js isActiveMultiTarget）。
  // 现有敌方侧候选（enemyGroupHp / enemyTargetHp / executeHp / deadUnits*）都是**另一把尺子**
  // （绝对值换算或人数），没有这条「最残血百分比」门。本段量化它到底有没有杠杆：同一批真实种子上，
  // 族最优的**真实分**能不能超过现有池最优（判据 = TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE）。
  // 候选在本地合成（生产 buildTriggerDto 未导出），但合法性自证与签名格式**都走生产入口**
  // （sanitizeTriggerList / buildTriggerCandidateSignature），不在脚本里手搓会漂移的口径。
  const coverageStudies = (() => {
    const DEPENDENCY_ALL_ENEMIES = '/combat_trigger_dependencies/all_enemies';
    const CONDITION_LOWEST_HP_PERCENTAGE = '/combat_trigger_conditions/lowest_hp_percentage';
    const COMPARATOR_GTE = '/combat_trigger_comparators/greater_than_equal';
    const COMPARATOR_LTE = '/combat_trigger_comparators/less_than_equal';
    const anchorLabelKey = `common:triggerOptimizer.candidate.${args.coverageFamily}`;
    assert(
      Object.values(engine.TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS).includes(anchorLabelKey),
      `--coverage-family=${args.coverageFamily} 不是已知候选家族（对照 TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS）`,
    );
    // 覆盖 --slots 里**所有**含该锚点家族的槽：家族的杠杆可能在某个槽上为 0、另一个槽上不为 0，
    // 单槽结论不得外推（§32 的教训），多槽是同一批采样预算下最便宜的复验。
    const slots = slotContexts.filter((entry) =>
      entry.candidates.some((candidate) => candidate.labelKey === anchorLabelKey),
    );
    assert(
      slots.length > 0,
      `--coverage-family=${args.coverageFamily} 在槽 ${args.slots.join('/')} 里没有候选（换家族或 --slots）`,
    );
    const studies = [];
    for (const slot of slots) {
      const existingSignatures = new Set(slot.candidates.map((candidate) => candidate.signature));
      const sweepSignatures = new Set(refineStudy.sweep.map((candidate) => candidate.signature));
      const candidates = [];
      for (const percent of args.coveragePercents) {
        const value = Math.max(1, Math.min(100, Math.round(percent)));
        for (const [comparatorHrid, directionTag, directionName] of [
          [COMPARATOR_LTE, '≤', '残血门'],
          [COMPARATOR_GTE, '≥', '开局门'],
        ]) {
          // 合法性自证：sanitizeTriggerList 是生产同款入口（依赖/条件/比较器三件套 + 配对检查），
          // 被静默丢弃就说明这条组合在游戏数据里不合法 —— 那时直接失败，绝不拿非法配置去采样。
          const triggers = engine.sanitizeTriggerList([
            {
              dependencyHrid: DEPENDENCY_ALL_ENEMIES,
              conditionHrid: CONDITION_LOWEST_HP_PERCENTAGE,
              comparatorHrid,
              value,
            },
          ]);
          assert.equal(
            triggers.length,
            1,
            `缺口族条目不合法：${DEPENDENCY_ALL_ENEMIES}/${CONDITION_LOWEST_HP_PERCENTAGE}/${comparatorHrid}/${value}`,
          );
          const candidate = {
            slotIndex: slot.slotIndex,
            abilityHrid: slot.abilityHrid,
            role: slot.role,
            state: 'custom',
            triggers,
            signature: engine.buildTriggerCandidateSignature(triggers),
            // 文案沿用队友侧的百分比键（通用百分比文案）：本段只量化杠杆，不改产品文案。
            labelKey: engine.TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS.allyLowHp,
            labelParams: { percent: value },
            distance: 2, // = 生产 DISTANCE_CUSTOM：与角色候选同档改动量
            directionTag,
            directionName,
          };
          assert(!existingSignatures.has(candidate.signature), `缺口族候选与现有候选撞签名：${candidate.signature}`);
          assert(!sweepSignatures.has(candidate.signature), `缺口族候选与精炼扫描撞签名：${candidate.signature}`);
          candidates.push(candidate);
        }
      }
      // 精炼可用性自证：若实施，这条族必须能被生产精炼器继续细分（lowest_hp_percentage 是原始
      // 百分比，生产 buildRefinedCandidates 按 condition 识别、不需要资源换算）—— 纯静态检查，
      // 不占采样预算；±10pp 邻域必须仍落在同一依赖/条件/比较器上。
      const refineCtx = { slotIndex: slot.slotIndex, abilityHrid: slot.abilityHrid, role: slot.role, candidates: [] };
      const probeCandidate = candidates.find(
        (candidate) => Number(candidate.labelParams.percent) >= 15 && Number(candidate.labelParams.percent) <= 85,
      );
      assert(probeCandidate, '缺口族没有能产出 ±10pp 邻域的档位：--coverage-percents 全在区间边缘');
      const probes = engine.buildRefinedCandidates(probeCandidate, refineCtx, resources, { level: 0 });
      assert.equal(probes.length, 2, `缺口族无法被生产精炼器细分（应产出 ±10pp 两条）：${probeCandidate.signature}`);
      assert(
        probes.every(
          (probe) =>
            probe.triggers[0].dependencyHrid === DEPENDENCY_ALL_ENEMIES &&
            probe.triggers[0].conditionHrid === CONDITION_LOWEST_HP_PERCENTAGE &&
            probe.triggers[0].comparatorHrid === probeCandidate.triggers[0].comparatorHrid,
        ),
        '生产精炼器改掉了缺口族的依赖/条件/比较器（该族暂时不可精炼）',
      );
      console.log(
        `候选覆盖缺口（槽 ${slot.slotIndex} ${slot.abilityHrid}，${slot.role}）：合成 ${candidates.length} 条` +
          `「all_enemies + lowest_hp_percentage」候选（${args.coveragePercents.join('/')}% × LTE/GTE），` +
          `合法性自证通过；精炼邻域可用（±10pp，生产 rawPercent 分支）`,
      );
      studies.push({
        slotIndex: slot.slotIndex,
        abilityHrid: slot.abilityHrid,
        role: slot.role,
        existing: slot.candidates,
        candidates,
      });
    }
    return studies;
  })();

  // ── 组合候选缺口：把「已验证的单腿」互相合取（2026-09-24，设计 §35）──────────────
  // 背景：夹具里两个槽的**当前配置本身就是一条组合**（`[敌方活敌数 ≥ 1] AND [敌方总血量 ≥ 500]`），
  // 而生成器的组合候选只做 4 种固定搭配（斩杀×蓝量 / 敌人数×蓝量 / 自身残血×蓝量 / 增益门×敌方总血量，
  // 见 compositeCandidates）。两个从未被测过的方向：
  //   ① 把池里**胜出的单腿**（enemyGroupHp GTE；槽 3 实测池最优 +0.01978 就是它）与「守卫腿」合取 ——
  //      守卫腿包括当前配置自己写的那条（`[活敌数 ≥ 1]`，池里不生成：阈值网格是 2/3）；
  //   ② 与该腿从未搭配过的已有腿（敌人数 / 波内进度 / 增益窗口 / 蓝量）合取。
  // 判据同 §33：组合族最优的真实分要 ≥ 现有池最优 + MIN_ADOPT_SCORE 才值得实施。
  // 先验偏负（§33 的两把尺子都显示「限制越少分越高」，合取只会更严）—— 正因为如此才先量化。
  const compositeStudies = (() => {
    const LK = engine.TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS;
    const CONDITION_CURRENT_HP = '/combat_trigger_conditions/current_hp';
    const DEPENDENCY_ALL_ENEMIES = '/combat_trigger_dependencies/all_enemies';
    const COMPARATOR_GTE = '/combat_trigger_comparators/greater_than_equal';
    const shortHrid = (hrid) =>
      String(hrid || '').replace(/^\/combat_trigger_(dependencies|conditions|comparators)\//, '');
    const describe = (trigger) =>
      `${shortHrid(trigger.dependencyHrid)}·${shortHrid(trigger.conditionHrid)}=${trigger.value}`;
    const sweepSignatures = new Set(refineStudy.sweep.map((candidate) => candidate.signature));
    const coverageSignatures = new Set(
      coverageStudies.flatMap((study) => study.candidates.map((candidate) => candidate.signature)),
    );
    const studies = [];
    for (const slot of slotContexts) {
      const pool = slot.candidates;
      // 胜出单腿：敌方总血量门槛（all_enemies + current_hp + GTE）。
      const hpLegs = pool.filter(
        (candidate) =>
          candidate.triggers?.length === 1 &&
          candidate.triggers[0].dependencyHrid === DEPENDENCY_ALL_ENEMIES &&
          candidate.triggers[0].conditionHrid === CONDITION_CURRENT_HP &&
          candidate.triggers[0].comparatorHrid === COMPARATOR_GTE,
      );
      // 第二腿：① 当前配置自己写的守卫腿（只能从 current 锚点读）；② 池里已有、却从未与该腿搭配的
      // 家族（按价值顺序取前几个，够用即可 —— 这是上限测量，不是生产网格）。
      const currentAnchor = pool.find((candidate) => candidate.labelKey === LK.current);
      const guardLegs = (currentAnchor?.triggers ?? []).filter(
        (trigger) => trigger.conditionHrid !== CONDITION_CURRENT_HP,
      );
      const secondLegs = [...guardLegs];
      for (const labelKey of [LK.manyEnemies, LK.deadUnitsAtMost, LK.buffWindow, LK.enoughMp, LK.debuffWindow]) {
        if (secondLegs.length >= 5) break;
        const candidate = pool.find((entry) => entry.labelKey === labelKey && entry.triggers?.length === 1);
        if (candidate) secondLegs.push(candidate.triggers[0]);
      }
      const existingSignatures = new Set(pool.map((candidate) => candidate.signature));
      const candidates = [];
      for (const hpLeg of hpLegs) {
        for (const leg of secondLegs) {
          // 生产组合候选的规则：同一 condition 出现两次 = 自我矛盾（等价于更严的那条），拒绝。
          if (leg.conditionHrid === hpLeg.triggers[0].conditionHrid) continue;
          const triggers = engine.sanitizeTriggerList([hpLeg.triggers[0], leg]);
          assert.equal(triggers.length, 2, `组合腿不合法：${JSON.stringify([hpLeg.triggers[0], leg])}`);
          const candidate = {
            slotIndex: slot.slotIndex,
            abilityHrid: slot.abilityHrid,
            role: slot.role,
            state: 'custom',
            triggers,
            signature: engine.buildTriggerCandidateSignature(triggers),
            labelKey: LK.compositeManyEnemiesGuard,
            labelParams: {},
            distance: 3, // = 生产 DISTANCE_COMPOSITE（同分时优先单条件候选）
            studyTag: `${describe(hpLeg.triggers[0])} 且 ${describe(leg)}`,
          };
          if (
            existingSignatures.has(candidate.signature) ||
            sweepSignatures.has(candidate.signature) ||
            coverageSignatures.has(candidate.signature)
          ) {
            continue;
          }
          candidates.push(candidate);
        }
      }
      console.log(
        `组合候选缺口（槽 ${slot.slotIndex} ${slot.abilityHrid}）：胜出单腿 ${hpLegs.length} × 第二腿 ${secondLegs.length}` +
          ` ⇒ 合成 ${candidates.length} 条组合候选（合法性自证通过）`,
      );
      studies.push({
        slotIndex: slot.slotIndex,
        abilityHrid: slot.abilityHrid,
        role: slot.role,
        existing: pool,
        candidates,
      });
    }
    assert(
      studies.some((study) => study.candidates.length > 0),
      '组合候选缺口：所有槽都没合成出候选（腿没找到：检查池里是否有 enemyGroupHp / current 锚点）',
    );
    return studies;
  })();

  // ── 组合内单条数值腿的邻域精炼（2026-09-27，设计 §57 研究）────────────────────
  // 问题：生产精炼器对「2 条触发器的组合候选」直接返回空（buildRefinementCandidates 首行
  // `triggers.length !== 1 → []`）⇒ 组合被采纳后内部阈值不可调（§24.5/§25.7/§28.5 反复遗留；
  // §25.7 记录 compositeBuffWindowGroupHp 曾有 +0.0919 接近被采纳）。本段量化：若允许对组合内的
  // **单条数值腿**做与单条件同款的 ±step 邻域行走，真实分能不能提升、代价多少。
  // 范围（第一版）：池里的 2 腿候选 = 组合族（composite*）+ 当前配置锚点（current，用户手写组合）；
  // 只覆盖有**生产现成精炼口径**的腿 —— 敌方血量类（all_enemies / targeted_enemy）、自身血量类
  // （self current_hp / missing_hp）、队友百分比（all_allies lowest_hp_percentage）、计数类
  // （active_units / dead_units）；「蓝量守卫」腿（组合里的 mp 守卫）没有单条件精炼口径，
  // 本轮不覆盖（如实计入 skipped 并输出）。
  // 预注册判据（开跑前写死）：
  //   C1（硬）：① 邻域合成合法性（sanitize 双腿通过、与既有池/精炼扫描/覆盖族/组合缺口族不撞签名）；
  //            ② 换算对齐自证（脚本步长公式 vs 生产 buildRefinedCandidates 的单腿输出，逐值容差 ≤1）；
  //   C2（主）：行走净效应（留出真实分、配对差）mean > 0 且 t ≥ 3 且负例率 < 5% ⇒ 值得实施；
  //             否则不实施（如实写档）。
  const compositeLegStudy = (() => {
    const LK = engine.TRIGGER_OPTIMIZER_CANDIDATE_LABEL_KEYS;
    const CONDITION_CURRENT_HP = '/combat_trigger_conditions/current_hp';
    const CONDITION_MISSING_HP = '/combat_trigger_conditions/missing_hp';
    const CONDITION_LOWEST_HP_PERCENTAGE = '/combat_trigger_conditions/lowest_hp_percentage';
    const CONDITION_ACTIVE_UNITS = '/combat_trigger_conditions/number_of_active_units';
    const CONDITION_DEAD_UNITS = '/combat_trigger_conditions/number_of_dead_units';
    const DEP_SELF = '/combat_trigger_dependencies/self';
    const DEP_TARGETED_ENEMY = '/combat_trigger_dependencies/targeted_enemy';
    const DEP_ALL_ENEMIES = '/combat_trigger_dependencies/all_enemies';
    const DEP_ALL_ALLIES = '/combat_trigger_dependencies/all_allies';
    const GTE = '/combat_trigger_comparators/greater_than_equal';
    const LTE = '/combat_trigger_comparators/less_than_equal';
    const PERCENT_MIN = 5; // = 生产 REFINEMENT_PERCENT_MIN
    const PERCENT_MAX = 95; // = 生产 REFINEMENT_PERCENT_MAX
    const COUNT_MIN = 2; // = 生产 REFINEMENT_COUNT_MIN
    const COUNT_MAX = 8; // = 生产 REFINEMENT_COUNT_MAX
    const isObj = (value) => value != null && typeof value === 'object' && !Array.isArray(value);
    const compositeKeys = new Set(Object.values(LK).filter((key) => String(key).includes('.candidate.composite')));
    // 采样偏移集 = 生产步长序列（10/5/5/5）× 4 级行走在 5pp 网格上可能产生的全部探针偏移
    //（级 0 ±10；后续 ±5；经「评估过即 visited」去重后可达 ±5/±10/±15/±20/±25）。
    // 生产步长序列若变，下面的硬断言先失败 —— 不会静默错位采样。
    assert(
      refineStudy.productionSteps.every((step) => step === 5 || step === 10),
      `组合腿精炼：生产步长序列 ${refineStudy.productionSteps.join('/')}pp 含非 5/10 值，采样偏移集需要同步`,
    );
    const PERCENT_OFFSETS = [5, 10, 15, 20, 25];
    const COUNT_OFFSETS = [1, 2, 3, 4];
    const clampPercent = (value) => Math.min(PERCENT_MAX, Math.max(PERCENT_MIN, value));

    // 腿规格：数值腿 → 步进规则；null = 不可精炼（无数值 / 或无单条件精炼口径的 mp 守卫腿）。
    // step(delta) 返回 { value, percent?, count? } | null（null = 同值/越界被拒，与生产同口径）。
    const resolveLegSpec = (trigger) => {
      if (!isObj(trigger)) return null;
      const dependency = String(trigger.dependencyHrid || '');
      const condition = String(trigger.conditionHrid || '');
      const comparator = String(trigger.comparatorHrid || '');
      const value = Number(trigger.value);
      if (!Number.isFinite(value)) return null;
      const enemyHp = isObj(resources?.enemyHp) ? resources.enemyHp : {};
      // ① 敌方血量类（与生产 REFINE_ENEMY_HP_SPECS 同一套换算：
      //    Math.max(1, Math.round(percent/100 × scale)) + isMeaningfulEnemyHpThreshold 自守）。
      if (condition === CONDITION_CURRENT_HP && (dependency === DEP_ALL_ENEMIES || dependency === DEP_TARGETED_ENEMY)) {
        const scale = Number(dependency === DEP_ALL_ENEMIES ? enemyHp.group : enemyHp.min);
        const ceiling = Number(dependency === DEP_ALL_ENEMIES ? enemyHp.max : enemyHp.min);
        if (!(scale > 0) || !(ceiling > 0)) return null;
        const percent = (value / scale) * 100;
        return {
          percent,
          step(delta) {
            const nextPercent = clampPercent(Math.round(percent) + delta);
            const nextValue = Math.max(1, Math.round((nextPercent / 100) * scale));
            if (nextValue === value) return null;
            if (comparator === GTE ? nextValue > ceiling : nextValue >= ceiling) return null;
            return { value: nextValue, percent: nextPercent };
          },
        };
      }
      // ② 自身血量类（与生产 REFINE_PERCENT_SPECS 同源：current_hp 用 maxHp + floor、missing_hp + ceil）。
      if (dependency === DEP_SELF && (condition === CONDITION_CURRENT_HP || condition === CONDITION_MISSING_HP)) {
        const maxHp = Number(resources?.maxHp);
        if (!(maxHp > 0)) return null;
        const rounding = condition === CONDITION_CURRENT_HP ? Math.floor : Math.ceil;
        const percent = (value / maxHp) * 100;
        return {
          percent,
          step(delta) {
            const nextPercent = clampPercent(Math.round(percent) + delta);
            const nextValue = Math.max(1, rounding((nextPercent / 100) * maxHp));
            if (nextValue === value) return null;
            return { value: nextValue, percent: nextPercent };
          },
        };
      }
      // ③ 队友百分比（原始百分比，与生产 rawPercent 分支同源：不需要资源换算）。
      if (dependency === DEP_ALL_ALLIES && condition === CONDITION_LOWEST_HP_PERCENTAGE) {
        return {
          percent: value,
          step(delta) {
            const nextPercent = clampPercent(Math.round(value) + delta);
            if (nextPercent === Math.round(value)) return null;
            return { value: nextPercent, percent: nextPercent };
          },
        };
      }
      // ④ 计数类（与生产 manyEnemies / deadUnits 精炼同源：上界 = min(8, waveSize) / waveSize − Δ）。
      if (
        dependency === DEP_ALL_ENEMIES &&
        (condition === CONDITION_ACTIVE_UNITS || condition === CONDITION_DEAD_UNITS)
      ) {
        const waveSize = Math.floor(Number(isObj(enemyHp) ? enemyHp.waveSize : 0));
        if (!(waveSize >= 1)) return null;
        const upper =
          condition === CONDITION_ACTIVE_UNITS
            ? Math.min(COUNT_MAX, waveSize)
            : waveSize + (comparator === GTE ? -1 : -2);
        const lower = condition === CONDITION_ACTIVE_UNITS ? COUNT_MIN : comparator === GTE ? 1 : 0;
        if (upper < lower) return null;
        const count = Math.round(value);
        return {
          count,
          step(delta) {
            const next = Math.min(upper, Math.max(lower, count + delta));
            if (next === count) return null;
            return { value: next, count: next };
          },
        };
      }
      return null;
    };

    // 邻域探针：替换组合内**一条腿**的数值（另一条腿逐字不变），过生产 sanitize + 签名入口。
    const buildLegProbes = (composite, legIndex, spec) => {
      const probes = [];
      const offsets = spec.count === undefined ? PERCENT_OFFSETS : COUNT_OFFSETS;
      for (const offset of offsets) {
        for (const sign of [1, -1]) {
          const stepped = spec.step(sign * offset);
          if (!stepped) continue;
          const triggers = composite.triggers.map((trigger, index) =>
            index === legIndex ? { ...trigger, value: stepped.value } : trigger,
          );
          const sanitized = engine.sanitizeTriggerList(triggers);
          assert.equal(sanitized.length, 2, `组合腿邻域不合法（sanitize 丢条目）：${JSON.stringify(triggers)}`);
          const labelParams = { ...composite.labelParams };
          if (Object.prototype.hasOwnProperty.call(labelParams, 'count') && stepped.count !== undefined) {
            labelParams.count = stepped.count;
          } else if (Object.prototype.hasOwnProperty.call(labelParams, 'value') && stepped.value !== undefined) {
            labelParams.value = stepped.value;
          } else if (Object.prototype.hasOwnProperty.call(labelParams, 'percent') && stepped.percent !== undefined) {
            labelParams.percent = stepped.percent;
          }
          probes.push({
            offset: sign * offset,
            candidate: {
              slotIndex: composite.slotIndex,
              abilityHrid: composite.abilityHrid,
              role: composite.role,
              state: 'custom',
              triggers: sanitized,
              signature: engine.buildTriggerCandidateSignature(sanitized),
              labelKey: composite.labelKey,
              labelParams,
              distance: 4, // = 生产 DISTANCE_REFINEMENT：同分时优先网格候选
            },
          });
        }
      }
      return probes;
    };

    // 去重集：既有池 + 精炼扫描 + 覆盖族 + 组合缺口族（撞签名 = 已采样过，不重复采）。
    const knownSignatures = new Set();
    for (const slot of slotContexts) {
      for (const candidate of slot.candidates) knownSignatures.add(candidate.signature);
    }
    for (const candidate of refineStudy.sweep) knownSignatures.add(candidate.signature);
    for (const study of coverageStudies) {
      for (const candidate of study.candidates) knownSignatures.add(candidate.signature);
    }
    for (const study of compositeStudies) {
      for (const candidate of study.candidates) knownSignatures.add(candidate.signature);
    }
    const probeBySignature = new Map();
    const registerProbe = (candidate) => {
      const existing = probeBySignature.get(candidate.signature);
      if (existing) return existing;
      probeBySignature.set(candidate.signature, candidate);
      return candidate;
    };

    const studies = [];
    let skippedLegs = 0;
    let probeTotal = 0;
    for (const slot of slotContexts) {
      const composites = slot.candidates.filter((candidate) => {
        if (!Array.isArray(candidate.triggers) || candidate.triggers.length !== 2) return false;
        if (compositeKeys.has(String(candidate.labelKey))) return true;
        return String(candidate.labelKey) === LK.current || candidate.state === 'current';
      });
      const entries = [];
      let slotSkippedLegs = 0;
      for (const composite of composites) {
        const legs = [];
        for (let legIndex = 0; legIndex < composite.triggers.length; legIndex += 1) {
          const spec = resolveLegSpec(composite.triggers[legIndex]);
          if (!spec) {
            slotSkippedLegs += 1;
            continue;
          }
          const probes = buildLegProbes(composite, legIndex, spec)
            .filter(({ candidate }) => !knownSignatures.has(candidate.signature))
            .map(({ offset, candidate }) => ({ offset, candidate: registerProbe(candidate) }));
          if (probes.length === 0) {
            slotSkippedLegs += 1;
            continue;
          }
          legs.push({ legIndex, spec, probes });
        }
        const entry = {
          candidate: composite,
          legs,
          source: compositeKeys.has(String(composite.labelKey)) ? 'composite' : 'current',
        };
        entry.probesByLevel = Array.from({ length: REFINEMENT_LEVELS }, (_, level) => {
          const list = [];
          for (const leg of entry.legs) {
            const step = leg.spec.count === undefined ? refineStudy.productionSteps[level] : 1;
            for (const sign of [1, -1]) {
              const probe = leg.probes.find((item) => item.offset === sign * step);
              if (probe) list.push(probe.candidate);
            }
          }
          return list;
        });
        entries.push(entry);
      }
      const slotProbes = entries.reduce(
        (sum, entry) => sum + entry.legs.reduce((legSum, leg) => legSum + leg.probes.length, 0),
        0,
      );
      probeTotal += slotProbes;
      skippedLegs += slotSkippedLegs;
      console.log(
        `组合腿精炼（槽 ${slot.slotIndex} ${slot.abilityHrid}）：2 腿候选 ${composites.length} 条，` +
          `可精炼 ${entries.filter((entry) => entry.legs.length > 0).length} 条，邻域探针 ${slotProbes} 个` +
          `（不可精炼腿 ${slotSkippedLegs} 条 = 无数值 / mp 守卫腿）`,
      );
      studies.push({ slotIndex: slot.slotIndex, abilityHrid: slot.abilityHrid, role: slot.role, composites: entries });
    }

    // 换算对齐自证：脚本步长公式 vs 生产 buildRefinedCandidates（池里的单腿对照候选）。
    // 容差 ≤1（enemyHpThreshold 的 Math.round 取整；尺度非 100 整数倍时同百分点可差 1）。
    const alignment = { checked: 0, skipped: 0, kinds: [] };
    const alignmentTargets = [
      `${DEP_ALL_ENEMIES}|${CONDITION_CURRENT_HP}|${GTE}`,
      `${DEP_TARGETED_ENEMY}|${CONDITION_CURRENT_HP}|${LTE}`,
      `${DEP_SELF}|${CONDITION_CURRENT_HP}|${LTE}`,
      `${DEP_SELF}|${CONDITION_MISSING_HP}|${GTE}`,
      `${DEP_ALL_ENEMIES}|${CONDITION_ACTIVE_UNITS}|${GTE}`,
      `${DEP_ALL_ALLIES}|${CONDITION_LOWEST_HP_PERCENTAGE}|${LTE}`,
    ];
    for (const key of alignmentTargets) {
      const found = slotContexts
        .flatMap((slot) => slot.candidates.map((candidate) => ({ slot, candidate })))
        .find(
          ({ candidate }) =>
            Array.isArray(candidate.triggers) &&
            candidate.triggers.length === 1 &&
            `${candidate.triggers[0].dependencyHrid}|${candidate.triggers[0].conditionHrid}|${candidate.triggers[0].comparatorHrid}` ===
              key,
        );
      if (!found) {
        alignment.skipped += 1;
        continue;
      }
      const spec = resolveLegSpec(found.candidate.triggers[0]);
      assert(spec, `对齐自证：单腿对照解析不出规格：${key}`);
      const ctx = {
        slotIndex: found.slot.slotIndex,
        abilityHrid: found.slot.abilityHrid,
        role: found.slot.role,
        candidates: [],
      };
      const produced = engine.buildRefinedCandidates(found.candidate, ctx, resources, { level: 0 });
      const deltas = spec.count === undefined ? [10, -10] : [1, -1];
      const scriptValues = deltas
        .map((delta) => spec.step(delta))
        .filter(Boolean)
        .map((stepped) => stepped.value)
        .sort((a, b) => a - b);
      const producedValues = produced.map((probe) => Number(probe.triggers[0].value)).sort((a, b) => a - b);
      assert.equal(
        scriptValues.length,
        producedValues.length,
        `对齐自证数量不一致（${key}）：脚本 [${scriptValues}] vs 生产 [${producedValues}]`,
      );
      scriptValues.forEach((value, index) => {
        assert(
          Math.abs(value - producedValues[index]) <= 1,
          `对齐自证数值不一致（${key}）：脚本 [${scriptValues}] vs 生产 [${producedValues}]`,
        );
      });
      alignment.checked += 1;
      alignment.kinds.push(key);
    }
    console.log(
      `  对齐自证（脚本换算 vs 生产精炼，逐值容差 ≤1）：通过 ${alignment.checked} 类` +
        `${alignment.skipped > 0 ? `，无单腿对照跳过 ${alignment.skipped} 类` : ''}；` +
        `探针合计 ${probeTotal} 个（去重后 ${probeBySignature.size}，含不可精炼腿的跳过 ${skippedLegs} 条）`,
    );
    return { studies, probes: [...probeBySignature.values()], alignment, skippedLegs, probeTotal };
  })();

  // ── 跨区域适用性量化（2026-09-27，设计 §58 研究）────────────────────────────────
  // 问题：触发器写的是**全局技能配置**，而搜索只在单一区域上评估过 —— §29 的复核只回答「相邻难度」，
  // §29.10 明说「对其它区域是否成立」未做。本段只读量化两件事（零产品改动）：
  //   ① 移植率：在源区域被采纳的 winner，换到其它区域后还算不算提升（真值 = 目标区域留出样本）；
  //   ② 跨区域复核的判别力：把 §29/§49 的复核形态原样搬到目标区域（生产 robustness 盐 + 生产配对
  //      统计），能不能可靠回答 ①（不虚报、不空转）—— 能，才值得加这个功能。
  // 目标区域默认三档、取**结构差异最大**的三个（§36 的选法）：bear_with_it（3 怪 / group 7000）、
  // vampire（单怪 2200）、fly（单怪 50）；源区域 jungle_planet（4 怪 / group 3200）。
  // 样本分割（硬约束）：复核样本 = 生产 robustness 盐在**目标区域设置**上派生（种子键自带区域 ⇒
  // 换区域天然换随机流；盐独立把它写死、不靠巧合），与源搜索种子、其它区域复核种子两两不相交。
  // 同区域对照（ctrl）= 源区域 + 同款 robustness 盐：「区域不变、只换盐」的复核机制上限。
  const crossZoneStudy = (() => {
    const zones = (Array.isArray(args.crossZones) ? args.crossZones : []).filter(Boolean);
    if (zones.length === 0) return null;
    const RECHECK_ROUNDS = engine.TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS; // 16（生产上限）
    const BASE_ROUNDS = engine.TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS; // 6（生产保底）
    assert(RECHECK_ROUNDS >= BASE_ROUNDS, `跨区域：复核上限 ${RECHECK_ROUNDS} 装不下保底 ${BASE_ROUNDS}`);
    assert(args.seeds >= BASE_ROUNDS, `跨区域：--seeds 至少要 ${BASE_ROUNDS}`);
    const recheckSeedsOf = (settings) =>
      engine.createTriggerOptimizerSeedSet({
        playerId: preferredPlayerId,
        playerConfig,
        simulationSettings: settings,
        salt: engine.TRIGGER_OPTIMIZER_SEED_SALT_ROBUSTNESS,
        count: RECHECK_ROUNDS,
      });
    const controlSeeds = recheckSeedsOf(simulationSettings);
    assert.equal(controlSeeds.length, RECHECK_ROUNDS, '跨区域：同区域对照复核种子不足');
    assert(!controlSeeds.some((seed) => seeds.includes(seed)), '跨区域：同区域对照复核种子与源搜索种子重叠');
    const entries = zones.map((zoneHrid) => {
      const settings = { ...simulationSettings, zoneHrid };
      const zonePayload = engine.buildCandidatePayload(playerConfig, settings, undefined, null);
      const zoneResources = engine.resolveOptimizerResources(zonePayload, preferredPlayerId);
      assert(zoneResources, `跨区域：区域 ${zoneHrid} 解析不出战斗属性（检查 hrid）`);
      const recheckSeeds = recheckSeedsOf(settings);
      assert.equal(recheckSeeds.length, RECHECK_ROUNDS, `跨区域：区域 ${zoneHrid} 复核种子不足`);
      assert(!recheckSeeds.some((seed) => seeds.includes(seed)), `跨区域：区域 ${zoneHrid} 复核种子与源搜索种子重叠`);
      assert(
        !recheckSeeds.some((seed) => controlSeeds.includes(seed)),
        `跨区域：区域 ${zoneHrid} 复核种子与同区域对照重叠`,
      );
      return { zoneHrid, settings, resources: zoneResources, recheckSeeds };
    });
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        assert(
          !entries[i].recheckSeeds.some((seed) => entries[j].recheckSeeds.includes(seed)),
          `跨区域：区域 ${entries[i].zoneHrid} 与 ${entries[j].zoneHrid} 复核种子重叠`,
        );
      }
    }
    console.log('');
    console.log(
      `跨区域适用性（源区域 ${args.zone} tier ${args.tier} / ${args.hours}h；目标区域 ${entries.length} 个）`,
    );
    for (const entry of entries) {
      const enemyHp = entry.resources.enemyHp ?? {};
      console.log(
        `  ${entry.zoneHrid}（enemyHp group=${enemyHp.group ?? '—'} / min=${enemyHp.min ?? '—'} / max=${
          enemyHp.max ?? '—'
        } / waveSize=${enemyHp.waveSize ?? '—'}）`,
      );
    }
    console.log(
      `  复核样本 = 生产 robustness 盐 × ${RECHECK_ROUNDS} 轮/区域（评测取 ${BASE_ROUNDS}/${RECHECK_ROUNDS} 轮前缀）；` +
        `种子两两不相交自证通过（源搜索 / 同区域对照 / ${entries.length} 个目标区域）`,
    );
    return { entries, controlSeeds, RECHECK_ROUNDS, BASE_ROUNDS };
  })();

  // ── 队伍载荷评估（2026-09-27，设计 §59 研究）────────────────────────────────────
  // 问题：技能优化器只在「被优化角色单挑」的载荷上评估（生产 buildCandidatePayload 只构建 1 名
  // 角色，store 也只传 activePlayer），而触发器是全局配置 —— 组队环境里也在吃这套配置。本段只读
  // 量化口径 A（用户 2026-09-27 拍板：**整队模拟、只改主角触发器、队友配置冻结**）：
  //   ① 单人最优在队伍环境里还成不成立；② 队伍环境的最优是不是换人了；③ 代价多少。
  // 队友来源 = `junglePlanetOfficialParityUser.json` 的真实存档（法系，等级略低于主角色）；
  // 指标口径不变（仍是**主角自身**的 dps/经验/利润；killsPerHour 是引擎的遭遇级计数 —— 与首页
  // 组队模拟同口径）。判据（预注册）见输出段「队伍载荷评估」注释。
  const partyStudy = (() => {
    const source = String(args.party || '').trim();
    if (!source || source === '0' || source === 'off') return null;
    assert(source === 'parity', `--party=${source} 未支持（目前只有 parity：官方向导存档当队友）`);
    const imported = engine.importSoloConfig(
      JSON.stringify(engine.junglePlanetOfficialParityUserFixture),
      engine.createEmptyPlayerConfig(2),
      simulationSettings,
    );
    const teammateConfig = { ...imported.player, id: '2', selected: true };
    assert(
      Array.isArray(teammateConfig.abilities) && teammateConfig.abilities.length > 0,
      '队伍载荷：队友夹具导入失败（无技能）',
    );
    const partyBaselinePayload = engine.buildPartyCandidatePayload(
      playerConfig,
      [teammateConfig],
      simulationSettings,
      undefined,
      null,
    );
    const partyResources = engine.resolveOptimizerResources(partyBaselinePayload, preferredPlayerId);
    assert(partyResources, '队伍载荷：resolveOptimizerResources 失败');
    console.log('');
    console.log(
      `队伍载荷评估（设计 §59）：队友 = 官方向导存档（player2，技能 ${teammateConfig.abilities.length} 个，配置冻结）；` +
        '口径 = 整队模拟 / 只改主角触发器 / 指标仍按主角归集',
    );
    console.log(
      `  资源对照（主角）：单人 maxHp=${resources.maxHp} / maxMp=${resources.maxMp}｜队伍 maxHp=${
        partyResources.maxHp
      } / maxMp=${partyResources.maxMp}｜enemyHp ${
        JSON.stringify(resources.enemyHp) === JSON.stringify(partyResources.enemyHp) ? '一致' : '不一致（！）'
      }`,
    );
    return { teammateConfig, partyResources };
  })();

  // ── 采样：基线 1 份 + 每槽每候选 1 份 + 精炼扫描 1 份 + 缺口族 1 份，各 args.seeds 轮真实引擎 ──
  const targets = [{ key: 'baseline', payload: baselinePayload, seeds }];
  for (const slot of slotContexts) {
    for (const candidate of slot.candidates) {
      targets.push({
        key: `${slot.slotIndex}|${candidate.signature}`,
        payload: engine.buildCandidatePayload(playerConfig, simulationSettings, undefined, candidate),
        seeds,
      });
    }
  }
  for (const candidate of refineStudy.sweep) {
    targets.push({
      key: `${refineStudy.slotIndex}|${candidate.signature}`,
      payload: engine.buildCandidatePayload(playerConfig, simulationSettings, undefined, candidate),
      seeds,
    });
  }
  for (const study of coverageStudies) {
    for (const candidate of study.candidates) {
      targets.push({
        key: `${study.slotIndex}|${candidate.signature}`,
        payload: engine.buildCandidatePayload(playerConfig, simulationSettings, undefined, candidate),
        seeds,
      });
    }
  }
  for (const study of compositeStudies) {
    for (const candidate of study.candidates) {
      targets.push({
        key: `${study.slotIndex}|${candidate.signature}`,
        payload: engine.buildCandidatePayload(playerConfig, simulationSettings, undefined, candidate),
        seeds,
      });
    }
  }
  for (const probe of compositeLegStudy.probes) {
    targets.push({
      key: `${probe.slotIndex}|${probe.signature}`,
      payload: engine.buildCandidatePayload(playerConfig, simulationSettings, undefined, probe),
      seeds,
    });
  }
  // 跨区域适用性（设计 §58）：每个目标区域采两套样本 —— 真值（源搜索种子，args.seeds 轮）与复核
  // （生产 robustness 盐，RECHECK_ROUNDS 轮）；同区域对照（ctrl）只采复核那套（真值复用源区域样本）。
  if (crossZoneStudy) {
    const { entries, controlSeeds, RECHECK_ROUNDS } = crossZoneStudy;
    assert.equal(RECHECK_ROUNDS, entries[0].recheckSeeds.length, '跨区域：复核样本轮数与常量漂移');
    const pushZoneTargets = (prefix, settings, sampleSeeds) => {
      targets.push({
        key: `${prefix}|baseline`,
        payload: engine.buildCandidatePayload(playerConfig, settings, undefined, null),
        seeds: sampleSeeds,
      });
      for (const slot of slotContexts) {
        for (const candidate of slot.candidates) {
          targets.push({
            key: `${prefix}|${slot.slotIndex}|${candidate.signature}`,
            payload: engine.buildCandidatePayload(playerConfig, settings, undefined, candidate),
            seeds: sampleSeeds,
          });
        }
      }
    };
    pushZoneTargets('cross|ctrl|recheck', simulationSettings, controlSeeds);
    entries.forEach((entry, zoneIndex) => {
      pushZoneTargets(`cross|z${zoneIndex}`, entry.settings, seeds);
      pushZoneTargets(`cross|z${zoneIndex}|recheck`, entry.settings, entry.recheckSeeds);
    });
  }
  // 复核轮数自适应对照（设计 §49）：相邻难度的第二组样本（只采「基线 + 每槽候选」—— 复核场景
  // 只有这两个角色；精炼/缺口扩展组不参与复核）。难度按生产口径解析：顶档退回 −1、解析不出
  // 就跳过本段（不猜一个难度）。
  const robustTier = engine.resolveAdjacentDifficultyTier(args.zone, args.tier);
  if (robustTier != null) {
    const robustSettings = { ...simulationSettings, difficultyTier: robustTier };
    targets.push({
      key: 'robust|baseline',
      payload: engine.buildCandidatePayload(playerConfig, robustSettings, undefined, null),
      seeds,
    });
    // 复跑恒等自证（设计 §51）的第二半：**同一 payload + 同一组种子必须逐值同结果**。两个探针的
    // payload 逐字段相同（同 playerConfig / 同 robustSettings / 同 candidate = null），采样器按 key
    // 各采一遍（不去重）⇒ 两份样本逐值相同 = 「现状复跑是满价买同一份样本」的机器证明。
    for (const key of ['robust|identity-a', 'robust|identity-b']) {
      targets.push({
        key,
        payload: engine.buildCandidatePayload(playerConfig, robustSettings, undefined, null),
        seeds,
      });
    }
    for (const slot of slotContexts) {
      for (const candidate of slot.candidates) {
        targets.push({
          key: `robust|${slot.slotIndex}|${candidate.signature}`,
          payload: engine.buildCandidatePayload(playerConfig, robustSettings, undefined, candidate),
          seeds,
        });
      }
    }
  }
  const metricsContext = { preferredPlayerId, pricingOptions: {} };
  console.log(
    `采样开始：${targets.length} 个配置 × ${args.seeds} 轮 × ${args.hours}h ≈ ${targets.length * args.seeds} 场模拟（${args.workers} workers）`,
  );
  const startedAt = Date.now();
  // §61（S1）参考列：主采样全程的主线程占用率（只在 --timing-study=1 时采集）。
  const samplingEluBefore =
    args.timingStudy && typeof performance.eventLoopUtilization === 'function'
      ? performance.eventLoopUtilization()
      : null;
  const samplesByKey = await collectSamples(engineUrl, metricsContext, targets, args.workers);
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  if (samplingEluBefore) {
    const utilization = performance.eventLoopUtilization(samplingEluBefore).utilization;
    console.log(`  主线程占用率（主采样全程，eventLoopUtilization）：${(utilization * 100).toFixed(1)}%`);
  }
  const totalSims = targets.length * args.seeds;
  console.log(
    `采样完成：${totalSims} 场 / ${elapsedSeconds.toFixed(1)}s（${(totalSims / elapsedSeconds).toFixed(1)} 场/s）`,
  );
  // §59 队伍载荷样本：单独一趟采样（计时可比）——只采「基线 + 每槽候选」（61 配置级），
  // 与单人样本**共用同一组种子**（CRN 配对：同候选在两侧逐轮可比）。
  let partySamples = null;
  let partyElapsedSeconds = 0;
  // §63 队伍载荷复核链：复核臂的「队伍 robustness 盐 × 相邻难度」样本（单独一趟采样 —— §59/§60 的
  // 61 配置池速率行保持可比）。
  let partyRobustSamples = null;
  if (partyStudy) {
    const partyTargets = [
      {
        key: 'baseline',
        payload: engine.buildPartyCandidatePayload(
          playerConfig,
          [partyStudy.teammateConfig],
          simulationSettings,
          undefined,
          null,
        ),
        seeds,
      },
    ];
    for (const slot of slotContexts) {
      for (const candidate of slot.candidates) {
        partyTargets.push({
          key: `${slot.slotIndex}|${candidate.signature}`,
          payload: engine.buildPartyCandidatePayload(
            playerConfig,
            [partyStudy.teammateConfig],
            simulationSettings,
            undefined,
            candidate,
          ),
          seeds,
        });
      }
    }
    const partyStartedAt = Date.now();
    partySamples = await collectSamples(engineUrl, metricsContext, partyTargets, args.workers);
    partyElapsedSeconds = (Date.now() - partyStartedAt) / 1000;
    const partySims = partyTargets.length * args.seeds;
    console.log(
      `  队伍载荷采样：${partySims} 场 / ${partyElapsedSeconds.toFixed(1)}s（${(
        partySims / partyElapsedSeconds
      ).toFixed(1)} 场/s；同规模单人池可比口径见上一行的总速率，两份都含 worker 启动固定开销）`,
    );
    // §63 队伍载荷复核链：复核臂需要「队伍 robustness 盐 × 相邻难度」的新样本（单独采样趟）。
    if (args.partyChecks) {
      if (robustTier == null) {
        console.log('  队伍复核样本：本区域解析不出相邻难度（顶档/未知）⇒ 跳过（复核链段随之跳过）。');
      } else {
        const robustSettings = { ...simulationSettings, difficultyTier: robustTier };
        const partyRobustTargets = [
          {
            key: 'robust|baseline',
            payload: engine.buildPartyCandidatePayload(
              playerConfig,
              [partyStudy.teammateConfig],
              robustSettings,
              undefined,
              null,
            ),
            seeds,
          },
        ];
        for (const slot of slotContexts) {
          for (const candidate of slot.candidates) {
            partyRobustTargets.push({
              key: `robust|${slot.slotIndex}|${candidate.signature}`,
              payload: engine.buildPartyCandidatePayload(
                playerConfig,
                [partyStudy.teammateConfig],
                robustSettings,
                undefined,
                candidate,
              ),
              seeds,
            });
          }
        }
        const robustStartedAt = Date.now();
        partyRobustSamples = await collectSamples(engineUrl, metricsContext, partyRobustTargets, args.workers);
        const robustElapsedSeconds = (Date.now() - robustStartedAt) / 1000;
        const robustSims = partyRobustTargets.length * args.seeds;
        console.log(
          `  队伍复核样本（robustness 盐 × 目标 tier ${robustTier}）：${robustSims} 场 / ${robustElapsedSeconds.toFixed(
            1,
          )}s（${(robustSims / robustElapsedSeconds).toFixed(1)} 场/s）`,
        );
      }
    }
  }

  // ── bootstrap 对照 ─────────────────────────────────────────────────────────
  // ── 预算缩减回放（2026-09-24，设计 §38「成本/耗时」）────────────────────────────
  // 研究问题（③）：同一批采纳决策下，粗筛 / keep / 精测预算各能省多少场次？装置 = 同一份样本
  // 矩阵 + 同一组 perm 切分，各臂的 screen/decide 取**前缀**（只少看样本），筛选的 keep 参数化、
  // 判据（compareCandidates / shouldAdoptCandidate / scoreCandidate）全走生产实现。
  // pickSurvivorsWithKeep 是全脚本唯一的手写判据副本（生产 KEEP 是常量、无法参数化）：
  // 与生产 pickRacingSurvivors 逐行同构（top-K ∪ distance 0 锚点保送，保持粗筛排名顺序），
  // keep=KEEP 时每个 trial 都断言两者输出全等，漂移即炸。
  const pickSurvivorsWithKeep = (entries, keep) => {
    const ranked = entries.filter(Boolean).sort(engine.compareCandidates);
    const picked = new Set();
    for (const entry of ranked) {
      if (picked.size >= keep) break;
      picked.add(entry);
    }
    for (const entry of ranked) {
      if (Number(entry?.distance) === 0) picked.add(entry); // 0 = 生产 DISTANCE_ANCHOR
    }
    return ranked.filter((entry) => picked.has(entry));
  };
  // 预算臂（P = 生产参数 = 上面的 racing 臂，同一 perm 切分）：H1 粗筛减半、H2 keep 减 1、
  // H3/H3b 精测 5→3/2、H4/H5 组合减半。decide 超出 args.rounds 的臂滤掉（冒烟参数下不适用）。
  const P_ARM = { name: 'P 生产', screen: SCREEN, keep: KEEP, decide: args.rounds };
  const budgetArms = [
    { name: 'H1 粗筛1', screen: 1, keep: KEEP, decide: args.rounds },
    { name: 'H2 keep2', screen: SCREEN, keep: 2, decide: args.rounds },
    { name: 'H3 精测3', screen: SCREEN, keep: KEEP, decide: 3 },
    { name: 'H3b 精测2', screen: SCREEN, keep: KEEP, decide: 2 },
    { name: 'H4 1×2×3', screen: 1, keep: 2, decide: 3 },
    { name: 'H5 1×2×2', screen: 1, keep: 2, decide: 2 },
  ].filter((arm) => arm.decide >= 2 && arm.decide <= args.rounds);

  const rng = createSeededRandom(20260924);
  const seedIndices = seeds.map((_, index) => index);
  for (const slot of slotContexts) {
    const matrix = [samplesByKey.get('baseline')];
    for (const candidate of slot.candidates) matrix.push(samplesByKey.get(`${slot.slotIndex}|${candidate.signature}`));
    for (const samples of matrix) assert.equal(samples?.length, args.seeds, `槽位 ${slot.slotIndex} 样本缺失`);
    const indexOf = new Map(slot.candidates.map((candidate, index) => [candidate.signature, index + 1]));

    // 全体种子聚合 = 槽位分类与「真最优」的粗粒度参照（各试验的真值仍用留出组，保持独立）。
    const grandAgg = matrix.map((samples) => engine.aggregateRoundMetrics(samples));
    const grandScores = slot.candidates.map((_, index) =>
      engine.scoreCandidate(grandAgg[index + 1], weights, grandAgg[0]),
    );
    const grandBest = Math.max(...grandScores);
    const slotKind = grandBest > engine.TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE ? '有真提升' : '无提升';

    const record = {
      old: { claimed: [], truth: [], adopt: 0, hitBest: 0, regret: [], falseAdopt: 0 },
      racing: { claimed: [], truth: [], adopt: 0, hitBest: 0, regret: [], falseAdopt: 0, keepBest: 0, survivors: [] },
    };
    // 预算臂（§38）统计：每臂与 P 臂（= racing，同一 perm 切分）的决策一致数 + 真值侧指标。
    const armStats = Object.fromEntries(
      [P_ARM, ...budgetArms].map((arm) => [
        arm.name,
        { agree: 0, regret: [], keepBest: 0, survivors: [], falseAdopt: 0, pairedTruthDelta: [] },
      ]),
    );
    for (let trial = 0; trial < args.trials; trial += 1) {
      const perm = shuffle(seedIndices, rng);
      const screenIdx = perm.slice(0, SCREEN);
      const decideIdx = perm.slice(SCREEN, SCREEN + args.rounds);
      const holdIdx = perm.slice(SCREEN + args.rounds);
      const aggregate = (samples, idx) => engine.aggregateRoundMetrics(idx.map((i) => samples[i]));
      const screenAgg = matrix.map((samples) => aggregate(samples, screenIdx));
      const decideAgg = matrix.map((samples) => aggregate(samples, decideIdx));
      const truthAgg = matrix.map((samples) => aggregate(samples, holdIdx));
      const makeEntry = (candidate, configIndex, refAgg, agg) => ({
        ...candidate,
        metrics: agg[configIndex],
        score: engine.scoreCandidate(agg[configIndex], weights, refAgg),
        paired: engine.computePairedStats(agg[configIndex], refAgg, weights),
      });
      const truthScore = (configIndex) => engine.scoreCandidate(truthAgg[configIndex], weights, truthAgg[0]);
      const truthScores = slot.candidates.map((_, index) => truthScore(index + 1));
      const truthBestIndex = truthScores.indexOf(Math.max(...truthScores));

      // 旧路径：全候选进精测、取最高（racing 之前的行为；报告分与判据同源 ⇒ 选择偏差）。
      const oldEntries = slot.candidates.map((candidate, index) =>
        makeEntry(candidate, index + 1, decideAgg[0], decideAgg),
      );
      const oldWinner = [...oldEntries].sort(engine.compareCandidates)[0];
      const oldIndex = indexOf.get(oldWinner.signature);

      // racing：粗筛（独立 2 轮）→ top-K ∪ 锚点 → 精测（与旧路径**同一组**精测样本，判据预算对齐）。
      const screenEntries = slot.candidates.map((candidate, index) =>
        makeEntry(candidate, index + 1, screenAgg[0], screenAgg),
      );
      const survivors = engine.pickRacingSurvivors(screenEntries);
      const racingEntries = survivors.map((entry) =>
        makeEntry(entry, indexOf.get(entry.signature), decideAgg[0], decideAgg),
      );
      const racingWinner = [...racingEntries].sort(engine.compareCandidates)[0];
      const racingIndex = indexOf.get(racingWinner.signature);

      for (const [name, winner, winnerIndex] of [
        ['old', oldWinner, oldIndex],
        ['racing', racingWinner, racingIndex],
      ]) {
        const stats = record[name];
        const claimed = Number(winner.score);
        const truth = truthScore(winnerIndex);
        const adopted = engine.shouldAdoptCandidate(winner);
        stats.claimed.push(claimed);
        stats.truth.push(truth);
        if (adopted) stats.adopt += 1;
        if (adopted && truth <= 0) stats.falseAdopt += 1;
        if (winnerIndex === truthBestIndex + 1) stats.hitBest += 1;
        stats.regret.push(truthScores[truthBestIndex] - truth);
        // 条件选择偏差：只统计「选中了非锚点候选」的试验。0 分锚点的报告分/真实分恒为 0
        //（与参考同一配置，CRN 下逐轮差恰为 0），会把 winner's curse 无谓稀释 ——
        // 机制本身要在「真的挑了个候选」的试验里才看得见。
        if (Number(winner.distance) !== 0) {
          stats.biasNonAnchor ??= [];
          stats.biasNonAnchor.push(claimed - truth);
        }
      }
      record.racing.keepBest += survivors.some((entry) => indexOf.get(entry.signature) === truthBestIndex + 1) ? 1 : 0;
      record.racing.survivors.push(survivors.length);
      // ── 预算臂（§38）：同一切分下各臂「只少看前缀之后的样本」，筛选 keep 参数化、判据全走生产。
      const pWinner = racingWinner;
      const pAdopted = engine.shouldAdoptCandidate(pWinner);
      const pTruth = truthScore(racingIndex);
      // P 臂自身记账（基准行）：复现率恒 100%（与自己一致），真值侧指标与上面的 racing 同源。
      {
        const stats = armStats[P_ARM.name];
        stats.agree += 1;
        stats.falseAdopt += pAdopted && pTruth <= 0 ? 1 : 0;
        stats.regret.push(truthScores[truthBestIndex] - pTruth);
        stats.keepBest += survivors.some((entry) => indexOf.get(entry.signature) === truthBestIndex + 1) ? 1 : 0;
        stats.survivors.push(survivors.length);
      }
      for (const arm of budgetArms) {
        const armScreenAgg = matrix.map((samples) => aggregate(samples, screenIdx.slice(0, arm.screen)));
        const armDecideAgg = matrix.map((samples) => aggregate(samples, decideIdx.slice(0, arm.decide)));
        const armScreenEntries = slot.candidates.map((candidate, index) =>
          makeEntry(candidate, index + 1, armScreenAgg[0], armScreenAgg),
        );
        if (arm.keep === KEEP) {
          assert.deepEqual(
            pickSurvivorsWithKeep(armScreenEntries, KEEP).map((entry) => entry.signature),
            engine.pickRacingSurvivors(armScreenEntries).map((entry) => entry.signature),
            'keep 参数化副本与生产 pickRacingSurvivors 漂移',
          );
        }
        const armSurvivors = pickSurvivorsWithKeep(armScreenEntries, arm.keep);
        const armEntries = armSurvivors.map((entry) =>
          makeEntry(entry, indexOf.get(entry.signature), armDecideAgg[0], armDecideAgg),
        );
        const armWinner = [...armEntries].sort(engine.compareCandidates)[0];
        const armIndex = indexOf.get(armWinner.signature);
        const armAdopted = engine.shouldAdoptCandidate(armWinner);
        const armTruth = truthScore(armIndex);
        const stats = armStats[arm.name];
        stats.agree += armWinner.signature === pWinner.signature && armAdopted === pAdopted ? 1 : 0;
        stats.falseAdopt += armAdopted && armTruth <= 0 ? 1 : 0;
        stats.regret.push(truthScores[truthBestIndex] - armTruth);
        stats.keepBest += armSurvivors.some((entry) => indexOf.get(entry.signature) === truthBestIndex + 1) ? 1 : 0;
        stats.survivors.push(armSurvivors.length);
        stats.pairedTruthDelta.push(armTruth - pTruth);
      }
    }

    const pool = slot.candidates.length;
    const oldCost = pool * args.rounds;
    const racingSurvivorsMean = mean(record.racing.survivors);
    const racingCost = pool * SCREEN + racingSurvivorsMean * args.rounds;
    console.log('');
    const bestCandidate = slot.candidates[grandScores.indexOf(grandBest)];
    console.log(
      `槽位 ${slot.slotIndex}（${slot.abilityHrid}）候选 ${pool} 条 | 全体真实分 top1 = ${grandBest.toFixed(5)}（${slotKind}）| 真最优 = ${String(bestCandidate?.labelKey ?? '?').replace('common:triggerOptimizer.candidate.', '')} ${JSON.stringify(bestCandidate?.labelParams ?? {})}`,
    );
    console.log(
      `bootstrap ${args.trials} 次（粗筛 ${SCREEN} / 精测 ${args.rounds} / 留出 ${args.seeds - SCREEN - args.rounds}）`,
    );
    console.log('指标                        旧路径(全精测)      racing');
    const row = (label, oldText, racingText) =>
      console.log(`${label.padEnd(24)}${oldText.padStart(14)}${racingText.padStart(26)}`);
    // 分数是对数压缩的增量分，量级常在 1e-3 ~ 2e-2：5 位小数才看得见差异。
    const fixed = (value) => value.toFixed(5);
    const percent = (value) => `${(value * 100).toFixed(1)}%`;
    row('报告分均值（精测）', fixed(mean(record.old.claimed)), fixed(mean(record.racing.claimed)));
    row('真实分均值（留出）', fixed(mean(record.old.truth)), fixed(mean(record.racing.truth)));
    row(
      '选择偏差 报告−真实',
      fixed(mean(record.old.claimed) - mean(record.old.truth)),
      fixed(mean(record.racing.claimed) - mean(record.racing.truth)),
    );
    row(
      '偏差（非锚点选中时）',
      fixed(mean(record.old.biasNonAnchor ?? [])),
      fixed(mean(record.racing.biasNonAnchor ?? [])),
    );
    row(
      '非锚点选中率',
      percent((record.old.biasNonAnchor ?? []).length / args.trials),
      percent((record.racing.biasNonAnchor ?? []).length / args.trials),
    );
    row('采纳率', percent(record.old.adopt / args.trials), percent(record.racing.adopt / args.trials));
    row(
      '假采纳率（真实≤0）',
      percent(record.old.falseAdopt / args.trials),
      percent(record.racing.falseAdopt / args.trials),
    );
    row('选中真最优率', percent(record.old.hitBest / args.trials), percent(record.racing.hitBest / args.trials));
    row('regret 均值', fixed(mean(record.old.regret)), fixed(mean(record.racing.regret)));
    row('真最优进精测率', '—', percent(record.racing.keepBest / args.trials));
    const saving = (1 - racingCost / oldCost) * 100;
    row(
      '每槽每轮场次',
      String(oldCost),
      `${(pool * SCREEN).toFixed(0)}+${(racingSurvivorsMean * args.rounds).toFixed(0)}=${racingCost.toFixed(0)}（较旧${saving >= 0 ? '省' : '费'}${Math.abs(saving).toFixed(0)}%）`,
    );
    row('幸存者数（均值）', '—', racingSurvivorsMean.toFixed(2));

    // ── 预算臂判读（§38）：预注册判据 —— 复现率 ≥ 99% ∧ 假采纳率不升 ∧ 真实分Δ(臂−P) 均值 ≥ 0
    // ∧ 真最优进精测率不降 ⇒「同结论省时」成立；任一条不满足 ⇒ 该臂不实施（决策已变/质量已降）。
    //（场次口径与 §30.8 同款：pool×粗筛 + 幸存者均值×精测；参考侧另有 粗筛+精测 场，臂间同倍缩减。）
    const baseCost = pool * SCREEN + racingSurvivorsMean * args.rounds;
    console.log('');
    console.log(`预算缩减回放（${args.trials} trials × ${pool} 候选；screen/decide 取前缀；筛选/判据走生产）：`);
    console.log(
      '臂              粗筛/keep/精测   复现率   真最优进精测   假采纳     regret     真实分Δ(臂−P)             场次    省',
    );
    for (const arm of [P_ARM, ...budgetArms]) {
      const stats = armStats[arm.name];
      const survivorsMeanArm = mean(stats.survivors);
      const cost = pool * arm.screen + survivorsMeanArm * arm.decide;
      const saving = (1 - cost / baseCost) * 100;
      const delta = stats.pairedTruthDelta;
      const deltaMean = mean(delta);
      const deltaSe =
        delta.length > 1
          ? Math.sqrt(
              delta.reduce((sum, value) => sum + (value - deltaMean) ** 2, 0) / (delta.length - 1) / delta.length,
            )
          : 0;
      const tText = deltaSe > 0 ? `(t=${(deltaMean / deltaSe).toFixed(1)})` : '';
      const deltaText =
        arm === P_ARM ? '—' : `${deltaMean >= 0 ? '+' : ''}${fixed(deltaMean)}±${fixed(deltaSe)}${tText}`;
      console.log(
        `${arm.name.padEnd(14)}  ${`${arm.screen}/${arm.keep}/${arm.decide}`.padEnd(13)}  ${percent(stats.agree / args.trials).padStart(7)}` +
          `  ${percent(stats.keepBest / args.trials).padStart(11)}  ${percent(stats.falseAdopt / args.trials).padStart(7)}` +
          `  ${fixed(mean(stats.regret)).padStart(10)}  ${deltaText.padStart(25)}  ${cost.toFixed(0).padStart(5)}  ${arm === P_ARM ? '—' : `省${saving.toFixed(0)}%`}`,
      );
    }
    console.log(
      '判据（预注册）：复现率 ≥ 99% ∧ 假采纳率不升 ∧ 真实分Δ均值 ≥ 0 ∧ 真最优进精测率不降 ⇒「同结论省时」；否则不实施。',
    );

    // ── 复验追加功效（2026-09-24，设计 §31）──────────────────────────────────
    // 首轮复验判「未达显著」≠「没有提升」，只是 6 轮样本不足以判定。追加复验再采 6 轮**互不相交**
    // 的样本、与首轮合并成 12 轮重检（生产同款样本分割：verify 盐 → verify-append.vN 盐）。
    // 本段回答「这一追加值不值」，判据：真提升案例的确认率明显上升，且无提升案例的假阳性率不升。
    //   真提升案例 = 全体种子真实分 > MIN_ADOPT_SCORE（该候选真的值得采纳）；
    //   无提升案例 = 真实分 ≤ 0（改了等于没改 / 更差）—— 它被判「提升成立」就是假阳性。
    // 每试验抽 12 个互不相交的种子（6 首轮 + 6 追加），与生产的样本分割同构。合并重检相当于
    // 「最多追加 N 次」的序贯检验 —— 可选停时会不会把假阳性顶上去，正是这里假阳性率要回答的。
    const VERIFY_ROUNDS = 6;
    assert(args.seeds >= VERIFY_ROUNDS * 2, `--seeds 至少要 ${VERIFY_ROUNDS * 2}（首轮 + 追加各 ${VERIFY_ROUNDS}）`);
    const aggSubset = (samples, idx) => engine.aggregateRoundMetrics(idx.map((i) => samples[i]));
    const newBucket = (label) => ({
      label,
      cases: 0,
      trials: 0,
      firstPositive: 0,
      finalPositive: 0,
      firstInconclusive: 0,
      resolved: 0,
      rounds: 0,
    });
    const powerBuckets = { real: newBucket('真提升案例'), null: newBucket('无提升(null)') };
    for (let configIndex = 1; configIndex <= slot.candidates.length; configIndex += 1) {
      const trueScore = grandScores[configIndex - 1];
      const bucket =
        trueScore > engine.TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE
          ? powerBuckets.real
          : trueScore <= 0
            ? powerBuckets.null
            : null;
      // (0, MIN_ADOPT_SCORE] 的边缘案例两头都不进：判据要求案例方向明确。
      if (!bucket) continue;
      bucket.cases += 1;
      for (let trial = 0; trial < args.trials; trial += 1) {
        const perm = shuffle(seedIndices, rng);
        const firstIdx = perm.slice(0, VERIFY_ROUNDS);
        const appendIdx = perm.slice(VERIFY_ROUNDS, VERIFY_ROUNDS * 2);
        const verdictOf = (idx) =>
          engine.computePairedStats(aggSubset(matrix[configIndex], idx), aggSubset(matrix[0], idx), weights)?.score
            ?.verdict ?? 'unknown';
        bucket.trials += 1;
        const first = verdictOf(firstIdx);
        let final = first;
        bucket.rounds += VERIFY_ROUNDS;
        if (first === 'positive') bucket.firstPositive += 1;
        if (first === 'inconclusive') {
          bucket.firstInconclusive += 1;
          final = verdictOf([...firstIdx, ...appendIdx]);
          bucket.rounds += VERIFY_ROUNDS;
          if (final !== 'inconclusive') bucket.resolved += 1;
        }
        if (final === 'positive') bucket.finalPositive += 1;
      }
    }
    // 桶为空（该槽没有这个方向的候选，或首轮从未未达显著）时一律显示「—」：0.00 / 0.0% 会被读成
    // 「测过且是零」，而事实是**没得测**（本研究表明：无提升槽的真提升桶可能整桶为空）。
    const bucketRate = (bucket, count) => (bucket.trials === 0 ? '—' : percent(count / bucket.trials));
    const resolvedRate = (bucket) =>
      bucket.firstInconclusive === 0 ? '—' : percent(bucket.resolved / bucket.firstInconclusive);
    const roundsPerSide = (bucket) => (bucket.trials === 0 ? '—' : (bucket.rounds / bucket.trials).toFixed(2));
    const powerRow = (label, realText, nullText) =>
      console.log(`${label.padEnd(28)}${realText.padStart(12)}${nullText.padStart(18)}`);
    console.log('');
    console.log(
      `复验追加功效（首轮 ${VERIFY_ROUNDS} 轮 → 未达显著再追加 ${VERIFY_ROUNDS} 轮合并 ${VERIFY_ROUNDS * 2} 轮重检；每案例 ${args.trials} 次试验）`,
    );
    console.log('指标                            真提升案例      无提升(null)');
    powerRow('案例数（候选数）', String(powerBuckets.real.cases), String(powerBuckets.null.cases));
    powerRow(
      '首轮判「提升成立」',
      bucketRate(powerBuckets.real, powerBuckets.real.firstPositive),
      bucketRate(powerBuckets.null, powerBuckets.null.firstPositive),
    );
    powerRow(
      '累计判「提升成立」',
      bucketRate(powerBuckets.real, powerBuckets.real.finalPositive),
      bucketRate(powerBuckets.null, powerBuckets.null.finalPositive),
    );
    powerRow(
      '首轮未达显著',
      bucketRate(powerBuckets.real, powerBuckets.real.firstInconclusive),
      bucketRate(powerBuckets.null, powerBuckets.null.firstInconclusive),
    );
    powerRow('解析率(未达显著→明确)', resolvedRate(powerBuckets.real), resolvedRate(powerBuckets.null));
    powerRow('期望轮数/侧', roundsPerSide(powerBuckets.real), roundsPerSide(powerBuckets.null));
    console.log(
      '判读：null 桶的「判提升成立」= 假阳性率，判据是**累计 ≤ 5% 且不高于首轮**（可选停时不得推高假阳性）；',
    );
    console.log(
      '      真提升桶「累计 − 首轮」= 追加复验买到的确认率。期望轮数/侧 = 6 + 6 × P(首轮未达显著)，总场次 = ×2 配置。',
    );
    console.log('      空桶（案例数 0 / 从未未达显著）显示「—」= 没得测，不是「测过且为零」。');

    // ── 复验轮数自适应对照（2026-09-25，设计 §47）────────────────────────────────
    // 现状（§31）＝首轮 6 轮判 inconclusive 后**固定**再采 6 轮、合并成 12 轮重检。
    // 本轮问：改成「按需」再采（由生产反解函数算出「判成明确结论至少需要多少轮」）能不能用更少
    // 的样本拿到同样的解析率，或在上限内多解析一些案例。三条臂共享同一批样本与同一套判据：
    //   F  ：现状（追加 6 → 合计 12 轮）
    //   A  ：按需（n* ≤ 上限才追加到 n*；模型说不够就不花样本，留在 inconclusive）
    //   A′ ：按需 + 保底（max(n*, 12) 轮，封顶上限）
    // 判据（预注册，跑正式采样前定稿）：
    //   ① 假阳性不升（硬）：null 桶「累计判提升成立」≤ 首轮值；
    //   ② 解析率（两桶合计，「首轮未达显著 → 明确结论」）≥ F 臂；
    //   ③ 成本：复验额外场次 = 2 ×（期望轮数/侧 − 6）—— 绝对量级报告；实施时另加运行期护栏
    //      「额外场次 ≤ 整轮运行估算的 20%」（快档运行只有 ~74 场，24 轮上限对它是 48% ⇒ 护栏必需）。
    // 过闸的臂里取解析率最高者；都不过 ⇒ 不实施，如实汇报。
    {
      const CAP = engine.TRIGGER_OPTIMIZER_VERIFY_MAX_ROUNDS;
      const BASE_TOTAL = VERIFY_ROUNDS * 2;
      assert(CAP >= BASE_TOTAL, `复验上限 ${CAP} 装不下今天的 ${BASE_TOTAL} 轮口径`);
      assert(args.seeds >= CAP, `--seeds 至少要 ${CAP}（按需臂最坏要 CAP 个互不相交的种子，当前 ${args.seeds}）`);
      const armNames = ['F', 'A', 'A_prime'];
      const armLabel = { F: 'F', A: 'A', A_prime: 'A′' };
      const newArmStats = () =>
        Object.fromEntries(
          armNames.map((name) => [
            name,
            { trials: 0, firstInconclusive: 0, resolved: 0, positive: 0, rounds: 0, extended: 0 },
          ]),
        );
      const arms = { real: newArmStats(), null: newArmStats() };
      const first = { real: { trials: 0, positive: 0 }, null: { trials: 0, positive: 0 } };
      const adaptive = { planned: 0, capped: 0, meanRequired: 0 };
      // 独立随机流：本段的 perm 切分不扰动既有的 §30.8/§31 段（那两段的数字要保持可复现）。
      const adaptiveRng = createSeededRandom(20260925);
      const summaryOf = (configIndex, idx) =>
        engine.computePairedStats(aggSubset(matrix[configIndex], idx), aggSubset(matrix[0], idx), weights)?.score ??
        null;
      for (let configIndex = 1; configIndex <= slot.candidates.length; configIndex += 1) {
        const trueScore = grandScores[configIndex - 1];
        const kind = trueScore > engine.TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE ? 'real' : trueScore <= 0 ? 'null' : null;
        if (!kind) continue;
        const bucket = arms[kind];
        for (let trial = 0; trial < args.trials; trial += 1) {
          const perm = shuffle(seedIndices, adaptiveRng);
          const firstIdx = perm.slice(0, VERIFY_ROUNDS);
          const firstSummary = summaryOf(configIndex, firstIdx);
          const firstVerdict = String(firstSummary?.verdict ?? 'unknown');
          const plan = engine.resolveTriggerOptimizerVerificationRounds(firstSummary, CAP);
          if (plan?.extend) {
            adaptive.planned += 1;
            adaptive.meanRequired += plan.requiredRounds;
          } else if (plan?.capped) {
            adaptive.capped += 1;
          }
          first[kind].trials += 1;
          if (firstVerdict === 'positive') first[kind].positive += 1;
          const totalOf = (arm) => {
            if (firstVerdict !== 'inconclusive') return VERIFY_ROUNDS;
            if (arm === 'F') return BASE_TOTAL;
            if (arm === 'A') return plan?.extend ? plan.requiredRounds : VERIFY_ROUNDS;
            return Math.min(CAP, Math.max(plan?.requiredRounds ?? CAP, BASE_TOTAL));
          };
          for (const arm of armNames) {
            const total = totalOf(arm);
            const stats = bucket[arm];
            const finalVerdict =
              total === VERIFY_ROUNDS
                ? firstVerdict
                : String(summaryOf(configIndex, perm.slice(0, total))?.verdict ?? 'unknown');
            stats.trials += 1;
            stats.rounds += total;
            if (total > VERIFY_ROUNDS) stats.extended += 1;
            if (firstVerdict === 'inconclusive') {
              stats.firstInconclusive += 1;
              if (finalVerdict !== 'inconclusive') stats.resolved += 1;
            }
            if (finalVerdict === 'positive') stats.positive += 1;
          }
        }
      }
      const rate = (count, denominator) => (denominator === 0 ? '—' : percent(count / denominator));
      const perSide = (stats) => (stats.trials === 0 ? '—' : (stats.rounds / stats.trials).toFixed(2));
      console.log('');
      console.log(
        `复验轮数自适应对照（上限 ${CAP} 轮；每案例 ${args.trials} 次试验；F = 现状 12 轮 / A = 按需 / A′ = 按需+保底）`,
      );
      console.log(
        '臂     真提升:解析率  真提升:累计成立  真提升:轮数/侧   null:解析率   null:假阳性   null:轮数/侧    追加率',
      );
      for (const arm of armNames) {
        const real = arms.real[arm];
        const nul = arms.null[arm];
        console.log(
          `${armLabel[arm].padEnd(5)} ${rate(real.resolved, real.firstInconclusive).padStart(12)} ${rate(
            real.positive,
            real.trials,
          ).padStart(15)} ${perSide(real).padStart(13)} ${rate(nul.resolved, nul.firstInconclusive).padStart(
            12,
          )} ${rate(nul.positive, nul.trials).padStart(11)} ${perSide(nul).padStart(12)} ${rate(
            real.extended + nul.extended,
            real.trials + nul.trials,
          ).padStart(9)}`,
        );
      }
      console.log(
        `  首轮（${VERIFY_ROUNDS} 轮）基准：真提升桶 ${rate(first.real.positive, first.real.trials)} 判成立；null 桶假阳性 ${rate(
          first.null.positive,
          first.null.trials,
        )}`,
      );
      console.log(
        `  反解统计：计划追加 ${adaptive.planned} 次（平均要 ${
          adaptive.planned ? (adaptive.meanRequired / adaptive.planned).toFixed(1) : '—'
        } 轮）｜反解说「上限也不够」${adaptive.capped} 次`,
      );
      const pooled = (arm) => {
        const real = arms.real[arm];
        const nul = arms.null[arm];
        return {
          resolved: real.resolved + nul.resolved,
          inconclusive: real.firstInconclusive + nul.firstInconclusive,
          rounds: (real.rounds + nul.rounds) / Math.max(1, real.trials + nul.trials),
        };
      };
      for (const arm of armNames) {
        const stats = pooled(arm);
        console.log(
          `  合计口径 ${armLabel[arm]}：解析率 ${rate(stats.resolved, stats.inconclusive)}（${
            stats.resolved
          }/${stats.inconclusive}）｜期望轮数/侧 ${stats.rounds.toFixed(2)}｜复验额外场次 ${
            stats.rounds > VERIFY_ROUNDS ? ((stats.rounds - VERIFY_ROUNDS) * 2).toFixed(1) : '0.0'
          } 场`,
        );
      }
      console.log(
        '判读（预注册）：① 假阳性不升（硬）② 合计解析率 ≥ F ③ 额外场次 ≤ 整轮估算 20%（实施时另加护栏）⇒ 过闸里取解析率最高者；都不过 ⇒ 不实施。',
      );
    }

    // ── 复核轮数自适应对照（2026-09-25，设计 §49）────────────────────────────────
    // 现状（§29）＝换难度复核固定 6 轮。本轮问：由报告已有的复验统计反解「换到相邻难度要多少
    // 轮才能把同量级的效应判成明确结论」（口径 |mean| > t(n−1) × SE × √(6/n)，与 §47 同一把
    // 尺子），能不能用可控的额外样本提高复核的解析率、且假阳性不升。三条臂共享同一批样本与
    // 同一套判据（目标难度上的新样本；先验样本与判据样本来自不同难度、天然独立）：
    //   F   ：现状（固定 6 轮）
    //   A′  ：按需 + 保底（min(上限, max(n*, 保底)) 轮；反解「上限也不够」→ 补到上限）
    //   F12 ：固定跑满上限（参照臂，不参与裁决 —— 看 A′ 离「总是跑满」有多远；标签随常量为 F16）
    // 判据（预注册，跑正式采样前定稿）：
    //   ① 假阳性不升（硬）：null 桶「判提升成立」（在目标难度上）≤ F 臂；
    //   ② 解析率：真提升桶「判提升成立」≥ F 臂；
    //   （成本：额外场次 = 2 ×（期望轮数/侧 − 6），只做绝对量级报告；实施时护栏「多花 ≤ 整轮 20%」。）
    // 过闸的臂里取解析率最高者；都不过 ⇒ 不实施，如实汇报。
    if (robustTier != null) {
      const CAP = engine.TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS;
      const BASE = engine.TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS;
      assert(CAP >= BASE, `复核上限 ${CAP} 装不下现状 ${BASE} 轮口径`);
      assert(args.seeds >= CAP + BASE, `--seeds 至少要 ${CAP + BASE}（先验切 ${BASE} + 判据最坏切 ${CAP}）`);
      const robustMatrix = [samplesByKey.get('robust|baseline')];
      for (const candidate of slot.candidates) {
        robustMatrix.push(samplesByKey.get(`robust|${slot.slotIndex}|${candidate.signature}`));
      }
      for (const samples of robustMatrix) {
        assert.equal(samples?.length, args.seeds, `槽位 ${slot.slotIndex} 复核样本缺失`);
      }
      const robustGrandScores = slot.candidates.map((_, index) =>
        engine.scoreCandidate(
          engine.aggregateRoundMetrics(robustMatrix[index + 1]),
          weights,
          engine.aggregateRoundMetrics(robustMatrix[0]),
        ),
      );
      const armNames = ['F', 'A_prime', 'F12'];
      const armLabel = { F: 'F', A_prime: 'A′', F12: `F${CAP}` };
      const newRobustArm = () => ({
        trials: 0,
        positive: 0,
        inconclusive: 0,
        fInconclusive: 0,
        rounds: 0,
        resolved: 0,
      });
      const robustArms = { real: {}, null: {} };
      for (const kind of ['real', 'null']) {
        for (const name of armNames) robustArms[kind][name] = newRobustArm();
      }
      const robustAdaptive = { planned: 0, capped: 0, meanRequired: 0, base: 0 };
      // 独立随机流：本段的 perm 切分不扰动既有段（§30.8 / §31 / §47）的数字。
      const robustRng = createSeededRandom(20260926);
      const priorSummaryOf = (configIndex, idx) =>
        engine.computePairedStats(aggSubset(matrix[configIndex], idx), aggSubset(matrix[0], idx), weights)?.score ??
        null;
      const robustVerdictOf = (configIndex, idx) =>
        String(
          engine.computePairedStats(aggSubset(robustMatrix[configIndex], idx), aggSubset(robustMatrix[0], idx), weights)
            ?.score?.verdict ?? 'unknown',
        );
      for (let configIndex = 1; configIndex <= slot.candidates.length; configIndex += 1) {
        const trueScore = robustGrandScores[configIndex - 1];
        const kind = trueScore > engine.TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE ? 'real' : trueScore <= 0 ? 'null' : null;
        if (!kind) continue;
        const bucket = robustArms[kind];
        for (let trial = 0; trial < args.trials; trial += 1) {
          // 先验 = 搜索难度上切 6 轮算出的复验统计 —— 模拟「报告里已有的那份复验」。
          const prior = priorSummaryOf(configIndex, shuffle(seedIndices, robustRng).slice(0, BASE));
          const plan = engine.planTriggerOptimizerRobustnessRounds(prior, { maxRounds: CAP });
          if (plan) {
            robustAdaptive.planned += 1;
            if (plan.capped) robustAdaptive.capped += 1;
            else robustAdaptive.meanRequired += plan.requiredRounds;
          } else {
            robustAdaptive.base += 1;
          }
          const plannedRounds = plan ? Math.min(CAP, Math.max(BASE, plan.plannedRounds)) : BASE;
          // 判据样本 = 目标难度上的新样本；三臂共享同一 perm 前缀（逐例配对对照）。
          const perm = shuffle(seedIndices, robustRng);
          const fVerdict = robustVerdictOf(configIndex, perm.slice(0, BASE));
          const verdictAt = (count) => (count === BASE ? fVerdict : robustVerdictOf(configIndex, perm.slice(0, count)));
          const aVerdict = verdictAt(plannedRounds);
          const fullVerdict = plannedRounds === CAP ? aVerdict : verdictAt(CAP);
          for (const arm of armNames) {
            const stats = bucket[arm];
            const verdict = arm === 'F' ? fVerdict : arm === 'A_prime' ? aVerdict : fullVerdict;
            const rounds = arm === 'F' ? BASE : arm === 'A_prime' ? plannedRounds : CAP;
            stats.trials += 1;
            stats.rounds += rounds;
            if (verdict === 'positive') stats.positive += 1;
            if (verdict === 'inconclusive') stats.inconclusive += 1;
            // 「F 判不出 → 本臂判出明确结论」：自适应买到的额外确认（F 臂自身恒为 0）。
            // 分母是「F 判定不了的那些次试验」（fInconclusive）—— 不能拿本臂自己的未达显著次数当分母：
            // 两者基数不同（跑满上限的臂几乎总能给出结论、自己的未达显著次数接近 0），比值会 > 100%
            // 而失去意义（2026-09-25 首跑就打出 4160%）。该列只作参照、不参与裁决。
            if (fVerdict === 'inconclusive') {
              stats.fInconclusive += 1;
              if (verdict !== 'inconclusive') stats.resolved += 1;
            }
          }
        }
      }
      const rate = (count, denominator) => (denominator === 0 ? '—' : percent(count / denominator));
      const perSide = (stats) => (stats.trials === 0 ? '—' : (stats.rounds / stats.trials).toFixed(2));
      console.log('');
      console.log(
        `复核轮数自适应对照（目标难度 tier ${robustTier}；上限 ${CAP} 轮；每案例 ${args.trials} 次试验；F = 现状 ${BASE} 轮 / A′ = 按需+保底 / ${armLabel.F12} = 固定 ${CAP} 轮参照）`,
      );
      console.log('臂      真提升:判成立   真提升:轮数/侧    null:假阳性    null:轮数/侧    F判不出→本臂判出');
      for (const arm of armNames) {
        const real = robustArms.real[arm];
        const nul = robustArms.null[arm];
        console.log(
          `${armLabel[arm].padEnd(6)} ${rate(real.positive, real.trials).padStart(13)} ${perSide(real).padStart(
            15,
          )} ${rate(nul.positive, nul.trials).padStart(14)} ${perSide(nul).padStart(14)} ${rate(
            real.resolved,
            real.fInconclusive,
          ).padStart(17)}`,
        );
      }
      const resolvable = robustAdaptive.planned - robustAdaptive.capped;
      console.log(
        `  反解统计：有计划 ${robustAdaptive.planned} 次（其中上限也不够 ${robustAdaptive.capped} 次 → 补到上限）｜可反解时平均要 ${
          resolvable > 0 ? (robustAdaptive.meanRequired / resolvable).toFixed(1) : '—'
        } 轮｜先验退化 ${robustAdaptive.base} 次（保持 ${BASE} 轮）`,
      );
      const pooledRounds = (arm) => {
        const real = robustArms.real[arm];
        const nul = robustArms.null[arm];
        const trials = real.trials + nul.trials;
        return trials === 0 ? null : (real.rounds + nul.rounds) / trials;
      };
      for (const arm of armNames) {
        const rounds = pooledRounds(arm);
        console.log(
          `  合计口径 ${armLabel[arm]}：期望轮数/侧 ${rounds === null ? '—' : rounds.toFixed(2)}｜复核额外场次 ${
            rounds === null ? '—' : (Math.max(0, rounds - BASE) * 2).toFixed(1)
          } 场`,
        );
      }
      console.log(
        `判读（预注册）：① 假阳性不升（硬）② 真提升判成立 ≥ F ⇒ 实施 A′；都不过 ⇒ 不实施。${armLabel.F12} 列只作参照。`,
      );
    } else {
      console.log('');
      console.log('复核轮数自适应对照：本区域解析不出相邻难度（顶档/未知），跳过。');
    }

    // ── 追加复验堆叠对照（2026-09-26，设计 §50）────────────────────────────────
    // 现状（§47）有两条成本缺口：
    //   ① 单次护栏 ≠ 累计护栏：常规路径（复验统计正常）的累计成本没有显式上限 —— 由 24 轮上限
    //      推出的隐式上界是净增 18 轮 = 36 场（快档整轮 74 场的 49%，§47 引用的量级）；
    //   ② **零差路径无上界**（2026-09-26 冒烟实测抓到）：复验样本逐轮差恒 0（stdError = 0）时
    //      resolve 返回 null → store 不早退、按服务层缺省每次 +6 轮兜底 —— 这条路径不受 24 轮
    //      上限约束（零差样本永远 inconclusive、按钮一直在），可以无限追加。
    // 本项两条改动一起测：B-1 零差不再返回 null（视为 capped，补到上限）；B-2 护栏升级为
    // 「累计已花 + 本次 ≤ 整轮 20%」。三臂共享同一批样本与同一套判据（同一 perm 切分；策略 =
    // 一路未达显著就继续点到停，模拟最执着的用户）：
    //   F1 ：现状（单次护栏；零差走「+6 轮兜底」—— 本模拟按 24 轮统一截断，成本是保守下界）
    //   P1 ：本项口径（B-1 + B-2：零差视为 capped 补到上限；累计预算 = 整轮 20%）
    //   P2 ：参照臂（B-1 同 P1，只把累计比例放宽到 40%）—— 回答「20% 是不是收得比必要更紧」：
    //        20% / 40% / 不咬（451 档）三点一次采样给出损失曲线。
    // 预算档取两个量级：74（快档 4h 整轮场次量级）与 451（标准档夹具整轮量级；两比例都不咬 ⇒
    // 常规路径三臂必须逐值一致 —— 「不咬时护栏公式无影响」自证；零差处置是定义差异，除外）。
    // 判据（预注册，跑正式采样前定稿）：
    //   ① 假阳性不升（硬）：null 桶「最终判成立」P1 ≤ F1（74 档）；
    //   ② 解析率非劣：real 桶「首轮未达显著 → 最终明确」P1 ≥ F1 − 2pp（74 档）；
    //   ③ 成本：P1 期望累计额外场次 ≤ floor(74 × 20%) = 14（构造保证）+ 报告 F1 实测；
    //   ④ 自证：451 档常规路径（非零差试次）F1 / P1 / P2 逐值一致。
    // 读表方式（诚实边界）：解析率只有 **real 桶（真提升候选）** 才是「用户要的能力」；null 桶的
    // 「明确」含 negative —— 对 null 候选判负是好事，提前停让部分案例停在 inconclusive 不构成
    // 假阳性问题（假阳性看「判成立」列）。判负因此单列一行观测。若槽里解析不出相邻难度（real
    // 桶为空），合计口径只剩 null 桶 ⇒ 该槽解析率偏悲观，不作主据。
    // 过闸 → 实施两条改动；不过 → 不实施，如实汇报。
    {
      const CAP = engine.TRIGGER_OPTIMIZER_VERIFY_MAX_ROUNDS;
      assert(args.seeds >= CAP, `--seeds 至少要 ${CAP}（堆叠模拟最坏要切到 ${CAP} 个互斥种子）`);
      const budgets = [74, 451];
      const armNames = ['F1', 'P1', 'P2'];
      const newStackArm = () => ({
        trials: 0,
        firstInconclusive: 0,
        resolved: 0,
        positive: 0,
        rounds: 0,
        spent: 0,
        steps: 0,
        negative: 0,
        // 常规路径（首轮非零差）子统计：451 档的自证只对这部分成立（零差处置是两臂的定义差异）。
        regular: {
          trials: 0,
          firstInconclusive: 0,
          resolved: 0,
          positive: 0,
          negative: 0,
          rounds: 0,
          spent: 0,
          steps: 0,
        },
      });
      const stacks = budgets.map(() => ({ real: {}, null: {} }));
      for (const stats of stacks) {
        for (const kind of ['real', 'null']) {
          for (const name of armNames) stats[kind][name] = newStackArm();
        }
      }
      // 零差案例（首轮 stdError = 0）的单列统计：占比 + 两臂处置代价（现状 +6 兜底 vs 补到上限）。
      const zeroStats = budgets.map(() => ({
        trials: 0,
        f1Resolved: 0,
        p1Resolved: 0,
        p2Resolved: 0,
        f1Spent: 0,
        p1Spent: 0,
        p2Spent: 0,
      }));
      const tally = (group, { total, spent, steps, firstInconclusive, verdict }) => {
        group.trials += 1;
        group.rounds += total;
        group.spent += spent;
        group.steps += steps;
        if (firstInconclusive) {
          group.firstInconclusive += 1;
          if (verdict !== 'inconclusive') group.resolved += 1;
        }
        if (verdict === 'positive') group.positive += 1;
        if (verdict === 'negative') group.negative += 1;
      };
      // 独立随机流：本段的 perm 切分不扰动既有段（§30.8 / §31 / §47 / §49）的数字。
      const stackRng = createSeededRandom(20260927);
      for (let configIndex = 1; configIndex <= slot.candidates.length; configIndex += 1) {
        const trueScore = grandScores[configIndex - 1];
        const kind = trueScore > engine.TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE ? 'real' : trueScore <= 0 ? 'null' : null;
        if (!kind) continue;
        for (let trial = 0; trial < args.trials; trial += 1) {
          const perm = shuffle(seedIndices, stackRng);
          // 每次试验的 summary 缓存（同一 total 只算一次）：两臂 × 两预算共享同一批切分。
          const summaryCache = new Map();
          const summaryAt = (total) => {
            if (!summaryCache.has(total)) {
              summaryCache.set(
                total,
                engine.computePairedStats(
                  aggSubset(matrix[configIndex], perm.slice(0, total)),
                  aggSubset(matrix[0], perm.slice(0, total)),
                  weights,
                )?.score ?? null,
              );
            }
            return summaryCache.get(total);
          };
          // 零差案例：首轮复验样本逐轮差恒 0（stdError = 0）—— 现状与 P1 的处置在这里分叉。
          const zero = Number(summaryAt(VERIFY_ROUNDS)?.stdError) === 0;
          for (const [budgetIndex, wholeRun] of budgets.entries()) {
            const run = (arm) => {
              let total = VERIFY_ROUNDS;
              let spent = 0;
              let steps = 0;
              let verdict = String(summaryAt(total)?.verdict ?? 'unknown');
              const firstInconclusive = verdict === 'inconclusive';
              while (verdict === 'inconclusive') {
                const plan = engine.planTriggerOptimizerVerificationAppend(summaryAt(total), {
                  maxRounds: CAP,
                  wholeRunSimulations: wholeRun,
                });
                let planned;
                if (plan) {
                  planned = plan.plannedRounds;
                } else {
                  // plan 为 null 只剩「零差 / 退化字段」一条路：F1 = 服务层缺省 +6 轮兜底（无上界）；
                  // P1 / P2（B-1）= 视为 capped（补到上限）。两条路都在下面统一截断在 24 轮。
                  planned = arm === 'F1' ? VERIFY_ROUNDS : CAP - total;
                }
                if (arm !== 'F1') {
                  // 累计护栏（B-2）：累计已花 + 本次 ≤ 整轮 × budgetRatio ⇒ 本次轮数再钳一步。
                  //   P1 = 20%（B-2 口径）；P2 = 40%（参照臂：B-1 同 P1，只放宽累计比例）。
                  // 单次上限不在这里另设：常规路径已烘焙在 plan.plannedRounds 里（生产值 = 整轮 20%）；
                  // 零差路径 plan 为 null、上面按「补到上限」取值，再受这里的累计钳位。
                  const budgetRatio = arm === 'P2' ? 0.4 : 0.2;
                  const cumulative = Math.floor(wholeRun * budgetRatio);
                  planned = Math.min(planned, Math.floor(Math.max(0, cumulative - spent) / 2));
                }
                // 统一截断在 24 轮：现状的零差兜底路径不受 capRounds 约束（可无限追加），本模拟按
                // 24 轮截断 —— F1 的成本因此是保守下界（真实只会更高，这正是 ② 要修掉的东西）。
                planned = Math.min(planned, CAP - total);
                if (planned < 1) break;
                total += planned;
                spent += 2 * planned;
                steps += 1;
                assert(total <= CAP, `堆叠模拟越过 ${CAP} 轮上限（${total}）——与 capRounds 语义不符`);
                verdict = String(summaryAt(total)?.verdict ?? 'unknown');
              }
              const outcome = { total, spent, steps, firstInconclusive, verdict };
              tally(stacks[budgetIndex][kind][arm], outcome);
              if (!zero) tally(stacks[budgetIndex][kind][arm].regular, outcome);
              return outcome;
            };
            const f1Run = run('F1');
            const p1Run = run('P1');
            const p2Run = run('P2');
            if (zero) {
              const stats = zeroStats[budgetIndex];
              stats.trials += 1;
              stats.f1Resolved += f1Run.verdict !== 'inconclusive' ? 1 : 0;
              stats.p1Resolved += p1Run.verdict !== 'inconclusive' ? 1 : 0;
              stats.p2Resolved += p2Run.verdict !== 'inconclusive' ? 1 : 0;
              stats.f1Spent += f1Run.spent;
              stats.p1Spent += p1Run.spent;
              stats.p2Spent += p2Run.spent;
            }
          }
        }
      }
      // 自证：451 档两个比例都不咬（36 ≤ 90 ≤ 180）⇒ 常规路径（非零差试次）P1 / P2 与 F1 逐值一致。
      for (const kind of ['real', 'null']) {
        for (const arm of ['P1', 'P2']) {
          assert.deepStrictEqual(
            stacks[1][kind][arm].regular,
            stacks[1][kind].F1.regular,
            `预算 451 档 ${kind} 桶常规路径 ${arm} 与 F1 不一致——实现漂移`,
          );
        }
      }
      const stackRate = (count, denominator) => (denominator === 0 ? '—' : percent(count / denominator));
      const stackPer = (stats, key) => (stats.trials === 0 ? '—' : (stats[key] / stats.trials).toFixed(2));
      const pooledResolved = (budgetIndex, arm) => {
        const real = stacks[budgetIndex].real[arm];
        const nul = stacks[budgetIndex].null[arm];
        return { resolved: real.resolved + nul.resolved, base: real.firstInconclusive + nul.firstInconclusive };
      };
      console.log('');
      console.log(`追加复验堆叠对照（策略 = 一路未达显著就继续点到停；每案例 ${args.trials} 次试验；上限 ${CAP} 轮）`);
      for (const [budgetIndex, wholeRun] of budgets.entries()) {
        const real = stacks[budgetIndex].real;
        const nul = stacks[budgetIndex].null;
        // 成本两列用**全案例（real + null 桶）**口径：real 桶为空（解析不出相邻难度）时同样有值，
        // 且「用户点追加」本来就不只发生在真提升桶 —— 只统计 real 桶会漏掉零差与假候选的花费。
        const pooled = (arm) => {
          const r = real[arm];
          const n = nul[arm];
          return { trials: r.trials + n.trials, spent: r.spent + n.spent, steps: r.steps + n.steps };
        };
        console.log(
          `预算 ${wholeRun} 场（累计护栏：P1 ${Math.floor(wholeRun * 0.2)} 场 / P2 ${Math.floor(wholeRun * 0.4)} 场${
            budgetIndex === 1 ? '；都不咬 ⇒ 常规路径三臂逐值一致' : ''
          }）`,
        );
        console.log(
          '臂      真提升:解析率   真提升:判成立   真提升:轮数/侧    null:假阳性    null:轮数/侧   累计额外场次(全案例)    点击次数(全案例)',
        );
        for (const arm of armNames) {
          console.log(
            `${arm.padEnd(6)} ${stackRate(real[arm].resolved, real[arm].firstInconclusive).padStart(12)} ` +
              `${stackRate(real[arm].positive, real[arm].trials).padStart(15)} ${stackPer(real[arm], 'rounds').padStart(16)} ` +
              `${stackRate(nul[arm].positive, nul[arm].trials).padStart(13)} ${stackPer(nul[arm], 'rounds').padStart(14)} ` +
              `${stackPer(pooled(arm), 'spent').padStart(20)} ${stackPer(pooled(arm), 'steps').padStart(16)}`,
          );
        }
        const f1 = pooledResolved(budgetIndex, 'F1');
        const summary = armNames.map((arm) => {
          const item = pooledResolved(budgetIndex, arm);
          const delta =
            arm === 'F1' || f1.base === 0 || item.base === 0
              ? ''
              : `（Δ = ${((item.resolved / item.base - f1.resolved / f1.base) * 100).toFixed(1)} pp）`;
          return `${arm} ${stackRate(item.resolved, item.base)}（${item.resolved}/${item.base}）${delta}`;
        });
        console.log(`  合计口径（全案例）：${summary.join('｜')}`);
        console.log(
          `  成本（全案例）：F1 期望额外场次 ${stackPer(pooled('F1'), 'spent')}（常规路径理论上界 36；零差现状无上界，本模拟截断在 24 轮 ⇒ 保守下界）｜` +
            `P1 ${stackPer(pooled('P1'), 'spent')}（累计护栏 ${Math.floor(wholeRun * 0.2)} 场）｜` +
            `P2 ${stackPer(pooled('P2'), 'spent')}（累计护栏 ${Math.floor(wholeRun * 0.4)} 场）`,
        );
        console.log(
          `  判负：real 桶次数 F1 ${real.F1.negative} / P1 ${real.P1.negative} / P2 ${real.P2.negative}｜` +
            `null 桶判负率 F1 ${stackRate(nul.F1.negative, nul.F1.trials)} / P1 ${stackRate(
              nul.P1.negative,
              nul.P1.trials,
            )} / P2 ${stackRate(nul.P2.negative, nul.P2.trials)}`,
        );
        const z = zeroStats[budgetIndex];
        const trialsTotal = real.F1.trials + nul.F1.trials;
        const zeroSpent = (value) => (z.trials ? (value / z.trials).toFixed(1) : '—');
        console.log(
          `  零差案例（首轮 stdError = 0）：${stackRate(z.trials, trialsTotal)}（${z.trials}/${trialsTotal}）｜` +
            `F1 +6 兜底：判出 ${z.f1Resolved} 次、平均 ${zeroSpent(z.f1Spent)} 场｜` +
            `P1 补到上限：判出 ${z.p1Resolved} 次、平均 ${zeroSpent(z.p1Spent)} 场｜` +
            `P2（40% 参照）补到上限：判出 ${z.p2Resolved} 次、平均 ${zeroSpent(z.p2Spent)} 场`,
        );
      }
      console.log(
        '判读（预注册）：① 假阳性不升（硬）② real 桶合计解析率 P1 ≥ F1 − 2pp ③ P1 期望额外场次 ≤ 14（74 场档，构造保证）④ 451 档常规路径三臂逐值一致 ⇒ 实施 B-1 + B-2；否则不实施。',
      );
      console.log(
        '参照 P2（累计 40%）：P2 解析率明显高于 P1 且假阳性不升 ⇒ B-2 比例定 40%；P2 ≈ P1 ⇒ 20% 即可（多出的累计预算没换来知道）。F1 成本为保守下界（零差现状无上界，本模拟截断在 24 轮）。',
      );
    }

    // ── 复核复跑与零差先验对照（2026-09-26，设计 §51，B-2 项）──────────────────────
    // 被审计的两条结构缺陷（本段全部用生产实现逐值复算，脚本里不另抄口径）：
    //   ① **复跑恒等、满价、覆盖留档**：复核种子 = createTriggerOptimizerSeedSet(玩家 id + 已佩戴
    //      技能 + 区域/难度/时长 + 盐)，盐固定、难度固定（相邻难度）、轮数由同一份先验反解 ⇒ 同一
    //      报告的第二次复核产出与第一次**逐值相同**（本段自证两半：种子派生确定性 + 同 payload/种子
    //      → 同一样本），成本照付 2 × plannedRounds 场（6 轮档 12 场 / 上限档 24 场）；且 store 开跑
    //      前把上一份结果清空 ⇒ 覆盖式留档（中途取消连上一次的结论都没了）。
    //   ② **零差先验没有出口**：先验 stdError = 0（逐轮差恒 0）时反解返回 null ⇒ 首跑回落 6 轮；
    //      §49 的 A′ 口径（capped ⇒ 补到上限）在这条路径上没生效 —— §50 B-1 在复核侧的孪生缺口。
    // Q1（复跑该不该「换盐追加 + 合并重检」）：四臂共享同一批样本、逐例配对（同一 perm 前缀）：
    //   F′ ：现状（§49 A′ 口径的首跑；复跑 = 同盐恒等 ⇒ 不产生任何新样本）
    //   S1 ：首跑未达显著 ⇒ 新盐再采「按需补到 n*」（n* 用**目标难度**当前统计反解，取生产函数）
    //   S2 ：首跑未达显著 ⇒ 新盐再采「补到复核上限 16 轮」（= §47 A′ 的 capped 处置）
    //   F${CAP}（初版 F12）：固定跑满上限参照（§49 已测的功效上界；2026-09-27 上限 12→16 ⇒ 再跑为 F16；
    //   只报数、不参与裁决）
    //   追加部分受与复验追加**同一套两级护栏**（单次 ≤ 整轮 20%、累计 ≤ 整轮 40%，比例常量取生产
    //   导出；已花口径 = 本次复核里之前的追加场次 = 0 —— 首跑的 §49 护栏已烘焙在 plan.plannedRounds）。
    // Q2（零差先验的出口）：同一批样本单列统计「plan = null（先验 stdError = 0）」的试次：目标难度
    //   上是否也逐值相同、6 轮 / 上限轮各自判出多少 ⇒ 决定零差先验是「补到上限」还是「出口明示」。
    // 预算档取三个量级：40（小整轮，两级护栏会咬住 ⇒ 演示钳位公式是活的）/ 74（快档 4h 整轮量级）/
    //   451（标准档夹具量级；两比例都不咬 ⇒ 写入断言的自证档）。
    // 判据（预注册，跑正式采样前定稿）：
    //   ① 假阳性不升（硬）：null 桶「判成立」S1 / S2 ≤ F′；
    //   ② 解析率：real 桶「F′ 未达显著 → 本臂判明确」≥ 80%（固定轮参照给出上限轮的功效量级）；
    //   ③ 成本：期望额外场次 ≤ 单次护栏（74 档 = floor(74 × 20%) = 14 场，构造保证）；
    //   ④ 自证：同盐两次派生逐值相同；两个同 payload 探针样本逐值相同；新盐与旧盐种子不相交；
    //      451 档两级护栏都不咬（clamped = 0 断言）。
    // 过闸 ⇒ 实施「复跑 = 换盐追加 + 合并重检 + 累计预算 + 零差出口」；不过 ⇒ 不实施堆叠，改最小
    // 修复（已有结果时明示「同难度复跑结论不变」+ 保留上一份留档）。
    if (robustTier != null) {
      const CAP = engine.TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS;
      const BASE = engine.TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS;
      const SINGLE_RATIO = engine.TRIGGER_OPTIMIZER_VERIFY_APPEND_BUDGET_RATIO;
      const CUMULATIVE_RATIO = engine.TRIGGER_OPTIMIZER_VERIFY_APPEND_CUMULATIVE_BUDGET_RATIO;
      assert(args.seeds >= CAP, `--seeds 至少要 ${CAP}（复跑对照最坏要切到 ${CAP} 个互斥种子）`);
      const robustSettings = { ...simulationSettings, difficultyTier: robustTier };
      const robustMatrix = [samplesByKey.get('robust|baseline')];
      for (const candidate of slot.candidates) {
        robustMatrix.push(samplesByKey.get(`robust|${slot.slotIndex}|${candidate.signature}`));
      }
      for (const samples of robustMatrix) {
        assert.equal(samples?.length, args.seeds, `槽位 ${slot.slotIndex} 复核样本缺失`);
      }
      const robustGrandScores = slot.candidates.map((_, index) =>
        engine.scoreCandidate(
          engine.aggregateRoundMetrics(robustMatrix[index + 1]),
          weights,
          engine.aggregateRoundMetrics(robustMatrix[0]),
        ),
      );
      // ① 种子派生是确定性的：同盐两次调用逐值相同（复跑恒等的第一半）。
      const saltContext = { playerId: preferredPlayerId, playerConfig, simulationSettings: robustSettings };
      const saltSeedsA = engine.createTriggerOptimizerSeedSet({
        ...saltContext,
        salt: engine.TRIGGER_OPTIMIZER_SEED_SALT_ROBUSTNESS,
        count: CAP,
      });
      const saltSeedsB = engine.createTriggerOptimizerSeedSet({
        ...saltContext,
        salt: engine.TRIGGER_OPTIMIZER_SEED_SALT_ROBUSTNESS,
        count: CAP,
      });
      assert.deepStrictEqual(saltSeedsA, saltSeedsB, '同盐两次派生不一致 —— 复跑恒等的第一半不成立');
      // ② 新盐 ⇒ 真正的新样本（不是同一批种子换个名字）：attempt 2 的盐与首跑盐的种子不相交。
      const nextSaltSeeds = engine.createTriggerOptimizerSeedSet({
        ...saltContext,
        salt: `${engine.TRIGGER_OPTIMIZER_SEED_SALT_ROBUSTNESS}.r2`,
        count: BASE,
      });
      assert(
        saltSeedsA.every((seed) => !nextSaltSeeds.includes(seed)),
        '新盐与旧盐种子相交 ——「换盐 = 新样本」不成立',
      );
      // ③ 同一 payload + 同一组种子 → 同一样本（复跑恒等的第二半）：采样组里的两个同 payload 探针。
      const identitySamples = samplesByKey.get('robust|identity-a');
      assert.deepStrictEqual(
        identitySamples,
        samplesByKey.get('robust|identity-b'),
        '同 payload + 同种子样本不一致 —— 复跑恒等的第二半不成立',
      );
      const newRerunArm = () => ({
        trials: 0,
        firstInconclusive: 0,
        resolved: 0,
        positive: 0,
        negative: 0,
        rounds: 0,
        appendRounds: 0,
        appends: 0,
        clamped: 0,
      });
      const armNames = ['F', 'S1', 'S2', 'F12'];
      const armLabel = { F: 'F′', S1: 'S1', S2: 'S2', F12: `F${CAP}` };
      const budgetRuns = [40, 74, 451].map((wholeRun) => ({
        wholeRun,
        singleBudget: Math.floor(wholeRun * SINGLE_RATIO),
        cumulativeBudget: Math.floor(wholeRun * CUMULATIVE_RATIO),
        real: {},
        null: {},
      }));
      for (const run of budgetRuns) {
        for (const kind of ['real', 'null']) {
          for (const name of armNames) run[kind][name] = newRerunArm();
        }
      }
      // Q2 零差先验桶：cases 用 Set 记「几个候选案例」，避免把 500 次试验读成 500 个案例。
      const zeroPrior = { trials: 0, cases: new Set(), targetZero: 0, sixDecisive: 0, twelveDecisive: 0 };
      // 独立随机流：本段的 perm 切分不扰动既有段（§30.8 / §31 / §47 / §49 / §50）的数字。
      const rerunRng = createSeededRandom(20260928);
      const priorOf = (configIndex, idx) =>
        engine.computePairedStats(aggSubset(matrix[configIndex], idx), aggSubset(matrix[0], idx), weights)?.score ??
        null;
      const robustOf = (configIndex, idx) =>
        engine.computePairedStats(aggSubset(robustMatrix[configIndex], idx), aggSubset(robustMatrix[0], idx), weights)
          ?.score ?? null;
      for (let configIndex = 1; configIndex <= slot.candidates.length; configIndex += 1) {
        const trueScore = robustGrandScores[configIndex - 1];
        const kind = trueScore > engine.TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE ? 'real' : trueScore <= 0 ? 'null' : null;
        if (!kind) continue;
        for (let trial = 0; trial < args.trials; trial += 1) {
          // 先验 = 搜索难度上切 6 轮（模拟报告里已有的那份复验统计）。
          const prior = priorOf(configIndex, shuffle(seedIndices, rerunRng).slice(0, BASE));
          const perm = shuffle(seedIndices, rerunRng);
          // 先验退化（plan = null，先验 stdError = 0）：与预算档无关（退化来自 stdError，不来自护栏）。
          if (engine.planTriggerOptimizerRobustnessRounds(prior, { maxRounds: CAP }) === null) {
            zeroPrior.trials += 1;
            zeroPrior.cases.add(configIndex);
            const sixSummary = robustOf(configIndex, perm.slice(0, BASE));
            if (Number(sixSummary?.stdError) === 0) zeroPrior.targetZero += 1;
            if (String(sixSummary?.verdict ?? 'unknown') !== 'inconclusive') zeroPrior.sixDecisive += 1;
            if (String(robustOf(configIndex, perm.slice(0, CAP))?.verdict ?? 'unknown') !== 'inconclusive') {
              zeroPrior.twelveDecisive += 1;
            }
          }
          for (const run of budgetRuns) {
            const plan = engine.planTriggerOptimizerRobustnessRounds(prior, {
              maxRounds: CAP,
              wholeRunSimulations: run.wholeRun,
            });
            const firstRounds = plan ? Math.min(CAP, Math.max(BASE, plan.plannedRounds)) : BASE;
            const firstSummary = robustOf(configIndex, perm.slice(0, firstRounds));
            const firstVerdict = String(firstSummary?.verdict ?? 'unknown');
            const firstInconclusive = firstVerdict === 'inconclusive';
            // S1 的按需轮数：用目标难度**当前**统计反解（与 F′ 首跑用的是同一把 t×SE 尺子）；
            // 反解不出（零差 / 退化）⇒ 视为 capped（§50 B-1 同款处置）⇒ 补到上限。
            const need = engine.resolveTriggerOptimizerRobustnessRounds(firstSummary, CAP);
            const s1Target = need && !need.capped ? Math.min(CAP, Math.max(BASE, need.requiredRounds)) : CAP;
            const runArm = (name) => {
              const desired =
                name === 'F12'
                  ? CAP
                  : name === 'F'
                    ? firstRounds
                    : name === 'S1'
                      ? Math.max(firstRounds, s1Target)
                      : CAP;
              let total = Math.min(CAP, desired);
              let appended = 0;
              let clamped = false;
              if (name === 'S1' || name === 'S2') {
                const extra = total - firstRounds;
                if (extra > 0) {
                  // 两级护栏（与复验追加同款口径；已花 = 本次复核之前的追加场次 = 0）。
                  const afterSingle = Math.min(extra, Math.floor(run.singleBudget / 2));
                  if (afterSingle < extra) clamped = true;
                  const afterCumulative = Math.min(afterSingle, Math.floor(run.cumulativeBudget / 2));
                  if (afterCumulative < afterSingle) clamped = true;
                  appended = afterCumulative;
                  total = firstRounds + appended;
                }
              }
              assert(total <= CAP, `${name} 越过复核上限 ${CAP} 轮（${total}）`);
              const verdict = String(robustOf(configIndex, perm.slice(0, total))?.verdict ?? 'unknown');
              const stats = run[kind][name];
              stats.trials += 1;
              stats.rounds += total;
              if (clamped) stats.clamped += 1;
              if (appended > 0) {
                stats.appends += 1;
                stats.appendRounds += appended;
              }
              if (firstInconclusive) {
                stats.firstInconclusive += 1;
                if (verdict !== 'inconclusive') stats.resolved += 1;
              }
              if (verdict === 'positive') stats.positive += 1;
              if (verdict === 'negative') stats.negative += 1;
            };
            for (const name of armNames) runArm(name);
          }
        }
      }
      // 自证：451 档两级护栏都不咬（单次 90 场 / 累计 180 场 ≥ 上限 24 场）⇒ 该档的数字不掺钳位。
      for (const kind of ['real', 'null']) {
        for (const name of ['S1', 'S2']) {
          assert.equal(
            budgetRuns[2][kind][name].clamped,
            0,
            `预算 451 档 ${kind} 桶 ${name} 被护栏钳住 —— 两级护栏公式与预算口径不符`,
          );
        }
      }
      const rate = (count, denominator) => (denominator === 0 ? '—' : percent(count / denominator));
      const perSide = (stats) => (stats.trials === 0 ? '—' : (stats.rounds / stats.trials).toFixed(2));
      const pooled = (run, name, key) => run.real[name][key] + run.null[name][key];
      const perTrial = (run, name, value) => {
        const trials = pooled(run, name, 'trials');
        return trials === 0 ? '—' : (value / trials).toFixed(1);
      };
      console.log('');
      console.log(
        `复核复跑对照（目标难度 tier ${robustTier}；复核上限 ${CAP} 轮；每案例 ${args.trials} 次试验；F′ = 现状（复跑恒等）/ S1 = 换盐追加按需 / S2 = 换盐追加补到上限 / F${CAP} = 固定 ${CAP} 轮参照；逐例配对）`,
      );
      for (const run of budgetRuns) {
        const real = run.real;
        const nul = run.null;
        console.log(`预算 ${run.wholeRun} 场（单次护栏 ${run.singleBudget} 场 / 累计护栏 ${run.cumulativeBudget} 场）`);
        console.log(
          '臂    真提升:解析率  真提升:判成立  真提升:轮数/侧   null:假阳性   null:轮数/侧   追加率   期望额外场次(全案例)',
        );
        for (const name of armNames) {
          console.log(
            `${armLabel[name].padEnd(6)} ${rate(real[name].resolved, real[name].firstInconclusive).padStart(12)} ` +
              `${rate(real[name].positive, real[name].trials).padStart(15)} ${perSide(real[name]).padStart(16)} ` +
              `${rate(nul[name].positive, nul[name].trials).padStart(13)} ${perSide(nul[name]).padStart(14)} ` +
              `${rate(pooled(run, name, 'appends'), pooled(run, name, 'trials')).padStart(8)} ` +
              `${perTrial(run, name, 2 * pooled(run, name, 'appendRounds')).padStart(21)}`,
          );
        }
        console.log(
          `  合计口径（real 桶解析率，分母 = F′ 未达显著次数）：F′ ${rate(real.F.resolved, real.F.firstInconclusive)}（${
            real.F.resolved
          }/${real.F.firstInconclusive}）｜S1 ${rate(real.S1.resolved, real.S1.firstInconclusive)}（${
            real.S1.resolved
          }/${real.S1.firstInconclusive}）｜S2 ${rate(real.S2.resolved, real.S2.firstInconclusive)}（${real.S2.resolved}/${
            real.S2.firstInconclusive
          }）`,
        );
        console.log(
          `  钳位次数（两级护栏咬住的试次）：S1 ${pooled(run, 'S1', 'clamped')} / S2 ${pooled(run, 'S2', 'clamped')}｜` +
            `判负（real 桶次数）：F′ ${real.F.negative} / S1 ${real.S1.negative} / S2 ${real.S2.negative}｜` +
            `null 桶判负率：F′ ${rate(nul.F.negative, nul.F.trials)} / S1 ${rate(nul.S1.negative, nul.S1.trials)} / S2 ${rate(
              nul.S2.negative,
              nul.S2.trials,
            )}`,
        );
      }
      // 复跑成本按**全案例**均值（real 桶为空时同样有值）：现状复跑的场次 = 2 × 首跑轮数。
      const identityFirstRounds =
        pooled(budgetRuns[1], 'F', 'trials') === 0
          ? NaN
          : pooled(budgetRuns[1], 'F', 'rounds') / pooled(budgetRuns[1], 'F', 'trials');
      console.log(
        `  恒等自证（现状复跑 = 满价买同一份样本）：同盐两次派生逐值相同 ✓｜同 payload/种子样本逐值相同 ✓（探针 ${
          identitySamples.length
        } 轮）｜新盐与旧盐种子不相交 ✓ ⇒ 现状下复跑产出与首跑逐值相同，成本 2 × 首跑轮数 = ${
          Number.isFinite(identityFirstRounds) ? (2 * identityFirstRounds).toFixed(1) : '—'
        } 场（74 档均值），信息增量为 0`,
      );
      const z = zeroPrior;
      console.log(
        `  零差先验（plan = null）：${rate(z.trials, pooled(budgetRuns[1], 'F', 'trials'))}（${z.trials}/${pooled(
          budgetRuns[1],
          'F',
          'trials',
        )}；${z.cases.size} 个候选案例）｜目标难度同为零差 ${rate(z.targetZero, z.trials)}｜判出次数：6 轮 ${
          z.sixDecisive
        } / ${CAP} 轮 ${z.twelveDecisive}`,
      );
      console.log(
        '判读（预注册）：① null 桶判成立 S1 / S2 ≤ F′（硬）② real 桶「F′ 未达显著 → 明确」≥ 80% ③ 期望额外场次 ≤ 单次护栏 ④ 自证四项 ⇒ 实施「复跑 = 换盐追加 + 合并重检 + 累计预算 + 零差出口」；两臂都过 ⇒ 取解析率最高者，差 < 2pp 取期望额外场次更低者。',
      );
      console.log(
        '零差先验出口：目标难度同为零差 ⇒ 追加也判不出（应出口明示、不花样本）；否则与 §50 B-1 同款视为 capped ⇒ 补到上限。',
      );
    } else {
      console.log('');
      console.log('复核复跑与零差先验对照：本区域解析不出相邻难度（顶档/未知），跳过。');
    }
  }

  // ── 精炼步长序列对照（2026-09-24，设计 §32）＋ 门槛臂对照（2026-09-25，A 项）────────
  // 同预算对照：级数上限与「每级 ≤2 次评估」都不变，唯一差别是步长序列 ——
  //   生产：10 / 5 / 5 / 5（下限 5pp，脚本实测）    对照：--refine-steps（默认 10 / 5 / 2 / 1）
  // 两条规则在**同一批真实样本**上回放：同起点、同参考系（轮起配置 = 基线）、同决策种子；对照臂的
  // 取点在同一条 1pp 网格上按 percent ± step 完成（启动时已对齐自检：与生产生成的是同一批候选），
  // 判据走生产实现（compareCandidates / shouldAdoptCandidate）。留出组与决策组不相交（select on A /
  // test on B）。
  // 判据：配对差 = 最终阈值的**真实分**（留出种子）「对照 − 生产」。> 0 且 t 明显 ⇒ 对照步长更接近
  // 真实最优；2026-09-24 实测（两个夹具槽）都是 0 或略负 ⇒ 生产保持 10/5/5/5（见 §32）。
  // A 项（2026-09-25）在此之上追加两条**门槛臂**，回答「精炼行走本身值不值得保留」：无精炼 /
  // 生产门槛 / 放宽门槛三条臂共享同一批样本、同一起点、同一决策-留出切分 ⇒ 配对差即净效应。
  {
    const percentOf = refineStudy.percentOf;
    const sampleOf = (candidate) => samplesByKey.get(`${refineStudy.slotIndex}|${candidate.signature}`);
    const baselineSamples = samplesByKey.get('baseline');
    for (const candidate of refineStudy.sweep)
      assert.equal(sampleOf(candidate)?.length, args.seeds, '精炼扫描样本缺失');
    assert.equal(baselineSamples?.length, args.seeds, '基线样本缺失');

    const fixed = (value) => value.toFixed(5);
    const percent = (value) => `${(value * 100).toFixed(1)}%`;
    const percentText = (value) => `${Number(value.toFixed(2))}%`;
    // 按**四舍五入后的百分比**判 5pp 格点：取整漂移下原始百分比是小数（5.02%、6.02%…），
    // 用它判会把格点判空（latticeIndices 为空 ⇒ latticeBest 为 undefined）。
    const onLattice = (value) => Math.round(value) % 5 === 0;
    const pairedStats = (list) => {
      const diffs = list.map((row) => row.altTruth - row.prodTruth);
      const meanDiff = mean(diffs);
      const variance =
        diffs.length > 1 ? diffs.reduce((sum, value) => sum + (value - meanDiff) ** 2, 0) / (diffs.length - 1) : 0;
      const stdError = diffs.length > 0 ? Math.sqrt(variance / diffs.length) : 0;
      return {
        mean: meanDiff,
        stdError,
        t: stdError > 0 ? meanDiff / stdError : NaN,
        wins: diffs.filter((value) => value > 0).length,
        ties: diffs.filter((value) => value === 0).length,
        losses: diffs.filter((value) => value < 0).length,
      };
    };

    // 全体种子的真实响应曲线：采样网格最优 vs 5pp 格点最优（后者 = 只在 5pp 上行走时能捡到的上限）。
    const grandAgg = new Map(
      refineStudy.sweep.map((candidate) => [candidate.signature, engine.aggregateRoundMetrics(sampleOf(candidate))]),
    );
    const grandBaseline = engine.aggregateRoundMetrics(baselineSamples);
    const grandTruth = refineStudy.sweep.map((candidate) =>
      engine.scoreCandidate(grandAgg.get(candidate.signature), weights, grandBaseline),
    );
    const grandBest = grandTruth.indexOf(Math.max(...grandTruth));
    const latticeIndices = refineStudy.sweep
      .map((candidate, index) => index)
      .filter((index) => onLattice(percentOf(refineStudy.sweep[index])));
    const latticeBest = latticeIndices.reduce(
      (best, index) => (grandTruth[index] > grandTruth[best] ? index : best),
      latticeIndices[0],
    );
    console.log('');
    console.log(
      `精炼步长对照（家族 ${args.refineFamily} @ 槽 ${refineStudy.slotIndex}；采样网格 ${refineStudy.latticeStep}pp ` +
        `${refineStudy.sweep.length} 点，起点 ${refineStudy.startPoints.length} 个 × ${args.trials} 次试验）`,
    );
    console.log(
      `真实最优（全体种子）= ${percentText(percentOf(refineStudy.sweep[grandBest]))} ${fixed(grandTruth[grandBest])}｜` +
        (refineStudy.latticeStep > 0 && refineStudy.latticeStep < 5 && latticeIndices.length > 0
          ? `5pp 格点最优 = ${percentText(percentOf(refineStudy.sweep[latticeBest]))} ${fixed(
              grandTruth[latticeBest],
            )}｜精度上限 = ${fixed(grandTruth[grandBest] - grandTruth[latticeBest])}`
          : '（采样网格 = 5pp 格点：没有更细的格子，精度上限不适用）'),
    );

    if (!refineStudy.altStepsOnLattice || !refineStudy.controlArmUsable) {
      console.log('');
      if (!refineStudy.controlArmUsable) {
        console.log('对照臂跳过：网格取点有损 —— 绝对值类家族的取整让多个百分比落同一格（byPercent 有键碰撞），');
        console.log('  网格取点不再是生产生成的那条候选（aqua_planet group=2330 实测差半个格点）。对照只在');
        console.log('  百分比 ↔ 绝对值一一对应时做；生产臂与 §36 的网格天花板不受影响（都用生产生成的候选）。');
      } else {
        console.log(
          `对照臂跳过：步长 ${args.refineSteps.join('/')}pp 不落在采样网格（${refineStudy.latticeStep}pp）上 —— 网格粒度由生产步长`,
        );
        console.log(
          '  决定（BFS 只走生产步长）。复现 §32 的 1pp 对照需临时把 REFINEMENT_PERCENT_STEP_FLOOR 改成 1 后重新采样，',
        );
        console.log('  或改传能落在当前网格上的步长（--refine-steps=…）。');
      }
    }
    const altArmAvailable = refineStudy.altStepsOnLattice && refineStudy.controlArmUsable;
    for (const decisionCount of [...new Set([2, args.rounds])]) {
      let boundarySkips = 0;
      const rows = [];
      for (let trial = 0; trial < args.trials; trial += 1) {
        const perm = shuffle(seedIndices, rng);
        const decideIdx = perm.slice(0, decisionCount);
        const holdIdx = perm.slice(decisionCount);
        const aggregate = (samples, idx) => engine.aggregateRoundMetrics(idx.map((index) => samples[index]));
        const baselineDecide = aggregate(baselineSamples, decideIdx);
        const baselineTruth = aggregate(baselineSamples, holdIdx);
        const decideBySignature = new Map();
        const truthBySignature = new Map();
        for (const candidate of refineStudy.sweep) {
          const samples = sampleOf(candidate);
          decideBySignature.set(candidate.signature, aggregate(samples, decideIdx));
          truthBySignature.set(candidate.signature, aggregate(samples, holdIdx));
        }
        const truthScoreOf = (candidate) =>
          engine.scoreCandidate(truthBySignature.get(candidate.signature), weights, baselineTruth);
        const truthScores = refineStudy.sweep.map(truthScoreOf);
        const truthBestScore = Math.max(...truthScores);
        const truthBest = refineStudy.sweep[truthScores.indexOf(truthBestScore)];
        // 决策样本下的条目：分数/配对与生产同口径（参考 = 轮起配置 = 基线），逐候选只算一次。
        const entryCache = new Map();
        const entryOf = (candidate) => {
          const cached = entryCache.get(candidate.signature);
          if (cached) return cached;
          const metrics = decideBySignature.get(candidate.signature);
          const entry = {
            ...candidate,
            metrics,
            score: engine.scoreCandidate(metrics, weights, baselineDecide),
            paired: engine.computePairedStats(metrics, baselineDecide, weights),
          };
          entryCache.set(candidate.signature, entry);
          return entry;
        };
        // 生产臂 = 直接调生产 buildRefinedCandidates；对照臂 = 同一批网格上按 percent ± step 取点；
        // gate 参数化 = 同一套取点规则下换采纳门槛（三条门槛臂共用本函数，避免多份取点副本漂移）。
        const gateProduction = (winner, base) => engine.shouldAdoptCandidate(winner, base);
        // 放宽门槛（实验臂）：只要求「严格更高分 + 配对证据过噪声地板」，**去掉** MIN_ADOPT_SCORE 的
        // 绝对下限。依据：精炼这一轴的可交付量（§32.3 实测 ≤0.0023）结构上小于 0.01，绝对下限让它
        // 几乎不可能启动（启动率 0.8%~8.4%），因此这条臂测的是「让行走真能走起来会不会有收益」。
        const gateLoose = (winner, base) =>
          Number(winner?.score) > Number(base?.score) && engine.hasAdoptionEvidence(winner?.paired);
        const runWalk = (start, percentSteps, gate) => {
          // 生产同款签名去重：候选表里已有的（家族网格候选 + 本次行走已评估的点）不再重复评估。
          const visited = new Set(refineStudy.gridSignatures);
          visited.add(start.signature);
          let base = start;
          let evaluations = 0;
          let levels = 0;
          let skipped = 0;
          for (let level = 0; level < REFINEMENT_LEVELS; level += 1) {
            const ctx = {
              ...refineStudy.ctx,
              candidates: [...visited].map((signature) => refineStudy.bySignature.get(signature)),
            };
            const produced = percentSteps
              ? refineStudy.lookupProbes(base, percentSteps[level], visited)
              : engine.buildRefinedCandidates(base, ctx, resources, { level });
            const probes = produced.filter((candidate) => decideBySignature.has(candidate.signature));
            skipped += produced.length - probes.length;
            for (const probe of probes) visited.add(probe.signature);
            if (probes.length === 0) break;
            evaluations += probes.length;
            const winner = [...probes.map(entryOf)].sort(engine.compareCandidates)[0];
            if (!gate(winner, entryOf(base))) break;
            base = winner;
            levels = level + 1;
          }
          return { base, evaluations, levels, skipped };
        };
        for (const start of refineStudy.startPoints) {
          const prodWalk = runWalk(start, null, gateProduction);
          const looseWalk = runWalk(start, null, gateLoose);
          const altWalk = altArmAvailable ? runWalk(start, args.refineSteps, gateProduction) : null;
          boundarySkips += prodWalk.skipped + (altWalk ? altWalk.skipped : 0);
          const noneTruth = truthScoreOf(start);
          const prodTruth = truthScoreOf(prodWalk.base);
          const looseTruth = truthScoreOf(looseWalk.base);
          const altTruth = altWalk ? truthScoreOf(altWalk.base) : null;
          rows.push({
            grid: refineStudy.gridSignatures.has(start.signature),
            noneTruth,
            prodTruth,
            looseTruth,
            altTruth,
            noneRegret: truthBestScore - noneTruth,
            prodRegret: truthBestScore - prodTruth,
            looseRegret: truthBestScore - looseTruth,
            altRegret: altWalk ? truthBestScore - altTruth : null,
            noneGap: Math.abs(percentOf(start) - percentOf(truthBest)),
            prodGap: Math.abs(percentOf(prodWalk.base) - percentOf(truthBest)),
            looseGap: Math.abs(percentOf(looseWalk.base) - percentOf(truthBest)),
            altGap: altWalk ? Math.abs(percentOf(altWalk.base) - percentOf(truthBest)) : null,
            noneEvaluations: 0,
            prodEvaluations: prodWalk.evaluations,
            looseEvaluations: looseWalk.evaluations,
            altEvaluations: altWalk ? altWalk.evaluations : null,
            noneLevels: 0,
            prodLevels: prodWalk.levels,
            looseLevels: looseWalk.levels,
            altLevels: altWalk ? altWalk.levels : null,
            prodChanged: prodWalk.base.signature !== start.signature,
            looseChanged: looseWalk.base.signature !== start.signature,
            altChanged: altWalk ? altWalk.base.signature !== start.signature : null,
            changed: altWalk ? prodWalk.base.signature !== altWalk.base.signature : null,
          });
        }
      }

      const summarize = (scheme) => {
        const values = (key) => rows.map((row) => row[key]).filter((value) => Number.isFinite(value));
        return {
          truth: mean(values(`${scheme}Truth`)),
          regret: mean(values(`${scheme}Regret`)),
          gap: mean(values(`${scheme}Gap`)),
          evaluations: mean(values(`${scheme}Evaluations`)),
          levels: mean(values(`${scheme}Levels`)),
          deep: rows.length === 0 ? 0 : rows.filter((row) => row[`${scheme}Levels`] >= 2).length / rows.length,
        };
      };
      const changedRateOf = (scheme) => {
        const list = rows.map((row) => row[`${scheme}Changed`]).filter((value) => typeof value === 'boolean');
        return list.length === 0 ? 0 : list.filter(Boolean).length / list.length;
      };
      const prodStats = summarize('prod');
      const looseStats = summarize('loose');
      const noneStats = summarize('none');
      const altStats = altArmAvailable ? summarize('alt') : null;
      const gridRows = rows.filter((row) => row.grid);
      // 配对差通用化（A 项要多组两两比较）：keyA − keyB，按有限值过滤。
      const pairedBetween = (list, keyA, keyB) => {
        const diffs = list.map((row) => row[keyA] - row[keyB]).filter((value) => Number.isFinite(value));
        const meanDiff = mean(diffs);
        const variance =
          diffs.length > 1 ? diffs.reduce((sum, value) => sum + (value - meanDiff) ** 2, 0) / (diffs.length - 1) : 0;
        const stdError = diffs.length > 0 ? Math.sqrt(variance / diffs.length) : 0;
        return {
          n: diffs.length,
          mean: meanDiff,
          stdError,
          t: stdError > 0 ? meanDiff / stdError : NaN,
          wins: diffs.filter((value) => value > 0).length,
          ties: diffs.filter((value) => value === 0).length,
          losses: diffs.filter((value) => value < 0).length,
        };
      };
      const line = (label, ...cells) =>
        console.log(`${label.padEnd(26)}${cells.map((cell) => String(cell).padStart(14)).join('')}`);
      const tText = (value) => (Number.isFinite(value) ? value.toFixed(2) : '—');
      const diffText = (stats) =>
        `${fixed(stats.mean)} ± ${fixed(stats.stdError)}（t = ${tText(stats.t)}；胜 ${percent(
          stats.n === 0 ? 0 : stats.wins / stats.n,
        )} / 平 ${percent(stats.n === 0 ? 0 : stats.ties / stats.n)} / 负 ${percent(
          stats.n === 0 ? 0 : stats.losses / stats.n,
        )}）`;
      const columns = [
        { head: '无精炼', stats: noneStats, rate: 0 },
        { head: `生产 ${refineStudy.productionSteps.join('/')}pp`, stats: prodStats, rate: changedRateOf('prod') },
        { head: '放宽门槛', stats: looseStats, rate: changedRateOf('loose') },
      ];
      if (altArmAvailable) {
        columns.push({ head: `对照 ${args.refineSteps.join('/')}pp`, stats: altStats, rate: changedRateOf('alt') });
      }
      console.log('');
      console.log(
        `门槛臂对照（决策种子 ${decisionCount} / 留出 ${args.seeds - decisionCount}；每个方案 ${
          rows.length
        } 个「起点 × 试验」样本）`,
      );
      line('指标', ...columns.map((column) => column.head));
      line('平均真实分', ...columns.map((column) => fixed(column.stats.truth)));
      line('平均 regret', ...columns.map((column) => fixed(column.stats.regret)));
      line('平均 |终值−真最优|', ...columns.map((column) => `${column.stats.gap.toFixed(2)}pp`));
      line('平均评估次数', ...columns.map((column) => column.stats.evaluations.toFixed(2)));
      line('平均行走级数', ...columns.map((column) => column.stats.levels.toFixed(2)));
      line('走到 level≥2', ...columns.map((column) => percent(column.stats.deep)));
      line('终值与起点不同', ...columns.map((column) => percent(column.rate)));
      const netEffect = pairedBetween(rows, 'prodTruth', 'noneTruth');
      const netEffectGrid = pairedBetween(gridRows, 'prodTruth', 'noneTruth');
      const looseGain = pairedBetween(rows, 'looseTruth', 'prodTruth');
      const looseGainGrid = pairedBetween(gridRows, 'looseTruth', 'prodTruth');
      console.log(`精炼净效应（生产门槛 − 无精炼，真实分）：${diffText(netEffect)}`);
      console.log(`　其中「现实起点」（家族真实网格候选，${gridRows.length} 个样本）：${diffText(netEffectGrid)}`);
      console.log(`放宽门槛 − 生产（真实分）：${diffText(looseGain)}`);
      console.log(`　其中「现实起点」：${diffText(looseGainGrid)}`);
      if (altArmAvailable) {
        const paired = pairedStats(rows);
        const gridPaired = pairedStats(gridRows);
        console.log(
          `配对差（对照 − 生产，真实分）：${fixed(paired.mean)} ± ${fixed(paired.stdError)}（t = ${tText(paired.t)}；` +
            `胜 ${percent(rows.length === 0 ? 0 : paired.wins / rows.length)} / 平 ${percent(
              rows.length === 0 ? 0 : paired.ties / rows.length,
            )} / 负 ${percent(rows.length === 0 ? 0 : paired.losses / rows.length)}）`,
        );
        console.log(
          `　其中「现实起点」（家族真实网格候选，${gridRows.length} 个样本）：${fixed(gridPaired.mean)} ± ${fixed(
            gridPaired.stdError,
          )}（t = ${tText(gridPaired.t)}）`,
        );
      }
      console.log(
        `　评估成本（生产 vs 无精炼，每「起点 × 试验」）：${prodStats.evaluations.toFixed(2)} vs ${noneStats.evaluations.toFixed(2)}`,
      );
      console.log(`　越界跳过（采样区间之外，默认区间下应为 0）：${boundarySkips} 次`);
    }
    console.log('判读（A 项，2026-09-25）：主判据 = 「生产门槛 − 无精炼」的真实分配对差 —— ≈ 0 或 t 不明显 ⇒');
    console.log('      精炼行走对该轴真实分无贡献，而它每采纳槽恒定多花 2 次评估 ⇒ 按「有提升才保留」应删除；');
    console.log('      「放宽门槛 − 生产」> 0 且 t 明显 ⇒ 是门槛（而非步长）压死了行走，应改门槛而不是删机制。');
    console.log('判读（§32 步长臂，仅对照臂可用时）：配对差 > 0 且 t 明显 ⇒ 对照步长同预算下更接近真实最优；');
    console.log(
      '      2026-09-24 实测两次都是 0 或略负 ⇒ 生产保持 10/5/5/5。「现实起点」= 家族真实网格候选（主口径）；',
    );
    console.log('      「精度上限」= 1pp 真最优与 5pp 格点最优的真实分差 = 二分能捡到的天花板（天花板 ≈ 0 时该夹具');
    console.log('      对阈值精度不敏感，结论不可外推）。');
  }

  // ── 候选覆盖缺口：杠杆判读（2026-09-24，设计 §33）────────────────────────────
  // 判据（用户口径）：缺口族最优相对「现有池最优」的**真实分**增量 ≥ TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE
  // 才算有杠杆、才值得进生产候选池；低于门槛就明确报「无杠杆，不实施」，并给出成本账。
  // 逐槽跑（每个含锚点家族的槽各一份）：全部槽都无杠杆才算「无杠杆」。
  for (const coverageStudy of coverageStudies) {
    const existing = coverageStudy.existing;
    const family = coverageStudy.candidates;
    const sampleOf = (candidate) => samplesByKey.get(`${coverageStudy.slotIndex}|${candidate.signature}`);
    for (const candidate of [...existing, ...family]) {
      assert.equal(sampleOf(candidate)?.length, args.seeds, `缺口族采样缺失：${candidate.signature}`);
    }
    const baselineSamples = samplesByKey.get('baseline');
    assert.equal(baselineSamples?.length, args.seeds, '基线样本缺失');
    const fixed = (value) => value.toFixed(5);
    const percentText = (value) => `${(value * 100).toFixed(1)}%`;
    const tText = (value) => (Number.isFinite(value) ? value.toFixed(2) : '—');
    const threshold = engine.TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE;
    const labelOf = (candidate) =>
      `${String(candidate.labelKey ?? '').replace('common:triggerOptimizer.candidate.', '')} ${JSON.stringify(
        candidate.labelParams ?? {},
      )}`;
    const pairedDiffStats = (diffs) => {
      const meanDiff = mean(diffs);
      const variance =
        diffs.length > 1 ? diffs.reduce((sum, value) => sum + (value - meanDiff) ** 2, 0) / (diffs.length - 1) : 0;
      const stdError = diffs.length > 0 ? Math.sqrt(variance / diffs.length) : 0;
      return { mean: meanDiff, stdError, t: stdError > 0 ? meanDiff / stdError : NaN };
    };

    // ① 全体种子聚合（对缺口族最有利的「事后看」口径）：族最优 vs 现有池最优。
    const grandBaseline = engine.aggregateRoundMetrics(baselineSamples);
    const grandScore = (candidate) =>
      engine.scoreCandidate(engine.aggregateRoundMetrics(sampleOf(candidate)), weights, grandBaseline);
    const existingScores = existing.map(grandScore);
    const familyScores = family.map(grandScore);
    const bestIndex = (scores) => scores.indexOf(Math.max(...scores));
    const existingBestIndex = bestIndex(existingScores);
    const familyBestIndex = bestIndex(familyScores);
    const existingBest = existingScores[existingBestIndex];
    const familyBest = familyScores[familyBestIndex];
    const lever = familyBest - existingBest;
    const delta = (value) => `${value >= 0 ? '+' : ''}${fixed(value)}`;
    const scoreRow = (name, score, showDelta = true) =>
      console.log(
        `${name.padEnd(34)}${fixed(score).padStart(12)}${(showDelta ? delta(score - existingBest) : '').padStart(14)}`,
      );
    console.log('');
    console.log(
      `候选覆盖缺口（槽 ${coverageStudy.slotIndex} ${coverageStudy.abilityHrid}，${coverageStudy.role}；` +
        `${args.hours}h / tier ${args.tier}，全体 ${args.seeds} 种子聚合，参考 = 基线）`,
    );
    console.log(
      '方案（真实分 = 全体种子聚合的生产同款增量分）'.padEnd(34) + '真实分'.padStart(12) + 'Δ现有最优'.padStart(14),
    );
    scoreRow(`现有池最优：${labelOf(existing[existingBestIndex])}`, existingBest, false);
    for (let index = 0; index < family.length; index += 1) {
      const candidate = family[index];
      scoreRow(
        `族 ${candidate.directionTag}${Number(candidate.labelParams.percent)}% ${candidate.directionName}`,
        familyScores[index],
      );
    }
    // 生产若实施，最可能的形态是「两档阈值 × 两方向」= 4 条：单独报出来，免得用整张网格的上界
    // 替一个不会实现的规模背书。
    const subsetPercents = [40, 60];
    const subsetBest = Math.max(
      ...family.filter((candidate) => subsetPercents.includes(Number(candidate.labelParams.percent))).map(grandScore),
    );
    console.log(
      `两档实施形态（${subsetPercents.join('/')}% × LTE/GTE，4 条）最优 = ${fixed(subsetBest)}（Δ ${delta(
        subsetBest - existingBest,
      )}）`,
    );
    console.log(
      `① 杠杆 = 族最优 ${fixed(familyBest)}（${family[familyBestIndex].directionTag}${Number(
        family[familyBestIndex].labelParams.percent,
      )}% ${family[familyBestIndex].directionName}）− 现有池最优 ${fixed(existingBest)} = ${fixed(lever)}` +
        `（门槛 ${threshold}）⇒ ${lever >= threshold ? '有提升' : '无提升（不实施）'}`,
    );

    // ② 采纳侧 bootstrap（与 §30.8/§32 同款样本分割：select on A / test on B）：
    //   A 臂 = 现有池（生产现状）  B 臂 = 现有池 ∪ 缺口族（若实施）
    // 每试验：用决策种子选 winner（生产 compareCandidates）、生产 shouldAdoptCandidate 判采纳，
    // 留出种子算真实分 —— 回答「加这个族会不会改变决策、改变后真实分是升是降」。
    console.log('');
    console.log(
      `采纳侧 bootstrap（每试验 ${args.trials} 次；A 臂 = 现有池 ${existing.length} 条，B 臂 = 现有池 ∪ 缺口族 ${family.length} 条）`,
    );
    for (const decisionCount of [...new Set([2, args.rounds])]) {
      const rows = [];
      for (let trial = 0; trial < args.trials; trial += 1) {
        const perm = shuffle(seedIndices, rng);
        const decideIdx = perm.slice(0, decisionCount);
        const holdIdx = perm.slice(decisionCount);
        const aggregate = (samples, idx) => engine.aggregateRoundMetrics(idx.map((index) => samples[index]));
        const baselineDecide = aggregate(baselineSamples, decideIdx);
        const baselineTruth = aggregate(baselineSamples, holdIdx);
        const entryCache = new Map();
        const entryOf = (candidate) => {
          const cached = entryCache.get(candidate.signature);
          if (cached) return cached;
          const metrics = aggregate(sampleOf(candidate), decideIdx);
          const entry = {
            ...candidate,
            metrics,
            score: engine.scoreCandidate(metrics, weights, baselineDecide),
            paired: engine.computePairedStats(metrics, baselineDecide, weights),
          };
          entryCache.set(candidate.signature, entry);
          return entry;
        };
        // 真实分用留出组且每次试验的 holdIdx 不同：不进缓存（与 §32 同款）。
        const truthScoreOf = (candidate) =>
          engine.scoreCandidate(aggregate(sampleOf(candidate), holdIdx), weights, baselineTruth);
        const existingEntries = existing.map(entryOf);
        const familyEntries = family.map(entryOf);
        const winnerA = [...existingEntries].sort(engine.compareCandidates)[0];
        const winnerB = [...existingEntries, ...familyEntries].sort(engine.compareCandidates)[0];
        rows.push({
          truthA: truthScoreOf(winnerA),
          truthB: truthScoreOf(winnerB),
          adoptedA: engine.shouldAdoptCandidate(winnerA),
          adoptedB: engine.shouldAdoptCandidate(winnerB),
          familyWinner: familyEntries.includes(winnerB),
        });
      }
      const diffs = rows.map((row) => row.truthB - row.truthA);
      const paired = pairedDiffStats(diffs);
      const familyWins = rows.filter((row) => row.familyWinner);
      const familyWinPaired = pairedDiffStats(familyWins.map((row) => row.truthB - row.truthA));
      const rate = (count) => percentText(count / rows.length);
      console.log(
        `决策种子 ${decisionCount} / 留出 ${args.seeds - decisionCount}：采纳率 A ${rate(
          rows.filter((row) => row.adoptedA).length,
        )} → B ${rate(rows.filter((row) => row.adoptedB).length)}｜族被选中率 ${rate(familyWins.length)}`,
      );
      console.log(
        `  真实分均值（留出）：A ${fixed(mean(rows.map((row) => row.truthA)))} → B ${fixed(
          mean(rows.map((row) => row.truthB)),
        )}｜配对差（B − A）= ${fixed(paired.mean)} ± ${fixed(paired.stdError)}（t = ${tText(paired.t)}；B 胜 ${rate(
          diffs.filter((value) => value > 0).length,
        )} / 平 ${rate(diffs.filter((value) => value === 0).length)} / 负 ${rate(diffs.filter((value) => value < 0).length)}）`,
      );
      console.log(
        `  族胜出的 ${familyWins.length} 次里，真实分相对 A 臂 = ${fixed(familyWinPaired.mean)} ± ${fixed(
          familyWinPaired.stdError,
        )}（t = ${tText(familyWinPaired.t)}）`,
      );
    }
    console.log('判读：① 是「事后看」的杠杆上界（族最优 vs 现有池最优）——低于门槛就没有实施价值；');
    console.log('      ② 是真实决策下加族买到的真实分（族被选中率 + 配对差 + 族胜出时的差）。两者同向才算「有提升」。');
    console.log(
      `结论：杠杆 ${fixed(lever)}（门槛 ${threshold}）⇒ ${
        lever >= threshold ? '族有提升，值得进生产候选池' : '族无提升，不实施'
      }；成本账 = +${family.length} 候选/槽/轮（标准档 ${args.rounds} 轮 ⇒ +${
        family.length * args.rounds
      } 场/槽/轮；两档实施形态 +${4 * args.rounds} 场）。`,
    );
    console.log(
      `诚实边界：只覆盖本夹具（${args.zone} tier ${args.tier} / ${args.hours}h / 单角色）与该百分比网格，换区域/换槽前不得外推。`,
    );
  }

  // ── 组合候选缺口：杠杆判读（2026-09-24，设计 §35）────────────────────────────
  // 判据与 §33 一致：组合族最优的真实分要 ≥ 现有池最优 + MIN_ADOPT_SCORE 才值得实施。
  for (const compositeStudy of compositeStudies) {
    const existing = compositeStudy.existing;
    const family = compositeStudy.candidates;
    if (family.length === 0) continue;
    const sampleOf = (candidate) => samplesByKey.get(`${compositeStudy.slotIndex}|${candidate.signature}`);
    for (const candidate of family) {
      assert.equal(sampleOf(candidate)?.length, args.seeds, `组合候选采样缺失：${candidate.signature}`);
    }
    const baselineSamples = samplesByKey.get('baseline');
    assert.equal(baselineSamples?.length, args.seeds, '基线样本缺失');
    const fixed = (value) => value.toFixed(5);
    const percentText = (value) => `${(value * 100).toFixed(1)}%`;
    const tText = (value) => (Number.isFinite(value) ? value.toFixed(2) : '—');
    const threshold = engine.TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE;
    const grandBaseline = engine.aggregateRoundMetrics(baselineSamples);
    const grandScore = (candidate) =>
      engine.scoreCandidate(engine.aggregateRoundMetrics(sampleOf(candidate)), weights, grandBaseline);
    const existingBest = Math.max(...existing.map(grandScore));
    const familyScores = family.map(grandScore);
    const bestIndex = familyScores.indexOf(Math.max(...familyScores));
    const familyBest = familyScores[bestIndex];
    const lever = familyBest - existingBest;
    const delta = (value) => `${value >= 0 ? '+' : ''}${fixed(value)}`;
    console.log('');
    console.log(
      `组合候选缺口（槽 ${compositeStudy.slotIndex} ${compositeStudy.abilityHrid}；` +
        `${args.hours}h / tier ${args.tier}，全体 ${args.seeds} 种子聚合）`,
    );
    console.log(
      `现有池最优 = ${fixed(existingBest)}｜组合族最优 = ${fixed(familyBest)}（${family[bestIndex].studyTag}）`,
    );
    console.log('组合候选（真实分；Δ = 相对现有池最优）');
    for (let index = 0; index < family.length; index += 1) {
      console.log(
        `  ${family[index].studyTag.padEnd(46)}${fixed(familyScores[index]).padStart(11)}${delta(
          familyScores[index] - existingBest,
        ).padStart(13)}`,
      );
    }
    console.log(
      `① 杠杆 = 组合族最优 − 现有池最优 = ${fixed(lever)}（门槛 ${threshold}）⇒ ${
        lever >= threshold ? '有提升' : '无提升（不实施）'
      }`,
    );
    // 采纳侧 bootstrap（决策样本 = 生产标准档轮数；A 臂 = 现有池、B 臂 = 现有池 ∪ 组合族）。
    const rows = [];
    for (let trial = 0; trial < args.trials; trial += 1) {
      const perm = shuffle(seedIndices, rng);
      const decideIdx = perm.slice(0, args.rounds);
      const holdIdx = perm.slice(args.rounds);
      const aggregate = (samples, idx) => engine.aggregateRoundMetrics(idx.map((index) => samples[index]));
      const baselineDecide = aggregate(baselineSamples, decideIdx);
      const baselineTruth = aggregate(baselineSamples, holdIdx);
      const entryCache = new Map();
      const entryOf = (candidate) => {
        const cached = entryCache.get(candidate.signature);
        if (cached) return cached;
        const metrics = aggregate(sampleOf(candidate), decideIdx);
        const entry = {
          ...candidate,
          metrics,
          score: engine.scoreCandidate(metrics, weights, baselineDecide),
          paired: engine.computePairedStats(metrics, baselineDecide, weights),
        };
        entryCache.set(candidate.signature, entry);
        return entry;
      };
      const truthScoreOf = (candidate) =>
        engine.scoreCandidate(aggregate(sampleOf(candidate), holdIdx), weights, baselineTruth);
      const existingEntries = existing.map(entryOf);
      const familyEntries = family.map(entryOf);
      const winnerA = [...existingEntries].sort(engine.compareCandidates)[0];
      const winnerB = [...existingEntries, ...familyEntries].sort(engine.compareCandidates)[0];
      rows.push({
        truthA: truthScoreOf(winnerA),
        truthB: truthScoreOf(winnerB),
        familyWinner: familyEntries.includes(winnerB),
      });
    }
    const diffs = rows.map((row) => row.truthB - row.truthA);
    const meanDiff = mean(diffs);
    const variance =
      diffs.length > 1 ? diffs.reduce((sum, value) => sum + (value - meanDiff) ** 2, 0) / (diffs.length - 1) : 0;
    const stdError = diffs.length > 0 ? Math.sqrt(variance / diffs.length) : 0;
    const rate = (count) => percentText(count / rows.length);
    console.log(
      `② 采纳侧 bootstrap（决策 ${args.rounds} / 留出 ${args.seeds - args.rounds}）：族被选中率 ${rate(
        rows.filter((row) => row.familyWinner).length,
      )}｜配对差（B − A 真实分）= ${fixed(meanDiff)} ± ${fixed(stdError)}（t = ${tText(
        stdError > 0 ? meanDiff / stdError : NaN,
      )}）`,
    );
    console.log('判读：① 是事后看的上界（组合族最优 vs 现有池最优）；② 是真实决策下加组合买到的真实分。');
  }

  // ── 阈值网格适配：换个区域，现有网格漏不漏 ≥ 0.01（2026-09-24，设计 §36）────────
  // 问题：默认阈值网格每族只有 2-3 档（`enemyGroupHpPercent = [25, 50]` 等），而怪物血量结构随区域
  // 变化（单怪图 / 多怪图 / BOSS 图的 min/group 比例完全不同）——「网格没适配这个区域」的漏分从没
  // 量化过。**上界口径（对族最有利）**：该家族在 5..95% 全网格（精炼扫描的 sweep，5pp 粒度）上最优的
  // 真实分 = 「阈值调到完美」的天花板；漏分 = 天花板 − 该槽现有池最优（同一批种子、同一参考系、
  // 都是 in-sample）。判据（用户口径）：漏分 ≥ MIN_ADOPT_SCORE（0.01）才值得做「区域自适应阈值」。
  // 注意：这是**已实现家族**的天花板，不含 §33/§35 那类未实现结构 —— 正好回答「换个区域、现有网格够不够」。
  // 零额外采样：sweep 的样本本来就在 §32 的精炼扫描里采过了。
  {
    const fixed = (value) => value.toFixed(5);
    const percentText = (value) => `${Number(value.toFixed(2))}%`;
    const slot = slotContexts.find((entry) => entry.slotIndex === refineStudy.slotIndex);
    assert(slot, '阈值网格适配：精炼扫描的槽不在 slotContexts 里');
    const baselineSamples = samplesByKey.get('baseline');
    assert.equal(baselineSamples?.length, args.seeds, '基线样本缺失');
    const grandBaseline = engine.aggregateRoundMetrics(baselineSamples);
    const scoreOf = (candidate) =>
      engine.scoreCandidate(
        engine.aggregateRoundMetrics(samplesByKey.get(`${slot.slotIndex}|${candidate.signature}`)),
        weights,
        grandBaseline,
      );
    const poolScores = slot.candidates.map(scoreOf);
    const poolBest = Math.max(...poolScores);
    const poolBestIndex = poolScores.indexOf(poolBest);
    const poolBestLabel = `${String(slot.candidates[poolBestIndex].labelKey ?? '').replace(
      'common:triggerOptimizer.candidate.',
      '',
    )} ${JSON.stringify(slot.candidates[poolBestIndex].labelParams ?? {})}`;
    const sweepScores = refineStudy.sweep.map(scoreOf);
    const sweepBestIndex = sweepScores.indexOf(Math.max(...sweepScores));
    const sweepBest = sweepScores[sweepBestIndex];
    const gap = sweepBest - poolBest;
    const threshold = engine.TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE;
    console.log('');
    console.log(
      `阈值网格适配（${args.zone} tier ${args.tier}；enemyHp = ${JSON.stringify(resources.enemyHp)}；` +
        `槽 ${slot.slotIndex} ${slot.abilityHrid}，家族 ${args.refineFamily}）`,
    );
    console.log(
      `池最优 = ${fixed(poolBest)}（${poolBestLabel}）｜${refineStudy.sweep.length} 点 5..95% 网格最优 = ` +
        `${fixed(sweepBest)}（${percentText(refineStudy.percentOf(refineStudy.sweep[sweepBestIndex]))}）`,
    );
    console.log(
      `漏分 = 网格最优 − 池最优 = ${fixed(gap)}（门槛 ${threshold}）⇒ ${
        gap >= threshold ? '有提升：值得做区域自适应阈值' : '无提升：该区域该家族的网格没有漏分'
      }`,
    );
    console.log('判读：这是「阈值调到完美」的上界口径（in-sample）；低于门槛 ⇒ 该区域/该家族不值得为阈值适配改代码。');
  }

  // ── 候选上限截断的代价：默认档（10）会不会丢掉真最优（2026-09-24，设计 §34）────────
  // 生成器按「价值顺序」产出候选，`candidateLimit` 从**尾部**截断（§22.3/§28 记录过「新族挤掉旧族」）。
  // 生产三档上限：快速 6 / 标准 10 / 上限 20，而伤害槽的生成数远超 10 ⇒ 尾部整段根本不评估。
  // 截断 = 保序切片（materialize 后 slice(0, limit)），因此「上限 N 档实际评估的集合」= 本次采样池
  // （按上限档生成）的**前 N 条** —— 直接比「前 N 条最优」与「全池最优」即可，同一批样本、零额外采样。
  // Δ = 0 ⇒ 该档没有丢分（截断方向可关）；Δ < 0 ⇒ 截断真的丢了分，重排或抬上限才有价值。
  {
    const fixed = (value) => value.toFixed(5);
    // 质量闸门（预注册，设计 §46 A 项）：下限档 6 相对**生产标准档 10** 的池最优差（跨槽取最大）。
    let worstDownDelta = 0;
    const baselineSamples = samplesByKey.get('baseline');
    assert.equal(baselineSamples?.length, args.seeds, '基线样本缺失');
    const grandBaseline = engine.aggregateRoundMetrics(baselineSamples);
    console.log('');
    console.log('候选上限截断的代价（全体种子聚合真实分；采样池 = 上限档生成，前缀 N 条 = 生产上限 N 档会评估的集合）');
    for (const slot of slotContexts) {
      const sampleOf = (candidate) => samplesByKey.get(`${slot.slotIndex}|${candidate.signature}`);
      for (const candidate of slot.candidates) {
        assert.equal(sampleOf(candidate)?.length, args.seeds, `槽 ${slot.slotIndex} 候选样本缺失`);
      }
      const scores = slot.candidates.map((candidate) =>
        engine.scoreCandidate(engine.aggregateRoundMetrics(sampleOf(candidate)), weights, grandBaseline),
      );
      const bestIndex = scores.indexOf(Math.max(...scores));
      const fullBest = scores[bestIndex];
      const bestLabel = `${String(slot.candidates[bestIndex].labelKey ?? '').replace(
        'common:triggerOptimizer.candidate.',
        '',
      )} ${JSON.stringify(slot.candidates[bestIndex].labelParams ?? {})}`;
      const parts = [];
      for (const limit of [6, 8, 10, 20]) {
        const kept = Math.min(limit, scores.length);
        const prefixBest = Math.max(...scores.slice(0, kept));
        const delta = prefixBest - fullBest;
        // 质量闸门分子（预注册，设计 §46）：下限档 6 与生产标准档 10 的池最优差。
        if (limit === 6) {
          const productionBest = Math.max(...scores.slice(0, Math.min(10, scores.length)));
          worstDownDelta = Math.max(worstDownDelta, Math.abs(productionBest - prefixBest));
        }
        parts.push(`上限 ${limit}（评估 ${kept} 条）= ${fixed(prefixBest)} Δ ${delta >= 0 ? '+' : ''}${fixed(delta)}`);
      }
      console.log(
        `槽 ${slot.slotIndex}（${slot.abilityHrid}）：生成 ${slot.generated ?? '?'} 条，采样池 ${scores.length} 条` +
          `｜全池最优 = ${fixed(fullBest)}（第 ${bestIndex + 1} 条：${bestLabel}）`,
      );
      console.log(`  ${parts.join('｜')}`);
    }
    console.log(
      '判读：Δ = 0 ⇒ 该档上限没丢真最优（截断方向可关）；Δ < 0 ⇒ 截断丢分，重排（免费）或抬上限（更贵）才有价值。',
    );

    // ── 上限下调的成本账（2026-09-25，设计 §46 A 项）────────────────────────────
    // 生产每槽每轮的评估数（解析值，与 §30.8 同款口径）：
    //   racing 池（候选数 > TRIGGER_OPTIMIZER_RACING_MIN_POOL）：候选数 × 粗筛 + min(候选数, keep+2) × 轮数；
    //   小池：候选数 × 轮数（全池精测）。
    // 上限下调同时改两件事：候选数变少、池子掉到 racing 门槛以下 ⇒「粗筛 + 精测」退回「全池精测」。
    // 所以省下多少必须按**生产公式**逐档算，不能按候选数线性拍。轮数与上限一律取生产预设表。
    const capOf = (slot, limit) => Math.min(limit, slot.candidates.length);
    const evalsOf = (count, rounds) =>
      engine.isRacingPool(count) ? count * SCREEN + Math.min(count, KEEP + 2) * rounds : count * rounds;
    const totalPerPass = (limit, rounds) =>
      slotContexts.reduce((sum, slot) => sum + evalsOf(capOf(slot, limit), rounds), 0);
    console.log('');
    console.log('上限下调的评估成本（参评各槽每轮评估数之和，解析值；池 > 8 才走 racing 粗筛）');
    for (const preset of engine.TRIGGER_OPTIMIZER_PRESETS) {
      for (const hours of [4, 8, 24]) {
        const rounds = engine.resolveTriggerOptimizerPresetRounds(preset, hours);
        const production = totalPerPass(preset.candidateLimit, rounds);
        const lowered = totalPerPass(6, rounds);
        const saving = production > 0 ? (1 - lowered / production) * 100 : 0;
        console.log(
          `  ${preset.id}@${hours}h（上限 ${preset.candidateLimit}、${rounds} 轮）：` +
            `上限 ${preset.candidateLimit} = ${production} ｜ 上限 6 = ${lowered}` +
            (preset.candidateLimit === 6 ? '（生产已是 6，无需下调）' : `（省 ${saving.toFixed(0)}%）`),
        );
      }
    }
    console.log(
      `  质量闸门（预注册）：上限 6 相对生产上限 10 的最大池最优差 = ${worstDownDelta.toFixed(5)}（判据 ≤ 0.002）`,
    );
    console.log(
      '判读：质量闸门通过 ∧ 默认档（standard@24h）成本降幅 ≥ 25% ∧ 各档各时长不出现成本上升 ⇒ 实施；否则不实施。',
    );
  }

  // ── 深挖窗口可达性（2026-09-25，设计 §44，B 项）──────────────────────────────
  // 问题：真实运行里 `deepDives` 长期为空（§21.5 四次运行 0 触发），而深挖是「被噪声地板拦下的
  // 强候选」唯一的救援通道 —— 它到底还能不能被触发、触发之后能不能买到采纳？本轮用**现有采样**
  // （零新采样）回放生产真实档位 × 时长的组合，量出触发覆盖率、卡点分解与扩轮产出率。
  // 触发条件（生产，triggerOptimizerSearch.js 的采纳分支）：槽级最优候选
  // `isAdoptionBlockedByEvidence(winner)` **且** `settings.rounds < DEEP_DIVE_ROUNDS`（每槽每次
  // 运行最多一次）。档位口径**取生产预设表**（PRESETS × resolveTriggerOptimizerPresetRounds）：
  // 脚本里不另抄「哪档几轮、上限几条」，预设改了这里跟着变。
  // 产出率口径：触发后用**与决策样本不相交的 DEEP_DIVE_ROUNDS 轮**重测，再走生产
  // `shouldAdoptCandidate`（生产用独立盐，这里用同一盐的不相交种子 —— 对「判据样本独立于触发
  // 决策」这一点等价）。放宽门槛的对照臂只改**触发侧**（采纳侧仍是生产判据），回答「把深挖的
  // 触发面放宽能买到什么」。
  {
    const SCREEN = engine.TRIGGER_OPTIMIZER_SCREEN_ROUNDS;
    const DIVE_ROUNDS = engine.TRIGGER_OPTIMIZER_DEEP_DIVE_ROUNDS;
    const BAR = engine.TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE;
    const RELAXED_BARS = [0.005, 0.002];
    const tierRows = [];
    for (const preset of engine.TRIGGER_OPTIMIZER_PRESETS) {
      for (const hours of [4, 8, 24]) {
        const rounds = engine.resolveTriggerOptimizerPresetRounds(preset, hours);
        const key = `${preset.candidateLimit}|${rounds}`;
        const tag = `${preset.id}@${hours}h`;
        const existing = tierRows.find((entry) => entry.key === key);
        if (existing) existing.tags.push(tag);
        else tierRows.push({ key, limit: preset.candidateLimit, rounds, tags: [tag] });
      }
    }
    const baselineSamples = samplesByKey.get('baseline');
    assert.equal(baselineSamples?.length, args.seeds, '深挖窗口：基线样本缺失');
    const percentText = (value) => `${(value * 100).toFixed(1)}%`;
    const fixed = (value) => (Number.isFinite(value) ? value.toFixed(5) : '—');
    const medianOf = (values) => {
      if (values.length === 0) return null;
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    console.log('');
    console.log(
      `深挖窗口可达性（采样时长 ${args.hours}h；粗筛 ${SCREEN} 场 / 精测 d 场 / 扩轮 ${DIVE_ROUNDS} 场；` +
        `触发门槛 ${BAR}；每方案 ${args.trials} 次试验）`,
    );
    console.log('档位口径 = 生产预设表（fast 上限 6 / standard 10 / fine 20；4h 与 8h 查表，更长时长用各档兜底轮数）');
    for (const row of tierRows) {
      const eligible = row.rounds < DIVE_ROUNDS;
      // 「本次采样时长命中」= 该 (上限, 轮数) 组合正是**这一档在采样时长下**的取值（预设表按
      // args.hours 解析）。早先写成「标签出现 @<hours>h 或 args.hours > 8」会把 24h 采样下的
      // 4h/8h 档行也标成命中（2026-09-25 实测踩到），这里改为逐档按预设表比对。
      const measured = engine.TRIGGER_OPTIMIZER_PRESETS.some(
        (preset) =>
          preset.candidateLimit === row.limit &&
          engine.resolveTriggerOptimizerPresetRounds(preset, args.hours) === row.rounds,
      );
      if (SCREEN + row.rounds + DIVE_ROUNDS > args.seeds) {
        console.log(
          `  L=${row.limit} d=${row.rounds}（${row.tags.join('、')}）：跳过 —— 样本轮数不足（需 ≥ ${
            SCREEN + row.rounds + DIVE_ROUNDS
          } 轮，当前 ${args.seeds}）`,
        );
        continue;
      }
      const totals = {
        total: 0,
        dive: 0,
        adopt: 0,
        barMiss: 0,
        unknown: 0,
        inconclusive: 0,
        negative: 0,
        diveAdopted: 0,
      };
      const relaxedTotals = RELAXED_BARS.map((bar) => ({ bar, dive: 0, adopted: 0 }));
      const slotLines = [];
      for (const slot of slotContexts) {
        const pool = slot.candidates.slice(0, row.limit);
        const useRacing = engine.isRacingPool(pool.length);
        const sampleOf = (candidate) => samplesByKey.get(`${slot.slotIndex}|${candidate.signature}`);
        for (const candidate of pool) {
          assert.equal(sampleOf(candidate)?.length, args.seeds, `槽 ${slot.slotIndex} 深挖窗口候选样本缺失`);
        }
        const aggOf = (samples, group) => engine.aggregateRoundMetrics(group.map((index) => samples[index]));
        const entryFor = (candidate, group, baselineAgg) => {
          const metrics = aggOf(sampleOf(candidate), group);
          return {
            ...candidate,
            metrics,
            score: engine.scoreCandidate(metrics, weights, baselineAgg),
            paired: engine.computePairedStats(metrics, baselineAgg, weights),
          };
        };
        const stats = {
          total: 0,
          dive: 0,
          adopt: 0,
          barMiss: 0,
          unknown: 0,
          inconclusive: 0,
          negative: 0,
          diveAdopted: 0,
        };
        const relaxed = RELAXED_BARS.map((bar) => ({ bar, dive: 0, adopted: 0 }));
        const scores = [];
        for (let trial = 0; trial < args.trials; trial += 1) {
          const perm = shuffle(seedIndices, rng);
          const screenGroup = perm.slice(0, SCREEN);
          const decideGroup = perm.slice(SCREEN, SCREEN + row.rounds);
          const freshGroup = perm.slice(SCREEN + row.rounds, SCREEN + row.rounds + DIVE_ROUNDS);
          const decideBaseline = aggOf(baselineSamples, decideGroup);
          let entries;
          if (useRacing) {
            const screenBaseline = aggOf(baselineSamples, screenGroup);
            const screenEntries = pool.map((candidate) => entryFor(candidate, screenGroup, screenBaseline));
            entries = engine
              .pickRacingSurvivors(screenEntries)
              .map((candidate) => entryFor(candidate, decideGroup, decideBaseline));
          } else {
            entries = pool.map((candidate) => entryFor(candidate, decideGroup, decideBaseline));
          }
          const winner = entries.filter(Boolean).sort(engine.compareCandidates)[0];
          stats.total += 1;
          if (!winner) {
            stats.barMiss += 1;
            continue;
          }
          scores.push(Number(winner.score));
          if (!engine.isAdoptionBlockedByEvidence(winner)) {
            if (engine.shouldAdoptCandidate(winner)) stats.adopt += 1;
            else stats.barMiss += 1;
            continue;
          }
          stats.dive += 1;
          const verdict = String(winner.paired?.score?.verdict ?? 'unknown');
          if (verdict === 'inconclusive') stats.inconclusive += 1;
          else if (verdict === 'negative') stats.negative += 1;
          else stats.unknown += 1;
          const freshBaseline = aggOf(baselineSamples, freshGroup);
          const freshEntry = entryFor(winner, freshGroup, freshBaseline);
          const freshAdopted = engine.shouldAdoptCandidate(freshEntry);
          if (freshAdopted) stats.diveAdopted += 1;
          const evidence = engine.hasAdoptionEvidence(winner.paired);
          for (const item of relaxed) {
            if (evidence || !(Number(winner.score) >= item.bar)) continue;
            item.dive += 1;
            if (freshAdopted) item.adopted += 1;
          }
        }
        totals.total += stats.total;
        totals.dive += stats.dive;
        totals.adopt += stats.adopt;
        totals.barMiss += stats.barMiss;
        totals.unknown += stats.unknown;
        totals.inconclusive += stats.inconclusive;
        totals.negative += stats.negative;
        totals.diveAdopted += stats.diveAdopted;
        for (const [index, item] of relaxed.entries()) {
          relaxedTotals[index].dive += item.dive;
          relaxedTotals[index].adopted += item.adopted;
        }
        const diveTotal = Math.max(1, stats.dive);
        slotLines.push(
          `  槽 ${slot.slotIndex}（${slot.abilityHrid}，池 ${pool.length} 条，${
            useRacing ? `racing：粗筛 ${SCREEN} 场 → 幸存者进精测` : '小池：全池进精测'
          }）：触发 ${percentText(stats.dive / stats.total)}｜直采纳 ${percentText(
            stats.adopt / stats.total,
          )}｜未达门槛 ${percentText(stats.barMiss / stats.total)}｜触发构成 无标准误 ${percentText(
            stats.unknown / diveTotal,
          )} / 未过地板 ${percentText(stats.inconclusive / diveTotal)} / 逐轮更差 ${percentText(
            stats.negative / diveTotal,
          )}｜winner 分中位 ${fixed(medianOf(scores))}`,
        );
      }
      console.log(
        `L=${row.limit} d=${row.rounds}（${row.tags.join('、')}）｜${
          measured ? '本次采样时长命中' : '时长≠采样（仅轮数口径对照）'
        }｜深挖资格 ${eligible ? `✓（d < ${DIVE_ROUNDS}）` : `✗（d ≥ ${DIVE_ROUNDS}，结构上永不触发）`}`,
      );
      for (const line of slotLines) console.log(line);
      console.log(
        `  合计：触发 ${percentText(totals.dive / totals.total)}（${totals.dive}/${totals.total}）→ 扩轮采纳 ${percentText(
          totals.diveAdopted / totals.total,
        )}（条件通过率 ${percentText(totals.diveAdopted / Math.max(1, totals.dive))}）｜期望成本 ${
          eligible ? percentText(totals.dive / totals.total) : '0.0%'
        } × ${2 * DIVE_ROUNDS} 场/槽/轮`,
      );
      console.log(
        `  ${relaxedTotals
          .map(
            (item) =>
              `放宽触发到 ${item.bar}：触发 ${percentText(item.dive / totals.total)}（+${percentText(
                (item.dive - totals.dive) / totals.total,
              )}）、额外采纳 ${item.adopted - totals.diveAdopted} 次`,
          )
          .join('｜')}`,
      );
    }
    console.log(
      '判读：触发率 = 该档位下一次运行里深挖会启动的概率（只有 d < 6 的档位真的会启动）；扩轮采纳 = ' +
        '触发后用不相交的新样本重测、能通过生产采纳判据的概率；「额外采纳」= 放宽触发面买到的采纳次数（0 ⇒ 放宽只增加空转）。',
    );
  }

  console.log('');
  // ── 组合内单腿精炼：行走回放与裁决（2026-09-27，设计 §57 研究）──────────────────
  // 判据（预注册，开跑前写死；冒烟后按生产语义收窄主口径 —— 生产只在「起点被采纳」时才触发
  // 精炼，全起点口径包含生产不会发生的假场景、会高估收益）：主口径 = 「起点被采纳」子集的
  // 行走净效应（留出真实分、配对差）mean > 0 且 t ≥ 3 且负例率 < 5% ⇒ 值得实施；否则不实施
  //（如实写档）。另报三条参考口径：全 2 腿起点、组合族/current 拆分、in-sample 天花板。
  {
    const fixed = (value) => (Number.isFinite(value) ? value.toFixed(5) : '—');
    const percentText = (value) => `${(value * 100).toFixed(1)}%`;
    const tText = (value) => (Number.isFinite(value) ? value.toFixed(2) : '—');
    const baselineSamples = samplesByKey.get('baseline');
    assert.equal(baselineSamples?.length, args.seeds, '组合腿精炼：基线样本缺失');
    const labelOf = (candidate) =>
      `${String(candidate.labelKey ?? '').replace('common:triggerOptimizer.candidate.', '')} ${JSON.stringify(
        candidate.labelParams ?? {},
      )}`;
    const diffStats = (rows) => {
      const diffs = rows.map((row) => row.diff);
      const meanDiff = mean(diffs);
      const variance =
        diffs.length > 1 ? diffs.reduce((sum, value) => sum + (value - meanDiff) ** 2, 0) / (diffs.length - 1) : 0;
      const stdError = diffs.length > 0 ? Math.sqrt(variance / diffs.length) : 0;
      const n = diffs.length;
      return {
        n,
        mean: meanDiff,
        stdError,
        t: stdError > 0 ? meanDiff / stdError : NaN,
        wins: diffs.filter((value) => value > 0).length,
        ties: diffs.filter((value) => value === 0).length,
        losses: diffs.filter((value) => value < 0).length,
      };
    };
    const format = (stats) =>
      `mean ${fixed(stats.mean)} ± ${fixed(stats.stdError)}（t = ${tText(stats.t)}；胜 ${percentText(
        stats.n ? stats.wins / stats.n : 0,
      )} / 平 ${percentText(stats.n ? stats.ties / stats.n : 0)} / 负 ${percentText(stats.n ? stats.losses / stats.n : 0)}）`;
    console.log('');
    console.log(
      `组合内单腿精炼（${args.zone} tier ${args.tier} / ${args.hours}h；决策 ${args.rounds} 轮 / 留出 ${
        args.seeds - args.rounds
      } 轮；每方案 ${args.trials} 次试验）`,
    );
    const allRows = [];
    for (const study of compositeLegStudy.studies) {
      const slot = slotContexts.find((entry) => entry.slotIndex === study.slotIndex);
      const pool = slot.candidates;
      const sampleOf = (candidate) => samplesByKey.get(`${candidate.slotIndex}|${candidate.signature}`);
      for (const entry of study.composites) {
        assert.equal(
          sampleOf(entry.candidate)?.length,
          args.seeds,
          `组合腿精炼：起点样本缺失 ${entry.candidate.signature}`,
        );
        for (const probe of entry.probesByLevel.flat()) {
          assert.equal(sampleOf(probe)?.length, args.seeds, `组合腿精炼：探针样本缺失 ${probe.signature}`);
        }
      }
      // ① in-sample 天花板（全体种子聚合）：邻域最优 − 起点 = 对邻域族最有利的「事后看」上界。
      const grandBaseline = engine.aggregateRoundMetrics(baselineSamples);
      const grandScore = (candidate) =>
        engine.scoreCandidate(engine.aggregateRoundMetrics(sampleOf(candidate)), weights, grandBaseline);
      const poolBest = Math.max(...pool.map(grandScore));
      console.log(
        `  槽 ${study.slotIndex}（${study.abilityHrid}）：池最优真实分 ${fixed(poolBest)}；2 腿起点 ${
          study.composites.length
        } 条（可精炼 ${study.composites.filter((entry) => entry.legs.length > 0).length} 条）`,
      );
      for (const entry of study.composites) {
        const startScore = grandScore(entry.candidate);
        const probeScores = entry.probesByLevel.flat().map(grandScore);
        const probeBest = probeScores.length > 0 ? Math.max(...probeScores) : startScore;
        console.log(
          `    ${entry.source === 'current' ? '[当前配置]' : '[组合族]'} ${labelOf(entry.candidate)}：` +
            `起点 ${fixed(startScore)}（Δ池 ${startScore - poolBest >= 0 ? '+' : ''}${fixed(startScore - poolBest)}）｜` +
            `邻域最优 ${fixed(probeBest)}（天花板 Δ ${probeBest - startScore >= 0 ? '+' : ''}${fixed(probeBest - startScore)}）`,
        );
      }
      // ② 行走回放（生产采纳门槛）：决策样本走、留出样本评；同时记「起点自身是池 winner」的子集。
      let compositeWinnerCount = 0;
      let compositeAdoptedCount = 0;
      for (let trial = 0; trial < args.trials; trial += 1) {
        const perm = shuffle(seedIndices, rng);
        const decideIdx = perm.slice(0, args.rounds);
        const holdIdx = perm.slice(args.rounds);
        const aggregate = (samples, idx) => engine.aggregateRoundMetrics(idx.map((index) => samples[index]));
        const baselineDecide = aggregate(baselineSamples, decideIdx);
        const baselineTruth = aggregate(baselineSamples, holdIdx);
        const entryCache = new Map();
        const entryOf = (candidate) => {
          const cached = entryCache.get(candidate.signature);
          if (cached) return cached;
          const metrics = aggregate(sampleOf(candidate), decideIdx);
          const entry = {
            ...candidate,
            metrics,
            score: engine.scoreCandidate(metrics, weights, baselineDecide),
            paired: engine.computePairedStats(metrics, baselineDecide, weights),
          };
          entryCache.set(candidate.signature, entry);
          return entry;
        };
        const truthScoreOf = (candidate) =>
          engine.scoreCandidate(aggregate(sampleOf(candidate), holdIdx), weights, baselineTruth);
        const winner = [...pool.map(entryOf)].sort(engine.compareCandidates)[0];
        const winnerAdoptable = engine.shouldAdoptCandidate(entryOf(winner));
        if (study.composites.some((entry) => entry.candidate.signature === winner.signature)) {
          compositeWinnerCount += 1;
          if (winnerAdoptable) compositeAdoptedCount += 1;
        }
        for (const entry of study.composites) {
          if (entry.legs.length === 0) continue;
          let base = entry.candidate;
          const visited = new Set([base.signature]);
          let evaluations = 0;
          let levels = 0;
          for (let level = 0; level < REFINEMENT_LEVELS; level += 1) {
            const probes = entry.probesByLevel[level].filter((probe) => !visited.has(probe.signature));
            if (probes.length === 0) break;
            for (const probe of probes) visited.add(probe.signature);
            evaluations += probes.length;
            const best = probes.map(entryOf).sort(engine.compareCandidates)[0];
            if (!engine.shouldAdoptCandidate(best, entryOf(base))) break;
            base = best;
            levels = level + 1;
          }
          allRows.push({
            source: entry.source,
            diff: truthScoreOf(base) - truthScoreOf(entry.candidate),
            evaluations,
            levels,
            changed: base.signature !== entry.candidate.signature,
            startWon: winner.signature === entry.candidate.signature,
            // 主口径：起点被生产采纳（该槽 winner 且过槽级采纳门槛）—— 只有这个场景生产会触发精炼。
            startAdoptable:
              winner.signature === entry.candidate.signature && engine.shouldAdoptCandidate(entryOf(entry.candidate)),
          });
        }
      }
      console.log(
        `    起点可达性：2 腿候选成为池 winner 的频率 = ${percentText(compositeWinnerCount / args.trials)}` +
          `（${compositeWinnerCount}/${args.trials}）｜其中过采纳门槛 = ${percentText(
            compositeAdoptedCount / args.trials,
          )}（${compositeAdoptedCount}/${args.trials}）`,
      );
    }
    const all = diffStats(allRows);
    const familyRows = diffStats(allRows.filter((row) => row.source === 'composite'));
    const currentRows = diffStats(allRows.filter((row) => row.source === 'current'));
    const startWonRows = diffStats(allRows.filter((row) => row.startWon));
    const adoptedRows = diffStats(allRows.filter((row) => row.startAdoptable));
    console.log('  行走净效应（配对差 = 行走终点真实分 − 起点真实分；主口径 = 生产真会精炼的场景）');
    console.log(`    主口径「起点被采纳」（${adoptedRows.n} 个样本）：${format(adoptedRows)}`);
    console.log(`    参考口径1 全 2 腿起点（${all.n}；含生产不会发生的假场景，会高估）：${format(all)}`);
    console.log(
      `    参考口径2 组合族子集（${familyRows.n}）：${format(familyRows)}｜当前配置锚点子集（${currentRows.n}）：${format(currentRows)}`,
    );
    console.log(`    参考口径3「起点自身是池 winner」子集（${startWonRows.n}）：${format(startWonRows)}`);
    console.log(
      `  成本：平均评估 ${mean(allRows.map((row) => row.evaluations)).toFixed(2)} 次 / 起点（级数上限 ${REFINEMENT_LEVELS}；` +
        `每级 ≤ 2 腿 × 2 向）｜平均行走级数 ${mean(allRows.map((row) => row.levels)).toFixed(2)}｜终值与起点不同 ${percentText(
          allRows.length ? allRows.filter((row) => row.changed).length / allRows.length : 0,
        )}`,
    );
    const pass =
      adoptedRows.n > 0 &&
      adoptedRows.mean > 0 &&
      adoptedRows.t >= 3 &&
      adoptedRows.losses / Math.max(1, adoptedRows.n) < 0.05;
    console.log(
      `判据（预注册 C2，冒烟后按生产语义收窄主口径）：主口径 mean > 0 ∧ t ≥ 3 ∧ 负例率 < 5% ⇒ 当前${
        pass ? '通过（值得实施）' : '未通过（不实施，如实写档）'
      }（C1 对齐自证见上方构造段输出：通过 ${compositeLegStudy.alignment.checked} 类）`,
    );
    console.log('判读：① 起点可达性 = 2 腿候选在真实决策里的竞争力（未过采纳门槛 ⇒ 生产根本不会触发精炼）；');
    console.log(
      '      ② 天花板 = 邻域调到完美的上界（事后口径）；③ 主口径只在「起点被采纳」场景衡量，参考口径含假场景、会高估。',
    );
  }

  console.log('');
  // ── 跨区域适用性：移植率与跨区域复核判别力（2026-09-27，设计 §58 研究）────────────
  // 判据（预注册，开跑前写死；②③ 全部走生产实现，脚本不另抄阈值）：
  //   D1（硬·装置自证）：复核样本 = 生产 robustness 盐在目标区域设置上派生（与源搜索/其它区域两两
  //       不相交，构造段断言）；winner 用源 decide 样本、真值用两侧**同索引**留出样本、复核只用
  //       recheck 样本前缀（三组互斥）。
  //   D2（主·问题严重性）：portRate = P(源已采纳 winner 在目标区域留出样本上仍过生产采纳闸门
  //       shouldAdoptCandidate：≥ MIN_ADOPT_SCORE ∧ 配对证据)——「换区域后仍会被采纳」。
  //       所有目标区域 ≥ 95% ⇒ 移植基本安全 ⇒ 不实施；任一 < 95% ⇒ 问题存在，进入 D3。
  //   D3（主·复核有效性；仅 D2 触发时裁决，逐目标区域、6 轮臂 = 现状保底口径）：
  //       ① 不虚报（硬）：**失效样本**（源已采纳 ∧ 目标真值 ≤ 0）上跨区域复核判成立（positive）
  //          ≤ 5%（n ≥ 20 才判；否则记「样本不足」）；
  //       ② 不空转（硬）：池级 real 桶（目标全体种子真实分 > MIN_ADOPT_SCORE）与 null 桶（≤ 0）的判
  //          成立率之差 ≥ 40pp（real cases ≥ 3 才判；否则记「样本不足」）。
  //       裁决：每个目标区域至少一项可判 ∧ 所有可判项通过 ⇒ 实施；否则不实施。
  //       （形态：目标区域由用户指定 —— 区域之间没有良定义顺序；轮数沿用 §49 的按需 + 保底。）
  //   参考列（不参与裁决）：portRatePos（真实分 > 0）、meanΔ（目标真值 − 源真值，−∞ = 空蓝否决）、
  //       失效样本的判负率、成立样本检出率（跨区域 vs 同区域对照）、上限轮臂、池级搬运表。
  //   口径修正（冒烟后、正式跑前，如实记录；同 §43/§57 的「判据演化」先例）：初版 ① 用「目标未过
  //   采纳闸门」当失效集、② 直接要求 real 桶判成立 ≥ 50%。冒烟显示 ① 把 (0, 0.01) 的微提升误算成
  //   失效（生产语义下那不是「没提升」），② 在「目标区域池里几乎没有真提升候选」时会因分母为空被
  //   误判为失败。按 §31/§47/§49 的既有口径（案例方向必须明确）收窄：① 只看真值 ≤ 0 的明确失效，
  //   ② 改判「real − null 的分离度」。
  if (crossZoneStudy) {
    const { entries, RECHECK_ROUNDS, BASE_ROUNDS } = crossZoneStudy;
    const MIN_ADOPT = engine.TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE;
    const fixed = (value) => (Number.isFinite(value) ? value.toFixed(5) : '—');
    const percentText = (value) => `${(value * 100).toFixed(1)}%`;
    const fmtRate = (count, denominator) => (denominator === 0 ? '—' : percentText(count / denominator));
    const aggSubset = (samples, idx) => engine.aggregateRoundMetrics(idx.map((index) => samples[index]));
    const recheckIndices = Array.from({ length: RECHECK_ROUNDS }, (_, index) => index);
    const directGet = (suffix) => samplesByKey.get(suffix);
    const prefixGet = (prefix) => (suffix) => samplesByKey.get(`${prefix}|${suffix}`);
    const buildMatrix = (slot, get) => {
      const list = [get('baseline')];
      for (const candidate of slot.candidates) list.push(get(`${slot.slotIndex}|${candidate.signature}`));
      for (const samples of list)
        assert.ok(Array.isArray(samples) && samples.length > 0, `跨区域：样本缺失（槽 ${slot.slotIndex}）`);
      return list;
    };
    const labelOf = (candidate) =>
      `${String(candidate.labelKey ?? '').replace('common:triggerOptimizer.candidate.', '')} ${JSON.stringify(
        candidate.labelParams ?? {},
      )}`;
    const deltaStats = (list) => {
      // −∞（空蓝否决）不参与均值：它是生产的确定性否决语义，单独计数显示（否则 mean 变 −∞ 不可读）。
      const finite = list.filter((value) => Number.isFinite(value));
      const meanValue = mean(finite);
      const variance =
        finite.length > 1 ? finite.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) / (finite.length - 1) : 0;
      const stdError = finite.length > 0 ? Math.sqrt(variance / finite.length) : 0;
      return { n: finite.length, mean: meanValue, stdError, t: stdError > 0 ? meanValue / stdError : NaN };
    };
    const medianOf = (list) => {
      const finite = list.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
      if (finite.length === 0) return NaN;
      const middle = Math.floor(finite.length / 2);
      return finite.length % 2 === 0 ? (finite[middle - 1] + finite[middle]) / 2 : finite[middle];
    };
    const zoneDefs = [
      {
        key: 'ctrl',
        label: `源区域 ${args.zone}（同区域对照）`,
        truthGet: directGet,
        recheckGet: prefixGet('cross|ctrl|recheck'),
      },
      ...entries.map((entry, index) => ({
        key: `z${index}`,
        label: `目标区域 ${entry.zoneHrid}`,
        truthGet: prefixGet(`cross|z${index}`),
        recheckGet: prefixGet(`cross|z${index}|recheck`),
      })),
    ];
    console.log(
      `跨区域适用性（${args.zone} tier ${args.tier} / ${args.hours}h；每方案 ${args.trials} 次试验；源 winner = 源 decide 样本上` +
        '的 compareCandidates top-1 且过生产采纳闸门；真值 = 两侧**同索引**留出样本）',
    );

    // ① 池级搬运表（全体 args.seeds 轮聚合，与逐试验 winner 口径独立）：源真提升候选在目标区域还剩几条。
    for (const zone of zoneDefs) {
      const parts = [];
      for (const slot of slotContexts) {
        const sourceGrand = buildMatrix(slot, directGet).map((samples) => engine.aggregateRoundMetrics(samples));
        const zoneGrand = buildMatrix(slot, zone.truthGet).map((samples) => engine.aggregateRoundMetrics(samples));
        const sourceScores = slot.candidates.map((_, index) =>
          engine.scoreCandidate(sourceGrand[index + 1], weights, sourceGrand[0]),
        );
        const zoneScores = slot.candidates.map((_, index) =>
          engine.scoreCandidate(zoneGrand[index + 1], weights, zoneGrand[0]),
        );
        const sourceReal = sourceScores
          .map((score, index) => ({ score, index }))
          .filter((row) => row.score > MIN_ADOPT);
        const kept = sourceReal.filter((row) => zoneScores[row.index] > MIN_ADOPT).length;
        const zoneBestIndex = zoneScores.indexOf(Math.max(...zoneScores));
        const detail = sourceReal.length
          ? `｜源真提升逐条：${sourceReal
              .map(
                (row) =>
                  `\`${labelOf(slot.candidates[row.index])}\` ${fixed(row.score)} → ${fixed(zoneScores[row.index])}`,
              )
              .join('；')}`
          : '';
        parts.push(
          `    槽 ${slot.slotIndex}：${kept}/${sourceReal.length}（目标上最优的源池候选 = \`${labelOf(
            slot.candidates[zoneBestIndex],
          )}\` ${fixed(zoneScores[zoneBestIndex])}）${detail}`,
        );
      }
      console.log(`  ${zone.label} 池级搬运（源真提升候选 → 目标仍 > 0.01）：`);
      for (const part of parts) console.log(part);
    }

    // ② 逐试验：源 winner（源 decide 样本选出）在四侧的同索引留出真值 + 复核臂（6 / 上限 轮前缀，逐样本换 perm）。
    const stats = new Map(
      zoneDefs.map((zone) => [
        zone.key,
        {
          label: zone.label,
          adopted: 0,
          adoptedBySlot: new Map(),
          port: 0,
          portPos: 0,
          delta: [],
          deltaNonFinite: 0,
          fail: 0,
          failZone: 0,
          failNegative: 0,
          failControl: 0,
          failTruth: [],
          hold: 0,
          holdZone: 0,
          holdControl: 0,
          mid: 0,
          buckets: { real: { cases: 0, trials: 0, base: 0, cap: 0 }, null: { cases: 0, trials: 0, base: 0, cap: 0 } },
        },
      ]),
    );
    const refs = zoneDefs.map((zone) => ({
      zone,
      matrices: new Map(slotContexts.map((slot) => [slot.slotIndex, buildMatrix(slot, zone.truthGet)])),
      rechecks: new Map(slotContexts.map((slot) => [slot.slotIndex, buildMatrix(slot, zone.recheckGet)])),
    }));
    const controlRef = refs.find((ref) => ref.zone.key === 'ctrl');
    const winnerRng = createSeededRandom(20260929);
    for (const slot of slotContexts) {
      const sourceMatrix = buildMatrix(slot, directGet);
      for (let trial = 0; trial < args.trials; trial += 1) {
        const perm = shuffle(seedIndices, winnerRng);
        const decideIdx = perm.slice(0, args.rounds);
        const holdIdx = perm.slice(args.rounds);
        const sourceDecide = aggSubset(sourceMatrix[0], decideIdx);
        const sourceEntries = slot.candidates.map((candidate, index) => {
          const metrics = aggSubset(sourceMatrix[index + 1], decideIdx);
          return {
            ...candidate,
            configIndex: index + 1,
            metrics,
            score: engine.scoreCandidate(metrics, weights, sourceDecide),
            paired: engine.computePairedStats(metrics, sourceDecide, weights),
          };
        });
        // 生产语义：换难度/换区域复核的对象是**被采纳的结论**；没被采纳的 winner 不会被搬去其它区域。
        const winner = [...sourceEntries].sort(engine.compareCandidates)[0];
        if (!engine.shouldAdoptCandidate(winner)) continue;
        const sourceTruth = engine.scoreCandidate(
          aggSubset(sourceMatrix[winner.configIndex], holdIdx),
          weights,
          aggSubset(sourceMatrix[0], holdIdx),
        );
        const recheckPerm = shuffle(recheckIndices, winnerRng);
        const controlRecheck = controlRef.rechecks.get(slot.slotIndex);
        const controlPositive =
          String(
            engine.computePairedStats(
              aggSubset(controlRecheck[winner.configIndex], recheckPerm.slice(0, BASE_ROUNDS)),
              aggSubset(controlRecheck[0], recheckPerm.slice(0, BASE_ROUNDS)),
              weights,
            )?.score?.verdict ?? 'unknown',
          ) === 'positive';
        for (const ref of refs) {
          const stat = stats.get(ref.zone.key);
          const matrix = ref.matrices.get(slot.slotIndex);
          const zonePaired = engine.computePairedStats(
            aggSubset(matrix[winner.configIndex], holdIdx),
            aggSubset(matrix[0], holdIdx),
            weights,
          );
          const zoneTruth = engine.scoreCandidate(
            aggSubset(matrix[winner.configIndex], holdIdx),
            weights,
            aggSubset(matrix[0], holdIdx),
          );
          const adoptable = engine.shouldAdoptCandidate({ score: zoneTruth, paired: zonePaired });
          const delta = zoneTruth - sourceTruth;
          const recheck = ref.rechecks.get(slot.slotIndex);
          const zoneVerdict = String(
            engine.computePairedStats(
              aggSubset(recheck[winner.configIndex], recheckPerm.slice(0, BASE_ROUNDS)),
              aggSubset(recheck[0], recheckPerm.slice(0, BASE_ROUNDS)),
              weights,
            )?.score?.verdict ?? 'unknown',
          );
          const controlHit = ref.zone.key === 'ctrl' ? zoneVerdict === 'positive' : controlPositive;
          stat.adopted += 1;
          stat.adoptedBySlot.set(slot.slotIndex, (stat.adoptedBySlot.get(slot.slotIndex) ?? 0) + 1);
          if (adoptable) stat.port += 1;
          if (zoneTruth > 0) stat.portPos += 1;
          stat.delta.push(delta);
          if (!Number.isFinite(delta)) stat.deltaNonFinite += 1;
          if (zoneTruth <= 0) {
            // 失效样本（D3 ① 的分母）：换区域后明确不再有提升（含 −Infinity = 空蓝否决）。
            stat.fail += 1;
            stat.failTruth.push(zoneTruth);
            if (zoneVerdict === 'positive') stat.failZone += 1;
            if (zoneVerdict === 'negative') stat.failNegative += 1;
            if (controlHit) stat.failControl += 1;
          } else if (adoptable) {
            // 移植成立（真值过生产闸门）：检出率参考口径（分母可能很薄，如实显示样本数）。
            stat.hold += 1;
            if (zoneVerdict === 'positive') stat.holdZone += 1;
            if (controlHit) stat.holdControl += 1;
          } else {
            stat.mid += 1;
          }
        }
      }
    }

    // ③ 复核臂（§49 同构：逐 candidate × trial 换 perm 取前缀）——real / null 桶的判成立率。
    const bucketRng = createSeededRandom(20260930);
    for (const ref of refs) {
      const stat = stats.get(ref.zone.key);
      for (const slot of slotContexts) {
        const matrix = ref.matrices.get(slot.slotIndex);
        const recheck = ref.rechecks.get(slot.slotIndex);
        const grand = matrix.map((samples) => engine.aggregateRoundMetrics(samples));
        for (let index = 1; index <= slot.candidates.length; index += 1) {
          const truthScore = engine.scoreCandidate(grand[index], weights, grand[0]);
          const bucket = truthScore > MIN_ADOPT ? stat.buckets.real : truthScore <= 0 ? stat.buckets.null : null;
          // (0, MIN_ADOPT] 的边缘案例两头都不进：判据要求案例方向明确（与 §31/§47/§49 同款）。
          if (!bucket) continue;
          bucket.cases += 1;
          for (let trial = 0; trial < args.trials; trial += 1) {
            const perm = shuffle(recheckIndices, bucketRng);
            const positiveAt = (count) =>
              String(
                engine.computePairedStats(
                  aggSubset(recheck[index], perm.slice(0, count)),
                  aggSubset(recheck[0], perm.slice(0, count)),
                  weights,
                )?.score?.verdict ?? 'unknown',
              ) === 'positive';
            bucket.trials += 1;
            if (positiveAt(BASE_ROUNDS)) bucket.base += 1;
            if (positiveAt(RECHECK_ROUNDS)) bucket.cap += 1;
          }
        }
      }
    }

    // ④ 汇总与裁决。
    console.log(
      '  移植率 = 源已采纳 winner 在目标留出样本上「仍过生产采纳闸门」的比例；meanΔ = 目标真值 − 源真值（同索引配对，−∞ = 空蓝否决）。',
    );
    const zoneRows = [];
    for (const zone of zoneDefs) {
      const stat = stats.get(zone.key);
      const delta = deltaStats(stat.delta);
      const real = stat.buckets.real;
      const nul = stat.buckets.null;
      console.log(
        `  ${stat.label}（源已采纳 winner 样本 n=${stat.adopted}；按槽 ${[...stat.adoptedBySlot.entries()]
          .map(([slotIndex, count]) => `槽${slotIndex}:${count}`)
          .join('/')}）`,
      );
      console.log(
        `    移植率 ${fmtRate(stat.port, stat.adopted)}（${stat.port}/${stat.adopted}）｜真实分 > 0：${fmtRate(
          stat.portPos,
          stat.adopted,
        )}｜meanΔ ${
          zone.key === 'ctrl'
            ? '—（同源，恒 0）'
            : `${fixed(delta.mean)} ± ${fixed(delta.stdError)}（t = ${
                Number.isFinite(delta.t) ? delta.t.toFixed(2) : '—'
              }；有限样本 ${delta.n}${stat.deltaNonFinite > 0 ? `，−∞ ${stat.deltaNonFinite}` : ''}）`
        }`,
      );
      console.log(
        `    复核臂 ${BASE_ROUNDS} 轮：real 桶判成立 ${fmtRate(real.base, real.trials)}（cases=${real.cases}）｜null 桶假阳性 ${fmtRate(
          nul.base,
          nul.trials,
        )}（cases=${nul.cases}）｜${RECHECK_ROUNDS} 轮：real ${fmtRate(real.cap, real.trials)} / null ${fmtRate(nul.cap, nul.trials)}`,
      );
      console.log(
        `    失效样本（源已采纳 ∧ 目标真值 ≤ 0）n=${stat.fail}：跨区域复核判成立 ${fmtRate(
          stat.failZone,
          stat.fail,
        )}｜判负 ${fmtRate(stat.failNegative, stat.fail)}｜同区域对照判成立 ${fmtRate(
          stat.failControl,
          stat.fail,
        )}｜失效真值 mean ${fixed(deltaStats(stat.failTruth).mean)} / 中位 ${fixed(medianOf(stat.failTruth))}（−∞ ${
          stat.failTruth.filter((value) => !Number.isFinite(value)).length
        }）`,
      );
      console.log(
        `    成立样本（真值过闸门）n=${stat.hold}：跨区域复核判成立 ${fmtRate(
          stat.holdZone,
          stat.hold,
        )}｜同区域对照判成立 ${fmtRate(stat.holdControl, stat.hold)}｜中间区（0, 0.01）n=${stat.mid}`,
      );
      if (zone.key !== 'ctrl') zoneRows.push(stat);
    }
    const d2Safe =
      zoneRows.length > 0 &&
      zoneRows.every((stat) => stat.adopted > 0 && stat.port / Math.max(1, stat.adopted) >= 0.95);
    console.log(
      `判据 D2（预注册）：全目标区域移植率 ≥ 95% ⇒ 移植基本安全（不实施）；任一 < 95% ⇒ 问题存在（进入 D3）。当前：${
        d2Safe ? '全部 ≥ 95%' : '存在 < 95% 的区域'
      }`,
    );
    // D3：① 不虚报（失效样本判成立率 ≤ 5%，n ≥ 20 才判）；② 不空转（real − null 判成立率 ≥ 40pp，
    // real cases ≥ 3 才判）。裁决 = 每个目标区域至少一项可判 ∧ 所有可判项通过 ⇒ 实施；否则不实施。
    const zoneGates = zoneRows.map((stat) => {
      const real = stat.buckets.real;
      const nul = stat.buckets.null;
      const gateA = stat.fail >= 20 ? stat.failZone / stat.fail <= 0.05 : null;
      const gateB =
        real.cases >= 3 ? real.base / Math.max(1, real.trials) - nul.base / Math.max(1, nul.trials) >= 0.4 : null;
      const judgeable = gateA !== null || gateB !== null;
      return { stat, gateA, gateB, judgeable, pass: judgeable && gateA !== false && gateB !== false };
    });
    const gateText = (value) => (value === null ? '样本不足' : value ? '通过' : '失败');
    for (const gate of zoneGates) {
      const real = gate.stat.buckets.real;
      const nul = gate.stat.buckets.null;
      console.log(
        `判据 D3 ${gate.stat.label}：① 失效样本判成立 ≤ 5%（n=${gate.stat.fail}，实测 ${fmtRate(
          gate.stat.failZone,
          gate.stat.fail,
        )}）${gateText(gate.gateA)}｜② real − null 判成立率 ≥ 40pp（real cases=${real.cases}，实测 ${fmtRate(
          real.base,
          real.trials,
        )} − ${fmtRate(nul.base, nul.trials)}）${gateText(gate.gateB)}`,
      );
    }
    const d3Pass = zoneGates.length > 0 && zoneGates.every((gate) => gate.pass);
    console.log(
      `裁决提示：${
        d2Safe
          ? 'D2 判定「移植基本安全」⇒ 无问题可解 ⇒ 不实施（如实写档）'
          : `D2 判定「问题存在」；D3 ${
              d3Pass
                ? '全区域通过 ⇒ 值得实施「换区域复核」入口（目标区域由用户指定；轮数沿用 §49 自适应）'
                : '存在不过/无证据的区域 ⇒ 复核给不出可靠答案 ⇒ 不实施（如实写档）'
            }`
      }`,
    );
    console.log(
      '判读：① 移植率/meanΔ 只用「源已采纳的 winner」（生产语义：只有被采纳的结论会被搬去其它区域）；' +
        '② 复核臂 = 目标区域上的生产 robustness 盐新样本，判据与 §29/§49 同源；③ 同区域对照把「复核机制本身的判别力」与「区域变更」分开。',
    );
  }

  console.log('');
  // ── 队伍载荷评估：单人最优在组队环境里还成不成立（2026-09-27，设计 §59 研究）────────────
  // 判据（预注册，开跑前写死；判定全走生产实现，脚本不另抄阈值）：
  //   D1（硬·装置自证）：① 队伍载荷下主角 enemyHp 与单人逐字段一致（构造段已打印对照）；
  //     ② 队伍样本完整（每 key = args.seeds 轮）；③ winner/真值/判定 = compareCandidates /
  //     scoreCandidate / computePairedStats / shouldAdoptCandidate。
  //   D2（主·结论会不会变）：对象 =「单人 decide 样本上被采纳的 winner」：
  //      partyPortRate = P(队伍留出真值仍过生产采纳闸门)；meanΔ = 队伍真值 − 单人真值（同索引配对）；
  //      换人率 = P(队伍环境选出的 winner ≠ 单人 winner)。
  //      统计口径（冒烟后、正式跑前固定）：meanΔ / regret 只在**有限样本**上取均值，−∞（空蓝否决）
  //      单独计数——含 −∞ 时均值恒为 −∞ / NaN，无判别意义；−∞ 个案已由判据 ① 以「未过闸门」计入。
  //      判据：partyPortRate < 95% ∨ |meanΔ| 的 t ≥ 3 ∨ 换人率 ≥ 20% ⇒ **需要**把队伍纳入评估；
  //            三条都不成立 ⇒ 队伍感知不改变结论（实施只剩「标注 + 指纹」那一半）。
  //   参考列：队伍最优对单人最优的 regret（队伍真值口径）、候选位移榜、成本（队伍采样的场/s）。
  if (partyStudy) {
    const fixed = (value) => (Number.isFinite(value) ? value.toFixed(5) : '—');
    const percentText = (value) => `${(value * 100).toFixed(1)}%`;
    const fmtRate = (count, denominator) => (denominator === 0 ? '—' : percentText(count / denominator));
    const aggSubset = (samples, idx) => engine.aggregateRoundMetrics(idx.map((index) => samples[index]));
    const deltaStats = (list) => {
      const meanValue = mean(list);
      const variance =
        list.length > 1 ? list.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) / (list.length - 1) : 0;
      const stdError = list.length > 0 ? Math.sqrt(variance / list.length) : 0;
      return { n: list.length, mean: meanValue, stdError, t: stdError > 0 ? meanValue / stdError : NaN };
    };
    const labelOf = (candidate) =>
      `${String(candidate.labelKey ?? '').replace('common:triggerOptimizer.candidate.', '')} ${JSON.stringify(
        candidate.labelParams ?? {},
      )}`;
    const matrixOf = (slot, get) => {
      const list = [get('baseline')];
      for (const candidate of slot.candidates) list.push(get(`${slot.slotIndex}|${candidate.signature}`));
      for (const samples of list) {
        assert.ok(Array.isArray(samples) && samples.length > 0, `队伍载荷：样本缺失（槽 ${slot.slotIndex}）`);
      }
      return list;
    };
    console.log(
      `队伍载荷评估（${args.zone} tier ${args.tier} / ${args.hours}h；每方案 ${args.trials} 次试验；` +
        '队友 = parity 存档且配置冻结；指标口径 = 主角自身）',
    );
    // ① 候选位移榜（全体种子聚合，与逐试验口径独立）：同一候选在单人 / 队伍环境的真实分。
    const movements = [];
    for (const slot of slotContexts) {
      const soloGrand = matrixOf(slot, (suffix) => samplesByKey.get(suffix)).map((samples) =>
        engine.aggregateRoundMetrics(samples),
      );
      const partyGrand = matrixOf(slot, (suffix) => partySamples.get(suffix)).map((samples) =>
        engine.aggregateRoundMetrics(samples),
      );
      slot.candidates.forEach((candidate, index) => {
        const solo = engine.scoreCandidate(soloGrand[index + 1], weights, soloGrand[0]);
        const party = engine.scoreCandidate(partyGrand[index + 1], weights, partyGrand[0]);
        movements.push({ slotIndex: slot.slotIndex, candidate, solo, party, delta: party - solo });
      });
    }
    console.log('  候选位移榜（全体种子聚合：单人分 → 队伍分；|Δ| 最大的 8 条）');
    for (const row of [...movements].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 8)) {
      console.log(
        `    槽 ${row.slotIndex} \`${labelOf(row.candidate)}\`：${fixed(row.solo)} → ${fixed(row.party)}（Δ ${
          row.delta >= 0 ? '+' : ''
        }${fixed(row.delta)}）`,
      );
    }
    // ② 逐试验：单人 winner 在队伍环境的留出真值 + 换人率 + regret。
    const stats = { samples: 0, partyPort: 0, delta: [], deltaVetoed: 0, swap: 0, regret: [], regretVetoed: 0 };
    const partyRng = createSeededRandom(20260931);
    const truthOf = (matrix, index, idx) =>
      engine.scoreCandidate(aggSubset(matrix[index], idx), weights, aggSubset(matrix[0], idx));
    const pairedOf = (matrix, index, idx) =>
      engine.computePairedStats(aggSubset(matrix[index], idx), aggSubset(matrix[0], idx), weights);
    for (const slot of slotContexts) {
      const soloMatrix = matrixOf(slot, (suffix) => samplesByKey.get(suffix));
      const partyMatrix = matrixOf(slot, (suffix) => partySamples.get(suffix));
      const entriesOf = (matrix, idx) => {
        const reference = aggSubset(matrix[0], idx);
        return slot.candidates.map((candidate, index) => {
          const metrics = aggSubset(matrix[index + 1], idx);
          return {
            ...candidate,
            configIndex: index + 1,
            metrics,
            score: engine.scoreCandidate(metrics, weights, reference),
            paired: engine.computePairedStats(metrics, reference, weights),
          };
        });
      };
      for (let trial = 0; trial < args.trials; trial += 1) {
        const perm = shuffle(seedIndices, partyRng);
        const decideIdx = perm.slice(0, args.rounds);
        const holdIdx = perm.slice(args.rounds);
        const soloWinner = [...entriesOf(soloMatrix, decideIdx)].sort(engine.compareCandidates)[0];
        if (!engine.shouldAdoptCandidate(soloWinner)) continue;
        const partyWinner = [...entriesOf(partyMatrix, decideIdx)].sort(engine.compareCandidates)[0];
        const partyTruth = truthOf(partyMatrix, soloWinner.configIndex, holdIdx);
        stats.samples += 1;
        if (
          engine.shouldAdoptCandidate({
            score: partyTruth,
            paired: pairedOf(partyMatrix, soloWinner.configIndex, holdIdx),
          })
        ) {
          stats.partyPort += 1;
        }
        // −∞（空蓝否决）不计入均值：单独计数，由判据 ①「移植率」以「未过闸门」计入。
        const soloTruth = truthOf(soloMatrix, soloWinner.configIndex, holdIdx);
        const partyWinnerTruth = truthOf(partyMatrix, partyWinner.configIndex, holdIdx);
        const deltaValue = partyTruth - soloTruth;
        if (Number.isFinite(deltaValue)) stats.delta.push(deltaValue);
        else stats.deltaVetoed += 1;
        if (partyWinner.signature !== soloWinner.signature) stats.swap += 1;
        const regretValue = partyWinnerTruth - partyTruth;
        if (Number.isFinite(regretValue)) stats.regret.push(regretValue);
        else stats.regretVetoed += 1;
      }
    }
    const delta = deltaStats(stats.delta);
    const regret = deltaStats(stats.regret);
    const partyPortRate = stats.samples ? stats.partyPort / stats.samples : NaN;
    const swapRate = stats.samples ? stats.swap / stats.samples : NaN;
    const tText = (value) => (Number.isFinite(value) ? value.toFixed(2) : '—');
    console.log(`  单人 winner 在队伍环境（样本 n=${stats.samples}）`);
    console.log(
      `    移植率（队伍留出真值仍过采纳闸门）${fmtRate(stats.partyPort, stats.samples)}（${stats.partyPort}/${
        stats.samples
      }）｜meanΔ ${fixed(delta.mean)} ± ${fixed(delta.stdError)}（t = ${tText(delta.t)}；有限样本 ${
        delta.n
      }，−∞ ${stats.deltaVetoed}）`,
    );
    console.log(
      `    换人率（队伍 winner ≠ 单人 winner）${percentText(swapRate)}（${stats.swap}/${
        stats.samples
      }）｜队伍最优 − 单人 winner 的 regret ${fixed(regret.mean)} ± ${fixed(regret.stdError)}（t = ${tText(
        regret.t,
      )}；有限样本 ${regret.n}，−∞ ${stats.regretVetoed}）`,
    );
    const gateA = Number.isFinite(partyPortRate) && partyPortRate < 0.95;
    const gateB = Number.isFinite(delta.t) && Math.abs(delta.t) >= 3;
    const gateC = Number.isFinite(swapRate) && swapRate >= 0.2;
    console.log(
      `判据 D2（预注册）：① 移植率 < 95% ${gateA ? '成立' : '不成立'}｜② |t| ≥ 3 ${gateB ? '成立' : '不成立'}｜` +
        `③ 换人率 ≥ 20% ${gateC ? '成立' : '不成立'} ⇒ ${
          gateA || gateB || gateC
            ? '需要把队伍纳入评估（口径 A 有实质依据）'
            : '队伍感知不改变结论（实施只剩「标注 + 指纹」那一半）'
        }`,
    );
    console.log(
      '判读：① 位移榜 = 队伍环境把哪些候选族变好/变坏（正 = 队伍下更值）；② 移植率/meanΔ = 单人最优的掉分；' +
        '③ 换人率/regret = 该不该在队伍环境下重搜；④ 成本见队伍采样行（与单人总速率同口径参考）。',
    );
  }

  // ── 队伍载荷统计口径对照（2026-09-27，设计 §60 研究；C1）──────────────────────
  // 问题：生产判据链（racing 粗筛 → 精测 → 噪声地板 / 显著性闸门）是在**单人载荷**样本上标定
  // 的；§59 已证明队伍载荷会改变结论与成本，但「判据本身在队伍样本上还按同样的统计规律工作
  // 吗」没有量过。本段用同一批候选、同一组种子（CRN 配对）与同一组 bootstrap 切分，分别回放
  // 两套样本。判定全走生产实现（scoreCandidate / computePairedStats / shouldAdoptCandidate /
  // compareCandidates / pickRacingSurvivors），脚本不另抄阈值。
  // 预注册判据（开跑前写死；冒烟后修正主口径为「共同分类」槽，理由见下）：
  //   C1-a 假采纳率（主口径 = 共同「无提升」槽：采纳 ∧ 选中者留出真值 ≤ 0）：队伍 ≤ 单人 + 2pp；
  //   C1-b 真检出率（主口径 = 共同「有提升」槽：判成立率 = 采纳率）：队伍 ≥ 单人 − 10pp；
  //   ※ 修正记录（冒烟后、正式跑前固定）：两套载荷的槽位分类可能不一致（冒烟实测：槽 2 单人
  //     「无提升」/ 队伍「有提升」），「各自分类」口径的 pooled 比较会混入构成效应（多出的槽改变
  //     分母），与判据链的检出能力无关 ⇒ 主口径改为两套载荷分类一致的槽，各自分类口径降为参考列
  //     （逐槽明细一并打印）。
  //   C1-c 噪声尺度：σ = 逐轮配对差（候选 − 基线，全体种子同索引）的样本标准差，跨候选取中位数；
  //        等效轮数比 = (σ_队伍 / σ_单人)²（达到同样显著性的所需轮数 ∝ σ²）；
  //        判据：等效轮数比 ≤ 1.5 ⇒ 可沿用同一轮数 / 门槛；否则列「队伍需单独轮数 / 门槛」实施项。
  //   槽位分类（每套载荷各自分类）：该槽全体种子聚合真实分的最大值 > MIN_ADOPT_SCORE = 有提升槽。
  //   −∞（空蓝否决）候选不进 σ，单独计数；样本不完整 / 缺失直接断言炸掉。
  //   参考列（不参与裁决）：两套载荷的槽位分类对照、σ 比值、载荷效应（CRN 配对）、winner
  //   报告分 / 真值、成本（场/s）。
  if (args.partyStats) {
    assert(partySamples, '--party-stats=1 需要同时开 --party=parity（本段对照两套 CRN 样本）');
    const MIN_ADOPT = engine.TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE;
    const fixed = (value) => (Number.isFinite(value) ? value.toFixed(5) : '—');
    const percentText = (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—');
    const rateText = (count, total) => (total > 0 ? `${percentText(count / total)}（${count}/${total}）` : '—（0/0）');
    const matrixOf = (get, slot) => {
      const list = [get('baseline')];
      for (const candidate of slot.candidates) list.push(get(`${slot.slotIndex}|${candidate.signature}`));
      for (const samples of list)
        assert.equal(samples?.length, args.seeds, `队伍统计：样本缺失（槽 ${slot.slotIndex}）`);
      return list;
    };
    const loads = [
      { label: '单人载荷', get: (suffix) => samplesByKey.get(suffix) },
      { label: '队伍载荷', get: (suffix) => partySamples.get(suffix) },
    ];
    // CRN：同一组切分（同一次 shuffle 序列）同时用于两套载荷，逐试验索引对齐。
    const statsRng = createSeededRandom(20261001);
    const perms = Array.from({ length: args.trials }, () => shuffle(seedIndices, statsRng));
    const replayLoad = (load, rounds) => {
      const slots = slotContexts.map((slot) => {
        const matrix = matrixOf(load.get, slot);
        const indexOf = new Map(slot.candidates.map((candidate, index) => [candidate.signature, index + 1]));
        const grandAgg = matrix.map((samples) => engine.aggregateRoundMetrics(samples));
        const grandScores = slot.candidates.map((_, index) =>
          engine.scoreCandidate(grandAgg[index + 1], weights, grandAgg[0]),
        );
        const grandBest = Math.max(...grandScores.map((value) => Number(value)));
        const record = {
          slotIndex: slot.slotIndex,
          abilityHrid: slot.abilityHrid,
          improvable: grandBest > MIN_ADOPT,
          grandBest,
          trials: 0,
          adopt: 0,
          falseAdopt: 0,
          claimed: [],
          truth: [],
        };
        for (const perm of perms) {
          const screenIdx = perm.slice(0, SCREEN);
          const decideIdx = perm.slice(SCREEN, SCREEN + rounds);
          const holdIdx = perm.slice(SCREEN + rounds);
          const aggregate = (idx) => matrix.map((samples) => engine.aggregateRoundMetrics(idx.map((i) => samples[i])));
          const screenAgg = aggregate(screenIdx);
          const decideAgg = aggregate(decideIdx);
          const truthAgg = aggregate(holdIdx);
          const makeEntry = (candidate, configIndex, refAgg, aggregated) => ({
            ...candidate,
            metrics: aggregated[configIndex],
            score: engine.scoreCandidate(aggregated[configIndex], weights, refAgg),
            paired: engine.computePairedStats(aggregated[configIndex], refAgg, weights),
          });
          const screenEntries = slot.candidates.map((candidate, index) =>
            makeEntry(candidate, index + 1, screenAgg[0], screenAgg),
          );
          const survivors = engine.pickRacingSurvivors(screenEntries);
          const racingEntries = survivors.map((entry) =>
            makeEntry(entry, indexOf.get(entry.signature), decideAgg[0], decideAgg),
          );
          const winner = [...racingEntries].sort(engine.compareCandidates)[0];
          const winnerIndex = indexOf.get(winner.signature);
          const adopted = engine.shouldAdoptCandidate(winner);
          const truth = engine.scoreCandidate(truthAgg[winnerIndex], weights, truthAgg[0]);
          record.trials += 1;
          if (adopted) record.adopt += 1;
          if (adopted && truth <= 0) record.falseAdopt += 1;
          if (Number.isFinite(Number(winner.score))) record.claimed.push(Number(winner.score));
          if (Number.isFinite(truth)) record.truth.push(truth);
        }
        return record;
      });
      // σ 口径：逐轮配对差（候选 − 基线）的样本标准差（全体种子），跨候选取中位数；−∞ 单独计数。
      const sigmas = [];
      let vetoedCandidates = 0;
      for (const slot of slotContexts) {
        const matrix = matrixOf(load.get, slot);
        for (let index = 0; index < slot.candidates.length; index += 1) {
          const delta = matrix[index + 1].map((sample, round) =>
            engine.scoreCandidate(sample, weights, matrix[0][round]),
          );
          if (!delta.every((value) => Number.isFinite(value))) {
            vetoedCandidates += 1;
            continue;
          }
          const meanDelta = mean(delta);
          const variance =
            delta.length > 1 ? delta.reduce((sum, value) => sum + (value - meanDelta) ** 2, 0) / (delta.length - 1) : 0;
          sigmas.push(Math.sqrt(variance));
        }
      }
      return { slots, sigmas, vetoedCandidates };
    };
    const soloReplay = replayLoad(loads[0], args.rounds);
    const partyReplay = replayLoad(loads[1], args.rounds);
    const pooledAt = (replay, indexFilter) => {
      const list = replay.slots.filter((_, index) => indexFilter(index));
      const trials = list.reduce((sum, slot) => sum + slot.trials, 0);
      const adopt = list.reduce((sum, slot) => sum + slot.adopt, 0);
      const falseAdopt = list.reduce((sum, slot) => sum + slot.falseAdopt, 0);
      return { trials, adopt, falseAdopt };
    };
    // 主口径 =「共同分类」槽（两套载荷分类一致的槽）：两套载荷的槽位分类可能不同（冒烟实测：槽 2
    // 单人「无提升」/ 队伍「有提升」），各自分类口径会让 pooled 比较混入构成效应（多出的槽改变
    // 分母），与判据链的检出能力无关。修正理由记于设计文档 §60（冒烟后、正式跑前固定）。
    const sharedImprov = new Set(
      slotContexts
        .map((_, index) => index)
        .filter((index) => soloReplay.slots[index].improvable && partyReplay.slots[index].improvable),
    );
    const sharedNull = new Set(
      slotContexts
        .map((_, index) => index)
        .filter((index) => !soloReplay.slots[index].improvable && !partyReplay.slots[index].improvable),
    );
    const soloImp = pooledAt(soloReplay, (index) => sharedImprov.has(index));
    const partyImp = pooledAt(partyReplay, (index) => sharedImprov.has(index));
    const soloNull = pooledAt(soloReplay, (index) => sharedNull.has(index));
    const partyNull = pooledAt(partyReplay, (index) => sharedNull.has(index));
    const soloImpRef = pooledAt(soloReplay, (index) => soloReplay.slots[index].improvable);
    const partyImpRef = pooledAt(partyReplay, (index) => partyReplay.slots[index].improvable);
    const soloNullRef = pooledAt(soloReplay, (index) => !soloReplay.slots[index].improvable);
    const partyNullRef = pooledAt(partyReplay, (index) => !partyReplay.slots[index].improvable);
    const soloNullRate = soloNull.trials > 0 ? soloNull.falseAdopt / soloNull.trials : NaN;
    const partyNullRate = partyNull.trials > 0 ? partyNull.falseAdopt / partyNull.trials : NaN;
    const soloDetect = soloImp.trials > 0 ? soloImp.adopt / soloImp.trials : NaN;
    const partyDetect = partyImp.trials > 0 ? partyImp.adopt / partyImp.trials : NaN;
    const sigmaSolo = median(soloReplay.sigmas);
    const sigmaParty = median(partyReplay.sigmas);
    const noiseRatio = sigmaSolo > 0 ? sigmaParty / sigmaSolo : NaN;
    const roundsRatio = Number.isFinite(noiseRatio) ? noiseRatio ** 2 : NaN;
    const gateA =
      Number.isFinite(soloNullRate) && Number.isFinite(partyNullRate) ? partyNullRate <= soloNullRate + 0.02 : null;
    const gateB = Number.isFinite(soloDetect) && Number.isFinite(partyDetect) ? partyDetect >= soloDetect - 0.1 : null;
    const gateC = Number.isFinite(roundsRatio) ? roundsRatio <= 1.5 : null;
    // 参考列：载荷效应 = 同一候选的逐轮增量分在两套载荷下的差（CRN 配对），跨候选汇总。
    const loadEffects = [];
    let loadEffectVetoed = 0;
    for (const slot of slotContexts) {
      const soloMatrix = matrixOf(loads[0].get, slot);
      const partyMatrix = matrixOf(loads[1].get, slot);
      for (let index = 0; index < slot.candidates.length; index += 1) {
        const perRound = [];
        for (let round = 0; round < args.seeds; round += 1) {
          const soloDelta = engine.scoreCandidate(soloMatrix[index + 1][round], weights, soloMatrix[0][round]);
          const partyDelta = engine.scoreCandidate(partyMatrix[index + 1][round], weights, partyMatrix[0][round]);
          const diff = partyDelta - soloDelta;
          if (!Number.isFinite(diff)) {
            perRound.length = 0;
            break;
          }
          perRound.push(diff);
        }
        if (perRound.length > 0) loadEffects.push(mean(perRound));
        else loadEffectVetoed += 1;
      }
    }
    const effectMean = mean(loadEffects);
    const effectVariance =
      loadEffects.length > 1
        ? loadEffects.reduce((sum, value) => sum + (value - effectMean) ** 2, 0) / (loadEffects.length - 1)
        : 0;
    const effectStdError = loadEffects.length > 0 ? Math.sqrt(effectVariance / loadEffects.length) : 0;
    const effectT = effectStdError > 0 ? effectMean / effectStdError : NaN;
    const gateText = (value) => (value === null ? '不可判（某侧无样本）' : value ? '通过' : '不通过');
    console.log('');
    console.log(
      `队伍载荷统计口径对照（§60 / C1；${args.zone} tier ${args.tier} / ${args.hours}h；每方案 ${args.trials} 次试验；` +
        '同一批候选、同一组种子、同一组 bootstrap 切分）',
    );
    console.log('  槽位分类对照与逐槽回放（全体种子聚合真实分 top1 / 生产 racing 链）：');
    for (let index = 0; index < slotContexts.length; index += 1) {
      const solo = soloReplay.slots[index];
      const party = partyReplay.slots[index];
      console.log(`    槽 ${solo.slotIndex}（${solo.abilityHrid}）`);
      console.log(
        `      单人 ${fixed(solo.grandBest)} ${solo.improvable ? '有提升' : '无提升'}：采纳 ${rateText(
          solo.adopt,
          solo.trials,
        )}，假采纳 ${rateText(solo.falseAdopt, solo.trials)}`,
      );
      console.log(
        `      队伍 ${fixed(party.grandBest)} ${party.improvable ? '有提升' : '无提升'}：采纳 ${rateText(
          party.adopt,
          party.trials,
        )}，假采纳 ${rateText(party.falseAdopt, party.trials)}`,
      );
    }
    console.log(
      `  C1-a 假采纳率（主口径：共同「无提升」槽 ${sharedNull.size} 个）：单人 ${rateText(
        soloNull.falseAdopt,
        soloNull.trials,
      )}｜队伍 ${rateText(partyNull.falseAdopt, partyNull.trials)} ⇒ ${gateText(gateA)}（要求队伍 ≤ 单人 + 2pp）`,
    );
    console.log(
      `    参考（各自分类口径）：单人 ${rateText(soloNullRef.falseAdopt, soloNullRef.trials)}｜队伍 ${rateText(
        partyNullRef.falseAdopt,
        partyNullRef.trials,
      )}`,
    );
    console.log(
      `  C1-b 真检出率（主口径：共同「有提升」槽 ${sharedImprov.size} 个）：单人 ${rateText(
        soloImp.adopt,
        soloImp.trials,
      )}｜队伍 ${rateText(partyImp.adopt, partyImp.trials)} ⇒ ${gateText(gateB)}（要求队伍 ≥ 单人 − 10pp）`,
    );
    console.log(
      `    参考（各自分类口径）：单人 ${rateText(soloImpRef.adopt, soloImpRef.trials)}｜队伍 ${rateText(
        partyImpRef.adopt,
        partyImpRef.trials,
      )}`,
    );
    console.log(
      `  C1-c 噪声尺度：σ 中位数 单人 ${fixed(sigmaSolo)}（候选 ${
        soloReplay.sigmas.length
      }，−∞ ${soloReplay.vetoedCandidates}）｜队伍 ${fixed(sigmaParty)}（候选 ${partyReplay.sigmas.length}，−∞ ${
        partyReplay.vetoedCandidates
      }）｜σ 比 ${Number.isFinite(noiseRatio) ? noiseRatio.toFixed(3) : '—'} ⇒ 等效轮数比 ${
        Number.isFinite(roundsRatio) ? roundsRatio.toFixed(3) : '—'
      } ⇒ ${gateText(gateC)}（要求 ≤ 1.5）`,
    );
    console.log(
      `  参考列：载荷效应（同候选逐轮增量分 队伍 − 单人，CRN 配对）mean ${fixed(effectMean)} ± ${fixed(
        effectStdError,
      )}（t = ${Number.isFinite(effectT) ? effectT.toFixed(2) : '—'}；候选 ${loadEffects.length}，−∞ ${loadEffectVetoed}）`,
    );
    console.log(
      `    winner 报告分均值 单人 ${fixed(mean(soloReplay.slots.flatMap((slot) => slot.claimed)))}｜队伍 ${fixed(
        mean(partyReplay.slots.flatMap((slot) => slot.claimed)),
      )}；winner 留出真值均值 单人 ${fixed(mean(soloReplay.slots.flatMap((slot) => slot.truth)))}｜队伍 ${fixed(
        mean(partyReplay.slots.flatMap((slot) => slot.truth)),
      )}`,
    );
    const partyPoolSize = 1 + slotContexts.reduce((sum, slot) => sum + slot.candidates.length, 0);
    console.log(
      `    成本（本装置同 workers）：单人采样 ${(totalSims / elapsedSeconds).toFixed(1)} 场/s（含 §58 等全部段）｜` +
        `队伍采样 ${
          partyElapsedSeconds > 0 ? ((partyPoolSize * args.seeds) / partyElapsedSeconds).toFixed(1) : '—'
        } 场/s（基线 + 槽候选）`,
    );
    console.log(
      `  裁决提示（C1）：C1-a ${gateText(gateA)}｜C1-b ${gateText(gateB)}｜C1-c ${gateText(gateC)} ⇒ ${
        gateA === true && gateB === true && gateC === true
          ? '队伍载荷可沿用单人轮数 / 门槛（生产只需保留载荷标注）'
          : '存在未过 / 不可判项 ⇒ 按预注册口径列「队伍需单独轮数 / 门槛」实施项（不可判项如实标注原因）'
      }`,
    );
    // C1-② 轮数补偿 A/B（--party-stats-rounds）：复用同一批样本与同一组切分，逐值复算不同轮数下的
    // 检出 / 假采纳 —— 回答「队伍载荷下把轮数调高，能不能把真检出率拉回可用区」（§60.5 实施项 2）。
    // 预注册判据（开跑前写死）：
    //   R1（补偿性）：队伍在最大测试轮数 Rmax 的检出率 ≥ 单人 args.rounds 基线检出率 − 10pp
    //      （「恢复到生产默认轮数的水平」）⇒ 加轮数可把检出拉回 ⇒ 轮数上调有实质依据（列实施项）；
    //      不成立 ⇒ 轮数不是解（方向按「报告提示」收口）。
    //   R2（安全性）：各测试轮数下 队伍假采纳率 ≤ 单人（同轮数）+ 2pp。
    //   R3（参考·非判据）：同轮数差距（看差距是随轮数缩小还是平移）+ 单人最大轮数检出。
    //   成本参考：轮数 → 每评估场次（+粗筛 2 场）线性放大（§61 成本模型）。
    if (Array.isArray(args.partyStatsRounds) && args.partyStatsRounds.length > 0) {
      const sweepRequested = [
        ...new Set(args.partyStatsRounds.map(Number).filter((value) => Number.isInteger(value) && value >= 2)),
      ].sort((a, b) => a - b);
      const maxSweepRounds = seeds.length - SCREEN - 2;
      const sweepRounds = sweepRequested.filter((value) => value <= maxSweepRounds);
      if (sweepRounds.length !== sweepRequested.length) {
        console.log(
          `  C1-② 轮数扫描忽略超出种子预算的档位：${sweepRequested
            .filter((value) => value > maxSweepRounds)
            .join(',')}（> ${maxSweepRounds}）`,
        );
      }
      if (sweepRounds.length > 0) {
        const rateOf = (entry, key) => (entry.trials > 0 ? entry[key] / entry.trials : NaN);
        console.log('  C1-② 轮数补偿 A/B（同一批样本、同一组切分，逐值复算）：');
        console.log('    轮数 | 单人检出（共同有提升槽） | 队伍检出 | 单人假采纳 | 队伍假采纳');
        const sweepStats = sweepRounds.map((rounds) => {
          const soloLoad = replayLoad(loads[0], rounds);
          const partyLoad = replayLoad(loads[1], rounds);
          return {
            rounds,
            soloDetect: pooledAt(soloLoad, (index) => sharedImprov.has(index)),
            partyDetect: pooledAt(partyLoad, (index) => sharedImprov.has(index)),
            soloFalse: pooledAt(soloLoad, (index) => sharedNull.has(index)),
            partyFalse: pooledAt(partyLoad, (index) => sharedNull.has(index)),
          };
        });
        for (const stat of sweepStats) {
          console.log(
            `    ${String(stat.rounds).padStart(4)} | ${rateText(
              stat.soloDetect.adopt,
              stat.soloDetect.trials,
            )} | ${rateText(stat.partyDetect.adopt, stat.partyDetect.trials)} | ${rateText(
              stat.soloFalse.falseAdopt,
              stat.soloFalse.trials,
            )} | ${rateText(stat.partyFalse.falseAdopt, stat.partyFalse.trials)}`,
          );
        }
        const maxStat = sweepStats[sweepStats.length - 1];
        const baseStat = sweepStats.find((stat) => stat.rounds === args.rounds) ?? sweepStats[0];
        const soloBaseDetect = rateOf(baseStat.soloDetect, 'adopt');
        const soloMaxDetect = rateOf(maxStat.soloDetect, 'adopt');
        const partyMaxDetect = rateOf(maxStat.partyDetect, 'adopt');
        const gateR1 =
          Number.isFinite(partyMaxDetect) && Number.isFinite(soloBaseDetect)
            ? partyMaxDetect >= soloBaseDetect - 0.1
            : null;
        const falsePairs = sweepStats
          .map((stat) => [rateOf(stat.soloFalse, 'falseAdopt'), rateOf(stat.partyFalse, 'falseAdopt')])
          .filter(([soloRate, partyRate]) => Number.isFinite(soloRate) && Number.isFinite(partyRate));
        const gateR2 =
          falsePairs.length > 0 ? falsePairs.every(([soloRate, partyRate]) => partyRate <= soloRate + 0.02) : null;
        console.log(
          `    R1（补偿性）：队伍 ${maxStat.rounds} 轮检出 ${percentText(partyMaxDetect)} vs 单人 ${baseStat.rounds} 轮基线 ${percentText(
            soloBaseDetect,
          )} − 10pp ⇒ ${gateR1 === null ? '不可判' : gateR1 ? '成立（加轮数可把检出拉回默认水平）' : '不成立（轮数不是解）'}`,
        );
        console.log(
          `    R2（安全性）：各轮数 队伍假采纳 ≤ 单人 + 2pp ⇒ ${
            gateR2 === null ? '不可判（某侧无样本）' : gateR2 ? '成立' : '不成立'
          }｜R3 参考（非判据）：同轮数差距 ${sweepRounds
            .map((rounds, index) => {
              const stat = sweepStats[index];
              const soloRate = rateOf(stat.soloDetect, 'adopt');
              const partyRate = rateOf(stat.partyDetect, 'adopt');
              return Number.isFinite(soloRate) && Number.isFinite(partyRate)
                ? `${rounds}轮 ${((partyRate - soloRate) * 100).toFixed(1)}pp`
                : `${rounds}轮 —`;
            })
            .join(' / ')}；单人 ${maxStat.rounds} 轮检出 ${percentText(soloMaxDetect)}`,
        );
      }
    }
    console.log(
      '判读：① 回放的是**生产 racing 链**（粗筛 2 轮 → top-K ∪ 锚点 → 精测 rounds 轮 → 生产采纳闸门）；' +
        '② 两套载荷共用同一组种子与同一组切分，差值里没有种子噪声；③ σ 是「同一候选跨种子」的取值尺度，' +
        '不是跨候选差异；④ 参考列不参与裁决。',
    );
  }

  // ── 队伍载荷复核链（2026-09-28，设计 §63 研究）：换难度复核（A′）与搜索期复验（首轮 6 轮）──────
  // 问题：§59/§60 量过「判据链（racing → 精测 → 采纳闸门）在队伍载荷下的检出 / 假采纳」，但**检查
  // 链**在队伍载荷下的行为没有量过（§59.6 / §60.4 的同一遗留）：用户点「复核」（换难度稳健性复核，
  // §29/§49）会不会虚报？搜索期「独立复验」（§21/§31/§47）会不会否决真提升？
  // 本段只读量化（零产品改动）：复核臂 = 生产 robustness 盐 × 相邻难度的**新样本**（队伍载荷单独
  // 采样趟，与单人同种子 CRN）；复验臂复用现有搜索期两套样本。判定全走生产实现（computePairedStats /
  // planTriggerOptimizerRobustnessRounds / resolveTriggerOptimizerVerificationRounds），不抄判据。
  // 复核臂（A′，生产现状）：先验 = 搜索难度样本切 ROBUST_BASE 轮反解（plan 缺省 / capped ⇒ 保底
  // ROBUST_BASE，口径同 §49），判据 = 目标难度样本逐试验换 perm 切 plannedRounds 轮；两套载荷共用
  // 同一组 perm（CRN 配对）。
  // 复验臂：候选 vs 基线在搜索难度样本上切 VERIFY_BASE 轮配对重判（首轮 = 报告口径）；首轮
  // inconclusive 时按 §47 A′ 追加参考（resolveTriggerOptimizerVerificationRounds，保底 VERIFY_BASE
  // × 2、封顶 VERIFY_CAP；**不叠加 §50 累计护栏** ⇒ 追加列只作参考，堆叠形态见 §50）。
  // 预注册判据（开跑前写死；主口径 =「共同分类」候选：两套载荷的目标难度真值分类一致者 —— 各自
  // 分类的 pooled 比较会混入构成效应，理由与 §60 的主口径修正同源；各自分类降为参考列）：
  //   A1（硬·复核不虚报）：队伍 null 桶「复核判成立」≤ 单人 + 2pp（容差同 C1-a）；
  //   A2（补偿·复核功率）：队伍 real 桶「复核判成立」≥ 单人 − 10pp（容差同 C1-b）；
  //   B1（硬·复验不虚报）：队伍 null 桶「首轮复验判成立」≤ 单人 + 2pp；
  //   B2（补偿·复验不否决）：队伍 real 桶「首轮复验判成立」≥ 单人 − 10pp。
  //   参考列（非判据）：判负 / 未决分布、期望轮数/侧、复核 F（保底 6 轮）对照、复验追加后成立率。
  //   全过 ⇒ 记档「检查链可沿用单人护栏（零成本）」；A1 / B1 不过 ⇒ 列「报告提示」实施项；A2 / B2
  //   不过 ⇒ 列「队伍需单独轮数」实施项。样本缺失断言炸掉；相邻难度解析不出（顶档）跳过本段。
  if (args.partyChecks) {
    assert(partySamples, '--party-checks=1 需要同时开 --party=parity（本段对照两套载荷样本）');
    if (robustTier == null) {
      console.log('');
      console.log('队伍载荷复核链：本区域解析不出相邻难度（顶档/未知）⇒ 跳过（与 §49/§51 同款）。');
    } else {
      assert(partyRobustSamples, '--party-checks=1：队伍复核样本缺失（采样趟未跑？）');
      const MIN_ADOPT = engine.TRIGGER_OPTIMIZER_MIN_ADOPT_SCORE;
      const ROBUST_BASE = engine.TRIGGER_OPTIMIZER_ROBUSTNESS_ROUNDS;
      const ROBUST_CAP = engine.TRIGGER_OPTIMIZER_ROBUSTNESS_MAX_ROUNDS;
      const VERIFY_BASE = engine.TRIGGER_OPTIMIZER_VERIFY_ROUNDS;
      const VERIFY_CAP = engine.TRIGGER_OPTIMIZER_VERIFY_MAX_ROUNDS;
      const VERIFY_APPEND_BASE = VERIFY_BASE * 2;
      assert(
        args.seeds >= ROBUST_CAP + ROBUST_BASE,
        `--party-checks：--seeds 至少 ${ROBUST_CAP + ROBUST_BASE}（先验 ${ROBUST_BASE} + 判据最坏 ${ROBUST_CAP} 的互斥切分）`,
      );
      assert(args.seeds >= VERIFY_CAP, `--party-checks：--seeds 至少 ${VERIFY_CAP}（复验追加参考臂最坏切分）`);
      const percentText = (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—');
      const rateText = (count, total) =>
        total > 0 ? `${percentText(count / total)}（${count}/${total}）` : '—（0/0）';
      const keyOf = (slot, candidate) => (candidate ? `${slot.slotIndex}|${candidate.signature}` : 'baseline');
      const families = [
        {
          label: '单人',
          searchGet: (key) => samplesByKey.get(key),
          robustGet: (key) => samplesByKey.get(`robust|${key}`),
        },
        {
          label: '队伍',
          searchGet: (key) => partySamples.get(key),
          robustGet: (key) => partyRobustSamples.get(`robust|${key}`),
        },
      ];
      const matrixOf = (get, slot) => {
        const list = [get(keyOf(slot, null))];
        for (const candidate of slot.candidates) list.push(get(keyOf(slot, candidate)));
        for (const samples of list)
          assert.equal(samples?.length, args.seeds, `复核链：样本缺失（槽 ${slot.slotIndex}）`);
        return list;
      };
      const aggregateIndices = (samples, indices) =>
        engine.aggregateRoundMetrics(indices.map((index) => samples[index]));
      const pairedOf = (matrix, configIndex, indices) =>
        engine.computePairedStats(
          aggregateIndices(matrix[configIndex], indices),
          aggregateIndices(matrix[0], indices),
          weights,
        )?.score ?? null;
      const verdictOf = (matrix, configIndex, indices) =>
        String(pairedOf(matrix, configIndex, indices)?.verdict ?? 'unknown');
      const kindOf = (score) => (score > MIN_ADOPT ? 'real' : score <= 0 ? 'null' : null);
      const truthOf = (matrix, candidates) => {
        const reference = engine.aggregateRoundMetrics(matrix[0]);
        return candidates.map((_, index) =>
          engine.scoreCandidate(engine.aggregateRoundMetrics(matrix[index + 1]), weights, reference),
        );
      };
      const checkRng = createSeededRandom(20260928);
      const robustTrials = Array.from({ length: args.trials }, () => ({
        prior: shuffle(seedIndices, checkRng),
        verdict: shuffle(seedIndices, checkRng),
      }));
      const verifyTrials = Array.from({ length: args.trials }, () => shuffle(seedIndices, checkRng));
      const sumRows = (rows, filter, pick) => rows.filter(filter).reduce((total, row) => total + pick(row.stats), 0);
      // ── 复核臂（换难度 A′）──
      const newRobustStats = () => ({
        trials: 0,
        positive: 0,
        negative: 0,
        inconclusive: 0,
        rounds: 0,
        fPositive: 0,
        planned: 0,
        capped: 0,
        base: 0,
        required: 0,
      });
      const robustRows = families.map((family) => {
        const rows = [];
        for (const slot of slotContexts) {
          const searchMatrix = matrixOf(family.searchGet, slot);
          const targetMatrix = matrixOf(family.robustGet, slot);
          const targetTruth = truthOf(targetMatrix, slot.candidates);
          slot.candidates.forEach((candidate, index) => {
            const configIndex = index + 1;
            const stats = newRobustStats();
            for (const trial of robustTrials) {
              const prior = pairedOf(searchMatrix, configIndex, trial.prior.slice(0, ROBUST_BASE));
              const plan = engine.planTriggerOptimizerRobustnessRounds(prior, { maxRounds: ROBUST_CAP });
              if (plan) {
                stats.planned += 1;
                if (plan.capped) stats.capped += 1;
                else stats.required += plan.requiredRounds;
              } else {
                stats.base += 1;
              }
              const plannedRounds = plan
                ? Math.min(ROBUST_CAP, Math.max(ROBUST_BASE, plan.plannedRounds))
                : ROBUST_BASE;
              const verdict = verdictOf(targetMatrix, configIndex, trial.verdict.slice(0, plannedRounds));
              const fVerdict =
                plannedRounds === ROBUST_BASE
                  ? verdict
                  : verdictOf(targetMatrix, configIndex, trial.verdict.slice(0, ROBUST_BASE));
              stats.trials += 1;
              stats.rounds += plannedRounds;
              if (verdict === 'positive') stats.positive += 1;
              else if (verdict === 'negative') stats.negative += 1;
              else if (verdict === 'inconclusive') stats.inconclusive += 1;
              if (fVerdict === 'positive') stats.fPositive += 1;
            }
            rows.push({
              key: `${slot.slotIndex}|${candidate.signature}`,
              kind: kindOf(targetTruth[index]),
              truth: targetTruth[index],
              stats,
            });
          });
        }
        return rows;
      });
      // ── 复验臂（搜索期首轮 6 轮；追加 = §47 A′ 参考）──
      const newVerifyStats = () => ({
        trials: 0,
        firstPositive: 0,
        firstNegative: 0,
        firstInconclusive: 0,
        finalPositive: 0,
        finalNegative: 0,
        finalInconclusive: 0,
        rounds: 0,
        extended: 0,
      });
      const verifyRows = families.map((family) => {
        const rows = [];
        for (const slot of slotContexts) {
          const matrix = matrixOf(family.searchGet, slot);
          const truth = truthOf(matrix, slot.candidates);
          slot.candidates.forEach((candidate, index) => {
            const configIndex = index + 1;
            const stats = newVerifyStats();
            for (const perm of verifyTrials) {
              const firstValue = pairedOf(matrix, configIndex, perm.slice(0, VERIFY_BASE));
              const firstVerdict = String(firstValue?.verdict ?? 'unknown');
              let total = VERIFY_BASE;
              if (firstVerdict === 'inconclusive') {
                const plan = engine.resolveTriggerOptimizerVerificationRounds(firstValue, VERIFY_CAP);
                total = Math.min(VERIFY_CAP, Math.max(plan?.requiredRounds ?? VERIFY_CAP, VERIFY_APPEND_BASE));
              }
              const finalVerdict =
                total === VERIFY_BASE ? firstVerdict : verdictOf(matrix, configIndex, perm.slice(0, total));
              stats.trials += 1;
              stats.rounds += total;
              if (total > VERIFY_BASE) stats.extended += 1;
              if (firstVerdict === 'positive') stats.firstPositive += 1;
              else if (firstVerdict === 'negative') stats.firstNegative += 1;
              else if (firstVerdict === 'inconclusive') stats.firstInconclusive += 1;
              if (finalVerdict === 'positive') stats.finalPositive += 1;
              else if (finalVerdict === 'negative') stats.finalNegative += 1;
              else if (finalVerdict === 'inconclusive') stats.finalInconclusive += 1;
            }
            rows.push({
              key: `${slot.slotIndex}|${candidate.signature}`,
              kind: kindOf(truth[index]),
              truth: truth[index],
              stats,
            });
          });
        }
        return rows;
      });
      // 共同分类（主口径）与分类对照：两套载荷目标难度真值分类一致的候选才进主口径。
      const matchKeys = (rowsA, rowsB, kind) => {
        const kinds = new Map(rowsB.map((row) => [row.key, row.kind]));
        return new Set(rowsA.filter((row) => row.kind === kind && kinds.get(row.key) === kind).map((row) => row.key));
      };
      const inKeys = (keys) => (row) => keys.has(row.key);
      const soloRobust = robustRows[0];
      const partyRobust = robustRows[1];
      const soloVerify = verifyRows[0];
      const partyVerify = verifyRows[1];
      const robustRealKeys = matchKeys(soloRobust, partyRobust, 'real');
      const robustNullKeys = matchKeys(soloRobust, partyRobust, 'null');
      const verifyRealKeys = matchKeys(soloVerify, partyVerify, 'real');
      const verifyNullKeys = matchKeys(soloVerify, partyVerify, 'null');
      const robustPooled = (rows, filter) => ({
        cases: rows.filter(filter).length,
        trials: sumRows(rows, filter, (s) => s.trials),
        positive: sumRows(rows, filter, (s) => s.positive),
        negative: sumRows(rows, filter, (s) => s.negative),
        inconclusive: sumRows(rows, filter, (s) => s.inconclusive),
        rounds: sumRows(rows, filter, (s) => s.rounds),
        fPositive: sumRows(rows, filter, (s) => s.fPositive),
        planned: sumRows(rows, filter, (s) => s.planned),
        capped: sumRows(rows, filter, (s) => s.capped),
        base: sumRows(rows, filter, (s) => s.base),
        required: sumRows(rows, filter, (s) => s.required),
      });
      const verifyPooled = (rows, filter) => ({
        cases: rows.filter(filter).length,
        trials: sumRows(rows, filter, (s) => s.trials),
        firstPositive: sumRows(rows, filter, (s) => s.firstPositive),
        firstNegative: sumRows(rows, filter, (s) => s.firstNegative),
        firstInconclusive: sumRows(rows, filter, (s) => s.firstInconclusive),
        finalPositive: sumRows(rows, filter, (s) => s.finalPositive),
        finalNegative: sumRows(rows, filter, (s) => s.finalNegative),
        finalInconclusive: sumRows(rows, filter, (s) => s.finalInconclusive),
        rounds: sumRows(rows, filter, (s) => s.rounds),
        extended: sumRows(rows, filter, (s) => s.extended),
      });
      const aSoloReal = robustPooled(soloRobust, inKeys(robustRealKeys));
      const aPartyReal = robustPooled(partyRobust, inKeys(robustRealKeys));
      const aSoloNull = robustPooled(soloRobust, inKeys(robustNullKeys));
      const aPartyNull = robustPooled(partyRobust, inKeys(robustNullKeys));
      const bSoloReal = verifyPooled(soloVerify, inKeys(verifyRealKeys));
      const bPartyReal = verifyPooled(partyVerify, inKeys(verifyRealKeys));
      const bSoloNull = verifyPooled(soloVerify, inKeys(verifyNullKeys));
      const bPartyNull = verifyPooled(partyVerify, inKeys(verifyNullKeys));
      const rateOfPool = (pool, pick) => (pool.trials > 0 ? pick(pool) / pool.trials : NaN);
      const aSoloFalse = rateOfPool(aSoloNull, (pool) => pool.positive);
      const aPartyFalse = rateOfPool(aPartyNull, (pool) => pool.positive);
      const aSoloPower = rateOfPool(aSoloReal, (pool) => pool.positive);
      const aPartyPower = rateOfPool(aPartyReal, (pool) => pool.positive);
      const bSoloFalse = rateOfPool(bSoloNull, (pool) => pool.firstPositive);
      const bPartyFalse = rateOfPool(bPartyNull, (pool) => pool.firstPositive);
      const bSoloPower = rateOfPool(bSoloReal, (pool) => pool.firstPositive);
      const bPartyPower = rateOfPool(bPartyReal, (pool) => pool.firstPositive);
      const gateA1 =
        Number.isFinite(aSoloFalse) && Number.isFinite(aPartyFalse) ? aPartyFalse <= aSoloFalse + 0.02 : null;
      const gateA2 =
        Number.isFinite(aSoloPower) && Number.isFinite(aPartyPower) ? aPartyPower >= aSoloPower - 0.1 : null;
      const gateB1 =
        Number.isFinite(bSoloFalse) && Number.isFinite(bPartyFalse) ? bPartyFalse <= bSoloFalse + 0.02 : null;
      const gateB2 =
        Number.isFinite(bSoloPower) && Number.isFinite(bPartyPower) ? bPartyPower >= bSoloPower - 0.1 : null;
      const gateText = (value) => (value === null ? '不可判' : value ? '成立' : '不成立');
      const perSide = (rounds, trials) => (trials > 0 ? (rounds / trials).toFixed(2) : '—');
      console.log('');
      console.log(
        `队伍载荷复核链（设计 §63；复核 = 换难度 A′ → 目标 tier ${robustTier}；复验 = 搜索期首轮 ${VERIFY_BASE} 轮；每案例 ${args.trials} 次试验；主口径 = 共同分类）`,
      );
      console.log('复核臂（共同分类主口径；F 6 轮 = 固定保底对照，非裁决）：');
      for (const [index, family] of families.entries()) {
        const real = index === 0 ? aSoloReal : aPartyReal;
        const nul = index === 0 ? aSoloNull : aPartyNull;
        console.log(
          `  ${family.label}｜真提升 判成立 ${rateText(real.positive, real.trials)}（判负 ${rateText(
            real.negative,
            real.trials,
          )}｜未决 ${rateText(real.inconclusive, real.trials)}）｜轮数/侧 ${perSide(real.rounds, real.trials)}｜null 判成立 ${rateText(
            nul.positive,
            nul.trials,
          )}｜轮数/侧 ${perSide(nul.rounds, nul.trials)}｜F 6 轮 ${rateText(real.fPositive, real.trials)} / ${rateText(
            nul.fPositive,
            nul.trials,
          )}`,
        );
      }
      console.log('复验臂（共同分类主口径；追加 = §47 A′ 参考，未叠加 §50 累计护栏）：');
      for (const [index, family] of families.entries()) {
        const real = index === 0 ? bSoloReal : bPartyReal;
        const nul = index === 0 ? bSoloNull : bPartyNull;
        console.log(
          `  ${family.label}｜真提升 首轮成立 ${rateText(real.firstPositive, real.trials)}（判负 ${rateText(
            real.firstNegative,
            real.trials,
          )}｜未决 ${rateText(real.firstInconclusive, real.trials)}）｜追加后成立 ${rateText(
            real.finalPositive,
            real.trials,
          )}｜轮数/侧 ${perSide(real.rounds, real.trials)}｜null 首轮成立 ${rateText(
            nul.firstPositive,
            nul.trials,
          )}｜追加后成立 ${rateText(nul.finalPositive, nul.trials)}`,
        );
      }
      console.log(
        `  共同分类候选：复核 real ${robustRealKeys.size} / null ${robustNullKeys.size}；复验 real ${verifyRealKeys.size} / null ${verifyNullKeys.size}（分母 = 案例数 × ${args.trials} 次试验）`,
      );
      for (const [index, family] of families.entries()) {
        const rows = index === 0 ? soloRobust : partyRobust;
        const planned = sumRows(
          rows,
          () => true,
          (s) => s.planned,
        );
        const capped = sumRows(
          rows,
          () => true,
          (s) => s.capped,
        );
        const base = sumRows(
          rows,
          () => true,
          (s) => s.base,
        );
        const required = sumRows(
          rows,
          () => true,
          (s) => s.required,
        );
        const resolvable = planned - capped;
        console.log(
          `  ${family.label}复核反解：有计划 ${planned} 次（上限也不够 ${capped}）｜可反解平均要 ${
            resolvable > 0 ? (required / resolvable).toFixed(1) : '—'
          } 轮｜先验退化 ${base} 次`,
        );
      }
      console.log('  分类对照（目标难度真值：real / null / 介于门槛之间）：');
      for (const slot of slotContexts) {
        const countsOf = (rows) => {
          const list = rows.filter((row) => row.key.startsWith(`${slot.slotIndex}|`));
          const count = (kind) => list.filter((row) => row.kind === kind).length;
          return `${count('real')} / ${count('null')} / ${count(null)}`;
        };
        console.log(`    槽 ${slot.slotIndex}：单人 ${countsOf(soloRobust)}｜队伍 ${countsOf(partyRobust)}`);
      }
      const selfPool = (rows, kind) => robustPooled(rows, (row) => row.kind === kind);
      const selfVerifyPool = (rows, kind) => verifyPooled(rows, (row) => row.kind === kind);
      const selfRate = (pool, pick) => percentText(rateOfPool(pool, pick));
      console.log(
        `  参考（各自分类，不参与裁决）：复核 单人 real ${selfRate(selfPool(soloRobust, 'real'), (pool) => pool.positive)} / null ${selfRate(
          selfPool(soloRobust, 'null'),
          (pool) => pool.positive,
        )}｜队伍 real ${selfRate(selfPool(partyRobust, 'real'), (pool) => pool.positive)} / null ${selfRate(
          selfPool(partyRobust, 'null'),
          (pool) => pool.positive,
        )}`,
      );
      console.log(
        `  参考（各自分类）：复验 单人 real ${selfRate(selfVerifyPool(soloVerify, 'real'), (pool) => pool.firstPositive)} / null ${selfRate(
          selfVerifyPool(soloVerify, 'null'),
          (pool) => pool.firstPositive,
        )}｜队伍 real ${selfRate(selfVerifyPool(partyVerify, 'real'), (pool) => pool.firstPositive)} / null ${selfRate(
          selfVerifyPool(partyVerify, 'null'),
          (pool) => pool.firstPositive,
        )}`,
      );
      console.log(
        `  复核判据：A1 不虚报（队伍 ${percentText(aPartyFalse)} ≤ 单人 ${percentText(aSoloFalse)} + 2pp）⇒ ${gateText(
          gateA1,
        )}｜A2 功率（队伍 ${percentText(aPartyPower)} ≥ 单人 ${percentText(aSoloPower)} − 10pp）⇒ ${gateText(gateA2)}`,
      );
      console.log(
        `  复验判据：B1 不虚报（队伍 ${percentText(bPartyFalse)} ≤ 单人 ${percentText(bSoloFalse)} + 2pp）⇒ ${gateText(
          gateB1,
        )}｜B2 不否决（队伍 ${percentText(bPartyPower)} ≥ 单人 ${percentText(bSoloPower)} − 10pp）⇒ ${gateText(gateB2)}`,
      );
      console.log(
        `判读（预注册）：${
          [gateA1, gateA2, gateB1, gateB2].every((gate) => gate === true)
            ? '检查链在队伍载荷下可沿用单人护栏（记档；零成本、无提示）'
            : '存在不过 / 不可判项 ⇒ 按「虚报 ⇒ 报告提示 / 功率 ⇒ 队伍单独轮数」列实施项（不可判项如实标注）'
        }`,
      );
      console.log(
        '口径说明：主口径 = 两套载荷目标难度真值分类一致的候选（real / null 两桶），共同分类见上；F 6 轮列 = 固定保底对照；复验追加列不含 §50 累计护栏（参考）。',
      );
      // ── §63-② 复核轮数补偿（补充判据 S1，纯回放；--party-checks-rounds）──────────────────
      // 问题：主口径 A2 若不过（队伍复核功率低于单人），是「轮数不够」还是「结构性」？
      // 做法：对**共同分类**的候选按固定档位 n 逐值复算判成立率（同一批 perm 前缀、零新采样；
      // 判据口径与生产逐轮 verdict 同一把尺子 = summarizeSamples 的 p<0.05 显著）。
      // 预注册补充判据（开跑前写死）：
      //   S1（轮数可解性）：存在请求档位 n（≤ --seeds）使 队伍 real 桶判成立率 ≥ **同档位单人** − 10pp
      //      ⇒ 轮数可解（列实施项：队伍复核轮数 / 上限上调；成本 = 2 × n 场/次复核）；
      //      最大请求档仍不满足 ⇒ 轮数不是解（结构性：效应贴门槛）⇒ 收口为「报告措辞 / 接受未决」。
      //   安全参考（非判据）：最大档 null 桶假阳性（应 ≈ 0）、共享 real 候选明细、复验 real 归类。
      const sweepRounds = Array.isArray(args.partyChecksRounds)
        ? [...new Set(args.partyChecksRounds.map(Number).filter((value) => Number.isInteger(value) && value >= 2))]
            .filter((value) => value <= args.seeds)
            .sort((a, b) => a - b)
        : [];
      if (sweepRounds.length > 0) {
        const fixed = (value) => (Number.isFinite(value) ? value.toFixed(5) : '—');
        const locate = new Map();
        for (const slot of slotContexts) {
          slot.candidates.forEach((candidate, index) =>
            locate.set(`${slot.slotIndex}|${candidate.signature}`, { slot, configIndex: index + 1 }),
          );
        }
        const sweepRateAt = (family, keys, rounds) => {
          const matrices = new Map();
          let trials = 0;
          let positive = 0;
          for (const trial of robustTrials) {
            for (const key of keys) {
              const { slot, configIndex } = locate.get(key);
              if (!matrices.has(slot.slotIndex)) matrices.set(slot.slotIndex, matrixOf(family.robustGet, slot));
              trials += 1;
              if (verdictOf(matrices.get(slot.slotIndex), configIndex, trial.verdict.slice(0, rounds)) === 'positive') {
                positive += 1;
              }
            }
          }
          return { trials, positive };
        };
        console.log('');
        console.log(
          `复核轮数补偿（§63-②；共同分类 real 桶 = ${robustRealKeys.size} 个候选；同一批 perm 逐值复算；对照 = 同档位单人）：`,
        );
        const sweepRows = sweepRounds.map((rounds) => ({
          rounds,
          solo: sweepRateAt(families[0], robustRealKeys, rounds),
          party: sweepRateAt(families[1], robustRealKeys, rounds),
        }));
        for (const row of sweepRows) {
          console.log(
            `  ${String(row.rounds).padStart(3)} 轮｜单人 ${rateText(row.solo.positive, row.solo.trials)}｜队伍 ${rateText(
              row.party.positive,
              row.party.trials,
            )}`,
          );
        }
        const qualifying = sweepRows
          .filter(
            (row) =>
              row.solo.trials > 0 &&
              row.party.trials > 0 &&
              row.party.positive / row.party.trials >= row.solo.positive / row.solo.trials - 0.1,
          )
          .map((row) => row.rounds);
        console.log(
          `  S1（轮数可解性）：${
            qualifying.length > 0
              ? `成立（达标档 ${qualifying.join(' / ')} 轮）⇒ 可列「队伍单独轮数」实施项（成本 = 2 × n 场/次复核）`
              : `不成立（最大档 ${sweepRounds[sweepRounds.length - 1]} 轮仍差 > 10pp）⇒ 轮数不是解（结构性）：收口为「报告措辞 / 接受未决」`
          }`,
        );
        const maxSweep = sweepRounds[sweepRounds.length - 1];
        const nullSafety = families.map((family) => sweepRateAt(family, robustNullKeys, maxSweep));
        console.log(
          `  null 桶安全参考（最大档 ${maxSweep} 轮）：单人 ${rateText(
            nullSafety[0].positive,
            nullSafety[0].trials,
          )}｜队伍 ${rateText(nullSafety[1].positive, nullSafety[1].trials)}`,
        );
        console.log('  共享 real 候选明细（复核臂；目标难度真值）：');
        for (const key of robustRealKeys) {
          const soloRow = soloRobust.find((row) => row.key === key);
          const partyRow = partyRobust.find((row) => row.key === key);
          const { slot } = locate.get(key);
          console.log(
            `    槽 ${slot.slotIndex} ${key.slice(key.indexOf('|') + 1)}：真值 单人 ${fixed(soloRow?.truth)}｜队伍 ${fixed(
              partyRow?.truth,
            )}；现状 A′ 判成立 单人 ${rateText(soloRow?.stats.positive, soloRow?.stats.trials)}｜队伍 ${rateText(
              partyRow?.stats.positive,
              partyRow?.stats.trials,
            )}`,
          );
        }
        console.log('  复验 real 归类参考（搜索难度真值；交集为空 = 两套载荷的 real 候选不是同一批）：');
        for (const [index, family] of families.entries()) {
          const familyRows = index === 0 ? soloVerify : partyVerify;
          const realRows = familyRows.filter((row) => row.kind === 'real');
          console.log(
            `    ${family.label}：${
              realRows.length === 0
                ? '无 real 候选'
                : realRows.map((row) => `${row.key.slice(row.key.indexOf('|') + 1)}（${fixed(row.truth)}）`).join('、')
            }`,
          );
        }
      }
    }
  }

  // ── 跨运行样本复用量化（2026-09-27，设计 §62 研究；S4）──────────────────────────
  // 问题：种子键刻意排除 triggerMap（triggerOptimizerDomain.js 的 createTriggerOptimizerSeedSet）⇒
  // 「同一 payload + 同一组种子」跨运行逐值可复现（§51 恒等自证 / §59·§60 复现）。那么同一用户工作流的
  // **下一次搜索**有多少评估能直接复用上一次的样本？本段只读结构化测量（不额外跑仿真）：
  //   S0 同输入重跑（自证）：应 100%（含只改权重等不进 payload 的设置）；
  //   S1 应用「单槽 winner」后重跑（winner = 该槽全体种子聚合真实分 top1，逐槽各算一遍）；
  //   S2 应用「全部槽 winner」后重跑（= 用户点一次「应用」把全部 winner 一起换上的形态）。
  // 复用口径：评估 = 1 配置 × args.seeds 场；可复用 ⟺ payload 逐字节相同（stableStringify）且种子序列
  // 逐值相同（种子键不含 triggerMap，本段用断言自证）。
  // 预注册判据（开跑前写死）：
  //   P1（自证）：run2 种子序列与 run1 逐值相同；S1/S2 的 run2 基线评估必须落在 run1 目标集内
  //               （winner 的 payload 曾被评估过）；S0 复用率恒 100%（构造口径自证）。
  //   P2（主·可复用率）：R1 = S1 三个单槽场景的复用率均值（唯一 payload 键口径）：
  //        R1 ≥ 40% ⇒ 值得实施持久样本缓存（须把价表行情与引擎版本纳入缓存键 —— C2 教训）；
  //        20% ≤ R1 < 40% ⇒ 条件候选（只在「迭代重跑」占比足够高时值得，给频率阈值供拍板）；
  //        R1 < 20% ⇒ 不实施（收益不足以摊薄持久缓存工程）。
  //   参考列：按槽明细（基线 / 变更槽 / 其它槽）、S2 复用率、每评估样本体量与单轮缓存体量估算。
  if (args.reuseStudy) {
    const percentText = (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—');
    const payloadKeyOf = (payload) => stableStringify(payload);
    const keySetOf = (payloads) => new Set(payloads.map((payload) => payloadKeyOf(payload)));
    const seedsOf = (config) =>
      engine.createTriggerOptimizerSeedSet({
        playerId: preferredPlayerId,
        playerConfig: config,
        simulationSettings,
        salt: 'trigger-optimizer.racing-study.v1',
        count: args.seeds,
      });
    const buildRunPayloads = (baseConfig) => {
      const basePayload = engine.buildCandidatePayload(baseConfig, simulationSettings, undefined, null);
      const runResources = engine.resolveOptimizerResources(basePayload, preferredPlayerId);
      assert(runResources, 'S4：新基线 resolveOptimizerResources 失败');
      const runChoices = engine.buildCandidateConfigs(baseConfig, { ...settings, resources: runResources });
      const payloads = [basePayload];
      const bySlot = new Map();
      for (const slot of slotContexts) {
        const choice = runChoices.find((entry) => entry.slotIndex === slot.slotIndex);
        assert(choice, `S4：槽位 ${slot.slotIndex} 在新基线上没有候选生成结果`);
        const slotPayloads = choice.candidates.map((candidate) =>
          engine.buildCandidatePayload(baseConfig, simulationSettings, undefined, candidate),
        );
        bySlot.set(slot.slotIndex, slotPayloads);
        payloads.push(...slotPayloads);
      }
      return { baseKey: payloadKeyOf(basePayload), keys: keySetOf(payloads), bySlot };
    };
    // winner = 该槽全体种子聚合真实分 top1（与 §58/§59 的「真最优」同口径）。
    const winnerOf = (slot) => {
      const matrix = [samplesByKey.get('baseline')];
      for (const candidate of slot.candidates) {
        matrix.push(samplesByKey.get(`${slot.slotIndex}|${candidate.signature}`));
      }
      for (const samples of matrix) assert.ok(samples, `S4：样本缺失（槽 ${slot.slotIndex}）`);
      const grandAgg = matrix.map((samples) => engine.aggregateRoundMetrics(samples));
      const scores = slot.candidates.map((_, index) =>
        Number(engine.scoreCandidate(grandAgg[index + 1], weights, grandAgg[0])),
      );
      let bestIndex = 0;
      for (let index = 1; index < scores.length; index += 1) {
        if (scores[index] > scores[bestIndex]) bestIndex = index;
      }
      return { candidate: slot.candidates[bestIndex], score: scores[bestIndex] };
    };
    const withWinners = (winners) => {
      let config = JSON.parse(JSON.stringify(playerConfig));
      for (const winner of winners) config = engine.applyCandidateToPlayerConfig(config, winner.candidate);
      return config;
    };
    const run1 = buildRunPayloads(playerConfig);
    assert.deepEqual(seedsOf(playerConfig), seeds, 'S4：run1 种子序列与采样种子漂移（种子键口径变化？）');
    const scenario = (label, winners, changedSlots) => {
      const nextConfig = withWinners(winners);
      assert.deepEqual(seedsOf(nextConfig), seeds, `S4：${label} 的 run2 种子序列与 run1 不一致`);
      const run2 = buildRunPayloads(nextConfig);
      let reused = 0;
      for (const key of run2.keys) if (run1.keys.has(key)) reused += 1;
      const detail = [...run2.bySlot.entries()].map(([slotIndex, payloads]) => {
        const keys = keySetOf(payloads);
        let slotReused = 0;
        for (const key of keys) if (run1.keys.has(key)) slotReused += 1;
        return { slotIndex, changed: changedSlots.has(slotIndex), reused: slotReused, total: keys.size };
      });
      return {
        label,
        total: run2.keys.size,
        reused,
        rate: run2.keys.size > 0 ? reused / run2.keys.size : NaN,
        baselineReused: run1.keys.has(run2.baseKey),
        detail,
      };
    };
    const winnersBySlot = new Map(slotContexts.map((slot) => [slot.slotIndex, winnerOf(slot)]));
    const singleScenarios = slotContexts.map((slot) =>
      scenario(`S1 槽 ${slot.slotIndex}`, [winnersBySlot.get(slot.slotIndex)], new Set([slot.slotIndex])),
    );
    const allScenario = scenario(
      'S2 全部槽',
      [...winnersBySlot.values()],
      new Set(slotContexts.map((slot) => slot.slotIndex)),
    );
    const finiteRates = singleScenarios.map((entry) => entry.rate).filter((value) => Number.isFinite(value));
    const meanSingleRate = finiteRates.length > 0 ? mean(finiteRates) : NaN;
    const gateP2 = Number.isFinite(meanSingleRate)
      ? meanSingleRate >= 0.4
        ? 'high'
        : meanSingleRate >= 0.2
          ? 'mid'
          : 'low'
      : null;
    const sampleBytes = (() => {
      const sample = samplesByKey.get('baseline');
      return Array.isArray(sample) && sample.length > 0 ? JSON.stringify(sample).length : 0;
    })();
    const poolSize = run1.keys.size;
    console.log('');
    console.log(
      `跨运行样本复用量化（§62 / S4；${args.zone} tier ${args.tier} / ${args.hours}h；评估 = 1 配置 × ${args.seeds} 场；` +
        '可复用 = payload 逐字节相同且种子序列逐值相同）',
    );
    console.log(
      `  P1 自证：run2 种子序列与 run1 逐值相同（种子键不含 triggerMap）✓｜S0 同输入重跑：${poolSize}/${poolSize} = 100.0%（构造口径自证）`,
    );
    for (const entry of singleScenarios) {
      console.log(
        `  ${entry.label}（winner 应用后重跑）：复用 ${entry.reused}/${entry.total} = ${percentText(entry.rate)}｜基线评估${
          entry.baselineReused ? '可复用' : '不可复用（！）'
        }｜明细 ${entry.detail
          .map((row) => `${row.changed ? '变更槽' : '其它槽'} ${row.slotIndex} ${row.reused}/${row.total}`)
          .join('，')}`,
      );
    }
    console.log(
      `  ${allScenario.label}（全部 winner 应用后重跑）：复用 ${allScenario.reused}/${allScenario.total} = ${percentText(
        allScenario.rate,
      )}｜基线评估${allScenario.baselineReused ? '可复用' : '不可复用'}`,
    );
    console.log(
      `  判据 P2（主）：R1 = 单槽场景均值 ${percentText(meanSingleRate)} ⇒ ${
        gateP2 === null
          ? '不可判'
          : gateP2 === 'high'
            ? '≥ 40% ⇒ 值得实施持久样本缓存（须带价表 / 引擎版本键护栏）'
            : gateP2 === 'mid'
              ? '20–40% ⇒ 条件候选（需以实际「迭代重跑」频率拍板）'
              : '< 20% ⇒ 不实施（收益不足以摊薄持久缓存工程）'
      }`,
    );
    console.log(
      `  参考：每评估样本 ≈ ${(sampleBytes / 1024).toFixed(1)} KB（JSON 文本口径，含 ${args.seeds} 轮）⇒ 单轮搜索池（${poolSize} 评估）≈ ${(
        (sampleBytes * poolSize) /
        1024 /
        1024
      ).toFixed(2)} MB`,
    );
    console.log(
      '判读：① 复用只对「同一（玩家 / 技能 / 目标 / 难度 / 时长）」的后续搜索成立（换目标 / 难度 / 时长 = 0%）；' +
        '② 「同输入重跑」恒 100%（含只改权重等不进 payload 的设置）；③ 明细按组独立统计（同一键可同时出现在基线与锚点，组间不求和）；' +
        '④ 实施前必须把价表行情（C2 教训）与引擎版本纳入缓存键。',
    );
  }

  console.log('真实分 = 留出组（与筛选/判据样本不相交）上的生产同款 scoreCandidate；选择偏差 = 报告分 − 真实分。');
}

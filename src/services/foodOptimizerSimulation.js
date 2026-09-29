import CombatSimulator from '../combatsimulator/combatSimulator.js';
import Player from '../combatsimulator/player.js';
import Zone from '../combatsimulator/zone.js';
import { buildSimulationExtraBuffs } from '../shared/simulationExtraBuffs.js';
import { buildFoodCandidate, computeFoodCostPerHour, hasEmptyFoodOptimizerBaseline } from './foodOptimizerDomain.js';
import { createFoodOptimizerRoundCache, matchFoodOptimizerReusableSample } from './foodOptimizerRoundCache.js';
import { assertFoodOptimizerTarget } from './foodOptimizerTarget.js';
import { observeInactiveFoodThresholds } from './foodOptimizerInactiveFood.js';
import { observeFoodOptimizerThresholds } from './foodOptimizerPruning.js';
import {
  computeFoodOptimizerCostLowerBound,
  getFoodOptimizerCostCutoff,
  isFoodOptimizerCostAboveCutoff,
  observeFoodOptimizerCostBound,
} from './foodOptimizerCostBound.js';
import {
  appendFoodOptimizerEvaluationSample,
  createFoodOptimizerEvaluationState,
  finishFoodOptimizerEvaluation,
} from './foodOptimizerEvaluation.js';
import { tryRunWasmProductionRound } from './wasmProductionSimulation.js';

// RNG 隔离契约
// ------------
// 战斗引擎在模拟期间读取 realm 全局的 Math.random，因此
// simulateFoodOptimizerRound 会在一轮模拟期间安装按种子生成的
// 随机数发生器，并在 finally 块中恢复之前的发生器。
//
// 只有当每个 JS realm 中至多有一个轮次作用域处于活动状态时，
// 这一做法才成立：生产环境的轮次运行在专用 worker 中，协调器
// 每个客户端只允许一条消息在途（FoodOptimizerWorkerClient.call），
// worker 入口自身也断言单飞评估。未来任何在主线程上启动轮次、
// 或在同一 realm 中重叠轮次的调用方都必须显式失败，而不是破坏
// 轨迹或泄漏已播种的发生器；activeRandomScopes 正是强制这一不变式。
//
// getFoodOptimizerResources 在主线程上共享构造/重置/初始化路径，
// 但有意不安装任何播种作用域：该路径必须不消耗 Math.random
//（当前如此），而每个播种作用域都归 simulateFoodOptimizerRound 所有。
let activeRandomScopes = 0;

// mulberry32 的实现已抽到 services/seededRandom.js 共享（技能优化器需要同一套
// 确定性随机源做公共随机数配对比较）。
// 注意：必须 `import` 后再导出，不能用 `export { createSeededRandom as createFoodOptimizerRandom } from ...`——
// 具名转发**不建立本地绑定**，模块体内的 createFoodOptimizerRandom 会是 undefined。
import { createSeededRandom } from './seededRandom.js';

export const createFoodOptimizerRandom = createSeededRandom;

// 玩家 / 区域装配：JS 引擎与 wasm 引擎共用同一份口径（wasm 请求只做状态快照）。
function buildFoodOptimizerPieces(request, candidate = null) {
  const payload = request.payload;
  const zone = payload.zone ? new Zone(payload.zone.zoneHrid, payload.zone.difficultyTier) : null;
  const extraBuffs = buildSimulationExtraBuffs(payload.extra);
  const players = payload.players.map((original) => {
    // DTO constructors create fresh mutable combat objects. Copy only the food
    // field we replace, avoiding a deep copy of immutable equipment/game data.
    let dto = original;
    if (candidate && dto.hrid === `player${request.activePlayerId}`) {
      dto = {
        ...original,
        food: Array.from({ length: 3 }, (_, slot) =>
          candidate.food[slot]
            ? { hrid: candidate.food[slot], triggers: candidate.triggerMap[candidate.food[slot]] }
            : null,
        ),
      };
    }
    const player = Player.createFromDTO(dto, { cacheEquipmentStats: true });
    // 与 worker.js 相同的共享契约：zone.buffs（模块级 actionDetailMap JSON，Zone
    // 构造不拷贝）与 extraBuffs 按引用共享，本 realm 可能被 worker 池复用跑多轮，
    // 跨玩家/跨轮次安全依赖 addPermanentBuff「首次写入必克隆」。禁止就地改写
    // 这些对象，或绕过 addPermanentBuff 直接写 permanentBuffs。
    player.zoneBuffs = zone?.buffs || [];
    player.extraBuffs = extraBuffs;
    return player;
  });
  return { zone, players };
}

export function createFoodOptimizerSimulation(request, candidate = null) {
  assertFoodOptimizerTarget(request);
  const payload = request.payload;
  const { zone, players } = buildFoodOptimizerPieces(request, candidate);
  return new CombatSimulator(players, zone, null, {
    enableHpMpVisualization: false,
    logCombatEvents: false,
    minimalResult: true,
    combatScrollsEnabled: Boolean(payload.extra?.combatScrollsEnabled),
    isGuildTrial: Boolean(payload.simulationContext?.isGuildTrial),
  });
}

// 单轮评估的对外样本形状：JS 引擎与 wasm 引擎共用（wasm 分支没有观察器，阈值字段为 null）。
function buildRoundSample({
  request,
  seed,
  simResult,
  hrid,
  foodHrids,
  equivalentThresholds = null,
  unusedFoodThresholds = null,
  inactiveFoodThresholds = null,
  stoppedForCost = false,
  costLowerBound = undefined,
}) {
  const used = simResult.consumablesUsed?.[hrid] || {};
  const foodUsed = Object.fromEntries(foodHrids.map((item) => [item, used[item] || 0]));
  return {
    seed,
    deaths: simResult.deaths?.[hrid] || 0,
    ranOutOfMana: simResult.playerRanOutOfMana?.[hrid] === true,
    foodUsed,
    costPerHour: simResult.stoppedEarly
      ? 0
      : computeFoodCostPerHour(
          foodUsed,
          request.prices.priceTable,
          request.prices.consumableMode,
          simResult.simulatedTime,
        ),
    equivalentThresholds,
    unusedFoodThresholds,
    inactiveFoodThresholds,
    stoppedEarly: Boolean(simResult.stoppedEarly),
    simulatedTime: simResult.simulatedTime,
    ...(stoppedForCost ? { pruned: 'cost', costLowerBound } : {}),
  };
}

export function getFoodOptimizerResources(request) {
  // 与一轮模拟相同的构造/重置/初始化路径，但在主线程上使用原生
  // Math.random 运行。该路径不得消耗随机数（见上文 RNG 隔离契约），
  // 它只读取战斗前属性。
  const simulator = createFoodOptimizerSimulation(request);
  simulator.simulationTimeLimit = request.payload.simulationTimeLimit;
  simulator.reset();
  simulator.initializeCombatPlayers(0);
  const player = simulator.players.find((entry) => entry.hrid === `player${request.activePlayerId}`);
  if (!player) throw new Error('Optimizer player is missing.');
  return {
    maxHp: player.combatDetails.maxHitpoints,
    maxMp: player.combatDetails.maxManapoints,
    foodSlots: Math.min(3, player.combatDetails.combatStats.foodSlots),
  };
}

/// 单轮是否走 wasm 引擎（切片 5-B，默认关；切片 12 放宽）：调用方显式开启，且本轮
/// 不需要 JS 侧数据观察器（阈值收集 `collectThresholds` / 成本上界 `costBound` 仍留 JS）。
/// 候选轮的 `shouldStop`（空蓝 / 死亡预算）自切片 12 起由 Rust `earlyStop` 谓词承接
///（谓词单调，两侧逐事件检查点一致）；基线轮（candidate 为空）本就无 shouldStop。
export function shouldUseWasmOptimizerRound(request, candidate, collectThresholds, costBound) {
  return request.useWasmEngine === true && !collectThresholds && !costBound;
}

export async function simulateFoodOptimizerRound(
  request,
  candidate,
  seed,
  onProgress = () => {},
  deathLimit = Infinity,
  { collectThresholds = true, costBound = null } = {},
) {
  assertFoodOptimizerTarget(request);
  if (activeRandomScopes > 0)
    throw new Error(
      'Food optimizer rounds must not overlap in the same realm: a seeded Math.random scope is already active.',
    );

  const hrid = `player${request.activePlayerId}`;

  // 切片 5-B A/B 分支（默认关）：判据见 `shouldUseWasmOptimizerRound`。
  if (shouldUseWasmOptimizerRound(request, candidate, collectThresholds, costBound)) {
    const { zone, players } = buildFoodOptimizerPieces(request, candidate);
    const simResult = await tryRunWasmProductionRound({
      useWasmEngine: true,
      players,
      zone,
      simulationContext: request.payload.simulationContext,
      seed,
      simulationTimeLimit: request.payload.simulationTimeLimit,
      options: {
        minimalResult: true,
        logCombatEvents: false,
        enableHpMpVisualization: false,
        combatScrollsEnabled: Boolean(request.payload.extra?.combatScrollsEnabled),
        isGuildTrial: Boolean(request.payload.simulationContext?.isGuildTrial),
        // 切片 12：候选轮把 JS shouldStop 谓词映射为 Rust earlyStop（与下方 JS 分支
        // 的 shouldStop 定义逐字对应：空蓝或死亡数超预算）。deathLimit 形参在调用方
        // 已是 `(deathBudget ?? Infinity) - 已累计死亡`，可能为负（早已超限）或 Infinity
        //（负值/Infinity 由 bridge 归一：Infinity → null，负值原样传递——两侧语义一致）。
        ...(candidate ? { earlyStop: { watchHrid: hrid, deathLimit } } : {}),
      },
    });
    if (simResult) {
      const player = players.find((entry) => entry.hrid === hrid);
      const foodHrids = [...new Set(player.food.filter(Boolean).map((item) => item.hrid))];
      return buildRoundSample({ request, seed, simResult, hrid, foodHrids });
    }
  }

  // 万一安装随机数发生器时抛出异常，作用域计数也不能泄漏，因此
  // 自增语句保持为受保护区域之前的最后一条语句。
  const originalRandom = Math.random;
  Math.random = createFoodOptimizerRandom(seed);
  activeRandomScopes += 1;
  try {
    const simulator = createFoodOptimizerSimulation(request, candidate);
    const player = simulator.players.find((entry) => entry.hrid === hrid);
    const observedCandidate = candidate ?? (hasEmptyFoodOptimizerBaseline(request) ? buildFoodCandidate([]) : null);
    const readThresholds = collectThresholds ? observeFoodOptimizerThresholds(player, observedCandidate) : () => null;
    const readInactiveFood =
      collectThresholds && observedCandidate ? observeInactiveFoodThresholds(simulator, hrid) : () => null;
    const foodHrids = [...new Set(player.food.filter(Boolean).map((item) => item.hrid))];
    const costObserver =
      costBound &&
      getFoodOptimizerCostCutoff(request, candidate, costBound.cutoff) !== null &&
      costBound.totalRounds === request.rounds &&
      computeFoodOptimizerCostLowerBound(costBound.completedCostPerHour, 0, costBound.totalRounds) !== null &&
      Number.isFinite(request.payload.simulationTimeLimit) &&
      request.payload.simulationTimeLimit > 0
        ? observeFoodOptimizerCostBound(simulator, player, request, costBound)
        : null;
    let stoppedForCost = false;
    let lastProgressAt = 0;
    simulator.addEventListener('progress', (event) => {
      const now = Date.now();
      if (now - lastProgressAt >= 150 || event.detail.progress === 1) {
        lastProgressAt = now;
        onProgress(event.detail.progress);
      }
    });
    let shouldStop = candidate
      ? (instance) =>
          instance.simResult.playerRanOutOfMana[hrid] === true || (instance.simResult.deaths[hrid] || 0) > deathLimit
      : undefined;
    if (costObserver) {
      const hasFailed = shouldStop;
      shouldStop = (instance) => {
        // A genuine failure in this event takes precedence over its food cost.
        if (hasFailed(instance)) return true;
        stoppedForCost = costObserver.shouldStop();
        return stoppedForCost;
      };
    }
    const result = await simulator.simulate(request.payload.simulationTimeLimit, { shouldStop });
    const inactiveFoodThresholds = readInactiveFood();
    return buildRoundSample({
      request,
      seed,
      simResult: result,
      hrid,
      foodHrids,
      equivalentThresholds: readThresholds(),
      unusedFoodThresholds: !stoppedForCost && observedCandidate?.slots.length === 0 ? inactiveFoodThresholds : null,
      inactiveFoodThresholds,
      stoppedForCost,
      costLowerBound: stoppedForCost ? costObserver.read() : undefined,
    });
  } finally {
    Math.random = originalRandom;
    activeRandomScopes -= 1;
  }
}

export async function evaluateFoodOptimizerCandidate(
  request,
  candidate,
  deathBudget,
  onProgress = () => {},
  simulateRound = simulateFoodOptimizerRound,
  { collectThresholds = true, roundCache = null, reusableSamples = [], costCutoff } = {},
) {
  assertFoodOptimizerTarget(request);
  const evaluation = createFoodOptimizerEvaluationState();
  const observedCandidate = candidate ?? (hasEmptyFoodOptimizerBaseline(request) ? buildFoodCandidate([]) : null);
  const cutoff = getFoodOptimizerCostCutoff(request, candidate, costCutoff);
  let completedCostPerHour = 0;
  for (let round = 0; round < request.rounds; round += 1) {
    const seed = request.seeds[round];
    const cached =
      collectThresholds && observedCandidate
        ? (matchFoodOptimizerReusableSample(
            seed,
            observedCandidate,
            Array.isArray(reusableSamples) ? reusableSamples[round] : null,
            request.payload?.simulationTimeLimit,
          ) ?? roundCache?.match(seed, observedCandidate))
        : null;
    const sample =
      cached ??
      (await simulateRound(
        request,
        candidate,
        seed,
        (progress) =>
          onProgress({
            round,
            progress,
            simulatedRounds: evaluation.simulatedRounds,
            reusedRounds: evaluation.reusedRounds,
          }),
        candidate ? (deathBudget ?? Infinity) - evaluation.deaths : Infinity,
        cutoff === null
          ? { collectThresholds }
          : { collectThresholds, costBound: { cutoff, completedCostPerHour, totalRounds: request.rounds } },
      ));
    if (cached) evaluation.reusedRounds += 1;
    else {
      evaluation.simulatedRounds += 1;
      // Retain completed rounds even if a later seed rejects this candidate.
      if (collectThresholds && observedCandidate && sample.pruned !== 'cost')
        roundCache?.record(seed, observedCandidate, sample);
    }
    appendFoodOptimizerEvaluationSample(evaluation, sample, candidate, deathBudget);
    if (cutoff !== null && !evaluation.rejected) {
      if (sample.pruned === 'cost') {
        evaluation.pruned = 'cost';
        evaluation.costLowerBound = sample.costLowerBound;
      } else {
        completedCostPerHour += sample.costPerHour;
        const costLowerBound = computeFoodOptimizerCostLowerBound(completedCostPerHour, 0, request.rounds);
        if (round + 1 < request.rounds && isFoodOptimizerCostAboveCutoff(costLowerBound, cutoff)) {
          evaluation.pruned = 'cost';
          evaluation.costLowerBound = costLowerBound;
        }
      }
    }
    onProgress({
      round: round + 1,
      progress: 0,
      simulatedRounds: evaluation.simulatedRounds,
      reusedRounds: evaluation.reusedRounds,
      ...(evaluation.rejected ? { rejected: evaluation.rejected } : {}),
      ...(evaluation.pruned ? { pruned: evaluation.pruned } : {}),
    });
    if (evaluation.rejected || evaluation.pruned) break;
  }
  return finishFoodOptimizerEvaluation(evaluation, request);
}

// A worker owns one immutable request. Shared-round workers use the coordinator's
// certificates without retaining a duplicate cache; standalone callers keep a
// bounded local cache. Neither evaluator may be shared across requests.
export function createFoodOptimizerEvaluator(request, { collectThresholds = true, sharedRounds = false, items } = {}) {
  assertFoodOptimizerTarget(request);
  const roundCache = collectThresholds && !sharedRounds ? createFoodOptimizerRoundCache({ items }) : null;
  return (candidate, deathBudget, onProgress, reusableSamples = [], costCutoff) =>
    evaluateFoodOptimizerCandidate(request, candidate, deathBudget, onProgress, undefined, {
      collectThresholds,
      roundCache,
      reusableSamples,
      costCutoff,
    });
}

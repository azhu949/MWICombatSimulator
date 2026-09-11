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

export function createFoodOptimizerRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createFoodOptimizerSimulation(request, candidate = null) {
  assertFoodOptimizerTarget(request);
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
    player.zoneBuffs = zone?.buffs || [];
    player.extraBuffs = extraBuffs;
    return player;
  });
  return new CombatSimulator(players, zone, null, {
    enableHpMpVisualization: false,
    logCombatEvents: false,
    minimalResult: true,
    combatScrollsEnabled: Boolean(payload.extra?.combatScrollsEnabled),
    isGuildTrial: Boolean(payload.simulationContext?.isGuildTrial),
  });
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
  // 万一安装随机数发生器时抛出异常，作用域计数也不能泄漏，因此
  // 自增语句保持为受保护区域之前的最后一条语句。
  const originalRandom = Math.random;
  Math.random = createFoodOptimizerRandom(seed);
  activeRandomScopes += 1;
  try {
    const simulator = createFoodOptimizerSimulation(request, candidate);
    const hrid = `player${request.activePlayerId}`;
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
    const used = result.consumablesUsed[hrid] || {};
    const foodUsed = Object.fromEntries(foodHrids.map((item) => [item, used[item] || 0]));
    const inactiveFoodThresholds = readInactiveFood();
    return {
      seed,
      deaths: result.deaths[hrid] || 0,
      ranOutOfMana: result.playerRanOutOfMana[hrid] === true,
      foodUsed,
      costPerHour: result.stoppedEarly
        ? 0
        : computeFoodCostPerHour(
            foodUsed,
            request.prices.priceTable,
            request.prices.consumableMode,
            result.simulatedTime,
          ),
      equivalentThresholds: readThresholds(),
      unusedFoodThresholds: !stoppedForCost && observedCandidate?.slots.length === 0 ? inactiveFoodThresholds : null,
      inactiveFoodThresholds,
      stoppedEarly: Boolean(result.stoppedEarly),
      simulatedTime: result.simulatedTime,
      ...(stoppedForCost ? { pruned: 'cost', costLowerBound: costObserver.read() } : {}),
    };
  } finally {
    Math.random = originalRandom;
    activeRandomScopes -= 1;
  }
}

export async function evaluateFoodOptimizerCandidate(
  request,
  candidate,
  baselineDeaths,
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
        candidate ? (baselineDeaths ?? Infinity) - evaluation.deaths : Infinity,
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
    appendFoodOptimizerEvaluationSample(evaluation, sample, candidate, baselineDeaths);
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
  return (candidate, baselineDeaths, onProgress, reusableSamples = [], costCutoff) =>
    evaluateFoodOptimizerCandidate(request, candidate, baselineDeaths, onProgress, undefined, {
      collectThresholds,
      roundCache,
      reusableSamples,
      costCutoff,
    });
}

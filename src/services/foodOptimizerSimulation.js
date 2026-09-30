import Player from '../combatsimulator/player.js';
import Zone from '../combatsimulator/zone.js';
import { createCombatScrollBuff, getCombatScrollSourceKey } from '../combatsimulator/combatScrollBuff.js';
import { normalizeCombatScrolls } from '../shared/combatScrolls.js';
import { buildSimulationExtraBuffs } from '../shared/simulationExtraBuffs.js';
import { buildFoodCandidate, computeFoodCostPerHour, hasEmptyFoodOptimizerBaseline } from './foodOptimizerDomain.js';
import { createFoodOptimizerRoundCache, matchFoodOptimizerReusableSample } from './foodOptimizerRoundCache.js';
import { assertFoodOptimizerTarget } from './foodOptimizerTarget.js';
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

// RNG 隔离契约（切片 21A 收窄）
// ------------
// 优化器轮次已全部走 wasm 引擎（Rust RNG 自带确定性，不消耗 Math.random），
// simulateFoodOptimizerRound 不再安装任何播种作用域。本文件仍导出
// createFoodOptimizerRandom（测试 oracle / 研究装置用 mulberry32 的同一实现）。
//
// getFoodOptimizerResources 在主线程上直接复刻玩家初始化链，
// 有意不安装任何播种作用域：该路径不消耗 Math.random，只读取战斗前属性。

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

// 单轮评估的样本形状构造（wasm 路径专用，模块内部函数；切片 21B 起 JS oracle 已删除）。
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

/// 切片 20：costBound 观察器安装条件（与 foodOptimizerCostBound 的安装守卫逐字镜像）。
/// 不满足时不携带 costBound 请求字段——轮次跑满或仅由失败谓词停止。
function shouldInstallCostBoundObserver(request, candidate, costBound) {
  return Boolean(
    costBound &&
    getFoodOptimizerCostCutoff(request, candidate, costBound.cutoff) !== null &&
    costBound.totalRounds === request.rounds &&
    computeFoodOptimizerCostLowerBound(costBound.completedCostPerHour, 0, costBound.totalRounds) !== null &&
    Number.isFinite(request.payload.simulationTimeLimit) &&
    request.payload.simulationTimeLimit > 0,
  );
}

export function getFoodOptimizerResources(request) {
  // 切片 21A 改道：不再构造 CombatSimulator（模拟执行层），在主线程上直接复刻
  // 「reset() + initializeCombatPlayers(0)」在此载荷形状下的玩家初始化链——
  // 生成永久增益 → 完全重置（清 CC/战斗增益、复位冷却、满血满蓝）→ 卷轴开局。
  // 等价性依据：CombatSimulator.reset() 其余副作用（事件队列清空、simResult 重建、
  // 卷轴运行时状态）不影响 combatDetails；玩家 resetCooldowns 不掷骰（RNG 隔离契约
  // 保持：该路径不消耗 Math.random），它只读取战斗前属性。
  assertFoodOptimizerTarget(request);
  const payload = request.payload;
  const { players } = buildFoodOptimizerPieces(request);
  const simulationTimeLimit = Math.max(0, Number(payload.simulationTimeLimit) || 0);
  const combatScrollsEnabled = Boolean(payload.extra?.combatScrollsEnabled);

  for (const player of players) {
    player.generatePermanentBuffs();
    player.reset(0);
  }

  // 等价 activateInitialScrolls：scrollsAllowed（无迷宫——assert 已拒绝）且开关开启、
  // 时限有效时，每个已配置卷轴开局使用一次（openScrollWindow 的 definition/
  // remaining 守卫等价收敛为 createCombatScrollBuff 非空检查）。
  if (combatScrollsEnabled && simulationTimeLimit > 0) {
    for (const player of players) {
      for (const itemHrid of Object.keys(normalizeCombatScrolls(player.combatScrolls))) {
        const buff = createCombatScrollBuff(itemHrid);
        if (buff) {
          player.addBuff(buff, 0, getCombatScrollSourceKey(itemHrid));
        }
      }
    }
  }

  const player = players.find((entry) => entry.hrid === `player${request.activePlayerId}`);
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
  const hrid = `player${request.activePlayerId}`;

  // 切片 21A/21B：优化器轮次 wasm-only（JS 引擎已物理删除）。候选轮 earlyStop、
  // 阈值/闲置观察（observers）、成本上界（costBound）自切片 12/13/20 起全部由
  // Rust 承接；wasm 不可用（引擎缺失 / 配置不受支持 / 运行出错）按审计定案 D1
  // 硬失败（tryRunWasmProductionRound 返回 null → throw）。
  const { zone, players } = buildFoodOptimizerPieces(request, candidate);
  const observedCandidate = candidate ?? (hasEmptyFoodOptimizerBaseline(request) ? buildFoodCandidate([]) : null);
  const collectObservers = Boolean(collectThresholds) && observedCandidate != null;
  const installCostBound = shouldInstallCostBoundObserver(request, candidate, costBound);
  const output = await tryRunWasmProductionRound({
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
      // 切片 12：候选轮把 JS shouldStop 谓词映射为 Rust earlyStop（空蓝或死亡数超预算）。
      // deathLimit 形参在调用方已是 `(deathBudget ?? Infinity) - 已累计死亡`，可能为负
      //（早已超限）或 Infinity（负值/Infinity 由 bridge 归一：Infinity → null，负值原样
      // 传递——两侧语义一致）。
      ...(candidate ? { earlyStop: { watchHrid: hrid, deathLimit } } : {}),
      ...(collectObservers ? { observers: { watchHrid: hrid } } : {}),
      // 切片 20：成本上界观察器——Rust 侧把 earlyStop（失败优先）与 costBound 组合成
      // JS shouldStop 的完整语义（|| 短路顺序一致）；priceTable/consumableMode 供桥侧
      // 预解析价格快照。
      ...(installCostBound
        ? {
            costBound: {
              watchHrid: hrid,
              cutoff: costBound.cutoff,
              completedCostPerHour: costBound.completedCostPerHour,
              totalRounds: costBound.totalRounds,
              priceTable: request.prices.priceTable,
              consumableMode: request.prices.consumableMode,
            },
          }
        : {}),
    },
  });
  if (!output) {
    throw new Error(
      'Food optimizer round failed on the WASM engine (engine missing / unsupported configuration / runtime error); the JS engine fallback was removed (slice 21A).',
    );
  }

  const { simResult, observers, costBound: costBoundOutput } = output;
  const player = players.find((entry) => entry.hrid === hrid);
  const foodHrids = [...new Set(player.food.filter(Boolean).map((item) => item.hrid))];
  const inactiveFoodThresholds = collectObservers ? (observers?.inactiveMinimum ?? null) : null;
  // 成本剪枝样本映射：stoppedForCost → pruned: 'cost' + costLowerBound；
  // unusedFoodThresholds 的 !stoppedForCost 门；costPerHour 恒 0 由 buildRoundSample
  // 的 stoppedEarly 分支给出。
  const stoppedForCost = costBoundOutput?.stoppedForCost === true;
  return buildRoundSample({
    request,
    seed,
    simResult,
    hrid,
    foodHrids,
    equivalentThresholds: collectObservers ? (observers?.thresholdRanges ?? null) : null,
    unusedFoodThresholds: !stoppedForCost && observedCandidate?.slots.length === 0 ? inactiveFoodThresholds : null,
    inactiveFoodThresholds,
    stoppedForCost,
    costLowerBound: stoppedForCost ? costBoundOutput?.costLowerBound : undefined,
  });
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

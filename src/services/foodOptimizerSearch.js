import {
  buildFoodDefaultCandidate,
  compareFoodOptimizerResults,
  countFoodOptimizerCompositions,
  countFoodOptimizerCandidates,
  generateFoodOptimizerCompositionItems,
  generateFoodOptimizerCompositionCandidates,
  hasEmptyFoodOptimizerBaseline,
  FOOD_OPTIMIZER_MAX_SLOTS,
  isFoodOptimizerTopTenRequest,
  isFoodOptimizerZeroDeathsRequest,
  resolveFoodOptimizerRequestSearchMode,
} from './foodOptimizerDomain.js';
import {
  createFoodOptimizerPruningCache,
  generatePrunedFoodOptimizerCandidates,
  materializeFoodOptimizerOutcome,
  selectFoodOptimizerConsumedCoreCapacity,
} from './foodOptimizerPruning.js';
import { selectFoodOptimizerRepresentatives } from './foodOptimizerRepresentatives.js';
import { createFoodOptimizerRoundCache } from './foodOptimizerRoundCache.js';
import { tryEvaluateFoodOptimizerCachedCandidate } from './foodOptimizerEvaluation.js';
import { createFoodOptimizerWorkQueue } from './foodOptimizerWorkQueue.js';
import { createFoodOptimizerWorkerPolicy } from './foodOptimizerWorkerPolicy.js';
import { createFoodOptimizerPriority } from './foodOptimizerPriority.js';
import { assertFoodOptimizerTarget } from './foodOptimizerTarget.js';

const COMPOSITION_WINDOW_SIZE = 32;

function selectFoodOptimizerAxes(items, result) {
  if (items.length < 2) return items;
  const ranges = result.equivalentThresholds;
  if (Array.isArray(ranges)) {
    let hasEvidence = false;
    const axes = items.map((item, index) => {
      const range = ranges.find((range) => range?.hrid === item.hrid && range?.kind === item.kind);
      let covered = 0;
      if (
        range &&
        Number.isSafeInteger(range.min) &&
        Number.isSafeInteger(range.max) &&
        range.min >= 1 &&
        range.max >= range.min
      )
        for (const threshold of item.thresholds) if (threshold >= range.min && threshold <= range.max) covered += 1;
      if (covered) hasEvidence = true;
      return { item, index, width: covered ? covered / item.thresholds.length : 1 };
    });
    // Use each grid's covered fraction, not its absolute number of points.
    // Wider equivalent axes go inside so their certificates can cover whole
    // remaining regions before eviction. Missing hints are neutral; ties keep
    // catalog order. This changes traversal only, never candidate admission.
    if (hasEvidence)
      return axes.sort((left, right) => left.width - right.width || left.index - right.index).map(({ item }) => item);
  }
  return result.rejected === 'mana'
    ? [...items].sort((left, right) => Number(right.kind === 'mp') - Number(left.kind === 'mp'))
    : items;
}

// Start with fewer slots to establish useful ranking bounds early. Each pass
// is lazy and bounded to its own slot count; complete searches keep their
// original depth-first composition order.
function* generateTopTenCompositions(items, slotLimit = FOOD_OPTIMIZER_MAX_SLOTS) {
  const parsed = Number(slotLimit);
  const limit = Math.max(0, Math.min(FOOD_OPTIMIZER_MAX_SLOTS, Number.isFinite(parsed) ? Math.floor(parsed) : 0));
  for (let slots = 0; slots <= limit; slots += 1)
    for (const composition of generateFoodOptimizerCompositionItems(items, slots))
      if (composition.length === slots) yield composition;
}

// The empty-food run can already certify ten distinct zero-consumption choices
// before ordinary traversal reaches them. Keep these witnesses out of coverage
// and report statistics; they only establish a ranking bound.
function findUnusedFoodRankWitnesses(request, items, foodSlots, candidate, result, deathBudget) {
  if (
    candidate.slots.length ||
    !Number.isSafeInteger(deathBudget) ||
    deathBudget < 0 ||
    result.feasible !== true ||
    result.rejected ||
    result.pruned ||
    result.ranOutOfMana ||
    result.roundsCompleted !== request.rounds
  )
    return null;
  // Revalidate every seed and the full duration, and recompute the intersection
  // and cumulative deaths against the candidate death budget: the equipped
  // baseline's cumulative deaths, or zero in zero-deaths mode.
  const verified = tryEvaluateFoodOptimizerCachedCandidate(request, candidate, deathBudget, result.samples);
  if (!verified?.feasible || verified.costPerHour !== 0 || !verified.unusedFoodThresholds) return null;
  const unusedItems = (items || [])
    .map((item) => ({
      ...item,
      thresholds: item.thresholds.filter((value) => value >= verified.unusedFoodThresholds[item.kind]),
    }))
    .filter((item) => item.thresholds.length);
  // Full-domain reuse already avoids every candidate simulation. Do not add
  // ranking work to the thousands of compressed blocks in that fast path.
  if (
    unusedItems.reduce((sum, item) => sum + item.thresholds.length, 0) ===
    (items || []).reduce((sum, item) => sum + item.thresholds.length, 0)
  )
    return null;
  const witnesses = [];
  const seen = new Set();
  const evidence = { unusedFood: true, result: verified };
  for (const composition of generateTopTenCompositions(unusedItems, foodSlots)) {
    if (witnesses.length === 10 && composition.length > witnesses[9].slots.length) break;
    for (const representative of selectFoodOptimizerRepresentatives(composition)) {
      if (seen.has(representative.signature)) continue;
      seen.add(representative.signature);
      witnesses.push({ ...representative, ...materializeFoodOptimizerOutcome(evidence, representative) });
    }
    witnesses.sort(compareFoodOptimizerResults);
    witnesses.length = Math.min(10, witnesses.length);
  }
  return witnesses.length === 10 ? witnesses : null;
}

function yieldToEventLoop() {
  return new Promise((resolve) => {
    if (typeof globalThis.MessageChannel !== 'function') {
      setTimeout(resolve, 0);
      return;
    }
    let channel;
    const close = () => {
      channel?.port1.close();
      channel?.port2.close();
    };
    try {
      channel = new globalThis.MessageChannel();
      channel.port1.onmessage = channel.port1.onmessageerror = () => {
        close();
        resolve();
      };
      channel.port2.postMessage(null);
    } catch {
      close();
      setTimeout(resolve, 0);
    }
  });
}

export class FoodOptimizerWorkerClient {
  constructor() {
    this.worker = new Worker(new URL('../foodOptimizerWorker.js', import.meta.url), { type: 'module' });
    this.pending = null;
    this.worker.onmessage = ({ data }) => {
      if (!this.pending) return;
      if (data.type === 'progress') this.pending.onProgress?.(data);
      else {
        const pending = this.pending;
        this.pending = null;
        if (data.type === 'error') pending.reject(new Error(data.error));
        else pending.resolve(data.result);
      }
    };
    this.worker.onerror = (error) => this.stop(new Error(error.message || 'Worker failed.'));
    this.worker.onmessageerror = () => this.stop(new Error('Unable to read worker result.'));
  }

  call(message, onProgress) {
    return new Promise((resolve, reject) => {
      if (!this.worker || this.pending) {
        reject(new Error('Worker is unavailable.'));
        return;
      }
      this.pending = { resolve, reject, onProgress };
      try {
        this.worker.postMessage(message);
      } catch (error) {
        this.pending = null;
        reject(error);
      }
    });
  }

  stop(error = new Error('Search stopped.')) {
    this.worker?.terminate();
    this.worker = null;
    const pending = this.pending;
    this.pending = null;
    pending?.reject(error);
  }
}

export function createFoodOptimizerReport(request, items, foodSlots) {
  const totalCandidates = countFoodOptimizerCandidates(items, foodSlots);
  const totalCompositions = countFoodOptimizerCompositions(items, foodSlots);
  return {
    request,
    inputSignature: request.inputSignature,
    appliedInputSignature: '',
    appliedSignature: null,
    stale: false,
    fromCache: false,
    status: 'running',
    complete: false,
    startedAt: Date.now(),
    finishedAt: 0,
    baseline: null,
    topResults: [],
    stats: {
      totalCandidates,
      maxSimulationRounds: (totalCandidates + 1) * request.rounds,
      completedCandidates: 0,
      simulatedCandidates: 0,
      reusedCandidates: 0,
      skippedCandidates: 0,
      prunedCandidates: 0,
      completedRounds: 0,
      reusedRounds: 0,
      feasibleCandidates: 0,
      rejectedMana: 0,
      rejectedDeaths: 0,
      totalCompositions,
      screenedCompositions: 0,
      passedCompositions: 0,
    },
  };
}

export function createFoodOptimizerSearch({
  request,
  items,
  foodSlots,
  workerLimit,
  onUpdate = () => {},
  onCoverage,
  reuse = true,
  adaptiveWorkers = true,
  now = () => globalThis.performance?.now() ?? Date.now(),
  workerFactory = () => new FoodOptimizerWorkerClient(),
}) {
  // searchMode 只在这里解析一次：缺失/非法按“完整搜索”执行，并把解析结果写回 request，
  // 让报告及其下游（UI 统计口径、缓存、复制本请求的调用方）看到实际执行的模式，
  // 而不是留下 undefined 这第三种状态。
  request.searchMode = resolveFoodOptimizerRequestSearchMode(request.searchMode);
  // 同上：把「排除有死亡的方案」的解析结果写回 request，报告与 UI 看到的是实际执行的口径。
  request.requireZeroDeaths = isFoodOptimizerZeroDeathsRequest(request);
  const report = createFoodOptimizerReport(request, items, foodSlots);
  // 候选的死亡预算：普通模式等于基线累计死亡（不高于基线即可）；启用「排除有死亡的方案」
  // 时压到 0——有死亡的候选一律按 rejected='deaths' 淘汰，前十自然只剩 0 死方案。
  const candidateDeathBudget = () => (request.requireZeroDeaths ? 0 : report.baseline.deaths);
  const clients = new Set();
  const inFlight = new Map();
  const completedRoundsByClient = new Map();
  const topTen = isFoodOptimizerTopTenRequest(request);
  let rankWitnesses = null;
  let rankCutoff;
  const getRankCutoff = () => rankCutoff;
  const refreshRankCutoff = () => {
    let ranked = report.topResults;
    if (rankWitnesses) {
      const distinct = new Map(rankWitnesses.map((result) => [result.signature, result]));
      for (const result of ranked) distinct.set(result.signature, result);
      ranked = [...distinct.values()].sort(compareFoodOptimizerResults);
    }
    rankCutoff = ranked.length >= 10 ? ranked[9] : undefined;
  };
  const getCostCutoff = () => getRankCutoff()?.costPerHour;
  const pruning = createFoodOptimizerPruningCache({
    rounds: request.rounds,
    items,
    ...(topTen ? { getCostCutoff, getRankCutoff } : {}),
    // Consumed-core capacity follows the search space: fine grids observe far
    // more distinct cores, while small domains must not pay for a large index.
    ...selectFoodOptimizerConsumedCoreCapacity(report.stats.totalCandidates),
  });
  const requestedWorkers = Math.min(Math.max(1, Math.floor(Number(workerLimit) || 1)), report.stats.totalCandidates);
  const sharedRounds = reuse && requestedWorkers > 1;
  const sharedRoundCache = sharedRounds ? createFoodOptimizerRoundCache({ items }) : null;
  const workerPolicy = adaptiveWorkers && reuse && requestedWorkers > 1 ? createFoodOptimizerWorkerPolicy() : null;
  let cancelled = false;
  let failed = false;
  let reusedSinceYield = 0;
  let phase = 'baseline';
  let lastPublishAt = 0;
  let lastProgress = 0;
  let pruningCleared = false;
  const publish = (force = false) => {
    const now = Date.now();
    if (!force && now - lastPublishAt < 150) return;
    lastPublishAt = now;
    const partialRounds = Array.from(inFlight.values()).reduce((total, value) => total + value, 0);
    const finishedUnits = (report.baseline ? request.rounds : 0) + report.stats.completedCandidates * request.rounds;
    lastProgress = Math.max(
      lastProgress,
      Math.min(1, (finishedUnits + partialRounds) / report.stats.maxSimulationRounds),
    );
    // Hit-rate telemetry for the consumed-core index; not part of the stats
    // contract, so the exact-shape comparisons of report.stats stay valid.
    // After the final clear the captured snapshot below is authoritative.
    if (!pruningCleared) report.coreMetrics = { ...pruning.coreMetrics };
    onUpdate(structuredClone(report), {
      phase: report.status === 'running' ? phase : report.status,
      activeRounds: partialRounds,
      progress: lastProgress,
      elapsedSeconds: (now - report.startedAt) / 1000,
    });
  };
  const createClient = async () => {
    if (cancelled || failed) throw new Error('Search stopped.');
    const startedAt = workerPolicy ? now() : 0;
    const client = workerFactory();
    clients.add(client);
    await client.call({ type: 'init', request, collectThresholds: reuse, sharedRounds, items });
    if (cancelled || failed) throw new Error('Search stopped.');
    workerPolicy?.recordInitialization(now() - startedAt);
    return client;
  };
  const recordCompletedRounds = (client, rounds, reusedRounds = 0) => {
    const previous = completedRoundsByClient.get(client) || { rounds: 0, reusedRounds: 0 };
    report.stats.completedRounds += Math.max(0, rounds - previous.rounds);
    report.stats.reusedRounds += Math.max(0, reusedRounds - previous.reusedRounds);
    completedRoundsByClient.set(client, { rounds, reusedRounds });
  };
  const beginCall = (client) => {
    completedRoundsByClient.delete(client);
    inFlight.set(client, 0);
  };
  const finishCall = (client) => {
    inFlight.delete(client);
  };
  const progressFor =
    (client) =>
    ({ round, progress, simulatedRounds = round, reusedRounds = 0 }) => {
      if (cancelled || failed) return;
      recordCompletedRounds(client, simulatedRounds, reusedRounds);
      inFlight.set(client, round + progress);
      publish();
    };
  const rememberResult = (candidate, result) => {
    if (reuse) pruning.record(candidate, result);
    if (topTen && reuse && !rankWitnesses && candidate.slots.length === 0) {
      rankWitnesses = findUnusedFoodRankWitnesses(request, items, foodSlots, candidate, result, candidateDeathBudget());
      if (rankWitnesses) refreshRankCutoff();
    }
    if (sharedRoundCache && Array.isArray(result.samples))
      for (const sample of result.samples) sharedRoundCache.record(sample?.seed, candidate, sample);
  };
  const done = (async () => {
    try {
      assertFoodOptimizerTarget(request);
      publish(true);
      const first = await createClient();
      beginCall(first);
      report.baseline = await first.call({ type: 'evaluate', candidate: null }, progressFor(first));
      finishCall(first);
      if (cancelled) return report;
      recordCompletedRounds(
        first,
        report.baseline.simulatedRounds ?? report.baseline.roundsCompleted,
        report.baseline.reusedRounds,
      );
      const emptyBaseline = reuse && hasEmptyFoodOptimizerBaseline(request);
      // 空槽基线（用户当前没带食物）会把自身结论直接复用为“空候选”的证据；启用「排除有死亡的
      // 方案」且基线自身会死亡时，这条捷径会把带死亡的基线当成合格候选送进榜单，因此不再复用，
      // 让空候选走普通候选的死亡预算（0）淘汰。
      //
      // 性能口径：跳过捷径的净代价只是空候选自身的一次首死截断模拟。这次死亡淘汰结果仍携带
      // “食物从未触发”证书，pruning.record 的失败分支照常收录，因此下方 allUnused 只在这
      // 一次模拟之前悲观为 false，此后的覆盖能力不弱于直接复用基线；rankWitnesses 在该口径
      // 下则本就不可能成立——零成本（从不触发）方案与基线同轨迹、必然同死，无资格作为排名
      // 下界。据此也不值得改造基线记录或重算 allUnused：可省的上限就是这一次截断模拟。
      if (emptyBaseline && !(request.requireZeroDeaths && report.baseline.deaths > 0))
        rememberResult(buildFoodDefaultCandidate([]), report.baseline);
      phase = 'screening';
      publish(true);
      // A certified never-trigger bound for every food's full grid also covers
      // every subset. All remaining work is reuse, so no additional workers help.
      const allUnused =
        emptyBaseline &&
        pruning.matchRanges(
          (items || [])
            .filter((item) => item?.thresholds?.length)
            .map((item) => ({ ...item, min: Math.min(...item.thresholds), max: Math.max(...item.thresholds) })),
        )?.unusedFood;
      const limit = allUnused ? 1 : requestedWorkers;
      const pool = [first];
      if (!workerPolicy) pool.push(...(await Promise.all(Array.from({ length: limit - 1 }, () => createClient()))));

      const recordOutcome = (result, count = 1, reused = false) => {
        report.stats.completedCandidates += count;
        if (result.pruned) {
          // Even an already-started candidate has unknown final feasibility.
          // Actual executed rounds remain accounted for independently.
          report.stats.prunedCandidates += count;
          return;
        }
        report.stats[reused ? (result.feasible ? 'reusedCandidates' : 'skippedCandidates') : 'simulatedCandidates'] +=
          count;
        if (result.rejected === 'mana') report.stats.rejectedMana += count;
        if (result.rejected === 'deaths') report.stats.rejectedDeaths += count;
        if (result.feasible) report.stats.feasibleCandidates += count;
      };
      const rankResult = (candidate, result) => {
        report.topResults.push({
          ...candidate,
          ...result,
          savingsPerHour: report.baseline.costPerHour - result.costPerHour,
        });
        report.topResults.sort(compareFoodOptimizerResults);
        report.topResults.length = Math.min(10, report.topResults.length);
        // Cutoffs are read for every region query; update their merged ranking
        // only when a result is ranked, instead of sorting at every cache probe.
        if (topTen) refreshRankCutoff();
      };

      const runPhase = async (groups, onResult = () => {}, totalCandidates = 0) => {
        const queue = createFoodOptimizerWorkQueue(groups);
        const tasks = new Set();
        const initialCompleted = report.stats.completedCandidates;
        let pendingStarts = 0;
        let phaseError = null;
        const failPhase = (error) => {
          if (!cancelled && !phaseError) phaseError = error;
          failed = !cancelled;
          for (const activeClient of clients) activeClient.stop(error);
        };
        const track = (promise) => {
          const task = promise.catch(failPhase).finally(() => tasks.delete(task));
          tasks.add(task);
        };
        const maybeGrow = (observed) => {
          if (cancelled || failed || !workerPolicy) return;
          const count = workerPolicy.workersToStart(
            {
              workers: pool.length,
              pendingWorkers: pendingStarts,
              workerLimit: limit,
              remainingCandidates:
                totalCandidates -
                (report.stats.completedCandidates - initialCompleted) -
                inFlight.size -
                (observed ? 0 : 1),
            },
            observed,
          );
          if (!count) return;
          // Reserve capacity synchronously. The tracked chain owns both init
          // and the runner, including cancellation before initialization ends.
          pendingStarts += count;
          workerPolicy.workerStarted();
          for (let index = 0; index < count; index += 1)
            track(
              createClient().then(
                (client) => {
                  // Release the reservation and publish the ready worker in the
                  // same microtask, so another runner never sees a spare slot.
                  pendingStarts -= 1;
                  if (cancelled || failed) return;
                  pool.push(client);
                  return runClient(client);
                },
                (error) => {
                  pendingStarts -= 1;
                  // Close the growth gate immediately, before another runner's
                  // continuation can observe the released reservation.
                  failPhase(error);
                },
              ),
            );
        };
        const runClient = async (client) => {
          while (!cancelled && !failed) {
            const next = queue.next(client);
            if (next.done) return;
            const candidate = next.value;
            const evidence = candidate.coveredCandidates ? candidate.evidence : reuse ? pruning.match(candidate) : null;
            if (evidence) {
              workerPolicy?.record({ coveredCandidates: candidate.coveredCandidates || 1 });
              if (candidate.coveredCandidates) {
                recordOutcome(evidence.result, candidate.coveredCandidates, true);
                const canRank =
                  evidence.result.feasible &&
                  (report.topResults.length < 10 ||
                    compareFoodOptimizerResults(
                      { ...evidence.result, slots: candidate.items, signature: '' },
                      report.topResults.at(-1),
                    ) <= 0);
                if (canRank)
                  for (const representative of selectFoodOptimizerRepresentatives(candidate.items, {
                    order: evidence.order,
                    excludedSignature: candidate.excludedSignature,
                  }))
                    rankResult(representative, materializeFoodOptimizerOutcome(evidence, representative));
                onCoverage?.({ items: candidate.items, excludedSignature: candidate.excludedSignature, evidence });
              } else {
                const result = materializeFoodOptimizerOutcome(evidence, candidate);
                recordOutcome(result, 1, true);
                if (result.feasible) rankResult(candidate, result);
                onResult(candidate, result);
                onCoverage?.({ candidate, result });
              }
              publish();
              // Even a run consisting entirely of reuse must remain stoppable.
              if (++reusedSinceYield >= 64) {
                reusedSinceYield = 0;
                await yieldToEventLoop();
              }
              continue;
            }
            const reusableSamples = sharedRoundCache
              ? request.seeds?.map((seed) => sharedRoundCache.match(seed, candidate))
              : undefined;
            let result = sharedRoundCache
              ? tryEvaluateFoodOptimizerCachedCandidate(request, candidate, candidateDeathBudget(), reusableSamples)
              : null;
            const completedFromCache = result !== null;
            if (completedFromCache) {
              report.stats.reusedRounds += result.reusedRounds;
              workerPolicy?.record();
            } else {
              maybeGrow();
              const startedAt = workerPolicy ? now() : 0;
              beginCall(client);
              const receiveProgress = progressFor(client);
              const plannedRounds = request.rounds - (reusableSamples?.filter(Boolean).length || 0);
              result = await client.call(
                {
                  type: 'evaluate',
                  candidate,
                  deathBudget: candidateDeathBudget(),
                  reusableSamples,
                  ...(topTen ? { costCutoff: getCostCutoff() } : {}),
                },
                workerPolicy
                  ? (update) => {
                      receiveProgress(update);
                      // Only a validated round boundary supplies new work
                      // evidence; raw progress can precede a failure result.
                      if (
                        update.progress === 0 &&
                        !update.rejected &&
                        !update.pruned &&
                        pool.length < limit &&
                        !pendingStarts
                      )
                        maybeGrow({
                          durationMs: now() - startedAt,
                          simulatedRounds: update.simulatedRounds,
                          plannedRounds,
                        });
                    }
                  : receiveProgress,
              );
              finishCall(client);
              if (cancelled || failed) return;
              recordCompletedRounds(client, result.simulatedRounds ?? result.roundsCompleted, result.reusedRounds);
              workerPolicy?.record({
                durationMs: now() - startedAt,
                simulated: (result.simulatedRounds ?? result.roundsCompleted) > 0,
              });
            }
            recordOutcome(result, 1, result.simulatedRounds === 0);
            if (result.feasible) rankResult(candidate, result);
            rememberResult(candidate, result);
            onResult(candidate, result);
            onCoverage?.({ candidate, result });
            publish();
            if (completedFromCache && ++reusedSinceYield >= 64) {
              reusedSinceYield = 0;
              await yieldToEventLoop();
            }
          }
        };
        for (const client of pool) track(runClient(client));
        // New initialization/runner chains can join while an existing worker
        // is evaluating. A snapshot of the initial pool would miss those tasks.
        while (tasks.size) await Promise.race(tasks);
        queue.clear();
        if (phaseError) throw phaseError;
      };
      function* generateVariants(composition, result, excludedCandidate) {
        if (reuse) {
          const axes = allUnused ? composition : selectFoodOptimizerAxes(composition, result);
          yield* generatePrunedFoodOptimizerCandidates(axes, pruning, excludedCandidate, {
            captureCoverage: Boolean(onCoverage),
          });
        } else
          for (const candidate of generateFoodOptimizerCompositionCandidates(composition))
            if (candidate.signature !== excludedCandidate?.signature) yield candidate;
      }
      const recordScreened = (result) => {
        report.stats.screenedCompositions += 1;
        if (result.feasible) report.stats.passedCompositions += 1;
      };
      let priority = topTen && !allUnused ? createFoodOptimizerPriority(request, items, foodSlots) : null;
      let priorityResult;
      const screenedEmpty = Boolean(priority);
      if (priority) {
        let emptyResult;
        // Preserve the cheap no-food proof before spending work near equipment.
        await runPhase(
          [() => [buildFoodDefaultCandidate([])]],
          (_candidate, result) => {
            recordScreened(result);
            emptyResult = result;
          },
          1,
        );
        if (cancelled) return report;
        if (emptyResult.feasible || getRankCutoff()) priority = null;
        else {
          await runPhase(
            [() => [priority.candidate]],
            (_candidate, result) => {
              recordScreened(result);
              priorityResult = result;
            },
            1,
          );
          if (cancelled) return report;
          phase = 'searching';
          publish(true);
          await runPhase(
            [() => generateVariants(priority.nearbyItems, priorityResult, priority.candidate)],
            undefined,
            priority.nearbyCount - 1,
          );
          if (cancelled) return report;
        }
      }
      const isPriority = (entry) => priority?.candidate.signature === entry.candidate.signature;
      const compositions = topTen
        ? generateTopTenCompositions(items, foodSlots)
        : generateFoodOptimizerCompositionItems(items, foodSlots);
      while (!cancelled && !failed) {
        // Keep a bounded set of defaults near the variants that need their
        // certificates, instead of screening the entire catalog before using them.
        const window = [];
        while (window.length < COMPOSITION_WINDOW_SIZE) {
          const next = compositions.next();
          if (next.done) break;
          if (screenedEmpty && next.value.length === 0) continue;
          window.push({ items: next.value, candidate: buildFoodDefaultCandidate(next.value) });
        }
        if (!window.length) break;
        const defaults = new Map();
        const pendingDefaults = window.filter((entry) => !isPriority(entry));
        if (window.some(isPriority)) defaults.set(priority.candidate.signature, priorityResult);
        await runPhase(
          [() => pendingDefaults.map((entry) => entry.candidate)],
          (candidate, result) => {
            recordScreened(result);
            defaults.set(candidate.signature, result);
          },
          pendingDefaults.length,
        );
        if (cancelled) return report;

        function* variants(preferred) {
          for (const entry of window) {
            const result = defaults.get(entry.candidate.signature);
            if (Boolean(result.feasible) !== preferred) continue;
            yield function* () {
              // Another active composition may have evicted this default while
              // the worker was busy. A full-domain empty-food certificate is
              // retained separately and needs no per-composition reinsertion.
              if (!allUnused) rememberResult(entry.candidate, result);
              if (isPriority(entry)) {
                // The bounded neighborhood was already counted and ranked.
                // Visit its disjoint complement even if its evidence was evicted.
                for (const remainder of priority.remainingItems) yield* generateVariants(remainder, result);
              } else yield* generateVariants(entry.items, result, entry.candidate);
            };
          }
        }
        const countVariants = (preferred) =>
          window.reduce(
            (total, entry) =>
              total +
              (Boolean(defaults.get(entry.candidate.signature).feasible) === preferred
                ? entry.items.reduce((count, item) => count * item.thresholds.length, 1) -
                  (isPriority(entry) ? priority.nearbyCount : 1)
                : 0),
            0,
          );
        if (phase !== 'searching') {
          phase = 'searching';
          publish(true);
        }
        await runPhase(variants(true), undefined, countVariants(true));
        if (cancelled) return report;
        // Failure at the default threshold cannot rule out other timings.
        await runPhase(variants(false), undefined, countVariants(false));
      }
      report.complete = !cancelled && report.stats.completedCandidates === report.stats.totalCandidates;
      report.status = report.complete ? 'completed' : 'cancelled';
    } catch (error) {
      report.status = cancelled ? 'cancelled' : 'error';
      if (!cancelled) report.error = error?.message || String(error);
    } finally {
      for (const client of clients) client.stop();
      clients.clear();
      inFlight.clear();
      completedRoundsByClient.clear();
      // Snapshot before clearing: publish() must report the finished run.
      const finalCoreMetrics = { ...pruning.coreMetrics };
      pruningCleared = true;
      pruning.clear();
      sharedRoundCache?.clear();
      rankWitnesses = null;
      rankCutoff = undefined;
      if (cancelled) report.status = 'cancelled';
      report.finishedAt = Date.now();
      report.coreMetrics = finalCoreMetrics;
      publish(true);
    }
    return report;
  })();
  return {
    done,
    cancel() {
      cancelled = true;
      for (const client of clients) client.stop();
    },
  };
}

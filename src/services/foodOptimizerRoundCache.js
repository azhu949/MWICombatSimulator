import { createFoodOptimizerPruningCache, materializeFoodOptimizerOutcome } from './foodOptimizerPruning.js';
import { compareFoodSlots } from './foodOptimizerDomain.js';
import { createFoodOptimizerGrid } from './foodOptimizerGrid.js';
import {
  createFoodOptimizerInactiveCache,
  isValidFoodOptimizerInactiveThresholds,
} from './foodOptimizerInactiveCache.js';

const validCandidate = (candidate) => Array.isArray(candidate?.slots) && Array.isArray(candidate?.food);

function isCompleteRound(seed, sample) {
  return (
    Number.isSafeInteger(seed) &&
    Number.isSafeInteger(sample?.seed) &&
    sample.seed >>> 0 === seed >>> 0 &&
    sample.stoppedEarly === false &&
    sample.ranOutOfMana === false &&
    Number.isSafeInteger(sample.deaths) &&
    sample.deaths >= 0 &&
    Number.isFinite(sample.simulatedTime) &&
    sample.simulatedTime > 0 &&
    Number.isFinite(sample.costPerHour) &&
    sample.costPerHour >= 0
  );
}

// Shared rounds arrive already materialized for this candidate by the request's
// coordinator. Validate the certificate directly rather than building a temporary
// pruning cache for every hit. In particular, an earlier stop is never a complete
// sample and may depend on a different remaining death budget.
export function matchFoodOptimizerReusableSample(seed, candidate, sample, simulationTimeLimit) {
  if (
    !isCompleteRound(seed, sample) ||
    !validCandidate(candidate) ||
    !Number.isFinite(simulationTimeLimit) ||
    sample.simulatedTime !== simulationTimeLimit ||
    (sample.inactiveFoodThresholds != null && !isValidFoodOptimizerInactiveThresholds(sample.inactiveFoodThresholds))
  )
    return null;
  const { slots, food } = candidate;
  const counts = sample.foodUsed;
  const ranges = sample.equivalentThresholds;
  if (
    food.length !== slots.length ||
    new Set(food).size !== food.length ||
    !counts ||
    typeof counts !== 'object' ||
    Array.isArray(counts) ||
    Object.keys(counts).length !== food.length ||
    !Array.isArray(ranges) ||
    ranges.length !== slots.length
  )
    return null;
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const range = ranges[index];
    if (
      !slot ||
      typeof slot.hrid !== 'string' ||
      !slot.hrid ||
      (slot.kind !== 'hp' && slot.kind !== 'mp') ||
      food[index] !== slot.hrid ||
      !Number.isSafeInteger(slot.threshold) ||
      slot.threshold < 1 ||
      !Object.prototype.hasOwnProperty.call(counts, slot.hrid) ||
      !Number.isSafeInteger(counts[slot.hrid]) ||
      counts[slot.hrid] < 0 ||
      range?.hrid !== slot.hrid ||
      range.kind !== slot.kind ||
      !Number.isSafeInteger(range.min) ||
      !Number.isSafeInteger(range.max) ||
      range.min < 1 ||
      range.min > slot.threshold ||
      range.max < slot.threshold ||
      (index > 0 && compareFoodSlots(slots[index - 1], slot) >= 0)
    )
      return null;
    const triggers = candidate.triggerMap?.[slot.hrid];
    const trigger = triggers?.[0];
    if (
      !Array.isArray(triggers) ||
      triggers.length !== 1 ||
      trigger?.dependencyHrid !== '/combat_trigger_dependencies/self' ||
      trigger.conditionHrid !== `/combat_trigger_conditions/missing_${slot.kind}` ||
      trigger.comparatorHrid !== '/combat_trigger_comparators/greater_than_equal' ||
      trigger.value !== slot.threshold
    )
      return null;
  }
  if (
    !slots.length &&
    (sample.costPerHour !== 0 ||
      !['hp', 'mp'].every(
        (kind) => Number.isSafeInteger(sample.unusedFoodThresholds?.[kind]) && sample.unusedFoodThresholds[kind] >= 1,
      ))
  )
    return null;
  return sample.seed === seed ? sample : { ...sample, seed };
}

// Instances belong to one immutable optimizer request. Each seed has its own
// bounded certificates because identical thresholds can follow different paths
// under different random streams. Defaults retain at most 1,280 regular entries,
// 640 consumed-core entries, and ten no-food certificates per cache instance.
export function createFoodOptimizerRoundCache({
  maxEntries = 128,
  maxInactiveEntries = 64,
  maxConsumedCoreEntries = 64,
  // Seed-bucket capacity, not the rounds bound: ten buckets happen to cover
  // FOOD_OPTIMIZER_MAX_ROUNDS (one bucket per seed) under the current range.
  // Raising the rounds bound past this cap would only evict older buckets — a
  // miss just re-simulates that round, so correctness never depends on it; size
  // it to the request's seed count if that ever happens.
  maxSeeds = 10,
  items,
} = {}) {
  const caches = new Map();
  // Grid matching and projection only read this request's immutable catalog.
  // Share its validated copy across seed buckets, including discarded empty ones.
  const grid = items == null ? null : createFoodOptimizerGrid(items);
  const seedLimit = Math.max(1, Math.min(10, Math.floor(Number(maxSeeds) || 1)));
  const touch = (key, cache) => {
    caches.delete(key);
    caches.set(key, cache);
  };
  const clearSeed = (cache) => {
    cache.regular.clear();
    cache.inactive.clear();
  };

  return {
    get size() {
      let size = 0;
      for (const cache of caches.values()) size += cache.regular.size + cache.inactive.size;
      return size;
    },
    get seedCount() {
      return caches.size;
    },
    clear() {
      for (const cache of caches.values()) clearSeed(cache);
      caches.clear();
    },
    match(seed, candidate) {
      if (!Number.isSafeInteger(seed) || !validCandidate(candidate)) return null;
      const key = seed >>> 0;
      const cache = caches.get(key);
      if (!cache) return null;
      const evidence = cache.regular.match(candidate);
      const sample = evidence
        ? materializeFoodOptimizerOutcome(evidence, candidate).samples[0]
        : cache.inactive.match(seed, candidate);
      if (!sample) return null;
      touch(key, cache);
      return sample.seed === seed ? sample : { ...sample, seed };
    },
    record(seed, candidate, sample) {
      if (!validCandidate(candidate) || !isCompleteRound(seed, sample)) return;

      const key = seed >>> 0;
      const cache = caches.get(key) || {
        regular: createFoodOptimizerPruningCache({
          rounds: 1,
          maxEntries,
          maxFeasibleEntries: maxEntries,
          grid,
          // Cross-composition cores complement the per-seed inactive cache.
          // Every seed bucket owns one of these caches, so keep it small.
          maxFailureCoreEntries: 0,
          maxFeasibleCoreEntries: maxConsumedCoreEntries,
          maxCoreGroupEntries: Math.min(16, maxConsumedCoreEntries),
        }),
        inactive: createFoodOptimizerInactiveCache({ maxEntries: maxInactiveEntries, grid }),
      };
      // Completion is independent of the caller's remaining death budget. The
      // evaluator still checks cumulative deaths after obtaining this sample.
      cache.regular.record(candidate, {
        feasible: true,
        rejected: '',
        roundsCompleted: 1,
        deaths: sample.deaths,
        ranOutOfMana: false,
        costPerHour: sample.costPerHour,
        foodUsed: sample.foodUsed,
        equivalentThresholds: sample.equivalentThresholds,
        unusedFoodThresholds: sample.unusedFoodThresholds,
        inactiveFoodThresholds: sample.inactiveFoodThresholds,
        samples: [sample],
      });
      cache.inactive.record(seed, candidate, sample);
      // Missing or singleton certificates must not evict useful seeds merely
      // because a simulation completed without providing reusable evidence.
      if (!cache.regular.size && !cache.inactive.size && !cache.regular.match(candidate)) return;
      touch(key, cache);
      while (caches.size > seedLimit) {
        const oldestKey = caches.keys().next().value;
        clearSeed(caches.get(oldestKey));
        caches.delete(oldestKey);
      }
    },
  };
}

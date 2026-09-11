import { buildFoodCandidate, compareFoodSlots } from './foodOptimizerDomain.js';
import { createFoodOptimizerGrid, matchesFoodOptimizerGrid, projectFoodOptimizerRanges } from './foodOptimizerGrid.js';
import { materializeFoodOptimizerDomains } from './foodOptimizerRepresentatives.js';
import { isFoodOptimizerCostAboveCutoff } from './foodOptimizerCostBound.js';

const MAX_THRESHOLD = Number.MAX_SAFE_INTEGER;
const FAILURE_REASONS = new Set(['mana', 'deaths']);
const nativePruningCacheMatchers = new WeakMap();
// Consumed-core group keys join hrids. No valid hrid contains NUL, and entries
// with such an hrid are never registered, so the key stays injective.
const CORE_SEPARATOR = '\u0000';
const coreKeyOf = (hrids) => [...hrids].sort().join(CORE_SEPARATOR);
const validCoreMinimum = (minimum) =>
  Boolean(
    minimum &&
    ['hp', 'mp'].every(
      (kind) => Number.isSafeInteger(minimum[kind]) && minimum[kind] >= 1 && minimum[kind] <= MAX_THRESHOLD,
    ),
  );

// A consumed core is the set of foods a result actually consumed. Any candidate
// whose core foods keep thresholds inside the recorded equivalence ranges, and
// whose remaining foods never fire (threshold at or above the per-kind deficit
// bound of the same trajectory), follows exactly that trajectory: slots keep
// their relative order because compareFoodSlots is a strict total order, so the
// added foods cannot perturb the outcome. Capacity scales with the search space
// because fine grids observe far more distinct cores; the round-level caches
// keep their own much smaller budgets.
export function selectFoodOptimizerConsumedCoreCapacity(totalCandidates) {
  const total = Number.isFinite(totalCandidates) ? Math.max(0, Math.floor(totalCandidates)) : 0;
  // The budgets are upper bounds, so the index never allocates for a small
  // domain. Fine grids observe tens of thousands of distinct cores: the wider
  // budget is what the verified measurements used, and it costs about 17 MB of
  // coordinator heap on the page default (4.36M candidates, three slots).
  return total < 2048
    ? { maxFailureCoreEntries: 1024, maxFeasibleCoreEntries: 256, maxCoreGroupEntries: 32 }
    : { maxFailureCoreEntries: 16384, maxFeasibleCoreEntries: 2048, maxCoreGroupEntries: 256 };
}

export function observeFoodOptimizerThresholds(player, candidate) {
  const foods = player?.food?.filter(Boolean) || [];
  const slots = candidate?.slots;
  if (
    !Array.isArray(slots) ||
    foods.length !== slots.length ||
    slots.some((slot, index) => {
      const food = foods[index];
      const trigger = food.triggers?.[0];
      return (
        food.hrid !== slot.hrid ||
        !Array.isArray(food.triggers) ||
        food.triggers.length !== 1 ||
        trigger.dependencyHrid !== '/combat_trigger_dependencies/self' ||
        trigger.conditionHrid !== `/combat_trigger_conditions/missing_${slot.kind}` ||
        trigger.comparatorHrid !== '/combat_trigger_comparators/greater_than_equal' ||
        trigger.value !== slot.threshold ||
        !Number.isSafeInteger(slot.threshold)
      );
    })
  )
    return () => null;

  let valid = true;
  const ranges = slots.map(({ hrid, kind }) => ({ hrid, kind, min: 1, max: MAX_THRESHOLD }));
  for (let index = 0; index < foods.length; index += 1) {
    const trigger = foods[index].triggers[0];
    const compare = trigger.compareValue;
    // Observe the actual engine comparison, after stun/cooldown checks. Keeping
    // each comparison identical preserves the event/RNG path for this slot order.
    trigger.compareValue = function (value) {
      const active = compare.call(this, value);
      if (!Number.isFinite(value) || this.value !== slots[index].threshold) valid = false;
      else if (active) ranges[index].max = Math.min(ranges[index].max, Math.floor(value));
      else ranges[index].min = Math.max(ranges[index].min, Math.floor(value) + 1);
      return active;
    };
  }
  return () => (valid ? ranges.map((range) => ({ ...range })) : null);
}

export function intersectFoodOptimizerThresholds(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return null;
  const intersection = [];
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a.hrid !== b.hrid || a.kind !== b.kind) return null;
    const min = Math.max(a.min, b.min);
    const max = Math.min(a.max, b.max);
    if (min > max) return null;
    intersection.push({ hrid: a.hrid, kind: a.kind, min, max });
  }
  return intersection;
}

export function observeUnusedFoodThresholds(simulator, hrid) {
  let valid = true;
  const minimum = { hp: 1, mp: 1 };
  const check = simulator.checkTriggersForUnit;
  simulator.checkTriggersForUnit = function (unit, ...args) {
    if (unit.hrid === hrid && unit.combatDetails.currentHitpoints > 0 && !unit.isStunned) {
      const hp = unit.combatDetails.maxHitpoints - unit.combatDetails.currentHitpoints;
      const mp = unit.combatDetails.maxManapoints - unit.combatDetails.currentManapoints;
      if (!Number.isFinite(hp) || !Number.isFinite(mp)) valid = false;
      else {
        minimum.hp = Math.max(minimum.hp, Math.floor(hp) + 1);
        minimum.mp = Math.max(minimum.mp, Math.floor(mp) + 1);
      }
    }
    return check.call(this, unit, ...args);
  };
  return () => (valid ? { ...minimum } : null);
}

export function intersectUnusedFoodThresholds(left, right) {
  return left && right ? { hp: Math.max(left.hp, right.hp), mp: Math.max(left.mp, right.mp) } : null;
}

export function materializeFoodOptimizerOutcome(evidence, candidate) {
  const result = evidence.result;
  if (!candidate?.slots?.length) return result;
  if (Array.isArray(evidence.coreRanges)) {
    // Consumed-core evidence from a smaller or differently filled composition.
    // The candidate repeats the recorded trajectory: consumed foods keep their
    // ranges, the remaining foods never trigger above the per-kind bound.
    const rangesByHrid = new Map(evidence.coreRanges.map((range) => [range.hrid, range]));
    const rangeFor = (slot, minimum) => {
      const range = rangesByHrid.get(slot.hrid);
      return range
        ? { hrid: slot.hrid, kind: slot.kind, min: range.min, max: range.max }
        : { hrid: slot.hrid, kind: slot.kind, min: minimum?.[slot.kind] ?? 1, max: MAX_THRESHOLD };
    };
    const samples = Array.isArray(result.samples)
      ? result.samples.map((sample) => ({
          ...sample,
          foodUsed: Object.fromEntries(candidate.food.map((hrid) => [hrid, sample.foodUsed?.[hrid] ?? 0])),
          equivalentThresholds: candidate.slots.map((slot) => {
            const range = Array.isArray(sample.equivalentThresholds)
              ? sample.equivalentThresholds.find((entry) => entry?.hrid === slot.hrid)
              : null;
            return range
              ? { hrid: slot.hrid, kind: slot.kind, min: range.min, max: range.max }
              : rangeFor(slot, sample.inactiveFoodThresholds ?? evidence.minimum);
          }),
        }))
      : result.samples;
    return {
      ...result,
      foodUsed: Object.fromEntries(candidate.food.map((hrid) => [hrid, result.foodUsed?.[hrid] ?? 0])),
      equivalentThresholds: candidate.slots.map((slot) => rangeFor(slot, evidence.minimum)),
      samples,
    };
  }
  if (!evidence.unusedFood) return result;
  const foodUsed = Object.fromEntries(candidate.food.map((hrid) => [hrid, 0]));
  const ranges = (minimum) =>
    candidate.slots.map(({ hrid, kind }) => ({ hrid, kind, min: minimum[kind], max: MAX_THRESHOLD }));
  return {
    ...result,
    foodUsed,
    equivalentThresholds: ranges(result.unusedFoodThresholds),
    unusedFoodThresholds: null,
    samples: result.samples.map((sample) => ({
      ...sample,
      foodUsed: { ...foodUsed },
      equivalentThresholds: ranges(sample.unusedFoodThresholds),
      unusedFoodThresholds: null,
    })),
  };
}

function compositionKey(items) {
  return JSON.stringify(items.map((item) => item.hrid).sort());
}

function containsRanges(outer, inner) {
  return (
    outer.length === inner.length &&
    outer.every((range, index) => {
      const other = inner[index];
      return range.hrid === other.hrid && range.kind === other.kind && range.min <= other.min && range.max >= other.max;
    })
  );
}

export function createFoodOptimizerPruningCache({
  maxEntries = 1024,
  maxFeasibleEntries = 128,
  maxFailureCoreEntries = 0,
  maxFeasibleCoreEntries = 0,
  maxCoreGroupEntries = 0,
  rounds,
  items,
  grid = items == null ? null : createFoodOptimizerGrid(items),
  getCostCutoff,
  getRankCutoff,
} = {}) {
  const groups = new Map();
  const entries = new Set();
  const feasibleEntries = new Set();
  const limit = Math.max(1, Math.min(1024, Math.floor(Number(maxEntries) || 1)));
  const feasibleLimit = Math.max(1, Math.min(limit, Math.floor(Number(maxFeasibleEntries) || 1)));
  const failureCoreLimit = Math.max(0, Math.min(16384, Math.floor(Number(maxFailureCoreEntries) || 0)));
  const feasibleCoreLimit = Math.max(0, Math.min(16384, Math.floor(Number(maxFeasibleCoreEntries) || 0)));
  const coreGroupLimit = Math.max(1, Math.min(16384, Math.floor(Number(maxCoreGroupEntries) || 1)));
  const coreEnabled = failureCoreLimit > 0 || feasibleCoreLimit > 0;
  const coreGroups = new Map();
  const failureCoreEntries = new Set();
  const feasibleCoreEntries = new Set();
  let coreProbes = 0;
  let coreHits = 0;
  let coreRecords = 0;
  let coreEvictions = 0;
  let unusedFood = null;
  const remove = (entry) => {
    entries.delete(entry);
    feasibleEntries.delete(entry);
    const group = groups.get(entry.key);
    group.splice(group.indexOf(entry), 1);
    if (!group.length) groups.delete(entry.key);
  };
  const removeCore = (entry) => {
    failureCoreEntries.delete(entry);
    feasibleCoreEntries.delete(entry);
    const group = coreGroups.get(entry.key);
    if (!group) return;
    group.splice(group.indexOf(entry), 1);
    if (!group.length) coreGroups.delete(entry.key);
  };
  // A core entry contains another when its consumed ranges and per-kind bounds
  // are at least as wide; wider entries answer every query the narrower one
  // could, so only the widest per key is retained.
  const coreContains = (outer, inner) =>
    outer.minimum.hp <= inner.minimum.hp &&
    outer.minimum.mp <= inner.minimum.mp &&
    outer.core.every((slot, index) => slot.min <= inner.core[index].min && slot.max >= inner.core[index].max);
  const insertCore = (entry) => {
    const ownLimit = entry.result.feasible === true ? feasibleCoreLimit : failureCoreLimit;
    if (ownLimit <= 0) return;
    const previous = coreGroups.get(entry.key) || [];
    if (previous.some((existing) => coreContains(existing, entry))) return;
    for (const existing of [...previous]) if (coreContains(entry, existing)) removeCore(existing);
    const group = coreGroups.get(entry.key) || [];
    group.unshift(entry);
    coreGroups.set(entry.key, group);
    (entry.result.feasible === true ? feasibleCoreEntries : failureCoreEntries).add(entry);
    coreRecords += 1;
    const own = entry.result.feasible === true ? feasibleCoreEntries : failureCoreEntries;
    while (group.length > coreGroupLimit) {
      removeCore(group.at(-1));
      coreEvictions += 1;
    }
    while (own.size > ownLimit) {
      removeCore(own.values().next().value);
      coreEvictions += 1;
    }
  };
  const registerConsumedCore = (candidate, result, feasible, prunedForCost) => {
    const ranges = result.equivalentThresholds;
    if (!Array.isArray(ranges) || ranges.length !== candidate.slots.length) return;
    let minimum;
    const consumed = new Set();
    if (feasible || result.rejected === 'deaths' || prunedForCost) {
      // Full-prefix identity: every executed round must reproduce, so the
      // intersected ranges and per-kind bounds across all samples certify it.
      // Cost-pruned prefixes stop at an event that depends only on the
      // identical trajectory and the cutoff, which is revalidated on match.
      minimum = result.inactiveFoodThresholds;
      if (!validCoreMinimum(minimum)) return;
      for (const sample of result.samples) {
        if (!sample?.foodUsed) return;
        for (const [hrid, count] of Object.entries(sample.foodUsed)) if (count > 0) consumed.add(hrid);
      }
    } else if (result.rejected === 'mana') {
      // One failing seed alone proves infeasibility; only that round's
      // trajectory is certified, exactly like the same-composition entry.
      const sample = result.samples[result.roundsCompleted - 1];
      if (!sample || sample.ranOutOfMana !== true) return;
      minimum = sample.inactiveFoodThresholds;
      if (!validCoreMinimum(minimum) || !sample.foodUsed) return;
      for (const [hrid, count] of Object.entries(sample.foodUsed)) if (count > 0) consumed.add(hrid);
    } else return;
    if (!consumed.size || consumed.size > 2) return;
    const core = [];
    for (let index = 0; index < candidate.slots.length; index += 1) {
      const slot = candidate.slots[index];
      if (!consumed.has(slot.hrid)) continue;
      if (slot.hrid.includes(CORE_SEPARATOR)) return;
      const range = ranges[index];
      if (
        range?.hrid !== slot.hrid ||
        range.kind !== slot.kind ||
        !Number.isSafeInteger(range.min) ||
        !Number.isSafeInteger(range.max) ||
        range.min < 1 ||
        range.min > slot.threshold ||
        range.max < slot.threshold
      )
        return;
      core.push({ hrid: slot.hrid, kind: slot.kind, min: range.min, max: range.max });
    }
    if (core.length !== consumed.size) return;
    insertCore({
      key: coreKeyOf(core.map((slot) => slot.hrid)),
      core,
      minimum: { ...minimum },
      result: feasible
        ? result
        : prunedForCost
          ? {
              feasible: null,
              rejected: '',
              pruned: 'cost',
              costLowerBound: result.costLowerBound,
              roundsCompleted: result.roundsCompleted,
            }
          : {
              feasible: false,
              rejected: result.rejected,
              roundsCompleted: result.roundsCompleted,
            },
    });
  };
  const probeCore = (domains, coreDomains) => {
    const group = coreGroups.get(coreKeyOf(coreDomains.map((domain) => domain.hrid)));
    if (!group) return null;
    for (const entry of group) {
      if (entry.core.length !== coreDomains.length) continue;
      let matched = true;
      for (let index = 0; index < entry.core.length; index += 1) {
        const domain = coreDomains[index];
        if (
          domain.kind !== entry.core[index].kind ||
          domain.hrid !== entry.core[index].hrid ||
          domain.min < entry.core[index].min ||
          domain.max > entry.core[index].max
        ) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      const consumedHrids = new Set(entry.core.map((slot) => slot.hrid));
      let covered = true;
      // Every food outside the core must stay inactive: the query may hold more
      // slots than the probed subset, and each of them needs the bound check.
      for (const domain of domains)
        if (!consumedHrids.has(domain.hrid) && domain.min < entry.minimum[domain.kind]) {
          covered = false;
          break;
        }
      if (!covered) continue;
      // The recorded core order must survive every point of the block, so the
      // covered candidates keep the witness's slot order for these two foods.
      if (
        entry.core.length === 2 &&
        compareFoodSlots(
          { ...coreDomains[0], threshold: coreDomains[0].min },
          { ...coreDomains[1], threshold: coreDomains[1].max },
        ) >= 0
      )
        continue;
      return entry;
    }
    return null;
  };
  // A query may cover at most six ordered cores with the three-slot limit, and
  // the remaining foods must stay inactive, so no linear scan is ever needed.
  const matchConsumedCore = (domains) => {
    if (!coreEnabled || (!failureCoreEntries.size && !feasibleCoreEntries.size)) return null;
    coreProbes += 1;
    for (let first = 0; first < domains.length; first += 1) {
      const single = probeCore(domains, [domains[first]]);
      if (single) {
        coreHits += 1;
        return single;
      }
      for (let second = first + 1; second < domains.length; second += 1) {
        const pair = probeCore(domains, [domains[first], domains[second]]);
        if (pair) {
          coreHits += 1;
          return pair;
        }
      }
    }
    return null;
  };
  const coreEvidence = (entry) => ({
    result: entry.result,
    coreRanges: entry.core.map((range) => ({ ...range })),
    minimum: { ...entry.minimum },
  });
  const cache = {
    get size() {
      return entries.size;
    },
    get feasibleSize() {
      return feasibleEntries.size;
    },
    get coreMetrics() {
      return {
        probes: coreProbes,
        hits: coreHits,
        records: coreRecords,
        evictions: coreEvictions,
        failureEntries: failureCoreEntries.size,
        feasibleEntries: feasibleCoreEntries.size,
        groups: coreGroups.size,
      };
    },
    clear() {
      groups.clear();
      entries.clear();
      feasibleEntries.clear();
      coreGroups.clear();
      failureCoreEntries.clear();
      feasibleCoreEntries.clear();
      unusedFood = null;
    },
    record(candidate, result) {
      if (
        !Number.isInteger(result.roundsCompleted) ||
        result.roundsCompleted < 1 ||
        (rounds != null && result.roundsCompleted > rounds) ||
        result.samples?.length !== result.roundsCompleted
      )
        return;
      const feasible =
        result.feasible === true &&
        !result.rejected &&
        !result.ranOutOfMana &&
        Number.isInteger(result.roundsCompleted) &&
        result.roundsCompleted > 0 &&
        (rounds == null || result.roundsCompleted === rounds) &&
        result.samples?.length === result.roundsCompleted &&
        result.samples.every((sample) => sample && !sample.stoppedEarly && !sample.ranOutOfMana);
      const prunedForCost =
        typeof getCostCutoff === 'function' &&
        result.pruned === 'cost' &&
        result.feasible === null &&
        !result.rejected &&
        !result.ranOutOfMana &&
        result.samples.every((sample) => sample && !sample.ranOutOfMana) &&
        isFoodOptimizerCostAboveCutoff(result.costLowerBound, getCostCutoff());
      if (result.pruned && !prunedForCost) return;
      if (result.feasible === true && !feasible) return;
      if (!feasible && !prunedForCost && !FAILURE_REASONS.has(result.rejected)) return;
      if (!candidate.slots.length) {
        // A ranking proof never certifies a complete no-food outcome.
        if (prunedForCost) return;
        if (
          result.unusedFoodThresholds &&
          ['hp', 'mp'].every(
            (kind) => Number.isSafeInteger(result.unusedFoodThresholds[kind]) && result.unusedFoodThresholds[kind] >= 1,
          ) &&
          result.samples?.every((sample) => sample.unusedFoodThresholds)
        )
          unusedFood = { result, unusedFood: true };
        return;
      }
      const ranges = result.equivalentThresholds;
      if (
        !Array.isArray(ranges) ||
        ranges.length !== candidate.slots.length ||
        ranges.some((range, index) => {
          const slot = candidate.slots[index];
          return (
            range.hrid !== slot.hrid ||
            range.kind !== slot.kind ||
            !Number.isSafeInteger(range.min) ||
            !Number.isSafeInteger(range.max) ||
            range.min < 1 ||
            range.min > slot.threshold ||
            range.max < slot.threshold
          );
        })
      )
        return;
      // Registered before the grid-wide early returns: a point certificate can
      // still answer a larger composition whose added foods never trigger.
      if (coreEnabled) registerConsumedCore(candidate, result, feasible, prunedForCost);
      // A singleton cannot cover any other candidate in the deduplicated grid.
      if (ranges.every((range) => range.min === range.max)) return;
      const projection = grid ? projectFoodOptimizerRanges(grid, candidate, ranges) : null;
      if (grid && (!projection || projection.coverage <= 1)) return;
      const matchingRanges = projection?.ranges ?? ranges;
      const key = compositionKey(candidate.slots);
      const previous = groups.get(key) || [];
      if (previous.some((entry) => containsRanges(entry.ranges, matchingRanges))) return;
      for (const entry of [...previous]) if (containsRanges(matchingRanges, entry.ranges)) remove(entry);
      const group = groups.get(key) || [];
      const entry = {
        key,
        ranges: matchingRanges.map((range) => ({ ...range })),
        order: candidate.food,
        result: feasible
          ? result
          : prunedForCost
            ? {
                feasible: null,
                rejected: '',
                pruned: 'cost',
                costLowerBound: result.costLowerBound,
                roundsCompleted: result.roundsCompleted,
              }
            : { feasible: false, rejected: result.rejected, roundsCompleted: result.roundsCompleted },
      };
      group.unshift(entry);
      groups.set(key, group);
      entries.add(entry);
      if (feasible) feasibleEntries.add(entry);
      while (group.length > 16) remove(group.at(-1));
      while (feasibleEntries.size > feasibleLimit) remove(feasibleEntries.values().next().value);
      while (entries.size > limit) remove(entries.values().next().value);
    },
    match(candidate) {
      return this.matchRanges(candidate.slots.map((slot) => ({ ...slot, min: slot.threshold, max: slot.threshold })));
    },
    matchRanges(domains) {
      // In a no-food run, thresholds above every observed deficit never fire.
      // Adding any number of such foods leaves combat unchanged, in any order.
      if (unusedFood && domains.every((domain) => domain.min >= unusedFood.result.unusedFoodThresholds[domain.kind]))
        return unusedFood;
      if (grid && !matchesFoodOptimizerGrid(grid, domains)) return null;
      const rankCutoff = getRankCutoff?.();
      // Cost and deaths cannot be negative. Once ten zero-cost, zero-death
      // solutions use fewer slots, every point of this domain loses even in
      // its best possible outcome. No statement about feasibility is implied.
      if (
        rankCutoff?.costPerHour === 0 &&
        rankCutoff.deaths === 0 &&
        Array.isArray(rankCutoff.slots) &&
        domains.length > rankCutoff.slots.length
      )
        return {
          result: {
            feasible: null,
            rejected: '',
            pruned: 'rank',
            roundsCompleted: 0,
            costLowerBound: 0,
            rankLowerBound: { costPerHour: 0, deaths: 0, slotCount: domains.length },
          },
        };
      const group = groups.get(compositionKey(domains));
      if (group) {
        for (const entry of group) {
          if (
            entry.result.pruned === 'cost' &&
            !isFoodOptimizerCostAboveCutoff(entry.result.costLowerBound, getCostCutoff?.())
          )
            continue;
          const ordered = entry.ranges.map((range) => domains.find((domain) => domain.hrid === range.hrid));
          if (
            !ordered.every(
              (domain, index) =>
                domain &&
                domain.kind === entry.ranges[index].kind &&
                domain.min >= entry.ranges[index].min &&
                domain.max <= entry.ranges[index].max,
            )
          )
            continue;
          // The least threshold on the earlier slot must still sort before the
          // greatest threshold on the next slot, including all tie breakers.
          if (
            ordered.some(
              (domain, index) =>
                index > 0 &&
                compareFoodSlots(
                  { ...ordered[index - 1], threshold: ordered[index - 1].min },
                  { ...domain, threshold: domain.max },
                ) >= 0,
            )
          )
            continue;
          return entry;
        }
      }
      const core = matchConsumedCore(domains);
      if (!core) return null;
      // Cost-pruned cores stay valid only while their recorded lower bound
      // still exceeds the current ranking cutoff, like same-composition ones.
      if (
        core.result.pruned === 'cost' &&
        !isFoodOptimizerCostAboveCutoff(core.result.costLowerBound, getCostCutoff?.())
      )
        return null;
      return coreEvidence(core);
    },
  };
  nativePruningCacheMatchers.set(cache, cache.matchRanges);
  return cache;
}

function hasStrictThresholdOrder({ thresholds }) {
  return thresholds.every(
    (threshold, index) =>
      index === 0 ||
      (thresholds[0] > thresholds.at(-1) ? threshold < thresholds[index - 1] : threshold > thresholds[index - 1]),
  );
}

export function* generatePrunedFoodOptimizerCandidates(
  items,
  cache,
  excludedCandidate,
  { captureCoverage = false } = {},
) {
  const domains = items.map((item) => ({
    ...item,
    min: Math.min(...item.thresholds),
    max: Math.max(...item.thresholds),
  }));
  const suffixCounts = Array(items.length + 1).fill(1);
  for (let index = items.length - 1; index >= 0; index -= 1)
    suffixCounts[index] = suffixCounts[index + 1] * items[index].thresholds.length;
  const nativeMatcher = nativePruningCacheMatchers.get(cache);
  // Custom queries may mutate thresholds. Inspect only registered caches and
  // data properties so getter/Proxy overrides keep the original read order.
  const deferTraversal =
    nativeMatcher !== undefined && Object.getOwnPropertyDescriptor(cache, 'matchRanges')?.value === nativeMatcher;
  let monotonic = deferTraversal ? null : items.map(hasStrictThresholdOrder);
  const excluded = new Map(excludedCandidate?.slots.map((slot) => [slot.hrid, slot.threshold]) || []);
  const coverage = (evidence, count, includesExcluded) => {
    const coveredCandidates = count - Number(includesExcluded);
    return coveredCandidates > 0
      ? {
          coveredCandidates,
          evidence,
          items: evidence.result.feasible || captureCoverage ? materializeFoodOptimizerDomains(domains) : undefined,
          excludedSignature: includesExcluded ? excludedCandidate.signature : undefined,
        }
      : null;
  };
  const includesExcluded =
    excludedCandidate != null &&
    excluded.size === items.length &&
    items.every((item) => item.thresholds.includes(excluded.get(item.hrid)));
  const initialEvidence = cache.matchRanges(domains);
  if (initialEvidence) {
    const covered = coverage(initialEvidence, suffixCounts[0], includesExcluded);
    if (covered) yield covered;
    return;
  }
  const picked = [];
  if (deferTraversal) monotonic = items.map(hasStrictThresholdOrder);
  const extendCoverage = (index, start, evidence) => {
    const domain = domains[index];
    const thresholds = items[index].thresholds;
    const last = thresholds.length - 1;
    const setEnd = (end) => {
      domain.min = Math.min(thresholds[start], thresholds[end]);
      domain.max = Math.max(thresholds[start], thresholds[end]);
    };
    let end = start;
    let rejectedEnd = thresholds.length;
    // Probe only after a hit. Exponential growth keeps narrow certificates cheap
    // while a newly learned interval can cover many unvisited siblings at once.
    for (let span = 1; end < last; span *= 2) {
      const next = Math.min(last, start + span);
      setEnd(next);
      const expanded = cache.matchRanges(domains);
      if (!expanded) {
        rejectedEnd = next;
        break;
      }
      end = next;
      evidence = expanded;
    }
    while (end + 1 < rejectedEnd) {
      const next = Math.floor((end + rejectedEnd) / 2);
      setEnd(next);
      const expanded = cache.matchRanges(domains);
      if (expanded) {
        end = next;
        evidence = expanded;
      } else rejectedEnd = next;
    }
    setEnd(end);
    return { end, evidence };
  };
  function* visit(index, includesExcluded, evidence = cache.matchRanges(domains)) {
    if (evidence) {
      const covered = coverage(evidence, suffixCounts[index], includesExcluded);
      if (covered) yield covered;
      return;
    }
    if (index === items.length) {
      if (!includesExcluded) yield buildFoodCandidate(picked);
      return;
    }
    const domain = domains[index];
    const { min, max } = domain;
    const thresholds = items[index].thresholds;
    for (let offset = 0; offset < thresholds.length; offset += 1) {
      const threshold = thresholds[offset];
      domain.min = domain.max = threshold;
      let evidence = cache.matchRanges(domains);
      if (evidence) {
        const start = offset;
        // Materialized min/max ranges describe a contiguous slice only for a
        // strictly ordered grid. Other inputs retain the original point walk.
        if (monotonic[index] && offset + 1 < thresholds.length)
          ({ end: offset, evidence } = extendCoverage(index, offset, evidence));
        const excludedThreshold = excluded.get(domain.hrid);
        const covered = coverage(
          evidence,
          (offset - start + 1) * suffixCounts[index + 1],
          includesExcluded && excludedThreshold >= domain.min && excludedThreshold <= domain.max,
        );
        if (covered) yield covered;
      } else {
        picked[index] = { ...items[index], threshold };
        yield* visit(index + 1, includesExcluded && excluded.get(domain.hrid) === threshold, null);
      }
    }
    domain.min = min;
    domain.max = max;
  }
  yield* visit(0, includesExcluded, null);
}

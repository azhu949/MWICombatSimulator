import { buildFoodCandidate, compareFoodSlots } from './foodOptimizerDomain.js';
import {
  createFoodOptimizerGrid,
  matchesFoodOptimizerGridItems,
  projectFoodOptimizerRanges,
  resolveFoodOptimizerGridItem,
} from './foodOptimizerGrid.js';
import { materializeFoodOptimizerDomains } from './foodOptimizerRepresentatives.js';
import { isFoodOptimizerCostAboveCutoff } from './foodOptimizerCostBound.js';

const MAX_THRESHOLD = Number.MAX_SAFE_INTEGER;
const FAILURE_REASONS = new Set(['mana', 'deaths']);
// Every identity field the memoized query snapshot has to freeze. hrid, kind,
// restore and price are what compareFoodSlots (foodOptimizerDomain.js) reads
// besides the caller-written threshold; recoveryDuration is frozen ahead of the
// tie breaker it is the likeliest candidate for. The snapshot, hrid positions,
// grid items and comparison templates all mirror this list, and the guard drops
// the query whenever an entry is rewritten in place, so a new non-threshold
// field read anywhere in those derivations has to be added here. The guard
// compares the fields by name for speed, and assertQueryGuardCoverage below
// proves at import time that the two never drift apart, while
// assertComparatorReadCoverage rejects any compareFoodSlots observation the
// frozen fields and the threshold do not cover. The parametrized rewrite
// test in __tests__/foodOptimizerPruning.test.js exercises every entry.
const QUERY_GUARD_FIELDS = ['hrid', 'kind', 'restore', 'price', 'recoveryDuration'];
const nativePruningCacheMatchers = new WeakMap();
// Consumed-core group keys join hrids. No valid hrid contains NUL, and entries
// with such an hrid are never registered, so the key stays injective.
const CORE_SEPARATOR = '\u0000';
// Cores hold at most two foods, so ordering that pair reproduces the sorted key
// without allocating and sorting.
const coreKeyOf = (hrids) => {
  if (hrids.length === 2)
    return hrids[0] < hrids[1] ? `${hrids[0]}${CORE_SEPARATOR}${hrids[1]}` : `${hrids[1]}${CORE_SEPARATOR}${hrids[0]}`;
  if (hrids.length === 1) return `${hrids[0]}`;
  return [...hrids].sort().join(CORE_SEPARATOR);
};
const validCoreMinimum = (minimum) =>
  Boolean(
    minimum &&
    ['hp', 'mp'].every(
      (kind) => Number.isSafeInteger(minimum[kind]) && minimum[kind] >= 1 && minimum[kind] <= MAX_THRESHOLD,
    ),
  );

// The query reuse guard, written out by field name: it runs once per probe on
// the matchRanges hot path, where a dynamic loop over QUERY_GUARD_FIELDS costs
// at least twice as much. assertQueryGuardCoverage below proves at import time
// that this comparison and the frozen field list never drift apart.
const queryGuardAccepts = (candidate, slots, length) => {
  for (let index = 0; index < length; index += 1) {
    const domain = candidate[index];
    const slot = slots[index];
    if (
      domain !== slot.ref ||
      domain.hrid !== slot.hrid ||
      domain.kind !== slot.kind ||
      domain.restore !== slot.restore ||
      domain.price !== slot.price ||
      domain.recoveryDuration !== slot.recoveryDuration
    )
      return false;
  }
  return true;
};
// A value no frozen identity field can hold; the coverage proof rewrites one
// frozen field at a time with it.
const QUERY_GUARD_PROBE = Symbol('queryGuardProbe');
// Freeze a synthetic slot carrying every field a real domain can hold and
// require the guard to accept the pristine pair, keep accepting it while the
// traversal-mutable bounds move, while rejecting a rewrite of every
// QUERY_GUARD_FIELDS entry and a replacement slot object. A missing or
// inverted comparison, a comparison against the wrong field, or a comparison
// reading a field outside the list fails the import instead of letting the
// cache answer from a stale snapshot or rebuild the query on every probe.
function assertQueryGuardCoverage() {
  const slot = {
    hrid: 'a',
    name: 'a',
    itemLevel: 1,
    kind: 'mp',
    restore: 1,
    recoveryDuration: 1,
    thresholds: [1],
    price: 1,
    threshold: 1,
    min: 1,
    max: 1,
  };
  const frozen = { ref: slot };
  for (const field of QUERY_GUARD_FIELDS) frozen[field] = slot[field];
  if (!queryGuardAccepts([slot], [frozen], 1))
    throw new Error('The query guard does not accept a pristine frozen slot.');
  for (const bound of ['min', 'max']) {
    const saved = slot[bound];
    slot[bound] = 2;
    const accepted = queryGuardAccepts([slot], [frozen], 1);
    slot[bound] = saved;
    if (!accepted) throw new Error(`The query guard compares the traversal-mutable ${bound}.`);
  }
  if (queryGuardAccepts([{ ...slot }], [frozen], 1))
    throw new Error('The query guard does not reject a replaced slot.');
  for (const field of QUERY_GUARD_FIELDS) {
    const saved = frozen[field];
    frozen[field] = QUERY_GUARD_PROBE;
    const accepted = queryGuardAccepts([slot], [frozen], 1);
    frozen[field] = saved;
    if (accepted) throw new Error(`The query guard does not compare the frozen field "${field}".`);
  }
}
assertQueryGuardCoverage();
// The comparison templates copy each slot once and then only ever rewrite the
// threshold, so every other field compareFoodSlots reads has to be frozen by
// QUERY_GUARD_FIELDS: an in-place rewrite of an unfrozen field keeps the guard
// accepting the query while the stale template keeps feeding the comparator,
// silently corrupting the pruning answer. This proof wraps recording proxies
// around synthetic slots and compares every relative state (less, equal,
// greater) of every frozen field plus the caller-written threshold, in every
// combination, so a read hiding behind an inequality, or behind a conjunction
// of inequalities, is recorded just like one in the all-equal tail; the
// numeric states also cover falsy and nullish values, so a read gated behind
// a truthy or nullish fallback of a falsy field is recorded too. Key
// enumeration, in checks, descriptor reads and prototype queries record
// through their own traps (a plain property get never queries the prototype,
// so ordinary reads cannot trip that one). No finite probe set closes every
// guard: a read taken only when a field takes a value outside the grid's
// domain (an arbitrary constant predicate), or gated behind a side effect,
// stays out of reach. The import fails when a recorded key is neither the
// threshold nor a QUERY_GUARD_FIELDS entry.
function assertComparatorReadCoverage() {
  const reads = new Set();
  const record = (slot) =>
    new Proxy(slot, {
      get(target, key) {
        reads.add(key);
        return Reflect.get(target, key);
      },
      has(target, key) {
        reads.add(key);
        return Reflect.has(target, key);
      },
      getOwnPropertyDescriptor(target, key) {
        reads.add(key);
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
      ownKeys(target) {
        reads.add('ownKeys');
        return Reflect.ownKeys(target);
      },
      getPrototypeOf(target) {
        reads.add('getPrototypeOf');
        return Reflect.getPrototypeOf(target);
      },
    });
  // kind holds only the two values, so its relative states are the four
  // ordered pairs; every other field is probed as less, equal and greater,
  // and with one side falsy (0) or nullish (undefined): free foods price at
  // 0 and most recovery durations are 0 in the game data, so a read gated
  // behind a truthy (||) or nullish (??) fallback is production-reachable
  // and has to be recorded too. The hrids look like production hrids so
  // prefix checks behave as they would on real data.
  const numericStates = [
    [0, 2],
    [2, 2],
    [2, 0],
    [undefined, 2],
    [2, undefined],
  ];
  const statesByField = {
    kind: [
      ['mp', 'hp'],
      ['mp', 'mp'],
      ['hp', 'mp'],
      ['hp', 'hp'],
    ],
    hrid: [
      ['/items/a', '/items/c'],
      ['/items/b', '/items/b'],
      ['/items/c', '/items/a'],
    ],
  };
  const fields = [...QUERY_GUARD_FIELDS, 'threshold'];
  const states = fields.map((field) => statesByField[field] || numericStates);
  const totals = states.map((list) => list.length);
  const probes = totals.reduce((product, count) => product * count, 1);
  for (let probe = 0; probe < probes; probe += 1) {
    const left = {};
    const right = {};
    let rest = probe;
    for (let index = 0; index < fields.length; index += 1) {
      const [leftValue, rightValue] = states[index][rest % totals[index]];
      rest = Math.floor(rest / totals[index]);
      left[fields[index]] = leftValue;
      right[fields[index]] = rightValue;
    }
    compareFoodSlots(record(left), record(right));
  }
  for (const key of reads)
    if (key !== 'threshold' && !QUERY_GUARD_FIELDS.includes(key))
      throw new Error(`compareFoodSlots reads "${String(key)}", which QUERY_GUARD_FIELDS does not freeze.`);
}
assertComparatorReadCoverage();

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

// Composition keys stay inside one cache instance, so they only have to be
// injective: joining the sorted hrids avoids the per-probe serialization.
function compositionKey(items) {
  const hrids = items.map((item) => item.hrid).sort();
  let key = '';
  for (let index = 0; index < hrids.length; index += 1) key += `${hrids[index]}${CORE_SEPARATOR}`;
  return key;
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
  getDeathBudget,
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
  // Death-budget gate (slot-aware). A recorded verdict holds only for the budget
  // its run was truncated at, and that budget shrinks when a query carries fewer
  // slots than the equipped baseline ("carry less, die strictly less"), so one
  // certificate can face several budgets. The getter is optional and every
  // non-negative-safe-integer answer counts as unknown: an ungated cache behaves
  // exactly like before, and a dirty value never tightens a search silently.
  const budgetOf = typeof getDeathBudget === 'function' ? getDeathBudget : null;
  // The effective budget of a candidate holding that many slots; undefined means
  // "unknown" and leaves the gate open.
  const budgetFor = (slotCount) => {
    if (!budgetOf) return undefined;
    const value = budgetOf(slotCount);
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  };
  // The evidence a certificate may serve a query holding slotCount slots, or null
  // when it proves nothing under that budget (the caller then has to simulate).
  // A complete feasible run states its own death total, so it is reclassified to
  // the deaths failure instead of being dropped; a truncated run only states that
  // it exceeded its own budget, which keeps the verdict for a query budget no
  // higher, and a mana or cost verdict needs the trajectory to reach its event,
  // which a query budget no lower preserves. The reclassified wrapper is built
  // once per certificate: one trajectory has at most one such form, and repeated
  // queries must not allocate per probe.
  const gatedEvidence = (entry, slotCount) => {
    const budget = budgetFor(slotCount);
    if (budget === undefined) return entry;
    const result = entry.result;
    if (result.feasible === true) {
      if (!Number.isSafeInteger(result.deaths) || result.deaths <= budget) return entry;
      return (entry.deathsEvidence ??= { ...entry, result: { ...result, feasible: false, rejected: 'deaths' } });
    }
    const recorded = entry.budget;
    if (recorded === undefined) return entry;
    if (result.rejected === 'deaths') return budget <= recorded ? entry : null;
    if (result.pruned === 'cost' || result.rejected === 'mana') return budget >= recorded ? entry : null;
    return entry;
  };
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
      // Immutable entry data: every coverage probe tests each food outside the
      // core against this set, so it is built once per record.
      consumedHrids: new Set(core.map((slot) => slot.hrid)),
      minimum: { ...minimum },
      // The budget this verdict was truncated at. A core serves queries whose slot
      // count differs from the recorded candidate's, so the gate has to know which
      // budget the verdict belongs to instead of assuming the query's.
      budget: budgetFor(candidate.slots.length),
      deathsEvidence: null,
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
  // The probed foods are addressed by position so the caller can reuse the
  // query's precomputed subset key instead of hashing hrids per probe.
  const probeCore = (query, first, second, key) => {
    const { domains } = query;
    const group = key === null ? null : coreGroups.get(key);
    if (!group) return null;
    const size = second < 0 ? 1 : 2;
    for (const entry of group) {
      if (entry.core.length !== size) continue;
      const head = entry.core[0];
      const headDomain = domains[first];
      if (
        headDomain.kind !== head.kind ||
        headDomain.hrid !== head.hrid ||
        headDomain.min < head.min ||
        headDomain.max > head.max
      )
        continue;
      if (size === 2) {
        const tail = entry.core[1];
        const tailDomain = domains[second];
        if (
          tailDomain.kind !== tail.kind ||
          tailDomain.hrid !== tail.hrid ||
          tailDomain.min < tail.min ||
          tailDomain.max > tail.max
        )
          continue;
      }
      const consumedHrids = entry.consumedHrids;
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
      if (size === 2) {
        const [left, right] = query.comparisonPair(first, second);
        left.threshold = domains[first].min;
        right.threshold = domains[second].max;
        if (compareFoodSlots(left, right) >= 0) continue;
      }
      // A certificate this query cannot use must not stop the probe: the next
      // entry of the same core group may hold a verdict for this budget.
      if (!gatedEvidence(entry, domains.length)) continue;
      return entry;
    }
    return null;
  };
  // A query may cover at most six ordered cores with the three-slot limit, and
  // the remaining foods must stay inactive, so no linear scan is ever needed.
  const matchConsumedCore = (query) => {
    if (!coreEnabled || (!failureCoreEntries.size && !feasibleCoreEntries.size)) return null;
    const { domains } = query;
    coreProbes += 1;
    const keys = query.subsetKeys();
    const singles = domains.length * domains.length;
    for (let first = 0; first < domains.length; first += 1) {
      const single = probeCore(query, first, -1, keys[singles + first]);
      if (single) {
        coreHits += 1;
        return single;
      }
      for (let second = first + 1; second < domains.length; second += 1) {
        const pair = probeCore(query, first, second, keys[first * domains.length + second]);
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
  // Every probe of one traversal shares the same domains array and only moves its
  // bounds, so the hrids, kinds, restores, prices and recovery durations stay
  // fixed. A query memoizes that invariant half — the composition key, hrid
  // positions, grid items, comparison templates and the core subset keys — and is
  // reused for as long as the slots themselves are untouched. The slot checks
  // below make that reuse safe: a replaced slot or an in-place rewrite of a
  // QUERY_GUARD_FIELDS entry drops the query and builds a new one.
  const createQuery = (domains, { reuse = true } = {}) => {
    const length = domains.length;
    // Only a reused query needs the slot snapshot for its guard: a point query is
    // answered once, so it skips that copy entirely. The snapshot freezes the slot
    // reference and every QUERY_GUARD_FIELDS entry, and queryGuardAccepts compares
    // the same fields by name, so a replaced slot and an in-place rewrite alike
    // drop the query.
    const slots = reuse
      ? Array.from({ length }, (unused, index) => {
          const slot = domains[index];
          const frozen = { ref: slot };
          for (const field of QUERY_GUARD_FIELDS) frozen[field] = slot[field];
          return frozen;
        })
      : null;
    let composition = null;
    let positions = null;
    let items = null;
    let templates = null;
    let subsetKeys = null;
    const query = {
      domains,
      match() {
        return matchDomains(query);
      },
      holds(candidate) {
        return slots !== null && candidate.length === length && queryGuardAccepts(candidate, slots, length);
      },
      composition() {
        return (composition ??= compositionKey(domains));
      },
      positions() {
        if (!positions) {
          positions = new Map();
          for (let index = 0; index < length; index += 1) {
            const hrid = domains[index]?.hrid;
            if (!positions.has(hrid)) positions.set(hrid, index);
          }
        }
        return positions;
      },
      items() {
        return (items ??= grid ? domains.map((domain) => resolveFoodOptimizerGridItem(grid, domain)) : null);
      },
      // comparisonPair returns writable copies of two slots: the caller only ever
      // replaces their thresholds, exactly like the per-probe spreads did. The
      // frozen identity fields above stay valid because QUERY_GUARD_FIELDS has
      // to cover every non-threshold field compareFoodSlots reads, which
      // assertComparatorReadCoverage enforces at import time.
      comparisonPair(previous, current) {
        if (!templates) templates = new Array(length);
        if (!templates[previous]) templates[previous] = { ...domains[previous] };
        if (!templates[current]) templates[current] = { ...domains[current] };
        return [templates[previous], templates[current]];
      },
      subsetKeys() {
        if (!subsetKeys) {
          subsetKeys = new Array(length * length + length).fill(null);
          for (let index = 0; index < length; index += 1) {
            subsetKeys[length * length + index] = coreKeyOf([domains[index].hrid]);
            for (let other = index + 1; other < length; other += 1)
              subsetKeys[index * length + other] = coreKeyOf([domains[index].hrid, domains[other].hrid]);
          }
        }
        return subsetKeys;
      },
    };
    return query;
  };
  // Reused arrays keep their amortized query; a point query is answered once and
  // skips both the guard copy and the bookkeeping.
  const queries = new WeakMap();
  const queryFor = (domains, reuse = true) => {
    if (!reuse) return createQuery(domains, { reuse: false });
    const cached = queries.get(domains);
    if (cached && cached.holds(domains)) return cached;
    const query = createQuery(domains);
    queries.set(domains, query);
    return query;
  };
  const matchDomains = (query) => {
    const { domains } = query;
    // In a no-food run, thresholds above every observed deficit never fire.
    // Adding any number of such foods leaves combat unchanged, in any order.
    // The certificate is gated like every other one: it was recorded from the
    // empty composition, so a query carrying at least as many slots as the
    // baseline may need a verdict its budget never produced. A certificate this
    // query cannot use must not void the query either: the block is still
    // validated against the grid and may be answered by the ranking bound, a
    // same-composition entry or a consumed core, while returning null here would
    // send the whole region back to per-candidate simulation.
    if (unusedFood && domains.every((domain) => domain.min >= unusedFood.result.unusedFoodThresholds[domain.kind])) {
      const evidence = gatedEvidence(unusedFood, domains.length);
      if (evidence) return evidence;
    }
    const gridItems = query.items();
    if (grid && !matchesFoodOptimizerGridItems(gridItems, domains)) return null;
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
    const group = groups.get(query.composition());
    if (group) {
      const positions = query.positions();
      for (const entry of group) {
        if (
          entry.result.pruned === 'cost' &&
          !isFoodOptimizerCostAboveCutoff(entry.result.costLowerBound, getCostCutoff?.())
        )
          continue;
        const ranges = entry.ranges;
        let contained = true;
        for (let index = 0; index < ranges.length; index += 1) {
          const position = positions.get(ranges[index].hrid);
          if (position === undefined) {
            contained = false;
            break;
          }
          const domain = domains[position];
          if (domain.kind !== ranges[index].kind || domain.min < ranges[index].min || domain.max > ranges[index].max) {
            contained = false;
            break;
          }
        }
        if (!contained) continue;
        // The least threshold on the earlier slot must still sort before the
        // greatest threshold on the next slot, including all tie breakers.
        let ordered = true;
        for (let index = 1; index < ranges.length; index += 1) {
          const previous = positions.get(ranges[index - 1].hrid);
          const current = positions.get(ranges[index].hrid);
          const [left, right] = query.comparisonPair(previous, current);
          left.threshold = domains[previous].min;
          right.threshold = domains[current].max;
          if (compareFoodSlots(left, right) >= 0) {
            ordered = false;
            break;
          }
        }
        if (!ordered) continue;
        const evidence = gatedEvidence(entry, domains.length);
        if (evidence) return evidence;
      }
    }
    const core = matchConsumedCore(query);
    if (!core) return null;
    // Cost-pruned cores stay valid only while their recorded lower bound
    // still exceeds the current ranking cutoff, like same-composition ones.
    if (core.result.pruned === 'cost' && !isFoodOptimizerCostAboveCutoff(core.result.costLowerBound, getCostCutoff?.()))
      return null;
    const evidence = gatedEvidence(core, domains.length);
    return evidence && coreEvidence(evidence);
  };
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
          unusedFood = { result, unusedFood: true, budget: budgetFor(0), deathsEvidence: null };
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
        // A group entry only ever answers queries with this exact composition, so
        // its budget is the query's; it is recorded anyway because the gate reads
        // one field for every certificate shape.
        budget: budgetFor(candidate.slots.length),
        deathsEvidence: null,
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
      // A point query is answered once, so it skips the reuse guard.
      return this.matchRanges(
        candidate.slots.map((slot) => ({ ...slot, min: slot.threshold, max: slot.threshold })),
        false,
      );
    },
    matchRanges(domains, reuse = true) {
      return matchDomains(queryFor(domains, reuse));
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

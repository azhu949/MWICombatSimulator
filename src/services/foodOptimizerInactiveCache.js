import { compareFoodSlots, FOOD_OPTIMIZER_MAX_SLOTS } from './foodOptimizerDomain.js';
import { createFoodOptimizerGrid, matchesFoodOptimizerGrid } from './foodOptimizerGrid.js';

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const MAX_THRESHOLD = Number.MAX_SAFE_INTEGER;

export function isValidFoodOptimizerInactiveThresholds(value) {
  return (
    value != null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    ['hp', 'mp'].every((kind) => own(value, kind) && Number.isSafeInteger(value[kind]) && value[kind] >= 1)
  );
}

function isCanonicalCandidate(candidate, grid) {
  const slots = candidate?.slots;
  const food = candidate?.food;
  if (
    !Array.isArray(slots) ||
    !slots.length ||
    slots.length > FOOD_OPTIMIZER_MAX_SLOTS ||
    !Array.isArray(food) ||
    food.length !== slots.length ||
    new Set(food).size !== food.length ||
    !candidate.triggerMap ||
    typeof candidate.triggerMap !== 'object' ||
    Array.isArray(candidate.triggerMap)
  )
    return false;
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (
      !slot ||
      typeof slot.hrid !== 'string' ||
      !slot.hrid ||
      food[index] !== slot.hrid ||
      (slot.kind !== 'hp' && slot.kind !== 'mp') ||
      !Number.isSafeInteger(slot.threshold) ||
      slot.threshold < 1 ||
      !Number.isFinite(slot.restore) ||
      slot.restore <= 0 ||
      !Number.isFinite(slot.price) ||
      slot.price < 0 ||
      (slot.recoveryDuration !== undefined && (!Number.isFinite(slot.recoveryDuration) || slot.recoveryDuration < 0)) ||
      (index > 0 && compareFoodSlots(slots[index - 1], slot) >= 0) ||
      !own(candidate.triggerMap, slot.hrid)
    )
      return false;
    const triggers = candidate.triggerMap[slot.hrid];
    const trigger = triggers?.[0];
    if (
      !Array.isArray(triggers) ||
      triggers.length !== 1 ||
      trigger?.dependencyHrid !== '/combat_trigger_dependencies/self' ||
      trigger.conditionHrid !== `/combat_trigger_conditions/missing_${slot.kind}` ||
      trigger.comparatorHrid !== '/combat_trigger_comparators/greater_than_equal' ||
      trigger.value !== slot.threshold
    )
      return false;
  }
  return (
    !grid ||
    matchesFoodOptimizerGrid(
      grid,
      slots.map((slot) => ({ ...slot, min: slot.threshold, max: slot.threshold })),
    )
  );
}

function readCore(seed, candidate, sample, grid) {
  if (
    !Number.isSafeInteger(seed) ||
    !Number.isSafeInteger(sample?.seed) ||
    sample.seed >>> 0 !== seed >>> 0 ||
    sample.stoppedEarly !== false ||
    sample.ranOutOfMana !== false ||
    !Number.isSafeInteger(sample.deaths) ||
    sample.deaths < 0 ||
    !Number.isFinite(sample.simulatedTime) ||
    sample.simulatedTime <= 0 ||
    !Number.isFinite(sample.costPerHour) ||
    sample.costPerHour < 0 ||
    !isValidFoodOptimizerInactiveThresholds(sample.inactiveFoodThresholds) ||
    !isCanonicalCandidate(candidate, grid)
  )
    return null;
  const counts = sample.foodUsed;
  const ranges = sample.equivalentThresholds;
  if (
    !counts ||
    typeof counts !== 'object' ||
    Array.isArray(counts) ||
    Object.keys(counts).length !== candidate.food.length ||
    !Array.isArray(ranges) ||
    ranges.length !== candidate.slots.length
  )
    return null;
  const core = [];
  for (let index = 0; index < candidate.slots.length; index += 1) {
    const slot = candidate.slots[index];
    const range = ranges[index];
    if (
      !own(counts, slot.hrid) ||
      !Number.isSafeInteger(counts[slot.hrid]) ||
      counts[slot.hrid] < 0 ||
      range?.hrid !== slot.hrid ||
      range.kind !== slot.kind ||
      !Number.isSafeInteger(range.min) ||
      !Number.isSafeInteger(range.max) ||
      range.min < 1 ||
      range.min > slot.threshold ||
      range.max < slot.threshold
    )
      return null;
    if (counts[slot.hrid] > 0)
      core.push({
        hrid: slot.hrid,
        kind: slot.kind,
        restore: slot.restore,
        price: slot.price,
        recoveryDuration: slot.recoveryDuration,
        min: range.min,
        max: range.max,
        count: counts[slot.hrid],
      });
  }
  // An empty core already has the no-food path. A three-food core cannot
  // appear in a different composition under the optimizer's three-slot limit.
  return core.length === 1 || core.length === 2 ? core : null;
}

const sameFood = (left, right) =>
  left.hrid === right.hrid &&
  left.kind === right.kind &&
  left.restore === right.restore &&
  left.price === right.price &&
  left.recoveryDuration === right.recoveryDuration;

function contains(outer, inner) {
  return (
    outer.minimum.hp <= inner.minimum.hp &&
    outer.minimum.mp <= inner.minimum.mp &&
    outer.core.length === inner.core.length &&
    outer.core.every(
      (food, index) =>
        sameFood(food, inner.core[index]) && food.min <= inner.core[index].min && food.max >= inner.core[index].max,
    )
  );
}

// Owned by one seed bucket in a request-scoped round cache. Keep the seed in
// the key as well, so this helper cannot accidentally reuse a different stream.
export function createFoodOptimizerInactiveCache({
  maxEntries = 64,
  items,
  grid = items == null ? null : createFoodOptimizerGrid(items),
} = {}) {
  const groups = new Map();
  const entries = new Set();
  const limit = Math.max(1, Math.min(64, Math.floor(Number(maxEntries) || 1)));
  const keyFor = (seed, core) => `${seed >>> 0}:${JSON.stringify(core.map((slot) => slot.hrid))}`;
  const remove = (entry) => {
    entries.delete(entry);
    const group = groups.get(entry.key);
    group.splice(group.indexOf(entry), 1);
    if (!group.length) groups.delete(entry.key);
  };
  const matchCore = (seed, candidate, core) => {
    for (const entry of groups.get(keyFor(seed, core)) || []) {
      if (
        !core.every(
          (slot, index) =>
            sameFood(slot, entry.core[index]) &&
            slot.threshold >= entry.core[index].min &&
            slot.threshold <= entry.core[index].max,
        ) ||
        candidate.slots.some((slot) => !core.includes(slot) && slot.threshold < entry.minimum[slot.kind])
      )
        continue;
      const byHrid = new Map(entry.core.map((slot) => [slot.hrid, slot]));
      return {
        ...entry.sample,
        seed,
        foodUsed: Object.fromEntries(candidate.food.map((hrid) => [hrid, byHrid.get(hrid)?.count ?? 0])),
        equivalentThresholds: candidate.slots.map(({ hrid, kind }) => {
          const active = byHrid.get(hrid);
          return { hrid, kind, min: active?.min ?? entry.minimum[kind], max: active?.max ?? MAX_THRESHOLD };
        }),
        unusedFoodThresholds: null,
        inactiveFoodThresholds: { ...entry.minimum },
      };
    }
    return null;
  };
  return {
    get size() {
      return entries.size;
    },
    clear() {
      groups.clear();
      entries.clear();
    },
    record(seed, candidate, sample) {
      const core = readCore(seed, candidate, sample, grid);
      if (!core) return;
      const key = keyFor(seed, core);
      const entry = { key, core, minimum: { ...sample.inactiveFoodThresholds }, sample: { ...sample } };
      const previous = groups.get(key) || [];
      if (previous.some((existing) => contains(existing, entry))) return;
      for (const existing of [...previous]) if (contains(entry, existing)) remove(existing);
      const group = groups.get(key) || [];
      group.unshift(entry);
      groups.set(key, group);
      entries.add(entry);
      while (entries.size > limit) remove(entries.values().next().value);
    },
    match(seed, candidate) {
      if (!Number.isSafeInteger(seed) || !isCanonicalCandidate(candidate, grid)) return null;
      // At most six possible ordered cores for a candidate with three slots.
      // Extra inactive foods may sit before, between, or after these core slots.
      for (let first = 0; first < candidate.slots.length; first += 1) {
        const single = matchCore(seed, candidate, [candidate.slots[first]]);
        if (single) return single;
        for (let second = first + 1; second < candidate.slots.length; second += 1) {
          const pair = matchCore(seed, candidate, [candidate.slots[first], candidate.slots[second]]);
          if (pair) return pair;
        }
      }
      return null;
    },
  };
}

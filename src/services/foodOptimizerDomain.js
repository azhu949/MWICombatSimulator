import { foodOptions, itemDetailIndex } from '../shared/gameDataIndex.js';
import { resolveMarketPrice } from './marketPriceService.js';

export const FOOD_OPTIMIZER_DEFAULT_STEP_PERCENT = 10;
export const FOOD_OPTIMIZER_DEFAULT_ROUNDS = 3;
export const FOOD_OPTIMIZER_MIN_STEP_PERCENT = 1;
export const FOOD_OPTIMIZER_MAX_STEP_PERCENT = 100;
export const FOOD_OPTIMIZER_MIN_ROUNDS = 1;
export const FOOD_OPTIMIZER_MAX_ROUNDS = 10;
export const FOOD_OPTIMIZER_MAX_SLOTS = 3;
export const FOOD_OPTIMIZER_SEARCH_MODE_TOP10 = 'top10';
export const FOOD_OPTIMIZER_SEARCH_MODE_COMPLETE = 'complete';

const SELF = '/combat_trigger_dependencies/self';
const MISSING_HP = '/combat_trigger_conditions/missing_hp';
const MISSING_MP = '/combat_trigger_conditions/missing_mp';
const GREATER_THAN_EQUAL = '/combat_trigger_comparators/greater_than_equal';

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeFoodOptimizerSearchMode(value, fallback = FOOD_OPTIMIZER_SEARCH_MODE_COMPLETE) {
  return value === FOOD_OPTIMIZER_SEARCH_MODE_TOP10 || value === FOOD_OPTIMIZER_SEARCH_MODE_COMPLETE ? value : fallback;
}

export function isValidFoodOptimizerSettings({
  thresholdStepPercent,
  rounds,
  searchMode = FOOD_OPTIMIZER_SEARCH_MODE_COMPLETE,
}) {
  return (
    (searchMode === FOOD_OPTIMIZER_SEARCH_MODE_TOP10 || searchMode === FOOD_OPTIMIZER_SEARCH_MODE_COMPLETE) &&
    [thresholdStepPercent, rounds].every((value) => value !== '' && value != null && typeof value !== 'boolean') &&
    Number.isInteger(Number(thresholdStepPercent)) &&
    Number(thresholdStepPercent) >= 1 &&
    Number(thresholdStepPercent) <= 100 &&
    Number.isInteger(Number(rounds)) &&
    Number(rounds) >= 1 &&
    Number(rounds) <= 10
  );
}

export function normalizeFoodOptimizerStep(value, fallback = FOOD_OPTIMIZER_DEFAULT_STEP_PERCENT) {
  return isValidFoodOptimizerSettings({ thresholdStepPercent: value, rounds: 1 }) ? Number(value) : fallback;
}

export function normalizeFoodOptimizerRounds(value, fallback = FOOD_OPTIMIZER_DEFAULT_ROUNDS) {
  return isValidFoodOptimizerSettings({ thresholdStepPercent: 10, rounds: value }) ? Number(value) : fallback;
}

export function getFoodRestore(foodHrid) {
  const item = itemDetailIndex?.[String(foodHrid || '')] || {};
  return {
    hp: Math.max(0, finite(item.hitpointRestore)),
    mp: Math.max(0, finite(item.manapointRestore)),
    recoveryDuration: Math.max(0, finite(item.recoveryDuration)),
  };
}

export function buildFoodThresholds({
  maxHp,
  maxMp,
  thresholdStepPercent = FOOD_OPTIMIZER_DEFAULT_STEP_PERCENT,
  foodHrid,
  restoreAmount,
}) {
  if (!isValidFoodOptimizerSettings({ thresholdStepPercent, rounds: 1 }))
    throw new RangeError('Invalid threshold step.');
  const step = normalizeFoodOptimizerStep(thresholdStepPercent);
  const rawMax = getFoodRestore(foodHrid).mp > 0 ? finite(maxMp, 1) : finite(maxHp, 1);
  const maxResource = Math.max(1, Math.floor(rawMax));
  const restore = getFoodRestore(foodHrid);
  const thresholds = new Set([maxResource]);
  for (let percent = step; percent < 100; percent += step) {
    thresholds.add(Math.max(1, Math.min(maxResource, Math.ceil((rawMax * percent) / 100))));
  }
  const restoreThreshold = restoreAmount ?? (restore.mp > 0 ? restore.mp : restore.hp);
  if (restoreThreshold > 0) {
    thresholds.add(Math.max(1, Math.min(maxResource, Math.ceil(restoreThreshold))));
  }
  return Array.from(thresholds).sort((a, b) => b - a);
}

// 可参与搜索的食物目录（保留目录顺序）。getFoodOptimizerItems 只产出 HP/MP
// 恢复量大于零的条目，选择弹窗与归一化必须使用同一份口径，否则“全选”无法
// 与默认的全部食物等价。
export function getFoodOptimizerCatalogHrids() {
  return foodOptions
    .map((option) => String(option?.hrid || ''))
    .filter((hrid) => {
      const restore = getFoodRestore(hrid);
      return Boolean(hrid) && (restore.hp > 0 || restore.mp > 0);
    });
}

// 食物范围只保存“排除了一部分食物”的子集：null 表示全部（默认），显式数组
// 按目录顺序去重、丢弃未知 hrid；空集合或覆盖全部目录同样归一化为 null，
// 使“未勾选任何食物”这类无效输入回退到默认范围而不是产出空域。
export function normalizeFoodOptimizerFoodHrids(value) {
  const catalog = getFoodOptimizerCatalogHrids();
  if (!Array.isArray(value) || catalog.length === 0) return null;
  const allowed = new Set(catalog);
  const picked = new Set();
  for (const hrid of value) {
    const normalized = String(hrid ?? '');
    if (allowed.has(normalized)) picked.add(normalized);
  }
  if (picked.size === 0 || picked.size >= catalog.length) return null;
  return catalog.filter((hrid) => picked.has(hrid));
}

export function getFoodOptimizerItems({ maxHp, maxMp, thresholdStepPercent, prices, consumableMode, hrids } = {}) {
  // 范围与归一化使用同一语义：null/非数组/空数组都表示全部食物。
  const scope = Array.isArray(hrids) && hrids.length > 0 ? new Set(hrids.map((hrid) => String(hrid ?? ''))) : null;
  return foodOptions
    .map((option) => {
      const hrid = String(option?.hrid || '');
      const restore = getFoodRestore(hrid);
      const kind = restore.mp > 0 ? 'mp' : restore.hp > 0 ? 'hp' : '';
      if (!hrid || !kind) return null;
      const thresholds = buildFoodThresholds({ maxHp, maxMp, thresholdStepPercent, foodHrid: hrid });
      return {
        hrid,
        name: String(option?.name || hrid),
        itemLevel: finite(option?.itemLevel),
        kind,
        restore: kind === 'mp' ? restore.mp : restore.hp,
        recoveryDuration: restore.recoveryDuration,
        thresholds,
        price: Math.max(0, finite(resolveMarketPrice(prices, hrid, consumableMode))),
      };
    })
    .filter(Boolean)
    .filter((item) => !scope || scope.has(item.hrid));
}

export function compareFoodSlots(left, right) {
  const leftMp = left.kind === 'mp' ? 0 : 1;
  const rightMp = right.kind === 'mp' ? 0 : 1;
  return (
    leftMp - rightMp ||
    Number(right.threshold) - Number(left.threshold) ||
    Number(right.restore) - Number(left.restore) ||
    Number(left.price) - Number(right.price) ||
    (left.hrid < right.hrid ? -1 : left.hrid > right.hrid ? 1 : 0)
  );
}

export function buildFoodTrigger(food) {
  const conditionHrid = food.kind === 'mp' ? MISSING_MP : MISSING_HP;
  return [
    {
      dependencyHrid: SELF,
      conditionHrid,
      comparatorHrid: GREATER_THAN_EQUAL,
      value: Math.max(1, Math.ceil(finite(food.threshold, 1))),
    },
  ];
}

export function buildFoodCandidate(items = []) {
  const slots = items.map(({ thresholds, ...item }) => item).sort(compareFoodSlots);
  return {
    slots,
    food: slots.map((entry) => entry.hrid),
    triggerMap: Object.fromEntries(slots.map((entry) => [entry.hrid, buildFoodTrigger(entry)])),
    signature: slots.map((entry) => `${entry.hrid}@${entry.kind}:${entry.threshold}`).join('|'),
  };
}

export function hasEmptyFoodOptimizerBaseline(request) {
  const food = request?.payload?.players?.find((player) => player.hrid === `player${request.activePlayerId}`)?.food;
  return Array.isArray(food) && food.every((item) => !item);
}

export function buildFoodDefaultCandidate(items = []) {
  return buildFoodCandidate(
    items.map((item) => {
      const requested = Math.max(1, Math.ceil(Number(item.restore) || 1));
      const thresholds = Array.isArray(item.thresholds) ? item.thresholds : [];
      // The own-restore value is always in the catalog, except when it is above
      // the initialized resource cap, in which case the catalog contains the cap.
      const threshold = thresholds.length ? Math.min(Math.max(...thresholds), requested) : requested;
      return { ...item, threshold };
    }),
  );
}

export function countFoodOptimizerCompositions(items, slotLimit = FOOD_OPTIMIZER_MAX_SLOTS) {
  const slots = Math.max(0, Math.min(FOOD_OPTIMIZER_MAX_SLOTS, Math.floor(finite(slotLimit))));
  const dp = Array(slots + 1).fill(0);
  dp[0] = 1;
  for (const item of items || []) {
    if (!item?.thresholds?.length) continue;
    for (let used = slots; used >= 1; used -= 1) dp[used] += dp[used - 1];
  }
  return dp.reduce((total, value) => total + value, 0);
}

export function* generateFoodOptimizerCompositionItems(items, slotLimit = FOOD_OPTIMIZER_MAX_SLOTS) {
  const normalizedItems = Array.isArray(items) ? items.filter((item) => item?.thresholds?.length) : [];
  const limit = Math.max(0, Math.min(FOOD_OPTIMIZER_MAX_SLOTS, Math.floor(finite(slotLimit))));
  const picked = [];
  function* visit(index) {
    yield picked.slice();
    if (picked.length >= limit) return;
    for (let next = index; next < normalizedItems.length; next += 1) {
      picked.push(normalizedItems[next]);
      yield* visit(next + 1);
      picked.pop();
    }
  }
  yield* visit(0);
}

export function* generateFoodOptimizerCompositionCandidates(items = []) {
  const picked = [];
  function* visit(slot) {
    if (slot === items.length) {
      yield buildFoodCandidate(picked);
      return;
    }
    for (const threshold of items[slot].thresholds || []) {
      picked[slot] = { ...items[slot], threshold };
      yield* visit(slot + 1);
    }
  }
  yield* visit(0);
}

export function countFoodOptimizerCandidates(items, slotLimit = FOOD_OPTIMIZER_MAX_SLOTS) {
  const slots = Math.max(0, Math.min(FOOD_OPTIMIZER_MAX_SLOTS, Math.floor(finite(slotLimit))));
  // Coefficients of product(1 + thresholdCount * x), retaining only up to three slots.
  const dp = Array(slots + 1).fill(0);
  dp[0] = 1;
  for (const item of items || []) {
    const choices = Array.isArray(item?.thresholds) ? item.thresholds.length : 0;
    for (let used = slots; used >= 1; used -= 1) dp[used] += dp[used - 1] * choices;
  }
  return dp.reduce((total, value) => total + value, 0);
}

export function* generateFoodOptimizerCandidates(items, slotLimit = FOOD_OPTIMIZER_MAX_SLOTS) {
  for (const composition of generateFoodOptimizerCompositionItems(items, slotLimit))
    yield* generateFoodOptimizerCompositionCandidates(composition);
}

export function createFoodOptimizerInputSignature(input) {
  function ordered(value) {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, ordered(value[key])]),
      );
    return value;
  }
  return JSON.stringify(ordered(input));
}

export function computeFoodCostPerHour(consumablesUsed, priceTable, consumableMode, simulatedTime) {
  const hours = finite(simulatedTime) / 3_600_000_000_000;
  if (hours <= 0) throw new RangeError('Invalid simulation duration.');
  let total = 0;
  for (const [hrid, count] of Object.entries(consumablesUsed || {})) {
    if (itemDetailIndex[hrid]?.categoryHrid !== '/item_categories/food') continue;
    total += Math.max(0, finite(count)) * Math.max(0, finite(resolveMarketPrice(priceTable, hrid, consumableMode)));
  }
  return total / hours;
}

export function compareFoodOptimizerResults(a, b) {
  return (
    a.costPerHour - b.costPerHour ||
    a.deaths - b.deaths ||
    a.slots.length - b.slots.length ||
    (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0)
  );
}

export function* batchFoodOptimizerCandidates(iterator, batchSize = 16) {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new RangeError('Invalid batch size.');
  let batch = [];
  for (const candidate of iterator) {
    batch.push(candidate);
    if (batch.length === batchSize) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length) yield batch;
}

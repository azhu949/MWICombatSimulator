import { foodOptions, itemDetailIndex } from '../shared/gameDataIndex.js';
import { resolveMarketPrice } from './marketPriceService.js';

export const FOOD_OPTIMIZER_DEFAULT_STEP_PERCENT = 10;
// 重复次数默认值与兜底值的唯一来源，刻意兼任两个角色：①“首次使用/字段缺失”的产品
// 默认值；②非法或损坏存储值的回落值（normalizeFoodOptimizerRounds 的默认参数，见
// simulatorStorage.js）。共用一个数字是契约而非巧合——脏数据跟随产品默认，不另设
// 第二个魔法数；改这里等于同时改“脏数据兜底”。它同时决定结论强度：rounds=1 时
// feasible 与排名只由单一种子证明，跨轮成本下界剪枝也被 round + 1 < request.rounds
// 守卫挡在末轮（只剩轮内早期停止）；UI 侧用 foodOptimizer.roundsHint 披露该口径。
export const FOOD_OPTIMIZER_DEFAULT_ROUNDS = 1;
// 步长与轮次的合法区间：这四个常量是唯一来源——isValidFoodOptimizerSettings 直接
// 引用它们，页面输入框的 min/max 也绑定到它们；两条 invalidSettings 文案（zh/en）
// 内嵌同样的数字，由 i18nResources.test.js 逐语言核对常量与文案一致。
export const FOOD_OPTIMIZER_MIN_STEP_PERCENT = 1;
export const FOOD_OPTIMIZER_MAX_STEP_PERCENT = 100;
export const FOOD_OPTIMIZER_MIN_ROUNDS = 1;
export const FOOD_OPTIMIZER_MAX_ROUNDS = 10;
export const FOOD_OPTIMIZER_MAX_SLOTS = 3;
export const FOOD_OPTIMIZER_SEARCH_MODE_TOP10 = 'top10';
export const FOOD_OPTIMIZER_SEARCH_MODE_COMPLETE = 'complete';
// 引擎请求层对缺失 searchMode 的容错口径：一律按“完整搜索”执行——缺失或非法的输入
// 绝不静默启用裁剪。它与用户设置层的缺省（top10，见 normalizeFoodOptimizerSearchMode
// 的默认参数）是刻意区分的两个概念，不要互相合并。
export const FOOD_OPTIMIZER_ENGINE_SEARCH_MODE_FALLBACK = FOOD_OPTIMIZER_SEARCH_MODE_COMPLETE;

const SELF = '/combat_trigger_dependencies/self';
const MISSING_HP = '/combat_trigger_conditions/missing_hp';
const MISSING_MP = '/combat_trigger_conditions/missing_mp';
const GREATER_THAN_EQUAL = '/combat_trigger_comparators/greater_than_equal';

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeFoodOptimizerSearchMode(value, fallback = FOOD_OPTIMIZER_SEARCH_MODE_TOP10) {
  return value === FOOD_OPTIMIZER_SEARCH_MODE_TOP10 || value === FOOD_OPTIMIZER_SEARCH_MODE_COMPLETE ? value : fallback;
}

// 引擎请求 searchMode 的唯一解析入口：合法值原样返回，缺失/非法回落到“完整搜索”。
export function resolveFoodOptimizerRequestSearchMode(value) {
  return normalizeFoodOptimizerSearchMode(value, FOOD_OPTIMIZER_ENGINE_SEARCH_MODE_FALLBACK);
}

// 引擎各处只通过它判断是否启用前十模式，避免再出现散落的字面量比较。
export function isFoodOptimizerTopTenRequest(request) {
  return resolveFoodOptimizerRequestSearchMode(request?.searchMode) === FOOD_OPTIMIZER_SEARCH_MODE_TOP10;
}

// 「排除有死亡的方案」开关的归一化：只有显式 true 才算启用。设置层与引擎层共用同一个回落
// （false）——缺失或脏值绝不静默加严搜索，与 searchMode「缺失绝不启用裁剪」同一原则。
export function normalizeFoodOptimizerZeroDeaths(value) {
  return value === true;
}

// 引擎各处只通过它判断是否启用“排除有死亡的方案”，避免散落的真值比较。
export function isFoodOptimizerZeroDeathsRequest(request) {
  return normalizeFoodOptimizerZeroDeaths(request?.requireZeroDeaths);
}

export function isValidFoodOptimizerSettings({ thresholdStepPercent, rounds, searchMode, requireZeroDeaths }) {
  return (
    // 只校验显式给出的 searchMode：省略（undefined）表示调用方只关心步长与轮次。
    // 缺省语义不在这里定义——设置层与引擎请求层各有自己的解析入口与命名常量。
    (searchMode === undefined ||
      searchMode === FOOD_OPTIMIZER_SEARCH_MODE_TOP10 ||
      searchMode === FOOD_OPTIMIZER_SEARCH_MODE_COMPLETE) &&
    // 同上：只校验显式给出的开关，省略表示调用方不关心它。
    (requireZeroDeaths === undefined || typeof requireZeroDeaths === 'boolean') &&
    [thresholdStepPercent, rounds].every((value) => value !== '' && value != null && typeof value !== 'boolean') &&
    Number.isInteger(Number(thresholdStepPercent)) &&
    Number(thresholdStepPercent) >= FOOD_OPTIMIZER_MIN_STEP_PERCENT &&
    Number(thresholdStepPercent) <= FOOD_OPTIMIZER_MAX_STEP_PERCENT &&
    Number.isInteger(Number(rounds)) &&
    Number(rounds) >= FOOD_OPTIMIZER_MIN_ROUNDS &&
    Number(rounds) <= FOOD_OPTIMIZER_MAX_ROUNDS
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
  // 这里的 100 是百分比刻度上限（percent 的量程），与 FOOD_OPTIMIZER_MAX_STEP_PERCENT
  // （步长本身的上界）无关，不要合并成同一个常量。
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

// 食物范围持久化：null 表示“未保存范围”（新用户，由快照层解析为当前佩戴
// 食物），显式数组按目录顺序去重、丢弃未知 hrid。空集合归一化为 null（无效
// 输入不产出空域）；覆盖全部目录保留显式完整数组——默认范围不再等价于“全部
// 食物”，折叠会让用户确认过的全选在下次打开时被静默改回装备默认。
export function normalizeFoodOptimizerFoodHrids(value) {
  const catalog = getFoodOptimizerCatalogHrids();
  if (!Array.isArray(value) || catalog.length === 0) return null;
  const allowed = new Set(catalog);
  const picked = new Set();
  for (const hrid of value) {
    const normalized = String(hrid ?? '');
    if (allowed.has(normalized)) picked.add(normalized);
  }
  if (picked.size === 0) return null;
  return catalog.filter((hrid) => picked.has(hrid));
}

export function getFoodOptimizerItems({ maxHp, maxMp, thresholdStepPercent, prices, consumableMode, hrids } = {}) {
  // 引擎口径：null/非数组/空数组都表示全部食物（“未保存范围”的装备默认由快照层解析）。
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

// Strict total order over consumed slots: kind, threshold, restore, price and
// hrid, with no tie breakers left. The threshold is read from the slot itself
// because callers that compare candidates rewrite it in place; the other fields
// (kind, restore, price, hrid) are mirrored by QUERY_GUARD_FIELDS
// (foodOptimizerPruning.js), whose memoized comparison templates rewrite only
// the threshold after the first copy. Add any new non-threshold field read here
// to that list as well, or the replaced template would feed this comparator a
// stale value and corrupt the pruning answer silently;
// assertComparatorReadCoverage (foodOptimizerPruning.js) fails the import as
// soon as the two drift apart.
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

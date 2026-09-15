import { foodOptions, GAME_DATA_VERSION, itemDetailIndex, skillingData } from '../shared/gameDataIndex.js';
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

// 基线携带的食物槽位数（非空槽计数）。食物数组不是数组（快照缺失或脏值）时返回 null，
// 调用方据此失败开放——槽位数不可判绝不静默加严搜索，与「缺失/非法不启用裁剪」同源。
export function resolveFoodOptimizerBaselineSlotCount(request) {
  const food = request?.payload?.players?.find((player) => player.hrid === `player${request.activePlayerId}`)?.food;
  return Array.isArray(food) ? food.filter(Boolean).length : null;
}

// 候选的死亡预算（槽位感知）：槽位少于基线携带槽位数说明玩家要放弃一件食物，必须换来
// 「严格更少死」，因此预算比基线累计死亡少一；槽位数持平或更多时保持原口径（允许并列，
// 不高于基线即可）。基线的空槽方案也算「少带」，同样按 -1 处理——它就是最典型的少带。
//
// 失败开放：预算或槽位数不是非负安全整数时原样返回（不加严）。脏值只可能让候选的准入
// 条件与原口径一致，绝不会把候选误判成「必须更少死」，与仓库既有「脏值绝不静默加严」
// 的原则一致。
export function resolveFoodOptimizerCandidateDeathBudget(baseBudget, candidateSlotCount, baselineSlotCount) {
  if (!Number.isSafeInteger(baseBudget) || baseBudget < 0) return baseBudget;
  if (!Number.isSafeInteger(baselineSlotCount) || baselineSlotCount < 0) return baseBudget;
  if (!Number.isSafeInteger(candidateSlotCount) || candidateSlotCount < 0) return baseBudget;
  return candidateSlotCount < baselineSlotCount ? Math.max(0, baseBudget - 1) : baseBudget;
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

// 「同类食物」＝同一条烹饪线：游戏里每个槽位可以各自放一件任意食物，但优化器把
// 同一条线的所有等级变体视为一类，一个候选方案里每类最多占一个槽位（用户口径：
// 软糖家族整体只能装备 1 格，不能三格都带软糖线）。
//
// 族键直接取游戏官方的烹饪分类（cooking 动作的 action category，如 instant_heal /
// heal_over_time / instant_mana / mana_over_time），族键字符串内嵌完整 category。
// 分类索引来自 skillingData.actions（type=/action_types/cooking）的 outputItems：
// 食物产物 → 生产它的烹饪动作的 category。当前 28 件食物全部反查到唯一分类、零冲突，
// 且四条分类线与四条恢复线一一对应（crate 的 outputItems 是 crate 自身、食物在其
// inputItems，不会污染映射）。之所以不由物品的恢复属性反推（资源 HP/MP × 是否持续
// recoveryDuration > 0）：机制组合只有四种，任何新增烹饪线必然与既有线之一同机制，
// 会被静默并入同族，让「新线 + 旧线」的合法组合不再被枚举（漏解）——这类过度合并
// 必须显式暴露：实现偏离官方分类时由逐条等式拦住，官方数据自身合并/拆分时逐条等式
// 自洽、只有目录守卫的冻结分区比对能拦住（见 foodOptimizerDomain.test.js 的
// FROZEN_FOOD_FAMILIES）。官方分类是游戏数据对「线」的显式定义：新分类自动成为
// 新族并参与互斥，官方把新线并入既有分类时优化器与官方语义保持一致。
// 之所以不按尾缀/白名单判定：命名是脆弱的启发式（cupcake 就不带 _cake 尾缀，只为
// 它维护过一条别名），游戏新增线时命名未知，白名单会静默漏掉新线、让同类约束失效。
//
// 无法判定（不在索引、分类缺失或同一产物出现在多个分类）的 hrid（测试桩、脏值）
// 自成一类，且 unknown: 前缀与分类键域隔离——绝不与已知类互斥，遵循「未知输入不
// 静默加严搜索」的仓库原则：脏值只会让约束退化为旧行为（各自独立），不会误伤合法
// 组合。
//
// 目录中的真实食物必须全部可归入唯一官方分类。数据更新引入无法归类的食物时，由
// foodOptimizerDomain.test.js 的目录全量归族守卫用例（真实目录）与
// foodOptimizerFamilyFallback.test.js 的合成形态用例（分类冲突/缺失）显式失败并
// 列出未归类食物，而不是静默放过。守卫用例同时把「官方分类 → 目录成员」分区冻结成
// FROZEN_FOOD_FAMILIES：官方数据合并两条线、拆分一条线或在既有类之间挪动变体时，
// 逐条等式仍会自洽通过，族键集合与族数这类弱检查也拦不住（挪动连族键集合都不变），
// 只有分区比对能拦住——必须先复核官方数据、再更新冻结表，不允许让「同类最多占一个
// 槽位」静默变松或变严。
//
// 分类索引按 GAME_DATA_VERSION 记忆化：共享索引热重载（版本变化）后自动重建，
// 与 advisorDropItems.js 等消费方的既有失效模式一致。
let foodFamilyByHridCache = null;
let foodFamilyByHridVersion = '';
function getFoodFamilyByHrid() {
  if (foodFamilyByHridCache && foodFamilyByHridVersion === GAME_DATA_VERSION) return foodFamilyByHridCache;
  const families = new Map();
  const conflicted = new Set();
  for (const action of skillingData?.actions || []) {
    if (String(action?.type || '') !== '/action_types/cooking') continue;
    const category = String(action?.category || '');
    if (!category) continue;
    for (const output of action.outputItems || []) {
      const itemHrid = String(output?.itemHrid || '');
      if (!itemHrid || conflicted.has(itemHrid)) continue;
      const existing = families.get(itemHrid);
      if (existing === undefined) families.set(itemHrid, category);
      else if (existing !== category) {
        // 同一产物被多个分类的烹饪动作输出：归属无法判定，自成一类（fail-open），
        // 绝不静默挑一条线合并；目录守卫会把该冲突显式暴露出来。
        families.delete(itemHrid);
        conflicted.add(itemHrid);
      }
    }
  }
  foodFamilyByHridCache = families;
  foodFamilyByHridVersion = GAME_DATA_VERSION;
  return families;
}

export function getFoodOptimizerFamilyKey(hrid) {
  const key = String(hrid ?? '');
  const category = getFoodFamilyByHrid().get(key);
  return category ? `food-family:${category}` : `food-family:unknown:${key.replace(/^\/items\//, '')}`;
}

export function countFoodOptimizerCompositions(items, slotLimit = FOOD_OPTIMIZER_MAX_SLOTS) {
  const slots = Math.max(0, Math.min(FOOD_OPTIMIZER_MAX_SLOTS, Math.floor(finite(slotLimit))));
  // 每类最多选 1 件 ⇒ 每类对组合数的贡献是因子 (1 + size·x)。按类聚合后做同一
  // 个「选 0 或 1」背包 DP，与 generateFoodOptimizerCompositionItems 逐类互斥的
  // 枚举严格一致（既有测试逐槽位对照枚举数校验这条一致性）。
  const familySizes = new Map();
  for (const item of items || []) {
    if (!item?.thresholds?.length) continue;
    const family = getFoodOptimizerFamilyKey(item.hrid);
    familySizes.set(family, (familySizes.get(family) || 0) + 1);
  }
  const dp = Array(slots + 1).fill(0);
  dp[0] = 1;
  for (const size of familySizes.values()) for (let used = slots; used >= 1; used -= 1) dp[used] += dp[used - 1] * size;
  return dp.reduce((total, value) => total + value, 0);
}

export function* generateFoodOptimizerCompositionItems(items, slotLimit = FOOD_OPTIMIZER_MAX_SLOTS) {
  const normalizedItems = Array.isArray(items) ? items.filter((item) => item?.thresholds?.length) : [];
  const limit = Math.max(0, Math.min(FOOD_OPTIMIZER_MAX_SLOTS, Math.floor(finite(slotLimit))));
  const picked = [];
  const pickedFamilies = new Set();
  function* visit(index) {
    yield picked.slice();
    if (picked.length >= limit) return;
    for (let next = index; next < normalizedItems.length; next += 1) {
      const family = getFoodOptimizerFamilyKey(normalizedItems[next].hrid);
      if (pickedFamilies.has(family)) continue;
      picked.push(normalizedItems[next]);
      pickedFamilies.add(family);
      yield* visit(next + 1);
      picked.pop();
      pickedFamilies.delete(family);
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
  // 与组合枚举同一条「每类最多 1 件」约束：每类的因子是 (1 + T_f·x)，其中
  // T_f = 该类全体成员的档位数之和（选中该类时任取一个成员再任取一个档位）。
  // 按类聚合后逐类做「选 0 或 1」背包 DP，与 countFoodOptimizerCompositions
  // （size·x 因子）共用同一骨架，只差每类的权重来源。
  const familyChoices = new Map();
  for (const item of items || []) {
    if (!item?.thresholds?.length) continue;
    const family = getFoodOptimizerFamilyKey(item.hrid);
    familyChoices.set(family, (familyChoices.get(family) || 0) + item.thresholds.length);
  }
  const dp = Array(slots + 1).fill(0);
  dp[0] = 1;
  for (const choices of familyChoices.values())
    for (let used = slots; used >= 1; used -= 1) dp[used] += dp[used - 1] * choices;
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

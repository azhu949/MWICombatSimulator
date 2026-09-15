import { describe, expect, it } from 'vitest';
import {
  FOOD_OPTIMIZER_DEFAULT_ROUNDS,
  FOOD_OPTIMIZER_MAX_ROUNDS,
  FOOD_OPTIMIZER_MAX_STEP_PERCENT,
  FOOD_OPTIMIZER_MIN_ROUNDS,
  FOOD_OPTIMIZER_MIN_STEP_PERCENT,
  batchFoodOptimizerCandidates,
  buildFoodCandidate,
  buildFoodDefaultCandidate,
  buildFoodThresholds,
  compareFoodOptimizerResults,
  computeFoodCostPerHour,
  countFoodOptimizerCandidates,
  countFoodOptimizerCompositions,
  generateFoodOptimizerCompositionItems,
  generateFoodOptimizerCompositionCandidates,
  generateFoodOptimizerCandidates,
  getFoodOptimizerCatalogHrids,
  getFoodOptimizerFamilyKey,
  getFoodOptimizerItems,
  hasEmptyFoodOptimizerBaseline,
  isValidFoodOptimizerSettings,
  isFoodOptimizerTopTenRequest,
  isFoodOptimizerZeroDeathsRequest,
  normalizeFoodOptimizerFoodHrids,
  normalizeFoodOptimizerRounds,
  normalizeFoodOptimizerSearchMode,
  normalizeFoodOptimizerZeroDeaths,
  resolveFoodOptimizerBaselineSlotCount,
  resolveFoodOptimizerCandidateDeathBudget,
  resolveFoodOptimizerRequestSearchMode,
} from '../foodOptimizerDomain.js';
import { foodOptions, skillingData } from '../../shared/gameDataIndex.js';
import { sanitizeTriggerList } from '../triggerMapper.js';

describe('food optimizer thresholds and candidates', () => {
  it('defaults to exact top 10 for callers that omit the search mode', () => {
    expect(normalizeFoodOptimizerSearchMode()).toBe('top10');
    expect(normalizeFoodOptimizerSearchMode('nonsense')).toBe('top10');
    expect(isValidFoodOptimizerSettings({ thresholdStepPercent: 10, rounds: 3 })).toBe(true);
    expect(isValidFoodOptimizerSettings({ thresholdStepPercent: 10, rounds: 3, searchMode: undefined })).toBe(true);
  });

  // 引擎请求层的缺省与设置层刻意不同：缺失/非法一律解析为“完整搜索”，绝不静默启用裁剪。
  it('resolves an omitted or invalid request mode to the complete engine fallback', () => {
    expect(resolveFoodOptimizerRequestSearchMode(undefined)).toBe('complete');
    expect(resolveFoodOptimizerRequestSearchMode('nonsense')).toBe('complete');
    expect(resolveFoodOptimizerRequestSearchMode('top10')).toBe('top10');
    expect(resolveFoodOptimizerRequestSearchMode('complete')).toBe('complete');
    expect(isFoodOptimizerTopTenRequest({ searchMode: 'top10' })).toBe(true);
    expect(isFoodOptimizerTopTenRequest({ searchMode: 'complete' })).toBe(false);
    expect(isFoodOptimizerTopTenRequest({})).toBe(false);
    expect(isFoodOptimizerTopTenRequest(null)).toBe(false);
  });

  // 「排除有死亡的方案」只有显式 true 才生效：设置层与引擎层的缺失/脏值回落都是 false
  // （不静默给搜索加严条件），与上面 searchMode「缺失绝不启用裁剪」同一条原则。
  it('treats only an explicit true as the forced zero-death switch', () => {
    expect(normalizeFoodOptimizerZeroDeaths(true)).toBe(true);
    expect(normalizeFoodOptimizerZeroDeaths(false)).toBe(false);
    for (const value of [undefined, null, '', 0, 1, 'true', {}, []])
      expect(normalizeFoodOptimizerZeroDeaths(value)).toBe(false);
    expect(isFoodOptimizerZeroDeathsRequest({ requireZeroDeaths: true })).toBe(true);
    expect(isFoodOptimizerZeroDeathsRequest({ requireZeroDeaths: false })).toBe(false);
    expect(isFoodOptimizerZeroDeathsRequest({})).toBe(false);
    expect(isFoodOptimizerZeroDeathsRequest(null)).toBe(false);
    // 与 searchMode 一样只校验显式给出的那一份：省略表示调用方不关心该开关。
    expect(isValidFoodOptimizerSettings({ thresholdStepPercent: 10, rounds: 3, requireZeroDeaths: true })).toBe(true);
    expect(isValidFoodOptimizerSettings({ thresholdStepPercent: 10, rounds: 3, requireZeroDeaths: false })).toBe(true);
    expect(isValidFoodOptimizerSettings({ thresholdStepPercent: 10, rounds: 3, requireZeroDeaths: 'yes' })).toBe(false);
  });

  // 与 searchMode 相反，重复次数的“产品默认”与“非法值回落”刻意共用同一个常量：
  // 脏数据跟随产品默认，不引入第二个魔法数。回落关系用常量（而非字面量）钉住，
  // 有人拆成两个数字时会立刻失败；产品默认值本身仍由字面量 1 显式钉住。
  // 该常量同时就是结论强度：轮次越少，可行性与成本越依赖单次抽样。
  it('recovers every invalid rounds value with the single shared default', () => {
    expect(FOOD_OPTIMIZER_DEFAULT_ROUNDS).toBe(1);
    // 非法值覆盖“低于下界 / 高于上界 / 非整数 / 非数值”四类；上下界用常量相对表示，
    // 具体数值由下一条用例（边界契约）钉住，避免这里再藏一份 11/0 的隐式耦合。
    for (const value of [
      undefined,
      null,
      '',
      FOOD_OPTIMIZER_MIN_ROUNDS - 1,
      FOOD_OPTIMIZER_MAX_ROUNDS + 1,
      1.5,
      NaN,
      Infinity,
      'nonsense',
      true,
      false,
    ])
      expect(normalizeFoodOptimizerRounds(value)).toBe(FOOD_OPTIMIZER_DEFAULT_ROUNDS);
    // 区间内的数字字符串照旧接受（相对上界取值，避免写死 7）。
    expect(normalizeFoodOptimizerRounds(String(FOOD_OPTIMIZER_MAX_ROUNDS))).toBe(FOOD_OPTIMIZER_MAX_ROUNDS);
    expect(normalizeFoodOptimizerRounds(FOOD_OPTIMIZER_DEFAULT_ROUNDS)).toBe(FOOD_OPTIMIZER_DEFAULT_ROUNDS);
  });

  // 合法区间来自域常量、且被 isValidFoodOptimizerSettings 直接引用：把边界值与常量绑定，
  // 改常量而不改测试/页面 min-max/invalidSettings 文案就会失败。
  it('derives the validation bounds from the shared range constants', () => {
    expect([
      FOOD_OPTIMIZER_MIN_STEP_PERCENT,
      FOOD_OPTIMIZER_MAX_STEP_PERCENT,
      FOOD_OPTIMIZER_MIN_ROUNDS,
      FOOD_OPTIMIZER_MAX_ROUNDS,
    ]).toEqual([1, 100, 1, 10]);
    for (const step of [FOOD_OPTIMIZER_MIN_STEP_PERCENT, FOOD_OPTIMIZER_MAX_STEP_PERCENT])
      expect(isValidFoodOptimizerSettings({ thresholdStepPercent: step, rounds: FOOD_OPTIMIZER_MIN_ROUNDS })).toBe(
        true,
      );
    for (const step of [FOOD_OPTIMIZER_MIN_STEP_PERCENT - 1, FOOD_OPTIMIZER_MAX_STEP_PERCENT + 1])
      expect(isValidFoodOptimizerSettings({ thresholdStepPercent: step, rounds: 3 })).toBe(false);
    for (const rounds of [FOOD_OPTIMIZER_MIN_ROUNDS, FOOD_OPTIMIZER_MAX_ROUNDS])
      expect(isValidFoodOptimizerSettings({ thresholdStepPercent: 10, rounds })).toBe(true);
    for (const rounds of [FOOD_OPTIMIZER_MIN_ROUNDS - 1, FOOD_OPTIMIZER_MAX_ROUNDS + 1])
      expect(isValidFoodOptimizerSettings({ thresholdStepPercent: 10, rounds })).toBe(false);
  });

  it.each(['top10', 'complete'])('accepts search mode %s', (searchMode) => {
    expect(normalizeFoodOptimizerSearchMode(searchMode)).toBe(searchMode);
    expect(isValidFoodOptimizerSettings({ thresholdStepPercent: 10, rounds: 3, searchMode })).toBe(true);
  });

  it.each(['approximate', '', null, false, 10])('rejects an explicit invalid search mode %s', (searchMode) => {
    expect(isValidFoodOptimizerSettings({ thresholdStepPercent: 10, rounds: 3, searchMode })).toBe(false);
  });

  it.each([1, 10, 15, 25, 100])('includes the complete percentage grid and own restore amount for %i%%', (step) => {
    const values = buildFoodThresholds({
      maxHp: 1000,
      maxMp: 2000,
      foodHrid: '/items/donut',
      thresholdStepPercent: step,
    });
    for (let percent = step; percent < 100; percent += step) expect(values).toContain(percent * 10);
    expect(values).toContain(1000);
    expect(values).toContain(40);
    expect(values.length).toBe(new Set(values).size);
  });

  it('rounds resource thresholds up, includes 100%, and deduplicates integer values', () => {
    expect(buildFoodThresholds({ maxHp: 333, foodHrid: '/items/donut', thresholdStepPercent: 15 })).toEqual([
      333, 300, 250, 200, 150, 100, 50, 40,
    ]);
    expect(buildFoodThresholds({ maxHp: 7, foodHrid: '/items/donut', thresholdStepPercent: 1 })).toEqual([
      7, 6, 5, 4, 3, 2, 1,
    ]);
    expect(buildFoodThresholds({ maxHp: 100, foodHrid: '/items/donut', thresholdStepPercent: 25 })).toEqual([
      100, 75, 50, 40, 25,
    ]);
    expect(
      buildFoodThresholds({ maxHp: 100, foodHrid: '/items/donut', thresholdStepPercent: 100, restoreAmount: 40.01 }),
    ).toEqual([100, 41]);
    expect(buildFoodThresholds({ maxHp: 100.5, foodHrid: '/items/donut', thresholdStepPercent: 25 })).toEqual([
      100, 76, 51, 40, 26,
    ]);
  });

  it.each([0, -1, 101, 1.5, NaN, Infinity, null, '', false, 'invalid'])('rejects illegal step %s', (step) => {
    expect(isValidFoodOptimizerSettings({ thresholdStepPercent: step, rounds: 3 })).toBe(false);
    expect(() => buildFoodThresholds({ maxHp: 100, foodHrid: '/items/donut', thresholdStepPercent: step })).toThrow();
  });

  it('filters the catalog to the selected foods and normalizes the scope', () => {
    const catalog = getFoodOptimizerCatalogHrids();
    expect(catalog.length).toBeGreaterThan(2);
    const build = (hrids) => getFoodOptimizerItems({ maxHp: 333, maxMp: 555, thresholdStepPercent: 100, hrids });

    // 未提供范围、空数组都表示“全部食物”，候选目录与目录顺序一致。
    expect(build(undefined).map((item) => item.hrid)).toEqual(catalog);
    expect(build([]).map((item) => item.hrid)).toEqual(catalog);
    const scope = [catalog[2], catalog[0]];
    expect(build(scope).map((item) => item.hrid)).toEqual([catalog[0], catalog[2]]);

    // 归一化：null/无效/空集合回退到 null；全目录保留显式完整数组（防止下次
    // 打开被静默改回装备默认）；有效子集按目录顺序去重。
    expect(normalizeFoodOptimizerFoodHrids(null)).toBeNull();
    expect(normalizeFoodOptimizerFoodHrids([])).toBeNull();
    expect(normalizeFoodOptimizerFoodHrids(['/items/not_a_food'])).toBeNull();
    expect(normalizeFoodOptimizerFoodHrids([...catalog, '/items/not_a_food'])).toEqual(catalog);
    expect(normalizeFoodOptimizerFoodHrids([catalog[1], catalog[0], catalog[0]])).toEqual([catalog[0], catalog[1]]);
  });

  it('builds HP and MP triggers accepted by the existing engine mapper', () => {
    const items = getFoodOptimizerItems({ maxHp: 333, maxMp: 555, thresholdStepPercent: 100 });
    expect(items).toHaveLength(foodOptions.length);
    for (const kind of ['hp', 'mp']) {
      const item = items.find((entry) => entry.kind === kind);
      const candidate = buildFoodCandidate([{ ...item, threshold: 40 }]);
      expect(candidate.triggerMap[item.hrid]).toEqual(sanitizeTriggerList(candidate.triggerMap[item.hrid]));
      expect(candidate.triggerMap[item.hrid][0]).toMatchObject({
        dependencyHrid: '/combat_trigger_dependencies/self',
        conditionHrid: `/combat_trigger_conditions/missing_${kind}`,
        value: 40,
      });
      expect(item.thresholds).toContain(kind === 'hp' ? 333 : 555);
    }
  });

  // 夹具刻意跨 4 条烹饪线各取 1 件基础款（甜甜圈/蛋糕/软糖/酸奶）：族互斥（同类最多占
  // 一个槽位）下，取目录前 4 件（全是甜甜圈线）会让 limit≥1 的组合塌缩为至多 1 件，
  // limit 2/3/7 分支与 limit 1 完全等价——用例照样通过，槽位枚举覆盖被静默削弱。
  // 每线 1 件使全部 C(4, k) 跨线组合合法，limit 0/1/2/3/7 真实覆盖 0/1/2/3 件上限（7 截到 3）。
  it.each([0, 1, 2, 3, 7])('matches exact enumeration with slot limit %i and no duplicate food', (limit) => {
    const items = getFoodOptimizerItems({
      maxHp: 100,
      maxMp: 100,
      thresholdStepPercent: 100,
      hrids: ['/items/donut', '/items/cupcake', '/items/gummy', '/items/yogurt'],
    });
    // 夹具规模也是覆盖的一部分：目录变动导致取件不足时显式失败，不允许静默缩小。
    expect(items).toHaveLength(4);
    const candidates = [...generateFoodOptimizerCandidates(items, limit)];
    const slotCap = Math.min(3, limit);
    expect(candidates).toHaveLength(countFoodOptimizerCandidates(items, limit));
    expect(candidates[0].food).toEqual([]);
    expect(new Set(candidates.map((entry) => entry.signature)).size).toBe(candidates.length);
    // 上限必须被真实用满（存在恰好达到 slotCap 件的候选）：原先只有「不超过上限」的
    // 单向断言，同族夹具下候选全是 0/1 件也照样全绿；补上这条后，此类塌缩立即失败。
    expect(candidates.some((entry) => entry.food.length === slotCap)).toBe(true);
    for (const candidate of candidates) {
      expect(candidate.food.length).toBeLessThanOrEqual(slotCap);
      expect(new Set(candidate.food).size).toBe(candidate.food.length);
    }
  });

  // 「同类食物最多占一个槽位」：同一条烹饪线（甜甜圈/蛋糕/软糖/酸奶）的任意两个
  // 等级变体不得同时出现在一个组合或候选里。计数函数与枚举逐槽位对拍锁定一致性。
  it.each([1, 2, 3])('never places two foods of the same cooking family in one composition (limit %i)', (limit) => {
    const items = getFoodOptimizerItems({ maxHp: 100, maxMp: 100, thresholdStepPercent: 100 });
    const compositions = [...generateFoodOptimizerCompositionItems(items, limit)];
    expect(compositions.length).toBe(countFoodOptimizerCompositions(items, limit));
    for (const composition of compositions) {
      const families = composition.map((item) => getFoodOptimizerFamilyKey(item.hrid));
      expect(new Set(families).size).toBe(families.length);
    }
    for (const candidate of generateFoodOptimizerCandidates(items, limit)) {
      const families = candidate.food.map(getFoodOptimizerFamilyKey);
      expect(new Set(families).size).toBe(families.length);
    }
  });

  // 族键 = 游戏官方的烹饪分类（cooking 动作的 category）：族键字符串直接内嵌 category，
  // 不再从恢复属性反推。cupcake 不带 _cake 尾缀，但官方分类与蛋糕线一致，天然同族。
  it('derives the family from the official cooking category and folds the cake-line base cupcake into cake', () => {
    expect(getFoodOptimizerFamilyKey('/items/donut')).toBe('food-family:/action_categories/cooking/instant_heal');
    expect(getFoodOptimizerFamilyKey('/items/blueberry_donut')).toBe(getFoodOptimizerFamilyKey('/items/donut'));
    expect(getFoodOptimizerFamilyKey('/items/cupcake')).toBe('food-family:/action_categories/cooking/heal_over_time');
    expect(getFoodOptimizerFamilyKey('/items/spaceberry_cake')).toBe(getFoodOptimizerFamilyKey('/items/cupcake'));
    expect(getFoodOptimizerFamilyKey('/items/gummy')).toBe('food-family:/action_categories/cooking/instant_mana');
    expect(getFoodOptimizerFamilyKey('/items/star_fruit_gummy')).toBe(getFoodOptimizerFamilyKey('/items/gummy'));
    expect(getFoodOptimizerFamilyKey('/items/yogurt')).toBe('food-family:/action_categories/cooking/mana_over_time');
    expect(getFoodOptimizerFamilyKey('/items/apple_yogurt')).toBe(getFoodOptimizerFamilyKey('/items/yogurt'));
    // 未知 hrid 自成一类且绝不与已知类互斥（fail-open：脏值退化为旧行为而非误伤）。
    expect(getFoodOptimizerFamilyKey('/items/mystery_snack')).toBe('food-family:unknown:mystery_snack');
    expect(getFoodOptimizerFamilyKey('/items/mystery_snack')).not.toBe(getFoodOptimizerFamilyKey('/items/donut'));
  });

  // 目录分区守卫的冻结快照：官方烹饪分类 → 目录成员（升序）。拍摄时官方数据为
  // 4 条食物线 × 7 件（见 skillingData.actions 的 cooking 动作 outputItems）。
  // 之所以冻结完整分区，而不是只锁族键集合或族数（「> 1」兜底）：优化器的
  // 「同类最多占一个槽位」约束只由分区决定，而分区是官方数据的事实（实现逐条跟随
  // 官方分类），重分区一旦发生，无论是变严（合并两条线：跨线组合被静默排除，漏解）
  // 还是变松（拆分一条线或挪动变体：同线变体被静默放开，漏出用户口径禁止的组合；
  // 挪动还会把变体并入新类、反向漏解），都只有分区比对能拦住——挪动连族键集合都
  // 原封不动，「只锁集合」会被完全放行。
  // 官方数据重组或增减食物时：先复核官方数据确实如此、再据此更新下表，不允许静默跟随
  // （守卫失败是要求人工确认，不是让实现去猜，也不是让人默默刷新快照）。
  const FROZEN_FOOD_FAMILIES = {
    '/action_categories/cooking/instant_heal': [
      '/items/blackberry_donut',
      '/items/blueberry_donut',
      '/items/donut',
      '/items/marsberry_donut',
      '/items/mooberry_donut',
      '/items/spaceberry_donut',
      '/items/strawberry_donut',
    ],
    '/action_categories/cooking/heal_over_time': [
      '/items/blackberry_cake',
      '/items/blueberry_cake',
      '/items/cupcake',
      '/items/marsberry_cake',
      '/items/mooberry_cake',
      '/items/spaceberry_cake',
      '/items/strawberry_cake',
    ],
    '/action_categories/cooking/instant_mana': [
      '/items/apple_gummy',
      '/items/dragon_fruit_gummy',
      '/items/gummy',
      '/items/orange_gummy',
      '/items/peach_gummy',
      '/items/plum_gummy',
      '/items/star_fruit_gummy',
    ],
    '/action_categories/cooking/mana_over_time': [
      '/items/apple_yogurt',
      '/items/dragon_fruit_yogurt',
      '/items/orange_yogurt',
      '/items/peach_yogurt',
      '/items/plum_yogurt',
      '/items/star_fruit_yogurt',
      '/items/yogurt',
    ],
  };

  // 目录守卫：目录中的每个真实食物都必须能解析出唯一、非 unknown 的官方烹饪分类
  // （即 28/28 食物可在 skillingData 的 cooking 动作 outputItems 中反查到唯一 category），
  // 且整条「分类 → 成员」分区必须与冻结快照逐项一致。数据更新引入无法归类的食物
  // （分类缺失、多分类冲突）时立即失败并列出未归类食物，而不是让「每类最多一件」约束
  // 静默退化（自成一类的 fail-open 只留给测试桩与脏值）。
  it('assigns every catalog food to a unique official cooking category and freezes the partition', () => {
    const catalog = getFoodOptimizerCatalogHrids();
    expect(catalog.length).toBeGreaterThan(0);
    const categoryByHrid = new Map();
    for (const action of skillingData.actions.filter((entry) => entry.type === '/action_types/cooking'))
      for (const output of action.outputItems || []) categoryByHrid.set(output.itemHrid, action.category);
    // 族键必须跟随官方分类：分类缺失（undefined）、多分类冲突（实现判为 unknown）都在此失败。
    const unclassified = catalog.filter(
      (hrid) => getFoodOptimizerFamilyKey(hrid) !== `food-family:${categoryByHrid.get(hrid)}`,
    );
    expect(unclassified).toEqual([]);
    // 分区冻结：上面的逐条等式只在「实现偏离官方分类、或分类彻底退化（无分类 / 多分类冲突）」
    // 时失败；官方重分区（合并 / 拆分 / 挪动变体）时实现与官方分类同步变化，逐条等式天然自洽
    // （族键集合、族数这类弱检查也拦不住），只有下面的分区比对能拦住——绝不放行静默变松或变严。
    const membersByCategory = {};
    for (const hrid of catalog) {
      const category = categoryByHrid.get(hrid);
      if (!membersByCategory[category]) membersByCategory[category] = [];
      membersByCategory[category].push(hrid);
    }
    for (const members of Object.values(membersByCategory)) members.sort();
    expect(membersByCategory).toEqual(FROZEN_FOOD_FAMILIES);
  });

  it('excludes same-family duplicates from the search space by construction', () => {
    const line = (hrid) => ({ hrid, kind: 'hp', restore: 40, thresholds: [40], price: 1 });
    const donutLine = ['/items/donut', '/items/blueberry_donut', '/items/spaceberry_donut'].map(line);
    const items = [...donutLine, line('/items/gummy')];
    // 2 条线、4 件食物（甜甜圈线 3 件 + 软糖线 1 件），单档位：
    // 0 件 1 个 + 1 件 4 个 + 2 件只能跨线 3*1=3 个 + 3 件需 3 条线不可行 0 个 = 8。
    const compositions = [...generateFoodOptimizerCompositionItems(items, 3)];
    expect(compositions.length).toBe(8);
    expect(compositions.length).toBe(countFoodOptimizerCompositions(items, 3));
    expect(countFoodOptimizerCandidates(items, 3)).toBe(8);
    expect(compositions.some((composition) => composition.length === 3)).toBe(false);
  });

  it('keeps enumeration lazy even when the candidate count exceeds a billion', () => {
    const items = getFoodOptimizerItems({ maxHp: 10000, maxMp: 10000, thresholdStepPercent: 1 });
    expect(countFoodOptimizerCandidates(items, 3)).toBeGreaterThan(1_000_000_000);
    const batches = batchFoodOptimizerCandidates(generateFoodOptimizerCandidates(items, 3), 16);
    for (let i = 0; i < 100; i += 1) expect(batches.next().value).toHaveLength(16);
    batches.return();
  });

  it.each([1, 10, 15, 25, 100])(
    'keeps defaults within the exact threshold set and counts combinations at step %i',
    (step) => {
      const items = getFoodOptimizerItems({ maxHp: 100.5, maxMp: 123, thresholdStepPercent: step });
      for (const item of items) {
        const candidate = buildFoodDefaultCandidate([item]);
        expect(item.thresholds).toContain(candidate.slots[0].threshold);
        expect(candidate.slots[0].threshold).toBe(Math.min(Math.ceil(item.restore), item.kind === 'mp' ? 123 : 100));
        expect(candidate.slots[0]).not.toHaveProperty('thresholds');
      }
      for (const limit of [0, 1, 2, 3, 4]) {
        const compositions = [...generateFoodOptimizerCompositionItems(items, limit)];
        expect(compositions.length).toBe(countFoodOptimizerCompositions(items, limit));
        expect(compositions[0]).toEqual([]);
        expect(
          compositions.reduce(
            (count, composition) => count + composition.reduce((total, item) => total * item.thresholds.length, 1),
            0,
          ),
        ).toBe(countFoodOptimizerCandidates(items, limit));
      }
    },
  );

  it('generates only full-sized variants for a composition and skips items with no thresholds', () => {
    const items = [
      { hrid: 'a', kind: 'mp', restore: 20, thresholds: [100, 20] },
      { hrid: 'b', kind: 'mp', restore: 30, thresholds: [100, 30, 10] },
    ];
    const variants = [...generateFoodOptimizerCompositionCandidates(items)];
    expect(variants).toHaveLength(6);
    expect(variants.every((candidate) => candidate.food.length === 2)).toBe(true);
    expect(new Set(variants.map((candidate) => candidate.signature)).size).toBe(6);
    const invalid = [{ hrid: 'no-thresholds', thresholds: [] }];
    expect([...generateFoodOptimizerCandidates(invalid)]).toEqual([buildFoodCandidate([])]);
    expect(countFoodOptimizerCompositions(invalid)).toBe(1);
  });

  it('uses fixed slot order and cost/death/slot/signature result ordering', () => {
    const base = { restore: 40, price: 2, threshold: 20 };
    const candidate = buildFoodCandidate([
      { ...base, hrid: 'hp', kind: 'hp', threshold: 100 },
      { ...base, hrid: 'mp-low', kind: 'mp' },
      { ...base, hrid: 'mp-high', kind: 'mp', threshold: 50 },
    ]);
    expect(candidate.food).toEqual(['mp-high', 'mp-low', 'hp']);
    const rows = [
      { costPerHour: 5, deaths: 0, slots: [], signature: '' },
      { costPerHour: 3, deaths: 2, slots: [], signature: '' },
      { costPerHour: 3, deaths: 1, slots: [1], signature: 'b' },
      { costPerHour: 3, deaths: 1, slots: [], signature: '' },
      { costPerHour: 3, deaths: 1, slots: [1], signature: 'a' },
    ];
    expect(rows.sort(compareFoodOptimizerResults).map((row) => row.signature)).toEqual(['', 'a', 'b', '', '']);
    expect(rows[4].costPerHour).toBe(5);
  });

  // 基线的「携带槽位数」与死亡预算共用同一个取数口径（活动玩家的 food 字段），快照缺失或
  // 脏值一律返回 null，让调用方失败开放而不是按 0 槽加严搜索。
  it('counts the equipped baseline slots of the active player or reports an unreadable snapshot', () => {
    const payload = {
      players: [
        { hrid: 'player1', food: [{ hrid: 'a' }, null, { hrid: 'b' }] },
        { hrid: 'player2', food: [{ hrid: 'c' }] },
        { hrid: 'player3', food: [] },
      ],
    };
    expect(resolveFoodOptimizerBaselineSlotCount({ activePlayerId: '1', payload })).toBe(2);
    // 只数活动玩家：队友带满食物不影响本次搜索的预算。
    expect(resolveFoodOptimizerBaselineSlotCount({ activePlayerId: '2', payload })).toBe(1);
    // 空槽基线读作 0：任何候选都不会「比基线带得更少」，少带规则自然失效。
    expect(resolveFoodOptimizerBaselineSlotCount({ activePlayerId: '3', payload })).toBe(0);
    expect(hasEmptyFoodOptimizerBaseline({ activePlayerId: '3', payload })).toBe(true);
    for (const request of [
      // 活动玩家不在快照里、快照缺失、或 food 不是数组：一律 null，由调用方失败开放。
      { activePlayerId: '4', payload },
      { activePlayerId: '1' },
      { activePlayerId: '1', payload: {} },
      { activePlayerId: '1', payload: { players: [{ hrid: 'player1', food: {} }] } },
      { activePlayerId: '1', payload: { players: [{ hrid: 'player1', food: 'a' }] } },
      null,
    ])
      expect(resolveFoodOptimizerBaselineSlotCount(request)).toBeNull();
  });

  // 少带食物必须严格更少死：槽位少于基线携带槽位数时预算减一（不允许并列），槽位持平或更多
  // 时保持「不高于基线累计死亡」。预算或槽位数不是非负安全整数时原样返回——脏值绝不静默加严。
  it('lowers the death budget by one for candidates that carry fewer slots than the baseline', () => {
    expect(resolveFoodOptimizerCandidateDeathBudget(4, 3, 3)).toBe(4);
    expect(resolveFoodOptimizerCandidateDeathBudget(4, 4, 3)).toBe(4);
    expect(resolveFoodOptimizerCandidateDeathBudget(4, 2, 3)).toBe(3);
    expect(resolveFoodOptimizerCandidateDeathBudget(4, 0, 1)).toBe(3);
    // 基线零死时「更少」只可能是 0 死：下限不为负。
    expect(resolveFoodOptimizerCandidateDeathBudget(0, 0, 2)).toBe(0);
    expect(resolveFoodOptimizerCandidateDeathBudget(1, 1, 2)).toBe(0);
    // 0 预算本身合法（「排除有死亡的方案」口径），照常参与减一判定。
    expect(resolveFoodOptimizerCandidateDeathBudget(0, 1, 2)).toBe(0);
    for (const value of [undefined, null, -1, 2.5, NaN, Infinity, '3'])
      expect(resolveFoodOptimizerCandidateDeathBudget(value, 1, 3)).toBe(value);
    for (const value of [undefined, null, -1, 1.5, NaN, '2'])
      expect(resolveFoodOptimizerCandidateDeathBudget(4, value, 3)).toBe(4);
    for (const value of [undefined, null, -1, 1.5, NaN, '3'])
      expect(resolveFoodOptimizerCandidateDeathBudget(4, 1, value)).toBe(4);
  });

  it('charges all food with frozen fallback prices and excludes drinks', () => {
    const table = { '/items/donut': { ask: -1, bid: 12, vendor: 2 }, '/items/cupcake': { ask: 7, bid: 5, vendor: 1 } };
    expect(
      computeFoodCostPerHour(
        { '/items/donut': 4, '/items/cupcake': 2, '/items/coffee': 999 },
        table,
        'ask',
        2 * 3_600_000_000_000,
      ),
    ).toBe(31);
    expect(computeFoodCostPerHour({ '/items/donut': 4 }, table, 'vendor', 3_600_000_000_000)).toBe(8);
  });
});

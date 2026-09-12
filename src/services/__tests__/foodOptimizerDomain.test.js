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
  getFoodOptimizerItems,
  isValidFoodOptimizerSettings,
  isFoodOptimizerTopTenRequest,
  normalizeFoodOptimizerFoodHrids,
  normalizeFoodOptimizerRounds,
  normalizeFoodOptimizerSearchMode,
  resolveFoodOptimizerRequestSearchMode,
} from '../foodOptimizerDomain.js';
import { foodOptions } from '../../shared/gameDataIndex.js';
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

  it.each([0, 1, 2, 3, 7])('matches exact enumeration with slot limit %i and no duplicate food', (limit) => {
    const items = getFoodOptimizerItems({ maxHp: 100, maxMp: 100, thresholdStepPercent: 100 }).slice(0, 4);
    const candidates = [...generateFoodOptimizerCandidates(items, limit)];
    expect(candidates).toHaveLength(countFoodOptimizerCandidates(items, limit));
    expect(candidates[0].food).toEqual([]);
    expect(new Set(candidates.map((entry) => entry.signature)).size).toBe(candidates.length);
    for (const candidate of candidates) {
      expect(candidate.food.length).toBeLessThanOrEqual(Math.min(3, limit));
      expect(new Set(candidate.food).size).toBe(candidate.food.length);
    }
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

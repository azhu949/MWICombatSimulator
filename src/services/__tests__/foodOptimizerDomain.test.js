import { describe, expect, it } from 'vitest';
import {
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
  normalizeFoodOptimizerFoodHrids,
  normalizeFoodOptimizerSearchMode,
} from '../foodOptimizerDomain.js';
import { foodOptions } from '../../shared/gameDataIndex.js';
import { sanitizeTriggerList } from '../triggerMapper.js';

describe('food optimizer thresholds and candidates', () => {
  it('keeps complete mode for callers that omit the search mode', () => {
    expect(normalizeFoodOptimizerSearchMode()).toBe('complete');
    expect(isValidFoodOptimizerSettings({ thresholdStepPercent: 10, rounds: 3 })).toBe(true);
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

    // 归一化：null/无效/空集合/覆盖全目录都回退到 null；有效子集按目录顺序去重。
    expect(normalizeFoodOptimizerFoodHrids(null)).toBeNull();
    expect(normalizeFoodOptimizerFoodHrids([])).toBeNull();
    expect(normalizeFoodOptimizerFoodHrids(['/items/not_a_food'])).toBeNull();
    expect(normalizeFoodOptimizerFoodHrids([...catalog, '/items/not_a_food'])).toBeNull();
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

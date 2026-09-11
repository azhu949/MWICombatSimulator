import { describe, expect, it } from 'vitest';
import { buildFoodCandidate, generateFoodOptimizerCompositionCandidates } from '../foodOptimizerDomain.js';
import { selectFoodOptimizerRepresentatives } from '../foodOptimizerRepresentatives.js';

const food = (hrid, kind, thresholds, restore = 40, price = 1) => ({ hrid, kind, thresholds, restore, price });
const bySignature = (a, b) => (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0);

describe('exact representatives of equivalent food regions', () => {
  it.each([
    ['mp', 'mp', 'mp'],
    ['hp', 'hp', 'hp'],
    ['mp', 'hp', 'mp'],
    ['hp', 'mp', 'hp'],
  ])('matches exhaustive signature sorting for %s / %s / %s', (a, b, c) => {
    const items = [
      food('z', a, [1, 10, 100, 2, 20], 50, 3),
      food('a', b, [1, 10, 100, 2, 20], 40, 1),
      food('m', c, [1, 10, 100, 2, 20], 40, 2),
    ];
    const all = [...generateFoodOptimizerCompositionCandidates(items)].sort(bySignature);
    for (const limit of [1, 5, 10]) {
      expect(selectFoodOptimizerRepresentatives(items, { limit })).toEqual(all.slice(0, limit));
      const excludedSignature = all[0].signature;
      expect(selectFoodOptimizerRepresentatives(items, { limit, excludedSignature })).toEqual(all.slice(1, limit + 1));
    }
    for (const order of [
      ['a', 'm', 'z'],
      ['m', 'z', 'a'],
      ['z', 'a', 'm'],
    ]) {
      const expected = all.filter((candidate) => candidate.food.join('|') === order.join('|'));
      expect(selectFoodOptimizerRepresentatives(items, { order })).toEqual(expected.slice(0, 10));
    }
  });

  it('ranks the full signature, including separators after non-final thresholds', () => {
    const items = [food('a', 'mp', [1, 10]), food('b', 'hp', [1, 10])];
    expect(
      selectFoodOptimizerRepresentatives(items).map((candidate) => candidate.slots.map((slot) => slot.threshold)),
    ).toEqual([
      [10, 1],
      [10, 10],
      [1, 1],
      [1, 10],
    ]);
  });

  it('selects ten representatives of a billion variants without expanding the full product', () => {
    const thresholds = Array.from({ length: 1000 }, (_, index) => index + 1);
    const items = ['a', 'b', 'c'].map((hrid) => food(hrid, 'mp', thresholds));
    const selected = selectFoodOptimizerRepresentatives(items);
    expect(selected).toHaveLength(10);
    expect(new Set(selected.map((candidate) => candidate.signature)).size).toBe(10);
    expect(selected).toEqual([...selected].sort(bySignature));
    expect(selected[0]).toEqual(
      buildFoodCandidate(items.map((item, index) => ({ ...item, threshold: index === 2 ? 1 : 1000 }))),
    );
  });

  it('handles empty regions and exclusion of the no-food default', () => {
    expect(selectFoodOptimizerRepresentatives([])).toEqual([buildFoodCandidate([])]);
    expect(selectFoodOptimizerRepresentatives([], { excludedSignature: '' })).toEqual([]);
    expect(selectFoodOptimizerRepresentatives([food('a', 'mp', [])])).toEqual([]);
  });
});

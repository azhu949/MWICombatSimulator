import { compareFoodSlots, FOOD_OPTIMIZER_MAX_SLOTS } from './foodOptimizerDomain.js';

export function createFoodOptimizerGrid(items) {
  const grid = new Map();
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (typeof item?.hrid !== 'string' || !item.hrid) continue;
    if (seen.has(item.hrid)) {
      grid.delete(item.hrid);
      continue;
    }
    seen.add(item.hrid);
    if (
      !['hp', 'mp'].includes(item.kind) ||
      !Number.isFinite(item.restore) ||
      item.restore < 0 ||
      !Number.isFinite(item.price) ||
      item.price < 0 ||
      !Array.isArray(item.thresholds) ||
      !item.thresholds.length ||
      item.thresholds.some((threshold) => !Number.isSafeInteger(threshold) || threshold < 1)
    )
      continue;
    const thresholds = [...new Set(item.thresholds)].sort((a, b) => a - b);
    grid.set(item.hrid, {
      hrid: item.hrid,
      kind: item.kind,
      restore: item.restore,
      price: item.price,
      thresholds,
      thresholdSet: new Set(thresholds),
    });
  }
  return grid;
}

function gridItem(grid, slot) {
  const item = grid.get(slot?.hrid);
  return item && item.kind === slot.kind && item.restore === slot.restore && item.price === slot.price ? item : null;
}

export function matchesFoodOptimizerGrid(grid, domains) {
  return domains.every((domain) => {
    const item = gridItem(grid, domain);
    return item && domain.min <= domain.max && item.thresholdSet.has(domain.min) && item.thresholdSet.has(domain.max);
  });
}

export function projectFoodOptimizerRanges(grid, candidate, ranges) {
  const slots = candidate?.slots;
  if (
    !Array.isArray(slots) ||
    !slots.length ||
    slots.length > FOOD_OPTIMIZER_MAX_SLOTS ||
    !Array.isArray(candidate.food) ||
    candidate.food.length !== slots.length ||
    new Set(candidate.food).size !== slots.length ||
    !Array.isArray(ranges) ||
    ranges.length !== slots.length
  )
    return null;
  const choices = [];
  const projected = [];
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const item = gridItem(grid, slot);
    const range = ranges[index];
    if (
      !item ||
      candidate.food[index] !== slot.hrid ||
      !item.thresholdSet.has(slot.threshold) ||
      range?.hrid !== slot.hrid ||
      range.kind !== slot.kind ||
      !Number.isSafeInteger(range.min) ||
      !Number.isSafeInteger(range.max) ||
      range.min < 1 ||
      range.min > slot.threshold ||
      range.max < slot.threshold ||
      (index > 0 && compareFoodSlots(slots[index - 1], slot) >= 0)
    )
      return null;
    const thresholds = item.thresholds.filter((threshold) => threshold >= range.min && threshold <= range.max);
    choices.push(thresholds);
    projected.push({ hrid: slot.hrid, kind: slot.kind, min: thresholds[0], max: thresholds.at(-1) });
  }

  // Count only chains that retain the observed slot order. As a current
  // threshold increases, the eligible previous thresholds form a shrinking
  // suffix, so each discrete point is visited at most once per adjacent pair.
  let counts = choices[0].map(() => 1);
  for (let index = 1; index < slots.length; index += 1) {
    const previous = { ...slots[index - 1] };
    const current = { ...slots[index] };
    let eligible = counts.reduce((sum, count) => sum + count, 0);
    let start = 0;
    const nextCounts = [];
    for (const threshold of choices[index]) {
      current.threshold = threshold;
      while (start < choices[index - 1].length) {
        previous.threshold = choices[index - 1][start];
        if (compareFoodSlots(previous, current) < 0) break;
        eligible -= counts[start];
        start += 1;
      }
      nextCounts.push(eligible);
    }
    counts = nextCounts;
  }
  const coverage = counts.reduce((sum, count) => sum + count, 0);
  return Number.isSafeInteger(coverage) ? { ranges: projected, coverage } : null;
}

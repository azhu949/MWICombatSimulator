import { buildFoodDefaultCandidate, FOOD_OPTIMIZER_MAX_SLOTS } from './foodOptimizerDomain.js';

const NEARBY_CHOICES_PER_FOOD = 3;

// A small, exact part of the existing grid. Every remainder has a first axis
// outside the neighborhood, so these boxes are disjoint and cover its complement.
export function createFoodOptimizerPriority(request, items, foodSlots) {
  const food = request.payload?.players?.find((player) => player.hrid === `player${request.activePlayerId}`)?.food;
  if (!Array.isArray(food)) return null;
  const equipped = food.filter(Boolean).map((entry) => entry.hrid);
  if (
    equipped.length < 2 ||
    equipped.length > Math.min(FOOD_OPTIMIZER_MAX_SLOTS, foodSlots) ||
    new Set(equipped).size !== equipped.length
  )
    return null;
  const composition = items.filter((item) => equipped.includes(item.hrid));
  if (
    composition.length !== equipped.length ||
    composition.some(
      (item) =>
        !Array.isArray(item.thresholds) ||
        !item.thresholds.length ||
        new Set(item.thresholds).size !== item.thresholds.length ||
        item.thresholds.some((threshold) => !Number.isSafeInteger(threshold) || threshold < 1),
    )
  )
    return null;
  const candidate = buildFoodDefaultCandidate(composition);
  if (
    candidate.slots.some(
      (slot) => !composition.find((item) => item.hrid === slot.hrid).thresholds.includes(slot.threshold),
    )
  )
    return null;
  const nearbyItems = composition.map((item) => {
    const center = candidate.slots.find((slot) => slot.hrid === item.hrid).threshold;
    return {
      ...item,
      thresholds: [...item.thresholds]
        .sort((left, right) => Math.abs(left - center) - Math.abs(right - center) || right - left)
        .slice(0, NEARBY_CHOICES_PER_FOOD),
    };
  });
  const remainingItems = [];
  const prefix = [];
  for (let index = 0; index < composition.length; index += 1) {
    const item = composition[index];
    const min = Math.min(...nearbyItems[index].thresholds);
    const max = Math.max(...nearbyItems[index].thresholds);
    for (const thresholds of [
      item.thresholds.filter((value) => value > max),
      item.thresholds.filter((value) => value < min),
    ])
      if (thresholds.length) remainingItems.push([...prefix, { ...item, thresholds }, ...composition.slice(index + 1)]);
    prefix.push({ ...item, thresholds: item.thresholds.filter((value) => value >= min && value <= max) });
  }
  return {
    candidate,
    nearbyItems,
    nearbyCount: nearbyItems.reduce((count, item) => count * item.thresholds.length, 1),
    remainingItems,
  };
}

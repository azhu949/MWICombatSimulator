import {
  buildFoodDefaultCandidate,
  FOOD_OPTIMIZER_MAX_SLOTS,
  getFoodOptimizerFamilyKey,
} from './foodOptimizerDomain.js';

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
  // 与搜索主路径同一「每类最多 1 件」不变量：装备基线里出现两条同烹饪线的食物
  // （如甜甜圈 + 蓝莓甜甜圈）时，基线候选本身就不在合法搜索空间里，优先搜索直接
  // 放弃（fail-open，回落到常规枚举），绝不产出破坏不变量的候选。
  const equippedFamilies = equipped.map(getFoodOptimizerFamilyKey);
  if (new Set(equippedFamilies).size !== equippedFamilies.length) return null;
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

import { computeFoodCostPerHour } from './foodOptimizerDomain.js';

// Ties must still reach the ordinary death/slot/signature tie-breakers. Leave a
// small margin around the floating-point boundary rather than rounding either
// the observed cost or the incumbent's hourly cost.
export function isFoodOptimizerCostAboveCutoff(costLowerBound, costCutoff) {
  if (!Number.isFinite(costLowerBound) || costLowerBound < 0 || !Number.isFinite(costCutoff) || costCutoff < 0)
    return false;
  const margin = 16 * Number.EPSILON * Math.max(1, costLowerBound, costCutoff);
  return costLowerBound - costCutoff > margin;
}

export function getFoodOptimizerCostCutoff(request, candidate, costCutoff) {
  return request?.searchMode === 'top10' &&
    candidate != null &&
    Number.isSafeInteger(request.rounds) &&
    request.rounds > 0 &&
    Number.isFinite(costCutoff) &&
    costCutoff >= 0
    ? costCutoff
    : null;
}

export function computeFoodOptimizerCostLowerBound(completedCostPerHour, currentCostPerHour, totalRounds) {
  if (
    !Number.isFinite(completedCostPerHour) ||
    completedCostPerHour < 0 ||
    !Number.isFinite(currentCostPerHour) ||
    currentCostPerHour < 0 ||
    !Number.isSafeInteger(totalRounds) ||
    totalRounds < 1
  )
    return null;
  const lowerBound = (completedCostPerHour + currentCostPerHour) / totalRounds;
  return Number.isFinite(lowerBound) ? lowerBound : null;
}

// Install only for an explicitly enabled top-ten candidate. The ordinary
// simulator and complete-coverage searches keep their existing hot paths.
export function observeFoodOptimizerCostBound(simulator, player, request, costBound) {
  const { cutoff, completedCostPerHour, totalRounds } = costBound;
  const foods = new Set(player.food.filter(Boolean));
  // Use the same item/key order as the final sample. Summing individual uses as
  // they occur would change floating-point addition order when slots interleave.
  const foodUsed = Object.fromEntries([...foods].map((food) => [food.hrid, 0]));
  let dirty = false;
  let costLowerBound = computeFoodOptimizerCostLowerBound(completedCostPerHour, 0, totalRounds);
  let aboveCutoff = isFoodOptimizerCostAboveCutoff(costLowerBound, cutoff);
  const use = simulator.tryUseConsumable;
  simulator.tryUseConsumable = function (source, consumable, ...args) {
    const consumed = use.call(this, source, consumable, ...args);
    if (consumed && source === player && foods.has(consumable)) dirty = true;
    return consumed;
  };
  return {
    shouldStop() {
      if (dirty) {
        dirty = false;
        const used = simulator.simResult.consumablesUsed[player.hrid] || {};
        for (const hrid of Object.keys(foodUsed)) foodUsed[hrid] = used[hrid] || 0;
        // All remaining consumption is nonnegative. Divide this prefix's cost
        // by the full requested duration, never by the elapsed prefix duration.
        const currentCostPerHour = computeFoodCostPerHour(
          foodUsed,
          request.prices.priceTable,
          request.prices.consumableMode,
          request.payload.simulationTimeLimit,
        );
        costLowerBound = computeFoodOptimizerCostLowerBound(completedCostPerHour, currentCostPerHour, totalRounds);
        aboveCutoff = isFoodOptimizerCostAboveCutoff(costLowerBound, cutoff);
      }
      return aboveCutoff;
    },
    read() {
      return costLowerBound;
    },
  };
}

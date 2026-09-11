export const FOOD_OPTIMIZER_LABYRINTH_ERROR = 'common:foodOptimizer.labyrinthUnsupported';

export function isFoodOptimizerLabyrinth(inputOrRequest) {
  return Boolean(inputOrRequest?.simulation?.labyrinth || inputOrRequest?.payload?.labyrinth);
}

export function assertFoodOptimizerTarget(inputOrRequest) {
  if (isFoodOptimizerLabyrinth(inputOrRequest)) throw new Error(FOOD_OPTIMIZER_LABYRINTH_ERROR);
}

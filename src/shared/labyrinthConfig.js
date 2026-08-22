import { labyrinthCrateOptions } from './gameDataIndex.js';

export const LABYRINTH_ROOM_LEVEL_MIN = 20;
export const LABYRINTH_ROOM_LEVEL_DEFAULT = 100;
export const LABYRINTH_ROOM_LEVEL_MAX = 220;
export const LABYRINTH_BATCH_ROOM_LEVEL_MIN = 40;
export const LABYRINTH_BATCH_ROOM_LEVEL_STEP = 20;

function getLabyrinthCrateHrids(kind) {
  const options = Array.isArray(labyrinthCrateOptions?.[kind]) ? labyrinthCrateOptions[kind] : [];
  return options.map((item) => String(item?.hrid || '')).filter(Boolean);
}

export const LABYRINTH_COFFEE_CRATE_HRIDS = getLabyrinthCrateHrids('coffee');
export const LABYRINTH_FOOD_CRATE_HRIDS = getLabyrinthCrateHrids('food');
export const LABYRINTH_TEA_CRATE_HRIDS = getLabyrinthCrateHrids('tea');

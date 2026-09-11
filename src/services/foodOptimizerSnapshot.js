import { foodOptions } from '../shared/gameDataIndex.js';
import { buildSingleSimulationPayload } from './simulationDomain.js';
import { normalizePriceMode, PRICE_MODE_ASK } from './marketPriceService.js';
import { deepClone } from './utils.js';
import { FOOD_OPTIMIZER_SEARCH_MODE_COMPLETE } from './foodOptimizerDomain.js';

const COMBAT_PLAYER_KEYS = [
  'id',
  'name',
  'levels',
  'equipment',
  'food',
  'drinks',
  'abilities',
  'triggerMap',
  'combatScrolls',
  'houseRooms',
  'guildBuffs',
  'achievements',
];

export function snapshotFoodOptimizerInput(store) {
  const activePlayerId = String(store.activePlayerId);
  const players = store.players
    .filter((player) => String(player.id) === activePlayerId || player.selected)
    .map((player) => ({
      ...Object.fromEntries(COMBAT_PLAYER_KEYS.map((key) => [key, deepClone(player[key] ?? null)])),
      selected: true,
    }));
  const settings = store.simulationSettings;
  const crates = Array.from(new Set(Object.values(settings.labyrinthCrates || {}).filter(Boolean)));
  const { zone, labyrinth, simulationTimeLimit, extra } = buildSingleSimulationPayload([], settings, crates, {
    workerId: 'food-optimizer',
  });
  const hrids = foodOptions.map((item) => item.hrid);
  return {
    activePlayerId,
    imported: store.queue.importedProfileByPlayer?.[activePlayerId] === true,
    players,
    runScope: settings.runScope,
    simulation: { zone, labyrinth, simulationTimeLimit, extra },
    prices: {
      consumableMode: normalizePriceMode(store.pricing.consumableMode, PRICE_MODE_ASK),
      priceTable: Object.fromEntries(hrids.map((hrid) => [hrid, deepClone(store.pricing.priceTable?.[hrid] ?? null)])),
      overrides: Object.fromEntries(
        hrids
          .filter((hrid) => store.pricing.overrides?.[hrid])
          .map((hrid) => [hrid, deepClone(store.pricing.overrides[hrid])]),
      ),
    },
    thresholdStepPercent: store.foodOptimizer.settings.thresholdStepPercent,
    rounds: store.foodOptimizer.settings.rounds,
    searchMode: store.foodOptimizer.settings.searchMode ?? FOOD_OPTIMIZER_SEARCH_MODE_COMPLETE,
    // null 表示全部食物；显式子集参与输入签名，改动会让既有报告过期。
    // 必须拷贝为普通数组：请求对象会被 structuredClone 送往 Worker 与报告，
    // Pinia 状态里的响应式代理无法被克隆。
    foodHrids: Array.isArray(store.foodOptimizer.settings.foodHrids)
      ? [...store.foodOptimizer.settings.foodHrids]
      : null,
  };
}

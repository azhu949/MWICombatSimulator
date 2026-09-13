import { foodOptions } from '../shared/gameDataIndex.js';
import { buildSingleSimulationPayload } from './simulationDomain.js';
import { normalizePriceMode, PRICE_MODE_ASK } from './marketPriceService.js';
import { deepClone } from './utils.js';
import {
  getFoodOptimizerCatalogHrids,
  normalizeFoodOptimizerSearchMode,
  normalizeFoodOptimizerZeroDeaths,
} from './foodOptimizerDomain.js';

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

// 解析实际生效的食物范围：页面「食物范围」标签、预览候选数与范围弹窗的默认
// 勾选共用这一口径。已保存的显式数组原样拷贝；null（新用户，从未确认过范围）
// 解析为当前佩戴食物 ∩ 目录（按目录顺序去重）；未佩戴任何目录内食物时保持
// null——引擎语义中 null 仍表示全部食物。解析结果参与输入签名：装备变化会
// 让既有报告过期（players 快照本就含 food 字段，不引入新的过期维度）。
function resolveFoodScopeHrids(store, activePlayerId) {
  const saved = store.foodOptimizer.settings.foodHrids;
  // 必须拷贝为普通数组：请求对象会被 structuredClone 送往 Worker 与报告，
  // Pinia 状态里的响应式代理无法被克隆。
  if (Array.isArray(saved)) return [...saved];
  const equipped = new Set(
    (store.players.find((player) => String(player.id) === activePlayerId)?.food || [])
      .filter(Boolean)
      .map((hrid) => String(hrid)),
  );
  if (!equipped.size) return null;
  const picked = getFoodOptimizerCatalogHrids().filter((hrid) => equipped.has(hrid));
  return picked.length ? picked : null;
}

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
    // 「排除有死亡的方案」改变候选准入（死亡预算压到 0），必须参与输入签名：否则开关切换会
    // 复用另一口径的缓存报告，页面也会把两种结果当成同一份输入。
    requireZeroDeaths: normalizeFoodOptimizerZeroDeaths(store.foodOptimizer.settings.requireZeroDeaths),
    // 设置层缺省只由 normalizeFoodOptimizerSearchMode 定义（精确前十）；快照永远向引擎
    // 递交合法枚举，引擎侧另有自己的容错兜底（见 resolveFoodOptimizerRequestSearchMode）。
    searchMode: normalizeFoodOptimizerSearchMode(store.foodOptimizer.settings.searchMode),
    foodHrids: resolveFoodScopeHrids(store, activePlayerId),
  };
}

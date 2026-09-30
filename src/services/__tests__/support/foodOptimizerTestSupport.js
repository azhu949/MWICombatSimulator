import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createEmptyPlayerConfig } from '../../../shared/playerConfig.js';
import Player from '../../../combatsimulator/player.js';
import Zone from '../../../combatsimulator/zone.js';
import { dungeonOptions, labyrinthOptions } from '../../../shared/gameDataIndex.js';
import { buildSimulationExtraBuffs } from '../../../shared/simulationExtraBuffs.js';
import { buildPlayersForSimulation } from '../../playerMapper.js';
import { buildFoodCandidate, computeFoodCostPerHour, getFoodOptimizerItems } from '../../foodOptimizerDomain.js';
import { getFoodOptimizerResources } from '../../foodOptimizerSimulation.js';
import { loadWasmEngine } from '../../wasmEngineLoader.js';
import { setWasmProductionEngineForTests } from '../../wasmProductionSimulation.js';

// 切片 21B：JS 引擎（CombatSimulator）已物理删除——本文件不再提供 JS 引擎 oracle
// （referenceFoodOptimizerRound / simulateFoodOptimizerRoundOnJsEngine）。等价性
// 断言改用生产 wasm 轮（simulateFoodOptimizerRound 本身）；引擎输出漂移防线在
// fixtures/golden 快照 + cargo test。真轮次用例统一由这里注入真实 wasm 引擎。
const supportRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const supportGluePath = resolve(supportRoot, 'engine', 'pkg', 'mwi_combat_engine.js');
const supportWasmPath = resolve(supportRoot, 'engine', 'pkg', 'mwi_combat_engine_bg.wasm');
if (existsSync(supportGluePath) && existsSync(supportWasmPath)) {
  setWasmProductionEngineForTests(
    await loadWasmEngine({ glueUrl: pathToFileURL(supportGluePath).href, moduleOrPath: readFile(supportWasmPath) }),
  );
}

export function createFoodOptimizerFixture({
  target = 'zone',
  foodSlots = 2,
  activePlayerId = '1',
  party = false,
  scrolls = false,
  seconds = 600,
  rounds = 3,
  thresholdStepPercent = 25,
  fullCatalog = false,
  noManaUse = false,
  intelligenceLevel = 1,
  staminaLevel = 100,
  zoneHrid = '/actions/combat/fly',
  equippedHpThreshold,
} = {}) {
  const configs = Array.from({ length: party ? 2 : 1 }, (_, index) => {
    const player = createEmptyPlayerConfig(index + 1);
    player.selected = true;
    for (const key of Object.keys(player.levels)) player.levels[key] = 30;
    if (player.id === activePlayerId && !noManaUse)
      player.abilities[0] = { abilityHrid: '/abilities/fireball', level: 1 };
    return player;
  });
  const players = structuredClone(buildPlayersForSimulation(configs));
  const player = players.find((entry) => entry.hrid === `player${activePlayerId}`);
  player.intelligenceLevel = intelligenceLevel;
  player.staminaLevel = staminaLevel;
  if (foodSlots > 1)
    player.equipment['/equipment_types/pouch'] = {
      hrid: foodSlots === 3 ? '/items/large_pouch' : '/items/small_pouch',
      enhancementLevel: 0,
    };
  if (scrolls) player.combatScrolls = { '/items/seal_of_combat_drop': { quantity: 1 } };
  const foods = ['/items/gummy', '/items/star_fruit_yogurt', '/items/donut', '/items/blueberry_cake'];
  const request = {
    activePlayerId,
    rounds,
    seeds: Array.from({ length: rounds }, (_, index) => index + 1),
    prices: {
      priceTable: Object.fromEntries(foods.map((hrid, index) => [hrid, { ask: (index + 1) * 10 }])),
      consumableMode: 'ask',
    },
    payload: {
      players,
      extra: { combatScrollsEnabled: scrolls },
      simulationTimeLimit: seconds * 1e9,
      zone:
        target === 'labyrinth'
          ? null
          : { zoneHrid: target === 'dungeon' ? dungeonOptions[0].hrid : zoneHrid, difficultyTier: 0 },
      labyrinth: target === 'labyrinth' ? { labyrinthHrid: labyrinthOptions[0].hrid, roomLevel: 40, crates: [] } : null,
    },
  };
  const resources = getFoodOptimizerResources(request);
  if (resources.foodSlots !== foodSlots) throw new Error('Fixture food slot count does not match its equipment.');
  const items = getFoodOptimizerItems({
    ...resources,
    thresholdStepPercent,
    prices: request.prices.priceTable,
    consumableMode: request.prices.consumableMode,
  }).filter((food) => fullCatalog || foods.includes(food.hrid));
  if (equippedHpThreshold !== undefined) {
    const equipped = buildFoodCandidate(
      items
        .filter((item) => item.kind === 'hp')
        .slice(0, foodSlots)
        .map((item) => ({ ...item, threshold: equippedHpThreshold })),
    );
    player.food = Array.from({ length: 3 }, (_, index) =>
      equipped.food[index] ? { hrid: equipped.food[index], triggers: equipped.triggerMap[equipped.food[index]] } : null,
    );
  }
  return { request, items, foodSlots };
}

// 死亡预算的独立实现（刻意不复用生产侧 helper，避免同一个错误在两边同时成立）：候选少带
// 食物（槽位少于基线携带槽位数）时必须严格更少死，其余情况沿用「不高于基线累计死亡」。
export function referenceDeathBudget(request, candidate, baselineDeaths = Infinity) {
  if (!candidate) return baselineDeaths;
  const food = request.payload.players.find((player) => player.hrid === `player${request.activePlayerId}`)?.food || [];
  return candidate.slots.length < food.filter(Boolean).length ? Math.max(0, baselineDeaths - 1) : baselineDeaths;
}

export function physicalFoodOptimizerResult(result) {
  if (!result.feasible) return { feasible: false };
  return {
    feasible: true,
    deaths: result.deaths,
    costPerHour: result.costPerHour,
    foodUsed: result.foodUsed,
    roundsCompleted: result.roundsCompleted,
    samples: result.samples.map(
      ({ seed, deaths, ranOutOfMana, foodUsed, costPerHour, stoppedEarly, simulatedTime }) => ({
        seed,
        deaths,
        ranOutOfMana,
        foodUsed,
        costPerHour,
        stoppedEarly,
        simulatedTime,
      }),
    ),
  };
}

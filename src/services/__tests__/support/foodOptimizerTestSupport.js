import { createEmptyPlayerConfig } from '../../../shared/playerConfig.js';
import CombatSimulator from '../../../combatsimulator/combatSimulator.js';
import CombatUnit from '../../../combatsimulator/combatUnit.js';
import Consumable from '../../../combatsimulator/consumable.js';
import Player from '../../../combatsimulator/player.js';
import Zone from '../../../combatsimulator/zone.js';
import { dungeonOptions, labyrinthOptions } from '../../../shared/gameDataIndex.js';
import { buildSimulationExtraBuffs } from '../../../shared/simulationExtraBuffs.js';
import { buildPlayersForSimulation } from '../../playerMapper.js';
import { buildFoodCandidate, computeFoodCostPerHour, getFoodOptimizerItems } from '../../foodOptimizerDomain.js';
import { createFoodOptimizerRandom, getFoodOptimizerResources } from '../../foodOptimizerSimulation.js';

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

function createReferenceSimulation(request, candidate) {
  const payload = structuredClone(request.payload);
  if (candidate) {
    const player = payload.players.find((entry) => entry.hrid === `player${request.activePlayerId}`);
    player.food = Array.from({ length: 3 }, (_, slot) =>
      candidate.food[slot]
        ? { hrid: candidate.food[slot], triggers: structuredClone(candidate.triggerMap[candidate.food[slot]]) }
        : null,
    );
  }
  const zone = new Zone(payload.zone.zoneHrid, payload.zone.difficultyTier);
  const extraBuffs = buildSimulationExtraBuffs(payload.extra);
  const players = payload.players.map((dto) => {
    const player = Player.createFromDTO(dto);
    player.zoneBuffs = zone.buffs || [];
    player.extraBuffs = extraBuffs;
    return player;
  });
  // Construct the ordinary engine directly so changes to the optimizer factory
  // cannot silently enable compact results in the reference as well.
  return new CombatSimulator(players, zone, null, {
    enableHpMpVisualization: false,
    logCombatEvents: false,
    combatScrollsEnabled: Boolean(payload.extra?.combatScrollsEnabled),
    isGuildTrial: Boolean(payload.simulationContext?.isGuildTrial),
  });
}

// Keep the pre-optimization trigger dispatch independent of the production
// shortcut. As with the buff reference below, this is scoped to one oracle run.
function installLegacyConsumableTriggers() {
  const original = Consumable.prototype.shouldTrigger;
  Consumable.prototype.shouldTrigger = function (currentTime, source, target, friendlies, enemies) {
    if (source.isStunned) return false;
    const consumableHaste = this.catagoryHrid.includes('food')
      ? source.combatDetails.combatStats.foodHaste
      : source.combatDetails.combatStats.drinkConcentration;
    let cooldownDuration = this.cooldownDuration;
    if (consumableHaste > 0) cooldownDuration /= 1 + consumableHaste;
    if (this.lastUsed + cooldownDuration > currentTime) return false;
    if (this.triggers.length == 0) return true;
    let shouldTrigger = true;
    for (const trigger of this.triggers)
      if (!trigger.isActive(source, target, friendlies, enemies, currentTime)) shouldTrigger = false;
    return shouldTrigger;
  };
  return () => {
    Consumable.prototype.shouldTrigger = original;
  };
}

// The oracle runs a fresh, deeply copied native engine with full results and
// generic consumable triggers to the time limit. It installs neither early-stop
// hooks nor equivalence observers/caches.
export async function referenceFoodOptimizerRound(request, candidate, seed) {
  const originalRandom = Math.random;
  const restoreBuffLookup = installLegacyBuffLookup();
  const restoreConsumableTriggers = installLegacyConsumableTriggers();
  Math.random = createFoodOptimizerRandom(seed);
  try {
    const simulator = createReferenceSimulation(request, candidate);
    const result = await simulator.simulate(request.payload.simulationTimeLimit);
    const hrid = `player${request.activePlayerId}`;
    const player = simulator.players.find((entry) => entry.hrid === hrid);
    const counts = result.consumablesUsed[hrid] || {};
    const foodUsed = Object.fromEntries(
      [...new Set(player.food.filter(Boolean).map((food) => food.hrid))].map((item) => [item, counts[item] || 0]),
    );
    return {
      seed,
      deaths: result.deaths[hrid] || 0,
      ranOutOfMana: result.playerRanOutOfMana[hrid] === true,
      foodUsed,
      costPerHour: computeFoodCostPerHour(
        foodUsed,
        request.prices.priceTable,
        request.prices.consumableMode,
        result.simulatedTime,
      ),
      stoppedEarly: false,
      simulatedTime: result.simulatedTime,
    };
  } finally {
    restoreConsumableTriggers();
    restoreBuffLookup();
    Math.random = originalRandom;
  }
}

export function installLegacyBuffLookup() {
  const update = CombatUnit.prototype.updateCombatDetails;
  const lookup = CombatUnit.prototype.getBuffBoosts;
  const recalculate = CombatUnit.prototype.updateCombatDetailsFromBuffs;
  // Ignore the optimized caller's fresh-base marker so the oracle always
  // restores its baseline before deriving attributes.
  CombatUnit.prototype.updateCombatDetails = function () {
    return recalculate.call(this);
  };
  CombatUnit.prototype.getBuffBoosts = function (type) {
    return Object.values(this.combatBuffs)
      .filter((buff) => buff.typeHrid == type)
      .map((buff) => ({ ratioBoost: buff.ratioBoost, flatBoost: buff.flatBoost }));
  };
  return () => {
    CombatUnit.prototype.updateCombatDetails = update;
    CombatUnit.prototype.getBuffBoosts = lookup;
  };
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

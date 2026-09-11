import { describe, expect, it, vi } from 'vitest';
import CombatSimulator from '../combatSimulator.js';
import Zone from '../zone.js';
import { buildPlayersForSimulation, createEmptyPlayerConfig } from '../../services/playerMapper.js';
import { COMBAT_SCROLL_DURATION_NS } from '../../shared/combatScrolls.js';

const ATTACK_SCROLL = '/items/seal_of_attack_speed';
const DROP_SCROLL = '/items/seal_of_combat_drop';

function describeEvent(event) {
  const { source, sourceRef, target, ability, consumable, ...details } = event;
  return {
    ...details,
    source: source?.hrid,
    sourceRef: sourceRef?.hrid,
    target: target?.hrid,
    ability: ability?.hrid,
    consumable: consumable?.hrid,
  };
}

async function runSimulation(scenario, minimalResult) {
  const randomValues = [];
  let state = 12345;
  const random = vi.spyOn(Math, 'random').mockImplementation(() => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const value = state / 4294967296;
    randomValues.push(value);
    return value;
  });
  try {
    const configs = Array.from({ length: scenario.playerCount }, (_, index) => {
      const config = createEmptyPlayerConfig(index + 1);
      config.selected = true;
      for (const level of Object.keys(config.levels)) config.levels[level] = 30;
      config.levels.stamina = 100;
      if (scenario.manaExhaustion) config.levels.intelligence = 1;
      config.food[0] = index === 0 ? '/items/donut' : '/items/blueberry_cake';
      config.triggerMap[config.food[0]] = [];
      config.drinks[0] = '/items/attack_coffee';
      config.abilities[0] = { abilityHrid: '/abilities/fireball', level: 1 };
      if (scenario.scrolls) {
        config.combatScrolls = {
          [ATTACK_SCROLL]: { quantity: index + 1 },
          [DROP_SCROLL]: { quantity: 1 },
        };
      }
      return config;
    });
    const players = buildPlayersForSimulation(configs);
    const zone = new Zone(scenario.zoneHrid, scenario.difficultyTier);
    for (const player of players) {
      player.zoneBuffs = zone.buffs || [];
      player.extraBuffs = [];
    }
    // Construct the native engine directly so the reference cannot inherit
    // minimalResult from the optimizer's simulation factory.
    const simulator = new CombatSimulator(players, zone, null, {
      minimalResult,
      logCombatEvents: false,
      combatScrollsEnabled: Boolean(scenario.scrolls),
    });
    const trace = [];
    const processEvent = simulator.processEvent.bind(simulator);
    simulator.processEvent = (event) => {
      trace.push({
        ...describeEvent(event),
        playerResources: players.map((player) => [
          player.combatDetails.currentHitpoints,
          player.combatDetails.currentManapoints,
        ]),
        attackScrollActive: players.map((player) => Boolean(player.combatBuffs['/buff_uniques/personal_attack_speed'])),
      });
      return processEvent(event);
    };
    const result = await simulator.simulate(scenario.duration);
    const optimizerResult = Object.fromEntries(
      [
        'deaths',
        'playerRanOutOfMana',
        'playerRanOutOfManaTime',
        'consumablesUsed',
        'simulatedTime',
        'stoppedEarly',
        'scrollUsage',
      ].map((key) => [key, result[key]]),
    );
    return {
      optimizerResult: structuredClone(optimizerResult),
      trace,
      randomValues,
      remainingEvents: simulator.eventQueue.minHeap.toArray().map(describeEvent),
      finalPlayers: structuredClone(
        players.map((player) => ({
          hrid: player.hrid,
          combatDetails: player.combatDetails,
          combatBuffs: player.combatBuffs,
          isOutOfMana: player.isOutOfMana,
        })),
      ),
      retainsDetailedResult: Object.hasOwn(result, 'attacks') && Object.hasOwn(result, 'experienceGained'),
    };
  } finally {
    random.mockRestore();
  }
}

describe('CombatSimulator minimal result equivalence', () => {
  it.each([
    {
      name: 'ordinary zone with mana exhaustion',
      zoneHrid: '/actions/combat/fly',
      difficultyTier: 0,
      playerCount: 1,
      duration: 600e9,
      manaExhaustion: true,
    },
    {
      name: 'dungeon party with deaths and restarts',
      zoneHrid: '/actions/combat/chimerical_den',
      difficultyTier: 4,
      playerCount: 2,
      duration: 600e9,
      dungeon: true,
    },
    {
      name: 'ordinary party with finite scroll expiration and renewal',
      zoneHrid: '/actions/combat/fly',
      difficultyTier: 0,
      playerCount: 2,
      duration: COMBAT_SCROLL_DURATION_NS + 60e9,
      scrolls: true,
    },
  ])('preserves the native combat trajectory in $name', async (scenario) => {
    const full = await runSimulation(scenario, false);
    const minimal = await runSimulation(scenario, true);

    expect(full.retainsDetailedResult).toBe(true);
    expect(minimal.retainsDetailedResult).toBe(false);
    expect(minimal.optimizerResult).toStrictEqual(full.optimizerResult);
    expect(minimal.trace).toStrictEqual(full.trace);
    expect(minimal.randomValues).toStrictEqual(full.randomValues);
    expect(minimal.remainingEvents).toStrictEqual(full.remainingEvents);
    expect(minimal.finalPlayers).toStrictEqual(full.finalPlayers);
    expect(full.randomValues.length).toBeGreaterThan(0);
    expect(full.optimizerResult).toMatchObject({ simulatedTime: scenario.duration, stoppedEarly: false });
    for (const player of full.finalPlayers) {
      const foodHrid = player.hrid === 'player1' ? '/items/donut' : '/items/blueberry_cake';
      expect(full.optimizerResult.consumablesUsed[player.hrid][foodHrid]).toBeGreaterThan(0);
    }
    if (scenario.manaExhaustion) expect(full.optimizerResult.playerRanOutOfMana.player1).toBe(true);
    if (scenario.dungeon) {
      expect(full.optimizerResult.deaths.player1).toBeGreaterThan(0);
      expect(full.optimizerResult.deaths.player2).toBeGreaterThan(0);
      expect(full.trace.filter((event) => event.type === 'combatStart').length).toBeGreaterThan(1);
    }
    if (scenario.scrolls) {
      expect(
        full.trace.some((event) => event.type === 'scrollRenewal' && event.time === COMBAT_SCROLL_DURATION_NS),
      ).toBe(true);
      expect(full.optimizerResult.scrollUsage.byPlayer.player1[ATTACK_SCROLL]).toMatchObject({
        openedCount: 1,
        activeDurationNs: COMBAT_SCROLL_DURATION_NS,
        exhausted: true,
      });
      expect(full.optimizerResult.scrollUsage.byPlayer.player2[ATTACK_SCROLL]).toMatchObject({
        openedCount: 2,
        activeDurationNs: scenario.duration,
        exhausted: true,
      });
      const afterExpiration = full.trace.find((event) => event.time > COMBAT_SCROLL_DURATION_NS);
      expect(afterExpiration.attackScrollActive).toEqual([false, true]);
    }
  });
});

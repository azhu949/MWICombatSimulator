import { describe, expect, it, vi } from 'vitest';
import Ability from '../ability.js';
import CombatSimulator from '../combatSimulator.js';
import CombatUtilities from '../combatUtilities.js';
import Player from '../player.js';
import Zone from '../zone.js';
import AutoAttackEvent from '../events/autoAttackEvent.js';
import DamageOverTimeEvent from '../events/damageOverTimeEvent.js';
import { buildPlayersForSimulation, createEmptyPlayerConfig } from '../../services/playerMapper.js';

const dungeon = () => new Zone('/actions/combat/chimerical_den', 4);
const describeEvent = (event) => ({
  type: event.type,
  time: event.time,
  source: event.source?.hrid ?? event.sourceRef?.hrid,
  target: event.target?.hrid,
  ability: event.ability?.hrid,
});

async function runDungeon(options) {
  const config = createEmptyPlayerConfig(1);
  for (const level of Object.keys(config.levels)) config.levels[level] = 30;
  config.levels.stamina = 100;
  config.food[0] = '/items/donut';
  config.triggerMap['/items/donut'] = [];
  config.abilities[0] = { abilityHrid: '/abilities/fireball', level: 1 };
  const players = buildPlayersForSimulation([config]);
  const zone = dungeon();
  players.forEach((player) => {
    player.zoneBuffs = zone.buffs || [];
    player.extraBuffs = [];
  });
  const simulator = new CombatSimulator(players, zone, null, options);
  const trace = [];
  const processEvent = simulator.processEvent.bind(simulator);
  simulator.processEvent = (event) => {
    trace.push(describeEvent(event));
    return processEvent(event);
  };
  const build = vi.spyOn(simulator, 'buildCombatLog');
  const generate = vi.spyOn(simulator, 'generateCombatLog');
  const append = vi.spyOn(simulator, 'addToWipeLogs');
  const save = vi.spyOn(simulator, 'saveWipeLogsToSimResult');
  const randomValues = [];
  let state = 12345;
  const random = vi.spyOn(Math, 'random').mockImplementation(() => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const value = state / 4294967296;
    randomValues.push(value);
    return value;
  });
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const { wipeEvents, ...physicalResult } = await simulator.simulate(600e9);
    return {
      physicalResult,
      wipeEvents,
      trace,
      randomValues,
      remainingEvents: simulator.eventQueue.minHeap.toArray().map(describeEvent),
      finalPlayerDetails: structuredClone(players.map((player) => player.combatDetails)),
      logCounts: [build, generate, append, save, output].map((spy) => spy.mock.calls.length),
      retainedLogs: simulator.wipeLogs.count,
      bufferLength: simulator.wipeLogs.buffer.length,
    };
  } finally {
    random.mockRestore();
    output.mockRestore();
  }
}

describe('CombatSimulator optional dungeon logging', () => {
  it('skips snapshots while preserving deaths, consumables, RNG and the complete event trajectory', async () => {
    const enabled = await runDungeon({});
    const disabled = await runDungeon({ logCombatEvents: false });

    expect(enabled.wipeEvents.length).toBeGreaterThan(0);
    expect(enabled.wipeEvents.some((event) => event.logs.length > 0)).toBe(true);
    expect(enabled.physicalResult.deaths.player1).toBeGreaterThan(0);
    expect(enabled.physicalResult.consumablesUsed.player1['/items/donut']).toBeGreaterThan(0);
    expect(enabled.logCounts[1]).toBeGreaterThan(0);
    expect(enabled.logCounts[3]).toBeGreaterThan(0);
    expect(disabled.logCounts).toEqual([0, 0, 0, 0, 0]);
    expect(disabled.wipeEvents).toEqual([]);
    expect(disabled.retainedLogs).toBe(0);
    expect(disabled.bufferLength).toBe(0);
    expect(disabled.physicalResult).toEqual(enabled.physicalResult);
    expect(disabled.finalPlayerDetails).toEqual(enabled.finalPlayerDetails);
    expect(disabled.randomValues).toEqual(enabled.randomValues);
    expect(disabled.trace).toEqual(enabled.trace);
    expect(disabled.remainingEvents).toEqual(enabled.remainingEvents);
  });

  const attacks = [
    { name: 'enemy auto attack', method: 'auto', enemyAttacks: true, builds: 0, generates: 1 },
    { name: 'auto attack thorns and retaliation', method: 'auto', enemyAttacks: false, builds: 2, generates: 0 },
    { name: 'enemy damage ability', method: 'ability', enemyAttacks: true, builds: 0, generates: 1 },
    { name: 'ability thorns and retaliation', method: 'ability', enemyAttacks: false, builds: 2, generates: 0 },
    { name: 'damage over time', method: 'dot', enemyAttacks: true, builds: 1, generates: 0 },
  ];
  it.each(attacks.flatMap((attack) => [false, true].map((enabled) => ({ ...attack, enabled }))))(
    'gates snapshot construction for $name when logging is $enabled',
    ({ method, enemyAttacks, builds, generates, enabled }) => {
      const player = new Player();
      player.hrid = 'player1';
      const enemy = new Player();
      enemy.hrid = 'enemy';
      enemy.isPlayer = false;
      for (const unit of [player, enemy]) {
        unit.updateCombatDetails();
        unit.combatDetails.maxHitpoints = unit.combatDetails.currentHitpoints = 1000;
        unit.combatDetails.combatStats.retaliation = 1;
      }
      const simulator = new CombatSimulator([player], dungeon(), null, { logCombatEvents: enabled });
      simulator.enemies = [enemy];
      const source = enemyAttacks ? enemy : player;
      const target = enemyAttacks ? player : enemy;
      const build = vi.spyOn(simulator, 'buildCombatLog');
      const generate = vi.spyOn(simulator, 'generateCombatLog');
      const append = vi.spyOn(simulator, 'addToWipeLogs');
      // Force both reflected damage branches independently of monster balance
      // data; the full dungeon test above exercises unmodified combat outcomes.
      const attack = vi.spyOn(CombatUtilities, 'processAttack').mockImplementation((attacker, defender) => {
        defender.combatDetails.currentHitpoints -= 10;
        attacker.combatDetails.currentHitpoints -= 5;
        return {
          didHit: true,
          damageDone: 10,
          thornDamageDone: 3,
          thornType: 'physicalThorns',
          retaliationDamageDone: 2,
        };
      });
      try {
        if (method === 'auto') simulator.processAutoAttackEvent(new AutoAttackEvent(0, source));
        else if (method === 'ability') {
          const ability = new Ability('/abilities/fireball');
          simulator.processAbilityDamageEffect(source, ability, ability.abilityEffects[0]);
        } else
          simulator.processDamageOverTimeTickEvent(
            new DamageOverTimeEvent(0, source, target, 10, 1, 1, '/combat_styles/magic'),
          );

        expect(build).toHaveBeenCalledTimes(enabled ? builds : 0);
        expect(generate).toHaveBeenCalledTimes(enabled ? generates : 0);
        expect(append).toHaveBeenCalledTimes(enabled ? builds + generates : 0);
        expect(simulator.getOrderedWipeLogs()).toHaveLength(enabled ? builds + generates : 0);
        expect(target.combatDetails.currentHitpoints).toBe(990);
      } finally {
        attack.mockRestore();
      }
    },
  );

  it('does not collect or save snapshots through direct logging helpers when disabled', () => {
    const simulator = new CombatSimulator([], dungeon(), null, { logCombatEvents: false });
    const inspectPlayers = vi.spyOn(simulator.players, 'map');
    const save = vi.spyOn(simulator.simResult, 'addWipeEvent');
    const order = vi.spyOn(simulator, 'getOrderedWipeLogs');
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(simulator.buildCombatLog(null, 'attack', null, 10)).toBeNull();
      expect(simulator.generateCombatLog(null, 'attack', null, { damageDone: 10 })).toBeNull();
      simulator.addToWipeLogs({ error: 'must not be retained' });
      simulator.saveWipeLogsToSimResult(1);
      simulator.logAndResetWipeLogs();

      expect(inspectPlayers).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      expect(order).not.toHaveBeenCalled();
      expect(output).not.toHaveBeenCalled();
      expect(simulator.wipeLogs).toMatchObject({ buffer: [], count: 0, index: 0 });
      expect(simulator.simResult.wipeEvents).toEqual([]);
    } finally {
      output.mockRestore();
    }
  });
});

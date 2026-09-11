import { describe, expect, it, vi } from 'vitest';
import CombatSimulator from '../combatSimulator.js';
import Zone from '../zone.js';
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

  it('does not collect or save snapshots through direct logging helpers when disabled', () => {
    const simulator = new CombatSimulator([], dungeon(), null, { logCombatEvents: false });
    expect(simulator.buildCombatLog(null, 'attack', null, 10)).toBeNull();
    expect(simulator.generateCombatLog(null, 'attack', null, { damageDone: 10 })).toBeNull();
    simulator.addToWipeLogs({ error: 'must not be retained' });
    simulator.saveWipeLogsToSimResult(1);
    simulator.logAndResetWipeLogs();
    expect(simulator.simResult.wipeEvents).toEqual([]);
  });
});

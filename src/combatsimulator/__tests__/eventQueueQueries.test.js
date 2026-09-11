import { describe, expect, it } from 'vitest';
import CombatSimulator from '../combatSimulator.js';
import AbilityCastEndEvent from '../events/abilityCastEndEvent.js';
import AutoAttackEvent from '../events/autoAttackEvent.js';
import EventQueue from '../events/eventQueue.js';

const attackTypes = Object.freeze([AbilityCastEndEvent.type, AutoAttackEvent.type]);
const createQueue = (events = []) => {
  const queue = new EventQueue();
  for (const event of events) queue.addEvent(event);
  return queue;
};
const drain = (queue) => {
  const events = [];
  while (queue.peekNextEvent()) events.push(queue.getNextEvent());
  return events;
};

describe('EventQueue read-only queries', () => {
  it('returns false for an empty queue or an empty type selection', () => {
    const queue = new EventQueue();
    expect(queue.containsEventOfType(AutoAttackEvent.type)).toBe(false);
    expect(queue.containsEventOfTypeAndHrid(AutoAttackEvent.type, 'player1')).toBe(false);
    expect(queue.containsEventOfTypesAndSource(attackTypes, null)).toBe(false);
    queue.addEvent({ time: 1, type: AutoAttackEvent.type, source: null });
    expect(queue.containsEventOfTypesAndSource([], null)).toBe(false);
  });

  it('answers queries without changing the queued events or their pop order', () => {
    const source = Object.freeze({ hrid: 'player1' });
    const events = [9, 3, 3, 7, 1, 3].map((time, index) =>
      Object.freeze({ time, type: index % 2 ? AutoAttackEvent.type : 'regen', hrid: String(index), source }),
    );
    const queue = createQueue(events);
    const untouched = createQueue(events);

    expect(queue.containsEventOfType('regen')).toBe(true);
    expect(queue.containsEventOfType('missing')).toBe(false);
    expect(queue.containsEventOfTypeAndHrid(AutoAttackEvent.type, 3)).toBe(true);
    expect(queue.containsEventOfTypeAndHrid(AutoAttackEvent.type, 4)).toBe(false);
    expect(queue.containsEventOfTypesAndSource(attackTypes, source)).toBe(true);
    expect(queue.containsEventOfTypesAndSource(attackTypes, { hrid: source.hrid })).toBe(false);
    const actual = drain(queue);
    const expected = drain(untouched);
    actual.forEach((event, index) => expect(event).toBe(expected[index]));
    expect(actual).toHaveLength(events.length);
  });

  it('matches source identity without conflating the same hrid or the event target', () => {
    const source = { hrid: 'same' };
    const other = { hrid: 'same' };
    const queue = createQueue([
      { time: 1, type: AbilityCastEndEvent.type, source, target: other },
      { time: 1, type: 'regen', source: other },
    ]);
    expect(queue.containsEventOfTypesAndSource(attackTypes, source)).toBe(true);
    expect(queue.containsEventOfTypesAndSource(attackTypes, other)).toBe(false);
    queue.addEvent({ time: 1, type: AutoAttackEvent.type, source: other });
    expect(queue.containsEventOfTypesAndSource(attackTypes, other)).toBe(true);
  });

  it('observes removals, pops, subsequent additions, and clearing immediately', () => {
    const source = { hrid: 'player1' };
    const other = { hrid: 'player2' };
    const first = { time: 1, type: AbilityCastEndEvent.type, hrid: source.hrid, source };
    const queue = createQueue([
      first,
      { time: 2, type: AutoAttackEvent.type, hrid: source.hrid, source },
      { time: 3, type: AutoAttackEvent.type, hrid: other.hrid, source: other },
      { time: 4, type: 'regen', hrid: source.hrid, source },
    ]);
    expect(queue.getNextEvent()).toBe(first);
    expect(queue.containsEventOfType(AbilityCastEndEvent.type)).toBe(false);
    expect(queue.containsEventOfTypesAndSource(attackTypes, source)).toBe(true);
    queue.clearEventsForUnit(source);
    expect(queue.containsEventOfTypesAndSource(attackTypes, source)).toBe(false);
    expect(queue.containsEventOfTypeAndHrid(AutoAttackEvent.type, source.hrid)).toBe(false);
    expect(queue.containsEventOfTypesAndSource(attackTypes, other)).toBe(true);
    queue.clearEventsOfType(AutoAttackEvent.type);
    expect(queue.containsEventOfType(AutoAttackEvent.type)).toBe(false);
    queue.addEvent(first);
    expect(queue.containsEventOfTypesAndSource(attackTypes, source)).toBe(true);
    queue.clear();
    expect(queue.containsEventOfType(AbilityCastEndEvent.type)).toBe(false);
    expect(queue.containsEventOfTypeAndHrid(AbilityCastEndEvent.type, source.hrid)).toBe(false);
    expect(queue.containsEventOfTypesAndSource(attackTypes, source)).toBe(false);
  });
});

describe('attack scheduling with read-only queue queries', () => {
  it.each(attackTypes)('does not schedule duplicate work while %s is pending for the source', (type) => {
    const source = Object.freeze({ hrid: 'player1' });
    const pending = { time: 10, type, source };
    const simulator = new CombatSimulator([], null, null, { logCombatEvents: false });
    simulator.eventQueue.addEvent(pending);
    simulator.addNextAttackEvent(source);
    expect(simulator.eventQueue.getNextEvent()).toBe(pending);
    expect(simulator.eventQueue.getNextEvent()).toBeUndefined();
  });

  it('allows a distinct source with the same hrid to schedule its own attack', () => {
    const source = {
      hrid: 'same',
      isPlayer: true,
      abilities: [],
      combatDetails: { combatStats: { attackInterval: 5 } },
    };
    const other = { ...source };
    const simulator = new CombatSimulator([source], null, null, { logCombatEvents: false });
    simulator.enemies = [];
    simulator.simulationTime = 100;
    const pending = new AutoAttackEvent(103, other);
    simulator.eventQueue.addEvent(pending);
    simulator.addNextAttackEvent(source);
    simulator.addNextAttackEvent(source);
    expect(simulator.eventQueue.getNextEvent()).toBe(pending);
    const scheduled = simulator.eventQueue.getNextEvent();
    expect(scheduled).toMatchObject({ type: AutoAttackEvent.type, time: 105 });
    expect(scheduled.source).toBe(source);
    expect(simulator.eventQueue.getNextEvent()).toBeUndefined();
  });
});

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

  it('preserves event identity, heap layout, and pop order including time ties', () => {
    const source = Object.freeze({ hrid: 'player1' });
    const events = [9, 3, 3, 7, 1, 3].map((time, index) =>
      Object.freeze({ time, type: index % 2 ? AutoAttackEvent.type : 'regen', hrid: String(index), source }),
    );
    const queue = createQueue(events);
    const untouched = createQueue(events);
    const originalOrder = queue.minHeap.toArray();

    expect(queue.containsEventOfType('regen')).toBe(true);
    expect(queue.containsEventOfType('missing')).toBe(false);
    expect(queue.containsEventOfTypeAndHrid(AutoAttackEvent.type, 3)).toBe(true);
    expect(queue.containsEventOfTypeAndHrid(AutoAttackEvent.type, 4)).toBe(false);
    expect(queue.containsEventOfTypesAndSource(attackTypes, source)).toBe(true);
    expect(queue.containsEventOfTypesAndSource(attackTypes, { hrid: source.hrid })).toBe(false);
    expect(queue.minHeap.length).toBe(events.length);
    originalOrder.forEach((event, index) => expect(queue.minHeap.get(index)).toBe(event));
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

  it.each([
    ['1', 1, true],
    [false, 0, true],
    [null, undefined, true],
    [undefined, null, true],
    [NaN, NaN, false],
    [AutoAttackEvent.type, AbilityCastEndEvent.type, false],
  ])('preserves loose type equality for %s and %s', (storedType, queriedType, expected) => {
    const queue = createQueue([{ time: 1, type: storedType, hrid: '7', source: null }]);
    expect(queue.containsEventOfType(queriedType)).toBe(expected);
    expect(queue.containsEventOfTypeAndHrid(queriedType, 7)).toBe(expected);
    expect(queue.containsEventOfTypeAndHrid(queriedType, 8)).toBe(false);
    expect(queue.containsEventOfTypesAndSource([queriedType], undefined)).toBe(expected);
  });

  it('retains null and undefined equivalence for hrids and sources', () => {
    const queue = createQueue([{ time: 1, type: AutoAttackEvent.type, hrid: null, source: null }]);
    expect(queue.containsEventOfTypeAndHrid(AutoAttackEvent.type, undefined)).toBe(true);
    expect(queue.containsEventOfTypesAndSource(attackTypes, undefined)).toBe(true);
    expect(queue.containsEventOfTypesAndSource(attackTypes, {})).toBe(false);
  });

  it('reads events in the same order and short-circuits like the original attack predicate', () => {
    const source = {};
    const other = {};
    let reads = [];
    const events = [
      [AbilityCastEndEvent.type, other],
      ['regen', source],
      [AutoAttackEvent.type, source],
    ].map(([type, owner], index) => ({
      time: 1,
      get type() {
        reads.push(`${index}:type`);
        return type;
      },
      get source() {
        reads.push(`${index}:source`);
        return owner;
      },
    }));
    const queue = createQueue(events);
    const original = queue.getMatching(
      (event) =>
        (event.type == AbilityCastEndEvent.type || event.type == AutoAttackEvent.type) && event.source == source,
    );
    const originalReads = reads;
    reads = [];
    expect(queue.containsEventOfTypesAndSource(attackTypes, source)).toBe(Boolean(original));
    expect(reads).toEqual(originalReads);
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

  it('keeps getMatching on its original snapshot when the predicate replaces the queue', () => {
    const first = { time: 1, type: 'first' };
    const second = { time: 2, type: 'second' };
    const added = { time: 0, type: 'added' };
    const queue = createQueue([first, second]);
    const visited = [];
    const result = queue.getMatching((event) => {
      visited.push(event);
      if (event === first) {
        queue.clear();
        queue.addEvent(added);
      }
      return event === second;
    });
    expect(result).toBe(second);
    expect(visited).toEqual([first, second]);
    expect(queue.getNextEvent()).toBe(added);
    expect(queue.getMatching(() => true)).toBeNull();
  });

  it('keeps clearMatching on its original snapshot when the predicate inserts events', () => {
    const original = [1, 2, 3].map((time) => ({ time, type: 'original' }));
    const added = { time: 0, type: 'added' };
    const queue = createQueue(original);
    const visited = [];
    expect(
      queue.clearMatching((event) => {
        visited.push(event);
        if (event === original[0]) queue.addEvent(added);
        return true;
      }),
    ).toBe(true);
    expect(visited).toEqual(original);
    expect(queue.getNextEvent()).toBe(added);
    expect(queue.getNextEvent()).toBeUndefined();
    expect(queue.clearMatching(() => true)).toBe(false);
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

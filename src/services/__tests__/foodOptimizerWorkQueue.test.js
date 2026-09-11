import { describe, expect, it, vi } from 'vitest';
import { createFoodOptimizerWorkQueue } from '../foodOptimizerWorkQueue.js';

describe('food composition work allocation', () => {
  it('keeps related work on the same worker while other compositions are available', () => {
    const factories = [vi.fn(() => ['a1', 'a2', 'a3']), vi.fn(() => ['b1', 'b2']), vi.fn(() => ['c1'])];
    const queue = createFoodOptimizerWorkQueue(factories);
    expect(queue.next('first').value).toBe('a1');
    expect(queue.next('second').value).toBe('b1');
    expect(queue.next('first').value).toBe('a2');
    expect(queue.next('second').value).toBe('b2');
    expect(factories[2]).not.toHaveBeenCalled();
    expect(queue.next('second').value).toBe('c1');
    expect(queue.next('first').value).toBe('a3');
    expect(queue.next('first').done).toBe(true);
    expect(queue.next('second').done).toBe(true);
    expect(factories.every((factory) => factory.mock.calls.length === 1)).toBe(true);
  });

  it('lets idle workers consume a long remaining composition without waiting for its owner', () => {
    const queue = createFoodOptimizerWorkQueue([() => ['a1', 'a2', 'a3', 'a4', 'a5'], () => ['b1']]);
    const seen = [queue.next('first').value, queue.next('second').value];
    seen.push(queue.next('second').value, queue.next('third').value, queue.next('first').value);
    expect(seen).toEqual(['a1', 'b1', 'a2', 'a3', 'a4']);
    expect(queue.next('second').value).toBe('a5');
    for (const worker of ['first', 'second', 'third']) expect(queue.next(worker).done).toBe(true);
  });

  it('preserves every yielded block exactly once across uneven and empty groups', () => {
    const groups = Array.from({ length: 11 }, (_, group) =>
      Array.from({ length: group % 5 }, (_, point) => ({ group, point, coveredCandidates: 10 ** point })),
    );
    const queue = createFoodOptimizerWorkQueue(groups.map((group) => () => group));
    const seen = [];
    let done = 0;
    while (done < 4) {
      done = 0;
      for (const worker of ['a', 'b', 'a', 'c']) {
        const entry = queue.next(worker);
        if (entry.done) done += 1;
        else seen.push(entry.value);
      }
    }
    expect(new Set(seen).size).toBe(groups.flat().length);
    expect(new Set(seen)).toEqual(new Set(groups.flat()));
  });

  it('clears pending and assigned work without opening another composition', () => {
    const unopened = vi.fn(() => ['b1']);
    const queue = createFoodOptimizerWorkQueue([() => ['a1', 'a2'], unopened]);
    expect(queue.next('first').value).toBe('a1');
    queue.clear();
    expect(queue.next('first').done).toBe(true);
    expect(queue.next('second').done).toBe(true);
    expect(unopened).not.toHaveBeenCalled();
  });
});

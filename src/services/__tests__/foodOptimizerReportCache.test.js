import { describe, expect, it } from 'vitest';
import { createFoodOptimizerReportCache } from '../foodOptimizerReportCache.js';

const completed = (inputSignature = 'input') => ({
  inputSignature,
  request: { inputSignature, rounds: 2 },
  complete: true,
  status: 'completed',
  stale: false,
  fromCache: false,
  appliedSignature: null,
  appliedInputSignature: '',
  startedAt: 100,
  finishedAt: 900,
  baseline: { costPerHour: 50, deaths: 3 },
  stats: { totalCandidates: 20, completedCandidates: 20, completedRounds: 12 },
  topResults: [
    { signature: 'candidate', feasible: true, roundsCompleted: 2, costPerHour: 5, samples: [{ seed: 1 }, { seed: 2 }] },
  ],
});

describe('completed food optimizer report cache', () => {
  it('isolates recorded and retrieved reports while preserving the original computation statistics', () => {
    const cache = createFoodOptimizerReportCache();
    const report = completed();
    expect(cache.record('input', report)).toBe(true);
    report.topResults[0].costPerHour = 999;
    report.stale = true;
    report.appliedSignature = 'candidate';
    const hit = cache.get('input');
    expect(hit).toMatchObject({
      stale: false,
      fromCache: true,
      appliedSignature: null,
      appliedInputSignature: '',
      startedAt: 100,
      finishedAt: 900,
    });
    expect(hit.stats.completedRounds).toBe(12);
    expect(hit.topResults[0].costPerHour).toBe(5);
    hit.topResults[0].samples[0].seed = 99;
    hit.appliedInputSignature = 'changed';
    expect(cache.get('input').topResults[0].samples[0].seed).toBe(1);
    expect(cache.get('input').appliedInputSignature).toBe('');
  });

  it('keeps four recent inputs and refreshes recency on a hit', () => {
    const cache = createFoodOptimizerReportCache();
    for (const key of ['a', 'b', 'c', 'd']) cache.record(key, completed(key));
    cache.get('a');
    cache.record('e', completed('e'));
    expect(cache.size).toBe(4);
    expect(cache.get('b')).toBeNull();
    for (const key of ['a', 'c', 'd', 'e']) expect(cache.get(key)).not.toBeNull();
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeNull();
  });

  it.each([
    { status: 'cancelled' },
    { status: 'error' },
    { complete: false },
    { stale: true },
    { error: 'failed' },
    { inputSignature: 'changed' },
    { request: { inputSignature: 'changed', rounds: 2 } },
    { baseline: null },
    { stats: { totalCandidates: 20, completedCandidates: 19 } },
    { topResults: [{ feasible: true, roundsCompleted: 1 }] },
    { topResults: [{ feasible: false, roundsCompleted: 2 }] },
  ])('does not cache an unusable report: %j', (changes) => {
    const cache = createFoodOptimizerReportCache();
    expect(cache.record('input', { ...completed(), ...changes })).toBe(false);
    expect(cache.get('input')).toBeNull();
  });

  it('retains completed searches that found no feasible candidates', () => {
    const cache = createFoodOptimizerReportCache();
    expect(cache.record('input', { ...completed(), topResults: [] })).toBe(true);
    expect(cache.get('input').topResults).toEqual([]);
  });

  it('isolates caches and only matches the exact request signature', () => {
    const first = createFoodOptimizerReportCache();
    const second = createFoodOptimizerReportCache();
    first.record('input', completed());
    expect(first.get('other')).toBeNull();
    expect(second.get('input')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import Trigger from '../../combatsimulator/trigger.js';
import {
  buildFoodCandidate,
  buildFoodDefaultCandidate,
  generateFoodOptimizerCompositionCandidates,
} from '../foodOptimizerDomain.js';
import {
  createFoodOptimizerPruningCache,
  generatePrunedFoodOptimizerCandidates,
  intersectFoodOptimizerThresholds,
  observeFoodOptimizerThresholds,
  observeUnusedFoodThresholds,
  materializeFoodOptimizerOutcome,
} from '../foodOptimizerPruning.js';

const item = (hrid, kind = 'mp', thresholds = [100, 50, 10]) => ({ hrid, kind, thresholds, restore: 50, price: 1 });
const failure = (candidate, min = 1, max = 100) => ({
  rejected: 'mana',
  roundsCompleted: 1,
  samples: [{ seed: 1, ranOutOfMana: true, stoppedEarly: true }],
  equivalentThresholds: candidate.slots.map(({ hrid, kind }) => ({ hrid, kind, min, max })),
});
const success = (candidate, min = 1, max = 100) => ({
  ...failure(candidate, min, max),
  rejected: '',
  feasible: true,
  ranOutOfMana: false,
  deaths: 0,
  costPerHour: 100,
  foodUsed: Object.fromEntries(candidate.food.map((hrid) => [hrid, 1])),
  roundsCompleted: 3,
  samples: [1, 2, 3].map((seed) => ({ seed, ranOutOfMana: false, stoppedEarly: false })),
});

const food = (hrid, thresholds = [90, 60, 30]) => ({ hrid, kind: 'mp', restore: 60, price: 1, thresholds });
const candidateFor = (items, threshold = 60) => buildFoodCandidate(items.map((item) => ({ ...item, threshold })));
const proofFor = (candidate, overrides = {}) => ({
  feasible: null,
  rejected: '',
  ranOutOfMana: false,
  pruned: 'cost',
  costLowerBound: 120,
  roundsCompleted: 1,
  samples: [{ seed: 1, stoppedEarly: true, ranOutOfMana: false, pruned: 'cost' }],
  equivalentThresholds: candidate.slots.map(({ hrid, kind }) => ({ hrid, kind, min: 30, max: 90 })),
  ...overrides,
});

// Small consumed-core budgets: the identity rewrites below certify a single
// food through the failure core index.
const failureCapacity = { maxFailureCoreEntries: 32, maxCoreGroupEntries: 8 };
// One recorded failure whose consumed core is food 'a' alone, plus the two-food
// probe block both identity tests reuse. The core covers the probe's first food
// while the second one only has to stay inactive, so the frozen query answers
// the block through its memoized grid membership and core proof even after one
// of its slots stops being answerable.
const recordedProbe = () => {
  // The third food only exists in the grid: the probe block starts at two slots,
  // so a later grown block still resolves there and a fresh query can answer it.
  const items = [food('a'), food('c'), food('d')];
  const cache = createFoodOptimizerPruningCache({ items, rounds: 1, ...failureCapacity });
  const recorded = buildFoodCandidate([{ ...items[0], threshold: 60 }]);
  cache.record(recorded, {
    rejected: 'mana',
    roundsCompleted: 1,
    samples: [
      {
        seed: 1,
        ranOutOfMana: true,
        stoppedEarly: true,
        foodUsed: { a: 1 },
        inactiveFoodThresholds: { hp: 1, mp: 1 },
      },
    ],
    equivalentThresholds: recorded.slots.map(({ hrid, kind }) => ({ hrid, kind, min: 1, max: 100 })),
  });
  return {
    cache,
    domains: [
      { ...items[0], min: 60, max: 60 },
      { ...items[1], min: 60, max: 60 },
    ],
    items,
  };
};

describe('provable food optimizer pruning', () => {
  it('records integer threshold intervals from actual comparisons, including fractional resource values', () => {
    const candidate = buildFoodCandidate([{ ...item('mana'), threshold: 50 }]);
    const trigger = Trigger.createFromDTO(candidate.triggerMap.mana[0]);
    const read = observeFoodOptimizerThresholds({ food: [{ hrid: 'mana', triggers: [trigger] }] }, candidate);
    expect(trigger.compareValue(10.5)).toBe(false);
    expect(trigger.compareValue(49.5)).toBe(false);
    expect(trigger.compareValue(70.5)).toBe(true);
    expect(trigger.compareValue(55.9)).toBe(true);
    expect(read()).toEqual([{ hrid: 'mana', kind: 'mp', min: 50, max: 55 }]);
  });

  it('declines to certify unexpected trigger rules or invalid resource values', () => {
    const candidate = buildFoodCandidate([{ ...item('mana'), threshold: 50 }]);
    const trigger = Trigger.createFromDTO(candidate.triggerMap.mana[0]);
    trigger.comparatorHrid = '/combat_trigger_comparators/less_than_equal';
    const player = { food: [{ hrid: 'mana', triggers: [trigger] }] };
    expect(observeFoodOptimizerThresholds(player, candidate)()).toBeNull();
    trigger.comparatorHrid = '/combat_trigger_comparators/greater_than_equal';
    const read = observeFoodOptimizerThresholds(player, candidate);
    trigger.compareValue(NaN);
    expect(read()).toBeNull();
  });

  it('intersects observations across rounds instead of reusing only the final round', () => {
    const a = [{ hrid: 'mana', kind: 'mp', min: 10, max: 80 }];
    const b = [{ hrid: 'mana', kind: 'mp', min: 30, max: 90 }];
    expect(intersectFoodOptimizerThresholds(a, b)).toEqual([{ hrid: 'mana', kind: 'mp', min: 30, max: 80 }]);
    expect(intersectFoodOptimizerThresholds(a, null)).toBeNull();
    expect(intersectFoodOptimizerThresholds(a, [{ ...b[0], hrid: 'other' }])).toBeNull();
    expect(intersectFoodOptimizerThresholds(a, [{ ...b[0], min: 81 }])).toBeNull();
  });

  it('skips only thresholds inside a certified failure interval', () => {
    const cache = createFoodOptimizerPruningCache();
    const food = item('mana');
    const candidate = buildFoodCandidate([{ ...food, threshold: 50 }]);
    cache.record(candidate, failure(candidate, 21, 100));
    expect(cache.match(buildFoodCandidate([{ ...food, threshold: 100 }]))?.result.rejected).toBe('mana');
    expect(cache.match(buildFoodCandidate([{ ...food, threshold: 21 }]))?.result.rejected).toBe('mana');
    expect(cache.match(buildFoodCandidate([{ ...food, threshold: 20 }]))).toBeNull();
    expect(cache.match(buildFoodCandidate([{ ...item('other'), threshold: 50 }]))).toBeNull();
  });

  it('keeps reordered slots eligible, including restoration and price tie breakers', () => {
    const foods = [
      { ...item('a', 'mp', [30, 20, 10]), restore: 20 },
      { ...item('b', 'mp', [30, 20, 10]), restore: 40 },
    ];
    const observed = buildFoodCandidate([
      { ...foods[0], threshold: 30 },
      { ...foods[1], threshold: 10 },
    ]);
    const cache = createFoodOptimizerPruningCache();
    cache.record(observed, failure(observed, 1, 30));
    const all = [...generateFoodOptimizerCompositionCandidates(foods)];
    const sameOrder = all.filter((candidate) => candidate.food.join(',') === observed.food.join(','));
    for (const candidate of all)
      expect(cache.match(candidate)?.result.rejected ?? null).toBe(sameOrder.includes(candidate) ? 'mana' : null);
    const jobs = [...generatePrunedFoodOptimizerCandidates(foods, cache, observed)];
    expect(jobs.reduce((sum, job) => sum + (job.coveredCandidates || 0), 0)).toBe(sameOrder.length - 1);
    expect(
      jobs
        .filter((job) => !job.coveredCandidates)
        .map((candidate) => candidate.signature)
        .sort(),
    ).toEqual(
      all
        .filter((candidate) => !sameOrder.includes(candidate))
        .map((candidate) => candidate.signature)
        .sort(),
    );
  });

  it('enumerates every remaining candidate when no certified interval covers it', () => {
    const foods = [item('mana'), item('health', 'hp')];
    const baseline = buildFoodDefaultCandidate(foods);
    const cache = createFoodOptimizerPruningCache();
    expect(
      [...generatePrunedFoodOptimizerCandidates(foods, cache, baseline)].map((candidate) => candidate.signature),
    ).toEqual(
      [...generateFoodOptimizerCompositionCandidates(foods)]
        .filter((candidate) => candidate.signature !== baseline.signature)
        .map((candidate) => candidate.signature),
    );
    expect([...generatePrunedFoodOptimizerCandidates([], cache, buildFoodCandidate([]))]).toEqual([]);
  });

  it('ignores uncertified or incomplete results', () => {
    const cache = createFoodOptimizerPruningCache({ rounds: 3 });
    const candidate = buildFoodCandidate([{ ...item('mana'), threshold: 50 }]);
    cache.record(candidate, { rejected: 'mana' });
    cache.record(candidate, { ...failure(candidate), rejected: '', feasible: true });
    cache.record(candidate, failure(candidate, 60, 100));
    cache.record(candidate, failure(candidate, 50, 50));
    expect(cache.size).toBe(0);
  });

  it('records a conservative never-trigger range at every no-food trigger check', () => {
    const simulator = { checkTriggersForUnit: () => false };
    const player = {
      hrid: 'player1',
      combatDetails: { maxHitpoints: 100, currentHitpoints: 75, maxManapoints: 100, currentManapoints: 70 },
    };
    const read = observeUnusedFoodThresholds(simulator, 'player1');
    expect(simulator.checkTriggersForUnit(player)).toBe(false);
    player.combatDetails.currentHitpoints = 95;
    player.combatDetails.currentManapoints = 50;
    simulator.checkTriggersForUnit(player);
    player.isStunned = true;
    player.combatDetails.currentManapoints = 0;
    simulator.checkTriggersForUnit(player);
    expect(read()).toEqual({ hp: 26, mp: 51 });
  });

  it('reuses no-food outcomes across compositions and orders only when every added food stays inactive', () => {
    const empty = buildFoodCandidate([]);
    const result = {
      ...success(empty),
      costPerHour: 0,
      unusedFoodThresholds: { hp: 26, mp: 51 },
      samples: [1, 2, 3].map((seed) => ({
        seed,
        stoppedEarly: false,
        ranOutOfMana: false,
        foodUsed: {},
        unusedFoodThresholds: { hp: 26, mp: 51 },
      })),
    };
    const cache = createFoodOptimizerPruningCache({ rounds: 3 });
    cache.record(empty, result);
    const candidate = buildFoodCandidate([
      { ...item('hp', 'hp'), threshold: 26 },
      { ...item('mp'), threshold: 51 },
    ]);
    const evidence = cache.match(candidate);
    expect(evidence.unusedFood).toBe(true);
    const reused = materializeFoodOptimizerOutcome(evidence, candidate);
    expect(reused).toMatchObject({
      feasible: true,
      costPerHour: 0,
      foodUsed: { hp: 0, mp: 0 },
      unusedFoodThresholds: null,
    });
    expect(reused.samples.every((sample) => sample.foodUsed.hp === 0 && sample.foodUsed.mp === 0)).toBe(true);
    expect(cache.match(buildFoodCandidate([{ ...item('mp'), threshold: 50 }]))).toBeNull();
    expect(cache.match(buildFoodCandidate([{ ...item('hp', 'hp'), threshold: 25 }]))).toBeNull();
  });
});

describe('food optimizer ranking certificates', () => {
  it('keeps cost evidence separate from complete feasibility evidence and rechecks the current cutoff', () => {
    const items = [food('a')];
    const candidate = candidateFor(items);
    let cutoff = 100;
    const cache = createFoodOptimizerPruningCache({ items, rounds: 3, getCostCutoff: () => cutoff });
    cache.record(candidate, proofFor(candidate));
    expect(cache.size).toBe(1);
    expect(cache.feasibleSize).toBe(0);
    expect(cache.match(candidate)?.result).toMatchObject({ pruned: 'cost', costLowerBound: 120 });
    cutoff = 50;
    expect(cache.match(candidateFor(items, 30))?.result.pruned).toBe('cost');
    cutoff = 120;
    expect(cache.match(candidate)).toBeNull();
    cutoff = undefined;
    expect(cache.match(candidate)).toBeNull();
    cutoff = 100;
    expect(cache.match(candidate)).not.toBeNull();
    expect(cache.match(candidateFor(items, 10))).toBeNull();
  });

  it.each([
    ['cost tie', () => 120, {}],
    ['floating-point boundary', () => 120, { costLowerBound: 120 + Number.EPSILON * 120 }],
    ['claimed feasibility', () => 100, { feasible: true }],
    ['missing sample', () => 100, { samples: [] }],
  ])('does not cache %s as a cost certificate', (name, getCostCutoff, overrides) => {
    const items = [food('a')];
    const candidate = candidateFor(items);
    const cache = createFoodOptimizerPruningCache({ items, rounds: 3, getCostCutoff });
    cache.record(candidate, proofFor(candidate, overrides));
    expect(cache.size).toBe(0);
    expect(cache.match(candidate)).toBeNull();
  });

  it('preserves food order and refuses incompatible prices or compositions', () => {
    const items = [food('a'), { ...food('b'), price: 2 }];
    const candidate = buildFoodCandidate([
      { ...items[0], threshold: 90 },
      { ...items[1], threshold: 30 },
    ]);
    const cache = createFoodOptimizerPruningCache({ items, rounds: 3, getCostCutoff: () => 100 });
    cache.record(candidate, proofFor(candidate));
    expect(cache.match(candidateFor(items))?.result.pruned).toBe('cost');
    expect(
      cache.match(
        buildFoodCandidate([
          { ...items[0], threshold: 30 },
          { ...items[1], threshold: 90 },
        ]),
      ),
    ).toBeNull();
    expect(cache.match(candidateFor([{ ...items[0], price: 3 }, items[1]]))).toBeNull();
    expect(cache.match(candidateFor([items[0]]))).toBeNull();
  });

  it('never publishes a cost-stopped no-food sample as global unused-food evidence', () => {
    const candidate = buildFoodCandidate([]);
    const cache = createFoodOptimizerPruningCache({ rounds: 3, getCostCutoff: () => 100 });
    cache.record(
      candidate,
      proofFor(candidate, {
        unusedFoodThresholds: { hp: 1, mp: 1 },
        samples: [{ seed: 1, stoppedEarly: true, ranOutOfMana: false, unusedFoodThresholds: { hp: 1, mp: 1 } }],
      }),
    );
    expect(cache.match(candidate)).toBeNull();
    expect(cache.match(candidateFor([food('a')]))).toBeNull();
  });

  it('uses the full ranking lower bound only after cost and deaths reach zero', () => {
    const items = [food('a'), food('b')];
    let cutoff = { costPerHour: 0, deaths: 0, slots: [{}] };
    const cache = createFoodOptimizerPruningCache({ items, getRankCutoff: () => cutoff });
    const pair = candidateFor(items);
    expect(cache.match(pair)?.result).toMatchObject({
      feasible: null,
      rejected: '',
      pruned: 'rank',
      roundsCompleted: 0,
      rankLowerBound: { costPerHour: 0, deaths: 0, slotCount: 2 },
    });
    expect(cache.match(candidateFor([items[0]]))).toBeNull();
    cutoff = { ...cutoff, deaths: 1 };
    expect(cache.match(pair)).toBeNull();
    cutoff = { ...cutoff, deaths: 0, costPerHour: 1 };
    expect(cache.match(pair)).toBeNull();
    cutoff = undefined;
    expect(cache.match(pair)).toBeNull();
  });

  // QUERY_GUARD_FIELDS freezes every identity field the memoized derivations
  // keep. A rewritten slot is only safe while the guard drops the query, so
  // each case compares the reused answer against a freshly built one.
  it.each([
    ['hrid', (domain) => (domain.hrid = 'missing')],
    ['kind', (domain) => (domain.kind = 'hp')],
    ['restore', (domain) => (domain.restore += 1)],
    ['price', (domain) => (domain.price += 1)],
    ['recoveryDuration', (domain) => (domain.recoveryDuration = 1)],
  ])('drops the memoized query when the slot %s is rewritten in place', (_field, rewrite) => {
    const { cache, domains } = recordedProbe();
    // The first call answers the recorded failure through the memoized query.
    expect(cache.matchRanges(domains)?.result.rejected).toBe('mana');
    rewrite(domains[1]);
    const reused = cache.matchRanges(domains);
    // recoveryDuration feeds no decision today, so its rewrite cannot change
    // any answer yet; every other field leaves the rewritten slot unanswerable,
    // and the reused query must match a freshly built one in every case.
    expect(reused?.result.rejected).toEqual(_field === 'recoveryDuration' ? 'mana' : undefined);
    expect(reused).toEqual(cache.matchRanges(domains, false));
  });

  // The import-time coverage proof checks the replaced-slot branch of the guard
  // directly; this covers the end-to-end wiring through the reuse guard.
  it('drops the memoized query when a caller replaces a slot object', () => {
    const { cache, domains } = recordedProbe();
    expect(cache.matchRanges(domains)?.result.rejected).toBe('mana');
    // The replacement carries a kind the grid cannot resolve, so a freshly built
    // query rejects the block; a reused one must not answer it from the frozen
    // grid items instead.
    domains[1] = { ...domains[1], kind: 'hp' };
    const reused = cache.matchRanges(domains);
    expect(reused).toEqual(cache.matchRanges(domains, false));
    expect(reused).toBeNull();
  });

  // The probe block is addressed by position and the reused array is expected to
  // keep its length; a grown block rebuilds the query instead of answering from
  // the memoized grid items of the shorter one.
  it('rebuilds the memoized query when the probe block grows', () => {
    const { cache, domains, items } = recordedProbe();
    expect(cache.matchRanges(domains)?.result.rejected).toBe('mana');
    domains.push({ ...items[2], min: 60, max: 60 });
    const reused = cache.matchRanges(domains);
    expect(reused).toEqual(cache.matchRanges(domains, false));
    expect(reused?.result.rejected).toBe('mana');
  });

  it('compresses a newly dominated billion-point region without losing or duplicating its default', () => {
    const thresholds = Array.from({ length: 1000 }, (_, index) => 1000 - index);
    const items = [food('a', thresholds), food('b', thresholds), food('c', thresholds)];
    let cutoff;
    const cache = createFoodOptimizerPruningCache({ items, getRankCutoff: () => cutoff });
    const excluded = buildFoodDefaultCandidate(items);
    const iterator = generatePrunedFoodOptimizerCandidates(items, cache, excluded, { captureCoverage: true });
    const first = iterator.next();
    expect(first.done).toBe(false);
    cutoff = { costPerHour: 0, deaths: 0, slots: [{}] };
    const blocks = [...iterator];
    expect(blocks.length).toBeLessThan(8);
    expect(blocks.every((block) => block.evidence.result.pruned === 'rank')).toBe(true);
    expect(blocks.filter((block) => block.excludedSignature === excluded.signature)).toHaveLength(1);
  });
});

describe('food optimizer slot-aware death budgets', () => {
  // 预算只随槽位数变化（少带食物 ⇒ 更低），而证书是按记录那次运行的预算签发的。这里用一份
  // 可变预算复现「同一份证书面对两个预算」：闸门必须按查询预算重判，或拒绝复用、退回重新模拟。
  const gated = (overrides = {}) => {
    let budget = 3;
    const items = [food('a')];
    const candidate = candidateFor(items);
    const cache = createFoodOptimizerPruningCache({
      items,
      rounds: 3,
      getDeathBudget: () => budget,
      ...overrides,
    });
    return { cache, candidate, setBudget: (value) => (budget = value) };
  };

  it('reclassifies a complete run that dies beyond the query budget instead of lending it out as feasible', () => {
    const { cache, candidate, setBudget } = gated();
    cache.record(candidate, { ...success(candidate), deaths: 3 });
    expect(cache.match(candidate)?.result).toMatchObject({ feasible: true, deaths: 3 });

    // 少带一件食物的查询预算更低（3 → 2）：同一份证书必须就地改判成死亡淘汰。
    setBudget(2);
    expect(cache.match(candidate)?.result).toMatchObject({ feasible: false, rejected: 'deaths', deaths: 3 });

    // 改判只影响返回值：证书本身没有被改写，预算回升后依旧按可行签发。
    setBudget(3);
    expect(cache.match(candidate)?.result.feasible).toBe(true);
    expect(cache.size).toBe(1);
    expect(cache.feasibleSize).toBe(1);
  });

  it('keeps a deaths certificate only while the query budget can no longer prove a higher one', () => {
    const { cache, candidate, setBudget } = gated();
    cache.record(candidate, { ...success(candidate), feasible: false, rejected: 'deaths', deaths: 4 });
    expect(cache.match(candidate)?.result.rejected).toBe('deaths');

    // 查询预算更低：记录那次在 4 死处截断，低预算下同样成立。
    setBudget(2);
    expect(cache.match(candidate)?.result.rejected).toBe('deaths');

    // 查询预算更高：那份结论只证明「超过 3 死」，不能拿来断言 4 死预算下也失败。
    setBudget(4);
    expect(cache.match(candidate)).toBeNull();
  });

  it('needs the trajectory to reach its event before lending a mana or cost certificate', () => {
    const { cache, candidate, setBudget } = gated();
    cache.record(candidate, failure(candidate));
    expect(cache.match(candidate)?.result.rejected).toBe('mana');

    // 查询预算更高：同一轨迹依旧先空蓝，结论照常成立。
    setBudget(4);
    expect(cache.match(candidate)?.result.rejected).toBe('mana');

    // 查询预算更低：查询可能更早因死亡截断，空蓝结论不再成立。
    setBudget(2);
    expect(cache.match(candidate)).toBeNull();

    const cost = gated({ getCostCutoff: () => 100 });
    cost.cache.record(cost.candidate, proofFor(cost.candidate));
    expect(cost.cache.match(cost.candidate)?.result.pruned).toBe('cost');
    cost.setBudget(4);
    expect(cost.cache.match(cost.candidate)?.result.pruned).toBe('cost');
    cost.setBudget(2);
    expect(cost.cache.match(cost.candidate)).toBeNull();
  });

  it('gates a cross-slot core certificate by the budget of the query that matches it', () => {
    const items = [food('a'), food('b')];
    const oneSlot = buildFoodCandidate([{ ...items[0], threshold: 60 }]);
    const twoSlot = buildFoodCandidate([
      { ...items[0], threshold: 60 },
      { ...items[1], threshold: 60 },
    ]);
    const domains = ({ slots }) => slots.map((slot) => ({ ...slot, min: slot.threshold, max: slot.threshold }));
    const deaths = (candidate) => ({
      feasible: false,
      rejected: 'deaths',
      roundsCompleted: 3,
      deaths: 4,
      foodUsed: { a: 1, b: 0 },
      inactiveFoodThresholds: { hp: 1, mp: 1 },
      samples: [1, 2, 3].map((seed) => ({ seed, ranOutOfMana: false, stoppedEarly: false, foodUsed: { a: 1, b: 0 } })),
      equivalentThresholds: candidate.slots.map(({ hrid, kind }) => ({ hrid, kind, min: 1, max: 100 })),
    });
    // 基线 2 槽：只带 1 件的候选预算 3，带满 2 件的候选预算 4。
    const cacheFor = (candidate) => {
      const cache = createFoodOptimizerPruningCache({
        items,
        rounds: 3,
        getDeathBudget: (slotCount) => (slotCount < 2 ? 3 : 4),
        ...failureCapacity,
      });
      cache.record(candidate, deaths(candidate));
      return cache;
    };

    // 1 槽记录（预算 3）的「已死」结论只在 3 死以内成立：2 槽查询（预算 4）必须重新模拟。
    expect(cacheFor(oneSlot).matchRanges(domains(twoSlot))).toBeNull();

    // 2 槽记录（预算 4）的同一结论对 1 槽查询（预算 3）依然成立：核心证书可以照常复用。
    const evidence = cacheFor(twoSlot).matchRanges(domains(oneSlot));
    expect(evidence?.result.rejected).toBe('deaths');
    expect(evidence?.coreRanges).toEqual([{ hrid: 'a', kind: 'mp', min: 1, max: 100 }]);
  });

  // 空跑证书只按记录那次运行的预算签发：基线 2 槽时它记录在 0 槽的预算（3）上，对 2 槽查询
  // （预算 4）只能证明「0 槽会死」，不能外借。闸门拒绝后必须继续往下找别的证书，而不是把整条
  // 查询作废——否则这一整块会连同排名界、同 composition 组证书、consumed-core 一起退回逐候选模拟。
  const unusedFoodBlock = (overrides = {}) => {
    const items = [food('a'), food('b')];
    const cache = createFoodOptimizerPruningCache({
      items,
      rounds: 3,
      getDeathBudget: (slotCount) => (slotCount < 2 ? 3 : 4),
      ...overrides,
    });
    cache.record(buildFoodCandidate([]), {
      feasible: false,
      rejected: 'deaths',
      deaths: 4,
      costPerHour: 0,
      foodUsed: {},
      roundsCompleted: 3,
      unusedFoodThresholds: { hp: 1, mp: 1 },
      samples: [1, 2, 3].map((seed) => ({
        seed,
        stoppedEarly: true,
        ranOutOfMana: false,
        foodUsed: {},
        unusedFoodThresholds: { hp: 1, mp: 1 },
      })),
    });
    // 两个食物都在网格里，且阈值高于空跑观察到的亏损上界 ⇒ 整块命中空跑证书。
    // 控制断言（守住用例本身的有效性）：同一片区域的 1 槽查询（预算 3 = 记录预算）必须由
    // 空跑证书亲自回答。少了它，「证书没登记」会让下面两条用例因为「反正没有证书可用」而
    // 空过——断言从「闸门拒绝 ⇒ 继续下探」退化成「证书存在 ⇒ 有答案」，守不住落空语义。
    expect(cache.matchRanges([{ ...items[0], min: 90, max: 90 }])?.unusedFood).toBe(true);
    return { cache, items, domains: items.map((item) => ({ ...item, min: 90, max: 90 })) };
  };

  it('falls through to the ranking bound when the unused-food certificate cannot serve the query budget', () => {
    const { cache, domains } = unusedFoodBlock({
      getRankCutoff: () => ({ costPerHour: 0, deaths: 0, slots: [{}] }),
    });
    expect(cache.matchRanges(domains)?.result).toMatchObject({ pruned: 'rank', feasible: null });
  });

  it('falls through to the composition group when the unused-food certificate cannot serve the query budget', () => {
    const { cache, items, domains } = unusedFoodBlock();
    const pair = buildFoodCandidate([
      { ...items[0], threshold: 90 },
      { ...items[1], threshold: 90 },
    ]);
    cache.record(pair, success(pair));
    const evidence = cache.matchRanges(domains);
    // 答案必须来自同 composition 组证书，而不是空跑证书（后者是 0 槽的死亡淘汰结论）。
    expect(evidence?.unusedFood).toBeUndefined();
    expect(evidence?.result.feasible).toBe(true);
  });

  it('stays ungated when the budget source is missing or dirty', () => {
    const items = [food('a')];
    const candidate = candidateFor(items);
    const dying = { ...success(candidate), deaths: 4 };
    for (const value of [undefined, null, -1, 1.5, NaN, '2']) {
      const cache = createFoodOptimizerPruningCache({ items, rounds: 3, getDeathBudget: () => value });
      cache.record(candidate, dying);
      expect(cache.match(candidate)?.result.feasible).toBe(true);
    }
    // 没注入 getter 的缓存（自定义缓存或只关心成本/等效性的调用方）保持原有复用行为。
    const plain = createFoodOptimizerPruningCache({ items, rounds: 3 });
    plain.record(candidate, dying);
    expect(plain.match(candidate)?.result.feasible).toBe(true);
  });
});

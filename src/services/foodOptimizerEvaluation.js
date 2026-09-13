import { buildFoodCandidate, hasEmptyFoodOptimizerBaseline } from './foodOptimizerDomain.js';
import { intersectFoodOptimizerThresholds, intersectUnusedFoodThresholds } from './foodOptimizerPruning.js';
import { matchFoodOptimizerReusableSample } from './foodOptimizerRoundCache.js';
import { assertFoodOptimizerTarget } from './foodOptimizerTarget.js';

export function createFoodOptimizerEvaluationState() {
  return {
    samples: [],
    deaths: 0,
    rejected: '',
    simulatedRounds: 0,
    reusedRounds: 0,
    equivalentThresholds: undefined,
    unusedFoodThresholds: undefined,
    inactiveFoodThresholds: undefined,
  };
}

export function appendFoodOptimizerEvaluationSample(state, sample, candidate, deathBudget) {
  const first = state.samples.length === 0;
  state.samples.push(sample);
  state.equivalentThresholds = first
    ? (sample.equivalentThresholds ?? null)
    : intersectFoodOptimizerThresholds(state.equivalentThresholds, sample.equivalentThresholds);
  state.unusedFoodThresholds = first
    ? (sample.unusedFoodThresholds ?? null)
    : intersectUnusedFoodThresholds(state.unusedFoodThresholds, sample.unusedFoodThresholds);
  state.inactiveFoodThresholds = first
    ? (sample.inactiveFoodThresholds ?? null)
    : intersectUnusedFoodThresholds(state.inactiveFoodThresholds, sample.inactiveFoodThresholds);
  state.deaths += sample.deaths;
  if (candidate && sample.ranOutOfMana) {
    state.rejected = 'mana';
    // One failing seed alone proves infeasibility. Earlier rounds need not
    // follow the same path; cumulative death failures still need the intersection.
    state.equivalentThresholds = sample.equivalentThresholds ?? null;
    state.unusedFoodThresholds = sample.unusedFoodThresholds ?? null;
  } else if (candidate && state.deaths > deathBudget) state.rejected = 'deaths';
}

export function finishFoodOptimizerEvaluation(state, request) {
  const { samples } = state;
  const prunedForCost = state.pruned === 'cost' && !state.rejected;
  const foodUsed = {};
  // Keep division before addition, and preserve the original sample/key order.
  for (const sample of samples)
    for (const [hrid, count] of Object.entries(sample.foodUsed))
      foodUsed[hrid] = (foodUsed[hrid] || 0) + count / samples.length;
  return {
    samples,
    roundsCompleted: samples.length,
    simulatedRounds: state.simulatedRounds,
    reusedRounds: state.reusedRounds,
    deaths: state.deaths,
    ranOutOfMana: samples.some((sample) => sample.ranOutOfMana),
    rejected: state.rejected,
    equivalentThresholds: state.equivalentThresholds,
    unusedFoodThresholds: prunedForCost ? null : state.unusedFoodThresholds,
    inactiveFoodThresholds: state.inactiveFoodThresholds,
    feasible: prunedForCost ? null : !state.rejected && samples.length === request.rounds,
    foodUsed,
    costPerHour: prunedForCost ? null : samples.reduce((sum, sample) => sum + sample.costPerHour, 0) / samples.length,
    ...(prunedForCost ? { pruned: 'cost', costLowerBound: state.costLowerBound } : {}),
  };
}

// This path accepts only a complete aligned set of certificates. Validate even
// rounds beyond a possible death-failure prefix before choosing to skip a Worker.
export function tryEvaluateFoodOptimizerCachedCandidate(request, candidate, deathBudget, reusableSamples) {
  assertFoodOptimizerTarget(request);
  if (
    !Number.isSafeInteger(request?.rounds) ||
    request.rounds < 1 ||
    !Array.isArray(request.seeds) ||
    request.seeds.length < request.rounds ||
    !Array.isArray(reusableSamples) ||
    reusableSamples.length < request.rounds
  )
    return null;
  const observedCandidate = candidate ?? (hasEmptyFoodOptimizerBaseline(request) ? buildFoodCandidate([]) : null);
  if (!observedCandidate) return null;
  const samples = [];
  for (let round = 0; round < request.rounds; round += 1) {
    const sample = matchFoodOptimizerReusableSample(
      request.seeds[round],
      observedCandidate,
      reusableSamples[round],
      request.payload?.simulationTimeLimit,
    );
    if (!sample) return null;
    samples.push(sample);
  }
  const state = createFoodOptimizerEvaluationState();
  for (const sample of samples) {
    state.reusedRounds += 1;
    appendFoodOptimizerEvaluationSample(state, sample, candidate, deathBudget);
    if (state.rejected) break;
  }
  return finishFoodOptimizerEvaluation(state, request);
}

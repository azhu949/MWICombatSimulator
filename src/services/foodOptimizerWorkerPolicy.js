const HISTORY_LIMIT = 32;
const MIN_SIMULATED_CANDIDATES = 2;
const MIN_STARTUP_MS = 50;

// Estimates use observed candidate work, never baseline timing. Completed
// candidates supply costs and coverage; unfinished candidates may project work
// after a real round completes. A covered block is one scheduling observation
// with its logical coverage, so a large reusable grid does not imply CPU work.
export function createFoodOptimizerWorkerPolicy() {
  const history = [];
  let startupMs = MIN_STARTUP_MS;
  let workSinceGrowth = 0;

  return {
    recordInitialization(durationMs) {
      if (Number.isFinite(durationMs) && durationMs >= 0) startupMs = Math.max(startupMs, durationMs);
    },
    record({ durationMs = 0, simulated = false, coveredCandidates = 1 } = {}) {
      const duration = simulated && Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
      const coverage = Number.isFinite(coveredCandidates) ? Math.max(1, coveredCandidates) : 1;
      history.push({ duration, coverage, simulated });
      if (history.length > HISTORY_LIMIT) history.shift();
      workSinceGrowth += duration;
    },
    shouldGrow({ workers, pendingWorkers = 0, workerLimit, remainingCandidates }) {
      if (
        pendingWorkers ||
        workers < 1 ||
        workers >= workerLimit ||
        !(remainingCandidates > 0) ||
        workSinceGrowth < startupMs
      )
        return false;
      let simulated = 0;
      let duration = 0;
      let coverage = 0;
      for (const entry of history) {
        simulated += Number(entry.simulated);
        duration += entry.duration;
        coverage += entry.coverage;
      }
      if (simulated < MIN_SIMULATED_CANDIDATES || !coverage) return false;
      // Observed miss frequency, call duration, and compression determine the
      // remaining serial work. Grow only if one extra worker can repay startup.
      const remainingWorkMs = (duration / coverage) * remainingCandidates;
      const savedMs = remainingWorkMs / workers - remainingWorkMs / (workers + 1);
      return savedMs > startupMs;
    },
    workersToStart(context, observed) {
      const { workers, pendingWorkers = 0, workerLimit, remainingCandidates } = context;
      // A completed real round of an unfinished candidate can reveal sustained
      // work before several expensive candidates finish serially. This hook is
      // never called for the baseline or main-thread cache completion.
      if (
        !pendingWorkers &&
        workers >= 1 &&
        workers < workerLimit &&
        remainingCandidates > 1 &&
        Number.isFinite(observed?.durationMs) &&
        Number.isSafeInteger(observed?.simulatedRounds) &&
        observed.simulatedRounds > 0 &&
        Number.isSafeInteger(observed?.plannedRounds) &&
        observed.simulatedRounds < observed.plannedRounds &&
        observed.durationMs >= Math.max(50, startupMs / 4)
      ) {
        let coverage = 0;
        let simulated = 0;
        for (const entry of history) {
          coverage += entry.coverage;
          simulated += Number(entry.simulated);
        }
        // The current candidate has performed real work even if all completed
        // history was reused. Include it once without crediting completed work.
        const estimatedCalls = remainingCandidates * ((simulated + 1) / (coverage + 1));
        // Require two estimated evaluations per new worker, and enough saved
        // work to repay twice the measured startup of this overlapping batch.
        const target = Math.min(workerLimit, workers + Math.floor(estimatedCalls / 2));
        const workMs = (observed.durationMs * observed.plannedRounds * estimatedCalls) / observed.simulatedRounds;
        if (target > workers && workMs / workers - workMs / target > 2 * startupMs) return target - workers;
      }
      return this.shouldGrow(context) ? 1 : 0;
    },
    workerStarted() {
      // Keep evidence from long completed calls instead of making each later
      // expansion wait for another full set of expensive candidates.
      workSinceGrowth = Math.max(0, workSinceGrowth - startupMs);
    },
  };
}

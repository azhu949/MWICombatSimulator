// Completed reports belong to one store and one loaded application version.
// Nothing is persisted: a reload also invalidates engine/game-data assumptions.
export function createFoodOptimizerReportCache() {
  const reports = new Map();
  return {
    get size() {
      return reports.size;
    },
    clear() {
      reports.clear();
    },
    get(inputSignature) {
      const report = reports.get(inputSignature);
      if (!report) return null;
      reports.delete(inputSignature);
      reports.set(inputSignature, report);
      // UI staleness, applying a result, and caller mutations must not alter
      // evidence for a later request that returns to this exact input.
      return { ...structuredClone(report), fromCache: true };
    },
    record(inputSignature, report) {
      if (
        typeof inputSignature !== 'string' ||
        !inputSignature ||
        report?.inputSignature !== inputSignature ||
        report.request?.inputSignature !== inputSignature ||
        report.status !== 'completed' ||
        report.complete !== true ||
        report.stale ||
        report.error ||
        !report.baseline ||
        !Number.isSafeInteger(report.stats?.totalCandidates) ||
        report.stats.totalCandidates < 1 ||
        report.stats.completedCandidates !== report.stats.totalCandidates ||
        !Array.isArray(report.topResults) ||
        report.topResults.some((result) => result.feasible !== true || result.roundsCompleted !== report.request.rounds)
      )
        return false;
      const copy = structuredClone(report);
      copy.stale = false;
      copy.fromCache = false;
      copy.appliedSignature = null;
      copy.appliedInputSignature = '';
      reports.delete(inputSignature);
      reports.set(inputSignature, copy);
      while (reports.size > 4) reports.delete(reports.keys().next().value);
      return true;
    },
  };
}

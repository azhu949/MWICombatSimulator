import {
  ADVISOR_GOAL_PRESET_BALANCED,
  buildAdvisorTopCards,
  normalizeAdvisorGoalPreset,
  normalizeAdvisorWeights,
  rankAdvisorRows,
} from '../services/advisorScoring.js';
import { createAdvisorState } from '../services/advisorDomain.js';
import { RUN_SCOPE_SINGLE } from '../services/simulationDomain.js';
import { stopAdvisorWorkerRuns } from '../services/simulatorWorkerRuns.js';
import { toFiniteNumber } from '../services/utils.js';
import { executeAdvisorScan } from '../services/advisorRunExecution.js';

export function createAdvisorActions({ loadPlayerMapperModule }) {
  return {
    resetAdvisorState() {
      this.advisor = createAdvisorState();
      return this.advisor;
    },
    rerankAdvisorResults(options = {}) {
      const normalizedGoalPreset = normalizeAdvisorGoalPreset(options.goalPreset ?? this.advisor.goalPreset);
      const normalizedCustomWeights = normalizeAdvisorWeights(
        options.customWeights ?? this.advisor.customWeights,
        ADVISOR_GOAL_PRESET_BALANCED,
      );
      const quickRowsSource = Array.isArray(options.quickRows) ? options.quickRows : this.advisor.quickRows;
      const refinedRowsSource = Array.isArray(options.refinedRows) ? options.refinedRows : this.advisor.refinedRows;
      const rankedQuickRows = rankAdvisorRows(quickRowsSource, {
        goalPreset: normalizedGoalPreset,
        customWeights: normalizedCustomWeights,
      });
      const quickRankById = new Map(rankedQuickRows.map((row, index) => [row.id, index + 1]));
      const rankedRefinedRows = rankAdvisorRows(refinedRowsSource, {
        goalPreset: normalizedGoalPreset,
        customWeights: normalizedCustomWeights,
        quickRankById,
      });
      const activeRows = rankedRefinedRows.length > 0 ? rankedRefinedRows : rankedQuickRows;

      this.advisor.goalPreset = normalizedGoalPreset;
      this.advisor.customWeights = normalizedCustomWeights;
      this.advisor.quickRows = rankedQuickRows;
      this.advisor.refinedRows = rankedRefinedRows;
      this.advisor.topCards = buildAdvisorTopCards(activeRows);
      return activeRows;
    },
    async runAdvisorScan() {
      return executeAdvisorScan({
        store: this,
        loadPlayerMapperModule,
      });
    },
    stopAdvisorScan() {
      if (!this.advisor.runtime?.isRunning) {
        return false;
      }

      this.advisor.error = '';
      this.advisor.runtime.cancelRequested = true;
      this.advisor.runtime.isRunning = false;
      this.advisor.runtime.phase = 'cancelled';
      this.advisor.runtime.elapsedSeconds =
        this.advisor.runtime.startedAt > 0 ? (Date.now() - this.advisor.runtime.startedAt) / 1000 : 0;
      stopAdvisorWorkerRuns();
      return true;
    },
    applyAdvisorTarget(row) {
      const targetType = String(row?.targetType || 'zone');
      if (targetType !== 'zone') {
        return false;
      }

      this.simulationSettings.mode = 'zone';
      this.simulationSettings.runScope = RUN_SCOPE_SINGLE;
      this.simulationSettings.useDungeon = false;
      this.simulationSettings.zoneHrid = String(row?.targetHrid || this.simulationSettings.zoneHrid || '');
      this.simulationSettings.difficultyTier = Math.max(
        0,
        Math.floor(toFiniteNumber(row?.difficultyTier, this.simulationSettings.difficultyTier || 0)),
      );
      this.normalizeDifficulty();
      return true;
    },
  };
}

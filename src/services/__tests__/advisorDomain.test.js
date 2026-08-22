import { describe, expect, it } from 'vitest';
import { actionDetailIndex } from '../../shared/gameDataIndex.js';
import { ADVISOR_GOAL_PRESET_BALANCED } from '../advisorScoring.js';
import { ONE_HOUR } from '../simulationDomain.js';
import {
  ADVISOR_QUICK_ROUNDS_MAX,
  ADVISOR_REFINE_ROUNDS_MIN,
  ADVISOR_REFINE_TOP_COUNT_MAX,
  buildAdvisorCandidates,
  buildAdvisorPartialErrorText,
  buildAdvisorRowFromRoundMetrics,
  buildAdvisorTargetId,
  createAdvisorSimulationPayload,
  createAdvisorState,
  normalizeAdvisorFilters,
  resolveAdvisorMetricPlayer,
  summarizeAdvisorTargetResult,
} from '../advisorDomain.js';

function findZoneBySpawnCount(targetSpawnCount) {
  return Object.values(actionDetailIndex || {}).find((action) => {
    if (action?.type !== '/action_types/combat' || action?.category === '/action_categories/combat/dungeons') {
      return false;
    }
    const maxSpawnCount = Number(action?.combatZoneInfo?.fightInfo?.randomSpawnInfo?.maxSpawnCount ?? 0);
    return targetSpawnCount > 1 ? maxSpawnCount > 1 : maxSpawnCount === 1;
  });
}

describe('advisorDomain', () => {
  it('normalizes filters and creates the default advisor state', () => {
    expect(
      normalizeAdvisorFilters({
        includeGroupZones: false,
        includeSoloZones: true,
        refineTopEnabled: false,
        refineTopCount: 999,
        refineRounds: 0,
        quickRounds: 999,
      }),
    ).toEqual({
      includeGroupZones: false,
      includeSoloZones: true,
      refineTopEnabled: false,
      refineTopCount: ADVISOR_REFINE_TOP_COUNT_MAX,
      refineRounds: ADVISOR_REFINE_ROUNDS_MIN,
      quickRounds: ADVISOR_QUICK_ROUNDS_MAX,
    });

    const state = createAdvisorState();
    expect(state.filters).toEqual(normalizeAdvisorFilters());
    expect(state.goalPreset).toBe(ADVISOR_GOAL_PRESET_BALANCED);
    expect(state.runtime).toMatchObject({
      isRunning: false,
      phase: 'idle',
      progress: 0,
      quickCompleted: 0,
      refineCompleted: 0,
    });
  });

  it('builds advisor zone candidates in solo then group order', () => {
    const soloZone = findZoneBySpawnCount(1);
    const groupZone = findZoneBySpawnCount(2);
    expect(soloZone).toBeTruthy();
    expect(groupZone).toBeTruthy();

    const soloOnly = buildAdvisorCandidates({
      includeSoloZones: true,
      includeGroupZones: false,
    });
    expect(soloOnly.length).toBeGreaterThan(0);
    expect(soloOnly.every((candidate) => candidate.category === 'solo_zone')).toBe(true);
    expect(soloOnly.some((candidate) => candidate.targetHrid === soloZone.hrid)).toBe(true);

    const allCandidates = buildAdvisorCandidates({
      includeSoloZones: true,
      includeGroupZones: true,
    });
    const firstGroupIndex = allCandidates.findIndex((candidate) => candidate.category === 'group_zone');
    expect(firstGroupIndex).toBeGreaterThan(0);
    expect(allCandidates.slice(0, firstGroupIndex).every((candidate) => candidate.category === 'solo_zone')).toBe(true);
    expect(allCandidates.slice(firstGroupIndex).every((candidate) => candidate.category === 'group_zone')).toBe(true);
    expect(allCandidates.some((candidate) => candidate.targetHrid === groupZone.hrid)).toBe(true);

    expect(buildAdvisorTargetId('zone', soloZone.hrid, 3.8)).toBe(`zone:${soloZone.hrid}#3`);
  });

  it('summarizes advisor metrics using the preferred selected player', () => {
    const sample = summarizeAdvisorTargetResult(
      {
        simulatedTime: 2 * ONE_HOUR,
        encounters: 20,
        deaths: {
          player1: 1,
          player2: 6,
        },
        experienceGained: {
          player1: { attack: 100 },
          player2: { attack: 300 },
        },
      },
      [
        { id: '1', name: 'One' },
        { id: '2', name: 'Two' },
      ],
      '2',
    );

    expect(sample.metricPlayerId).toBe('2');
    expect(sample.metricPlayerName).toBe('Two');
    expect(sample.xpPerHour).toBe(150);
    expect(sample.killsPerHour).toBe(10);
    expect(sample.deathsPerHour).toBe(3);

    expect(resolveAdvisorMetricPlayer([{ id: '3', name: 'Three' }], '2')).toEqual({
      id: '3',
      name: 'Three',
    });
    expect(resolveAdvisorMetricPlayer([], '5')).toEqual({
      id: '5',
      name: 'Player 5',
    });
  });

  it('builds advisor simulation payloads without changing worker message shape', () => {
    const players = [{ id: 'player1' }];
    const payload = createAdvisorSimulationPayload(
      {
        targetHrid: '/actions/combat/test',
        difficultyTier: '3.9',
      },
      players,
      123,
      { mooPass: true },
      {
        workerId: 'advisor-worker',
      },
    );

    expect(payload).toEqual({
      type: 'start_simulation',
      workerId: 'advisor-worker',
      players,
      zone: {
        zoneHrid: '/actions/combat/test',
        difficultyTier: 3,
      },
      labyrinth: null,
      simulationTimeLimit: 123,
      extra: {
        mooPass: true,
      },
    });
  });

  it('builds advisor rows from robust multi-round metrics', () => {
    const candidate = {
      id: 'zone:/actions/combat/test#0',
      targetType: 'zone',
      category: 'group_zone',
      targetHrid: '/actions/combat/test',
      targetName: 'Test Zone',
      difficultyTier: 0,
      refineRounds: 2,
    };
    const row = buildAdvisorRowFromRoundMetrics(
      candidate,
      [
        {
          profitPerHour: 100,
          xpPerHour: 200,
          killsPerHour: 10,
          deathsPerHour: 2,
        },
        {
          profitPerHour: 300,
          xpPerHour: 400,
          killsPerHour: 20,
          deathsPerHour: 4,
        },
      ],
      {
        isRefined: true,
        refineRounds: 4,
      },
    );

    expect(row).toMatchObject({
      id: candidate.id,
      isRefined: true,
      refineRounds: 4,
      successfulRounds: 2,
      reasons: [],
      normalizedMetrics: {
        profitPerHour: 0,
        xpPerHour: 0,
        killsPerHour: 0,
        safety: 0,
      },
    });
    expect(row.profitPerHour).toBeCloseTo(200, 6);
    expect(row.xpPerHour).toBeCloseTo(300, 6);
    expect(row.killsPerHour).toBeCloseTo(15, 6);
    expect(row.deathsPerHour).toBeCloseTo(3, 6);
    expect(row.metricSummary.profitPerHour.sampleCount).toBe(2);
  });

  it('formats partial advisor scan errors', () => {
    expect(buildAdvisorPartialErrorText('quick scan', [{ id: 'a' }, { id: 'b' }])).toBe(
      '2 target(s) failed during quick scan. Showing successful results only.',
    );
    expect(buildAdvisorPartialErrorText('quick scan', [])).toBe('');
  });
});

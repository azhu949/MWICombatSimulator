import { describe, expect, it } from 'vitest';
import { actionDetailIndex } from '../../shared/gameDataIndex.js';
import { ADVISOR_GOAL_PRESET_BALANCED, ADVISOR_GOAL_PRESET_IRONCOW } from '../advisorScoring.js';
import { buildAdvisorDropItemOptions } from '../advisorDropItems.js';
import { ONE_HOUR } from '../simulationDomain.js';
import {
  ADVISOR_QUICK_ROUNDS_MAX,
  ADVISOR_REFINE_ROUNDS_MIN,
  ADVISOR_REFINE_TOP_COUNT_MAX,
  buildAdvisorBaseRow,
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
        dropItemHrids: ['  /items/marine_scale  ', '', '/items/marine_scale', '   '],
      }),
    ).toEqual({
      includeGroupZones: false,
      includeSoloZones: true,
      refineTopEnabled: false,
      refineTopCount: ADVISOR_REFINE_TOP_COUNT_MAX,
      refineRounds: ADVISOR_REFINE_ROUNDS_MIN,
      quickRounds: ADVISOR_QUICK_ROUNDS_MAX,
      dropItemHrids: ['/items/marine_scale'],
    });

    expect(normalizeAdvisorFilters().dropItemHrids).toEqual([]);

    const state = createAdvisorState();
    expect(state.filters).toEqual(normalizeAdvisorFilters());
    expect(state.goalPreset).toBe(ADVISOR_GOAL_PRESET_BALANCED);
    expect(state.ironcowWeights).toEqual({ dropsPerHour: 0.45, xpPerHour: 0.45, safety: 0.1 });
    expect(state.scannedGoalPreset).toBe('');
    expect(state.scannedDropItemHrids).toEqual([]);
    expect(state.dropDataStale).toBe(false);
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

  it('computes selected drop item rates per hour for the metric player', () => {
    const simResult = {
      isDungeon: false,
      simulatedTime: 2 * ONE_HOUR,
      encounters: 20,
      numberOfPlayers: 2,
      difficultyTier: 0,
      deaths: { '/monsters/abyssal_imp': 10, player1: 1, player2: 6 },
      dropRateMultiplier: { player1: 1, player2: 1 },
      rareFindMultiplier: { player1: 1, player2: 1 },
      combatDropQuantity: { player1: 0, player2: 0 },
      debuffOnLevelGap: { player1: 0, player2: 0 },
      experienceGained: { player1: { attack: 100 }, player2: { attack: 300 } },
    };
    const selectedPlayers = [
      { id: '1', name: 'One' },
      { id: '2', name: 'Two' },
    ];

    const withItems = summarizeAdvisorTargetResult(simResult, selectedPlayers, '2', {}, [
      '  /items/coin  ',
      '/items/coin',
      '/items/never_drops',
    ]);
    // 深渊小鬼硬币：掉落率 .8、中点 1500；10 次击杀 / 2 名玩家 / 2 小时
    // = 3000 枚/小时，所选但无掉落的物品记 0。
    expect(withItems.metricPlayerId).toBe('2');
    expect(withItems.dropsPerHour).toBe(3000);
    expect(withItems.dropRatesByItem).toEqual({
      '/items/coin': 3000,
      '/items/never_drops': 0,
    });
    // 现有字段保持不变。
    expect(withItems.xpPerHour).toBe(150);
    expect(withItems.killsPerHour).toBe(10);
    expect(withItems.deathsPerHour).toBe(3);

    const withoutItems = summarizeAdvisorTargetResult(simResult, selectedPlayers, '2');
    expect(withoutItems.dropsPerHour).toBe(0);
    expect(withoutItems.dropRatesByItem).toEqual({});
  });

  it('filters advisor candidates by selected drop items in ironcow mode only', () => {
    const allCandidates = buildAdvisorCandidates({ includeSoloZones: true, includeGroupZones: true });
    expect(allCandidates.length).toBeGreaterThan(0);

    const itemFilters = {
      includeSoloZones: true,
      includeGroupZones: true,
      dropItemHrids: ['  /items/marine_scale  ', '/items/marine_scale', ''],
    };

    // 铁牛模式：按所选物品做难度感知过滤。
    const filtered = buildAdvisorCandidates(itemFilters, ADVISOR_GOAL_PRESET_IRONCOW);
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThan(allCandidates.length);
    expect([...new Set(filtered.map((candidate) => candidate.targetHrid))]).toEqual(['/actions/combat/aqua_planet']);
    expect(filtered.every((candidate) => candidate.category === 'group_zone')).toBe(true);
    expect(filtered.map((candidate) => candidate.difficultyTier)).toEqual([0, 1, 2, 3, 4, 5]);

    // 非铁牛模式：遗留的物品选择不应静默缩小扫描范围（物品面板仅铁牛可见）。
    const balancedCandidates = buildAdvisorCandidates(itemFilters, ADVISOR_GOAL_PRESET_BALANCED);
    expect(balancedCandidates).toHaveLength(allCandidates.length);
    expect(buildAdvisorCandidates(itemFilters)).toHaveLength(allCandidates.length);
  });

  it('defaults ironcow drop fields on base rows and copies sample drop rates', () => {
    const emptyRow = buildAdvisorBaseRow({ id: 'zone:/actions/combat/test#0' }, {});
    expect(emptyRow.dropsPerHour).toBe(0);
    expect(emptyRow.dropRatesByItem).toEqual({});

    const sampleRow = buildAdvisorBaseRow(
      { id: 'zone:/actions/combat/test#0' },
      {
        dropsPerHour: 2.5,
        dropRatesByItem: { '/items/apple': 1.5, '': 9, '/items/bad': Number.NaN },
      },
    );
    expect(sampleRow.dropsPerHour).toBe(2.5);
    expect(sampleRow.dropRatesByItem).toEqual({ '/items/apple': 1.5, '/items/bad': 0 });
  });

  it('aggregates ironcow drop metrics across advisor rounds', () => {
    const candidate = {
      id: 'zone:/actions/combat/test#0',
      targetType: 'zone',
      category: 'solo_zone',
      targetHrid: '/actions/combat/test',
      targetName: 'Test Zone',
      difficultyTier: 0,
    };
    const row = buildAdvisorRowFromRoundMetrics(candidate, [
      {
        profitPerHour: 100,
        xpPerHour: 200,
        killsPerHour: 10,
        deathsPerHour: 2,
        dropsPerHour: 4,
        dropRatesByItem: { '/items/apple': 3, '/items/pearl': 1 },
      },
      {
        profitPerHour: 300,
        xpPerHour: 400,
        killsPerHour: 20,
        deathsPerHour: 4,
        dropsPerHour: 8,
        dropRatesByItem: { '/items/apple': 7 },
      },
    ]);

    expect(row.dropsPerHour).toBeCloseTo(6, 6);
    // 每物品取出现该键轮次的简单平均（apple 两轮、pearl 一轮）。
    expect(row.dropRatesByItem).toEqual({ '/items/apple': 5, '/items/pearl': 1 });
    expect(row.metricSummary.dropsPerHour.sampleCount).toBe(2);

    const emptyRow = buildAdvisorRowFromRoundMetrics(candidate, []);
    expect(emptyRow.dropsPerHour).toBe(0);
    expect(emptyRow.dropRatesByItem).toEqual({});
  });

  it('builds sorted real-data drop item options for the selected scope', () => {
    const allOptions = buildAdvisorDropItemOptions({ includeSoloZones: true, includeGroupZones: true });
    expect(allOptions.length).toBeGreaterThan(0);
    const allHrids = allOptions.map((option) => option.itemHrid);
    expect(new Set(allHrids).size).toBe(allHrids.length);
    expect([...allHrids].sort()).toEqual(allHrids);
    expect(allOptions).toContainEqual({ itemHrid: '/items/marine_scale' });

    const soloOptions = buildAdvisorDropItemOptions({ includeSoloZones: true, includeGroupZones: false });
    const soloHrids = new Set(soloOptions.map((option) => option.itemHrid));
    expect(soloHrids.size).toBeGreaterThan(0);
    expect([...soloHrids].every((hrid) => allHrids.includes(hrid))).toBe(true);
    expect(soloHrids.has('/items/marine_scale')).toBe(false);

    expect(buildAdvisorDropItemOptions({ includeSoloZones: false, includeGroupZones: false })).toEqual([]);
  });

  it('keeps buildAdvisorDropItemOptions scope parsing in sync with normalizeAdvisorFilters', () => {
    // advisorDropItems 为避免与本模块形成循环依赖，在 buildAdvisorDropItemOptions
    // 内联解析 scope 布尔（不导入 normalizeAdvisorFilters）。同一份输入分别走
    // 「内联解析」与「normalizeAdvisorFilters 规整后再解析」两条路径，要求物品
    // 集合完全一致：任一侧改默认值或输入规整规则，此测试先红。输入矩阵覆盖
    // 全部 typeof 类别（undefined/null/boolean/number/string/function/object）。
    // 注意：当前真实数据下 solo 可掉物品 ⊆ group 可掉物品（两者皆开时并集对
    // solo 开关不敏感），solo 默认值漂移仅经 includeGroupZones: false 输入显形
    // ——勿删除该项（数据变化出现 solo 独有物品只会让检测更灵敏）。
    const scopeInputs = [
      undefined,
      null,
      0,
      'odd',
      true,
      () => {},
      ['not-an-object'],
      new Date(0),
      {},
      { includeSoloZones: true },
      { includeGroupZones: false },
      { includeSoloZones: 1, includeGroupZones: 'yes' },
      { includeSoloZones: 'false', includeGroupZones: 0 },
    ];
    scopeInputs.forEach((filters, index) => {
      const normalized = normalizeAdvisorFilters(filters);
      expect(
        buildAdvisorDropItemOptions(filters),
        `scope parsing diverged at scopeInputs[${index}]: ${String(filters)}`,
      ).toEqual(
        buildAdvisorDropItemOptions({
          includeSoloZones: normalized.includeSoloZones,
          includeGroupZones: normalized.includeGroupZones,
        }),
      );
    });
  });
});

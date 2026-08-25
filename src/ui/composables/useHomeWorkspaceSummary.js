import { computed } from 'vue';
import { buildNoRngProfitBreakdown, buildRandomProfitBreakdown } from '../../services/profitEstimator.js';
import { aggregateBatchPlayerRows } from '../../services/simulationDomain.js';
import { calcCombatLevel } from '../../shared/playerConfig.js';
import { useSimulatorStore } from '../../stores/simulatorStore.js';
import { formatCurrency, formatInt, formatNumber } from '../components/home/homeFormatters.js';
import { useGameDataText } from './useGameDataText.js';
import { useI18nText } from './useI18nText.js';

export function useHomeWorkspaceSummary(combatPreview) {
  const simulator = useSimulatorStore();
  const { t } = useI18nText();
  const { getActionName, getCombatStatName, getMonsterName, getOfficialGameText } = useGameDataText();
  const activePlayer = computed(() => simulator.activePlayer);
  const homeHasResults = computed(
    () =>
      Boolean(simulator.results.simResult) ||
      (Array.isArray(simulator.results.simResults) && simulator.results.simResults.length > 0) ||
      (Array.isArray(simulator.results.summaryRows) && simulator.results.summaryRows.length > 0) ||
      (Array.isArray(simulator.results.batchRows) && simulator.results.batchRows.length > 0),
  );
  const homeCanOpenResults = computed(() => Boolean(simulator.runtime.isRunning || homeHasResults.value));
  const activeHomeResultRow = computed(() => simulator.activeResultRow || null);
  // 批处理摘要是在同一共享模拟时长内各目标收益率的求和。
  // 若该时长约定缺失或失效，则省略聚合行，避免混合不兼容的行。
  const activeBatchPlayerRow = computed(() =>
    aggregateBatchPlayerRows(simulator.results.batchRows, `player${simulator.activePlayerId}`),
  );
  const activeHomeResultPlayerHrid = computed(
    () => simulator.results.activeResultPlayerHrid || `player${simulator.activePlayerId}`,
  );
  const homeResultsProgressPercent = computed(() => {
    const progress = Number(simulator.runtime.progress || 0);
    return Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.floor(progress * 100))) : 0;
  });
  const homeResultsProgressText = computed(
    () => `${homeResultsProgressPercent.value}% | ${Number(simulator.runtime.elapsedSeconds || 0).toFixed(1)}s`,
  );
  const currentRunScopeLabel = computed(() => {
    const scope = simulator.availableRunScopes.find((entry) => entry.value === simulator.simulationSettings.runScope);
    return t(
      `common:vue.home.runScopeOptions.${scope?.value || simulator.simulationSettings.runScope}`,
      scope?.label || simulator.simulationSettings.runScope || '-',
    );
  });
  const currentModeLabel = computed(() => {
    if (simulator.simulationSettings.mode === 'labyrinth')
      return getOfficialGameText('labyrinthPanel', 'labyrinth', 'Labyrinth');
    if (simulator.simulationSettings.useDungeon)
      return getOfficialGameText('shopCategoryNames', '/shop_categories/dungeon', 'Dungeon');
    return t('common:vue.home.modeZone', 'Zone');
  });
  const currentTargetLabel = computed(() => {
    const settings = simulator.simulationSettings;
    if (settings.mode === 'labyrinth' && settings.runScope === 'single') {
      const selected = simulator.options.labyrinths.find((entry) => entry.hrid === settings.labyrinthHrid);
      const labyrinthName = getMonsterName(
        selected?.hrid || settings.labyrinthHrid,
        selected?.name || settings.labyrinthHrid || getOfficialGameText('labyrinthPanel', 'labyrinth', 'Labyrinth'),
      );
      return `${labyrinthName} • ${t('common:roomLevel', 'Room Level')} ${formatNumber(settings.roomLevel, 0)}`;
    }
    if (settings.mode === 'zone' && settings.runScope === 'single') {
      const hrid = settings.useDungeon ? settings.dungeonHrid : settings.zoneHrid;
      const selected = simulator.currentActionOptions.find((entry) => entry.hrid === hrid);
      return `${getActionName(hrid, selected?.name || '')} • T${Number(settings.difficultyTier || 0)}`;
    }
    if (settings.mode === 'zone' && settings.runScope === 'all_group_zones') {
      return t('common:vue.home.workspaceTargets.groupZones', '{{count}} group zones selected', {
        count: (settings.selectedGroupZoneHrids || []).length,
      });
    }
    if (settings.mode === 'zone' && settings.runScope === 'all_solo_zones') {
      return t('common:vue.home.workspaceTargets.soloZones', '{{count}} solo zones selected', {
        count: (settings.selectedSoloZoneHrids || []).length,
      });
    }
    return currentRunScopeLabel.value;
  });
  const workspaceStatusTone = computed(() =>
    simulator.runtime.isRunning ? 'running' : homeHasResults.value ? 'ready' : 'idle',
  );
  const workspaceStatusLabel = computed(() =>
    simulator.runtime.isRunning
      ? t('common:vue.home.homeResultsRunningTitle', 'Simulation in progress')
      : homeHasResults.value
        ? t('common:vue.home.workspaceStatusReady', 'Results ready')
        : t('common:vue.home.workspaceStatusIdle', 'Ready to run'),
  );
  const workspaceStatusText = computed(() =>
    simulator.runtime.isRunning
      ? t(
          'common:vue.home.workspaceStatusRunningDesc',
          'Progress and summary metrics stay visible while the simulation runs.',
        )
      : homeHasResults.value
        ? t(
            'common:vue.home.workspaceStatusReadyDesc',
            'Latest results are ready. Open the full report whenever you want deeper detail.',
          )
        : t(
            'common:vue.home.workspaceStatusIdleDesc',
            'Start a simulation to populate the workspace summary and results area.',
          ),
  );
  const levelLabel = computed(() => {
    const levels = activePlayer.value?.levels || {};
    return calcCombatLevel(
      Math.max(1, Number(levels.stamina ?? 1)),
      Math.max(1, Number(levels.intelligence ?? 1)),
      Math.max(1, Number(levels.defense ?? 1)),
      Math.max(1, Number(levels.attack ?? 1)),
      Math.max(1, Number(levels.melee ?? 1)),
      Math.max(1, Number(levels.ranged ?? 1)),
      Math.max(1, Number(levels.magic ?? 1)),
    ).toFixed(1);
  });
  const activeProfileImported = computed(
    () => simulator.queue?.importedProfileByPlayer?.[simulator.activePlayerId] === true,
  );
  const summaryConfigRows = computed(() => [
    {
      label: t('common:vue.home.workspaceSummary.player', 'Active Player'),
      value: activePlayer.value?.name || `Player ${simulator.activePlayerId}`,
    },
    {
      label: t('common:vue.home.workspaceSummary.profile', 'Profile'),
      value: activeProfileImported.value
        ? t('common:vue.home.profileStatusImported', 'Imported')
        : t('common:vue.home.profileStatusNotImported', 'Not imported'),
      tone: activeProfileImported.value ? 'success' : 'accent',
    },
    {
      label: t('common:vue.home.workspaceSummary.modeScope', 'Mode / Scope'),
      value: `${currentModeLabel.value} • ${currentRunScopeLabel.value}`,
    },
    { label: t('common:vue.home.workspaceSummary.target', 'Target'), value: currentTargetLabel.value },
  ]);
  const summaryMetricRows = computed(() => {
    // single 模式优先用 activeResultRow（summaryRows），batch 模式回退到当前玩家的聚合行。
    const row = activeHomeResultRow.value ?? activeBatchPlayerRow.value;
    const detailed = Boolean(simulator.results.simResult);
    const random = detailed
      ? buildRandomProfitBreakdown(simulator.results.simResult, activeHomeResultPlayerHrid.value, {
          consumableMode: simulator.pricing.consumableMode,
          dropMode: simulator.pricing.dropMode,
          priceTable: simulator.pricing.priceTable,
        })
      : { revenue: 0, expenses: 0, profit: 0 };
    const noRng = detailed
      ? buildNoRngProfitBreakdown(simulator.results.simResult, activeHomeResultPlayerHrid.value, {
          consumableMode: simulator.pricing.consumableMode,
          dropMode: simulator.pricing.dropMode,
          priceTable: simulator.pricing.priceTable,
        })
      : { profit: 0 };
    let manaValue = '-';
    let manaTone;
    if (detailed) {
      const playerHrid = String(activeHomeResultPlayerHrid.value || '');
      const ranOut = Boolean(simulator.results.simResult?.playerRanOutOfMana?.[playerHrid]);
      manaTone = ranOut ? 'danger' : 'success';
      if (!ranOut) manaValue = t('common:simulationResults.No', 'No');
      else {
        const stat = simulator.results.simResult?.playerRanOutOfManaTime?.[playerHrid];
        const simulatedTime = Number(simulator.results.simResult?.simulatedTime || 0);
        if (stat && simulatedTime > 0) {
          const total =
            Number(stat.totalTimeForOutOfMana || 0) +
            (stat.isOutOfMana ? simulatedTime - Number(stat.startTimeForOutOfMana || 0) : 0);
          const ratio = (total / simulatedTime) * 100;
          manaValue = Number.isFinite(ratio)
            ? `${t('common:simulationResults.Yes', 'Yes')} (${ratio.toFixed(2)}%)`
            : t('common:simulationResults.Yes', 'Yes');
        } else manaValue = t('common:simulationResults.Yes', 'Yes');
      }
    }
    const metric = (label, value, tone) => ({ label, value, ...(tone ? { tone } : {}) });
    return [
      metric(t('common:vue.results.xpPerHour', 'XP/h'), row ? formatNumber(row.totalXpPerHour, 0) : '-', 'accent'),
      metric(
        t('common:vue.results.deathsPerHour', 'Deaths/h'),
        row ? formatNumber(row.deathsPerHour, 2) : '-',
        'danger',
      ),
      metric(t('common:simulationResults.ranOutOfMana', 'Mana Run Out'), manaValue, manaTone),
      metric(
        t('common:vue.results.encountersPerHour', 'Battles/h'),
        row ? formatNumber(row.encountersPerHour, 1) : '-',
      ),
      metric(
        detailed ? t('common:revenue', 'Revenue') : t('common:vue.results.revenuePerHour', 'Revenue/h'),
        detailed ? formatCurrency(random.revenue) : row ? formatCurrency(row.revenuePerHour) : '-',
        'success',
      ),
      metric(
        detailed ? t('common:expense', 'Expense') : t('common:vue.results.expensesPerHour', 'Expenses/h'),
        detailed ? formatCurrency(random.expenses) : row ? formatCurrency(row.expensesPerHour) : '-',
        'danger',
      ),
      metric(
        detailed ? t('common:profit', 'Profit') : t('common:vue.results.profitPerHour', 'Profit/h'),
        detailed ? formatCurrency(random.profit) : row ? formatCurrency(row.profitPerHour) : '-',
        (detailed ? random.profit : row?.profitPerHour || 0) >= 0 ? 'success' : 'danger',
      ),
      metric(
        t('common:noRNGProfit', 'No RNG Profit'),
        detailed ? formatCurrency(noRng.profit) : row ? formatCurrency(row.profitPerHour) : '-',
        (detailed ? noRng.profit : row?.profitPerHour || 0) >= 0 ? 'success' : 'danger',
      ),
    ];
  });
  const summaryBuildRows = computed(() => {
    const details = combatPreview?.combatDetails?.value;
    const stats = combatPreview?.combatStats?.value;
    const style = stats ? combatPreview.combatStyleName(stats.combatStyleHrid) : '-';
    const damage = stats ? combatPreview.damageTypeName(stats.damageType) : '-';
    return [
      { label: t('common:vue.home.averageCombatLevel', 'Combat Level'), value: levelLabel.value },
      { label: getCombatStatName('combatStyleHrids', 'Combat Style'), value: style },
      { label: getCombatStatName('damageType', 'Damage Type'), value: damage },
      {
        label: getCombatStatName('maxHitpoints', 'Max Hitpoints'),
        value: details ? formatInt(details.maxHitpoints) : '-',
      },
      {
        label: getCombatStatName('attackInterval', 'Attack Interval'),
        value: stats ? `${formatNumber(Number(stats.attackInterval || 0) / 1e9, 2)}s` : '-',
      },
      { label: getCombatStatName('armor', 'Armor'), value: details ? formatInt(details.totalArmor) : '-' },
    ];
  });
  const workspaceTabs = computed(() => [
    {
      value: 'base',
      label: t('common:vue.home.workspaceTabs.base', 'Base Setup'),
      description: t(
        'common:vue.home.workspaceTabs.baseDesc',
        'Player, target, run settings, equipment, consumables, abilities, and trigger entry points.',
      ),
    },
    {
      value: 'advanced',
      label: t('common:vue.home.workspaceTabs.advanced', 'Battle Attributes'),
      description: t(
        'common:vue.home.workspaceTabs.advancedDesc',
        'Full derived combat attributes for the current build.',
      ),
    },
    {
      value: 'results',
      label: t('common:vue.home.workspaceTabs.results', 'Complete Results'),
      description: t(
        'common:vue.home.workspaceTabs.resultsDesc',
        'Full tables, charts, and per-source breakdowns from the latest simulation.',
      ),
    },
  ]);
  const fullResultsButtonLabel = computed(() =>
    simulator.runtime.isRunning
      ? t('common:vue.home.workspaceOpenResultsArea', 'Open Results Area')
      : t('common:vue.home.workspaceViewFullResults', 'View Full Results'),
  );

  return {
    homeHasResults,
    homeCanOpenResults,
    homeResultsProgressPercent,
    homeResultsProgressText,
    workspaceTabs,
    workspaceStatusTone,
    workspaceStatusLabel,
    workspaceStatusText,
    summaryConfigRows,
    summaryMetricRows,
    summaryBuildRows,
    fullResultsButtonLabel,
  };
}

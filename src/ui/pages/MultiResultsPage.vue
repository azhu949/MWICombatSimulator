<template>
  <section class="space-y-4">
    <div class="surface-panel">
      <h2 class="font-heading text-lg font-semibold text-primary">
        {{ t('common:multiRound.summaryTitle', 'Multi-round Summary') }}
      </h2>
      <p class="mt-2 text-sm text-foreground/85">
        {{ t('common:vue.queue.activePlayer', 'Active player', { name: simulator.activePlayer.name }) }}
      </p>
      <p v-if="queuePartySummaryText" class="mt-1 text-xs text-muted-foreground">
        {{ t('common:queue.partyLockedMembers', 'Locked party') }}:
        <span class="ml-1 text-foreground">{{ queuePartySummaryText }}</span>
      </p>
      <p v-if="queuePartyWarningText" class="mt-2 text-sm text-primary">{{ queuePartyWarningText }}</p>

      <div class="mt-3 grid gap-3 border-t border-border pt-3 text-xs text-foreground/85 md:grid-cols-2">
        <div class="rounded-lg border border-border bg-muted/40 p-3">
          <p class="uppercase text-muted-foreground">{{ t('common:multiRound.scoreModel', 'Score Model') }}</p>
          <div class="mt-2 space-y-1">
            <p>
              {{
                t(
                  'common:multiRound.scoreModelValue',
                  'Performance/Stability/Cost weighted by configured settings (quantile mapped to 5-95, with confidence penalty)',
                )
              }}
            </p>
            <p>{{ t('common:multiRound.scoreModelWeightsValue', 'Score weights', queueRuntimeWeightText) }}</p>
            <p>
              {{
                t(
                  'common:multiRound.scoreModelParamPerformance',
                  'Performance: DPS, No RNG Profit/day, XP/h and Kills/h gains are rank-mapped within the batch to 5-95, then combined using the current queue subweights. Higher is better.',
                )
              }}
            </p>
            <p>{{ t('common:multiRound.scoreModelParamPerformanceSubweights', '', queuePerformanceSubweightText) }}</p>
            <p>
              {{
                t(
                  'common:multiRound.scoreModelParamStability',
                  'Stability: the average CV across the four metrics is rank-mapped within the batch to 5-95. Lower volatility scores higher.',
                )
              }}
            </p>
            <p>
              {{
                t(
                  'common:multiRound.scoreModelParamCost',
                  'Cost: upgrade cost, purchase time and the selected gold per 0.01% metric are each mapped to 5-95 (cost metrics use log scaling first). Lower cost scores higher.',
                )
              }}
            </p>
            <p>
              {{
                t('common:multiRound.scoreModelParamCostGoldMetricSelected', '', { mode: currentCostScoreModeLabel })
              }}
            </p>
            <p>
              {{
                t(
                  'common:multiRound.scoreModelParamGoldPerPointValidity',
                  'Strict gold per 0.01% is shown only when the final robust deltas for DPS, No RNG Profit/day, XP/h and Kills/h are all positive. Otherwise it is marked N/A.',
                )
              }}
            </p>
            <p>{{ t('common:multiRound.scoreModelParamCompositeGoldPerPoint', '', queuePerformanceSubweightText) }}</p>
            <p>
              {{ t('common:multiRound.scoreModelParamRobustWinsorize', 'Robust winsorize setting', { winsorPct: 5 }) }}
            </p>
            <p>
              {{
                t(
                  'common:multiRound.scoreModelParamRobustMedianBlend',
                  'Robust median blend setting',
                  queueMedianBlendText,
                )
              }}
            </p>
            <p>
              {{
                t('common:multiRound.scoreModelParamRobustConfidencePenalty', 'Robust confidence penalty setting', {
                  baseWeight: 65,
                  penaltyWeight: 35,
                })
              }}
            </p>
          </div>
        </div>
        <div class="rounded-lg border border-border bg-muted/40 p-3">
          <p class="uppercase text-muted-foreground">{{ t('common:queue.baselineSummary', 'Baseline Summary') }}</p>
          <div v-if="baselineSummaryRows.length > 0" class="mt-2 space-y-1">
            <p v-for="row in baselineSummaryRows" :key="row.key">
              <span class="text-muted-foreground">{{ row.label }}:</span> {{ row.value }}
            </p>
          </div>
          <p v-if="baselineSummaryRows.length > 0" class="mt-2 text-muted-foreground">
            {{
              t(
                'common:queue.baselineSummaryAggregationHint',
                'Baseline values shown here come from multi-round robust aggregation: the simulator runs the configured baseline rounds and blends winsorized means with medians instead of showing a single sample.',
              )
            }}
          </p>
          <p v-else class="mt-2 text-muted-foreground">
            {{ t('common:queue.emptyBaseline', "No baseline yet. Click 'Set Baseline' to run and lock one.") }}
          </p>
        </div>
      </div>
    </div>

    <div v-if="!hasMultiData" class="surface-panel">
      <div v-if="showRunningPlaceholder" class="flex flex-col justify-center gap-5" :style="runningPlaceholderStyle">
        <div>
          <p class="text-xs uppercase text-muted-foreground">
            {{ t('common:queue.queueRunning', 'Running queue...') }}
          </p>
          <h3 class="mt-2 font-heading text-xl font-semibold text-primary">
            {{ runningPlaceholderTitle }}
          </h3>
          <p class="mt-2 max-w-3xl text-sm text-foreground/85">
            {{ runningPlaceholderDescription }}
          </p>
        </div>

        <div class="grid gap-3 sm:grid-cols-3">
          <div class="rounded-md border border-border bg-muted/40 p-4">
            <p class="text-xs uppercase text-muted-foreground">
              {{ t('common:vue.queue.queueProgress', 'Queue Progress') }}
            </p>
            <p class="mt-2 font-heading text-2xl text-foreground">{{ queueProgressPercentText }}</p>
          </div>
          <div class="rounded-md border border-border bg-muted/40 p-4">
            <p class="text-xs uppercase text-muted-foreground">{{ t('common:multiRound.simCount', 'Sim Count') }}</p>
            <p class="mt-2 font-heading text-2xl text-foreground">{{ completedSimCountText }}</p>
          </div>
          <div class="rounded-md border border-border bg-muted/40 p-4">
            <p class="text-xs uppercase text-muted-foreground">{{ t('common:queue.queueList', 'Queue List') }}</p>
            <p class="mt-2 font-heading text-2xl text-foreground">{{ queueState.items?.length ?? 0 }}</p>
          </div>
        </div>

        <div class="space-y-2">
          <div class="flex flex-wrap items-center justify-between gap-2 text-xs uppercase text-muted-foreground">
            <span>{{ t('common:vue.queue.queueProgress', 'Queue Progress') }}</span>
            <span class="text-foreground">{{ queueProgressPercentText }} | {{ lastRunText }}</span>
          </div>
          <Progress :value="queueProgressPercent" />
        </div>
      </div>

      <p v-else class="text-sm text-muted-foreground">
        {{ t('common:multiRound.noData', 'No multi-round results yet.') }}
      </p>
    </div>

    <template v-else>
      <div class="grid gap-3 sm:grid-cols-4">
        <div class="surface-panel">
          <p class="text-xs uppercase text-muted-foreground">{{ t('common:queue.roundCount', 'Rounds') }}</p>
          <p class="mt-1 font-heading text-lg text-foreground">{{ queueState.settings?.rounds ?? 0 }}</p>
        </div>
        <div class="surface-panel">
          <p class="text-xs uppercase text-muted-foreground">{{ t('common:queue.queueList', 'Queue List') }}</p>
          <p class="mt-1 font-heading text-lg text-foreground">{{ queueState.items?.length ?? 0 }}</p>
        </div>
        <div class="surface-panel">
          <p class="text-xs uppercase text-muted-foreground">{{ t('common:multiRound.simCount', 'Sim Count') }}</p>
          <p class="mt-1 font-heading text-lg text-foreground">{{ completedSimCountText }}</p>
        </div>
        <div class="surface-panel">
          <p class="text-xs uppercase text-muted-foreground">{{ t('common:vue.queue.lastRun', 'Last Run') }}</p>
          <p class="mt-1 font-heading text-lg text-foreground">{{ lastRunText }}</p>
        </div>
      </div>

      <div class="surface-panel overflow-x-auto">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 class="font-heading text-sm uppercase text-foreground/85">
            {{ t('common:multiRound.rankingTitle', 'Scored Ranking') }}
          </h3>
          <button
            type="button"
            class="button-secondary"
            :disabled="rankingRowsForDisplay.length === 0 || isExportingRankingExcel"
            @click="exportRankingRowsExcel"
          >
            {{ t('common:exportToExcel', 'Export To Excel') }}
          </button>
        </div>
        <Table class="min-w-[2180px] w-max text-sm">
          <TableHeader>
            <TableRow class="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <TableHead class="px-2 py-2">{{ t('common:multiRound.rank', 'Rank') }}</TableHead>
              <TableHead class="px-2 py-2">{{ t('common:vue.queue.variant', 'Variant') }}</TableHead>
              <TableHead class="px-2 py-2">{{ t('common:multiRound.simCount', 'Sim Count') }}</TableHead>
              <TableHead class="px-2 py-2">{{ t('common:multiRound.finalScore', 'Final Score') }}</TableHead>
              <TableHead class="px-2 py-2">{{
                t('common:multiRound.performanceScore', 'Performance Score')
              }}</TableHead>
              <TableHead class="px-2 py-2">{{ t('common:multiRound.stabilityScore', 'Stability Score') }}</TableHead>
              <TableHead class="px-2 py-2">{{ costScoreColumnHeader }}</TableHead>
              <TableHead class="px-2 py-2">{{ t('common:queue.dailyNoRngProfit', 'Daily No RNG Profit') }}</TableHead>
              <TableHead class="px-2 py-2">{{ t('common:vue.queue.deltaProfitPerHour', 'Delta Profit/h') }}</TableHead>
              <TableHead class="px-2 py-2">{{ t('common:multiRound.deltaProfitPct', 'Profit Delta%') }}</TableHead>
              <TableHead class="px-2 py-2">{{ t('common:multiRound.deltaDpsPct', 'DPS Delta%') }}</TableHead>
              <TableHead class="px-2 py-2">{{ t('common:multiRound.deltaXpPct', 'XP Delta%') }}</TableHead>
              <TableHead class="px-2 py-2">{{ t('common:multiRound.deltaKillsPct', 'Kills Delta%') }}</TableHead>
              <TableHead class="px-2 py-2">{{
                t('common:vue.queue.equipmentSaleValue', 'Replaced Equipment Sale Value')
              }}</TableHead>
              <TableHead class="px-2 py-2">{{
                t('common:vue.queue.equipmentBuyPrice', 'Target Equipment Buy Price')
              }}</TableHead>
              <TableHead class="px-2 py-2">{{
                t('common:vue.queue.equipmentNetCost', 'Equipment Net Cost')
              }}</TableHead>
              <TableHead
                class="px-2 py-2"
                :title="
                  t(
                    'common:vue.queue.upgradeCostComposition',
                    'Upgrade Cost = equipment net cost + ability upgrade costs + house room upgrade costs.',
                  )
                "
                >{{ t('common:equipment.upgradeCost', 'Upgrade Cost') }}</TableHead
              >
              <TableHead class="px-2 py-2">{{ t('common:queue.purchaseTime', 'Purchase Time') }}</TableHead>
              <TableHead class="px-2 py-2">{{
                t('common:multiRound.avgCostPerPoint01Pct', 'Gold per 0.01% (all four > 0)')
              }}</TableHead>
              <TableHead class="px-2 py-2">{{
                t('common:multiRound.compositeCostPerPoint01Pct', 'Gold per 0.01% (composite)')
              }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="row in rankingRowsForDisplay"
              :key="row.id"
              class="border-b border-border text-foreground"
              :class="getRankRowClass(row)"
            >
              <TableCell class="px-2 py-2 font-semibold">
                <span
                  class="inline-flex min-w-12 items-center justify-center rounded-md border px-2 py-0.5 text-xs font-bold"
                  :class="getRankBadgeClass(row.rank)"
                >
                  #{{ row.rank }}
                </span>
              </TableCell>
              <TableCell class="px-2 py-2">
                <p>{{ formatQueueItemSummary(row) }}</p>
                <p v-if="getHiddenChangeCount(row) > 0" class="mt-0.5 text-xs text-muted-foreground">
                  +{{ getHiddenChangeCount(row) }}
                </p>
              </TableCell>
              <TableCell class="px-2 py-2">{{ formatRowSimCount(row) }}</TableCell>
              <TableCell class="px-2 py-2">{{ formatNumber(row.finalScore) }}</TableCell>
              <TableCell class="px-2 py-2">{{ formatNumber(row.performanceScore) }}</TableCell>
              <TableCell class="px-2 py-2">{{ formatNumber(row.stabilityScore) }}</TableCell>
              <TableCell class="px-2 py-2">{{ formatNumber(row.costScore) }}</TableCell>
              <TableCell class="px-2 py-2">{{ formatCompactCurrency(row.dailyNoRngProfitPerDay) }}</TableCell>
              <TableCell class="px-2 py-2" :class="profitDeltaClass(row.deltaProfitPerHour)">{{
                formatCurrency(row.deltaProfitPerHour)
              }}</TableCell>
              <TableCell class="px-2 py-2" :class="profitDeltaClass(row.deltaProfitPct)">{{
                formatSignedPercent(row.deltaProfitPct)
              }}</TableCell>
              <TableCell class="px-2 py-2" :class="profitDeltaClass(row.deltaDpsPct)">{{
                formatSignedPercent(row.deltaDpsPct)
              }}</TableCell>
              <TableCell class="px-2 py-2" :class="profitDeltaClass(row.deltaXpPct)">{{
                formatSignedPercent(row.deltaXpPct)
              }}</TableCell>
              <TableCell class="px-2 py-2" :class="profitDeltaClass(row.deltaKillsPct)">{{
                formatSignedPercent(row.deltaKillsPct)
              }}</TableCell>
              <TableCell class="px-2 py-2">{{ formatCompactCurrency(row.costInsights?.equipmentSaleValue) }}</TableCell>
              <TableCell class="px-2 py-2">
                <span>{{ formatCompactCurrency(row.costInsights?.equipmentBuyPrice) }}</span>
                <span
                  v-for="badge in getBuyPriceBadges(row)"
                  :key="badge.key"
                  class="ml-1 inline-flex items-center rounded border px-1 py-px text-[10px] font-semibold"
                  :class="badge.class"
                  :title="badge.tooltip"
                >
                  {{ badge.label }}
                </span>
              </TableCell>
              <TableCell class="px-2 py-2">{{ formatCompactCurrency(row.costInsights?.equipmentNetCost) }}</TableCell>
              <TableCell class="px-2 py-2">{{ formatCompactCurrency(row.costInsights?.totalUpgradeCost) }}</TableCell>
              <TableCell class="px-2 py-2">{{ formatPurchaseDuration(row.costInsights?.purchaseDays) }}</TableCell>
              <TableCell class="px-2 py-2">{{
                formatCostPerPoint01Pct(row.costInsights?.goldPerPoint01PctAvg)
              }}</TableCell>
              <TableCell class="px-2 py-2">{{
                formatCostPerPoint01Pct(row.costInsights?.compositeGoldPerPoint01Pct)
              }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <DisclosurePanel :title="t('common:multiRound.rawTitle', 'Raw Round Data')">
        <div class="overflow-x-auto">
          <Table class="min-w-[1200px] w-max text-sm">
            <TableHeader>
              <TableRow class="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <TableHead class="px-2 py-2">{{ t('common:vue.queue.variant', 'Variant') }}</TableHead>
                <TableHead class="px-2 py-2">{{ t('common:vue.queue.round', 'Round') }}</TableHead>
                <TableHead class="px-2 py-2">{{ t('common:queue.metricDps', 'DPS') }}</TableHead>
                <TableHead class="px-2 py-2">{{ t('common:multiRound.deltaDpsPct', 'DPS Delta%') }}</TableHead>
                <TableHead class="px-2 py-2">{{ t('common:queue.dailyNoRngProfit', 'Daily No RNG Profit') }}</TableHead>
                <TableHead class="px-2 py-2">{{ t('common:multiRound.deltaProfitPct', 'Profit Delta%') }}</TableHead>
                <TableHead class="px-2 py-2">{{ t('common:vue.queue.xpPerHour', 'XP/h') }}</TableHead>
                <TableHead class="px-2 py-2">{{ t('common:multiRound.deltaXpPct', 'XP Delta%') }}</TableHead>
                <TableHead class="px-2 py-2">{{ t('common:simulationResults.killPerHour', 'Kills/h') }}</TableHead>
                <TableHead class="px-2 py-2">{{ t('common:multiRound.deltaKillsPct', 'Kills Delta%') }}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                v-for="row in rawRowsForDisplay"
                :key="`${row.id}-${row.round}`"
                class="border-b border-border text-foreground"
              >
                <TableCell class="px-2 py-2">
                  <p>{{ formatQueueItemSummary(row) }}</p>
                  <p v-if="getHiddenChangeCount(row) > 0" class="mt-0.5 text-xs text-muted-foreground">
                    +{{ getHiddenChangeCount(row) }}
                  </p>
                </TableCell>
                <TableCell class="px-2 py-2">{{ row.round }}</TableCell>
                <TableCell class="px-2 py-2">{{ formatNumber(row.metrics?.dps) }}</TableCell>
                <TableCell class="px-2 py-2" :class="profitDeltaClass(row.deltas?.dps?.pct)">{{
                  formatSignedPercent(row.deltas?.dps?.pct)
                }}</TableCell>
                <TableCell class="px-2 py-2">{{ formatCurrency(row.metrics?.dailyNoRngProfit) }}</TableCell>
                <TableCell class="px-2 py-2" :class="profitDeltaClass(row.deltas?.dailyNoRngProfit?.pct)">{{
                  formatSignedPercent(row.deltas?.dailyNoRngProfit?.pct)
                }}</TableCell>
                <TableCell class="px-2 py-2">{{ formatNumber(row.metrics?.xpPerHour) }}</TableCell>
                <TableCell class="px-2 py-2" :class="profitDeltaClass(row.deltas?.xpPerHour?.pct)">{{
                  formatSignedPercent(row.deltas?.xpPerHour?.pct)
                }}</TableCell>
                <TableCell class="px-2 py-2">{{ formatNumber(row.metrics?.killsPerHour) }}</TableCell>
                <TableCell class="px-2 py-2" :class="profitDeltaClass(row.deltas?.killsPerHour?.pct)">{{
                  formatSignedPercent(row.deltas?.killsPerHour?.pct)
                }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </DisclosurePanel>
    </template>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue';
import DisclosurePanel from '../components/DisclosurePanel.vue';
import { resolveQueuePerformanceSubweights } from '../../shared/queuePerformanceWeights.js';
import {
  abilityDetailIndex as abilityDetailMap,
  houseRoomDetailIndex as houseRoomDetailMap,
  itemDetailIndex as itemDetailMap,
} from '../../shared/gameDataIndex.js';
import { useSimulatorStore } from '../../stores/simulatorStore.js';
import { useGameDataText } from '../composables/useGameDataText.js';
import { useI18nText } from '../composables/useI18nText.js';
import { Progress } from '../components/ui/progress/index.js';
import { isQueueRunInProgress } from '../multiResultsPresentation.js';
import { formatQueueTriggerDetailLine } from '../queueTriggerPresentation.js';
import { buildChangedEquipmentKeys, buildSelectionKey } from '../queuePriceSelection.js';

const simulator = useSimulatorStore();
const { t, language } = useI18nText();
const { getAbilityName, getActionName, getEquipmentSlotName, getHouseRoomName, getItemName, getSkillName } =
  useGameDataText();
const ABILITY_BOOK_CATEGORY_HRID = '/item_categories/ability_book';
const ONE_HOUR = 60 * 60 * 1e9;
const RANKING_ROWS_LIMIT = 300;
const RAW_ROWS_LIMIT = 800;

const queueState = computed(() => simulator.activeQueueState);
const queuePartyStatus = computed(
  () => simulator.activeQueuePartyStatus || { hasMismatch: false, messageKey: '', memberNames: [] },
);
const queuePartySummaryText = computed(() =>
  Array.isArray(queuePartyStatus.value?.memberNames) && queuePartyStatus.value.memberNames.length > 0
    ? queuePartyStatus.value.memberNames.join(' / ')
    : '',
);
const queuePartyWarningText = computed(() =>
  queuePartyStatus.value?.hasMismatch
    ? t(
        queuePartyStatus.value?.messageKey || 'common:queue.partyChangedSinceBaseline',
        queuePartyStatus.value?.messageKey || 'common:queue.partyChangedSinceBaseline',
      )
    : '',
);
const rankingRowsForDisplay = computed(() => {
  const rows = Array.isArray(queueState.value?.ranking) ? queueState.value.ranking : [];
  return rows.length > RANKING_ROWS_LIMIT ? rows.slice(0, RANKING_ROWS_LIMIT) : rows;
});
const rawRowsForDisplay = computed(() => {
  const rows = Array.isArray(queueState.value?.rawRuns) ? queueState.value.rawRuns : [];
  return rows.length > RAW_ROWS_LIMIT ? rows.slice(0, RAW_ROWS_LIMIT) : rows;
});
const isExportingRankingExcel = ref(false);
const hasMultiData = computed(() => rankingRowsForDisplay.value.length > 0 || rawRowsForDisplay.value.length > 0);
const showRunningPlaceholder = computed(() => isQueueRunInProgress(queueState.value));
const queueRoundCount = computed(() => Math.max(0, Math.floor(Number(queueState.value?.settings?.rounds || 0))));
const totalRunCount = computed(() => {
  const queueSize = Math.max(0, Number(queueState.value?.items?.length || 0));
  return Math.max(0, queueRoundCount.value * queueSize);
});
const queueProgressPercent = computed(() => {
  const progress = Number(queueState.value?.progress || 0);
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.floor(progress * 100)));
});
const queueProgressPercentText = computed(() => `${queueProgressPercent.value}%`);
const runningPlaceholderStyle = computed(() => ({
  minHeight: 'max(320px, calc(100vh - 32rem))',
}));
const runningPlaceholderTitle = computed(() =>
  language.value === 'zh' ? '多轮排行正在准备中' : 'Multi-round ranking is being prepared',
);
const runningPlaceholderDescription = computed(() =>
  language.value === 'zh'
    ? '队列产生首批有效样本后，排行表和原始轮次数据会显示在这里。'
    : 'The ranking and raw round tables will appear here as soon as the queue finishes the first useful samples.',
);
const rawRunCount = computed(() => Math.max(0, Number(queueState.value?.rawRuns?.length || 0)));
const completedSimCountText = computed(() => `${rawRunCount.value}/${totalRunCount.value}`);
const currentCostScoreGoldMetricMode = computed(() =>
  simulator.queueRuntime?.costScoreGoldPerPointMode === 'composite' ? 'composite' : 'strict',
);
const currentCostScoreModeLabel = computed(() =>
  currentCostScoreGoldMetricMode.value === 'composite'
    ? t('common:multiRound.costScoreModeComposite', 'Composite')
    : t('common:multiRound.costScoreModeStrict', 'Strict'),
);
const costScoreColumnHeader = computed(() =>
  t('common:multiRound.costScoreWithMode', 'Cost Score ({{mode}})', { mode: currentCostScoreModeLabel.value }),
);
const queueRuntimeWeightText = computed(() => {
  const finalWeights = simulator.queueRuntime?.finalWeights || {};
  const toPct = (value, fallback) => Number((Number(value ?? fallback) * 100).toFixed(2));
  return {
    performance: toPct(finalWeights.performance, 0.4),
    stability: toPct(finalWeights.stability, 0.2),
    cost: toPct(finalWeights.cost, 0.4),
  };
});
const queuePerformanceSubweightText = computed(() => {
  const weights = resolveQueuePerformanceSubweights(queueState.value?.settings || {});
  const toPct = (value) => Number((Number(value || 0) * 100).toFixed(2));
  return {
    profit: toPct(weights.weightProfit),
    xp: toPct(weights.weightXp),
    dps: toPct(weights.weightDps),
    kills: toPct(weights.weightKills),
  };
});
const queueMedianBlendText = computed(() => {
  const medianBlend = Math.max(0, Math.min(1, Number(queueState.value?.settings?.medianBlend ?? 0.5)));
  return {
    meanWeight: Number(((1 - medianBlend) * 100).toFixed(2)),
    medianWeight: Number((medianBlend * 100).toFixed(2)),
  };
});
const actionNameFallbackMap = computed(() => {
  const map = {};
  const actionOptions = [...(simulator.options?.zones || []), ...(simulator.options?.dungeons || [])];
  for (const option of actionOptions) {
    const hrid = String(option?.hrid || '');
    if (!hrid || Object.prototype.hasOwnProperty.call(map, hrid)) {
      continue;
    }
    map[hrid] = String(option?.name || '');
  }
  return map;
});
const baselineSummaryRows = computed(() => {
  const baseline = queueState.value?.baseline;
  if (!baseline) {
    return [];
  }
  const metrics = baseline.metrics || {};
  return [
    {
      key: 'zone',
      label: t('common:queue.settingZone', 'Zone'),
      value: resolveBaselineZoneName(baseline),
    },
    {
      key: 'difficulty',
      label: t('common:queue.settingDifficulty', 'Difficulty'),
      value: resolveBaselineDifficultyText(baseline),
    },
    {
      key: 'duration',
      label: t('common:queue.settingDuration', 'Duration'),
      value: resolveBaselineDurationText(baseline),
    },
    {
      key: 'baselineRounds',
      label: t('common:queue.baselineRoundCount', 'Baseline Rounds'),
      value: resolveBaselineConfiguredRoundsText(baseline),
    },
    {
      key: 'baselineCompletedRounds',
      label: t('common:queue.baselineCompletedSamples', 'Completed Samples'),
      value: resolveBaselineCompletedRoundsText(baseline),
    },
    {
      key: 'dps',
      label: t('common:queue.metricDps', 'DPS'),
      value: formatNumber(metrics?.dps),
    },
    {
      key: 'dailyNoRngProfit',
      label: t('common:queue.dailyNoRngProfit', 'Daily No RNG Profit'),
      value: formatCompactCurrency(metrics?.dailyNoRngProfit),
    },
    {
      key: 'xpPerHour',
      label: t('common:vue.queue.xpPerHour', 'XP/h'),
      value: formatCompactCurrency(metrics?.xpPerHour),
    },
    {
      key: 'killsPerHour',
      label: t('common:simulationResults.killPerHour', 'Kills/h'),
      value: formatNumber(metrics?.killsPerHour),
    },
  ];
});
const queueChangeInlineSeparator = computed(() => (language.value === 'zh' ? '、' : ', '));
// 导出 priceMethod 列的本地化分隔符：中文用全角标点，英文用半角标点。
const priceMethodColon = computed(() => (language.value === 'zh' ? '：' : ':'));
const priceMethodJoinSeparator = computed(() => (language.value === 'zh' ? '；' : '; '));

const abilityBookInfoByAbilityHrid = (() => {
  const result = {};
  for (const item of Object.values(itemDetailMap || {})) {
    if (item?.categoryHrid !== ABILITY_BOOK_CATEGORY_HRID) {
      continue;
    }
    const abilityHrid = String(item?.abilityBookDetail?.abilityHrid || '');
    if (!abilityHrid) {
      continue;
    }
    const xpPerBook = Number(item?.abilityBookDetail?.experienceGain || 0);
    if (!Number.isFinite(xpPerBook) || xpPerBook <= 0) {
      continue;
    }
    if (!result[abilityHrid] || xpPerBook > Number(result[abilityHrid]?.xpPerBook || 0)) {
      result[abilityHrid] = {
        itemHrid: String(item?.hrid || ''),
        xpPerBook,
      };
    }
  }
  return result;
})();

const lastRunText = computed(() => {
  const timestamp = Number(queueState.value?.lastRunAt || 0);
  if (!timestamp) {
    return t('common:vue.queue.never', 'Never');
  }
  return new Date(timestamp).toLocaleString();
});

function formatNumber(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatCurrency(value) {
  if (value == null || !Number.isFinite(Number(value))) {
    return '-';
  }
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
}

function formatCompactCurrency(value, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) {
    return '-';
  }
  const numeric = Number(value || 0);
  const abs = Math.abs(numeric);

  if (abs >= 1e9) {
    return `${(numeric / 1e9).toFixed(digits)}b`;
  }
  if (abs >= 1e6) {
    return `${(numeric / 1e6).toFixed(digits)}m`;
  }
  if (abs >= 1e3) {
    return `${(numeric / 1e3).toFixed(digits)}k`;
  }
  return formatCurrency(numeric);
}

function formatCostPerPoint01Pct(value) {
  if (value == null || !Number.isFinite(Number(value))) {
    return 'N/A';
  }
  return formatCompactCurrency(value);
}

// 根据价格方式 slot 数据，构建买入价旁的标记列表。
// 每种方式（left1/right1/manual/mirror）各显示一个 badge，便于用户一眼区分价格来源。
function getBuyPriceBadges(row) {
  const slots = Array.isArray(row?.costInsights?.priceMethodSlots) ? row.costInsights.priceMethodSlots : [];
  if (slots.length === 0) {
    return [];
  }
  // 预聚合 manual 插槽的 count 和 total，用于 manual badge tooltip。
  const manualSlots = slots.filter((slot) => String(slot?.method || '') === 'manual');
  const manualCount = manualSlots.length;
  const manualTotal = manualSlots.reduce((sum, slot) => sum + Math.max(0, Number(slot?.price || 0)), 0);
  // 预聚合每种 method 下所有 slot 的"装备名 +等级"列表，用于 mirror/left1/right1 badge tooltip。
  // badge 按 method 去重只显示一个，但 tooltip 应反映该方式下所有受影响的装备，而非仅第一件。
  const slotNamesByMethod = {};
  for (const slot of slots) {
    const method = String(slot?.method || '');
    if (!method) {
      continue;
    }
    const name = getItemName(slot?.itemHrid);
    const level = Number(slot?.enhancementLevel || 0);
    const entry = `${name} +${level}`;
    if (!Array.isArray(slotNamesByMethod[method])) {
      slotNamesByMethod[method] = [];
    }
    slotNamesByMethod[method].push(entry);
  }
  // 按 method 去重，同一种方式只显示一个 badge。
  const seen = new Set();
  const badges = [];
  for (const slot of slots) {
    const method = String(slot?.method || '');
    if (!method || seen.has(method)) {
      continue;
    }
    seen.add(method);
    const names = (slotNamesByMethod[method] || []).join(', ');
    let label;
    let badgeClass;
    let tooltip;
    if (method === 'manual') {
      label = t('common:multiRound.manualPriceBadge', 'Manual');
      badgeClass = 'border-warning/40 bg-warning/10 text-warning';
      tooltip = t(
        'common:multiRound.manualPriceTooltip',
        '{{count}} equipment price(s) ({{total}}) were entered manually by the user and were not verified against market data.',
        { count: manualCount, total: formatCompactCurrency(manualTotal) },
      );
    } else if (method === 'mirror') {
      label = t('common:queue.priceMethodMirror', 'Mirror');
      badgeClass = 'border-primary/40 bg-primary/10 text-primary';
      tooltip = t('common:multiRound.mirrorPriceTooltip', '{{names}}: mirror plan total cost (incl. baseline piece)', {
        names,
      });
    } else if (method === 'right1') {
      label = t('common:queue.priceMethodRight1', 'Right 1');
      badgeClass = 'border-blue-500/40 bg-blue-500/10 text-blue-500';
      tooltip = t('common:multiRound.right1PriceTooltip', '{{names}}: right 1 (bid price)', {
        names,
      });
    } else if (method === 'left1') {
      label = t('common:queue.priceMethodLeft1', 'Left 1');
      badgeClass = 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500';
      tooltip = t('common:multiRound.left1PriceTooltip', '{{names}}: left 1 (reference ask price)', {
        names,
      });
    } else {
      // ask / official_hourly_average / market_history 等市场价来源不显示额外标记，
      // 因为左一价已覆盖这些场景；跳过非用户选定的来源。
      continue;
    }
    badges.push({ key: method, label, class: badgeClass, tooltip });
  }
  return badges;
}

function formatEquipmentBuyPriceForExport(row) {
  const formatted = formatCompactCurrency(row?.costInsights?.equipmentBuyPrice);
  if (formatted === '-') {
    return formatted;
  }
  const badges = getBuyPriceBadges(row);
  if (badges.length === 0) {
    return formatted;
  }
  const tags = badges.map((badge) => badge.label).join(', ');
  return `${formatted} [${tags}]`;
}

function formatSignedPercent(value) {
  if (value == null || !Number.isFinite(Number(value))) {
    return '-';
  }
  const numeric = Number(value || 0);
  const prefix = numeric > 0 ? '+' : '';
  return `${prefix}${numeric.toFixed(2)}%`;
}

function formatPurchaseDuration(daysValue) {
  const numeric = Number(daysValue);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '-';
  }
  if (numeric < 1) {
    return `${(numeric * 24).toFixed(1)}h`;
  }
  return `${numeric.toFixed(1)}d`;
}

function formatActionName(actionHrid, fallbackName = '-') {
  const hrid = String(actionHrid || '');
  if (!hrid) {
    return fallbackName || '-';
  }

  return getActionName(hrid, fallbackName || hrid);
}

function resolveBaselineZoneName(baseline) {
  const configuredHrid = String(baseline?.settings?.zoneHrid || '');
  if (configuredHrid) {
    return formatActionName(configuredHrid, actionNameFallbackMap.value?.[configuredHrid] || configuredHrid);
  }

  const resultZone = String(baseline?.simResult?.zoneHrid || baseline?.simResult?.zoneName || '');
  if (!resultZone) {
    return '-';
  }
  if (resultZone.startsWith('/actions/')) {
    return formatActionName(resultZone, actionNameFallbackMap.value?.[resultZone] || resultZone);
  }
  return resultZone;
}

function resolveBaselineDifficultyText(baseline) {
  const settingTier = Number(baseline?.settings?.difficultyTier);
  if (Number.isFinite(settingTier)) {
    return `T${Math.max(0, Math.floor(settingTier))}`;
  }

  const resultTier = Number(baseline?.simResult?.difficultyTier);
  if (Number.isFinite(resultTier)) {
    return `T${Math.max(0, Math.floor(resultTier))}`;
  }
  return '-';
}

function resolveBaselineDurationText(baseline) {
  const settingHours = Number(baseline?.settings?.simulationTimeHours);
  if (Number.isFinite(settingHours) && settingHours > 0) {
    return `${Math.floor(settingHours)}h`;
  }

  const simulatedTimeNs = Number(baseline?.simResult?.simulatedTime);
  const simulatedHours = simulatedTimeNs / ONE_HOUR;
  if (Number.isFinite(simulatedHours) && simulatedHours > 0) {
    const rounded = Math.round(simulatedHours * 10) / 10;
    return `${rounded}h`;
  }

  return '-';
}

function resolveBaselineConfiguredRoundsText(baseline) {
  const configuredRounds = Number(baseline?.settings?.baselineRounds);
  if (Number.isFinite(configuredRounds) && configuredRounds > 0) {
    return `${Math.max(1, Math.floor(configuredRounds))}`;
  }
  if (baseline?.simResult) {
    return '1';
  }
  return '-';
}

function resolveBaselineCompletedRoundsText(baseline) {
  const completedRounds = Number(baseline?.completedRounds);
  if (Number.isFinite(completedRounds) && completedRounds > 0) {
    return `${Math.max(0, Math.floor(completedRounds))}`;
  }
  if (baseline?.simResult) {
    return '1';
  }
  return '-';
}

function resolveItemName(itemHrid) {
  const hrid = String(itemHrid || '');
  if (!hrid) {
    return '';
  }
  return getItemName(hrid, itemDetailMap?.[hrid]?.name || hrid);
}

function resolveAbilityName(abilityHrid) {
  const hrid = String(abilityHrid || '');
  if (!hrid) {
    return '';
  }
  return getAbilityName(hrid, hrid);
}

function resolveTriggerTargetName(targetHrid) {
  const hrid = String(targetHrid || '');
  if (!hrid) {
    return '';
  }
  if (Object.prototype.hasOwnProperty.call(itemDetailMap || {}, hrid)) {
    return resolveItemName(hrid);
  }
  if (Object.prototype.hasOwnProperty.call(abilityDetailMap || {}, hrid)) {
    return resolveAbilityName(hrid);
  }
  return hrid;
}

function formatSkillName(skillKey) {
  const raw = String(skillKey || '').trim();
  if (!raw) {
    return '';
  }
  return getSkillName(raw, raw);
}

function localizeEquipmentSlotLabel(slotKey) {
  return getEquipmentSlotName(String(slotKey || ''));
}

function getAbilityXpForLevel(level) {
  const xpLevels = Array.isArray(window?.jigsLevelExperienceTable) ? window.jigsLevelExperienceTable : null;
  if (!xpLevels) {
    return null;
  }
  const normalizedLevel = Number(level);
  if (!Number.isFinite(normalizedLevel) || normalizedLevel < 0 || normalizedLevel >= xpLevels.length) {
    return null;
  }
  const xpValue = Number(xpLevels[normalizedLevel]);
  return Number.isFinite(xpValue) ? xpValue : null;
}

function getSpellBookXpForAbility(abilityHrid) {
  const normalizedHrid = String(abilityHrid || '');
  if (!normalizedHrid) {
    return 0;
  }

  const directBookInfo = abilityBookInfoByAbilityHrid?.[normalizedHrid];
  if (directBookInfo?.xpPerBook > 0) {
    return directBookInfo.xpPerBook;
  }

  const abilityName = String(abilityDetailMap?.[normalizedHrid]?.name || '');
  if (!abilityName) {
    return 0;
  }

  const spellBookXpMap = window?.jigsSpellBookXpByName;
  if (!spellBookXpMap || typeof spellBookXpMap !== 'object') {
    return 0;
  }

  const matchedKey = Object.keys(spellBookXpMap).find((key) => String(key).toLowerCase() === abilityName.toLowerCase());
  const xpPerBook = matchedKey ? Number(spellBookXpMap[matchedKey]) : 0;
  return Number.isFinite(xpPerBook) && xpPerBook > 0 ? xpPerBook : 0;
}

function computeAbilityBooksNeededForRange(abilityHrid, fromLevel, toLevel) {
  const safeHrid = String(abilityHrid || '');
  const safeFrom = Number(fromLevel);
  const safeTo = Number(toLevel);
  if (!safeHrid || !Number.isFinite(safeFrom) || !Number.isFinite(safeTo) || safeTo <= safeFrom) {
    return null;
  }

  const startXp = getAbilityXpForLevel(safeFrom);
  const endXp = getAbilityXpForLevel(safeTo);
  if (startXp == null || endXp == null) {
    return null;
  }

  const xpNeeded = endXp - startXp;
  if (xpNeeded <= 0) {
    return 0;
  }

  const xpPerBook = getSpellBookXpForAbility(safeHrid);
  if (!xpPerBook) {
    return null;
  }

  const booksNeeded = Math.ceil(xpNeeded / xpPerBook);
  return Number.isFinite(booksNeeded) && booksNeeded >= 0 ? booksNeeded : null;
}

function formatQueueChangeDetailLine(change) {
  const kind = String(change?.kind || '');

  if (kind === 'trigger') {
    return formatQueueTriggerDetailLine(change, {
      t,
      resolveTargetName: resolveTriggerTargetName,
    });
  }

  if (kind === 'ability') {
    const beforeHrid = String(change?.beforeAbilityHrid || '');
    const afterHrid = String(change?.afterAbilityHrid || '');
    const beforeLevel = Number(change?.beforeLevel || 1);
    const afterLevel = Number(change?.afterLevel || 1);
    if (
      beforeHrid &&
      afterHrid &&
      beforeHrid === afterHrid &&
      Number.isFinite(beforeLevel) &&
      Number.isFinite(afterLevel)
    ) {
      const abilityName = resolveAbilityName(afterHrid);
      const books = computeAbilityBooksNeededForRange(afterHrid, beforeLevel, afterLevel);
      if (books != null) {
        return t('common:queue.skillLevelChangeWithBooks', '{{name}}: Level {{from}} -> {{to}} ({{books}} books)', {
          name: abilityName,
          from: beforeLevel,
          to: afterLevel,
          books,
        });
      }
      return t('common:queue.skillLevelChange', '{{name}}: Level {{from}} -> {{to}}', {
        name: abilityName,
        from: beforeLevel,
        to: afterLevel,
      });
    }
  }

  if (kind === 'equipment') {
    const beforeItemHrid = String(change?.beforeItemHrid || '');
    const afterItemHrid = String(change?.afterItemHrid || '');
    const beforeLevel = Math.max(0, Math.floor(Number(change?.beforeEnhancementLevel || 0)));
    const afterLevel = Math.max(0, Math.floor(Number(change?.afterEnhancementLevel || 0)));

    if (beforeItemHrid && afterItemHrid && beforeItemHrid === afterItemHrid) {
      return t('common:queue.itemEnhancementChange', '{{name}}: Enhance {{from}} -> {{to}}', {
        name: resolveItemName(beforeItemHrid),
        from: beforeLevel,
        to: afterLevel,
      });
    }
  }

  if (kind === 'level') {
    const before = Number(change?.beforeLevel);
    const after = Number(change?.afterLevel);
    return t('common:queue.skillLevelChange', '{{name}}: Level {{from}} -> {{to}}', {
      name: formatSkillName(change?.key),
      from: Number.isFinite(before) ? before : 1,
      to: Number.isFinite(after) ? after : 1,
    });
  }

  if (kind === 'house_room') {
    const before = Math.max(0, Math.floor(Number(change?.beforeLevel || 0)));
    const after = Math.max(0, Math.floor(Number(change?.afterLevel || 0)));
    const roomHrid = String(change?.roomHrid || '');
    return t('common:queue.houseRoomLevelChange', '{{name}}: Level {{from}} -> {{to}}', {
      name: getHouseRoomName(roomHrid, houseRoomDetailMap?.[roomHrid]?.name || roomHrid || 'House Room'),
      from: before,
      to: after,
    });
  }

  if (kind === 'food' || kind === 'drink') {
    const slotIndex = Number(change?.index) + 1;
    const slotLabel =
      kind === 'food'
        ? t('common:queue.foodSlot', 'Food Slot {{index}}', { index: Number.isFinite(slotIndex) ? slotIndex : 1 })
        : t('common:queue.drinkSlot', 'Drink Slot {{index}}', { index: Number.isFinite(slotIndex) ? slotIndex : 1 });
    const beforeText = resolveItemName(change?.beforeItemHrid) || '-';
    const afterText = resolveItemName(change?.afterItemHrid) || '-';
    return `${slotLabel}: ${beforeText} -> ${afterText}`;
  }

  if (kind === 'equipment') {
    const slotLabel = localizeEquipmentSlotLabel(change?.slot);
    const beforeText = change?.beforeItemHrid
      ? `${resolveItemName(change.beforeItemHrid)}(+${Math.max(0, Math.floor(Number(change?.beforeEnhancementLevel || 0)))})`
      : '-';
    const afterText = change?.afterItemHrid
      ? `${resolveItemName(change.afterItemHrid)}(+${Math.max(0, Math.floor(Number(change?.afterEnhancementLevel || 0)))})`
      : '-';
    return slotLabel ? `${slotLabel}: ${beforeText} -> ${afterText}` : `${beforeText} -> ${afterText}`;
  }

  if (kind === 'ability') {
    const slotIndex = Number(change?.index) + 1;
    const slotLabel = t('common:queue.abilitySlot', 'Ability Slot {{index}}', {
      index: Number.isFinite(slotIndex) ? slotIndex : 1,
    });
    const beforeLevel = Math.max(1, Math.floor(Number(change?.beforeLevel || 1)));
    const afterLevel = Math.max(1, Math.floor(Number(change?.afterLevel || 1)));
    const beforeText = change?.beforeAbilityHrid
      ? `${resolveAbilityName(change.beforeAbilityHrid)}(Lv.${beforeLevel})`
      : '-';
    const afterText = change?.afterAbilityHrid
      ? `${resolveAbilityName(change.afterAbilityHrid)}(Lv.${afterLevel})`
      : '-';
    return `${slotLabel}: ${beforeText} -> ${afterText}`;
  }

  return '';
}

function humanizeLegacyChangeLine(rawLine) {
  let line = String(rawLine || '').trim();
  if (!line) {
    return '';
  }
  line = line.replace(/\/items\/[a-z0-9_]+/gi, (hrid) => resolveItemName(hrid));
  line = line.replace(/\/abilities\/[a-z0-9_]+/gi, (hrid) => resolveAbilityName(hrid));
  return line;
}

function collectQueueChangeLines(row) {
  const changeDetails = Array.isArray(row?.changeDetails) ? row.changeDetails : [];
  if (changeDetails.length > 0) {
    return changeDetails.map((change) => formatQueueChangeDetailLine(change)).filter(Boolean);
  }
  return (Array.isArray(row?.changes) ? row.changes : []).map((line) => humanizeLegacyChangeLine(line)).filter(Boolean);
}

function formatQueueItemSummary(row, limit = 2) {
  const lines = collectQueueChangeLines(row);
  const safeLimit = Math.max(0, Math.floor(Number(limit || 0)));
  if (lines.length === 0) {
    return String(row?.label || '-');
  }
  return lines.slice(0, safeLimit).join(queueChangeInlineSeparator.value);
}

function getHiddenChangeCount(row, limit = 2) {
  const total = collectQueueChangeLines(row).length;
  const safeLimit = Math.max(0, Math.floor(Number(limit || 0)));
  return Math.max(0, total - safeLimit);
}

function formatQueueItemSummaryForExport(row) {
  const lines = collectQueueChangeLines(row);
  if (lines.length === 0) {
    return String(row?.label || '-');
  }
  return lines.join(queueChangeInlineSeparator.value);
}

function formatRowSimCount(row) {
  const doneRounds = Math.max(0, Math.floor(Number(row?.rounds || 0)));
  return `${doneRounds}/${queueRoundCount.value}`;
}

function getRankRowClass(row) {
  const rank = Math.max(0, Math.floor(Number(row?.rank || 0)));
  if (rank === 1) {
    return 'bg-primary/10';
  }
  if (rank === 2) {
    return 'bg-muted/50';
  }
  if (rank === 3) {
    return 'bg-warning/10';
  }
  if (rank === 4) {
    return 'bg-success/10';
  }
  if (rank === 5) {
    return 'bg-info/10';
  }
  return '';
}

function getRankBadgeClass(rankValue) {
  const rank = Math.max(0, Math.floor(Number(rankValue || 0)));
  if (rank === 1) {
    return 'border-primary/40 bg-primary/10 text-primary';
  }
  if (rank === 2) {
    return 'border-border bg-muted/50 text-foreground';
  }
  if (rank === 3) {
    return 'border-warning/40 bg-warning/10 text-warning';
  }
  if (rank === 4) {
    return 'border-success/40 bg-success/10 text-success';
  }
  if (rank === 5) {
    return 'border-info/40 bg-info/10 text-info';
  }
  return 'border-border bg-muted/40 text-foreground';
}

function toFiniteForExport(value, digits = null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (digits == null) {
    return numeric;
  }
  return Number(numeric.toFixed(digits));
}

function getDeltaFontColor(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return null;
  }
  return numeric > 0 ? 'FF10B981' : 'FFF43F5E';
}

async function exportRankingRowsExcel() {
  if (isExportingRankingExcel.value) {
    return;
  }
  const rows = (queueState.value?.ranking || []).slice();
  if (rows.length === 0) {
    return;
  }

  isExportingRankingExcel.value = true;
  try {
    const { Workbook } = await import('exceljs');
    const workbook = new Workbook();
    workbook.creator = 'MWI Combat Simulator';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Ranking', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    worksheet.columns = [
      { header: t('common:multiRound.rank', 'Rank'), key: 'rank', width: 8 },
      { header: t('common:vue.queue.variant', 'Variant'), key: 'variant', width: 56 },
      { header: t('common:multiRound.simCount', 'Sim Count'), key: 'simCount', width: 12 },
      { header: t('common:multiRound.finalScore', 'Final Score'), key: 'finalScore', width: 12 },
      { header: t('common:multiRound.performanceScore', 'Performance Score'), key: 'performanceScore', width: 16 },
      { header: t('common:multiRound.stabilityScore', 'Stability Score'), key: 'stabilityScore', width: 14 },
      { header: costScoreColumnHeader.value, key: 'costScore', width: 18 },
      { header: t('common:queue.dailyNoRngProfit', 'Daily No RNG Profit'), key: 'dailyNoRngProfitPerDay', width: 18 },
      { header: t('common:vue.queue.deltaProfitPerHour', 'Delta Profit/h'), key: 'deltaProfitPerHour', width: 14 },
      { header: t('common:multiRound.deltaProfitPct', 'Profit Delta%'), key: 'deltaProfitPct', width: 12 },
      { header: t('common:multiRound.deltaDpsPct', 'DPS Delta%'), key: 'deltaDpsPct', width: 10 },
      { header: t('common:multiRound.deltaXpPct', 'XP Delta%'), key: 'deltaXpPct', width: 10 },
      { header: t('common:multiRound.deltaKillsPct', 'Kills Delta%'), key: 'deltaKillsPct', width: 12 },
      {
        header: t('common:vue.queue.equipmentSaleValue', 'Replaced Equipment Sale Value'),
        key: 'equipmentSaleValue',
        width: 18,
      },
      {
        header: t('common:vue.queue.equipmentBuyPrice', 'Target Equipment Buy Price'),
        key: 'equipmentBuyPrice',
        width: 16,
      },
      { header: t('common:vue.queue.equipmentNetCost', 'Equipment Net Cost'), key: 'equipmentNetCost', width: 14 },
      { header: t('common:equipment.upgradeCost', 'Upgrade Cost'), key: 'upgradeCost', width: 14 },
      { header: t('common:queue.purchaseTime', 'Purchase Time'), key: 'purchaseTime', width: 14 },
      {
        header: t('common:multiRound.avgCostPerPoint01Pct', 'Gold per 0.01% (all four > 0)'),
        key: 'goldPerPoint01PctAvg',
        width: 26,
      },
      {
        header: t('common:multiRound.compositeCostPerPoint01Pct', 'Gold per 0.01% (composite)'),
        key: 'compositeGoldPerPoint01Pct',
        width: 24,
      },
      { header: t('common:queue.priceMethodColumn', 'Price Method'), key: 'priceMethod', width: 20 },
    ];

    const baselineSnapshot = queueState.value?.baseline?.snapshot ?? null;
    const bodyRows = rows.map((row) => {
      const queueItem = (Array.isArray(queueState.value?.items) ? queueState.value.items : []).find(
        (item) => String(item?.id || '') === String(row?.id || ''),
      );
      const allPriceSelections = Array.isArray(queueItem?.priceSelections) ? queueItem.priceSelections : [];
      // 按 variant 过滤 priceSelections：只保留该 variant 实际变更的装备，
      // 与 QueuePage 的 buildPriceSelectionLines 保持一致，避免多 variant 队列
      // 导出时列出不属于本变体的装备价格方式。
      const changedKeys = buildChangedEquipmentKeys(queueItem, baselineSnapshot);
      const priceSelections =
        changedKeys.size > 0
          ? allPriceSelections.filter((selection) =>
              changedKeys.has(buildSelectionKey(selection.itemHrid, selection.enhancementLevel)),
            )
          : allPriceSelections;
      const priceMethodText = priceSelections
        .map((selection) => {
          const method = String(selection.method || 'left1');
          const label =
            method === 'manual'
              ? t('common:queue.priceMethodManual', 'Manual')
              : method === 'mirror'
                ? t('common:queue.priceMethodMirror', 'Mirror')
                : method === 'right1'
                  ? t('common:queue.priceMethodRight1', 'Right 1')
                  : t('common:queue.priceMethodLeft1', 'Left 1');
          return `${resolveItemName(selection.itemHrid)}+${Number(selection.enhancementLevel || 0)}${priceMethodColon.value}${label}`;
        })
        .join(priceMethodJoinSeparator.value);
      return {
        rank: toFiniteForExport(row?.rank, 0),
        variant: formatQueueItemSummaryForExport(row),
        simCount: `${Math.max(0, Math.floor(Number(row?.rounds || 0)))}/${queueRoundCount.value}`,
        finalScore: toFiniteForExport(row?.finalScore, 2),
        performanceScore: toFiniteForExport(row?.performanceScore, 2),
        stabilityScore: toFiniteForExport(row?.stabilityScore, 2),
        costScore: toFiniteForExport(row?.costScore, 2),
        dailyNoRngProfitPerDay: formatCompactCurrency(row?.dailyNoRngProfitPerDay),
        deltaProfitPerHour: formatCompactCurrency(row?.deltaProfitPerHour),
        deltaProfitPct: toFiniteForExport(row?.deltaProfitPct, 2),
        deltaDpsPct: toFiniteForExport(row?.deltaDpsPct, 2),
        deltaXpPct: toFiniteForExport(row?.deltaXpPct, 2),
        deltaKillsPct: toFiniteForExport(row?.deltaKillsPct, 2),
        equipmentSaleValue: formatCompactCurrency(row?.costInsights?.equipmentSaleValue),
        equipmentBuyPrice: formatEquipmentBuyPriceForExport(row),
        equipmentNetCost: formatCompactCurrency(row?.costInsights?.equipmentNetCost),
        upgradeCost: formatCompactCurrency(row?.costInsights?.totalUpgradeCost),
        purchaseTime: formatPurchaseDuration(row?.costInsights?.purchaseDays),
        goldPerPoint01PctAvg: formatCostPerPoint01Pct(row?.costInsights?.goldPerPoint01PctAvg),
        compositeGoldPerPoint01Pct: formatCostPerPoint01Pct(row?.costInsights?.compositeGoldPerPoint01Pct),
        priceMethod: priceMethodText,
      };
    });
    worksheet.addRows(bodyRows);

    const headerRow = worksheet.getRow(1);
    headerRow.height = 24;
    headerRow.font = {
      bold: true,
      color: { argb: 'FFFFFFFF' },
      size: 11,
    };
    headerRow.alignment = {
      horizontal: 'center',
      vertical: 'middle',
      wrapText: true,
    };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF334155' },
    };

    const thinBorder = {
      top: { style: 'thin', color: { argb: 'FF334155' } },
      left: { style: 'thin', color: { argb: 'FF334155' } },
      bottom: { style: 'thin', color: { argb: 'FF334155' } },
      right: { style: 'thin', color: { argb: 'FF334155' } },
    };
    worksheet.eachRow({ includeEmpty: false }, (excelRow, rowNumber) => {
      excelRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = thinBorder;
      });
      if (rowNumber > 1 && rowNumber % 2 === 0) {
        excelRow.eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8FAFC' },
          };
        });
      }
    });

    const centerKeys = ['rank', 'simCount', 'purchaseTime'];
    const rightKeys = [
      'finalScore',
      'performanceScore',
      'stabilityScore',
      'costScore',
      'dailyNoRngProfitPerDay',
      'deltaProfitPerHour',
      'deltaProfitPct',
      'deltaDpsPct',
      'deltaXpPct',
      'deltaKillsPct',
      'equipmentSaleValue',
      'equipmentBuyPrice',
      'equipmentNetCost',
      'upgradeCost',
      'goldPerPoint01PctAvg',
      'compositeGoldPerPoint01Pct',
    ];
    for (const key of centerKeys) {
      worksheet.getColumn(key).alignment = { horizontal: 'center', vertical: 'middle' };
    }
    worksheet.getColumn('variant').alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    for (const key of rightKeys) {
      worksheet.getColumn(key).alignment = { horizontal: 'right', vertical: 'middle' };
    }

    const percentKeys = ['deltaProfitPct', 'deltaDpsPct', 'deltaXpPct', 'deltaKillsPct'];
    for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
      const sourceRow = rows[rowIndex - 2] || {};
      const excelRow = worksheet.getRow(rowIndex);
      for (const key of percentKeys) {
        const cell = excelRow.getCell(key);
        if (Number.isFinite(Number(cell.value))) {
          cell.numFmt = '0.00"%"';
        }
      }

      const deltaColorByKey = {
        deltaProfitPerHour: getDeltaFontColor(sourceRow?.deltaProfitPerHour),
        deltaProfitPct: getDeltaFontColor(sourceRow?.deltaProfitPct),
        deltaDpsPct: getDeltaFontColor(sourceRow?.deltaDpsPct),
        deltaXpPct: getDeltaFontColor(sourceRow?.deltaXpPct),
        deltaKillsPct: getDeltaFontColor(sourceRow?.deltaKillsPct),
      };
      for (const [key, color] of Object.entries(deltaColorByKey)) {
        if (!color) {
          continue;
        }
        const cell = excelRow.getCell(key);
        cell.font = {
          ...(cell.font || {}),
          color: { argb: color },
        };
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mwi-multi-ranking-${Date.now()}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Failed to export multi-round ranking to Excel:', error);
  } finally {
    isExportingRankingExcel.value = false;
  }
}

function profitDeltaClass(value) {
  const numeric = Number(value || 0);
  if (numeric > 0) {
    return 'text-success';
  }
  if (numeric < 0) {
    return 'text-destructive';
  }
  return 'text-foreground';
}
</script>

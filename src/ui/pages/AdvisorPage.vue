<template>
  <section class="space-y-4">
    <div class="grid grid-cols-1 gap-4">
      <div class="panel overflow-hidden">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div class="space-y-2">
            <p class="text-xs uppercase tracking-[0.18em] text-amber-300/80">{{ t("common:advisor.eyebrow", "Advisor") }}</p>
            <h2 class="font-heading text-2xl font-semibold text-slate-100">{{ t("common:advisor.title", "刷图推荐器") }}</h2>
            <p class="max-w-3xl text-sm leading-6 text-slate-300">
              {{ t("common:advisor.desc", "Use your current team, buffs, achievements, housing, pricing, and run duration to rank the best farming targets across solo zones and group zones.") }}
            </p>
            <div class="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span class="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">{{ selectedPlayersLabel }}</span>
              <span class="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">{{ metricPlayerLabel }}</span>
              <span class="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">{{ runtimeStatusText }}</span>
              <span class="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">{{ pricingModeText }}</span>
            </div>
          </div>

          <div class="flex w-full flex-col gap-3 lg:w-[280px]">
            <button
              type="button"
              class="action-button-primary w-full justify-center"
              :disabled="isRunning"
              @click="runAdvisor"
            >
              {{ isRunning ? t("common:advisor.running", "Scanning...") : t("common:advisor.run", "Run Advisor") }}
            </button>
            <button
              type="button"
              class="action-button-danger w-full justify-center"
              :disabled="!isRunning"
              @click="stopAdvisor"
            >
              {{ t("common:advisor.stop", "Stop Advisor") }}
            </button>
            <div class="rounded-2xl border border-amber-300/20 bg-gradient-to-br from-amber-300/15 via-amber-300/5 to-transparent p-3 text-xs text-slate-300">
              <div class="flex items-center justify-between gap-2">
                <span class="uppercase tracking-[0.14em] text-amber-200">{{ t("common:advisor.progress", "Progress") }}</span>
                <span>{{ progressText }}</span>
              </div>
              <div class="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div class="h-full rounded-full bg-amber-300 transition-all duration-300" :style="{ width: `${progressPercent}%` }"></div>
              </div>
              <p class="mt-2 text-[11px] text-slate-400">{{ runtimePhaseText }}</p>
            </div>
          </div>
        </div>

        <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div class="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div class="flex flex-wrap items-center gap-2">
              <span class="field-label mb-0">{{ t("common:advisor.goal", "Goal") }}</span>
              <button
                v-for="preset in presetOptions"
                :key="preset.value"
                type="button"
                :class="[
                  'rounded-full border px-3 py-1.5 text-xs transition',
                  simulator.advisor.goalPreset === preset.value
                    ? 'border-amber-300 bg-amber-300/15 text-amber-100'
                    : 'border-white/10 bg-white/5 text-slate-300 hover:border-amber-300/40 hover:text-amber-100',
                ]"
                @click="setPreset(preset.value)"
              >
                {{ preset.label }}
              </button>
            </div>

            <div v-if="simulator.advisor.goalPreset === ADVISOR_GOAL_PRESET_CUSTOM" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
              <label v-for="weight in customInputFields" :key="weight.key" class="block">
                <span class="field-label">{{ weight.label }}</span>
                <input
                  v-model.number="customWeightDraft[weight.key]"
                  type="number"
                  min="0"
                  step="0.01"
                  class="field-input"
                  @change="applyCustomWeights"
                />
              </label>
            </div>
            <p v-if="simulator.advisor.goalPreset === ADVISOR_GOAL_PRESET_CUSTOM" class="text-xs text-slate-400">
              {{ customWeightSummaryText }}
            </p>
          </div>

          <div class="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-200">
                <input v-model="filterDraft.includeSoloZones" type="checkbox" class="accent-amber-300" />
                <span>{{ t("common:advisor.includeSolo", "Solo zones") }}</span>
              </label>
              <label class="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-200">
                <input v-model="filterDraft.includeGroupZones" type="checkbox" class="accent-amber-300" />
                <span>{{ t("common:advisor.includeGroup", "Group zones") }}</span>
              </label>
              <label class="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-200">
                <input v-model="filterDraft.refineTopEnabled" type="checkbox" class="accent-amber-300" />
                <span>{{ t("common:advisor.refineTop", "Refine Top 8") }}</span>
              </label>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <label class="block">
                <span class="field-label">{{ t("common:advisor.refineCount", "Refine Count") }}</span>
                <input v-model.number="filterDraft.refineTopCount" type="number" min="1" max="32" class="field-input" />
              </label>
              <label class="block">
                <span class="field-label">{{ t("common:advisor.refineRounds", "Refine Rounds") }}</span>
                <input v-model.number="filterDraft.refineRounds" type="number" min="1" max="30" class="field-input" />
              </label>
            </div>
          </div>
        </div>

        <div v-if="applyStatus || simulator.advisor.error" class="mt-4 space-y-2">
          <p v-if="applyStatus" class="rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">
            {{ applyStatus }}
          </p>
          <p v-if="simulator.advisor.error" class="rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
            {{ advisorErrorText }}
          </p>
        </div>
      </div>

      <aside class="panel">
        <div v-if="topCardsWithRows.length === 0">
          <p class="text-sm text-slate-400">{{ t("common:advisor.noCards", "Run the advisor to generate quick picks and top cards.") }}</p>
        </div>

        <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <article
             v-for="card in topCardsWithRows"
             :key="card.key"
             class="rounded-2xl border border-white/10 bg-slate-900/80 bg-gradient-to-br from-amber-300/15 via-amber-300/5 to-transparent p-4 shadow-[0_18px_50px_rgba(15,23,42,0.35)]"
           >
             <div class="flex items-start justify-between gap-3">
               <div>
                 <p class="text-[11px] uppercase tracking-[0.18em] text-amber-300">{{ card.title }}</p>
                 <h3 class="mt-1 font-heading text-lg text-slate-100">{{ getTargetLabel(card.row || card) }}</h3>
                 <p class="mt-1 text-xs text-slate-400">{{ getContentTypeLabel(card.row || card) }} · {{ getDifficultyLabel(card.row || card) }}</p>
               </div>
              <span class="rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-xs text-amber-100">
                {{ formatMetric(card.row?.finalScore ?? card.score, 1) }}
              </span>
            </div>
            <div v-if="card.row" class="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300">
              <div class="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                <p class="text-slate-400">{{ t("common:advisor.dailyProfit", "Daily Profit") }}</p>
                <p class="mt-1 text-sm text-slate-100">{{ formatAdvisorDailyProfitValue(card.row.profitPerHour) }}</p>
              </div>
              <div class="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                <p class="text-slate-400">{{ t("common:advisor.xpPerHour", "XP/h") }}</p>
                <p class="mt-1 text-sm text-slate-100">{{ formatAdvisorCompactValue(card.row.xpPerHour) }}</p>
              </div>
            </div>
            <button
              v-if="card.row"
              type="button"
              class="action-button-muted mt-3 w-full justify-center"
              @click="applyToHome(card.row)"
            >
              {{ t("common:advisor.applyToHome", "Apply to Home") }}
            </button>
          </article>
        </div>
      </aside>
    </div>

    <div v-if="displayRows.length === 0" class="panel">
      <p class="text-sm text-slate-400">{{ t("common:advisor.noResults", "No advisor results yet. Click 'Run Advisor' to scan current farming targets.") }}</p>
    </div>

    <div v-else class="panel overflow-x-auto">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 class="font-heading text-base font-semibold text-amber-200">{{ t("common:advisor.tableTitle", "Recommended Targets") }}</h3>
          <p class="text-xs text-slate-400">{{ tableSummaryText }}</p>
        </div>
        <span class="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
          {{ t("common:advisor.rowCount", "Rows") }}: {{ displayRows.length }}
        </span>
      </div>

      <table class="min-w-[1280px] w-full text-sm">
        <thead>
          <tr class="border-b border-white/10 text-left text-xs uppercase tracking-[0.14em] text-slate-400">
            <th class="px-2 py-3">#</th>
            <th class="px-2 py-3">{{ t("common:advisor.contentType", "Type") }}</th>
            <th class="px-2 py-3">{{ t("common:advisor.target", "Target") }}</th>
            <th class="px-2 py-3">{{ t("common:advisor.difficulty", "Difficulty") }}</th>
            <th class="px-2 py-3">{{ t("common:advisor.dailyProfit", "Daily Profit") }}</th>
            <th class="px-2 py-3">{{ t("common:advisor.xpPerHour", "XP/h") }}</th>
            <th class="px-2 py-3">{{ t("common:advisor.killsPerHour", "Kills/h") }}</th>
            <th class="px-2 py-3">{{ t("common:advisor.deathsPerHour", "Deaths/h") }}</th>
            <th class="px-2 py-3">{{ t("common:advisor.score", "Score") }}</th>
            <th class="px-2 py-3">{{ t("common:advisor.reason", "Reasons") }}</th>
            <th class="px-2 py-3"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in displayRows"
            :key="row.id"
            :class="[
              'border-b border-white/5 align-top transition-colors',
              row.rank <= 3 ? 'bg-amber-300/5' : 'hover:bg-white/5',
            ]"
          >
            <td class="px-2 py-3 font-medium text-slate-100">{{ row.rank }}</td>
            <td class="px-2 py-3 text-slate-300">{{ getContentTypeLabel(row) }}</td>
            <td class="px-2 py-3">
              <div class="font-medium text-slate-100">{{ getTargetLabel(row) }}</div>
            </td>
            <td class="px-2 py-3 text-slate-300">{{ getDifficultyLabel(row) }}</td>
            <td class="px-2 py-3 text-slate-100">
              <span :class="Number(row.profitPerHour) === maxAdvisorRowMetrics.profitPerHour ? maxMetricValueClass : metricValueClass">
                {{ formatAdvisorDailyProfitValue(row.profitPerHour) }}
              </span>
            </td>
            <td class="px-2 py-3 text-slate-100">
              <span :class="Number(row.xpPerHour) === maxAdvisorRowMetrics.xpPerHour ? maxMetricValueClass : metricValueClass">
                {{ formatAdvisorCompactValue(row.xpPerHour) }}
              </span>
            </td>
            <td class="px-2 py-3 text-slate-100">
              <span :class="Number(row.killsPerHour) === maxAdvisorRowMetrics.killsPerHour ? maxMetricValueClass : metricValueClass">
                {{ formatMetric(row.killsPerHour, 1) }}
              </span>
            </td>
            <td class="px-2 py-3 text-slate-100">{{ formatMetric(row.deathsPerHour, 2) }}</td>
            <td class="px-2 py-3">
              <div class="flex flex-wrap items-center gap-2">
                <span class="rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-xs text-amber-100">
                  {{ formatMetric(row.finalScore, 1) }}
                </span>
                <span v-if="row.isRefined" class="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-200">
                  {{ t("common:advisor.confidence", "Confidence") }} {{ formatMetric(row.confidenceScore, 0) }}%
                </span>
                <span v-else class="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
                  {{ t("common:advisor.quick", "Quick") }}
                </span>
              </div>
              <p class="mt-1 text-[11px] text-slate-500">
                {{ row.isRefined ? t("common:advisor.refinedRounds", "Refined {done}/{total} rounds", { done: row.successfulRounds, total: row.refineRounds }) : t("common:advisor.singlePass", "Single quick pass") }}
              </p>
            </td>
            <td class="px-2 py-3">
              <div class="flex max-w-[240px] flex-wrap gap-1.5">
                <span
                  v-for="reason in row.reasons"
                  :key="reason"
                  class="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-200"
                >
                  {{ getReasonLabel(reason) }}
                </span>
              </div>
            </td>
            <td class="px-2 py-3 text-right">
              <button type="button" class="action-button-muted" @click="applyToHome(row)">
                {{ t("common:advisor.applyToHome", "Apply to Home") }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup>
 import { computed, reactive, ref, watch } from "vue";
 import { useRouter } from "vue-router";
 import { actionDetailIndex as actionDetailMap } from "../../shared/gameDataIndex.js";
import { formatAdvisorCompactValue, formatAdvisorDailyProfitValue } from "../../services/advisorFormatting.js";
import { useSimulatorStore } from "../../stores/simulatorStore.js";
import {
  ADVISOR_GOAL_PRESET_BALANCED,
  ADVISOR_GOAL_PRESET_CUSTOM,
  ADVISOR_GOAL_PRESET_PROFIT,
  ADVISOR_GOAL_PRESET_SAFE,
  ADVISOR_GOAL_PRESET_XP,
} from "../../services/advisorScoring.js";
import { useI18nText } from "../composables/useI18nText.js";

 const simulator = useSimulatorStore();
 const router = useRouter();
 const { t } = useI18nText();
 const applyStatus = ref("");

const metricValueClass = "inline-flex items-center rounded-full border border-transparent px-2.5 py-1 tabular-nums";

const maxMetricValueClass = `${metricValueClass} border-amber-300/80 bg-amber-300/20 font-semibold text-amber-50 shadow-[0_14px_32px_rgba(245,158,11,0.16)]`;

const presetOptions = computed(() => [
  { value: ADVISOR_GOAL_PRESET_BALANCED, label: t("common:advisor.presetBalanced", "Balanced") },
  { value: ADVISOR_GOAL_PRESET_PROFIT, label: t("common:advisor.presetProfit", "Profit") },
  { value: ADVISOR_GOAL_PRESET_XP, label: t("common:advisor.presetXp", "XP") },
  { value: ADVISOR_GOAL_PRESET_SAFE, label: t("common:advisor.presetSafe", "Safe") },
  { value: ADVISOR_GOAL_PRESET_CUSTOM, label: t("common:advisor.presetCustom", "Custom") },
]);

const customInputFields = computed(() => [
  { key: "profitPerHour", label: t("common:advisor.dailyProfit", "Daily Profit") },
  { key: "xpPerHour", label: t("common:advisor.xpPerHour", "XP/h") },
]);

const summaryWeightFields = computed(() => [
  { key: "profitPerHour", label: t("common:advisor.dailyProfit", "Daily Profit") },
  { key: "xpPerHour", label: t("common:advisor.xpPerHour", "XP/h") },
  { key: "safety", label: t("common:advisor.safety", "Safety") },
]);

const filterDraft = reactive({
  includeSoloZones: false,
  includeGroupZones: true,
  refineTopEnabled: true,
  refineTopCount: 8,
  refineRounds: 10,
});

 const customWeightDraft = reactive({
   profitPerHour: 0.484615,
   xpPerHour: 0.415385,
   safety: 0.1,
 });

function roundTo(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Number(numeric.toFixed(digits));
}

function syncCustomWeightDraft(source) {
  const safeSource = source || {};
  customWeightDraft.profitPerHour = roundTo(safeSource.profitPerHour ?? customWeightDraft.profitPerHour, 2);
  customWeightDraft.xpPerHour = roundTo(safeSource.xpPerHour ?? customWeightDraft.xpPerHour, 2);
  const safetyValue = Number(safeSource.safety ?? customWeightDraft.safety ?? 0.1);
  customWeightDraft.safety = Number.isFinite(safetyValue) ? safetyValue : 0.1;
}

function syncFilterDraft(source) {
  const safeSource = source || {};
  filterDraft.includeSoloZones = Boolean(safeSource.includeSoloZones);
  filterDraft.includeGroupZones = safeSource.includeGroupZones !== false;
  filterDraft.refineTopEnabled = safeSource.refineTopEnabled !== false;
  filterDraft.refineTopCount = Number(safeSource.refineTopCount ?? filterDraft.refineTopCount);
  filterDraft.refineRounds = Number(safeSource.refineRounds ?? filterDraft.refineRounds);
}

 watch(
   () => simulator.advisor.filters,
   (value) => {
     syncFilterDraft(value);
   },
  { deep: true, immediate: true }
);

 watch(
   () => simulator.advisor.customWeights,
   (value) => {
     syncCustomWeightDraft(value);
   },
   { deep: true, immediate: true }
 );

const runtime = computed(() => simulator.advisor.runtime || {});
const isRunning = computed(() => Boolean(runtime.value?.isRunning));
const displayRows = computed(() => (
  Array.isArray(simulator.advisor.refinedRows) && simulator.advisor.refinedRows.length > 0
    ? simulator.advisor.refinedRows
    : (Array.isArray(simulator.advisor.quickRows) ? simulator.advisor.quickRows : [])
));
const maxAdvisorRowMetrics = computed(() => {
  const rows = displayRows.value;
  let maxProfitPerHour = null;
  let maxXpPerHour = null;
  let maxKillsPerHour = null;

  for (const row of rows) {
    const profitPerHour = Number(row?.profitPerHour);
    if (Number.isFinite(profitPerHour) && (maxProfitPerHour == null || profitPerHour > maxProfitPerHour)) {
      maxProfitPerHour = profitPerHour;
    }

    const xpPerHour = Number(row?.xpPerHour);
    if (Number.isFinite(xpPerHour) && (maxXpPerHour == null || xpPerHour > maxXpPerHour)) {
      maxXpPerHour = xpPerHour;
    }

    const killsPerHour = Number(row?.killsPerHour);
    if (Number.isFinite(killsPerHour) && (maxKillsPerHour == null || killsPerHour > maxKillsPerHour)) {
      maxKillsPerHour = killsPerHour;
    }
  }

  return {
    profitPerHour: maxProfitPerHour,
    xpPerHour: maxXpPerHour,
    killsPerHour: maxKillsPerHour,
  };
});
const topCardsWithRows = computed(() => {
  const rowById = new Map(displayRows.value.map((row) => [row.id, row]));
  return (simulator.advisor.topCards || []).map((card) => ({
    ...card,
    title: getTopCardTitle(card.titleKey),
    row: rowById.get(card.rowId) || null,
  }));
});
const progressPercent = computed(() => Math.round(Number(runtime.value?.progress || 0) * 100));
const progressText = computed(() => `${progressPercent.value}%`);
const pricingModeText = computed(() => {
  const consumable = String(simulator.pricing?.consumableMode || "ask").toUpperCase();
  const drops = String(simulator.pricing?.dropMode || "bid").toUpperCase();
  return `${t("common:advisor.pricing", "Pricing")}: ${consumable}/${drops}`;
});
const selectedPlayersLabel = computed(() => {
  const names = simulator.selectedPlayers.map((player) => player.name || `Player ${player.id}`);
  return `${t("common:advisor.players", "Players")}: ${names.join(", ") || t("common:advisor.none", "None")}`;
});
const metricPlayerLabel = computed(() => {
  const name = String(
    simulator.advisor.metricPlayerName
    || simulator.resolvedAdvisorMetricPlayer?.name
    || ""
  ).trim();
  return `${t("common:advisor.metricPlayer", "Metric Player")}: ${name || t("common:advisor.none", "None")}`;
});
const runtimeStatusText = computed(() => {
  if (isRunning.value) {
    return `${t("common:advisor.status", "Status")}: ${runtimePhaseText.value}`;
  }
  if (String(runtime.value?.phase || "idle") === "cancelled") {
    return `${t("common:advisor.status", "Status")}: ${runtimePhaseText.value}`;
  }
  if (runtime.value?.lastRunAt) {
    return `${t("common:advisor.lastRun", "Last Run")}: ${new Date(runtime.value.lastRunAt).toLocaleString()}`;
  }
  return `${t("common:advisor.status", "Status")}: ${t("common:advisor.idle", "Idle")}`;
});
const runtimePhaseText = computed(() => {
  const phase = String(runtime.value?.phase || "idle");
  if (phase === "quick_scan") {
    return t("common:advisor.phaseQuick", "Quick scan in progress") + ` · ${runtime.value.quickCompleted || 0}/${runtime.value.quickTotal || 0}`;
  }
  if (phase === "refine_top") {
    return t("common:advisor.phaseRefine", "Refining top picks") + ` · ${runtime.value.refineCompleted || 0}/${runtime.value.refineTotal || 0}`;
  }
  if (phase === "done") {
    return t("common:advisor.phaseDone", "Scan complete");
  }
  if (phase === "cancelled") {
    return t("common:advisor.phaseCancelled", "Scan stopped");
  }
  return t("common:advisor.idle", "Idle");
});
const customWeightSummaryText = computed(() => (
  `${t("common:advisor.normalizedWeights", "Normalized weights")}: `
  + summaryWeightFields.value.map((field) => `${field.label} ${formatMetric(simulator.advisor.customWeights?.[field.key], 2)}`).join(" · ")
));
const advisorErrorText = computed(() => {
  const raw = String(simulator.advisor.error || "").trim();
  if (!raw) {
    return "";
  }

  const knownMap = {
    "Another simulation is already running.": t("common:advisor.errorBusy", "Another simulation is already running."),
    "Please select at least one player.": t("common:advisor.errorNoPlayer", "Please select at least one player."),
    "Unable to build player simulation data.": t("common:advisor.errorBuildPlayer", "Unable to build player simulation data."),
    "No advisor targets available for the current filters.": t("common:advisor.errorNoTargets", "No advisor targets available for the current filters."),
    "Advisor scan did not produce any successful result.": t("common:advisor.errorNoSuccess", "Advisor scan did not produce any successful result."),
  };
  if (knownMap[raw]) {
    return knownMap[raw];
  }

  const quickMatch = raw.match(/^(\d+) target\(s\) failed during quick scan\. Showing successful results only\.$/);
  if (quickMatch) {
    return t("common:advisor.errorPartialQuick", "{{count}} target(s) failed during quick scan. Showing successful results only.", {
      count: Number(quickMatch[1] || 0),
    });
  }

  const refineMatch = raw.match(/^(\d+) target\(s\) failed during refine step\. Showing successful results only\.$/);
  if (refineMatch) {
    return t("common:advisor.errorPartialRefine", "{{count}} target(s) failed during refine step. Showing successful results only.", {
      count: Number(refineMatch[1] || 0),
    });
  }

  return raw;
});

const tableSummaryText = computed(() => {
  const rows = displayRows.value;
  if (rows.length === 0) {
    return t("common:advisor.tableEmpty", "No ranked rows yet.");
  }
  const refinedCount = rows.filter((row) => row.isRefined).length;
  return t("common:advisor.tableSummary", "{rows} rows ranked, {refined} validated by refine step.", {
    rows: rows.length,
    refined: refinedCount,
  });
});

function getTopCardTitle(titleKey) {
  const titleMap = {
    best_overall: t("common:advisor.bestOverall", "Best Overall"),
    best_profit: t("common:advisor.bestProfit", "Best Profit"),
    best_xp: t("common:advisor.bestXp", "Best XP"),
    safest: t("common:advisor.safest", "Safest"),
  };
  return titleMap[titleKey] || titleKey;
}

function getTargetLabel(row) {
  const hrid = String(row?.targetHrid || "");
  const fallback = String(row?.targetName || hrid || "-");
  if (!hrid) {
    return fallback;
  }
  const defaultLabel = String(actionDetailMap?.[hrid]?.name || fallback);
  return t(`actionNames.${hrid}`, defaultLabel);
}

function getContentTypeLabel(row) {
  const category = String(row?.category || row?.targetType || "zone");
  if (category === "solo_zone") {
    return t("common:advisor.soloZone", "Solo Zone");
  }
  if (category === "group_zone") {
    return t("common:advisor.groupZone", "Group Zone");
  }
  return t("common:advisor.soloZone", "Solo Zone");
}

function getDifficultyLabel(row) {
  return t("common:advisor.difficultyTier", "Tier {level}", { level: row?.difficultyTier ?? 0 });
}

function getReasonLabel(reason) {
  const reasonMap = {
    top_profit: t("common:advisor.reasonTopProfit", "Top Profit"),
    top_xp: t("common:advisor.reasonTopXp", "Top XP"),
    safest: t("common:advisor.reasonSafest", "Safest"),
    top_pick: t("common:advisor.reasonTopPick", "Top Pick"),
    validated: t("common:advisor.reasonValidated", "Validated"),
  };
  return reasonMap[reason] || reason;
}

function formatMetric(value, digits = 0) {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits > 0 ? Math.min(digits, 1) : 0,
  }).format(numeric);
}

function setPreset(preset) {
  applyStatus.value = "";
  simulator.rerankAdvisorResults({
    goalPreset: preset,
    customWeights: preset === ADVISOR_GOAL_PRESET_CUSTOM ? customWeightDraft : simulator.advisor.customWeights,
  });
}

 function applyCustomWeights() {
   customWeightDraft.profitPerHour = Math.max(0, roundTo(customWeightDraft.profitPerHour, 2));
   customWeightDraft.xpPerHour = Math.max(0, roundTo(customWeightDraft.xpPerHour, 2));
   simulator.rerankAdvisorResults({
     goalPreset: ADVISOR_GOAL_PRESET_CUSTOM,
     customWeights: customWeightDraft,
   });
   syncCustomWeightDraft(simulator.advisor.customWeights);
 }

 async function runAdvisor() {
   applyStatus.value = "";
   simulator.advisor.filters = { ...filterDraft };
   await simulator.runAdvisorScan();
   syncFilterDraft(simulator.advisor.filters);
   syncCustomWeightDraft(simulator.advisor.customWeights);
 }

function stopAdvisor() {
  applyStatus.value = "";
  simulator.stopAdvisorScan();
}

function applyToHome(row) {
  applyStatus.value = "";
  if (!simulator.applyAdvisorTarget(row)) {
    return;
  }
  applyStatus.value = t("common:advisor.applyStatus", "Applied to Home. Redirecting...");
  setTimeout(() => {
    router.push("/home");
  }, 180);
}
</script>

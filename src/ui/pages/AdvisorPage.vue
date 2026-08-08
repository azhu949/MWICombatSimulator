<template>
  <section class="space-y-4">
    <div class="grid grid-cols-1 gap-4">
      <div class="surface-panel overflow-hidden">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div class="space-y-2">
            <p class="text-xs uppercase  text-primary">{{ t("common:advisor.eyebrow", "Advisor") }}</p>
            <h2 class="font-heading text-2xl font-semibold text-foreground">{{ t("common:advisor.title", "刷图推荐器") }}</h2>
            <p class="max-w-3xl text-sm leading-6 text-foreground/85">
              {{ t("common:advisor.desc", "Use your current team, buffs, achievements, housing, pricing, and run duration to rank the best farming targets across solo zones and group zones.") }}
            </p>
            <DisclosurePanel :title="t('common:advisor.scoreExplainTitle', '评分说明：综合分与置信度怎么算')" class="max-w-3xl">
              <div class="space-y-3 text-xs leading-6 text-foreground/85">
                <div>
                  <p class="font-semibold text-foreground">{{ t("common:advisor.scoreExplainCompositeHeading", "综合分怎么算？") }}</p>
                  <ul class="mt-1 list-disc space-y-1 pl-5">
                    <li>{{ t("common:advisor.scoreExplainComposite1", "按 4 个维度评估每个目标：每日收益、每小时经验、每小时击杀、每小时死亡（安全性）。") }}</li>
                    <li>{{ t("common:advisor.scoreExplainComposite2", "每个维度先与所有候选目标横向对比，给出 0–100 的相对得分。") }}</li>
                    <li>{{ t("common:advisor.scoreExplainComposite3", "再按你选择的目标偏好（均衡 / 收益优先 / 经验优先 / 自定义权重）加权汇总成“基础分”。") }}</li>
                    <li>{{ t("common:advisor.scoreExplainComposite4", "最终综合分 = 基础分 × (0.85 + 0.15 × 置信度)。") }}</li>
                  </ul>
                </div>
                <div>
                  <p class="font-semibold text-foreground">{{ t("common:advisor.scoreExplainConfidenceHeading", "置信度怎么算？") }}</p>
                  <ul class="mt-1 list-disc space-y-1 pl-5">
                    <li>{{ t("common:advisor.scoreExplainConfidence1", "反映“多次扫描结果是否一致”——多次跑出来的数据越接近，置信度越高。") }}</li>
                    <li>{{ t("common:advisor.scoreExplainConfidence2", "样本数量：扫描轮数越多越高，复核 10–20 轮即可接近上限。") }}</li>
                    <li>{{ t("common:advisor.scoreExplainConfidence3", "轮间波动：每轮收益、经验、死亡数据差距越小越高。") }}</li>
                    <li>{{ t("common:advisor.scoreExplainConfidence4", "置信度对最终分影响较小（仅约 15%），即便置信度为 0，最终分仍保留基础分的 85%。") }}</li>
                  </ul>
                </div>
              </div>
            </DisclosurePanel>
            <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span class="rounded-md border border-border bg-muted/40 px-2.5 py-1">{{ selectedPlayersLabel }}</span>
              <span class="rounded-md border border-border bg-muted/40 px-2.5 py-1">{{ metricPlayerLabel }}</span>
              <span class="rounded-md border border-border bg-muted/40 px-2.5 py-1">{{ runtimeStatusText }}</span>
              <span class="rounded-md border border-border bg-muted/40 px-2.5 py-1">{{ pricingModeText }}</span>
            </div>
          </div>

          <div class="flex w-full flex-col gap-3 lg:w-[280px]">
            <button
              type="button"
              class="button-primary w-full justify-center"
              :disabled="isRunning"
              @click="runAdvisor"
            >
              {{ isRunning ? t("common:advisor.running", "Scanning...") : t("common:advisor.run", "Run Advisor") }}
            </button>
            <button
              type="button"
              class="button-danger w-full justify-center"
              :disabled="!isRunning"
              @click="stopAdvisor"
            >
              {{ t("common:advisor.stop", "Stop Advisor") }}
            </button>
            <div class="rounded-md border border-primary/40 bg-primary/10 p-3 text-xs text-foreground/85">
              <div class="flex items-center justify-between gap-2">
                <span class="uppercase  text-primary">{{ t("common:advisor.progress", "Progress") }}</span>
                <span>{{ progressText }}</span>
              </div>
              <Progress class="mt-2" :value="progressPercent" />
              <p class="mt-2 text-[11px] text-muted-foreground">{{ runtimePhaseText }}</p>
            </div>
          </div>
        </div>

        <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div class="space-y-3 rounded-md border border-border bg-muted/40 p-4">
            <div class="flex flex-wrap items-center gap-2">
              <span class="control-label mb-0">{{ t("common:advisor.goal", "Goal") }}</span>
              <button
                v-for="preset in presetOptions"
                :key="preset.value"
                type="button"
                :class="[
                  'rounded-md border px-3 py-1.5 text-xs transition',
                  simulator.advisor.goalPreset === preset.value
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border bg-muted/40 text-foreground/85 hover:border-primary/40 hover:text-primary',
                ]"
                @click="setPreset(preset.value)"
              >
                {{ preset.label }}
              </button>
            </div>

            <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
              <label v-for="weight in customInputFields" :key="weight.key" class="block">
                <span class="control-label">{{ weight.label }}</span>
                <input
                  :value="weightInputValue(weight.key)"
                  type="number"
                  min="0"
                  step="0.01"
                  class="control-input"
                  :disabled="!isCustomGoal"
                  @input="(event) => onCustomWeightInput(weight.key, event)"
                  @change="onCustomWeightChange"
                />
              </label>
            </div>
            <p class="text-xs text-muted-foreground">
              {{ customWeightSummaryText }}
            </p>
          </div>

          <div class="space-y-3 rounded-md border border-border bg-muted/40 p-4">
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-foreground">
                <input v-model="filterDraft.includeSoloZones" type="checkbox" class="accent-primary" />
                <span>{{ t("common:advisor.includeSolo", "Solo zones") }}</span>
              </label>
              <label class="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-foreground">
                <input v-model="filterDraft.includeGroupZones" type="checkbox" class="accent-primary" />
                <span>{{ t("common:advisor.includeGroup", "Group zones") }}</span>
              </label>
              <label class="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-foreground">
                <input v-model="filterDraft.refineTopEnabled" type="checkbox" class="accent-primary" />
                <span>{{ t("common:advisor.refineTop", "Refine Top 8") }}</span>
              </label>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <label for="advisor-refine-count" class="control-label">{{ t("common:advisor.refineCount", "Refine Count") }}</label>
                <NumberField id="advisor-refine-count" v-model="filterDraft.refineTopCount" :min="1" :max="32" />
              </div>
              <div>
                <label for="advisor-refine-rounds" class="control-label">{{ t("common:advisor.refineRounds", "Refine Rounds") }}</label>
                <NumberField id="advisor-refine-rounds" v-model="filterDraft.refineRounds" :min="1" :max="30" />
              </div>
              <div>
                <label for="advisor-quick-rounds" class="control-label">{{ t("common:advisor.quickRounds", "Quick Rounds") }}</label>
                <NumberField id="advisor-quick-rounds" v-model="filterDraft.quickRounds" :min="1" :max="10" />
              </div>
            </div>
          </div>
        </div>

        <div v-if="applyStatus || simulator.advisor.error" class="mt-4 space-y-2">
          <p v-if="applyStatus" class="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
            {{ applyStatus }}
          </p>
          <p v-if="simulator.advisor.error" class="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-primary">
            {{ advisorErrorText }}
          </p>
        </div>
      </div>

      <aside class="surface-panel">
        <div v-if="topCardsWithRows.length === 0">
          <p class="text-sm text-muted-foreground">{{ t("common:advisor.noCards", "Run the advisor to generate quick picks and top cards.") }}</p>
        </div>

        <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <article
             v-for="card in topCardsWithRows"
             :key="card.key"
             class="rounded-md border border-border bg-primary/10 p-4 shadow-lg"
           >
             <div class="flex items-start justify-between gap-3">
               <div>
                 <p class="text-[11px] uppercase  text-primary">{{ card.title }}</p>
                 <h3 class="mt-1 font-heading text-lg text-foreground">{{ getTargetLabel(card.row || card) }}</h3>
                 <p class="mt-1 text-xs text-muted-foreground">{{ getContentTypeLabel(card.row || card) }} · {{ getDifficultyLabel(card.row || card) }}</p>
               </div>
              <span class="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary">
                {{ formatMetric(card.row?.finalScore ?? card.score, 1) }}
              </span>
            </div>
            <div v-if="card.row" class="mt-3 grid grid-cols-2 gap-2 text-xs text-foreground/85">
              <div class="rounded-md border border-border bg-muted/40 px-3 py-2">
                <p class="text-muted-foreground">{{ t("common:advisor.dailyProfit", "Daily Profit") }}</p>
                <p class="mt-1 text-sm text-foreground">{{ formatAdvisorDailyProfitValue(card.row.profitPerHour) }}</p>
              </div>
              <div class="rounded-md border border-border bg-muted/40 px-3 py-2">
                <p class="text-muted-foreground">{{ t("common:advisor.xpPerHour", "XP/h") }}</p>
                <p class="mt-1 text-sm text-foreground">{{ formatAdvisorCompactValue(card.row.xpPerHour) }}</p>
              </div>
            </div>
            <button
              v-if="card.row"
              type="button"
              class="button-secondary mt-3 w-full justify-center"
              @click="applyToHome(card.row)"
            >
              {{ t("common:advisor.applyToHome", "Apply to Home") }}
            </button>
          </article>
        </div>
      </aside>
    </div>

    <div v-if="displayRows.length === 0" class="surface-panel">
      <p class="text-sm text-muted-foreground">{{ t("common:advisor.noResults", "No advisor results yet. Click 'Run Advisor' to scan current farming targets.") }}</p>
    </div>

    <div v-else class="surface-panel overflow-x-auto">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 class="font-heading text-base font-semibold text-primary">{{ t("common:advisor.tableTitle", "Recommended Targets") }}</h3>
          <p class="text-xs text-muted-foreground">{{ tableSummaryText }}</p>
        </div>
        <span class="rounded-md border border-border bg-muted/40 px-3 py-1 text-xs text-foreground/85">
          {{ t("common:advisor.rowCount", "Rows") }}: {{ displayRows.length }}
        </span>
      </div>

      <Table class="min-w-[1280px] w-full text-sm">
        <TableHeader>
          <TableRow class="border-b border-border text-left text-xs uppercase  text-muted-foreground">
            <TableHead class="px-2 py-3">#</TableHead>
            <TableHead class="px-2 py-3">{{ t("common:advisor.contentType", "Type") }}</TableHead>
            <TableHead class="px-2 py-3">{{ t("common:advisor.target", "Target") }}</TableHead>
            <TableHead class="px-2 py-3">{{ t("common:advisor.difficulty", "Difficulty") }}</TableHead>
            <TableHead class="px-2 py-3">{{ t("common:advisor.dailyProfit", "Daily Profit") }}</TableHead>
            <TableHead class="px-2 py-3">{{ t("common:advisor.xpPerHour", "XP/h") }}</TableHead>
            <TableHead class="px-2 py-3">{{ t("common:advisor.killsPerHour", "Kills/h") }}</TableHead>
            <TableHead class="px-2 py-3">{{ t("common:advisor.deathsPerHour", "Deaths/h") }}</TableHead>
            <TableHead class="px-2 py-3">{{ t("common:advisor.score", "Score") }}</TableHead>
            <TableHead class="px-2 py-3">{{ t("common:advisor.reason", "Reasons") }}</TableHead>
            <TableHead class="px-2 py-3"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="row in displayRows"
            :key="row.id"
            :class="[
              'border-b border-border align-top transition-colors',
              row.rank <= 3 ? 'bg-primary/10' : 'hover:bg-muted/40',
            ]"
          >
            <TableCell class="px-2 py-3 font-medium text-foreground">{{ row.rank }}</TableCell>
            <TableCell class="px-2 py-3 text-foreground/85">{{ getContentTypeLabel(row) }}</TableCell>
            <TableCell class="px-2 py-3">
              <div class="font-medium text-foreground">{{ getTargetLabel(row) }}</div>
            </TableCell>
            <TableCell class="px-2 py-3 text-foreground/85">{{ getDifficultyLabel(row) }}</TableCell>
            <TableCell class="px-2 py-3 text-foreground">
              <span :class="Number(row.profitPerHour) === maxAdvisorRowMetrics.profitPerHour ? maxMetricValueClass : metricValueClass">
                {{ formatAdvisorDailyProfitValue(row.profitPerHour) }}
              </span>
            </TableCell>
            <TableCell class="px-2 py-3 text-foreground">
              <span :class="Number(row.xpPerHour) === maxAdvisorRowMetrics.xpPerHour ? maxMetricValueClass : metricValueClass">
                {{ formatAdvisorCompactValue(row.xpPerHour) }}
              </span>
            </TableCell>
            <TableCell class="px-2 py-3 text-foreground">
              <span :class="Number(row.killsPerHour) === maxAdvisorRowMetrics.killsPerHour ? maxMetricValueClass : metricValueClass">
                {{ formatMetric(row.killsPerHour, 1) }}
              </span>
            </TableCell>
            <TableCell class="px-2 py-3 text-foreground">{{ formatMetric(row.deathsPerHour, 2) }}</TableCell>
            <TableCell class="px-2 py-3">
              <div class="flex flex-wrap items-center gap-2">
                <span class="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary">
                  {{ formatMetric(row.finalScore, 1) }}
                </span>
                <span v-if="row.isRefined" class="rounded-md border border-success/40 bg-success/10 px-2.5 py-1 text-[11px] text-success">
                  {{ t("common:advisor.confidence", "Confidence") }} {{ formatMetric(row.confidenceScore, 0) }}%
                </span>
                <span v-else class="rounded-md border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-foreground/85">
                  {{ t("common:advisor.quick", "Quick") }}
                </span>
              </div>
              <p class="mt-1 text-[11px] text-muted-foreground">
                {{ row.isRefined ? t("common:advisor.refinedRounds", "Refined {done}/{total} rounds", { done: row.successfulRounds, total: row.refineRounds }) : t("common:advisor.singlePass", "Single quick pass") }}
              </p>
            </TableCell>
            <TableCell class="px-2 py-3">
              <div class="flex max-w-[240px] flex-wrap gap-1.5">
                <span
                  v-for="reason in row.reasons"
                  :key="reason"
                  class="rounded-md border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-foreground"
                >
                  {{ getReasonLabel(reason) }}
                </span>
              </div>
            </TableCell>
            <TableCell class="px-2 py-3 text-right">
              <button type="button" class="button-secondary" @click="applyToHome(row)">
                {{ t("common:advisor.applyToHome", "Apply to Home") }}
              </button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
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
  resolveAdvisorWeights,
} from "../../services/advisorScoring.js";
import { useGameDataText } from "../composables/useGameDataText.js";
import { useI18nText } from "../composables/useI18nText.js";
import DisclosurePanel from "../components/DisclosurePanel.vue";
import { NumberField } from "../components/ui/number-field/index.js";
import { Progress } from "../components/ui/progress/index.js";

 const simulator = useSimulatorStore();
 const router = useRouter();
 const { t } = useI18nText();
 const { getActionName } = useGameDataText();
 const applyStatus = ref("");

const metricValueClass = "inline-flex items-center rounded-md border border-transparent px-2.5 py-1 tabular-nums";

const maxMetricValueClass = `${metricValueClass} border-primary/40 bg-primary/10 font-semibold text-primary shadow-sm`;

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

const isCustomGoal = computed(() => simulator.advisor.goalPreset === ADVISOR_GOAL_PRESET_CUSTOM);

const resolvedDisplayWeights = computed(() => (
  resolveAdvisorWeights(simulator.advisor.goalPreset, simulator.advisor.customWeights)
));

function weightInputValue(key) {
  if (isCustomGoal.value) {
    return customWeightDraft[key] ?? 0;
  }
  return roundTo(resolvedDisplayWeights.value[key] ?? 0, 2);
}

function onCustomWeightInput(key, event) {
  if (!isCustomGoal.value) {
    return;
  }
  const value = Number(event.target?.value);
  customWeightDraft[key] = Number.isFinite(value) ? value : 0;
}

function onCustomWeightChange() {
  if (isCustomGoal.value) {
    applyCustomWeights();
  }
}

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
  refineRounds: 20,
  quickRounds: 3,
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
  filterDraft.quickRounds = Number(safeSource.quickRounds ?? filterDraft.quickRounds);
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
  + summaryWeightFields.value.map((field) => `${field.label} ${formatMetric(resolvedDisplayWeights.value[field.key], 2)}`).join(" · ")
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
  return getActionName(hrid, defaultLabel);
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

<template>
  <section class="space-y-4">
    <div class="panel">
      <h2 class="font-heading text-lg font-semibold text-amber-200">{{ t("common:multiRound.summaryTitle", "Multi-round Summary") }}</h2>
      <p class="mt-2 text-sm text-slate-300">{{ t("common:vue.queue.activePlayer", "Active player", { name: simulator.activePlayer.name }) }}</p>

      <div class="mt-3 grid gap-3 border-t border-white/10 pt-3 text-xs text-slate-300 md:grid-cols-2">
        <div class="rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <p class="uppercase tracking-[0.14em] text-slate-400">{{ t("common:multiRound.scoreModel", "Score Model") }}</p>
          <div class="mt-2 space-y-1">
            <p>{{ t("common:multiRound.scoreModelValue", "Performance/Stability/Cost weighted by configured settings (quantile mapped to 5-95, with confidence penalty)") }}</p>
            <p>{{ t("common:multiRound.scoreModelWeightsValue", "Score weights", queueRuntimeWeightText) }}</p>
            <p>{{ t("common:multiRound.scoreModelParamPerformance", "Performance: DPS, No RNG Profit/day, XP/h and Kills/h gains are rank-mapped within the batch to 5-95. Higher is better.") }}</p>
            <p>{{ t("common:multiRound.scoreModelParamStability", "Stability: the average CV across the four metrics is rank-mapped within the batch to 5-95. Lower volatility scores higher.") }}</p>
            <p>{{ t("common:multiRound.scoreModelParamCost", "Cost: upgrade cost, purchase time and gold per 0.01% gain are each mapped to 5-95 (cost metrics use log scaling first). Lower cost scores higher.") }}</p>
            <p>{{ t("common:multiRound.scoreModelParamRobustWinsorize", "Robust winsorize setting", { winsorPct: 5 }) }}</p>
            <p>{{ t("common:multiRound.scoreModelParamRobustMedianBlend", "Robust median blend setting", { meanWeight: 50, medianWeight: 50 }) }}</p>
            <p>{{ t("common:multiRound.scoreModelParamRobustConfidencePenalty", "Robust confidence penalty setting", {
              baseWeight: 65,
              penaltyWeight: 35,
            }) }}</p>
          </div>
        </div>
        <div class="rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <p class="uppercase tracking-[0.14em] text-slate-400">{{ t("common:queue.baselineSummary", "Baseline Summary") }}</p>
          <div v-if="baselineSummaryRows.length > 0" class="mt-2 space-y-1">
            <p v-for="row in baselineSummaryRows" :key="row.key">
              <span class="text-slate-400">{{ row.label }}:</span> {{ row.value }}
            </p>
          </div>
          <p v-else class="mt-2 text-slate-400">
            {{ t("common:queue.emptyBaseline", "No baseline yet. Click 'Set Baseline' to run and lock one.") }}
          </p>
        </div>
      </div>
    </div>

    <div v-if="!hasMultiData" class="panel">
      <p class="text-sm text-slate-400">{{ t("common:multiRound.noData", "No multi-round results yet.") }}</p>
    </div>

    <template v-else>
      <div class="grid gap-3 sm:grid-cols-4">
        <div class="panel">
          <p class="text-xs uppercase tracking-[0.14em] text-slate-400">{{ t("common:queue.roundCount", "Rounds") }}</p>
          <p class="mt-1 font-heading text-lg text-slate-100">{{ queueState.settings?.rounds ?? 0 }}</p>
        </div>
        <div class="panel">
          <p class="text-xs uppercase tracking-[0.14em] text-slate-400">{{ t("common:queue.queueList", "Queue List") }}</p>
          <p class="mt-1 font-heading text-lg text-slate-100">{{ queueState.items?.length ?? 0 }}</p>
        </div>
        <div class="panel">
          <p class="text-xs uppercase tracking-[0.14em] text-slate-400">{{ t("common:multiRound.simCount", "Sim Count") }}</p>
          <p class="mt-1 font-heading text-lg text-slate-100">{{ completedSimCountText }}</p>
        </div>
        <div class="panel">
          <p class="text-xs uppercase tracking-[0.14em] text-slate-400">{{ t("common:vue.queue.lastRun", "Last Run") }}</p>
          <p class="mt-1 font-heading text-lg text-slate-100">{{ lastRunText }}</p>
        </div>
      </div>

      <div class="panel overflow-x-auto">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 class="font-heading text-sm uppercase tracking-[0.14em] text-slate-300">{{ t("common:multiRound.rankingTitle", "Scored Ranking") }}</h3>
          <button type="button"
            class="action-button-muted"
           
            :disabled="rankingRowsForDisplay.length === 0 || isExportingRankingExcel"
            @click="exportRankingRowsExcel"
          >
            {{ t("common:exportToExcel", "Export To Excel") }}
          </button>
        </div>
        <table class="min-w-[1700px] w-max text-sm">
          <thead>
            <tr class="border-b border-white/10 text-left text-xs uppercase tracking-[0.14em] text-slate-400">
              <th class="px-2 py-2">{{ t("common:multiRound.rank", "Rank") }}</th>
              <th class="px-2 py-2">{{ t("common:vue.queue.variant", "Variant") }}</th>
              <th class="px-2 py-2">{{ t("common:multiRound.simCount", "Sim Count") }}</th>
              <th class="px-2 py-2">{{ t("common:multiRound.finalScore", "Final Score") }}</th>
              <th class="px-2 py-2">{{ t("common:multiRound.performanceScore", "Performance Score") }}</th>
              <th class="px-2 py-2">{{ t("common:multiRound.stabilityScore", "Stability Score") }}</th>
              <th class="px-2 py-2">{{ t("common:multiRound.costScore", "Cost Score") }}</th>
              <th class="px-2 py-2">{{ t("common:vue.queue.meanProfitPerHour", "Mean Profit/h") }}</th>
              <th class="px-2 py-2">{{ t("common:vue.queue.deltaProfitPerHour", "Delta Profit/h") }}</th>
              <th class="px-2 py-2">{{ t("common:multiRound.deltaProfitPct", "Profit Delta%") }}</th>
              <th class="px-2 py-2">{{ t("common:multiRound.deltaDpsPct", "DPS Delta%") }}</th>
              <th class="px-2 py-2">{{ t("common:multiRound.deltaXpPct", "XP Delta%") }}</th>
              <th class="px-2 py-2">{{ t("common:multiRound.deltaKillsPct", "Kills Delta%") }}</th>
              <th class="px-2 py-2">{{ t("common:equipment.upgradeCost", "Upgrade Cost") }}</th>
              <th class="px-2 py-2">{{ t("common:queue.purchaseTime", "Purchase Time") }}</th>
              <th class="px-2 py-2">{{ t("common:multiRound.avgCostPerPoint01Pct", "Gold per 0.01% (avg)") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rankingRowsForDisplay"
              :key="row.id"
              class="border-b border-white/5 text-slate-200"
              :class="getRankRowClass(row)"
            >
              <td class="px-2 py-2 font-semibold">
                <span class="inline-flex min-w-12 items-center justify-center rounded-full border px-2 py-0.5 text-xs font-bold" :class="getRankBadgeClass(row.rank)">
                  #{{ row.rank }}
                </span>
              </td>
              <td class="px-2 py-2">
                <p>{{ formatQueueItemSummary(row) }}</p>
                <p v-if="getHiddenChangeCount(row) > 0" class="mt-0.5 text-xs text-slate-500">
                  +{{ getHiddenChangeCount(row) }}
                </p>
              </td>
              <td class="px-2 py-2">{{ formatRowSimCount(row) }}</td>
              <td class="px-2 py-2">{{ formatNumber(row.finalScore) }}</td>
              <td class="px-2 py-2">{{ formatNumber(row.performanceScore) }}</td>
              <td class="px-2 py-2">{{ formatNumber(row.stabilityScore) }}</td>
              <td class="px-2 py-2">{{ formatNumber(row.costScore) }}</td>
              <td class="px-2 py-2">{{ formatCompactCurrency(row.meanProfitPerHour) }}</td>
              <td class="px-2 py-2" :class="profitDeltaClass(row.deltaProfitPerHour)">{{ formatCurrency(row.deltaProfitPerHour) }}</td>
              <td class="px-2 py-2" :class="profitDeltaClass(row.deltaProfitPct)">{{ formatSignedPercent(row.deltaProfitPct) }}</td>
              <td class="px-2 py-2" :class="profitDeltaClass(row.deltaDpsPct)">{{ formatSignedPercent(row.deltaDpsPct) }}</td>
              <td class="px-2 py-2" :class="profitDeltaClass(row.deltaXpPct)">{{ formatSignedPercent(row.deltaXpPct) }}</td>
              <td class="px-2 py-2" :class="profitDeltaClass(row.deltaKillsPct)">{{ formatSignedPercent(row.deltaKillsPct) }}</td>
              <td class="px-2 py-2">{{ formatCompactCurrency(row.costInsights?.totalUpgradeCost) }}</td>
              <td class="px-2 py-2">{{ formatPurchaseDuration(row.costInsights?.purchaseDays) }}</td>
              <td class="px-2 py-2">{{ formatCompactCurrency(row.costInsights?.goldPerPoint01PctAvg) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <DisclosurePanel :title="t('common:multiRound.rawTitle', 'Raw Round Data')">
        <div class="overflow-x-auto">
          <table class="min-w-[1200px] w-max text-sm">
            <thead>
              <tr class="border-b border-white/10 text-left text-xs uppercase tracking-[0.14em] text-slate-400">
                <th class="px-2 py-2">{{ t("common:vue.queue.variant", "Variant") }}</th>
                <th class="px-2 py-2">{{ t("common:vue.queue.round", "Round") }}</th>
                <th class="px-2 py-2">{{ t("common:queue.metricDps", "DPS") }}</th>
                <th class="px-2 py-2">{{ t("common:multiRound.deltaDpsPct", "DPS Delta%") }}</th>
                <th class="px-2 py-2">{{ t("common:queue.dailyNoRngProfit", "Daily No RNG Profit") }}</th>
                <th class="px-2 py-2">{{ t("common:multiRound.deltaProfitPct", "Profit Delta%") }}</th>
                <th class="px-2 py-2">{{ t("common:vue.queue.xpPerHour", "XP/h") }}</th>
                <th class="px-2 py-2">{{ t("common:multiRound.deltaXpPct", "XP Delta%") }}</th>
                <th class="px-2 py-2">{{ t("common:simulationResults.killPerHour", "Kills/h") }}</th>
                <th class="px-2 py-2">{{ t("common:multiRound.deltaKillsPct", "Kills Delta%") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rawRowsForDisplay" :key="`${row.id}-${row.round}`" class="border-b border-white/5 text-slate-200">
                <td class="px-2 py-2">
                  <p>{{ formatQueueItemSummary(row) }}</p>
                  <p v-if="getHiddenChangeCount(row) > 0" class="mt-0.5 text-xs text-slate-500">
                    +{{ getHiddenChangeCount(row) }}
                  </p>
                </td>
                <td class="px-2 py-2">{{ row.round }}</td>
                <td class="px-2 py-2">{{ formatNumber(row.metrics?.dps) }}</td>
                <td class="px-2 py-2" :class="profitDeltaClass(row.deltas?.dps?.pct)">{{ formatSignedPercent(row.deltas?.dps?.pct) }}</td>
                <td class="px-2 py-2">{{ formatCurrency(row.metrics?.dailyNoRngProfit) }}</td>
                <td class="px-2 py-2" :class="profitDeltaClass(row.deltas?.dailyNoRngProfit?.pct)">{{ formatSignedPercent(row.deltas?.dailyNoRngProfit?.pct) }}</td>
                <td class="px-2 py-2">{{ formatNumber(row.metrics?.xpPerHour) }}</td>
                <td class="px-2 py-2" :class="profitDeltaClass(row.deltas?.xpPerHour?.pct)">{{ formatSignedPercent(row.deltas?.xpPerHour?.pct) }}</td>
                <td class="px-2 py-2">{{ formatNumber(row.metrics?.killsPerHour) }}</td>
                <td class="px-2 py-2" :class="profitDeltaClass(row.deltas?.killsPerHour?.pct)">{{ formatSignedPercent(row.deltas?.killsPerHour?.pct) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </DisclosurePanel>
    </template>
  </section>
</template>

<script setup>
import { computed, ref } from "vue";
import DisclosurePanel from "../components/DisclosurePanel.vue";
import abilityDetailMap from "../../combatsimulator/data/abilityDetailMap.json";
import itemDetailMap from "../../combatsimulator/data/itemDetailMap.json";
import { useSimulatorStore } from "../../stores/simulatorStore.js";
import { useI18nText } from "../composables/useI18nText.js";

const simulator = useSimulatorStore();
const { t, language } = useI18nText();
const ABILITY_BOOK_CATEGORY_HRID = "/item_categories/ability_book";
const ONE_HOUR = 60 * 60 * 1e9;
const RANKING_ROWS_LIMIT = 300;
const RAW_ROWS_LIMIT = 800;
const SLOT_I18N_KEY_MAP = {
  head: "characterItemsUtil.head",
  body: "characterItemsUtil.body",
  legs: "characterItemsUtil.legs",
  feet: "characterItemsUtil.feet",
  hands: "characterItemsUtil.hands",
  off_hand: "characterItemsUtil.offHand",
  pouch: "characterItemsUtil.pouch",
  neck: "characterItemsUtil.neck",
  earrings: "characterItemsUtil.earrings",
  ring: "characterItemsUtil.ring",
  back: "characterItemsUtil.back",
  charm: "characterItemsUtil.charm",
  main_hand: "characterItemsUtil.mainHand",
  two_hand: "characterItemsUtil.mainHand",
  weapon: "characterItemsUtil.mainHand",
};

const queueState = computed(() => simulator.activeQueueState);
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
const queueRoundCount = computed(() => Math.max(0, Math.floor(Number(queueState.value?.settings?.rounds || 0))));
const totalRunCount = computed(() => {
  const queueSize = Math.max(0, Number(queueState.value?.items?.length || 0));
  return Math.max(0, queueRoundCount.value * queueSize);
});
const rawRunCount = computed(() => Math.max(0, Number(queueState.value?.rawRuns?.length || 0)));
const completedSimCountText = computed(() => `${rawRunCount.value}/${totalRunCount.value}`);
const queueRuntimeWeightText = computed(() => {
  const finalWeights = simulator.queueRuntime?.finalWeights || {};
  const toPct = (value, fallback) => Number((Number(value ?? fallback) * 100).toFixed(2));
  return {
    performance: toPct(finalWeights.performance, 0.4),
    stability: toPct(finalWeights.stability, 0.2),
    cost: toPct(finalWeights.cost, 0.4),
  };
});
const actionNameFallbackMap = computed(() => {
  const map = {};
  const actionOptions = [
    ...(simulator.options?.zones || []),
    ...(simulator.options?.dungeons || []),
  ];
  for (const option of actionOptions) {
    const hrid = String(option?.hrid || "");
    if (!hrid || Object.prototype.hasOwnProperty.call(map, hrid)) {
      continue;
    }
    map[hrid] = String(option?.name || "");
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
      key: "zone",
      label: t("common:queue.settingZone", "Zone"),
      value: resolveBaselineZoneName(baseline),
    },
    {
      key: "difficulty",
      label: t("common:queue.settingDifficulty", "Difficulty"),
      value: resolveBaselineDifficultyText(baseline),
    },
    {
      key: "duration",
      label: t("common:queue.settingDuration", "Duration"),
      value: resolveBaselineDurationText(baseline),
    },
    {
      key: "dps",
      label: t("common:queue.metricDps", "DPS"),
      value: formatNumber(metrics?.dps),
    },
    {
      key: "dailyNoRngProfit",
      label: t("common:queue.dailyNoRngProfit", "Daily No RNG Profit"),
      value: formatCurrency(metrics?.dailyNoRngProfit),
    },
    {
      key: "xpPerHour",
      label: t("common:vue.queue.xpPerHour", "XP/h"),
      value: formatNumber(metrics?.xpPerHour),
    },
    {
      key: "killsPerHour",
      label: t("common:simulationResults.killPerHour", "Kills/h"),
      value: formatNumber(metrics?.killsPerHour),
    },
  ];
});
const queueChangeInlineSeparator = computed(() => (language.value === "zh" ? "、" : ", "));

const abilityBookInfoByAbilityHrid = (() => {
  const result = {};
  for (const item of Object.values(itemDetailMap || {})) {
    if (item?.categoryHrid !== ABILITY_BOOK_CATEGORY_HRID) {
      continue;
    }
    const abilityHrid = String(item?.abilityBookDetail?.abilityHrid || "");
    if (!abilityHrid) {
      continue;
    }
    const xpPerBook = Number(item?.abilityBookDetail?.experienceGain || 0);
    if (!Number.isFinite(xpPerBook) || xpPerBook <= 0) {
      continue;
    }
    if (!result[abilityHrid] || xpPerBook > Number(result[abilityHrid]?.xpPerBook || 0)) {
      result[abilityHrid] = {
        itemHrid: String(item?.hrid || ""),
        xpPerBook,
      };
    }
  }
  return result;
})();

const lastRunText = computed(() => {
  const timestamp = Number(queueState.value?.lastRunAt || 0);
  if (!timestamp) {
    return t("common:vue.queue.never", "Never");
  }
  return new Date(timestamp).toLocaleString();
});

function formatNumber(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatCurrency(value) {
  if (value == null || !Number.isFinite(Number(value))) {
    return "-";
  }
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
}

function formatCompactCurrency(value, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) {
    return "-";
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

function formatSignedPercent(value) {
  if (value == null || !Number.isFinite(Number(value))) {
    return "-";
  }
  const numeric = Number(value || 0);
  const prefix = numeric > 0 ? "+" : "";
  return `${prefix}${numeric.toFixed(2)}%`;
}

function formatPurchaseDuration(daysValue) {
  const numeric = Number(daysValue);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "-";
  }
  if (numeric < 1) {
    return `${(numeric * 24).toFixed(1)}h`;
  }
  return `${numeric.toFixed(1)}d`;
}

function formatActionName(actionHrid, fallbackName = "-") {
  const hrid = String(actionHrid || "");
  if (!hrid) {
    return fallbackName || "-";
  }

  const translationKey = `translation:actionNames.${hrid}`;
  const fromTranslation = t(translationKey, translationKey);
  if (fromTranslation !== translationKey) {
    return fromTranslation;
  }

  const commonKey = `actionNames.${hrid}`;
  const fromCommon = t(commonKey, commonKey);
  if (fromCommon !== commonKey) {
    return fromCommon;
  }

  return fallbackName || hrid;
}

function resolveBaselineZoneName(baseline) {
  const configuredHrid = String(baseline?.settings?.zoneHrid || "");
  if (configuredHrid) {
    return formatActionName(configuredHrid, actionNameFallbackMap.value?.[configuredHrid] || configuredHrid);
  }

  const resultZone = String(baseline?.simResult?.zoneHrid || baseline?.simResult?.zoneName || "");
  if (!resultZone) {
    return "-";
  }
  if (resultZone.startsWith("/actions/")) {
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
  return "-";
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

  return "-";
}

function resolveItemName(itemHrid) {
  const hrid = String(itemHrid || "");
  if (!hrid) {
    return "";
  }
  return t(`itemNames.${hrid}`, itemDetailMap?.[hrid]?.name || hrid);
}

function resolveAbilityName(abilityHrid) {
  const hrid = String(abilityHrid || "");
  if (!hrid) {
    return "";
  }
  return t(`abilityNames.${hrid}`, abilityDetailMap?.[hrid]?.name || hrid);
}

function formatSkillName(skillKey) {
  const normalized = String(skillKey || "").toLowerCase();
  if (!normalized) {
    return "";
  }
  return t(`skillNames./skills/${normalized}`, normalized);
}

function localizeEquipmentSlotLabel(slotKey) {
  const normalized = String(slotKey || "");
  const i18nKey = SLOT_I18N_KEY_MAP[normalized];
  if (!i18nKey) {
    return normalized;
  }
  const translated = t(i18nKey, i18nKey);
  return translated === i18nKey ? normalized : translated;
}

function getAbilityXpForLevel(level) {
  const xpLevels = Array.isArray(window?.jigsAbilityXpLevels) ? window.jigsAbilityXpLevels : null;
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
  const normalizedHrid = String(abilityHrid || "");
  if (!normalizedHrid) {
    return 0;
  }

  const directBookInfo = abilityBookInfoByAbilityHrid?.[normalizedHrid];
  if (directBookInfo?.xpPerBook > 0) {
    return directBookInfo.xpPerBook;
  }

  const abilityName = String(abilityDetailMap?.[normalizedHrid]?.name || "");
  if (!abilityName) {
    return 0;
  }

  const spellBookXpMap = window?.jigsSpellBookXpByName;
  if (!spellBookXpMap || typeof spellBookXpMap !== "object") {
    return 0;
  }

  const matchedKey = Object.keys(spellBookXpMap).find((key) => String(key).toLowerCase() === abilityName.toLowerCase());
  const xpPerBook = matchedKey ? Number(spellBookXpMap[matchedKey]) : 0;
  return Number.isFinite(xpPerBook) && xpPerBook > 0 ? xpPerBook : 0;
}

function computeAbilityBooksNeededForRange(abilityHrid, fromLevel, toLevel) {
  const safeHrid = String(abilityHrid || "");
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
  const kind = String(change?.kind || "");

  if (kind === "ability") {
    const beforeHrid = String(change?.beforeAbilityHrid || "");
    const afterHrid = String(change?.afterAbilityHrid || "");
    const beforeLevel = Number(change?.beforeLevel || 1);
    const afterLevel = Number(change?.afterLevel || 1);
    if (beforeHrid && afterHrid && beforeHrid === afterHrid && Number.isFinite(beforeLevel) && Number.isFinite(afterLevel)) {
      const abilityName = resolveAbilityName(afterHrid);
      const books = computeAbilityBooksNeededForRange(afterHrid, beforeLevel, afterLevel);
      if (books != null) {
        return t("common:queue.skillLevelChangeWithBooks", "{{name}}: Level {{from}} -> {{to}} ({{books}} books)", {
          name: abilityName,
          from: beforeLevel,
          to: afterLevel,
          books,
        });
      }
      return t("common:queue.skillLevelChange", "{{name}}: Level {{from}} -> {{to}}", {
        name: abilityName,
        from: beforeLevel,
        to: afterLevel,
      });
    }
  }

  if (kind === "equipment") {
    const beforeItemHrid = String(change?.beforeItemHrid || "");
    const afterItemHrid = String(change?.afterItemHrid || "");
    const beforeLevel = Math.max(0, Math.floor(Number(change?.beforeEnhancementLevel || 0)));
    const afterLevel = Math.max(0, Math.floor(Number(change?.afterEnhancementLevel || 0)));

    if (beforeItemHrid && afterItemHrid && beforeItemHrid === afterItemHrid) {
      return t("common:queue.itemEnhancementChange", "{{name}}: Enhance {{from}} -> {{to}}", {
        name: resolveItemName(beforeItemHrid),
        from: beforeLevel,
        to: afterLevel,
      });
    }
  }

  if (kind === "level") {
    const before = Number(change?.beforeLevel);
    const after = Number(change?.afterLevel);
    return t("common:queue.skillLevelChange", "{{name}}: Level {{from}} -> {{to}}", {
      name: formatSkillName(change?.key),
      from: Number.isFinite(before) ? before : 1,
      to: Number.isFinite(after) ? after : 1,
    });
  }

  if (kind === "food" || kind === "drink") {
    const slotIndex = Number(change?.index) + 1;
    const slotLabel = kind === "food"
      ? t("common:queue.foodSlot", "Food Slot {{index}}", { index: Number.isFinite(slotIndex) ? slotIndex : 1 })
      : t("common:queue.drinkSlot", "Drink Slot {{index}}", { index: Number.isFinite(slotIndex) ? slotIndex : 1 });
    const beforeText = resolveItemName(change?.beforeItemHrid) || "-";
    const afterText = resolveItemName(change?.afterItemHrid) || "-";
    return `${slotLabel}: ${beforeText} -> ${afterText}`;
  }

  if (kind === "equipment") {
    const slotLabel = localizeEquipmentSlotLabel(change?.slot);
    const beforeText = change?.beforeItemHrid
      ? `${resolveItemName(change.beforeItemHrid)}(+${Math.max(0, Math.floor(Number(change?.beforeEnhancementLevel || 0)))})`
      : "-";
    const afterText = change?.afterItemHrid
      ? `${resolveItemName(change.afterItemHrid)}(+${Math.max(0, Math.floor(Number(change?.afterEnhancementLevel || 0)))})`
      : "-";
    return slotLabel ? `${slotLabel}: ${beforeText} -> ${afterText}` : `${beforeText} -> ${afterText}`;
  }

  if (kind === "ability") {
    const slotIndex = Number(change?.index) + 1;
    const slotLabel = t("common:queue.abilitySlot", "Ability Slot {{index}}", { index: Number.isFinite(slotIndex) ? slotIndex : 1 });
    const beforeLevel = Math.max(1, Math.floor(Number(change?.beforeLevel || 1)));
    const afterLevel = Math.max(1, Math.floor(Number(change?.afterLevel || 1)));
    const beforeText = change?.beforeAbilityHrid ? `${resolveAbilityName(change.beforeAbilityHrid)}(Lv.${beforeLevel})` : "-";
    const afterText = change?.afterAbilityHrid ? `${resolveAbilityName(change.afterAbilityHrid)}(Lv.${afterLevel})` : "-";
    return `${slotLabel}: ${beforeText} -> ${afterText}`;
  }

  return "";
}

function humanizeLegacyChangeLine(rawLine) {
  let line = String(rawLine || "").trim();
  if (!line) {
    return "";
  }
  line = line.replace(/\/items\/[a-z0-9_]+/gi, (hrid) => resolveItemName(hrid));
  line = line.replace(/\/abilities\/[a-z0-9_]+/gi, (hrid) => resolveAbilityName(hrid));
  return line;
}

function collectQueueChangeLines(row) {
  const changeDetails = Array.isArray(row?.changeDetails) ? row.changeDetails : [];
  if (changeDetails.length > 0) {
    return changeDetails
      .map((change) => formatQueueChangeDetailLine(change))
      .filter(Boolean);
  }
  return (Array.isArray(row?.changes) ? row.changes : [])
    .map((line) => humanizeLegacyChangeLine(line))
    .filter(Boolean);
}

function formatQueueItemSummary(row, limit = 2) {
  const lines = collectQueueChangeLines(row);
  const safeLimit = Math.max(0, Math.floor(Number(limit || 0)));
  if (lines.length === 0) {
    return String(row?.label || "-");
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
    return String(row?.label || "-");
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
    return "bg-amber-300/10";
  }
  if (rank === 2) {
    return "bg-slate-200/10";
  }
  if (rank === 3) {
    return "bg-orange-400/10";
  }
  if (rank === 4) {
    return "bg-emerald-400/10";
  }
  if (rank === 5) {
    return "bg-sky-400/10";
  }
  return "";
}

function getRankBadgeClass(rankValue) {
  const rank = Math.max(0, Math.floor(Number(rankValue || 0)));
  if (rank === 1) {
    return "border-amber-300/80 bg-amber-300/20 text-amber-100";
  }
  if (rank === 2) {
    return "border-slate-200/70 bg-slate-200/15 text-slate-100";
  }
  if (rank === 3) {
    return "border-orange-300/70 bg-orange-300/15 text-orange-100";
  }
  if (rank === 4) {
    return "border-emerald-300/70 bg-emerald-300/15 text-emerald-100";
  }
  if (rank === 5) {
    return "border-sky-300/70 bg-sky-300/15 text-sky-100";
  }
  return "border-white/15 bg-white/5 text-slate-200";
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
  return numeric > 0 ? "FF10B981" : "FFF43F5E";
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
    const { Workbook } = await import("exceljs");
    const workbook = new Workbook();
    workbook.creator = "MWI Combat Simulator";
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet("Ranking", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    worksheet.columns = [
      { header: t("common:multiRound.rank", "Rank"), key: "rank", width: 8 },
      { header: t("common:vue.queue.variant", "Variant"), key: "variant", width: 56 },
      { header: t("common:multiRound.simCount", "Sim Count"), key: "simCount", width: 12 },
      { header: t("common:multiRound.finalScore", "Final Score"), key: "finalScore", width: 12 },
      { header: t("common:multiRound.performanceScore", "Performance Score"), key: "performanceScore", width: 16 },
      { header: t("common:multiRound.stabilityScore", "Stability Score"), key: "stabilityScore", width: 14 },
      { header: t("common:multiRound.costScore", "Cost Score"), key: "costScore", width: 12 },
      { header: t("common:vue.queue.meanProfitPerHour", "Mean Profit/h"), key: "meanProfitPerHour", width: 14 },
      { header: t("common:vue.queue.deltaProfitPerHour", "Delta Profit/h"), key: "deltaProfitPerHour", width: 14 },
      { header: t("common:multiRound.deltaProfitPct", "Profit Delta%"), key: "deltaProfitPct", width: 12 },
      { header: t("common:multiRound.deltaDpsPct", "DPS Delta%"), key: "deltaDpsPct", width: 10 },
      { header: t("common:multiRound.deltaXpPct", "XP Delta%"), key: "deltaXpPct", width: 10 },
      { header: t("common:multiRound.deltaKillsPct", "Kills Delta%"), key: "deltaKillsPct", width: 12 },
      { header: t("common:equipment.upgradeCost", "Upgrade Cost"), key: "upgradeCost", width: 14 },
      { header: t("common:queue.purchaseTime", "Purchase Time"), key: "purchaseTime", width: 14 },
      { header: t("common:multiRound.avgCostPerPoint01Pct", "Gold per 0.01% (avg)"), key: "goldPerPoint01PctAvg", width: 20 },
    ];

    const bodyRows = rows.map((row) => ({
      rank: toFiniteForExport(row?.rank, 0),
      variant: formatQueueItemSummaryForExport(row),
      simCount: `${Math.max(0, Math.floor(Number(row?.rounds || 0)))}/${queueRoundCount.value}`,
      finalScore: toFiniteForExport(row?.finalScore, 2),
      performanceScore: toFiniteForExport(row?.performanceScore, 2),
      stabilityScore: toFiniteForExport(row?.stabilityScore, 2),
      costScore: toFiniteForExport(row?.costScore, 2),
      meanProfitPerHour: formatCompactCurrency(row?.meanProfitPerHour),
      deltaProfitPerHour: formatCompactCurrency(row?.deltaProfitPerHour),
      deltaProfitPct: toFiniteForExport(row?.deltaProfitPct, 2),
      deltaDpsPct: toFiniteForExport(row?.deltaDpsPct, 2),
      deltaXpPct: toFiniteForExport(row?.deltaXpPct, 2),
      deltaKillsPct: toFiniteForExport(row?.deltaKillsPct, 2),
      upgradeCost: formatCompactCurrency(row?.costInsights?.totalUpgradeCost),
      purchaseTime: formatPurchaseDuration(row?.costInsights?.purchaseDays),
      goldPerPoint01PctAvg: formatCompactCurrency(row?.costInsights?.goldPerPoint01PctAvg),
    }));
    worksheet.addRows(bodyRows);

    const headerRow = worksheet.getRow(1);
    headerRow.height = 24;
    headerRow.font = {
      bold: true,
      color: { argb: "FFFFFFFF" },
      size: 11,
    };
    headerRow.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF334155" },
    };

    const thinBorder = {
      top: { style: "thin", color: { argb: "FF334155" } },
      left: { style: "thin", color: { argb: "FF334155" } },
      bottom: { style: "thin", color: { argb: "FF334155" } },
      right: { style: "thin", color: { argb: "FF334155" } },
    };
    worksheet.eachRow({ includeEmpty: false }, (excelRow, rowNumber) => {
      excelRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = thinBorder;
      });
      if (rowNumber > 1 && rowNumber % 2 === 0) {
        excelRow.eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF8FAFC" },
          };
        });
      }
    });

    const centerKeys = ["rank", "simCount", "purchaseTime"];
    const rightKeys = [
      "finalScore",
      "performanceScore",
      "stabilityScore",
      "costScore",
      "meanProfitPerHour",
      "deltaProfitPerHour",
      "deltaProfitPct",
      "deltaDpsPct",
      "deltaXpPct",
      "deltaKillsPct",
      "upgradeCost",
      "goldPerPoint01PctAvg",
    ];
    for (const key of centerKeys) {
      worksheet.getColumn(key).alignment = { horizontal: "center", vertical: "middle" };
    }
    worksheet.getColumn("variant").alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    for (const key of rightKeys) {
      worksheet.getColumn(key).alignment = { horizontal: "right", vertical: "middle" };
    }

    const percentKeys = ["deltaProfitPct", "deltaDpsPct", "deltaXpPct", "deltaKillsPct"];
    for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
      const sourceRow = rows[rowIndex - 2] || {};
      const excelRow = worksheet.getRow(rowIndex);
      for (const key of percentKeys) {
        const cell = excelRow.getCell(key);
        if (Number.isFinite(Number(cell.value))) {
          cell.numFmt = "0.00\"%\"";
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
    const blob = new Blob(
      [buffer],
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mwi-multi-ranking-${Date.now()}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Failed to export multi-round ranking to Excel:", error);
  } finally {
    isExportingRankingExcel.value = false;
  }
}

function profitDeltaClass(value) {
  const numeric = Number(value || 0);
  if (numeric > 0) {
    return "text-emerald-300";
  }
  if (numeric < 0) {
    return "text-rose-300";
  }
  return "text-slate-200";
}
</script>

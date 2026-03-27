<template>
  <section class="space-y-4">
    <div class="panel space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="font-heading text-lg font-semibold text-amber-200">{{ t("common:vue.queue.title", "Queue Runner") }}</h2>
          <p class="text-sm text-slate-300">{{ t("common:vue.queue.activePlayer", "Active player", { name: simulator.activePlayer.name }) }}</p>
          <p v-if="queuePartySummaryText" class="mt-1 text-xs text-slate-400">
            {{ t("common:queue.partyLockedMembers", "Locked party") }}:
            <span class="ml-1 text-slate-200">{{ queuePartySummaryText }}</span>
          </p>
        </div>
      </div>

      <div class="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-6">
        <div class="rounded-xl border border-white/10 bg-slate-900/50 p-3 md:col-span-2 xl:col-span-3">
          <p class="text-xs uppercase tracking-[0.14em] text-slate-400">{{ t("common:queue.baselineSummary", "Baseline Summary") }}</p>
          <div v-if="baselineSummaryRows.length > 0" class="mt-2 space-y-1 text-sm text-slate-100">
            <p v-for="row in baselineSummaryRows" :key="row.key">
              <span class="text-slate-400">{{ row.label }}:</span>
              <span class="ml-1">{{ row.value }}</span>
            </p>
          </div>
          <p v-else class="mt-1 text-sm text-slate-100">{{ t("common:queue.emptyBaseline", "No baseline yet. Click 'Set Baseline' to run and lock one.") }}</p>
          <p v-if="baselineNeedsResetPrompt" class="mt-2 text-xs text-amber-300">
            {{ t("common:queue.baselineNeedsResetAfterImport", "Queue changes were imported. Please click 'Set Baseline' again to refresh baseline metrics.") }}
          </p>
        </div>
        <div class="rounded-xl border border-white/10 bg-slate-900/50 p-3 xl:col-span-1">
          <p class="text-xs uppercase tracking-[0.14em] text-slate-400">{{ t("common:queue.queueList", "Queue List") }}</p>
          <p class="mt-2 text-2xl font-semibold text-slate-100">{{ queueState.items.length }}</p>
        </div>
        <div class="rounded-xl border border-white/10 bg-slate-900/50 p-3 xl:col-span-1">
          <p class="text-xs uppercase tracking-[0.14em] text-slate-400">{{ t("common:vue.queue.queueProgress", "Queue Progress") }}</p>
          <p class="mt-2 text-2xl font-semibold text-slate-100">{{ Math.floor((queueState.progress || 0) * 100) }}%</p>
        </div>
        <div class="rounded-xl border border-white/10 bg-slate-900/50 p-3 xl:col-span-1">
          <p class="text-xs uppercase tracking-[0.14em] text-slate-400">{{ t("common:vue.queue.lastRun", "Last Run") }}</p>
          <p class="mt-2 text-sm text-slate-100">{{ lastRunText }}</p>
        </div>
      </div>

      <div class="h-2 overflow-hidden rounded-full bg-slate-800">
        <div class="h-full bg-gradient-to-r from-teal-400 to-amber-300 transition-all" :style="{ width: `${Math.floor((queueState.progress || 0) * 100)}%` }"></div>
      </div>

      <p v-if="queueState.error" class="text-sm text-rose-300">{{ t(queueState.error, queueState.error) }}</p>
      <p v-if="queuePartyWarningText" class="text-sm text-amber-300">{{ queuePartyWarningText }}</p>
    </div>

    <div class="panel" v-if="queueState.baseline">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 class="font-heading text-base font-semibold text-amber-200">{{ t("common:queue.queueList", "Queue List") }}</h3>
      </div>

      <div v-if="queueDisplayItems.length === 0" class="rounded-xl border border-white/10 bg-slate-900/40 px-3 py-4 text-sm text-slate-400">
        {{ t("common:queue.emptyQueue", "No queue items. Change build settings and add to queue.") }}
      </div>

      <div v-else class="space-y-3">
        <article
          v-for="item in queueDisplayItems"
          :key="item.id"
          class="rounded-xl border border-white/10 bg-slate-900/40 p-3"
        >
          <div class="flex flex-wrap items-start gap-2">
            <div>
              <h4 class="font-heading text-base font-semibold text-slate-100">{{ item.displayName }}</h4>
              <p class="mt-1 text-xs text-slate-400">{{ t("common:vue.queue.changeCount", "Changes", { count: item.detailLines.length }) }}</p>
            </div>
          </div>

          <div v-if="item.categoryBadges.length > 0" class="mt-2 flex flex-wrap gap-2">
            <span
              v-for="badge in item.categoryBadges"
              :key="badge"
              class="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs text-slate-200"
            >
              {{ badge }}
            </span>
          </div>

          <div class="mt-3 space-y-1 text-sm text-slate-300">
            <p v-for="(line, index) in item.detailLines" :key="`${item.id}-${index}`">{{ line }}</p>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from "vue";
import {
  abilityDetailIndex as abilityDetailMap,
  houseRoomDetailIndex as houseRoomDetailMap,
  itemDetailIndex as itemDetailMap,
} from "../../shared/gameDataIndex.js";
import { EQUIPMENT_SLOT_KEYS, LEVEL_KEYS } from "../../shared/playerConfig.js";
import { useSimulatorStore } from "../../stores/simulatorStore.js";
import { useAbilityText } from "../composables/useAbilityText.js";
import { useI18nText } from "../composables/useI18nText.js";

const simulator = useSimulatorStore();
const { t } = useI18nText();
const { getAbilityName } = useAbilityText();
const ONE_HOUR = 60 * 60 * 1e9;
const ABILITY_BOOK_CATEGORY_HRID = "/item_categories/ability_book";
const TRIGGER_CHANGE_LABEL_PREFIX = "trigger:";
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
const CHANGE_CATEGORY_PRIORITY = {
  item: 0,
  house_room: 1,
  food: 2,
  drink: 3,
  skill: 4,
  trigger: 5,
  profession: 6,
};

const queueState = computed(() => simulator.activeQueueState);
const queuePartyStatus = computed(() => simulator.activeQueuePartyStatus || { hasMismatch: false, messageKey: "", memberNames: [] });
const queuePartySummaryText = computed(() => (
  Array.isArray(queuePartyStatus.value?.memberNames) && queuePartyStatus.value.memberNames.length > 0
    ? queuePartyStatus.value.memberNames.join(" / ")
    : ""
));
const queuePartyWarningText = computed(() => (
  queuePartyStatus.value?.hasMismatch
    ? t(queuePartyStatus.value?.messageKey || "common:queue.partyChangedSinceBaseline", queuePartyStatus.value?.messageKey || "common:queue.partyChangedSinceBaseline")
    : ""
));
const baselineNeedsResetPrompt = computed(() => {
  const baseline = queueState.value?.baseline;
  if (!baseline) {
    return false;
  }
  return !baseline.simResult;
});

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
    if (!result[abilityHrid] || xpPerBook > result[abilityHrid].xpPerBook) {
      result[abilityHrid] = {
        itemHrid: String(item?.hrid || ""),
        xpPerBook,
      };
    }
  }
  return result;
})();

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
  const baseline = queueState.value.baseline;
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
      value: formatMetricValue(metrics?.dps, 2),
    },
    {
      key: "dailyNoRngProfit",
      label: t("common:queue.dailyNoRngProfit", "Daily No RNG Profit"),
      value: formatQueueMetricValue("dailyNoRngProfit", metrics?.dailyNoRngProfit, 2),
    },
    {
      key: "xpPerHour",
      label: t("common:simulationResults.xpPerHour", "XP per hour"),
      value: formatQueueMetricValue("xpPerHour", metrics?.xpPerHour, 0),
    },
    {
      key: "killsPerHour",
      label: t("common:simulationResults.killPerHour", "Kills per hour"),
      value: formatMetricValue(metrics?.killsPerHour, 1),
    },
  ];
});

const queueDisplayItems = computed(() => {
  const baselineSnapshot = queueState.value.baseline?.snapshot;
  const queueItems = Array.isArray(queueState.value.items) ? queueState.value.items : [];
  if (!baselineSnapshot || queueItems.length === 0) {
    return [];
  }

  return queueItems.map((item, index) => {
    const changes = buildQueueChangesFromSnapshots(baselineSnapshot, item?.snapshot);
    const fallbackName = item?.name || `${t("common:queue.queueItem", "Queue Item")} ${index + 1}`;
    const displayName = deriveQueueItemDisplayNameFromChanges(changes, index + 1, fallbackName);
    const categoryBadges = Array.from(new Set(changes.map((change) => localizeQueueCategory(change.category))));
    const detailLines = changes.length > 0
      ? changes.map((change) => formatQueueChangeDetailLine(change))
      : (Array.isArray(item?.changes) ? item.changes.map((line) => String(line || "")) : []);

    return {
      id: item.id,
      displayName,
      categoryBadges,
      detailLines,
    };
  });
});

const lastRunText = computed(() => {
  if (queueState.value.lastRunStatus === "cancelled") {
    const partialCount = Array.isArray(queueState.value.ranking) ? queueState.value.ranking.length : 0;
    if (partialCount > 0) {
      return t("common:vue.queue.lastRunCancelledPartial", "Stopped with {{count}} partial result(s)", { count: partialCount });
    }
    return t("common:vue.queue.lastRunCancelled", "Stopped");
  }
  if (!queueState.value.lastRunAt) {
    return t("common:vue.queue.never", "Never");
  }
  return new Date(queueState.value.lastRunAt).toLocaleString();
});

function buildQueueChangesFromSnapshots(baselineSnapshot, targetSnapshot) {
  const baseline = baselineSnapshot || {};
  const target = targetSnapshot || {};
  const changes = [];

  for (const key of LEVEL_KEYS) {
    const beforeLevel = Number(baseline?.levels?.[key] ?? 1);
    const afterLevel = Number(target?.levels?.[key] ?? 1);
    if (beforeLevel !== afterLevel) {
      changes.push({
        category: "profession",
        label: key,
        before: { level: beforeLevel },
        after: { level: afterLevel },
      });
    }
  }

  for (const slot of EQUIPMENT_SLOT_KEYS) {
    const beforeEquipment = baseline?.equipment?.[slot] ?? { itemHrid: "", enhancementLevel: 0 };
    const afterEquipment = target?.equipment?.[slot] ?? { itemHrid: "", enhancementLevel: 0 };
    const beforeItemHrid = String(beforeEquipment?.itemHrid || "");
    const afterItemHrid = String(afterEquipment?.itemHrid || "");
    const beforeEnhancement = Math.max(0, Math.floor(Number(beforeEquipment?.enhancementLevel || 0)));
    const afterEnhancement = Math.max(0, Math.floor(Number(afterEquipment?.enhancementLevel || 0)));
    if (beforeItemHrid !== afterItemHrid || beforeEnhancement !== afterEnhancement) {
      changes.push({
        category: "item",
        label: slot,
        before: {
          itemHrid: beforeItemHrid,
          enhancementLevel: beforeEnhancement,
        },
        after: {
          itemHrid: afterItemHrid,
          enhancementLevel: afterEnhancement,
        },
      });
    }
  }

  for (let i = 0; i < 3; i += 1) {
    const beforeFood = String(baseline?.food?.[i] || "");
    const afterFood = String(target?.food?.[i] || "");
    if (beforeFood !== afterFood) {
      changes.push({
        category: "food",
        label: `food${i + 1}`,
        before: { itemHrid: beforeFood },
        after: { itemHrid: afterFood },
      });
    }

    const beforeDrink = String(baseline?.drinks?.[i] || "");
    const afterDrink = String(target?.drinks?.[i] || "");
    if (beforeDrink !== afterDrink) {
      changes.push({
        category: "drink",
        label: `drink${i + 1}`,
        before: { itemHrid: beforeDrink },
        after: { itemHrid: afterDrink },
      });
    }
  }

  for (let i = 0; i < 5; i += 1) {
    const beforeAbility = baseline?.abilities?.[i] ?? { abilityHrid: "", level: 1 };
    const afterAbility = target?.abilities?.[i] ?? { abilityHrid: "", level: 1 };
    const beforeHrid = String(beforeAbility?.abilityHrid || "");
    const afterHrid = String(afterAbility?.abilityHrid || "");
    const beforeLevel = Math.max(1, Math.floor(Number(beforeAbility?.level || 1)));
    const afterLevel = Math.max(1, Math.floor(Number(afterAbility?.level || 1)));
    if (beforeHrid !== afterHrid || beforeLevel !== afterLevel) {
      changes.push({
        category: "skill",
        label: `ability${i + 1}`,
        before: {
          abilityHrid: beforeHrid,
          level: beforeLevel,
        },
        after: {
          abilityHrid: afterHrid,
          level: afterLevel,
        },
      });
    }
  }

  for (const room of Object.values(houseRoomDetailMap || {})) {
    const roomHrid = String(room?.hrid || "");
    if (!roomHrid) {
      continue;
    }
    const beforeLevel = Math.max(0, Math.floor(Number(baseline?.houseRooms?.[roomHrid] ?? 0)));
    const afterLevel = Math.max(0, Math.floor(Number(target?.houseRooms?.[roomHrid] ?? 0)));
    if (beforeLevel !== afterLevel) {
      changes.push({
        category: "house_room",
        label: roomHrid,
        before: { level: beforeLevel },
        after: { level: afterLevel },
      });
    }
  }

  return changes;
}

function deriveQueueItemDisplayNameFromChanges(changes, fallbackIndex, fallbackText = "") {
  if (!Array.isArray(changes) || changes.length === 0) {
    return fallbackText || `${t("common:queue.queueItem", "Queue Item")} ${fallbackIndex}`;
  }

  const sorted = [...changes].sort((left, right) => {
    const leftPriority = CHANGE_CATEGORY_PRIORITY[left?.category] ?? 99;
    const rightPriority = CHANGE_CATEGORY_PRIORITY[right?.category] ?? 99;
    return leftPriority - rightPriority;
  });

  const candidates = sorted
    .map((change) => deriveSingleQueueChangeDisplayName(change))
    .filter((value) => String(value || "").trim().length > 0);
  const uniqueCandidates = Array.from(new Set(candidates));
  if (uniqueCandidates.length === 0) {
    return fallbackText || `${t("common:queue.queueItem", "Queue Item")} ${fallbackIndex}`;
  }
  if (uniqueCandidates.length === 1) {
    return uniqueCandidates[0];
  }
  return t("common:queue.itemNameWithMore", "{{name}} +{{count}}", {
    name: uniqueCandidates[0],
    count: uniqueCandidates.length - 1,
  });
}

function deriveSingleQueueChangeDisplayName(change) {
  if (!change) {
    return "";
  }

  if (change.category === "profession") {
    return localizeQueueChangeLabel(change);
  }

  if (change.category === "skill") {
    const beforeHrid = String(change?.before?.abilityHrid || "");
    const afterHrid = String(change?.after?.abilityHrid || "");
    const beforeLevel = Number(change?.before?.level || 1);
    const afterLevel = Number(change?.after?.level || 1);
    if (
      beforeHrid &&
      afterHrid &&
      beforeHrid === afterHrid &&
      Number.isFinite(beforeLevel) &&
      Number.isFinite(afterLevel)
    ) {
      const abilityName = localizeHridDisplayName(afterHrid);
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

  if (change.category === "item") {
    const beforeItemHrid = String(change?.before?.itemHrid || "");
    const afterItemHrid = String(change?.after?.itemHrid || "");
    const beforeLevel = Math.max(0, Math.floor(Number(change?.before?.enhancementLevel || 0)));
    const afterLevel = Math.max(0, Math.floor(Number(change?.after?.enhancementLevel || 0)));

    if (beforeItemHrid && afterItemHrid && beforeItemHrid === afterItemHrid) {
      return t("common:queue.itemEnhancementChange", "{{name}}: Enhance {{from}} -> {{to}}", {
        name: localizeHridDisplayName(beforeItemHrid),
        from: beforeLevel,
        to: afterLevel,
      });
    }
    if (beforeItemHrid && afterItemHrid) {
      return `${localizeHridDisplayName(beforeItemHrid)} -> ${localizeHridDisplayName(afterItemHrid)}(+${afterLevel})`;
    }
    if (afterItemHrid) {
      return `${localizeHridDisplayName(afterItemHrid)}(+${afterLevel})`;
    }
    if (beforeItemHrid) {
      return `${localizeHridDisplayName(beforeItemHrid)}(+${beforeLevel})`;
    }
  }

  const afterText = formatQueueChangeValue(change, "after");
  if (afterText && afterText !== "-") {
    return afterText;
  }
  const beforeText = formatQueueChangeValue(change, "before");
  if (beforeText && beforeText !== "-") {
    return beforeText;
  }
  return localizeQueueChangeLabel(change);
}

function formatQueueChangeDetailLine(change) {
  const label = localizeQueueChangeLabel(change);
  const beforeText = formatQueueChangeValue(change, "before");
  const afterText = formatQueueChangeValue(change, "after");
  return `${label}: ${beforeText} -> ${afterText}`;
}

function localizeQueueCategory(category) {
  const key = `common:queue.changeCategory.${category}`;
  return t(key, category || "-");
}

function localizeQueueChangeLabel(change) {
  const category = String(change?.category || "");
  const label = String(change?.label || "");
  if (category === "profession") {
    const skillKey = label.toLowerCase();
    return t(`skillNames./skills/${skillKey}`, label || skillKey);
  }
  if (category === "item") {
    return localizeEquipmentSlotLabel(label);
  }
  if (category === "food") {
    const index = Number(label.replace(/\D/g, "")) || 1;
    return t("common:queue.foodSlot", "Food Slot {{index}}", { index });
  }
  if (category === "drink") {
    const index = Number(label.replace(/\D/g, "")) || 1;
    return t("common:queue.drinkSlot", "Drink Slot {{index}}", { index });
  }
  if (category === "skill") {
    const index = Number(label.replace(/\D/g, "")) || 1;
    return t("common:queue.abilitySlot", "Ability Slot {{index}}", { index });
  }
  if (category === "house_room") {
    return t(`houseRoomNames.${label}`, houseRoomDetailMap?.[label]?.name || label || "House Room");
  }
  if (category === "trigger") {
    if (label.startsWith(TRIGGER_CHANGE_LABEL_PREFIX)) {
      const triggerHrid = label.substring(TRIGGER_CHANGE_LABEL_PREFIX.length);
      return `${t("common:queue.triggerLabel", "Trigger")} ${localizeHridDisplayName(triggerHrid)}`;
    }
    return t("common:queue.triggerLabel", "Trigger");
  }
  return label || "-";
}

function localizeEquipmentSlotLabel(slotKey) {
  const i18nKey = SLOT_I18N_KEY_MAP[String(slotKey || "")];
  if (!i18nKey) {
    return String(slotKey || "");
  }
  const translated = t(i18nKey, i18nKey);
  return translated === i18nKey ? String(slotKey || "") : translated;
}

function localizeHridDisplayName(hrid) {
  const value = String(hrid || "");
  if (!value) {
    return "-";
  }

  const fallback = itemDetailMap?.[value]?.name || actionNameFallbackMap.value?.[value] || value;

  const itemName = t(`itemNames.${value}`, `itemNames.${value}`);
  if (itemName !== `itemNames.${value}`) {
    return itemName;
  }

  const abilityName = getAbilityName(value, "");
  if (abilityName && abilityName !== value) {
    return abilityName;
  }

  const actionName = t(`actionNames.${value}`, `actionNames.${value}`);
  if (actionName !== `actionNames.${value}`) {
    return actionName;
  }

  return fallback;
}

function formatQueueChangeValue(change, side = "after") {
  const category = String(change?.category || "");
  const payload = side === "before" ? change?.before : change?.after;
  if (!payload) {
    return "-";
  }

  if (category === "profession") {
    const level = Number(payload?.level);
    return Number.isFinite(level) ? `${Math.floor(level)}` : "-";
  }

  if (category === "item") {
    const itemHrid = String(payload?.itemHrid || "");
    if (!itemHrid) {
      return "-";
    }
    const enhancementLevel = Math.max(0, Math.floor(Number(payload?.enhancementLevel || 0)));
    return `${localizeHridDisplayName(itemHrid)}(+${enhancementLevel})`;
  }

  if (category === "food" || category === "drink") {
    const itemHrid = String(payload?.itemHrid || "");
    return itemHrid ? localizeHridDisplayName(itemHrid) : "-";
  }

  if (category === "skill") {
    const abilityHrid = String(payload?.abilityHrid || "");
    if (!abilityHrid) {
      return "-";
    }
    const level = Math.max(1, Math.floor(Number(payload?.level || 1)));
    return `${localizeHridDisplayName(abilityHrid)}(Lv.${level})`;
  }

  if (category === "house_room") {
    const level = Math.max(0, Math.floor(Number(payload?.level || 0)));
    return `${level}`;
  }

  return "-";
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
  const bookInfo = abilityBookInfoByAbilityHrid?.[normalizedHrid];
  if (bookInfo?.xpPerBook > 0) {
    return bookInfo.xpPerBook;
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
  const safeAbilityHrid = String(abilityHrid || "");
  const safeFrom = Number(fromLevel);
  const safeTo = Number(toLevel);
  if (!safeAbilityHrid || !Number.isFinite(safeFrom) || !Number.isFinite(safeTo) || safeTo <= safeFrom) {
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

  const xpPerBook = getSpellBookXpForAbility(safeAbilityHrid);
  if (!xpPerBook) {
    return null;
  }

  const booksNeeded = Math.ceil(xpNeeded / xpPerBook);
  return Number.isFinite(booksNeeded) && booksNeeded >= 0 ? booksNeeded : null;
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

function formatMetricValue(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return numeric.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function formatCompactKmbValue(value, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }

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
  return formatMetricValue(numeric, digits);
}

function formatQueueMetricValue(metricKey, value, digits = 2) {
  if (metricKey === "dailyNoRngProfit" || metricKey === "xpPerHour") {
    return formatCompactKmbValue(value, 1);
  }
  return formatMetricValue(value, digits);
}

</script>

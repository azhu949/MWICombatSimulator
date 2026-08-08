<template>
  <SidebarProvider>
    <AppSidebar
      :version="appVersion"
      :has-unread-patch-notes="hasUnreadPatchNotes"
      :patch-notes-label="patchNotesButtonAriaLabel"
      @patch-notes="openPatchNotesModal"
      @feedback="openFeedbackModal"
    />

    <SidebarInset :style="{ '--app-sticky-shell-height': stickyShellHeight }">
      <header class="sticky top-0 z-40 border-b border-border bg-background/94 backdrop-blur supports-[backdrop-filter]:bg-background/84">
        <div class="mx-auto flex h-12 max-w-[1500px] items-center gap-2 px-3 sm:px-5">
          <SidebarTrigger class="md:hidden" mobile />
          <SidebarTrigger class="hidden md:inline-flex" />
          <div class="mx-1 h-4 w-px bg-border" aria-hidden="true" />
          <h1 class="min-w-0 flex-1 truncate font-heading text-sm font-semibold text-foreground">{{ currentPageTitle }}</h1>
          <Button type="button" variant="ghost" size="icon-sm" :aria-label="themeToggleAriaLabel" :title="themeToggleAriaLabel" @click="toggleTheme">
            <Sun v-if="theme === 'dark'" />
            <Moon v-else />
          </Button>
          <Button type="button" variant="ghost" size="sm" :aria-label="languageToggleAriaLabel" :title="languageToggleAriaLabel" @click="switchLanguage(languageToggleTarget)">
            <Languages />{{ languageToggleLabel }}
          </Button>
        </div>
      </header>

      <CombatCommandBar
        v-if="showCombatToolbar"
        :players="simulator.players"
        :active-player-id="simulator.activePlayerId"
        :queue-actions-disabled="queueActionsDisabled"
        :has-baseline="activeQueueHasBaseline"
        :party-mismatch="activeQueuePartyMismatch"
        :item-count="activeQueueItemCount"
        :queue-progress-text="activeQueueProgressText"
        :party-summary-text="activeQueuePartySummaryText"
        :party-warning-text="activeQueuePartyWarningText"
        :action-status-text="topQueueActionStatusText"
        :action-status-class="topQueueActionStatusClass"
        :show-simulation-actions="showHomeSimulationActions"
        :simulation-running="simulator.runtime.isRunning"
        :simulation-actions-disabled="queueActionsDisabled"
        :show-runtime-summary="showRuntimeSummary"
        :runtime-progress="simulator.runtime.progress"
        :runtime-error="simulator.runtime.error"
        :progress-label="progressLabel"
        @set-baseline="setQueueBaselineFromTopbar"
        @add-queue="addToQueueFromTopbar"
        @run-queue="runQueueFromTopbar"
        @clear-queue="clearQueueFromTopbar"
        @select-player="simulator.setActivePlayer"
        @start-simulation="simulator.startSimulation()"
        @stop-simulation="simulator.stopSimulation()"
        @height-change="setCombatCommandBarHeight"
        @view-error="openGlobalError('runtime', $event)"
      />

      <main class="mx-auto w-full max-w-[1500px] px-3 py-4 sm:px-5 sm:py-5">
        <RouterView />
      </main>
    </SidebarInset>

    <BaseModal :open="globalErrorModalOpen" :title="t('common:vue.app.globalErrorTitle', 'Error')" @close="globalErrorModalOpen = false">
      <p class="text-sm text-foreground/85">{{ t("common:vue.app.globalErrorDesc", "Please copy the following details if you report this issue.") }}</p>
      <pre class="max-h-[320px] overflow-auto rounded-md border border-border bg-muted/50 p-3 text-xs text-destructive">{{ globalErrorText }}</pre>
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="button-primary" @click="copyGlobalError">
          {{ t("common:vue.common.copy", "Copy") }}
        </button>
        <span class="text-xs text-muted-foreground">{{ errorCopyStatus }}</span>
      </div>
    </BaseModal>

    <BaseModal
      :open="feedbackModalOpen"
      :title="t('common:vue.app.feedback', 'Feedback')"
      initial-focus-selector="[data-feedback-copy]"
      @close="closeFeedbackModal"
    >
      <div class="space-y-3">
        <p class="text-sm text-foreground/85">
          {{ t("common:vue.app.feedbackHint", "Use the following channels for feedback, bug reports, or suggestions.") }}
        </p>

        <div class="feedback-contact-list">
          <div class="feedback-contact-row">
            <div class="min-w-0">
              <p class="feedback-contact-label">{{ t("common:vue.app.feedbackQqLabel", "QQ Group") }}</p>
              <p class="feedback-contact-value">993488247</p>
            </div>
            <button type="button" class="button-secondary text-xs" data-feedback-copy @click="copyFeedbackContact('993488247')">
              {{ t("common:vue.common.copy", "Copy") }}
            </button>
          </div>

          <div class="feedback-contact-row">
            <div class="min-w-0">
              <p class="feedback-contact-label">{{ t("common:vue.app.feedbackEmailLabel", "QQ Email") }}</p>
              <a class="feedback-contact-link" href="mailto:596846069@qq.com">596846069@qq.com</a>
            </div>
            <button type="button" class="button-secondary text-xs" @click="copyFeedbackContact('596846069@qq.com')">
              {{ t("common:vue.common.copy", "Copy") }}
            </button>
          </div>
        </div>

        <p class="text-xs text-muted-foreground">{{ feedbackCopyStatus }}</p>
      </div>
    </BaseModal>

    <BaseModal
      :open="patchNotesModalOpen"
      :title="t('common:patchNotes', 'Patch Notes')"
      panel-class="max-w-[96vw] xl:max-w-[1100px]"
      initial-focus-selector="[data-patch-notes-start]"
      @close="closePatchNotesModal"
    >
      <div class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{{ t("common:vue.settings.versionsCount", "Versions", { count: patchNotesEntries.length }) }}</span>
          <span v-if="hasUnreadPatchNotes">
            {{ t("common:vue.app.patchNotesUnreadStatus", "Unread updates", { count: patchNotesUnreadCount }) }}
          </span>
        </div>

        <p class="text-xs text-muted-foreground">
          {{ t("common:vue.app.patchNotesMarkReadHint", "Unread patch notes will be marked as read when you close this dialog.") }}
        </p>

        <div
          v-if="patchNotesEntries.length > 0"
          class="max-h-[65vh] space-y-2 overflow-y-auto pr-1 outline-none"
          data-patch-notes-start
          tabindex="-1"
        >
          <DisclosurePanel
            v-for="entry in patchNotesEntries"
            :key="entry.entryId"
            :title="entry.label"
            :default-open="entry.entryId === patchNotesDefaultOpenEntryId"
          >
            <ul class="list-disc space-y-1 pl-5 text-sm text-foreground">
              <li v-for="note in entry.notes" :key="note">{{ note }}</li>
            </ul>
          </DisclosurePanel>
        </div>

        <p v-else class="text-sm text-foreground/85" data-patch-notes-start tabindex="-1">
          {{ t("common:vue.app.patchNotesEmpty", "No patch notes yet.") }}
        </p>
      </div>
    </BaseModal>

    <BaseModal
      :open="simulationCompleteModalOpen"
      :title="t('common:vue.app.simulationCompleteTitle', 'Simulation completed')"
      initial-focus-selector="[data-simulation-results-confirm]"
      @close="closeSimulationCompleteModal"
    >
      <p class="text-sm text-foreground/85">{{ t("common:vue.app.simulationCompleteDesc", "Simulation completed. Go to Home results now?") }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="button-primary"
          data-simulation-results-confirm
          @click="goToHomeResults"
        >
          {{ t("common:vue.app.goToHomeResults", "Go to Home Results") }}
        </button>
        <button type="button" class="button-secondary" @click="closeSimulationCompleteModal">
          {{ t("common:vue.app.stayHere", "Stay Here") }}
        </button>
      </div>
    </BaseModal>

    <BaseModal
      :open="baselineReminderModalOpen"
      :title="t('common:queue.baselineReminderTitle', 'Baseline Rounds Reminder')"
      initial-focus-selector="[data-baseline-reminder-acknowledge]"
      @close="closeBaselineReminderModal"
    >
      <div class="space-y-3">
        <p class="text-sm text-foreground/85">
          {{ t("common:queue.baselineReminderBody", "Fewer baseline rounds can make the result more volatile. Adjust the setting first if you want a more stable baseline.") }}
        </p>
        <p class="text-sm text-primary">
          {{ baselineReminderCurrentRoundsText }}
        </p>
        <p class="text-xs text-primary">
          {{ t("common:queue.baselineRecommendationHint", "Recommended: at least 10 rounds, with 20-30 as the usual stable range; use 50+ when comparing very close options.") }}
        </p>
        <p class="text-xs text-muted-foreground">
          {{ t("common:queue.baselineReminderAggregationHint", "Set Baseline runs multiple rounds using the current baseline round count and uses the aggregated result as the queue comparison baseline.") }}
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="button-primary"
            data-baseline-reminder-acknowledge
            @click="acknowledgeBaselineReminderAndRun"
          >
            {{ t("common:queue.baselineReminderAcknowledge", "I understand, don't show again") }}
          </button>
          <button type="button" class="button-secondary" @click="openBaselineReminderSettings">
            {{ t("common:queue.baselineReminderGoToSettings", "Go to Settings") }}
          </button>
        </div>
      </div>
    </BaseModal>

    <BaseModal
      :open="queueCompleteModalOpen"
      :title="t('common:queue.queueRunning', 'Running queue...')"
      initial-focus-selector="[data-multi-results-confirm]"
      @close="closeQueueCompleteModal"
    >
      <p class="text-sm text-foreground/85">{{ t("common:vue.app.queueCompleteDesc", "Queue run started. Go to the Multi-round page now?") }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="button-primary"
          data-multi-results-confirm
          @click="goToMultiResults"
        >
          {{ t("common:vue.app.goToMultiResults", "Go to Multi-round") }}
        </button>
        <button type="button" class="button-secondary" @click="closeQueueCompleteModal">
          {{ t("common:vue.app.stayHere", "Stay Here") }}
        </button>
      </div>
    </BaseModal>
  </SidebarProvider>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import { Languages, Moon, Sun } from "@lucide/vue";
import {
  houseRoomDetailIndex as houseRoomDetailMap,
  itemDetailIndex as itemDetailMap,
} from "../shared/gameDataIndex.js";
import BaseModal from "./components/BaseModal.vue";
import AppSidebar from "./components/AppSidebar.vue";
import CombatCommandBar from "./components/CombatCommandBar.vue";
import DisclosurePanel from "./components/DisclosurePanel.vue";
import { Button } from "./components/ui/button/index.js";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "./components/ui/sidebar/index.js";
import { useSimulatorStore } from "../stores/simulatorStore.js";
import { useGameDataText } from "./composables/useGameDataText.js";
import { useI18nText } from "./composables/useI18nText.js";
import { useTheme } from "./composables/useTheme.js";
import {
  getUnreadPatchNoteEntries,
  initializePatchNotesState,
  markPatchNoteEntriesAsRead,
  resolvePatchNoteEntries,
} from "./patchNotes.js";
import {
  dismissBaselineReminder,
  isBaselineReminderDismissed,
} from "./baselineReminder.js";
import { deriveQueueItemStatusName } from "./queueItemStatusPresentation.js";

const appVersion = __APP_VERSION__;
const simulator = useSimulatorStore();
const router = useRouter();
const route = useRoute();
const { theme, toggleTheme } = useTheme();
let deferredInitHandle = null;
const globalErrorModalOpen = ref(false);
const globalErrorText = ref("");
const errorCopyStatus = ref("");
const feedbackModalOpen = ref(false);
const feedbackCopyStatus = ref("");
const simulationCompleteModalOpen = ref(false);
const queueCompleteModalOpen = ref(false);
const baselineReminderModalOpen = ref(false);
const baselineReminderDismissed = ref(isBaselineReminderDismissed());
const patchNotesModalOpen = ref(false);
const patchNotesUnreadEntries = ref([]);
const topQueueActionStatus = ref({
  tone: "secondary",
  text: "",
});
const { language, setLanguage, t } = useI18nText();
const {
  getAbilityName,
  getActionName,
  getHouseRoomName,
  getItemName,
  getSkillName,
} = useGameDataText();
const showCombatToolbar = computed(() => route.meta?.showCombatToolbar !== false);
const showHomeSimulationActions = computed(() => route.name === "home");
const combatCommandBarHeight = ref(0);
const stickyShellHeight = computed(() => `${48 + (showCombatToolbar.value ? combatCommandBarHeight.value : 0)}px`);
const currentPageTitle = computed(() => t(
  route.meta?.navLabelKey || "common:title",
  route.meta?.navLabel || "MWI Combat Simulator",
));

function setCombatCommandBarHeight(height) {
  const numericHeight = Number(height);
  combatCommandBarHeight.value = Number.isFinite(numericHeight) ? Math.max(0, numericHeight) : 0;
}

const progressLabel = computed(() => {
  const progress = Math.floor(simulator.runtime.progress * 100);
  const elapsed = simulator.runtime.elapsedSeconds.toFixed(1);
  return `${progress}% | ${elapsed}s`;
});

const themeToggleAriaLabel = computed(() => (
  theme.value === "dark"
    ? t("common:vue.app.switchToLightTheme", "Switch to light mode")
    : t("common:vue.app.switchToDarkTheme", "Switch to dark mode")
));
const languageToggleTarget = computed(() => (
  language.value === "zh" ? "en" : "zh"
));
const languageToggleLabel = computed(() => (
  language.value === "zh" ? "EN" : "中文"
));
const languageToggleAriaLabel = computed(() => (
  language.value === "zh"
    ? t("common:vue.app.switchToEnglish", "Switch to English")
    : t("common:vue.app.switchToChinese", "Switch to Chinese")
));

const activeQueueState = computed(() => simulator.activeQueueState || null);
const activeQueuePartyStatus = computed(() => simulator.activeQueuePartyStatus || { hasMismatch: false, messageKey: "", memberNames: [] });
const activeQueuePartyMismatch = computed(() => Boolean(activeQueuePartyStatus.value?.hasMismatch));
const activeQueuePartySummaryText = computed(() => (
  Array.isArray(activeQueuePartyStatus.value?.memberNames) && activeQueuePartyStatus.value.memberNames.length > 0
    ? activeQueuePartyStatus.value.memberNames.join(" / ")
    : ""
));
const activeQueuePartyWarningText = computed(() => (
  activeQueuePartyMismatch.value
    ? t(activeQueuePartyStatus.value?.messageKey || "common:queue.partyChangedSinceBaseline", activeQueuePartyStatus.value?.messageKey || "common:queue.partyChangedSinceBaseline")
    : ""
));
const queueActionsDisabled = computed(() => Boolean(
  simulator.runtime?.isRunning
  || activeQueueState.value?.isRunning
  || simulator.advisor.runtime?.isRunning
));
const activeQueueHasBaseline = computed(() => Boolean(activeQueueState.value?.baseline?.snapshot));
const activeQueueItemCount = computed(() => (Array.isArray(activeQueueState.value?.items) ? activeQueueState.value.items.length : 0));
const baselineReminderRoundCount = computed(() => {
  const parsed = Number(activeQueueState.value?.settings?.baselineRounds || 1);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(1, Math.min(200, Math.floor(parsed)));
});
const baselineReminderCurrentRoundsText = computed(() => (
  t(
    "common:queue.baselineReminderCurrentRounds",
    `Current baseline rounds: ${baselineReminderRoundCount.value}`,
    { count: baselineReminderRoundCount.value }
  )
));
const showRuntimeSummary = computed(() => Boolean(simulator.runtime.isRunning || simulator.runtime.error));
const activeQueueProgressText = computed(() => {
  const progress = Number(activeQueueState.value?.progress || 0);
  if (!Number.isFinite(progress)) {
    return "0%";
  }
  const clamped = Math.max(0, Math.min(1, progress));
  return `${Math.floor(clamped * 100)}%`;
});
const hasSimulationResults = computed(() => (
  Boolean(simulator.results.simResult)
  || (Array.isArray(simulator.results.simResults) && simulator.results.simResults.length > 0)
  || (Array.isArray(simulator.results.summaryRows) && simulator.results.summaryRows.length > 0)
  || (Array.isArray(simulator.results.batchRows) && simulator.results.batchRows.length > 0)
));
const topQueueActionStatusText = computed(() => topQueueActionStatus.value.text || "");
const topQueueActionStatusClass = computed(() => {
  if (topQueueActionStatus.value.tone === "success") {
    return "text-success";
  }
  if (topQueueActionStatus.value.tone === "danger") {
    return "text-destructive";
  }
  return "text-foreground/85";
});
const patchNotesEntries = computed(() => resolvePatchNoteEntries(undefined, language.value));
const patchNotesUnreadCount = computed(() => patchNotesUnreadEntries.value.length);
const hasUnreadPatchNotes = computed(() => patchNotesUnreadCount.value > 0);
const patchNotesDefaultOpenEntryId = computed(() => (
  patchNotesUnreadEntries.value[0]?.entryId
  || patchNotesEntries.value[0]?.entryId
  || ""
));
const patchNotesButtonAriaLabel = computed(() => (
  hasUnreadPatchNotes.value
    ? t("common:vue.app.patchNotesUnreadAriaLabel", "Patch Notes, {{count}} unread updates", { count: patchNotesUnreadCount.value })
    : t("common:patchNotes", "Patch Notes")
));
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


function runDeferredInitialization() {
  simulator.ensureMarketPricesLoaded(true);
  simulator.ensureAbilityUpgradeReferenceDataLoaded();
}

function scheduleDeferredInitialization() {
  if (typeof window.requestIdleCallback === "function") {
    deferredInitHandle = window.requestIdleCallback(runDeferredInitialization, { timeout: 1200 });
    return;
  }
  deferredInitHandle = window.setTimeout(runDeferredInitialization, 60);
}

function cancelDeferredInitialization() {
  if (deferredInitHandle == null) {
    return;
  }

  if (typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(deferredInitHandle);
  } else {
    clearTimeout(deferredInitHandle);
  }
  deferredInitHandle = null;
}

function setTopQueueActionStatus(tone, text) {
  topQueueActionStatus.value = {
    tone: tone || "secondary",
    text: String(text || ""),
  };
}

function resolveQueueActionErrorMessage(error) {
  const messageKey = typeof error === "string"
    ? error
    : (error?.message || String(error));
  return t(messageKey, messageKey);
}

function isQueueActionCancelled(error) {
  return Boolean(error?.code === "cancelled");
}

function localizeHridDisplayName(hrid) {
  const value = String(hrid || "");
  if (!value) {
    return "-";
  }

  if (Object.prototype.hasOwnProperty.call(itemDetailMap || {}, value)) {
    return getItemName(value, itemDetailMap[value]?.name || value);
  }

  const abilityName = getAbilityName(value, "");
  if (abilityName && abilityName !== value) {
    return abilityName;
  }

  if (Object.prototype.hasOwnProperty.call(actionNameFallbackMap.value || {}, value) || value.startsWith("/actions/")) {
    return getActionName(value, actionNameFallbackMap.value?.[value] || value);
  }

  return value;
}

function localizeQueueSkillName(skillKey) {
  const fallback = String(skillKey || "").trim();
  return getSkillName(skillKey, fallback);
}

function localizeHouseRoomName(roomHrid) {
  const value = String(roomHrid || "");
  return getHouseRoomName(value, houseRoomDetailMap?.[value]?.name || value || "House Room");
}

function formatTopQueueVariantName(item, fallbackIndex = 1) {
  const fallbackName = String(item?.name || `${t("common:queue.queueItem", "Queue Item")} ${fallbackIndex}`);
  return deriveQueueItemStatusName(item?.changeDetails, {
    t,
    fallbackText: fallbackName,
    resolveItemName: localizeHridDisplayName,
    resolveAbilityName: localizeHridDisplayName,
    resolveTriggerTargetName: localizeHridDisplayName,
    resolveHouseRoomName: localizeHouseRoomName,
    resolveSkillName: localizeQueueSkillName,
  });
}

async function runTopbarBaselineSimulation() {
  try {
    setTopQueueActionStatus("secondary", t("common:queue.baselineRunning", "Running baseline simulation..."));
    const baseline = await simulator.setQueueBaselineForActivePlayer({ runSimulation: true });
    const baselineRounds = Math.max(
      1,
      Math.floor(Number(baseline?.settings?.baselineRounds || activeQueueState.value?.settings?.baselineRounds || 1))
    );
    setTopQueueActionStatus(
      "success",
      t(
        "common:vue.queue.msgBaselineCaptured",
        `Baseline captured for active player. Current baseline rounds: ${baselineRounds}. Recommended: at least 10 rounds, with 20-30 as the usual stable range; use 50+ when comparing very close options.`,
        { count: baselineRounds }
      )
    );
  } catch (error) {
    if (isQueueActionCancelled(error)) {
      setTopQueueActionStatus("secondary", t("common:vue.queue.msgBaselineCancelled", "Baseline simulation stopped."));
      return;
    }
    setTopQueueActionStatus("danger", resolveQueueActionErrorMessage(error));
  }
}

async function setQueueBaselineFromTopbar() {
  if (!baselineReminderDismissed.value) {
    baselineReminderModalOpen.value = true;
    return;
  }
  await runTopbarBaselineSimulation();
}

function addToQueueFromTopbar() {
  try {
    const items = simulator.addActivePlayerToQueue();
    if (!Array.isArray(items) || items.length === 0) {
      setTopQueueActionStatus("danger", t("common:vue.queue.msgNoChanges", "No changes detected (or baseline missing)."));
      return;
    }
    if (items.length === 1) {
      setTopQueueActionStatus("success", t("common:vue.queue.msgVariantAdded", "{{name}} added to queue.", { name: formatTopQueueVariantName(items[0], 1) }));
      return;
    }
    setTopQueueActionStatus("success", t("common:vue.queue.msgVariantsAdded", "{{count}} variants added to queue.", { count: items.length }));
  } catch (error) {
    setTopQueueActionStatus("danger", resolveQueueActionErrorMessage(error));
  }
}

async function runQueueFromTopbar() {
  try {
    closeQueueCompleteModal();
    setTopQueueActionStatus("secondary", t("common:queue.queueRunning", "Running queue..."));
    const queueRunPromise = simulator.runActiveQueue();
    if (route.name !== "multi-results" && (simulator.runtime.isRunning || activeQueueState.value?.isRunning)) {
      queueCompleteModalOpen.value = true;
    }
    const rows = await queueRunPromise;
    if (activeQueueState.value?.lastRunStatus === "cancelled") {
      const partialCount = Array.isArray(activeQueueState.value?.ranking) ? activeQueueState.value.ranking.length : 0;
      if (partialCount > 0) {
        setTopQueueActionStatus("secondary", t("common:vue.queue.msgRunCancelledPartial", "Queue run stopped. Kept {{count}} ranked variants.", { count: partialCount }));
        return;
      }
      setTopQueueActionStatus("secondary", t("common:vue.queue.msgRunCancelled", "Queue run stopped."));
      return;
    }
    if (Array.isArray(rows) && rows.length > 0) {
      setTopQueueActionStatus("success", t("common:vue.queue.msgRunCompleted", "Queue run completed: {{count}} variants ranked.", { count: rows.length }));
      return;
    }
    if (activeQueueState.value?.error) {
      setTopQueueActionStatus("danger", t(activeQueueState.value.error, activeQueueState.value.error));
      return;
    }
    setTopQueueActionStatus("secondary", t("common:queue.emptyResults", "No queue run results yet."));
  } catch (error) {
    setTopQueueActionStatus("danger", resolveQueueActionErrorMessage(error));
  }
}

function clearQueueFromTopbar() {
  simulator.clearActiveQueue();
  setTopQueueActionStatus("success", t("common:vue.queue.msgQueueCleared", "Queue cleared."));
}

function serializeErrorPayload(payload) {
  if (payload instanceof Error) {
    return payload.stack || payload.message || String(payload);
  }
  if (typeof payload === "string") {
    return payload;
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch (error) {
    return String(payload);
  }
}

function openGlobalError(source, payload) {
  const details = serializeErrorPayload(payload);
  globalErrorText.value = `[${source}] ${details || "-"}`;
  globalErrorModalOpen.value = true;
  errorCopyStatus.value = "";
}

async function copyGlobalError() {
  const text = String(globalErrorText.value || "");
  if (!text.trim()) {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    errorCopyStatus.value = t("common:vue.app.globalErrorCopied", "Copied.");
  } catch (error) {
    errorCopyStatus.value = t("common:vue.app.globalErrorCopyFailed", "Copy failed.");
  }
}

function openFeedbackModal() {
  feedbackModalOpen.value = true;
  feedbackCopyStatus.value = "";
}

function closeFeedbackModal() {
  feedbackModalOpen.value = false;
  feedbackCopyStatus.value = "";
}

async function copyFeedbackContact(value) {
  const text = String(value || "").trim();
  if (!text) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    feedbackCopyStatus.value = t("common:vue.app.globalErrorCopied", "Copied.");
  } catch (error) {
    feedbackCopyStatus.value = t("common:vue.app.globalErrorCopyFailed", "Copy failed.");
  }
}

function onWindowError(event) {
  openGlobalError("window.error", event?.error || event?.message || event);
}

function onUnhandledRejection(event) {
  openGlobalError("unhandledrejection", event?.reason || event);
}

function closeSimulationCompleteModal() {
  simulationCompleteModalOpen.value = false;
}

function closeQueueCompleteModal() {
  queueCompleteModalOpen.value = false;
}

function closeBaselineReminderModal() {
  baselineReminderModalOpen.value = false;
}

async function acknowledgeBaselineReminderAndRun() {
  baselineReminderDismissed.value = true;
  dismissBaselineReminder();
  closeBaselineReminderModal();
  await runTopbarBaselineSimulation();
}

async function openBaselineReminderSettings() {
  closeBaselineReminderModal();
  setTopQueueActionStatus("secondary", "");
  if (route.name !== "settings") {
    await router.push({ name: "settings" });
  }
}

function refreshPatchNoteUnreadEntries() {
  patchNotesUnreadEntries.value = getUnreadPatchNoteEntries({
    entries: patchNotesEntries.value,
  });
}

function openPatchNotesModal() {
  patchNotesModalOpen.value = true;
}

function closePatchNotesModal() {
  const unreadEntryIds = patchNotesUnreadEntries.value.map((entry) => entry.entryId);
  patchNotesModalOpen.value = false;

  if (unreadEntryIds.length > 0) {
    markPatchNoteEntriesAsRead({
      entryIds: unreadEntryIds,
    });
    refreshPatchNoteUnreadEntries();
  }
}

async function goToHomeResults() {
  closeSimulationCompleteModal();
  if (route.name !== "home" || route.query.focus !== "results") {
    await router.push({ name: "home", query: { focus: "results" } });
  }
}

async function goToMultiResults() {
  closeQueueCompleteModal();
  if (route.name !== "multi-results") {
    await router.push({ name: "multi-results" });
  }
}

watch(
  () => simulator.runtime.error,
  (nextError, prevError) => {
    const nextText = String(nextError || "").trim();
    if (nextText && nextText !== String(prevError || "").trim()) {
      openGlobalError("runtime", nextText);
    }
  },
);

watch(
  () => simulator.runtime.completionNoticeId,
  (nextNoticeId, prevNoticeId) => {
    const nextId = Number(nextNoticeId || 0);
    const prevId = Number(prevNoticeId || 0);
    if (nextId <= prevId || !hasSimulationResults.value || route.name === "home") {
      return;
    }
    simulationCompleteModalOpen.value = true;
  },
);

watch(
  () => simulator.runtime.isRunning,
  (nextRunning) => {
    if (nextRunning) {
      closeSimulationCompleteModal();
    }
  },
);

watch(
  () => route.name,
  (nextRouteName) => {
    if (nextRouteName === "home") {
      closeSimulationCompleteModal();
    }
    if (nextRouteName === "multi-results") {
      closeQueueCompleteModal();
    }
  },
);

watch(
  () => simulator.activePlayerId,
  () => {
    setTopQueueActionStatus("secondary", "");
  },
);

onMounted(() => {
  initializePatchNotesState({
    entries: patchNotesEntries.value,
  });
  refreshPatchNoteUnreadEntries();
  scheduleDeferredInitialization();
  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
});

onUnmounted(() => {
  cancelDeferredInitialization();
  window.removeEventListener("error", onWindowError);
  window.removeEventListener("unhandledrejection", onUnhandledRejection);
});

watch(
  () => language.value,
  () => {
    refreshPatchNoteUnreadEntries();
  },
);

async function switchLanguage(nextLanguage) {
  await setLanguage(nextLanguage);
  simulator.setLanguage(nextLanguage);
}
</script>

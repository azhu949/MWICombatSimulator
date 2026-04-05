<template>
  <div class="mx-auto w-full max-w-[1440px] px-4 py-5 lg:px-8">
    <header class="sticky top-0 z-40 mb-4">
      <div class="panel overflow-hidden">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div class="flex flex-wrap items-center gap-2">
            <h1 class="font-heading text-2xl font-bold text-amber-300">{{ t("common:title", "MWI Combat Simulator") }}</h1>
            <span class="rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-xs font-semibold text-amber-200/80">
              v{{ appVersion }}
            </span>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <RouterLink class="action-button-muted" exact-active-class="top-nav-active" to="/home">{{ t('common:menu.home', 'Home') }}</RouterLink>
            <RouterLink class="action-button-muted" exact-active-class="top-nav-active" to="/advisor">{{ t('common:menu.advisor', 'Advisor / 刷图推荐') }}</RouterLink>
            <RouterLink class="action-button-muted" exact-active-class="top-nav-active" to="/queue">{{ t('common:menu.queue', 'Queue') }}</RouterLink>
            <RouterLink class="action-button-muted" exact-active-class="top-nav-active" to="/multi-results">{{ t('common:menu.multiResults', 'Multi-round') }}</RouterLink>
            <RouterLink class="action-button-muted" exact-active-class="top-nav-active" to="/settings">{{ t('common:menu.settings', 'Settings') }}</RouterLink>
            <button
              type="button"
              class="action-button-muted patch-notes-trigger"
              :class="{ 'patch-notes-trigger-unread': hasUnreadPatchNotes }"
              :aria-label="patchNotesButtonAriaLabel"
              :title="patchNotesButtonAriaLabel"
              @click="openPatchNotesModal"
            >
              <span>{{ t("common:patchNotes", "Patch Notes") }}</span>
              <span v-if="hasUnreadPatchNotes" class="patch-notes-unread-badge" aria-hidden="true">
                {{ t("common:vue.app.patchNotesUnreadBadge", "Unread") }}
              </span>
            </button>
            <a
              href="https://github.com/azhu949/MWICombatSimulator"
              class="action-button-muted header-icon-link"
              :aria-label="t('common:vue.app.feedbackGitHubAriaLabel', 'GitHub Repository')"
              :title="t('common:vue.app.feedbackGitHubAriaLabel', 'GitHub Repository')"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path
                  d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.05c-3.34.73-4.04-1.41-4.04-1.41-.55-1.38-1.33-1.74-1.33-1.74-1.09-.74.08-.73.08-.73 1.21.08 1.85 1.21 1.85 1.21 1.07 1.8 2.81 1.28 3.49.98.11-.76.42-1.28.76-1.58-2.66-.3-5.47-1.3-5.47-5.8 0-1.28.47-2.33 1.22-3.15-.12-.3-.53-1.53.12-3.18 0 0 1-.31 3.3 1.2a11.61 11.61 0 0 1 6 0c2.29-1.51 3.29-1.2 3.29-1.2.66 1.65.25 2.88.12 3.18.76.82 1.22 1.87 1.22 3.15 0 4.51-2.81 5.5-5.49 5.79.43.37.81 1.08.81 2.18v3.24c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z"
                />
              </svg>
              <span class="sr-only">{{ t("common:vue.app.feedbackGitHubAriaLabel", "GitHub Repository") }}</span>
            </a>
            <button type="button" class="action-button-muted" @click="openFeedbackModal">
              {{ t("common:vue.app.feedback", "Feedback") }}
            </button>
            <button
              type="button"
              class="action-button-muted header-icon-button"
              :aria-label="themeToggleAriaLabel"
              :title="themeToggleAriaLabel"
              @click="toggleTheme"
            >
              <svg
                v-if="theme === 'dark'"
                aria-hidden="true"
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.8"
              >
                <path d="M21.752 15.002A9.718 9.718 0 0 1 18 15.75 9.75 9.75 0 0 1 8.25 6c0-1.33.266-2.597.748-3.752A9.753 9.753 0 1 0 21.752 15.002Z" />
              </svg>
              <svg
                v-else
                aria-hidden="true"
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.8"
              >
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2.75v2.5M12 18.75v2.5M21.25 12h-2.5M5.25 12h-2.5M18.541 5.459l-1.768 1.768M7.227 16.773l-1.768 1.768M18.541 18.541l-1.768-1.768M7.227 7.227 5.459 5.459" />
              </svg>
              <span class="sr-only">{{ themeToggleAriaLabel }}</span>
            </button>
            <button
              type="button"
              class="action-button-muted header-compact-button"
              :aria-label="languageToggleAriaLabel"
              :title="languageToggleAriaLabel"
              @click="switchLanguage(languageToggleTarget)"
            >
              {{ languageToggleLabel }}
            </button>
          </div>
        </div>

        <div class="mt-3 rounded-xl border border-white/10 bg-slate-900/40 p-3">
          <div class="flex flex-col gap-3">
            <div class="flex flex-col gap-3 xl:grid xl:grid-cols-[minmax(0,1fr)_640px] xl:items-start 2xl:grid-cols-[minmax(0,1fr)_720px]">
              <div class="min-w-0 space-y-3">
                <div class="flex flex-wrap items-center gap-2">
                  <button type="button"
                    class="action-button-muted"
                   
                    :disabled="queueActionsDisabled"
                    @click="setQueueBaselineFromTopbar"
                  >
                    {{ t("common:queue.setBaseline", "Set Baseline") }}
                  </button>
                  <button type="button"
                    class="action-button-muted"
                   
                    :disabled="queueActionsDisabled || !activeQueueHasBaseline || activeQueuePartyMismatch"
                    @click="addToQueueFromTopbar"
                  >
                    {{ t("common:queue.addToQueue", "Add To Queue") }}
                  </button>
                  <button type="button"
                    class="action-button-primary"
                   
                    :disabled="queueActionsDisabled || !activeQueueHasBaseline || activeQueueItemCount === 0 || activeQueuePartyMismatch"
                    @click="runQueueFromTopbar"
                  >
                    {{ t("common:queue.runQueue", "Run Queue") }}
                  </button>
                  <button type="button"
                    class="action-button-danger"
                   
                    :disabled="queueActionsDisabled || activeQueueItemCount === 0"
                    @click="clearQueueFromTopbar"
                  >
                    {{ t("common:queue.clearQueue", "Clear Queue") }}
                  </button>
                  <span class="text-xs text-slate-400">
                    {{ t("common:queue.queueList", "Queue List") }}:
                    <span class="ml-1 text-slate-100">{{ activeQueueItemCount }}</span>
                  </span>
                  <span class="text-xs text-slate-400">
                    {{ t("common:vue.queue.queueProgress", "Queue Progress") }}:
                    <span class="ml-1 text-slate-100">{{ activeQueueProgressText }}</span>
                  </span>
                  <span v-if="activeQueuePartySummaryText" class="text-xs text-slate-400">
                    {{ t("common:queue.partyLockedMembers", "Locked party") }}:
                    <span class="ml-1 text-slate-100">{{ activeQueuePartySummaryText }}</span>
                  </span>
                </div>
                <p v-if="topQueueActionStatusText" class="text-xs" :class="topQueueActionStatusClass">{{ topQueueActionStatusText }}</p>
                <p v-if="activeQueuePartyWarningText" class="text-xs text-amber-300">{{ activeQueuePartyWarningText }}</p>
              </div>

              <div class="grid gap-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                <div
                  v-for="player in simulator.players"
                  :key="player.id"
                  class="cursor-pointer rounded-xl border px-2 py-1.5 transition"
                  :class="[
                    simulator.activePlayerId === player.id ? 'border-amber-300 bg-amber-300/10' : 'border-white/10 bg-slate-900/40',
                  ]"
                  tabindex="0"
                  @click="simulator.setActivePlayer(player.id)"
                  @keydown.enter.self.prevent="simulator.setActivePlayer(player.id)"
                  @keydown.space.self.prevent="simulator.setActivePlayer(player.id)"
                >
                  <div class="flex items-center gap-1.5">
                    <input
                      v-model="player.name"
                      :aria-label="t('common:player', 'Player')"
                      class="w-[72px] min-w-0 flex-none bg-transparent font-heading text-[11px] leading-none"
                      @click.stop="simulator.setActivePlayer(player.id)"
                      @focus="simulator.setActivePlayer(player.id)"
                    />
                    <label class="badge flex shrink-0 items-center justify-center px-1.5 py-1 text-slate-200" @click.stop>
                      <input
                        v-model="player.selected"
                        :aria-label="t('common:vue.app.simToggle', 'Sim')"
                        class="h-3.5 w-3.5"
                        type="checkbox"
                        @click.stop
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="showRuntimeSummary" class="space-y-2 border-t border-white/10 pt-3">
              <div class="flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-[0.14em] text-slate-400">
                <span>{{ t("common:vue.app.runtime", "Runtime") }}</span>
                <span class="text-slate-300">{{ progressLabel }}</span>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-slate-800">
                <div class="h-full bg-gradient-to-r from-teal-400 to-amber-300 transition-all" :style="{ width: `${Math.floor(simulator.runtime.progress * 100)}%` }"></div>
              </div>
              <div v-if="simulator.runtime.error" class="flex flex-wrap items-center gap-2">
                <p class="text-sm text-rose-300">{{ simulator.runtime.error }}</p>
                <button type="button" class="action-button-muted text-xs" @click="openGlobalError('runtime', simulator.runtime.error)">
                  {{ t("common:vue.app.viewErrorDetails", "Details") }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>

    <main>
      <RouterView />
    </main>

    <BaseModal :open="globalErrorModalOpen" :title="t('common:vue.app.globalErrorTitle', 'Error')" @close="globalErrorModalOpen = false">
      <p class="text-sm text-slate-300">{{ t("common:vue.app.globalErrorDesc", "Please copy the following details if you report this issue.") }}</p>
      <pre class="max-h-[320px] overflow-auto rounded-xl border border-white/10 bg-slate-950/70 p-3 text-xs text-rose-200">{{ globalErrorText }}</pre>
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" class="action-button-primary" @click="copyGlobalError">
          {{ t("common:vue.common.copy", "Copy") }}
        </button>
        <span class="text-xs text-slate-400">{{ errorCopyStatus }}</span>
      </div>
    </BaseModal>

    <BaseModal
      :open="feedbackModalOpen"
      :title="t('common:vue.app.feedback', 'Feedback')"
      initial-focus-selector="[data-feedback-copy]"
      @close="closeFeedbackModal"
    >
      <div class="space-y-3">
        <p class="text-sm text-slate-300">
          {{ t("common:vue.app.feedbackHint", "Use the following channels for feedback, bug reports, or suggestions.") }}
        </p>

        <div class="feedback-contact-list">
          <div class="feedback-contact-row">
            <div class="min-w-0">
              <p class="feedback-contact-label">{{ t("common:vue.app.feedbackQqLabel", "QQ") }}</p>
              <p class="feedback-contact-value">596846069</p>
            </div>
            <button type="button" class="action-button-muted text-xs" data-feedback-copy @click="copyFeedbackContact('596846069')">
              {{ t("common:vue.common.copy", "Copy") }}
            </button>
          </div>

          <div class="feedback-contact-row">
            <div class="min-w-0">
              <p class="feedback-contact-label">{{ t("common:vue.app.feedbackEmailLabel", "QQ Email") }}</p>
              <a class="feedback-contact-link" href="mailto:596846069@qq.com">596846069@qq.com</a>
            </div>
            <button type="button" class="action-button-muted text-xs" @click="copyFeedbackContact('596846069@qq.com')">
              {{ t("common:vue.common.copy", "Copy") }}
            </button>
          </div>
        </div>

        <p class="text-xs text-slate-400">{{ feedbackCopyStatus }}</p>
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
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <span>{{ t("common:vue.settings.versionsCount", "Versions", { count: patchNotesEntries.length }) }}</span>
          <span v-if="hasUnreadPatchNotes">
            {{ t("common:vue.app.patchNotesUnreadStatus", "Unread updates", { count: patchNotesUnreadCount }) }}
          </span>
        </div>

        <p class="text-xs text-slate-400">
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
            <ul class="list-disc space-y-1 pl-5 text-sm text-slate-200">
              <li v-for="note in entry.notes" :key="note">{{ note }}</li>
            </ul>
          </DisclosurePanel>
        </div>

        <p v-else class="text-sm text-slate-300" data-patch-notes-start tabindex="-1">
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
      <p class="text-sm text-slate-300">{{ t("common:vue.app.simulationCompleteDesc", "Simulation completed. Go to Home results now?") }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="action-button-primary"
          data-simulation-results-confirm
          @click="goToHomeResults"
        >
          {{ t("common:vue.app.goToHomeResults", "Go to Home Results") }}
        </button>
        <button type="button" class="action-button-muted" @click="closeSimulationCompleteModal">
          {{ t("common:vue.app.stayHere", "Stay Here") }}
        </button>
      </div>
    </BaseModal>

    <BaseModal
      :open="queueCompleteModalOpen"
      :title="t('common:queue.queueRunning', 'Running queue...')"
      initial-focus-selector="[data-multi-results-confirm]"
      @close="closeQueueCompleteModal"
    >
      <p class="text-sm text-slate-300">{{ t("common:vue.app.queueCompleteDesc", "Queue run started. Go to the Multi-round page now?") }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="action-button-primary"
          data-multi-results-confirm
          @click="goToMultiResults"
        >
          {{ t("common:vue.app.goToMultiResults", "Go to Multi-round") }}
        </button>
        <button type="button" class="action-button-muted" @click="closeQueueCompleteModal">
          {{ t("common:vue.app.stayHere", "Stay Here") }}
        </button>
      </div>
    </BaseModal>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import {
  houseRoomDetailIndex as houseRoomDetailMap,
  itemDetailIndex as itemDetailMap,
} from "../shared/gameDataIndex.js";
import BaseModal from "./components/BaseModal.vue";
import DisclosurePanel from "./components/DisclosurePanel.vue";
import { useSimulatorStore } from "../stores/simulatorStore.js";
import { useAbilityText } from "./composables/useAbilityText.js";
import { useGameDataText } from "./composables/useGameDataText.js";
import { useI18nText } from "./composables/useI18nText.js";
import {
  getUnreadPatchNoteEntries,
  initializePatchNotesState,
  markPatchNoteEntriesAsRead,
  resolvePatchNoteEntries,
} from "./patchNotes.js";
import { deriveQueueItemStatusName } from "./queueItemStatusPresentation.js";

const THEME_STORAGE_KEY = "mwi.ui.theme.v1";
const appVersion = __APP_VERSION__;
const simulator = useSimulatorStore();
const router = useRouter();
const route = useRoute();
const theme = ref("dark");
let deferredInitHandle = null;
const globalErrorModalOpen = ref(false);
const globalErrorText = ref("");
const errorCopyStatus = ref("");
const feedbackModalOpen = ref(false);
const feedbackCopyStatus = ref("");
const simulationCompleteModalOpen = ref(false);
const queueCompleteModalOpen = ref(false);
const patchNotesModalOpen = ref(false);
const patchNotesUnreadEntries = ref([]);
const topQueueActionStatus = ref({
  tone: "secondary",
  text: "",
});
const { language, setLanguage, t } = useI18nText();
const { getAbilityName } = useAbilityText();
const { getSkillName } = useGameDataText();

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
    return "text-emerald-300";
  }
  if (topQueueActionStatus.value.tone === "danger") {
    return "text-rose-300";
  }
  return "text-slate-300";
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

function normalizeTheme(value) {
  return value === "light" ? "light" : "dark";
}

function applyTheme(nextTheme) {
  const normalizedTheme = normalizeTheme(nextTheme);
  theme.value = normalizedTheme;
  document.documentElement.dataset.theme = normalizedTheme;
  localStorage.setItem(THEME_STORAGE_KEY, normalizedTheme);
}

function toggleTheme() {
  applyTheme(theme.value === "dark" ? "light" : "dark");
}

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

function localizeQueueSkillName(skillKey) {
  const fallback = String(skillKey || "").trim();
  return getSkillName(skillKey, fallback);
}

function localizeHouseRoomName(roomHrid) {
  const value = String(roomHrid || "");
  return t(`houseRoomNames.${value}`, houseRoomDetailMap?.[value]?.name || value || "House Room");
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

async function setQueueBaselineFromTopbar() {
  try {
    setTopQueueActionStatus("secondary", t("common:queue.baselineRunning", "Running baseline simulation..."));
    await simulator.setQueueBaselineForActivePlayer({ runSimulation: true });
    setTopQueueActionStatus("success", t("common:vue.queue.msgBaselineCaptured", "Baseline captured for active player."));
  } catch (error) {
    if (isQueueActionCancelled(error)) {
      setTopQueueActionStatus("secondary", t("common:vue.queue.msgBaselineCancelled", "Baseline simulation stopped."));
      return;
    }
    setTopQueueActionStatus("danger", resolveQueueActionErrorMessage(error));
  }
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
  const savedTheme = normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY));
  applyTheme(savedTheme);
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

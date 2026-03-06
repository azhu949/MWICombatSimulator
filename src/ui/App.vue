<template>
  <div class="mx-auto w-full max-w-[1440px] px-4 py-5 lg:px-8">
    <header class="sticky top-0 z-40 mb-4">
      <div class="panel overflow-hidden">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 class="font-heading text-2xl font-bold text-amber-300">{{ t("common:title", "MWI Combat Simulator") }}</h1>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <RouterLink class="action-button-muted" exact-active-class="top-nav-active" to="/home">{{ t('common:menu.home', 'Home') }}</RouterLink>
            <RouterLink class="action-button-muted" exact-active-class="top-nav-active" to="/queue">{{ t('common:menu.queue', 'Queue') }}</RouterLink>
            <RouterLink class="action-button-muted" exact-active-class="top-nav-active" to="/results">{{ t('common:menu.results', 'Results') }}</RouterLink>
            <RouterLink class="action-button-muted" exact-active-class="top-nav-active" to="/multi-results">{{ t('common:menu.multiResults', 'Multi-round') }}</RouterLink>
            <RouterLink class="action-button-muted" exact-active-class="top-nav-active" to="/settings">{{ t('common:menu.settings', 'Settings') }}</RouterLink>
            <button type="button" class="action-button-muted" @click="toggleTheme">
              {{ t("common:controls.darkMode", "Dark Mode") }}: {{ themeLabel }}
            </button>
            <button type="button"
              class="action-button-muted"
             
              :class="language === 'en' ? 'border-amber-300 text-amber-300' : ''"
              @click="switchLanguage('en')"
            >
              English
            </button>
            <button type="button"
              class="action-button-muted"
             
              :class="language === 'zh' ? 'border-amber-300 text-amber-300' : ''"
              @click="switchLanguage('zh')"
            >
              中文
            </button>
          </div>
        </div>

        <div class="mt-3 rounded-xl border border-white/10 bg-slate-900/40 p-3">
          <div class="flex flex-col gap-3">
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
               
                :disabled="queueActionsDisabled || !activeQueueHasBaseline"
                @click="addToQueueFromTopbar"
              >
                {{ t("common:queue.addToQueue", "Add To Queue") }}
              </button>
              <button type="button"
                class="action-button-primary"
               
                :disabled="queueActionsDisabled || !activeQueueHasBaseline || activeQueueItemCount === 0"
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
              <span class="text-xs text-slate-400">
                {{ t("common:vue.queue.activePlayer", "Active player", { name: simulator.activePlayer.name }) }}
              </span>
            </div>
            <p v-if="topQueueActionStatusText" class="text-xs" :class="topQueueActionStatusClass">{{ topQueueActionStatusText }}</p>
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

    <section class="panel mb-4 overflow-hidden">
      <div class="grid gap-2 lg:grid-cols-5">
        <div
          v-for="player in simulator.players"
          :key="player.id"
          class="rounded-xl border px-3 py-2 transition"
          :class="[
            simulator.activePlayerId === player.id ? 'border-amber-300 bg-amber-300/10' : 'border-white/10 bg-slate-900/40',
          ]"
        >
          <div class="flex items-center justify-between gap-2">
            <button type="button"
              class="action-button-muted shrink-0 px-2 py-1 text-xs"
             
              :aria-pressed="simulator.activePlayerId === player.id ? 'true' : 'false'"
              :class="simulator.activePlayerId === player.id ? 'border-amber-300 text-amber-300' : ''"
              @click="simulator.setActivePlayer(player.id)"
            >
              {{ simulator.activePlayerId === player.id ? t("common:vue.app.active", "Active") : t("common:vue.app.setActive", "Set Active") }}
            </button>
            <input
              v-model="player.name"
              :aria-label="t('common:player', 'Player')"
              class="w-full bg-transparent font-heading text-sm"
            />
            <label class="badge flex shrink-0 items-center gap-2 text-slate-200">
              <input v-model="player.selected" type="checkbox" />
              {{ t("common:vue.app.simToggle", "Sim") }}
            </label>
          </div>
        </div>
      </div>

    </section>

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
      :open="simulationCompleteModalOpen"
      :title="t('common:vue.app.simulationCompleteTitle', 'Simulation completed')"
      initial-focus-selector="[data-simulation-results-confirm]"
      @close="closeSimulationCompleteModal"
    >
      <p class="text-sm text-slate-300">{{ t("common:vue.app.simulationCompleteDesc", "Simulation completed. Go to the Results page now?") }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="action-button-primary"
          data-simulation-results-confirm
          @click="goToSimulationResults"
        >
          {{ t("common:vue.app.goToResults", "Go to Results") }}
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
import BaseModal from "./components/BaseModal.vue";
import { useSimulatorStore } from "../stores/simulatorStore.js";
import { useI18nText } from "./composables/useI18nText.js";

const THEME_STORAGE_KEY = "mwi.ui.theme.v1";
const simulator = useSimulatorStore();
const router = useRouter();
const route = useRoute();
const theme = ref("dark");
let deferredInitHandle = null;
const globalErrorModalOpen = ref(false);
const globalErrorText = ref("");
const errorCopyStatus = ref("");
const simulationCompleteModalOpen = ref(false);
const queueCompleteModalOpen = ref(false);
const topQueueActionStatus = ref({
  tone: "secondary",
  text: "",
});
const { language, setLanguage, t } = useI18nText();

const progressLabel = computed(() => {
  const progress = Math.floor(simulator.runtime.progress * 100);
  const elapsed = simulator.runtime.elapsedSeconds.toFixed(1);
  return `${progress}% | ${elapsed}s`;
});

const themeLabel = computed(() => (
  theme.value === "dark"
    ? t("common:vue.app.themeDark", "Dark")
    : t("common:vue.app.themeLight", "Light")
));

const activeQueueState = computed(() => simulator.activeQueueState || null);
const queueActionsDisabled = computed(() => Boolean(simulator.runtime?.isRunning || activeQueueState.value?.isRunning));
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
  simulator.ensureMarketPricesLoaded();
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

async function setQueueBaselineFromTopbar() {
  try {
    setTopQueueActionStatus("secondary", t("common:queue.baselineRunning", "Running baseline simulation..."));
    await simulator.setQueueBaselineForActivePlayer({ runSimulation: true });
    setTopQueueActionStatus("success", t("common:vue.queue.msgBaselineCaptured", "Baseline captured for active player."));
  } catch (error) {
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
      setTopQueueActionStatus("success", t("common:vue.queue.msgVariantAdded", "{{name}} added to queue.", { name: items[0].name }));
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

async function goToSimulationResults() {
  closeSimulationCompleteModal();
  if (route.name !== "results") {
    await router.push({ name: "results" });
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
    if (nextId <= prevId || !hasSimulationResults.value || route.name === "results") {
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
    if (nextRouteName === "results") {
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
  scheduleDeferredInitialization();
  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
});

onUnmounted(() => {
  cancelDeferredInitialization();
  window.removeEventListener("error", onWindowError);
  window.removeEventListener("unhandledrejection", onUnhandledRejection);
});

async function switchLanguage(nextLanguage) {
  await setLanguage(nextLanguage);
  simulator.setLanguage(nextLanguage);
}
</script>

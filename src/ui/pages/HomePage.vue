<template>
  <section class="space-y-4">
    <HomeWorkspaceTabs
      :model-value="activeWorkspaceTab"
      :tabs="workspaceTabs"
      :aria-label="t('common:vue.home.workspaceTabsAria', 'Home workspace sections')"
      @update:model-value="requestWorkspaceTabChange"
    />

    <HomeSummaryPanel
      class="xl:hidden"
      :eyebrow="t('common:vue.home.workspaceEyebrow', 'Workspace')"
      :title="t('common:vue.home.workspaceTitle', 'Simulation Workspace')"
      :description="t('common:vue.home.workspaceDesc', 'Keep key metrics visible while you configure and run simulations.')"
      :status-label="workspaceStatusLabel"
      :status-text="workspaceStatusText"
      :status-tone="workspaceStatusTone"
      :is-running="simulator.runtime.isRunning"
      :progress-text="homeResultsProgressText"
      :progress-percent="homeResultsProgressPercent"
      :config-rows="summaryConfigRows"
      :metric-rows="summaryMetricRows"
      :build-rows="summaryBuildRows"
      :metrics-title="t('common:vue.home.workspaceMetricsTitle', 'Key Metrics')"
      :build-title="t('common:vue.home.workspaceBuildTitle', 'Build Snapshot')"
      :can-open-results="homeCanOpenResults"
      :results-button-label="fullResultsButtonLabel"
      @view-results="openHomeResultsPanel"
    />

    <div :class="['grid gap-4', activeWorkspaceTab !== 'results' ? 'xl:grid-cols-[minmax(0,1fr)_340px]' : '']">
      <div class="space-y-4">
        <div class="grid gap-4 xl:grid-cols-12">
          <div v-if="activeWorkspaceTab === 'base'" class="grid gap-4 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)] xl:col-span-12">
            <HomeLevelsPanel />
            <HomeSimulationPanel
              :snapshot-controller="snapshotController"
              @open-combat-scrolls="openCombatScrollsModal = true"
              @open-import-export="openPlayerImportModal = true"
              @open-house-rooms="openHouseRoomsModal = true"
              @open-achievements="openAchievementsModal = true"
              @open-guild-buffs="openGuildBuffsModal = true"
              @open-experimental="openExperimentalModal = true"
              @open-snapshot-info="openPlayerSnapshotInfoModal = true"
            />
          </div>
          <HomeEquipmentPanel v-if="activeWorkspaceTab === 'base'" />
        </div>

        <HomeLoadoutPanels v-if="activeWorkspaceTab === 'base'" :trigger-controller="triggerController" />
        <HomeCombatAttributesPanel v-if="activeWorkspaceTab === 'advanced'" :sections="combatStatSections" />

        <section v-if="activeWorkspaceTab === 'results'" ref="homeResultsSection" class="space-y-4">
          <div v-if="simulator.runtime.isRunning" class="surface-panel">
            <h2 class="font-heading text-lg font-semibold text-primary">{{ t("common:vue.home.homeResultsRunningTitle", "Simulation in progress") }}</h2>
            <p class="mt-1 text-sm text-muted-foreground">{{ t("common:vue.home.homeResultsRunning", "Simulation is running. Results will appear here automatically.") }}</p>
            <p class="mt-3 text-sm font-medium text-foreground">{{ homeResultsProgressText }}</p>
          </div>
          <AsyncSimulationResultsView v-if="homeHasResults" />
          <div v-else-if="!simulator.runtime.isRunning" class="surface-panel border-dashed">
            <p class="text-sm text-foreground/85">{{ t("common:vue.home.homeResultsEmpty", "Your next simulation result will appear here as soon as it finishes.") }}</p>
          </div>
        </section>
      </div>

      <div v-if="activeWorkspaceTab !== 'results'" class="hidden xl:block xl:self-start xl:sticky" style="top: calc(var(--app-sticky-shell-height, 3rem) + 1rem)">
        <HomeSummaryPanel
          eyebrow=""
          :title="t('common:vue.home.workspaceTitle', 'Simulation Workspace')"
          :description="t('common:vue.home.workspaceDesc', 'Keep key metrics visible while you configure and run simulations.')"
          :compact-header="true"
          :show-description="false"
          :status-label="workspaceStatusLabel"
          :status-text="workspaceStatusText"
          :show-status-card="false"
          :status-tone="workspaceStatusTone"
          :is-running="simulator.runtime.isRunning"
          :progress-text="homeResultsProgressText"
          :progress-percent="homeResultsProgressPercent"
          :config-rows="summaryConfigRows"
          :show-config-rows="false"
          :metric-rows="summaryMetricRows"
          :build-rows="summaryBuildRows"
          :metrics-title="t('common:vue.home.workspaceMetricsTitle', 'Key Metrics')"
          :build-title="t('common:vue.home.workspaceBuildTitle', 'Build Snapshot')"
          :can-open-results="homeCanOpenResults"
          :results-button-label="fullResultsButtonLabel"
          @view-results="openHomeResultsPanel"
        />
      </div>
    </div>

    <HomeHouseRoomsModal :open="openHouseRoomsModal" @close="openHouseRoomsModal = false" />
    <HomeGuildBuffsModal :open="openGuildBuffsModal" @close="openGuildBuffsModal = false" />
    <HomeCombatScrollsModal :open="openCombatScrollsModal" @close="openCombatScrollsModal = false" />
    <HomeAchievementsModal :open="openAchievementsModal" @close="openAchievementsModal = false" />
    <HomeImportExportModal :open="openPlayerImportModal" :block-player-config-replacement="triggerController.blockPlayerConfigReplacement" @close="openPlayerImportModal = false" />
    <HomeExperimentalModal :open="openExperimentalModal" @close="openExperimentalModal = false" />
    <HomePlayerSnapshotModal :open="openPlayerSnapshotInfoModal" :snapshot-controller="snapshotController" @close="openPlayerSnapshotInfoModal = false" />
  </section>
</template>

<script setup>
import { defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { applyTampermonkeyImportMessage } from "../../services/tampermonkeyImportBridge.js";
import { useSimulatorStore } from "../../stores/simulatorStore.js";
import HomeAchievementsModal from "../components/home/HomeAchievementsModal.vue";
import HomeCombatAttributesPanel from "../components/home/HomeCombatAttributesPanel.vue";
import HomeCombatScrollsModal from "../components/home/HomeCombatScrollsModal.vue";
import HomeEquipmentPanel from "../components/home/HomeEquipmentPanel.vue";
import HomeExperimentalModal from "../components/home/HomeExperimentalModal.vue";
import HomeGuildBuffsModal from "../components/home/HomeGuildBuffsModal.vue";
import HomeHouseRoomsModal from "../components/home/HomeHouseRoomsModal.vue";
import HomeImportExportModal from "../components/home/HomeImportExportModal.vue";
import HomeLevelsPanel from "../components/home/HomeLevelsPanel.vue";
import HomeLoadoutPanels from "../components/home/HomeLoadoutPanels.vue";
import HomePlayerSnapshotModal from "../components/home/HomePlayerSnapshotModal.vue";
import HomeSimulationPanel from "../components/home/HomeSimulationPanel.vue";
import HomeSummaryPanel from "../components/home/HomeSummaryPanel.vue";
import HomeWorkspaceTabs from "../components/home/HomeWorkspaceTabs.vue";
import { useHomeCombatPreview } from "../composables/useHomeCombatPreview.js";
import { useHomePlayerSnapshots } from "../composables/useHomePlayerSnapshots.js";
import { useHomeTriggerEditor } from "../composables/useHomeTriggerEditor.js";
import { useHomeWorkspaceSummary } from "../composables/useHomeWorkspaceSummary.js";
import { useI18nText } from "../composables/useI18nText.js";

const simulator = useSimulatorStore();
const route = useRoute();
const router = useRouter();
const { t } = useI18nText();
const AsyncSimulationResultsView = defineAsyncComponent(() => import("../components/SimulationResultsView.vue"));
const triggerController = useHomeTriggerEditor();
const combatPreview = useHomeCombatPreview();
const snapshotController = useHomePlayerSnapshots(triggerController.blockPlayerConfigReplacement);
const {
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
} = useHomeWorkspaceSummary(combatPreview);
const combatStatSections = combatPreview.sections;
const activeWorkspaceTab = ref("base");
const homeResultsSection = ref(null);
const openHouseRoomsModal = ref(false);
const openAchievementsModal = ref(false);
const openGuildBuffsModal = ref(false);
const openCombatScrollsModal = ref(false);
const openPlayerImportModal = ref(false);
const openPlayerSnapshotInfoModal = ref(false);
const openExperimentalModal = ref(false);
const TAMPERMONKEY_BRIDGE_CHANNEL = "mwi-tm-bridge";

function requestWorkspaceTabChange(nextTab) {
  const normalizedTab = ["base", "advanced", "results"].includes(nextTab) ? nextTab : "base";
  if (normalizedTab === activeWorkspaceTab.value) return true;
  if (!triggerController.canLeave()) return false;
  triggerController.reset();
  activeWorkspaceTab.value = normalizedTab;
  return true;
}

async function scrollToHomeResults(clearFocus = false) {
  await nextTick();
  homeResultsSection.value?.scrollIntoView({ behavior: "smooth", block: "start" });
  if (clearFocus && route.name === "home" && route.query.focus === "results") {
    const { focus, ...query } = route.query;
    await router.replace({ name: "home", query, hash: route.hash });
  }
}

async function openHomeResultsPanel(clearFocus = false) {
  if (!requestWorkspaceTabChange("results")) return;
  await scrollToHomeResults(clearFocus);
}

function postTampermonkeyImportResult(payload) {
  window.postMessage({ channel: TAMPERMONKEY_BRIDGE_CHANNEL, ...payload }, window.location.origin);
}

function handleTampermonkeyImportWindowMessage(event) {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data;
  if (!data || typeof data !== "object" || data.channel !== TAMPERMONKEY_BRIDGE_CHANNEL || data.type !== "mwi-tm-import") return;
  const importTarget = String(data.importTarget || "").trim();
  if (importTarget && importTarget !== "player") return;
  const requestId = String(data.requestId || "").trim();
  if (!requestId) return;
  if (triggerController.blockPlayerConfigReplacement()) {
    postTampermonkeyImportResult({ type: "mwi-tm-import-result", requestId, ok: false, message: triggerController.blockedMessage.value });
    return;
  }
  try {
    const result = applyTampermonkeyImportMessage(simulator, data);
    postTampermonkeyImportResult({ type: "mwi-tm-import-result", requestId, ok: true, detectedFormat: result?.detectedFormat || "", message: result?.message || "" });
  } catch (error) {
    postTampermonkeyImportResult({ type: "mwi-tm-import-result", requestId, ok: false, message: error?.message || String(error) });
  }
}

onBeforeRouteLeave(() => triggerController.canLeave());
watch(
  () => route.query.focus,
  async (nextFocus) => {
    if (route.name === "home" && nextFocus === "results") await openHomeResultsPanel(true);
  },
  { immediate: true },
);
onMounted(() => window.addEventListener("message", handleTampermonkeyImportWindowMessage));
onBeforeUnmount(() => window.removeEventListener("message", handleTampermonkeyImportWindowMessage));
</script>

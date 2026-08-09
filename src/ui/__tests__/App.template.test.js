import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../App.vue", import.meta.url), "utf8");
const sidebarSource = readFileSync(new URL("../components/AppSidebar.vue", import.meta.url), "utf8");
const commandBarSource = readFileSync(new URL("../components/CombatCommandBar.vue", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("../router/index.js", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("App shell contracts", () => {
  it("uses the responsive sidebar shell and contextual command bar", () => {
    expect(appSource).toContain("<SidebarProvider>");
    expect(appSource).toContain("<AppSidebar");
    expect(appSource).toContain("<SidebarInset");
    expect(appSource).toContain("<CombatCommandBar");
    expect(appSource).toContain('v-if="showCombatToolbar"');
    expect(appSource).toContain("route.meta?.showCombatToolbar !== false");
  });

  it("keeps routes lazy and supplies ordered navigation metadata", () => {
    for (const route of ["home", "advisor", "enhancement", "skilling", "queue", "multi-results", "settings", "guide"]) {
      expect(routerSource).toContain(`name: "${route}"`);
    }
    expect(routerSource).toContain("navLabelKey");
    expect(routerSource).toContain("navGroup");
    expect(routerSource).toContain("navOrder");
    expect(sidebarSource).toContain("router.getRoutes()");
  });

  it("moves repository, feedback, patch notes, and version details into the sidebar", () => {
    expect(sidebarSource).toContain("https://github.com/azhu949/MWICombatSimulator");
    expect(sidebarSource).toContain("common:vue.app.feedback");
    expect(sidebarSource).toContain("common:patchNotes");
    expect(sidebarSource).toContain("v{{ version }}");
  });

  it("keeps theme and language as accessible global actions", () => {
    expect(appSource).toContain(':aria-label="themeToggleAriaLabel"');
    expect(appSource).toContain('@click="toggleTheme"');
    expect(appSource).toContain(':aria-label="languageToggleAriaLabel"');
    expect(appSource).toContain("languageToggleLabel");
    expect(appSource).toContain("common:vue.app.switchToLightTheme");
    expect(appSource).toContain("common:vue.app.switchToDarkTheme");
  });

  it("keeps queue actions and mobile overflow behavior in the command bar", () => {
    expect(commandBarSource).toContain("queueActionsDisabled || !hasBaseline || itemCount === 0 || partyMismatch");
    expect(commandBarSource).toContain("<DropdownMenuRoot>");
    expect(commandBarSource).toContain('class="2xl:hidden"');
    expect(commandBarSource).toContain("@click=\"emit('run-queue')\"");
  });

  it("keeps the command bar and live runtime progress visible below the app header", () => {
    expect(commandBarSource).toContain("sticky top-12 z-30");
    expect(commandBarSource).toContain('ref="commandBarRoot"');
    expect(commandBarSource).toContain('emit("height-change", height)');
    expect(appSource).toContain("'--app-sticky-shell-height': stickyShellHeight");
    expect(appSource).toContain('@height-change="setCombatCommandBarHeight"');
    expect(commandBarSource).toContain('v-if="showRuntimeSummary"');
    expect(commandBarSource).toContain(':value="runtimeProgress * 100"');
  });

  it("exposes start and stop simulation actions from the sticky bar on Home", () => {
    expect(appSource).toContain('const showHomeSimulationActions = computed(() => route.name === "home")');
    expect(appSource).toContain(':show-simulation-actions="showHomeSimulationActions"');
    expect(appSource).toContain('@start-simulation="simulator.startSimulation()"');
    expect(appSource).toContain('@stop-simulation="simulator.stopSimulation()"');
    expect(commandBarSource).toContain('v-if="showSimulationActions && !simulationRunning"');
    expect(commandBarSource).toContain('v-else-if="showSimulationActions"');
  });

  it("keeps shared patterns in the components layer and defers offscreen enhancement rows", () => {
    expect(stylesSource).toMatch(/@layer components\s*{\s*\.surface-panel/);
    expect(stylesSource).toMatch(/\.enhancement-item-row\s*{[^}]*content-visibility:\s*auto;/s);
    expect(stylesSource).toMatch(/\.enhancement-item-row\s*{[^}]*contain-intrinsic-size:\s*auto 88px;/s);
  });

  it("renders a baseline reminder before running topbar baseline", () => {
    expect(appSource).toContain(':open="baselineReminderModalOpen"');
    expect(appSource).toContain(`t('common:queue.baselineReminderTitle', 'Baseline Rounds Reminder')`);
    expect(appSource).toContain("data-baseline-reminder-acknowledge");
    expect(appSource).toContain('@click="acknowledgeBaselineReminderAndRun"');
    expect(appSource).toContain('@click="openBaselineReminderSettings"');
  });

  it("keeps feedback contact and baseline gating behavior", () => {
    expect(appSource).toContain("993488247");
    expect(appSource).toContain("mailto:596846069@qq.com");
    expect(appSource).toContain("if (!baselineReminderDismissed.value)");
    expect(appSource).toContain("dismissBaselineReminder();");
    expect(appSource).toContain("await runTopbarBaselineSimulation();");
  });

  it("confirms hourly average trade prices before adding missing-ask equipment", () => {
    expect(appSource).toContain(':open="equipmentPriceConfirmationModalOpen"');
    expect(appSource).toContain("common:queue.confirmHourlyAverageBody");
    expect(appSource).toContain("pendingEquipmentPriceConfirmations");
    expect(appSource).toContain('@click="confirmEquipmentPricesAndAdd"');
    expect(appSource).toContain("await simulator.prepareActivePlayerQueueAddition()");
    expect(appSource).toContain("common:queue.confirmPriceSlot");
    expect(appSource).toContain("formatConfirmationSlots(entry)");
  });
});

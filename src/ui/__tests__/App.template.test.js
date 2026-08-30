import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('../App.vue', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../components/AppSidebar.vue', import.meta.url), 'utf8');
const commandBarSource = readFileSync(new URL('../components/CombatCommandBar.vue', import.meta.url), 'utf8');
const routerSource = readFileSync(new URL('../router/index.js', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

describe('App shell contracts', () => {
  it('uses the responsive sidebar shell and contextual command bar', () => {
    expect(appSource).toContain('<SidebarProvider>');
    expect(appSource).toContain('<AppSidebar');
    expect(appSource).toContain('<SidebarInset');
    expect(appSource).toContain('<CombatCommandBar');
    expect(appSource).toContain('v-if="showCombatToolbar"');
    expect(appSource).toContain('route.meta?.showCombatToolbar !== false');
  });

  it('keeps routes lazy and supplies ordered navigation metadata', () => {
    for (const route of [
      'home',
      'advisor',
      'enhancement',
      'skilling',
      'queue',
      'multi-results',
      'patch-notes',
      'settings',
      'guide',
    ]) {
      expect(routerSource).toContain(`name: '${route}'`);
    }
    expect(routerSource).toContain('navLabelKey');
    expect(routerSource).toContain('navGroup');
    expect(routerSource).toContain('navOrder');
    expect(routerSource).toContain('navHidden: true');
    expect(sidebarSource).toMatch(/router\s*\.getRoutes\(\)/);
  });

  it('moves repository, feedback, patch notes, and version details into the sidebar', () => {
    expect(sidebarSource).toContain('https://github.com/azhu949/MWICombatSimulator');
    expect(sidebarSource).toContain('common:vue.app.feedback');
    expect(sidebarSource).toContain('common:patchNotes');
    expect(sidebarSource).toContain('v{{ version }}');
  });

  it('uses the dedicated patch-notes route and clears unread entries on page entry', () => {
    expect(sidebarSource).toContain('to="/patch-notes"');
    expect(sidebarSource).toContain('sidebar-unread-badge');
    expect(sidebarSource).toContain('unreadPatchNotesCount');
    expect(appSource).toContain('currentPageTitle');
    expect(appSource).toContain("nextRouteName === 'patch-notes'");
    expect(appSource).toContain('markPatchNotesReadOnPageEntry();');
  });

  it('shows an unread patch-notes preview dialog that opens only from the sidebar entry', () => {
    expect(sidebarSource).toContain('@click="handlePatchNotesClick(mobile, $event, navigate)"');
    expect(sidebarSource).toContain('event.preventDefault()');
    expect(sidebarSource).toContain('navigate(event)');
    expect(sidebarSource).toContain("emit('open-patch-notes')");
    expect(appSource).toContain('@open-patch-notes="openPatchNotesUnreadModal"');
    expect(appSource).not.toContain('nextCount > 0 && prevCount === 0');
    expect(appSource).toContain(':open="patchNotesUnreadModalOpen"');
    expect(appSource).toContain('const patchNotesUnreadPreviewEntryIds = ref([])');
    expect(appSource).toContain('const patchNotesUnreadPreviewItems = computed(() =>');
    expect(appSource).toContain('patchNotesUnreadPreviewEntryIds.value = unread.map((entry) => entry.entryId)');
    expect(appSource).toContain(
      'const previewEntryIds = patchNotesUnreadPreviewItems.value.map((entry) => entry.entryId);',
    );
    expect(appSource).not.toMatch(
      /function closePatchNotesUnreadModal\(closeReason\)[\s\S]*?const previewEntryIds = patchNotesUnreadPreviewEntryIds\.value;/,
    );
    expect(appSource).toContain('openPatchNotesUnreadModal');
    expect(appSource).toContain('markPatchNoteEntriesAsRead({');
    expect(appSource).toContain('refreshPatchNoteUnreadEntries();');
    expect(appSource).toContain('patchNotesUnreadModalOpen.value = true;');
    expect(appSource).toContain('async function viewAllPatchNotes()');
    expect(appSource).toContain("await router.push({ name: 'patch-notes' });");
    expect(appSource).toContain('data-patch-notes-view-all');
    expect(appSource).toContain('data-patch-notes-dismiss');
    expect(appSource).toContain('initial-focus-selector="[data-patch-notes-dismiss]"');
    expect(appSource).toContain('common:vue.app.patchNotesUnreadDialogDesc');
    expect(appSource).toContain(
      "t('common:vue.app.patchNotesUnreadAriaLabel', 'Patch Notes, {{count}} unread versions'",
    );
    expect(appSource).toContain('common:vue.app.patchNotesViewAll');
    expect(appSource).toContain('common:vue.app.patchNotesDismiss');
    expect(appSource).toContain("closePatchNotesUnreadModal('programmatic')");
    expect(appSource).toContain("closeReason === 'escape' || closeReason === 'backdrop'");
    expect(appSource).toContain('<PatchNoteSections :sections="entry.sections" />');
  });

  it('keeps theme and language as accessible global actions', () => {
    expect(appSource).toContain(':aria-label="themeToggleAriaLabel"');
    expect(appSource).toContain('@click="toggleTheme"');
    expect(appSource).toContain(':aria-label="languageToggleAriaLabel"');
    expect(appSource).toContain('languageToggleLabel');
    expect(appSource).toContain('common:vue.app.switchToLightTheme');
    expect(appSource).toContain('common:vue.app.switchToDarkTheme');
  });

  it('keeps queue actions and mobile overflow behavior in the command bar', () => {
    expect(commandBarSource).toContain('queueActionsDisabled || !hasBaseline || itemCount === 0 || partyMismatch');
    expect(commandBarSource).toContain('<DropdownMenuRoot>');
    expect(commandBarSource).toContain('class="2xl:hidden"');
    expect(commandBarSource).toContain('@click="emit(\'run-queue\')"');
  });

  it('keeps the command bar and live runtime progress visible below the app header', () => {
    expect(commandBarSource).toContain('sticky top-12 z-30');
    expect(commandBarSource).toContain('ref="commandBarRoot"');
    expect(commandBarSource).toContain("emit('height-change', height)");
    expect(appSource).toContain("'--app-sticky-shell-height': stickyShellHeight");
    expect(appSource).toContain('@height-change="setCombatCommandBarHeight"');
    expect(commandBarSource).toContain('v-if="showRuntimeSummary"');
    expect(commandBarSource).toContain(':value="runtimeProgress * 100"');
  });

  it('exposes start and stop simulation actions from the sticky bar on Home', () => {
    expect(appSource).toContain("const showHomeSimulationActions = computed(() => route.name === 'home')");
    expect(appSource).toContain(':show-simulation-actions="showHomeSimulationActions"');
    expect(appSource).toContain('@start-simulation="simulator.startSimulation()"');
    expect(appSource).toContain('@stop-simulation="simulator.stopSimulation()"');
    expect(commandBarSource).toContain('v-if="showSimulationActions && !simulationRunning"');
    expect(commandBarSource).toContain('v-else-if="showSimulationActions"');
  });

  it('keeps shared patterns in the components layer and defers offscreen enhancement rows', () => {
    expect(stylesSource).toMatch(/@layer components\s*{\s*\.surface-panel/);
    expect(stylesSource).toMatch(/\.enhancement-item-row\s*{[^}]*content-visibility:\s*auto;/s);
    expect(stylesSource).toMatch(/\.enhancement-item-row\s*{[^}]*contain-intrinsic-size:\s*auto 88px;/s);
  });

  it('renders a baseline reminder before running topbar baseline', () => {
    expect(appSource).toContain(':open="baselineReminderModalOpen"');
    expect(appSource).toContain(`t('common:queue.baselineReminderTitle', 'Baseline Rounds Reminder')`);
    expect(appSource).toContain('data-baseline-reminder-acknowledge');
    expect(appSource).toContain('@click="acknowledgeBaselineReminderAndRun"');
    expect(appSource).toContain('@click="openBaselineReminderSettings"');
  });

  it('keeps feedback contact and baseline gating behavior', () => {
    expect(appSource).toContain("const QQ_GROUP_NUMBER = '1102475742';");
    expect(appSource).toContain('copyFeedbackContact(QQ_GROUP_NUMBER)');
    expect(appSource).toContain("const FEEDBACK_EMAIL = '596846069@qq.com';");
    expect(appSource).toContain('mailto:${FEEDBACK_EMAIL}');
    expect(appSource).toContain('copyFeedbackContact(FEEDBACK_EMAIL)');
    expect(appSource).toContain('if (!baselineReminderDismissed.value)');
    expect(appSource).toContain('dismissBaselineReminder();');
    expect(appSource).toContain('await runTopbarBaselineSimulation();');
  });

  it('confirms official averages and historical Ask prices before adding missing-ask equipment', () => {
    expect(appSource).toContain(':open="equipmentPriceConfirmationModalOpen"');
    expect(appSource).toContain('common:queue.confirmPriceChoiceBody');
    expect(appSource).toContain('common:queue.confirmPriceChoiceTitle');
    expect(appSource).toContain('pendingEquipmentPriceConfirmations');
    expect(appSource).toContain('@click="confirmEquipmentPricesAndAdd"');
    expect(appSource).toContain('await simulator.prepareActivePlayerQueueAddition()');
    expect(appSource).toContain('common:queue.confirmPriceSourceHistoricalAsk');
    expect(appSource).toContain('if (!entry?.reference) {');
    expect(appSource).toContain('formatConfirmedMarketPrice(entry.reference.price)');
    expect(appSource).toContain('formatCompactAmountForLocale');
    expect(appSource).toContain('common:queue.confirmPriceLeft1');
    expect(appSource).toContain('common:queue.confirmPriceRight1');
    expect(appSource).toContain('common:queue.right1Unavailable');
    expect(appSource).toContain('function hasRealTargetBid(entry)');
    expect(appSource).toContain('common:queue.left1Unavailable');
    expect(appSource).toContain('function hasReferencePrice(entry)');
    expect(appSource).toContain('common:queue.confirmPriceMirrorCost');
    expect(appSource).toContain('QUEUE_PRICE_METHOD_LEFT1');
    expect(appSource).toContain('QUEUE_PRICE_METHOD_RIGHT1');
    expect(appSource).toContain('QUEUE_PRICE_METHOD_MANUAL');
    expect(appSource).toContain('QUEUE_PRICE_METHOD_MIRROR');
  });

  it('accepts a manually entered buy price for equipment without any market price', () => {
    expect(appSource).toContain('const manualPriceDrafts = ref({})');
    expect(appSource).toContain('const manualPriceErrors = ref({})');
    expect(appSource).toContain('function getManualPriceKey(entry)');
    expect(appSource).toContain('common:queue.manualPriceSource');
    expect(appSource).toContain('common:queue.manualPricePlaceholder');
    expect(appSource).toContain('common:queue.manualPriceInvalidRow');
    expect(appSource).toContain('const manualPriceUnits = ref({})');
    expect(appSource).toContain('const MANUAL_PRICE_UNITS = [');
    expect(appSource).toContain("{ value: 'k', multiplier: 1000 }");
    expect(appSource).toContain('function getManualPriceUnitMultiplier(unit)');
    expect(appSource).toContain('function sanitizeManualPriceInput(event, entry)');
    expect(appSource).toContain('inputmode="numeric"');
    expect(appSource).toContain('@input="sanitizeManualPriceInput($event, entry)"');
    expect(appSource).toContain('normalizeManualPriceDraft(');
    expect(appSource).toContain('evaluateManualPriceDraft(');
    expect(appSource).toContain('manualPriceUnits[getManualPriceKey(entry)]');
    expect(appSource).toContain('manualPriceErrors[getManualPriceKey(entry)]');
    expect(appSource).toContain('text-destructive');
    expect(appSource).toContain('common:queue.manualPriceDigitsOnly');
    expect(appSource).toContain('function handleManualPriceUnitChange(value, entry)');
    expect(appSource).toContain('role="group"');
    expect(appSource).toContain('v-for="unit in MANUAL_PRICE_UNITS"');
    expect(appSource).toContain('@click="handleManualPriceUnitChange(unit.value, entry)"');
    expect(appSource).toContain(':aria-pressed=');
  });

  it('accepts manual fill-in prices for missing mirror input pieces', () => {
    expect(appSource).toContain('computeMirrorPlan');
    expect(appSource).toContain('const mirrorInputDrafts = ref({})');
    expect(appSource).toContain('function collectMirrorManualPrices(entry)');
    expect(appSource).toContain('function getMirrorMissingLevels(entry)');
    expect(appSource).toContain('function recomputeMirrorPlan(entry)');
    expect(appSource).toContain('function sanitizeMirrorManualPriceInput(event, entry, level)');
    expect(appSource).toContain('function handleMirrorManualPriceUnitChange(value, entry, level)');
    expect(appSource).toContain('function setSharedMirrorPriceUnit(value)');
    expect(appSource).toContain('data-mirror-manual-input');
    expect(appSource).toContain('@input="sanitizeMirrorManualPriceInput($event, entry, missingItem.level)"');
    expect(appSource).toContain('v-for="(missingItem, mIndex) in getMirrorMissingLevels(entry)"');
    expect(appSource).toContain('common:queue.mirrorPlanMissingInputs');
    expect(appSource).toContain('common:queue.mirrorInputHint');
    expect(appSource).toContain('manualInputPrices: manualPrices');
    expect(appSource).toContain('v-if="manualPriceErrors[getManualPriceKey(entry)]"');
    expect(appSource).toContain('delete manualPriceErrors.value[getManualPriceKey(entry)]');
    expect(appSource).toContain('function isSharedMirrorPriceMissing()');
    expect(appSource).toContain('!isSharedMirrorPriceMissing()');
  });
});

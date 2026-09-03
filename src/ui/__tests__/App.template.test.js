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
    expect(appSource).toContain('<PlayerCardsStrip');
    expect(appSource).toContain('v-if="showCombatToolbar"');
    expect(appSource).toContain('route.meta?.showCombatToolbar !== false');
    expect(appSource).toContain('v-if="showCombatToolbar && simulator.players.length"');
  });

  it('moves the player cards (name + gear score) into the global header', () => {
    expect(appSource).toContain(':players="simulator.players"');
    expect(appSource).toContain(':active-player-id="simulator.activePlayerId"');
    expect(appSource).toContain('@select-player="simulator.setActivePlayer"');
    expect(appSource).toContain('class="min-w-0 max-w-[78%]"');
    expect(commandBarSource).not.toContain('select-player');
    expect(commandBarSource).not.toContain('v-model="player.name"');
    expect(commandBarSource).not.toContain('player.assetScore');
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

  it('exposes start and stop advisor actions and progress from the sticky bar on Advisor', () => {
    // advisor 路由顶栏契约：App.vue 绑定 showAdvisorActions 一族 computed 与
    // run/stop handler；CombatCommandBar 发射 run-advisor/stop-advisor 事件
    // 并常驻显示进度摘要行（进度条 + 百分比 + 阶段文案）。
    expect(appSource).toContain("const showAdvisorActions = computed(() => route.name === 'advisor')");
    expect(appSource).toContain(':show-advisor-actions="showAdvisorActions"');
    expect(appSource).toContain(':advisor-running="advisorRunning"');
    expect(appSource).toContain(':show-advisor-summary="showAdvisorSummary"');
    expect(appSource).toContain('@run-advisor="runAdvisorFromTopbar"');
    expect(appSource).toContain('@stop-advisor="stopAdvisorFromTopbar"');
    expect(appSource).toContain('simulator.requestAdvisorRun();');
    expect(appSource).toContain('simulator.stopAdvisorScan();');
    expect(commandBarSource).toContain("emit('run-advisor')");
    expect(commandBarSource).toContain("emit('stop-advisor')");
    expect(commandBarSource).toContain('v-if="showAdvisorSummary"');
    expect(commandBarSource).toContain(':value="advisorProgress * 100"');
    expect(commandBarSource).toContain("t('common:advisor.run'");
    expect(commandBarSource).toContain("t('common:advisor.stop'");
    expect(commandBarSource).toContain("t('common:advisor.progress'");
    // 窄屏在「运行队列」旁直出开始/停止推荐按钮，与 Home 仿真按钮同构。
    expect(commandBarSource).toContain('v-if="showAdvisorActions && !advisorRunning"');
    expect(commandBarSource).toContain('v-else-if="showAdvisorActions"');
    // 阶段文案与百分比均走共享 helper，页头状态 chips 与顶栏摘要行口径一致。
    expect(appSource).toContain(
      "import { buildAdvisorProgressPercent, buildAdvisorRuntimePhaseText } from './advisorRuntimePresentation.js';",
    );
    expect(appSource).toContain(
      'const advisorPhaseText = computed(() => buildAdvisorRuntimePhaseText(simulator.advisor.runtime || {}, t));',
    );
    expect(appSource).toContain(
      'const advisorProgressText = computed(() => `${buildAdvisorProgressPercent(simulator.advisor.runtime)}%`);',
    );
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
    expect(appSource).toContain('function getMirrorTotalCost(entry)');
    expect(appSource).toContain('function getMirrorPrimaryCost(entry)');
    expect(appSource).toContain('function getMirrorBreakdownText(entry)');
    expect(appSource).toContain('common:queue.mirrorTotalBreakdown');
    expect(appSource).toContain('function getMirrorTotalCostTooltip(entry)');
    // 无顶替（跨物品换装）时 tooltip 必须返回 null 而非渲染残缺的基准件文案。
    expect(appSource).toMatch(
      /function getMirrorTotalCostTooltip\(entry\) \{\s*if \(!isMirrorBaselineSubstituted\(entry\)\) \{\s*return null;/,
    );
    expect(appSource).toContain('price: mirrorCost + baselinePieceSaleValue');
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
    expect(appSource).toContain('function sanitizeMirrorManualPriceInput(event, entry, missingItem)');
    expect(appSource).toContain('function handleMirrorManualPriceUnitChange(value, entry, missingItem)');
    expect(appSource).toContain('function setSharedMirrorPriceUnit(value)');
    expect(appSource).toContain('data-mirror-manual-input');
    expect(appSource).toContain('@input="sanitizeMirrorManualPriceInput($event, entry, missingItem)"');
    expect(appSource).toContain('v-for="(missingItem, mIndex) in getMirrorMissingLevels(entry)"');
    expect(appSource).toContain('common:queue.mirrorPlanMissingInputs');
    expect(appSource).toContain('common:queue.mirrorInputHint');
    expect(appSource).toContain('manualInputPrices: manualPrices');
    expect(appSource).toContain('v-if="manualPriceErrors[getManualPriceKey(entry)]"');
    expect(appSource).toContain('delete manualPriceErrors.value[getManualPriceKey(entry)]');
    expect(appSource).toContain('function isSharedMirrorPriceMissing()');
    expect(appSource).toContain('!isSharedMirrorPriceMissing()');
    // 价格域感知（精炼目标修复）：补价草稿与标签按 "itemHrid|level" 区分基础/精炼物品，
    // 跨域缺价件显示物品名，防止用户把精炼物品价格误填到基础物品输入上。
    expect(appSource).toContain('function getMirrorInputDraftKey(missingItem)');
    expect(appSource).toContain('function formatMirrorMissingLevelToken(entry, missingItem)');
    expect(appSource).toContain('function formatMirrorInputMissingLevel(entry, missingItem)');
    expect(appSource).toContain('common:queue.mirrorInputMissingItem');
    expect(appSource).toContain('common:queue.mirrorInputMissingItemNoCount');
    expect(appSource).toContain(':data-mirror-item="missingItem.itemHrid"');
    expect(appSource).toContain('missingItem.itemHrid || entry.itemHrid');
  });

  it('keeps the price confirmation modal open with an in-modal error banner on confirm failure', () => {
    expect(appSource).toContain("const equipmentPriceConfirmationError = ref('')");
    expect(appSource).toContain('v-if="equipmentPriceConfirmationError"');
    expect(appSource).toContain('equipmentPriceConfirmationError.value = resolveQueueActionErrorMessage(error)');
    // 仅草稿指纹失效（行数据已过期）才关闭弹窗；其余失败保留弹窗与全部行的选择/补价草稿。
    expect(appSource).toContain('QUEUE_DRAFT_CHANGED_MESSAGE_KEY');
    expect(appSource).not.toMatch(
      /} catch \(error\) \{\s*cancelEquipmentPriceConfirmation\(\);\s*setTopQueueActionStatus/,
    );
  });

  it('drives asset score refresh from a signature computed instead of a deep watch', () => {
    expect(appSource).toContain("import { computeAssetScoreConfigSignature } from '../services/assetScoreService.js';");
    expect(appSource).toContain('const assetScoreRefreshTrigger = computed(() => [');
    expect(appSource).toContain('simulator.players.map((player) => computeAssetScoreConfigSignature(player))');
    expect(appSource).toContain('simulator.pricing?.marketItemValues ?? null');
    expect(appSource).toContain('simulator.pricing?.marketItemValueSources ?? null');
    // 【一般-5】等级级来源覆盖在触发向量内（整体替换引用、浅跟踪）。
    expect(appSource).toContain('simulator.pricing?.marketItemValueSourcesByLevel ?? null');
    expect(appSource).toContain('simulator.pricing?.basePriceTable ?? simulator.pricing?.priceTable ?? null');
    expect(appSource).toContain('simulator.pricing?.enhancementQuotesByItem ?? null');
    expect(appSource).toContain('simulator.pricing?.lastFetchedAt ?? 0');
    expect(appSource).toContain('watch(assetScoreRefreshTrigger, () => {');
    expect(appSource).toContain('simulator.refreshAssetScores();');
    expect(appSource).toContain('}, 250);');
    // App.vue 当前唯一 deep: true 即旧资产分触发器；拆除后不应再现（若未来新增
    // 合理的 deep watch，应把本断言改为块级定位而非全局负断言）。
    expect(appSource).not.toContain('deep: true');
  });
});

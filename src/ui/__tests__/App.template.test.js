import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('../App.vue', import.meta.url), 'utf8');
const sidebarSource = readFileSync(new URL('../components/AppSidebar.vue', import.meta.url), 'utf8');
const commandBarSource = readFileSync(new URL('../components/CombatCommandBar.vue', import.meta.url), 'utf8');
const routerSource = readFileSync(new URL('../router/index.js', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

// 铁牛模式源 watcher 的定向契约（2026-10-19）：替代原 `not.toContain('watch(isIroncowMode,')`
// 全局字面负断言——后者只拦「单行 hug」一种书写形态，getter 形态（() => isIroncowMode.value）
// 与带 options / async 回调的折行形态都能绕过，且会一并拒绝以模式为源的其它自然 watcher
//（清理定时器、关闭其它弹窗、埋点）。这里收窄为「模式源 watcher 块内不得出现完成弹窗清扫」：
// 允许自然写法，继续禁止「模式切换 → 清扫完成弹窗」的补偿回补（删除依据：关闭分支经
// 遮罩+单向锁+抑制条件三重堵截不可达，见 App.vue 完成通知 watch 注释）。
const ironcowSourcedWatchPattern = /watch\(\s*(?:\(\s*\)\s*=>\s*)?isIroncowMode(?:\.value)?\s*,/g;
function expectNoIroncowWatchClearsCompletionDialog(source) {
  const matches = [...source.matchAll(ironcowSourcedWatchPattern)];
  matches.forEach((match, index) => {
    // 切片到本 watch 调用结尾与下一个模式源 watch 起点中的较近者（后者兜底防跨块）。
    const callEnd = source.indexOf('});', match.index);
    const nextStart = matches[index + 1]?.index ?? source.length;
    const blockEnd = Math.min(callEnd === -1 ? source.length : callEnd + 3, nextStart);
    const block = source.slice(match.index, blockEnd);
    expect(block).not.toContain('closeSimulationCompleteModal');
    expect(block).not.toContain('simulationCompleteModalOpen');
  });
}

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

  it('exposes the main-site import script status marker on the sidebar entry', () => {
    // 侧栏脚本状态行的状态值经该属性外露（模板测试锚定它不被改名，行为判定见
    // useMainSiteImportScriptStatus 的单测）。
    expect(sidebarSource).toContain('data-import-script-status');
  });

  it('asks for an update channel instead of jumping directly when an update is available', () => {
    // 任意状态（未安装 / 已最新 / 待更新 / 旧版）都可能需要选择来源，必须由用户选渠道
    // （弹窗行为见 ImportScriptChannelDialog 的单测），状态行不再直链下载。
    expect(sidebarSource).toContain('ImportScriptChannelDialog');
    expect(sidebarSource).toContain('MAIN_SITE_IMPORT_SCRIPT_CHANNELS');
    expect(sidebarSource).toContain('importScriptNeedsChannelChoice');
    expect(sidebarSource).toContain("'aria-haspopup': 'dialog'");
    expect(sidebarSource).toContain('data-import-script-action');
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

  it('keeps the global game mode switch (standard / ironcow) accessible from the header', () => {
    // 顶栏模式切换契约：显示当前模式名、点击切到另一模式、铁牛态主色提示；
    // 状态与持久化由 store 承载（setGameMode → mwi.gameMode.v1）。
    expect(appSource).toContain("import { GAME_MODE_IRONCOW, GAME_MODE_STANDARD } from '../services/gameMode.js';");
    expect(appSource).toContain('const isIroncowMode = computed(() => simulator.gameMode === GAME_MODE_IRONCOW);');
    expect(appSource).toContain('data-game-mode-toggle');
    expect(appSource).toContain(':aria-label="gameModeToggleAriaLabel"');
    expect(appSource).toContain('@click="toggleGameMode"');
    expect(appSource).toContain('{{ gameModeLabel }}');
    expect(appSource).toContain("isIroncowMode ? 'text-primary' : ''");
    // 顶栏模式按钮的成对自定义图标（沿用 lucide 风格的 2px 圆头描边）：铁牛 → 牛头，
    // 标准 → 天平；以 data-game-mode-icon 区分两种模式。
    expect(appSource).toContain('data-game-mode-icon="ironcow"');
    expect(appSource).toContain('data-game-mode-icon="standard"');
    expect(appSource).toContain('simulator.setGameMode(isIroncowMode.value ? GAME_MODE_STANDARD : GAME_MODE_IRONCOW);');
    expect(appSource).toContain('common:vue.app.gameModeStandard');
    expect(appSource).toContain('common:vue.app.gameModeIroncow');
    expect(appSource).toContain('common:vue.app.switchToStandardMode');
    expect(appSource).toContain('common:vue.app.switchToIroncowMode');
    // 运行中切往铁牛的单向锁定：按钮以 gameModeSwitchLocked 禁用；判定必须保留
    // !isIroncowMode 方向门（只锁标准 → 铁牛，防止把用户锁死在铁牛态）。
    expect(appSource).toContain(':disabled="gameModeSwitchLocked"');
    // 判定表达式（prettier 折行，按块级定位断言）：方向门（!isIroncowMode）保留 +
    // 响应式版忙碌清单 + 计算器运行态响应式锚点（跨 store 桥接，见下）。
    const lockedComputedIndex = appSource.indexOf('const gameModeSwitchLocked = computed(');
    expect(lockedComputedIndex).toBeGreaterThanOrEqual(0);
    const lockedComputedBlock = appSource.slice(lockedComputedIndex, appSource.indexOf(');', lockedComputedIndex));
    expect(lockedComputedBlock).toContain('!isIroncowMode.value');
    expect(lockedComputedBlock).toContain('isReactiveSimulationBusy(simulator)');
    // 启动准备窗口（动态导入 playerMapper，isRunning 尚未置位）：直读 runtime.preparing，
    // 窗口内同样真实禁用按钮。
    expect(lockedComputedBlock).toContain('simulator.runtime?.preparing');
    expect(lockedComputedBlock).toContain('dungeonCalculatorRunInFlight.value');
    // 触发器优化器子运行窗口（2026-10-17 登记）：换难度复核 / 追加复验 / 服务收尾只写
    // runtime 子状态，不在统一忙碌清单内 —— 顶栏计算式必须直读三个子状态收口。
    expect(lockedComputedBlock).toContain('robustness?.isRunning');
    expect(lockedComputedBlock).toContain('verifyAppend?.isRunning');
    expect(lockedComputedBlock).toContain('triggerOptimizer?.runtime?.serviceRunInFlight');
    // 预算优化停止收尾窗口（2026-10-19 登记）：与 trigger 同名字段分属两个 runtime 切片，
    // 必须显式断言全路径，防止后人只保留 generic 'serviceRunInFlight' 断言而误删其一。
    expect(lockedComputedBlock).toContain('budgetOptimizer?.runtime?.serviceRunInFlight');
    expect(appSource).toContain('if (gameModeSwitchLocked.value) {');
    expect(appSource).toContain('common:vue.app.gameModeSwitchLocked');
    expect(appSource).not.toContain(
      'const gameModeSwitchLocked = computed(() => isReactiveSimulationBusy(simulator));',
    );
    expect(appSource).not.toContain(
      'const gameModeSwitchLocked = computed(() => !isIroncowMode.value && isReactiveSimulationBusy(simulator));',
    );
    // 点击时刻非响应式完整兜底（拦截预算优化注册表收尾等纯模块级窗口）及其配套 import
    // 的源码契约：运行冲突模块 import 已并入计算器运行态锚点（锚点不许并入统一忙碌
    // 判定，只由顶栏按钮消费）；import 行随 prettier 折行，按模块路径尾行向前窗口定位。
    const runConflictsImportIndex = appSource.indexOf("from '../services/simulatorRunConflicts.js';");
    expect(runConflictsImportIndex).toBeGreaterThanOrEqual(0);
    const runConflictsImportHead = appSource.slice(Math.max(0, runConflictsImportIndex - 220), runConflictsImportIndex);
    expect(runConflictsImportHead).toContain('dungeonCalculatorRunInFlight');
    expect(runConflictsImportHead).toContain('isSimulationBusy');
    expect(runConflictsImportHead).toContain('isReactiveSimulationBusy');
    expect(appSource).toContain('if (!isIroncowMode.value && isSimulationBusy(simulator)) {');
    // 兜底拦截分支的用户可见提示（响应式锚点之外残余窗口的「点击静默」缺口修复）：
    // 块级定位 toggleGameMode，提示走既有状态条通道 + 既有锁定文案键，不得返回静默。
    const toggleGameModeIndex = appSource.indexOf('function toggleGameMode() {');
    expect(toggleGameModeIndex).toBeGreaterThanOrEqual(0);
    const toggleGameModeBlock = appSource.slice(toggleGameModeIndex, appSource.indexOf('\n}', toggleGameModeIndex));
    expect(toggleGameModeBlock).toContain('setTopQueueActionStatus(');
    expect(toggleGameModeBlock).toContain("t('common:vue.app.gameModeSwitchLocked'");
    expect(toggleGameModeBlock).toContain("'warning',");
    // 启动准备窗口的点击兜底（disabled 之外的同步求值路径）：与 disabled 同源判定。
    expect(toggleGameModeBlock).toContain('simulator.runtime?.preparing');
    // 触发器优化器运行注册表（两版统一清单外）的兜底接线与其配套 import（2026-10-17 登记）：
    // 兜底必须保留方向门并列判定、复用既有提示通道，防止后人改回无兜底形态。
    expect(appSource).toContain(
      "import { hasTriggerOptimizerRunInProgress } from '../services/triggerOptimizerRunRegistry.js';",
    );
    expect(toggleGameModeBlock).toContain('if (!isIroncowMode.value && hasTriggerOptimizerRunInProgress()) {');
  });

  it('renders an empty placeholder instead of pages while in ironcow mode', () => {
    // 铁牛模式空态契约：模拟器功能尚未开发——主内容区替换为极简占位（仅补丁说明页
    // 例外）；战斗工具栏与市场价指示器隐藏；侧边栏分组导航整体不渲染，只保留
    // 底部三个通用入口（补丁说明 / GitHub / 反馈）。
    expect(appSource).toContain(
      'const showCombatToolbar = computed(() => !isIroncowMode.value && route.meta?.showCombatToolbar !== false);',
    );
    expect(appSource).toContain("isIroncowMode && route.name !== 'patch-notes'");
    expect(appSource).toContain('data-ironcow-placeholder');
    expect(appSource).toContain('common:vue.app.ironcowInProgress');
    expect(appSource).toContain('common:vue.app.ironcowJoinGroup');
    expect(appSource).toContain('FALLBACK_IRONCOW_JOIN_GROUP');
    expect(appSource).toContain('<MarketPriceIndicator v-if="!isIroncowMode" />');
    expect(appSource).toContain(':ironcow-mode="isIroncowMode"');
    expect(sidebarSource).toContain('ironcowMode: { type: Boolean, default: false }');
    expect(sidebarSource).toContain('v-if="!ironcowMode && collapsed"');
    expect(sidebarSource).toContain('v-if="!ironcowMode && !collapsed"');
  });

  it('suppresses the simulation complete dialog in ironcow mode without a switch-cleanup watcher', () => {
    // 铁牛模式完成弹窗契约：完成通知 watch 追加 isIroncowMode 抑制（铁牛态下引导
    // 按钮必然落空）。切入铁牛的完成弹窗清扫 watcher 已删除，不得回补（删除依据：
    // 关闭分支经遮罩+单向锁+抑制条件三重堵截不可达，详见 App.vue 注释）；本用例的
    // 定向断言只禁止「模式源 + 完成弹窗清扫」组合，不禁止以模式为源的其它自然
    // watcher（清理定时器、关闭其它弹窗、埋点）。
    expect(appSource).toContain(
      "if (nextId <= prevId || !hasSimulationResults.value || route.name === 'home' || isIroncowMode.value) {",
    );
    expectNoIroncowWatchClearsCompletionDialog(appSource);
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
    expect(appSource).toContain(`t('common:queue.baselineReminderTitle', 'Rounds Reminder')`);
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
    expect(appSource).toContain(
      "import { computeAssetScoreConfigSignature } from '../services/assetScorePresentation.js';",
    );
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
    // 候选 A（2026-10-03）：刷新链路按需加载（异步）——防抖回调与 onMounted 初算
    // 均以 void + catch 降级并 console.warn 留痕（加载失败不弹全局错误窗、不打断
    // 回调）；空 catch 静默吞错已被替换，不得回归。
    expect(appSource).toContain("console.warn('[assetScore] refresh failed (debounced trigger):', error);");
    expect(appSource).toContain("console.warn('[assetScore] refresh failed (onMounted):', error);");
    expect(appSource).not.toContain('void simulator.refreshAssetScores().catch(() => {});');
    expect(appSource).toContain('}, 250);');
    // App.vue 当前唯一 deep: true 即旧资产分触发器；拆除后不应再现（若未来新增
    // 合理的 deep watch，应把本断言改为块级定位而非全局负断言）。
    expect(appSource).not.toContain('deep: true');
  });

  it('gates the ironcow-mode startup market fetch and asset score chain behind the game mode', () => {
    // 铁牛态启动门控（本条目）：铁牛语义禁用玩家市场（见 services/gameMode.js 自述），
    // 且铁牛态无行情/资产分消费方（主内容区占位、市场价指示器、顶栏资产分徽章与
    // 导入导出下拉均不挂载）——启动链路整体跳过，切回标准态由触发向量补一次重算。
    // (1) 延迟初始化：行情强制拉取门控；升级参考数据（本地 bundle 参考数据 + 队列
    //     结果刷新，无网络请求）保持不门控。
    expect(appSource).toMatch(
      /if \(!isIroncowMode\.value\) \{\n\s*simulator\.ensureMarketPricesLoaded\(true\);\n\s*\}/,
    );
    expect(appSource).toContain('simulator.ensureAbilityUpgradeReferenceDataLoaded();');
    // (2) onMounted 初算同门控；降级告警文本保持原样（不得回退为空 catch）。
    expect(appSource).toMatch(
      /if \(!isIroncowMode\.value\) \{\n\s*void simulator\.refreshAssetScores\(\)\.catch\(\(error\) => \{\n\s*console\.warn\('\[assetScore\] refresh failed \(onMounted\):', error\);\n\s*\}\);\n\s*\}/,
    );
    // (3) 防抖清理先于铁牛态提前返回：标准 → 铁牛 时必须取消已排程的定时器（否则
    //     残留回调仍会触发全量资产分重算）；铁牛态同时不得排新的定时器。切片终点取
    //     setTimeout 排程点，避免 indexOf 误命中 onUnmounted 的同形清理块。
    const watchStart = appSource.indexOf('watch(assetScoreRefreshTrigger, () => {');
    expect(watchStart).toBeGreaterThanOrEqual(0);
    const scheduleStart = appSource.indexOf('assetScoreRefreshTimer = setTimeout(', watchStart);
    expect(scheduleStart).toBeGreaterThan(watchStart);
    const watchHead = appSource.slice(watchStart, scheduleStart);
    const cleanupIndex = watchHead.indexOf('if (assetScoreRefreshTimer != null) {');
    const ironcowGateIndex = watchHead.indexOf('if (isIroncowMode.value) {');
    expect(cleanupIndex).toBeGreaterThanOrEqual(0);
    expect(ironcowGateIndex).toBeGreaterThan(cleanupIndex);
    expect(watchHead).toContain('clearTimeout(assetScoreRefreshTimer);');
    expect(watchHead).toContain('assetScoreRefreshTimer = null;');
    expect(watchHead).toContain('return;');
    // (4) 触发向量新增模式依赖：模式是资产分可见性条件，切回标准态触发一次重算；
    //     实现口径为触发向量依赖项（isIroncowMode.value,），不另挂模式源 watch。
    const triggerStart = appSource.indexOf('const assetScoreRefreshTrigger = computed(() => [');
    const triggerEnd = appSource.indexOf('\n]);', triggerStart);
    expect(triggerStart).toBeGreaterThanOrEqual(0);
    expect(triggerEnd).toBeGreaterThan(triggerStart);
    expect(appSource.slice(triggerStart, triggerEnd)).toContain('isIroncowMode.value,');
    // (5) 切回补偿：启动被门控跳过的行情强制拉取由「铁牛 → 标准」方向的 gameMode
    //     getter watch 补拉（watcher 不使用 deep / immediate）。块级定位锁定：方向门
    //     与强制拉取共现于同一 watcher。
    //     （先做空白规范化以抗 Prettier 对 watch( 的折行变形；锚点对单行/折行两种
    //     形态均成立。）
    const normalizedAppSource = appSource.replace(/\s+/g, ' ');
    const gameModeWatchIndex = normalizedAppSource.indexOf('() => simulator.gameMode, (nextMode, prevMode) => {');
    expect(gameModeWatchIndex).toBeGreaterThanOrEqual(0);
    const gameModeWatchEnd = normalizedAppSource.indexOf('});', gameModeWatchIndex);
    expect(gameModeWatchEnd).toBeGreaterThan(gameModeWatchIndex);
    const gameModeWatchBlock = normalizedAppSource.slice(gameModeWatchIndex, gameModeWatchEnd);
    expect(gameModeWatchBlock).toContain('GAME_MODE_IRONCOW');
    expect(gameModeWatchBlock).toContain('GAME_MODE_STANDARD');
    expect(gameModeWatchBlock).toContain('simulator.ensureMarketPricesLoaded(true)');
    // (6) 切回补偿的 60s 尝试冷却（2026-10-19）：补偿前复用
    //     wasMarketPriceRefreshAttemptedRecently（与队列准备同源判定）——
    //     运行态闸门只锁「标准 → 铁牛」，切回方向不受约束：冷却判定必须与
    //     强制拉取共现于同一 watcher 块内，防空载往复切换持续打接口。
    expect(appSource).toContain(
      "import { wasMarketPriceRefreshAttemptedRecently } from '../stores/simulatorPricingActions.js';",
    );
    expect(gameModeWatchBlock).toContain('wasMarketPriceRefreshAttemptedRecently(simulator)');
    expectNoIroncowWatchClearsCompletionDialog(appSource);
  });
});

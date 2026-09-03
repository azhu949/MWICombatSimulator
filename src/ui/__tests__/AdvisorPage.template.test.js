import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(new URL('../pages/AdvisorPage.vue', import.meta.url), 'utf8');

describe('AdvisorPage iron-cow surface', () => {
  it('registers the iron-cow preset and shows its dedicated weight inputs', () => {
    expect(pageSource).toContain('ADVISOR_GOAL_PRESET_IRONCOW,');
    expect(pageSource).toContain("t('common:advisor.presetIroncow', 'Iron Cow')");
    expect(pageSource).toContain(
      'const isIroncowGoal = computed(() => simulator.advisor.goalPreset === ADVISOR_GOAL_PRESET_IRONCOW)',
    );
    expect(pageSource).toContain('ironcowInputFields');
    expect(pageSource).toContain('ironcowWeightDraft');
    // 展示有效权重必须走三参形式（铁牛下读取用户调整值）。
    expect(pageSource).toMatch(
      /resolveAdvisorWeights\(\s*simulator\.advisor\.goalPreset,\s*simulator\.advisor\.customWeights,\s*simulator\.advisor\.ironcowWeights,?\s*\)/,
    );
  });

  it('applies iron-cow weights only when the three weights sum to 1', () => {
    // 容差常量从服务层导入复用（单一事实源），禁止本地复制字面量漂移。
    expect(pageSource).toMatch(
      /import \{[^}]*ADVISOR_IRONCOW_WEIGHT_SUM_TOLERANCE[^}]*\} from '\.\.\/\.\.\/services\/advisorScoring\.js';/,
    );
    expect(pageSource).not.toContain('const ADVISOR_IRONCOW_WEIGHT_SUM_TOLERANCE');
    expect(pageSource).toContain('ironcowWeightSumValid');
    expect(pageSource).toContain("t('common:advisor.weightSumLabel', 'Weight sum')");
    expect(pageSource).toContain("t('common:advisor.weightSumError', 'The three weights must sum to 1')");
    expect(pageSource).toMatch(
      /Math\.abs\(dropsPerHour \+ xpPerHour \+ safety - 1\) > ADVISOR_IRONCOW_WEIGHT_SUM_TOLERANCE[\s\S]{0,40}return;/,
    );
    expect(pageSource).toContain(
      'goalPreset: ADVISOR_GOAL_PRESET_IRONCOW,\n    ironcowWeights: { dropsPerHour, xpPerHour, safety },',
    );
    // 实时校验与应用共用 normalizeIroncowDraftWeight（roundTo(·,2)+非负截断）
    // 口径：红字报错 ⇔ apply 拒绝，消除「校验通过却静默不生效」的窗口
    //（2026-09-03 修复：0.334/0.333/0.333 原始和 1.000 通过校验、取整和 0.99
    // 被 apply 静默拒绝；反向 0.351/0.35/0.301 红字报错却实际生效）。
    expect(pageSource).toMatch(
      /const ironcowWeightSum = computed\(\s*\(\) =>\s*normalizeIroncowDraftWeight\(ironcowWeightDraft\.dropsPerHour\) \+/,
    );
    expect(
      (pageSource.match(/normalizeIroncowDraftWeight\(ironcowWeightDraft\./g) ?? []).length,
    ).toBeGreaterThanOrEqual(6);
    // 状态行在非法时以 text-destructive 红色报错。
    expect(pageSource).toContain('v-if="!ironcowWeightSumValid"');
    expect(pageSource).toContain('font-medium text-destructive');
  });

  it('renders a searchable multi-select panel for target drop items', () => {
    expect(pageSource).toContain('buildAdvisorDropItemOptions');
    expect(pageSource).toContain('data-advisor-drop-items');
    // 目标掉落物品是铁牛模式的主角配置：独立全宽面板（跨两列），
    // 不再嵌在扫描设置面板尾部。
    expect(pageSource).toContain('class="rounded-md border border-border bg-muted/40 p-4 lg:col-span-2"');
    expect(pageSource).toContain("t('common:advisor.dropItemsTitle', 'Target drop items')");
    expect(pageSource).toContain("t('common:advisor.dropItemsSearchPlaceholder', 'Search item name or HRID')");
    expect(pageSource).toContain('dropItemSearchQuery');
    expect(pageSource).toContain('filteredDropItemEntries');
    // 候选列表为自适应多列卡片网格，选中行整卡高亮（checkbox 视觉隐藏保留键盘可达）。
    expect(pageSource).toContain('grid max-h-72 grid-cols-1 gap-1.5 overflow-y-auto');
    expect(pageSource).toContain('sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4');
    expect(pageSource).toContain('class="sr-only"');
    // sr-only checkbox 是绝对定位：卡片 label 必须 relative 作为包含块，
    // 否则 input 以网格滚动内容的静态位置布局，会把文档撑高 ~2700px 空白，
    // 且点击聚焦时页面跳滚到文档底部（2026-09-03 实测 bug）。
    expect(pageSource).toContain('class="flex relative min-h-9 cursor-pointer');
    expect(pageSource).toContain(
      "t('common:advisor.dropItemsSelectedCount', 'Selected {selected} / {total} in scope', {",
    );
    expect(pageSource).toContain("t('common:advisor.dropItemsClear', 'Clear')");
    expect(pageSource).toContain('clearSelectedDropItems');
    expect(pageSource).toContain(
      "t('common:advisor.dropItemOutOfRange', 'This item is outside the current scan scope')",
    );
    expect(pageSource).toContain("t('common:advisor.dropItemsEmpty', 'No matching items.')");
    // 选择写入草稿并经 store 动作持久化，但不自动扫描。必须提交整份 filterDraft
    // （与 runAdvisor 同形态）：updateAdvisorFilters 以「旧 store filters + patch」
    // 整体替换后，页面深度 watch 会回声 syncFilterDraft——只传 dropItemHrids 补丁
    // 会把用户未提交的范围/轮数草稿编辑静默回滚（solo 弹回 off → 划线 chip → NO_TARGETS）。
    expect(pageSource).toContain('filterDraft.dropItemHrids = [...cleanHrids];');
    // 区域限定锁定新调用在 applyDropItemSelection 内（runAdvisor 也有同串调用），
    // 并断言旧的部分补丁调用形态已全局消失。
    expect(pageSource).toMatch(
      /function applyDropItemSelection\(nextHrids\) \{[\s\S]{0,900}?simulator\.updateAdvisorFilters\(\{ \.\.\.filterDraft \}\);/,
    );
    expect(pageSource).not.toContain('simulator.updateAdvisorFilters({ dropItemHrids: [...cleanHrids] });');
    // 官方图标 sprite + 本地化名称。
    expect(pageSource).toContain('ensureItemIconSymbols');
    expect(pageSource).toContain('dropItemIconVisible(entry.itemHrid)');
    expect(pageSource).toContain('itemIconHref(entry.itemHrid)');
  });

  it('locks drop-item editing while scanning and gates edits behind clearing results', () => {
    // 运行中：候选卡片/已选 chips/清空按钮全部禁用（指针与键盘都不可达）。
    expect(pageSource).toContain('pointer-events-none cursor-not-allowed opacity-60');
    expect(pageSource.match(/:disabled="isRunning"/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    // 页面门与 store updateAdvisorFilters 守卫同口径（isRunning || scanInFlight）：
    // 防首扫动态导入窗口/停止后收尾期间「页面放行、store 拒绝」导致勾选态闪烁。
    expect(pageSource).toMatch(
      /function requestDropItemSelection\(cleanHrids\) \{[\s\S]{0,600}?isRunning\.value \|\| runtime\.value\?\.scanInFlight/,
    );
    // 已有结果：不再直接放行修改，而是挂起本次修改并弹窗提醒清空结果。
    expect(pageSource).toContain('const advisorHasResults = computed(() => displayRows.value.length > 0);');
    expect(pageSource).toContain('pendingDropItemSelection = [...cleanHrids];');
    expect(pageSource).toContain('dropItemsResultsDialogOpen.value = true;');
    // 确认：清空结果并应用挂起的修改；取消（X / Esc / 遮罩 / 按钮）：丢弃修改。
    expect(pageSource).toContain('simulator.clearAdvisorResults();');
    expect(pageSource).toContain('function confirmClearAdvisorResultsForDropItems');
    expect(pageSource).toContain('function cancelDropItemsResultsDialog');
    // 拒绝变更时回滚 checkbox 的 DOM 勾选态（否则视觉与数据不一致）。
    expect(pageSource).toContain('event.target.checked = isDropItemSelected(itemHrid);');
    // 弹窗本体（BaseModal）与确认按钮。
    expect(pageSource).toContain('<BaseModal');
    expect(pageSource).toContain('data-advisor-drop-items-results-confirm');
    expect(pageSource).toContain("t('common:advisor.dropItemsResultsTitle', 'Scan results exist')");
    expect(pageSource).toContain("'common:advisor.dropItemsResultsBody',");
    expect(pageSource).toContain("'You already have scan results. Clear them before changing target drop items.',");
    expect(pageSource).toContain("'common:advisor.dropItemsResultsHint',");
  });

  it('locks goal preset, weight, and filter inputs while scanning', () => {
    // persist:false 流式优化的前提是「扫描期间设置不可变」：除掉落物品面板外，
    // 预设按钮、铁牛/自定义权重、筛选复选框与轮数输入在运行中也必须禁用，
    // 否则运行中的 rerank（persist 默认 true）会与扫描开始的快照排名口径
    // 分裂、dropDataStale 误报，并打破「每次扫描恰好 2 次落盘」。
    expect(pageSource).toMatch(/:disabled="isRunning"\s+@click="setPreset\(preset\.value\)"/);
    expect(pageSource).toContain("isRunning ? 'cursor-not-allowed opacity-60' : '',");
    expect(pageSource).toContain(':disabled="isRunning || !isCustomGoal"');
    expect(pageSource).toMatch(
      /:disabled="isRunning"\s+@input="\(event\) => onIroncowWeightInput\(weight\.key, event\)"/,
    );
    for (const filterKey of ['includeSoloZones', 'includeGroupZones', 'refineTopEnabled']) {
      expect(pageSource).toMatch(
        new RegExp(`v-model="filterDraft\\.${filterKey}"[\\s\\S]{0,120}:disabled="isRunning"`),
      );
    }
    for (const fieldId of ['advisor-refine-count', 'advisor-refine-rounds', 'advisor-quick-rounds']) {
      expect(pageSource).toMatch(new RegExp(`id="${fieldId}"[\\s\\S]{0,160}:disabled="isRunning"`));
    }
    // 处理函数兜底拦截：与 requestDropItemSelection 同款防御，防程序化触发绕过禁用。
    expect(pageSource).toMatch(
      /function setPreset\(preset\) \{[\s\S]{0,200}?if \(isRunning\.value\) \{\s*return;\s*\}/,
    );
    expect(pageSource).toMatch(
      /function applyCustomWeights\(\) \{[\s\S]{0,200}?if \(isRunning\.value\) \{\s*return;\s*\}/,
    );
    expect(pageSource).toMatch(
      /function applyIroncowWeights\(\) \{[\s\S]{0,200}?if \(isRunning\.value\) \{\s*return;\s*\}/,
    );
  });

  it('sorts every result column on click and resets on a new scan', () => {
    expect(pageSource).toContain("const sortState = ref({ key: '', direction: 'desc' })");
    for (const columnKey of [
      'rank',
      'type',
      'target',
      'difficulty',
      'profitPerHour',
      'dropsPerHour',
      'xpPerHour',
      'killsPerHour',
      'deathsPerHour',
      'finalScore',
    ]) {
      expect(pageSource).toContain(`@click="toggleAdvisorSort('${columnKey}')"`);
      expect(pageSource).toContain(`advisorSortIndicator('${columnKey}')`);
    }
    expect(pageSource).toContain('v-for="row in sortedRows"');
    expect(pageSource).toContain("direction: sortState.value.direction === 'desc' ? 'asc' : 'desc'");
    expect(pageSource).toContain('resetAdvisorSort();');
    expect(pageSource).toContain('cursor-pointer select-none px-2 py-3');
  });

  it('adds the drops-per-hour column with a per-item tooltip only in iron-cow mode', () => {
    expect(pageSource).toContain('v-if="isIroncowGoal"\n              class="cursor-pointer select-none px-2 py-3"');
    expect(pageSource).toContain('{{ formatDropRate(row.dropsPerHour) }}');
    expect(pageSource).toContain(':title="getDropsCellTitle(row)"');
    expect(pageSource).toContain('getDropsCellTitle');
    expect(pageSource).toContain('Number(row.dropsPerHour) === maxAdvisorRowMetrics.dropsPerHour');
    expect(pageSource).toContain('dropRatesByItem');
  });

  it('formats tiny non-zero drop rates with significant digits instead of rounding them to 0.0', () => {
    // 极低速率（boss 专属/负掉率开门物品，如高级魔法护符 ~0.0004/h）曾因
    // formatMetric 的 2 位小数上限被显示成 "0.0"，与真 0 无法区分。
    // formatDropRate 对 0 < 值 < 0.01 改用 2 位有效数字，三处消费点
    // （结果表格单元格、掉落最佳卡片、分物品悬浮提示）必须全部走它。
    expect(pageSource).toContain('function formatDropRate(value)');
    expect(pageSource).toContain('maximumSignificantDigits: 2');
    expect(pageSource).toContain('formatDropRate(row.dropsPerHour)');
    expect(pageSource).toContain('formatDropRate(card.row.dropsPerHour)');
    expect(pageSource).toContain('${getItemName(itemHrid, itemHrid)}: ${formatDropRate(rate)}/h');
  });

  it('renders a drop-items column with positive-rate badges only in iron-cow mode', () => {
    // 「掉落物品」列：与「掉落/h」一样仅铁牛模式渲染，展示该行实际有掉落
    //（rate > 0）的目标物品徽章（官方图标 + 本地化名称 + 各自速率），
    // 无掉落的行显示占位符，不与真 0 混淆。
    expect(pageSource).toContain('<TableHead v-if="isIroncowGoal" class="px-2 py-3">');
    expect(pageSource).toContain("t('common:advisor.dropItemsColumn', 'Drop Items')");
    expect(pageSource).toContain('v-if="getDroppingItems(row).length > 0"');
    expect(pageSource).toContain('data-advisor-dropping-items');
    expect(pageSource).toContain('v-for="entry in getDroppingItems(row)"');
    expect(pageSource).toContain('dropItemIconVisible(entry.itemHrid)');
    expect(pageSource).toContain('<use :href="itemIconHref(entry.itemHrid)"></use>');
    // 徽章只显示图标 + 物品名，不内联速率（总量看「掉落/h」列；
    // 分物品速率仅保留在悬浮 title 与单元格 title 中）。
    expect(pageSource).not.toContain('{{ formatDropRate(entry.rate) }}');
    expect(pageSource).toContain('getDroppingItemTitle(entry)');
    expect(pageSource).toContain('getItemName(entry.itemHrid, entry.itemHrid)');
    expect(pageSource).toContain('function getDroppingItems(row)');
    expect(pageSource).toMatch(/rate <= 0[\s\S]{0,80}continue;/);
    // 结果行掉落物品的图标 sprite 走与面板相同的加载队列。
    expect(pageSource).toMatch(/droppingHrids[\s\S]{0,120}loadDropItemIcons\(hrids\)/);
  });

  it('warns about stale drop data and swaps the fourth top card in iron-cow mode', () => {
    expect(pageSource).toContain('v-if="simulator.advisor.dropDataStale"');
    expect(pageSource).toContain('border-warning/40 bg-warning/10');
    expect(pageSource).toContain("'common:advisor.dropDataStale',");
    expect(pageSource).toContain('data-advisor-drop-data-stale');
    expect(pageSource).toContain("best_drops: t('common:advisor.bestDrops', 'Best Drops')");
    expect(pageSource).toContain("isIroncowGoal\n                      ? t('common:advisor.dropsPerHour', 'Drops/h')");
    expect(pageSource).toContain('formatDropRate(card.row.dropsPerHour)');
  });

  it('maps the iron-cow scan errors, reasons, and scoring explanation copy', () => {
    expect(pageSource).toContain("'Please select at least one target drop item.': t(");
    expect(pageSource).toMatch(
      /'common:advisor\.errorNoDropItems',\s*'Please select at least one target drop item\.',/,
    );
    expect(pageSource).toContain("top_drops: t('common:advisor.reasonTopDrops', 'Top Drops')");
    expect(pageSource).toContain("'common:advisor.scoreExplainIroncow1',");
    expect(pageSource).toContain("'common:advisor.scoreExplainIroncow2',");
  });

  it('persists filters through the store action before scanning', () => {
    expect(pageSource).toContain('simulator.updateAdvisorFilters({ ...filterDraft });');
    expect(pageSource).toContain('filterDraft.dropItemHrids = Array.isArray(safeSource.dropItemHrids)');
    expect(pageSource).toContain('syncIroncowWeightDraft(simulator.advisor.ironcowWeights);');
  });

  it('starts advisor scans from the topbar run request token watch', () => {
    // 顶栏「开始推荐」经 store 的 runRequestToken 发起：页面 watch 后执行本地
    // runAdvisor()，而不是直接调 runAdvisorScan（后者会跳过 filterDraft 提交）。
    expect(pageSource).toContain(
      'watch(\n  () => simulator.advisor.runRequestToken,\n  () => {\n    void runAdvisor();\n  },\n);',
    );
    // runAdvisor 保留「清状态 → 重置排序 → 提交 filterDraft → 扫描」的顺序。
    expect(pageSource).toContain('resetAdvisorSort();');
    expect(pageSource).toContain('simulator.updateAdvisorFilters({ ...filterDraft });');
    // 运行阶段文案改走共享 helper，与顶栏进度摘要行保持同一口径。
    expect(pageSource).toContain("import { buildAdvisorRuntimePhaseText } from '../advisorRuntimePresentation.js';");
    expect(pageSource).toContain(
      'const runtimePhaseText = computed(() => buildAdvisorRuntimePhaseText(runtime.value, t));',
    );
  });

  it('removes the legacy header action column and in-page progress panel', () => {
    // 开始/停止按钮与进度面板已上移至粘性工具栏，页头旧操作列整体删除。
    expect(pageSource).not.toContain('lg:w-[280px]');
    expect(pageSource).not.toContain('button-danger w-full justify-center');
    expect(pageSource).not.toContain('function stopAdvisor()');
    // 页内 Progress 组件与 progressPercent/progressText computed 一并移除。
    expect(pageSource).not.toContain("import { Progress } from '../components/ui/progress/index.js';");
    expect(pageSource).not.toContain('const progressPercent = computed(');
    expect(pageSource).not.toContain('const progressText = computed(');
    expect(pageSource).not.toContain(' lg:justify-between');
    // 运行中禁用点共 11 处：掉落物品面板 3 处（「清空」/已选 chips/候选 checkbox）
    // + 预设按钮 1 + 铁牛权重输入 1 + 筛选复选框 3 + 轮数 NumberField 3；
    // 自定义权重为合并条件 isRunning || !isCustomGoal，不计入精确计数。
    expect(pageSource.match(/:disabled="isRunning"/g)?.length ?? 0).toBe(11);
  });
});

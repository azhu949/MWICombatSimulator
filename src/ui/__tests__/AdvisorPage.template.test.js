// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import AdvisorPage from '../pages/AdvisorPage.vue';
import { useSimulatorStore } from '../../stores/simulatorStore.js';
import i18next, { initI18n } from '../i18n/i18n.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table/index.js';

// 物品图标 sprite 依赖官方资源网络拉取，单测环境打桩防真实请求混入。
vi.mock('../../services/itemIconSprite.js', () => ({
  ensureItemIconSymbols: vi.fn(async () => undefined),
  hasItemIconSymbol: vi.fn(() => false),
  itemIconHref: vi.fn(() => '#'),
}));

// Vite 会静态转换字面量 new URL('...', import.meta.url)，在 jsdom 下以 window.location 为基址得到 http: 资源 URL，导致 readFileSync 失败。
// import.meta.url 本身仍为 file: URL；改用项目根相对路径绕过该转换（vitest 以项目根为 cwd）。
const pageSource = readFileSync(resolve(process.cwd(), 'src/ui/pages/AdvisorPage.vue'), 'utf8');

function sliceBetween(startAnchor, endAnchor) {
  const start = pageSource.indexOf(startAnchor);
  const end = pageSource.indexOf(endAnchor);
  expect(start, `Missing start anchor: ${startAnchor}`).toBeGreaterThan(-1);
  expect(end, `Missing end anchor: ${endAnchor}`).toBeGreaterThan(-1);
  expect(end, `End anchor must follow start anchor: ${startAnchor}`).toBeGreaterThan(start);
  return pageSource.slice(start, end);
}

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
    // 实时校验与应用共用 normalizeIroncowDraftWeight + 同一容差（原始和口径，
    // 清洗不取整）：红字报错 ⇔ apply 拒绝，消除「校验通过却静默不生效」的窗口
    //（2026-09-03 修复共用口径；2026-09-05 修复取整口径：0.333/0.334/0.333
    // 原始和 1.000 合法，旧 roundTo(·,2) 口径取整和 0.99 误报红字并静默拒绝）。
    expect(pageSource).toMatch(
      /const ironcowWeightSum = computed\(\s*\(\) =>\s*normalizeIroncowDraftWeight\(ironcowWeightDraft\.dropsPerHour\) \+/,
    );
    expect(
      (pageSource.match(/normalizeIroncowDraftWeight\(ironcowWeightDraft\./g) ?? []).length,
    ).toBeGreaterThanOrEqual(6);
    // 清洗不取整（有限且非负保留原值，否则 0），校验/应用使用原始和与 0.001 容差。
    const normalizeIroncowFnSource = sliceBetween('function normalizeIroncowDraftWeight(', 'const ironcowWeightSum =');
    expect(normalizeIroncowFnSource).toContain('const numeric = Number(value);');
    expect(normalizeIroncowFnSource).not.toContain('roundTo(');
    // 状态行在非法时以 text-destructive 红色报错。
    expect(pageSource).toContain('v-if="!ironcowWeightSumValid"');
    expect(pageSource).toContain('font-medium text-destructive');
    // G2（2026-09-05）：负数输入在输入阶段清洗——onIroncowWeightInput 复用
    // normalizeIroncowDraftWeight（负数按 0 计），草稿恒为有限非负，回显与
    // 和值/apply 同口径；负数且草稿未变化（已为 0，写入不触发重渲染、Vue
    // 不回写 :value）时同步钳制 DOM 回显，杜绝输入框残留 -0.5 而和值按 0 计。
    const onIroncowInputSource = sliceBetween('function onIroncowWeightInput(', 'function applyIroncowWeights(');
    expect(onIroncowInputSource).toContain('normalizeIroncowDraftWeight(');
    expect(onIroncowInputSource).not.toContain('Number.isFinite(value) ? value : 0');
    expect(onIroncowInputSource).toMatch(/event\.target\.value = String\(cleaned\)/);
  });

  it('keeps the custom weight draft free from blur normalization rewrites', () => {
    // Bug 1：自定义模式下每个字段 blur 都会 apply → store.customWeights 被
    // 归一化中间值整体替换；deep watch 若回写草稿，输入 0.6 会被立即改写成
    // 0.53，多字段连续输入的比例被破坏（最终 0.57/0.33 而非 0.6/0.3）。
    // 修复：watch 仅首次（immediate，覆盖持久化恢复）同步，此后 isCustomGoal
    // 时跳过回写。
    expect(pageSource).toMatch(
      /let customWeightDraftSyncedOnce = false;\s*watch\(\s*\(\) => simulator\.advisor\.customWeights,/,
    );
    const customWatchSource = sliceBetween(
      'let customWeightDraftSyncedOnce =',
      'watch(\n  () => simulator.advisor.ironcowWeights,',
    );
    expect(customWatchSource).toContain('customWeightDraftSyncedOnce = true;');
    expect(customWatchSource).toMatch(/if \(isCustomGoal\.value\) \{\s*return;\s*\}/);
    // applyCustomWeights 保留 rerank + 持久化，但不再把归一化结果回写草稿。
    // 切片终点收紧到铁牛清洗注释起点：两函数之间的铁牛历史注释含「roundTo(·,2)」
    // 字样，不得误伤下方 not.toContain('roundTo(') 断言；锚点缺失由 sliceBetween 显式报错。
    const applyCustomSource = sliceBetween('function applyCustomWeights(', '// 铁牛权重草稿的统一清洗口径');
    expect(applyCustomSource).toContain('simulator.rerankAdvisorResults(');
    expect(applyCustomSource).not.toContain('syncCustomWeightDraft(');
    // apply 时不得对草稿原地取整/清洗（2026-09-05 修复：旧 Math.max(0,
    // roundTo(·,2)) 把 0.1234 blur 后改写成 0.12，与铁牛 verbatim 口径相悖）；
    // 负值等边界由服务层 normalizeAdvisorWeights 统一钳制。守卫面：成员/括号
    // 两种访问 × 直接与复合赋值/自增自减（(?!=) 排除 ===/==/>= 等读比较误报；
    // 括号形式是本文件 onCustomWeightInput 的既有模式，循环重构型回归须能拦住）。
    // 本正则是评审期信号而非完整变更检测器（前置自增/Object.assign 等漏网形状
    // 由挂载测试的 0.1234 verbatim 断言做值级兜底）。
    expect(applyCustomSource).not.toContain('roundTo(');
    expect(applyCustomSource).not.toMatch(/customWeightDraft(?:\.\w+|\[[^\]]*\])\s*(?:[+\-*/%]?=(?!=)|\+\+|--)/);
    // runAdvisor 扫描后不再改写自定义权重草稿；铁牛草稿同步保留。
    const runAdvisorSource = sliceBetween(
      'async function runAdvisor(',
      'watch(\n  () => simulator.advisor.runRequestToken,',
    );
    expect(runAdvisorSource).not.toContain('syncCustomWeightDraft(');
    expect(runAdvisorSource).toContain('syncIroncowWeightDraft(simulator.advisor.ironcowWeights);');
    // G3（2026-09-05）：apply 与切入 custom 均把草稿快照（customWeightInputs，用户
    // 口径原始输入）随 rerank 落盘；刷新后 watch 经 resolveCustomDraftSource 优先
    // 回源原始输入（verbatim 直写），回显用户键入值而非 roundTo(归一化值) 的 0.53。
    expect(applyCustomSource).toContain('customWeightInputs: { ...customWeightDraft }');
    const setPresetSource = sliceBetween('function setPreset(', 'function applyCustomWeights(');
    expect(setPresetSource).toContain('customWeightInputs');
    expect(setPresetSource).toContain('{ ...customWeightDraft }');
    expect(pageSource).toContain('function resolveCustomDraftSource');
    expect(pageSource).toContain('verbatim: true');
    // 输入清空/非法视为放弃本次编辑：保留草稿旧值、不写 0（number 输入清空后
    // .value 为 ''，Number('') === 0 而非 NaN，必须单独排除），防止 0 权重触发
    // 破坏性归一化（收益清空后 change 会把经验权重放大到 0.9）。
    const onCustomInputSource = sliceBetween('function onCustomWeightInput(', 'function onCustomWeightChange(');
    expect(onCustomInputSource).toContain("String(rawValue).trim() === ''");
    expect(onCustomInputSource).toContain('customWeightDraft[key] = value;');
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

describe('AdvisorPage 权重输入行为（挂载级）', () => {
  // 源码断言（上方 describe）锁定接线形态，本块锁定运行时行为：
  // 自定义模式 blur 归一化不得回写输入框/草稿；铁牛 3 位小数原始和口径
  // 与 UI/服务层同判（0.333×3 合法应用、和 1.002 红字拒绝）。
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const EmptyPage = { template: '<div />' };

  function createTestRouter() {
    return createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:pathMatch(.*)*', name: 'advisor', component: EmptyPage }],
    });
  }

  async function mountAdvisorPage() {
    const pinia = createPinia();
    setActivePinia(pinia);
    const simulator = useSimulatorStore();
    const router = createTestRouter();
    await router.push('/advisor');
    await router.isReady();
    const wrapper = mount(AdvisorPage, {
      global: {
        plugins: [pinia, router],
        // Table 系列在 main.js 全局注册，挂载单页时需手动补齐。
        components: { Table, TableBody, TableCell, TableHead, TableHeader, TableRow },
      },
    });
    await flushPromises();
    return { wrapper, simulator };
  }

  // 权重输入框按 type="number" 过滤：铁牛模式的物品搜索框同为 control-input
  // 但 type="text"，避免误选。
  function findWeightInputs(wrapper) {
    return wrapper.findAll('input.control-input').filter((input) => input.attributes('type') === 'number');
  }

  function findSumAlert(wrapper) {
    return wrapper.find('[role="alert"]');
  }

  function findSumText(wrapper) {
    const label = i18next.t('common:advisor.weightSumLabel');
    return wrapper
      .findAll('p')
      .find((paragraph) => paragraph.text().startsWith(`${label}:`))
      .text();
  }

  it('custom mode: blur after typing 0.6 keeps the input and the summary shows normalized weights', async () => {
    const { wrapper, simulator } = await mountAdvisorPage();
    // 切到自定义预设（与点击预设按钮等价的 store 动作路径）。
    simulator.rerankAdvisorResults({ goalPreset: 'custom' });
    await flushPromises();

    const inputs = findWeightInputs(wrapper);
    expect(inputs).toHaveLength(2);
    inputs[0].setValue('0.6');
    await inputs[0].trigger('change');
    await flushPromises();

    // 核心回归：blur 归一化不得把输入框改写成中间值（旧实现立即变 0.53）。
    expect(inputs[0].element.value).toBe('0.6');
    // 归一化摘要显示有效权重（label 与数值交错：「每日收益 0.53 · 每小时经验
    // 0.37 · 安全性 0.1」）：0.6/(0.6+0.42)×0.9 ≈ 0.53，经验 0.42 → 0.37。
    expect(wrapper.text()).toContain('0.53 · ');
    expect(wrapper.text()).toContain('0.37 · ');
    expect(simulator.advisor.customWeights.profitPerHour).toBeCloseTo(0.5294, 3);
    expect(simulator.advisor.customWeights.xpPerHour).toBeCloseTo(0.3706, 3);

    wrapper.unmount();
  });

  it('custom mode: typing 0.6 then 0.3 across blurs keeps the ratio in the store', async () => {
    const { wrapper, simulator } = await mountAdvisorPage();
    simulator.rerankAdvisorResults({ goalPreset: 'custom' });
    await flushPromises();

    const inputs = findWeightInputs(wrapper);
    inputs[0].setValue('0.6');
    await inputs[0].trigger('change');
    await flushPromises();
    inputs[1].setValue('0.3');
    await inputs[1].trigger('change');
    await flushPromises();

    // 第一个字段的中间 blur 不得破坏比例（旧实现最终得到 0.57/0.33）。
    expect(simulator.advisor.customWeights.profitPerHour).toBeCloseTo(0.6, 12);
    expect(simulator.advisor.customWeights.xpPerHour).toBeCloseTo(0.3, 12);
    expect(simulator.advisor.customWeights.safety).toBeCloseTo(0.1, 12);
    expect(inputs[0].element.value).toBe('0.6');
    expect(inputs[1].element.value).toBe('0.3');

    wrapper.unmount();
  });

  it('custom mode: clearing an input keeps the old draft instead of a destructive 0 weight', async () => {
    const { wrapper, simulator } = await mountAdvisorPage();
    simulator.rerankAdvisorResults({ goalPreset: 'custom' });
    await flushPromises();

    const inputs = findWeightInputs(wrapper);
    inputs[0].setValue('0.6');
    await inputs[0].trigger('change');
    await flushPromises();
    const weightsBeforeClear = { ...simulator.advisor.customWeights };

    // 清空（value='' + input 事件）：草稿保留旧值（清空 = 放弃本次编辑）；
    // 随后 blur 的 apply 不得以 0 权重触发破坏性归一化——旧实现会把经验
    // 权重放大到 0.9（0/0.42×0.9 = 0）。
    inputs[0].setValue('');
    await inputs[0].trigger('change');
    await flushPromises();

    expect(simulator.advisor.customWeights.profitPerHour).toBeCloseTo(weightsBeforeClear.profitPerHour, 12);
    expect(simulator.advisor.customWeights.xpPerHour).toBeCloseTo(weightsBeforeClear.xpPerHour, 12);
    expect(simulator.advisor.customWeights.safety).toBeCloseTo(weightsBeforeClear.safety, 12);
    expect(inputs[1].element.value).toBe('0.42');

    wrapper.unmount();
  });

  it('custom mode: blur after typing 0.1234 keeps the verbatim input and the raw-ratio store weights', async () => {
    const { wrapper, simulator } = await mountAdvisorPage();
    simulator.rerankAdvisorResults({ goalPreset: 'custom' });
    await flushPromises();

    const inputs = findWeightInputs(wrapper);
    expect(inputs).toHaveLength(2);
    inputs[0].setValue('0.1234');
    await inputs[0].trigger('change');
    await flushPromises();

    // 核心回归：apply 不得对草稿原地取整改写（旧实现 blur 后回显 0.12，
    // 与铁牛 0.333 verbatim 口径相悖；现有 0.6 级测试因 roundTo 恒等测不出）。
    expect(inputs[0].element.value).toBe('0.1234');
    expect(inputs[1].element.value).toBe('0.42');
    // store 按原始比例归一化：0.1234/(0.1234+0.42)×0.9 ≈ 0.2044（旧实现先
    // 取整 0.12 → 0.12/0.54×0.9 = 0.2，用户输入的比例被悄悄改变）。
    expect(simulator.advisor.customWeights.profitPerHour).toBeCloseTo(0.2044, 3);
    expect(simulator.advisor.customWeights.xpPerHour).toBeCloseTo(0.6956, 3);

    wrapper.unmount();
  });

  it('custom mode: remount (simulated refresh) restores the typed inputs verbatim instead of 0.53', async () => {
    const first = await mountAdvisorPage();
    first.simulator.rerankAdvisorResults({ goalPreset: 'custom' });
    await flushPromises();

    const inputs = findWeightInputs(first.wrapper);
    inputs[0].setValue('0.6');
    await inputs[0].trigger('change');
    await flushPromises();
    // store 为归一化口径（0.5294/0.3706），原始输入 0.6/0.42 已随设置落盘。
    expect(first.simulator.advisor.customWeights.profitPerHour).toBeCloseTo(0.5294, 3);
    expect(first.simulator.advisor.customWeightInputs).toEqual({ profitPerHour: 0.6, xpPerHour: 0.42 });
    first.wrapper.unmount();

    // 模拟刷新：全新 pinia/store 从 localStorage 恢复、页面重挂载——输入框回显
    // 用户键入的 0.6/0.42（旧实现 watch 首次同步 roundTo(归一化值) → 0.53，
    // 跨会话口径跳变；且再 blur 会把 store 静默改写成 0.53）。
    const second = await mountAdvisorPage();
    const restored = findWeightInputs(second.wrapper);
    expect(restored[0].element.value).toBe('0.6');
    expect(restored[1].element.value).toBe('0.42');
    second.wrapper.unmount();
  });

  it('custom mode: preset round-trip (custom → balanced → custom) keeps the typed draft', async () => {
    const { wrapper, simulator } = await mountAdvisorPage();
    simulator.rerankAdvisorResults({ goalPreset: 'custom' });
    await flushPromises();

    const inputs = findWeightInputs(wrapper);
    inputs[0].setValue('0.6');
    await inputs[0].trigger('change');
    await flushPromises();

    // 切离再切回自定义：草稿回源持久化的原始输入（旧实现在非自定义模式下以
    // roundTo(归一化值) 回写草稿，切回后输入框变 0.53，会话内即丢失 0.6）。
    simulator.rerankAdvisorResults({ goalPreset: 'balanced' });
    await flushPromises();
    simulator.rerankAdvisorResults({ goalPreset: 'custom' });
    await flushPromises();

    expect(inputs[0].element.value).toBe('0.6');
    expect(inputs[1].element.value).toBe('0.42');
    wrapper.unmount();
  });

  it('ironcow mode: 0.333/0.334/0.333 sums to 1.000 without the alert and applies verbatim', async () => {
    const { wrapper, simulator } = await mountAdvisorPage();
    simulator.rerankAdvisorResults({ goalPreset: 'ironcow' });
    await flushPromises();

    const inputs = findWeightInputs(wrapper);
    expect(inputs).toHaveLength(3);
    const typed = ['0.333', '0.334', '0.333'];
    for (let index = 0; index < inputs.length; index += 1) {
      inputs[index].setValue(typed[index]);
      await inputs[index].trigger('change');
      await flushPromises();
    }

    // 原始和 1.000：无红字，store 原样保留 3 位小数输入值。
    expect(findSumAlert(wrapper).exists()).toBe(false);
    expect(findSumText(wrapper)).toBe(`${i18next.t('common:advisor.weightSumLabel')}: 1.000`);
    expect(simulator.advisor.ironcowWeights).toEqual({
      dropsPerHour: 0.334,
      xpPerHour: 0.333,
      safety: 0.333,
    });
    // 应用后回显不取整，输入框仍是 3 位小数（旧 roundTo(·,2) 口径会回显 0.33）。
    expect(inputs.map((input) => input.element.value)).toEqual(['0.333', '0.334', '0.333']);

    wrapper.unmount();
  });

  it('ironcow mode: 0.351/0.35/0.301 shows the sum alert and keeps the last legal weights', async () => {
    const { wrapper, simulator } = await mountAdvisorPage();
    simulator.rerankAdvisorResults({ goalPreset: 'ironcow' });
    await flushPromises();

    const inputs = findWeightInputs(wrapper);
    // 输入框 DOM 顺序为 [安全性, 掉落/h, 经验/h]（ironcowInputFields）。
    // 先应用一次合法值，确立「上次合法权重」基线 {0.45, 0.45, 0.1}。
    const legal = ['0.1', '0.45', '0.45'];
    for (let index = 0; index < inputs.length; index += 1) {
      inputs[index].setValue(legal[index]);
      await inputs[index].trigger('change');
      await flushPromises();
    }
    expect(simulator.advisor.ironcowWeights).toEqual({ dropsPerHour: 0.45, xpPerHour: 0.45, safety: 0.1 });

    // 输入 0.351/0.35/0.301（原始和 1.002）：红字出现（role="alert"），blur 的
    // apply 被拒绝，store 保持上次合法值。
    const illegal = ['0.351', '0.35', '0.301'];
    for (let index = 0; index < inputs.length; index += 1) {
      inputs[index].setValue(illegal[index]);
      await inputs[index].trigger('change');
      await flushPromises();
    }
    expect(findSumAlert(wrapper).exists()).toBe(true);
    expect(findSumAlert(wrapper).classes()).toContain('text-destructive');
    expect(findSumText(wrapper)).toBe(`${i18next.t('common:advisor.weightSumLabel')}: 1.002`);
    expect(simulator.advisor.ironcowWeights).toEqual({ dropsPerHour: 0.45, xpPerHour: 0.45, safety: 0.1 });

    // 小于 1 的非法和也必须显示差值，避免 0.998 被取整为 1.00。
    await inputs[2].setValue('0.297');
    await inputs[2].trigger('change');
    await flushPromises();
    expect(findSumText(wrapper)).toBe(`${i18next.t('common:advisor.weightSumLabel')}: 0.998`);
    expect(findSumAlert(wrapper).exists()).toBe(true);
    expect(simulator.advisor.ironcowWeights).toEqual({ dropsPerHour: 0.45, xpPerHour: 0.45, safety: 0.1 });

    wrapper.unmount();
  });

  it('ironcow mode: negative input is clamped to 0 so the echo and the weight sum stay consistent', async () => {
    const { wrapper, simulator } = await mountAdvisorPage();
    simulator.rerankAdvisorResults({ goalPreset: 'ironcow' });
    await flushPromises();

    // 基线默认 {0.45, 0.45, 0.1}（DOM 顺序 [安全性, 掉落/h, 经验/h]）。
    const inputs = findWeightInputs(wrapper);
    expect(inputs).toHaveLength(3);

    // G2 回归（首次负数输入，等价粘贴 -0.5）：旧实现草稿原样存 -0.5，回显
    // -0.5 而权重和按该字段 0 计（0.45+0.45+0=0.90），用户按回显自算 0.40，
    // 回显与和显示分裂。修复后输入阶段清洗为 0：回显 '0'，和值 0.90 与可见
    // 字段求和一致，红字报错（apply 拒绝的可见反馈）。
    inputs[0].setValue('-0.5');
    await flushPromises();
    expect(inputs[0].element.value).toBe('0');
    expect(findSumText(wrapper)).toBe(`${i18next.t('common:advisor.weightSumLabel')}: 0.900`);
    expect(findSumAlert(wrapper).exists()).toBe(true);

    // 二次负数输入（草稿已为 0，再写 0 不触发响应式更新、Vue 不回写 :value）：
    // DOM 钳制兜底必须把残留的 -0.5 强写回 '0'，否则分裂在同字段复发。
    inputs[0].setValue('-0.5');
    await flushPromises();
    expect(inputs[0].element.value).toBe('0');
    expect(findSumText(wrapper)).toBe(`${i18next.t('common:advisor.weightSumLabel')}: 0.900`);

    // blur 的 apply 被拒（和 0.90 ≠ 1），store 保持上次合法权重。
    await inputs[0].trigger('change');
    await flushPromises();
    expect(simulator.advisor.ironcowWeights).toEqual({ dropsPerHour: 0.45, xpPerHour: 0.45, safety: 0.1 });

    wrapper.unmount();
  });
});

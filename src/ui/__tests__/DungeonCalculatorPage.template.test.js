// @vitest-environment jsdom
// 地下城收益页模板测试：路由注册断言走真实 appRouter（createWebHashHistory 需要 location），
// 故本文件在 jsdom 环境下运行（模式照 BudgetOptimizerPage.template.test.js）。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import appRouter from '../router/index.js';
import enCommon from '../../../locales/en/common.json';
import zhCommon from '../../../locales/zh/common.json';

// Vite 会静态转换字面量 new URL('...', import.meta.url)，在 jsdom 下以 window.location 为基址得到 http: 资源 URL，
// 导致 readFileSync 失败；改用项目根相对路径绕过该转换（vitest 以项目根为 cwd）。
const pageSource = readFileSync(resolve(process.cwd(), 'src/ui/pages/DungeonCalculatorPage.vue'), 'utf8');

describe('DungeonCalculatorPage number presentation', () => {
  it('formats every money column with the shared compact k/m/b amount formatter', () => {
    expect(pageSource).toContain("import { formatCompactAmountForLocale } from '../../services/amountFormatting.js';");
    expect(pageSource).toContain('const { t, language } = useI18nText();');
    expect(pageSource).toContain(
      "return formatCompactAmountForLocale(value, language.value === 'zh' ? 'zh-CN' : 'en-US');",
    );
    // 旧的「精确整数」金额口径不得回归。
    expect(pageSource).not.toContain('new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })');
  });

  it('keeps counts exact and renders the loot item names through the localized helper', () => {
    expect(pageSource).toContain('formatNumber(item.qty, 3)');
    expect(pageSource).toContain('itemName(item.itemHrid)');
    expect(pageSource).not.toContain('{{ item.itemName }}');
  });

  it('renders the data version in China time instead of the raw UTC timestamp', () => {
    expect(pageSource).toContain("import { formatDataVersionText } from '../dataVersionPresentation.js';");
    expect(pageSource).toContain('const dataVersionText = formatDataVersionText(GAME_DATA_VERSION);');
    expect(pageSource).toContain('{{ dataVersionText }}');
    // 原始 ISO UTC 串（含尾部 Z）不得直接上屏。
    expect(pageSource).not.toContain('{{ GAME_DATA_VERSION }}');
  });
});

describe('DungeonCalculatorPage party simulation entry', () => {
  it('binds the simulate entry to the store run state and domain round bounds', () => {
    expect(pageSource).toContain('data-dungeon-calculator-simulate');
    expect(pageSource).toContain('calculator.simulateRunMinutes()');
    expect(pageSource).toContain('calculator.stopRunMinutesSimulation()');
    expect(pageSource).toContain('calculator.simulation.isRunning');
    expect(pageSource).toContain('calculator.simulationPartySize === 0');
    expect(pageSource).toContain('DUNGEON_CALCULATOR_SIMULATION_MIN_ROUNDS');
    expect(pageSource).toContain('DUNGEON_CALCULATOR_SIMULATION_MAX_ROUNDS');
    expect(pageSource).toContain('simulationProgressText');
    expect(pageSource).toContain('simulationResultText');
    expect(pageSource).toContain('simulationErrorText');
    // 全组合模拟的提示与按钮文案走新版词条。
    expect(pageSource).toContain("'common:dungeonCalculator.simulateHint'");
    expect(pageSource).toContain("'common:dungeonCalculator.simulateRun'");
  });

  it('binds the overview minutes column to per-dungeon-tier overrides and simulation summaries', () => {
    expect(pageSource).toContain('data-dungeon-calculator-controls');
    expect(pageSource).toContain('data-dungeon-calculator-overview');
    expect(pageSource).toContain('runMinutesTargetRows');
    expect(pageSource).toContain('onTargetRunMinutesInput');
    expect(pageSource).toContain('setRunMinutesOverride(');
    expect(pageSource).toContain('clearRunMinutesOverride(');
    expect(pageSource).toContain('getRunMinutesOverride(');
    expect(pageSource).toContain('runMinutesInputValue(');
    expect(pageSource).toContain('targetStatusText');
    // 无模拟结果时不再显示「轮/天」小字（2026-10-15 同日反馈：与每日产出列重复）：
    // 页面引用与两语言词条均不得回归。
    expect(pageSource).not.toContain('runMinutesPerDayShort');
    expect(zhCommon?.dungeonCalculator?.runMinutesPerDayShort).toBeUndefined();
    expect(enCommon?.dungeonCalculator?.runMinutesPerDayShort).toBeUndefined();
  });

  it('keeps the dungeonCalculator locale namespace symmetric across zh and en', () => {
    expect(Object.keys(enCommon?.dungeonCalculator || {}).sort()).toEqual(
      Object.keys(zhCommon?.dungeonCalculator || {}).sort(),
    );
  });
});

describe('DungeonCalculatorPage breakdown dialogs', () => {
  it('keeps only the loot breakdown modal (the cost breakdown dialog is gone)', () => {
    expect(pageSource).toContain("import BaseModal from '../components/BaseModal.vue';");
    expect(pageSource).toContain('data-dungeon-calculator-open-items');
    expect(pageSource).toContain('const itemsDialogOpen = ref(false);');
    expect(pageSource).toContain(':open="itemsDialogOpen"');
    // 成本明细弹窗整体移除：入口、状态与面板钩子均不得回归。
    expect(pageSource).not.toContain('data-dungeon-calculator-open-costs');
    expect(pageSource).not.toContain('costsDialogOpen');
    expect(pageSource).not.toContain('data-dungeon-calculator-costs');
    expect(pageSource).not.toContain("'common:dungeonCalculator.costTitle'");
    expect(zhCommon?.dungeonCalculator?.costTitle).toBeUndefined();
    expect(enCommon?.dungeonCalculator?.costTitle).toBeUndefined();
    // 明细面板收进弹窗，页面主体不再直接渲染 surface-panel 明细块。
    expect(pageSource).not.toContain('class="surface-panel space-y-3" data-dungeon-calculator-items');
  });

  it('keeps the consumables and alignment switches in the config card', () => {
    // 原成本弹窗的配置控件全部迁入配置卡（data-dungeon-calculator-controls 内）；宝箱钥匙回收固定 income 后
    // 不再有对应控件（2026-10-15 用户裁决）。
    const controlsStart = pageSource.indexOf('data-dungeon-calculator-controls');
    const overviewStart = pageSource.indexOf('data-dungeon-calculator-overview');
    expect(controlsStart).toBeGreaterThan(-1);
    expect(overviewStart).toBeGreaterThan(controlsStart);
    const configCard = pageSource.slice(controlsStart, overviewStart);
    for (const anchor of [
      'calculator.setExcludeCapeValue',
      'calculator.setExcludeCowbellValue',
      'calculator.setArtisanTea',
      'calculator.setGuzzlingPouch',
      'calculator.setGuzzlingLevel',
      'calculator.setCommunityBuffLevel',
      'data-dungeon-calculator-consumables',
      'data-dungeon-calculator-exclude-cape',
      'data-dungeon-calculator-exclude-cowbell',
      'data-dungeon-calculator-artisan-tea',
      'data-dungeon-calculator-guzzling-pouch',
      'data-dungeon-calculator-guzzling-level',
      'data-dungeon-calculator-community-buff',
      "'common:dungeonCalculator.dailyConsumablesCost'",
      "'common:dungeonCalculator.excludeCapeValue'",
      "'common:dungeonCalculator.excludeCowbellValue'",
      "'common:dungeonCalculator.artisanTea'",
      "'common:dungeonCalculator.guzzlingPouch'",
      "'common:dungeonCalculator.guzzlingLevel'",
      "'common:dungeonCalculator.communityBuff'",
    ]) {
      expect(configCard).toContain(anchor);
    }
    // 配置卡标题「配置」置于左上角（样式对齐「地牢总览」h3）；宝箱钥匙回收控件不得回归。
    expect(configCard).toContain('<h3 class="font-heading text-base font-semibold text-primary">');
    expect(configCard).toContain("t('common:dungeonCalculator.sectionConfig', 'Configuration')");
    expect(configCard).not.toContain('chestKeyRecoveryModeText');
    expect(configCard).not.toContain('data-dungeon-calculator-chest-key-recovery-mode');
  });

  it('drops the key source controls and keeps artisan tea / guzzling pouch controls in the config card', () => {
    // hybrid 钥匙来源整体移除（2026-10-12 用户裁决）：页面 / 词条 / store 三处均不得回归。
    expect(pageSource).not.toContain("keySourceText('hybrid')");
    expect(pageSource).not.toContain('keySourceHybrid');
    expect(pageSource).not.toContain('value="hybrid"');
    expect(zhCommon?.dungeonCalculator?.keySourceHybrid).toBeUndefined();
    expect(enCommon?.dungeonCalculator?.keySourceHybrid).toBeUndefined();
    // 两个钥匙来源下拉整体移除（2026-10-15 用户裁决）：控件 / setter / keySourceText / 词条均不得回归。
    expect(pageSource).not.toContain('calculator.setEntryKeySource');
    expect(pageSource).not.toContain('calculator.setChestKeySource');
    expect(pageSource).not.toContain('keySourceText');
    expect(pageSource).not.toContain("'common:dungeonCalculator.keySourceMarket'");
    expect(pageSource).not.toContain("'common:dungeonCalculator.keySourceCraft'");
    expect(pageSource).not.toContain("'common:dungeonCalculator.entryKeySource'");
    expect(pageSource).not.toContain("'common:dungeonCalculator.chestKeySource'");
    for (const key of ['sectionKeySource', 'entryKeySource', 'chestKeySource', 'keySourceMarket', 'keySourceCraft']) {
      expect(zhCommon?.dungeonCalculator?.[key]).toBeUndefined();
      expect(enCommon?.dungeonCalculator?.[key]).toBeUndefined();
    }

    // 工匠茶默认勾选（数据侧默认开），暴饮之囊默认不勾选且等级控件随勾选禁用。
    expect(pageSource).toContain(':checked="calculator.config.artisanTea"');
    expect(pageSource).toContain(':checked="calculator.config.guzzlingPouch"');
    expect(pageSource).toContain(':disabled="!calculator.config.guzzlingPouch"');
    // 等级控件复用队伍人数同款 NumberField，0-20 全范围。
    expect(pageSource).toContain(':model-value="calculator.config.guzzlingLevel"');
    expect(pageSource).toContain('@update:model-value="calculator.setGuzzlingLevel"');
    // 词条两侧对称齐备；2026-10-15 同日反馈：冒号后的解释删除，只保留名称。
    for (const key of ['artisanTea', 'guzzlingPouch', 'guzzlingLevel']) {
      expect(zhCommon?.dungeonCalculator?.[key]).toBeTruthy();
      expect(enCommon?.dungeonCalculator?.[key]).toBeTruthy();
    }
    expect(zhCommon?.dungeonCalculator?.artisanTea).toBe('工匠茶');
    expect(enCommon?.dungeonCalculator?.artisanTea).toBe('Artisan tea');
    expect(zhCommon?.dungeonCalculator?.guzzlingPouch).toBe('暴饮之囊');
    expect(enCommon?.dungeonCalculator?.guzzlingPouch).toBe('Guzzling pouch');
  });

  it('groups the config chips into one row under the card heading with the simulate block on top', () => {
    // 2026-10-15 用户裁决：模拟块移到配置卡最上方（原宝箱钥匙 / 药品成本字段行位置）；
    // 开关 chip 行与字段网格不再混排；标题「配置」置于卡片左上角（样式对齐「地牢总览」）。
    const switchesStart = pageSource.indexOf('data-dungeon-calculator-switches');
    const simulateStart = pageSource.indexOf('data-dungeon-calculator-simulate');
    const overviewStart = pageSource.indexOf('data-dungeon-calculator-overview');
    expect(switchesStart).toBeGreaterThan(-1);
    expect(simulateStart).toBeGreaterThan(-1);
    expect(simulateStart).toBeLessThan(switchesStart);
    const switches = pageSource.slice(switchesStart, overviewStart);
    for (const anchor of [
      'data-dungeon-calculator-artisan-tea',
      'data-dungeon-calculator-guzzling-pouch',
      'data-dungeon-calculator-guzzling-level',
      'data-dungeon-calculator-exclude-cape',
      'data-dungeon-calculator-exclude-cowbell',
      'data-dungeon-calculator-community-buff',
      "'common:dungeonCalculator.communityBuff'",
    ]) {
      expect(switches).toContain(anchor);
    }
    // 标题「配置」在卡片左上角、位于模拟块与配置项之前；字段网格已删（宝箱钥匙移除 + 药品成本迁入 chip 区）。
    const controlsStart = pageSource.indexOf('data-dungeon-calculator-controls');
    const headingStart = pageSource.indexOf("t('common:dungeonCalculator.sectionConfig'");
    expect(controlsStart).toBeGreaterThan(-1);
    expect(headingStart).toBeGreaterThan(controlsStart);
    expect(headingStart).toBeLessThan(simulateStart);
    expect(pageSource).not.toContain('xl:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]');
    // 药品成本输入并入 chip 行（在 switches 切片内）。
    expect(switches).toContain('data-dungeon-calculator-consumables');
    expect(switches).toContain("t('common:dungeonCalculator.dailyConsumablesCost', 'Daily food / drink cost (M)')");
    // 旧的 self-end 硬贴底混排不得回归；chip 高亮态齐备。
    expect(pageSource).not.toContain('self-end text-xs text-foreground/85');
    expect(switches).toContain("calculator.config.artisanTea ? 'bg-muted font-medium' : ''");
    expect(switches).toContain("calculator.config.guzzlingPouch ? 'bg-muted font-medium' : ''");
    expect(switches).toContain("calculator.config.communityBuffLevel > 0 ? 'bg-muted font-medium' : ''");
    expect(switches).toContain('calculator.setCommunityBuffLevel');
    // 社区加成触发器加宽（2026-10-15 同日反馈）：w-24 下「等级 20」被截断成「等级…」，看不到具体等级。
    expect(switches).toContain('class="w-28"');
    // 标题词条（两语言）：原名「口径开关」改为「配置」，旧键随重构删除。
    expect(zhCommon?.dungeonCalculator?.sectionConfig).toBe('配置');
    expect(enCommon?.dungeonCalculator?.sectionConfig).toBe('Configuration');
    expect(zhCommon?.dungeonCalculator?.sectionSwitches).toBeUndefined();
    expect(enCommon?.dungeonCalculator?.sectionSwitches).toBeUndefined();
    // 旧「加成开关」区块标题词条已随配置卡重构成为孤儿：随控件一并清理，不得回归。
    expect(zhCommon?.dungeonCalculator?.sectionBuffs).toBeUndefined();
    expect(enCommon?.dungeonCalculator?.sectionBuffs).toBeUndefined();
  });

  it('keeps the price override summary and hint inside the loot dialog', () => {
    // 成本侧改价入口随弹窗移除，覆盖摘要 / 清除全部改价 / 改价提示保留在产物弹窗内。
    expect(pageSource).toContain('data-dungeon-calculator-items');
    expect(pageSource).toContain('overrideSummaryText');
    expect(pageSource).toContain('calculator.clearAllPriceOverrides()');
    expect(pageSource).toContain("'common:dungeonCalculator.priceEditHint'");
    // 价格格非法输入（负数 / 非有限值）不落库且显示立即回滚：onOverrideInput 末尾统一回写显示值
    // （与 onTargetRunMinutesInput 的回滚口径一致）；回写在 script 内，断言全文而非 itemsDialog 切片。
    expect(pageSource).toContain('event.target.value = overrideEntryValue(');
    const itemsStart = pageSource.indexOf('data-dungeon-calculator-items');
    const itemsEnd = pageSource.indexOf('</section>');
    const itemsDialog = pageSource.slice(itemsStart, itemsEnd);
    expect(itemsDialog).toContain('overrideSummaryText');
    expect(itemsDialog).toContain('calculator.clearAllPriceOverrides()');
    expect(itemsDialog).toContain("'common:dungeonCalculator.priceEditHint'");
    // 社区掉落数量加成控件迁入配置卡（2026-10-12 用户裁决）：弹窗内控件与小字注释均不得回归。
    expect(itemsDialog).not.toContain('calculator.setCommunityBuffLevel');
    expect(itemsDialog).not.toContain('data-dungeon-calculator-community-buff');
    expect(itemsDialog).not.toContain('communityBuffNote');
  });
});

describe('DungeonCalculatorPage layout polish (MST-inspired)', () => {
  it('merges the two cards into a single dungeon overview card', () => {
    // 两卡片合并：原「每轮分钟」与「批量对比」锚点全部下线，只留总览卡（选择与编辑合一，行头即行选择入口）。
    expect(pageSource).toContain('data-dungeon-calculator-overview');
    expect(pageSource).toContain('selectTarget(');
    expect(pageSource).toContain('D{{ dungeonSerial(row.dungeonHrid) }}');
    expect(pageSource).not.toContain('data-dungeon-calculator-run-minutes');
    expect(pageSource).not.toContain('data-dungeon-calculator-compare');
    expect(pageSource).not.toContain('selectDungeon');
    expect(pageSource).not.toContain('selectTier');
    expect(pageSource).not.toContain('tierPickerDisabled');
    expect(pageSource).not.toContain('data-dungeon-calculator-dungeon-picker');
    expect(pageSource).not.toContain('name="dungeon-calculator-dungeon"');
  });

  it('selects the current target from the row click and the minutes input focus', () => {
    // 总览表：行点击与分钟输入框聚焦都走统一入口 selectTarget（未通关组合门禁在函数内）。
    expect(pageSource).toContain('selectTarget(row.dungeonHrid, row.difficultyTier)');
    expect(pageSource).toContain('@focus="selectTarget(');
    expect(pageSource).not.toContain('tierHeaderClass');
    expect(pageSource).not.toContain('tierColumnLabel');
    expect(pageSource).not.toContain('selectTier');
  });

  it('drops the trade side matrix (buy/sell combination table)', () => {
    // 买卖组合对照表整体移除：页面 / 词条 / store 三处均不得回归。
    expect(pageSource).not.toContain('data-dungeon-calculator-combinations');
    expect(pageSource).not.toContain('combinationRows');
    expect(pageSource).not.toContain('applyCombination');
    expect(pageSource).not.toContain('setBuyMode');
    expect(pageSource).not.toContain('setSellMode');
    expect(pageSource).not.toContain("'common:dungeonCalculator.combinationsTitle'");
    expect(pageSource).not.toContain("'common:dungeonCalculator.combinationsHint'");
    expect(pageSource).not.toContain("'common:dungeonCalculator.buyMode'");
    expect(pageSource).not.toContain("'common:dungeonCalculator.sellMode'");
    for (const key of ['sectionTrade', 'buyMode', 'sellMode', 'combinationsTitle', 'combinationsHint']) {
      expect(zhCommon?.dungeonCalculator?.[key]).toBeUndefined();
      expect(enCommon?.dungeonCalculator?.[key]).toBeUndefined();
    }
    // 双列网格（分钟表 + 买卖组合并排）不再存在，总览卡合并后两个旧锚点均下线。
    expect(pageSource).not.toContain('xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]');
    expect(pageSource).toContain('data-dungeon-calculator-overview');
    expect(pageSource).not.toContain('data-dungeon-calculator-run-minutes');
    expect(pageSource).not.toContain('data-dungeon-calculator-compare');
  });

  it('keeps the overview table full-width, sortable and highlighted for the current target', () => {
    expect(pageSource).toContain('selectTarget(row.dungeonHrid, row.difficultyTier)');
    expect(pageSource).toContain('compareRowsForDisplay');
    expect(pageSource).toContain('isCurrentTarget(row.dungeonHrid, row.difficultyTier)');
    const overviewIndex = pageSource.indexOf('data-dungeon-calculator-overview');
    const openItemsIndex = pageSource.indexOf('data-dungeon-calculator-open-items');
    expect(overviewIndex).toBeGreaterThan(-1);
    // 产物明细入口搬进总览面板头部；收益卡（metrics 指标行）整块移除。
    expect(openItemsIndex).toBeGreaterThan(overviewIndex);
    expect(pageSource).not.toContain('data-dungeon-calculator-metrics');
    // 分钟格内不再有重复的选中背景（2026-10-15 同日反馈）：行级 bg-success/10 已高亮整行。
    expect(pageSource).not.toContain('bg-success/5');
    expect(pageSource).not.toContain('ring-success/30');
  });

  it('uses readable font sizes inside the dungeon overview panel', () => {
    // 总览卡正文按项目表格惯例用 14px（text-sm），辅助行用 12px（text-xs），
    // 不再使用 10px / 11px 的超小字号。
    const overviewStart = pageSource.indexOf('data-dungeon-calculator-overview');
    const compareEnd = pageSource.indexOf('<BaseModal');
    expect(overviewStart).toBeGreaterThan(-1);
    expect(compareEnd).toBeGreaterThan(overviewStart);
    const panels = pageSource.slice(overviewStart, compareEnd);
    expect(panels).not.toContain('text-[10px]');
    expect(panels).not.toContain('text-[11px]');
    // 排序按钮与列头标签统一 text-sm，指示符 text-xs。
    expect(panels).toContain('inline-flex items-center gap-1 text-left text-sm font-semibold');
    expect(panels).toContain('inline-flex items-center gap-1 text-sm font-semibold');
    expect(panels).toContain('class="text-xs"');
    // 分钟输入格与行头（地牢名 / 档位）主标题同步上调。
    expect(panels).toContain('text-center text-sm tabular-nums');
    expect(panels).toContain('<TableCell class="py-1 text-sm">');
    expect(panels).toContain('getActionName(row.dungeonHrid, row.dungeonName)');
  });

  it('keeps the overview rows compact so all twelve combinations stay visible', () => {
    // 行高压缩（2026-10-12 用户反馈）：分钟格改为「输入框 + 状态文字」同行，
    // 单元格内边距统一 py-1，双口径格行距收紧（leading-tight）；
    // 旧的两行堆叠（space-y-1 + 居中状态行 + 1.5 内边距）不得回归。
    const overviewStart = pageSource.indexOf('data-dungeon-calculator-overview');
    const compareEnd = pageSource.indexOf('<BaseModal');
    expect(overviewStart).toBeGreaterThan(-1);
    expect(compareEnd).toBeGreaterThan(overviewStart);
    const panels = pageSource.slice(overviewStart, compareEnd);
    expect(panels).toContain('class="flex items-center gap-2 rounded-md p-1 transition"');
    expect(panels).toContain('class="min-w-0 flex-1 truncate text-xs"');
    expect(panels).not.toContain('space-y-1 rounded-md p-1.5');
    expect(panels).not.toContain('truncate text-center text-xs');
    // 八列单元格内边距统一收敛到 py-1（行头 / 档位 / 分钟 / 每日产出 / 成本 / 利润 + 差价 + 死亡列）。
    const compactCells = panels.match(/<TableCell class="py-1 /g) || [];
    expect(compactCells.length).toBe(7);
    expect(panels).toContain('class="py-1 text-right text-sm font-semibold"');
    // 分钟输入框降到 h-7 档并固定宽度，避免撑高整行。
    expect(panels).toContain('!h-7 !min-h-0 !w-20 !px-2');
    expect(panels).not.toContain('!h-8 !min-h-0 !px-2');
    // 多行格行距统一收紧：每日产出一格两行（每行两项）+ 制 / 购两格各双行。
    const dualRows = panels.match(/space-y-0\.5 leading-tight/g) || [];
    expect(dualRows.length).toBe(3);
  });

  it('keeps the minutes column header on the same side as its input cell', () => {
    // 格内容是「输入框 + 状态小字」左对齐，表头若右对齐会飘到「购」列上方（2026-10-13 用户反馈）：
    // 表头与内容同侧左对齐，右对齐列头为每日产出 / 制 / 购 / 差价 / 死亡五列。
    const tierHeadStart = pageSource.indexOf("toggleCompareSort('difficultyTier')");
    const minutesHeadEnd = pageSource.indexOf("toggleCompareSort('runMinutes')");
    expect(tierHeadStart).toBeGreaterThan(-1);
    expect(minutesHeadEnd).toBeGreaterThan(tierHeadStart);
    const minutesHead = pageSource.slice(tierHeadStart, minutesHeadEnd);
    expect(minutesHead).toContain('<TableHead>');
    expect(minutesHead).not.toContain('<TableHead class="text-right">');
    expect(minutesHead).toContain('inline-flex items-center gap-1 text-left text-sm font-semibold');
    // 计数限定在总览表切片内（产物弹窗表另有右对齐列头）。
    const overviewStart = pageSource.indexOf('data-dungeon-calculator-overview');
    const overviewEnd = pageSource.indexOf('data-dungeon-calculator-items');
    expect(overviewStart).toBeGreaterThan(-1);
    expect(overviewEnd).toBeGreaterThan(overviewStart);
    const rightAlignedHeads =
      pageSource.slice(overviewStart, overviewEnd).match(/<TableHead class="text-right">/g) || [];
    expect(rightAlignedHeads.length).toBe(5);
  });

  it('sorts the overview table by column header like the multi-round results page', () => {
    // 列头排序入口与三态循环（降序 → 升序 → 恢复默认），指示符 <> / ^ / v。
    expect(pageSource).toContain('toggleCompareSort');
    expect(pageSource).toContain('getCompareSortIndicator');
    expect(pageSource).toContain("compareSort.value.direction === 'asc' ? '^' : 'v'");
    expect(pageSource).toContain("compareSort.value = { key: columnKey, metric: 'cost', direction: 'desc' }");
    expect(pageSource).toContain("compareSort.value = { key: '', metric: 'cost', direction: 'desc' }");
    expect(pageSource).toContain('class="text-xs"');
    // 缺失值恒排末尾（与多轮结果页 compareRankingRows 同款）。
    expect(pageSource).toContain('if (leftValue == null) return 1;');
    expect(pageSource).toContain('if (rightValue == null) return -1;');
    // 制 / 购 两列五态：成本降 → 成本升 → 收益降 → 收益升 → 恢复默认；
    // 排序状态带 metric 指标，指示符按格内行标签（成本 / 收益）拼接。
    expect(pageSource).toContain("const COMPARE_BASIS_COLUMNS = Object.freeze(['craft', 'market']);");
    expect(pageSource).toContain(
      "const COMPARE_BASIS_METRIC_FIELDS = Object.freeze({ cost: 'dailyCost', profit: 'dailyProfit' });",
    );
    expect(pageSource).toContain('const basisColumn = COMPARE_BASIS_COLUMNS.includes(columnKey);');
    expect(pageSource).toContain("if (basisColumn && compareSort.value.metric !== 'profit') {");
    expect(pageSource).toContain("compareSort.value.metric = 'profit';");
    expect(pageSource).toContain("const sortMetric = compareSort.value.metric === 'profit' ? 'profit' : 'cost';");
    expect(pageSource).toContain(
      'return compareCompareRows(a.row, b.row, sortKey, sortMetric, directionFactor) || a.index - b.index;',
    );
    expect(pageSource).toContain("t('common:dungeonCalculator.compareLineProfit', 'Profit')");
    expect(pageSource).toContain("t('common:dungeonCalculator.compareLineCost', 'Cost')");
    expect(pageSource).toContain("return `${compareSort.value.direction === 'asc' ? '^' : 'v'}${metricLabel}`;");
    expect(pageSource).toContain("function resolveCompareSortValue(row, key, metric = 'cost')");
    expect(pageSource).toContain('const nested = Number(row.keySourceBreakdown?.[key]?.[field]);');
    // 旧的两档 radio 排序入口不得回归。
    expect(pageSource).not.toContain('dungeon-calculator-compare-sort');
    expect(pageSource).not.toContain('setCompareSortBy');
    // 旧的双口径键映射常量已随五态排序移除。
    expect(pageSource).not.toContain('COMPARE_KEY_SOURCE_SORT_COLUMNS');
    expect(pageSource).not.toContain('COMPARE_KEY_SOURCE_BASIS_BY_COLUMN');
    expect(pageSource).not.toContain('COMPARE_KEY_SOURCE_VALUE_BY_COLUMN');
    // 每日产出列与死亡列为纯展示列（2026-10-15）：不提供列头排序入口。
    expect(pageSource).not.toContain("toggleCompareSort('runsPerDay')");
    expect(pageSource).not.toContain("toggleCompareSort('deathsPerRun')");
  });

  it('defaults the compare table to the D1 to D4 dungeon order with tiers ascending', () => {
    // 默认顺序（未点列头）：地牢序号 D1 → D4、同地牢内档位 T0 → T2 升序；未通关行仍恒置底。
    expect(pageSource).toContain('function compareDefaultOrder(');
    expect(pageSource).toContain('function dungeonSerialRank(');
    expect(pageSource).toContain(
      'const serialDiff = dungeonSerialRank(left.dungeonHrid) - dungeonSerialRank(right.dungeonHrid);',
    );
    expect(pageSource).toContain('return left.difficultyTier - right.difficultyTier;');
    expect(pageSource).toContain('return compareDefaultOrder(a.row, b.row) || a.index - b.index;');
    // 未通关分层优先于默认顺序（门禁不因默认排序而失效）。
    expect(pageSource).toContain('if (a.noClear !== b.noClear) {');
    // 默认序与列头排序互斥：列头排序激活时不得再叠加默认序。
    expect(pageSource).toContain(
      'const columnSortActive = Boolean(sortKey) && COMPARE_SORT_COLUMNS.includes(sortKey);',
    );
    expect(pageSource).toContain(
      'return compareCompareRows(a.row, b.row, sortKey, sortMetric, directionFactor) || a.index - b.index;',
    );
  });

  it('greys out and pins simulated non-clear rows and blocks switching to them', () => {
    expect(pageSource).toContain('compareNoClearMap');
    expect(pageSource).toContain('calculator.simulation.lastResult?.targets');
    expect(pageSource).toContain('compareRowNoClear');
    expect(pageSource).toContain('compareNoClearTitle');
    expect(pageSource).toContain("'common:dungeonCalculator.compareNoClearHint'");
    // 置灰 + 禁止点击；未通关行恒排末尾（先按未通关分层再排序）。
    expect(pageSource).toContain('cursor-not-allowed opacity-45');
    expect(pageSource).toContain('return a.noClear ? 1 : -1;');
    // 点击门禁：行点击走 selectTarget，未通关组合在函数内被拦下。
    expect(pageSource).toContain('@click="selectTarget(row.dungeonHrid, row.difficultyTier)"');
    expect(pageSource).toContain('if (targetNoClear(dungeonHrid, tier)) {');
  });

  it('locks minutes for simulated non-clear targets and drops the legacy picker interactions', () => {
    // 统一门禁：总览表分钟输入禁改（行点击切换同样被门禁拦截）。
    expect(pageSource).toContain('function targetNoClear(');
    expect(pageSource).toContain('simulationClearedTargetsExist');
    expect(pageSource).toContain(':disabled="targetNoClear(row.dungeonHrid, row.difficultyTier)"');
    expect(pageSource).not.toContain('dungeonPickerDisabled');
    // 旧的行头 / 档位列头选择交互整体下线，不得回归。
    expect(pageSource).not.toContain('selectDungeon');
    expect(pageSource).not.toContain('selectTier');
    expect(pageSource).not.toContain('tierPickerDisabled');
    expect(pageSource).not.toContain('tierHeaderClass');
    expect(pageSource).not.toContain('tierColumnLabel');
    expect(pageSource).not.toContain('resolveAvailableTier');
    // 统一选择入口 + 输入提交都做兜底拦截。
    expect(pageSource).toContain('function selectTarget(');
    expect(pageSource).toContain('if (targetNoClear(dungeonHrid, tier)) {');
  });

  it('renders official dungeon icons and the daily consumables cost input', () => {
    // 地牢图标：官方 actions_sprite 符号（与 MST 工具箱 getMapIconHref 同源）。
    expect(pageSource).toContain("from '../../services/itemIconSprite.js'");
    expect(pageSource).toContain('ensureActionIconSymbols');
    expect(pageSource).toContain('hasActionIconSymbol');
    expect(pageSource).toContain('actionIconHref(row.dungeonHrid)');
    expect(pageSource).toContain('dungeonIconVisible(row.dungeonHrid)');
    expect(pageSource).toContain('viewBox="0 0 100 100"');
    // 每日药品 / 饮料成本（M）：输入已迁入配置卡 + store 换算（成本明细行随成本弹窗移除）。
    expect(pageSource).toContain('data-dungeon-calculator-consumables');
    expect(pageSource).toContain('calculator.setDailyConsumablesCostMillions');
    expect(pageSource).toContain("'common:dungeonCalculator.dailyConsumablesCost'");
    expect(pageSource).not.toContain("'common:dungeonCalculator.dailyConsumablesCostRow'");
  });

  it('stacks the daily cost and daily profit lines in one market / craft cell plus a profit delta', () => {
    // 工具箱式排版（2026-10-13 用户裁决）：成本列拆成「制 / 购」两列（2026-10-15 起制作在左），格内上行「成本」、下行「收益」，
    // 末尾保留「差价」列；旧的「每日成本 / 每日利润」列头与词条已下线。
    expect(pageSource).toContain("toggleCompareSort('market')");
    expect(pageSource).toContain("toggleCompareSort('craft')");
    expect(pageSource).toContain("toggleCompareSort('profitDelta')");
    // 列序（2026-10-15 用户裁决）：制作列在购买列左侧，差价列仍在最右——表头与格内取值路径同序。
    const craftHeadIndex = pageSource.indexOf("toggleCompareSort('craft')");
    const marketHeadIndex = pageSource.indexOf("toggleCompareSort('market')");
    const deltaHeadIndex = pageSource.indexOf("toggleCompareSort('profitDelta')");
    expect(craftHeadIndex).toBeGreaterThan(-1);
    expect(marketHeadIndex).toBeGreaterThan(craftHeadIndex);
    expect(deltaHeadIndex).toBeGreaterThan(marketHeadIndex);
    const craftCellIndex = pageSource.indexOf('formatMoney(row.keySourceBreakdown.craft.dailyCost)');
    const marketCellIndex = pageSource.indexOf('formatMoney(row.keySourceBreakdown.market.dailyCost)');
    expect(craftCellIndex).toBeGreaterThan(-1);
    expect(marketCellIndex).toBeGreaterThan(craftCellIndex);
    expect(pageSource).toContain("'common:dungeonCalculator.compareBasisMarket'");
    expect(pageSource).toContain("'common:dungeonCalculator.compareBasisCraft'");
    expect(pageSource).toContain("'common:dungeonCalculator.compareLineCost'");
    expect(pageSource).toContain("'common:dungeonCalculator.compareLineProfit'");
    expect(pageSource).toContain("'common:dungeonCalculator.compareProfitDelta'");
    expect(pageSource).not.toContain("toggleCompareSort('dailyCost')");
    expect(pageSource).not.toContain("toggleCompareSort('dailyProfit')");
    expect(pageSource).not.toContain("'common:dungeonCalculator.compareDailyCost'");
    expect(pageSource).not.toContain("'common:dungeonCalculator.compareDailyProfit'");
    // 已移除的列：每轮门票 / 每轮钥匙 / 每轮消耗品 / 个人日收益 / 旧双口径四列。
    expect(pageSource).not.toContain("toggleCompareSort('entryKeyCost')");
    expect(pageSource).not.toContain("toggleCompareSort('chestKeyCost')");
    expect(pageSource).not.toContain("toggleCompareSort('consumablesCostPerRun')");
    expect(pageSource).not.toContain("toggleCompareSort('perMemberDaily')");
    expect(pageSource).not.toContain("toggleCompareSort('dailyCostMarket')");
    expect(pageSource).not.toContain("toggleCompareSort('dailyCostCraft')");
    expect(pageSource).not.toContain("toggleCompareSort('dailyProfitMarket')");
    expect(pageSource).not.toContain("toggleCompareSort('dailyProfitCraft')");
    expect(pageSource).not.toContain('formatMoney(row.entryKeyCost)');
    expect(pageSource).not.toContain('formatMoney(row.chestKeyCost)');
    expect(pageSource).not.toContain('formatMoney(row.consumablesCostPerRun)');
    expect(pageSource).not.toContain('formatMoney(row.dailyCost)');
    expect(pageSource).not.toContain('formatMoney(row.perMemberDaily)');
    // 行内取值：双口径列读引擎行的 keySourceBreakdown 嵌套对象。
    expect(pageSource).toContain('formatMoney(row.keySourceBreakdown.market.dailyCost)');
    expect(pageSource).toContain('formatMoney(row.keySourceBreakdown.craft.dailyCost)');
    expect(pageSource).toContain('formatMoney(row.keySourceBreakdown.market.dailyProfit)');
    expect(pageSource).toContain('formatMoney(row.keySourceBreakdown.craft.dailyProfit)');
    expect(pageSource).toContain('formatMoney(row.keySourceBreakdown.profitDelta)');
    // 格内多行结构（工具箱 574037 式）：制 / 购两格各双行（上行 = 成本、下行 = 收益），
    // 小标签紧贴数字右对齐；每日产出列改为「一行两项」结构后不再计入本样式，共 4 行；
    // 旧的左右拉开的 justify-between 排版不得回归。
    const stackedRowMarkup = pageSource.match(/flex items-baseline justify-end gap-1/g) || [];
    expect(stackedRowMarkup.length).toBe(4);
    expect(pageSource).not.toContain('flex items-baseline justify-between gap-2');
    expect(pageSource).toContain('class="text-sm tabular-nums text-destructive"');
    // 已删除的列词条整体不得回归（含总览表内的每轮净利 / 队伍日 / 毛收入 / 精炼率）。
    expect(pageSource).not.toContain("'common:dungeonCalculator.compareTeamDaily'");
    expect(pageSource).not.toContain("'common:dungeonCalculator.compareGross'");
    expect(pageSource).not.toContain("'common:dungeonCalculator.compareRefinement'");
    expect(pageSource).not.toContain("'common:dungeonCalculator.compareKeyCost'");
    expect(pageSource).not.toContain("'common:dungeonCalculator.compareNet'");
    // 总览表区域（表头到产物弹窗之间）不再渲染队伍日 / 每轮净利 / 毛收入列。
    const overviewStart = pageSource.indexOf('data-dungeon-calculator-overview');
    const overviewEnd = pageSource.indexOf('data-dungeon-calculator-items');
    expect(overviewStart).toBeGreaterThan(-1);
    expect(overviewEnd).toBeGreaterThan(overviewStart);
    const overviewSection = pageSource.slice(overviewStart, overviewEnd);
    expect(overviewSection).not.toContain('row.teamDaily');
    expect(overviewSection).not.toContain('row.perRunProfit');
    expect(overviewSection).not.toContain('row.grossIncome');
    expect(overviewSection).not.toContain('row.refinementRate');
    // 列头与格内行标签（zh/en fallback 同步）：口径列头 = 购买（左买右卖）/ 制作（左买右卖），格内行标签 = 成本 / 收益。
    expect(pageSource).toContain("t('common:dungeonCalculator.compareBasisMarket', 'Buy (ask buy / bid sell)')");
    expect(pageSource).toContain("t('common:dungeonCalculator.compareBasisCraft', 'Craft (ask buy / bid sell)')");
    expect(pageSource).toContain("t('common:dungeonCalculator.compareLineCost', 'Cost')");
    expect(pageSource).toContain("t('common:dungeonCalculator.compareLineProfit', 'Profit')");
    expect(pageSource).toContain("t('common:dungeonCalculator.compareProfitDelta', 'Delta')");
    for (const key of [
      'overviewTitle',
      'overviewHint',
      'compareBasisMarket',
      'compareBasisCraft',
      'compareLineCost',
      'compareLineProfit',
      'compareProfitDelta',
    ]) {
      expect(zhCommon?.dungeonCalculator?.[key]).toBeTruthy();
      expect(enCommon?.dungeonCalculator?.[key]).toBeTruthy();
    }
    expect(zhCommon?.dungeonCalculator?.overviewTitle).toBe('地牢总览');
    expect(enCommon?.dungeonCalculator?.overviewTitle).toBe('Dungeon overview');
    expect(zhCommon?.dungeonCalculator?.compareBasisMarket).toBe('购买（左买右卖）');
    expect(zhCommon?.dungeonCalculator?.compareBasisCraft).toBe('制作（左买右卖）');
    expect(zhCommon?.dungeonCalculator?.compareLineCost).toBe('成本');
    expect(zhCommon?.dungeonCalculator?.compareLineProfit).toBe('收益');
    expect(zhCommon?.dungeonCalculator?.compareProfitDelta).toBe('差价');
    expect(enCommon?.dungeonCalculator?.compareBasisMarket).toBe('Buy (ask buy / bid sell)');
    expect(enCommon?.dungeonCalculator?.compareBasisCraft).toBe('Craft (ask buy / bid sell)');
    expect(enCommon?.dungeonCalculator?.compareLineCost).toBe('Cost');
    expect(enCommon?.dungeonCalculator?.compareLineProfit).toBe('Profit');
    expect(enCommon?.dungeonCalculator?.compareProfitDelta).toBe('Delta');
    // 档位口径说明（2026-10-15）：两列同为「左买右卖」（ask 买 / bid 卖），
    // 列头后缀与 overviewHint 均须写明，避免用户误判为左买/右买两种档位。
    expect(zhCommon?.dungeonCalculator?.overviewHint).toContain('左买右卖');
    expect(zhCommon?.dungeonCalculator?.overviewHint).toContain('买成品钥匙');
    expect(enCommon?.dungeonCalculator?.overviewHint).toContain('ask buy / bid sell');
    expect(enCommon?.dungeonCalculator?.overviewHint).toContain('finished keys');
    // 旧双口径五列词条、旧列头词条与旧双卡标题 / 提示词条随合并删除（两语言同步），不得回归。
    for (const key of [
      'compareDailyCost',
      'compareDailyProfit',
      'compareDailyCostMarket',
      'compareDailyCostCraft',
      'compareDailyProfitMarket',
      'compareDailyProfitCraft',
      'runMinutesTableTitle',
      'runMinutesTableHint',
      'compareTitle',
      'compareHint',
    ]) {
      expect(zhCommon?.dungeonCalculator?.[key]).toBeUndefined();
      expect(enCommon?.dungeonCalculator?.[key]).toBeUndefined();
    }
  });

  it('keeps the simulated consumables wiring and the simulation summary in the store contract', () => {
    // 成本弹窗内的消耗品行已随弹窗移除；模拟实测消耗品仍按「角色 × 地牢 × 档位」写回 store。
    expect(pageSource).not.toContain('consumablesSimulated');
    expect(pageSource).not.toContain('consumablesActivePlayerTag');
    expect(pageSource).not.toContain("'common:dungeonCalculator.consumablesSimulatedTag'");
    expect(pageSource).not.toContain("'common:dungeonCalculator.consumablesActivePlayerTag'");
    expect(pageSource).not.toContain("'common:dungeonCalculator.keyCostSubtotalRow'");
    expect(pageSource).not.toContain("'common:dungeonCalculator.dailyConsumablesCostRow'");
    for (const key of [
      'consumablesSimulatedTag',
      'consumablesActivePlayerTag',
      'keyCostSubtotalRow',
      'dailyConsumablesCostRow',
    ]) {
      expect(zhCommon?.dungeonCalculator?.[key]).toBeUndefined();
      expect(enCommon?.dungeonCalculator?.[key]).toBeUndefined();
    }
    // 模拟结果摘要披露消耗品写回数量（保留）。
    expect(pageSource).toContain("'common:dungeonCalculator.simulateSummaryConsumables'");
    expect(pageSource).toContain('appliedConsumablesTargets');
  });

  it('shows the party size field in the dungeon overview panel', () => {
    // 队伍人数控件显示在「地牢总览」面板内（2026-10-15 用户裁决：从配置卡迁入）。
    const controlsStart = pageSource.indexOf('data-dungeon-calculator-controls');
    const overviewStart = pageSource.indexOf('data-dungeon-calculator-overview');
    expect(controlsStart).toBeGreaterThan(-1);
    expect(overviewStart).toBeGreaterThan(controlsStart);
    const configCard = pageSource.slice(controlsStart, overviewStart);
    const overviewPanel = pageSource.slice(overviewStart);
    expect(overviewPanel).toContain('data-dungeon-calculator-party-size');
    expect(overviewPanel).toContain(':model-value="calculator.config.partySize"');
    expect(overviewPanel).toContain('@update:model-value="calculator.setPartySize"');
    expect(configCard).not.toContain(':model-value="calculator.config.partySize"');
    // 悬停说明（title）：未导入数据时默认 5，导入后跟随勾选的队员数。
    expect(overviewPanel).toContain("'common:dungeonCalculator.partySizeHint'");
    expect(zhCommon?.dungeonCalculator?.partySizeHint).toContain('默认 5');
    expect(enCommon?.dungeonCalculator?.partySizeHint).toContain('Defaults to 5');
  });

  it('colors profit figures by sign in the overview dual-basis columns', () => {
    expect(pageSource).toContain('function profitTone(');
    // 买卖组合表与收益卡均已移除：正负着色只剩总览表的双口径利润 / 利润差价列。
    expect(pageSource).toContain('profitTone(row.keySourceBreakdown.market.dailyProfit)');
    expect(pageSource).toContain('profitTone(row.keySourceBreakdown.craft.dailyProfit)');
    expect(pageSource).toContain('profitTone(row.keySourceBreakdown.profitDelta)');
    expect(pageSource).not.toContain('profitTone(row.perRunProfit)');
    expect(pageSource).not.toContain('profitTone(row.teamDaily)');
    expect(pageSource).not.toContain('profitTone(row.perMemberDaily)');
    // 收益卡整体移除（2026-10-15 用户裁决）：metrics 指标行与两个每轮指标词条均不得回归。
    expect(pageSource).not.toContain('data-dungeon-calculator-metrics');
    expect(pageSource).not.toContain("'common:dungeonCalculator.keysPerRunLabel'");
    expect(pageSource).not.toContain("'common:dungeonCalculator.entryKeysPerRunLabel'");
    for (const key of ['keysPerRunLabel', 'entryKeysPerRunLabel']) {
      expect(zhCommon?.dungeonCalculator?.[key]).toBeUndefined();
      expect(enCommon?.dungeonCalculator?.[key]).toBeUndefined();
    }
  });

  it('removes the profit card block, keeping only the overview table', () => {
    // 收益卡（标题 / 指标行 / 五张卡）整体删除（2026-10-15 用户裁决）：页面引用、键名与两语言词条均不得回归。
    expect(pageSource).not.toContain("'common:dungeonCalculator.resultsTitle'");
    expect(pageSource).not.toContain('profitCards');
    expect(pageSource).not.toContain('xl:grid-cols-5');
    for (const key of ['resultsTitle', 'grossIncome', 'totalCost', 'perRunProfit', 'perMemberDaily']) {
      expect(zhCommon?.dungeonCalculator?.[key]).toBeUndefined();
      expect(enCommon?.dungeonCalculator?.[key]).toBeUndefined();
    }

    // 「队伍日收益」卡片与词条此前已移除：继续不得回归。
    expect(pageSource).not.toContain("'common:dungeonCalculator.teamDaily'");
    expect(pageSource).not.toContain('value.teamDaily');
    expect(zhCommon?.dungeonCalculator?.teamDaily).toBeUndefined();
    expect(enCommon?.dungeonCalculator?.teamDaily).toBeUndefined();

    // 产物明细入口移进总览面板头部（弹窗本体与改价功能不动）。
    const overviewStart = pageSource.indexOf('data-dungeon-calculator-overview');
    const itemsStart = pageSource.indexOf('data-dungeon-calculator-items');
    expect(overviewStart).toBeGreaterThan(-1);
    expect(itemsStart).toBeGreaterThan(overviewStart);
    expect(pageSource.slice(overviewStart, itemsStart)).toContain('data-dungeon-calculator-open-items');
  });

  it('renders the daily output column with runs, entry keys and both chest counts', () => {
    // 每日产出列（2026-10-15 用户裁决；同日反馈改为两行版式）：一列两行、每行两项——
    // 第一行 = 每日轮次 + 每日门票；第二行 = 每日普通宝箱 + 每日精炼宝箱；
    // 门票数 = 普通宝箱数（恒等，预期），精炼箱不消耗门票；数值取自引擎行新透传字段。
    const overviewStart = pageSource.indexOf('data-dungeon-calculator-overview');
    const itemsStart = pageSource.indexOf('data-dungeon-calculator-items');
    expect(overviewStart).toBeGreaterThan(-1);
    expect(itemsStart).toBeGreaterThan(overviewStart);
    const overviewSection = pageSource.slice(overviewStart, itemsStart);
    expect(overviewSection).toContain("t('common:dungeonCalculator.dailyOutputLabel', 'Daily output')");
    expect(overviewSection).toContain("t('common:dungeonCalculator.runsPerDayLabel', 'Daily runs')");
    expect(overviewSection).toContain("t('common:dungeonCalculator.dailyEntryKeysLabel', 'Daily entry keys')");
    expect(overviewSection).toContain("t('common:dungeonCalculator.dailyMainChestsLabel', 'Daily main chests')");
    expect(overviewSection).toContain(
      "t('common:dungeonCalculator.dailyRefinementChestsLabel', 'Daily refinement chests')",
    );
    expect(overviewSection).toContain('formatNumber(row.runsPerDay, 2)');
    expect(overviewSection).toContain('formatNumber(row.mainChestCount * row.runsPerDay, 2)');
    expect(overviewSection).toContain('formatNumber(row.refinementChestCount * row.runsPerDay, 2)');
    // 两行结构（每行两项）：格内恰好两行 + 行内对样式。
    const dailyRowLines = overviewSection.match(/flex items-baseline justify-end gap-x-4 whitespace-nowrap/g) || [];
    expect(dailyRowLines.length).toBe(2);
    expect(overviewSection).toContain('inline-flex items-baseline gap-1');
    expect(zhCommon?.dungeonCalculator?.runsPerDayLabel).toBe('每日轮次');
    expect(enCommon?.dungeonCalculator?.runsPerDayLabel).toBe('Daily runs');
    expect(zhCommon?.dungeonCalculator?.dailyOutputLabel).toBe('每日产出');
    expect(enCommon?.dungeonCalculator?.dailyOutputLabel).toBe('Daily output');
    expect(zhCommon?.dungeonCalculator?.dailyEntryKeysLabel).toBe('每日门票');
    expect(enCommon?.dungeonCalculator?.dailyEntryKeysLabel).toBe('Daily entry keys');
    expect(zhCommon?.dungeonCalculator?.dailyMainChestsLabel).toBe('每日普通宝箱');
    expect(enCommon?.dungeonCalculator?.dailyMainChestsLabel).toBe('Daily main chests');
    expect(zhCommon?.dungeonCalculator?.dailyRefinementChestsLabel).toBe('每日精炼宝箱');
    expect(enCommon?.dungeonCalculator?.dailyRefinementChestsLabel).toBe('Daily refinement chests');
  });

  it('binds the deaths column in the overview table to the simulated per-run death average', () => {
    // 死亡次数独立成列（2026-10-15 用户裁决）：数据源 = 「用导入队伍模拟」对应组合结果（deathsPerRun），
    // 未跑模拟 / 该组合零通关 / 未上报时占位符。
    expect(pageSource).toContain("t('common:dungeonCalculator.deathsPerRun', 'Deaths per run')");
    expect(pageSource).toContain('function deathsPerRunText(dungeonHrid, tier)');
    expect(pageSource).toContain('simulationTargetMap.value.get(');
    expect(pageSource).toContain('simRow.deathsPerRun == null');
    expect(pageSource).toContain('return formatNumber(simRow.deathsPerRun, 2);');
    expect(pageSource).toContain('deathsPerRunText(row.dungeonHrid, row.difficultyTier)');
    // 列位于总览表内（产物弹窗之前）；列序（2026-10-15 同日反馈）：紧邻「每轮分钟」之后、
    // 每日产出之前——表头与表体同序。
    const overviewStart = pageSource.indexOf('data-dungeon-calculator-overview');
    const itemsStart = pageSource.indexOf('data-dungeon-calculator-items');
    const deathsColumn = pageSource.slice(overviewStart, itemsStart);
    expect(deathsColumn).toContain('deathsPerRunText(row.dungeonHrid, row.difficultyTier)');
    const headRunMinutesIndex = pageSource.indexOf("t('common:dungeonCalculator.runMinutes', 'Minutes per run')");
    const headDeathsIndex = pageSource.indexOf("t('common:dungeonCalculator.deathsPerRun', 'Deaths per run')");
    const headDailyIndex = pageSource.indexOf("t('common:dungeonCalculator.dailyOutputLabel', 'Daily output')");
    expect(headRunMinutesIndex).toBeGreaterThan(-1);
    expect(headDeathsIndex).toBeGreaterThan(headRunMinutesIndex);
    expect(headDailyIndex).toBeGreaterThan(headDeathsIndex);
    const bodyRunMinutesIndex = pageSource.indexOf('runMinutesInputValue(row.dungeonHrid, row.difficultyTier)');
    const bodyDeathsIndex = pageSource.indexOf('deathsPerRunText(row.dungeonHrid, row.difficultyTier)');
    const bodyDailyIndex = pageSource.indexOf("t('common:dungeonCalculator.runsPerDayLabel', 'Daily runs')");
    expect(bodyRunMinutesIndex).toBeGreaterThan(-1);
    expect(bodyDeathsIndex).toBeGreaterThan(bodyRunMinutesIndex);
    expect(bodyDailyIndex).toBeGreaterThan(bodyDeathsIndex);
    expect(zhCommon?.dungeonCalculator?.deathsPerRun).toBe('每轮死亡次数');
    expect(enCommon?.dungeonCalculator?.deathsPerRun).toBe('Deaths per run');
  });

  it('adds dungeon and tier filter checkboxes at the top of the overview panel', () => {
    // 2026-10-15 用户需求：地牢总览顶部加「地下城 / 难度」勾选，默认全勾；取消勾选 → 对应行不展示。
    // 纯展示过滤（页面本地状态）：不影响选中组合、覆盖值与模拟结果。
    const overviewStart = pageSource.indexOf('data-dungeon-calculator-overview');
    const itemsStart = pageSource.indexOf('data-dungeon-calculator-items');
    expect(overviewStart).toBeGreaterThan(-1);
    expect(itemsStart).toBeGreaterThan(overviewStart);
    const overviewPanel = pageSource.slice(overviewStart, itemsStart);
    // 过滤行位于总览面板头部（表格之前），两类 chip 锚点齐备；旧选择器（dungeon-picker）不得复用。
    expect(overviewPanel).toContain('data-dungeon-calculator-row-filters');
    expect(overviewPanel).toContain('data-dungeon-calculator-row-filter-dungeon');
    expect(overviewPanel).toContain('data-dungeon-calculator-row-filter-tier');
    expect(overviewPanel.indexOf('data-dungeon-calculator-row-filters')).toBeLessThan(
      overviewPanel.indexOf('<Table class="min-w-[1080px]">'),
    );
    expect(pageSource).not.toContain('data-dungeon-calculator-dungeon-picker');
    // 选项来源：地下城遍历目录（D 序号 + 本地化名称）、难度遍历固定 0..2。
    expect(overviewPanel).toContain('v-for="entry in calculator.catalog"');
    expect(overviewPanel).toContain('v-for="tier in COMPARE_FILTER_TIERS"');
    expect(overviewPanel).toContain('D{{ dungeonSerial(entry.actionHrid) }}');
    expect(overviewPanel).toContain('{{ getActionName(entry.actionHrid, entry.name) }}');
    // 默认全勾 = 取消集合为空 + 「不在集合里即勾选」判定。
    expect(pageSource).toContain('const COMPARE_FILTER_TIERS = Object.freeze([0, 1, 2]);');
    expect(pageSource).toContain('const uncheckedDungeonHrids = ref(new Set());');
    expect(pageSource).toContain('const uncheckedTiers = ref(new Set());');
    expect(pageSource).toContain('return !uncheckedDungeonHrids.value.has(dungeonHrid);');
    expect(pageSource).toContain('return !uncheckedTiers.value.has(tier);');
    // 勾选回写 + 行过滤接线：filter 在未通关分层 / 列头排序之前执行（护栏不动）。
    expect(pageSource).toContain('function isDungeonFilterChecked(');
    expect(pageSource).toContain('function toggleDungeonFilter(');
    expect(pageSource).toContain('function isTierFilterChecked(');
    expect(pageSource).toContain('function toggleTierFilter(');
    expect(overviewPanel).toContain(':checked="isDungeonFilterChecked(entry.actionHrid)"');
    expect(overviewPanel).toContain(':checked="isTierFilterChecked(tier)"');
    expect(overviewPanel).toContain('@change="toggleDungeonFilter(entry.actionHrid, $event.target.checked)"');
    expect(overviewPanel).toContain('@change="toggleTierFilter(tier, $event.target.checked)"');
    expect(pageSource).toContain('calculator.compareRows.filter(');
    expect(pageSource).toContain(
      '(row) => isDungeonFilterChecked(row.dungeonHrid) && isTierFilterChecked(row.difficultyTier),',
    );
    const filterIndex = pageSource.indexOf('calculator.compareRows.filter(');
    const layeredIndex = pageSource.indexOf('const layered = rows.map(');
    expect(filterIndex).toBeGreaterThan(-1);
    expect(filterIndex).toBeLessThan(layeredIndex);
    // 纯展示过滤：不得出现写 store 的过滤 action / store 字段。
    expect(pageSource).not.toContain('setDungeonFilter');
    expect(pageSource).not.toContain('setTierFilter');
    expect(pageSource).not.toContain('config.uncheckedDungeonHrids');
    expect(pageSource).not.toContain('config.uncheckedTiers');
    // 标题词条：页面引用 + 两语言值。
    expect(overviewPanel).toContain("'common:dungeonCalculator.rowFilterDungeonsLabel'");
    expect(overviewPanel).toContain("'common:dungeonCalculator.rowFilterTiersLabel'");
    expect(zhCommon?.dungeonCalculator?.rowFilterDungeonsLabel).toBe('地下城');
    expect(enCommon?.dungeonCalculator?.rowFilterDungeonsLabel).toBe('Dungeons');
    expect(zhCommon?.dungeonCalculator?.rowFilterTiersLabel).toBe('难度');
    expect(enCommon?.dungeonCalculator?.rowFilterTiersLabel).toBe('Tiers');
  });
});

describe('DungeonCalculatorPage script alignment controls', () => {
  it('binds the cape/cowbell exclude switches and drops the chest key recovery controls', () => {
    // 各控件各自的 store action 与 data 锚点。
    expect(pageSource).toContain('calculator.setExcludeCapeValue');
    expect(pageSource).not.toContain('calculator.setCapeMirrorValuation');
    expect(pageSource).toContain('calculator.setExcludeCowbellValue');
    expect(pageSource).not.toContain('calculator.setCowbellSidePricing');
    expect(pageSource).toContain('data-dungeon-calculator-exclude-cape');
    expect(pageSource).not.toContain('data-dungeon-calculator-cape-mirror');
    expect(pageSource).toContain('data-dungeon-calculator-exclude-cowbell');
    expect(pageSource).not.toContain('data-dungeon-calculator-cowbell-side');
    // 宝箱钥匙回收固定收入侧（2026-10-15 用户裁决：不再提供配置）：下拉 / setter / 文案函数 / 词条均不得回归。
    expect(pageSource).not.toContain('calculator.setChestKeyRecoveryMode');
    expect(pageSource).not.toContain('calculator.config.chestKeyRecoveryMode');
    expect(pageSource).not.toContain('data-dungeon-calculator-chest-key-recovery-mode');
    expect(pageSource).not.toContain('chestKeyRecoveryModeText');
    expect(pageSource).not.toContain('<SelectItem value="cost">');
    expect(pageSource).not.toContain('<SelectItem value="income">');
    expect(pageSource).not.toContain('<SelectItem value="off">');
    // 披风 / 牛铃复选框：勾选态读 config，变更回写 store。
    expect(pageSource).toContain(':checked="calculator.config.excludeCapeValue"');
    expect(pageSource).toContain('calculator.setExcludeCapeValue($event.target.checked)');
    expect(pageSource).toContain(':checked="calculator.config.excludeCowbellValue"');
    expect(pageSource).toContain('calculator.setExcludeCowbellValue($event.target.checked)');
  });

  it('drops the refinement rate mode select and override input (fixed to script consensus)', () => {
    // 精炼率固定为脚本共识逐档常量：成本明细内不再提供口径切换与覆盖输入（2026-10-11 用户裁决）。
    expect(pageSource).not.toContain('calculator.setRefinementRateMode');
    expect(pageSource).not.toContain('calculator.setRefinementRateOverride');
    expect(pageSource).not.toContain('data-dungeon-calculator-refinement-mode');
    expect(pageSource).not.toContain('refinementOverrideInput');
    expect(pageSource).not.toContain('onRefinementOverrideInput');
    expect(pageSource).not.toContain('refinementRateModeText');
    expect(pageSource).not.toContain("'common:dungeonCalculator.refinementRateModeLabel'");
    expect(pageSource).not.toContain("'common:dungeonCalculator.refinementRateOverride'");
    expect(pageSource).not.toContain("'common:dungeonCalculator.refinementRatePlaceholder'");
    expect(pageSource).not.toContain("'common:dungeonCalculator.refinementRateModeOfficial'");
    expect(pageSource).not.toContain("'common:dungeonCalculator.refinementRateModeScript'");
    expect(pageSource).not.toContain("'common:dungeonCalculator.refinementRateModeCustom'");
    // 实际掉率仍只读展示（收益卡指标行已移除，改由产物弹窗披露当前生效值）。
    expect(pageSource).toContain("'common:dungeonCalculator.refinementRateLabel'");
  });

  it('drops the legacy chest key recovery boolean toggle and its locale key', () => {
    // 旧布尔开关（含 setter 调用，带左括号避免与 setChestKeyRecoveryMode 子串误判）。
    expect(pageSource).not.toContain('calculator.setChestKeyRecovery(');
    expect(pageSource).not.toContain('"calculator.config.chestKeyRecovery"');
    expect(pageSource).not.toContain("'common:dungeonCalculator.chestKeyRecovery'");
    expect(zhCommon?.dungeonCalculator?.chestKeyRecovery).toBeUndefined();
    expect(enCommon?.dungeonCalculator?.chestKeyRecovery).toBeUndefined();
  });

  it('defines the remaining pricing control labels in both locales', () => {
    const keys = ['excludeCapeValue', 'excludeCowbellValue'];
    for (const key of keys) {
      expect(zhCommon?.dungeonCalculator?.[key]).toBeTruthy();
      expect(enCommon?.dungeonCalculator?.[key]).toBeTruthy();
    }
    // 宝箱钥匙回收词条随控件整体移除（2026-10-15 用户裁决：固定收入侧，不再提供配置）——两语言同步删除。
    for (const key of [
      'chestKeyRecoveryModeLabel',
      'chestKeyRecoveryModeCost',
      'chestKeyRecoveryModeIncome',
      'chestKeyRecoveryModeOff',
    ]) {
      expect(zhCommon?.dungeonCalculator?.[key]).toBeUndefined();
      expect(enCommon?.dungeonCalculator?.[key]).toBeUndefined();
    }
    // 旧「披风按镜价计税」与「牛铃按卖出侧取袋价」词条随开关替换一并删除（两语言同步）。
    expect(zhCommon?.dungeonCalculator?.capeMirrorValuation).toBeUndefined();
    expect(enCommon?.dungeonCalculator?.capeMirrorValuation).toBeUndefined();
    expect(zhCommon?.dungeonCalculator?.cowbellSidePricing).toBeUndefined();
    expect(enCommon?.dungeonCalculator?.cowbellSidePricing).toBeUndefined();
    // 精炼率口径 / 覆盖相关词条已随控件移除（两语言同步删除）。
    for (const key of [
      'refinementRateModeLabel',
      'refinementRateModeOfficial',
      'refinementRateModeScript',
      'refinementRateModeCustom',
      'refinementRateOverride',
      'refinementRatePlaceholder',
    ]) {
      expect(zhCommon?.dungeonCalculator?.[key]).toBeUndefined();
      expect(enCommon?.dungeonCalculator?.[key]).toBeUndefined();
    }
    // 社区 buff 控件迁入配置卡后小字注释一并移除（2026-10-12 用户裁决）：词条与模板渲染均不得回归。
    expect(zhCommon?.dungeonCalculator?.communityBuffNote).toBeUndefined();
    expect(enCommon?.dungeonCalculator?.communityBuffNote).toBeUndefined();
    expect(pageSource).not.toContain('communityBuffNote');
    expect(zhCommon?.dungeonCalculator?.buffMultiplierLabel).toBe('箱数倍率');
    expect(enCommon?.dungeonCalculator?.buffMultiplierLabel).toBe('Chest multiplier');
  });
});

describe('DungeonCalculatorPage toolbar slimming', () => {
  it('drops the duplicate market refresh entries and the subtitle line from the toolbar', () => {
    // 2026-10-15 用户裁决：顶部两个刷新入口（「市场数据」指示器与「刷新价格」按钮）重复，一并删除；
    // 「按期望值核算宝箱产出，含税费、钥匙成本与回收。」副标题行同步删除。
    // 工具栏只保留「行情就绪」徽章与「重置」按钮。
    expect(pageSource).not.toContain('MarketPriceIndicator');
    expect(pageSource).not.toContain('refreshPrices');
    expect(pageSource).not.toContain('priceRefreshPending');
    expect(pageSource).not.toContain("'common:dungeonCalculator.subtitle'");
    expect(pageSource).not.toContain('useSimulatorStore');
    // 保留项：行情徽章（状态文案 + 着色）与重置按钮。
    expect(pageSource).toContain('data-dungeon-calculator-actions');
    expect(pageSource).toContain('priceStatusText');
    expect(pageSource).toContain('priceStatusClass');
    expect(pageSource).toContain('@click="resetConfig"');
    expect(pageSource).toContain("t('common:dungeonCalculator.reset', 'Reset')");
    // 词条（两语言对称）：subtitle / refreshPrices 删除；refreshing（徽章刷新态）与其余行情状态键保留。
    for (const key of ['subtitle', 'refreshPrices']) {
      expect(zhCommon?.dungeonCalculator?.[key]).toBeUndefined();
      expect(enCommon?.dungeonCalculator?.[key]).toBeUndefined();
    }
    for (const key of ['refreshing', 'pricesReady', 'vendorPrices', 'priceFallbackActive', 'reset']) {
      expect(zhCommon?.dungeonCalculator?.[key]).toBeTruthy();
      expect(enCommon?.dungeonCalculator?.[key]).toBeTruthy();
    }
  });
});

describe('DungeonCalculatorPage navigation registration', () => {
  it('registers a lazy simulation route right below the budget optimizer', () => {
    const route = appRouter.getRoutes().find((entry) => entry.name === 'dungeon-calculator');
    const budgetRoute = appRouter.getRoutes().find((entry) => entry.name === 'budget-optimizer');
    expect(route.path).toBe('/dungeon-calculator');
    expect(typeof route.components.default).toBe('function');
    expect(route.meta).toMatchObject({
      showCombatToolbar: false,
      navLabelKey: 'common:menu.dungeonCalculator',
      navGroup: 'simulation',
      navOrder: 2.8,
    });
    // 菜单顺序（2026-10-16 用户要求）：地下城收益排在预算优化正下方。
    expect(route.meta.navOrder).toBeGreaterThan(budgetRoute.meta.navOrder);
  });
});

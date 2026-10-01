import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import enCommon from '../../../locales/en/common.json';
import zhCommon from '../../../locales/zh/common.json';
import {
  FOOD_OPTIMIZER_MAX_ROUNDS,
  FOOD_OPTIMIZER_MAX_STEP_PERCENT,
  FOOD_OPTIMIZER_MIN_ROUNDS,
  FOOD_OPTIMIZER_MIN_STEP_PERCENT,
} from '../../services/foodOptimizerDomain.js';
import {
  TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
  TRIGGER_OPTIMIZER_MAX_MAX_ROUNDS,
  TRIGGER_OPTIMIZER_MAX_ROUNDS,
  TRIGGER_OPTIMIZER_MAX_SIMULATION_HOURS,
  TRIGGER_OPTIMIZER_MIN_CANDIDATE_LIMIT,
  TRIGGER_OPTIMIZER_MIN_MAX_ROUNDS,
  TRIGGER_OPTIMIZER_MIN_ROUNDS,
  TRIGGER_OPTIMIZER_MIN_SIMULATION_HOURS,
} from '../../services/triggerOptimizerDomain.js';

const SRC_ROOT = fileURLToPath(new URL('../../../src', import.meta.url));

function collectUiSourceFiles() {
  const files = [];
  (function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(entryPath);
      else if (/\.(js|vue|mjs)$/.test(entry.name)) files.push(entryPath);
    }
  })(SRC_ROOT);
  return files;
}

describe('common locale resources', () => {
  it('defines the dedicated patch notes page copy in both languages', () => {
    expect(enCommon?.vue?.app?.patchNotesPageDescription).toContain('by version');
    expect(zhCommon?.vue?.app?.patchNotesPageDescription).toContain('按版本');
    expect(enCommon?.vue?.app?.patchNotesMarkReadHint).toContain('open this page');
    expect(zhCommon?.vue?.app?.patchNotesMarkReadHint).toContain('进入此页面');
  });

  it('defines the enhancement workspace labels in both supported languages', () => {
    expect(enCommon?.menu?.enhancement).toBe('Enhancement');
    expect(zhCommon?.menu?.enhancement).toBe('强化模拟');
    expect(enCommon?.enhancement?.title).toBe('Enhancement Simulator');
    expect(zhCommon?.enhancement?.title).toBe('强化模拟器');
    expect(zhCommon?.enhancement?.fromZeroPlanTitle).toBe('最低成本制作方案');
    expect(zhCommon?.enhancement?.useMirror).toBe('已使用{{item}}');
    expect(zhCommon?.enhancement?.directEnhancement).toBe('未使用{{item}}');
    expect(enCommon?.enhancement?.budgetSuccessProbability).toBe('Success within budget');
    expect(zhCommon?.enhancement?.budgetSuccessProbability).toBe('预算内成功率');
    expect(enCommon?.enhancement?.sourceAcquisitionEstimate).toBe('Acquisition estimate');
    expect(zhCommon?.enhancement?.sourceAcquisitionEstimate).toBe('获取估值');
    expect(zhCommon?.enhancement?.acquisitionEstimateSummary).toContain('平均 {{count}} 箱');
    expect(zhCommon?.enhancement?.vendorRecovery).toBe('商店回收 {{value}}');
  });

  it('keeps every enhancement resource key synchronized across locales', () => {
    expect(Object.keys(enCommon?.enhancement || {}).sort()).toEqual(Object.keys(zhCommon?.enhancement || {}).sort());
  });

  it('keeps every advisor resource key synchronized across locales', () => {
    expect(Object.keys(enCommon?.advisor || {}).sort()).toEqual(Object.keys(zhCommon?.advisor || {}).sort());
    expect(zhCommon?.advisor?.presetIroncow).toBe('铁牛');
    expect(enCommon?.advisor?.presetIroncow).toBe('Iron Cow');
    expect(zhCommon?.advisor?.dropsPerHour).toBe('掉落/h');
    expect(enCommon?.advisor?.dropsPerHour).toBe('Drops/h');
    expect(zhCommon?.advisor?.dropItemsColumn).toBe('掉落物品');
    expect(enCommon?.advisor?.dropItemsColumn).toBe('Drop Items');
    expect(zhCommon?.advisor?.bestDrops).toBe('掉落最佳');
    expect(enCommon?.advisor?.bestDrops).toBe('Best Drops');
    expect(zhCommon?.advisor?.weightSumError).toContain('必须等于 1');
    expect(zhCommon?.advisor?.dropDataStale).toContain('重新扫描');
    expect(zhCommon?.advisor?.errorNoDropItems).toContain('目标掉落物品');
    expect(enCommon?.advisor?.errorNoDropItems).toContain('target drop item');
    expect(zhCommon?.advisor?.scoreExplainIroncow1).toContain('收益不参与评分');
    expect(enCommon?.advisor?.scoreExplainIroncow1).toContain('profit does not affect the score');
  });

  it('defines synchronized skilling workspace labels', () => {
    expect(enCommon?.menu?.skilling).toBe('Skilling');
    expect(zhCommon?.menu?.skilling).toBe('生活技能');
    expect(enCommon?.skilling?.title).toBe('Skilling Upgrade Planner');
    expect(zhCommon?.skilling?.title).toBe('生活技能升级推荐器');
    expect(zhCommon?.skilling?.balanced).toBe('均衡');
    expect(zhCommon?.skilling?.runScope).toBe('模拟范围');
    expect(zhCommon?.skilling?.runScopeSingle).toBe('单项');
    expect(zhCommon?.skilling?.runScopeAll).toBe('全部');
    expect(zhCommon?.skilling?.simulationSkill).toBe('指定技能');
    expect(zhCommon?.skilling?.allSkills).toBe('全部技能');
    expect(zhCommon?.skilling?.calculateAll).toBe('计算全部');
    expect(zhCommon?.skilling?.calculateSelected).toContain('{{skill}}');
    expect(zhCommon?.skilling?.optimizationModeHelp).toBe('优化模式说明');
    expect(zhCommon?.skilling?.materialPurchasePerXp).toBe('材料补购/经验');
    expect(zhCommon?.skilling?.balancedModeDescription).toContain('最低净成本/经验');
    expect(zhCommon?.skilling?.balancedModeDescription).toContain('基准 + |基准| × {{percent}}%');
    expect(zhCommon?.skilling?.balancedCostTolerance).toBe('成本容忍度');
    expect(zhCommon?.skilling?.balancedCostToleranceHint).toContain('当前等级净成本/经验');
    expect(zhCommon?.skilling?.balancedCostToleranceChanged).toContain('{{resultPercent}}%');
    expect(enCommon?.skilling?.balancedModeDescription).toContain('full-level route');
    expect(enCommon?.skilling?.balancedModeDescription).toContain('baseline + {{percent}}% of |baseline|');
    expect(enCommon?.skilling?.balancedCostTolerancePercent).toContain('percentage');
    expect(zhCommon?.skilling?.stageLevel).toBe('阶段等级');
    expect(zhCommon?.skilling?.stageDetails).toBe('执行阶段');
    expect(zhCommon?.skilling?.stageCount).toContain('{{count}}');
    expect(zhCommon?.skilling?.multipleRecipes).toContain('{{count}} 个配方');
    expect(zhCommon?.skilling?.totalDrinks).toBe('饮品总计');
    expect(zhCommon?.skilling?.routeDetailsWithRange).toContain('{{range}}');
    expect(zhCommon?.skilling?.rangeDetailsAriaLabel).toContain('{{skill}}');
    expect(zhCommon?.skilling?.levelInProgress).toContain('升级中');
    expect(zhCommon?.skilling?.drinkContinued).toBe('续用');
    expect(zhCommon?.skilling?.drinkRemaining).toContain('末余');
    expect(zhCommon?.skilling?.noDrinks).toBe('本段无需新增饮品');
    expect(zhCommon?.skilling?.noCandidateDrinks).toBe('无');
    expect(zhCommon?.skilling?.stagedEquipment).toContain('分阶段切换');
    expect(zhCommon?.skilling?.nextLevelActions).toBe('预计升下一级动作');
    expect(zhCommon?.skilling?.quantity).toBe('数量');
    expect(zhCommon?.skilling?.nextLevelDrinks).toBe('升下一级饮品');
    expect(zhCommon?.skilling?.nextLevelCostPerXp).toBe('升下一级净成本/经验');
    expect(zhCommon?.skilling?.nextLevelPurchaseCost).toBe('升下一级补购金额');
    expect(zhCommon?.skilling?.nextLevelCandidateDetails).toBe('升下一级候选明细');
    expect(zhCommon?.skilling?.currentLevelAlternatives).toBe('当前等级候选对比');
    expect(enCommon?.skilling?.drinkUsedUp).toContain('used up');
    expect(Object.keys(enCommon?.skilling || {}).sort()).toEqual(Object.keys(zhCommon?.skilling || {}).sort());
  });

  it('keeps the trigger optimizer resource keys synchronized across locales', () => {
    expect(enCommon?.menu?.triggerOptimizer).toBe('Trigger Optimizer');
    expect(zhCommon?.menu?.triggerOptimizer).toBe('技能优化');
    // 搜索强度预设（四个档位名）与重复次数文案在两种语言里对齐——下拉直接读它们。
    expect(zhCommon?.triggerOptimizer?.rounds).toBe('重复次数');
    expect(enCommon?.triggerOptimizer?.rounds).toBe('Rounds');
    expect(Object.keys(zhCommon?.triggerOptimizer?.presets || {}).sort()).toEqual(
      Object.keys(enCommon?.triggerOptimizer?.presets || {}).sort(),
    );
    expect(zhCommon?.triggerOptimizer?.invalidSettings).toContain('重复次数 1–12');
    expect(enCommon?.triggerOptimizer?.invalidSettings).toContain('rounds 1-12');
    expect(Object.keys(enCommon?.triggerOptimizer || {}).sort()).toEqual(
      Object.keys(zhCommon?.triggerOptimizer || {}).sort(),
    );
    for (const nested of ['phases', 'metrics', 'role', 'candidate', 'metricSignificance', 'robustnessVerdicts']) {
      expect(Object.keys(enCommon?.triggerOptimizer?.[nested] || {}).sort()).toEqual(
        Object.keys(zhCommon?.triggerOptimizer?.[nested] || {}).sort(),
      );
    }
    // 「空列表 = 立即释放，不是禁用」的澄清文案必须在两种语言里都存在（设计 §1.1/§9.2）。
    expect(zhCommon?.triggerOptimizer?.candidate?.disabledHint).toContain('并非禁用');
    expect(enCommon?.triggerOptimizer?.candidate?.disabledHint).toContain('not disabled');
    expect(zhCommon?.triggerOptimizer?.emptyState).toContain('导入');
    expect(enCommon?.triggerOptimizer?.emptyState).toContain('import');
  });

  it('keeps the trigger optimizer bound copy in sync with the domain range constants', () => {
    // invalidSettings 内嵌「权重 0–100（出现两次）/ 搜索轮数 1–5 / 每技能候选 2–20 / 重复次数 1–12 /
    // 时长 1–168」；常量改了文案没改，提示就会与校验不一致（2026-09-27 正是这样抓到「候选上限」文案
    // 停在 16、常量已是 20 的漂移）。按出现顺序比对（两种语言同序）。
    const bounds = [
      0,
      100,
      100,
      TRIGGER_OPTIMIZER_MIN_MAX_ROUNDS,
      TRIGGER_OPTIMIZER_MAX_MAX_ROUNDS,
      TRIGGER_OPTIMIZER_MIN_CANDIDATE_LIMIT,
      TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
      TRIGGER_OPTIMIZER_MIN_ROUNDS,
      TRIGGER_OPTIMIZER_MAX_ROUNDS,
      TRIGGER_OPTIMIZER_MIN_SIMULATION_HOURS,
      TRIGGER_OPTIMIZER_MAX_SIMULATION_HOURS,
    ];
    for (const locale of [enCommon, zhCommon]) {
      const numbers = (locale.triggerOptimizer.invalidSettings.match(/\d+/g) || []).map(Number);
      expect(numbers).toEqual(bounds);
    }
  });

  it('defines the reorganized Home workspace tabs in both supported languages', () => {
    const enTabs = enCommon?.vue?.home?.workspaceTabs || {};
    const zhTabs = zhCommon?.vue?.home?.workspaceTabs || {};

    expect(Object.keys(enTabs).sort()).toEqual(Object.keys(zhTabs).sort());
    expect(enTabs.build).toBeUndefined();
    expect(zhTabs.build).toBeUndefined();
    expect(enTabs.results).toBe('Complete Results');
    expect(zhTabs.results).toBe('完整结果');
    expect(enTabs.baseDesc).toContain('equipment');
    expect(zhTabs.baseDesc).toContain('装备');
  });

  it('defines synchronized inline trigger labels and names empty rules as unconditional', () => {
    const enTrigger = enCommon?.vue?.home?.trigger || {};
    const zhTrigger = zhCommon?.vue?.home?.trigger || {};

    expect(Object.keys(enTrigger).sort()).toEqual(Object.keys(zhTrigger).sort());
    expect(enCommon?.queue?.triggerState?.disabled).toBe('No conditions');
    expect(zhCommon?.queue?.triggerState?.disabled).toBe('无条件');
    expect(enCommon?.vue?.home?.dirtyDraftBlocked).toContain('Save or cancel');
    expect(zhCommon?.vue?.home?.dirtyDraftBlocked).toContain('保存或取消');
    expect(enTrigger.saveOrCancelFirst).toBeUndefined();
    expect(zhTrigger.saveOrCancelFirst).toBeUndefined();
    expect(enTrigger.editorTitle).toBeUndefined();
    expect(zhTrigger.editorTitle).toBeUndefined();
  });

  it('groups Home modal copy under synchronized feature namespaces', () => {
    const namespaceNames = ['combatScrolls', 'houseRooms', 'guildBuffs'];

    for (const namespaceName of namespaceNames) {
      const enNamespace = enCommon?.vue?.home?.[namespaceName] || {};
      const zhNamespace = zhCommon?.vue?.home?.[namespaceName] || {};
      expect(Object.keys(enNamespace).sort()).toEqual(Object.keys(zhNamespace).sort());
      expect(Object.keys(enNamespace).length).toBeGreaterThan(0);
    }

    const flatModalKeyPattern = /^(combatScrolls?|houseRooms|guildBuffs?)[A-Z]/;
    expect(Object.keys(enCommon?.vue?.home || {}).filter((key) => flatModalKeyPattern.test(key))).toEqual([]);
    expect(Object.keys(zhCommon?.vue?.home || {}).filter((key) => flatModalKeyPattern.test(key))).toEqual([]);
    expect(enCommon?.vue?.home?.combatScrolls?.invalidQuantity).toContain('whole number');
    expect(zhCommon?.vue?.home?.combatScrolls?.invalidQuantity).toContain('正整数');
  });

  it('does not duplicate game-defined labels in the common locale', () => {
    for (const common of [enCommon, zhCommon]) {
      expect(common?.vue?.home?.levelLabels).toBeUndefined();
      expect(common?.vue?.home?.equipmentLabels).toBeUndefined();
      expect(common?.vue?.home?.combatStats).toBeUndefined();
      expect(common?.vue?.home?.combatStatsTitle).toBeUndefined();
      expect(common?.vue?.home?.dungeon).toBeUndefined();
      expect(common?.vue?.home?.guildBuffCombat).toBeUndefined();
      expect(common?.vue?.results?.ability).toBeUndefined();
      expect(common?.queue?.changeCategory?.food).toBeUndefined();
      expect(common?.queue?.changeCategory?.drink).toBeUndefined();
      expect(common?.settingsPage?.playerSnapshotTableDungeon).toBeUndefined();
      expect(common?.settingsPage?.playerSnapshotTableLabyrinth).toBeUndefined();
    }
    expect(zhCommon?.enhancement?.observatoryLevel).toBeUndefined();
    expect(zhCommon?.enhancement?.philosophersMirror).toBeUndefined();
  });

  it('keeps manual price queue keys synchronized across locales', () => {
    const manualKeys = [
      'manualPriceSource',
      'manualPricePlaceholder',
      'manualPriceInvalid',
      'manualPriceInvalidRow',
      'priceSelectionInvalid',
      'manualPriceUnit',
      'manualPriceDigitsOnly',
    ];
    for (const key of manualKeys) {
      expect(enCommon?.queue?.[key]).toBeTruthy();
      expect(zhCommon?.queue?.[key]).toBeTruthy();
    }
    expect(enCommon?.queue?.manualPriceSource).toBe('Manual input');
    expect(zhCommon?.queue?.manualPriceSource).toBe('手动输入');
    expect(enCommon?.queue?.manualPriceInvalid).toContain('greater than 0');
    expect(zhCommon?.queue?.manualPriceInvalid).toContain('大于 0');
    expect(enCommon?.queue?.manualPriceInvalidRow).toContain('{{name}} +{{level}}');
    expect(zhCommon?.queue?.manualPriceInvalidRow).toContain('{{name}} +{{level}}');
    expect(enCommon?.queue?.manualPriceInvalidRow).toContain('greater than 0');
    expect(zhCommon?.queue?.manualPriceInvalidRow).toContain('大于 0');
    expect(enCommon?.queue?.manualPricePlaceholder).toContain('buy price');
    expect(zhCommon?.queue?.manualPricePlaceholder).toContain('买入价');
    expect(enCommon?.queue?.manualPriceDigitsOnly).toContain('Numbers only');
    expect(zhCommon?.queue?.manualPriceDigitsOnly).toContain('数字');
    expect(enCommon?.queue?.manualPriceUnit).toBe('Buy price unit');
    expect(zhCommon?.queue?.manualPriceUnit).toBe('买入价单位');
    expect(enCommon?.queue?.priceSelectionInvalid).toContain('greater than 0');
    expect(zhCommon?.queue?.priceSelectionInvalid).toContain('大于 0');
  });

  it('keeps the multi-round result cost column keys synchronized across locales', () => {
    const costColumnKeys = ['equipmentSaleValue', 'equipmentBuyPrice', 'equipmentNetCost', 'upgradeCostComposition'];
    for (const key of costColumnKeys) {
      expect(enCommon?.vue?.queue?.[key]).toBeTypeOf('string');
      expect(enCommon?.vue?.queue?.[key]).toBeTruthy();
      expect(zhCommon?.vue?.queue?.[key]).toBeTypeOf('string');
      expect(zhCommon?.vue?.queue?.[key]).toBeTruthy();
    }
    expect(enCommon?.vue?.queue?.equipmentSaleValue).toContain('Sale Value');
    expect(zhCommon?.vue?.queue?.equipmentSaleValue).toContain('出售价值');
    expect(enCommon?.vue?.queue?.equipmentBuyPrice).toContain('Buy Price');
    expect(zhCommon?.vue?.queue?.equipmentBuyPrice).toContain('买入价');
    expect(enCommon?.vue?.queue?.equipmentNetCost).toContain('Net Cost');
    expect(zhCommon?.vue?.queue?.equipmentNetCost).toContain('净成本');
    expect(enCommon?.vue?.queue?.upgradeCostComposition).toContain('Upgrade Cost');
    expect(zhCommon?.vue?.queue?.upgradeCostComposition).toContain('升级成本');
  });

  it('keeps the multi-round first-round note interpolating the real first successful round', () => {
    // 首轮失败时明细来自第 2+ 个成功轮：两种语言的 firstRoundNote 都必须带 {{round}} 插值
    // （store 的 firstSuccessfulRound 提供），否则页面会退回写死的「第 1 轮」误导解读。
    // 该键同时用于时序图与结果详情标注，两处文案必须覆盖「timeline / result details」。
    expect(enCommon?.vue?.results?.multiRound?.firstRoundNote).toContain('{{round}}');
    expect(enCommon?.vue?.results?.multiRound?.firstRoundNote).toContain('{{rounds}}');
    expect(zhCommon?.vue?.results?.multiRound?.firstRoundNote).toContain('{{round}}');
    expect(zhCommon?.vue?.results?.multiRound?.firstRoundNote).toContain('{{rounds}}');
    expect(enCommon?.vue?.results?.multiRound?.firstRoundNote).toContain('result details');
    expect(zhCommon?.vue?.results?.multiRound?.firstRoundNote).toContain('结果详情');
  });

  it('keeps the multi-round wipe-events empty note synchronized across locales', () => {
    // 多轮运行逐轮关闭战斗事件日志（内存权衡）：Wipe 空态必须说明真实原因（未采集），
    // 不能沿用单轮的「未检测到团灭事件」——两种语言都必须存在该说明键，且键集对齐。
    expect(Object.keys(enCommon?.vue?.results?.multiRound || {}).sort()).toEqual(
      Object.keys(zhCommon?.vue?.results?.multiRound || {}).sort(),
    );
    expect(enCommon?.vue?.results?.multiRound?.wipeEventsNotRecorded).toContain('combat event logs');
    expect(enCommon?.vue?.results?.multiRound?.wipeEventsNotRecorded).toContain('single round');
    expect(zhCommon?.vue?.results?.multiRound?.wipeEventsNotRecorded).toContain('战斗事件日志');
    expect(zhCommon?.vue?.results?.multiRound?.wipeEventsNotRecorded).toContain('1 轮');
  });

  it('keeps every t() fallback string in English across the UI source', () => {
    // t(key, fallback) 的 fallback 是键完全缺失时的最终兜底文案：与 fallbackLng: 'en'
    // 同口径统一为英文，避免中文兜底漏进英文界面（controls.cancel 双语言包缺键时，
    // 英文模式的按钮曾直接显示中文「取消」）。
    const cjk = /[\u3000-\u303F\u4E00-\u9FFF\uFF00-\uFFEF]/;
    const callRe = /\bt\(\s*'(common:[^']+)'\s*,\s*('((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\])*)`)/gs;
    const offenders = [];
    for (const file of collectUiSourceFiles()) {
      const source = readFileSync(file, 'utf8');
      let match;
      while ((match = callRe.exec(source))) {
        const fallback = match[3] ?? match[4] ?? match[5] ?? '';
        if (cjk.test(fallback)) offenders.push(`${path.relative(SRC_ROOT, file)}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the food optimizer bound copy in sync with the domain range constants', () => {
    // invalidSettings 内嵌 1/100/1/10；常量改了文案没改，提示就会与校验不一致。
    // 按出现顺序比对，既允许两种语言的措辞差异，又能捕捉区间错位或漏改。
    const bounds = [
      FOOD_OPTIMIZER_MIN_STEP_PERCENT,
      FOOD_OPTIMIZER_MAX_STEP_PERCENT,
      FOOD_OPTIMIZER_MIN_ROUNDS,
      FOOD_OPTIMIZER_MAX_ROUNDS,
    ];
    for (const locale of [enCommon, zhCommon]) {
      const numbers = (locale.foodOptimizer.invalidSettings.match(/\d+/g) || []).map(Number);
      expect(numbers).toEqual(bounds);
    }
  });

  it('resolves every literal common: t() key from both locale files', () => {
    // UI 引用的字面 common: 键必须在 en/zh 的 common.json 中均可解析：漏键时
    // fallback 文案会直接上屏（zh 模式侥幸正确、en 模式语言错乱），且模板
    // 测试只锚定已知键，无法发现这类缺键。
    const keyRe = /\bt\(\s*'(common:[^']+)'/g;
    const resolve = (resources, key) =>
      key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), resources);
    const missing = [];
    const seen = new Set();
    for (const file of collectUiSourceFiles()) {
      const source = readFileSync(file, 'utf8');
      let match;
      while ((match = keyRe.exec(source))) {
        const key = match[1];
        if (seen.has(key)) continue;
        seen.add(key);
        const dotted = key.slice('common:'.length);
        if (resolve(enCommon, dotted) === undefined || resolve(zhCommon, dotted) === undefined) {
          missing.push(`${path.relative(SRC_ROOT, file)}: ${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

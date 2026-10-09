// @vitest-environment jsdom
// 预算优化页模板测试（模式照 TriggerOptimizerPage.template.test.js）：
//   1) 路由注册与导航元数据；2) 空态 / 开始 / 停止 / 进度区关键 data 属性；
//   3) 设置控件写回 store；4) 升级链步骤列表（v2 报告）+ 链汇总 + 终止原因；
//   5) 步骤卡片 + 候选明细弹窗（已选定高亮 / 档前说明行 / 截断提示 / 展示上限与选定项保底）；
//   6) 应用（自动写回）· 撤销条 / 过期 / 错误 / 取消 / 零步链；
//   7) 文案与域常量、双语言键对齐。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';

import BudgetOptimizerPage from '../pages/BudgetOptimizerPage.vue';
import { useSimulatorStore } from '../../stores/simulatorStore.js';
import { initI18n } from '../i18n/i18n.js';
import appRouter from '../router/index.js';
import enCommon from '../../../locales/en/common.json';
import zhCommon from '../../../locales/zh/common.json';
import {
  BUDGET_OPTIMIZER_MAX_BAND_RATIO,
  BUDGET_OPTIMIZER_MAX_CHAIN_STEPS,
  BUDGET_OPTIMIZER_MAX_MAX_HOUSE_UP,
  BUDGET_OPTIMIZER_MAX_MAX_LEVEL_UP,
  BUDGET_OPTIMIZER_MAX_SIMULATION_HOURS,
  BUDGET_OPTIMIZER_MIN_CHAIN_STEPS,
  BUDGET_OPTIMIZER_MIN_MAX_HOUSE_UP,
  BUDGET_OPTIMIZER_MIN_MAX_LEVEL_UP,
  BUDGET_OPTIMIZER_MIN_SIMULATION_HOURS,
  BUDGET_OPTIMIZER_STEP_CANDIDATES_LIMIT,
} from '../../services/budgetOptimizerDomain.js';

const wrappers = [];
beforeAll(() => initI18n());
beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount());
  wrappers.length = 0;
  vi.restoreAllMocks();
});

// 已导入 + 目标区域的最简就绪态（与 store 的 start 校验矩阵一致）。
function readySetup(store) {
  store.setImportedProfileState('1', true);
  store.simulationSettings.zoneHrid = '/actions/combat/fly';
}

const METRICS = Object.freeze({
  dps: 100,
  dailyNoRngProfit: 5,
  xpPerHour: 1000,
  killsPerHour: 60,
  deathsPerHour: 0,
  rounds: 16,
});

// 链候选记录（步骤选定项与步骤候选快照行同构；字段口径照 budgetOptimizerSearch.buildCandidateRecord）。
function makeCandidate(overrides = {}) {
  return {
    id: 'equip:weapon:regal_sword:15',
    groupKey: 'equip:weapon',
    kind: 'equipment',
    label: 'Regal Sword +15',
    fromLabel: 'Regal Sword +14',
    toLabel: 'Regal Sword +15',
    effect: { type: 'equipment', slotKey: 'weapon', itemHrid: '/items/regal_sword', enhancementLevel: 15 },
    fromEffect: { type: 'equipment', slotKey: 'weapon', itemHrid: '/items/regal_sword', enhancementLevel: 14 },
    cost: 322_000_000,
    method: { key: 'market-buy', count: 15 },
    costDetail: null,
    deltaDps: 3.2,
    deltaObjective: 3.2,
    se: 1.1,
    deltaProfit: 0,
    deltaXp: 0,
    significant: true,
    refined: true,
    rounds: 16,
    manaRegression: false,
    ...overrides,
  };
}

// 第一步：君王之剑 +14 → +15（选定）；快照里再放「粗筛」「不可用」与「免费项」三种证据档的陪跑
// 候选，供展开明细的档前说明行 / 截断提示断言使用。免费项（净支出 0 的正提升）放末尾：旧报告
// （修复前沉在不可用档）就是这种形态，UI 现场重算档位后应显示为独立的免费项档。
function makeSwordStep(overrides = {}) {
  const chosen = makeCandidate();
  const screened = makeCandidate({
    id: 'ability:berserk:33',
    groupKey: 'ability:berserk',
    kind: 'ability',
    label: 'Berserk Lv.33',
    fromLabel: 'Berserk Lv.32',
    toLabel: 'Berserk Lv.33',
    effect: { type: 'ability', abilityHrid: '/abilities/berserk', level: 33 },
    fromEffect: { type: 'ability', abilityHrid: '/abilities/berserk', level: 32 },
    cost: 20_000_000,
    deltaDps: 0.5,
    deltaObjective: 0.5,
    significant: false,
    refined: false,
  });
  const unusable = makeCandidate({
    id: 'equip:weapon:regal_sword:16',
    label: 'Regal Sword +16',
    fromLabel: 'Regal Sword +15',
    toLabel: 'Regal Sword +16',
    effect: { type: 'equipment', slotKey: 'weapon', itemHrid: '/items/regal_sword', enhancementLevel: 16 },
    fromEffect: { type: 'equipment', slotKey: 'weapon', itemHrid: '/items/regal_sword', enhancementLevel: 15 },
    cost: 50_000_000,
    deltaDps: -1.5,
    deltaObjective: -1.5,
    significant: false,
  });
  // 免费项：净支出 0 且提升为正（旧件卖价高于新件买价）→ 独立档，不再与「不可用」混排。
  const free = makeCandidate({
    id: 'equip:weapon:regal_sword:13',
    groupKey: 'equip:weapon',
    label: 'Regal Sword +13',
    fromLabel: 'Regal Sword +12',
    toLabel: 'Regal Sword +13',
    effect: { type: 'equipment', slotKey: 'weapon', itemHrid: '/items/regal_sword', enhancementLevel: 13 },
    fromEffect: { type: 'equipment', slotKey: 'weapon', itemHrid: '/items/regal_sword', enhancementLevel: 12 },
    cost: 0,
    deltaDps: 1.2,
    deltaObjective: 1.2,
  });
  return {
    index: 0,
    candidate: chosen,
    cost: 322_000_000,
    deltaObjective: 3.2,
    deltaDps: 3.2,
    se: 1.1,
    baselineBefore: { ...METRICS, failed: false },
    candidatesSnapshot: { candidates: [chosen, screened, unusable, free], total: 7, truncated: 3 },
    remainingBudgetAfter: 678_000_000,
    elapsedSeconds: 41,
    ...overrides,
  };
}

// 第二步：狂暴 Lv.32 → Lv.35（选定）；单条快照（无分档说明行 / 无截断）。
function makeBerserkStep(overrides = {}) {
  const chosen = makeCandidate({
    id: 'ability:berserk:35',
    groupKey: 'ability:berserk',
    kind: 'ability',
    label: 'Berserk Lv.35',
    fromLabel: 'Berserk Lv.32',
    toLabel: 'Berserk Lv.35',
    effect: { type: 'ability', abilityHrid: '/abilities/berserk', level: 35 },
    fromEffect: { type: 'ability', abilityHrid: '/abilities/berserk', level: 32 },
    cost: 183_000_000,
    deltaDps: 5,
    deltaObjective: 5,
    se: 2,
  });
  return {
    index: 1,
    candidate: chosen,
    cost: 183_000_000,
    deltaObjective: 5,
    deltaDps: 5,
    se: 2,
    baselineBefore: { ...METRICS, failed: false },
    candidatesSnapshot: { candidates: [chosen], total: 1, truncated: 0 },
    remainingBudgetAfter: 495_000_000,
    elapsedSeconds: 83,
    ...overrides,
  };
}

// 「搜索完成」形态的 v2 链报告（字段口径与 budgetOptimizerSearch.optimizeBudgetUpgrades 一致；
// finalConfig 由 store 在写 results 前剥离，这里直接给剥完的形状）。
function makeResult(store, overrides = {}) {
  return {
    version: 2,
    createdAt: Date.now(),
    elapsedSeconds: 90,
    cancelled: false,
    stopReason: 'exhausted',
    objective: 'dps',
    settings: { budgetCoins: 1_000_000_000, budgetHigh: 1_200_000_000, teammateIds: [] },
    baseline: { metrics: { ...METRICS, failed: false } },
    verification: null,
    steps: [makeSwordStep(), makeBerserkStep()],
    totalCost: 505_000_000,
    remainingBudget: 495_000_000,
    finalSnapshot: null,
    diagnostics: {
      skippedNoPrice: 3,
      // 缺价明细（结构化 effect；测试环境无官方语言包时展示名回退 hrid 本身）。house 条目带
      // unpricedMaterials（缺价材料 hrid 数组，domain 房子缺价分支产出）：一个已知物品
      // 断言经 getItemName 解析为中文名，另一个语言包外的 hrid 断言回退 hrid 原文。
      skippedNoPriceDetails: [
        {
          kind: 'equipment',
          effect: { type: 'equipment', slotKey: 'weapon', itemHrid: '/items/regal_sword', enhancementLevel: 12 },
        },
        {
          kind: 'equipment',
          effect: { type: 'equipment', slotKey: 'weapon', itemHrid: '/items/regal_sword_refined', enhancementLevel: 3 },
        },
        {
          kind: 'house',
          effect: { type: 'house', roomHrid: '/house_rooms/archery', level: 1 },
          unpricedMaterials: ['/items/regal_sword', '/items/unpriced_material_without_official_name'],
        },
      ],
      candidateCount: 6,
      stages: [],
      simulations: 100,
      evaluations: 50,
      racingUsed: true,
      steps: 2,
    },
    inputSignature: store.budgetOptimizerInputSignature,
    appliedInputSignature: '',
    stale: false,
    ...overrides,
  };
}

async function mountPage(configure = () => {}) {
  const store = useSimulatorStore();
  configure(store);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/budget-optimizer', component: BudgetOptimizerPage },
      { path: '/home', component: { template: '<div />' } },
    ],
  });
  await router.push('/budget-optimizer');
  const wrapper = mount(BudgetOptimizerPage, { global: { plugins: [router] } });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, store };
}

// 关闭步骤候选明细弹窗：点 BaseModal 右上角的关闭按钮（弹窗内容 teleport 到 body）。
async function closeCandidatesDialog() {
  document.body.querySelector('[role="dialog"]').querySelector('button').click();
  await flushPromises();
}

describe('budget optimizer page', () => {
  it('registers a lazy simulation route right below the trigger optimizer', () => {
    const route = appRouter.getRoutes().find((entry) => entry.name === 'budget-optimizer');
    expect(route.path).toBe('/budget-optimizer');
    expect(typeof route.components.default).toBe('function');
    expect(route.meta).toMatchObject({
      showCombatToolbar: false,
      navLabelKey: 'common:menu.budgetOptimizer',
      navGroup: 'simulation',
      navOrder: 2.7,
    });
  });

  it('blocks the search without imported data and links to the Home page', async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.find('[data-budget-optimizer-page]').exists()).toBe(true);
    expect(wrapper.text()).toContain('预算优化');
    expect(wrapper.get('[data-budget-optimizer-start]').element.disabled).toBe(true);
    expect(wrapper.text()).toContain('当前玩家尚未导入角色信息。');
    const empty = wrapper.get('[data-budget-optimizer-empty]');
    expect(empty.text()).toContain('尚未导入角色数据');
    expect(empty.find('a').attributes('href')).toBe('/home');
  });

  it('starts the chain through the store action and keeps the progress details while running', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const start = wrapper.get('[data-budget-optimizer-start]');
    expect(start.element.disabled).toBe(false);

    const startSpy = vi.spyOn(store, 'startBudgetOptimizer').mockImplementation(() => {});
    await start.trigger('click');
    expect(startSpy).toHaveBeenCalledOnce();

    const stopSpy = vi.spyOn(store, 'stopBudgetOptimizer').mockImplementation(() => {});
    Object.assign(store.budgetOptimizer.runtime, {
      isRunning: true,
      phase: 'refining',
      progress: 0.4,
      elapsedSeconds: 96,
      evaluated: 128,
      total: 205,
      stepsDone: 2,
    });
    await flushPromises();
    expect(wrapper.find('[data-budget-optimizer-start]').exists()).toBe(false);
    expect(wrapper.find('[data-budget-optimizer-stop]').exists()).toBe(true);
    expect(wrapper.find('[data-budget-optimizer-progress-stop]').exists()).toBe(true);
    // 运行中设置控件全部禁用（preset 与两个数字输入为代表）。
    expect(wrapper.get('[data-budget-optimizer-preset]').element.disabled).toBe(true);
    expect(wrapper.get('[data-budget-optimizer-hours]').element.disabled).toBe(true);
    expect(wrapper.get('[data-budget-optimizer-step-limit]').element.disabled).toBe(true);
    // 进度明细：阶段名 / 候选评估 / 已完成步数 / 已用时间。
    expect(wrapper.get('[data-budget-optimizer-phase]').text()).toContain('候选精筛');
    expect(wrapper.get('[data-budget-optimizer-evaluated]').text()).toContain('128');
    expect(wrapper.get('[data-budget-optimizer-evaluated]').text()).toContain('205');
    expect(wrapper.get('[data-budget-optimizer-steps-done]').text()).toContain('已完成步数');
    expect(wrapper.get('[data-budget-optimizer-steps-done]').text()).toContain('2');
    expect(wrapper.get('[data-budget-optimizer-elapsed]').text()).toContain('96');
    expect(Number(wrapper.get('[data-budget-optimizer-progress-bar]').element.value)).toBeCloseTo(0.4, 5);

    await wrapper.get('[data-budget-optimizer-stop]').trigger('click');
    expect(stopSpy).toHaveBeenCalledOnce();
    await wrapper.get('[data-budget-optimizer-progress-stop]').trigger('click');
    expect(stopSpy).toHaveBeenCalledTimes(2);
  });

  it('streams the chain steps and totals from the runtime while the search is still running', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    Object.assign(store.budgetOptimizer.runtime, {
      isRunning: true,
      phase: 'applying',
      progress: 0.5,
      elapsedSeconds: 45,
      evaluated: 12,
      total: 20,
      stepsDone: 1,
    });
    await flushPromises();
    store.budgetOptimizer.runtime.chainSteps.push(makeSwordStep());
    await flushPromises();

    // 一步完成即上屏（不必等链结束）：行数 / 最新标记 / 变化文本都来自 runtime.chainSteps。
    const list = wrapper.get('[data-budget-optimizer-steps]');
    expect(list.findAll('[data-budget-optimizer-step]')).toHaveLength(1);
    expect(list.get('[data-budget-optimizer-step="0"]').text()).toContain('最新');
    expect(list.get('[data-budget-optimizer-step="0"] [data-budget-optimizer-step-change]').text()).toContain(
      '君王之剑 +14 → 君王之剑 +15',
    );
    expect(wrapper.get('[data-budget-optimizer-phase]').text()).toContain('应用到链');
    // 运行中汇总：累计花费 / 剩余额度取最后一步余量；终止原因未定不显示。
    expect(wrapper.get('[data-budget-optimizer-chain-total-cost]').text()).toContain('322m');
    expect(wrapper.get('[data-budget-optimizer-chain-remaining]').text()).toContain('678m');
    // 运行中还没有链起点基线，百分比无定义 → 占位符（而不是被折成 0.0%）。
    // 运行中按设置口径（默认利润）显示，而不是回退到 DPS 常量（回归锚点）。
    expect(wrapper.get('[data-budget-optimizer-chain-total-delta]').text()).toContain('累计 Δ利润 —');
    expect(wrapper.find('[data-budget-optimizer-chain-stop-reason]').exists()).toBe(false);
    // 基线在运行中无报告值（占位符）；优化后推算同样依赖基线 → 占位符；步数与进度条同步。
    expect(wrapper.get('[data-budget-optimizer-baseline]').text()).toContain('—');
    expect(wrapper.get('[data-budget-optimizer-final-value]').text()).toBe('—');
    expect(wrapper.find('[data-budget-optimizer-final-delta]').exists()).toBe(false);
    expect(wrapper.get('[data-budget-optimizer-steps-done]').text()).toContain('1');
    expect(Number(wrapper.get('[data-budget-optimizer-progress-bar]').element.value)).toBeCloseTo(0.5, 5);
  });

  // 停止收尾窗口（2026-10-09 修复）：isRunning 已置假、取消报告尚未回填（serviceRunInFlight 仍为真）。
  // 该窗口内进度区与结果区必须保持上屏（已模拟完的步骤照旧可见）、开始按钮保持禁用，
  // 且不得把用户自己的收尾说成「其他模拟或行情任务正在运行」。
  it('keeps both areas on screen during the stop cleanup window without blaming other tasks', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    Object.assign(store.budgetOptimizer.runtime, {
      isRunning: false,
      phase: 'cancelled',
      progress: 0.42,
      elapsedSeconds: 96,
      stepsDone: 1,
      serviceRunInFlight: true,
    });
    await flushPromises();
    store.budgetOptimizer.runtime.chainSteps.push(makeSwordStep());
    await flushPromises();

    // 两个区都在；数据源仍是 runtime.chainSteps（报告还没回填），步骤卡片照旧上屏。
    expect(wrapper.find('[data-budget-optimizer-progress]').exists()).toBe(true);
    expect(wrapper.find('[data-budget-optimizer-results]').exists()).toBe(true);
    expect(wrapper.findAll('[data-budget-optimizer-step]')).toHaveLength(1);
    expect(wrapper.get('[data-budget-optimizer-phase]').text()).toContain('链已停止');
    // 进度读数保留：进度条停在停止瞬间的值，已用时间冻结在最后一次上报值（页面无计时器）。
    expect(Number(wrapper.get('[data-budget-optimizer-progress-bar]').element.value)).toBeCloseTo(0.42, 5);
    expect(wrapper.get('[data-budget-optimizer-elapsed]').text()).toContain('96');
    // 停止按钮随 isRunning 收起；开始按钮因「在途收尾」保持禁用（与 store 的 busy 闸门一致）。
    expect(wrapper.find('[data-budget-optimizer-progress-stop]').exists()).toBe(false);
    expect(wrapper.get('[data-budget-optimizer-start]').element.disabled).toBe(true);
    // 关键回归点：不得误报「被其他任务占用」。
    expect(wrapper.text()).not.toContain('其他模拟或行情任务正在运行');

    // 取消报告回填 → 切回报告口径（相位 / 停因 / 步骤都来自报告）。
    store.budgetOptimizer.runtime.serviceRunInFlight = false;
    store.budgetOptimizer.results = makeResult(store, {
      cancelled: true,
      stopReason: 'cancelled',
      steps: [makeSwordStep()],
    });
    await flushPromises();
    expect(wrapper.findAll('[data-budget-optimizer-step]')).toHaveLength(1);
    expect(wrapper.get('[data-budget-optimizer-chain-stop-reason]').text()).toContain('已手动停止');
    expect(wrapper.find('[data-budget-optimizer-progress-stop]').exists()).toBe(false);
    expect(wrapper.get('[data-budget-optimizer-start]').element.disabled).toBe(false);
  });

  // 「报告永不回填」的残留期加固（2026-10-09）：停止后迟到的非取消结果被 store 的 runId 闸门丢弃，
  // 报告永远不来、收尾标志也已清空 —— 数据源仍回退 runtime，两区不再长期空白。
  it('keeps the runtime steps visible when the report never lands', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    expect(store.budgetOptimizer.results.createdAt).toBeFalsy();
    Object.assign(store.budgetOptimizer.runtime, {
      isRunning: false,
      phase: 'cancelled',
      progress: 0.42,
      elapsedSeconds: 96,
      stepsDone: 1,
      serviceRunInFlight: false,
    });
    await flushPromises();
    store.budgetOptimizer.runtime.chainSteps.push(makeSwordStep());
    await flushPromises();

    expect(wrapper.find('[data-budget-optimizer-progress]').exists()).toBe(true);
    expect(wrapper.find('[data-budget-optimizer-results]').exists()).toBe(true);
    expect(wrapper.findAll('[data-budget-optimizer-step]')).toHaveLength(1);
    // 汇总口径同样回退 runtime（累计花费取 chainSteps 累加），不是空报告的 0。
    expect(wrapper.get('[data-budget-optimizer-chain-total-cost]').text()).toContain('322m');
    expect(wrapper.text()).not.toContain('其他模拟或行情任务正在运行');
  });

  // 加固的边界（2026-10-09）：reset（导入新存档 / 恢复快照）把 phase 复位成 idle 并清掉报告，
  // 此刻 runtime.chainSteps 是上一份存档的残留 —— 必须收起，不能把旧链步骤挂到新存档上。
  it('hides the leftover runtime steps after a player-data reset', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    Object.assign(store.budgetOptimizer.runtime, { isRunning: false, phase: 'cancelled', stepsDone: 1 });
    store.budgetOptimizer.runtime.chainSteps.push(makeSwordStep());
    await flushPromises();
    expect(wrapper.findAll('[data-budget-optimizer-step]')).toHaveLength(1);

    store.resetBudgetOptimizerResults();
    await flushPromises();

    expect(wrapper.find('[data-budget-optimizer-results]').exists()).toBe(false);
    expect(wrapper.find('[data-budget-optimizer-progress]').exists()).toBe(false);
  });

  // 运行中点击卡片按钮打开候选明细弹窗（teleport 到 body）；每完成一步都能单独查看，
  // 且不自动弹窗打扰 —— 详情从行内展开改为弹窗后，自动展开行为随之移除（2026-10-08）。
  it('opens the candidates dialog for each freshly streamed step without auto-opening it', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    Object.assign(store.budgetOptimizer.runtime, {
      isRunning: true,
      phase: 'applying',
      progress: 0.5,
      stepsDone: 1,
    });
    await flushPromises();
    store.budgetOptimizer.runtime.chainSteps.push(makeSwordStep());
    await flushPromises();

    // 弹窗不自动打开；卡片按钮是该步候选明细的唯一入口。
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();

    await wrapper.get('[data-budget-optimizer-step-candidates-open="0"]').trigger('click');
    await flushPromises();
    expect(document.body.querySelector('[data-budget-optimizer-step-candidates="0"]')).toBeTruthy();
    await closeCandidatesDialog();

    store.budgetOptimizer.runtime.chainSteps.push(makeBerserkStep());
    await flushPromises();
    await wrapper.get('[data-budget-optimizer-step-candidates-open="1"]').trigger('click');
    await flushPromises();
    // 弹窗按步骤 index 定位：新步骤展示自己的快照（标题带步号），不会串到上一步。
    const dialogRoot = document.body.querySelector('[role="dialog"]');
    expect(dialogRoot.textContent).toContain('第 2 步');
    expect(document.body.querySelector('[data-budget-optimizer-step-candidates="1"]')).toBeTruthy();
    expect(document.body.querySelector('[data-budget-optimizer-step-candidates="0"]')).toBeFalsy();
  });

  it('edits optimizer settings from the inputs and shows the derived budget band', async () => {
    const { wrapper, store } = await mountPage(readySetup);

    // 默认 1B 预算：区间 800m ~ 1.2b（bandRatio 0.2；金额复用项目的紧凑格式化工具，小写后缀）。
    expect(wrapper.get('[data-budget-optimizer-band]').text()).toContain('800m');
    expect(wrapper.get('[data-budget-optimizer-band]').text()).toContain('1.2b');

    await wrapper.get('[data-budget-optimizer-budget]').setValue('1500');
    expect(store.budgetOptimizer.settings.budgetCoins).toBe(1_500_000_000);
    await flushPromises();
    expect(wrapper.get('[data-budget-optimizer-band]').text()).toContain('1.8b');

    await wrapper.get('[data-budget-optimizer-max-level-up]').setValue('5');
    expect(store.budgetOptimizer.settings.maxLevelUp).toBe(5);

    await wrapper.get('[data-budget-optimizer-hours]').setValue('48');
    expect(store.budgetOptimizer.settings.simulationHours).toBe(48);

    const presetSelect = wrapper.get('[data-budget-optimizer-preset]');
    // 档位下拉：fast / standard / fine（2026-10-09 新增精细档），选择写回 store（白名单保留）。
    expect(presetSelect.findAll('option').map((option) => option.element.value)).toEqual(['fast', 'standard', 'fine']);
    await presetSelect.setValue('fast');
    expect(store.budgetOptimizer.settings.searchPreset).toBe('fast');
    await presetSelect.setValue('fine');
    expect(store.budgetOptimizer.settings.searchPreset).toBe('fine');

    await wrapper.get('[data-budget-optimizer-enable-equipment]').setValue(false);
    expect(store.budgetOptimizer.settings.enableEquipment).toBe(false);

    // 定选显著性门槛开关：2026-10-09 起默认开启；取消勾选可关闭，写回 store。
    expect(store.budgetOptimizer.settings.pickSignificanceGate).toBe(true);
    await wrapper.get('[data-budget-optimizer-significance-gate]').setValue(false);
    expect(store.budgetOptimizer.settings.pickSignificanceGate).toBe(false);
    await wrapper.get('[data-budget-optimizer-significance-gate]').setValue(true);
    expect(store.budgetOptimizer.settings.pickSignificanceGate).toBe(true);
    expect(wrapper.get('[data-budget-optimizer-significance-gate-hint]').text()).toContain('p < 0.05');

    // 优化目标：下拉顺序「利润 → DPS → 经验」且默认选中利润（归一化缺省）；切到经验验证写回链路。
    const objectiveSelect = wrapper.get('[data-budget-optimizer-objective]');
    expect(objectiveSelect.findAll('option').map((option) => option.element.value)).toEqual(['profit', 'dps', 'xp']);
    expect(objectiveSelect.element.value).toBe('profit');
    await objectiveSelect.setValue('xp');
    expect(store.budgetOptimizer.settings.objective).toBe('xp');

    // 模拟步数：下拉 = 用完预算 / 5 / 10 / 15 / 自定义，默认「用完预算」（unlimited，旧行为）；
    // 预设直接落 custom 模式 + 对应步数；「自定义」显示数字输入框并写回（钳制由 store 归一化兜底）。
    const stepLimitSelect = wrapper.get('[data-budget-optimizer-step-limit]');
    expect(stepLimitSelect.findAll('option').map((option) => option.element.value)).toEqual([
      'unlimited',
      '5',
      '10',
      '15',
      'custom',
    ]);
    expect(stepLimitSelect.element.value).toBe('unlimited');
    await stepLimitSelect.setValue('5');
    expect(store.budgetOptimizer.settings.stepLimitMode).toBe('preset');
    expect(store.budgetOptimizer.settings.maxChainSteps).toBe(5);
    await stepLimitSelect.setValue('custom');
    await wrapper.get('[data-budget-optimizer-max-chain-steps]').setValue('7');
    expect(store.budgetOptimizer.settings.stepLimitMode).toBe('custom');
    expect(store.budgetOptimizer.settings.maxChainSteps).toBe(7);
    await stepLimitSelect.setValue('unlimited');
    expect(store.budgetOptimizer.settings.stepLimitMode).toBe('unlimited');
  });

  it('flags an invalid draft and disables the start button until it is fixed', async () => {
    const { wrapper } = await mountPage(readySetup);

    await wrapper.get('[data-budget-optimizer-hours]').setValue('');
    await flushPromises();
    expect(wrapper.get('[data-budget-optimizer-hours]').attributes('aria-invalid')).toBe('true');
    expect(wrapper.get('[data-budget-optimizer-start]').element.disabled).toBe(true);
    expect(wrapper.text()).toContain('预算须大于 0');

    await wrapper.get('[data-budget-optimizer-hours]').setValue('24');
    await flushPromises();
    expect(wrapper.get('[data-budget-optimizer-start]').element.disabled).toBe(false);
  });

  it('lists the other players as party teammates and writes the selection into settings', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    // 队友候选只列已导入的槽位（2026-10-04 对齐幽灵队友防御）：默认玩家表 1..5，
    // 主角 1 排除，只有标记导入的槽位才出现在 chips 里 —— 未导入空槽位不给出无效勾选。
    store.setImportedProfileState('2', true);
    await flushPromises();

    const party = wrapper.get('[data-budget-optimizer-party]');
    expect(party.findAll('[data-budget-optimizer-party-player]')).toHaveLength(1);
    expect(party.get('[data-budget-optimizer-party-player="2"]'));
    expect(party.get('[data-budget-optimizer-party-hint]').text()).toContain('只改主角');

    await party.get('[data-budget-optimizer-party-player="2"] input').setValue(true);
    await flushPromises();
    expect(store.budgetOptimizer.settings.partyPlayerIds).toEqual(['2']);

    await wrapper.get('[data-budget-optimizer-party-player="2"] input').setValue(false);
    await flushPromises();
    expect(store.budgetOptimizer.settings.partyPlayerIds).toEqual([]);
  });

  it('shows the read-only target context picked up from the Home simulation settings', async () => {
    const { wrapper } = await mountPage(readySetup);
    const page = wrapper.get('[data-budget-optimizer-page]');
    expect(page.text()).toContain('目标场景');
    expect(page.text()).toContain('难度 0');
    // 目标场景只读展示 + 跳主页修改入口。
    expect(page.findAll('a').some((link) => link.attributes('href') === '/home')).toBe(true);
    expect(page.text()).toContain('模拟时长');
  });

  it('renders the chain summary and one card per step from the v2 report', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.budgetOptimizer.results = makeResult(store);
    await flushPromises();

    // 应用提示 / 缺价跳过；未应用时撤销条缺席。
    expect(wrapper.get('[data-budget-optimizer-apply-hint]').text()).toContain('链结束后自动');
    expect(wrapper.get('[data-budget-optimizer-skipped]').text()).toContain('3');
    expect(wrapper.find('[data-budget-optimizer-applied-bar]').exists()).toBe(false);

    // 每步一张独立卡片（2026-10-08 重构：不再拼线成单个大容器）：容器只做网格 + 间距，
    // 卡片自带圆角边框。
    const list = wrapper.get('[data-budget-optimizer-steps]');
    expect(list.classes()).toContain('grid');
    expect(list.classes()).toContain('sm:grid-cols-2');
    expect(list.findAll('[data-budget-optimizer-step]')).toHaveLength(2);

    // 步骤卡片：圆角独立卡 + 步号徽章（与色点同色）+ 变化 + 字段网格（花费 / Δ目标 / 剩余额度 / 耗时）
    // + 候选明细入口。
    const first = list.get('[data-budget-optimizer-step="0"]');
    expect(first.classes()).toContain('rounded-lg');
    expect(first.classes()).toContain('border');
    expect(first.get('[data-budget-optimizer-step-badge]').text()).toContain('第 1 步');
    expect(first.get('[data-budget-optimizer-step-change]').text()).toContain('君王之剑 +14 → 君王之剑 +15');
    expect(first.text()).toContain('花费');
    expect(first.text()).toContain('ΔDPS');
    expect(first.get('[data-budget-optimizer-step-cost]').text()).toContain('322m');
    expect(first.get('[data-budget-optimizer-step-delta]').text()).toContain('+3.20%');
    // 字段完整标签（剩余额度 / 累计耗时），值带 data 锚点。
    expect(first.get('[data-budget-optimizer-step-remaining]').element.previousElementSibling.textContent).toBe(
      '剩余额度',
    );
    expect(first.get('[data-budget-optimizer-step-remaining]').text()).toContain('678m');
    // 累计耗时（链起点到该步完成，非单步耗时）。
    expect(first.get('[data-budget-optimizer-step-elapsed]').element.previousElementSibling.textContent).toBe(
      '累计耗时',
    );
    expect(first.get('[data-budget-optimizer-step-elapsed]').text()).toContain('41 s');
    // 「候选明细」按钮在格子头部行（与步号徽章同行，右上角），不单独占一行。
    const head = first.get('[data-budget-optimizer-step-head]');
    expect(head.get('[data-budget-optimizer-step-badge]').exists()).toBe(true);
    expect(head.get('[data-budget-optimizer-step-candidates-open]').text()).toContain('候选明细');
    // 字段区 2×2 网格：四个字段项（花费 / Δ目标 / 剩余额度 / 累计耗时）。
    expect(first.get('[data-budget-optimizer-step-fields]').findAll('dt')).toHaveLength(4);

    const second = list.get('[data-budget-optimizer-step="1"]');
    expect(second.get('[data-budget-optimizer-step-change]').text()).toContain('狂暴 Lv.32 → 狂暴 Lv.35');
    expect(second.get('[data-budget-optimizer-step-delta]').text()).toContain('+5.00%');
    expect(second.get('[data-budget-optimizer-step-remaining]').text()).toContain('495m');

    // 步骤强调色只落在「色点 + 步号徽章文字」上（同色；2026-10-08 收敛：不再铺格底色渐变），
    // 颜色按步骤序号轮转（相邻步骤不同色，消除同款块的重复感）。
    const firstDotStyle = first.get('[data-budget-optimizer-step-dot]').attributes('style') || '';
    const secondDotStyle = second.get('[data-budget-optimizer-step-dot]').attributes('style') || '';
    expect(firstDotStyle).toContain('background-color');
    expect(firstDotStyle).not.toBe(secondDotStyle);
    // 步号徽章文字与色点同色（dot 是 background-color，徽章是 color，数值一致）。
    const firstBadgeStyle = first.get('[data-budget-optimizer-step-badge]').attributes('style') || '';
    expect(firstBadgeStyle).toContain(firstDotStyle.replace('background-color', 'color'));

    // 链汇总：总花费 / 剩余额度 / 累计 Δ（各步 Δ 之和）/ 终止原因。
    const summary = wrapper.get('[data-budget-optimizer-chain-summary]');
    expect(summary.get('[data-budget-optimizer-chain-total-cost]').text()).toContain('总花费 505m');
    expect(summary.get('[data-budget-optimizer-chain-remaining]').text()).toContain('剩余额度 495m');
    expect(summary.get('[data-budget-optimizer-chain-total-delta]').text()).toContain('累计 ΔDPS +5.10%');
    expect(summary.get('[data-budget-optimizer-chain-stop-reason]').text()).toContain('剩余额度内已无可买项');
    expect(wrapper.find('[data-budget-optimizer-chain-empty]').exists()).toBe(false);

    // 基线徽章：链起点目标指标绝对值 + 优化后主口径值（无复验 → 保守推算 = 基线 + Σ(Δ−1×se)）
    // + 增量徽标。本装置 se 1.1 / 2 → 保守累计 (3.2−1.1)+(5−2)=5.1 → 105.1（账面乐观值为 108.2）。
    const baseline = wrapper.get('[data-budget-optimizer-baseline]');
    expect(baseline.text()).toContain('链起点 · DPS');
    expect(baseline.text()).toContain('100');
    expect(baseline.get('[data-budget-optimizer-final-label]').text()).toContain('优化后（预估）· DPS');
    expect(baseline.get('[data-budget-optimizer-final-value]').text()).toBe('105.1');
    expect(baseline.get('[data-budget-optimizer-final-delta]').text()).toBe('+5.1');
    // 报告无 verification（旧报告 / 取消 / 零步链 / 复验失败）→ 主口径就是保守推算：无复验徽标、
    // 无账面对照（账面原值 108.2 只在有复验时作为对照出现）。
    expect(wrapper.find('[data-budget-optimizer-verification-rounds]').exists()).toBe(false);
    expect(wrapper.find('[data-budget-optimizer-ledger-label]').exists()).toBe(false);
  });

  it('shows the paired verification (start → final) with its delta when the report carries one', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const results = makeResult(store);
    // 配对复验：起点/终点在同一批独立种子下各测一次（终点 103.4，配对 Δ 3.4 < 推算 8.2 → 账面乐观）。
    results.verification = {
      rounds: 50,
      baseline: { metrics: { ...METRICS, dps: 100, rounds: 50, failed: false } },
      final: { metrics: { ...METRICS, dps: 103.4, rounds: 50, failed: false } },
      paired: { rounds: 50, mean: 3.4, stdError: 0.2, pValue: 0.01, verdict: 'positive' },
    };
    store.budgetOptimizer.results = results;
    await flushPromises();

    // 主口径 = 复验真值：「优化后 · DPS 103.4 +3.4（复验 50 场（配对））」。
    const baseline = wrapper.get('[data-budget-optimizer-baseline]');
    expect(baseline.get('[data-budget-optimizer-final-label]').text()).toContain('优化后 · DPS');
    expect(baseline.get('[data-budget-optimizer-final-value]').text()).toBe('103.4');
    expect(baseline.get('[data-budget-optimizer-final-delta]').text()).toBe('+3.4');
    expect(baseline.get('[data-budget-optimizer-verification-rounds]').text()).toContain('50');
    // 账面对照（乐观原值 = 基线 + 各步自评 Δ 之和）：与复验 Δ 的差就是纸面增益幅度。
    expect(baseline.get('[data-budget-optimizer-ledger-label]').text()).toContain('账面 · DPS');
    expect(baseline.get('[data-budget-optimizer-ledger-value]').text()).toBe('108.2');
    expect(baseline.get('[data-budget-optimizer-ledger-delta]').text()).toBe('+8.2');

    // 旧形状兼容（v4.1 过渡：只有 metrics + deltaVsBaseline）→ 主口径仍取复验值。
    const legacy = makeResult(store);
    legacy.verification = {
      metrics: { ...METRICS, dps: 103.4, rounds: 50, failed: false },
      deltaVsBaseline: 3.4,
    };
    store.budgetOptimizer.results = legacy;
    await flushPromises();
    const legacyBaseline = wrapper.get('[data-budget-optimizer-baseline]');
    expect(legacyBaseline.get('[data-budget-optimizer-final-value]').text()).toBe('103.4');
    expect(legacyBaseline.get('[data-budget-optimizer-final-delta]').text()).toBe('+3.4');
  });

  it('opens the candidates dialog of a per-step card and closes it again', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.budgetOptimizer.results = makeResult(store);
    await flushPromises();

    // 报告加载后不自动弹窗；每张卡片各有自己的候选明细入口。
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(wrapper.findAll('[data-budget-optimizer-step-candidates-open]')).toHaveLength(2);

    // 点第 1 步卡片：弹窗标题带步号 + 明细 hint；表格在弹窗内（teleport 到 body）。
    await wrapper.get('[data-budget-optimizer-step-candidates-open="0"]').trigger('click');
    await flushPromises();
    const dialogRoot = document.body.querySelector('[role="dialog"]');
    expect(dialogRoot.textContent).toContain('第 1 步 · 候选明细');
    const dialog = document.body.querySelector('[data-budget-optimizer-step-candidates-dialog]');
    expect(dialog.querySelector('[data-budget-optimizer-step-candidates-hint]').textContent).toContain('本步候选明细');

    // 关闭：弹窗内容卸载（关闭即消失，不留折叠残影）。
    await closeCandidatesDialog();
    expect(document.body.querySelector('[data-budget-optimizer-step-candidates-dialog]')).toBeNull();

    // 再开第 2 步：一次只看一步（单开语义内建在弹窗里）。
    await wrapper.get('[data-budget-optimizer-step-candidates-open="1"]').trigger('click');
    await flushPromises();
    expect(document.body.querySelector('[role="dialog"]').textContent).toContain('第 2 步 · 候选明细');
  });

  it('shows the per-step candidate snapshot with the chosen row highlighted, band dividers and the truncation note', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.budgetOptimizer.results = makeResult(store);
    await flushPromises();
    await wrapper.get('[data-budget-optimizer-step-candidates-open="0"]').trigger('click');
    await flushPromises();

    // 弹窗内容 teleport 到 body：用原生 DOM 断言（wrapper.find 看不到 portal 内容）。
    const table = document.body.querySelector('[data-budget-optimizer-step-candidates="0"]');
    const headers = [...table.querySelectorAll('th')].map((th) => th.textContent);
    for (const header of ['组', '变化', '花费', 'ΔDPS', '性价比', '显著', '精度']) {
      expect(headers.some((text) => text.includes(header))).toBe(true);
    }

    const rows = [...table.querySelectorAll('[data-budget-optimizer-step-candidate]')];
    expect(rows).toHaveLength(4);
    // 选定行：加粗高亮 +「已选定」标记 + 全字段。
    const chosen = rows[0];
    expect(chosen.classList.contains('font-medium')).toBe(true);
    expect(chosen.textContent).toContain('君王之剑 +14 → 君王之剑 +15');
    expect(chosen.textContent).toContain('已选定');
    expect(chosen.textContent).toContain('322m');
    expect(chosen.textContent).toContain('+3.20%');
    expect(chosen.textContent).toContain('9.9%/B');
    expect(chosen.textContent).toContain('精筛');
    expect(rows[1].textContent).not.toContain('已选定');
    // 粗筛陪跑候选（证据不足）与不可用沉底行。
    expect(rows[1].textContent).toContain('狂暴 Lv.32 → 狂暴 Lv.33');
    expect(rows[1].textContent).toContain('20m');
    expect(rows[1].textContent).toContain('+0.50%');
    expect(rows[1].textContent).toContain('25.0%/B');
    expect(rows[1].textContent).toContain('粗筛');
    expect(rows[2].textContent).toContain('君王之剑 +15 → 君王之剑 +16');
    expect(rows[2].textContent).toContain('-30.0%/B');
    // Δ 列颜色：正提升绿、负提升红。
    expect([...chosen.querySelectorAll('td')][3].classList.contains('text-success')).toBe(true);
    expect([...rows[2].querySelectorAll('td')][3].classList.contains('text-destructive')).toBe(true);
    // 免费项行（净支出 0 的正提升）：Δ 绿（不属于「不可用」档）。
    expect(rows[3].textContent).toContain('君王之剑 +12 → 君王之剑 +13');
    expect([...rows[3].querySelectorAll('td')][3].classList.contains('text-success')).toBe(true);

    // 档前说明行：粗筛（证据不足）、不可用（空蓝回归 / 负提升）与免费项（净支出 0）三档各一条。
    const dividers = [...table.querySelectorAll('[data-budget-optimizer-step-divider]')];
    expect(dividers).toHaveLength(3);
    expect(dividers[0].textContent).toContain('粗筛（未精筛');
    expect(dividers[1].textContent).toContain('不可用（空蓝回归');
    // 以下两条依赖批 2 补入的 locales 键（bandFree / costFree）：当前渲染为 i18n key 原文。
    expect(dividers[2].textContent).toContain('免费项');
    expect([...rows[3].querySelectorAll('td')][4].textContent).toContain('免费');
    // 精度列颜色：精筛绿 / 粗筛黄。
    expect([...rows[0].querySelectorAll('td')].at(-1).innerHTML).toContain('text-success');
    expect([...rows[1].querySelectorAll('td')].at(-1).innerHTML).toContain('text-warning');

    // 截断提示：快照 total 7 / 展示 4 → 另有 3 条未展示；第 2 步快照完整、弹窗一次一步不显示它。
    expect(document.body.querySelector('[data-budget-optimizer-step-candidates-truncated="0"]').textContent).toContain(
      '另有 3 条候选未展示',
    );
    expect(document.body.querySelector('[data-budget-optimizer-step-candidates-truncated="1"]')).toBeNull();
  });

  it('keeps two decimals for tiny Δ percentages so small picks do not read as +0.0% (2026-10-09)', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    // 第 7 步「零钱小项」场景：真实 +0.02% 的提升过去被四舍五入成 +0.0%（看起来像零提升）。
    const tiny = makeCandidate({
      id: 'house:gym:3',
      groupKey: 'house:gym',
      kind: 'house',
      label: '健身房 3 级',
      fromLabel: '健身房 2 级',
      toLabel: '健身房 3 级',
      effect: { type: 'house', roomHrid: '/house_rooms/gym', level: 3 },
      fromEffect: { type: 'house', roomHrid: '/house_rooms/gym', level: 2 },
      cost: 12_330_000,
      deltaDps: 0.02,
      deltaObjective: 0.02,
    });
    store.budgetOptimizer.results = makeResult(store, {
      steps: [
        makeSwordStep({
          candidate: tiny,
          cost: 12_330_000,
          deltaObjective: 0.02,
          deltaDps: 0.02,
          candidatesSnapshot: { candidates: [tiny], total: 1, truncated: 0 },
        }),
      ],
    });
    await flushPromises();
    await wrapper.get('[data-budget-optimizer-step-candidates-open="0"]').trigger('click');
    await flushPromises();

    // 候选明细行与步骤卡片共用 percentText：两位小数 +0.02%（不再折成 +0.0%）。
    const row = document.body.querySelector(
      '[data-budget-optimizer-step-candidates="0"] [data-budget-optimizer-step-candidate]',
    );
    expect(row.textContent).toContain('已选定');
    expect(row.textContent).toContain('+0.02%');
    expect(row.textContent).not.toContain('+0.0%');
    expect(wrapper.get('[data-budget-optimizer-step="0"] [data-budget-optimizer-step-delta]').text()).toContain(
      '+0.02%',
    );

    // 真实非零但小于半个最小刻度：显示「<0.01%」而不是折成 0.00%（不再出现零提升错觉）。
    const micro = makeCandidate({ ...tiny, deltaDps: 0.001, deltaObjective: 0.001 });
    store.budgetOptimizer.results = makeResult(store, {
      steps: [
        makeSwordStep({
          candidate: micro,
          deltaObjective: 0.001,
          deltaDps: 0.001,
          candidatesSnapshot: { candidates: [micro], total: 1, truncated: 0 },
        }),
      ],
    });
    await flushPromises();
    expect(wrapper.get('[data-budget-optimizer-step="0"] [data-budget-optimizer-step-delta]').text()).toContain(
      '+<0.01%',
    );
  });

  it('caps the per-step candidate rows at the display limit and counts hidden ones by snapshot total', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    // 旧报告形态：快照里 25 条、total 40（搜索层另截了 15 条）—— UI 只展示头部 15 条。
    const many = Array.from({ length: 25 }, (_, index) =>
      makeCandidate({
        id: `ability:berserk:${index + 1}`,
        deltaObjective: 3.2 - index * 0.05,
        cost: 10_000_000 + index * 1_000_000,
      }),
    );
    store.budgetOptimizer.results = makeResult(store, {
      steps: [makeSwordStep({ candidatesSnapshot: { candidates: many, total: 40, truncated: 15 } })],
    });
    await flushPromises();
    await wrapper.get('[data-budget-optimizer-step-candidates-open="0"]').trigger('click');
    await flushPromises();

    const table = document.body.querySelector('[data-budget-optimizer-step-candidates="0"]');
    const rows = [...table.querySelectorAll('[data-budget-optimizer-step-candidate]')];
    expect(rows).toHaveLength(BUDGET_OPTIMIZER_STEP_CANDIDATES_LIMIT);
    // 未展示数按快照 total 计算：40 − 15 = 25（含搜索层截掉的 15 条，不重复计 UI 截掉的 10 条）。
    expect(document.body.querySelector('[data-budget-optimizer-step-candidates-truncated="0"]').textContent).toContain(
      '另有 25 条候选未展示',
    );
  });

  it('keeps the chosen row visible when it sorts beyond the display limit', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const chosen = makeCandidate();
    const filler = Array.from({ length: 24 }, (_, index) =>
      makeCandidate({
        id: `ability:berserk:${index + 1}`,
        deltaObjective: 3.2 - index * 0.05,
        cost: 10_000_000 + index * 1_000_000,
      }),
    );
    // 选定项排在快照第 25 位（展示上限之外）：末位替换保证「已选定」行仍可见。
    store.budgetOptimizer.results = makeResult(store, {
      steps: [
        makeSwordStep({
          candidate: chosen,
          candidatesSnapshot: { candidates: [...filler, chosen], total: 25, truncated: 0 },
        }),
      ],
    });
    await flushPromises();
    await wrapper.get('[data-budget-optimizer-step-candidates-open="0"]').trigger('click');
    await flushPromises();

    const table = document.body.querySelector('[data-budget-optimizer-step-candidates="0"]');
    const rows = [...table.querySelectorAll('[data-budget-optimizer-step-candidate]')];
    expect(rows).toHaveLength(BUDGET_OPTIMIZER_STEP_CANDIDATES_LIMIT);
    expect(rows.at(-1).textContent).toContain('已选定');
    expect(rows.at(-1).textContent).toContain('君王之剑 +14 → 君王之剑 +15');
  });

  it('renders localized change names from structured effects and falls back to labels for old reports', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.budgetOptimizer.results = makeResult(store);
    await flushPromises();

    // 结构化 effect/fromEffect 优先：显示当前语言的官方名（报告的 label 仅旧数据兜底）。
    const stepChange = wrapper.get('[data-budget-optimizer-step="0"] [data-budget-optimizer-step-change]');
    expect(stepChange.text()).toContain('君王之剑 +14 → 君王之剑 +15');
    expect(stepChange.text()).not.toContain('Regal Sword');

    // 旧报告（无结构化字段）：回退到报告里的 label 文本，不空白。
    const legacy = makeResult(store);
    legacy.steps = legacy.steps.map((step) => ({
      ...step,
      candidate: { ...step.candidate, effect: null, fromEffect: null },
    }));
    store.budgetOptimizer.results = legacy;
    await flushPromises();
    expect(wrapper.get('[data-budget-optimizer-step="0"] [data-budget-optimizer-step-change]').text()).toContain(
      'Regal Sword +14 → Regal Sword +15',
    );
  });

  it('shows the localized empty marker for a step whose source slot was empty', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const results = makeResult(store);
    results.steps[0].candidate.fromEffect = { type: 'equipment', slotKey: 'weapon', itemHrid: '', enhancementLevel: 0 };
    store.budgetOptimizer.results = results;
    await flushPromises();
    expect(wrapper.get('[data-budget-optimizer-step="0"] [data-budget-optimizer-step-change]').text()).toContain(
      '空 → 君王之剑 +15',
    );
  });

  it('shows the applied chain count, offers revert and explains the revert', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.budgetOptimizer.results = makeResult(store);
    await flushPromises();
    expect(wrapper.find('[data-budget-optimizer-applied-bar]').exists()).toBe(false);

    // 每条链一条撤销快照；有快照即显示「已连续应用 N 条链」（撤销一次退回链起点）。
    store.budgetOptimizer.baselineSnapshots.push({
      playerId: '1',
      equipment: {},
      abilities: [],
      houseRooms: {},
      touched: { slots: [], abilityHrids: [], rooms: [] },
      applied: { equipment: {}, abilities: [], houseRooms: {} },
    });
    await flushPromises();

    const bar = wrapper.get('[data-budget-optimizer-applied-bar]');
    expect(bar.text()).toContain('已连续应用 1 条链');

    vi.spyOn(store, 'revertBudgetOptimizerChanges').mockReturnValue(true);
    await wrapper.get('[data-budget-optimizer-revert]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-budget-optimizer-action-note]').text()).toContain('已撤销最近一条链的应用');
  });

  it('marks the report stale once the input changes', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.budgetOptimizer.results = makeResult(store);
    await flushPromises();
    expect(wrapper.find('[data-budget-optimizer-stale]').exists()).toBe(false);

    store.setBudgetOptimizerSettings({ budgetCoins: 2_000_000_000 });
    await flushPromises();
    expect(wrapper.get('[data-budget-optimizer-stale]').text()).toContain('结果已过期');
  });

  it('shows the runtime error key as localized text and the cancelled notice for a stopped chain', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.budgetOptimizer.runtime.error = 'common:budgetOptimizer.noResults';
    await flushPromises();
    expect(wrapper.get('[data-budget-optimizer-error]').text()).toContain('尚无可用结果');

    store.budgetOptimizer.runtime.error = '';
    store.budgetOptimizer.results = makeResult(store, { cancelled: true, stopReason: 'cancelled' });
    await flushPromises();
    expect(wrapper.get('[data-budget-optimizer-cancelled]').text()).toContain('链已停止');
    expect(wrapper.get('[data-budget-optimizer-phase]').text()).toContain('链已停止');
    expect(wrapper.get('[data-budget-optimizer-chain-stop-reason]').text()).toContain('已手动停止');
    // 已结束 → 步骤列表读报告（2 步）。
    expect(wrapper.findAll('[data-budget-optimizer-step]')).toHaveLength(2);
  });

  it('falls back to the finish-state phase from the report once the chain is over', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.budgetOptimizer.results = makeResult(store);
    await flushPromises();
    const phase = wrapper.get('[data-budget-optimizer-phase]');
    expect(phase.text()).toContain('链已完成');
    expect(phase.text()).not.toContain('未开始');
  });

  // 缺价提示行：明细非空时可点击打开弹窗（teleport 到 body，用 document.body 断言）；
  // 旧报告没有明细字段时保持纯文本，点击行为不出现。
  it('opens the skipped-no-price details dialog from the clickable hint line', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.budgetOptimizer.results = makeResult(store);
    await flushPromises();

    const hint = wrapper.get('[data-budget-optimizer-skipped]');
    expect(hint.element.tagName).toBe('BUTTON');

    await hint.trigger('click');
    await flushPromises();
    // 弹窗 teleport 到 body：标题在 DialogTitle（role=dialog 根），明细在 slot 容器。
    const dialogRoot = document.body.querySelector('[role="dialog"]');
    expect(dialogRoot.textContent).toContain('缺价候选明细');
    const dialog = document.body.querySelector('[data-budget-optimizer-skipped-dialog]');
    expect(dialog).toBeTruthy();
    expect(dialog.querySelectorAll('[data-budget-optimizer-skipped-row]')).toHaveLength(3);
    // 展示名按当前语言现场解析（官方语言包可用时为中文名，而不是 hrid / 英文快照名）。
    expect(dialog.textContent).toContain('君王之剑 +12');
    // 房子缺价明细的材料行：标签 + 经 getItemName 现场解析的材料名（已知物品为中文名，
    // 语言包外的 hrid 回退原文），且仅出现在 house 条目下。
    const materialRows = dialog.querySelectorAll('[data-budget-optimizer-skipped-unpriced-materials]');
    expect(materialRows).toHaveLength(1);
    expect(materialRows[0].textContent).toContain('缺价材料');
    expect(materialRows[0].textContent).toContain('君王之剑');
    expect(materialRows[0].textContent).toContain('/items/unpriced_material_without_official_name');
  });

  it('keeps the skipped-no-price hint non-clickable for legacy reports without details', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const results = makeResult(store);
    delete results.diagnostics.skippedNoPriceDetails;
    store.budgetOptimizer.results = results;
    await flushPromises();

    expect(wrapper.get('[data-budget-optimizer-skipped]').element.tagName).toBe('P');
  });

  it('does not render unpriced material rows for legacy house details without the field', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const results = makeResult(store);
    // 旧报告形态：house 明细条目不带 unpricedMaterials 字段 → 弹窗只渲染候选行、无材料行。
    delete results.diagnostics.skippedNoPriceDetails[2].unpricedMaterials;
    store.budgetOptimizer.results = results;
    await flushPromises();

    await wrapper.get('[data-budget-optimizer-skipped]').trigger('click');
    await flushPromises();
    const dialog = document.body.querySelector('[data-budget-optimizer-skipped-dialog]');
    expect(dialog.querySelectorAll('[data-budget-optimizer-skipped-row]')).toHaveLength(3);
    expect(dialog.querySelectorAll('[data-budget-optimizer-skipped-unpriced-materials]')).toHaveLength(0);
  });

  it('shows the skipped-details truncated note when the truncated count is positive', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const results = makeResult(store);
    results.diagnostics.skippedNoPrice = 63;
    results.diagnostics.skippedNoPriceDetailsTruncated = 3;
    store.budgetOptimizer.results = results;
    await flushPromises();
    await wrapper.get('[data-budget-optimizer-skipped]').trigger('click');
    await flushPromises();

    const note = document.body.querySelector('[data-budget-optimizer-skipped-truncated]');
    expect(note).toBeTruthy();
    expect(note.textContent).toContain('另有 3 条缺价明细未展示（按上限截断）');

    // 截断数归零（重新写入报告对象，走 store 赋值触发更新）：提示消失。
    store.budgetOptimizer.results = {
      ...results,
      diagnostics: { ...results.diagnostics, skippedNoPriceDetailsTruncated: 0 },
    };
    await flushPromises();
    expect(document.body.querySelector('[data-budget-optimizer-skipped-truncated]')).toBeNull();
  });

  it('hides the skipped-details truncated note for legacy reports without the field', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    // 旧报告形态：diagnostics 不含 skippedNoPriceDetailsTruncated → 回退 0、不显示提示。
    store.budgetOptimizer.results = makeResult(store);
    await flushPromises();
    await wrapper.get('[data-budget-optimizer-skipped]').trigger('click');
    await flushPromises();

    expect(document.body.querySelector('[data-budget-optimizer-skipped-dialog]')).toBeTruthy();
    expect(document.body.querySelector('[data-budget-optimizer-skipped-truncated]')).toBeNull();
  });

  it('shows the empty-chain notice and zero totals for a report without steps', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.budgetOptimizer.results = makeResult(store, {
      steps: [],
      totalCost: 0,
      remainingBudget: 1_200_000_000,
    });
    await flushPromises();

    expect(wrapper.findAll('[data-budget-optimizer-step]')).toHaveLength(0);
    expect(wrapper.get('[data-budget-optimizer-chain-empty]').text()).toContain('本轮没有可买的升级项');
    expect(wrapper.get('[data-budget-optimizer-chain-total-cost]').text()).toContain('总花费 0');
    expect(wrapper.get('[data-budget-optimizer-chain-remaining]').text()).toContain('1.2b');
    expect(wrapper.get('[data-budget-optimizer-chain-stop-reason]').text()).toContain('已无可买项');
    // 零步链：优化后 = 链起点基线（Δ 为 0），无增量徽标。
    expect(wrapper.get('[data-budget-optimizer-final-value]').text()).toBe('100');
    expect(wrapper.find('[data-budget-optimizer-final-delta]').exists()).toBe(false);
  });

  it('routes a zero-step chain with a failed chain-start baseline to the baseline-failure copy', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const results = makeResult(store, {
      steps: [],
      totalCost: 0,
      remainingBudget: 1_200_000_000,
      baseline: { metrics: { ...METRICS, dps: 0, rounds: 0, failed: true } },
    });
    results.diagnostics.baselineFailed = true;
    store.budgetOptimizer.results = results;
    await flushPromises();

    // 停因与空态都走失败口径，不复用「剩余额度内已无可买项」/「本轮没有可买的升级项」。
    expect(wrapper.get('[data-budget-optimizer-chain-stop-reason]').text()).toContain('链起点基线评估失败');
    expect(wrapper.get('[data-budget-optimizer-chain-stop-reason]').text()).not.toContain('已无可买项');
    expect(wrapper.get('[data-budget-optimizer-chain-empty]').text()).toContain('基线模拟失败');
    expect(wrapper.get('[data-budget-optimizer-chain-empty]').text()).not.toContain('本轮没有可买的升级项');
    // 失败基线不是真实测量：基线值与推算的优化后值都显示占位符，而不是被折成 0。
    const baselineText = wrapper.get('[data-budget-optimizer-baseline]').text();
    expect(baselineText).toContain('链起点 · DPS');
    expect(baselineText).toContain('—');
    expect(wrapper.get('[data-budget-optimizer-final-value]').text()).toBe('—');
  });

  it('renders the step-limit stop reason from the report', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.budgetOptimizer.results = makeResult(store, { stopReason: 'step-limit' });
    await flushPromises();
    expect(wrapper.get('[data-budget-optimizer-chain-stop-reason]').text()).toContain('步数上限');
  });

  it('renders the significance-blocked stop reason from the report', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.budgetOptimizer.results = makeResult(store, { stopReason: 'significance-blocked' });
    await flushPromises();
    // 与「剩余额度内已无可买项」严格区分：门槛拦截有自己的文案（不复用 exhausted 口径）。
    const stopReason = wrapper.get('[data-budget-optimizer-chain-stop-reason]').text();
    expect(stopReason).toContain('未通过显著性检验');
    expect(stopReason).not.toContain('已无可买项');
  });

  it('re-bases the objective wording, baseline badge and column headers on the objective metric', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const results = makeResult(store);
    // 目标切换到利润：基线取 dailyNoRngProfit（80）。
    results.objective = 'profit';
    results.baseline.metrics = { ...results.baseline.metrics, dailyNoRngProfit: 80 };
    store.budgetOptimizer.results = results;
    await flushPromises();

    const baseline = wrapper.get('[data-budget-optimizer-baseline]');
    expect(baseline.text()).toContain('链起点 · 利润');
    expect(baseline.text()).toContain('80');
    // 优化后徽章与增量随目标口径切换（装置的 steps Δ 仍是 DPS 数值，推算只做加法）。
    expect(baseline.get('[data-budget-optimizer-final-label]').text()).toContain('优化后（预估）· 利润');
    expect(baseline.get('[data-budget-optimizer-final-value]').text()).toBe('85.1');
    // 汇总条与列头同样随目标切换。
    expect(wrapper.get('[data-budget-optimizer-chain-total-delta]').text()).toContain('累计 Δ利润');
    await wrapper.get('[data-budget-optimizer-step-candidates-open="0"]').trigger('click');
    await flushPromises();
    const headers = [
      ...document.body.querySelector('[data-budget-optimizer-step-candidates="0"]').querySelectorAll('th'),
    ].map((th) => th.textContent);
    expect(headers.some((header) => header.includes('Δ利润'))).toBe(true);
  });

  it('keeps the invalidSettings copy in sync with the domain range constants', () => {
    // 文案内嵌：预算 0 / 区间 0–50 / 时长 1–72 / 强化 1–10 / 房子 1–8 / 步数 1–40
    //（按出现顺序比对，两种语言同序）。
    const bounds = [
      0,
      0,
      BUDGET_OPTIMIZER_MAX_BAND_RATIO * 100,
      BUDGET_OPTIMIZER_MIN_SIMULATION_HOURS,
      BUDGET_OPTIMIZER_MAX_SIMULATION_HOURS,
      BUDGET_OPTIMIZER_MIN_MAX_LEVEL_UP,
      BUDGET_OPTIMIZER_MAX_MAX_LEVEL_UP,
      BUDGET_OPTIMIZER_MIN_MAX_HOUSE_UP,
      BUDGET_OPTIMIZER_MAX_MAX_HOUSE_UP,
      BUDGET_OPTIMIZER_MIN_CHAIN_STEPS,
      BUDGET_OPTIMIZER_MAX_CHAIN_STEPS,
    ];
    for (const locale of [enCommon, zhCommon]) {
      const numbers = (locale.budgetOptimizer.invalidSettings.match(/\d+/g) || []).map(Number);
      expect(numbers).toEqual(bounds);
    }
  });

  it('keeps every budget optimizer resource key synchronized across locales', () => {
    expect(enCommon?.menu?.budgetOptimizer).toBe('Budget Optimizer');
    expect(zhCommon?.menu?.budgetOptimizer).toBe('预算优化');
    expect(Object.keys(enCommon?.budgetOptimizer || {}).sort()).toEqual(
      Object.keys(zhCommon?.budgetOptimizer || {}).sort(),
    );
    for (const nested of ['presets', 'phases', 'objectives', 'stepLimitModes']) {
      expect(Object.keys(enCommon?.budgetOptimizer?.[nested] || {}).sort()).toEqual(
        Object.keys(zhCommon?.budgetOptimizer?.[nested] || {}).sort(),
      );
    }
    expect(zhCommon?.budgetOptimizer?.phases?.costing).toBeTruthy();
    expect(enCommon?.budgetOptimizer?.phases?.costing).toBeTruthy();
    // v4 链模式文案：步骤 / 汇总 / 终止原因 / 应用相位。
    expect(zhCommon?.budgetOptimizer?.stepsDoneLabel).toBeTruthy();
    expect(enCommon?.budgetOptimizer?.stepsDoneLabel).toBeTruthy();
    expect(zhCommon?.budgetOptimizer?.chainSummaryTitle).toBeTruthy();
    expect(enCommon?.budgetOptimizer?.chainSummaryTitle).toBeTruthy();
    expect(zhCommon?.budgetOptimizer?.stopReasonExhausted).toBeTruthy();
    expect(enCommon?.budgetOptimizer?.stopReasonExhausted).toBeTruthy();
    expect(zhCommon?.budgetOptimizer?.phases?.applying).toBeTruthy();
    expect(enCommon?.budgetOptimizer?.phases?.applying).toBeTruthy();
    // 旧单步 / 曲线口径的键已随 v4 移除（若残留说明 UI 还在引用旧结构）。
    for (const removed of ['nextBest', 'plansLabel', 'curveShow', 'candidatesShow', 'sortDirectionAsc']) {
      expect(zhCommon?.budgetOptimizer?.[removed]).toBeUndefined();
      expect(enCommon?.budgetOptimizer?.[removed]).toBeUndefined();
    }
    expect(zhCommon?.budgetOptimizer?.phases?.planning).toBeUndefined();
    expect(enCommon?.budgetOptimizer?.phases?.planning).toBeUndefined();
    expect(zhCommon?.budgetOptimizer?.emptyState).toContain('导入');
    expect(enCommon?.budgetOptimizer?.emptyState).toContain('Import');
  });
});

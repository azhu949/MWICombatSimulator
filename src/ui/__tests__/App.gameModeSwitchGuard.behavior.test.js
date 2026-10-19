// @vitest-environment jsdom

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import App from '../App.vue';
import { useSimulatorStore } from '../../stores/simulatorStore.js';
import { GAME_MODE_IRONCOW, GAME_MODE_STANDARD } from '../../services/gameMode.js';
import {
  hasBudgetOptimizerRunInProgress,
  registerBudgetOptimizerRun,
  unregisterBudgetOptimizerRun,
} from '../../services/budgetOptimizerRunRegistry.js';
import { setDungeonCalculatorRunInFlight } from '../../services/simulatorRunConflicts.js';
import {
  hasTriggerOptimizerRunInProgress,
  registerTriggerOptimizerRun,
  unregisterTriggerOptimizerRun,
} from '../../services/triggerOptimizerRunRegistry.js';
import { initI18n } from '../i18n/i18n.js';

// 行为级验证：顶栏模式切换（标准 / 铁牛）的运行态闸门。
// ① 忙窗拦截：仅完整版 isSimulationBusy 可见的运行窗口（预算优化注册表登记中，响应式
//    清单不命中、disabled 展示失真为可点）下点击模式按钮不发生切换；
// ② 对照：无忙窗时同一按钮正常切换到铁牛模式（兜底不得误杀正常路径）；
// ③ 计算器运行态（响应式锚点）下按钮真实禁用：disabled 出现、点击不切换，复位后恢复；
// ④ 单向锁定回归：铁牛态即使存在运行残留，也必须始终能切回标准（防锁死）。
// 源码契约（App.template.test.js）锁定接线形态，本文件锁定运行时行为。
// jsdom 局限：不计算 CSS 层叠，无法真实模拟「元素被遮罩遮挡后点击落空」的点击路径，
// 铁牛态占位对顶栏的视觉覆盖等场景不在本文件覆盖范围；断言只看事件绑定与 store 状态。

const EmptyPage = { template: '<div />' };

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/:pathMatch(.*)*',
        name: 'home',
        component: EmptyPage,
        meta: { navLabelKey: 'home', navGroup: 'simulation', navOrder: 1 },
      },
    ],
  });
}

async function mountApp() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const simulator = useSimulatorStore();
  // onMounted 的延迟初始化（idle / 60ms 定时）会拉行情与升级参考数据——单测环境打桩，
  // 防真实网络请求混入（App setup 与本测试共享同一 pinia 实例，挂载后 App 内调用命中
  // 的即此处的桩；beforeEach 的 fake timers 冻结延迟任务，同 App.assetScoreTrigger 惯例）。
  simulator.ensureMarketPricesLoaded = vi.fn();
  simulator.ensureAbilityUpgradeReferenceDataLoaded = vi.fn();

  const router = createTestRouter();
  await router.push('/home');
  await router.isReady();
  const wrapper = mount(App, { global: { plugins: [pinia, router] } });
  return { wrapper, simulator };
}

describe('App 顶栏模式切换运行态闸门行为', () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    // 兜底恢复真实时钟，防单用例中途失败时假时钟泄漏（同 appShellBehavior 惯例）。
    vi.useRealTimers();
  });

  it('仅完整版可见的忙窗（预算优化注册表登记）内点击模式按钮不切换', async () => {
    const { wrapper, simulator } = await mountApp();
    expect(simulator.gameMode).toBe(GAME_MODE_STANDARD);

    const run = registerBudgetOptimizerRun({ cancelRequested: false });
    try {
      // 注册表句柄是模块级普通变量：响应式清单不命中，按钮 disabled 展示失真为可点。
      expect(hasBudgetOptimizerRunInProgress()).toBe(true);
      const toggle = wrapper.find('[data-game-mode-toggle]');
      expect(toggle.attributes('disabled')).toBeUndefined();

      await toggle.trigger('click');
      // 点击时刻兜底（完整版可见注册表忙窗）拦截切换。
      expect(simulator.gameMode).toBe(GAME_MODE_STANDARD);
    } finally {
      unregisterBudgetOptimizerRun(run);
    }
    expect(hasBudgetOptimizerRunInProgress()).toBe(false);

    // 忙窗解除后同一按钮恢复可切换（兜底只拦忙窗，不误杀）。
    await wrapper.find('[data-game-mode-toggle]').trigger('click');
    expect(simulator.gameMode).toBe(GAME_MODE_IRONCOW);

    wrapper.unmount();
  });

  it('手动模拟动态导入准备窗口（runtime.preparing）内模式按钮真实禁用且点击不切换', async () => {
    const { wrapper, simulator } = await mountApp();
    expect(simulator.gameMode).toBe(GAME_MODE_STANDARD);

    // startSimulation / setQueueBaselineForActivePlayer 在首个 await 前同步置位，
    // 覆盖 isRunning 尚未置位的动态导入窗口。
    simulator.runtime.preparing = true;
    await nextTick();
    try {
      const toggle = wrapper.find('[data-game-mode-toggle]');
      expect(toggle.attributes('disabled')).toBeDefined();

      await toggle.trigger('click');
      // disabled 语义挡下切换（与浏览器一致：不派发 click）。
      expect(simulator.gameMode).toBe(GAME_MODE_STANDARD);
    } finally {
      simulator.runtime.preparing = false;
    }
    await nextTick();

    // 准备窗口结束后同一按钮恢复可切换（闸门只拦启动窗口，不误杀）。
    await wrapper.find('[data-game-mode-toggle]').trigger('click');
    expect(simulator.gameMode).toBe(GAME_MODE_IRONCOW);

    wrapper.unmount();
  });

  it('无忙窗时点击模式按钮正常切换到铁牛模式', async () => {
    const { wrapper, simulator } = await mountApp();
    expect(simulator.gameMode).toBe(GAME_MODE_STANDARD);
    expect(hasBudgetOptimizerRunInProgress()).toBe(false);

    const toggle = wrapper.find('[data-game-mode-toggle]');
    expect(toggle.attributes('disabled')).toBeUndefined();
    await toggle.trigger('click');

    expect(simulator.gameMode).toBe(GAME_MODE_IRONCOW);
    wrapper.unmount();
  });

  it('计算器运行态（响应式锚点）下模式按钮真实禁用且点击不切换', async () => {
    const { wrapper, simulator } = await mountApp();
    expect(simulator.gameMode).toBe(GAME_MODE_STANDARD);

    // 计算器运行态是另一个 store 的响应式字段、不在统一忙碌清单内：由响应式锚点桥接到
    // 顶栏按钮（写入侧镜像见 dungeonCalculatorStore）。锚点置真后 disabled 必须真实出现，
    // 不再是旧「可点但点击被兜底静默拦下」的失真展示。
    setDungeonCalculatorRunInFlight(true);
    await nextTick();
    try {
      const toggle = wrapper.find('[data-game-mode-toggle]');
      expect(toggle.attributes('disabled')).toBeDefined();

      await toggle.trigger('click');
      // disabled 语义（VTU 与浏览器一致：disabled 元素不派发点击）挡下切换；该用例同时
      // 锁定「锚点不并入统一忙碌判定」——判定未命中时切换只能靠 disabled 属性本身阻止。
      expect(simulator.gameMode).toBe(GAME_MODE_STANDARD);
    } finally {
      setDungeonCalculatorRunInFlight(false);
    }
    await nextTick();

    // 运行区间结束后同一按钮恢复可切换（锚点只拦运行窗口，不误杀）。
    await wrapper.find('[data-game-mode-toggle]').trigger('click');
    expect(simulator.gameMode).toBe(GAME_MODE_IRONCOW);

    wrapper.unmount();
  });

  it('触发器优化器换难度复核运行态（响应式子状态）下模式按钮真实禁用且点击不切换', async () => {
    const { wrapper, simulator } = await mountApp();
    expect(simulator.gameMode).toBe(GAME_MODE_STANDARD);

    // 换难度复核 / 追加复验共用 runtime 子状态（robustness / verifyAppend / serviceRunInFlight），
    // 只写子状态、不写 runtime.isRunning：两版统一忙碌清单均不含，由 gameModeSwitchLocked
    // 直读子状态收口 —— disabled 必须真实出现（非「可点靠兜底拦」的失真展示）。以 robustness
    // 作代表；入口自身重入检查同样单独三查，证明子状态与主运行态互相独立。
    simulator.triggerOptimizer.runtime.robustness.isRunning = true;
    await nextTick();
    try {
      const toggle = wrapper.find('[data-game-mode-toggle]');
      expect(toggle.attributes('disabled')).toBeDefined();

      await toggle.trigger('click');
      // disabled 语义（VTU 与浏览器一致：disabled 元素不派发点击）挡下切换。
      expect(simulator.gameMode).toBe(GAME_MODE_STANDARD);
    } finally {
      simulator.triggerOptimizer.runtime.robustness.isRunning = false;
    }
    await nextTick();

    // 子状态复位后同一按钮恢复可切换（闸门只拦运行窗口，不误杀）。
    await wrapper.find('[data-game-mode-toggle]').trigger('click');
    expect(simulator.gameMode).toBe(GAME_MODE_IRONCOW);

    wrapper.unmount();
  });

  it('触发器优化器运行注册表登记中（两版统一清单外）点击模式按钮不切换', async () => {
    const { wrapper, simulator } = await mountApp();
    expect(simulator.gameMode).toBe(GAME_MODE_STANDARD);

    // triggerOptimizerRunRegistry 是模块级单运行标志（搜索 / 复核 / 追加复验服务层登记，
    // 含停止后收尾窗口）、不在两版统一忙碌清单内：子状态未置位时 disabled 展示失真为
    // 可点，点击由 toggleGameMode 的注册表兜底拦下（与预算优化注册表用例同一模式；
    // 注册表是跨用例共享的模块级状态，须 finally 注销防泄漏）。
    const run = registerTriggerOptimizerRun({ cancelRequested: false });
    try {
      expect(hasTriggerOptimizerRunInProgress()).toBe(true);
      const toggle = wrapper.find('[data-game-mode-toggle]');
      expect(toggle.attributes('disabled')).toBeUndefined();

      await toggle.trigger('click');
      // 点击时刻兜底（注册表判定）拦截切换。
      expect(simulator.gameMode).toBe(GAME_MODE_STANDARD);
    } finally {
      unregisterTriggerOptimizerRun(run);
    }
    expect(hasTriggerOptimizerRunInProgress()).toBe(false);

    // 注册表注销后同一按钮恢复可切换（兜底只拦忙窗，不误杀）。
    await wrapper.find('[data-game-mode-toggle]').trigger('click');
    expect(simulator.gameMode).toBe(GAME_MODE_IRONCOW);

    wrapper.unmount();
  });

  it('预算优化停止收尾窗口（serviceRunInFlight）下模式按钮真实禁用且点击不切换', async () => {
    const { wrapper, simulator } = await mountApp();
    expect(simulator.gameMode).toBe(GAME_MODE_STANDARD);

    // stopBudgetOptimizer 先把 isRunning 置假，serviceRunInFlight 要到搜索 promise
    // 结算后的 finally 才清：该窗口此前只由点击兜底静默拦下，disabled 展示失真。
    simulator.budgetOptimizer.runtime.isRunning = false;
    simulator.budgetOptimizer.runtime.serviceRunInFlight = true;
    await nextTick();
    try {
      const toggle = wrapper.find('[data-game-mode-toggle]');
      expect(toggle.attributes('disabled')).toBeDefined();
      // 锁定原因文案同时挂在 title / aria-label 上（预算优化页无状态条也可见）。
      expect(toggle.attributes('title')).toBe(toggle.attributes('aria-label'));

      await toggle.trigger('click');
      expect(simulator.gameMode).toBe(GAME_MODE_STANDARD);
    } finally {
      simulator.budgetOptimizer.runtime.serviceRunInFlight = false;
    }
    await nextTick();

    // 收尾窗口结束后同一按钮恢复可切换（闸门只拦收尾，不误杀正常路径）。
    await wrapper.find('[data-game-mode-toggle]').trigger('click');
    expect(simulator.gameMode).toBe(GAME_MODE_IRONCOW);

    wrapper.unmount();
  });

  it('铁牛态存在运行残留时仍可切回标准（单向锁定，防锁死）', async () => {
    const { wrapper, simulator } = await mountApp();
    simulator.setGameMode(GAME_MODE_IRONCOW);
    simulator.runtime.isRunning = true;
    await nextTick();

    // 方向为铁牛 → 标准：兜底只在标准态生效，点击必须放行（防止把用户锁死在铁牛态）。
    await wrapper.find('[data-game-mode-toggle]').trigger('click');
    expect(simulator.gameMode).toBe(GAME_MODE_STANDARD);

    simulator.runtime.isRunning = false;
    wrapper.unmount();
  });
});

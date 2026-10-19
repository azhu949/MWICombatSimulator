// @vitest-environment jsdom

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import App from '../App.vue';
import { useSimulatorStore } from '../../stores/simulatorStore.js';
import { GAME_MODE_IRONCOW, GAME_MODE_STANDARD } from '../../services/gameMode.js';
import { initI18n } from '../i18n/i18n.js';
import itemDetailMap from '../../combatsimulator/data/itemDetailMap.json';
import { MARKET_PRICE_REFRESH_ATTEMPT_COOLDOWN_MS } from '../../services/marketPriceService.js';

// 行为级验证：资产分重算触发器由 deep watch `[players, pricing]` 改为
// computed 触发向量（玩家逐人配置签名 + pricing 五个消费字段引用元组）后——
// ① 被追踪输入（配置/行情引用）变化 → 250ms 防抖合并为一次重算；
// ② 未被追踪输入（名称击键等）变化 → 零触发（deep watch 时代同样输入会全量
//    traverse 两个状态树后空转触发，等值守卫挡写回但触发与重算成本照付）；
// ③ 铁牛态启动门控（本条目）：铁牛态挂载不拉行情、不初算资产分；切回标准态由
//    触发向量内的 isIroncowMode 依赖补一次 250ms 防抖重算。
// 源码断言（App.template.test.js）锁定接线形态，本文件锁定运行时触发语义。

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

function setupWeaponPlayer(simulator) {
  // 与 simulatorStore.test.js 的 refreshAssetScores 夹具同款：动态取有卖店价的
  // 物品做武器（带就地守卫，防参考数据漂移时静默空转）。
  const vendorPricedEntry = Object.entries(itemDetailMap).find(([, item]) => Number(item?.sellPrice || 0) > 0);
  expect(vendorPricedEntry).toBeTruthy();
  const weaponHrid = String(vendorPricedEntry[0]);
  const player = simulator.players.find((entry) => String(entry.id) === String(simulator.activePlayerId));
  player.equipment.weapon = { itemHrid: weaponHrid, enhancementLevel: 0 };
  // 行情可用（lastFetchedAt > 0 → pricingReady=true → refreshAssetScores 恒重算路径，
  // 触发计数不被「行情不可用分支的签名守卫短路」掩盖）。
  simulator.pricing.lastFetchedAt = Date.now();
  simulator.pricing.marketItemValues = { [weaponHrid]: { 0: 100, 1: 500 } };
  return player;
}

async function mountAppWithPlayer() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const simulator = useSimulatorStore();
  // onMounted 的延迟初始化（idle/60ms 定时）会拉行情与升级参考数据——单测环境
  // 打桩，防真实网络请求混入触发计数与防抖断言（App setup 与本测试共享同一
  // pinia 实例，挂载后 App 内调用命中的即此处的桩）。
  simulator.ensureMarketPricesLoaded = vi.fn();
  simulator.ensureAbilityUpgradeReferenceDataLoaded = vi.fn();
  const player = setupWeaponPlayer(simulator);

  // 候选 A（2026-10-03）：refreshAssetScores 改为按需加载重模块（异步）——先预热
  // 模块（真实模块图加载不随 fake timers 推进），使挂载期初算与后续防抖触发的
  // 刷新只经历微任务级 await。
  await import('../../services/assetScoreService.js');

  const router = createTestRouter();
  await router.push('/home');
  await router.isReady();
  const wrapper = mount(App, { global: { plugins: [pinia, router] } });
  // 等待 onMounted 初算写回（模块已预热，纯微任务级；轮转上限防呆）。
  await settleAssetScoreRefresh();
  return { wrapper, simulator, player };
}

// 刷新链（防抖/初算回调 → 按需模块 await → 写回）为纯微任务——轮转微任务队列，
// 等待写回完成（断言稳定；模块由 mountAppWithPlayer 预热）。
async function settleAssetScoreRefresh() {
  for (let flush = 0; flush < 20; flush += 1) {
    await Promise.resolve();
  }
}

// 铁牛态启动门控用例的脚手架：与 mountAppWithPlayer 同款，差别仅两点——
// ① 挂载前经 store 公开 API 预置铁牛模式（等价于刷新页面时从持久化恢复：存储键
//    mwi.gameMode.v1、形状 { mode: 'standard'|'ironcow' }，见 simulatorStorage.js
//    的 loadGameModeFromStorage）；
// ② refreshAssetScores 的 spy 在挂载前安装，使挂载期调用（若未被门控）必被计数。
async function mountAppInIroncowMode() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const simulator = useSimulatorStore();
  simulator.ensureMarketPricesLoaded = vi.fn();
  simulator.ensureAbilityUpgradeReferenceDataLoaded = vi.fn();
  const player = setupWeaponPlayer(simulator);
  simulator.setGameMode(GAME_MODE_IRONCOW);

  await import('../../services/assetScoreService.js');
  const refreshSpy = vi.spyOn(simulator, 'refreshAssetScores');

  const router = createTestRouter();
  await router.push('/home');
  await router.isReady();
  const wrapper = mount(App, { global: { plugins: [pinia, router] } });
  await settleAssetScoreRefresh();
  return { wrapper, simulator, player, refreshSpy };
}

describe('App 资产分触发向量行为', () => {
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

  it('被追踪输入（配置 / 行情引用）变化 → 250ms 防抖合并为一次重算并写回', async () => {
    const { wrapper, simulator, player } = await mountAppWithPlayer();

    // onMounted 初算发生在 spy 之前 → 计数从 0 起，断言纯净。
    const initial = player.assetScore;
    expect(initial).not.toBeNull();
    expect(initial.items.equipment[0].enhancementLevel).toBe(0);

    const refreshSpy = vi.spyOn(simulator, 'refreshAssetScores');
    expect(refreshSpy).not.toHaveBeenCalled();

    // ① 配置变化（强化等级 0 → 1，签名向量依赖）。
    player.equipment.weapon.enhancementLevel = 1;
    await nextTick();
    await vi.advanceTimersByTimeAsync(300);
    await settleAssetScoreRefresh();
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    // 重算写回携带新等级与官方估算值的快照（marketItemValues[weaponHrid][1] = 500）。
    expect(player.assetScore).not.toBe(initial);
    expect(player.assetScore.items.equipment[0].enhancementLevel).toBe(1);
    expect(player.assetScore.items.equipment[0].value).toBe(500);

    // ② 行情引用变化（透传合并的「整体替换引用」写点形态，1 档价值 500 → 900）。
    simulator.pricing.marketItemValues = {
      ...simulator.pricing.marketItemValues,
      [player.equipment.weapon.itemHrid]: { 0: 100, 1: 900 },
    };
    await nextTick();
    await vi.advanceTimersByTimeAsync(300);
    await settleAssetScoreRefresh();
    expect(refreshSpy).toHaveBeenCalledTimes(2);
    expect(player.assetScore).not.toBe(initial);
    expect(player.assetScore.items.equipment[0].value).toBe(900);

    wrapper.unmount();
  });

  it('标准态已排程的防抖在切入铁牛态时被取消，不触发刷新', async () => {
    const { wrapper, simulator, player } = await mountAppWithPlayer();
    const refreshSpy = vi.spyOn(simulator, 'refreshAssetScores');
    const stable = player.assetScore;

    // 标准态触发一次排程（250ms 防抖，尚未到期）。
    player.equipment.weapon.enhancementLevel = 1;
    await nextTick();

    // 在防抖到期前切铁牛：触发向量里的 isIroncowMode 依赖会重跑 watch。修复前
    // 提前返回跳过 clearTimeout，残留定时器仍会执行一次全量资产分重算。
    simulator.setGameMode(GAME_MODE_IRONCOW);
    await nextTick();
    await vi.advanceTimersByTimeAsync(300);
    await settleAssetScoreRefresh();
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(player.assetScore).toBe(stable);

    // 切回标准态仍由模式依赖补一次防抖重算（清理不得误杀切回补偿）。
    simulator.setGameMode(GAME_MODE_STANDARD);
    await nextTick();
    await vi.advanceTimersByTimeAsync(300);
    await settleAssetScoreRefresh();
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(player.assetScore).not.toBe(stable);

    wrapper.unmount();
  });

  it('未被追踪输入（名称击键）变化 → 零触发、快照引用不变', async () => {
    const { wrapper, simulator, player } = await mountAppWithPlayer();
    expect(player.assetScore).not.toBeNull();

    const refreshSpy = vi.spyOn(simulator, 'refreshAssetScores');
    const stable = player.assetScore;

    // 名称不在签名向量与行情引用元组的依赖内——deep watch 时代该输入会触发
    // 全量遍历 + 空转重算（等值守卫挡写回），新触发面下必须零触发。
    player.name = 'Renamed Player';
    await nextTick();
    await vi.advanceTimersByTimeAsync(300);
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(player.assetScore).toBe(stable);

    wrapper.unmount();
  });

  it('铁牛态启动不拉行情也不初算资产分，切回标准态后补一次防抖重算', async () => {
    const { wrapper, simulator, player, refreshSpy } = await mountAppInIroncowMode();

    // 铁牛态主内容区为占位：市场价指示器与顶栏资产分徽章均不挂载（无消费方）。
    expect(wrapper.find('[data-ironcow-placeholder]').exists()).toBe(true);

    // 推进延迟初始化窗口（requestIdleCallback timeout 1200 与 setTimeout 60 两条
    // 路径都覆盖）：行情强制拉取被门控跳过，而升级参考数据加载仍照常执行——后者
    // 是本断言的非空洞对照（证明延迟初始化确实已经跑到）。
    await vi.advanceTimersByTimeAsync(1500);
    await settleAssetScoreRefresh();
    expect(simulator.ensureAbilityUpgradeReferenceDataLoaded).toHaveBeenCalled();
    expect(simulator.ensureMarketPricesLoaded).not.toHaveBeenCalled();
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(player.assetScore).toBeNull();

    // 切回标准态：触发向量内的 isIroncowMode 依赖变化 → 250ms 防抖后重算一次，
    // 消除「切回标准态后 Gear Score 徽章滞留空快照」的副作用。
    // 冷却对齐（2026-10-19）：切回补偿复用 60s 尝试冷却
    //（wasMarketPriceRefreshAttemptedRecently 读 lastFetchedAt）——夹具预置的
    // Date.now() 落在冷却窗内会命中跳过，拨出窗外使「切回补拉一次」仍可观察
    //（保持 > 0，资产分 pricingReady 口径不变）。
    simulator.pricing.lastFetchedAt = Date.now() - MARKET_PRICE_REFRESH_ATTEMPT_COOLDOWN_MS - 1;
    simulator.setGameMode(GAME_MODE_STANDARD);
    await nextTick();
    await vi.advanceTimersByTimeAsync(300);
    await settleAssetScoreRefresh();
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(player.assetScore).not.toBeNull();

    // 对称覆盖（同一条目）：启动门控跳过的行情强制拉取在切回标准态由 gameMode
    // watch 补拉一次——195 行已证明切回前零调用，此处锁定 true 形态与调用次数。
    expect(simulator.ensureMarketPricesLoaded).toHaveBeenCalledTimes(1);
    expect(simulator.ensureMarketPricesLoaded).toHaveBeenCalledWith(true);

    wrapper.unmount();
  });

  it('冷却窗内的切回标准态不重复强制拉取行情', async () => {
    // 冷却守护（2026-10-19）：切回补偿复用 60s 尝试冷却。夹具预置的 lastFetchedAt =
    // Date.now()（等价「刚刚尝试过拉取」）落在冷却窗内，切回标准态不得再发强制拉取
    //（修复前该路径无冷却、必发——本用例即该缺陷的行为锁）。
    const { wrapper, simulator } = await mountAppInIroncowMode();

    await vi.advanceTimersByTimeAsync(1500);
    await settleAssetScoreRefresh();
    expect(simulator.ensureMarketPricesLoaded).not.toHaveBeenCalled();

    simulator.setGameMode(GAME_MODE_STANDARD);
    await nextTick();
    await vi.advanceTimersByTimeAsync(300);
    await settleAssetScoreRefresh();
    expect(simulator.ensureMarketPricesLoaded).not.toHaveBeenCalled();

    wrapper.unmount();
  });
});

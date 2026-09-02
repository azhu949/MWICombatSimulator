// @vitest-environment jsdom

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import App from '../App.vue';
import { useSimulatorStore } from '../../stores/simulatorStore.js';
import { initI18n } from '../i18n/i18n.js';
import itemDetailMap from '../../combatsimulator/data/itemDetailMap.json';

// 行为级验证：资产分重算触发器由 deep watch `[players, pricing]` 改为
// computed 触发向量（玩家逐人配置签名 + pricing 五个消费字段引用元组）后——
// ① 被追踪输入（配置/行情引用）变化 → 250ms 防抖合并为一次重算；
// ② 未被追踪输入（名称击键等）变化 → 零触发（deep watch 时代同样输入会全量
//    traverse 两个状态树后空转触发，等值守卫挡写回但触发与重算成本照付）。
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

  const router = createTestRouter();
  await router.push('/home');
  await router.isReady();
  const wrapper = mount(App, { global: { plugins: [pinia, router] } });
  return { wrapper, simulator, player };
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
    expect(refreshSpy).toHaveBeenCalledTimes(2);
    expect(player.assetScore).not.toBe(initial);
    expect(player.assetScore.items.equipment[0].value).toBe(900);

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
});

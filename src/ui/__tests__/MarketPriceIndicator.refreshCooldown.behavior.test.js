// @vitest-environment jsdom

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import MarketPriceIndicator from '../components/MarketPriceIndicator.vue';
import { useSimulatorStore } from '../../stores/simulatorStore.js';
import { initI18n } from '../i18n/i18n.js';

// 行为级锁定：手动刷新的 60s 冷却仅对「成功」生效。修复前失败同样进入冷却，
// 失败提示变红后 60s 内的重试点击被静默吞掉（无提示、无禁用态、无第二次拉取）。

async function mountIndicator() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const simulator = useSimulatorStore();
  // 组件唯一数据动作是点击触发的 ensureMarketPricesLoaded(true)，这里打桩控制成败。
  simulator.ensureMarketPricesLoaded = vi.fn();
  // 预置新鲜快照：missing 态的 title 会提前返回「未获取市场数据」，
  // 置为 fresh 才能让失败详情进入 title 断言。
  simulator.pricing.marketTimestamp = Math.floor(Date.now() / 1000);
  simulator.pricing.error = '';
  const wrapper = mount(MarketPriceIndicator, { global: { plugins: [pinia] } });
  return { wrapper, simulator };
}

function getButton(wrapper) {
  return wrapper.find('[data-market-price-indicator]');
}

describe('MarketPriceIndicator 手动刷新冷却', () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => localStorage.clear());

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('刷新失败后允许立即重试：第二次点击真实发起第二次拉取', async () => {
    const { wrapper, simulator } = await mountIndicator();
    const stub = simulator.ensureMarketPricesLoaded.mockImplementation(async () => {
      simulator.pricing.error = 'Fetch market prices failed.';
      return null;
    });

    await getButton(wrapper).trigger('click');
    await flushPromises();
    expect(stub).toHaveBeenCalledTimes(1);
    // 失败可见：着色转红 + title 含失败详情 + off-screen live region 同步播报。
    expect(wrapper.html()).toContain('text-destructive');
    expect(getButton(wrapper).attributes('title')).toContain('Fetch market prices failed.');
    expect(wrapper.find('[role="status"]').text()).toContain('Fetch market prices failed.');

    // 立即重试必须放行（修复前：60s 冷却内静默 return，stub 停留在 1 次）。
    await getButton(wrapper).trigger('click');
    await flushPromises();
    expect(stub).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('首拉即失败（missing + failed 同真）：title 与 live region 均不得吞掉失败详情', async () => {
    const { wrapper, simulator } = await mountIndicator();
    // 覆盖预置的 fresh 快照，回到「从未获取」（missing）状态：marketTimestamp=0。
    simulator.pricing.marketTimestamp = 0;
    simulator.ensureMarketPricesLoaded.mockImplementation(async () => {
      simulator.pricing.error = 'Fetch market prices failed.';
      return null;
    });

    await getButton(wrapper).trigger('click');
    await flushPromises();

    // 修复前：titleText 的 isMissing 分支提前返回，title 只显示「未获取市场数据」，
    // 失败详情在 title 通道完全丢失；修复后可见文本 / title / 播报三通道均含失败。
    expect(getButton(wrapper).attributes('title')).toContain('Fetch market prices failed.');
    expect(wrapper.find('[role="status"]').text()).toContain('Fetch market prices failed.');
    wrapper.unmount();
  });

  it('刷新成功后冷却仍然生效：60s 内的再次点击不重复拉取', async () => {
    const { wrapper, simulator } = await mountIndicator();
    const stub = simulator.ensureMarketPricesLoaded.mockResolvedValue({ lastFetchedAt: Date.now() });

    await getButton(wrapper).trigger('click');
    await flushPromises();
    expect(stub).toHaveBeenCalledTimes(1);

    await getButton(wrapper).trigger('click');
    await flushPromises();
    expect(stub).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});

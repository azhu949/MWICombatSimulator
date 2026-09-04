// @vitest-environment jsdom

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import MarketPriceIndicator from '../components/MarketPriceIndicator.vue';
import { useSimulatorStore } from '../../stores/simulatorStore.js';
import { initI18n } from '../i18n/i18n.js';

// 行为级锁定：后台（非用户点击触发）行情拉取失败必须对 widget 可见。
// App.runDeferredInitialization 启动即强制拉取（ensureMarketPricesLoaded(true)），
// 失败只置 store.pricing.error；修复前 widget 的失败标记仅由点击路径点亮，
// 后台失败只显示琥珀「未获取市场数据」或旧快照岁龄，失败痕迹完全不可见——
// 用户只能主动点击一次才能看到错误详情。修复后 widget 直接消费 store 真值
// （pricing.error：会话内、非持久化、下次拉取开始同步清空）。

// 测试默认 zh 语言（localStorage 清空后 resolveInitialLanguage 回落 'zh'），
// 文案断言使用 zh common.json 契约值；错误详情是 store 原始字符串（英文），与语言无关。
const ERROR_DETAIL = 'Fetch market prices failed.';

async function mountIndicator() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const simulator = useSimulatorStore();
  const wrapper = mount(MarketPriceIndicator, { global: { plugins: [pinia] } });
  return { wrapper, simulator };
}

describe('MarketPriceIndicator 后台刷新失败可见性', () => {
  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => localStorage.clear());

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('启动后台拉取失败（error 置位、无任何点击）：可见文本 / 着色 / title / live region 均透出失败', async () => {
    const { wrapper, simulator } = await mountIndicator();
    // 模拟 App.runDeferredInitialization 首次强制拉取失败后的 store 真值：
    // 无缓存快照 → marketTimestamp 保持 0（missing），error 置位。全程无点击。
    simulator.pricing.marketTimestamp = 0;
    simulator.pricing.error = ERROR_DETAIL;
    await wrapper.vm.$nextTick();

    // 修复前：statusText 走 missing 分支（琥珀「未获取市场数据」），无任何失败痕迹。
    expect(wrapper.text()).toContain('刷新失败');
    expect(wrapper.html()).toContain('text-destructive');
    expect(wrapper.find('[data-market-price-indicator]').attributes('title')).toContain(ERROR_DETAIL);
    expect(wrapper.find('[role="status"]').text()).toContain(ERROR_DETAIL);
    wrapper.unmount();
  });

  it('missing + 后台失败组合：title 不得被 missing 分支吞掉失败详情', async () => {
    const { wrapper, simulator } = await mountIndicator();
    simulator.pricing.marketTimestamp = 0;
    simulator.pricing.error = ERROR_DETAIL;
    await wrapper.vm.$nextTick();

    const title = wrapper.find('[data-market-price-indicator]').attributes('title');
    expect(title).toContain('未获取市场数据');
    expect(title).toContain(ERROR_DETAIL);
    // live region 同步播报（含错误详情），失败通道与手动失败一致。
    expect(wrapper.find('[role="status"]').text()).toContain(ERROR_DETAIL);
    wrapper.unmount();
  });

  it('失败信号随下一次拉取开始自动清除：error 清空后失败展示退场', async () => {
    const { wrapper, simulator } = await mountIndicator();
    simulator.pricing.marketTimestamp = 0;
    simulator.pricing.error = ERROR_DETAIL;
    await wrapper.vm.$nextTick();
    expect(wrapper.html()).toContain('text-destructive');

    // fetchMarketPricesForStore 在每次拉取开始的同步前置里清空 error；模拟重试进行中：
    // error 清空 + isLoading 置位 → 失败展示立即退场，不残留旧错误。
    simulator.pricing.error = '';
    simulator.pricing.isLoading = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.html()).not.toContain('text-destructive');
    expect(wrapper.text()).toContain('市场数据刷新中');
    wrapper.unmount();
  });
});

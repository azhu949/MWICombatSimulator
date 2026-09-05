// @vitest-environment jsdom

import { nextTick, ref } from 'vue';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { initI18n } from '../i18n/i18n.js';
import HomeSimulationPanel from '../components/home/HomeSimulationPanel.vue';
import { useSimulatorStore } from '../../stores/simulatorStore.js';

beforeAll(async () => {
  localStorage.setItem('i18nextLng', 'en');
  await initI18n();
});

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const SelectStub = { name: 'SelectStub', props: ['disabled'], template: '<div><slot /></div>' };
const SelectItemStub = { name: 'SelectItemStub', template: '<span><slot /></span>' };

function mountPanel() {
  return mount(HomeSimulationPanel, {
    props: {
      snapshotController: {
        statusText: ref(''),
        statusClass: ref(''),
        save: vi.fn(),
        load: vi.fn(),
      },
    },
    global: {
      stubs: {
        SearchCombobox: true,
        Select: SelectStub,
        SelectTrigger: { template: "<button type='button'><slot /></button>" },
        SelectContent: { template: '<div><slot /></div>' },
        SelectItem: SelectItemStub,
      },
    },
  });
}

function communityExpInput(wrapper) {
  return wrapper.findAll('input[type="number"]').find((input) => input.attributes('max') === '99');
}

describe('HomeSimulationPanel UI settings persistence', () => {
  it('coalesces rapid numeric input into one trailing localStorage write', async () => {
    const simulator = useSimulatorStore();
    const persist = vi.spyOn(simulator, 'persistSimulationUiSettings');
    const wrapper = mountPanel();
    const input = communityExpInput(wrapper);

    expect(input).toBeTruthy();
    expect(persist).not.toHaveBeenCalled();

    await input.setValue('21');
    await input.setValue('200');

    expect(persist).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(249);
    expect(persist).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(persist).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem('mwi.simulation.ui.v1'))).toMatchObject({ comExp: 99 });
    await vi.advanceTimersByTimeAsync(250);
    expect(persist).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it('flushes a pending settings write when the panel unmounts', async () => {
    const simulator = useSimulatorStore();
    const persist = vi.spyOn(simulator, 'persistSimulationUiSettings');
    const wrapper = mountPanel();

    await communityExpInput(wrapper).setValue('33');
    wrapper.unmount();

    expect(persist).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem('mwi.simulation.ui.v1'))).toMatchObject({ comExp: 33 });
    await vi.advanceTimersByTimeAsync(250);
    expect(persist).toHaveBeenCalledOnce();
  });
});

function pricingSelectByAriaLabel(wrapper, label) {
  const triggers = wrapper.findAll(`button[aria-label="${label}"]`);
  expect(triggers).toHaveLength(1);
  return wrapper.findAllComponents(SelectStub).find((select) => select.element.contains(triggers[0].element));
}

describe('HomeSimulationPanel pricing controls (migrated from SettingsPage, two tax modes)', () => {
  it('renders both pricing selects with two tax options and default store values', () => {
    const simulator = useSimulatorStore();
    const wrapper = mountPanel();

    const valuationSelect = pricingSelectByAriaLabel(wrapper, 'Non-tradable Valuation (Cowbells/Capes)');
    const taxSelect = pricingSelectByAriaLabel(wrapper, 'Revenue Tax');

    expect(valuationSelect).toBeTruthy();
    expect(taxSelect).toBeTruthy();
    expect(valuationSelect.props('disabled')).toBe(false);
    expect(taxSelect.props('disabled')).toBe(false);

    // 估值开关：开/关两项；计税：仅「计税 / 不计税」两项——'all' 档已移除。
    expect(valuationSelect.text()).toContain('Enabled (cowbell = bag/10, capes = mirror)');
    expect(valuationSelect.text()).toContain('Disabled (vendor fallback, legacy behavior)');
    expect(taxSelect.text()).toContain('Tax');
    expect(taxSelect.text()).toContain('No tax');
    expect(taxSelect.findAllComponents(SelectItemStub)).toHaveLength(2);

    // 控件 v-model 绑定 store：默认 true / 'market'（迁移前后行为不变锚点）。
    expect(simulator.pricing.nonTradableValuation).toBe(true);
    expect(simulator.pricing.taxMode).toBe('market');
    wrapper.unmount();
  });

  it('disables both pricing selects while any runner is active (G1 joint guard)', async () => {
    const simulator = useSimulatorStore();
    const wrapper = mountPanel();

    simulator.runtime.isRunning = true;
    await nextTick();
    expect(pricingSelectByAriaLabel(wrapper, 'Non-tradable Valuation (Cowbells/Capes)').props('disabled')).toBe(true);
    expect(pricingSelectByAriaLabel(wrapper, 'Revenue Tax').props('disabled')).toBe(true);

    simulator.runtime.isRunning = false;
    await nextTick();
    expect(pricingSelectByAriaLabel(wrapper, 'Non-tradable Valuation (Cowbells/Capes)').props('disabled')).toBe(false);
    expect(pricingSelectByAriaLabel(wrapper, 'Revenue Tax').props('disabled')).toBe(false);

    // scanInFlight 窗口期（首扫动态导入/停止后 worker 收尾，isRunning 已复位但
    // 扫描占用未结束）：与 AdvisorPage 既有口径一致，两 Select 保持禁用。
    simulator.advisor.runtime.scanInFlight = true;
    await nextTick();
    expect(pricingSelectByAriaLabel(wrapper, 'Non-tradable Valuation (Cowbells/Capes)').props('disabled')).toBe(true);
    expect(pricingSelectByAriaLabel(wrapper, 'Revenue Tax').props('disabled')).toBe(true);

    simulator.advisor.runtime.scanInFlight = false;
    await nextTick();
    expect(pricingSelectByAriaLabel(wrapper, 'Non-tradable Valuation (Cowbells/Capes)').props('disabled')).toBe(false);
    expect(pricingSelectByAriaLabel(wrapper, 'Revenue Tax').props('disabled')).toBe(false);
    wrapper.unmount();
  });
});

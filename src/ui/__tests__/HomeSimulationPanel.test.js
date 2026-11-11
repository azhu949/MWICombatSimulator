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

  it('persists the multi-round count through the same trailing write', async () => {
    const simulator = useSimulatorStore();
    const wrapper = mountPanel();

    await simulationRoundsInput(wrapper).setValue('12');
    expect(simulator.simulationSettings.simulationRounds).toBe(12);

    await vi.advanceTimersByTimeAsync(250);
    expect(JSON.parse(localStorage.getItem('mwi.simulation.ui.v1'))).toMatchObject({ simulationRounds: 12 });
    wrapper.unmount();
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

function simulationRoundsInput(wrapper) {
  return wrapper.findAll('input[type="number"]').find((input) => input.attributes('max') === '100');
}

describe('HomeSimulationPanel multi-round control', () => {
  it('renders the rounds input in single scope and binds it to the store', async () => {
    const simulator = useSimulatorStore();
    const wrapper = mountPanel();

    const input = simulationRoundsInput(wrapper);
    expect(input).toBeTruthy();
    expect(input.attributes('min')).toBe('1');
    expect(input.element.value).toBe('1');
    expect(wrapper.text()).toContain('(Multiple rounds with different seeds for robust statistics.)');

    await input.setValue('12');
    expect(simulator.simulationSettings.simulationRounds).toBe(12);

    wrapper.unmount();
  });

  it('hides the rounds input for batch run scopes', async () => {
    const simulator = useSimulatorStore();
    const wrapper = mountPanel();

    simulator.setRunScope('all_group_zones');
    await nextTick();

    expect(simulationRoundsInput(wrapper)).toBeUndefined();
    wrapper.unmount();
  });
});

describe('HomeSimulationPanel three action rows', () => {
  it('groups simulation, import, and configuration controls into independent rows', () => {
    const wrapper = mountPanel();
    const rows = wrapper.findAll('[data-home-action-row]');
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.attributes('data-home-action-row'))).toEqual([
      'simulation',
      'import',
      'configuration',
    ]);
    expect(rows.map((row) => row.findAll('button').length)).toEqual([2, 1, 7]);
    expect(rows[1].attributes('data-tm-import-anchor')).toBe('simulator-home-actions');
    expect(rows[1].find('[data-tm-import-reference="import-export"]').exists()).toBe(true);
    for (const row of rows) expect(row.classes()).toContain('flex-wrap');
    wrapper.unmount();
  });
  it('keeps configuration event order and save/restore handlers intact', async () => {
    const wrapper = mountPanel();
    const buttons = wrapper.find('[data-home-action-row="configuration"]').findAll('button');
    for (const button of buttons) await button.trigger('click');
    for (const event of [
      'open-house-rooms',
      'open-achievements',
      'open-guild-buffs',
      'open-experimental',
      'open-snapshot-info',
    ])
      expect(wrapper.emitted(event)).toHaveLength(1);
    expect(wrapper.props('snapshotController').save).toHaveBeenCalledOnce();
    expect(wrapper.props('snapshotController').load).toHaveBeenCalledOnce();
    await wrapper.find('[data-tm-import-reference="import-export"]').trigger('click');
    expect(wrapper.emitted('open-import-export')).toHaveLength(1);
    wrapper.unmount();
  });
  it('retains start and stop handlers and running-state disabled behavior', async () => {
    const simulator = useSimulatorStore();
    const start = vi.spyOn(simulator, 'startSimulation').mockImplementation(() => {});
    const stop = vi.spyOn(simulator, 'stopSimulation').mockImplementation(() => {});
    const wrapper = mountPanel();
    const buttons = wrapper.find('[data-home-action-row="simulation"]').findAll('button');
    expect(buttons[0].element.disabled).toBe(false);
    expect(buttons[1].element.disabled).toBe(true);
    await buttons[0].trigger('click');
    expect(start).toHaveBeenCalledOnce();
    simulator.runtime.isRunning = true;
    await nextTick();
    expect(buttons[0].element.disabled).toBe(true);
    expect(buttons[1].element.disabled).toBe(false);
    await buttons[1].trigger('click');
    expect(stop).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
});

// @vitest-environment jsdom

import { ref } from 'vue';
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
        Select: { template: '<div><slot /></div>' },
        SelectTrigger: { template: "<button type='button'><slot /></button>" },
        SelectContent: { template: '<div><slot /></div>' },
        SelectItem: { template: '<span><slot /></span>' },
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

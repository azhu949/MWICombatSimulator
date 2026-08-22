// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import HomePage from '../pages/HomePage.vue';
import { useSimulatorStore } from '../../stores/simulatorStore.js';
import { combatScrollOptions } from '../../shared/combatScrolls.js';

const passthroughStub = defineComponent({
  template: '<div><slot /></div>',
});

const baseModalStub = defineComponent({
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, default: '' },
  },
  template: '<div v-if="open"><h2>{{ title }}</h2><slot /></div>',
});

const routerViewHost = defineComponent({
  template: '<router-view />',
});

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/home', name: 'home', component: HomePage }],
  });
}

function mountHomePage(router) {
  return mount(routerViewHost, {
    global: {
      plugins: [router],
      stubs: {
        BaseModal: baseModalStub,
        DisclosurePanel: passthroughStub,
        HomeSummaryPanel: passthroughStub,
        HomeWorkspaceTabs: passthroughStub,
        InlineTriggerEditor: passthroughStub,
        SearchCombobox: passthroughStub,
        Select: passthroughStub,
        SelectContent: passthroughStub,
        SelectItem: passthroughStub,
        SelectTrigger: passthroughStub,
        Table: passthroughStub,
        TableBody: passthroughStub,
        TableCell: passthroughStub,
        TableHead: passthroughStub,
        TableHeader: passthroughStub,
        TableRow: passthroughStub,
      },
    },
  });
}

describe('HomePage combat scroll configuration', () => {
  let router;
  let simulator;

  beforeEach(async () => {
    localStorage.clear();
    setActivePinia(createPinia());
    simulator = useSimulatorStore();
    simulator.simulationSettings.combatScrollsEnabled = true;
    simulator.activePlayer.combatScrolls = {
      '/items/seal_of_damage': { quantity: 3 },
      '/items/seal_of_wisdom': { quantity: null },
    };

    router = createTestRouter();
    await router.push('/home');
    await router.isReady();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('starts with the outer effect gate disabled for fresh settings', async () => {
    localStorage.clear();
    setActivePinia(createPinia());
    const freshSimulator = useSimulatorStore();
    const freshRouter = createTestRouter();
    await freshRouter.push('/home');
    await freshRouter.isReady();

    const wrapper = mountHomePage(freshRouter);
    await flushPromises();
    const outerLabel = wrapper
      .findAll('label')
      .find((label) => /Enable Combat Scroll Effects|启用战斗卷轴效果/.test(label.text()));

    expect(freshSimulator.simulationSettings.combatScrollsEnabled).toBe(false);
    expect(outerLabel.find('input[type="checkbox"]').element.checked).toBe(false);
    wrapper.unmount();
  });

  it('retains child selections and quantities when the outer gate is toggled', async () => {
    const wrapper = mountHomePage(router);
    await flushPromises();
    const outerLabel = wrapper
      .findAll('label')
      .find((label) => /Enable Combat Scroll Effects|启用战斗卷轴效果/.test(label.text()));
    expect(outerLabel).toBeTruthy();

    const outerToggle = outerLabel.find('input[type="checkbox"]');
    await outerToggle.setValue(false);

    expect(simulator.simulationSettings.combatScrollsEnabled).toBe(false);
    expect(simulator.activePlayer.combatScrolls).toEqual({
      '/items/seal_of_damage': { quantity: 3 },
      '/items/seal_of_wisdom': { quantity: null },
    });

    await outerToggle.setValue(true);

    expect(simulator.simulationSettings.combatScrollsEnabled).toBe(true);
    expect(simulator.activePlayer.combatScrolls).toEqual({
      '/items/seal_of_damage': { quantity: 3 },
      '/items/seal_of_wisdom': { quantity: null },
    });
    wrapper.unmount();
  });

  it('commits a quantity edit while the outer gate is off without changing the gate', async () => {
    const wrapper = mountHomePage(router);
    await flushPromises();
    const outerLabel = wrapper
      .findAll('label')
      .find((label) => /Enable Combat Scroll Effects|启用战斗卷轴效果/.test(label.text()));
    await outerLabel.find('input[type="checkbox"]').setValue(false);

    const configureButton = wrapper.findAll('button').find((button) => /Configure|配置/.test(button.text()));
    await configureButton.trigger('click');
    await flushPromises();

    const quantityInput = wrapper.findAll('input[inputmode="numeric"]').find((input) => input.element.value === '3');
    expect(quantityInput).toBeTruthy();
    await quantityInput.setValue('5');

    expect(simulator.simulationSettings.combatScrollsEnabled).toBe(false);
    expect(simulator.activePlayer.combatScrolls['/items/seal_of_damage']).toEqual({ quantity: 5 });
    wrapper.unmount();
  });

  it('keeps the checked row and shows validation feedback for an invalid quantity', async () => {
    const wrapper = mountHomePage(router);
    await flushPromises();

    const configureButton = wrapper.findAll('button').find((button) => /Configure|配置/.test(button.text()));
    await configureButton.trigger('click');
    await flushPromises();

    const quantityInput = wrapper.findAll('input[inputmode="numeric"]').find((input) => input.element.value === '3');
    expect(quantityInput).toBeTruthy();
    quantityInput.element.value = '0';
    await quantityInput.trigger('input');

    expect(simulator.activePlayer.combatScrolls['/items/seal_of_damage']).toEqual({ quantity: 3 });
    expect(quantityInput.element.value).toBe('0');
    expect(wrapper.text()).toMatch(/Enter a positive whole number|请输入正整数/);
    expect(quantityInput.attributes('aria-invalid')).toBe('true');

    await quantityInput.setValue('-');
    expect(simulator.activePlayer.combatScrolls['/items/seal_of_damage']).toEqual({ quantity: 3 });
    expect(quantityInput.element.value).toBe('-');
    expect(wrapper.text()).toMatch(/Enter a positive whole number|请输入正整数/);

    await quantityInput.setValue('e');
    expect(simulator.activePlayer.combatScrolls['/items/seal_of_damage']).toEqual({ quantity: 3 });
    expect(quantityInput.element.value).toBe('e');

    await quantityInput.setValue('5');
    expect(simulator.activePlayer.combatScrolls['/items/seal_of_damage']).toEqual({ quantity: 5 });
    expect(quantityInput.element.value).toBe('5');
    expect(wrapper.text()).not.toMatch(/Enter a positive whole number|请输入正整数/);

    await quantityInput.setValue('');
    expect(simulator.activePlayer.combatScrolls['/items/seal_of_damage']).toEqual({ quantity: null });
    expect(wrapper.text()).not.toMatch(/Enter a positive whole number|请输入正整数/);
    wrapper.unmount();
  });

  it('removes one configured scroll and clears its quantity error', async () => {
    const wrapper = mountHomePage(router);
    await flushPromises();

    const configureButton = wrapper.findAll('button').find((button) => /Configure|配置/.test(button.text()));
    await configureButton.trigger('click');
    await flushPromises();

    const quantityInput = wrapper.findAll('input[inputmode="numeric"]').find((input) => input.element.value === '3');
    await quantityInput.setValue('0');
    expect(wrapper.text()).toMatch(/Enter a positive whole number|请输入正整数/);

    const row = quantityInput.element.closest('.rounded-md');
    const checkbox = row?.querySelector('input[type="checkbox"]');
    expect(checkbox?.checked).toBe(true);
    const checkboxWrapper = wrapper.findAll('input[type="checkbox"]').find((input) => input.element === checkbox);
    expect(checkboxWrapper.attributes('aria-label')).toBeTruthy();
    await checkboxWrapper.setValue(false);

    expect(simulator.activePlayer.combatScrolls).not.toHaveProperty('/items/seal_of_damage');
    expect(wrapper.text()).not.toMatch(/Enter a positive whole number|请输入正整数/);
    wrapper.unmount();
  });

  it('selects and clears all rows without replacing quantities or enabling the outer gate', async () => {
    const wrapper = mountHomePage(router);
    await flushPromises();

    const outerLabel = wrapper
      .findAll('label')
      .find((label) => /Enable Combat Scroll Effects|启用战斗卷轴效果/.test(label.text()));
    await outerLabel.find('input[type="checkbox"]').setValue(false);
    expect(simulator.simulationSettings.combatScrollsEnabled).toBe(false);

    const configureButton = wrapper.findAll('button').find((button) => /Configure|配置/.test(button.text()));
    await configureButton.trigger('click');
    await flushPromises();

    const selectAllButton = wrapper.findAll('button').find((button) => /Select All|全选/.test(button.text()));
    await selectAllButton.trigger('click');

    expect(Object.keys(simulator.activePlayer.combatScrolls)).toHaveLength(combatScrollOptions.length);
    expect(simulator.activePlayer.combatScrolls['/items/seal_of_damage']).toEqual({ quantity: 3 });
    expect(simulator.simulationSettings.combatScrollsEnabled).toBe(false);

    const clearAllButton = wrapper.findAll('button').find((button) => /Clear All|清空/.test(button.text()));
    await clearAllButton.trigger('click');
    expect(simulator.activePlayer.combatScrolls).toEqual({});
    expect(simulator.simulationSettings.combatScrollsEnabled).toBe(false);
    wrapper.unmount();
  });
});

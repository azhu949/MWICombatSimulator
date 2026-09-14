// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import i18next, { initI18n } from '../i18n/i18n.js';
import HomeLoadoutPanels from '../components/home/HomeLoadoutPanels.vue';
import { useHomeTriggerEditor } from '../composables/useHomeTriggerEditor.js';
import { abilityDetailIndex } from '../../shared/gameDataIndex.js';
import { useSimulatorStore } from '../../stores/simulatorStore.js';

let controller;

const Harness = defineComponent({
  components: { HomeLoadoutPanels },
  setup() {
    controller = useHomeTriggerEditor();
    return { controller };
  },
  template: '<HomeLoadoutPanels :trigger-controller="controller" />',
});

const stubs = {
  SearchCombobox: true,
  Select: { template: '<div><slot /></div>' },
  SelectTrigger: { template: "<button type='button'><slot /></button>" },
  SelectContent: { template: '<div><slot /></div>' },
  SelectItem: { template: '<span><slot /></span>' },
};

beforeAll(async () => {
  localStorage.setItem('i18nextLng', 'en');
  await initI18n();
  // useI18nText 的 language ref 是模块级默认值、要等首个组件 onMounted 才与 i18next 同步，
  // 这里显式锁定语言，保证取到的是 en 文案（按钮 aria-label 断言语言相关）。
  await i18next.changeLanguage('en');
});

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
  controller = null;
});

// 真实形状：index 0 = 特殊技能槽（固定），1-4 = 普通技能槽。
function seedAbilitySlots(simulator) {
  const catalog = Object.values(abilityDetailIndex).filter((ability) => ability?.hrid);
  const normalHrids = catalog
    .filter((ability) => ability?.isSpecialAbility !== true)
    .slice(0, 4)
    .map((ability) => String(ability.hrid));
  const specialHrid = String(catalog.find((ability) => ability?.isSpecialAbility === true)?.hrid || '');
  const player = simulator.activePlayer;
  player.abilities = [
    { abilityHrid: specialHrid, level: 1 },
    ...normalHrids.map((hrid, index) => ({ abilityHrid: hrid, level: index + 2 })),
  ];
  return { player, normalHrids, specialHrid };
}

function arrowButton(wrapper, slotLabel, directionLabel) {
  const expected = `${slotLabel} ${directionLabel}`;
  const button = wrapper
    .findAll('button')
    .find((candidate) => String(candidate.attributes('aria-label') || '') === expected);
  if (!button) {
    throw new Error(`Ability slot arrow button not found: ${expected}`);
  }
  return button;
}

function abilityHrids(simulator) {
  return simulator.activePlayer.abilities.map((entry) => String(entry.abilityHrid || ''));
}

// 技能槽上的「升级成本」框（模板里 v-if="abilityUpgradeCostDrafts[slotIndex - 1]" 的那一块，
// 含手填覆盖输入框）——按文案定位，避免绑死 tailwind 类名。
function upgradeCostBoxes(wrapper) {
  return wrapper.findAll('p').filter((paragraph) => String(paragraph.text() || '').includes('Upgrade Cost'));
}

async function mountPanels() {
  const wrapper = mount(Harness, { global: { stubs } });
  // 首帧可能仍用模块加载期的默认语言渲染，等一拍再取按钮文案。
  await flushPromises();
  return wrapper;
}

describe('HomeLoadoutPanels ability slot swap vs trigger editor', () => {
  it('keeps an editor opened on an unrelated ability slot', async () => {
    const simulator = useSimulatorStore();
    const { normalHrids, specialHrid } = seedAbilitySlots(simulator);
    const wrapper = await mountPanels();

    controller.request('ability', 3);
    expect(controller.isActive('ability', 3)).toBe(true);

    // 下移「技能 1」= 互换 0-based 槽位 1 ↔ 2（槽位 3 不参与互换）。
    await arrowButton(wrapper, 'Ability 1', 'Move down').trigger('click');

    expect(abilityHrids(simulator)).toEqual([
      specialHrid,
      normalHrids[1],
      normalHrids[0],
      normalHrids[2],
      normalHrids[3],
    ]);
    // 互换与槽位 3 的编辑器无关：草稿仍然对得上，编辑器不得被顺手关掉——DOM 上仍应处于展开态，
    // 也不能冒出「草稿与新内容不一致」的假 Unsaved 标记。
    expect(controller.isActive('ability', 3)).toBe(true);
    const unrelated = wrapper.find('[data-trigger-target="ability:3"]');
    expect(unrelated.find('[data-trigger-editor]').exists()).toBe(true);
    expect(unrelated.text()).not.toContain('Unsaved');
    wrapper.unmount();
  });

  it('keeps an editor opened on a food slot', async () => {
    const simulator = useSimulatorStore();
    seedAbilitySlots(simulator);
    const wrapper = await mountPanels();

    const foodHrid = String(simulator.options.food[0]?.hrid || '');
    simulator.activePlayer.food[0] = foodHrid;
    controller.request('food', 0);
    expect(controller.isActive('food', 0)).toBe(true);

    await arrowButton(wrapper, 'Ability 1', 'Move down').trigger('click');

    expect(controller.isActive('food', 0)).toBe(true);
    expect(wrapper.find('[data-trigger-target="food:0"] [data-trigger-editor]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('closes the editor sitting on either swapped slot', async () => {
    const simulator = useSimulatorStore();
    const { normalHrids } = seedAbilitySlots(simulator);
    const wrapper = await mountPanels();

    controller.request('ability', 1);
    expect(controller.isActive('ability', 1)).toBe(true);

    await arrowButton(wrapper, 'Ability 1', 'Move down').trigger('click');

    // 槽位 ↔ 技能 的对应关系变了：旧草稿属于「已经搬到槽位 2」的那个技能，必须关闭。
    expect(abilityHrids(simulator).slice(1, 3)).toEqual([normalHrids[1], normalHrids[0]]);
    expect(controller.isActive('ability', 1)).toBe(false);
    expect(wrapper.find('[data-trigger-target="ability:1"] [data-trigger-editor]').exists()).toBe(false);
    expect(controller.activeDraft.value).toEqual([]);
    expect(controller.canLeave()).toBe(true);

    // 另一个被互换的槽位（上移「技能 2」= 互换 1 ↔ 2）同样要被关闭。
    controller.request('ability', 2);
    expect(controller.isActive('ability', 2)).toBe(true);

    await arrowButton(wrapper, 'Ability 2', 'Move up').trigger('click');

    expect(controller.isActive('ability', 2)).toBe(false);
    expect(wrapper.find('[data-trigger-target="ability:2"] [data-trigger-editor]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('小数槽位号（潜在调用方）与 store 同口径：编辑器不会留在已经换过内容的旧槽位上', async () => {
    const simulator = useSimulatorStore();
    const { normalHrids } = seedAbilitySlots(simulator);
    const wrapper = await mountPanels();

    controller.request('ability', 1);
    expect(controller.isActive('ability', 1)).toBe(true);

    // 模板目前只传整数（slotIndex - 1），这里直接按小数调用内部函数，锚定的是口径不变量本身：
    // store 会把 1.9/2.4 floor 成 1/2 并真的交换槽位 1 ↔ 2 —— UI 的比对必须用同一个数字，
    // 否则这里会留下一个「停在已换过内容的旧槽位」的编辑器（正是 G2 描述的失配）。
    wrapper.findComponent(HomeLoadoutPanels).vm.swapAbilitySlots(1.9, 2.4);

    expect(abilityHrids(simulator).slice(1, 3)).toEqual([normalHrids[1], normalHrids[0]]);
    expect(controller.isActive('ability', 1)).toBe(false);
    expect(wrapper.find('[data-trigger-target="ability:1"] [data-trigger-editor]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('still blocks the swap on a dirty draft and keeps it open', async () => {
    const simulator = useSimulatorStore();
    seedAbilitySlots(simulator);
    const wrapper = await mountPanels();

    controller.request('ability', 1);
    controller.updateDraft([{ type: 'always' }]);
    controller.updateDirty('ability', 1, true);
    const before = abilityHrids(simulator);

    await arrowButton(wrapper, 'Ability 1', 'Move down').trigger('click');

    expect(abilityHrids(simulator)).toEqual(before);
    expect(controller.isActive('ability', 1)).toBe(true);
    expect(controller.canLeave()).toBe(false);
    wrapper.unmount();
  });

  it('does not show ability upgrade cost boxes after a pure reorder (skill-anchored cost model)', async () => {
    const simulator = useSimulatorStore();
    const { normalHrids } = seedAbilitySlots(simulator);
    // 基准 = 当前配置（普通技能等级 2..5）⇒ 本来就没有任何升级项，五个槽位都不该有成本框。
    await simulator.setQueueBaselineForActivePlayer();

    const wrapper = await mountPanels();
    expect(upgradeCostBoxes(wrapper)).toHaveLength(0);

    // 箭头重排（等级随技能走）：旧的槽位锚定口径把两个被搬动的槽当成「该槽换了个技能」、从 1 级起
    // 全额计价，于是首页这两行同时冒出「升级成本」框（并诱导手填覆盖）。技能锚定口径下应当是 0 个。
    await arrowButton(wrapper, 'Ability 1', 'Move down').trigger('click');
    await flushPromises();

    expect(abilityHrids(simulator).slice(1, 3)).toEqual([normalHrids[1], normalHrids[0]]);
    expect(upgradeCostBoxes(wrapper)).toHaveLength(0);
    wrapper.unmount();
  });

  it('still shows the upgrade cost box for a real level upgrade (so the 0-box assertion above is not vacuous)', async () => {
    const simulator = useSimulatorStore();
    seedAbilitySlots(simulator);
    await simulator.setQueueBaselineForActivePlayer();

    // 真正的升级：技能留在原槽、等级 3 → 6 ⇒ 该槽必须仍然有成本框 + 手填覆盖输入框。
    simulator.activePlayer.abilities[1].level = 6;

    const wrapper = await mountPanels();
    await flushPromises();

    expect(upgradeCostBoxes(wrapper)).toHaveLength(1);
    wrapper.unmount();
  });
});

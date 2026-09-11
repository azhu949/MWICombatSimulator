// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import FoodOptimizerPage from '../pages/FoodOptimizerPage.vue';
import { useSimulatorStore } from '../../stores/simulatorStore.js';
import { initI18n } from '../i18n/i18n.js';
import appRouter from '../router/index.js';
import FoodOptimizerDetails from '../components/FoodOptimizerDetails.vue';
import { createFoodOptimizerReport } from '../../services/foodOptimizerSearch.js';
import { buildFoodCandidate, getFoodOptimizerItems } from '../../services/foodOptimizerDomain.js';
import { snapshotFoodOptimizerInput } from '../../services/foodOptimizerSnapshot.js';

vi.mock('../../services/itemIconSprite.js', () => ({
  ensureItemIconSymbols: vi.fn(async () => {}),
  hasItemIconSymbol: () => false,
  itemIconHref: () => '#',
}));
// 弹窗内容默认 Teleport 到 body，模板测试改为内联渲染的开/关容器。
const baseModalStub = defineComponent({
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, default: '' },
  },
  template: '<div v-if="open" role="dialog"><h2>{{ title }}</h2><slot /></div>',
});
const wrappers = [];
beforeAll(() => initI18n());
beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount());
  wrappers.length = 0;
  vi.restoreAllMocks();
});

async function mountPage(configure = () => {}) {
  const store = useSimulatorStore();
  configure(store);
  vi.spyOn(store, 'refreshFoodOptimizerPreview').mockImplementation(async () => {
    store.foodOptimizer.preview = {
      inputSignature: store.foodOptimizerInputSignature,
      totalCandidates: 100,
      resources: { maxHp: 110, maxMp: 110, foodSlots: 1 },
    };
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/food-optimizer', component: FoodOptimizerPage },
      { path: '/home', component: { template: '<div />' } },
    ],
  });
  await router.push('/food-optimizer');
  const wrapper = mount(FoodOptimizerPage, {
    global: { plugins: [router], stubs: { BaseModal: baseModalStub } },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, store, router };
}

describe('food optimizer page', () => {
  it('labels reused reports and preserves their original statistics', async () => {
    const { wrapper, store } = await mountPage((current) => {
      const input = snapshotFoodOptimizerInput(current);
      const request = { ...input, inputSignature: current.foodOptimizerInputSignature };
      const report = createFoodOptimizerReport(request, [], 0);
      Object.assign(report, { complete: true, status: 'completed', fromCache: true });
      report.stats.completedRounds = 12;
      current.foodOptimizer.report = report;
      current.foodOptimizer.runtime.phase = 'completed';
    });
    expect(wrapper.get('[data-food-optimizer-report-reuse]').text()).toContain('本次无需重新模拟');
    expect(wrapper.get('[data-food-optimizer-report-reuse]').text()).toContain('统计来自原搜索');
    expect(wrapper.text()).toContain('已完成模拟轮数: 12');
    store.foodOptimizer.runtime.isRunning = true;
    await flushPromises();
    expect(wrapper.find('[data-food-optimizer-report-reuse]').exists()).toBe(false);
  });

  it.each([false, true])(
    'blocks labyrinth optimization and restores normal targets (dungeon=%s)',
    async (useDungeon) => {
      const { wrapper, store } = await mountPage((current) => {
        current.setImportedProfileState('1', true);
        current.setSimulationMode('labyrinth');
      });
      const start = () => wrapper.findAll('button').find((button) => button.text().includes('开始搜索'));
      expect(start().element.disabled).toBe(true);
      expect(wrapper.text()).toContain('食物优化不支持迷宫，请选择普通地图或地下城。');
      // The preview stub deliberately supplies an old, matching preview. The page
      // must still avoid presenting it as a supported labyrinth search.
      expect(wrapper.findAll('dd').filter((entry) => entry.text() === '—')).toHaveLength(2);
      expect(wrapper.text()).not.toContain('110 / 110');

      store.setSimulationMode('zone');
      store.simulationSettings.useDungeon = useDungeon;
      await flushPromises();
      expect(start().element.disabled).toBe(false);
      expect(wrapper.text()).not.toContain('食物优化不支持迷宫');
    },
  );

  it.each(['simulation', 'payload'])('disables applying old labyrinth results described by %s', async (key) => {
    const { wrapper, store } = await mountPage((current) => {
      current.setImportedProfileState('1', true);
      const input = snapshotFoodOptimizerInput(current);
      const request = {
        ...input,
        inputSignature: current.foodOptimizerInputSignature,
        payload: { ...input.simulation, players: [{ hrid: 'player1', food: [null, null, null] }] },
      };
      request[key] = {
        ...request[key],
        zone: null,
        labyrinth: { labyrinthHrid: current.simulationSettings.labyrinthHrid, roomLevel: 40 },
      };
      const food = getFoodOptimizerItems({ maxHp: 110, maxMp: 110, thresholdStepPercent: 10 })[0];
      const candidate = buildFoodCandidate([{ ...food, threshold: 40 }]);
      const report = createFoodOptimizerReport(request, [food], 1);
      Object.assign(report, {
        complete: true,
        status: 'completed',
        baseline: { foodUsed: {}, costPerHour: 0, deaths: 0, ranOutOfMana: false },
        topResults: [{ ...candidate, foodUsed: {}, costPerHour: 0, savingsPerHour: 0, deaths: 0 }],
      });
      current.foodOptimizer.report = report;
    });

    expect(store.foodOptimizerReportStale).toBe(false);
    const apply = wrapper.findAll('button').find((button) => button.text().includes('应用方案'));
    expect(apply.element.disabled).toBe(true);
    expect(wrapper.text()).toContain('食物优化不支持迷宫，请选择普通地图或地下城。');
    const start = wrapper.findAll('button').find((button) => button.text().includes('开始搜索'));
    expect(start.element.disabled).toBe(false);
  });

  it('shows shared food usage only once when the baseline repeats an item in multiple slots', () => {
    const slots = [0, 2].map((slotIndex) => ({ hrid: '/items/donut', slotIndex, price: 5, triggers: [] }));
    const wrapper = mount(FoodOptimizerDetails, { props: { slots, usage: { '/items/donut': 4 }, hours: 2 } });
    wrappers.push(wrapper);
    expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    const cells = wrapper.findAll('tbody td');
    expect(cells[0].text()).toBe('1, 3');
    expect(cells[4].text()).toBe('4');
    expect(cells[5].text()).toBe('10');
  });
  it('registers a lazy independent Simulation page after Advisor', () => {
    const route = appRouter.getRoutes().find((entry) => entry.name === 'food-optimizer');
    expect(route.path).toBe('/food-optimizer');
    expect(typeof route.components.default).toBe('function');
    expect(route.meta).toMatchObject({ showCombatToolbar: false, navGroup: 'simulation', navOrder: 2.5 });
  });

  it('accepts configurable integer steps, persists them, and blocks invalid drafts', async () => {
    const { wrapper, store } = await mountPage();
    store.setImportedProfileState('1', true);
    await flushPromises();
    const inputs = wrapper.findAll('input[type="number"]');
    expect(inputs[0].element.value).toBe('10');
    expect(inputs[1].element.value).toBe('3');
    await inputs[0].setValue('15');
    expect(store.foodOptimizer.settings.thresholdStepPercent).toBe(15);
    await inputs[0].setValue('1.5');
    await flushPromises();
    expect(inputs[0].attributes('aria-invalid')).toBe('true');
    const start = wrapper.findAll('button').find((button) => button.text().includes('开始搜索'));
    expect(start.element.disabled).toBe(true);
  });

  it('opens the food scope dialog before starting and searches with the chosen foods', async () => {
    const { wrapper, store } = await mountPage((current) => current.setImportedProfileState('1', true));
    const start = vi.spyOn(store, 'startFoodOptimizer').mockImplementation(() => {});
    const scopeItems = () => wrapper.findAll('[data-food-optimizer-scope-item]');
    const scopeButton = (text) => wrapper.findAll('button').find((button) => button.text().includes(text));

    expect(wrapper.find('[data-food-optimizer-scope-item]').exists()).toBe(false);
    await wrapper.get('[data-food-optimizer-open-scope]').trigger('click');
    await flushPromises();

    expect(scopeItems().length).toBeGreaterThan(2);
    expect(scopeItems().every((box) => box.element.checked)).toBe(true);
    expect(wrapper.get('[data-food-optimizer-scope-summary]').text()).toContain(`已选 ${scopeItems().length}`);

    // 恢复生命值与恢复法力值分列成组，每组带自己的计数、全选/清空与食物图标（缺图标时用占位图标）。
    const hpGroup = wrapper.get('[data-food-optimizer-scope-group="hp"]');
    const mpGroup = wrapper.get('[data-food-optimizer-scope-group="mp"]');
    const groupItems = (group) => group.findAll('[data-food-optimizer-scope-item]');
    expect(groupItems(hpGroup).length).toBeGreaterThan(0);
    expect(groupItems(mpGroup).length).toBeGreaterThan(0);
    expect(hpGroup.text()).toContain('恢复生命值');
    expect(mpGroup.text()).toContain('恢复法力值');
    expect(groupItems(hpGroup).length + groupItems(mpGroup).length).toBe(scopeItems().length);
    expect(hpGroup.findAll('svg').length).toBe(groupItems(hpGroup).length);
    expect(hpGroup.text()).toContain(`已选 ${groupItems(hpGroup).length}/${groupItems(hpGroup).length}`);
    await groupItems(hpGroup)[0].setValue(false);
    await flushPromises();
    expect(hpGroup.text()).toContain(`已选 ${groupItems(hpGroup).length - 1}/${groupItems(hpGroup).length}`);
    expect(hpGroup.findAll('button').find((button) => button.text().includes('清空')).element.disabled).toBe(false);
    await hpGroup
      .findAll('button')
      .find((button) => button.text().includes('全选'))
      .trigger('click');
    await flushPromises();
    expect(groupItems(hpGroup).every((box) => box.element.checked)).toBe(true);

    await scopeButton('清空').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-food-optimizer-scope-start]').element.disabled).toBe(true);
    expect(wrapper.text()).toContain('请至少选择一种食物。');

    await scopeButton('全选').trigger('click');
    await flushPromises();
    expect(scopeItems().every((box) => box.element.checked)).toBe(true);

    await scopeItems()[0].setValue(false);
    await flushPromises();
    const kept = scopeItems()
      .slice(1)
      .map((box) => box.attributes('data-food-optimizer-scope-item'));
    expect(kept.length).toBeGreaterThan(0);
    await wrapper.get('[data-food-optimizer-scope-start]').trigger('click');
    await flushPromises();

    // 存储口径按目录顺序归一化，与弹窗里的分组展示顺序无关。
    expect([...store.foodOptimizer.settings.foodHrids].sort()).toEqual([...kept].sort());
    expect(wrapper.find('[data-food-optimizer-scope-item]').exists()).toBe(false);
    expect(start).toHaveBeenCalledOnce();
  });

  it('recommends exact top 10 and saves a switch to complete statistics', async () => {
    const { wrapper, store } = await mountPage();
    const mode = wrapper.get('[data-food-optimizer-search-mode]');
    expect(mode.element.value).toBe('top10');
    expect(mode.find('option[value="top10"]').text()).toBe('精确前 10（推荐）');
    expect(wrapper.get('[data-food-optimizer-mode-hint]').text()).toContain('精确找出');

    await mode.setValue('complete');
    await flushPromises();

    expect(store.foodOptimizer.settings.searchMode).toBe('complete');
    expect(JSON.parse(localStorage.getItem('mwi.foodOptimizer.settings.v1')).searchMode).toBe('complete');
    expect(wrapper.get('[data-food-optimizer-mode-hint]').text()).toContain('统计全部候选的可行性');
    expect(store.foodOptimizer.preview.totalCandidates).toBe(100);
  });

  it('locks controls while running and does not stop on unmount', async () => {
    const { wrapper, store } = await mountPage();
    const stop = vi.spyOn(store, 'stopFoodOptimizer');
    store.foodOptimizer.runtime.isRunning = true;
    await flushPromises();
    expect(wrapper.find('select').element.disabled).toBe(true);
    expect(wrapper.get('[data-food-optimizer-search-mode]').element.disabled).toBe(true);
    expect(wrapper.findAll('input[type="number"]').every((input) => input.element.disabled)).toBe(true);
    wrapper.unmount();
    wrappers.length = 0;
    expect(stop).not.toHaveBeenCalled();
    expect(store.foodOptimizer.runtime.isRunning).toBe(true);
  });

  it.each(['top10', 'complete'])(
    'keeps stop available in %s mode and unlocks settings afterward',
    async (searchMode) => {
      const { wrapper, store } = await mountPage((current) => current.setFoodOptimizerSettings({ searchMode }));
      const stop = vi.spyOn(store, 'stopFoodOptimizer');
      store.foodOptimizer.runtime.isRunning = true;
      await flushPromises();
      const mode = wrapper.get('[data-food-optimizer-search-mode]');
      expect(mode.element.disabled).toBe(true);
      await wrapper
        .findAll('button')
        .find((button) => button.text().includes('停止搜索'))
        .trigger('click');
      await flushPromises();

      expect(stop).toHaveBeenCalledOnce();
      expect(store.foodOptimizer.runtime.isRunning).toBe(false);
      expect(store.foodOptimizer.runtime.phase).toBe('cancelled');
      expect(mode.element.disabled).toBe(false);
      expect(mode.element.value).toBe(searchMode);
    },
  );

  it.each([true, false])(
    'explains top-10 counts using the report mode after settings change (complete=%s)',
    async (complete) => {
      const { wrapper, store } = await mountPage((current) => {
        current.setImportedProfileState('1', true);
        const input = snapshotFoodOptimizerInput(current);
        const request = {
          ...input,
          inputSignature: current.foodOptimizerInputSignature,
          payload: { ...input.simulation, players: [{ hrid: 'player1', food: [null, null, null] }] },
        };
        const food = getFoodOptimizerItems({ maxHp: 110, maxMp: 110, thresholdStepPercent: 10 })[0];
        const candidate = buildFoodCandidate([{ ...food, threshold: 40 }]);
        const report = createFoodOptimizerReport(request, [food], 1);
        Object.assign(report, {
          complete,
          status: complete ? 'completed' : 'cancelled',
          baseline: { foodUsed: {}, costPerHour: 15, deaths: 0, ranOutOfMana: false },
          topResults: [{ ...candidate, foodUsed: {}, costPerHour: 10, savingsPerHour: 5, deaths: 0 }],
        });
        Object.assign(report.stats, {
          totalCandidates: 100,
          completedCandidates: 100,
          simulatedCandidates: 10,
          reusedCandidates: 5,
          skippedCandidates: 5,
          prunedCandidates: 80,
          feasibleCandidates: 14,
          rejectedMana: 4,
          rejectedDeaths: 2,
        });
        current.foodOptimizer.report = report;
        current.foodOptimizer.runtime.phase = report.status;
      });

      expect(wrapper.get('[data-food-optimizer-pruned-count]').text()).toBe('已排除无法入榜: 80');
      expect(wrapper.text()).toContain('已确认可行: 14');
      expect(wrapper.get('[data-food-optimizer-stats-hint]').text()).toContain('不代表可行方案总数');
      expect(wrapper.text()).not.toContain('所有可行方案都参与排名');
      expect(wrapper.findAll('h3').some((heading) => heading.text().includes('搜索未完成'))).toBe(!complete);

      await wrapper.get('[data-food-optimizer-search-mode]').setValue('complete');
      await flushPromises();

      expect(store.foodOptimizer.settings.searchMode).toBe('complete');
      expect(store.foodOptimizer.report.request.searchMode).toBe('top10');
      expect(wrapper.get('[data-food-optimizer-pruned-count]').text()).toBe('已排除无法入榜: 80');
      expect(wrapper.get('[data-food-optimizer-stats-hint]').text()).toContain('不代表可行方案总数');
    },
  );

  it('shows composition screening as a separate phase with accurate counts', async () => {
    const { wrapper, store } = await mountPage();
    store.foodOptimizer.report = createFoodOptimizerReport(
      { rounds: 3, inputSignature: store.foodOptimizerInputSignature },
      [],
      0,
    );
    Object.assign(store.foodOptimizer.report.stats, {
      totalCompositions: 100,
      screenedCompositions: 25,
      passedCompositions: 7,
      completedCandidates: 48,
      simulatedCandidates: 25,
      skippedCandidates: 15,
      reusedCandidates: 8,
      reusedRounds: 12,
    });
    Object.assign(store.foodOptimizer.runtime, { phase: 'screening', isRunning: true, progress: 0.1 });
    await flushPromises();
    expect(wrapper.text()).toContain('预筛选食物组合');
    expect(wrapper.text()).toMatch(/已预筛选组合: 25\s*\/\s*100/);
    expect(wrapper.text()).toContain('默认阈值通过组合: 7');
    expect(wrapper.text()).toContain('已模拟方案: 25');
    expect(wrapper.text()).toContain('无效方案提前排除: 15');
    expect(wrapper.text()).toContain('可行方案复用: 8');
    expect(wrapper.text()).toContain('单轮结果复用: 12');
    expect(wrapper.text()).toContain('所有可行方案都参与排名');
    expect(wrapper.find('[data-food-optimizer-pruned-count]').exists()).toBe(false);
    expect(wrapper.find('progress').element.value).toBe(0.1);
    expect(wrapper.text()).not.toContain('安全筛选跳过');
  });

  it('disables starting without imported data and links to combat setup', async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.text()).toContain('尚未导入');
    expect(wrapper.find('a').attributes('href')).toBe('/home');
    const start = wrapper.findAll('button').find((button) => button.text().includes('开始搜索'));
    expect(start.element.disabled).toBe(true);
  });
});

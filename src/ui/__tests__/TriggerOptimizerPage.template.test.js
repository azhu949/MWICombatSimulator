// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, defineComponent } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';

import TriggerOptimizerPage from '../pages/TriggerOptimizerPage.vue';
import { useSimulatorStore } from '../../stores/simulatorStore.js';
import { initI18n } from '../i18n/i18n.js';
import appRouter from '../router/index.js';
import abilityDetailMap from '../../combatsimulator/data/abilityDetailMap.json';
import {
  TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT,
  TRIGGER_OPTIMIZER_MAX_MAX_ROUNDS,
  TRIGGER_OPTIMIZER_MAX_ROUNDS,
  TRIGGER_OPTIMIZER_MAX_SIMULATION_HOURS,
  TRIGGER_OPTIMIZER_MIN_CANDIDATE_LIMIT,
  TRIGGER_OPTIMIZER_MIN_MAX_ROUNDS,
  TRIGGER_OPTIMIZER_MIN_ROUNDS,
  TRIGGER_OPTIMIZER_MIN_SIMULATION_HOURS,
} from '../../services/triggerOptimizerDomain.js';
import { downloadTriggerOptimizerReportXlsx } from '../components/triggerOptimizerExport.js';

vi.mock('../components/triggerOptimizerExport.js', () => ({
  downloadTriggerOptimizerReportXlsx: vi.fn(),
  buildTriggerOptimizerReportSheets: vi.fn(),
}));

const SELF = '/combat_trigger_dependencies/self';
const CURRENT_HP = '/combat_trigger_conditions/current_hp';
const LTE = '/combat_trigger_comparators/less_than_equal';

// 页面只消费 store，不经手 worker：这里直接注入「搜索完成」形态的 results
//（字段口径与 triggerOptimizerSearch.optimizeTriggers 的返回一致）。
const [ABILITY_HRID] = Object.values(abilityDetailMap)
  .filter(
    (entry) =>
      entry?.isSpecialAbility !== true &&
      Array.isArray(entry?.defaultCombatTriggers) &&
      entry.defaultCombatTriggers.length > 0,
  )
  .slice(0, 1)
  .map((entry) => entry.hrid);

const wrappers = [];
// 详情弹窗（BaseModal）默认 Teleport 到 body，模板测试改为内联渲染的开/关容器：
// 候选表与相关数据都在弹窗里，断言必须先能看见它。
const baseModalStub = defineComponent({
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, default: '' },
  },
  emits: ['close'],
  template:
    '<div v-if="open" role="dialog"><h2>{{ title }}</h2>' +
    '<button type="button" data-test-modal-close @click="$emit(\'close\')">close</button><slot /></div>',
});
beforeAll(() => initI18n());
beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount());
  wrappers.length = 0;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function readySetup(store) {
  store.setImportedProfileState('1', true);
  store.simulationSettings.zoneHrid = '/actions/combat/fly';
  store.activePlayer.levels.intelligence = 99;
  store.activePlayer.abilities[1] = { abilityHrid: ABILITY_HRID, level: 1 };
}

function customTrigger(value) {
  return { dependencyHrid: SELF, conditionHrid: CURRENT_HP, comparatorHrid: LTE, value };
}

function makeResult(store, overrides = {}) {
  const triggers = [customTrigger(500)];
  const signature = JSON.stringify(triggers);
  const metrics = { dps: 100, dailyNoRngProfit: 5, xpPerHour: 1000, killsPerHour: 60, deathsPerHour: 0 };
  const candidates = [
    {
      slotIndex: 1,
      abilityHrid: ABILITY_HRID,
      role: 'damage',
      state: 'default',
      triggers: null,
      signature: 'default',
      labelKey: 'common:triggerOptimizer.candidate.default',
      labelParams: {},
      distance: 0,
    },
    {
      slotIndex: 1,
      abilityHrid: ABILITY_HRID,
      role: 'damage',
      state: 'disabled',
      triggers: [],
      signature: '[]',
      labelKey: 'common:triggerOptimizer.candidate.alwaysFire',
      labelParams: {},
      distance: 1,
    },
    {
      slotIndex: 1,
      abilityHrid: ABILITY_HRID,
      role: 'damage',
      state: 'custom',
      triggers,
      signature,
      labelKey: 'common:triggerOptimizer.candidate.lowHp',
      labelParams: { percent: 75 },
      distance: 2,
    },
  ];
  const chosen = { ...candidates[2], metrics, score: 0.42 };
  return {
    cancelled: false,
    rounds: 1,
    perAbilityChoices: [
      {
        slotIndex: 1,
        abilityHrid: ABILITY_HRID,
        role: 'damage',
        roleLabelKey: 'common:triggerOptimizer.role.damage',
        candidates,
        chosen,
        // 截断透明化（设计 §28）：这一槽生成了 6 条、被「每槽候选上限 3」截掉 3 条 —— 候选表
        // 里只有 3 条，UI 必须说出来（「评估了 3 条」≠「只有 3 条」）。
        candidateLimit: 3,
        generatedCandidates: 6,
        truncatedCandidates: 3,
      },
    ],
    metricsByCandidate: {
      // 报告以「槽位 + 签名」为键：不同技能可能生成同一份触发器列表，只按签名做键会串味。
      '1|default': { metrics: { ...metrics, dps: 90 }, score: -0.05, paired: null, slotIndex: 1 },
      // racing 粗筛淘汰行（设计 §30）：lane='screen' 表示这行只有粗筛样本（未进精测），
      // UI 必须标注采样口径 —— 用例见「marks screened-only candidates…」。
      '1|[]': {
        metrics: { ...metrics, dps: 95 },
        score: 0.1,
        paired: null,
        slotIndex: 1,
        lane: 'screen',
        sampleRounds: 2,
      },
      [`1|${signature}`]: { metrics, score: 0.42, paired: null, slotIndex: 1 },
    },
    // 该槽**真的被采纳过**（2026-09-19）：chosen 会保留未被采纳的槽内最优，UI 的「推荐」
    // 徽章只看 chosen 就会与「证据不足 / 已优化 0 / N」自相矛盾。
    adoptedSlots: [1],
    deepDives: [],
    // 跨槽联合采纳（2026-09-19，设计 §19.11）：默认无；用例按需覆盖。
    jointAdoptions: [],
    // 「轮数上限截断」（2026-09-19，设计 §19.8）：默认收敛结束 → false；用例按需覆盖。
    roundLimitReached: false,
    baselineMetrics: { ...metrics, dps: 90 },
    bestTriggerMap: { [ABILITY_HRID]: triggers },
    // 独立复验：换一组种子重跑「当前配置 vs 最优」，给出显著性结论。
    verification: {
      verdict: 'positive',
      baselineMetrics: { ...metrics, dps: 90 },
      bestMetrics: metrics,
      paired: {
        rounds: 6,
        score: { rounds: 6, mean: 0.05, stdError: 0.01, t: 5, dof: 5, pValue: 0.004, verdict: 'positive' },
      },
      seeds: [1, 2, 3, 4, 5, 6],
      rounds: 6,
    },
    resourcesAvailable: true,
    lockedAbilityHrids: [],
    improvement: {
      score: 0.42,
      scoreDelta: 0.47,
      improved: true,
      metrics,
      signature,
      paired: { rounds: 2, score: { mean: 0.02, stdError: null, t: null, dof: 1, pValue: null, verdict: 'unknown' } },
      deltas: {
        dps: { absolute: 10, percent: 5 },
        dailyNoRngProfit: { absolute: 1, percent: 2 },
        xpPerHour: { absolute: 100, percent: 1.5 },
        killsPerHour: { absolute: 3, percent: 4 },
      },
      deathsAbsolute: 0,
    },
    evaluations: 5,
    simulations: 10,
    evaluationRounds: 2,
    maxConcurrentWorkers: 2,
    workerLimit: 4,
    elapsedSeconds: 12,
    error: '',
    inputSignature: store.triggerOptimizerInputSignature,
    appliedInputSignature: '',
    createdAt: Date.now(),
    stale: false,
    ...overrides,
  };
}

async function mountPage(configure = () => {}) {
  const store = useSimulatorStore();
  configure(store);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/trigger-optimizer', component: TriggerOptimizerPage },
      { path: '/home', component: { template: '<div />' } },
    ],
  });
  await router.push('/trigger-optimizer');
  const wrapper = mount(TriggerOptimizerPage, {
    global: { plugins: [router], stubs: { BaseModal: baseModalStub } },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, store };
}

// 详情入口：候选评估 / 指标明细 / 深挖与联合采纳记录都在弹窗里，先点开再断言。
async function openDetails(wrapper, slotIndex) {
  await wrapper.get(`[data-trigger-optimizer-details-open="${slotIndex}"]`).trigger('click');
  await flushPromises();
}

// 结果说明入口（2026-09-22）：复验口径 / 得分尺度 / 指标口径 / 深挖复核 / 跨槽联合采纳 /
// 轮数上限 / 噪声地板与显著门槛 / 应用范围这些解释性长段落全部收进「查看说明」弹窗，断言前先点开。
async function openNotes(wrapper) {
  await wrapper.get('[data-trigger-optimizer-notes-open]').trigger('click');
  await flushPromises();
}

// 参数说明入口（2026-09-22）：搜索设置卡片下面那 8 段解释（锁定含义 / 档位含义 / 重复次数 /
// 权重 / 搜索过程 / 模拟时长 / 优化范围 / 配对比较）同样收在弹窗里。
async function openSettingsNotes(wrapper) {
  await wrapper.get('[data-trigger-optimizer-settings-notes-open]').trigger('click');
  await flushPromises();
}

async function closeNotes(wrapper) {
  await wrapper.get('[data-test-modal-close]').trigger('click');
  await flushPromises();
}

// 说明弹窗里的一条（键见 TriggerOptimizerPage 的 resultNotes / settingsNotes）。
function noteEntry(wrapper, key) {
  return wrapper.get(`[data-trigger-optimizer-note="${key}"]`);
}

// 两份说明弹窗共用一个组件，靠 scope 区分 DOM（结果说明 = result，参数说明 = settings）。
function notesDialog(wrapper, scope) {
  return wrapper.get(`[data-trigger-optimizer-notes="${scope}"]`);
}

describe('trigger optimizer page', () => {
  it('registers a lazy simulation route right below the food optimizer', () => {
    const route = appRouter.getRoutes().find((entry) => entry.name === 'trigger-optimizer');
    expect(route.path).toBe('/trigger-optimizer');
    expect(typeof route.components.default).toBe('function');
    expect(route.meta).toMatchObject({ showCombatToolbar: false, navGroup: 'simulation', navOrder: 2.6 });
  });

  it('blocks the search without imported data and links to the Home page', async () => {
    const { wrapper } = await mountPage();
    expect(wrapper.find('[data-trigger-optimizer-page]').exists()).toBe(true);
    expect(wrapper.text()).toContain('技能优化');
    expect(wrapper.get('[data-trigger-optimizer-start]').element.disabled).toBe(true);
    expect(wrapper.text()).toContain('当前玩家尚未导入角色信息。');
    expect(wrapper.text()).toContain('未导入');
    const empty = wrapper.get('[data-trigger-optimizer-empty]');
    expect(empty.text()).toContain('尚未导入角色数据');
    expect(empty.find('a').attributes('href')).toBe('/home');
  });

  it('starts the search through the store action and keeps stop available while running', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const start = wrapper.get('[data-trigger-optimizer-start]');
    expect(start.element.disabled).toBe(false);

    const startSpy = vi.spyOn(store, 'startTriggerOptimizer').mockImplementation(() => {});
    await start.trigger('click');
    expect(startSpy).toHaveBeenCalledOnce();

    const stopSpy = vi.spyOn(store, 'stopTriggerOptimizer').mockImplementation(() => {});
    store.triggerOptimizer.runtime.isRunning = true;
    await flushPromises();
    expect(wrapper.find('[data-trigger-optimizer-start]').exists()).toBe(false);
    expect(wrapper.find('[data-trigger-optimizer-max-rounds]').element.disabled).toBe(true);
    expect(wrapper.find('select').element.disabled).toBe(true);
    // 自身运行期间不显示「其他任务占用」提示。
    expect(wrapper.text()).not.toContain('其他模拟或行情任务正在运行');

    await wrapper.get('[data-trigger-optimizer-stop]').trigger('click');
    expect(stopSpy).toHaveBeenCalledOnce();
  });

  it('edits optimizer settings from the inputs and flags invalid drafts', async () => {
    const { wrapper, store } = await mountPage(readySetup);

    await wrapper.get('[data-trigger-optimizer-max-rounds]').setValue('3');
    expect(store.triggerOptimizer.settings.maxRounds).toBe(3);

    await wrapper.get('[data-trigger-optimizer-profit-weight]').setValue('60');
    expect(store.triggerOptimizer.settings.objectiveWeights.weightProfit).toBeCloseTo(0.6);
    expect(store.triggerOptimizer.settings.objectiveWeights.weightXp).toBeCloseTo(0.3);
    expect(store.triggerOptimizer.settings.objectiveWeights.weightDeathSafety).toBeCloseTo(0.1);
    expect(wrapper.get('[data-trigger-optimizer-death-weight]').text()).toBe('10%');

    await wrapper.get('[data-trigger-optimizer-hours]').setValue('48');
    expect(store.triggerOptimizer.settings.simulationHours).toBe(48);

    await wrapper.get('[data-trigger-optimizer-hours]').setValue('');
    await flushPromises();
    expect(wrapper.get('[data-trigger-optimizer-hours]').attributes('aria-invalid')).toBe('true');
    expect(wrapper.get('[data-trigger-optimizer-start]').element.disabled).toBe(true);
    expect(wrapper.text()).toContain('模拟时长 1–168 小时');
  });

  it('binds the numeric input bounds to the shared range constants', async () => {
    const { wrapper } = await mountPage();
    const rounds = wrapper.get('[data-trigger-optimizer-max-rounds]');
    expect(rounds.attributes('min')).toBe(String(TRIGGER_OPTIMIZER_MIN_MAX_ROUNDS));
    expect(rounds.attributes('max')).toBe(String(TRIGGER_OPTIMIZER_MAX_MAX_ROUNDS));
    const candidates = wrapper.get('[data-trigger-optimizer-candidate-limit]');
    expect(candidates.attributes('min')).toBe(String(TRIGGER_OPTIMIZER_MIN_CANDIDATE_LIMIT));
    expect(candidates.attributes('max')).toBe(String(TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT));
    const hours = wrapper.get('[data-trigger-optimizer-hours]');
    expect(hours.attributes('min')).toBe(String(TRIGGER_OPTIMIZER_MIN_SIMULATION_HOURS));
    expect(hours.attributes('max')).toBe(String(TRIGGER_OPTIMIZER_MAX_SIMULATION_HOURS));
    const sampleRounds = wrapper.get('[data-trigger-optimizer-rounds]');
    expect(sampleRounds.attributes('min')).toBe(String(TRIGGER_OPTIMIZER_MIN_ROUNDS));
    expect(sampleRounds.attributes('max')).toBe(String(TRIGGER_OPTIMIZER_MAX_ROUNDS));
  });

  it('renders per-ability cards comparing the search start with the simulated best, and applies the improvement', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.triggerOptimizer.results = makeResult(store);
    await flushPromises();

    // 卡片先给出对比本身：左侧当前配置（搜索起点）、右侧模拟最优配置 + 候选标签。
    expect(wrapper.findAll('[data-trigger-optimizer-choice]')).toHaveLength(1);
    expect(wrapper.get('[data-trigger-optimizer-original]').text()).toContain('游戏默认触发器');
    expect(wrapper.get('[data-trigger-optimizer-best]').text()).toContain('我的 当前HP <= 500');
    expect(wrapper.get('[data-trigger-optimizer-best-label]').text()).toContain('生命 ≤ 75%');
    expect(wrapper.get('[data-trigger-optimizer-score]').text()).toContain('0.42');
    expect(wrapper.text()).toContain('候选评估: 5');
    expect(wrapper.text()).toContain('模拟场次: 10');

    // 候选明细收进「详情」：点开之前不渲染（列表保持可扫读）。
    expect(wrapper.find('[data-trigger-optimizer-details]').exists()).toBe(false);
    await openDetails(wrapper, 1);
    const rows = wrapper.findAll('[data-trigger-optimizer-candidate]');
    expect(rows).toHaveLength(3);
    expect(wrapper.findAll('[data-trigger-optimizer-candidate-winner="true"]')).toHaveLength(1);
    expect(wrapper.text()).toContain('生命 ≤ 75%');
    expect(wrapper.text()).toContain('本槽最优');
    expect(wrapper.text()).toContain('游戏默认触发器');

    const apply = wrapper.get('[data-trigger-optimizer-apply]');
    expect(apply.element.disabled).toBe(false);
    const applySpy = vi.spyOn(store, 'applyTriggerOptimizerResult').mockReturnValue(true);
    await apply.trigger('click');
    expect(applySpy).toHaveBeenCalledOnce();
  });

  // 卡片式对比（2026-09-22）：左「当前配置（搜索起点）」、右「模拟最优配置」。两侧都取自**报告**，
  // 不读玩家当前的 triggerMap —— 应用结果后那份配置已经被改写成最优配置，拿它当「原始配置」
  // 会让对比两边同时变成新配置（这张卡片就没用了）。
  it('compares the search-start setup with the simulated best setup on the ability card', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const result = makeResult(store);
    // 用户当时有自定义配置 → 候选表里带「当前配置」锚点（生成器在配置非空时必然产出）。
    const currentTrigger = customTrigger(750);
    result.perAbilityChoices[0].candidates.unshift({
      ...result.perAbilityChoices[0].candidates[0],
      state: 'custom',
      triggers: [currentTrigger],
      signature: JSON.stringify([currentTrigger]),
      labelKey: 'common:triggerOptimizer.candidate.current',
      labelParams: {},
    });
    store.triggerOptimizer.results = result;
    await flushPromises();

    const original = wrapper.get('[data-trigger-optimizer-original]');
    const best = wrapper.get('[data-trigger-optimizer-best]');
    expect(original.text()).toContain('当前配置（搜索起点）');
    expect(original.text()).toContain('我的 当前HP <= 750');
    expect(best.text()).toContain('模拟最优配置');
    expect(best.text()).toContain('我的 当前HP <= 500');
    // 与对侧不同的条目带圆点（改动标记），两侧一致时不给标记。
    expect(original.findAll('[data-trigger-optimizer-line-changed="true"]')).toHaveLength(1);
    expect(best.findAll('[data-trigger-optimizer-line-changed="true"]')).toHaveLength(1);
    expect(best.text()).not.toContain('与当前配置相同');
    // 两侧**不同颜色**高亮（2026-09-22 用户要求）：左边冷色 info、右边主色 primary，
    // 且真的改了才给更亮的底（左侧竖条已按用户要求去掉，分档只靠底色）。
    expect(original.classes()).toContain('border-info/40');
    expect(best.classes()).toContain('border-primary/60');
    expect(best.classes()).toContain('bg-primary/20');

    // 两侧完全一致（一个槽都没被采纳）→ 明说「与当前配置相同」，不再让用户逐行比对。
    const unchanged = makeResult(store);
    unchanged.perAbilityChoices[0].candidates.unshift({
      ...unchanged.perAbilityChoices[0].candidates[0],
      state: 'custom',
      triggers: [currentTrigger],
      signature: JSON.stringify([currentTrigger]),
      labelKey: 'common:triggerOptimizer.candidate.current',
      labelParams: {},
    });
    unchanged.bestTriggerMap = { [ABILITY_HRID]: [currentTrigger] };
    unchanged.adoptedSlots = [];
    store.triggerOptimizer.results = unchanged;
    await flushPromises();

    const sameBest = wrapper.get('[data-trigger-optimizer-best]');
    expect(sameBest.text()).toContain('与当前配置相同');
    expect(sameBest.findAll('[data-trigger-optimizer-line-changed="true"]')).toHaveLength(0);
    // 没改成 → 高亮降档（不弱于左侧，但不发亮）：高亮「什么都没变」会把真正的改动淹没。
    expect(sameBest.classes()).toContain('border-primary/40');
    expect(sameBest.classes()).toContain('bg-primary/10');
    // 没被采纳就不该标候选标签（chosen 只是「槽内最优」，bestTriggerMap 仍是原配置）。
    expect(wrapper.find('[data-trigger-optimizer-best-label]').exists()).toBe(false);
    expect(wrapper.get('[data-trigger-optimizer-choice]').text()).toContain('保持当前配置');
  });

  // 候选表按分数降序（2026-09-22 用户要求）：读表的目的是「哪个候选更好」，
  // 报告里没有分数记录的候选垫底（`—` 不能与「0 分」混为一谈）。
  it('sorts the candidate table by score, highest first', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const result = makeResult(store);
    // 追加一个报告里没有分数记录的候选（生成后被截断/未评估）。
    const extra = customTrigger(123);
    result.perAbilityChoices[0].candidates.push({
      ...result.perAbilityChoices[0].candidates[2],
      triggers: [extra],
      signature: JSON.stringify([extra]),
      labelKey: 'common:triggerOptimizer.candidate.lowHp',
      labelParams: { percent: 40 },
    });
    store.triggerOptimizer.results = result;
    await flushPromises();
    await openDetails(wrapper, 1);

    // 报告顺序是 默认 −0.05 / 立即释放 0.1 / 本槽最优 0.42；渲染后必须倒过来，无分数的垫底。
    const scoreCells = wrapper
      .findAll('[data-trigger-optimizer-candidate]')
      .map((row) => row.findAll('td')[1].text().trim());
    expect(scoreCells).toEqual(['0.42', '0.1', '-0.05', '—']);
    // 表头旁标明口径，免得读者以为这是生成顺序。
    expect(wrapper.get('[data-trigger-optimizer-details-candidates]').text()).toContain('按得分降序');
  });

  // 详情入口（2026-09-22）：候选评估、指标明细、深挖与联合采纳记录收进弹窗，点击才渲染。
  it('opens a per-ability details dialog with the other simulation results and related data', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const result = makeResult(store);
    result.deepDives = [
      {
        slotIndex: 1,
        abilityHrid: ABILITY_HRID,
        rounds: 6,
        score: 0.024,
        mean: 0.024,
        stdError: 0.009,
        pValue: 0.08,
        verdict: 'inconclusive',
        adopted: true,
      },
    ];
    result.jointAdoptions = [
      {
        round: 1,
        slots: [1, 2],
        abilityHrids: [ABILITY_HRID, 'second'],
        rounds: 2,
        score: 0.014,
        mean: 0.014,
        stdError: 0.002,
        pValue: 0.01,
        verdict: 'positive',
        marginalMean: 0.006,
        adoptedSlots: [1],
      },
    ];
    store.triggerOptimizer.results = result;
    await flushPromises();

    // 未点击时弹窗内容不存在（结果列表保持轻量）；入口按钮在卡片页脚。
    expect(wrapper.find('[data-trigger-optimizer-details]').exists()).toBe(false);
    const entry = wrapper.get('[data-trigger-optimizer-details-open="1"]');
    expect(entry.text()).toContain('详情');
    expect(wrapper.get('[data-trigger-optimizer-choice]').text()).toContain('查看 3 个候选');

    await openDetails(wrapper, 1);
    const dialog = wrapper.get('[data-trigger-optimizer-details]');
    // 弹窗标题带技能名（BaseModal 的 title 由 stub 渲染在内容之外）。
    expect(wrapper.get('[role="dialog"] h2').text()).toContain('模拟详情');
    expect(wrapper.get('[role="dialog"] h2').text()).toContain('流水箭');
    expect(wrapper.get('[data-trigger-optimizer-details-slot]').text()).toContain('槽位 2');
    expect(wrapper.find('[data-trigger-optimizer-details-adopted]').exists()).toBe(true);
    // 配置对比（两侧完整渲染 + 与卡片同源的配色：左冷蓝 info、右主色 primary）。
    expect(wrapper.get('[data-trigger-optimizer-details-config="original"]').text()).toContain('游戏默认触发器');
    expect(wrapper.get('[data-trigger-optimizer-details-config="best"]').text()).toContain('我的 当前HP <= 500');
    expect(wrapper.get('[data-trigger-optimizer-details-config="original"]').classes()).toContain('border-info/40');
    expect(wrapper.get('[data-trigger-optimizer-details-config="best"]').classes()).toContain('border-primary/60');
    // 其它模拟结果：三个候选的得分与配对信号，本槽最优被标出。
    expect(dialog.findAll('[data-trigger-optimizer-candidate]')).toHaveLength(3);
    expect(dialog.findAll('[data-trigger-optimizer-candidate-winner="true"]')).toHaveLength(1);
    expect(wrapper.find('[data-trigger-optimizer-candidate-adopted]').exists()).toBe(true);
    // 相关数据：本槽采纳时的整体配置指标 vs 搜索起点基线。
    const metrics = wrapper.get('[data-trigger-optimizer-details-metrics]').text();
    expect(metrics).toContain('每秒伤害');
    expect(metrics).toContain('+10');
    // 深挖复核记录与跨槽联合采纳记录（只显示涉及本槽的那一条）。
    expect(wrapper.get('[data-trigger-optimizer-details-deep-dive]').text()).toContain('复核轮数');
    expect(wrapper.get('[data-trigger-optimizer-details-joint]').text()).toContain('槽位 2 + 槽位 3');

    // 未采纳的槽**不**渲染指标明细：那张表是「采纳时整体配置 vs 搜索起点」，未采纳时摆出来
    // 会把别的技能赚到的提升记在它头上（浏览器实测：火球槽没采纳，表里却写着 DPS +1.5%）。
    const notAdopted = makeResult(store);
    notAdopted.adoptedSlots = [];
    store.triggerOptimizer.results = notAdopted;
    await flushPromises();
    expect(wrapper.find('[data-trigger-optimizer-details]').exists()).toBe(true); // 弹窗跟着新报告
    expect(wrapper.find('[data-trigger-optimizer-details-metrics]').exists()).toBe(false);
    expect(wrapper.find('[data-trigger-optimizer-candidate]').exists()).toBe(true); // 候选结果仍在

    // 关闭后内容消失。
    await wrapper.get('[data-test-modal-close]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-trigger-optimizer-details]').exists()).toBe(false);
  });

  // 本槽净效应（2026-09-23）：报告里每条候选都带**逐指标**配对统计（computePairedStats 的
  // metrics），而 chosen 的配对参考系是「本槽搜索起点」——详情弹窗因此能给出本槽的净效应，
  // 与「基线 → 最优」的累计表并存（两张表回答两个不同的问题）。
  it('shows the per-metric net effect of the adopted slot, with direction-neutral significance', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const result = makeResult(store);
    result.perAbilityChoices[0].chosen.paired = {
      rounds: 2,
      score: { rounds: 2, mean: 0.02, stdError: 0.005, t: 4, dof: 1, pValue: 0.1, verdict: 'inconclusive' },
      metrics: {
        // 两行都「显著」但方向相反：dps 上升（positive，好）、死亡下降（negative，也好）。
        // 显著性列必须方向中立，否则死亡下降会被渲染成「显著更差」（死亡越低越好）。
        dps: { rounds: 2, mean: 1.5, stdError: 0.4, t: 3.75, dof: 1, pValue: 0.16, verdict: 'positive' },
        // rounds < 2 的报告给 stdError: null：必须写「± —」，不能画出一个不存在的「± 0」。
        dailyNoRngProfit: { rounds: 1, mean: 1200, stdError: null, t: null, dof: 0, pValue: null, verdict: 'unknown' },
        xpPerHour: { rounds: 2, mean: 40, stdError: 30, t: 1.3, dof: 1, pValue: 0.4, verdict: 'inconclusive' },
        killsPerHour: { rounds: 2, mean: 0, stdError: 0, t: 0, dof: 1, pValue: 1, verdict: 'inconclusive' },
        deathsPerHour: { rounds: 2, mean: -0.4, stdError: 0.1, t: -4, dof: 1, pValue: 0.16, verdict: 'negative' },
      },
    };
    store.triggerOptimizer.results = result;
    await flushPromises();
    await openDetails(wrapper, 1);

    const net = wrapper.get('[data-trigger-optimizer-details-net-metrics]');
    expect(net.text()).toContain('本槽净效应');
    // 配对差 ± 标准误：dps 一位小数、利润走 compact k/m 口径。
    const dpsRow = wrapper.get('[data-trigger-optimizer-net-metric="dps"]');
    expect(dpsRow.text()).toContain('+1.5 ± +0.4');
    expect(dpsRow.text()).toContain('显著');
    const profitRow = wrapper.get('[data-trigger-optimizer-net-metric="dailyNoRngProfit"]');
    expect(profitRow.text()).toContain('+1.2k ± —');
    expect(profitRow.text()).toContain('样本不足');
    // 方向中立：死亡下降（verdict = negative）显示「显著」，且整块不得出现「更差」。
    const deathsRow = wrapper.get('[data-trigger-optimizer-net-metric="deathsPerHour"]');
    expect(deathsRow.text()).toContain('-0.4');
    expect(deathsRow.text()).toContain('显著');
    expect(net.text()).not.toContain('更差');
    expect(wrapper.get('[data-trigger-optimizer-net-metric="xpPerHour"]').text()).toContain('不显著');
    // 累计表仍在（两张表并存，不是替换）。
    expect(wrapper.get('[data-trigger-optimizer-details-metrics]').text()).toContain('每秒伤害');

    // 未采纳的槽不渲染净效应表（与累计表同一判据：未采纳的槽没有「本槽改动」）。
    const notAdopted = makeResult(store);
    notAdopted.adoptedSlots = [];
    store.triggerOptimizer.results = notAdopted;
    await flushPromises();
    expect(wrapper.find('[data-trigger-optimizer-details-net-metrics]').exists()).toBe(false);

    // 报告缺逐指标配对统计时不渲染这一块（旧报告 / 异常收尾），但累计表照旧。
    store.triggerOptimizer.results = makeResult(store);
    await flushPromises();
    expect(wrapper.find('[data-trigger-optimizer-details-net-metrics]').exists()).toBe(false);
    expect(wrapper.find('[data-trigger-optimizer-details-metrics]').exists()).toBe(true);
  });

  // 复验结论行缺 verdict（旧报告 / 异常收尾）时必须与结论卡 headline 同口径兜底到「样本不足」：
  // 直接插值 `verdicts.${verification.verdict}` 会把 `common:triggerOptimizer.verdicts.undefined`
  // 原始键渲染上屏，与同卡的「样本不足，结论待定」自相矛盾（2026-09-24 语义精度审计）。
  it('falls back to the unknown verdict text when the verification record lacks a verdict', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const result = makeResult(store);
    result.verification = { ...result.verification };
    delete result.verification.verdict;
    store.triggerOptimizer.results = result;
    await flushPromises();

    const verificationText = wrapper.get('[data-trigger-optimizer-verification]').text();
    expect(verificationText).toContain('样本不足');
    expect(verificationText).not.toContain('triggerOptimizer.verdicts');
    // 与同卡 headline（verdictKind 的 unknown 兜底）一致，不出现两套说法。
    expect(wrapper.get('[data-trigger-optimizer-verdict]').text()).toContain('样本不足');
  });

  // 收尾相位回填（2026-09-24，设计 §37.3 观察项① 方案 A）：运行结束（含刷新重进，runtime.phase 回
  // idle）后，进度区阶段行必须按报告收尾状态显示「搜索已完成 / 搜索已停止 / 搜索异常中断」，不能一边
  // 显示「未开始」一边给出报告真实计数。三态复用 phases.done/cancelled/error，i18n 零新增键。
  it('backfills the finish-state phase from the report when the run is over', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.triggerOptimizer.results = makeResult(store);
    await flushPromises();

    // 正常收尾：报告存在而 runtime.phase 已回 idle —— 不能再显示「未开始」。
    const phase = wrapper.get('[data-trigger-optimizer-phase]');
    expect(phase.text()).toContain('搜索已完成');
    expect(phase.text()).not.toContain('未开始');

    // 用户中途停止：报告显示 cancelled → 「搜索已停止」。
    store.triggerOptimizer.results = makeResult(store, { cancelled: true });
    await flushPromises();
    expect(wrapper.get('[data-trigger-optimizer-phase]').text()).toContain('搜索已停止');

    // 异常中断：error 非空 → 「搜索异常中断」。
    store.triggerOptimizer.results = makeResult(store, { error: 'boom' });
    await flushPromises();
    expect(wrapper.get('[data-trigger-optimizer-phase]').text()).toContain('搜索异常中断');
  });

  // 候选截断透明化（2026-09-23，设计 §28）：候选表被「每槽候选上限」截断时必须说出来，
  // 否则「3 个候选」会被读成「搜索试遍了所有可能」（截断是静默丢候选，§22.3/§23.4 实测过）。
  it('discloses the candidates cut off by the per-slot candidate limit', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.triggerOptimizer.results = makeResult(store);
    await flushPromises();
    await openDetails(wrapper, 1);

    const note = wrapper.get('[data-trigger-optimizer-candidates-truncated]');
    expect(note.text()).toContain('另有 3 条候选');
    expect(note.text()).toContain('每槽候选上限（3）');

    // 候选表完整（截断数 0）时不显示这一行——不为「没截断」也加一条噪声。
    const roomy = makeResult(store);
    roomy.perAbilityChoices[0].truncatedCandidates = 0;
    roomy.perAbilityChoices[0].generatedCandidates = 3;
    store.triggerOptimizer.results = roomy;
    await flushPromises();
    expect(wrapper.find('[data-trigger-optimizer-details-candidates]').exists()).toBe(true);
    expect(wrapper.find('[data-trigger-optimizer-candidates-truncated]').exists()).toBe(false);

    // 旧报告（没有这两个字段）同样不显示，不抛错。
    const legacy = makeResult(store);
    delete legacy.perAbilityChoices[0].truncatedCandidates;
    delete legacy.perAbilityChoices[0].candidateLimit;
    store.triggerOptimizer.results = legacy;
    await flushPromises();
    expect(wrapper.find('[data-trigger-optimizer-candidates-truncated]').exists()).toBe(false);
  });

  // 结论适用范围 + 换难度复核（2026-09-23，设计 §29）：触发器写的是全局技能配置，而搜索只在
  // 单一区域 + 单一难度上评估过 —— 结果区要写明这份结论的边界，并给出「换个难度再测一次」的入口。
  it('marks the scope of the conclusion and renders every re-check state', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const scopeOfFly = {
      zoneHrid: '/actions/combat/fly',
      useDungeon: false,
      difficultyTier: 0,
      simulationHours: 24,
    };
    const scoped = makeResult(store);
    scoped.evaluationScope = scopeOfFly;
    // 搜索起点配置（复核的对照侧）：本功能之前的报告没有它 → 按钮禁用并说明原因。
    scoped.baselineTriggerMap = { [ABILITY_HRID]: [customTrigger(300)] };
    store.triggerOptimizer.results = scoped;
    await flushPromises();

    // ① 可复核：适用范围 + 目标难度的按钮 + 「怎么读」的说明（跑之前不给结果块）。
    const scope = wrapper.get('[data-trigger-optimizer-scope]');
    const scopeText = scope.get('[data-trigger-optimizer-scope-text]').text();
    expect(scopeText).toContain('难度 0');
    expect(scopeText).toContain('24 小时');
    expect(scopeText).toContain('全局技能配置');
    const runButton = scope.get('[data-trigger-optimizer-robustness-run]');
    expect(runButton.text()).toContain('难度 1');
    expect(runButton.attributes('disabled')).toBeUndefined();
    expect(scope.get('[data-trigger-optimizer-robustness-note]').text()).toContain('另一组随机种子');
    // 轮数自适应（2026-09-25，设计 §49）：说明旁多一句「这次要跑几轮」的明细。报告的复验统计是
    // 0.05 / SE 0.01（6 轮）⇒ 反解要 4 轮 → 保底 6 轮 = 计划 6 轮/侧（12 场，与旧行为同量级）。
    const planLine = scope.get('[data-trigger-optimizer-robustness-plan]').text();
    expect(planLine).toContain('6 轮/侧');
    expect(planLine).toContain('12 场');
    expect(scope.find('[data-trigger-optimizer-robustness-result]').exists()).toBe(false);

    // ② 复核进行中：按钮换成「停止复核」、显示在跑什么；此时整页进入忙态（主按钮也禁用）。
    store.triggerOptimizer.runtime.robustness.isRunning = true;
    store.triggerOptimizer.runtime.robustness.difficultyTier = 1;
    store.triggerOptimizer.runtime.robustness.elapsedSeconds = 3.5;
    await flushPromises();
    expect(scope.find('[data-trigger-optimizer-robustness-run]').exists()).toBe(false);
    expect(scope.get('[data-trigger-optimizer-robustness-stop]').text()).toContain('停止复核');
    const progressText = scope.get('[data-trigger-optimizer-robustness-progress]').text();
    expect(progressText).toContain('难度 1');
    expect(progressText).toContain('12 场模拟');
    expect(wrapper.get('[data-trigger-optimizer-start]').attributes('disabled')).toBeDefined();

    // ②-b 收尾窗口（2026-09-23 实测的卡死点）：stop 把 isRunning 置 false 之后、服务层清理
    // 完成之前，页面必须仍然算「忙」；serviceRunInFlight 一清空就立刻恢复可用 —— 它同时是
    // 「模块级运行标志（非响应式）」的响应式锚点，缺了它计算属性会永久缓存 busy=true。
    store.triggerOptimizer.runtime.robustness.isRunning = false;
    store.triggerOptimizer.runtime.serviceRunInFlight = true;
    await flushPromises();
    expect(wrapper.get('[data-trigger-optimizer-start]').attributes('disabled')).toBeDefined();
    store.triggerOptimizer.runtime.serviceRunInFlight = false;
    await flushPromises();
    expect(wrapper.get('[data-trigger-optimizer-start]').attributes('disabled')).toBeUndefined();

    // ③ 结果：Δ 得分 / Δ 日利润 / p / 结论 四项同屏，配色与判定/符号同源。
    store.triggerOptimizer.runtime.robustness.isRunning = false;
    store.triggerOptimizer.results.robustness = {
      difficultyTier: 1,
      rounds: 6,
      verdict: 'positive',
      scoreDelta: 0.031,
      profitDelta: 12345,
      paired: { rounds: 6, score: { mean: 0.031, stdError: 0.004, pValue: 0.0021, verdict: 'positive' } },
      createdAt: Date.now(),
    };
    await flushPromises();
    const result = scope.get('[data-trigger-optimizer-robustness-result]');
    expect(result.text()).toContain('难度 1');
    expect(result.get('[data-trigger-optimizer-robustness-score]').text()).toContain('+0.031');
    expect(result.get('[data-trigger-optimizer-robustness-score]').classes()).toContain('text-success');
    expect(result.text()).toContain('+12.3k');
    expect(result.text()).toContain('0.002');
    const verdict = result.get('[data-trigger-optimizer-robustness-verdict]');
    expect(verdict.text()).toContain('在该难度上提升成立');
    expect(verdict.classes()).toContain('text-success');
    // 有结果就不再显示「怎么读」的说明（两个状态互斥，避免同屏两套说法）。
    expect(scope.find('[data-trigger-optimizer-robustness-note]').exists()).toBe(false);
    // 这个结果没有计划快照（§49 之前跑的报告）：不显示计划明细行 —— 没有依据就不提轮数/护栏。
    expect(scope.find('[data-trigger-optimizer-robustness-plan-detail]').exists()).toBe(false);

    // ④ 旧报告（没有搜索起点配置）：按钮禁用 + 说清为什么，而不是点了什么都不发生。
    const legacy = makeResult(store);
    legacy.evaluationScope = scopeOfFly;
    store.triggerOptimizer.results = legacy;
    await flushPromises();
    const legacyScope = wrapper.get('[data-trigger-optimizer-scope]');
    expect(legacyScope.get('[data-trigger-optimizer-robustness-run]').attributes('disabled')).toBeDefined();
    expect(legacyScope.get('[data-trigger-optimizer-robustness-note]').text()).toContain('旧版本');

    // ⑤ 目标合法难度区间查不到（两头都越界）：同样禁用 + 说明「没有相邻难度」。
    const unreachable = makeResult(store);
    unreachable.evaluationScope = { ...scopeOfFly, zoneHrid: '/actions/combat/not_a_real_zone' };
    unreachable.baselineTriggerMap = {};
    store.triggerOptimizer.results = unreachable;
    await flushPromises();
    expect(wrapper.get('[data-trigger-optimizer-robustness-note]').text()).toContain('没有可复核的相邻难度');

    // ⑥ 没有适用范围字段的旧报告：整块不渲染（不猜口径，也不给一个「不知道在测什么」的按钮）。
    store.triggerOptimizer.results = makeResult(store);
    await flushPromises();
    expect(wrapper.find('[data-trigger-optimizer-scope]').exists()).toBe(false);
  });

  // 复核轮数自适应的三态上屏 + 导出留档（2026-09-25，设计 §49）：轮数不再是常量 —— 反解（正常，
  // 见上一条用例）/ 已达上限 / 成本护栏三种情况都要说得清；导出必须带上同一句，因为界面上的计划行
  // 会被下一次渲染顶掉（事后复盘只有导出能查）。
  it('surfaces the robustness plan and its limits on screen and in the export', async () => {
    downloadTriggerOptimizerReportXlsx.mockClear();
    const { wrapper, store } = await mountPage(readySetup);
    const report = makeResult(store);
    report.evaluationScope = {
      zoneHrid: '/actions/combat/fly',
      useDungeon: false,
      difficultyTier: 0,
      simulationHours: 24,
    };
    report.baselineTriggerMap = { [ABILITY_HRID]: [customTrigger(300)] };
    // 复验统计 0.025 / SE 0.02（6 轮）：6 轮判不出来、连上限 16 轮也判不出来 ⇒ 反解 capped，
    // A′ 口径「上限也不够就补到上限」（不是不花样本）。
    report.verification = {
      ...report.verification,
      paired: { rounds: 6, score: { rounds: 6, mean: 0.025, stdError: 0.02, verdict: 'inconclusive' } },
    };
    report.simulations = 500;
    store.triggerOptimizer.results = report;
    await flushPromises();

    const scope = wrapper.get('[data-trigger-optimizer-scope]');
    const capped = scope.get('[data-trigger-optimizer-robustness-plan]').text();
    expect(capped).toContain('16 轮/侧');
    expect(capped).toContain('超过复核上限');

    // 成本护栏咬住：整轮 20 场 × 20% = 4 场预算 < 2 ×(16 − 6) ⇒ 只补 2 轮（8 轮/侧）。
    // 注意要经 store 重新赋值（不是改手里那个原始对象）：页面读的是 store 的响应式副本。
    store.triggerOptimizer.results = { ...report, simulations: 20 };
    await flushPromises();
    const guarded = scope.get('[data-trigger-optimizer-robustness-plan]').text();
    expect(guarded).toContain('8 轮/侧');
    expect(guarded).toContain('成本护栏');
    expect(guarded).toContain('16 场');

    // 复核结果块的事后留档：实际执行的那份计划（服务层净化后写进 result.plan）。
    store.triggerOptimizer.results.robustness = {
      difficultyTier: 1,
      rounds: 8,
      verdict: 'inconclusive',
      scoreDelta: 0.012,
      profitDelta: 100,
      paired: { rounds: 8, score: { mean: 0.012, stdError: 0.009, pValue: 0.2, verdict: 'inconclusive' } },
      plan: {
        capped: true,
        budgetLimited: true,
        currentRounds: 6,
        requiredRounds: null,
        capRounds: 16,
        plannedRounds: 8,
        plannedSimulations: 16,
        budgetSimulations: 4,
      },
      createdAt: Date.now(),
    };
    await flushPromises();
    const detail = scope.get('[data-trigger-optimizer-robustness-plan-detail]').text();
    expect(detail).toContain('8 轮/侧');
    expect(detail).toContain('成本护栏');

    // 导出：结论 + 同一句计划明细（轮数/上限/护栏）一起进汇总表。
    await wrapper.get('[data-trigger-optimizer-export]').trigger('click');
    await flushPromises();
    const rows = downloadTriggerOptimizerReportXlsx.mock.calls[0][0].summaryRows;
    const row = rows.find((entry) => entry.item === '换难度复核（难度 1）');
    expect(row).toBeTruthy();
    expect(row.value).toContain('在该难度上未达显著');
    expect(row.value).toContain('8 轮/侧');

    // 旧报告（没有计划快照）：只留结论，不提轮数上限/护栏 —— 没有依据就不说。
    store.triggerOptimizer.results.robustness = {
      difficultyTier: 1,
      rounds: 6,
      verdict: 'positive',
      scoreDelta: 0.031,
      profitDelta: 12345,
      paired: { rounds: 6, score: { mean: 0.031, stdError: 0.004, pValue: 0.0021, verdict: 'positive' } },
      createdAt: Date.now(),
    };
    await flushPromises();
    expect(scope.find('[data-trigger-optimizer-robustness-plan-detail]').exists()).toBe(false);
    await wrapper.get('[data-trigger-optimizer-export]').trigger('click');
    await flushPromises();
    const legacyRows = downloadTriggerOptimizerReportXlsx.mock.calls.at(-1)[0].summaryRows;
    const legacyRow = legacyRows.find((entry) => entry.item === '换难度复核（难度 1）');
    expect(legacyRow.value).toBe('在该难度上提升成立');
  });

  // 复核追加（2026-09-26，设计 §51）：已复核过的报告再点复核 = 换盐追加（新样本与首跑样本
  // 合并重检），不再是同盐复跑。界面上：首跑按钮消失、改挂「追加复核」入口 + 「补几轮」的提示；
  // 零差 / 已达上限 / 预算用尽三种「一轮都追加不了」的情形不挂按钮、只挂原因句（按钮凭空消失
  // 会被读成功能坏了）；追加过的报告多一行「已复核 N 次 · 合并 M 轮」的留档，导出把同一件事
  // （汇总行 + 每次追加一行明细）带走 —— 界面上的句子会被下一次渲染顶掉，事后复盘只有导出能查。
  it('renders the re-check append entry and its block reasons, and archives every attempt in the export', async () => {
    downloadTriggerOptimizerReportXlsx.mockClear();
    const { wrapper, store } = await mountPage(readySetup);
    const report = makeResult(store);
    report.evaluationScope = {
      zoneHrid: '/actions/combat/fly',
      useDungeon: false,
      difficultyTier: 0,
      simulationHours: 24,
    };
    report.baselineTriggerMap = { [ABILITY_HRID]: [customTrigger(300)] };
    report.simulations = 84;
    store.triggerOptimizer.results = report;
    await flushPromises();

    const scope = wrapper.get('[data-trigger-optimizer-scope]');
    // 还没复核：只有首跑入口，没有追加相关的行。
    expect(scope.find('[data-trigger-optimizer-robustness-run]').exists()).toBe(true);
    expect(scope.find('[data-trigger-optimizer-robustness-append]').exists()).toBe(false);

    // 首跑复核结论（6 轮、未达显著）：计划据此算「补 10 轮到上限 16」，单次预算 16 场先咬住
    // ⇒ 实际补 8 轮（16 场）。
    store.triggerOptimizer.results.robustness = {
      difficultyTier: 1,
      rounds: 6,
      verdict: 'inconclusive',
      scoreDelta: 0.012,
      profitDelta: 100,
      paired: { rounds: 6, score: { rounds: 6, mean: 0.012, stdError: 0.009, pValue: 0.2, verdict: 'inconclusive' } },
      createdAt: Date.now(),
    };
    await flushPromises();
    // 已有结论 ⇒ 首跑入口消失（再点不会用同盐复跑覆盖旧结论）。
    expect(scope.find('[data-trigger-optimizer-robustness-run]').exists()).toBe(false);
    const hint = scope.get('[data-trigger-optimizer-robustness-append-hint]').text();
    expect(hint).toContain('8 轮/侧');
    expect(hint).toContain('16 场');
    expect(hint).toContain('上限 16 轮');
    // 累计预算进度（§53）：与复验追加同款子句 —— 点完这一下之后累计 0 + 16 场 / 预算 33 场。
    expect(hint).toContain('累计追加 16 / 33 场（含本次）');
    expect(scope.get('[data-trigger-optimizer-robustness-append]').text()).toContain('追加复核');
    expect(scope.find('[data-trigger-optimizer-robustness-append-blocked]').exists()).toBe(false);
    expect(scope.find('[data-trigger-optimizer-robustness-append-merged]').exists()).toBe(false);

    // 零差出口：目标难度的逐轮差恒 0 ⇒ 不挂按钮，只挂原因句。
    store.triggerOptimizer.results.robustness = {
      ...store.triggerOptimizer.results.robustness,
      paired: { rounds: 6, score: { rounds: 6, mean: 0, stdError: 0, pValue: 1, verdict: 'inconclusive' } },
    };
    await flushPromises();
    expect(scope.get('[data-trigger-optimizer-robustness-append-blocked]').text()).toContain('判不出结论');
    expect(scope.find('[data-trigger-optimizer-robustness-append]').exists()).toBe(false);
    expect(scope.find('[data-trigger-optimizer-robustness-append-hint]').exists()).toBe(false);

    // 已达上限（复核上限是**总量**上限）：16 轮 ⇒ 同样不挂按钮。
    store.triggerOptimizer.results.robustness = {
      difficultyTier: 1,
      rounds: 16,
      verdict: 'inconclusive',
      scoreDelta: 0.01,
      profitDelta: 50,
      paired: { rounds: 16, score: { rounds: 16, mean: 0.01, stdError: 0.008, pValue: 0.3, verdict: 'inconclusive' } },
      createdAt: Date.now(),
    };
    await flushPromises();
    expect(scope.get('[data-trigger-optimizer-robustness-append-blocked]').text()).toContain('已达复核上限');
    expect(scope.find('[data-trigger-optimizer-robustness-append]').exists()).toBe(false);

    // 追加过的报告：合并留档行 + 追加入口都还在（8 轮 < 上限 16 ⇒ 还能再补 8 轮）。
    store.triggerOptimizer.results.robustness = {
      difficultyTier: 1,
      rounds: 8,
      verdict: 'positive',
      scoreDelta: 0.03,
      profitDelta: 4321,
      paired: { rounds: 8, score: { rounds: 8, mean: 0.03, stdError: 0.008, pValue: 0.004, verdict: 'positive' } },
      attempts: [
        {
          attempt: 1,
          rounds: 2,
          mergedRounds: 8,
          mergedVerdict: 'positive',
          plan: {
            capped: true,
            budgetLimited: false,
            limitedBy: null,
            currentRounds: 6,
            requiredRounds: null,
            capRounds: 16,
            plannedRounds: 2,
            plannedSimulations: 4,
            budgetSimulations: 16,
            zeroDiff: false,
            atCap: false,
            spentSimulations: 0,
            cumulativeBudgetSimulations: 33,
          },
        },
      ],
      createdAt: Date.now(),
    };
    await flushPromises();
    const merged = scope.get('[data-trigger-optimizer-robustness-append-merged]').text();
    expect(merged).toContain('已复核 1 次');
    expect(merged).toContain('合并 8 轮');
    expect(merged).toContain('累计追加 4 场');
    expect(scope.get('[data-trigger-optimizer-robustness-append-hint]').text()).toContain('8 轮/侧');
    // 累计预算进度（§53）：已花 4 场 + 本次 16 场 = 20 / 预算 33 场。
    expect(scope.get('[data-trigger-optimizer-robustness-append-hint]').text()).toContain(
      '累计追加 20 / 33 场（含本次）',
    );
    expect(scope.find('[data-trigger-optimizer-robustness-append]').exists()).toBe(true);

    // 导出：汇总行（与界面逐字同款）+ 每次追加一行明细（轮数 / 累计 / 护栏有没有咬住）。
    await wrapper.get('[data-trigger-optimizer-export]').trigger('click');
    await flushPromises();
    const rows = downloadTriggerOptimizerReportXlsx.mock.calls.at(-1)[0].summaryRows;
    const mergedRow = rows.find((entry) => entry.item === '追加复核');
    expect(mergedRow.value).toContain('已复核 1 次');
    expect(mergedRow.value).toContain('合并 8 轮');
    const attemptRow = rows.find((entry) => entry.item === '追加复核 1');
    expect(attemptRow).toBeTruthy();
    expect(attemptRow.value).toContain('追加 2 轮/侧');
    expect(attemptRow.value).toContain('累计 8 轮');
  });

  // 结果说明弹窗（2026-09-22）：复验口径 / 得分尺度 / 指标口径 / 应用范围这些解释性长段落
  // 不再平铺在结果区（一屏四五段，用户一般不会读），点「查看说明」才展开；页面主体只剩
  // 结论、数字与逐技能卡片。条目按「本次报告是否适用」组装，不适用就不出现（不留空条目）。
  it('keeps the explanatory paragraphs out of the page and inside a result-notes dialog', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.triggerOptimizer.results = makeResult(store);
    await flushPromises();

    // 入口在结果区标题旁；未点开时弹窗内容不存在。
    const entry = wrapper.get('[data-trigger-optimizer-notes-open]');
    expect(entry.text()).toContain('查看说明');
    expect(wrapper.find('[data-trigger-optimizer-notes="result"]').exists()).toBe(false);

    // 页面主体（结果区）里不再有这些长段落 —— 这正是本轮改版的目的。
    const results = wrapper.get('[data-trigger-optimizer-results]');
    expect(results.text()).not.toContain('得分尺度 −1 至 +1');
    expect(results.text()).not.toContain('应用仅覆盖参与优化的技能触发器');

    await openNotes(wrapper);
    const dialog = notesDialog(wrapper, 'result');
    // 常驻四条：复验口径、得分尺度、指标口径、应用范围。
    expect(dialog.findAll('[data-trigger-optimizer-note]')).toHaveLength(4);
    expect(noteEntry(wrapper, 'verification').text()).toContain('另一组随机种子');
    expect(noteEntry(wrapper, 'scoreScale').text()).toContain('得分尺度 −1 至 +1');
    expect(noteEntry(wrapper, 'metricSource').text()).toContain('复验实测');
    expect(noteEntry(wrapper, 'applyScope').text()).toContain('食物与饮品不受影响');
    // 本次报告没有深挖 / 联合采纳，也估不出噪声地板与显著门槛（improvement.paired 无标准误）→ 四条之外不给空条目。
    expect(wrapper.find('[data-trigger-optimizer-note="deepDive"]').exists()).toBe(false);
    expect(wrapper.find('[data-trigger-optimizer-note="jointAdoption"]').exists()).toBe(false);
    expect(wrapper.find('[data-trigger-optimizer-note="detectionFloor"]').exists()).toBe(false);
    expect(wrapper.find('[data-trigger-optimizer-note="roundLimit"]').exists()).toBe(false);
    // 证据预算（2026-09-26，设计 §53）：没花过、也没停在出口 ⇒ 同样不出现（不留空条目）。
    expect(wrapper.find('[data-trigger-optimizer-note="evidenceBudget"]').exists()).toBe(false);

    await closeNotes(wrapper);
    expect(wrapper.find('[data-trigger-optimizer-notes="result"]').exists()).toBe(false);
  });

  // 模拟载荷（2026-09-27，设计 §59）：勾选参与整队模拟的队友（除主角外的已保存玩家），
  // 集合写进设置（进输入指纹）。
  it('lists the other players as party teammates and writes the selection into settings', async () => {
    const { wrapper, store } = await mountPage(readySetup);

    const party = wrapper.get('[data-trigger-optimizer-party]');
    // 玩家 2..5（默认玩家表 1..5，主角 1 不在候选里）。
    expect(party.findAll('[data-trigger-optimizer-party-player]')).toHaveLength(4);
    expect(party.text()).toContain('模拟载荷');

    await party.get('[data-trigger-optimizer-party-player="2"] input').setValue(true);
    await flushPromises();
    expect(store.triggerOptimizer.settings.partyPlayerIds).toEqual(['2']);

    await wrapper.get('[data-trigger-optimizer-party-player="2"] input').setValue(false);
    await flushPromises();
    expect(store.triggerOptimizer.settings.partyPlayerIds).toEqual([]);
  });

  // 报告自证载荷（2026-09-27，设计 §59）：结论是在单人还是整队（哪些队友）上得出的写进适用范围块。
  it('labels the simulation loadout (solo vs party) in the scope block', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const scopeOf = (party) => ({
      zoneHrid: '/actions/combat/fly',
      useDungeon: false,
      difficultyTier: 0,
      simulationHours: 24,
      party,
    });

    store.triggerOptimizer.results = makeResult(store, { evaluationScope: scopeOf([]) });
    await flushPromises();
    expect(wrapper.get('[data-trigger-optimizer-scope-party]').text()).toContain('单人');
    // 保守提示只针对队伍载荷（§60 / C1-①）：单人载荷不挂。
    expect(wrapper.find('[data-trigger-optimizer-scope-party-detection]').exists()).toBe(false);

    // 有队友：显示队伍 + 队友名（名字优先按**当前玩家表**解析 ⇒ 改名后显示现名）；同时挂出保守
    // 提示（真检出率实测 93.2% → 64.6%）——这是提示，不改任何判据 / 数值。
    store.triggerOptimizer.results = makeResult(store, { evaluationScope: scopeOf([{ id: '2', name: 'Mate' }]) });
    await flushPromises();
    expect(wrapper.get('[data-trigger-optimizer-scope-party]').text()).toContain('队伍 Player 2');
    const detection = wrapper.get('[data-trigger-optimizer-scope-party-detection]');
    expect(detection.text()).toContain('93.2%');
    expect(detection.text()).toContain('64.6%');

    // 玩家表里已经没有这个 id（队友被删）⇒ 回落到报告里的快照名（历史报告自证当时的载荷）。
    store.triggerOptimizer.results = makeResult(store, { evaluationScope: scopeOf([{ id: '9', name: 'Ghost' }]) });
    await flushPromises();
    expect(wrapper.get('[data-trigger-optimizer-scope-party]').text()).toContain('Ghost');
  });

  // 搜索设置卡片（2026-09-22）：原来分开的「锁定不优化」与「搜索设置」合成一张卡片 —— 两处调的
  // 是同一件事（这一轮搜什么）；卡片下面原本平铺的 8 段解释收进「参数说明」弹窗，页面只留控件。
  it('merges the lock and settings controls, and moves their paragraphs into a notes dialog', async () => {
    const { wrapper } = await mountPage(readySetup);

    // 同一张卡片里既有锁定行、也有参数控件。
    const card = wrapper.get('[data-trigger-optimizer-settings-card]');
    expect(card.find('[data-trigger-optimizer-locks]').exists()).toBe(true);
    expect(card.find('[data-trigger-optimizer-lock]').exists()).toBe(true);
    expect(card.find('[data-trigger-optimizer-preset]').exists()).toBe(true);
    expect(card.find('[data-trigger-optimizer-rounds]').exists()).toBe(true);
    expect(card.find('[data-trigger-optimizer-advanced]').exists()).toBe(true);
    // 说明文案不再平铺在卡片里（锁定 / 档位 / 重复次数 / 权重 / 搜索过程 / 时长 / 范围 / 配对 全部搬走）。
    expect(card.text()).not.toContain('锁定的技能不参与搜索');
    expect(card.text()).not.toContain('公共随机数');
    expect(card.text()).not.toContain('死亡安全权重自动计算');
    expect(card.text()).not.toContain('食物与饮品请使用食物优化器');

    expect(wrapper.find('[data-trigger-optimizer-notes="settings"]').exists()).toBe(false);
    await openSettingsNotes(wrapper);
    const dialog = notesDialog(wrapper, 'settings');
    expect(dialog.findAll('[data-trigger-optimizer-note]')).toHaveLength(8);
    expect(noteEntry(wrapper, 'lock').text()).toContain('锁定的技能不参与搜索');
    expect(noteEntry(wrapper, 'preset').text()).toContain('当前「标准」');
    expect(noteEntry(wrapper, 'rounds').text()).toContain('公共随机数');
    expect(noteEntry(wrapper, 'weights').text()).toContain('死亡安全权重自动计算');
    expect(noteEntry(wrapper, 'searchLoop').text()).toContain('提前结束');
    expect(noteEntry(wrapper, 'hours').text()).toContain('相互独立');
    expect(noteEntry(wrapper, 'scope').text()).toContain('食物与饮品请使用食物优化器');
    expect(noteEntry(wrapper, 'pairing').text()).toContain('配对差');
    // 标题与结果说明区分开（两份弹窗共用组件）。
    expect(wrapper.get('[role="dialog"] h2').text()).toContain('搜索设置说明');

    // 档位一改，弹窗里的那条跟着变（它是「这个档位意味着什么」的即时反馈）。
    await closeNotes(wrapper);
    await wrapper.get('[data-trigger-optimizer-preset]').setValue('fine');
    await flushPromises();
    await openSettingsNotes(wrapper);
    expect(noteEntry(wrapper, 'preset').text()).toContain('当前「精细」');

    await closeNotes(wrapper);
    expect(wrapper.find('[data-trigger-optimizer-notes="settings"]').exists()).toBe(false);
  });

  it('labels the applied result and disables applying again', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.triggerOptimizer.results = makeResult(store);
    await flushPromises();

    store.triggerOptimizer.results.appliedInputSignature = store.triggerOptimizerInputSignature;
    await flushPromises();
    const apply = wrapper.get('[data-trigger-optimizer-apply]');
    expect(apply.text()).toContain('已应用');
    expect(apply.element.disabled).toBe(true);
  });

  it('reverts applied changes and explains the revert', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.triggerOptimizer.results = makeResult(store);
    await flushPromises();
    expect(wrapper.find('[data-trigger-optimizer-revert]').exists()).toBe(false);

    store.triggerOptimizer.baselineSnapshot = { playerId: '1', triggerMap: {} };
    await flushPromises();
    const revert = wrapper.get('[data-trigger-optimizer-revert]');
    expect(revert.element.disabled).toBe(false);
    vi.spyOn(store, 'revertTriggerOptimizerChanges').mockReturnValue(true);
    await revert.trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-trigger-optimizer-action-note]').text()).toContain('已撤销');
  });

  it('blocks applying once the result is stale and says why', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.triggerOptimizer.results = makeResult(store);
    await flushPromises();

    store.triggerOptimizer.results.stale = true;
    await flushPromises();
    expect(wrapper.get('[data-trigger-optimizer-apply]').element.disabled).toBe(true);
    expect(wrapper.text()).toContain('结果已过期');
  });

  it('keeps the current setup when nothing improves', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const result = makeResult(store);
    result.improvement = { ...result.improvement, score: 0, scoreDelta: 0, improved: false };
    store.triggerOptimizer.results = result;
    await flushPromises();

    // 「没有更优配置」的说明在「查看说明」弹窗里（2026-09-22），结论卡只留结论。
    await openNotes(wrapper);
    expect(noteEntry(wrapper, 'verification').text()).toContain('保持现有配置');
    expect(wrapper.get('[data-trigger-optimizer-apply]').element.disabled).toBe(true);
  });

  it('clarifies that an empty trigger list casts immediately instead of disabling', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.triggerOptimizer.results = makeResult(store);
    await flushPromises();

    const hint = wrapper.get('[data-trigger-optimizer-disabled-hint]');
    expect(hint.text()).toContain('并非禁用');
    // 「立即释放」是候选标签，随候选表一起收在详情弹窗里。
    await openDetails(wrapper, 1);
    expect(wrapper.text()).toContain('立即释放（冷却好了就放）');
  });

  it('applies a search strength preset to the three knobs at once', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const preset = wrapper.get('[data-trigger-optimizer-preset]');
    // 默认设置 = 「标准」档：新增下拉不改变既有默认行为。
    expect(preset.element.value).toBe('standard');

    await preset.setValue('fine');

    expect(store.triggerOptimizer.settings.candidateLimit).toBe(TRIGGER_OPTIMIZER_MAX_CANDIDATE_LIMIT);
    expect(store.triggerOptimizer.settings.maxRounds).toBe(3);
    // 精细档在 24h 时长下给 6 轮（长时长口径，2026-09-20 §20.1 重定）。
    expect(store.triggerOptimizer.settings.rounds).toBe(6);
    expect(preset.element.value).toBe('fine');
    // 档位的即时反馈留在页面上（结果区那一行的旁边就是它）；「这个档位意味着什么」的长解释
    // 搬进了参数说明弹窗，由「合并设置卡片」那条用例覆盖。
    expect(wrapper.get('[data-trigger-optimizer-strength-summary]').text()).toBe('精细');
  });

  it('falls back to the custom preset once an advanced knob is edited', async () => {
    const { wrapper, store } = await mountPage(readySetup);

    await wrapper.get('[data-trigger-optimizer-candidate-limit]').setValue('12');
    await flushPromises();

    expect(store.triggerOptimizer.settings.candidateLimit).toBe(12);
    expect(wrapper.get('[data-trigger-optimizer-preset]').element.value).toBe('custom');
    expect(wrapper.text()).toContain('自定义');
  });

  it('writes the rounds setting and disables the new controls while running', async () => {
    const { wrapper, store } = await mountPage(readySetup);

    await wrapper.get('[data-trigger-optimizer-rounds]').setValue('3');
    expect(store.triggerOptimizer.settings.rounds).toBe(3);

    store.triggerOptimizer.runtime.isRunning = true;
    await flushPromises();
    expect(wrapper.get('[data-trigger-optimizer-preset]').element.disabled).toBe(true);
    expect(wrapper.get('[data-trigger-optimizer-rounds]').element.disabled).toBe(true);
    expect(wrapper.get('[data-trigger-optimizer-candidate-limit]').element.disabled).toBe(true);
  });

  it('explains why the reported improvement is trustworthy (summary + verification)', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.triggerOptimizer.results = makeResult(store);
    await flushPromises();

    const summary = wrapper.get('[data-trigger-optimizer-summary]');
    // 先回答「改了几个技能」，再让用户看细节。
    expect(summary.text()).toContain('已优化技能');
    expect(wrapper.get('[data-trigger-optimizer-changed]').text()).toContain('1 / 1');
    // 复验结论 + p 值：报告里的提升必须可证伪。
    expect(wrapper.get('[data-trigger-optimizer-verification]').text()).toContain('提升成立');
    expect(summary.text()).toContain('0.004');
    // 复验「怎么做」写在结果说明弹窗里（结论卡只留结论与 p 值）；设置区的「公共随机数」口径
    // 也搬进了参数说明弹窗（2026-09-22）—— 两处都不再平铺在页面上。
    await openNotes(wrapper);
    expect(noteEntry(wrapper, 'verification').text()).toContain('另一组随机种子');
    expect(wrapper.get('[data-trigger-optimizer-results]').text()).not.toContain('另一组随机种子');
    expect(wrapper.get('[data-trigger-optimizer-settings-card]').text()).not.toContain('公共随机数');
    await closeNotes(wrapper);
    await openSettingsNotes(wrapper);
    expect(noteEntry(wrapper, 'pairing').text()).toContain('公共随机数');
  });

  it('reports a non-significant verification honestly instead of claiming a win', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const result = makeResult(store);
    result.verification = {
      ...result.verification,
      verdict: 'inconclusive',
      paired: {
        rounds: 6,
        score: { rounds: 6, mean: 0.001, stdError: 0.02, t: 0.05, dof: 5, pValue: 0.96, verdict: 'inconclusive' },
      },
    };
    store.triggerOptimizer.results = result;
    await flushPromises();

    expect(wrapper.get('[data-trigger-optimizer-verification]').text()).toContain('未达显著');
  });

  // 复验三态的诚实标注（2026-09-24，设计 §31）：复验判「未达显著」+ 搜索期确有提升时，页面必须
  // 明说「提升尚未被独立样本确认」并给出「追加复验」入口（恰好一个）；已判正 / 已判负时结论已被
  // 独立样本定性，不再给入口。产品口径不变：未达显著**仍可应用**（不拦），只是不许装作已确认。
  it('flags an unconfirmed improvement and offers exactly one append verification', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const result = makeResult(store);
    result.verification = {
      ...result.verification,
      verdict: 'inconclusive',
      paired: {
        rounds: 6,
        score: { rounds: 6, mean: 0.001, stdError: 0.02, t: 0.05, dof: 5, pValue: 0.96, verdict: 'inconclusive' },
      },
    };
    store.triggerOptimizer.results = result;
    await flushPromises();

    expect(wrapper.get('[data-trigger-optimizer-verify-unconfirmed]').text()).toContain('提升尚未被独立样本确认');
    expect(wrapper.findAll('[data-trigger-optimizer-verify-append]')).toHaveLength(1);
    // 未达显著不拦应用（拦的只有复验判负）：这是产品门槛，不是本轮改动的一部分。
    expect(wrapper.get('[data-trigger-optimizer-apply]').element.disabled).toBe(false);

    // 追加轮数上屏（2026-09-25，设计 §47；累计护栏 2026-09-26，设计 §50 B-2）：这一份报告的整轮
    // 场次只有 10 场 ⇒ 单次 20% 护栏 = 2 场 = 1 轮/侧（累计 40% 预算 4 场还没花过，不是瓶颈）；而
    // (0.001, SE 0.02) 在 6 轮上「连上限 24 轮都判不出来」⇒ A′ 先补到上限、再被护栏钳到 1 轮。
    // 上屏的轮数由**与 store 同一个**纯函数、同一份输入算出，因此不会与实际分裂。
    const planLine = wrapper.get('[data-trigger-optimizer-verify-append-plan]');
    expect(planLine.text()).toContain('1 轮/侧');
    expect(planLine.text()).toContain('20%');
    expect(planLine.text()).toContain('累计 ≤ 40%');
    // 累计预算进度（§50 B-2）：点完这一下之后累计 0 + 2 场 / 预算 4 场 —— 界面必须说清还剩多少。
    expect(planLine.text()).toContain('累计追加 2 / 4 场（含本次）');

    // store 侧拒绝追加的原因（§31 遗留：error 一直写进 runtime 却没有渲染点）现在必须上屏。
    store.triggerOptimizer.runtime.verifyAppend.error = 'common:triggerOptimizer.verifyAppendExhausted';
    await flushPromises();
    expect(wrapper.get('[data-trigger-optimizer-verify-append-error]').text()).toContain('无法再追加');
    store.triggerOptimizer.runtime.verifyAppend.error = '';
    await flushPromises();

    const appendSpy = vi.spyOn(store, 'runTriggerOptimizerVerificationAppend').mockReturnValue(true);
    await wrapper.get('[data-trigger-optimizer-verify-append]').trigger('click');
    expect(appendSpy).toHaveBeenCalledOnce();

    // 已判正 / 已判负：不给入口，也不再挂警示行。
    for (const verdict of ['positive', 'negative']) {
      const settled = makeResult(store);
      settled.verification = { ...settled.verification, verdict };
      store.triggerOptimizer.results = settled;
      await flushPromises();
      expect(wrapper.find('[data-trigger-optimizer-verify-unconfirmed]').exists()).toBe(false);
      expect(wrapper.find('[data-trigger-optimizer-verify-append]').exists()).toBe(false);
    }

    // 护栏没有余量（整轮 8 场 ⇒ 预算 1 场 ⇒ 允许 0 轮）：入口不挂出来（点下去只会白等一次拒绝），
    // 但文案必须说清为什么 —— 否则「按钮凭空消失」会被读成功能坏了。这一条不是 capped（反解说 9 轮
    // 就够），护栏是唯一的拦路者，所以文案报的是「预算用尽」。
    const starved = makeResult(store);
    starved.simulations = 8;
    starved.verification = {
      ...starved.verification,
      verdict: 'inconclusive',
      paired: {
        rounds: 6,
        score: { rounds: 6, mean: 0.04, stdError: 0.02, t: 3.2, dof: 5, pValue: 0.09, verdict: 'inconclusive' },
      },
    };
    store.triggerOptimizer.results = starved;
    await flushPromises();
    expect(wrapper.find('[data-trigger-optimizer-verify-append]').exists()).toBe(false);
    expect(wrapper.get('[data-trigger-optimizer-verify-append-plan]').text()).toContain('已没有可用余量');
  });

  // 追加留档：合并轮数必须上屏（读者要能看出结论是几轮样本合并出来的）；运行中入口换成「停止」，
  // 与搜索 / 换难度复核共用同一条取消链（点它调 store 的 stopTriggerOptimizer）。
  it('shows the merged verification rounds after an append and swaps the button while running', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const result = makeResult(store);
    result.verification = {
      ...result.verification,
      verdict: 'positive',
      rounds: 12,
      attempts: [{ attempt: 1, rounds: 6, mergedRounds: 12, mergedVerdict: 'positive' }],
    };
    store.triggerOptimizer.results = result;
    await flushPromises();

    // 追加后结论转正：警示行消失，留档仍在。
    expect(wrapper.find('[data-trigger-optimizer-verify-unconfirmed]').exists()).toBe(false);
    const merged = wrapper.get('[data-trigger-optimizer-verify-append-merged]');
    expect(merged.text()).toContain('已复验 1 次');
    expect(merged.text()).toContain('合并 12 轮');
    // 累计追加场次（§50 B-2）：1 次追加 6 轮/侧 = 12 场，与成本护栏同一口径。
    expect(merged.text()).toContain('累计追加 12 场');

    // 运行中（结论仍是未达显著）：入口换成「停止追加复验」。
    const inconclusive = makeResult(store);
    inconclusive.verification = {
      ...inconclusive.verification,
      verdict: 'inconclusive',
      paired: {
        rounds: 6,
        score: { rounds: 6, mean: 0.001, stdError: 0.02, t: 0.05, dof: 5, pValue: 0.96, verdict: 'inconclusive' },
      },
    };
    store.triggerOptimizer.results = inconclusive;
    await flushPromises();
    store.triggerOptimizer.runtime.verifyAppend.isRunning = true;
    await flushPromises();
    expect(wrapper.find('[data-trigger-optimizer-verify-append]').exists()).toBe(false);
    const stopButton = wrapper.get('[data-trigger-optimizer-verify-append-stop]');
    expect(stopButton.text()).toContain('停止追加复验');
    const stopSpy = vi.spyOn(store, 'stopTriggerOptimizer').mockReturnValue(undefined);
    await stopButton.trigger('click');
    expect(stopSpy).toHaveBeenCalledOnce();
  });

  // 证据预算（2026-09-26，设计 §53）：两条追加路径（复验追加 / 复核追加）各有独立的预算池
  // （整轮场次 × 累计 40%），「已花 / 预算 / 剩余 / 停在哪个出口」收敛成同一处：说明弹窗一条 +
  // 导出一行（逐字同文）。没花过也没停住时整条不出现；缺整轮场次的旧报告只说「已花」。
  it('collects both append budgets into one evidence-budget note and export row', async () => {
    downloadTriggerOptimizerReportXlsx.mockClear();
    const { wrapper, store } = await mountPage(readySetup);
    // 默认报告：无实花、无出口 ⇒ 不出现（不留空条目）。
    store.triggerOptimizer.results = makeResult(store);
    await flushPromises();
    await openNotes(wrapper);
    expect(wrapper.find('[data-trigger-optimizer-note="evidenceBudget"]').exists()).toBe(false);

    // 两条路径各有实花：整轮 64 场 ⇒ 预算 25 场（累计 40%）；复验追加 1 × 6 轮 = 12 场、
    // 复核追加 1 × 2 轮 = 4 场 ⇒ 剩余 13 / 21。数字与执行同源（计划字段），页面不重算。
    const spent = makeResult(store);
    spent.simulations = 64;
    spent.verification = {
      ...spent.verification,
      verdict: 'positive',
      rounds: 12,
      attempts: [{ attempt: 1, rounds: 6, mergedRounds: 12, mergedVerdict: 'positive' }],
    };
    spent.robustness = {
      difficultyTier: 1,
      rounds: 8,
      verdict: 'inconclusive',
      scoreDelta: 0.01,
      profitDelta: 50,
      paired: { rounds: 8, score: { rounds: 8, mean: 0.01, stdError: 0.008, pValue: 0.2, verdict: 'inconclusive' } },
      attempts: [{ attempt: 1, rounds: 2, mergedRounds: 8, mergedVerdict: 'inconclusive' }],
      createdAt: Date.now(),
    };
    store.triggerOptimizer.results = spent;
    await flushPromises();
    const line = noteEntry(wrapper, 'evidenceBudget').text();
    expect(line).toContain('复验追加：已花 12 / 预算 25 场（剩余 13）');
    expect(line).toContain('复核追加：已花 4 / 预算 25 场（剩余 21）');

    // 导出：同一句话进汇总表（逐字同款）。
    await wrapper.get('[data-trigger-optimizer-export]').trigger('click');
    await flushPromises();
    const row = downloadTriggerOptimizerReportXlsx.mock.calls
      .at(-1)[0]
      .summaryRows.find((entry) => entry.item === '证据预算');
    expect(row.value).toBe('复验追加：已花 12 / 预算 25 场（剩余 13）｜复核追加：已花 4 / 预算 25 场（剩余 21）');

    // 旧报告（没记录整轮场次）：只剩「已花」，不编预算与剩余。
    const legacy = makeResult(store);
    legacy.simulations = 0;
    legacy.verification = {
      ...legacy.verification,
      verdict: 'positive',
      rounds: 12,
      attempts: [{ attempt: 1, rounds: 6, mergedRounds: 12, mergedVerdict: 'positive' }],
    };
    store.triggerOptimizer.results = legacy;
    await flushPromises();
    const legacyLine = noteEntry(wrapper, 'evidenceBudget').text();
    expect(legacyLine).toContain('复验追加：已花 12 场（本报告未记录整轮场次，预算不可用）');
    expect(legacyLine).not.toContain('剩余');

    // 停在出口（无实花也出现）：复核已达总量上限 16 轮 —— 「为什么不能再补」必须说清。
    const capped = makeResult(store);
    capped.simulations = 64;
    capped.robustness = {
      difficultyTier: 1,
      rounds: 16,
      verdict: 'inconclusive',
      scoreDelta: 0.01,
      profitDelta: 50,
      paired: { rounds: 16, score: { rounds: 16, mean: 0.01, stdError: 0.008, pValue: 0.3, verdict: 'inconclusive' } },
      createdAt: Date.now(),
    };
    store.triggerOptimizer.results = capped;
    await flushPromises();
    expect(noteEntry(wrapper, 'evidenceBudget').text()).toContain(
      '复核追加：已花 0 / 预算 25 场（剩余 25），已达总量上限 16 轮',
    );

    // 护栏钳到 0：剩余不为负，原因子句指名护栏（单次 / 累计）。
    const starved = makeResult(store);
    starved.simulations = 8;
    starved.verification = {
      ...starved.verification,
      verdict: 'inconclusive',
      paired: {
        rounds: 6,
        score: { rounds: 6, mean: 0.04, stdError: 0.02, t: 3.2, dof: 5, pValue: 0.09, verdict: 'inconclusive' },
      },
      attempts: [{ attempt: 1, rounds: 6, mergedRounds: 6, mergedVerdict: 'inconclusive' }],
    };
    store.triggerOptimizer.results = starved;
    await flushPromises();
    expect(noteEntry(wrapper, 'evidenceBudget').text()).toContain(
      '复验追加：已花 12 / 预算 3 场（剩余 0），成本护栏（单次 ≤ 20% · 累计 ≤ 40%）下已没有余量',
    );
  });

  // 复验判负（换种子后显著更差）是最危险的一类报告：搜索期说提升、真实效果是退步。
  // 实测（2026-09-18）标准档在已调优角色上采纳了 +0.00078 分的改动，复验 p=0.022 判负。
  it('blocks applying, withholds the recommendation and re-sources the metrics when verification is negative', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const result = makeResult(store);
    result.verification = {
      ...result.verification,
      verdict: 'negative',
      paired: {
        rounds: 6,
        score: { mean: -0.05, stdError: 0.01, t: -5, dof: 5, pValue: 0.022, verdict: 'negative' },
      },
    };
    store.triggerOptimizer.results = result;
    await flushPromises();

    // 1) 结论卡改口 + 复验结论展示为「结果更差」。
    expect(wrapper.text()).toContain('复验显示更差，不建议应用');
    expect(wrapper.get('[data-trigger-optimizer-verification]').text()).toContain('结果更差');
    // 2) 应用按钮禁用，并把「为什么不能应用」写在按钮下方（与 store 的拒绝口径同源）。
    expect(wrapper.get('[data-trigger-optimizer-apply]').element.disabled).toBe(true);
    expect(wrapper.get('[data-trigger-optimizer-apply-blocked]').text()).toContain('不可应用');
    // 3) 技能卡片不再挂「推荐」徽章（否则等于让用户去应用一个更差的配置）。
    expect(wrapper.find('[data-trigger-optimizer-recommendation]').exists()).toBe(false);
    expect(wrapper.get('[data-trigger-optimizer-recommendation-withheld]').text()).toContain('不予推荐');
    // 4) 指标卡口径换成复验实测：否则同屏会出现「结论说更差、指标说 +5%」的自相矛盾。
    expect(wrapper.get('[data-trigger-optimizer-metric-source]').text()).toContain('复验实测');
  });

  it('tells "higher score but not enough evidence" apart from "no better setup found"', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const result = makeResult(store);
    result.improvement = { ...result.improvement, score: 0.0008, scoreDelta: 0.0008, improved: false };
    result.evidenceBlocked = true;
    store.triggerOptimizer.results = result;
    await flushPromises();

    // 采纳闸门拒绝了「分数更高但证据不足」的候选 —— 这是「样本不够没敢采纳」，不是「已经搜遍了」。
    // 两句话现在共用说明弹窗里的同一条（verification），但必须按分支分开说，并给出提高重复次数的出路。
    expect(wrapper.get('[data-trigger-optimizer-verdict]').text()).toContain('有候选更高分，但证据不足');
    await openNotes(wrapper);
    const blocked = noteEntry(wrapper, 'verification').text();
    expect(blocked).toContain('配对证据不足');
    expect(blocked).not.toContain('保持现有配置即可');
    expect(wrapper.get('[data-trigger-optimizer-apply]').element.disabled).toBe(true);
    // 没被采纳就不算「已优化技能」：槽内局部赢家没写进 bestTriggerMap，报 1 / 1 会自相矛盾。
    expect(wrapper.get('[data-trigger-optimizer-changed]').text()).toContain('0 / 1');

    // 对照组：真的搜遍了（evidenceBlocked=false）→ 同一条改口成「保持现有配置即可」，不再提重复次数。
    const exhausted = makeResult(store);
    exhausted.improvement = { ...exhausted.improvement, score: 0, scoreDelta: 0, improved: false };
    store.triggerOptimizer.results = exhausted;
    await flushPromises();
    const none = noteEntry(wrapper, 'verification').text();
    expect(none).toContain('保持现有配置即可');
    expect(none).not.toContain('配对证据不足');
  });

  // 「已优化技能」计数与采纳口径同源（2026-09-19 实测修正）：槽内最优候选的 score 可能落在
  // (0, MIN_ADOPT_SCORE) 之间——「略好但不够格」，没有被写进 bestTriggerMap。旧口径
  // （chosen.score > 0）会把这种槽也算成已优化：fly 图实测报 3 / 5，实际只有 1 个槽被改写，
  // 同屏还挂着两张「保持当前配置」。
  it('counts only adopted slots as optimized, not sub-threshold slot winners', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const result = makeResult(store);
    result.adoptedSlots = [];
    store.triggerOptimizer.results = result;
    await flushPromises();

    expect(Number(result.perAbilityChoices[0].chosen.score)).toBeGreaterThan(0);
    expect(wrapper.get('[data-trigger-optimizer-changed]').text()).toContain('0 / 1');
  });

  // 「轮数上限截断」提示（2026-09-19，设计 §19.8）：搜索的早停口径是「一整轮零采纳」；
  // 跑满上限且最后一轮仍有采纳 → 固定点没到，说明弹窗要给出下一步（提高上限 / 精细档）。
  it('suggests more rounds when the search stopped at the round limit, not at a fixed point', async () => {
    const { wrapper, store } = await mountPage(readySetup);

    // 收敛结束（默认 makeResult）：说明里没有这一条。
    store.triggerOptimizer.results = makeResult(store);
    await flushPromises();
    await openNotes(wrapper);
    expect(wrapper.find('[data-trigger-optimizer-note="roundLimit"]').exists()).toBe(false);

    // 跑满上限且最后一轮仍在采纳 + 报告声称提升 → 条目出现，并点名两个出路。
    const cutOff = makeResult(store);
    cutOff.roundLimitReached = true;
    store.triggerOptimizer.results = cutOff;
    await flushPromises();
    const hint = noteEntry(wrapper, 'roundLimit').text();
    expect(hint).toContain('搜索轮数上限');
    expect(hint).toContain('精细');

    // 报告不声称提升（improved=false）时不给这一条：先把「结论」说清楚，不叠加猜测。
    const noClaim = makeResult(store);
    noClaim.roundLimitReached = true;
    noClaim.improvement = { ...noClaim.improvement, improved: false };
    store.triggerOptimizer.results = noClaim;
    await flushPromises();
    expect(wrapper.find('[data-trigger-optimizer-note="roundLimit"]').exists()).toBe(false);
  });

  // 两把尺子的上屏（2026-09-20 设计 §20.2 + 2026-09-25 设计 §45 + 2026-09-26 设计 §52）：把「这次
  // 设置到底能测出多大的提升」讲清楚，并分别回答「被采纳（过噪声地板）要多少轮」与「判成 p<0.05
  // 明确结论要多少轮」。三种分支都要在页面上说实话：已够 / 提到 N 轮 / 拉满也不够（后者点明加时长
  // 比加轮数更划算）。
  it('shows both rulers (noise floor / significance threshold) and the rounds each one needs', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    // result.rounds = 2 是搜索跑了几轮 pass（实测丛林 24h 标准档正是 2）——它**不是**自由度，
    // 文案必须用 settings.rounds（重复次数），否则会印成「2 轮 × 24 小时」（2026-09-20 实测抓到）。
    const withFloor = (stdError, pairedRounds = 5) => {
      const result = makeResult(store);
      result.rounds = 2;
      result.improvement = {
        ...result.improvement,
        paired: {
          rounds: pairedRounds,
          score: {
            rounds: pairedRounds,
            mean: 0.02,
            stdError,
            t: 4,
            dof: pairedRounds - 1,
            pValue: 0.002,
            verdict: 'inconclusive',
          },
        },
      };
      return result;
    };

    // 默认报告：improvement.paired 没有标准误 → 不给这一条。
    store.triggerOptimizer.results = makeResult(store);
    await flushPromises();
    await openNotes(wrapper);
    expect(wrapper.find('[data-trigger-optimizer-note="detectionFloor"]').exists()).toBe(false);

    // SE 0.005、重复次数 5：噪声地板 = 2×SE = 0.01（≈1.4% 利润）、显著门槛 = t(4)×SE ≈ 0.0139。
    // 采纳口径已够得着（0.01 ≥ 地板）→ 建议行说「已低于采纳门槛量级」，并按判定口径补一句
    // 「判成 p<0.05 需 ≈8 轮」（两把尺子各自指名，设计 §52）。数字走页面的 toLocaleString 口径
    // （最多四位小数、不补尾零），符号只在「±」上出现一次。
    store.triggerOptimizer.results = withFloor(0.005);
    await flushPromises();
    const satisfied = noteEntry(wrapper, 'detectionFloor').text();
    expect(satisfied).toContain('5 轮 × 24 小时');
    expect(satisfied).toContain('±0.01');
    expect(satisfied).toContain('1.4');
    expect(satisfied).toContain('0.0139');
    expect(satisfied).toContain('噪声地板');
    expect(satisfied).toContain('显著门槛');
    expect(satisfied).toContain('已低于采纳门槛量级');
    expect(satisfied).toContain('需 ≈8 轮');
    expect(satisfied).not.toContain('重复次数需提到');

    // SE 0.006、5 轮：噪声地板 ±0.012 > 门槛 ⇒ 采纳口径反解给出最小轮数 8 轮（5×(0.012/0.01)² = 7.2），
    // 并给出届时两组门槛（噪声地板 ≈ ±0.0095、显著门槛 ≈ ±0.0112）；判定口径同时说「判成 p<0.05
    // 需 ≈10 轮」——同一目标量级、两把尺子给出两个轮数（设计 §52）。
    store.triggerOptimizer.results = withFloor(0.006);
    await flushPromises();
    const planned = noteEntry(wrapper, 'detectionFloor').text();
    expect(planned).toContain('需提到 ≈8 轮');
    expect(planned).toContain('±0.0095');
    expect(planned).toContain('0.0112');
    expect(planned).toContain('需 ≈10 轮');

    // SE 0.01、5 轮：要过门槛需 20 轮 > 上限 ⇒ 诚实说「拉满也确认不了」，并指出加时长更划算；
    // 判定口径在本档同样无解（显著门槛恒高于噪声地板），子句必须说「判不出来」而不是编一个轮数。
    store.triggerOptimizer.results = withFloor(0.01);
    await flushPromises();
    const capped = noteEntry(wrapper, 'detectionFloor').text();
    expect(capped).toContain(`拉到上限 ${TRIGGER_OPTIMIZER_MAX_ROUNDS} 轮`);
    // 拉满时的噪声地板 = 2 × SE(5) × √(5/上限)：上限一变它就变（10 轮时 0.0141、12 轮时 0.0129），
    // 所以按常量现算，不写死。
    expect(capped).toContain(`±${(2 * 0.01 * Math.sqrt(5 / TRIGGER_OPTIMIZER_MAX_ROUNDS)).toFixed(4)}`);
    expect(capped).toContain('加长模拟时长');
    expect(capped).toContain('判不出来');
    expect(capped).toContain('复验');
    expect(capped).not.toContain('需提到');

    // 重复次数已在上限（SE 0.005 ⇒ 地板 = 0.01）：仍然只说实话——采纳口径说「已够」，
    // 判定口径说「上限内判不出来」（不得出现做不到的下一步）。
    expect(store.setTriggerOptimizerSettings({ rounds: TRIGGER_OPTIMIZER_MAX_ROUNDS })).toBe(true);
    store.triggerOptimizer.results = withFloor(0.005, TRIGGER_OPTIMIZER_MAX_ROUNDS);
    await flushPromises();
    const atMaxLine = noteEntry(wrapper, 'detectionFloor').text();
    expect(atMaxLine).toContain(`${TRIGGER_OPTIMIZER_MAX_ROUNDS} 轮 × 24 小时`);
    expect(atMaxLine).toContain('已低于采纳门槛量级');
    expect(atMaxLine).toContain('判不出来');
    expect(atMaxLine).not.toContain('需提到');
    expect(atMaxLine).not.toContain('把重复次数提到');
  });

  // 跨槽联合采纳（2026-09-19，设计 §19.11）：单槽增量的证据不足、联合（相对本轮起点）显著时
  // 两槽一起落地。说明弹窗要说出来——否则用户会把「提升」里联合采纳的贡献误读成普通的槽内推荐。
  it('reports cross-slot joint adoptions as a summary line', async () => {
    const { wrapper, store } = await mountPage(readySetup);

    // 默认（无联合采纳）：说明里没有这一条。
    store.triggerOptimizer.results = makeResult(store);
    await flushPromises();
    await openNotes(wrapper);
    expect(wrapper.find('[data-trigger-optimizer-note="jointAdoption"]').exists()).toBe(false);

    const joint = makeResult(store);
    joint.jointAdoptions = [
      {
        round: 1,
        slots: [1, 2],
        abilityHrids: [ABILITY_HRID, 'second'],
        rounds: 2,
        score: 0.014,
        mean: 0.014,
        stdError: 0.002,
        pValue: 0.01,
        verdict: 'positive',
        marginalMean: 0.006,
        adoptedSlots: [1],
      },
    ];
    store.triggerOptimizer.results = joint;
    await flushPromises();

    const entry = noteEntry(wrapper, 'jointAdoption').text();
    expect(entry).toContain('跨槽联合采纳');
    expect(entry).toContain('1 对');
    expect(entry).toContain('1 个技能');
  });

  // 深挖（2026-09-19 设计 §18.1；2026-09-20 改独立种子，设计 §21）：被噪声地板拦下的槽级
  // 最优候选会自动做一次独立种子复核，UI 必须把复核结论说出来——否则用户看到「证据不足」
  // 就以为是死路，不知道系统已经替他换了一组新样本再判过一次。
  it('reports the automatic deep-dive re-check of blocked candidates', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const result = makeResult(store);
    result.evidenceBlocked = true;
    result.deepDives = [
      {
        slotIndex: 1,
        abilityHrid: ABILITY_HRID,
        rounds: 6,
        seeds: [11, 22, 33, 44, 55, 66],
        score: 0.024,
        mean: 0.024,
        stdError: 0.009,
        pValue: 0.08,
        verdict: 'inconclusive',
        adopted: true,
      },
    ];
    store.triggerOptimizer.results = result;
    await flushPromises();

    await openNotes(wrapper);
    const entry = noteEntry(wrapper, 'deepDive').text();
    expect(entry).toContain('独立种子复核');
    expect(entry).toContain('6 轮');
    expect(entry).toContain('1 个通过并采纳');
    // 被深挖采纳的槽：卡片补一句「哪来的证据」（搜索期的徽章可能仍是「不显著」）。
    expect(wrapper.get('[data-trigger-optimizer-deep-dive-slot]').text()).toContain('深挖复核通过');
  });

  it('shows 「保持当前配置」 instead of a 0-score recommendation and marks the failed deep dive', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const result = makeResult(store);
    // 本槽最优 = 当前配置（得分 0）：语义是「保持现状」，不是「推荐一个 0 分改动」。
    result.perAbilityChoices[0].chosen = { ...result.perAbilityChoices[0].candidates[0], score: 0 };
    result.deepDives = [
      {
        slotIndex: 1,
        abilityHrid: ABILITY_HRID,
        rounds: 6,
        score: 0.005,
        mean: 0.005,
        stdError: 0.01,
        pValue: 0.62,
        verdict: 'inconclusive',
        adopted: false,
      },
    ];
    store.triggerOptimizer.results = result;
    await flushPromises();

    expect(wrapper.find('[data-trigger-optimizer-recommendation]').exists()).toBe(false);
    expect(wrapper.text()).toContain('保持当前配置');
    expect(wrapper.get('[data-trigger-optimizer-deep-dive-slot]').text()).toContain('仍不足');
  });

  it('exposes the paired mean ± standard error so the adoption gate is self-explanatory', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const result = makeResult(store);
    // 「立即释放」不是本槽最优 → 走 metricsByCandidate 表（配对差 ± 标准误来自这里）。
    result.metricsByCandidate['1|[]'] = {
      metrics: { dps: 95, dailyNoRngProfit: 5, xpPerHour: 1000, killsPerHour: 60, deathsPerHour: 0 },
      score: 0.0212,
      paired: {
        rounds: 3,
        score: { mean: 0.0212, stdError: 0.0083, t: 2.55, dof: 2, pValue: 0.126, verdict: 'inconclusive' },
      },
      slotIndex: 1,
    };
    store.triggerOptimizer.results = result;
    await flushPromises();

    await openDetails(wrapper, 1);
    expect(wrapper.text()).toContain('配对差');
    expect(wrapper.text()).toContain('0.0212');
    expect(wrapper.text()).toContain('0.0083');
  });

  it('withholds the badge for a slot whose winner was never adopted (evidence-blocked)', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const result = makeResult(store);
    // 槽内最有分（+0.0117）但被噪声地板拦下、深挖也没过 → 没被采纳。
    result.improvement = { ...result.improvement, score: 0, scoreDelta: 0, improved: false };
    result.evidenceBlocked = true;
    result.adoptedSlots = [];
    result.deepDives = [
      {
        slotIndex: 1,
        abilityHrid: ABILITY_HRID,
        rounds: 6,
        score: 0.0117,
        mean: 0.0117,
        stdError: 0.0072,
        pValue: 0.16,
        verdict: 'inconclusive',
        adopted: false,
      },
    ];
    store.triggerOptimizer.results = result;
    await flushPromises();

    // 「推荐 + 得分 0.0117」与同屏的「证据不足、已优化 0 / N」自相矛盾（浏览器实测发现）。
    expect(wrapper.find('[data-trigger-optimizer-recommendation]').exists()).toBe(false);
    expect(wrapper.text()).toContain('保持当前配置');
    expect(wrapper.get('[data-trigger-optimizer-deep-dive-slot]').text()).toContain('仍不足');
    expect(wrapper.get('[data-trigger-optimizer-changed]').text()).toContain('0 / 1');
  });

  it('labels the metric cards with their source (verification once it has metrics)', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.triggerOptimizer.results = makeResult(store);
    await flushPromises();

    // 复验（换种子 6 轮）带回了指标 → 指标卡与结论卡的 p 值同源（2026-09-19，设计 §19.6）：
    // 旧行为只在「复验判负」时切换，成立时仍标「搜索期估算」，数字与 p 值不是同一批证据。
    expect(wrapper.get('[data-trigger-optimizer-metric-source]').text()).toContain('复验实测');

    // 复验缺失（取消/失败的报告）时回落到搜索期估算。
    const withoutVerification = makeResult(store);
    withoutVerification.verification = null;
    store.triggerOptimizer.results = withoutVerification;
    await flushPromises();
    expect(wrapper.get('[data-trigger-optimizer-metric-source]').text()).toContain('搜索期估算');
  });

  // 撤销入口不再被「结果过期」关掉（2026-09-19，设计 §19.6）：过期可能只是切了地图/难度/
  // 时长，撤销只覆盖被优化的技能键，是否会踩掉手工改动由 store 的判定负责。
  it('keeps the revert entry available when the result went stale', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.triggerOptimizer.results = makeResult(store);
    store.triggerOptimizer.baselineSnapshot = { playerId: '1', triggerMap: {} };
    await flushPromises();

    store.triggerOptimizer.results.stale = true;
    await flushPromises();

    expect(wrapper.get('[data-trigger-optimizer-revert]').element.disabled).toBe(false);
    // 「应用」仍然按过期口径禁用（写回整份报告必须要求输入未变）。
    expect(wrapper.get('[data-trigger-optimizer-apply]').element.disabled).toBe(true);
  });

  // 「推荐」徽章旁的证据解释（2026-09-19，设计 §19.4）：搜索期 verdict 不显著时，采纳依据是
  // 噪声地板（|mean| > 2×SE），与同屏的「不显著」并列时必须说清楚，否则读成「没证据也硬采纳」。
  it('explains the noise-floor adoption basis next to the recommendation badge', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const result = makeResult(store);
    result.perAbilityChoices[0].chosen = {
      ...result.perAbilityChoices[0].chosen,
      paired: { rounds: 5, score: { rounds: 5, mean: 0.0226, stdError: 0.0083, verdict: 'inconclusive' } },
    };
    store.triggerOptimizer.results = result;
    await flushPromises();

    const chip = wrapper.get('[data-trigger-optimizer-adoption-evidence]');
    expect(chip.text()).toContain('已过噪声地板');
    const title = chip.attributes('title');
    expect(title).toContain('0.0226'); // 配对差均值
    expect(title).toContain('0.0083'); // 标准误
    expect(title).toContain('0.0166'); // 噪声地板 2×SE
    expect(title).toContain('0.004'); // 独立复验 p 值（makeResult 的 verification.pValue）

    // 深挖采纳的槽**不挂**这枚标签（2026-09-19 实测补丁）：它的依据是扩样到 6 轮后的复测
    // （熊熊图实测：搜索期 mean 0.0732 < 2×SE 0.0764，深挖 6 轮 0.0785 > 0.0632），
    // 旁边已有「深挖复核通过（6 轮）」，再挂「已过噪声地板」就是自相矛盾。
    const deepDiveResult = makeResult(store);
    deepDiveResult.perAbilityChoices[0].chosen = {
      ...deepDiveResult.perAbilityChoices[0].chosen,
      paired: { rounds: 5, score: { rounds: 5, mean: 0.0226, stdError: 0.019, verdict: 'inconclusive' } },
    };
    deepDiveResult.deepDives = [
      {
        slotIndex: 1,
        abilityHrid: ABILITY_HRID,
        rounds: 6,
        score: 0.08,
        mean: 0.0785,
        stdError: 0.0316,
        pValue: 0.056,
        verdict: 'inconclusive',
        adopted: true,
      },
    ];
    store.triggerOptimizer.results = deepDiveResult;
    await flushPromises();

    expect(wrapper.find('[data-trigger-optimizer-adoption-evidence]').exists()).toBe(false);
    expect(wrapper.get('[data-trigger-optimizer-deep-dive-slot]').text()).toContain('深挖复核通过');
  });

  // racing 粗筛标注（2026-09-24，设计 §30）：候选表的依据必须绑定产生它的那批测量 —— 只有
  // 粗筛样本（未进精测）的行要明说「粗筛 N 轮」，否则 2 轮的噪声统计会与精测统计混读。
  it('marks screened-only candidates with their screening sample size', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.triggerOptimizer.results = makeResult(store);
    await flushPromises();
    await openDetails(wrapper, 1);

    // 只有「立即释放」（'1|[]'，lane='screen'）是粗筛淘汰行 → 恰好 1 条标注；
    // chosen 行是报告自造对象（无 lane 字段）→ 不标注（依据绑定测量，不猜口径）。
    const screened = wrapper.findAll('[data-trigger-optimizer-candidate-screened]');
    expect(screened).toHaveLength(1);
    expect(screened[0].text()).toContain('粗筛');
    expect(screened[0].text()).toContain('未进入精测');
  });

  it('locks abilities out of the search and shrinks the planned simulation count', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const planned = Number(
      wrapper
        .get('[data-trigger-optimizer-planned]')
        .text()
        .match(/[\d,]+/)[0]
        .replace(/,/g, ''),
    );

    const lock = wrapper.get(`[data-trigger-optimizer-lock="${ABILITY_HRID}"]`).find('input');
    await lock.setValue(true);
    await flushPromises();

    expect(store.triggerOptimizer.settings.lockedAbilityHrids).toEqual([ABILITY_HRID]);
    // 唯一可搜的槽被锁住 → 搜索期只剩基线 1 次评估，预计场次随之下降。
    expect(wrapper.text()).toContain('已锁定');
    const afterLock = Number(
      wrapper
        .get('[data-trigger-optimizer-planned]')
        .text()
        .match(/[\d,]+/)[0]
        .replace(/,/g, ''),
    );
    expect(afterLock).toBeLessThan(planned);
  });

  it('shows what is being optimized right now while running', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    Object.assign(store.triggerOptimizer.runtime, {
      isRunning: true,
      phase: 'searching',
      progress: 0.5,
      elapsedSeconds: 30,
      abilityHrid: ABILITY_HRID,
      round: 2,
      bestScore: 0.31,
    });
    await flushPromises();

    const current = wrapper.get('[data-trigger-optimizer-current]').text();
    expect(current).toContain('正在优化');
    expect(current).toContain('第 2 轮');
    expect(current).toContain('当前最佳分');
    // 预计剩余由「已用时 / 已完成比例」外推：30s 完成 50% → 约 30s。
    expect(wrapper.get('[data-trigger-optimizer-eta]').text()).toContain('30');
  });

  it('warns when combat attributes were unavailable so numeric candidates were skipped', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.triggerOptimizer.results = makeResult(store, { resourcesAvailable: false });
    await flushPromises();

    expect(wrapper.get('[data-trigger-optimizer-resources-warning]').text()).toContain('最大生命');
  });

  it('states that combined candidates are AND-ed, and reads scores by slot + signature', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const result = makeResult(store);
    // 追加一条组合候选（两条触发器）+ 只属于该候选的报告记录。
    const composite = customTrigger(300);
    const second = customTrigger(120);
    const compositeTriggers = [composite, second];
    const compositeCandidate = {
      ...result.perAbilityChoices[0].candidates[2],
      triggers: compositeTriggers,
      signature: JSON.stringify(compositeTriggers),
      labelKey: 'common:triggerOptimizer.candidate.compositeLowHpGuard',
    };
    result.perAbilityChoices[0].candidates.push(compositeCandidate);
    result.metricsByCandidate[`1|${compositeCandidate.signature}`] = {
      metrics: result.baselineMetrics,
      score: 0.07,
      paired: { score: { verdict: 'positive' } },
      slotIndex: 1,
    };
    store.triggerOptimizer.results = result;
    await flushPromises();

    // 组合候选需要一句「与」语义的澄清，否则会被读成「或」。
    expect(wrapper.get('[data-trigger-optimizer-and-hint]').text()).toContain('同时满足');
    // 非最优候选的分数按「槽位 + 签名」读取：-0.05 只存在于 '1|default' 这条记录
    //（保住了「不同技能共用同一份触发器列表」时不串味）。
    await openDetails(wrapper, 1);
    const rows = wrapper.findAll('[data-trigger-optimizer-candidate]');
    expect(rows.some((row) => row.text().includes('0.07'))).toBe(true);
    const defaultRow = rows.find((row) => row.text().includes('默认触发器'));
    expect(defaultRow.text()).toContain('-0.05');
  });

  it('shows the runtime error key as localized text', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.triggerOptimizer.runtime.error = 'common:triggerOptimizer.noResults';
    await flushPromises();
    expect(wrapper.get('[data-trigger-optimizer-error]').text()).toContain('尚无可用结果');
  });

  // 搜索层的上报是「一次评估一次」等离散点（PROGRESS_THROTTLE_MS 只是上限节流，没有定时器
  // 兜底），直接绑 store 的观感是「冻结 → 跳变」。页面因此自己补一个 100ms 本地时钟。
  function readElapsed(wrapper) {
    return Number(
      wrapper
        .get('[data-trigger-optimizer-elapsed]')
        .text()
        .replace(/[^\d.]/g, ''),
    );
  }
  function readProgress(wrapper) {
    const element = wrapper.get('[data-trigger-optimizer-progress-bar]').element;
    const value = Number(element.value);
    return Number.isFinite(value) ? value : Number(element.getAttribute('value'));
  }

  it('keeps the clock and the progress bar moving between sparse store reports', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    vi.useFakeTimers();
    try {
      const runtime = store.triggerOptimizer.runtime;
      const idleTimers = vi.getTimerCount();
      runtime.isRunning = true;
      runtime.totalEvaluations = 32;
      runtime.progress = 0.5;
      runtime.elapsedSeconds = 5;
      await nextTick();
      expect(vi.getTimerCount()).toBe(idleTimers + 1); // 只在运行期起表

      await vi.advanceTimersByTimeAsync(1000);
      await nextTick();
      // 时间：store 里还停在 5 秒，页面自己已经走到 ~6 秒（不再等下一次上报）。
      expect(runtime.elapsedSeconds).toBe(5);
      expect(readElapsed(wrapper)).toBeGreaterThanOrEqual(5.9);
      // 进度：已经开始爬，但领先量不超过 1.5 个评估格（1/32）。
      expect(readProgress(wrapper)).toBeGreaterThan(0.5);
      expect(readProgress(wrapper)).toBeLessThanOrEqual(0.5 + 1.5 / 32 + 1e-6);

      await vi.advanceTimersByTimeAsync(3000);
      await nextTick();
      const settled = readProgress(wrapper);
      expect(settled).toBeCloseTo(0.5 + 1.5 / 32, 4);

      // 新上报到达：显示值只增不减，并继续往新目标爬。
      runtime.progress = 0.625;
      runtime.elapsedSeconds = 9;
      await nextTick();
      await vi.advanceTimersByTimeAsync(200);
      await nextTick();
      expect(readProgress(wrapper)).toBeGreaterThanOrEqual(settled);
      expect(readElapsed(wrapper)).toBeGreaterThanOrEqual(9);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to the reported elapsed time and progress once the run finishes', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    vi.useFakeTimers();
    try {
      const runtime = store.triggerOptimizer.runtime;
      const idleTimers = vi.getTimerCount();
      runtime.isRunning = true;
      runtime.totalEvaluations = 32;
      runtime.progress = 0.5;
      await nextTick();
      await vi.advanceTimersByTimeAsync(1000);
      await nextTick();
      expect(readElapsed(wrapper)).toBeGreaterThan(0);

      // makeResult 的 createdAt 依赖 Date.now()，假时钟下会得到 0（falsy）→ 显式覆盖。
      store.triggerOptimizer.results = makeResult(store, { createdAt: 1, elapsedSeconds: 12 });
      runtime.isRunning = false;
      await nextTick();
      expect(readElapsed(wrapper)).toBe(12); // 回落报告里的实测总时长
      expect(readProgress(wrapper)).toBe(1); // 报告已产出 → 进度满
      expect(vi.getTimerCount()).toBe(idleTimers); // 停表，不再空转

      await vi.advanceTimersByTimeAsync(2000);
      await nextTick();
      expect(readElapsed(wrapper)).toBe(12); // 停表后不再走
    } finally {
      vi.useRealTimers();
    }
  });

  // 导出 Excel（2026-09-24，设计 §40）：结果区按钮把报告 + 页面同款文案交给导出入口。
  it('hands the report and page-scope text to the Excel export entry', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    store.triggerOptimizer.results = makeResult(store);
    await flushPromises();

    await wrapper.get('[data-trigger-optimizer-export]').trigger('click');
    await flushPromises();

    expect(downloadTriggerOptimizerReportXlsx).toHaveBeenCalledTimes(1);
    const options = downloadTriggerOptimizerReportXlsx.mock.calls[0][0];
    expect(options.report.createdAt).toBe(store.triggerOptimizer.results.createdAt);
    expect(options.statusBySlot['1']).toBeTruthy();
    expect(options.summaryRows.length).toBeGreaterThan(0);
  });

  // 追加复验留档（2026-09-25，设计 §48）：轮数自适应（§47）之后，「这次补了几轮、上限/护栏有没有
  // 咬住」只在界面上说过一次 —— 导出的汇总表必须带上同一件事，事后才能复盘。计划快照缺失
  //（本改动之前的旧报告）只说基础句：没有依据就不提上限/护栏。
  it('archives appended verifications and their plan snapshot in the exported summary rows', async () => {
    downloadTriggerOptimizerReportXlsx.mockClear();
    const { wrapper, store } = await mountPage(readySetup);
    const result = makeResult(store);
    result.verification = {
      ...result.verification,
      rounds: 24,
      attempts: [
        {
          attempt: 1,
          rounds: 18,
          mergedRounds: 24,
          mergedVerdict: 'positive',
          plan: {
            decisive: false,
            capped: true,
            budgetLimited: false,
            // 两级护栏字段（2026-09-26，设计 §50 B-2）：整轮 370 场 ⇒ 单次 74 场 / 累计 148 场，
            // 上限先咬住（capped），护栏没咬 —— 明细行的文案由 capped 分支给出。
            limitedBy: null,
            currentRounds: 6,
            requiredRounds: null,
            capRounds: 24,
            targetRounds: 24,
            plannedRounds: 18,
            plannedSimulations: 36,
            budgetSimulations: 74,
            spentSimulations: 0,
            cumulativeBudgetSimulations: 148,
          },
        },
      ],
    };
    store.triggerOptimizer.results = result;
    await flushPromises();

    await wrapper.get('[data-trigger-optimizer-export]').trigger('click');
    await flushPromises();

    const rows = downloadTriggerOptimizerReportXlsx.mock.calls[0][0].summaryRows;
    // 汇总行与界面逐字同款（verifyAppendMerged 的文案，含 §50 B-2 的累计追加场次：18 轮/侧 = 36 场）；
    // 明细行给出轮数与「上限咬住」。
    expect(rows.some((row) => row.value === '已复验 1 次 · 合并 24 轮 · 累计追加 36 场')).toBe(true);
    const detail = rows.find((row) => row.item === '追加复验 1');
    expect(detail).toBeTruthy();
    expect(detail.value).toBe('追加 18 轮/侧（累计 24 轮）；已达上限 24 轮');

    const legacy = makeResult(store);
    legacy.verification = {
      ...legacy.verification,
      rounds: 12,
      attempts: [{ attempt: 1, rounds: 6, mergedRounds: 12, mergedVerdict: 'positive' }],
    };
    store.triggerOptimizer.results = legacy;
    await flushPromises();
    await wrapper.get('[data-trigger-optimizer-export]').trigger('click');
    await flushPromises();

    const legacyRows = downloadTriggerOptimizerReportXlsx.mock.calls[1][0].summaryRows;
    const legacyDetail = legacyRows.find((row) => row.item === '追加复验 1');
    expect(legacyDetail.value).toBe('追加 6 轮/侧（累计 12 轮）');
  });

  // 本槽净效应直显（2026-09-25，§27.6）：卡片直接给出「指标 + 配对差 + 显著性」摘要，
  // 不用打开详情弹窗；mean 为 null 的指标不产行（不把 null 当 0）。
  it('shows the per-ability net effect summary on the card without opening the modal', async () => {
    const { wrapper, store } = await mountPage(readySetup);
    const result = makeResult(store);
    result.perAbilityChoices[0].chosen = {
      ...result.perAbilityChoices[0].chosen,
      paired: {
        rounds: 2,
        score: { mean: 0.02, stdError: 0.01, verdict: 'positive' },
        metrics: {
          dps: { mean: 3.5, stdError: 1.2, verdict: 'positive' },
          dailyNoRngProfit: { mean: 0.4, stdError: 0.3, verdict: 'inconclusive' },
          xpPerHour: { mean: 12, stdError: null, verdict: 'unknown' },
          killsPerHour: { mean: 0.2, stdError: 0.1, verdict: 'negative' },
          deathsPerHour: { mean: null, stdError: null, verdict: 'unknown' },
        },
      },
    };
    store.triggerOptimizer.results = result;
    await flushPromises();

    const summary = wrapper.get('[data-trigger-optimizer-net-summary]');
    // 5 个指标里 deathsPerHour 的 mean 为 null → 不产行（不把 null 当 0 上屏）。
    expect(summary.findAll('[data-trigger-optimizer-net-summary-metric]')).toHaveLength(4);
    expect(summary.text()).toContain('每秒伤害');
    expect(summary.text()).toContain('+3.5');
    // 显著性方向中立：positive/negative 都记「显著」、inconclusive「不显著」；缺 stdError 显示「± —」。
    expect(summary.findAll('[data-trigger-optimizer-net-summary-significance="significant"]')).toHaveLength(2);
    expect(summary.findAll('[data-trigger-optimizer-net-summary-significance="inconclusive"]')).toHaveLength(1);
    expect(summary.text()).toContain('± —');
  });
});

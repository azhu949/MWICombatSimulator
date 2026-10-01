// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineComponent, nextTick } from 'vue';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { initI18n } from '../i18n/i18n.js';
import HomeMultiRoundPanel from '../components/home/HomeMultiRoundPanel.vue';
import SimulationResultsView from '../components/SimulationResultsView.vue';
import { useSimulatorStore } from '../../stores/simulatorStore.js';

beforeAll(async () => {
  localStorage.setItem('i18nextLng', 'en');
  await initI18n();
});

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});

afterEach(() => {
  document.body.innerHTML = '';
});

const passthroughStub = defineComponent({
  template: '<div><slot /></div>',
});

// 多轮聚合结构的测试样例（字段以多轮执行链路交付的 results.multiRound 为准）。
function buildMultiRound(overrides = {}) {
  return {
    rounds: 3,
    seedBase: 20261001,
    seeds: [111111, 222222, 333333],
    successCount: 2,
    failedCount: 1,
    perRound: [
      { round: 1, seed: 111111, failed: false, error: '' },
      { round: 2, seed: 222222, failed: false, error: '' },
      { round: 3, seed: 333333, failed: true, error: 'round exploded' },
    ],
    perPlayer: [
      {
        playerHrid: 'player1',
        playerName: 'Hero',
        metrics: {
          simulatedTime: {
            values: [3600000000000, 3600000000000],
            rounds: [1, 2],
            sampleCount: 2,
            mean: 3600000000000,
            winsorizedMean: 3600000000000,
            p50: 3600000000000,
            robustMean: 3600000000000,
            min: 3600000000000,
            max: 3600000000000,
            std: 0,
            ciHalfWidth95: 0,
            ciLow: 3600000000000,
            ciHigh: 3600000000000,
            confidence: 1,
          },
          encountersPerHour: {
            values: [100, 120],
            rounds: [1, 2],
            sampleCount: 2,
            mean: 110,
            winsorizedMean: 110,
            p50: 110,
            robustMean: 110,
            min: 100,
            max: 120,
            std: 10,
            ciHalfWidth95: 13.86,
            ciLow: 96.14,
            ciHigh: 123.86,
            confidence: 0.5,
          },
          profitPerHour: {
            values: [1000, 2000],
            rounds: [1, 2],
            sampleCount: 2,
            mean: 1500,
            winsorizedMean: 1500,
            p50: 1500,
            robustMean: 1500,
            min: 1000,
            max: 2000,
            std: 500,
            ciHalfWidth95: 692.96,
            ciLow: 807.03,
            ciHigh: 2192.96,
            confidence: 0.45,
          },
        },
      },
    ],
    aggregation: {
      metricSource: 'summarizeSeries.robustMean',
      summaryRowSource: 'perRoundSummaries',
      successRounds: 2,
    },
    ...overrides,
  };
}

describe('HomeMultiRoundPanel statistics', () => {
  it('renders overview, formatted statistics and per-player metric rows', async () => {
    const wrapper = mount(HomeMultiRoundPanel, { props: { multiRound: buildMultiRound() } });
    // useI18nText 在挂载时把语言刷成 i18next 当前语言：等待刷新后的重渲染再断言。
    await flushPromises();
    const text = wrapper.text();

    expect(text).toContain('Multi-round Statistics');
    expect(text).toContain('Rounds: 3');
    expect(text).toContain('Base Seed: 20261001');
    expect(text).toContain('1 rounds failed (excluded from statistics)');
    expect(text).toContain('Hero');

    // 中位数 / 稳健值 / 均值 / 95% 区间 / 置信度（非金额指标）
    expect(text).toContain('110');
    expect(text).toContain('[96.14, 123.86]');
    expect(text).toContain('50%');
    // 金额指标（收益/h）与结果视图同口径走 compact k/m/b（≥1000 缩写；区间下界 807 保持原格式）
    expect(text).toContain('1.5k');
    expect(text).toContain('[807, 2.19k]');
    expect(text).toContain('45%');
    // 模拟时长（纳秒）属时间类指标：不做 compact 缩写（回归锚点：曾被误压缩为 '3,600b'），
    // 与结果视图 simulatedHoursText 同口径折算为小时。
    expect(text).toContain('1.00 h');
    expect(text).not.toContain('3,600b');

    wrapper.unmount();
  });

  it('stays empty when multiRound is null', () => {
    const wrapper = mount(HomeMultiRoundPanel, { props: { multiRound: null } });

    expect(wrapper.find('.surface-panel').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Multi-round Statistics');

    wrapper.unmount();
  });

  it('stays empty for single-round data (rounds <= 1)', () => {
    const wrapper = mount(HomeMultiRoundPanel, {
      props: {
        multiRound: buildMultiRound({
          rounds: 1,
          failedCount: 0,
          perRound: [{ round: 1, seed: 111111, failed: false, error: '' }],
        }),
      },
    });

    expect(wrapper.find('.surface-panel').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Multi-round Statistics');

    wrapper.unmount();
  });

  it('expands per-round details with each round seed and metric values', async () => {
    const wrapper = mount(HomeMultiRoundPanel, {
      props: { multiRound: buildMultiRound() },
      attachTo: document.body,
    });

    expect(wrapper.text()).not.toContain('111111');
    await wrapper.get('button').trigger('click');
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain('Per-round Details');
    expect(text).toContain('111111');
    expect(text).toContain('222222');
    expect(text).toContain('333333');
    expect(text).toContain('100');
    expect(text).toContain('1k');

    wrapper.unmount();
  });

  it('sorts per-round details by column headers (desc → asc → reset) with nulls last', async () => {
    const wrapper = mount(HomeMultiRoundPanel, {
      props: {
        multiRound: buildMultiRound({
          rounds: 4,
          seeds: [111111, 222222, 333333, 444444],
          successCount: 3,
          failedCount: 1,
          perRound: [
            { round: 1, seed: 111111, failed: false, error: '' },
            { round: 2, seed: 222222, failed: false, error: '' },
            { round: 3, seed: 333333, failed: true, error: 'round exploded' },
            { round: 4, seed: 444444, failed: false, error: '' },
          ],
          perPlayer: [
            {
              playerHrid: 'player1',
              playerName: 'Hero',
              metrics: {
                encountersPerHour: {
                  values: [100, 300, 200],
                  rounds: [1, 2, 4],
                  sampleCount: 3,
                  mean: 200,
                  winsorizedMean: 200,
                  p50: 200,
                  robustMean: 200,
                  min: 100,
                  max: 300,
                  std: 100,
                  ciHalfWidth95: 113.16,
                  ciLow: 86.84,
                  ciHigh: 313.16,
                  confidence: 0.5,
                },
              },
            },
          ],
        }),
      },
      attachTo: document.body,
    });
    await wrapper.get('button').trigger('click');
    await flushPromises();

    const roundOrder = () =>
      wrapper.findAll('[data-per-round-table="player1"] tbody tr').map((row) => row.findAll('td')[0].text());
    const metricHeader = () => wrapper.get('[data-per-round-sort="encountersPerHour"]');
    const indicator = (button) => {
      const spans = button.findAll('span');
      return spans[spans.length - 1].text();
    };

    // 默认按轮次序；未激活列指示符为 <>。
    expect(roundOrder()).toEqual(['1', '2', '3', '4']);
    expect(indicator(metricHeader())).toBe('<>');

    // 第一次点击：降序（300 / 200 / 100），失败轮（缺失值）恒排末尾。
    await metricHeader().trigger('click');
    await flushPromises();
    expect(roundOrder()).toEqual(['2', '4', '1', '3']);
    expect(indicator(metricHeader())).toBe('v');

    // 第二次点击：升序（100 / 200 / 300），失败轮仍排末尾。
    await metricHeader().trigger('click');
    await flushPromises();
    expect(roundOrder()).toEqual(['1', '4', '2', '3']);
    expect(indicator(metricHeader())).toBe('^');

    // 第三次点击：恢复默认轮次序。
    await metricHeader().trigger('click');
    await flushPromises();
    expect(roundOrder()).toEqual(['1', '2', '3', '4']);
    expect(indicator(metricHeader())).toBe('<>');

    // Round 列同样可排序（降序 → 升序 → 复位）。
    const roundHeader = () => wrapper.get('[data-per-round-sort="round"]');
    await roundHeader().trigger('click');
    await flushPromises();
    expect(roundOrder()).toEqual(['4', '3', '2', '1']);

    wrapper.unmount();
  });
});

describe('HomeMultiRoundPanel per-round sorting template', () => {
  // 静态锚点：逐轮明细表头排序入口（与多轮结果页同一交互），防模板静默回退。
  // jsdom 下 Vite 会把字面量 new URL('...', import.meta.url) 静态转换为 http 资源 URL，
  // import.meta.url 本身仍是 file: —— 与 AdvisorPage.template.test.js 同惯例走项目根相对路径。
  const source = readFileSync(resolve(process.cwd(), 'src/ui/components/home/HomeMultiRoundPanel.vue'), 'utf8');

  it('routes every per-round header through togglePerRoundSort with indicators', () => {
    expect(source).toContain('data-per-round-sort="round"');
    expect(source).toContain('data-per-round-sort="seed"');
    expect(source).toContain(':data-per-round-sort="metric.key"');
    expect(source).toContain('@click="togglePerRoundSort(metric.key)"');
    expect(source).toContain('getPerRoundSortIndicator(metric.key)');
    expect(source).toContain('sortPerRoundRows(rows)');
  });
});

describe('SimulationResultsView multi-round wiring', () => {
  it('renders the panel only when results.multiRound.rounds >= 2', async () => {
    const simulator = useSimulatorStore();
    // Table 系列在应用入口全局注册，单测挂载时用透传 stub 替代（与 HomePage 行为测试同惯例）。
    const wrapper = mount(SimulationResultsView, {
      global: {
        stubs: {
          Table: passthroughStub,
          TableBody: passthroughStub,
          TableCell: passthroughStub,
          TableHead: passthroughStub,
          TableHeader: passthroughStub,
          TableRow: passthroughStub,
        },
      },
    });

    expect(wrapper.text()).not.toContain('Multi-round Statistics');

    simulator.results.multiRound = buildMultiRound({
      rounds: 1,
      failedCount: 0,
      perRound: [{ round: 1, seed: 111111, failed: false, error: '' }],
    });
    await nextTick();
    expect(wrapper.text()).not.toContain('Multi-round Statistics');

    simulator.results.multiRound = buildMultiRound();
    await nextTick();
    expect(wrapper.text()).toContain('Multi-round Statistics');

    simulator.results.multiRound = null;
    await nextTick();
    expect(wrapper.text()).not.toContain('Multi-round Statistics');

    wrapper.unmount();
  });
});

// @vitest-environment jsdom

// 审计【一般 4】（2026-08-31）：handleSoloImport 的官方估值计数行按格式门控——
// 原生格式（modern-solo / legacy-solo / modern-player-only）导出不携带市场字段，
// 恒 0 显示是误导性噪音，不再拼接；主站格式（存在市场透传通道）恒显示，
// 0 仍是透传故障 / 第 19 轮通道分离的预期反馈；载荷实际携带估值时无论格式显示。

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { initI18n } from '../i18n/i18n.js';
import HomeImportExportModal from '../components/home/HomeImportExportModal.vue';
import { useSimulatorStore } from '../../stores/simulatorStore.js';

beforeAll(async () => {
  localStorage.setItem('i18nextLng', 'en');
  await initI18n();
});

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});

function mountModal() {
  return mount(HomeImportExportModal, {
    props: { open: true, blockPlayerConfigReplacement: () => false },
    global: {
      stubs: {
        BaseModal: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
        Select: { template: '<div><slot /></div>' },
        SelectContent: { template: '<div><slot /></div>' },
        SelectItem: { template: '<div><slot /></div>' },
        SelectTrigger: true,
      },
    },
  });
}

async function runSoloImport(wrapper, importResult) {
  const simulator = useSimulatorStore();
  vi.spyOn(simulator, 'importSoloConfig').mockReturnValue(importResult);
  await wrapper.findAll('textarea')[1].setValue('{}');
  await wrapper
    .findAll('button')
    .find((button) => button.text() === 'Import To Player')
    .trigger('click');
}

async function runGroupImport(wrapper, importResult) {
  const simulator = useSimulatorStore();
  vi.spyOn(simulator, 'importGroupConfig').mockReturnValue(importResult);
  await wrapper.findAll('textarea')[0].setValue('{}');
  await wrapper
    .findAll('button')
    .find((button) => button.text() === 'Import Group')
    .trigger('click');
}

describe('HomeImportExportModal 官方估值计数门控（审计【一般 4】）', () => {
  it('原生格式（modern-solo）无市场数据：不拼接官方估值计数（恒 0 噪音消除）', async () => {
    const wrapper = mountModal();
    await runSoloImport(wrapper, { detectedFormat: 'modern-solo', marketItemValues: null });

    expect(wrapper.text()).toContain('Solo import success (modern-solo).');
    expect(wrapper.text()).not.toContain('Official estimates');
    wrapper.unmount();
  });

  it('原生格式（legacy-solo / modern-player-only）无市场数据：同样不拼接计数', async () => {
    const wrapper = mountModal();
    await runSoloImport(wrapper, { detectedFormat: 'legacy-solo' });
    expect(wrapper.text()).not.toContain('Official estimates');

    await runSoloImport(wrapper, { detectedFormat: 'modern-player-only' });
    expect(wrapper.text()).not.toContain('Official estimates');
    wrapper.unmount();
  });

  it('主站分享档案粘贴（main-site-share-profile）无市场数据：显示官方估值 0（第 19 轮通道分离预期反馈）', async () => {
    const wrapper = mountModal();
    await runSoloImport(wrapper, { detectedFormat: 'main-site-share-profile', marketItemValues: null });

    expect(wrapper.text()).toContain('Solo import success (main-site-share-profile).');
    expect(wrapper.text()).toContain('Official estimates: 0 items.');
    wrapper.unmount();
  });

  it('主站当前角色（main-site-current-character）：计数行恒显示（0 = 透传故障信号）', async () => {
    const wrapper = mountModal();
    await runSoloImport(wrapper, { detectedFormat: 'main-site-current-character' });

    expect(wrapper.text()).toContain('Official estimates: 0 items.');
    wrapper.unmount();
  });

  it('载荷实际携带估值（count > 0）：无论格式无条件显示计数', async () => {
    const wrapper = mountModal();
    await runSoloImport(wrapper, {
      detectedFormat: 'modern-solo',
      marketItemValues: { '/items/foo': { 0: 100, 1: 250 } },
    });

    expect(wrapper.text()).toContain('Official estimates: 1 items.');
    wrapper.unmount();
  });

  // N5 联动：载荷级来源标记 marketEstimateSource='synthetic'（主站脚本回落合成
  // 中价，脚本状态栏同批标注「合成中价估值已透传」）时，反馈切换为合成中价文案，
  // 与脚本侧一致；无标记保持官方估值文案（上一用例已锁定）。
  it('marketEstimateSource=synthetic：反馈切换为合成中价文案（与脚本状态栏一致）', async () => {
    const wrapper = mountModal();
    await runSoloImport(wrapper, {
      detectedFormat: 'main-site-current-character',
      marketItemValues: { '/items/foo': { 0: 100 }, '/items/bar': { 2: 300 } },
      marketEstimateSource: 'synthetic',
    });

    expect(wrapper.text()).toContain('Synthetic mid-price estimates: 2 items');
    expect(wrapper.text()).toContain('may differ from MWITools by ~4-5%');
    expect(wrapper.text()).not.toContain('Official estimates:');
    wrapper.unmount();
  });

  // #18（2026-08-31）：混合载荷（载荷级 official + syntheticItemHrids 清单）如实
  // 分列官方/合成中价计数，不再把合成部分整体报成官方估值（逐件真值不丢失）。
  it('混合载荷：反馈分列官方/合成中价计数', async () => {
    const wrapper = mountModal();
    await runSoloImport(wrapper, {
      detectedFormat: 'main-site-current-character',
      marketItemValues: { '/items/foo': { 0: 100 }, '/items/bar': { 2: 300 }, '/items/baz': { 0: 400 } },
      marketEstimateSource: 'official',
      syntheticItemHrids: ['/items/bar'],
    });

    expect(wrapper.text()).toContain('Official estimates: 2 items');
    expect(wrapper.text()).toContain('synthetic mid-price estimates: 1 items');
    expect(wrapper.text()).toContain('synthetic part not official');
    wrapper.unmount();
  });
});

// #40（2026-09-01）：组队导入与单人同样提取并应用 marketItemValues（mapper
// importGroupConfig / store applyImportedMarketItemValues），反馈复用同一门控
// helper——手注/未来载荷携带估值时组队侧不再静默应用零反馈。
describe('HomeImportExportModal 组队导入估值反馈对称（#40）', () => {
  it('modern-group 无市场数据：不拼接官方估值计数（与单人原生格式一致，噪音消除）', async () => {
    const wrapper = mountModal();
    await runGroupImport(wrapper, { detectedFormat: 'modern-group', marketItemValues: null });

    expect(wrapper.text()).toContain('Group import success (modern-group).');
    expect(wrapper.text()).not.toContain('Official estimates');
    wrapper.unmount();
  });

  it('modern-group 载荷携带估值（手注/未来载荷）：拼接官方估值计数，不再静默应用零反馈', async () => {
    const wrapper = mountModal();
    await runGroupImport(wrapper, {
      detectedFormat: 'modern-group',
      marketItemValues: { '/items/foo': { 0: 100, 1: 250 }, '/items/bar': { 0: 200 } },
    });

    expect(wrapper.text()).toContain('Group import success (modern-group).');
    expect(wrapper.text()).toContain('Official estimates: 2 items.');
    wrapper.unmount();
  });

  it('modern-group 载荷 marketEstimateSource=synthetic：切换合成中价文案（与单人对称）', async () => {
    const wrapper = mountModal();
    await runGroupImport(wrapper, {
      detectedFormat: 'modern-group',
      marketItemValues: { '/items/foo': { 0: 100 }, '/items/bar': { 2: 300 } },
      marketEstimateSource: 'synthetic',
    });

    expect(wrapper.text()).toContain('Synthetic mid-price estimates: 2 items');
    expect(wrapper.text()).not.toContain('Official estimates:');
    wrapper.unmount();
  });

  it('modern-group 混合载荷（official + syntheticItemHrids）：反馈分列官方/合成中价计数（#18 同语义）', async () => {
    const wrapper = mountModal();
    await runGroupImport(wrapper, {
      detectedFormat: 'modern-group',
      marketItemValues: { '/items/foo': { 0: 100 }, '/items/bar': { 2: 300 }, '/items/baz': { 0: 400 } },
      marketEstimateSource: 'official',
      syntheticItemHrids: ['/items/bar'],
    });

    expect(wrapper.text()).toContain('Official estimates: 2 items');
    expect(wrapper.text()).toContain('synthetic mid-price estimates: 1 items');
    expect(wrapper.text()).toContain('synthetic part not official');
    wrapper.unmount();
  });
});

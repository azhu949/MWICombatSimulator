// @vitest-environment jsdom

import { afterAll, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';

// 与 officialI18nIntegration.test.js 同款：把 localStorage 固定成一份内存实现，保证
// resolveInitialLanguage 读到「从未存过语言偏好」的干净状态（恒回落默认语言 zh）。
const storage = new Map();

vi.stubGlobal('localStorage', {
  getItem(key) {
    return storage.get(String(key)) ?? null;
  },
  setItem(key, value) {
    storage.set(String(key), String(value));
  },
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// getOfficialGameText 的显式 language 契约：目标语言未注册时开发期必须抛出，而不是静默
// 退化为 fallbackText / hrid（退化机制见 useGameDataText.js 与 i18n.js 的 fallbackLng: false）。
// i18next 是模块级单例，注册过的语言在整份模块注册表内永久有效；故每个用例都先
// resetModules 拿一份干净实例，否则前一个用例注册的 en 会让后续用例再也观察不到
// 「目标语言未注册」这一分支。
async function createExplicitLanguageHarness() {
  vi.resetModules();
  const i18nModule = await import('../../i18n/i18n.js');
  const { useGameDataText } = await import('../useGameDataText.js');

  let getOfficialGameText = null;
  const Host = defineComponent({
    render: () => null,
    setup() {
      ({ getOfficialGameText } = useGameDataText());
    },
  });
  // 必须在组件实例内取用 composable：useI18nText 在 setup 之外调用会注册不了生命周期钩子。
  const wrapper = mount(Host);

  return {
    wrapper,
    getOfficialGameText,
    initI18n: i18nModule.initI18n,
    ensureLanguageBundle: i18nModule.ensureLanguageBundle,
    i18next: i18nModule.default,
  };
}

describe('getOfficialGameText explicit language contract', () => {
  it('throws in dev when the explicit language is not registered yet', async () => {
    const { wrapper, getOfficialGameText, initI18n, i18next } = await createExplicitLanguageHarness();
    await initI18n();

    // 退化前提：默认 zh 会话下 en 语言包尚未懒加载，其 translation 资源不在 resources 中。
    expect(i18next.hasResourceBundle('en', 'translation')).toBe(false);

    expect(() =>
      getOfficialGameText('itemNames', '/items/gatherer_cape', '/items/gatherer_cape', { language: 'en' }),
    ).toThrow(/\[getOfficialGameText\]/);

    wrapper.unmount();
  });

  it('accepts an explicit language that is already registered', async () => {
    const { wrapper, getOfficialGameText, initI18n } = await createExplicitLanguageHarness();
    await initI18n();

    // zh 随主入口内联、init 时即已注册，故显式指定 zh 不触发契约断言，正常返回官方中文名。
    expect(getOfficialGameText('itemNames', '/items/gatherer_cape', '/items/gatherer_cape', { language: 'zh' })).toBe(
      '采集者披风',
    );

    wrapper.unmount();
  });

  it('resolves the official English name once the target language is registered', async () => {
    const { wrapper, getOfficialGameText, initI18n, ensureLanguageBundle, i18next } =
      await createExplicitLanguageHarness();
    await initI18n();
    await ensureLanguageBundle('en');
    expect(i18next.hasResourceBundle('en', 'translation')).toBe(true);

    expect(getOfficialGameText('itemNames', '/items/gatherer_cape', '/items/gatherer_cape', { language: 'en' })).toBe(
      'Gatherer Cape',
    );

    wrapper.unmount();
  });
});

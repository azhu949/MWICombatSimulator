// @vitest-environment jsdom

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import { useI18nText } from '../composables/useI18nText.js';
import i18next, { ensureLanguageBundle, initI18n } from '../i18n/i18n.js';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../components/ui/select/index.js';

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

describe('Select language refresh', () => {
  it('refreshes the selected label without reopening the menu', async () => {
    await initI18n();
    // en 语言包为懒加载，切换前先预载（产品路径 useI18nText.setLanguage 内部已做这一步）。
    await ensureLanguageBundle('en');
    await i18next.changeLanguage('en');
    const Host = defineComponent({
      components: { Select, SelectContent, SelectItem, SelectTrigger },
      setup() {
        const selected = ref('strict');
        const { language } = useI18nText();
        return { language, selected };
      },
      template: `
        <Select v-model="selected">
          <SelectTrigger aria-label="Scoring mode" />
          <SelectContent>
            <SelectItem value="strict">{{ language === "zh" ? "严格" : "Strict" }}</SelectItem>
          </SelectContent>
        </Select>
      `,
    });
    const wrapper = mount(Host, { attachTo: document.body });
    await flushPromises();

    expect(wrapper.get('[data-slot="select-trigger"]').text()).toContain('Strict');
    await i18next.changeLanguage('zh');
    await flushPromises();
    expect(wrapper.get('[data-slot="select-trigger"]').text()).toContain('严格');

    wrapper.unmount();
    document.body.innerHTML = '';
    await i18next.changeLanguage('en');
  });
});

describe('Initial locale bundle failure', () => {
  it('falls back to the default language when the initial bundle fails to load', async () => {
    // 重新加载模块得到未被 init 污染的 i18n 实例，并把语言包加载器替换为必然失败。
    vi.resetModules();
    vi.doMock('../i18n/localeBundles.js', () => ({
      DEFAULT_LANGUAGE: 'zh',
      loadLocaleBundle: vi.fn().mockRejectedValue(new Error('locale bundle unavailable')),
    }));
    localStorage.setItem('i18nextLng', 'en');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const freshI18n = await import('../i18n/i18n.js');
    await expect(freshI18n.initI18n()).resolves.toBeDefined();
    expect(freshI18n.default.language).toBe('zh');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('falling back'), expect.any(Error));

    warnSpy.mockRestore();
    localStorage.removeItem('i18nextLng');
    vi.doUnmock('../i18n/localeBundles.js');
    vi.resetModules();
  });
});

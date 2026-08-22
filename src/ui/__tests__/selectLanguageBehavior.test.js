// @vitest-environment jsdom

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import { useI18nText } from '../composables/useI18nText.js';
import i18next, { initI18n } from '../i18n/i18n.js';
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

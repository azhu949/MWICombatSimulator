// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import PatchNotesPage from '../pages/PatchNotesPage.vue';
import i18next, { ensureLanguageBundle, initI18n } from '../i18n/i18n.js';
import { loadPatchNoteCatalog } from '../patchNotes.js';

// jsdom 无原生 IntersectionObserver，用可手动触发回调的 stub 捕获实例，
// 以便直接驱动 scroll-spy 的可见性状态。
let observerInstance = null;
let scrollIntoViewMock = null;

class IntersectionObserverStub {
  constructor(callback) {
    this.callback = callback;
    this.observed = [];
    observerInstance = this;
  }

  observe(target) {
    this.observed.push(target);
  }

  unobserve(target) {
    this.observed = this.observed.filter((item) => item !== target);
  }

  disconnect() {
    this.observed = [];
  }

  trigger(entries) {
    this.callback(entries, this);
  }
}

beforeAll(async () => {
  await initI18n();
  // 预热补丁目录：真实启动中由 App 先行加载，页面随后进入时命中缓存；
  // 测试里预载可避免首个用例与动态 import 冷启动的时序竞争。
  await loadPatchNoteCatalog();
  vi.stubGlobal('IntersectionObserver', IntersectionObserverStub);
  scrollIntoViewMock = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoViewMock,
  });
});

afterAll(() => {
  // 还原 beforeAll 对 HTMLElement.prototype 的改写，保持测试独立性
  // （vi.unstubAllGlobals 只还原 vi.stubGlobal 的全局，不覆盖 defineProperty）。
  delete HTMLElement.prototype.scrollIntoView;
});

afterEach(() => {
  observerInstance = null;
  scrollIntoViewMock?.mockClear();
  document.body.innerHTML = '';
});

describe('PatchNotesPage scroll-spy behavior', () => {
  it('highlights the first entry on initial mount', async () => {
    const wrapper = mount(PatchNotesPage, { attachTo: document.body });
    await flushPromises();

    const buttons = wrapper.findAll('button');
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons[0].classes()).toContain('bg-primary/10');
    expect(buttons[1].classes()).not.toContain('bg-primary/10');

    wrapper.unmount();
  });

  it('scrolls to and highlights the clicked entry', async () => {
    const wrapper = mount(PatchNotesPage, { attachTo: document.body });
    await flushPromises();

    const buttons = wrapper.findAll('button');
    await buttons[1].trigger('click');

    expect(scrollIntoViewMock).toHaveBeenCalled();
    expect(buttons[1].classes()).toContain('bg-primary/10');
    expect(buttons[0].classes()).not.toContain('bg-primary/10');

    wrapper.unmount();
  });

  it('updates the active entry from the observer callback as the topmost visible card', async () => {
    const wrapper = mount(PatchNotesPage, { attachTo: document.body });
    await flushPromises();

    const articles = wrapper.findAll('article');
    expect(articles.length).toBeGreaterThanOrEqual(2);

    // 第一个卡片不可见、第二个可见 → 高亮应切换到第二个（文档序最靠前的可见卡片）
    observerInstance.trigger([
      { target: articles[0].element, isIntersecting: false },
      { target: articles[1].element, isIntersecting: true },
    ]);
    await nextTick();

    const buttons = wrapper.findAll('button');
    expect(buttons[1].classes()).toContain('bg-primary/10');
    expect(buttons[0].classes()).not.toContain('bg-primary/10');

    wrapper.unmount();
  });

  it('clears the active highlight when no card is visible', async () => {
    const wrapper = mount(PatchNotesPage, { attachTo: document.body });
    await flushPromises();

    const articles = wrapper.findAll('article');
    observerInstance.trigger(articles.map((article) => ({ target: article.element, isIntersecting: false })));
    await nextTick();

    const buttons = wrapper.findAll('button');
    for (const button of buttons) {
      expect(button.classes()).not.toContain('bg-primary/10');
    }

    wrapper.unmount();
  });
});

describe('PatchNotesPage language switch behavior', () => {
  it('re-resolves entry texts after the language switches', async () => {
    const wrapper = mount(PatchNotesPage, { attachTo: document.body });
    await flushPromises();

    // 期望值从目录推导，避免每次发版都要改动测试（与 patchNotes.test.js 同一约定）。
    const catalog = await loadPatchNoteCatalog();
    const latestEntryId = Object.keys(catalog)[0];
    const zhLabel = catalog[latestEntryId].label.zh;
    const enLabel = catalog[latestEntryId].label.en;

    const firstTitle = () => wrapper.findAll('article h3')[0].text();
    expect(firstTitle()).toBe(zhLabel);

    await ensureLanguageBundle('en');
    await i18next.changeLanguage('en');
    await flushPromises();
    await nextTick();
    expect(firstTitle()).toBe(enLabel);

    // 恢复默认语言，保持与其它 scroll-spy 用例的隔离。
    await i18next.changeLanguage('zh');
    await flushPromises();
    await nextTick();
    expect(firstTitle()).toBe(zhLabel);

    wrapper.unmount();
  });
});

import { afterAll, describe, expect, it, vi } from 'vitest';

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

describe('ensureLanguageBundle before init', () => {
  it('initializes i18next and injects the resolved bundle before switching language', async () => {
    // 重置模块注册表，拿到尚未 init 的干净实例，真实覆盖「init 之前调用」这一分支。
    vi.resetModules();
    const i18nModule = await import('../i18n.js');
    const i18next = i18nModule.default;

    // i18next 首次 init 完成前不会给 isInitialized 赋值（保持 undefined），故按 falsy 断言。
    expect(i18next.isInitialized).toBeFalsy();

    // 契约：无前置条件——调用方无需先 init，ensureLanguageBundle 自行完成 init 再注入资源。
    await i18nModule.ensureLanguageBundle('en');

    expect(i18next.isInitialized).toBe(true);
    expect(i18next.hasResourceBundle('en', 'common')).toBe(true);
    expect(i18next.hasResourceBundle('en', 'translation')).toBe(true);

    await i18next.changeLanguage('en');
    expect(i18next.t('common:menu.enhancement')).toBe('Enhancement');
  });

  it('stays idempotent when the same language is ensured repeatedly', async () => {
    const i18nModule = await import('../i18n.js');
    const i18next = i18nModule.default;

    await expect(i18nModule.ensureLanguageBundle('en')).resolves.toBeUndefined();
    await expect(i18nModule.ensureLanguageBundle('en')).resolves.toBeUndefined();

    expect(i18next.hasResourceBundle('en', 'common')).toBe(true);
    expect(i18next.hasResourceBundle('en', 'translation')).toBe(true);
  });
});

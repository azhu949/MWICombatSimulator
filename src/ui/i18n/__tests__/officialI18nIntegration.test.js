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

describe('official i18n snapshot integration', () => {
  it('defaults to Chinese and switches between exact official names', async () => {
    const { initI18n, resolveInitialLanguage } = await import('../i18n.js');
    const i18next = await initI18n();

    expect(resolveInitialLanguage()).toBe('zh');
    expect(resolveInitialLanguage('en')).toBe('en');
    expect(i18next.language).toBe('zh');
    expect(i18next.t('translation:itemNames./items/gatherer_cape')).toBe('采集者披风');
    expect(i18next.t('translation:itemNames./items/gatherer_cape_refined')).toBe('采集者披风 ★');
    expect(i18next.t('common:menu.enhancement')).toBe('强化模拟');

    await i18next.changeLanguage('en');
    expect(i18next.t('translation:itemNames./items/gatherer_cape')).toBe('Gatherer Cape');
    expect(i18next.t('common:menu.enhancement')).toBe('Enhancement');
  });
});

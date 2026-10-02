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

// 缺键用例专用的哨兵键：这两个键必须不存在于任何语言包，故调用参数由变量承载，
// 避免被 i18nResources 的「字面 common: 键必须可解析」扫描当作漏键。
const MISSING_KEY = 'common:__missing_key__';
const EN_ONLY_KEY = 'common:__en_only_key__';

describe('official i18n snapshot integration', () => {
  it('defaults to Chinese and switches between exact official names', async () => {
    const { ensureLanguageBundle, initI18n, resolveInitialLanguage } = await import('../i18n.js');
    const i18next = await initI18n();

    expect(resolveInitialLanguage()).toBe('zh');
    expect(resolveInitialLanguage('en')).toBe('en');
    expect(i18next.language).toBe('zh');
    // 懒加载契约：默认语言 zh 随 init 内联；en 在未被请求前不进入 resources（首屏不带 en 语言包）。
    expect(i18next.hasResourceBundle('en', 'common')).toBe(false);
    expect(i18next.t('translation:itemNames./items/gatherer_cape')).toBe('采集者披风');
    expect(i18next.t('translation:itemNames./items/gatherer_cape_refined')).toBe('采集者披风 ★');
    expect(i18next.t('common:menu.enhancement')).toBe('强化模拟');
    // 缺键契约：zh 会话下 en 未注册，缺键既不回退英文也不返回空串，而是原样返回
    // 去掉命名空间前缀的 key；调用方兜底文案（useI18nText.t 的 defaultValue）才是最终展示内容。
    expect(i18next.t(MISSING_KEY)).toBe('__missing_key__');
    expect(i18next.t(MISSING_KEY, { defaultValue: 'Fallback copy' })).toBe('Fallback copy');

    // 语言切换前必须先预载目标语言包（产品路径见 useI18nText.setLanguage）；重复预载幂等。
    await ensureLanguageBundle('en');
    await ensureLanguageBundle('en');
    expect(i18next.hasResourceBundle('en', 'common')).toBe(true);
    await i18next.changeLanguage('en');
    expect(i18next.t('translation:itemNames./items/gatherer_cape')).toBe('Gatherer Cape');
    expect(i18next.t('common:menu.enhancement')).toBe('Enhancement');

    // 切回中文后，即使 en 已在 resources 中，缺键也不跨语言回退（fallbackLng 已显式关闭）。
    await i18next.changeLanguage('zh');
    expect(i18next.t(MISSING_KEY)).toBe('__missing_key__');
    // 下面这条可判别：仅 en 存在的键在中文会话仍原样返回 key；若保留 fallbackLng: 'en'
    // 则会返回英文文案，故本用例真正守住这次语义收窄。
    i18next.addResource('en', 'common', '__en_only_key__', 'English only copy');
    expect(i18next.t(EN_ONLY_KEY)).toBe('__en_only_key__');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import enCommon from '../../../locales/en/common.json';
import zhCommon from '../../../locales/zh/common.json';

const appSource = readFileSync(new URL('../App.vue', import.meta.url), 'utf8');
const indicatorSource = readFileSync(new URL('../components/MarketPriceIndicator.vue', import.meta.url), 'utf8');
const presentationSource = readFileSync(new URL('../marketPriceStatusPresentation.js', import.meta.url), 'utf8');

describe('MarketPriceIndicator shell contracts', () => {
  it('mounts the market price indicator in the global header before the theme toggle', () => {
    expect(appSource).toContain("import MarketPriceIndicator from './components/MarketPriceIndicator.vue';");
    expect(appSource).toContain('<MarketPriceIndicator />');
    const indicatorIndex = appSource.indexOf('<MarketPriceIndicator />');
    const themeToggleIndex = appSource.indexOf(':aria-label="themeToggleAriaLabel"');
    expect(indicatorIndex).toBeGreaterThan(-1);
    expect(themeToggleIndex).toBeGreaterThan(indicatorIndex);
  });

  it('keeps the widget self-contained on the simulator store with a visible refresh affordance', () => {
    expect(indicatorSource).toContain('useSimulatorStore');
    expect(indicatorSource).toContain('data-market-price-indicator');
    expect(indicatorSource).toContain(':disabled="isLoading"');
    expect(indicatorSource).toContain(':aria-label="ariaLabelText"');
    expect(indicatorSource).toContain(':title="titleText"');
    expect(indicatorSource).toContain('data-market-price-indicator');
  });

  it('announces refresh state changes via an off-screen live region', () => {
    // 失败 / 加载状态必须可被辅助技术感知：按钮 aria-label 会遮蔽内部文本，
    // live region 必须位于按钮之外（role="status" 隐含 aria-live="polite"），
    // 且播报文本不得依赖随 60s tick 变化的相对年龄（避免读屏周期性轰炸）。
    expect(indicatorSource).toContain('role="status"');
    expect(indicatorSource).toContain('liveAnnouncementText');
    expect(indicatorSource).toContain(':aria-busy="isLoading"');
    // 播报与可见文本均需直接表达失败态，不能只靠颜色 + title。
    expect(indicatorSource).toContain('refreshFailedText.value');
  });

  it('forces a real fetch on click and guards it with the shared 60s cooldown', () => {
    expect(indicatorSource).toContain('MARKET_PRICE_REFRESH_ATTEMPT_COOLDOWN_MS');
    expect(indicatorSource).toContain('ensureMarketPricesLoaded(true)');
    // 点击先查 isLoading，加载中一律忽略点击。
    expect(indicatorSource).toMatch(/async function handleRefresh\(\) \{\s*if \(isLoading\.value\) \{/);
  });

  it('starts the cooldown only after a successful refresh so failures can retry immediately', () => {
    // 冷却时间戳必须落在 await 之后、且仅在成功分支内赋值；失败分支只点亮失败标记。
    const awaitIndex = indicatorSource.indexOf('const result = await simulator.ensureMarketPricesLoaded(true);');
    const successAssignIndex = indicatorSource.indexOf('lastRefreshClickAt = Date.now();');
    expect(awaitIndex).toBeGreaterThan(-1);
    expect(successAssignIndex).toBeGreaterThan(awaitIndex);
    expect(indicatorSource).toContain('refreshFailed.value = true');
  });

  it('ticks relative age display only (no background market fetching)', () => {
    expect(indicatorSource).toContain('60_000');
    // 展示组件不得自行拉取行情：唯一数据动作是用户点击触发的 ensureMarketPricesLoaded(true)。
    expect(indicatorSource.match(/ensureMarketPricesLoaded/g)).toHaveLength(1);
  });

  it('derives freshness from the shared 90-minute snapshot window', () => {
    expect(presentationSource).toContain('MARKET_PRICE_SNAPSHOT_MAX_AGE_MS');
    expect(indicatorSource).toContain('resolveMarketSnapshotStatus');
  });

  it('references only English fallbacks inside the component script', () => {
    // i18nResources 契约（fallback 全英文）在组件级冗余校验，避免个别字符串漏网。
    const cjk = /[\u3000-\u303F\u4E00-\u9FFF\uFF00-\uFFEF]/;
    const fallbackStrings = [...indicatorSource.matchAll(/FALLBACK_[A-Z_]+ = '([^']*)'/g)].map((match) => match[1]);
    expect(fallbackStrings.length).toBeGreaterThan(0);
    for (const fallback of fallbackStrings) {
      expect(cjk.test(fallback)).toBe(false);
    }
  });

  it('keeps the marketPrice key family synchronized across locales', () => {
    const marketKeys = (common) => Object.keys(common?.vue?.app || {}).filter((key) => key.startsWith('marketPrice'));
    expect(marketKeys(enCommon).sort()).toEqual(marketKeys(zhCommon).sort());
    expect(marketKeys(enCommon).length).toBeGreaterThanOrEqual(11);
    expect(zhCommon?.vue?.app?.marketPriceMinutesAgo).toContain('{{count}}');
    expect(enCommon?.vue?.app?.marketPriceMinutesAgo).toContain('{{count}}');
    expect(zhCommon?.vue?.app?.marketPriceMissing).toBe('未获取市场数据');
    expect(enCommon?.vue?.app?.marketPriceMissing).toBe('No market data');
  });
});

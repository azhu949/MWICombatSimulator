import { describe, expect, it } from 'vitest';
import {
  MARKET_SNAPSHOT_STATE_FRESH,
  MARKET_SNAPSHOT_STATE_MISSING,
  MARKET_SNAPSHOT_STATE_STALE,
  buildMarketPriceAgeText,
  formatMarketSnapshotTime,
  resolveMarketSnapshotStatus,
} from '../marketPriceStatusPresentation.js';
import { MARKET_PRICE_SNAPSHOT_MAX_AGE_MS } from '../../services/marketPriceService.js';

const NOW_MS = 1_800_000_000_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function secondsAgo(ageMs) {
  return Math.floor((NOW_MS - ageMs) / 1000);
}

// 记录型假翻译：断言键、英文兜底与插值参数，不依赖 i18next 初始化。
function recordingTranslate(key, fallback, options) {
  return { key, fallback, options };
}

describe('resolveMarketSnapshotStatus', () => {
  it('treats zero, negative, and non-numeric timestamps as missing', () => {
    for (const value of [0, -5, NaN, undefined, null, 'abc']) {
      const status = resolveMarketSnapshotStatus(value, NOW_MS);
      expect(status.state).toBe(MARKET_SNAPSHOT_STATE_MISSING);
      expect(status.ageMs).toBe(0);
    }
  });

  it('marks snapshots within the shared 90-minute window as fresh', () => {
    const status = resolveMarketSnapshotStatus(secondsAgo(MARKET_PRICE_SNAPSHOT_MAX_AGE_MS - 1000), NOW_MS);
    expect(status.state).toBe(MARKET_SNAPSHOT_STATE_FRESH);
    expect(status.ageMs).toBe(MARKET_PRICE_SNAPSHOT_MAX_AGE_MS - 1000);
  });

  it('keeps the exact max-age boundary fresh (inclusive comparison)', () => {
    const status = resolveMarketSnapshotStatus(secondsAgo(MARKET_PRICE_SNAPSHOT_MAX_AGE_MS), NOW_MS);
    expect(status.state).toBe(MARKET_SNAPSHOT_STATE_FRESH);
  });

  it('marks snapshots beyond the window as stale', () => {
    const status = resolveMarketSnapshotStatus(secondsAgo(MARKET_PRICE_SNAPSHOT_MAX_AGE_MS + MINUTE_MS), NOW_MS);
    expect(status.state).toBe(MARKET_SNAPSHOT_STATE_STALE);
    expect(status.ageMs).toBe(MARKET_PRICE_SNAPSHOT_MAX_AGE_MS + MINUTE_MS);
  });

  it('treats in-window future timestamps as fresh with a clamped zero age', () => {
    const futureTimestampSeconds = Math.floor(NOW_MS / 1000) + 300;
    const status = resolveMarketSnapshotStatus(futureTimestampSeconds, NOW_MS);
    expect(status.state).toBe(MARKET_SNAPSHOT_STATE_FRESH);
    expect(status.ageMs).toBe(0);
  });

  it('marks far-future timestamps beyond the window as stale (same semantics as isMarketPriceSnapshotFresh)', () => {
    // 时钟大幅偏慢/时间戳损坏：未来偏移超 90 分钟窗口判 stale（与 store 的
    // Math.abs 口径一致），ageMs 仍 clamp 为 0 供相对文案使用。
    const farFutureTimestampSeconds = Math.floor(NOW_MS / 1000) + (2 * HOUR_MS) / 1000;
    const status = resolveMarketSnapshotStatus(farFutureTimestampSeconds, NOW_MS);
    expect(status.state).toBe(MARKET_SNAPSHOT_STATE_STALE);
    expect(status.ageMs).toBe(0);
  });

  it('honors a custom max age override', () => {
    const status = resolveMarketSnapshotStatus(secondsAgo(30 * MINUTE_MS), NOW_MS, 10 * MINUTE_MS);
    expect(status.state).toBe(MARKET_SNAPSHOT_STATE_STALE);
  });
});

describe('buildMarketPriceAgeText', () => {
  it('uses the just-now bucket below one minute', () => {
    const result = buildMarketPriceAgeText(secondsAgo(30_000), NOW_MS, recordingTranslate);
    expect(result.key).toBe('common:vue.app.marketPriceJustNow');
    expect(result.fallback).toBe('Just now');
    expect(result.options).toEqual({});
  });

  it('buckets sub-hour ages into minutes with the elapsed count', () => {
    const result = buildMarketPriceAgeText(secondsAgo(23 * MINUTE_MS), NOW_MS, recordingTranslate);
    expect(result.key).toBe('common:vue.app.marketPriceMinutesAgo');
    expect(result.fallback).toBe('{{count}} min ago');
    expect(result.options).toEqual({ count: 23 });
  });

  it('buckets sub-day ages into hours', () => {
    const result = buildMarketPriceAgeText(secondsAgo(5 * HOUR_MS + 30 * MINUTE_MS), NOW_MS, recordingTranslate);
    expect(result.key).toBe('common:vue.app.marketPriceHoursAgo');
    expect(result.options).toEqual({ count: 5 });
  });

  it('buckets older ages into days', () => {
    const result = buildMarketPriceAgeText(secondsAgo(3 * DAY_MS + 2 * HOUR_MS), NOW_MS, recordingTranslate);
    expect(result.key).toBe('common:vue.app.marketPriceDaysAgo');
    expect(result.options).toEqual({ count: 3 });
  });

  it('shows just-now for future timestamps instead of negative ages', () => {
    const futureTimestampSeconds = Math.floor(NOW_MS / 1000) + 120;
    const result = buildMarketPriceAgeText(futureTimestampSeconds, NOW_MS, recordingTranslate);
    expect(result.key).toBe('common:vue.app.marketPriceJustNow');
  });

  it('keeps just-now for far-future timestamps even when the snapshot state is stale', () => {
    // 相对文案不出现负岁龄：远未来（status 已判 stale）仍按 0 岁龄显示「刚刚」，
    // 异常由指示器着色与绝对时间 tooltip 呈现。
    const farFutureTimestampSeconds = Math.floor(NOW_MS / 1000) + (2 * HOUR_MS) / 1000;
    const result = buildMarketPriceAgeText(farFutureTimestampSeconds, NOW_MS, recordingTranslate);
    expect(result.key).toBe('common:vue.app.marketPriceJustNow');
  });

  it('falls back to the English fallback string when translate is unavailable', () => {
    expect(buildMarketPriceAgeText(secondsAgo(2 * MINUTE_MS), NOW_MS, null)).toBe('2 min ago');
  });
});

describe('formatMarketSnapshotTime', () => {
  it('returns an empty string for missing timestamps', () => {
    expect(formatMarketSnapshotTime(0)).toBe('');
    expect(formatMarketSnapshotTime(-100)).toBe('');
    expect(formatMarketSnapshotTime(NaN)).toBe('');
  });

  it('formats a valid timestamp as a non-empty localized string', () => {
    const text = formatMarketSnapshotTime(secondsAgo(HOUR_MS), 'zh-CN');
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/\d/);
  });

  it('falls back to toLocaleString when the locale tag is invalid', () => {
    const text = formatMarketSnapshotTime(secondsAgo(HOUR_MS), 'not-a-locale');
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });
});

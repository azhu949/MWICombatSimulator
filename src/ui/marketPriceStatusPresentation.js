import { MARKET_PRICE_SNAPSHOT_MAX_AGE_MS } from '../services/marketPriceService.js';

// 行情快照三态：missing=从未获取（marketTimestamp=0）、fresh=官方快照仍在
// MARKET_PRICE_SNAPSHOT_MAX_AGE_MS（90 分钟）新鲜窗口内、stale=超出窗口。
// 与 simulatorPricingActions.isMarketPriceSnapshotFresh 同口径（新鲜度按
// Math.abs 绝对偏差判定：未来偏移超窗的病态时间戳同样判 stale），供 header
// 行情指示器（MarketPriceIndicator.vue）着色与提示文案使用。
export const MARKET_SNAPSHOT_STATE_MISSING = 'missing';
export const MARKET_SNAPSHOT_STATE_FRESH = 'fresh';
export const MARKET_SNAPSHOT_STATE_STALE = 'stale';

// 相对时间 i18n 键与英文兜底（fallback 统一英文，见 i18nResources 契约测试；
// 含 {{count}} 插值的兜底串必须放在 JS 常量里，禁止内联进 .vue 模板）。
const AGE_TEXT_KEYS = {
  justNow: { key: 'common:vue.app.marketPriceJustNow', fallback: 'Just now' },
  minutes: { key: 'common:vue.app.marketPriceMinutesAgo', fallback: '{{count}} min ago' },
  hours: { key: 'common:vue.app.marketPriceHoursAgo', fallback: '{{count}} h ago' },
  days: { key: 'common:vue.app.marketPriceDaysAgo', fallback: '{{count}} d ago' },
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// 无翻译函数时的英文兜底插值（如 "Just now"/"23 min ago"）：
// 仅替换 {{name}} 占位符，未知占位符原样保留，避免裸模板外泄。
function interpolateFallback(template, values) {
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(values || {}, name) ? String(values[name]) : match,
  );
}

function translateAgeText(translate, bucket, values) {
  const { key, fallback } = AGE_TEXT_KEYS[bucket];
  if (typeof translate !== 'function') {
    return interpolateFallback(fallback, values);
  }
  return translate(key, fallback, values);
}

// 判定官方行情快照的新鲜度状态。marketTimestampSeconds 为官方 marketplace.json
// 的秒级时间戳。新鲜度按 Math.abs 绝对偏差判定（与
// simulatorPricingActions.isMarketPriceSnapshotFresh 同口径）：未来偏移超出
// 90 分钟窗口（本机时钟大幅偏慢/时间戳损坏）同样判 stale；窗口内的轻微未来
// 偏移视为 fresh。ageMs 为展示用岁龄，单向 clamp ≥0（相对文案不出现负数）。
export function resolveMarketSnapshotStatus(
  marketTimestampSeconds,
  nowMs = Date.now(),
  maxAgeMs = MARKET_PRICE_SNAPSHOT_MAX_AGE_MS,
) {
  const timestampSeconds = Math.max(0, Math.floor(Number(marketTimestampSeconds) || 0));
  if (timestampSeconds <= 0) {
    return { state: MARKET_SNAPSHOT_STATE_MISSING, ageMs: 0 };
  }
  const rawDeltaMs = Number(nowMs) - timestampSeconds * 1000;
  // 新鲜度按绝对偏差判定（未来超窗的病态时间戳同样 stale，与 store 同口径）；
  // ageMs 为展示岁龄，单向 clamp ≥0——未来偏移按 0 岁龄显示而非负数。
  const state =
    Math.abs(rawDeltaMs) <= Math.max(0, Number(maxAgeMs) || 0)
      ? MARKET_SNAPSHOT_STATE_FRESH
      : MARKET_SNAPSHOT_STATE_STALE;
  return { state, ageMs: Math.max(0, rawDeltaMs) };
}

// 相对岁龄文案（"刚刚 / N 分钟前 / N 小时前 / N 天前"）：
// <1 分钟 → justNow；<1 小时 → 分钟；<24 小时 → 小时；其余 → 天。
export function buildMarketPriceAgeText(marketTimestampSeconds, nowMs = Date.now(), translate) {
  const { ageMs } = resolveMarketSnapshotStatus(marketTimestampSeconds, nowMs, Number.POSITIVE_INFINITY);
  if (ageMs < MINUTE_MS) {
    return translateAgeText(translate, 'justNow', {});
  }
  if (ageMs < HOUR_MS) {
    return translateAgeText(translate, 'minutes', { count: Math.floor(ageMs / MINUTE_MS) });
  }
  if (ageMs < DAY_MS) {
    return translateAgeText(translate, 'hours', { count: Math.floor(ageMs / HOUR_MS) });
  }
  return translateAgeText(translate, 'days', { count: Math.floor(ageMs / DAY_MS) });
}

// 绝对时间文案（tooltip 用）：按显示语言本地化；无效时间戳返回空串由调用方兜底。
export function formatMarketSnapshotTime(marketTimestampSeconds, locale = 'zh-CN') {
  const timestampSeconds = Math.max(0, Math.floor(Number(marketTimestampSeconds) || 0));
  if (timestampSeconds <= 0) {
    return '';
  }
  const date = new Date(timestampSeconds * 1000);
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

<template>
  <!-- relative 祖先必须存在：sr-only 播报节点是绝对定位，否则包含块落到 BODY 撑大文档。 -->
  <div class="relative inline-flex shrink-0">
    <span class="sr-only" role="status">{{ liveAnnouncementText }}</span>
    <Button
      type="button"
      variant="ghost"
      size="sm"
      :aria-label="ariaLabelText"
      :aria-busy="isLoading"
      :title="titleText"
      :disabled="isLoading"
      data-market-price-indicator
      @click="handleRefresh"
    >
      <span class="inline-flex" :class="iconToneClass" aria-hidden="true">
        <LoaderCircle v-if="isLoading" class="animate-spin" />
        <RefreshCw v-else />
      </span>
      <span class="hidden sm:inline" :class="textToneClass">{{ statusText }}</span>
    </Button>
  </div>
</template>

<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { LoaderCircle, RefreshCw } from '@lucide/vue';
import { Button } from './ui/button/index.js';
import { useSimulatorStore } from '../../stores/simulatorStore.js';
import { useI18nText } from '../composables/useI18nText.js';
import { MARKET_PRICE_REFRESH_ATTEMPT_COOLDOWN_MS } from '../../services/marketPriceService.js';
import {
  MARKET_SNAPSHOT_STATE_MISSING,
  MARKET_SNAPSHOT_STATE_STALE,
  buildMarketPriceAgeText,
  formatMarketSnapshotTime,
  resolveMarketSnapshotStatus,
} from '../marketPriceStatusPresentation.js';

// i18n fallback 常量：统一英文兜底（i18nResources 契约测试要求），且全部放在
// <script setup> 内——模板内联 t() fallback 一旦携带特殊字符易被 Vue 模板编译器
// 误解析（见项目约定：插值类 fallback 必须以 JS 字符串定义）。
const FALLBACK_ARIA_LABEL = 'Refresh market prices';
const FALLBACK_LABEL = 'Market data';
const FALLBACK_MISSING = 'No market data';
const FALLBACK_REFRESHING = 'Refreshing market data…';
const FALLBACK_DATA_TIME = 'Market data time';
const FALLBACK_STALE = 'Snapshot is outdated, refresh recommended';
const FALLBACK_REFRESH_FAILED = 'Refresh failed';

const RELATIVE_TICK_INTERVAL_MS = 60_000;

const simulator = useSimulatorStore();
const { language, t } = useI18nText();

// 展示层的「当前时刻」：每分钟自跳一次驱动相对时间文案刷新（纯展示，不触发
// 任何行情请求）；快照时间变化（拉取成功）时立即对齐，避免旧岁龄闪一帧。
const nowTick = ref(Date.now());
const relativeTickTimer = setInterval(() => {
  nowTick.value = Date.now();
}, RELATIVE_TICK_INTERVAL_MS);
onUnmounted(() => {
  clearInterval(relativeTickTimer);
});

// 手动刷新失败标记：仅在用户主动点击刷新且确实失败时点亮；新数据到达
// （marketTimestamp/lastFetchedAt 变化）或再次点击时清除，避免旧错误常驻 tooltip。
const refreshFailed = ref(false);
// 后台失败信号（store 真值）：pricing.error 仅在「最近一次已开始的行情拉取失败」
// 后非空——每次拉取开始时同步清空、成功不置位、不持久化（createPricingState 恒 ''）。
// 启动延迟初始化（App.runDeferredInitialization）/队列扫描快照等非点击路径失败时
// 本地标记不会点亮，widget 必须直接消费该真值，否则后台失败完全不可见
// （用户只能看到琥珀「未获取市场数据」或旧快照岁龄，无从得知失败过）。
const hasStoreRefreshError = computed(() => Boolean(String(simulator.pricing?.error || '').trim()));
// 展示层统一失败信号：手动失败标记或 store 后台失败任一为真即点亮失败展示
// （可见文本 / 着色 / title / live region 共用）；下一次拉取开始清 error 时自动退场。
const hasFailureSignal = computed(() => refreshFailed.value || hasStoreRefreshError.value);
// 上次「成功」刷新的时间戳：冷却只对成功生效，失败后不进入冷却（可立即重试）。
let lastRefreshClickAt = 0;

const isLoading = computed(() => Boolean(simulator.pricing?.isLoading));
const marketTimestampSeconds = computed(() => Math.max(0, Math.floor(Number(simulator.pricing?.marketTimestamp) || 0)));
const snapshotStatus = computed(() => resolveMarketSnapshotStatus(marketTimestampSeconds.value, nowTick.value));
const isStale = computed(() => snapshotStatus.value.state === MARKET_SNAPSHOT_STATE_STALE);
const isMissing = computed(() => snapshotStatus.value.state === MARKET_SNAPSHOT_STATE_MISSING);

const localeTag = computed(() => (language.value === 'zh' ? 'zh-CN' : 'en-US'));
const absoluteTimeText = computed(() => formatMarketSnapshotTime(marketTimestampSeconds.value, localeTag.value));
const ageText = computed(() => buildMarketPriceAgeText(marketTimestampSeconds.value, nowTick.value, t));

const label = computed(() => t('common:vue.app.marketPriceLabel', FALLBACK_LABEL));
const missingText = computed(() => t('common:vue.app.marketPriceMissing', FALLBACK_MISSING));
const refreshingText = computed(() => t('common:vue.app.marketPriceRefreshing', FALLBACK_REFRESHING));
const refreshFailedText = computed(() => t('common:vue.app.marketPriceRefreshFailed', FALLBACK_REFRESH_FAILED));
// 失败文案 + 错误详情的单一事实来源：title 与 aria-live 播报共用，避免两处拼接逻辑漂移。
const refreshFailedDetailText = computed(() => {
  const errorDetail = String(simulator.pricing?.error || '').trim();
  return `${refreshFailedText.value}${errorDetail ? ` (${errorDetail})` : ''}`;
});

const statusText = computed(() => {
  if (isLoading.value) {
    return refreshingText.value;
  }
  // 刷新失败必须进入可见文本：此前只靠颜色 + title 传达失败，无 aria-live，
  // 键盘 / 读屏 / 小屏（文本隐藏）用户完全无感知。后台失败（pricing.error）同权。
  if (hasFailureSignal.value) {
    return `${label.value} · ${refreshFailedText.value}`;
  }
  if (isMissing.value) {
    return missingText.value;
  }
  return `${label.value} · ${ageText.value}`;
});

const titleText = computed(() => {
  if (isLoading.value) {
    return refreshingText.value;
  }
  if (isMissing.value) {
    // missing + 刷新失败组合（首次拉取即失败的真实场景）：失败详情不能被 missing 提前返回吞掉。
    return hasFailureSignal.value ? `${missingText.value} · ${refreshFailedDetailText.value}` : missingText.value;
  }
  const segments = [`${t('common:vue.app.marketPriceDataTime', FALLBACK_DATA_TIME)}: ${absoluteTimeText.value}`];
  if (isStale.value) {
    segments.push(t('common:vue.app.marketPriceStale', FALLBACK_STALE));
  }
  if (hasFailureSignal.value) {
    segments.push(refreshFailedDetailText.value);
  }
  return segments.join(' · ');
});

// aria-live 播报文本：只反映离散状态变化（加载中 / 失败 / 数据到达 / missing）。
// 刻意不用 ageText——相对年龄随 60s tick 变化，会让 live region 文本每分钟变一次，
// 屏幕阅读器被周期性重复播报轰炸；绝对时间只随快照离散变化，播报安全。
const liveAnnouncementText = computed(() => {
  if (isLoading.value) {
    return refreshingText.value;
  }
  if (hasFailureSignal.value) {
    return refreshFailedDetailText.value;
  }
  if (isMissing.value) {
    return missingText.value;
  }
  return `${label.value} · ${absoluteTimeText.value}`;
});

const ariaLabelText = computed(() => t('common:vue.app.marketPriceRefreshAriaLabel', FALLBACK_ARIA_LABEL));

const toneClass = computed(() => {
  if (hasFailureSignal.value) {
    return 'text-destructive';
  }
  return isStale.value || isMissing.value ? 'text-warning' : '';
});
const iconToneClass = toneClass;
const textToneClass = toneClass;

watch(
  () => [simulator.pricing?.marketTimestamp, simulator.pricing?.lastFetchedAt],
  () => {
    nowTick.value = Date.now();
    refreshFailed.value = false;
  },
);

async function handleRefresh() {
  if (isLoading.value) {
    return;
  }
  // 60 秒冷却防误触连点（与自动刷新尝试共用 MARKET_PRICE_REFRESH_ATTEMPT_COOLDOWN_MS），
  // 但仅对「成功」结果生效：失败后允许立即重试，避免失败提示变红后 60s 内的重试
  // 点击被静默吞掉（双击竞态由 isLoading 守卫兜底——真实拉取发起时同步置位）。
  // 强制刷新路径本身绕过快照新鲜度判定，点击即真实拉取。
  const nowMs = Date.now();
  if (nowMs - lastRefreshClickAt < MARKET_PRICE_REFRESH_ATTEMPT_COOLDOWN_MS) {
    return;
  }
  refreshFailed.value = false;
  const result = await simulator.ensureMarketPricesLoaded(true);
  if (result) {
    // 仅成功记录冷却起点；失败路径不记录，下次点击立即可重试。
    lastRefreshClickAt = Date.now();
  } else if (simulator.pricing?.error) {
    refreshFailed.value = true;
  }
}
</script>

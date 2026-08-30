export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clampPositiveInteger(value, fallback = 0) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

// 归一化"基准装备出售抵扣"的市场侧配置：仅接受 'ask'，其余（含缺省）一律视为 'bid'。
// 放在无依赖的 utils 中，供 queueScoring（normalizeQueueSettings / buildQueueItemCostInsights）
// 与 queueUpgradeCost（resolveEquipmentTransitionPricing）共享同一口径，避免独立实现漂移。
export function normalizeBaselineSaleSide(value) {
  return String(value || 'bid') === 'ask' ? 'ask' : 'bid';
}

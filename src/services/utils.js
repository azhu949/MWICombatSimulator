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

// 技能槽号（0-based 数组下标；0 = 固定在最前的特殊技能槽）的统一口径：能转数字就向下取整，
// 非有限数/负数一律回落到 fallback（默认 -1 = 非法，越界/门位校验仍由调用方负责）。
// 与 clampPositiveInteger 同源，避免再写一份 floor 规则；导出成具名口径是为了让「谁和谁必须同口径」
// 可被 grep 到——store 用它解析要交换/计价的目标槽位，首页 UI 用它比对「内联触发器编辑器是否正开在
// 被交换的槽位上」并把同一对数字原样回传。两侧各写一份（Number vs floor）曾在小数入参上静默分叉：
// store 换掉的是 floor 后的槽位、UI 却按原值比对认为「没换」，编辑器被留在内容已经换过的旧槽位上。
export function normalizeAbilitySlotIndex(value, fallback = -1) {
  return clampPositiveInteger(value, fallback);
}

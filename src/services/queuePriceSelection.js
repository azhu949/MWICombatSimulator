import { EQUIPMENT_SLOT_KEYS } from '../shared/playerConfig.js';

/**
 * 构造装备选择行的 key，格式为 `${itemHrid}|${enhancementLevel}`。
 * enhancementLevel 经 Math.floor + Math.max(0, ...) 归一化，确保与
 * buildChangedEquipmentKeys 产出的 key 格式完全一致。
 */
export function buildSelectionKey(itemHrid, enhancementLevel) {
  return `${String(itemHrid || '')}|${Math.max(0, Math.floor(Number(enhancementLevel || 0)))}`;
}

/**
 * 计算本队列项实际变更涉及的装备（itemHrid + enhancementLevel）集合，
 * 用于按 variant 过滤 priceSelections：只保留与本项相关的价格行，避免一个装备跨多个 variant 重复展示。
 *
 * @param {object} item - 队列项，需包含 snapshot 字段
 * @param {object} baselineSnapshot - 基准快照
 * @returns {Set<string>} 变更装备的 key 集合
 */
export function buildChangedEquipmentKeys(item, baselineSnapshot) {
  const baseline = baselineSnapshot || {};
  const target = item?.snapshot || {};
  const keys = new Set();
  for (const slot of EQUIPMENT_SLOT_KEYS) {
    const before = baseline?.equipment?.[slot] ?? { itemHrid: '', enhancementLevel: 0 };
    const after = target?.equipment?.[slot] ?? { itemHrid: '', enhancementLevel: 0 };
    if (
      String(before?.itemHrid || '') !== String(after?.itemHrid || '') ||
      Math.floor(Number(before?.enhancementLevel || 0)) !== Math.floor(Number(after?.enhancementLevel || 0))
    ) {
      if (after?.itemHrid) {
        keys.add(buildSelectionKey(after.itemHrid, after?.enhancementLevel));
      }
    }
  }
  return keys;
}

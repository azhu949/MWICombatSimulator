import { EQUIPMENT_SLOT_KEYS, LEVEL_KEYS } from '../shared/playerConfig.js';
import { normalizeCombatScrolls } from '../shared/combatScrolls.js';

function clonePlainValue(value, fallback) {
  if (!value || typeof value !== 'object') {
    return fallback;
  }
  return JSON.parse(JSON.stringify(value));
}

export function createCombatPreviewPlayerConfig(playerConfig = null) {
  if (!playerConfig || typeof playerConfig !== 'object') {
    return null;
  }

  const equipment = Object.fromEntries(
    EQUIPMENT_SLOT_KEYS.map((slot) => {
      const setting = playerConfig?.equipment?.[slot] ?? {};
      return [
        slot,
        {
          itemHrid: String(setting?.itemHrid || ''),
          enhancementLevel: Number(setting?.enhancementLevel ?? 0),
        },
      ];
    }),
  );

  const legacyTrinket = playerConfig?.equipment?.trinket ?? null;
  if (legacyTrinket && typeof legacyTrinket === 'object') {
    equipment.trinket = {
      itemHrid: String(legacyTrinket?.itemHrid || ''),
      enhancementLevel: Number(legacyTrinket?.enhancementLevel ?? 0),
    };
  }

  return {
    id: String(playerConfig.id || ''),
    selected: true,
    levels: Object.fromEntries(LEVEL_KEYS.map((key) => [key, Number(playerConfig?.levels?.[key] ?? 1)])),
    equipment,
    food: Array.from({ length: 3 }, (_, index) => String(playerConfig?.food?.[index] || '')),
    drinks: Array.from({ length: 3 }, (_, index) => String(playerConfig?.drinks?.[index] || '')),
    abilities: Array.from({ length: 5 }, (_, index) => {
      const ability = playerConfig?.abilities?.[index] ?? {};
      return {
        abilityHrid: String(ability?.abilityHrid || ''),
        level: Number(ability?.level ?? 1),
      };
    }),
    triggerMap: clonePlainValue(playerConfig?.triggerMap, {}),
    houseRooms: { ...(playerConfig?.houseRooms ?? {}) },
    guildBuffs: { ...(playerConfig?.guildBuffs ?? {}) },
    achievements: { ...(playerConfig?.achievements ?? {}) },
    // 在轻量预览 DTO 中保留限时战斗卷轴选择。
    // 预览映射器在派生永久属性时可能忽略该字段，
    // 但在此保留可维持与模拟一致的角色契约，
    // 避免预览/队列切换时丢失该选择。
    combatScrolls: normalizeCombatScrolls(playerConfig?.combatScrolls),
  };
}

export function buildStaticPriceCatalog(itemDetailMap = {}, formatters = {}) {
  const formatPriceCategoryName =
    typeof formatters.formatPriceCategoryName === 'function'
      ? formatters.formatPriceCategoryName
      : (categoryHrid) => String(categoryHrid || '');
  const formatPriceItemName =
    typeof formatters.formatPriceItemName === 'function'
      ? formatters.formatPriceItemName
      : (itemHrid, fallbackName = '') => String(fallbackName || itemHrid || '');

  const rows = [];
  const seen = new Set();

  for (const item of Object.values(itemDetailMap || {})) {
    const hrid = String(item?.hrid || '');
    if (!hrid || seen.has(hrid)) {
      continue;
    }

    const categoryHrid = String(item?.categoryHrid || '/item_categories/unknown');
    seen.add(hrid);
    rows.push({
      hrid,
      categoryHrid,
      categoryName: formatPriceCategoryName(categoryHrid),
      name: formatPriceItemName(hrid, String(item?.name || '')),
    });
  }

  rows.sort(
    (left, right) =>
      left.categoryName.localeCompare(right.categoryName) ||
      left.name.localeCompare(right.name) ||
      left.hrid.localeCompare(right.hrid),
  );

  return rows;
}

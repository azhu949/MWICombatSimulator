import { EQUIPMENT_SLOT_KEYS, LEVEL_KEYS } from "../shared/playerConfig.js";

function clonePlainValue(value, fallback) {
    if (!value || typeof value !== "object") {
        return fallback;
    }
    return JSON.parse(JSON.stringify(value));
}

export function createCombatPreviewPlayerConfig(playerConfig = null) {
    if (!playerConfig || typeof playerConfig !== "object") {
        return null;
    }

    const equipment = Object.fromEntries(
        EQUIPMENT_SLOT_KEYS.map((slot) => {
            const setting = playerConfig?.equipment?.[slot] ?? {};
            return [slot, {
                itemHrid: String(setting?.itemHrid || ""),
                enhancementLevel: Number(setting?.enhancementLevel ?? 0),
            }];
        })
    );

    const legacyTrinket = playerConfig?.equipment?.trinket ?? null;
    if (legacyTrinket && typeof legacyTrinket === "object") {
        equipment.trinket = {
            itemHrid: String(legacyTrinket?.itemHrid || ""),
            enhancementLevel: Number(legacyTrinket?.enhancementLevel ?? 0),
        };
    }

    return {
        id: String(playerConfig.id || ""),
        selected: true,
        levels: Object.fromEntries(
            LEVEL_KEYS.map((key) => [key, Number(playerConfig?.levels?.[key] ?? 1)])
        ),
        equipment,
        food: Array.from({ length: 3 }, (_, index) => String(playerConfig?.food?.[index] || "")),
        drinks: Array.from({ length: 3 }, (_, index) => String(playerConfig?.drinks?.[index] || "")),
        abilities: Array.from({ length: 5 }, (_, index) => {
            const ability = playerConfig?.abilities?.[index] ?? {};
            return {
                abilityHrid: String(ability?.abilityHrid || ""),
                level: Number(ability?.level ?? 1),
            };
        }),
        triggerMap: clonePlainValue(playerConfig?.triggerMap, {}),
        houseRooms: { ...(playerConfig?.houseRooms ?? {}) },
        achievements: { ...(playerConfig?.achievements ?? {}) },
    };
}

export function buildStaticPriceCatalog(itemDetailMap = {}, formatters = {}) {
    const formatPriceCategoryName = typeof formatters.formatPriceCategoryName === "function"
        ? formatters.formatPriceCategoryName
        : (categoryHrid) => String(categoryHrid || "");
    const formatPriceItemName = typeof formatters.formatPriceItemName === "function"
        ? formatters.formatPriceItemName
        : (itemHrid, fallbackName = "") => String(fallbackName || itemHrid || "");

    const rows = [];
    const seen = new Set();

    for (const item of Object.values(itemDetailMap || {})) {
        const hrid = String(item?.hrid || "");
        if (!hrid || seen.has(hrid)) {
            continue;
        }

        const categoryHrid = String(item?.categoryHrid || "/item_categories/unknown");
        seen.add(hrid);
        rows.push({
            hrid,
            categoryHrid,
            categoryName: formatPriceCategoryName(categoryHrid),
            name: formatPriceItemName(hrid, String(item?.name || "")),
        });
    }

    rows.sort((left, right) => (
        left.categoryName.localeCompare(right.categoryName)
        || left.name.localeCompare(right.name)
        || left.hrid.localeCompare(right.hrid)
    ));

    return rows;
}

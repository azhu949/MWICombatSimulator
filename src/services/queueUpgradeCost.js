import {
    abilityBookInfoByAbilityHrid,
    EQUIPMENT_SLOT_KEYS,
    getAbilityName as getIndexedAbilityName,
    getItemName as getIndexedItemName,
    houseRoomDetailIndex,
    itemDetailIndex,
} from "../shared/gameDataIndex.js";
import { applyMarketSaleFee, normalizePriceMode, PRICE_MODE_ASK, PRICE_MODE_BID, PRICE_MODE_VENDOR } from "./marketPriceService.js";
import { MARKET_HISTORY_PRICE_SOURCE } from "./marketHistoryService.js";
import {
    MANUAL_EQUIPMENT_PRICE_SOURCE,
    MANUAL_PRICE_WARNING_CODE,
    OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE,
} from "./queueScoring.js";
import { clampPositiveInteger, isPlainObject, toFiniteNumber } from "./utils.js";

export function getAbilityUpgradeCostKey(abilitySlot, abilityHrid, fromLevel, toLevel) {
    return `${abilitySlot}|${abilityHrid}|${fromLevel}|${toLevel}`;
}

export function getVendorPriceByItemHrid(itemHrid) {
    const hrid = String(itemHrid || "");
    if (!hrid) {
        return 0;
    }
    return Math.max(0, toFiniteNumber(itemDetailIndex?.[hrid]?.sellPrice, 0));
}

export function resolveItemPriceFromPricingState(pricingState, itemHrid, side = "ask") {
    const hrid = String(itemHrid || "");
    if (!hrid) {
        return 0;
    }

    const entry = pricingState?.priceTable?.[hrid] ?? {
        ask: -1,
        bid: -1,
        vendor: getVendorPriceByItemHrid(hrid),
    };
    const ask = toFiniteNumber(entry?.ask, -1);
    const bid = toFiniteNumber(entry?.bid, -1);
    const vendor = Math.max(0, toFiniteNumber(entry?.vendor, getVendorPriceByItemHrid(hrid)));

    if (side === "bid") {
        if (bid > 0) {
            return bid;
        }
        if (vendor > 0) {
            return vendor;
        }
        return ask > 0 ? ask : 0;
    }

    if (ask > 0) {
        return ask;
    }
    if (vendor > 0) {
        return vendor;
    }
    return bid > 0 ? bid : 0;
}

export function resolveEnhancementLevelPriceFromPricingState(itemHrid, level, pricingState, preferredSide = "ask") {
    const hrid = String(itemHrid || "");
    const normalizedLevel = Math.max(0, Math.floor(toFiniteNumber(level, 0)));
    if (!hrid) {
        return -1;
    }

    const quote = normalizedLevel === 0
        ? pricingState?.priceTable?.[hrid]
        : pricingState?.enhancementQuotesByItem?.[hrid]?.[String(normalizedLevel)];
    if (!isPlainObject(quote)) {
        return -1;
    }

    const side = preferredSide === "bid" ? "bid" : "ask";
    const price = toFiniteNumber(quote[side], -1);
    return price > 0 ? price : -1;
}

export function getConfirmedEquipmentPriceKey(itemHrid, enhancementLevel) {
    return `${String(itemHrid || "")}|${Math.max(0, Math.floor(toFiniteNumber(enhancementLevel, 0)))}`;
}

export function normalizeConfirmedEquipmentPrices(rawPrices) {
    const entries = Array.isArray(rawPrices) ? rawPrices : [];
    const normalized = [];
    const seen = new Set();
    for (const rawEntry of entries) {
        const itemHrid = String(rawEntry?.itemHrid || "");
        const enhancementLevel = Math.max(0, Math.floor(toFiniteNumber(rawEntry?.enhancementLevel, 0)));
        const price = toFiniteNumber(rawEntry?.price, 0);
        const normalizedVolume = toFiniteNumber(rawEntry?.volume, 0);
        const rawSource = String(rawEntry?.source || "");
        const priceSource = rawSource === MARKET_HISTORY_PRICE_SOURCE
            ? MARKET_HISTORY_PRICE_SOURCE
            : rawSource === MANUAL_EQUIPMENT_PRICE_SOURCE
                ? MANUAL_EQUIPMENT_PRICE_SOURCE
                : OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE;
        const volume = normalizedVolume > 0 ? normalizedVolume : null;
        if (
            !itemHrid
            || price <= 0
            || (priceSource === OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE && volume == null)
        ) {
            continue;
        }
        const key = getConfirmedEquipmentPriceKey(itemHrid, enhancementLevel);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        normalized.push({
            itemHrid,
            enhancementLevel,
            price,
            volume,
            source: priceSource,
            marketTimestamp: Math.max(0, toFiniteNumber(rawEntry?.marketTimestamp, 0)),
            confirmedAt: Math.max(0, toFiniteNumber(rawEntry?.confirmedAt, 0)),
        });
    }
    return normalized;
}

export function buildConfirmedEquipmentPriceMap(rawPrices) {
    if (rawPrices instanceof Map) {
        return rawPrices;
    }
    const priceMap = new Map();
    for (const entry of normalizeConfirmedEquipmentPrices(rawPrices)) {
        priceMap.set(getConfirmedEquipmentPriceKey(entry.itemHrid, entry.enhancementLevel), entry);
    }
    return priceMap;
}

export function getConfirmedEquipmentPrice(rawPrices, itemHrid, enhancementLevel) {
    const key = getConfirmedEquipmentPriceKey(itemHrid, enhancementLevel);
    if (rawPrices instanceof Map) {
        return rawPrices.get(key) || null;
    }
    return buildConfirmedEquipmentPriceMap(rawPrices).get(key) || null;
}

export function resolveRecentTradeAverage(pricingState, itemHrid, enhancementLevel) {
    const quote = pricingState?.enhancementQuotesByItem?.[String(itemHrid || "")]?.[String(Math.max(0, Math.floor(toFiniteNumber(enhancementLevel, 0))))];
    const price = toFiniteNumber(quote?.averagePrice, 0);
    const volume = toFiniteNumber(quote?.volume, 0);
    if (price <= 0 || volume <= 0) {
        return null;
    }
    return {
        itemHrid: String(itemHrid || ""),
        enhancementLevel: Math.max(0, Math.floor(toFiniteNumber(enhancementLevel, 0))),
        price,
        volume,
        source: OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE,
        marketTimestamp: Math.max(0, toFiniteNumber(pricingState?.marketTimestamp, 0)),
    };
}

export function resolveEquipmentTransitionPricing(beforeItemHrid, beforeLevel, afterItemHrid, afterLevel, pricingState, confirmedEquipmentPrices = []) {
    const targetItemHrid = String(afterItemHrid || "");
    if (!targetItemHrid) {
        return {
            cost: 0,
            targetAsk: 0,
            targetAskAvailable: true,
            baselineSaleValue: 0,
            baselineSaleSource: "none",
            baselineSaleZero: false,
        };
    }

    const safeBeforeLevel = Math.max(0, Math.floor(toFiniteNumber(beforeLevel, 0)));
    const safeAfterLevel = Math.max(0, Math.floor(toFiniteNumber(afterLevel, 0)));
    const exactAsk = resolveEnhancementLevelPriceFromPricingState(targetItemHrid, safeAfterLevel, pricingState, "ask");
    const confirmedPrice = exactAsk > 0
        ? null
        : getConfirmedEquipmentPrice(confirmedEquipmentPrices, targetItemHrid, safeAfterLevel);
    const buyCost = exactAsk > 0 ? exactAsk : toFiniteNumber(confirmedPrice?.price, -1);

    const sourceItemHrid = String(beforeItemHrid || "");
    let sellValue = 0;
    let baselineSaleSource = "none";
    if (sourceItemHrid) {
        sellValue = resolveEnhancementLevelPriceFromPricingState(sourceItemHrid, safeBeforeLevel, pricingState, "bid");
        if (sellValue < 0) {
            sellValue = resolveEnhancementLevelPriceFromPricingState(sourceItemHrid, safeBeforeLevel, pricingState, "ask");
            baselineSaleSource = sellValue > 0 ? "ask" : "zero";
        } else {
            baselineSaleSource = "bid";
        }
    }

    const targetAskAvailable = buyCost > 0;
    // Market sales are subject to the market tax; keep the net proceeds as the sale credit.
    const baselineSaleValue = sellValue > 0 ? applyMarketSaleFee(sellValue, sourceItemHrid) : 0;
    return {
        cost: targetAskAvailable ? Math.max(0, buyCost - baselineSaleValue) : null,
        targetAsk: targetAskAvailable ? buyCost : null,
        targetAskAvailable,
        targetPriceSource: exactAsk > 0 ? "ask" : (confirmedPrice?.source || "missing"),
        confirmedPrice,
        baselineSaleValue,
        baselineSaleSource,
        baselineSaleZero: Boolean(sourceItemHrid) && baselineSaleValue === 0,
    };
}

export function computeDefaultEquipmentTransitionCost(beforeItemHrid, beforeLevel, afterItemHrid, afterLevel, pricingState, confirmedEquipmentPrices = []) {
    return resolveEquipmentTransitionPricing(
        beforeItemHrid,
        beforeLevel,
        afterItemHrid,
        afterLevel,
        pricingState,
        confirmedEquipmentPrices
    ).cost;
}

export function inspectEquipmentTransitionCost(slotKey, beforeEquipment, afterEquipment, pricingState, confirmedEquipmentPrices = []) {
    const beforeItemHrid = String(beforeEquipment?.itemHrid || "");
    const afterItemHrid = String(afterEquipment?.itemHrid || "");
    const beforeLevel = Math.max(0, Math.floor(toFiniteNumber(beforeEquipment?.enhancementLevel, 0)));
    const afterLevel = Math.max(0, Math.floor(toFiniteNumber(afterEquipment?.enhancementLevel, 0)));
    const pricing = resolveEquipmentTransitionPricing(
        beforeItemHrid,
        beforeLevel,
        afterItemHrid,
        afterLevel,
        pricingState,
        confirmedEquipmentPrices
    );
    return {
        slotKey,
        beforeItemHrid,
        afterItemHrid,
        beforeLevel,
        afterLevel,
        ...pricing,
    };
}

export function inspectQueueEquipmentPricing(baselineSnapshot, targetSnapshot, pricingState, confirmedEquipmentPrices = []) {
    const inspections = [];
    const confirmedEquipmentPriceMap = buildConfirmedEquipmentPriceMap(confirmedEquipmentPrices);
    for (const slotKey of EQUIPMENT_SLOT_KEYS) {
        const beforeEquipment = baselineSnapshot?.equipment?.[slotKey] ?? { itemHrid: "", enhancementLevel: 0 };
        const afterEquipment = targetSnapshot?.equipment?.[slotKey] ?? { itemHrid: "", enhancementLevel: 0 };
        if (
            String(beforeEquipment?.itemHrid || "") === String(afterEquipment?.itemHrid || "")
            && Math.floor(toFiniteNumber(beforeEquipment?.enhancementLevel, 0)) === Math.floor(toFiniteNumber(afterEquipment?.enhancementLevel, 0))
        ) {
            continue;
        }
        if (!String(afterEquipment?.itemHrid || "")) {
            continue;
        }
        inspections.push(inspectEquipmentTransitionCost(
            slotKey,
            beforeEquipment,
            afterEquipment,
            pricingState,
            confirmedEquipmentPriceMap
        ));
    }
    return inspections;
}

export function buildQueueCostWarnings(inspections = []) {
    const baselineWarnings = inspections
        .filter((inspection) => inspection.baselineSaleZero)
        .map((inspection) => ({
            code: "baseline_sale_zero",
            slotKey: inspection.slotKey,
            itemHrid: inspection.beforeItemHrid,
            enhancementLevel: inspection.beforeLevel,
        }));
    const confirmedWarnings = inspections
        .filter((inspection) => (
            inspection.confirmedPrice
            && (
                inspection.targetPriceSource === OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE
                || inspection.targetPriceSource === MARKET_HISTORY_PRICE_SOURCE
                || inspection.targetPriceSource === MANUAL_EQUIPMENT_PRICE_SOURCE
            )
        ))
        .map((inspection) => ({
            code: inspection.targetPriceSource === MARKET_HISTORY_PRICE_SOURCE
                ? MARKET_HISTORY_PRICE_SOURCE
                : inspection.targetPriceSource === MANUAL_EQUIPMENT_PRICE_SOURCE
                    ? MANUAL_PRICE_WARNING_CODE
                    : "confirmed_hourly_average",
            source: inspection.targetPriceSource,
            slotKey: inspection.slotKey,
            itemHrid: inspection.afterItemHrid,
            enhancementLevel: inspection.afterLevel,
            price: inspection.confirmedPrice.price,
            volume: inspection.confirmedPrice.volume,
            marketTimestamp: inspection.confirmedPrice.marketTimestamp,
        }));
    return [...baselineWarnings, ...confirmedWarnings];
}

export function findInvalidManualEquipmentPriceEntry(rawPrices) {
    if (!Array.isArray(rawPrices)) {
        return null;
    }
    for (const rawEntry of rawPrices) {
        if (String(rawEntry?.source || "") !== MANUAL_EQUIPMENT_PRICE_SOURCE) {
            continue;
        }
        const price = toFiniteNumber(rawEntry?.price, 0);
        if (!Number.isSafeInteger(price) || price <= 0) {
            return rawEntry;
        }
    }
    return null;
}

export function createInvalidManualEquipmentPriceError(rawEntry) {
    const error = new Error("common:queue.manualPriceInvalid");
    error.code = "invalid_manual_price";
    error.details = {
        itemHrid: String(rawEntry?.itemHrid || ""),
        enhancementLevel: Math.max(0, Math.floor(toFiniteNumber(rawEntry?.enhancementLevel, 0))),
    };
    return error;
}

export function createMissingEquipmentAskError(inspection, { queued = false } = {}) {
    const error = new Error(
        queued
            ? "common:queue.missingEnhancementAskQueued"
            : "common:queue.missingEnhancementAsk"
    );
    error.code = "missing_enhancement_ask";
    error.queued = queued;
    error.details = {
        slotKey: inspection.slotKey,
        itemHrid: inspection.afterItemHrid,
        enhancementLevel: inspection.afterLevel,
    };
    return error;
}

export function createEquipmentPriceConfirmationError(confirmations = []) {
    const error = new Error("common:queue.confirmHourlyAverageRequired");
    error.code = "equipment_price_confirmation_required";
    error.confirmations = normalizeConfirmedEquipmentPrices(confirmations);
    return error;
}

export function ensureAbilityUpgradeReferenceGlobals() {
    const target = typeof window !== "undefined" ? window : globalThis;
    if (!Array.isArray(target.jigsLevelExperienceTable)) {
        target.jigsLevelExperienceTable = [];
    }
    if (!target.jigsSpellBookXpByName || typeof target.jigsSpellBookXpByName !== "object" || Array.isArray(target.jigsSpellBookXpByName)) {
        target.jigsSpellBookXpByName = {};
    }
    return target;
}

export function hasAbilityUpgradeReferenceDataLoaded() {
    const globalRef = ensureAbilityUpgradeReferenceGlobals();
    return Array.isArray(globalRef.jigsLevelExperienceTable) && globalRef.jigsLevelExperienceTable.length > 1;
}

export function getAbilityXpForLevel(level) {
    const table = ensureAbilityUpgradeReferenceGlobals().jigsLevelExperienceTable;
    if (!Array.isArray(table)) {
        return null;
    }

    const normalizedLevel = Math.floor(toFiniteNumber(level, -1));
    if (!Number.isInteger(normalizedLevel) || normalizedLevel < 0 || normalizedLevel >= table.length) {
        return null;
    }

    const xpValue = Number(table[normalizedLevel]);
    return Number.isFinite(xpValue) ? xpValue : null;
}

export function getSpellBookXpForAbility(abilityHrid) {
    const normalizedAbilityHrid = String(abilityHrid || "");
    if (!normalizedAbilityHrid) {
        return 0;
    }

    const directBookInfo = abilityBookInfoByAbilityHrid[normalizedAbilityHrid];
    if (directBookInfo?.xpPerBook > 0) {
        return directBookInfo.xpPerBook;
    }

    const abilityName = getIndexedAbilityName(normalizedAbilityHrid, "");
    if (!abilityName) {
        return 0;
    }

    const spellBookXpMap = ensureAbilityUpgradeReferenceGlobals().jigsSpellBookXpByName;
    if (!spellBookXpMap || typeof spellBookXpMap !== "object") {
        return 0;
    }

    const lowerAbilityName = abilityName.toLowerCase();
    const matchedKey = Object.keys(spellBookXpMap).find((key) => String(key || "").toLowerCase() === lowerAbilityName);
    const xpPerBook = matchedKey ? Number(spellBookXpMap[matchedKey]) : 0;
    return Number.isFinite(xpPerBook) && xpPerBook > 0 ? xpPerBook : 0;
}

export function resolveAbilityBookPriceFromPricingState(pricingState, abilityHrid) {
    const normalizedAbilityHrid = String(abilityHrid || "");
    const bookItemHrid = String(abilityBookInfoByAbilityHrid?.[normalizedAbilityHrid]?.itemHrid || "");
    if (!bookItemHrid) {
        return null;
    }

    const dropMode = normalizePriceMode(pricingState?.dropMode, PRICE_MODE_BID);
    if (dropMode === PRICE_MODE_VENDOR) {
        const vendorFallback = toFiniteNumber(itemDetailIndex?.[bookItemHrid]?.sellPrice, 0);
        const vendorPrice = Math.max(0, toFiniteNumber(pricingState?.priceTable?.[bookItemHrid]?.vendor, vendorFallback));
        return Number.isFinite(vendorPrice) ? vendorPrice : null;
    }

    const side = dropMode === PRICE_MODE_ASK ? "ask" : "bid";
    const marketPrice = resolveItemPriceFromPricingState(pricingState, bookItemHrid, side);
    return Number.isFinite(marketPrice) ? Math.max(0, marketPrice) : null;
}

export function computeDefaultAbilityUpgradeCost(baseAbility, toLevel, pricingState) {
    const abilityHrid = String(baseAbility?.abilityHrid || "");
    const fromLevel = Math.max(1, Math.floor(toFiniteNumber(baseAbility?.level, 1)));
    const targetLevel = Math.max(1, Math.floor(toFiniteNumber(toLevel, 1)));
    if (!abilityHrid || targetLevel <= fromLevel) {
        return 0;
    }

    const startXp = getAbilityXpForLevel(fromLevel);
    const endXp = getAbilityXpForLevel(targetLevel);
    if (startXp == null || endXp == null) {
        return null;
    }

    const xpNeeded = endXp - startXp;
    if (xpNeeded <= 0) {
        return 0;
    }

    const xpPerBook = getSpellBookXpForAbility(abilityHrid);
    if (!Number.isFinite(xpPerBook) || xpPerBook <= 0) {
        return null;
    }

    const booksNeeded = Math.ceil(xpNeeded / xpPerBook);
    if (!Number.isFinite(booksNeeded) || booksNeeded <= 0) {
        return 0;
    }

    const pricePerBook = resolveAbilityBookPriceFromPricingState(pricingState, abilityHrid);
    if (!Number.isFinite(pricePerBook) || pricePerBook < 0) {
        return null;
    }

    const totalCost = booksNeeded * pricePerBook;
    return totalCost > 0 ? totalCost : 0;
}

export function normalizeHouseRoomLevelMap(source) {
    const normalizedSource = isPlainObject(source) ? source : {};
    const normalized = {};

    for (const room of Object.values(houseRoomDetailIndex || {})) {
        const roomHrid = String(room?.hrid || "");
        if (!roomHrid) {
            continue;
        }
        normalized[roomHrid] = clampPositiveInteger(normalizedSource[roomHrid], 0);
    }

    return normalized;
}

export function resolveHouseRoomMaterialPricing(itemHrid, pricingState) {
    const normalizedItemHrid = String(itemHrid || "");
    if (!normalizedItemHrid) {
        return {
            unitPrice: 0,
            priced: false,
        };
    }

    if (normalizedItemHrid === "/items/coin") {
        return {
            unitPrice: 1,
            priced: true,
        };
    }

    const resolvedPrice = Math.max(0, toFiniteNumber(
        resolveItemPriceFromPricingState(pricingState, normalizedItemHrid, "ask"),
        0
    ));

    return {
        unitPrice: resolvedPrice,
        priced: resolvedPrice > 0,
    };
}

export function buildHouseRoomUpgradeCostPreview(baseHouseRooms, targetHouseRooms, pricingState) {
    const normalizedBase = normalizeHouseRoomLevelMap(baseHouseRooms);
    const normalizedTarget = normalizeHouseRoomLevelMap(targetHouseRooms);
    const roomDetails = Object.values(houseRoomDetailIndex || {})
        .slice()
        .sort((left, right) => (
            Number(left?.sortIndex ?? 0) - Number(right?.sortIndex ?? 0)
            || String(left?.name || "").localeCompare(String(right?.name || ""))
        ));
    const roomRows = [];
    const materialCountMap = {};

    for (const room of roomDetails) {
        const roomHrid = String(room?.hrid || "");
        if (!roomHrid) {
            continue;
        }

        const fromLevel = clampPositiveInteger(normalizedBase[roomHrid], 0);
        const toLevel = clampPositiveInteger(normalizedTarget[roomHrid], 0);
        if (toLevel <= fromLevel) {
            continue;
        }

        const roomMaterialCountMap = {};
        const upgradeCostsMap = isPlainObject(room?.upgradeCostsMap) ? room.upgradeCostsMap : {};

        for (let level = fromLevel + 1; level <= toLevel; level++) {
            const levelCosts = Array.isArray(upgradeCostsMap[String(level)]) ? upgradeCostsMap[String(level)] : [];
            for (const costEntry of levelCosts) {
                const itemHrid = String(costEntry?.itemHrid || "");
                const count = Math.max(0, toFiniteNumber(costEntry?.count, 0));
                if (!itemHrid || count <= 0) {
                    continue;
                }

                roomMaterialCountMap[itemHrid] = toFiniteNumber(roomMaterialCountMap[itemHrid], 0) + count;
                materialCountMap[itemHrid] = toFiniteNumber(materialCountMap[itemHrid], 0) + count;
            }
        }

        const subtotal = Object.entries(roomMaterialCountMap).reduce((sum, [itemHrid, count]) => {
            const safeCount = Math.max(0, toFiniteNumber(count, 0));
            if (safeCount <= 0) {
                return sum;
            }
            const pricing = resolveHouseRoomMaterialPricing(itemHrid, pricingState);
            return sum + (pricing.priced ? safeCount * pricing.unitPrice : 0);
        }, 0);

        roomRows.push({
            roomHrid,
            fromLevel,
            toLevel,
            subtotal: toFiniteNumber(subtotal, 0),
        });
    }

    const materials = Object.entries(materialCountMap)
        .map(([itemHrid, count]) => {
            const safeCount = Math.max(0, toFiniteNumber(count, 0));
            const pricing = resolveHouseRoomMaterialPricing(itemHrid, pricingState);
            const subtotal = pricing.priced ? safeCount * pricing.unitPrice : 0;
            return {
                itemHrid,
                count: safeCount,
                unitPrice: pricing.unitPrice,
                subtotal: toFiniteNumber(subtotal, 0),
                priced: pricing.priced,
            };
        })
        .filter((entry) => entry.count > 0)
        .sort((left, right) => {
            if (left.itemHrid === "/items/coin" && right.itemHrid !== "/items/coin") {
                return -1;
            }
            if (right.itemHrid === "/items/coin" && left.itemHrid !== "/items/coin") {
                return 1;
            }
            return Number(right.subtotal || 0) - Number(left.subtotal || 0)
                || getIndexedItemName(left.itemHrid, left.itemHrid).localeCompare(
                    getIndexedItemName(right.itemHrid, right.itemHrid)
                );
        });

    const coinCost = materials.reduce((sum, entry) => (
        entry.itemHrid === "/items/coin" ? sum + entry.subtotal : sum
    ), 0);
    const materialValue = materials.reduce((sum, entry) => (
        entry.itemHrid !== "/items/coin" && entry.priced ? sum + entry.subtotal : sum
    ), 0);

    return {
        rooms: roomRows,
        materials,
        totals: {
            coinCost: toFiniteNumber(coinCost, 0),
            materialValue: toFiniteNumber(materialValue, 0),
            totalCost: toFiniteNumber(coinCost + materialValue, 0),
        },
    };
}

export function computeQueueItemUpgradeCost(baselineSnapshot, targetSnapshot, pricingState, options = {}) {
    if (!baselineSnapshot || !targetSnapshot) {
        return 0;
    }

    const abilityCostMap = isPlainObject(options?.abilityCostMap) ? options.abilityCostMap : {};
    const confirmedEquipmentPrices = normalizeConfirmedEquipmentPrices(options?.confirmedEquipmentPrices);
    let totalCost = 0;
    let hasUnknownEquipmentUpgradeCost = false;
    let hasUnknownAbilityUpgradeCost = false;

    for (const slotKey of EQUIPMENT_SLOT_KEYS) {
        const beforeEquipment = baselineSnapshot?.equipment?.[slotKey] ?? { itemHrid: "", enhancementLevel: 0 };
        const afterEquipment = targetSnapshot?.equipment?.[slotKey] ?? { itemHrid: "", enhancementLevel: 0 };
        const beforeItemHrid = String(beforeEquipment?.itemHrid || "");
        const afterItemHrid = String(afterEquipment?.itemHrid || "");
        const beforeLevel = Math.max(0, Math.floor(toFiniteNumber(beforeEquipment?.enhancementLevel, 0)));
        const afterLevel = Math.max(0, Math.floor(toFiniteNumber(afterEquipment?.enhancementLevel, 0)));

        if (beforeItemHrid === afterItemHrid && beforeLevel === afterLevel) {
            continue;
        }

        const estimatedCost = computeDefaultEquipmentTransitionCost(
            beforeItemHrid,
            beforeLevel,
            afterItemHrid,
            afterLevel,
            pricingState,
            confirmedEquipmentPrices
        );

        if (estimatedCost == null || !Number.isFinite(Number(estimatedCost))) {
            hasUnknownEquipmentUpgradeCost = true;
            continue;
        }
        totalCost += Math.max(0, estimatedCost);
    }

    for (let i = 0; i < 5; i++) {
        const beforeAbility = baselineSnapshot?.abilities?.[i] ?? { abilityHrid: "", level: 1 };
        const afterAbility = targetSnapshot?.abilities?.[i] ?? { abilityHrid: "", level: 1 };
        const beforeHrid = String(beforeAbility?.abilityHrid || "");
        const afterHrid = String(afterAbility?.abilityHrid || "");
        const beforeLevel = Math.max(1, Math.floor(toFiniteNumber(beforeAbility?.level, 1)));
        const afterLevel = Math.max(1, Math.floor(toFiniteNumber(afterAbility?.level, 1)));

        if (!afterHrid) {
            continue;
        }

        const fromLevel = beforeHrid && beforeHrid === afterHrid ? beforeLevel : 1;
        if (afterLevel <= fromLevel) {
            continue;
        }

        const costKey = getAbilityUpgradeCostKey(i, afterHrid, fromLevel, afterLevel);
        const defaultCost = computeDefaultAbilityUpgradeCost({
            abilityHrid: afterHrid,
            level: fromLevel,
        }, afterLevel, pricingState);
        let estimatedCost = null;
        if (Object.prototype.hasOwnProperty.call(abilityCostMap, costKey)) {
            estimatedCost = toFiniteNumber(abilityCostMap[costKey], 0);
        } else if (defaultCost == null) {
            hasUnknownAbilityUpgradeCost = true;
        } else {
            estimatedCost = toFiniteNumber(defaultCost, 0);
        }

        if (estimatedCost == null) {
            continue;
        }
        totalCost += Math.max(0, estimatedCost);
    }

    const houseRoomUpgradePreview = buildHouseRoomUpgradeCostPreview(
        baselineSnapshot?.houseRooms,
        targetSnapshot?.houseRooms,
        pricingState
    );
    totalCost += Math.max(0, toFiniteNumber(houseRoomUpgradePreview?.totals?.totalCost, 0));

    if (hasUnknownEquipmentUpgradeCost || hasUnknownAbilityUpgradeCost) {
        return null;
    }

    return toFiniteNumber(totalCost, 0);
}

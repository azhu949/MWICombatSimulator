import itemDetailMap from "../combatsimulator/data/itemDetailMap.json";
import openableLootDropMap from "../combatsimulator/data/openableLootDropMap.json";

export const PRICE_MODE_ASK = "ask";
export const PRICE_MODE_BID = "bid";
export const PRICE_MODE_VENDOR = "vendor";

const MARKETPLACE_SOURCE_URLS = [
    "https://www.milkywayidle.com/game_data/marketplace.json",
    "https://www.milkywayidlecn.com/game_data/marketplace.json",
];

const TREASURE_CHEST_HRIDS = [
    "/items/small_treasure_chest",
    "/items/medium_treasure_chest",
    "/items/large_treasure_chest",
];

function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getVendorPriceByItemHrid(itemHrid) {
    const item = itemDetailMap[itemHrid];
    return Math.max(0, toFiniteNumber(item?.sellPrice, 0));
}

export function normalizePriceMode(mode, fallback = PRICE_MODE_BID) {
    const normalized = String(mode || "").toLowerCase();
    if (normalized === PRICE_MODE_ASK || normalized === PRICE_MODE_BID || normalized === PRICE_MODE_VENDOR) {
        return normalized;
    }
    return fallback;
}

function resolveEntryByMode(entry, mode) {
    const normalizedMode = normalizePriceMode(mode, PRICE_MODE_BID);
    const ask = toFiniteNumber(entry?.ask, -1);
    const bid = toFiniteNumber(entry?.bid, -1);
    const vendor = Math.max(0, toFiniteNumber(entry?.vendor, 0));

    if (normalizedMode === PRICE_MODE_VENDOR) {
        return vendor;
    }

    if (normalizedMode === PRICE_MODE_BID) {
        if (bid >= 0) {
            return bid;
        }
        if (ask >= 0) {
            return ask;
        }
        return vendor;
    }

    if (ask >= 0) {
        return ask;
    }
    if (bid >= 0) {
        return bid;
    }
    return vendor;
}

export function resolveMarketPrice(priceTable, itemHrid, mode = PRICE_MODE_BID) {
    const hrid = String(itemHrid || "");
    if (!hrid) {
        return 0;
    }

    const entry = priceTable?.[hrid];
    if (!entry) {
        return getVendorPriceByItemHrid(hrid);
    }

    return Math.max(0, toFiniteNumber(resolveEntryByMode(entry, mode), 0));
}

function computeChestExpectedValue(table, chestHrid, mode) {
    const drops = Array.isArray(openableLootDropMap[chestHrid]) ? openableLootDropMap[chestHrid] : [];
    let total = 0;

    for (const drop of drops) {
        const dropRate = Math.max(0, toFiniteNumber(drop?.dropRate, 0));
        const minCount = Math.max(0, toFiniteNumber(drop?.minCount, 0));
        const maxCount = Math.max(0, toFiniteNumber(drop?.maxCount, 0));
        const expectedCount = (minCount + maxCount) / 2;
        total += resolveMarketPrice(table, drop?.itemHrid, mode) * dropRate * expectedCount;
    }

    return Math.max(0, toFiniteNumber(total, 0));
}

function addSyntheticEntries(table) {
    table["/items/coin"] = { ask: 1, bid: 1, vendor: 1 };

    for (const chestHrid of TREASURE_CHEST_HRIDS) {
        table[chestHrid] = {
            ask: computeChestExpectedValue(table, chestHrid, PRICE_MODE_ASK),
            bid: computeChestExpectedValue(table, chestHrid, PRICE_MODE_BID),
            vendor: computeChestExpectedValue(table, chestHrid, PRICE_MODE_VENDOR),
        };
    }
}

export function createDefaultPriceTable() {
    const table = {};

    for (const item of Object.values(itemDetailMap)) {
        const hrid = String(item?.hrid || "");
        if (!hrid) {
            continue;
        }

        table[hrid] = {
            ask: -1,
            bid: -1,
            vendor: getVendorPriceByItemHrid(hrid),
        };
    }

    addSyntheticEntries(table);
    return table;
}

export function hydratePriceTableWithMarketData(marketData, baseTable = createDefaultPriceTable()) {
    const table = { ...baseTable };
    const source = marketData && typeof marketData === "object" ? marketData : {};

    for (const [hrid, levelQuotes] of Object.entries(source)) {
        const levelZero = levelQuotes?.["0"];
        if (!levelZero || typeof levelZero !== "object") {
            continue;
        }

        const existing = table[hrid] || {
            ask: -1,
            bid: -1,
            vendor: getVendorPriceByItemHrid(hrid),
        };

        table[hrid] = {
            ask: toFiniteNumber(levelZero.a, existing.ask),
            bid: toFiniteNumber(levelZero.b, existing.bid),
            vendor: Math.max(0, toFiniteNumber(existing.vendor, 0)),
        };
    }

    addSyntheticEntries(table);
    return table;
}

function normalizeEnhancementQuoteEntry(rawQuote) {
    if (!rawQuote || typeof rawQuote !== "object") {
        return null;
    }
    const ask = toFiniteNumber(rawQuote?.a, -1);
    const bid = toFiniteNumber(rawQuote?.b, -1);
    if (ask < 0 && bid < 0) {
        return null;
    }
    return {
        ask,
        bid,
    };
}

export function extractEnhancementDataFromMarketData(marketData) {
    const source = marketData && typeof marketData === "object" ? marketData : {};
    const enhancementQuotesByItem = {};
    const enhancementLevelsByItem = {};

    for (const [rawHrid, rawLevelQuotes] of Object.entries(source)) {
        const hrid = String(rawHrid || "");
        if (!hrid || !rawLevelQuotes || typeof rawLevelQuotes !== "object") {
            continue;
        }

        const quoteMap = {};
        const levels = [];

        for (const [rawLevel, rawQuote] of Object.entries(rawLevelQuotes)) {
            const level = Number(rawLevel);
            if (!Number.isFinite(level) || level < 0) {
                continue;
            }

            const normalizedQuote = normalizeEnhancementQuoteEntry(rawQuote);
            if (!normalizedQuote) {
                continue;
            }

            quoteMap[String(level)] = normalizedQuote;
            if (level > 0) {
                levels.push(level);
            }
        }

        if (Object.keys(quoteMap).length > 0) {
            enhancementQuotesByItem[hrid] = quoteMap;
        }
        if (levels.length > 0) {
            enhancementLevelsByItem[hrid] = Array.from(new Set(levels)).sort((a, b) => a - b);
        }
    }

    return {
        enhancementQuotesByItem,
        enhancementLevelsByItem,
    };
}

export async function fetchMarketPriceTable(fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== "function") {
        throw new Error("Fetch API is unavailable in current environment.");
    }

    let lastError = null;

    for (const url of MARKETPLACE_SOURCE_URLS) {
        try {
            const response = await fetchImpl(url, { mode: "cors" });
            if (!response?.ok) {
                lastError = new Error(`Price request failed: ${response?.status || "unknown"}`);
                continue;
            }

            const payload = await response.json();
            const marketData = payload?.marketData;
            const priceTable = hydratePriceTableWithMarketData(marketData);
            const {
                enhancementQuotesByItem,
                enhancementLevelsByItem,
            } = extractEnhancementDataFromMarketData(marketData);
            return {
                sourceUrl: url,
                fetchedAt: Date.now(),
                priceTable,
                enhancementQuotesByItem,
                enhancementLevelsByItem,
            };
        } catch (error) {
            lastError = error;
        }
    }

    throw (lastError || new Error("Unable to fetch market prices."));
}

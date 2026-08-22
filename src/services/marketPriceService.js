import openableLootDropMap from '../combatsimulator/data/openableLootDropMap.json';
import { itemDetailIndex, itemVendorPriceByHrid } from '../shared/gameDataIndex.js';

export const PRICE_MODE_ASK = 'ask';
export const PRICE_MODE_BID = 'bid';
export const PRICE_MODE_VENDOR = 'vendor';
export const MARKET_PRICE_SNAPSHOT_MAX_AGE_MS = 90 * 60_000;
export const MARKET_PRICE_REFRESH_ATTEMPT_COOLDOWN_MS = 60_000;
export const MARKET_SALE_FEE_RATE = 0.05;

// Official game guide: "Successful trades are taxed 5% of the seller's proceeds
// (18% for Bag of 10 Cowbells)." The marketplace API does not expose per-item fee
// rates, so special rates are maintained here by hrid. If the API ever exposes a
// per-item tax field, switch back to a data-driven lookup instead of this map.
export const BAG_OF_10_COWBELLS_HRID = '/items/bag_of_10_cowbells';

const SPECIAL_MARKET_FEE_RATE_BY_HRID = Object.freeze({
  [BAG_OF_10_COWBELLS_HRID]: 0.18,
});

export function getMarketSaleFeeRate(itemHrid) {
  return SPECIAL_MARKET_FEE_RATE_BY_HRID[String(itemHrid || '')] ?? MARKET_SALE_FEE_RATE;
}

// Startup guard: a renamed or removed official hrid would otherwise silently
// fall back to the default 5% rate. Returns the list of unknown special hrids.
export function validateSpecialMarketFeeRateHrids(index = itemDetailIndex) {
  const missing = Object.keys(SPECIAL_MARKET_FEE_RATE_BY_HRID).filter((hrid) => !index?.[hrid]);
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      '[marketPriceService] Special market fee rates reference unknown item hrids: ' +
        `${missing.join(', ')}. Those items fall back to the default fee rate.`,
    );
  }
  return missing;
}

const MARKETPLACE_SOURCE_URLS = [
  'https://www.milkywayidle.com/game_data/marketplace.json',
  'https://www.milkywayidlecn.com/game_data/marketplace.json',
];
export const MARKETPLACE_REQUEST_TIMEOUT_MS = 10_000;

const TREASURE_CHEST_HRIDS = [
  '/items/small_treasure_chest',
  '/items/medium_treasure_chest',
  '/items/large_treasure_chest',
];

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getVendorPriceByItemHrid(itemHrid) {
  return Math.max(0, toFiniteNumber(itemVendorPriceByHrid?.[itemHrid], 0));
}

export function normalizePriceMode(mode, fallback = PRICE_MODE_BID) {
  const normalized = String(mode || '').toLowerCase();
  if (normalized === PRICE_MODE_ASK || normalized === PRICE_MODE_BID || normalized === PRICE_MODE_VENDOR) {
    return normalized;
  }
  return fallback;
}

// Market quote executions (ask/bid) represent taxable market sales;
// vendor, override, and estimated sources are not. The "enhancement_"
// prefix is only a decoration resolveEnhancementPrice applies to the
// underlying source, so it is stripped before matching.
// NOTE: skillingPlanner's liquidationSource vocabulary ("market_bid" /
// "base_bid_floor") is a separate, ALREADY-taxed convention — do not add
// those values here; doing so would double-tax already-taxed prices.
export function isMarketSaleSource(source) {
  const normalized = String(source || '')
    .toLowerCase()
    .replace(/^enhancement_/, '');
  return normalized === 'ask' || normalized === 'bid';
}

// Source-aware priority resolution shared by every consumer that needs to know
// which source produced a price (bid mode: bid -> ask -> vendor; ask mode:
// ask -> bid -> vendor; vendor mode: vendor).
function resolveEntrySourceByMode(entry, mode) {
  const normalizedMode = normalizePriceMode(mode, PRICE_MODE_BID);
  const ask = toFiniteNumber(entry?.ask, -1);
  const bid = toFiniteNumber(entry?.bid, -1);
  const vendor = Math.max(0, toFiniteNumber(entry?.vendor, 0));

  if (normalizedMode === PRICE_MODE_VENDOR) {
    return { price: vendor, source: 'vendor' };
  }

  if (normalizedMode === PRICE_MODE_BID) {
    if (bid >= 0) {
      return { price: bid, source: 'bid' };
    }
    if (ask >= 0) {
      return { price: ask, source: 'ask' };
    }
    return { price: vendor, source: 'vendor' };
  }

  if (ask >= 0) {
    return { price: ask, source: 'ask' };
  }
  if (bid >= 0) {
    return { price: bid, source: 'bid' };
  }
  return { price: vendor, source: 'vendor' };
}

function resolveEntryByMode(entry, mode) {
  return resolveEntrySourceByMode(entry, mode).price;
}

export function resolveMarketPrice(priceTable, itemHrid, mode = PRICE_MODE_BID) {
  const hrid = String(itemHrid || '');
  if (!hrid) {
    return 0;
  }

  const entry = priceTable?.[hrid];
  if (!entry) {
    return getVendorPriceByItemHrid(hrid);
  }

  return Math.max(0, toFiniteNumber(resolveEntryByMode(entry, mode), 0));
}

// Taxed prices are rounded to whole coins like in-game settlements. The exact
// official rounding rule could not be verified externally; "round" (half-up) is
// used and can be switched to "floor" here if the game floors instead.
export const MARKET_SALE_FEE_ROUNDING_MODE = 'round';

export function applyMarketSaleFeeByRate(price, feeRate) {
  const numericPrice = Math.max(0, toFiniteNumber(price, 0));
  const numericRate = Math.max(0, toFiniteNumber(feeRate, 0));
  const raw = Math.max(0, numericPrice * (1 - numericRate));
  return MARKET_SALE_FEE_ROUNDING_MODE === 'floor' ? Math.floor(raw) : Math.round(raw);
}

export function applyMarketSaleFee(price, itemHrid) {
  return applyMarketSaleFeeByRate(price, getMarketSaleFeeRate(itemHrid));
}

// Resolve the net proceeds of selling an item through the market.
// Market executions (bid/ask) are subject to the market tax; vendor sales are not.
export function resolveMarketSalePrice(priceTable, itemHrid, mode = PRICE_MODE_BID) {
  const hrid = String(itemHrid || '');
  const normalizedMode = normalizePriceMode(mode, PRICE_MODE_BID);
  if (!hrid || normalizedMode === PRICE_MODE_VENDOR) {
    return resolveMarketPrice(priceTable, hrid, normalizedMode);
  }

  const entry = priceTable?.[hrid];
  const resolved = entry ? resolveEntrySourceByMode(entry, normalizedMode) : null;
  if (!resolved || !isMarketSaleSource(resolved.source)) {
    return resolveMarketPrice(priceTable, hrid, normalizedMode);
  }
  return applyMarketSaleFee(resolved.price, hrid);
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
  table['/items/coin'] = { ask: 1, bid: 1, vendor: 1 };

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

  for (const item of Object.values(itemDetailIndex || {})) {
    const hrid = String(item?.hrid || '');
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
  const source = marketData && typeof marketData === 'object' ? marketData : {};

  for (const [hrid, levelQuotes] of Object.entries(source)) {
    const levelZero = levelQuotes?.['0'];
    if (!levelZero || typeof levelZero !== 'object') {
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
  if (!rawQuote || typeof rawQuote !== 'object') {
    return null;
  }
  const ask = toFiniteNumber(rawQuote?.a, -1);
  const bid = toFiniteNumber(rawQuote?.b, -1);
  const averagePrice = toFiniteNumber(rawQuote?.p, -1);
  const volume = toFiniteNumber(rawQuote?.v, 0);
  if (ask < 0 && bid < 0 && !(averagePrice > 0 && volume > 0)) {
    return null;
  }
  return {
    ask,
    bid,
    averagePrice,
    volume,
  };
}

export function extractEnhancementDataFromMarketData(marketData) {
  const source = marketData && typeof marketData === 'object' ? marketData : {};
  const enhancementQuotesByItem = {};
  const enhancementLevelsByItem = {};

  for (const [rawHrid, rawLevelQuotes] of Object.entries(source)) {
    const hrid = String(rawHrid || '');
    if (!hrid || !rawLevelQuotes || typeof rawLevelQuotes !== 'object') {
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
      if (level > 0 && normalizedQuote.ask > 0) {
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

async function fetchMarketplacePayload(fetchImpl, url, requestTimeoutMs) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutMs = Math.max(1, toFiniteNumber(requestTimeoutMs, MARKETPLACE_REQUEST_TIMEOUT_MS));
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      controller?.abort();
      const error = new Error(`Price request timed out after ${timeoutMs}ms: ${url}`);
      error.name = 'TimeoutError';
      reject(error);
    }, timeoutMs);
  });
  const requestPromise = (async () => {
    const response = await fetchImpl(url, {
      mode: 'cors',
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response?.ok) {
      throw new Error(`Price request failed: ${response?.status || 'unknown'}`);
    }
    return response.json();
  })();

  try {
    return await Promise.race([requestPromise, timeoutPromise]);
  } finally {
    if (timeoutId != null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

export async function fetchMarketPriceTable(
  fetchImpl = globalThis.fetch,
  { requestTimeoutMs = MARKETPLACE_REQUEST_TIMEOUT_MS } = {},
) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch API is unavailable in current environment.');
  }

  let lastError = null;

  for (const url of MARKETPLACE_SOURCE_URLS) {
    try {
      const payload = await fetchMarketplacePayload(fetchImpl, url, requestTimeoutMs);
      const marketData = payload?.marketData;
      const priceTable = hydratePriceTableWithMarketData(marketData);
      const { enhancementQuotesByItem, enhancementLevelsByItem } = extractEnhancementDataFromMarketData(marketData);
      return {
        sourceUrl: url,
        fetchedAt: Date.now(),
        marketTimestamp: Math.max(0, toFiniteNumber(payload?.timestamp, 0)),
        priceTable,
        enhancementQuotesByItem,
        enhancementLevelsByItem,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Unable to fetch market prices.');
}

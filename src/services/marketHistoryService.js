export const MARKET_HISTORY_MANIFEST_URL = "https://raw.githubusercontent.com/azhu949/mwi-market-history/master/data/manifest.json";
export const MARKET_HISTORY_REQUEST_TIMEOUT_MS = 10_000;
export const MARKET_HISTORY_CACHE_TTL_MS = 5 * 60_000;
export const MARKET_HISTORY_PRICE_SOURCE = "historical_ask";

function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveShardUrl(rawPath) {
    const path = String(rawPath || "").trim();
    const segments = path.split("/");
    if (
        !path.startsWith("items/")
        || path.includes("\\")
        || path.includes("?")
        || path.includes("#")
        || segments.some((segment) => !segment || segment === "." || segment === "..")
    ) {
        return "";
    }

    try {
        const url = new URL(path, MARKET_HISTORY_MANIFEST_URL);
        const manifestUrl = new URL(MARKET_HISTORY_MANIFEST_URL);
        const expectedPathPrefix = manifestUrl.pathname.slice(0, manifestUrl.pathname.lastIndexOf("/") + 1) + "items/";
        if (url.origin !== manifestUrl.origin || !url.pathname.startsWith(expectedPathPrefix)) {
            return "";
        }
        return url.toString();
    } catch (error) {
        return "";
    }
}

async function fetchJson(fetchImpl, url, requestTimeoutMs) {
    if (typeof fetchImpl !== "function") {
        throw new Error("Fetch API is unavailable in current environment.");
    }

    const timeoutMs = Math.max(1, toFiniteNumber(requestTimeoutMs, MARKET_HISTORY_REQUEST_TIMEOUT_MS));
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = globalThis.setTimeout(() => {
            controller?.abort();
            const error = new Error(`Market history request timed out after ${timeoutMs}ms: ${url}`);
            error.name = "TimeoutError";
            reject(error);
        }, timeoutMs);
    });
    const requestPromise = (async () => {
        const response = await fetchImpl(url, {
            mode: "cors",
            ...(controller ? { signal: controller.signal } : {}),
        });
        if (!response?.ok) {
            throw new Error(`Market history request failed: ${response?.status || "unknown"}`);
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

function selectLatestAsk(rows) {
    let latest = null;
    for (const row of Array.isArray(rows) ? rows : []) {
        const time = toFiniteNumber(row?.time, 0);
        const ask = toFiniteNumber(row?.a, 0);
        if (time <= 0 || ask <= 0 || (latest && time <= latest.marketTimestamp)) {
            continue;
        }
        const volume = toFiniteNumber(row?.v, 0);
        latest = {
            price: ask,
            volume: volume > 0 ? volume : null,
            marketTimestamp: time,
        };
    }
    return latest;
}

export function createMarketHistoryService({
    fetchImpl = null,
    requestTimeoutMs = MARKET_HISTORY_REQUEST_TIMEOUT_MS,
    cacheTtlMs = MARKET_HISTORY_CACHE_TTL_MS,
} = {}) {
    let manifestCache = null;
    let manifestPromise = null;
    const shardCache = new Map();
    const shardPromises = new Map();
    const resultCache = new Map();
    const resultPromises = new Map();
    const normalizedCacheTtlMs = Math.max(1, toFiniteNumber(cacheTtlMs, MARKET_HISTORY_CACHE_TTL_MS));

    const getFetchImpl = () => fetchImpl || globalThis.fetch;
    const createCacheEntry = (value) => ({
        value,
        expiresAt: Date.now() + normalizedCacheTtlMs,
    });
    const getCachedValue = (entry) => (
        entry && entry.expiresAt > Date.now() ? entry.value : undefined
    );

    async function loadManifest() {
        const cachedManifest = getCachedValue(manifestCache);
        if (cachedManifest !== undefined) {
            return cachedManifest;
        }
        manifestCache = null;
        if (!manifestPromise) {
            manifestPromise = fetchJson(getFetchImpl(), MARKET_HISTORY_MANIFEST_URL, requestTimeoutMs)
                .then((manifest) => {
                    if (!isPlainObject(manifest) || !isPlainObject(manifest.items)) {
                        throw new Error("Market history manifest is malformed.");
                    }
                    manifestCache = createCacheEntry(manifest);
                    return manifest;
                })
                .finally(() => {
                    manifestPromise = null;
                });
        }
        return manifestPromise;
    }

    async function loadShard(path, url) {
        const cachedShard = getCachedValue(shardCache.get(path));
        if (cachedShard !== undefined) {
            return cachedShard;
        }
        shardCache.delete(path);
        if (!shardPromises.has(path)) {
            const promise = fetchJson(getFetchImpl(), url, requestTimeoutMs)
                .then((payload) => {
                    if (!isPlainObject(payload) || !Array.isArray(payload.rows)) {
                        throw new Error("Market history shard is malformed.");
                    }
                    shardCache.set(path, createCacheEntry(payload));
                    return payload;
                })
                .finally(() => {
                    shardPromises.delete(path);
                });
            shardPromises.set(path, promise);
        }
        return shardPromises.get(path);
    }

    async function queryLatestAsk(itemHrid, enhancementLevel) {
        const normalizedItemHrid = String(itemHrid || "");
        const normalizedLevel = Math.max(0, Math.floor(toFiniteNumber(enhancementLevel, 0)));
        if (!normalizedItemHrid) {
            return null;
        }

        const manifest = await loadManifest();
        const variant = manifest.items?.[normalizedItemHrid]?.variants?.[String(normalizedLevel)];
        const path = String(variant?.path || "");
        const shardUrl = resolveShardUrl(path);
        if (!path || !shardUrl) {
            return null;
        }

        const shard = await loadShard(path, shardUrl);
        if (
            (shard.itemHrid != null && String(shard.itemHrid) !== normalizedItemHrid)
            || (shard.variant != null && Number(shard.variant) !== normalizedLevel)
        ) {
            return null;
        }

        const latest = selectLatestAsk(shard.rows);
        if (!latest) {
            return null;
        }
        return {
            itemHrid: normalizedItemHrid,
            enhancementLevel: normalizedLevel,
            source: MARKET_HISTORY_PRICE_SOURCE,
            ...latest,
        };
    }

    async function getLatestAsk(itemHrid, enhancementLevel) {
        const normalizedItemHrid = String(itemHrid || "");
        const normalizedLevel = Math.max(0, Math.floor(toFiniteNumber(enhancementLevel, 0)));
        const key = `${normalizedItemHrid}|${normalizedLevel}`;
        if (!normalizedItemHrid) {
            return null;
        }
        const cachedResult = getCachedValue(resultCache.get(key));
        if (cachedResult !== undefined) {
            return cachedResult;
        }
        resultCache.delete(key);
        if (!resultPromises.has(key)) {
            const promise = queryLatestAsk(normalizedItemHrid, normalizedLevel)
                .then((result) => {
                    if (result) {
                        resultCache.set(key, createCacheEntry(result));
                    }
                    return result;
                })
                .catch(() => null)
                .finally(() => {
                    resultPromises.delete(key);
                });
            resultPromises.set(key, promise);
        }
        return resultPromises.get(key);
    }

    function clearCache() {
        manifestCache = null;
        manifestPromise = null;
        shardCache.clear();
        shardPromises.clear();
        resultCache.clear();
        resultPromises.clear();
    }

    return {
        getLatestAsk,
        clearCache,
    };
}

const marketHistoryService = createMarketHistoryService();

export default marketHistoryService;

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MARKET_HISTORY_MANIFEST_URL, createMarketHistoryService } from '../marketHistoryService.js';

function jsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload,
  };
}

function createManifest(path = 'items/items_test_sword__7.json') {
  return {
    items: {
      '/items/test_sword': {
        variants: {
          7: { path },
        },
      },
    },
  };
}

describe('marketHistoryService', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses the manifest path and selects the newest valid Ask from unsorted rows', async () => {
    const shardPath = 'items/custom-history-shard.json';
    const fetchImpl = vi.fn(async (url) => {
      if (url === MARKET_HISTORY_MANIFEST_URL) {
        return jsonResponse(createManifest(shardPath));
      }
      return jsonResponse({
        itemHrid: '/items/test_sword',
        variant: 7,
        rows: [
          { time: 200, a: 0, v: 9 },
          { time: 100, a: 120, v: 2 },
          { time: 300, a: -1, v: 4 },
          { time: 250, a: 180, v: 6 },
        ],
      });
    });
    const service = createMarketHistoryService({ fetchImpl });

    await expect(service.getLatestAsk('/items/test_sword', 7)).resolves.toEqual({
      itemHrid: '/items/test_sword',
      enhancementLevel: 7,
      source: 'historical_ask',
      price: 180,
      volume: 6,
      marketTimestamp: 250,
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://raw.githubusercontent.com/azhu949/mwi-market-history/master/data/items/custom-history-shard.json',
      expect.any(Object),
    );
  });

  it('keeps a valid Ask when historical volume is missing', async () => {
    const fetchImpl = vi.fn(async (url) =>
      url === MARKET_HISTORY_MANIFEST_URL
        ? jsonResponse(createManifest())
        : jsonResponse({ rows: [{ time: 123, a: 456 }] }),
    );
    const service = createMarketHistoryService({ fetchImpl });

    await expect(service.getLatestAsk('/items/test_sword', 7)).resolves.toMatchObject({
      price: 456,
      volume: null,
      marketTimestamp: 123,
    });
  });

  it('returns null for invalid rows, missing variants, and unsafe paths', async () => {
    const invalidRowsFetch = vi.fn(async (url) =>
      url === MARKET_HISTORY_MANIFEST_URL
        ? jsonResponse(createManifest())
        : jsonResponse({
            rows: [
              { time: 0, a: 100 },
              { time: 10, a: 0 },
            ],
          }),
    );
    const invalidRowsService = createMarketHistoryService({ fetchImpl: invalidRowsFetch });
    await expect(invalidRowsService.getLatestAsk('/items/test_sword', 7)).resolves.toBeNull();

    const missingVariantFetch = vi.fn(async () => jsonResponse({ items: {} }));
    const missingVariantService = createMarketHistoryService({ fetchImpl: missingVariantFetch });
    await expect(missingVariantService.getLatestAsk('/items/test_sword', 7)).resolves.toBeNull();
    expect(missingVariantFetch).toHaveBeenCalledTimes(1);

    const missingPathFetch = vi.fn(async () => jsonResponse(createManifest('')));
    const missingPathService = createMarketHistoryService({ fetchImpl: missingPathFetch });
    await expect(missingPathService.getLatestAsk('/items/test_sword', 7)).resolves.toBeNull();
    expect(missingPathFetch).toHaveBeenCalledTimes(1);

    const unsafePathFetch = vi.fn(async () => jsonResponse(createManifest('../private.json')));
    const unsafePathService = createMarketHistoryService({ fetchImpl: unsafePathFetch });
    await expect(unsafePathService.getLatestAsk('/items/test_sword', 7)).resolves.toBeNull();
    expect(unsafePathFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null when a request times out and aborts it', async () => {
    vi.useFakeTimers();
    let signal = null;
    const fetchImpl = vi.fn((url, options = {}) => {
      signal = options.signal;
      return new Promise(() => {});
    });
    const service = createMarketHistoryService({ fetchImpl, requestTimeoutMs: 25 });

    const resultPromise = service.getLatestAsk('/items/test_sword', 7);
    await vi.advanceTimersByTimeAsync(25);

    await expect(resultPromise).resolves.toBeNull();
    expect(signal?.aborted).toBe(true);
  });

  it('returns null for malformed JSON responses', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    }));
    const service = createMarketHistoryService({ fetchImpl });

    await expect(service.getLatestAsk('/items/test_sword', 7)).resolves.toBeNull();
  });

  it('deduplicates concurrent requests and caches successful results within the TTL', async () => {
    const fetchImpl = vi.fn(async (url) =>
      url === MARKET_HISTORY_MANIFEST_URL
        ? jsonResponse(createManifest())
        : jsonResponse({ rows: [{ time: 321, a: 654, v: 3 }] }),
    );
    const service = createMarketHistoryService({ fetchImpl });

    const [first, second] = await Promise.all([
      service.getLatestAsk('/items/test_sword', 7),
      service.getLatestAsk('/items/test_sword', 7),
    ]);
    const cached = await service.getLatestAsk('/items/test_sword', 7);

    expect(first).toEqual(second);
    expect(cached).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('refreshes the manifest, shard, and result after the cache TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T00:00:00Z'));
    let revision = 1;
    const fetchImpl = vi.fn(async (url) =>
      url === MARKET_HISTORY_MANIFEST_URL
        ? jsonResponse(createManifest())
        : jsonResponse({ rows: [{ time: revision * 100, a: revision * 500, v: revision }] }),
    );
    const service = createMarketHistoryService({ fetchImpl, cacheTtlMs: 1_000 });

    await expect(service.getLatestAsk('/items/test_sword', 7)).resolves.toMatchObject({
      price: 500,
      marketTimestamp: 100,
    });
    revision = 2;
    await expect(service.getLatestAsk('/items/test_sword', 7)).resolves.toMatchObject({ price: 500 });

    await vi.advanceTimersByTimeAsync(1_001);

    await expect(service.getLatestAsk('/items/test_sword', 7)).resolves.toMatchObject({
      price: 1_000,
      marketTimestamp: 200,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});

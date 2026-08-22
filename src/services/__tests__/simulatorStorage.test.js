import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPricingState,
  getStorageItem,
  hasMeaningfulPlayerSnapshotData,
  loadPlayerDataSnapshotFromStorage,
  loadSimulationUiSettingsFromStorage,
  loadEquipmentSetsFromStorage,
  loadQueueRunSettingsByPlayerFromStorage,
  normalizeSimulationUiSettings,
  normalizeStoredPlayerDataMap,
  persistSimulationUiSettingsToStorage,
  readJsonStorage,
  removeStorageItem,
  setJsonStorage,
} from '../simulatorStorage.js';

const PLAYER_DATA_SNAPSHOT_STORAGE_KEY = 'mwi.player.data.snapshot.v1';
const QUEUE_RUN_SETTINGS_STORAGE_KEY = 'mwi.queue.runSettings.v1';
const PRICE_SETTINGS_STORAGE_KEY = 'mwi.price.settings.v1';
const PRICE_MARKET_CACHE_STORAGE_KEY = 'mwi.price.marketCache.v1';
const SIMULATION_UI_STORAGE_KEY = 'mwi.simulation.ui.v1';

function createMemoryStorage(initialValues = {}) {
  const data = new Map(Object.entries(initialValues));

  return {
    data,
    getItem: vi.fn((key) => data.get(key) ?? null),
    setItem: vi.fn((key, value) => {
      data.set(key, String(value));
    }),
    removeItem: vi.fn((key) => {
      data.delete(key);
    }),
  };
}

function createMeaningfulPlayerSnapshot(overrides = {}) {
  return JSON.stringify({
    player: {
      levels: {
        stamina: 2,
        ...(overrides.levels || {}),
      },
      ...(overrides.player || {}),
    },
    ...(overrides.root || {}),
  });
}

describe('simulatorStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads JSON objects and falls back for missing, invalid, or non-object values', () => {
    const fallback = { ok: false };
    const storage = createMemoryStorage({
      settings: JSON.stringify({ ok: true }),
      broken: '{',
      arrayValue: JSON.stringify(['kept']),
    });

    expect(readJsonStorage('settings', { storage, fallback })).toEqual({ ok: true });
    expect(readJsonStorage('missing', { storage, fallback })).toBe(fallback);
    expect(readJsonStorage('broken', { storage, fallback })).toBe(fallback);
    expect(readJsonStorage('arrayValue', { storage, fallback })).toBe(fallback);
    expect(
      readJsonStorage('arrayValue', {
        storage,
        fallback,
        requirePlainObject: false,
      }),
    ).toEqual(['kept']);
  });

  it('gets raw storage values with fallback and unavailable-storage errors', () => {
    const storage = createMemoryStorage({ language: 'zh', empty: '' });

    expect(getStorageItem('language', { storage, fallback: 'en' })).toBe('zh');
    expect(getStorageItem('missing', { storage, fallback: 'en' })).toBe('en');
    expect(getStorageItem('missing', { storage })).toBeNull();
    expect(getStorageItem('empty', { storage, fallback: 'en' })).toBe('en');
    expect(getStorageItem('language', { storage: null, fallback: 'en' })).toBe('en');
    expect(() =>
      getStorageItem('language', {
        storage: null,
        throwIfUnavailable: true,
      }),
    ).toThrow('localStorage unavailable');
  });

  it('falls back for storage read errors unless throwing is requested', () => {
    const storage = createMemoryStorage();
    storage.getItem.mockImplementation(() => {
      throw new Error('storage blocked');
    });

    expect(getStorageItem('language', { storage, fallback: 'en' })).toBe('en');
    expect(() =>
      getStorageItem('language', {
        storage,
        throwIfUnavailable: true,
      }),
    ).toThrow('storage blocked');
  });

  it('writes JSON and reports unavailable storage without throwing by default', () => {
    const storage = createMemoryStorage();

    expect(setJsonStorage('settings', { enabled: true }, { storage })).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith('settings', JSON.stringify({ enabled: true }));
    expect(storage.data.get('settings')).toBe(JSON.stringify({ enabled: true }));
    expect(setJsonStorage('settings', { enabled: false }, { storage: null })).toBe(false);
  });

  it('defaults combat scroll effects off while preserving an explicit opt-in', () => {
    expect(normalizeSimulationUiSettings({}).combatScrollsEnabled).toBe(false);
    expect(normalizeSimulationUiSettings({ combatScrollsEnabled: true }).combatScrollsEnabled).toBe(true);

    const storage = createMemoryStorage({
      [SIMULATION_UI_STORAGE_KEY]: JSON.stringify({}),
    });
    vi.stubGlobal('localStorage', storage);
    expect(loadSimulationUiSettingsFromStorage().combatScrollsEnabled).toBe(false);

    storage.data.set(SIMULATION_UI_STORAGE_KEY, JSON.stringify({ combatScrollsEnabled: true }));
    expect(loadSimulationUiSettingsFromStorage().combatScrollsEnabled).toBe(true);
  });

  it('defaults HP/MP visualization on and preserves the persisted choice', () => {
    expect(normalizeSimulationUiSettings({}).enableHpMpVisualization).toBe(false);
    expect(normalizeSimulationUiSettings({ enableHpMpVisualization: true }).enableHpMpVisualization).toBe(true);

    const storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
    expect(loadSimulationUiSettingsFromStorage().enableHpMpVisualization).toBe(true);

    persistSimulationUiSettingsToStorage({ enableHpMpVisualization: false });
    expect(JSON.parse(storage.data.get(SIMULATION_UI_STORAGE_KEY)).enableHpMpVisualization).toBe(false);
    expect(loadSimulationUiSettingsFromStorage().enableHpMpVisualization).toBe(false);
  });

  it('throws the existing unavailable-storage error when requested for writes', () => {
    expect(() =>
      setJsonStorage(
        'settings',
        {},
        {
          storage: null,
          throwIfUnavailable: true,
        },
      ),
    ).toThrow('localStorage unavailable');
  });

  it('reports storage write errors without throwing by default', () => {
    const storage = createMemoryStorage();
    storage.setItem.mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(setJsonStorage('settings', { enabled: true }, { storage })).toBe(false);
    expect(() =>
      setJsonStorage(
        'settings',
        { enabled: true },
        {
          storage,
          throwIfUnavailable: true,
        },
      ),
    ).toThrow('quota exceeded');
  });

  it('removes items and preserves the silent-or-throw unavailable behavior', () => {
    const storage = createMemoryStorage({ settings: '{}' });

    expect(removeStorageItem('settings', { storage })).toBe(true);
    expect(storage.removeItem).toHaveBeenCalledWith('settings');
    expect(storage.data.has('settings')).toBe(false);
    expect(removeStorageItem('settings', { storage: null })).toBe(false);
    expect(() =>
      removeStorageItem('settings', {
        storage: null,
        throwIfUnavailable: true,
      }),
    ).toThrow('localStorage unavailable');
  });

  it('loads equipment sets without crashing when startup normalization cannot write back', () => {
    const storage = createMemoryStorage({
      'mwi.equipmentSets.v2': JSON.stringify({
        Farming: {
          savedAt: 123,
          queueChanges: { items: [] },
        },
      }),
    });
    storage.setItem.mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    vi.stubGlobal('localStorage', storage);

    expect(loadEquipmentSetsFromStorage()).toEqual({
      Farming: {
        savedAt: 123,
        queueChanges: {
          version: 1,
          items: [],
        },
      },
    });
  });

  it('does not write back already-normalized equipment sets on startup', () => {
    const storage = createMemoryStorage({
      'mwi.equipmentSets.v2': JSON.stringify({
        Farming: {
          savedAt: 123,
          queueChanges: {
            version: 1,
            items: [],
          },
        },
      }),
    });
    vi.stubGlobal('localStorage', storage);

    expect(loadEquipmentSetsFromStorage()).toEqual({
      Farming: {
        savedAt: 123,
        queueChanges: {
          version: 1,
          items: [],
        },
      },
    });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('writes back equipment sets only when normalization changes storage data', () => {
    const storage = createMemoryStorage({
      'mwi.equipmentSets.v2': JSON.stringify({
        ' Farming ': {
          savedAt: '123',
          queueChanges: {
            items: [],
          },
        },
        Legacy: {
          snapshot: {},
        },
      }),
    });
    vi.stubGlobal('localStorage', storage);

    expect(loadEquipmentSetsFromStorage()).toEqual({
      Farming: {
        savedAt: 123,
        queueChanges: {
          version: 1,
          items: [],
        },
      },
    });
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.data.get('mwi.equipmentSets.v2'))).toEqual({
      Farming: {
        savedAt: 123,
        queueChanges: {
          version: 1,
          items: [],
        },
      },
    });
  });

  it('normalizes stored player data maps for partial and complete snapshot sets', () => {
    const validSnapshot = createMeaningfulPlayerSnapshot();
    const fullMap = {
      1: validSnapshot,
      2: createMeaningfulPlayerSnapshot({ levels: { attack: 3 } }),
      3: createMeaningfulPlayerSnapshot({ levels: { defense: 4 } }),
      4: createMeaningfulPlayerSnapshot({ levels: { magic: 5 } }),
      5: createMeaningfulPlayerSnapshot({ levels: { ranged: 6 } }),
    };

    expect(
      normalizeStoredPlayerDataMap(
        {
          1: validSnapshot,
          2: '',
        },
        true,
      ),
    ).toEqual({ 1: validSnapshot });
    expect(normalizeStoredPlayerDataMap(fullMap, false)).toEqual(fullMap);
    expect(
      normalizeStoredPlayerDataMap(
        {
          ...fullMap,
          5: '',
        },
        false,
      ),
    ).toBeNull();
    expect(
      normalizeStoredPlayerDataMap(
        {
          1: JSON.stringify({ player: { levels: { stamina: 1 } } }),
        },
        true,
      ),
    ).toBeNull();
    expect(
      normalizeStoredPlayerDataMap(
        {
          1: validSnapshot,
          2: '{',
        },
        true,
      ),
    ).toEqual({ 1: validSnapshot });
    expect(normalizeStoredPlayerDataMap({ 1: '{' }, true)).toBeNull();
  });

  it('treats a manually configured combat scroll as meaningful snapshot data', () => {
    expect(
      hasMeaningfulPlayerSnapshotData({
        player: {
          levels: { stamina: 1 },
          equipment: {},
          combatScrolls: {
            '/items/seal_of_damage': { quantity: null },
          },
        },
      }),
    ).toBe(true);
  });

  it('loads player data snapshots with explicit ok, missing, and invalid statuses', () => {
    const playerSnapshot = createMeaningfulPlayerSnapshot();
    const storage = createMemoryStorage({
      [PLAYER_DATA_SNAPSHOT_STORAGE_KEY]: JSON.stringify({
        version: 1,
        savedAt: '123',
        playerDataMap: {
          1: playerSnapshot,
          2: '',
        },
      }),
    });
    vi.stubGlobal('localStorage', storage);

    expect(loadPlayerDataSnapshotFromStorage()).toEqual({
      status: 'ok',
      savedAt: 123,
      playerDataMap: {
        1: playerSnapshot,
      },
    });

    storage.data.set(
      PLAYER_DATA_SNAPSHOT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: '124',
        playerDataMap: {
          1: playerSnapshot,
          2: '{',
        },
      }),
    );
    expect(loadPlayerDataSnapshotFromStorage()).toEqual({
      status: 'ok',
      savedAt: 124,
      playerDataMap: {
        1: playerSnapshot,
      },
    });

    storage.data.delete(PLAYER_DATA_SNAPSHOT_STORAGE_KEY);
    expect(loadPlayerDataSnapshotFromStorage()).toEqual({
      status: 'not_found',
      savedAt: 0,
      playerDataMap: {},
    });

    storage.data.set(
      PLAYER_DATA_SNAPSHOT_STORAGE_KEY,
      JSON.stringify({
        version: 999,
        playerDataMap: {
          1: playerSnapshot,
        },
      }),
    );
    expect(loadPlayerDataSnapshotFromStorage()).toEqual({
      status: 'invalid',
      savedAt: 0,
      playerDataMap: {},
    });
  });

  it('loads and normalizes queue run settings by player', () => {
    const storage = createMemoryStorage({
      [QUEUE_RUN_SETTINGS_STORAGE_KEY]: JSON.stringify({
        version: 1,
        savedAt: 456,
        byPlayer: {
          1: {
            rounds: 12,
            baselineRounds: 7,
            medianBlend: 0.25,
            weightProfit: 1,
            weightXp: 0,
            weightDeathSafety: 0,
            executionMode: 'serial',
          },
          2: {
            rounds: 999,
            baselineRounds: 0,
            medianBlend: -1,
            executionMode: 'parallel',
          },
          'not-a-player': {
            rounds: 5,
          },
        },
      }),
    });
    vi.stubGlobal('localStorage', storage);

    const loadedSettings = loadQueueRunSettingsByPlayerFromStorage();
    expect(loadedSettings).toMatchObject({
      1: {
        rounds: 12,
        baselineRounds: 7,
        medianBlend: 0.25,
        weightProfit: 1,
        weightXp: 0,
        weightDeathSafety: 0,
        executionMode: 'serial',
      },
      2: {
        rounds: 200,
        baselineRounds: 1,
        medianBlend: 0,
        weightProfit: 0.5,
        weightXp: 0.3,
        executionMode: 'parallel',
      },
    });
    expect(loadedSettings['2'].weightDeathSafety).toBeCloseTo(0.2, 6);

    storage.data.set(QUEUE_RUN_SETTINGS_STORAGE_KEY, JSON.stringify({ version: 999 }));
    expect(loadQueueRunSettingsByPlayerFromStorage()).toEqual({});
  });

  it('creates pricing state from persisted settings, market cache, and overrides', () => {
    const storage = createMemoryStorage({
      [PRICE_SETTINGS_STORAGE_KEY]: JSON.stringify({
        consumableMode: 'bid',
        dropMode: 'ask',
        overrides: {
          '/items/test_item': {
            ask: 7,
            bid: 3,
          },
          '/items/ignored': {
            ask: -1,
          },
        },
      }),
      [PRICE_MARKET_CACHE_STORAGE_KEY]: JSON.stringify({
        basePriceTable: {
          '/items/test_item': {
            ask: 5,
            bid: 2,
            vendor: 1,
          },
        },
        enhancementQuotesByItem: {
          '/items/test_sword': {
            2: {
              ask: 100,
              bid: 80,
            },
          },
        },
        enhancementLevelsByItem: {
          '/items/test_sword': [2, 'bad', 1, 2],
        },
        marketTimestamp: 90,
        lastFetchedAt: 100,
        sourceUrl: 'https://example.test/prices.json',
      }),
    });
    vi.stubGlobal('localStorage', storage);

    const pricingState = createPricingState();

    expect(pricingState.consumableMode).toBe('bid');
    expect(pricingState.dropMode).toBe('ask');
    expect(pricingState.basePriceTable['/items/test_item']).toEqual({
      ask: 5,
      bid: 2,
      vendor: 1,
    });
    expect(pricingState.priceTable['/items/test_item']).toEqual({
      ask: 7,
      bid: 3,
      vendor: 1,
    });
    expect(pricingState.enhancementQuotesByItem['/items/test_sword']['2']).toMatchObject({
      ask: 100,
      bid: 80,
    });
    expect(pricingState.enhancementLevelsByItem['/items/test_sword']).toEqual([1, 2]);
    expect(pricingState.marketTimestamp).toBe(90);
    expect(pricingState.lastFetchedAt).toBe(100);
    expect(pricingState.sourceUrl).toBe('https://example.test/prices.json');
    expect(pricingState.isLoading).toBe(false);
    expect(pricingState.error).toBe('');
  });
});

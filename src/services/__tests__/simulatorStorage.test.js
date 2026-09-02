import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPricingState,
  getStorageItem,
  hasMeaningfulPlayerSnapshotData,
  loadPlayerDataSnapshotFromStorage,
  loadSimulationUiSettingsFromStorage,
  loadEquipmentSetsFromStorage,
  loadQueueRunSettingsByPlayerFromStorage,
  normalizeMarketItemValues,
  normalizeMarketItemValueSources,
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
        marketItemValues: {
          '/items/test_item': { 0: 12345 },
        },
        marketItemValueSources: {
          '/items/test_item': 'synthetic',
          '/items/bad': 'nope',
        },
        marketItemValueSourcesByLevel: {
          '/items/test_item': { 0: 'synthetic', 1.7: 'synthetic', bad: 'synthetic', '-1': 'official' },
          '/items/bad': { 0: 'nope' },
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
    expect(pricingState.marketItemValues).toEqual({ '/items/test_item': { 0: 12345 } });
    // A3：来源标注随市场缓存恢复（白名单外条目丢弃）。
    expect(pricingState.marketItemValueSources).toEqual({ '/items/test_item': 'synthetic' });
    // 【一般-5】等级级来源覆盖随市场缓存恢复（白名单外条目丢弃；等级键与
    // normalizeMarketItemValues 同语义归一化——'1.7'→'1'、非数值/负数丢弃）。
    expect(pricingState.marketItemValueSourcesByLevel).toEqual({
      '/items/test_item': { 0: 'synthetic', 1: 'synthetic' },
    });
    expect(pricingState.marketTimestamp).toBe(90);
    expect(pricingState.lastFetchedAt).toBe(100);
    expect(pricingState.sourceUrl).toBe('https://example.test/prices.json');
    expect(pricingState.isLoading).toBe(false);
    expect(pricingState.error).toBe('');
  });

  describe('normalizeMarketItemValues（#33 形状校验直测）', () => {
    it('保留合法条目并把等级键归一化为非负整数字符串（小数向下取整）', () => {
      expect(normalizeMarketItemValues({ '/items/foo': { 0: 100, 1.7: 250 } })).toEqual({
        '/items/foo': { 0: 100, 1: 250 },
      });
    });

    it('非对象输入返回空对象', () => {
      expect(normalizeMarketItemValues(null)).toEqual({});
      expect(normalizeMarketItemValues([['/items/foo', { 0: 100 }]])).toEqual({});
      expect(normalizeMarketItemValues('nope')).toEqual({});
      expect(normalizeMarketItemValues(undefined)).toEqual({});
    });

    it('丢弃非 /items/ 前缀与原型污染危险键（__proto__ 键经 JSON 形态注入）', () => {
      const protoPayload = JSON.parse('{"__proto__": {"0": 100}, "/items/foo": {"0": 100}}');
      expect(normalizeMarketItemValues(protoPayload)).toEqual({ '/items/foo': { 0: 100 } });
      expect(normalizeMarketItemValues({ foo: { 0: 100 }, constructor: { 0: 100 } })).toEqual({});
    });

    it('丢弃非法等级（负数/非数值）与非法值（零/负/非有限）', () => {
      expect(
        normalizeMarketItemValues({
          '/items/foo': {
            '-1': 100,
            bad: 100,
            2: -50,
            3: 0,
            4: Infinity,
            5: 700,
          },
        }),
      ).toEqual({ '/items/foo': { 5: 700 } });
    });

    it('等级档为空、值为全非法或档位形态非对象时该物品整体丢弃', () => {
      expect(
        normalizeMarketItemValues({
          '/items/empty': {},
          '/items/invalid': { 0: 0 },
          '/items/notmap': null,
          '/items/notmap2': [100],
          '/items/ok': { 0: 100 },
        }),
      ).toEqual({ '/items/ok': { 0: 100 } });
    });
  });

  describe('normalizeMarketItemValueSources（#30 A3 形状校验直测）', () => {
    it('保留合法 hrid 与白名单值（official/synthetic）', () => {
      expect(
        normalizeMarketItemValueSources({
          '/items/foo': 'synthetic',
          '/items/bar': 'official',
        }),
      ).toEqual({
        '/items/foo': 'synthetic',
        '/items/bar': 'official',
      });
    });

    it('非对象输入返回空对象（旧缓存无该键 → 向后兼容）', () => {
      expect(normalizeMarketItemValueSources(null)).toEqual({});
      expect(normalizeMarketItemValueSources(undefined)).toEqual({});
      expect(normalizeMarketItemValueSources(['official'])).toEqual({});
      expect(normalizeMarketItemValueSources('synthetic')).toEqual({});
    });

    it('丢弃非法 hrid、危险键与非白名单值', () => {
      expect(
        normalizeMarketItemValueSources({
          foo: 'synthetic',
          constructor: 'official',
          '/items/bad': 'nope',
          '/items/empty': '',
          '/items/num': 1,
        }),
      ).toEqual({});
      const protoPayload = JSON.parse('{"__proto__": "synthetic", "/items/foo": "synthetic"}');
      expect(normalizeMarketItemValueSources(protoPayload)).toEqual({ '/items/foo': 'synthetic' });
    });
  });
});

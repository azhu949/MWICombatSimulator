import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPricingState,
  createProfitPricingOptions,
  getStorageItem,
  hasMeaningfulPlayerSnapshotData,
  loadAdvisorSettingsFromStorage,
  loadPlayerDataSnapshotFromStorage,
  loadSimulationUiSettingsFromStorage,
  loadEquipmentSetsFromStorage,
  loadQueueRunSettingsByPlayerFromStorage,
  normalizeAdvisorSettings,
  normalizeMarketItemValues,
  normalizeMarketItemValueSources,
  normalizePricingSettings,
  normalizeSimulationUiSettings,
  normalizeStoredPlayerDataMap,
  persistAdvisorSettingsToStorage,
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
const ADVISOR_SETTINGS_STORAGE_KEY = 'mwi.advisor.settings.v1';

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

  it('normalizePricingSettings 对旧载荷向后兼容并归一两个新键（T10）', () => {
    // 旧设置无新键 → nonTradableValuation=true / taxMode='market'（§4.1/§4.2 默认）。
    expect(normalizePricingSettings({})).toMatchObject({
      consumableMode: 'ask',
      dropMode: 'bid',
      nonTradableValuation: true,
      taxMode: 'market',
      overrides: {},
    });
    expect(normalizePricingSettings({ consumableMode: 'ask' })).toMatchObject({
      consumableMode: 'ask',
      nonTradableValuation: true,
      taxMode: 'market',
    });
    // 非对象输入同走空对象兜底。
    expect(normalizePricingSettings(null)).toMatchObject({ nonTradableValuation: true, taxMode: 'market' });
    expect(normalizePricingSettings('junk')).toMatchObject({ nonTradableValuation: true, taxMode: 'market' });

    // 显式合法值保留。
    expect(normalizePricingSettings({ nonTradableValuation: false, taxMode: 'none' })).toMatchObject({
      nonTradableValuation: false,
      taxMode: 'none',
    });
    // 存量 'all' 落盘值归一为 'market'（2026-09-04 两档决策的向后兼容锚点）。
    expect(normalizePricingSettings({ nonTradableValuation: false, taxMode: 'all' }).taxMode).toBe('market');

    // 非法 taxMode → 'market'；nonTradableValuation 仅严格 false 才关闭（§4.1）。
    expect(normalizePricingSettings({ taxMode: 'bogus' }).taxMode).toBe('market');
    expect(normalizePricingSettings({ nonTradableValuation: 'off' }).nonTradableValuation).toBe(true);
  });

  it('createPricingState 从旧缓存剥离重导出合成条目并携带两个新键（T11）', () => {
    // 旧缓存形态：开关关时代写入（宝箱合成值不含牛铃 + 牛铃 vendor=0），
    // 但表内已含铃袋行情（快照原貌）。
    const legacyChestValue = 102300;
    const createStaleCacheStorage = () =>
      createMemoryStorage({
        [PRICE_SETTINGS_STORAGE_KEY]: JSON.stringify({ consumableMode: 'bid', dropMode: 'ask' }),
        [PRICE_MARKET_CACHE_STORAGE_KEY]: JSON.stringify({
          basePriceTable: {
            '/items/bag_of_10_cowbells': { ask: 1090000, bid: 1060000, vendor: 0 },
            '/items/large_treasure_chest': {
              ask: legacyChestValue,
              bid: legacyChestValue,
              vendor: legacyChestValue,
            },
            '/items/cowbell': { ask: -1, bid: -1, vendor: 0 },
            '/items/coin': { ask: 1, bid: 1, vendor: 1 },
          },
          marketTimestamp: 90,
          lastFetchedAt: 100,
          sourceUrl: 'https://example.test/prices.json',
        }),
      });

    // 旧设置无新键 → 开关默认 true → 缓存旧宝箱值被剥离重导出、合成吃到牛铃
    //（袋 bid 已在缓存表，不触发任何 fetch；createPricingState 本身即同步纯函数）。
    const storageOn = createStaleCacheStorage();
    vi.stubGlobal('localStorage', storageOn);
    const stateOn = createPricingState();
    expect(stateOn.nonTradableValuation).toBe(true);
    expect(stateOn.taxMode).toBe('market');
    expect(stateOn.basePriceTable['/items/cowbell']).toEqual({ ask: -1, bid: -1, vendor: 106000 });
    expect(stateOn.basePriceTable['/items/large_treasure_chest'].bid).toBeGreaterThan(legacyChestValue);
    expect(stateOn.priceTable['/items/large_treasure_chest'].bid).toBe(
      stateOn.basePriceTable['/items/large_treasure_chest'].bid,
    );

    // 缓存不回写：持久化载荷保持快照原貌（牛铃仍为 0、宝箱仍为旧值）。
    const persistedCache = JSON.parse(storageOn.data.get(PRICE_MARKET_CACHE_STORAGE_KEY));
    expect(persistedCache.basePriceTable['/items/cowbell']).toEqual({ ask: -1, bid: -1, vendor: 0 });
    expect(persistedCache.basePriceTable['/items/large_treasure_chest'].bid).toBe(legacyChestValue);

    // 显式关（nonTradableValuation=false）→ 宝箱按新模型净额重算（'market' 默认档
    // 关档合成值 100,560，牛铃 18% 修订 §8.3），不再等于缓存里的旧烘焙值 102,300。
    const storageOff = createStaleCacheStorage();
    storageOff.data.set(
      PRICE_SETTINGS_STORAGE_KEY,
      JSON.stringify({ consumableMode: 'bid', dropMode: 'ask', nonTradableValuation: false }),
    );
    vi.stubGlobal('localStorage', storageOff);
    const stateOff = createPricingState();
    expect(stateOff.nonTradableValuation).toBe(false);
    expect(stateOff.taxMode).toBe('market');
    expect(stateOff.basePriceTable['/items/cowbell']).toEqual({ ask: -1, bid: -1, vendor: 0 });
    expect(stateOff.basePriceTable['/items/large_treasure_chest']).toEqual({
      ask: 100560,
      bid: 100560,
      vendor: 100560,
    });

    // taxMode 线程化（牛铃 18% 修订 §3.5-7）：显式 'none' → 宝箱合成回到税前锚点
    // 102,300（= pre-feature 基线，'none' 档全免税语义自洽）。
    const storageNone = createStaleCacheStorage();
    storageNone.data.set(
      PRICE_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        consumableMode: 'bid',
        dropMode: 'ask',
        nonTradableValuation: false,
        taxMode: 'none',
      }),
    );
    vi.stubGlobal('localStorage', storageNone);
    const stateNone = createPricingState();
    expect(stateNone.taxMode).toBe('none');
    expect(stateNone.basePriceTable['/items/cowbell']).toEqual({ ask: -1, bid: -1, vendor: 0 });
    expect(stateNone.basePriceTable['/items/large_treasure_chest']).toEqual({
      ask: 102300,
      bid: 102300,
      vendor: 102300,
    });
  });

  it('createProfitPricingOptions 线程化 taxMode 并保留缺键默认（T12）', () => {
    const priceTable = { '/items/test_item': { ask: 5, bid: 2, vendor: 1 } };
    expect(
      createProfitPricingOptions({
        consumableMode: 'bid',
        dropMode: 'ask',
        taxMode: 'none',
        priceTable,
      }),
    ).toEqual({
      consumableMode: 'bid',
      dropMode: 'ask',
      taxMode: 'none',
      priceTable,
    });

    // 缺键 / null / 非法值 → 'market'（现状锚点）。
    expect(createProfitPricingOptions({ consumableMode: 'bid', dropMode: 'ask' }).taxMode).toBe('market');
    expect(createProfitPricingOptions(null).taxMode).toBe('market');
    expect(createProfitPricingOptions({ taxMode: 'bogus' }).taxMode).toBe('market');
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

  describe('advisorSettings 持久化', () => {
    it('清洗脏数据并完成 round-trip（load 与 persist 输出一致）', () => {
      const storage = createMemoryStorage();
      vi.stubGlobal('localStorage', storage);

      const normalized = persistAdvisorSettingsToStorage({
        goalPreset: 'IRONCOW',
        customWeights: { profitPerHour: -3, xpPerHour: 1 },
        ironcowWeights: { dropsPerHour: 0.5, xpPerHour: 0.2, safety: 0.1 },
        filters: {
          includeGroupZones: false,
          includeSoloZones: true,
          quickRounds: 999,
          refineTopCount: 0,
          refineTopEnabled: false,
          dropItemHrids: ['  /items/marine_scale  ', '', '/items/marine_scale', '/items/pearl'],
        },
      });

      expect(normalized).toEqual({
        goalPreset: 'ironcow',
        customWeights: { profitPerHour: 0, xpPerHour: 0.9, safety: 0.1 },
        // 三权和 ≠ 1 → 回退默认 0.45/0.45/0.1
        ironcowWeights: { dropsPerHour: 0.45, xpPerHour: 0.45, safety: 0.1 },
        filters: {
          includeGroupZones: false,
          includeSoloZones: true,
          refineTopEnabled: false,
          refineTopCount: 1,
          refineRounds: 20,
          quickRounds: 10,
          dropItemHrids: ['/items/marine_scale', '/items/pearl'],
        },
      });

      const stored = JSON.parse(storage.data.get(ADVISOR_SETTINGS_STORAGE_KEY));
      expect(stored.version).toBe(1);
      expect(stored.savedAt).toBeGreaterThan(0);
      expect(loadAdvisorSettingsFromStorage()).toEqual(normalized);
    });

    it('对缺失、损坏与版本不匹配的载荷回退默认配置', () => {
      const storage = createMemoryStorage({
        [ADVISOR_SETTINGS_STORAGE_KEY]: '{broken',
      });
      vi.stubGlobal('localStorage', storage);

      const defaults = normalizeAdvisorSettings();
      expect(defaults.goalPreset).toBe('balanced');
      expect(defaults.filters.dropItemHrids).toEqual([]);
      expect(defaults.ironcowWeights).toEqual({ dropsPerHour: 0.45, xpPerHour: 0.45, safety: 0.1 });

      expect(loadAdvisorSettingsFromStorage()).toEqual(defaults);

      storage.data.set(ADVISOR_SETTINGS_STORAGE_KEY, JSON.stringify({ version: 999, goalPreset: 'ironcow' }));
      expect(loadAdvisorSettingsFromStorage()).toEqual(defaults);

      storage.data.set(ADVISOR_SETTINGS_STORAGE_KEY, JSON.stringify(['not', 'an', 'object']));
      expect(loadAdvisorSettingsFromStorage()).toEqual(defaults);

      storage.data.delete(ADVISOR_SETTINGS_STORAGE_KEY);
      expect(loadAdvisorSettingsFromStorage()).toEqual(defaults);
    });
  });
});

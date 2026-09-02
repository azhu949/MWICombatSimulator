import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import actionDetailMap from '../../combatsimulator/data/actionDetailMap.json';
import abilityDetailMap from '../../combatsimulator/data/abilityDetailMap.json';
import combatMonsterDetailMap from '../../combatsimulator/data/combatMonsterDetailMap.json';
import levelExperienceTable from '../../combatsimulator/data/levelExperienceTable.json';
import houseRoomDetailMap from '../../combatsimulator/data/houseRoomDetailMap.json';
import itemDetailMap from '../../combatsimulator/data/itemDetailMap.json';
import { combatGuildBuffDetails, combatGuildBuffHrids } from '../../shared/guildBuffs.js';
import {
  createMainSiteCurrentCharacterFixture,
  createMainSiteShareProfileFixture,
} from '../../services/__tests__/fixtures/mainSiteShareProfileFixture.js';
import workerClient from '../../services/workerClient.js';
import marketHistoryService from '../../services/marketHistoryService.js';
import {
  ASSET_SCORE_SOURCES,
  computeAssetScoreConfigSignature,
  computePlayerAssetScore,
} from '../../services/assetScoreService.js';
import { exportSoloConfig } from '../../services/importExportMapper.js';
import { createEmptyPlayerConfig } from '../../shared/playerConfig.js';
import { useSimulatorStore } from '../simulatorStore.js';
import { PHILOSOPHERS_MIRROR_ITEM_HRID } from '../../services/queueUpgradeCost.js';

const ONE_HOUR = 60 * 60 * 1e9;
const PLAYER_ACHIEVEMENTS_STORAGE_KEY = 'mwi.player.achievements.v1';
const QUEUE_SETTINGS_STORAGE_KEY = 'mwi.queue.settings.v1';
const QUEUE_RUN_SETTINGS_STORAGE_KEY = 'mwi.queue.runSettings.v1';
const ACHIEVEMENT_HRID = '/achievements/total_level_100';
const SECOND_ACHIEVEMENT_HRID = '/achievements/total_level_250';

function createLocalStorageMock() {
  const store = new Map();
  return {
    getItem: vi.fn((key) => (store.has(key) ? store.get(key) : null)),
    setItem: vi.fn((key, value) => {
      store.set(key, String(value));
    }),
    removeItem: vi.fn((key) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };
}

async function waitForCondition(predicate, timeoutMs = 100, intervalMs = 1) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
  }
  return predicate();
}

function findFirstPricedItem() {
  const item = Object.values(itemDetailMap).find((entry) => Number(entry?.sellPrice ?? 0) > 0);
  return item?.hrid ?? '';
}

function findFirstEquipmentItem() {
  const item = Object.values(itemDetailMap).find(
    (entry) =>
      entry?.categoryHrid === '/item_categories/equipment' &&
      String(entry?.equipmentDetail?.type || '').startsWith('/equipment_types/'),
  );
  return item?.hrid ?? '';
}

function setExactEquipmentAsk(simulator, itemHrid, level, ask) {
  simulator.pricing.enhancementQuotesByItem = {
    ...simulator.pricing.enhancementQuotesByItem,
    [itemHrid]: {
      ...(simulator.pricing.enhancementQuotesByItem?.[itemHrid] || {}),
      [String(level)]: { ask, bid: -1 },
    },
  };
}

function findFirstEquipmentItemByType(equipmentTypeHrid) {
  const item = Object.values(itemDetailMap).find(
    (entry) =>
      entry?.categoryHrid === '/item_categories/equipment' &&
      String(entry?.equipmentDetail?.type || '') === equipmentTypeHrid,
  );
  return item?.hrid ?? '';
}

function findFirstFoodWithDefaultTriggers() {
  const item = Object.values(itemDetailMap).find(
    (entry) =>
      entry.categoryHrid === '/item_categories/food' && Array.isArray(entry?.consumableDetail?.defaultCombatTriggers),
  );
  return item?.hrid ?? '';
}

function findFirstDrinkWithDefaultTriggers() {
  const item = Object.values(itemDetailMap).find(
    (entry) =>
      entry.categoryHrid === '/item_categories/drink' && Array.isArray(entry?.consumableDetail?.defaultCombatTriggers),
  );
  return item?.hrid ?? '';
}

function findFirstCombatAction(isDungeon = false) {
  const action = Object.values(actionDetailMap).find(
    (entry) =>
      String(entry?.type || '') === '/action_types/combat' && Boolean(entry?.combatZoneInfo?.isDungeon) === isDungeon,
  );
  return action?.hrid ?? '';
}

function findFirstAbilityWithDefaultTriggers(excludeHrid = '') {
  const ability = Object.values(abilityDetailMap).find(
    (entry) =>
      !entry.isSpecialAbility &&
      String(entry?.hrid || '') !== String(excludeHrid || '') &&
      Array.isArray(entry.defaultCombatTriggers),
  );
  return ability?.hrid ?? '';
}

function findFirstSpecialAbility() {
  const ability = Object.values(abilityDetailMap).find((entry) => entry?.isSpecialAbility === true);
  return ability?.hrid ?? '';
}

function findFirstAbilityBookInfo() {
  const item = Object.values(itemDetailMap).find(
    (entry) =>
      entry?.categoryHrid === '/item_categories/ability_book' &&
      String(entry?.abilityBookDetail?.abilityHrid || '').startsWith('/abilities/'),
  );
  if (!item) {
    return null;
  }
  return {
    abilityHrid: String(item.abilityBookDetail.abilityHrid || ''),
    xpPerBook: Number(item.abilityBookDetail.experienceGain || 0),
    bookItemHrid: String(item.hrid || ''),
  };
}

function findFirstMonsterHrid() {
  if (combatMonsterDetailMap['/monsters/porcupine']) {
    return '/monsters/porcupine';
  }
  const firstKey = Object.keys(combatMonsterDetailMap || {})[0];
  return String(firstKey || '');
}

function createMetricSummaryEntry(value, overrides = {}) {
  const numericValue = Number(value || 0);
  return {
    mean: numericValue,
    winsorizedMean: numericValue,
    robustMean: numericValue,
    min: numericValue,
    max: numericValue,
    std: 0,
    p50: numericValue,
    p90: numericValue,
    cv: 0,
    robustCv: 0,
    meanDeltaPct: 0,
    rawMeanDeltaPct: 0,
    winsorizedMeanDeltaPct: 0,
    medianDeltaPct: 0,
    robustMeanDeltaPct: 0,
    confidence: 1,
    confidenceDeltaPct: 1,
    sampleCount: 3,
    deltaSampleCount: 3,
    ...overrides,
  };
}

function setQueueBaselineMetrics(simulator, metrics = {}) {
  const normalizedMetrics = {
    encountersPerHour: Number(metrics.encountersPerHour ?? 100),
    deathsPerHour: Number(metrics.deathsPerHour ?? 0),
    totalXpPerHour: Number(metrics.totalXpPerHour ?? metrics.xpPerHour ?? 1000),
    profitPerHour: Number(metrics.profitPerHour ?? Number(metrics.dailyNoRngProfit ?? 2400) / 24),
    dps: Number(metrics.dps ?? 100),
    dailyNoRngProfit: Number(metrics.dailyNoRngProfit ?? 2400),
    xpPerHour: Number(metrics.xpPerHour ?? 1000),
    killsPerHour: Number(metrics.killsPerHour ?? 100),
  };

  simulator.activeQueueState.baseline.metrics = normalizedMetrics;
  simulator.activeQueueState.baseline.metricSummary = {
    encountersPerHour: createMetricSummaryEntry(normalizedMetrics.encountersPerHour),
    deathsPerHour: createMetricSummaryEntry(normalizedMetrics.deathsPerHour),
    totalXpPerHour: createMetricSummaryEntry(normalizedMetrics.totalXpPerHour),
    profitPerHour: createMetricSummaryEntry(normalizedMetrics.profitPerHour),
    dps: createMetricSummaryEntry(normalizedMetrics.dps),
    dailyNoRngProfit: createMetricSummaryEntry(normalizedMetrics.dailyNoRngProfit),
    xpPerHour: createMetricSummaryEntry(normalizedMetrics.xpPerHour),
    killsPerHour: createMetricSummaryEntry(normalizedMetrics.killsPerHour),
  };
  simulator.activeQueueState.baseline.completedRounds = 3;
}

function createQueueRawRun(entry, round, metrics = {}, baselineMetrics = {}) {
  const normalizedMetrics = {
    dps: Number(metrics.dps ?? baselineMetrics.dps ?? 0),
    dailyNoRngProfit: Number(metrics.dailyNoRngProfit ?? baselineMetrics.dailyNoRngProfit ?? 0),
    xpPerHour: Number(metrics.xpPerHour ?? baselineMetrics.xpPerHour ?? 0),
    killsPerHour: Number(metrics.killsPerHour ?? baselineMetrics.killsPerHour ?? 0),
  };
  const deltas = Object.fromEntries(
    Object.entries(normalizedMetrics).map(([metricKey, currentValue]) => {
      const baselineValue = Number(baselineMetrics?.[metricKey] ?? 0);
      const deltaAbs = currentValue - baselineValue;
      const deltaPct = Math.abs(baselineValue) <= 1e-9 ? null : (deltaAbs / baselineValue) * 100;
      return [
        metricKey,
        {
          abs: deltaAbs,
          pct: Number.isFinite(deltaPct) ? deltaPct : null,
        },
      ];
    }),
  );

  return {
    id: entry.id,
    label: entry.name || entry.id,
    changes: Array.isArray(entry.changes) ? [...entry.changes] : [],
    changeDetails: Array.isArray(entry.changeDetails) ? JSON.parse(JSON.stringify(entry.changeDetails)) : [],
    round,
    metrics: normalizedMetrics,
    deltas,
    profitPerHour: normalizedMetrics.dailyNoRngProfit / 24,
    totalXpPerHour: normalizedMetrics.xpPerHour,
    deathsPerHour: 0,
  };
}

function createQueueSimulationResult({
  encounters = 100,
  damage = 360000,
  staminaXp = 1000,
  monsterHrid = findFirstMonsterHrid(),
} = {}) {
  return {
    simulatedTime: ONE_HOUR,
    encounters,
    attacks: {
      player1: {
        autoAttack: {
          cast1: {
            [String(damage)]: 1,
          },
        },
      },
    },
    experienceGained: {
      player1: {
        stamina: staminaXp,
      },
    },
    deaths: {
      player1: 0,
      ...(monsterHrid ? { [monsterHrid]: encounters } : {}),
    },
    consumablesUsed: {},
  };
}

function findHouseRoomWithUpgradeLevels(minLevels = 1, excludeHrid = '') {
  return (
    Object.values(houseRoomDetailMap).find((entry) => {
      if (String(entry?.hrid || '') === String(excludeHrid || '')) {
        return false;
      }

      const upgradeLevels = Object.keys(entry?.upgradeCostsMap || {}).filter((level) => {
        const costs = entry?.upgradeCostsMap?.[level];
        return Array.isArray(costs) && costs.length > 0;
      });
      return upgradeLevels.length >= minLevels;
    }) ?? null
  );
}

function aggregateHouseRoomUpgradeCounts(roomHrid, fromLevel, toLevel) {
  const room = houseRoomDetailMap?.[roomHrid];
  const upgradeCostsMap = room?.upgradeCostsMap || {};
  const counts = {};

  for (let level = fromLevel + 1; level <= toLevel; level++) {
    const levelCosts = Array.isArray(upgradeCostsMap[String(level)]) ? upgradeCostsMap[String(level)] : [];
    for (const costEntry of levelCosts) {
      const itemHrid = String(costEntry?.itemHrid || '');
      const count = Number(costEntry?.count || 0);
      if (!itemHrid || !Number.isFinite(count) || count <= 0) {
        continue;
      }
      counts[itemHrid] = Number(counts[itemHrid] || 0) + count;
    }
  }

  return counts;
}

function mergeMaterialCountMaps(...maps) {
  return maps.reduce((acc, map) => {
    for (const [itemHrid, count] of Object.entries(map || {})) {
      acc[itemHrid] = Number(acc[itemHrid] || 0) + Number(count || 0);
    }
    return acc;
  }, {});
}

function resolvePreviewAskSidePrice(priceTable, itemHrid) {
  const normalizedItemHrid = String(itemHrid || '');
  if (!normalizedItemHrid) {
    return 0;
  }
  if (normalizedItemHrid === '/items/coin') {
    return 1;
  }

  const entry = priceTable?.[normalizedItemHrid] ?? {};
  const ask = Number(entry?.ask ?? -1);
  if (ask > 0) {
    return ask;
  }

  const vendorFallback = Number(itemDetailMap?.[normalizedItemHrid]?.sellPrice ?? 0);
  const vendor = Math.max(0, Number(entry?.vendor ?? vendorFallback));
  if (vendor > 0) {
    return vendor;
  }

  const bid = Number(entry?.bid ?? -1);
  return bid > 0 ? bid : 0;
}

function computePreviewTotalFromCounts(counts, priceTable) {
  return Object.entries(counts || {}).reduce((sum, [itemHrid, count]) => {
    const safeCount = Number(count || 0);
    if (!Number.isFinite(safeCount) || safeCount <= 0) {
      return sum;
    }
    const price = resolvePreviewAskSidePrice(priceTable, itemHrid);
    return sum + (itemHrid === '/items/coin' || price > 0 ? safeCount * price : 0);
  }, 0);
}

describe('simulatorStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    global.localStorage = createLocalStorageMock();
    marketHistoryService.clearCache();
  });

  afterEach(() => {
    delete global.fetch;
    delete global.window;
    delete global.jigsLevelExperienceTable;
    delete global.jigsSpellBookXpByName;
    vi.restoreAllMocks();
  });

  it('defaults simulation UI flags when missing storage', () => {
    const simulator = useSimulatorStore();

    expect(simulator.simulationSettings.mooPass).toBe(true);
    expect(simulator.simulationSettings.comExpEnabled).toBe(true);
    expect(simulator.simulationSettings.comDropEnabled).toBe(true);
    expect(simulator.simulationSettings.comExp).toBe(20);
    expect(simulator.simulationSettings.comDrop).toBe(20);
    expect(simulator.simulationSettings.enableHpMpVisualization).toBe(true);
  });

  it('does not override stored simulation UI flags', () => {
    global.localStorage.setItem(
      'mwi.simulation.ui.v1',
      JSON.stringify({
        mooPass: false,
        comExpEnabled: false,
        comExp: 17,
        comDropEnabled: false,
        comDrop: 18,
        enableHpMpVisualization: false,
      }),
    );

    const simulator = useSimulatorStore();

    expect(simulator.simulationSettings.mooPass).toBe(false);
    expect(simulator.simulationSettings.comExpEnabled).toBe(false);
    expect(simulator.simulationSettings.comDropEnabled).toBe(false);
    expect(simulator.simulationSettings.comExp).toBe(17);
    expect(simulator.simulationSettings.comDrop).toBe(18);
    expect(simulator.simulationSettings.enableHpMpVisualization).toBe(false);
  });

  it('refreshAssetScores：行情不可用时保留与配置一致的快照，配置变化后重算', () => {
    const simulator = useSimulatorStore();
    // 行情完全不可用（从未抓取且无透传值）。
    simulator.pricing.lastFetchedAt = 0;
    simulator.pricing.enhancementQuotesByItem = {};
    simulator.pricing.marketItemValues = {};

    const vendorPricedEntry = Object.entries(itemDetailMap).find(([, item]) => Number(item?.sellPrice || 0) > 0);
    expect(vendorPricedEntry).toBeTruthy();
    const vendorPricedHrid = String(vendorPricedEntry[0]);

    const player = simulator.players.find((entry) => String(entry.id) === String(simulator.activePlayerId));
    player.equipment.weapon = { itemHrid: vendorPricedHrid, enhancementLevel: 0 };
    simulator.refreshAssetScores();
    const initial = player.assetScore;
    expect(initial).not.toBeNull();
    expect(initial.configSignature).toBe(computeAssetScoreConfigSignature(player));

    // 配置未变 + 行情仍不可用 → 保留快照（不写回，引用不变）。
    simulator.refreshAssetScores();
    expect(player.assetScore).toBe(initial);

    // 配置变化（强化等级）→ 快照与配置脱节 → 重算并写回携带新签名的快照。
    player.equipment.weapon.enhancementLevel = 1;
    simulator.refreshAssetScores();
    expect(player.assetScore).not.toBe(initial);
    expect(player.assetScore.configSignature).toBe(computeAssetScoreConfigSignature(player));
    expect(player.assetScore.items.equipment[0].enhancementLevel).toBe(1);

    // 旧格式快照（无签名，如旧版本导出的 JSON）→ 向后兼容：维持旧兜底行为保留。
    player.assetScore = { ...initial, configSignature: undefined };
    const legacyHeld = player.assetScore;
    expect(legacyHeld.configSignature).toBeUndefined();
    player.equipment.weapon.enhancementLevel = 2;
    simulator.refreshAssetScores();
    expect(player.assetScore).toBe(legacyHeld);
  });

  it('refreshAssetScores：导入携带快照（无行情）端到端保留，改配置后重算', () => {
    const simulator = useSimulatorStore();

    // —— 导出方：内存配置（含 0 级房间/全 0 神龛/空技能槽的真实形状）算出快照后导出。
    const vendorPricedEntry = Object.entries(itemDetailMap).find(([, item]) => Number(item?.sellPrice || 0) > 0);
    expect(vendorPricedEntry).toBeTruthy();
    const combatRoomEntry = Object.values(houseRoomDetailMap).find(
      (room) => room?.usableInActionTypeMap?.['/action_types/combat'] === true && String(room?.hrid || ''),
    );
    expect(combatRoomEntry).toBeTruthy();

    const exportPlayer = createEmptyPlayerConfig(1);
    exportPlayer.equipment.weapon = { itemHrid: String(vendorPricedEntry[0]), enhancementLevel: 0 };
    exportPlayer.houseRooms[combatRoomEntry.hrid] = 5;
    exportPlayer.guildBuffs[combatGuildBuffHrids[0]] = 2;
    exportPlayer.abilities[0] = { abilityHrid: '/abilities/test_ability', level: 40 };
    const snapshot = computePlayerAssetScore(exportPlayer, {
      priceTable: {},
      enhancementQuotesByItem: {},
      marketItemValues: {},
      lastFetchedAt: Date.now(),
    });
    expect(snapshot).not.toBeNull();
    exportPlayer.assetScore = snapshot;
    const soloText = exportSoloConfig(exportPlayer, {});

    // —— 接收方：行情完全不可用导入 → refresh → 快照保留（签名跨 sanitize 无漂移）。
    simulator.pricing.lastFetchedAt = 0;
    simulator.pricing.enhancementQuotesByItem = {};
    simulator.pricing.marketItemValues = {};
    simulator.importSoloConfig(soloText, '1');
    const importedPlayer = simulator.players.find((entry) => String(entry.id) === '1');
    simulator.refreshAssetScores(['1']);
    expect(importedPlayer.assetScore).not.toBeNull();
    // 命门断言：导入后配置的签名与快照签名一致（跨 sanitize 无漂移）→ 守卫保留。
    expect(importedPlayer.assetScore.configSignature).toBe(computeAssetScoreConfigSignature(importedPlayer));
    expect(importedPlayer.assetScore.totalGold).toBe(snapshot.totalGold);

    // —— 接收方改配置 → 快照与配置脱节 → 必然写回带新签名的重算快照
    //（assetScoreEquals 比较含 configSignature 的完整载荷，签名不同即写回，即使数值巧合相同）。
    const heldSnapshot = importedPlayer.assetScore;
    importedPlayer.equipment.weapon.enhancementLevel = 2;
    simulator.refreshAssetScores(['1']);
    expect(importedPlayer.assetScore).not.toBe(heldSnapshot);
    expect(importedPlayer.assetScore.configSignature).toBe(computeAssetScoreConfigSignature(importedPlayer));
    expect(importedPlayer.assetScore.items.equipment[0].enhancementLevel).toBe(2);
  });

  // B4（2026-09-01）：targets 过滤的「未列入者被跳过」此前零覆盖——若回归（如漏
  // String 归一、Set 成员判定反转），导出前定点刷新（exportSoloConfig 只传单 id）
  // 会悄悄放大为全量重算，或反过来对未列入者漏算。
  it('refreshAssetScores(playerIds)：只刷新列入 id 的玩家，未列入者快照不被触碰', () => {
    const simulator = useSimulatorStore();

    // 无行情：列入者 '1' 走重算分支（快照从无到有）；未列入者 '2' 携带签名脱节的
    // 快照——若 targets 过滤失效，重算 + 等值守卫（完整载荷含 configSignature 比较）
    // 必然写回新引用，差分断言即可捕捉。
    simulator.pricing.lastFetchedAt = 0;
    simulator.pricing.marketItemValues = {};
    simulator.pricing.enhancementQuotesByItem = {};

    const skippedPlayer = simulator.players.find((entry) => String(entry.id) === '2');
    expect(skippedPlayer).toBeTruthy();
    // 两玩家各装一件有 vendor 卖店价的武器：空配置玩家重算会返回 null 快照
    //（无可计价资产），武器保证重算产物非空、签名断言有效。
    const vendorPricedEntry = Object.entries(itemDetailMap).find(([, item]) => Number(item?.sellPrice || 0) > 0);
    expect(vendorPricedEntry).toBeTruthy();
    skippedPlayer.equipment.weapon = { itemHrid: String(vendorPricedEntry[0]), enhancementLevel: 0 };
    const staleSnapshot = {
      version: 1,
      total: 1,
      totalGold: 1,
      sections: { equipment: 1, house: 0, abilities: 0, shrine: 0 },
      items: { equipment: [], houseRooms: [], abilities: [], shrine: [] },
      computedAt: 0,
      configSignature: 'stale-signature',
    };
    skippedPlayer.assetScore = staleSnapshot;
    // store 为 reactive：写入后取回代理引用做同一性比较（Vue 对同一 raw 对象恒返回
    // 同一代理，引用语义不受影响）。
    const staleRef = skippedPlayer.assetScore;

    const refreshedPlayer = simulator.players.find((entry) => String(entry.id) === '1');
    expect(refreshedPlayer).toBeTruthy();
    refreshedPlayer.equipment.weapon = { itemHrid: String(vendorPricedEntry[0]), enhancementLevel: 0 };

    simulator.refreshAssetScores(['1']);

    expect(refreshedPlayer.assetScore).not.toBeNull();
    expect(refreshedPlayer.assetScore.configSignature).toBe(computeAssetScoreConfigSignature(refreshedPlayer));
    expect(skippedPlayer.assetScore).toBe(staleRef);

    // 数字 id 传入：Set 构造的 String 归一保证与字符串玩家 id 匹配。
    simulator.refreshAssetScores([2]);
    expect(skippedPlayer.assetScore).not.toBe(staleRef);
    expect(skippedPlayer.assetScore.configSignature).toBe(computeAssetScoreConfigSignature(skippedPlayer));
  });

  it('importSoloConfig：native 载荷携带不同 id 时目标槽位身份保持、资产分即时刷新生效', () => {
    const simulator = useSimulatorStore();

    // 接收方行情可用：官方估算 ≠ vendor 价，与导出方快照（vendor 口径）可区分，
    // 用于锚定「导入后即时按接收方行情重算」而非沿用载荷携带的跨会话快照。
    // 夹具与既有 refreshAssetScores 用例同款：排除公会信用点兑换目标。
    const guildCreditTargets = new Set(
      Object.values(itemDetailMap).flatMap((item) =>
        (Array.isArray(item?.guildCreditConversions) ? item.guildCreditConversions : [])
          .map((conversion) => String(conversion?.creditItemHrid || ''))
          .filter(Boolean),
      ),
    );
    const vendorPricedEntry = Object.entries(itemDetailMap).find(
      ([hrid, item]) => Number(item?.sellPrice || 0) > 0 && !guildCreditTargets.has(String(hrid)),
    );
    expect(vendorPricedEntry).toBeTruthy();
    const weaponHrid = String(vendorPricedEntry[0]);
    const vendorPrice = Math.round(Number(vendorPricedEntry[1].sellPrice));
    const marketValue = vendorPrice * 10 + 7;
    simulator.pricing.lastFetchedAt = Date.now();
    simulator.pricing.marketItemValues = { [weaponHrid]: { 0: marketValue } };

    // 导出方：id '9'（接收方不存在），同一武器按空行情（vendor 兜底）算出快照后导出。
    const exportPlayer = createEmptyPlayerConfig(9);
    exportPlayer.equipment.weapon = { itemHrid: weaponHrid, enhancementLevel: 0 };
    exportPlayer.assetScore = computePlayerAssetScore(exportPlayer, {
      priceTable: {},
      enhancementQuotesByItem: {},
      marketItemValues: {},
      lastFetchedAt: Date.now(),
    });
    expect(exportPlayer.assetScore).not.toBeNull();
    expect(exportPlayer.assetScore.items.equipment[0]).toMatchObject({
      itemHrid: weaponHrid,
      value: vendorPrice,
      source: ASSET_SCORE_SOURCES.VENDOR,
    });
    const soloText = exportSoloConfig(exportPlayer, {});

    const result = simulator.importSoloConfig(soloText, '1');

    // 身份归一：返回玩家与列表内玩家 id 均为目标 id；无来源 id 残留、无重复 id。
    expect(result.player.id).toBe('1');
    const importedPlayer = simulator.players.find((entry) => String(entry.id) === '1');
    expect(importedPlayer).toBeTruthy();
    expect(simulator.players.some((entry) => String(entry.id) === '9')).toBe(false);
    expect(new Set(simulator.players.map((entry) => String(entry.id))).size).toBe(simulator.players.length);

    // 即时刷新生效：导入返回后未手动 refresh、无 watch 兜底，快照已按接收方行情重算
    //（官方估算口径 + 行情值）——若 id 漂移回归，此处仍是载荷携带的 vendor 快照。
    expect(importedPlayer.assetScore).not.toBeNull();
    expect(importedPlayer.assetScore.items.equipment[0]).toMatchObject({
      itemHrid: weaponHrid,
      value: marketValue,
      source: ASSET_SCORE_SOURCES.OFFICIAL_ESTIMATE,
    });

    // 重复 id 防护：载荷 id 撞上现有玩家（'2'）时，'2' 不被顶替污染，导入者仍落在目标槽位。
    const player2Before = simulator.players.find((entry) => String(entry.id) === '2');
    expect(player2Before).toBeTruthy();
    const collisionPlayer = createEmptyPlayerConfig(2);
    collisionPlayer.equipment.weapon = { itemHrid: weaponHrid, enhancementLevel: 0 };
    simulator.importSoloConfig(exportSoloConfig(collisionPlayer, {}), '1');
    expect(new Set(simulator.players.map((entry) => String(entry.id))).size).toBe(simulator.players.length);
    const player2After = simulator.players.find((entry) => String(entry.id) === '2');
    expect(player2After).toBe(player2Before);
    expect(player2After.equipment.weapon.itemHrid).toBe('');
  });

  it('refreshAssetScores：行情到达后重算覆盖 vendor 初算快照，等值守卫只挡同值', () => {
    const simulator = useSimulatorStore();
    // 行情不可用（从未抓取且无透传值）→ 初算走降级链 vendor 兜底。
    simulator.pricing.lastFetchedAt = 0;
    simulator.pricing.enhancementQuotesByItem = {};
    simulator.pricing.marketItemValues = {};

    // 排除公会信用点兑换目标（其取价链可能走 acquisition 而非 vendor），保证初算来源可精确断言。
    const guildCreditTargets = new Set(
      Object.values(itemDetailMap).flatMap((item) =>
        (Array.isArray(item?.guildCreditConversions) ? item.guildCreditConversions : [])
          .map((conversion) => String(conversion?.creditItemHrid || ''))
          .filter(Boolean),
      ),
    );
    const vendorPricedEntry = Object.entries(itemDetailMap).find(
      ([hrid, item]) => Number(item?.sellPrice || 0) > 0 && !guildCreditTargets.has(String(hrid)),
    );
    expect(vendorPricedEntry).toBeTruthy();
    const weaponHrid = String(vendorPricedEntry[0]);
    const vendorPrice = Math.round(Number(vendorPricedEntry[1].sellPrice));

    const player = simulator.players.find((entry) => String(entry.id) === String(simulator.activePlayerId));
    player.equipment.weapon = { itemHrid: weaponHrid, enhancementLevel: 0 };
    simulator.refreshAssetScores();
    const vendorSnapshot = player.assetScore;
    expect(vendorSnapshot).not.toBeNull();
    expect(vendorSnapshot.items.equipment[0]).toMatchObject({
      itemHrid: weaponHrid,
      value: vendorPrice,
      source: ASSET_SCORE_SOURCES.VENDOR,
    });

    // 行情到达（官方估算 ≠ vendor 价）→ pricingReady 恒重算，等值守卫不挡「应更新的不同值」→ 覆盖写回。
    const marketValue = vendorPrice * 10 + 7;
    simulator.pricing.lastFetchedAt = Date.now();
    simulator.pricing.marketItemValues = { [weaponHrid]: { 0: marketValue } };
    simulator.refreshAssetScores();
    const marketSnapshot = player.assetScore;
    expect(marketSnapshot).not.toBe(vendorSnapshot);
    expect(marketSnapshot.items.equipment[0]).toMatchObject({
      itemHrid: weaponHrid,
      value: marketValue,
      source: ASSET_SCORE_SOURCES.OFFICIAL_ESTIMATE,
    });
    expect(marketSnapshot.totalGold).not.toBe(vendorSnapshot.totalGold);

    // 同值重算（行情未再变化）→ 等值守卫挡住同值 → 引用不变（不写回——App.vue 资产分
    // watch 源只跟踪签名与行情引用，快照写回不构成触发）。
    simulator.refreshAssetScores();
    expect(player.assetScore).toBe(marketSnapshot);
  });

  it('sorts food options by restore type and duration', () => {
    const simulator = useSimulatorStore();

    function resolveFoodGroupId(option) {
      const item = itemDetailMap?.[String(option?.hrid || '')];
      const detail = item?.consumableDetail;
      const hitpointRestore = Number(detail?.hitpointRestore ?? 0);
      const manapointRestore = Number(detail?.manapointRestore ?? 0);
      const recoveryDuration = Number(detail?.recoveryDuration ?? 0);

      if (hitpointRestore > 0 && manapointRestore <= 0) {
        return recoveryDuration > 0 ? 1 : 0;
      }

      if (manapointRestore > 0 && hitpointRestore <= 0) {
        return recoveryDuration > 0 ? 3 : 2;
      }

      return 99;
    }

    const foodGroups = simulator.options.food.map(resolveFoodGroupId);
    expect(foodGroups).toContain(0);
    expect(foodGroups).toContain(1);
    expect(foodGroups).toContain(2);
    expect(foodGroups).toContain(3);

    for (let i = 1; i < foodGroups.length; i += 1) {
      expect(foodGroups[i]).toBeGreaterThanOrEqual(foodGroups[i - 1]);
    }
  });

  it('normalizes active queue settings', () => {
    const simulator = useSimulatorStore();

    const normalized = simulator.updateActiveQueueSettings({
      rounds: 999,
      baselineRounds: 999,
      medianBlend: 2,
      weightProfit: 2,
      weightXp: 3,
      weightDeathSafety: 5,
      executionMode: 'parallel',
    });

    expect(normalized.rounds).toBe(200);
    expect(normalized.baselineRounds).toBe(200);
    expect(normalized.medianBlend).toBe(1);
    expect(normalized.weightProfit).toBeCloseTo(0.4, 6);
    expect(normalized.weightXp).toBeCloseTo(0.6, 6);
    expect(normalized.weightDeathSafety).toBeCloseTo(0, 6);
    expect(normalized.executionMode).toBe('parallel');

    const zeroed = simulator.updateActiveQueueSettings({
      weightProfit: -1,
      weightXp: -1,
      weightDeathSafety: -1,
      executionMode: 'invalid-mode',
    });

    expect(zeroed.weightProfit).toBe(0);
    expect(zeroed.weightXp).toBe(0);
    expect(zeroed.weightDeathSafety).toBe(1);
    expect(zeroed.baselineRounds).toBe(200);
    expect(zeroed.executionMode).toBe('serial');

    const rounded = simulator.updateActiveQueueSettings({
      weightProfit: 0.25,
      weightXp: 0.85,
    });

    expect(rounded.weightProfit).toBeCloseTo(0.2, 6);
    expect(rounded.weightXp).toBeCloseTo(0.8, 6);
    expect(rounded.weightDeathSafety).toBeCloseTo(0, 6);

    const persisted = JSON.parse(global.localStorage.getItem(QUEUE_RUN_SETTINGS_STORAGE_KEY) || '{}');
    expect(persisted.byPlayer?.['1']?.rounds).toBe(200);
    expect(persisted.byPlayer?.['1']?.baselineRounds).toBe(200);
    expect(persisted.byPlayer?.['1']?.weightProfit).toBeCloseTo(0.2, 6);
    expect(persisted.byPlayer?.['1']?.weightXp).toBeCloseTo(0.8, 6);
  });

  it('loads stored queue run settings and migrates missing baselineRounds from rounds', () => {
    global.localStorage.setItem(
      QUEUE_RUN_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        byPlayer: {
          1: {
            rounds: 12,
            medianBlend: 0.25,
            weightProfit: 1,
            weightXp: 1,
            weightDeathSafety: 0,
            executionMode: 'serial',
          },
        },
      }),
    );

    const simulator = useSimulatorStore();

    expect(simulator.activeQueueState.settings.rounds).toBe(12);
    expect(simulator.activeQueueState.settings.baselineRounds).toBe(1);
    expect(simulator.activeQueueState.settings.executionMode).toBe('serial');
  });

  it('defaults baselineRounds to 1 for new queue settings', () => {
    const simulator = useSimulatorStore();

    expect(simulator.activeQueueState.settings.rounds).toBe(30);
    expect(simulator.activeQueueState.settings.baselineRounds).toBe(1);
  });

  it('keeps queue settings editable when queue run settings cannot be persisted', () => {
    const simulator = useSimulatorStore();
    global.localStorage.setItem.mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() =>
      simulator.updateActiveQueueSettings({
        rounds: 20,
        baselineRounds: 5,
        executionMode: 'serial',
      }),
    ).not.toThrow();

    expect(simulator.activeQueueState.settings.rounds).toBe(20);
    expect(simulator.activeQueueState.settings.baselineRounds).toBe(5);
    expect(simulator.activeQueueState.settings.executionMode).toBe('serial');
  });

  it('resets active queue run settings to defaults', () => {
    const simulator = useSimulatorStore();

    simulator.updateActiveQueueSettings({
      rounds: 99,
      baselineRounds: 7,
      medianBlend: 0.9,
      weightProfit: 0.1,
      weightXp: 0.8,
      executionMode: 'serial',
    });

    const reset = simulator.resetActiveQueueSettings();

    expect(reset.rounds).toBe(30);
    expect(reset.baselineRounds).toBe(1);
    expect(reset.medianBlend).toBeCloseTo(0.5, 6);
    expect(reset.weightProfit).toBeCloseTo(0.5, 6);
    expect(reset.weightXp).toBeCloseTo(0.3, 6);
    expect(reset.weightDeathSafety).toBeCloseTo(0.2, 6);
    expect(reset.executionMode).toBe('parallel');

    const persisted = JSON.parse(global.localStorage.getItem(QUEUE_RUN_SETTINGS_STORAGE_KEY) || '{}');
    expect(persisted.byPlayer?.['1']?.rounds).toBe(30);
    expect(persisted.byPlayer?.['1']?.baselineRounds).toBe(1);
    expect(persisted.byPlayer?.['1']?.medianBlend).toBeCloseTo(0.5, 6);
    expect(persisted.byPlayer?.['1']?.weightProfit).toBeCloseTo(0.5, 6);
    expect(persisted.byPlayer?.['1']?.weightXp).toBeCloseTo(0.3, 6);
    expect(persisted.byPlayer?.['1']?.weightDeathSafety).toBeCloseTo(0.2, 6);
    expect(persisted.byPlayer?.['1']?.executionMode).toBe('parallel');
  });

  it('rounds queue performance weights to one decimal place when unrelated settings change', () => {
    const simulator = useSimulatorStore();

    simulator.updateActiveQueueSettings({
      weightProfit: 0.25,
      weightXp: 0.35,
    });

    const updated = simulator.updateActiveQueueSettings({
      rounds: 40,
    });

    expect(updated.rounds).toBe(40);
    expect(updated.weightProfit).toBeCloseTo(0.3, 6);
    expect(updated.weightXp).toBeCloseTo(0.4, 6);
    expect(updated.weightDeathSafety).toBeCloseTo(0.3, 6);

    const persisted = JSON.parse(global.localStorage.getItem(QUEUE_RUN_SETTINGS_STORAGE_KEY) || '{}');
    expect(persisted.byPlayer?.['1']?.weightProfit).toBeCloseTo(0.3, 6);
    expect(persisted.byPlayer?.['1']?.weightXp).toBeCloseTo(0.4, 6);
    expect(persisted.byPlayer?.['1']?.weightDeathSafety).toBeCloseTo(0.3, 6);
  });

  it('does not partially reset queue run settings when resetting queue defaults fails', () => {
    const simulator = useSimulatorStore();

    simulator.updateActiveQueueSettings({
      rounds: 99,
      baselineRounds: 7,
      medianBlend: 0.9,
      weightProfit: 0.25,
      weightXp: 0.35,
      executionMode: 'serial',
    });
    global.localStorage.setItem.mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const result = simulator.resetQueueSettingsToDefaults();

    expect(result.ok).toBe(false);
    expect(result.messageKey).toBe('common:settingsPage.queueSaveErrorStorage');
    expect(simulator.activeQueueState.settings.rounds).toBe(99);
    expect(simulator.activeQueueState.settings.baselineRounds).toBe(7);
    expect(simulator.activeQueueState.settings.medianBlend).toBeCloseTo(0.9, 6);
    expect(simulator.activeQueueState.settings.weightProfit).toBeCloseTo(0.3, 6);
    expect(simulator.activeQueueState.settings.weightXp).toBeCloseTo(0.4, 6);
    expect(simulator.activeQueueState.settings.weightDeathSafety).toBeCloseTo(0.3, 6);
    expect(simulator.activeQueueState.settings.executionMode).toBe('serial');
  });

  it('does not persist runtime defaults before queue settings reset succeeds', () => {
    const simulator = useSimulatorStore();

    expect(
      simulator.saveQueueRuntimeSettings({
        performancePct: 30,
        stabilityPct: 30,
        costPct: 40,
        costScoreGoldPerPointMode: 'composite',
        parallelWorkerLimit: 1,
      }).ok,
    ).toBe(true);
    simulator.updateActiveQueueSettings({
      rounds: 99,
      baselineRounds: 7,
      medianBlend: 0.9,
      weightProfit: 0.25,
      weightXp: 0.35,
      executionMode: 'serial',
    });

    const previousRuntimePayload = JSON.parse(global.localStorage.getItem(QUEUE_SETTINGS_STORAGE_KEY) || '{}');
    const previousQueueRunPayload = JSON.parse(global.localStorage.getItem(QUEUE_RUN_SETTINGS_STORAGE_KEY) || '{}');
    const originalSetItem = global.localStorage.setItem.getMockImplementation();
    let runtimeWriteCount = 0;
    global.localStorage.setItem.mockImplementation((key, value) => {
      if (key === QUEUE_SETTINGS_STORAGE_KEY) {
        runtimeWriteCount += 1;
        if (runtimeWriteCount > 1) {
          throw new Error('Rollback storage failed');
        }
        return originalSetItem(key, value);
      }
      if (key === QUEUE_RUN_SETTINGS_STORAGE_KEY) {
        throw new Error('QuotaExceededError');
      }
      return originalSetItem(key, value);
    });

    const result = simulator.resetQueueSettingsToDefaults();

    expect(result.ok).toBe(false);
    expect(result.messageKey).toBe('common:settingsPage.queueSaveErrorStorage');
    expect(runtimeWriteCount).toBe(0);
    expect(JSON.parse(global.localStorage.getItem(QUEUE_SETTINGS_STORAGE_KEY) || '{}')).toEqual(previousRuntimePayload);
    expect(JSON.parse(global.localStorage.getItem(QUEUE_RUN_SETTINGS_STORAGE_KEY) || '{}')).toEqual(
      previousQueueRunPayload,
    );
    expect(simulator.queueRuntime.finalWeights.performance).toBeCloseTo(0.3, 6);
    expect(simulator.queueRuntime.finalWeights.stability).toBeCloseTo(0.3, 6);
    expect(simulator.queueRuntime.finalWeights.cost).toBeCloseTo(0.4, 6);
    expect(simulator.queueRuntime.costScoreGoldPerPointMode).toBe('composite');
    expect(simulator.activeQueueState.settings.rounds).toBe(99);
    expect(simulator.activeQueueState.settings.baselineRounds).toBe(7);
    expect(simulator.activeQueueState.settings.medianBlend).toBeCloseTo(0.9, 6);
    expect(simulator.activeQueueState.settings.executionMode).toBe('serial');
  });

  it('rolls back queue settings persistence when resetting runtime defaults fails', () => {
    const simulator = useSimulatorStore();

    expect(
      simulator.saveQueueRuntimeSettings({
        performancePct: 30,
        stabilityPct: 30,
        costPct: 40,
        costScoreGoldPerPointMode: 'composite',
        parallelWorkerLimit: 1,
      }).ok,
    ).toBe(true);
    simulator.updateActiveQueueSettings({
      rounds: 99,
      baselineRounds: 7,
      medianBlend: 0.9,
      weightProfit: 0.25,
      weightXp: 0.35,
      executionMode: 'serial',
    });

    const originalSetItem = global.localStorage.setItem.getMockImplementation();
    let setItemCallCount = 0;
    global.localStorage.setItem.mockImplementation((key, value) => {
      setItemCallCount += 1;
      if (setItemCallCount === 2) {
        throw new Error('QuotaExceededError');
      }
      return originalSetItem(key, value);
    });

    const result = simulator.resetQueueSettingsToDefaults();

    expect(result.ok).toBe(false);
    expect(result.messageKey).toBe('common:settingsPage.queueSaveErrorStorage');
    expect(simulator.queueRuntime.finalWeights.performance).toBeCloseTo(0.3, 6);
    expect(simulator.queueRuntime.finalWeights.stability).toBeCloseTo(0.3, 6);
    expect(simulator.queueRuntime.finalWeights.cost).toBeCloseTo(0.4, 6);
    expect(simulator.queueRuntime.costScoreGoldPerPointMode).toBe('composite');
    expect(simulator.activeQueueState.settings.rounds).toBe(99);
    expect(simulator.activeQueueState.settings.baselineRounds).toBe(7);
    expect(simulator.activeQueueState.settings.medianBlend).toBeCloseTo(0.9, 6);
    expect(simulator.activeQueueState.settings.weightProfit).toBeCloseTo(0.3, 6);
    expect(simulator.activeQueueState.settings.weightXp).toBeCloseTo(0.4, 6);
    expect(simulator.activeQueueState.settings.weightDeathSafety).toBeCloseTo(0.3, 6);
    expect(simulator.activeQueueState.settings.executionMode).toBe('serial');

    const persistedRuntime = JSON.parse(global.localStorage.getItem(QUEUE_SETTINGS_STORAGE_KEY) || '{}');
    expect(persistedRuntime.finalWeights?.performance).toBeCloseTo(0.3, 6);
    expect(persistedRuntime.finalWeights?.stability).toBeCloseTo(0.3, 6);
    expect(persistedRuntime.finalWeights?.cost).toBeCloseTo(0.4, 6);
    expect(persistedRuntime.costScoreGoldPerPointMode).toBe('composite');

    const persistedQueueSettings = JSON.parse(global.localStorage.getItem(QUEUE_RUN_SETTINGS_STORAGE_KEY) || '{}');
    expect(persistedQueueSettings.byPlayer?.['1']?.rounds).toBe(99);
    expect(persistedQueueSettings.byPlayer?.['1']?.baselineRounds).toBe(7);
    expect(persistedQueueSettings.byPlayer?.['1']?.medianBlend).toBeCloseTo(0.9, 6);
    expect(persistedQueueSettings.byPlayer?.['1']?.weightProfit).toBeCloseTo(0.3, 6);
    expect(persistedQueueSettings.byPlayer?.['1']?.weightXp).toBeCloseTo(0.4, 6);
    expect(persistedQueueSettings.byPlayer?.['1']?.weightDeathSafety).toBeCloseTo(0.3, 6);
    expect(persistedQueueSettings.byPlayer?.['1']?.executionMode).toBe('serial');
  });

  it('validates and persists queue runtime settings', () => {
    const simulator = useSimulatorStore();

    const invalid = simulator.saveQueueRuntimeSettings({
      performancePct: 40,
      stabilityPct: 20,
      costPct: 30,
      parallelWorkerLimit: 1,
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.messageKey).toBe('common:settingsPage.queueSaveErrorWeightSum');

    const invalidMetric = simulator.saveQueueRuntimeSettings({
      performancePct: 40,
      stabilityPct: 20,
      costPct: 40,
      costScoreGoldPerPointMode: 'invalid',
      parallelWorkerLimit: 1,
    });
    expect(invalidMetric.ok).toBe(false);
    expect(invalidMetric.messageKey).toBe('common:settingsPage.queueSaveErrorCostScoreGoldMetric');

    const saved = simulator.saveQueueRuntimeSettings({
      performancePct: 40,
      stabilityPct: 20,
      costPct: 40,
      costScoreGoldPerPointMode: 'composite',
      parallelWorkerLimit: 1,
    });
    expect(saved.ok).toBe(true);
    expect(simulator.queueRuntime.finalWeights.performance).toBeCloseTo(0.4, 6);
    expect(simulator.queueRuntime.finalWeights.stability).toBeCloseTo(0.2, 6);
    expect(simulator.queueRuntime.finalWeights.cost).toBeCloseTo(0.4, 6);
    expect(simulator.queueRuntime.costScoreGoldPerPointMode).toBe('composite');
    expect(simulator.queueRuntime.parallelWorkerLimit).toBe(1);
    expect(global.localStorage.setItem).toHaveBeenCalled();
    expect(JSON.parse(global.localStorage.getItem(QUEUE_SETTINGS_STORAGE_KEY) || '{}')?.costScoreGoldPerPointMode).toBe(
      'composite',
    );

    const reset = simulator.resetQueueRuntimeSettings();
    expect(reset.ok).toBe(true);
    expect(simulator.queueRuntime.finalWeights.performance).toBeCloseTo(0.4, 6);
    expect(simulator.queueRuntime.finalWeights.stability).toBeCloseTo(0.2, 6);
    expect(simulator.queueRuntime.finalWeights.cost).toBeCloseTo(0.4, 6);
    expect(simulator.queueRuntime.costScoreGoldPerPointMode).toBe('strict');
  });

  it('loads legacy queue runtime settings without cost score metric and defaults to strict', () => {
    global.localStorage.setItem(
      QUEUE_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        finalWeights: {
          performance: 0.5,
          stability: 0.2,
          cost: 0.3,
        },
        parallelWorkerLimit: 2,
      }),
    );

    const simulator = useSimulatorStore();

    expect(simulator.queueRuntime.finalWeights.performance).toBeCloseTo(0.5, 6);
    expect(simulator.queueRuntime.finalWeights.stability).toBeCloseTo(0.2, 6);
    expect(simulator.queueRuntime.finalWeights.cost).toBeCloseTo(0.3, 6);
    expect(simulator.queueRuntime.parallelWorkerLimit).toBe(2);
    expect(simulator.queueRuntime.costScoreGoldPerPointMode).toBe('strict');
  });

  it('re-ranks existing multi-round results after queue score weights change', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();

    expect(equipmentItemHrid).toBeTruthy();

    await simulator.setQueueBaselineForActivePlayer();
    simulator.activeQueueState.baseline.metrics = {
      dailyNoRngProfit: 2400,
      dps: 80,
      xpPerHour: 900,
      killsPerHour: 80,
    };

    simulator.activePlayer.equipment.weapon.itemHrid = equipmentItemHrid;
    simulator.activePlayer.equipment.weapon.enhancementLevel = 1;
    setExactEquipmentAsk(simulator, equipmentItemHrid, 1, 100);
    const cheaperItems = simulator.addActivePlayerToQueue();
    expect(cheaperItems).toHaveLength(1);

    simulator.activePlayer.equipment.weapon.itemHrid = equipmentItemHrid;
    simulator.activePlayer.equipment.weapon.enhancementLevel = 2;
    setExactEquipmentAsk(simulator, equipmentItemHrid, 2, 1000);
    const expensiveItems = simulator.addActivePlayerToQueue();
    expect(expensiveItems).toHaveLength(1);

    simulator.updateActiveQueueSettings({
      rounds: 1,
      executionMode: 'serial',
      medianBlend: 0.5,
      weightProfit: 0,
      weightXp: 1,
      weightDeathSafety: 0,
    });
    expect(
      simulator.saveQueueRuntimeSettings({
        performancePct: 100,
        stabilityPct: 0,
        costPct: 0,
        parallelWorkerLimit: 1,
      }).ok,
    ).toBe(true);

    let queueCallIndex = 0;
    simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
      onProgress?.({ progress: 1 });
      queueCallIndex += 1;
      const higherPerformance = queueCallIndex === 2;

      return {
        simulatedTime: ONE_HOUR,
        encounters: higherPerformance ? 120 : 105,
        attacks: {
          player1: {
            autoAttack: {
              cast1: {
                [higherPerformance ? '720000' : '360000']: 1,
              },
            },
          },
        },
        experienceGained: {
          player1: {
            stamina: higherPerformance ? 1200 : 1000,
          },
        },
        deaths: {
          player1: 0,
        },
        consumablesUsed: {},
      };
    });

    const expensiveVariantId = expensiveItems[0].id;
    const cheaperVariantId = cheaperItems[0].id;
    const rowsBeforeWeightChange = await simulator.runActiveQueue();

    expect(simulator.runSingleSimulationPayload).toHaveBeenCalledTimes(2);
    expect(rowsBeforeWeightChange).toHaveLength(2);
    expect(rowsBeforeWeightChange[0].id).toBe(expensiveVariantId);

    const saved = simulator.saveQueueRuntimeSettings({
      performancePct: 0,
      stabilityPct: 0,
      costPct: 100,
      parallelWorkerLimit: 1,
    });
    const rerankedRows = simulator.activeQueueState.ranking;
    const cheaperRow = rerankedRows.find((row) => row.id === cheaperVariantId);
    const expensiveRow = rerankedRows.find((row) => row.id === expensiveVariantId);

    expect(saved.ok).toBe(true);
    expect(simulator.runSingleSimulationPayload).toHaveBeenCalledTimes(2);
    expect(rerankedRows).toHaveLength(2);
    expect(rerankedRows[0].id).toBe(cheaperVariantId);
    expect(Number(cheaperRow?.costInsights?.totalUpgradeCost)).toBeLessThan(
      Number(expensiveRow?.costInsights?.totalUpgradeCost),
    );
    expect(Number(cheaperRow?.finalScore)).toBeGreaterThan(Number(expensiveRow?.finalScore));
  });

  it('re-ranks existing multi-round results after cost score metric changes without rerunning simulations', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();

    expect(equipmentItemHrid).toBeTruthy();

    await simulator.setQueueBaselineForActivePlayer();
    setQueueBaselineMetrics(simulator, {
      dailyNoRngProfit: 2400,
      dps: 10,
      xpPerHour: 900,
      killsPerHour: 80,
    });

    simulator.activePlayer.equipment.weapon.itemHrid = equipmentItemHrid;
    simulator.activePlayer.equipment.weapon.enhancementLevel = 2;
    setExactEquipmentAsk(simulator, equipmentItemHrid, 2, 100);
    const cheaperItems = simulator.addActivePlayerToQueue();
    expect(cheaperItems).toHaveLength(1);

    simulator.activePlayer.equipment.weapon.itemHrid = equipmentItemHrid;
    simulator.activePlayer.equipment.weapon.enhancementLevel = 3;
    setExactEquipmentAsk(simulator, equipmentItemHrid, 3, 100);
    const expensiveItems = simulator.addActivePlayerToQueue();
    expect(expensiveItems).toHaveLength(1);

    expect(
      simulator.saveQueueRuntimeSettings({
        performancePct: 0,
        stabilityPct: 0,
        costPct: 100,
        costScoreGoldPerPointMode: 'strict',
        parallelWorkerLimit: 1,
      }).ok,
    ).toBe(true);
    simulator.updateActiveQueueSettings({
      rounds: 1,
      executionMode: 'serial',
      medianBlend: 0.5,
      weightProfit: 0,
      weightXp: 1,
      weightDeathSafety: 0,
    });

    const cheaperVariantId = cheaperItems[0].id;
    const expensiveVariantId = expensiveItems[0].id;
    const baselineMetrics = simulator.activeQueueState.baseline.metrics;
    simulator.activeQueueState.rawRuns = [
      createQueueRawRun(
        cheaperItems[0],
        1,
        {
          dps: 9,
          dailyNoRngProfit: 2200,
          xpPerHour: 1000,
          killsPerHour: 70,
        },
        baselineMetrics,
      ),
      createQueueRawRun(
        expensiveItems[0],
        1,
        {
          dps: 12,
          dailyNoRngProfit: 2600,
          xpPerHour: 950,
          killsPerHour: 90,
        },
        baselineMetrics,
      ),
    ];
    const rowsBeforeMetricChange = await simulator.refreshQueueResultsFromRawRuns({
      allowReferenceLoad: false,
      sortRawRuns: false,
    });
    const cheaperRowBefore = rowsBeforeMetricChange.find((row) => row.id === cheaperVariantId);

    expect(rowsBeforeMetricChange).toHaveLength(2);
    expect(rowsBeforeMetricChange[0].id).toBe(expensiveVariantId);
    expect(cheaperRowBefore?.rawComponentScores?.costByMetric?.selectedGoldPerPointMode).toBe('strict');

    const saved = simulator.saveQueueRuntimeSettings({
      performancePct: 0,
      stabilityPct: 0,
      costPct: 100,
      costScoreGoldPerPointMode: 'composite',
      parallelWorkerLimit: 1,
    });
    const rerankedRows = simulator.activeQueueState.ranking;
    const cheaperRow = rerankedRows.find((row) => row.id === cheaperVariantId);
    const expensiveRow = rerankedRows.find((row) => row.id === expensiveVariantId);

    expect(saved.ok).toBe(true);
    expect(rerankedRows).toHaveLength(2);
    expect(rerankedRows[0].id).toBe(cheaperVariantId);
    expect(cheaperRow?.rawComponentScores?.costByMetric?.selectedGoldPerPointMode).toBe('composite');
    expect(Number(cheaperRow?.rawComponentScores?.costByMetric?.selectedGoldPerPoint01PctScore)).toBeGreaterThan(0);
    expect(Number(cheaperRow?.finalScore)).toBeGreaterThan(Number(expensiveRow?.finalScore));
  });

  it('saves, loads, and deletes player data snapshots', () => {
    const simulator = useSimulatorStore();

    simulator.players[0].levels.stamina = 77;
    simulator.players[0].achievements[ACHIEVEMENT_HRID] = true;
    const saveResult = simulator.savePlayerDataSnapshot();
    expect(saveResult.ok).toBe(true);
    expect(simulator.playerDataSnapshotRows.some((row) => row.hasSnapshot)).toBe(true);

    simulator.players[0].levels.stamina = 1;
    simulator.players[0].achievements = {};
    const loadResult = simulator.loadPlayerDataSnapshot();
    expect(loadResult.ok).toBe(true);
    expect(simulator.players[0].levels.stamina).toBe(77);
    expect(simulator.players[0].achievements[ACHIEVEMENT_HRID]).toBe(true);
    expect(JSON.parse(global.localStorage.getItem(PLAYER_ACHIEVEMENTS_STORAGE_KEY)).achievementsByPlayer['1']).toEqual({
      [ACHIEVEMENT_HRID]: true,
    });

    const deleteOneResult = simulator.deleteSinglePlayerDataSnapshot('1');
    expect(deleteOneResult.ok).toBe(true);

    const deleteAllResult = simulator.deleteAllPlayerDataSnapshots();
    expect(deleteAllResult.ok).toBe(true);
    expect(simulator.playerDataSnapshotRows.every((row) => !row.hasSnapshot)).toBe(true);
  });

  it('hydrates persisted achievements on store creation', () => {
    global.localStorage.setItem(
      PLAYER_ACHIEVEMENTS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        achievementsByPlayer: {
          1: {
            [ACHIEVEMENT_HRID]: true,
            [SECOND_ACHIEVEMENT_HRID]: 1,
          },
          2: {
            [ACHIEVEMENT_HRID]: false,
          },
          8: {
            '/achievements/ignored': true,
          },
        },
      }),
    );

    const simulator = useSimulatorStore();

    expect(simulator.players[0].achievements).toEqual({
      [ACHIEVEMENT_HRID]: true,
      [SECOND_ACHIEVEMENT_HRID]: true,
    });
    expect(simulator.players[1].achievements).toEqual({});
  });

  it('persists and clears achievements independently from player snapshots', () => {
    const simulator = useSimulatorStore();

    simulator.players[0].achievements[ACHIEVEMENT_HRID] = true;
    simulator.persistPlayerAchievements();

    expect(JSON.parse(global.localStorage.getItem(PLAYER_ACHIEVEMENTS_STORAGE_KEY)).achievementsByPlayer['1']).toEqual({
      [ACHIEVEMENT_HRID]: true,
    });

    const deleteAllResult = simulator.deleteAllPlayerDataSnapshots();
    expect(deleteAllResult.ok).toBe(true);
    expect(JSON.parse(global.localStorage.getItem(PLAYER_ACHIEVEMENTS_STORAGE_KEY)).achievementsByPlayer['1']).toEqual({
      [ACHIEVEMENT_HRID]: true,
    });

    simulator.players[0].achievements = {};
    simulator.persistPlayerAchievements();

    expect(global.localStorage.getItem(PLAYER_ACHIEVEMENTS_STORAGE_KEY)).toBeNull();
  });

  it('keeps queue state isolated per active player', async () => {
    const simulator = useSimulatorStore();

    await simulator.setQueueBaselineForActivePlayer();
    expect(simulator.queue.byPlayer['1']?.baseline).toBeTruthy();

    simulator.setActivePlayer('3');
    expect(simulator.activeQueueState.baseline).toBeNull();

    await simulator.setQueueBaselineForActivePlayer();
    expect(simulator.queue.byPlayer['3']?.baseline).toBeTruthy();

    simulator.setActivePlayer('1');
    expect(simulator.activeQueueState.baseline).toBeTruthy();
  });

  it('does not mark party mismatch before a queue baseline exists', () => {
    const simulator = useSimulatorStore();
    simulator.players[1].selected = true;

    expect(simulator.activeQueuePartyStatus?.hasMismatch).toBe(false);
  });

  it('syncs active single-simulation result selection when active player changes', () => {
    const simulator = useSimulatorStore();
    simulator.results.summaryRows = [
      { playerHrid: 'player1', playerName: 'Player 1', totalXpPerHour: 100 },
      { playerHrid: 'player2', playerName: 'Player 2', totalXpPerHour: 200 },
    ];
    simulator.results.activeResultPlayerHrid = 'player1';

    simulator.setActivePlayer('2');
    expect(simulator.results.activeResultPlayerHrid).toBe('player2');
    expect(simulator.activeResultRow).toMatchObject({ playerHrid: 'player2', playerName: 'Player 2' });

    simulator.setActivePlayer('1');
    expect(simulator.results.activeResultPlayerHrid).toBe('player1');
    expect(simulator.activeResultRow).toMatchObject({ playerHrid: 'player1', playerName: 'Player 1' });
  });

  it('keeps active result aligned to the selected player even when that player has no result row', () => {
    const simulator = useSimulatorStore();
    simulator.results.summaryRows = [
      { playerHrid: 'player1', playerName: 'Player 1', totalXpPerHour: 100 },
      { playerHrid: 'player2', playerName: 'Player 2', totalXpPerHour: 200 },
    ];
    simulator.results.activeResultPlayerHrid = 'player1';

    simulator.setActivePlayer('4');
    expect(simulator.results.activeResultPlayerHrid).toBe('player4');
    expect(simulator.activeResultRow).toBeNull();
  });

  it('rejects queue run when run scope is not single', async () => {
    const simulator = useSimulatorStore();

    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.levels.stamina = 2;
    simulator.addActivePlayerToQueue();
    simulator.simulationSettings.runScope = 'all_group_zones';

    const rows = await simulator.runActiveQueue();

    expect(rows).toEqual([]);
    expect(simulator.activeQueueState.error).toBe('common:queue.errorRunScopeSingle');
  });

  it('rejects queue run while advisor scan is active', async () => {
    const simulator = useSimulatorStore();

    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.levels.stamina = 2;
    simulator.addActivePlayerToQueue();
    simulator.advisor.runtime.isRunning = true;

    const rows = await simulator.runActiveQueue();

    expect(rows).toEqual([]);
    expect(simulator.activeQueueState.error).toBe('common:queue.errorBusy');
  });

  it('runs queue with multiple rounds and builds ranking output', async () => {
    const simulator = useSimulatorStore();
    const pricedItemHrid = findFirstPricedItem();

    await simulator.setQueueBaselineForActivePlayer();
    simulator.activeQueueState.baseline.metrics = {
      dailyNoRngProfit: 2400,
      dps: 100,
      xpPerHour: 1200,
      killsPerHour: 100,
    };
    simulator.activePlayer.levels.stamina = 10;
    const addedItems = simulator.addActivePlayerToQueue();
    expect(Array.isArray(addedItems)).toBe(true);
    expect(addedItems).toHaveLength(1);

    simulator.updateActiveQueueSettings({
      rounds: 2,
      executionMode: 'serial',
      medianBlend: 0.4,
      weightProfit: 1,
      weightXp: 0,
      weightDeathSafety: 0,
    });

    let callCount = 0;
    simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
      callCount += 1;
      onProgress?.({ progress: 1 });

      return {
        simulatedTime: ONE_HOUR,
        encounters: 90,
        experienceGained: {
          player1: {
            stamina: 900,
          },
        },
        deaths: {
          player1: 1,
        },
        consumablesUsed: !pricedItemHrid ? {} : { player1: { [pricedItemHrid]: 2 } },
      };
    });

    const rows = await simulator.runActiveQueue();
    const variantRow = rows[0];

    expect(simulator.runSingleSimulationPayload).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(1);
    expect(variantRow).toBeTruthy();
    expect(simulator.activeQueueState.rawRuns).toHaveLength(2);
    expect(simulator.activeQueueState.ranking).toHaveLength(1);
    expect(simulator.activeQueueState.progress).toBe(1);
    expect(simulator.runtime.isRunning).toBe(false);
    expect(simulator.activeQueueState.isRunning).toBe(false);
    expect(Number(variantRow.deltaProfitPerHour)).toBeLessThanOrEqual(0);
  });

  it('runs queued variants with the baseline target settings snapshot', async () => {
    const simulator = useSimulatorStore();
    const baselineZone = String(simulator.options?.zones?.[0]?.hrid || '');
    const baselineDungeon = String(simulator.options?.dungeons?.[0]?.hrid || '');
    const liveZone = String(
      simulator.options?.zones?.find((zone) => String(zone?.hrid || '') !== baselineZone)?.hrid || '',
    );

    expect(baselineZone).toBeTruthy();
    expect(baselineDungeon).toBeTruthy();
    expect(liveZone).toBeTruthy();

    simulator.simulationSettings.mode = 'zone';
    simulator.simulationSettings.runScope = 'single';
    simulator.simulationSettings.useDungeon = true;
    simulator.simulationSettings.zoneHrid = baselineZone;
    simulator.simulationSettings.dungeonHrid = baselineDungeon;
    simulator.simulationSettings.difficultyTier = 2;
    simulator.simulationSettings.simulationTimeHours = 12;
    simulator.simulationSettings.mooPass = false;
    simulator.simulationSettings.comExpEnabled = true;
    simulator.simulationSettings.comExp = 33;

    await simulator.setQueueBaselineForActivePlayer();
    setQueueBaselineMetrics(simulator, {
      dailyNoRngProfit: 2400,
      dps: 100,
      xpPerHour: 1200,
      killsPerHour: 100,
    });
    simulator.activePlayer.levels.stamina = 10;
    const addedItems = simulator.addActivePlayerToQueue();
    expect(addedItems).toHaveLength(1);

    simulator.simulationSettings.useDungeon = false;
    simulator.simulationSettings.zoneHrid = liveZone;
    simulator.simulationSettings.difficultyTier = 5;
    simulator.simulationSettings.simulationTimeHours = 99;
    simulator.simulationSettings.mooPass = true;
    simulator.simulationSettings.comExp = 88;
    simulator.updateActiveQueueSettings({
      rounds: 1,
      executionMode: 'serial',
      medianBlend: 0.5,
      weightProfit: 1,
      weightXp: 0,
      weightDeathSafety: 0,
    });

    const payloads = [];
    simulator.runSingleSimulationPayload = vi.fn(async (payload, onProgress) => {
      payloads.push(payload);
      onProgress?.({ progress: 1 });
      return createQueueSimulationResult();
    });

    const rows = await simulator.runActiveQueue();

    expect(rows).toHaveLength(1);
    expect(payloads).toHaveLength(1);
    expect(payloads[0].zone).toEqual({
      zoneHrid: baselineDungeon,
      difficultyTier: 2,
    });
    expect(payloads[0].simulationTimeLimit).toBe(12 * ONE_HOUR);
    expect(payloads[0].extra).toMatchObject({
      mooPass: false,
      comExp: 33,
    });
  });

  it('keeps partial queue ranking when one worker round fails', async () => {
    const simulator = useSimulatorStore();

    await simulator.setQueueBaselineForActivePlayer();
    setQueueBaselineMetrics(simulator, {
      dailyNoRngProfit: 2400,
      dps: 100,
      xpPerHour: 1200,
      killsPerHour: 100,
    });
    simulator.activePlayer.levels.stamina = 10;
    simulator.activePlayer.levels.attack = 20;
    const addedItems = simulator.addActivePlayerToQueue();
    expect(addedItems.length).toBeGreaterThanOrEqual(2);

    simulator.updateActiveQueueSettings({
      rounds: 2,
      executionMode: 'serial',
      medianBlend: 0.5,
      weightProfit: 1,
      weightXp: 0,
      weightDeathSafety: 0,
    });

    let callCount = 0;
    simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
      callCount += 1;
      onProgress?.({ progress: 1 });

      if (callCount === 3) {
        throw new Error('worker disconnected');
      }

      return createQueueSimulationResult({
        encounters: 100 + callCount,
        staminaXp: 1000 + callCount * 100,
      });
    });

    const rows = await simulator.runActiveQueue();
    const expectedRunCount = addedItems.length * 2;

    expect(simulator.runSingleSimulationPayload).toHaveBeenCalledTimes(expectedRunCount);
    expect(simulator.activeQueueState.rawRuns).toHaveLength(expectedRunCount - 1);
    expect(rows.length).toBeGreaterThan(0);
    expect(simulator.activeQueueState.ranking).toEqual(rows);
    expect(simulator.activeQueueState.lastRunStatus).toBe('partial');
    expect(simulator.activeQueueState.error).toContain('worker disconnected');
    expect(simulator.activeQueueState.progress).toBe(1);
  });

  it('marks queue run failed only when every worker round fails', async () => {
    const simulator = useSimulatorStore();

    await simulator.setQueueBaselineForActivePlayer();
    setQueueBaselineMetrics(simulator);
    simulator.activePlayer.levels.stamina = 10;
    simulator.addActivePlayerToQueue();

    simulator.updateActiveQueueSettings({
      rounds: 1,
      executionMode: 'serial',
      medianBlend: 0.5,
      weightProfit: 1,
      weightXp: 0,
      weightDeathSafety: 0,
    });

    simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
      onProgress?.({ progress: 1 });
      throw new Error('worker offline');
    });

    const rows = await simulator.runActiveQueue();

    expect(rows).toEqual([]);
    expect(simulator.activeQueueState.rawRuns).toHaveLength(0);
    expect(simulator.activeQueueState.ranking).toEqual([]);
    expect(simulator.activeQueueState.lastRunStatus).toBe('failed');
    expect(simulator.activeQueueState.error).toBe('worker offline');
    expect(simulator.activeQueueState.lastRunAt).toBe(0);
    expect(simulator.activeQueueState.progress).toBe(1);
  });

  it('re-ranks existing queue results after median blend changes without rerunning simulations', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();

    expect(equipmentItemHrid).toBeTruthy();

    await simulator.setQueueBaselineForActivePlayer();
    setQueueBaselineMetrics(simulator, {
      dailyNoRngProfit: 2400,
      dps: 100,
      xpPerHour: 1000,
      killsPerHour: 100,
    });

    simulator.activePlayer.equipment.weapon.itemHrid = equipmentItemHrid;
    simulator.activePlayer.equipment.weapon.enhancementLevel = 1;
    setExactEquipmentAsk(simulator, equipmentItemHrid, 1, 1);
    const highMeanItems = simulator.addActivePlayerToQueue();
    expect(highMeanItems).toHaveLength(1);

    simulator.activePlayer.equipment.weapon.itemHrid = equipmentItemHrid;
    simulator.activePlayer.equipment.weapon.enhancementLevel = 2;
    setExactEquipmentAsk(simulator, equipmentItemHrid, 2, 1);
    const highMedianItems = simulator.addActivePlayerToQueue();
    expect(highMedianItems).toHaveLength(1);

    const baselineMetrics = simulator.activeQueueState.baseline.metrics;
    simulator.activeQueueState.rawRuns = [
      createQueueRawRun(highMeanItems[0], 1, { dailyNoRngProfit: 18000 }, baselineMetrics),
      createQueueRawRun(highMedianItems[0], 1, { dailyNoRngProfit: 4800 }, baselineMetrics),
      createQueueRawRun(highMeanItems[0], 2, { dailyNoRngProfit: 0 }, baselineMetrics),
      createQueueRawRun(highMedianItems[0], 2, { dailyNoRngProfit: 4800 }, baselineMetrics),
      createQueueRawRun(highMeanItems[0], 3, { dailyNoRngProfit: 0 }, baselineMetrics),
      createQueueRawRun(highMedianItems[0], 3, { dailyNoRngProfit: 4800 }, baselineMetrics),
    ];

    expect(
      simulator.saveQueueRuntimeSettings({
        performancePct: 100,
        stabilityPct: 0,
        costPct: 0,
        parallelWorkerLimit: 1,
      }).ok,
    ).toBe(true);

    simulator.updateActiveQueueSettings({
      rounds: 3,
      executionMode: 'serial',
      medianBlend: 0,
      weightProfit: 1,
      weightXp: 0,
    });

    await simulator.refreshQueueResultsFromRawRuns({
      allowReferenceLoad: false,
      sortRawRuns: false,
    });

    expect(simulator.activeQueueState.ranking).toHaveLength(2);
    expect(simulator.activeQueueState.ranking[0].id).toBe(highMeanItems[0].id);

    simulator.updateActiveQueueSettings({
      medianBlend: 1,
    });

    expect(simulator.activeQueueState.ranking).toHaveLength(2);
    expect(simulator.activeQueueState.ranking[0].id).toBe(highMedianItems[0].id);
  });

  it('recomputes stored queue ranking costs right away when the sale side is switched', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    expect(equipmentItemHrid).toBeTruthy();

    global.jigsLevelExperienceTable = [0, 100, 700];
    global.jigsSpellBookXpByName = {};
    global.fetch = vi.fn(async () => ({ ok: false }));

    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 1 };
    await simulator.setQueueBaselineForActivePlayer();
    setQueueBaselineMetrics(simulator, { dailyNoRngProfit: 2400 });

    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 2 };
    simulator.pricing.enhancementQuotesByItem[equipmentItemHrid] = {
      1: { ask: 120, bid: 100 },
      2: { ask: 500, bid: 450 },
    };

    const items = simulator.addActivePlayerToQueue({
      confirmedEquipmentPrices: [
        {
          itemHrid: equipmentItemHrid,
          enhancementLevel: 2,
          price: 500,
          volume: null,
          source: 'ask',
          marketTimestamp: 1_786_300_000,
        },
      ],
    });
    expect(items).toHaveLength(1);

    const baselineMetrics = simulator.activeQueueState.baseline.metrics;
    simulator.activeQueueState.rawRuns = [createQueueRawRun(items[0], 1, { dailyNoRngProfit: 3000 }, baselineMetrics)];
    await simulator.refreshQueueResultsFromRawRuns({ allowReferenceLoad: false });

    // 默认口径为 bid（右1 最高买单，实际卖出成交价，抵扣保守）。
    expect(simulator.activeQueueState.settings.baselineSaleSide).toBe('bid');
    const bidCosts = simulator.activeQueueState.ranking[0].costInsights;
    expect(Number(bidCosts.totalUpgradeCost)).toBeGreaterThan(0);

    // 切换「基准出售口径」后，已有排名结果应立即按新口径重算，
    // 而不是等下一次运行队列或参考数据刷新（回归：M1）。
    simulator.updateActiveQueueSettings({ baselineSaleSide: 'ask' });

    expect(simulator.activeQueueState.settings.baselineSaleSide).toBe('ask');
    const askCosts = simulator.activeQueueState.ranking[0].costInsights;

    // ask（左1 最低卖单，重置成本口径）抵扣高于 bid（右1 最高买单）→ 出售抵扣更高、净成本/升级成本更低。
    expect(Number(askCosts.equipmentSaleValue)).toBeGreaterThan(Number(bidCosts.equipmentSaleValue));
    expect(Number(askCosts.equipmentNetCost)).toBeLessThan(Number(bidCosts.equipmentNetCost));
    expect(Number(askCosts.totalUpgradeCost)).toBeLessThan(Number(bidCosts.totalUpgradeCost));
  });

  it('recomputes stored raw-run deltas when the blended baseline changes', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();

    expect(equipmentItemHrid).toBeTruthy();

    await simulator.setQueueBaselineForActivePlayer();
    setQueueBaselineMetrics(simulator, {
      dailyNoRngProfit: 2400,
      dps: 100,
      xpPerHour: 1000,
      killsPerHour: 100,
    });
    simulator.activeQueueState.baseline.metricSummary = {
      ...(simulator.activeQueueState.baseline.metricSummary || {}),
      dailyNoRngProfit: createMetricSummaryEntry(2400, {
        winsorizedMean: 2400,
        p50: 4800,
        robustMean: 2400,
      }),
    };
    simulator.activeQueueState.baseline.completedRounds = 3;

    simulator.activePlayer.equipment.weapon.itemHrid = equipmentItemHrid;
    simulator.activePlayer.equipment.weapon.enhancementLevel = 1;
    setExactEquipmentAsk(simulator, equipmentItemHrid, 1, 1);
    const addedItems = simulator.addActivePlayerToQueue();

    expect(addedItems).toHaveLength(1);
    expect(
      simulator.saveQueueRuntimeSettings({
        performancePct: 100,
        stabilityPct: 0,
        costPct: 0,
        parallelWorkerLimit: 1,
      }).ok,
    ).toBe(true);

    simulator.updateActiveQueueSettings({
      rounds: 1,
      executionMode: 'serial',
      medianBlend: 0,
      weightProfit: 1,
      weightXp: 0,
    });
    simulator.activeQueueState.rawRuns = [
      createQueueRawRun(
        addedItems[0],
        1,
        {
          dailyNoRngProfit: 7200,
        },
        simulator.activeQueueState.baseline.metrics,
      ),
    ];

    const initialRows = await simulator.refreshQueueResultsFromRawRuns({
      allowReferenceLoad: false,
      sortRawRuns: false,
    });

    expect(simulator.activeQueueState.baseline.metrics.dailyNoRngProfit).toBeCloseTo(2400, 6);
    expect(simulator.activeQueueState.rawRuns[0].deltas.dailyNoRngProfit.pct).toBeCloseTo(200, 6);
    expect(initialRows[0].deltaDailyNoRngProfitPct).toBeCloseTo(200, 6);

    simulator.updateActiveQueueSettings({
      medianBlend: 1,
    });

    expect(simulator.activeQueueState.baseline.metrics.dailyNoRngProfit).toBeCloseTo(4800, 6);
    expect(simulator.activeQueueState.rawRuns[0].deltas.dailyNoRngProfit.pct).toBeCloseTo(50, 6);
    expect(simulator.activeQueueState.ranking[0].deltaDailyNoRngProfitPct).toBeCloseTo(50, 6);
  });

  it('uses queue profit/xp weights for performance scoring and weighted composite cost metric', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();

    expect(equipmentItemHrid).toBeTruthy();

    await simulator.setQueueBaselineForActivePlayer();
    setQueueBaselineMetrics(simulator, {
      dailyNoRngProfit: 2400,
      dps: 100,
      xpPerHour: 1000,
      killsPerHour: 100,
    });

    simulator.activePlayer.equipment.weapon.itemHrid = equipmentItemHrid;
    simulator.activePlayer.equipment.weapon.enhancementLevel = 1;
    setExactEquipmentAsk(simulator, equipmentItemHrid, 1, 100);
    const profitFocusedItems = simulator.addActivePlayerToQueue();
    expect(profitFocusedItems).toHaveLength(1);

    simulator.activePlayer.equipment.weapon.itemHrid = equipmentItemHrid;
    simulator.activePlayer.equipment.weapon.enhancementLevel = 2;
    setExactEquipmentAsk(simulator, equipmentItemHrid, 2, 100);
    const xpFocusedItems = simulator.addActivePlayerToQueue();
    expect(xpFocusedItems).toHaveLength(1);

    const baselineMetrics = simulator.activeQueueState.baseline.metrics;
    simulator.activeQueueState.rawRuns = [
      createQueueRawRun(
        profitFocusedItems[0],
        1,
        {
          dailyNoRngProfit: 7200,
          xpPerHour: 1100,
        },
        baselineMetrics,
      ),
      createQueueRawRun(
        xpFocusedItems[0],
        1,
        {
          dailyNoRngProfit: 4800,
          xpPerHour: 1600,
        },
        baselineMetrics,
      ),
    ];

    expect(
      simulator.saveQueueRuntimeSettings({
        performancePct: 100,
        stabilityPct: 0,
        costPct: 0,
        costScoreGoldPerPointMode: 'composite',
        parallelWorkerLimit: 1,
      }).ok,
    ).toBe(true);

    simulator.updateActiveQueueSettings({
      rounds: 1,
      executionMode: 'serial',
      medianBlend: 0.5,
      weightProfit: 1,
      weightXp: 0,
    });

    await simulator.refreshQueueResultsFromRawRuns({
      allowReferenceLoad: false,
      sortRawRuns: false,
    });

    let ranking = simulator.activeQueueState.ranking;
    let profitFocusedRow = ranking.find((row) => row.id === profitFocusedItems[0].id);

    expect(ranking).toHaveLength(2);
    expect(ranking[0].id).toBe(profitFocusedItems[0].id);
    expect(profitFocusedRow?.costInsights?.compositeDeltaPct).toBeCloseTo(200, 6);

    simulator.updateActiveQueueSettings({
      weightProfit: 0,
      weightXp: 1,
    });

    ranking = simulator.activeQueueState.ranking;
    profitFocusedRow = ranking.find((row) => row.id === profitFocusedItems[0].id);

    expect(ranking).toHaveLength(2);
    expect(ranking[0].id).toBe(xpFocusedItems[0].id);
    expect(profitFocusedRow?.costInsights?.compositeDeltaPct).toBeCloseTo(10, 6);
  });

  it('ignores disabled metric confidence when applying the final-score confidence penalty', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();

    expect(equipmentItemHrid).toBeTruthy();

    await simulator.setQueueBaselineForActivePlayer();
    setQueueBaselineMetrics(simulator, {
      dailyNoRngProfit: 2400,
      dps: 100,
      xpPerHour: 1000,
      killsPerHour: 100,
    });

    simulator.activePlayer.equipment.weapon.itemHrid = equipmentItemHrid;
    simulator.activePlayer.equipment.weapon.enhancementLevel = 1;
    setExactEquipmentAsk(simulator, equipmentItemHrid, 1, 1);
    const stableItems = simulator.addActivePlayerToQueue();
    expect(stableItems).toHaveLength(1);

    simulator.activePlayer.equipment.weapon.itemHrid = equipmentItemHrid;
    simulator.activePlayer.equipment.weapon.enhancementLevel = 2;
    setExactEquipmentAsk(simulator, equipmentItemHrid, 2, 1);
    const noisyItems = simulator.addActivePlayerToQueue();
    expect(noisyItems).toHaveLength(1);

    const baselineMetrics = simulator.activeQueueState.baseline.metrics;
    simulator.activeQueueState.rawRuns = [
      createQueueRawRun(
        stableItems[0],
        1,
        {
          dailyNoRngProfit: 4800,
          dps: 100,
          xpPerHour: 1000,
          killsPerHour: 100,
        },
        baselineMetrics,
      ),
      createQueueRawRun(
        stableItems[0],
        2,
        {
          dailyNoRngProfit: 4800,
          dps: 100,
          xpPerHour: 1000,
          killsPerHour: 100,
        },
        baselineMetrics,
      ),
      createQueueRawRun(
        stableItems[0],
        3,
        {
          dailyNoRngProfit: 4800,
          dps: 100,
          xpPerHour: 1000,
          killsPerHour: 100,
        },
        baselineMetrics,
      ),
      createQueueRawRun(
        noisyItems[0],
        1,
        {
          dailyNoRngProfit: 4800,
          dps: 0,
          xpPerHour: 0,
          killsPerHour: 0,
        },
        baselineMetrics,
      ),
      createQueueRawRun(
        noisyItems[0],
        2,
        {
          dailyNoRngProfit: 4800,
          dps: 200,
          xpPerHour: 2000,
          killsPerHour: 200,
        },
        baselineMetrics,
      ),
      createQueueRawRun(
        noisyItems[0],
        3,
        {
          dailyNoRngProfit: 4800,
          dps: 0,
          xpPerHour: 0,
          killsPerHour: 0,
        },
        baselineMetrics,
      ),
    ];

    expect(
      simulator.saveQueueRuntimeSettings({
        performancePct: 100,
        stabilityPct: 0,
        costPct: 0,
        parallelWorkerLimit: 1,
      }).ok,
    ).toBe(true);

    simulator.updateActiveQueueSettings({
      rounds: 3,
      executionMode: 'serial',
      medianBlend: 0.5,
      weightProfit: 1,
      weightXp: 0,
    });

    const ranking = await simulator.refreshQueueResultsFromRawRuns({
      allowReferenceLoad: false,
      sortRawRuns: false,
    });
    const stableRow = ranking.find((row) => row.id === stableItems[0].id);
    const noisyRow = ranking.find((row) => row.id === noisyItems[0].id);

    expect(ranking).toHaveLength(2);
    expect(stableRow?.performanceScore).toBeCloseTo(noisyRow?.performanceScore ?? 0, 6);
    expect(stableRow?.confidencePenaltyFactor).toBeCloseTo(noisyRow?.confidencePenaltyFactor ?? 0, 6);
    expect(stableRow?.finalScore).toBeCloseTo(noisyRow?.finalScore ?? 0, 6);
  });

  it('keeps realtime ranking aligned with updated queue settings during an active run', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();

    expect(equipmentItemHrid).toBeTruthy();

    await simulator.setQueueBaselineForActivePlayer();
    setQueueBaselineMetrics(simulator, {
      dailyNoRngProfit: 2400,
      dps: 100,
      xpPerHour: 1000,
      killsPerHour: 100,
    });

    simulator.activePlayer.equipment.weapon.itemHrid = equipmentItemHrid;
    simulator.activePlayer.equipment.weapon.enhancementLevel = 1;
    setExactEquipmentAsk(simulator, equipmentItemHrid, 1, 1);
    const profitFocusedItems = simulator.addActivePlayerToQueue();
    expect(profitFocusedItems).toHaveLength(1);

    simulator.activePlayer.equipment.weapon.itemHrid = equipmentItemHrid;
    simulator.activePlayer.equipment.weapon.enhancementLevel = 2;
    setExactEquipmentAsk(simulator, equipmentItemHrid, 2, 1);
    const xpFocusedItems = simulator.addActivePlayerToQueue();
    expect(xpFocusedItems).toHaveLength(1);

    simulator.updateActiveQueueSettings({
      rounds: 2,
      executionMode: 'serial',
      medianBlend: 0.5,
      weightProfit: 1,
      weightXp: 0,
    });

    let queueCallIndex = 0;
    let releaseFinalRun = null;
    const finalRunGate = new Promise((resolve) => {
      releaseFinalRun = resolve;
    });
    const queueResults = [
      createQueueSimulationResult({
        encounters: 120,
        damage: 720000,
        staminaXp: 1100,
      }),
      createQueueSimulationResult({
        encounters: 80,
        damage: 360000,
        staminaXp: 1600,
      }),
      createQueueSimulationResult({
        encounters: 120,
        damage: 720000,
        staminaXp: 1100,
      }),
      createQueueSimulationResult({
        encounters: 80,
        damage: 360000,
        staminaXp: 1600,
      }),
    ];
    simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
      onProgress?.({ progress: 1 });
      const result = queueResults[queueCallIndex];
      queueCallIndex += 1;
      if (queueCallIndex === 4) {
        await finalRunGate;
      }
      return result;
    });

    const runPromise = simulator.runActiveQueue();
    expect(
      await waitForCondition(() => queueCallIndex >= 2 && simulator.activeQueueState.rawRuns.length >= 2, 500),
    ).toBe(true);
    expect(simulator.activeQueueState.isRunning).toBe(true);

    simulator.updateActiveQueueSettings({
      weightProfit: 0,
      weightXp: 1,
    });

    expect(simulator.activeQueueState.ranking).toHaveLength(2);
    expect(simulator.activeQueueState.ranking[0].id).toBe(xpFocusedItems[0].id);
    expect(await waitForCondition(() => queueCallIndex >= 4, 500)).toBe(true);
    expect(simulator.activeQueueState.isRunning).toBe(true);
    expect(simulator.activeQueueState.ranking[0].id).toBe(xpFocusedItems[0].id);

    releaseFinalRun?.();
    const rows = await runPromise;

    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe(xpFocusedItems[0].id);
  });

  it('keeps aggregated baseline metrics when a representative baseline sim result differs', async () => {
    const simulator = useSimulatorStore();

    await simulator.setQueueBaselineForActivePlayer();
    simulator.activeQueueState.baseline.metrics = {
      encountersPerHour: 100,
      deathsPerHour: 0,
      totalXpPerHour: 1000,
      profitPerHour: 100,
      dps: 200,
      dailyNoRngProfit: 2400,
      xpPerHour: 1000,
      killsPerHour: 100,
    };
    simulator.activeQueueState.baseline.metricSummary = {
      dps: { robustMean: 200 },
      dailyNoRngProfit: { robustMean: 2400 },
      xpPerHour: { robustMean: 1000 },
      killsPerHour: { robustMean: 100 },
    };
    simulator.activeQueueState.baseline.completedRounds = 2;
    simulator.activeQueueState.baseline.simResult = {
      simulatedTime: ONE_HOUR,
      encounters: 10,
      experienceGained: {
        player1: {
          stamina: 10,
        },
      },
      deaths: {
        player1: 0,
      },
      consumablesUsed: {},
    };

    simulator.activePlayer.levels.stamina = 10;
    simulator.addActivePlayerToQueue();
    simulator.updateActiveQueueSettings({
      rounds: 1,
      executionMode: 'serial',
      medianBlend: 0.5,
      weightProfit: 0,
      weightXp: 1,
      weightDeathSafety: 0,
    });
    simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
      onProgress?.({ progress: 1 });
      return {
        simulatedTime: ONE_HOUR,
        encounters: 100,
        experienceGained: {
          player1: {
            stamina: 1000,
          },
        },
        deaths: {
          player1: 0,
        },
        consumablesUsed: {},
      };
    });

    const rows = await simulator.runActiveQueue();

    expect(simulator.activeQueueState.baseline.metrics.dps).toBe(200);
    expect(simulator.activeQueueState.baseline.metrics.killsPerHour).toBe(100);
    expect(rows[0].deltaKillsPct).toBeCloseTo(0, 6);
  });

  it('runs queue entries with the frozen selected party snapshot', async () => {
    const simulator = useSimulatorStore();
    await simulator.setQueueBaselineForActivePlayer();
    simulator.players[1].selected = true;
    simulator.players[1].name = 'Support';
    await simulator.setQueueBaselineForActivePlayer();
    simulator.activeQueueState.baseline.metrics = {
      dailyNoRngProfit: 2400,
      dps: 100,
      xpPerHour: 1200,
      killsPerHour: 100,
    };
    simulator.activePlayer.levels.stamina = 10;
    const addedItems = simulator.addActivePlayerToQueue();
    expect(addedItems).toHaveLength(1);

    simulator.updateActiveQueueSettings({
      rounds: 1,
      executionMode: 'serial',
      medianBlend: 0.5,
      weightProfit: 1,
      weightXp: 0,
      weightDeathSafety: 0,
    });

    simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
      onProgress?.({ progress: 1 });
      return {
        simulatedTime: ONE_HOUR,
        encounters: 100,
        experienceGained: {
          player1: {
            stamina: 1000,
          },
          player2: {
            stamina: 500,
          },
        },
        deaths: {
          player1: 0,
          player2: 0,
        },
        consumablesUsed: {},
      };
    });

    const rows = await simulator.runActiveQueue();
    const payload = simulator.runSingleSimulationPayload.mock.calls[0][0];

    expect(payload.players.map((player) => player.hrid)).toEqual(['player1', 'player2']);
    expect(rows).toHaveLength(1);
  });

  it('rejects queue run when a frozen teammate configuration changes', async () => {
    const simulator = useSimulatorStore();
    await simulator.setQueueBaselineForActivePlayer();
    simulator.players[1].selected = true;
    await simulator.setQueueBaselineForActivePlayer();
    simulator.activeQueueState.baseline.metrics = {
      dailyNoRngProfit: 2400,
      dps: 100,
      xpPerHour: 1200,
      killsPerHour: 100,
    };
    simulator.activePlayer.levels.stamina = 10;
    const addedItems = simulator.addActivePlayerToQueue();
    expect(addedItems).toHaveLength(1);

    simulator.players[1].levels.stamina += 1;

    expect(simulator.activeQueuePartyStatus?.hasMismatch).toBe(true);

    const rows = await simulator.runActiveQueue();

    expect(rows).toEqual([]);
    expect(simulator.activeQueueState.error).toBe('common:queue.partyChangedSinceBaseline');
  });

  it('does not add queue items when a frozen teammate configuration changes', async () => {
    const simulator = useSimulatorStore();
    await simulator.setQueueBaselineForActivePlayer();
    simulator.players[1].selected = true;
    await simulator.setQueueBaselineForActivePlayer();

    simulator.players[1].levels.stamina += 1;
    simulator.activePlayer.levels.stamina = 10;

    expect(simulator.activeQueuePartyStatus?.hasMismatch).toBe(true);
    expect(simulator.addActivePlayerToQueue()).toEqual([]);
  });

  it('runs queue in parallel execution mode', async () => {
    const simulator = useSimulatorStore();

    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.levels.stamina = 10;
    simulator.addActivePlayerToQueue();
    simulator.queueRuntime.parallelWorkerLimit = 2;
    simulator.updateActiveQueueSettings({
      rounds: 2,
      executionMode: 'parallel',
      medianBlend: 0.5,
      weightProfit: 1,
      weightXp: 0,
      weightDeathSafety: 0,
    });

    simulator.runSingleSimulationPayloadWithDedicatedWorker = vi.fn(async (_payload, onProgress) => {
      onProgress?.({ progress: 0.5 });
      onProgress?.({ progress: 1 });
      return {
        simulatedTime: ONE_HOUR,
        encounters: 100,
        experienceGained: {
          player1: {
            stamina: 1000,
          },
        },
        deaths: {
          player1: 0,
        },
        consumablesUsed: {},
      };
    });

    const rows = await simulator.runActiveQueue();

    expect(simulator.runSingleSimulationPayloadWithDedicatedWorker).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(1);
    expect(simulator.activeQueueState.rawRuns).toHaveLength(2);
    expect(simulator.activeQueueState.progress).toBe(1);
    expect(simulator.activeQueueState.settings.executionMode).toBe('parallel');
  });

  it('continues parallel queue worker loops after one entry round fails', async () => {
    const simulator = useSimulatorStore();

    await simulator.setQueueBaselineForActivePlayer();
    setQueueBaselineMetrics(simulator);
    simulator.activePlayer.levels.stamina = 10;
    simulator.activePlayer.levels.attack = 20;
    simulator.activePlayer.levels.defense = 30;
    const addedItems = simulator.addActivePlayerToQueue();
    expect(addedItems.length).toBeGreaterThanOrEqual(3);

    simulator.queueRuntime.parallelWorkerLimit = 2;
    simulator.updateActiveQueueSettings({
      rounds: 1,
      executionMode: 'parallel',
      medianBlend: 0.5,
      weightProfit: 1,
      weightXp: 0,
      weightDeathSafety: 0,
    });

    let callCount = 0;
    simulator.runSingleSimulationPayloadWithDedicatedWorker = vi.fn(async (_payload, onProgress) => {
      callCount += 1;
      onProgress?.({ progress: 1 });

      if (callCount === 1) {
        throw new Error('parallel worker dropped');
      }

      return createQueueSimulationResult({
        encounters: 100 + callCount,
        staminaXp: 1000 + callCount * 100,
      });
    });

    const rows = await simulator.runActiveQueue();

    expect(simulator.runSingleSimulationPayloadWithDedicatedWorker).toHaveBeenCalledTimes(addedItems.length);
    expect(simulator.activeQueueState.rawRuns).toHaveLength(addedItems.length - 1);
    expect(rows).toHaveLength(addedItems.length - 1);
    expect(simulator.activeQueueState.lastRunStatus).toBe('partial');
    expect(simulator.activeQueueState.error).toContain('parallel worker dropped');
    expect(simulator.activeQueueState.progress).toBe(1);
  });

  it('passes queue parallelWorkerLimit to zone batch simulations', async () => {
    const simulator = useSimulatorStore();
    const startMultiSimulationSpy = vi.spyOn(workerClient, 'startMultiSimulation').mockImplementation(() => {});

    simulator.queueRuntime.parallelWorkerLimit = 2;
    simulator.simulationSettings.mode = 'zone';
    simulator.simulationSettings.runScope = 'all_group_zones';

    await simulator.startSimulation();

    expect(startMultiSimulationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'start_simulation_all_zones',
        parallelWorkerLimit: 2,
      }),
      expect.any(Object),
    );
  });

  it('passes queue parallelWorkerLimit to labyrinth batch simulations', async () => {
    const simulator = useSimulatorStore();
    const startMultiSimulationSpy = vi.spyOn(workerClient, 'startMultiSimulation').mockImplementation(() => {});

    simulator.queueRuntime.parallelWorkerLimit = 2;
    simulator.simulationSettings.mode = 'labyrinth';
    simulator.simulationSettings.runScope = 'all_labyrinths';

    await simulator.startSimulation();

    expect(startMultiSimulationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'start_simulation_all_labyrinths',
        parallelWorkerLimit: 2,
      }),
      expect.any(Object),
    );
  });

  it('accepts tea crates as active labyrinth crate options', () => {
    const simulator = useSimulatorStore();

    simulator.setLabyrinthCrate('coffee', '/items/basic_coffee_crate');
    simulator.setLabyrinthCrate('food', '/items/basic_food_crate');
    simulator.setLabyrinthCrate('tea', '/items/basic_tea_crate');

    expect(simulator.options.labyrinthCrates.tea.map((item) => item.hrid)).toEqual([
      '/items/basic_tea_crate',
      '/items/advanced_tea_crate',
      '/items/expert_tea_crate',
    ]);
    expect(simulator.simulationSettings.labyrinthCrates).toMatchObject({
      coffee: '/items/basic_coffee_crate',
      food: '/items/basic_food_crate',
      tea: '/items/basic_tea_crate',
    });
    expect(simulator.getActiveLabyrinthCrates()).toEqual([
      '/items/basic_coffee_crate',
      '/items/basic_food_crate',
      '/items/basic_tea_crate',
    ]);
  });

  it('cancels shared single-worker runs when stopSimulation is invoked', async () => {
    const simulator = useSimulatorStore();
    const startSpy = vi.spyOn(workerClient, 'startSimulation').mockImplementation(() => {});
    const stopSpy = vi.spyOn(workerClient, 'stopSimulation').mockImplementation(() => {});

    const runPromise = simulator.runSingleSimulationPayload({
      type: 'start_simulation',
      workerId: 'shared-run',
      players: [],
      zone: null,
      labyrinth: null,
      simulationTimeLimit: 100,
      extra: { mooPass: false, comExp: 0, comDrop: 0, enableHpMpVisualization: false },
    });

    simulator.stopSimulation();

    await expect(runPromise).rejects.toMatchObject({ code: 'cancelled' });
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(stopSpy).toHaveBeenCalled();
  });

  it('blocks manual simulation while a shared worker run is in progress', async () => {
    const simulator = useSimulatorStore();
    const startSpy = vi.spyOn(workerClient, 'startSimulation').mockImplementation(() => {});

    const runPromise = simulator.runSingleSimulationPayload({
      type: 'start_simulation',
      workerId: 'guard-run',
      players: [],
      zone: null,
      labyrinth: null,
      simulationTimeLimit: 100,
      extra: { mooPass: false, comExp: 0, comDrop: 0, enableHpMpVisualization: false },
    });

    await simulator.startSimulation();

    expect(simulator.runtime.error).toBe('common:simulation.errorAnotherRunInProgress');
    // 只有共享运行本身启动了模拟；手动路径被拦截了。
    expect(startSpy).toHaveBeenCalledTimes(1);

    simulator.stopSimulation();
    await expect(runPromise).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('does not treat cancelled parallel queue runs as errors', async () => {
    const simulator = useSimulatorStore();

    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.levels.stamina = 10;
    simulator.addActivePlayerToQueue();
    simulator.queueRuntime.parallelWorkerLimit = 2;
    simulator.updateActiveQueueSettings({
      rounds: 1,
      executionMode: 'parallel',
      medianBlend: 0.5,
      weightProfit: 1,
      weightXp: 0,
      weightDeathSafety: 0,
    });

    simulator.runSingleSimulationPayloadWithDedicatedWorker = vi.fn(async () => {
      const error = new Error('Simulation cancelled.');
      error.code = 'cancelled';
      throw error;
    });

    const rows = await simulator.runActiveQueue();

    expect(rows).toEqual([]);
    expect(simulator.activeQueueState.error).toBe('');
    expect(simulator.runtime.error).toBe('');
    expect(simulator.activeQueueState.lastRunStatus).toBe('cancelled');
    expect(simulator.activeQueueState.isRunning).toBe(false);
    expect(simulator.runtime.isRunning).toBe(false);
  });

  it('refreshes partial queue ranking when cancellation lands inside the realtime throttle window', async () => {
    const simulator = useSimulatorStore();

    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.levels.stamina = 10;
    simulator.activePlayer.levels.attack = 20;
    const addedItems = simulator.addActivePlayerToQueue();
    expect(addedItems.length).toBeGreaterThanOrEqual(2);

    simulator.updateActiveQueueSettings({
      rounds: 2,
      executionMode: 'serial',
      medianBlend: 0.5,
      weightProfit: 1,
      weightXp: 0,
      weightDeathSafety: 0,
    });

    vi.spyOn(Date, 'now').mockImplementation(() => 1000);

    let callCount = 0;
    simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
      callCount += 1;
      onProgress?.({ progress: 1 });

      if (callCount === 3) {
        const error = new Error('Simulation cancelled.');
        error.code = 'cancelled';
        throw error;
      }

      return {
        simulatedTime: ONE_HOUR,
        encounters: 100 + callCount,
        experienceGained: {
          player1: {
            stamina: 1000 + callCount * 100,
          },
        },
        deaths: {
          player1: 0,
        },
        consumablesUsed: {},
      };
    });

    const rows = await simulator.runActiveQueue();

    expect(simulator.activeQueueState.lastRunStatus).toBe('cancelled');
    expect(simulator.activeQueueState.rawRuns).toHaveLength(2);
    expect(simulator.activeQueueState.ranking).toHaveLength(2);
    expect(rows).toHaveLength(2);
  });

  it('does not start a new queue round after stopSimulation requests cancellation', async () => {
    const simulator = useSimulatorStore();

    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.levels.stamina = 10;
    simulator.addActivePlayerToQueue();
    simulator.updateActiveQueueSettings({
      rounds: 2,
      executionMode: 'serial',
      medianBlend: 0.5,
      weightProfit: 1,
      weightXp: 0,
      weightDeathSafety: 0,
    });

    let callCount = 0;
    simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
      callCount += 1;
      onProgress?.({ progress: 1 });

      if (callCount === 1) {
        simulator.stopSimulation();
      }

      return {
        simulatedTime: ONE_HOUR,
        encounters: 100,
        experienceGained: {
          player1: {
            stamina: 1000,
          },
        },
        deaths: {
          player1: 0,
        },
        consumablesUsed: {},
      };
    });

    const rows = await simulator.runActiveQueue();

    expect(callCount).toBe(1);
    expect(rows).toHaveLength(1);
    expect(simulator.activeQueueState.rawRuns).toHaveLength(1);
    expect(simulator.activeQueueState.lastRunStatus).toBe('cancelled');
    expect(simulator.activeQueueState.isRunning).toBe(false);
    expect(simulator.runtime.isRunning).toBe(false);
  });

  it('does not load ability upgrade references when returning partial queue results after cancellation', async () => {
    const simulator = useSimulatorStore();
    const abilityBookInfo = findFirstAbilityBookInfo();
    expect(abilityBookInfo).toBeTruthy();

    global.jigsLevelExperienceTable = [0, 0];
    global.jigsSpellBookXpByName = {};

    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.abilities[0].abilityHrid = abilityBookInfo.abilityHrid;
    simulator.activePlayer.abilities[0].level = 2;
    const addedItems = simulator.addActivePlayerToQueue();
    expect(addedItems).toHaveLength(1);

    simulator.updateActiveQueueSettings({
      rounds: 2,
      executionMode: 'serial',
      medianBlend: 0.5,
      weightProfit: 1,
      weightXp: 0,
      weightDeathSafety: 0,
    });

    const ensureReferenceSpy = vi.spyOn(simulator, 'ensureAbilityUpgradeReferenceDataLoaded');
    let callCount = 0;
    simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
      callCount += 1;
      onProgress?.({ progress: 1 });

      if (callCount === 2) {
        const error = new Error('Simulation cancelled.');
        error.code = 'cancelled';
        throw error;
      }

      return {
        simulatedTime: ONE_HOUR,
        encounters: 100,
        experienceGained: {
          player1: {
            stamina: 1000,
          },
        },
        deaths: {
          player1: 0,
        },
        consumablesUsed: {},
      };
    });

    const rows = await simulator.runActiveQueue();

    expect(rows).toHaveLength(1);
    expect(simulator.activeQueueState.lastRunStatus).toBe('cancelled');
    expect(ensureReferenceSpy).not.toHaveBeenCalled();
  });

  it('splits queue variants by changes when multiple diffs exist', async () => {
    const simulator = useSimulatorStore();
    await simulator.setQueueBaselineForActivePlayer();

    simulator.activePlayer.levels.stamina = 10;
    simulator.activePlayer.levels.attack = 20;
    const addedItems = simulator.addActivePlayerToQueue();

    expect(Array.isArray(addedItems)).toBe(true);
    expect(addedItems.length).toBeGreaterThanOrEqual(2);
  });

  it('creates descriptive queue item names from change summary', async () => {
    const simulator = useSimulatorStore();
    await simulator.setQueueBaselineForActivePlayer();

    simulator.activePlayer.levels.stamina += 5;
    const addedItems = simulator.addActivePlayerToQueue();

    expect(addedItems).toHaveLength(1);
    expect(String(addedItems[0]?.name || '')).toContain('Stamina');
    expect(String(addedItems[0]?.name || '')).not.toMatch(/^Variant\s+\d+/);
  });

  it('restores active player snapshot to baseline after adding queue variants', async () => {
    const simulator = useSimulatorStore();
    await simulator.setQueueBaselineForActivePlayer();

    const baselineStamina = simulator.activeQueueState.baseline.snapshot.levels.stamina;
    simulator.activePlayer.levels.stamina = baselineStamina + 5;
    const addedItems = simulator.addActivePlayerToQueue();

    expect(addedItems.length).toBe(1);
    expect(simulator.activePlayer.levels.stamina).toBe(baselineStamina);
  });

  it('adds queue items when only active trigger conditions change', async () => {
    const simulator = useSimulatorStore();
    const abilityHrid = findFirstAbilityWithDefaultTriggers();
    expect(abilityHrid).toBeTruthy();

    simulator.activePlayer.abilities[0] = {
      abilityHrid,
      level: 1,
    };
    await simulator.setQueueBaselineForActivePlayer();

    simulator.setActivePlayerTriggers(abilityHrid, []);
    const addedItems = simulator.addActivePlayerToQueue();

    expect(addedItems).toHaveLength(1);
    expect(addedItems[0]?.changeDetails).toEqual([
      expect.objectContaining({
        kind: 'trigger',
        targetHrid: abilityHrid,
        beforeState: 'default',
        afterState: 'disabled',
      }),
    ]);
  });

  it('splits queue trigger variants when multiple active trigger changes exist', async () => {
    const simulator = useSimulatorStore();
    const foodHrid = findFirstFoodWithDefaultTriggers();
    const abilityHrid = findFirstAbilityWithDefaultTriggers();
    expect(foodHrid).toBeTruthy();
    expect(abilityHrid).toBeTruthy();

    simulator.activePlayer.food[0] = foodHrid;
    simulator.activePlayer.abilities[0] = {
      abilityHrid,
      level: 1,
    };
    await simulator.setQueueBaselineForActivePlayer();

    simulator.setActivePlayerTriggers(foodHrid, []);
    simulator.setActivePlayerTriggers(abilityHrid, []);
    const addedItems = simulator.addActivePlayerToQueue();

    expect(addedItems).toHaveLength(2);
    expect(addedItems.every((item) => Array.isArray(item.changeDetails) && item.changeDetails.length === 1)).toBe(true);
    expect(addedItems.every((item) => item.changeDetails[0]?.kind === 'trigger')).toBe(true);
    expect(new Set(addedItems.map((item) => item.changeDetails[0]?.targetHrid))).toEqual(
      new Set([foodHrid, abilityHrid]),
    );
  });

  it('keeps swapped-in trigger overrides on queue variants', async () => {
    const simulator = useSimulatorStore();
    const baselineAbilityHrid = findFirstAbilityWithDefaultTriggers();
    const swappedAbilityHrid = findFirstAbilityWithDefaultTriggers(baselineAbilityHrid);
    expect(baselineAbilityHrid).toBeTruthy();
    expect(swappedAbilityHrid).toBeTruthy();

    simulator.activePlayer.abilities[0] = {
      abilityHrid: baselineAbilityHrid,
      level: 1,
    };
    await simulator.setQueueBaselineForActivePlayer();

    simulator.activePlayer.abilities[0] = {
      abilityHrid: swappedAbilityHrid,
      level: 1,
    };
    simulator.setActivePlayerTriggers(swappedAbilityHrid, []);
    const addedItems = simulator.addActivePlayerToQueue();

    expect(addedItems).toHaveLength(1);
    expect(addedItems[0]?.changeDetails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'ability',
          afterAbilityHrid: swappedAbilityHrid,
        }),
        expect.objectContaining({
          kind: 'trigger',
          targetHrid: swappedAbilityHrid,
          beforeState: 'default',
          afterState: 'disabled',
        }),
      ]),
    );

    expect(simulator.loadQueueSnapshotToActivePlayer(addedItems[0].id)).toBe(true);
    expect(simulator.activePlayer.abilities[0]).toEqual({
      abilityHrid: swappedAbilityHrid,
      level: 1,
    });
    expect(simulator.getActivePlayerTriggers(swappedAbilityHrid)).toEqual([]);
  });

  it('ignores stale trigger map edits for inactive targets when queueing', async () => {
    const simulator = useSimulatorStore();
    const activeAbilityHrid = findFirstAbilityWithDefaultTriggers();
    const inactiveAbilityHrid =
      Object.values(abilityDetailMap).find(
        (entry) =>
          String(entry?.hrid || '') !== String(activeAbilityHrid || '') &&
          entry?.isSpecialAbility !== true &&
          Array.isArray(entry?.defaultCombatTriggers),
      )?.hrid ?? '';
    expect(activeAbilityHrid).toBeTruthy();
    expect(inactiveAbilityHrid).toBeTruthy();

    simulator.activePlayer.abilities[0] = {
      abilityHrid: activeAbilityHrid,
      level: 1,
    };
    await simulator.setQueueBaselineForActivePlayer();

    simulator.setActivePlayerTriggers(inactiveAbilityHrid, []);
    expect(simulator.addActivePlayerToQueue()).toEqual([]);
  });

  it('restores trigger default semantics when loading queued trigger snapshots', async () => {
    const simulator = useSimulatorStore();
    const abilityHrid = findFirstAbilityWithDefaultTriggers();
    expect(abilityHrid).toBeTruthy();

    simulator.activePlayer.abilities[0] = {
      abilityHrid,
      level: 1,
    };
    simulator.setActivePlayerTriggers(abilityHrid, []);
    await simulator.setQueueBaselineForActivePlayer();

    delete simulator.activePlayer.triggerMap[abilityHrid];
    const addedItems = simulator.addActivePlayerToQueue();
    expect(addedItems).toHaveLength(1);
    expect(addedItems[0]?.changeDetails).toEqual([
      expect.objectContaining({
        kind: 'trigger',
        targetHrid: abilityHrid,
        beforeState: 'disabled',
        afterState: 'default',
      }),
    ]);

    const loaded = simulator.loadQueueSnapshotToActivePlayer(addedItems[0].id);
    expect(loaded).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(simulator.activePlayer.triggerMap || {}, abilityHrid)).toBe(false);
  });

  it('ignores trigger overrides for targets removed from the edited build', async () => {
    const simulator = useSimulatorStore();
    const abilityHrid = findFirstAbilityWithDefaultTriggers();
    expect(abilityHrid).toBeTruthy();

    simulator.activePlayer.abilities[0] = {
      abilityHrid,
      level: 1,
    };
    await simulator.setQueueBaselineForActivePlayer();

    simulator.setActivePlayerTriggers(abilityHrid, []);
    simulator.activePlayer.abilities[0] = {
      abilityHrid: '',
      level: 1,
    };
    const addedItems = simulator.addActivePlayerToQueue();

    expect(addedItems).toHaveLength(1);
    expect(addedItems[0]?.changeDetails).toEqual([
      expect.objectContaining({
        kind: 'ability',
        beforeAbilityHrid: abilityHrid,
        afterAbilityHrid: '',
      }),
    ]);
  });

  it('builds separate queue variants for house room changes', async () => {
    const simulator = useSimulatorStore();
    const firstRoom = findHouseRoomWithUpgradeLevels(1);
    const secondRoom = findHouseRoomWithUpgradeLevels(1, firstRoom?.hrid);
    expect(firstRoom).toBeTruthy();
    expect(secondRoom).toBeTruthy();

    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.houseRooms[firstRoom.hrid] = 1;
    simulator.activePlayer.houseRooms[secondRoom.hrid] = 2;

    const addedItems = simulator.addActivePlayerToQueue();

    expect(addedItems).toHaveLength(2);
    expect(addedItems.every((item) => Array.isArray(item.changeDetails) && item.changeDetails.length === 1)).toBe(true);
    expect(addedItems.every((item) => item.changeDetails[0]?.kind === 'house_room')).toBe(true);

    const firstVariant = addedItems.find((item) => item.changeDetails[0]?.roomHrid === firstRoom.hrid);
    const secondVariant = addedItems.find((item) => item.changeDetails[0]?.roomHrid === secondRoom.hrid);
    expect(firstVariant?.snapshot?.houseRooms?.[firstRoom.hrid]).toBe(1);
    expect(firstVariant?.snapshot?.houseRooms?.[secondRoom.hrid]).toBe(0);
    expect(secondVariant?.snapshot?.houseRooms?.[firstRoom.hrid]).toBe(0);
    expect(secondVariant?.snapshot?.houseRooms?.[secondRoom.hrid]).toBe(2);
    expect(simulator.activePlayer.houseRooms[firstRoom.hrid]).toBe(0);
    expect(simulator.activePlayer.houseRooms[secondRoom.hrid]).toBe(0);
  });

  it('uses exact market equipment transition cost in queue ranking cost insights', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    expect(equipmentItemHrid).toBeTruthy();

    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.equipment.weapon.itemHrid = equipmentItemHrid;
    simulator.activePlayer.equipment.weapon.enhancementLevel = 2;
    setExactEquipmentAsk(simulator, equipmentItemHrid, 2, 123456);

    const addedItems = simulator.addActivePlayerToQueue();
    expect(addedItems.length).toBe(1);

    simulator.updateActiveQueueSettings({
      rounds: 1,
      executionMode: 'serial',
      medianBlend: 0.5,
      weightProfit: 1,
      weightXp: 0,
      weightDeathSafety: 0,
    });
    simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
      onProgress?.({ progress: 1 });
      return {
        simulatedTime: ONE_HOUR,
        encounters: 100,
        experienceGained: {
          player1: {
            stamina: 1000,
          },
        },
        deaths: {
          player1: 0,
        },
        consumablesUsed: {},
      };
    });

    const rows = await simulator.runActiveQueue();
    const variantRow = rows[0];

    expect(variantRow).toBeTruthy();
    expect(Number(variantRow.costInsights?.totalUpgradeCost)).toBe(123456);
  });

  it('keeps strict gold per 0.01% invalid while allowing composite cost when overall gain stays positive', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();

    expect(equipmentItemHrid).toBeTruthy();

    await simulator.setQueueBaselineForActivePlayer();
    setQueueBaselineMetrics(simulator, {
      dailyNoRngProfit: 2400,
      dps: 10,
      xpPerHour: 900,
      killsPerHour: 80,
    });
    simulator.activePlayer.equipment.weapon.itemHrid = equipmentItemHrid;
    simulator.activePlayer.equipment.weapon.enhancementLevel = 2;
    setExactEquipmentAsk(simulator, equipmentItemHrid, 2, 123456);

    const addedItems = simulator.addActivePlayerToQueue();
    expect(addedItems.length).toBe(1);

    simulator.updateActiveQueueSettings({
      rounds: 1,
      executionMode: 'serial',
      medianBlend: 0.5,
      weightProfit: 0,
      weightXp: 1,
      weightDeathSafety: 0,
    });
    simulator.activeQueueState.rawRuns = [
      createQueueRawRun(
        addedItems[0],
        1,
        {
          dps: 9,
          dailyNoRngProfit: 2200,
          xpPerHour: 1000,
          killsPerHour: 70,
        },
        simulator.activeQueueState.baseline.metrics,
      ),
    ];

    const rows = await simulator.refreshQueueResultsFromRawRuns({
      allowReferenceLoad: false,
      sortRawRuns: false,
    });
    const variantRow = rows[0];

    expect(variantRow).toBeTruthy();
    expect(variantRow.costInsights?.goldPerPoint01PctAvg).toBeNull();
    expect(variantRow.rawComponentScores?.costByMetric?.avgGoldPerPoint01Pct).toBe(0);
    expect(Number(variantRow.costInsights?.compositeGoldPerPoint01Pct)).toBeGreaterThan(0);
  });

  it('includes house room upgrade cost in queue ranking cost insights', async () => {
    const simulator = useSimulatorStore();
    const room = findHouseRoomWithUpgradeLevels(1);
    expect(room).toBeTruthy();

    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.houseRooms[room.hrid] = 1;
    const expectedPreview = simulator.previewHouseRoomUpgradeCost(
      simulator.activeQueueState.baseline.snapshot.houseRooms,
      simulator.activePlayer.houseRooms,
    );

    const addedItems = simulator.addActivePlayerToQueue();
    expect(addedItems.length).toBe(1);
    expect(addedItems[0].changeDetails?.[0]?.kind).toBe('house_room');

    simulator.updateActiveQueueSettings({
      rounds: 1,
      executionMode: 'serial',
      medianBlend: 0.5,
      weightProfit: 1,
      weightXp: 0,
      weightDeathSafety: 0,
    });
    simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
      onProgress?.({ progress: 1 });
      return {
        simulatedTime: ONE_HOUR,
        encounters: 100,
        experienceGained: {
          player1: {
            stamina: 1000,
          },
        },
        deaths: {
          player1: 0,
        },
        consumablesUsed: {},
      };
    });

    const rows = await simulator.runActiveQueue();
    const variantRow = rows[0];

    expect(variantRow).toBeTruthy();
    expect(Number(variantRow.costInsights?.totalUpgradeCost)).toBe(expectedPreview.totals.totalCost);
    expect(Number(variantRow.costInsights?.totalUpgradeCost)).toBeGreaterThan(0);
    expect(variantRow.costInsights?.equipmentSaleValue).toBeNull();
    expect(variantRow.costInsights?.equipmentBuyPrice).toBeNull();
    expect(variantRow.costInsights?.equipmentNetCost).toBeNull();
  });

  it('computes non-zero default ability upgrade cost from baseline snapshot', async () => {
    const simulator = useSimulatorStore();
    const abilityBookInfo = findFirstAbilityBookInfo();
    expect(abilityBookInfo).toBeTruthy();

    const { abilityHrid, xpPerBook, bookItemHrid } = abilityBookInfo;
    global.jigsLevelExperienceTable = [0, 100, 700];
    global.jigsSpellBookXpByName = {};

    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.abilities[0].abilityHrid = abilityHrid;
    simulator.activePlayer.abilities[0].level = 2;

    const draft = simulator.resolveActivePlayerAbilityUpgradeCostDraft(0);
    const expectedBooks = Math.ceil((700 - 100) / xpPerBook);
    const expectedUnitPrice = Number(simulator.pricing?.priceTable?.[bookItemHrid]?.vendor || 0);

    expect(draft).toBeTruthy();
    expect(draft.cost).toBe(expectedBooks * expectedUnitPrice);
    expect(draft.cost).toBeGreaterThan(0);
  });

  it('computes skill-only queue upgrade cost without fetching external ability reference data', async () => {
    const simulator = useSimulatorStore();
    const abilityBookInfo = findFirstAbilityBookInfo();
    expect(abilityBookInfo).toBeTruthy();

    global.fetch = vi.fn(async () => ({ ok: false }));

    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.abilities[0].abilityHrid = abilityBookInfo.abilityHrid;
    simulator.activePlayer.abilities[0].level = 2;
    const addedItems = simulator.addActivePlayerToQueue();

    expect(addedItems).toHaveLength(1);
    expect(addedItems[0].changeDetails?.[0]?.kind).toBe('ability');

    simulator.updateActiveQueueSettings({
      rounds: 1,
      executionMode: 'serial',
      medianBlend: 0.5,
      weightProfit: 1,
      weightXp: 0,
      weightDeathSafety: 0,
    });
    simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
      onProgress?.({ progress: 1 });
      return {
        simulatedTime: ONE_HOUR,
        encounters: 100,
        experienceGained: {
          player1: {
            stamina: 1000,
          },
        },
        deaths: {
          player1: 0,
        },
        consumablesUsed: {},
      };
    });

    const rows = await simulator.runActiveQueue();
    const variantRow = rows[0];

    expect(simulator.runSingleSimulationPayload).toHaveBeenCalledTimes(1);
    expect(variantRow).toBeTruthy();
    expect(global.fetch).toHaveBeenCalledTimes(0);
    expect(Number(variantRow.costInsights?.totalUpgradeCost)).toBeGreaterThan(0);
  });

  it('auto-refreshes existing queue ranking after ability references load without rerunning simulations', async () => {
    const simulator = useSimulatorStore();
    const abilityBookInfo = findFirstAbilityBookInfo();
    expect(abilityBookInfo).toBeTruthy();

    const xpPerBook = Number(abilityBookInfo?.xpPerBook || 0);
    expect(xpPerBook).toBeGreaterThan(0);

    const startXp = Number(levelExperienceTable?.[1] ?? 0);
    const cheaperLevel = 2;
    const cheaperXp = Number(levelExperienceTable?.[cheaperLevel] ?? 0);
    const cheaperBooks = Math.ceil(Math.max(0, cheaperXp - startXp) / xpPerBook);
    expect(cheaperBooks).toBeGreaterThan(0);

    let expensiveLevel = cheaperLevel + 1;
    while (expensiveLevel < (levelExperienceTable?.length ?? 0)) {
      const xpValue = Number(levelExperienceTable?.[expensiveLevel] ?? 0);
      const booksNeeded = Math.ceil(Math.max(0, xpValue - startXp) / xpPerBook);
      if (booksNeeded > cheaperBooks) {
        break;
      }
      expensiveLevel += 1;
    }
    expect(expensiveLevel).toBeLessThan(levelExperienceTable.length);

    global.fetch = vi.fn(async () => ({ ok: false }));
    global.jigsLevelExperienceTable = [0, 0];
    global.jigsSpellBookXpByName = {};

    await simulator.setQueueBaselineForActivePlayer();

    simulator.activePlayer.abilities[0].abilityHrid = abilityBookInfo.abilityHrid;
    simulator.activePlayer.abilities[0].level = expensiveLevel;
    const expensiveItems = simulator.addActivePlayerToQueue();
    expect(expensiveItems).toHaveLength(1);

    simulator.activePlayer.abilities[0].abilityHrid = abilityBookInfo.abilityHrid;
    simulator.activePlayer.abilities[0].level = cheaperLevel;
    const cheaperItems = simulator.addActivePlayerToQueue();
    expect(cheaperItems).toHaveLength(1);

    const expensiveVariantId = expensiveItems[0].id;
    const cheaperVariantId = cheaperItems[0].id;

    simulator.queueRuntime.finalWeights = {
      performance: 0,
      stability: 0,
      cost: 1,
    };
    simulator.updateActiveQueueSettings({
      rounds: 1,
      executionMode: 'serial',
      medianBlend: 0.5,
      weightProfit: 1,
      weightXp: 0,
      weightDeathSafety: 0,
    });
    simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
      onProgress?.({ progress: 1 });
      return {
        simulatedTime: ONE_HOUR,
        encounters: 100,
        experienceGained: {
          player1: {
            stamina: 1000,
          },
        },
        deaths: {
          player1: 0,
        },
        consumablesUsed: {},
      };
    });

    const rowsBeforeRefresh = await simulator.runActiveQueue();

    expect(simulator.runSingleSimulationPayload).toHaveBeenCalledTimes(2);
    expect(rowsBeforeRefresh).toHaveLength(2);
    expect(rowsBeforeRefresh[0].id).toBe(expensiveVariantId);
    expect(rowsBeforeRefresh[0].costInsights?.totalUpgradeCost).toBeNull();
    expect(rowsBeforeRefresh[1].costInsights?.totalUpgradeCost).toBeNull();

    const refreshResult = await simulator.ensureAbilityUpgradeReferenceDataLoaded(true);
    const refreshedRows = simulator.activeQueueState.ranking;
    const refreshedCheaperRow = refreshedRows.find((row) => row.id === cheaperVariantId);
    const refreshedExpensiveRow = refreshedRows.find((row) => row.id === expensiveVariantId);

    expect(refreshResult?.loaded).toBe(true);
    expect(simulator.runSingleSimulationPayload).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledTimes(0);
    expect(refreshedRows).toHaveLength(2);
    expect(refreshedRows[0].id).toBe(cheaperVariantId);
    expect(refreshedCheaperRow).toBeTruthy();
    expect(refreshedExpensiveRow).toBeTruthy();
    expect(Number(refreshedCheaperRow.costInsights?.totalUpgradeCost)).toBeGreaterThan(0);
    expect(Number(refreshedExpensiveRow.costInsights?.totalUpgradeCost)).toBeGreaterThan(
      Number(refreshedCheaperRow.costInsights?.totalUpgradeCost),
    );
    expect(refreshedCheaperRow.finalScore).toBeGreaterThan(refreshedExpensiveRow.finalScore);
  });

  it('keeps cancelled queue refreshes limited to completed partial rows after ability references load', async () => {
    const simulator = useSimulatorStore();
    const abilityBookInfo = findFirstAbilityBookInfo();
    expect(abilityBookInfo).toBeTruthy();

    global.jigsLevelExperienceTable = [0, 0];
    global.jigsSpellBookXpByName = {};

    await simulator.setQueueBaselineForActivePlayer();

    simulator.activePlayer.abilities[0].abilityHrid = abilityBookInfo.abilityHrid;
    simulator.activePlayer.abilities[0].level = 2;
    const firstItems = simulator.addActivePlayerToQueue();
    expect(firstItems).toHaveLength(1);

    simulator.activePlayer.abilities[0].abilityHrid = abilityBookInfo.abilityHrid;
    simulator.activePlayer.abilities[0].level = 3;
    const secondItems = simulator.addActivePlayerToQueue();
    expect(secondItems).toHaveLength(1);

    simulator.updateActiveQueueSettings({
      rounds: 1,
      executionMode: 'serial',
      medianBlend: 0.5,
      weightProfit: 1,
      weightXp: 0,
      weightDeathSafety: 0,
    });

    let callCount = 0;
    simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
      callCount += 1;
      onProgress?.({ progress: 1 });

      if (callCount === 2) {
        const error = new Error('Simulation cancelled.');
        error.code = 'cancelled';
        throw error;
      }

      return {
        simulatedTime: ONE_HOUR,
        encounters: 100,
        experienceGained: {
          player1: {
            stamina: 1000,
          },
        },
        deaths: {
          player1: 0,
        },
        consumablesUsed: {},
      };
    });

    const cancelledRows = await simulator.runActiveQueue();
    expect(cancelledRows).toHaveLength(1);
    expect(simulator.activeQueueState.lastRunStatus).toBe('cancelled');
    expect(simulator.activeQueueState.ranking.map((row) => row.id)).toEqual([firstItems[0].id]);

    await simulator.ensureAbilityUpgradeReferenceDataLoaded(true);

    expect(simulator.activeQueueState.lastRunStatus).toBe('cancelled');
    expect(simulator.activeQueueState.ranking.map((row) => row.id)).toEqual([firstItems[0].id]);
    expect(simulator.activeQueueState.ranking).toHaveLength(1);
    expect(secondItems[0].id).not.toBe(firstItems[0].id);
  });

  it('runs multi-round baseline simulation when requested', async () => {
    const simulator = useSimulatorStore();
    simulator.setImportedProfileState('1', true);
    simulator.updateActiveQueueSettings({
      baselineRounds: 2,
      executionMode: 'serial',
    });
    const baselineResults = [
      {
        simulatedTime: ONE_HOUR,
        encounters: 120,
        experienceGained: {
          player1: {
            stamina: 1200,
          },
        },
        deaths: {
          player1: 0,
        },
        consumablesUsed: {},
      },
      {
        simulatedTime: ONE_HOUR,
        encounters: 240,
        experienceGained: {
          player1: {
            stamina: 2400,
          },
        },
        deaths: {
          player1: 0,
        },
        consumablesUsed: {},
      },
    ];
    simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
      onProgress?.({ progress: 0.999 });
      return baselineResults.shift();
    });

    const baseline = await simulator.setQueueBaselineForActivePlayer({ runSimulation: true });

    expect(simulator.runSingleSimulationPayload).toHaveBeenCalledTimes(2);
    expect(baseline?.completedRounds).toBe(2);
    expect(baseline?.metrics?.totalXpPerHour).toBe(1800);
    expect(baseline?.metrics?.killsPerHour).toBe(180);
    expect(baseline?.metricSummary?.killsPerHour?.sampleCount).toBe(2);
    expect(simulator.activeQueueState.isRunning).toBe(false);
    expect(simulator.runtime.progress).toBe(1);
  });

  it('keeps baseline simulation rounds on the captured target settings', async () => {
    const simulator = useSimulatorStore();
    const baselineZone = String(simulator.options?.zones?.[0]?.hrid || '');
    const liveZone = String(
      simulator.options?.zones?.find((zone) => String(zone?.hrid || '') !== baselineZone)?.hrid || '',
    );

    expect(baselineZone).toBeTruthy();
    expect(liveZone).toBeTruthy();

    simulator.setImportedProfileState('1', true);
    simulator.simulationSettings.mode = 'zone';
    simulator.simulationSettings.runScope = 'single';
    simulator.simulationSettings.useDungeon = false;
    simulator.simulationSettings.zoneHrid = baselineZone;
    simulator.simulationSettings.difficultyTier = 1;
    simulator.simulationSettings.simulationTimeHours = 12;
    simulator.simulationSettings.mooPass = false;
    simulator.updateActiveQueueSettings({
      baselineRounds: 2,
      executionMode: 'serial',
    });

    const payloads = [];
    simulator.runSingleSimulationPayload = vi.fn(async (payload, onProgress) => {
      payloads.push(payload);
      if (payloads.length === 1) {
        simulator.simulationSettings.zoneHrid = liveZone;
        simulator.simulationSettings.difficultyTier = 5;
        simulator.simulationSettings.simulationTimeHours = 99;
        simulator.simulationSettings.mooPass = true;
      }
      onProgress?.({ progress: 1 });
      return createQueueSimulationResult();
    });

    const baseline = await simulator.setQueueBaselineForActivePlayer({ runSimulation: true });

    expect(baseline?.settings?.zoneHrid).toBe(baselineZone);
    expect(payloads).toHaveLength(2);
    expect(payloads.map((payload) => payload.zone)).toEqual([
      { zoneHrid: baselineZone, difficultyTier: 1 },
      { zoneHrid: baselineZone, difficultyTier: 1 },
    ]);
    expect(payloads.map((payload) => payload.simulationTimeLimit)).toEqual([12 * ONE_HOUR, 12 * ONE_HOUR]);
    expect(payloads.map((payload) => payload.extra.mooPass)).toEqual([false, false]);
  });

  it('runs multi-round baseline simulation with parallel dedicated workers', async () => {
    const simulator = useSimulatorStore();
    simulator.setImportedProfileState('1', true);
    simulator.queueRuntime.parallelWorkerLimit = 2;
    simulator.updateActiveQueueSettings({
      baselineRounds: 3,
      executionMode: 'parallel',
      medianBlend: 0.5,
    });

    let callCount = 0;
    let activeRuns = 0;
    let maxActiveRuns = 0;
    simulator.runSingleSimulationPayloadWithDedicatedWorker = vi.fn(async (_payload, onProgress) => {
      callCount += 1;
      const currentCall = callCount;
      activeRuns += 1;
      maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
      onProgress?.({ progress: 0.5 });
      try {
        await new Promise((resolve) => {
          setTimeout(resolve, 0);
        });
        onProgress?.({ progress: 1 });
        return createQueueSimulationResult({
          encounters: 100 + currentCall * 10,
          staminaXp: 1000 + currentCall * 100,
        });
      } finally {
        activeRuns = Math.max(0, activeRuns - 1);
      }
    });

    const baseline = await simulator.setQueueBaselineForActivePlayer({ runSimulation: true });

    expect(simulator.runSingleSimulationPayloadWithDedicatedWorker).toHaveBeenCalledTimes(3);
    expect(maxActiveRuns).toBeGreaterThan(1);
    expect(baseline?.completedRounds).toBe(3);
    expect(baseline?.metricSummary?.totalXpPerHour?.sampleCount).toBe(3);
    expect(simulator.runtime.workerMode).toBe('multi');
    expect(simulator.activeQueueState.progress).toBe(1);
    expect(simulator.runtime.progress).toBe(1);
  });

  it('keeps partial baseline metrics when one baseline worker round fails', async () => {
    const simulator = useSimulatorStore();
    simulator.setImportedProfileState('1', true);
    simulator.updateActiveQueueSettings({
      baselineRounds: 3,
      executionMode: 'serial',
      medianBlend: 0.5,
    });

    let callCount = 0;
    simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
      callCount += 1;
      onProgress?.({ progress: 1 });

      if (callCount === 2) {
        throw new Error('baseline worker reset');
      }

      return createQueueSimulationResult({
        encounters: callCount === 1 ? 100 : 300,
        staminaXp: callCount === 1 ? 1000 : 3000,
      });
    });

    const baseline = await simulator.setQueueBaselineForActivePlayer({ runSimulation: true });

    expect(simulator.runSingleSimulationPayload).toHaveBeenCalledTimes(3);
    expect(baseline?.completedRounds).toBe(2);
    expect(baseline?.status).toBe('partial');
    expect(baseline?.failedRounds).toEqual([
      {
        round: 2,
        message: 'baseline worker reset',
      },
    ]);
    expect(baseline?.failureSummary).toMatchObject({
      failedRounds: 1,
      requestedRounds: 3,
    });
    expect(baseline?.metrics?.totalXpPerHour).toBe(2000);
    expect(baseline?.metricSummary?.killsPerHour?.sampleCount).toBe(2);
    expect(simulator.activeQueueState.error).toContain('baseline worker reset');
    expect(simulator.activeQueueState.progress).toBe(1);
    expect(simulator.runtime.progress).toBe(1);
  });

  it('captures selected party snapshot when baseline simulation runs', async () => {
    const simulator = useSimulatorStore();
    simulator.setImportedProfileState('1', true);
    simulator.updateActiveQueueSettings({ baselineRounds: 1, executionMode: 'serial' });
    simulator.players[1].selected = true;
    simulator.players[1].name = 'Support';
    simulator.players[1].levels.stamina = 77;
    simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
      onProgress?.({ progress: 1 });
      return {
        simulatedTime: ONE_HOUR,
        encounters: 120,
        experienceGained: {
          player1: {
            stamina: 1200,
          },
          player2: {
            stamina: 800,
          },
        },
        deaths: {
          player1: 0,
          player2: 0,
        },
        consumablesUsed: {},
      };
    });

    const baseline = await simulator.setQueueBaselineForActivePlayer({ runSimulation: true });
    const payload = simulator.runSingleSimulationPayload.mock.calls[0][0];

    expect(payload.players.map((player) => player.hrid)).toEqual(['player1', 'player2']);
    expect(baseline?.partySnapshot?.selectedPlayers.map((player) => player.id)).toEqual(['1', '2']);
    expect(baseline?.partySnapshot?.selectedPlayers.map((player) => player.selected)).toEqual([true, true]);
  });

  it('resets cancelled queue status when baseline is rebuilt without simulation', async () => {
    const simulator = useSimulatorStore();

    await simulator.setQueueBaselineForActivePlayer();
    simulator.activeQueueState.lastRunStatus = 'cancelled';
    simulator.activeQueueState.cancelRequested = true;
    simulator.activeQueueState.ranking = [{ id: 'partial-row' }];
    simulator.activeQueueState.rawRuns = [{ id: 'partial-row', round: 1 }];

    await simulator.setQueueBaselineForActivePlayer();

    expect(simulator.activeQueueState.lastRunStatus).toBe('idle');
    expect(simulator.activeQueueState.cancelRequested).toBe(false);
    expect(simulator.activeQueueState.ranking).toEqual([]);
    expect(simulator.activeQueueState.rawRuns).toEqual([]);
  });

  it('preserves queue items when baseline simulation is rerun by default', async () => {
    const simulator = useSimulatorStore();
    await simulator.setQueueBaselineForActivePlayer();

    simulator.activePlayer.levels.stamina += 5;
    const appended = simulator.addActivePlayerToQueue();
    expect(appended).toHaveLength(1);
    const queueIdsBefore = simulator.activeQueueState.items.map((item) => item.id);

    simulator.setImportedProfileState('1', true);
    simulator.updateActiveQueueSettings({ baselineRounds: 1, executionMode: 'serial' });
    simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
      onProgress?.({ progress: 1 });
      return {
        simulatedTime: ONE_HOUR,
        encounters: 100,
        experienceGained: {
          player1: {
            stamina: 1000,
          },
        },
        deaths: {
          player1: 0,
        },
        consumablesUsed: {},
      };
    });

    await simulator.setQueueBaselineForActivePlayer({ runSimulation: true });
    expect(simulator.activeQueueState.items.map((item) => item.id)).toEqual(queueIdsBefore);
  });

  it('clears queue items when baseline simulation rerun opts out of preserve mode', async () => {
    const simulator = useSimulatorStore();
    await simulator.setQueueBaselineForActivePlayer();

    simulator.activePlayer.levels.stamina += 5;
    const appended = simulator.addActivePlayerToQueue();
    expect(appended).toHaveLength(1);

    simulator.setImportedProfileState('1', true);
    simulator.updateActiveQueueSettings({ baselineRounds: 1, executionMode: 'serial' });
    simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
      onProgress?.({ progress: 1 });
      return {
        simulatedTime: ONE_HOUR,
        encounters: 100,
        experienceGained: {
          player1: {
            stamina: 1000,
          },
        },
        deaths: {
          player1: 0,
        },
        consumablesUsed: {},
      };
    });

    await simulator.setQueueBaselineForActivePlayer({ runSimulation: true, preserveQueueItems: false });
    expect(simulator.activeQueueState.items).toHaveLength(0);
  });

  it('requires imported profile before baseline simulation', async () => {
    const simulator = useSimulatorStore();
    await expect(simulator.setQueueBaselineForActivePlayer({ runSimulation: true })).rejects.toThrow(
      'common:queue.requireImportBeforeBaseline',
    );
  });

  it('marks imported profile state after solo import', () => {
    const simulator = useSimulatorStore();
    const soloText = JSON.stringify({
      version: 2,
      player: {
        achievements: {
          [ACHIEVEMENT_HRID]: true,
        },
      },
    });
    simulator.setImportedProfileState('1', false);

    simulator.importSoloConfig(soloText, '1');

    expect(simulator.queue.importedProfileByPlayer['1']).toBe(true);
    expect(simulator.players[0].achievements[ACHIEVEMENT_HRID]).toBe(true);
    expect(JSON.parse(global.localStorage.getItem(PLAYER_ACHIEVEMENTS_STORAGE_KEY)).achievementsByPlayer['1']).toEqual({
      [ACHIEVEMENT_HRID]: true,
    });
  });

  it('restores the dense in-memory advanced-state contract at the Store import boundary', () => {
    const simulator = useSimulatorStore();
    const roomHrids = Object.keys(simulator.activePlayer.houseRooms);
    const importedRoomHrid = roomHrids[0];

    const result = simulator.importSoloConfig(
      JSON.stringify({
        version: 2,
        player: {
          id: '1',
          houseRooms: { [importedRoomHrid]: 3 },
          guildBuffs: null,
          achievements: null,
        },
      }),
      '1',
    );

    expect(Object.keys(result.player.houseRooms)).toHaveLength(roomHrids.length);
    expect(result.player.houseRooms[importedRoomHrid]).toBe(3);
    expect(roomHrids.every((hrid) => Number.isInteger(result.player.houseRooms[hrid]))).toBe(true);
    expect(result.player.achievements).toEqual({});
    expect(Object.keys(result.player.guildBuffs)).toHaveLength(combatGuildBuffDetails.length);

    const exportedPlayer = JSON.parse(simulator.exportSoloConfig('1')).player;
    expect(exportedPlayer.houseRooms).toEqual({ [importedRoomHrid]: 3 });
  });

  it('imports main-site shareable profile into the active player without changing simulation settings', () => {
    const simulator = useSimulatorStore();
    const headItemHrid = findFirstEquipmentItemByType('/equipment_types/head');
    const weaponItemHrid = findFirstEquipmentItemByType('/equipment_types/two_hand');
    const foodItemHrid = findFirstFoodWithDefaultTriggers();
    const drinkItemHrid = findFirstDrinkWithDefaultTriggers();
    const abilityHrid = findFirstAbilityWithDefaultTriggers();
    const specialAbilityHrid = findFirstSpecialAbility();
    const zoneActionHrid = findFirstCombatAction(false);
    const houseRoomHrid = Object.keys(simulator.players[2].houseRooms)[0];

    expect(headItemHrid).toBeTruthy();
    expect(weaponItemHrid).toBeTruthy();
    expect(foodItemHrid).toBeTruthy();
    expect(drinkItemHrid).toBeTruthy();
    expect(abilityHrid).toBeTruthy();
    expect(specialAbilityHrid).toBeTruthy();
    expect(zoneActionHrid).toBeTruthy();
    expect(houseRoomHrid).toBeTruthy();

    simulator.setActivePlayer('3');
    simulator.simulationSettings.mode = 'zone';
    simulator.simulationSettings.useDungeon = true;
    simulator.simulationSettings.zoneHrid = '/actions/combat/jungle_planet';
    simulator.simulationSettings.dungeonHrid = '/actions/combat/chimerical_den';
    simulator.simulationSettings.difficultyTier = 2;
    simulator.simulationSettings.simulationTimeHours = 48;

    const payload = {
      profile: createMainSiteShareProfileFixture({
        skills: {
          stamina: 14,
          intelligence: 24,
          attack: 34,
          melee: 44,
          defense: 54,
          ranged: 64,
          magic: 74,
        },
        skillExperience: {
          stamina: 1400,
          intelligence: 2400,
          attack: 3400,
          melee: 4400,
          defense: 5400,
          ranged: 6400,
          magic: 7400,
        },
        wearableItemMap: {
          head: {
            itemLocationHrid: '/item_locations/head',
            itemHrid: headItemHrid,
            enhancementLevel: 2,
          },
          weapon: {
            itemLocationHrid: '/item_locations/two_hand',
            itemHrid: weaponItemHrid,
            enhancementLevel: 5,
          },
        },
        equippedAbilities: [
          {
            slotNumber: 1,
            abilityHrid,
            level: 6,
            experience: 0,
          },
          {
            abilityHrid: specialAbilityHrid,
            level: 4,
            experience: 0,
          },
        ],
        foodItemHrids: [foodItemHrid, '', ''],
        drinkItemHrids: [drinkItemHrid, '', ''],
        consumableCombatTriggersMap: {
          [foodItemHrid]: itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers,
          [drinkItemHrid]: itemDetailMap[drinkItemHrid].consumableDetail.defaultCombatTriggers,
        },
        abilityCombatTriggersMap: {
          [abilityHrid]: abilityDetailMap[abilityHrid].defaultCombatTriggers,
        },
        characterHouseRoomMap: {
          [houseRoomHrid]: {
            level: 5,
          },
        },
        characterAchievements: [
          {
            achievementHrid: ACHIEVEMENT_HRID,
            progress: 1,
            isCompleted: true,
          },
        ],
      }),
      mainSiteCombat: {
        actionHrid: zoneActionHrid,
        difficultyTier: 1,
      },
    };

    const result = simulator.importSoloConfig(JSON.stringify(payload), '3');

    expect(result.detectedFormat).toBe('main-site-share-profile');
    expect(simulator.players[2].name).toBe('Main Site Hero');
    expect(simulator.players[2].levels.stamina).toBe(14);
    expect(simulator.players[2].levels.magic).toBe(74);
    expect(simulator.players[2].skillExperience.stamina).toBe(1400);
    expect(simulator.players[2].skillExperience.magic).toBe(7400);
    expect(simulator.players[2].equipment.head.itemHrid).toBe(headItemHrid);
    expect(simulator.players[2].equipment.weapon.itemHrid).toBe(weaponItemHrid);
    expect(simulator.players[2].food[0]).toBe(foodItemHrid);
    expect(simulator.players[2].drinks[0]).toBe(drinkItemHrid);
    expect(simulator.players[2].abilities[0].abilityHrid).toBe(specialAbilityHrid);
    expect(simulator.players[2].abilities[0].level).toBe(4);
    expect(simulator.players[2].abilities[1].abilityHrid).toBe(abilityHrid);
    expect(simulator.players[2].abilities[1].level).toBe(6);
    expect(simulator.players[2].triggerMap[foodItemHrid]).toEqual(
      itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers,
    );
    expect(simulator.players[2].triggerMap[drinkItemHrid]).toEqual(
      itemDetailMap[drinkItemHrid].consumableDetail.defaultCombatTriggers,
    );
    expect(simulator.players[2].triggerMap[abilityHrid]).toEqual(abilityDetailMap[abilityHrid].defaultCombatTriggers);
    expect(simulator.players[2].houseRooms[houseRoomHrid]).toBe(5);
    expect(simulator.players[2].achievements[ACHIEVEMENT_HRID]).toBe(true);
    expect(simulator.players[0].name).toBe('Player 1');
    expect(simulator.queue.importedProfileByPlayer['3']).toBe(true);
    expect(simulator.queue.importedBaselineByPlayer['3'].skillExperience.stamina).toBe(1400);
    expect(simulator.simulationSettings.mode).toBe('zone');
    expect(simulator.simulationSettings.useDungeon).toBe(false);
    expect(simulator.simulationSettings.zoneHrid).toBe(zoneActionHrid);
    expect(simulator.simulationSettings.difficultyTier).toBe(1);
    expect(simulator.simulationSettings.simulationTimeHours).toBe(48);
  });

  it('#18：混合载荷逐件来源标注——syntheticItemHrids 命中的 hrid 标合成中价，其余标官方', () => {
    const simulator = useSimulatorStore();
    const payload = {
      ...createMainSiteCurrentCharacterFixture({ characterName: 'Mixed Source Hero' }),
      marketItemValues: { '/items/foo': { 0: 100 }, '/items/bar': { 0: 200 }, '/items/baz': { 1: 300 } },
      marketEstimateSource: 'official',
      syntheticItemHrids: ['/items/bar'],
    };
    const result = simulator.importSoloConfig(JSON.stringify(payload), '1');
    expect(result.marketItemValues).toEqual(payload.marketItemValues);
    expect(simulator.pricing.marketItemValues['/items/foo']['0']).toBe(100);
    expect(simulator.pricing.marketItemValueSources).toEqual({
      '/items/foo': 'official',
      '/items/bar': 'synthetic',
      '/items/baz': 'official',
    });
  });

  it('【一般-5】混合物品等级级来源标注——syntheticLevelKeys 命中等级建覆盖，二次导入清理陈旧覆盖', () => {
    const simulator = useSimulatorStore();
    simulator.pricing.lastFetchedAt = Date.now();
    const buildPayload = (extra = {}) => ({
      ...createMainSiteCurrentCharacterFixture({ characterName: 'Level Source Hero' }),
      marketItemValues: { '/items/foo': { 0: 100, 1: 200 } },
      marketEstimateSource: 'official',
      ...extra,
    });

    // 混合物品：等级 0 官方、等级 1 由合成中价补齐（syntheticLevelKeys 清单，含非规范
    // 键 '1.0'——归一化为 '1' 后才与消费端规范查询键对齐）。
    // 物品级标注保持 official（默认来源），等级级覆盖只记合成补齐的等级。
    simulator.importSoloConfig(JSON.stringify(buildPayload({ syntheticLevelKeys: { '/items/foo': ['1.0'] } })), '1');
    expect(simulator.pricing.marketItemValueSources).toEqual({ '/items/foo': 'official' });
    expect(simulator.pricing.marketItemValueSourcesByLevel).toEqual({
      '/items/foo': { 1: 'synthetic' },
    });

    // 下次载荷不再携带清单（物品转纯官方）：本次载荷覆盖的 hrid 陈旧等级覆盖被清理
    //（不残留——否则转纯官方后的等级 1 仍被误标合成中价）。
    simulator.importSoloConfig(JSON.stringify(buildPayload()), '2');
    expect(simulator.pricing.marketItemValueSources).toEqual({ '/items/foo': 'official' });
    expect(simulator.pricing.marketItemValueSourcesByLevel).toEqual({});
  });

  it('【一般-5】等级级来源标注随市场缓存持久化——重启后合成补齐等级标签不翻转', () => {
    const simulator = useSimulatorStore();
    simulator.pricing.lastFetchedAt = Date.now();
    const payload = {
      ...createMainSiteCurrentCharacterFixture({ characterName: 'Level Persist Hero' }),
      marketItemValues: { '/items/foo': { 0: 100 } },
      marketEstimateSource: 'official',
      syntheticLevelKeys: { '/items/foo': ['0'] },
    };
    simulator.importSoloConfig(JSON.stringify(payload), '1');
    expect(simulator.pricing.marketItemValueSources).toEqual({ '/items/foo': 'official' });
    expect(simulator.pricing.marketItemValueSourcesByLevel).toEqual({ '/items/foo': { 0: 'synthetic' } });

    // 玩家装备 foo（0 级）→ 行级标签 = synthetic_mid（等级级覆盖优先于物品级 official）。
    const playerA = simulator.players.find((entry) => String(entry.id) === '1');
    playerA.equipment.weapon = { itemHrid: '/items/foo', enhancementLevel: 0 };
    simulator.refreshAssetScores();
    expect(playerA.assetScore).not.toBeNull();
    const fooRowA = playerA.assetScore.items.equipment.find((row) => row.itemHrid === '/items/foo');
    expect(fooRowA).toMatchObject({
      enhancementLevel: 0,
      source: ASSET_SCORE_SOURCES.SYNTHETIC_MID,
    });

    // 重启：新 pinia（新 store 实例），createPricingState 从持久化缓存恢复等级级覆盖。
    setActivePinia(createPinia());
    const restarted = useSimulatorStore();
    expect(restarted.pricing.marketItemValueSources).toEqual({ '/items/foo': 'official' });
    expect(restarted.pricing.marketItemValueSourcesByLevel).toEqual({ '/items/foo': { 0: 'synthetic' } });
  });

  it('#30 A3：来源标注随市场缓存持久化——重启+快照恢复后合成中价标签不翻转', () => {
    // 会话 A：REST 行情缓存存在（lastFetchedAt > 0），主站透传合成来源估值。
    const simulator = useSimulatorStore();
    simulator.pricing.lastFetchedAt = Date.now();
    const payload = {
      ...createMainSiteCurrentCharacterFixture({ characterName: 'Restart Hero' }),
      marketItemValues: { '/items/foo': { 0: 100 } },
      marketEstimateSource: 'synthetic',
    };
    simulator.importSoloConfig(JSON.stringify(payload), '1');
    expect(simulator.pricing.marketItemValueSources).toEqual({ '/items/foo': 'synthetic' });

    // 玩家装备 foo（0 级：官方估算分支直达，无成本择优干扰）→ 行级标签 = synthetic_mid。
    const playerA = simulator.players.find((entry) => String(entry.id) === '1');
    playerA.equipment.weapon = { itemHrid: '/items/foo', enhancementLevel: 0 };
    simulator.refreshAssetScores();
    expect(playerA.assetScore).not.toBeNull();
    const fooRowA = playerA.assetScore.items.equipment.find((row) => row.itemHrid === '/items/foo');
    expect(fooRowA).toMatchObject({
      enhancementLevel: 0,
      source: ASSET_SCORE_SOURCES.SYNTHETIC_MID,
    });

    // 保存玩家快照：app 导出格式携带诚实标签，但不携带 marketItemValues/来源标记
    //（该缺口正是 A3 失真链的前提：重启后唯一能恢复来源真值的通道是市场缓存）。
    const snapshotText = exportSoloConfig(playerA, simulator.simulationSettings);
    const snapshotPayload = JSON.parse(snapshotText);
    expect(snapshotPayload.marketItemValues).toBeUndefined();
    expect(snapshotPayload.marketEstimateSource).toBeUndefined();
    expect(snapshotPayload.player.assetScore.items.equipment.find((row) => row.itemHrid === '/items/foo').source).toBe(
      ASSET_SCORE_SOURCES.SYNTHETIC_MID,
    );

    // 重启：新 pinia（新 store 实例），createPricingState 从持久化缓存恢复数值与来源标注。
    setActivePinia(createPinia());
    const restarted = useSimulatorStore();
    expect(restarted.pricing.marketItemValues).toEqual({ '/items/foo': { 0: 100 } });
    expect(restarted.pricing.marketItemValueSources).toEqual({ '/items/foo': 'synthetic' });
    expect(restarted.pricing.lastFetchedAt).toBeGreaterThan(0);

    // 恢复快照：app 载荷无市场字段（不触发 apply），快照携带 synthetic_mid 标签；
    // 恢复后重算（pricingReady=true 恒重算）与快照逐字段一致 → 等值守卫挡住写回，
    // 诚实标签不被改标官方估算（修复前：sources 丢失 → 重算全标 official_estimate →
    // assetScoreEquals 不等 → 快照被覆写）。
    restarted.importSoloConfig(snapshotText, '1');
    const restoredPlayer = restarted.players.find((entry) => String(entry.id) === '1');
    expect(restoredPlayer.assetScore).not.toBeNull();
    const restoredSnapshot = restoredPlayer.assetScore;
    expect(restoredSnapshot.items.equipment.find((row) => row.itemHrid === '/items/foo')).toMatchObject({
      enhancementLevel: 0,
      source: ASSET_SCORE_SOURCES.SYNTHETIC_MID,
    });
    // 模拟 App.vue 资产分 watch（签名+行情引用触发向量）再次触发的重算：同值同源 → 引用不变（无覆写）。
    restarted.refreshAssetScores();
    expect(restoredPlayer.assetScore).toBe(restoredSnapshot);
  });

  it('#23：团队桥接逐成员导入同一份 merged 快照——值相同时引用不变且不再落盘', () => {
    const simulator = useSimulatorStore();
    // 已有 REST 行情缓存（lastFetchedAt > 0）时，透传值合并会随市场缓存落盘。
    simulator.pricing.lastFetchedAt = Date.now();

    const buildTeamMemberPayload = () => ({
      ...createMainSiteCurrentCharacterFixture({ characterName: 'Team Member' }),
      marketItemValues: { '/items/foo': { 0: 100 }, '/items/bar': { 1: 250 } },
      marketEstimateSource: 'official',
    });

    const countMarketCacheWrites = () =>
      global.localStorage.setItem.mock.calls.filter(([key]) => key === 'mwi.price.marketCache.v1').length;

    // 第一个成员导入：合并（引用替换）+ 市场缓存落盘各一次。
    simulator.importSoloConfig(JSON.stringify(buildTeamMemberPayload()), '1');
    const afterFirstMember = simulator.pricing.marketItemValues;
    expect(afterFirstMember['/items/foo']['0']).toBe(100);
    const writesAfterFirstMember = countMarketCacheWrites();
    expect(writesAfterFirstMember).toBe(1);

    // 第二个成员透传同一份 merged 快照（脚本侧 getMergedMarketItemValues 共享缓存）：
    // 内容一致 → 引用不变（成本缓存指纹不失效、Vue 依赖不触发）且不再全量落盘。
    simulator.importSoloConfig(JSON.stringify(buildTeamMemberPayload()), '2');
    expect(simulator.pricing.marketItemValues).toBe(afterFirstMember);
    expect(countMarketCacheWrites()).toBe(writesAfterFirstMember);

    // 值变化（模拟行情更新后的下一次导入）：恢复引用替换 + 落盘。
    const changedPayload = buildTeamMemberPayload();
    changedPayload.marketItemValues = { '/items/foo': { 0: 120 } };
    simulator.importSoloConfig(JSON.stringify(changedPayload), '3');
    expect(simulator.pricing.marketItemValues).not.toBe(afterFirstMember);
    expect(simulator.pricing.marketItemValues['/items/foo']['0']).toBe(120);
    expect(countMarketCacheWrites()).toBe(writesAfterFirstMember + 1);
  });

  it('#23：值相同但来源标记变化——数值引用不变、sources 换标并落盘（#30 A3）', () => {
    const simulator = useSimulatorStore();
    simulator.pricing.lastFetchedAt = Date.now();

    const buildPayload = (estimateSource) => ({
      ...createMainSiteCurrentCharacterFixture({ characterName: 'Source Flip Hero' }),
      marketItemValues: { '/items/foo': { 0: 100 } },
      marketEstimateSource: estimateSource,
    });

    simulator.importSoloConfig(JSON.stringify(buildPayload('official')), '1');
    const afterFirstImport = simulator.pricing.marketItemValues;
    expect(simulator.pricing.marketItemValueSources).toEqual({ '/items/foo': 'official' });
    const countMarketCacheWrites = () =>
      global.localStorage.setItem.mock.calls.filter(([key]) => key === 'mwi.price.marketCache.v1').length;
    const writesAfterFirstImport = countMarketCacheWrites();

    // 同值、来源标记从 official 翻转为 synthetic：数值引用不变（无缓存失效），
    // 来源标注按载荷整体换标（标签语义与数值口径解耦）；sources 变化需随缓存落盘
    //（#30 A3：同值换源不落盘会使重启后恢复旧来源标注、来源真值跨会话断裂）。
    simulator.importSoloConfig(JSON.stringify(buildPayload('synthetic')), '2');
    expect(simulator.pricing.marketItemValues).toBe(afterFirstImport);
    expect(simulator.pricing.marketItemValueSources).toEqual({ '/items/foo': 'synthetic' });
    expect(countMarketCacheWrites()).toBe(writesAfterFirstImport + 1);
  });

  it('#23：现值为载荷严格超集且重叠值相同——合并为空操作，引用不变不落盘', () => {
    const simulator = useSimulatorStore();
    simulator.pricing.lastFetchedAt = Date.now();

    const countMarketCacheWrites = () =>
      global.localStorage.setItem.mock.calls.filter(([key]) => key === 'mwi.price.marketCache.v1').length;

    // 先导入完整快照（foo + bar），current = { foo, bar }。
    const fullPayload = {
      ...createMainSiteCurrentCharacterFixture({ characterName: 'Superset Hero' }),
      marketItemValues: { '/items/foo': { 0: 100 }, '/items/bar': { 0: 200 } },
      marketEstimateSource: 'official',
    };
    simulator.importSoloConfig(JSON.stringify(fullPayload), '1');
    const afterFullImport = simulator.pricing.marketItemValues;
    expect(afterFullImport['/items/bar']['0']).toBe(200);
    expect(countMarketCacheWrites()).toBe(1);

    // 子集载荷（仅 foo，值相同）：app 侧合并只增不减、bar 由合并语义保留 → 合并结果
    // 与现值内容一致（空操作）→ 引用不变、不再落盘。真实场景：脚本侧 merged 快照较
    // 上次导入收缩（官方估算条目被剔除），团队 N 成员各带子集载荷——若按键集全等
    // 判定，N 成员会 N 次冗余合并+落盘；空操作判定闭合该缺口。
    const subsetPayload = {
      ...createMainSiteCurrentCharacterFixture({ characterName: 'Subset Hero' }),
      marketItemValues: { '/items/foo': { 0: 100 } },
      marketEstimateSource: 'official',
    };
    simulator.importSoloConfig(JSON.stringify(subsetPayload), '2');
    expect(simulator.pricing.marketItemValues).toBe(afterFullImport);
    expect(countMarketCacheWrites()).toBe(1);

    // 子集载荷但值变化：foo 由 100 → 120，空操作判定不命中 → 恢复合并+落盘，
    // bar 仍由合并语义保留。
    const changedSubsetPayload = {
      ...createMainSiteCurrentCharacterFixture({ characterName: 'Changed Subset Hero' }),
      marketItemValues: { '/items/foo': { 0: 120 } },
      marketEstimateSource: 'official',
    };
    simulator.importSoloConfig(JSON.stringify(changedSubsetPayload), '3');
    expect(simulator.pricing.marketItemValues).not.toBe(afterFullImport);
    expect(simulator.pricing.marketItemValues['/items/foo']['0']).toBe(120);
    expect(simulator.pricing.marketItemValues['/items/bar']['0']).toBe(200);
    expect(countMarketCacheWrites()).toBe(2);
  });

  it('#33：lastFetchedAt=0（无 REST 行情缓存）——透传值仅会话内生效、不落盘', () => {
    const simulator = useSimulatorStore();
    // 初始 pricing 无缓存行情（lastFetchedAt=0）：透传值合并进会话内状态。
    expect(simulator.pricing.lastFetchedAt).toBe(0);

    const countMarketCacheWrites = () =>
      global.localStorage.setItem.mock.calls.filter(([key]) => key === 'mwi.price.marketCache.v1').length;

    const applied = simulator.applyImportedMarketItemValues({ '/items/foo': { 0: 100 } });
    expect(applied).toBe(true);
    expect(simulator.pricing.marketItemValues['/items/foo']['0']).toBe(100);
    // 门控负分支：无 REST 行情缓存时不落盘（主站下次打开会重新透传）。
    expect(countMarketCacheWrites()).toBe(0);
  });

  it('#33：同 hrid 重声明按整体替换合并——旧载荷的等级档不残留', () => {
    const simulator = useSimulatorStore();

    simulator.applyImportedMarketItemValues({ '/items/foo': { 0: 100, 1: 200 } });
    const baseline = simulator.pricing.marketItemValues;
    expect(baseline['/items/foo']).toEqual({ 0: 100, 1: 200 });

    // 重声明仅 0 档：foo 整体替换为 {0:150}，旧 1 档必须丢弃（非逐档深合并）；
    // 未重声明的 hrid（bar）由合并语义保留。
    simulator.applyImportedMarketItemValues({ '/items/foo': { 0: 150 }, '/items/bar': { 0: 300 } });
    expect(simulator.pricing.marketItemValues).not.toBe(baseline);
    expect(simulator.pricing.marketItemValues['/items/foo']).toEqual({ 0: 150 });
    expect(simulator.pricing.marketItemValues['/items/bar']).toEqual({ 0: 300 });
  });

  it('#33：全非法载荷返回 false 且不触碰现值', () => {
    const simulator = useSimulatorStore();
    simulator.pricing.lastFetchedAt = Date.now();
    simulator.applyImportedMarketItemValues({ '/items/foo': { 0: 100 } });
    const baseline = simulator.pricing.marketItemValues;

    expect(simulator.applyImportedMarketItemValues({ foo: { 0: 100 } })).toBe(false);
    expect(simulator.applyImportedMarketItemValues(null)).toBe(false);
    expect(simulator.pricing.marketItemValues).toBe(baseline);
  });

  it('imports main-site current character payload into the active player without changing simulation settings', () => {
    const simulator = useSimulatorStore();
    const headItemHrid = findFirstEquipmentItemByType('/equipment_types/head');
    const weaponItemHrid = findFirstEquipmentItemByType('/equipment_types/two_hand');
    const foodItemHrid = findFirstFoodWithDefaultTriggers();
    const drinkItemHrid = findFirstDrinkWithDefaultTriggers();
    const abilityHrid = findFirstAbilityWithDefaultTriggers();
    const specialAbilityHrid = findFirstSpecialAbility();
    const zoneActionHrid = findFirstCombatAction(false);
    const houseRoomHrid = Object.keys(simulator.players[3].houseRooms)[0];

    expect(headItemHrid).toBeTruthy();
    expect(weaponItemHrid).toBeTruthy();
    expect(foodItemHrid).toBeTruthy();
    expect(drinkItemHrid).toBeTruthy();
    expect(abilityHrid).toBeTruthy();
    expect(specialAbilityHrid).toBeTruthy();
    expect(zoneActionHrid).toBeTruthy();
    expect(houseRoomHrid).toBeTruthy();

    simulator.setActivePlayer('4');
    simulator.simulationSettings.mode = 'zone';
    simulator.simulationSettings.useDungeon = true;
    simulator.simulationSettings.zoneHrid = '/actions/combat/jungle_planet';
    simulator.simulationSettings.dungeonHrid = '/actions/combat/chimerical_den';
    simulator.simulationSettings.difficultyTier = 1;
    simulator.simulationSettings.simulationTimeHours = 36;

    const payload = {
      ...createMainSiteCurrentCharacterFixture({
        characterName: 'Current Hero',
        skills: {
          stamina: 18,
          intelligence: 28,
          attack: 38,
          melee: 48,
          defense: 58,
          ranged: 68,
          magic: 78,
        },
        skillExperience: {
          stamina: 1800,
          intelligence: 2800,
          attack: 3800,
          melee: 4800,
          defense: 5800,
          ranged: 6800,
          magic: 7800,
        },
        characterItems: [
          {
            itemLocationHrid: '/item_locations/head',
            itemHrid: headItemHrid,
            enhancementLevel: 2,
          },
          {
            currentItem: {
              itemLocationHrid: '/item_locations/two_hand',
              itemHrid: weaponItemHrid,
              enhancementLevel: 6,
            },
          },
        ],
        combatAbilities: [
          {
            abilityHrid: specialAbilityHrid,
            level: 2,
          },
          {
            abilityHrid,
            level: 5,
          },
        ],
        actionTypeFoodSlotsMap: {
          '/action_types/combat': [foodItemHrid, '', ''],
        },
        actionTypeDrinkSlotsMap: {
          '/action_types/combat': [drinkItemHrid, '', ''],
        },
        consumableCombatTriggersMap: {
          [foodItemHrid]: itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers,
          [drinkItemHrid]: itemDetailMap[drinkItemHrid].consumableDetail.defaultCombatTriggers,
        },
        abilityCombatTriggersMap: {
          [abilityHrid]: abilityDetailMap[abilityHrid].defaultCombatTriggers,
        },
        characterHouseRoomMap: {
          'room-1': {
            houseRoomHrid,
            level: 6,
          },
        },
        characterAchievements: {
          'achievement-1': {
            achievementHrid: SECOND_ACHIEVEMENT_HRID,
            progress: 1,
            isCompleted: true,
          },
        },
      }),
      mainSiteCombat: {
        actionHrid: zoneActionHrid,
        difficultyTier: 0,
      },
    };

    const result = simulator.importSoloConfig(JSON.stringify(payload), '4');

    expect(result.detectedFormat).toBe('main-site-current-character');
    expect(simulator.players[3].name).toBe('Current Hero');
    expect(simulator.players[3].levels.stamina).toBe(18);
    expect(simulator.players[3].levels.magic).toBe(78);
    expect(simulator.players[3].skillExperience.stamina).toBe(1800);
    expect(simulator.players[3].equipment.head.itemHrid).toBe(headItemHrid);
    expect(simulator.players[3].equipment.weapon.itemHrid).toBe(weaponItemHrid);
    expect(simulator.players[3].food[0]).toBe(foodItemHrid);
    expect(simulator.players[3].drinks[0]).toBe(drinkItemHrid);
    expect(simulator.players[3].abilities[0].abilityHrid).toBe(specialAbilityHrid);
    expect(simulator.players[3].abilities[0].level).toBe(2);
    expect(simulator.players[3].abilities[1].abilityHrid).toBe(abilityHrid);
    expect(simulator.players[3].abilities[1].level).toBe(5);
    expect(simulator.players[3].triggerMap[foodItemHrid]).toEqual(
      itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers,
    );
    expect(simulator.players[3].triggerMap[drinkItemHrid]).toEqual(
      itemDetailMap[drinkItemHrid].consumableDetail.defaultCombatTriggers,
    );
    expect(simulator.players[3].triggerMap[abilityHrid]).toEqual(abilityDetailMap[abilityHrid].defaultCombatTriggers);
    expect(simulator.players[3].houseRooms[houseRoomHrid]).toBe(6);
    expect(simulator.players[3].achievements[SECOND_ACHIEVEMENT_HRID]).toBe(true);
    expect(simulator.queue.importedProfileByPlayer['4']).toBe(true);
    expect(simulator.queue.importedBaselineByPlayer['4'].skillExperience.stamina).toBe(1800);
    expect(simulator.simulationSettings.useDungeon).toBe(false);
    expect(simulator.simulationSettings.zoneHrid).toBe(zoneActionHrid);
    expect(simulator.simulationSettings.difficultyTier).toBe(0);
    expect(simulator.simulationSettings.simulationTimeHours).toBe(36);
  });

  it('clears specific player slots and resets their imported queue state', () => {
    const simulator = useSimulatorStore();
    const headItemHrid = findFirstEquipmentItemByType('/equipment_types/head');

    expect(headItemHrid).toBeTruthy();

    simulator.players[0].name = 'Keep Me';
    simulator.players[0].selected = true;
    simulator.players[0].levels.stamina = 33;

    simulator.players[1].name = 'Clear Me';
    simulator.players[1].selected = true;
    simulator.players[1].levels.stamina = 88;
    simulator.players[1].equipment.head.itemHrid = headItemHrid;
    simulator.players[1].achievements[ACHIEVEMENT_HRID] = true;
    simulator.queue.byPlayer['2'].items = [{ slot: 'head' }];
    simulator.queue.byPlayer['2'].results = [{ score: 1 }];
    simulator.queue.byPlayer['2'].rawRuns = [{ score: 1 }];
    simulator.queue.byPlayer['2'].ranking = [{ playerId: '2' }];
    simulator.queue.byPlayer['2'].isRunning = true;
    simulator.queue.byPlayer['2'].error = 'stale queue';
    simulator.queue.byPlayer['2'].progress = 0.5;
    simulator.setImportedProfileState('2', true);
    simulator.setImportedBaselineSnapshot('2', JSON.parse(JSON.stringify(simulator.players[1])));

    simulator.players[2].name = 'Keep Party Mate';
    simulator.players[2].selected = true;
    simulator.players[2].levels.magic = 77;
    simulator.players[2].equipment.head.itemHrid = headItemHrid;
    simulator.players[2].achievements[SECOND_ACHIEVEMENT_HRID] = true;

    simulator.players[3].name = 'Clear Me Too';
    simulator.players[3].selected = true;
    simulator.players[3].levels.magic = 66;
    simulator.players[3].equipment.head.itemHrid = headItemHrid;
    simulator.players[3].achievements[SECOND_ACHIEVEMENT_HRID] = true;
    simulator.queue.byPlayer['4'].items = [{ slot: 'weapon' }];
    simulator.queue.byPlayer['4'].results = [{ score: 2 }];
    simulator.queue.byPlayer['4'].rawRuns = [{ score: 2 }];
    simulator.queue.byPlayer['4'].ranking = [{ playerId: '4' }];
    simulator.queue.byPlayer['4'].isRunning = true;
    simulator.queue.byPlayer['4'].error = 'stale queue';
    simulator.queue.byPlayer['4'].progress = 0.75;
    simulator.setImportedProfileState('4', true);
    simulator.setImportedBaselineSnapshot('4', JSON.parse(JSON.stringify(simulator.players[3])));

    const didClear = simulator.clearPlayerSlots(['2', '4']);

    expect(didClear).toBe(true);
    expect(simulator.players[0].name).toBe('Keep Me');
    expect(simulator.players[2].name).toBe('Keep Party Mate');
    expect(simulator.players[2].levels.magic).toBe(77);
    expect(simulator.players[2].equipment.head.itemHrid).toBe(headItemHrid);
    expect(simulator.players[2].achievements[SECOND_ACHIEVEMENT_HRID]).toBe(true);

    for (const playerId of ['2', '4']) {
      const player = simulator.players.find((entry) => entry.id === playerId);
      expect(player).toBeTruthy();
      expect(player.name).toBe(`Player ${playerId}`);
      expect(player.selected).toBe(false);
      expect(player.levels.stamina).toBe(1);
      expect(player.levels.magic).toBe(1);
      expect(player.equipment.head.itemHrid).toBe('');
      expect(player.achievements).toEqual({});
      expect(simulator.queue.importedProfileByPlayer[playerId]).toBe(false);
      expect(simulator.queue.importedBaselineByPlayer[playerId]).toBeNull();
      expect(simulator.queue.byPlayer[playerId].items).toEqual([]);
      expect(simulator.queue.byPlayer[playerId].results).toEqual([]);
      expect(simulator.queue.byPlayer[playerId].rawRuns).toEqual([]);
      expect(simulator.queue.byPlayer[playerId].ranking).toEqual([]);
      expect(simulator.queue.byPlayer[playerId].isRunning).toBe(false);
      expect(simulator.queue.byPlayer[playerId].error).toBe('');
      expect(simulator.queue.byPlayer[playerId].progress).toBe(0);
    }
  });

  it('clears other players before a post-party solo main-site import', () => {
    const simulator = useSimulatorStore();
    const headItemHrid = findFirstEquipmentItemByType('/equipment_types/head');
    const zoneActionHrid = findFirstCombatAction(false);

    expect(headItemHrid).toBeTruthy();
    expect(zoneActionHrid).toBeTruthy();

    simulator.players[0].selected = true;

    simulator.players[1].name = 'Party Mate';
    simulator.players[1].selected = true;
    simulator.players[1].levels.stamina = 88;
    simulator.players[1].equipment.head.itemHrid = headItemHrid;
    simulator.players[1].achievements[ACHIEVEMENT_HRID] = true;
    simulator.queue.byPlayer['2'].items = [{ slot: 'head' }];
    simulator.queue.byPlayer['2'].results = [{ score: 1 }];
    simulator.queue.byPlayer['2'].rawRuns = [{ score: 1 }];
    simulator.queue.byPlayer['2'].ranking = [{ playerId: '2' }];
    simulator.queue.byPlayer['2'].isRunning = true;
    simulator.queue.byPlayer['2'].error = 'stale queue';
    simulator.queue.byPlayer['2'].progress = 0.5;
    simulator.setImportedProfileState('2', true);
    simulator.setImportedBaselineSnapshot('2', JSON.parse(JSON.stringify(simulator.players[1])));

    simulator.players[2].name = 'Party Mate Two';
    simulator.players[2].selected = true;
    simulator.players[2].levels.magic = 77;
    simulator.players[2].equipment.head.itemHrid = headItemHrid;
    simulator.players[2].achievements[SECOND_ACHIEVEMENT_HRID] = true;
    simulator.queue.byPlayer['3'].items = [{ slot: 'weapon' }];
    simulator.queue.byPlayer['3'].results = [{ score: 2 }];
    simulator.queue.byPlayer['3'].rawRuns = [{ score: 2 }];
    simulator.queue.byPlayer['3'].ranking = [{ playerId: '3' }];
    simulator.queue.byPlayer['3'].isRunning = true;
    simulator.queue.byPlayer['3'].error = 'stale queue';
    simulator.queue.byPlayer['3'].progress = 0.75;
    simulator.setImportedProfileState('3', true);
    simulator.setImportedBaselineSnapshot('3', JSON.parse(JSON.stringify(simulator.players[2])));

    const payload = {
      ...createMainSiteCurrentCharacterFixture({
        characterName: 'Solo Hero',
      }),
      mainSiteCombat: {
        actionHrid: zoneActionHrid,
        difficultyTier: 0,
      },
    };

    simulator.clearOtherPlayersForSoloImport('1');
    const result = simulator.importSoloConfig(JSON.stringify(payload), '1');

    expect(result.detectedFormat).toBe('main-site-current-character');
    expect(simulator.players[0].name).toBe('Solo Hero');
    expect(simulator.players[0].selected).toBe(true);
    expect(simulator.queue.importedProfileByPlayer['1']).toBe(true);

    for (const playerId of ['2', '3', '4', '5']) {
      const player = simulator.players.find((entry) => entry.id === playerId);
      expect(player).toBeTruthy();
      expect(player.name).toBe(`Player ${playerId}`);
      expect(player.selected).toBe(false);
      expect(player.levels.stamina).toBe(1);
      expect(player.levels.magic).toBe(1);
      expect(player.equipment.head.itemHrid).toBe('');
      expect(player.achievements).toEqual({});
      expect(simulator.queue.importedProfileByPlayer[playerId]).toBe(false);
      expect(simulator.queue.importedBaselineByPlayer[playerId]).toBeNull();
      expect(simulator.queue.byPlayer[playerId].items).toEqual([]);
      expect(simulator.queue.byPlayer[playerId].results).toEqual([]);
      expect(simulator.queue.byPlayer[playerId].rawRuns).toEqual([]);
      expect(simulator.queue.byPlayer[playerId].ranking).toEqual([]);
      expect(simulator.queue.byPlayer[playerId].isRunning).toBe(false);
      expect(simulator.queue.byPlayer[playerId].error).toBe('');
      expect(simulator.queue.byPlayer[playerId].progress).toBe(0);
    }
  });

  it('returns sorted market enhancement levels for an item', () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    expect(equipmentItemHrid).toBeTruthy();

    simulator.pricing.enhancementLevelsByItem = {
      ...simulator.pricing.enhancementLevelsByItem,
      [equipmentItemHrid]: [5, 2, 3, 2, 1],
    };
    simulator.pricing.enhancementQuotesByItem = {
      ...simulator.pricing.enhancementQuotesByItem,
      [equipmentItemHrid]: {
        1: { ask: 100, bid: 90 },
        2: { ask: -1, bid: 180 },
        3: { ask: 300, bid: 270 },
        5: { ask: 500, bid: 450 },
      },
    };

    const levels = simulator.getMarketEnhancementLevelsForItem(equipmentItemHrid);
    expect(levels).toEqual([1, 3, 5]);
  });

  it('uses exact asks for targets and exact bid-ask-zero fallback for baseline sales', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    expect(equipmentItemHrid).toBeTruthy();

    simulator.activePlayer.equipment.weapon.itemHrid = equipmentItemHrid;
    simulator.activePlayer.equipment.weapon.enhancementLevel = 1;
    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.equipment.weapon.enhancementLevel = 2;
    simulator.pricing.enhancementQuotesByItem[equipmentItemHrid] = {
      1: { ask: 500, bid: 400 },
      2: { ask: 1000, bid: 900 },
      3: { ask: 25, bid: 20 },
    };

    let draft = simulator.resolveActivePlayerEquipmentUpgradeCostDraft('weapon');
    expect(draft).toMatchObject({
      cost: 620,
      targetAsk: 1000,
      baselineSaleValue: 380,
      baselineSaleSource: 'bid',
      baselineSaleZero: false,
    });

    simulator.pricing.enhancementQuotesByItem[equipmentItemHrid]['1'] = { ask: 500, bid: -1 };
    draft = simulator.resolveActivePlayerEquipmentUpgradeCostDraft('weapon');
    expect(draft).toMatchObject({ cost: 525, baselineSaleValue: 475, baselineSaleSource: 'ask' });

    simulator.pricing.enhancementQuotesByItem[equipmentItemHrid]['1'] = { ask: -1, bid: -1 };
    draft = simulator.resolveActivePlayerEquipmentUpgradeCostDraft('weapon');
    expect(draft).toMatchObject({
      cost: 1000,
      baselineSaleValue: 0,
      baselineSaleSource: 'zero',
      baselineSaleZero: true,
    });
    const added = simulator.addActivePlayerToQueue();
    expect(added).toHaveLength(1);
    expect(added[0].costWarnings).toEqual([
      expect.objectContaining({ code: 'baseline_sale_zero', slotKey: 'weapon', enhancementLevel: 1 }),
    ]);
  });

  it('applies the baseline sale side setting to the home equipment upgrade cost draft', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    expect(equipmentItemHrid).toBeTruthy();

    simulator.activePlayer.equipment.weapon.itemHrid = equipmentItemHrid;
    simulator.activePlayer.equipment.weapon.enhancementLevel = 1;
    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.equipment.weapon.enhancementLevel = 2;
    simulator.pricing.enhancementQuotesByItem[equipmentItemHrid] = {
      1: { ask: 500, bid: 400 },
      2: { ask: 1000, bid: 900 },
    };
    simulator.updateActiveQueueSettings({ baselineSaleSide: 'ask' });

    // ask（左1 最低卖单，重置成本口径）抵扣：500 × (1 - 5% 市场税) = 475。
    // 回归保护：saleSide 若被误传到 inspectEquipmentTransitionCost 的第 5 参
    // （confirmedEquipmentPrices），会被静默丢弃并回退默认 bid（抵扣 380 / 成本 620）。
    let draft = simulator.resolveActivePlayerEquipmentUpgradeCostDraft('weapon');
    expect(draft).toMatchObject({
      cost: 525,
      baselineSaleValue: 475,
      baselineSaleSource: 'ask',
      baselineSaleZero: false,
    });

    // ask 口径刻意不回退 bid：ask 缺价时抵扣按 0 处理并标记 baselineSaleZero。
    simulator.pricing.enhancementQuotesByItem[equipmentItemHrid]['1'] = { ask: -1, bid: 400 };
    draft = simulator.resolveActivePlayerEquipmentUpgradeCostDraft('weapon');
    expect(draft).toMatchObject({
      cost: 1000,
      baselineSaleValue: 0,
      baselineSaleSource: 'zero',
      baselineSaleZero: true,
    });
  });

  it('rejects a missing exact target ask without a manual-cost bypass', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    expect(equipmentItemHrid).toBeTruthy();

    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.equipment.weapon.itemHrid = equipmentItemHrid;
    simulator.activePlayer.equipment.weapon.enhancementLevel = 2;
    simulator.pricing.enhancementQuotesByItem[equipmentItemHrid] = {
      2: { ask: -1, bid: 1 },
      3: { ask: 2, bid: 1 },
    };

    const draft = simulator.resolveActivePlayerEquipmentUpgradeCostDraft('weapon');
    expect(draft).toMatchObject({ cost: null, targetAskAvailable: false });
    const enqueueFailure = (() => {
      try {
        simulator.addActivePlayerToQueue();
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(enqueueFailure).not.toBeNull();
    expect(enqueueFailure).toMatchObject({
      code: 'missing_enhancement_ask',
      queued: false,
      message: 'common:queue.missingEnhancementAsk',
    });
    expect(simulator.activeQueueState.items).toEqual([]);
    expect(simulator.setActivePlayerEquipmentUpgradeCost).toBeUndefined();
  });

  it('prepares and atomically confirms an hourly average for a missing exact ask', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    expect(equipmentItemHrid).toBeTruthy();

    await simulator.setQueueBaselineForActivePlayer();
    setQueueBaselineMetrics(simulator, { dailyNoRngProfit: 2400 });
    simulator.activePlayer.equipment.weapon.itemHrid = equipmentItemHrid;
    simulator.activePlayer.equipment.weapon.enhancementLevel = 2;
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        timestamp: 1_786_238_142,
        marketData: {
          [equipmentItemHrid]: {
            2: { a: -1, b: 10, p: 500, v: 3 },
          },
        },
      }),
    }));

    const draftBefore = JSON.parse(JSON.stringify(simulator.activePlayer));
    const preparation = await simulator.prepareActivePlayerQueueAddition();
    expect(preparation).toMatchObject({
      requiresConfirmation: true,
      refreshFailed: false,
    });
    expect(preparation.rows).toHaveLength(1);
    expect(preparation.rows[0]).toMatchObject({
      itemHrid: equipmentItemHrid,
      enhancementLevel: 2,
      reference: {
        price: 500,
        volume: 3,
        source: 'official_hourly_average',
        marketTimestamp: 1_786_238_142,
      },
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(simulator.activeQueueState.items).toEqual([]);
    expect(simulator.activePlayer).toEqual(draftBefore);

    const added = simulator.addActivePlayerToQueue({
      priceSelections: [
        {
          itemHrid: equipmentItemHrid,
          enhancementLevel: 2,
          method: 'left1',
          price: 500,
          source: 'official_hourly_average',
          volume: 3,
          marketTimestamp: 1_786_238_142,
        },
      ],
    });
    expect(added).toHaveLength(1);
    expect(added[0].priceSelections).toEqual([
      expect.objectContaining({
        itemHrid: equipmentItemHrid,
        enhancementLevel: 2,
        price: 500,
        volume: 3,
      }),
    ]);
    expect(added[0].costWarnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'confirmed_hourly_average', price: 500, volume: 3 })]),
    );
  });

  it('merges duplicate item-level confirmations across slots and variants', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 2 };
    simulator.activePlayer.equipment.off_hand = { itemHrid: equipmentItemHrid, enhancementLevel: 2 };
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        timestamp: 1_786_238_142,
        marketData: {
          [equipmentItemHrid]: {
            2: { a: -1, b: 10, p: 500, v: 3 },
          },
        },
      }),
    }));

    const preparation = await simulator.prepareActivePlayerQueueAddition();

    expect(preparation.rows).toHaveLength(1);
    expect(preparation.rows[0]).toMatchObject({
      itemHrid: equipmentItemHrid,
      enhancementLevel: 2,
      slotKeys: expect.arrayContaining(['weapon', 'off_hand']),
    });
    expect(simulator.activeQueueState.items).toEqual([]);
  });

  it('trims priceSelections to the changed equipment of each queue variant', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    expect(equipmentItemHrid).toBeTruthy();
    const secondEquipmentItemHrid = Object.values(itemDetailMap).find(
      (entry) =>
        entry?.categoryHrid === '/item_categories/equipment' &&
        String(entry?.equipmentDetail?.type || '').startsWith('/equipment_types/') &&
        String(entry?.hrid || '') !== String(equipmentItemHrid),
    )?.hrid;
    expect(secondEquipmentItemHrid).toBeTruthy();

    await simulator.setQueueBaselineForActivePlayer();
    setExactEquipmentAsk(simulator, equipmentItemHrid, 2, 1000);
    setExactEquipmentAsk(simulator, secondEquipmentItemHrid, 2, 2000);
    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 2 };
    simulator.activePlayer.equipment.off_hand = { itemHrid: secondEquipmentItemHrid, enhancementLevel: 2 };

    const addedItems = simulator.addActivePlayerToQueue({
      priceSelections: [
        {
          itemHrid: equipmentItemHrid,
          enhancementLevel: 2,
          method: 'left1',
          price: 1000,
          source: 'ask',
        },
        {
          itemHrid: secondEquipmentItemHrid,
          enhancementLevel: 2,
          method: 'left1',
          price: 2000,
          source: 'ask',
        },
      ],
    });

    expect(addedItems).toHaveLength(2);
    const weaponVariant = addedItems.find((item) => item.snapshot.equipment.weapon.itemHrid === equipmentItemHrid);
    const offHandVariant = addedItems.find(
      (item) => item.snapshot.equipment.off_hand.itemHrid === secondEquipmentItemHrid,
    );
    expect(weaponVariant).toBeTruthy();
    expect(offHandVariant).toBeTruthy();
    expect(weaponVariant.priceSelections).toEqual([
      expect.objectContaining({ itemHrid: equipmentItemHrid, enhancementLevel: 2, price: 1000 }),
    ]);
    expect(offHandVariant.priceSelections).toEqual([
      expect.objectContaining({ itemHrid: secondEquipmentItemHrid, enhancementLevel: 2, price: 2000 }),
    ]);
  });

  it('skips historical lookup when an exact official Ask is available', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 2 };
    setExactEquipmentAsk(simulator, equipmentItemHrid, 2, 750);
    global.fetch = vi.fn();

    const preparation = await simulator.prepareActivePlayerQueueAddition();
    expect(preparation.requiresConfirmation).toBe(true);
    expect(preparation.rows).toHaveLength(1);
    expect(preparation.rows[0]).toMatchObject({
      itemHrid: equipmentItemHrid,
      enhancementLevel: 2,
      hasExactAsk: true,
      reference: { price: 750, source: 'ask' },
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetches historical asks for mirror missing input tiers even when the target has an exact Ask', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    const shardPathLevel2 = 'items/queue-mirror-exact-ask-level2.json';
    const shardPathLevel3 = 'items/queue-mirror-exact-ask-level3.json';
    const shardPathLevel4 = 'items/queue-mirror-exact-ask-level4.json';
    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 4 };
    setExactEquipmentAsk(simulator, equipmentItemHrid, 1, -1);
    setExactEquipmentAsk(simulator, equipmentItemHrid, 2, -1);
    setExactEquipmentAsk(simulator, equipmentItemHrid, 3, -1);
    setExactEquipmentAsk(simulator, equipmentItemHrid, 4, 1000);
    // 镜子价已知（priceTable level 0）：目标级精确 Ask 存在时，+2/+3 输入件仍缺同步价，
    // 只有历史 Ask 才能自动解锁合成路径（旧逻辑仅扫描缺价行，这里不会发起任何历史查询）。
    simulator.pricing.priceTable = {
      ...(simulator.pricing.priceTable || {}),
      [PHILOSOPHERS_MIRROR_ITEM_HRID]: { ask: 50, bid: -1 },
    };
    global.fetch = vi.fn(async (rawUrl) => {
      const url = String(rawUrl);
      if (url.endsWith('/data/manifest.json')) {
        return {
          ok: true,
          json: async () => ({
            items: {
              [equipmentItemHrid]: {
                variants: {
                  2: { path: shardPathLevel2 },
                  3: { path: shardPathLevel3 },
                  4: { path: shardPathLevel4 },
                },
              },
            },
          }),
        };
      }
      if (url.endsWith(`/data/${shardPathLevel2}`) || url.endsWith(`/data/${shardPathLevel3}`)) {
        const isLevel2 = url.endsWith(`/data/${shardPathLevel2}`);
        return {
          ok: true,
          json: async () => ({
            itemHrid: equipmentItemHrid,
            variant: isLevel2 ? 2 : 3,
            rows: [{ time: 1_786_300_000, a: 500, v: 2 }],
          }),
        };
      }
      // 目标级（+4）已有精确 Ask，不应发起任何历史查询；误发则在此显式失败。
      throw new Error(`Unexpected market history request: ${url}`);
    });

    const preparation = await simulator.prepareActivePlayerQueueAddition();

    expect(preparation.rows).toHaveLength(1);
    expect(preparation.rows[0]).toMatchObject({
      itemHrid: equipmentItemHrid,
      enhancementLevel: 4,
      hasExactAsk: true,
      reference: { price: 1000, source: 'ask' },
      mirrorPlan: {
        method: 'mirror',
        cost: 1050,
        missing: [],
        mirrorPrice: 50,
        mirrorCount: 1,
      },
    });
    // 仅为缺价的输入件等级（+2/+3）拉取历史 Ask，且每个等级各一次；目标级 +4 不允许查询。
    const shardCalls = global.fetch.mock.calls.filter(([url]) =>
      [shardPathLevel2, shardPathLevel3, shardPathLevel4].some((path) => String(url).endsWith(`/data/${path}`)),
    );
    expect(shardCalls).toHaveLength(2);
    expect(shardCalls.filter(([url]) => String(url).endsWith(`/data/${shardPathLevel4}`))).toHaveLength(0);
    expect(preparation.historicalQuotes).toBeInstanceOf(Map);
    expect(preparation.historicalQuotes.size).toBe(2);
  });

  it('does not re-request a failed historical Ask key when the mirror fallback asks for the target tier again', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    const shardPath = 'items/queue-dup-attempt-level2.json';
    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 2 };
    // 目标级同步链完全缺失（无精确 Ask、无小时均价）且不配置镜子价：
    // 第一轮按缺价行目标级查询历史 Ask；第二轮镜子方案兜底（missing 为空且 cost 不可算）
    // 会把目标级本身列入 missing，同一 key 出现在两轮。分片请求失败（null）不写历史缓存，
    // 第二轮不应再次发起网络请求——修复前该 shard 会被请求两次。
    setExactEquipmentAsk(simulator, equipmentItemHrid, 2, -1);
    simulator.pricing.marketTimestamp = Math.floor(Date.now() / 1000);
    global.fetch = vi.fn(async (rawUrl) => {
      const url = String(rawUrl);
      if (url.endsWith('/data/manifest.json')) {
        return {
          ok: true,
          json: async () => ({
            items: {
              [equipmentItemHrid]: { variants: { 2: { path: shardPath } } },
            },
          }),
        };
      }
      if (url.endsWith(`/data/${shardPath}`)) {
        // 历史分片不可用：getLatestAsk 返回 null，失败不缓存。
        return { ok: false, status: 404, json: async () => ({}) };
      }
      throw new Error(`Unexpected market history request: ${url}`);
    });

    const preparation = await simulator.prepareActivePlayerQueueAddition();

    expect(preparation.requiresConfirmation).toBe(true);
    expect(preparation.historicalQuotes.size).toBe(0);
    const shardCalls = global.fetch.mock.calls.filter(([url]) => String(url).endsWith(`/data/${shardPath}`));
    expect(shardCalls).toHaveLength(1);
  });

  it('uses an hourly official snapshot without refreshing a missing exact ask', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    const marketTimestamp = Math.floor((Date.now() - 45 * 60_000) / 1000);
    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 2 };
    simulator.pricing.marketTimestamp = marketTimestamp;
    simulator.pricing.enhancementQuotesByItem[equipmentItemHrid] = {
      2: { ask: -1, bid: 10, averagePrice: 540, volume: 2 },
    };
    global.fetch = vi.fn();

    const preparation = await simulator.prepareActivePlayerQueueAddition();
    expect(preparation).toMatchObject({
      requiresConfirmation: true,
      refreshFailed: false,
    });
    expect(preparation.rows[0]).toMatchObject({
      itemHrid: equipmentItemHrid,
      enhancementLevel: 2,
      reference: {
        price: 540,
        volume: 2,
        source: 'official_hourly_average',
        marketTimestamp,
      },
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refreshes a stale official snapshot before deciding the fallback price', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    const currentMarketTimestamp = Math.floor(Date.now() / 1000);
    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 2 };
    simulator.pricing.marketTimestamp = Math.floor((Date.now() - 2 * 60 * 60_000) / 1000);
    simulator.pricing.lastFetchedAt = Date.now() - 2 * 60_000;
    simulator.pricing.enhancementQuotesByItem[equipmentItemHrid] = {
      2: { ask: -1, bid: 10, averagePrice: 400, volume: 1 },
    };
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        timestamp: currentMarketTimestamp,
        marketData: {
          [equipmentItemHrid]: {
            2: { a: 750, b: 700, p: 725, v: 2 },
          },
        },
      }),
    }));

    const preparation = await simulator.prepareActivePlayerQueueAddition();
    expect(preparation.requiresConfirmation).toBe(true);
    expect(preparation.refreshFailed).toBe(false);
    expect(preparation.rows).toHaveLength(1);
    expect(preparation.rows[0]).toMatchObject({
      itemHrid: equipmentItemHrid,
      enhancementLevel: 2,
      hasExactAsk: true,
      reference: { price: 750, source: 'ask' },
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not immediately refetch a stale upstream snapshot after a recent successful request', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 2 };
    simulator.pricing.marketTimestamp = Math.floor((Date.now() - 2 * 60 * 60_000) / 1000);
    simulator.pricing.lastFetchedAt = Date.now();
    simulator.pricing.enhancementQuotesByItem[equipmentItemHrid] = {
      2: { ask: -1, bid: 10, averagePrice: 500, volume: 3 },
    };
    global.fetch = vi.fn();

    const preparation = await simulator.prepareActivePlayerQueueAddition();
    expect(preparation).toMatchObject({
      requiresConfirmation: true,
      refreshFailed: false,
    });
    expect(preparation.rows[0]).toMatchObject({
      itemHrid: equipmentItemHrid,
      enhancementLevel: 2,
      reference: {
        price: 500,
        volume: 3,
        source: 'official_hourly_average',
      },
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('waits for an in-flight official refresh before falling back to history', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 2 };
    let resolveOfficialResponse;
    const officialResponse = new Promise((resolve) => {
      resolveOfficialResponse = resolve;
    });
    global.fetch = vi.fn(async (rawUrl) => {
      if (String(rawUrl).includes('mwi-market-history')) {
        throw new Error('Historical lookup should not run when the official average is available.');
      }
      return officialResponse;
    });

    const initialRefresh = simulator.ensureMarketPricesLoaded(true);
    expect(simulator.pricing.isLoading).toBe(true);
    const preparationPromise = simulator.prepareActivePlayerQueueAddition();
    resolveOfficialResponse({
      ok: true,
      json: async () => ({
        timestamp: 1_786_400_000,
        marketData: {
          [equipmentItemHrid]: {
            2: { a: -1, b: 10, p: 625, v: 4 },
          },
        },
      }),
    });

    const [, preparation] = await Promise.all([initialRefresh, preparationPromise]);

    expect(preparation).toMatchObject({
      requiresConfirmation: true,
      refreshFailed: false,
    });
    expect(preparation.rows[0]).toMatchObject({
      itemHrid: equipmentItemHrid,
      enhancementLevel: 2,
      reference: {
        price: 625,
        volume: 4,
        source: 'official_hourly_average',
      },
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('uses history directly for a fresh snapshot without an exact Ask or hourly average', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    const shardPath = 'items/queue-history-test.json';
    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 2 };
    simulator.activePlayer.equipment.off_hand = { itemHrid: equipmentItemHrid, enhancementLevel: 2 };
    simulator.pricing.marketTimestamp = Math.floor(Date.now() / 1000);
    simulator.pricing.lastFetchedAt = Date.now();
    simulator.pricing.enhancementQuotesByItem[equipmentItemHrid] = {
      2: { ask: -1, bid: 10 },
    };
    global.fetch = vi.fn(async (rawUrl) => {
      const url = String(rawUrl);
      if (url.endsWith('/data/manifest.json')) {
        return {
          ok: true,
          json: async () => ({
            items: {
              [equipmentItemHrid]: {
                variants: { 2: { path: shardPath } },
              },
            },
          }),
        };
      }
      if (url.endsWith(`/data/${shardPath}`)) {
        return {
          ok: true,
          json: async () => ({
            itemHrid: equipmentItemHrid,
            variant: 2,
            rows: [
              { time: 1_786_200_000, a: 450, v: 2 },
              { time: 1_786_300_000, a: 500 },
            ],
          }),
        };
      }
      throw new Error(`Unexpected official market request: ${url}`);
    });

    const preparation = await simulator.prepareActivePlayerQueueAddition();

    expect(preparation.rows).toEqual([
      expect.objectContaining({
        itemHrid: equipmentItemHrid,
        enhancementLevel: 2,
        reference: expect.objectContaining({
          price: 500,
          volume: null,
          source: 'historical_ask',
          marketTimestamp: 1_786_300_000,
        }),
        slotKeys: expect.arrayContaining(['weapon', 'off_hand']),
      }),
    ]);
    expect(global.fetch.mock.calls.filter(([url]) => String(url).includes('mwi-market-history'))).toHaveLength(2);
    expect(global.fetch.mock.calls.filter(([url]) => String(url).includes('/game_data/marketplace.json'))).toHaveLength(
      0,
    );

    const added = simulator.addActivePlayerToQueue({
      priceSelections: [
        {
          itemHrid: equipmentItemHrid,
          enhancementLevel: 2,
          method: 'left1',
          price: 500,
          source: 'historical_ask',
          volume: null,
          marketTimestamp: 1_786_300_000,
        },
      ],
    });
    expect(added.length).toBeGreaterThan(0);
    for (const item of added) {
      expect(item.priceSelections).toEqual([
        expect.objectContaining({
          source: 'historical_ask',
          price: 500,
          volume: null,
        }),
      ]);
      expect(item.costWarnings).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'historical_ask', price: 500, volume: null })]),
      );
    }
  });

  it('does not repeat a failed official refresh during the retry cooldown', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    const shardPath = 'items/queue-refresh-cooldown-test.json';
    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 2 };
    global.fetch = vi.fn(async (rawUrl) => {
      const url = String(rawUrl);
      if (url.endsWith('/data/manifest.json')) {
        return {
          ok: true,
          json: async () => ({
            items: {
              [equipmentItemHrid]: {
                variants: { 2: { path: shardPath } },
              },
            },
          }),
        };
      }
      if (url.endsWith(`/data/${shardPath}`)) {
        return {
          ok: true,
          json: async () => ({
            itemHrid: equipmentItemHrid,
            variant: 2,
            rows: [{ time: 1_786_300_000, a: 500 }],
          }),
        };
      }
      return { ok: false, status: 503 };
    });

    const firstPreparation = await simulator.prepareActivePlayerQueueAddition();
    const secondPreparation = await simulator.prepareActivePlayerQueueAddition();

    expect(firstPreparation).toMatchObject({
      requiresConfirmation: true,
      refreshFailed: true,
    });
    expect(firstPreparation.rows[0]).toMatchObject({
      reference: { source: 'historical_ask', price: 500 },
    });
    expect(secondPreparation).toMatchObject({
      requiresConfirmation: true,
      refreshFailed: true,
    });
    expect(secondPreparation.rows[0]).toMatchObject({
      reference: { source: 'historical_ask', price: 500 },
    });
    expect(global.fetch.mock.calls.filter(([url]) => String(url).includes('/game_data/marketplace.json'))).toHaveLength(
      2,
    );
    expect(global.fetch.mock.calls.filter(([url]) => String(url).includes('mwi-market-history'))).toHaveLength(2);
  });

  it('returns a manual price confirmation when official and historical prices are unavailable', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 14 };
    const draftBefore = JSON.parse(JSON.stringify(simulator.activePlayer));
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        timestamp: 1_786_238_142,
        marketData: {
          [equipmentItemHrid]: {
            14: { a: -1, b: 5_600_000 },
          },
        },
      }),
    }));

    const preparation = await simulator.prepareActivePlayerQueueAddition();
    expect(preparation).toMatchObject({
      requiresConfirmation: true,
    });
    expect(preparation.rows[0]).toMatchObject({
      itemHrid: equipmentItemHrid,
      enhancementLevel: 14,
      reference: null,
    });
    expect(simulator.activeQueueState.items).toEqual([]);
    expect(simulator.activePlayer).toEqual(draftBefore);
  });

  it('adds to queue with a manually confirmed buy price and flags it as manual', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    await simulator.setQueueBaselineForActivePlayer();
    setQueueBaselineMetrics(simulator, { dailyNoRngProfit: 2400 });
    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 14 };
    simulator.pricing.enhancementQuotesByItem[equipmentItemHrid] = {
      14: { ask: -1, bid: 5_600_000 },
    };

    const items = simulator.addActivePlayerToQueue({
      confirmedEquipmentPrices: [
        {
          itemHrid: equipmentItemHrid,
          enhancementLevel: 14,
          price: 123,
          volume: null,
          source: 'manual',
          marketTimestamp: 0,
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].confirmedEquipmentPrices).toEqual([
      expect.objectContaining({ source: 'manual', price: 123, volume: null }),
    ]);
    expect(items[0].costWarnings).toEqual([
      expect.objectContaining({ code: 'manual_price', slotKey: 'weapon', price: 123 }),
    ]);

    simulator.activeQueueState.rawRuns = [
      createQueueRawRun(items[0], 1, { dailyNoRngProfit: 3000 }, simulator.activeQueueState.baseline.metrics),
    ];
    await simulator.refreshQueueResultsFromRawRuns({ allowReferenceLoad: false });
    const rankedRow = simulator.activeQueueState.ranking[0];
    expect(rankedRow.costInsights.equipmentBuyPrice).toBe(123);
    expect(rankedRow.costInsights.equipmentNetCost).toBe(123);
    expect(rankedRow.costInsights.manualPriceSlots).toEqual([
      expect.objectContaining({ slotKey: 'weapon', itemHrid: equipmentItemHrid, enhancementLevel: 14, price: 123 }),
    ]);
  });

  it('reconciles equipment net cost against sale value and buy price when abilities also raise the upgrade cost', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    const abilityBookInfo = findFirstAbilityBookInfo();
    expect(abilityBookInfo).toBeTruthy();

    global.jigsLevelExperienceTable = [0, 100, 700];
    global.jigsSpellBookXpByName = {};
    global.fetch = vi.fn(async () => ({ ok: false }));

    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 1 };
    await simulator.setQueueBaselineForActivePlayer();
    setQueueBaselineMetrics(simulator, { dailyNoRngProfit: 2400 });

    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 2 };
    simulator.pricing.enhancementQuotesByItem[equipmentItemHrid] = {
      1: { ask: 120, bid: 100 },
      2: { ask: -1, bid: 10 },
    };

    const items = simulator.addActivePlayerToQueue({
      confirmedEquipmentPrices: [
        {
          itemHrid: equipmentItemHrid,
          enhancementLevel: 2,
          price: 500,
          volume: null,
          source: 'historical_ask',
          marketTimestamp: 1_786_300_000,
        },
      ],
    });
    expect(items).toHaveLength(1);

    // 真实队列会把多变更差异拆分为单变更变体；将
    // 技能升级合并进已入队快照，使成本洞察能看到两处贡献。
    items[0].snapshot.abilities[0].abilityHrid = abilityBookInfo.abilityHrid;
    items[0].snapshot.abilities[0].level = 2;

    simulator.activeQueueState.rawRuns = [
      createQueueRawRun(items[0], 1, { dailyNoRngProfit: 3000 }, simulator.activeQueueState.baseline.metrics),
    ];

    await simulator.refreshQueueResultsFromRawRuns({ allowReferenceLoad: false });
    const insights = simulator.activeQueueState.ranking[0].costInsights;

    expect(insights.equipmentSaleValue).toBe(95);
    expect(insights.equipmentBuyPrice).toBe(500);
    expect(insights.equipmentNetCost).toBe(405);
    expect(insights.totalUpgradeCost).toBeGreaterThan(insights.equipmentNetCost);
  });

  it('keeps every cost insight column null when a multi-slot change contains one missing target ask', async () => {
    const simulator = useSimulatorStore();
    const weaponItemHrid = findFirstEquipmentItemByType('/equipment_types/main_hand');
    const bodyItemHrid = findFirstEquipmentItemByType('/equipment_types/body');
    expect(weaponItemHrid).toBeTruthy();
    expect(bodyItemHrid).toBeTruthy();
    expect(bodyItemHrid).not.toBe(weaponItemHrid);

    await simulator.setQueueBaselineForActivePlayer();
    setQueueBaselineMetrics(simulator, { dailyNoRngProfit: 2400 });

    // 武器槽位有有效的精确卖价，因此队列接受该变体。
    simulator.activePlayer.equipment.weapon = { itemHrid: weaponItemHrid, enhancementLevel: 2 };
    setExactEquipmentAsk(simulator, weaponItemHrid, 2, 123456);

    const items = simulator.addActivePlayerToQueue();
    expect(items).toHaveLength(1);

    // 真实队列会把多变更差异拆分为单变更变体；将第二个
    // 无任何定价数据的槽位变更折叠进已入队快照，使成本
    // 洞察能看到部分缺失的目标卖价。
    items[0].snapshot.equipment.body = { itemHrid: bodyItemHrid, enhancementLevel: 1 };

    simulator.activeQueueState.rawRuns = [
      createQueueRawRun(items[0], 1, { dailyNoRngProfit: 3000 }, simulator.activeQueueState.baseline.metrics),
    ];

    await simulator.refreshQueueResultsFromRawRuns({ allowReferenceLoad: false });
    const insights = simulator.activeQueueState.ranking[0].costInsights;

    // 缺失一个目标卖价时，整个升级成本也必须为 null，而不只是
    // 买卖价列，以保持结果表一致（全部显示 "-"）。
    expect(insights.totalUpgradeCost).toBeNull();
    expect(insights.equipmentSaleValue).toBeNull();
    expect(insights.equipmentBuyPrice).toBeNull();
    expect(insights.equipmentNetCost).toBeNull();
    expect(insights.purchaseDays).toBeNull();
  });

  it('rejects an invalid manual equipment price with a dedicated error', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 14 };
    simulator.pricing.enhancementQuotesByItem[equipmentItemHrid] = {
      14: { ask: -1, bid: 5_600_000 },
    };

    let enqueueFailure = null;
    try {
      simulator.addActivePlayerToQueue({
        confirmedEquipmentPrices: [
          {
            itemHrid: equipmentItemHrid,
            enhancementLevel: 14,
            price: 0,
            volume: null,
            source: 'manual',
            marketTimestamp: 0,
          },
        ],
      });
    } catch (error) {
      enqueueFailure = error;
    }
    expect(enqueueFailure).not.toBeNull();
    expect(enqueueFailure).toMatchObject({
      code: 'invalid_manual_price',
      message: 'common:queue.manualPriceInvalid',
      details: {
        itemHrid: equipmentItemHrid,
        enhancementLevel: 14,
      },
    });
    expect(simulator.activeQueueState.items).toEqual([]);
  });

  it('rejects an invalid mirror price selection with a dedicated error', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 14 };

    let enqueueFailure = null;
    try {
      simulator.addActivePlayerToQueue({
        priceSelections: [
          {
            itemHrid: equipmentItemHrid,
            enhancementLevel: 14,
            method: 'mirror',
            price: 0,
            mirrorPrice: 50,
            mirrorCount: 1,
            inputs: [],
          },
        ],
      });
    } catch (error) {
      enqueueFailure = error;
    }
    expect(enqueueFailure).not.toBeNull();
    expect(enqueueFailure).toMatchObject({
      code: 'invalid_manual_price',
      message: 'common:queue.priceSelectionInvalid',
      details: {
        itemHrid: equipmentItemHrid,
        enhancementLevel: 14,
      },
    });
    expect(simulator.activeQueueState.items).toEqual([]);
  });

  it('enqueues a baseline-substituted +2 mirror selection with no priced inputs', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 2 };

    // +2 目标顶替基准 +1 的镜子方案形态：inputs 为空但 mirrorCount > 0 且有顶替记录
    //（price = 现金合成成本 50 + 基准件出售价值快照 38）。修复前 findInvalidPriceSelection
    // 判其无效并抛 priceSelectionInvalid，入队必然失败且弹窗整体被清空（MAJ-02）。
    const items = simulator.addActivePlayerToQueue({
      priceSelections: [
        {
          itemHrid: equipmentItemHrid,
          enhancementLevel: 2,
          method: 'mirror',
          price: 88,
          mirrorPrice: 50,
          mirrorCount: 1,
          inputs: [],
          baselinePieceSaleValue: 38,
          usedBaselineLevels: [1],
        },
      ],
    });

    expect(items).toHaveLength(1);
    const storedSelection = items[0].priceSelections.find((selection) => selection.method === 'mirror');
    expect(storedSelection).toMatchObject({
      itemHrid: equipmentItemHrid,
      enhancementLevel: 2,
      price: 88,
      mirrorCount: 1,
      inputs: [],
      usedBaselineLevels: [1],
    });
    // 派生的确认价格快照同样保留镜子锁定价（供队列页合计与多轮成本计算使用）。
    expect(
      items[0].confirmedEquipmentPrices.some(
        (entry) => String(entry.source) === 'mirror' && Number(entry.price) === 88,
      ),
    ).toBe(true);
  });

  it('rejects an invalid left1 price selection with a dedicated error', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 14 };

    let enqueueFailure = null;
    try {
      simulator.addActivePlayerToQueue({
        priceSelections: [
          {
            itemHrid: equipmentItemHrid,
            enhancementLevel: 14,
            method: 'left1',
            price: 0,
            source: 'official_hourly_average',
            volume: 3,
            marketTimestamp: 1_786_238_142,
          },
        ],
      });
    } catch (error) {
      enqueueFailure = error;
    }
    expect(enqueueFailure).not.toBeNull();
    expect(enqueueFailure).toMatchObject({
      code: 'invalid_manual_price',
      message: 'common:queue.priceSelectionInvalid',
      details: {
        itemHrid: equipmentItemHrid,
        enhancementLevel: 14,
      },
    });
    expect(simulator.activeQueueState.items).toEqual([]);
  });

  it('rejects an invalid right1 price selection with a dedicated error', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 14 };

    let enqueueFailure = null;
    try {
      simulator.addActivePlayerToQueue({
        priceSelections: [
          {
            itemHrid: equipmentItemHrid,
            enhancementLevel: 14,
            method: 'right1',
            price: -1,
            source: 'bid',
          },
        ],
      });
    } catch (error) {
      enqueueFailure = error;
    }
    expect(enqueueFailure).not.toBeNull();
    expect(enqueueFailure).toMatchObject({
      code: 'invalid_manual_price',
      message: 'common:queue.priceSelectionInvalid',
      details: {
        itemHrid: equipmentItemHrid,
        enhancementLevel: 14,
      },
    });
    expect(simulator.activeQueueState.items).toEqual([]);
  });

  it('uses a confirmed hourly average for cost insights until an exact ask appears', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    await simulator.setQueueBaselineForActivePlayer();
    setQueueBaselineMetrics(simulator, { dailyNoRngProfit: 2400 });
    simulator.activePlayer.equipment.weapon.itemHrid = equipmentItemHrid;
    simulator.activePlayer.equipment.weapon.enhancementLevel = 2;
    simulator.pricing.enhancementQuotesByItem[equipmentItemHrid] = {
      2: { ask: -1, bid: 10, averagePrice: 500, volume: 3 },
    };
    const item = simulator.addActivePlayerToQueue({
      confirmedEquipmentPrices: [
        {
          itemHrid: equipmentItemHrid,
          enhancementLevel: 2,
          price: 500,
          volume: 3,
          marketTimestamp: 1_786_238_142,
        },
      ],
    })[0];
    simulator.activeQueueState.rawRuns = [
      createQueueRawRun(item, 1, { dailyNoRngProfit: 3000 }, simulator.activeQueueState.baseline.metrics),
    ];

    await simulator.refreshQueueResultsFromRawRuns({ allowReferenceLoad: false });
    expect(simulator.activeQueueState.ranking[0].costInsights.totalUpgradeCost).toBe(500);

    setExactEquipmentAsk(simulator, equipmentItemHrid, 2, 700);
    await simulator.refreshQueueResultsFromRawRuns({ allowReferenceLoad: false });
    expect(simulator.activeQueueState.ranking[0].costInsights.totalUpgradeCost).toBe(700);
  });

  it('uses historical Ask only for the target buy and lets a new official Ask override it', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 1 };
    await simulator.setQueueBaselineForActivePlayer();
    setQueueBaselineMetrics(simulator, { dailyNoRngProfit: 2400 });
    simulator.activePlayer.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 2 };
    simulator.pricing.enhancementQuotesByItem[equipmentItemHrid] = {
      1: { ask: 120, bid: 100 },
      2: { ask: -1, bid: 10 },
    };
    const item = simulator.addActivePlayerToQueue({
      confirmedEquipmentPrices: [
        {
          itemHrid: equipmentItemHrid,
          enhancementLevel: 2,
          price: 500,
          volume: null,
          source: 'historical_ask',
          marketTimestamp: 1_786_300_000,
        },
      ],
    })[0];
    simulator.activeQueueState.rawRuns = [
      createQueueRawRun(item, 1, { dailyNoRngProfit: 3000 }, simulator.activeQueueState.baseline.metrics),
    ];

    await simulator.refreshQueueResultsFromRawRuns({ allowReferenceLoad: false });
    expect(simulator.activeQueueState.ranking[0].costInsights.totalUpgradeCost).toBe(405);
    expect(simulator.activeQueueState.items[0].costWarnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'historical_ask', price: 500 })]),
    );

    setExactEquipmentAsk(simulator, equipmentItemHrid, 2, 700);
    await simulator.refreshQueueResultsFromRawRuns({ allowReferenceLoad: false });
    expect(simulator.activeQueueState.ranking[0].costInsights.totalUpgradeCost).toBe(605);
    expect(simulator.activeQueueState.items[0].costWarnings).toEqual([]);
    expect(simulator.activeQueueState.items[0].confirmedEquipmentPrices).toEqual([
      expect.objectContaining({ source: 'historical_ask', price: 500 }),
    ]);
  });

  it('blocks historical queue items that no longer have an exact target ask', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    expect(equipmentItemHrid).toBeTruthy();

    await simulator.setQueueBaselineForActivePlayer();
    const snapshot = JSON.parse(JSON.stringify(simulator.activeQueueState.baseline.snapshot));
    snapshot.equipment.weapon = { itemHrid: equipmentItemHrid, enhancementLevel: 7 };
    simulator.activeQueueState.items = [
      {
        id: 'legacy-missing-ask',
        name: 'Legacy',
        snapshot,
        changes: [],
        changeDetails: [],
      },
    ];
    simulator.pricing.enhancementQuotesByItem[equipmentItemHrid] = {
      7: { ask: -1, bid: 10 },
    };

    await expect(simulator.runActiveQueue()).rejects.toMatchObject({
      code: 'missing_enhancement_ask',
      queued: true,
      message: 'common:queue.missingEnhancementAskQueued',
    });
    expect(simulator.activeQueueState.error).toBe('common:queue.missingEnhancementAskQueued');
    expect(simulator.activeQueueState.isRunning).toBe(false);
  });

  it('removes one queue item with its samples and reranks the remainder', async () => {
    const simulator = useSimulatorStore();
    const equipmentItemHrid = findFirstEquipmentItem();
    expect(equipmentItemHrid).toBeTruthy();

    await simulator.setQueueBaselineForActivePlayer();
    setQueueBaselineMetrics(simulator);
    simulator.activePlayer.equipment.weapon.itemHrid = equipmentItemHrid;
    simulator.activePlayer.equipment.weapon.enhancementLevel = 1;
    setExactEquipmentAsk(simulator, equipmentItemHrid, 1, 100);
    const first = simulator.addActivePlayerToQueue()[0];
    simulator.activePlayer.equipment.weapon.itemHrid = equipmentItemHrid;
    simulator.activePlayer.equipment.weapon.enhancementLevel = 2;
    setExactEquipmentAsk(simulator, equipmentItemHrid, 2, 200);
    const second = simulator.addActivePlayerToQueue()[0];
    simulator.activeQueueState.rawRuns = [
      createQueueRawRun(first, 1, { dailyNoRngProfit: 3000 }, simulator.activeQueueState.baseline.metrics),
      createQueueRawRun(second, 1, { dailyNoRngProfit: 3600 }, simulator.activeQueueState.baseline.metrics),
    ];
    await simulator.refreshQueueResultsFromRawRuns({ allowReferenceLoad: false });

    expect(await simulator.removeQueueItem(first.id)).toBe(true);
    expect(simulator.activeQueueState.items.map((item) => item.id)).toEqual([second.id]);
    expect(simulator.activeQueueState.rawRuns.map((row) => row.id)).toEqual([second.id]);
    expect(simulator.activeQueueState.ranking.map((row) => row.id)).toEqual([second.id]);

    simulator.activeQueueState.isRunning = true;
    expect(await simulator.removeQueueItem(second.id)).toBe(false);
    expect(simulator.activeQueueState.items).toHaveLength(1);
    simulator.activeQueueState.isRunning = false;
    expect(await simulator.removeQueueItem(second.id)).toBe(true);
    expect(simulator.activeQueueState.items).toEqual([]);
    expect(simulator.activeQueueState.rawRuns).toEqual([]);
    expect(simulator.activeQueueState.results).toEqual([]);
    expect(simulator.activeQueueState.ranking).toEqual([]);
    expect(simulator.activeQueueState.progress).toBe(0);
    expect(simulator.activeQueueState.lastRunStatus).toBe('idle');
  });

  it('accumulates single house room upgrade cost from current to target level', () => {
    const simulator = useSimulatorStore();
    const room = findHouseRoomWithUpgradeLevels(2);
    expect(room).toBeTruthy();

    const preview = simulator.previewHouseRoomUpgradeCost({ [room.hrid]: 0 }, { [room.hrid]: 2 });
    const expectedCounts = aggregateHouseRoomUpgradeCounts(room.hrid, 0, 2);
    const expectedTotal = computePreviewTotalFromCounts(expectedCounts, simulator.pricing.priceTable);

    expect(preview.rooms).toEqual([
      {
        roomHrid: room.hrid,
        fromLevel: 0,
        toLevel: 2,
        subtotal: expectedTotal,
      },
    ]);
    expect(preview.materials).toHaveLength(Object.keys(expectedCounts).length);
    for (const [itemHrid, count] of Object.entries(expectedCounts)) {
      const materialRow = preview.materials.find((entry) => entry.itemHrid === itemHrid);
      expect(materialRow).toBeTruthy();
      expect(materialRow.count).toBe(count);
    }
    expect(preview.totals.totalCost).toBe(expectedTotal);
  });

  it('aggregates multi-room upgrade materials and keeps totals aligned', () => {
    const simulator = useSimulatorStore();
    const firstRoom = findHouseRoomWithUpgradeLevels(1);
    const secondRoom = findHouseRoomWithUpgradeLevels(2, firstRoom?.hrid);
    expect(firstRoom).toBeTruthy();
    expect(secondRoom).toBeTruthy();

    const preview = simulator.previewHouseRoomUpgradeCost(
      {
        [firstRoom.hrid]: 0,
        [secondRoom.hrid]: 1,
      },
      {
        [firstRoom.hrid]: 1,
        [secondRoom.hrid]: 2,
      },
    );

    const firstCounts = aggregateHouseRoomUpgradeCounts(firstRoom.hrid, 0, 1);
    const secondCounts = aggregateHouseRoomUpgradeCounts(secondRoom.hrid, 1, 2);
    const expectedCounts = mergeMaterialCountMaps(firstCounts, secondCounts);
    const expectedFirstSubtotal = computePreviewTotalFromCounts(firstCounts, simulator.pricing.priceTable);
    const expectedSecondSubtotal = computePreviewTotalFromCounts(secondCounts, simulator.pricing.priceTable);
    const expectedTotal = computePreviewTotalFromCounts(expectedCounts, simulator.pricing.priceTable);

    const roomRowsByHrid = Object.fromEntries(preview.rooms.map((entry) => [entry.roomHrid, entry]));

    expect(preview.rooms).toHaveLength(2);
    expect(roomRowsByHrid[firstRoom.hrid]).toEqual({
      roomHrid: firstRoom.hrid,
      fromLevel: 0,
      toLevel: 1,
      subtotal: expectedFirstSubtotal,
    });
    expect(roomRowsByHrid[secondRoom.hrid]).toEqual({
      roomHrid: secondRoom.hrid,
      fromLevel: 1,
      toLevel: 2,
      subtotal: expectedSecondSubtotal,
    });
    for (const [itemHrid, count] of Object.entries(expectedCounts)) {
      const materialRow = preview.materials.find((entry) => entry.itemHrid === itemHrid);
      expect(materialRow).toBeTruthy();
      expect(materialRow.count).toBe(count);
    }
    expect(preview.totals.totalCost).toBe(expectedTotal);
    expect(preview.rooms.reduce((sum, room) => sum + Number(room.subtotal || 0), 0)).toBe(expectedTotal);
  });

  it('returns zero house room upgrade cost when target level is not above baseline', () => {
    const simulator = useSimulatorStore();
    const room = findHouseRoomWithUpgradeLevels(1);
    expect(room).toBeTruthy();

    const preview = simulator.previewHouseRoomUpgradeCost({ [room.hrid]: 3 }, { [room.hrid]: 1 });

    expect(preview.rooms).toEqual([]);
    expect(preview.materials).toEqual([]);
    expect(preview.totals).toEqual({
      coinCost: 0,
      materialValue: 0,
      totalCost: 0,
    });
  });

  it('marks missing house room material prices and excludes them from total', () => {
    const simulator = useSimulatorStore();
    const room = findHouseRoomWithUpgradeLevels(1);
    expect(room).toBeTruthy();

    const firstLevelCosts = Array.isArray(room?.upgradeCostsMap?.['1']) ? room.upgradeCostsMap['1'] : [];
    const missingPriceMaterial = firstLevelCosts.find((entry) => String(entry?.itemHrid || '') !== '/items/coin');
    expect(missingPriceMaterial).toBeTruthy();

    simulator.pricing.priceTable = {
      ...simulator.pricing.priceTable,
      [missingPriceMaterial.itemHrid]: {
        ask: -1,
        bid: -1,
        vendor: 0,
      },
    };

    const preview = simulator.previewHouseRoomUpgradeCost({ [room.hrid]: 0 }, { [room.hrid]: 1 });
    const missingRow = preview.materials.find((entry) => entry.itemHrid === missingPriceMaterial.itemHrid);
    const expectedCounts = aggregateHouseRoomUpgradeCounts(room.hrid, 0, 1);
    const expectedTotal = computePreviewTotalFromCounts(expectedCounts, simulator.pricing.priceTable);

    expect(missingRow).toBeTruthy();
    expect(missingRow.priced).toBe(false);
    expect(missingRow.subtotal).toBe(0);
    expect(preview.totals.totalCost).toBe(expectedTotal);
  });

  it('stores only meaningful player snapshots when saving snapshot data', () => {
    const simulator = useSimulatorStore();

    simulator.players[0].levels.stamina = 99;
    simulator.players[0].skillExperience.stamina = 123456;
    const saveResult = simulator.savePlayerDataSnapshot();
    expect(saveResult.ok).toBe(true);

    const rowsWithSnapshot = simulator.playerDataSnapshotRows.filter((row) => row.hasSnapshot);
    expect(rowsWithSnapshot).toHaveLength(1);
    expect(rowsWithSnapshot[0].playerId).toBe('1');

    const storedSnapshotPayload = JSON.parse(simulator.playerDataSnapshot.playerDataMap['1']);
    expect(storedSnapshotPayload.version).toBe(2);
    expect(storedSnapshotPayload.player.skillExperience.stamina).toBe(123456);
  });

  it('restores imported baseline snapshot when loading player data snapshot', () => {
    const simulator = useSimulatorStore();
    simulator.players[0].levels.stamina = 99;
    simulator.players[0].skillExperience.stamina = 654321;

    const saveResult = simulator.savePlayerDataSnapshot();
    expect(saveResult.ok).toBe(true);

    simulator.players[0].levels.stamina = 1;
    simulator.players[0].skillExperience.stamina = null;
    simulator.queue.importedBaselineByPlayer['1'] = null;

    const loadResult = simulator.loadPlayerDataSnapshot();
    expect(loadResult.ok).toBe(true);
    expect(simulator.players[0].levels.stamina).toBe(99);
    expect(simulator.players[0].skillExperience.stamina).toBe(654321);
    expect(simulator.queue.importedBaselineByPlayer['1'].skillExperience.stamina).toBe(654321);
  });

  it('restores zone and difficulty from modern player data snapshot without forcing labyrinth mode', () => {
    const simulator = useSimulatorStore();
    const payload = {
      version: 1,
      savedAt: Date.now(),
      playerDataMap: {
        1: JSON.stringify({
          version: 2,
          player: {
            levels: {
              stamina: 2,
            },
          },
          simulationSettings: {
            mode: 'zone',
            runScope: 'single',
            useDungeon: false,
            zoneHrid: '/actions/combat/jungle_planet',
            dungeonHrid: '/actions/combat/chimerical_den',
            difficultyTier: 3,
            simulationTimeHours: 24,
            labyrinthHrid: '/monsters/cyclops',
            roomLevel: 100,
          },
        }),
      },
    };
    global.localStorage.setItem('mwi.player.data.snapshot.v1', JSON.stringify(payload));

    const loadResult = simulator.loadPlayerDataSnapshot();
    expect(loadResult.ok).toBe(true);
    expect(simulator.simulationSettings.mode).toBe('zone');
    expect(simulator.simulationSettings.useDungeon).toBe(false);
    expect(simulator.simulationSettings.zoneHrid).toBe('/actions/combat/jungle_planet');
    expect(simulator.simulationSettings.difficultyTier).toBe(3);
  });

  it('preserves achievements when restoring player snapshot without achievements field', () => {
    const simulator = useSimulatorStore();
    simulator.players[0].achievements = {
      [ACHIEVEMENT_HRID]: true,
    };

    const payload = {
      version: 1,
      savedAt: Date.now(),
      playerDataMap: {
        1: JSON.stringify({
          version: 2,
          player: {
            levels: {
              stamina: 2,
            },
          },
          simulationSettings: {
            mode: 'zone',
            runScope: 'single',
            useDungeon: false,
            zoneHrid: '/actions/combat/jungle_planet',
            difficultyTier: 1,
            simulationTimeHours: 24,
          },
        }),
      },
    };
    global.localStorage.setItem('mwi.player.data.snapshot.v1', JSON.stringify(payload));

    const loadResult = simulator.loadPlayerDataSnapshot();

    expect(loadResult.ok).toBe(true);
    expect(simulator.players[0].achievements).toEqual({
      [ACHIEVEMENT_HRID]: true,
    });
  });

  it('preserves achievements on modern solo import when achievements field is missing', () => {
    const simulator = useSimulatorStore();
    simulator.players[0].achievements = {
      [ACHIEVEMENT_HRID]: true,
    };

    simulator.importSoloConfig(
      JSON.stringify({
        version: 2,
        player: {
          levels: {
            stamina: 2,
          },
        },
      }),
      '1',
    );

    expect(simulator.players[0].achievements).toEqual({
      [ACHIEVEMENT_HRID]: true,
    });
  });

  it('supports manual legacy solo import payloads', () => {
    const simulator = useSimulatorStore();

    const result = simulator.importSoloConfig(
      JSON.stringify({
        player: {
          intelligenceLevel: 102,
          magicLevel: 125,
          staminaLevel: 103,
          defenseLevel: 112,
          meleeLevel: 66,
          attackLevel: 117,
          rangedLevel: 52,
          equipment: [
            {
              itemLocationHrid: '/item_locations/head',
              itemHrid: '/items/magicians_hat',
              enhancementLevel: 6,
            },
            {
              itemLocationHrid: '/item_locations/main_hand',
              itemHrid: '/items/blazing_trident',
              enhancementLevel: 10,
            },
          ],
        },
        food: {
          '/action_types/combat': [
            { itemHrid: '/items/star_fruit_gummy' },
            { itemHrid: '/items/dragon_fruit_yogurt' },
            { itemHrid: '/items/marsberry_cake' },
          ],
        },
        drinks: {
          '/action_types/combat': [
            { itemHrid: '/items/wisdom_coffee' },
            { itemHrid: '/items/super_magic_coffee' },
            { itemHrid: '/items/channeling_coffee' },
          ],
        },
        abilities: [
          { abilityHrid: '/abilities/mystic_aura', level: 26 },
          { abilityHrid: '/abilities/elemental_affinity', level: 60 },
          { abilityHrid: '/abilities/firestorm', level: 60 },
          { abilityHrid: '/abilities/flame_blast', level: 70 },
          { abilityHrid: '/abilities/fireball', level: 70 },
        ],
        triggerMap: {
          '/abilities/mystic_aura': [],
        },
        houseRooms: {
          '/house_rooms/archery_range': 1,
        },
      }),
      '1',
    );

    expect(result.detectedFormat).toBe('legacy-solo');
    expect(simulator.players[0].levels.attack).toBe(117);
    expect(simulator.players[0].equipment.weapon.itemHrid).toBe('/items/blazing_trident');
    expect(simulator.players[0].food[0]).toBe('/items/star_fruit_gummy');
    expect(simulator.players[0].abilities[4].abilityHrid).toBe('/abilities/fireball');
  });

  it('clears achievements only when import explicitly provides empty achievements', () => {
    const simulator = useSimulatorStore();
    simulator.players[0].achievements = {
      [ACHIEVEMENT_HRID]: true,
    };

    simulator.importSoloConfig(
      JSON.stringify({
        version: 2,
        player: {
          levels: {
            stamina: 2,
          },
          achievements: {},
        },
        simulationSettings: {
          mode: 'zone',
          runScope: 'single',
          useDungeon: false,
          zoneHrid: '/actions/combat/jungle_planet',
          difficultyTier: 1,
          simulationTimeHours: 24,
        },
      }),
      '1',
    );

    expect(simulator.players[0].achievements).toEqual({});
  });

  it('reads modern snapshot hrids for summary rows', () => {
    const simulator = useSimulatorStore();
    const payload = {
      version: 1,
      savedAt: Date.now(),
      playerDataMap: {
        1: JSON.stringify({
          version: 2,
          player: {
            levels: {
              stamina: 2,
            },
          },
          simulationSettings: {
            mode: 'zone',
            runScope: 'single',
            useDungeon: false,
            zoneHrid: '/actions/combat/jungle_planet',
            dungeonHrid: '/actions/combat/chimerical_den',
            labyrinthHrid: '/monsters/cyclops',
            difficultyTier: 1,
            simulationTimeHours: 24,
            roomLevel: 100,
          },
        }),
      },
    };
    global.localStorage.setItem('mwi.player.data.snapshot.v1', JSON.stringify(payload));

    simulator.refreshPlayerDataSnapshot();
    const row = simulator.playerDataSnapshotRows.find((entry) => entry.playerId === '1');

    expect(row).toBeTruthy();
    expect(row.hasSnapshot).toBe(true);
    expect(row.zoneHrid).toBe('/actions/combat/jungle_planet');
    expect(row.dungeonHrid).toBe('/actions/combat/chimerical_den');
    expect(row.labyrinthHrid).toBe('/monsters/cyclops');
  });

  it('saves queue template sets without snapshot data in store/cache', () => {
    const simulator = useSimulatorStore();

    simulator.saveEquipmentSet('Test Set');
    expect(simulator.equipmentSetEntries[0]?.name).toBe('Test Set');
    expect(simulator.equipmentSets['Test Set']?.snapshot).toBeUndefined();

    const persisted = JSON.parse(global.localStorage.getItem('mwi.equipmentSets.v2') || '{}');
    expect(persisted['Test Set']?.snapshot).toBeUndefined();
  });

  it('keeps loadEquipmentSet as a deprecated compatibility stub', () => {
    const simulator = useSimulatorStore();

    simulator.saveEquipmentSet('Compat Set');

    expect(simulator.loadEquipmentSet('Compat Set')).toBe(false);
    expect(simulator.equipmentSets['Compat Set']).toBeTruthy();
  });

  it('stores queue change templates in equipment sets without before fields', async () => {
    const simulator = useSimulatorStore();
    const headItemHrid = String(simulator.options?.equipmentBySlot?.head?.[0]?.hrid || '');

    expect(headItemHrid).toBeTruthy();

    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.equipment.head.itemHrid = headItemHrid;
    simulator.activePlayer.equipment.head.enhancementLevel = 3;
    setExactEquipmentAsk(simulator, headItemHrid, 3, 1);
    const appendedItems = simulator.addActivePlayerToQueue();
    expect(Array.isArray(appendedItems)).toBe(true);
    expect(appendedItems.length).toBeGreaterThan(0);

    simulator.saveEquipmentSet('Queue Template Set');
    const queueChanges = simulator.equipmentSets['Queue Template Set']?.queueChanges;

    expect(Array.isArray(queueChanges?.items)).toBe(true);
    expect(queueChanges.items.length).toBeGreaterThan(0);
    expect(Array.isArray(queueChanges.items[0]?.targets)).toBe(true);
    expect(queueChanges.items[0].targets.length).toBeGreaterThan(0);
    queueChanges.items[0].targets.forEach((target) => {
      expect(Object.keys(target).some((key) => key.startsWith('before'))).toBe(false);
    });
  });

  it('saves and imports house room queue changes in equipment sets', async () => {
    const simulator = useSimulatorStore();
    const room = findHouseRoomWithUpgradeLevels(1);
    expect(room).toBeTruthy();

    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.houseRooms[room.hrid] = 1;
    const appendedItems = simulator.addActivePlayerToQueue();
    expect(appendedItems).toHaveLength(1);
    expect(appendedItems[0]?.changeDetails?.[0]?.kind).toBe('house_room');

    simulator.saveEquipmentSet('House Room Queue Set');
    const queueChanges = simulator.equipmentSets['House Room Queue Set']?.queueChanges;
    expect(queueChanges?.items?.[0]?.targets).toEqual([
      expect.objectContaining({
        kind: 'house_room',
        roomHrid: room.hrid,
        level: 1,
      }),
    ]);

    simulator.activeQueueState.items = [];
    simulator.activePlayer.houseRooms[room.hrid] = 0;
    const importResult = simulator.importEquipmentSetQueueChanges('House Room Queue Set');
    expect(importResult.ok).toBe(true);
    expect(importResult.importedCount).toBe(1);
    expect(simulator.activeQueueState.items).toHaveLength(1);
    expect(simulator.activeQueueState.items[0]?.snapshot?.houseRooms?.[room.hrid]).toBe(1);
  });

  it('saves and imports guild shrine queue changes without a gold cost', async () => {
    const simulator = useSimulatorStore();
    const guildBuffHrid = combatGuildBuffDetails[0]?.hrid;
    expect(guildBuffHrid).toBeTruthy();

    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.guildBuffs[guildBuffHrid] = 6;
    const appendedItems = simulator.addActivePlayerToQueue();
    expect(appendedItems).toHaveLength(1);
    expect(appendedItems[0]?.changeDetails?.[0]?.kind).toBe('guild_buff');

    simulator.saveEquipmentSet('Guild Shrine Queue Set');
    expect(simulator.equipmentSets['Guild Shrine Queue Set']?.queueChanges?.items?.[0]?.targets).toEqual([
      expect.objectContaining({
        kind: 'guild_buff',
        guildBuffHrid,
        level: 6,
      }),
    ]);

    simulator.activeQueueState.items = [];
    simulator.activePlayer.guildBuffs[guildBuffHrid] = 0;
    const importResult = simulator.importEquipmentSetQueueChanges('Guild Shrine Queue Set');
    expect(importResult.ok).toBe(true);
    expect(simulator.activeQueueState.items[0]?.snapshot?.guildBuffs?.[guildBuffHrid]).toBe(6);
  });

  it('blocks saving equipment sets when queue items include trigger changes', async () => {
    const simulator = useSimulatorStore();
    const abilityHrid = findFirstAbilityWithDefaultTriggers();
    expect(abilityHrid).toBeTruthy();

    simulator.saveEquipmentSet('Safe Set');
    simulator.activePlayer.abilities[0] = {
      abilityHrid,
      level: 1,
    };
    await simulator.setQueueBaselineForActivePlayer();
    simulator.setActivePlayerTriggers(abilityHrid, []);
    const appendedItems = simulator.addActivePlayerToQueue();
    expect(appendedItems).toHaveLength(1);

    expect(() => simulator.saveEquipmentSet('Trigger Queue Set')).toThrow(
      'common:settingsPage.queueSaveErrorUnsupportedTriggerChange',
    );
    expect(simulator.equipmentSets['Trigger Queue Set']).toBeUndefined();
    expect(simulator.equipmentSets['Safe Set']).toBeTruthy();

    const persisted = JSON.parse(global.localStorage.getItem('mwi.equipmentSets.v2') || '{}');
    expect(persisted['Trigger Queue Set']).toBeUndefined();
    expect(persisted['Safe Set']).toBeTruthy();
  });

  it('ignores non-modern equipment sets without queue changes metadata', () => {
    const simulator = useSimulatorStore();
    const legacySnapshot = JSON.parse(JSON.stringify(simulator.activePlayer));

    global.localStorage.setItem(
      'mwi.equipmentSets.v2',
      JSON.stringify({
        'Legacy Set': {
          savedAt: Date.now(),
          snapshot: legacySnapshot,
        },
      }),
    );

    simulator.refreshEquipmentSets();
    const loadedRow = simulator.equipmentSetEntries.find((entry) => entry.name === 'Legacy Set');

    expect(loadedRow).toBeUndefined();
    expect(simulator.equipmentSets['Legacy Set']).toBeUndefined();
  });

  it('imports queue changes by rebuilding baseline and resetting custom ability costs', async () => {
    const simulator = useSimulatorStore();
    const headItemHrid = String(simulator.options?.equipmentBySlot?.head?.[0]?.hrid || '');

    expect(headItemHrid).toBeTruthy();

    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.equipment.head.itemHrid = headItemHrid;
    simulator.activePlayer.equipment.head.enhancementLevel = 4;
    setExactEquipmentAsk(simulator, headItemHrid, 4, 1);
    const appendedItems = simulator.addActivePlayerToQueue();
    expect(Array.isArray(appendedItems)).toBe(true);
    expect(appendedItems.length).toBeGreaterThan(0);

    simulator.activeQueueState.abilityUpgradeCosts = { any: 456 };
    simulator.saveEquipmentSet('Import Queue Set');

    simulator.activePlayer.equipment.head.itemHrid = headItemHrid;
    simulator.activePlayer.equipment.head.enhancementLevel = 2;

    const importResult = simulator.importEquipmentSetQueueChanges('Import Queue Set');
    expect(importResult.ok).toBe(true);
    expect(importResult.importedCount).toBeGreaterThan(0);
    expect(simulator.activeQueueState.baseline?.snapshot?.equipment?.head?.enhancementLevel).toBe(2);
    expect(simulator.activeQueueState.abilityUpgradeCosts).toEqual({});

    const importedEquipmentVariant = simulator.activeQueueState.items.find(
      (item) =>
        String(item?.snapshot?.equipment?.head?.itemHrid || '') === headItemHrid &&
        Number(item?.snapshot?.equipment?.head?.enhancementLevel || 0) === 4,
    );
    expect(importedEquipmentVariant).toBeTruthy();

    const loaded = simulator.loadQueueSnapshotToActivePlayer(importedEquipmentVariant.id);
    expect(loaded).toBe(true);

    const draft = simulator.resolveActivePlayerEquipmentUpgradeCostDraft('head');
    expect(draft).toBeTruthy();
    expect(draft.beforeLevel).toBe(2);
    expect(draft.afterLevel).toBe(4);
  });

  it('recomputes ability upgrade draft from import-time baseline after queue change import', async () => {
    const simulator = useSimulatorStore();
    const abilityBookInfo = findFirstAbilityBookInfo();
    expect(abilityBookInfo).toBeTruthy();
    const abilityHrid = String(abilityBookInfo.abilityHrid || '');

    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.abilities[0].abilityHrid = abilityHrid;
    simulator.activePlayer.abilities[0].level = 4;
    const appendedItems = simulator.addActivePlayerToQueue();
    expect(Array.isArray(appendedItems)).toBe(true);
    expect(appendedItems.length).toBeGreaterThan(0);
    simulator.saveEquipmentSet('Import Ability Queue Set');

    simulator.activePlayer.abilities[0].abilityHrid = abilityHrid;
    simulator.activePlayer.abilities[0].level = 3;

    const importResult = simulator.importEquipmentSetQueueChanges('Import Ability Queue Set');
    expect(importResult.ok).toBe(true);
    expect(importResult.importedCount).toBeGreaterThan(0);

    const importedAbilityVariant = simulator.activeQueueState.items.find(
      (item) =>
        String(item?.snapshot?.abilities?.[0]?.abilityHrid || '') === abilityHrid &&
        Number(item?.snapshot?.abilities?.[0]?.level || 0) === 4,
    );
    expect(importedAbilityVariant).toBeTruthy();

    const loaded = simulator.loadQueueSnapshotToActivePlayer(importedAbilityVariant.id);
    expect(loaded).toBe(true);

    const draft = simulator.resolveActivePlayerAbilityUpgradeCostDraft(0);
    expect(draft).toBeTruthy();
    expect(draft.abilityHrid).toBe(abilityHrid);
    expect(draft.fromLevel).toBe(3);
    expect(draft.toLevel).toBe(4);
  });

  it('persists achievements when loading a queue snapshot to the active player', () => {
    const simulator = useSimulatorStore();
    const snapshot = JSON.parse(JSON.stringify(simulator.activePlayer));
    snapshot.achievements = {
      [ACHIEVEMENT_HRID]: true,
    };
    simulator.activeQueueState.items = [
      {
        id: 'achievement-snapshot',
        snapshot,
      },
    ];

    const loaded = simulator.loadQueueSnapshotToActivePlayer('achievement-snapshot');

    expect(loaded).toBe(true);
    expect(simulator.activePlayer.achievements[ACHIEVEMENT_HRID]).toBe(true);
    expect(JSON.parse(global.localStorage.getItem(PLAYER_ACHIEVEMENTS_STORAGE_KEY)).achievementsByPlayer['1']).toEqual({
      [ACHIEVEMENT_HRID]: true,
    });
  });

  it('returns explicit failure when importing empty queue changes and keeps existing queue', async () => {
    const simulator = useSimulatorStore();
    simulator.saveEquipmentSet('Empty Queue Set');

    await simulator.setQueueBaselineForActivePlayer();
    simulator.activePlayer.levels.stamina = 5;
    simulator.addActivePlayerToQueue();

    const beforeBaselineCreatedAt = simulator.activeQueueState.baseline?.createdAt;
    const beforeItemIds = simulator.activeQueueState.items.map((item) => item.id);

    const importResult = simulator.importEquipmentSetQueueChanges('Empty Queue Set');
    expect(importResult.ok).toBe(false);
    expect(importResult.messageKey).toBe('common:vue.settings.msgQueueChangesImportEmpty');
    expect(simulator.activeQueueState.baseline?.createdAt).toBe(beforeBaselineCreatedAt);
    expect(simulator.activeQueueState.items.map((item) => item.id)).toEqual(beforeItemIds);
  });

  it('applies trigger defaults and allows override', () => {
    const simulator = useSimulatorStore();
    const foodHrid = findFirstFoodWithDefaultTriggers();
    const abilityHrid = findFirstAbilityWithDefaultTriggers();

    expect(foodHrid).toBeTruthy();
    expect(abilityHrid).toBeTruthy();

    const defaultFoodTriggers = simulator.ensureActivePlayerTriggerDefaults(foodHrid);
    expect(defaultFoodTriggers.length).toBeGreaterThan(0);

    simulator.setActivePlayerTriggers(foodHrid, []);
    expect(simulator.getActivePlayerTriggers(foodHrid)).toEqual([]);

    const defaultAbilityTriggers = simulator.resetActivePlayerTriggersToDefault(abilityHrid);
    expect(defaultAbilityTriggers.length).toBeGreaterThan(0);
  });

  it('supports manual price overrides and reset', () => {
    const simulator = useSimulatorStore();
    const itemHrid = findFirstPricedItem();

    expect(itemHrid).toBeTruthy();

    const baseAsk = simulator.pricing.basePriceTable[itemHrid]?.ask;
    const baseBid = simulator.pricing.basePriceTable[itemHrid]?.bid;

    simulator.setPriceOverride(itemHrid, { ask: 123, bid: 456 });
    expect(simulator.pricing.priceTable[itemHrid]?.ask).toBe(123);
    expect(simulator.pricing.priceTable[itemHrid]?.bid).toBe(456);
    expect(simulator.pricing.overrides[itemHrid]).toEqual({ ask: 123, bid: 456 });

    simulator.setPriceOverride(itemHrid, { ask: null });
    expect(simulator.pricing.priceTable[itemHrid]?.ask).toBe(baseAsk);
    expect(simulator.pricing.priceTable[itemHrid]?.bid).toBe(456);
    expect(simulator.pricing.overrides[itemHrid]).toEqual({ bid: 456 });

    const resetOne = simulator.resetPriceOverride(itemHrid);
    expect(resetOne).toBe(true);
    expect(simulator.pricing.overrides[itemHrid]).toBeUndefined();
    expect(simulator.pricing.priceTable[itemHrid]?.ask).toBe(baseAsk);
    expect(simulator.pricing.priceTable[itemHrid]?.bid).toBe(baseBid);

    const resetAll = simulator.resetAllPriceOverrides();
    expect(resetAll).toBe(false);
  });

  it('refetches market prices when cached table misses enhancement data', async () => {
    const simulator = useSimulatorStore();
    simulator.pricing.lastFetchedAt = Date.now();
    simulator.pricing.sourceUrl = 'https://example.com';
    simulator.pricing.enhancementQuotesByItem = {};
    simulator.pricing.enhancementLevelsByItem = {};
    simulator.fetchMarketPrices = vi.fn(async () => ({
      sourceUrl: 'https://example.com',
      lastFetchedAt: Date.now(),
    }));

    await simulator.ensureMarketPricesLoaded();

    expect(simulator.fetchMarketPrices).toHaveBeenCalledTimes(1);
  });

  it('does not refetch market prices when cached data is complete and refresh is not forced', async () => {
    const simulator = useSimulatorStore();
    simulator.pricing.lastFetchedAt = Date.now();
    simulator.pricing.sourceUrl = 'https://example.com';
    simulator.pricing.enhancementQuotesByItem = {
      '/items/test_item': {
        0: { ask: 10, bid: 9 },
      },
    };
    simulator.pricing.enhancementLevelsByItem = {
      '/items/test_item': [1],
    };
    simulator.fetchMarketPrices = vi.fn(async () => ({
      sourceUrl: 'https://example.com',
      lastFetchedAt: Date.now(),
    }));

    await simulator.ensureMarketPricesLoaded();

    expect(simulator.fetchMarketPrices).not.toHaveBeenCalled();
  });

  it('force refreshes market prices when cached data already exists', async () => {
    const simulator = useSimulatorStore();
    simulator.pricing.lastFetchedAt = Date.now();
    simulator.pricing.sourceUrl = 'https://example.com';
    simulator.pricing.enhancementQuotesByItem = {
      '/items/test_item': {
        0: { ask: 10, bid: 9 },
      },
    };
    simulator.pricing.enhancementLevelsByItem = {
      '/items/test_item': [1],
    };
    simulator.fetchMarketPrices = vi.fn(async () => ({
      sourceUrl: 'https://example.com',
      lastFetchedAt: Date.now(),
    }));

    await simulator.ensureMarketPricesLoaded(true);

    expect(simulator.fetchMarketPrices).toHaveBeenCalledTimes(1);
  });

  it('does not force refresh market prices while a load is already in progress', async () => {
    const simulator = useSimulatorStore();
    simulator.pricing.isLoading = true;
    simulator.fetchMarketPrices = vi.fn(async () => ({
      sourceUrl: 'https://example.com',
      lastFetchedAt: Date.now(),
    }));

    const result = await simulator.ensureMarketPricesLoaded(true);

    expect(result).toBeNull();
    expect(simulator.fetchMarketPrices).not.toHaveBeenCalled();
  });

  it('swallows force refresh errors and preserves pricing error state', async () => {
    const simulator = useSimulatorStore();
    simulator.pricing.lastFetchedAt = Date.now();
    simulator.pricing.sourceUrl = 'https://example.com';
    simulator.fetchMarketPrices = vi.fn(async () => {
      simulator.pricing.error = 'boom';
      throw new Error('boom');
    });

    const result = await simulator.ensureMarketPricesLoaded(true);

    expect(result).toBeNull();
    expect(simulator.fetchMarketPrices).toHaveBeenCalledTimes(1);
    expect(simulator.pricing.error).toBe('boom');
  });
});

import { abilityBookInfoByAbilityHrid, levelExperienceTable } from '../shared/gameDataIndex.js';
import { EQUIPMENT_SLOT_KEYS } from '../shared/playerConfig.js';
import {
  createDefaultPriceTable,
  fetchMarketPriceTable,
  MARKET_PRICE_REFRESH_ATTEMPT_COOLDOWN_MS,
  MARKET_PRICE_SNAPSHOT_MAX_AGE_MS,
  normalizePriceMode,
  PRICE_MODE_ASK,
  PRICE_MODE_BID,
} from '../services/marketPriceService.js';
import {
  clearMarketCacheFromStorage,
  cloneBasePriceTable,
  normalizePriceOverrideMap,
  normalizePriceOverrideValue,
  normalizeEnhancementLevelsByItem,
  normalizeEnhancementQuotesByItem,
  persistMarketCacheToStorage,
  persistPricingSettingsToStorage,
  persistQueueRuntimeSettingsToStorage,
  rehydratePricingTable,
} from '../services/simulatorStorage.js';
import {
  QUEUE_MULTI_ROUND_DEFAULT_PARALLEL_WORKERS,
  QUEUE_PARALLEL_WORKER_LIMIT_MAX,
  QUEUE_PARALLEL_WORKER_LIMIT_MIN,
  QUEUE_WEIGHT_SUM_EPSILON,
  getDefaultQueueRunSettings,
  getDefaultQueueRuntimeSettings,
  haveQueueRuntimeRankingSettingsChanged,
  isQueueCostScoreGoldMetricMode,
  normalizeParallelWorkerLimit,
  normalizeQueueCostScoreGoldMetricMode,
  normalizeQueueSettings,
  normalizeQueueRuntimeSettings,
} from '../services/queueScoring.js';
import {
  buildHouseRoomUpgradeCostPreview,
  computeDefaultAbilityUpgradeCost,
  ensureAbilityUpgradeReferenceGlobals,
  getAbilityUpgradeCostKey,
  hasAbilityUpgradeReferenceDataLoaded,
  inspectEquipmentTransitionCost,
  resolveEnhancementLevelPriceFromPricingState,
} from '../services/queueUpgradeCost.js';
import { clamp, clampPositiveInteger, normalizeBaselineSaleSide, toFiniteNumber } from '../services/utils.js';

function getDetectedHardwareCoreCount() {
  const hardwareConcurrency = Number(typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : NaN);
  if (!Number.isFinite(hardwareConcurrency) || hardwareConcurrency <= 0) {
    return null;
  }
  return Math.max(1, Math.floor(hardwareConcurrency));
}

function getParallelWorkerHardMaxForCurrentMachine() {
  const detectedCoreCount = getDetectedHardwareCoreCount();
  if (!Number.isFinite(detectedCoreCount)) {
    return QUEUE_PARALLEL_WORKER_LIMIT_MAX;
  }
  return clamp(detectedCoreCount, QUEUE_PARALLEL_WORKER_LIMIT_MIN, QUEUE_PARALLEL_WORKER_LIMIT_MAX);
}

let abilityUpgradeReferenceLoadPromise = null;
const marketPriceLoadPromises = new WeakMap();
const marketPriceRefreshAttemptTimes = new WeakMap();

function isMarketPriceSnapshotFresh(pricingState, nowMs = Date.now()) {
  const marketTimestampMs = Math.max(0, toFiniteNumber(pricingState?.marketTimestamp, 0)) * 1000;
  if (marketTimestampMs <= 0) {
    return false;
  }
  return Math.abs(nowMs - marketTimestampMs) <= MARKET_PRICE_SNAPSHOT_MAX_AGE_MS;
}

function wasMarketPriceRefreshAttemptedRecently(store, nowMs = Date.now()) {
  const lastAttemptAt = Math.max(
    Math.max(0, toFiniteNumber(store?.pricing?.lastFetchedAt, 0)),
    Math.max(0, toFiniteNumber(marketPriceRefreshAttemptTimes.get(store), 0)),
  );
  return lastAttemptAt > 0 && Math.max(0, nowMs - lastAttemptAt) < MARKET_PRICE_REFRESH_ATTEMPT_COOLDOWN_MS;
}

export async function ensureQueueMarketPriceSnapshot(store) {
  const pendingLoad = marketPriceLoadPromises.get(store);
  if (pendingLoad) {
    try {
      await pendingLoad;
      return { refreshFailed: false };
    } catch (error) {
      return { refreshFailed: true };
    }
  }
  if (store?.pricing?.isLoading) {
    return { refreshFailed: true };
  }

  const nowMs = Date.now();
  if (isMarketPriceSnapshotFresh(store?.pricing, nowMs)) {
    return { refreshFailed: false };
  }
  if (wasMarketPriceRefreshAttemptedRecently(store, nowMs)) {
    return { refreshFailed: Boolean(store?.pricing?.error) };
  }

  marketPriceRefreshAttemptTimes.set(store, nowMs);
  try {
    const result = await store.fetchMarketPrices();
    return { refreshFailed: !result };
  } catch (error) {
    return { refreshFailed: true };
  }
}

async function fetchMarketPricesForStore(store) {
  const pendingLoad = marketPriceLoadPromises.get(store);
  if (pendingLoad) {
    return pendingLoad;
  }
  if (store.pricing.isLoading) {
    return null;
  }

  marketPriceRefreshAttemptTimes.set(store, Date.now());
  store.pricing.isLoading = true;
  store.pricing.error = '';

  const loadPromise = (async () => {
    try {
      const result = await fetchMarketPriceTable();
      store.pricing.basePriceTable = cloneBasePriceTable(result.priceTable);
      store.pricing.enhancementQuotesByItem = normalizeEnhancementQuotesByItem(result.enhancementQuotesByItem);
      store.pricing.enhancementLevelsByItem = normalizeEnhancementLevelsByItem(result.enhancementLevelsByItem);
      store.pricing.marketTimestamp = Math.max(0, toFiniteNumber(result.marketTimestamp, 0));
      rehydratePricingTable(store.pricing);
      store.pricing.lastFetchedAt = Number(result.fetchedAt || Date.now());
      store.pricing.sourceUrl = String(result.sourceUrl || '');
      persistMarketCacheToStorage({
        basePriceTable: store.pricing.basePriceTable,
        enhancementQuotesByItem: store.pricing.enhancementQuotesByItem,
        enhancementLevelsByItem: store.pricing.enhancementLevelsByItem,
        marketTimestamp: store.pricing.marketTimestamp,
        lastFetchedAt: store.pricing.lastFetchedAt,
        sourceUrl: store.pricing.sourceUrl,
      });
      return {
        sourceUrl: store.pricing.sourceUrl,
        lastFetchedAt: store.pricing.lastFetchedAt,
      };
    } catch (error) {
      store.pricing.error = typeof error === 'string' ? error : error?.message || 'Fetch market prices failed.';
      throw error;
    } finally {
      store.pricing.isLoading = false;
    }
  })();
  marketPriceLoadPromises.set(store, loadPromise);

  try {
    return await loadPromise;
  } finally {
    if (marketPriceLoadPromises.get(store) === loadPromise) {
      marketPriceLoadPromises.delete(store);
    }
  }
}

function resetPricesToVendorDefaultsForStore(store) {
  store.pricing.basePriceTable = createDefaultPriceTable();
  store.pricing.enhancementQuotesByItem = {};
  store.pricing.enhancementLevelsByItem = {};
  store.pricing.marketTimestamp = 0;
  rehydratePricingTable(store.pricing);
  store.pricing.lastFetchedAt = 0;
  store.pricing.sourceUrl = '';
  store.pricing.error = '';
  marketPriceRefreshAttemptTimes.delete(store);
  clearMarketCacheFromStorage();
}

async function ensureMarketPricesLoadedForStore(store, forceRefresh = false) {
  if (store.pricing.isLoading) {
    const pendingLoad = marketPriceLoadPromises.get(store);
    if (!pendingLoad) {
      return null;
    }
    try {
      return await pendingLoad;
    } catch (error) {
      return null;
    }
  }

  if (forceRefresh) {
    try {
      return await store.fetchMarketPrices();
    } catch (error) {
      return null;
    }
  }

  const hasEnhancementQuotes = Object.keys(store.pricing?.enhancementQuotesByItem || {}).length > 0;
  const hasEnhancementLevels = Object.keys(store.pricing?.enhancementLevelsByItem || {}).length > 0;
  const hasEnhancementData = hasEnhancementQuotes || hasEnhancementLevels;
  const hasCachedPriceTable = store.pricing.lastFetchedAt > 0 || Boolean(store.pricing.sourceUrl);

  if (hasCachedPriceTable && hasEnhancementData) {
    return null;
  }

  try {
    return await store.fetchMarketPrices();
  } catch (error) {
    return null;
  }
}

async function ensureAbilityUpgradeReferenceDataLoadedForStore(store, forceRefresh = false) {
  const globalRef = ensureAbilityUpgradeReferenceGlobals();
  const hasCachedAbilityXp = hasAbilityUpgradeReferenceDataLoaded();
  const hasCachedSpellBookXp =
    globalRef.jigsSpellBookXpByName &&
    typeof globalRef.jigsSpellBookXpByName === 'object' &&
    Object.keys(globalRef.jigsSpellBookXpByName).length > 0;
  const hasCachedReference =
    hasCachedAbilityXp && (hasCachedSpellBookXp || Object.keys(abilityBookInfoByAbilityHrid).length > 0);

  if (hasCachedReference && !forceRefresh) {
    return {
      loaded: true,
      source: 'cache',
    };
  }

  if (abilityUpgradeReferenceLoadPromise && !forceRefresh) {
    return abilityUpgradeReferenceLoadPromise;
  }

  const loadTask = (async () => {
    try {
      const bundledLevelExperienceTable = Array.isArray(levelExperienceTable)
        ? levelExperienceTable.map((value) => toFiniteNumber(value, 0))
        : [];
      if (bundledLevelExperienceTable.length <= 1) {
        return {
          loaded: false,
          source: 'bundle',
          error: 'Bundled level experience table is missing or invalid.',
        };
      }

      globalRef.jigsLevelExperienceTable = bundledLevelExperienceTable;
      store.abilityUpgradeReferenceVersion = Date.now();
      const queueStates = Object.entries(store.queue?.byPlayer || {}).filter(
        ([, queueState]) => Array.isArray(queueState?.rawRuns) && queueState.rawRuns.length > 0,
      );

      await Promise.all(
        queueStates.map(async ([playerId, queueState]) => {
          await store.refreshQueueResultsFromRawRuns({
            playerId,
            includeEmptyEntries: queueState?.isRunning !== true && queueState?.lastRunStatus === 'completed',
            allowReferenceLoad: false,
            sortRawRuns: false,
            updateLastRunAt: false,
          });
        }),
      );

      return {
        loaded: true,
        source: 'bundle',
      };
    } catch (error) {
      return {
        loaded: false,
        source: 'bundle',
        error: typeof error === 'string' ? error : error?.message || 'Failed to load ability upgrade references.',
      };
    } finally {
      abilityUpgradeReferenceLoadPromise = null;
    }
  })();

  abilityUpgradeReferenceLoadPromise = loadTask;
  return loadTask;
}

export function createPricingActions() {
  return {
    getMarketEnhancementLevelsForItem(itemHrid) {
      const hrid = String(itemHrid || '');
      if (!hrid) {
        return [];
      }
      const levels = this.pricing?.enhancementLevelsByItem?.[hrid];
      if (!Array.isArray(levels)) {
        return [];
      }
      return Array.from(
        new Set(
          levels
            .map((value) => Math.floor(toFiniteNumber(value, -1)))
            .filter(
              (value) =>
                Number.isFinite(value) &&
                value > 0 &&
                resolveEnhancementLevelPriceFromPricingState(hrid, value, this.pricing, 'ask') > 0,
            ),
        ),
      ).sort((a, b) => a - b);
    },
    applyActivePlayerEquipmentEnhancementFromMarket(slotKey, enhancementLevel) {
      const normalizedSlotKey = String(slotKey || '');
      if (!EQUIPMENT_SLOT_KEYS.includes(normalizedSlotKey)) {
        return false;
      }

      const player = this.activePlayer;
      if (!player?.equipment?.[normalizedSlotKey]) {
        return false;
      }

      player.equipment[normalizedSlotKey].enhancementLevel = clampPositiveInteger(enhancementLevel, 0);
      return true;
    },
    resolveActivePlayerEquipmentUpgradeCostDraft(slotKey) {
      const normalizedSlotKey = String(slotKey || '');
      if (!EQUIPMENT_SLOT_KEYS.includes(normalizedSlotKey)) {
        return null;
      }

      const queueState = this.ensureQueueState(this.activePlayerId);
      const baselineSnapshot = queueState?.baseline?.snapshot ?? null;
      if (!baselineSnapshot) {
        return null;
      }

      const baselineEquipment = baselineSnapshot?.equipment?.[normalizedSlotKey] ?? {
        itemHrid: '',
        enhancementLevel: 0,
      };
      const currentEquipment = this.activePlayer?.equipment?.[normalizedSlotKey] ?? {
        itemHrid: '',
        enhancementLevel: 0,
      };
      const beforeItemHrid = String(baselineEquipment?.itemHrid || '');
      const afterItemHrid = String(currentEquipment?.itemHrid || '');
      const beforeLevel = Math.max(0, Math.floor(toFiniteNumber(baselineEquipment?.enhancementLevel, 0)));
      const afterLevel = Math.max(0, Math.floor(toFiniteNumber(currentEquipment?.enhancementLevel, 0)));
      const hasChanged = beforeItemHrid !== afterItemHrid || beforeLevel !== afterLevel;

      if (!hasChanged || !afterItemHrid) {
        return null;
      }

      // 与队列页/多轮模拟口径一致：首页升级成本草稿同样遵循 baselineSaleSide 设置
      // （bid=实际卖出价 / ask=买入参考重置成本口径），避免两处抵扣数值不一致。
      const saleSide = normalizeBaselineSaleSide(queueState.settings?.baselineSaleSide);
      // 第 5 参是 confirmedEquipmentPrices（首页草稿没有用户锁定价，传空数组），
      // 第 6 参才是 options；切勿把 { saleSide } 误传到第 5 参——会被归一化静默丢弃，
      // 导致基准出售口径（baselineSaleSide）永远按默认 bid 计算。
      const inspection = inspectEquipmentTransitionCost(
        normalizedSlotKey,
        baselineEquipment,
        currentEquipment,
        this.pricing,
        [],
        { saleSide },
      );

      return {
        slotKey: normalizedSlotKey,
        beforeItemHrid,
        afterItemHrid,
        beforeLevel,
        afterLevel,
        cost: inspection.cost,
        targetAskAvailable: inspection.targetAskAvailable,
        targetAsk: inspection.targetAsk,
        baselineSaleValue: inspection.baselineSaleValue,
        baselineSaleSource: inspection.baselineSaleSource,
        baselineSaleZero: inspection.baselineSaleZero,
      };
    },
    resolveActivePlayerAbilityUpgradeCostDraft(slotIndex) {
      const index = Math.floor(toFiniteNumber(slotIndex, -1));
      if (!Number.isInteger(index) || index < 0 || index >= 5) {
        return null;
      }

      // 在技能经验/技能书参考数据异步加载时，保持草稿的响应式。
      this.abilityUpgradeReferenceVersion;

      const queueState = this.ensureQueueState(this.activePlayerId);
      const baselineSnapshot = queueState?.baseline?.snapshot ?? null;
      if (!baselineSnapshot) {
        return null;
      }

      const baselineAbility = baselineSnapshot?.abilities?.[index] ?? { abilityHrid: '', level: 1 };
      const currentAbility = this.activePlayer?.abilities?.[index] ?? { abilityHrid: '', level: 1 };
      const baselineHrid = String(baselineAbility?.abilityHrid || '');
      const currentHrid = String(currentAbility?.abilityHrid || '');
      const baselineLevel = Math.max(1, Math.floor(toFiniteNumber(baselineAbility?.level, 1)));
      const currentLevel = Math.max(1, Math.floor(toFiniteNumber(currentAbility?.level, 1)));

      if (!currentHrid) {
        return null;
      }

      const fromLevel = baselineHrid && baselineHrid === currentHrid ? baselineLevel : 1;
      if (currentLevel <= fromLevel) {
        return null;
      }

      const costKey = getAbilityUpgradeCostKey(index, currentHrid, fromLevel, currentLevel);
      const costMap = this.ensureQueueState(this.activePlayerId)?.abilityUpgradeCosts || {};
      const hasSavedCost = Object.prototype.hasOwnProperty.call(costMap, costKey);
      const cost = hasSavedCost
        ? toFiniteNumber(costMap[costKey], 0)
        : toFiniteNumber(
            computeDefaultAbilityUpgradeCost(
              {
                abilityHrid: currentHrid,
                level: fromLevel,
              },
              currentLevel,
              this.pricing,
            ),
            0,
          );

      return {
        slotIndex: index,
        costKey,
        abilityHrid: currentHrid,
        fromLevel,
        toLevel: currentLevel,
        cost,
      };
    },
    setActivePlayerAbilityUpgradeCost(slotIndex, rawCost) {
      const draft = this.resolveActivePlayerAbilityUpgradeCostDraft(slotIndex);
      if (!draft) {
        return false;
      }

      const queueState = this.ensureQueueState(this.activePlayerId);
      const costMap =
        queueState?.abilityUpgradeCosts && typeof queueState.abilityUpgradeCosts === 'object'
          ? { ...queueState.abilityUpgradeCosts }
          : {};
      costMap[draft.costKey] = Math.max(0, toFiniteNumber(rawCost, 0));
      queueState.abilityUpgradeCosts = costMap;
      return true;
    },
    previewHouseRoomUpgradeCost(baseHouseRooms, targetHouseRooms) {
      return buildHouseRoomUpgradeCostPreview(baseHouseRooms, targetHouseRooms, this.pricing);
    },
    validateQueueRuntimeSettingsInput(payload = {}) {
      const performancePct = Number(payload.performancePct);
      const stabilityPct = Number(payload.stabilityPct);
      const costPct = Number(payload.costPct);
      const rawCostScoreGoldPerPointMode = payload?.costScoreGoldPerPointMode;
      const costScoreGoldPerPointMode =
        rawCostScoreGoldPerPointMode == null
          ? normalizeQueueCostScoreGoldMetricMode(this.queueRuntime?.costScoreGoldPerPointMode)
          : String(rawCostScoreGoldPerPointMode);

      if (
        !Number.isFinite(performancePct) ||
        !Number.isFinite(stabilityPct) ||
        !Number.isFinite(costPct) ||
        performancePct < 0 ||
        stabilityPct < 0 ||
        costPct < 0 ||
        performancePct > 100 ||
        stabilityPct > 100 ||
        costPct > 100
      ) {
        return {
          ok: false,
          messageKey: 'common:settingsPage.queueSaveErrorInvalidWeight',
        };
      }

      const weightSum = performancePct + stabilityPct + costPct;
      if (Math.abs(weightSum - 100) > QUEUE_WEIGHT_SUM_EPSILON) {
        return {
          ok: false,
          messageKey: 'common:settingsPage.queueSaveErrorWeightSum',
        };
      }

      if (!isQueueCostScoreGoldMetricMode(costScoreGoldPerPointMode)) {
        return {
          ok: false,
          messageKey: 'common:settingsPage.queueSaveErrorCostScoreGoldMetric',
        };
      }

      const parallelWorkerLimitRaw = Number(payload.parallelWorkerLimit);
      const hardMaxForMachine = getParallelWorkerHardMaxForCurrentMachine();
      if (
        !Number.isInteger(parallelWorkerLimitRaw) ||
        parallelWorkerLimitRaw < QUEUE_PARALLEL_WORKER_LIMIT_MIN ||
        parallelWorkerLimitRaw > hardMaxForMachine
      ) {
        const detectedCoreCount = getDetectedHardwareCoreCount();
        if (Number.isFinite(detectedCoreCount) && parallelWorkerLimitRaw > detectedCoreCount) {
          return {
            ok: false,
            messageKey: 'common:settingsPage.queueSaveErrorParallelLimitByCore',
            messageOptions: {
              cores: detectedCoreCount,
            },
          };
        }

        return {
          ok: false,
          messageKey: 'common:settingsPage.queueSaveErrorParallelLimit',
          messageOptions: {
            min: QUEUE_PARALLEL_WORKER_LIMIT_MIN,
            max: hardMaxForMachine,
          },
        };
      }

      return {
        ok: true,
        settings: {
          finalWeights: {
            performance: performancePct / 100,
            stability: stabilityPct / 100,
            cost: costPct / 100,
          },
          costScoreGoldPerPointMode,
          parallelWorkerLimit: parallelWorkerLimitRaw,
        },
      };
    },
    saveQueueRuntimeSettings(payload = {}) {
      const validated = this.validateQueueRuntimeSettingsInput(payload);
      if (!validated.ok) {
        return validated;
      }

      try {
        const previousRuntimeSettings = this.queueRuntime;
        const normalized = normalizeQueueRuntimeSettings(validated.settings);
        this.queueRuntime = persistQueueRuntimeSettingsToStorage(normalized);
        if (haveQueueRuntimeRankingSettingsChanged(previousRuntimeSettings, normalized)) {
          this.refreshStoredQueueRankingsForCurrentSettings();
        }
        return {
          ok: true,
          settings: this.queueRuntime,
        };
      } catch (error) {
        return {
          ok: false,
          messageKey: 'common:settingsPage.queueSaveErrorStorage',
        };
      }
    },
    resetQueueRuntimeSettings() {
      try {
        const defaults = getDefaultQueueRuntimeSettings();
        const previousRuntimeSettings = this.queueRuntime;
        const normalized = persistQueueRuntimeSettingsToStorage(defaults);
        this.queueRuntime = normalized;
        if (haveQueueRuntimeRankingSettingsChanged(previousRuntimeSettings, normalized)) {
          this.refreshStoredQueueRankingsForCurrentSettings();
        }
        return {
          ok: true,
          settings: normalized,
        };
      } catch (error) {
        return {
          ok: false,
          messageKey: 'common:settingsPage.queueSaveErrorStorage',
        };
      }
    },
    resetQueueSettingsToDefaults() {
      const previousRuntimeSettings = normalizeQueueRuntimeSettings(this.queueRuntime);
      const activePlayerId = this.activePlayerId;
      const previousQueueSettings = normalizeQueueSettings(this.ensureQueueState(activePlayerId).settings);
      let queueSettings = null;

      try {
        queueSettings = this.updateQueueSettingsForPlayer(activePlayerId, getDefaultQueueRunSettings(), {
          persist: true,
          ignorePersistError: false,
        });
      } catch (error) {
        return {
          ok: false,
          messageKey: 'common:settingsPage.queueSaveErrorStorage',
        };
      }

      try {
        const runtimeSettings = persistQueueRuntimeSettingsToStorage(getDefaultQueueRuntimeSettings());
        this.queueRuntime = runtimeSettings;
        if (haveQueueRuntimeRankingSettingsChanged(previousRuntimeSettings, runtimeSettings)) {
          this.refreshStoredQueueRankingsForCurrentSettings();
        }
        return {
          ok: true,
          runtimeSettings,
          queueSettings,
        };
      } catch (error) {
        try {
          this.updateQueueSettingsForPlayer(activePlayerId, previousQueueSettings, {
            persist: true,
            ignorePersistError: false,
          });
        } catch (rollbackError) {
          // 尽力回滚；若回滚失败，保持 store/存储与成功写入的结果一致。
        }
        return {
          ok: false,
          messageKey: 'common:settingsPage.queueSaveErrorStorage',
        };
      }
    },
    setConsumablePriceMode(mode) {
      this.pricing.consumableMode = normalizePriceMode(mode, PRICE_MODE_ASK);
      persistPricingSettingsToStorage(this.pricing);
    },
    setDropPriceMode(mode) {
      this.pricing.dropMode = normalizePriceMode(mode, PRICE_MODE_BID);
      persistPricingSettingsToStorage(this.pricing);
    },
    setPriceOverride(itemHrid, patch) {
      const hrid = String(itemHrid || '');
      const sourcePatch = patch != null && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
      const hasAskPatch = Object.prototype.hasOwnProperty.call(sourcePatch, 'ask');
      const hasBidPatch = Object.prototype.hasOwnProperty.call(sourcePatch, 'bid');
      if (!hrid || (!hasAskPatch && !hasBidPatch)) {
        return false;
      }

      const nextOverrides = {
        ...normalizePriceOverrideMap(this.pricing.overrides),
      };
      const nextEntry = {
        ...(nextOverrides[hrid] || {}),
      };

      if (Object.prototype.hasOwnProperty.call(sourcePatch, 'ask')) {
        const normalizedAsk = normalizePriceOverrideValue(sourcePatch.ask);
        if (normalizedAsk === null) {
          delete nextEntry.ask;
        } else {
          nextEntry.ask = normalizedAsk;
        }
      }

      if (Object.prototype.hasOwnProperty.call(sourcePatch, 'bid')) {
        const normalizedBid = normalizePriceOverrideValue(sourcePatch.bid);
        if (normalizedBid === null) {
          delete nextEntry.bid;
        } else {
          nextEntry.bid = normalizedBid;
        }
      }

      if (Object.keys(nextEntry).length > 0) {
        nextOverrides[hrid] = nextEntry;
      } else {
        delete nextOverrides[hrid];
      }

      this.pricing.overrides = nextOverrides;
      rehydratePricingTable(this.pricing);
      persistPricingSettingsToStorage(this.pricing);
      return true;
    },
    resetPriceOverride(itemHrid) {
      const hrid = String(itemHrid || '');
      const currentOverrides = this.pricing.overrides || {};
      if (!hrid || !Object.prototype.hasOwnProperty.call(currentOverrides, hrid)) {
        return false;
      }

      const nextOverrides = {
        ...normalizePriceOverrideMap(currentOverrides),
      };
      delete nextOverrides[hrid];

      this.pricing.overrides = nextOverrides;
      rehydratePricingTable(this.pricing);
      persistPricingSettingsToStorage(this.pricing);
      return true;
    },
    resetAllPriceOverrides() {
      if (Object.keys(this.pricing.overrides || {}).length === 0) {
        return false;
      }

      this.pricing.overrides = {};
      rehydratePricingTable(this.pricing);
      persistPricingSettingsToStorage(this.pricing);
      return true;
    },
    async fetchMarketPrices() {
      return fetchMarketPricesForStore(this);
    },
    resetPricesToVendorDefaults() {
      resetPricesToVendorDefaultsForStore(this);
    },
    async ensureMarketPricesLoaded(forceRefresh = false) {
      return ensureMarketPricesLoadedForStore(this, forceRefresh);
    },
    async ensureAbilityUpgradeReferenceDataLoaded(forceRefresh = false) {
      return ensureAbilityUpgradeReferenceDataLoadedForStore(this, forceRefresh);
    },
  };
}

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
  normalizeMarketItemValues,
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
        marketItemValues: store.pricing.marketItemValues,
        marketItemValueSources: store.pricing.marketItemValueSources,
        marketItemValueSourcesByLevel: store.pricing.marketItemValueSourcesByLevel,
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
  store.pricing.marketItemValues = {};
  // 来源标注随行情快照一并清空（内存 + 持久化缓存双清）：残留会让重置后再次
  // 导入/REST 恢复的官方估算被误标「合成中价」（assetScoreService.resolveOfficialEstimateSource）。
  // 等级级来源覆盖（【一般-5】）同生命周期双清。
  store.pricing.marketItemValueSources = {};
  store.pricing.marketItemValueSourcesByLevel = {};
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

// 判断「将 incoming 合并进 current」是否为内容空操作：incoming 的每个 itemHrid 在
// current 中均已存在且逐强化等级值完全一致（current 独有的键按合并语义保留、不受
// 影响，故不比较键集总数）。用于 applyImportedMarketItemValues 合并前值比较（#23
// 性能优化）：团队桥接导入 N 个成员透传同一份 merged 快照时，第 2..N 次合并结果与
// 现值完全一致 → 跳过引用替换（避免成本缓存整表失效）与市场缓存全量落盘；现值为
// 载荷严格超集（脚本侧 merged 收缩、app 侧合并只增不减致旧键残留）同样命中空操作
// 判定——若按键集全等判定，该场景团队 N 成员会退回 N 次冗余合并+落盘。两侧数据均
// 经 normalizeMarketItemValues 规范化，形状一致。
function isMarketItemValuesMergeNoOp(current, incoming) {
  for (const itemHrid of Object.keys(incoming)) {
    const currentLevels = current[itemHrid];
    const incomingLevels = incoming[itemHrid];
    if (currentLevels === incomingLevels) {
      continue;
    }
    if (!currentLevels || typeof currentLevels !== 'object' || !incomingLevels || typeof incomingLevels !== 'object') {
      return false;
    }
    const currentLevelKeys = Object.keys(currentLevels);
    const incomingLevelKeys = Object.keys(incomingLevels);
    if (currentLevelKeys.length !== incomingLevelKeys.length) {
      return false;
    }
    for (const levelKey of currentLevelKeys) {
      if (currentLevels[levelKey] !== incomingLevels[levelKey]) {
        return false;
      }
    }
  }
  return true;
}

// 【一般-5】（2026-09-02）：applyImportedMarketItemValues 的 sourcesChanged 判定辅助——
// 对本次载荷覆盖的 hrid 逐键深比等级来源覆盖（{ [level]: source }）：键集或任一值
// 差异即视为标注变化（与物品级标注变化同语义——同值换标注需随市场缓存落盘，
// 否则重启后恢复旧等级级来源标注，#30 A3 的跨会话真值断裂在等级级重演）。
function levelSourcesDifferForHrids(prevLevelSources, nextLevelSources, hrids) {
  for (const hrid of hrids) {
    const prevByLevel = prevLevelSources?.[hrid] ?? null;
    const nextByLevel = nextLevelSources?.[hrid] ?? null;
    if (prevByLevel === nextByLevel) {
      continue;
    }
    if (!prevByLevel || !nextByLevel) {
      return true;
    }
    const prevKeys = Object.keys(prevByLevel);
    const nextKeys = Object.keys(nextByLevel);
    if (prevKeys.length !== nextKeys.length) {
      return true;
    }
    for (const levelKey of prevKeys) {
      if (prevByLevel[levelKey] !== nextByLevel[levelKey]) {
        return true;
      }
    }
  }
  return false;
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

      // 强化等级游戏上限 20（与行情净化/导入钳制同口径）：写入前兜底钳制，
      // 防御绕过行情 normalize 的直写路径把超限等级带进玩家配置。
      player.equipment[normalizedSlotKey].enhancementLevel = Math.min(clampPositiveInteger(enhancementLevel, 0), 20);
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
    // 应用主站导入透传的官方估算市场价值（market_item_values_updated 快照）。
    // 按 itemHrid 整体合并；随 REST 行情缓存持久化（lastFetchedAt > 0 时），
    // 否则仅会话内有效（主站下次打开会重新透传）。
    // estimateSource：载荷级来源标记（importExportMapper 提取的 'official'/'synthetic'，
    // null = 旧载荷/复制粘贴载荷无标记）；syntheticItemHrids：混合载荷的逐件真值清单
    // （#18，2026-08-31——载荷级标记 'official' 但混有合成独有物品时脚本附带的
    // 合成来源 hrid 数组，null = 无清单）。二者结合按导入批次记录到 hrid 粒度的
    // 映射 pricing.marketItemValueSources，供资产分取价链区分「官方估算/合成
    // 中价」标签（assetScoreService.resolveOfficialEstimateSource）。清单命中的 hrid
    // 标合成中价、其余随载荷级标记；null 不更新已标注的 hrid（向后兼容：无标记载荷
    // 按现状显示官方估算）。该映射随市场缓存一并持久化（A3 修复：重启后
    // 来源真值不丢，快照恢复不再被改标官方估算）；只影响标签、数值口径零改动。
    // syntheticLevelKeys（【一般-5】，2026-09-02）：混合载荷的等级级来源真值——混合
    // 物品（官方估算仅覆盖部分等级）中由合成中价补齐的等级键清单（{ [hrid]:
    // levelKey[] }，上游 collectSyntheticLevelKeys，null = 无清单）。逐等级记录到稀疏
    // 覆盖 pricing.marketItemValueSourcesByLevel（{ [hrid]: { [level]: 'synthetic' } }），
    // resolveOfficialEstimateSource 先查等级级再回落物品级——混合物品的合成补齐等级
    // 如实标「合成中价」，其余等级仍标官方估算。与物品级同粒度维护：本次载荷覆盖的
    // hrid 一律重写等级覆盖（清单命中 → 替换为清单等级；否则删除——物品转纯官方/
    // 纯合成后陈旧覆盖不得残留），未覆盖 hrid 承接前值；同样随市场缓存持久化。
    applyImportedMarketItemValues(values, estimateSource = null, syntheticItemHrids = null, syntheticLevelKeys = null) {
      const normalized = normalizeMarketItemValues(values);
      if (Object.keys(normalized).length === 0) {
        return false;
      }
      const syntheticHridSet = Array.isArray(syntheticItemHrids) ? new Set(syntheticItemHrids) : null;
      // 外层守卫不纳入 syntheticLevelKeys：无标记载荷（旧载荷/复制粘贴）不得因携带
      // 陌生字段而进入标注块（向后兼容语义与物品级一致——null 不更新已标注 hrid）。
      const syntheticLevelKeyMap =
        syntheticLevelKeys && typeof syntheticLevelKeys === 'object' && !Array.isArray(syntheticLevelKeys)
          ? syntheticLevelKeys
          : null;
      const current =
        this.pricing?.marketItemValues && typeof this.pricing.marketItemValues === 'object'
          ? this.pricing.marketItemValues
          : {};
      // 合并前值比较（#23 性能优化）：合并为内容空操作（载荷各键均与现值逐值一致，
      // 含「同一 merged 快照重复透传」与「现值为载荷超集」两种形态）时，跳过引用替换
      // （marketItemValues 引用不变 → 成本缓存不整表失效）与市场缓存全量落盘；
      // sources 标注更新仍按载荷执行（来源标记变化与数值无关），且标注变化本身
      // 会触发落盘（见下方门控——跳过落盘仅对「值与标注均未变」成立）。
      const valuesUnchanged = isMarketItemValuesMergeNoOp(current, normalized);
      if (!valuesUnchanged) {
        this.pricing.marketItemValues = { ...current, ...normalized };
      }
      let sourcesChanged = false;
      if (estimateSource === 'official' || estimateSource === 'synthetic' || syntheticHridSet) {
        const prevSources = this.pricing?.marketItemValueSources;
        // 与数值合并同粒度：本次载荷覆盖的 hrid 整体换标注，未覆盖的 hrid 保持原标注。
        const nextSources = {
          ...(prevSources && typeof prevSources === 'object' ? prevSources : {}),
        };
        // 等级级来源覆盖（【一般-5】，2026-09-02）：稀疏结构——仅混合物品的合成补齐
        // 等级入表，物品级标注仍是「该物品的默认来源」。本次载荷覆盖的 hrid 一律重写
        // 覆盖（清单命中 → 替换为清单等级；否则 delete——陈旧覆盖不得残留），未覆盖
        // hrid 承接前值（与 nextSources 的合并语义一致）。整体替换新引用（App.vue
        // 资产分触发向量浅跟踪该字段引用）。
        const prevLevelSources =
          this.pricing?.marketItemValueSourcesByLevel && typeof this.pricing.marketItemValueSourcesByLevel === 'object'
            ? this.pricing.marketItemValueSourcesByLevel
            : {};
        const nextLevelSources = { ...prevLevelSources };
        for (const hrid of Object.keys(normalized)) {
          const isSyntheticItem = syntheticHridSet?.has(hrid) ?? false;
          nextSources[hrid] = isSyntheticItem || estimateSource === 'synthetic' ? 'synthetic' : 'official';
          delete nextLevelSources[hrid];
          const syntheticLevelKeysForItem = syntheticLevelKeyMap?.[hrid];
          if (
            !isSyntheticItem &&
            estimateSource !== 'synthetic' &&
            Array.isArray(syntheticLevelKeysForItem) &&
            syntheticLevelKeysForItem.length > 0
          ) {
            const byLevel = {};
            for (const rawLevelKey of syntheticLevelKeysForItem) {
              // 等级键与 normalizeMarketItemValues 同语义归一化（非负整数下取整字符串、
              // 非法丢弃）：消费端 resolveOfficialEstimateSource 以
              // String(clampEnhancementLevel(level)) 规范键查询，未归一化的非规范键
              // （'1.0'/' 1 '）会永久 miss 并静默回落物品级标签——等级级真值失效。
              const levelNumber = Number(rawLevelKey);
              if (!Number.isFinite(levelNumber) || levelNumber < 0) {
                continue;
              }
              byLevel[String(Math.floor(levelNumber))] = 'synthetic';
            }
            if (Object.keys(byLevel).length > 0) {
              nextLevelSources[hrid] = byLevel;
            }
          }
        }
        this.pricing.marketItemValueSources = nextSources;
        this.pricing.marketItemValueSourcesByLevel = nextLevelSources;
        // 未覆盖的 hrid 原样承接自 prevSources/prevLevelSources，差异只可能出现在本次
        // 载荷覆盖的键上（等级覆盖结构重建必换引用，需逐键深比——levelSourcesDifferForHrids）。
        sourcesChanged =
          Object.keys(normalized).some((hrid) => prevSources?.[hrid] !== nextSources[hrid]) ||
          levelSourcesDifferForHrids(prevLevelSources, nextLevelSources, Object.keys(normalized));
      }
      // 落盘门控：值变化或来源标注变化均需持久化（#23 空操作优化仅指数值内容——
      // 同值换源若不落盘，重启后会恢复旧来源标注，来源真值跨会话断裂）。
      if ((!valuesUnchanged || sourcesChanged) && toFiniteNumber(this.pricing?.lastFetchedAt, 0) > 0) {
        persistMarketCacheToStorage({
          basePriceTable: this.pricing.basePriceTable,
          enhancementQuotesByItem: this.pricing.enhancementQuotesByItem,
          enhancementLevelsByItem: this.pricing.enhancementLevelsByItem,
          marketItemValues: this.pricing.marketItemValues,
          marketItemValueSources: this.pricing.marketItemValueSources,
          marketItemValueSourcesByLevel: this.pricing.marketItemValueSourcesByLevel,
          marketTimestamp: this.pricing.marketTimestamp,
          lastFetchedAt: this.pricing.lastFetchedAt,
          sourceUrl: this.pricing.sourceUrl,
        });
      }
      return true;
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

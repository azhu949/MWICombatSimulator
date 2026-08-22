import { monsterDetailIndex } from '../shared/gameDataIndex.js';
import {
  PRICE_MODE_ASK,
  PRICE_MODE_BID,
  normalizePriceMode,
  resolveMarketPrice,
  resolveMarketSalePrice,
} from './marketPriceService.js';

const PLAYER_IDS = new Set(['player1', 'player2', 'player3', 'player4', 'player5']);

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function addToNumberMap(targetMap, key, value) {
  const normalizedKey = String(key || '');
  const normalizedValue = Math.max(0, toFiniteNumber(value, 0));
  if (!normalizedKey || normalizedValue <= 0) {
    return;
  }

  const current = toFiniteNumber(targetMap.get(normalizedKey), 0);
  targetMap.set(normalizedKey, current + normalizedValue);
}

function resolvePlayerHrid(playerHrid) {
  const normalized = String(playerHrid || '').trim();
  if (PLAYER_IDS.has(normalized)) {
    return normalized;
  }
  if (normalized && !normalized.startsWith('player')) {
    const prefixed = `player${normalized}`;
    if (PLAYER_IDS.has(prefixed)) {
      return prefixed;
    }
  }
  return 'player1';
}

function hasPlayerScopedData(simResult, playerHrid) {
  if (!simResult || !PLAYER_IDS.has(playerHrid)) {
    return false;
  }

  return (
    simResult.dropRateMultiplier?.[playerHrid] != null ||
    simResult.experienceGained?.[playerHrid] != null ||
    simResult.attacks?.[playerHrid] != null ||
    simResult.consumablesUsed?.[playerHrid] != null ||
    simResult.manaUsed?.[playerHrid] != null ||
    simResult.debuffOnLevelGap?.[playerHrid] != null ||
    simResult.dropContextBuckets?.[playerHrid] != null ||
    simResult.scrollUsage?.byPlayer?.[playerHrid] != null
  );
}

function resolvePlayerFromSimResult(simResult, preferredPlayerHrid) {
  const normalizedPreferred = resolvePlayerHrid(preferredPlayerHrid);
  if (hasPlayerScopedData(simResult, normalizedPreferred)) {
    return normalizedPreferred;
  }

  const playerMaps = [
    simResult?.dropRateMultiplier,
    simResult?.experienceGained,
    simResult?.attacks,
    simResult?.consumablesUsed,
    simResult?.manaUsed,
    simResult?.debuffOnLevelGap,
    simResult?.dropContextBuckets,
    simResult?.scrollUsage?.byPlayer,
  ];

  for (const playerMap of playerMaps) {
    if (!playerMap || typeof playerMap !== 'object') {
      continue;
    }
    const firstPlayer = Object.keys(playerMap).find((key) => PLAYER_IDS.has(String(key || '')));
    if (firstPlayer) {
      return String(firstPlayer);
    }
  }

  return normalizedPreferred;
}

function createEmptyBreakdown() {
  return {
    revenueItems: [],
    expenseItems: [],
    revenue: 0,
    expenses: 0,
    profit: 0,
  };
}

function appendExpectedDropsFromTable(dropTable = [], isRare, context, dropCountMap) {
  for (const drop of dropTable) {
    if (toFiniteNumber(drop.minDifficultyTier, 0) > context.difficultyTier) {
      continue;
    }

    let effectiveRate = 0;
    if (isRare) {
      // Keep parity with legacy single-page logic for rare drop expectation.
      effectiveRate = toFiniteNumber(drop.dropRate, 0) * context.rareFindMultiplier;
    } else {
      const baseDropRate =
        toFiniteNumber(drop.dropRate, 0) + toFiniteNumber(drop.dropRatePerDifficultyTier, 0) * context.difficultyTier;
      const tierMultiplier = 1 + 0.1 * context.difficultyTier;
      const scaledDropRate = Math.min(1, baseDropRate * tierMultiplier);
      effectiveRate = Math.min(1, scaledDropRate * context.dropRateMultiplier);
    }
    if (effectiveRate <= 0) {
      continue;
    }

    const minCount = toFiniteNumber(drop.minCount, 0);
    const maxCount = toFiniteNumber(drop.maxCount, 0);
    const expectedAmount = ((minCount + maxCount) / 2) * (1 + context.debuffOnLevelGap) * (1 + context.dropQuantity);
    const expectedDrops = (context.deathsCount * effectiveRate * expectedAmount) / context.numberOfPlayers;

    addToNumberMap(dropCountMap, drop.itemHrid, expectedDrops);
  }
}

function createLegacyDropContext(deathsCount, simResult, playerHrid) {
  return {
    deathsCount: Math.max(0, Math.floor(toFiniteNumber(deathsCount, 0))),
    difficultyTier: Math.max(0, Math.floor(toFiniteNumber(simResult?.difficultyTier, 0))),
    dropRateMultiplier: toFiniteNumber(simResult?.dropRateMultiplier?.[playerHrid], 1),
    rareFindMultiplier: toFiniteNumber(simResult?.rareFindMultiplier?.[playerHrid], 1),
    dropQuantity: toFiniteNumber(simResult?.combatDropQuantity?.[playerHrid], 0),
    debuffOnLevelGap: toFiniteNumber(simResult?.debuffOnLevelGap?.[playerHrid], 0),
    numberOfPlayers: Math.max(1, Math.floor(toFiniteNumber(simResult?.numberOfPlayers, 1))),
  };
}

/**
 * Normalize the compact per-kill context emitted by SimResult.  Returning
 * null for malformed entries lets older/partial results use the legacy final
 * stat snapshot instead of producing NaN or silently changing drop counts.
 */
function normalizeDropContextBucket(rawBucket, simResult) {
  if (!rawBucket || typeof rawBucket !== 'object') {
    return null;
  }

  const killCount = Math.max(0, Math.floor(toFiniteNumber(rawBucket.killCount, 0)));
  if (killCount <= 0) {
    return null;
  }

  return {
    deathsCount: killCount,
    difficultyTier: Math.max(
      0,
      Math.floor(toFiniteNumber(rawBucket.difficultyTier, toFiniteNumber(simResult?.difficultyTier, 0))),
    ),
    dropRateMultiplier: toFiniteNumber(rawBucket.dropRateMultiplier, 1),
    rareFindMultiplier: toFiniteNumber(rawBucket.rareFindMultiplier, 1),
    dropQuantity: toFiniteNumber(rawBucket.combatDropQuantity ?? rawBucket.dropQuantity, 0),
    debuffOnLevelGap: toFiniteNumber(rawBucket.debuffOnLevelGap, 0),
    numberOfPlayers: Math.max(
      1,
      Math.floor(toFiniteNumber(rawBucket.numberOfPlayers, toFiniteNumber(simResult?.numberOfPlayers, 1))),
    ),
  };
}

function getDropContextBuckets(simResult, playerHrid, monsterHrid, deathsCount) {
  const rawBuckets = simResult?.dropContextBuckets?.[playerHrid]?.[monsterHrid];
  if (!Array.isArray(rawBuckets)) {
    return null;
  }

  let buckets = rawBuckets.map((bucket) => normalizeDropContextBucket(bucket, simResult)).filter(Boolean);
  if (buckets.length <= 0) {
    return null;
  }

  // A partially serialized/new result can contain fewer bucketed kills than
  // the legacy deaths map.  Keep the recorded windows authoritative, then
  // evaluate any residual kills with the final legacy snapshot instead of
  // silently under-counting drops.  Conversely, clamp malformed buckets so
  // a corrupted payload cannot create more kills than SimResult reports.
  // `undefined`/`null` means this result has no authoritative deaths count
  // for the monster.  In that case the recorded buckets are complete by
  // contract and must not be residual-filled or clamped against zero.
  const hasReportedDeaths =
    deathsCount !== undefined && deathsCount !== null && deathsCount !== '' && Number.isFinite(Number(deathsCount));
  if (hasReportedDeaths) {
    const reportedDeaths = Math.max(0, Math.floor(toFiniteNumber(deathsCount, 0)));
    const bucketedDeaths = buckets.reduce((sum, bucket) => sum + bucket.deathsCount, 0);
    if (bucketedDeaths < reportedDeaths) {
      const residual = createLegacyDropContext(reportedDeaths - bucketedDeaths, simResult, playerHrid);
      if (residual.deathsCount > 0) {
        buckets = [...buckets, residual];
      }
    } else if (bucketedDeaths > reportedDeaths) {
      let remaining = reportedDeaths;
      buckets = buckets
        .map((bucket) => {
          const clampedCount = Math.min(bucket.deathsCount, remaining);
          remaining -= clampedCount;
          return clampedCount > 0 ? { ...bucket, deathsCount: clampedCount } : null;
        })
        .filter(Boolean);
    }
  }

  return buckets.length > 0 ? buckets : null;
}

function listMonsterHrids(simResult, playerHrid) {
  const monsterHrids = new Set(
    Object.keys(simResult?.deaths ?? {}).filter((monsterHrid) => !PLAYER_IDS.has(String(monsterHrid || ''))),
  );
  for (const monsterHrid of Object.keys(simResult?.dropContextBuckets?.[playerHrid] ?? {})) {
    if (!PLAYER_IDS.has(String(monsterHrid || ''))) {
      monsterHrids.add(monsterHrid);
    }
  }
  return Array.from(monsterHrids).sort();
}

function expectedDropCountMapForMonster(monsterHrid, deathsCount, simResult, playerHrid) {
  const monster = monsterDetailIndex[monsterHrid];
  if (!monster) {
    return new Map();
  }

  const dropCountMap = new Map();
  const hasReportedDeaths = Object.prototype.hasOwnProperty.call(simResult?.deaths || {}, monsterHrid);
  const buckets = getDropContextBuckets(
    simResult,
    playerHrid,
    monsterHrid,
    hasReportedDeaths ? deathsCount : undefined,
  );
  if (buckets) {
    buckets.forEach((context) => {
      appendExpectedDropsFromTable(monster.dropTable || [], false, context, dropCountMap);
      appendExpectedDropsFromTable(monster.rareDropTable || [], true, context, dropCountMap);
    });
    return dropCountMap;
  }

  const context = createLegacyDropContext(deathsCount, simResult, playerHrid);
  if (context.deathsCount > 0) {
    appendExpectedDropsFromTable(monster.dropTable || [], false, context, dropCountMap);
    appendExpectedDropsFromTable(monster.rareDropTable || [], true, context, dropCountMap);
  }
  return dropCountMap;
}

function toSortedLineItemsFromMap(sourceMap, resolveUnitPrice) {
  const rows = [];
  let total = 0;

  for (const [itemHrid, rawAmount] of sourceMap.entries()) {
    const amount = Math.max(0, toFiniteNumber(rawAmount, 0));
    if (amount <= 0) {
      continue;
    }

    const unitPrice = Math.max(0, toFiniteNumber(resolveUnitPrice(itemHrid), 0));
    const totalValue = amount * unitPrice;
    total += totalValue;

    rows.push({
      itemHrid,
      amount,
      unitPrice,
      totalValue,
    });
  }

  rows.sort((a, b) => b.totalValue - a.totalValue || b.amount - a.amount || a.itemHrid.localeCompare(b.itemHrid));
  return { rows, total };
}

function normalizeRandomValue(randomSource) {
  const value = Number(typeof randomSource === 'function' ? randomSource() : Math.random());
  if (!Number.isFinite(value)) {
    return Math.random();
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 0.999999999999;
  }
  return value;
}

function rollFractionalAmount(value, randomSource) {
  const numeric = Math.max(0, toFiniteNumber(value, 0));
  if (Number.isInteger(numeric)) {
    return numeric;
  }
  const intPart = Math.floor(numeric);
  const fraction = numeric - intPart;
  return normalizeRandomValue(randomSource) < fraction ? intPart + 1 : intPart;
}

function appendRandomDropsForContext(monster, context, randomSource, totalDropMap, noRngTotalDropMap) {
  const deathsCount = Math.max(0, Math.floor(toFiniteNumber(context?.deathsCount, 0)));
  if (!monster || deathsCount <= 0) {
    return;
  }

  const difficultyTier = Math.max(0, Math.floor(toFiniteNumber(context.difficultyTier, 0)));
  const dropRateMultiplier = toFiniteNumber(context.dropRateMultiplier, 1);
  const rareFindMultiplier = toFiniteNumber(context.rareFindMultiplier, 1);
  const dropQuantity = toFiniteNumber(context.dropQuantity, 0);
  const debuffOnLevelGap = toFiniteNumber(context.debuffOnLevelGap, 0);
  const numberOfPlayers = Math.max(1, toFiniteNumber(context.numberOfPlayers, 1));
  const dropMap = new Map();
  const rareDropMap = new Map();

  for (const drop of monster.dropTable ?? []) {
    if (toFiniteNumber(drop.minDifficultyTier, 0) > difficultyTier) {
      continue;
    }

    const baseDropRate =
      toFiniteNumber(drop.dropRate, 0) + toFiniteNumber(drop.dropRatePerDifficultyTier, 0) * difficultyTier;
    const tierMultiplier = 1 + 0.1 * difficultyTier;
    const scaledDropRate = Math.min(1, tierMultiplier * baseDropRate);
    if (scaledDropRate <= 0) {
      continue;
    }

    dropMap.set(String(drop.itemHrid || ''), {
      dropRate: Math.min(1, scaledDropRate * dropRateMultiplier),
      number: 0,
      dropMin: toFiniteNumber(drop.minCount, 0),
      dropMax: toFiniteNumber(drop.maxCount, 0),
      noRngDropAmount: 0,
    });
  }

  for (const drop of monster.rareDropTable ?? []) {
    if (toFiniteNumber(drop.minDifficultyTier, 0) > difficultyTier) {
      continue;
    }

    const dropRate = toFiniteNumber(drop.dropRate, 0) * rareFindMultiplier;
    if (dropRate <= 0) {
      continue;
    }

    rareDropMap.set(String(drop.itemHrid || ''), {
      dropRate,
      number: 0,
      dropMin: toFiniteNumber(drop.minCount, 0),
      dropMax: toFiniteNumber(drop.maxCount, 0),
      noRngDropAmount: 0,
    });
  }

  for (const dropObject of dropMap.values()) {
    const dropMidAmount = (dropObject.dropMax + dropObject.dropMin) / 2;
    dropObject.noRngDropAmount +=
      (deathsCount * dropObject.dropRate * dropMidAmount * (1 + debuffOnLevelGap) * (1 + dropQuantity)) /
      numberOfPlayers;
  }

  for (const dropObject of rareDropMap.values()) {
    const dropMidAmount = (dropObject.dropMax + dropObject.dropMin) / 2;
    dropObject.noRngDropAmount +=
      (deathsCount * dropObject.dropRate * dropMidAmount * (1 + debuffOnLevelGap) * (1 + dropQuantity)) /
      numberOfPlayers;
  }

  for (let index = 0; index < deathsCount; index += 1) {
    for (const dropObject of dropMap.values()) {
      if (normalizeRandomValue(randomSource) > dropObject.dropRate / numberOfPlayers) {
        continue;
      }
      const rolled = Math.floor(
        normalizeRandomValue(randomSource) * (dropObject.dropMax - dropObject.dropMin + 1) + dropObject.dropMin,
      );
      const scaledAmount = rolled * (1 + debuffOnLevelGap) * (1 + dropQuantity);
      dropObject.number += rollFractionalAmount(scaledAmount, randomSource);
    }
    for (const dropObject of rareDropMap.values()) {
      if (normalizeRandomValue(randomSource) > dropObject.dropRate / numberOfPlayers) {
        continue;
      }
      const rolled = Math.floor(
        normalizeRandomValue(randomSource) * (dropObject.dropMax - dropObject.dropMin + 1) + dropObject.dropMin,
      );
      const scaledAmount = rolled * (1 + debuffOnLevelGap) * (1 + dropQuantity);
      dropObject.number += rollFractionalAmount(scaledAmount, randomSource);
    }
  }

  for (const [itemHrid, dropObject] of dropMap.entries()) {
    addToNumberMap(totalDropMap, itemHrid, dropObject.number);
    addToNumberMap(noRngTotalDropMap, itemHrid, dropObject.noRngDropAmount);
  }
  for (const [itemHrid, dropObject] of rareDropMap.entries()) {
    addToNumberMap(totalDropMap, itemHrid, dropObject.number);
    addToNumberMap(noRngTotalDropMap, itemHrid, dropObject.noRngDropAmount);
  }
}

function buildDropMapsForProfit(simResult, playerHrid, randomSource = Math.random) {
  if (!simResult || simResult.isDungeon) {
    return {
      totalDropMap: new Map(),
      noRngTotalDropMap: new Map(),
    };
  }

  const resolvedPlayer = resolvePlayerHrid(playerHrid);
  const totalDropMap = new Map();
  const noRngTotalDropMap = new Map();

  const monsterHrids = listMonsterHrids(simResult, resolvedPlayer);

  for (const monsterHrid of monsterHrids) {
    const hasReportedDeaths = Object.prototype.hasOwnProperty.call(simResult?.deaths || {}, monsterHrid);
    const rawDeathsCount = simResult.deaths?.[monsterHrid];

    const monster = monsterDetailIndex[monsterHrid];
    const deathsCount = Math.max(0, Math.floor(toFiniteNumber(rawDeathsCount, 0)));
    const contextBuckets = getDropContextBuckets(
      simResult,
      resolvedPlayer,
      monsterHrid,
      hasReportedDeaths ? deathsCount : undefined,
    );
    if (!monster || (deathsCount <= 0 && !contextBuckets)) {
      continue;
    }

    // Bucket contexts stay in recorded order. Legacy results use one final
    // snapshot context, so the shared roller consumes the historical RNG
    // sequence without maintaining a second copy of the drop algorithm.
    const contexts = contextBuckets ?? [createLegacyDropContext(deathsCount, simResult, resolvedPlayer)];
    contexts.forEach((context) => {
      appendRandomDropsForContext(monster, context, randomSource, totalDropMap, noRngTotalDropMap);
    });
  }

  return {
    totalDropMap,
    noRngTotalDropMap,
  };
}

function getProfitDropMaps(simResult, playerHrid, options = {}) {
  const resolvedPlayer = resolvePlayerFromSimResult(simResult, playerHrid);
  if (!simResult || simResult.isDungeon) {
    return {
      playerHrid: resolvedPlayer,
      totalDropMap: new Map(),
      noRngTotalDropMap: new Map(),
    };
  }

  const randomSource = options.randomSource;
  const useCache = options.useCache !== false && typeof randomSource !== 'function';
  if (!useCache) {
    const direct = buildDropMapsForProfit(simResult, resolvedPlayer, randomSource);
    return {
      playerHrid: resolvedPlayer,
      totalDropMap: direct.totalDropMap,
      noRngTotalDropMap: direct.noRngTotalDropMap,
    };
  }

  if (!simResult.__profitDropMapsCache || typeof simResult.__profitDropMapsCache !== 'object') {
    simResult.__profitDropMapsCache = {};
  }

  const cached = simResult.__profitDropMapsCache[resolvedPlayer];
  if (cached && typeof cached === 'object') {
    return {
      playerHrid: resolvedPlayer,
      totalDropMap: new Map(cached.totalDropEntries || []),
      noRngTotalDropMap: new Map(cached.noRngTotalDropEntries || []),
    };
  }

  const computed = buildDropMapsForProfit(simResult, resolvedPlayer, Math.random);
  simResult.__profitDropMapsCache[resolvedPlayer] = {
    totalDropEntries: Array.from(computed.totalDropMap.entries()),
    noRngTotalDropEntries: Array.from(computed.noRngTotalDropMap.entries()),
  };

  return {
    playerHrid: resolvedPlayer,
    totalDropMap: computed.totalDropMap,
    noRngTotalDropMap: computed.noRngTotalDropMap,
  };
}

export function buildNoRngProfitBreakdown(simResult, playerHrid, pricingOptions = {}) {
  if (!simResult) {
    return createEmptyBreakdown();
  }

  const resolvedPlayer = resolvePlayerFromSimResult(simResult, playerHrid);
  const dropMode = normalizePriceMode(pricingOptions.dropMode, PRICE_MODE_BID);
  const consumableMode = normalizePriceMode(pricingOptions.consumableMode, PRICE_MODE_ASK);
  const priceTable = pricingOptions.priceTable ?? null;

  const resolveDropPrice = (itemHrid) => resolveMarketSalePrice(priceTable, itemHrid, dropMode);
  const resolveConsumablePrice = (itemHrid) => resolveMarketPrice(priceTable, itemHrid, consumableMode);

  const dropCountMap = new Map();
  if (!simResult.isDungeon) {
    for (const unitHrid of listMonsterHrids(simResult, resolvedPlayer)) {
      const hasReportedDeaths = Object.prototype.hasOwnProperty.call(simResult?.deaths || {}, unitHrid);
      const deaths = hasReportedDeaths ? simResult.deaths?.[unitHrid] : undefined;

      const monsterDropCountMap = expectedDropCountMapForMonster(unitHrid, deaths, simResult, resolvedPlayer);

      for (const [itemHrid, amount] of monsterDropCountMap.entries()) {
        addToNumberMap(dropCountMap, itemHrid, amount);
      }
    }
  }

  const { rows: revenueItems, total: revenue } = toSortedLineItemsFromMap(dropCountMap, resolveDropPrice);

  const consumableCountMap = new Map();
  for (const [itemHrid, usedCount] of Object.entries(simResult.consumablesUsed?.[resolvedPlayer] ?? {})) {
    addToNumberMap(consumableCountMap, itemHrid, usedCount);
  }
  const { rows: expenseItems, total: expenses } = toSortedLineItemsFromMap(consumableCountMap, resolveConsumablePrice);

  return {
    revenueItems,
    expenseItems,
    revenue,
    expenses,
    profit: revenue - expenses,
  };
}

export function buildRandomProfitBreakdown(simResult, playerHrid, pricingOptions = {}) {
  if (!simResult) {
    return createEmptyBreakdown();
  }

  const resolvedPlayer = resolvePlayerFromSimResult(simResult, playerHrid);
  const dropMode = normalizePriceMode(pricingOptions.dropMode, PRICE_MODE_BID);
  const consumableMode = normalizePriceMode(pricingOptions.consumableMode, PRICE_MODE_ASK);
  const priceTable = pricingOptions.priceTable ?? null;
  const randomSource = pricingOptions.randomSource;
  const useDropCache = pricingOptions.useDropCache !== false;

  const resolveDropPrice = (itemHrid) => resolveMarketSalePrice(priceTable, itemHrid, dropMode);
  const resolveConsumablePrice = (itemHrid) => resolveMarketPrice(priceTable, itemHrid, consumableMode);

  const { totalDropMap } = getProfitDropMaps(simResult, resolvedPlayer, {
    randomSource,
    useCache: useDropCache,
  });
  const { rows: revenueItems, total: revenue } = toSortedLineItemsFromMap(totalDropMap, resolveDropPrice);

  const consumableCountMap = new Map();
  for (const [itemHrid, usedCount] of Object.entries(simResult.consumablesUsed?.[resolvedPlayer] ?? {})) {
    addToNumberMap(consumableCountMap, itemHrid, usedCount);
  }
  const { rows: expenseItems, total: expenses } = toSortedLineItemsFromMap(consumableCountMap, resolveConsumablePrice);

  return {
    revenueItems,
    expenseItems,
    revenue,
    expenses,
    profit: revenue - expenses,
  };
}

export function estimateNoRngProfit(simResult, playerHrid, pricingOptions = {}) {
  const breakdown = buildNoRngProfitBreakdown(simResult, playerHrid, pricingOptions);
  return {
    revenue: breakdown.revenue,
    expenses: breakdown.expenses,
    profit: breakdown.profit,
  };
}

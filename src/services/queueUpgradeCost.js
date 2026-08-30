import {
  abilityBookInfoByAbilityHrid,
  EQUIPMENT_SLOT_KEYS,
  getAbilityName as getIndexedAbilityName,
  getItemName as getIndexedItemName,
  houseRoomDetailIndex,
  itemDetailIndex,
} from '../shared/gameDataIndex.js';
import {
  applyMarketSaleFee,
  MANUAL_EQUIPMENT_PRICE_SOURCE,
  MANUAL_PRICE_WARNING_CODE,
  normalizePriceMode,
  OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE,
  PRICE_MODE_ASK,
  PRICE_MODE_BID,
  PRICE_MODE_VENDOR,
} from './marketPriceService.js';
import { MARKET_HISTORY_PRICE_SOURCE } from './marketHistoryService.js';
import { clampPositiveInteger, isPlainObject, normalizeBaselineSaleSide, toFiniteNumber } from './utils.js';

export const QUEUE_PRICE_METHOD_LEFT1 = 'left1';
export const QUEUE_PRICE_METHOD_RIGHT1 = 'right1';
export const QUEUE_PRICE_METHOD_MANUAL = 'manual';
export const QUEUE_PRICE_METHOD_MIRROR = 'mirror';

export const PHILOSOPHERS_MIRROR_ITEM_HRID = '/items/philosophers_mirror';

// 强化等级业务上限为 20，此处设 50 作为安全阈值，防止外部输入过大导致
// evalMirror/resolveLevelCost 互递归栈深度过大（每级约 2 帧栈开销）。
export const MIRROR_PLAN_MAX_LEVEL = 50;

// 判断 method 是否为用户在弹窗中明确选定的价格方式（left1/right1/manual/mirror）。
// 供 resolveEquipmentTransitionPricing、resolveUpgradePriceSourceFromInspections、
// normalizeQueuePriceMethod 共用，避免三处独立列举四个常量导致同步漂移。
export function isUserLockedPriceMethod(method) {
  const normalized = String(method || '');
  return (
    normalized === QUEUE_PRICE_METHOD_LEFT1 ||
    normalized === QUEUE_PRICE_METHOD_RIGHT1 ||
    normalized === QUEUE_PRICE_METHOD_MANUAL ||
    normalized === QUEUE_PRICE_METHOD_MIRROR
  );
}

export function normalizeQueuePriceMethod(value) {
  return isUserLockedPriceMethod(value) ? String(value || '') : QUEUE_PRICE_METHOD_LEFT1;
}

export function getAbilityUpgradeCostKey(abilitySlot, abilityHrid, fromLevel, toLevel) {
  return `${abilitySlot}|${abilityHrid}|${fromLevel}|${toLevel}`;
}

export function getVendorPriceByItemHrid(itemHrid) {
  const hrid = String(itemHrid || '');
  if (!hrid) {
    return 0;
  }
  return Math.max(0, toFiniteNumber(itemDetailIndex?.[hrid]?.sellPrice, 0));
}

export function resolveItemPriceFromPricingState(pricingState, itemHrid, side = 'ask') {
  const hrid = String(itemHrid || '');
  if (!hrid) {
    return 0;
  }

  const entry = pricingState?.priceTable?.[hrid] ?? {
    ask: -1,
    bid: -1,
    vendor: getVendorPriceByItemHrid(hrid),
  };
  const ask = toFiniteNumber(entry?.ask, -1);
  const bid = toFiniteNumber(entry?.bid, -1);
  const vendor = Math.max(0, toFiniteNumber(entry?.vendor, getVendorPriceByItemHrid(hrid)));

  if (side === 'bid') {
    if (bid > 0) {
      return bid;
    }
    if (vendor > 0) {
      return vendor;
    }
    return ask > 0 ? ask : 0;
  }

  if (ask > 0) {
    return ask;
  }
  if (vendor > 0) {
    return vendor;
  }
  return bid > 0 ? bid : 0;
}

export function resolveEnhancementLevelPriceFromPricingState(itemHrid, level, pricingState, preferredSide = 'ask') {
  const hrid = String(itemHrid || '');
  const normalizedLevel = Math.max(0, Math.floor(toFiniteNumber(level, 0)));
  if (!hrid) {
    return -1;
  }

  const quote =
    normalizedLevel === 0
      ? pricingState?.priceTable?.[hrid]
      : pricingState?.enhancementQuotesByItem?.[hrid]?.[String(normalizedLevel)];
  if (!isPlainObject(quote)) {
    return -1;
  }

  const side = preferredSide === 'bid' ? 'bid' : 'ask';
  const price = toFiniteNumber(quote[side], -1);
  return price > 0 ? price : -1;
}

export function getConfirmedEquipmentPriceKey(itemHrid, enhancementLevel) {
  return `${String(itemHrid || '')}|${Math.max(0, Math.floor(toFiniteNumber(enhancementLevel, 0)))}`;
}

// 统一 source 映射：把原始 source 字符串归一为已知价格来源之一。
// allowMirror 控制是否接受 'mirror' 来源（confirmed 版接受，queue 版的 reference 分支不接受）。
function normalizePriceSource(rawSource, { allowMirror = false } = {}) {
  const raw = String(rawSource || '');
  if (raw === MARKET_HISTORY_PRICE_SOURCE) {
    return MARKET_HISTORY_PRICE_SOURCE;
  }
  if (raw === MANUAL_EQUIPMENT_PRICE_SOURCE) {
    return MANUAL_EQUIPMENT_PRICE_SOURCE;
  }
  if (raw === 'ask' || raw === 'bid') {
    return raw;
  }
  if (allowMirror && raw === 'mirror') {
    return 'mirror';
  }
  return OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE;
}

// 统一镜子方案 inputs 映射：把原始 inputs 数组归一为 { level, count, price, source } 列表，
// 过滤掉 level<=0 或 price<=0 的无效条目。两个归一化函数共用此逻辑以避免同步漂移。
function normalizeMirrorInputs(rawInputs) {
  const inputs = Array.isArray(rawInputs) ? rawInputs : [];
  return inputs
    .map((input) => {
      const inputLevel = Math.max(0, Math.floor(toFiniteNumber(input?.level, 0)));
      const inputPrice = toFiniteNumber(input?.price, 0);
      if (inputLevel <= 0 || inputPrice <= 0) {
        return null;
      }
      return {
        level: inputLevel,
        count: Math.max(1, Math.floor(toFiniteNumber(input?.count, 1))),
        price: inputPrice,
        source: String(input?.source || 'ask'),
      };
    })
    .filter(Boolean);
}

// manual（手动买入价）的价格校验谓词：必须是正整数。
// normalizeQueuePriceSelections 与 findInvalidPriceSelection、findInvalidManualEquipmentPriceEntry
// 共用此谓词，保持同一过滤口径，避免独立枚举导致同步漂移。
function isValidManualPrice(price) {
  return Number.isSafeInteger(price) && price > 0;
}

// 把弹窗确认结果（每行选择方式 + 锁定价格）归一化为可持久化的确认价格列表。
// 每行可包含：reference（参考价，price 来自参考价链）、manual（手动价）、mirror（镜子方案，含输入件价格）。
// 去重采用 first-valid-wins：条目通过本分支有效性校验后才占坑 seen，与
// normalizeConfirmedEquipmentPrices 的“先过滤无效、再 seen.add”顺序一致，
// 避免同 key 首条无效时连坐丢弃后续有效条目（持久化数据损坏的外部输入）。
export function normalizeQueuePriceSelections(rawSelections = []) {
  const entries = Array.isArray(rawSelections) ? rawSelections : [];
  const normalized = [];
  const seen = new Set();
  const dropped = [];
  // 唯一落库点：通过校验的条目在此占坑去重（first-valid-wins），
  // 无效条目不进入 seen，不会阻挡后续同 key 的有效条目。
  const addEntry = (entry) => {
    const entryKey = getConfirmedEquipmentPriceKey(entry.itemHrid, entry.enhancementLevel);
    if (seen.has(entryKey)) {
      return;
    }
    seen.add(entryKey);
    normalized.push(entry);
  };
  for (const rawEntry of entries) {
    const itemHrid = String(rawEntry?.itemHrid || '');
    const enhancementLevel = Math.max(0, Math.floor(toFiniteNumber(rawEntry?.enhancementLevel, 0)));
    const method = normalizeQueuePriceMethod(rawEntry?.method);
    if (!itemHrid) {
      continue;
    }
    const base = {
      itemHrid,
      enhancementLevel,
      method,
      confirmedAt: Math.max(0, toFiniteNumber(rawEntry?.confirmedAt, Date.now())),
    };

    if (method === QUEUE_PRICE_METHOD_MANUAL) {
      const price = toFiniteNumber(rawEntry?.price, 0);
      if (!isValidManualPrice(price)) {
        dropped.push({ itemHrid, enhancementLevel, method, price });
        continue;
      }
      addEntry({
        ...base,
        price,
        volume: null,
        source: MANUAL_EQUIPMENT_PRICE_SOURCE,
        marketTimestamp: 0,
      });
      continue;
    }

    if (method === QUEUE_PRICE_METHOD_MIRROR) {
      const price = toFiniteNumber(rawEntry?.price, 0);
      if (price <= 0) {
        dropped.push({ itemHrid, enhancementLevel, method, price });
        continue;
      }
      const mirrorPrice = toFiniteNumber(rawEntry?.mirrorPrice, 0);
      const mirrorCount = Math.max(0, Math.floor(toFiniteNumber(rawEntry?.mirrorCount, 0)));
      const inputPrices = normalizeMirrorInputs(rawEntry?.inputs);
      if (inputPrices.length === 0) {
        dropped.push({ itemHrid, enhancementLevel, method, price });
        continue;
      }
      addEntry({
        ...base,
        price,
        volume: null,
        source: 'mirror',
        marketTimestamp: 0,
        mirrorPrice,
        mirrorCount,
        inputs: inputPrices,
        usedBaselineLevels: Array.isArray(rawEntry?.usedBaselineLevels)
          ? rawEntry.usedBaselineLevels.map((l) => Math.max(0, Math.floor(toFiniteNumber(l, 0))))
          : [],
      });
      continue;
    }

    // reference：参考价链锁定
    const price = toFiniteNumber(rawEntry?.price, 0);
    const priceSource = normalizePriceSource(rawEntry?.source, { allowMirror: false });
    if (price <= 0) {
      dropped.push({ itemHrid, enhancementLevel, method, price });
      continue;
    }
    const volume = toFiniteNumber(rawEntry?.volume, 0) > 0 ? toFiniteNumber(rawEntry?.volume, 0) : null;
    // 与 normalizeConfirmedEquipmentPrices 保持同一接受口径：官方小时均价必须携带有效 volume，
    // 否则在归一化入口即过滤。两侧口径一致才能保证 mergeConfirmedPricesAndSelections 拼接
    // 的结果经下游 buildConfirmedEquipmentPriceMap 二次归一化后不丢条目（幂等，first-wins
    // 优先级不被二次过滤破坏）；调整任一侧规则时必须同步另一侧。
    if (priceSource === OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE && volume == null) {
      dropped.push({ itemHrid, enhancementLevel, method, price, source: priceSource });
      continue;
    }
    addEntry({
      ...base,
      price,
      volume,
      source: priceSource,
      marketTimestamp: Math.max(0, toFiniteNumber(rawEntry?.marketTimestamp, 0)),
    });
  }
  if (dropped.length > 0) {
    console.warn('[normalizeQueuePriceSelections] dropped invalid price selections:', dropped);
  }
  return normalized;
}

export function normalizeConfirmedEquipmentPrices(rawPrices) {
  const entries = Array.isArray(rawPrices) ? rawPrices : [];
  const normalized = [];
  const seen = new Set();
  for (const rawEntry of entries) {
    const itemHrid = String(rawEntry?.itemHrid || '');
    const enhancementLevel = Math.max(0, Math.floor(toFiniteNumber(rawEntry?.enhancementLevel, 0)));
    const price = toFiniteNumber(rawEntry?.price, 0);
    const normalizedVolume = toFiniteNumber(rawEntry?.volume, 0);
    const priceSource = normalizePriceSource(rawEntry?.source, { allowMirror: true });
    const volume = normalizedVolume > 0 ? normalizedVolume : null;
    if (!itemHrid || price <= 0 || (priceSource === OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE && volume == null)) {
      continue;
    }
    // mirror 条目需至少一个有效输入件（与 normalizeQueuePriceSelections、findInvalidPriceSelection
    // 保持同一过滤口径，避免同步漂移）；无有效输入件视为损坏快照，丢弃后由其他价格链回退。
    const mirrorInputs = priceSource === 'mirror' ? normalizeMirrorInputs(rawEntry?.inputs) : null;
    if (mirrorInputs != null && mirrorInputs.length === 0) {
      continue;
    }
    const key = getConfirmedEquipmentPriceKey(itemHrid, enhancementLevel);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({
      itemHrid,
      enhancementLevel,
      price,
      volume,
      source: priceSource,
      ...(rawEntry?.method != null ? { method: normalizeQueuePriceMethod(rawEntry?.method) } : {}),
      marketTimestamp: Math.max(0, toFiniteNumber(rawEntry?.marketTimestamp, 0)),
      confirmedAt: Math.max(0, toFiniteNumber(rawEntry?.confirmedAt, 0)),
      ...(priceSource === 'mirror'
        ? {
            mirrorPrice: Math.max(0, toFiniteNumber(rawEntry?.mirrorPrice, 0)),
            mirrorCount: Math.max(0, Math.floor(toFiniteNumber(rawEntry?.mirrorCount, 0))),
            inputs: mirrorInputs,
            usedBaselineLevels: Array.isArray(rawEntry?.usedBaselineLevels)
              ? rawEntry.usedBaselineLevels.map((l) => Math.max(0, Math.floor(toFiniteNumber(l, 0))))
              : [],
          }
        : {}),
    });
  }
  return normalized;
}

// 统一合并队列条目的确认价格与价格选择：对两者分别归一化后拼接，priceSelections 排在前以优先。
// priceSelections 是用户在弹窗中的显式选择（权威数据），confirmedEquipmentPrices 是入队时由定价结果
// 派生的快照；当同 key 冲突时，用户显式选择应优先于派生快照，故 priceSelections 排在数组前部。
// 下游 buildConfirmedEquipmentPriceMap → normalizeConfirmedEquipmentPrices 以 seen Set 保留首次出现
// 条目（first-wins），因此排列在前的 priceSelections 条目会覆盖 confirmedEquipmentPrices 条目。
// 内置归一化使调用方无需关心数据是否已被归一化（两个 normalize 基于 seen Set 去重，对已归一化输入幂等）。
// 幂等性的前提是两个 normalize 的接受口径一致：normalizeQueuePriceSelections 与 normalizeConfirmedEquipmentPrices
// 对官方小时均价条目采用同一规则（volume 无效即过滤），因此拼接结果经下游二次归一化不会丢条目，
// first-wins 优先级语义保持成立；调整任一侧过滤规则时必须同步另一侧，避免隐性耦合踩坑。
// 消除原先各处"有的归一化、有的不归一化"的脆弱差异。若合并逻辑需调整（如去重、优先级），只改此处即可。
export function mergeConfirmedPricesAndSelections(item) {
  const source = isPlainObject(item) ? item : {};
  return [
    ...normalizeQueuePriceSelections(source?.priceSelections),
    ...normalizeConfirmedEquipmentPrices(source?.confirmedEquipmentPrices),
  ];
}

export function buildConfirmedEquipmentPriceMap(rawPrices) {
  if (rawPrices instanceof Map) {
    return rawPrices;
  }
  const priceMap = new Map();
  for (const entry of normalizeConfirmedEquipmentPrices(rawPrices)) {
    priceMap.set(getConfirmedEquipmentPriceKey(entry.itemHrid, entry.enhancementLevel), entry);
  }
  return priceMap;
}

export function getConfirmedEquipmentPrice(rawPrices, itemHrid, enhancementLevel) {
  const key = getConfirmedEquipmentPriceKey(itemHrid, enhancementLevel);
  if (rawPrices instanceof Map) {
    return rawPrices.get(key) || null;
  }
  return buildConfirmedEquipmentPriceMap(rawPrices).get(key) || null;
}

export function resolveRecentTradeAverage(pricingState, itemHrid, enhancementLevel) {
  const quote =
    pricingState?.enhancementQuotesByItem?.[String(itemHrid || '')]?.[
      String(Math.max(0, Math.floor(toFiniteNumber(enhancementLevel, 0))))
    ];
  const price = toFiniteNumber(quote?.averagePrice, 0);
  const volume = toFiniteNumber(quote?.volume, 0);
  if (price <= 0 || volume <= 0) {
    return null;
  }
  return {
    itemHrid: String(itemHrid || ''),
    enhancementLevel: Math.max(0, Math.floor(toFiniteNumber(enhancementLevel, 0))),
    price,
    volume,
    source: OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE,
    marketTimestamp: Math.max(0, toFiniteNumber(pricingState?.marketTimestamp, 0)),
  };
}

export function resolveEquipmentTransitionPricing(
  beforeItemHrid,
  beforeLevel,
  afterItemHrid,
  afterLevel,
  pricingState,
  confirmedEquipmentPrices = [],
  options = {},
) {
  const targetItemHrid = String(afterItemHrid || '');
  if (!targetItemHrid) {
    return {
      cost: 0,
      targetAsk: 0,
      targetAskAvailable: true,
      baselineSaleValue: 0,
      baselineSaleSource: 'none',
      baselineSaleZero: false,
    };
  }

  const safeBeforeLevel = Math.max(0, Math.floor(toFiniteNumber(beforeLevel, 0)));
  const safeAfterLevel = Math.max(0, Math.floor(toFiniteNumber(afterLevel, 0)));
  const exactAsk = resolveEnhancementLevelPriceFromPricingState(targetItemHrid, safeAfterLevel, pricingState, 'ask');
  const confirmedPrice = getConfirmedEquipmentPrice(confirmedEquipmentPrices, targetItemHrid, safeAfterLevel);
  // 用户在弹窗中明确选定了价格方式（left1/right1/manual/mirror）时，优先使用用户锁定的价格，
  // 不再被市场精确 ask 价覆盖——否则队列页显示与多轮模拟成本计算会不一致。
  // 仅当锁定价确实为正时才视为"用户已锁定有效价"，否则回退到 exactAsk 链，
  // 避免持久化数据损坏（price 为 0/负数）时锁定价覆盖掉市场有效价导致误报"缺价"。
  const confirmedMethod = String(confirmedPrice?.method || '');
  const userLockedPrice = toFiniteNumber(confirmedPrice?.price, -1);
  const userLockedMethod = isUserLockedPriceMethod(confirmedMethod) && userLockedPrice > 0;
  const buyCost = userLockedMethod
    ? userLockedPrice
    : exactAsk > 0
      ? exactAsk
      : toFiniteNumber(confirmedPrice?.price, -1);
  const targetPriceSource = userLockedMethod
    ? confirmedPrice.source || confirmedMethod
    : exactAsk > 0
      ? 'ask'
      : confirmedPrice?.source || 'missing';

  const sourceItemHrid = String(beforeItemHrid || '');
  // 出售抵扣侧口径（baselineSaleSide 设置）：bid = 右1 最高买单（实际卖出成交价，抵扣保守）；
  // ask = 左1 最低卖单（买入参考价，重置成本口径，抵扣偏高）。
  // 回退规则刻意不对称（与 SettingsPage 的 baselineSaleSideHint 文案保持一致）：
  // - 选 bid：bid 缺价时回退 ask（用卖方报价近似成交价），仍无价则抵扣按 0 处理；
  // - 选 ask：ask 缺价时【不回退 bid】——ask 是"买入参考/重置成本"口径，混入 bid 会让结果
  //   既非保守口径也非重置口径；改为抵扣按 0 处理，并由 baselineSaleZero 警告提示用户补价。
  // 该口径同时实现在 resolveBaselineSaleQuote（弹窗预览）中，修改须两处同步。
  const saleSide = normalizeBaselineSaleSide(options?.saleSide);
  let sellValue = 0;
  let baselineSaleSource = 'none';
  if (sourceItemHrid) {
    sellValue = resolveEnhancementLevelPriceFromPricingState(sourceItemHrid, safeBeforeLevel, pricingState, saleSide);
    if (sellValue < 0 && saleSide !== 'ask') {
      const fallback = resolveEnhancementLevelPriceFromPricingState(
        sourceItemHrid,
        safeBeforeLevel,
        pricingState,
        'ask',
      );
      if (fallback > 0) {
        sellValue = fallback;
        baselineSaleSource = 'ask';
      } else {
        baselineSaleSource = 'zero';
      }
    } else if (sellValue > 0) {
      baselineSaleSource = saleSide;
    } else {
      baselineSaleSource = 'zero';
    }
  }

  const targetAskAvailable = buyCost > 0;
  // 市场销售需缴纳市场交易税；以净收益作为出售抵扣。
  const baselineSaleValue = sellValue > 0 ? applyMarketSaleFee(sellValue, sourceItemHrid) : 0;
  return {
    cost: targetAskAvailable ? Math.max(0, buyCost - baselineSaleValue) : null,
    targetAsk: targetAskAvailable ? buyCost : null,
    targetAskAvailable,
    targetPriceSource,
    confirmedPrice,
    baselineSaleValue,
    baselineSaleSource,
    baselineSaleZero: Boolean(sourceItemHrid) && baselineSaleValue === 0,
  };
}

// 参考价链：精确 Ask（左1）→ 官方小时均价 → 历史 Ask → confirmed → 都没有返回 null。
// historicalQuotes（可选）：历史 Ask 异步查询结果，结构为 Map<key, quote> 或普通对象 { [key]: quote }，
// key = getConfirmedEquipmentPriceKey(itemHrid, level)，quote 形如 { price, volume, marketTimestamp }。
// 与参考价列口径统一：历史 Ask 在 confirmed 之前查询（与 prepareActivePlayerQueueAddition 中
// 缺价行异步补全历史 Ask 的优先级一致——同步链全部 miss 后才查历史 Ask）。
// 返回 { price, source, volume, marketTimestamp } 或 null。
export function resolveReferenceEquipmentPrice(
  itemHrid,
  enhancementLevel,
  pricingState,
  confirmedEquipmentPrices = [],
  historicalQuotes = null,
) {
  const hrid = String(itemHrid || '');
  const level = Math.max(0, Math.floor(toFiniteNumber(enhancementLevel, 0)));
  if (!hrid) {
    return null;
  }

  const exactAsk = resolveEnhancementLevelPriceFromPricingState(hrid, level, pricingState, 'ask');
  if (exactAsk > 0) {
    return {
      itemHrid: hrid,
      enhancementLevel: level,
      price: exactAsk,
      volume: null,
      source: 'ask',
      marketTimestamp: Math.max(0, toFiniteNumber(pricingState?.marketTimestamp, 0)),
    };
  }

  const recentTrade = resolveRecentTradeAverage(pricingState, hrid, level);
  if (recentTrade) {
    return recentTrade;
  }

  const historical = resolveHistoricalQuote(historicalQuotes, hrid, level);
  if (historical) {
    return historical;
  }

  const confirmed = getConfirmedEquipmentPrice(confirmedEquipmentPrices, hrid, level);
  if (confirmed) {
    return confirmed;
  }

  return null;
}

// 从 historicalQuotes 中按 itemHrid|level 查询历史 Ask 报价。
// 兼容 Map 和普通对象两种形式。返回带 source='historical_ask' 的标准报价或 null。
function resolveHistoricalQuote(historicalQuotes, itemHrid, enhancementLevel) {
  if (!historicalQuotes) {
    return null;
  }
  const hrid = String(itemHrid || '');
  const level = Math.max(0, Math.floor(toFiniteNumber(enhancementLevel, 0)));
  if (!hrid) {
    return null;
  }
  const key = getConfirmedEquipmentPriceKey(hrid, level);
  const quote = historicalQuotes instanceof Map ? historicalQuotes.get(key) : historicalQuotes[key];
  if (!isPlainObject(quote)) {
    return null;
  }
  const price = toFiniteNumber(quote.price, 0);
  if (price <= 0) {
    return null;
  }
  const volume = toFiniteNumber(quote.volume, 0);
  return {
    itemHrid: hrid,
    enhancementLevel: level,
    price,
    volume: volume > 0 ? volume : null,
    source: quote.source ? String(quote.source) : MARKET_HISTORY_PRICE_SOURCE,
    marketTimestamp: Math.max(0, toFiniteNumber(quote.marketTimestamp, 0)),
  };
}

// 别名：参考价链解析（供内部与外部统一使用）。
export function resolveReferencePriceQuote(
  itemHrid,
  enhancementLevel,
  pricingState,
  confirmedEquipmentPrices = [],
  historicalQuotes = null,
) {
  return resolveReferenceEquipmentPrice(
    itemHrid,
    enhancementLevel,
    pricingState,
    confirmedEquipmentPrices,
    historicalQuotes,
  );
}

// 解析基准装备的出售抵扣价（按配置口径：bid=右1 最高买单 / ask=左1 最低卖单）。
// 返回 { price, source }；无价时 price 为 0、source 为 'zero'。
export function resolveBaselineSaleQuote(itemHrid, enhancementLevel, pricingState, saleSide = 'bid') {
  const hrid = String(itemHrid || '');
  const level = Math.max(0, Math.floor(toFiniteNumber(enhancementLevel, 0)));
  if (!hrid) {
    return { price: 0, source: 'none' };
  }

  const preferredSide = saleSide === 'ask' ? 'ask' : 'bid';
  const price = resolveEnhancementLevelPriceFromPricingState(hrid, level, pricingState, preferredSide);
  if (price > 0) {
    return { price, source: preferredSide };
  }
  if (preferredSide !== 'ask') {
    const fallback = resolveEnhancementLevelPriceFromPricingState(hrid, level, pricingState, 'ask');
    if (fallback > 0) {
      return { price: fallback, source: 'ask' };
    }
  }
  return { price: 0, source: 'zero' };
}

// 缺价件手动补价解析为 Map：过滤 level≤0 或 price≤0 的无效条目。
// 返回 Map<level, price>，供 resolvePlanLevelPrice 优先于参考价链取值。
function parseManualInputPrices(manualInputPrices) {
  const manualInputs = new Map();
  if (isPlainObject(manualInputPrices)) {
    for (const [rawLevel, rawPrice] of Object.entries(manualInputPrices)) {
      const safeLevel = Math.max(0, Math.floor(toFiniteNumber(rawLevel, 0)));
      const safePrice = toFiniteNumber(rawPrice, 0);
      if (safeLevel > 0 && safePrice > 0) {
        manualInputs.set(safeLevel, safePrice);
      }
    }
  }
  return manualInputs;
}

// 从 memo 表展开合成方案的输入件需求清单（countMap）。
// collectInputs 递归遍历 memo 中各级的 inputs 数组，将叶节点（method='direct'）按等级汇总计数。
// 随后执行基准顶替：同款同等级需求件直接用基准装备顶替（最多 1 件），在 countMap 中扣减并记录 usedBaselineLevels。
// 返回 { countMap, usedBaselineLevels }。
function collectMirrorInputs(level, memo, baseline) {
  const collectInputs = (l, countMap) => {
    if (l <= 0) {
      return;
    }
    const plan = memo.get(l);
    if (!plan) {
      return;
    }
    if (plan.method === 'direct') {
      countMap[l] = (countMap[l] || 0) + 1;
      return;
    }
    for (const input of plan.inputs) {
      collectInputs(input, countMap);
    }
  };
  const countMap = {};
  collectInputs(level, countMap);

  const usedBaselineLevels = new Set();
  if (baseline > 0 && countMap[baseline] > 0) {
    countMap[baseline] -= 1;
    usedBaselineLevels.add(baseline);
  }
  return { countMap, usedBaselineLevels };
}

// 将 countMap 展开为输入件数组，同时检测硬缺价件。
// 硬缺价：方案需求件（countMap 收集后要购买的输入件）取不到价，会导致方案整体不可算。
// resolvePlanLevelPrice 为价格解析函数（manual 优先 → 参考价链）。
// 返回 { inputs, missingRequired }。
function expandMirrorInputs(countMap, resolvePlanLevelPrice) {
  const missingRequired = [];
  const inputs = [];
  for (const [l, count] of Object.entries(countMap)) {
    const numericLevel = Number(l);
    if (count <= 0) {
      continue;
    }
    const quote = resolvePlanLevelPrice(numericLevel);
    if (!quote) {
      missingRequired.push({ level: numericLevel, count });
      continue;
    }
    inputs.push({
      level: numericLevel,
      count,
      price: quote.price,
      source: quote.source,
      totalCost: quote.price * count,
    });
  }
  return { inputs, missingRequired };
}

// 软缺价检测：当目标级没有走镜像合成（直购兜底或整条合成链断档）且其直接输入级缺价时，
// 把那些输入级列为缺价提示。用户只需补输入级成品的价格即可解锁更便宜的合成路径，
// 不需要填写从 +1 到目标级之间所有取不到价的等级（低级断档不影响直购输入级成品）。
// 注意："不在 memo 中" ≠ "缺价"。镜子自动价缺失时 evalMirror 会在递归入口短路，
// 子级输入件根本不会被计算进 memo；若据此把子级列为缺价，会误导用户去补实际有价的
// 子级价格（G2 误报）。只有"已计算且不可算"（plan 存在且 cost 为 null）才说明该子级
// 价格确实断档；镜子价缺失时真正的阻塞项是镜子价本身，由弹窗的共享镜子价输入引导补齐。
// 返回完整的 missing 数组（含硬缺价 + 软缺价 + 兜底缺价）。
// count 语义：硬缺价（missingRequired）与兜底目标级携带确定份数；软缺价条目 count 为 null——
// 补价前该等级在补价后展开树中的真实需求份数取决于用户所填价格（如补价后低一档输入级
// 改走镜子合成会使本档需求翻倍：测试场景 +1 提示 ×1、补价后 inputs 实际 ×2），当前状态
// 不可确定，展示固定份数会误导用户；补价重算后由 expandMirrorInputs 给出精确 count。
function detectSoftMissingInputs(level, result, memo, missingRequired) {
  const missing = missingRequired.slice();
  const pushMissing = (missingLevel) => {
    if (!missing.some((item) => Number(item.level) === missingLevel)) {
      missing.push({ level: missingLevel, count: null });
    }
  };
  if (level >= 2 && result.method !== 'mirror') {
    const lowerPlan = memo.get(level - 2);
    const upperPlan = memo.get(level - 1);
    const lowerMissing = lowerPlan != null && lowerPlan.cost == null;
    const upperMissing = upperPlan != null && upperPlan.cost == null;
    if (lowerMissing || upperMissing) {
      if (lowerMissing) {
        pushMissing(level - 2);
      }
      if (upperMissing) {
        pushMissing(level - 1);
      }
      // 目标级自身在直购兜底时会被列为缺价；走合成并不需要目标级价格，去掉它。
      const targetRequiredIndex = missing.findIndex((item) => Number(item.level) === level);
      if (targetRequiredIndex >= 0) {
        missing.splice(targetRequiredIndex, 1);
      }
    }
  }
  // 兜底：方案无法计算且没有任何缺价提示时，把目标级本身列为缺价（直购兜底路径）。
  if (missing.length === 0 && result.cost == null) {
    missing.push({ level, count: 1 });
  }
  return missing;
}

// 递归计算"贤者之镜"合成方案：+N = +（N-2）+ +（N-1）+ 镜子。
// 输入件获取成本 = min(直购成品价, 更低价合成)，目标级则镜像优先（用户已选定镜子方案，
// 成本列显示合成路线，不与直购价取 min）；基准装备（同款同等级）直接顶替输入（不卖出、成本计 0），最多顶替 1 件。
// manualInputPrices：缺价件手动补价（{ level: 价格 }），取值时优先于参考价链；其余自动取。
// historicalQuotes（可选）：历史 Ask 异步查询结果，透传至 resolveReferencePriceQuote，
// 使镜子方案取价链与参考价列口径统一（同步链全部 miss 后查历史 Ask）。
// mirrorPrice：贤者之镜单价，调用方必须保证为正有限数；null/0/负值/非有限数视为不可用（与镜子缺价同语义，方案不可算）。
// 返回 { level, cost, method, mirrorCount, mirrorPrice, inputs, details, usedBaselineLevels, missing }；缺价时 cost 为 null。
export function computeMirrorPlan({
  itemHrid,
  targetLevel,
  baselineLevel = 0,
  pricingState,
  confirmedEquipmentPrices = [],
  mirrorPrice = null,
  manualInputPrices = null,
  historicalQuotes = null,
}) {
  const hrid = String(itemHrid || '');
  const level = Math.max(0, Math.floor(toFiniteNumber(targetLevel, 0)));
  const baseline = Math.max(0, Math.floor(toFiniteNumber(baselineLevel, 0)));
  if (!hrid || level <= 0) {
    return {
      level,
      cost: null,
      method: 'direct',
      mirrorCount: 0,
      inputs: [],
      details: [],
      missing: [],
      unavailable: false,
    };
  }

  // 等级上限保护：evalMirror/resolveLevelCost 互递归深度随 level 线性增长，
  // 极大输入（如恶意构造的队列数据）会导致调用栈溢出。超出阈值时标记不可用。
  if (level > MIRROR_PLAN_MAX_LEVEL) {
    return {
      level,
      cost: null,
      method: 'direct',
      mirrorCount: 0,
      inputs: [],
      details: [],
      missing: [],
      unavailable: true,
    };
  }

  // 镜子方案只能恰好跨一级升级：基准装备 +(N-1) → 目标装备 +N。
  // 目标与基准等级差不为 1 时（跨多级 / 同级 / 降级，如基准 +10、目标 +13/+10/+9），
  // 均无法按"基准装备顶替一个输入件"的契约计价，镜子方案不可用，
  // UI 据此禁用"镜子"单选按钮并提示用户。
  if (baseline > 0 && level - baseline !== 1) {
    return {
      level,
      cost: null,
      method: 'direct',
      mirrorCount: 0,
      inputs: [],
      details: [],
      missing: [],
      unavailable: true,
    };
  }

  const manualInputs = parseManualInputPrices(manualInputPrices);

  // 缺价件手动补价优先，其余走参考价链（精确 Ask → 官方小时均价 → 历史 Ask → confirmed）。
  // historicalQuotes 透传至 resolveReferencePriceQuote，使镜子方案取价链与参考价列口径一致。
  const resolvePlanLevelPrice = (planLevel) => {
    const manualPrice = manualInputs.get(planLevel);
    if (manualPrice != null && manualPrice > 0) {
      return {
        itemHrid: hrid,
        enhancementLevel: planLevel,
        price: manualPrice,
        volume: null,
        source: MANUAL_EQUIPMENT_PRICE_SOURCE,
        marketTimestamp: 0,
      };
    }
    return resolveReferencePriceQuote(hrid, planLevel, pricingState, confirmedEquipmentPrices, historicalQuotes);
  };

  // 直购价 = 一件该等级成品的价格（与弹窗中“直购”对比的口径一致），
  // 而不是“从 0 逐级强化”的累加价：目标级只要有成品价就不需要低级价格。
  const resolvePlanDirectQuote = (planLevel) => {
    const quote = resolvePlanLevelPrice(planLevel);
    return quote ? quote.price : null;
  };

  const memo = new Map();

  // 单级合成价：+N = +（N-2）+ +（N-1）+ 镜子；任一输入价缺失或镜子价缺失 → null。
  // evalMirror 与 resolveLevelCost 互为递归调用，使用 function 声明以利用 hoisting 消除 TDZ 风险。
  // 镜子价必须为正有限数：0/负值与 null、非有限数同视为不可用，防止"0 镜子成本"合成价
  // 低于所有直购价而被误选为最低成本。UI 层手工输入已校验收敛到正数，此处为 API 层防御。
  function evalMirror(l) {
    if (l < 2 || mirrorPrice == null || !Number.isFinite(Number(mirrorPrice)) || Number(mirrorPrice) <= 0) {
      return null;
    }
    const lower = resolveLevelCost(l - 2);
    const upper = resolveLevelCost(l - 1);
    if (lower.cost == null || upper.cost == null) {
      return null;
    }
    return {
      cost: lower.cost + upper.cost + Number(mirrorPrice),
      method: 'mirror',
      inputs: [l - 2, l - 1],
      mirrorCount: lower.mirrorCount + upper.mirrorCount + 1,
    };
  }

  function resolveLevelCost(l) {
    if (l <= 0) {
      return { cost: 0, method: 'direct', inputs: null, mirrorCount: 0 };
    }
    if (memo.has(l)) {
      return memo.get(l);
    }
    // 基准装备顶替该等级输入：成本 0，collectInputs 仍按 direct 计入 countMap 以便顶替逻辑标记。
    if (baseline > 0 && l === baseline) {
      const baselinePlan = { cost: 0, method: 'direct', inputs: null, mirrorCount: 0 };
      memo.set(l, baselinePlan);
      return baselinePlan;
    }
    const direct = resolvePlanDirectQuote(l);
    let best = { cost: direct, method: 'direct', inputs: null, mirrorCount: 0 };
    // 输入件获取成本 = min(直购成品价, 镜子合成价)：取更低者。
    if (l >= 2) {
      const mirrorPlan = evalMirror(l);
      if (mirrorPlan && mirrorPlan.cost < (best.cost ?? Infinity)) {
        best = mirrorPlan;
      }
    }
    memo.set(l, best);
    return best;
  }

  // 顶层镜像优先：用户已选定“镜子方案”，成本 = 合成路线（如 13 = 11 + 12 + 镜子），
  // 不与目标级直购价取 min（直购价在参考价/左1列可见）；合成不可算时由缺价提示引导补价。
  // 顶层结果同样写入 memo，供 collectInputs 展开输入件清单。
  const result = evalMirror(level) || resolveLevelCost(level);
  if (!memo.has(level)) {
    memo.set(level, result);
  }
  const usedBaselineLevels = new Set();
  const { countMap, usedBaselineLevels: baselineSet } = collectMirrorInputs(level, memo, baseline);
  for (const bl of baselineSet) {
    usedBaselineLevels.add(bl);
  }

  // 硬缺价：方案需求件（countMap 收集后要购买的输入件）取不到价，会导致方案整体不可算。
  const { inputs, missingRequired } = expandMirrorInputs(countMap, resolvePlanLevelPrice);

  const mirrorCount = result.mirrorCount;
  const mirrorTotalCost = mirrorCount > 0 ? mirrorCount * Number(mirrorPrice || 0) : 0;
  const inputTotal = inputs.reduce((sum, input) => sum + input.totalCost, 0);
  const missing = detectSoftMissingInputs(level, result, memo, missingRequired);
  // 目标级必须走镜子路线才有成本（用户已选定镜子方案）；直购兜底不再作为镜子成本显示。
  // cost 取自递归合成路径 result.cost（合成成本的源头值），而非展开后的 inputTotal + mirrorTotalCost。
  // 两者在当前逻辑下数值等价（inputTotal 来自 collectInputs 递归展开后扣除基准顶替件的叶节点输入×单价之和，
  // mirrorTotalCost = mirrorCount × mirrorPrice，与 result.cost 递归中每层累加的 mirrorPrice 总和一致，
  // 基准顶替件在 resolveLevelCost 中 cost = 0、在 countMap 中被扣除，两路径对齐）。
  // 选择 result.cost 是因为它是合成逻辑的直接计算结果，在等价性断裂时更可靠；
  // 展开路径用于 inputs/details 展示，其与 cost 的一致性由下方开发期断言校验。
  const cost = missingRequired.length === 0 && result.method === 'mirror' && result.cost != null ? result.cost : null;

  // 开发期断言：验证 cost（递归 result.cost）与展开路径（inputTotal + mirrorTotalCost）的数值等价性。
  // 若等价性被未来修改打破，开发期立即 throw，确保 CI 能捕获回归，避免 inputs/details 展示与 cost 不一致。
  // 生产构建中 import.meta.env.DEV 被 Vite 静态替换为 false 并被 tree-shaking 移除，零开销零副作用。
  if (import.meta.env.DEV && cost != null && result.cost != null) {
    const expandedTotal = inputTotal + mirrorTotalCost;
    if (Math.abs(expandedTotal - result.cost) > 0.5) {
      throw new Error(
        `[computeMirrorPlan] cost 等价性断裂: inputTotal(${inputTotal}) + mirrorTotalCost(${mirrorTotalCost}) = ${expandedTotal} !== result.cost(${result.cost}), level=${level}`,
      );
    }
  }

  return {
    level,
    cost,
    method: result.method,
    mirrorCount,
    mirrorPrice: mirrorCount > 0 ? Number(mirrorPrice || 0) : 0,
    inputs,
    details: inputs.map((input) => ({
      level: input.level,
      count: input.count,
      price: input.price,
      totalCost: input.totalCost,
      source: input.source,
    })),
    usedBaselineLevels: Array.from(usedBaselineLevels),
    missing,
    unavailable: false,
  };
}

export function computeDefaultEquipmentTransitionCost(
  beforeItemHrid,
  beforeLevel,
  afterItemHrid,
  afterLevel,
  pricingState,
  confirmedEquipmentPrices = [],
  options = {},
) {
  return resolveEquipmentTransitionPricing(
    beforeItemHrid,
    beforeLevel,
    afterItemHrid,
    afterLevel,
    pricingState,
    confirmedEquipmentPrices,
    options,
  ).cost;
}

export function inspectEquipmentTransitionCost(
  slotKey,
  beforeEquipment,
  afterEquipment,
  pricingState,
  confirmedEquipmentPrices = [],
  options = {},
) {
  const beforeItemHrid = String(beforeEquipment?.itemHrid || '');
  const afterItemHrid = String(afterEquipment?.itemHrid || '');
  const beforeLevel = Math.max(0, Math.floor(toFiniteNumber(beforeEquipment?.enhancementLevel, 0)));
  const afterLevel = Math.max(0, Math.floor(toFiniteNumber(afterEquipment?.enhancementLevel, 0)));
  const pricing = resolveEquipmentTransitionPricing(
    beforeItemHrid,
    beforeLevel,
    afterItemHrid,
    afterLevel,
    pricingState,
    confirmedEquipmentPrices,
    options,
  );
  return {
    slotKey,
    beforeItemHrid,
    afterItemHrid,
    beforeLevel,
    afterLevel,
    ...pricing,
  };
}

export function inspectQueueEquipmentPricing(
  baselineSnapshot,
  targetSnapshot,
  pricingState,
  confirmedEquipmentPrices = [],
  options = {},
) {
  const inspections = [];
  const confirmedEquipmentPriceMap = buildConfirmedEquipmentPriceMap(confirmedEquipmentPrices);
  for (const slotKey of EQUIPMENT_SLOT_KEYS) {
    const beforeEquipment = baselineSnapshot?.equipment?.[slotKey] ?? { itemHrid: '', enhancementLevel: 0 };
    const afterEquipment = targetSnapshot?.equipment?.[slotKey] ?? { itemHrid: '', enhancementLevel: 0 };
    if (
      String(beforeEquipment?.itemHrid || '') === String(afterEquipment?.itemHrid || '') &&
      Math.floor(toFiniteNumber(beforeEquipment?.enhancementLevel, 0)) ===
        Math.floor(toFiniteNumber(afterEquipment?.enhancementLevel, 0))
    ) {
      continue;
    }
    if (!String(afterEquipment?.itemHrid || '')) {
      continue;
    }
    inspections.push(
      inspectEquipmentTransitionCost(
        slotKey,
        beforeEquipment,
        afterEquipment,
        pricingState,
        confirmedEquipmentPriceMap,
        options,
      ),
    );
  }
  return inspections;
}

export function buildQueueCostWarnings(inspections = []) {
  const baselineWarnings = inspections
    .filter((inspection) => inspection.baselineSaleZero)
    .map((inspection) => ({
      code: 'baseline_sale_zero',
      slotKey: inspection.slotKey,
      itemHrid: inspection.beforeItemHrid,
      enhancementLevel: inspection.beforeLevel,
    }));
  const confirmedWarnings = inspections
    .filter(
      (inspection) =>
        inspection.confirmedPrice &&
        // 注意：此处故意不包含 'mirror'。镜子方案的成本是合成价（输入件市场价 + 镜子价格），
        // 与 hourly/historical/manual 的"价格可靠性警示"语义不同；且 QueuePage.vue 的
        // priceSelectionLines 已对 mirror 做了详细的多行明细展示（Mirror 标签 + 镜子数量×价格
        // + 输入件明细 + 合计），用户足以识别这是合成方案，故不重复生成 costWarning。
        (inspection.targetPriceSource === OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE ||
          inspection.targetPriceSource === MARKET_HISTORY_PRICE_SOURCE ||
          inspection.targetPriceSource === MANUAL_EQUIPMENT_PRICE_SOURCE),
    )
    .map((inspection) => ({
      code:
        inspection.targetPriceSource === MARKET_HISTORY_PRICE_SOURCE
          ? MARKET_HISTORY_PRICE_SOURCE
          : inspection.targetPriceSource === MANUAL_EQUIPMENT_PRICE_SOURCE
            ? MANUAL_PRICE_WARNING_CODE
            : 'confirmed_hourly_average',
      source: inspection.targetPriceSource,
      slotKey: inspection.slotKey,
      itemHrid: inspection.afterItemHrid,
      enhancementLevel: inspection.afterLevel,
      price: inspection.confirmedPrice.price,
      volume: inspection.confirmedPrice.volume,
      marketTimestamp: inspection.confirmedPrice.marketTimestamp,
    }));
  return [...baselineWarnings, ...confirmedWarnings];
}

export function findInvalidManualEquipmentPriceEntry(rawPrices) {
  if (!Array.isArray(rawPrices)) {
    return null;
  }
  for (const rawEntry of rawPrices) {
    if (String(rawEntry?.source || '') !== MANUAL_EQUIPMENT_PRICE_SOURCE) {
      continue;
    }
    const price = toFiniteNumber(rawEntry?.price, 0);
    if (!isValidManualPrice(price)) {
      return rawEntry;
    }
  }
  return null;
}

// 校验 priceSelections 中各方式的价格是否有效。
// manual 要求正整数；mirror 要求正数（cost 可为浮点），且 inputs 中至少有一个有效输入件
// （inputLevel > 0 且 inputPrice > 0）。mirror 校验复用 normalizeMirrorInputs 以与
// normalizeQueuePriceSelections 保持同一过滤口径，避免同步漂移。
// left1/right1 要求正数（price 来自市场参考价/收购价，可为浮点），与 mirror 的 price 校验口径一致。
// 无效时返回该条目，否则返回 null。
export function findInvalidPriceSelection(rawSelections) {
  if (!Array.isArray(rawSelections)) {
    return null;
  }
  for (const rawEntry of rawSelections) {
    const method = String(rawEntry?.method || '');
    if (method === QUEUE_PRICE_METHOD_MANUAL) {
      const price = toFiniteNumber(rawEntry?.price, 0);
      if (!isValidManualPrice(price)) {
        return rawEntry;
      }
    } else if (method === QUEUE_PRICE_METHOD_MIRROR) {
      const price = toFiniteNumber(rawEntry?.price, 0);
      if (price <= 0) {
        return rawEntry;
      }
      const normalizedInputs = normalizeMirrorInputs(rawEntry?.inputs);
      if (normalizedInputs.length === 0) {
        return rawEntry;
      }
    } else if (method === QUEUE_PRICE_METHOD_LEFT1 || method === QUEUE_PRICE_METHOD_RIGHT1) {
      const price = toFiniteNumber(rawEntry?.price, 0);
      if (price <= 0) {
        return rawEntry;
      }
    }
  }
  return null;
}

// 构造无效价格错误。method 区分错误消息：manual 使用"整数买入价"专用消息，
// mirror/left1/right1 使用通用"价格必须大于 0"消息（其价格来自市场数据，可为浮点）。
export function createInvalidManualEquipmentPriceError(rawEntry, method) {
  const resolvedMethod = String(method || '');
  const isManual = resolvedMethod === QUEUE_PRICE_METHOD_MANUAL || resolvedMethod === MANUAL_EQUIPMENT_PRICE_SOURCE;
  const error = new Error(isManual ? 'common:queue.manualPriceInvalid' : 'common:queue.priceSelectionInvalid');
  error.code = 'invalid_manual_price';
  error.details = {
    itemHrid: String(rawEntry?.itemHrid || ''),
    enhancementLevel: Math.max(0, Math.floor(toFiniteNumber(rawEntry?.enhancementLevel, 0))),
  };
  return error;
}

export function createMissingEquipmentAskError(inspection, { queued = false } = {}) {
  const error = new Error(queued ? 'common:queue.missingEnhancementAskQueued' : 'common:queue.missingEnhancementAsk');
  error.code = 'missing_enhancement_ask';
  error.queued = queued;
  error.details = {
    slotKey: inspection.slotKey,
    itemHrid: inspection.afterItemHrid,
    enhancementLevel: inspection.afterLevel,
  };
  return error;
}

export function createEquipmentPriceConfirmationError(confirmations = []) {
  const error = new Error('common:queue.confirmHourlyAverageRequired');
  error.code = 'equipment_price_confirmation_required';
  error.confirmations = normalizeConfirmedEquipmentPrices(confirmations);
  return error;
}

export function ensureAbilityUpgradeReferenceGlobals() {
  const target = typeof window !== 'undefined' ? window : globalThis;
  if (!Array.isArray(target.jigsLevelExperienceTable)) {
    target.jigsLevelExperienceTable = [];
  }
  if (
    !target.jigsSpellBookXpByName ||
    typeof target.jigsSpellBookXpByName !== 'object' ||
    Array.isArray(target.jigsSpellBookXpByName)
  ) {
    target.jigsSpellBookXpByName = {};
  }
  return target;
}

export function hasAbilityUpgradeReferenceDataLoaded() {
  const globalRef = ensureAbilityUpgradeReferenceGlobals();
  return Array.isArray(globalRef.jigsLevelExperienceTable) && globalRef.jigsLevelExperienceTable.length > 1;
}

export function getAbilityXpForLevel(level) {
  const table = ensureAbilityUpgradeReferenceGlobals().jigsLevelExperienceTable;
  if (!Array.isArray(table)) {
    return null;
  }

  const normalizedLevel = Math.floor(toFiniteNumber(level, -1));
  if (!Number.isInteger(normalizedLevel) || normalizedLevel < 0 || normalizedLevel >= table.length) {
    return null;
  }

  const xpValue = Number(table[normalizedLevel]);
  return Number.isFinite(xpValue) ? xpValue : null;
}

export function getSpellBookXpForAbility(abilityHrid) {
  const normalizedAbilityHrid = String(abilityHrid || '');
  if (!normalizedAbilityHrid) {
    return 0;
  }

  const directBookInfo = abilityBookInfoByAbilityHrid[normalizedAbilityHrid];
  if (directBookInfo?.xpPerBook > 0) {
    return directBookInfo.xpPerBook;
  }

  const abilityName = getIndexedAbilityName(normalizedAbilityHrid, '');
  if (!abilityName) {
    return 0;
  }

  const spellBookXpMap = ensureAbilityUpgradeReferenceGlobals().jigsSpellBookXpByName;
  if (!spellBookXpMap || typeof spellBookXpMap !== 'object') {
    return 0;
  }

  const lowerAbilityName = abilityName.toLowerCase();
  const matchedKey = Object.keys(spellBookXpMap).find((key) => String(key || '').toLowerCase() === lowerAbilityName);
  const xpPerBook = matchedKey ? Number(spellBookXpMap[matchedKey]) : 0;
  return Number.isFinite(xpPerBook) && xpPerBook > 0 ? xpPerBook : 0;
}

export function resolveAbilityBookPriceFromPricingState(pricingState, abilityHrid) {
  const normalizedAbilityHrid = String(abilityHrid || '');
  const bookItemHrid = String(abilityBookInfoByAbilityHrid?.[normalizedAbilityHrid]?.itemHrid || '');
  if (!bookItemHrid) {
    return null;
  }

  const dropMode = normalizePriceMode(pricingState?.dropMode, PRICE_MODE_BID);
  if (dropMode === PRICE_MODE_VENDOR) {
    const vendorFallback = toFiniteNumber(itemDetailIndex?.[bookItemHrid]?.sellPrice, 0);
    const vendorPrice = Math.max(0, toFiniteNumber(pricingState?.priceTable?.[bookItemHrid]?.vendor, vendorFallback));
    return Number.isFinite(vendorPrice) ? vendorPrice : null;
  }

  const side = dropMode === PRICE_MODE_ASK ? 'ask' : 'bid';
  const marketPrice = resolveItemPriceFromPricingState(pricingState, bookItemHrid, side);
  return Number.isFinite(marketPrice) ? Math.max(0, marketPrice) : null;
}

export function computeDefaultAbilityUpgradeCost(baseAbility, toLevel, pricingState) {
  const abilityHrid = String(baseAbility?.abilityHrid || '');
  const fromLevel = Math.max(1, Math.floor(toFiniteNumber(baseAbility?.level, 1)));
  const targetLevel = Math.max(1, Math.floor(toFiniteNumber(toLevel, 1)));
  if (!abilityHrid || targetLevel <= fromLevel) {
    return 0;
  }

  const startXp = getAbilityXpForLevel(fromLevel);
  const endXp = getAbilityXpForLevel(targetLevel);
  if (startXp == null || endXp == null) {
    return null;
  }

  const xpNeeded = endXp - startXp;
  if (xpNeeded <= 0) {
    return 0;
  }

  const xpPerBook = getSpellBookXpForAbility(abilityHrid);
  if (!Number.isFinite(xpPerBook) || xpPerBook <= 0) {
    return null;
  }

  const booksNeeded = Math.ceil(xpNeeded / xpPerBook);
  if (!Number.isFinite(booksNeeded) || booksNeeded <= 0) {
    return 0;
  }

  const pricePerBook = resolveAbilityBookPriceFromPricingState(pricingState, abilityHrid);
  if (!Number.isFinite(pricePerBook) || pricePerBook < 0) {
    return null;
  }

  const totalCost = booksNeeded * pricePerBook;
  return totalCost > 0 ? totalCost : 0;
}

export function normalizeHouseRoomLevelMap(source) {
  const normalizedSource = isPlainObject(source) ? source : {};
  const normalized = {};

  for (const room of Object.values(houseRoomDetailIndex || {})) {
    const roomHrid = String(room?.hrid || '');
    if (!roomHrid) {
      continue;
    }
    normalized[roomHrid] = clampPositiveInteger(normalizedSource[roomHrid], 0);
  }

  return normalized;
}

export function resolveHouseRoomMaterialPricing(itemHrid, pricingState) {
  const normalizedItemHrid = String(itemHrid || '');
  if (!normalizedItemHrid) {
    return {
      unitPrice: 0,
      priced: false,
    };
  }

  if (normalizedItemHrid === '/items/coin') {
    return {
      unitPrice: 1,
      priced: true,
    };
  }

  const resolvedPrice = Math.max(
    0,
    toFiniteNumber(resolveItemPriceFromPricingState(pricingState, normalizedItemHrid, 'ask'), 0),
  );

  return {
    unitPrice: resolvedPrice,
    priced: resolvedPrice > 0,
  };
}

export function buildHouseRoomUpgradeCostPreview(baseHouseRooms, targetHouseRooms, pricingState) {
  const normalizedBase = normalizeHouseRoomLevelMap(baseHouseRooms);
  const normalizedTarget = normalizeHouseRoomLevelMap(targetHouseRooms);
  const roomDetails = Object.values(houseRoomDetailIndex || {})
    .slice()
    .sort(
      (left, right) =>
        Number(left?.sortIndex ?? 0) - Number(right?.sortIndex ?? 0) ||
        String(left?.name || '').localeCompare(String(right?.name || '')),
    );
  const roomRows = [];
  const materialCountMap = {};

  for (const room of roomDetails) {
    const roomHrid = String(room?.hrid || '');
    if (!roomHrid) {
      continue;
    }

    const fromLevel = clampPositiveInteger(normalizedBase[roomHrid], 0);
    const toLevel = clampPositiveInteger(normalizedTarget[roomHrid], 0);
    if (toLevel <= fromLevel) {
      continue;
    }

    const roomMaterialCountMap = {};
    const upgradeCostsMap = isPlainObject(room?.upgradeCostsMap) ? room.upgradeCostsMap : {};

    for (let level = fromLevel + 1; level <= toLevel; level++) {
      const levelCosts = Array.isArray(upgradeCostsMap[String(level)]) ? upgradeCostsMap[String(level)] : [];
      for (const costEntry of levelCosts) {
        const itemHrid = String(costEntry?.itemHrid || '');
        const count = Math.max(0, toFiniteNumber(costEntry?.count, 0));
        if (!itemHrid || count <= 0) {
          continue;
        }

        roomMaterialCountMap[itemHrid] = toFiniteNumber(roomMaterialCountMap[itemHrid], 0) + count;
        materialCountMap[itemHrid] = toFiniteNumber(materialCountMap[itemHrid], 0) + count;
      }
    }

    const subtotal = Object.entries(roomMaterialCountMap).reduce((sum, [itemHrid, count]) => {
      const safeCount = Math.max(0, toFiniteNumber(count, 0));
      if (safeCount <= 0) {
        return sum;
      }
      const pricing = resolveHouseRoomMaterialPricing(itemHrid, pricingState);
      return sum + (pricing.priced ? safeCount * pricing.unitPrice : 0);
    }, 0);

    roomRows.push({
      roomHrid,
      fromLevel,
      toLevel,
      subtotal: toFiniteNumber(subtotal, 0),
    });
  }

  const materials = Object.entries(materialCountMap)
    .map(([itemHrid, count]) => {
      const safeCount = Math.max(0, toFiniteNumber(count, 0));
      const pricing = resolveHouseRoomMaterialPricing(itemHrid, pricingState);
      const subtotal = pricing.priced ? safeCount * pricing.unitPrice : 0;
      return {
        itemHrid,
        count: safeCount,
        unitPrice: pricing.unitPrice,
        subtotal: toFiniteNumber(subtotal, 0),
        priced: pricing.priced,
      };
    })
    .filter((entry) => entry.count > 0)
    .sort((left, right) => {
      if (left.itemHrid === '/items/coin' && right.itemHrid !== '/items/coin') {
        return -1;
      }
      if (right.itemHrid === '/items/coin' && left.itemHrid !== '/items/coin') {
        return 1;
      }
      return (
        Number(right.subtotal || 0) - Number(left.subtotal || 0) ||
        getIndexedItemName(left.itemHrid, left.itemHrid).localeCompare(
          getIndexedItemName(right.itemHrid, right.itemHrid),
        )
      );
    });

  const coinCost = materials.reduce((sum, entry) => (entry.itemHrid === '/items/coin' ? sum + entry.subtotal : sum), 0);
  const materialValue = materials.reduce(
    (sum, entry) => (entry.itemHrid !== '/items/coin' && entry.priced ? sum + entry.subtotal : sum),
    0,
  );

  return {
    rooms: roomRows,
    materials,
    totals: {
      coinCost: toFiniteNumber(coinCost, 0),
      materialValue: toFiniteNumber(materialValue, 0),
      totalCost: toFiniteNumber(coinCost + materialValue, 0),
    },
  };
}

export function computeQueueItemUpgradeCost(baselineSnapshot, targetSnapshot, pricingState, options = {}) {
  if (!baselineSnapshot || !targetSnapshot) {
    return 0;
  }

  const abilityCostMap = isPlainObject(options?.abilityCostMap) ? options.abilityCostMap : {};
  // 调用方（buildQueueItemCostInsights）传入的是 mergeConfirmedPricesAndSelections 的已归一化结果，
  // 下游 getConfirmedEquipmentPrice → buildConfirmedEquipmentPriceMap 已内置归一化（幂等），
  // 此处不再重复调用 normalizeConfirmedEquipmentPrices，避免对已归一化数据二次过滤导致潜在丢条目。
  const confirmedEquipmentPrices = Array.isArray(options?.confirmedEquipmentPrices)
    ? options.confirmedEquipmentPrices
    : [];
  let totalCost = 0;
  let hasUnknownEquipmentUpgradeCost = false;
  let hasUnknownAbilityUpgradeCost = false;

  for (const slotKey of EQUIPMENT_SLOT_KEYS) {
    const beforeEquipment = baselineSnapshot?.equipment?.[slotKey] ?? { itemHrid: '', enhancementLevel: 0 };
    const afterEquipment = targetSnapshot?.equipment?.[slotKey] ?? { itemHrid: '', enhancementLevel: 0 };
    const beforeItemHrid = String(beforeEquipment?.itemHrid || '');
    const afterItemHrid = String(afterEquipment?.itemHrid || '');
    const beforeLevel = Math.max(0, Math.floor(toFiniteNumber(beforeEquipment?.enhancementLevel, 0)));
    const afterLevel = Math.max(0, Math.floor(toFiniteNumber(afterEquipment?.enhancementLevel, 0)));

    if (beforeItemHrid === afterItemHrid && beforeLevel === afterLevel) {
      continue;
    }

    const estimatedCost = computeDefaultEquipmentTransitionCost(
      beforeItemHrid,
      beforeLevel,
      afterItemHrid,
      afterLevel,
      pricingState,
      confirmedEquipmentPrices,
      { saleSide: options?.saleSide },
    );

    if (estimatedCost == null || !Number.isFinite(Number(estimatedCost))) {
      hasUnknownEquipmentUpgradeCost = true;
      continue;
    }
    totalCost += Math.max(0, estimatedCost);
  }

  for (let i = 0; i < 5; i++) {
    const beforeAbility = baselineSnapshot?.abilities?.[i] ?? { abilityHrid: '', level: 1 };
    const afterAbility = targetSnapshot?.abilities?.[i] ?? { abilityHrid: '', level: 1 };
    const beforeHrid = String(beforeAbility?.abilityHrid || '');
    const afterHrid = String(afterAbility?.abilityHrid || '');
    const beforeLevel = Math.max(1, Math.floor(toFiniteNumber(beforeAbility?.level, 1)));
    const afterLevel = Math.max(1, Math.floor(toFiniteNumber(afterAbility?.level, 1)));

    if (!afterHrid) {
      continue;
    }

    const fromLevel = beforeHrid && beforeHrid === afterHrid ? beforeLevel : 1;
    if (afterLevel <= fromLevel) {
      continue;
    }

    const costKey = getAbilityUpgradeCostKey(i, afterHrid, fromLevel, afterLevel);
    const defaultCost = computeDefaultAbilityUpgradeCost(
      {
        abilityHrid: afterHrid,
        level: fromLevel,
      },
      afterLevel,
      pricingState,
    );
    let estimatedCost = null;
    if (Object.prototype.hasOwnProperty.call(abilityCostMap, costKey)) {
      estimatedCost = toFiniteNumber(abilityCostMap[costKey], 0);
    } else if (defaultCost == null) {
      hasUnknownAbilityUpgradeCost = true;
    } else {
      estimatedCost = toFiniteNumber(defaultCost, 0);
    }

    if (estimatedCost == null) {
      continue;
    }
    totalCost += Math.max(0, estimatedCost);
  }

  const houseRoomUpgradePreview = buildHouseRoomUpgradeCostPreview(
    baselineSnapshot?.houseRooms,
    targetSnapshot?.houseRooms,
    pricingState,
  );
  totalCost += Math.max(0, toFiniteNumber(houseRoomUpgradePreview?.totals?.totalCost, 0));

  if (hasUnknownEquipmentUpgradeCost || hasUnknownAbilityUpgradeCost) {
    return null;
  }

  return toFiniteNumber(totalCost, 0);
}

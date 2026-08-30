import { describe, expect, it } from 'vitest';
import { abilityBookInfoByAbilityHrid, houseRoomDetailIndex, itemDetailIndex } from '../../shared/gameDataIndex.js';
import { createEmptyPlayerConfig } from '../../shared/playerConfig.js';
import { PRICE_MODE_BID } from '../marketPriceService.js';
import { MARKET_HISTORY_PRICE_SOURCE } from '../marketHistoryService.js';
import {
  MANUAL_EQUIPMENT_PRICE_SOURCE,
  MANUAL_PRICE_WARNING_CODE,
  OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE,
} from '../queueScoring.js';
import {
  buildConfirmedEquipmentPriceMap,
  buildHouseRoomUpgradeCostPreview,
  buildQueueCostWarnings,
  computeDefaultAbilityUpgradeCost,
  computeMirrorPlan,
  computeQueueItemUpgradeCost,
  getAbilityUpgradeCostKey,
  getConfirmedEquipmentPrice,
  getConfirmedEquipmentPriceKey,
  inspectQueueEquipmentPricing,
  mergeConfirmedPricesAndSelections,
  normalizeConfirmedEquipmentPrices,
  normalizeQueuePriceSelections,
  QUEUE_PRICE_METHOD_MANUAL,
  QUEUE_PRICE_METHOD_MIRROR,
  resolveBaselineSaleQuote,
  resolveEquipmentTransitionPricing,
  resolveRecentTradeAverage,
} from '../queueUpgradeCost.js';

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createSnapshot() {
  return deepClone(createEmptyPlayerConfig('1'));
}

function findEquipmentForSlot(slotKey = 'head') {
  const typeHrid = `/equipment_types/${slotKey}`;
  const item = Object.values(itemDetailIndex || {}).find(
    (entry) =>
      entry?.categoryHrid === '/item_categories/equipment' && String(entry?.equipmentDetail?.type || '') === typeHrid,
  );
  return item?.hrid ?? '';
}

function findAbilityBookInfo() {
  const entry = Object.entries(abilityBookInfoByAbilityHrid || {}).find(
    ([, info]) => String(info?.itemHrid || '') && Number(info?.xpPerBook || 0) > 0,
  );
  if (!entry) {
    return null;
  }
  return {
    abilityHrid: entry[0],
    itemHrid: String(entry[1].itemHrid || ''),
    xpPerBook: Number(entry[1].xpPerBook || 0),
  };
}

function findHouseRoomWithLevel(level = 1) {
  return Object.values(houseRoomDetailIndex || {}).find(
    (entry) =>
      String(entry?.hrid || '') &&
      Array.isArray(entry?.upgradeCostsMap?.[String(level)]) &&
      entry.upgradeCostsMap[String(level)].length > 0,
  );
}

function buildPricingState(overrides = {}) {
  return {
    priceTable: {},
    enhancementQuotesByItem: {},
    dropMode: PRICE_MODE_BID,
    marketTimestamp: 1234,
    ...overrides,
  };
}

describe('queueUpgradeCost', () => {
  it('normalizes confirmed equipment prices and keeps manual entries without volume', () => {
    const itemHrid = findEquipmentForSlot('head');
    expect(itemHrid).toBeTruthy();

    const normalized = normalizeConfirmedEquipmentPrices([
      {
        itemHrid,
        enhancementLevel: '3',
        price: '500',
        volume: '8',
        source: OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE,
        marketTimestamp: '111',
      },
      {
        itemHrid,
        enhancementLevel: 3,
        price: 999,
        volume: 1,
        source: OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE,
      },
      {
        itemHrid,
        enhancementLevel: 4,
        price: '600',
        source: MANUAL_EQUIPMENT_PRICE_SOURCE,
      },
      {
        itemHrid,
        enhancementLevel: 5,
        price: '700',
        source: OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE,
      },
      {
        itemHrid: '',
        enhancementLevel: 1,
        price: 1,
        volume: 1,
      },
    ]);

    expect(normalized).toEqual([
      {
        itemHrid,
        enhancementLevel: 3,
        price: 500,
        volume: 8,
        source: OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE,
        marketTimestamp: 111,
        confirmedAt: 0,
      },
      {
        itemHrid,
        enhancementLevel: 4,
        price: 600,
        volume: null,
        source: MANUAL_EQUIPMENT_PRICE_SOURCE,
        marketTimestamp: 0,
        confirmedAt: 0,
      },
    ]);
    expect(getConfirmedEquipmentPrice(normalized, itemHrid, 3)?.price).toBe(500);
    expect(getConfirmedEquipmentPrice(normalized, itemHrid, 5)).toBeNull();
    const priceMap = buildConfirmedEquipmentPriceMap(normalized);
    expect(getConfirmedEquipmentPrice(priceMap, itemHrid, 3)?.price).toBe(500);
    expect(buildConfirmedEquipmentPriceMap(priceMap)).toBe(priceMap);
  });

  it('drops mirror confirmed entries without any valid input and keeps those with valid inputs', () => {
    const itemHrid = findEquipmentForSlot('head');
    expect(itemHrid).toBeTruthy();

    // 与 normalizeQueuePriceSelections / findInvalidPriceSelection 同一过滤口径：
    // inputs 归一化后为空（空数组或仅含无效输入件）的 mirror 快照视为损坏，丢弃。
    const normalized = normalizeConfirmedEquipmentPrices([
      {
        itemHrid,
        enhancementLevel: 3,
        price: 500,
        source: 'mirror',
        mirrorPrice: 50,
        mirrorCount: 2,
        inputs: [],
      },
      {
        itemHrid,
        enhancementLevel: 4,
        price: 600,
        source: 'mirror',
        mirrorPrice: 60,
        mirrorCount: 2,
        inputs: [
          { level: 1, count: 2, price: 200, source: 'ask' },
          { level: 0, count: 1, price: 999 },
          { level: 2, count: 1, price: 0 },
        ],
      },
    ]);

    expect(normalized).toEqual([
      {
        itemHrid,
        enhancementLevel: 4,
        price: 600,
        volume: null,
        source: 'mirror',
        marketTimestamp: 0,
        confirmedAt: 0,
        mirrorPrice: 60,
        mirrorCount: 2,
        inputs: [{ level: 1, count: 2, price: 200, source: 'ask' }],
        usedBaselineLevels: [],
      },
    ]);
    // 空输入 mirror 条目被丢弃后，confirmed 查不到该 key，由其他价格链回退。
    expect(getConfirmedEquipmentPrice(normalized, itemHrid, 3)).toBeNull();
    expect(getConfirmedEquipmentPrice(normalized, itemHrid, 4)?.price).toBe(600);
  });

  it('aligns selection normalization with confirmed normalization: hourly entries require volume', () => {
    const itemHrid = findEquipmentForSlot('head');
    expect(itemHrid).toBeTruthy();

    // 与 normalizeConfirmedEquipmentPrices 同一接受口径：official_hourly_average 条目必须携带 volume > 0，
    // 否则在归一化入口即被过滤（参考价链的官方小时均价恒带 volume，resolveRecentTradeAverage 对 volume<=0 返回 null）。
    const normalized = normalizeQueuePriceSelections([
      {
        itemHrid,
        enhancementLevel: 3,
        method: 'left1',
        price: 500,
        source: OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE,
        volume: 8,
      },
      { itemHrid, enhancementLevel: 4, method: 'left1', price: 600, source: OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE },
      { itemHrid, enhancementLevel: 5, method: 'left1', price: 700, source: 'ask' },
    ]);

    expect(normalized).toEqual([
      {
        itemHrid,
        enhancementLevel: 3,
        method: 'left1',
        price: 500,
        volume: 8,
        source: OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE,
        marketTimestamp: 0,
        confirmedAt: expect.any(Number),
      },
      {
        itemHrid,
        enhancementLevel: 5,
        method: 'left1',
        price: 700,
        volume: null,
        source: 'ask',
        marketTimestamp: 0,
        confirmedAt: expect.any(Number),
      },
    ]);
  });

  it('keeps merge output closed under the downstream confirmed normalization (no entry lost)', () => {
    const itemHrid = findEquipmentForSlot('head');
    expect(itemHrid).toBeTruthy();

    const item = {
      priceSelections: [
        { itemHrid, enhancementLevel: 2, method: 'left1', price: 410, source: 'ask', confirmedAt: 100 },
        {
          itemHrid,
          enhancementLevel: 3,
          method: 'left1',
          price: 500,
          source: OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE,
          volume: 8,
          marketTimestamp: 111,
          confirmedAt: 100,
        },
        { itemHrid, enhancementLevel: 4, method: 'manual', price: 600, confirmedAt: 100 },
        {
          itemHrid,
          enhancementLevel: 5,
          method: 'mirror',
          price: 700,
          mirrorPrice: 40,
          mirrorCount: 3,
          inputs: [{ level: 1, count: 2, price: 200, source: 'ask' }],
          confirmedAt: 100,
        },
      ],
      confirmedEquipmentPrices: [],
    };

    // merge 拼接结果必须对下游 normalizeConfirmedEquipmentPrices（buildConfirmedEquipmentPriceMap
    // 内建二次归一化）幂等：逐条相等，否则 first-wins 优先级会被二次过滤破坏。
    const merged = mergeConfirmedPricesAndSelections(item);
    expect(merged.length).toBe(4);
    expect(normalizeConfirmedEquipmentPrices(merged)).toEqual(merged);
  });

  it('keeps a valid selection row even when an invalid duplicate row precedes it (first-valid-wins)', () => {
    const itemHrid = findEquipmentForSlot('head');
    expect(itemHrid).toBeTruthy();

    // 与 normalizeConfirmedEquipmentPrices 的去重顺序一致：先校验有效、再占坑 seen，
    // 同 key 首条无效（manual price 非正整数）不得连坐丢弃后续有效条目（持久化数据损坏场景）。
    const normalized = normalizeQueuePriceSelections([
      { itemHrid, enhancementLevel: 3, method: 'manual', price: 0 },
      { itemHrid, enhancementLevel: 3, method: 'manual', price: 777, confirmedAt: 100 },
    ]);
    expect(normalized).toEqual([
      {
        itemHrid,
        enhancementLevel: 3,
        method: 'manual',
        price: 777,
        volume: null,
        source: MANUAL_EQUIPMENT_PRICE_SOURCE,
        marketTimestamp: 0,
        confirmedAt: 100,
      },
    ]);
  });

  it('keeps the first valid mirror row when the leading duplicate row has no valid inputs', () => {
    const itemHrid = findEquipmentForSlot('head');
    expect(itemHrid).toBeTruthy();

    const normalized = normalizeQueuePriceSelections([
      {
        itemHrid,
        enhancementLevel: 4,
        method: 'mirror',
        price: 600,
        mirrorPrice: 40,
        mirrorCount: 2,
        inputs: [],
      },
      {
        itemHrid,
        enhancementLevel: 4,
        method: 'mirror',
        price: 600,
        mirrorPrice: 40,
        mirrorCount: 2,
        inputs: [{ level: 1, count: 2, price: 200, source: 'ask' }],
        confirmedAt: 100,
      },
    ]);
    expect(normalized).toEqual([
      {
        itemHrid,
        enhancementLevel: 4,
        method: 'mirror',
        price: 600,
        volume: null,
        source: 'mirror',
        marketTimestamp: 0,
        confirmedAt: 100,
        mirrorPrice: 40,
        mirrorCount: 2,
        inputs: [{ level: 1, count: 2, price: 200, source: 'ask' }],
        usedBaselineLevels: [],
      },
    ]);

    // 两条均有效时仍为 first-wins：保留首条，后续重复行被去重。
    const bothValid = normalizeQueuePriceSelections([
      { itemHrid, enhancementLevel: 3, method: 'manual', price: 111, confirmedAt: 50 },
      { itemHrid, enhancementLevel: 3, method: 'manual', price: 222, confirmedAt: 90 },
    ]);
    expect(bothValid).toHaveLength(1);
    expect(bothValid[0].price).toBe(111);
  });

  it('merge recovers a valid selection preceded by an invalid duplicate row of the same key', () => {
    const itemHrid = findEquipmentForSlot('head');
    expect(itemHrid).toBeTruthy();

    const merged = mergeConfirmedPricesAndSelections({
      priceSelections: [
        { itemHrid, enhancementLevel: 3, method: 'manual', price: 0 },
        { itemHrid, enhancementLevel: 3, method: 'manual', price: 777, confirmedAt: 100 },
      ],
      confirmedEquipmentPrices: [],
    });
    expect(merged).toEqual([
      {
        itemHrid,
        enhancementLevel: 3,
        method: 'manual',
        price: 777,
        volume: null,
        source: MANUAL_EQUIPMENT_PRICE_SOURCE,
        marketTimestamp: 0,
        confirmedAt: 100,
      },
    ]);
    // merge 输出对下游二次归一化保持闭包：不丢条目。
    expect(normalizeConfirmedEquipmentPrices(merged)).toEqual(merged);
  });

  it('uses exact asks first, confirmed prices second, and reports missing equipment asks', () => {
    const headItemHrid = findEquipmentForSlot('head');
    const bodyItemHrid = findEquipmentForSlot('body');
    expect(headItemHrid).toBeTruthy();
    expect(bodyItemHrid).toBeTruthy();

    const pricingState = buildPricingState({
      enhancementQuotesByItem: {
        [headItemHrid]: {
          2: { ask: 1000, bid: 100 },
        },
        [bodyItemHrid]: {
          3: { ask: -1, bid: -1 },
        },
      },
    });
    const manualConfirmations = [
      {
        itemHrid: bodyItemHrid,
        enhancementLevel: 3,
        price: 800,
        source: MANUAL_EQUIPMENT_PRICE_SOURCE,
      },
    ];

    expect(resolveEquipmentTransitionPricing('', 0, headItemHrid, 2, pricingState).cost).toBe(1000);
    expect(resolveEquipmentTransitionPricing('', 0, bodyItemHrid, 3, pricingState, manualConfirmations)).toMatchObject({
      cost: 800,
      targetAsk: 800,
      targetAskAvailable: true,
      targetPriceSource: MANUAL_EQUIPMENT_PRICE_SOURCE,
    });
    expect(resolveEquipmentTransitionPricing('', 0, bodyItemHrid, 4, pricingState)).toMatchObject({
      cost: null,
      targetAsk: null,
      targetAskAvailable: false,
      targetPriceSource: 'missing',
    });
  });

  it('falls back to exact ask when a user-locked method carries a non-positive price (corrupted persisted data)', () => {
    const headItemHrid = findEquipmentForSlot('head');
    expect(headItemHrid).toBeTruthy();

    const pricingState = buildPricingState({
      enhancementQuotesByItem: {
        [headItemHrid]: {
          2: { ask: 1000, bid: 100 },
        },
      },
    });

    // 模拟持久化数据损坏：method 为用户锁定方式但 price 已变为 0。
    // 直接构造 Map 以绕过 normalizeConfirmedEquipmentPrices 的 price<=0 过滤，
    // 复现 getConfirmedEquipmentPrice 对 Map 直传、跳过归一化的路径。
    const corruptedLockedPriceMap = new Map([
      [
        getConfirmedEquipmentPriceKey(headItemHrid, 2),
        {
          itemHrid: headItemHrid,
          enhancementLevel: 2,
          method: QUEUE_PRICE_METHOD_MANUAL,
          price: 0,
          source: MANUAL_EQUIPMENT_PRICE_SOURCE,
        },
      ],
    ]);

    expect(
      resolveEquipmentTransitionPricing('', 0, headItemHrid, 2, pricingState, corruptedLockedPriceMap),
    ).toMatchObject({
      cost: 1000,
      targetAsk: 1000,
      targetAskAvailable: true,
      targetPriceSource: 'ask',
    });
  });

  it('builds queue equipment inspections and price warnings from confirmed sources', () => {
    const headItemHrid = findEquipmentForSlot('head');
    const bodyItemHrid = findEquipmentForSlot('body');
    expect(headItemHrid).toBeTruthy();
    expect(bodyItemHrid).toBeTruthy();

    const baseline = createSnapshot();
    const target = createSnapshot();
    baseline.equipment.head = {
      itemHrid: headItemHrid,
      enhancementLevel: 1,
    };
    target.equipment.head = {
      itemHrid: bodyItemHrid,
      enhancementLevel: 2,
    };

    const inspections = inspectQueueEquipmentPricing(baseline, target, buildPricingState(), [
      {
        itemHrid: bodyItemHrid,
        enhancementLevel: 2,
        price: 1500,
        source: MARKET_HISTORY_PRICE_SOURCE,
      },
    ]);

    expect(inspections).toHaveLength(1);
    expect(inspections[0]).toMatchObject({
      slotKey: 'head',
      beforeItemHrid: headItemHrid,
      afterItemHrid: bodyItemHrid,
      beforeLevel: 1,
      afterLevel: 2,
      targetAskAvailable: true,
      targetPriceSource: MARKET_HISTORY_PRICE_SOURCE,
      baselineSaleZero: true,
    });

    expect(buildQueueCostWarnings(inspections)).toEqual([
      expect.objectContaining({
        code: 'baseline_sale_zero',
        slotKey: 'head',
        itemHrid: headItemHrid,
        enhancementLevel: 1,
      }),
      expect.objectContaining({
        code: MARKET_HISTORY_PRICE_SOURCE,
        source: MARKET_HISTORY_PRICE_SOURCE,
        slotKey: 'head',
        itemHrid: bodyItemHrid,
        enhancementLevel: 2,
        price: 1500,
      }),
    ]);

    const manualWarnings = buildQueueCostWarnings([
      {
        targetPriceSource: MANUAL_EQUIPMENT_PRICE_SOURCE,
        confirmedPrice: { price: 222, volume: null, marketTimestamp: 0 },
        slotKey: 'body',
        afterItemHrid: bodyItemHrid,
        afterLevel: 4,
      },
    ]);
    expect(manualWarnings).toEqual([
      expect.objectContaining({
        code: MANUAL_PRICE_WARNING_CODE,
        source: MANUAL_EQUIPMENT_PRICE_SOURCE,
        price: 222,
      }),
    ]);
  });

  it('reuses indexed confirmed equipment prices while inspecting multiple slots', () => {
    const headItemHrid = findEquipmentForSlot('head');
    const bodyItemHrid = findEquipmentForSlot('body');
    const legsItemHrid = findEquipmentForSlot('legs');
    expect(headItemHrid).toBeTruthy();
    expect(bodyItemHrid).toBeTruthy();
    expect(legsItemHrid).toBeTruthy();

    const baseline = createSnapshot();
    const target = createSnapshot();
    target.equipment.head = {
      itemHrid: headItemHrid,
      enhancementLevel: 2,
    };
    target.equipment.body = {
      itemHrid: bodyItemHrid,
      enhancementLevel: 3,
    };
    target.equipment.legs = {
      itemHrid: legsItemHrid,
      enhancementLevel: 4,
    };

    const confirmedPriceMap = buildConfirmedEquipmentPriceMap([
      {
        itemHrid: headItemHrid,
        enhancementLevel: 2,
        price: 1100,
        source: MANUAL_EQUIPMENT_PRICE_SOURCE,
      },
      {
        itemHrid: bodyItemHrid,
        enhancementLevel: 3,
        price: 2200,
        source: MANUAL_EQUIPMENT_PRICE_SOURCE,
      },
      {
        itemHrid: legsItemHrid,
        enhancementLevel: 4,
        price: 3300,
        source: MANUAL_EQUIPMENT_PRICE_SOURCE,
      },
    ]);

    const inspections = inspectQueueEquipmentPricing(baseline, target, buildPricingState(), confirmedPriceMap);

    expect(inspections).toHaveLength(3);
    expect(inspections.map((inspection) => inspection.targetAsk)).toEqual([1100, 2200, 3300]);
    expect(inspections.map((inspection) => inspection.targetPriceSource)).toEqual([
      MANUAL_EQUIPMENT_PRICE_SOURCE,
      MANUAL_EQUIPMENT_PRICE_SOURCE,
      MANUAL_EQUIPMENT_PRICE_SOURCE,
    ]);
  });

  it('computes ability upgrade cost from reference globals and book prices', () => {
    const abilityBookInfo = findAbilityBookInfo();
    expect(abilityBookInfo).toBeTruthy();

    const globalRef = globalThis;
    const previousTable = globalRef.jigsLevelExperienceTable;
    const previousBookMap = globalRef.jigsSpellBookXpByName;

    try {
      globalRef.jigsLevelExperienceTable = [0, 0, 100, 250];
      globalRef.jigsSpellBookXpByName = {};
      const pricingState = buildPricingState({
        dropMode: PRICE_MODE_BID,
        priceTable: {
          [abilityBookInfo.itemHrid]: {
            ask: 9,
            bid: 7,
            vendor: 1,
          },
        },
      });

      expect(
        computeDefaultAbilityUpgradeCost(
          {
            abilityHrid: abilityBookInfo.abilityHrid,
            level: 1,
          },
          3,
          pricingState,
        ),
      ).toBe(Math.ceil(250 / abilityBookInfo.xpPerBook) * 7);
    } finally {
      if (previousTable === undefined) {
        delete globalRef.jigsLevelExperienceTable;
      } else {
        globalRef.jigsLevelExperienceTable = previousTable;
      }
      if (previousBookMap === undefined) {
        delete globalRef.jigsSpellBookXpByName;
      } else {
        globalRef.jigsSpellBookXpByName = previousBookMap;
      }
    }
  });

  it('combines equipment, custom ability, and house-room costs for queue items', () => {
    const equipmentHrid = findEquipmentForSlot('head');
    const abilityBookInfo = findAbilityBookInfo();
    const room = findHouseRoomWithLevel(1);
    expect(equipmentHrid).toBeTruthy();
    expect(abilityBookInfo).toBeTruthy();
    expect(room).toBeTruthy();

    const baseline = createSnapshot();
    const target = createSnapshot();
    target.equipment.head = {
      itemHrid: equipmentHrid,
      enhancementLevel: 2,
    };
    target.abilities[0] = {
      abilityHrid: abilityBookInfo.abilityHrid,
      level: 4,
    };
    target.houseRooms[room.hrid] = 1;

    const pricingState = buildPricingState({
      enhancementQuotesByItem: {
        [equipmentHrid]: {
          2: { ask: 1200, bid: -1 },
        },
      },
      priceTable: Object.fromEntries(
        (room.upgradeCostsMap['1'] || []).map((entry) => [
          entry.itemHrid,
          {
            ask: String(entry.itemHrid || '') === '/items/coin' ? 1 : 10,
            bid: -1,
            vendor: String(entry.itemHrid || '') === '/items/coin' ? 1 : 0,
          },
        ]),
      ),
    });
    const housePreview = buildHouseRoomUpgradeCostPreview(baseline.houseRooms, target.houseRooms, pricingState);
    const abilityCostKey = getAbilityUpgradeCostKey(0, abilityBookInfo.abilityHrid, 1, 4);

    expect(
      computeQueueItemUpgradeCost(baseline, target, pricingState, {
        abilityCostMap: {
          [abilityCostKey]: 345,
        },
      }),
    ).toBe(1200 + 345 + housePreview.totals.totalCost);
  });

  it('resolves recent trade averages from the cached enhancement quote table', () => {
    const equipmentHrid = findEquipmentForSlot('head');
    expect(equipmentHrid).toBeTruthy();

    expect(
      resolveRecentTradeAverage(
        buildPricingState({
          marketTimestamp: 777,
          enhancementQuotesByItem: {
            [equipmentHrid]: {
              5: {
                averagePrice: 456,
                volume: 12,
              },
            },
          },
        }),
        equipmentHrid,
        5,
      ),
    ).toEqual({
      itemHrid: equipmentHrid,
      enhancementLevel: 5,
      price: 456,
      volume: 12,
      source: OFFICIAL_HOURLY_AVERAGE_PRICE_SOURCE,
      marketTimestamp: 777,
    });
  });

  it('keeps the mirror plan uncomputable while input prices are missing and recovers via manual input prices', () => {
    const itemHrid = findEquipmentForSlot('head');
    expect(itemHrid).toBeTruthy();

    const pricingState = buildPricingState({
      enhancementQuotesByItem: {
        [itemHrid]: {
          1: { ask: -1, bid: -1 },
          2: { ask: 1000, bid: 100 },
          3: { ask: 5000, bid: 100 },
        },
      },
    });

    // +1 缺价 -> 合成不可算：目标级必须走镜子路线才有成本（直购价不冒充镜子成本），
    // 同时把 +1（镜像的直接输入级）列为缺价，补上即可解锁合成路径。
    const collapsed = computeMirrorPlan({
      itemHrid,
      targetLevel: 3,
      pricingState,
      mirrorPrice: 50,
    });
    expect(collapsed.method).toBe('direct');
    expect(collapsed.cost).toBeNull();
    expect(collapsed.mirrorCount).toBe(0);
    // 软缺价条目 count 为 null：补价前 +1 在展开树中的真实需求份数取决于所补价格，
    // 提示固定份数会低估（补价后 +2 改走镜子合成，实际需要 2 份 +1，见下方 recovered.inputs）。
    expect(collapsed.missing).toEqual([{ level: 1, count: null }]);
    expect(collapsed.inputs).toEqual([{ level: 3, count: 1, price: 5000, source: 'ask', totalCost: 5000 }]);

    // 手动补上 +1 的价格后，方案可算且输入件标记为手动来源。
    const recovered = computeMirrorPlan({
      itemHrid,
      targetLevel: 3,
      pricingState,
      mirrorPrice: 50,
      manualInputPrices: { 1: 200 },
    });
    expect(recovered.cost).toBe(500);
    expect(recovered.method).toBe('mirror');
    expect(recovered.mirrorCount).toBe(2);
    expect(recovered.inputs).toEqual([
      { level: 1, count: 2, price: 200, source: MANUAL_EQUIPMENT_PRICE_SOURCE, totalCost: 400 },
    ]);
    expect(recovered.missing).toEqual([]);
  });

  it('does not report priced child inputs as missing when the auto mirror price is unavailable', () => {
    const itemHrid = findEquipmentForSlot('head');
    expect(itemHrid).toBeTruthy();

    // 子级输入件 +1/+2 与目标 +3 都有精确 Ask 价，唯独镜子自动价缺失（mirrorPrice = null）。
    // evalMirror 在递归入口短路后子级不会被算入 memo，软缺价检测不得把"未计算"当成"缺价"。
    const pricingState = buildPricingState({
      enhancementQuotesByItem: {
        [itemHrid]: {
          1: { ask: 100, bid: 50 },
          2: { ask: 1000, bid: 50 },
          3: { ask: 5000, bid: 50 },
        },
      },
    });

    // 方案因镜子价缺失不可算（cost 为 null，确认按钮仍会被拦下），
    // 但不应把实际有价的子级输入件误报为缺价；镜子价的补填由弹窗顶部的共享输入引导。
    const plan = computeMirrorPlan({
      itemHrid,
      targetLevel: 3,
      pricingState,
      mirrorPrice: null,
    });
    expect(plan.cost).toBeNull();
    expect(plan.method).toBe('direct');
    expect(plan.missing).toEqual([]);

    // 目标级也缺价时，直购兜底路径的硬缺价提示保留目标级本身，但依旧不列入有价的子级。
    const fullyMissing = computeMirrorPlan({
      itemHrid,
      targetLevel: 3,
      pricingState: buildPricingState({ enhancementQuotesByItem: {} }),
      mirrorPrice: null,
    });
    expect(fullyMissing.cost).toBeNull();
    expect(fullyMissing.missing).toEqual([{ level: 3, count: 1 }]);
  });

  it('treats a non-positive mirror price as unavailable instead of free mirrors', () => {
    const itemHrid = findEquipmentForSlot('head');
    expect(itemHrid).toBeTruthy();

    // 输入件 +1/+2 与目标 +3 都有精确 Ask 价，但镜子价被传入 0 或负数。
    // 守卫必须与 mirrorPrice = null 一致地短路：镜子不可用即方案不可算，
    // 不能把镜子当免费（0）甚至倒贴（负值），产出低于所有直购价的合成成本。
    const pricingState = buildPricingState({
      enhancementQuotesByItem: {
        [itemHrid]: {
          1: { ask: 100, bid: 50 },
          2: { ask: 1000, bid: 50 },
          3: { ask: 5000, bid: 50 },
        },
      },
    });

    for (const mirrorPrice of [0, -5]) {
      const plan = computeMirrorPlan({
        itemHrid,
        targetLevel: 3,
        pricingState,
        mirrorPrice,
      });
      expect(plan.cost).toBeNull();
      expect(plan.method).toBe('direct');
      expect(plan.mirrorCount).toBe(0);
      expect(plan.missing).toEqual([]);
    }
  });

  it('keeps soft missing counts unknown (null) while hard and fallback counts stay exact', () => {
    const itemHrid = findEquipmentForSlot('head');
    expect(itemHrid).toBeTruthy();

    // 软缺价：目标 +3 未走镜子，直接输入级 +1 取不到价 -> 列为缺价但份数未知（count: null）。
    const soft = computeMirrorPlan({
      itemHrid,
      targetLevel: 3,
      pricingState: buildPricingState({
        enhancementQuotesByItem: {
          [itemHrid]: {
            1: { ask: -1, bid: -1 },
            2: { ask: 1000, bid: 100 },
            3: { ask: 5000, bid: 100 },
          },
        },
      }),
      mirrorPrice: 50,
    });
    expect(soft.missing).toEqual([{ level: 1, count: null }]);

    // 补价后份数由展开路径精确给出：+2 改走镜子合成，实际需要 2 份 +1。
    const recovered = computeMirrorPlan({
      itemHrid,
      targetLevel: 3,
      pricingState: buildPricingState({
        enhancementQuotesByItem: {
          [itemHrid]: {
            1: { ask: -1, bid: -1 },
            2: { ask: 1000, bid: 100 },
            3: { ask: 5000, bid: 100 },
          },
        },
      }),
      mirrorPrice: 50,
      manualInputPrices: { 1: 200 },
    });
    expect(recovered.missing).toEqual([]);
    expect(recovered.inputs).toEqual([
      { level: 1, count: 2, price: 200, source: MANUAL_EQUIPMENT_PRICE_SOURCE, totalCost: 400 },
    ]);

    // 兜底：方案完全不可算且无任何缺价提示时，目标级本身作为直购件列为缺价，份数确定为 1。
    const fallback = computeMirrorPlan({
      itemHrid,
      targetLevel: 3,
      pricingState: buildPricingState({ enhancementQuotesByItem: {} }),
      mirrorPrice: null,
    });
    expect(fallback.missing).toEqual([{ level: 3, count: 1 }]);
  });

  it('keeps the missing list to the direct mirror input levels for a high-level target', () => {
    const itemHrid = findEquipmentForSlot('head');
    expect(itemHrid).toBeTruthy();

    // 用户场景：基准 +10 → 目标 +13（跨 3 级）。镜子方案只能跨一级，因此不可用。
    // +1..+9 全部缺价，+10/+12 有价，+11 与 +13 缺价。
    const pricingState = buildPricingState({
      enhancementQuotesByItem: {
        [itemHrid]: {
          10: { ask: 1000, bid: 100 },
          12: { ask: 7000, bid: 100 },
        },
      },
    });

    // 跨级超过 1：镜子方案标记为不可用，cost 为 null，无缺价提示（方案本身被禁用）。
    const collapsed = computeMirrorPlan({
      itemHrid,
      targetLevel: 13,
      baselineLevel: 10,
      pricingState,
      mirrorPrice: 50,
    });
    expect(collapsed.method).toBe('direct');
    expect(collapsed.cost).toBeNull();
    expect(collapsed.unavailable).toBe(true);
    expect(collapsed.mirrorCount).toBe(0);
    expect(collapsed.missing).toEqual([]);

    // 即便手动补 +11，跨级过大仍然不可用。
    const recovered = computeMirrorPlan({
      itemHrid,
      targetLevel: 13,
      baselineLevel: 10,
      pricingState,
      mirrorPrice: 50,
      manualInputPrices: { 11: 5000 },
    });
    expect(recovered.cost).toBeNull();
    expect(recovered.method).toBe('direct');
    expect(recovered.unavailable).toBe(true);
    expect(recovered.mirrorCount).toBe(0);

    // 只补目标级价格同样不可用。
    const directFill = computeMirrorPlan({
      itemHrid,
      targetLevel: 13,
      baselineLevel: 10,
      pricingState,
      mirrorPrice: 50,
      manualInputPrices: { 13: 9000 },
    });
    expect(directFill.method).toBe('direct');
    expect(directFill.cost).toBeNull();
    expect(directFill.unavailable).toBe(true);
    expect(directFill.mirrorCount).toBe(0);
  });

  it('marks the mirror plan unavailable when the target is at or below the baseline level', () => {
    const itemHrid = findEquipmentForSlot('head');
    expect(itemHrid).toBeTruthy();

    // 用户场景：同款降级（基准 +12 → 目标 +10）。基准件只会顶替 l === baseline 的递归
    // 节点，目标级低于基准时合成树从不触及基准级，基准件无法顶替任何输入；
    // 按普通合成计价会误导用户，方案应整体禁用（unavailable 且无缺价提示）。
    const pricingState = buildPricingState({
      enhancementQuotesByItem: {
        [itemHrid]: {
          8: { ask: 2000, bid: 100 },
          9: { ask: 3000, bid: 100 },
          10: { ask: 5000, bid: 100 },
        },
      },
    });

    const downgrade = computeMirrorPlan({
      itemHrid,
      targetLevel: 10,
      baselineLevel: 12,
      pricingState,
      mirrorPrice: 50,
    });
    expect(downgrade.method).toBe('direct');
    expect(downgrade.cost).toBeNull();
    expect(downgrade.unavailable).toBe(true);
    expect(downgrade.mirrorCount).toBe(0);
    expect(downgrade.missing).toEqual([]);

    // 同级（API 直调；UI 流程中同 hrid 同等级的行已被变更检测过滤）：同样不可用，
    // 避免按"从零合成目标级"计价。用户已持有该等级的成品，镜子合成无语义。
    const sameLevel = computeMirrorPlan({
      itemHrid,
      targetLevel: 10,
      baselineLevel: 10,
      pricingState,
      mirrorPrice: 50,
    });
    expect(sameLevel.method).toBe('direct');
    expect(sameLevel.cost).toBeNull();
    expect(sameLevel.unavailable).toBe(true);
    expect(sameLevel.mirrorCount).toBe(0);
  });

  it('allows the mirror plan when the target is exactly one level above the baseline', () => {
    const itemHrid = findEquipmentForSlot('head');
    expect(itemHrid).toBeTruthy();

    // 用户场景：基准 +12 → 目标 +13（跨 1 级），镜子方案可用。
    // +11 缺价（需手动补），+12 有价（由基准顶替，成本 0），+13 缺价。
    const pricingState = buildPricingState({
      enhancementQuotesByItem: {
        [itemHrid]: {
          12: { ask: 7000, bid: 100 },
        },
      },
    });

    // 缺 +11 时方案不可算，缺价提示只列 +11（目标级镜像的直接输入级）。
    const collapsed = computeMirrorPlan({
      itemHrid,
      targetLevel: 13,
      baselineLevel: 12,
      pricingState,
      mirrorPrice: 50,
    });
    expect(collapsed.method).toBe('direct');
    expect(collapsed.cost).toBeNull();
    expect(collapsed.unavailable).toBe(false);
    // 软缺价条目不携带确定份数（count 为 null）。
    expect(collapsed.missing).toEqual([{ level: 11, count: null }]);

    // 手动补 +11 后方案可算：13 = 11 + 12(基准) + 镜子。
    const recovered = computeMirrorPlan({
      itemHrid,
      targetLevel: 13,
      baselineLevel: 12,
      pricingState,
      mirrorPrice: 50,
      manualInputPrices: { 11: 5000 },
    });
    expect(recovered.cost).toBe(5050);
    expect(recovered.method).toBe('mirror');
    expect(recovered.mirrorCount).toBe(1);
    expect(recovered.unavailable).toBe(false);
    expect(recovered.missing).toEqual([]);
    expect(recovered.usedBaselineLevels).toEqual([12]);
    expect(recovered.inputs).toEqual([
      { level: 11, count: 1, price: 5000, source: MANUAL_EQUIPMENT_PRICE_SOURCE, totalCost: 5000 },
    ]);
  });

  it('synthesizes one level above the baseline using the baseline piece for free', () => {
    const itemHrid = findEquipmentForSlot('head');
    expect(itemHrid).toBeTruthy();

    // 基准 +10 → 目标 +11：+11 = +9 + +10 + 镜子，+10 由基准顶替（成本 0），只需 +9 与镜子。
    // +10 故意缺市场价：由基准顶替，不应阻断方案。
    const pricingState = buildPricingState({
      enhancementQuotesByItem: {
        [itemHrid]: {
          9: { ask: 3000, bid: 100 },
        },
      },
    });

    const plan = computeMirrorPlan({
      itemHrid,
      targetLevel: 11,
      baselineLevel: 10,
      pricingState,
      mirrorPrice: 50,
    });
    expect(plan.method).toBe('mirror');
    expect(plan.cost).toBe(3050);
    expect(plan.mirrorCount).toBe(1);
    expect(plan.missing).toEqual([]);
    expect(plan.usedBaselineLevels).toEqual([10]);
    expect(plan.inputs).toEqual([{ level: 9, count: 1, price: 3000, source: 'ask', totalCost: 3000 }]);

    // 缺 +9 价格时列为唯一缺价输入，补上即可解锁。
    const waiting = computeMirrorPlan({
      itemHrid,
      targetLevel: 11,
      baselineLevel: 10,
      pricingState: buildPricingState({ enhancementQuotesByItem: {} }),
      mirrorPrice: 50,
    });
    expect(waiting.cost).toBeNull();
    // 软缺价条目不携带确定份数（count 为 null）。
    expect(waiting.missing).toEqual([{ level: 9, count: null }]);
  });

  it('uses mirror synthesis to work around a missing mid-level instead of blocking', () => {
    const itemHrid = findEquipmentForSlot('head');
    expect(itemHrid).toBeTruthy();

    const pricingState = buildPricingState({
      enhancementQuotesByItem: {
        [itemHrid]: {
          1: { ask: 100, bid: 50 },
          2: { ask: 1000, bid: 50 },
          3: { ask: -1, bid: -1 },
          4: { ask: 5000, bid: 50 },
        },
      },
    });

    const plan = computeMirrorPlan({
      itemHrid,
      targetLevel: 4,
      pricingState,
      mirrorPrice: 50,
    });
    // +3 缺价但可由 +1 + +2 + 镜子 合成，方案仍然可算，其余输入自动取价。
    expect(plan.cost).toBe(500);
    expect(plan.mirrorCount).toBe(4);
    expect(plan.missing).toEqual([]);
    expect(plan.inputs.every((input) => String(input.source) !== MANUAL_EQUIPMENT_PRICE_SOURCE)).toBe(true);
  });

  it('uses mirror synthesis cost as buyCost when the user-locked method is mirror', () => {
    const itemHrid = findEquipmentForSlot('head');
    expect(itemHrid).toBeTruthy();

    // 市场精确 ask 价为 5000；用户在弹窗中选定镜子方案，合成价为 500（远低于市场 ask）。
    // resolveEquipmentTransitionPricing 应当使用 userLockedMethod 的合成价作为 buyCost，
    // 而不是用市场精确 ask 价覆盖，targetPriceSource 应为 'mirror'。
    const pricingState = buildPricingState({
      enhancementQuotesByItem: {
        [itemHrid]: {
          1: { ask: 100, bid: 50 },
          2: { ask: 1000, bid: 50 },
          3: { ask: 5000, bid: 50 },
        },
      },
    });

    // 通过 buildConfirmedEquipmentPriceMap 构造一个 method='mirror' 的确认价格条目，
    // 隐式验证 normalizeConfirmedEquipmentPrices 对 mirror 条目的保留逻辑。
    const confirmedPriceMap = buildConfirmedEquipmentPriceMap([
      {
        itemHrid,
        enhancementLevel: 3,
        method: QUEUE_PRICE_METHOD_MIRROR,
        price: 500,
        source: 'mirror',
        mirrorPrice: 50,
        mirrorCount: 2,
        inputs: [{ level: 1, count: 2, price: 200, source: MANUAL_EQUIPMENT_PRICE_SOURCE }],
        usedBaselineLevels: [],
      },
    ]);

    const pricing = resolveEquipmentTransitionPricing('', 0, itemHrid, 3, pricingState, confirmedPriceMap);
    expect(pricing).toMatchObject({
      cost: 500,
      targetAsk: 500,
      targetAskAvailable: true,
      targetPriceSource: 'mirror',
    });
    // 关键断言：buyCost 使用镜子合成价 500，而非市场 ask 价 5000。
    expect(pricing.targetAsk).not.toBe(5000);

    // 当 mirror 锁定价损坏（price <= 0）时，应回退到 exactAsk 链，避免误报缺价。
    const corruptedMap = new Map([
      [
        getConfirmedEquipmentPriceKey(itemHrid, 3),
        {
          itemHrid,
          enhancementLevel: 3,
          method: QUEUE_PRICE_METHOD_MIRROR,
          price: 0,
          source: 'mirror',
        },
      ],
    ]);
    const fallbackPricing = resolveEquipmentTransitionPricing('', 0, itemHrid, 3, pricingState, corruptedMap);
    expect(fallbackPricing).toMatchObject({
      cost: 5000,
      targetAsk: 5000,
      targetPriceSource: 'ask',
    });
  });

  it('does not emit cost warnings for mirror-sourced inspections while keeping non-mirror warnings', () => {
    const headItemHrid = findEquipmentForSlot('head');
    const bodyItemHrid = findEquipmentForSlot('body');
    expect(headItemHrid).toBeTruthy();
    expect(bodyItemHrid).toBeTruthy();

    // 混合两种 inspection：mirror source 不应产生 warning，manual source 仍应产生 warning。
    const inspections = [
      {
        slotKey: 'head',
        beforeItemHrid: '',
        afterItemHrid: headItemHrid,
        beforeLevel: 0,
        afterLevel: 3,
        targetAskAvailable: true,
        targetPriceSource: 'mirror',
        confirmedPrice: { price: 500, volume: null, marketTimestamp: 0, method: QUEUE_PRICE_METHOD_MIRROR },
        baselineSaleZero: false,
      },
      {
        slotKey: 'body',
        beforeItemHrid: '',
        afterItemHrid: bodyItemHrid,
        beforeLevel: 0,
        afterLevel: 4,
        targetAskAvailable: true,
        targetPriceSource: MANUAL_EQUIPMENT_PRICE_SOURCE,
        confirmedPrice: { price: 222, volume: null, marketTimestamp: 0 },
        baselineSaleZero: false,
      },
    ];

    const warnings = buildQueueCostWarnings(inspections);
    // mirror source 不产生任何 warning（其合成明细已在 UI 中单独展示）。
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: MANUAL_PRICE_WARNING_CODE,
      source: MANUAL_EQUIPMENT_PRICE_SOURCE,
      slotKey: 'body',
      itemHrid: bodyItemHrid,
      enhancementLevel: 4,
      price: 222,
    });
    expect(warnings.some((warning) => warning.slotKey === 'head')).toBe(false);
  });
});

// S1 回归保护：saleSide 设置项（bid=右1 实际卖出价 / ask=左1 买入参考价）的出售抵扣口径
// 与文案（SettingsPage baselineSaleSideHint）一致：回退刻意不对称——
// 选 bid 缺价回退 ask；选 ask 缺价按 0 处理（不回退 bid，由 baselineSaleZero 警告提示）。
// 若将来有人"顺手改成对称回退"，以下用例会立即失败。
describe('resolveEquipmentTransitionPricing 出售抵扣 saleSide 口径', () => {
  const itemHrid = findEquipmentForSlot('head');

  const buildQuotesForLevel1 = (level1Quote) =>
    buildPricingState({
      enhancementQuotesByItem: {
        [itemHrid]: {
          1: level1Quote,
          2: { ask: 1000, bid: 900 },
        },
      },
    });

  it('saleSide=bid 且 bid 有价 → 按 bid 抵扣（实际卖出价，保守口径）', () => {
    expect(itemHrid).toBeTruthy();
    const pricing = resolveEquipmentTransitionPricing(
      itemHrid,
      1,
      itemHrid,
      2,
      buildQuotesForLevel1({ ask: 2000, bid: 900 }),
      [],
      {
        saleSide: 'bid',
      },
    );
    expect(pricing).toMatchObject({
      baselineSaleValue: 855, // 900 × (1 − 5% 市场税)
      baselineSaleSource: 'bid',
      baselineSaleZero: false,
    });
  });

  it('saleSide=bid 且 bid 缺价 → 回退 ask', () => {
    const pricing = resolveEquipmentTransitionPricing(
      itemHrid,
      1,
      itemHrid,
      2,
      buildQuotesForLevel1({ ask: 2000, bid: -1 }),
      [],
      {
        saleSide: 'bid',
      },
    );
    expect(pricing).toMatchObject({
      baselineSaleValue: 1900, // 2000 × 0.95
      baselineSaleSource: 'ask',
      baselineSaleZero: false,
    });
  });

  it('saleSide=ask 且 ask 有价 → 按 ask 抵扣（即使 bid 也有价）', () => {
    const pricing = resolveEquipmentTransitionPricing(
      itemHrid,
      1,
      itemHrid,
      2,
      buildQuotesForLevel1({ ask: 2000, bid: 900 }),
      [],
      {
        saleSide: 'ask',
      },
    );
    expect(pricing).toMatchObject({
      baselineSaleValue: 1900,
      baselineSaleSource: 'ask',
      baselineSaleZero: false,
    });
  });

  it('saleSide=ask 且 ask 缺价但 bid 有价 → 抵扣按 0（刻意不回退 bid，与文案声明一致）', () => {
    const pricing = resolveEquipmentTransitionPricing(
      itemHrid,
      1,
      itemHrid,
      2,
      buildQuotesForLevel1({ ask: -1, bid: 900 }),
      [],
      {
        saleSide: 'ask',
      },
    );
    expect(pricing).toMatchObject({
      baselineSaleValue: 0,
      baselineSaleSource: 'zero',
      baselineSaleZero: true,
    });
  });

  it('saleSide=bid 且 bid/ask 双缺价 → 抵扣按 0', () => {
    const pricing = resolveEquipmentTransitionPricing(
      itemHrid,
      1,
      itemHrid,
      2,
      buildQuotesForLevel1({ ask: -1, bid: -1 }),
      [],
      {
        saleSide: 'bid',
      },
    );
    expect(pricing).toMatchObject({
      baselineSaleValue: 0,
      baselineSaleSource: 'zero',
      baselineSaleZero: true,
    });
  });
});

describe('resolveBaselineSaleQuote 出售抵扣 saleSide 口径（弹窗预览，无税）', () => {
  const itemHrid = findEquipmentForSlot('body');

  const buildQuotesForLevel1 = (level1Quote) =>
    buildPricingState({
      enhancementQuotesByItem: {
        [itemHrid]: {
          1: level1Quote,
        },
      },
    });

  it('saleSide=bid 且 bid 有价 → bid 报价', () => {
    expect(itemHrid).toBeTruthy();
    expect(resolveBaselineSaleQuote(itemHrid, 1, buildQuotesForLevel1({ ask: 2000, bid: 900 }), 'bid')).toEqual({
      price: 900,
      source: 'bid',
    });
  });

  it('saleSide=bid 且 bid 缺价 → 回退 ask 报价', () => {
    expect(resolveBaselineSaleQuote(itemHrid, 1, buildQuotesForLevel1({ ask: 2000, bid: -1 }), 'bid')).toEqual({
      price: 2000,
      source: 'ask',
    });
  });

  it('saleSide=ask 且 ask 有价 → ask 报价', () => {
    expect(resolveBaselineSaleQuote(itemHrid, 1, buildQuotesForLevel1({ ask: 2000, bid: 900 }), 'ask')).toEqual({
      price: 2000,
      source: 'ask',
    });
  });

  it('saleSide=ask 且 ask 缺价但 bid 有价 → price 0（刻意不回退 bid）', () => {
    expect(resolveBaselineSaleQuote(itemHrid, 1, buildQuotesForLevel1({ ask: -1, bid: 900 }), 'ask')).toEqual({
      price: 0,
      source: 'zero',
    });
  });

  it('saleSide=bid 且 bid/ask 双缺价 → price 0', () => {
    expect(resolveBaselineSaleQuote(itemHrid, 1, buildQuotesForLevel1({ ask: -1, bid: -1 }), 'bid')).toEqual({
      price: 0,
      source: 'zero',
    });
  });
});

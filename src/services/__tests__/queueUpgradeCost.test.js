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
  computeQueueItemUpgradeCost,
  getAbilityUpgradeCostKey,
  getConfirmedEquipmentPrice,
  inspectQueueEquipmentPricing,
  normalizeConfirmedEquipmentPrices,
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
});

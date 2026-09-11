import { describe, expect, it } from 'vitest';
import Equipment from '../equipment.js';
import Player from '../player.js';
import enhancementLevelTotalMultiplierTable from '../data/enhancementLevelTotalBonusMultiplierTable.json';

function createPlayer(cacheEquipmentStats) {
  return Player.createFromDTO(
    {
      hrid: 'player1',
      staminaLevel: 80,
      intelligenceLevel: 70,
      attackLevel: 90,
      defenseLevel: 85,
      meleeLevel: 88,
      rangedLevel: 65,
      magicLevel: 75,
      equipment: {
        '/equipment_types/head': { hrid: '/items/cheese_helmet', enhancementLevel: 2 },
        '/equipment_types/main_hand': { hrid: '/items/cheese_sword', enhancementLevel: 3 },
        '/equipment_types/pouch': { hrid: '/items/large_pouch', enhancementLevel: 0 },
      },
      food: [null, null, null],
      drinks: [null, null, null],
      abilities: [],
      houseRooms: [],
      guildBuffs: [],
    },
    { cacheEquipmentStats },
  );
}

const buff = (id, type, flatBoost, ratioBoost) => ({
  uniqueHrid: id,
  typeHrid: `/buff_types/${type}`,
  flatBoost,
  ratioBoost,
  duration: 10e9,
});
function compare(cached, ordinary) {
  cached.updateCombatDetails();
  ordinary.updateCombatDetails();
  expect(cached.combatDetails).toStrictEqual(ordinary.combatDetails);
  expect(cached.baseCombatStats).toStrictEqual(ordinary.baseCombatStats);
}

describe('opt-in equipment totals cache', () => {
  it('keeps buff changes and repeated recalculation identical to uncached players', () => {
    const cached = createPlayer(true);
    const ordinary = createPlayer(false);
    compare(cached, ordinary);
    for (const entry of [
      buff('armor', 'armor', 8, 0.13),
      buff('damage', 'physical_amplify', 0, 0.17),
      buff('level', 'stamina_level', 7, 0.1),
    ]) {
      cached.addBuff(entry, 0);
      ordinary.addBuff(entry, 0);
      compare(cached, ordinary);
      compare(cached, ordinary);
    }
    cached.clearBuffs();
    ordinary.clearBuffs();
    compare(cached, ordinary);
    cached.combatDetails.combatStats.armor = 1e9;
    compare(cached, ordinary);
  });

  it.each(['enhancement', 'replacement', 'unequipping', 'definition', 'stat-table', 'reorder'])(
    'observes %s changes on the next calculation',
    (kind) => {
      const cached = createPlayer(true);
      const ordinary = createPlayer(false);
      if (kind === 'stat-table')
        for (const player of [cached, ordinary]) {
          const head = player.equipment['/equipment_types/head'];
          head.gameItem = { ...head.gameItem, equipmentDetail: { ...head.gameItem.equipmentDetail } };
        }
      compare(cached, ordinary);
      for (const player of [cached, ordinary]) {
        const head = player.equipment['/equipment_types/head'];
        if (kind === 'enhancement') head.enhancementLevel = 13;
        if (kind === 'replacement')
          player.equipment['/equipment_types/head'] = new Equipment('/items/cheese_helmet', 9);
        if (kind === 'unequipping') for (const slot of Object.keys(player.equipment)) player.equipment[slot] = null;
        if (kind === 'definition') {
          head.gameItem = {
            ...head.gameItem,
            equipmentDetail: {
              ...head.gameItem.equipmentDetail,
              combatStats: { ...head.gameItem.equipmentDetail.combatStats, armor: 73 },
            },
          };
        }
        if (kind === 'stat-table')
          head.gameItem.equipmentDetail.combatStats = { ...head.gameItem.equipmentDetail.combatStats, armor: 73 };
        if (kind === 'reorder') player.equipment = Object.fromEntries(Object.entries(player.equipment).reverse());
      }
      compare(cached, ordinary);
      compare(cached, ordinary);
    },
  );

  it.each(['method', 'accessor', 'enhancement-getter'])('retains custom %s reads and results', (kind) => {
    const cached = createPlayer(true);
    const ordinary = createPlayer(false);
    compare(cached, ordinary);
    const counts = [0, 0];
    [cached, ordinary].forEach((player, index) => {
      const head = player.equipment['/equipment_types/head'];
      const original = head.getCombatStat;
      if (kind === 'method')
        head.getCombatStat = function (stat) {
          counts[index]++;
          return original.call(this, stat) + 1;
        };
      if (kind === 'accessor')
        Object.defineProperty(head, 'getCombatStat', {
          configurable: true,
          get() {
            counts[index]++;
            return original;
          },
        });
      if (kind === 'enhancement-getter')
        Object.defineProperty(head, 'enhancementLevel', {
          configurable: true,
          get() {
            counts[index]++;
            return 9;
          },
        });
    });
    compare(cached, ordinary);
    compare(cached, ordinary);
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[0]).toBe(counts[1]);
  });

  it('invalidates cached values for a prototype override and its restoration', () => {
    const cached = createPlayer(true);
    const ordinary = createPlayer(false);
    compare(cached, ordinary);
    const descriptor = Object.getOwnPropertyDescriptor(Equipment.prototype, 'getCombatStat');
    try {
      Equipment.prototype.getCombatStat = function (stat) {
        return descriptor.value.call(this, stat) + (stat === 'armor' ? 9 : 0);
      };
      compare(cached, ordinary);
    } finally {
      Object.defineProperty(Equipment.prototype, 'getCombatStat', descriptor);
    }
    compare(cached, ordinary);
  });

  it('does not share totals between independently constructed players', () => {
    const first = createPlayer(true);
    const second = createPlayer(true);
    const reference = createPlayer(false);
    first.equipment['/equipment_types/head'].enhancementLevel = 15;
    first.updateCombatDetails();
    compare(second, reference);
    expect(first.combatDetails.combatStats.armor).not.toBe(second.combatDetails.combatStats.armor);
  });

  it('keeps equipment definition tables frozen so in-place edits cannot bypass the cache', () => {
    const head = createPlayer(true).equipment['/equipment_types/head'];
    const detail = head.gameItem.equipmentDetail;
    expect(Object.isFrozen(detail)).toBe(true);
    expect(Object.isFrozen(detail.combatStats)).toBe(true);
    expect(Object.isFrozen(detail.combatEnhancementBonuses)).toBe(true);
    expect(Object.isFrozen(enhancementLevelTotalMultiplierTable)).toBe(true);
    expect(() => {
      detail.combatStats.armor = 999;
    }).toThrow(TypeError);
    expect(() => {
      detail.combatEnhancementBonuses.armor = 999;
    }).toThrow(TypeError);
  });
});

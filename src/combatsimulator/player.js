import Ability from './ability';
import CombatUnit, { FRESH_COMBAT_STATS } from './combatUnit';
import Consumable from './consumable';
import Equipment from './equipment';
import HouseRoom from './houseRoom';
import Achievement from './achievement';
import GuildBuff from './guildBuff';
import { normalizeCombatScrolls } from '../shared/combatScrolls.js';

const EQUIPMENT_COMBAT_STATS = [
  'stabAccuracy',
  'slashAccuracy',
  'smashAccuracy',
  'rangedAccuracy',
  'magicAccuracy',
  'stabDamage',
  'slashDamage',
  'smashDamage',
  'rangedDamage',
  'magicDamage',
  'defensiveDamage',
  'taskDamage',
  'physicalAmplify',
  'waterAmplify',
  'natureAmplify',
  'fireAmplify',
  'healingAmplify',
  'stabEvasion',
  'slashEvasion',
  'smashEvasion',
  'rangedEvasion',
  'magicEvasion',
  'armor',
  'waterResistance',
  'natureResistance',
  'fireResistance',
  'maxHitpoints',
  'maxManapoints',
  'lifeSteal',
  'hpRegenPer10',
  'mpRegenPer10',
  'physicalThorns',
  'elementalThorns',
  'combatDropRate',
  'combatRareFind',
  'combatDropQuantity',
  'combatExperience',
  'criticalRate',
  'criticalDamage',
  'armorPenetration',
  'waterPenetration',
  'naturePenetration',
  'firePenetration',
  'abilityHaste',
  'tenacity',
  'manaLeech',
  'castSpeed',
  'threat',
  'parry',
  'mayhem',
  'pierce',
  'curse',
  'fury',
  'weaken',
  'ripple',
  'bloom',
  'blaze',
  'attackSpeed',
  'foodHaste',
  'drinkConcentration',
  'autoAttackDamage',
  'abilityDamage',
  'staminaExperience',
  'intelligenceExperience',
  'attackExperience',
  'defenseExperience',
  'meleeExperience',
  'rangedExperience',
  'magicExperience',
  'retaliation',
];

const equipmentStatsCaches = new WeakMap();
const nativeGetCombatStat = Equipment.prototype.getCombatStat;

// Item definitions are immutable during a simulation. Live equipment objects,
// enhancement levels and method overrides still invalidate the optional cache.
function readNativeEquipmentState(item) {
  if (Object.getPrototypeOf(item) !== Equipment.prototype || Object.hasOwn(item, 'getCombatStat')) return null;
  const enhancement = Object.getOwnPropertyDescriptor(item, 'enhancementLevel');
  const gameItem = Object.getOwnPropertyDescriptor(item, 'gameItem');
  if (!enhancement || !Object.hasOwn(enhancement, 'value') || !gameItem || !Object.hasOwn(gameItem, 'value'))
    return null;
  const detail = gameItem.value?.equipmentDetail;
  return detail
    ? [item, enhancement.value, gameItem.value, detail, detail.combatStats, detail.combatEnhancementBonuses]
    : null;
}

function readEquipmentTotals(cache, equippedItems) {
  if (!cache) return null;
  const method = Object.getOwnPropertyDescriptor(Equipment.prototype, 'getCombatStat');
  if (method?.value !== nativeGetCombatStat) {
    cache.states = null;
    return null;
  }
  const states = equippedItems.map(readNativeEquipmentState);
  if (states.some((state) => !state)) {
    cache.states = null;
    return null;
  }
  if (
    cache.states?.length === states.length &&
    states.every((state, index) => state.every((value, field) => Object.is(value, cache.states[index][field])))
  )
    return cache.totals;
  cache.states = states;
  cache.totals = null;
  return null;
}

class Player extends CombatUnit {
  equipment = {
    '/equipment_types/head': null,
    '/equipment_types/body': null,
    '/equipment_types/legs': null,
    '/equipment_types/feet': null,
    '/equipment_types/hands': null,
    '/equipment_types/main_hand': null,
    '/equipment_types/two_hand': null,
    '/equipment_types/off_hand': null,
    '/equipment_types/pouch': null,
    '/equipment_types/back': null,
  };

  // 定时个人战斗增益的持久化配置。战斗引擎拥有
  // 运行时计时器；此映射刻意只是从玩家配置
  // 复制而来的 worker 安全 DTO 契约。
  combatScrolls = {};

  constructor() {
    super();

    this.isPlayer = true;
    this.hrid = 'player';
  }

  static createFromDTO(dto, { cacheEquipmentStats = false } = {}) {
    let player = new Player();

    player.staminaLevel = dto.staminaLevel;
    player.intelligenceLevel = dto.intelligenceLevel;
    player.attackLevel = dto.attackLevel;
    player.meleeLevel = dto.meleeLevel;
    player.defenseLevel = dto.defenseLevel;
    player.rangedLevel = dto.rangedLevel;
    player.magicLevel = dto.magicLevel;

    player.hrid = dto.hrid;

    for (const [key, value] of Object.entries(dto.equipment)) {
      player.equipment[key] = value ? Equipment.createFromDTO(value) : null;
    }

    player.food = dto.food.map((food) => (food ? Consumable.createFromDTO(food) : null));
    player.drinks = dto.drinks.map((drink) => (drink ? Consumable.createFromDTO(drink) : null));
    player.abilities = dto.abilities.map((ability) => (ability ? Ability.createFromDTO(ability) : null));
    player.combatScrolls = normalizeCombatScrolls(dto.combatScrolls);

    let houseRoomDtos = [];
    if (Array.isArray(dto.houseRooms)) {
      houseRoomDtos = dto.houseRooms;
    } else if (dto.houseRooms && typeof dto.houseRooms === 'object') {
      houseRoomDtos = Object.entries(dto.houseRooms).map(([hrid, level]) => ({ hrid, level }));
    }

    houseRoomDtos.forEach((houseRoomDto) => {
      const houseRoom = HouseRoom.createFromDTO(houseRoomDto);
      if (houseRoom) {
        player.houseRooms.push(houseRoom);
      }
    });

    const guildBuffDtos = Array.isArray(dto.guildBuffs)
      ? dto.guildBuffs
      : Object.entries(dto.guildBuffs || {}).map(([hrid, level]) => ({ hrid, level }));
    guildBuffDtos.forEach((guildBuffDto) => {
      const guildBuff = GuildBuff.createFromDTO(guildBuffDto);
      if (guildBuff) {
        player.guildBuffs.push(guildBuff);
      }
    });

    player.achievements = Achievement.createFromDTO(dto.achievements);

    player.debuffOnLevelGap = dto.debuffOnLevelGap;

    if (cacheEquipmentStats) equipmentStatsCaches.set(player, { states: null, totals: null });

    return player;
  }

  updateCombatDetails() {
    if (this.equipment['/equipment_types/main_hand']) {
      this.combatDetails.combatStats.combatStyleHrid = this.equipment['/equipment_types/main_hand'].getCombatStyle();
      this.combatDetails.combatStats.damageType = this.equipment['/equipment_types/main_hand'].getDamageType();
      this.combatDetails.combatStats.attackInterval =
        this.equipment['/equipment_types/main_hand'].getCombatStat('attackInterval');
      this.combatDetails.combatStats.primaryTraining =
        this.equipment['/equipment_types/main_hand'].getPrimaryTraining();
    } else if (this.equipment['/equipment_types/two_hand']) {
      this.combatDetails.combatStats.combatStyleHrid = this.equipment['/equipment_types/two_hand'].getCombatStyle();
      this.combatDetails.combatStats.damageType = this.equipment['/equipment_types/two_hand'].getDamageType();
      this.combatDetails.combatStats.attackInterval =
        this.equipment['/equipment_types/two_hand'].getCombatStat('attackInterval');
      this.combatDetails.combatStats.primaryTraining = this.equipment['/equipment_types/two_hand'].getPrimaryTraining();
    } else {
      this.combatDetails.combatStats.combatStyleHrid = '/combat_styles/smash';
      this.combatDetails.combatStats.damageType = '/damage_types/physical';
      this.combatDetails.combatStats.attackInterval = 3000000000;
      this.combatDetails.combatStats.primaryTraining = '/skills/melee';
    }

    if (this.equipment['/equipment_types/charm']) {
      this.combatDetails.combatStats.focusTraining = this.equipment['/equipment_types/charm'].getFocusTraining();
    } else {
      this.combatDetails.combatStats.focusTraining = '';
    }

    const equippedItems = Object.values(this.equipment).filter((equipment) => equipment != null);
    const cache = equipmentStatsCaches.get(this);
    const totals = readEquipmentTotals(cache, equippedItems);
    if (totals) Object.assign(this.combatDetails.combatStats, totals);
    else {
      // Preserve equipment enumeration and addition order, including custom
      // implementations. Capture only fields this loop writes, before buffs.
      for (const stat of EQUIPMENT_COMBAT_STATS) {
        let total = 0;
        for (const equipment of equippedItems) {
          total += equipment.getCombatStat(stat);
        }
        this.combatDetails.combatStats[stat] = total;
      }
      if (cache?.states)
        cache.totals = Object.fromEntries(
          EQUIPMENT_COMBAT_STATS.map((stat) => [stat, this.combatDetails.combatStats[stat]]),
        );
    }

    if (this.equipment['/equipment_types/pouch']) {
      this.combatDetails.combatStats.foodSlots =
        1 + this.equipment['/equipment_types/pouch'].getCombatStat('foodSlots');
      this.combatDetails.combatStats.drinkSlots =
        1 + this.equipment['/equipment_types/pouch'].getCombatStat('drinkSlots');
    } else {
      this.combatDetails.combatStats.foodSlots = 1;
      this.combatDetails.combatStats.drinkSlots = 1;
    }

    this.refreshBaseCombatStats();
    super.updateCombatDetails(FRESH_COMBAT_STATS);
  }
}

export default Player;

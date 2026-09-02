import Ability from '../combatsimulator/ability.js';
import CombatUtilities from '../combatsimulator/combatUtilities.js';
import CombatSimulator from '../combatsimulator/combatSimulator.js';
import Consumable from '../combatsimulator/consumable.js';
import Equipment from '../combatsimulator/equipment.js';
import GuildBuff from '../combatsimulator/guildBuff.js';
import Labyrinth from '../combatsimulator/labyrinth.js';
import Monster from '../combatsimulator/monster.js';
import Player from '../combatsimulator/player.js';
import Zone from '../combatsimulator/zone.js';
import { createCombatScrollBuff, getCombatScrollSourceKey } from '../combatsimulator/combatScrollBuff.js';
import { BUFF_SOURCE_POLICY, PARTY_AURA_ABILITY_HRIDS, isPartyAuraBuff } from '../combatsimulator/buffSourcePolicy.js';
import abilitySlotsLevelRequirementList from '../combatsimulator/data/abilitySlotsLevelRequirementList.json';
import combatMonsterDetailMap from '../combatsimulator/data/combatMonsterDetailMap.json';
import { abilityDetailIndex, GAME_DATA_VERSION, itemDetailIndex } from '../shared/gameDataIndex.js';
import {
  calcCombatLevel,
  createEmptyPlayerConfig,
  createEmptySkillExperienceMap,
  EQUIPMENT_SLOT_KEYS,
  LEVEL_KEYS,
  normalizeHouseRoomLevels,
} from '../shared/playerConfig.js';
import { normalizeCombatScrolls } from '../shared/combatScrolls.js';
import { combatGuildBuffDetails, guildShrineDetailIndex, normalizeGuildBuffLevels } from '../shared/guildBuffs.js';
import { LABYRINTH_ROOM_LEVEL_DEFAULT, LABYRINTH_ROOM_LEVEL_MIN } from '../shared/labyrinthConfig.js';
import { buildSimulationExtraBuffs, normalizeSimulationExtra } from '../shared/simulationExtraBuffs.js';
import { getEffectiveTriggerState, sanitizeTriggerMap, toTriggerInstances } from './triggerMapper.js';

const ONE_SECOND = 1e9;
const COMBAT_PREVIEW_EPSILON = 1e-9;
const COMBAT_PREVIEW_ENEMY_HRID = Object.keys(combatMonsterDetailMap || {})[0] || '';
const COMBAT_PREVIEW_STAT_SPECS = [
  {
    key: 'maxHitpoints',
    statNameKey: 'maxHp',
    fallbackLabel: 'Max HP',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.maxHitpoints || 0),
  },
  {
    key: 'maxManapoints',
    statNameKey: 'maxMp',
    fallbackLabel: 'Max MP',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.maxManapoints || 0),
  },
  {
    key: 'attackIntervalSeconds',
    statNameKey: 'attackInterval',
    fallbackLabel: 'Attack Interval',
    format: 'seconds',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.attackInterval || 0) / ONE_SECOND,
  },
  {
    key: 'stabAccuracyRating',
    statNameKey: 'stabAccuracy',
    fallbackLabel: 'Stab Accuracy',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.stabAccuracyRating || 0),
  },
  {
    key: 'stabMaxDamage',
    statNameKey: 'stabDamage',
    fallbackLabel: 'Stab Damage',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.stabMaxDamage || 0),
  },
  {
    key: 'slashAccuracyRating',
    statNameKey: 'slashAccuracy',
    fallbackLabel: 'Slash Accuracy',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.slashAccuracyRating || 0),
  },
  {
    key: 'slashMaxDamage',
    statNameKey: 'slashDamage',
    fallbackLabel: 'Slash Damage',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.slashMaxDamage || 0),
  },
  {
    key: 'smashAccuracyRating',
    statNameKey: 'smashAccuracy',
    fallbackLabel: 'Smash Accuracy',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.smashAccuracyRating || 0),
  },
  {
    key: 'smashMaxDamage',
    statNameKey: 'smashDamage',
    fallbackLabel: 'Smash Damage',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.smashMaxDamage || 0),
  },
  {
    key: 'defensiveMaxDamage',
    statNameKey: 'defensiveDamage',
    fallbackLabel: 'Defensive Damage',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.defensiveMaxDamage || 0),
  },
  {
    key: 'rangedAccuracyRating',
    statNameKey: 'rangedAccuracy',
    fallbackLabel: 'Ranged Accuracy',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.rangedAccuracyRating || 0),
  },
  {
    key: 'rangedMaxDamage',
    statNameKey: 'rangedDamage',
    fallbackLabel: 'Ranged Damage',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.rangedMaxDamage || 0),
  },
  {
    key: 'magicAccuracyRating',
    statNameKey: 'magicAccuracy',
    fallbackLabel: 'Magic Accuracy',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.magicAccuracyRating || 0),
  },
  {
    key: 'magicMaxDamage',
    statNameKey: 'magicDamage',
    fallbackLabel: 'Magic Damage',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.magicMaxDamage || 0),
  },
  {
    key: 'averageEvasion',
    statNameKey: 'evasion',
    fallbackLabel: 'Evasion',
    format: 'int',
    getValue: (player) => {
      const evasionValues = [
        Number(player?.combatDetails?.stabEvasionRating || 0),
        Number(player?.combatDetails?.slashEvasionRating || 0),
        Number(player?.combatDetails?.smashEvasionRating || 0),
        Number(player?.combatDetails?.rangedEvasionRating || 0),
        Number(player?.combatDetails?.magicEvasionRating || 0),
      ].filter((value) => Number.isFinite(value));
      if (evasionValues.length <= 0) {
        return 0;
      }
      return evasionValues.reduce((sum, value) => sum + value, 0) / evasionValues.length;
    },
  },
  {
    key: 'stabEvasionRating',
    statNameKey: 'stabEvasion',
    fallbackLabel: 'Stab Evasion',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.stabEvasionRating || 0),
  },
  {
    key: 'slashEvasionRating',
    statNameKey: 'slashEvasion',
    fallbackLabel: 'Slash Evasion',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.slashEvasionRating || 0),
  },
  {
    key: 'smashEvasionRating',
    statNameKey: 'smashEvasion',
    fallbackLabel: 'Smash Evasion',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.smashEvasionRating || 0),
  },
  {
    key: 'rangedEvasionRating',
    statNameKey: 'rangedEvasion',
    fallbackLabel: 'Ranged Evasion',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.rangedEvasionRating || 0),
  },
  {
    key: 'magicEvasionRating',
    statNameKey: 'magicEvasion',
    fallbackLabel: 'Magic Evasion',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.magicEvasionRating || 0),
  },
  {
    key: 'totalArmor',
    statNameKey: 'armor',
    fallbackLabel: 'Armor',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.totalArmor || 0),
  },
  {
    key: 'totalWaterResistance',
    statNameKey: 'waterResistance',
    fallbackLabel: 'Water Resistance',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.totalWaterResistance || 0),
  },
  {
    key: 'totalNatureResistance',
    statNameKey: 'natureResistance',
    fallbackLabel: 'Nature Resistance',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.totalNatureResistance || 0),
  },
  {
    key: 'totalFireResistance',
    statNameKey: 'fireResistance',
    fallbackLabel: 'Fire Resistance',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.totalFireResistance || 0),
  },
  {
    key: 'criticalRate',
    statNameKey: 'criticalRate',
    fallbackLabel: 'Critical Rate',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.criticalRate || 0),
  },
  {
    key: 'armorPenetration',
    statNameKey: 'armorPenetration',
    fallbackLabel: 'Armor Penetration',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.armorPenetration || 0),
  },
  {
    key: 'physicalAmplify',
    statNameKey: 'physicalAmplify',
    fallbackLabel: 'Physical Amplify',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.physicalAmplify || 0),
  },
  {
    key: 'waterAmplify',
    statNameKey: 'waterAmplify',
    fallbackLabel: 'Water Amplify',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.waterAmplify || 0),
  },
  {
    key: 'natureAmplify',
    statNameKey: 'natureAmplify',
    fallbackLabel: 'Nature Amplify',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.natureAmplify || 0),
  },
  {
    key: 'fireAmplify',
    statNameKey: 'fireAmplify',
    fallbackLabel: 'Fire Amplify',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.fireAmplify || 0),
  },
  {
    key: 'healingAmplify',
    statNameKey: 'healingAmplify',
    fallbackLabel: 'Healing Amplify',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.healingAmplify || 0),
  },
  {
    key: 'lifeSteal',
    statNameKey: 'lifeSteal',
    fallbackLabel: 'Life Steal',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.lifeSteal || 0),
  },
  {
    key: 'physicalThorns',
    statNameKey: 'physicalThorns',
    fallbackLabel: 'Physical Thorns',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.physicalThorns || 0),
  },
  {
    key: 'elementalThorns',
    statNameKey: 'elementalThorns',
    fallbackLabel: 'Elemental Thorns',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.elementalThorns || 0),
  },
  {
    key: 'retaliation',
    statNameKey: 'retaliation',
    fallbackLabel: 'Retaliation',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.retaliation || 0),
  },
  {
    key: 'hpRegenPer10',
    statNameKey: 'hpRegen',
    fallbackLabel: 'HP Regen',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.hpRegenPer10 || 0),
  },
  {
    key: 'mpRegenPer10',
    statNameKey: 'mpRegen',
    fallbackLabel: 'MP Regen',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.mpRegenPer10 || 0),
  },
  {
    key: 'criticalDamage',
    statNameKey: 'criticalDamage',
    fallbackLabel: 'Critical Damage Bonus',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.criticalDamage || 0),
  },
  {
    key: 'taskDamage',
    statNameKey: 'taskDamage',
    fallbackLabel: 'Task Damage Bonus',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.taskDamage || 0),
  },
  {
    key: 'waterPenetration',
    statNameKey: 'waterPenetration',
    fallbackLabel: 'Water Penetration',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.waterPenetration || 0),
  },
  {
    key: 'naturePenetration',
    statNameKey: 'naturePenetration',
    fallbackLabel: 'Nature Penetration',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.naturePenetration || 0),
  },
  {
    key: 'firePenetration',
    statNameKey: 'firePenetration',
    fallbackLabel: 'Fire Penetration',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.firePenetration || 0),
  },
  {
    key: 'abilityHaste',
    statNameKey: 'abilityHaste',
    fallbackLabel: 'Ability Haste',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.abilityHaste || 0),
  },
  {
    key: 'tenacity',
    statNameKey: 'tenacity',
    fallbackLabel: 'Tenacity',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.tenacity || 0),
  },
  {
    key: 'manaLeech',
    statNameKey: 'manaLeech',
    fallbackLabel: 'Mana Leech',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.manaLeech || 0),
  },
  {
    key: 'castSpeed',
    statNameKey: 'castSpeed',
    fallbackLabel: 'Cast Speed',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.castSpeed || 0),
  },
  {
    key: 'totalThreat',
    statNameKey: 'threat',
    fallbackLabel: 'Threat',
    format: 'int',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.threat || 0),
  },
  {
    key: 'parry',
    statNameKey: 'parry',
    fallbackLabel: 'Parry',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.parry || 0),
  },
  {
    key: 'mayhem',
    statNameKey: 'mayhem',
    fallbackLabel: 'Mayhem',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.mayhem || 0),
  },
  {
    key: 'pierce',
    statNameKey: 'pierce',
    fallbackLabel: 'Pierce',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.pierce || 0),
  },
  {
    key: 'curse',
    statNameKey: 'curse',
    fallbackLabel: 'Curse',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.curse || 0),
  },
  {
    key: 'fury',
    statNameKey: 'fury',
    fallbackLabel: 'Fury',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.fury || 0),
  },
  {
    key: 'weaken',
    statNameKey: 'weaken',
    fallbackLabel: 'Weaken',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.weaken || 0),
  },
  {
    key: 'ripple',
    statNameKey: 'ripple',
    fallbackLabel: 'Ripple',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.ripple || 0),
  },
  {
    key: 'bloom',
    statNameKey: 'bloom',
    fallbackLabel: 'Bloom',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.bloom || 0),
  },
  {
    key: 'blaze',
    statNameKey: 'blaze',
    fallbackLabel: 'Blaze',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.blaze || 0),
  },
  {
    key: 'attackSpeed',
    statNameKey: 'attackSpeed',
    fallbackLabel: 'Attack Speed',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.attackSpeed || 0),
  },
  {
    key: 'autoAttackDamage',
    statNameKey: 'autoAttackDamage',
    fallbackLabel: 'Auto Attack Damage',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.autoAttackDamage || 0),
  },
  {
    key: 'abilityDamage',
    statNameKey: 'abilityDamage',
    fallbackLabel: 'Ability Damage',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.abilityDamage || 0),
  },
  {
    key: 'drinkConcentration',
    statNameKey: 'drinkConcentration',
    fallbackLabel: 'Drink Concentration',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.drinkConcentration || 0),
  },
  {
    key: 'foodHaste',
    statNameKey: 'foodHaste',
    fallbackLabel: 'Food Haste',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.foodHaste || 0),
  },
  {
    key: 'combatDropRate',
    statNameKey: 'combatDropRate',
    fallbackLabel: 'Drop Rate',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.combatDropRate || 0),
  },
  {
    key: 'combatRareFind',
    statNameKey: 'combatRareFind',
    fallbackLabel: 'Rare Find',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.combatRareFind || 0),
  },
  {
    key: 'combatDropQuantity',
    statNameKey: 'combatDropQuantity',
    fallbackLabel: 'Drop Quantity',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.combatDropQuantity || 0),
  },
  {
    key: 'combatExperience',
    statNameKey: 'combatExperience',
    fallbackLabel: 'Experience Rate',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.combatExperience || 0),
  },
  {
    key: 'staminaExperience',
    statNameKey: 'staminaExperience',
    fallbackLabel: 'Stamina Experience',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.staminaExperience || 0),
  },
  {
    key: 'intelligenceExperience',
    statNameKey: 'intelligenceExperience',
    fallbackLabel: 'Intelligence Experience',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.intelligenceExperience || 0),
  },
  {
    key: 'attackExperience',
    statNameKey: 'attackExperience',
    fallbackLabel: 'Attack Experience',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.attackExperience || 0),
  },
  {
    key: 'defenseExperience',
    statNameKey: 'defenseExperience',
    fallbackLabel: 'Defense Experience',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.defenseExperience || 0),
  },
  {
    key: 'meleeExperience',
    statNameKey: 'meleeExperience',
    fallbackLabel: 'Melee Experience',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.meleeExperience || 0),
  },
  {
    key: 'rangedExperience',
    statNameKey: 'rangedExperience',
    fallbackLabel: 'Ranged Experience',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.rangedExperience || 0),
  },
  {
    key: 'magicExperience',
    statNameKey: 'magicExperience',
    fallbackLabel: 'Magic Experience',
    format: 'percent',
    getValue: (player) => Number(player?.combatDetails?.combatStats?.magicExperience || 0),
  },
];

function normalizeCombatPreviewExtra(previewExtra = null) {
  return {
    ...normalizeSimulationExtra(previewExtra),
    combatScrollsEnabled: Boolean(previewExtra?.combatScrollsEnabled),
  };
}

function mapWeaponType(itemHrid) {
  const equipmentType = String(itemDetailIndex?.[itemHrid]?.equipmentType || '');
  if (!equipmentType) {
    return '';
  }

  if (equipmentType === '/equipment_types/main_hand' || equipmentType === '/equipment_types/two_hand') {
    return equipmentType;
  }

  return '';
}

// 游戏强化等级上限 20（enhancementLevelTotalBonusMultiplierTable 共 21 元素 0-20 级；
// 与 enhancementSimulator normalizeEnhancementConfig、importExportMapper
// clampEnhancementLevel 的 0..20 钳制同口径）。超限值（UI 直输/手改存档绕过导入
// 净化时）会让 Equipment.getCombatStat 取到 undefined 倍率 → undefined × bonus
// = NaN 污染战斗模拟数值，必须在构建模拟玩家前钳掉。
const MAX_ENHANCEMENT_LEVEL = 20;

function normalizeEnhancementLevel(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.min(Math.floor(parsed), MAX_ENHANCEMENT_LEVEL);
}

function applyDebuffOnLevelGap(playersToSim) {
  let maxPlayerCombatLevel = 1;
  for (const currentPlayer of playersToSim) {
    currentPlayer.combatLevel = calcCombatLevel(
      currentPlayer.staminaLevel,
      currentPlayer.intelligenceLevel,
      currentPlayer.defenseLevel,
      currentPlayer.attackLevel,
      currentPlayer.meleeLevel,
      currentPlayer.rangedLevel,
      currentPlayer.magicLevel,
    );
    maxPlayerCombatLevel = Math.max(maxPlayerCombatLevel, currentPlayer.combatLevel);
  }

  for (const currentPlayer of playersToSim) {
    if (maxPlayerCombatLevel / currentPlayer.combatLevel > 1.2) {
      const maxDebuffOnLevelGap = 0.9;
      const levelPercent = maxPlayerCombatLevel / currentPlayer.combatLevel - 1.2;
      currentPlayer.debuffOnLevelGap = -1 * Math.min(maxDebuffOnLevelGap, 3 * levelPercent);
    } else {
      currentPlayer.debuffOnLevelGap = 0;
    }
  }
}

function buildSimulationPlayerFromConfig(playerConfig) {
  const levels = playerConfig.levels ?? {};
  const triggerMap = sanitizeTriggerMap(playerConfig.triggerMap ?? {});

  const playerData = {
    hrid: `player${playerConfig.id}`,
    staminaLevel: Number(levels.stamina ?? 1),
    intelligenceLevel: Number(levels.intelligence ?? 1),
    attackLevel: Number(levels.attack ?? 1),
    meleeLevel: Number(levels.melee ?? 1),
    defenseLevel: Number(levels.defense ?? 1),
    rangedLevel: Number(levels.ranged ?? 1),
    magicLevel: Number(levels.magic ?? 1),
    equipment: {},
    food: [null, null, null],
    drinks: [null, null, null],
    abilities: [null, null, null, null, null],
    combatScrolls: normalizeCombatScrolls(playerConfig.combatScrolls),
    houseRooms: playerConfig.houseRooms ?? {},
    guildBuffs: playerConfig.guildBuffs ?? {},
    achievements: playerConfig.achievements ?? {},
    debuffOnLevelGap: 0,
  };

  for (const [slot, setting] of Object.entries(playerConfig.equipment ?? {})) {
    const itemHrid = setting?.itemHrid || '';
    if (!itemHrid) {
      continue;
    }

    if (!EQUIPMENT_SLOT_KEYS.includes(slot)) {
      continue;
    }

    const enhancementLevel = normalizeEnhancementLevel(setting?.enhancementLevel ?? 0);
    if (slot === 'weapon') {
      const weaponType = mapWeaponType(itemHrid);
      if (!weaponType) {
        continue;
      }
      playerData.equipment[weaponType] = new Equipment(itemHrid, enhancementLevel);
      continue;
    }

    const equipmentType = `/equipment_types/${slot}`;
    playerData.equipment[equipmentType] = new Equipment(itemHrid, enhancementLevel);
  }

  const simulationPlayer = Player.createFromDTO(playerData);
  simulationPlayer.updateCombatDetails();

  for (let i = 0; i < 3; i++) {
    const foodHrid = playerConfig.food?.[i] || '';
    if (foodHrid && i < simulationPlayer.combatDetails.combatStats.foodSlots) {
      const customFoodTriggers = Object.prototype.hasOwnProperty.call(triggerMap, foodHrid)
        ? toTriggerInstances(triggerMap[foodHrid])
        : null;
      simulationPlayer.food[i] = new Consumable(foodHrid, customFoodTriggers);
    } else {
      simulationPlayer.food[i] = null;
    }

    const drinkHrid = playerConfig.drinks?.[i] || '';
    if (drinkHrid && i < simulationPlayer.combatDetails.combatStats.drinkSlots) {
      const customDrinkTriggers = Object.prototype.hasOwnProperty.call(triggerMap, drinkHrid)
        ? toTriggerInstances(triggerMap[drinkHrid])
        : null;
      simulationPlayer.drinks[i] = new Consumable(drinkHrid, customDrinkTriggers);
    } else {
      simulationPlayer.drinks[i] = null;
    }
  }

  for (let i = 0; i < 5; i++) {
    const ability = playerConfig.abilities?.[i] ?? { abilityHrid: '', level: 1 };
    const abilityHrid = ability.abilityHrid || '';
    const abilityLevel = Number(ability.level ?? 1);

    if (
      abilityHrid &&
      Number.isFinite(abilityLevel) &&
      abilityLevel > 0 &&
      simulationPlayer.intelligenceLevel >= abilitySlotsLevelRequirementList[i + 1]
    ) {
      const customAbilityTriggers = Object.prototype.hasOwnProperty.call(triggerMap, abilityHrid)
        ? toTriggerInstances(triggerMap[abilityHrid])
        : null;
      simulationPlayer.abilities[i] = new Ability(abilityHrid, abilityLevel, customAbilityTriggers);
    } else {
      simulationPlayer.abilities[i] = null;
    }
  }

  return simulationPlayer;
}

function cloneCombatPreviewBuffs(buffs) {
  return Array.isArray(buffs) ? structuredClone(buffs) : [];
}

function normalizePreviewPlayer(player, previewExtra = null, previewEnvironment = null) {
  if (!player) {
    return null;
  }

  // 匹配战斗开始时的玩家状态，且不改变模拟入口的语义。
  player.zoneBuffs = previewEnvironment
    ? cloneCombatPreviewBuffs(previewEnvironment.zoneBuffs)
    : cloneCombatPreviewBuffs(player.zoneBuffs);
  const existingExtraBuffs = Array.isArray(player.extraBuffs) ? player.extraBuffs : [];
  const previewExtraBuffs = buildSimulationExtraBuffs(previewExtra);
  player.extraBuffs = [...existingExtraBuffs, ...previewExtraBuffs];
  player.generatePermanentBuffs();
  player.reset(0);

  // 预览表示战斗刚开始后的状态。对普通区域应用每个已配置战斗卷轴的
  // 单次开局使用；但在 Labyrinth 中刻意跳过（官方卷轴规则在那里
  // "不生效"），且当模拟设置完全禁用卷轴时同样跳过。
  // 续期/库存计时器归真实模拟器所有。
  if (previewEnvironment?.scrollsAllowed !== false && previewExtra?.combatScrollsEnabled === true) {
    for (const itemHrid of Object.keys(normalizeCombatScrolls(player.combatScrolls))) {
      const buff = createCombatScrollBuff(itemHrid);
      if (buff) {
        player.addBuff(buff, 0, getCombatScrollSourceKey(itemHrid));
      }
    }
  }

  return player;
}

function buildSingleCombatPreviewPlayer(playerConfig, previewExtra = null, previewEnvironment = null) {
  if (!playerConfig) {
    return null;
  }

  const previewConfig = {
    ...playerConfig,
    selected: true,
  };

  const [player] = buildPlayersForSimulation([previewConfig]);
  return normalizePreviewPlayer(player, previewExtra, previewEnvironment);
}

function mapDrinkTriggerMode(rawTriggerMap, drinkHrid) {
  const triggerState = getEffectiveTriggerState(rawTriggerMap, drinkHrid);
  if (triggerState.state === 'disabled') {
    return 'always';
  }

  return triggerState.state;
}

function buildCombatPreviewChangedStat(spec, beforeValue, afterValue) {
  const deltaValue = afterValue - beforeValue;
  if (!Number.isFinite(deltaValue) || Math.abs(deltaValue) <= COMBAT_PREVIEW_EPSILON) {
    return null;
  }

  return {
    key: spec.key,
    labelKey: getCombatPreviewOfficialLabelKey(spec.statNameKey),
    fallbackLabel: spec.fallbackLabel,
    format: spec.format,
    deltaValue,
    finalValue: afterValue,
  };
}

function collectCombatPreviewChangedStats(beforePlayer, afterPlayer) {
  return COMBAT_PREVIEW_STAT_SPECS.map((spec) =>
    buildCombatPreviewChangedStat(spec, spec.getValue(beforePlayer), spec.getValue(afterPlayer)),
  ).filter(Boolean);
}

function snapshotCombatPreviewStatValues(player) {
  return new Map(COMBAT_PREVIEW_STAT_SPECS.map((spec) => [spec.key, spec.getValue(player)]));
}

function collectCombatPreviewChangedStatsFromSnapshot(beforeValues, afterPlayer) {
  return COMBAT_PREVIEW_STAT_SPECS.map((spec) =>
    buildCombatPreviewChangedStat(spec, Number(beforeValues.get(spec.key)), spec.getValue(afterPlayer)),
  ).filter(Boolean);
}

const COMBAT_PREVIEW_STAT_SPEC_MAP = new Map(COMBAT_PREVIEW_STAT_SPECS.map((spec) => [spec.key, spec]));

const COMBAT_PREVIEW_OFFICIAL_STAT_KEY_ALIASES = Object.freeze({
  maxHp: 'maxHitpoints',
  maxMp: 'maxManapoints',
  hpRegen: 'hpRegenPer10',
  mpRegen: 'mpRegenPer10',
});

function getCombatPreviewOfficialLabelKey(statNameKey) {
  if (statNameKey === 'evasion') {
    return 'translation:buffTypeNames./buff_types/evasion';
  }
  const officialStatKey = COMBAT_PREVIEW_OFFICIAL_STAT_KEY_ALIASES[statNameKey] || statNameKey;
  return `translation:combatStats.${officialStatKey}`;
}

function buildCombatPreviewHighlightSource(sourceType, sourceKey, sourceHrid, sourceName, changedStats) {
  return {
    sourceType,
    sourceKey,
    sourceHrid,
    sourceName,
    changedStats: Array.isArray(changedStats) ? changedStats : [],
  };
}

function buildCombatPreviewStatBreakdowns(baseValues, finalPlayer, highlightSources) {
  const sourcesByStatKey = new Map();

  for (const source of highlightSources) {
    for (const stat of source?.changedStats ?? []) {
      if (!sourcesByStatKey.has(stat.key)) {
        sourcesByStatKey.set(stat.key, []);
      }
      sourcesByStatKey.get(stat.key).push({
        sourceType: source.sourceType,
        sourceKey: source.sourceKey,
        sourceHrid: source.sourceHrid,
        sourceName: source.sourceName,
        deltaValue: stat.deltaValue,
      });
    }
  }

  return Object.fromEntries(
    COMBAT_PREVIEW_STAT_SPECS.map((spec) => {
      const sources = sourcesByStatKey.get(spec.key) ?? [];
      const finalValue = spec.getValue(finalPlayer);
      const sourceTotal = sources.reduce((sum, source) => sum + Number(source.deltaValue || 0), 0);
      const measuredBaseValue = Number(baseValues?.get(spec.key));
      const canReconcile =
        Number.isFinite(measuredBaseValue) && Number.isFinite(finalValue) && Number.isFinite(sourceTotal);
      const reconciliationDelta = canReconcile ? finalValue - measuredBaseValue - sourceTotal : 0;
      // 保持 Base 为独立测量的无高亮基准。混合/非线性归属造成的任何
      // 差额都应归于显式的对账字段，而不是隐藏在 Base 中。
      const baseValue = Number.isFinite(measuredBaseValue) ? measuredBaseValue : finalValue - sourceTotal;

      return [
        spec.key,
        {
          key: spec.key,
          labelKey: getCombatPreviewOfficialLabelKey(spec.statNameKey),
          fallbackLabel: spec.fallbackLabel,
          format: spec.format,
          baseValue,
          finalValue,
          reconciliationDelta,
          sources,
        },
      ];
    }),
  );
}

function snapshotCombatPreviewPlayer(player) {
  return structuredClone(player);
}

function getCombatPreviewUnitContext(previewState) {
  const friendlies = previewState.player.isPlayer ? previewState.simulator.players : previewState.simulator.enemies;
  const enemies = previewState.player.isPlayer ? previewState.simulator.enemies : previewState.simulator.players;
  const target = CombatUtilities.getTarget(enemies);

  return {
    friendlies,
    enemies,
    target,
  };
}

function normalizeCombatPreviewContext(previewContext) {
  const previewMode = String(previewContext?.mode || '');
  const labyrinthHrid = String(previewContext?.labyrinthHrid || '');
  if (previewMode === 'labyrinth' || (!previewMode && labyrinthHrid)) {
    if (!labyrinthHrid) {
      return null;
    }

    const rawRoomLevel = Number(previewContext?.roomLevel || LABYRINTH_ROOM_LEVEL_DEFAULT);
    return {
      mode: 'labyrinth',
      labyrinthHrid,
      roomLevel: Number.isFinite(rawRoomLevel)
        ? Math.max(LABYRINTH_ROOM_LEVEL_MIN, rawRoomLevel)
        : LABYRINTH_ROOM_LEVEL_DEFAULT,
      crates: Array.isArray(previewContext?.crates)
        ? previewContext.crates.map((crate) => String(crate || '')).filter(Boolean)
        : [],
    };
  }

  const zoneHrid = String(previewContext?.zoneHrid || '');
  if (!zoneHrid) {
    return null;
  }

  const rawDifficultyTier = Number(previewContext?.difficultyTier || 0);
  return {
    mode: 'zone',
    zoneHrid,
    difficultyTier: Number.isFinite(rawDifficultyTier) ? rawDifficultyTier : 0,
    useDungeon: Boolean(previewContext?.useDungeon),
  };
}

function withCombatPreviewDeterministicRandom(callback) {
  const originalMathRandom = Math.random;
  Math.random = () => 0;

  try {
    return callback();
  } finally {
    Math.random = originalMathRandom;
  }
}

function initializeCombatPreviewEnemy(enemy) {
  if (!enemy) {
    return null;
  }

  enemy.zoneBuffs = Array.isArray(enemy.zoneBuffs) ? enemy.zoneBuffs : [];
  enemy.extraBuffs = Array.isArray(enemy.extraBuffs) ? enemy.extraBuffs : [];
  enemy.updateCombatDetails();
  enemy.generatePermanentBuffs();
  enemy.reset(0);

  return enemy;
}

function createFallbackCombatPreviewEnemies() {
  if (!COMBAT_PREVIEW_ENEMY_HRID) {
    return [];
  }

  return [initializeCombatPreviewEnemy(new Monster(COMBAT_PREVIEW_ENEMY_HRID, 0, 100))].filter(Boolean);
}

function buildCombatPreviewEnvironment(previewContext = null) {
  const normalizedContext = normalizeCombatPreviewContext(previewContext);
  const fallbackEnemies = createFallbackCombatPreviewEnemies();
  if (!normalizedContext) {
    return {
      zoneBuffs: [],
      enemies: fallbackEnemies,
      scrollsAllowed: true,
    };
  }

  try {
    if (normalizedContext.mode === 'labyrinth') {
      const previewLabyrinth = new Labyrinth(
        normalizedContext.labyrinthHrid,
        normalizedContext.roomLevel,
        normalizedContext.crates,
      );
      const enemies = (previewLabyrinth.getMonster() ?? [])
        .map((enemy) => initializeCombatPreviewEnemy(enemy))
        .filter(Boolean);

      return {
        zoneBuffs: cloneCombatPreviewBuffs(previewLabyrinth.buffs),
        enemies: enemies.length > 0 ? enemies : fallbackEnemies,
        scrollsAllowed: false,
      };
    }

    const previewZone = new Zone(normalizedContext.zoneHrid, normalizedContext.difficultyTier);
    const encounter = withCombatPreviewDeterministicRandom(() =>
      normalizedContext.useDungeon || previewZone.isDungeon
        ? previewZone.getNextWave()
        : previewZone.getRandomEncounter(),
    );
    const enemies = (encounter ?? []).map((enemy) => initializeCombatPreviewEnemy(enemy)).filter(Boolean);

    return {
      zoneBuffs: cloneCombatPreviewBuffs(previewZone.buffs),
      enemies: enemies.length > 0 ? enemies : fallbackEnemies,
      scrollsAllowed: true,
    };
  } catch (error) {
    return {
      zoneBuffs: [],
      enemies: fallbackEnemies,
      scrollsAllowed: true,
    };
  }
}

function createCombatPreviewEnemies(previewContext = null) {
  return buildCombatPreviewEnvironment(previewContext).enemies;
}

function createCombatPreviewSimulationState(
  playerConfig,
  previewExtra = null,
  previewEnvironment = null,
  partyPlayerConfigs = null,
) {
  const resolvedPreviewEnvironment = previewEnvironment || buildCombatPreviewEnvironment();
  const player = buildSingleCombatPreviewPlayer(playerConfig, previewExtra, resolvedPreviewEnvironment);
  if (!player) {
    return null;
  }

  // 保持主力的构建路径与单人预览一致，然后仅将选中的队友
  // 加入模拟器上下文。这样主力的既有顺序触发器回放能看到所有
  // 队友，同时不改变主力的等级差/永久增益初始化。
  const heroId = String(playerConfig?.id || '');
  const teammateConfigs = (partyPlayerConfigs ?? []).filter(
    (config) => config && config.selected && String(config.id || '') !== heroId,
  );
  const teammatePlayers = buildPlayersForSimulation(teammateConfigs);
  teammatePlayers.forEach((teammate) => {
    normalizePreviewPlayer(teammate, previewExtra, resolvedPreviewEnvironment);
  });
  const simulationPlayers = [player, ...teammatePlayers];

  const simulator = new CombatSimulator(simulationPlayers, null, null, { enableHpMpVisualization: false });
  simulator.enemies = resolvedPreviewEnvironment.enemies;
  simulator.simulationTime = 0;
  simulator.enemies.forEach((enemy) => {
    simulator.simResult.updateTimeSpentAlive(enemy.hrid, true, simulator.simulationTime);
  });

  // 实际遭遇战会在调度首个技能前检查每个单位的食物/饮品触发器。
  // 回放所选队友的消耗品，以便检查队友状态的主力触发器看到相同的
  // 开局上下文。主力自身的消耗品仍由 buildConditionalPreviewResult 处理
  // （该方法也负责其高亮归属）。
  teammatePlayers.forEach((teammate, index) => {
    replayPartyPreviewConsumables({ player: teammate, simulator }, teammateConfigs[index]);
  });

  return {
    player,
    simulator,
  };
}

function getCombatPreviewDeterministicInt(min, max) {
  let normalizedMin = Number(min);
  let normalizedMax = Number(max);

  if (!Number.isFinite(normalizedMin) || !Number.isFinite(normalizedMax)) {
    return 0;
  }

  if (normalizedMax < normalizedMin) {
    [normalizedMin, normalizedMax] = [normalizedMax, normalizedMin];
  }

  return Math.floor((normalizedMin + normalizedMax) / 2);
}

function getCombatPreviewDeterministicRatio(...parts) {
  const serialized = parts.map((part) => String(part ?? '')).join('||');
  let hash = 2166136261;

  for (let i = 0; i < serialized.length; i += 1) {
    hash ^= serialized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967296;
}

function processAttackForCombatPreview(source, target, abilityEffect = null) {
  let combatStyle = abilityEffect ? abilityEffect.combatStyleHrid : source.combatDetails.combatStats.combatStyleHrid;
  let damageType = abilityEffect ? abilityEffect.damageType : source.combatDetails.combatStats.damageType;

  let sourceAccuracyRating = 1;
  let sourceAutoAttackMaxDamage = 1;
  let targetEvasionRating = 1;

  switch (combatStyle) {
    case '/combat_styles/stab':
      sourceAccuracyRating = source.combatDetails.stabAccuracyRating;
      sourceAutoAttackMaxDamage = source.combatDetails.stabMaxDamage;
      targetEvasionRating = target.combatDetails.stabEvasionRating;
      break;
    case '/combat_styles/slash':
      sourceAccuracyRating = source.combatDetails.slashAccuracyRating;
      sourceAutoAttackMaxDamage = source.combatDetails.slashMaxDamage;
      targetEvasionRating = target.combatDetails.slashEvasionRating;
      break;
    case '/combat_styles/smash':
      sourceAccuracyRating = source.combatDetails.smashAccuracyRating;
      sourceAutoAttackMaxDamage = source.combatDetails.smashMaxDamage;
      targetEvasionRating = target.combatDetails.smashEvasionRating;
      break;
    case '/combat_styles/ranged':
      sourceAccuracyRating = source.combatDetails.rangedAccuracyRating;
      sourceAutoAttackMaxDamage = source.combatDetails.rangedMaxDamage;
      targetEvasionRating = target.combatDetails.rangedEvasionRating;
      break;
    case '/combat_styles/magic':
      sourceAccuracyRating = source.combatDetails.magicAccuracyRating;
      sourceAutoAttackMaxDamage = source.combatDetails.magicMaxDamage;
      targetEvasionRating = target.combatDetails.magicEvasionRating;
      break;
    default:
      throw new Error(`Unknown combat style: ${combatStyle}`);
  }

  let sourceDamageMultiplier = 1;
  let sourceResistance = 0;
  let sourcePenetration = 0;
  let targetResistance = 0;
  let targetThornPower = 0;
  let targetPenetration = 0;
  let thornType;

  switch (damageType) {
    case '/damage_types/physical':
      sourceDamageMultiplier = 1 + source.combatDetails.combatStats.physicalAmplify;
      sourceResistance = source.combatDetails.totalArmor;
      sourcePenetration = source.combatDetails.combatStats.armorPenetration;
      targetResistance = target.combatDetails.totalArmor;
      targetThornPower = target.combatDetails.combatStats.physicalThorns;
      targetPenetration = target.combatDetails.combatStats.armorPenetration;
      thornType = 'physicalThorns';
      break;
    case '/damage_types/water':
      sourceDamageMultiplier = 1 + source.combatDetails.combatStats.waterAmplify;
      sourceResistance = source.combatDetails.totalWaterResistance;
      sourcePenetration = source.combatDetails.combatStats.waterPenetration;
      targetResistance = target.combatDetails.totalWaterResistance;
      targetThornPower = target.combatDetails.combatStats.elementalThorns;
      targetPenetration = target.combatDetails.combatStats.waterPenetration;
      thornType = 'elementalThorns';
      break;
    case '/damage_types/nature':
      sourceDamageMultiplier = 1 + source.combatDetails.combatStats.natureAmplify;
      sourceResistance = source.combatDetails.totalNatureResistance;
      sourcePenetration = source.combatDetails.combatStats.naturePenetration;
      targetResistance = target.combatDetails.totalNatureResistance;
      targetThornPower = target.combatDetails.combatStats.elementalThorns;
      targetPenetration = target.combatDetails.combatStats.naturePenetration;
      thornType = 'elementalThorns';
      break;
    case '/damage_types/fire':
      sourceDamageMultiplier = 1 + source.combatDetails.combatStats.fireAmplify;
      sourceResistance = source.combatDetails.totalFireResistance;
      sourcePenetration = source.combatDetails.combatStats.firePenetration;
      targetResistance = target.combatDetails.totalFireResistance;
      targetThornPower = target.combatDetails.combatStats.elementalThorns;
      targetPenetration = target.combatDetails.combatStats.firePenetration;
      thornType = 'elementalThorns';
      break;
    default:
      throw new Error(`Unknown damage type: ${damageType}`);
  }

  if (abilityEffect) {
    sourceAccuracyRating *= 1 + abilityEffect.bonusAccuracyRatio;
  }

  if (source.isWeakened) {
    sourceAccuracyRating = sourceAccuracyRating - source.weakenPercentage * sourceAccuracyRating;
  }

  const hitChance =
    Math.pow(sourceAccuracyRating, 1.4) / (Math.pow(sourceAccuracyRating, 1.4) + Math.pow(targetEvasionRating, 1.4));

  let baseDamageFlat = abilityEffect ? abilityEffect.damageFlat : 0;
  let baseDamageRatio = abilityEffect ? abilityEffect.damageRatio : 1;
  let armorDamageRatioFlat = abilityEffect ? abilityEffect.armorDamageRatio * source.combatDetails.totalArmor : 0;

  let sourceMinDamage = sourceDamageMultiplier * (1 + baseDamageFlat + armorDamageRatioFlat);
  let sourceMaxDamage =
    sourceDamageMultiplier * (baseDamageRatio * sourceAutoAttackMaxDamage + baseDamageFlat + armorDamageRatioFlat);
  let damageRoll = getCombatPreviewDeterministicInt(sourceMinDamage, sourceMaxDamage);
  damageRoll *= 1 + source.combatDetails.combatStats.taskDamage;
  damageRoll *= 1 + target.combatDetails.combatStats.damageTaken;
  if (!abilityEffect) {
    damageRoll += damageRoll * source.combatDetails.combatStats.autoAttackDamage;
  } else {
    damageRoll *= 1 + source.combatDetails.combatStats.abilityDamage;
  }

  let damageDone = 0;
  let thornDamageDone = 0;
  const didHit =
    hitChance >= 1 - COMBAT_PREVIEW_EPSILON ||
    (hitChance > COMBAT_PREVIEW_EPSILON &&
      getCombatPreviewDeterministicRatio(
        'combat-preview-hit',
        source?.hrid,
        target?.hrid,
        combatStyle,
        damageType,
        Number(source?.combatDetails?.currentHitpoints || 0),
        Number(source?.combatDetails?.currentManapoints || 0),
        Number(target?.combatDetails?.currentHitpoints || 0),
        Number(target?.combatDetails?.currentManapoints || 0),
        Number(abilityEffect?.damageFlat || 0),
        Number(abilityEffect?.damageRatio || 0),
        Number(abilityEffect?.bonusAccuracyRatio || 0),
        Number(abilityEffect?.armorDamageRatio || 0),
      ) < hitChance);

  if (didHit) {
    let penetratedTargetResistance = targetResistance;
    if (sourcePenetration > 0 && targetResistance > 0) {
      penetratedTargetResistance = targetResistance / (1 + sourcePenetration);
    }

    let targetDamageTakenRatio = 100 / (100 + penetratedTargetResistance);
    if (penetratedTargetResistance < 0) {
      targetDamageTakenRatio = (100 - penetratedTargetResistance) / 100;
    }

    let mitigatedDamage = Math.ceil(targetDamageTakenRatio * damageRoll);
    damageDone = Math.min(mitigatedDamage, target.combatDetails.currentHitpoints);
    target.combatDetails.currentHitpoints -= damageDone;
  }

  if (targetThornPower > 0.0 && targetResistance > -99.0) {
    let penetratedSourceResistance = sourceResistance;

    if (sourceResistance > 0) {
      penetratedSourceResistance = sourceResistance / (1 + targetPenetration);
    }

    let sourceDamageTakenRatio = 100.0 / (100 + penetratedSourceResistance);
    if (penetratedSourceResistance < 0) {
      sourceDamageTakenRatio = (100 - penetratedSourceResistance) / 100;
    }

    let targetTaskDamageMultiplier = 1.0 + target.combatDetails.combatStats.taskDamage;
    let sourceDamageTakenMultiplier = 1.0 + source.combatDetails.combatStats.damageTaken;
    let targetDamageMultiplier = targetTaskDamageMultiplier * sourceDamageTakenMultiplier;

    let thornsDamageRoll = getCombatPreviewDeterministicInt(
      1,
      targetDamageMultiplier *
        target.combatDetails.defensiveMaxDamage *
        (1.0 + targetResistance / 100.0) *
        targetThornPower,
    );

    let mitigatedThornsDamage = Math.ceil(sourceDamageTakenRatio * thornsDamageRoll);
    thornDamageDone = Math.min(mitigatedThornsDamage, source.combatDetails.currentHitpoints);
    source.combatDetails.currentHitpoints -= thornDamageDone;
  }

  let lifeStealHeal = 0;
  if (!abilityEffect && didHit && source.combatDetails.combatStats.lifeSteal > 0) {
    lifeStealHeal = source.addHitpoints(Math.floor(source.combatDetails.combatStats.lifeSteal * damageDone));
  }

  let hpDrain = 0;
  if (abilityEffect && didHit && abilityEffect.hpDrainRatio > 0) {
    let healingAmplify = 1 + source.combatDetails.combatStats.healingAmplify;
    hpDrain = source.addHitpoints(Math.floor(abilityEffect.hpDrainRatio * damageDone * healingAmplify));
  }

  let manaLeechMana = 0;
  if (!abilityEffect && didHit && source.combatDetails.combatStats.manaLeech > 0) {
    manaLeechMana = source.addManapoints(Math.floor(source.combatDetails.combatStats.manaLeech * damageDone));
  }

  return {
    damageDone,
    didHit,
    thornDamageDone,
    thornType,
    retaliationDamageDone: 0,
    lifeStealHeal,
    hpDrain,
    manaLeechMana,
    isCrit: false,
  };
}

function processHealForCombatPreview(source, abilityEffect, target) {
  if (abilityEffect.combatStyleHrid != '/combat_styles/magic') {
    throw new Error(`Heal ability effect not supported for combat style: ${abilityEffect.combatStyleHrid}`);
  }

  let healingAmplify = 1 + source.combatDetails.combatStats.healingAmplify;
  let magicMaxDamage = source.combatDetails.magicMaxDamage;
  let baseHealFlat = abilityEffect.damageFlat;
  let baseHealRatio = abilityEffect.damageRatio;
  let minHeal = healingAmplify * (1 + baseHealFlat);
  let maxHeal = healingAmplify * (baseHealRatio * magicMaxDamage + baseHealFlat);
  let heal = getCombatPreviewDeterministicInt(minHeal, maxHeal);

  return target.addHitpoints(heal);
}

function processReviveForCombatPreview(source, abilityEffect, target) {
  if (abilityEffect.combatStyleHrid != '/combat_styles/magic') {
    throw new Error(`Heal ability effect not supported for combat style: ${abilityEffect.combatStyleHrid}`);
  }

  let healingAmplify = 1 + source.combatDetails.combatStats.healingAmplify;
  let magicMaxDamage = source.combatDetails.magicMaxDamage;
  let baseHealFlat = abilityEffect.damageFlat;
  let baseHealRatio = abilityEffect.damageRatio;
  let minHeal = healingAmplify * (1 + baseHealFlat);
  let maxHeal = healingAmplify * (baseHealRatio * magicMaxDamage + baseHealFlat);
  let heal = getCombatPreviewDeterministicInt(minHeal, maxHeal);
  let amountHealed = target.addHitpoints(heal);
  target.combatDetails.currentManapoints = target.combatDetails.maxManapoints;
  target.clearCCs();

  return amountHealed;
}

function runCombatPreviewDeterministicAbilityUse(previewState, previewAbility, sourcePlayer = null) {
  const caster = sourcePlayer || previewState?.player;
  if (!caster) {
    return false;
  }
  const originalProcessAttack = CombatUtilities.processAttack;
  const originalProcessHeal = CombatUtilities.processHeal;
  const originalProcessRevive = CombatUtilities.processRevive;
  const originalCheckParry = previewState?.simulator?.checkParry;
  const originalProcStats = {
    blaze: Number(caster?.combatDetails?.combatStats?.blaze || 0),
    bloom: Number(caster?.combatDetails?.combatStats?.bloom || 0),
    ripple: Number(caster?.combatDetails?.combatStats?.ripple || 0),
  };
  const originalChanceEffects = Array.isArray(previewAbility?.abilityEffects)
    ? previewAbility.abilityEffects.map((effect) => ({
        stunChance: Number(effect?.stunChance || 0),
        blindChance: Number(effect?.blindChance || 0),
        silenceChance: Number(effect?.silenceChance || 0),
        pierceChance: Number(effect?.pierceChance || 0),
      }))
    : [];

  CombatUtilities.processAttack = processAttackForCombatPreview;
  CombatUtilities.processHeal = processHealForCombatPreview;
  CombatUtilities.processRevive = processReviveForCombatPreview;
  previewState.simulator.checkParry = () => undefined;
  caster.combatDetails.combatStats.blaze = 0;
  caster.combatDetails.combatStats.bloom = 0;
  caster.combatDetails.combatStats.ripple = 0;
  // 将归零的触发率折入战斗属性基准，使 tryUseAbility 内部触发的
  // updateCombatDetails（例如通过增益效果）无法经 resetCombatStatsToBase
  // 静默恢复归零前的数值。
  caster.refreshBaseCombatStats();
  previewAbility?.abilityEffects?.forEach((effect) => {
    const originalPierceChance = Number(effect?.pierceChance || 0);

    effect.stunChance = 0;
    effect.blindChance = 0;
    effect.silenceChance = 0;
    effect.pierceChance = originalPierceChance >= 1 - COMBAT_PREVIEW_EPSILON ? 1 : 0;
  });

  try {
    return previewState.simulator.tryUseAbility(caster, previewAbility);
  } finally {
    CombatUtilities.processAttack = originalProcessAttack;
    CombatUtilities.processHeal = originalProcessHeal;
    CombatUtilities.processRevive = originalProcessRevive;
    previewState.simulator.checkParry = originalCheckParry;
    caster.combatDetails.combatStats.blaze = originalProcStats.blaze;
    caster.combatDetails.combatStats.bloom = originalProcStats.bloom;
    caster.combatDetails.combatStats.ripple = originalProcStats.ripple;
    previewAbility?.abilityEffects?.forEach((effect, index) => {
      const original = originalChanceEffects[index];
      if (!original) {
        return;
      }

      effect.stunChance = original.stunChance;
      effect.blindChance = original.blindChance;
      effect.silenceChance = original.silenceChance;
      effect.pierceChance = original.pierceChance;
    });
  }
}

function applyPartyAuraBuffForPreview(previewState, previewAbility, sourcePlayer = null) {
  // 队伍预览是静态的队伍光环快照，因此此辅助函数只应用 Buff 效果。
  // 调用方在调用前预留魔法值与冷却状态；将这些问题分开可避免
  // 调度预览事件。
  const caster = sourcePlayer || previewState?.player;
  const simulator = previewState?.simulator;
  if (!caster || !simulator || !previewAbility) {
    return false;
  }

  let applied = false;
  for (const abilityEffect of previewAbility.abilityEffects ?? []) {
    if (
      abilityEffect?.effectType !== '/ability_effect_types/buff' ||
      !Array.isArray(abilityEffect.buffs) ||
      abilityEffect.buffs.length === 0
    ) {
      continue;
    }

    simulator.processAbilityBuffEffect(caster, previewAbility, abilityEffect, { scheduleExpirationEvents: false });
    applied = true;
  }

  return applied;
}

function buildDrinkPreviewCard(playerConfig, slotIndex, previewExtra = null, previewEnvironment = null) {
  const drinkHrid = String(playerConfig?.drinks?.[slotIndex] || '');
  if (!drinkHrid) {
    return null;
  }

  const beforePlayer = buildSingleCombatPreviewPlayer(playerConfig, previewExtra, previewEnvironment);
  const previewPlayer = buildSingleCombatPreviewPlayer(playerConfig, previewExtra, previewEnvironment);
  const previewDrink = previewPlayer?.drinks?.[slotIndex] || null;
  const itemDetail = itemDetailIndex[drinkHrid];
  const rawConsumableDetail = itemDetail?.consumableDetail || {};

  const card = {
    slotIndex: slotIndex + 1,
    drinkHrid,
    drinkName: itemDetail?.name || drinkHrid,
    triggerMode: mapDrinkTriggerMode(playerConfig?.triggerMap ?? {}, drinkHrid),
    cooldownSeconds: Number(rawConsumableDetail.cooldownDuration || 0) / ONE_SECOND,
    hitpointRestore: Number(rawConsumableDetail.hitpointRestore || 0),
    manapointRestore: Number(rawConsumableDetail.manapointRestore || 0),
    recoveryDurationSeconds: Number(rawConsumableDetail.recoveryDuration || 0) / ONE_SECOND,
    changedStats: [],
    slotAvailable: Boolean(previewDrink),
  };

  if (!previewPlayer || !previewDrink) {
    return card;
  }

  const simulator = new CombatSimulator([previewPlayer], null, null, { enableHpMpVisualization: false });
  simulator.simulationTime = 0;

  const consumed = simulator.tryUseConsumable(previewPlayer, previewDrink);
  if (!consumed) {
    return card;
  }

  const cooldownReadyEvent = simulator.eventQueue.getMatching((event) => event.type === 'cooldownReady');
  if (cooldownReadyEvent) {
    card.cooldownSeconds =
      Math.max(0, Number(cooldownReadyEvent.time || 0) - Number(simulator.simulationTime || 0)) / ONE_SECOND;
  }

  card.changedStats = collectCombatPreviewChangedStats(beforePlayer, previewPlayer);
  return card;
}

function buildSequentialConsumablePreviewResult(previewState, consumableSpec) {
  if (!previewState?.player || !previewState?.simulator || !consumableSpec?.consumableHrid) {
    return {
      source: null,
      consumed: false,
    };
  }

  const collectionKey = consumableSpec.sourceType === 'food' ? 'food' : 'drinks';
  const previewConsumable = previewState.player?.[collectionKey]?.[consumableSpec.slotIndex - 1] || null;
  if (!previewConsumable) {
    return {
      source: null,
      consumed: false,
    };
  }

  const { friendlies, enemies, target } = getCombatPreviewUnitContext(previewState);
  const shouldTrigger = previewConsumable.shouldTrigger(
    previewState.simulator.simulationTime,
    previewState.player,
    target,
    friendlies,
    enemies,
  );
  if (!shouldTrigger) {
    return {
      source: null,
      consumed: false,
    };
  }

  const beforePlayer = snapshotCombatPreviewPlayer(previewState.player);
  const consumed = previewState.simulator.tryUseConsumable(previewState.player, previewConsumable);
  if (!consumed) {
    return {
      source: null,
      consumed: false,
    };
  }

  const changedStats = collectCombatPreviewChangedStats(beforePlayer, previewState.player);
  if (changedStats.length <= 0) {
    return {
      source: null,
      consumed: true,
    };
  }

  return {
    source: buildCombatPreviewHighlightSource(
      consumableSpec.sourceType,
      `${consumableSpec.sourceType}-${consumableSpec.slotIndex}-${consumableSpec.consumableHrid}`,
      consumableSpec.consumableHrid,
      consumableSpec.consumableName,
      changedStats,
    ),
    consumed: true,
  };
}

function abilityHasPreviewableBuffEffect(ability) {
  return Boolean(
    ability?.abilityEffects?.some(
      (effect) =>
        effect?.effectType === '/ability_effect_types/buff' &&
        (effect?.targetType === 'self' || effect?.targetType === 'allAllies'),
    ),
  );
}

function collectAbilityBuffUniqueHrids(ability) {
  const uniqueHrids = [];
  for (const abilityEffect of ability?.abilityEffects ?? []) {
    if (abilityEffect?.effectType !== '/ability_effect_types/buff') {
      continue;
    }
    for (const buff of abilityEffect?.buffs ?? []) {
      if (buff?.uniqueHrid) {
        uniqueHrids.push(buff.uniqueHrid);
      }
    }
  }
  return uniqueHrids;
}

function buildSequentialAbilityPreviewResult(previewState, slotIndex) {
  if (!previewState?.player || !previewState?.simulator) {
    return {
      source: null,
      used: false,
      shouldStop: false,
    };
  }

  const previewAbility = previewState.player?.abilities?.[slotIndex] || null;
  if (!previewAbility) {
    return {
      source: null,
      used: false,
      shouldStop: false,
    };
  }

  const { friendlies, enemies, target } = getCombatPreviewUnitContext(previewState);
  const shouldTrigger = previewAbility.shouldTrigger(
    previewState.simulator.simulationTime,
    previewState.player,
    target,
    friendlies,
    enemies,
  );
  if (!shouldTrigger) {
    return {
      source: null,
      used: false,
      shouldStop: false,
    };
  }

  const canUse = previewState.simulator.canUseAbility(previewState.player, previewAbility, false);
  if (!canUse) {
    return {
      source: null,
      used: false,
      shouldStop: true,
    };
  }

  const beforePlayer = snapshotCombatPreviewPlayer(previewState.player);
  const used = runCombatPreviewDeterministicAbilityUse(previewState, previewAbility);
  if (!used) {
    return {
      source: null,
      used: false,
      shouldStop: true,
    };
  }

  if (!abilityHasPreviewableBuffEffect(previewAbility)) {
    return {
      source: null,
      used: true,
      shouldStop: false,
    };
  }

  const changedStats = collectCombatPreviewChangedStats(beforePlayer, previewState.player);
  if (changedStats.length <= 0) {
    return {
      source: null,
      used: true,
      shouldStop: false,
    };
  }

  const abilityHrid = String(previewAbility?.hrid || '');
  const abilityDetail = abilityDetailIndex[abilityHrid];
  const source = buildCombatPreviewHighlightSource(
    'ability',
    `ability-${slotIndex + 1}-${abilityHrid}`,
    abilityHrid,
    abilityDetail?.name || abilityHrid,
    changedStats,
  );
  // 记录此次施法注册了哪些增益，以便当队友更强的施法已拥有全部这些
  // 增益时，队伍光环合并可以丢弃该来源（参见 buildCombatPreviewData）。
  // 否则，主力被覆盖的光环仍会被归因，仿佛它仍然生效。
  source.sourceBuffUniqueHrids = collectAbilityBuffUniqueHrids(previewAbility);
  return {
    source,
    used: true,
    shouldStop: false,
  };
}

function collectSequentialConsumableHighlightSources(
  previewState,
  consumableSpecs,
  consumedConsumableSlots,
  highlightedConsumableSourceKeys,
) {
  const highlightSources = [];
  let consumedConsumable;

  do {
    consumedConsumable = false;

    for (const consumableSpec of consumableSpecs) {
      const consumableSlotKey = `${consumableSpec.sourceType}-${consumableSpec.slotIndex}`;
      if (consumedConsumableSlots.has(consumableSlotKey)) {
        continue;
      }

      const result = buildSequentialConsumablePreviewResult(previewState, consumableSpec);
      if (result.source && !highlightedConsumableSourceKeys.has(result.source.sourceKey)) {
        highlightSources.push(result.source);
        highlightedConsumableSourceKeys.add(result.source.sourceKey);
      }
      if (result.consumed) {
        consumedConsumableSlots.add(consumableSlotKey);
        consumedConsumable = true;
      }
    }
  } while (consumedConsumable);

  return highlightSources;
}

function buildCombatPreviewConsumableSpecs(playerConfig, drinkCards = []) {
  const foodSpecs = (playerConfig?.food ?? [])
    .map((foodHrid, slotIndex) => {
      const normalizedHrid = String(foodHrid || '');
      if (!normalizedHrid) {
        return null;
      }

      return {
        sourceType: 'food',
        slotIndex: slotIndex + 1,
        consumableHrid: normalizedHrid,
        consumableName: itemDetailIndex[normalizedHrid]?.name || normalizedHrid,
      };
    })
    .filter(Boolean);
  const drinkSpecs = drinkCards
    .map((card) => {
      const drinkHrid = String(card?.drinkHrid || '');
      if (!drinkHrid) {
        return null;
      }

      return {
        sourceType: 'drink',
        slotIndex: Number(card.slotIndex || 0),
        consumableHrid: drinkHrid,
        consumableName: card.drinkName || drinkHrid,
      };
    })
    .filter(Boolean);

  return [...foodSpecs, ...drinkSpecs];
}

function buildPartyPreviewConsumableSpecs(playerConfig) {
  const drinkCards = (playerConfig?.drinks ?? [])
    .map((drinkHrid, slotIndex) => {
      const normalizedHrid = String(drinkHrid || '');
      if (!normalizedHrid) {
        return null;
      }

      return {
        slotIndex: slotIndex + 1,
        drinkHrid: normalizedHrid,
        drinkName: itemDetailIndex[normalizedHrid]?.name || normalizedHrid,
      };
    })
    .filter(Boolean);

  return buildCombatPreviewConsumableSpecs(playerConfig, drinkCards);
}

function replayPartyPreviewConsumables(previewState, playerConfig, consumableSpecs = null) {
  if (!previewState?.player || !previewState?.simulator || !playerConfig) {
    return [];
  }

  const resolvedConsumableSpecs = consumableSpecs || buildPartyPreviewConsumableSpecs(playerConfig);
  if (resolvedConsumableSpecs.length === 0) {
    return [];
  }

  const highlightSources = collectSequentialConsumableHighlightSources(
    previewState,
    resolvedConsumableSpecs,
    new Set(),
    new Set(),
  );

  // 消耗品使用会在实际模拟器中排入冷却事件。队伍预览是零时刻快照，
  // 因此保留状态变更，但不保留这些未来事件
  // （下一个开局技能会立即求值）。
  previewState.simulator.eventQueue.clear();
  return highlightSources;
}

function replayPartyPreviewConsumablesForAllUnits(previewEntries) {
  if (!Array.isArray(previewEntries) || previewEntries.length === 0) {
    return;
  }

  let consumedSomething;
  do {
    consumedSomething = false;

    for (const entry of previewEntries) {
      const player = entry?.player;
      const simulator = entry?.simulator;
      if (!player || !simulator || player.combatDetails?.currentHitpoints <= 0) {
        continue;
      }

      const consumableSpecs = entry.consumableSpecs ?? [];
      const consumedConsumableSlots = entry.consumedConsumableSlots;
      for (const consumableSpec of consumableSpecs) {
        const consumableSlotKey = `${consumableSpec.sourceType}-${consumableSpec.slotIndex}`;
        if (consumedConsumableSlots?.has(consumableSlotKey)) {
          continue;
        }

        const result = buildSequentialConsumablePreviewResult({ player, simulator }, consumableSpec);
        if (!result.consumed) {
          continue;
        }

        consumedConsumableSlots?.add(consumableSlotKey);
        consumedSomething = true;
      }
    }

    // 静态预览保留消耗品的即时状态变更，
    // 但从不推进其冷却或过期事件。
    previewEntries[0]?.simulator?.eventQueue.clear();
  } while (consumedSomething);
}

function reservePartyPreviewAbilityUse(simulator, source, ability) {
  // 通过检查魔法值是否足够来预留队伍预览施法，但不实际花费。
  // 费用仅在调用方确认技能效果已应用后由 commitPartyPreviewAbilityUse
  // 提交，因此未产生任何效果的施法（applyPartyAuraBuffForPreview 返回
  // false）不会从预览的资源状态中泄漏魔法值。这是防御性顺序：模块加载时
  // 的快照校验（assertPartyAuraSnapshotMatchesOfficialData）已保证五个
  // 队伍光环技能当前携带结构良好的增益效果，但超出该范围的未来数据变更
  // 应直接失败，而不是先破坏魔法值。
  return Boolean(simulator && source && ability && simulator.canUseAbility(source, ability, false));
}

function commitPartyPreviewAbilityUse(simulator, source, ability) {
  // 提交已确认预览施法的魔法值费用。镜像实际引擎的 spendAbilityMana
  // 记账逻辑（魔法值、lastUsed、累计费用），并像 addNextAttackEvent 的
  // 施法成功路径一样重置魔法值不足标志。
  simulator.spendAbilityMana(source, ability);
  source.isOutOfMana = false;
}

function runPartyPreviewAbilityUse(previewState, ability, sourcePlayer) {
  const simulator = previewState?.simulator;
  const source = sourcePlayer || previewState?.player;
  if (!simulator || !source || !ability || !reservePartyPreviewAbilityUse(simulator, source, ability)) {
    return false;
  }

  // 开局回放只需要能改变后续触发器或队友显示属性的效果。
  // 伤害被有意省略：应用伤害会使共享的预览遭遇战状态
  // 取决于哪个队友先被回放。Buff/治疗/消耗生命值效果保留
  // 相关的实际状态转换。
  for (const abilityEffect of ability.abilityEffects ?? []) {
    switch (abilityEffect?.effectType) {
      case '/ability_effect_types/buff':
        simulator.processAbilityBuffEffect(source, ability, abilityEffect, { scheduleExpirationEvents: false });
        break;
      case '/ability_effect_types/heal':
        simulator.processAbilityHealEffect(source, ability, abilityEffect);
        break;
      case '/ability_effect_types/spend_hp':
        simulator.processAbilitySpendHpEffect(source, ability, abilityEffect);
        break;
      default:
        // 伤害、复活与晋升效果在实际引擎中于施法事件之后结算，
        // 不影响此静态的开局资源/触发器回放。
        break;
    }
  }

  // 施法已确认（效果循环运行无失败），因此提交上面预留的魔法值费用。
  commitPartyPreviewAbilityUse(simulator, source, ability);
  return true;
}

function buildCombatPreviewUnitStateKey(unit) {
  if (!unit) {
    return '';
  }

  const combatBuffKey = Object.values(unit.combatBuffs ?? {})
    .map((buff) =>
      [
        String(buff?.uniqueHrid || ''),
        Number(buff?.startTime || 0),
        Number(buff?.duration || 0),
        Number(buff?.ratioBoost || 0),
        Number(buff?.flatBoost || 0),
      ].join(':'),
    )
    .sort()
    .join('|');
  const consumableKey = (collection) =>
    Array.isArray(collection)
      ? collection
          .map((consumable) =>
            consumable ? `${String(consumable.hrid || '')}:${Number(consumable.lastUsed || 0)}` : '',
          )
          .join('|')
      : '';
  const abilityKey = Array.isArray(unit.abilities)
    ? unit.abilities
        .map((ability) => (ability ? `${String(ability.hrid || '')}:${Number(ability.lastUsed || 0)}` : ''))
        .join('|')
    : '';

  return [
    Number(unit.combatDetails?.currentHitpoints || 0),
    Number(unit.combatDetails?.currentManapoints || 0),
    Number(unit.combatDetails?.combatStats?.damageTaken || 0),
    Boolean(unit.isStunned),
    Boolean(unit.isSilenced),
    Boolean(unit.isBlinded),
    Boolean(unit.isOutOfMana),
    combatBuffKey,
    consumableKey(unit.food),
    consumableKey(unit.drinks),
    abilityKey,
  ].join('||');
}

function buildCombatPreviewCycleStateKey(previewState) {
  const enemyKey = (previewState?.simulator?.enemies ?? [])
    .map((enemy) => buildCombatPreviewUnitStateKey(enemy))
    .join('###');

  return [buildCombatPreviewUnitStateKey(previewState?.player), enemyKey].join('@@@');
}

function applyTaskBadgePreviewSource(playerConfig, previewPlayer) {
  const legacyTaskBadge = playerConfig?.equipment?.trinket ?? null;
  const itemHrid = String(legacyTaskBadge?.itemHrid || '');
  if (!itemHrid) {
    return null;
  }

  const itemDetail = itemDetailIndex[itemHrid];
  if (itemDetail?.equipmentDetail?.type !== '/equipment_types/trinket') {
    return null;
  }

  const enhancementLevel = normalizeEnhancementLevel(legacyTaskBadge?.enhancementLevel ?? 0);
  const taskBadge = new Equipment(itemHrid, enhancementLevel);
  const taskDamage = Number(taskBadge.getCombatStat('taskDamage') || 0);
  if (!Number.isFinite(taskDamage) || Math.abs(taskDamage) <= COMBAT_PREVIEW_EPSILON) {
    return null;
  }

  const taskDamageSpec = COMBAT_PREVIEW_STAT_SPEC_MAP.get('taskDamage');
  if (!taskDamageSpec) {
    return null;
  }

  if (!previewPlayer?.combatDetails?.combatStats) {
    return null;
  }

  const baseTaskDamage = Number(taskDamageSpec.getValue(previewPlayer));
  previewPlayer.combatDetails.combatStats.taskDamage = baseTaskDamage + taskDamage;
  // 将徽章差值折入基准：此预览玩家是快照消费者，
  // 否则任何后续的 updateCombatDetails 都会经 resetCombatStatsToBase
  // 丢弃该写入。
  previewPlayer.refreshBaseCombatStats();

  return buildCombatPreviewHighlightSource(
    'task_badge',
    `task-badge-${itemHrid}-${enhancementLevel}`,
    itemHrid,
    itemDetail?.name || itemHrid,
    [
      {
        key: taskDamageSpec.key,
        labelKey: getCombatPreviewOfficialLabelKey(taskDamageSpec.statNameKey),
        fallbackLabel: taskDamageSpec.fallbackLabel,
        format: taskDamageSpec.format,
        deltaValue: taskDamage,
        finalValue: baseTaskDamage + taskDamage,
      },
    ],
  );
}

// 不可逆地修改 previewPlayer.permanentBuffs：每个公会增益通过 addPermanentBuff
// 累积到玩家身上，使每个快照都捕获相对先前已应用状态的边际增量。
// 调用方必须传入一次性（可丢弃）的玩家对象，
// 其 permanentBuffs 在本次调用后无需保持原样。
function buildGuildBuffPreviewSources(playerConfig, previewPlayer) {
  if (!previewPlayer) {
    return [];
  }

  const guildBuffLevels = normalizeGuildBuffLevels(playerConfig?.guildBuffs);
  const highlightSources = [];

  for (const detail of combatGuildBuffDetails) {
    const guildBuffHrid = String(detail?.hrid || '');
    const level = Number(guildBuffLevels[guildBuffHrid] || 0);
    if (!guildBuffHrid || level <= 0) {
      continue;
    }

    const beforeValues = snapshotCombatPreviewStatValues(previewPlayer);
    const guildBuff = new GuildBuff(guildBuffHrid, level);
    for (const buff of guildBuff.buffs) {
      previewPlayer.addPermanentBuff(structuredClone(buff));
    }
    previewPlayer.clearBuffs();

    const changedStats = collectCombatPreviewChangedStatsFromSnapshot(beforeValues, previewPlayer);
    if (changedStats.length <= 0) {
      continue;
    }

    const shrineHrid = String(detail.shrineHrid || '');
    highlightSources.push(
      buildCombatPreviewHighlightSource(
        'guild_buff',
        `guild-buff-${guildBuffHrid}`,
        shrineHrid,
        guildShrineDetailIndex[shrineHrid]?.name || shrineHrid,
        changedStats,
      ),
    );
  }

  return highlightSources;
}

function buildCombatScrollPreviewSources(playerConfig, previewPlayer, previewExtra = null, previewEnvironment = null) {
  if (previewEnvironment?.scrollsAllowed === false) {
    return [];
  }
  if (previewExtra?.combatScrollsEnabled !== true) {
    return [];
  }

  const configuredScrolls = normalizeCombatScrolls(playerConfig?.combatScrolls);
  const itemHrids = Object.keys(configuredScrolls);
  if (itemHrids.length <= 0) {
    return [];
  }

  if (!previewPlayer?.combatBuffs || typeof previewPlayer.combatBuffs !== 'object') {
    return [];
  }

  // 按配置顺序应用卷轴，使每个差值都是下一个预览来源
  // 实际接收到的状态的边际变化。
  const highlightSources = [];

  for (const itemHrid of itemHrids) {
    const buff = createCombatScrollBuff(itemHrid);
    if (!buff) {
      continue;
    }

    const beforeValues = snapshotCombatPreviewStatValues(previewPlayer);
    previewPlayer.addBuff(buff, 0, getCombatScrollSourceKey(itemHrid));
    const changedStats = collectCombatPreviewChangedStatsFromSnapshot(beforeValues, previewPlayer);
    if (changedStats.length > 0) {
      highlightSources.push(
        buildCombatPreviewHighlightSource(
          'combat_scroll',
          `combat-scroll-${itemHrid}`,
          itemHrid,
          itemDetailIndex[itemHrid]?.name || itemHrid,
          changedStats,
        ),
      );
    }
  }

  return highlightSources;
}

// 选中配置包含光环技能的队伍成员会影响每个存活的队友（包括主力），
// 且引擎只保留每个光环增益的最强来源。预览回放队友的零时刻消耗品
// 流程以及技能槽选择/资源门槛。它只推进必要的施法结束顺序；
// 恢复、伤害与过期事件均在此静态开局快照之外。
// 主力自身的技能仍归条件预览所有。

const PARTY_AURA_PREVIEW_CACHE_LIMIT = 8;
const partyAuraPreviewCache = new Map();

// 确定性地将可影响队伍光环强度的进阶状态字段归约为可序列化标量。
// 原始配置对象可能携带瞬态或不可 JSON 序列化的字段（函数、Vue 响应式代理
// 内部结构等）；JSON.stringify 会静默丢弃这些字段，使本应相关的编辑
// 对预览缓存不可见。只保留决定效果的标量，使缓存键既稳定又正确。
function sortObjectEntries(entries) {
  return [...entries].sort(([leftKey], [rightKey]) => String(leftKey).localeCompare(String(rightKey)));
}

function normalizePartyAuraLevelMap(raw, normalizeKnownMap) {
  const source = raw && typeof raw === 'object' ? raw : {};
  if (Array.isArray(source)) {
    // 旧式数组形式（[hrid, level] 或 {hrid, level}）被 Player.createFromDTO
    // 接受；先将它们转换为相同的映射形状。
    return Object.fromEntries(
      source
        .map((entry) =>
          Array.isArray(entry)
            ? [String(entry[0] ?? ''), Number(entry[1] ?? 0)]
            : [String(entry?.hrid ?? ''), Number(entry?.level ?? 0)],
        )
        .filter(([hrid]) => hrid),
    );
  }
  return normalizeKnownMap(source);
}

function normalizePartyAuraAchievements(achievements) {
  const source = achievements && typeof achievements === 'object' ? achievements : {};
  if (Array.isArray(source.buffs)) {
    // createFromDTO 往返形式：显式增益记录。对增益条目和增益列表
    // 都排序；永久增益累积是可交换的，因此排序不会改变结果属性。
    return {
      buffs: source.buffs
        .map((buff) => sortObjectEntries(Object.entries(buff ?? {})))
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    };
  }
  return {
    unlocked: Object.entries(source)
      .filter(([, value]) => Boolean(value))
      .map(([hrid]) => String(hrid))
      .sort(),
  };
}

const normalizePartyAuraZoneBuffs = (zoneBuffs) =>
  Array.isArray(zoneBuffs)
    ? zoneBuffs
        .map((buff) => sortObjectEntries(Object.entries(buff ?? {})))
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    : [];

function buildPartyAuraPreviewConfigSignature(config) {
  const safeConfig = config && typeof config === 'object' ? config : {};
  return {
    id: String(safeConfig.id || ''),
    name: String(safeConfig.name || ''),
    selected: Boolean(safeConfig.selected),
    levels: LEVEL_KEYS.map((key) => Number(safeConfig.levels?.[key] ?? 1)),
    equipment: EQUIPMENT_SLOT_KEYS.map((slot) => [
      slot,
      String(safeConfig.equipment?.[slot]?.itemHrid || ''),
      normalizeEnhancementLevel(safeConfig.equipment?.[slot]?.enhancementLevel ?? 0),
    ]),
    food: Array.from({ length: 3 }, (_, index) => String(safeConfig.food?.[index] || '')),
    drinks: Array.from({ length: 3 }, (_, index) => String(safeConfig.drinks?.[index] || '')),
    abilities: Array.from({ length: 5 }, (_, index) => {
      const ability = safeConfig.abilities?.[index] ?? {};
      return [String(ability.abilityHrid || ''), Number(ability.level ?? 1)];
    }),
    triggerMap: sanitizeTriggerMap(safeConfig.triggerMap ?? {}),
    houseRooms: normalizePartyAuraLevelMap(safeConfig.houseRooms, normalizeHouseRoomLevels),
    guildBuffs: normalizePartyAuraLevelMap(safeConfig.guildBuffs, normalizeGuildBuffLevels),
    achievements: normalizePartyAuraAchievements(safeConfig.achievements),
    combatScrolls: normalizeCombatScrolls(safeConfig.combatScrolls),
  };
}

function buildPartyAuraPreviewCacheKey(playerConfig, teammates, previewExtra, previewContext, previewEnvironment) {
  return JSON.stringify({
    // 缓存是模块级作用域，因此包含生成的数据版本，
    // 防止游戏数据重建或热重载后出现过期结果。
    dataVersion: GAME_DATA_VERSION,
    hero: buildPartyAuraPreviewConfigSignature(playerConfig),
    teammates: teammates.map(buildPartyAuraPreviewConfigSignature),
    extra: normalizeCombatPreviewExtra(previewExtra),
    context: normalizeCombatPreviewContext(previewContext),
    environment: {
      scrollsAllowed: previewEnvironment?.scrollsAllowed !== false,
      zoneBuffs: normalizePartyAuraZoneBuffs(previewEnvironment?.zoneBuffs),
    },
  });
}

function buildPartyAuraPreviewHighlightSource(caster, ability, hero, beforeValues, teammateNameByHrid) {
  const changedStats = collectCombatPreviewChangedStatsFromSnapshot(beforeValues, hero);
  if (changedStats.length <= 0) {
    return null;
  }

  const abilityName = abilityDetailIndex?.[ability.hrid]?.name || ability.hrid;
  const teammateName = teammateNameByHrid.get(caster.hrid) || caster.hrid;
  const sourceBuffUniqueHrids = collectAbilityBuffUniqueHrids(ability);

  const highlightSource = buildCombatPreviewHighlightSource(
    'ability',
    `teammate-aura-${caster.hrid}-${ability.hrid}`,
    ability.hrid,
    `${teammateName} · ${abilityName}`,
    changedStats,
  );
  highlightSource.contributorHrid = caster.hrid;
  highlightSource.sourceBuffUniqueHrids = sourceBuffUniqueHrids;
  return highlightSource;
}

function selectPartyPreviewAbilityEvent(simulator, player, currentTime, sequence) {
  if (!simulator || !player || player.combatDetails?.currentHitpoints <= 0) {
    return null;
  }

  simulator.simulationTime = currentTime;
  const { friendlies, enemies, target } = getCombatPreviewUnitContext({ player, simulator });
  let skipNextAbility = false;

  for (const ability of player.abilities ?? []) {
    if (!ability || skipNextAbility) {
      continue;
    }
    const triggerState = ability.shouldTrigger(currentTime, player, target, friendlies, enemies);
    if (!triggerState) {
      continue;
    }

    const usable = simulator.canUseAbility(player, ability, false);

    // 与 CombatSimulator.addNextAttackEvent 一致：一旦第一个
    // 可触发槽位无法支付其魔法值费用，后续槽位即被跳过。
    if (!usable) {
      skipNextAbility = true;
      continue;
    }

    const castDuration =
      Number(ability.castDuration || 0) / (1 + Number(player.combatDetails?.combatStats?.castSpeed || 0));
    return {
      source: player,
      ability,
      time: currentTime + castDuration,
      sequence,
    };
  }

  return null;
}

function insertPartyPreviewAbilityEvent(events, event) {
  if (!event) {
    return;
  }

  events.push(event);
  events.sort((left, right) => left.time - right.time || left.sequence - right.sequence);
}

function replayPartyPreviewAbilities(
  simulator,
  teamPlayers,
  previewEntries,
  hero,
  teammateNameByHrid,
  highlightSources,
) {
  const pendingEvents = [];
  let sequence = 0;
  const auraBeforeValuesByKey = new Map();

  // 在解析任何施法前先调度每个队友的首次施法。这是与串行预览的
  // 区别：已排队的队伍光环即使早先的施法改变了其触发状态，
  // 仍然保持有效。
  teamPlayers.slice(1).forEach((player) => {
    insertPartyPreviewAbilityEvent(pendingEvents, selectPartyPreviewAbilityEvent(simulator, player, 0, sequence++));
  });

  const maxEvents = 512;
  let truncated = false;
  for (let processedEvents = 0; pendingEvents.length > 0 && processedEvents < maxEvents; processedEvents += 1) {
    const event = pendingEvents.shift();
    const sourcePlayer = event.source;
    simulator.simulationTime = event.time;

    const isPartyAura = PARTY_AURA_ABILITY_HRIDS.has(event.ability.hrid);
    const beforeValues = isPartyAura ? snapshotCombatPreviewStatValues(hero) : null;
    const previewState = { player: sourcePlayer, simulator };
    let used;
    if (isPartyAura) {
      used = false;
      if (reservePartyPreviewAbilityUse(simulator, sourcePlayer, event.ability)) {
        used = applyPartyAuraBuffForPreview(previewState, event.ability, sourcePlayer);
        if (used) {
          // 只在光环的增益效果实际应用后才提交魔法值费用；
          // 无效果的光环不得耗尽施法者。
          commitPartyPreviewAbilityUse(simulator, sourcePlayer, event.ability);
        }
      }
    } else {
      used = runPartyPreviewAbilityUse(previewState, event.ability, sourcePlayer);
    }
    simulator.eventQueue.clear();

    if (!used) {
      // 即使技能已无法支付其魔法值，施法结束事件仍会到达
      // 模拟器的事件后 checkTriggers。
      replayPartyPreviewConsumablesForAllUnits(previewEntries);
      continue;
    }

    if (isPartyAura && beforeValues) {
      // 队友可能多次施放同一光环（自定义触发器 + 冷却 ≤ 120s + 长施法技能）。
      // 只有首次施法的前置快照有意义：最终来源的差值按该快照到主力
      // 回放结束状态测量，反映最强的有效注册。若保留每次施法的来源，
      // 会在面板中重复同一标识符，并重复计算中间差值。
      const key = `teammate-aura-${sourcePlayer.hrid}-${event.ability.hrid}`;
      if (!auraBeforeValuesByKey.has(key)) {
        auraBeforeValuesByKey.set(key, {
          beforeValues,
          caster: sourcePlayer,
          ability: event.ability,
        });
      }
    }

    // tryUseAbility 会在引擎的事件后 checkTriggers 调用之前调度
    // 施法者的下一个动作。此处保持该顺序。
    insertPartyPreviewAbilityEvent(
      pendingEvents,
      selectPartyPreviewAbilityEvent(simulator, sourcePlayer, simulator.simulationTime, sequence++),
    );

    // 每个已解析的事件都会为整个队伍重新运行食物/饮品触发器；
    // 这正是让先前的队友光环激活后续队友消耗品、同时不使后者
    // 已排队的施法失效的机制。
    replayPartyPreviewConsumablesForAllUnits(previewEntries);
  }

  // 事件预算只为约束最坏情况下的触发器反馈回路而存在
  // （例如消耗品链反复重新武装队友光环）。真实队伍总会收敛：
  // 技能冷却与魔法值费用严格限制开局窗口内能容纳的施法次数。
  // 因此触及上限并非正确性失败（simulationTime 仍会在下方重置，
  // 缓存依然有效），但它意味着预览在全部队友光环应用之前就已
  // 停止——应将其暴露出来，让消费方发出警告，
  // 而不是静默展示不完整的光环集合。
  if (pendingEvents.length > 0) {
    truncated = true;
    console.warn(
      `[playerMapper] Party aura preview stopped after ${maxEvents} events with ${pendingEvents.length} still queued ` +
        `(simulationTime ${simulator.simulationTime}); preview may be incomplete for some teammate auras.`,
    );
  }

  // 在回放结束后构建光环高亮来源。每个来源测量其从首次施法快照
  // 到主力最终状态的差值，因此重新施放同一光环的队友（饮品强化）
  // 只会贡献一个覆盖整个有效变化过程的来源，
  // 而不是每次施法一行重复。
  for (const { beforeValues, caster, ability } of auraBeforeValuesByKey.values()) {
    const source = buildPartyAuraPreviewHighlightSource(caster, ability, hero, beforeValues, teammateNameByHrid);
    if (source) {
      highlightSources.push(source);
    }
  }

  simulator.simulationTime = 0;
  return truncated;
}

function setPartyAuraPreviewCache(cacheKey, result) {
  partyAuraPreviewCache.delete(cacheKey);
  partyAuraPreviewCache.set(cacheKey, result);
  while (partyAuraPreviewCache.size > PARTY_AURA_PREVIEW_CACHE_LIMIT) {
    partyAuraPreviewCache.delete(partyAuraPreviewCache.keys().next().value);
  }
}

function buildPartyAuraPreviewResult(
  playerConfig,
  partyPlayerConfigs,
  previewExtra = null,
  previewEnvironment = null,
  previewContext = null,
) {
  if (!playerConfig) {
    return null;
  }

  const heroId = String(playerConfig.id || '');
  const teammates = (partyPlayerConfigs ?? []).filter(
    (config) => config && config.selected && String(config.id || '') !== heroId,
  );
  if (teammates.length === 0) {
    return null;
  }

  const cacheKey = buildPartyAuraPreviewCacheKey(
    playerConfig,
    teammates,
    previewExtra,
    previewContext,
    previewEnvironment,
  );
  if (partyAuraPreviewCache.has(cacheKey)) {
    // 绝不对外分发存储的对象：回放生成的 Buff 实例
    // （以及 sourceBuffs/highlightSources 容器）否则会在多次构建之间
    // 共享，任何消费方侧的修改都会泄漏到后续每次命中。
    // 每个出口都返回隔离的快照，使存储条目保持权威性。
    const cachedResult = partyAuraPreviewCache.get(cacheKey);
    return cachedResult === null ? null : structuredClone(cachedResult);
  }

  const resolvedPreviewEnvironment = previewEnvironment || buildCombatPreviewEnvironment();
  const heroConfig = { ...playerConfig, selected: true };
  const teamPlayers = buildPlayersForSimulation([heroConfig, ...teammates]);
  const hero = teamPlayers[0];
  if (!hero) {
    setPartyAuraPreviewCache(cacheKey, null);
    return null;
  }
  teamPlayers.forEach((player) => normalizePreviewPlayer(player, previewExtra, resolvedPreviewEnvironment));

  const teammateNameByHrid = new Map();
  teammates.forEach((config) => {
    teammateNameByHrid.set(`player${config.id}`, config.name || `Player ${config.id}`);
  });
  const teammateSourceKeys = new Set(teamPlayers.filter((player) => player !== hero).map((player) => player.hrid));

  const simulator = new CombatSimulator(teamPlayers, null, null, { enableHpMpVisualization: false });
  simulator.enemies = resolvedPreviewEnvironment.enemies;
  simulator.simulationTime = 0;

  const highlightSources = [];

  // 镜像遭遇战开局：在选择首个技能之前，为每个单位运行食物/饮品触发器。
  // 主力的条件预览有自己的消耗品归属；此临时流程仅用于
  // 让队友的触发器/资源状态在完整队伍背景下求值。
  const openingConfigs = [heroConfig, ...teammates];
  const previewEntries = teamPlayers.map((player, index) => ({
    player,
    simulator,
    consumableSpecs: buildPartyPreviewConsumableSpecs(openingConfigs[index]),
    consumedConsumableSlots: new Set(),
  }));
  replayPartyPreviewConsumablesForAllUnits(previewEntries);
  const partyAuraPreviewTruncated = replayPartyPreviewAbilities(
    simulator,
    teamPlayers,
    previewEntries,
    hero,
    teammateNameByHrid,
    highlightSources,
  );

  // 保留每个队友来源，而不仅是 hero.combatBuffs 中当前最强的增益。
  // 若此预览状态在最强来源过期后需要重新对账，较弱的条目是必需的。
  const sourceBuffs = [];
  for (const sources of Object.values(hero.buffSources)) {
    for (const [sourceKey, entry] of sources.entries()) {
      if (!isPartyAuraBuff(entry?.buff)) {
        continue;
      }
      // 官方队伍光环处理始终注册施法者的玩家 hrid。
      // 忽略格式错误/默认的注册，而不是发明一个无法参与
      // 来源归属或最强来源交接的合成来源。
      if (!teammateSourceKeys.has(sourceKey)) {
        continue;
      }

      sourceBuffs.push({
        buff: entry.buff,
        sourceHrid: sourceKey,
      });
    }
  }

  if (sourceBuffs.length === 0 && highlightSources.length === 0) {
    if (partyAuraPreviewTruncated) {
      // 截断仍可能隐藏本会在事件预算之后出现的光环：
      // 报告部分状态，而不是静默返回 null。
      const truncatedResult = {
        sourceBuffs,
        highlightSources,
        truncated: true,
      };
      setPartyAuraPreviewCache(cacheKey, truncatedResult);
      return structuredClone(truncatedResult);
    }
    setPartyAuraPreviewCache(cacheKey, null);
    return null;
  }

  const result = {
    sourceBuffs,
    highlightSources,
    // 消费方（例如首页预览）用此字段提示警告：
    // 队伍光环回放达到事件预算，结果可能不完整。
    truncated: partyAuraPreviewTruncated,
  };
  setPartyAuraPreviewCache(cacheKey, result);
  // 与缓存命中分支相同的快照规则：存储条目保持权威性，
  // 返回的对象归调用方所有。
  return structuredClone(result);
}

function buildConditionalPreviewResult(
  playerConfig,
  previewExtra = null,
  drinkCards = [],
  previewEnvironment = null,
  partyPlayerConfigs = null,
) {
  const previewState = createCombatPreviewSimulationState(
    playerConfig,
    previewExtra,
    previewEnvironment,
    partyPlayerConfigs,
  );
  const highlightSources = [];

  if (previewState) {
    const consumableSpecs = buildCombatPreviewConsumableSpecs(playerConfig, drinkCards);
    const consumedConsumableSlots = new Set();
    const highlightedConsumableSourceKeys = new Set();
    const seenCycleStateKeys = new Set();
    const abilitySlotCount = playerConfig?.abilities?.length ?? 0;

    highlightSources.push(
      ...collectSequentialConsumableHighlightSources(
        previewState,
        consumableSpecs,
        consumedConsumableSlots,
        highlightedConsumableSourceKeys,
      ),
    );

    while (true) {
      const cycleStateKey = buildCombatPreviewCycleStateKey(previewState);
      if (seenCycleStateKeys.has(cycleStateKey)) {
        break;
      }
      seenCycleStateKeys.add(cycleStateKey);

      let usedAbilityThisCycle = false;
      let shouldStop = false;

      for (let slotIndex = 0; slotIndex < abilitySlotCount; slotIndex += 1) {
        const result = buildSequentialAbilityPreviewResult(previewState, slotIndex);
        if (result.source) {
          highlightSources.push(result.source);
        }
        if (result.shouldStop) {
          shouldStop = true;
          break;
        }
        if (!result.used) {
          continue;
        }

        usedAbilityThisCycle = true;
        highlightSources.push(
          ...collectSequentialConsumableHighlightSources(
            previewState,
            consumableSpecs,
            consumedConsumableSlots,
            highlightedConsumableSourceKeys,
          ),
        );
        break;
      }

      if (shouldStop || !usedAbilityThisCycle) {
        break;
      }
    }
  }

  const taskBadgeSource = applyTaskBadgePreviewSource(playerConfig, previewState?.player);
  if (taskBadgeSource) {
    highlightSources.push(taskBadgeSource);
  }

  return {
    player: previewState?.player ?? null,
    highlightSources,
  };
}

function buildStaticCombatPreviewAttribution(playerConfig, previewExtra, previewEnvironment) {
  const baselineConfig = {
    ...playerConfig,
    guildBuffs: normalizeGuildBuffLevels({}),
  };
  const baselineExtra = {
    ...(previewExtra ?? {}),
    combatScrollsEnabled: false,
  };
  const attributionPlayer = buildSingleCombatPreviewPlayer(baselineConfig, baselineExtra, previewEnvironment);
  if (!attributionPlayer) {
    return {
      baseValues: new Map(),
      highlightSources: [],
    };
  }

  const baseValues = snapshotCombatPreviewStatValues(attributionPlayer);
  const highlightSources = buildGuildBuffPreviewSources(playerConfig, attributionPlayer);
  highlightSources.push(
    ...buildCombatScrollPreviewSources(playerConfig, attributionPlayer, previewExtra, previewEnvironment),
  );

  return {
    baseValues,
    highlightSources,
  };
}

export function buildPlayersForSimulation(playerConfigs) {
  const selectedPlayers = (playerConfigs ?? []).filter((player) => player.selected);
  const simulationPlayers = selectedPlayers.map((player) => buildSimulationPlayerFromConfig(player));

  applyDebuffOnLevelGap(simulationPlayers);

  return simulationPlayers;
}

export function buildPlayersForCombatPreview(playerConfigs, previewExtra = null, previewContext = null) {
  const normalizedExtra = normalizeCombatPreviewExtra(previewExtra);
  const previewEnvironment = buildCombatPreviewEnvironment(previewContext);
  const simulationPlayers = buildPlayersForSimulation(playerConfigs);
  simulationPlayers.forEach((player) => normalizePreviewPlayer(player, normalizedExtra, previewEnvironment));

  return simulationPlayers;
}

// 性能说明：buildCombatPreviewData 每次调用最多构建三个独立的
// Player 对象：
//   1. 下方的 `player` —— 完整配置的玩家（含公会增益 + 卷轴）。
//   2. `buildStaticCombatPreviewAttribution` 内部的 `attributionPlayer` ——
//      由禁用 guildBuffs 和禁用卷轴的配置构建的基准玩家，
//      以便每个公会增益/卷轴差值可作为边际增量测量。该基准不能复用
//      `player`，因为二者的 permanentBuffs 不同（player 的包含公会增益）。
//   3. `buildConditionalPreviewResult` 内部的 `previewState.player` —— 驱动
//      顺序消耗品/技能模拟，必须是全新实例，因为模拟会修改战斗状态
//      （生命值/魔法值、增益计时器等）。
//   4. `buildPartyAuraPreviewResult` 在缓存未命中时构建临时队伍和模拟器。
//      其派生的来源/高亮结果按相关配置字段缓存，因此对无关玩家字段的
//      就地编辑不会重建队伍路径。缓存有界，且从不保留运行时的
//      Player 或 CombatSimulator 实例。
// 此外，buildGuildBuffPreviewSources / buildCombatScrollPreviewSources
// 每个活动增益都要执行一次完整的 STAT_SPECS 快照 +
// addPermanentBuff/clearBuffs（updateCombatDetails）+ 差值遍历，
// 因此 5 个神龛大约需要 10 次全规格遍历。
// 此函数供 Vue 的 `computed` 消费（参见 HomePage.vue 的
// `combatPreviewData`），因此只在响应式依赖变化时重新执行。
// 对于非常频繁的配置编辑，该开销可以接受但并非免费；
// 若性能分析显示热点，优先对上游配置编辑做防抖，
// 而不是在此处微优化玩家构建。
export function buildCombatPreviewData(playerConfig, previewExtra = null, previewContext = null, options = null) {
  const normalizedExtra = normalizeCombatPreviewExtra(previewExtra);
  const previewEnvironment = buildCombatPreviewEnvironment(previewContext);
  const player = buildSingleCombatPreviewPlayer(playerConfig, normalizedExtra, previewEnvironment);
  const drinkCards = (playerConfig?.drinks ?? [])
    .map((_, slotIndex) => buildDrinkPreviewCard(playerConfig, slotIndex, normalizedExtra, previewEnvironment))
    .filter(Boolean);
  const attribution = buildStaticCombatPreviewAttribution(
    playerConfig,
    normalizedExtra,
    previewEnvironment,
    previewContext,
  );

  // 对未被触碰的开局遭遇战回放所选队友。下方主力的条件预览
  // 可能执行普通技能，因此先求值队伍触发器，可防止那些确定性预览
  // 效果改变队友的触发上下文。
  const partyAuraResult = buildPartyAuraPreviewResult(
    playerConfig,
    options?.partyPlayerConfigs ?? null,
    normalizedExtra,
    previewEnvironment,
    previewContext,
  );
  const conditionalPreview = buildConditionalPreviewResult(
    playerConfig,
    normalizedExtra,
    drinkCards,
    previewEnvironment,
    options?.partyPlayerConfigs ?? null,
  );
  const finalPlayer = conditionalPreview.player || player;
  const highlightSources = [...attribution.highlightSources, ...conditionalPreview.highlightSources];

  // 真实战斗中，所选队友的光环会影响主力（allAllies +
  // 最强来源规则）。回放这些施法，让面板显示与队伍模拟
  // 相同的最终属性。
  if (partyAuraResult) {
    partyAuraResult.sourceBuffs.forEach(({ buff, sourceHrid }) => {
      if (finalPlayer) {
        finalPlayer.addBuff(buff, 0, sourceHrid, { sourcePolicy: BUFF_SOURCE_POLICY.STRONGEST });
      }
    });
    // 收集 finalPlayer 上注册的队友来源键集合。
    const teammateSourceKeys = new Set(partyAuraResult.sourceBuffs.map(({ sourceHrid }) => sourceHrid));
    // 当活动来源键属于队友时，uniqueHrid 即"归队伍所有"，
    // 意味着主力自身的注册已被覆盖。
    const isPartyOwned = (uniqueHrid) => {
      const activeKey = finalPlayer.activeBuffSourceKeys?.[uniqueHrid];
      return Boolean(activeKey) && teammateSourceKeys.has(activeKey);
    };
    // 丢弃其增益在最终状态中全部归队友所有的条件技能来源。
    // 它们的差值是在主力自身较弱的施法仍然生效的状态下测量的，
    // 因此是幻影——现在只有队友更强的施法可见。
    if (finalPlayer) {
      for (let i = highlightSources.length - 1; i >= 0; i--) {
        const source = highlightSources[i];
        const uniqueHrids = source.sourceBuffUniqueHrids ?? [];
        if (uniqueHrids.length > 0 && uniqueHrids.every((uniqueHrid) => isPartyOwned(uniqueHrid))) {
          highlightSources.splice(i, 1);
        }
      }
    }
    // 按队友光环来源在最终状态中实际拥有的增益（最强来源规则）
    // 进行归属，而不是按变化的属性键。后来被更强的队友或主力自身
    // 增益覆盖的较弱施法没有产生任何最终变化，不得显示为来源，
    // 即使它仍注册在 finalPlayer.buffSources 中，
    // 以便最强来源过期时能够交接。
    highlightSources.push(
      ...partyAuraResult.highlightSources.filter((source) => {
        const contributorHrid = source.contributorHrid;
        return (source.sourceBuffUniqueHrids ?? []).some(
          (uniqueHrid) => finalPlayer.activeBuffSourceKeys[uniqueHrid] === contributorHrid,
        );
      }),
    );
  }

  const statBreakdowns = buildCombatPreviewStatBreakdowns(attribution.baseValues, finalPlayer, highlightSources);

  return {
    player,
    finalPlayer,
    drinkCards,
    highlightSources,
    statBreakdowns,
    // 当队伍光环回放在每个队友施法结算前耗尽全部事件预算时为 true。
    // 消费方可以显示警告；预览其余部分仍然有效。未提供队伍时为 undefined。
    partyAuraPreviewTruncated: Boolean(partyAuraResult?.truncated),
  };
}

const COMBAT_PREVIEW_STAT_SPEC_KEYS = COMBAT_PREVIEW_STAT_SPECS.map((spec) => spec.key);

export {
  calcCombatLevel,
  COMBAT_PREVIEW_STAT_SPEC_KEYS,
  createEmptyPlayerConfig,
  createEmptySkillExperienceMap,
  EQUIPMENT_SLOT_KEYS,
  isPartyAuraBuff,
  LEVEL_KEYS,
};

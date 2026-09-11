import itemDetailMap from './data/itemDetailMap.json';
import enhancementLevelTotalMultiplierTable from './data/enhancementLevelTotalBonusMultiplierTable.json';

// 装备定义是模块级单例，由所有 Equipment 实例共享。player.js 中的
// 可选总量缓存只比较对象引用，因此对这些表做字段级修改会让缓存
// 悄悄保留过期的总量。冻结这些表可以把这种失效模式变成快速失败的
// TypeError。
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

for (const item of Object.values(itemDetailMap)) {
  if (item?.equipmentDetail) deepFreeze(item.equipmentDetail);
}
deepFreeze(enhancementLevelTotalMultiplierTable);

class Equipment {
  constructor(hrid, enhancementLevel) {
    this.hrid = hrid;
    let gameItem = itemDetailMap[this.hrid];
    if (!gameItem) {
      throw new Error('No equipment found for hrid: ' + this.hrid);
    }
    this.gameItem = gameItem;
    this.enhancementLevel = enhancementLevel;
  }

  static createFromDTO(dto) {
    let equipment = new Equipment(dto.hrid, dto.enhancementLevel);

    return equipment;
  }

  getCombatStat(combatStat) {
    let multiplier = enhancementLevelTotalMultiplierTable[this.enhancementLevel];
    if (this.gameItem.equipmentDetail.combatStats[combatStat]) {
      let enhancementBonus = this.gameItem.equipmentDetail.combatEnhancementBonuses[combatStat] || 0;
      let stat = this.gameItem.equipmentDetail.combatStats[combatStat] + multiplier * enhancementBonus;
      return stat;
    }
    return 0;
  }

  getCombatStyle() {
    return this.gameItem.equipmentDetail.combatStats.combatStyleHrids[0];
  }

  getDamageType() {
    return this.gameItem.equipmentDetail.combatStats.damageType;
  }

  getPrimaryTraining() {
    return this.gameItem.equipmentDetail.combatStats.primaryTraining;
  }

  getFocusTraining() {
    return this.gameItem.equipmentDetail.combatStats.focusTraining;
  }
}

export default Equipment;

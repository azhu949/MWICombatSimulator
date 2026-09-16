import Monster from './monster';
import labyrinthCrateDetailMap from './data/labyrinthCrateDetailMap.json';
import { buildLabyrinthShopUpgradeBuffs } from '../shared/labyrinthShopUpgrades.js';

class Labyrinth {
  constructor(monsterHrid, roomLevel, crates = [], shopUpgrades = null) {
    this.monsterHrid = monsterHrid;
    this.roomLevel = roomLevel;

    this.buffs = [];
    if (crates) {
      for (let crate of crates) {
        this.buffs = this.buffs.concat(labyrinthCrateDetailMap[crate]);
      }
    }

    // 迷宫商店升级 buff（仅迷宫内生效；「永久」指升级等级永久保留。每级 +1%，最高 12 级）。
    // 定义不在 init_client_data 中，见 shared/labyrinthShopUpgrades.js 的来源说明。
    if (shopUpgrades) {
      this.buffs = this.buffs.concat(buildLabyrinthShopUpgradeBuffs(shopUpgrades));
    }
  }

  getMonster() {
    return [new Monster(this.monsterHrid, 0, this.roomLevel)];
  }

  updateEnconterStartTime(enconterStartTime) {
    this.enconterStartTime = enconterStartTime;
  }

  checkTimeout(currentTime) {
    return currentTime - this.enconterStartTime > 120 * 1e9;
  }
}

export default Labyrinth;

import Monster from "./monster";
import labyrinthCrateDetailMap from "./data/labyrinthCrateDetailMap.json"

class Labyrinth{
    constructor(monsterHrid, roomLevel, crates=[]) {
        this.monsterHrid = monsterHrid;
        this.roomLevel = roomLevel;

        this.buffs = [];
        if (crates) {
            for (let crate of crates) {
                this.buffs = this.buffs.concat(labyrinthCrateDetailMap[crate]);
            }
        }
    }

    getMonster () {
        return [new Monster(this.monsterHrid, 0, this.roomLevel)];
    }

    updateEnconterStartTime (enconterStartTime) {
        this.enconterStartTime = enconterStartTime;
    }
    
    checkTimeout (currentTime) {
        return currentTime - this.enconterStartTime > 120 * 1e9;
    }

}

export default Labyrinth;

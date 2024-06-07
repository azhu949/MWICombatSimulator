import actionDetailMap from "./data/actionDetailMap.json";
import Monster from "./monster";

class Zone {
    constructor(hrid) {
        this.hrid = hrid;

        let gameZone = actionDetailMap[this.hrid];
        this.monsterSpawnInfo = gameZone.combatZoneInfo.fightInfo;
        this.encountersKilled = 0;
        this.monsterSpawnInfo.battlesPerBoss = 10;
        this.buffs = gameZone.buffs;
    }

    getRandomEncounter() {

        if (this.monsterSpawnInfo.bossSpawns && this.encountersKilled == this.monsterSpawnInfo.battlesPerBoss) {
            this.encountersKilled = 1;
            return this.monsterSpawnInfo.bossSpawns.map((monster) => new Monster(monster.combatMonsterHrid, monster.eliteTier));
        }

        let totalWeight = this.monsterSpawnInfo.randomSpawnInfo.spawns.reduce((prev, cur) => prev + cur.rate, 0);

        let encounterHrids = [];
        let totalStrength = 0;

        outer: for (let i = 0; i < this.monsterSpawnInfo.randomSpawnInfo.maxSpawnCount; i++) {
            let randomWeight = totalWeight * Math.random();
            let cumulativeWeight = 0;

            for (const spawn of this.monsterSpawnInfo.randomSpawnInfo.spawns) {
                cumulativeWeight += spawn.rate;
                if (randomWeight <= cumulativeWeight) {
                    totalStrength += spawn.strength;

                    if (totalStrength <= this.monsterSpawnInfo.randomSpawnInfo.maxTotalStrength) {
                        encounterHrids.push({ 'hrid': spawn.combatMonsterHrid, 'eliteTier': spawn.eliteTier });
                    } else {
                        break outer;
                    }
                    break;
                }
            }
        }
        this.encountersKilled++;
        return encounterHrids.map((hrid) => new Monster(hrid.hrid, hrid.eliteTier));
    }
}

export default Zone;

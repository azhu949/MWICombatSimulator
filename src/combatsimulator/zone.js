import actionDetailMap from "./data/actionDetailMap.json";
import Monster from "./monster";

class Zone {
    constructor(hrid, difficultyTier) {
        this.hrid = hrid;
        this.difficultyTier = difficultyTier;

        let gameZone = actionDetailMap[this.hrid];
        this.monsterSpawnInfo = gameZone.combatZoneInfo.fightInfo;
        this.dungeonSpawnInfo = gameZone.combatZoneInfo.dungeonInfo;
        this.baseTimeCost = Number.isFinite(Number(gameZone?.baseTimeCost))
            ? Math.max(0, Number(gameZone.baseTimeCost))
            : 0;
        this.encountersKilled = 1;
        this.monsterSpawnInfo.battlesPerBoss = 10;
        this.buffs = gameZone.buffs;
        this.isDungeon = gameZone.combatZoneInfo.isDungeon;
        this.dungeonsCompleted = 0;
        this.dungeonsFailed = 0;
        this.finalWave = false;
    }

    buildEncounterFromSpawnInfo(randomSpawnInfo) {
        const totalWeight = randomSpawnInfo.spawns.reduce((prev, cur) => prev + cur.rate, 0);
        const encounterHrids = [];
        let totalStrength = 0;

        outer: for (let i = 0; i < randomSpawnInfo.maxSpawnCount; i++) {
            const randomWeight = totalWeight * Math.random();
            let cumulativeWeight = 0;

            for (const spawn of randomSpawnInfo.spawns) {
                cumulativeWeight += spawn.rate;
                if (randomWeight <= cumulativeWeight) {
                    totalStrength += spawn.strength;

                    if (totalStrength <= randomSpawnInfo.maxTotalStrength) {
                        encounterHrids.push({
                            hrid: spawn.combatMonsterHrid,
                            difficultyTier: spawn.difficultyTier,
                        });
                    } else {
                        break outer;
                    }
                    break;
                }
            }
        }

        return encounterHrids.map((entry) => new Monster(entry.hrid, entry.difficultyTier + this.difficultyTier));
    }

    getRandomEncounter() {

        if (this.monsterSpawnInfo.bossSpawns && this.encountersKilled == this.monsterSpawnInfo.battlesPerBoss) {
            this.encountersKilled = 1;
            return this.monsterSpawnInfo.bossSpawns.map((monster) => new Monster(monster.combatMonsterHrid, monster.difficultyTier + this.difficultyTier));
        }

        this.encountersKilled++;
        return this.buildEncounterFromSpawnInfo(this.monsterSpawnInfo.randomSpawnInfo);
    }

    failWave() {
        this.dungeonsFailed++;
        this.encountersKilled = 1;
    }

    getNextWave() {
        if (this.encountersKilled > this.dungeonSpawnInfo.maxWaves) {
            this.dungeonsCompleted++;
            this.encountersKilled = 1;
        }
        // console.log("Wave #" + this.encountersKilled);
        if (this.dungeonSpawnInfo.fixedSpawnsMap.hasOwnProperty(this.encountersKilled.toString())) {
            let currentMonsters = this.dungeonSpawnInfo.fixedSpawnsMap[(this.encountersKilled).toString()];
            this.encountersKilled++;
            return currentMonsters.map((monster) => new Monster(monster.combatMonsterHrid, monster.difficultyTier + this.difficultyTier));
        } else {
            let monsterSpawns = {};
            const waveKeys = Object.keys(this.dungeonSpawnInfo.randomSpawnInfoMap).map(Number).sort((a, b) => a - b);
            if (this.encountersKilled > waveKeys[waveKeys.length - 1]) {
                monsterSpawns = this.dungeonSpawnInfo.randomSpawnInfoMap[waveKeys[waveKeys.length - 1]];
            } else {
                for (let i = 0; i < waveKeys.length - 1; i++) {
                    if (this.encountersKilled >= waveKeys[i] && this.encountersKilled <= waveKeys[i + 1]) {
                        monsterSpawns = this.dungeonSpawnInfo.randomSpawnInfoMap[waveKeys[i]];
                        break;
                    }
                }
            }
            let totalWeight = monsterSpawns.spawns.reduce((prev, cur) => prev + cur.rate, 0);

            let encounterHrids = [];
            let totalStrength = 0;

            outer: for (let i = 0; i < monsterSpawns.maxSpawnCount; i++) {
                let randomWeight = totalWeight * Math.random();
                let cumulativeWeight = 0;

                for (const spawn of monsterSpawns.spawns) {
                    cumulativeWeight += spawn.rate;
                    if (randomWeight <= cumulativeWeight) {
                        totalStrength += spawn.strength;

                        if (totalStrength <= monsterSpawns.maxTotalStrength) {
                            encounterHrids.push({ 'hrid': spawn.combatMonsterHrid, 'difficultyTier': spawn.difficultyTier});

                        } else {
                            break outer;
                        }
                        break;
                    }
                }
            }
            this.encountersKilled++;
            return encounterHrids.map((hrid) => new Monster(hrid.hrid, hrid.difficultyTier + this.difficultyTier));
        }
    }
}

export default Zone;

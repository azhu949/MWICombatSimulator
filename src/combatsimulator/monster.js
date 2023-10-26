import Ability from "./ability";
import CombatUnit from "./combatUnit";
import combatMonsterDetailMap from "./data/combatMonsterDetailMap.json";
import Drops from "./drops";

class Monster extends CombatUnit {
    constructor(hrid) {
        super();

        this.isPlayer = false;
        this.hrid = hrid;

        let gameMonster = combatMonsterDetailMap[this.hrid];
        if (!gameMonster) {
            throw new Error("No monster found for hrid: " + this.hrid);
        }

        for (let i = 0; i < gameMonster.abilities.length; i++) {
            this.abilities[i] = new Ability(gameMonster.abilities[i].abilityHrid, gameMonster.abilities[i].level);
        }
        for (let i = 0; i < gameMonster.dropTable.length; i++) {
            this.dropTable[i] = new Drops(gameMonster.dropTable[i].itemHrid, gameMonster.dropTable[i].dropRate, gameMonster.dropTable[i].minCount, gameMonster.dropTable[i].maxCount);
        }
        for (let i = 0; i < gameMonster.rareDropTable.length; i++) {
            this.rareDropTable[i] = new Drops(gameMonster.rareDropTable[i].itemHrid, gameMonster.rareDropTable[i].dropRate, gameMonster.rareDropTable[i].minCount, gameMonster.rareDropTable[i].maxCount);
        }
    }

    updateCombatDetails() {
        let gameMonster = combatMonsterDetailMap[this.hrid];

        this.staminaLevel = gameMonster.combatDetails.staminaLevel;
        this.intelligenceLevel = gameMonster.combatDetails.intelligenceLevel;
        this.attackLevel = gameMonster.combatDetails.attackLevel;
        this.powerLevel = gameMonster.combatDetails.powerLevel;
        this.defenseLevel = gameMonster.combatDetails.defenseLevel;
        this.rangedLevel = gameMonster.combatDetails.rangedLevel;
        this.magicLevel = gameMonster.combatDetails.magicLevel;

        this.combatDetails.combatStats.combatStyleHrid = gameMonster.combatDetails.combatStats.combatStyleHrids[0];

        for (const [key, value] of Object.entries(gameMonster.combatDetails.combatStats)) {
            this.combatDetails.combatStats[key] = value;
        }

        this.combatDetails.combatStats.attackInterval = gameMonster.combatDetails.attackInterval;

        super.updateCombatDetails();
    }
}

export default Monster;

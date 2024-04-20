import Ability from "./ability";
import CombatUnit from "./combatUnit";
import combatMonsterDetailMap from "./data/combatMonsterDetailMap.json";
import Drops from "./drops";

class Monster extends CombatUnit {

    isElite;

    constructor(hrid, isElite = false) {
        super();

        this.isPlayer = false;
        this.hrid = hrid;
        this.isElite = isElite;

        let gameMonster = combatMonsterDetailMap[this.hrid];
        if (!gameMonster) {
            throw new Error("No monster found for hrid: " + this.hrid);
        }

        for (let i = 0; i < gameMonster.abilities.length; i++) {
            if (!this.isElite && gameMonster.abilities[i].isEliteOnly) {
                continue;
            }
            this.abilities[i] = new Ability(gameMonster.abilities[i].abilityHrid, gameMonster.abilities[i].level);
        }
        for (let i = 0; i < gameMonster.dropTable.length; i++) {
            this.dropTable[i] = new Drops(gameMonster.dropTable[i].itemHrid, gameMonster.dropTable[i].dropRate, gameMonster.dropTable[i].minCount, gameMonster.dropTable[i].maxCount, gameMonster.dropTable[i].isEliteOnly);
        }
        for (let i = 0; i < gameMonster.rareDropTable.length; i++) {
            this.rareDropTable[i] = new Drops(gameMonster.rareDropTable[i].itemHrid, gameMonster.rareDropTable[i].dropRate, gameMonster.rareDropTable[i].minCount, gameMonster.rareDropTable[i].maxCount, gameMonster.dropTable[i].isEliteOnly);
        }
    }

    updateCombatDetails() {
        let gameMonster = combatMonsterDetailMap[this.hrid];

        if (this.isElite) {
            this.staminaLevel = gameMonster.eliteCombatDetails.staminaLevel;
            this.intelligenceLevel = gameMonster.eliteCombatDetails.intelligenceLevel;
            this.attackLevel = gameMonster.eliteCombatDetails.attackLevel;
            this.powerLevel = gameMonster.eliteCombatDetails.powerLevel;
            this.defenseLevel = gameMonster.eliteCombatDetails.defenseLevel;
            this.rangedLevel = gameMonster.eliteCombatDetails.rangedLevel;
            this.magicLevel = gameMonster.eliteCombatDetails.magicLevel;

            this.combatDetails.combatStats.combatStyleHrid = gameMonster.eliteCombatDetails.combatStats.combatStyleHrids[0];

            for (const [key, value] of Object.entries(gameMonster.eliteCombatDetails.combatStats)) {
                this.combatDetails.combatStats[key] = value;
            }

            this.combatDetails.combatStats.attackInterval = gameMonster.eliteCombatDetails.attackInterval;
        } else {
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
        }

        super.updateCombatDetails();
    }
}

export default Monster;

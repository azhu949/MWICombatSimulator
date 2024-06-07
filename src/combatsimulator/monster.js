import Ability from "./ability";
import CombatUnit from "./combatUnit";
import combatMonsterDetailMap from "./data/combatMonsterDetailMap.json";
import Drops from "./drops";

class Monster extends CombatUnit {

    eliteTier = 0;

    constructor(hrid, eliteTier = 0) {
        super();

        this.isPlayer = false;
        this.hrid = hrid;
        this.eliteTier = eliteTier;

        let gameMonster = combatMonsterDetailMap[this.hrid];
        if (!gameMonster) {
            throw new Error("No monster found for hrid: " + this.hrid);
        }

        for (let i = 0; i < gameMonster.abilities.length; i++) {
            if (gameMonster.abilities[i].minEliteTier > this.eliteTier) {
                continue;
            }
            this.abilities[i] = new Ability(gameMonster.abilities[i].abilityHrid, gameMonster.abilities[i].level);
        }
        for (let i = 0; i < gameMonster.dropTable.length; i++) {
            this.dropTable[i] = new Drops(gameMonster.dropTable[i].itemHrid, gameMonster.dropTable[i].dropRate, gameMonster.dropTable[i].minCount, gameMonster.dropTable[i].maxCount, gameMonster.dropTable[i].eliteTier);
        }
        for (let i = 0; i < gameMonster.rareDropTable.length; i++) {
            this.rareDropTable[i] = new Drops(gameMonster.rareDropTable[i].itemHrid, gameMonster.rareDropTable[i].dropRate, gameMonster.rareDropTable[i].minCount, gameMonster.rareDropTable[i].maxCount, gameMonster.dropTable[i].eliteTier);
        }
    }

    updateCombatDetails() {
        let gameMonster = combatMonsterDetailMap[this.hrid];

        switch (this.eliteTier) {
            case 2:
                this.staminaLevel = gameMonster.elite2CombatDetails.staminaLevel;
                this.intelligenceLevel = gameMonster.elite2CombatDetails.intelligenceLevel;
                this.attackLevel = gameMonster.elite2CombatDetails.attackLevel;
                this.powerLevel = gameMonster.elite2CombatDetails.powerLevel;
                this.defenseLevel = gameMonster.elite2CombatDetails.defenseLevel;
                this.rangedLevel = gameMonster.elite2CombatDetails.rangedLevel;
                this.magicLevel = gameMonster.elite2CombatDetails.magicLevel;

                this.combatDetails.combatStats.combatStyleHrid = gameMonster.elite2CombatDetails.combatStats.combatStyleHrids[0];

                for (const [key, value] of Object.entries(gameMonster.elite2CombatDetails.combatStats)) {
                    this.combatDetails.combatStats[key] = value;
                }

                this.combatDetails.combatStats.attackInterval = gameMonster.elite2CombatDetails.attackInterval;
                break;
            case 1:
                this.staminaLevel = gameMonster.elite1CombatDetails.staminaLevel;
                this.intelligenceLevel = gameMonster.elite1CombatDetails.intelligenceLevel;
                this.attackLevel = gameMonster.elite1CombatDetails.attackLevel;
                this.powerLevel = gameMonster.elite1CombatDetails.powerLevel;
                this.defenseLevel = gameMonster.elite1CombatDetails.defenseLevel;
                this.rangedLevel = gameMonster.elite1CombatDetails.rangedLevel;
                this.magicLevel = gameMonster.elite1CombatDetails.magicLevel;

                this.combatDetails.combatStats.combatStyleHrid = gameMonster.elite1CombatDetails.combatStats.combatStyleHrids[0];

                for (const [key, value] of Object.entries(gameMonster.elite1CombatDetails.combatStats)) {
                    this.combatDetails.combatStats[key] = value;
                }

                this.combatDetails.combatStats.attackInterval = gameMonster.elite1CombatDetails.attackInterval;
                break;
            default:
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
                break;
        }

        super.updateCombatDetails();
    }
}

export default Monster;

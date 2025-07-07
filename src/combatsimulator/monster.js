import Ability from "./ability";
import CombatUnit from "./combatUnit";
import combatMonsterDetailMap from "./data/combatMonsterDetailMap.json";
import Drops from "./drops";

class Monster extends CombatUnit {

    difficultyTier = 0;

    constructor(hrid, difficultyTier = 0) {
        super();

        this.isPlayer = false;
        this.hrid = hrid;
        this.difficultyTier = difficultyTier;

        let gameMonster = combatMonsterDetailMap[this.hrid];
        if (!gameMonster) {
            throw new Error("No monster found for hrid: " + this.hrid);
        }

        for (let i = 0; i < gameMonster.abilities.length; i++) {
            if (gameMonster.abilities[i].minDifficultyTier > this.difficultyTier) {
                continue;
            }
            this.abilities[i] = new Ability(gameMonster.abilities[i].abilityHrid, gameMonster.abilities[i].level);
        }
        if(gameMonster.dropTable)
        for (let i = 0; i < gameMonster.dropTable.length; i++) {
            this.dropTable[i] = new Drops(gameMonster.dropTable[i].itemHrid, gameMonster.dropTable[i].dropRate, gameMonster.dropTable[i].minCount, gameMonster.dropTable[i].maxCount, gameMonster.dropTable[i].difficultyTier);
        }
        for (let i = 0; i < gameMonster.rareDropTable.length; i++) {
            let dropTableItem = (gameMonster.dropTable && i < gameMonster.dropTable.length) ? gameMonster.dropTable[i] : null;
            let difficultyTier = dropTableItem?.difficultyTier ?? gameMonster.rareDropTable[i].minDifficultyTier;

            this.rareDropTable[i] = new Drops(gameMonster.rareDropTable[i].itemHrid, gameMonster.rareDropTable[i].dropRate, gameMonster.rareDropTable[i].minCount, difficultyTier);
        }
    }

    updateCombatDetails() {
        let gameMonster = combatMonsterDetailMap[this.hrid];

        let a = 1 + .2 * this.difficultyTier;
        let i = 20 * this.difficultyTier;

        this.staminaLevel = a * (gameMonster.combatDetails.staminaLevel + i);
        this.intelligenceLevel = a * (gameMonster.combatDetails.intelligenceLevel + i);
        this.attackLevel = a * (gameMonster.combatDetails.attackLevel + i);
        this.powerLevel = a * (gameMonster.combatDetails.powerLevel + i);
        this.defenseLevel = a * (gameMonster.combatDetails.defenseLevel + i);
        this.rangedLevel = a * (gameMonster.combatDetails.rangedLevel + i);
        this.magicLevel = a * (gameMonster.combatDetails.magicLevel + i);

        let t = this.difficultyTier;
        let e = gameMonster.experience;
        this.experience = (1 + .2 * t) * (e + 10 * t);

        this.combatDetails.combatStats.combatStyleHrid = gameMonster.combatDetails.combatStats.combatStyleHrids[0];

        for (const [key, value] of Object.entries(gameMonster.combatDetails.combatStats)) {
            this.combatDetails.combatStats[key] = value;
        }

        [
            "stabAccuracy",
            "slashAccuracy",
            "smashAccuracy",
            "rangedAccuracy",
            "magicAccuracy",
            "stabDamage",
            "slashDamage",
            "smashDamage",
            "rangedDamage",
            "magicDamage",
            "taskDamage",
            "physicalAmplify",
            "waterAmplify",
            "natureAmplify",
            "fireAmplify",
            "healingAmplify",
            "stabEvasion",
            "slashEvasion",
            "smashEvasion",
            "rangedEvasion",
            "magicEvasion",
            "armor",
            "waterResistance",
            "natureResistance",
            "fireResistance",
            "maxHitpoints",
            "maxManapoints",
            "lifeSteal",
            "hpRegenPer10",
            "mpRegenPer10",
            "physicalThorns",
            "elementalThorns",
            "combatDropRate",
            "combatRareFind",
            "combatDropQuantity",
            "combatExperience",
            "criticalRate",
            "criticalDamage",
            "armorPenetration",
            "waterPenetration",
            "naturePenetration",
            "firePenetration",
            "abilityHaste",
            "tenacity",
            "manaLeech",
            "castSpeed",
            "threat",
            "parry",
            "mayhem",
            "pierce",
            "curse",
            "fury",
            "weaken",
            "ripple",
            "bloom",
            "blaze",
            "attackSpeed",
            "foodHaste",
            "drinkConcentration",
            "autoAttackDamage",
            "abilityDamage"
        ].forEach((stat) => {
            if (gameMonster.combatDetails.combatStats[stat] == null) {
                this.combatDetails.combatStats[stat] = 0;
            }
        });

        this.combatDetails.combatStats.attackInterval = gameMonster.combatDetails.attackInterval;

        super.updateCombatDetails();
    }
}

export default Monster;

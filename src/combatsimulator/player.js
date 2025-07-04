import Ability from "./ability";
import CombatUnit from "./combatUnit";
import Consumable from "./consumable";
import Equipment from "./equipment";
import HouseRoom from "./houseRoom";

class Player extends CombatUnit {
    equipment = {
        "/equipment_types/head": null,
        "/equipment_types/body": null,
        "/equipment_types/legs": null,
        "/equipment_types/feet": null,
        "/equipment_types/hands": null,
        "/equipment_types/main_hand": null,
        "/equipment_types/two_hand": null,
        "/equipment_types/off_hand": null,
        "/equipment_types/pouch": null,
        "/equipment_types/back": null,
    };

    constructor() {
        super();

        this.isPlayer = true;
        this.hrid = "player";
    }

    static expTable = {
        1: 0
       ,2: 33
       ,3: 76
       ,4: 132
       ,5: 202
       ,6: 286
       ,7: 386
       ,8: 503
       ,9: 637
       ,10: 791
       ,11: 964
       ,12: 1159
       ,13: 1377
       ,14: 1620
       ,15: 1891
       ,16: 2192
       ,17: 2525
       ,18: 2893
       ,19: 3300
       ,20: 3750
       ,21: 4247
       ,22: 4795
       ,23: 5400
       ,24: 6068
       ,25: 6805
       ,26: 7618
       ,27: 8517
       ,28: 9508
       ,29: 10604
       ,30: 11814
       ,31: 13151
       ,32: 14629
       ,33: 16262
       ,34: 18068
       ,35: 20064
       ,36: 22271
       ,37: 24712
       ,38: 27411
       ,39: 30396
       ,40: 33697
       ,41: 37346
       ,42: 41381
       ,43: 45842
       ,44: 50773
       ,45: 56222
       ,46: 62243
       ,47: 68895
       ,48: 76242
       ,49: 84355
       ,50: 93311
       ,51: 103195
       ,52: 114100
       ,53: 126127
       ,54: 139390
       ,55: 154009
       ,56: 170118
       ,57: 187863
       ,58: 207403
       ,59: 228914
       ,60: 252584
       ,61: 278623
       ,62: 307256
       ,63: 338731
       ,64: 373318
       ,65: 411311
       ,66: 453030
       ,67: 498824
       ,68: 549074
       ,69: 604193
       ,70: 664632
       ,71: 730881
       ,72: 803472
       ,73: 882985
       ,74: 970050
       ,75: 1065351
       ,76: 1169633
       ,77: 1283701
       ,78: 1408433
       ,79: 1544780
       ,80: 1693774
       ,81: 1856536
       ,82: 2034279
       ,83: 2228321
       ,84: 2440088
       ,85: 2671127
       ,86: 2923113
       ,87: 3197861
       ,88: 3497335
       ,89: 3823663
       ,90: 4179145
       ,91: 4566274
       ,92: 4987741
       ,93: 5446463
       ,94: 5945587
       ,95: 6488521
       ,96: 7078945
       ,97: 7720834
       ,98: 8418485
       ,99: 9176537
       ,100: 10000000
       ,101: 11404976
       ,102: 12904567
       ,103: 14514400
       ,104: 16242080
       ,105: 18095702
       ,106: 20083886
       ,107: 22215808
       ,108: 24501230
       ,109: 26950540
       ,110: 29574787
       ,111: 32385721
       ,112: 35395838
       ,113: 38618420
       ,114: 42067584
       ,115: 45758332
       ,116: 49706603
       ,117: 53929328
       ,118: 58444489
       ,119: 63271179
       ,120: 68429670
       ,121: 73941479
       ,122: 79829440
       ,123: 86117783
       ,124: 92832214
       ,125: 100000000
       ,126: 114406130
       ,127: 130118394
       ,128: 147319656
       ,129: 166147618
       ,130: 186752428
       ,131: 209297771
       ,132: 233962072
       ,133: 260939787
       ,134: 290442814
       ,135: 322702028
       ,136: 357968938
       ,137: 396517495
       ,138: 438646053
       ,139: 484679494
       ,140: 534971538
       ,141: 589907252
       ,142: 649905763
       ,143: 715423218
       ,144: 786955977
       ,145: 865044093
       ,146: 950275074
       ,147: 1043287971
       ,148: 1144777804
       ,149: 1255500373
       ,150: 1376277458
       ,151: 1508002470
       ,152: 1651646566
       ,153: 1808265285
       ,154: 1979005730
       ,155: 2165114358
       ,156: 2367945418
       ,157: 2588970089
       ,158: 2829786381
       ,159: 3092129857
       ,160: 3377885250
       ,161: 3689099031
       ,162: 4027993033
       ,163: 4396979184
       ,164: 4798675471
       ,165: 5235923207
       ,166: 5711805728
       ,167: 6229668624
       ,168: 6793141628
       ,169: 7406162301
       ,170: 8073001662
       ,171: 8798291902
       ,172: 9587056372
       ,173: 10444742007
       ,174: 11377254401
       ,175: 12390995728
       ,176: 13492905745
       ,177: 14690506120
       ,178: 15991948361
       ,179: 17406065609
       ,180: 18942428633
       ,181: 20611406335
       ,182: 22424231139
       ,183: 24393069640
       ,184: 26531098945
       ,185: 28852589138
       ,186: 31372992363
       ,187: 34109039054
       ,188: 37078841860
       ,189: 40302007875
       ,190: 43799759843
       ,191: 47595067021
       ,192: 51712786465
       ,193: 56179815564
       ,194: 61025256696
       ,195: 66280594953
       ,196: 71979889960
       ,197: 78159982881
       ,198: 84860719814
       ,199: 92125192822
       ,200: 100000000000
   };

    static createFromDTO(dto) {
        let player = new Player();

        player.staminaLevel = dto.staminaLevel;
        player.intelligenceLevel = dto.intelligenceLevel;
        // player.attackLevel = dto.attackLevel; 使用映射后的攻击等级
        player.powerLevel = dto.powerLevel;
        player.defenseLevel = dto.defenseLevel;
        player.rangedLevel = dto.rangedLevel;
        player.magicLevel = dto.magicLevel;

        let attackExp = this.expTable[dto.attackLevel];
        if (player.rangedLevel > 1){
            attackExp += (this.expTable[player.rangedLevel] + this.expTable[player.rangedLevel+1])/2*0.1;
        }
        if (player.magicLevel > 1){
            attackExp += (this.expTable[player.magicLevel] + this.expTable[player.magicLevel+1])/2*0.1;
        }
        
        for (const [key, value] of Object.entries(this.expTable)) {
            if (attackExp >= value){
                player.attackLevel = Number(key);
            }
        }
        console.log(dto.hrid, 'attackLevel before:', dto.attackLevel, 'after:', player.attackLevel);

        player.hrid = dto.hrid;

        for (const [key, value] of Object.entries(dto.equipment)) {
            player.equipment[key] = value ? Equipment.createFromDTO(value) : null;
        }

        player.food = dto.food.map((food) => (food ? Consumable.createFromDTO(food) : null));
        player.drinks = dto.drinks.map((drink) => (drink ? Consumable.createFromDTO(drink) : null));
        player.abilities = dto.abilities.map((ability) => (ability ? Ability.createFromDTO(ability) : null));
        Object.entries(dto.houseRooms).forEach(houseRoom => {
            if (houseRoom[1] > 0) {
                player.houseRooms.push(new HouseRoom(houseRoom[0], houseRoom[1]))
            }
        });

        return player;
    }

    updateCombatDetails() {
        if (this.equipment["/equipment_types/main_hand"]) {
            this.combatDetails.combatStats.combatStyleHrid =
                this.equipment["/equipment_types/main_hand"].getCombatStyle();
            this.combatDetails.combatStats.damageType = this.equipment["/equipment_types/main_hand"].getDamageType();
            this.combatDetails.combatStats.attackInterval =
                this.equipment["/equipment_types/main_hand"].getCombatStat("attackInterval");
        } else if (this.equipment["/equipment_types/two_hand"]) {
            this.combatDetails.combatStats.combatStyleHrid =
                this.equipment["/equipment_types/two_hand"].getCombatStyle();
            this.combatDetails.combatStats.damageType = this.equipment["/equipment_types/two_hand"].getDamageType();
            this.combatDetails.combatStats.attackInterval =
                this.equipment["/equipment_types/two_hand"].getCombatStat("attackInterval");
        } else {
            this.combatDetails.combatStats.combatStyleHrid = "/combat_styles/smash";
            this.combatDetails.combatStats.damageType = "/damage_types/physical";
            this.combatDetails.combatStats.attackInterval = 3000000000;
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
            this.combatDetails.combatStats[stat] = Object.values(this.equipment)
                .filter((equipment) => equipment != null)
                .map((equipment) => equipment.getCombatStat(stat))
                .reduce((prev, cur) => prev + cur, 0);
        });

        if (this.equipment["/equipment_types/pouch"]) {
            this.combatDetails.combatStats.foodSlots =
                1 + this.equipment["/equipment_types/pouch"].getCombatStat("foodSlots");
            this.combatDetails.combatStats.drinkSlots =
                1 + this.equipment["/equipment_types/pouch"].getCombatStat("drinkSlots");
        } else {
            this.combatDetails.combatStats.foodSlots = 1;
            this.combatDetails.combatStats.drinkSlots = 1;
        }

        super.updateCombatDetails();
    }
}

export default Player;

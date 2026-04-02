import { describe, expect, it } from "vitest";
import abilityDetailMap from "../../combatsimulator/data/abilityDetailMap.json";
import itemDetailMap from "../../combatsimulator/data/itemDetailMap.json";
import { buildPlayersForSimulation, createEmptyPlayerConfig } from "../playerMapper.js";

function findFirstEquipmentByType(type) {
    return Object.values(itemDetailMap).find(
        (item) => item.categoryHrid === "/item_categories/equipment" && item.equipmentDetail?.type === type
    );
}

function findFirstItemByCategory(categoryHrid) {
    return Object.values(itemDetailMap).find(
        (item) => item.categoryHrid === categoryHrid && Array.isArray(item.consumableDetail?.defaultCombatTriggers)
    );
}

function findFirstItemWithoutDefaultTriggers(categoryHrid) {
    return Object.values(itemDetailMap).find(
        (item) => item.categoryHrid === categoryHrid
            && item.consumableDetail
            && !Array.isArray(item.consumableDetail.defaultCombatTriggers)
    );
}

function findFirstNonSpecialAbility() {
    return Object.values(abilityDetailMap).find((ability) => !ability.isSpecialAbility && Array.isArray(ability.defaultCombatTriggers));
}

describe("playerMapper", () => {
    it("creates a valid empty player config", () => {
        const player = createEmptyPlayerConfig(1);

        expect(player.id).toBe("1");
        expect(player.selected).toBe(true);
        expect(player.levels.stamina).toBe(1);
        expect(player.skillExperience.stamina).toBeNull();
        expect(player.food).toHaveLength(3);
        expect(player.drinks).toHaveLength(3);
        expect(player.abilities).toHaveLength(5);
    });

    it("maps selected player config to simulation players", () => {
        const player1 = createEmptyPlayerConfig(1);
        const player2 = createEmptyPlayerConfig(2);
        player2.selected = false;

        player1.levels.stamina = 10;
        player1.levels.attack = 12;
        player1.levels.melee = 14;

        const head = findFirstEquipmentByType("/equipment_types/head");
        const weapon = findFirstEquipmentByType("/equipment_types/main_hand")
            || findFirstEquipmentByType("/equipment_types/two_hand");
        const food = findFirstItemByCategory("/item_categories/food");
        const drink = findFirstItemByCategory("/item_categories/drink");
        const ability = findFirstNonSpecialAbility();

        expect(head).toBeTruthy();
        expect(weapon).toBeTruthy();
        expect(food).toBeTruthy();
        expect(drink).toBeTruthy();
        expect(ability).toBeTruthy();

        player1.equipment.head.itemHrid = head.hrid;
        player1.equipment.weapon.itemHrid = weapon.hrid;
        player1.equipment.weapon.enhancementLevel = 3;

        player1.food[0] = food.hrid;
        player1.drinks[0] = drink.hrid;
        player1.abilities[0].abilityHrid = ability.hrid;
        player1.abilities[0].level = 1;

        // Explicit empty triggers should disable default trigger conditions for this target.
        player1.triggerMap[food.hrid] = [];
        player1.triggerMap[ability.hrid] = [];

        const players = buildPlayersForSimulation([player1, player2]);

        expect(players).toHaveLength(1);
        expect(players[0].hrid).toBe("player1");
        expect(players[0].staminaLevel).toBe(10);
        expect(players[0].attackLevel).toBe(12);
        expect(players[0].meleeLevel).toBe(14);
        expect(players[0].equipment["/equipment_types/head"]?.hrid).toBe(head.hrid);
        expect(players[0].food[0]?.hrid).toBe(food.hrid);
        expect(players[0].drinks[0]?.hrid).toBe(drink.hrid);
        expect(players[0].food[0]?.triggers).toHaveLength(0);
        expect(players[0].abilities[0]?.hrid).toBe(ability.hrid);
        expect(players[0].abilities[0]?.triggers).toHaveLength(0);
    });

    it("ignores stale trinket slot data when building combat players", () => {
        const player = createEmptyPlayerConfig(1);
        const trinket = findFirstEquipmentByType("/equipment_types/trinket");

        expect(trinket).toBeTruthy();
        expect(player.equipment).not.toHaveProperty("trinket");

        player.equipment.trinket = {
            itemHrid: trinket.hrid,
            enhancementLevel: 0,
        };

        const players = buildPlayersForSimulation([player]);

        expect(players[0].equipment["/equipment_types/trinket"]).toBeUndefined();
        expect(players[0].combatDetails.combatStats.taskDamage).toBe(0);
    });

    it("build output is worker-cloneable", () => {
        const player = createEmptyPlayerConfig(1);
        player.achievements["/achievements/gather_milk"] = true;

        const players = buildPlayersForSimulation([player]);

        expect(() => structuredClone({ players })).not.toThrow();
    });

    it("treats consumables without default combat triggers as triggerless", () => {
        const player = createEmptyPlayerConfig(1);
        const drink = findFirstItemWithoutDefaultTriggers("/item_categories/drink");

        expect(drink).toBeTruthy();

        player.drinks[0] = drink.hrid;

        const players = buildPlayersForSimulation([player]);

        expect(players[0].drinks[0]?.hrid).toBe(drink.hrid);
        expect(players[0].drinks[0]?.triggers).toEqual([]);
    });
});

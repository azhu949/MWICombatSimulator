import { describe, expect, it } from "vitest";
import abilityDetailMap from "../../combatsimulator/data/abilityDetailMap.json";
import itemDetailMap from "../../combatsimulator/data/itemDetailMap.json";
import { buildCombatPreviewData, buildPlayersForCombatPreview, buildPlayersForSimulation, createEmptyPlayerConfig } from "../playerMapper.js";

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

function findDrinkWithoutCombatPreviewChanges() {
    return Object.values(itemDetailMap).find((item) => {
        if (item.categoryHrid !== "/item_categories/drink") {
            return false;
        }

        const player = createEmptyPlayerConfig(1);
        player.drinks[0] = item.hrid;

        return buildCombatPreviewData(player).drinkCards[0]?.changedStats.length === 0;
    });
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

    it("applies housing permanent buffs only in combat preview builds", () => {
        const player = createEmptyPlayerConfig(1);
        player.levels.stamina = 50;
        player.levels.attack = 50;
        player.houseRooms["/house_rooms/dining_room"] = 3;
        player.houseRooms["/house_rooms/dojo"] = 2;
        player.houseRooms["/house_rooms/library"] = 4;

        const [simulationPlayer] = buildPlayersForSimulation([player]);
        const [previewPlayer] = buildPlayersForCombatPreview([player]);

        expect(simulationPlayer.combatDetails.maxHitpoints).toBeLessThan(previewPlayer.combatDetails.maxHitpoints);
        expect(simulationPlayer.combatDetails.attackLevel).toBeLessThan(previewPlayer.combatDetails.attackLevel);
        expect(simulationPlayer.combatDetails.combatStats.hpRegenPer10).toBeLessThan(previewPlayer.combatDetails.combatStats.hpRegenPer10);
        expect(simulationPlayer.combatDetails.combatStats.castSpeed).toBeLessThan(previewPlayer.combatDetails.combatStats.castSpeed);
        expect(simulationPlayer.combatDetails.combatStats.combatExperience).toBeLessThan(previewPlayer.combatDetails.combatStats.combatExperience);
        expect(simulationPlayer.combatDetails.combatStats.combatRareFind).toBeLessThan(previewPlayer.combatDetails.combatStats.combatRareFind);
        expect(previewPlayer.combatDetails.currentHitpoints).toBe(previewPlayer.combatDetails.maxHitpoints);
        expect(previewPlayer.combatDetails.currentManapoints).toBe(previewPlayer.combatDetails.maxManapoints);
    });

    it("applies simulation extras to combat preview data without changing simulation entry builds", () => {
        const player = createEmptyPlayerConfig(1);

        const basePreview = buildCombatPreviewData(player);
        const boostedPreview = buildCombatPreviewData(player, {
            mooPass: true,
            comExp: 20,
            comDrop: 20,
        });
        const [simulationPlayer] = buildPlayersForSimulation([player]);

        expect(basePreview.player.combatDetails.combatStats.combatExperience).toBe(0);
        expect(basePreview.player.combatDetails.combatStats.combatDropQuantity).toBe(0);
        expect(boostedPreview.player.combatDetails.combatStats.combatExperience).toBeCloseTo(0.345, 6);
        expect(boostedPreview.player.combatDetails.combatStats.combatDropQuantity).toBeCloseTo(0.295, 6);
        expect(simulationPlayer.combatDetails.combatStats.combatExperience).toBe(0);
        expect(simulationPlayer.combatDetails.combatStats.combatDropQuantity).toBe(0);
    });

    it("applies dungeon action buffs to combat preview players", () => {
        const player = createEmptyPlayerConfig(1);

        const basePreview = buildCombatPreviewData(player);
        const dungeonPreview = buildCombatPreviewData(player, null, {
            mode: "zone",
            zoneHrid: "/actions/combat/chimerical_den",
            difficultyTier: 0,
            useDungeon: true,
        });

        expect(basePreview.player.combatDetails.combatStats.combatExperience).toBe(0);
        expect(dungeonPreview.player.combatDetails.combatStats.combatExperience).toBeCloseTo(0.2, 6);
    });

    it("applies labyrinth crate buffs to combat preview players", () => {
        const player = createEmptyPlayerConfig(1);

        const basePreview = buildCombatPreviewData(player, null, {
            mode: "labyrinth",
            labyrinthHrid: "/monsters/alligator",
            roomLevel: 100,
            crates: [],
        });
        const labyrinthPreview = buildCombatPreviewData(player, null, {
            mode: "labyrinth",
            labyrinthHrid: "/monsters/alligator",
            roomLevel: 100,
            crates: ["/items/advanced_coffee_crate"],
        });

        expect(
            labyrinthPreview.player.combatDetails.combatStats.castSpeed
            - basePreview.player.combatDetails.combatStats.castSpeed
        ).toBeGreaterThan(0.1);
        expect(
            labyrinthPreview.player.combatDetails.combatStats.combatExperience
            - basePreview.player.combatDetails.combatStats.combatExperience
        ).toBeCloseTo(0.1, 6);
    });

    it("builds drink preview cards with the consumed drink state and effective cooldown", () => {
        const player = createEmptyPlayerConfig(1);
        const pouch = itemDetailMap["/items/guzzling_pouch"];
        const drink = itemDetailMap["/items/channeling_coffee"];

        expect(pouch).toBeTruthy();
        expect(drink).toBeTruthy();

        player.equipment.pouch.itemHrid = pouch.hrid;
        player.drinks[0] = drink.hrid;
        player.triggerMap[drink.hrid] = [];

        const previewData = buildCombatPreviewData(player, null, {
            zoneHrid: "/actions/combat/alligator",
            difficultyTier: 0,
        });

        expect(previewData.player).toBeTruthy();
        expect(previewData.player.combatDetails.combatStats.castSpeed).toBe(buildPlayersForCombatPreview([player])[0].combatDetails.combatStats.castSpeed);
        expect(previewData.drinkCards).toHaveLength(1);

        const [drinkCard] = previewData.drinkCards;
        const castSpeedChange = drinkCard.changedStats.find((entry) => entry.key === "castSpeed");

        expect(drinkCard.triggerMode).toBe("always");
        expect(drinkCard.cooldownSeconds).toBeCloseTo(300 / 1.1, 6);
        expect(castSpeedChange).toBeTruthy();
        expect(castSpeedChange.deltaValue).toBeCloseTo(0.12 * 1.1, 6);
        expect(castSpeedChange.finalValue).toBeGreaterThan(previewData.player.combatDetails.combatStats.castSpeed);
    });

    it("keeps default drink trigger labels when no override is configured", () => {
        const player = createEmptyPlayerConfig(1);
        const drink = itemDetailMap["/items/channeling_coffee"];

        expect(drink).toBeTruthy();

        player.drinks[0] = drink.hrid;

        const previewData = buildCombatPreviewData(player);

        expect(previewData.drinkCards).toHaveLength(1);
        expect(previewData.drinkCards[0].triggerMode).toBe("default");
    });

    it("skips drink highlights and downstream buff inflation when a custom drink trigger is inactive", () => {
        const player = createEmptyPlayerConfig(1);

        player.levels.intelligence = 400;
        player.levels.magic = 400;
        player.drinks[0] = "/items/super_magic_coffee";
        player.triggerMap["/items/super_magic_coffee"] = [{
            dependencyHrid: "/combat_trigger_dependencies/self",
            conditionHrid: "/combat_trigger_conditions/missing_hp",
            comparatorHrid: "/combat_trigger_comparators/greater_than_equal",
            value: 1,
        }];
        player.abilities[0] = { abilityHrid: "/abilities/mystic_aura", level: 1 };

        const previewData = buildCombatPreviewData(player);
        const previewSourceHrids = previewData.highlightSources.map((source) => source.sourceHrid);
        const mysticAuraDelta = previewData.highlightSources
            .find((source) => source.sourceHrid === "/abilities/mystic_aura")
            ?.changedStats.find((entry) => entry.key === "waterAmplify")?.deltaValue;

        expect(previewSourceHrids).not.toContain("/items/super_magic_coffee");
        expect(mysticAuraDelta).toBeCloseTo(0.18, 6);
    });

    it("re-runs drink trigger passes when a later drink unlocks an earlier slot", () => {
        const player = createEmptyPlayerConfig(1);
        const pouch = itemDetailMap["/items/guzzling_pouch"];

        expect(pouch).toBeTruthy();

        player.equipment.pouch.itemHrid = pouch.hrid;
        player.drinks[0] = "/items/super_magic_coffee";
        player.drinks[1] = "/items/channeling_coffee";
        player.triggerMap["/items/super_magic_coffee"] = [{
            dependencyHrid: "/combat_trigger_dependencies/self",
            conditionHrid: "/combat_trigger_conditions/channeling_coffee",
            comparatorHrid: "/combat_trigger_comparators/is_active",
            value: 0,
        }];

        const previewData = buildCombatPreviewData(player);
        const previewDrinkHrids = previewData.highlightSources
            .filter((source) => source.sourceType === "drink")
            .map((source) => source.sourceHrid);

        expect(previewDrinkHrids).toContain("/items/channeling_coffee");
        expect(previewDrinkHrids).toContain("/items/super_magic_coffee");
    });

    it("keeps non-combat drinks visible with timing info even when they do not change battle stats", () => {
        const player = createEmptyPlayerConfig(1);
        const drink = findDrinkWithoutCombatPreviewChanges();

        expect(drink).toBeTruthy();

        player.drinks[0] = drink.hrid;

        const previewData = buildCombatPreviewData(player);

        expect(previewData.drinkCards).toHaveLength(1);
        expect(previewData.drinkCards[0].changedStats).toEqual([]);
        expect(previewData.drinkCards[0].cooldownSeconds).toBeGreaterThanOrEqual(0);
        expect(previewData.drinkCards[0].slotAvailable).toBe(true);
        expect(previewData.drinkCards[0].triggerMode).toBe("default");
    });

    it("surfaces legacy task badges as preview-only task damage highlights", () => {
        const player = createEmptyPlayerConfig(1);
        const taskBadge = itemDetailMap["/items/expert_task_badge"];

        expect(taskBadge).toBeTruthy();

        player.equipment.trinket = {
            itemHrid: taskBadge.hrid,
            enhancementLevel: 0,
        };

        const previewData = buildCombatPreviewData(player);
        const [simulationPlayer] = buildPlayersForSimulation([player]);
        const taskBadgeSource = previewData.highlightSources.find((source) => source.sourceType === "task_badge");
        const taskDamageChange = taskBadgeSource?.changedStats.find((entry) => entry.key === "taskDamage");

        expect(previewData.player.combatDetails.combatStats.taskDamage).toBe(0);
        expect(taskBadgeSource).toBeTruthy();
        expect(taskBadgeSource.sourceHrid).toBe(taskBadge.hrid);
        expect(taskBadgeSource.sourceName).toBe(taskBadge.name);
        expect(taskDamageChange).toBeTruthy();
        expect(taskDamageChange.deltaValue).toBeCloseTo(0.15, 6);
        expect(simulationPlayer.equipment["/equipment_types/trinket"]).toBeUndefined();
        expect(simulationPlayer.combatDetails.combatStats.taskDamage).toBe(0);
    });

    it("surfaces equipped buff abilities as conditional combat preview highlights", () => {
        const player = createEmptyPlayerConfig(1);

        player.levels.intelligence = 400;
        player.levels.magic = 400;
        player.abilities[0] = { abilityHrid: "/abilities/elemental_affinity", level: 80 };
        player.abilities[1] = { abilityHrid: "/abilities/mystic_aura", level: 80 };
        player.abilities[2] = { abilityHrid: "/abilities/aqua_arrow", level: 80 };

        const previewData = buildCombatPreviewData(player);
        const abilitySources = previewData.highlightSources.filter((source) => source.sourceType === "ability");
        const elementalAffinitySource = abilitySources.find((source) => source.sourceHrid === "/abilities/elemental_affinity");
        const mysticAuraSource = abilitySources.find((source) => source.sourceHrid === "/abilities/mystic_aura");
        const aquaArrowSource = abilitySources.find((source) => source.sourceHrid === "/abilities/aqua_arrow");

        expect(elementalAffinitySource).toBeTruthy();
        expect(mysticAuraSource).toBeTruthy();
        expect(aquaArrowSource).toBeUndefined();

        for (const source of [elementalAffinitySource, mysticAuraSource]) {
            expect(source.changedStats.find((entry) => entry.key === "waterAmplify")?.deltaValue).toBeGreaterThan(0);
            expect(source.changedStats.find((entry) => entry.key === "natureAmplify")?.deltaValue).toBeGreaterThan(0);
            expect(source.changedStats.find((entry) => entry.key === "fireAmplify")?.deltaValue).toBeGreaterThan(0);
        }

        expect(previewData.player.combatDetails.combatStats.waterAmplify).toBe(0);
        expect(previewData.player.combatDetails.combatStats.natureAmplify).toBe(0);
        expect(previewData.player.combatDetails.combatStats.fireAmplify).toBe(0);
    });

    it("surfaces threat-only buff abilities as conditional combat preview highlights", () => {
        const player = createEmptyPlayerConfig(1);

        player.levels.intelligence = 20;
        player.abilities[0] = { abilityHrid: "/abilities/taunt", level: 1 };
        player.abilities[1] = { abilityHrid: "/abilities/provoke", level: 1 };

        const previewData = buildCombatPreviewData(player);
        const tauntSource = previewData.highlightSources.find((source) => source.sourceHrid === "/abilities/taunt");
        const provokeSource = previewData.highlightSources.find((source) => source.sourceHrid === "/abilities/provoke");

        expect(tauntSource?.changedStats.find((entry) => entry.key === "totalThreat")?.deltaValue).toBeGreaterThan(0);
        expect(provokeSource?.changedStats.find((entry) => entry.key === "totalThreat")?.deltaValue).toBeGreaterThan(0);
        expect(previewData.player.combatDetails.totalThreat).toBe(100);
    });

    it("surfaces enemy-triggered buff abilities when a combat preview enemy is present", () => {
        const player = createEmptyPlayerConfig(1);

        player.levels.intelligence = 20;
        player.levels.magic = 20;
        player.abilities[0] = { abilityHrid: "/abilities/mana_spring", level: 1 };

        const previewData = buildCombatPreviewData(player);
        const manaSpringSource = previewData.highlightSources.find((source) => source.sourceHrid === "/abilities/mana_spring");

        expect(manaSpringSource).toBeTruthy();
        expect(manaSpringSource?.changedStats.find((entry) => entry.key === "mpRegenPer10")?.deltaValue).toBeGreaterThan(0);
    });

    it("uses the selected zone enemy when evaluating targeted-enemy preview triggers", () => {
        const player = createEmptyPlayerConfig(1);

        player.levels.intelligence = 400;
        player.levels.magic = 400;
        player.abilities[0] = { abilityHrid: "/abilities/mystic_aura", level: 80 };
        player.triggerMap["/abilities/mystic_aura"] = [{
            dependencyHrid: "/combat_trigger_dependencies/targeted_enemy",
            conditionHrid: "/combat_trigger_conditions/current_hp",
            comparatorHrid: "/combat_trigger_comparators/greater_than_equal",
            value: 1000,
        }];

        const flyPreview = buildCombatPreviewData(player, null, {
            zoneHrid: "/actions/combat/fly",
            difficultyTier: 0,
        });
        const abyssalImpPreview = buildCombatPreviewData(player, null, {
            zoneHrid: "/actions/combat/abyssal_imp",
            difficultyTier: 0,
        });
        const flyAbilityHrids = flyPreview.highlightSources
            .filter((source) => source.sourceType === "ability")
            .map((source) => source.sourceHrid);
        const abyssalImpAbilityHrids = abyssalImpPreview.highlightSources
            .filter((source) => source.sourceType === "ability")
            .map((source) => source.sourceHrid);

        expect(flyAbilityHrids).not.toContain("/abilities/mystic_aura");
        expect(abyssalImpAbilityHrids).toContain("/abilities/mystic_aura");
    });

    it("uses the selected labyrinth enemy when evaluating targeted-enemy preview triggers", () => {
        const player = createEmptyPlayerConfig(1);

        player.levels.intelligence = 400;
        player.levels.magic = 400;
        player.abilities[0] = { abilityHrid: "/abilities/mystic_aura", level: 80 };
        player.triggerMap["/abilities/mystic_aura"] = [{
            dependencyHrid: "/combat_trigger_dependencies/targeted_enemy",
            conditionHrid: "/combat_trigger_conditions/current_hp",
            comparatorHrid: "/combat_trigger_comparators/greater_than_equal",
            value: 1000,
        }];

        const alligatorPreview = buildCombatPreviewData(player, null, {
            mode: "labyrinth",
            labyrinthHrid: "/monsters/alligator",
            roomLevel: 100,
            crates: [],
        });
        const abyssalImpPreview = buildCombatPreviewData(player, null, {
            mode: "labyrinth",
            labyrinthHrid: "/monsters/abyssal_imp",
            roomLevel: 100,
            crates: [],
        });
        const alligatorAbilityHrids = alligatorPreview.highlightSources
            .filter((source) => source.sourceType === "ability")
            .map((source) => source.sourceHrid);
        const abyssalImpAbilityHrids = abyssalImpPreview.highlightSources
            .filter((source) => source.sourceType === "ability")
            .map((source) => source.sourceHrid);

        expect(alligatorAbilityHrids).not.toContain("/abilities/mystic_aura");
        expect(abyssalImpAbilityHrids).toContain("/abilities/mystic_aura");
    });

    it("applies enemy-triggered opener resource costs before later buff previews", () => {
        const player = createEmptyPlayerConfig(1);

        player.abilities[0] = { abilityHrid: "/abilities/firestorm", level: 1 };
        player.abilities[1] = { abilityHrid: "/abilities/elemental_affinity", level: 1 };

        const previewData = buildCombatPreviewData(player);
        const previewAbilityHrids = previewData.highlightSources
            .filter((source) => source.sourceType === "ability")
            .map((source) => source.sourceHrid);

        expect(previewAbilityHrids).not.toContain("/abilities/elemental_affinity");
    });

    it("allows enemy-missing-hp triggers after a deterministic preview hit", () => {
        const player = createEmptyPlayerConfig(1);

        player.levels.attack = 400;
        player.levels.melee = 400;
        player.levels.intelligence = 400;
        player.abilities[0] = { abilityHrid: "/abilities/scratch", level: 1 };
        player.abilities[1] = { abilityHrid: "/abilities/elemental_affinity", level: 80 };
        player.triggerMap["/abilities/elemental_affinity"] = [{
            dependencyHrid: "/combat_trigger_dependencies/targeted_enemy",
            conditionHrid: "/combat_trigger_conditions/missing_hp",
            comparatorHrid: "/combat_trigger_comparators/greater_than_equal",
            value: 1,
        }];

        const previewData = buildCombatPreviewData(player, null, {
            zoneHrid: "/actions/combat/alligator",
            difficultyTier: 0,
        });
        const previewAbilityHrids = previewData.highlightSources
            .filter((source) => source.sourceType === "ability")
            .map((source) => source.sourceHrid);

        expect(previewAbilityHrids).toContain("/abilities/elemental_affinity");
    });

    it("does not unlock enemy-missing-hp triggers from low-chance preview misses", () => {
        const player = createEmptyPlayerConfig(1);

        player.levels.intelligence = 400;
        player.abilities[0] = { abilityHrid: "/abilities/scratch", level: 1 };
        player.abilities[1] = { abilityHrid: "/abilities/elemental_affinity", level: 80 };
        player.triggerMap["/abilities/elemental_affinity"] = [{
            dependencyHrid: "/combat_trigger_dependencies/targeted_enemy",
            conditionHrid: "/combat_trigger_conditions/missing_hp",
            comparatorHrid: "/combat_trigger_comparators/greater_than_equal",
            value: 1,
        }];

        const previewData = buildCombatPreviewData(player, null, {
            zoneHrid: "/actions/combat/black_bear",
            difficultyTier: 10,
        });
        const previewAbilityHrids = previewData.highlightSources
            .filter((source) => source.sourceType === "ability")
            .map((source) => source.sourceHrid);

        expect(previewAbilityHrids).not.toContain("/abilities/elemental_affinity");
    });

    it("re-runs food triggers after ability casts before previewing later buffs", () => {
        const player = createEmptyPlayerConfig(1);

        player.levels.intelligence = 1;
        player.levels.magic = 1;
        player.food[0] = "/items/apple_gummy";
        player.abilities[0] = { abilityHrid: "/abilities/critical_aura", level: 1 };
        player.abilities[1] = { abilityHrid: "/abilities/insanity", level: 1 };

        const previewData = buildCombatPreviewData(player);
        const previewAbilityHrids = previewData.highlightSources
            .filter((source) => source.sourceType === "ability")
            .map((source) => source.sourceHrid);

        expect(previewAbilityHrids).toContain("/abilities/critical_aura");
        expect(previewAbilityHrids).toContain("/abilities/insanity");
    });

    it("re-runs drink triggers after ability casts before previewing later buffs", () => {
        const player = createEmptyPlayerConfig(1);

        player.levels.intelligence = 400;
        player.levels.magic = 400;
        player.drinks[0] = "/items/super_magic_coffee";
        player.triggerMap["/items/super_magic_coffee"] = [{
            dependencyHrid: "/combat_trigger_dependencies/self",
            conditionHrid: "/combat_trigger_conditions/missing_mp",
            comparatorHrid: "/combat_trigger_comparators/greater_than_equal",
            value: 1,
        }];
        player.abilities[0] = { abilityHrid: "/abilities/elemental_affinity", level: 80 };
        player.abilities[1] = { abilityHrid: "/abilities/mystic_aura", level: 80 };

        const previewData = buildCombatPreviewData(player);
        const previewSourceHrids = previewData.highlightSources.map((source) => source.sourceHrid);
        const mysticAuraDelta = previewData.highlightSources
            .find((source) => source.sourceHrid === "/abilities/mystic_aura")
            ?.changedStats.find((entry) => entry.key === "waterAmplify")?.deltaValue;

        expect(previewSourceHrids).toContain("/items/super_magic_coffee");
        expect(previewSourceHrids).toContain("/abilities/mystic_aura");
        expect(mysticAuraDelta).toBeGreaterThan(0.19);
    });

    it("preserves mana depletion when previewing later buff abilities", () => {
        const player = createEmptyPlayerConfig(1);

        player.levels.intelligence = 20;
        player.levels.magic = 20;
        player.abilities[0] = { abilityHrid: "/abilities/taunt", level: 1 };
        player.abilities[1] = { abilityHrid: "/abilities/provoke", level: 1 };
        player.abilities[2] = { abilityHrid: "/abilities/mystic_aura", level: 1 };

        const previewData = buildCombatPreviewData(player);
        const previewAbilityHrids = previewData.highlightSources
            .filter((source) => source.sourceType === "ability")
            .map((source) => source.sourceHrid);

        expect(previewAbilityHrids).toContain("/abilities/taunt");
        expect(previewAbilityHrids).toContain("/abilities/provoke");
        expect(previewAbilityHrids).not.toContain("/abilities/mystic_aura");
    });

    it("stops previewing later abilities when an earlier slot is out of mana", () => {
        const player = createEmptyPlayerConfig(1);

        player.abilities[0] = { abilityHrid: "/abilities/provoke", level: 1 };
        player.abilities[1] = { abilityHrid: "/abilities/elemental_affinity", level: 1 };

        const previewData = buildCombatPreviewData(player);
        const previewAbilityHrids = previewData.highlightSources
            .filter((source) => source.sourceType === "ability")
            .map((source) => source.sourceHrid);

        expect(previewAbilityHrids).not.toContain("/abilities/provoke");
        expect(previewAbilityHrids).not.toContain("/abilities/elemental_affinity");
    });

    it("keeps revisiting zero-cooldown opener slots before later buffs", () => {
        const player = createEmptyPlayerConfig(1);

        player.abilities[0] = { abilityHrid: "/abilities/fireball", level: 1 };
        player.abilities[1] = { abilityHrid: "/abilities/elemental_affinity", level: 1 };

        const previewData = buildCombatPreviewData(player);
        const previewAbilityHrids = previewData.highlightSources
            .filter((source) => source.sourceType === "ability")
            .map((source) => source.sourceHrid);

        expect(previewAbilityHrids).not.toContain("/abilities/elemental_affinity");
    });

    it("restarts ability preview from the first slot after later buffs change trigger state", () => {
        const player = createEmptyPlayerConfig(1);

        player.levels.intelligence = 400;
        player.levels.magic = 400;
        player.abilities[0] = { abilityHrid: "/abilities/mystic_aura", level: 80 };
        player.abilities[1] = { abilityHrid: "/abilities/elemental_affinity", level: 80 };
        player.triggerMap["/abilities/mystic_aura"] = [{
            dependencyHrid: "/combat_trigger_dependencies/self",
            conditionHrid: "/combat_trigger_conditions/elemental_affinity",
            comparatorHrid: "/combat_trigger_comparators/is_active",
            value: 0,
        }];

        const previewData = buildCombatPreviewData(player);
        const previewAbilityHrids = previewData.highlightSources
            .filter((source) => source.sourceType === "ability")
            .map((source) => source.sourceHrid);

        expect(previewAbilityHrids).toContain("/abilities/elemental_affinity");
        expect(previewAbilityHrids).toContain("/abilities/mystic_aura");
    });

    it("surfaces retaliation-only buff abilities as combat preview highlights", () => {
        const player = createEmptyPlayerConfig(1);

        player.levels.intelligence = 20;
        player.abilities[0] = { abilityHrid: "/abilities/retribution", level: 1 };

        const previewData = buildCombatPreviewData(player);
        const retributionSource = previewData.highlightSources.find((source) => source.sourceHrid === "/abilities/retribution");

        expect(retributionSource).toBeTruthy();
        expect(retributionSource?.changedStats.find((entry) => entry.key === "retaliation")?.deltaValue).toBeGreaterThan(0);
    });

    it("includes earlier drink-based level buffs when calculating later special ability highlights", () => {
        const player = createEmptyPlayerConfig(1);

        player.levels.intelligence = 400;
        player.levels.magic = 400;
        player.abilities[0] = { abilityHrid: "/abilities/mystic_aura", level: 1 };

        const withoutCoffee = buildCombatPreviewData(player);
        const baseAuraDelta = withoutCoffee.highlightSources
            .find((source) => source.sourceHrid === "/abilities/mystic_aura")
            ?.changedStats.find((entry) => entry.key === "waterAmplify")?.deltaValue;

        player.drinks[0] = "/items/super_magic_coffee";
        player.triggerMap["/items/super_magic_coffee"] = [];

        const withCoffee = buildCombatPreviewData(player);
        const coffeeAuraDelta = withCoffee.highlightSources
            .find((source) => source.sourceHrid === "/abilities/mystic_aura")
            ?.changedStats.find((entry) => entry.key === "waterAmplify")?.deltaValue;

        expect(baseAuraDelta).toBeCloseTo(0.18, 6);
        expect(coffeeAuraDelta).toBeCloseTo(0.1998, 6);
        expect(coffeeAuraDelta).toBeGreaterThan(baseAuraDelta);
    });
});

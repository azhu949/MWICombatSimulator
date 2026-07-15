import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const homePageSource = readFileSync(new URL("../pages/HomePage.vue", import.meta.url), "utf8");

describe("HomePage labyrinth selectors", () => {
    it("formats labyrinth options and crate options through i18n helpers", () => {
        expect(homePageSource).toContain("{{ formatMonsterName(monster.hrid, monster.name) }}");
        expect(homePageSource).toContain("{{ formatItemName(item.hrid, item.name) }}");
    });

    it("renders a dedicated tea crate selector", () => {
        expect(homePageSource).toContain('getOfficialGameText("labyrinthPanel", "teaCrate", "Tea Crate")');
        expect(homePageSource).toContain('getOfficialGameText("labyrinthPanel", "coffeeCrate", "Coffee Crate")');
        expect(homePageSource).toContain('getOfficialGameText("labyrinthPanel", "foodCrate", "Food Crate")');
        expect(homePageSource).toContain("simulator.options.labyrinthCrates.tea");
        expect(homePageSource).toContain("simulator.setLabyrinthCrate('tea', $event.target.value)");
    });

    it("passes labyrinth preview context into combat preview data", () => {
        expect(homePageSource).toContain('mode: "labyrinth"');
        expect(homePageSource).toContain("labyrinthHrid");
        expect(homePageSource).toContain("roomLevel: Math.max(20, Number(simulator.simulationSettings.roomLevel || 100))");
        expect(homePageSource).toContain("crates: simulator.getActiveLabyrinthCrates()");
    });

    it("renders per-player guild shrine controls", () => {
        expect(homePageSource).toContain('t("common:vue.home.guildBuffsButton", "Guild Shrines")');
        expect(homePageSource).toContain("v-for=\"option in guildBuffOptions\"");
        expect(homePageSource).toContain("setGuildBuffLevel(option.hrid, $event.target.value)");
        expect(homePageSource).toContain("formatGuildBuffEffects(option, guildBuffLevel(option.hrid))");
    });

    it("uses official skill, equipment, combat stat, labyrinth, and MooPass labels", () => {
        expect(homePageSource).toContain("getSkillName(`/skills/${skillKey}`");
        expect(homePageSource).toContain("getEquipmentSlotName(slot, slot)");
        expect(homePageSource).toContain('formatCombatStatName("retaliation", "Retaliation")');
        expect(homePageSource).toContain('getOfficialGameText("labyrinthPanel", "labyrinth", "Labyrinth")');
        expect(homePageSource).toContain('getOfficialGameText("shopCategoryNames", "/shop_categories/dungeon", "Dungeon")');
        expect(homePageSource).toContain('getOfficialGameText("guildPanel", "combat", "Combat")');
        expect(homePageSource).toContain('getOfficialGameText("mooPass", "mooPass", "MooPass")');
        expect(homePageSource).not.toContain("common:vue.home.levelLabels");
        expect(homePageSource).not.toContain("common:vue.home.equipmentLabels");
        expect(homePageSource).not.toContain("common:vue.home.combatStats");
        expect(homePageSource).not.toContain("common:vue.home.dungeon");
        expect(homePageSource).not.toContain("common:vue.home.guildBuffCombat");
        expect(homePageSource).not.toContain("common:settingsPage.playerSnapshotTableLabyrinth");
    });

    it("accepts only player-targeted Tampermonkey imports", () => {
        expect(homePageSource).toContain('const importTarget = String(data.importTarget || "").trim()');
        expect(homePageSource).toContain('if (importTarget && importTarget !== "player")');
    });
});

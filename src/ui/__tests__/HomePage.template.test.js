import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const homePageSource = readFileSync(new URL("../pages/HomePage.vue", import.meta.url), "utf8");

describe("HomePage labyrinth selectors", () => {
    it("formats labyrinth options and crate options through i18n helpers", () => {
        expect(homePageSource).toContain("{{ formatMonsterName(monster.hrid, monster.name) }}");
        expect(homePageSource).toContain("{{ formatItemName(item.hrid, item.name) }}");
    });

    it("renders a dedicated tea crate selector", () => {
        expect(homePageSource).toContain('t("common:teaCrate", "Tea Crate")');
        expect(homePageSource).toContain("simulator.options.labyrinthCrates.tea");
        expect(homePageSource).toContain("simulator.setLabyrinthCrate('tea', $event.target.value)");
    });

    it("passes labyrinth preview context into combat preview data", () => {
        expect(homePageSource).toContain('mode: "labyrinth"');
        expect(homePageSource).toContain("labyrinthHrid");
        expect(homePageSource).toContain("roomLevel: Math.max(20, Number(simulator.simulationSettings.roomLevel || 100))");
        expect(homePageSource).toContain("crates: simulator.getActiveLabyrinthCrates()");
    });
});

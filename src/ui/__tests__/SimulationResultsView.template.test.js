import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const viewSource = readFileSync(new URL("../components/SimulationResultsView.vue", import.meta.url), "utf8");

describe("SimulationResultsView official game labels", () => {
    it("uses official skill and combat-stat names throughout result views", () => {
        expect(viewSource).toContain("getSkillName(column.skillHrid");
        expect(viewSource).toContain('getCombatStatName("staminaExperience"');
        expect(viewSource).toContain('getCombatStatName("retaliation"');
        expect(viewSource).toContain('getBuffTypeName("/buff_types/damage"');
        expect(viewSource).toContain('getOfficialGameText("combatUnit", "autoAttack"');
        expect(viewSource).toContain('getOfficialGameText("ability", "ability", "Ability")');
        expect(viewSource).not.toContain("common:vue.home.levelLabels");
        expect(viewSource).not.toContain("common:vue.home.combatStats");
        expect(viewSource).not.toContain("common:vue.results.retaliation");
    });

    it("floors scroll durations and normalizes hour boundaries", () => {
        expect(viewSource).toContain("const totalWholeMinutes = Math.floor(totalMinutes);");
        expect(viewSource).toContain("const minutes = totalWholeMinutes % 60;");
        expect(viewSource).not.toContain("Math.round(totalMinutes)");
    });

    it("shows scroll usage rows or an explicit paused state", () => {
        expect(viewSource).toContain(
            "activeScrollUsageDisabled.value || activeScrollUsageRows.value.length > 0"
        );
        expect(viewSource).toContain("activeScrollUsage.value?.root?.disabled === true");
        expect(viewSource).toContain("common:vue.results.scrollsDisabled");
        expect(viewSource).not.toContain("Boolean(activeScrollUsage.value)");
        expect(viewSource).not.toContain("noCombatScrollsUsed");
    });
});

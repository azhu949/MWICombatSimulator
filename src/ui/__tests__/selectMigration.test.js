import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const homeSource = readFileSync(new URL("../pages/HomePage.vue", import.meta.url), "utf8");
const enhancementSource = readFileSync(new URL("../pages/EnhancementPage.vue", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../pages/SettingsPage.vue", import.meta.url), "utf8");
const skillingSource = readFileSync(new URL("../pages/SkillingPage.vue", import.meta.url), "utf8");
const resultsSource = readFileSync(new URL("../components/SimulationResultsView.vue", import.meta.url), "utf8");

describe("select migration coverage", () => {
    it("uses Reka Select for the Home short lists", () => {
        expect(homeSource).toContain('<Select v-model="profileSelectorPlayerId">');
        expect(homeSource).toContain('<Select v-model="dungeonToggleProxy">');
        expect(homeSource).not.toContain("<NativeSelect");
    });

    it("uses searchable controls for large game-data lists", () => {
        expect(homeSource).toContain(':options="currentActionComboboxOptions"');
        expect(homeSource).not.toContain('<Select v-model="selectedActionHrid">');
        expect(homeSource).toContain(":options=\"equipmentComboboxOptionsBySlot[slot] || []\"");
        expect(homeSource).toContain(":options=\"drinkComboboxOptions\"");
        expect(enhancementSource).toContain(":options=\"supportEquipmentComboboxOptions(slot.key)\"");
    });

    it("keeps NativeSelect only for the grouped equipment-type filter", () => {
        const nativeSelectUses = [homeSource, enhancementSource, settingsSource, skillingSource, resultsSource]
            .map((source) => source.match(/<NativeSelect\b/g)?.length || 0)
            .reduce((total, count) => total + count, 0);
        expect(nativeSelectUses).toBe(1);
        expect(enhancementSource).toContain("<optgroup v-for=\"group in itemTypeGroups\"");
    });

    it("moves settings, skilling, and result selectors to Reka Select", () => {
        expect(settingsSource).not.toContain("<NativeSelect");
        expect(skillingSource).not.toContain("<NativeSelect");
        expect(resultsSource).toContain("<Select v-model=\"selectedWipeEventIndex\">");
    });
});

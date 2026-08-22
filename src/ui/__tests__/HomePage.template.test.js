import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath) {
    return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const sources = {
    page: readSource("../pages/HomePage.vue"),
    levels: readSource("../components/home/HomeLevelsPanel.vue"),
    simulation: readSource("../components/home/HomeSimulationPanel.vue"),
    equipment: readSource("../components/home/HomeEquipmentPanel.vue"),
    loadout: readSource("../components/home/HomeLoadoutPanels.vue"),
    combatAttributes: readSource("../components/home/HomeCombatAttributesPanel.vue"),
    guildBuffs: readSource("../components/home/HomeGuildBuffsModal.vue"),
    playerSnapshot: readSource("../components/home/HomePlayerSnapshotModal.vue"),
    combatPreview: readSource("../composables/useHomeCombatPreview.js"),
    workspaceSummary: readSource("../composables/useHomeWorkspaceSummary.js"),
};

function componentCount(source, componentName) {
    return source.match(new RegExp(`<${componentName}\\b`, "g"))?.length || 0;
}

describe("Home simulation controls", () => {
    it("formats labyrinth and crate options through game-data helpers", () => {
        expect(sources.simulation).toContain("getMonsterName(");
        expect(sources.simulation).toContain("getItemName(");
        expect(sources.simulation).toContain('{ key: "tea", labelKey: "teaCrate", fallback: "Tea Crate" }');
        expect(sources.simulation).toContain('{ key: "coffee", labelKey: "coffeeCrate", fallback: "Coffee Crate" }');
        expect(sources.simulation).toContain('{ key: "food", labelKey: "foodCrate", fallback: "Food Crate" }');
    });

    it("passes complete labyrinth context into combat preview data", () => {
        expect(sources.combatPreview).toContain('mode: "labyrinth"');
        expect(sources.combatPreview).toContain("labyrinthHrid");
        expect(sources.combatPreview).toContain("LABYRINTH_ROOM_LEVEL_MIN");
        expect(sources.combatPreview).toContain("LABYRINTH_ROOM_LEVEL_DEFAULT");
        expect(sources.combatPreview).toContain("crates: simulator.getActiveLabyrinthCrates()");
    });
});

describe("Home localized panels", () => {
    it("renders per-player guild shrine controls", () => {
        expect(sources.guildBuffs).toContain("common:vue.home.guildBuffs.title");
        expect(sources.guildBuffs).toContain('v-for="option in guildBuffOptions"');
        expect(sources.guildBuffs).toContain("setGuildBuffLevel(option.hrid, $event.target.value)");
        expect(sources.guildBuffs).toContain("formatGuildBuffEffects(option, guildBuffLevel(option.hrid))");
    });

    it("uses triggered final stats and localized source breakdowns", () => {
        expect(sources.combatPreview).toContain("data.value.finalPlayer || data.value.player");
        expect(sources.combatPreview).toContain("buildCombatStatBreakdownParts(breakdown, entry.key");
        expect(sources.combatPreview).toContain('source.sourceType === "guild_buff"');
        expect(sources.combatPreview).toContain("getGuildShrineName(source.sourceHrid");
        expect(sources.combatAttributes).toContain('v-for="part in entry.breakdownParts"');
    });

    it("groups combat attributes into semantic tactical sections", () => {
        for (const key of ["overview", "offense", "defense", "effects", "rewards"]) {
            expect(sources.combatPreview).toContain(`key: "${key}"`);
        }
        expect(sources.combatAttributes).toContain('v-for="section in sections"');
        expect(sources.combatAttributes).toContain("grid gap-3 md:grid-cols-2 xl:grid-cols-3");
        expect(sources.combatAttributes).toContain("entry.hasSources");
        expect(sources.combatAttributes).toContain("part.kind === 'source'");
        expect(sources.combatAttributes).toContain(':title="entry.breakdownText"');
    });

    it("uses official labels in each responsible panel", () => {
        expect(sources.levels).toContain("getSkillName(`/skills/${skillKey}`");
        expect(sources.equipment).toContain("getEquipmentSlotName(slot, slot)");
        expect(sources.combatPreview).toContain('statName("retaliation", "Retaliation")');
        expect(sources.simulation).toContain('getOfficialGameText("labyrinthPanel", "labyrinth", "Labyrinth")');
        expect(sources.simulation).toContain(
            'getOfficialGameText("shopCategoryNames", "/shop_categories/dungeon", "Dungeon")',
        );
        expect(sources.guildBuffs).toContain('getOfficialGameText("guildPanel", "combat", "Combat")');
        expect(sources.simulation).toContain('getOfficialGameText("mooPass", "mooPass", "MooPass")');
        expect(sources.playerSnapshot).toContain('getOfficialGameText("labyrinthPanel", "labyrinth", "Labyrinth")');
    });
});

describe("Home workspace tabs", () => {
    it("defines base, battle attributes, and complete results tabs", () => {
        for (const value of ["base", "advanced", "results"]) {
            expect(sources.workspaceSummary).toContain(`value: "${value}"`);
        }
        expect(sources.workspaceSummary).not.toContain('value: "build"');
    });

    it("groups build controls in base and isolates derived attributes", () => {
        expect(sources.page.match(/activeWorkspaceTab === 'base'/g)).toHaveLength(3);
        expect(sources.page).toContain("activeWorkspaceTab === 'advanced'");
        expect(sources.page).not.toContain("activeWorkspaceTab === 'build'");
        expect(sources.equipment).toContain('getOfficialGameText("equipmentPanel", "title", "Equipment")');
        expect(sources.loadout).toContain('t("common:vue.home.foodDrinksTitle", "Food & Drinks")');
        expect(sources.loadout).toContain('getOfficialGameText("abilitiesPanel", "title", "Abilities")');
    });

    it("renders complete results in a full-width results tab", () => {
        expect(sources.page).toContain('v-if="activeWorkspaceTab === \'results\'" ref="homeResultsSection"');
        expect(sources.page).toContain('<AsyncSimulationResultsView v-if="homeHasResults" />');
        expect(sources.page).toContain("v-if=\"activeWorkspaceTab !== 'results'\"");
        expect(sources.page).not.toContain("completeResultsExpanded");
    });

    it("routes summary and focus links to the results tab", () => {
        expect(sources.page).toContain('requestWorkspaceTabChange("results")');
        expect(sources.page).toContain(
            'homeResultsSection.value?.scrollIntoView({ behavior: "smooth", block: "start" })',
        );
        expect(sources.page).toContain("const { focus, ...query } = route.query");
        expect(sources.page).toContain("await openHomeResultsPanel(true)");
    });

    it("surfaces a party aura preview truncation warning when the replay hits its event budget", () => {
        expect(sources.page).toContain("combatPreview.partyAuraPreviewTruncated.value");
        expect(sources.page).toContain("data-party-aura-preview-truncated");
        expect(sources.page).toContain("common:vue.home.partyAuraPreviewTruncated");
        expect(sources.combatPreview).toContain("partyAuraPreviewTruncated: computed(");
    });
});

describe("Home inline trigger layout", () => {
    it("connects one inline editor for each food, drink, and ability row", () => {
        expect(componentCount(sources.loadout, "InlineTriggerEditor")).toBe(3);
        expect(sources.loadout).toContain("triggerController.request('food', slotIndex - 1)");
        expect(sources.loadout).toContain("triggerController.request('drink', slotIndex - 1)");
        expect(sources.loadout).toContain("triggerController.request('ability', slotIndex - 1)");
        expect(sources.loadout).not.toContain("openTriggerEditor");
    });

    it("groups full-width food rows before full-width drink rows", () => {
        expect(sources.loadout).toContain('v-for="slotIndex in 3" :key="`food-${slotIndex}`" class="grid gap-2"');
        expect(sources.loadout).toContain('v-for="slotIndex in 3" :key="`drink-${slotIndex}`" class="grid gap-2"');
        expect(sources.loadout.indexOf("`food-${slotIndex}`")).toBeLessThan(
            sources.loadout.indexOf("`drink-${slotIndex}`"),
        );
    });

    it("offsets the sticky summary below the application shell", () => {
        expect(sources.page).toContain("top: calc(var(--app-sticky-shell-height, 3rem) + 1rem)");
        expect(sources.page).not.toContain("xl:top-24");
    });
});

describe("Home enhancement pricing", () => {
    it("places the enhancement input beside its equipment selector", () => {
        expect(sources.equipment).toContain("grid-cols-[minmax(0,1fr)_5rem]");
        expect(sources.equipment).toContain("data-equipment-input-row");
    });

    it("shows exact-ask and zero-baseline warnings without manual cost input", () => {
        expect(sources.equipment).toContain("costDraft.targetAskAvailable");
        expect(sources.equipment).toContain("common:vue.home.enhancementAskMissing");
        expect(sources.equipment).toContain("costDraft.baselineSaleZero");
        expect(sources.equipment).toContain("common:vue.home.baselineSaleZero");
        expect(sources.equipment).not.toContain("manualNetUpgradeCost");
        expect(sources.equipment).not.toContain("onEquipmentUpgradeCostChanged");
    });
});

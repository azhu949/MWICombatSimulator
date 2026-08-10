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
        expect(homePageSource).toContain("setLabyrinthCrateSelection('tea', $event)");
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

describe("HomePage workspace tabs", () => {
    it("uses base, battle attributes, and complete results as the three tabs", () => {
        expect(homePageSource).toContain('value: "base"');
        expect(homePageSource).toContain('value: "advanced"');
        expect(homePageSource).toContain('value: "results"');
        expect(homePageSource).not.toContain('value: "build"');
        expect(homePageSource).not.toContain('workspaceTabs.build');
    });

    it("groups build controls into base setup and isolates derived attributes", () => {
        expect(homePageSource.match(/activeWorkspaceTab === 'base'/g)).toHaveLength(3);
        expect(homePageSource).not.toContain("activeWorkspaceTab === 'build'");
        expect(homePageSource).toContain("activeWorkspaceTab === 'advanced'");
        expect(homePageSource).toContain('getOfficialGameText("equipmentPanel", "title", "Equipment")');
        expect(homePageSource).toContain('t("common:vue.home.foodDrinksTitle", "Food & Drinks")');
        expect(homePageSource).toContain('getOfficialGameText("abilitiesPanel", "title", "Abilities")');
    });

    it("renders complete results directly in a full-width results tab", () => {
        expect(homePageSource).toContain("v-if=\"activeWorkspaceTab === 'results'\" ref=\"homeResultsSection\"");
        expect(homePageSource).toContain('<AsyncSimulationResultsView v-if="homeHasResults" />');
        expect(homePageSource).toContain("v-if=\"activeWorkspaceTab !== 'results'\"");
        expect(homePageSource).not.toContain("completeResultsExpanded");
        expect(homePageSource).not.toContain("toggleCompleteResultsPanel");
    });

    it("routes summary and focus links to the results tab", () => {
        expect(homePageSource).toContain('requestWorkspaceTabChange("results")');
        expect(homePageSource).toContain('homeResultsSection.value?.scrollIntoView({ behavior: "smooth", block: "start" })');
        expect(homePageSource).toContain('const { focus, ...query } = route.query');
        expect(homePageSource).toContain('await openHomeResultsPanel(true)');
    });
});

describe("HomePage inline trigger editing", () => {
    it("uses the inline editor for food, drinks, and abilities without a trigger modal", () => {
        expect(homePageSource.match(/<InlineTriggerEditor/g)).toHaveLength(3);
        expect(homePageSource).toContain("requestTriggerEditor('food', slotIndex - 1)");
        expect(homePageSource).toContain("requestTriggerEditor('drink', slotIndex - 1)");
        expect(homePageSource).toContain("requestTriggerEditor('ability', slotIndex - 1)");
        expect(homePageSource).not.toContain('BaseModal :open="triggerModal.open"');
        expect(homePageSource).not.toContain("openTriggerEditor");
    });

    it("groups full-width food rows before full-width drink rows", () => {
        expect(homePageSource).toContain('v-for="slotIndex in 3" :key="`food-${slotIndex}`" class="grid gap-2"');
        expect(homePageSource).toContain('v-for="slotIndex in 3" :key="`drink-${slotIndex}`" class="grid gap-2"');
        expect(homePageSource).not.toContain('`food-${slotIndex}`" class="grid gap-2 sm:grid-cols-2"');
        expect(homePageSource.indexOf('`food-${slotIndex}`')).toBeLessThan(homePageSource.indexOf('`drink-${slotIndex}`'));
    });

    it("keeps one editor target and protects dirty drafts", () => {
        expect(homePageSource).toContain('const triggerEditor = reactive({');
        expect(homePageSource).toContain('if (triggerEditor.kind && triggerEditor.dirty)');
        expect(homePageSource).toContain('if (isTriggerEditorActive(kind, index) && triggerEditor.dirty)');
        expect(homePageSource).toContain('simulator.setActivePlayerTriggers(triggerEditor.hrid, sanitizeTriggerList(nextRules))');
        expect(homePageSource).toContain('() => activePlayer.value');
        expect(homePageSource).toContain('resetTriggerEditor();');
    });

    it("keeps a dirty trigger draft on its player until it is saved or cancelled", () => {
        expect(homePageSource).toContain("let restoringTriggerEditorPlayer = false;");
        expect(homePageSource).toContain("triggerEditor.kind\n      && triggerEditor.dirty");
        expect(homePageSource).toContain("simulator.setActivePlayer(previousPlayerId);");
        expect(homePageSource).toContain("showTriggerEditorBlockedMessage();");
    });

    it("does not hide a dirty editor or retain it across player replacement", () => {
        expect(homePageSource).toContain(':model-value="activeWorkspaceTab"');
        expect(homePageSource).toContain('@update:model-value="requestWorkspaceTabChange"');
        expect(homePageSource).toContain('if (triggerEditor.kind && triggerEditor.dirty)');
        expect(homePageSource).toContain('if (triggerEditor.kind && nextPlayer !== previousPlayer)');
        expect(homePageSource).toContain('onBeforeRouteLeave(() => {');
    });

    it("blocks imports and snapshot restores while a trigger draft is dirty", () => {
        expect(homePageSource).toContain("function blockPlayerConfigReplacement()");
        expect(homePageSource.match(/if \(blockPlayerConfigReplacement\(\)\)/g)).toHaveLength(4);
        expect(homePageSource).toContain('ok: false');
        expect(homePageSource).toContain('message: triggerEditor.blockedMessage');
    });

    it("offsets the sticky summary below the measured application shell", () => {
        expect(homePageSource).toContain('top: calc(var(--app-sticky-shell-height, 3rem) + 1rem)');
        expect(homePageSource).not.toContain('xl:top-24');
    });
});

describe("HomePage enhancement pricing", () => {
    it("places the enhancement input beside its equipment selector", () => {
        expect(homePageSource).toContain('grid-cols-[minmax(0,1fr)_5rem]');
        expect(homePageSource).toContain("data-equipment-input-row");
        expect(homePageSource).toContain('aria-hidden="true">+</span>');
        expect(homePageSource).toContain("`${equipmentLabelMap[slot]} ${t('common:vue.home.enhancement', 'Enhancement')}`");
    });

    it("shows missing exact ask and zero baseline sale without manual equipment cost input", () => {
        expect(homePageSource).toContain("costDraft.targetAskAvailable");
        expect(homePageSource).toContain("common:vue.home.enhancementAskMissing");
        expect(homePageSource).toContain("costDraft.baselineSaleZero");
        expect(homePageSource).toContain("common:vue.home.baselineSaleZero");
        expect(homePageSource).toContain('v-if="equipmentHintViewModel[slot].costDraft.baselineSaleZero"');
        expect(homePageSource).not.toContain("costDraft.isManual");
        expect(homePageSource).not.toContain("manualNetUpgradeCost");
        expect(homePageSource).not.toContain("onEquipmentUpgradeCostChanged");
    });
});

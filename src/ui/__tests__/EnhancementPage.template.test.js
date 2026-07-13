import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("../pages/EnhancementPage.vue", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("../router/index.js", import.meta.url), "utf8");

describe("EnhancementPage tool surface", () => {
    it("registers a dedicated route without the combat toolbar", () => {
        expect(routerSource).toContain('path: "/enhancement"');
        expect(routerSource).toContain('name: "enhancement"');
        expect(routerSource).toContain("meta: { showCombatToolbar: false }");
        expect(routerSource).toContain('import("../pages/EnhancementPage.vue")');
    });

    it("binds the independent enhancement store and initializes it", () => {
        expect(pageSource).toContain('useEnhancementStore } from "../../stores/enhancementStore.js"');
        expect(pageSource).toContain("const enhancement = useEnhancementStore();");
        expect(pageSource).toContain("await enhancement.initialize();");
        expect(pageSource).toContain("enhancement.config.startLevel");
        expect(pageSource).toContain("enhancement.config.targetLevel");
    });

    it("uses official item names for the fixed tea buff controls", () => {
        expect(pageSource).toContain('getGameItemName("/items/blessed_tea"');
        expect(pageSource).toContain('getGameItemName("/items/wisdom_tea"');
    });

    it("uses official names for game-defined enhancement labels", () => {
        expect(pageSource).toContain('getBuffTypeName("/buff_types/enhancing_level"');
        expect(pageSource).toContain('getHouseRoomName("/house_rooms/observatory"');
        expect(pageSource).toContain('getEquipmentTypeName(');
        expect(pageSource).toContain('getAchievementTierName(tierHrid, fallbackName)');
        expect(pageSource).toContain('getGameItemName("/items/philosophers_mirror"');
        expect(pageSource).not.toContain("common:enhancement.observatoryLevel");
        expect(pageSource).not.toContain("common:enhancement.slotBody");
    });

    it("accepts enhancement-only imports from the Tampermonkey bridge", () => {
        expect(pageSource).toContain('data-tm-import-anchor="enhancement-actions"');
        expect(pageSource).toContain('data-tm-import-reference="enhancement-refresh"');
        expect(pageSource).toContain("applyTampermonkeyEnhancementImportMessage");
        expect(pageSource).toContain('data.importTarget !== "enhancement"');
        expect(pageSource).toContain('window.addEventListener("message", handleTampermonkeyEnhancementImportWindowMessage)');
        expect(pageSource).toContain('window.removeEventListener("message", handleTampermonkeyEnhancementImportWindowMessage)');
    });

    it("renders searchable, filterable, favorite item selection", () => {
        expect(pageSource).toContain('data-enhancement-item-search');
        expect(pageSource).toContain("enhancement.itemFilters.equipmentType");
        expect(pageSource).toContain("item.equipmentType !== enhancement.itemFilters.equipmentType");
        expect(pageSource).toContain("itemTypeGroups");
        expect(pageSource).toContain("<optgroup");
        expect(pageSource).toContain("enhancement.itemFilters.favoritesOnly");
        expect(pageSource).toContain("enhancement.toggleFavorite(item.hrid)");
        expect(pageSource).toContain("ensureItemIconSymbols");
        expect(pageSource).toContain("itemIconHref(item.hrid)");
        expect(pageSource).toContain("data-enhancement-item-icon");
        expect(pageSource).toContain("data-enhancement-selected-item-icon");
        expect(pageSource).toContain("itemIconHref(enhancement.config.itemHrid)");
        expect(pageSource).toContain("watch(() => enhancement.config.itemHrid");
        expect(pageSource).toContain("data-enhancement-favorite-items");
        expect(pageSource).toContain("grid-cols-3");
        expect(pageSource).toContain("lg:grid-cols-7");
        expect(pageSource).toContain('role="list"');
        expect(pageSource).toContain('officialItemName(item, "zh").toLowerCase()');
        expect(pageSource).toContain('officialItemName(item, "en").toLowerCase()');
        expect(pageSource).toContain("{ language: targetLanguage }");
        expect(pageSource).not.toContain("equipmentTypeName(item.equipmentType).toLowerCase().includes(query)");
        expect(pageSource).not.toContain('String(item.name || "").toLowerCase().includes(query)');
        expect(pageSource).toContain("enhancement-item-row");
        expect(pageSource).toContain("common:enhancement.expectedResets");
        expect(pageSource).toContain('rowValue(row, "expectedResetCount", "expectedResets", "resetCount")');
        expect(pageSource).not.toContain("strategySuccessRate(row)");
    });

    it("covers configuration, pricing, strategy, mirror, decomposition, and risk views", () => {
        expect(pageSource).toContain("data-enhancement-config");
        expect(pageSource).toContain("data-enhancement-equipment");
        expect(pageSource).toContain("data-enhancement-prices");
        expect(pageSource).toContain("data-enhancement-strategies");
        expect(pageSource).toContain("common:enhancement.protectionItemUsed");
        expect(pageSource).toContain("data-enhancement-mirror");
        expect(pageSource).toContain("data-enhancement-decomposition");
        expect(pageSource).toContain("data-enhancement-risk");
        expect(pageSource).toContain("enhancement.config.startingItemPriceOverride");
        expect(pageSource).toContain("row.priceMode");
        expect(pageSource).toContain('v-model.number="markupPercent"');
        expect(pageSource).toContain("percent / 100");
    });

    it("uses progressive disclosure to keep the workspace compact", () => {
        expect(pageSource).toContain("data-enhancement-toolbar");
        expect(pageSource).toContain("!py-3");
        expect(pageSource).toContain('const advancedOpen = ref(true)');
        expect(pageSource).toContain('const activeAdvancedTab = ref("bonuses")');
        expect(pageSource).toContain('data-enhancement-advanced-tabs');
        expect(pageSource).toContain("data-enhancement-config-tools");
        expect(pageSource).toContain('const equipmentModalOpen = ref(false)');
        expect(pageSource).toContain('const pricesModalOpen = ref(false)');
        expect(pageSource).toContain(':open="equipmentModalOpen"');
        expect(pageSource).toContain(':open="pricesModalOpen"');
        expect(pageSource).toContain("common:enhancement.materialsAndPrices");
        expect(pageSource).toContain("enhancement-price-modal");
        expect(pageSource).toContain("data-enhancement-starting-price");
        expect(pageSource).toContain("data-enhancement-price-grid");
        expect(pageSource).toContain("sm:grid-cols-2");
        expect(pageSource).toContain("data-enhancement-starting-item-icon");
        expect(pageSource).toContain("data-enhancement-material-icon");
        expect(pageSource).toContain('@click="openPricesModal"');
        expect(pageSource).toContain("...materialRows.value.map((row) => row.hrid)");
        expect(pageSource).toContain("itemIconHref(row.hrid)");
        expect(pageSource).toContain("data-enhancement-acquisition-note");
        expect(pageSource).toContain("acquisitionEstimateSummary");
        expect(pageSource).toContain("acquisitionVendorFloorLabel");
        expect(pageSource).toContain("protectionOptionLabel(item)");
        expect(pageSource).toContain('const activeResultTab = ref("strategies")');
        expect(pageSource).toContain('data-enhancement-result-tabs');
        expect(pageSource).toContain("v-show=\"activeResultTab === 'strategies'\"");
        expect(pageSource).toContain("v-show=\"activeResultTab === 'mirror'\"");
        expect(pageSource).toContain("v-show=\"activeResultTab === 'risk'\"");
        expect(pageSource).toContain("xl:max-h-[460px]");
        expect(pageSource).toContain("handleTabKeydown");
        expect(pageSource).toContain("Math.max(0, Math.min(20, Math.trunc(Number(value) || 0)))");
    });

    it("supports deterministic risk execution, progress, and cancellation", () => {
        expect(pageSource).toContain("enhancement.config.sampleCount");
        expect(pageSource).toContain("enhancement.config.seed");
        expect(pageSource).toContain("enhancement.config.riskStrategy");
        expect(pageSource).toContain("await enhancement.runRisk();");
        expect(pageSource).toContain("enhancement.cancelRisk()");
        expect(pageSource).toContain("riskQuantileDefinitions");
        expect(pageSource).toContain("data-enhancement-risk-quantiles");
        expect(pageSource).toContain("quantile.record");
        expect(pageSource).toContain("data-enhancement-budget-input");
        expect(pageSource).toContain("data-enhancement-budget-unit");
        expect(pageSource).toContain('const budgetUnit = ref("M")');
        expect(pageSource).toContain("convertAmountToBaseUnits");
        expect(pageSource).toContain("handleBudgetInput");
        expect(pageSource).toContain("commitBudgetInput");
        expect(pageSource).toContain("handleBudgetUnit");
        expect(pageSource).toContain('@change="normalizeRiskSampleCount"');
        expect(pageSource).toContain("Math.max(1024, Math.min(1_000_000, sampleCount))");
        expect(pageSource).not.toContain('v-model.number="enhancement.config.budget"');
        expect(pageSource).toContain("riskLoadLabel");
        expect(pageSource).toContain("riskFallbackLabel");
        expect(pageSource).toContain('method === "moment_gamma"');
        expect(pageSource).toContain(':disabled="!enhancement.config.itemHrid || enhancement.riskRunning || !budgetInputValid"');
        expect(pageSource).toContain("source: priceSourceLabel(decompositionValue.value?.priceSource)");
        expect(pageSource).toContain("localizeRiskError");
        expect(pageSource).toContain("row?.materialPricesAvailable === false");
        expect(pageSource).toContain("decompositionValue.value.priceAvailable === false");
    });

    it("keeps dense tables usable on narrow screens", () => {
        expect(pageSource).toContain("overflow-x-auto");
        expect(pageSource).toContain('min-w-[1280px]');
        expect(pageSource).toContain("sm:grid-cols-2");
        expect(pageSource).toContain("xl:grid-cols-");
    });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("../pages/SkillingPage.vue", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("../router/index.js", import.meta.url), "utf8");

describe("SkillingPage workspace", () => {
    it("registers an independent route without combat controls", () => {
        expect(routerSource).toContain('path: "/skilling"');
        expect(routerSource).toContain('name: "skilling"');
        expect(routerSource).toContain('import("../pages/SkillingPage.vue")');
        expect(routerSource).toContain("meta: { showCombatToolbar: false }");
    });

    it("binds the dedicated store, worker actions, and five target controls", () => {
        expect(pageSource).toContain('useSkillingStore } from "../../stores/skillingStore.js"');
        expect(pageSource).toContain("const skilling = useSkillingStore();");
        expect(pageSource).toContain("await skilling.initialize();");
        expect(pageSource).toContain("skilling.targetLevels[skillHrid]");
        expect(pageSource).toContain("await skilling.run();");
        expect(pageSource).toContain("skilling.cancel()");
        expect(pageSource).toContain(':disabled="skilling.priceStatus.loading || skilling.running"');
        expect(pageSource).toContain(':disabled="skilling.running"');
        expect(pageSource).toContain('!skilling.profile || skilling.priceStatus.loading');
    });

    it("offers accessible cost, balanced, and speed optimization modes with an explanation dialog", () => {
        expect(pageSource).toContain("data-skilling-optimization-mode");
        expect(pageSource).toContain("data-skilling-optimization-help");
        expect(pageSource).toContain("data-skilling-optimization-help-dialog");
        expect(pageSource).toContain('role="radiogroup"');
        expect(pageSource).toContain('type="radio"');
        expect(pageSource).toContain('skilling.optimizationMode === mode.value');
        expect(pageSource).toContain('skilling.setOptimizationMode(mode.value)');
        expect(pageSource).toContain('{ value: "cost"');
        expect(pageSource).toContain('{ value: "balanced"');
        expect(pageSource).toContain('{ value: "speed"');
        expect(pageSource).toContain(':disabled="skilling.running"');
        expect(pageSource).toContain('common:skilling.lowestCostPerXp');
        expect(pageSource).toContain('common:skilling.balanced');
        expect(pageSource).toContain('common:skilling.speedFirst');
        expect(pageSource).toContain('common:skilling.optimizationModeHelp');
        expect(pageSource).toContain('max-w-3xl max-h-[88vh] overflow-y-auto overscroll-contain');
        expect(pageSource).toContain('common:skilling.costModeDescription');
        expect(pageSource).toContain('common:skilling.balancedModeDescription');
        expect(pageSource).toContain("data-skilling-balanced-tolerance");
        expect(pageSource).toContain('id="skilling-balanced-cost-tolerance"');
        expect(pageSource).toContain('name="skilling-balanced-cost-tolerance"');
        expect(pageSource).toContain('inputmode="decimal"');
        expect(pageSource).toContain('min="0"');
        expect(pageSource).toContain('max="100"');
        expect(pageSource).toContain('step="0.01"');
        expect(pageSource).toContain(':disabled="skilling.running"');
        expect(pageSource).toContain(':value="balancedCostTolerancePercent"');
        expect(pageSource).toContain('@input="setBalancedCostTolerance"');
        expect(pageSource).toContain('@blur="normalizeBalancedCostToleranceInput"');
        expect(pageSource).toContain(':aria-describedby="balancedToleranceResultDiffers');
        expect(pageSource).toContain('id="skilling-balanced-cost-tolerance-hint"');
        expect(pageSource).toContain('id="skilling-balanced-cost-tolerance-status"');
        expect(pageSource).toContain('role="status"');
        expect(pageSource).toContain('aria-live="polite"');
        expect(pageSource).toContain('Math.round(Math.max(0, Math.min(100, parsedPercent)) * 100) / 100');
        expect(pageSource).toContain("skilling.setBalancedCostTolerance(percent / 100)");
        expect(pageSource).toContain("skilling.result?.balancedCostTolerance ?? selectedPlan.value?.balancedCostTolerance");
        expect(pageSource).toContain("balancedToleranceResultDiffers");
        expect(pageSource).toContain('resultRecordedOptimizationMode.value === "balanced"');
        expect(pageSource).toContain('common:skilling.balancedCostToleranceChanged');
        expect(pageSource).toContain('common:skilling.speedModeDescription');
        expect(pageSource).toContain('common:skilling.optimizationModeCommonRules');
        expect(pageSource).toContain('common:skilling.nextLevelTime');
        expect(pageSource).toContain('formatDuration(candidate.durationHours)');
        expect(pageSource).toContain('if (skilling.resultStale) return "";');
        expect(pageSource).toContain('skilling.result?.optimizationMode || selectedPlan.value?.optimizationMode');
        expect(pageSource).toContain('resultOptimizationMode.value === "cost"');
        expect(pageSource).toContain('resultOptimizationMode.value === "balanced"');
        expect(pageSource).toContain('resultOptimizationMode.value === "speed"');
        expect(pageSource).toContain('resultUsesCostMode.value || resultUsesBalancedMode.value');
        expect(pageSource).toContain('resultUsesSpeedMode.value || resultUsesBalancedMode.value');
        expect(pageSource).toContain('row.plan?.materialPurchaseCostPerExperience');
        expect(pageSource).toContain('candidate.materialPurchaseCostPerExperience');
    });

    it("accepts only skilling-targeted Tampermonkey imports", () => {
        expect(pageSource).toContain('data-tm-import-anchor="skilling-actions"');
        expect(pageSource).toContain('data-tm-import-reference="skilling-refresh"');
        expect(pageSource).toContain("applyTampermonkeySkillingImportMessage");
        expect(pageSource).toContain('data.importTarget !== "skilling"');
        expect(pageSource).toContain('window.addEventListener("message", handleTampermonkeySkillingImportWindowMessage)');
        expect(pageSource).toContain('window.removeEventListener("message", handleTampermonkeySkillingImportWindowMessage)');
    });

    it("renders overview, route, price, equipment, and narrow-screen table views", () => {
        expect(pageSource).toContain("data-skilling-overview");
        expect(pageSource).toContain("data-skilling-routes");
        expect(pageSource).toContain("data-skilling-prices");
        expect(pageSource).toContain("activeEquipmentStrategies");
        expect(pageSource).toContain("activeSegment.inputItems");
        expect(pageSource).toContain("activeSegment.outputItems");
        expect(pageSource).toContain("formatCount(candidate.completionCount)");
        expect(pageSource).toContain("common:skilling.nextLevelActions");
        expect(pageSource).toContain("common:skilling.currentLevelAlternatives");
        expect(pageSource).toContain("common:skilling.nextLevelDrinks");
        expect(pageSource).toContain("common:skilling.nextLevelCostPerXp");
        expect(pageSource).toContain("common:skilling.nextLevelMaterialPurchasePerXp");
        expect(pageSource).toContain("common:skilling.nextLevelPurchaseCost");
        expect(pageSource).toContain("common:skilling.nextLevelXpPerHour");
        expect(pageSource).toContain("common:skilling.nextLevelCandidateDetails");
        expect(pageSource).toContain("common:skilling.quantity");
        expect(pageSource).toContain("candidateDrinkSummary(candidate)");
        expect(pageSource).toContain("drinkSummary(segment)");
        expect(pageSource).toContain("common:skilling.noCandidateDrinks");
        expect(pageSource).toContain("buildSkillingDrinkStatuses");
        expect(pageSource).toContain("common:skilling.drinkContinuedWithNew");
        expect(pageSource).toContain("common:skilling.drinkRemaining");
        expect(pageSource).toContain("common:skilling.drinkUsedUp");
        expect(pageSource).toContain("whitespace-pre-line");
        expect(pageSource).toContain("segmentLevelLabel(segment)");
        expect(pageSource).toContain(":aria-label=\"segmentDetailsAriaLabel(segment)\"");
        expect(pageSource).toContain(":aria-label=\"candidateDetailsAriaLabel(candidate, index)\"");
        expect(pageSource).toContain("common:skilling.levelInProgress");
        expect(pageSource).toContain("candidateEquipmentSummary(candidate)");
        expect(pageSource).toContain("common:skilling.stagedEquipment");
        expect(pageSource).toContain("common:skilling.equipmentStage");
        expect(pageSource).toContain('common:skilling.additionalEquipment');
        expect(pageSource).toContain('… {{count}} more');
        expect(pageSource).toContain("Math.abs(numeric) < 1_000");
        expect(pageSource).toContain('formatCompactAmount(numeric, { locale: displayLocale(), unitCase: "lower" })');
        expect(pageSource).toContain("openSegment(candidate, true)");
        expect(pageSource).toContain("activeSegmentIsCandidate.value = isCandidate");
        expect(pageSource).toContain("ensureItemIconSymbols");
        expect(pageSource).toContain("overflow-x-auto");
        expect(pageSource).toContain('min-w-[1280px]');
        expect(pageSource).toContain("handleTabKeydown");
        expect(pageSource).toContain("segment.bonusSignature");
        expect(pageSource).toContain(':key="row.priceKey"');
        expect(pageSource).toContain("simulator.pricing?.enhancementQuotesByItem");
        expect(pageSource).toContain("row.enhancementLevel > 0");
        expect(pageSource).toContain('role="progressbar"');
        expect(pageSource).toContain('role="tabpanel"');
        expect(pageSource).toContain("priceOverrideAriaLabel(row, 'ask')");
        expect(pageSource).toContain("priceOverrideAriaLabel(row, 'bid')");

        const routeHeader = pageSource.match(/data-skilling-routes[\s\S]*?<thead[\s\S]*?<\/thead>/)?.[0] || "";
        const candidateHeader = pageSource.match(/data-skilling-alternatives[\s\S]*?<thead[\s\S]*?<\/thead>/)?.[0] || "";
        expect(routeHeader).toContain("common:skilling.actions");
        expect(routeHeader).not.toContain("common:skilling.nextLevelActions");
        expect(candidateHeader).toContain("common:skilling.nextLevelActions");
        expect(candidateHeader).not.toContain('t("common:skilling.actions", "Actions")');
    });

    it("invalidates an existing result immediately when a temporary Buff expired off-page", () => {
        expect(pageSource).toContain("watch(buffExpiredSinceResult");
        expect(pageSource).toContain("}, { immediate: true });");
    });
});

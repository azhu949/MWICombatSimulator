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
        expect(pageSource).toContain("activeSegment.equipment");
        expect(pageSource).toContain("activeSegment.inputItems");
        expect(pageSource).toContain("activeSegment.outputItems");
        expect(pageSource).toContain("formatCount(candidate.completionCount)");
        expect(pageSource).toContain("drinkSummary(candidate)");
        expect(pageSource).toContain("equipmentSummary(candidate)");
        expect(pageSource).toContain('common:skilling.additionalEquipment');
        expect(pageSource).toContain('… {{count}} more');
        expect(pageSource).toContain("Math.abs(numeric) < 1_000");
        expect(pageSource).toContain('formatCompactAmount(numeric, { locale: displayLocale(), unitCase: "lower" })');
        expect(pageSource).toContain("openSegment(candidate)");
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
    });

    it("invalidates an existing result immediately when a temporary Buff expired off-page", () => {
        expect(pageSource).toContain("watch(buffExpiredSinceResult");
        expect(pageSource).toContain("}, { immediate: true });");
    });
});

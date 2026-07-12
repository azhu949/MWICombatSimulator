import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enhancementData } from "../../shared/gameDataIndex.js";

const workerMockState = vi.hoisted(() => ({
    payload: null,
    handlers: null,
    cancelCalls: 0,
    startError: null,
    reset() {
        this.payload = null;
        this.handlers = null;
        this.cancelCalls = 0;
        this.startError = null;
    },
}));

vi.mock("../../services/enhancementWorkerClient.js", () => ({
    default: {
        start(payload, handlers) {
            if (workerMockState.startError) {
                throw workerMockState.startError;
            }
            workerMockState.payload = payload;
            workerMockState.handlers = handlers;
        },
        cancel() {
            workerMockState.cancelCalls += 1;
        },
    },
}));

import { useSimulatorStore } from "../simulatorStore.js";
import {
    ENHANCEMENT_STORAGE_KEY,
    ENHANCEMENT_STORAGE_VERSION,
    deriveEnhancementSupportSlotKeys,
    loadEnhancementPersistedState,
    normalizeEnhancementPersistedState,
    persistEnhancementState,
    useEnhancementStore,
} from "../enhancementStore.js";

function createLocalStorageMock() {
    const values = new Map();
    return {
        getItem: vi.fn((key) => values.get(key) ?? null),
        setItem: vi.fn((key, value) => values.set(key, String(value))),
        removeItem: vi.fn((key) => values.delete(key)),
        clear: vi.fn(() => values.clear()),
    };
}

function testItem() {
    return enhancementData.enhanceableItems.find((item) => (
        item.enhancementCosts.some((cost) => cost.itemHrid !== "/items/coin")
    ));
}

describe("enhancementStore", () => {
    beforeEach(() => {
        global.localStorage = createLocalStorageMock();
        global.Worker = class Worker {};
        workerMockState.reset();
        setActivePinia(createPinia());
    });

    afterEach(() => {
        delete global.Worker;
        delete global.fetch;
        vi.restoreAllMocks();
    });

    it("normalizes damaged values and migrates legacy aliases", () => {
        const item = testItem();
        const support = enhancementData.supportEquipment[0];
        const supportSlot = support.equipmentType.split("/").at(-1);
        const wrongSlot = deriveEnhancementSupportSlotKeys().find((slot) => slot !== supportSlot);
        const normalized = normalizeEnhancementPersistedState({
            version: 1,
            config: {
                selectedItemHrid: item.hrid,
                targetLevel: 99,
                startLevel: 88,
                hourlyRate: 1234,
                percent_rate: 2,
                protectionItemHrid: "/items/not_real",
                startingItemPriceOverride: false,
                noviceAchievement: "false",
                championAchievement: "true",
                priceOverrides: {
                    "/items/null": null,
                    "/items/empty": " ",
                    "/items/boolean": false,
                    "/items/nested": { ask: null, bid: "", a: "12" },
                    "/items/valid": "34",
                },
                equipmentSlots: {
                    [wrongSlot]: { itemHrid: support.hrid, enhancementLevel: 10 },
                },
                equipment: [{ itemHrid: support.hrid, level: 25 }],
            },
            favoriteItemHrids: [item.hrid, item.hrid, "/items/not_real"],
        });

        expect(normalized).toMatchObject({
            version: ENHANCEMENT_STORAGE_VERSION,
            favorites: [item.hrid],
            config: {
                itemHrid: item.hrid,
                targetLevel: 20,
                startLevel: 19,
                laborRatePerHour: 1234,
                markupRate: 0.02,
                protectionItemHrid: "",
                startingItemPriceOverride: null,
                noviceAchievement: false,
                championAchievement: true,
                priceOverrides: {
                    "/items/nested": { ask: 12 },
                    "/items/valid": 34,
                },
            },
        });
        expect(normalized.config.equipmentSlots[supportSlot]).toEqual({
            itemHrid: support.hrid,
            enhancementLevel: 20,
        });
        expect(normalized.config.equipmentSlots[wrongSlot].itemHrid).toBe("");
    });

    it("discovers future enhancement support equipment slots", () => {
        expect(deriveEnhancementSupportSlotKeys([
            { equipmentType: "/equipment_types/future_slot" },
        ])).toContain("future_slot");
    });

    it("falls through corrupt current storage to a valid legacy payload", () => {
        const item = testItem();
        global.localStorage.setItem(ENHANCEMENT_STORAGE_KEY, "{not-json");
        global.localStorage.setItem("mwi.enhancement.v1", JSON.stringify({
            config: { itemHrid: item.hrid, targetLevel: 7 },
            favorites: [item.hrid],
        }));

        const loaded = loadEnhancementPersistedState();
        expect(loaded.config.itemHrid).toBe(item.hrid);
        expect(loaded.config.targetLevel).toBe(7);
        expect(loaded.favorites).toEqual([item.hrid]);
    });

    it("persists only versioned configuration and favorites", async () => {
        const store = useEnhancementStore();
        const item = testItem();
        store.selectItem(item.hrid);
        store.toggleFavorite(item.hrid);
        store.risk = { method: "monte_carlo", mean: 123 };
        await nextTick();

        const payload = JSON.parse(global.localStorage.getItem(ENHANCEMENT_STORAGE_KEY));
        expect(payload.version).toBe(ENHANCEMENT_STORAGE_VERSION);
        expect(payload.config.itemHrid).toBe(item.hrid);
        expect(payload.favorites).toEqual([item.hrid]);
        expect(payload).not.toHaveProperty("risk");
        expect(persistEnhancementState(payload)).toBe(true);
    });

    it("filters enhanceable items by equipment type instead of the shared item category", () => {
        const store = useEnhancementStore();
        const equipmentTypes = new Set(store.itemOptions.map((item) => item.equipmentType));

        expect(new Set(store.itemOptions.map((item) => item.categoryHrid))).toEqual(new Set(["/item_categories/equipment"]));
        expect(equipmentTypes.size).toBeGreaterThan(1);

        const selectedType = store.itemOptions.find((item) => item.equipmentType)?.equipmentType;
        store.itemFilters.equipmentType = selectedType;

        expect(store.filteredItemOptions.length).toBeGreaterThan(0);
        expect(store.filteredItemOptions.length).toBeLessThan(store.itemOptions.length);
        expect(store.filteredItemOptions.every((item) => item.equipmentType === selectedType)).toBe(true);
    });

    it("requires a direct same-level quote for an enhanced starting item", async () => {
        const simulator = useSimulatorStore();
        const store = useEnhancementStore();
        const item = testItem();
        store.selectItem(item.hrid);
        store.config.targetLevel = 3;
        store.config.startLevel = 2;
        simulator.pricing.enhancementQuotesByItem[item.hrid] = {
            "2": { ask: 54321, bid: 50000 },
        };
        await nextTick();

        expect(store.startingItemPrice).toMatchObject({
            value: 54321,
            source: "enhancement_ask",
            missing: false,
        });

        store.config.startLevel = 1;
        await nextTick();
        expect(store.startingItemPrice.missing).toBe(true);
        expect(store.recommendedStrategy.totalInvestment).toBeNull();
        expect(store.recommendedStrategy.incrementalCost).toBeGreaterThan(0);
    });

    it("keeps the runtime start level inside zero through target minus one", () => {
        const store = useEnhancementStore();
        store.config.targetLevel = 5;
        store.config.startLevel = 10;
        expect(store.config.startLevel).toBe(4);

        store.config.startLevel = -3;
        expect(store.config.startLevel).toBe(0);
    });

    it("clears a starting-item override when the effective start level changes", () => {
        const store = useEnhancementStore();
        store.selectItem(testItem().hrid);
        store.config.startingItemPriceOverride = 123;

        store.config.startLevel = 2;

        expect(store.config.startLevel).toBe(2);
        expect(store.config.startingItemPriceOverride).toBeNull();
    });

    it("keeps live levels inside their supported ranges", () => {
        const store = useEnhancementStore();

        store.config.skillLevel = 999;
        store.config.observatoryLevel = 999;
        store.config.otherRoomLevels = -1;
        store.config.communityEnhancingLevel = 999;
        store.config.communityExperienceLevel = 999;
        expect(store.config.skillLevel).toBe(200);
        expect(store.config.observatoryLevel).toBe(8);
        expect(store.config.otherRoomLevels).toBe(0);
        expect(store.config.communityEnhancingLevel).toBe(20);
        expect(store.config.communityExperienceLevel).toBe(20);

        store.config.skillLevel = 0;
        store.config.communityEnhancingLevel = -1;
        store.config.communityExperienceLevel = -1;
        expect(store.config.skillLevel).toBe(1);
        expect(store.config.communityEnhancingLevel).toBe(0);
        expect(store.config.communityExperienceLevel).toBe(0);
    });

    it("resets a risk strategy that no longer exists after the target changes", () => {
        const store = useEnhancementStore();
        store.selectItem(testItem().hrid);
        store.config.targetLevel = 10;
        store.config.riskStrategy = "protect-9";
        expect(store.config.riskStrategy).toBe("protect-9");

        store.config.targetLevel = 5;

        expect(store.config.riskStrategy).toBe("recommended");
    });

    it("clears item-specific prices and protection when the target item changes", () => {
        const store = useEnhancementStore();
        const [firstItem, secondItem] = store.itemOptions;
        store.selectItem(firstItem.hrid);
        store.config.protectionMode = "manual";
        store.config.protectionItemHrid = firstItem.hrid;
        store.config.startingItemPriceOverride = 123;

        store.selectItem(secondItem.hrid);

        expect(store.config.itemHrid).toBe(secondItem.hrid);
        expect(store.config.protectionItemHrid).toBe("");
        expect(store.config.startingItemPriceOverride).toBeNull();
    });

    it("uses ask, bid, vendor, then a page override for material pricing", async () => {
        const simulator = useSimulatorStore();
        const store = useEnhancementStore();
        const item = testItem();
        const materialHrid = item.enhancementCosts.find((cost) => cost.itemHrid !== "/items/coin").itemHrid;
        store.selectItem(item.hrid);
        expect(store.materialRows.some((row) => row.hrid === "/items/coin")).toBe(false);

        simulator.pricing.priceTable[materialHrid] = { ask: 30, bid: 20, vendor: 10 };
        await nextTick();
        expect(store.materialRows.find((row) => row.hrid === materialHrid)).toMatchObject({
            unitPrice: 30,
            source: "ask",
        });

        simulator.pricing.priceTable[materialHrid] = { ask: -1, bid: 20, vendor: 10 };
        await nextTick();
        expect(store.materialRows.find((row) => row.hrid === materialHrid)).toMatchObject({
            unitPrice: 20,
            source: "bid",
        });

        simulator.pricing.priceTable[materialHrid] = { ask: -1, bid: -1, vendor: 10 };
        await nextTick();
        expect(store.materialRows.find((row) => row.hrid === materialHrid)).toMatchObject({
            unitPrice: 10,
            source: "vendor",
        });

        store.setPriceOverride(materialHrid, 77);
        await nextTick();
        expect(store.materialRows.find((row) => row.hrid === materialHrid)).toMatchObject({
            unitPrice: 77,
            source: "override",
        });
    });

    it("blocks risk analysis instead of treating a missing material price as zero", async () => {
        const simulator = useSimulatorStore();
        const store = useEnhancementStore();
        const item = testItem();
        const materialHrid = item.enhancementCosts.find((cost) => cost.itemHrid !== "/items/coin").itemHrid;
        store.selectItem(item.hrid);
        store.config.targetLevel = 1;
        simulator.pricing.priceTable[materialHrid] = { ask: -1, bid: -1, vendor: -1 };
        await nextTick();

        expect(store.recommendedStrategy).toMatchObject({
            materialPricesAvailable: false,
            incrementalCost: null,
            totalInvestment: null,
        });
        await expect(store.runRisk()).rejects.toThrow(/enhancement material/i);
        expect(workerMockState.payload).toBeNull();
    });

    it("shows acquisition estimates for non-tradable protection without auto-selecting them", async () => {
        const simulator = useSimulatorStore();
        const store = useEnhancementStore();
        const cloakHrid = "/items/enchanted_cloak";
        store.selectItem(cloakHrid);
        store.config.targetLevel = 3;
        simulator.pricing.priceTable["/items/mirror_of_protection"] = {
            ask: 10_000_000,
            bid: 9_800_000,
            vendor: 200_000,
        };
        await nextTick();

        expect(store.protectionOptions.find((option) => option.hrid === cloakHrid)).toMatchObject({
            available: false,
            source: "acquisition_missing",
            autoEligible: false,
        });
        expect(store.startingItemPrice).toMatchObject({ missing: true, source: "acquisition_missing" });

        simulator.pricing.priceTable["/items/enchanted_entry_key"] = {
            ask: 960_000,
            bid: 940_000,
            vendor: 50_000,
        };
        simulator.pricing.priceTable["/items/enchanted_chest_key"] = {
            ask: 4_300_000,
            bid: 4_200_000,
            vendor: 500_000,
        };
        await nextTick();

        expect(store.startingItemPrice).toMatchObject({
            missing: false,
            source: "acquisition_estimate",
            expectedContainers: 25,
        });
        expect(store.protectionOptions.find((option) => option.hrid === cloakHrid)).toMatchObject({
            available: true,
            source: "acquisition_estimate",
            expectedContainers: 25,
            autoEligible: false,
        });
        expect(store.materialRows.find((row) => row.kind === "protection" && row.hrid === cloakHrid))
            .toMatchObject({
                source: "acquisition_estimate",
                expectedContainers: 25,
                missing: false,
            });
        expect(store.strategyRows.find((row) => row.protectAt === 2)?.protectionItem).toMatchObject({
            itemHrid: "/items/mirror_of_protection",
            source: "ask",
        });

        store.config.protectionMode = "manual";
        store.config.protectionItemHrid = cloakHrid;
        await nextTick();
        expect(store.strategyRows.find((row) => row.protectAt === 2)?.protectionItem).toMatchObject({
            itemHrid: cloakHrid,
            source: "acquisition_estimate",
        });
    });

    it("keeps cached and vendor prices usable when a market refresh fails", async () => {
        const simulator = useSimulatorStore();
        const store = useEnhancementStore();
        const item = testItem();
        const vendorBefore = simulator.pricing.priceTable[item.hrid].vendor;
        global.fetch = vi.fn().mockRejectedValue(new Error("offline"));

        await expect(store.refreshPrices()).resolves.toMatchObject({ error: "offline" });
        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(simulator.pricing.priceTable[item.hrid].vendor).toBe(vendorBefore);
    });

    it("builds strategy, mirror, and decomposition views from current data", () => {
        const simulator = useSimulatorStore();
        const store = useEnhancementStore();
        const item = testItem();
        store.selectItem(item.hrid);
        store.config.targetLevel = 3;
        simulator.pricing.priceTable["/items/enhancing_essence"] = { ask: 100, bid: 80, vendor: 50 };
        simulator.pricing.priceTable["/items/mirror_of_protection"] = { ask: 120, bid: 100, vendor: 50 };

        expect(store.strategyRows.map((row) => row.id)).toEqual(expect.arrayContaining([
            "none",
            "protect-2",
        ]));
        expect(store.strategyRows[0].totalInvestment ?? store.strategyRows[0].incrementalCost)
            .toBeLessThanOrEqual(store.strategyRows.at(-1).totalInvestment ?? store.strategyRows.at(-1).incrementalCost);
        expect(store.mirrorPlan).toMatchObject({ targetLevel: 3 });
        expect(store.mirrorPlan.materials.length).toBeGreaterThan(0);
        expect(store.decompositionValue).toMatchObject({
            targetLevel: 3,
            essenceItemHrid: "/items/enhancing_essence",
        });
        expect(store.materialRows).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: "protection" }),
            expect.objectContaining({ hrid: "/items/philosophers_mirror", kind: "philosophers_mirror" }),
            expect.objectContaining({
                hrid: "/items/enhancing_essence",
                kind: "decomposition",
                unitPrice: 80,
                source: "bid",
            }),
        ]));
    });

    it("uses base equipment and mirror-action labor for refined-item mirror plans", () => {
        const store = useEnhancementStore();
        const refinedItem = enhancementData.enhanceableItems.find((item) => item.baseItemHrids?.length > 0);
        const baseItemHrid = refinedItem.baseItemHrids[0];
        const mirrorHrid = enhancementData.specialItemHrids.philosophersMirror;

        store.selectItem(refinedItem.hrid);
        store.config.targetLevel = 2;
        store.config.laborRatePerHour = 3600;
        store.setPriceOverride(refinedItem.hrid, 1_000_000_000);
        store.setPriceOverride(baseItemHrid, 1);
        store.setPriceOverride(mirrorHrid, 0);

        expect(store.mirrorPlan).toMatchObject({
            method: "mirror",
            itemHrid: refinedItem.hrid,
            baseItemHrid,
            mirrorActionCost: expect.any(Number),
        });
        expect(store.mirrorPlan.mirrorActionCost).toBeGreaterThan(0);
        expect(store.mirrorPlan.materials).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: "direct", itemHrid: baseItemHrid, level: 0 }),
            expect.objectContaining({ type: "direct", itemHrid: refinedItem.hrid, level: 1 }),
            expect.objectContaining({
                type: "mirror",
                itemHrid: mirrorHrid,
                actionUnitCost: store.mirrorPlan.mirrorActionCost,
            }),
        ]));
    });

    it("uses a current +0 starting-item override in the independent mirror plan", () => {
        const store = useEnhancementStore();
        const refinedItem = enhancementData.enhanceableItems.find((item) => (
            item.isTradable === false && item.baseItemHrids?.length > 0
        ));
        const baseItemHrid = refinedItem.baseItemHrids[0];
        const mirrorHrid = enhancementData.specialItemHrids.philosophersMirror;

        store.selectItem(refinedItem.hrid);
        store.config.startLevel = 0;
        store.config.targetLevel = 2;
        store.config.startingItemPriceOverride = 1_000_000;
        store.setPriceOverride(baseItemHrid, 1);
        store.setPriceOverride(mirrorHrid, 0);

        expect(store.mirrorPlan.levels[0].directPlan.startingItem).toMatchObject({
            price: 1_000_000,
            source: "override",
            level: 0,
        });
        expect(Number.isFinite(store.mirrorPlan.cost)).toBe(true);
    });

    it("keeps overlapping ask/bid and material/protection price rows distinct", () => {
        const simulator = useSimulatorStore();
        const store = useEnhancementStore();
        const essenceHrid = "/items/enhancing_essence";
        simulator.pricing.priceTable[essenceHrid] = { ask: 100, bid: 80, vendor: 50 };
        store.selectItem("/items/chance_cape");

        expect(store.materialRows.filter((row) => row.hrid === essenceHrid)).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: "material", priceMode: "ask", unitPrice: 100 }),
            expect.objectContaining({ kind: "decomposition", priceMode: "bid", unitPrice: 80 }),
        ]));

        store.setMaterialOverride(essenceHrid, 111, "ask");
        store.setMaterialOverride(essenceHrid, 79, "bid");
        expect(store.config.priceOverrides[essenceHrid]).toEqual({ ask: 111, bid: 79 });
        store.clearPriceOverride(essenceHrid, "ask");
        expect(store.config.priceOverrides[essenceHrid]).toEqual({ bid: 79 });
        expect(store.materialRows.find((row) => (
            row.hrid === essenceHrid && row.priceMode === "ask"
        ))).toMatchObject({ unitPrice: 100, source: "ask", overrideValue: null });
        expect(store.materialRows.find((row) => (
            row.hrid === essenceHrid && row.priceMode === "bid"
        ))).toMatchObject({ unitPrice: 79, source: "override", overrideValue: 79 });

        store.selectItem("/items/trainee_enhancing_charm");
        expect(store.materialRows.filter((row) => row.hrid === "/items/trainee_enhancing_charm"))
            .toEqual(expect.arrayContaining([
                expect.objectContaining({ kind: "material", priceMode: "ask" }),
                expect.objectContaining({ kind: "protection", priceMode: "ask" }),
            ]));
    });

    it("lists enabled tea costs with their expected quantities", () => {
        const simulator = useSimulatorStore();
        const store = useEnhancementStore();
        store.selectItem(testItem().hrid);
        store.config.targetLevel = 1;
        store.config.teaHrid = "/items/enhancing_tea";
        store.config.blessedTea = true;
        store.config.wisdomTea = true;
        simulator.pricing.priceTable["/items/enhancing_tea"] = { ask: 30, bid: 25, vendor: 20 };
        simulator.pricing.priceTable["/items/blessed_tea"] = { ask: 40, bid: 35, vendor: 20 };
        simulator.pricing.priceTable["/items/wisdom_tea"] = { ask: 50, bid: 45, vendor: 20 };

        const consumables = store.materialRows.filter((row) => row.kind === "consumable");
        expect(consumables.map((row) => row.hrid)).toEqual(expect.arrayContaining([
            "/items/enhancing_tea",
            "/items/blessed_tea",
            "/items/wisdom_tea",
        ]));
        expect(consumables.every((row) => row.quantity > 0 && row.unitPrice > 0)).toBe(true);
        expect(store.recommendedStrategy.consumableCostPerAction).toBeGreaterThan(0);

        store.config.targetLevel = 2;
        expect(store.mirrorPlan.mirrorActionCost).toBeCloseTo(
            store.recommendedStrategy.consumableCostPerAction,
            10,
        );
    });

    it("routes worker progress/results and ignores a cancelled run", async () => {
        const store = useEnhancementStore();
        const item = testItem();
        store.selectItem(item.hrid);
        store.config.targetLevel = 1;
        store.config.sampleCount = 0;
        const firstRun = store.runRisk();

        expect(store.config.sampleCount).toBe(1024);
        expect(workerMockState.payload).toMatchObject({
            runId: expect.stringContaining("enhancement-"),
            options: { sampleCount: 1024 },
        });
        workerMockState.handlers.onProgress({ completed: 512, total: 1024, transitions: 900 });
        expect(store.riskProgress.progress).toBe(0.5);
        workerMockState.handlers.onResult({
            method: "monte_carlo",
            quantiles: { "50": { totalCost: 100 } },
            budgetProbability: 0.75,
            sampleCount: 1024,
            seed: "enhancement",
        });
        await expect(firstRun).resolves.toMatchObject({ method: "monte_carlo" });
        expect(store.riskRunning).toBe(false);
        expect(store.risk.method).toBe("monte_carlo");

        store.config.sampleCount = 2_000_000;
        const secondRun = store.runRisk();
        expect(store.config.sampleCount).toBe(1_000_000);
        expect(workerMockState.payload.options.sampleCount).toBe(1_000_000);
        const cancelledHandlers = workerMockState.handlers;
        cancelledHandlers.onProgress({ completed: 250_000, total: 1_000_000, transitions: 400 });
        expect(store.riskProgress.progress).toBe(0.25);
        expect(store.cancelRisk()).toBe(true);
        await expect(secondRun).resolves.toBeNull();
        expect(workerMockState.cancelCalls).toBe(1);
        cancelledHandlers.onResult({ method: "monte_carlo", mean: 999 });
        expect(store.risk).toBeNull();
        expect(store.riskProgress.cancelled).toBe(true);
        expect(store.riskProgress.progress).toBe(0);
    });

    it("cancels an active worker and clears stale risk when configuration changes", async () => {
        const store = useEnhancementStore();
        store.selectItem(testItem().hrid);
        store.config.targetLevel = 1;
        const pendingRun = store.runRisk();
        expect(store.riskRunning).toBe(true);

        store.config.skillLevel += 1;

        await expect(pendingRun).resolves.toBeNull();
        expect(workerMockState.cancelCalls).toBe(1);
        expect(store.riskRunning).toBe(false);
        expect(store.risk).toBeNull();
        expect(store.riskProgress).toBeNull();
    });

    it("recovers when the browser cannot construct the module worker", async () => {
        const store = useEnhancementStore();
        store.selectItem(testItem().hrid);
        store.config.targetLevel = 1;
        workerMockState.startError = new Error("worker blocked");

        await expect(store.runRisk()).rejects.toThrow("worker blocked");
        expect(store.riskRunning).toBe(false);
        expect(store.activeRunId).toBe("");
        expect(store.riskError).toBe("worker blocked");
        expect(store.riskProgress).toBeNull();
    });

    it("clears partial progress when a worker run fails", async () => {
        const store = useEnhancementStore();
        store.selectItem(testItem().hrid);
        store.config.targetLevel = 1;
        store.config.sampleCount = 1024;
        const pendingRun = store.runRisk();

        workerMockState.handlers.onProgress({ completed: 256, total: 1024, transitions: 400 });
        expect(store.riskProgress.progress).toBe(0.25);
        workerMockState.handlers.onError("worker failed");

        await expect(pendingRun).rejects.toThrow("worker failed");
        expect(store.riskRunning).toBe(false);
        expect(store.riskProgress).toBeNull();
        expect(store.riskError).toBe("worker failed");
    });
});

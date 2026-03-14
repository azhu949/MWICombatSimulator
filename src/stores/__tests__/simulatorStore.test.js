import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import actionDetailMap from "../../combatsimulator/data/actionDetailMap.json";
import abilityDetailMap from "../../combatsimulator/data/abilityDetailMap.json";
import abilityXpLevels from "../../combatsimulator/data/abilityXpLevels.json";
import houseRoomDetailMap from "../../combatsimulator/data/houseRoomDetailMap.json";
import itemDetailMap from "../../combatsimulator/data/itemDetailMap.json";
import { createMainSiteShareProfileFixture } from "../../services/__tests__/fixtures/mainSiteShareProfileFixture.js";
import { useSimulatorStore } from "../simulatorStore.js";

const ONE_HOUR = 60 * 60 * 1e9;
const PLAYER_ACHIEVEMENTS_STORAGE_KEY = "mwi.player.achievements.v1";
const ACHIEVEMENT_HRID = "/achievements/total_level_100";
const SECOND_ACHIEVEMENT_HRID = "/achievements/total_level_250";

function createLocalStorageMock() {
    const store = new Map();
    return {
        getItem: vi.fn((key) => (store.has(key) ? store.get(key) : null)),
        setItem: vi.fn((key, value) => {
            store.set(key, String(value));
        }),
        removeItem: vi.fn((key) => {
            store.delete(key);
        }),
        clear: vi.fn(() => {
            store.clear();
        }),
    };
}

function findFirstPricedItem() {
    const item = Object.values(itemDetailMap).find((entry) => Number(entry?.sellPrice ?? 0) > 0);
    return item?.hrid ?? "";
}

function findFirstEquipmentItem() {
    const item = Object.values(itemDetailMap).find((entry) => (
        entry?.categoryHrid === "/item_categories/equipment"
        && String(entry?.equipmentDetail?.type || "").startsWith("/equipment_types/")
    ));
    return item?.hrid ?? "";
}

function findFirstEquipmentItemByType(equipmentTypeHrid) {
    const item = Object.values(itemDetailMap).find((entry) => (
        entry?.categoryHrid === "/item_categories/equipment"
        && String(entry?.equipmentDetail?.type || "") === equipmentTypeHrid
    ));
    return item?.hrid ?? "";
}

function findFirstFoodWithDefaultTriggers() {
    const item = Object.values(itemDetailMap).find(
        (entry) => entry.categoryHrid === "/item_categories/food" && Array.isArray(entry?.consumableDetail?.defaultCombatTriggers)
    );
    return item?.hrid ?? "";
}

function findFirstDrinkWithDefaultTriggers() {
    const item = Object.values(itemDetailMap).find(
        (entry) => entry.categoryHrid === "/item_categories/drink" && Array.isArray(entry?.consumableDetail?.defaultCombatTriggers)
    );
    return item?.hrid ?? "";
}

function findFirstCombatAction(isDungeon = false) {
    const action = Object.values(actionDetailMap).find((entry) => (
        String(entry?.type || "") === "/action_types/combat"
        && Boolean(entry?.combatZoneInfo?.isDungeon) === isDungeon
    ));
    return action?.hrid ?? "";
}

function findFirstAbilityWithDefaultTriggers() {
    const ability = Object.values(abilityDetailMap).find(
        (entry) => !entry.isSpecialAbility && Array.isArray(entry.defaultCombatTriggers)
    );
    return ability?.hrid ?? "";
}

function findFirstAbilityBookInfo() {
    const item = Object.values(itemDetailMap).find((entry) => (
        entry?.categoryHrid === "/item_categories/ability_book"
        && String(entry?.abilityBookDetail?.abilityHrid || "").startsWith("/abilities/")
    ));
    if (!item) {
        return null;
    }
    return {
        abilityHrid: String(item.abilityBookDetail.abilityHrid || ""),
        xpPerBook: Number(item.abilityBookDetail.experienceGain || 0),
        bookItemHrid: String(item.hrid || ""),
    };
}

function findHouseRoomWithUpgradeLevels(minLevels = 1, excludeHrid = "") {
    return Object.values(houseRoomDetailMap).find((entry) => {
        if (String(entry?.hrid || "") === String(excludeHrid || "")) {
            return false;
        }

        const upgradeLevels = Object.keys(entry?.upgradeCostsMap || {}).filter((level) => {
            const costs = entry?.upgradeCostsMap?.[level];
            return Array.isArray(costs) && costs.length > 0;
        });
        return upgradeLevels.length >= minLevels;
    }) ?? null;
}

function aggregateHouseRoomUpgradeCounts(roomHrid, fromLevel, toLevel) {
    const room = houseRoomDetailMap?.[roomHrid];
    const upgradeCostsMap = room?.upgradeCostsMap || {};
    const counts = {};

    for (let level = fromLevel + 1; level <= toLevel; level++) {
        const levelCosts = Array.isArray(upgradeCostsMap[String(level)]) ? upgradeCostsMap[String(level)] : [];
        for (const costEntry of levelCosts) {
            const itemHrid = String(costEntry?.itemHrid || "");
            const count = Number(costEntry?.count || 0);
            if (!itemHrid || !Number.isFinite(count) || count <= 0) {
                continue;
            }
            counts[itemHrid] = Number(counts[itemHrid] || 0) + count;
        }
    }

    return counts;
}

function mergeMaterialCountMaps(...maps) {
    return maps.reduce((acc, map) => {
        for (const [itemHrid, count] of Object.entries(map || {})) {
            acc[itemHrid] = Number(acc[itemHrid] || 0) + Number(count || 0);
        }
        return acc;
    }, {});
}

function resolvePreviewAskSidePrice(priceTable, itemHrid) {
    const normalizedItemHrid = String(itemHrid || "");
    if (!normalizedItemHrid) {
        return 0;
    }
    if (normalizedItemHrid === "/items/coin") {
        return 1;
    }

    const entry = priceTable?.[normalizedItemHrid] ?? {};
    const ask = Number(entry?.ask ?? -1);
    if (ask > 0) {
        return ask;
    }

    const vendorFallback = Number(itemDetailMap?.[normalizedItemHrid]?.sellPrice ?? 0);
    const vendor = Math.max(0, Number(entry?.vendor ?? vendorFallback));
    if (vendor > 0) {
        return vendor;
    }

    const bid = Number(entry?.bid ?? -1);
    return bid > 0 ? bid : 0;
}

function computePreviewTotalFromCounts(counts, priceTable) {
    return Object.entries(counts || {}).reduce((sum, [itemHrid, count]) => {
        const safeCount = Number(count || 0);
        if (!Number.isFinite(safeCount) || safeCount <= 0) {
            return sum;
        }
        const price = resolvePreviewAskSidePrice(priceTable, itemHrid);
        return sum + ((itemHrid === "/items/coin" || price > 0) ? safeCount * price : 0);
    }, 0);
}

describe("simulatorStore", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        global.localStorage = createLocalStorageMock();
    });

    afterEach(() => {
        delete global.fetch;
        delete global.window;
        delete global.jigsAbilityXpLevels;
        delete global.jigsSpellBookXpByName;
        vi.restoreAllMocks();
    });

    it("defaults simulation UI flags when missing storage", () => {
        const simulator = useSimulatorStore();

        expect(simulator.simulationSettings.mooPass).toBe(true);
        expect(simulator.simulationSettings.comExpEnabled).toBe(true);
        expect(simulator.simulationSettings.comDropEnabled).toBe(true);
        expect(simulator.simulationSettings.comExp).toBe(20);
        expect(simulator.simulationSettings.comDrop).toBe(20);
    });

    it("does not override stored simulation UI flags", () => {
        global.localStorage.setItem("mwi.simulation.ui.v1", JSON.stringify({
            mooPass: false,
            comExpEnabled: false,
            comExp: 17,
            comDropEnabled: false,
            comDrop: 18,
        }));

        const simulator = useSimulatorStore();

        expect(simulator.simulationSettings.mooPass).toBe(false);
        expect(simulator.simulationSettings.comExpEnabled).toBe(false);
        expect(simulator.simulationSettings.comDropEnabled).toBe(false);
        expect(simulator.simulationSettings.comExp).toBe(17);
        expect(simulator.simulationSettings.comDrop).toBe(18);
    });

    it("normalizes active queue settings", () => {
        const simulator = useSimulatorStore();

        const normalized = simulator.updateActiveQueueSettings({
            rounds: 999,
            medianBlend: 2,
            weightProfit: 2,
            weightXp: 3,
            weightDeathSafety: 5,
            executionMode: "parallel",
        });

        expect(normalized.rounds).toBe(200);
        expect(normalized.medianBlend).toBe(1);
        expect(normalized.weightProfit).toBeCloseTo(0.2, 6);
        expect(normalized.weightXp).toBeCloseTo(0.3, 6);
        expect(normalized.weightDeathSafety).toBeCloseTo(0.5, 6);
        expect(normalized.executionMode).toBe("parallel");

        const zeroed = simulator.updateActiveQueueSettings({
            weightProfit: -1,
            weightXp: -1,
            weightDeathSafety: -1,
            executionMode: "invalid-mode",
        });

        expect(zeroed.weightProfit).toBe(0);
        expect(zeroed.weightXp).toBe(0);
        expect(zeroed.weightDeathSafety).toBe(0);
        expect(zeroed.executionMode).toBe("serial");
    });

    it("validates and persists queue runtime settings", () => {
        const simulator = useSimulatorStore();

        const invalid = simulator.saveQueueRuntimeSettings({
            performancePct: 40,
            stabilityPct: 20,
            costPct: 30,
            parallelWorkerLimit: 1,
        });
        expect(invalid.ok).toBe(false);
        expect(invalid.messageKey).toBe("common:settingsPage.queueSaveErrorWeightSum");

        const saved = simulator.saveQueueRuntimeSettings({
            performancePct: 40,
            stabilityPct: 20,
            costPct: 40,
            parallelWorkerLimit: 1,
        });
        expect(saved.ok).toBe(true);
        expect(simulator.queueRuntime.finalWeights.performance).toBeCloseTo(0.4, 6);
        expect(simulator.queueRuntime.finalWeights.stability).toBeCloseTo(0.2, 6);
        expect(simulator.queueRuntime.finalWeights.cost).toBeCloseTo(0.4, 6);
        expect(simulator.queueRuntime.parallelWorkerLimit).toBe(1);
        expect(global.localStorage.setItem).toHaveBeenCalled();

        const reset = simulator.resetQueueRuntimeSettings();
        expect(reset.ok).toBe(true);
        expect(simulator.queueRuntime.finalWeights.performance).toBeCloseTo(0.4, 6);
        expect(simulator.queueRuntime.finalWeights.stability).toBeCloseTo(0.2, 6);
        expect(simulator.queueRuntime.finalWeights.cost).toBeCloseTo(0.4, 6);
    });

    it("saves, loads, and deletes player data snapshots", () => {
        const simulator = useSimulatorStore();

        simulator.players[0].levels.stamina = 77;
        simulator.players[0].achievements[ACHIEVEMENT_HRID] = true;
        const saveResult = simulator.savePlayerDataSnapshot();
        expect(saveResult.ok).toBe(true);
        expect(simulator.playerDataSnapshotRows.some((row) => row.hasSnapshot)).toBe(true);

        simulator.players[0].levels.stamina = 1;
        simulator.players[0].achievements = {};
        const loadResult = simulator.loadPlayerDataSnapshot();
        expect(loadResult.ok).toBe(true);
        expect(simulator.players[0].levels.stamina).toBe(77);
        expect(simulator.players[0].achievements[ACHIEVEMENT_HRID]).toBe(true);
        expect(JSON.parse(global.localStorage.getItem(PLAYER_ACHIEVEMENTS_STORAGE_KEY)).achievementsByPlayer["1"])
            .toEqual({ [ACHIEVEMENT_HRID]: true });

        const deleteOneResult = simulator.deleteSinglePlayerDataSnapshot("1");
        expect(deleteOneResult.ok).toBe(true);

        const deleteAllResult = simulator.deleteAllPlayerDataSnapshots();
        expect(deleteAllResult.ok).toBe(true);
        expect(simulator.playerDataSnapshotRows.every((row) => !row.hasSnapshot)).toBe(true);
    });

    it("hydrates persisted achievements on store creation", () => {
        global.localStorage.setItem(PLAYER_ACHIEVEMENTS_STORAGE_KEY, JSON.stringify({
            version: 1,
            achievementsByPlayer: {
                "1": {
                    [ACHIEVEMENT_HRID]: true,
                    [SECOND_ACHIEVEMENT_HRID]: 1,
                },
                "2": {
                    [ACHIEVEMENT_HRID]: false,
                },
                "8": {
                    "/achievements/ignored": true,
                },
            },
        }));

        const simulator = useSimulatorStore();

        expect(simulator.players[0].achievements).toEqual({
            [ACHIEVEMENT_HRID]: true,
            [SECOND_ACHIEVEMENT_HRID]: true,
        });
        expect(simulator.players[1].achievements).toEqual({});
    });

    it("persists and clears achievements independently from player snapshots", () => {
        const simulator = useSimulatorStore();

        simulator.players[0].achievements[ACHIEVEMENT_HRID] = true;
        simulator.persistPlayerAchievements();

        expect(JSON.parse(global.localStorage.getItem(PLAYER_ACHIEVEMENTS_STORAGE_KEY)).achievementsByPlayer["1"])
            .toEqual({ [ACHIEVEMENT_HRID]: true });

        const deleteAllResult = simulator.deleteAllPlayerDataSnapshots();
        expect(deleteAllResult.ok).toBe(true);
        expect(JSON.parse(global.localStorage.getItem(PLAYER_ACHIEVEMENTS_STORAGE_KEY)).achievementsByPlayer["1"])
            .toEqual({ [ACHIEVEMENT_HRID]: true });

        simulator.players[0].achievements = {};
        simulator.persistPlayerAchievements();

        expect(global.localStorage.getItem(PLAYER_ACHIEVEMENTS_STORAGE_KEY)).toBeNull();
    });

    it("keeps queue state isolated per active player", async () => {
        const simulator = useSimulatorStore();

        await simulator.setQueueBaselineForActivePlayer();
        expect(simulator.queue.byPlayer["1"]?.baseline).toBeTruthy();

        simulator.setActivePlayer("3");
        expect(simulator.activeQueueState.baseline).toBeNull();

        await simulator.setQueueBaselineForActivePlayer();
        expect(simulator.queue.byPlayer["3"]?.baseline).toBeTruthy();

        simulator.setActivePlayer("1");
        expect(simulator.activeQueueState.baseline).toBeTruthy();
    });

    it("syncs active single-simulation result selection when active player changes", () => {
        const simulator = useSimulatorStore();
        simulator.results.summaryRows = [
            { playerHrid: "player1", playerName: "Player 1", totalXpPerHour: 100 },
            { playerHrid: "player2", playerName: "Player 2", totalXpPerHour: 200 },
        ];
        simulator.results.activeResultPlayerHrid = "player1";

        simulator.setActivePlayer("2");
        expect(simulator.results.activeResultPlayerHrid).toBe("player2");
        expect(simulator.activeResultRow).toMatchObject({ playerHrid: "player2", playerName: "Player 2" });

        simulator.setActivePlayer("1");
        expect(simulator.results.activeResultPlayerHrid).toBe("player1");
        expect(simulator.activeResultRow).toMatchObject({ playerHrid: "player1", playerName: "Player 1" });
    });

    it("keeps active result aligned to the selected player even when that player has no result row", () => {
        const simulator = useSimulatorStore();
        simulator.results.summaryRows = [
            { playerHrid: "player1", playerName: "Player 1", totalXpPerHour: 100 },
            { playerHrid: "player2", playerName: "Player 2", totalXpPerHour: 200 },
        ];
        simulator.results.activeResultPlayerHrid = "player1";

        simulator.setActivePlayer("4");
        expect(simulator.results.activeResultPlayerHrid).toBe("player4");
        expect(simulator.activeResultRow).toBeNull();
    });

    it("rejects queue run when run scope is not single", async () => {
        const simulator = useSimulatorStore();

        await simulator.setQueueBaselineForActivePlayer();
        simulator.activePlayer.levels.stamina = 2;
        simulator.addActivePlayerToQueue();
        simulator.simulationSettings.runScope = "all_group_zones";

        const rows = await simulator.runActiveQueue();

        expect(rows).toEqual([]);
        expect(simulator.activeQueueState.error).toContain("Single target");
    });

    it("runs queue with multiple rounds and builds ranking output", async () => {
        const simulator = useSimulatorStore();
        const pricedItemHrid = findFirstPricedItem();

        await simulator.setQueueBaselineForActivePlayer();
        simulator.activeQueueState.baseline.metrics = {
            dailyNoRngProfit: 2400,
            dps: 100,
            xpPerHour: 1200,
            killsPerHour: 100,
        };
        simulator.activePlayer.levels.stamina = 10;
        const addedItems = simulator.addActivePlayerToQueue();
        expect(Array.isArray(addedItems)).toBe(true);
        expect(addedItems).toHaveLength(1);

        simulator.updateActiveQueueSettings({
            rounds: 2,
            executionMode: "serial",
            medianBlend: 0.4,
            weightProfit: 1,
            weightXp: 0,
            weightDeathSafety: 0,
        });

        let callCount = 0;
        simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
            callCount += 1;
            onProgress?.({ progress: 1 });

            return {
                simulatedTime: ONE_HOUR,
                encounters: 90,
                experienceGained: {
                    player1: {
                        stamina: 900,
                    },
                },
                deaths: {
                    player1: 1,
                },
                consumablesUsed: !pricedItemHrid
                    ? {}
                    : { player1: { [pricedItemHrid]: 2 } },
            };
        });

        const rows = await simulator.runActiveQueue();
        const variantRow = rows[0];

        expect(simulator.runSingleSimulationPayload).toHaveBeenCalledTimes(2);
        expect(rows).toHaveLength(1);
        expect(variantRow).toBeTruthy();
        expect(simulator.activeQueueState.rawRuns).toHaveLength(2);
        expect(simulator.activeQueueState.ranking).toHaveLength(1);
        expect(simulator.activeQueueState.progress).toBe(1);
        expect(simulator.runtime.isRunning).toBe(false);
        expect(simulator.activeQueueState.isRunning).toBe(false);
        expect(Number(variantRow.deltaProfitPerHour)).toBeLessThanOrEqual(0);
    });

    it("runs queue in parallel execution mode", async () => {
        const simulator = useSimulatorStore();

        await simulator.setQueueBaselineForActivePlayer();
        simulator.activePlayer.levels.stamina = 10;
        simulator.addActivePlayerToQueue();
        simulator.queueRuntime.parallelWorkerLimit = 2;
        simulator.updateActiveQueueSettings({
            rounds: 2,
            executionMode: "parallel",
            medianBlend: 0.5,
            weightProfit: 1,
            weightXp: 0,
            weightDeathSafety: 0,
        });

        simulator.runSingleSimulationPayloadWithDedicatedWorker = vi.fn(async (_payload, onProgress) => {
            onProgress?.({ progress: 0.5 });
            onProgress?.({ progress: 1 });
            return {
                simulatedTime: ONE_HOUR,
                encounters: 100,
                experienceGained: {
                    player1: {
                        stamina: 1000,
                    },
                },
                deaths: {
                    player1: 0,
                },
                consumablesUsed: {},
            };
        });

        const rows = await simulator.runActiveQueue();

        expect(simulator.runSingleSimulationPayloadWithDedicatedWorker).toHaveBeenCalledTimes(2);
        expect(rows).toHaveLength(1);
        expect(simulator.activeQueueState.rawRuns).toHaveLength(2);
        expect(simulator.activeQueueState.progress).toBe(1);
        expect(simulator.activeQueueState.settings.executionMode).toBe("parallel");
    });

    it("splits queue variants by changes when multiple diffs exist", async () => {
        const simulator = useSimulatorStore();
        await simulator.setQueueBaselineForActivePlayer();

        simulator.activePlayer.levels.stamina = 10;
        simulator.activePlayer.levels.attack = 20;
        const addedItems = simulator.addActivePlayerToQueue();

        expect(Array.isArray(addedItems)).toBe(true);
        expect(addedItems.length).toBeGreaterThanOrEqual(2);
    });

    it("creates descriptive queue item names from change summary", async () => {
        const simulator = useSimulatorStore();
        await simulator.setQueueBaselineForActivePlayer();

        simulator.activePlayer.levels.stamina += 5;
        const addedItems = simulator.addActivePlayerToQueue();

        expect(addedItems).toHaveLength(1);
        expect(String(addedItems[0]?.name || "")).toContain("Stamina");
        expect(String(addedItems[0]?.name || "")).not.toMatch(/^Variant\s+\d+/);
    });

    it("restores active player snapshot to baseline after adding queue variants", async () => {
        const simulator = useSimulatorStore();
        await simulator.setQueueBaselineForActivePlayer();

        const baselineStamina = simulator.activeQueueState.baseline.snapshot.levels.stamina;
        simulator.activePlayer.levels.stamina = baselineStamina + 5;
        const addedItems = simulator.addActivePlayerToQueue();

        expect(addedItems.length).toBe(1);
        expect(simulator.activePlayer.levels.stamina).toBe(baselineStamina);
    });

    it("builds separate queue variants for house room changes", async () => {
        const simulator = useSimulatorStore();
        const firstRoom = findHouseRoomWithUpgradeLevels(1);
        const secondRoom = findHouseRoomWithUpgradeLevels(1, firstRoom?.hrid);
        expect(firstRoom).toBeTruthy();
        expect(secondRoom).toBeTruthy();

        await simulator.setQueueBaselineForActivePlayer();
        simulator.activePlayer.houseRooms[firstRoom.hrid] = 1;
        simulator.activePlayer.houseRooms[secondRoom.hrid] = 2;

        const addedItems = simulator.addActivePlayerToQueue();

        expect(addedItems).toHaveLength(2);
        expect(addedItems.every((item) => Array.isArray(item.changeDetails) && item.changeDetails.length === 1)).toBe(true);
        expect(addedItems.every((item) => item.changeDetails[0]?.kind === "house_room")).toBe(true);

        const firstVariant = addedItems.find((item) => item.changeDetails[0]?.roomHrid === firstRoom.hrid);
        const secondVariant = addedItems.find((item) => item.changeDetails[0]?.roomHrid === secondRoom.hrid);
        expect(firstVariant?.snapshot?.houseRooms?.[firstRoom.hrid]).toBe(1);
        expect(firstVariant?.snapshot?.houseRooms?.[secondRoom.hrid]).toBe(0);
        expect(secondVariant?.snapshot?.houseRooms?.[firstRoom.hrid]).toBe(0);
        expect(secondVariant?.snapshot?.houseRooms?.[secondRoom.hrid]).toBe(2);
        expect(simulator.activePlayer.houseRooms[firstRoom.hrid]).toBe(0);
        expect(simulator.activePlayer.houseRooms[secondRoom.hrid]).toBe(0);
    });

    it("uses manual equipment transition cost in queue ranking cost insights", async () => {
        const simulator = useSimulatorStore();
        const equipmentItemHrid = findFirstEquipmentItem();
        expect(equipmentItemHrid).toBeTruthy();

        await simulator.setQueueBaselineForActivePlayer();
        simulator.activePlayer.equipment.weapon.itemHrid = equipmentItemHrid;
        simulator.activePlayer.equipment.weapon.enhancementLevel = 2;
        const setCost = simulator.setActivePlayerEquipmentUpgradeCost("weapon", 123456);
        expect(setCost).toBe(true);

        const addedItems = simulator.addActivePlayerToQueue();
        expect(addedItems.length).toBe(1);

        simulator.updateActiveQueueSettings({
            rounds: 1,
            executionMode: "serial",
            medianBlend: 0.5,
            weightProfit: 1,
            weightXp: 0,
            weightDeathSafety: 0,
        });
        simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
            onProgress?.({ progress: 1 });
            return {
                simulatedTime: ONE_HOUR,
                encounters: 100,
                experienceGained: {
                    player1: {
                        stamina: 1000,
                    },
                },
                deaths: {
                    player1: 0,
                },
                consumablesUsed: {},
            };
        });

        const rows = await simulator.runActiveQueue();
        const variantRow = rows[0];

        expect(variantRow).toBeTruthy();
        expect(Number(variantRow.costInsights?.totalUpgradeCost)).toBe(123456);
    });

    it("includes house room upgrade cost in queue ranking cost insights", async () => {
        const simulator = useSimulatorStore();
        const room = findHouseRoomWithUpgradeLevels(1);
        expect(room).toBeTruthy();

        await simulator.setQueueBaselineForActivePlayer();
        simulator.activePlayer.houseRooms[room.hrid] = 1;
        const expectedPreview = simulator.previewHouseRoomUpgradeCost(
            simulator.activeQueueState.baseline.snapshot.houseRooms,
            simulator.activePlayer.houseRooms
        );

        const addedItems = simulator.addActivePlayerToQueue();
        expect(addedItems.length).toBe(1);
        expect(addedItems[0].changeDetails?.[0]?.kind).toBe("house_room");

        simulator.updateActiveQueueSettings({
            rounds: 1,
            executionMode: "serial",
            medianBlend: 0.5,
            weightProfit: 1,
            weightXp: 0,
            weightDeathSafety: 0,
        });
        simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
            onProgress?.({ progress: 1 });
            return {
                simulatedTime: ONE_HOUR,
                encounters: 100,
                experienceGained: {
                    player1: {
                        stamina: 1000,
                    },
                },
                deaths: {
                    player1: 0,
                },
                consumablesUsed: {},
            };
        });

        const rows = await simulator.runActiveQueue();
        const variantRow = rows[0];

        expect(variantRow).toBeTruthy();
        expect(Number(variantRow.costInsights?.totalUpgradeCost)).toBe(expectedPreview.totals.totalCost);
        expect(Number(variantRow.costInsights?.totalUpgradeCost)).toBeGreaterThan(0);
    });

    it("computes non-zero default ability upgrade cost from baseline snapshot", async () => {
        const simulator = useSimulatorStore();
        const abilityBookInfo = findFirstAbilityBookInfo();
        expect(abilityBookInfo).toBeTruthy();

        const { abilityHrid, xpPerBook, bookItemHrid } = abilityBookInfo;
        global.jigsAbilityXpLevels = [0, 100, 700];
        global.jigsSpellBookXpByName = {};

        await simulator.setQueueBaselineForActivePlayer();
        simulator.activePlayer.abilities[0].abilityHrid = abilityHrid;
        simulator.activePlayer.abilities[0].level = 2;

        const draft = simulator.resolveActivePlayerAbilityUpgradeCostDraft(0);
        const expectedBooks = Math.ceil((700 - 100) / xpPerBook);
        const expectedUnitPrice = Number(simulator.pricing?.priceTable?.[bookItemHrid]?.vendor || 0);

        expect(draft).toBeTruthy();
        expect(draft.cost).toBe(expectedBooks * expectedUnitPrice);
        expect(draft.cost).toBeGreaterThan(0);
    });

    it("computes skill-only queue upgrade cost without fetching external ability reference data", async () => {
        const simulator = useSimulatorStore();
        const abilityBookInfo = findFirstAbilityBookInfo();
        expect(abilityBookInfo).toBeTruthy();

        global.fetch = vi.fn(async () => ({ ok: false }));

        await simulator.setQueueBaselineForActivePlayer();
        simulator.activePlayer.abilities[0].abilityHrid = abilityBookInfo.abilityHrid;
        simulator.activePlayer.abilities[0].level = 2;
        const addedItems = simulator.addActivePlayerToQueue();

        expect(addedItems).toHaveLength(1);
        expect(addedItems[0].changeDetails?.[0]?.kind).toBe("ability");

        simulator.updateActiveQueueSettings({
            rounds: 1,
            executionMode: "serial",
            medianBlend: 0.5,
            weightProfit: 1,
            weightXp: 0,
            weightDeathSafety: 0,
        });
        simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
            onProgress?.({ progress: 1 });
            return {
                simulatedTime: ONE_HOUR,
                encounters: 100,
                experienceGained: {
                    player1: {
                        stamina: 1000,
                    },
                },
                deaths: {
                    player1: 0,
                },
                consumablesUsed: {},
            };
        });

        const rows = await simulator.runActiveQueue();
        const variantRow = rows[0];

        expect(simulator.runSingleSimulationPayload).toHaveBeenCalledTimes(1);
        expect(variantRow).toBeTruthy();
        expect(global.fetch).toHaveBeenCalledTimes(0);
        expect(Number(variantRow.costInsights?.totalUpgradeCost)).toBeGreaterThan(0);
    });

    it("auto-refreshes existing queue ranking after ability references load without rerunning simulations", async () => {
        const simulator = useSimulatorStore();
        const abilityBookInfo = findFirstAbilityBookInfo();
        expect(abilityBookInfo).toBeTruthy();

        const xpPerBook = Number(abilityBookInfo?.xpPerBook || 0);
        expect(xpPerBook).toBeGreaterThan(0);

        const startXp = Number(abilityXpLevels?.[1] ?? 0);
        const cheaperLevel = 2;
        const cheaperXp = Number(abilityXpLevels?.[cheaperLevel] ?? 0);
        const cheaperBooks = Math.ceil(Math.max(0, cheaperXp - startXp) / xpPerBook);
        expect(cheaperBooks).toBeGreaterThan(0);

        let expensiveLevel = cheaperLevel + 1;
        while (expensiveLevel < (abilityXpLevels?.length ?? 0)) {
            const xpValue = Number(abilityXpLevels?.[expensiveLevel] ?? 0);
            const booksNeeded = Math.ceil(Math.max(0, xpValue - startXp) / xpPerBook);
            if (booksNeeded > cheaperBooks) {
                break;
            }
            expensiveLevel += 1;
        }
        expect(expensiveLevel).toBeLessThan(abilityXpLevels.length);

        global.fetch = vi.fn(async () => ({ ok: false }));
        global.jigsAbilityXpLevels = [0, 0];
        global.jigsSpellBookXpByName = {};

        await simulator.setQueueBaselineForActivePlayer();

        simulator.activePlayer.abilities[0].abilityHrid = abilityBookInfo.abilityHrid;
        simulator.activePlayer.abilities[0].level = expensiveLevel;
        const expensiveItems = simulator.addActivePlayerToQueue();
        expect(expensiveItems).toHaveLength(1);

        simulator.activePlayer.abilities[0].abilityHrid = abilityBookInfo.abilityHrid;
        simulator.activePlayer.abilities[0].level = cheaperLevel;
        const cheaperItems = simulator.addActivePlayerToQueue();
        expect(cheaperItems).toHaveLength(1);

        const expensiveVariantId = expensiveItems[0].id;
        const cheaperVariantId = cheaperItems[0].id;

        simulator.queueRuntime.finalWeights = {
            performance: 0,
            stability: 0,
            cost: 1,
        };
        simulator.updateActiveQueueSettings({
            rounds: 1,
            executionMode: "serial",
            medianBlend: 0.5,
            weightProfit: 1,
            weightXp: 0,
            weightDeathSafety: 0,
        });
        simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
            onProgress?.({ progress: 1 });
            return {
                simulatedTime: ONE_HOUR,
                encounters: 100,
                experienceGained: {
                    player1: {
                        stamina: 1000,
                    },
                },
                deaths: {
                    player1: 0,
                },
                consumablesUsed: {},
            };
        });

        const rowsBeforeRefresh = await simulator.runActiveQueue();

        expect(simulator.runSingleSimulationPayload).toHaveBeenCalledTimes(2);
        expect(rowsBeforeRefresh).toHaveLength(2);
        expect(rowsBeforeRefresh[0].id).toBe(expensiveVariantId);
        expect(rowsBeforeRefresh[0].costInsights?.totalUpgradeCost).toBeNull();
        expect(rowsBeforeRefresh[1].costInsights?.totalUpgradeCost).toBeNull();

        const refreshResult = await simulator.ensureAbilityUpgradeReferenceDataLoaded(true);
        const refreshedRows = simulator.activeQueueState.ranking;
        const refreshedCheaperRow = refreshedRows.find((row) => row.id === cheaperVariantId);
        const refreshedExpensiveRow = refreshedRows.find((row) => row.id === expensiveVariantId);

        expect(refreshResult?.loaded).toBe(true);
        expect(simulator.runSingleSimulationPayload).toHaveBeenCalledTimes(2);
        expect(global.fetch).toHaveBeenCalledTimes(0);
        expect(refreshedRows).toHaveLength(2);
        expect(refreshedRows[0].id).toBe(cheaperVariantId);
        expect(refreshedCheaperRow).toBeTruthy();
        expect(refreshedExpensiveRow).toBeTruthy();
        expect(Number(refreshedCheaperRow.costInsights?.totalUpgradeCost)).toBeGreaterThan(0);
        expect(Number(refreshedExpensiveRow.costInsights?.totalUpgradeCost)).toBeGreaterThan(Number(refreshedCheaperRow.costInsights?.totalUpgradeCost));
        expect(refreshedCheaperRow.finalScore).toBeGreaterThan(refreshedExpensiveRow.finalScore);
    });

    it("runs baseline simulation when requested", async () => {
        const simulator = useSimulatorStore();
        simulator.setImportedProfileState("1", true);
        simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
            onProgress?.({ progress: 0.999 });
            return {
                simulatedTime: ONE_HOUR,
                encounters: 120,
                experienceGained: {
                    player1: {
                        stamina: 1200,
                    },
                },
                deaths: {
                    player1: 0,
                },
                consumablesUsed: {},
            };
        });

        const baseline = await simulator.setQueueBaselineForActivePlayer({ runSimulation: true });

        expect(simulator.runSingleSimulationPayload).toHaveBeenCalledTimes(1);
        expect(baseline?.metrics?.totalXpPerHour).toBeGreaterThan(0);
        expect(simulator.activeQueueState.isRunning).toBe(false);
        expect(simulator.runtime.progress).toBe(1);
    });

    it("preserves queue items when baseline simulation is rerun by default", async () => {
        const simulator = useSimulatorStore();
        await simulator.setQueueBaselineForActivePlayer();

        simulator.activePlayer.levels.stamina += 5;
        const appended = simulator.addActivePlayerToQueue();
        expect(appended).toHaveLength(1);
        const queueIdsBefore = simulator.activeQueueState.items.map((item) => item.id);

        simulator.setImportedProfileState("1", true);
        simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
            onProgress?.({ progress: 1 });
            return {
                simulatedTime: ONE_HOUR,
                encounters: 100,
                experienceGained: {
                    player1: {
                        stamina: 1000,
                    },
                },
                deaths: {
                    player1: 0,
                },
                consumablesUsed: {},
            };
        });

        await simulator.setQueueBaselineForActivePlayer({ runSimulation: true });
        expect(simulator.activeQueueState.items.map((item) => item.id)).toEqual(queueIdsBefore);
    });

    it("clears queue items when baseline simulation rerun opts out of preserve mode", async () => {
        const simulator = useSimulatorStore();
        await simulator.setQueueBaselineForActivePlayer();

        simulator.activePlayer.levels.stamina += 5;
        const appended = simulator.addActivePlayerToQueue();
        expect(appended).toHaveLength(1);

        simulator.setImportedProfileState("1", true);
        simulator.runSingleSimulationPayload = vi.fn(async (_payload, onProgress) => {
            onProgress?.({ progress: 1 });
            return {
                simulatedTime: ONE_HOUR,
                encounters: 100,
                experienceGained: {
                    player1: {
                        stamina: 1000,
                    },
                },
                deaths: {
                    player1: 0,
                },
                consumablesUsed: {},
            };
        });

        await simulator.setQueueBaselineForActivePlayer({ runSimulation: true, preserveQueueItems: false });
        expect(simulator.activeQueueState.items).toHaveLength(0);
    });

    it("requires imported profile before baseline simulation", async () => {
        const simulator = useSimulatorStore();
        await expect(simulator.setQueueBaselineForActivePlayer({ runSimulation: true }))
            .rejects
            .toThrow("common:queue.requireImportBeforeBaseline");
    });

    it("marks imported profile state after solo import", () => {
        const simulator = useSimulatorStore();
        const soloText = JSON.stringify({
            version: 2,
            player: {
                achievements: {
                    [ACHIEVEMENT_HRID]: true,
                },
            },
        });
        simulator.setImportedProfileState("1", false);

        simulator.importSoloConfig(soloText, "1");

        expect(simulator.queue.importedProfileByPlayer["1"]).toBe(true);
        expect(simulator.players[0].achievements[ACHIEVEMENT_HRID]).toBe(true);
        expect(JSON.parse(global.localStorage.getItem(PLAYER_ACHIEVEMENTS_STORAGE_KEY)).achievementsByPlayer["1"])
            .toEqual({ [ACHIEVEMENT_HRID]: true });
    });

    it("imports main-site shareable profile into the active player without changing simulation settings", () => {
        const simulator = useSimulatorStore();
        const headItemHrid = findFirstEquipmentItemByType("/equipment_types/head");
        const weaponItemHrid = findFirstEquipmentItemByType("/equipment_types/two_hand");
        const foodItemHrid = findFirstFoodWithDefaultTriggers();
        const drinkItemHrid = findFirstDrinkWithDefaultTriggers();
        const abilityHrid = findFirstAbilityWithDefaultTriggers();
        const zoneActionHrid = findFirstCombatAction(false);
        const houseRoomHrid = Object.keys(simulator.players[2].houseRooms)[0];

        expect(headItemHrid).toBeTruthy();
        expect(weaponItemHrid).toBeTruthy();
        expect(foodItemHrid).toBeTruthy();
        expect(drinkItemHrid).toBeTruthy();
        expect(abilityHrid).toBeTruthy();
        expect(zoneActionHrid).toBeTruthy();
        expect(houseRoomHrid).toBeTruthy();

        simulator.setActivePlayer("3");
        simulator.simulationSettings.mode = "zone";
        simulator.simulationSettings.useDungeon = true;
        simulator.simulationSettings.zoneHrid = "/actions/combat/jungle_planet";
        simulator.simulationSettings.dungeonHrid = "/actions/combat/chimerical_den";
        simulator.simulationSettings.difficultyTier = 2;
        simulator.simulationSettings.simulationTimeHours = 48;

        const payload = {
            profile: createMainSiteShareProfileFixture({
            skills: {
                stamina: 14,
                intelligence: 24,
                attack: 34,
                melee: 44,
                defense: 54,
                ranged: 64,
                magic: 74,
            },
            skillExperience: {
                stamina: 1400,
                intelligence: 2400,
                attack: 3400,
                melee: 4400,
                defense: 5400,
                ranged: 6400,
                magic: 7400,
            },
            wearableItemMap: {
                head: {
                    itemLocationHrid: "/item_locations/head",
                    itemHrid: headItemHrid,
                    enhancementLevel: 2,
                },
                weapon: {
                    itemLocationHrid: "/item_locations/two_hand",
                    itemHrid: weaponItemHrid,
                    enhancementLevel: 5,
                },
            },
            equippedAbilities: [
                {
                    slotNumber: 1,
                    abilityHrid,
                    level: 6,
                    experience: 0,
                },
            ],
            foodItemHrids: [foodItemHrid, "", ""],
            drinkItemHrids: [drinkItemHrid, "", ""],
            consumableCombatTriggersMap: {
                [foodItemHrid]: itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers,
                [drinkItemHrid]: itemDetailMap[drinkItemHrid].consumableDetail.defaultCombatTriggers,
            },
            abilityCombatTriggersMap: {
                [abilityHrid]: abilityDetailMap[abilityHrid].defaultCombatTriggers,
            },
            characterHouseRoomMap: {
                [houseRoomHrid]: {
                    level: 5,
                },
            },
            characterAchievements: [
                {
                    achievementHrid: ACHIEVEMENT_HRID,
                    progress: 1,
                    isCompleted: true,
                },
            ],
            }),
            mainSiteCombat: {
                actionHrid: zoneActionHrid,
                difficultyTier: 1,
            },
        };

        const result = simulator.importSoloConfig(JSON.stringify(payload), "3");

        expect(result.detectedFormat).toBe("main-site-share-profile");
        expect(simulator.players[2].name).toBe("Main Site Hero");
        expect(simulator.players[2].levels.stamina).toBe(14);
        expect(simulator.players[2].levels.magic).toBe(74);
        expect(simulator.players[2].skillExperience.stamina).toBe(1400);
        expect(simulator.players[2].skillExperience.magic).toBe(7400);
        expect(simulator.players[2].equipment.head.itemHrid).toBe(headItemHrid);
        expect(simulator.players[2].equipment.weapon.itemHrid).toBe(weaponItemHrid);
        expect(simulator.players[2].food[0]).toBe(foodItemHrid);
        expect(simulator.players[2].drinks[0]).toBe(drinkItemHrid);
        expect(simulator.players[2].abilities[0].abilityHrid).toBe(abilityHrid);
        expect(simulator.players[2].triggerMap[foodItemHrid]).toEqual(itemDetailMap[foodItemHrid].consumableDetail.defaultCombatTriggers);
        expect(simulator.players[2].triggerMap[drinkItemHrid]).toEqual(itemDetailMap[drinkItemHrid].consumableDetail.defaultCombatTriggers);
        expect(simulator.players[2].triggerMap[abilityHrid]).toEqual(abilityDetailMap[abilityHrid].defaultCombatTriggers);
        expect(simulator.players[2].houseRooms[houseRoomHrid]).toBe(5);
        expect(simulator.players[2].achievements[ACHIEVEMENT_HRID]).toBe(true);
        expect(simulator.players[0].name).toBe("Player 1");
        expect(simulator.queue.importedProfileByPlayer["3"]).toBe(true);
        expect(simulator.queue.importedBaselineByPlayer["3"].skillExperience.stamina).toBe(1400);
        expect(simulator.simulationSettings.mode).toBe("zone");
        expect(simulator.simulationSettings.useDungeon).toBe(false);
        expect(simulator.simulationSettings.zoneHrid).toBe(zoneActionHrid);
        expect(simulator.simulationSettings.difficultyTier).toBe(1);
        expect(simulator.simulationSettings.simulationTimeHours).toBe(48);
    });

    it("returns sorted market enhancement levels for an item", () => {
        const simulator = useSimulatorStore();
        const equipmentItemHrid = findFirstEquipmentItem();
        expect(equipmentItemHrid).toBeTruthy();

        simulator.pricing.enhancementLevelsByItem = {
            ...simulator.pricing.enhancementLevelsByItem,
            [equipmentItemHrid]: [5, 2, 3, 2, 1],
        };

        const levels = simulator.getMarketEnhancementLevelsForItem(equipmentItemHrid);
        expect(levels).toEqual([1, 2, 3, 5]);
    });

    it("accumulates single house room upgrade cost from current to target level", () => {
        const simulator = useSimulatorStore();
        const room = findHouseRoomWithUpgradeLevels(2);
        expect(room).toBeTruthy();

        const preview = simulator.previewHouseRoomUpgradeCost(
            { [room.hrid]: 0 },
            { [room.hrid]: 2 }
        );
        const expectedCounts = aggregateHouseRoomUpgradeCounts(room.hrid, 0, 2);
        const expectedTotal = computePreviewTotalFromCounts(expectedCounts, simulator.pricing.priceTable);

        expect(preview.rooms).toEqual([
            {
                roomHrid: room.hrid,
                fromLevel: 0,
                toLevel: 2,
                subtotal: expectedTotal,
            },
        ]);
        expect(preview.materials).toHaveLength(Object.keys(expectedCounts).length);
        for (const [itemHrid, count] of Object.entries(expectedCounts)) {
            const materialRow = preview.materials.find((entry) => entry.itemHrid === itemHrid);
            expect(materialRow).toBeTruthy();
            expect(materialRow.count).toBe(count);
        }
        expect(preview.totals.totalCost).toBe(expectedTotal);
    });

    it("aggregates multi-room upgrade materials and keeps totals aligned", () => {
        const simulator = useSimulatorStore();
        const firstRoom = findHouseRoomWithUpgradeLevels(1);
        const secondRoom = findHouseRoomWithUpgradeLevels(2, firstRoom?.hrid);
        expect(firstRoom).toBeTruthy();
        expect(secondRoom).toBeTruthy();

        const preview = simulator.previewHouseRoomUpgradeCost(
            {
                [firstRoom.hrid]: 0,
                [secondRoom.hrid]: 1,
            },
            {
                [firstRoom.hrid]: 1,
                [secondRoom.hrid]: 2,
            }
        );

        const firstCounts = aggregateHouseRoomUpgradeCounts(firstRoom.hrid, 0, 1);
        const secondCounts = aggregateHouseRoomUpgradeCounts(secondRoom.hrid, 1, 2);
        const expectedCounts = mergeMaterialCountMaps(firstCounts, secondCounts);
        const expectedFirstSubtotal = computePreviewTotalFromCounts(firstCounts, simulator.pricing.priceTable);
        const expectedSecondSubtotal = computePreviewTotalFromCounts(secondCounts, simulator.pricing.priceTable);
        const expectedTotal = computePreviewTotalFromCounts(expectedCounts, simulator.pricing.priceTable);

        const roomRowsByHrid = Object.fromEntries(preview.rooms.map((entry) => [entry.roomHrid, entry]));

        expect(preview.rooms).toHaveLength(2);
        expect(roomRowsByHrid[firstRoom.hrid]).toEqual({
            roomHrid: firstRoom.hrid,
            fromLevel: 0,
            toLevel: 1,
            subtotal: expectedFirstSubtotal,
        });
        expect(roomRowsByHrid[secondRoom.hrid]).toEqual({
            roomHrid: secondRoom.hrid,
            fromLevel: 1,
            toLevel: 2,
            subtotal: expectedSecondSubtotal,
        });
        for (const [itemHrid, count] of Object.entries(expectedCounts)) {
            const materialRow = preview.materials.find((entry) => entry.itemHrid === itemHrid);
            expect(materialRow).toBeTruthy();
            expect(materialRow.count).toBe(count);
        }
        expect(preview.totals.totalCost).toBe(expectedTotal);
        expect(preview.rooms.reduce((sum, room) => sum + Number(room.subtotal || 0), 0)).toBe(expectedTotal);
    });

    it("returns zero house room upgrade cost when target level is not above baseline", () => {
        const simulator = useSimulatorStore();
        const room = findHouseRoomWithUpgradeLevels(1);
        expect(room).toBeTruthy();

        const preview = simulator.previewHouseRoomUpgradeCost(
            { [room.hrid]: 3 },
            { [room.hrid]: 1 }
        );

        expect(preview.rooms).toEqual([]);
        expect(preview.materials).toEqual([]);
        expect(preview.totals).toEqual({
            coinCost: 0,
            materialValue: 0,
            totalCost: 0,
        });
    });

    it("marks missing house room material prices and excludes them from total", () => {
        const simulator = useSimulatorStore();
        const room = findHouseRoomWithUpgradeLevels(1);
        expect(room).toBeTruthy();

        const firstLevelCosts = Array.isArray(room?.upgradeCostsMap?.["1"]) ? room.upgradeCostsMap["1"] : [];
        const missingPriceMaterial = firstLevelCosts.find((entry) => String(entry?.itemHrid || "") !== "/items/coin");
        expect(missingPriceMaterial).toBeTruthy();

        simulator.pricing.priceTable = {
            ...simulator.pricing.priceTable,
            [missingPriceMaterial.itemHrid]: {
                ask: -1,
                bid: -1,
                vendor: 0,
            },
        };

        const preview = simulator.previewHouseRoomUpgradeCost(
            { [room.hrid]: 0 },
            { [room.hrid]: 1 }
        );
        const missingRow = preview.materials.find((entry) => entry.itemHrid === missingPriceMaterial.itemHrid);
        const expectedCounts = aggregateHouseRoomUpgradeCounts(room.hrid, 0, 1);
        const expectedTotal = computePreviewTotalFromCounts(expectedCounts, simulator.pricing.priceTable);

        expect(missingRow).toBeTruthy();
        expect(missingRow.priced).toBe(false);
        expect(missingRow.subtotal).toBe(0);
        expect(preview.totals.totalCost).toBe(expectedTotal);
    });

    it("stores only meaningful player snapshots when saving snapshot data", () => {
        const simulator = useSimulatorStore();

        simulator.players[0].levels.stamina = 99;
        simulator.players[0].skillExperience.stamina = 123456;
        const saveResult = simulator.savePlayerDataSnapshot();
        expect(saveResult.ok).toBe(true);

        const rowsWithSnapshot = simulator.playerDataSnapshotRows.filter((row) => row.hasSnapshot);
        expect(rowsWithSnapshot).toHaveLength(1);
        expect(rowsWithSnapshot[0].playerId).toBe("1");

        const storedSnapshotPayload = JSON.parse(simulator.playerDataSnapshot.playerDataMap["1"]);
        expect(storedSnapshotPayload.version).toBe(2);
        expect(storedSnapshotPayload.player.skillExperience.stamina).toBe(123456);
    });

    it("restores imported baseline snapshot when loading player data snapshot", () => {
        const simulator = useSimulatorStore();
        simulator.players[0].levels.stamina = 99;
        simulator.players[0].skillExperience.stamina = 654321;

        const saveResult = simulator.savePlayerDataSnapshot();
        expect(saveResult.ok).toBe(true);

        simulator.players[0].levels.stamina = 1;
        simulator.players[0].skillExperience.stamina = null;
        simulator.queue.importedBaselineByPlayer["1"] = null;

        const loadResult = simulator.loadPlayerDataSnapshot();
        expect(loadResult.ok).toBe(true);
        expect(simulator.players[0].levels.stamina).toBe(99);
        expect(simulator.players[0].skillExperience.stamina).toBe(654321);
        expect(simulator.queue.importedBaselineByPlayer["1"].skillExperience.stamina).toBe(654321);
    });

    it("restores zone and difficulty from modern player data snapshot without forcing labyrinth mode", () => {
        const simulator = useSimulatorStore();
        const payload = {
            version: 1,
            savedAt: Date.now(),
            playerDataMap: {
                "1": JSON.stringify({
                    version: 2,
                    player: {
                        levels: {
                            stamina: 2,
                        },
                    },
                    simulationSettings: {
                        mode: "zone",
                        runScope: "single",
                        useDungeon: false,
                        zoneHrid: "/actions/combat/jungle_planet",
                        dungeonHrid: "/actions/combat/chimerical_den",
                        difficultyTier: 3,
                        simulationTimeHours: 24,
                        labyrinthHrid: "/monsters/cyclops",
                        roomLevel: 100,
                    },
                }),
            },
        };
        global.localStorage.setItem("mwi.player.data.snapshot.v1", JSON.stringify(payload));

        const loadResult = simulator.loadPlayerDataSnapshot();
        expect(loadResult.ok).toBe(true);
        expect(simulator.simulationSettings.mode).toBe("zone");
        expect(simulator.simulationSettings.useDungeon).toBe(false);
        expect(simulator.simulationSettings.zoneHrid).toBe("/actions/combat/jungle_planet");
        expect(simulator.simulationSettings.difficultyTier).toBe(3);
    });

    it("preserves achievements when restoring player snapshot without achievements field", () => {
        const simulator = useSimulatorStore();
        simulator.players[0].achievements = {
            [ACHIEVEMENT_HRID]: true,
        };

        const payload = {
            version: 1,
            savedAt: Date.now(),
            playerDataMap: {
                "1": JSON.stringify({
                    version: 2,
                    player: {
                        levels: {
                            stamina: 2,
                        },
                    },
                    simulationSettings: {
                        mode: "zone",
                        runScope: "single",
                        useDungeon: false,
                        zoneHrid: "/actions/combat/jungle_planet",
                        difficultyTier: 1,
                        simulationTimeHours: 24,
                    },
                }),
            },
        };
        global.localStorage.setItem("mwi.player.data.snapshot.v1", JSON.stringify(payload));

        const loadResult = simulator.loadPlayerDataSnapshot();

        expect(loadResult.ok).toBe(true);
        expect(simulator.players[0].achievements).toEqual({
            [ACHIEVEMENT_HRID]: true,
        });
    });

    it("preserves achievements on modern solo import when achievements field is missing", () => {
        const simulator = useSimulatorStore();
        simulator.players[0].achievements = {
            [ACHIEVEMENT_HRID]: true,
        };

        simulator.importSoloConfig(JSON.stringify({
            version: 2,
            player: {
                levels: {
                    stamina: 2,
                },
            },
        }), "1");

        expect(simulator.players[0].achievements).toEqual({
            [ACHIEVEMENT_HRID]: true,
        });
    });

    it("supports manual legacy solo import payloads", () => {
        const simulator = useSimulatorStore();

        const result = simulator.importSoloConfig(JSON.stringify({
            player: {
                intelligenceLevel: 102,
                magicLevel: 125,
                staminaLevel: 103,
                defenseLevel: 112,
                meleeLevel: 66,
                attackLevel: 117,
                rangedLevel: 52,
                equipment: [
                    {
                        itemLocationHrid: "/item_locations/head",
                        itemHrid: "/items/magicians_hat",
                        enhancementLevel: 6,
                    },
                    {
                        itemLocationHrid: "/item_locations/main_hand",
                        itemHrid: "/items/blazing_trident",
                        enhancementLevel: 10,
                    },
                ],
            },
            food: {
                "/action_types/combat": [
                    { itemHrid: "/items/star_fruit_gummy" },
                    { itemHrid: "/items/dragon_fruit_yogurt" },
                    { itemHrid: "/items/marsberry_cake" },
                ],
            },
            drinks: {
                "/action_types/combat": [
                    { itemHrid: "/items/wisdom_coffee" },
                    { itemHrid: "/items/super_magic_coffee" },
                    { itemHrid: "/items/channeling_coffee" },
                ],
            },
            abilities: [
                { abilityHrid: "/abilities/mystic_aura", level: 26 },
                { abilityHrid: "/abilities/elemental_affinity", level: 60 },
                { abilityHrid: "/abilities/firestorm", level: 60 },
                { abilityHrid: "/abilities/flame_blast", level: 70 },
                { abilityHrid: "/abilities/fireball", level: 70 },
            ],
            triggerMap: {
                "/abilities/mystic_aura": [],
            },
            houseRooms: {
                "/house_rooms/archery_range": 1,
            },
        }), "1");

        expect(result.detectedFormat).toBe("legacy-solo");
        expect(simulator.players[0].levels.attack).toBe(117);
        expect(simulator.players[0].equipment.weapon.itemHrid).toBe("/items/blazing_trident");
        expect(simulator.players[0].food[0]).toBe("/items/star_fruit_gummy");
        expect(simulator.players[0].abilities[4].abilityHrid).toBe("/abilities/fireball");
    });

    it("clears achievements only when import explicitly provides empty achievements", () => {
        const simulator = useSimulatorStore();
        simulator.players[0].achievements = {
            [ACHIEVEMENT_HRID]: true,
        };

        simulator.importSoloConfig(JSON.stringify({
            version: 2,
            player: {
                levels: {
                    stamina: 2,
                },
                achievements: {},
            },
            simulationSettings: {
                mode: "zone",
                runScope: "single",
                useDungeon: false,
                zoneHrid: "/actions/combat/jungle_planet",
                difficultyTier: 1,
                simulationTimeHours: 24,
            },
        }), "1");

        expect(simulator.players[0].achievements).toEqual({});
    });

    it("reads modern snapshot hrids for summary rows", () => {
        const simulator = useSimulatorStore();
        const payload = {
            version: 1,
            savedAt: Date.now(),
            playerDataMap: {
                "1": JSON.stringify({
                    version: 2,
                    player: {
                        levels: {
                            stamina: 2,
                        },
                    },
                    simulationSettings: {
                        mode: "zone",
                        runScope: "single",
                        useDungeon: false,
                        zoneHrid: "/actions/combat/jungle_planet",
                        dungeonHrid: "/actions/combat/chimerical_den",
                        labyrinthHrid: "/monsters/cyclops",
                        difficultyTier: 1,
                        simulationTimeHours: 24,
                        roomLevel: 100,
                    },
                }),
            },
        };
        global.localStorage.setItem("mwi.player.data.snapshot.v1", JSON.stringify(payload));

        simulator.refreshPlayerDataSnapshot();
        const row = simulator.playerDataSnapshotRows.find((entry) => entry.playerId === "1");

        expect(row).toBeTruthy();
        expect(row.hasSnapshot).toBe(true);
        expect(row.zoneHrid).toBe("/actions/combat/jungle_planet");
        expect(row.dungeonHrid).toBe("/actions/combat/chimerical_den");
        expect(row.labyrinthHrid).toBe("/monsters/cyclops");
    });

    it("saves queue template sets without snapshot data in store/cache", () => {
        const simulator = useSimulatorStore();

        simulator.saveEquipmentSet("Test Set");
        expect(simulator.equipmentSetEntries[0]?.name).toBe("Test Set");
        expect(simulator.equipmentSets["Test Set"]?.snapshot).toBeUndefined();

        const persisted = JSON.parse(global.localStorage.getItem("mwi.equipmentSets.v2") || "{}");
        expect(persisted["Test Set"]?.snapshot).toBeUndefined();
    });

    it("stores queue change templates in equipment sets without before fields", async () => {
        const simulator = useSimulatorStore();
        const headItemHrid = String(simulator.options?.equipmentBySlot?.head?.[0]?.hrid || "");

        expect(headItemHrid).toBeTruthy();

        await simulator.setQueueBaselineForActivePlayer();
        simulator.activePlayer.equipment.head.itemHrid = headItemHrid;
        simulator.activePlayer.equipment.head.enhancementLevel = 3;
        const appendedItems = simulator.addActivePlayerToQueue();
        expect(Array.isArray(appendedItems)).toBe(true);
        expect(appendedItems.length).toBeGreaterThan(0);

        simulator.saveEquipmentSet("Queue Template Set");
        const queueChanges = simulator.equipmentSets["Queue Template Set"]?.queueChanges;

        expect(Array.isArray(queueChanges?.items)).toBe(true);
        expect(queueChanges.items.length).toBeGreaterThan(0);
        expect(Array.isArray(queueChanges.items[0]?.targets)).toBe(true);
        expect(queueChanges.items[0].targets.length).toBeGreaterThan(0);
        queueChanges.items[0].targets.forEach((target) => {
            expect(Object.keys(target).some((key) => key.startsWith("before"))).toBe(false);
        });
    });

    it("ignores non-modern equipment sets without queue changes metadata", () => {
        const simulator = useSimulatorStore();
        const legacySnapshot = JSON.parse(JSON.stringify(simulator.activePlayer));

        global.localStorage.setItem("mwi.equipmentSets.v2", JSON.stringify({
            "Legacy Set": {
                savedAt: Date.now(),
                snapshot: legacySnapshot,
            },
        }));

        simulator.refreshEquipmentSets();
        const loadedRow = simulator.equipmentSetEntries.find((entry) => entry.name === "Legacy Set");

        expect(loadedRow).toBeUndefined();
        expect(simulator.equipmentSets["Legacy Set"]).toBeUndefined();
    });

    it("imports queue changes by rebuilding baseline and resetting custom cost maps", async () => {
        const simulator = useSimulatorStore();
        const headItemHrid = String(simulator.options?.equipmentBySlot?.head?.[0]?.hrid || "");

        expect(headItemHrid).toBeTruthy();

        await simulator.setQueueBaselineForActivePlayer();
        simulator.activePlayer.equipment.head.itemHrid = headItemHrid;
        simulator.activePlayer.equipment.head.enhancementLevel = 4;
        const appendedItems = simulator.addActivePlayerToQueue();
        expect(Array.isArray(appendedItems)).toBe(true);
        expect(appendedItems.length).toBeGreaterThan(0);

        simulator.activeQueueState.enhancementUpgradeCosts = { any: 123 };
        simulator.activeQueueState.abilityUpgradeCosts = { any: 456 };
        simulator.saveEquipmentSet("Import Queue Set");

        simulator.activePlayer.equipment.head.itemHrid = headItemHrid;
        simulator.activePlayer.equipment.head.enhancementLevel = 2;

        const importResult = simulator.importEquipmentSetQueueChanges("Import Queue Set");
        expect(importResult.ok).toBe(true);
        expect(importResult.importedCount).toBeGreaterThan(0);
        expect(simulator.activeQueueState.baseline?.snapshot?.equipment?.head?.enhancementLevel).toBe(2);
        expect(simulator.activeQueueState.enhancementUpgradeCosts).toEqual({});
        expect(simulator.activeQueueState.abilityUpgradeCosts).toEqual({});

        const importedEquipmentVariant = simulator.activeQueueState.items.find((item) => (
            String(item?.snapshot?.equipment?.head?.itemHrid || "") === headItemHrid
            && Number(item?.snapshot?.equipment?.head?.enhancementLevel || 0) === 4
        ));
        expect(importedEquipmentVariant).toBeTruthy();

        const loaded = simulator.loadQueueSnapshotToActivePlayer(importedEquipmentVariant.id);
        expect(loaded).toBe(true);

        const draft = simulator.resolveActivePlayerEquipmentUpgradeCostDraft("head");
        expect(draft).toBeTruthy();
        expect(draft.beforeLevel).toBe(2);
        expect(draft.afterLevel).toBe(4);
    });

    it("recomputes ability upgrade draft from import-time baseline after queue change import", async () => {
        const simulator = useSimulatorStore();
        const abilityBookInfo = findFirstAbilityBookInfo();
        expect(abilityBookInfo).toBeTruthy();
        const abilityHrid = String(abilityBookInfo.abilityHrid || "");

        await simulator.setQueueBaselineForActivePlayer();
        simulator.activePlayer.abilities[0].abilityHrid = abilityHrid;
        simulator.activePlayer.abilities[0].level = 4;
        const appendedItems = simulator.addActivePlayerToQueue();
        expect(Array.isArray(appendedItems)).toBe(true);
        expect(appendedItems.length).toBeGreaterThan(0);
        simulator.saveEquipmentSet("Import Ability Queue Set");

        simulator.activePlayer.abilities[0].abilityHrid = abilityHrid;
        simulator.activePlayer.abilities[0].level = 3;

        const importResult = simulator.importEquipmentSetQueueChanges("Import Ability Queue Set");
        expect(importResult.ok).toBe(true);
        expect(importResult.importedCount).toBeGreaterThan(0);

        const importedAbilityVariant = simulator.activeQueueState.items.find((item) => (
            String(item?.snapshot?.abilities?.[0]?.abilityHrid || "") === abilityHrid
            && Number(item?.snapshot?.abilities?.[0]?.level || 0) === 4
        ));
        expect(importedAbilityVariant).toBeTruthy();

        const loaded = simulator.loadQueueSnapshotToActivePlayer(importedAbilityVariant.id);
        expect(loaded).toBe(true);

        const draft = simulator.resolveActivePlayerAbilityUpgradeCostDraft(0);
        expect(draft).toBeTruthy();
        expect(draft.abilityHrid).toBe(abilityHrid);
        expect(draft.fromLevel).toBe(3);
        expect(draft.toLevel).toBe(4);
    });

    it("persists achievements when loading a queue snapshot to the active player", () => {
        const simulator = useSimulatorStore();
        const snapshot = JSON.parse(JSON.stringify(simulator.activePlayer));
        snapshot.achievements = {
            [ACHIEVEMENT_HRID]: true,
        };
        simulator.activeQueueState.items = [{
            id: "achievement-snapshot",
            snapshot,
        }];

        const loaded = simulator.loadQueueSnapshotToActivePlayer("achievement-snapshot");

        expect(loaded).toBe(true);
        expect(simulator.activePlayer.achievements[ACHIEVEMENT_HRID]).toBe(true);
        expect(JSON.parse(global.localStorage.getItem(PLAYER_ACHIEVEMENTS_STORAGE_KEY)).achievementsByPlayer["1"])
            .toEqual({ [ACHIEVEMENT_HRID]: true });
    });

    it("returns explicit failure when importing empty queue changes and keeps existing queue", async () => {
        const simulator = useSimulatorStore();
        simulator.saveEquipmentSet("Empty Queue Set");

        await simulator.setQueueBaselineForActivePlayer();
        simulator.activePlayer.levels.stamina = 5;
        simulator.addActivePlayerToQueue();

        const beforeBaselineCreatedAt = simulator.activeQueueState.baseline?.createdAt;
        const beforeItemIds = simulator.activeQueueState.items.map((item) => item.id);

        const importResult = simulator.importEquipmentSetQueueChanges("Empty Queue Set");
        expect(importResult.ok).toBe(false);
        expect(importResult.messageKey).toBe("common:vue.settings.msgQueueChangesImportEmpty");
        expect(simulator.activeQueueState.baseline?.createdAt).toBe(beforeBaselineCreatedAt);
        expect(simulator.activeQueueState.items.map((item) => item.id)).toEqual(beforeItemIds);
    });

    it("applies trigger defaults and allows override", () => {
        const simulator = useSimulatorStore();
        const foodHrid = findFirstFoodWithDefaultTriggers();
        const abilityHrid = findFirstAbilityWithDefaultTriggers();

        expect(foodHrid).toBeTruthy();
        expect(abilityHrid).toBeTruthy();

        const defaultFoodTriggers = simulator.ensureActivePlayerTriggerDefaults(foodHrid);
        expect(defaultFoodTriggers.length).toBeGreaterThan(0);

        simulator.setActivePlayerTriggers(foodHrid, []);
        expect(simulator.getActivePlayerTriggers(foodHrid)).toEqual([]);

        const defaultAbilityTriggers = simulator.resetActivePlayerTriggersToDefault(abilityHrid);
        expect(defaultAbilityTriggers.length).toBeGreaterThan(0);
    });

    it("supports manual price overrides and reset", () => {
        const simulator = useSimulatorStore();
        const itemHrid = findFirstPricedItem();

        expect(itemHrid).toBeTruthy();

        const baseAsk = simulator.pricing.basePriceTable[itemHrid]?.ask;
        const baseBid = simulator.pricing.basePriceTable[itemHrid]?.bid;

        simulator.setPriceOverride(itemHrid, { ask: 123, bid: 456 });
        expect(simulator.pricing.priceTable[itemHrid]?.ask).toBe(123);
        expect(simulator.pricing.priceTable[itemHrid]?.bid).toBe(456);
        expect(simulator.pricing.overrides[itemHrid]).toEqual({ ask: 123, bid: 456 });

        simulator.setPriceOverride(itemHrid, { ask: null });
        expect(simulator.pricing.priceTable[itemHrid]?.ask).toBe(baseAsk);
        expect(simulator.pricing.priceTable[itemHrid]?.bid).toBe(456);
        expect(simulator.pricing.overrides[itemHrid]).toEqual({ bid: 456 });

        const resetOne = simulator.resetPriceOverride(itemHrid);
        expect(resetOne).toBe(true);
        expect(simulator.pricing.overrides[itemHrid]).toBeUndefined();
        expect(simulator.pricing.priceTable[itemHrid]?.ask).toBe(baseAsk);
        expect(simulator.pricing.priceTable[itemHrid]?.bid).toBe(baseBid);

        const resetAll = simulator.resetAllPriceOverrides();
        expect(resetAll).toBe(false);
    });

    it("refetches market prices when cached table misses enhancement data", async () => {
        const simulator = useSimulatorStore();
        simulator.pricing.lastFetchedAt = Date.now();
        simulator.pricing.sourceUrl = "https://example.com";
        simulator.pricing.enhancementQuotesByItem = {};
        simulator.pricing.enhancementLevelsByItem = {};
        simulator.fetchMarketPrices = vi.fn(async () => ({
            sourceUrl: "https://example.com",
            lastFetchedAt: Date.now(),
        }));

        await simulator.ensureMarketPricesLoaded();

        expect(simulator.fetchMarketPrices).toHaveBeenCalledTimes(1);
    });

    it("does not refetch market prices when cached data is complete and refresh is not forced", async () => {
        const simulator = useSimulatorStore();
        simulator.pricing.lastFetchedAt = Date.now();
        simulator.pricing.sourceUrl = "https://example.com";
        simulator.pricing.enhancementQuotesByItem = {
            "/items/test_item": {
                "0": { ask: 10, bid: 9 },
            },
        };
        simulator.pricing.enhancementLevelsByItem = {
            "/items/test_item": [1],
        };
        simulator.fetchMarketPrices = vi.fn(async () => ({
            sourceUrl: "https://example.com",
            lastFetchedAt: Date.now(),
        }));

        await simulator.ensureMarketPricesLoaded();

        expect(simulator.fetchMarketPrices).not.toHaveBeenCalled();
    });

    it("force refreshes market prices when cached data already exists", async () => {
        const simulator = useSimulatorStore();
        simulator.pricing.lastFetchedAt = Date.now();
        simulator.pricing.sourceUrl = "https://example.com";
        simulator.pricing.enhancementQuotesByItem = {
            "/items/test_item": {
                "0": { ask: 10, bid: 9 },
            },
        };
        simulator.pricing.enhancementLevelsByItem = {
            "/items/test_item": [1],
        };
        simulator.fetchMarketPrices = vi.fn(async () => ({
            sourceUrl: "https://example.com",
            lastFetchedAt: Date.now(),
        }));

        await simulator.ensureMarketPricesLoaded(true);

        expect(simulator.fetchMarketPrices).toHaveBeenCalledTimes(1);
    });

    it("does not force refresh market prices while a load is already in progress", async () => {
        const simulator = useSimulatorStore();
        simulator.pricing.isLoading = true;
        simulator.fetchMarketPrices = vi.fn(async () => ({
            sourceUrl: "https://example.com",
            lastFetchedAt: Date.now(),
        }));

        const result = await simulator.ensureMarketPricesLoaded(true);

        expect(result).toBeNull();
        expect(simulator.fetchMarketPrices).not.toHaveBeenCalled();
    });

    it("swallows force refresh errors and preserves pricing error state", async () => {
        const simulator = useSimulatorStore();
        simulator.pricing.lastFetchedAt = Date.now();
        simulator.pricing.sourceUrl = "https://example.com";
        simulator.fetchMarketPrices = vi.fn(async () => {
            simulator.pricing.error = "boom";
            throw new Error("boom");
        });

        const result = await simulator.ensureMarketPricesLoaded(true);

        expect(result).toBeNull();
        expect(simulator.fetchMarketPrices).toHaveBeenCalledTimes(1);
        expect(simulator.pricing.error).toBe("boom");
    });
});

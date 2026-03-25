import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createMainSiteShareProfileFixture } from "./fixtures/mainSiteShareProfileFixture.js";
import { applyTampermonkeyImportMessage } from "../tampermonkeyImportBridge.js";
import { useSimulatorStore } from "../../stores/simulatorStore.js";

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

function createImportMessage(overrides = {}) {
    const characterName = overrides.characterName ?? "Imported Hero";
    return {
        requestId: String(overrides.requestId ?? `request-${characterName}`),
        targetPlayerId: String(overrides.targetPlayerId ?? "1"),
        payload: createMainSiteShareProfileFixture({ characterName }),
        ...overrides,
    };
}

describe("tampermonkeyImportBridge", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        global.localStorage = createLocalStorageMock();
    });

    it("keeps the original active player during multi-slot team imports", () => {
        const simulator = useSimulatorStore();
        simulator.setActivePlayer("4");

        applyTampermonkeyImportMessage(simulator, createImportMessage({
            requestId: "team-1",
            targetPlayerId: "1",
            characterName: "Team Alpha",
            resetTeamSelection: true,
            selectAfterImport: true,
            activateAfterImport: false,
        }));
        applyTampermonkeyImportMessage(simulator, createImportMessage({
            requestId: "team-2",
            targetPlayerId: "2",
            characterName: "Team Beta",
            selectAfterImport: true,
            activateAfterImport: false,
        }));
        applyTampermonkeyImportMessage(simulator, createImportMessage({
            requestId: "team-3",
            targetPlayerId: "3",
            characterName: "Team Gamma",
            selectAfterImport: true,
            activateAfterImport: false,
        }));

        expect(simulator.activePlayerId).toBe("4");
        expect(simulator.players[0].name).toBe("Team Alpha");
        expect(simulator.players[1].name).toBe("Team Beta");
        expect(simulator.players[2].name).toBe("Team Gamma");
        expect(simulator.players[0].selected).toBe(true);
        expect(simulator.players[1].selected).toBe(true);
        expect(simulator.players[2].selected).toBe(true);
        expect(simulator.players[3].selected).toBe(false);
    });

    it("keeps the original active player even when that slot is part of the imported team", () => {
        const simulator = useSimulatorStore();
        simulator.setActivePlayer("2");

        applyTampermonkeyImportMessage(simulator, createImportMessage({
            requestId: "team-same-1",
            targetPlayerId: "1",
            characterName: "Team One",
            resetTeamSelection: true,
            selectAfterImport: true,
            activateAfterImport: false,
        }));
        applyTampermonkeyImportMessage(simulator, createImportMessage({
            requestId: "team-same-2",
            targetPlayerId: "2",
            characterName: "Team Two",
            selectAfterImport: true,
            activateAfterImport: false,
        }));
        applyTampermonkeyImportMessage(simulator, createImportMessage({
            requestId: "team-same-3",
            targetPlayerId: "3",
            characterName: "Team Three",
            selectAfterImport: true,
            activateAfterImport: false,
        }));

        expect(simulator.activePlayerId).toBe("2");
        expect(simulator.players[1].name).toBe("Team Two");
        expect(simulator.players[1].selected).toBe(true);
    });

    it("keeps backward-compatible activation when only selectAfterImport is provided", () => {
        const simulator = useSimulatorStore();
        simulator.setActivePlayer("4");

        applyTampermonkeyImportMessage(simulator, createImportMessage({
            requestId: "legacy-single",
            targetPlayerId: "2",
            characterName: "Solo Import",
            selectAfterImport: true,
        }));

        expect(simulator.activePlayerId).toBe("2");
        expect(simulator.players[1].name).toBe("Solo Import");
        expect(simulator.players[1].selected).toBe(true);
    });

    it("resets team selection before marking imported slots as selected", () => {
        const simulator = useSimulatorStore();
        simulator.players.forEach((player) => {
            player.selected = true;
        });

        applyTampermonkeyImportMessage(simulator, createImportMessage({
            requestId: "selection-reset",
            targetPlayerId: "2",
            characterName: "Selection Reset",
            resetTeamSelection: true,
            selectAfterImport: true,
            activateAfterImport: false,
        }));

        expect(simulator.players[0].selected).toBe(false);
        expect(simulator.players[1].selected).toBe(true);
        expect(simulator.players[2].selected).toBe(false);
        expect(simulator.players[3].selected).toBe(false);
        expect(simulator.players[4].selected).toBe(false);
    });

    it("clears requested non-target slots without affecting the imported target slot", () => {
        const simulator = useSimulatorStore();

        simulator.importSoloConfig(JSON.stringify(createMainSiteShareProfileFixture({ characterName: "Existing Two" })), "2");
        simulator.importSoloConfig(JSON.stringify(createMainSiteShareProfileFixture({ characterName: "Existing Three" })), "3");

        applyTampermonkeyImportMessage(simulator, createImportMessage({
            requestId: "clear-others",
            targetPlayerId: "1",
            characterName: "Fresh One",
            clearPlayerIds: ["1", "2", "3"],
            selectAfterImport: true,
            activateAfterImport: false,
        }));

        expect(simulator.players[0].name).toBe("Fresh One");
        expect(simulator.queue.importedProfileByPlayer["1"]).toBe(true);
        expect(simulator.players[1].name).toBe("Player 2");
        expect(simulator.players[2].name).toBe("Player 3");
        expect(simulator.queue.importedProfileByPlayer["2"]).toBe(false);
        expect(simulator.queue.importedProfileByPlayer["3"]).toBe(false);
    });
});

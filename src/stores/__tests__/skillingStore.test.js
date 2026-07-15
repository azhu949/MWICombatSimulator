import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { skillingData } from "../../shared/gameDataIndex.js";
import {
    SKILLING_STORAGE_KEY,
    loadSkillingPersistedState,
    normalizeSkillingPersistedState,
    useSkillingStore,
} from "../skillingStore.js";

function createLocalStorageMock(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem: vi.fn((key) => values.get(key) ?? null),
        setItem: vi.fn((key, value) => values.set(key, String(value))),
        removeItem: vi.fn((key) => values.delete(key)),
        values,
    };
}

function createProfile(level = 12) {
    return {
        version: 1,
        characterName: "Ledger",
        importedAt: 1234,
        skills: Object.fromEntries([
            ...skillingData.skillHrids.map((skillHrid) => [skillHrid, { level, experience: null }]),
            ["/skills/total_level", { level: level * 5, experience: null }],
        ]),
        inventory: { "/items/coin": 5 },
        equipment: [],
        buffsBySource: {},
        drinkSlotsByActionType: {
            "/action_types/brewing": [{
                slotIndex: 0,
                itemHrid: "/items/brewing_tea",
                isActive: null,
            }],
        },
    };
}

describe("skillingStore", () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        global.localStorage = createLocalStorageMock();
    });

    it("persists only the profile and five target levels", async () => {
        const store = useSkillingStore();
        store.importProfile(createProfile());
        store.result = { generatedAt: 999, plansBySkill: {} };
        store.setTargetLevel("/skills/cooking", 20);
        await Promise.resolve();

        const serialized = JSON.parse(global.localStorage.values.get(SKILLING_STORAGE_KEY));
        expect(serialized.profile.characterName).toBe("Ledger");
        expect(serialized.targetLevels["/skills/cooking"]).toBe(20);
        expect(serialized.profile.drinkSlotsByActionType["/action_types/brewing"][0]).toEqual({
            slotIndex: 0,
            itemHrid: "/items/brewing_tea",
            isActive: null,
        });
        expect(Object.keys(serialized.targetLevels)).toEqual(skillingData.skillHrids);
        expect(serialized).not.toHaveProperty("result");

        const reloaded = loadSkillingPersistedState(global.localStorage);
        expect(reloaded.profile.drinkSlotsByActionType).toEqual(serialized.profile.drinkSlotsByActionType);
    });

    it("defaults each target to current level plus one and clamps at 200", () => {
        const profile = createProfile(200);
        profile.skills["/skills/total_level"].level = 1250;
        profile.equipment = [{
            id: "cape",
            itemHrid: "/items/artificer_cape",
            equipmentType: "/equipment_types/back",
            enhancementLevel: 12,
            count: 1,
            isEquipped: false,
        }];
        const normalized = normalizeSkillingPersistedState({ profile });
        expect(Object.values(normalized.targetLevels)).toEqual([200, 200, 200, 200, 200]);
        expect(normalized.profile.skills["/skills/total_level"].level).toBe(1250);
        expect(normalized.profile.equipment[0]).toMatchObject({
            itemHrid: "/items/artificer_cape",
            equipmentType: "/equipment_types/back",
            enhancementLevel: 12,
        });
    });

    it("recovers from malformed storage", () => {
        global.localStorage = createLocalStorageMock({ [SKILLING_STORAGE_KEY]: "{" });
        const loaded = loadSkillingPersistedState();
        expect(loaded.profile).toBeNull();
        expect(Object.keys(loaded.targetLevels)).toEqual(skillingData.skillHrids);
    });

    it("marks an existing result stale when a target changes", () => {
        const store = useSkillingStore();
        store.importProfile(createProfile());
        store.result = { generatedAt: 999, plansBySkill: {} };
        store.resultStale = false;

        store.setTargetLevel("/skills/brewing", 14);

        expect(store.resultStale).toBe(true);
    });
});

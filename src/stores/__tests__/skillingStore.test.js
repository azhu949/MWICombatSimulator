import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { skillingData } from "../../shared/gameDataIndex.js";
import skillingWorkerClient from "../../services/skillingWorkerClient.js";
import {
    SKILLING_BALANCED_COST_TOLERANCE,
    SKILLING_OPTIMIZATION_MODE_BALANCED,
    SKILLING_OPTIMIZATION_MODE_COST,
    SKILLING_OPTIMIZATION_MODE_SPEED,
} from "../../services/skillingPlanner.js";
import {
    SKILLING_RUN_SCOPE_ALL,
    SKILLING_RUN_SCOPE_SINGLE,
    SKILLING_STORAGE_KEY,
    loadSkillingPersistedState,
    normalizeSkillingPersistedState,
    normalizeSkillingStoredProfile,
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

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("persists only optimization preferences while profile and targets stay in memory", async () => {
        const store = useSkillingStore();
        store.importProfile(createProfile());
        store.result = { generatedAt: 999, plansBySkill: {} };
        store.setTargetLevel("/skills/cooking", 20);
        store.setOptimizationMode(SKILLING_OPTIMIZATION_MODE_BALANCED);
        store.setBalancedCostTolerance(0.25);
        await Promise.resolve();

        const serialized = JSON.parse(global.localStorage.values.get(SKILLING_STORAGE_KEY));
        expect(serialized).toEqual({
            version: 1,
            optimizationMode: SKILLING_OPTIMIZATION_MODE_BALANCED,
            balancedCostTolerance: 0.25,
        });
        expect(store.profile.characterName).toBe("Ledger");
        expect(store.targetLevels["/skills/cooking"]).toBe(20);
        expect(serialized.optimizationMode).toBe(SKILLING_OPTIMIZATION_MODE_BALANCED);
        expect(serialized.balancedCostTolerance).toBe(0.25);
        expect(serialized).not.toHaveProperty("profile");
        expect(serialized).not.toHaveProperty("targetLevels");
        expect(serialized).not.toHaveProperty("result");

        const reloaded = loadSkillingPersistedState(global.localStorage);
        expect(reloaded).not.toHaveProperty("profile");
        expect(reloaded).not.toHaveProperty("targetLevels");
        expect(reloaded.optimizationMode).toBe(SKILLING_OPTIMIZATION_MODE_BALANCED);
        expect(reloaded.balancedCostTolerance).toBe(0.25);
    });

    it("does not write storage when only session profile or targets change", async () => {
        const store = useSkillingStore();

        store.importProfile(createProfile());
        store.setTargetLevel("/skills/cooking", 20);
        store.setRunScope(SKILLING_RUN_SCOPE_SINGLE);
        store.setSelectedRunSkillHrid("/skills/cooking");
        await Promise.resolve();

        expect(global.localStorage.setItem.mock.calls.some(([key]) => key === SKILLING_STORAGE_KEY)).toBe(false);
        expect(store.profile.characterName).toBe("Ledger");
        expect(store.targetLevels["/skills/cooking"]).toBe(20);
        expect(store.runScope).toBe(SKILLING_RUN_SCOPE_SINGLE);
        expect(store.selectedRunSkillHrid).toBe("/skills/cooking");
    });

    it("defaults the run scope to all and keeps scope changes from invalidating results", () => {
        const store = useSkillingStore();
        store.importProfile(createProfile());
        store.result = { generatedAt: 999, plansBySkill: {} };
        store.resultStale = false;

        expect(store.runScope).toBe(SKILLING_RUN_SCOPE_ALL);
        expect(store.selectedRunSkillHrid).toBe(skillingData.skillHrids[0]);
        expect(store.setRunScope(SKILLING_RUN_SCOPE_SINGLE)).toBe(true);
        expect(store.setSelectedRunSkillHrid("/skills/cooking")).toBe(true);
        expect(store.setSelectedRunSkillHrid("/skills/not_real")).toBe(false);
        expect(store.setRunScope("not_real")).toBe(true);

        expect(store.runScope).toBe(SKILLING_RUN_SCOPE_ALL);
        expect(store.selectedRunSkillHrid).toBe("/skills/cooking");
        expect(store.resultStale).toBe(false);
        expect(store.result).toEqual({ generatedAt: 999, plansBySkill: {} });
    });

    it("defaults old or invalid persisted optimization modes to cost", () => {
        expect(normalizeSkillingPersistedState({}).optimizationMode).toBe(SKILLING_OPTIMIZATION_MODE_COST);
        expect(normalizeSkillingPersistedState({ optimizationMode: "unknown" }).optimizationMode)
            .toBe(SKILLING_OPTIMIZATION_MODE_COST);
        expect(normalizeSkillingPersistedState({ optimizationMode: SKILLING_OPTIMIZATION_MODE_BALANCED }).optimizationMode)
            .toBe(SKILLING_OPTIMIZATION_MODE_BALANCED);
        expect(normalizeSkillingPersistedState({ optimizationMode: SKILLING_OPTIMIZATION_MODE_SPEED }).optimizationMode)
            .toBe(SKILLING_OPTIMIZATION_MODE_SPEED);
    });

    it("defaults and clamps the persisted balanced cost tolerance", () => {
        expect(normalizeSkillingPersistedState({}).balancedCostTolerance)
            .toBe(SKILLING_BALANCED_COST_TOLERANCE);
        expect(normalizeSkillingPersistedState({ balancedCostTolerance: "invalid" }).balancedCostTolerance)
            .toBe(SKILLING_BALANCED_COST_TOLERANCE);
        expect(normalizeSkillingPersistedState({ balancedCostTolerance: -0.2 }).balancedCostTolerance).toBe(0);
        expect(normalizeSkillingPersistedState({ balancedCostTolerance: 2 }).balancedCostTolerance).toBe(1);
        expect(normalizeSkillingPersistedState({ balancedCostTolerance: "0.35" }).balancedCostTolerance).toBe(0.35);
    });

    it("normalizes imported profiles independently of persistence", () => {
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
        const normalized = normalizeSkillingStoredProfile(profile);
        expect(normalized.skills["/skills/total_level"].level).toBe(1250);
        expect(normalized.equipment[0]).toMatchObject({
            itemHrid: "/items/artificer_cape",
            equipmentType: "/equipment_types/back",
            enhancementLevel: 12,
        });
    });

    it("ignores legacy cached profiles and targets while retaining preferences", () => {
        global.localStorage.setItem(SKILLING_STORAGE_KEY, JSON.stringify({
            version: 1,
            profile: createProfile(80),
            targetLevels: Object.fromEntries(skillingData.skillHrids.map((skillHrid) => [skillHrid, 95])),
            optimizationMode: SKILLING_OPTIMIZATION_MODE_SPEED,
            balancedCostTolerance: 0.35,
        }));

        const loaded = loadSkillingPersistedState();
        expect(loaded).toEqual({
            version: 1,
            optimizationMode: SKILLING_OPTIMIZATION_MODE_SPEED,
            balancedCostTolerance: 0.35,
        });

        setActivePinia(createPinia());
        const store = useSkillingStore();
        expect(store.profile).toBeNull();
        expect(Object.values(store.targetLevels)).toEqual(Array(skillingData.skillHrids.length).fill(2));
        expect(store.optimizationMode).toBe(SKILLING_OPTIMIZATION_MODE_SPEED);
        expect(store.balancedCostTolerance).toBe(0.35);
        expect(global.localStorage.removeItem).not.toHaveBeenCalled();
    });

    it("requires a new import after store recreation while restoring preferences", async () => {
        const store = useSkillingStore();
        store.importProfile(createProfile());
        store.setTargetLevel("/skills/cooking", 20);
        store.setOptimizationMode(SKILLING_OPTIMIZATION_MODE_BALANCED);
        store.setBalancedCostTolerance(0.4);
        store.setRunScope(SKILLING_RUN_SCOPE_SINGLE);
        store.setSelectedRunSkillHrid("/skills/cooking");
        store.result = { generatedAt: 999, plansBySkill: {} };
        await Promise.resolve();

        setActivePinia(createPinia());
        const refreshedStore = useSkillingStore();
        expect(refreshedStore.profile).toBeNull();
        expect(refreshedStore.result).toBeNull();
        expect(Object.values(refreshedStore.targetLevels)).toEqual(Array(skillingData.skillHrids.length).fill(2));
        expect(refreshedStore.optimizationMode).toBe(SKILLING_OPTIMIZATION_MODE_BALANCED);
        expect(refreshedStore.balancedCostTolerance).toBe(0.4);
        expect(refreshedStore.runScope).toBe(SKILLING_RUN_SCOPE_ALL);
        expect(refreshedStore.selectedRunSkillHrid).toBe(skillingData.skillHrids[0]);
    });

    it("recovers from malformed storage", () => {
        global.localStorage = createLocalStorageMock({ [SKILLING_STORAGE_KEY]: "{" });
        const loaded = loadSkillingPersistedState();
        expect(loaded).toEqual({
            version: 1,
            optimizationMode: SKILLING_OPTIMIZATION_MODE_COST,
            balancedCostTolerance: SKILLING_BALANCED_COST_TOLERANCE,
        });

        setActivePinia(createPinia());
        const store = useSkillingStore();
        expect(store.profile).toBeNull();
        expect(Object.values(store.targetLevels)).toEqual(Array(skillingData.skillHrids.length).fill(2));
    });

    it("marks an existing result stale when a target changes", () => {
        const store = useSkillingStore();
        store.importProfile(createProfile());
        store.result = { generatedAt: 999, plansBySkill: {} };
        store.resultStale = false;

        store.setTargetLevel("/skills/brewing", 14);

        expect(store.resultStale).toBe(true);
    });

    it("cancels an active run and marks its result stale when the optimization mode changes", () => {
        const store = useSkillingStore();
        store.importProfile(createProfile());
        store.result = { generatedAt: 999, plansBySkill: {} };
        store.resultStale = false;
        store.running = true;

        expect(store.setOptimizationMode(SKILLING_OPTIMIZATION_MODE_BALANCED)).toBe(true);

        expect(store.optimizationMode).toBe(SKILLING_OPTIMIZATION_MODE_BALANCED);
        expect(store.running).toBe(false);
        expect(store.resultStale).toBe(true);
        expect(store.setOptimizationMode(SKILLING_OPTIMIZATION_MODE_BALANCED)).toBe(false);
    });

    it("normalizes balanced tolerance changes and marks an existing result stale", () => {
        const store = useSkillingStore();
        store.importProfile(createProfile());
        store.result = { generatedAt: 999, plansBySkill: {} };
        store.resultStale = false;

        expect(store.setBalancedCostTolerance(0.2)).toBe(true);

        expect(store.balancedCostTolerance).toBe(0.2);
        expect(store.resultStale).toBe(true);
        expect(store.setBalancedCostTolerance(0.2)).toBe(false);
        expect(store.setBalancedCostTolerance(4)).toBe(true);
        expect(store.balancedCostTolerance).toBe(1);
    });

    it("includes the selected optimization settings in worker run payloads", async () => {
        vi.stubGlobal("Worker", vi.fn());
        let receivedPayload = null;
        vi.spyOn(skillingWorkerClient, "start").mockImplementation((payload, handlers) => {
            receivedPayload = payload;
            handlers.onResult({
                generatedAt: payload.now,
                optimizationMode: payload.optimizationMode,
                balancedCostTolerance: payload.balancedCostTolerance,
                plansBySkill: {},
                overview: [{ skillHrid: "/skills/cooking" }],
            });
        });
        const store = useSkillingStore();
        store.importProfile(createProfile());
        store.setOptimizationMode(SKILLING_OPTIMIZATION_MODE_BALANCED);
        store.setBalancedCostTolerance(0.3);

        const result = await store.run();

        expect(receivedPayload).toMatchObject({
            skillHrids: skillingData.skillHrids,
            optimizationMode: SKILLING_OPTIMIZATION_MODE_BALANCED,
            balancedCostTolerance: 0.3,
            profile: {
                characterName: "Ledger",
                inventory: { "/items/coin": 5 },
                drinkSlotsByActionType: {
                    "/action_types/brewing": [{
                        slotIndex: 0,
                        itemHrid: "/items/brewing_tea",
                        isActive: null,
                    }],
                },
            },
            targetLevels: expect.objectContaining({ "/skills/cooking": 13 }),
        });
        expect(result).toMatchObject({
            optimizationMode: SKILLING_OPTIMIZATION_MODE_BALANCED,
            balancedCostTolerance: 0.3,
            overview: [{ skillHrid: "/skills/cooking" }],
        });
    });

    it("runs only the selected skill and replaces a previous all-skills result", async () => {
        vi.stubGlobal("Worker", vi.fn());
        let receivedPayload = null;
        let initialProgress = null;
        vi.spyOn(skillingWorkerClient, "start").mockImplementation((payload, handlers) => {
            receivedPayload = payload;
            initialProgress = { ...store.progress };
            handlers.onResult({
                generatedAt: payload.now,
                skillHrids: [...payload.skillHrids],
                plansBySkill: {
                    "/skills/cooking": { skillHrid: "/skills/cooking" },
                },
                overview: [{ skillHrid: "/skills/cooking" }],
            });
        });
        const store = useSkillingStore();
        store.importProfile(createProfile());
        store.result = {
            skillHrids: [...skillingData.skillHrids],
            plansBySkill: Object.fromEntries(skillingData.skillHrids.map((skillHrid) => [skillHrid, {}])),
            overview: skillingData.skillHrids.map((skillHrid) => ({ skillHrid })),
        };
        store.setRunScope(SKILLING_RUN_SCOPE_SINGLE);
        store.setSelectedRunSkillHrid("/skills/cooking");

        const result = await store.run();

        expect(receivedPayload.skillHrids).toEqual(["/skills/cooking"]);
        expect(initialProgress).toEqual({
            skillHrid: "/skills/cooking",
            skillIndex: 0,
            skillCount: 1,
            overallProgress: 0,
        });
        expect(store.selectedView).toBe("/skills/cooking");
        expect(result.skillHrids).toEqual(["/skills/cooking"]);
        expect(Object.keys(store.result.plansBySkill)).toEqual(["/skills/cooking"]);
        expect(store.result).toEqual(result);
    });

    it("uses the balanced tolerance in the main-thread fallback", async () => {
        vi.stubGlobal("Worker", undefined);
        const store = useSkillingStore();
        store.importProfile(createProfile());
        for (const skillHrid of skillingData.skillHrids) {
            store.setTargetLevel(skillHrid, 12);
        }
        store.setOptimizationMode(SKILLING_OPTIMIZATION_MODE_BALANCED);
        store.setBalancedCostTolerance(0.4);
        store.setRunScope(SKILLING_RUN_SCOPE_SINGLE);
        store.setSelectedRunSkillHrid("/skills/cooking");

        const result = await store.run();

        expect(result).toMatchObject({
            optimizationMode: SKILLING_OPTIMIZATION_MODE_BALANCED,
            balancedCostTolerance: 0.4,
            skillHrids: ["/skills/cooking"],
        });
        expect(Object.keys(result.plansBySkill)).toEqual(["/skills/cooking"]);
        expect(Object.values(result.plansBySkill).every((plan) => plan.balancedCostTolerance === 0.4)).toBe(true);
    });
});

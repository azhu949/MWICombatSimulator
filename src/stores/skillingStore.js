import { computed, reactive, ref, watch } from "vue";
import { defineStore } from "pinia";
import { skillingData } from "../shared/gameDataIndex.js";
import {
    SKILLING_MAX_LEVEL,
    createDefaultSkillingTargets,
    planSkillingUpgrades,
} from "../services/skillingPlanner.js";
import skillingWorkerClient from "../services/skillingWorkerClient.js";
import { useSimulatorStore } from "./simulatorStore.js";

export const SKILLING_STORAGE_VERSION = 1;
export const SKILLING_STORAGE_KEY = "mwi.skilling.v1";

function finiteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback = 0) {
    return Math.trunc(finiteNumber(value, fallback));
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function isPlainObject(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

function safeStorage(storage = globalThis?.localStorage) {
    return storage && typeof storage.getItem === "function" ? storage : null;
}

function cloneJsonValue(value, fallback) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        return fallback;
    }
}

function normalizeStoredDrinkSlots(rawMap) {
    const result = {};
    for (const [rawActionType, rawSlots] of Object.entries(isPlainObject(rawMap) ? rawMap : {})) {
        const actionTypeHrid = String(rawActionType || "").trim();
        if (!actionTypeHrid || !Array.isArray(rawSlots)) continue;
        const slots = rawSlots.map((slot, index) => {
            const itemHrid = String(slot?.itemHrid || "").trim();
            if (!itemHrid) return null;
            return {
                slotIndex: Math.max(0, integer(slot?.slotIndex, index)),
                itemHrid,
                isActive: slot?.isActive === true
                    ? true
                    : slot?.isActive === false
                        ? false
                        : null,
            };
        }).filter(Boolean);
        if (slots.length > 0) result[actionTypeHrid] = slots;
    }
    return result;
}

export function normalizeSkillingStoredProfile(rawProfile) {
    if (!isPlainObject(rawProfile)) {
        return null;
    }
    const skills = {};
    for (const [skillHrid, rawSkill] of Object.entries(isPlainObject(rawProfile.skills) ? rawProfile.skills : {})) {
        const hrid = String(skillHrid || "").trim();
        if (!hrid || !isPlainObject(rawSkill)) continue;
        const maximumLevel = hrid === "/skills/total_level"
            ? Number.MAX_SAFE_INTEGER
            : SKILLING_MAX_LEVEL;
        skills[hrid] = {
            level: clamp(integer(rawSkill.level, 1), 1, maximumLevel),
            experience: Number.isFinite(Number(rawSkill.experience))
                ? Math.max(0, Number(rawSkill.experience))
                : null,
        };
    }
    if (!(skillingData?.skillHrids || []).some((skillHrid) => skills[skillHrid])) {
        return null;
    }

    const inventory = {};
    for (const [itemHrid, rawCount] of Object.entries(isPlainObject(rawProfile.inventory) ? rawProfile.inventory : {})) {
        const hrid = String(itemHrid || "").trim();
        const count = Math.max(0, finiteNumber(rawCount, 0));
        if (hrid && count > 0) inventory[hrid] = count;
    }
    const equipment = (Array.isArray(rawProfile.equipment) ? rawProfile.equipment : [])
        .map((item, index) => ({
            id: String(item?.id || `item-${index}`),
            itemHrid: String(item?.itemHrid || "").trim(),
            equipmentType: String(item?.equipmentType || "").trim(),
            itemLocationHrid: String(item?.itemLocationHrid || "/item_locations/inventory"),
            enhancementLevel: clamp(integer(item?.enhancementLevel, 0), 0, 20),
            count: Math.max(0, finiteNumber(item?.count, 1)),
            isEquipped: item?.isEquipped === true,
        }))
        .filter((item) => item.itemHrid && item.count > 0);

    return {
        version: SKILLING_STORAGE_VERSION,
        characterName: String(rawProfile.characterName || "").trim(),
        importedAt: Math.max(0, finiteNumber(rawProfile.importedAt, 0)),
        skills,
        inventory,
        equipment,
        buffsBySource: cloneJsonValue(
            isPlainObject(rawProfile.buffsBySource) ? rawProfile.buffsBySource : {},
            {},
        ),
        drinkSlotsByActionType: normalizeStoredDrinkSlots(rawProfile.drinkSlotsByActionType),
    };
}

export function normalizeSkillingPersistedState(rawState = {}) {
    const source = isPlainObject(rawState) ? rawState : {};
    const profile = normalizeSkillingStoredProfile(source.profile);
    const defaults = createDefaultSkillingTargets(profile, skillingData);
    const rawTargets = isPlainObject(source.targetLevels) ? source.targetLevels : {};
    const targetLevels = Object.fromEntries((skillingData?.skillHrids || []).map((skillHrid) => {
        const currentLevel = clamp(integer(profile?.skills?.[skillHrid]?.level, 1), 1, SKILLING_MAX_LEVEL);
        const requested = Object.prototype.hasOwnProperty.call(rawTargets, skillHrid)
            ? rawTargets[skillHrid]
            : defaults[skillHrid];
        return [skillHrid, clamp(integer(requested, currentLevel + 1), currentLevel, SKILLING_MAX_LEVEL)];
    }));
    return { version: SKILLING_STORAGE_VERSION, profile, targetLevels };
}

export function loadSkillingPersistedState(storage = globalThis?.localStorage) {
    const target = safeStorage(storage);
    if (!target) return normalizeSkillingPersistedState();
    try {
        const raw = target.getItem(SKILLING_STORAGE_KEY);
        return raw ? normalizeSkillingPersistedState(JSON.parse(raw)) : normalizeSkillingPersistedState();
    } catch (error) {
        return normalizeSkillingPersistedState();
    }
}

export function persistSkillingState(state, storage = globalThis?.localStorage) {
    const target = safeStorage(storage);
    if (!target || typeof target.setItem !== "function") return false;
    try {
        target.setItem(SKILLING_STORAGE_KEY, JSON.stringify(normalizeSkillingPersistedState(state)));
        return true;
    } catch (error) {
        return false;
    }
}

function replaceReactiveObject(target, source) {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, source);
}

export const useSkillingStore = defineStore("skilling", () => {
    const simulator = useSimulatorStore();
    const persisted = loadSkillingPersistedState();
    const profile = ref(persisted.profile);
    const targetLevels = reactive(persisted.targetLevels);
    const selectedView = ref("overview");
    const result = ref(null);
    const resultStale = ref(false);
    const running = ref(false);
    const progress = ref(null);
    const error = ref("");
    const initialized = ref(false);
    const activeRunId = ref("");
    let runSequence = 0;
    let settleActiveRun = null;

    const skillHrids = computed(() => [...(skillingData?.skillHrids || [])]);
    const plansBySkill = computed(() => result.value?.plansBySkill || {});
    const overview = computed(() => result.value?.overview || []);
    const selectedPlan = computed(() => plansBySkill.value[selectedView.value] || null);
    const priceStatus = computed(() => ({
        loading: Boolean(simulator.pricing?.isLoading),
        ready: Boolean(simulator.pricing?.lastFetchedAt || simulator.pricing?.sourceUrl),
        updatedAt: Math.max(0, finiteNumber(simulator.pricing?.lastFetchedAt, 0)),
        sourceUrl: String(simulator.pricing?.sourceUrl || ""),
        error: String(simulator.pricing?.error || ""),
    }));
    const snapshotAgeMs = computed(() => profile.value?.importedAt
        ? Math.max(0, Date.now() - finiteNumber(profile.value.importedAt, Date.now()))
        : null);
    const expiredBuffCount = computed(() => Math.max(0, ...Object.values(plansBySkill.value)
        .map((plan) => integer(plan?.expiredBuffCount, 0))));

    function cancel({ markStale = false } = {}) {
        if (!running.value) return false;
        skillingWorkerClient.cancel();
        running.value = false;
        activeRunId.value = "";
        progress.value = null;
        if (markStale && result.value) resultStale.value = true;
        settleActiveRun?.(null);
        settleActiveRun = null;
        return true;
    }

    function invalidateResult() {
        if (running.value) cancel({ markStale: true });
        if (result.value) resultStale.value = true;
    }

    watch([profile, targetLevels], () => {
        persistSkillingState({ profile: profile.value, targetLevels });
    }, { deep: true });

    watch(targetLevels, () => {
        invalidateResult();
    }, { deep: true, flush: "sync" });

    watch([
        () => simulator.pricing?.lastFetchedAt,
        () => simulator.pricing?.sourceUrl,
        () => simulator.pricing?.overrides,
    ], () => {
        invalidateResult();
    }, { deep: true, flush: "sync" });

    async function initialize() {
        initialized.value = true;
        await simulator.ensureMarketPricesLoaded(false);
        return true;
    }

    async function refreshPrices() {
        await simulator.ensureMarketPricesLoaded(true);
        return priceStatus.value;
    }

    function importProfile(nextProfile) {
        const normalized = normalizeSkillingStoredProfile(nextProfile);
        if (!normalized) throw new Error("The imported skilling profile is invalid.");
        cancel();
        profile.value = normalized;
        replaceReactiveObject(targetLevels, createDefaultSkillingTargets(normalized, skillingData));
        result.value = null;
        resultStale.value = false;
        progress.value = null;
        error.value = "";
        return normalized;
    }

    function clearProfile() {
        cancel();
        profile.value = null;
        replaceReactiveObject(targetLevels, createDefaultSkillingTargets(null, skillingData));
        result.value = null;
        resultStale.value = false;
        error.value = "";
    }

    function setTargetLevel(skillHrid, value) {
        if (!skillHrids.value.includes(skillHrid)) return false;
        const currentLevel = clamp(integer(profile.value?.skills?.[skillHrid]?.level, 1), 1, SKILLING_MAX_LEVEL);
        targetLevels[skillHrid] = clamp(integer(value, currentLevel + 1), currentLevel, SKILLING_MAX_LEVEL);
        return true;
    }

    function setPriceOverride(itemHrid, patch) {
        return simulator.setPriceOverride(itemHrid, patch);
    }

    function resetPriceOverride(itemHrid) {
        return simulator.resetPriceOverride(itemHrid);
    }

    function finishRun(runId, nextResult, nextError = "") {
        if (runId !== activeRunId.value) return false;
        running.value = false;
        activeRunId.value = "";
        progress.value = null;
        error.value = nextError;
        if (nextResult) {
            result.value = nextResult;
            resultStale.value = false;
        }
        settleActiveRun?.(nextResult || null);
        settleActiveRun = null;
        return true;
    }

    async function run() {
        if (!profile.value) {
            error.value = "Import a current character before calculating.";
            return null;
        }
        cancel();
        const runId = `skilling-${Date.now()}-${++runSequence}`;
        const payload = {
            runId,
            profile: cloneJsonValue(profile.value, profile.value),
            targetLevels: { ...targetLevels },
            priceTable: cloneJsonValue(simulator.pricing?.priceTable || {}, {}),
            enhancementQuotesByItem: cloneJsonValue(simulator.pricing?.enhancementQuotesByItem || {}, {}),
            now: Date.now(),
        };
        activeRunId.value = runId;
        running.value = true;
        progress.value = { overallProgress: 0 };
        error.value = "";

        if (typeof Worker !== "function") {
            try {
                const planned = planSkillingUpgrades({
                    ...payload,
                    onProgress: (nextProgress) => {
                        if (activeRunId.value === runId) progress.value = nextProgress;
                    },
                });
                finishRun(runId, planned);
                return planned;
            } catch (planningError) {
                finishRun(runId, null, planningError instanceof Error ? planningError.message : String(planningError));
                return null;
            }
        }

        return new Promise((resolve) => {
            settleActiveRun = resolve;
            try {
                skillingWorkerClient.start(payload, {
                    onProgress: (nextProgress) => {
                        if (activeRunId.value === runId) progress.value = nextProgress;
                    },
                    onResult: (nextResult) => finishRun(runId, nextResult),
                    onCancelled: () => finishRun(runId, null),
                    onError: (message) => finishRun(runId, null, String(message || "Skilling calculation failed.")),
                });
            } catch (workerError) {
                finishRun(runId, null, workerError instanceof Error ? workerError.message : String(workerError));
            }
        });
    }

    return {
        profile,
        targetLevels,
        selectedView,
        result,
        resultStale,
        running,
        progress,
        error,
        initialized,
        skillHrids,
        plansBySkill,
        overview,
        selectedPlan,
        priceStatus,
        snapshotAgeMs,
        expiredBuffCount,
        initialize,
        refreshPrices,
        importProfile,
        clearProfile,
        setTargetLevel,
        setPriceOverride,
        resetPriceOverride,
        run,
        cancel,
        invalidateResult,
    };
});

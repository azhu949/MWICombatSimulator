import { computed, reactive, ref, watch } from "vue";
import { defineStore } from "pinia";
import {
    enhancementData,
    itemDetailIndex,
} from "../shared/gameDataIndex.js";
import {
    DEFAULT_MONTE_CARLO_SAMPLES,
    MONTE_CARLO_LOAD_THRESHOLD,
    analyzeEnhancementRisk,
    analyzeEnhancementStrategies,
    calculateDecompositionValue,
    planPhilosophersMirror,
    resolveEnhancementPrice,
    resolveStartingItemPrice,
} from "../services/enhancementSimulator.js";
import enhancementWorkerClient from "../services/enhancementWorkerClient.js";
import { useSimulatorStore } from "./simulatorStore.js";

export const ENHANCEMENT_STORAGE_VERSION = 2;
export const ENHANCEMENT_STORAGE_KEY = `mwi.enhancement.v${ENHANCEMENT_STORAGE_VERSION}`;
export const LEGACY_ENHANCEMENT_STORAGE_KEYS = Object.freeze([
    "mwi.enhancement.v1",
    "mwi.enhancement",
]);
const ENHANCEMENT_SESSION_CONFIG_KEYS = new Set([
    "skillLevel",
    "observatoryLevel",
    "otherRoomLevels",
    "communityEnhancingLevel",
    "communityExperienceLevel",
    "noviceAchievement",
    "championAchievement",
    "teaHrid",
    "blessedTea",
    "wisdomTea",
    "equipmentSlots",
]);

const DEFAULT_SUPPORT_SLOT_KEYS = Object.freeze([
    "enhancing_tool",
    "hands",
    "body",
    "legs",
    "pouch",
    "neck",
    "back",
    "charm",
]);

export function deriveEnhancementSupportSlotKeys(supportEquipment = enhancementData?.supportEquipment) {
    const discovered = (Array.isArray(supportEquipment) ? supportEquipment : [])
        .map((item) => String(item?.equipmentType || "").split("/").filter(Boolean).pop() || "")
        .filter(Boolean);
    return Array.from(new Set([...DEFAULT_SUPPORT_SLOT_KEYS, ...discovered]));
}

const SUPPORT_SLOT_KEYS = Object.freeze(deriveEnhancementSupportSlotKeys());

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function finiteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback = 0) {
    return Math.trunc(finiteNumber(value, fallback));
}

function nonNegativeNumber(value, fallback = 0) {
    return Math.max(0, finiteNumber(value, fallback));
}

function normalizeHrid(value) {
    return String(value || "").trim();
}

function isPlainObject(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizePriceOverrideNumber(value) {
    if (typeof value !== "number" && typeof value !== "string") {
        return null;
    }
    if (typeof value === "string" && value.trim() === "") {
        return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function safeStorage(storage = globalThis?.localStorage) {
    return storage && typeof storage.getItem === "function" ? storage : null;
}

function createEquipmentSlots() {
    return Object.fromEntries(SUPPORT_SLOT_KEYS.map((slot) => [slot, {
        itemHrid: "",
        enhancementLevel: 0,
    }]));
}

export function createDefaultEnhancementConfig() {
    return {
        itemHrid: "",
        startLevel: 0,
        targetLevel: 10,
        skillLevel: 100,
        observatoryLevel: 0,
        otherRoomLevels: 0,
        communityEnhancingLevel: 0,
        communityExperienceLevel: 0,
        noviceAchievement: false,
        championAchievement: false,
        teaHrid: "",
        blessedTea: false,
        wisdomTea: false,
        equipmentSlots: createEquipmentSlots(),
        protectionMode: "auto",
        protectionItemHrid: "",
        laborRatePerHour: 0,
        markupRate: 0,
        budget: 0,
        sampleCount: DEFAULT_MONTE_CARLO_SAMPLES,
        seed: "enhancement",
        startingItemPriceOverride: null,
        priceOverrides: {},
        riskStrategy: "recommended",
    };
}

function normalizePriceOverrides(rawOverrides) {
    const result = {};
    for (const [rawKey, rawValue] of Object.entries(isPlainObject(rawOverrides) ? rawOverrides : {})) {
        const key = String(rawKey || "").trim();
        if (!key) {
            continue;
        }
        const scalarValue = normalizePriceOverrideNumber(rawValue);
        if (scalarValue != null) {
            result[key] = scalarValue;
            continue;
        }
        if (!isPlainObject(rawValue)) {
            continue;
        }
        const quote = {};
        for (const [sourceSide, normalizedSide] of [["ask", "ask"], ["bid", "bid"], ["a", "ask"], ["b", "bid"]]) {
            const sideValue = normalizePriceOverrideNumber(rawValue[sourceSide]);
            if (sideValue != null) {
                quote[normalizedSide] = sideValue;
            }
        }
        if (Object.keys(quote).length > 0) {
            result[key] = quote;
        }
    }
    return result;
}

export function normalizeEnhancementPersistedState(rawState = {}) {
    const source = isPlainObject(rawState) ? rawState : {};
    const rawConfig = isPlainObject(source.config) ? source.config : source;
    const defaults = createDefaultEnhancementConfig();
    // Current-character skill, equipment, drinks, housing, community, and achievement data are session-only.
    // Legacy payloads may still contain them, but loading and future writes intentionally keep the defaults.
    const targetLevel = clamp(integer(rawConfig.targetLevel, defaults.targetLevel), 1, 20);
    const itemHrid = normalizeHrid(rawConfig.itemHrid || rawConfig.selectedItemHrid);
    const knownItems = new Set((enhancementData?.enhanceableItems || []).map((item) => item.hrid));
    const selectedItem = (enhancementData?.enhanceableItems || []).find((item) => item.hrid === itemHrid);
    const requestedProtectionItemHrid = normalizeHrid(rawConfig.protectionItemHrid);
    const validProtectionItemHrids = new Set([
        enhancementData?.specialItemHrids?.mirrorOfProtection || "/items/mirror_of_protection",
        itemHrid,
        ...(selectedItem?.protectionItemHrids || []),
    ].filter(Boolean));
    const startingOverride = rawConfig.startingItemPriceOverride;
    const normalizedStartingOverride = normalizePriceOverrideNumber(startingOverride);

    const config = {
        ...defaults,
        itemHrid: !itemHrid || knownItems.has(itemHrid) ? itemHrid : "",
        startLevel: clamp(integer(rawConfig.startLevel, defaults.startLevel), 0, targetLevel - 1),
        targetLevel,
        protectionMode: rawConfig.protectionMode === "manual" ? "manual" : "auto",
        protectionItemHrid: validProtectionItemHrids.has(requestedProtectionItemHrid)
            ? requestedProtectionItemHrid
            : "",
        laborRatePerHour: nonNegativeNumber(
            rawConfig.laborRatePerHour ?? rawConfig.hourlyRate,
            defaults.laborRatePerHour
        ),
        markupRate: clamp(rawConfig.markupRate == null
            ? nonNegativeNumber(
                rawConfig.markupPercent ?? rawConfig.percentRate ?? rawConfig.percent_rate,
                0
            ) / 100
            : nonNegativeNumber(rawConfig.markupRate, defaults.markupRate), 0, 10),
        budget: nonNegativeNumber(rawConfig.budget, defaults.budget),
        sampleCount: clamp(integer(rawConfig.sampleCount, defaults.sampleCount), 1024, 1_000_000),
        seed: rawConfig.seed == null ? defaults.seed : String(rawConfig.seed),
        startingItemPriceOverride: normalizedStartingOverride,
        priceOverrides: normalizePriceOverrides(rawConfig.priceOverrides),
        riskStrategy: String(rawConfig.riskStrategy || defaults.riskStrategy),
    };
    const rawFavorites = Array.isArray(source.favorites)
        ? source.favorites
        : Array.isArray(source.favoriteItemHrids)
            ? source.favoriteItemHrids
            : [];
    const favorites = Array.from(new Set(rawFavorites.map(normalizeHrid).filter((hrid) => knownItems.has(hrid))));

    return {
        version: ENHANCEMENT_STORAGE_VERSION,
        config,
        favorites,
    };
}

export function loadEnhancementPersistedState(storage = globalThis?.localStorage) {
    const target = safeStorage(storage);
    if (!target) {
        return normalizeEnhancementPersistedState({});
    }
    const keys = [ENHANCEMENT_STORAGE_KEY, ...LEGACY_ENHANCEMENT_STORAGE_KEYS];
    for (const key of keys) {
        try {
            const raw = target.getItem(key);
            if (!raw) {
                continue;
            }
            return normalizeEnhancementPersistedState(JSON.parse(raw));
        } catch (error) {
            // Try older keys before falling back to defaults.
        }
    }
    return normalizeEnhancementPersistedState({});
}

export function persistEnhancementState(state, storage = globalThis?.localStorage) {
    const target = safeStorage(storage);
    if (!target || typeof target.setItem !== "function") {
        return false;
    }
    const normalized = normalizeEnhancementPersistedState(state);
    const persistedConfig = Object.fromEntries(Object.entries(normalized.config)
        .filter(([key]) => !ENHANCEMENT_SESSION_CONFIG_KEYS.has(key)));
    try {
        target.setItem(ENHANCEMENT_STORAGE_KEY, JSON.stringify({
            ...normalized,
            config: persistedConfig,
        }));
        return true;
    } catch (error) {
        return false;
    }
}

function replaceReactiveObject(target, source) {
    for (const key of Object.keys(target)) {
        delete target[key];
    }
    Object.assign(target, source);
}

function pricingForSimulator(simulator) {
    return simulator?.pricing || {};
}

function effectiveAnalysisConfig(config) {
    return {
        ...config,
        protectionItemHrid: config.protectionMode === "manual"
            ? normalizeHrid(config.protectionItemHrid)
            : "",
    };
}

function strategyId(strategy) {
    return strategy?.protectAt == null ? "none" : `protect-${strategy.protectAt}`;
}

function sortableStrategyCost(strategy) {
    const total = strategy?.totalInvestment;
    if (total != null && Number.isFinite(Number(total))) {
        return Number(total);
    }
    const incremental = strategy?.incrementalCost;
    return incremental != null && Number.isFinite(Number(incremental))
        ? Number(incremental)
        : Infinity;
}

function adaptStrategy(strategy, recommendedProtectAt) {
    const materialCost = strategy.materialPricesAvailable === false
        ? null
        : strategy.expectedActions * strategy.materialCostPerAction;
    const coinCost = strategy.expectedActions * strategy.coinPerAction;
    const usesProtection = strategy.protectAt != null;
    return {
        ...strategy,
        id: strategyId(strategy),
        strategyId: strategyId(strategy),
        noProtection: strategy.protectAt == null,
        protectionThreshold: strategy.protectAt,
        expectedProtectionCount: strategy.expectedProtections,
        protectionCount: strategy.expectedProtections,
        expectedResetCount: strategy.expectedResets,
        expectedXp: strategy.expectedExperience,
        xpPerHour: strategy.experiencePerHour,
        materialCost,
        materialsCost: materialCost,
        coinCost,
        goldCost: coinCost,
        recommended: strategy.protectAt === recommendedProtectAt,
        isRecommended: strategy.protectAt === recommendedProtectAt,
        protectionItem: usesProtection ? strategy.protectionItem : null,
        protectionItemHrid: usesProtection ? strategy.protectionItem?.itemHrid || "" : "",
    };
}

export const useEnhancementStore = defineStore("enhancement", () => {
    const simulator = useSimulatorStore();
    const persisted = loadEnhancementPersistedState();
    const config = reactive(persisted.config);
    const favorites = ref(persisted.favorites);
    const itemSearch = ref("");
    const itemFilters = reactive({ equipmentType: "all", favoritesOnly: false });
    const initialized = ref(false);
    const risk = ref(null);
    const riskRunning = ref(false);
    const riskProgress = ref(null);
    const riskError = ref("");
    const activeRunId = ref("");
    let runSequence = 0;
    let settleActiveRisk = null;

    const pricing = computed(() => pricingForSimulator(simulator));
    const itemOptions = computed(() => (enhancementData?.enhanceableItems || [])
        .slice()
        .sort((left, right) => finiteNumber(left?.sortIndex, Infinity) - finiteNumber(right?.sortIndex, Infinity)
            || String(left?.name || left?.hrid).localeCompare(String(right?.name || right?.hrid))));
    const selectedItem = computed(() => itemOptions.value.find((item) => item.hrid === config.itemHrid) || null);
    const filteredItemOptions = computed(() => {
        const query = itemSearch.value.trim().toLowerCase();
        const favoriteSet = new Set(favorites.value);
        return itemOptions.value.filter((item) => {
            if (itemFilters.equipmentType !== "all" && item.equipmentType !== itemFilters.equipmentType) {
                return false;
            }
            if (itemFilters.favoritesOnly && !favoriteSet.has(item.hrid)) {
                return false;
            }
            return !query
                || String(item.name || "").toLowerCase().includes(query)
                || String(item.hrid || "").toLowerCase().includes(query);
        });
    });
    const teaOptions = computed(() => (enhancementData?.enhancingDrinks || []).filter((drink) => (
        drink.hrid === "/items/enhancing_tea"
        || drink.hrid === "/items/super_enhancing_tea"
        || drink.hrid === "/items/ultra_enhancing_tea"
    )));
    const supportSlotOptions = computed(() => (enhancementData?.supportEquipment || []).map((item) => ({
        ...item,
        slot: String(item.equipmentType || "").split("/").filter(Boolean).pop() || "",
    })));
    const equipmentOptionsBySlot = computed(() => Object.fromEntries(SUPPORT_SLOT_KEYS.map((slot) => [
        slot,
        supportSlotOptions.value.filter((item) => item.slot === slot),
    ])));
    const equipmentSlotKeys = computed(() => [...SUPPORT_SLOT_KEYS]);

    const rawAnalysis = computed(() => {
        if (!config.itemHrid) {
            return null;
        }
        return analyzeEnhancementStrategies(
            effectiveAnalysisConfig(config),
            enhancementData,
            pricing.value
        );
    });
    const strategyRows = computed(() => {
        const source = rawAnalysis.value;
        if (!source) {
            return [];
        }
        const recommendedProtectAt = source.recommendedStrategy?.protectAt ?? null;
        return source.strategies
            .map((strategy) => adaptStrategy(strategy, recommendedProtectAt))
            .sort((left, right) => sortableStrategyCost(left) - sortableStrategyCost(right)
                || (left.protectAt ?? -1) - (right.protectAt ?? -1));
    });
    const recommendedStrategy = computed(() => strategyRows.value.find((strategy) => strategy.recommended)
        || strategyRows.value[0]
        || null);
    const analysis = computed(() => rawAnalysis.value ? {
        ...rawAnalysis.value,
        strategies: strategyRows.value,
        recommendedStrategy: recommendedStrategy.value,
        recommended: recommendedStrategy.value,
    } : null);

    const protectionOptions = computed(() => (rawAnalysis.value?.protectionCandidates || []).map((candidate) => ({
        ...(itemDetailIndex?.[candidate.itemHrid] || {}),
        ...candidate,
        hrid: candidate.itemHrid,
        unitPrice: candidate.price,
        priceSource: candidate.source,
    })));
    const startingItemPrice = computed(() => {
        const resolved = recommendedStrategy.value?.startingItem
            || (config.itemHrid ? resolveStartingItemPrice(
                effectiveAnalysisConfig(config),
                enhancementData,
                pricing.value,
            ) : null);
        return {
            ...(resolved || {}),
            value: resolved?.available ? resolved.price : Number.NaN,
            price: resolved?.available ? resolved.price : null,
            source: resolved?.source || "missing",
            missing: !resolved?.available,
            level: Number(config.startLevel || 0),
        };
    });
    const materialRows = computed(() => {
        const item = selectedItem.value;
        if (!item) {
            return [];
        }
        const expectedCounts = recommendedStrategy.value?.expectedMaterialCounts || {};
        const rows = new Map();
        const addRow = (hrid, {
            count = 0,
            quantity = 0,
            mode = "ask",
            kind = "material",
            resolvedPrice = null,
        } = {}) => {
            if (!hrid) {
                return;
            }
            const rowKey = `${kind}:${mode}:${hrid}`;
            if (rows.has(rowKey)) {
                const existing = rows.get(rowKey);
                existing.count += count;
                existing.quantity += quantity;
                existing.expectedQuantity += quantity;
                return;
            }
            const resolved = resolvedPrice || resolveEnhancementPrice(pricing.value, hrid, {
                mode,
                overrides: config.priceOverrides,
            });
            const rawOverride = config.priceOverrides?.[hrid];
            const overrideValue = isPlainObject(rawOverride)
                ? rawOverride[mode] ?? rawOverride[mode === "ask" ? "a" : "b"]
                : rawOverride;
            const normalizedOverrideValue = normalizePriceOverrideNumber(overrideValue);
            rows.set(rowKey, {
                ...(itemDetailIndex?.[hrid] || {}),
                ...resolved,
                key: rowKey,
                hrid,
                kind,
                priceMode: mode,
                count,
                quantity,
                expectedQuantity: quantity,
                unitPrice: resolved.available ? resolved.price : 0,
                price: resolved.available ? resolved.price : null,
                source: resolved.source,
                priceSource: resolved.source,
                missing: !resolved.available,
                overrideValue: normalizedOverrideValue,
            });
        };
        const coinHrid = enhancementData?.specialItemHrids?.coin || "/items/coin";
        for (const material of item.enhancementCosts || []) {
            if (material.itemHrid === coinHrid) {
                continue;
            }
            addRow(material.itemHrid, {
                count: material.count,
                quantity: expectedCounts[material.itemHrid] ?? material.count,
            });
        }
        for (const consumable of recommendedStrategy.value?.consumableDetails || []) {
            addRow(consumable.itemHrid, {
                count: consumable.count,
                quantity: expectedCounts[consumable.itemHrid] ?? 0,
                kind: "consumable",
            });
        }
        for (const protection of protectionOptions.value) {
            addRow(protection.hrid, {
                quantity: recommendedStrategy.value?.protectionItemHrid === protection.hrid
                    ? recommendedStrategy.value.expectedProtections
                    : 0,
                kind: "protection",
                resolvedPrice: protection,
            });
        }
        addRow(enhancementData?.specialItemHrids?.philosophersMirror || "/items/philosophers_mirror", {
            kind: "philosophers_mirror",
        });
        addRow(enhancementData?.specialItemHrids?.enhancingEssence || "/items/enhancing_essence", {
            mode: "bid",
            kind: "decomposition",
        });
        return Array.from(rows.values());
    });

    const mirrorPlan = computed(() => {
        if (!config.itemHrid) {
            return null;
        }
        const targetLevel = clamp(integer(config.targetLevel, 1), 1, 20);
        const mirrorHrid = enhancementData?.specialItemHrids?.philosophersMirror
            || "/items/philosophers_mirror";
        const mirrorQuote = resolveEnhancementPrice(pricing.value, mirrorHrid, {
            mode: "ask",
            overrides: config.priceOverrides,
        });
        const markupMultiplier = 1 + nonNegativeNumber(config.markupRate, 0);
        const mirrorPrice = (mirrorQuote.available ? mirrorQuote.price : Infinity) * markupMultiplier;

        const buildDirectPlans = (itemHrid, maximumLevel, useConfiguredProtection) => {
            const effectiveConfig = effectiveAnalysisConfig(config);
            const analysisConfig = {
                ...effectiveConfig,
                itemHrid,
                startLevel: 0,
                startingItemPriceOverride: itemHrid === config.itemHrid && integer(config.startLevel, 0) === 0
                    ? effectiveConfig.startingItemPriceOverride
                    : null,
                protectionItemHrid: useConfiguredProtection
                    ? effectiveConfig.protectionItemHrid
                    : "",
            };
            const directPlans = [];
            const baseQuote = resolveStartingItemPrice(analysisConfig, enhancementData, pricing.value);
            directPlans[0] = {
                cost: baseQuote.available ? baseQuote.price * markupMultiplier : Infinity,
                startingItem: baseQuote,
                targetLevel: 0,
            };
            for (let level = 1; level <= maximumLevel; level += 1) {
                const directAnalysis = analyzeEnhancementStrategies({
                    ...analysisConfig,
                    targetLevel: level,
                }, enhancementData, pricing.value);
                directPlans[level] = directAnalysis.recommendedStrategy || { cost: Infinity };
            }
            const actionStrategy = directPlans.find((entry) => Number.isFinite(Number(entry?.laborPerAction)));
            return {
                directPlans,
                mirrorActionCost: (
                    nonNegativeNumber(actionStrategy?.laborPerAction, 0)
                    + nonNegativeNumber(actionStrategy?.consumableCostPerAction, 0)
                ) * markupMultiplier,
            };
        };

        const targetPlans = buildDirectPlans(config.itemHrid, targetLevel, true);
        const declaredBaseItemHrid = normalizeHrid(selectedItem.value?.baseItemHrids?.[0]);
        const baseItemHrid = declaredBaseItemHrid || config.itemHrid;
        let basePlan = null;
        if (baseItemHrid !== config.itemHrid && targetLevel >= 2) {
            const basePlans = buildDirectPlans(baseItemHrid, targetLevel - 2, false);
            basePlan = planPhilosophersMirror({
                targetLevel: targetLevel - 2,
                itemHrid: baseItemHrid,
                baseItemHrid,
                mirrorItemHrid: mirrorHrid,
                mirrorPrice,
                mirrorActionCost: basePlans.mirrorActionCost,
                directPlans: basePlans.directPlans,
            });
        }
        const plan = planPhilosophersMirror({
            targetLevel,
            itemHrid: config.itemHrid,
            baseItemHrid,
            basePlan,
            mirrorItemHrid: mirrorHrid,
            mirrorPrice,
            mirrorActionCost: targetPlans.mirrorActionCost,
            directPlans: targetPlans.directPlans,
        });
        const directCost = Number(
            targetPlans.directPlans[targetLevel]?.totalInvestment
            ?? targetPlans.directPlans[targetLevel]?.cost
        );
        const materials = plan.requirements.map((requirement) => requirement.type === "mirror"
            ? {
                ...requirement,
                hrid: mirrorHrid,
                quantity: requirement.count,
                cost: requirement.totalCost,
            }
            : {
                ...requirement,
                itemHrid: requirement.itemHrid || config.itemHrid,
                quantity: requirement.count,
                cost: requirement.totalCost,
            });
        return {
            ...plan,
            totalCost: plan.cost,
            planCost: plan.cost,
            directCost,
            savings: Number.isFinite(directCost) ? Math.max(0, directCost - plan.cost) : 0,
            usesMirror: plan.method === "mirror",
            materials,
            materialRows: materials,
        };
    });
    const decompositionValue = computed(() => config.itemHrid ? calculateDecompositionValue({
        itemHrid: config.itemHrid,
        targetLevel: config.targetLevel,
        priceOverrides: config.priceOverrides,
    }, enhancementData, pricing.value) : null);
    const decomposition = decompositionValue;

    const recommendedTotal = computed(() => recommendedStrategy.value?.totalInvestment ?? null);
    const recommendedMaterial = computed(() => recommendedStrategy.value?.materialCost ?? null);
    const priceStatus = computed(() => ({
        loading: Boolean(simulator.pricing?.isLoading),
        ready: Boolean(simulator.pricing?.lastFetchedAt || simulator.pricing?.sourceUrl),
        updatedAt: Number(simulator.pricing?.lastFetchedAt || 0),
        sourceUrl: String(simulator.pricing?.sourceUrl || ""),
        error: String(simulator.pricing?.error || ""),
    }));

    watch(config, () => {
        if (riskRunning.value) {
            cancelRisk();
        }
        clearRiskResult();
    }, { deep: true, flush: "sync" });

    const persistedState = computed(() => normalizeEnhancementPersistedState({
        config,
        favorites: favorites.value,
    }));

    watch(persistedState, (state) => {
        persistEnhancementState(state);
    }, { deep: true });

    watch([() => config.startLevel, () => config.targetLevel], (
        [startValue, targetValue],
        [previousStartValue] = [],
    ) => {
        const normalizedTarget = clamp(integer(targetValue, 1), 1, 20);
        if (targetValue !== normalizedTarget) {
            config.targetLevel = normalizedTarget;
        }
        const normalizedStart = clamp(integer(startValue, 0), 0, normalizedTarget - 1);
        if (startValue !== normalizedStart) {
            config.startLevel = normalizedStart;
        }
        if (previousStartValue !== undefined && normalizedStart !== integer(previousStartValue, 0)) {
            config.startingItemPriceOverride = null;
        }
    }, { flush: "sync" });

    watch([
        () => config.skillLevel,
        () => config.observatoryLevel,
        () => config.otherRoomLevels,
        () => config.communityEnhancingLevel,
        () => config.communityExperienceLevel,
    ], ([skillLevel, observatoryLevel, otherRoomLevels, communityEnhancingLevel, communityExperienceLevel]) => {
        const normalizedSkillLevel = clamp(integer(skillLevel, 1), 1, 200);
        const normalizedObservatoryLevel = clamp(integer(observatoryLevel, 0), 0, 8);
        const normalizedOtherRoomLevels = Math.max(0, integer(otherRoomLevels, 0));
        const normalizedCommunityEnhancingLevel = clamp(integer(communityEnhancingLevel, 0), 0, 20);
        const normalizedCommunityExperienceLevel = clamp(integer(communityExperienceLevel, 0), 0, 20);
        if (skillLevel !== normalizedSkillLevel) {
            config.skillLevel = normalizedSkillLevel;
        }
        if (observatoryLevel !== normalizedObservatoryLevel) {
            config.observatoryLevel = normalizedObservatoryLevel;
        }
        if (otherRoomLevels !== normalizedOtherRoomLevels) {
            config.otherRoomLevels = normalizedOtherRoomLevels;
        }
        if (communityEnhancingLevel !== normalizedCommunityEnhancingLevel) {
            config.communityEnhancingLevel = normalizedCommunityEnhancingLevel;
        }
        if (communityExperienceLevel !== normalizedCommunityExperienceLevel) {
            config.communityExperienceLevel = normalizedCommunityExperienceLevel;
        }
    }, { flush: "sync" });

    watch(strategyRows, (rows) => {
        const requested = String(config.riskStrategy || "recommended");
        if (requested === "recommended") {
            return;
        }
        const available = rows.some((strategy) => (
            strategy.id === requested || strategy.strategyId === requested
        ));
        if (!available) {
            config.riskStrategy = "recommended";
        }
    }, { immediate: true, flush: "sync" });

    async function initialize() {
        if (!initialized.value) {
            initialized.value = true;
        }
        await simulator.ensureMarketPricesLoaded(false);
        return true;
    }

    async function refreshPrices() {
        await simulator.ensureMarketPricesLoaded(true);
        return priceStatus.value;
    }

    function clearRiskResult() {
        risk.value = null;
        riskProgress.value = null;
        riskError.value = "";
    }

    function selectItem(itemHrid) {
        const hrid = normalizeHrid(itemHrid);
        if (!itemOptions.value.some((item) => item.hrid === hrid)) {
            return false;
        }
        const itemChanged = config.itemHrid !== hrid;
        config.itemHrid = hrid;
        if (itemChanged) {
            config.startingItemPriceOverride = null;
            config.protectionItemHrid = "";
        }
        clearRiskResult();
        return true;
    }

    function toggleFavorite(itemHrid) {
        const hrid = normalizeHrid(itemHrid);
        if (!hrid || !itemOptions.value.some((item) => item.hrid === hrid)) {
            return false;
        }
        const next = new Set(favorites.value);
        if (next.has(hrid)) {
            next.delete(hrid);
        } else {
            next.add(hrid);
        }
        favorites.value = Array.from(next);
        return next.has(hrid);
    }

    function patchConfig(patch) {
        if (!isPlainObject(patch)) {
            return false;
        }
        Object.assign(config, patch);
        clearRiskResult();
        return true;
    }

    function setNestedConfig(path, value) {
        const segments = Array.isArray(path) ? path.map(String).filter(Boolean) : [];
        if (segments.length === 0) {
            return false;
        }
        let target = config;
        for (let index = 0; index < segments.length - 1; index += 1) {
            const segment = segments[index];
            if (!isPlainObject(target[segment])) {
                target[segment] = {};
            }
            target = target[segment];
        }
        target[segments[segments.length - 1]] = value;
        clearRiskResult();
        return true;
    }

    function setPriceOverride(itemHrid, value, mode = "") {
        const hrid = normalizeHrid(itemHrid);
        if (!hrid) {
            return false;
        }
        const next = { ...config.priceOverrides };
        const normalizedMode = mode === "ask" || mode === "bid" ? mode : "";
        const hasValue = value != null && value !== "" && Number.isFinite(Number(value));
        if (!normalizedMode) {
            if (!hasValue) {
                delete next[hrid];
            } else {
                next[hrid] = Math.max(0, Number(value));
            }
        } else {
            const current = next[hrid];
            const currentScalar = normalizePriceOverrideNumber(current);
            const quote = isPlainObject(current)
                ? normalizePriceOverrides({ [hrid]: current })[hrid] || {}
                : currentScalar != null
                    ? { ask: currentScalar, bid: currentScalar }
                    : {};
            if (hasValue) {
                quote[normalizedMode] = Math.max(0, Number(value));
            } else {
                delete quote[normalizedMode];
            }
            if (Object.keys(quote).length > 0) {
                next[hrid] = quote;
            } else {
                delete next[hrid];
            }
        }
        config.priceOverrides = next;
        clearRiskResult();
        return true;
    }

    function setMaterialOverride(itemHrid, value, mode = "ask") {
        return setPriceOverride(itemHrid, value, mode);
    }

    function clearPriceOverride(itemHrid, mode = "") {
        return setPriceOverride(itemHrid, null, mode);
    }

    function resetConfig() {
        cancelRisk();
        replaceReactiveObject(config, createDefaultEnhancementConfig());
        itemSearch.value = "";
        itemFilters.equipmentType = "all";
        itemFilters.favoritesOnly = false;
        clearRiskResult();
    }

    function resolveRiskStrategy() {
        const requested = String(config.riskStrategy || "recommended");
        if (requested === "recommended") {
            return recommendedStrategy.value;
        }
        return strategyRows.value.find((strategy) => strategy.id === requested
            || strategy.strategyId === requested)
            || recommendedStrategy.value;
    }

    function finishRiskRun(runId, result, error = "") {
        if (runId !== activeRunId.value) {
            return;
        }
        riskRunning.value = false;
        activeRunId.value = "";
        riskProgress.value = error ? null : { progress: 1, completed: true };
        riskError.value = error;
        if (!error && result) {
            risk.value = result;
        }
        const settle = settleActiveRisk;
        settleActiveRisk = null;
        if (error) {
            settle?.reject(new Error(error));
        } else {
            settle?.resolve(result || null);
        }
    }

    async function runRisk() {
        const selectedStrategy = resolveRiskStrategy();
        if (!selectedStrategy) {
            throw new Error("Select an enhanceable item before running risk analysis.");
        }
        if (!selectedStrategy.startingItem?.available) {
            throw new Error("A direct market quote or price override is required for the starting enhancement level.");
        }
        if (selectedStrategy.materialPricesAvailable === false) {
            throw new Error("A price is required for every enhancement material.");
        }
        if (selectedStrategy.incrementalCostAvailable === false || selectedStrategy.costAvailable === false) {
            throw new Error("A priced protection item is required for cost analysis.");
        }
        const sampleCount = clamp(
            integer(config.sampleCount, DEFAULT_MONTE_CARLO_SAMPLES),
            1024,
            1_000_000,
        );
        if (config.sampleCount !== sampleCount) {
            config.sampleCount = sampleCount;
        }
        cancelRisk();
        const runId = `enhancement-${Date.now()}-${++runSequence}`;
        activeRunId.value = runId;
        riskRunning.value = true;
        riskProgress.value = { progress: 0, completed: 0, total: sampleCount };
        riskError.value = "";
        risk.value = null;
        const options = {
            sampleCount,
            seed: config.seed,
            budget: nonNegativeNumber(config.budget, 0),
            loadThreshold: MONTE_CARLO_LOAD_THRESHOLD,
            includeTrials: false,
        };
        const estimatedTransitions = selectedStrategy.expectedActions * options.sampleCount;

        if (estimatedTransitions >= MONTE_CARLO_LOAD_THRESHOLD || typeof Worker === "undefined") {
            try {
                const result = analyzeEnhancementRisk(selectedStrategy, options);
                finishRiskRun(runId, result);
                return result;
            } catch (error) {
                const message = error?.message || String(error);
                finishRiskRun(runId, null, message);
                throw error;
            }
        }

        return new Promise((resolve, reject) => {
            settleActiveRisk = { resolve, reject, runId };
            try {
                enhancementWorkerClient.start({
                    runId,
                    strategy: selectedStrategy,
                    options,
                }, {
                onProgress(message) {
                    if (runId !== activeRunId.value) {
                        return;
                    }
                    const completed = Number(message.completed || 0);
                    const total = Math.max(1, Number(message.total || options.sampleCount));
                    riskProgress.value = {
                        ...message,
                        progress: completed / total,
                    };
                },
                onResult(result) {
                    finishRiskRun(runId, result);
                },
                onCancelled() {
                    finishRiskRun(runId, null);
                },
                onWorkloadExceeded(message) {
                    const result = analyzeEnhancementRisk(selectedStrategy, {
                        ...options,
                        loadThreshold: 0,
                        fallbackReason: "hard_transition_limit",
                    });
                    result.fallbackReason = "hard_transition_limit";
                    result.transitions = Number(message.transitions || 0);
                    finishRiskRun(runId, result);
                },
                onError(error) {
                    finishRiskRun(runId, null, error?.message || String(error));
                },
                });
            } catch (error) {
                finishRiskRun(runId, null, error?.message || String(error));
            }
        });
    }

    function cancelRisk() {
        if (!riskRunning.value || !activeRunId.value) {
            return false;
        }
        const runId = activeRunId.value;
        enhancementWorkerClient.cancel();
        riskRunning.value = false;
        activeRunId.value = "";
        riskProgress.value = { ...(riskProgress.value || {}), progress: 0, cancelled: true };
        if (settleActiveRisk?.runId === runId) {
            settleActiveRisk.resolve(null);
            settleActiveRisk = null;
        }
        return true;
    }

    return {
        config,
        favorites,
        itemSearch,
        itemFilters,
        initialized,
        risk,
        riskRunning,
        riskProgress,
        riskError,
        activeRunId,
        itemOptions,
        filteredItemOptions,
        selectedItem,
        teaOptions,
        supportSlotOptions,
        equipmentSlotKeys,
        equipmentOptionsBySlot,
        protectionOptions,
        materialRows,
        startingItemPrice,
        strategyRows,
        recommendedStrategy,
        analysis,
        mirrorPlan,
        decomposition,
        decompositionValue,
        recommendedTotal,
        recommendedMaterial,
        priceStatus,
        initialize,
        refreshPrices,
        selectItem,
        toggleFavorite,
        patchConfig,
        setNestedConfig,
        setPriceOverride,
        setMaterialOverride,
        clearPriceOverride,
        resetConfig,
        runRisk,
        cancelRisk,
    };
});

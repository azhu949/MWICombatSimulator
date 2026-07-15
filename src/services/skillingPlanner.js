import { levelExperienceTable, skillingData as defaultSkillingData } from "../shared/gameDataIndex.js";

export const SKILLING_MARKET_FEE_RATE = 0.02;
export const SKILLING_MIN_ACTION_SECONDS = 3;
export const SKILLING_MAX_LEVEL = levelExperienceTable.length - 1;

const EPSILON = 1e-9;
const NANOSECONDS_PER_MILLISECOND = 1_000_000;
const EQUIPMENT_STATE_KEYS = Object.freeze([
    "actionSpeed",
    "efficiency",
    "experience",
    "essenceFind",
    "rareFind",
]);
const DOMINATING_EQUIPMENT_KEYS = Object.freeze([
    "actionSpeed",
    "efficiency",
    "essenceFind",
    "rareFind",
]);

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

function normalizeHrid(value) {
    return String(value || "").trim();
}

function skillKeyFromHrid(skillHrid) {
    return normalizeHrid(skillHrid).split("/").filter(Boolean).pop() || "";
}

function actionTypeForSkill(skillHrid) {
    const key = skillKeyFromHrid(skillHrid);
    return key ? `/action_types/${key}` : "";
}

function roundExperience(value) {
    return Math.round(Math.max(0, finiteNumber(value, 0)) * 10) / 10;
}

function createBonusTotals() {
    return {
        actionSpeed: 0,
        efficiency: 0,
        artisan: 0,
        outputQuantity: 0,
        experience: 0,
        essenceFind: 0,
        rareFind: 0,
        actionLevel: 0,
        skillLevel: 0,
    };
}

function addBonusTotals(...sources) {
    const result = createBonusTotals();
    for (const source of sources) {
        for (const key of Object.keys(result)) {
            result[key] += finiteNumber(source?.[key], 0);
        }
    }
    return result;
}

function buffExpirationAt(buff) {
    const duration = Math.max(0, finiteNumber(buff?.duration, 0));
    if (duration <= 0) {
        return null;
    }
    const startTime = Date.parse(String(buff?.startTime || ""));
    if (!Number.isFinite(startTime) || new Date(startTime).getUTCFullYear() < 2000) {
        return null;
    }
    return startTime + duration / NANOSECONDS_PER_MILLISECOND;
}

function addBuff(totals, buff, skillHrid, multiplier = 1) {
    const typeHrid = normalizeHrid(buff?.typeHrid);
    const value = finiteNumber(buff?.flatBoost, 0) * multiplier;
    if (!typeHrid || !Number.isFinite(value) || Math.abs(value) <= EPSILON) {
        return false;
    }
    if (typeHrid === "/buff_types/action_speed") totals.actionSpeed += value;
    else if (typeHrid === "/buff_types/efficiency") totals.efficiency += value;
    else if (typeHrid === "/buff_types/artisan") totals.artisan += value;
    else if (typeHrid === "/buff_types/gourmet") totals.outputQuantity += value;
    else if (typeHrid === "/buff_types/wisdom" || typeHrid === "/buff_types/skilling_experience") totals.experience += value;
    else if (typeHrid === "/buff_types/essence_find") totals.essenceFind += value;
    else if (typeHrid === "/buff_types/rare_find") totals.rareFind += value;
    else if (typeHrid === "/buff_types/action_level") totals.actionLevel += value;
    else if (typeHrid === `/buff_types/${skillKeyFromHrid(skillHrid)}_level`) totals.skillLevel += value;
    else return false;
    return true;
}

export function collectSkillingProfileBonuses(profile, actionTypeHrid, skillHrid, now = Date.now()) {
    const totals = createBonusTotals();
    const activeUniqueHrids = new Set();
    let expiredBuffCount = 0;
    let nextExpirationAt = null;
    for (const sourceMap of Object.values(profile?.buffsBySource || {})) {
        const buffs = Array.isArray(sourceMap?.[actionTypeHrid]) ? sourceMap[actionTypeHrid] : [];
        for (const buff of buffs) {
            const expirationAt = buffExpirationAt(buff);
            if (expirationAt != null && expirationAt <= now) {
                expiredBuffCount += 1;
                continue;
            }
            const applied = addBuff(totals, buff, skillHrid);
            const uniqueHrid = normalizeHrid(buff?.uniqueHrid);
            if (applied && uniqueHrid) {
                activeUniqueHrids.add(uniqueHrid);
            }
            if (
                applied
                && expirationAt != null
                && (nextExpirationAt == null || expirationAt < nextExpirationAt)
            ) {
                nextExpirationAt = expirationAt;
            }
        }
    }
    return {
        totals,
        expiredBuffCount,
        nextExpirationAt,
        activeUniqueHrids: Array.from(activeUniqueHrids).sort(),
    };
}

export function resolveSkillingPrice(
    priceTable,
    itemHrid,
    feeRate = SKILLING_MARKET_FEE_RATE,
    enhancementQuotesByItem = {},
    enhancementLevel = 0,
) {
    const hrid = normalizeHrid(itemHrid);
    if (hrid === "/items/coin") {
        return { itemHrid: hrid, ask: 1, bid: 1, vendor: 1, purchasePrice: 1, liquidationPrice: 1 };
    }
    const normalizedEnhancementLevel = Math.max(0, integer(enhancementLevel, 0));
    const baseEntry = priceTable?.[hrid] || {};
    const enhancedEntry = normalizedEnhancementLevel > 0
        ? enhancementQuotesByItem?.[hrid]?.[String(normalizedEnhancementLevel)]
        : null;
    const entry = normalizedEnhancementLevel > 0 ? (enhancedEntry || {}) : baseEntry;
    const ask = finiteNumber(entry?.ask, -1);
    const bid = finiteNumber(entry?.bid, -1);
    const vendor = Math.max(0, finiteNumber(baseEntry?.vendor, 0));
    const marketLiquidation = bid >= 0 ? bid * Math.max(0, 1 - finiteNumber(feeRate, 0)) : 0;
    return {
        itemHrid: hrid,
        ask,
        bid,
        vendor,
        purchasePrice: ask >= 0 ? ask : null,
        liquidationPrice: Math.max(vendor, marketLiquidation),
    };
}

export function resolveEnhancedEquipmentStats(instance, equipmentDefinition, totalBonusMultipliers = []) {
    const level = clamp(integer(instance?.enhancementLevel, 0), 0, Math.max(0, totalBonusMultipliers.length - 1));
    const multiplier = finiteNumber(totalBonusMultipliers[level], 0);
    const baseStats = equipmentDefinition?.noncombatStats || {};
    const enhancementBonuses = equipmentDefinition?.noncombatEnhancementBonuses || {};
    const result = {};
    for (const key of new Set([...Object.keys(baseStats), ...Object.keys(enhancementBonuses)])) {
        result[key] = finiteNumber(baseStats[key], 0) + finiteNumber(enhancementBonuses[key], 0) * multiplier;
    }
    return result;
}

function equipmentRequirementsMet(definition, skillLevels) {
    return (definition?.levelRequirements || []).every((requirement) => (
        finiteNumber(skillLevels?.[requirement.skillHrid]?.level ?? skillLevels?.[requirement.skillHrid], 1)
        >= finiteNumber(requirement?.level, 1)
    ));
}

function equipmentBonusesForSkill(stats, skillHrid) {
    const key = skillKeyFromHrid(skillHrid);
    return {
        actionSpeed: finiteNumber(stats?.[`${key}Speed`], 0)
            + finiteNumber(stats?.skillingSpeed, 0)
            + finiteNumber(stats?.actionSpeed, 0),
        efficiency: finiteNumber(stats?.[`${key}Efficiency`], 0)
            + finiteNumber(stats?.skillingEfficiency, 0),
        experience: finiteNumber(stats?.[`${key}Experience`], 0)
            + finiteNumber(stats?.skillingExperience, 0)
            + finiteNumber(stats?.wisdom, 0),
        essenceFind: finiteNumber(stats?.skillingEssenceFind, 0),
        rareFind: finiteNumber(stats?.[`${key}RareFind`], 0)
            + finiteNumber(stats?.skillingRareFind, 0),
        drinkConcentration: finiteNumber(stats?.drinkConcentration, 0),
    };
}

function stateVectorSignature(state, reservationSensitiveHrids) {
    return [
        ...EQUIPMENT_STATE_KEYS.map((key) => finiteNumber(state?.bonuses?.[key], 0).toFixed(12)),
        integer(state?.drinkSlots, 1),
        finiteNumber(state?.drinkConcentration, 0).toFixed(12),
        stateEquipmentReservationSignature(state, reservationSensitiveHrids),
    ].join("|");
}

function stateStableSignature(state) {
    return (state?.items || []).map((item) => `${item.equipmentType}:${item.itemHrid}:${item.enhancementLevel}`).join("|");
}

function stateEquipmentReservationSignature(state, reservationSensitiveHrids = null) {
    const sensitiveHrids = reservationSensitiveHrids instanceof Set
        ? reservationSensitiveHrids
        : null;
    const countsByInstanceType = {};
    for (const item of state?.items || []) {
        const itemHrid = normalizeHrid(item?.itemHrid);
        if (
            !sensitiveHrids || sensitiveHrids.has(itemHrid)
        ) {
            const enhancementLevel = Math.max(0, integer(item?.enhancementLevel, 0));
            addAmount(countsByInstanceType, `${itemHrid}@${enhancementLevel}`, 1);
        }
    }
    return Object.entries(countsByInstanceType)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([instanceType, count]) => `${instanceType}:${count}`)
        .join(",");
}

function stateDominates(left, right, reservationSensitiveHrids, experienceDirection) {
    if (
        stateEquipmentReservationSignature(left, reservationSensitiveHrids)
        !== stateEquipmentReservationSignature(right, reservationSensitiveHrids)
    ) {
        return false;
    }
    if (Math.abs(finiteNumber(left?.drinkConcentration, 0) - finiteNumber(right?.drinkConcentration, 0)) > EPSILON) {
        return false;
    }
    const leftExperience = finiteNumber(left?.bonuses?.experience, 0);
    const rightExperience = finiteNumber(right?.bonuses?.experience, 0);
    if (experienceDirection > 0 && leftExperience + EPSILON < rightExperience) {
        return false;
    }
    if (experienceDirection < 0 && leftExperience > rightExperience + EPSILON) {
        return false;
    }
    let strictlyBetter = integer(left?.drinkSlots, 1) > integer(right?.drinkSlots, 1);
    if (integer(left?.drinkSlots, 1) < integer(right?.drinkSlots, 1)) {
        return false;
    }
    for (const key of DOMINATING_EQUIPMENT_KEYS) {
        const leftValue = finiteNumber(left?.bonuses?.[key], 0);
        const rightValue = finiteNumber(right?.bonuses?.[key], 0);
        if (leftValue + EPSILON < rightValue) {
            return false;
        }
        strictlyBetter ||= leftValue > rightValue + EPSILON;
    }
    strictlyBetter ||= experienceDirection > 0
        ? leftExperience > rightExperience + EPSILON
        : leftExperience + EPSILON < rightExperience;
    if (!strictlyBetter && finiteNumber(left?.equipmentChanges, 0) < finiteNumber(right?.equipmentChanges, 0)) {
        strictlyBetter = true;
    }
    return strictlyBetter;
}

function pruneEquipmentStates(states, reservationSensitiveHrids) {
    const exact = new Map();
    for (const state of states) {
        const key = stateVectorSignature(state, reservationSensitiveHrids);
        const previous = exact.get(key);
        if (
            !previous
            || state.equipmentChanges < previous.equipmentChanges
            || (
                state.equipmentChanges === previous.equipmentChanges
                && stateStableSignature(state).localeCompare(stateStableSignature(previous)) < 0
            )
        ) {
            exact.set(key, state);
        }
    }
    const candidates = Array.from(exact.values());
    const result = [];
    for (const candidate of candidates) {
        const dominatedForHigherExperience = candidates.some((other) => (
            other !== candidate
            && stateDominates(other, candidate, reservationSensitiveHrids, 1)
        ));
        const dominatedForLowerExperience = candidates.some((other) => (
            other !== candidate
            && stateDominates(other, candidate, reservationSensitiveHrids, -1)
        ));
        if (dominatedForHigherExperience && dominatedForLowerExperience) {
            continue;
        }
        result.push(candidate);
    }
    return result.sort((left, right) => (
        left.equipmentChanges - right.equipmentChanges
        || stateStableSignature(left).localeCompare(stateStableSignature(right))
    ));
}

export function buildSkillingEquipmentLoadouts(
    profile,
    skillHrid,
    skillLevels,
    data = defaultSkillingData,
    inventory = null,
    reservationSensitiveHrids = null,
) {
    const definitionsByHrid = new Map((data?.equipment || []).map((item) => [item.hrid, item]));
    const hasInventoryLedger = inventory != null && typeof inventory === "object" && !Array.isArray(inventory);
    const owned = (profile?.equipment || [])
        .map((instance) => {
            const definition = definitionsByHrid.get(instance?.itemHrid);
            const isAvailable = finiteNumber(instance?.count, 1) >= 1 - EPSILON
                && (
                    !hasInventoryLedger
                    || finiteNumber(inventory?.[instance?.itemHrid], 0) >= 1 - EPSILON
                );
            if (!definition || !isAvailable || !equipmentRequirementsMet(definition, skillLevels)) {
                return null;
            }
            const stats = resolveEnhancedEquipmentStats(instance, definition, data?.totalBonusMultipliers || []);
            return {
                ...instance,
                equipmentType: definition.equipmentType,
                definition,
                stats,
                bonuses: equipmentBonusesForSkill(stats, skillHrid),
                drinkSlots: Math.max(0, integer(definition?.drinkSlots, 0)),
            };
        })
        .filter(Boolean);

    const byType = new Map();
    for (const item of owned) {
        if (!byType.has(item.equipmentType)) {
            byType.set(item.equipmentType, []);
        }
        const options = byType.get(item.equipmentType);
        const key = `${item.itemHrid}:${item.enhancementLevel}:${item.isEquipped ? 1 : 0}`;
        if (!options.some((candidate) => `${candidate.itemHrid}:${candidate.enhancementLevel}:${candidate.isEquipped ? 1 : 0}` === key)) {
            options.push(item);
        }
    }

    let states = [{
        items: [],
        bonuses: { actionSpeed: 0, efficiency: 0, experience: 0, essenceFind: 0, rareFind: 0 },
        drinkSlots: 1,
        drinkConcentration: 0,
        equipmentChanges: 0,
    }];

    for (const [equipmentType, rawOptions] of byType.entries()) {
        const options = [null, ...rawOptions];
        const equipped = rawOptions.find((item) => item.isEquipped) || null;
        const nextStates = [];
        for (const state of states) {
            for (const option of options) {
                const optionSelected = Boolean(option);
                const selectionChanged = equipped
                    ? option?.id !== equipped.id
                    : optionSelected;
                nextStates.push({
                    items: option ? [...state.items, option] : [...state.items],
                    bonuses: {
                        actionSpeed: state.bonuses.actionSpeed + finiteNumber(option?.bonuses?.actionSpeed, 0),
                        efficiency: state.bonuses.efficiency + finiteNumber(option?.bonuses?.efficiency, 0),
                        experience: state.bonuses.experience + finiteNumber(option?.bonuses?.experience, 0),
                        essenceFind: state.bonuses.essenceFind + finiteNumber(option?.bonuses?.essenceFind, 0),
                        rareFind: state.bonuses.rareFind + finiteNumber(option?.bonuses?.rareFind, 0),
                    },
                    drinkSlots: Math.max(state.drinkSlots, 1 + Math.max(0, integer(option?.drinkSlots, 0))),
                    drinkConcentration: state.drinkConcentration + finiteNumber(option?.bonuses?.drinkConcentration, 0),
                    equipmentChanges: state.equipmentChanges + (selectionChanged ? 1 : 0),
                    lastEquipmentType: equipmentType,
                });
            }
        }
        states = pruneEquipmentStates(nextStates, reservationSensitiveHrids);
    }
    return states;
}

function buildDrinkLoadouts(data, actionTypeHrid, maximumSlots, blockedUniqueHrids = []) {
    const blockedUniqueHridSet = new Set(
        Array.from(blockedUniqueHrids || []).map(normalizeHrid).filter(Boolean),
    );
    const drinks = (data?.drinks || [])
        .filter((drink) => (
            drink?.usableInActionTypeMap?.[actionTypeHrid] === true
            && finiteNumber(drink?.durationSeconds, 0) > 0
        ))
        .sort((left, right) => (
            finiteNumber(left?.sortIndex, 0) - finiteNumber(right?.sortIndex, 0)
            || String(left?.hrid || "").localeCompare(String(right?.hrid || ""))
        ));
    const limit = Math.max(0, integer(maximumSlots, 0));
    const loadouts = [[]];
    function visit(startIndex, selected, selectedUniqueHrids) {
        if (selected.length >= limit) {
            return;
        }
        for (let index = startIndex; index < drinks.length; index += 1) {
            const drink = drinks[index];
            const uniqueHrids = Array.from(new Set((drink?.buffs || [])
                .map((buff) => normalizeHrid(buff?.uniqueHrid))
                .filter(Boolean)));
            if (uniqueHrids.some((uniqueHrid) => (
                blockedUniqueHridSet.has(uniqueHrid) || selectedUniqueHrids.has(uniqueHrid)
            ))) {
                continue;
            }
            const next = [...selected, drink];
            const nextUniqueHrids = new Set(selectedUniqueHrids);
            uniqueHrids.forEach((uniqueHrid) => nextUniqueHrids.add(uniqueHrid));
            loadouts.push(next);
            visit(index + 1, next, nextUniqueHrids);
        }
    }
    visit(0, [], new Set());
    return loadouts;
}

function countActiveImportedDrinkSlots(profile, actionTypeHrid, activeUniqueHrids, data) {
    const activeUniqueHridSet = new Set(
        Array.from(activeUniqueHrids || []).map(normalizeHrid).filter(Boolean),
    );
    if (activeUniqueHridSet.size === 0) return 0;
    const drinksByHrid = new Map((data?.drinks || []).map((drink) => [normalizeHrid(drink?.hrid), drink]));
    const slots = Array.isArray(profile?.drinkSlotsByActionType?.[actionTypeHrid])
        ? profile.drinkSlotsByActionType[actionTypeHrid]
        : [];
    return slots.reduce((count, slot) => {
        if (slot?.isActive === false) return count;
        const drink = drinksByHrid.get(normalizeHrid(slot?.itemHrid));
        const occupiesActiveUnique = (drink?.buffs || []).some((buff) => (
            activeUniqueHridSet.has(normalizeHrid(buff?.uniqueHrid))
        ));
        return count + (occupiesActiveUnique ? 1 : 0);
    }, 0);
}

function addAmount(target, itemHrid, count) {
    const hrid = normalizeHrid(itemHrid);
    const amount = finiteNumber(count, 0);
    if (!hrid || Math.abs(amount) <= EPSILON) {
        return;
    }
    target[hrid] = finiteNumber(target[hrid], 0) + amount;
}

function expectedDropCount(drop) {
    return Math.max(0, finiteNumber(drop?.dropRate, 0))
        * (Math.max(0, finiteNumber(drop?.minCount, 0)) + Math.max(0, finiteNumber(drop?.maxCount, 0)))
        / 2;
}

function createOwnedItemPools(inventory, equipmentInstances, selectedEquipment, reusableGeneratedItems = {}) {
    const pools = new Map(Object.entries(inventory || {}).map(([itemHrid, rawCount]) => [itemHrid, {
        itemHrid,
        genericCount: Math.max(0, finiteNumber(rawCount, 0)),
        sources: [],
    }]));
    const reservedById = new Map((selectedEquipment || []).map((item) => [String(item?.id || ""), 1]));
    const matchedReservationIds = new Set();

    for (const instance of equipmentInstances || []) {
        const itemHrid = normalizeHrid(instance?.itemHrid);
        const pool = pools.get(itemHrid);
        if (!itemHrid || !pool) continue;
        const representedCount = Math.min(
            pool.genericCount,
            Math.max(0, finiteNumber(instance?.count, 1)),
        );
        if (representedCount <= EPSILON) continue;
        pool.genericCount -= representedCount;
        const id = String(instance?.id || "");
        const reservedCount = Math.min(representedCount, finiteNumber(reservedById.get(id), 0));
        if (reservedCount > EPSILON) matchedReservationIds.add(id);
        pool.sources.push({
            kind: "equipment",
            id,
            itemHrid,
            enhancementLevel: Math.max(0, integer(instance?.enhancementLevel, 0)),
            availableCount: representedCount - reservedCount,
        });
    }

    for (const item of selectedEquipment || []) {
        const id = String(item?.id || "");
        if (id && matchedReservationIds.has(id)) continue;
        const itemHrid = normalizeHrid(item?.itemHrid);
        const pool = pools.get(itemHrid);
        if (pool) pool.genericCount = Math.max(0, pool.genericCount - 1);
    }
    for (const pool of pools.values()) {
        if (pool.genericCount > EPSILON) {
            pool.sources.push({
                kind: "generic",
                id: "",
                itemHrid: pool.itemHrid,
                enhancementLevel: 0,
                availableCount: pool.genericCount,
            });
        }
    }
    for (const [itemHrid, rawCount] of Object.entries(reusableGeneratedItems || {})) {
        const count = Math.max(0, finiteNumber(rawCount, 0));
        if (!itemHrid || count <= EPSILON) continue;
        let pool = pools.get(itemHrid);
        if (!pool) {
            pool = { itemHrid, genericCount: 0, sources: [] };
            pools.set(itemHrid, pool);
        }
        pool.sources.push({
            kind: "generated",
            id: "",
            itemHrid,
            enhancementLevel: 0,
            availableCount: count,
        });
    }
    return pools;
}

function allocateOwnedRequirement({
    pool,
    count,
    priceTable,
    enhancementQuotesByItem,
    feeRate,
    retainedOutputValue = null,
}) {
    const candidates = (pool?.sources || [])
        .filter((source) => source.availableCount > EPSILON)
        .map((source) => {
            const quote = resolveSkillingPrice(
                priceTable,
                source.itemHrid,
                feeRate,
                enhancementQuotesByItem,
                source.enhancementLevel,
            );
            const retainedValue = typeof retainedOutputValue === "function"
                ? finiteNumber(retainedOutputValue(source.enhancementLevel), 0)
                : 0;
            return { ...source, quote, score: quote.liquidationPrice - retainedValue };
        })
        .sort((left, right) => (
            left.score - right.score
            || left.enhancementLevel - right.enhancementLevel
            || left.kind.localeCompare(right.kind)
            || left.id.localeCompare(right.id)
        ));
    const sources = [];
    let remaining = Math.max(0, finiteNumber(count, 0));
    for (const candidate of candidates) {
        if (remaining <= EPSILON) break;
        const source = pool.sources.find((entry) => (
            entry.kind === candidate.kind
            && entry.id === candidate.id
            && entry.enhancementLevel === candidate.enhancementLevel
        ));
        if (!source) continue;
        const usedCount = Math.min(remaining, source.availableCount);
        if (usedCount <= EPSILON) continue;
        source.availableCount -= usedCount;
        remaining -= usedCount;
        sources.push({ ...candidate, count: usedCount });
    }
    return {
        sources,
        ownedCount: sources.reduce((sum, source) => sum + source.count, 0),
        purchaseCount: Math.max(0, remaining),
    };
}

function buildLedgerRows({
    inventory,
    requiredItems,
    upgradeItemHrid,
    upgradeCount,
    actionOutputItems,
    outputItems,
    outputMultiplier,
    retainAllEnhancement,
    equipmentInstances,
    selectedEquipment,
    priceTable,
    enhancementQuotesByItem,
    feeRate,
    reusableOutputFraction = 0,
    postInitialRequirementFraction = 0,
}) {
    const inputRowsByKey = new Map();
    const outputRowsByKey = new Map();
    const inventoryDelta = {};
    const missingPriceHrids = new Set();
    const consumedEquipmentById = new Map();
    const producedEquipment = [];
    const reusableGeneratedItems = {};
    const reusableFraction = clamp(finiteNumber(reusableOutputFraction, 0), 0, 1);
    const laterRequirementFraction = clamp(finiteNumber(postInitialRequirementFraction, 0), 0, 1);
    if (reusableFraction > EPSILON) {
        const totalRequirements = { ...(requiredItems || {}) };
        addAmount(totalRequirements, upgradeItemHrid, upgradeCount);
        for (const [itemHrid, count] of Object.entries(outputItems || {})) {
            const reusableCount = Math.min(
                Math.max(0, finiteNumber(count, 0)) * reusableFraction,
                Math.max(0, finiteNumber(totalRequirements[itemHrid], 0)) * laterRequirementFraction,
            );
            addAmount(reusableGeneratedItems, itemHrid, reusableCount);
        }
    }
    const pools = createOwnedItemPools(
        inventory,
        equipmentInstances,
        selectedEquipment,
        reusableGeneratedItems,
    );
    let opportunityCost = 0;
    let purchaseCost = 0;
    let outputValue = 0;

    function retainedOutputValue(enhancementLevel) {
        return (actionOutputItems || []).reduce((sum, output) => {
            const quote = resolveSkillingPrice(
                priceTable,
                output?.itemHrid,
                feeRate,
                enhancementQuotesByItem,
                enhancementLevel,
            );
            return sum + Math.max(0, finiteNumber(output?.count, 0))
                * Math.max(0, finiteNumber(outputMultiplier, 1))
                * quote.liquidationPrice;
        }, 0);
    }

    function recordRequirement(itemHrid, rawCount, options = {}) {
        const hrid = normalizeHrid(itemHrid);
        const count = Math.max(0, finiteNumber(rawCount, 0));
        if (!hrid || count <= EPSILON) return null;
        const allocation = allocateOwnedRequirement({
            pool: pools.get(hrid),
            count,
            priceTable,
            enhancementQuotesByItem,
            feeRate,
            retainedOutputValue: options.retained === true ? retainedOutputValue : null,
        });
        const purchaseQuote = resolveSkillingPrice(priceTable, hrid, feeRate);
        if (allocation.purchaseCount > EPSILON && purchaseQuote.purchasePrice == null) {
            missingPriceHrids.add(hrid);
        }
        const ownedValue = allocation.sources.reduce((sum, source) => (
            sum + source.count * source.quote.liquidationPrice
        ), 0);
        const purchasedValue = allocation.purchaseCount * finiteNumber(purchaseQuote.purchasePrice, 0);
        opportunityCost += ownedValue;
        purchaseCost += purchasedValue;
        addAmount(inventoryDelta, hrid, -allocation.ownedCount);

        function getInputRow(enhancementLevel) {
            const normalizedLevel = Math.max(0, integer(enhancementLevel, 0));
            const key = `${hrid}@${normalizedLevel}`;
            let row = inputRowsByKey.get(key);
            if (!row) {
                row = {
                    itemHrid: hrid,
                    enhancementLevel: normalizedLevel,
                    count: 0,
                    ownedCount: 0,
                    purchaseCount: 0,
                    opportunityUnitPrice: 0,
                    purchaseUnitPrice: normalizedLevel === 0 ? purchaseQuote.purchasePrice : null,
                    opportunityCost: 0,
                    purchaseCost: 0,
                };
                inputRowsByKey.set(key, row);
            }
            return row;
        }

        for (const source of allocation.sources) {
            const row = getInputRow(source.enhancementLevel);
            const sourceValue = source.count * source.quote.liquidationPrice;
            row.count += source.count;
            row.ownedCount += source.count;
            row.opportunityCost += sourceValue;
            row.opportunityUnitPrice = row.opportunityCost / row.ownedCount;
        }
        if (allocation.purchaseCount > EPSILON) {
            const row = getInputRow(0);
            row.count += allocation.purchaseCount;
            row.purchaseCount += allocation.purchaseCount;
            row.purchaseCost += purchasedValue;
            if (row.ownedCount <= EPSILON) {
                row.opportunityUnitPrice = purchaseQuote.liquidationPrice;
            }
        }
        for (const source of allocation.sources) {
            if (source.kind !== "equipment" || !source.id) continue;
            const existing = consumedEquipmentById.get(source.id) || {
                id: source.id,
                itemHrid: hrid,
                enhancementLevel: source.enhancementLevel,
                count: 0,
            };
            existing.count += source.count;
            consumedEquipmentById.set(source.id, existing);
        }
        return {
            ...allocation,
            allSources: [
                ...allocation.sources,
                ...(allocation.purchaseCount > EPSILON ? [{
                    kind: "purchase",
                    id: "",
                    itemHrid: hrid,
                    enhancementLevel: 0,
                    count: allocation.purchaseCount,
                }] : []),
            ],
        };
    }

    const normalizedUpgradeHrid = normalizeHrid(upgradeItemHrid);
    const upgradeAllocation = normalizedUpgradeHrid
        ? recordRequirement(normalizedUpgradeHrid, upgradeCount, { retained: retainAllEnhancement === true })
        : null;
    for (const [itemHrid, count] of Object.entries(requiredItems || {})) {
        recordRequirement(itemHrid, count);
    }

    const outputEntries = Object.entries(outputItems || {}).map(([itemHrid, count]) => ({
        itemHrid,
        count,
        enhancementLevel: 0,
    }));
    if (retainAllEnhancement === true && upgradeAllocation) {
        for (const output of actionOutputItems || []) {
            for (const source of upgradeAllocation.allSources) {
                outputEntries.push({
                    itemHrid: output?.itemHrid,
                    count: finiteNumber(output?.count, 0) * source.count * Math.max(0, finiteNumber(outputMultiplier, 1)),
                    enhancementLevel: source.enhancementLevel,
                });
            }
        }
    } else {
        for (const output of actionOutputItems || []) {
            outputEntries.push({
                itemHrid: output?.itemHrid,
                count: finiteNumber(output?.count, 0) * Math.max(0, finiteNumber(upgradeCount, 0))
                    * Math.max(0, finiteNumber(outputMultiplier, 1)),
                enhancementLevel: 0,
            });
        }
    }

    for (const entry of outputEntries) {
        const itemHrid = normalizeHrid(entry?.itemHrid);
        const count = Math.max(0, finiteNumber(entry?.count, 0));
        const enhancementLevel = Math.max(0, integer(entry?.enhancementLevel, 0));
        if (!itemHrid || count <= EPSILON) continue;
        const quote = resolveSkillingPrice(
            priceTable,
            itemHrid,
            feeRate,
            enhancementQuotesByItem,
            enhancementLevel,
        );
        const value = count * quote.liquidationPrice;
        const key = `${itemHrid}@${enhancementLevel}`;
        const row = outputRowsByKey.get(key) || {
            itemHrid,
            enhancementLevel,
            count: 0,
            liquidationUnitPrice: quote.liquidationPrice,
            liquidationValue: 0,
        };
        row.count += count;
        row.liquidationValue += value;
        outputRowsByKey.set(key, row);
        outputValue += value;
        addAmount(inventoryDelta, itemHrid, count);
        producedEquipment.push({ itemHrid, enhancementLevel, count });
    }

    return {
        available: missingPriceHrids.size === 0,
        missingPriceHrids: Array.from(missingPriceHrids).sort(),
        inputRows: Array.from(inputRowsByKey.values()),
        outputRows: Array.from(outputRowsByKey.values()),
        inventoryDelta,
        consumedEquipment: Array.from(consumedEquipmentById.values()),
        producedEquipment,
        opportunityCost,
        purchaseCost,
        outputValue,
        netCost: opportunityCost + purchaseCost - outputValue,
    };
}

function applyInventoryDelta(inventory, delta) {
    const result = { ...(inventory || {}) };
    for (const [itemHrid, amount] of Object.entries(delta || {})) {
        const next = finiteNumber(result[itemHrid], 0) + finiteNumber(amount, 0);
        if (Math.abs(next) <= EPSILON) {
            delete result[itemHrid];
        } else {
            result[itemHrid] = Math.max(0, next);
        }
    }
    return result;
}

function createPlanningEquipmentInstances(profile) {
    return (profile?.equipment || []).map((instance, index) => ({
        ...instance,
        id: String(instance?.id || `item-${index}`),
        itemHrid: normalizeHrid(instance?.itemHrid),
        enhancementLevel: Math.max(0, integer(instance?.enhancementLevel, 0)),
        count: Math.max(0, finiteNumber(instance?.count, 1)),
        isEquipped: instance?.isEquipped === true,
    })).filter((instance) => instance.itemHrid && instance.count > EPSILON);
}

function createPlanningInventory(profile, equipmentInstances) {
    const result = { ...(profile?.inventory || {}) };
    for (const instance of equipmentInstances || []) {
        if (instance?.isEquipped === true) {
            addAmount(result, instance?.itemHrid, Math.max(0, finiteNumber(instance?.count, 1)));
        }
    }
    return result;
}

function applyPlanningEquipmentChanges({
    equipmentInstances,
    consumedEquipment,
    producedEquipment,
    selectedEquipment,
    data,
    iteration,
}) {
    const consumedById = new Map((consumedEquipment || []).map((item) => [String(item?.id || ""), finiteNumber(item?.count, 0)]));
    const selectedIds = new Set((selectedEquipment || []).map((item) => String(item?.id || "")).filter(Boolean));
    const supportDefinitions = new Map((data?.equipment || []).map((item) => [item.hrid, item]));
    const equipmentItemHrids = new Set([
        ...(data?.equipmentItemHrids || []),
        ...supportDefinitions.keys(),
    ]);
    const next = [];
    for (const instance of equipmentInstances || []) {
        const remainingCount = Math.max(0, finiteNumber(instance?.count, 1) - finiteNumber(consumedById.get(String(instance?.id || "")), 0));
        if (remainingCount <= EPSILON) continue;
        const supportDefinition = supportDefinitions.get(instance.itemHrid);
        const isEquipped = supportDefinition ? selectedIds.has(String(instance?.id || "")) : instance?.isEquipped === true;
        next.push({
            ...instance,
            count: remainingCount,
            isEquipped,
            equipmentType: supportDefinition?.equipmentType || instance?.equipmentType || "",
            itemLocationHrid: isEquipped
                ? `/item_locations/${String(supportDefinition?.equipmentType || instance?.equipmentType || "").split("/").filter(Boolean).pop() || "inventory"}`
                : "/item_locations/inventory",
        });
    }

    let outputIndex = 0;
    for (const output of producedEquipment || []) {
        const itemHrid = normalizeHrid(output?.itemHrid);
        const count = Math.max(0, finiteNumber(output?.count, 0));
        if (!itemHrid || count <= EPSILON || !equipmentItemHrids.has(itemHrid)) continue;
        const enhancementLevel = Math.max(0, integer(output?.enhancementLevel, 0));
        const supportDefinition = supportDefinitions.get(itemHrid);
        const existing = next.find((instance) => (
            instance.itemHrid === itemHrid
            && instance.enhancementLevel === enhancementLevel
            && instance.isEquipped !== true
        ));
        if (existing) {
            existing.count += count;
            continue;
        }
        next.push({
            id: `planned-${iteration}-${outputIndex}-${itemHrid}`,
            itemHrid,
            equipmentType: supportDefinition?.equipmentType || "",
            itemLocationHrid: "/item_locations/inventory",
            enhancementLevel,
            count,
            isEquipped: false,
        });
        outputIndex += 1;
    }
    return next;
}

function activeDrinkStateItems(drinkState) {
    return Object.entries(drinkState?.itemsByHrid || {})
        .map(([itemHrid, state]) => ({
            itemHrid: normalizeHrid(itemHrid),
            remainingSeconds: Math.max(0, finiteNumber(state?.remainingSeconds, 0)),
            concentrationMultiplier: Math.max(1, finiteNumber(state?.concentrationMultiplier, 1)),
        }))
        .filter((item) => item.itemHrid && item.remainingSeconds > EPSILON);
}

function drinkBonuses(loadout, skillHrid, concentrationByItem) {
    const totals = createBonusTotals();
    for (const drink of loadout) {
        const itemHrid = normalizeHrid(drink?.hrid);
        const concentrationMultiplier = Math.max(
            1,
            finiteNumber(concentrationByItem?.[itemHrid], 1),
        );
        for (const buff of drink?.buffs || []) {
            addBuff(totals, buff, skillHrid, concentrationMultiplier);
        }
    }
    return totals;
}

function drinkLoadoutSignature(loadout) {
    return (loadout || [])
        .map((drink) => normalizeHrid(drink?.hrid))
        .filter(Boolean)
        .sort()
        .join("|");
}

export function calculateSkillingActionCandidate({
    action,
    skillHrid,
    skillLevel,
    experienceNeeded,
    inventory,
    equipmentInstances = [],
    equipmentLoadout,
    drinkLoadout = [],
    drinkState = null,
    externalBonuses = createBonusTotals(),
    actionStartWindowSeconds = null,
    renewDrinkHrids = [],
    inventoryReuseCompletionInterval = null,
    priceTable,
    enhancementQuotesByItem = {},
    feeRate = SKILLING_MARKET_FEE_RATE,
}) {
    const equipmentConcentrationMultiplier = Math.max(
        1,
        1 + finiteNumber(equipmentLoadout?.drinkConcentration, 0),
    );
    const concentrationByItem = {};
    for (const drink of drinkLoadout) {
        const itemHrid = normalizeHrid(drink?.hrid);
        const activeState = drinkState?.itemsByHrid?.[itemHrid];
        concentrationByItem[itemHrid] = finiteNumber(activeState?.remainingSeconds, 0) > EPSILON
            ? Math.max(1, finiteNumber(activeState?.concentrationMultiplier, 1))
            : equipmentConcentrationMultiplier;
    }
    const drinks = drinkBonuses(drinkLoadout, skillHrid, concentrationByItem);
    const equipment = {
        actionSpeed: finiteNumber(equipmentLoadout?.bonuses?.actionSpeed, 0),
        efficiency: finiteNumber(equipmentLoadout?.bonuses?.efficiency, 0),
        experience: finiteNumber(equipmentLoadout?.bonuses?.experience, 0),
        essenceFind: finiteNumber(equipmentLoadout?.bonuses?.essenceFind, 0),
        rareFind: finiteNumber(equipmentLoadout?.bonuses?.rareFind, 0),
    };
    const bonuses = addBonusTotals(externalBonuses, drinks, equipment);
    const actionLevel = finiteNumber(action?.levelRequirement?.level, 1) + bonuses.actionLevel;
    const effectiveSkillLevel = Math.max(1, finiteNumber(skillLevel, 1) + bonuses.skillLevel);
    const levelEfficiency = Math.max(0, effectiveSkillLevel - actionLevel) / 100;
    const actionSeconds = Math.max(
        SKILLING_MIN_ACTION_SECONDS,
        finiteNumber(action?.baseTimeSeconds, SKILLING_MIN_ACTION_SECONDS) / Math.max(EPSILON, 1 + bonuses.actionSpeed),
    );
    const efficiencyMultiplier = 1 + bonuses.efficiency + levelEfficiency;
    const actionsPerHour = efficiencyMultiplier > EPSILON ? (3600 / actionSeconds) * efficiencyMultiplier : 0;
    const experiencePerAction = roundExperience(
        finiteNumber(action?.experienceGain?.value, 0) * Math.max(0, 1 + bonuses.experience),
    );
    if (actionsPerHour <= 0 || experiencePerAction <= 0) {
        return null;
    }

    const requiredCompletionCount = Math.max(1, Math.ceil(Math.max(0, experienceNeeded) / experiencePerAction - EPSILON));
    const suppliedStartWindow = actionStartWindowSeconds == null
        ? null
        : Math.max(0, finiteNumber(actionStartWindowSeconds, 0));
    const requestedRenewDrinkHrids = new Set(
        Array.from(renewDrinkHrids || []).map(normalizeHrid).filter(Boolean),
    );
    const renewableDrinkHrids = [];
    const drinkStartWindow = drinkLoadout.reduce((minimum, drink) => {
        const itemHrid = normalizeHrid(drink?.hrid);
        const activeState = drinkState?.itemsByHrid?.[itemHrid];
        const carriedSeconds = Math.max(
            0,
            finiteNumber(activeState?.remainingSeconds, 0),
        );
        const concentrationMultiplier = Math.max(1, finiteNumber(
            concentrationByItem[itemHrid],
            equipmentConcentrationMultiplier,
        ));
        const concentrationMatches = carriedSeconds <= EPSILON || Math.abs(
            Math.max(1, finiteNumber(activeState?.concentrationMultiplier, 1))
            - equipmentConcentrationMultiplier
        ) <= EPSILON;
        if (concentrationMatches) renewableDrinkHrids.push(itemHrid);
        if (requestedRenewDrinkHrids.has(itemHrid) && concentrationMatches) return minimum;
        const effectiveDuration = finiteNumber(drink?.durationSeconds, 300) / concentrationMultiplier;
        return Math.min(minimum, carriedSeconds > EPSILON ? carriedSeconds : effectiveDuration);
    }, Infinity);
    const normalizedStartWindow = [
        suppliedStartWindow,
        drinkStartWindow,
    ]
        .filter((value) => value != null && Number.isFinite(value))
        .reduce((minimum, value) => Math.min(minimum, value), Infinity);
    const effectiveStartWindow = Number.isFinite(normalizedStartWindow)
        ? normalizedStartWindow
        : null;
    const windowCompletionCount = effectiveStartWindow == null
        ? requiredCompletionCount
        : Math.max(1, Math.ceil(effectiveStartWindow * actionsPerHour / 3600 - EPSILON));
    const completionCount = Math.min(requiredCompletionCount, windowCompletionCount);
    const gainedExperience = completionCount * experiencePerAction;
    const durationHours = completionCount / actionsPerHour;
    const durationSeconds = durationHours * 3600;
    const requiredItems = {};
    const outputItems = {};
    const artisanMultiplier = Math.max(0, 1 - clamp(bonuses.artisan, 0, 0.95));
    const outputMultiplier = Math.max(0, 1 + bonuses.outputQuantity);
    for (const input of action?.inputItems || []) {
        addAmount(requiredItems, input?.itemHrid, finiteNumber(input?.count, 0) * completionCount * artisanMultiplier);
    }
    for (const drop of action?.essenceDropTable || []) {
        addAmount(outputItems, drop?.itemHrid, expectedDropCount(drop) * completionCount * Math.max(0, 1 + bonuses.essenceFind));
    }
    for (const drop of action?.rareDropTable || []) {
        addAmount(outputItems, drop?.itemHrid, expectedDropCount(drop) * completionCount * Math.max(0, 1 + bonuses.rareFind));
    }

    const drinkRows = [];
    const endingDrinkItemsByHrid = {};
    const actionIntervalSeconds = 3600 / actionsPerHour;
    for (const drink of drinkLoadout) {
        const itemHrid = normalizeHrid(drink?.hrid);
        const concentrationMultiplier = Math.max(1, finiteNumber(
            concentrationByItem[itemHrid],
            equipmentConcentrationMultiplier,
        ));
        const effectiveDuration = finiteNumber(drink?.durationSeconds, 300) / concentrationMultiplier;
        const carriedSeconds = Math.max(
            0,
            finiteNumber(drinkState?.itemsByHrid?.[itemHrid]?.remainingSeconds, 0),
        );
        const carriedCompletionCount = carriedSeconds > EPSILON
            ? Math.max(1, Math.ceil(carriedSeconds / actionIntervalSeconds - EPSILON))
            : 0;
        const completionCountPerDrink = Math.max(
            1,
            Math.ceil(effectiveDuration / actionIntervalSeconds - EPSILON),
        );
        const uncoveredCompletionCount = Math.max(0, completionCount - carriedCompletionCount);
        const count = Math.ceil(uncoveredCompletionCount / completionCountPerDrink);
        const lastDrinkStartSeconds = count > 0
            ? (carriedCompletionCount + (count - 1) * completionCountPerDrink) * actionIntervalSeconds
            : null;
        const endingRemainingSeconds = count > 0
            ? Math.max(0, effectiveDuration - (durationSeconds - lastDrinkStartSeconds))
            : Math.max(0, carriedSeconds - durationSeconds);
        addAmount(requiredItems, itemHrid, count);
        endingDrinkItemsByHrid[itemHrid] = {
            remainingSeconds: endingRemainingSeconds,
            concentrationMultiplier,
        };
        drinkRows.push({
            itemHrid,
            count,
            effectiveDurationSeconds: effectiveDuration,
            carriedDurationSeconds: carriedSeconds,
        });
    }

    const reuseCompletionInterval = Math.max(0, integer(inventoryReuseCompletionInterval, 0));
    const canReuseCompletedCycles = reuseCompletionInterval > 0
        && completionCount > reuseCompletionInterval
        && completionCount % reuseCompletionInterval === 0;
    const finalReuseChunkCompletionCount = reuseCompletionInterval > 0
        ? completionCount % reuseCompletionInterval || reuseCompletionInterval
        : completionCount;
    const initialReuseChunkCompletionCount = reuseCompletionInterval > 0
        ? Math.min(completionCount, reuseCompletionInterval)
        : completionCount;
    const reusableOutputFraction = canReuseCompletedCycles
        ? (completionCount - finalReuseChunkCompletionCount) / completionCount
        : 0;
    const postInitialRequirementFraction = canReuseCompletedCycles
        ? (completionCount - initialReuseChunkCompletionCount) / completionCount
        : 0;
    const ledger = buildLedgerRows({
        inventory,
        requiredItems,
        upgradeItemHrid: action?.upgradeItemHrid,
        upgradeCount: completionCount,
        actionOutputItems: action?.outputItems || [],
        outputItems,
        outputMultiplier,
        retainAllEnhancement: action?.retainAllEnhancement === true,
        equipmentInstances,
        selectedEquipment: equipmentLoadout?.items || [],
        priceTable,
        enhancementQuotesByItem,
        feeRate,
        reusableOutputFraction,
        postInitialRequirementFraction,
    });
    return {
        available: ledger.available,
        actionHrid: action?.hrid,
        actionName: action?.name,
        actionSortIndex: finiteNumber(action?.sortIndex, 0),
        skillHrid,
        skillLevel,
        completionCount,
        requiredCompletionCount,
        drinkWindowLimited: (
            Number.isFinite(drinkStartWindow)
            && (suppliedStartWindow == null || drinkStartWindow <= suppliedStartWindow + EPSILON)
            && completionCount < requiredCompletionCount
        ),
        renewableDrinkHrids,
        gainedExperience,
        experiencePerAction,
        experiencePerHour: experiencePerAction * actionsPerHour,
        actionsPerHour,
        actionSeconds,
        durationHours,
        netCost: ledger.netCost,
        costPerExperience: ledger.netCost / gainedExperience,
        opportunityCost: ledger.opportunityCost,
        purchaseCost: ledger.purchaseCost,
        outputValue: ledger.outputValue,
        inputItems: ledger.inputRows,
        outputItems: ledger.outputRows,
        reusableInventoryOutputHrids: Object.keys(outputItems),
        missingPriceHrids: ledger.missingPriceHrids,
        inventoryDelta: ledger.inventoryDelta,
        consumedEquipment: ledger.consumedEquipment,
        producedEquipment: ledger.producedEquipment,
        equipment: (equipmentLoadout?.items || []).map((item) => ({
            id: item.id,
            itemHrid: item.itemHrid,
            equipmentType: item.equipmentType,
            enhancementLevel: item.enhancementLevel,
            isEquipped: item.isEquipped,
        })),
        equipmentChanges: finiteNumber(equipmentLoadout?.equipmentChanges, 0),
        drinkSlots: integer(equipmentLoadout?.drinkSlots, 1),
        drinkConcentration: equipmentConcentrationMultiplier - 1,
        drinks: drinkRows,
        endingDrinkState: Object.keys(endingDrinkItemsByHrid).length > 0 ? {
            itemsByHrid: endingDrinkItemsByHrid,
        } : null,
        bonuses,
    };
}

function compareCandidates(left, right) {
    const costDelta = finiteNumber(left?.costPerExperience, Infinity) - finiteNumber(right?.costPerExperience, Infinity);
    if (Math.abs(costDelta) > EPSILON) return costDelta;
    const experienceDelta = finiteNumber(right?.experiencePerHour, 0) - finiteNumber(left?.experiencePerHour, 0);
    if (Math.abs(experienceDelta) > EPSILON) return experienceDelta;
    const purchaseDelta = finiteNumber(left?.purchaseCost, Infinity) - finiteNumber(right?.purchaseCost, Infinity);
    if (Math.abs(purchaseDelta) > EPSILON) return purchaseDelta;
    const changeDelta = finiteNumber(left?.equipmentChanges, Infinity) - finiteNumber(right?.equipmentChanges, Infinity);
    if (Math.abs(changeDelta) > EPSILON) return changeDelta;
    return finiteNumber(left?.actionSortIndex, 0) - finiteNumber(right?.actionSortIndex, 0)
        || String(left?.actionHrid || "").localeCompare(String(right?.actionHrid || ""))
        || String(left?.drinks?.map((drink) => drink.itemHrid).join("|") || "")
            .localeCompare(String(right?.drinks?.map((drink) => drink.itemHrid).join("|") || ""));
}

function stableOwnedInputCycleLimit(candidate, inventory, equipmentInstances) {
    if ((candidate?.consumedEquipment || []).length > 0) return 1;
    const equipmentHrids = new Set((equipmentInstances || [])
        .map((item) => normalizeHrid(item?.itemHrid))
        .filter(Boolean));
    const inputsByHrid = new Map();
    for (const row of candidate?.inputItems || []) {
        const itemHrid = normalizeHrid(row?.itemHrid);
        if (!itemHrid) continue;
        const totals = inputsByHrid.get(itemHrid) || { count: 0, ownedCount: 0, purchaseCount: 0 };
        totals.count += Math.max(0, finiteNumber(row?.count, 0));
        totals.ownedCount += Math.max(0, finiteNumber(row?.ownedCount, 0));
        totals.purchaseCount += Math.max(0, finiteNumber(row?.purchaseCount, 0));
        inputsByHrid.set(itemHrid, totals);
    }

    let limit = Infinity;
    for (const [itemHrid, totals] of inputsByHrid) {
        if (totals.ownedCount <= EPSILON) continue;
        if (equipmentHrids.has(itemHrid)) return 1;
        const sameItemOutputCount = (candidate?.outputItems || [])
            .filter((row) => normalizeHrid(row?.itemHrid) === itemHrid)
            .reduce((sum, row) => sum + Math.max(0, finiteNumber(row?.count, 0)), 0);
        const outputCanBeReused = (candidate?.reusableInventoryOutputHrids || []).includes(itemHrid);
        if (totals.purchaseCount > EPSILON) {
            const endingDelta = finiteNumber(candidate?.inventoryDelta?.[itemHrid], 0);
            if (outputCanBeReused && sameItemOutputCount > EPSILON && Math.abs(endingDelta) <= EPSILON) continue;
            return 1;
        }
        const availableCount = Math.max(0, finiteNumber(inventory?.[itemHrid], 0));
        let cyclesBeforeDepletion;
        if (outputCanBeReused && sameItemOutputCount >= totals.count - EPSILON) {
            cyclesBeforeDepletion = Infinity;
        } else if (outputCanBeReused && sameItemOutputCount > EPSILON) {
            const netConsumption = totals.count - sameItemOutputCount;
            cyclesBeforeDepletion = Math.floor(
                Math.max(0, availableCount - totals.count + EPSILON) / netConsumption,
            ) + 1;
        } else {
            cyclesBeforeDepletion = Math.floor(
                (availableCount + EPSILON) / Math.max(EPSILON, totals.count),
            );
        }
        limit = Math.min(limit, Math.max(1, cyclesBeforeDepletion));
    }
    return limit;
}

function drinkRenewalMode(candidate, itemHrid) {
    const rows = (candidate?.inputItems || []).filter((row) => (
        normalizeHrid(row?.itemHrid) === itemHrid
    ));
    const ownedCount = rows.reduce((sum, row) => sum + Math.max(0, finiteNumber(row?.ownedCount, 0)), 0);
    const purchaseCount = rows.reduce((sum, row) => sum + Math.max(0, finiteNumber(row?.purchaseCount, 0)), 0);
    if (ownedCount <= EPSILON && purchaseCount > EPSILON) {
        return { source: "purchased", stable: true, requiresEmptyInventory: true };
    }
    if (ownedCount <= EPSILON) {
        return { source: "none", stable: false, requiresEmptyInventory: false };
    }
    const matchingMarginalPrices = rows.every((row) => {
        if (finiteNumber(row?.ownedCount, 0) <= EPSILON) return true;
        const purchaseUnitPrice = Number(row?.purchaseUnitPrice);
        return Number.isFinite(purchaseUnitPrice)
            && Math.abs(finiteNumber(row?.opportunityUnitPrice, 0) - purchaseUnitPrice) <= EPSILON;
    });
    return {
        source: purchaseCount > EPSILON ? "mixed" : "owned",
        stable: matchingMarginalPrices,
        requiresEmptyInventory: false,
    };
}

function evaluateLevelOptions({
    actions,
    profile,
    skillHrid,
    skillLevel,
    skillLevels,
    experienceNeeded,
    inventory,
    priceTable,
    enhancementQuotesByItem,
    data,
    externalBonuses,
    activeBuffUniqueHrids,
    activeImportedDrinkSlotCount = 0,
    drinkState,
    actionStartWindowSeconds,
    renewDrinkHrids = [],
    inventoryReuseCompletionInterval = null,
    feeRate,
    collectAlternatives = false,
}) {
    const requiredActiveDrinkHrids = new Set(
        activeDrinkStateItems(drinkState).map((item) => item.itemHrid),
    );
    const ownedEquipmentHrids = new Set((profile?.equipment || [])
        .map((item) => normalizeHrid(item?.itemHrid))
        .filter(Boolean));
    const equipmentLoadoutCache = new Map();
    function equipmentLoadoutsForAction(action) {
        const reservationSensitiveHrids = new Set([
            ...(action?.inputItems || []).map((item) => normalizeHrid(item?.itemHrid)),
            normalizeHrid(action?.upgradeItemHrid),
        ].filter((itemHrid) => itemHrid && ownedEquipmentHrids.has(itemHrid)));
        const cacheKey = Array.from(reservationSensitiveHrids).sort().join("|");
        if (!equipmentLoadoutCache.has(cacheKey)) {
            equipmentLoadoutCache.set(cacheKey, buildSkillingEquipmentLoadouts(
                profile,
                skillHrid,
                skillLevels,
                data,
                inventory,
                reservationSensitiveHrids,
            ));
        }
        return equipmentLoadoutCache.get(cacheKey);
    }
    const drinkCache = new Map();
    const alternatives = [];
    const missingPriceHrids = new Set();
    let best = null;
    for (const action of actions) {
        const equipmentLoadouts = equipmentLoadoutsForAction(action);
        for (const equipmentLoadout of equipmentLoadouts) {
            const slotCount = Math.max(1, integer(equipmentLoadout?.drinkSlots, 1));
            const availableSlotCount = slotCount - Math.max(0, integer(activeImportedDrinkSlotCount, 0));
            if (availableSlotCount < 0) continue;
            if (!drinkCache.has(availableSlotCount)) {
                drinkCache.set(availableSlotCount, buildDrinkLoadouts(
                    data,
                    actionTypeForSkill(skillHrid),
                    availableSlotCount,
                    activeBuffUniqueHrids,
                ));
            }
            for (const drinkLoadout of drinkCache.get(availableSlotCount)) {
                const selectedDrinkHrids = new Set(
                    drinkLoadout.map((drink) => normalizeHrid(drink?.hrid)).filter(Boolean),
                );
                if (Array.from(requiredActiveDrinkHrids).some((itemHrid) => !selectedDrinkHrids.has(itemHrid))) {
                    continue;
                }
                const candidate = calculateSkillingActionCandidate({
                    action,
                    skillHrid,
                    skillLevel,
                    experienceNeeded,
                    inventory,
                    equipmentInstances: profile?.equipment || [],
                    equipmentLoadout,
                    drinkLoadout,
                    drinkState,
                    externalBonuses,
                    actionStartWindowSeconds,
                    renewDrinkHrids,
                    inventoryReuseCompletionInterval,
                    priceTable,
                    enhancementQuotesByItem,
                    feeRate,
                });
                if (!candidate) {
                    continue;
                }
                if (!candidate.available) {
                    candidate.missingPriceHrids.forEach((hrid) => missingPriceHrids.add(hrid));
                    continue;
                }
                if (!best || compareCandidates(candidate, best) < 0) {
                    best = candidate;
                }
                if (collectAlternatives) alternatives.push(candidate);
            }
        }
    }
    alternatives.sort(compareCandidates);
    return {
        best,
        alternatives: alternatives.slice(0, 25),
        missingPriceHrids: Array.from(missingPriceHrids).sort(),
        equipmentLoadoutCount: Array.from(equipmentLoadoutCache.values())
            .reduce((count, loadouts) => count + loadouts.length, 0),
    };
}

function skillLevelForExperience(experience, minimumLevel, table = levelExperienceTable) {
    let level = clamp(integer(minimumLevel, 1), 1, table.length - 1);
    while (level < table.length - 1 && finiteNumber(table[level + 1], Infinity) <= experience + EPSILON) {
        level += 1;
    }
    return level;
}

function sameSegmentStrategy(left, right) {
    return left?.actionHrid === right?.actionHrid
        && left?.equipmentSignature === right?.equipmentSignature
        && left?.drinkSignature === right?.drinkSignature
        && left?.bonusSignature === right?.bonusSignature;
}

function mergeRows(leftRows, rightRows, fields) {
    const byHrid = new Map();
    for (const row of [...(leftRows || []), ...(rightRows || [])]) {
        const itemHrid = normalizeHrid(row?.itemHrid);
        if (!itemHrid) continue;
        const key = row?.enhancementLevel == null
            ? itemHrid
            : `${itemHrid}@${Math.max(0, integer(row.enhancementLevel, 0))}`;
        if (!byHrid.has(key)) byHrid.set(key, { ...row });
        else {
            const target = byHrid.get(key);
            for (const field of fields) target[field] = finiteNumber(target[field], 0) + finiteNumber(row?.[field], 0);
        }
    }
    return Array.from(byHrid.values());
}

function candidateToSegment(candidate, fromLevel, toLevel) {
    const equipmentSignature = candidate.equipment.map((item) => `${item.equipmentType}:${item.itemHrid}:${item.enhancementLevel}`).join("|");
    const drinkSignature = candidate.drinks.map((item) => item.itemHrid).join("|");
    const bonusSignature = Object.keys(createBonusTotals())
        .map((key) => finiteNumber(candidate?.bonuses?.[key], 0).toFixed(12))
        .join("|");
    return {
        ...candidate,
        fromLevel,
        toLevel,
        equipmentSignature,
        drinkSignature,
        bonusSignature,
    };
}

function mergeSegment(target, addition) {
    target.toLevel = addition.toLevel;
    target.completionCount += addition.completionCount;
    target.gainedExperience += addition.gainedExperience;
    target.durationHours += addition.durationHours;
    target.netCost += addition.netCost;
    target.opportunityCost += addition.opportunityCost;
    target.purchaseCost += addition.purchaseCost;
    target.outputValue += addition.outputValue;
    target.costPerExperience = target.netCost / target.gainedExperience;
    target.experiencePerHour = target.gainedExperience / target.durationHours;
    target.inputItems = mergeRows(target.inputItems, addition.inputItems, [
        "count", "ownedCount", "purchaseCount", "opportunityCost", "purchaseCost",
    ]);
    target.outputItems = mergeRows(target.outputItems, addition.outputItems, ["count", "liquidationValue"]);
    target.drinks = mergeRows(target.drinks, addition.drinks, ["count"]);
    target.endingDrinkState = addition.endingDrinkState;
    return target;
}

function skillLevelsForSegment(profile, skillHrid, startLevel, segmentLevel) {
    const result = {};
    for (const [hrid, skill] of Object.entries(profile?.skills || {})) {
        result[hrid] = { level: Math.max(1, integer(skill?.level, 1)) };
    }
    result[skillHrid] = { level: segmentLevel };
    const baseTotal = Math.max(1, integer(profile?.skills?.["/skills/total_level"]?.level, 1));
    result["/skills/total_level"] = { level: baseTotal + Math.max(0, segmentLevel - startLevel) };
    return result;
}

export function createDefaultSkillingTargets(profile, data = defaultSkillingData) {
    return Object.fromEntries((data?.skillHrids || []).map((skillHrid) => {
        const currentLevel = clamp(integer(profile?.skills?.[skillHrid]?.level, 1), 1, SKILLING_MAX_LEVEL);
        return [skillHrid, Math.min(SKILLING_MAX_LEVEL, currentLevel + 1)];
    }));
}

function summarizeSkillingSegments(segments) {
    const totals = (segments || []).reduce((result, segment) => ({
        netCost: result.netCost + finiteNumber(segment?.netCost, 0),
        purchaseCost: result.purchaseCost + finiteNumber(segment?.purchaseCost, 0),
        opportunityCost: result.opportunityCost + finiteNumber(segment?.opportunityCost, 0),
        outputValue: result.outputValue + finiteNumber(segment?.outputValue, 0),
        durationHours: result.durationHours + finiteNumber(segment?.durationHours, 0),
        experience: result.experience + finiteNumber(segment?.gainedExperience, 0),
    }), { netCost: 0, purchaseCost: 0, opportunityCost: 0, outputValue: 0, durationHours: 0, experience: 0 });
    return {
        totalNetCost: totals.netCost,
        totalPurchaseCost: totals.purchaseCost,
        totalOpportunityCost: totals.opportunityCost,
        totalOutputValue: totals.outputValue,
        totalDurationHours: totals.durationHours,
        totalExperience: totals.experience,
        costPerExperience: totals.experience > 0 ? totals.netCost / totals.experience : 0,
        experiencePerHour: totals.durationHours > 0 ? totals.experience / totals.durationHours : 0,
    };
}

export function planSkillingSkill({
    profile,
    skillHrid,
    targetLevel,
    priceTable,
    enhancementQuotesByItem = {},
    data = defaultSkillingData,
    feeRate = SKILLING_MARKET_FEE_RATE,
    now = Date.now(),
    onProgress = () => {},
}) {
    const skill = profile?.skills?.[skillHrid] || { level: 1, experience: null };
    const startLevel = clamp(integer(skill?.level, 1), 1, SKILLING_MAX_LEVEL);
    const normalizedTarget = clamp(integer(targetLevel, startLevel + 1), startLevel, SKILLING_MAX_LEVEL);
    const startThreshold = finiteNumber(levelExperienceTable[startLevel], 0);
    const targetExperience = finiteNumber(levelExperienceTable[normalizedTarget], startThreshold);
    let currentExperience = Number.isFinite(Number(skill?.experience))
        ? clamp(Number(skill.experience), startThreshold, targetExperience)
        : startThreshold;
    let currentLevel = skillLevelForExperience(currentExperience, startLevel);
    let equipmentInstances = createPlanningEquipmentInstances(profile);
    let inventory = createPlanningInventory(profile, equipmentInstances);
    let drinkState = null;
    const segments = [];
    const missingPriceHrids = new Set();
    let alternatives = [];
    const actionsForSkill = (data?.actions || []).filter((action) => action?.levelRequirement?.skillHrid === skillHrid);
    const actionTypeHrid = actionTypeForSkill(skillHrid);
    const planningStartedAt = finiteNumber(now, Date.now());
    let planningNow = planningStartedAt;
    const initialExternal = collectSkillingProfileBonuses(profile, actionTypeHrid, skillHrid, planningStartedAt);
    const expiredBuffCount = initialExternal.expiredBuffCount;
    let iteration = 0;
    let previousDrinkCycle = null;

    if (normalizedTarget <= startLevel || currentExperience >= targetExperience - EPSILON) {
        return {
            status: "complete",
            skillHrid,
            startLevel,
            targetLevel: normalizedTarget,
            startExperience: currentExperience,
            targetExperience,
            segments: [],
            alternatives: [],
            totalNetCost: 0,
            totalPurchaseCost: 0,
            totalOpportunityCost: 0,
            totalOutputValue: 0,
            totalDurationHours: 0,
            totalExperience: 0,
            costPerExperience: 0,
            experiencePerHour: 0,
            missingPriceHrids: [],
            expiredBuffCount: 0,
            endingInventory: inventory,
            endingEquipment: equipmentInstances,
        };
    }

    while (currentExperience < targetExperience - EPSILON) {
        currentLevel = skillLevelForExperience(currentExperience, currentLevel);
        const nextLevel = Math.min(normalizedTarget, currentLevel + 1);
        const nextThreshold = finiteNumber(levelExperienceTable[nextLevel], targetExperience);
        const experienceNeeded = Math.max(EPSILON, nextThreshold - currentExperience);
        const availableActions = actionsForSkill.filter((action) => finiteNumber(action?.levelRequirement?.level, 1) <= currentLevel);
        const external = iteration === 0
            ? initialExternal
            : collectSkillingProfileBonuses(profile, actionTypeHrid, skillHrid, planningNow);
        const externalStartWindowSeconds = external.nextExpirationAt == null
            ? null
            : Math.max(0, (external.nextExpirationAt - planningNow) / 1000);
        const activeImportedDrinkSlotCount = countActiveImportedDrinkSlots(
            profile,
            actionTypeHrid,
            external.activeUniqueHrids,
            data,
        );
        const evaluationInput = {
            actions: availableActions,
            profile: { ...profile, equipment: equipmentInstances },
            skillHrid,
            skillLevel: currentLevel,
            skillLevels: skillLevelsForSegment(profile, skillHrid, startLevel, currentLevel),
            experienceNeeded,
            inventory,
            priceTable,
            enhancementQuotesByItem,
            data,
            externalBonuses: external.totals,
            activeBuffUniqueHrids: external.activeUniqueHrids,
            activeImportedDrinkSlotCount,
            drinkState,
            actionStartWindowSeconds: externalStartWindowSeconds,
            feeRate,
            collectAlternatives: iteration === 0,
        };
        const evaluation = evaluateLevelOptions(evaluationInput);
        if (iteration === 0) {
            alternatives = evaluation.alternatives;
        }
        if (!evaluation.best) {
            evaluation.missingPriceHrids.forEach((hrid) => missingPriceHrids.add(hrid));
            return {
                status: "blocked",
                skillHrid,
                startLevel,
                targetLevel: normalizedTarget,
                startExperience: Number(skill?.experience ?? startThreshold),
                targetExperience,
                currentLevel,
                currentExperience,
                segments,
                alternatives,
                ...summarizeSkillingSegments(segments),
                missingPriceHrids: Array.from(missingPriceHrids).sort(),
                expiredBuffCount,
                endingInventory: inventory,
                endingEquipment: equipmentInstances,
            };
        }

        let selected = evaluation.best;
        const selectedCycle = candidateToSegment(selected, currentLevel, currentLevel);
        const repeatedDrinkStrategy = (
            previousDrinkCycle?.level === currentLevel
            && sameSegmentStrategy(previousDrinkCycle.segment, selectedCycle)
        );
        const selectedDrinkHrids = new Set((selected.drinks || [])
            .map((drink) => normalizeHrid(drink?.itemHrid))
            .filter(Boolean));
        const renewableDrinkHridSet = new Set(selected.renewableDrinkHrids || []);
        const renewalModes = new Map(repeatedDrinkStrategy ? previousDrinkCycle.renewalModes : []);
        const currentlyRenewedDrinkHrids = new Set();
        if (repeatedDrinkStrategy) {
            for (const drink of selected.drinks || []) {
                const itemHrid = normalizeHrid(drink?.itemHrid);
                if (
                    itemHrid
                    && finiteNumber(drink?.count, 0) > EPSILON
                    && previousDrinkCycle.seenDrinkHrids.has(itemHrid)
                ) {
                    currentlyRenewedDrinkHrids.add(itemHrid);
                    renewalModes.set(itemHrid, drinkRenewalMode(selected, itemHrid));
                }
            }
        }
        const batchRenewDrinkHrids = [];
        let carriedOwnedRenewalCompletionLimit = Infinity;
        if (repeatedDrinkStrategy) {
            const actionIntervalSeconds = 3600 / Math.max(EPSILON, finiteNumber(selected.actionsPerHour, 0));
            for (const drink of selected.drinks || []) {
                const itemHrid = normalizeHrid(drink?.itemHrid);
                if (!itemHrid || !renewableDrinkHridSet.has(itemHrid)) continue;
                if (currentlyRenewedDrinkHrids.has(itemHrid)) {
                    batchRenewDrinkHrids.push(itemHrid);
                    continue;
                }
                const mode = renewalModes.get(itemHrid);
                const stableRenewal = mode?.stable === true
                    && (mode.requiresEmptyInventory !== true || finiteNumber(inventory?.[itemHrid], 0) <= EPSILON);
                if (stableRenewal) {
                    batchRenewDrinkHrids.push(itemHrid);
                    continue;
                }
                const ownedCount = Math.floor(Math.max(0, finiteNumber(inventory?.[itemHrid], 0)) + EPSILON);
                if (mode?.source !== "owned" || ownedCount <= 0) continue;
                const carriedCompletionCount = Math.max(
                    0,
                    Math.ceil(finiteNumber(drink?.carriedDurationSeconds, 0) / actionIntervalSeconds - EPSILON),
                );
                const completionCountPerDrink = Math.max(
                    1,
                    Math.ceil(finiteNumber(drink?.effectiveDurationSeconds, 0) / actionIntervalSeconds - EPSILON),
                );
                carriedOwnedRenewalCompletionLimit = Math.min(
                    carriedOwnedRenewalCompletionLimit,
                    carriedCompletionCount + ownedCount * completionCountPerDrink,
                );
                batchRenewDrinkHrids.push(itemHrid);
            }
        }
        if (
            selected.drinkWindowLimited === true
            && repeatedDrinkStrategy
            && batchRenewDrinkHrids.length > 0
        ) {
            const cycleCompletionCount = Math.max(1, integer(selected.completionCount, 1));
            const actionIntervalSeconds = 3600 / Math.max(EPSILON, finiteNumber(selected.actionsPerHour, 0));
            const renewedDrinkHridSet = new Set(batchRenewDrinkHrids);
            const hardWindowCompletionLimit = [
                evaluationInput.actionStartWindowSeconds,
                ...(selected.drinks || [])
                    .filter((drink) => !renewedDrinkHridSet.has(normalizeHrid(drink?.itemHrid)))
                    .map((drink) => (
                        finiteNumber(drink?.carriedDurationSeconds, 0) > EPSILON
                            ? finiteNumber(drink?.carriedDurationSeconds, 0)
                            : finiteNumber(drink?.effectiveDurationSeconds, 0)
                    )),
            ]
                .filter((seconds) => seconds != null && Number.isFinite(seconds))
                .map((seconds) => Math.max(1, Math.ceil(seconds / actionIntervalSeconds - EPSILON)))
                .reduce((minimum, count) => Math.min(minimum, count), Infinity);
            const fullCycleCount = Math.min(
                Math.floor(selected.requiredCompletionCount / cycleCompletionCount),
                stableOwnedInputCycleLimit(selected, inventory, equipmentInstances),
                Math.floor(carriedOwnedRenewalCompletionLimit / cycleCompletionCount),
                Math.floor(hardWindowCompletionLimit / cycleCompletionCount),
            );
            const fullCycleCompletionCount = fullCycleCount * cycleCompletionCount;
            if (fullCycleCount > 1) {
                const batchEvaluation = evaluateLevelOptions({
                    ...evaluationInput,
                    experienceNeeded: fullCycleCompletionCount * selected.experiencePerAction,
                    renewDrinkHrids: batchRenewDrinkHrids,
                    inventoryReuseCompletionInterval: cycleCompletionCount,
                    collectAlternatives: false,
                });
                const batchCycle = batchEvaluation.best
                    ? candidateToSegment(batchEvaluation.best, currentLevel, currentLevel)
                    : null;
                if (
                    batchCycle
                    && sameSegmentStrategy(selectedCycle, batchCycle)
                    && batchEvaluation.best.completionCount > selected.completionCount
                    && batchEvaluation.best.completionCount % cycleCompletionCount === 0
                ) {
                    selected = batchEvaluation.best;
                }
            }
        }
        inventory = applyInventoryDelta(inventory, selected.inventoryDelta);
        drinkState = selected.endingDrinkState;
        equipmentInstances = applyPlanningEquipmentChanges({
            equipmentInstances,
            consumedEquipment: selected.consumedEquipment,
            producedEquipment: selected.producedEquipment,
            selectedEquipment: selected.equipment,
            data,
            iteration,
        });
        planningNow += selected.durationHours * 60 * 60 * 1000;
        currentExperience += selected.gainedExperience;
        const reachedLevel = skillLevelForExperience(currentExperience, currentLevel);
        const segment = candidateToSegment(selected, currentLevel, Math.min(normalizedTarget, reachedLevel));
        const previous = segments[segments.length - 1];
        if (previous && sameSegmentStrategy(previous, segment)) mergeSegment(previous, segment);
        else segments.push(segment);
        previousDrinkCycle = selected.drinkWindowLimited === true
            ? {
                level: currentLevel,
                segment,
                seenDrinkHrids: selectedDrinkHrids,
                renewalModes,
            }
            : null;
        iteration += 1;
        onProgress({
            skillHrid,
            currentLevel: reachedLevel,
            targetLevel: normalizedTarget,
            progress: Math.min(1, (currentExperience - startThreshold) / Math.max(1, targetExperience - startThreshold)),
        });
        if (iteration > SKILLING_MAX_LEVEL * 4 + 100) {
            throw new Error("Skilling planner exceeded the level iteration limit.");
        }
    }

    return {
        status: "ok",
        skillHrid,
        startLevel,
        targetLevel: normalizedTarget,
        startExperience: Number(skill?.experience ?? startThreshold),
        targetExperience,
        segments,
        alternatives,
        ...summarizeSkillingSegments(segments),
        missingPriceHrids: Array.from(missingPriceHrids).sort(),
        expiredBuffCount,
        endingInventory: inventory,
        endingEquipment: equipmentInstances,
    };
}

export function buildSkillingOverview(plansBySkill) {
    return Object.values(plansBySkill || {})
        .filter((plan) => (
            plan?.status === "ok"
            && finiteNumber(plan?.totalExperience, 0) > EPSILON
            && Number.isFinite(Number(plan?.costPerExperience))
        ))
        .sort((left, right) => (
            finiteNumber(left?.costPerExperience, Infinity) - finiteNumber(right?.costPerExperience, Infinity)
            || finiteNumber(right?.experiencePerHour, 0) - finiteNumber(left?.experiencePerHour, 0)
            || String(left?.skillHrid || "").localeCompare(String(right?.skillHrid || ""))
        ));
}

export function planSkillingUpgrades({
    profile,
    targetLevels,
    priceTable,
    enhancementQuotesByItem = {},
    data = defaultSkillingData,
    feeRate = SKILLING_MARKET_FEE_RATE,
    now = Date.now(),
    onProgress = () => {},
}) {
    const skills = data?.skillHrids || [];
    const plansBySkill = {};
    skills.forEach((skillHrid, index) => {
        plansBySkill[skillHrid] = planSkillingSkill({
            profile,
            skillHrid,
            targetLevel: targetLevels?.[skillHrid],
            priceTable,
            enhancementQuotesByItem,
            data,
            feeRate,
            now,
            onProgress: (progress) => onProgress({
                ...progress,
                skillIndex: index,
                skillCount: skills.length,
                overallProgress: (index + finiteNumber(progress?.progress, 0)) / Math.max(1, skills.length),
            }),
        });
    });
    const overview = buildSkillingOverview(plansBySkill);
    return {
        generatedAt: now,
        plansBySkill,
        overview,
    };
}

export { compareCandidates, createBonusTotals };

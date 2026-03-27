import combatTriggerComparatorDetailMap from "../combatsimulator/data/combatTriggerComparatorDetailMap.json";
import combatTriggerConditionDetailMap from "../combatsimulator/data/combatTriggerConditionDetailMap.json";
import combatTriggerDependencyDetailMap from "../combatsimulator/data/combatTriggerDependencyDetailMap.json";
import Trigger from "../combatsimulator/trigger.js";
import { abilityDetailIndex, itemDetailIndex } from "../shared/gameDataIndex.js";

const MAX_TRIGGER_COUNT = 4;

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTriggerEntry(entry) {
    const source = entry && typeof entry === "object" ? entry : {};
    return {
        dependencyHrid: String(source.dependencyHrid || ""),
        conditionHrid: String(source.conditionHrid || ""),
        comparatorHrid: String(source.comparatorHrid || ""),
        value: toFiniteNumber(source.value, 0),
    };
}

function isConditionAllowedForDependency(conditionHrid, dependencyHrid) {
    const dependency = combatTriggerDependencyDetailMap[dependencyHrid];
    const condition = combatTriggerConditionDetailMap[conditionHrid];
    if (!dependency || !condition) {
        return false;
    }

    if (dependency.isSingleTarget) {
        return Boolean(condition.isSingleTarget);
    }

    return Boolean(condition.isMultiTarget);
}

function isComparatorAllowedForCondition(comparatorHrid, conditionHrid) {
    const condition = combatTriggerConditionDetailMap[conditionHrid];
    if (!condition) {
        return false;
    }

    return (condition.allowedComparatorHrids || []).includes(comparatorHrid);
}

function sanitizeTriggerList(list) {
    if (!Array.isArray(list)) {
        return [];
    }

    const normalized = [];
    for (const rawEntry of list.slice(0, MAX_TRIGGER_COUNT)) {
        const entry = normalizeTriggerEntry(rawEntry);
        if (!entry.dependencyHrid || !entry.conditionHrid || !entry.comparatorHrid) {
            continue;
        }

        if (!combatTriggerDependencyDetailMap[entry.dependencyHrid]) {
            continue;
        }
        if (!combatTriggerConditionDetailMap[entry.conditionHrid]) {
            continue;
        }
        if (!combatTriggerComparatorDetailMap[entry.comparatorHrid]) {
            continue;
        }
        if (!isConditionAllowedForDependency(entry.conditionHrid, entry.dependencyHrid)) {
            continue;
        }
        if (!isComparatorAllowedForCondition(entry.comparatorHrid, entry.conditionHrid)) {
            continue;
        }

        normalized.push(entry);
    }

    return normalized;
}

function sanitizeTriggerMap(rawTriggerMap) {
    const source = rawTriggerMap && typeof rawTriggerMap === "object" ? rawTriggerMap : {};
    const normalizedMap = {};

    for (const [targetHrid, triggerList] of Object.entries(source)) {
        const hrid = String(targetHrid || "");
        if (!hrid) {
            continue;
        }
        normalizedMap[hrid] = sanitizeTriggerList(triggerList);
    }

    return normalizedMap;
}

function getDefaultTriggerDtosForHrid(targetHrid) {
    const hrid = String(targetHrid || "");
    if (!hrid) {
        return [];
    }

    const itemDefaults = itemDetailIndex[hrid]?.defaultCombatTriggers;
    if (Array.isArray(itemDefaults)) {
        return sanitizeTriggerList(itemDefaults);
    }

    const abilityDefaults = abilityDetailIndex[hrid]?.defaultCombatTriggers;
    if (Array.isArray(abilityDefaults)) {
        return sanitizeTriggerList(abilityDefaults);
    }

    return [];
}

function ensureTriggerMapEntry(rawTriggerMap, targetHrid) {
    const hrid = String(targetHrid || "");
    if (!hrid) {
        return [];
    }

    const triggerMap = rawTriggerMap && typeof rawTriggerMap === "object" ? rawTriggerMap : {};
    if (!Object.prototype.hasOwnProperty.call(triggerMap, hrid)) {
        triggerMap[hrid] = getDefaultTriggerDtosForHrid(hrid);
    } else {
        triggerMap[hrid] = sanitizeTriggerList(triggerMap[hrid]);
    }

    return triggerMap[hrid];
}

function toTriggerInstances(triggerDtos) {
    return sanitizeTriggerList(triggerDtos).map((triggerDto) => Trigger.createFromDTO(triggerDto));
}

function getTriggerDependencies() {
    return Object.values(combatTriggerDependencyDetailMap)
        .sort((a, b) => Number(a.sortIndex ?? 0) - Number(b.sortIndex ?? 0))
        .map((dependency) => ({
            hrid: dependency.hrid,
            name: dependency.name,
            isSingleTarget: Boolean(dependency.isSingleTarget),
            isMultiTarget: !dependency.isSingleTarget,
        }));
}

function getTriggerConditionsForDependency(dependencyHrid) {
    const dependency = combatTriggerDependencyDetailMap[String(dependencyHrid || "")];
    if (!dependency) {
        return [];
    }

    const conditions = Object.values(combatTriggerConditionDetailMap).filter((condition) => (
        dependency.isSingleTarget ? Boolean(condition.isSingleTarget) : Boolean(condition.isMultiTarget)
    ));

    return conditions
        .sort((a, b) => Number(a.sortIndex ?? 0) - Number(b.sortIndex ?? 0))
        .map((condition) => ({
            hrid: condition.hrid,
            name: condition.name,
            allowedComparatorHrids: Array.isArray(condition.allowedComparatorHrids) ? condition.allowedComparatorHrids : [],
        }));
}

function getTriggerComparatorsForCondition(conditionHrid) {
    const condition = combatTriggerConditionDetailMap[String(conditionHrid || "")];
    if (!condition) {
        return [];
    }

    return (condition.allowedComparatorHrids || [])
        .map((comparatorHrid) => combatTriggerComparatorDetailMap[comparatorHrid])
        .filter(Boolean)
        .sort((a, b) => Number(a.sortIndex ?? 0) - Number(b.sortIndex ?? 0))
        .map((comparator) => ({
            hrid: comparator.hrid,
            name: comparator.name,
            allowValue: Boolean(comparator.allowValue),
        }));
}

function isComparatorValueRequired(comparatorHrid) {
    return Boolean(combatTriggerComparatorDetailMap[String(comparatorHrid || "")]?.allowValue);
}

export {
    MAX_TRIGGER_COUNT,
    deepClone,
    ensureTriggerMapEntry,
    getDefaultTriggerDtosForHrid,
    getTriggerComparatorsForCondition,
    getTriggerConditionsForDependency,
    getTriggerDependencies,
    isComparatorValueRequired,
    sanitizeTriggerList,
    sanitizeTriggerMap,
    toTriggerInstances,
};

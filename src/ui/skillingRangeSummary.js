const INPUT_SUM_FIELDS = Object.freeze([
    "count",
    "ownedCount",
    "purchaseCount",
    "opportunityCost",
    "purchaseCost",
]);
const OUTPUT_SUM_FIELDS = Object.freeze(["count", "liquidationValue"]);
const DRINK_SUM_FIELDS = Object.freeze(["count"]);
const TOTAL_FIELDS = Object.freeze([
    "completionCount",
    "gainedExperience",
    "durationHours",
    "netCost",
    "purchaseCost",
    "drinkPurchaseCost",
    "materialPurchaseCost",
    "opportunityCost",
    "outputValue",
    "equipmentChanges",
]);
const EPSILON = 1e-9;

function finiteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeHrid(value) {
    return String(value || "").trim();
}

function mergeRows(segments, rowKey, fields) {
    const rowsByItem = new Map();
    for (const segment of segments) {
        for (const row of Array.isArray(segment?.[rowKey]) ? segment[rowKey] : []) {
            const itemHrid = normalizeHrid(row?.itemHrid);
            if (!itemHrid) continue;
            const key = row?.enhancementLevel == null
                ? itemHrid
                : `${itemHrid}@${Math.max(0, Math.trunc(finiteNumber(row.enhancementLevel, 0)))}`;
            if (!rowsByItem.has(key)) {
                rowsByItem.set(key, { ...row });
                continue;
            }
            const target = rowsByItem.get(key);
            for (const field of fields) {
                target[field] = finiteNumber(target[field], 0) + finiteNumber(row?.[field], 0);
            }
        }
    }
    return Array.from(rowsByItem.values());
}

function recalculateUnitPrices(rows, rules) {
    for (const row of rows) {
        for (const { costField, countField, unitField } of rules) {
            const count = finiteNumber(row?.[countField], 0);
            if (count > EPSILON) row[unitField] = finiteNumber(row?.[costField], 0) / count;
        }
    }
    return rows;
}

function equipmentSignature(source) {
    if (source?.equipmentSignature != null) return String(source.equipmentSignature);
    return (Array.isArray(source?.equipment) ? source.equipment : [])
        .map((item) => (
            `${item?.equipmentType || ""}:${item?.itemHrid || ""}:${finiteNumber(item?.enhancementLevel, 0)}`
        ))
        .join("|");
}

function equipmentStrategiesForSegment(segment) {
    if (Array.isArray(segment?.equipmentStrategies)) {
        return segment.equipmentStrategies.map((strategy) => ({
            ...strategy,
            equipment: (Array.isArray(strategy?.equipment) ? strategy.equipment : [])
                .map((item) => ({ ...item })),
        }));
    }
    return [{
        equipmentSignature: equipmentSignature(segment),
        equipment: (Array.isArray(segment?.equipment) ? segment.equipment : [])
            .map((item) => ({ ...item })),
        completionCount: finiteNumber(segment?.completionCount, 0),
        durationHours: finiteNumber(segment?.durationHours, 0),
        gainedExperience: finiteNumber(segment?.gainedExperience, 0),
        fromLevel: segment?.fromLevel,
        toLevel: segment?.toLevel,
    }];
}

function collectEquipmentStrategies(segments) {
    const result = [];
    for (const strategy of segments.flatMap(equipmentStrategiesForSegment)) {
        const signature = equipmentSignature(strategy);
        const previous = result[result.length - 1];
        if (previous && previous.equipmentSignature === signature) {
            previous.completionCount += finiteNumber(strategy?.completionCount, 0);
            previous.durationHours += finiteNumber(strategy?.durationHours, 0);
            previous.gainedExperience += finiteNumber(strategy?.gainedExperience, 0);
            previous.toLevel = strategy?.toLevel;
            continue;
        }
        result.push({
            ...strategy,
            equipmentSignature: signature,
            equipment: (Array.isArray(strategy?.equipment) ? strategy.equipment : [])
                .map((item) => ({ ...item })),
            completionCount: finiteNumber(strategy?.completionCount, 0),
            durationHours: finiteNumber(strategy?.durationHours, 0),
            gainedExperience: finiteNumber(strategy?.gainedExperience, 0),
        });
    }
    return result;
}

function uniqueActionHrids(phases) {
    const seen = new Set();
    const result = [];
    for (const phase of phases) {
        const actionHrid = normalizeHrid(phase?.actionHrid);
        if (!actionHrid || seen.has(actionHrid)) continue;
        seen.add(actionHrid);
        result.push(actionHrid);
    }
    return result;
}

function optionLevel(value, fallback) {
    if (value == null || typeof value === "boolean" || String(value).trim() === "") return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildSkillingRangeSummary(segments, options = {}) {
    const sourceSegments = Array.isArray(segments) ? segments.filter(Boolean) : [];
    if (!sourceSegments.length) return null;

    const first = sourceSegments[0];
    const last = sourceSegments[sourceSegments.length - 1];
    const phases = sourceSegments.map((segment) => ({ ...segment }));
    const totals = Object.fromEntries(TOTAL_FIELDS.map((field) => [
        field,
        sourceSegments.reduce((sum, segment) => sum + finiteNumber(segment?.[field], 0), 0),
    ]));
    const actionHrids = uniqueActionHrids(phases);
    const finalPhase = phases[phases.length - 1];

    return {
        ...first,
        ...totals,
        isRangeSummary: true,
        fromLevel: optionLevel(options?.startLevel, first?.fromLevel),
        toLevel: optionLevel(options?.targetLevel, last?.toLevel),
        requiredCompletionCount: totals.completionCount,
        estimatedLevelDurationHours: totals.durationHours,
        costPerExperience: totals.gainedExperience > 0
            ? totals.netCost / totals.gainedExperience
            : 0,
        materialPurchaseCostPerExperience: totals.gainedExperience > 0
            ? totals.materialPurchaseCost / totals.gainedExperience
            : 0,
        experiencePerHour: totals.durationHours > 0
            ? totals.gainedExperience / totals.durationHours
            : 0,
        inputItems: recalculateUnitPrices(
            mergeRows(sourceSegments, "inputItems", INPUT_SUM_FIELDS),
            [
                {
                    costField: "opportunityCost",
                    countField: "ownedCount",
                    unitField: "opportunityUnitPrice",
                },
                {
                    costField: "purchaseCost",
                    countField: "purchaseCount",
                    unitField: "purchaseUnitPrice",
                },
            ],
        ),
        outputItems: recalculateUnitPrices(
            mergeRows(sourceSegments, "outputItems", OUTPUT_SUM_FIELDS),
            [{
                costField: "liquidationValue",
                countField: "count",
                unitField: "liquidationUnitPrice",
            }],
        ),
        drinks: mergeRows(sourceSegments, "drinks", DRINK_SUM_FIELDS),
        actionHrids,
        phases,
        phaseCount: phases.length,
        equipmentStrategies: collectEquipmentStrategies(sourceSegments),
        endingDrinkState: finalPhase?.endingDrinkState ?? last?.endingDrinkState ?? null,
    };
}

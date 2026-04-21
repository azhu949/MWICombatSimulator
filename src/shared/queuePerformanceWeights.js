function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function roundQueueWeight(value, fallback = 0) {
    const numericValue = toFiniteNumber(value, fallback);
    return Math.max(0, Math.round((numericValue + Number.EPSILON) * 10) / 10);
}

function clampQueueWeight(value, fallback = 0) {
    return Math.min(1, Math.max(0, toFiniteNumber(value, fallback)));
}

function sanitizeQueueWeight(value, fallback = 0) {
    return Math.max(0, toFiniteNumber(value, fallback));
}

function allocateNormalizedQueueWeightUnits(source = {}) {
    const entries = [
        {
            key: "weightProfit",
            exactUnits: Math.max(0, toFiniteNumber(source?.weightProfit, 0)) * 10,
        },
        {
            key: "weightXp",
            exactUnits: Math.max(0, toFiniteNumber(source?.weightXp, 0)) * 10,
        },
    ].map((entry) => ({
        ...entry,
        units: Math.floor(entry.exactUnits),
        fraction: entry.exactUnits - Math.floor(entry.exactUnits),
    }));

    let remainingUnits = Math.max(0, 10 - entries.reduce((sum, entry) => sum + entry.units, 0));
    const rankedEntries = [...entries].sort((left, right) => (
        right.fraction - left.fraction
        || right.exactUnits - left.exactUnits
        || left.key.localeCompare(right.key)
    ));

    while (remainingUnits > 0) {
        for (const entry of rankedEntries) {
            if (remainingUnits <= 0) {
                break;
            }
            entry.units += 1;
            remainingUnits -= 1;
        }
    }

    const unitsByKey = Object.fromEntries(rankedEntries.map((entry) => [entry.key, entry.units]));
    return {
        weightProfit: clampQueueWeight(unitsByKey.weightProfit / 10, 0),
        weightXp: clampQueueWeight(unitsByKey.weightXp / 10, 0),
    };
}

function normalizeQueuePriorityWeights(source = {}, defaults = {}) {
    const fallbackProfit = roundQueueWeight(defaults?.weightProfit, 0.5);
    const fallbackXp = roundQueueWeight(defaults?.weightXp, 0.3);
    let rawWeightProfit = sanitizeQueueWeight(source?.weightProfit, fallbackProfit);
    let rawWeightXp = sanitizeQueueWeight(source?.weightXp, fallbackXp);
    const roundedWeightProfit = roundQueueWeight(rawWeightProfit, fallbackProfit);
    const roundedWeightXp = roundQueueWeight(rawWeightXp, fallbackXp);
    const prioritizedWeightSum = roundedWeightProfit + roundedWeightXp;

    if (prioritizedWeightSum > 1) {
        const divisor = rawWeightProfit + rawWeightXp || 1;
        rawWeightProfit /= divisor;
        rawWeightXp /= divisor;

        return allocateNormalizedQueueWeightUnits({
            weightProfit: rawWeightProfit,
            weightXp: rawWeightXp,
        });
    }

    return {
        weightProfit: clampQueueWeight(roundedWeightProfit, fallbackProfit),
        weightXp: clampQueueWeight(roundedWeightXp, fallbackXp),
    };
}

export function constrainEditedQueuePerformanceWeights(source = {}, editedKey = "", defaults = {}) {
    const fallbackProfit = roundQueueWeight(defaults?.weightProfit, 0.5);
    const fallbackXp = roundQueueWeight(defaults?.weightXp, 0.3);
    let weightProfit = roundQueueWeight(source?.weightProfit, fallbackProfit);
    let weightXp = roundQueueWeight(source?.weightXp, fallbackXp);

    if (editedKey === "weightProfit") {
        const maxProfit = roundQueueWeight(Math.max(0, 1 - weightXp), 0);
        weightProfit = Math.min(weightProfit, maxProfit);
    } else if (editedKey === "weightXp") {
        const maxXp = roundQueueWeight(Math.max(0, 1 - weightProfit), 0);
        weightXp = Math.min(weightXp, maxXp);
    } else {
        return normalizeQueuePriorityWeights({ weightProfit, weightXp }, defaults);
    }

    return {
        weightProfit: clampQueueWeight(weightProfit, 0),
        weightXp: clampQueueWeight(weightXp, 0),
    };
}

export function resolveQueuePerformanceSubweights(source = {}, defaults = {}) {
    const { weightProfit, weightXp } = normalizeQueuePriorityWeights(source, defaults);
    const weightDeathSafety = Math.max(0, 1 - (weightProfit + weightXp));
    const weightDps = weightDeathSafety / 2;
    const weightKills = weightDeathSafety / 2;

    return {
        weightProfit,
        weightXp,
        weightDeathSafety,
        weightDps,
        weightKills,
        byMetric: {
            dps: weightDps,
            dailyNoRngProfit: weightProfit,
            xpPerHour: weightXp,
            killsPerHour: weightKills,
        },
    };
}

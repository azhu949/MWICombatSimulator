const COMPACT_AMOUNT_UNITS = Object.freeze([
    Object.freeze({ divisor: 1, suffix: "" }),
    Object.freeze({ divisor: 1_000, suffix: "K" }),
    Object.freeze({ divisor: 1_000_000, suffix: "M" }),
    Object.freeze({ divisor: 1_000_000_000, suffix: "B" }),
]);

function amountUnit(unit) {
    const suffix = String(unit || "").trim().toUpperCase();
    return COMPACT_AMOUNT_UNITS.find((entry) => entry.suffix === suffix && suffix) || null;
}

export function convertAmountToBaseUnits(value, unit) {
    const numeric = Number(value);
    const resolvedUnit = amountUnit(unit);
    const result = resolvedUnit ? numeric * resolvedUnit.divisor : Number.NaN;
    return Number.isFinite(result) ? result : null;
}

export function convertAmountFromBaseUnits(value, unit) {
    const numeric = Number(value);
    const resolvedUnit = amountUnit(unit);
    const result = resolvedUnit ? numeric / resolvedUnit.divisor : Number.NaN;
    return Number.isFinite(result) ? result : null;
}

export function formatCompactAmount(value, options = {}) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return "—";
    }

    const absolute = Math.abs(numeric);
    let unitIndex = 0;
    for (let index = 1; index < COMPACT_AMOUNT_UNITS.length; index += 1) {
        if (absolute >= COMPACT_AMOUNT_UNITS[index].divisor) {
            unitIndex = index;
        }
    }

    let unit = COMPACT_AMOUNT_UNITS[unitIndex];
    let scaled = numeric / unit.divisor;
    if (
        unitIndex > 0
        && unitIndex < COMPACT_AMOUNT_UNITS.length - 1
        && Math.abs(Number(scaled.toFixed(2))) >= 1_000
    ) {
        unitIndex += 1;
        unit = COMPACT_AMOUNT_UNITS[unitIndex];
        scaled = numeric / unit.divisor;
    }

    const formatter = new Intl.NumberFormat(options.locale || "en-US", {
        maximumFractionDigits: 2,
        minimumFractionDigits: 0,
    });
    const suffix = options.unitCase === "lower" ? unit.suffix.toLowerCase() : unit.suffix;
    return `${formatter.format(scaled)}${suffix}`;
}

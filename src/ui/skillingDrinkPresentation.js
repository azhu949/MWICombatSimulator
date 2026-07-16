const EPSILON = 1e-9;

function nonnegativeNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function buildSkillingDrinkStatuses(segment) {
    const endingItems = segment?.endingDrinkState?.itemsByHrid;
    const hasEndingItems = endingItems != null && typeof endingItems === "object";
    const phases = Array.isArray(segment?.phases) ? segment.phases : [];
    return (Array.isArray(segment?.drinks) ? segment.drinks : [])
        .map((drink) => {
            const itemHrid = String(drink?.itemHrid || "").trim();
            if (!itemHrid) return null;
            const consumedCount = nonnegativeNumber(drink?.count);
            const carriedDurationSeconds = nonnegativeNumber(drink?.carriedDurationSeconds);
            const finalStateKnown = hasEndingItems
                && Object.prototype.hasOwnProperty.call(endingItems, itemHrid);
            const phaseLifecycleKnown = phases.some((phase) => (
                (Array.isArray(phase?.drinks) && phase.drinks.some((item) => (
                    String(item?.itemHrid || "").trim() === itemHrid
                )))
                || Object.prototype.hasOwnProperty.call(
                    phase?.endingDrinkState?.itemsByHrid || {},
                    itemHrid,
                )
            ));
            const endingKnown = finalStateKnown || phaseLifecycleKnown;
            const remainingSeconds = finalStateKnown
                ? nonnegativeNumber(endingItems[itemHrid]?.remainingSeconds)
                : 0;
            return {
                itemHrid,
                consumedCount,
                continued: carriedDurationSeconds > EPSILON,
                endingKnown,
                remainingSeconds,
                usedUp: endingKnown
                    && remainingSeconds <= EPSILON
                    && (consumedCount > EPSILON || carriedDurationSeconds > EPSILON),
            };
        })
        .filter(Boolean);
}

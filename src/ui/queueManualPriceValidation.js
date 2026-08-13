const DEFAULT_UNIT_MULTIPLIER = 1000;

export function normalizeManualPriceDraft(rawValue) {
    const raw = String(rawValue ?? "");
    const normalized = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    const containsLetters = /\p{L}/u.test(raw);
    return { normalized, containsLetters };
}

export function evaluateManualPriceDraft(draftValue, unitMultiplier = DEFAULT_UNIT_MULTIPLIER) {
    const draftNumber = Number(draftValue);
    const actualPrice = draftNumber * unitMultiplier;
    const valid =
        Number.isSafeInteger(draftNumber) &&
        draftNumber > 0 &&
        Number.isSafeInteger(actualPrice);
    return { valid, draftNumber, actualPrice };
}

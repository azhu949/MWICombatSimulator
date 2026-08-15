export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function clampPositiveInteger(value, fallback = 0) {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed) || parsed < 0) {
        return fallback;
    }
    return parsed;
}

export function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

export function isPlainObject(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function formatAdvisorCompactValue(value) {
    const numeric = toFiniteNumber(value, 0);
    const absolute = Math.abs(numeric);
    const sign = numeric < 0 ? "-" : "";

    if (absolute >= 1_000_000) {
        return `${sign}${(absolute / 1_000_000).toFixed(2)}M`;
    }
    if (absolute >= 1_000) {
        return `${sign}${(absolute / 1_000).toFixed(2)}K`;
    }
    return `${sign}${absolute.toFixed(2)}`;
}

export function formatAdvisorDailyProfitValue(profitPerHour) {
    return formatAdvisorCompactValue(toFiniteNumber(profitPerHour, 0) * 24);
}

import guildBuffDetailMap from "../combatsimulator/data/guildBuffDetailMap.json";
import guildShrineDetailMap from "../combatsimulator/data/guildShrineDetailMap.json";

function toLevel(value, maxLevel) {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 0;
    }
    return Math.min(parsed, Math.max(0, Number(maxLevel) || 0));
}

export const guildBuffDetailIndex = guildBuffDetailMap || {};
export const guildShrineDetailIndex = guildShrineDetailMap || {};

export const combatGuildBuffDetails = Object.freeze(
    Object.values(guildBuffDetailIndex)
        .filter((detail) => detail?.isCombat === true && String(detail?.hrid || ""))
        .sort((left, right) => Number(left?.sortIndex || 0) - Number(right?.sortIndex || 0))
);

export const combatGuildBuffHrids = Object.freeze(
    combatGuildBuffDetails.map((detail) => String(detail.hrid))
);

export function getGuildBuffMaxLevel(guildBuffHrid) {
    const detail = guildBuffDetailIndex?.[String(guildBuffHrid || "")];
    if (!detail || detail.isCombat !== true) {
        return 0;
    }

    const shrineMaxLevel = Number(guildShrineDetailIndex?.[detail.shrineHrid]?.maxLevel || 0);
    const costMaxLevel = Math.max(0, ...Object.keys(detail.levelCosts || {}).map((level) => Number(level) || 0));
    return Math.max(0, Math.min(shrineMaxLevel || costMaxLevel, costMaxLevel || shrineMaxLevel));
}

export function normalizeGuildBuffLevels(rawLevels, fallbackLevels = {}) {
    const source = rawLevels && typeof rawLevels === "object" && !Array.isArray(rawLevels)
        ? rawLevels
        : {};
    const fallback = fallbackLevels && typeof fallbackLevels === "object" && !Array.isArray(fallbackLevels)
        ? fallbackLevels
        : {};

    return Object.fromEntries(combatGuildBuffHrids.map((guildBuffHrid) => {
        const maxLevel = getGuildBuffMaxLevel(guildBuffHrid);
        const rawValue = Object.prototype.hasOwnProperty.call(source, guildBuffHrid)
            ? source[guildBuffHrid]
            : fallback[guildBuffHrid];
        return [guildBuffHrid, toLevel(rawValue?.level ?? rawValue, maxLevel)];
    }));
}

export function getGuildShrineName(shrineHrid, fallback = "") {
    const normalizedHrid = String(shrineHrid || "");
    return String(guildShrineDetailIndex?.[normalizedHrid]?.name || fallback || normalizedHrid);
}

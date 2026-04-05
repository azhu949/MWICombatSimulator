import communityBuffTypeDetailMap from "../combatsimulator/data/communityBuffTypeDetailMap.json";

const DEFAULT_START_TIME = "0001-01-01T00:00:00Z";
const COMMUNITY_EXPERIENCE_HRID = "/community_buff_types/experience";
const COMMUNITY_COMBAT_DROP_HRID = "/community_buff_types/combat_drop_quantity";

const MOO_PASS_BUFF_TEMPLATE = Object.freeze({
    uniqueHrid: "/buff_uniques/experience_moo_pass_buff",
    typeHrid: "/buff_types/wisdom",
    ratioBoost: 0,
    ratioBoostLevelBonus: 0,
    flatBoost: 0.05,
    flatBoostLevelBonus: 0,
    startTime: DEFAULT_START_TIME,
    duration: 0,
});

const COMMUNITY_BUFF_FALLBACKS = Object.freeze({
    [COMMUNITY_EXPERIENCE_HRID]: Object.freeze({
        uniqueHrid: "/buff_uniques/experience_community_buff",
        typeHrid: "/buff_types/wisdom",
        ratioBoost: 0,
        ratioBoostLevelBonus: 0,
        flatBoost: 0.2,
        flatBoostLevelBonus: 0.005,
        startTime: DEFAULT_START_TIME,
        duration: 0,
    }),
    [COMMUNITY_COMBAT_DROP_HRID]: Object.freeze({
        uniqueHrid: "/buff_uniques/combat_community_buff",
        typeHrid: "/buff_types/combat_drop_quantity",
        ratioBoost: 0,
        ratioBoostLevelBonus: 0,
        flatBoost: 0.2,
        flatBoostLevelBonus: 0.005,
        startTime: DEFAULT_START_TIME,
        duration: 0,
    }),
});

function toNonNegativeNumber(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 0;
    }

    return parsed;
}

function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function hasBuffTemplateShape(template) {
    return Boolean(
        template
        && typeof template === "object"
        && typeof template.uniqueHrid === "string"
        && template.uniqueHrid
        && typeof template.typeHrid === "string"
        && template.typeHrid
    );
}

function buildBuffFromTemplate(template, level = 1) {
    if (!hasBuffTemplateShape(template)) {
        return null;
    }

    const normalizedLevel = Math.max(1, toFiniteNumber(level, 1));
    const ratioBoost = toFiniteNumber(template.ratioBoost, 0)
        + toFiniteNumber(template.ratioBoostLevelBonus, 0) * (normalizedLevel - 1);
    const flatBoost = toFiniteNumber(template.flatBoost, 0)
        + toFiniteNumber(template.flatBoostLevelBonus, 0) * (normalizedLevel - 1);

    return {
        uniqueHrid: template.uniqueHrid,
        typeHrid: template.typeHrid,
        ratioBoost,
        ratioBoostLevelBonus: 0,
        flatBoost,
        flatBoostLevelBonus: 0,
        startTime: typeof template.startTime === "string" && template.startTime
            ? template.startTime
            : DEFAULT_START_TIME,
        duration: Math.max(0, toFiniteNumber(template.duration, 0)),
    };
}

function resolveCommunityBuffTemplate(communityBuffHrid) {
    const officialTemplate = communityBuffTypeDetailMap?.[communityBuffHrid]?.buff;
    if (hasBuffTemplateShape(officialTemplate)) {
        return officialTemplate;
    }

    return COMMUNITY_BUFF_FALLBACKS[communityBuffHrid] ?? null;
}

function buildCommunityBuff(communityBuffHrid, level) {
    return buildBuffFromTemplate(resolveCommunityBuffTemplate(communityBuffHrid), level);
}

export function normalizeSimulationExtra(extra = {}) {
    return {
        mooPass: Boolean(extra?.mooPass),
        comExp: toNonNegativeNumber(extra?.comExp),
        comDrop: toNonNegativeNumber(extra?.comDrop),
    };
}

export function buildSimulationExtraBuffs(extra = {}) {
    const normalizedExtra = normalizeSimulationExtra(extra);
    const extraBuffs = [];

    if (normalizedExtra.mooPass) {
        extraBuffs.push(buildBuffFromTemplate(MOO_PASS_BUFF_TEMPLATE, 1));
    }

    if (normalizedExtra.comExp > 0) {
        extraBuffs.push(buildCommunityBuff(COMMUNITY_EXPERIENCE_HRID, normalizedExtra.comExp));
    }

    if (normalizedExtra.comDrop > 0) {
        extraBuffs.push(buildCommunityBuff(COMMUNITY_COMBAT_DROP_HRID, normalizedExtra.comDrop));
    }

    return extraBuffs.filter(Boolean);
}

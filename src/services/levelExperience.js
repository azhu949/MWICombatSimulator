import levelExperienceTable from "../combatsimulator/data/levelExperienceTable.json";

function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

const SKILL_LEVEL_EXPERIENCE_TABLE = Object.freeze(
    (Array.isArray(levelExperienceTable) ? levelExperienceTable : [])
        .map((value) => toFiniteNumber(value, 0))
);

const MIN_SKILL_LEVEL = 1;
const MAX_SKILL_LEVEL = SKILL_LEVEL_EXPERIENCE_TABLE.length - 1;

export function getMaxSkillLevelWithExperienceTable() {
    return MAX_SKILL_LEVEL;
}

export function getSkillLevelExperience(level) {
    const normalizedLevel = Math.floor(toFiniteNumber(level, -1));
    if (normalizedLevel < MIN_SKILL_LEVEL || normalizedLevel > MAX_SKILL_LEVEL) {
        return null;
    }

    const xpValue = Number(SKILL_LEVEL_EXPERIENCE_TABLE[normalizedLevel]);
    return Number.isFinite(xpValue) ? xpValue : null;
}

export function calculateSkillUpgradeEta({ currentLevel, currentExperience, targetLevel, xpPerHour }) {
    const normalizedCurrentLevel = Math.max(MIN_SKILL_LEVEL, Math.floor(toFiniteNumber(currentLevel, MIN_SKILL_LEVEL)));
    const normalizedTargetLevel = Math.floor(toFiniteNumber(targetLevel, normalizedCurrentLevel));

    if (normalizedTargetLevel <= normalizedCurrentLevel) {
        return {
            status: "not_applicable",
        };
    }

    const levelStartExperience = getSkillLevelExperience(normalizedCurrentLevel);
    const targetExperience = getSkillLevelExperience(normalizedTargetLevel);
    if (!Number.isFinite(levelStartExperience) || !Number.isFinite(targetExperience)) {
        return {
            status: "target_out_of_range",
        };
    }

    if (currentExperience == null || currentExperience === "") {
        return {
            status: "missing_current_experience",
        };
    }
    const rawCurrentExperience = Number(currentExperience);
    if (!Number.isFinite(rawCurrentExperience)) {
        return {
            status: "missing_current_experience",
        };
    }

    if (xpPerHour == null || xpPerHour === "") {
        return {
            status: "missing_xp_rate",
        };
    }
    const normalizedXpPerHour = Number(xpPerHour);
    if (!Number.isFinite(normalizedXpPerHour)) {
        return {
            status: "missing_xp_rate",
        };
    }
    if (normalizedXpPerHour <= 0) {
        return {
            status: "zero_xp_rate",
        };
    }

    const effectiveCurrentExperience = Math.max(levelStartExperience, Math.min(rawCurrentExperience, targetExperience));
    const xpNeeded = Math.max(0, targetExperience - effectiveCurrentExperience);
    const hoursNeeded = xpNeeded / normalizedXpPerHour;

    return {
        status: "ok",
        currentLevel: normalizedCurrentLevel,
        currentExperience: effectiveCurrentExperience,
        targetLevel: normalizedTargetLevel,
        targetExperience,
        xpNeeded,
        xpPerHour: normalizedXpPerHour,
        hoursNeeded,
    };
}

export {
    SKILL_LEVEL_EXPERIENCE_TABLE,
    MIN_SKILL_LEVEL,
    MAX_SKILL_LEVEL,
};

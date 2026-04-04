function toNonNegativeNumber(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 0;
    }

    return parsed;
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
        extraBuffs.push({
            uniqueHrid: "/buff_uniques/experience_moo_pass_buff",
            typeHrid: "/buff_types/wisdom",
            ratioBoost: 0,
            ratioBoostLevelBonus: 0,
            flatBoost: 0.05,
            flatBoostLevelBonus: 0,
            startTime: "0001-01-01T00:00:00Z",
            duration: 0,
        });
    }

    if (normalizedExtra.comExp > 0) {
        extraBuffs.push({
            uniqueHrid: "/buff_uniques/experience_community_buff",
            typeHrid: "/buff_types/wisdom",
            ratioBoost: 0,
            ratioBoostLevelBonus: 0,
            flatBoost: 0.005 * (normalizedExtra.comExp - 1) + 0.2,
            flatBoostLevelBonus: 0,
            startTime: "0001-01-01T00:00:00Z",
            duration: 0,
        });
    }

    if (normalizedExtra.comDrop > 0) {
        extraBuffs.push({
            uniqueHrid: "/buff_uniques/combat_community_buff",
            typeHrid: "/buff_types/combat_drop_quantity",
            ratioBoost: 0,
            ratioBoostLevelBonus: 0,
            flatBoost: 0.005 * (normalizedExtra.comDrop - 1) + 0.2,
            flatBoostLevelBonus: 0,
            startTime: "0001-01-01T00:00:00Z",
            duration: 0,
        });
    }

    return extraBuffs;
}

class Buff {
    startTime;

    constructor(buff, level = 1) {
        this.uniqueHrid = buff.uniqueHrid;
        this.typeHrid = buff.typeHrid;
        this.ratioBoost = buff.ratioBoost + (level - 1) * buff.ratioBoostLevelBonus;
        this.flatBoost = buff.flatBoost + (level - 1) * buff.flatBoostLevelBonus;
        this.duration = buff.duration;
        this.multiplierForSkillHrid = buff.multiplierForSkillHrid ?? "";
        this.multiplierPerSkillLevel = buff.multiplierPerSkillLevel ?? 0;
    }

    static createFromDTO(dto) {
        let buff = Object.create(Buff.prototype);

        buff.uniqueHrid = dto?.uniqueHrid ?? "";
        buff.typeHrid = dto?.typeHrid ?? "";
        buff.ratioBoost = Number(dto?.ratioBoost ?? 0);
        buff.flatBoost = Number(dto?.flatBoost ?? 0);
        buff.duration = Number(dto?.duration ?? 0);
        buff.startTime = dto?.startTime ?? null;
        buff.multiplierForSkillHrid = dto?.multiplierForSkillHrid ?? "";
        buff.multiplierPerSkillLevel = Number(dto?.multiplierPerSkillLevel ?? 0);

        return buff;
    }
}

export default Buff;

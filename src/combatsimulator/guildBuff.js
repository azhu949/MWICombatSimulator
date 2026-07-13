import Buff from "./buff";
import {
    getGuildBuffMaxLevel,
    guildBuffDetailIndex,
} from "../shared/guildBuffs.js";

class GuildBuff {
    constructor(hrid, level) {
        const detail = guildBuffDetailIndex?.[hrid];
        if (!detail || detail.isCombat !== true) {
            throw new Error("No combat guild buff found for hrid: " + hrid);
        }

        this.hrid = hrid;
        this.level = Math.min(
            Math.max(0, Math.floor(Number(level) || 0)),
            getGuildBuffMaxLevel(hrid)
        );
        this.buffs = this.level > 0
            ? (detail.buffs || []).map((buff) => new Buff(buff, this.level))
            : [];
    }

    static createFromDTO(dto) {
        if (Array.isArray(dto)) {
            return GuildBuff.createFromDTO({ hrid: dto[0], level: dto[1] });
        }

        const hrid = String(dto?.hrid || dto?.guildBuffHrid || "");
        const level = Number(dto?.level || 0);
        if (!hrid || level <= 0 || !guildBuffDetailIndex?.[hrid]?.isCombat) {
            return null;
        }

        if (Array.isArray(dto?.buffs)) {
            const guildBuff = Object.create(GuildBuff.prototype);
            guildBuff.hrid = hrid;
            guildBuff.level = Math.min(Math.floor(level), getGuildBuffMaxLevel(hrid));
            guildBuff.buffs = dto.buffs.map((buff) => Buff.createFromDTO(buff));
            return guildBuff;
        }

        return new GuildBuff(hrid, level);
    }
}

export default GuildBuff;

import Buff from "./buff";
import achievementTierDetailMap from "./data/achievementTierDetailMap.json";
import achievementDetailMap from "./data/achievementDetailMap.json";

class Achievement {
    constructor(achievements) {
        const unlockedAchievements = achievements && typeof achievements === "object" ? achievements : {};
        this.buffs = [];

        for(const tier of Object.values(achievementTierDetailMap)) {
            let isGetAll = true;
            let detailMap = Object.values(achievementDetailMap).filter((detail) => detail.tierHrid == tier.hrid)
            for(const achievement of Object.values(detailMap)) {
                if(!unlockedAchievements[achievement.hrid] || unlockedAchievements[achievement.hrid] == false) {
                    isGetAll = false;
                    break;
                }
            }
            if(isGetAll) {
                let buff = new Buff(tier.buff);
                this.buffs.push(buff);
            }
        }
    }

    static createFromDTO(dto) {
        if (Array.isArray(dto?.buffs)) {
            let achievement = Object.create(Achievement.prototype);
            achievement.buffs = dto.buffs.map((buff) => Buff.createFromDTO(buff));

            return achievement;
        }

        return new Achievement(dto);
    }
}

export default Achievement;

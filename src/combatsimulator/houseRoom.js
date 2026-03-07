import Buff from "./buff";
import houseRoomDetailMap from "./data/houseRoomDetailMap.json";

class HouseRoom {
    constructor(hrid, level) {
        this.hrid = hrid;
        this.level = level;

        let gameHouseRoom = houseRoomDetailMap[this.hrid];
        if (!gameHouseRoom) {
            throw new Error("No house room found for hrid: " + this.hrid);
        }

        this.buffs = [];
        if (gameHouseRoom.actionBuffs) {
            for (const actionBuff of gameHouseRoom.actionBuffs) {
                let buff = new Buff(actionBuff, level);
                this.buffs.push(buff);
            }
        }
        if (gameHouseRoom.globalBuffs) {
            for (const globalBuff of gameHouseRoom.globalBuffs) {
                let buff = new Buff(globalBuff, level);
                this.buffs.push(buff);
            }
        }
    }

    static createFromDTO(dto) {
        if (Array.isArray(dto)) {
            return HouseRoom.createFromDTO({
                hrid: dto[0],
                level: dto[1],
            });
        }

        const hrid = String(dto?.hrid ?? "");
        const level = Number(dto?.level ?? 0);
        if (!hrid || level <= 0) {
            return null;
        }

        return new HouseRoom(hrid, level);
    }
}

export default HouseRoom;

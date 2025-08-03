import CombatEvent from "./combatEvent";

class EnrageTickEvent extends CombatEvent {
    static type = "enrageTick";

    constructor(time, currentTick) {
        super(EnrageTickEvent.type, time);

        this.currentTick = currentTick;
    }
}

export default EnrageTickEvent;

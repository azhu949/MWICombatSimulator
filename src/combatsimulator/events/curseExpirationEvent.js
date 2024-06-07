import CombatEvent from "./combatEvent";

class CurseExpirationEvent extends CombatEvent {
    static type = "curseExpiration";

    constructor(time, source) {
        super(CurseExpirationEvent.type, time);

        this.source = source;
    }
}

export default CurseExpirationEvent;
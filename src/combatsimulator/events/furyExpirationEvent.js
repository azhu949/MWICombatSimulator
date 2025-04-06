import CombatEvent from "./combatEvent";

class FuryExpirationEvent extends CombatEvent {
    static type = "furyExpiration";

    constructor(time, source) {
        super(FuryExpirationEvent.type, time);
        
        this.source = source;
    }
}

export default FuryExpirationEvent;
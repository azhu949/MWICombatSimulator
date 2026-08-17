import CombatEvent from "./combatEvent";

/**
 * Wake-up event for a timed combat scroll.
 *
 * Deliberately does not set `source` or `target`: player death cleanup removes
 * unit-scoped events by those two fields, while a scroll's clock must continue
 * through death/respawn and dungeon restarts.
 */
class ScrollRenewalEvent extends CombatEvent {
    static type = "scrollRenewal";

    constructor(time, playerHrid, itemHrid, token = 0) {
        super(ScrollRenewalEvent.type, time);
        this.playerHrid = String(playerHrid || "");
        this.itemHrid = String(itemHrid || "");
        this.token = Number.isFinite(Number(token)) ? Number(token) : 0;
    }
}

export default ScrollRenewalEvent;

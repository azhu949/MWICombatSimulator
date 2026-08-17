import { getCombatScrollBuffTemplate } from "../shared/combatScrolls.js";
import Buff from "./buff.js";

/**
 * Create the simulator's mutable Buff domain object from a shared scroll DTO.
 * Keeping this adapter in the simulator layer prevents shared catalog users
 * from depending on simulator classes. Combat scrolls are not levelled, so
 * the generic Buff constructor must always receive level 1.
 */
export function createCombatScrollBuff(itemHrid, options = undefined) {
    const template = getCombatScrollBuffTemplate(itemHrid, options);
    if (!template) {
        return null;
    }

    return new Buff(template, 1);
}

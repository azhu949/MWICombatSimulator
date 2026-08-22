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

/**
 * The buff source key that real party simulations use for combat scrolls.
 * Preview paths must register scroll buffs under the same key so source-level
 * removal and source-aware reconciliation stay consistent with the simulator.
 */
export function getCombatScrollSourceKey(itemHrid) {
    return `scroll:${itemHrid}`;
}

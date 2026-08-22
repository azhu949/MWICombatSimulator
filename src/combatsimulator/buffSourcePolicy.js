// Buff source selection is intentionally opt-in.  The combat engine historically
// used last-write-wins for runtime buffs; only the official party-aura buffs use
// strongest-source selection and source handoff.
import abilityDetailMap from "./data/abilityDetailMap.json";

export const BUFF_SOURCE_POLICY = Object.freeze({
    REPLACE: "replace",
    STRONGEST: "strongest",
});

export const PARTY_AURA_ABILITY_HRIDS = new Set([
    "/abilities/speed_aura",
    "/abilities/guardian_aura",
    "/abilities/fierce_aura",
    "/abilities/critical_aura",
    "/abilities/mystic_aura",
]);

// The official client-data snapshot currently defines every party aura as a
// non-negative boost in exactly one of these fields. Keep the strength field
// explicit per uniqueHrid: this avoids inventing a universal ordering rule for
// negative debuffs or for future buffs that mix ratio and flat values.
export const PARTY_AURA_STRENGTH_FIELDS = Object.freeze({
    "/buff_uniques/speed_aura_attack_speed": "ratioBoost",
    "/buff_uniques/speed_aura_cast_speed": "flatBoost",
    "/buff_uniques/guardian_aura_healing_amplify": "flatBoost",
    "/buff_uniques/guardian_aura_evasion": "ratioBoost",
    "/buff_uniques/guardian_aura_armor": "flatBoost",
    "/buff_uniques/guardian_aura_water_resistance": "flatBoost",
    "/buff_uniques/guardian_aura_nature_resistance": "flatBoost",
    "/buff_uniques/guardian_aura_fire_resistance": "flatBoost",
    "/buff_uniques/fierce_aura": "flatBoost",
    "/buff_uniques/critical_aura_rate": "flatBoost",
    "/buff_uniques/critical_aura_damage": "flatBoost",
    "/buff_uniques/mystic_aura_water_amplify": "flatBoost",
    "/buff_uniques/mystic_aura_nature_amplify": "flatBoost",
    "/buff_uniques/mystic_aura_fire_amplify": "flatBoost",
});

export const PARTY_AURA_BUFF_HRIDS = new Set(Object.keys(PARTY_AURA_STRENGTH_FIELDS));

// Extract the official party-aura buffs from the checked-in client-data
// snapshot. This mirrors the extraction used by the strong test in
// combatUnitBuffSources.test.js: a party aura is a buff effect with
// targetType "allAllies" on one of the official party-aura abilities.
function extractPartyAuraBuffsFromOfficialData() {
    const officialBuffs = [];
    for (const abilityHrid of PARTY_AURA_ABILITY_HRIDS) {
        const ability = abilityDetailMap[abilityHrid];
        if (!ability) {
            continue;
        }
        for (const effect of ability.abilityEffects ?? []) {
            if (effect?.effectType === "/ability_effect_types/buff" && effect?.targetType === "allAllies") {
                for (const buff of effect.buffs ?? []) {
                    officialBuffs.push(buff);
                }
            }
        }
    }
    return officialBuffs;
}

// Fail fast at module load when the official data snapshot drifts from the
// hardcoded strength-field table. A silent mismatch would otherwise degrade
// strongest-source arbitration to last-write-wins (new aura buffs) or crash
// mid-cast with a RangeError (changed buff shapes). Both failure modes are
// hard to diagnose at runtime; failing here with an explicit message turns a
// data-version bump into an immediate, actionable error.
//
// `officialBuffs` is injectable for tests that simulate data drift; production
// callers always use the checked-in snapshot via the default argument.
export function assertPartyAuraSnapshotMatchesOfficialData(officialBuffs = extractPartyAuraBuffsFromOfficialData()) {
    const officialHrids = officialBuffs.map((buff) => buff.uniqueHrid).sort();
    const snapshotHrids = Object.keys(PARTY_AURA_STRENGTH_FIELDS).sort();

    const missing = snapshotHrids.filter((hrid) => !officialHrids.includes(hrid));
    const unexpected = officialHrids.filter((hrid) => !snapshotHrids.includes(hrid));
    if (missing.length > 0 || unexpected.length > 0) {
        throw new Error(
            `Party aura buff snapshot drifted from the official data. ` +
                `Missing from official data: ${missing.join(", ") || "<none>"}. ` +
                `Unexpected in official data: ${unexpected.join(", ") || "<none>"}. ` +
                `Review PARTY_AURA_STRENGTH_FIELDS in buffSourcePolicy.js against the new data version.`,
        );
    }

    for (const buff of officialBuffs) {
        const strengthField = PARTY_AURA_STRENGTH_FIELDS[buff.uniqueHrid];
        const secondaryField = strengthField === "ratioBoost" ? "flatBoost" : "ratioBoost";
        if (buff[strengthField] < 0 || buff[secondaryField] !== 0) {
            throw new Error(
                `Party aura strength shape changed for ${buff.uniqueHrid}: ` +
                    `expected non-negative ${strengthField} with ${secondaryField} === 0, ` +
                    `got ${strengthField}=${buff[strengthField]}, ${secondaryField}=${buff[secondaryField]}. ` +
                    `Review PARTY_AURA_STRENGTH_FIELDS and getPartyAuraBuffStrength.`,
            );
        }
    }
}

assertPartyAuraSnapshotMatchesOfficialData();

export function getPartyAuraBuffStrength(buff) {
    const strengthField = PARTY_AURA_STRENGTH_FIELDS[buff?.uniqueHrid];
    if (!strengthField) {
        throw new TypeError(`Strongest-source policy is unsupported for ${buff?.uniqueHrid || "<unknown>"}`);
    }

    const secondaryField = strengthField === "ratioBoost" ? "flatBoost" : "ratioBoost";
    const strength = buff[strengthField];
    const secondaryValue = buff[secondaryField];
    if (!Number.isFinite(strength) || !Number.isFinite(secondaryValue)) {
        throw new TypeError(`Party aura boosts must be finite for ${buff.uniqueHrid}`);
    }
    if (strength < 0 || secondaryValue !== 0) {
        throw new RangeError(
            `Party aura strength shape changed for ${buff.uniqueHrid}; review the official data and comparator`,
        );
    }
    return strength;
}

export function isStrongerPartyAuraBuff(candidate, current) {
    if (!candidate) {
        return false;
    }

    const candidateStrength = getPartyAuraBuffStrength(candidate);
    if (!current) {
        return true;
    }
    if (candidate.uniqueHrid !== current.uniqueHrid) {
        throw new Error(`Cannot compare different party aura buffs: ${candidate.uniqueHrid} vs ${current.uniqueHrid}`);
    }
    return candidateStrength > getPartyAuraBuffStrength(current);
}

export function isPartyAuraBuff(buff) {
    return PARTY_AURA_BUFF_HRIDS.has(buff?.uniqueHrid);
}

export function getAbilityBuffSourcePolicy(ability, buff) {
    return PARTY_AURA_ABILITY_HRIDS.has(ability?.hrid) && isPartyAuraBuff(buff)
        ? BUFF_SOURCE_POLICY.STRONGEST
        : BUFF_SOURCE_POLICY.REPLACE;
}

import { BUFF_SOURCE_POLICY, getPartyAuraBuffStrength, isStrongerPartyAuraBuff } from "./buffSourcePolicy.js";

// Explicit sentinel for callers that need to target the currently active
// source. The default keeps omitted/undefined arguments backward-compatible.
export const REMOVE_ACTIVE_SOURCE = Symbol("remove-active-source");

// Strongest-source selection is used only by callers that explicitly opt in
// (currently the official party auras). The default runtime-buff policy stays
// compatible with the historical last-write-wins behavior.
function readFiniteBuffNumber(buff, fieldName) {
    const value = buff?.[fieldName];
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(
            `CombatUnit buff ${fieldName} must be a finite number for ${buff?.uniqueHrid || "<unknown>"}`,
        );
    }
    return value;
}

function readNonEmptyBuffHrid(buff, fieldName) {
    const value = buff?.[fieldName];
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new TypeError(`CombatUnit buff ${fieldName} must be a non-empty string`);
    }
    return value;
}

function cloneBuffForRegistration(buff, startTime) {
    // Runtime buffs are a flat scalar record today, but registration must not
    // share mutable nested state (arrays/objects) across sources. A deep clone
    // keeps every source fully isolated while preserving the old contract that
    // the caller-owned object is never mutated and every source gets its own
    // startTime.
    const cloned = structuredClone(buff);
    cloned.startTime = startTime;
    return cloned;
}

function pickStrongestBuffSource(sources) {
    let bestSourceKey = null;
    let bestEntry = null;
    // STRONGEST is currently restricted to official party-aura buffs. A single
    // aura has only the small, game-bounded number of party-member sources, so
    // an O(n) scan per reconciliation is intentional. If this policy expands
    // to large source sets, replace this with an indexed selection structure
    // and preserve the first-registered tie rule below.
    for (const [sourceKey, entry] of sources.entries()) {
        // Exact ratio/flat ties are intentionally not stronger.  Map iteration
        // therefore keeps the first registered source as a deterministic
        // fallback; this is not a claim that the latest caster should win.
        if (isStrongerPartyAuraBuff(entry.buff, bestEntry?.buff)) {
            bestSourceKey = sourceKey;
            bestEntry = entry;
        }
    }
    return bestEntry ? { sourceKey: bestSourceKey, ...bestEntry } : null;
}

// The single source of truth for which Buff fields affect the derived combat
// ratings. updateCombatDetails consumes runtime buffs only through
// getBuffBoosts(type), and buffsAffectStatsEqually decides whether a source
// handoff would change those ratings; both must agree on the exact field set.
// Keeping the projection here (instead of hardcoding the fields in both
// places) makes "comparison fields == consumption fields" structurally
// enforced: adding a consumed field in one place automatically updates the
// other. Buff construction must pre-apply ratioBoostLevelBonus/flatBoostLevelBonus
// into the effective ratioBoost/flatBoost values; the raw level-bonus fields
// are intentionally not part of the runtime comparison.
function projectBuffStats(buff) {
    return {
        uniqueHrid: buff.uniqueHrid,
        typeHrid: buff.typeHrid,
        ratioBoost: buff.ratioBoost,
        flatBoost: buff.flatBoost,
    };
}

// Two buffs affect the derived combat ratings identically when their projected
// stat fields match. A reference comparison alone would treat every addBuff
// refresh (which always creates a fresh registration copy) as a change and
// force a redundant full recompute even though the active values never moved.
export function buffsAffectStatsEqually(a, b) {
    if (a === b) {
        return true;
    }
    if (!a || !b) {
        return false;
    }
    const pa = projectBuffStats(a);
    const pb = projectBuffStats(b);
    return (
        pa.uniqueHrid === pb.uniqueHrid &&
        pa.typeHrid === pb.typeHrid &&
        pa.ratioBoost === pb.ratioBoost &&
        pa.flatBoost === pb.flatBoost
    );
}

function pickLatestBuffSource(sources) {
    let latestSourceKey = null;
    let latestEntry = null;
    for (const [sourceKey, entry] of sources.entries()) {
        if (!latestEntry || entry.sequence > latestEntry.sequence) {
            latestSourceKey = sourceKey;
            latestEntry = entry;
        }
    }
    return latestEntry ? { sourceKey: latestSourceKey, ...latestEntry } : null;
}

function pickActiveBuffSource(sources, policy, preferredSourceKey = null) {
    if (policy === BUFF_SOURCE_POLICY.STRONGEST) {
        return pickStrongestBuffSource(sources);
    }

    // Ordinary runtime buffs are last-write-wins. addBuff passes the source it
    // just wrote, so the hot path can select it in O(1). The scan remains only
    // as a defensive fallback for legacy/restored state with no hint.
    if (preferredSourceKey !== null && sources.has(preferredSourceKey)) {
        return { sourceKey: preferredSourceKey, ...sources.get(preferredSourceKey) };
    }
    return pickLatestBuffSource(sources);
}

function normalizeBuffSourcePolicy(policy) {
    if (policy === undefined || policy === null) {
        return BUFF_SOURCE_POLICY.REPLACE;
    }
    if (policy === BUFF_SOURCE_POLICY.REPLACE || policy === BUFF_SOURCE_POLICY.STRONGEST) {
        return policy;
    }
    throw new TypeError(`Unsupported buff source policy: ${policy}`);
}

class CombatUnit {
    isPlayer;
    isStunned = false;
    stunExpireTime = null;
    isBlinded = false;
    blindExpireTime = null;
    isSilenced = false;
    silenceExpireTime = null;

    isOutOfMana = false;

    // Base levels which don't change after initialization
    staminaLevel = 1;
    intelligenceLevel = 1;
    attackLevel = 1;
    meleeLevel = 1;
    defenseLevel = 1;
    rangedLevel = 1;
    magicLevel = 1;

    experience = 0;
    experienceRate = 0;
    enrageTime = 0;

    abilities = [null, null, null, null];
    food = [null, null, null];
    drinks = [null, null, null];
    houseRooms = [];
    guildBuffs = [];
    achievements = null;
    dropTable = [];
    rareDropTable = [];
    abilityManaCosts = new Map();

    // Calculated combat stats including temporary buffs
    combatDetails = {
        staminaLevel: 1,
        intelligenceLevel: 1,
        attackLevel: 1,
        meleeLevel: 1,
        defenseLevel: 1,
        rangedLevel: 1,
        magicLevel: 1,
        maxHitpoints: 110,
        currentHitpoints: 110,
        maxManapoints: 110,
        currentManapoints: 110,
        stabAccuracyRating: 11,
        slashAccuracyRating: 11,
        smashAccuracyRating: 11,
        rangedAccuracyRating: 11,
        magicAccuracyRating: 11,
        stabMaxDamage: 11,
        slashMaxDamage: 11,
        smashMaxDamage: 11,
        rangedMaxDamage: 11,
        magicMaxDamage: 11,
        stabEvasionRating: 11,
        slashEvasionRating: 11,
        smashEvasionRating: 11,
        rangedEvasionRating: 11,
        magicEvasionRating: 11,
        defensiveMaxDamage: 0,
        totalArmor: 0.2,
        totalWaterResistance: 0.4,
        totalNatureResistance: 0.4,
        totalFireResistance: 0.4,
        abilityHaste: 0,
        tenacity: 0,
        totalThreat: 100,
        combatStats: {
            combatStyleHrid: "/combat_styles/smash",
            damageType: "/damage_types/physical",
            attackInterval: 3000000000,
            autoAttackDamage: 0,
            abilityDamage: 0,
            criticalRate: 0,
            criticalDamage: 0,
            stabAccuracy: 0,
            slashAccuracy: 0,
            smashAccuracy: 0,
            rangedAccuracy: 0,
            magicAccuracy: 0,
            stabDamage: 0,
            slashDamage: 0,
            smashDamage: 0,
            rangedDamage: 0,
            magicDamage: 0,
            defensiveDamage: 0,
            taskDamage: 0,
            physicalAmplify: 0,
            waterAmplify: 0,
            natureAmplify: 0,
            fireAmplify: 0,
            healingAmplify: 0,
            physicalThorns: 0,
            elementalThorns: 0,
            maxHitpoints: 0,
            maxManapoints: 0,
            stabEvasion: 0,
            slashEvasion: 0,
            smashEvasion: 0,
            rangedEvasion: 0,
            magicEvasion: 0,
            armor: 0,
            waterResistance: 0,
            natureResistance: 0,
            fireResistance: 0,
            lifeSteal: 0,
            hpRegenPer10: 0.01,
            mpRegenPer10: 0.01,
            combatDropRate: 0,
            combatDropQuantity: 0,
            combatRareFind: 0,
            combatExperience: 0,
            foodSlots: 1,
            drinkSlots: 1,
            armorPenetration: 0,
            waterPenetration: 0,
            naturePenetration: 0,
            firePenetration: 0,
            manaLeech: 0,
            castSpeed: 0,
            threat: 100,
            parry: 0,
            mayhem: 0,
            pierce: 0,
            curse: 0,
            ripple: 0,
            bloom: 0,
            blaze: 0,
            weaken: 0,
            fury: 0,
            foodHaste: 0,
            drinkConcentration: 0,
            damageTaken: 0,
            attackSpeed: 0,
            armorDamageRatio: 0,
            hpDrainRatio: 0,
            primaryTraining: "",
            focusTraining: "",
            staminaExperience: 0,
            intelligenceExperience: 0,
            attackExperience: 0,
            defenseExperience: 0,
            meleeExperience: 0,
            rangedExperience: 0,
            magicExperience: 0,
            retaliation: 0,
            maxHitpointsRatio: 0,
            maxManapointsRatio: 0,
        },
    };
    // CombatUnit.updateCombatDetails mutates several combatStats while
    // applying derived values. Keep the last caller-provided base snapshot so
    // repeated recalculations start from the same inputs.
    //
    // IMPLICIT CONTRACT — read-only baseline, never write it externally:
    // 1. Direct external writes to combatDetails.combatStats.X are silently
    //    discarded on the next updateCombatDetails() (resetCombatStatsToBase
    //    restores this snapshot first). Route intended stat changes through
    //    addBuff/removeBuff or equipment changes instead.
    // 2. baseCombatStats itself is refreshed wholesale by refreshBaseCombatStats()
    //    (Player/Monster call it before super.updateCombatDetails()) and must
    //    never be mutated field-by-field from outside — a polluted baseline
    //    poisons every subsequent recalculation with no visible failure.
    // There is no external write conflict today; this contract exists so
    // future callers (simulation extensions, preview paths, UI hooks) do not
    // accidentally depend on direct stat mutation.
    baseCombatStats = null;
    combatBuffs = {};
    permanentBuffs = {};
    zoneBuffs = {};
    extraBuffs = {};
    // Maps buffUniqueHrid -> Map<sourceKey, { buff, expiresAt, sequence }>.
    // Source tracking supports exact removal/expiration for all runtime buffs.
    // Selection remains last-write-wins unless the caller explicitly opts the
    // buff into strongest-source semantics (the official party auras).
    buffSources = {};
    // Maps buffUniqueHrid -> sourceKey for the source currently represented in
    // combatBuffs.  Source identity is kept separately from the buff object so
    // handoff and removal do not depend on object reference equality.
    activeBuffSourceKeys = {};
    buffSourcePolicies = {};
    buffSourceSequence = 0;

    constructor() {}

    refreshBaseCombatStats() {
        // Capture the "clean" equipment-only stats as the recalculation
        // baseline.  See the baseCombatStats contract above: this snapshot is
        // read-only for external callers; mutate combatDetails.combatStats
        // through buffs or re-equipping, never by writing this object.
        this.baseCombatStats = { ...this.combatDetails.combatStats };
    }

    // refreshBaseCombatStats() MUST be called by every override (Player / Monster)
    // BEFORE super.updateCombatDetails() to capture the "clean" equipment-only
    // state. resetCombatStatsToBase() restores that clean snapshot so repeated
    // recalculations remain idempotent.
    resetCombatStatsToBase() {
        if (!this.baseCombatStats) {
            this.refreshBaseCombatStats();
        }
        Object.assign(this.combatDetails.combatStats, this.baseCombatStats);
    }

    updateCombatDetails() {
        this.resetCombatStatsToBase();

        if (this.isPlayer) {
            this.combatDetails.combatStats.hpRegenPer10 += 0.01;
            this.combatDetails.combatStats.mpRegenPer10 += 0.01;
        }

        ["stamina", "intelligence", "attack", "melee", "defense", "ranged", "magic"].forEach((stat) => {
            this.combatDetails[stat + "Level"] = this[stat + "Level"];
            let boosts = this.getBuffBoosts("/buff_types/" + stat + "_level");
            boosts.forEach((buff) => {
                this.combatDetails[stat + "Level"] += this[stat + "Level"] * buff.ratioBoost;
                this.combatDetails[stat + "Level"] += buff.flatBoost;
            });
        });

        const maxHitpointsBoost = this.getBuffBoost("/buff_types/max_hitpoints");
        const maxManapointsBoost = this.getBuffBoost("/buff_types/max_manapoints");
        this.combatDetails.maxHitpoints = Math.floor(
            (10 * (10 + this.combatDetails.staminaLevel) +
                this.combatDetails.combatStats.maxHitpoints +
                maxHitpointsBoost.flatBoost) *
                (1 + this.combatDetails.combatStats.maxHitpointsRatio + maxHitpointsBoost.ratioBoost),
        );
        this.combatDetails.maxManapoints = Math.floor(
            (10 * (10 + this.combatDetails.intelligenceLevel) +
                this.combatDetails.combatStats.maxManapoints +
                maxManapointsBoost.flatBoost) *
                (1 + this.combatDetails.combatStats.maxManapointsRatio + maxManapointsBoost.ratioBoost),
        );

        let accuracyRatioBoostFromFury = this.getBuffBoost("/buff_types/fury_accuracy").ratioBoost;
        let damageRatioBoostFromFury = this.getBuffBoost("/buff_types/fury_damage").ratioBoost;
        let accuracyRatioBoost = this.getBuffBoost("/buff_types/accuracy").ratioBoost;
        let damageRatioBoost = this.getBuffBoost("/buff_types/damage").ratioBoost;

        ["stab", "slash", "smash"].forEach((style) => {
            this.combatDetails[style + "AccuracyRating"] =
                (10 + this.combatDetails.attackLevel) *
                (1 + this.combatDetails.combatStats[style + "Accuracy"]) *
                (1 + accuracyRatioBoost) *
                (1 + accuracyRatioBoostFromFury);
            this.combatDetails[style + "MaxDamage"] =
                (10 + this.combatDetails.meleeLevel) *
                (1 + this.combatDetails.combatStats[style + "Damage"]) *
                (1 + damageRatioBoost) *
                (1 + damageRatioBoostFromFury);
            let baseEvasion =
                (10 + this.combatDetails.defenseLevel) * (1 + this.combatDetails.combatStats[style + "Evasion"]);
            this.combatDetails[style + "EvasionRating"] = baseEvasion;
            let evasionBoosts = this.getBuffBoosts("/buff_types/evasion");
            for (const boost of evasionBoosts) {
                this.combatDetails[style + "EvasionRating"] += boost.flatBoost;
                this.combatDetails[style + "EvasionRating"] += baseEvasion * boost.ratioBoost;
            }
        });

        this.combatDetails.defensiveMaxDamage =
            (10 + this.combatDetails.defenseLevel) *
            (1 + this.combatDetails.combatStats.defensiveDamage) *
            (1 + damageRatioBoost) *
            (1 + damageRatioBoostFromFury);

        // when equiped bulwark
        if (this.equipment?.["/equipment_types/two_hand"]?.hrid.includes("bulwark")) {
            this.combatDetails.smashMaxDamage += this.combatDetails.defensiveMaxDamage;
        }

        this.combatDetails.rangedAccuracyRating =
            (10 + this.combatDetails.attackLevel) *
            (1 + this.combatDetails.combatStats.rangedAccuracy) *
            (1 + accuracyRatioBoost) *
            (1 + accuracyRatioBoostFromFury);
        this.combatDetails.rangedMaxDamage =
            (10 + this.combatDetails.rangedLevel) *
            (1 + this.combatDetails.combatStats.rangedDamage) *
            (1 + damageRatioBoost) *
            (1 + damageRatioBoostFromFury);

        let baseRangedEvasion =
            (10 + this.combatDetails.defenseLevel) * (1 + this.combatDetails.combatStats.rangedEvasion);
        this.combatDetails.rangedEvasionRating = baseRangedEvasion;
        let evasionBoosts = this.getBuffBoosts("/buff_types/evasion");
        for (const boost of evasionBoosts) {
            this.combatDetails.rangedEvasionRating += boost.flatBoost;
            this.combatDetails.rangedEvasionRating += baseRangedEvasion * boost.ratioBoost;
        }

        this.combatDetails.combatStats.damageTaken = this.getBuffBoost("/buff_types/damage_taken").flatBoost;
        // if (this.combatDetails.combatStats.damageTaken > 0) {
        //     console.log("Damage taken: " + this.combatDetails.combatStats.damageTaken);
        // }

        this.combatDetails.magicAccuracyRating =
            (10 + this.combatDetails.attackLevel) *
            (1 + this.combatDetails.combatStats.magicAccuracy) *
            (1 + accuracyRatioBoost) *
            (1 + accuracyRatioBoostFromFury);
        this.combatDetails.magicMaxDamage =
            (10 + this.combatDetails.magicLevel) *
            (1 + this.combatDetails.combatStats.magicDamage) *
            (1 + damageRatioBoost) *
            (1 + damageRatioBoostFromFury);

        let baseMagicEvasion =
            (10 + this.combatDetails.defenseLevel) * (1 + this.combatDetails.combatStats.magicEvasion);
        this.combatDetails.magicEvasionRating = baseMagicEvasion;
        for (const boost of evasionBoosts) {
            this.combatDetails.magicEvasionRating += boost.flatBoost;
            this.combatDetails.magicEvasionRating += baseMagicEvasion * boost.ratioBoost;
        }

        this.combatDetails.combatStats.physicalAmplify += this.getBuffBoost("/buff_types/physical_amplify").flatBoost;
        this.combatDetails.combatStats.waterAmplify += this.getBuffBoost("/buff_types/water_amplify").flatBoost;
        this.combatDetails.combatStats.natureAmplify += this.getBuffBoost("/buff_types/nature_amplify").flatBoost;
        this.combatDetails.combatStats.fireAmplify += this.getBuffBoost("/buff_types/fire_amplify").flatBoost;
        this.combatDetails.combatStats.healingAmplify += this.getBuffBoost("/buff_types/healing_amplify").flatBoost;

        this.combatDetails.combatStats.attackInterval /= 1 + this.combatDetails.attackLevel / 2000;

        let baseAttackSpeed = this.combatDetails.combatStats.attackSpeed;
        this.combatDetails.combatStats.attackInterval /= 1 + baseAttackSpeed;
        let attackIntervalBoosts = this.getBuffBoosts("/buff_types/attack_speed");
        let attackIntervalRatioBoost = attackIntervalBoosts
            .map((boost) => boost.ratioBoost)
            .reduce((prev, cur) => prev + cur, 0);
        this.combatDetails.combatStats.attackInterval /= 1 + attackIntervalRatioBoost;

        let baseArmor = 0.2 * this.combatDetails.defenseLevel + this.combatDetails.combatStats.armor;
        this.combatDetails.totalArmor = baseArmor;
        let armorBoosts = this.getBuffBoosts("/buff_types/armor");
        for (const boost of armorBoosts) {
            this.combatDetails.totalArmor += boost.flatBoost;
            this.combatDetails.totalArmor += baseArmor * boost.ratioBoost;
        }

        let baseWaterResistance =
            0.2 * this.combatDetails.defenseLevel + this.combatDetails.combatStats.waterResistance;
        this.combatDetails.totalWaterResistance = baseWaterResistance;
        let waterResistanceBoosts = this.getBuffBoosts("/buff_types/water_resistance");
        for (const boost of waterResistanceBoosts) {
            this.combatDetails.totalWaterResistance += boost.flatBoost;
            this.combatDetails.totalWaterResistance += baseWaterResistance * boost.ratioBoost;
        }

        let baseNatureResistance =
            0.2 * this.combatDetails.defenseLevel + this.combatDetails.combatStats.natureResistance;
        this.combatDetails.totalNatureResistance = baseNatureResistance;
        let natureResistanceBoosts = this.getBuffBoosts("/buff_types/nature_resistance");
        for (const boost of natureResistanceBoosts) {
            this.combatDetails.totalNatureResistance += boost.flatBoost;
            this.combatDetails.totalNatureResistance += baseNatureResistance * boost.ratioBoost;
        }

        let baseFireResistance = 0.2 * this.combatDetails.defenseLevel + this.combatDetails.combatStats.fireResistance;
        this.combatDetails.totalFireResistance = baseFireResistance;
        let fireResistanceBoosts = this.getBuffBoosts("/buff_types/fire_resistance");
        for (const boost of fireResistanceBoosts) {
            this.combatDetails.totalFireResistance += boost.flatBoost;
            this.combatDetails.totalFireResistance += baseFireResistance * boost.ratioBoost;
        }

        let hpRegenBoosts = this.getBuffBoost("/buff_types/hp_regen");
        this.combatDetails.combatStats.hpRegenPer10 +=
            this.combatDetails.combatStats.hpRegenPer10 * hpRegenBoosts.ratioBoost;
        this.combatDetails.combatStats.hpRegenPer10 += hpRegenBoosts.flatBoost;

        let mpRegenBoosts = this.getBuffBoost("/buff_types/mp_regen");
        this.combatDetails.combatStats.mpRegenPer10 +=
            this.combatDetails.combatStats.mpRegenPer10 * mpRegenBoosts.ratioBoost;
        this.combatDetails.combatStats.mpRegenPer10 += mpRegenBoosts.flatBoost;

        this.combatDetails.combatStats.lifeSteal += this.getBuffBoost("/buff_types/life_steal").flatBoost;
        this.combatDetails.combatStats.physicalThorns += this.getBuffBoost("/buff_types/physical_thorns").flatBoost;
        this.combatDetails.combatStats.elementalThorns += this.getBuffBoost("/buff_types/elemental_thorns").flatBoost;
        this.combatDetails.combatStats.combatExperience += this.getBuffBoost("/buff_types/wisdom").flatBoost;
        this.combatDetails.combatStats.criticalRate += this.getBuffBoost("/buff_types/critical_rate").flatBoost;
        this.combatDetails.combatStats.criticalDamage += this.getBuffBoost("/buff_types/critical_damage").flatBoost;

        this.combatDetails.combatStats.castSpeed += this.getBuffBoost("/buff_types/cast_speed").flatBoost;
        this.combatDetails.combatStats.castSpeed += this.combatDetails["attackLevel"] / 2000;

        let combatDropRateBoosts = this.getBuffBoost("/buff_types/combat_drop_rate");
        this.combatDetails.combatStats.combatDropRate +=
            (1 + this.combatDetails.combatStats.combatDropRate) * combatDropRateBoosts.ratioBoost;
        this.combatDetails.combatStats.combatDropRate += combatDropRateBoosts.flatBoost;
        let combatRareFindBoosts = this.getBuffBoost("/buff_types/rare_find");
        this.combatDetails.combatStats.combatRareFind +=
            (1 + this.combatDetails.combatStats.combatRareFind) * combatRareFindBoosts.ratioBoost;
        this.combatDetails.combatStats.combatRareFind += combatRareFindBoosts.flatBoost;
        let combatDropQuantityBoosts = this.getBuffBoost("/buff_types/combat_drop_quantity");
        this.combatDetails.combatStats.combatDropQuantity +=
            (1 + this.combatDetails.combatStats.combatDropQuantity) * combatDropQuantityBoosts.ratioBoost;
        this.combatDetails.combatStats.combatDropQuantity += combatDropQuantityBoosts.flatBoost;

        let baseThreat = 100 + this.combatDetails.combatStats.threat;
        this.combatDetails.totalThreat = baseThreat;
        let threatBoosts = this.getBuffBoost("/buff_types/threat");
        if (threatBoosts.ratioBoost !== 0) {
            this.combatDetails.combatStats.threat += baseThreat * threatBoosts.ratioBoost;
        } else {
            this.combatDetails.combatStats.threat = baseThreat;
        }
        this.combatDetails.combatStats.threat += threatBoosts.flatBoost;

        this.combatDetails.combatStats.retaliation += this.getBuffBoost("/buff_types/retaliation").flatBoost;
        this.combatDetails.combatStats.tenacity += this.getBuffBoost("/buff_types/tenacity").flatBoost;
    }

    addBuff(buff, currentTime, sourceHrid = null, options = {}) {
        if (typeof currentTime !== "number" || !Number.isFinite(currentTime)) {
            throw new TypeError("CombatUnit.addBuff requires a finite numeric currentTime");
        }
        if (options === null || typeof options !== "object" || Array.isArray(options)) {
            throw new TypeError("CombatUnit.addBuff options must be a non-null object");
        }
        const { sourcePolicy } = options;

        readNonEmptyBuffHrid(buff, "uniqueHrid");
        readNonEmptyBuffHrid(buff, "typeHrid");
        readFiniteBuffNumber(buff, "ratioBoost");
        readFiniteBuffNumber(buff, "flatBoost");
        const duration = readFiniteBuffNumber(buff, "duration");

        // Keep the caller-owned buff immutable after registration.  Each source
        // needs its own startTime because the same buff may be reused by several
        // sources or combat units.
        const registeredBuff = cloneBuffForRegistration(buff, currentTime);
        const sourceKey = sourceHrid ?? "default";
        const expiresAt = currentTime + duration;
        const normalizedPolicy = normalizeBuffSourcePolicy(sourcePolicy);
        if (normalizedPolicy === BUFF_SOURCE_POLICY.STRONGEST) {
            // Validate before mutating the source registry. Unsupported or
            // changed official data must fail loudly instead of selecting a
            // source through an inferred negative/mixed-field ordering rule.
            getPartyAuraBuffStrength(registeredBuff);
        }

        let sources = this.buffSources[registeredBuff.uniqueHrid];
        if (!sources) {
            sources = this.buffSources[registeredBuff.uniqueHrid] = new Map();
        }
        const existingPolicy = this.buffSourcePolicies[registeredBuff.uniqueHrid];
        if (existingPolicy && existingPolicy !== normalizedPolicy) {
            throw new Error(
                `CombatUnit buff source policy mismatch for ${registeredBuff.uniqueHrid}: ` +
                    `${existingPolicy} vs ${normalizedPolicy}`,
            );
        }
        this.buffSourcePolicies[registeredBuff.uniqueHrid] = normalizedPolicy;
        sources.set(sourceKey, {
            buff: registeredBuff,
            expiresAt,
            sequence: ++this.buffSourceSequence,
        });

        // Re-select after every source update. Strongest-source buffs may hand
        // off to another source; default buffs expose the most recent write.
        this.reconcileBuffSource(registeredBuff.uniqueHrid, sources, {
            preferredSourceKey: sourceKey,
        });
    }

    reconcileBuffSource(uniqueHrid, sources, { updateDetails = true, preferredSourceKey = null } = {}) {
        const previousActiveBuff = this.combatBuffs[uniqueHrid];
        const policy = this.buffSourcePolicies[uniqueHrid] ?? BUFF_SOURCE_POLICY.REPLACE;
        const nextActiveSource =
            sources && sources.size > 0 ? pickActiveBuffSource(sources, policy, preferredSourceKey) : null;

        if (nextActiveSource) {
            this.activeBuffSourceKeys[uniqueHrid] = nextActiveSource.sourceKey;
            this.combatBuffs[uniqueHrid] = nextActiveSource.buff;
        } else {
            delete this.activeBuffSourceKeys[uniqueHrid];
            delete this.combatBuffs[uniqueHrid];
        }

        const activeBuffChanged = !buffsAffectStatsEqually(nextActiveSource?.buff, previousActiveBuff);
        if (activeBuffChanged && updateDetails) {
            this.updateCombatDetails();
        }

        return activeBuffChanged;
    }

    /**
     * Remove a runtime Buff registration.
     *
     * `sourceHrid` is optional for compatibility with the pre-source API:
     * `removeBuff({ uniqueHrid })` removes the currently active source, i.e.
     * the Buff that callers historically saw in `combatBuffs`.  For a
     * strongest-source Buff this may reveal the next source through the normal
     * handoff rules.  Pass a source key when only one particular registration
     * should be removed; `REMOVE_ACTIVE_SOURCE` expresses the active-source
     * intent explicitly, while an explicit `null` keeps the legacy `default` key.
     * Legacy last-write (`REPLACE`) Buffs retain their historical no-dormant-
     * handoff behavior and clear the remaining registrations after the active
     * registration is removed.
     */
    removeBuff(buff, sourceHrid = REMOVE_ACTIVE_SOURCE) {
        const uniqueHrid = buff?.uniqueHrid;
        if (!uniqueHrid) {
            return;
        }

        this.removeBuffByUniqueHrid(uniqueHrid, sourceHrid);
    }

    /**
     * Remove a runtime Buff registration by uniqueHrid.
     *
     * Omitting `sourceHrid` intentionally targets the currently active source
     * to preserve the old `removeBuff({ uniqueHrid })` contract.  This is also
     * the safe default for source-aware Buffs: strongest-source entries can
     * hand off instead of silently doing nothing.  Use `REMOVE_ACTIVE_SOURCE`
     * when the active-source intent should be explicit, or an explicit source
     * key for exact source removal; explicit `null` targets the `default` source.
     * Legacy `REPLACE` entries keep their no-dormant-handoff cleanup semantics.
     */
    removeBuffByUniqueHrid(uniqueHrid, sourceHrid = REMOVE_ACTIVE_SOURCE) {
        const sources = this.buffSources[uniqueHrid];
        let sourceKey;
        if (sourceHrid === REMOVE_ACTIVE_SOURCE) {
            const activeSourceKey = this.activeBuffSourceKeys[uniqueHrid];
            if (activeSourceKey !== undefined && (!sources || sources.has(activeSourceKey))) {
                sourceKey = activeSourceKey;
            } else if (sources?.size) {
                // Recovered/legacy state may have source registrations without
                // the active-key index. Derive the same active source used by
                // reconciliation instead of returning a silent no-op.
                const policy = this.buffSourcePolicies[uniqueHrid] ?? BUFF_SOURCE_POLICY.REPLACE;
                sourceKey = pickActiveBuffSource(sources, policy)?.sourceKey;
            }
        } else {
            sourceKey = sourceHrid;
        }
        sourceKey ??= "default";

        if (sources) {
            if (!sources.has(sourceKey)) {
                return;
            }

            const policy = this.buffSourcePolicies[uniqueHrid] ?? BUFF_SOURCE_POLICY.REPLACE;
            const sourceWasActive = sourceKey === this.activeBuffSourceKeys[uniqueHrid];
            sources.delete(sourceKey);
            if (policy === BUFF_SOURCE_POLICY.REPLACE && sourceWasActive) {
                // Historical last-write-wins buffs do not reveal an overwritten
                // value when the visible registration is removed.
                //
                // Cascading clear reachability note: every production REPLACE
                // registration keeps exactly one source per uniqueHrid — scrolls
                // use `scroll:${itemHrid}` (scroll uniqueHrids are mutually
                // distinct and isolated from drink/ability buffs; renewal is a
                // same-key overwrite), while fury/curse/weaken/enrage,
                // consumables, and REPLACE ability buffs all register the
                // "default" key. Removing the sole entry therefore falls
                // through to the sources.size === 0 branch below, so this
                // REPLACE+active branch is only exercised by unit tests that
                // deliberately build multi-source REPLACE registrations.
                // Keep it: if future data registers several REPLACE sources per
                // uniqueHrid, it preserves the no-dormant-handoff contract.
                delete this.buffSources[uniqueHrid];
                delete this.buffSourcePolicies[uniqueHrid];
                this.reconcileBuffSource(uniqueHrid, null);
            } else if (sources.size === 0) {
                delete this.buffSources[uniqueHrid];
                delete this.buffSourcePolicies[uniqueHrid];
                this.reconcileBuffSource(uniqueHrid, null);
            } else if (
                sourceWasActive ||
                // Reconcile defensively if the source registry and active key drift apart.
                this.activeBuffSourceKeys[uniqueHrid] === undefined
            ) {
                this.reconcileBuffSource(uniqueHrid, sources);
            }
            return;
        }

        // Compatibility fallback for old-style buffs that predate source
        // registration.  A missing source registry must not be treated as a
        // reason to delete unrelated registered sources.
        if (this.combatBuffs[uniqueHrid]) {
            delete this.combatBuffs[uniqueHrid];
            delete this.activeBuffSourceKeys[uniqueHrid];
            delete this.buffSourcePolicies[uniqueHrid];
            this.updateCombatDetails();
        }
    }

    addPermanentBuff(buff) {
        if (this.permanentBuffs[buff.typeHrid]) {
            this.permanentBuffs[buff.typeHrid].flatBoost += buff.flatBoost;
            this.permanentBuffs[buff.typeHrid].ratioBoost += buff.ratioBoost;
        } else {
            this.permanentBuffs[buff.typeHrid] = buff;
        }
    }

    generatePermanentBuffs() {
        for (let i = 0; i < this.houseRooms.length; i++) {
            const houseRoom = this.houseRooms[i];
            houseRoom.buffs.forEach((buff) => {
                this.addPermanentBuff(buff);
            });
        }

        for (const guildBuff of this.guildBuffs) {
            guildBuff.buffs.forEach((buff) => {
                this.addPermanentBuff(buff);
            });
        }

        if (this.achievements) {
            this.achievements.buffs.forEach((buff) => {
                this.addPermanentBuff(buff);
            });
        }
        if (this.zoneBuffs) {
            this.zoneBuffs.forEach((buff) => {
                this.addPermanentBuff(buff);
            });
        }
        if (this.extraBuffs) {
            this.extraBuffs.forEach((buff) => {
                this.addPermanentBuff(buff);
            });
        }
    }

    removeExpiredBuffByUniqueHrid(uniqueHrid, currentTime, { updateDetails = true } = {}) {
        if (!uniqueHrid) {
            return false;
        }

        let detailsDirty = false;
        const sources = this.buffSources[uniqueHrid];
        if (sources) {
            const activeSourceKey = this.activeBuffSourceKeys[uniqueHrid];
            const policy = this.buffSourcePolicies[uniqueHrid] ?? BUFF_SOURCE_POLICY.REPLACE;
            let activeSourceExpired = false;
            // Delete while scanning a snapshot so the mutation cannot alter
            // iteration semantics. Source sets are currently bounded by the
            // small party-aura roster; if this policy expands to large sets,
            // collect only expired keys (or maintain an index) instead.
            for (const [sourceKey, entry] of [...sources.entries()]) {
                if (entry.expiresAt <= currentTime) {
                    if (sourceKey === activeSourceKey) {
                        activeSourceExpired = true;
                    }
                    sources.delete(sourceKey);
                }
            }

            // Last-write buffs historically had no dormant-source handoff: once
            // the visible buff expires, the old engine removed that uniqueHrid
            // entirely. Preserve that behavior while allowing aura sources to
            // hand off to the next strongest non-expired registration.
            if (policy === BUFF_SOURCE_POLICY.REPLACE && activeSourceExpired) {
                delete this.buffSources[uniqueHrid];
                delete this.buffSourcePolicies[uniqueHrid];
                detailsDirty = this.reconcileBuffSource(uniqueHrid, null, { updateDetails: false }) || detailsDirty;
            } else if (sources.size === 0) {
                delete this.buffSources[uniqueHrid];
                delete this.buffSourcePolicies[uniqueHrid];
                detailsDirty = this.reconcileBuffSource(uniqueHrid, null, { updateDetails: false }) || detailsDirty;
            } else if (activeSourceExpired || activeSourceKey === undefined || !sources.has(activeSourceKey)) {
                detailsDirty = this.reconcileBuffSource(uniqueHrid, sources, { updateDetails: false }) || detailsDirty;
            }
        } else {
            // Keep compatibility with runtime buffs restored by older callers
            // before source registration was introduced. Permanent buffs normally
            // use null/string start times and therefore remain outside this
            // numeric timed-buff fallback.
            const buff = this.combatBuffs[uniqueHrid];
            if (
                typeof buff?.startTime === "number" &&
                Number.isFinite(buff.startTime) &&
                typeof buff?.duration === "number" &&
                Number.isFinite(buff.duration) &&
                buff.startTime + buff.duration <= currentTime
            ) {
                delete this.combatBuffs[uniqueHrid];
                delete this.activeBuffSourceKeys[uniqueHrid];
                delete this.buffSourcePolicies[uniqueHrid];
                detailsDirty = true;
            }
        }

        if (detailsDirty && updateDetails) {
            this.updateCombatDetails();
        }

        return detailsDirty;
    }

    removeExpiredBuffs(currentTime, { updateDetails = true } = {}) {
        // Only source-registered runtime buffs expire here. clearBuffs() copies
        // permanent buffs directly into combatBuffs without sources, so those
        // entries are intentionally outside the timed-expiration lifecycle.
        // When the active source expires, strongest-source buffs may select a
        // fallback. Ordinary last-write buffs are cleared with no handoff.
        let detailsDirty = false;
        for (const uniqueHrid of Object.keys(this.buffSources)) {
            detailsDirty =
                this.removeExpiredBuffByUniqueHrid(uniqueHrid, currentTime, { updateDetails: false }) || detailsDirty;
        }

        // Keep compatibility with runtime buffs restored by older callers that
        // are not represented in buffSources. The targeted primitive above is
        // also used by specialized expiration events to avoid this full scan.
        for (const [uniqueHrid, buff] of Object.entries(this.combatBuffs)) {
            if (this.buffSources[uniqueHrid]) {
                continue;
            }
            if (
                typeof buff?.startTime === "number" &&
                Number.isFinite(buff.startTime) &&
                typeof buff?.duration === "number" &&
                Number.isFinite(buff.duration) &&
                buff.startTime + buff.duration <= currentTime
            ) {
                delete this.combatBuffs[uniqueHrid];
                delete this.activeBuffSourceKeys[uniqueHrid];
                delete this.buffSourcePolicies[uniqueHrid];
                detailsDirty = true;
            }
        }

        if (detailsDirty && updateDetails) {
            this.updateCombatDetails();
        }

        return detailsDirty;
    }

    clearBuffs() {
        this.combatBuffs = structuredClone(this.permanentBuffs);
        this.buffSources = {};
        this.activeBuffSourceKeys = {};
        this.buffSourcePolicies = {};
        this.buffSourceSequence = 0;
        this.updateCombatDetails();
    }

    clearCCs() {
        this.isStunned = false;
        this.stunExpireTime = null;
        this.isSilenced = false;
        this.silenceExpireTime = null;
        this.isBlinded = false;
        this.blindExpireTime = null;
        this.combatDetails.combatStats.damageTaken = 0;
        this.refreshBaseCombatStats();
    }

    getBuffBoosts(type) {
        let boosts = [];
        Object.values(this.combatBuffs)
            .filter((buff) => buff.typeHrid == type)
            .forEach((buff) => {
                const { ratioBoost, flatBoost } = projectBuffStats(buff);
                boosts.push({ ratioBoost, flatBoost });
            });

        return boosts;
    }

    getBuffBoost(type) {
        let boosts = this.getBuffBoosts(type);

        let boost = {
            ratioBoost: 0,
            flatBoost: 0,
        };

        for (let i = 0; i < boosts.length; i++) {
            boost.ratioBoost += boosts[i]?.ratioBoost ?? 0;
            boost.flatBoost += boosts[i]?.flatBoost ?? 0;
        }

        return boost;
    }

    reset(currentTime = 0) {
        this.clearCCs();

        // 只有玩家在地下城团灭重开时保留buff和CD，敌人始终完全重置
        if (currentTime == 0 || !this.isPlayer) {
            // 首次战斗开始 或 敌人重置：完全重置
            this.clearBuffs();
            this.updateCombatDetails();
            this.resetCooldowns(currentTime);
        } else {
            // 地下城团灭重开（仅玩家）：只移除过期buff，保留CD
            this.removeExpiredBuffs(currentTime, { updateDetails: false });
            this.updateCombatDetails();
        }

        this.combatDetails.currentHitpoints = this.combatDetails.maxHitpoints;
        this.combatDetails.currentManapoints = this.combatDetails.maxManapoints;
    }

    resetCooldowns(currentTime = 0) {
        this.food.filter((food) => food != null).forEach((food) => (food.lastUsed = Number.MIN_SAFE_INTEGER));
        this.drinks.filter((drink) => drink != null).forEach((drink) => (drink.lastUsed = Number.MIN_SAFE_INTEGER));

        let haste = this.combatDetails.combatStats.abilityHaste;

        this.abilities
            .filter((ability) => ability != null)
            .forEach((ability) => {
                if (this.isPlayer) {
                    ability.lastUsed = Number.MIN_SAFE_INTEGER;
                } else {
                    let cooldownDuration = ability.cooldownDuration;
                    if (haste > 0) {
                        cooldownDuration = (cooldownDuration * 100) / (100 + haste);
                    }
                    ability.lastUsed =
                        currentTime -
                        Math.floor(cooldownDuration * 0.5) +
                        Math.floor(Math.random() * cooldownDuration * 0.5);
                }
            });
    }

    addHitpoints(hitpoints) {
        let hitpointsAdded = 0;

        if (this.combatDetails.currentHitpoints >= this.combatDetails.maxHitpoints) {
            return hitpointsAdded;
        }

        let newHitpoints = Math.min(this.combatDetails.currentHitpoints + hitpoints, this.combatDetails.maxHitpoints);
        hitpointsAdded = newHitpoints - this.combatDetails.currentHitpoints;
        this.combatDetails.currentHitpoints = newHitpoints;

        return hitpointsAdded;
    }

    addManapoints(manapoints) {
        let manapointsAdded = 0;

        if (this.combatDetails.currentManapoints >= this.combatDetails.maxManapoints) {
            return manapointsAdded;
        }

        let newManapoints = Math.min(
            this.combatDetails.currentManapoints + manapoints,
            this.combatDetails.maxManapoints,
        );
        manapointsAdded = newManapoints - this.combatDetails.currentManapoints;
        this.combatDetails.currentManapoints = newManapoints;

        return manapointsAdded;
    }
}

export default CombatUnit;

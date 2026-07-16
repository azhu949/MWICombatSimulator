import guildBuffDetailMap from "../combatsimulator/data/guildBuffDetailMap.json";
import guildShrineDetailMap from "../combatsimulator/data/guildShrineDetailMap.json";
import { itemDetailIndex, skillingData } from "../shared/gameDataIndex.js";

const INVENTORY_LOCATION_HRID = "/item_locations/inventory";
const BUFF_SOURCE_FIELDS = Object.freeze({
    house: "houseActionTypeBuffsMap",
    community: "communityActionTypeBuffsMap",
    achievement: "achievementActionTypeBuffsMap",
    personal: "personalActionTypeBuffsMap",
    mooPass: "mooPassActionTypeBuffsMap",
});

function finiteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeHrid(value) {
    return String(value || "").trim();
}

function isPlainObject(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
}

function toValueList(value) {
    if (Array.isArray(value)) {
        return value;
    }
    return isPlainObject(value) ? Object.values(value) : [];
}

function toKeyedEntries(value) {
    if (Array.isArray(value)) {
        return value.map((entry, index) => [String(index), entry]);
    }
    return isPlainObject(value) ? Object.entries(value) : [];
}

function unwrapItem(rawEntry) {
    if (!isPlainObject(rawEntry)) {
        return null;
    }
    if (isPlainObject(rawEntry.currentItem)) {
        return rawEntry.currentItem;
    }
    if (isPlainObject(rawEntry.item)) {
        return rawEntry.item;
    }
    return rawEntry;
}

function normalizeBuff(rawBuff) {
    if (!isPlainObject(rawBuff)) {
        return null;
    }
    const nested = isPlainObject(rawBuff.buff) ? rawBuff.buff : rawBuff;
    const typeHrid = normalizeHrid(nested.typeHrid || nested.buffTypeHrid || rawBuff.typeHrid || rawBuff.buffTypeHrid);
    if (!typeHrid) {
        return null;
    }
    return {
        uniqueHrid: normalizeHrid(nested.uniqueHrid || rawBuff.uniqueHrid),
        typeHrid,
        ratioBoost: finiteNumber(nested.ratioBoost ?? rawBuff.ratioBoost, 0),
        flatBoost: finiteNumber(nested.flatBoost ?? rawBuff.flatBoost, 0),
        startTime: String(nested.startTime || rawBuff.startTime || ""),
        duration: Math.max(0, finiteNumber(nested.duration ?? rawBuff.duration, 0)),
    };
}

function normalizeActionBuffMap(rawMap) {
    const result = {};
    for (const [rawActionType, rawBuffs] of Object.entries(isPlainObject(rawMap) ? rawMap : {})) {
        const actionTypeHrid = normalizeHrid(rawActionType);
        if (!actionTypeHrid) {
            continue;
        }
        const buffs = toValueList(rawBuffs).map(normalizeBuff).filter(Boolean);
        if (buffs.length > 0) {
            result[actionTypeHrid] = buffs;
        }
    }
    return result;
}

function normalizeDrinkSlotMap(rawMap) {
    const result = {};
    for (const [rawActionType, rawSlots] of Object.entries(isPlainObject(rawMap) ? rawMap : {})) {
        const actionTypeHrid = normalizeHrid(rawActionType);
        if (!actionTypeHrid) continue;
        const slots = toValueList(rawSlots).map((rawSlot, index) => {
            const itemHrid = typeof rawSlot === "string"
                ? normalizeHrid(rawSlot)
                : normalizeHrid(rawSlot?.itemHrid || rawSlot?.hrid || rawSlot?.currentItem?.itemHrid);
            if (!itemHrid) return null;
            return {
                slotIndex: Math.max(0, Math.trunc(finiteNumber(rawSlot?.slotIndex, index))),
                itemHrid,
                isActive: rawSlot?.isActive === true || rawSlot?.active === true
                    ? true
                    : rawSlot?.isActive === false || rawSlot?.active === false
                        ? false
                        : null,
            };
        }).filter(Boolean);
        if (slots.length > 0) result[actionTypeHrid] = slots;
    }
    return result;
}

function guildBuffMaximumLevel(detail) {
    const shrineMaximum = Math.max(0, Math.trunc(finiteNumber(
        guildShrineDetailMap?.[detail?.shrineHrid]?.maxLevel,
        0,
    )));
    const costMaximum = Math.max(0, ...Object.keys(detail?.levelCosts || {})
        .map((level) => Math.trunc(finiteNumber(level, 0))));
    if (shrineMaximum <= 0) return costMaximum;
    if (costMaximum <= 0) return shrineMaximum;
    return Math.min(shrineMaximum, costMaximum);
}

function buildGuildActionBuffMap(source) {
    const purchasedLevels = {};
    for (const [entryKey, rawValue] of toKeyedEntries(source?.characterGuildBuffMap)) {
        const guildBuffHrid = normalizeHrid(rawValue?.guildBuffHrid || rawValue?.hrid || entryKey);
        if (guildBuffHrid) {
            purchasedLevels[guildBuffHrid] = Math.max(0, Math.trunc(finiteNumber(rawValue?.level ?? rawValue, 0)));
        }
    }

    const buffs = [];
    for (const detail of Object.values(guildBuffDetailMap || {})) {
        if (detail?.isCombat !== false || !normalizeHrid(detail?.hrid)) continue;
        const shrineValue = source?.guildBuildingLevelMap?.[detail.shrineHrid];
        const shrineLevel = Math.max(0, Math.trunc(finiteNumber(shrineValue?.level ?? shrineValue, 0)));
        const effectiveLevel = Math.min(
            purchasedLevels[detail.hrid] || 0,
            shrineLevel,
            guildBuffMaximumLevel(detail),
        );
        if (effectiveLevel <= 0) continue;
        for (const template of detail?.buffs || []) {
            const normalized = normalizeBuff({
                ...template,
                ratioBoost: finiteNumber(template?.ratioBoost, 0)
                    + finiteNumber(template?.ratioBoostLevelBonus, 0) * (effectiveLevel - 1),
                flatBoost: finiteNumber(template?.flatBoost, 0)
                    + finiteNumber(template?.flatBoostLevelBonus, 0) * (effectiveLevel - 1),
                duration: 0,
            });
            if (normalized) buffs.push(normalized);
        }
    }

    return Object.fromEntries((skillingData?.actionTypeHrids || []).map((actionTypeHrid) => (
        [actionTypeHrid, buffs.map((buff) => ({ ...buff }))]
    )));
}

function resolvePayloadSource(payload) {
    if (!isPlainObject(payload)) {
        return {};
    }
    if (isPlainObject(payload.profile) && !payload.characterItems) {
        return payload.profile;
    }
    return payload;
}

export function normalizeSkillingProfile(payload, importedAt = Date.now()) {
    const source = resolvePayloadSource(payload);
    const skills = {};
    for (const rawSkill of toValueList(source.characterSkills)) {
        const skillHrid = normalizeHrid(rawSkill?.skillHrid || rawSkill?.hrid);
        if (!skillHrid) {
            continue;
        }
        skills[skillHrid] = {
            level: Math.max(1, Math.trunc(finiteNumber(rawSkill?.level, 1))),
            experience: Number.isFinite(Number(rawSkill?.experience))
                ? Math.max(0, Number(rawSkill.experience))
                : null,
        };
    }

    if (!skills["/skills/total_level"]) {
        const totalLevel = Object.entries(skills)
            .filter(([skillHrid]) => skillHrid !== "/skills/total_level")
            .reduce((sum, [, skill]) => sum + Math.max(1, finiteNumber(skill?.level, 1)), 0);
        skills["/skills/total_level"] = { level: Math.max(1, totalLevel), experience: null };
    }

    const skillingEquipmentByHrid = new Map((skillingData?.equipment || []).map((item) => [item.hrid, item]));
    const inventory = {};
    const equipment = [];
    let itemIndex = 0;
    for (const rawEntry of toValueList(source.characterItems)) {
        const entry = unwrapItem(rawEntry);
        const itemHrid = normalizeHrid(entry?.itemHrid || entry?.hrid || rawEntry?.itemHrid);
        const itemLocationHrid = normalizeHrid(entry?.itemLocationHrid || rawEntry?.itemLocationHrid);
        const count = Math.max(0, finiteNumber(entry?.count ?? rawEntry?.count, 1));
        if (!itemHrid || count <= 0) {
            continue;
        }

        if (!itemLocationHrid || itemLocationHrid === INVENTORY_LOCATION_HRID) {
            inventory[itemHrid] = finiteNumber(inventory[itemHrid], 0) + count;
        }

        const equipmentDefinition = skillingEquipmentByHrid.get(itemHrid);
        const itemDefinition = itemDetailIndex?.[itemHrid];
        const equipmentType = normalizeHrid(
            equipmentDefinition?.equipmentType
            || itemDefinition?.equipmentType
            || itemDefinition?.equipmentDetail?.type,
        );
        const equipmentSlot = equipmentType.split("/").filter(Boolean).pop();
        const equippedLocationHrid = equipmentSlot ? `/item_locations/${equipmentSlot}` : "";
        const isInInventory = !itemLocationHrid || itemLocationHrid === INVENTORY_LOCATION_HRID;
        const isEquipped = Boolean(equippedLocationHrid && itemLocationHrid === equippedLocationHrid);
        if (itemDefinition?.categoryHrid === "/item_categories/equipment" && (isInInventory || isEquipped)) {
            equipment.push({
                id: normalizeHrid(entry?.hash || entry?.id || rawEntry?.hash || rawEntry?.id) || `item-${itemIndex}`,
                itemHrid,
                equipmentType,
                itemLocationHrid: itemLocationHrid || INVENTORY_LOCATION_HRID,
                enhancementLevel: Math.max(0, Math.min(20, Math.trunc(finiteNumber(
                    entry?.enhancementLevel ?? rawEntry?.enhancementLevel,
                    0,
                )))),
                count,
                isEquipped,
            });
        }
        itemIndex += 1;
    }

    const buffsBySource = {};
    for (const [sourceKey, field] of Object.entries(BUFF_SOURCE_FIELDS)) {
        buffsBySource[sourceKey] = normalizeActionBuffMap(source[field]);
    }
    buffsBySource.guild = buildGuildActionBuffMap(source);
    const drinkSlotsByActionType = normalizeDrinkSlotMap(source.actionTypeDrinkSlotsMap);

    return {
        version: 1,
        characterName: String(source?.character?.name || source?.sharableCharacter?.name || source?.name || "").trim(),
        importedAt: Math.max(0, finiteNumber(importedAt, Date.now())),
        skills,
        inventory,
        equipment,
        buffsBySource,
        drinkSlotsByActionType,
    };
}

export function buildMainSiteSkillingImport(payload, importedAt = Date.now()) {
    const source = resolvePayloadSource(payload);
    if (!Object.prototype.hasOwnProperty.call(source, "characterItems") || !toValueList(source.characterSkills).length) {
        throw new Error("No current-character skilling data was found in the main-site payload.");
    }
    const profile = normalizeSkillingProfile(source, importedAt);
    const supportedSkills = (skillingData?.skillHrids || []).filter((skillHrid) => profile.skills[skillHrid]);
    if (supportedSkills.length === 0) {
        throw new Error("No supported skilling levels were found in the main-site payload.");
    }
    return {
        detectedFormat: "main-site-skilling-character",
        characterName: profile.characterName,
        importedSections: [
            "skills",
            "inventory",
            "equipment",
            "buffs",
            ...(Object.prototype.hasOwnProperty.call(source, "actionTypeDrinkSlotsMap") ? ["drinkSlots"] : []),
        ],
        profile,
    };
}

export { BUFF_SOURCE_FIELDS, INVENTORY_LOCATION_HRID };

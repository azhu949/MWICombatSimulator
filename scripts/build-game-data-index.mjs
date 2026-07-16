import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(projectRoot, "src", "combatsimulator", "data");
const outputPath = path.join(projectRoot, "src", "shared", "gameDataIndex.generated.json");

const LEVEL_KEYS = ["stamina", "intelligence", "attack", "melee", "defense", "ranged", "magic"];
const EQUIPMENT_SLOT_KEYS = ["head", "body", "legs", "feet", "hands", "weapon", "off_hand", "pouch", "neck", "earrings", "ring", "back", "charm"];
const ABILITY_BOOK_CATEGORY_HRID = "/item_categories/ability_book";
const ITEM_LOCATION_HRID_PREFIX = "/item_locations/";
const LABYRINTH_COFFEE_CRATE_HRIDS = ["/items/basic_coffee_crate", "/items/advanced_coffee_crate", "/items/expert_coffee_crate"];
const LABYRINTH_FOOD_CRATE_HRIDS = ["/items/basic_food_crate", "/items/advanced_food_crate", "/items/expert_food_crate"];
const LABYRINTH_TEA_CRATE_HRIDS = ["/items/basic_tea_crate", "/items/advanced_tea_crate", "/items/expert_tea_crate"];
const WEAPON_EQUIPMENT_TYPE_HRIDS = new Set(["/equipment_types/main_hand", "/equipment_types/two_hand"]);
const ENHANCING_ACTION_TYPE_HRID = "/action_types/enhancing";
const ENHANCEMENT_ACTION_BASE_SECONDS = 12;
const NANOSECONDS_PER_SECOND = 1_000_000_000;
const ENHANCEMENT_DRINK_BUFF_TYPE_HRIDS = new Set([
    "/buff_types/blessed",
    "/buff_types/enhancing_level",
    "/buff_types/wisdom",
]);
const ENHANCEMENT_ACHIEVEMENT_BUFF_TYPE_HRIDS = new Set([
    "/buff_types/enhancing_success",
    "/buff_types/wisdom",
]);
const ENHANCEMENT_SPECIAL_ITEM_HRIDS = Object.freeze({
    coin: "/items/coin",
    enhancingEssence: "/items/enhancing_essence",
    mirrorOfProtection: "/items/mirror_of_protection",
    philosophersMirror: "/items/philosophers_mirror",
});
const SKILLING_ACTION_TYPE_HRIDS = Object.freeze([
    "/action_types/foraging",
    "/action_types/brewing",
    "/action_types/cheesesmithing",
    "/action_types/cooking",
    "/action_types/crafting",
    "/action_types/tailoring",
]);
const SKILLING_ACTION_TYPE_SET = new Set(SKILLING_ACTION_TYPE_HRIDS);
const SKILLING_ACTION_FUNCTION_SET = new Set([
    "/action_functions/gathering",
    "/action_functions/production",
]);
const SKILLING_SKILL_HRIDS = Object.freeze(SKILLING_ACTION_TYPE_HRIDS.map((hrid) => (
    hrid.replace("/action_types/", "/skills/")
)));
const SKILLING_STAT_PREFIXES = Object.freeze([
    "foraging",
    "gathering",
    "brewing",
    "cheesesmithing",
    "cooking",
    "crafting",
    "tailoring",
    "skilling",
]);

async function readJsonFile(filename) {
    const filePath = path.join(dataRoot, filename);
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
}

function sortByNameThenLevel(left, right) {
    const leftLevel = Number(left?.itemLevel ?? 0);
    const rightLevel = Number(right?.itemLevel ?? 0);
    if (leftLevel !== rightLevel) {
        return leftLevel - rightLevel;
    }
    return String(left?.name || "").localeCompare(String(right?.name || ""));
}

function resolveFoodConsumableSortGroup(option) {
    const hitpointRestore = Number(option?.hitpointRestore ?? 0);
    const manapointRestore = Number(option?.manapointRestore ?? 0);
    const recoveryDuration = Number(option?.recoveryDuration ?? 0);

    if (hitpointRestore > 0 && manapointRestore <= 0) {
        return recoveryDuration > 0 ? 1 : 0;
    }

    if (manapointRestore > 0 && hitpointRestore <= 0) {
        return recoveryDuration > 0 ? 3 : 2;
    }

    return 99;
}

function resolveEquipmentSlotName(equipmentType, equipmentTypeDetailMap) {
    const normalizedEquipmentType = String(equipmentType || "").trim();
    if (!normalizedEquipmentType) {
        return "";
    }

    if (WEAPON_EQUIPMENT_TYPE_HRIDS.has(normalizedEquipmentType)) {
        return "weapon";
    }

    const itemLocationHrid = String(equipmentTypeDetailMap?.[normalizedEquipmentType]?.itemLocationHrid || "");
    if (!itemLocationHrid.startsWith(ITEM_LOCATION_HRID_PREFIX)) {
        return "";
    }

    const slotName = itemLocationHrid.slice(ITEM_LOCATION_HRID_PREFIX.length);
    return EQUIPMENT_SLOT_KEYS.includes(slotName) ? slotName : "";
}

function createItemIndex(itemDetailMap, equipmentTypeDetailMap) {
    const itemDetailIndex = {};
    const itemNameByHrid = {};
    const itemVendorPriceByHrid = {};
    const abilityBookInfoByAbilityHrid = {};
    const equipmentBySlot = Object.fromEntries(EQUIPMENT_SLOT_KEYS.map((slot) => [slot, []]));
    equipmentBySlot.weapon = [];
    const foodOptions = [];
    const drinkOptions = [];

    for (const item of Object.values(itemDetailMap || {})) {
        const hrid = String(item?.hrid || "");
        if (!hrid) {
            continue;
        }

        const categoryHrid = String(item?.categoryHrid || "");
        const itemLevel = Number(item?.itemLevel ?? 0);
        const equipmentType = String(item?.equipmentDetail?.type || "");
        const hitpointRestore = Number(item?.consumableDetail?.hitpointRestore ?? 0);
        const manapointRestore = Number(item?.consumableDetail?.manapointRestore ?? 0);
        const recoveryDuration = Number(item?.consumableDetail?.recoveryDuration ?? 0);
        const sellPrice = Math.max(0, Number(item?.sellPrice ?? 0));
        const abilityBookAbilityHrid = String(item?.abilityBookDetail?.abilityHrid || "");
        const abilityBookXp = Number(item?.abilityBookDetail?.experienceGain ?? 0);

        itemNameByHrid[hrid] = String(item?.name || hrid);
        itemVendorPriceByHrid[hrid] = sellPrice;
        itemDetailIndex[hrid] = {
            hrid,
            name: String(item?.name || hrid),
            categoryHrid,
            itemLevel,
            equipmentType,
            equipmentDetail: equipmentType ? { type: equipmentType } : null,
            hitpointRestore,
            manapointRestore,
            recoveryDuration,
            consumableDetail: {
                hitpointRestore,
                manapointRestore,
                recoveryDuration,
                defaultCombatTriggers: Array.isArray(item?.consumableDetail?.defaultCombatTriggers) ? item.consumableDetail.defaultCombatTriggers : [],
            },
            defaultCombatTriggers: Array.isArray(item?.consumableDetail?.defaultCombatTriggers) ? item.consumableDetail.defaultCombatTriggers : [],
            sellPrice,
            enhancementCosts: Array.isArray(item?.enhancementCosts) ? item.enhancementCosts : [],
            abilityBookAbilityHrid,
            abilityBookXp,
            abilityBookDetail: {
                abilityHrid: abilityBookAbilityHrid,
                experienceGain: abilityBookXp,
            },
        };

        if (categoryHrid === ABILITY_BOOK_CATEGORY_HRID && abilityBookAbilityHrid && abilityBookXp > 0) {
            const previous = abilityBookInfoByAbilityHrid[abilityBookAbilityHrid];
            if (!previous || abilityBookXp > Number(previous?.xpPerBook || 0)) {
                abilityBookInfoByAbilityHrid[abilityBookAbilityHrid] = {
                    itemHrid: hrid,
                    xpPerBook: abilityBookXp,
                };
            }
        }

        const option = {
            hrid,
            name: String(item?.name || hrid),
            itemLevel,
            hitpointRestore,
            manapointRestore,
            recoveryDuration,
        };

        if (categoryHrid === "/item_categories/equipment" && equipmentType) {
            const slotName = resolveEquipmentSlotName(equipmentType, equipmentTypeDetailMap);
            if (slotName) {
                equipmentBySlot[slotName].push({
                    hrid,
                    name: option.name,
                    itemLevel,
                });
            }
        }

        if (categoryHrid === "/item_categories/food") {
            foodOptions.push(option);
        } else if (categoryHrid === "/item_categories/drink") {
            drinkOptions.push(option);
        }
    }

    for (const key of Object.keys(equipmentBySlot)) {
        equipmentBySlot[key] = equipmentBySlot[key].sort(sortByNameThenLevel);
    }

    foodOptions.sort((left, right) => (
        resolveFoodConsumableSortGroup(left) - resolveFoodConsumableSortGroup(right)
        || sortByNameThenLevel(left, right)
    ));
    drinkOptions.sort(sortByNameThenLevel);

    return {
        itemDetailIndex,
        itemNameByHrid,
        itemVendorPriceByHrid,
        abilityBookInfoByAbilityHrid,
        equipmentBySlot,
        foodOptions: foodOptions.map(({ hrid, name, itemLevel }) => ({ hrid, name, itemLevel })),
        drinkOptions: drinkOptions.map(({ hrid, name, itemLevel }) => ({ hrid, name, itemLevel })),
        labyrinthCrates: {
            coffee: LABYRINTH_COFFEE_CRATE_HRIDS.map((hrid) => ({
                hrid,
                name: itemNameByHrid[hrid] || hrid,
            })),
            food: LABYRINTH_FOOD_CRATE_HRIDS.map((hrid) => ({
                hrid,
                name: itemNameByHrid[hrid] || hrid,
            })),
            tea: LABYRINTH_TEA_CRATE_HRIDS.map((hrid) => ({
                hrid,
                name: itemNameByHrid[hrid] || hrid,
            })),
        },
    };
}

function createAbilityIndex(abilityDetailMap) {
    const abilityDetailIndex = {};
    const abilityNameByHrid = {};
    const abilityOptions = [];
    const specialAbilityOptions = [];

    for (const ability of Object.values(abilityDetailMap || {})) {
        const hrid = String(ability?.hrid || "");
        if (!hrid) {
            continue;
        }

        const summary = {
            hrid,
            name: String(ability?.name || hrid),
            sortIndex: Number(ability?.sortIndex ?? 0),
            isSpecialAbility: ability?.isSpecialAbility === true,
            manaCost: Number(ability?.manaCost ?? 0),
            defaultCombatTriggers: Array.isArray(ability?.defaultCombatTriggers) ? ability.defaultCombatTriggers : [],
        };

        abilityDetailIndex[hrid] = summary;
        abilityNameByHrid[hrid] = summary.name;

        if (summary.isSpecialAbility) {
            specialAbilityOptions.push({
                hrid,
                name: summary.name,
                sortIndex: summary.sortIndex,
            });
            continue;
        }

        abilityOptions.push({
            hrid,
            name: summary.name,
            sortIndex: summary.sortIndex,
        });
    }

    abilityOptions.sort((left, right) => left.sortIndex - right.sortIndex || left.name.localeCompare(right.name));
    specialAbilityOptions.sort((left, right) => left.sortIndex - right.sortIndex || left.name.localeCompare(right.name));

    return {
        abilityDetailIndex,
        abilityNameByHrid,
        abilityOptions,
        specialAbilityOptions,
    };
}

function createActionIndex(actionDetailMap) {
    const actionDetailIndex = {};
    const actionNameByHrid = {};
    const zones = [];
    const dungeons = [];
    const groupZoneHrids = [];
    const soloZoneHrids = [];

    for (const action of Object.values(actionDetailMap || {})) {
        const hrid = String(action?.hrid || "");
        if (!hrid) {
            continue;
        }

        const maxSpawnCount = Number(action?.combatZoneInfo?.fightInfo?.randomSpawnInfo?.maxSpawnCount ?? 0);
        const summary = {
            hrid,
            name: String(action?.name || hrid),
            type: String(action?.type || ""),
            category: String(action?.category || ""),
            maxDifficulty: Number(action?.maxDifficulty ?? 0),
            sortIndex: Number(action?.sortIndex ?? 0),
            isDungeon: action?.combatZoneInfo?.isDungeon === true,
            maxSpawnCount,
            combatZoneInfo: {
                isDungeon: action?.combatZoneInfo?.isDungeon === true,
                fightInfo: {
                    randomSpawnInfo: {
                        maxSpawnCount,
                    },
                },
            },
        };

        actionDetailIndex[hrid] = summary;
        actionNameByHrid[hrid] = summary.name;

        if (summary.type !== "/action_types/combat") {
            continue;
        }

        const option = {
            hrid,
            name: summary.name,
            maxDifficulty: summary.maxDifficulty,
            sortIndex: summary.sortIndex,
        };

        if (summary.isDungeon) {
            dungeons.push(option);
            continue;
        }

        zones.push(option);

        if (summary.category !== "/action_categories/combat/dungeons") {
            if (maxSpawnCount > 1) {
                groupZoneHrids.push(hrid);
            }
            if (maxSpawnCount === 1) {
                soloZoneHrids.push(hrid);
            }
        }
    }

    zones.sort((left, right) => left.sortIndex - right.sortIndex || left.name.localeCompare(right.name));
    dungeons.sort((left, right) => left.sortIndex - right.sortIndex || left.name.localeCompare(right.name));

    return {
        actionDetailIndex,
        actionNameByHrid,
        zones,
        dungeons,
        groupZoneHrids,
        soloZoneHrids,
    };
}

function createMonsterIndex(combatMonsterDetailMap) {
    const monsterDetailIndex = {};
    const monsterNameByHrid = {};
    const labyrinthOptions = [];

    for (const monster of Object.values(combatMonsterDetailMap || {})) {
        const hrid = String(monster?.hrid || "");
        if (!hrid) {
            continue;
        }

        const summary = {
            hrid,
            name: String(monster?.name || hrid),
            sortIndex: Number(monster?.sortIndex ?? 0),
            isLabyrinthMonster: monster?.isLabyrinthMonster === true,
            dropTable: Array.isArray(monster?.dropTable) ? monster.dropTable : [],
            rareDropTable: Array.isArray(monster?.rareDropTable) ? monster.rareDropTable : [],
        };

        monsterDetailIndex[hrid] = summary;
        monsterNameByHrid[hrid] = summary.name;

        if (summary.isLabyrinthMonster) {
            labyrinthOptions.push({
                hrid,
                name: summary.name,
                sortIndex: summary.sortIndex,
            });
        }
    }

    labyrinthOptions.sort((left, right) => left.sortIndex - right.sortIndex || left.name.localeCompare(right.name));

    return {
        monsterDetailIndex,
        monsterNameByHrid,
        labyrinthOptions,
    };
}

function createHouseRoomIndex(houseRoomDetailMap) {
    const houseRoomDetailIndex = {};
    const houseRoomNameByHrid = {};
    const houseRoomOptions = [];
    const houseRoomHrids = [];

    for (const room of Object.values(houseRoomDetailMap || {})) {
        const hrid = String(room?.hrid || "");
        if (!hrid) {
            continue;
        }

        const summary = {
            hrid,
            name: String(room?.name || hrid),
            sortIndex: Number(room?.sortIndex ?? 0),
            upgradeCostsMap: room?.upgradeCostsMap && typeof room.upgradeCostsMap === "object" ? room.upgradeCostsMap : {},
        };

        houseRoomDetailIndex[hrid] = summary;
        houseRoomNameByHrid[hrid] = summary.name;
        houseRoomHrids.push(hrid);
        houseRoomOptions.push({
            hrid,
            name: summary.name,
            sortIndex: summary.sortIndex,
        });
    }

    houseRoomOptions.sort((left, right) => left.sortIndex - right.sortIndex || left.name.localeCompare(right.name));

    return {
        houseRoomDetailIndex,
        houseRoomNameByHrid,
        houseRoomOptions: houseRoomOptions.map(({ hrid, name }) => ({ hrid, name })),
        houseRoomHrids,
    };
}

function normalizeNumberTable(table) {
    if (Array.isArray(table)) {
        return table.map((value) => Number(value ?? 0));
    }

    if (!table || typeof table !== "object") {
        return [];
    }

    const numericEntries = Object.entries(table)
        .map(([key, value]) => [Number(key), Number(value ?? 0)])
        .filter(([key]) => Number.isInteger(key) && key >= 0)
        .sort(([left], [right]) => left - right);
    if (numericEntries.length === 0) {
        return [];
    }

    const result = Array(numericEntries[numericEntries.length - 1][0] + 1).fill(0);
    for (const [key, value] of numericEntries) {
        result[key] = value;
    }
    return result;
}

function normalizeItemAmounts(items) {
    if (!Array.isArray(items)) {
        return [];
    }

    return items
        .map((entry) => ({
            itemHrid: String(entry?.itemHrid || ""),
            count: Number(entry?.count ?? 0),
        }))
        .filter((entry) => entry.itemHrid && Number.isFinite(entry.count) && entry.count > 0);
}

function normalizeLootDrops(drops) {
    if (!Array.isArray(drops)) {
        return [];
    }

    return drops
        .map((entry) => ({
            itemHrid: String(entry?.itemHrid || ""),
            dropRate: Number(entry?.dropRate ?? 0),
            dropRatePerDifficultyTier: Number(entry?.dropRatePerDifficultyTier ?? 0),
            minCount: Number(entry?.minCount ?? 0),
            maxCount: Number(entry?.maxCount ?? 0),
        }))
        .filter((entry) => (
            entry.itemHrid
            && Number.isFinite(entry.dropRate)
            && Number.isFinite(entry.dropRatePerDifficultyTier)
            && Number.isFinite(entry.minCount)
            && Number.isFinite(entry.maxCount)
            && entry.maxCount > 0
        ));
}

function createEnhancementAcquisitionIndex({
    actionDetailMap,
    enhanceableItems,
    itemDetailMap,
    openableLootDropMap,
}) {
    const nonTradableEnhanceableHrids = new Set(
        enhanceableItems
            .filter((item) => item?.isTradable === false)
            .map((item) => String(item?.hrid || ""))
            .filter(Boolean),
    );
    const dungeonSourcesByContainerHrid = new Map();

    for (const action of Object.values(actionDetailMap || {})) {
        if (action?.combatZoneInfo?.isDungeon !== true) {
            continue;
        }
        const actionHrid = String(action?.hrid || "");
        const entryKeyItemHrid = String(action?.combatZoneInfo?.dungeonInfo?.keyItemHrid || "");
        if (!actionHrid) {
            continue;
        }
        for (const reward of normalizeLootDrops(action?.combatZoneInfo?.dungeonInfo?.rewardDropTable)) {
            if (reward.dropRate <= 0) {
                continue;
            }
            const sources = dungeonSourcesByContainerHrid.get(reward.itemHrid) || [];
            sources.push({
                actionHrid,
                difficultyTier: 0,
                entryKeyItemHrid,
                containerDropRate: reward.dropRate,
                containerMinCount: reward.minCount,
                containerMaxCount: reward.maxCount,
            });
            dungeonSourcesByContainerHrid.set(reward.itemHrid, sources);
        }
    }

    const openablesByHrid = {};
    const sourcesByItemHrid = {};
    for (const [containerHrid, rawDrops] of Object.entries(openableLootDropMap || {})) {
        const dungeonSources = dungeonSourcesByContainerHrid.get(containerHrid) || [];
        if (dungeonSources.length === 0) {
            continue;
        }
        const drops = normalizeLootDrops(rawDrops).filter((drop) => drop.dropRate > 0);
        const targetHrids = Array.from(new Set(
            drops
                .map((drop) => drop.itemHrid)
                .filter((itemHrid) => nonTradableEnhanceableHrids.has(itemHrid)),
        ));
        if (targetHrids.length === 0) {
            continue;
        }

        openablesByHrid[containerHrid] = {
            hrid: containerHrid,
            openKeyItemHrid: String(itemDetailMap?.[containerHrid]?.openKeyItemHrid || ""),
            drops,
        };
        for (const itemHrid of targetHrids) {
            const itemDrops = drops.filter((drop) => drop.itemHrid === itemHrid);
            const sources = sourcesByItemHrid[itemHrid] || [];
            for (const dungeonSource of dungeonSources) {
                sources.push({
                    type: "dungeon_openable",
                    itemHrid,
                    containerHrid,
                    itemDrops,
                    ...dungeonSource,
                });
            }
            sourcesByItemHrid[itemHrid] = sources;
        }
    }

    for (const sources of Object.values(sourcesByItemHrid)) {
        sources.sort((left, right) => (
            String(left?.actionHrid || "").localeCompare(String(right?.actionHrid || ""))
            || String(left?.containerHrid || "").localeCompare(String(right?.containerHrid || ""))
        ));
    }

    return { openablesByHrid, sourcesByItemHrid };
}

function createBuffSummary(buff) {
    const typeHrid = String(buff?.typeHrid || "");
    if (!typeHrid) {
        return null;
    }

    return {
        uniqueHrid: String(buff?.uniqueHrid || ""),
        typeHrid,
        ratioBoost: Number(buff?.ratioBoost ?? 0),
        ratioBoostLevelBonus: Number(buff?.ratioBoostLevelBonus ?? 0),
        flatBoost: Number(buff?.flatBoost ?? 0),
        flatBoostLevelBonus: Number(buff?.flatBoostLevelBonus ?? 0),
    };
}

function normalizeBuffs(buffs) {
    const source = Array.isArray(buffs) ? buffs : (buffs && typeof buffs === "object" ? [buffs] : []);
    return source.map(createBuffSummary).filter(Boolean);
}

function resolveBuffDurationSeconds(buffs) {
    const source = Array.isArray(buffs) ? buffs : (buffs && typeof buffs === "object" ? [buffs] : []);
    const durations = source
        .map((buff) => Number(buff?.duration ?? 0) / NANOSECONDS_PER_SECOND)
        .filter((duration) => Number.isFinite(duration) && duration > 0);
    return durations.length > 0 ? Math.min(...durations) : 0;
}

function createEnhancementCatalogItem(item) {
    const hrid = String(item?.hrid || "");
    return {
        hrid,
        name: String(item?.name || hrid),
        categoryHrid: String(item?.categoryHrid || ""),
        itemLevel: Number(item?.itemLevel ?? 0),
        sellPrice: Math.max(0, Number(item?.sellPrice ?? 0)),
        sortIndex: Number(item?.sortIndex ?? 0),
        isTradable: item?.isTradable === true,
    };
}

function hasEnhancementSupportStat(stats) {
    return Object.keys(stats || {}).some((key) => (
        key.startsWith("enhancing")
        || key === "skillingSpeed"
        || key === "skillingExperience"
        || key === "actionSpeed"
        || key === "wisdom"
        || key === "drinkConcentration"
    ));
}

function createEnhancementIndex({
    actionDetailMap,
    achievementTierDetailMap,
    communityBuffTypeDetailMap,
    enhancementLevelSuccessRateTable,
    enhancementLevelTotalBonusMultiplierTable,
    houseRoomDetailMap,
    itemDetailMap,
    openableLootDropMap,
}) {
    const enhanceableItems = [];
    const materialHrids = new Set([
        ENHANCEMENT_SPECIAL_ITEM_HRIDS.coin,
        ENHANCEMENT_SPECIAL_ITEM_HRIDS.enhancingEssence,
        ENHANCEMENT_SPECIAL_ITEM_HRIDS.philosophersMirror,
    ]);
    const protectionItemHrids = new Set([ENHANCEMENT_SPECIAL_ITEM_HRIDS.mirrorOfProtection]);
    const supportEquipment = [];
    const enhancingDrinks = [];

    for (const item of Object.values(itemDetailMap || {})) {
        const hrid = String(item?.hrid || "");
        if (!hrid) {
            continue;
        }

        const enhancementCosts = normalizeItemAmounts(item?.enhancementCosts);
        if (enhancementCosts.length > 0) {
            const declaredProtectionItemHrids = Array.isArray(item?.protectionItemHrids)
                ? item.protectionItemHrids.map((value) => String(value || "")).filter(Boolean)
                : [];
            const baseItemHrids = Array.isArray(item?.baseItemHrids)
                ? item.baseItemHrids.map((value) => String(value || "")).filter(Boolean)
                : [];

            enhanceableItems.push({
                ...createEnhancementCatalogItem(item),
                equipmentType: String(item?.equipmentDetail?.type || ""),
                isTradable: item?.isTradable === true,
                enhancementCosts,
                protectionItemHrids: declaredProtectionItemHrids,
                baseItemHrids,
                decomposeItems: normalizeItemAmounts(item?.alchemyDetail?.decomposeItems),
            });

            for (const cost of enhancementCosts) {
                materialHrids.add(cost.itemHrid);
            }
            for (const protectionItemHrid of declaredProtectionItemHrids) {
                protectionItemHrids.add(protectionItemHrid);
            }
        }

        const noncombatStats = item?.equipmentDetail?.noncombatStats || {};
        const noncombatEnhancementBonuses = item?.equipmentDetail?.noncombatEnhancementBonuses || {};
        if (hasEnhancementSupportStat(noncombatStats) || hasEnhancementSupportStat(noncombatEnhancementBonuses)) {
            supportEquipment.push({
                ...createEnhancementCatalogItem(item),
                equipmentType: String(item?.equipmentDetail?.type || ""),
                noncombatStats,
                noncombatEnhancementBonuses,
            });
        }

        const buffs = normalizeBuffs(item?.consumableDetail?.buffs);
        if (
            String(item?.categoryHrid || "") === "/item_categories/drink"
            && buffs.some((buff) => ENHANCEMENT_DRINK_BUFF_TYPE_HRIDS.has(buff.typeHrid))
        ) {
            enhancingDrinks.push({
                ...createEnhancementCatalogItem(item),
                durationSeconds: resolveBuffDurationSeconds(item?.consumableDetail?.buffs),
                buffs,
            });
            materialHrids.add(hrid);
        }
    }

    const compareCatalogItems = (left, right) => (
        Number(left?.itemLevel ?? 0) - Number(right?.itemLevel ?? 0)
        || Number(left?.sortIndex ?? 0) - Number(right?.sortIndex ?? 0)
        || String(left?.name || "").localeCompare(String(right?.name || ""))
    );
    enhanceableItems.sort(compareCatalogItems);
    supportEquipment.sort(compareCatalogItems);
    enhancingDrinks.sort(compareCatalogItems);

    const catalogItemsForHrids = (hrids) => Array.from(hrids)
        .map((hrid) => itemDetailMap?.[hrid])
        .filter(Boolean)
        .map(createEnhancementCatalogItem)
        .sort(compareCatalogItems);

    const observatory = houseRoomDetailMap?.["/house_rooms/observatory"] || {};
    const roomsWithGlobalExperience = Object.values(houseRoomDetailMap || {})
        .filter((room) => normalizeBuffs(room?.globalBuffs).some((buff) => buff.typeHrid === "/buff_types/wisdom"))
        .sort((left, right) => Number(left?.sortIndex ?? 0) - Number(right?.sortIndex ?? 0));
    const globalExperienceBuff = roomsWithGlobalExperience
        .flatMap((room) => normalizeBuffs(room?.globalBuffs))
        .find((buff) => buff.typeHrid === "/buff_types/wisdom") || null;

    const communityBuffs = Object.values(communityBuffTypeDetailMap || {})
        .filter((entry) => entry?.usableInActionTypeMap?.[ENHANCING_ACTION_TYPE_HRID] === true)
        .map((entry) => ({
            hrid: String(entry?.hrid || ""),
            name: String(entry?.name || entry?.hrid || ""),
            sortIndex: Number(entry?.sortIndex ?? 0),
            buff: createBuffSummary(entry?.buff),
        }))
        .filter((entry) => entry.hrid && entry.buff)
        .sort((left, right) => left.sortIndex - right.sortIndex || left.name.localeCompare(right.name));

    const achievementBuffs = Object.values(achievementTierDetailMap || {})
        .filter((entry) => entry?.usableInActionTypeMap?.[ENHANCING_ACTION_TYPE_HRID] === true)
        .map((entry) => ({
            hrid: String(entry?.hrid || ""),
            name: String(entry?.name || entry?.hrid || ""),
            sortIndex: Number(entry?.sortIndex ?? 0),
            buff: createBuffSummary(entry?.buff),
        }))
        .filter((entry) => entry.hrid && entry.buff && ENHANCEMENT_ACHIEVEMENT_BUFF_TYPE_HRIDS.has(entry.buff.typeHrid))
        .sort((left, right) => left.sortIndex - right.sortIndex || left.name.localeCompare(right.name));
    const acquisition = createEnhancementAcquisitionIndex({
        actionDetailMap,
        enhanceableItems,
        itemDetailMap,
        openableLootDropMap,
    });

    return {
        successRates: normalizeNumberTable(enhancementLevelSuccessRateTable),
        totalBonusMultipliers: normalizeNumberTable(enhancementLevelTotalBonusMultiplierTable),
        actionBaseSeconds: ENHANCEMENT_ACTION_BASE_SECONDS,
        specialItemHrids: ENHANCEMENT_SPECIAL_ITEM_HRIDS,
        enhanceableItems,
        materialItems: catalogItemsForHrids(materialHrids),
        protectionItems: catalogItemsForHrids(protectionItemHrids),
        supportEquipment,
        enhancingDrinks,
        housing: {
            observatory: {
                hrid: String(observatory?.hrid || "/house_rooms/observatory"),
                name: String(observatory?.name || "Observatory"),
                actionBuffs: normalizeBuffs(observatory?.actionBuffs),
                globalBuffs: normalizeBuffs(observatory?.globalBuffs),
            },
            globalExperience: {
                roomHrids: roomsWithGlobalExperience.map((room) => String(room?.hrid || "")).filter(Boolean),
                buff: globalExperienceBuff,
            },
        },
        communityBuffs,
        achievementBuffs,
        acquisition,
    };
}

function hasSkillingSupportStat(stats) {
    return Object.keys(stats || {}).some((key) => (
        SKILLING_STAT_PREFIXES.some((prefix) => key.startsWith(prefix))
        || key === "actionSpeed"
        || key === "wisdom"
        || key === "drinkConcentration"
    ));
}

function createSkillingIndex({
    actionDetailMap,
    enhancementLevelTotalBonusMultiplierTable,
    itemDetailMap,
}) {
    const actions = Object.values(actionDetailMap || {})
        .filter((action) => (
            SKILLING_ACTION_FUNCTION_SET.has(String(action?.function || ""))
            && SKILLING_ACTION_TYPE_SET.has(String(action?.type || ""))
        ))
        .map((action) => ({
            hrid: String(action?.hrid || ""),
            name: String(action?.name || action?.hrid || ""),
            type: String(action?.type || ""),
            category: String(action?.category || ""),
            sortIndex: Number(action?.sortIndex ?? 0),
            levelRequirement: {
                skillHrid: String(action?.levelRequirement?.skillHrid || ""),
                level: Number(action?.levelRequirement?.level ?? 1),
            },
            baseTimeSeconds: Number(action?.baseTimeCost ?? 0) / NANOSECONDS_PER_SECOND,
            experienceGain: {
                skillHrid: String(action?.experienceGain?.skillHrid || ""),
                value: Number(action?.experienceGain?.value ?? 0),
            },
            inputItems: normalizeItemAmounts(action?.inputItems),
            outputItems: normalizeItemAmounts(action?.outputItems),
            ...(Array.isArray(action?.dropTable) && action.dropTable.length > 0
                ? { dropTable: normalizeLootDrops(action.dropTable) }
                : {}),
            upgradeItemHrid: String(action?.upgradeItemHrid || ""),
            retainAllEnhancement: action?.retainAllEnhancement === true,
            essenceDropTable: normalizeLootDrops(action?.essenceDropTable),
            rareDropTable: normalizeLootDrops(action?.rareDropTable),
        }))
        .filter((action) => (
            action.hrid
            && action.levelRequirement.skillHrid
            && action.baseTimeSeconds > 0
            && action.experienceGain.value > 0
        ))
        .sort((left, right) => (
            SKILLING_ACTION_TYPE_HRIDS.indexOf(left.type) - SKILLING_ACTION_TYPE_HRIDS.indexOf(right.type)
            || left.sortIndex - right.sortIndex
            || left.name.localeCompare(right.name)
        ));

    const equipment = [];
    const equipmentItemHrids = [];
    const drinks = [];
    for (const item of Object.values(itemDetailMap || {})) {
        const equipmentDetail = item?.equipmentDetail || {};
        const noncombatStats = equipmentDetail?.noncombatStats || {};
        const noncombatEnhancementBonuses = equipmentDetail?.noncombatEnhancementBonuses || {};
        const drinkSlots = Number(equipmentDetail?.combatStats?.drinkSlots ?? 0);
        if (String(item?.categoryHrid || "") === "/item_categories/equipment" && String(item?.hrid || "")) {
            equipmentItemHrids.push(String(item.hrid));
        }
        if (
            String(item?.categoryHrid || "") === "/item_categories/equipment"
            && (
                drinkSlots > 0
                || hasSkillingSupportStat(noncombatStats)
                || hasSkillingSupportStat(noncombatEnhancementBonuses)
            )
        ) {
            equipment.push({
                ...createEnhancementCatalogItem(item),
                equipmentType: String(equipmentDetail?.type || ""),
                levelRequirements: Array.isArray(equipmentDetail?.levelRequirements)
                    ? equipmentDetail.levelRequirements.map((requirement) => ({
                        skillHrid: String(requirement?.skillHrid || ""),
                        level: Number(requirement?.level ?? 1),
                    })).filter((requirement) => requirement.skillHrid)
                    : [],
                drinkSlots: Math.max(0, drinkSlots),
                noncombatStats,
                noncombatEnhancementBonuses,
            });
        }

        const usableInActionTypeMap = Object.fromEntries(
            SKILLING_ACTION_TYPE_HRIDS
                .filter((actionTypeHrid) => item?.consumableDetail?.usableInActionTypeMap?.[actionTypeHrid] === true)
                .map((actionTypeHrid) => [actionTypeHrid, true])
        );
        const buffs = normalizeBuffs(item?.consumableDetail?.buffs);
        if (
            String(item?.categoryHrid || "") === "/item_categories/drink"
            && Object.keys(usableInActionTypeMap).length > 0
            && buffs.length > 0
        ) {
            drinks.push({
                ...createEnhancementCatalogItem(item),
                usableInActionTypeMap,
                durationSeconds: resolveBuffDurationSeconds(item?.consumableDetail?.buffs),
                buffs,
            });
        }
    }

    const compareCatalogItems = (left, right) => (
        Number(left?.itemLevel ?? 0) - Number(right?.itemLevel ?? 0)
        || Number(left?.sortIndex ?? 0) - Number(right?.sortIndex ?? 0)
        || String(left?.name || "").localeCompare(String(right?.name || ""))
    );
    equipment.sort(compareCatalogItems);
    drinks.sort(compareCatalogItems);

    return {
        actionTypeHrids: SKILLING_ACTION_TYPE_HRIDS,
        skillHrids: SKILLING_SKILL_HRIDS,
        actions,
        equipment,
        equipmentItemHrids: Array.from(new Set(equipmentItemHrids)).sort(),
        drinks,
        totalBonusMultipliers: normalizeNumberTable(enhancementLevelTotalBonusMultiplierTable),
    };
}

async function main() {
    const [
        abilityDetailMap,
        achievementTierDetailMap,
        levelExperienceTable,
        actionDetailMap,
        combatMonsterDetailMap,
        communityBuffTypeDetailMap,
        enhancementLevelSuccessRateTable,
        enhancementLevelTotalBonusMultiplierTable,
        equipmentTypeDetailMap,
        houseRoomDetailMap,
        itemDetailMap,
        openableLootDropMap,
    ] = await Promise.all([
        readJsonFile("abilityDetailMap.json"),
        readJsonFile("achievementTierDetailMap.json"),
        readJsonFile("levelExperienceTable.json"),
        readJsonFile("actionDetailMap.json"),
        readJsonFile("combatMonsterDetailMap.json"),
        readJsonFile("communityBuffTypeDetailMap.json"),
        readJsonFile("enhancementLevelSuccessRateTable.json"),
        readJsonFile("enhancementLevelTotalBonusMultiplierTable.json"),
        readJsonFile("equipmentTypeDetailMap.json"),
        readJsonFile("houseRoomDetailMap.json"),
        readJsonFile("itemDetailMap.json"),
        readJsonFile("openableLootDropMap.json"),
    ]);

    const itemIndex = createItemIndex(itemDetailMap, equipmentTypeDetailMap);
    const abilityIndex = createAbilityIndex(abilityDetailMap);
    const actionIndex = createActionIndex(actionDetailMap);
    const monsterIndex = createMonsterIndex(combatMonsterDetailMap);
    const houseRoomIndex = createHouseRoomIndex(houseRoomDetailMap);
    const enhancementData = createEnhancementIndex({
        actionDetailMap,
        achievementTierDetailMap,
        communityBuffTypeDetailMap,
        enhancementLevelSuccessRateTable,
        enhancementLevelTotalBonusMultiplierTable,
        houseRoomDetailMap,
        itemDetailMap,
        openableLootDropMap,
    });
    const skillingData = createSkillingIndex({
        actionDetailMap,
        enhancementLevelTotalBonusMultiplierTable,
        itemDetailMap,
    });

    const payload = {
        metadata: {
            generatedAt: new Date().toISOString(),
            levelKeys: LEVEL_KEYS,
            equipmentSlotKeys: EQUIPMENT_SLOT_KEYS,
        },
        ...itemIndex,
        ...abilityIndex,
        ...actionIndex,
        ...monsterIndex,
        ...houseRoomIndex,
        levelExperienceTable: Array.isArray(levelExperienceTable) ? levelExperienceTable : [],
        enhancementData,
        skillingData,
    };

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`Wrote ${path.relative(projectRoot, outputPath)}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

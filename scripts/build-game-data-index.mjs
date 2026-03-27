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
const LABYRINTH_COFFEE_CRATE_HRIDS = ["/items/basic_coffee_crate", "/items/advanced_coffee_crate", "/items/expert_coffee_crate"];
const LABYRINTH_FOOD_CRATE_HRIDS = ["/items/basic_food_crate", "/items/advanced_food_crate", "/items/expert_food_crate"];

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

function createItemIndex(itemDetailMap) {
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
            const slotName = equipmentType.replace("/equipment_types/", "");
            if (slotName === "main_hand" || slotName === "two_hand") {
                equipmentBySlot.weapon.push({
                    hrid,
                    name: option.name,
                    itemLevel,
                });
            } else if (equipmentBySlot[slotName]) {
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

async function main() {
    const [
        abilityDetailMap,
        abilityXpLevels,
        actionDetailMap,
        combatMonsterDetailMap,
        houseRoomDetailMap,
        itemDetailMap,
    ] = await Promise.all([
        readJsonFile("abilityDetailMap.json"),
        readJsonFile("abilityXpLevels.json"),
        readJsonFile("actionDetailMap.json"),
        readJsonFile("combatMonsterDetailMap.json"),
        readJsonFile("houseRoomDetailMap.json"),
        readJsonFile("itemDetailMap.json"),
    ]);

    const itemIndex = createItemIndex(itemDetailMap);
    const abilityIndex = createAbilityIndex(abilityDetailMap);
    const actionIndex = createActionIndex(actionDetailMap);
    const monsterIndex = createMonsterIndex(combatMonsterDetailMap);
    const houseRoomIndex = createHouseRoomIndex(houseRoomDetailMap);

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
        abilityXpLevels: Array.isArray(abilityXpLevels) ? abilityXpLevels : [],
    };

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`Wrote ${path.relative(projectRoot, outputPath)}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

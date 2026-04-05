const fs = require("fs");
const path = require("path");

const REQUIRED_CLIENT_DATA_KEYS = Object.freeze([
    "abilityDetailMap",
    "achievementDetailMap",
    "actionDetailMap",
    "combatMonsterDetailMap",
    "itemDetailMap",
    "openableLootDropMap",
]);

const DEFAULT_TRACKED_GAME_DATA_FILES = Object.freeze([
    "abilityDetailMap.json",
    "abilitySlotsLevelRequirementList.json",
    "levelExperienceTable.json",
    "achievementDetailMap.json",
    "achievementTierDetailMap.json",
    "actionDetailMap.json",
    "buffTypeDetailMap.json",
    "combatMonsterDetailMap.json",
    "combatStyleDetailMap.json",
    "combatTriggerComparatorDetailMap.json",
    "combatTriggerConditionDetailMap.json",
    "combatTriggerDependencyDetailMap.json",
    "communityBuffTypeDetailMap.json",
    "damageTypeDetailMap.json",
    "enhancementLevelTotalBonusMultiplierTable.json",
    "equipmentTypeDetailMap.json",
    "houseRoomDetailMap.json",
    "itemCategoryDetailMap.json",
    "itemDetailMap.json",
    "itemLocationDetailMap.json",
    "labyrinthCrateDetailMap.json",
    "openableLootDropMap.json",
    "skillDetailMap.json",
]);

const OPTIONAL_TRACKED_GAME_DATA_FALLBACKS = Object.freeze({
    buffTypeDetailMap: Object.freeze({}),
    communityBuffTypeDetailMap: Object.freeze({}),
    itemCategoryDetailMap: Object.freeze({}),
    skillDetailMap: Object.freeze({}),
});

const TRACKED_GAME_DATA_DIR = path.resolve(__dirname, "..", "src", "combatsimulator", "data");

function getTrackedGameDataFileNames() {
    if (!fs.existsSync(TRACKED_GAME_DATA_DIR)) {
        return [...DEFAULT_TRACKED_GAME_DATA_FILES];
    }

    const fileNames = fs.readdirSync(TRACKED_GAME_DATA_DIR, { withFileTypes: true })
        .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".json")
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));

    if (fileNames.length === 0) {
        return [...DEFAULT_TRACKED_GAME_DATA_FILES];
    }

    return Array.from(new Set([
        ...DEFAULT_TRACKED_GAME_DATA_FILES,
        ...fileNames,
    ])).sort((left, right) => left.localeCompare(right));
}

function createTargetMapFiles() {
    return getTrackedGameDataFileNames().reduce((acc, fileName) => {
        acc[path.parse(fileName).name] = fileName;
        return acc;
    }, {});
}

const TARGET_MAP_FILES = Object.freeze(createTargetMapFiles());

function hasRequiredClientDataKeys(obj) {
    if (!obj || typeof obj !== "object") {
        return false;
    }
    return REQUIRED_CLIENT_DATA_KEYS.every((key) => Object.prototype.hasOwnProperty.call(obj, key));
}

function getMissingTargetKeys(clientData, targetMapFiles = TARGET_MAP_FILES) {
    if (!clientData || typeof clientData !== "object") {
        return Object.keys(targetMapFiles);
    }

    return Object.keys(targetMapFiles).filter((key) => (
        !Object.prototype.hasOwnProperty.call(clientData, key) || typeof clientData[key] === "undefined"
    ));
}

function writeMapFiles(clientData, outputDir, targetMapFiles = TARGET_MAP_FILES) {
    fs.mkdirSync(outputDir, { recursive: true });
    const written = [];
    const reset = [];
    const skipped = [];

    for (const [mapKey, fileName] of Object.entries(targetMapFiles)) {
        if (!clientData || typeof clientData !== "object" || !Object.prototype.hasOwnProperty.call(clientData, mapKey)) {
            if (Object.prototype.hasOwnProperty.call(OPTIONAL_TRACKED_GAME_DATA_FALLBACKS, mapKey)) {
                const filePath = path.join(outputDir, fileName);
                fs.writeFileSync(
                    filePath,
                    `${JSON.stringify(OPTIONAL_TRACKED_GAME_DATA_FALLBACKS[mapKey], null, 4)}\n`,
                    "utf8",
                );
                reset.push(fileName);
                continue;
            }

            skipped.push(fileName);
            continue;
        }

        const filePath = path.join(outputDir, fileName);
        fs.writeFileSync(filePath, `${JSON.stringify(clientData[mapKey], null, 4)}\n`, "utf8");
        written.push(filePath);
    }

    return {
        written,
        reset,
        skipped,
    };
}

module.exports = {
    OPTIONAL_TRACKED_GAME_DATA_FALLBACKS,
    REQUIRED_CLIENT_DATA_KEYS,
    TARGET_MAP_FILES,
    TRACKED_GAME_DATA_DIR,
    getTrackedGameDataFileNames,
    hasRequiredClientDataKeys,
    writeMapFiles,
};

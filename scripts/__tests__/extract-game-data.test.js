import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = path.resolve("scripts/extract-game-data.js");

const BASE_CLIENT_DATA = {
    abilityDetailMap: {
        "/abilities/test": {
            hrid: "/abilities/test",
            name: "Test Ability",
        },
    },
    achievementDetailMap: {
        "/achievements/test": {
            hrid: "/achievements/test",
            name: "Test Achievement",
        },
    },
    actionDetailMap: {
        "/actions/combat/test": {
            hrid: "/actions/combat/test",
            name: "Test Action",
        },
    },
    combatMonsterDetailMap: {
        "/combat_monsters/test": {
            hrid: "/combat_monsters/test",
            name: "Test Monster",
        },
    },
    itemDetailMap: {
        "/items/test": {
            hrid: "/items/test",
            name: "Test Item",
        },
    },
    openableLootDropMap: {
        "/items/test_box": {
            hrid: "/items/test_box",
            loot: [],
        },
    },
    abilitySlotsLevelRequirementList: [
        {
            level: 1,
            abilitySlots: 1,
        },
    ],
    levelExperienceTable: [0, 100],
    achievementTierDetailMap: {
        "/achievement_tiers/test": {
            hrid: "/achievement_tiers/test",
            name: "Test Tier",
        },
    },
    combatStyleDetailMap: {
        "/combat_styles/test": {
            hrid: "/combat_styles/test",
            name: "Test Combat Style",
        },
    },
    combatTriggerComparatorDetailMap: {
        "/combat_trigger_comparators/test": {
            hrid: "/combat_trigger_comparators/test",
            name: "Test Comparator",
        },
    },
    combatTriggerConditionDetailMap: {
        "/combat_trigger_conditions/test": {
            hrid: "/combat_trigger_conditions/test",
            name: "Test Condition",
        },
    },
    combatTriggerDependencyDetailMap: {
        "/combat_trigger_dependencies/test": {
            hrid: "/combat_trigger_dependencies/test",
            name: "Test Dependency",
        },
    },
    damageTypeDetailMap: {
        "/damage_types/test": {
            hrid: "/damage_types/test",
            name: "Test Damage Type",
        },
    },
    enhancementLevelTotalBonusMultiplierTable: {
        "0": 1,
        "1": 1.1,
    },
    houseRoomDetailMap: {
        "/house_rooms/test": {
            hrid: "/house_rooms/test",
            name: "Test Room",
        },
    },
    itemLocationDetailMap: {
        "/item_locations/test": {
            hrid: "/item_locations/test",
            name: "Test Item Location",
        },
    },
    equipmentTypeDetailMap: {
        "/equipment_types/test": {
            hrid: "/equipment_types/test",
            name: "Test Equipment Type",
            itemLocationHrid: "/item_locations/test",
            sortIndex: 1,
        },
    },
    labyrinthCrateDetailMap: {
        "/items/test_crate": {
            hrid: "/items/test_crate",
            name: "Test Crate",
        },
    },
    versionTimestamp: 1234567890,
    extraDetailMap: {
        "/extra/test": {
            hrid: "/extra/test",
        },
    },
};

const EXPECTED_OUTPUT_FILES = [
    "abilityDetailMap.json",
    "abilitySlotsLevelRequirementList.json",
    "levelExperienceTable.json",
    "achievementDetailMap.json",
    "achievementTierDetailMap.json",
    "actionDetailMap.json",
    "combatMonsterDetailMap.json",
    "combatStyleDetailMap.json",
    "combatTriggerComparatorDetailMap.json",
    "combatTriggerConditionDetailMap.json",
    "combatTriggerDependencyDetailMap.json",
    "damageTypeDetailMap.json",
    "enhancementLevelTotalBonusMultiplierTable.json",
    "houseRoomDetailMap.json",
    "equipmentTypeDetailMap.json",
    "itemDetailMap.json",
    "itemLocationDetailMap.json",
    "labyrinthCrateDetailMap.json",
    "openableLootDropMap.json",
].sort();

const EXPECTED_OUTPUT_FILES_WITHOUT_LEVEL_EXPERIENCE_TABLE = EXPECTED_OUTPUT_FILES.filter(
    (fileName) => fileName !== "levelExperienceTable.json",
);

const tempDirs = [];

function createTempDir() {
    const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), "mwi-extract-game-data-"));
    tempDirs.push(dirPath);
    return dirPath;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
});

describe("extract-game-data CLI", () => {
    it("writes the full resolved clientData JSON when --all is enabled", () => {
        const tempDir = createTempDir();
        const inputPath = path.join(tempDir, "initClientData.json");
        const outputDir = path.join(tempDir, "maps");
        const allOutputPath = path.join(tempDir, "initClientData.full.json");

        fs.writeFileSync(inputPath, `${JSON.stringify(BASE_CLIENT_DATA, null, 2)}\n`, "utf8");

        execFileSync(
            process.execPath,
            [
                SCRIPT_PATH,
                "--input",
                inputPath,
                "--output",
                outputDir,
                "--all",
                "--all-output",
                allOutputPath,
            ],
            {
                cwd: path.resolve("."),
                stdio: "pipe",
            },
        );

        expect(fs.readdirSync(outputDir).sort()).toEqual(EXPECTED_OUTPUT_FILES);
        expect(fs.existsSync(allOutputPath)).toBe(true);
        expect(JSON.parse(fs.readFileSync(allOutputPath, "utf8"))).toEqual(BASE_CLIENT_DATA);
    });

    it("skips tracked files that are missing from payload and still writes --all output", () => {
        const tempDir = createTempDir();
        const inputPath = path.join(tempDir, "initClientData.json");
        const outputDir = path.join(tempDir, "maps");
        const allOutputPath = path.join(tempDir, "initClientData.full.json");
        const clientDataWithoutLevelExperienceTable = { ...BASE_CLIENT_DATA };

        delete clientDataWithoutLevelExperienceTable.levelExperienceTable;

        fs.writeFileSync(inputPath, `${JSON.stringify(clientDataWithoutLevelExperienceTable, null, 2)}\n`, "utf8");

        const output = execFileSync(
            process.execPath,
            [
                SCRIPT_PATH,
                "--input",
                inputPath,
                "--output",
                outputDir,
                "--all",
                "--all-output",
                allOutputPath,
            ],
            {
                cwd: path.resolve("."),
                stdio: "pipe",
            },
        ).toString("utf8");

        expect(fs.readdirSync(outputDir).sort()).toEqual(EXPECTED_OUTPUT_FILES_WITHOUT_LEVEL_EXPERIENCE_TABLE);
        expect(output).toContain("Skipped 1 tracked game-data file because the payload did not include it:");
        expect(output).toContain("levelExperienceTable.json");
        expect(fs.existsSync(allOutputPath)).toBe(true);
        expect(JSON.parse(fs.readFileSync(allOutputPath, "utf8"))).toEqual(clientDataWithoutLevelExperienceTable);
    });
});

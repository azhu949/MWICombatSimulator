import { describe, expect, it } from "vitest";
import combatMonsterDetailMap from "../../combatsimulator/data/combatMonsterDetailMap.json";
import { buildRandomProfitBreakdown } from "../profitEstimator.js";
import { resolveMarketPrice } from "../marketPriceService.js";

const PLAYER_HRIDS = ["player1", "player2", "player3", "player4", "player5"];

function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function createSeededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state ^= state << 13;
        state >>>= 0;
        state ^= state >>> 17;
        state >>>= 0;
        state ^= state << 5;
        state >>>= 0;
        return (state >>> 0) / 4294967296;
    };
}

function legacyFidDropAmount(dropAmount, randomFn) {
    if (Number.isInteger(dropAmount)) {
        return dropAmount;
    }
    const intPart = Math.floor(dropAmount);
    const fracPart = dropAmount - intPart;
    return randomFn() < fracPart ? intPart + 1 : intPart;
}

function hasPlayerScopedData(simResult, playerHrid) {
    if (!simResult || !playerHrid) {
        return false;
    }

    return simResult.dropRateMultiplier?.[playerHrid] != null
        || simResult.experienceGained?.[playerHrid] != null
        || simResult.attacks?.[playerHrid] != null
        || simResult.consumablesUsed?.[playerHrid] != null
        || simResult.manaUsed?.[playerHrid] != null
        || simResult.debuffOnLevelGap?.[playerHrid] != null;
}

function resolveSimResultPlayerHrid(simResult, preferredPlayerId) {
    const preferred = String(preferredPlayerId || "").trim();
    if (preferred) {
        const normalized = preferred.startsWith("player") ? preferred : `player${preferred}`;
        if (PLAYER_HRIDS.includes(normalized) && hasPlayerScopedData(simResult, normalized)) {
            return normalized;
        }
    }

    const playerMaps = [
        simResult.dropRateMultiplier,
        simResult.experienceGained,
        simResult.attacks,
        simResult.consumablesUsed,
        simResult.manaUsed,
        simResult.debuffOnLevelGap,
    ];

    for (const mapObject of playerMaps) {
        if (!mapObject) {
            continue;
        }
        const firstPlayerKey = Object.keys(mapObject).find((key) => PLAYER_HRIDS.includes(key));
        if (firstPlayerKey) {
            return firstPlayerKey;
        }
    }

    return null;
}

function legacyTotalDropMap(simResult, playerToDisplay, randomFn) {
    if (!simResult || simResult.isDungeon) {
        return { totalDropMap: new Map(), resolvedPlayer: "player1" };
    }

    const preferredId = String(playerToDisplay ?? "1").replace("player", "");
    const resolvedPlayer = resolveSimResultPlayerHrid(simResult, preferredId) ?? playerToDisplay ?? "player1";
    const dropRateMultiplier = toFiniteNumber(simResult.dropRateMultiplier?.[resolvedPlayer], 1);
    const rareFindMultiplier = toFiniteNumber(simResult.rareFindMultiplier?.[resolvedPlayer], 1);
    const combatDropQuantity = toFiniteNumber(simResult.combatDropQuantity?.[resolvedPlayer], 0);
    const debuffOnLevelGap = toFiniteNumber(simResult.debuffOnLevelGap?.[resolvedPlayer], 0);
    const numberOfPlayers = Math.max(1, toFiniteNumber(simResult.numberOfPlayers, 1));

    const monsters = Object.keys(simResult.deaths ?? {})
        .filter((enemy) => !PLAYER_HRIDS.includes(enemy))
        .sort();

    const totalDropMap = new Map();
    for (const monsterHrid of monsters) {
        const deathsCount = Math.max(0, Math.floor(toFiniteNumber(simResult.deaths?.[monsterHrid], 0)));
        if (deathsCount <= 0) {
            continue;
        }

        const monster = combatMonsterDetailMap[monsterHrid];
        if (!monster?.dropTable) {
            continue;
        }

        const dropMap = new Map();
        const rareDropMap = new Map();
        for (const drop of monster.dropTable) {
            const difficultyTier = toFiniteNumber(simResult.difficultyTier, 0);
            if (toFiniteNumber(drop.minDifficultyTier, 0) > difficultyTier) {
                continue;
            }
            const multiplier = 1 + 0.1 * difficultyTier;
            const dropRate = Math.min(
                1,
                multiplier * (toFiniteNumber(drop.dropRate, 0) + toFiniteNumber(drop.dropRatePerDifficultyTier, 0) * difficultyTier)
            );
            if (dropRate <= 0) {
                continue;
            }
            dropMap.set(drop.itemHrid, {
                dropRate: Math.min(1, dropRate * dropRateMultiplier),
                number: 0,
                dropMin: toFiniteNumber(drop.minCount, 0),
                dropMax: toFiniteNumber(drop.maxCount, 0),
            });
        }

        for (const drop of (monster.rareDropTable ?? [])) {
            const difficultyTier = toFiniteNumber(simResult.difficultyTier, 0);
            if (toFiniteNumber(drop.minDifficultyTier, 0) > difficultyTier) {
                continue;
            }
            rareDropMap.set(drop.itemHrid, {
                dropRate: toFiniteNumber(drop.dropRate, 0) * rareFindMultiplier,
                number: 0,
                dropMin: toFiniteNumber(drop.minCount, 0),
                dropMax: toFiniteNumber(drop.maxCount, 0),
            });
        }

        for (let index = 0; index < deathsCount; index += 1) {
            for (const dropObject of dropMap.values()) {
                if (randomFn() > dropObject.dropRate / numberOfPlayers) {
                    continue;
                }
                const amount = Math.floor(
                    randomFn() * (dropObject.dropMax - dropObject.dropMin + 1) + dropObject.dropMin
                ) * (1 + debuffOnLevelGap) * (1 + combatDropQuantity);
                dropObject.number += legacyFidDropAmount(amount, randomFn);
            }
            for (const dropObject of rareDropMap.values()) {
                if (randomFn() > dropObject.dropRate / numberOfPlayers) {
                    continue;
                }
                const amount = Math.floor(
                    randomFn() * (dropObject.dropMax - dropObject.dropMin + 1) + dropObject.dropMin
                ) * (1 + debuffOnLevelGap) * (1 + combatDropQuantity);
                dropObject.number += legacyFidDropAmount(amount, randomFn);
            }
        }

        for (const [itemHrid, dropObject] of dropMap.entries()) {
            totalDropMap.set(itemHrid, toFiniteNumber(totalDropMap.get(itemHrid), 0) + toFiniteNumber(dropObject.number, 0));
        }
        for (const [itemHrid, dropObject] of rareDropMap.entries()) {
            totalDropMap.set(itemHrid, toFiniteNumber(totalDropMap.get(itemHrid), 0) + toFiniteNumber(dropObject.number, 0));
        }
    }

    return { totalDropMap, resolvedPlayer };
}

function buildPriceTableFromSimResult(simResult) {
    const table = {
        "/items/coin": { ask: 1, bid: 1, vendor: 1 },
    };

    for (const monsterHrid of Object.keys(simResult.deaths ?? {})) {
        const monster = combatMonsterDetailMap[monsterHrid];
        if (!monster) {
            continue;
        }
        for (const drop of (monster.dropTable ?? [])) {
            if (!table[drop.itemHrid]) {
                table[drop.itemHrid] = { ask: 2, bid: 2, vendor: 2 };
            }
        }
        for (const drop of (monster.rareDropTable ?? [])) {
            if (!table[drop.itemHrid]) {
                table[drop.itemHrid] = { ask: 2, bid: 2, vendor: 2 };
            }
        }
    }
    return table;
}

function createCase(seed) {
    const monsterKeys = Object.keys(combatMonsterDetailMap)
        .filter((key) => Array.isArray(combatMonsterDetailMap[key]?.dropTable) && combatMonsterDetailMap[key].dropTable.length > 0);

    const simResult = {
        isDungeon: false,
        numberOfPlayers: 1 + (seed % 3),
        difficultyTier: seed % 6,
        deaths: {},
        dropRateMultiplier: { player1: 1 + (seed % 4) * 0.1 },
        rareFindMultiplier: { player1: 1 + (seed % 5) * 0.05 },
        combatDropQuantity: { player1: (seed % 3) * 0.1 },
        debuffOnLevelGap: { player1: -0.1 * (seed % 2) },
        consumablesUsed: {
            player1: {
                "/items/coin": 5 + (seed % 5),
            },
        },
    };

    for (let index = 0; index < 3; index += 1) {
        const monsterHrid = monsterKeys[(seed + index * 11) % monsterKeys.length];
        simResult.deaths[monsterHrid] = 10 + ((seed * (index + 2)) % 25);
    }

    return simResult;
}

describe("profitEstimator random parity", () => {
    it("matches legacy random drop revenue for representative seeds", () => {
        for (let seed = 1; seed <= 120; seed += 1) {
            const simResult = createCase(seed);
            const priceTable = buildPriceTableFromSimResult(simResult);
            const legacyRandom = createSeededRandom(seed);
            const nowRandom = createSeededRandom(seed);

            const legacy = legacyTotalDropMap(simResult, "player1", legacyRandom);
            let legacyRevenue = 0;
            for (const [itemHrid, amount] of legacy.totalDropMap.entries()) {
                legacyRevenue += resolveMarketPrice(priceTable, itemHrid, "bid") * toFiniteNumber(amount, 0);
            }

            const now = buildRandomProfitBreakdown(simResult, "player1", {
                dropMode: "bid",
                consumableMode: "ask",
                priceTable,
                randomSource: nowRandom,
                useDropCache: false,
            });

            expect(now.revenue).toBe(legacyRevenue);
        }
    });

    it("matches legacy player fallback behavior", () => {
        const simResult = createCase(42);
        simResult.dropRateMultiplier = { player1: 1.25 };
        simResult.rareFindMultiplier = { player1: 1.1 };
        simResult.combatDropQuantity = { player1: 0.2 };
        simResult.debuffOnLevelGap = { player1: -0.1 };
        simResult.consumablesUsed = {
            player1: {
                "/items/coin": 9,
            },
        };

        const priceTable = buildPriceTableFromSimResult(simResult);
        const legacyRandom = createSeededRandom(42);
        const nowRandom = createSeededRandom(42);

        const legacy = legacyTotalDropMap(simResult, "player2", legacyRandom);
        let legacyRevenue = 0;
        for (const [itemHrid, amount] of legacy.totalDropMap.entries()) {
            legacyRevenue += resolveMarketPrice(priceTable, itemHrid, "bid") * toFiniteNumber(amount, 0);
        }

        const now = buildRandomProfitBreakdown(simResult, "player2", {
            dropMode: "bid",
            consumableMode: "ask",
            priceTable,
            randomSource: nowRandom,
            useDropCache: false,
        });

        expect(now.revenue).toBe(legacyRevenue);
        expect(now.expenses).toBe(9);
    });
});

const TA_MARKER = "const Ta =";
const LABYRINTH_PATCH_MARKER = "const LABYRINTH_TRANSLATION_PATCH =";
const OFFICIAL_GAME_ORIGIN = "https://www.milkywayidle.com";
const OFFICIAL_ASSET_MANIFEST_PATH = "/asset-manifest.json";
const OFFICIAL_MAIN_CHUNK_REGEX = /<script[^>]+src=["'](\/static\/js\/main\.[^"']+?\.chunk\.js)["']/i;
const OFFICIAL_INIT_RESOURCES_REGEX = /\.init\(\{resources:([A-Za-z_$][\w$]*),fallbackLng:/;

let legacyTranslationPromise = null;

function resolveLegacyI18nUrl() {
    const baseUrl = import.meta?.env?.BASE_URL || "/";
    const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    return `${normalizedBase}js/i18n.js`;
}

function extractObjectLiteralAfter(source, marker) {
    const markerIndex = source.indexOf(marker);
    if (markerIndex < 0) {
        return "";
    }

    const startIndex = source.indexOf("{", markerIndex);
    if (startIndex < 0) {
        return "";
    }

    let depth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inTemplateLiteral = false;
    let inLineComment = false;
    let inBlockComment = false;
    let escaped = false;

    for (let index = startIndex; index < source.length; index += 1) {
        const char = source[index];
        const next = source[index + 1];
        const previous = source[index - 1];

        if (inLineComment) {
            if (char === "\n") {
                inLineComment = false;
            }
            continue;
        }

        if (inBlockComment) {
            if (previous === "*" && char === "/") {
                inBlockComment = false;
            }
            continue;
        }

        if (inSingleQuote) {
            if (!escaped && char === "'") {
                inSingleQuote = false;
            }
            escaped = !escaped && char === "\\";
            continue;
        }

        if (inDoubleQuote) {
            if (!escaped && char === "\"") {
                inDoubleQuote = false;
            }
            escaped = !escaped && char === "\\";
            continue;
        }

        if (inTemplateLiteral) {
            if (!escaped && char === "`") {
                inTemplateLiteral = false;
            }
            escaped = !escaped && char === "\\";
            continue;
        }

        if (char === "/" && next === "/") {
            inLineComment = true;
            index += 1;
            continue;
        }

        if (char === "/" && next === "*") {
            inBlockComment = true;
            index += 1;
            continue;
        }

        if (char === "'") {
            inSingleQuote = true;
            escaped = false;
            continue;
        }

        if (char === "\"") {
            inDoubleQuote = true;
            escaped = false;
            continue;
        }

        if (char === "`") {
            inTemplateLiteral = true;
            escaped = false;
            continue;
        }

        if (char === "{") {
            depth += 1;
            continue;
        }

        if (char === "}") {
            depth -= 1;
            if (depth === 0) {
                return source.slice(startIndex, index + 1);
            }
        }
    }

    return "";
}

function parseObjectLiteral(literal, label) {
    if (!literal) {
        throw new Error(`Cannot parse legacy i18n object: ${label} missing`);
    }

    // The source is local project data and is parsed only to recover the literal object.
    const factory = new Function(`"use strict"; return (${literal});`);
    return factory();
}

function extractResourcesVariableName(source) {
    const match = source.match(OFFICIAL_INIT_RESOURCES_REGEX);
    return match?.[1] || "";
}

function extractObjectLiteralForVariable(source, variableName) {
    const name = String(variableName || "").trim();
    if (!name) {
        return "";
    }

    const candidates = [
        `const ${name}=`,
        `var ${name}=`,
        `${name}=`,
    ];

    for (const marker of candidates) {
        const literal = extractObjectLiteralAfter(source, marker);
        if (literal) {
            return literal;
        }
    }

    return "";
}

function mergeLabyrinthPatch(translationMap, labyrinthPatch) {
    if (!translationMap || !labyrinthPatch) {
        return;
    }

    if (translationMap.monsterNames && labyrinthPatch.monsterNames) {
        Object.assign(translationMap.monsterNames, labyrinthPatch.monsterNames);
    }

    if (translationMap.itemNames && labyrinthPatch.itemNames) {
        Object.assign(translationMap.itemNames, labyrinthPatch.itemNames);
    }
}

async function resolveOfficialMainChunkUrl() {
    let manifestError = null;
    try {
        const manifestResponse = await fetch(`${OFFICIAL_GAME_ORIGIN}${OFFICIAL_ASSET_MANIFEST_PATH}`);
        if (manifestResponse.ok) {
            const manifest = await manifestResponse.json();
            const manifestMainChunkPath = String(manifest?.files?.["main.js"] || "").trim();
            if (manifestMainChunkPath) {
                return new URL(manifestMainChunkPath, `${OFFICIAL_GAME_ORIGIN}/`).toString();
            }
        } else {
            manifestError = new Error(`Failed to load asset-manifest.json: ${manifestResponse.status}`);
        }
    } catch (error) {
        manifestError = error;
    }

    try {
        const homeResponse = await fetch(`${OFFICIAL_GAME_ORIGIN}/`);
        if (!homeResponse.ok) {
            throw new Error(`Failed to load official homepage: ${homeResponse.status}`);
        }

        const homeSource = await homeResponse.text();
        const mainChunkMatch = homeSource.match(OFFICIAL_MAIN_CHUNK_REGEX);
        if (!mainChunkMatch?.[1]) {
            throw new Error("Failed to locate official main chunk URL from homepage");
        }
        return new URL(mainChunkMatch[1], `${OFFICIAL_GAME_ORIGIN}/`).toString();
    } catch (homeError) {
        const manifestMessage = manifestError ? `asset-manifest error: ${manifestError.message || manifestError}` : "asset-manifest unavailable";
        throw new Error(`${manifestMessage}; homepage error: ${homeError.message || homeError}`);
    }
}

async function loadLegacyTranslationBundlesFromOfficialClient() {
    const mainChunkUrl = await resolveOfficialMainChunkUrl();
    const mainChunkResponse = await fetch(mainChunkUrl);
    if (!mainChunkResponse.ok) {
        throw new Error(`Failed to load official main chunk: ${mainChunkResponse.status}`);
    }

    const mainChunkSource = await mainChunkResponse.text();
    const resourcesVarName = extractResourcesVariableName(mainChunkSource);
    if (!resourcesVarName) {
        throw new Error("Failed to locate official i18n resources variable");
    }

    const resourcesLiteral = extractObjectLiteralForVariable(mainChunkSource, resourcesVarName);
    const resources = parseObjectLiteral(resourcesLiteral, `official resources (${resourcesVarName})`);

    const enTranslation = { ...(resources?.en?.translation || {}) };
    const zhTranslation = { ...(resources?.zh?.translation || {}) };

    if (Object.keys(enTranslation).length === 0 || Object.keys(zhTranslation).length === 0) {
        throw new Error("Official i18n resources are empty");
    }

    return {
        en: enTranslation,
        zh: zhTranslation,
    };
}

async function loadLegacyTranslationBundlesFromLocalFile() {
    const response = await fetch(resolveLegacyI18nUrl());
    if (!response.ok) {
        throw new Error(`Failed to load legacy i18n source: ${response.status}`);
    }

    const source = await response.text();
    const taLiteral = extractObjectLiteralAfter(source, TA_MARKER);
    const patchLiteral = extractObjectLiteralAfter(source, LABYRINTH_PATCH_MARKER);

    const ta = parseObjectLiteral(taLiteral, "Ta");
    const patch = patchLiteral ? parseObjectLiteral(patchLiteral, "LABYRINTH_TRANSLATION_PATCH") : null;

    const enTranslation = { ...(ta?.en?.translation || {}) };
    const zhTranslation = { ...(ta?.zh?.translation || {}) };

    if (patch) {
        mergeLabyrinthPatch(enTranslation, patch?.en);
        mergeLabyrinthPatch(zhTranslation, patch?.zh);
    }

    return {
        en: enTranslation,
        zh: zhTranslation,
    };
}

async function loadLegacyTranslationBundlesInternal() {
    try {
        return await loadLegacyTranslationBundlesFromOfficialClient();
    } catch (officialError) {
        console.warn("Failed to load official translation bundle, fallback to local js/i18n.js", officialError);
        return loadLegacyTranslationBundlesFromLocalFile();
    }
}

export function loadLegacyTranslationBundles() {
    if (!legacyTranslationPromise) {
        legacyTranslationPromise = loadLegacyTranslationBundlesInternal();
    }
    return legacyTranslationPromise;
}

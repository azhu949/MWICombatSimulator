import enTranslation from "../../../locales/en/translation.json";
import zhTranslation from "../../../locales/zh/translation.json";

const OFFICIAL_GAME_ORIGIN = "https://www.milkywayidle.com";
const OFFICIAL_ASSET_MANIFEST_PATH = "/asset-manifest.json";
const OFFICIAL_MAIN_CHUNK_REGEX = /<script[^>]+src=["'](\/static\/js\/main\.[^"']+?\.chunk\.js)["']/i;
const OFFICIAL_INIT_RESOURCES_REGEX = /\.init\(\{resources:([A-Za-z_$][\w$]*),fallbackLng:/;

let translationBundlePromise = null;

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
            if (!escaped && char === '"') {
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

        if (char === '"') {
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
        throw new Error(`Missing ${label} literal`);
    }

    try {
        return Function(`"use strict"; return (${literal});`)();
    } catch (error) {
        throw new Error(`Failed to parse ${label}: ${error.message || error}`);
    }
}

function extractResourcesVariableName(source) {
    const match = source.match(OFFICIAL_INIT_RESOURCES_REGEX);
    return match?.[1] || "";
}

function extractObjectLiteralForVariable(source, name) {
    if (!name) {
        return "";
    }

    const candidates = [
        `const ${name}=`,
        `const ${name} =`,
        `let ${name}=`,
        `let ${name} =`,
        `var ${name}=`,
        `var ${name} =`,
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

async function loadOfficialTranslationBundles() {
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

async function loadLocalTranslationBundles() {
    return {
        en: structuredClone(enTranslation),
        zh: structuredClone(zhTranslation),
    };
}

async function loadTranslationBundlesInternal() {
    try {
        return await loadOfficialTranslationBundles();
    } catch (officialError) {
        console.warn("Failed to load official translation bundle, fallback to local translation.json", officialError);
        return loadLocalTranslationBundles();
    }
}

export function loadTranslationBundles() {
    if (!translationBundlePromise) {
        translationBundlePromise = loadTranslationBundlesInternal();
    }

    return translationBundlePromise;
}

export function resetTranslationBundleCache() {
    translationBundlePromise = null;
}

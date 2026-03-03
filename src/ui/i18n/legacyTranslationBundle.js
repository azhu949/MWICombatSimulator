const TA_MARKER = "const Ta =";
const LABYRINTH_PATCH_MARKER = "const LABYRINTH_TRANSLATION_PATCH =";

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

async function loadLegacyTranslationBundlesInternal() {
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

export function loadLegacyTranslationBundles() {
    if (!legacyTranslationPromise) {
        legacyTranslationPromise = loadLegacyTranslationBundlesInternal();
    }
    return legacyTranslationPromise;
}

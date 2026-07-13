import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";

export const OFFICIAL_GAME_ORIGIN = "https://www.milkywayidle.com";
export const OFFICIAL_ASSET_MANIFEST_PATH = "/asset-manifest.json";
export const OFFICIAL_HOME_PATH = "/";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_TIMEOUT_MS = 20_000;
const MIN_TRANSLATION_DOMAIN_COUNT = 100;

export const GENERATED_TRANSLATION_PATHS = Object.freeze({
    en: "locales/en/translation.official.generated.json",
    zh: "locales/zh/translation.official.generated.json",
    source: "locales/official-translation-source.generated.json",
});

const DATA_RESOURCE_COVERAGE = Object.freeze([
    ["abilityDetailMap.json", ["abilityNames", "abilityDescriptions"]],
    ["achievementDetailMap.json", ["achievementNames", "achievementDescriptions"]],
    ["achievementTierDetailMap.json", ["achievementTierNames"]],
    ["actionDetailMap.json", ["actionNames"]],
    ["buffTypeDetailMap.json", ["buffTypeNames", "buffTypeDescriptions", "buffTypeDebuffDescriptions"]],
    ["combatMonsterDetailMap.json", ["monsterNames"]],
    ["combatStyleDetailMap.json", ["combatStyleNames"]],
    ["combatTriggerComparatorDetailMap.json", ["combatTriggerComparatorNames"]],
    ["combatTriggerConditionDetailMap.json", ["combatTriggerConditionNames"]],
    ["combatTriggerDependencyDetailMap.json", ["combatTriggerDependencyNames"]],
    ["communityBuffTypeDetailMap.json", ["communityBuffTypeNames"]],
    ["damageTypeDetailMap.json", ["damageTypeNames"]],
    ["equipmentTypeDetailMap.json", ["equipmentTypeNames"]],
    ["guildShrineDetailMap.json", ["guildShrineNames"]],
    ["houseRoomDetailMap.json", ["houseRoomNames"]],
    ["itemCategoryDetailMap.json", ["itemCategoryNames", "itemCategoryPluralNames"]],
    ["itemDetailMap.json", ["itemNames", "itemDescriptions"]],
    ["skillDetailMap.json", ["skillNames"]],
]);

function isNode(value) {
    return Boolean(value && typeof value === "object" && typeof value.type === "string");
}

function isFunctionNode(node) {
    return node?.type === "FunctionDeclaration"
        || node?.type === "FunctionExpression"
        || node?.type === "ArrowFunctionExpression";
}

function visitAst(node, visitor, ancestors = []) {
    if (!isNode(node)) {
        return;
    }

    if (visitor(node, ancestors) === false) {
        return;
    }

    const nextAncestors = [...ancestors, node];
    for (const [key, value] of Object.entries(node)) {
        if (key === "start" || key === "end") {
            continue;
        }

        if (Array.isArray(value)) {
            for (const child of value) {
                if (isNode(child)) {
                    visitAst(child, visitor, nextAncestors);
                }
            }
        } else if (isNode(value)) {
            visitAst(value, visitor, nextAncestors);
        }
    }
}

function parseScript(source, label) {
    try {
        return parse(source, {
            allowHashBang: true,
            ecmaVersion: "latest",
            sourceType: "script",
        });
    } catch (error) {
        throw new Error(`Failed to parse ${label}: ${error.message || error}`);
    }
}

function getPropertyName(node) {
    if (!node || node.computed) {
        return "";
    }
    if (node.key?.type === "Identifier") {
        return node.key.name;
    }
    if (node.key?.type === "Literal") {
        return String(node.key.value);
    }
    return "";
}

function getMemberPropertyName(node) {
    if (node?.type !== "MemberExpression") {
        return "";
    }
    if (!node.computed && node.property?.type === "Identifier") {
        return node.property.name;
    }
    if (node.computed && node.property?.type === "Literal") {
        return String(node.property.value);
    }
    return "";
}

function getObjectProperty(objectNode, name) {
    if (objectNode?.type !== "ObjectExpression") {
        return null;
    }
    return objectNode.properties.find((property) => (
        property?.type === "Property" && getPropertyName(property) === name
    )) || null;
}

function collectScopeBindings(scopeNode) {
    const bindings = new Map();

    function collect(node, isRoot = false) {
        if (!isNode(node)) {
            return;
        }
        if (!isRoot && isFunctionNode(node)) {
            return;
        }

        if (node.type === "VariableDeclarator" && node.id?.type === "Identifier" && node.init) {
            if (bindings.has(node.id.name)) {
                throw new Error(`Duplicate translation-scope binding: ${node.id.name}`);
            }
            bindings.set(node.id.name, node.init);
        }

        for (const [key, value] of Object.entries(node)) {
            if (key === "start" || key === "end") {
                continue;
            }
            if (Array.isArray(value)) {
                for (const child of value) {
                    collect(child);
                }
            } else {
                collect(value);
            }
        }
    }

    collect(scopeNode, true);
    return bindings;
}

function assertStaticProperty(property) {
    if (property.type !== "Property"
        || property.kind !== "init"
        || property.method
        || property.computed
        || property.shorthand) {
        throw new Error(`Unsupported translation property node: ${property.type}`);
    }
}

export function evaluateStaticExpression(node, bindings = new Map(), resolving = new Set()) {
    if (!node) {
        throw new Error("Missing static translation expression");
    }

    if (node.type === "Literal") {
        if (node.regex || !["string", "number", "boolean"].includes(typeof node.value) && node.value !== null) {
            throw new Error("Unsupported translation literal");
        }
        return node.value;
    }

    if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
        return node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join("");
    }

    if (node.type === "UnaryExpression" && ["+", "-"].includes(node.operator)) {
        const value = evaluateStaticExpression(node.argument, bindings, resolving);
        if (typeof value !== "number") {
            throw new Error(`Unary ${node.operator} requires a numeric literal`);
        }
        return node.operator === "-" ? -value : value;
    }

    if (node.type === "Identifier") {
        if (!bindings.has(node.name)) {
            throw new Error(`Unresolved translation identifier: ${node.name}`);
        }
        if (resolving.has(node.name)) {
            throw new Error(`Circular translation identifier: ${node.name}`);
        }

        resolving.add(node.name);
        try {
            return evaluateStaticExpression(bindings.get(node.name), bindings, resolving);
        } finally {
            resolving.delete(node.name);
        }
    }

    if (node.type === "ArrayExpression") {
        return node.elements.map((element) => {
            if (!element || element.type === "SpreadElement") {
                throw new Error("Unsupported translation array element");
            }
            return evaluateStaticExpression(element, bindings, resolving);
        });
    }

    if (node.type === "ObjectExpression") {
        const result = Object.create(null);
        for (const property of node.properties) {
            if (property.type === "SpreadElement") {
                const spreadValue = evaluateStaticExpression(property.argument, bindings, resolving);
                if (!spreadValue || typeof spreadValue !== "object" || Array.isArray(spreadValue)) {
                    throw new Error("Translation object spread must resolve to an object");
                }
                Object.assign(result, spreadValue);
                continue;
            }

            assertStaticProperty(property);
            const key = getPropertyName(property);
            if (!key) {
                throw new Error("Translation property has an unsupported key");
            }
            result[key] = evaluateStaticExpression(property.value, bindings, resolving);
        }
        return result;
    }

    throw new Error(`Unsafe or unsupported translation expression: ${node.type}`);
}

function findEnglishTranslationCandidate(ast) {
    const candidates = [];

    visitAst(ast, (node, ancestors) => {
        if (node.type !== "CallExpression" || getMemberPropertyName(node.callee) !== "init") {
            return;
        }

        const options = node.arguments[0];
        const resources = getObjectProperty(options, "resources")?.value;
        const english = getObjectProperty(resources, "en")?.value;
        const translation = getObjectProperty(english, "translation")?.value;
        if (!translation) {
            return;
        }

        const scope = [...ancestors].reverse().find(isFunctionNode);
        if (!scope) {
            throw new Error("Official English translation init has no enclosing scope");
        }
        candidates.push({ expression: translation, scope });
    });

    if (candidates.length !== 1) {
        throw new Error(`Expected one official English translation resource, found ${candidates.length}`);
    }
    return candidates[0];
}

export function extractEnglishTranslationResource(mainSource) {
    const ast = parseScript(mainSource, "official main bundle");
    const candidate = findEnglishTranslationCandidate(ast);
    return evaluateStaticExpression(candidate.expression, collectScopeBindings(candidate.scope));
}

export function discoverLocaleChunk(mainSource, locale = "zh") {
    const ast = parseScript(mainSource, "official main bundle");
    const localeKey = `./${locale}/index.js`;
    const candidates = [];

    visitAst(ast, (node) => {
        if (node.type !== "ObjectExpression") {
            return;
        }
        for (const property of node.properties) {
            if (property.type !== "Property" || getPropertyName(property) !== localeKey) {
                continue;
            }
            if (property.value?.type !== "ArrayExpression" || property.value.elements.length < 2) {
                throw new Error(`Invalid ${locale} locale chunk mapping`);
            }
            const moduleId = evaluateStaticExpression(property.value.elements[0]);
            const chunkId = evaluateStaticExpression(property.value.elements[1]);
            candidates.push({ moduleId, chunkId });
        }
    });

    if (candidates.length !== 1) {
        throw new Error(`Expected one ${locale} locale chunk mapping, found ${candidates.length}`);
    }
    return candidates[0];
}

function findWebpackModule(ast, moduleId) {
    const candidates = [];
    visitAst(ast, (node) => {
        if (node.type !== "ObjectExpression") {
            return;
        }
        for (const property of node.properties) {
            if (property.type === "Property"
                && getPropertyName(property) === String(moduleId)
                && isFunctionNode(property.value)) {
                candidates.push(property.value);
            }
        }
    });

    if (candidates.length !== 1) {
        throw new Error(`Expected one locale webpack module ${moduleId}, found ${candidates.length}`);
    }
    return candidates[0];
}

function findDefaultExportExpression(moduleNode) {
    const candidates = [];

    function find(node, isRoot = false) {
        if (!isNode(node)) {
            return;
        }
        if (!isRoot && isFunctionNode(node)) {
            return;
        }
        if (node.type === "AssignmentExpression"
            && node.operator === "="
            && getMemberPropertyName(node.left) === "default") {
            candidates.push(node.right);
        }
        for (const [key, value] of Object.entries(node)) {
            if (key === "start" || key === "end") {
                continue;
            }
            if (Array.isArray(value)) {
                for (const child of value) {
                    find(child);
                }
            } else {
                find(value);
            }
        }
    }

    find(moduleNode, true);
    if (candidates.length !== 1) {
        throw new Error(`Expected one locale default export, found ${candidates.length}`);
    }
    return candidates[0];
}

export function extractLocaleTranslationResource(localeSource, moduleId) {
    const ast = parseScript(localeSource, "official locale bundle");
    const moduleNode = findWebpackModule(ast, moduleId);
    const expression = findDefaultExportExpression(moduleNode);
    return evaluateStaticExpression(expression, collectScopeBindings(moduleNode));
}

function sha256(content) {
    return createHash("sha256").update(content, "utf8").digest("hex");
}

function serializeJson(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}

function resolveOfficialUrl(assetPath, origin) {
    const url = new URL(assetPath, `${origin}/`);
    if (url.protocol !== "https:" || url.origin !== new URL(origin).origin) {
        throw new Error(`Refusing non-official asset URL: ${url}`);
    }
    return url;
}

async function fetchText(url, { fetchImpl, timeoutMs, label }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(url, { signal: controller.signal });
        if (!response?.ok) {
            throw new Error(`${label} returned HTTP ${response?.status ?? "unknown"}`);
        }
        if (response.url) {
            const requestedUrl = new URL(url);
            const responseUrl = new URL(response.url, requestedUrl);
            if (responseUrl.origin !== requestedUrl.origin) {
                throw new Error(`${label} redirected outside the official origin: ${responseUrl}`);
            }
        }
        return await response.text();
    } catch (error) {
        if (error?.name === "AbortError") {
            throw new Error(`${label} timed out after ${timeoutMs}ms`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function findChunkAssetPath(manifest, chunkId) {
    const escapedChunkId = String(chunkId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matcher = new RegExp(`/static/js/${escapedChunkId}\\.[^/]+\\.chunk\\.js$`);
    const candidates = Object.values(manifest?.files || {}).filter((value) => matcher.test(String(value)));
    if (candidates.length !== 1) {
        throw new Error(`Expected one locale asset for chunk ${chunkId}, found ${candidates.length}`);
    }
    return String(candidates[0]);
}

function findHomeMainAssetPath(homeSource) {
    const match = String(homeSource || "").match(
        /<script[^>]+src=["'](\/static\/js\/main\.[^"']+\.chunk\.js)["']/i,
    );
    return String(match?.[1] || "");
}

function findHomeChunkAssetPath(homeSource, chunkId) {
    const escapedChunkId = String(chunkId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matcher = new RegExp(`${escapedChunkId}\\s*:\\s*["']([^"']+)["']`);
    const hashMatch = String(homeSource || "").match(matcher);
    return hashMatch?.[1]
        ? `/static/js/${chunkId}.${hashMatch[1]}.chunk.js`
        : "";
}

export async function extractOfficialTranslationResources({
    fetchImpl = globalThis.fetch,
    origin = OFFICIAL_GAME_ORIGIN,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    if (typeof fetchImpl !== "function") {
        throw new Error("A fetch implementation is required to sync official translations");
    }

    const manifestUrl = resolveOfficialUrl(OFFICIAL_ASSET_MANIFEST_PATH, origin);
    const manifestText = await fetchText(manifestUrl, {
        fetchImpl,
        timeoutMs,
        label: "Official asset manifest",
    });

    let manifest;
    try {
        manifest = JSON.parse(manifestText);
    } catch (error) {
        throw new Error(`Failed to parse official asset manifest: ${error.message || error}`);
    }

    let homeSource = "";
    try {
        homeSource = await fetchText(resolveOfficialUrl(OFFICIAL_HOME_PATH, origin), {
            fetchImpl,
            timeoutMs,
            label: "Official homepage",
        });
    } catch (error) {
        if (String(error?.message || error).includes("redirected outside the official origin")) {
            throw error;
        }
    }

    const manifestMainAssetPath = String(manifest?.files?.["main.js"] || "");
    const homeMainAssetPath = findHomeMainAssetPath(homeSource);
    const mainAssetPath = homeMainAssetPath || manifestMainAssetPath;
    if (!mainAssetPath) {
        throw new Error("Official asset manifest does not contain main.js");
    }
    const mainSource = await fetchText(resolveOfficialUrl(mainAssetPath, origin), {
        fetchImpl,
        timeoutMs,
        label: "Official main bundle",
    });

    const en = extractEnglishTranslationResource(mainSource);
    const { moduleId, chunkId } = discoverLocaleChunk(mainSource, "zh");
    const shouldUseHomeRuntime = Boolean(homeMainAssetPath && homeMainAssetPath !== manifestMainAssetPath);
    const zhAssetPath = shouldUseHomeRuntime
        ? (findHomeChunkAssetPath(homeSource, chunkId) || findChunkAssetPath(manifest, chunkId))
        : findChunkAssetPath(manifest, chunkId);
    const zhSource = await fetchText(resolveOfficialUrl(zhAssetPath, origin), {
        fetchImpl,
        timeoutMs,
        label: "Official Chinese translation bundle",
    });
    const zh = extractLocaleTranslationResource(zhSource, moduleId);

    return {
        resources: { en, zh },
        source: {
            origin,
            manifest: {
                path: OFFICIAL_ASSET_MANIFEST_PATH,
                sha256: sha256(manifestText),
            },
            ...(homeSource ? {
                home: {
                    path: OFFICIAL_HOME_PATH,
                    sha256: sha256(homeSource),
                },
            } : {}),
            assets: {
                main: {
                    path: mainAssetPath,
                    sha256: sha256(mainSource),
                },
                zh: {
                    path: zhAssetPath,
                    moduleId,
                    chunkId,
                    sha256: sha256(zhSource),
                },
            },
        },
    };
}

function assertTranslationObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
}

async function readJson(filePath) {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function validateTranslationResources(resources, { rootDir = DEFAULT_ROOT_DIR } = {}) {
    assertTranslationObject(resources, "Official translation resources");
    assertTranslationObject(resources.en, "Official English translation resource");
    assertTranslationObject(resources.zh, "Official Chinese translation resource");

    for (const language of ["en", "zh"]) {
        if (Object.keys(resources[language]).length < MIN_TRANSLATION_DOMAIN_COUNT) {
            throw new Error(`Official ${language} translation resource is unexpectedly small`);
        }
    }

    const enDomains = new Set(Object.keys(resources.en));
    const zhDomains = new Set(Object.keys(resources.zh));
    const domainMismatch = [
        ...[...enDomains].filter((key) => !zhDomains.has(key)).map((key) => `zh:${key}`),
        ...[...zhDomains].filter((key) => !enDomains.has(key)).map((key) => `en:${key}`),
    ];
    if (domainMismatch.length > 0) {
        throw new Error(`Official language domain mismatch: ${domainMismatch.join(", ")}`);
    }

    const dataDir = path.join(rootDir, "src", "combatsimulator", "data");
    const coverage = [];
    for (const [dataFile, resourceKeys] of DATA_RESOURCE_COVERAGE) {
        const detailMap = await readJson(path.join(dataDir, dataFile));
        const hrids = Object.keys(detailMap || {});
        for (const language of ["en", "zh"]) {
            for (const resourceKey of resourceKeys) {
                const dictionary = resources[language][resourceKey];
                assertTranslationObject(dictionary, `${language}.${resourceKey}`);
                const missing = hrids.filter((hrid) => !Object.prototype.hasOwnProperty.call(dictionary, hrid));
                if (missing.length > 0) {
                    throw new Error(
                        `${language}.${resourceKey} is missing ${missing.length} tracked HRIDs: ${missing.slice(0, 10).join(", ")}`,
                    );
                }
                const nonString = hrids.filter((hrid) => typeof dictionary[hrid] !== "string");
                if (nonString.length > 0) {
                    throw new Error(
                        `${language}.${resourceKey} must contain string values for tracked HRIDs: ${nonString.slice(0, 10).join(", ")}`,
                    );
                }
                if (resourceKey.endsWith("Names")) {
                    const blank = hrids.filter((hrid) => dictionary[hrid].trim().length === 0);
                    if (blank.length > 0) {
                        throw new Error(
                            `${language}.${resourceKey} contains blank tracked names: ${blank.slice(0, 10).join(", ")}`,
                        );
                    }
                }
                coverage.push({ language, resourceKey, trackedHridCount: hrids.length });
            }
        }
    }

    return {
        domainCount: Object.keys(resources.en).length,
        coverage,
    };
}

export function buildSnapshotArtifacts(extracted) {
    const enContent = serializeJson(extracted.resources.en);
    const zhContent = serializeJson(extracted.resources.zh);
    const sourceManifest = {
        schemaVersion: 1,
        source: extracted.source,
        resources: {
            en: {
                file: GENERATED_TRANSLATION_PATHS.en,
                sha256: sha256(enContent),
                topLevelKeyCount: Object.keys(extracted.resources.en).length,
            },
            zh: {
                file: GENERATED_TRANSLATION_PATHS.zh,
                sha256: sha256(zhContent),
                topLevelKeyCount: Object.keys(extracted.resources.zh).length,
            },
        },
    };

    return new Map([
        [GENERATED_TRANSLATION_PATHS.en, enContent],
        [GENERATED_TRANSLATION_PATHS.zh, zhContent],
        [GENERATED_TRANSLATION_PATHS.source, serializeJson(sourceManifest)],
    ]);
}

async function checkArtifacts(artifacts, rootDir) {
    const stale = [];
    for (const [relativePath, expectedContent] of artifacts) {
        const targetPath = path.join(rootDir, relativePath);
        let currentContent = "";
        try {
            currentContent = await fs.readFile(targetPath, "utf8");
        } catch (error) {
            if (error?.code !== "ENOENT") {
                throw error;
            }
        }
        if (currentContent !== expectedContent) {
            stale.push(relativePath);
        }
    }
    return stale;
}

async function removeFileQuietly(fileSystem, filePath) {
    try {
        await fileSystem.rm(filePath, { force: true });
    } catch {
        // Cleanup failures do not change which snapshot version is active.
    }
}

export async function writeArtifactsTransactionally(
    artifacts,
    rootDir,
    { fileSystem = fs, transactionId = randomUUID() } = {},
) {
    const entries = [...artifacts].map(([relativePath, content]) => {
        const targetPath = path.join(rootDir, relativePath);
        return {
            relativePath,
            content,
            targetPath,
            tempPath: `${targetPath}.tmp-${transactionId}`,
            backupPath: `${targetPath}.bak-${transactionId}`,
            hadOriginal: false,
            installed: false,
            targetRemoved: false,
        };
    });

    try {
        for (const entry of entries) {
            await fileSystem.mkdir(path.dirname(entry.targetPath), { recursive: true });
            await fileSystem.writeFile(entry.tempPath, entry.content, "utf8");
        }

        for (const entry of entries) {
            try {
                await fileSystem.copyFile(entry.targetPath, entry.backupPath);
                entry.hadOriginal = true;
            } catch (error) {
                if (error?.code !== "ENOENT") {
                    throw error;
                }
            }
        }

        for (const entry of entries) {
            try {
                await fileSystem.rename(entry.tempPath, entry.targetPath);
            } catch (error) {
                const canRetryWindowsReplacement = entry.hadOriginal
                    && ["EACCES", "EEXIST", "EPERM"].includes(error?.code);
                if (!canRetryWindowsReplacement) {
                    throw error;
                }
                await fileSystem.rm(entry.targetPath, { force: true });
                entry.targetRemoved = true;
                await fileSystem.rename(entry.tempPath, entry.targetPath);
            }
            entry.installed = true;
        }
    } catch (writeError) {
        const rollbackErrors = [];
        const preservedBackups = new Set();
        for (const entry of [...entries].reverse()) {
            if (!entry.installed && !entry.targetRemoved) {
                continue;
            }
            try {
                if (entry.hadOriginal) {
                    await fileSystem.copyFile(entry.backupPath, entry.targetPath);
                } else {
                    await fileSystem.rm(entry.targetPath, { force: true });
                }
            } catch (rollbackError) {
                rollbackErrors.push(`${entry.relativePath}: ${rollbackError.message || rollbackError}`);
                if (entry.hadOriginal) {
                    preservedBackups.add(entry.backupPath);
                }
            }
        }

        await Promise.all(entries.flatMap((entry) => {
            const cleanupTasks = [removeFileQuietly(fileSystem, entry.tempPath)];
            if (!preservedBackups.has(entry.backupPath)) {
                cleanupTasks.push(removeFileQuietly(fileSystem, entry.backupPath));
            }
            return cleanupTasks;
        }));

        if (rollbackErrors.length > 0) {
            throw new Error(
                `${writeError.message || writeError}; snapshot rollback failed: ${rollbackErrors.join("; ")}; original backups preserved: ${[...preservedBackups].join(", ")}`,
                { cause: writeError },
            );
        }
        throw writeError;
    }

    await Promise.all(entries.map((entry) => removeFileQuietly(fileSystem, entry.backupPath)));
}

export async function syncOfficialTranslations({
    check = false,
    fetchImpl = globalThis.fetch,
    origin = OFFICIAL_GAME_ORIGIN,
    rootDir = DEFAULT_ROOT_DIR,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    const extracted = await extractOfficialTranslationResources({ fetchImpl, origin, timeoutMs });
    const validation = await validateTranslationResources(extracted.resources, { rootDir });
    const artifacts = buildSnapshotArtifacts(extracted);
    const stale = await checkArtifacts(artifacts, rootDir);

    if (check) {
        if (stale.length > 0) {
            throw new Error(`Official translation snapshots are stale: ${stale.join(", ")}`);
        }
    } else if (stale.length > 0) {
        await writeArtifactsTransactionally(artifacts, rootDir);
    }

    return {
        changedFiles: check ? [] : stale,
        checkedFiles: [...artifacts.keys()],
        domainCount: validation.domainCount,
        itemCount: Object.keys(extracted.resources.en.itemNames || {}).length,
        source: extracted.source,
    };
}

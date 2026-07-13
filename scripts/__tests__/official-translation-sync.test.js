import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
    GENERATED_TRANSLATION_PATHS,
    discoverLocaleChunk,
    extractEnglishTranslationResource,
    extractLocaleTranslationResource,
    extractOfficialTranslationResources,
    syncOfficialTranslations,
    validateTranslationResources,
    writeArtifactsTransactionally,
} from "../official-translation-sync.mjs";

const tempDirs = [];
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MAIN_FIXTURE = `
    (() => {
        const base = {
            global: { gameName: "Milky Way Idle" },
            itemNames: { "/items/coin": "Old Coin" }
        };
        const gameData = {
            itemNames: { "/items/coin": "Coin" },
            nested: { unicode: "Official" }
        };
        const localeModules = {
            "./zh/index.js": [42, 7]
        };
        client.init({
            resources: { en: { translation: { ...base, ...gameData } } },
            fallbackLng: "en"
        });
        void localeModules;
    })();
`;

const ZH_FIXTURE = `
    (this.webpackJsonp = this.webpackJsonp || []).push([[7], {
        42: function(module, exports, runtime) {
            "use strict";
            runtime.r(exports);
            const base = {
                global: { gameName: "\u94f6\u6cb3\u5976\u725b\u653e\u7f6e" },
                itemNames: { "/items/coin": "\u65e7\u91d1\u5e01" }
            };
            const gameData = {
                itemNames: { "/items/coin": "\u91d1\u5e01" },
                nested: { unicode: "\u5b98\u65b9" }
            };
            const translations = { ...base, ...gameData };
            exports.default = translations;
        }
    }]);
`;

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("official translation AST extraction", () => {
    it("extracts English spreads in source order and discovers the Chinese lazy chunk", () => {
        const english = extractEnglishTranslationResource(MAIN_FIXTURE);

        expect(english.global.gameName).toBe("Milky Way Idle");
        expect(english.itemNames["/items/coin"]).toBe("Coin");
        expect(discoverLocaleChunk(MAIN_FIXTURE, "zh")).toEqual({ moduleId: 42, chunkId: 7 });
    });

    it("extracts the Chinese default export without executing the bundle", () => {
        const chinese = extractLocaleTranslationResource(ZH_FIXTURE, 42);

        expect(chinese.global.gameName).toBe("银河奶牛放置");
        expect(chinese.itemNames["/items/coin"]).toBe("金币");
        expect(chinese.nested.unicode).toBe("官方");
    });

    it("records every fetched official source path and content hash", async () => {
        const manifestText = JSON.stringify({
            files: {
                "main.js": "/static/js/main.fixture.chunk.js",
                "7.js": "/static/js/7.fixture.chunk.js",
            },
        });
        const contentByPath = new Map([
            ["/asset-manifest.json", manifestText],
            ["/static/js/main.fixture.chunk.js", MAIN_FIXTURE],
            ["/static/js/7.fixture.chunk.js", ZH_FIXTURE],
        ]);
        const fetchImpl = async (url) => {
            const parsedUrl = new URL(url);
            const content = contentByPath.get(parsedUrl.pathname);
            return {
                ok: content != null,
                status: content == null ? 404 : 200,
                url: parsedUrl.href,
                text: async () => content || "",
            };
        };

        const extracted = await extractOfficialTranslationResources({ fetchImpl });
        const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex");

        expect(extracted.resources.en.itemNames["/items/coin"]).toBe("Coin");
        expect(extracted.resources.zh.itemNames["/items/coin"]).toBe("金币");
        expect(extracted.source.manifest).toEqual({
            path: "/asset-manifest.json",
            sha256: hash(manifestText),
        });
        expect(extracted.source.assets.main.sha256).toBe(hash(MAIN_FIXTURE));
        expect(extracted.source.assets.zh.sha256).toBe(hash(ZH_FIXTURE));
    });

    it("prefers the homepage runtime when the asset manifest is stale", async () => {
        const staleManifest = JSON.stringify({
            files: {
                "main.js": "/static/js/main.stale.chunk.js",
                "7.js": "/static/js/7.stale.chunk.js",
            },
        });
        const homepage = `<script>const hashes={7:"current"};</script><script src="/static/js/main.current.chunk.js"></script>`;
        const contentByPath = new Map([
            ["/asset-manifest.json", staleManifest],
            ["/", homepage],
            ["/static/js/main.current.chunk.js", MAIN_FIXTURE],
            ["/static/js/7.current.chunk.js", ZH_FIXTURE],
        ]);
        const fetchImpl = async (url) => {
            const parsedUrl = new URL(url);
            const content = contentByPath.get(parsedUrl.pathname);
            return {
                ok: content != null,
                status: content == null ? 404 : 200,
                url: parsedUrl.href,
                text: async () => content || "",
            };
        };

        const extracted = await extractOfficialTranslationResources({ fetchImpl });

        expect(extracted.source.assets.main.path).toBe("/static/js/main.current.chunk.js");
        expect(extracted.source.assets.zh.path).toBe("/static/js/7.current.chunk.js");
        expect(extracted.source.home.path).toBe("/");
    });

    it.each([
        ["call expression", "const bad = { itemNames: makeTranslations() };"],
        ["getter", "const bad = { get itemNames() { return {}; } };"],
        ["computed property", "const key = 'itemNames'; const bad = { [key]: {} };"],
    ])("rejects unsafe %s resources", (_label, declaration) => {
        const source = `
            (() => {
                ${declaration}
                client.init({ resources: { en: { translation: { ...bad } } }, fallbackLng: "en" });
            })();
        `;

        expect(() => extractEnglishTranslationResource(source)).toThrow(/Unsafe|unsupported/i);
    });

    it("does not create snapshots when extraction fails", async () => {
        const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mwi-translation-sync-"));
        tempDirs.push(rootDir);
        const unsafeMain = `
            (() => {
                client.init({
                    resources: { en: { translation: loadTranslations() } },
                    fallbackLng: "en"
                });
            })();
        `;
        const fetchImpl = async (url) => ({
            ok: true,
            status: 200,
            text: async () => String(url).endsWith("asset-manifest.json")
                ? JSON.stringify({ files: { "main.js": "/static/js/main.fixture.chunk.js" } })
                : unsafeMain,
        });

        await expect(syncOfficialTranslations({ fetchImpl, rootDir })).rejects.toThrow(/Unsafe|unsupported/i);
        for (const relativePath of Object.values(GENERATED_TRANSLATION_PATHS)) {
            await expect(fs.stat(path.join(rootDir, relativePath))).rejects.toMatchObject({ code: "ENOENT" });
        }
    });

    it("rejects translation responses redirected outside the official origin", async () => {
        const fetchImpl = async () => ({
            ok: true,
            status: 200,
            url: "https://translations.example.com/asset-manifest.json",
            text: async () => JSON.stringify({ files: {} }),
        });

        await expect(extractOfficialTranslationResources({ fetchImpl })).rejects.toThrow(/redirected outside the official origin/i);
    });

    it("rejects non-string and blank tracked names", async () => {
        const resources = {
            en: JSON.parse(await fs.readFile(path.join(rootDir, GENERATED_TRANSLATION_PATHS.en), "utf8")),
            zh: JSON.parse(await fs.readFile(path.join(rootDir, GENERATED_TRANSLATION_PATHS.zh), "utf8")),
        };
        const itemHrid = Object.keys(resources.zh.itemNames)[0];
        const nonStringResources = structuredClone(resources);
        nonStringResources.zh.itemNames[itemHrid] = null;
        await expect(validateTranslationResources(nonStringResources, { rootDir }))
            .rejects.toThrow(/must contain string values for tracked HRIDs/i);

        const blankNameResources = structuredClone(resources);
        blankNameResources.zh.itemNames[itemHrid] = "   ";
        await expect(validateTranslationResources(blankNameResources, { rootDir }))
            .rejects.toThrow(/contains blank tracked names/i);
    });

    it("installs every prepared snapshot and removes transaction files", async () => {
        const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mwi-translation-install-"));
        tempDirs.push(rootDir);
        const artifacts = new Map([
            [GENERATED_TRANSLATION_PATHS.en, "new-en\n"],
            [GENERATED_TRANSLATION_PATHS.zh, "new-zh\n"],
            [GENERATED_TRANSLATION_PATHS.source, "new-source\n"],
        ]);
        for (const relativePath of artifacts.keys()) {
            const targetPath = path.join(rootDir, relativePath);
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            await fs.writeFile(targetPath, "previous\n", "utf8");
        }

        await writeArtifactsTransactionally(artifacts, rootDir, { transactionId: "install-test" });

        for (const [relativePath, content] of artifacts) {
            const targetPath = path.join(rootDir, relativePath);
            await expect(fs.readFile(targetPath, "utf8")).resolves.toBe(content);
            const siblingFiles = await fs.readdir(path.dirname(targetPath));
            expect(siblingFiles.some((fileName) => fileName.includes("install-test"))).toBe(false);
        }
    });

    it("restores every previous snapshot when an install step fails", async () => {
        const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mwi-translation-write-"));
        tempDirs.push(rootDir);
        const artifacts = new Map([
            [GENERATED_TRANSLATION_PATHS.en, "new-en\n"],
            [GENERATED_TRANSLATION_PATHS.zh, "new-zh\n"],
            [GENERATED_TRANSLATION_PATHS.source, "new-source\n"],
        ]);
        const previous = new Map([
            [GENERATED_TRANSLATION_PATHS.en, "old-en\n"],
            [GENERATED_TRANSLATION_PATHS.zh, "old-zh\n"],
            [GENERATED_TRANSLATION_PATHS.source, "old-source\n"],
        ]);
        for (const [relativePath, content] of previous) {
            const targetPath = path.join(rootDir, relativePath);
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            await fs.writeFile(targetPath, content, "utf8");
        }

        const fileSystem = {
            ...fs,
            async rename(fromPath, toPath) {
                if (fromPath.includes(".tmp-review-test") && toPath.endsWith(GENERATED_TRANSLATION_PATHS.zh.replaceAll("/", path.sep))) {
                    const error = new Error("injected install failure");
                    error.code = "EIO";
                    throw error;
                }
                return fs.rename(fromPath, toPath);
            },
        };

        await expect(writeArtifactsTransactionally(artifacts, rootDir, {
            fileSystem,
            transactionId: "review-test",
        })).rejects.toThrow("injected install failure");

        for (const [relativePath, content] of previous) {
            await expect(fs.readFile(path.join(rootDir, relativePath), "utf8")).resolves.toBe(content);
        }
        for (const directory of ["locales/en", "locales/zh", "locales"]) {
            const remainingFiles = await fs.readdir(path.join(rootDir, directory));
            expect(remainingFiles.some((fileName) => fileName.includes(".tmp-") || fileName.includes(".bak-"))).toBe(false);
        }
    });

    it("preserves the original backup when rollback also fails", async () => {
        const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mwi-translation-rollback-"));
        tempDirs.push(rootDir);
        const enPath = path.join(rootDir, GENERATED_TRANSLATION_PATHS.en);
        const zhPath = path.join(rootDir, GENERATED_TRANSLATION_PATHS.zh);
        await fs.mkdir(path.dirname(enPath), { recursive: true });
        await fs.mkdir(path.dirname(zhPath), { recursive: true });
        await fs.writeFile(enPath, "old-en\n", "utf8");
        await fs.writeFile(zhPath, "old-zh\n", "utf8");
        const artifacts = new Map([
            [GENERATED_TRANSLATION_PATHS.en, "new-en\n"],
            [GENERATED_TRANSLATION_PATHS.zh, "new-zh\n"],
        ]);
        const fileSystem = {
            ...fs,
            async copyFile(fromPath, toPath) {
                if (fromPath.includes(".bak-rollback-test") && toPath === enPath) {
                    throw new Error("injected rollback failure");
                }
                return fs.copyFile(fromPath, toPath);
            },
            async rename(fromPath, toPath) {
                if (fromPath.includes(".tmp-rollback-test") && toPath === zhPath) {
                    throw new Error("injected install failure");
                }
                return fs.rename(fromPath, toPath);
            },
        };

        await expect(writeArtifactsTransactionally(artifacts, rootDir, {
            fileSystem,
            transactionId: "rollback-test",
        })).rejects.toThrow(/rollback failed.*original backups preserved/i);

        const backupPath = `${enPath}.bak-rollback-test`;
        await expect(fs.readFile(backupPath, "utf8")).resolves.toBe("old-en\n");
        await expect(fs.readFile(enPath, "utf8")).resolves.toBe("new-en\n");
    });
});

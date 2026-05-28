import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTranslationBundles, resetTranslationBundleCache } from "../translationBundle.js";

afterEach(() => {
    resetTranslationBundleCache();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("translationBundle", () => {
    it("falls back to imported local translation bundles without fetching /locales json", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});

        const fetchMock = vi.fn(async (url) => {
            const href = String(url || "");

            if (href.includes("asset-manifest.json")) {
                throw new Error("offline");
            }

            if (href === "https://www.milkywayidle.com/") {
                return {
                    ok: false,
                    status: 503,
                    text: async () => "",
                };
            }

            if (href.includes("/locales/")) {
                throw new Error(`Unexpected local fetch url: ${href}`);
            }

            throw new Error(`Unexpected fetch url: ${href}`);
        });

        vi.stubGlobal("fetch", fetchMock);

        const bundles = await loadTranslationBundles();

        expect(bundles.en.itemNames).toBeTypeOf("object");
        expect(bundles.zh.itemNames).toBeTypeOf("object");
        expect(fetchMock).toHaveBeenCalled();
    });

    it("uses local translation entries when the official bundle is missing newer keys", async () => {
        const mainChunkSource = `
            const resources = {
                en: { translation: { itemNames: { "/items/coin": "Coin" } } },
                zh: { translation: { itemNames: { "/items/coin": "金币" } } }
            };
            i18next.init({resources:resources,fallbackLng:"en"});
        `;
        const fetchMock = vi.fn(async (url) => {
            const href = String(url || "");

            if (href.includes("asset-manifest.json")) {
                return {
                    ok: true,
                    json: async () => ({ files: { "main.js": "/static/js/main.test.chunk.js" } }),
                };
            }

            if (href === "https://www.milkywayidle.com/static/js/main.test.chunk.js") {
                return {
                    ok: true,
                    text: async () => mainChunkSource,
                };
            }

            throw new Error(`Unexpected fetch url: ${href}`);
        });

        vi.stubGlobal("fetch", fetchMock);

        const bundles = await loadTranslationBundles();

        expect(bundles.zh.itemNames["/items/coin"]).toBe("金币");
        expect(bundles.zh.itemNames["/items/pathbreaker_boots"]).toBe("开路靴");
    });
});

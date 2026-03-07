import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTranslationBundles, resetTranslationBundleCache } from "../translationBundle.js";

afterEach(() => {
    resetTranslationBundleCache();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("translationBundle", () => {
    it("falls back to local translation json when official bundle loading fails", async () => {
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

            if (href.endsWith("/locales/en/translation.json")) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ itemNames: { "/items/apple": "Apple" } }),
                };
            }

            if (href.endsWith("/locales/zh/translation.json")) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ itemNames: { "/items/apple": "苹果" } }),
                };
            }

            throw new Error(`Unexpected fetch url: ${href}`);
        });

        vi.stubGlobal("fetch", fetchMock);

        const bundles = await loadTranslationBundles();

        expect(bundles.en.itemNames["/items/apple"]).toBe("Apple");
        expect(bundles.zh.itemNames["/items/apple"]).toBe("苹果");
        expect(fetchMock).toHaveBeenCalled();
    });
});

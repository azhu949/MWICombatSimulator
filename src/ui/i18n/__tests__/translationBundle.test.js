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
});

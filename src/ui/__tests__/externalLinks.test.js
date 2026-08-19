import { describe, expect, it } from "vitest";
import { DEFAULT_MAIN_SITE_IMPORT_SCRIPT_URL, resolveMainSiteImportScriptUrl } from "../config/externalLinks.js";

describe("external link configuration", () => {
    it("uses the maintained GreasyFork URL when no override is defined", () => {
        expect(resolveMainSiteImportScriptUrl(undefined)).toBe(DEFAULT_MAIN_SITE_IMPORT_SCRIPT_URL);
    });

    it("accepts a configured HTTP(S) URL", () => {
        expect(resolveMainSiteImportScriptUrl("  https://example.com/import-script  ")).toBe(
            "https://example.com/import-script",
        );
    });

    it("disables the link when the override is empty", () => {
        expect(resolveMainSiteImportScriptUrl("")).toBe("");
        expect(resolveMainSiteImportScriptUrl("   ")).toBe("");
    });

    it("disables malformed and non-HTTP(S) overrides", () => {
        expect(resolveMainSiteImportScriptUrl("not a URL")).toBe("");
        expect(resolveMainSiteImportScriptUrl("javascript:alert(1)")).toBe("");
        expect(resolveMainSiteImportScriptUrl("false")).toBe("");
    });
});

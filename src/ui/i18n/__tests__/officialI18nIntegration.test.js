import { afterAll, describe, expect, it, vi } from "vitest";

const storage = new Map([["i18nextLng", "zh"]]);

vi.stubGlobal("localStorage", {
    getItem(key) {
        return storage.get(String(key)) ?? null;
    },
    setItem(key, value) {
        storage.set(String(key), String(value));
    },
});

afterAll(() => {
    vi.unstubAllGlobals();
});

describe("official i18n snapshot integration", () => {
    it("initializes both namespaces and switches between exact official names", async () => {
        const { initI18n } = await import("../i18n.js");
        const i18next = await initI18n();

        expect(i18next.language).toBe("zh");
        expect(i18next.t("translation:itemNames./items/gatherer_cape")).toBe("采集者披风");
        expect(i18next.t("translation:itemNames./items/gatherer_cape_refined")).toBe("采集者披风 ★");
        expect(i18next.t("common:menu.enhancement")).toBe("强化模拟");

        await i18next.changeLanguage("en");
        expect(i18next.t("translation:itemNames./items/gatherer_cape")).toBe("Gatherer Cape");
        expect(i18next.t("common:menu.enhancement")).toBe("Enhancement");
    });
});

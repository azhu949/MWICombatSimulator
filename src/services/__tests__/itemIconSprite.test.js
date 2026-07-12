import { describe, expect, it } from "vitest";
import {
    itemIconHref,
    itemIconNameFromHrid,
    itemIconSymbolId,
    resolveOfficialItemSpriteUrl,
} from "../itemIconSprite.js";

describe("itemIconSprite", () => {
    it("maps item hrids to collision-safe SVG symbol references", () => {
        expect(itemIconNameFromHrid("/items/gatherer_cape")).toBe("gatherer_cape");
        expect(itemIconSymbolId("/items/gatherer_cape")).toBe("mwi-item-icon-gatherer_cape");
        expect(itemIconHref("/items/gatherer_cape")).toBe("#mwi-item-icon-gatherer_cape");
        expect(itemIconHref("/items/not safe")).toBe("");
    });

    it("resolves the current sprite path from the official asset manifest", () => {
        expect(resolveOfficialItemSpriteUrl({
            files: {
                "static/media/items_sprite.abc123.svg": "/static/media/items_sprite.abc123.svg",
            },
        })).toBe("https://www.milkywayidle.com/static/media/items_sprite.abc123.svg");
    });

    it("rejects manifests that omit the item sprite", () => {
        expect(() => resolveOfficialItemSpriteUrl({ files: {} })).toThrow(/item sprite/i);
    });
});

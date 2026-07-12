const OFFICIAL_GAME_ORIGIN = "https://www.milkywayidle.com";
const OFFICIAL_ASSET_MANIFEST_URL = `${OFFICIAL_GAME_ORIGIN}/asset-manifest.json`;
const SPRITE_CONTAINER_ID = "mwi-official-item-icons";
const SYMBOL_PREFIX = "mwi-item-icon-";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

let sourceDocumentPromise = null;
const injectedSymbolNames = new Set();

export function itemIconNameFromHrid(hrid) {
    const name = String(hrid || "").split("/").filter(Boolean).pop() || "";
    return /^[a-z0-9_]+$/i.test(name) ? name : "";
}

export function itemIconSymbolId(hrid) {
    const name = itemIconNameFromHrid(hrid);
    return name ? `${SYMBOL_PREFIX}${name}` : "";
}

export function itemIconHref(hrid) {
    const symbolId = itemIconSymbolId(hrid);
    return symbolId ? `#${symbolId}` : "";
}

export function hasItemIconSymbol(hrid) {
    return injectedSymbolNames.has(itemIconNameFromHrid(hrid));
}

export function resolveOfficialItemSpriteUrl(manifest) {
    const files = manifest?.files && typeof manifest.files === "object" ? manifest.files : {};
    const spritePath = Object.entries(files).find(([key, value]) => (
        /items_sprite\..+\.svg$/i.test(String(key))
        || /items_sprite\..+\.svg$/i.test(String(value))
    ))?.[1];

    if (!spritePath) {
        throw new Error("Official item sprite was not found in the asset manifest.");
    }
    return new URL(String(spritePath), `${OFFICIAL_GAME_ORIGIN}/`).toString();
}

async function fetchSpriteDocument() {
    const manifestResponse = await fetch(OFFICIAL_ASSET_MANIFEST_URL, {
        credentials: "omit",
        mode: "cors",
    });
    if (!manifestResponse.ok) {
        throw new Error(`Failed to load the official asset manifest: ${manifestResponse.status}`);
    }

    const manifest = await manifestResponse.json();
    const spriteUrl = resolveOfficialItemSpriteUrl(manifest);
    const spriteResponse = await fetch(spriteUrl, {
        credentials: "omit",
        mode: "cors",
    });
    if (!spriteResponse.ok) {
        throw new Error(`Failed to load the official item sprite: ${spriteResponse.status}`);
    }

    const source = await spriteResponse.text();
    const sourceDocument = new DOMParser().parseFromString(source, "image/svg+xml");
    if (sourceDocument.querySelector("parsererror")) {
        throw new Error("Failed to parse the official item sprite.");
    }
    return sourceDocument;
}

function getSourceDocument() {
    if (!sourceDocumentPromise) {
        sourceDocumentPromise = fetchSpriteDocument().catch((error) => {
            sourceDocumentPromise = null;
            throw error;
        });
    }
    return sourceDocumentPromise;
}

function getSpriteContainer() {
    let container = document.getElementById(SPRITE_CONTAINER_ID);
    if (container) {
        return container;
    }

    container = document.createElementNS(SVG_NAMESPACE, "svg");
    container.id = SPRITE_CONTAINER_ID;
    container.setAttribute("aria-hidden", "true");
    container.setAttribute("focusable", "false");
    container.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
    document.body.prepend(container);
    return container;
}

export async function ensureItemIconSymbols(hrids = []) {
    if (typeof document === "undefined" || typeof DOMParser === "undefined") {
        throw new Error("Item icons require a browser document.");
    }

    const requestedNames = Array.from(new Set(hrids.map(itemIconNameFromHrid).filter(Boolean)));
    const missingNames = requestedNames.filter((name) => !injectedSymbolNames.has(name));
    if (missingNames.length === 0) {
        return requestedNames.length;
    }

    const sourceDocument = await getSourceDocument();
    const container = getSpriteContainer();
    const fragment = document.createDocumentFragment();

    for (const name of missingNames) {
        const sourceSymbol = sourceDocument.getElementById(name);
        if (!sourceSymbol) {
            continue;
        }

        const symbol = document.importNode(sourceSymbol, true);
        symbol.id = `${SYMBOL_PREFIX}${name}`;
        fragment.appendChild(symbol);
        injectedSymbolNames.add(name);
    }

    container.appendChild(fragment);
    return requestedNames.filter((name) => injectedSymbolNames.has(name)).length;
}

const OFFICIAL_GAME_ORIGIN = 'https://www.milkywayidle.com';
const OFFICIAL_ASSET_MANIFEST_URL = `${OFFICIAL_GAME_ORIGIN}/asset-manifest.json`;
const SPRITE_CONTAINER_ID = 'mwi-official-item-icons';
const ACTION_SPRITE_CONTAINER_ID = 'mwi-official-action-icons';
const SYMBOL_PREFIX = 'mwi-item-icon-';
const ACTION_SYMBOL_PREFIX = 'mwi-action-icon-';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

let sourceDocumentPromise = null;
let actionSourceDocumentPromise = null;
const injectedSymbolNames = new Set();
const injectedActionSymbolNames = new Set();

export function itemIconNameFromHrid(hrid) {
  const name =
    String(hrid || '')
      .split('/')
      .filter(Boolean)
      .pop() || '';
  return /^[a-z0-9_]+$/i.test(name) ? name : '';
}

export function itemIconSymbolId(hrid) {
  const name = itemIconNameFromHrid(hrid);
  return name ? `${SYMBOL_PREFIX}${name}` : '';
}

export function itemIconHref(hrid) {
  const symbolId = itemIconSymbolId(hrid);
  return symbolId ? `#${symbolId}` : '';
}

export function hasItemIconSymbol(hrid) {
  return injectedSymbolNames.has(itemIconNameFromHrid(hrid));
}

export function resolveOfficialItemSpriteUrl(manifest) {
  return resolveOfficialSpriteUrl(manifest, /items_sprite\..+\.svg$/i, 'Official item sprite');
}

// 动作图标（地牢 / 战斗动作）与物品图标同源：官方 actions_sprite 的 symbol id 即文件名
// （如 chimerical_den），与 MST 工具箱 getMapIconHref 的 sprite#<name> 用法一致。
export function resolveOfficialActionSpriteUrl(manifest) {
  return resolveOfficialSpriteUrl(manifest, /actions_sprite\..+\.svg$/i, 'Official action sprite');
}

function resolveOfficialSpriteUrl(manifest, pattern, label) {
  const files = manifest?.files && typeof manifest.files === 'object' ? manifest.files : {};
  const spritePath = Object.entries(files).find(
    ([key, value]) => pattern.test(String(key)) || pattern.test(String(value)),
  )?.[1];

  if (!spritePath) {
    throw new Error(`${label} was not found in the asset manifest.`);
  }
  return new URL(String(spritePath), `${OFFICIAL_GAME_ORIGIN}/`).toString();
}

async function fetchSpriteDocument(spriteUrl) {
  const spriteResponse = await fetch(spriteUrl, {
    credentials: 'omit',
    mode: 'cors',
  });
  if (!spriteResponse.ok) {
    throw new Error(`Failed to load the official sprite: ${spriteResponse.status}`);
  }

  const source = await spriteResponse.text();
  const sourceDocument = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (sourceDocument.querySelector('parsererror')) {
    throw new Error('Failed to parse the official sprite.');
  }
  return sourceDocument;
}

async function fetchOfficialSpriteDocument(resolveSpriteUrl) {
  const manifestResponse = await fetch(OFFICIAL_ASSET_MANIFEST_URL, {
    credentials: 'omit',
    mode: 'cors',
  });
  if (!manifestResponse.ok) {
    throw new Error(`Failed to load the official asset manifest: ${manifestResponse.status}`);
  }

  const manifest = await manifestResponse.json();
  return fetchSpriteDocument(resolveSpriteUrl(manifest));
}

function getSourceDocument() {
  if (!sourceDocumentPromise) {
    sourceDocumentPromise = fetchOfficialSpriteDocument(resolveOfficialItemSpriteUrl).catch((error) => {
      sourceDocumentPromise = null;
      throw error;
    });
  }
  return sourceDocumentPromise;
}

function getActionSourceDocument() {
  if (!actionSourceDocumentPromise) {
    actionSourceDocumentPromise = fetchOfficialSpriteDocument(resolveOfficialActionSpriteUrl).catch((error) => {
      actionSourceDocumentPromise = null;
      throw error;
    });
  }
  return actionSourceDocumentPromise;
}

function getSpriteContainer(containerId) {
  let container = document.getElementById(containerId);
  if (container) {
    return container;
  }

  container = document.createElementNS(SVG_NAMESPACE, 'svg');
  container.id = containerId;
  container.setAttribute('aria-hidden', 'true');
  container.setAttribute('focusable', 'false');
  container.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  document.body.prepend(container);
  return container;
}

export async function ensureItemIconSymbols(hrids = []) {
  if (typeof document === 'undefined' || typeof DOMParser === 'undefined') {
    throw new Error('Item icons require a browser document.');
  }

  const requestedNames = Array.from(new Set(hrids.map(itemIconNameFromHrid).filter(Boolean)));
  const missingNames = requestedNames.filter((name) => !injectedSymbolNames.has(name));
  if (missingNames.length === 0) {
    return requestedNames.length;
  }

  const sourceDocument = await getSourceDocument();
  const container = getSpriteContainer(SPRITE_CONTAINER_ID);
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

export function actionIconNameFromHrid(hrid) {
  return itemIconNameFromHrid(hrid);
}

export function actionIconSymbolId(hrid) {
  const name = actionIconNameFromHrid(hrid);
  return name ? `${ACTION_SYMBOL_PREFIX}${name}` : '';
}

export function actionIconHref(hrid) {
  const symbolId = actionIconSymbolId(hrid);
  return symbolId ? `#${symbolId}` : '';
}

export function hasActionIconSymbol(hrid) {
  return injectedActionSymbolNames.has(actionIconNameFromHrid(hrid));
}

export async function ensureActionIconSymbols(hrids = []) {
  if (typeof document === 'undefined' || typeof DOMParser === 'undefined') {
    throw new Error('Action icons require a browser document.');
  }

  const requestedNames = Array.from(new Set(hrids.map(actionIconNameFromHrid).filter(Boolean)));
  const missingNames = requestedNames.filter((name) => !injectedActionSymbolNames.has(name));
  if (missingNames.length === 0) {
    return requestedNames.length;
  }

  const sourceDocument = await getActionSourceDocument();
  const container = getSpriteContainer(ACTION_SPRITE_CONTAINER_ID);
  const fragment = document.createDocumentFragment();

  for (const name of missingNames) {
    const sourceSymbol = sourceDocument.getElementById(name);
    if (!sourceSymbol) {
      continue;
    }

    const symbol = document.importNode(sourceSymbol, true);
    symbol.id = `${ACTION_SYMBOL_PREFIX}${name}`;
    fragment.appendChild(symbol);
    injectedActionSymbolNames.add(name);
  }

  container.appendChild(fragment);
  return requestedNames.filter((name) => injectedActionSymbolNames.has(name)).length;
}

export const DEFAULT_MAIN_SITE_IMPORT_SCRIPT_URL =
  'https://greasyfork.org/zh-CN/scripts/568613-mwi-combat-simulator-%E4%B8%BB%E7%AB%99%E4%B8%80%E9%94%AE%E5%AF%BC%E5%85%A5';

export function resolveMainSiteImportScriptUrl(configuredUrl) {
  const candidate = configuredUrl === undefined ? DEFAULT_MAIN_SITE_IMPORT_SCRIPT_URL : String(configuredUrl).trim();

  if (!candidate) {
    return '';
  }

  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

export const MAIN_SITE_IMPORT_SCRIPT_URL = resolveMainSiteImportScriptUrl(
  import.meta.env.VITE_MAIN_SITE_IMPORT_SCRIPT_URL,
);

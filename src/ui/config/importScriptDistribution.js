// 主站导入脚本的分发入口。
// 为什么不再只依赖 GreasyFork：greasyfork.org 在国内访问不稳定，用户点「安装脚本」
// 大概率打不开页面，等于装不上。改成「站点自身托管」为主入口——用户既然能打开模拟器，
// 就一定能下载到同源的 .user.js；GreasyFork 降级为海外用户的备用来源。
//
// 站内地址用相对路径：站点部署在 GitHub Pages 子路径（/MWICombatSimulator/）与
// Cloudflare Pages 根路径两处，绝对路径只有一处能命中。
export const LOCAL_MAIN_SITE_IMPORT_SCRIPT_PATH = 'userscript/mwi-main-site-import.user.js';

// 版本元数据（scripts/sync-userscript-to-public.mjs 生成）：供「站点当前版本」比对。
export const LOCAL_MAIN_SITE_IMPORT_SCRIPT_META_PATH = 'userscript/mwi-main-site-import.meta.json';

export const GREASYFORK_MAIN_SITE_IMPORT_SCRIPT_URL =
  'https://greasyfork.org/zh-CN/scripts/568613-mwi-combat-simulator-%E4%B8%BB%E7%AB%99%E4%B8%80%E9%94%AE%E5%AF%BC%E5%85%A5';

/** 更新渠道标识：站点自身分发 / GreasyFork 备用来源。 */
export const IMPORT_SCRIPT_CHANNEL_SITE = 'site';
export const IMPORT_SCRIPT_CHANNEL_GREASYFORK = 'greasyfork';

/**
 * 组装「更新渠道」列表。
 * why：同一个脚本可能从站点装、也可能从 GreasyFork 装，侧栏只给一个默认入口会把
 * 另一渠道的用户带到不可用的地址（GreasyFork 在国内打不开）。渠道顺序固定为
 * 「站点优先、GreasyFork 备用」，地址相同则去重（无 location 的 SSR/测试环境里
 * 主入口会回退到 GreasyFork，不能出现两个一模一样的选项）。
 */
export function buildImportScriptChannels({
  primaryUrl = '',
  greasyforkUrl = GREASYFORK_MAIN_SITE_IMPORT_SCRIPT_URL,
} = {}) {
  const channels = [];
  const siteUrl = String(primaryUrl || '').trim();
  if (siteUrl) {
    channels.push({ key: IMPORT_SCRIPT_CHANNEL_SITE, url: siteUrl });
  }

  const greasyfork = String(greasyforkUrl || '').trim();
  if (greasyfork && greasyfork !== siteUrl) {
    channels.push({ key: IMPORT_SCRIPT_CHANNEL_GREASYFORK, url: greasyfork });
  }

  return channels;
}

/**
 * 解析站内脚本下载地址（绝对 URL）。
 * 依据当前页面的 location 拼出同源地址，因此 dev（localhost:5173/userscript/...）、
 * GitHub Pages 子路径、Cloudflare Pages 根路径三种部署都自动正确。
 * 无 location（SSR / 测试环境）时返回空串，调用方回退到 GreasyFork。
 */
export function resolveLocalImportScriptUrl(locationLike = globalThis.location) {
  const origin = String(locationLike?.origin || '').trim();
  if (!origin) {
    return '';
  }

  try {
    // 以 index.html 所在目录为基准：站点 base 为 './'，路径相对当前页面即可。
    const baseUrl = new URL('.', String(locationLike.href || `${origin}/`));
    return new URL(LOCAL_MAIN_SITE_IMPORT_SCRIPT_PATH, baseUrl).href;
  } catch {
    return '';
  }
}

/** 主入口：优先站内下载，站点地址不可解析时回退 GreasyFork（海外/异常兜底）。 */
export function resolveMainSiteImportScriptInstallUrl(locationLike = globalThis.location) {
  return resolveLocalImportScriptUrl(locationLike) || GREASYFORK_MAIN_SITE_IMPORT_SCRIPT_URL;
}

/** 允许部署方用 VITE_MAIN_SITE_IMPORT_SCRIPT_URL 覆盖（自建镜像等），非法值忽略。 */
export function resolveConfiguredImportScriptUrl(configuredUrl) {
  if (configuredUrl === undefined || configuredUrl === null) {
    return '';
  }

  const candidate = String(configuredUrl).trim();
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

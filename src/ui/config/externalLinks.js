import {
  GREASYFORK_MAIN_SITE_IMPORT_SCRIPT_URL,
  buildImportScriptChannels,
  resolveConfiguredImportScriptUrl,
  resolveMainSiteImportScriptInstallUrl,
} from './importScriptDistribution.js';

// 兼容既有调用方（侧栏、导入弹窗、测试）：默认值改为「站内下载」，GreasyFork 作为备用。
// 分发策略与理由见 importScriptDistribution.js。
export const DEFAULT_MAIN_SITE_IMPORT_SCRIPT_URL = resolveMainSiteImportScriptInstallUrl();

export { GREASYFORK_MAIN_SITE_IMPORT_SCRIPT_URL };

/**
 * 解析最终使用的安装地址。
 * - 未配置（undefined / null）：站内下载 → GreasyFork 兜底；
 * - 显式配置了合法 HTTP(S) 地址：用配置值（自建镜像）；
 * - 显式配置了空串或非法值：按既有契约禁用链接（返回空串），不回退默认——
 *   这是部署方「主动关掉安装入口」的表达方式。
 */
export function resolveMainSiteImportScriptUrl(configuredUrl) {
  if (configuredUrl === undefined || configuredUrl === null) {
    return resolveMainSiteImportScriptInstallUrl();
  }

  if (String(configuredUrl).trim() === '') {
    return '';
  }

  return resolveConfiguredImportScriptUrl(configuredUrl);
}

export const MAIN_SITE_IMPORT_SCRIPT_URL = resolveMainSiteImportScriptUrl(
  import.meta.env.VITE_MAIN_SITE_IMPORT_SCRIPT_URL,
);

/**
 * 侧栏「更新渠道」可选项：站点下载 + GreasyFork 备用（按顺序、去重）。
 * 主入口被部署方显式禁用（VITE_MAIN_SITE_IMPORT_SCRIPT_URL=''）时仍会返回
 * GreasyFork；是否展示更新入口由侧栏按「主入口是否存在」决定，避免重新打开
 * 被主动关闭的安装入口。
 */
export const MAIN_SITE_IMPORT_SCRIPT_CHANNELS = buildImportScriptChannels({
  primaryUrl: MAIN_SITE_IMPORT_SCRIPT_URL,
  greasyforkUrl: GREASYFORK_MAIN_SITE_IMPORT_SCRIPT_URL,
});

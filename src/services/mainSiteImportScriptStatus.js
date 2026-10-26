// 主站导入油猴脚本（scripts/mwi-main-site-import.user.js）的安装状态与版本探测。
// why：模拟器页面无法直接调用脚本管理器的 GM_* API，脚本在模拟器页把自身版本写到
// <html> 的 data-* 属性上（见脚本内 installSimulatorScriptMarker），侧栏读这两个属性
// 即可判断「有没有装」以及「装的是不是最新版」。期望版本、期望校验值与 @match 列表由
// vite define 从脚本头部 @version、脚本字节哈希与 @match 注入，避免这些信息在脚本与
// 前端两处手工维护而漂移；@match 列表用于判断当前站点是否在脚本注入范围内
// （见 resolveImportScriptCoverage）。

const injectedExpectedVersion =
  typeof __MAIN_SITE_IMPORT_SCRIPT_VERSION__ === 'string' ? __MAIN_SITE_IMPORT_SCRIPT_VERSION__ : '';

/** 本仓库携带的脚本版本；脚本源码缺失或未注入时为空串（此时只能判断「装没装」）。 */
export const MAIN_SITE_IMPORT_SCRIPT_VERSION = String(injectedExpectedVersion).trim();

const injectedExpectedSha256 =
  typeof __MAIN_SITE_IMPORT_SCRIPT_SHA256__ === 'string' ? __MAIN_SITE_IMPORT_SCRIPT_SHA256__ : '';

/**
 * 本仓库携带脚本的 SHA-256（构建期按字节计算并注入，与站点分发的副本逐字节对应）。
 * 供安装入口展示，让用户把下载到的脚本与仓库/发布说明的同一版本核对；未注入时为空串
 * （此时不展示该行）。注意它出自同一条发布链，只能发现「分发内容与发布内容不一致」，
 * 不能替代对发布方本身的信任（见 scripts/mwi-main-site-import.README.md 的信任边界一节）。
 */
export const MAIN_SITE_IMPORT_SCRIPT_SHA256 = String(injectedExpectedSha256).trim().toLowerCase();

const injectedMatches =
  typeof __MAIN_SITE_IMPORT_SCRIPT_MATCHES__ !== 'undefined' && Array.isArray(__MAIN_SITE_IMPORT_SCRIPT_MATCHES__)
    ? __MAIN_SITE_IMPORT_SCRIPT_MATCHES__
    : [];

/**
 * 本仓库携带脚本的 @match 列表（构建期从脚本头部提取，单一事实源仍在脚本里）。
 * 未注入时为空数组：覆盖率判定降级为 unknown（fail-open），不会把「不知道」当成「不覆盖」。
 */
export const MAIN_SITE_IMPORT_SCRIPT_MATCHES = Object.freeze(
  injectedMatches.map((pattern) => String(pattern || '').trim()).filter(Boolean),
);

/**
 * 当前页面是否落在脚本注入范围内。
 * unknown = 没有可用证据（未注入匹配列表 / 写法超出支持的子集 / 地址无法解析），
 * 调用方必须保持原行为；只有 uncovered 才能断定「脚本在本站点永远不会被注入」。
 */
export const IMPORT_SCRIPT_COVERAGE_COVERED = 'covered';
export const IMPORT_SCRIPT_COVERAGE_UNCOVERED = 'uncovered';
export const IMPORT_SCRIPT_COVERAGE_UNKNOWN = 'unknown';

// 只实现本仓库脚本头部实际使用的 Chrome / Tampermonkey match pattern 子集：
// scheme 取 http / https / *；host 取精确值、* 或 *.example.com；path 中 * 为通配。
// 解析失败返回 null（调用方按 unknown 处理），绝不把未知写法判成「不覆盖」。
const IMPORT_SCRIPT_MATCH_PATTERN = /^(\*|https?):\/\/([^/]+)(\/.*)$/;

function buildImportScriptPathRegExp(pathPattern) {
  const source = String(pathPattern || '/')
    .split('*')
    .map((segment) => segment.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`);
}

function matchImportScriptPattern(pattern, url) {
  const parts = String(pattern || '')
    .trim()
    .match(IMPORT_SCRIPT_MATCH_PATTERN);
  if (!parts) {
    return null;
  }

  const [, scheme, rawHostPattern, pathPattern] = parts;
  if (scheme !== '*' && scheme !== url.protocol.replace(/:$/, '')) {
    return false;
  }

  const hostPattern = rawHostPattern.toLowerCase();
  const urlHost = url.host.toLowerCase();
  if (hostPattern === '*') {
    // 通配主机：任意主机（含端口）都算覆盖。
  } else if (hostPattern.startsWith('*.')) {
    const suffix = hostPattern.slice(2);
    if (urlHost !== suffix && !urlHost.endsWith(`.${suffix}`)) {
      return false;
    }
  } else if (urlHost !== hostPattern) {
    return false;
  }

  // @match 的 path 不包含 hash：本项目用 hash 路由，地址形如
  // https://host/base/#/home，参与匹配的只有 pathname 与查询串。
  return buildImportScriptPathRegExp(pathPattern).test(`${url.pathname}${url.search}`);
}

/**
 * 判断页面地址是否被脚本 @match 覆盖。
 * @returns {'covered'|'uncovered'|'unknown'}
 */
export function resolveImportScriptCoverage(urlLike, patterns = MAIN_SITE_IMPORT_SCRIPT_MATCHES) {
  const list = Array.isArray(patterns) ? patterns : [];
  if (list.length === 0) {
    return IMPORT_SCRIPT_COVERAGE_UNKNOWN;
  }

  let url = null;
  try {
    url = urlLike instanceof URL ? urlLike : new URL(String(urlLike || ''));
  } catch {
    return IMPORT_SCRIPT_COVERAGE_UNKNOWN;
  }

  let hasUnknownPattern = false;
  for (const pattern of list) {
    const matched = matchImportScriptPattern(pattern, url);
    if (matched === true) {
      return IMPORT_SCRIPT_COVERAGE_COVERED;
    }
    if (matched === null) {
      hasUnknownPattern = true;
    }
  }

  return hasUnknownPattern ? IMPORT_SCRIPT_COVERAGE_UNKNOWN : IMPORT_SCRIPT_COVERAGE_UNCOVERED;
}

/** 脚本写入的「已安装」标记属性（值固定为 '1'，存在即安装）。 */
export const IMPORT_SCRIPT_DETECTED_ATTRIBUTE = 'data-mwi-tm-import-script';
/** 脚本写入的版本属性（GM_info.script.version，读不到时不写）。 */
export const IMPORT_SCRIPT_VERSION_ATTRIBUTE = 'data-mwi-tm-import-script-version';

export const IMPORT_SCRIPT_STATUS_CURRENT = 'current';
export const IMPORT_SCRIPT_STATUS_OUTDATED = 'outdated';
/**
 * 已安装、但读不到可比较的版本。旧版脚本（0.1.50 及更早）不写版本标记，只有新版才上报，
 * 因此「装了但没版本」正是旧版脚本的特征。绝不能归入 missing：用户明明装了旧版脚本，
 * 却被报「未安装」，会误以为脚本失效而重复安装。
 */
export const IMPORT_SCRIPT_STATUS_LEGACY = 'legacy';
export const IMPORT_SCRIPT_STATUS_MISSING = 'missing';

/**
 * 规范化版本串：去空白、去前缀 v。非字符串输入（null/undefined/数字）按字符串处理。
 */
export function normalizeImportScriptVersion(value) {
  return String(value ?? '')
    .trim()
    .replace(/^v/i, '');
}

/**
 * 解析为数字段数组；含非数字段（如 '0.1.50-beta'）时返回 null——版本比较只认纯数字版本，
 * 预发布后缀不参与比较，交由调用方降级为「版本未知」，避免用猜测的规则误判新旧。
 */
export function parseImportScriptVersion(value) {
  const normalized = normalizeImportScriptVersion(value);
  if (!normalized) {
    return null;
  }

  const parts = normalized.split('.');
  if (!parts.every((part) => /^\d+$/.test(part))) {
    return null;
  }

  return parts.map((part) => Number(part));
}

/**
 * 比较两个版本：left 更新返回 1，相同返回 0，left 更旧返回 -1；任一侧无法解析返回 null。
 * 段数不同时按缺位补 0（'0.1' 与 '0.1.0' 视为相同），与语义化版本惯例一致。
 */
export function compareImportScriptVersions(left, right) {
  const leftParts = parseImportScriptVersion(left);
  const rightParts = parseImportScriptVersion(right);
  if (!leftParts || !rightParts) {
    return null;
  }

  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }

  return 0;
}

/**
 * 判定安装状态。
 * - 未检测到任何痕迹 → missing（只有「连脚本注入的按钮都没有」才算没装）。
 * - 检测到安装痕迹但版本不可用/不可解析/期望版本缺失 → legacy（已安装的旧版脚本，需更新）。
 * - 已安装版本 ≥ 期望版本 → current（本地开发版更高时同样视为最新，不误报过期）。
 * - 已安装版本 < 期望版本 → outdated。
 */
export function resolveImportScriptStatus({
  detected = false,
  installedVersion = '',
  expectedVersion = MAIN_SITE_IMPORT_SCRIPT_VERSION,
} = {}) {
  if (!detected) {
    return IMPORT_SCRIPT_STATUS_MISSING;
  }

  const expected = normalizeImportScriptVersion(expectedVersion);
  const installed = normalizeImportScriptVersion(installedVersion);
  if (!expected || !installed) {
    return IMPORT_SCRIPT_STATUS_LEGACY;
  }

  const comparison = compareImportScriptVersions(installed, expected);
  if (comparison === null) {
    return IMPORT_SCRIPT_STATUS_LEGACY;
  }

  return comparison >= 0 ? IMPORT_SCRIPT_STATUS_CURRENT : IMPORT_SCRIPT_STATUS_OUTDATED;
}

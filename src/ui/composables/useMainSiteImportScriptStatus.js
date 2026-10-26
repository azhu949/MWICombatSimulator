import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  IMPORT_SCRIPT_DETECTED_ATTRIBUTE,
  IMPORT_SCRIPT_VERSION_ATTRIBUTE,
  MAIN_SITE_IMPORT_SCRIPT_VERSION,
  resolveImportScriptCoverage,
  resolveImportScriptStatus,
} from '../../services/mainSiteImportScriptStatus.js';

// 旧版脚本（0.1.50 及更早）不写 <html> 标记，但会在模拟器页注入这几个节点
// （id 见 scripts/mwi-main-site-import.user.js 的 CONTROL_ID / BUTTON_ID / STATUS_ID）。
// 它们就是「装了脚本」的副证据——没有它，旧版用户会被误判成未安装。
const INJECTED_SCRIPT_NODE_IDS = ['mwi-tm-import-control', 'mwi-tm-import-button', 'mwi-tm-import-status'];

// 脚本注入控件的挂载锚点（首页 / 强化 / 生活技能页各一处）。锚点在 = 当前页面具备
// 「脚本本该在这里插按钮」的条件，因此可以据此判定未安装；无锚点页面（设置页、
// 更新日志页等）永远读不到按钮，属于无法判断，不能当成否定证据。
const IMPORT_ANCHOR_SELECTOR = '[data-tm-import-anchor]';

// 历史确认记忆：只用于「当前页面无法判断」的场合（如直接刷新在设置页），避免同一浏览器
// 明明装着脚本却显示未安装。它绝不能推翻当前页的否定证据——脚本删除后刷新首页必须
// 立刻变回未安装，所以 TTL 只做兜底（1 天），真正的纠正是「否定证据优先」。
const DETECTION_MEMORY_KEY = 'mwi.importScript.detection.v2';
const DETECTION_MEMORY_TTL_MS = 24 * 60 * 60 * 1000;

// 持久化已安装标记：上面的历史记忆带 1 天 TTL，而旧版脚本（0.1.50 及更早）既不写 <html>
// 标记、注入控件又只存在于带锚点页面，用户超过一天没访问带锚点页面就会在设置页/更新日志页
// 掉回「未安装」。这个标记不带过期时间，只用于「当前页面无法证伪」时兜底；它仍服从
// 否定证据优先——带锚点页面确认未安装时一并清除（见 confirmMissing）。
const INSTALLED_MARK_KEY = 'mwi.importScript.installed';

// 锚点出现后，脚本的 MutationObserver 需要一拍才会插入按钮；给一个短宽限期再确认未安装，
// 避免首屏在「未安装」与「已安装」之间闪一下。
const MISSING_CONFIRM_DELAY_MS = 500;
// body 子树观察的节流间隔：Vue 应用 DOM 变动频繁，避免每次渲染都做一次全量查询。
const BODY_CHECK_THROTTLE_MS = 250;

function readDetectionMemory(now = Date.now()) {
  try {
    const raw = localStorage.getItem(DETECTION_MEMORY_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    const detectedAt = Number(parsed?.detectedAt || 0);
    if (!Number.isFinite(detectedAt) || detectedAt <= 0 || now - detectedAt > DETECTION_MEMORY_TTL_MS) {
      return null;
    }
    return { version: String(parsed?.version || '').trim() };
  } catch {
    return null;
  }
}

function writeDetectionMemory(version) {
  const nextVersion = String(version || '').trim();
  // body 观察器每 250ms 采样一次：版本未变化且记录仍在 TTL 内时无需重写，detectedAt
  // 保持首次/变化时的值即可，避免整页生命周期内持续同步写存储。记录过期返回 null 时
  // 仍会重写，保证 TTL 过期后的首次采样恢复「无锚点页面识别脚本被删除」的能力。
  const memory = readDetectionMemory();
  if (memory && memory.version === nextVersion) {
    return;
  }
  try {
    localStorage.setItem(DETECTION_MEMORY_KEY, JSON.stringify({ detectedAt: Date.now(), version: nextVersion }));
  } catch {
    // 隐私模式等场景下 localStorage 不可写：退化为纯运行时检测，不影响主流程。
  }
}

function clearDetectionMemory() {
  try {
    localStorage.removeItem(DETECTION_MEMORY_KEY);
  } catch {
    // 同上：清不掉也不影响本次会话的判定结果。
  }
}

function readInstalledMark() {
  try {
    return localStorage.getItem(INSTALLED_MARK_KEY) === '1';
  } catch {
    return false;
  }
}

function writeInstalledMark() {
  // '1' 是幂等值：已存在时重复写入没有语义收益，而 body 观察器会高频采样。
  if (readInstalledMark()) {
    return;
  }
  try {
    localStorage.setItem(INSTALLED_MARK_KEY, '1');
  } catch {
    // 隐私模式等场景下 localStorage 不可写：退化为纯运行时检测，不影响主流程。
  }
}

function clearInstalledMark() {
  try {
    localStorage.removeItem(INSTALLED_MARK_KEY);
  } catch {
    // 同上：清不掉也不影响本次会话的判定结果。
  }
}

/**
 * 读取主站导入脚本留下的安装痕迹，并持续跟随其变化。
 * 证据按强度排序：
 *   1. <html> 上的标记 + 版本属性（新版脚本，任意页面可读，最精确）；
 *   2. 脚本注入的导入控件（旧版也有，但只存在于带锚点的页面）；
 *   3. 历史确认记忆（仅当当前页面无法判断时兜底，带 1 天 TTL）；
 *   4. 持久化已安装标记（旧版脚本在无锚点页面的最终兜底，无 TTL）。
 * 否定证据优先：当前页面有锚点却没有控件 → 未安装，并清空记忆与持久标记。
 */
export function useMainSiteImportScriptStatus() {
  const detected = ref(false);
  const installedVersion = ref('');

  // 当前站点是否落在脚本 @match 范围内（covered / uncovered / unknown）：自定义域名 /
  // 自建镜像上脚本根本不会被注入，侧栏必须据此降级为中性说明，而不是常驻「未安装」
  // 并给出装完也不生效的入口。同源部署的页面地址在会话内不会跨 origin 变化，只取一次。
  const coverage = ref(resolveImportScriptCoverage(globalThis.location?.href || ''));

  const status = computed(() =>
    resolveImportScriptStatus({
      detected: detected.value,
      installedVersion: installedVersion.value,
      expectedVersion: MAIN_SITE_IMPORT_SCRIPT_VERSION,
    }),
  );

  let attributeObserver = null;
  let injectedNodeObserver = null;
  let pendingMissingTimer = null;
  let lastBodyCheckAt = 0;
  let lastAnchorCount = 0;
  // 被节流窗口吞掉的 body 变动的兜底复核定时器（trailing 节流），保证变动停止后仍复核一次。
  let bodyCheckTimer = null;

  function queryDocument(callback, fallback) {
    try {
      return callback();
    } catch {
      return fallback;
    }
  }

  function hasInjectedScriptNode() {
    return queryDocument(() => INJECTED_SCRIPT_NODE_IDS.some((id) => Boolean(document.getElementById(id))), false);
  }

  function hasImportAnchor() {
    return queryDocument(() => Boolean(document.querySelector(IMPORT_ANCHOR_SELECTOR)), false);
  }

  function cancelPendingMissingConfirm() {
    if (pendingMissingTimer !== null) {
      clearTimeout(pendingMissingTimer);
      pendingMissingTimer = null;
    }
  }

  /** 确认未安装：降级状态并清空记忆与持久标记，避免下次在无法判断的页面又误报已安装。 */
  function confirmMissing() {
    detected.value = false;
    installedVersion.value = '';
    clearDetectionMemory();
    clearInstalledMark();
  }

  /**
   * 有锚点但此刻没有控件：先排一次延迟复核再下结论。脚本注入按钮晚于锚点渲染，
   * 立即判定会在首屏闪一下「未安装」。
   */
  function scheduleMissingConfirm() {
    if (pendingMissingTimer !== null || typeof setTimeout !== 'function') {
      return;
    }

    pendingMissingTimer = setTimeout(() => {
      pendingMissingTimer = null;
      if (hasInjectedScriptNode() || hasMarker()) {
        readEvidence();
        return;
      }
      // 复核时页面已切走（无锚点）：无法判断，保持现状，不误伤。
      if (!hasImportAnchor()) {
        return;
      }
      confirmMissing();
    }, MISSING_CONFIRM_DELAY_MS);
  }

  function hasMarker() {
    const root = queryDocument(() => (typeof document === 'undefined' ? null : document.documentElement), null);
    return Boolean(root?.hasAttribute(IMPORT_SCRIPT_DETECTED_ATTRIBUTE));
  }

  /** 采样一次安装痕迹；返回是否确认「装了脚本」。 */
  function readEvidence() {
    const root = queryDocument(() => (typeof document === 'undefined' ? null : document.documentElement), null);

    // 1) 最强证据：新版脚本写的标记 + 版本（任意页面可读）。
    if (root?.hasAttribute(IMPORT_SCRIPT_DETECTED_ATTRIBUTE)) {
      cancelPendingMissingConfirm();
      detected.value = true;
      installedVersion.value = String(root.getAttribute(IMPORT_SCRIPT_VERSION_ATTRIBUTE) || '').trim();
      writeDetectionMemory(installedVersion.value);
      writeInstalledMark();
      return true;
    }

    // 2) 次强证据：脚本注入的导入控件（旧版也写，仅存在于带锚点的页面）。
    if (hasInjectedScriptNode()) {
      cancelPendingMissingConfirm();
      detected.value = true;
      installedVersion.value = '';
      writeDetectionMemory('');
      writeInstalledMark();
      return true;
    }

    // 3) 否定证据：当前页有锚点却读不到控件 → 脚本不在。延迟复核后确认未安装并清记忆。
    if (hasImportAnchor()) {
      scheduleMissingConfirm();
      return detected.value;
    }

    // 4) 无锚点页面（设置页、更新日志页等）读不到控件，但仍有可用的否定证据：
    //    新版脚本会在任何 @match 页面写标记，标记缺席且记忆里存过版本号 → 它已被删除。
    //    旧版脚本不写标记，此时无法判断，只能沿用历史确认（含无 TTL 的持久标记），
    //    否则换个页面就掉回未安装。
    if (!detected.value) {
      const memory = readDetectionMemory();
      if (memory?.version) {
        confirmMissing();
        return false;
      }
      if (memory || readInstalledMark()) {
        detected.value = true;
        installedVersion.value = '';
      }
    }

    return detected.value;
  }

  /**
   * 带锚点页面离开后（锚点从有到无）强制复核一次：此前读到的控件/标记可能只是上一个
   * 页面残留。必须绕过 body 观察的节流，否则路由切换后要等下一次 DOM 变动才纠正。
   */
  function readEvidenceNow() {
    lastBodyCheckAt = 0;
    return readEvidence();
  }

  function cancelPendingBodyCheck() {
    if (bodyCheckTimer !== null) {
      clearTimeout(bodyCheckTimer);
      bodyCheckTimer = null;
    }
  }

  /** 被节流窗口吞掉的变动：安排一次 ≤250ms 的兜底复核，保证「变动停止后最终会纠正」。 */
  function scheduleBodyCheck(delay) {
    if (bodyCheckTimer !== null || typeof setTimeout !== 'function') {
      return;
    }
    bodyCheckTimer = setTimeout(() => {
      bodyCheckTimer = null;
      runBodyCheck();
    }, delay);
  }

  /**
   * 一次完整采样：全文档锚点计数 + 证据重读。这是执行 querySelectorAll 的唯一路径，
   * 全文档扫描频率被限制为每 BODY_CHECK_THROTTLE_MS 至多一次。
   */
  function runBodyCheck() {
    cancelPendingBodyCheck();
    lastBodyCheckAt = Date.now();
    const anchorCount = queryDocument(() => document.querySelectorAll(IMPORT_ANCHOR_SELECTOR).length, 0);
    if (anchorCount !== lastAnchorCount) {
      lastAnchorCount = anchorCount;
      // 锚点数量变化（路由切换）：绕过节流立即复核，下次变动也不被节流。
      readEvidenceNow();
      return;
    }
    readEvidence();
  }

  onMounted(() => {
    readEvidence();
    lastAnchorCount = queryDocument(() => document.querySelectorAll(IMPORT_ANCHOR_SELECTOR).length, 0);

    if (typeof MutationObserver !== 'function' || typeof document === 'undefined') {
      return;
    }

    // 属性观察常驻：脚本可能晚于应用挂载才注入，标记补上后要能升级为精确版本。
    if (document.documentElement) {
      attributeObserver = new MutationObserver(() => {
        readEvidence();
      });
      attributeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: [IMPORT_SCRIPT_DETECTED_ATTRIBUTE, IMPORT_SCRIPT_VERSION_ATTRIBUTE],
      });
    }

    // 子树观察常驻但节流：既用于等待旧版脚本插入控件，也用于「脚本被删除 / 路由切到
    // 无锚点页面」时把状态降级回未安装。全文档扫描（锚点计数 + 证据采样）只在距上次
    // 采样满 BODY_CHECK_THROTTLE_MS 时执行；被节流窗口吞掉的变动由 scheduleBodyCheck
    // 安排 trailing 兜底，保证变动停止后仍复核一次，锚点数量变化（路由切换）不会因
    // 高频变动被永久吞掉，最多延迟一个节流间隔即纠正。
    if (document.body) {
      injectedNodeObserver = new MutationObserver(() => {
        const elapsed = Date.now() - lastBodyCheckAt;
        if (elapsed >= BODY_CHECK_THROTTLE_MS) {
          runBodyCheck();
          return;
        }
        // 仍在节流窗口内：不立即扫描，安排相对窗口剩余时间的兜底复核。
        scheduleBodyCheck(BODY_CHECK_THROTTLE_MS - elapsed);
      });
      injectedNodeObserver.observe(document.body, { childList: true, subtree: true });
    }
  });

  onUnmounted(() => {
    cancelPendingMissingConfirm();
    cancelPendingBodyCheck();
    attributeObserver?.disconnect();
    attributeObserver = null;
    injectedNodeObserver?.disconnect();
    injectedNodeObserver = null;
  });

  return {
    detected,
    installedVersion,
    coverage,
    status,
    expectedVersion: MAIN_SITE_IMPORT_SCRIPT_VERSION,
    refresh: readEvidence,
  };
}

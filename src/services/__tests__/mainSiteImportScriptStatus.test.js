import { describe, expect, it } from 'vitest';
import {
  IMPORT_SCRIPT_STATUS_CURRENT,
  IMPORT_SCRIPT_STATUS_LEGACY,
  IMPORT_SCRIPT_STATUS_MISSING,
  IMPORT_SCRIPT_STATUS_OUTDATED,
  MAIN_SITE_IMPORT_SCRIPT_SHA256,
  MAIN_SITE_IMPORT_SCRIPT_VERSION,
  compareImportScriptVersions,
  parseImportScriptVersion,
  resolveImportScriptStatus,
} from '../mainSiteImportScriptStatus.js';

// 侧栏的「导入脚本待更新 / 未安装」判定完全压在这几个纯函数上，而解析口径出错（段数不等、
// 预发布后缀、版本读不到）既不抛错也不留痕，只会静默给出错误状态让用户误装或误更新，
// 因此在用例里逐分支锚定取值。
describe('parseImportScriptVersion', () => {
  it('parses a plain dotted version into numeric segments', () => {
    expect(parseImportScriptVersion('0.1.51')).toEqual([0, 1, 51]);
  });

  it('normalizes surrounding whitespace and a leading v prefix', () => {
    expect(parseImportScriptVersion('  v0.1.51  ')).toEqual([0, 1, 51]);
    expect(parseImportScriptVersion('V0.1.51')).toEqual([0, 1, 51]);
  });

  it('returns null for empty, missing, or non-version input', () => {
    expect(parseImportScriptVersion('')).toBeNull();
    expect(parseImportScriptVersion('   ')).toBeNull();
    expect(parseImportScriptVersion(null)).toBeNull();
    expect(parseImportScriptVersion(undefined)).toBeNull();
    expect(parseImportScriptVersion('v')).toBeNull();
  });

  it('returns null when any segment is not a pure number', () => {
    // 预发布后缀不参与比较：猜一套大小规则会把 beta 误判成比正式版新或旧。
    expect(parseImportScriptVersion('0.1.50-beta')).toBeNull();
    expect(parseImportScriptVersion('0.1.x')).toBeNull();
  });
});

describe('compareImportScriptVersions', () => {
  it('treats missing trailing segments as zero', () => {
    expect(compareImportScriptVersions('0.1', '0.1.0')).toBe(0);
  });

  it('orders versions segment by segment', () => {
    expect(compareImportScriptVersions('0.1.51', '0.1.50')).toBe(1);
    expect(compareImportScriptVersions('0.1.50', '0.1.51')).toBe(-1);
    expect(compareImportScriptVersions('1.0.0', '0.99.99')).toBe(1);
    // 逐段数值比较：'0.2' 比 '0.10' 旧（字符串比较会得出相反结论）。
    expect(compareImportScriptVersions('0.2', '0.10')).toBe(-1);
  });

  it('returns null when either side cannot be parsed', () => {
    expect(compareImportScriptVersions('0.1.50-beta', '0.1.51')).toBeNull();
    expect(compareImportScriptVersions('0.1.51', '')).toBeNull();
  });
});

describe('resolveImportScriptStatus', () => {
  const expectedVersion = '0.1.51';

  it('reports missing only when no installation trace was detected', () => {
    expect(resolveImportScriptStatus({ detected: false, expectedVersion })).toBe(IMPORT_SCRIPT_STATUS_MISSING);
    expect(resolveImportScriptStatus({ expectedVersion })).toBe(IMPORT_SCRIPT_STATUS_MISSING);
  });

  it('reports legacy when the installed or the expected version is unusable', () => {
    // 旧版脚本不写版本标记，期望版本也可能因脚本源码缺失而未注入：两种情况都无法比较，
    // 只能是 legacy（「已装但版本未知」）。归入 missing 会诱导装着的用户重复安装。
    expect(resolveImportScriptStatus({ detected: true, installedVersion: '', expectedVersion })).toBe(
      IMPORT_SCRIPT_STATUS_LEGACY,
    );
    expect(resolveImportScriptStatus({ detected: true, installedVersion: '0.1.51', expectedVersion: '' })).toBe(
      IMPORT_SCRIPT_STATUS_LEGACY,
    );
    expect(resolveImportScriptStatus({ detected: true, installedVersion: '0.1.50-beta', expectedVersion })).toBe(
      IMPORT_SCRIPT_STATUS_LEGACY,
    );
  });

  it('reports current for an equal or newer installation', () => {
    expect(resolveImportScriptStatus({ detected: true, installedVersion: '0.1.51', expectedVersion })).toBe(
      IMPORT_SCRIPT_STATUS_CURRENT,
    );
    expect(resolveImportScriptStatus({ detected: true, installedVersion: 'v0.1.51', expectedVersion })).toBe(
      IMPORT_SCRIPT_STATUS_CURRENT,
    );
    // 本地开发版高于仓库携带版本时同样视为最新，不误报过期。
    expect(resolveImportScriptStatus({ detected: true, installedVersion: '0.1.52', expectedVersion })).toBe(
      IMPORT_SCRIPT_STATUS_CURRENT,
    );
  });

  it('reports outdated only for an older installation', () => {
    expect(resolveImportScriptStatus({ detected: true, installedVersion: '0.1.50', expectedVersion })).toBe(
      IMPORT_SCRIPT_STATUS_OUTDATED,
    );
    expect(resolveImportScriptStatus({ detected: true, installedVersion: '0.0.99', expectedVersion })).toBe(
      IMPORT_SCRIPT_STATUS_OUTDATED,
    );
  });
});

// 构建期注入的脚本身份（vite define）：注入为空串时安装入口不展示核对行，注入成功时必须是
// 可直接比对的明文版本号与 64 位小写十六进制哈希——否则用户拿到的是一个核对不了的值。
describe('injected main-site import script identity', () => {
  it('exposes string constants that stay verifiable when injected', () => {
    expect(typeof MAIN_SITE_IMPORT_SCRIPT_VERSION).toBe('string');
    expect(typeof MAIN_SITE_IMPORT_SCRIPT_SHA256).toBe('string');

    if (MAIN_SITE_IMPORT_SCRIPT_VERSION) {
      expect(MAIN_SITE_IMPORT_SCRIPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    }
    if (MAIN_SITE_IMPORT_SCRIPT_SHA256) {
      expect(MAIN_SITE_IMPORT_SCRIPT_SHA256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

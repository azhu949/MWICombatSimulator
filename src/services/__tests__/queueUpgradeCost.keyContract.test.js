import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'acorn';
import { getAbilityUpgradeCostKey } from '../queueUpgradeCost.js';

// 技能升级成本覆盖表（abilityUpgradeCosts）的键契约（G1 复核，2026-09-14）。
// 背景：键曾是槽位锚定的 4 段格式 `${slot}|${hrid}|${from}|${to}`，改成技能锚定的 3 段格式
// `${hrid}|${from}|${to}` 时函数名没变、参数个数从 4 变 3。JS 没有类型检查，漏改的调用点不会报错，
// 只会静默生成永远查不到的键 ⇒ 用户手填的覆盖被无声丢弃、回落自动算值（正是本次改动要消灭的静默降级）。
// 本文件用 acorn 静态巡检全仓（src/ + scripts/），把「漏改」变成 CI 红灯：
//   1) 直接调用 / 成员调用（queueUpgradeCost.getAbilityUpgradeCostKey(...)）都必须恰好 3 个实参
//      （`...spread` 也计入实参个数：动态实参绕不过契约，想这样用就得先改本文件）；
//   2) 函数定义必须保持 3 个形参（改签名必须同步改本文件 ⇒ 本文件同时是键格式的版本标记）；
//   3) 导入不得改名、解构不得改名（改名会让巡检静默失去覆盖面）；.vue 只解析 <script> 块（其中行号
//      相对脚本块起始），解析不了的文件若出现该标识符就显式失败，绝不静默跳过；
//   4) 键格式钉死为 `${hrid}|${from}|${to}`，并锁定运行期护栏的行为（非法入参必须抛错）——护栏一旦被
//      弱化或删除，本文件立刻转红。
// 运行期配套护栏：queueUpgradeCost.getAbilityUpgradeCostKey 内的 import.meta.env.DEV 参数形状断言
// （本文件防「写错了但没跑到测试」，那边防「写错了且只在运行期遇到」；第 4 条里的旧 4 参写法刻意用
// `.call` 复现，否则会被第 1 条静态断言记成违规）。
const ABILITY_COST_KEY_NAME = 'getAbilityUpgradeCostKey';
const SCAN_DIRECTORIES = ['src', 'scripts'];
const SCANNABLE_FILE_PATTERN = /\.(js|mjs|vue)$/;
const SCRIPT_BLOCK_PATTERN = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
// 扫描文件数下界：防止目录结构变化后扫描器静默空转（当前 src/ + scripts/ 约 409 个可扫描文件，且实测全部可解析）。
const MIN_SCANNED_FILE_COUNT = 300;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function toRepoPath(filePath) {
  return path.relative(REPO_ROOT, filePath).split(path.sep).join('/');
}

function collectScannableFiles(directory) {
  const collected = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collected.push(...collectScannableFiles(entryPath));
    } else if (SCANNABLE_FILE_PATTERN.test(entry.name)) {
      collected.push(entryPath);
    }
  }
  return collected;
}

function walkAst(node, parentNode, visit) {
  if (!node || typeof node !== 'object') {
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      walkAst(child, parentNode, visit);
    }
    return;
  }
  if (typeof node.type === 'string') {
    visit(node, parentNode);
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
      continue;
    }
    if (value && typeof value === 'object') {
      walkAst(value, node, visit);
    }
  }
}

// 取被调用方的名字：直接调用、成员调用（obj.getAbilityUpgradeCostKey(...)）以及可选链包装都归一化。
function resolveCalleeName(callee) {
  const target = callee?.type === 'ChainExpression' ? callee.expression : callee;
  if (target?.type === 'Identifier') {
    return String(target.name || '');
  }
  if (target?.type === 'MemberExpression' && target.property?.type === 'Identifier') {
    return String(target.property.name || '');
  }
  return '';
}

function parseModuleSource(source) {
  try {
    return parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, locations: true });
  } catch (error) {
    return null;
  }
}

// 从单个文件源码收集键函数的全部引用点（调用点 / 定义 / 改名引用）。抽成纯函数是为了让下面那条
// 「检查器自检」用例能直接喂合成源码，证明它确实抓得住旧的 4 参写法。
function collectKeyReferences(relativePath, source) {
  const isVueSingleFileComponent = relativePath.endsWith('.vue');
  const blocks = isVueSingleFileComponent
    ? [...source.matchAll(SCRIPT_BLOCK_PATTERN)].map((match) => match[1])
    : [source];
  const asts = blocks.map((block) => parseModuleSource(block));
  const result = {
    file: relativePath,
    callSites: [],
    definitions: [],
    renamedReferences: [],
    unparsedMention: false,
    templateMention: false,
  };

  if (asts.some((ast) => ast == null)) {
    // 解析失败的源码（罕见语法 / 非 JS 内容）：只有在文件里出现该标识符时才失败，避免把无关的新语法转成红灯。
    result.unparsedMention = source.includes(ABILITY_COST_KEY_NAME);
    return result;
  }

  if (isVueSingleFileComponent && source.replace(SCRIPT_BLOCK_PATTERN, '').includes(ABILITY_COST_KEY_NAME)) {
    // 模板表达式不在本巡检的解析范围内：一旦有人在模板里调用它，必须显式扩展本文件而不是留一个盲区。
    result.templateMention = true;
  }

  for (const ast of asts) {
    walkAst(ast, null, (node, parentNode) => {
      if (node.type === 'CallExpression' && resolveCalleeName(node.callee) === ABILITY_COST_KEY_NAME) {
        result.callSites.push({ file: relativePath, line: node.loc.start.line, argumentCount: node.arguments.length });
        return;
      }
      if (node.type === 'FunctionDeclaration' && node.id?.name === ABILITY_COST_KEY_NAME) {
        result.definitions.push({ file: relativePath, line: node.loc.start.line, parameterCount: node.params.length });
        return;
      }
      if (node.type === 'ImportSpecifier' && node.imported?.name === ABILITY_COST_KEY_NAME) {
        if (node.local?.name !== ABILITY_COST_KEY_NAME) {
          result.renamedReferences.push({
            file: relativePath,
            line: node.loc.start.line,
            name: String(node.local?.name || ''),
          });
        }
        return;
      }
      if (node.type === 'ExportSpecifier' && node.local?.name === ABILITY_COST_KEY_NAME) {
        if (node.exported?.name !== ABILITY_COST_KEY_NAME) {
          result.renamedReferences.push({
            file: relativePath,
            line: node.loc.start.line,
            name: String(node.exported?.name || ''),
          });
        }
        return;
      }
      // 解构改名：`const { getAbilityUpgradeCostKey: alias } = mod`（ObjectPattern 里才可能改名，对象字面量不算）。
      if (
        node.type === 'Property' &&
        parentNode?.type === 'ObjectPattern' &&
        node.key?.name === ABILITY_COST_KEY_NAME
      ) {
        if (!node.shorthand && node.value?.type === 'Identifier' && node.value.name !== ABILITY_COST_KEY_NAME) {
          result.renamedReferences.push({
            file: relativePath,
            line: node.loc.start.line,
            name: String(node.value.name),
          });
        }
      }
    });
  }

  return result;
}

const scanFiles = SCAN_DIRECTORIES.flatMap((directory) => collectScannableFiles(path.join(REPO_ROOT, directory)));
const scanResults = scanFiles.map((filePath) =>
  collectKeyReferences(toRepoPath(filePath), readFileSync(filePath, 'utf8')),
);
const callSites = scanResults.flatMap((result) => result.callSites);
const definitions = scanResults.flatMap((result) => result.definitions);
const renamedReferences = scanResults.flatMap((result) => result.renamedReferences);
const unparsedMentions = scanResults.filter((result) => result.unparsedMention).map((result) => result.file);
const templateMentions = scanResults.filter((result) => result.templateMention).map((result) => result.file);

function describeCallSites(entries) {
  return entries.map((entry) => `${entry.file}:${entry.line} → ${entry.argumentCount} 个实参`);
}

describe('技能升级成本键契约（abilityUpgradeCosts）', () => {
  it('按「技能 hrid + 等级区间」成键、不含槽位（旧 4 段键与新键永不相等 ⇒ 残留即死键）', () => {
    expect(getAbilityUpgradeCostKey('/abilities/test_dummy', 1, 4)).toBe('/abilities/test_dummy|1|4');
  });

  it('函数定义保持 3 个形参（改签名必须同步修改本契约）', () => {
    expect(definitions.map((entry) => `${entry.file}(${entry.parameterCount})`)).toEqual([
      'src/services/queueUpgradeCost.js(3)',
    ]);
  });

  it('全仓调用点恰好传 3 个实参（src/ + scripts/）', () => {
    expect(describeCallSites(callSites.filter((entry) => entry.argumentCount !== 3))).toEqual([]);
  });

  it('导入 / 解构不得改名（改名会绕过本巡检的覆盖面）', () => {
    expect(renamedReferences.map((entry) => `${entry.file}:${entry.line} → ${entry.name}`)).toEqual([]);
  });

  it('检查器自检：旧 4 参写法（slot 在前）一定会被判定为违规', () => {
    const legacySource = [
      `import { getAbilityUpgradeCostKey } from '../queueUpgradeCost.js';`,
      `const legacyKey = getAbilityUpgradeCostKey(0, '/abilities/cleave', 1, 4);`,
      `const renamedKey = getAbilityUpgradeCostKey(0, '/abilities/cleave', 1, 4);`,
    ].join('\n');
    const collected = collectKeyReferences('synthetic/legacy.js', legacySource);
    expect(describeCallSites(collected.callSites)).toEqual([
      'synthetic/legacy.js:2 → 4 个实参',
      'synthetic/legacy.js:3 → 4 个实参',
    ]);
  });

  it('开发期护栏：旧 4 参写法与所有「不可能命中」的入参一律立即 throw', () => {
    // 旧 4 参写法（slot 在前）必须用 .call 复现：直接写成 4 实参调用会被本文件第 1 条静态断言（调用点
    // 必须 3 实参）记成违规（这正是那条断言在起作用），把运行期形状与静态实参个数两条闸门分开测。
    expect(() => getAbilityUpgradeCostKey.call(null, 0, '/abilities/cleave', 1, 4)).toThrow(/参数形状非法/);
    // 以下都是 3 实参、但取值会产出「永远没被写入过的键」的入参。每条都独立对应护栏里的一个判据
    // （逐个删掉任一判据，都会有对应用例从「抛错」变成「返回键」），本文件因此同时锁住护栏本身：
    expect(() => getAbilityUpgradeCostKey(2, 1, 4)).toThrow(/参数形状非法/);
    expect(() => getAbilityUpgradeCostKey('', 1, 4)).toThrow(/参数形状非法/);
    expect(() => getAbilityUpgradeCostKey('/abilities/cleave|1', 2, 4)).toThrow(/参数形状非法/);
    expect(() => getAbilityUpgradeCostKey('/abilities/cleave', 0, 4)).toThrow(/参数形状非法/);
    expect(() => getAbilityUpgradeCostKey('/abilities/cleave', 1.5, 4)).toThrow(/参数形状非法/);
    expect(() => getAbilityUpgradeCostKey('/abilities/cleave', 1, 1.5)).toThrow(/参数形状非法/);
    // to ≤ from 不是升级区间：两个消费方都在成键前提前返回，from/to 写反的调用点必须在此响出来。
    expect(() => getAbilityUpgradeCostKey('/abilities/cleave', 4, 4)).toThrow(/参数形状非法/);
    expect(() => getAbilityUpgradeCostKey('/abilities/cleave', 5, 4)).toThrow(/参数形状非法/);
  });

  it('巡检确实扫到文件与已知调用点，且没有解析失败被吞掉的盲区', () => {
    expect(scanFiles.length).toBeGreaterThanOrEqual(MIN_SCANNED_FILE_COUNT);
    // 生产调用点两处（queueUpgradeCost.computeQueueItemUpgradeCost / simulatorPricingActions）＋测试内若干。
    expect(callSites.length).toBeGreaterThanOrEqual(2);
    expect(unparsedMentions).toEqual([]);
    expect(templateMentions).toEqual([]);
  });
});

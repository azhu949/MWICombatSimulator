const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const distDir = path.resolve(process.cwd(), 'dist');
const errors = [];

function assertCondition(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

assertCondition(fileExists(distDir), 'Missing dist directory. Run `npm run build` first.');

if (!fileExists(distDir)) {
  errors.forEach((message) => console.error(`[verify-pages-build] ${message}`));
  process.exit(1);
}

const indexHtmlPath = path.join(distDir, 'index.html');
assertCondition(fileExists(indexHtmlPath), 'Missing dist/index.html.');

if (fileExists(indexHtmlPath)) {
  const indexHtml = readText(indexHtmlPath);
  assertCondition(
    indexHtml.includes('src="./assets/'),
    'index.html should reference scripts with relative ./assets/ path.',
  );
  assertCondition(
    indexHtml.includes('href="./assets/'),
    'index.html should reference styles/preloads with relative ./assets/ path.',
  );
}

const assetsDir = path.join(distDir, 'assets');
assertCondition(fileExists(assetsDir), 'Missing dist/assets directory.');

// wasm 引擎产物必须进部署产物（public/engine/pkg 随仓库提交，
// vite 构建时拷贝）；缺失意味着线上永远回退 JS 引擎。
const enginePkgDir = path.join(distDir, 'engine', 'pkg');
assertCondition(
  fileExists(path.join(enginePkgDir, 'mwi_combat_engine.js')),
  'Missing dist/engine/pkg/mwi_combat_engine.js (run npm run build:wasm and commit public/engine/pkg).',
);
assertCondition(
  fileExists(path.join(enginePkgDir, 'mwi_combat_engine_bg.wasm')),
  'Missing dist/engine/pkg/mwi_combat_engine_bg.wasm (run npm run build:wasm and commit public/engine/pkg).',
);

// 主站导入脚本随站点分发（国内无法访问 GreasyFork，这是唯一的可用安装入口）：
// 产物缺失或版本与源文件不一致，都意味着线上「安装脚本」按钮会 404 或装到旧版。
const userscriptPath = path.join(distDir, 'userscript', 'mwi-main-site-import.user.js');
const userscriptMetaPath = path.join(distDir, 'userscript', 'mwi-main-site-import.meta.json');
assertCondition(
  fileExists(userscriptPath),
  'Missing dist/userscript/mwi-main-site-import.user.js (run `npm run build`; dev/build sync it from scripts/).',
);
assertCondition(
  fileExists(userscriptMetaPath),
  'Missing dist/userscript/mwi-main-site-import.meta.json (run `npm run build`).',
);

if (fileExists(userscriptPath) && fileExists(userscriptMetaPath)) {
  const userscriptSourcePath = path.resolve(process.cwd(), 'scripts', 'mwi-main-site-import.user.js');
  const sourceScript = readText(userscriptSourcePath);
  const deployedScript = readText(userscriptPath);
  assertCondition(
    deployedScript === sourceScript,
    'dist/userscript copy differs from scripts/mwi-main-site-import.user.js — the site would serve a stale script.',
  );

  // 校验值在这里独立复算（不采信生成方写下的数字）：meta 自述的哈希与实际分发字节不符，
  // 说明分发链上脚本与元数据已不自洽，用户拿该值核对下载到的脚本必然失败。
  const sourceSha256 = crypto.createHash('sha256').update(fs.readFileSync(userscriptSourcePath)).digest('hex');
  const deployedSha256 = crypto.createHash('sha256').update(fs.readFileSync(userscriptPath)).digest('hex');
  assertCondition(
    deployedSha256 === sourceSha256,
    'dist/userscript copy checksum differs from scripts/mwi-main-site-import.user.js.',
  );

  const sourceVersion = sourceScript.match(/^\/\/\s*@version\s+(\S+)/m)?.[1] || '';
  let metaVersion = '';
  let metaSha256 = '';
  try {
    const meta = JSON.parse(readText(userscriptMetaPath));
    metaVersion = String(meta.version || '');
    metaSha256 = String(meta.sha256 || '').toLowerCase();
  } catch (error) {
    errors.push(`dist/userscript meta JSON is not parsable: ${error.message}`);
  }
  assertCondition(
    Boolean(sourceVersion) && metaVersion === sourceVersion,
    `dist/userscript meta version (${metaVersion || 'empty'}) does not match script @version (${sourceVersion || 'empty'}).`,
  );
  assertCondition(
    Boolean(metaSha256) && metaSha256 === deployedSha256,
    `dist/userscript meta checksum (${metaSha256 || 'empty'}) does not match the deployed script checksum.`,
  );
}

let mainBundlePath = '';
let workerBundleName = '';
let multiWorkerBundleName = '';

if (fileExists(assetsDir)) {
  const assetFileNames = fs.readdirSync(assetsDir);
  const mainBundleName = assetFileNames.find((name) => /^(main|index)-.*\.js$/.test(name));
  workerBundleName = assetFileNames.find((name) => /^worker-.*\.js$/.test(name)) || '';
  multiWorkerBundleName = assetFileNames.find((name) => /^multiWorker-.*\.js$/.test(name)) || '';

  assertCondition(Boolean(mainBundleName), 'Missing main JS bundle in dist/assets.');
  assertCondition(Boolean(workerBundleName), 'Missing worker JS bundle in dist/assets.');
  assertCondition(Boolean(multiWorkerBundleName), 'Missing multiWorker JS bundle in dist/assets.');

  if (mainBundleName) {
    mainBundlePath = path.join(assetsDir, mainBundleName);
  }
}

if (mainBundlePath && fileExists(mainBundlePath)) {
  const mainBundleContent = readText(mainBundlePath);

  if (workerBundleName) {
    assertCondition(
      mainBundleContent.includes(workerBundleName),
      `Main bundle does not reference worker bundle (${workerBundleName}).`,
    );
  }

  if (multiWorkerBundleName) {
    assertCondition(
      mainBundleContent.includes(multiWorkerBundleName),
      `Main bundle does not reference multiWorker bundle (${multiWorkerBundleName}).`,
    );
  }
}

if (errors.length > 0) {
  errors.forEach((message) => console.error(`[verify-pages-build] ${message}`));
  process.exit(1);
}

console.log('[verify-pages-build] All checks passed.');

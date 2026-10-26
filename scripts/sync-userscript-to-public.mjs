// 把主站导入脚本同步到站点自身目录，让国内用户也能安装：
// GreasyFork 在国内访问不稳定，而「能打开模拟器」的用户一定能打开站点资源，
// 因此脚本随站点一起分发（public/ 由 vite 接管：dev 下映射到站点根，构建时拷进 dist/）。
// node scripts/sync-userscript-to-public.mjs（由 package.json 的 dev / build / start 内联执行）
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUserscriptMetadataFromBytes } from './userscript-metadata.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(root, 'scripts', 'mwi-main-site-import.user.js');
const targetDir = resolve(root, 'public', 'userscript');
const targetPath = resolve(targetDir, 'mwi-main-site-import.user.js');
const metaPath = resolve(targetDir, 'mwi-main-site-import.meta.json');

// 原样拷贝：脚本头部注释就是安装元数据，任何改写都会破坏 @match / @grant。
// 全程按字节读写（不经过编码转换），保证「被校验的字节」就是「被分发的字节」。
const sourceBytes = readFileSync(sourcePath);
const { version, sha256 } = readUserscriptMetadataFromBytes(sourceBytes);

mkdirSync(targetDir, { recursive: true });
writeFileSync(targetPath, sourceBytes);

// 版本与校验值元数据供页面直接读取（不经构建期注入，部署后即时反映线上脚本实际版本）：
// 前者供「已安装版本 vs 站点当前版本」比对，后者供用户核对下载到的脚本与发布版本是否一致。
// 刻意不写生成时间：该文件随仓库提交，写入时间会让每次 dev/build 都产生不可复现的改动，
// 而该字段没有任何消费方。
writeFileSync(metaPath, `${JSON.stringify({ version, sha256 }, null, 2)}\n`, 'utf8');

console.log(
  `sync-userscript: v${version || '?'} sha256:${sha256.slice(0, 12)} -> public/userscript/mwi-main-site-import.user.js`,
);

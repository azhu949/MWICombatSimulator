// 主站导入脚本的发布元数据：@version + SHA-256 + @match 列表。
// 单一实现，两处消费：
//   - scripts/sync-userscript-to-public.mjs：写进站点分发的 userscript/*.meta.json；
//   - vite.config.mjs：构建期注入前端，供安装入口展示「本站脚本 vX.Y.Z · SHA-256 …」，
//     并用 @match 列表判断当前站点是否在脚本注入范围内（自定义域名/自建镜像不在范围内时，
//     侧栏不能一直报「未安装」并提供装完也不生效的入口）。
// 校验值按字节计算（与分发文件逐字节一致），不做 utf8 往返，避免编码差异让「展示的哈希」
// 与「下载到的脚本」对不上。
import { createHash } from 'node:crypto';

/**
 * 从脚本源文件内容提取发布元数据。
 * @param {Buffer|Uint8Array|string} bytes 脚本源文件内容（传 Buffer 最精确）。
 * @returns {{ version: string, sha256: string, matches: string[] }} 读不到 @version 时 version 为空串，
 *   读不到 @match 时 matches 为空数组。
 */
export function readUserscriptMetadataFromBytes(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || '');
  const text = buffer.toString('utf8');

  return {
    version: text.match(/^\/\/\s*@version\s+(\S+)/m)?.[1] || '',
    sha256: createHash('sha256').update(buffer).digest('hex'),
    matches: Array.from(text.matchAll(/^\/\/\s*@match\s+(\S+)\s*$/gm), (match) => match[1]),
  };
}

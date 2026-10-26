import { defineConfig, defaultExclude } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { readUserscriptMetadataFromBytes } from './scripts/userscript-metadata.mjs';

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));

// 主站导入脚本（scripts/mwi-main-site-import.user.js）的 @version、SHA-256 与 @match 列表：
// 构建期注入，供侧栏比对「已安装的是不是最新版」、在安装入口展示「本站脚本 vX.Y.Z · SHA-256 …」
// 供用户核对，并判断当前站点是否落在脚本注入范围内（读取方见 src/services/mainSiteImportScriptStatus.js）。
// 从脚本源码实时提取、且与 scripts/sync-userscript-to-public.mjs 共用同一实现
// （scripts/userscript-metadata.mjs），避免版本/校验值/匹配范围在多处手工维护而漂移。
// 发布顺序约束：先发布脚本（GreasyFork），再发布站点；反序会让已装最新脚本的用户
// 短暂看到「待更新」。
const mainSiteImportScriptSourcePath = resolve(process.cwd(), 'scripts', 'mwi-main-site-import.user.js');

const mainSiteImportScriptMeta = (() => {
  try {
    return readUserscriptMetadataFromBytes(readFileSync(mainSiteImportScriptSourcePath));
  } catch {
    return { version: '', sha256: '', matches: [] };
  }
})();

export default defineConfig({
  base: './',
  test: {
    // jsdom 默认地址是 http://localhost:3000/，不在导入脚本的 @match 内，而侧栏会按
    // @match 覆盖率决定是否提供安装入口（见 AppSidebar 的 importScriptUnsupported）。
    // 统一用项目 dev 端口（脚本声明的 http://localhost:5173/*），让行为测试落在
    // 「当前站点被脚本覆盖」的真实开发部署场景，而不是一个脚本永远不会注入的地址。
    environmentOptions: { jsdom: { url: 'http://localhost:5173/' } },
    // tmp/ 为 git 忽略的临时对账区；.snow/ 为研究快照区（含第三方取证仓库的测试，
    // 其 @@/ 别名在本仓库无法解析、加载即红，且 .snow/ 已被 .gitignore 忽略）。
    // 两目录的 *.test.* 文件均不参与 vitest 默认收集，避免转红污染「不回归」信号。
    exclude: [...defaultExclude, 'tmp/**', '.snow/**'],
  },
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(process.cwd(), 'src'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __MAIN_SITE_IMPORT_SCRIPT_VERSION__: JSON.stringify(mainSiteImportScriptMeta.version),
    __MAIN_SITE_IMPORT_SCRIPT_SHA256__: JSON.stringify(mainSiteImportScriptMeta.sha256),
    __MAIN_SITE_IMPORT_SCRIPT_MATCHES__: JSON.stringify(mainSiteImportScriptMeta.matches ?? []),
  },
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      input: resolve(process.cwd(), 'index.html'),
      output: {
        manualChunks(id) {
          // commonjs helpers（globalThis 垫片 / CJS interop）拆为独立小 chunk：
          // 它们被多个 chunk 共享时会被并入其中一个（实测曾落入懒加载的
          // exceljs chunk），使入口对 exceljs 产生静态依赖并被 modulepreload
          //（首屏 +271KB gzip）。独立拆分后入口只依赖数百字节的 cjsHelpers。
          if (id.includes('commonjsHelpers')) {
            return 'cjsHelpers';
          }

          if (id.includes('exceljs')) {
            return 'exceljs';
          }

          if (
            id.includes('/src/shared/gameDataIndex.generated.json') ||
            id.includes('\\src\\shared\\gameDataIndex.generated.json')
          ) {
            return 'gameData';
          }

          if (id.includes('/src/shared/gameDataIndex.js') || id.includes('\\src\\shared\\gameDataIndex.js')) {
            return 'gameData';
          }

          if (id.includes('/src/services/playerMapper.js') || id.includes('\\src\\services\\playerMapper.js')) {
            return 'playerMapper';
          }

          if (
            id.includes('/src/combatsimulator/abilityDefinitionResolver') ||
            id.includes('\\src\\combatsimulator\\abilityDefinitionResolver')
          ) {
            return 'playerMapper';
          }

          return undefined;
        },
      },
    },
  },
});

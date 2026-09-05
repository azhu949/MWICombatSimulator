import { defineConfig, defaultExclude } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));

export default defineConfig({
  base: './',
  test: {
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
  },
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      input: resolve(process.cwd(), 'index.html'),
      output: {
        manualChunks(id) {
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

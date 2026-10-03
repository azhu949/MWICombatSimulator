# 构建分包与首屏构成留档

> 本文档记录 Vite 生产构建的 chunk 落点事实、复核方式与资产分轻层/重链拆分的口径边界，
> 防止「重链下沉」被误读为「数据表下沉」。事实锚点截至 2026-10-03 的构建产物
> （`npm run build` 输出 `dist/` 与构建报告 `tmp/chunk-report-full.json`；报告尺寸均为未压缩字节）。

同一批分层改动的原始评估记录见备忘条目 memo 0364491150360494080（资产分分层注释与实际 chunk 落点口径偏差）。

## 1. 首屏构成（2026-10-03 实况）

`dist/index.html` 的入口与预加载关系：

- 入口脚本：`./assets/index-<hash>.js`（index chunk，报告 size 1000507，221 个模块）
- `modulepreload`：`./assets/gameData-<hash>.js`（运行时游戏数据索引，报告 size 1988397）与
  `./assets/playerMapper-<hash>.js`（玩家映射 + combatsimulator 战斗模块，报告 size 2307266）

即首屏必须加载 index + gameData + playerMapper 三个 chunk（modulepreload 是 Vite 为入口 chunk
的静态依赖生成的预加载提示；index chunk 内对 playerMapper 的引用为静态
`import ... from './playerMapper-<hash>.js'`，浏览器解析入口模块图时必然加载）。

### 1.1 房屋原始表位于 playerMapper chunk（随首屏加载）

`src/combatsimulator/data/houseRoomDetailMap.json` 归属 playerMapper chunk：报告 rendered 90436 /
original 172150 字节，17 间房，含 `usableInActionTypeMap / actionBuffs / globalBuffs` 等字段。

该状态**早于 2026-10-03 的资产分轻层/重链拆分即存在**：对照变更前报告
`tmp/chunk-report.pre-three-piece.json`，当时 `assetScoreService.js`、`importExportMapper.js`、
`enhancementSimulator.js`、`patchNote.json` 都在 index chunk，而 `houseRoomDetailMap.json` 与
`houseRoom.js` 已在 playerMapper chunk。成因是 combatsimulator 战斗模块与 playerMapper chunk 的
静态可达关系（`houseRoom.js` 静态 import 该表，`player.js` 再被 `services/playerMapper.js` 等静态
引用），不取决于资产分轻层。

### 1.2 与既有文档的旧口径差异

`docs/wasm-engine-performance.md` §22 开头（切片 21-22 时期，2026-09-30）记载「playerMapper
208KB gzip，首屏已按需懒加载」；按当前产物，playerMapper chunk 是 index chunk 的静态依赖且被
`modulepreload`（首屏加载），该旧描述与现状不一致。以本文档锚点为准，旧段落保留仅作沿革，不追改。

## 2. 资产分拆分实测落点（2026-10-03）

| 模块                                             | chunk                             | 是否首屏   | 报告尺寸（字节）    |
| ------------------------------------------------ | --------------------------------- | ---------- | ------------------- |
| `src/services/assetScorePresentation.js`（轻层） | index chunk                       | 是         | 模块 rendered 13521 |
| `src/services/assetScoreService.js`（重计算链）  | `assetScoreService` 独立 chunk    | 否（按需） | chunk size 34339    |
| `src/services/importExportMapper.js`             | `importExportMapper` 独立 chunk   | 否（按需） | chunk size 30815    |
| `src/services/enhancementSimulator.js`           | `enhancementSimulator` 独立 chunk | 否（按需） | chunk size 33981    |
| `patchNote.json`                                 | `patchNote` 独立 chunk            | 否（按需） | chunk size 47884    |

「重链不再进入首屏 index chunk」成立；同时注意房屋原始表不在上述任一按需 chunk 内——
`assetScoreService` chunk 对房屋表零引用（运行时共享 playerMapper chunk 的同一模块，表仍随首屏
加载）。其它页面级按需 chunk 例：`HomePage`、`AdvisorPage`、`QueuePage`、`MultiResultsPage`、
`SettingsPage`、`exceljs`、`translation.official.generated` 等。

### 2.1 口径边界

- 「重链下沉」= `assetScoreService` 重计算链（强化模拟器成本法 + 商店/制作取价 + 成本缓存）改按需
  加载，**不含数据表下沉**。
- 轻层 `assetScorePresentation.js` 对 `houseRoomDetailMap.json` 的静态引用用于战斗房间判定
  （`isCombatHouseRoomDetail`，配置签名与 `computePlayerAssetScore` 共用同一谓词）；因表已在首屏
  chunk，该引用不新增下载量，也不改变表的落点。
- 若目标是把房屋原始表移出首屏：方向一为消解 `combatsimulator/player.js` → `houseRoom.js` 的首屏
  静态可达；方向二为让战斗房间判定改读精简索引，但需先为 `houseRoomDetailIndex` 补
  `usableInActionTypeMap` 字段（生成脚本 `scripts/build-game-data-index.mjs` 的
  `createHouseRoomIndex`）。两者均需独立立项与收益量化（房屋表 rendered 90436 字节，相对
  playerMapper chunk 的 2307266 字节占比约 4%）。

## 3. 复核方式

1. 生成构建报告（会执行一次 vite 构建，输出到 `tmp/analyze-dist`，不覆盖 `dist/`）：

   ```bash
   node tmp/analyze-build.mjs
   ```

   结果写入 `tmp/chunk-report-full.json`（每个 chunk 的 size / moduleCount / 模块级 rendered +
   original 列表）。按定位特征查找（行号随构建漂移，不以行号为锚）：
   - playerMapper chunk 条目下应有 `src/combatsimulator/data/houseRoomDetailMap.json`
     （rendered 90436 / original 172150）与 `src/combatsimulator/houseRoom.js`
   - index chunk 条目下应有 `src/services/assetScorePresentation.js`
   - 独立 chunk 条目：`assetScoreService`、`importExportMapper`、`enhancementSimulator`、`patchNote`
   - 只查关键模块归属可直接运行 `node tmp/inspect-asset-chunks.mjs`

2. 核查 `dist/index.html`：`modulepreload` 应恰为 `gameData-<hash>.js` 与 `playerMapper-<hash>.js`
   两项（配合入口 `index-<hash>.js`）。

3. 核查 `dist/assets/index-<hash>.js` 的依赖形态：对 playerMapper 为静态
   `import ... from './playerMapper-...'`；对 `assetScoreService` / `importExportMapper` /
   `patchNote` 为动态 `import(...)`。

## 4. 留档要求

- 任何影响分包配置（`vite.config.mjs` 的 `manualChunks`）或大型数据表归属的变更，完成后应重跑
  第 3 节并更新本文档的构成与清单。
- 分层注释（`src/services/assetScorePresentation.js`、`src/services/assetScoreService.js`）与本文档
  口径保持一致；出现分歧时以产物实测为准，并同步双方。

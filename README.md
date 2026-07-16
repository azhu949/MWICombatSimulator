# MWICombatSimulator

一个用于 **Milky Way Idle** 的非官方战斗模拟器、刷图推荐器与生活技能规划工具（纯前端，Vue 3 + Vite + Tailwind）。

## 项目简介

MWICombatSimulator 用于在本地运行战斗模拟与收益评估，帮助你对比配装、技能、触发器与战斗目标的收益与稳定性。

> 与游戏数据相关的来源说明、免责声明以及数据刷新流程，统一收录在 [`docs/game-data.md`](docs/game-data.md)。

## 主要功能

- **Home**：配置角色/目标/难度/时长并运行模拟，查看关键指标与构建快照
- **Queue**：基于“基线 + 多个变体”的多轮评分与排名，对比收益增量与波动
- **Advisor**：刷图推荐器，批量扫描 Solo/Group Zones 与 Labyrinth，输出目标排行
- **Enhancement**：比较不同保护阈值的期望成本，评估贤者之镜、分解价值、成本分位与预算成功率
- **Skilling**：结合当前角色经验、背包/穿戴装备、Buff 与市场价格，按最低净成本/经验、均衡（可配置成本容忍度，以有限增加净成本换取更短耗时）或速度优先模式规划采摘、酿造、奶酪锻造、烹饪、制作和裁缝的逐级路线
- **Multi Results**：汇总多轮结果并支持导出 Excel
- **Import/Export**：支持导入导出；可配合 Tampermonkey 脚本从主站一键导入战斗、强化或生活技能所需的当前角色数据，支持 `milkywayidle.com` 与 `milkywayidlecn.com`；强化与生活技能导入的当前角色数据仅保留在当前页面会话，刷新后需重新导入
- **官方中英游戏词条 + Web Workers**：发布前同步官网词条快照，运行时离线加载；worker 并行计算提升批量模拟速度
- **Parallel Worker Limit**：Settings 中保存的并行 worker 上限也会应用到 Home 页的批量 Zone / Labyrinth 模拟

## 在线地址 / 部署地址

- Cloudflare Pages（全球地址）：`https://mwi-combatsi-mulator.pages.dev/`
- GitHub Pages：`https://azhu949.github.io/MWICombatSimulator/`

> 安装 Tampermonkey「主站一键导入」脚本后，在主站侧边栏点击 `战斗模拟器 / Combat Simulator` 会弹窗选择上述镜像地址。

## 快速开始（本地开发）

安装依赖：

```bash
npm install
```

启动开发环境（Vite）：

```bash
npm run dev
```

生产构建：

```bash
npm run build
```

本地预览构建产物：

```bash
npm run preview
```

运行测试：

```bash
npm test
```

## 常用文档

- [`docs/game-data.md`](docs/game-data.md)：游戏数据与官方中英文词条来源、同步/发布流程、使用免责声明，以及刷新当前维护数据的方法
- [`docs/init-client-data-key-reference.md`](docs/init-client-data-key-reference.md)：`initClientData` 当前 48 个顶层 key 的作用、接入状态和导出情况对照表
- [`scripts/mwi-main-site-import.README.md`](scripts/mwi-main-site-import.README.md)：Tampermonkey「主站一键导入」脚本说明

## Fork 来源

本项目 fork 自 [shykai/MWICombatSimulatorTest](https://github.com/shykai/MWICombatSimulatorTest)。

## 开源协议

本项目以 MIT License 开源，详见 [LICENSE](LICENSE)。

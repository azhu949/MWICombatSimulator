# MWICombatSimulator

一个用于 **Milky Way Idle** 的非官方战斗模拟器 / 刷图推荐器（纯前端，Vue 3 + Vite + Tailwind）。

## 项目简介

MWICombatSimulator 用于在本地运行战斗模拟与收益评估，帮助你对比配装、技能、触发器与战斗目标的收益与稳定性。

> 与游戏数据相关的来源说明、免责声明以及数据刷新流程，统一收录在 [`docs/game-data.md`](docs/game-data.md)。

## 主要功能

- **Home**：配置角色/目标/难度/时长并运行模拟，查看关键指标与构建快照
- **Queue**：基于“基线 + 多个变体”的多轮评分与排名，对比收益增量与波动
- **Advisor**：刷图推荐器，批量扫描 Solo/Group Zones 与 Labyrinth，输出目标排行
- **Multi Results**：汇总多轮结果并支持导出 Excel
- **Import/Export**：支持导入导出；可配合 Tampermonkey 脚本从主站一键导入当前角色
- **i18n + Web Workers**：中英界面，worker 并行计算提升批量模拟速度

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

- [`docs/game-data.md`](docs/game-data.md)：游戏数据来源、数据使用免责声明、以及刷新 6 个模拟器 map 文件的流程
- [`scripts/mwi-main-site-import.README.md`](scripts/mwi-main-site-import.README.md)：Tampermonkey「主站一键导入」脚本说明

## Fork 来源

本项目 fork 自 [shykai/MWICombatSimulatorTest](https://github.com/shykai/MWICombatSimulatorTest)。

## 开源协议

本项目以 MIT License 开源，详见 [LICENSE](LICENSE)。

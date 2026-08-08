# MWI Combat Simulator 2.0.0 更新说明

发布日期：2026-08-08

## 版本概述

2.0.0 完成了模拟器全站 UI 的升级重构。新界面以高密度战斗数据工作台为方向，使用 shadcn-vue、Reka UI 与 Tailwind CSS 4 统一交互和视觉，同时保留原有深色琥珀品牌、业务流程与数据兼容性。

## 主要更新

### 应用框架

- 新增响应式应用侧栏，按模拟、专项工具和支持分组保留原有导航顺序。
- 桌面端支持折叠图标栏，移动端使用抽屉导航。
- 将玩家切换、基线、队列和运行操作整合为上下文战斗命令栏。
- 将 GitHub、反馈、更新日志和版本信息集中到侧栏。

### 页面与组件

- 重构 Home 与 Simulation Results，统一表单层级、结果指标、粘性摘要、空状态和长表格行为。
- 统一 Queue、Multi Results 与 Advisor 的排名、进度、状态徽章和横向滚动。
- 保留 Enhancement 与 Skilling 的桌面双栏工作区和现有计算逻辑，移动端改为单列布局。
- Settings 改为分组标签页，Guide 改用统一排版、手风琴和图片查看弹窗。
- 大型游戏数据列表使用有结果上限的搜索 Combobox，短枚举使用 Reka Select，复杂原生分组列表继续使用 Native Select。
- `BaseModal` 与 `DisclosurePanel` 分别迁移到 Reka Dialog 与 Collapsible，并保持原有属性和事件兼容。

### 主题与可访问性

- 新增基于 OKLCH 语义令牌的亮暗双主题，深色仍为默认，并保留 `mwi.ui.theme.v1` 存储键。
- 统一最大 8px 圆角、紧凑控件、语义状态色和清晰的键盘焦点环。
- 完善弹窗焦点闭环、移动菜单、搜索选择器、禁用状态和长内容溢出处理。
- Chakra Petch 与 IBM Plex Sans 改为 Fontsource 自托管，不再请求 Google Fonts。

### 主站导入脚本

- 动态注入的导入按钮适配新版共享工具按钮样式。
- 状态反馈改用主题语义色，支持亮暗主题下的一致层级。
- Tampermonkey userscript 独立版本升级为 `0.1.30`，已安装脚本需要单独更新。

## 兼容范围

以下接口和业务行为在 2.0.0 中保持不变：

- 路由路径、路由名称、Hash History 和 `showCombatToolbar` 行为。
- Pinia store API、worker 消息和模拟数据结构。
- 玩家、队列、强化与生活技能的导入导出格式。
- Chart.js 图表计算、游戏物品 SVG 精灵和路由懒加载边界。
- 现有中英文业务文案、翻译键和游戏计算逻辑。

现有本地配置和导入数据不需要迁移。2.0.0 的主版本号表示界面与组件体系的重大升级，不表示业务数据格式发生破坏性变化。

## 发布验收

发布前执行以下检查：

```bash
npm test
npm run build
npm run verify-pages-build
```

验收结果：

- `npm test`：64 个测试文件、588 项测试全部通过。
- `npm run build`：Vite 生产构建通过，主 CSS 为 67.47 kB（gzip 12.26 kB），主入口 JS 为 1,281.39 kB（gzip 419.13 kB）。
- `npm run verify-pages-build`：GitHub Pages 构建结构与资源引用校验全部通过。
- 构建命令读取到的模拟器版本为 `2.0.0`。

详细迁移阶段、组件矩阵和浏览器验收记录见 [`ui-shadcn-migration.md`](ui-shadcn-migration.md)。

## 已知事项

- 生产构建仍会提示模拟数据、worker 与 ExcelJS 分块较大。这是既有的数据加载边界，不属于本次 UI 版本的回归。
- GreasyFork 上的主站导入脚本需要单独发布 `0.1.30`，仓库中的模拟器版本升级不会自动更新用户已安装的脚本。

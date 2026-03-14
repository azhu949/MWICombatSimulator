# MWI Combat Simulator 主站一键导入脚本

`scripts/mwi-main-site-import.user.js` 是一个单文件 Tampermonkey userscript，用来通过 **单个导入按钮** 把 **Milky Way Idle 主站当前角色或当前队伍** 一键导入到 **MWI Combat Simulator**。

## 脚本定位

这个脚本只做两件事：

- 在模拟器首页操作区注入一个 `从主站导入` 按钮
- 从已打开的主站标签页自动判断当前是单人还是队伍导入，并把 shareable profile 交给模拟器完成导入

它不会直接调用游戏 HTTP API，也不会向主站发送写请求。

## 主要功能

- 单按钮自动导入：有可识别队伍时导入到模拟器 `Player 1..N` 槽位（最多 5），否则导入当前激活玩家槽位
- 在主站侧边菜单里于 `新闻 / News` 上方注入 `战斗模拟器 / Combat Simulator` 快捷入口（点击弹窗选择 Cloudflare / GitHub Pages）
- 自动导入玩家配置：`levels`、`equipment`、`food`、`drinks`、`abilities`、`triggerMap`、`houseRooms`、`achievements`
- 如果主站当前角色正在战斗，还会同步当前战斗区域 / 地下城与难度
- 同时支持线上模拟器和本地开发环境
- 全流程在浏览器内完成，不依赖后端中转

## 支持页面

### 主站

- `https://www.milkywayidle.com/*`
- `https://milkywayidle.com/*`

### 模拟器

- `https://mwi-combatsi-mulator.pages.dev/*`
- `https://azhu949.github.io/MWICombatSimulator/*`
- `http://localhost:5173/*`
- `http://127.0.0.1:5173/*`

## 使用方式

1. 在 Tampermonkey 中安装 `scripts/mwi-main-site-import.user.js`，或直接打开发布页安装：`https://greasyfork.org/zh-CN/scripts/568613-mwi-combat-simulator-%E4%B8%BB%E7%AB%99%E4%B8%80%E9%94%AE%E5%AF%BC%E5%85%A5`
2. 打开并登录至少一个 Milky Way Idle 主站标签页
3. 打开模拟器首页 `Home`
4. 在操作区点击 `从主站导入`（英文界面显示 `Import from Main Site`）
5. 等待按钮旁状态提示显示导入结果

导入成功后：

- 若当前不在可识别队伍中，会写入 **当前激活玩家槽位**
- 若当前在可识别队伍中，会按顺序写入 `Player 1..N` 槽位（最多 5）

## 导入内容

当前版本会导入以下内容：

- 角色等级
- 装备与强化
- 食物 / 饮品
- 技能与技能槽
- Trigger 规则
- House Rooms
- Achievements
- 当前战斗区域或地下城
- 当前难度

## 状态提示与常见排查

### `Timed out waiting for the main-site tab response.`

通常表示脚本没有从主站标签页拿到响应，请优先检查：

- 是否至少保留了一个已登录的主站标签页
- userscript 是否在主站页面和模拟器页面都已启用
- 是否在安装脚本后忘记刷新原本已经打开的主站页面

### `Timed out waiting for page bridge response.`

通常表示主站数据已经拿到，但模拟器页面没有按预期回传结果，请检查：

- 当前页面是否确实是模拟器首页
- 模拟器页面脚本是否已更新到最新版本
- 页面是否还在加载或刚热更新过

### 导入后数据不完整

请先确认主站当前角色页面状态是否完整加载；如果主站刚切角色、刚登录或连接刚恢复，建议刷新主站后重试。

## 限制说明

- 单人导入支持 **当前主站角色 -> 当前激活玩家槽位**
- 队伍导入会覆盖 `Player 1..N` 槽位（最多 5）
- 队伍成员自动识别依赖主站当前队伍/战斗信息；识别不到时会直接按单人导入处理
- 不支持账号下多角色批量映射
- 必须至少保留一个已登录的主站标签页
- 脚本依赖主站现有的分享导出链路；如果主站未来改动该链路，脚本需要跟进更新

## 隐私与安全

- 不会修改主站角色数据
- 不会发起额外的游戏 API 写请求
- 只读取浏览器里当前主站页面已经能导出的角色数据
- 传输发生在本地浏览器标签页与 Tampermonkey 存储之间

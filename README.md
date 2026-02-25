# MWICombatSimulator

### 本地开发运行方式

安装依赖：

```bash
npm install
```

构建 webpack：

```bash
npm run build
```

本地启动：

```bash
npm start
```

### 游戏数据来源（重要）

模拟器核心 map 文件来源于 Milky Way Idle 的 `init_client_data` 载荷：

- `abilityDetailMap.json`
- `achievementDetailMap.json`
- `actionDetailMap.json`
- `combatMonsterDetailMap.json`
- `itemDetailMap.json`
- `openableLootDropMap.json`

### 数据使用免责声明

- 本项目仅用于学习、研究和个人技术交流用途。
- 游戏数据、名称、美术与相关知识产权归 Milky Way Idle 官方及其权利方所有。
- 使用或分发本项目数据时，请遵守 Milky Way Idle 的用户协议、服务条款及相关社区规则。
- 请勿将本项目用于作弊、自动化刷取、商业倒卖或其他违反游戏规则与法律法规的行为。
- 因使用本项目或其中数据造成的任何账号、经济或其他损失，使用者需自行承担风险与责任。


### 刷新这 6 个模拟器 map 文件

1. 在浏览器打开 Milky Way Idle 并登录。
2. 在 DevTools Console 执行：

```js
copy(localStorage.getItem("initClientData"));
```

3. 将复制内容保存到文本文件，例如：`tmp/initClientData.txt`。
4. 执行：

```bash
npm run extract-game-data -- --input tmp/initClientData.txt
```

可选：指定输出目录：

```bash
npm run extract-game-data -- --input tmp/initClientData.txt --output src/combatsimulator/data
```

导出脚本为 `scripts/extract-game-data.js`，支持：

- localStorage 中压缩的 `initClientData` 字符串
- 已解压且包含相同 map 的 init client JSON 对象

# 游戏数据与更新

本文档集中说明：

- 模拟器使用的游戏数据来源
- 数据使用免责声明
- 如何刷新模拟器依赖的 6 个核心 map 文件

## 游戏数据来源（重要）

模拟器核心 map 文件来源于 Milky Way Idle 的 `init_client_data` 载荷。

需要刷新的 6 个文件为：

- `abilityDetailMap.json`
- `achievementDetailMap.json`
- `actionDetailMap.json`
- `combatMonsterDetailMap.json`
- `itemDetailMap.json`
- `openableLootDropMap.json`

默认写入目录为：`src/combatsimulator/data`（对应导出脚本的默认输出目录）。

## 数据使用免责声明

- 本项目仅用于学习、研究和个人技术交流用途。
- 游戏数据、名称、美术与相关知识产权归 Milky Way Idle 官方及其权利方所有。
- 使用或分发本项目数据时，请遵守 Milky Way Idle 的用户协议、服务条款及相关社区规则。
- 请勿将本项目用于作弊、自动化刷取、商业倒卖或其他违反游戏规则与法律法规的行为。
- 因使用本项目或其中数据造成的任何账号、经济或其他损失，使用者需自行承担风险与责任。

## 刷新这 6 个模拟器 map 文件

### 方式 A：官方 websocket 自动拉取（推荐）

推荐优先使用官方 websocket 自动拉取（减少手工步骤），脚本会自动识别最新 `gameVersion`，并直接导出 6 个 map。

1. 在浏览器打开 Milky Way Idle 并登录。
2. 在 DevTools Console 执行，拿到 `localHash`：

```js
copy(localStorage.getItem("localHash"));
```

3. 在 Console 执行，查看角色列表并确认你要使用的 `characterId`：

```js
fetch("https://api.milkywayidle.com/v1/characters", { credentials: "include" })
  .then((r) => r.json())
  .then((list) => console.log(list.map((x) => ({ id: x.id, name: x.name }))));
```

4. 在 DevTools `Network` 中找到任意 `https://api.milkywayidle.com/v1/characters` 请求，从 `Request Headers` 复制整条 `cookie: ...` 到本地文件（例如 `tmp/api.cookie.txt`）。
5. 执行命令（默认会写入 `src/combatsimulator/data`）：

```bash
npm run extract-game-data:official -- --character-id <characterId> --hash <localHash> --cookie-file tmp/api.cookie.txt --inspect-output tmp/initClientData.decoded --save-raw tmp/initClientData.raw.json
```

说明：

- `--cookie` / `--cookie-file`：用于携带登录态；若不提供，websocket 通常会被服务端立即断开。
- `--inspect-output`：额外将 6 个 JSON 再拆分导出到指定目录（例如 `tmp/`），便于人工查看。
- `--save-raw`：保存完整 websocket `init_client_data` 原始包，便于排查。
- `--hash` 可省略（脚本会自动生成），但建议使用浏览器里现有 `localHash` 保持一致。

### 方式 B：手工导出 localStorage（备选）

如果你暂时不走 websocket，也可以继续使用手工方式：

1. 在浏览器打开 Milky Way Idle 并登录。
2. 在 DevTools Console 执行：

```js
copy(localStorage.getItem("initClientData"));
```

3. 将复制内容保存到文本文件，例如：`tmp/initClientData.txt`。
4. 执行（默认会写入 `src/combatsimulator/data`）：

```bash
npm run extract-game-data -- --input tmp/initClientData.txt
```

如果你想在更新 `src/combatsimulator/data` 的同时，把解压后的 6 个 JSON 也拆分到 `tmp` 目录里方便查看，执行：

```bash
npm run extract-game-data -- --input tmp/initClientData.txt --inspect-output tmp/initClientData.decoded
```

可选：指定输出目录：

```bash
npm run extract-game-data -- --input tmp/initClientData.txt --output src/combatsimulator/data
```

### 脚本位置

- `scripts/extract-game-data-from-official.js`：通过官方 websocket 拉取 `init_client_data` 并导出 6 个 map。
- `scripts/extract-game-data.js`：从 localStorage 复制的 `initClientData`（压缩字符串或已解压 JSON）解析并导出 6 个 map。


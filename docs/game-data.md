# 游戏数据与更新

本文档集中说明：

- 模拟器使用的游戏数据来源
- 数据使用免责声明
- 如何刷新模拟器依赖的当前全部游戏数据 JSON 文件

补充参考：

- 如需查看 `initClientData` 当前 48 个顶层 key 的作用、接入状态与导出情况，可查看 [`docs/init-client-data-key-reference.md`](./init-client-data-key-reference.md)。

## 游戏数据来源（重要）

模拟器游戏数据文件来源于 Milky Way Idle 的 `init_client_data` 载荷。

刷新范围以 `src/combatsimulator/data` 目录当前维护的 JSON 文件为准，目前包括：

- `abilityDetailMap.json`
- `abilitySlotsLevelRequirementList.json`
- `levelExperienceTable.json`
- `achievementDetailMap.json`
- `achievementTierDetailMap.json`
- `actionDetailMap.json`
- `combatMonsterDetailMap.json`
- `combatStyleDetailMap.json`
- `combatTriggerComparatorDetailMap.json`
- `combatTriggerConditionDetailMap.json`
- `combatTriggerDependencyDetailMap.json`
- `communityBuffTypeDetailMap.json`
- `damageTypeDetailMap.json`
- `enhancementLevelTotalBonusMultiplierTable.json`
- `equipmentTypeDetailMap.json`
- `houseRoomDetailMap.json`
- `itemDetailMap.json`
- `itemLocationDetailMap.json`
- `labyrinthCrateDetailMap.json`
- `openableLootDropMap.json`

如果某个已维护文件对应的 key 当前不在 `init_client_data` 载荷里，脚本会跳过该文件并输出提示，不会因为单个缺失字段而整体失败。

默认写入目录为：`src/combatsimulator/data`（对应导出脚本的默认输出目录）。

## 数据使用免责声明

- 本项目仅用于学习、研究和个人技术交流用途。
- 游戏数据、名称、美术与相关知识产权归 Milky Way Idle 官方及其权利方所有。
- 使用或分发本项目数据时，请遵守 Milky Way Idle 的用户协议、服务条款及相关社区规则。
- 请勿将本项目用于作弊、自动化刷取、商业倒卖或其他违反游戏规则与法律法规的行为。
- 因使用本项目或其中数据造成的任何账号、经济或其他损失，使用者需自行承担风险与责任。

## 刷新当前维护的全部游戏数据 JSON 文件

### 方式：浏览器控制台直接下载 localStorage 缓存

推荐直接在浏览器控制台把 `initClientData` 下载成文件，不要先 `copy(...)` 再手工粘贴到编辑器。

原因：

- `initClientData` 压缩串里可能包含特殊行分隔符字符。
- 这些字符在剪贴板或文本编辑器里可能被自动改写成普通换行，导致后续 `npm run extract-game-data -- --input ...` 解析失败。
- 直接在浏览器里生成并下载文件，能尽量避免这类中间环节改写。

1. 在浏览器打开 Milky Way Idle 并登录。
2. 在 DevTools Console 执行：

```js
(() => {
  const raw = localStorage.getItem("initClientData");
  if (!raw) {
    throw new Error("localStorage.initClientData is empty");
  }

  const blob = new Blob([raw], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "initClientData.txt";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
})();
```

3. 将浏览器下载得到的 `initClientData.txt` 放到本地仓库，例如：`tmp/initClientData.txt`。
4. 执行（默认会写入 `src/combatsimulator/data`）：

```bash
npm run extract-game-data -- --input tmp/initClientData.txt
```

如果你还想额外导出一份完整解压后的 `clientData` JSON，执行：

```bash
npm run extract-game-data -- --input tmp/initClientData.txt --all
```

默认会额外写出：

```text
tmp/initClientData.full.json
```

如果你想自己指定完整 JSON 的输出文件路径，执行：

```bash
npm run extract-game-data -- --input tmp/initClientData.txt --all --all-output tmp/initClientData.full.json
```

如果你想在更新 `src/combatsimulator/data` 的同时，把解压后的同一批 JSON 也拆分到 `tmp` 目录里方便查看，执行：

```bash
npm run extract-game-data -- --input tmp/initClientData.txt --inspect-output tmp/initClientData.decoded
```

可选：指定输出目录：

```bash
npm run extract-game-data -- --input tmp/initClientData.txt --output src/combatsimulator/data
```

如果你仍然想用复制粘贴方式，请至少确保：

- 不要经过会自动改写换行或字符编码的中间编辑器。
- 不要手动格式化、自动换行、另存为其他编码。
- 保存后不要再次打开并重新保存这个文件。

### 脚本位置

- `scripts/extract-game-data.js`：从 localStorage 复制的 `initClientData`（压缩字符串或已解压 JSON）解析并导出当前仓库维护的全部游戏数据 JSON。

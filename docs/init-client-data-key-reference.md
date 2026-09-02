# initClientData 顶层 Key 参考

> **变更注记(2026-09-02,资产分/Gear Score 变更复审)**:#8 `taskShopItemDetailMap`、#10 `shopItemDetailMap`、#28 `labyrinthShopItemDetailMap` 三个商店类 key 已随本次变更由 `scripts/extract-game-data.js` 导出至 `src/combatsimulator/data/*.json`(导出清单为目录扫描式,见 `scripts/game-data-targets.js`),并由 `src/services/assetScoreService.js`(L33-35 静态引入)经「商店兑换获取成本」渠道合并消费(三表并入 `STATIC_SHOP_ENTRY_LIST`,L217-221)。下文三键的概览状态与分析结论已同步修订,并新增状态「已导出/已接入」。此外,本变更的资产分成本法(`assetScoreService.js`)还读取多张已导出数据——直读原始表(#33 `actionDetailMap`、#45 `houseRoomDetailMap`、#47 `itemDetailMap`)或经构建索引(#43 经 `shared/guildBuffs.js` 的 `guildBuffDetailIndex`、#56 经 `shared/gameDataIndex.js`)——推翻了下文三处「未消费」断言(#43 `levelCosts.guildTokenCost`/`creditCosts`、#45 `usableInActionTypeMap`、#47 `guildCreditConversions`)并新增了若干消费方,均已逐条加注「修订(2026-09-02)」。其余结论仍以原文为准。

本文档记录 `init_client_data` 载荷中的**全部顶层 key**,并逐个评估它们对模拟器是否有用。分为两部分:

- **未导出 key(29 个,编号 1-29)**:指本基准分析(2026-08-17)时尚未被 `scripts/extract-game-data.js` 解析的 key,已完成分析;除 #8/#10/#28 三个商店类 key 已于 2026-09-02 转为「已导出/已接入」(见文首注记)外,其余 26 个均判定无用。
- **已导出 key(27 个,编号 30-56)**:已被解析并导出到 `src/combatsimulator/data/*.json`,已完成逐个分析(字段消费/冗余),状态均为「已导出/已分析」;2026-09-02 起 #8/#10/#28 亦已导出并接入,实际已导出 key 合计 30 个(见文首注记)。

- 源文件:`tmp/initClientData.txt`(游戏版本 `v1.20260814.0`,2026-08-14 发布)
- 分析状态列用于标记每个 key 的评估结论:待分析 / 有用(已接入)/ 无用(暂不接入)/ 已导出(已分析)/ 已导出/已接入(2026-09-02 起新增,专指 #8/#10/#28:原判无用,现已导出并被模拟器消费)。

## 概览（未导出 key,编号 1-29）

| #   | Key                               | 类型   | 条目数 | 分析状态       | 描述                       |
| --- | --------------------------------- | ------ | ------ | -------------- | -------------------------- |
| 1   | `type`                            | string | —      | 无用（不接入） | 载荷类型标识               |
| 2   | `gameVersion`                     | string | —      | 无用（不接入） | 客户端游戏版本号           |
| 3   | `versionTimestamp`                | string | —      | 无用（不接入） | 数据版本发布时间           |
| 4   | `currentTimestamp`                | string | —      | 无用（不接入） | 载荷生成/下载时间          |
| 5   | `gameModeDetailMap`               | object | 3      | 无用（不接入） | 游戏模式定义(标准/Ironcow) |
| 6   | `marketplaceLimits`               | object | 8 字段 | 无用（不接入） | 市场引擎交易限制参数       |
| 7   | `randomTaskTypeDetailMap`         | object | 9      | 无用（不接入） | 随机任务类型定义           |
| 8   | `taskShopItemDetailMap`           | object | 4      | 已导出/已接入  | 任务商店兑换物品           |
| 9   | `shopCategoryDetailMap`           | object | 2      | 无用（不接入） | 商店分类                   |
| 10  | `shopItemDetailMap`               | object | 62     | 已导出/已接入  | 商店物品及 token 兑换价    |
| 11  | `actionTypeDetailMap`             | object | 13     | 无用（不接入） | 动作类型定义               |
| 12  | `actionCategoryDetailMap`         | object | 65     | 无用（不接入） | 动作分类定义               |
| 13  | `purchaseBundleDetailMap`         | object | 14     | 无用（不接入） | 付费充值包(牛铃/MooPass)   |
| 14  | `supporterPointExchangeDetailMap` | object | 2      | 无用（不接入） | 支持者积分兑换             |
| 15  | `buyableUpgradeDetailMap`         | object | 25     | 无用（不接入） | 可购买升级(队列上限等)     |
| 16  | `chatIconDetailMap`               | object | 502    | 无用（不接入） | 聊天图标外观               |
| 17  | `nameColorDetailMap`              | object | 184    | 无用（不接入） | 聊天昵称颜色               |
| 18  | `avatarDetailMap`                 | object | 99     | 无用（不接入） | 头像外观                   |
| 19  | `avatarOutfitDetailMap`           | object | 122    | 无用（不接入） | 头像服装外观               |
| 20  | `avatarBackgroundDetailMap`       | object | 7      | 无用（不接入） | 头像背景外观               |
| 21  | `avatarBorderDetailMap`           | object | 7      | 无用（不接入） | 头像边框外观               |
| 22  | `chatChannelTypeDetailMap`        | object | 20     | 无用（不接入） | 聊天频道类型               |
| 23  | `guildCharacterRoleDetailMap`     | object | 4      | 无用（不接入） | 公会角色权限               |
| 24  | `guildTrialDetailMap`             | object | 15     | 无用（不接入） | 公会试炼定义               |
| 25  | `guildBuildingDetailMap`          | object | 23     | 无用（不接入） | 公会建筑等级 buff          |
| 26  | `leaderboardTypeDetailMap`        | object | 5      | 无用（不接入） | 排行榜类型                 |
| 27  | `leaderboardCategoryDetailMap`    | object | 30     | 无用（不接入） | 排行榜分类                 |
| 28  | `labyrinthShopItemDetailMap`      | object | 21     | 已导出/已接入  | 迷宫商店兑换物品           |
| 29  | `keys`                            | array  | 101    | 无用（不接入） | JS 关键字/API 注入列表     |

## 已导出的 Key（27 个，状态:已导出/已分析）

以下 key 已被 `scripts/extract-game-data.js` 解析并导出到 `src/combatsimulator/data/*.json`，由模拟器直接消费。此处分两个表格记录其条目数/结构,供后续逐个分析「哪些字段被真正消费、哪些只是随文件落地」。

### 已导出 Key 概览（对象型 Map）

| #   | Key                                | 类型   | 条目数 | 分析状态      | 代码状态   | 描述                                    |
| --- | ---------------------------------- | ------ | ------ | ------------- | ---------- | --------------------------------------- |
| 30  | `abilityDetailMap`                 | object | 57 条  | 已导出/已分析 | 无需修改   | 战斗能力定义(伤害/治疗/增益效果)        |
| 31  | `achievementDetailMap`             | object | 77 条  | 已导出/已分析 | 无需修改   | 成就定义(按 tier 分组,全解锁给 buff)    |
| 32  | `achievementTierDetailMap`         | object | 6 条   | 已导出/已分析 | 无需修改   | 成就 tier(全解锁发 buff)                |
| 33  | `actionDetailMap`                  | object | 760 条 | 已导出/已分析 | **已修复** | 动作/战斗区定义(含怪物刷新/boss/地下城) |
| 34  | `buffTypeDetailMap`                | object | 65 条  | 已导出/已分析 | 无需修改   | buff 类型字典(名称显示用)               |
| 35  | `combatMonsterDetailMap`           | object | 95 条  | 已导出/已分析 | 无需修改   | 怪物定义(属性/技能/掉落,战斗核心)       |
| 36  | `combatStyleDetailMap`             | object | 6 条   | 已导出/已分析 | 无需修改   | 战斗风格(经验分配表核心)                |
| 37  | `combatTriggerComparatorDetailMap` | object | 4 条   | 已导出/已分析 | 无需修改   | 触发器比较器(校验/UI/值判定)            |
| 38  | `combatTriggerConditionDetailMap`  | object | 54 条  | 已导出/已分析 | **已修复** | 触发器条件(目标匹配/比较器限制)         |
| 39  | `combatTriggerDependencyDetailMap` | object | 4 条   | 已导出/已分析 | 无需修改   | 触发器依赖(单/多目标分支)               |
| 40  | `communityBuffTypeDetailMap`       | object | 5 条   | 已导出/已分析 | 无需修改   | 社区 buff(模板数值+兜底)                |
| 41  | `damageTypeDetailMap`              | object | 4 条   | 已导出/已分析 | 无需修改   | 伤害类型字典(名称显示用)                |
| 42  | `equipmentTypeDetailMap`           | object | 25 条  | 已导出/已分析 | 无需修改   | 装备类型(构建期槽位映射)                |
| 43  | `guildBuffDetailMap`               | object | 10 条  | 已导出/已分析 | 无需修改   | 公会 buff(等级上限+每级加成)            |
| 44  | `guildShrineDetailMap`             | object | 5 条   | 已导出/已分析 | 无需修改   | 公会圣坛(等级上限)                      |
| 45  | `houseRoomDetailMap`               | object | 17 条  | 已导出/已分析 | 无需修改   | 住宅房间(房间 buff+升级成本)            |
| 46  | `itemCategoryDetailMap`            | object | 10 条  | 已导出/已分析 | 无需修改   | 物品分类字典(名称显示)                  |
| 47  | `itemDetailMap`                    | object | 957 条 | 已导出/已分析 | 无需修改   | 物品全量定义(装备/消耗品/强化/卷轴)     |
| 48  | `itemLocationDetailMap`            | object | 26 条  | 已导出/已分析 | 无需修改   | 物品位置(导入装备归类)                  |
| 49  | `labyrinthCrateDetailMap`          | object | 9 条   | 已导出/已分析 | 无需修改   | 迷宫补给箱 buff                         |
| 50  | `openableLootDropMap`              | object | 22 条  | 已导出/已分析 | 无需修改   | 宝箱掉落表(市场估值/强化获取)           |
| 51  | `personalBuffTypeDetailMap`        | object | 12 条  | 已导出/已分析 | 无需修改   | 个人 buff(战斗卷轴模板)                 |
| 52  | `skillDetailMap`                   | object | 18 条  | 已导出/已分析 | 无需修改   | 技能字典(名称显示)                      |

### 已导出 Key 概览（数组/表）

| #   | Key                                         | 类型  | 条目数   | 分析状态      | 代码状态 | 描述                      |
| --- | ------------------------------------------- | ----- | -------- | ------------- | -------- | ------------------------- |
| 53  | `abilitySlotsLevelRequirementList`          | array | 6 元素   | 已导出/已分析 | 无需修改 | 能力槽位智力需求表        |
| 54  | `enhancementLevelSuccessRateTable`          | array | 20 元素  | 已导出/已分析 | 无需修改 | 强化成功率表(0-19 级)     |
| 55  | `enhancementLevelTotalBonusMultiplierTable` | array | 21 元素  | 已导出/已分析 | 无需修改 | 强化总加成倍率表(0-20 级) |
| 56  | `levelExperienceTable`                      | array | 201 元素 | 已导出/已分析 | 无需修改 | 等级经验阈值表(0-200 级)  |

> 代码状态说明:**待修(高/中/低)**表示已确认但尚未处理的问题;**已修复**表示本轮分析中发现并已处理;**无需修改**表示复核后没有代码改动需求。当前没有待修项。未导出的 29 个 key 已判定不接入,不存在修复问题。

## 逐个详情

### 1. `type`

- 类型:string
- 值:`"init_client_data"`
- 说明:载荷类型标识。
- **分析结论(2026-08-17):无用,不接入。** 纯标记字段,仅标识载荷为 `init_client_data`;模拟器直接使用解压后的数据对象,不依赖该字段。全仓库 `src/` 无任何引用。

### 2. `gameVersion`

- 类型:string
- 值:`"v1.20260814.0"`
- 说明:当前客户端游戏版本号。
- **分析结论(2026-08-17):无用,不接入。** 模拟器使用随仓库提交的游戏数据快照,构建/运行时无需读取游戏版本号;`src/` 无任何引用,也没有"数据版本过期提醒"机制。数据刷新由维护流程(`docs/game-data.md`)人工控制,版本号仅作为文档记录参考(已记录在本文件头部)。

### 3. `versionTimestamp`

- 类型:string
- 值:`"2026-08-14T13:49:23.176205525Z"`
- 说明:该版本数据的发布时间。
- **分析结论(2026-08-17):无用,不接入。** 纯元信息,`src/` 无引用;模拟器的时间戳体系(`marketTimestamp` 市场价格快照时间、`patchNotes`/`baselineReminder` 自身记录时间)与游戏数据发布时间无关。

### 4. `currentTimestamp`

- 类型:string
- 值:`"2026-08-15T01:34:25.636763607Z"`
- 说明:载荷生成/下载时间。
- **分析结论(2026-08-17):无用,不接入。** 同 `versionTimestamp`,纯元信息;模拟器运行时使用浏览器本地时间,不依赖载荷下载时间戳,`src/` 无引用。

### 5. `gameModeDetailMap`

- 类型:object(3 条)
- 键示例:`ironcow`、`legacy_ironcow`、`standard`
- 字段:`hrid`、`name`、`description`、`isCreatable`、`maxCharacterLimit`、`marketRestricted`、`subsetGameModes`、`sortIndex`(共 8 个)
- 说明:游戏模式定义(标准 / Ironcow / Legacy Ironcow),含 `marketRestricted` 市场限制标记(ironcow 系为 true)。
- **分析结论(2026-08-17):无用,不接入。** 模拟器按 standard 模式(市场可用)建模,不区分游戏模式:`marketRestricted`、`gameMode` 在 `src/` 均无引用;`marketPriceService` 中的 `mode` 是价格模式(bid/ask/vendor),与游戏模式无关。测试 fixture 中的 `gameMode: "/game_modes/standard"` 仅为模拟官方档案格式,生产代码不读取。

### 6. `marketplaceLimits`

- 类型:object(8 个字段)
- 字段:`maxQuantity`、`maxPrice`、`maxNotional`、`discoveryWidthStart`、`discoveryWidthStep`、`discoveryWidthDecay`、`recalibrationIntervalMinutes`、`bandMaxMovePerPassFactor`
- 说明:市场引擎限制参数(交易数量/价格上限、价格发现带宽、重校准周期)。
- **分析结论(2026-08-17):无用,不接入。** 全部字段在 `src/` 无引用。模拟器只通过 `https://www.milkywayidle.com/game_data/marketplace.json` 拉取价格快照并评估收益,不实现市场引擎本身;手续费按物品 HRID 硬编码(`getMarketSaleFeeRate`,如牛铃 18%、其他 5%),与市场限制参数无关。

### 7. `randomTaskTypeDetailMap`

- 类型:object(9 条)
- 键示例:`/random_task_types/brewing`、`/random_task_types/combat`、`/random_task_types/cooking`、`/random_task_types/crafting`
- 字段:`hrid`、`isCombat`、`skillHrid`、`sortIndex`
- 说明:随机任务类型定义(战斗/各生活技能),`/random_task_types/combat` 的 `isCombat: true`、`skillHrid: ""`。
- **分析结论(2026-08-17):无用,不接入。** 模拟器不包含随机任务/任务玩法:`randomTask`/`task`/`quest` 等关键字在 `src/` 均无引用(仅 `requested` 等无关词汇)。`isCombat` 标记用于区分任务类型,但模拟器不消费任务玩法数据。

### 8. `taskShopItemDetailMap`

- 类型:object(4 条)
- 键示例:`/task_shop_items/large_artisans_crate`、`/task_shop_items/large_meteorite_cache`、`/task_shop_items/large_treasure_chest`、`/task_shop_items/task_crystal`
- 字段:`hrid`、`name`、`itemHrid`、`cost`(task_token 30/50 个)、`sortIndex`
- 说明:任务商店物品(用 Task Token 兑换宝箱/水晶)。
- **分析结论(2026-08-17):无用,不接入。** 涉及的物品(宝箱、task_token、task_crystal)均已存在于已导出的 `itemDetailMap.json`,宝箱掉落内容已由 `openableLootDropMap.json` 覆盖(其中 large/medium/small 三种 crate 与 cache 都在),宝箱期望值计算使用 `marketPriceService` 硬编码的 `TREASURE_CHEST_HRIDS`。本 key 独有的信息仅是任务商店兑换价(成本关系),模拟器不消费任务商店。
- **修订(2026-09-02):已导出/已接入。** 上一行结论「模拟器不消费任务商店」已失效:本 key 已由 `scripts/extract-game-data.js` 导出至 `src/combatsimulator/data/taskShopItemDetailMap.json`,被 `src/services/assetScoreService.js` 静态引入并入三表合并的 `STATIC_SHOP_ENTRY_LIST`,任务商店兑换价经 `computeShopCurrencyValue` 折算,作为资产分「商店兑换获取成本」渠道参与计价。

### 9. `shopCategoryDetailMap`

- 类型:object(2 条)
- 键示例:`/shop_categories/dungeon`、`/shop_categories/general`
- 字段:`hrid`、`name`、`sortIndex`
- 说明:商店分类。
- **分析结论(2026-08-17):无用,不接入。** 仅 2 个分类名;UI(`HomePage.vue`)中 `/shop_categories/dungeon` 仅用于显示文案,来源是官方翻译资源 `locales/*/translation.official.generated.json` 的 `shopCategoryNames` 域(`/shop_categories/dungeon = Dungeon`),不依赖本 key。

### 10. `shopItemDetailMap`

- 类型:object(62 条)
- 键示例:`/shop_items/acrobats_ribbon`、`/shop_items/bishops_scroll`、`/shop_items/chaotic_chain`
- 字段:`hrid`、`category`、`itemHrid`、`costs`(token 兑换数组)、`sortIndex`
- 说明:商店物品明细(地下城/通用商店用特殊 token 兑换)。
- **分析结论(2026-08-17):无用,不接入。** 涉及的物品与 token 均已存在于已导出的 `itemDetailMap.json`,token 作为掉落物也在 `openableLootDropMap.json` 中;模拟器物品估值使用商店售价价(`sellPrice`/`itemVendorPriceByHrid` 作为 vendor floor),不依赖"用多少 token 兑换"的采购成本。核心代码对 `shop_item`/`/shop_categories/` 零引用(UI 分类名走翻译资源)。
- **修订(2026-09-02):已导出/已接入。** 上一行结论「核心代码对 `shop_item` 零引用」已失效:本 key 已导出至 `src/combatsimulator/data/shopItemDetailMap.json`,被 `assetScoreService.js` 静态引入并入 `STATIC_SHOP_ENTRY_LIST`,`costs` 兑换成本经 `normalizeShopCosts`/`computeShopCurrencyValue` 参与获取成本。`/shop_categories/` 断言部分仍成立:分类名显示仍走翻译资源,`category` 字段仅随条目落地、未被代码单独消费。

### 11. `actionTypeDetailMap`

- 类型:object(13 条)
- 键示例:`/action_types/alchemy`、`/action_types/brewing`、`/action_types/combat`、`/action_types/cooking`
- 字段:`hrid`、`name`、`sortIndex`
- 说明:动作类型(对应各技能 + combat/labyrinth/enhancing/special)。
- **分析结论(2026-08-17):无用,不接入。** 模拟器代码以**硬编码字符串**引用 `/action_types/combat`(如 `combatScrolls.js` 的 `COMBAT_ACTION_TYPE_HRID`、`simulationDomain.js` 过滤、`importExportMapper.js`、`enhancementImportMapper.js` 的 `/action_types/enhancing`),不查询本 map;`actionTypeForSkill()` 直接拼 `${skillKey}` 生成 HRID。`gameDataIndex` 无本 key 索引;名称显示走官方翻译 `actionTypeNames`(13 条,已完整覆盖)。

### 12. `actionCategoryDetailMap`

- 类型:object(65 条)
- 键示例:`/action_categories/alchemy/alchemy`、`/action_categories/brewing/coffee`、`/action_categories/brewing/labyrinth`
- 字段:`hrid`、`name`、`type`、`sortIndex`
- 说明:动作分类(按类型 + 子类)。
- **分析结论(2026-08-17):无用,不接入。** 模拟器只用硬编码 `/action_categories/combat/dungeons` 排除地下城动作(`simulationDomain.js` 第 50 行),不查询本 map;`actionDetailMap.json` 中每个动作的 `category` 字段即已包含分类 HRID,无需额外解析。名称显示走官方翻译 `actionCategoryNames`(65 条,已完整覆盖)。

### 13. `purchaseBundleDetailMap`

- 类型:object(14 条)
- 键示例:`/purchase_bundles/cowbells_1050`、`/purchase_bundles/cowbells_2700`
- 字段:`hrid`、`stripeItemId`、`kongregateIdentifier`、`steamItemId`、`name`、`isStandardOnly`、`isIroncowOnly`、`quantity`、`mooPassDays`、`isAccountMooPass`、`supporterPoints`、`centPrice`、`kredPrice`、`sortIndex`(共 14 个)
- 说明:付费购买包(牛铃充值、MooPass、支付平台 ID)。
- **分析结论(2026-08-17):无用,不接入。** 纯付费商业数据;模拟器只涉及 `/items/bag_of_10_cowbells` 物品级处理(`marketPriceService.js` 的 `BAG_OF_10_COWBELLS_HRID`,已在 itemDetailMap 导出),不消费充值包定义。`src/` 对 `purchase_bundle` 零引用。

### 14. `supporterPointExchangeDetailMap`

- 类型:object(2 条)
- 键示例:`/supporter_point_exchanges/bag_of_10_cowbells`、`/supporter_point_exchanges/cowbell`
- 字段:`hrid`、`itemHrid`、`supporterPointCost`、`sortIndex`
- 说明:支持者积分兑换(支持者点数换牛铃)。
- **分析结论(2026-08-17):无用,不接入。** 付费体系附属数据,`src/` 零引用;涉及的物品本身已在 itemDetailMap 导出,兑换关系模拟器不消费。

### 15. `buyableUpgradeDetailMap`

- 类型:object(25 条)
- 键示例:`/buyable_upgrades/action_queue_cap_1`、`/buyable_upgrades/labyrinth_path_cap_1`
- 字段:`hrid`、`name`、`cost`(牛铃)、`hasBuyLimit`、`buyLimit`、`offlineHourCount`、`marketListingCount`、`actionQueueCount`、`loadoutSlotCount`、`taskSlotCount`、`labyrinthPathCount`、`sortIndex`(共 12 个)
- 说明:可购买升级(行动队列上限、迷宫路径上限、挂机时长、市场上架数等)。
- **分析结论(2026-08-17):无用,不接入。** 模拟器不含行动队列/挂机/市场上架等可购买升级概念:搜索 `actionQueue`/`queueCapacity` 等关键词 `src/` 零引用;`queueUpgradeCost.js` 虽有 "queue" 字样,但那是模拟器自身的"队列优化"策略(指多目标排队模拟),与游戏内可购买升级无关。

### 16. `chatIconDetailMap`

- 类型:object(502 条)
- 键示例:`/chat_icons/abyssal_imp`、`/chat_icons/admin`
- 字段:`hrid`、`name`、`isSpecial`、`isSeasonal`、`seasonStartMonth` 等(共 12 个)
- 说明:聊天图标(数量大,纯外观)。
- **分析结论(2026-08-17):无用,不接入。** 外观数据;`src/` 对 `chatIcon`/`chat_icon` 零引用。模拟器不渲染游戏内聊天头像图标。

### 17. `nameColorDetailMap`

- 类型:object(184 条)
- 键示例:`/name_colors/blue`、`/name_colors/custom_17s`
- 字段:`hrid`、`name`、`isSeasonal`、`seasonStartMonth`、`seasonStartDay` 等(共 9 个)
- 说明:聊天昵称颜色。
- **分析结论(2026-08-17):无用,不接入。** 外观数据;`src/` 对 `nameColor`/`name_color` 零引用。模拟器不显示聊天昵称颜色。

### 18. `avatarDetailMap`

- 类型:object(99 条)
- 键示例:`/avatars/blue_person_1`、`/avatars/bunny_1`
- 字段:`hrid`、`isSeasonal`、`seasonStartMonth` 等(共 8 个)
- 说明:头像。
- **分析结论(2026-08-17):无用,不接入。** 外观数据;`src/` 仅在测试 fixture 有空的 `avatarHrid: ""`(模拟官方档案格式),生产代码不消费。

### 19. `avatarOutfitDetailMap`

- 类型:object(122 条)
- 键示例:`/avatar_outfits/anchorbound_equipment`、`/avatar_outfits/custom_888ray888`
- 字段:`hrid`、`isSeasonal`、`seasonStartMonth` 等(共 8 个)
- 说明:头像服装。
- **分析结论(2026-08-17):无用,不接入。** 同 `avatarDetailMap`,仅测试 fixture 有空的 `avatarOutfitHrid: ""`,生产代码不消费。

### 20. `avatarBackgroundDetailMap`

- 类型:object(7 条)
- 键示例:`/avatar_backgrounds/cherry_blossom`、`/avatar_backgrounds/halo`
- 字段:`hrid`、`isSeasonal`、`seasonStartMonth` 等(共 9 个)
- 说明:头像背景。
- **分析结论(2026-08-17):无用,不接入。** 纯外观,`src/` 零引用。

### 21. `avatarBorderDetailMap`

- 类型:object(7 条)
- 键示例:`/avatar_borders/cherry_blossom`、`/avatar_borders/fire`
- 字段:`hrid`、`isSeasonal`、`seasonStartMonth` 等(共 9 个)
- 说明:头像边框。
- **分析结论(2026-08-17):无用,不接入。** 纯外观,`src/` 零引用。

### 22. `chatChannelTypeDetailMap`

- 类型:object(20 条)
- 键示例:`/chat_channel_types/beginner`、`/chat_channel_types/chinese`、`/chat_channel_types/english`
- 字段:`hrid`、`name`、`isPublic`、`sortIndex`
- 说明:聊天频道类型(新手/中文/英文等)。
- **分析结论(2026-08-17):无用,不接入。** 聊天频道定义,`src/` 对 `chatChannelType`/`chat_channel_type` 零引用;模拟器不含聊天功能。名称显示即使需要也已由官方翻译 `chatChannelTypeNames`(20 条,完整覆盖)。

### 23. `guildCharacterRoleDetailMap`

- 类型:object(4 条)
- 键示例:`general`、`leader`、`member`、`officer`
- 字段:`hrid`、`name`、`permissionTier`、`promoteRole`、`demoteRole`、`can*` 权限布尔(共 19 个)
- 说明:公会成员角色与权限(能否改名/邀请/踢人/管理建筑等)。
- **分析结论(2026-08-17):无用,不接入。** 纯公会管理权限数据;`src/` 对 `guildCharacterRole`/`permissionTier` 零引用。模拟器不模拟公会管理。

### 24. `guildTrialDetailMap`

- 类型:object(15 条)
- 键示例:`/guild_combat/badger`、`/guild_combat/chameleon`、`/guild_combat/hedgehog`
- 字段:`hrid`、`name`、`kind`、`actionTypeHrid`、`skillHrid`、`monsterHrids`、`sortIndex`(共 7 个)
- 说明:公会试炼(combat 类,引用 `/monsters/trial_*` 怪物)。
- **分析结论(2026-08-17):无用,不接入。** 模拟器确实支持公会试炼场景,但用的是 `isGuildTrial` **布尔标记**(`combatSimulator.js:748` 生成 `guild_trial` 来源标签;UI 处理该 reason),不读取试炼定义/怪物列表。试炼怪物本身(`/monsters/trial_*`)由已导出的 `combatMonsterDetailMap.json` 覆盖。`src/` 对 `guildTrial`/`guild_combat` map 数据零引用。

### 25. `guildBuildingDetailMap`

- 类型:object(23 条)
- 键示例:`/guild_buildings/archery_range`、`/guild_buildings/archives`、`/guild_buildings/armory`
- 字段:`hrid`、`name`、`maxLevel`、`guildPointCosts`(每级点成本)、`skillHrid`、`buffs`(技能等级类 buff)
- 说明:公会建筑(每级提供技能等级 buff,如射箭场→`/buff_types/ranged_level`)。
- **分析结论(2026-08-17):无用,不接入。** 模拟器已建模的"公会加成体系"是 **guildBuffDetailMap + guildShrineDetailMap(圣坛)**(`shared/guildBuffs.js` 用它算 buff 等级上限),与建筑 buff 是两套机制;playerMapper 只消费 `guildBuffs`,对 `guildBuildingLevelMap`(玩家档案里的建筑等级)仅透传不做计算。建筑 buff 的类型(`/buff_types/*_level` 等 18 个)已在 `buffTypeDetailMap.json` 中,但"某建筑某级给多少数值"的表不被任何逻辑消费(无按建筑等级应用 buff 的代码)。

### 26. `leaderboardTypeDetailMap`

- 类型:object(5 条)
- 键示例:`guild`、`ironcow`、`standard`、`steam_ironcow`、`steam_standard`
- 字段:`hrid`、`name`、`gameMode`、`isSteam`、`minJoinTime`、`isGuild`、`subsetGameModes`、`sortIndex`
- 说明:排行榜类型(按游戏模式/Steam 区分)。
- **分析结论(2026-08-17):无用,不接入。** `src/` 对 `leaderboard*` 零引用;模拟器不展示/不计算排行榜。名称显示即使需要也可由官方翻译 `leaderboardTypeNames` 覆盖。

### 27. `leaderboardCategoryDetailMap`

- 类型:object(30 条)
- 键示例:`alchemy`、`attack`、`bestiary_points`、`brewing`
- 字段:`hrid`、`name`、`skillHrid`、`isGuild`、`sortIndex`
- 说明:排行榜分类(按技能/图鉴/收集点)。
- **分析结论(2026-08-17):无用,不接入。** 同 `leaderboardTypeDetailMap`,`src/` 零引用;模拟器不涉及排行榜。

### 28. `labyrinthShopItemDetailMap`

- 类型:object(21 条)
- 键示例:`/labyrinth_shop_items/artificer_cape`、`/labyrinth_shop_items/chance_cape`
- 字段:`hrid`、`name`、`itemHrid`、`cost`(labyrinth_token)、`outputCount`、`sortIndex`(共 6 个)
- 说明:迷宫商店物品(用迷宫代币换披风等)。
- **分析结论(2026-08-17):无用,不接入。** 类似 shop/taskShop:涉及的物品(artificer_cape 等)与 `labyrinth_token`/`labyrinth_essence` 均已由已导出的 `itemDetailMap.json` 覆盖,`labyrinth_essence` 作为掉落物也在 `openableLootDropMap.json` 中;模拟器消费物品(含迷宫相关)走 `labyrinthCrateDetailMap`/`itemDetailMap`,`src/` 对 `labyrinth_shop` 零引用。本 key 独有的商店兑换价不被消费。
- **修订(2026-09-02):已导出/已接入。** 上一行结论「`src/` 对 `labyrinth_shop` 零引用」「本 key 独有的商店兑换价不被消费」均已失效:本 key 已导出至 `src/combatsimulator/data/labyrinthShopItemDetailMap.json`,被 `assetScoreService.js` 静态引入并入 `STATIC_SHOP_ENTRY_LIST`,迷宫代币兑换价(含 `outputCount` 一换多)经 `normalizeShopRewards`/`computeShopCurrencyValue` 参与资产分获取成本。

### 29. `keys`

- 类型:array(101 个元素)
- 元素示例:`"addEventListener"`、`"alert"`、`"window"` 等
- 说明:JS 关键字/浏览器 API 列表(游戏引擎注入列表)。
- **分析结论(2026-08-17):无用,不接入。** 经核对,该数组元素全部为 JS 语言关键字与浏览器 API 名(alert、addEventListener、window 等),是游戏引擎的注入/保留字列表,与游戏数据无关,可忽略。

## 已导出 Key 逐个详情（27 个，已分析）

> 说明:以下 key 已由 `scripts/extract-game-data.js` 导出到 `src/combatsimulator/data/*.json`,并被模拟器消费。此处的「分析」指:梳理每个 key 中被模拟器真正消费的字段/条目与仅随文件落地的冗余,标签为 30-56(承接前表编号)。待分析完成后更新上方两个概览表的状态列。

### 30. `abilityDetailMap`

- 类型:object(57 条)
- 导出文件:`src/combatsimulator/data/abilityDetailMap.json` + 生成索引 `abilityDetailIndex`(shared 层)
- 说明:战斗能力定义(技能/法术)。
- **分析结论(2026-08-17):核心数据,已消费。** 战斗模拟核心直接读取能力数值做计算:
  - `combatsimulator/abilityDefinitionResolver.js` + `ability.js`:消费 `manaCost`/`cooldownDuration`/`castDuration`/`abilityEffects`/`defaultCombatTriggers`/`isSpecialAbility`(能力建模,含等级成长换算)
  - `services/triggerMapper.js`:消费 `defaultCombatTriggers`(默认触发器)
  - `services/importExportMapper.js`/`playerMapper.js`:消费 `isSpecialAbility`/`name`(档案导入)
  - `ui/pages/HomePage.vue`:消费 `isSpecialAbility`/`sortIndex`/`name`(特殊能力选择列表)
  - `shared/gameDataIndex.js`:生成 `abilityDetailIndex`/`abilityOptions` 索引
- **未引用 key 内容但属于能力功能的点(硬编码)**:
  1. `abilityDefinitionResolver.js` 的 `supplementalAbilityDefinitionMap`:**Blaze(blaze)/Bloom(bloom)两个能力的完整定义硬编码在代码里**(已确认不在官方 57 条中,注释声明为"模拟器专用派生能力")。
  2. `combatSimulator.js:1741-1746`:按 `combatStats.blaze/bloom` 概率触发时用简写 `new Ability("blaze")`/`"bloom"`(依赖 alias map),触发概率来自战斗属性而非本 map。
  3. `combatUnit.js:130-131`:`combatStats` 默认值 `bloom: 0, blaze: 0` 硬编码。
- 提示:若官方数据未来补上 blaze/bloom,可移除补充 map;目前职责清晰,无冗余消费问题。

### 31. `achievementDetailMap`

- 类型:object(77 条,6 个 tier:beginner/novice/adept/veteran/elite/champion)
- 导出文件:`src/combatsimulator/data/achievementDetailMap.json`
- 字段:`hrid`、`name`、`description`、`tierHrid`、`sortIndex`、`steamAchievementId`、`target`
- 说明:成就定义。**成就条目本身不含 buff**——buff 在 `achievementTierDetailMap`(32 号)的 `tier.buff`,按"某 tier 下全部成就解锁"发放。
- **分析结论(2026-08-17):已消费,核心字段是 `hrid`+`tierHrid`。** 消费点:
  - `combatsimulator/achievement.js`:按 `tierHrid` 过滤成就 → 全部解锁则 `new Buff(tier.buff)`(战斗加成)
  - `ui/pages/HomePage.vue`:成就面板(勾选/全选),消费 `hrid`/`tierHrid`/`sortIndex`/`name`
  - `services/enhancementImportMapper.js`:判断 novice/champion tier 是否全解锁,消费 `tierHrid`/`hrid`
  - `ui/composables/useGameDataText.js`:`getAchievementName` 显示(翻译优先,fallback `name`)
- **未消费字段**:`description`、`steamAchievementId`(Steam 成就 ID)、`target`(进度目标)——模拟器只使用"解锁布尔标志",不检查成就进度。
- **未引用 key 内容的硬编码点**:
  1. `enhancementImportMapper.js:9-12`:硬编码 `NOVICE_TIER_HRID="/achievement_tiers/novice"`、`CHAMPION_TIER_HRID="/achievement_tiers/champion"`(强化双倍成就 buff 判断)
  2. `ui/pages/EnhancementPage.vue:207-212`:Novice/Champion 成就加成复选框,硬编码 tier HRID
  3. `services/enhancementSimulator.js:184-185,467-468,503-504`:按 `novice`/`champion` 字符串片段找 buff
- **复核记录(2026-08-17):无需修复。** 上述 4 个硬编码 HRID(tier ×2 + buff_unique ×2)与官方 `achievementTierDetailMap.json` 逐字一致(`/achievement_tiers/novice|champion`、`/buff_uniques/achievement_novice_experience|achievement_champion_enhancing_success`);硬编码仅限「哪个 tier 参与强化」的选择面,数值(0.02 wisdom / 0.002 enhancing_success)来自官方 tier.buff,经 build 脚本 `achievementBuffs` 索引(见 32 号)数据驱动。官方改数值→索引自动更新;官方移出 enhancing→`resolveBuffValue(null)` 优雅归 0。战斗路径 `achievement.js` 零硬编码。

### 32. `achievementTierDetailMap`

- 类型:object(6 条:beginner/novice/adept/veteran/elite/champion)
- 导出文件:`src/combatsimulator/data/achievementTierDetailMap.json`
- 字段:`hrid`、`name`、`sortIndex`、`buff`(成就加成数值)、`usableInActionTypeMap`(可用的动作类型)
- 说明:成就 tier。**成就战斗 buff 的真正来源**(31 号 `achievementDetailMap` 条目本身无 buff,按 tier 全解锁后取此 `tier.buff`)。
- **分析结论(2026-08-17):已消费,核心字段是 `hrid`+`buff`。** 消费点:
  - `combatsimulator/achievement.js:10-22`:遍历 tier → 该 tier 成就全解锁则 `new Buff(tier.buff)`(战斗加成主体)
  - `ui/pages/HomePage.vue:1801-1822`:成就面板按 tier 分组,消费 `hrid`/`name`/`sortIndex`
  - `ui/composables/useGameDataText.js`:`getAchievementTierName` 名称显示(翻译优先,fallback `name`)
- **未消费字段**:`usableInActionTypeMap`(顶层的动作类型限定,**战斗模拟不读它**;`combatUnit.js:421-423` 对成就 buff 直接 `addPermanentBuff` 无差别应用,无 actionType 过滤。~~该字段在仓库中仅 `skillingPlanner.js` 的饮品槽逻辑有类似消费,但成就 buff 路径不走~~)。**修正(2026-08-17 复核)**:强化链路消费该字段——`build-game-data-index.mjs:787-796` 按 `usableInActionTypeMap[enhancing]===true`(∩ buff.typeHrid 白名单 `{enhancing_success, wisdom}`)筛选生成 `enhancementData.achievementBuffs` 索引(恰好 novice/champion 两条),`enhancementSimulator.js` 的 `findAchievementBuff` 即查此索引取数值。即:战斗路径不读它,强化路径数据驱动读它。
- 备注:`buff` 内部还有 `usableInActionTypeMap` 字段(1 号能力结构里出现过),同样不在模拟战斗路径消费。

### 33. `actionDetailMap`

- 类型:object(760 条;其中 combat 类型 59 个区,含 4 个地下城;其余为生产动作)
- 导出文件:`src/combatsimulator/data/actionDetailMap.json` + 生成索引 `actionDetailIndex`(shared 层)
- 字段:`hrid`、`function`、`type`、`category`、`name`、`maxDifficulty`、`levelRequirement`、`baseTimeCost`、`experienceGain`、`dropTable`、`essenceDropTable`、`rareDropTable`、`upgradeItemHrid`、`retainAllEnhancement`、`inputItems`、`outputItems`、`combatZoneInfo`(fightInfo/dungeonInfo)、`maxPartySize`、`buffs`、`sortIndex`
- 说明:动作/战斗区定义。战斗区含怪物刷新表(spawns)、boss 生成(bossSpawns)、地下城波次(fixedSpawnsMap/randomSpawnInfoMap/maxWaves)。
- **分析结论(2026-08-17):核心数据,已消费。** 消费点:
  - `combatsimulator/zone.js`(战斗区核心):`combatZoneInfo.fightInfo`(randomSpawnInfo.spawns/bossSpawns)、`combatZoneInfo.dungeonInfo`(maxWaves/fixedSpawnsMap/randomSpawnInfoMap)、`baseTimeCost`、`buffs`、`isDungeon`
  - `services/simulationDomain.js:48-50`:`type`+`category`+`sortIndex`(非地下城战斗区过滤)
  - `stores/simulatorStore.js:302`:`maxSpawnCount`(区怪数判断,UI 1 怪/多怪)
  - `scripts/build-game-data-index.mjs:841-885` 的 `createSkillingIndex()`:用 `function` 筛选生活技能动作,并投影 `levelRequirement`、`baseTimeCost`、`experienceGain`、`inputItems`、`outputItems`、`dropTable`、`essenceDropTable`、`rareDropTable`、`upgradeItemHrid`、`retainAllEnhancement`;`skillingPlanner.js:1088-1231` 据此计算动作门槛、经验、材料成本、普通/精华/稀有掉落产出及强化保留
  - `maxDifficulty` 经 `actionDetailIndex`/zone options 被 `simulationDomain.js`、`simulatorStore.js`、`importExportMapper.js` 消费,用于批量目标生成、难度上限和导入值钳制
  - `services/importExportMapper.js:1046`:`type === "/action_types/combat"`(档案区校验)
  - `shared/gameDataIndex.js` + UI:`name`(名称显示)、`actionNameByHrid`
  - 本变更(2026-09-02)`assetScoreService.js` 成本法在 build 投影之外直接读原始表:`getActionOutputIndex()` 取 `outputItems`(L201-202)、`computeAcquisitionInputPrice` 取 `upgradeItemHrid`/`inputItems`(L393/L402),并扫描配方按 `upgradeItemHrid` 匹配基件(L660-669),重建强化装备「制作获取成本」;
- **未消费字段**:`maxPartySize`。战斗掉落仍由怪物定义提供,但 action 级配方、经验与掉落字段已由生活技能规划器消费。
- **复核记录(2026-08-17):隐患已修复。** 官方 59 个战斗区均有 `battlesPerBoss`:10 个 boss 区为 10,49 个非 boss 区为 0 且 `bossSpawns=null`。原 `zone.js` 把该字段强制写为 10:对 boss 区无功能影响(官方值本就是 10);对非 boss 区虽因 `bossSpawns=null` 不会改变遭遇逻辑,却会把模块级共享 JSON 缓存中的官方值从 0 改成 10。现已删除覆盖语句,并对 `fightInfo` 做顶层浅拷贝以隔离 Zone 实例与模块缓存;回归测试保护非 boss 区值 0、boss 区值 10 以及多实例互不污染。
- 其余硬编码(`/action_types/combat`、`/action_categories/combat/dungeons`)为领域常量,合理。

### 34. `buffTypeDetailMap`

- 类型:object(65 条)
- 导出文件:`src/combatsimulator/data/buffTypeDetailMap.json` + 生成索引 `buffTypeDetailIndex`(shared 层)
- 字段:`hrid`、`isCombat`、`name`、`description`、`debuffDescription`、`sortIndex`
- 说明:Buff 类型定义(含 `/buff_types/*_level` 技能等级类)。
- **分析结论(2026-08-17):已消费,但仅 `name` 字段(名称字典)。** 消费点:
  - `shared/gameDataIndex.js:123-128`:`getBuffTypeName` 读 `name`(名称显示)
  - `ui/composables/useGameDataText.js:105-113`:`getBuffTypeName` -> 官方翻译优先,fallback 到本 map 的 name
  - 用途:UI 表头(`SimulationResultsView.vue:526`)、buff 标签(`HomePage.vue:1812-1823`)、卷轴 buff 名(`HomePage.vue:2126-2127`)等
- **未消费字段**:`isCombat`(buff 类型级战斗标记。代码中的 `isCombat` 均为 **guildBuff/社区 buff** 条目的字段(`guildBuff.js`/`guildBuffs.js`/`skillingImportMapper.js`),本 map 条目的 `isCombat` 无消费)、`description`/`debuffDescription`(纯文本,模拟器不显示)、`sortIndex`
- **关键说明**:buff 战斗效果计算**不查本 map**——`Buff` 类只存 `uniqueHrid`/`typeHrid`/数值(`buff.js`),`combatUnit.js` 通过 `getBuffBoost("/buff_types/xxx")` **按 typeHrid 字符串硬编码查各 stat**,本 map 只是"名称→显示"字典。对模拟器而言本 key 的数据价值是 `name`;若仅为了 UI 名称,翻译资源已覆盖(官方翻译 `buffTypeNames`),本文件实际是兜底 fallback。

### 35. `combatMonsterDetailMap`

- 类型:object(95 条;10 个迷宫怪 `isLabyrinthMonster=true`,8 个公会试炼怪 `isGuildMonster=true`)
- 导出文件:`src/combatsimulator/data/combatMonsterDetailMap.json` + 生成索引 `monsterDetailIndex`(shared 层)
- 字段:`hrid`、`name`、`isLabyrinthMonster`、`isGuildMonster`、`enrageTime`、`experience`、`combatDetails`(40+ 属性)、`abilities`、`dropTable`、`rareDropTable`
- 说明:战斗怪物定义(属性/技能/掉落,战斗模拟核心)。
- **分析结论(2026-08-17):核心数据,已消费。** 消费点:
  - `combatsimulator/monster.js`(战斗核心):`enrageTime`、`abilities`(按 difficultyTier 过滤 + 迷宫 roomLevel 缩放)、`dropTable`/`rareDropTable`(战斗掉落)、`combatDetails` 全套(等级/抗性/暴击/穿透等 40+ 字段,含迷宫缩放)、`experience`、`combatStats`
  - `services/simulationDomain.js:107/170`:`isLabyrinthMonster`(迷宫目标筛选,10 个)
  - `services/profitEstimator.js:236/442`、`simulatorStorage.js:816`、`importExportMapper.js:1266`:遍历怪物/取属性
  - `shared/gameDataIndex.js` + UI:`name`(名称显示)
- **未消费字段**:`isGuildMonster`(8 个 trial 怪标记,**代码 0 处读它**——公会试炼怪没有任何逻辑消费此标记;怪物本身可被 combatMonsterDetailMap 查到,但"公会怪"分类无用途)。
- **硬编码点(修复优先级:低,设计假设)**:`monster.js:10` `LabyrinthMonsterBaseRoomLevel = 100`(迷宫怪基础房间等级,属性按 roomLevel/100 缩放)——该基准在数据中不存在字段,与 `labyrinthConfig.js` 的 `LABYRINTH_ROOM_LEVEL_DEFAULT=100` 一致,是模拟器设计假设,当前正确,属合理硬编码。

### 36. `combatStyleDetailMap`

- 类型:object(6 条:stab/slash/smash/ranged/magic/heal)
- 导出文件:`src/combatsimulator/data/combatStyleDetailMap.json`
- 字段:`hrid`、`name`、`skillExpMap`(命中后经验分配技能表)、`sortIndex`
- 说明:战斗风格(近战三系/远程/魔法/治疗)。
- **分析结论(2026-08-17):已消费,核心字段是 `skillExpMap`。** 消费点:
  - `combatsimulator/simResult.js:444`(**核心数值**):`combatStyleDetailMap[combatStyleHrid].skillExpMap` —— 每次攻击后经验按风格分到技能(focusTraining 时 .7 到指定技能,否则 .7/技能数均分;attack/defense/intelligence/stamina 为公共项,melee/ranged/magic 为风格专属)
  - `ui/pages/HomePage.vue:1688/2382/2681`:`name`(风格名显示,翻译优先,fallback map name)
- **未消费字段**:`sortIndex`;`heal` 风格的 `skillExpMap=null`(治疗不作为普攻风格,经验分配不适用)。
- **硬编码点(合理)**:`combatUtilities.js:59-86` 与 `playerMapper.js:1018` 用 **switch 按 5 个普攻风格**硬编码命中/伤害计算(`heal` 不在 switch,默认 throw)——heal 仅走治疗能力效果路径(`playerMapper.js:1220/1236` 校验 heal 效果必须 magic 风格)。风格枚举固定,硬编码 switch 合理,但若官方新增风格需同步两处。
- **复核记录(2026-08-17):无需修复。** 6 条风格与官方数据一致;`simResult.js:444` 读 `combatStyleDetailMap[combatStyleHrid].skillExpMap` 数据驱动;`heal` 风格 `skillExpMap=null` 已确认(治疗不分配普攻经验)。switch 行号为 `combatUtilities.js:59-87`(原文 59-86 差一行,含 default throw 分支到 87),`playerMapper.js` 镜像在 1018-1055 区间。属合理的领域枚举硬编码。

### 37. `combatTriggerComparatorDetailMap`

- 类型:object(4 条:greater_than_equal/less_than_equal/is_active/is_inactive)
- 导出文件:`src/combatsimulator/data/combatTriggerComparatorDetailMap.json`
- 字段:`hrid`、`name`(如 `>=`)、`allowValue`(是否允许输入值)、`sortIndex`
- 说明:战斗触发器比较器。
- **分析结论(2026-08-17):已消费。** 消费点:
  - `services/triggerMapper.js:69`:用 map **校验触发器比较器是否合法**(不存在则丢弃/回退)——数据驱动校验
  - `services/triggerMapper.js:297-305`:`sortIndex`(比较器选项排序)、`name`(UI 选项)、**`allowValue`(决定比较器是否需要输入值,is_active/is_inactive 无值)**——数据驱动 UI 行为
  - `ui/queueTriggerPresentation.js:79-90`:触发器文本展示(比较器名 + 按 allowValue 决定是否带值)
  - `ui/components/home/InlineTriggerEditor.vue`:比较器选择器
- **未消费字段**:无。
- **硬编码点(合理)**:`combatsimulator/trigger.js:164-174` 战斗执行用 `switch` 硬编码 4 个比较器做实际判断(>=/<=/is_active/is_inactive)——比较器**运算逻辑只能代码实现**,map 只提供 name/allowValue,二者互补;枚举固定,若官方新增比较器需同步 trigger.js switch。修复优先级:低。

### 38. `combatTriggerConditionDetailMap`

- 类型:object(54 条)
- 导出文件:`src/combatsimulator/data/combatTriggerConditionDetailMap.json`
- 字段:`hrid`、`name`、`isSingleTarget`、`isMultiTarget`、`allowedComparatorHrids`、`sortIndex`
- 说明:触发器条件(血量/状态/饮品等,决定何时触发能力)。
- **分析结论(2026-08-17):核心数据,高数据驱动消费。** 消费点:
  - `services/triggerMapper.js:66`:条件合法性校验(不存在则丢弃触发器)
  - `services/triggerMapper.js:28-40`:**`isSingleTarget`/`isMultiTarget`(核心)**——按依赖的单/多目标性匹配条件(单目标依赖只允许 isSingleTarget 条件,多目标同理)
  - `services/triggerMapper.js:42-49`:**`allowedComparatorHrids`(核心)**——条件允许的比较器白名单(is_active/is_inactive 等)
  - `services/triggerMapper.js:278-288`:遍历条件构建 UI 选项,消费 `sortIndex` 排序(按目标类型过滤)
  - `ui/components/home/InlineTriggerEditor.vue:292`:`name`(条件名显示,翻译优先)
  - `ui/queueTriggerPresentation.js:70-72`:触发器文本展示
- **未消费字段**:无。
- **硬编码点(合理)**:`combatsimulator/trigger.js` 按 `conditionHrid` switch 硬编码条件判断逻辑——条件**判定运算只能代码实现**,map 提供元数据(单/多目标、比较器白名单、名称),二者互补;54 条条件中部分在 trigger.js 有实现,若官方新增条件且模拟器需要支持,需在 trigger.js 补分支(与数据无关,属功能覆盖问题)。修复优先级:低。
- **二次复核(2026-08-17):4 个死代码 case 已清理。** 原 `trigger.js` 有 4 个 case `/combat_trigger_conditions/invincible_armor`、`invincible_fire_resistance`、`invincible_nature_resistance`、`invincible_water_resistance`,**官方 `combatTriggerConditionDetailMap.json` 54 条中不存在这 4 个**(官方只有 `/combat_trigger_conditions/invincible`,无后缀)。这 4 个名称实际来自 `invincible` 能力授予的 **buff_unique**(`/buff_uniques/invincible_armor` 等),官方触发器不会将其用作 conditionHrid。现已移除这些永远不可达的分支;合法的 `/combat_trigger_conditions/invincible` 分支保持不变,并由 `trigger.test.js` 覆盖 Buff 存在/不存在时的 active/inactive 行为。

### 39. `combatTriggerDependencyDetailMap`

- 类型:object(4 条:all_allies/all_enemies/self/targeted_enemy)
- 导出文件:`src/combatsimulator/data/combatTriggerDependencyDetailMap.json`
- 字段:`hrid`、`name`、`isSingleTarget`、`isMultiTarget`、`sortIndex`
- 说明:触发器依赖(决定触发器作用的对象集合)。
- **分析结论(2026-08-17):核心数据,含运行时消费。** 消费点:
  - `combatsimulator/trigger.js:18`(**战斗执行时,核心**):`combatTriggerDependencyDetailMap[this.dependencyHrid].isSingleTarget` —— 运行时按数据决定走单目标分支还是多目标分支(self/targeted_enemy=单,all_allies/all_enemies=多)
  - `services/triggerMapper.js:29`:`isSingleTarget`(依赖与条件匹配)、`:63`(依赖合法性校验)、`:262-269`(遍历构建 UI 选项,消费 `sortIndex` 排序)
  - `ui/components/home/InlineTriggerEditor.vue:302`:`name`(显示,翻译优先)
  - `ui/queueTriggerPresentation.js:64-66`:展示文本
- **未消费字段**:`isMultiTarget`(当前代码只读取 `isSingleTarget`,并以 `!dependency.isSingleTarget` 推导多目标标记)。
- **硬编码点(合理)**:`trigger.js:27-38/46-58` switch 按 dependencyHrid 决定取值对象(self→source、targeted_enemy→target、all_allies→friendlies、all_enemies→enemies)——依赖**取值逻辑只能代码实现**,map 的 `isSingleTarget` 决定分支方向,二者结合;枚举固定,若官方新增依赖需同步 trigger.js。

### 40. `communityBuffTypeDetailMap`

- 类型:object(5 条:combat_drop_quantity/enhancing_speed/experience/gathering_quantity/production_efficiency)
- 导出文件:`src/combatsimulator/data/communityBuffTypeDetailMap.json`
- 字段:`hrid`、`name`、`usableInActionTypeMap`、`buff`(模板数值)、`description`、`cowbellCost`、`sortIndex`
- 说明:社区 buff(玩家用牛铃激活的全服/个人加成)。
- **分析结论(2026-08-17):已消费,核心字段是 `buff`(模板)与 `usableInActionTypeMap`。** 消费点:
  - `shared/simulationExtraBuffs.js:92`(**核心数值**):`communityBuffTypeDetailMap?.[hrid]?.buff` —— experience/combat_drop_quantity 的 buff 模板(战斗模拟的"社区加成"extra 输入);**若数据缺失回退到硬编码 `COMMUNITY_BUFF_FALLBACKS`(同数值兜底)**
  - `scripts/build-game-data-index.mjs:776-785`:按 `usableInActionTypeMap["/action_types/enhancing"]` 筛选强化可用条目,投影 `sortIndex` 并据此排序,生成 `enhancementData.communityBuffs`
  - `services/enhancementSimulator.js:426-496`:按 fragment(enhancing/experience)在生成的 `enhancementData.communityBuffs` 索引中找 buff(强化模拟)
  - `ui/pages/EnhancementPage.vue:196/200`:`name`(显示,翻译优先)
- **未消费字段**:`description`、`cowbellCost`。
- **硬编码点**:`simulationExtraBuffs.js:7-16` `MOO_PASS_BUFF_TEMPLATE`(MooPass 经验 buff 完全硬编码,数据中无此条目)与 `COMMUNITY_BUFF_FALLBACKS:18-39`(兜底)——均为数据缺失时的自建/兜底设计,合理。修复优先级:低。
- **复核记录(2026-08-17):无需修复。** 复查官方 `communityBuffTypeDetailMap.json` 5 条:`MOO_PASS_BUFF_TEMPLATE`(uniqueHrid `/buff_uniques/experience_moo_pass_buff`, wisdom 0.05)在官方数据中确实**无对应条目**(moo pass 不在 community buff 表中),属模拟器自建;`COMMUNITY_BUFF_FALLBACKS` 两条(experience flatBoost 0.2/0.005、combat_drop_quantity 0.2/0.005)与官方数据**逐字一致**(冗余但无害的防御性兜底,`resolveCommunityBuffTemplate` 优先读官方、缺失才回退)。MooPass 部分硬编码不可避免。

### 41. `damageTypeDetailMap`

- 类型:object(4 条)
- 导出文件:`src/combatsimulator/data/damageTypeDetailMap.json`
- 说明:伤害类型(物理/水/自然/火,名称显示用)。
- 分析状态:已导出/已分析
- **分析结论(2026-08-17):名称字典。** 仅 name 消费(UI 显示);`combatUtilities.js`(97 行)/`playerMapper.js`(1056 行)switch 硬编码 4 类型(近战/远程/魔法/真实),不查此表(领域枚举,合理)。
- 修复优先级:低
- **复核记录(2026-08-17):描述修正。** 原文"4 类型(近战/远程/魔法/真实)"不准确。复查 `combatUtilities.js:97-130` 的 damageType switch,4 个 case 实际为:`/damage_types/physical`、`/damage_types/water`、`/damage_types/nature`、`/damage_types/fire`(物理/水/自然/火),**无"真实"类型分支**,default 未处理。这与官方 `damageTypeDetailMap.json` 4 条(physical/water/nature/fire)一致。代码 switch 按官方枚举实现,属合理的领域枚举硬编码,无需修复。

### 42. `equipmentTypeDetailMap`

- 类型:object(25 条)
- 导出文件:`src/combatsimulator/data/equipmentTypeDetailMap.json`
- 说明:装备类型(25 个槽位类型,含 itemLocationHrid 关联)。
- 分析状态:已导出/已分析
- **分析结论(2026-08-17):构建期核心消费。** `scripts/build-game-data-index.mjs` 用它把物品的 `equipmentDetail.type` 解析成槽位名:武器类(main_hand/two_hand)硬编码归入 `weapon`(行 97-100 WEAPON_EQUIPMENT_TYPE_HRIDS),其余靠 `itemLocationHrid` 后缀匹配 `EQUIPMENT_SLOT_KEYS`(行 106-111,13 个槽位 = build 脚本硬编码列表);
- 消费内容:hrid、itemLocationHrid(槽位映射);`name`/`sortIndex` 未在构建期消费(UI 名称走翻译 `equipmentTypeNames`,见 `useGameDataText.js` 与 official-translation-sync 配置)。
- 运行期:组合模拟器不 import 本 map;装备槽位由 `EQUIPMENT_SLOT_KEYS`(源自 gameDataIndex metadata,由本 map 构建)统一驱动。
- 结论:**数据驱动合理**;唯一脆弱点是 EQUIPMENT_SLOT_KEYS 13 槽列表在 build 脚本里硬编码,但槽位集合是稳定的领域枚举(与 actionType 同款,已达成共识不消除),官方新增槽位需手动同步。
- 修复优先级:低

### 43. `guildBuffDetailMap`

- 类型:object(10 条)
- 导出文件:`src/combatsimulator/data/guildBuffDetailMap.json`
- 说明:公会 Buff(5 属性 × 战斗/技能,经圣坛升级,`shared/guildBuffs.js` 消费)。
- 分析状态:已导出/已分析
- **分析结论(2026-08-17):核心消费。** `shared/guildBuffs.js`(第 1 行直接 import)消费 hrid、isCombat(过滤 combatGuildBuffHrids,判定是核心绑定:`normalizeGuildBuffLevels` 只归一 10 个中的 5 个 combat)、sortIndex(对 5 个战斗公会 Buff 排序)、shrineHrid(经 guildShrineDetailMap.maxLevel 定级)、levelCosts(取 max level 作为该 buff 等级上限);
- buffs 数组(每条含 typeHrid/ratioBoost/ratioBoostLevelBonus/flatBoost/flatBoostLevelBonus,圣坛每级加成模板)经 `simulationExtraBuffs`/guildBuff 应用,是数值核心;地牢/迷宫缩放相关见 monster.js。
- 未消费:`levelCosts` 各等级中的 guildTokenCost/creditCosts 成本值(当前只读取等级键来确定等级上限,不计算公会升级成本)。
- **修订(2026-09-02)**:上一行「不计算公会升级成本」结论已失效:本变更 `assetScoreService.js` 的「战斗神龛」分项计算圣坛已投入,`sumGuildBuffInvestment` 经 `shared/guildBuffs.js` 构建的 `guildBuffDetailIndex` 逐级读取 `levelCosts` 的 `creditCosts`(L1203-1217)与 `guildTokenCost`(L1222-1229,令牌按兑换信用点最大路线价值计入),经获取成本链折算金币。
- 修复优先级:低

### 44. `guildShrineDetailMap`

- 类型:object(5 条)
- 导出文件:`src/combatsimulator/data/guildShrineDetailMap.json`
- 说明:公会圣坛(等级上限/点成本,`shared/guildBuffs.js` 消费)。
- 分析状态:已导出/已分析
- **分析结论(2026-08-17):核心消费。** `shared/guildBuffs.js`(第 2 行直接 import)消费 hrid、maxLevel(圣坛等级上限,`getGuildBuffMaxLevel` 用它 clamp 公会 buff 等级)、name(getGuildShrineName 兜底显示);
- 未消费:`guildPointCosts`(升级消耗,模拟器只建模"等级上限"不建模"积分解锁进度")、`sortIndex`。
- 修复优先级:低

### 45. `houseRoomDetailMap`

- 类型:object(17 条)
- 导出文件:`src/combatsimulator/data/houseRoomDetailMap.json`
- 说明:住宅房间(含 `house_*_level` 技能等级 buff)。
- 分析状态:已导出/已分析
- **分析结论(2026-08-17):核心数值消费。**
  - `combatsimulator/houseRoom.js`(第 2 行直接 import):按 hrid 读 `actionBuffs`+`globalBuffs`,每个 buff 用 `new Buff(actionBuff, level)` 按房间等级缩放,战斗模拟真实应用房间加成(弓箭场/观察塔等,`combatUnit.js` 遍历 houseRooms.buffs 无差别应用);
  - `build-game-data-index.mjs` createHouseRoomIndex(435-471):消费 hrid/name/sortIndex/upgradeCostsMap → houseRoomDetailIndex/houseRoomHrids/houseRoomOptions(UI 展示与排序);另有 768-779 行从 globalBuffs 提取 `/buff_types/wisdom` 作全局经验 buff(强化侧);
  - `simulationDomain.js` buildHouseRoomUpgradeCostPreview:消费 `upgradeCostsMap`(每级材料成本)做市场价值预估。
- **复核记录(2026-08-17):文件归属修正。** `buildHouseRoomUpgradeCostPreview` 实际定义在 `services/queueUpgradeCost.js:514`(非 `simulationDomain.js`);`simulationDomain.js` 对 houseRoom 零引用(grep `houseRoom`/`upgradeCostsMap` 在该文件 0 匹配)。`queueUpgradeCost.js:693` 调用它做升级成本预估。功能描述无误,仅文件路径需修正。消费链路(17 条 `houseRoomDetailMap` + `upgradeCostsMap`)与数据驱动性质确认无误。
- 未消费:`skillHrid`(房间关联技能)、`usableInActionTypeMap`(actionBuffs 的用途白名单,模拟器对 combat 无差别应用)、name 兜底(UI 优先走翻译 `houseRoomNames`)。
- **修订(2026-09-02)**:上一行「`usableInActionTypeMap` 未消费」已失效:本变更 `assetScoreService.js` 的「战斗房屋」分项以 `isCombatHouseRoomDetail`(L1300)读取 `usableInActionTypeMap['/action_types/combat']` 作为战斗房间唯一过滤源——计算侧过滤(L1340)后逐房间计投入(L1347),签名侧以同谓词覆盖(L1275);生成索引已精简该字段,故直读原始表(L21-23 注释)。`skillHrid` 与 name 兜底结论不变。
- 修复优先级:低

### 46. `itemCategoryDetailMap`

- 类型:object(10 条)
- 导出文件:`src/combatsimulator/data/itemCategoryDetailMap.json`
- 说明:物品分类(名称/复数名)。
- 分析状态:已导出/已分析
- **分析结论(2026-08-17):名称字典。** `shared/gameDataIndex.js`(第 3 行直接 import)→ itemCategoryDetailIndex → `getItemCategoryName`(仅 name),UI 使用:QueuePage 食品/饮品名、SettingsPage 类别统计(useGameDataText 优先走翻译 `itemCategoryNames`,本 map 名称作兜底);分类判定本身用硬编码 HRID 常量(`/item_categories/food` 等,combatScrolls.js/simulatorStore.js/importExportMapper.js),不查此表。
- 未消费:`pluralName`、`sortIndex`。
- 修复优先级:低

### 47. `itemDetailMap`

- 类型:object(957 条)
- 导出文件:`src/combatsimulator/data/itemDetailMap.json`
- 说明:物品定义(全量,含 sellPrice/equipmentDetail 等)。
- 分析状态:已导出/已分析
- **分析结论(2026-08-17):最大核心表,三来源全链路消费。** 字段分布:hrid/name/description/categoryHrid/sellPrice/sortIndex 全 957;alchemyDetail 918、itemLevel 886、isTradable 872、guildCreditConversions 837、enhancementCosts+equipmentDetail 532、protectionItemHrids 159、consumableDetail 92、abilityBookDetail 56、baseItemHrids 38、isOpenable 34、scrollDetail 12、openKeyItemHrid 8、isUncollectable 1。
- 消费面:
  - `combatsimulator/equipment.js` + `consumable.js`(直接 import 全量):equipmentDetail.combatStats(5 项战斗属性)/combatEnhancementBonuses(强化加成乘表)/type(槽位);consumableDetail(cooldownDuration/hitpointRestore/manapointRestore/recoveryDuration/buffs/defaultCombatTriggers)+categoryHrid(食物/饮品判定);
  - build 脚本 createItemIndex:name/categoryHrid/itemLevel/equipmentDetail.type/sellPrice/enhancementCosts/consumableDetail/abilityBookDetail → itemDetailIndex + itemVendorPriceByHrid + equipmentBySlot + 食物/饮品 options + abilityBookInfoByAbilityHrid(→ marketPriceService/queueUpgradeCost/pricing/UI 命名);
  - 强化数据构建 `createEnhancementCatalogItem`(`build-game-data-index.mjs:651-660`)将 `sortIndex` 写入强化目录;`compareCatalogItems`(753-760)与 `enhancementStore.js:343-346`据此排序强化物品列表;
  - 强化链路:enhancementSimulator.js 消费 isTradable(市场货源判定)、protectionItemHrids(保护物品白名单,经 build 收集)、baseItemHrids(合成基材)、openable.openKeyItemHrid(开箱钥匙成本);enhancementStore 消费 protectionItemHrids/baseItemHrids(UI);
  - 战斗卷轴:combatScrolls.js 消费 scrollDetail.personalBuffTypeHrid(12 个 scroll 物品)。
- 未消费/说明:`description`、`alchemyDetail`(炼金分解/转化,918 条中仅 build 提取 decomposeItems 供强化,transmuteDropTable/成功率未建模)、`guildCreditConversions`(公会信用点兑换)、`isUncollectable`(仅 1 条 bag_of_10_cowbells)、`openKeyItemHrid` 仅强化链路用(build 593 与 enhancementSimulator)。
- **修订(2026-09-02)**:上一行「`guildCreditConversions` 未消费」已失效:本变更 `assetScoreService.js` 为神龛等不可交易资产的「获取成本」兜底直读原始表的 `guildCreditConversions`(全表遍历 L1087-1089、guild_token 专项 L1139-1140;生成索引已精简该字段);另 `isTradable` 新增其交易门控读取(L564)、`abilityBookInfoByAbilityHrid` 消费方新增 `assetScoreService`(技能书分项,L1365/L1429)。其余字段结论不变。
- 修复优先级:低
- **复核记录(2026-08-17):无需修复,补充说明。** 消费链路确认无误(itemDetailMap 957 条 + build 投影全链路)。补充原文未提及的市场硬编码:`marketPriceService.js` 的 `getMarketSaleFeeRate`(bag_of_10_cowbells 18%、其他 5%,第 15-21 行)与 `TREASURE_CHEST_HRIDS`(宝箱 hrid 列表,第 46 行,用于 `computeChestExpectedValue` 市场估值)。这些是**费率/估值链路**硬编码,不在 `itemDetailMap` 数据中(官方数据无费率字段),属合理自建;`BAG_OF_10_COWBELLS_HRID` 常量与官方 `itemDetailMap` 中 `/items/bag_of_10_cowbells`(isUncollectable=true,唯一 1 条)对应。不构成数据漂移风险。

### 48. `itemLocationDetailMap`

- 类型:object(26 条)
- 导出文件:`src/combatsimulator/data/itemLocationDetailMap.json`
- 说明:物品位置(装备槽位/工具/背包/仓库,含 type 与冲突规则)。
- 分析状态:已导出/已分析
- **分析结论(2026-08-17):轻量消费。** `importExportMapper.js`(第 7 行直接 import)读 `type` 判定装备位置(`/item_location_types/equipment`,第 71 行),用于导入时把玩家物品归类到装备槽;槽位后缀本身(如 `/item_locations/head` → head)在 build 脚本 resolveEquipmentSlotName、skillingImportMapper、enhancementImportMapper 中从 HRID 字符串切分,不查本表。
- 未消费:`name`(UI 走 `getEquipmentTypeName`)、`isTool`、`isMultiItem`、`conflictingOtherItemLocationHrids`(冲突规则,导入/初始化模拟器无多槽冲突建模)。
- 修复优先级:低

### 49. `labyrinthCrateDetailMap`

- 类型:object(9 条)
- 导出文件:`src/combatsimulator/data/labyrinthCrateDetailMap.json`
- 说明:迷宫补给箱 buff(咖啡/食物/茶,每箱若干 buff 数组)。
- 分析状态:已导出/已分析
- **分析结论(2026-08-17):核心数值消费。** `combatsimulator/labyrinth.js`(第 2 行直接 import)在迷宫楼层按 crate hrid 取 buff 数组并作为 `zoneBuffs` 应用;`combatUnit.addPermanentBuff()` 按 `typeHrid` 合并 `flatBoost` 与 `ratioBoost`,随后参与属性计算。当前 9 个箱共 82 条 buff 模板,其中 73 条有非零 `flatBoost`、9 条有非零 `ratioBoost`;`build-game-data-index.mjs` 生成 `labyrinthCrates` options(含 LABYRINTH_*_CRATE_HRIDS,经 build 硬编码分组),simulationDomain/labyrinthConfig/simulatorStore/HomePage UI 全链路依赖。
- 未消费:`uniqueHrid`(迷宫箱路径按 `typeHrid` 合并,不按 uniqueHrid 去重)、`ratioBoostLevelBonus`、`flatBoostLevelBonus`、`startTime`、`duration`(当前等级加成与 duration 均为 0,迷宫箱作为永久区域 Buff 应用)。
- 修复优先级:低

### 50. `openableLootDropMap`

- 类型:object(22 条)
- 导出文件:`src/combatsimulator/data/openableLootDropMap.json`
- 说明:可开启物品(宝箱/箱/礼包)的掉落表(235 条掉落条目)。
- 分析状态:已导出/已分析
- **分析结论(2026-08-17):两个子集被消费,共 6/22 个条目。**
  - 市场估值:`marketPriceService.js:46-50,164-187` 只处理 `TREASURE_CHEST_HRIDS` 中 3 个宝箱(`/items/small_treasure_chest`、`medium_treasure_chest`、`large_treasure_chest`),按 dropRate × 平均数量 × 物品单价计算 ask/bid/vendor 期望值。
  - 强化获取:`build-game-data-index.mjs:534-619` 只把地下城奖励来源与非交易强化物品掉落相交,当前生成 3 个 openable(`/items/chimerical_chest`、`enchanted_chest`、`sinister_chest`);`enhancementSimulator.js:826-923` 用其掉落率、数量及其他掉落价值估算获取成本。
- 未消费:其余 16 个掉落表当前不进入市场估值或强化获取链路。开箱钥匙 `openKeyItemHrid` 不属于本 map 字段,强化索引从 `itemDetailMap` 读取(见 47)。
- 修复优先级:低

### 51. `personalBuffTypeDetailMap`

- 类型:object(12 条)
- 导出文件:`src/combatsimulator/data/personalBuffTypeDetailMap.json`
- 说明:个人 Buff 类型(战斗卷轴授予的时限 buff,含 usableInActionTypeMap 与 buff 模板)。
- 分析状态:已导出/已分析
- **分析结论(2026-08-17):战斗卷轴核心消费。** `build-game-data-index.mjs` 生成 `personalBuffTypeDetailIndex` 投影;`shared/combatScrolls.js`(第 6 行)消费 `usableInActionTypeMap[COMBAT_ACTION_TYPE_HRID]`(过滤战斗可用卷轴,数据驱动 join:个人 buff 中仅战斗可用者成为卷轴选项)、`buff` 模板(normalizeBuffTemplate 全字段:uniqueHrid/typeHrid/ratioBoost/flatBoost/duration 等,并校验 duration 与硬编码默认 30 分钟一致,若官方改时长会告警但仍用数据值——数据权威)、`name`(卷轴名兜底)、`sortIndex`(排序,优先于 item.sortIndex);
- `combatScrollBuff.js` 用 personalBuff.buff 授予时限增益;UI(HomePage 2126)按 typeHrid 展示。
- 未消费:无(除 duration 静态默认的对比告警外全字段消费)。
- 修复优先级:低

### 52. `skillDetailMap`

- 类型:object(18 条)
- 导出文件:`src/combatsimulator/data/skillDetailMap.json`
- 说明:技能定义(7 战斗 + 10 生活技能 + 1 total_level,含 isSkilling/isCombat)。
- 分析状态:已导出/已分析
- **分析结论(2026-08-17):名称字典。** `shared/gameDataIndex.js`(第 4 行直接 import)→ skillDetailIndex → `getSkillName`(仅 name),UI 广泛使用(HomePage/QueuePage/SkillingPage/EnhancementPage/SimulationResultsView 等);useGameDataText 优先走翻译 `skillNames`,本 map 名称作兜底。
- 未消费:`isSkilling`/`isCombat`(战斗/生活技能划分在代码里用硬编码 HRID 集合,如 build 脚本 SKILLING_ACTION_TYPE_HRIDS、LEVEL_KEYS;skillDetailMap 的布尔标记不参与判定)、`sortIndex`。
- **二次复核(2026-08-17):描述修正。** 原文"6 战斗 + 12 生活技能"不准确。复查官方数据 18 条:`isCombat=true` 7 条、`isSkilling=true` 10 条、**1 条 `/skills/total_level` 两者均为 false**(既非战斗也非生活,是总等级汇总条目)。7+10+1=18。修复优先级:低(仅描述修正,代码消费不受影响——total_level 不在任何战斗/生活逻辑中)。
- 修复优先级:低

### 53. `abilitySlotsLevelRequirementList`

- 类型:array(6 元素)
- 导出文件:`src/combatsimulator/data/abilitySlotsLevelRequirementList.json`
- 说明:能力槽位等级需求表(`[0,1,1,20,50,90]`)。
- 分析状态:已导出/已分析
- **分析结论(2026-08-17):核心消费。** `playerMapper.js`(第 11 行直接 import,674 行)对 5 个能力槽逐个校验 `intelligenceLevel >= abilitySlotsLevelRequirementList[i+1]`(槽位 1-5 分别需 1/1/20/50/90 智力)才能装载该槽能力;索引 0 元素(0)不使用——数组按"槽位下标+1"语义,官方若改槽位数需同步循环上限(当前硬编码 5)。
- 修复优先级:低

### 54. `enhancementLevelSuccessRateTable`

- 类型:array(20 元素)
- 导出文件:`src/combatsimulator/data/enhancementLevelSuccessRateTable.json`
- 说明:强化等级成功率表(0-19 级:50% 递减至 30%)。
- 分析状态:已导出/已分析
- **分析结论(2026-08-17):核心消费。** `build-game-data-index.mjs` normalizeNumberTable(475-480) 生成 `enhancementData.successRates` 投影;`enhancementSimulator.js` normalizeSuccessRates(558-575) 按强化等级取值,强化成功率模拟核心。共享层经 gameDataIndex 投影,单向依赖。
- 修复优先级:低

### 55. `enhancementLevelTotalBonusMultiplierTable`

- 类型:array(21 元素)
- 导出文件:`src/combatsimulator/data/enhancementLevelTotalBonusMultiplierTable.json`
- 说明:强化等级总加成倍率表(0-20 级:0 → 50)。
- 分析状态:已导出/已分析
- **分析结论(2026-08-17):核心消费。** `combatsimulator/equipment.js`(第 2 行直接 import)按强化等级取倍率,`getCombatStat` 用 `stat + multiplier × combatEnhancementBonuses[combatStat]` 计算强化后属性(战斗模拟装备数值核心);build 脚本 normalizeNumberTable 生成 `totalBonusMultipliers` 投影供 enhancementSimulator 等使用。
- 修复优先级:低

### 56. `levelExperienceTable`

- 类型:array(201 元素)
- 导出文件:`src/combatsimulator/data/levelExperienceTable.json`
- 说明:等级经验阈值表(0-200 级,索引=等级,末值 1000 亿)。
- 分析状态:已导出/已分析
- **分析结论(2026-08-17):核心消费。** 两处:build 脚本投影为 `levelExperienceTable` → gameDataIndex(40 行)→ `skillingPlanner.js`(SKILLING_MAX_LEVEL = length-1 = 200、skillLevelForExperience 经验→等级转换、升级阈值计算)与 `levelExperience.js`(第 1 行直接 import,战斗经验等级换算)、`simulatorPricingActions`(bundled 表注入 window.jigsLevelExperienceTable 供价格参考,MulitResultsPage/QueuePage 读取展示)。
- **修订(2026-09-02)**:消费方新增 `assetScoreService.js`(L19 直接 import):「技能书」分项按 MWITools `calculateAbilityScore` 口径,以等级累计经验折算所需技能书数量并计价(L1424-1432)。
- 修复优先级:低

## 使用说明

- 对某个 key 完成分析后,更新上方概览表中对应行的"分析状态"列。
- 若确认有用并需要接入,可将其加入 `scripts/game-data-targets.js` 的 `DEFAULT_TRACKED_GAME_DATA_FILES`,运行 `npm run extract-game-data -- --input tmp/initClientData.txt` 重新导出,并更新本文档状态为「有用(已接入)」。
- 若确认无用,将状态标记为「无用(暂不接入)」并简要说明原因。

## 参考

- [`docs/game-data.md`](./game-data.md):游戏数据来源、刷新方法与维护文件列表。
- `scripts/extract-game-data.js` / `scripts/game-data-targets.js`:解析与导出逻辑。

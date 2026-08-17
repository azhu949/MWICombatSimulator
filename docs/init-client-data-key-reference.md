# initClientData 顶层 Key 参考

本文档记录 `init_client_data` 载荷中**尚未被 `scripts/extract-game-data.js` 解析(未导出)**的顶层 key,用于逐个评估它们对模拟器是否有用。

- 源文件:`tmp/initClientData.txt`(游戏版本 `v1.20260814.0`,2026-08-14 发布)
- 已解析(已导出到 `src/combatsimulator/data`)的 27 个 key 不在此列,请参考 [`docs/game-data.md`](./game-data.md)。
- 分析状态列用于标记每个 key 的评估结论:待分析 / 有用(已接入)/ 无用(暂不接入)。

## 概览

| # | Key | 类型 | 条目数 | 分析状态 |
|---|-----|------|--------|----------|
| 1 | `type` | string | — | 无用（不接入）|
| 2 | `gameVersion` | string | — | 无用（不接入）|
| 3 | `versionTimestamp` | string | — | 无用（不接入）|
| 4 | `currentTimestamp` | string | — | 无用（不接入）|
| 5 | `gameModeDetailMap` | object | 3 | 无用（不接入）|
| 6 | `marketplaceLimits` | object | 8 字段 | 无用（不接入）|
| 7 | `randomTaskTypeDetailMap` | object | 9 | 无用（不接入）|
| 8 | `taskShopItemDetailMap` | object | 4 | 无用（不接入）|
| 9 | `shopCategoryDetailMap` | object | 2 | 无用（不接入）|
| 10 | `shopItemDetailMap` | object | 62 | 无用（不接入）|
| 11 | `actionTypeDetailMap` | object | 13 | 无用（不接入）|
| 12 | `actionCategoryDetailMap` | object | 65 | 无用（不接入）|
| 13 | `purchaseBundleDetailMap` | object | 14 | 无用（不接入）|
| 14 | `supporterPointExchangeDetailMap` | object | 2 | 无用（不接入）|
| 15 | `buyableUpgradeDetailMap` | object | 25 | 无用（不接入）|
| 16 | `chatIconDetailMap` | object | 502 | 无用（不接入）|
| 17 | `nameColorDetailMap` | object | 184 | 无用（不接入）|
| 18 | `avatarDetailMap` | object | 99 | 无用（不接入）|
| 19 | `avatarOutfitDetailMap` | object | 122 | 无用（不接入）|
| 20 | `avatarBackgroundDetailMap` | object | 7 | 无用（不接入）|
| 21 | `avatarBorderDetailMap` | object | 7 | 无用（不接入）|
| 22 | `chatChannelTypeDetailMap` | object | 20 | 无用（不接入）|
| 23 | `guildCharacterRoleDetailMap` | object | 4 | 无用（不接入）|
| 24 | `guildTrialDetailMap` | object | 15 | 无用（不接入）|
| 25 | `guildBuildingDetailMap` | object | 23 | 无用（不接入）|
| 26 | `leaderboardTypeDetailMap` | object | 5 | 无用（不接入）|
| 27 | `leaderboardCategoryDetailMap` | object | 30 | 无用（不接入）|
| 28 | `labyrinthShopItemDetailMap` | object | 21 | 无用（不接入）|
| 29 | `keys` | array | 101 | 无用（不接入）|

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

### 29. `keys`

- 类型:array(101 个元素)
- 元素示例:`"addEventListener"`、`"alert"`、`"window"` 等
- 说明:JS 关键字/浏览器 API 列表(游戏引擎注入列表)。
- **分析结论(2026-08-17):无用,不接入。** 经核对,该数组元素全部为 JS 语言关键字与浏览器 API 名(alert、addEventListener、window 等),是游戏引擎的注入/保留字列表,与游戏数据无关,可忽略。

## 使用说明

- 对某个 key 完成分析后,更新上方概览表中对应行的"分析状态"列。
- 若确认有用并需要接入,可将其加入 `scripts/game-data-targets.js` 的 `DEFAULT_TRACKED_GAME_DATA_FILES`,运行 `npm run extract-game-data -- --input tmp/initClientData.txt` 重新导出,并更新本文档状态为「有用(已接入)」。
- 若确认无用,将状态标记为「无用(暂不接入)」并简要说明原因。

## 参考

- [`docs/game-data.md`](./game-data.md):游戏数据来源、刷新方法与维护文件列表。
- `scripts/extract-game-data.js` / `scripts/game-data-targets.js`:解析与导出逻辑。
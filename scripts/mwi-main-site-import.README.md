# MWI Combat Simulator 主站导入脚本

Tampermonkey 脚本，用于把 Milky Way Idle 主站数据导入 MWI Combat Simulator。

## 安装

推荐从**模拟器站点自身**安装（国内可直接访问）：

1. 打开模拟器，点右下角侧栏的「未安装导入脚本」或首页「导入/导出」弹窗里的「安装脚本」。
2. 若脚本管理器没有自动弹出安装页，直接下载站点上的
   [`userscript/mwi-main-site-import.user.js`](../../public/userscript/mwi-main-site-import.user.js)
   并在 Tampermonkey 里「添加新脚本」粘贴内容。

侧栏检测到「导入脚本待更新 / 可更新」时不会直接跳转，而是先弹出渠道选择：可以选
**站点下载**（推荐，国内可用）或 **GreasyFork（海外备用）**，由用户决定从哪个来源更新。

海外用户或站点不可用时，可改用 [GreasyFork](https://greasyfork.org/zh-CN/scripts/568613-mwi-combat-simulator-%E4%B8%BB%E7%AB%99%E4%B8%80%E9%94%AE%E5%AF%BC%E5%85%A5) 安装。

脚本头部刻意不声明 `@updateURL` / `@downloadURL`：Tampermonkey 在缺少更新指令时会把
「安装来源 URL」记录为更新源。因此从**站点镜像**安装的用户会自动从该镜像检查更新（国内可达，
`userscript/` 已配置不缓存、发版即生效），从 **GreasyFork** 安装的用户自动从 GreasyFork 更新——
两条渠道的自动更新都成立，且不依赖写死的单一地址（站点有 GitHub Pages / Cloudflare Pages 双镜像）。

> 注意：已安装旧版（头部带 GreasyFork 地址）的用户，其 Tampermonkey 更新源仍停留在 GreasyFork
> （脚本管理器不会自动跟随头部变更），需在侧栏「更新渠道」里选一次「站点下载」重新安装，
> 之后才会自动从站点更新。

> 脚本随站点构建一起发布（`scripts/sync-userscript-to-public.mjs` → `public/userscript/`）：
> `npm run dev` / `npm run build` / `npm start` 会**先执行该同步脚本**，因此**改完本文件后重新构建/启动**即可，
> 不需要手动拷贝；GreasyFork 需要手动另行上传。
> 侧栏的「导入脚本 vX.Y.Z / 待更新」正是靠脚本写入的版本标记判断，两处版本务必保持一致。

## 自定义域名 / 自建镜像部署

脚本头部 `@match` 只覆盖官方部署地址（GitHub Pages、Cloudflare Pages）、两个本地开发端口
与 Milky Way Idle 主站。站点部署到其他域名时，脚本管理器不会在该页面注入脚本，因此：

- 侧栏状态行会退化为「导入脚本不适用于当前域名」的中性说明，不再显示「未安装」，
  也不提供安装入口——在本站点装官方分发的脚本不会生效，按原样安装只会陷入
  「下载 → 装上 → 仍报未安装」的循环；
- 首页「导入/导出」弹窗里的安装按钮同样下载官方分发的脚本，不能解决域名不匹配的问题。

自建部署若要使用导入功能，需要**同时**调整脚本的以下两处，并自行分发该副本：

1. 头部 `@match`：补充你的站点地址（含部署子路径，例如
   `// @match        https://example.com/MWICombatSimulator/*`）；
2. `isSimulatorPage()` 的 origin 白名单（脚本内约 1675 行）：把该地址加入，
   否则脚本虽然会写安装标记，但不会注入模拟器页的导入按钮。

模拟器侧可直接把 `VITE_MAIN_SITE_IMPORT_SCRIPT_URL` 指向你自建的脚本地址（见
`src/ui/config/importScriptDistribution.js`），让安装入口下载到这份适配过的副本。
侧栏与安装入口展示的版本 / SHA-256 始终来自**你构建时使用的脚本源文件**，改完脚本后
按 `npm run dev` / `npm run build` 重新构建即可。

## 信任边界

脚本经模拟器站点同源分发（`userscript/mwi-main-site-import.user.js`），并带 Tampermonkey 权限运行在主站页面上，
因此站点静态资源的完整性直接决定了用户装到的是什么。项目为此提供两级可见性：

- 构建期（`scripts/sync-userscript-to-public.mjs`）按字节计算脚本的 SHA-256，写入随站点分发的
  `userscript/mwi-main-site-import.meta.json`，并注入模拟器前端；
- 模拟器「导入/导出」弹窗的安装入口会显示「本站脚本 vX.Y.Z · SHA-256 …」，可与本仓库（或 GreasyFork 页面）
  的同一版本核对；
- 部署流水线另有 `npm run verify-pages-build`，独立复算并断言 `dist/userscript/` 副本与 `scripts/` 源文件
  逐字节一致、meta 的版本与校验值与之匹配。

需要明确的边界：站点资源与展示的校验值出自同一次构建，它们只能用来发现「分发内容与发布内容不一致」，
不能替代对发布方本身的信任。GreasyFork 是等价可切换的来源（安装入口同时保留），两者版本号保持一致。

## 使用

1. 打开并登录一个 Milky Way Idle 主站标签页（`.com` 或 `.cn`）。
2. 打开模拟器的 `Home`、`Enhancement` 或 `Skilling` 页面。
3. 点击对应的导入按钮。

队伍导入前，需要先在主站手动打开队友资料，让脚本缓存队友 profile。

## 导入内容

`Home` 页面：

- 当前角色，或已缓存的队伍成员（最多 5 人）
- 等级、装备、食物、饮品、技能、触发器、房间和成就
- 官方估算市场价值快照（`marketItemValues`），用于模拟器的资产分（Gear Score）取价链，随每次导入载荷透传，主站打开期间持续更新。快照按三源合并构建：WS `market_item_values_updated` 全量快照与 localStorage 键 `marketItemValues`（主站登录即写入的全量官方估算，主通道）按物品/等级粒度合并——**已捕获的 WS 值优先，localStorage 补缺**；`game_data/marketplace.json` 合成中价兜底（仅官方估算整体为空时拉取）。合并/拉取时机：脚本启动时一次，此后每次导入请求经 `ensureMarketEstimatesFresh` 惰性合并/按需补拉（非定时器周期）；合成行情 fetch 失败后下次导入请求自然重试（退避 = 导入频率），成功后 6 小时内节流。载荷来源为合成中价时，导入反馈会如实标注（`marketEstimateSource` 字段 + 「合成中价估值已透传」文案）；模拟器侧同链消费——tooltip / 可复制明细对 synthetic 命中件标「合成中价」（与官方估算标签区分）、导入弹窗反馈同步切换「合成中价估值」文案，无标记的旧载荷/复制粘贴载荷按官方估算显示（向后兼容）。【一般-5】（2026-09-02）混合物品（官方估算仅覆盖部分等级）的等级级来源由 `syntheticLevelKeys` 字段表达：`{ [itemHrid]: [levelKey, ...] }`，仅列出该物品中由合成行情补齐（官方缓存未覆盖）的等级键；仅载荷级标记为 official 时挂载、非空才附（旧版模拟器忽略未知字段，向后兼容）。模拟器侧据此在 `marketItemValueSourcesByLevel` 建立等级级来源覆盖，tooltip / 可复制明细对合成补齐等级如实标「合成中价」，其余等级仍标「官方估算」
- 当前角色与已缓存队友均导入实际生效的公会神龛战斗增益（当前角色由已购等级结合公会神龛等级计算；队友由主站分享资料直接下发 `guildBuffLevelMap`）
- 队友的 `guildBuffLevelMap` 即其实际拥有的增益等级：map 中缺失的战斗增益按 0 处理（空 map `{}` = 未拥有任何增益，导入时会覆盖当前角色上对应的手动配置）；仅当分享资料整体缺少该字段时才保留当前角色已有的手动配置
- 当前战斗区域、地下城和难度

`Enhancement` 页面：

- 强化等级
- 强化装备及强化等级
- 强化饮品
- 房间等级
- 社区 Buff 等级
- Novice / Champion 成就加成

强化装备会同时读取穿戴栏和背包：优先穿戴装备；没有穿戴装备时，选择背包中等级最高的同槽装备。

`Skilling` 页面：

- 当前角色采摘及五项制作技能的等级与累计经验
- 背包材料、背包及当前穿戴中的生活技能装备和强化等级
- 住宅、社区、成就、卷轴与 MooPass 的当前生活技能 Buff

生活技能页只导入当前角色。导入会替换工作台中的角色快照，并把六项目标重置为当前等级加 1；市场价格与手工覆盖价保持不变。

## 注意

- 安装或更新脚本后，刷新主站和模拟器标签页。
- 队伍成员只会导入已手动打开并缓存的资料，不会自动抓取队友。
- 强化页只导入当前角色，不会覆盖目标物品、强化区间、价格、预算或风险参数；角色数据仅在当前页面会话有效，刷新后需重新导入。
- 生活技能页只导入当前角色，不会导入或切换缓存队伍成员；角色快照仅在当前页面会话有效，刷新后需重新导入。
- 需要至少保留一个已登录的主站标签页；脚本不调用游戏写接口。
- 如果提示等待主站或页面响应超时，先确认脚本已在两个页面启用并刷新页面。

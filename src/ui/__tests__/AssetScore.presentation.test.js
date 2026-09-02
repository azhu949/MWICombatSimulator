import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 资产分 UI 接线的源码级断言（轻量，替代重量级组件挂载测试）：
// 徽章必须绑定 player.assetScore 且位于名称输入框之外；
// 下拉标签与 tooltip 均引用资产分格式化函数；locales 文案双语齐全。
// 行为级断言（徽章按快照有无渲染/面板开关/复制成功失败反馈）见 appShellBehavior.test.js。

function readSource(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('资产分 UI 接线', () => {
  it('PlayerCardsStrip（顶栏）：徽章绑定 player.assetScore，且不写入名称输入框', () => {
    const source = readSource('../components/PlayerCardsStrip.vue');
    expect(source).toContain('v-if="player.assetScore"');
    expect(source).toContain(':title="buildAssetScoreTooltip(player.assetScore)"');
    expect(source).toContain('formatAssetScoreLabel(player.assetScore)');
    // 名称输入框仍是纯 v-model，未被资产分污染。
    expect(source).toContain('v-model="player.name"');
    expect(source).not.toContain('v-model="player.name +');
  });

  it('PlayerCardsStrip（顶栏）：点击徽章打开可复制明细面板（文本可选中 + 复制按钮）', () => {
    const source = readSource('../components/PlayerCardsStrip.vue');
    expect(source).toContain('@click.stop="toggleAssetScoreDetails(player)"');
    // 面板 Teleport 到 body（玩家卡片在 overflow 滚动容器内，absolute 会被裁剪）。
    expect(source).toContain('<Teleport to="body">');
    expect(source).toContain('buildAssetScoreDetailsText(assetScoreDetailsPlayer.assetScore)');
    expect(source).toContain('copyAssetScoreDetails(assetScoreDetailsPlayer.assetScore)');
    // 明细文本可选中（select-text），复制走剪贴板 API。
    expect(source).toContain('select-text');
    expect(source).toContain('navigator.clipboard.writeText');
    // 点击外部/Esc 关闭。
    expect(source).toContain("window.addEventListener('click'");
    expect(source).toContain("event.key === 'Escape'");
  });

  it('PlayerCardsStrip（顶栏）：面板坐标随滚动/缩放跟随（scroll capture + resize）', () => {
    const source = readSource('../components/PlayerCardsStrip.vue');
    // fixed 面板不能只算一次坐标：scroll 事件不冒泡，必须 capture 注册才能捕获
    // overflow-x-auto 容器的横向滚动；resize 覆盖窗口尺寸变化与浏览器缩放。
    expect(source).toContain("window.addEventListener('scroll', scheduleAssetScoreDetailsPositionUpdate, true)");
    expect(source).toContain("window.addEventListener('resize', scheduleAssetScoreDetailsPositionUpdate)");
    // 注销与注册的 capture 标志一致；rAF 合帧重算并在组件卸载时取消，避免泄漏。
    expect(source).toContain("window.removeEventListener('scroll', scheduleAssetScoreDetailsPositionUpdate, true)");
    expect(source).toContain("window.removeEventListener('resize', scheduleAssetScoreDetailsPositionUpdate)");
    expect(source).toContain('window.requestAnimationFrame');
    expect(source).toContain('window.cancelAnimationFrame');
  });

  it('HomeSimulationPanel：玩家选择下拉包含资产分后缀', () => {
    const source = readSource('../components/home/HomeSimulationPanel.vue');
    expect(source).toContain('formatAssetScoreLabel');
    expect(source).toContain('assetScoreText');
  });

  it('HomeImportExportModal：导入目标下拉包含资产分后缀', () => {
    const source = readSource('../components/home/HomeImportExportModal.vue');
    expect(source).toContain('playerAssetScoreLabel(player)');
    expect(source).toContain('formatAssetScoreLabel');
    // 空名玩家兜底 `Player ${id}`（对齐 HomeSimulationPanel 写法），防裸「 · 9,534」前导分隔符。
    expect(source).toContain("`Player ${player?.id || ''}`");
  });

  it('locales：资产分文案 zh/en 双语齐全', () => {
    const zh = readSource('../../../locales/zh/common.json');
    const en = readSource('../../../locales/en/common.json');
    expect(zh).toContain('"assetScoreTitle": "资产分"');
    expect(zh).toContain('"assetScoreSourceCost": "成本法"');
    expect(zh).toContain('"assetScoreDetailsTitle": "资产分明细（可复制）"');
    expect(zh).toContain('"assetScoreCopy": "复制"');
    expect(zh).toContain('"assetScoreCopied": "已复制"');
    expect(zh).toContain('"assetScoreCopyFailed": "复制失败"');
    expect(zh).toContain('"assetScoreTotal": "合计"');
    expect(zh).toContain('"assetScoreIncomplete": "缺失（按 0 计）"');
    expect(zh).toContain('"msgImportOfficialEstimates": "官方估值：{{count}} 个物品。"');
    // N5 联动：合成中价来源标签（tooltip/明细）与导入反馈文案（与脚本状态栏一致）。
    expect(zh).toContain('"assetScoreSourceSynthetic": "合成中价"');
    expect(zh).toContain(
      '"msgImportSyntheticEstimates": "合成中价估值：{{count}} 个物品（非官方估算，与 MWITools 口径或有 4-5% 偏差）。"',
    );
    expect(zh).toContain(
      '"msgImportMixedEstimates": "官方估值：{{officialCount}} 个物品 + 合成中价估值：{{syntheticCount}} 个物品（合成部分非官方估算，与 MWITools 口径或有 4-5% 偏差）。"',
    );
    expect(en).toContain('"assetScoreTitle": "Gear Score"');
    expect(en).toContain('"assetScoreSourceCost": "Cost-based"');
    expect(en).toContain('"assetScoreDetailsTitle": "Gear Score details (copyable)"');
    expect(en).toContain('"assetScoreCopy": "Copy"');
    expect(en).toContain('"assetScoreCopied": "Copied"');
    expect(en).toContain('"assetScoreCopyFailed": "Copy failed"');
    expect(en).toContain('"assetScoreTotal": "Total"');
    expect(en).toContain('"assetScoreIncomplete": "Incomplete (counted as 0)"');
    expect(en).toContain('"msgImportOfficialEstimates": "Official estimates: {{count}} items."');
    expect(en).toContain('"assetScoreSourceSynthetic": "Synthetic mid"');
    expect(en).toContain(
      '"msgImportSyntheticEstimates": "Synthetic mid-price estimates: {{count}} items (not official; may differ from MWITools by ~4-5%)."',
    );
    expect(en).toContain(
      '"msgImportMixedEstimates": "Official estimates: {{officialCount}} items + synthetic mid-price estimates: {{syntheticCount}} items (synthetic part not official; may differ from MWITools by ~4-5%)."',
    );
  });

  it('PlayerCardsStrip：明细面板标签全部走 i18n（无硬编码中文）', () => {
    const source = readSource('../components/PlayerCardsStrip.vue');
    const start = source.indexOf('function buildAssetScoreDetailsText');
    const end = source.indexOf('async function copyAssetScoreDetails');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    // 函数体内（不含函数上方的中文注释）不允许再出现裸中文字符串字面量：
    // 合计/装备/房屋/技能书/神龛/装备明细六处标签必须经 t() 解析（2026-08-31 U1）。
    expect(/[\u4e00-\u9fff]/.test(source.slice(start, end))).toBe(false);
  });

  it('PlayerCardsStrip：tooltip 标注缺失分项（incomplete 接线）', () => {
    const source = readSource('../components/PlayerCardsStrip.vue');
    // T3（2026-08-31）：从 service 行数据派生 incomplete，缺失分项提示行走 i18n。
    expect(source).toContain("t('common:vue.home.assetScoreIncomplete'");
    expect(source).toContain('row?.incomplete === true');
  });

  it('PlayerCardsStrip：tooltip 与可复制明细面板共用缺失分项标注（两侧接线防漂移）', () => {
    const source = readSource('../components/PlayerCardsStrip.vue');
    // 派生逻辑收敛为共享 helper（2026-09-01 补齐面板侧）：tooltip 与面板必须同源，
    // 防两处判定再次漂移——本 issue 成因即「同一信息两处呈现不同步」。
    expect(source).toContain('function buildAssetScoreIncompleteLine');
    // 两侧赋值调用形各恰好一次（函数定义本身不匹配 `= buildAssetScoreIncompleteLine(`）。
    expect((source.match(/= buildAssetScoreIncompleteLine\(assetScore\)/g) || []).length).toBe(2);
    // tooltip 侧 unshift 置顶；面板侧插在合计之后、四分项之前（splice index 1）。
    expect(source).toContain('lines.unshift(incompleteLine)');
    expect(source).toContain('lines.splice(1, 0, incompleteLine)');
    // 面板 splice 落点锁定在 buildAssetScoreDetailsText 函数体内（防挪出后接线断链）。
    const panelStart = source.indexOf('function buildAssetScoreDetailsText');
    const panelEnd = source.indexOf('async function copyAssetScoreDetails');
    expect(panelStart).toBeGreaterThan(-1);
    expect(panelEnd).toBeGreaterThan(panelStart);
    expect(source.slice(panelStart, panelEnd)).toContain('lines.splice(1, 0, incompleteLine)');
  });

  it('PlayerCardsStrip：tooltip/明细文本按「快照引用 × 语言」记忆化（#44 击键不重建）', () => {
    const source = readSource('../components/PlayerCardsStrip.vue');
    // 记忆化收敛在两个同名 const 绑定上：模板/复制路径消费记忆化版本，本体改名
    // *Uncached 仅供其构建（防未来有人把消费点改回直调本体、绕过缓存）。
    expect(source).toContain('function memoizeAssetScoreTextBySnapshot');
    expect(source).toContain(
      'const buildAssetScoreTooltip = memoizeAssetScoreTextBySnapshot(buildAssetScoreTooltipUncached)',
    );
    expect(source).toContain(
      'const buildAssetScoreDetailsText = memoizeAssetScoreTextBySnapshot(buildAssetScoreDetailsTextUncached)',
    );
    // 键：快照引用（WeakMap，随快照被 GC 自动释放，无上限管理）× 语言。
    expect(source).toContain('new WeakMap()');
    expect(source).toContain("language.value || 'zh'");
    // 语言读取必须在缓存命中 return 之前：渲染依赖 language ref 不丢，换语言即 miss 重建。
    const memoStart = source.indexOf('function memoizeAssetScoreTextBySnapshot');
    const memoEnd = source.indexOf('const buildAssetScoreTooltip =');
    expect(memoStart).toBeGreaterThan(-1);
    expect(memoEnd).toBeGreaterThan(memoStart);
    const memoBody = source.slice(memoStart, memoEnd);
    expect(memoBody.indexOf('language.value')).toBeGreaterThan(-1);
    expect(memoBody.indexOf('return cached;')).toBeGreaterThan(memoBody.indexOf('language.value'));
  });
});

<template>
  <div class="flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:thin]">
    <div
      v-for="player in players"
      :key="player.id"
      class="relative flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 transition-colors"
      :class="activePlayerId === player.id ? 'border-primary/55 bg-primary/10' : 'border-border bg-background'"
      role="button"
      tabindex="0"
      @click="emit('select-player', player.id)"
      @keydown.enter.self.prevent="emit('select-player', player.id)"
      @keydown.space.self.prevent="emit('select-player', player.id)"
    >
      <input
        v-model="player.name"
        class="w-[72px] bg-transparent text-xs font-semibold outline-none"
        :aria-label="t('common:player', 'Player')"
        @click.stop
        @focus="emit('select-player', player.id)"
      />
      <!-- 资产分徽章：位于名称输入框外侧，绝不写入 player.name（可编辑字段）。
           悬停显示四分项摘要；点击打开可复制明细面板（Teleport 到 body，见下方）。 -->
      <span
        v-if="player.assetScore"
        :ref="(el) => setAssetScoreBadgeRef(player.id, el)"
        class="shrink-0 cursor-pointer select-none rounded bg-primary/10 px-1 py-0.5 text-[10px] font-semibold leading-none tabular-nums text-primary"
        :aria-label="t('common:vue.home.assetScoreTitle', 'Gear Score')"
        :title="buildAssetScoreTooltip(player.assetScore)"
        @click.stop="toggleAssetScoreDetails(player)"
        >{{ formatAssetScoreLabel(player.assetScore) }}</span
      >
      <input
        v-model="player.selected"
        type="checkbox"
        class="size-3.5 accent-primary"
        :aria-label="t('common:vue.app.simToggle', 'Sim')"
        @click.stop
      />
    </div>

    <!-- 可复制明细面板：Teleport 到 body（玩家卡片位于 overflow 滚动容器内，
         absolute 定位会被裁剪），fixed 定位按徽章屏幕坐标计算。 -->
    <Teleport to="body">
      <div
        v-if="assetScoreDetailsPlayer"
        class="fixed z-[100] w-[440px] max-w-[92vw] rounded-md border border-border bg-popover p-3 text-left shadow-xl"
        :style="{ top: `${assetScoreDetailsPosition.top}px`, left: `${assetScoreDetailsPosition.left}px` }"
        @click.stop
      >
        <div class="mb-2 flex items-center justify-between gap-2">
          <span class="truncate text-xs font-semibold text-foreground"
            >{{ assetScoreDetailsPlayer.name || assetScoreDetailsPlayer.id }} ·
            {{ t('common:vue.home.assetScoreDetailsTitle', 'Gear Score details (copyable)') }}</span
          >
          <div class="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="h-6 px-2 text-[10px]"
              @click="copyAssetScoreDetails(assetScoreDetailsPlayer.assetScore)"
              >{{ assetScoreCopyState || t('common:vue.home.assetScoreCopy', 'Copy') }}</Button
            >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="h-6 px-2 text-[10px]"
              :aria-label="t('common:controls.close', 'Close')"
              @click="closeAssetScoreDetails"
              >✕</Button
            >
          </div>
        </div>
        <pre
          class="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground select-text"
          >{{ buildAssetScoreDetailsText(assetScoreDetailsPlayer.assetScore) }}</pre>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Button } from '@/ui/components/ui/button/index.js';
import { useI18nText } from '../composables/useI18nText.js';
import { useGameDataText } from '../composables/useGameDataText.js';
import { ASSET_SCORE_SOURCES, formatAssetScoreGold, formatAssetScoreLabel } from '../../services/assetScoreService.js';

const props = defineProps({
  players: { type: Array, default: () => [] },
  activePlayerId: { type: [String, Number], default: '' },
});

const emit = defineEmits(['select-player']);

const { t, language } = useI18nText();
const { getItemName } = useGameDataText();

const ASSET_SCORE_SOURCE_LABELS = {
  [ASSET_SCORE_SOURCES.OFFICIAL_ESTIMATE]: ['common:vue.home.assetScoreSourceOfficial', 'Official estimate'],
  // synthetic：主站脚本回落合成中价透传（payload marketEstimateSource='synthetic'）——
  // 与官方估算数值同链，仅来源标签区分（tooltip 与可复制明细面板共用本映射）。
  [ASSET_SCORE_SOURCES.SYNTHETIC_MID]: ['common:vue.home.assetScoreSourceSynthetic', 'Synthetic mid'],
  [ASSET_SCORE_SOURCES.MARKET_TRADE]: ['common:vue.home.assetScoreSourceTrade', 'Avg. traded'],
  [ASSET_SCORE_SOURCES.MARKET_QUOTE]: ['common:vue.home.assetScoreSourceQuote', 'Order book'],
  [ASSET_SCORE_SOURCES.COST]: ['common:vue.home.assetScoreSourceCost', 'Cost-based'],
  [ASSET_SCORE_SOURCES.ACQUISITION]: ['common:vue.home.assetScoreSourceAcquisition', 'Acquisition cost'],
  [ASSET_SCORE_SOURCES.VENDOR]: ['common:vue.home.assetScoreSourceVendor', 'Vendor'],
  [ASSET_SCORE_SOURCES.MISSING]: ['common:vue.home.assetScoreSourceMissing', 'No data'],
};

function assetScoreSourceLabel(source) {
  const entry = ASSET_SCORE_SOURCE_LABELS[String(source || '')];
  return entry ? t(entry[0], entry[1]) : String(source || '');
}

// —— 文本记忆化：按「快照引用 × 语言」缓存 tooltip 与可复制明细面板文本（#44 性能修复）——
// 两者均为模板方法调用：名称输入 v-model 写 player.name 等任何无关状态触发的组件重渲染，
// 都会对全部玩家重算 tooltip（N 玩家 × 每件装备的 i18n 查找 + 格式化），而文本内容只依赖
// （快照对象， 语言）二元组。缓存键 = 快照对象引用 × 当前语言，失效模型：
// ① 快照按引用替换（store refreshAssetScores 写回新对象；等值守卫 assetScoreEquals 同值
//    保留旧引用——值相同则缓存文本依旧正确），全库无快照嵌套原地突变写点；
// ② 语言经 useI18nText 的 language ref（t() 内部本就读取它，渲染早已建立依赖；
//    language.value 在缓存命中 return 之前读取，换语言后新键 miss 即重建；
//    i18n 资源静态导入同步可用，无「冻结未加载回退文案」风险）。
// WeakMap 键为响应式代理（Vue 对同一原始对象返回同一代理，键稳定），随快照对象被
// GC 自动释放，无上限管理与手动清理；函数声明提升使下方 const 可前引 *Uncached 本体。
function memoizeAssetScoreTextBySnapshot(buildText) {
  const cacheBySnapshot = new WeakMap();
  return (assetScore) => {
    if (!assetScore) {
      return '';
    }
    const languageKey = language.value || 'zh';
    let byLanguage = cacheBySnapshot.get(assetScore);
    if (!byLanguage) {
      byLanguage = new Map();
      cacheBySnapshot.set(assetScore, byLanguage);
    }
    const cached = byLanguage.get(languageKey);
    if (cached !== undefined) {
      return cached;
    }
    const text = buildText(assetScore);
    byLanguage.set(languageKey, text);
    return text;
  };
}

const buildAssetScoreTooltip = memoizeAssetScoreTextBySnapshot(buildAssetScoreTooltipUncached);
const buildAssetScoreDetailsText = memoizeAssetScoreTextBySnapshot(buildAssetScoreDetailsTextUncached);

// 缺失分项标注行（tooltip 与可复制明细面板共用同一派生，防两处判定漂移）：
// doc §2#8 承诺「缺的分项按 0 计并标注缺哪块」（2026-08-31 审计 T3 接线，
// 对齐 MWITools 面板的 complete/incomplete 标记）。行数据由 service 携带
//（houseRooms/abilities/shrine 行的 incomplete 字段），此处只做派生展示；
// 旧快照无 incomplete 字段时判定为 false，行为同此前（不返回标注行）。
// 无缺失时返回空串，调用方按真值决定是否入列。
function buildAssetScoreIncompleteLine(assetScore) {
  const houseRows = Array.isArray(assetScore.items?.houseRooms) ? assetScore.items.houseRooms : [];
  const abilityRows = Array.isArray(assetScore.items?.abilities) ? assetScore.items.abilities : [];
  const shrineRows = Array.isArray(assetScore.items?.shrine) ? assetScore.items.shrine : [];
  const incompleteLabels = [];
  if (houseRows.some((row) => row?.incomplete === true)) {
    incompleteLabels.push(t('common:vue.home.assetScoreSectionHouse', 'House'));
  }
  if (abilityRows.some((row) => row?.incomplete === true)) {
    incompleteLabels.push(t('common:vue.home.assetScoreSectionAbilities', 'Ability books'));
  }
  if (shrineRows.some((row) => row?.incomplete === true)) {
    incompleteLabels.push(t('common:vue.home.assetScoreSectionShrine', 'Shrines'));
  }
  if (incompleteLabels.length === 0) {
    return '';
  }
  return `${t('common:vue.home.assetScoreIncomplete', 'Incomplete (counted as 0)')}: ${incompleteLabels.join(', ')}`;
}

// 悬停 tooltip：四分项合计 + 每件装备的价值与价格来源标记（官方估算/成交均价/挂单/成本法/商店价）。
// 本体不直接暴露给模板：模板消费的是上方按「快照引用 × 语言」记忆化的同名绑定。
function buildAssetScoreTooltipUncached(assetScore) {
  if (!assetScore) {
    return '';
  }
  const sections = assetScore.sections || {};
  const lines = [
    `${t('common:vue.home.assetScoreSectionEquipment', 'Equipment')}: ${formatAssetScoreGold(sections.equipment)}`,
    `${t('common:vue.home.assetScoreSectionHouse', 'House')}: ${formatAssetScoreGold(sections.house)}`,
    `${t('common:vue.home.assetScoreSectionAbilities', 'Ability books')}: ${formatAssetScoreGold(sections.abilities)}`,
    `${t('common:vue.home.assetScoreSectionShrine', 'Shrines')}: ${formatAssetScoreGold(sections.shrine)}`,
  ];
  // 缺失分项提示行置顶（在四分项与装备明细之前），文案与分项标签均走 i18n。
  const incompleteLine = buildAssetScoreIncompleteLine(assetScore);
  if (incompleteLine) {
    lines.unshift(incompleteLine);
  }
  const equipmentItems = Array.isArray(assetScore.items?.equipment) ? assetScore.items.equipment : [];
  if (equipmentItems.length > 0) {
    lines.push('');
    for (const item of equipmentItems) {
      const name = getItemName(item.itemHrid, item.itemHrid);
      const levelText = Number(item.enhancementLevel) > 0 ? ` +${item.enhancementLevel}` : '';
      lines.push(`· ${name}${levelText}: ${formatAssetScoreGold(item.value)} [${assetScoreSourceLabel(item.source)}]`);
    }
  }
  return lines.join('\n');
}

// —— 可复制明细面板（点击徽章打开，Teleport 到 body）——
// 玩家卡片位于 overflow-x-auto 滚动容器内，absolute 定位面板会被裁剪；
// 徽章 ref 记录后按 getBoundingClientRect 计算屏幕坐标，fixed 定位渲染在 body。
// 坐标不能只在打开瞬间算一次：面板打开期间由 scroll（capture）/resize 监听持续
// 重算（见 scheduleAssetScoreDetailsPositionUpdate），面板才贴得住徽章不悬空。
const assetScoreBadgeRefs = new Map();
const assetScoreDetailsPlayer = ref(null);
const assetScoreDetailsPosition = ref({ top: 0, left: 0 });
const assetScoreCopyState = ref('');

function setAssetScoreBadgeRef(playerId, element) {
  if (element) {
    assetScoreBadgeRefs.set(String(playerId), element);
  } else {
    assetScoreBadgeRefs.delete(String(playerId));
  }
}

function updateAssetScoreDetailsPosition(playerId) {
  const badge = assetScoreBadgeRefs.get(String(playerId));
  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
  if (badge && typeof badge.getBoundingClientRect === 'function') {
    const rect = badge.getBoundingClientRect();
    const panelWidth = Math.min(440, viewportWidth * 0.92);
    // 面板顶部贴徽章下沿；左对齐徽章，但右侧出界时整体右移贴边（不超出视口）。
    const left = Math.max(8, Math.min(rect.left, viewportWidth - panelWidth - 8));
    const next = { top: Math.round(rect.bottom + 6), left: Math.round(left) };
    const current = assetScoreDetailsPosition.value;
    // scroll 捕获监听是全局的：页面滚动或面板内部 pre 自身滚动时徽章并未移动，
    // 坐标未变不写 ref，避免每帧无谓触发面板重渲染。
    if (current.top !== next.top || current.left !== next.left) {
      assetScoreDetailsPosition.value = next;
    }
  }
}

function toggleAssetScoreDetails(player) {
  if (assetScoreDetailsPlayer.value && assetScoreDetailsPlayer.value.id === player.id) {
    closeAssetScoreDetails();
    return;
  }
  assetScoreDetailsPlayer.value = player;
  assetScoreCopyState.value = '';
  updateAssetScoreDetailsPosition(player.id);
}

function closeAssetScoreDetails() {
  assetScoreDetailsPlayer.value = null;
  assetScoreCopyState.value = '';
}

// 面板数据源失效联动关闭（2026-09-01 #39）：assetScoreDetailsPlayer 持有的是打开
// 瞬间的玩家对象引用，面板打开期间该引用可能失真——快照被置 null（行情不可用时
// 签名不一致重算且无可算数据，store refreshAssetScores 原地写回 null）或玩家对象
// 被整体替换（导入/清空配置用 createEmptyPlayerConfig 重建对象，快照为 null）。
// 此时徽章随 player.assetScore 的 v-if 消失并被 ref 清理函数从 Map 删除，
// updateAssetScoreDetailsPosition 找不到徽章不再更新坐标，面板却仍以
// v-if="assetScoreDetailsPlayer" 渲染：空/陈旧内容 + 坐标冻结（不崩溃）。
// 此 watch 只判「同一对象引用仍在 players 中且 assetScore 非空」，失效即走
// closeAssetScoreDetails（与点击外部/Esc 同语义，状态彻底清理）；store 重算写回
// 新 assetScore 对象（同一玩家引用）不触发关闭，面板内容继续实时跟随。getter
// 依赖精确（仅打开玩家的 assetScore 与数组结构），面板未打开时短路返回 null，
// 回调侧再有 assetScoreDetailsPlayer 守卫，常态零开销；pre-flush 先于重渲染
// 执行，失效帧不会先渲染出空面板。
watch(
  () => {
    const opened = assetScoreDetailsPlayer.value;
    if (!opened) {
      return null;
    }
    const current = props.players.find((player) => String(player.id) === String(opened.id));
    return current === opened && Boolean(current.assetScore) ? current : null;
  },
  (validPlayer) => {
    if (assetScoreDetailsPlayer.value && !validPlayer) {
      closeAssetScoreDetails();
    }
  },
);

// 位置跟随：面板打开期间，任何祖先容器的滚动（scroll 事件不冒泡，须在 window 上
// capture 捕获 overflow-x-auto 卡片条与页面滚动）或窗口 resize（含浏览器缩放，
// 缩放同样触发 resize）都会改变徽章屏幕坐标，fixed 面板须随之重算才不悬空。
// rAF 合帧：滚动高频触发，每帧最多算一次，且回调在下一帧绘制前执行，
// 面板与徽章同帧移动；面板已关闭时直接返回。监听常驻注册（与 click/keydown
// 同模式），无动态增删的时序问题。
let assetScoreDetailsFollowRafId = 0;

function scheduleAssetScoreDetailsPositionUpdate() {
  if (!assetScoreDetailsPlayer.value || assetScoreDetailsFollowRafId) {
    return;
  }
  assetScoreDetailsFollowRafId = window.requestAnimationFrame(() => {
    assetScoreDetailsFollowRafId = 0;
    const player = assetScoreDetailsPlayer.value;
    if (player) {
      updateAssetScoreDetailsPosition(player.id);
    }
  });
}

// 明细文本：对账友好格式——逐件带 槽位/物品名/hrid/+等级/金额/来源，便于贴给开发者对比。
// 标签全部走 i18n（2026-08-31 审计 U1：原六处硬编码中文改 t()，复用 Section×4 与
// assetScoreEquipmentDetails 键、新增 assetScoreTotal 键）；zh 文本与改前逐字一致，en 消除混排。
// 缺失分项标注行与 tooltip 共用 buildAssetScoreIncompleteLine 派生（见上），两侧信息对齐：
// 插在合计之后、四分项之前——合计仍居面板首行（U1 既定格式），标注紧邻其解释的分项块，
// 对账粘贴的接收方才能看出某分项 0 是「数据缺失按 0 计」而非真实为零；无缺失/旧快照
// 无 incomplete 字段时 helper 返空串不插行，输出与改前逐字一致。
// 本体不直接暴露给模板/复制：消费的是上方按「快照引用 × 语言」记忆化的同名绑定。
function buildAssetScoreDetailsTextUncached(assetScore) {
  if (!assetScore) {
    return '';
  }
  const sections = assetScore.sections || {};
  const lines = [
    `${t('common:vue.home.assetScoreTotal', 'Total')}: ${formatAssetScoreGold(assetScore.totalGold)}`,
    `${t('common:vue.home.assetScoreSectionEquipment', 'Equipment')}: ${formatAssetScoreGold(sections.equipment)}`,
    `${t('common:vue.home.assetScoreSectionHouse', 'House')}: ${formatAssetScoreGold(sections.house)}`,
    `${t('common:vue.home.assetScoreSectionAbilities', 'Ability books')}: ${formatAssetScoreGold(sections.abilities)}`,
    `${t('common:vue.home.assetScoreSectionShrine', 'Shrines')}: ${formatAssetScoreGold(sections.shrine)}`,
    '',
    `${t('common:vue.home.assetScoreEquipmentDetails', 'Equipment details')}:`,
  ];
  const incompleteLine = buildAssetScoreIncompleteLine(assetScore);
  if (incompleteLine) {
    lines.splice(1, 0, incompleteLine);
  }
  const equipmentItems = Array.isArray(assetScore.items?.equipment) ? assetScore.items.equipment : [];
  for (const item of equipmentItems) {
    const name = getItemName(item.itemHrid, item.itemHrid);
    const levelText = Number(item.enhancementLevel) > 0 ? ` +${item.enhancementLevel}` : '';
    lines.push(
      `${item.slotKey} | ${name}${levelText} | ${item.itemHrid} | ${formatAssetScoreGold(item.value)} | ${assetScoreSourceLabel(item.source)}`,
    );
  }
  return lines.join('\n');
}

async function copyAssetScoreDetails(assetScore) {
  const text = buildAssetScoreDetailsText(assetScore);
  if (!text) {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    assetScoreCopyState.value = t('common:vue.home.assetScoreCopied', 'Copied');
  } catch (_error) {
    assetScoreCopyState.value = t('common:vue.home.assetScoreCopyFailed', 'Copy failed');
  }
  window.setTimeout(() => {
    assetScoreCopyState.value = '';
  }, 1600);
}

// 明细面板的全局关闭：点击面板外（徽章/面板自身已 @click.stop）或按 Esc 关闭。
function handleAssetScoreDetailsWindowClick() {
  closeAssetScoreDetails();
}

function handleAssetScoreDetailsKeydown(event) {
  if (event.key === 'Escape') {
    closeAssetScoreDetails();
  }
}

onMounted(() => {
  window.addEventListener('click', handleAssetScoreDetailsWindowClick);
  window.addEventListener('keydown', handleAssetScoreDetailsKeydown);
  // scroll 用 capture：元素滚动事件不冒泡，捕获监听才能覆盖卡片条横向滚动与页面滚动；
  // resize 覆盖窗口尺寸变化与浏览器缩放。两者都只重算面板坐标，面板关闭时零开销。
  window.addEventListener('scroll', scheduleAssetScoreDetailsPositionUpdate, true);
  window.addEventListener('resize', scheduleAssetScoreDetailsPositionUpdate);
});

onBeforeUnmount(() => {
  window.removeEventListener('click', handleAssetScoreDetailsWindowClick);
  window.removeEventListener('keydown', handleAssetScoreDetailsKeydown);
  // removeEventListener 的 capture 标志必须与注册时一致，否则监听注销不掉。
  window.removeEventListener('scroll', scheduleAssetScoreDetailsPositionUpdate, true);
  window.removeEventListener('resize', scheduleAssetScoreDetailsPositionUpdate);
  if (assetScoreDetailsFollowRafId) {
    window.cancelAnimationFrame(assetScoreDetailsFollowRafId);
    assetScoreDetailsFollowRafId = 0;
  }
});
</script>

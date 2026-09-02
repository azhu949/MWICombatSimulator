<template>
  <BaseModal
    :open="open"
    :title="t('common:controls.importExport', 'Import/Export')"
    panel-class="max-w-[96vw] xl:max-w-[1200px]"
    @close="close"
  >
    <div class="space-y-3">
      <div
        class="flex flex-col gap-3 rounded-md border border-success/40 bg-muted/50 p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="space-y-1">
          <p class="font-heading text-sm font-semibold uppercase text-success">
            {{ t('common:vue.settings.mainSiteImportScriptTitle', 'Main-site Import Script') }}
          </p>
          <p class="text-sm text-foreground/85">
            {{
              t(
                'common:vue.settings.mainSiteImportScriptDescription',
                'Install the Tampermonkey helper to add a single main-site import button that imports the current character directly; when a team is detected, it only uses party members whose profiles you have opened and cached manually, skips missing members, and writes to Player 1..N (up to 5).',
              )
            }}
          </p>
          <p v-if="!hasMainSiteImportScriptUrl" class="text-xs text-info">
            {{ t('common:vue.settings.mainSiteImportScriptPending', 'Script link pending') }}
          </p>
        </div>
        <button
          type="button"
          class="button-tool shrink-0"
          :disabled="!hasMainSiteImportScriptUrl"
          @click="openMainSiteImportScript"
        >
          {{ t('common:vue.settings.installMainSiteImportScript', 'Install Script') }}
        </button>
      </div>
      <div class="grid gap-4 lg:grid-cols-2">
        <div class="rounded-md border border-border bg-muted/50 p-3 space-y-3">
          <div class="flex items-center justify-between gap-2">
            <h3 class="font-heading text-base font-semibold text-primary">
              {{ t('common:vue.settings.groupImportExportTitle', 'Group Import/Export') }}
            </h3>
            <span class="status-chip">{{ t('common:vue.settings.modernJson', 'Modern JSON') }}</span>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="button-primary" @click="handleGroupExport">
              {{ t('common:vue.settings.exportGroup', 'Export Group') }}</button
            ><button type="button" class="button-secondary" @click="copyText(groupText)">
              {{ t('common:vue.common.copy', 'Copy') }}</button
            ><button type="button" class="button-secondary" @click="downloadText('mwi-group-modern.json', groupText)">
              {{ t('common:vue.common.download', 'Download') }}</button
            ><label class="button-secondary cursor-pointer"
              >{{ t('common:vue.common.loadFile', 'Load File')
              }}<input
                class="hidden"
                type="file"
                accept="application/json,.json,.txt"
                @change="onFileSelected($event, 'group')"
            /></label>
          </div>
          <textarea
            v-model="groupText"
            class="control-input min-h-[220px] font-mono text-xs"
            spellcheck="false"
          ></textarea>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="button-primary" @click="handleGroupImport">
              {{ t('common:vue.settings.importGroup', 'Import Group') }}</button
            ><button type="button" class="button-secondary" @click="groupText = ''">
              {{ t('common:vue.common.clear', 'Clear') }}
            </button>
          </div>
        </div>
        <div class="rounded-md border border-border bg-muted/50 p-3 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="font-heading text-base font-semibold text-primary">
              {{ t('common:vue.settings.soloImportExportTitle', 'Solo Import/Export') }}
            </h3>
            <div class="flex items-center gap-2">
              <Select v-model="soloTargetPlayerId"
                ><SelectTrigger
                  class="max-w-[140px]"
                  :aria-label="t('common:vue.settings.soloImportExportTitle', 'Solo Import/Export')"
                /><SelectContent
                  ><SelectItem v-for="player in simulator.players" :key="player.id" :value="String(player.id)">{{
                    playerAssetScoreLabel(player)
                  }}</SelectItem></SelectContent
                ></Select
              ><span class="status-chip">{{ t('common:vue.settings.modernSolo', 'Modern Solo') }}</span>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="button-primary" @click="handleSoloExport">
              {{ t('common:vue.settings.exportSolo', 'Export Solo') }}</button
            ><button type="button" class="button-secondary" @click="copyText(soloText)">
              {{ t('common:vue.common.copy', 'Copy') }}</button
            ><button
              type="button"
              class="button-secondary"
              @click="downloadText(`mwi-solo-${soloTargetPlayerId}-modern.json`, soloText)"
            >
              {{ t('common:vue.common.download', 'Download') }}</button
            ><label class="button-secondary cursor-pointer"
              >{{ t('common:vue.common.loadFile', 'Load File')
              }}<input
                class="hidden"
                type="file"
                accept="application/json,.json,.txt"
                @change="onFileSelected($event, 'solo')"
            /></label>
          </div>
          <textarea
            v-model="soloText"
            class="control-input min-h-[220px] font-mono text-xs"
            spellcheck="false"
          ></textarea>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="button-primary" @click="handleSoloImport">
              {{ t('common:vue.settings.importToPlayer', 'Import To Player') }}</button
            ><button type="button" class="button-secondary" @click="soloText = ''">
              {{ t('common:vue.common.clear', 'Clear') }}
            </button>
          </div>
        </div>
      </div>
      <p v-if="status.text" class="text-sm" :class="statusClass">{{ status.text }}</p>
    </div>
  </BaseModal>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useSimulatorStore } from '../../../stores/simulatorStore.js';
import { useI18nText } from '../../composables/useI18nText.js';
import { MAIN_SITE_IMPORT_SCRIPT_URL } from '../../config/externalLinks.js';
import { formatAssetScoreLabel } from '../../../services/assetScoreService.js';
import { Select, SelectContent, SelectItem, SelectTrigger } from '../ui/select/index.js';
import BaseModal from '../BaseModal.vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  blockPlayerConfigReplacement: { type: Function, required: true },
});
const emit = defineEmits(['close']);
const simulator = useSimulatorStore();
const { t } = useI18nText();
const groupText = ref('');
const soloText = ref('');
const soloTargetPlayerId = ref(String(simulator.activePlayerId || '1'));
const status = ref({ tone: 'secondary', text: '' });
const hasMainSiteImportScriptUrl = Boolean(MAIN_SITE_IMPORT_SCRIPT_URL);
const statusClass = computed(() => {
  if (status.value.tone === 'success') {
    return 'text-success';
  }
  if (status.value.tone === 'danger') {
    return 'text-destructive';
  }
  return 'text-muted-foreground';
});

function setStatus(tone, text) {
  status.value = {
    tone: tone || 'secondary',
    text: String(text || ''),
  };
}

// 单人导入目标下拉的玩家标签：名称 + 资产分后缀（仅有快照时显示）。
// 空名玩家兜底 `Player ${id}`（对齐 HomeSimulationPanel 玩家选择下拉），防裸「 · 9,534」前导分隔符。
function playerAssetScoreLabel(player) {
  const name = String(player?.name || `Player ${player?.id || ''}`);
  return player?.assetScore ? `${name} · ${formatAssetScoreLabel(player.assetScore)}` : name;
}

function close() {
  setStatus('secondary', '');
  emit('close');
}

function openMainSiteImportScript() {
  if (hasMainSiteImportScriptUrl) {
    window.open(MAIN_SITE_IMPORT_SCRIPT_URL, '_blank', 'noopener,noreferrer');
  }
}

function handleGroupExport() {
  groupText.value = simulator.exportGroupConfig();
  setStatus(
    'success',
    t('common:vue.settings.msgGroupExported', 'Group exported in {{format}} format.', { format: 'modern' }),
  );
}

function handleSoloExport() {
  soloText.value = simulator.exportSoloConfig(soloTargetPlayerId.value);
  setStatus(
    'success',
    t('common:vue.settings.msgSoloExported', 'Player {{player}} exported in {{format}} format.', {
      player: soloTargetPlayerId.value,
      format: 'modern',
    }),
  );
}

function handleGroupImport() {
  if (props.blockPlayerConfigReplacement()) {
    setStatus('warning', t('common:vue.home.dirtyDraftBlocked', 'Save or cancel the current changes first.'));
    return;
  }
  try {
    const result = simulator.importGroupConfig(groupText.value);
    // #40（2026-09-01）：组队导入与单人同样提取并应用 marketItemValues（mapper
    // importGroupConfig / store applyImportedMarketItemValues），反馈复用同一门控
    // helper（见下方 OFFICIAL_ESTIMATE_FORMATS 注释），消除「组队侧静默应用零反馈」
    // 的不对称；modern-group 载荷不携带估值（count=0）时文案与旧版一致。
    setStatus(
      'success',
      buildImportSuccessText(
        result,
        t('common:vue.settings.msgGroupImportSuccess', 'Group import success ({{format}}).', {
          format: result.detectedFormat,
        }),
      ),
    );
  } catch (error) {
    setStatus(
      'danger',
      t('common:vue.settings.msgGroupImportFailed', 'Group import failed: {{error}}', {
        error: error?.message || String(error),
      }),
    );
  }
}

// 官方估值计数行按格式门控（2026-08-31 审计【一般 4】）：仅存在市场透传通道的
// 主站格式恒显示——main-site-current-character 的 0 表示主站脚本未透传（透传
// 故障信号），main-site-share-profile 粘贴载荷的 0 是第 19 轮通道分离的预期反馈
// （资产分将使用挂单价）。原生格式（modern-solo / legacy-solo / modern-player-only
// / modern-group）的导出从不携带市场字段，恒 0 显示是误导性噪音，不再拼接；载荷
// 实际携带估值（count > 0）时无论格式恒显示。
// #40（2026-09-01）：组队导入与单人同样提取并应用 marketItemValues（mapper
// importGroupConfig / store applyImportedMarketItemValues），反馈共用下方 helper，
// 消除「组队侧静默应用零反馈」的不对称。
const OFFICIAL_ESTIMATE_FORMATS = new Set(['main-site-current-character', 'main-site-share-profile']);

// 组队/单人导入共用的成功反馈构建：基础成功文案 + 官方估值计数行（按格式门控），
// 让用户导入后立刻确认资产分取价链第①级是否可用。载荷级来源标记
// marketEstimateSource='synthetic'（主站脚本回落合成中价，脚本状态栏同批标注
// 「合成中价估值已透传」）时整体切换合成中价文案，与脚本状态栏反馈一致；无标记
// （旧载荷/复制粘贴载荷）保持官方估值文案（向后兼容，不劣化）。
// #18（2026-08-31）：混合载荷（载荷级 official + syntheticItemHrids 清单）如实分列
// 计数——官方与合成中价并存时，把合成部分整体报成官方估值正是逐件真值丢失的用户
// 面失真。混合仅在载荷级标记非 synthetic 时成立：标记 synthetic 本身已声明全部
// 物品为合成中价，此时清单冗余（矛盾载荷）不进入混合分支。
function buildImportSuccessText(result, baseSuccessText) {
  const officialEstimateCount = result.marketItemValues ? Object.keys(result.marketItemValues).length : 0;
  const syntheticItemHrids = Array.isArray(result.syntheticItemHrids) ? result.syntheticItemHrids : [];
  const syntheticItemCount = syntheticItemHrids.length;
  const isMixedEstimates =
    result.marketEstimateSource !== 'synthetic' && syntheticItemCount > 0 && syntheticItemCount < officialEstimateCount;
  const isSyntheticEstimates = result.marketEstimateSource === 'synthetic';
  const showOfficialEstimates = officialEstimateCount > 0 || OFFICIAL_ESTIMATE_FORMATS.has(result.detectedFormat);
  if (!showOfficialEstimates) {
    return baseSuccessText;
  }
  return `${baseSuccessText} ${t(
    isMixedEstimates
      ? 'common:vue.settings.msgImportMixedEstimates'
      : isSyntheticEstimates
        ? 'common:vue.settings.msgImportSyntheticEstimates'
        : 'common:vue.settings.msgImportOfficialEstimates',
    isMixedEstimates
      ? 'Official estimates: {{officialCount}} items + synthetic mid-price estimates: {{syntheticCount}} items (synthetic part not official; may differ from MWITools by ~4-5%).'
      : isSyntheticEstimates
        ? 'Synthetic mid-price estimates: {{count}} items (not official; may differ from MWITools by ~4-5%).'
        : 'Official estimates: {{count}} items.',
    {
      count: officialEstimateCount,
      officialCount: Math.max(0, officialEstimateCount - syntheticItemCount),
      syntheticCount: syntheticItemCount,
    },
  )}`;
}

function handleSoloImport() {
  if (props.blockPlayerConfigReplacement()) {
    setStatus('warning', t('common:vue.home.dirtyDraftBlocked', 'Save or cancel the current changes first.'));
    return;
  }
  try {
    const result = simulator.importSoloConfig(soloText.value, soloTargetPlayerId.value);
    // 官方估值计数让用户导入后立刻确认资产分取价链第①级是否可用；门控/合成中价/
    // 混合分列语义见上方 buildImportSuccessText 注释（组队/单人共用同一实现，#40）。
    setStatus(
      'success',
      buildImportSuccessText(
        result,
        t('common:vue.settings.msgSoloImportSuccess', 'Solo import success ({{format}}).', {
          format: result.detectedFormat,
        }),
      ),
    );
  } catch (error) {
    setStatus(
      'danger',
      t('common:vue.settings.msgSoloImportFailed', 'Solo import failed: {{error}}', {
        error: error?.message || String(error),
      }),
    );
  }
}

async function copyText(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    setStatus('danger', t('common:vue.settings.msgNothingToCopy', 'Nothing to copy.'));
    return;
  }
  try {
    await navigator.clipboard.writeText(normalized);
    setStatus('success', t('common:vue.settings.msgCopied', 'Copied to clipboard.'));
  } catch (error) {
    setStatus(
      'danger',
      t('common:vue.settings.msgCopyFailed', 'Clipboard copy failed: {{error}}', {
        error: error?.message || String(error),
      }),
    );
  }
}

function downloadText(filename, text) {
  const normalized = String(text || '');
  if (!normalized.trim()) {
    setStatus('danger', t('common:vue.settings.msgNothingToDownload', 'Nothing to download.'));
    return;
  }
  const url = URL.createObjectURL(new Blob([normalized], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  setStatus('success', t('common:vue.settings.msgDownloaded', 'Downloaded {{filename}}.', { filename }));
}

async function onFileSelected(event, target) {
  const file = event?.target?.files?.[0];
  if (!file) {
    return;
  }
  try {
    const text = await file.text();
    if (target === 'group') {
      groupText.value = text;
    } else {
      soloText.value = text;
    }
    setStatus('success', t('common:vue.settings.msgLoadedFile', 'Loaded file: {{filename}}', { filename: file.name }));
  } catch (error) {
    setStatus(
      'danger',
      t('common:vue.settings.msgReadFileFailed', 'Read file failed: {{error}}', {
        error: error?.message || String(error),
      }),
    );
  } finally {
    event.target.value = '';
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      soloTargetPlayerId.value = String(simulator.activePlayerId || '1');
      setStatus('secondary', '');
    }
  },
);
</script>

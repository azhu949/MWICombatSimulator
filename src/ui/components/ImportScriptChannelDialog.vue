<template>
  <BaseModal
    :open="open"
    :title="dialogTitle"
    panel-class="max-w-lg"
    initial-focus-selector="[data-import-script-channel]"
    @close="emit('close')"
  >
    <div class="space-y-3" data-import-script-channel-dialog>
      <p class="text-sm text-foreground/85">{{ dialogDescription }}</p>

      <div class="grid gap-2">
        <button
          v-for="channel in channels"
          :key="channel.key"
          type="button"
          class="group flex w-full items-start gap-3 rounded-md border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/50"
          :class="
            channel.key === IMPORT_SCRIPT_CHANNEL_SITE
              ? 'border-primary/40 bg-primary/5 hover:border-primary/70 hover:bg-primary/10'
              : 'border-border bg-muted/40 hover:border-foreground/30 hover:bg-muted'
          "
          :data-import-script-channel="channel.key"
          @click="chooseChannel(channel)"
        >
          <span
            class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background/70 text-primary"
          >
            <Download v-if="channel.key === IMPORT_SCRIPT_CHANNEL_SITE" class="size-4" />
            <Globe2 v-else class="size-4" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-semibold text-foreground">{{ channelTitle(channel) }}</span>
            <span class="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
              {{ channelDescription(channel) }}
            </span>
            <span class="mt-1 block truncate font-mono text-[10px] text-muted-foreground/75">
              {{ channelHost(channel.url) }}
            </span>
          </span>
          <ExternalLink
            class="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
            aria-hidden="true"
          />
        </button>
      </div>

      <p class="text-xs text-muted-foreground">{{ channelHint }}</p>
      <p v-if="checksumLabel" class="break-all font-mono text-[10px] text-muted-foreground">
        {{ checksumLabel }}
      </p>
    </div>
  </BaseModal>
</template>

<script setup>
import { computed } from 'vue';
import { Download, ExternalLink, Globe2 } from '@lucide/vue';
import { IMPORT_SCRIPT_CHANNEL_GREASYFORK, IMPORT_SCRIPT_CHANNEL_SITE } from '../config/importScriptDistribution.js';
import {
  IMPORT_SCRIPT_STATUS_CURRENT,
  IMPORT_SCRIPT_STATUS_LEGACY,
  IMPORT_SCRIPT_STATUS_MISSING,
  IMPORT_SCRIPT_STATUS_OUTDATED,
  MAIN_SITE_IMPORT_SCRIPT_SHA256,
  MAIN_SITE_IMPORT_SCRIPT_VERSION,
} from '../../services/mainSiteImportScriptStatus.js';
import { useI18nText } from '../composables/useI18nText.js';
import BaseModal from './BaseModal.vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  status: { type: String, default: '' },
  installedVersion: { type: String, default: '' },
  expectedVersion: { type: String, default: '' },
  channels: { type: Array, default: () => [] },
});
const emit = defineEmits(['close']);
const { t } = useI18nText();

const dialogTitle = computed(() => {
  if (props.status === IMPORT_SCRIPT_STATUS_MISSING) {
    return t('common:vue.app.importScriptChannelInstallTitle', 'Install Import Script');
  }

  if (props.status === IMPORT_SCRIPT_STATUS_CURRENT) {
    return t('common:vue.app.importScriptChannelReinstallTitle', 'Reinstall Import Script');
  }

  return t('common:vue.app.importScriptChannelDialogTitle', 'Update Import Script');
});

const expectedVersionLabel = computed(() => props.expectedVersion || '?');

// 侧栏任意安装状态都可进入本弹窗（未安装 / 已最新 / 待更新 / 旧版），正文按状态说清
// 「当前是什么、目标是什么」。legacy 没有可用版本号，单独一套文案，避免「已安装 v?」。
const dialogDescription = computed(() => {
  if (props.status === IMPORT_SCRIPT_STATUS_OUTDATED) {
    return t(
      'common:vue.app.importScriptChannelOutdatedDescription',
      'Installed v{{installed}}, latest is v{{expected}}. Choose where to update from:',
      {
        installed: props.installedVersion || '?',
        expected: expectedVersionLabel.value,
      },
    );
  }

  if (props.status === IMPORT_SCRIPT_STATUS_LEGACY) {
    return t(
      'common:vue.app.importScriptChannelLegacyDescription',
      'A legacy import script was detected, but it cannot report its version. Latest is v{{expected}}. Choose where to update from:',
      { expected: expectedVersionLabel.value },
    );
  }

  // 未安装：没有已安装版本可引用，只报站点当前版本与安装目标。
  if (props.status === IMPORT_SCRIPT_STATUS_MISSING) {
    return t(
      'common:vue.app.importScriptChannelMissingDescription',
      'No import script detected. Latest is v{{expected}}. Choose where to install from:',
      { expected: expectedVersionLabel.value },
    );
  }

  // 已最新：说清「已装版本 = 最新版本」，并说明这里用于重新安装或切换来源。
  if (props.status === IMPORT_SCRIPT_STATUS_CURRENT) {
    return t(
      'common:vue.app.importScriptChannelCurrentDescription',
      'Installed v{{installed}}, already at v{{expected}}. Choose a channel to reinstall or switch sources:',
      {
        installed: props.installedVersion || '?',
        expected: expectedVersionLabel.value,
      },
    );
  }

  return t('common:vue.app.importScriptChannelDefaultDescription', 'Choose where to update from:');
});

const CHANNEL_COPY = {
  [IMPORT_SCRIPT_CHANNEL_SITE]: {
    titleKey: 'common:vue.app.importScriptChannelSiteTitle',
    titleFallback: 'Site download (recommended)',
    descriptionKey: 'common:vue.app.importScriptChannelSiteDescription',
    descriptionFallback: 'Download the script directly from this site; works even when GreasyFork is unreachable.',
  },
  [IMPORT_SCRIPT_CHANNEL_GREASYFORK]: {
    titleKey: 'common:vue.app.importScriptChannelGreasyforkTitle',
    titleFallback: 'GreasyFork (overseas)',
    descriptionKey: 'common:vue.app.importScriptChannelGreasyforkDescription',
    descriptionFallback: 'Open the GreasyFork script page to update; requires access to greasyfork.org.',
  },
};

function channelCopy(channel) {
  return CHANNEL_COPY[channel?.key] || CHANNEL_COPY[IMPORT_SCRIPT_CHANNEL_SITE];
}

function channelTitle(channel) {
  const copy = channelCopy(channel);
  return t(copy.titleKey, copy.titleFallback);
}

function channelDescription(channel) {
  const copy = channelCopy(channel);
  return t(copy.descriptionKey, copy.descriptionFallback);
}

// 只展示主机名：GreasyFork 的完整地址很长且含中文编码，塞进卡片会把弹窗撑高。
function channelHost(url) {
  try {
    return new URL(String(url || '')).hostname;
  } catch {
    return String(url || '');
  }
}

const channelHint = computed(() =>
  t(
    'common:vue.app.importScriptChannelHint',
    'After confirming the update in your userscript manager, reload this page to see the new status.',
  ),
);

const checksumLabel = computed(() => {
  if (!MAIN_SITE_IMPORT_SCRIPT_SHA256) {
    return '';
  }

  return t(
    'common:vue.app.importScriptChannelChecksum',
    'Site script v{{version}} · SHA-256 {{sha256}} (compare with the repository release)',
    {
      version: MAIN_SITE_IMPORT_SCRIPT_VERSION || '?',
      sha256: MAIN_SITE_IMPORT_SCRIPT_SHA256,
    },
  );
});

// 用 window.open 而不是 <a>：选择即关闭弹窗，避免用户回到模拟器时弹窗仍挡在面前。
// 点击本身就是用户手势，弹窗拦截器不会误伤；noopener/noreferrer 与其它外链一致。
function chooseChannel(channel) {
  const url = String(channel?.url || '').trim();
  if (!url || typeof window === 'undefined' || typeof window.open !== 'function') {
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
  emit('close');
}
</script>

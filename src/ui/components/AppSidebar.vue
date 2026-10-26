<template>
  <Sidebar v-slot="{ collapsed, mobile }">
    <div
      class="flex h-14 shrink-0 items-center border-b border-sidebar-border px-3"
      :class="collapsed ? 'justify-center' : 'gap-2.5'"
    >
      <img :src="logoUrl" alt="" aria-hidden="true" class="size-9 shrink-0 select-none rounded-md object-contain" />
      <div v-if="!collapsed" class="min-w-0 leading-tight">
        <p class="truncate font-heading text-sm font-semibold text-sidebar-foreground">
          {{ t('common:title', 'MWI Combat Simulator') }}
        </p>
        <p class="mt-0.5 text-[10px] font-semibold uppercase text-muted-foreground">v{{ version }}</p>
      </div>
      <Button
        v-if="mobile"
        type="button"
        variant="ghost"
        size="icon-sm"
        class="ml-auto"
        :aria-label="t('common:vue.app.closeNavigation', 'Close navigation')"
        @click="setMobileOpen(false)"
      >
        <X />
      </Button>
    </div>

    <nav class="min-h-0 flex-1 overflow-y-auto px-2 py-3" aria-label="Primary navigation">
      <!-- 铁牛模式（全局）：模拟器功能尚未开发——分组导航整体不渲染，
           仅保留底部三个通用入口（补丁说明 / GitHub / 反馈）。 -->
      <!-- 折叠态（桌面图标模式）：保持原平面图标列表，不渲染手风琴。 -->
      <template v-if="!ironcowMode && collapsed">
        <div v-for="group in navigationGroups" :key="group.id" class="mb-4 last:mb-0">
          <div class="space-y-1">
            <RouterLink
              v-for="item in group.items"
              :key="item.name"
              :to="item.path"
              class="group flex h-10 items-center justify-center px-0 text-[15px] font-medium text-sidebar-foreground/72 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              :class="route.name === item.name ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''"
              :title="item.label"
              @click="mobile && setMobileOpen(false)"
            >
              <component :is="item.icon" class="size-[1.125rem] shrink-0" />
            </RouterLink>
          </div>
        </div>
      </template>
      <!-- 展开态（桌面展开 + 移动端抽屉，两者 collapsed 恒为 false）：手风琴分组导航。 -->
      <Accordion v-if="!ironcowMode && !collapsed" type="multiple" v-model:model-value="expandedGroups">
        <AccordionItem v-for="group in navigationGroups" :key="group.id" :value="group.id" class="border-b-0">
          <!-- 当前分组：收起时组内高亮链接随 content 卸载（reka Presence），trigger 上的
               aria-current 让「我在哪个分组」在收起状态下仍可被识别。 -->
          <AccordionTrigger
            class="min-h-8 rounded-md px-2 py-1.5 text-[11px] uppercase text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-sidebar-ring"
            :aria-current="route.meta?.navGroup === group.id ? 'true' : undefined"
          >
            {{ group.label }}
          </AccordionTrigger>
          <AccordionContent class="pb-1.5">
            <div class="space-y-1">
              <RouterLink
                v-for="item in group.items"
                :key="item.name"
                :to="item.path"
                class="group flex h-10 items-center gap-3 rounded-md px-3 text-[15px] font-medium text-sidebar-foreground/72 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                :class="route.name === item.name ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''"
                @click="mobile && setMobileOpen(false)"
              >
                <component :is="item.icon" class="size-[1.125rem] shrink-0" />
                <span class="truncate">{{ item.label }}</span>
              </RouterLink>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </nav>

    <div class="shrink-0 space-y-1 border-t border-sidebar-border p-2">
      <!-- 主站导入脚本状态：位于更新日志上方，回答「装没装 / 是不是最新版」。
           证据有两层：脚本写在 <html> 上的版本标记（新版）与脚本注入的导入控件（旧版也有），
           见 useMainSiteImportScriptStatus。未安装/已最新时保持直链（安装/重装）；
           待更新或可更新时改为按钮：脚本可能来自站点或 GreasyFork，先让用户选更新渠道，
           不能直接跳到某一个来源。当前域名不在脚本 @match 内时（自建镜像 / 自定义域名）
           整行降级为中性说明且不提供安装入口，见 importScriptUnsupported。 -->
      <component
        :is="importScriptEntryTag"
        v-bind="importScriptEntryAttrs"
        class="sidebar-action relative"
        :class="collapsed ? 'justify-center' : ''"
        :aria-label="importScriptTooltip"
        :title="importScriptTooltip"
        data-main-site-import-script-status
        :data-import-script-status="importScriptStatus"
        :data-import-script-coverage="importScriptCoverage"
        :data-import-script-action="importScriptAction"
        @click="handleImportScriptEntryClick(mobile, $event)"
      >
        <Plug class="size-[1.125rem] shrink-0" />
        <span v-if="!collapsed" class="min-w-0 flex-1 truncate">{{ importScriptLabel }}</span>
        <span
          class="sidebar-script-dot"
          :class="[`is-${importScriptStatus}`, collapsed ? 'sidebar-script-dot-collapsed' : '']"
          aria-hidden="true"
        />
      </component>
      <RouterLink v-slot="{ href, navigate, isExactActive }" to="/patch-notes" custom>
        <a
          :href="href"
          class="sidebar-action relative"
          :class="[collapsed ? 'justify-center' : '', route.name === 'patch-notes' ? 'sidebar-action-active' : '']"
          :aria-label="patchNotesLabel"
          :aria-current="isExactActive ? 'page' : undefined"
          :title="patchNotesLabel"
          @click="handlePatchNotesClick(mobile, $event, navigate)"
        >
          <ScrollText class="size-[1.125rem] shrink-0" />
          <span v-if="!collapsed" class="truncate">{{ t('common:patchNotes', 'Patch Notes') }}</span>
          <span
            v-if="unreadPatchNotesCount > 0"
            class="sidebar-unread-indicator"
            :class="collapsed ? 'sidebar-unread-indicator-collapsed' : 'ml-auto'"
            aria-hidden="true"
          >
            <span class="sidebar-unread-badge">{{ unreadBadgeLabel }}</span>
          </span>
        </a>
      </RouterLink>
      <a
        href="https://github.com/azhu949/MWICombatSimulator"
        class="sidebar-action"
        :class="collapsed ? 'justify-center' : ''"
        target="_blank"
        rel="noopener noreferrer"
        :title="githubLabel"
      >
        <GitFork class="size-[1.125rem] shrink-0" />
        <span v-if="!collapsed" class="truncate">GitHub</span>
      </a>
      <button
        type="button"
        class="sidebar-action"
        :class="collapsed ? 'justify-center' : ''"
        :title="feedbackLabel"
        @click="emit('feedback')"
      >
        <MessageSquare class="size-[1.125rem] shrink-0" />
        <span v-if="!collapsed" class="truncate">{{ feedbackLabel }}</span>
      </button>
    </div>
  </Sidebar>

  <!-- 更新渠道弹窗放在 Sidebar 外：Sidebar 的插槽在桌面 aside 与移动端 Dialog 各渲染一次，
       放进去会在移动端同时出现两个实例。 -->
  <ImportScriptChannelDialog
    v-if="importScriptChannels.length"
    :open="importScriptChannelDialogOpen"
    :status="importScriptStatus"
    :installed-version="installedVersion"
    :expected-version="expectedVersion"
    :channels="importScriptChannels"
    @close="closeImportScriptChannelDialog"
  />
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import {
  BookOpen,
  Castle,
  ChartNoAxesColumnIncreasing,
  GitFork,
  House,
  ListChecks,
  MessageSquare,
  Plug,
  ScrollText,
  Settings,
  ShieldPlus,
  SlidersHorizontal,
  Sparkles,
  Sword,
  Utensils,
  Wallet,
  X,
} from '@lucide/vue';
import { Button } from '@/ui/components/ui/button/index.js';
import { Sidebar, useSidebar } from '@/ui/components/ui/sidebar/index.js';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../components/ui/accordion/index.js';
import ImportScriptChannelDialog from './ImportScriptChannelDialog.vue';
import { MAIN_SITE_IMPORT_SCRIPT_CHANNELS, MAIN_SITE_IMPORT_SCRIPT_URL } from '../config/externalLinks.js';
import { useI18nText } from '../composables/useI18nText.js';
import { useMainSiteImportScriptStatus } from '../composables/useMainSiteImportScriptStatus.js';
import {
  IMPORT_SCRIPT_COVERAGE_UNCOVERED,
  IMPORT_SCRIPT_STATUS_CURRENT,
  IMPORT_SCRIPT_STATUS_LEGACY,
  IMPORT_SCRIPT_STATUS_MISSING,
  IMPORT_SCRIPT_STATUS_OUTDATED,
} from '../../services/mainSiteImportScriptStatus.js';
import logoUrl from '../assets/logo-256.png';

const props = defineProps({
  version: { type: String, required: true },
  ironcowMode: { type: Boolean, default: false },
  unreadPatchNotesCount: { type: Number, default: 0 },
  patchNotesLabel: { type: String, default: 'Patch Notes' },
});

const unreadBadgeLabel = computed(() =>
  props.unreadPatchNotesCount > 99 ? '99+' : String(props.unreadPatchNotesCount),
);

const emit = defineEmits(['feedback', 'open-patch-notes']);
const router = useRouter();
const route = useRoute();
const { setMobileOpen } = useSidebar();
const { t } = useI18nText();

function handlePatchNotesClick(mobile, event, navigate) {
  if (mobile) {
    setMobileOpen(false);
  }
  if (props.unreadPatchNotesCount > 0) {
    event.preventDefault();
    emit('open-patch-notes');
    return;
  }
  navigate(event);
}

const iconByRoute = {
  home: House,
  advisor: Sparkles,
  'food-optimizer': Utensils,
  enhancement: ShieldPlus,
  'dungeon-calculator': Castle,
  skilling: Sword,
  'trigger-optimizer': SlidersHorizontal,
  'budget-optimizer': Wallet,
  queue: ListChecks,
  'multi-results': ChartNoAxesColumnIncreasing,
  settings: Settings,
  guide: BookOpen,
};

const groupLabels = computed(() => ({
  simulation: t('common:vue.app.navSimulation', 'Simulation'),
  tools: t('common:vue.app.navTools', 'Tools'),
  support: t('common:vue.app.navSupport', 'Support'),
}));

const navigationGroups = computed(() => {
  const items = router
    .getRoutes()
    .filter((entry) => entry.meta?.navOrder && !entry.meta?.navHidden)
    .sort((left, right) => left.meta.navOrder - right.meta.navOrder)
    .map((entry) => ({
      name: entry.name,
      path: entry.path,
      group: entry.meta.navGroup,
      label: t(entry.meta.navLabelKey, entry.meta.navLabel),
      icon: iconByRoute[entry.name],
    }));

  return ['simulation', 'tools', 'support'].map((id) => ({
    id,
    label: groupLabels.value[id],
    items: items.filter((item) => item.group === id),
  }));
});

// 展开分组与当前路由分组同步：导航到某分组路由（首次导航完成与运行期切换均触发）
// 时把该分组并集补入展开列表——收起的 AccordionContent 不渲染（reka Presence），否则
// 当前页高亮链接会从 DOM 消失。只增不删：用户手动展开/收起的状态不被重置；watch 源是
// 路由分组，停留原地手动收起不会被弹开，跨组切回才重新展开。
// immediate：main.js 同步挂载、路由全部懒加载，mount 时首次导航尚未完成、首跑分组为
// 空不动作，导航完成后自动并入；同时兼容先完成导航再挂载的测试时序。
const expandedGroups = ref(['simulation']);

watch(
  () => route.meta?.navGroup,
  (group) => {
    if (group && !expandedGroups.value.includes(group)) {
      expandedGroups.value = [...expandedGroups.value, group];
    }
  },
  { immediate: true },
);

const feedbackLabel = computed(() => t('common:vue.app.feedback', 'Feedback'));
const githubLabel = computed(() => t('common:vue.app.feedbackGitHubAriaLabel', 'GitHub Repository'));

// 主站导入脚本状态行（更新日志上方）：状态判定在服务层（纯函数，见
// services/mainSiteImportScriptStatus.js），这里只负责取词与拼装 tooltip。
const importScriptUrl = MAIN_SITE_IMPORT_SCRIPT_URL;
const {
  status: importScriptStatus,
  installedVersion,
  expectedVersion,
  coverage: importScriptCoverage,
} = useMainSiteImportScriptStatus();

// 当前站点不在脚本 @match 范围内（自定义域名 / 自建镜像）：脚本在本站点永远不会被注入，
// 安装入口即使点了也装不到生效的脚本。此时状态行降级为中性说明并去掉安装/更新动作，
// 不再常驻「未安装」把用户困在「下载 → 装 → 仍报未安装」的循环里。
// unknown（匹配列表未注入等无法判断的情况）不降级，保持原行为。
const importScriptUnsupported = computed(() => importScriptCoverage.value === IMPORT_SCRIPT_COVERAGE_UNCOVERED);

// 更新渠道列表（站点优先、GreasyFork 备用）。主入口被部署方显式禁用时保持原状：
// 侧栏不重新打开安装入口，因此这里也退化为空列表。
const importScriptChannels = importScriptUrl ? MAIN_SITE_IMPORT_SCRIPT_CHANNELS : [];
const importScriptChannelDialogOpen = ref(false);

// 只有「待更新 / 可更新」才需要弹渠道选择：脚本可能装自站点、也可能装自 GreasyFork，
// 直接跳某一个来源会把另一边的用户带到打不开的地址。未安装仍是直链安装（默认站点），
// 已最新仍是直链重装，避免多点一步。
const importScriptNeedsChannelChoice = computed(
  () =>
    !importScriptUnsupported.value &&
    importScriptChannels.length > 1 &&
    (importScriptStatus.value === IMPORT_SCRIPT_STATUS_OUTDATED ||
      importScriptStatus.value === IMPORT_SCRIPT_STATUS_LEGACY),
);

const importScriptAction = computed(() => {
  if (!importScriptUrl || importScriptUnsupported.value) {
    return 'none';
  }
  return importScriptNeedsChannelChoice.value ? 'choose-channel' : 'open';
});

// 同一条状态行在三种语义间切换：无链接（未配置）/ 新窗口直链（安装、重装）/
// 打开渠道弹窗的按钮（更新）。用动态标签而不是永远用 button，是为了保留直链的
// 中键新标签、右键复制地址等浏览器原生行为。脚本不覆盖当前站点时只能是不可点击的行。
const importScriptEntryTag = computed(() => {
  if (!importScriptUrl || importScriptUnsupported.value) {
    return 'div';
  }
  return importScriptNeedsChannelChoice.value ? 'button' : 'a';
});

const importScriptEntryAttrs = computed(() => {
  if (!importScriptUrl || importScriptUnsupported.value) {
    return {};
  }
  if (importScriptNeedsChannelChoice.value) {
    return {
      type: 'button',
      'aria-haspopup': 'dialog',
    };
  }
  return {
    href: importScriptUrl,
    target: '_blank',
    rel: 'noopener noreferrer',
  };
});

function handleImportScriptEntryClick(mobile, event) {
  if (importScriptUnsupported.value || !importScriptNeedsChannelChoice.value) {
    return;
  }
  // 更新入口是按钮而不是链接，不会有原生跳转；preventDefault 仅用于防御后续误改成 <a>。
  event?.preventDefault?.();
  if (mobile) {
    setMobileOpen(false);
  }
  importScriptChannelDialogOpen.value = true;
}

function closeImportScriptChannelDialog() {
  importScriptChannelDialogOpen.value = false;
}

const importScriptLabel = computed(() => {
  // 无安装链接（部署方显式禁用）时整行不可点击：统一走「待配置」口径，
  // 不再显示「点击安装」这类误导性措辞（与首页弹窗的 pending 文案一致）。
  if (!importScriptUrl) {
    return t('common:vue.settings.mainSiteImportScriptPending', 'Script link pending');
  }

  // 脚本 @match 不覆盖当前站点：本站点注定检测不到、也装不上生效的脚本，
  // 必须给出中性说明而不是「未安装 + 安装入口」。
  if (importScriptUnsupported.value) {
    return t('common:vue.app.importScriptUnsupported', 'Import script does not apply to this domain');
  }

  if (importScriptStatus.value === IMPORT_SCRIPT_STATUS_CURRENT) {
    return t('common:vue.app.importScriptInstalled', 'Import Script v{{version}}', {
      version: installedVersion.value || expectedVersion,
    });
  }

  if (importScriptStatus.value === IMPORT_SCRIPT_STATUS_OUTDATED) {
    return t('common:vue.app.importScriptOutdated', 'Update Import Script');
  }

  // 旧版脚本已安装、但不上报版本：必须说「已安装、待更新」，不能说「未安装」。
  if (importScriptStatus.value === IMPORT_SCRIPT_STATUS_LEGACY) {
    return t('common:vue.app.importScriptLegacy', 'Import Script: Update Available');
  }

  if (importScriptStatus.value === IMPORT_SCRIPT_STATUS_MISSING) {
    return t('common:vue.app.importScriptMissing', 'Install Import Script');
  }

  return t('common:vue.app.importScriptInstalled', 'Import Script v{{version}}', {
    version: installedVersion.value || expectedVersion,
  });
});

const importScriptTooltip = computed(() => {
  // 无安装链接时与 label 同口径（见 importScriptLabel 的注释）。
  if (!importScriptUrl) {
    return t('common:vue.settings.mainSiteImportScriptPending', 'Script link pending');
  }

  // 自建镜像 / 自定义域名：脚本只匹配官方部署地址与本地开发端口，装在本站点不会生效。
  // 自建部署的完整要求（@match 与模拟器页判断）见脚本 README。
  if (importScriptUnsupported.value) {
    return t(
      'common:vue.app.importScriptUnsupportedHint',
      'This domain is not covered by the import script, so installing it here has no effect. For self-hosted deployments, adjust the script matching rules as described in scripts/mwi-main-site-import.README.md.',
    );
  }

  if (importScriptStatus.value === IMPORT_SCRIPT_STATUS_CURRENT) {
    return t('common:vue.app.importScriptInstalledHint', 'Main-site import script is up to date: v{{version}}', {
      version: installedVersion.value || expectedVersion,
    });
  }

  if (importScriptStatus.value === IMPORT_SCRIPT_STATUS_OUTDATED) {
    return t(
      'common:vue.app.importScriptOutdatedHint',
      'Installed v{{installed}} is older than v{{expected}}. Click to choose an update channel.',
      { installed: installedVersion.value, expected: expectedVersion },
    );
  }

  if (importScriptStatus.value === IMPORT_SCRIPT_STATUS_LEGACY) {
    return t(
      'common:vue.app.importScriptLegacyHint',
      'Import script detected, but it is an older version that cannot report its version number. Click to choose a channel and update to v{{version}}.',
      { version: expectedVersion || '-' },
    );
  }

  if (importScriptStatus.value === IMPORT_SCRIPT_STATUS_MISSING) {
    return t(
      'common:vue.app.importScriptMissingHint',
      'No main-site import script detected. Click to install v{{version}}.',
      {
        version: expectedVersion || '-',
      },
    );
  }

  return t('common:vue.app.importScriptInstalledHint', 'Main-site import script is up to date: v{{version}}', {
    version: installedVersion.value || expectedVersion,
  });
});
</script>

<style scoped>
.sidebar-action {
  display: flex;
  width: 100%;
  min-height: 2.25rem;
  align-items: center;
  gap: 0.75rem;
  border-radius: 0.375rem;
  padding: 0.5rem 0.75rem;
  color: color-mix(in oklab, var(--sidebar-foreground) 68%, transparent);
  font-size: 0.8125rem;
  font-weight: 500;
  text-decoration: none;
  transition:
    color 150ms ease,
    background-color 150ms ease;
}

.sidebar-action:hover {
  background: var(--sidebar-accent);
  color: var(--sidebar-accent-foreground);
}

.sidebar-action-active {
  background: var(--sidebar-accent);
  color: var(--sidebar-accent-foreground);
}

.sidebar-unread-indicator {
  display: grid;
  flex-shrink: 0;
  place-items: center;
}

.sidebar-unread-indicator-collapsed {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
}

.sidebar-unread-badge {
  display: grid;
  min-width: 1.125rem;
  height: 1.125rem;
  padding: 0 0.3rem;
  place-items: center;
  border-radius: 9999px;
  background: var(--sidebar-primary);
  color: var(--sidebar-primary-foreground);
  font-size: 0.6875rem;
  font-weight: 700;
  line-height: 1;
}

/* 导入脚本状态点：绿=最新，橙=需更新，灰=未检测到。与文字标签同色系，避免只用颜色传达状态。 */
.sidebar-script-dot {
  display: block;
  flex-shrink: 0;
  width: 0.5rem;
  height: 0.5rem;
  margin-left: auto;
  border-radius: 9999px;
  background: color-mix(in oklab, var(--muted-foreground) 55%, transparent);
}

.sidebar-script-dot-collapsed {
  position: absolute;
  top: 0.3rem;
  right: 0.3rem;
  margin-left: 0;
}

.sidebar-script-dot.is-current {
  background: var(--success);
}

.sidebar-script-dot.is-outdated {
  background: var(--warning);
}

.sidebar-script-dot.is-legacy {
  background: var(--warning);
}
</style>

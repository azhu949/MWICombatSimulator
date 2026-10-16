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
      <!-- 折叠态（桌面图标模式）：保持原平面图标列表，不渲染手风琴。 -->
      <template v-if="collapsed">
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
      <Accordion v-else type="multiple" v-model:model-value="expandedGroups">
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
import { useI18nText } from '../composables/useI18nText.js';
import logoUrl from '../assets/logo-256.png';

const props = defineProps({
  version: { type: String, required: true },
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
</style>

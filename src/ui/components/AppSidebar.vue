<template>
  <Sidebar v-slot="{ collapsed, mobile }">
    <div
      class="flex h-14 shrink-0 items-center border-b border-sidebar-border px-3"
      :class="collapsed ? 'justify-center' : 'gap-2.5'"
    >
      <div
        class="grid size-9 shrink-0 place-items-center rounded-md border border-primary/35 bg-primary/10 font-heading text-sm font-bold text-primary"
      >
        MW
      </div>
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
      <div v-for="group in navigationGroups" :key="group.id" class="mb-4 last:mb-0">
        <p v-if="!collapsed" class="mb-1.5 px-2 text-[11px] font-semibold uppercase text-muted-foreground">
          {{ group.label }}
        </p>
        <div class="space-y-1">
          <RouterLink
            v-for="item in group.items"
            :key="item.name"
            :to="item.path"
            class="group flex h-10 items-center rounded-md px-3 text-[15px] font-medium text-sidebar-foreground/72 outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            :class="[
              collapsed ? 'justify-center px-0' : 'gap-3',
              route.name === item.name ? 'bg-sidebar-accent text-sidebar-accent-foreground' : '',
            ]"
            :title="collapsed ? item.label : undefined"
            @click="mobile && setMobileOpen(false)"
          >
            <component :is="item.icon" class="size-[1.125rem] shrink-0" />
            <span v-if="!collapsed" class="truncate">{{ item.label }}</span>
          </RouterLink>
        </div>
      </div>
    </nav>

    <div class="shrink-0 space-y-1 border-t border-sidebar-border p-2">
      <RouterLink
        to="/patch-notes"
        class="sidebar-action relative"
        :class="[collapsed ? 'justify-center' : '', route.name === 'patch-notes' ? 'sidebar-action-active' : '']"
        :aria-label="patchNotesLabel"
        :title="patchNotesLabel"
        @click="mobile && setMobileOpen(false)"
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
import { computed } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import {
  BookOpen,
  ChartNoAxesColumnIncreasing,
  GitFork,
  House,
  ListChecks,
  MessageSquare,
  ScrollText,
  Settings,
  ShieldPlus,
  Sparkles,
  Sword,
  X,
} from '@lucide/vue';
import { Button } from '@/ui/components/ui/button/index.js';
import { Sidebar, useSidebar } from '@/ui/components/ui/sidebar/index.js';
import { useI18nText } from '../composables/useI18nText.js';

const props = defineProps({
  version: { type: String, required: true },
  unreadPatchNotesCount: { type: Number, default: 0 },
  patchNotesLabel: { type: String, default: 'Patch Notes' },
});

const unreadBadgeLabel = computed(() =>
  props.unreadPatchNotesCount > 99 ? '99+' : String(props.unreadPatchNotesCount),
);

const emit = defineEmits(['feedback']);
const router = useRouter();
const route = useRoute();
const { setMobileOpen } = useSidebar();
const { t } = useI18nText();

const iconByRoute = {
  home: House,
  advisor: Sparkles,
  enhancement: ShieldPlus,
  skilling: Sword,
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

<template>
  <div ref="rootRef" class="flex w-full items-start gap-6">
    <aside class="sticky top-16 hidden w-60 shrink-0 lg:block">
      <nav class="max-h-[calc(100vh-6rem)] overflow-y-auto rounded-lg border border-border bg-card p-3">
        <p class="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {{ t('common:vue.app.patchNotesVersionsNav', 'Versions') }}
        </p>
        <ul class="space-y-0.5">
          <li v-for="entry in entries" :key="entry.entryId">
            <button
              type="button"
              class="w-full rounded-md px-2 py-1.5 text-left text-sm leading-5 transition-colors"
              :class="
                activeEntryId === entry.entryId
                  ? 'bg-primary/10 font-semibold text-primary'
                  : 'text-foreground/80 hover:bg-muted hover:text-foreground'
              "
              @click="scrollToEntry(entry.entryId)"
            >
              {{ entry.label }}
            </button>
          </li>
        </ul>
      </nav>
    </aside>

    <section class="min-w-0 max-w-4xl flex-1 space-y-4">
      <header class="surface-panel">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="font-heading text-2xl font-semibold text-foreground sm:text-3xl">
              {{ t('common:patchNotes', 'Patch Notes') }}
            </h2>
            <p class="mt-2 max-w-3xl text-sm leading-6 text-foreground/85">
              {{
                t(
                  'common:vue.app.patchNotesPageDescription',
                  'Review simulator changes, improvements, and fixes by version.',
                )
              }}
            </p>
            <p class="mt-2 text-xs text-muted-foreground">
              {{
                t(
                  'common:vue.app.patchNotesMarkReadHint',
                  'Unread patch notes are marked as read when you choose Close or View all in the preview dialog, and also when you open this page.',
                )
              }}
            </p>
          </div>
          <span class="status-chip shrink-0">
            {{ t('common:vue.settings.versionsCount', 'Versions', { count: entries.length }) }}
          </span>
        </div>
      </header>

      <div v-if="entries.length > 0" class="space-y-3">
        <article
          v-for="entry in entries"
          :key="entry.entryId"
          :data-entry-id="entry.entryId"
          class="scroll-mt-16 overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm"
        >
          <header class="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-3 sm:px-5">
            <span class="size-1.5 shrink-0 rounded-full bg-primary/70" aria-hidden="true" />
            <h3 class="min-w-0 truncate font-heading text-sm font-semibold leading-6 text-foreground sm:text-base">
              {{ entry.label }}
            </h3>
          </header>

          <div class="px-4 py-4 sm:px-5 sm:py-5">
            <PatchNoteSections :sections="entry.sections" />
          </div>
        </article>
      </div>

      <div v-else class="surface-panel">
        <p class="text-sm text-foreground/85">
          {{ t('common:vue.app.patchNotesEmpty', 'No patch notes yet.') }}
        </p>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import PatchNoteSections from '../components/PatchNoteSections.vue';
import { useI18nText } from '../composables/useI18nText.js';
import { resolvePatchNoteEntries } from '../patchNotes.js';

const { language, t } = useI18nText();
const entries = computed(() => resolvePatchNoteEntries(undefined, language.value));

const activeEntryId = ref('');
// 卡片元素按 entryId 索引（由 collectCardElements 一次性采集，避免内联函数
// ref 在每次渲染时重建闭包并重复 observe）。
const cardElements = new Map();
// Tracks which entry cards currently intersect the scroll-spy band (keyed by
// entryId) so the topmost visible card can be recomputed across callbacks.
const visibleEntryIds = new Set();
let scrollSpyObserver = null;
// 组件根元素引用：将卡片采集范围限定在本组件内，避免全局查询误采其他 [data-entry-id] 元素。
const rootRef = ref(null);

function collectCardElements() {
  cardElements.clear();
  const root = rootRef.value;
  if (!root) {
    return;
  }
  for (const element of root.querySelectorAll('[data-entry-id]')) {
    const entryId = element.getAttribute('data-entry-id');
    if (entryId) {
      cardElements.set(entryId, element);
    }
  }
}

function scrollToEntry(entryId) {
  const element = cardElements.get(entryId);
  if (!element) {
    return;
  }

  activeEntryId.value = entryId;
  element.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setupScrollSpy() {
  scrollSpyObserver?.disconnect();
  scrollSpyObserver = null;
  visibleEntryIds.clear();
  collectCardElements();
  // 首屏显式高亮第一个版本，避免 observer 首帧回调前目录无高亮项。
  activeEntryId.value = entries.value[0]?.entryId ?? '';
  if (typeof IntersectionObserver === 'undefined') {
    return;
  }

  scrollSpyObserver = new IntersectionObserver(
    (observedEntries) => {
      for (const observed of observedEntries) {
        const entryId = observed.target.dataset.entryId;
        if (observed.isIntersecting) {
          visibleEntryIds.add(entryId);
        } else {
          visibleEntryIds.delete(entryId);
        }
      }

      // Recompute the active entry as the topmost (first in document order)
      // currently-visible card, instead of relying on the callback's batch order.
      activeEntryId.value = '';
      for (const [entryId] of cardElements) {
        if (visibleEntryIds.has(entryId)) {
          activeEntryId.value = entryId;
          break;
        }
      }
    },
    {
      rootMargin: '-64px 0px -60% 0px',
      threshold: 0,
    },
  );

  for (const element of cardElements.values()) {
    scrollSpyObserver.observe(element);
  }
}

onMounted(() => {
  setupScrollSpy();
});

// 仅当 entryId 集合实际变化（catalog 增删版本）时才重建 observer 并重置高亮。
// 语言切换只改变 label/sections 文本，entryId 不变、DOM 复用，无需重建，
// 避免把 activeEntryId 重置回第一条造成“高亮指向第一条、视口停在下方”的不一致。
watch(
  () => entries.value.map((entry) => entry.entryId),
  (nextEntryIds, prevEntryIds) => {
    if (nextEntryIds.length !== prevEntryIds.length || nextEntryIds.some((id, index) => id !== prevEntryIds[index])) {
      setupScrollSpy();
    }
  },
);

onBeforeUnmount(() => {
  scrollSpyObserver?.disconnect();
  scrollSpyObserver = null;
});
</script>

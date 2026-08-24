<template>
  <div v-if="sectionList.length > 0" class="space-y-4">
    <section v-for="section in sectionList" :key="section.key">
      <h4 class="mb-2 flex items-center gap-2 font-heading text-sm font-semibold text-foreground">
        <span class="size-2 shrink-0 rounded-full" :class="section.dotClass" aria-hidden="true" />
        {{ section.label }}
      </h4>
      <ul class="list-disc space-y-1.5 pl-6 text-sm leading-6 text-foreground/90">
        <li v-for="(note, index) in sections[section.key]" :key="`${section.key}-${index}`">{{ note }}</li>
      </ul>
    </section>
  </div>
  <p v-else class="text-sm leading-6 text-foreground/85">
    {{ t('common:vue.app.patchNotesEmpty', 'No patch notes yet.') }}
  </p>
</template>

<script setup>
import { computed } from 'vue';
import { useI18nText } from '../composables/useI18nText.js';

// 更新日志分类的静态元数据（key、i18n 键、回退文案与圆点样式）。
const SECTION_DEFINITIONS = [
  {
    key: 'newFeatures',
    labelKey: 'common:vue.app.patchNoteNewFeatures',
    fallback: 'New Features',
    dotClass: 'bg-success',
  },
  {
    key: 'improvements',
    labelKey: 'common:vue.app.patchNoteImprovements',
    fallback: 'Improvements',
    dotClass: 'bg-info',
  },
  {
    key: 'bugFixes',
    labelKey: 'common:vue.app.patchNoteBugFixes',
    fallback: 'Bug Fixes',
    dotClass: 'bg-destructive',
  },
];

const props = defineProps({
  sections: { type: Object, default: () => ({}) },
});

const { t } = useI18nText();

const sectionList = computed(() =>
  SECTION_DEFINITIONS.filter(
    (section) => Array.isArray(props.sections?.[section.key]) && props.sections[section.key].length > 0,
  ).map((section) => ({
    ...section,
    label: t(section.labelKey, section.fallback),
  })),
);
</script>

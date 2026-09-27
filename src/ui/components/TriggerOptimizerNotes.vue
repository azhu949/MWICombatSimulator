<template>
  <BaseModal :open="open" :title="t(titleKey)" panel-class="max-w-2xl" @close="emit('close')">
    <!-- 说明弹窗（结果说明 / 搜索设置说明各用一份实例，见 scope）：结论卡、得分卡、指标卡与设置区
         下面原本平铺的解释性长段落集中在这里，一条一行「标签 + 正文」。条目由页面按「本次报告 /
         当前设置是否适用」组装，弹窗本身只负责渲染，不判断口径。
         scope 只用于区分 DOM 归属（结果说明 vs 设置说明），弹窗内容互不影响。 -->
    <dl class="space-y-3" :data-trigger-optimizer-notes="scope">
      <div v-for="note in notes" :key="note.key" :data-trigger-optimizer-note="note.key">
        <dt class="text-xs font-medium">{{ t(note.labelKey) }}</dt>
        <dd class="text-xs leading-relaxed text-muted-foreground">{{ note.text }}</dd>
        <dd v-if="note.extra" class="mt-1 text-xs leading-relaxed text-muted-foreground">{{ note.extra }}</dd>
      </div>
    </dl>
  </BaseModal>
</template>

<script setup>
import BaseModal from './BaseModal.vue';
import { useI18nText } from '../composables/useI18nText.js';

defineProps({
  open: { type: Boolean, default: false },
  // [{ key, labelKey, text, extra? }]
  notes: { type: Array, default: () => [] },
  titleKey: { type: String, default: 'common:triggerOptimizer.notesTitle' },
  scope: { type: String, default: 'result' },
});
const emit = defineEmits(['close']);
const { t } = useI18nText();
</script>

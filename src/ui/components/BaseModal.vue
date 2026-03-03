<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      @click.self="emit('close')"
    >
      <div
        :class="[
          'w-full rounded-2xl border border-white/15 bg-slate-950 p-6 shadow-2xl',
          panelClass || 'max-w-xl',
        ]"
      >
        <div class="mb-4 flex items-center justify-between">
          <h2 class="font-heading text-xl font-semibold text-amber-300">{{ title }}</h2>
          <button class="action-button-muted" @click="emit('close')">{{ t("common:controls.close", "Close") }}</button>
        </div>
        <div class="space-y-3 text-sm text-slate-200">
          <slot />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { useI18nText } from "../composables/useI18nText.js";

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: "Info",
  },
  panelClass: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["close"]);
const { t } = useI18nText();
</script>

<template>
  <section class="rounded-xl border border-white/10 bg-slate-950/40">
    <button
      class="flex w-full items-center justify-between px-4 py-3 text-left"
      type="button"
      @click="open = !open"
    >
      <span class="font-heading text-sm font-semibold tracking-wide text-slate-100">{{ title }}</span>
      <span class="text-xs text-slate-400">{{ open ? t("common:vue.common.hide", "Hide") : t("common:vue.common.show", "Show") }}</span>
    </button>
    <div v-if="open" class="border-t border-white/10 px-4 py-3">
      <slot />
    </div>
  </section>
</template>

<script setup>
import { ref } from "vue";
import { useI18nText } from "../composables/useI18nText.js";

const props = defineProps({
  title: {
    type: String,
    required: true,
  },
  defaultOpen: {
    type: Boolean,
    default: false,
  },
});

const open = ref(props.defaultOpen);
const { t } = useI18nText();
</script>

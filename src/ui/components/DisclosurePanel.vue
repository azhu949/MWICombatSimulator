<template>
  <section class="rounded-xl border border-white/10 bg-slate-950/40">
    <button type="button"
      :id="buttonId"
      class="flex w-full items-center justify-between px-4 py-3 text-left"
     
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="contentId"
      @click="open = !open"
    >
      <span class="font-heading text-sm font-semibold tracking-wide text-slate-100">{{ title }}</span>
      <span class="text-xs text-slate-400">{{ open ? t("common:vue.common.hide", "Hide") : t("common:vue.common.show", "Show") }}</span>
    </button>
    <div v-if="open" :id="contentId" class="border-t border-white/10 px-4 py-3" role="region" :aria-labelledby="buttonId">
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
const instanceId = Math.random().toString(36).slice(2, 10);
const buttonId = `disclosure-trigger-${instanceId}`;
const contentId = `disclosure-content-${instanceId}`;
</script>

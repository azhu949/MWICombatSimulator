<template>
  <CollapsibleRoot
    v-model:open="open"
    as="section"
    class="overflow-hidden rounded-lg border border-border bg-card text-card-foreground"
  >
    <CollapsibleTrigger
      :id="buttonId"
      class="flex min-h-10 w-full items-center justify-between gap-3 px-4 py-2.5 text-left outline-none transition-colors hover:bg-muted/55 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      :aria-controls="contentId"
    >
      <span class="min-w-0 font-heading text-sm font-semibold text-foreground">{{ title }}</span>
      <span class="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        {{ open ? t("common:vue.common.hide", "Hide") : t("common:vue.common.show", "Show") }}
        <ChevronDown class="size-4 transition-transform duration-200 motion-reduce:transition-none" :class="open ? 'rotate-180' : ''" />
      </span>
    </CollapsibleTrigger>
    <CollapsibleContent
      :id="contentId"
      class="overflow-hidden border-t border-border px-4 py-3 data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down"
      role="region"
      :aria-labelledby="buttonId"
    >
      <slot />
    </CollapsibleContent>
  </CollapsibleRoot>
</template>

<script setup>
import { ref } from "vue";
import { ChevronDown } from "@lucide/vue";
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from "reka-ui";
import { useI18nText } from "../composables/useI18nText.js";

const props = defineProps({
  title: { type: String, required: true },
  defaultOpen: { type: Boolean, default: false },
});

const open = ref(props.defaultOpen);
const { t } = useI18nText();
const instanceId = Math.random().toString(36).slice(2, 10);
const buttonId = `disclosure-trigger-${instanceId}`;
const contentId = `disclosure-content-${instanceId}`;
</script>

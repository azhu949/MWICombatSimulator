<template>
  <Button type="button" variant="ghost" size="icon-sm" :aria-label="label" :title="label" @click="onClick">
    <Menu v-if="mobile" />
    <PanelLeftClose v-else :class="collapsed ? 'rotate-180' : ''" />
  </Button>
</template>

<script setup>
import { computed } from 'vue';
import { Menu, PanelLeftClose } from '@lucide/vue';
import { Button } from '../button/index.js';
import { useSidebar } from './context.js';
import { useI18nText } from '@/ui/composables/useI18nText.js';

const props = defineProps({
  mobile: { type: Boolean, default: false },
});

const { collapsed, setMobileOpen, toggleCollapsed } = useSidebar();
const { t } = useI18nText();
const label = computed(() => {
  if (props.mobile) {
    return t('common:vue.app.openNavigation', 'Open navigation');
  }
  return collapsed.value
    ? t('common:vue.app.expandNavigation', 'Expand navigation')
    : t('common:vue.app.collapseNavigation', 'Collapse navigation');
});

function onClick() {
  if (props.mobile) {
    setMobileOpen(true);
  } else {
    toggleCollapsed();
  }
}
</script>

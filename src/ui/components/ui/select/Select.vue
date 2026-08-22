<template>
  <SelectRoot :key="language" data-slot="select"><slot /></SelectRoot>
</template>

<script setup>
import { SelectRoot } from 'reka-ui';
import { useI18nText } from '@/ui/composables/useI18nText.js';

const { language } = useI18nText();
</script>

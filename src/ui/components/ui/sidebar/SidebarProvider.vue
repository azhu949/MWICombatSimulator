<template>
  <div data-slot="sidebar-wrapper" class="flex min-h-dvh w-full bg-background">
    <slot />
  </div>
</template>

<script setup>
import { provide, ref, watch } from "vue";
import { SIDEBAR_CONTEXT } from "./context.js";

const STORAGE_KEY = "mwi.ui.sidebar.v1";
const storedCollapsed = typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "collapsed";
const collapsed = ref(storedCollapsed);
const mobileOpen = ref(false);

function toggleCollapsed() {
  collapsed.value = !collapsed.value;
}

function setMobileOpen(value) {
  mobileOpen.value = Boolean(value);
}

watch(collapsed, (value) => {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, value ? "collapsed" : "expanded");
  }
});

provide(SIDEBAR_CONTEXT, {
  collapsed,
  mobileOpen,
  setMobileOpen,
  toggleCollapsed,
});
</script>

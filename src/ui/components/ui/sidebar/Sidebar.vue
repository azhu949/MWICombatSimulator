<template>
  <aside
    data-slot="sidebar"
    class="sticky top-0 hidden h-dvh shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 motion-reduce:transition-none md:flex md:flex-col"
    :class="collapsed ? 'w-[68px]' : 'w-[248px]'"
  >
    <slot :collapsed="collapsed" :mobile="false" />
  </aside>

  <DialogRoot :open="mobileOpen" @update:open="setMobileOpen">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-modal-backdrop data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 md:hidden" />
      <DialogContent
        aria-describedby="mobile-sidebar-description"
        class="fixed inset-y-0 left-0 z-50 flex w-[min(86vw,288px)] flex-col border-r border-sidebar-border bg-sidebar p-0 text-sidebar-foreground shadow-2xl outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left md:hidden"
      >
        <DialogTitle class="sr-only">{{ t("common:vue.app.navigation", "Navigation") }}</DialogTitle>
        <DialogDescription id="mobile-sidebar-description" class="sr-only">{{ t("common:vue.app.applicationNavigation", "Application navigation") }}</DialogDescription>
        <slot :collapsed="false" :mobile="true" />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup>
import { onBeforeUnmount, onMounted } from "vue";
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from "reka-ui";
import { useSidebar } from "./context.js";
import { useI18nText } from "@/ui/composables/useI18nText.js";

const { collapsed, mobileOpen, setMobileOpen } = useSidebar();
const { t } = useI18nText();
let desktopMediaQuery = null;

function closeMobileSidebarOnDesktop(event) {
  if (event.matches) {
    setMobileOpen(false);
  }
}

onMounted(() => {
  if (typeof window.matchMedia !== "function") {
    return;
  }

  desktopMediaQuery = window.matchMedia("(min-width: 768px)");
  closeMobileSidebarOnDesktop(desktopMediaQuery);
  desktopMediaQuery.addEventListener("change", closeMobileSidebarOnDesktop);
});

onBeforeUnmount(() => {
  desktopMediaQuery?.removeEventListener("change", closeMobileSidebarOnDesktop);
});
</script>

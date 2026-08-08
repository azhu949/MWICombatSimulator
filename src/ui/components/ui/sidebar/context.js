import { inject } from "vue";

export const SIDEBAR_CONTEXT = Symbol("sidebar-context");

export function useSidebar() {
  const context = inject(SIDEBAR_CONTEXT, null);
  if (!context) {
    throw new Error("Sidebar components must be used inside SidebarProvider.");
  }
  return context;
}

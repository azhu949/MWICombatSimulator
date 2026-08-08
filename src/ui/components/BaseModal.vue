<template>
  <DialogRoot :open="open" @update:open="onOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-modal-backdrop backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogContent
        ref="contentRef"
        :class="cn(
          'fixed left-1/2 top-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-2xl outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:p-6',
          panelClass || 'max-w-xl',
        )"
        @escape-key-down="onEscapeKeyDown"
        @pointer-down-outside="onPointerDownOutside"
        @open-auto-focus="onOpenAutoFocus"
      >
        <div class="flex min-w-0 items-start justify-between gap-4">
          <DialogTitle class="min-w-0 font-heading text-lg font-semibold text-foreground">
            {{ title }}
          </DialogTitle>
          <DialogDescription class="sr-only">{{ title }}</DialogDescription>
          <DialogClose as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              class="-mr-1 -mt-1 text-muted-foreground"
              :aria-label="t('common:controls.close', 'Close')"
            >
              <X />
            </Button>
          </DialogClose>
        </div>
        <div class="modal-body-text min-w-0 space-y-3 text-sm">
          <slot />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup>
import { nextTick, ref } from "vue";
import { X } from "@lucide/vue";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";
import { Button } from "@/ui/components/ui/button/index.js";
import { cn } from "@/ui/lib/utils.js";
import { useI18nText } from "../composables/useI18nText.js";

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: "Info" },
  panelClass: { type: String, default: "" },
  closeOnEsc: { type: Boolean, default: true },
  closeOnBackdrop: { type: Boolean, default: true },
  initialFocusSelector: { type: String, default: "" },
});

const emit = defineEmits(["close"]);
const { t } = useI18nText();
const contentRef = ref(null);

function onOpenChange(nextOpen) {
  if (!nextOpen) {
    emit("close");
  }
}

function onEscapeKeyDown(event) {
  if (!props.closeOnEsc) {
    event.preventDefault();
  }
}

function onPointerDownOutside(event) {
  if (!props.closeOnBackdrop) {
    event.preventDefault();
  }
}

async function onOpenAutoFocus(event) {
  const selector = String(props.initialFocusSelector || "").trim();
  if (!selector) {
    return;
  }

  event.preventDefault();
  await nextTick();
  const element = contentRef.value?.$el?.querySelector?.(selector)
    || document.querySelector(selector);
  if (element instanceof HTMLElement) {
    element.focus();
  }
}
</script>

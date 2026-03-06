<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      @click.self="onBackdropClick"
    >
      <div
        ref="dialogRef"
        :class="[
          'w-full rounded-2xl border border-white/15 bg-slate-950 p-6 shadow-2xl',
          panelClass || 'max-w-xl',
        ]"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
      >
        <div class="mb-4 flex items-center justify-between">
          <h2 :id="titleId" class="font-heading text-xl font-semibold text-amber-300">{{ title }}</h2>
          <button type="button" class="action-button-muted" @click="emit('close')">{{ t("common:controls.close", "Close") }}</button>
        </div>
        <div class="space-y-3 text-sm text-slate-200">
          <slot />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
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
  closeOnEsc: {
    type: Boolean,
    default: true,
  },
  closeOnBackdrop: {
    type: Boolean,
    default: true,
  },
  initialFocusSelector: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["close"]);
const { t } = useI18nText();
const dialogRef = ref(null);
const previousFocusedElement = ref(null);
const instanceId = Math.random().toString(36).slice(2, 10);
const titleId = `base-modal-title-${instanceId}`;
const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function getFocusableElements() {
  if (!dialogRef.value) {
    return [];
  }
  return Array.from(dialogRef.value.querySelectorAll(focusableSelector))
    .filter((element) => element instanceof HTMLElement && !element.hasAttribute("disabled"));
}

function focusInitialElement() {
  if (!dialogRef.value) {
    return;
  }

  const selector = String(props.initialFocusSelector || "").trim();
  if (selector) {
    const matched = dialogRef.value.querySelector(selector);
    if (matched instanceof HTMLElement) {
      matched.focus();
      return;
    }
  }

  const focusableElements = getFocusableElements();
  if (focusableElements.length > 0) {
    focusableElements[0].focus();
    return;
  }

  dialogRef.value.focus();
}

function restoreFocus() {
  const element = previousFocusedElement.value;
  previousFocusedElement.value = null;
  if (element instanceof HTMLElement && element.isConnected) {
    element.focus();
  }
}

function onBackdropClick() {
  if (props.closeOnBackdrop) {
    emit("close");
  }
}

function onDocumentKeydown(event) {
  if (!props.open) {
    return;
  }

  if (event.key === "Escape") {
    if (props.closeOnEsc) {
      event.preventDefault();
      emit("close");
    }
    return;
  }

  if (event.key !== "Tab" || !dialogRef.value) {
    return;
  }

  const focusableElements = getFocusableElements();
  if (focusableElements.length === 0) {
    event.preventDefault();
    dialogRef.value.focus();
    return;
  }

  const first = focusableElements[0];
  const last = focusableElements[focusableElements.length - 1];
  const active = document.activeElement;

  if (event.shiftKey) {
    if (active === first || !dialogRef.value.contains(active)) {
      event.preventDefault();
      last.focus();
    }
    return;
  }

  if (active === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(
  () => props.open,
  async (nextOpen) => {
    if (nextOpen) {
      previousFocusedElement.value = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      document.addEventListener("keydown", onDocumentKeydown);
      await nextTick();
      focusInitialElement();
      return;
    }

    document.removeEventListener("keydown", onDocumentKeydown);
    restoreFocus();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onDocumentKeydown);
  restoreFocus();
});
</script>

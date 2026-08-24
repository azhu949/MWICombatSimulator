<template>
  <DialogRoot :open="open" @update:open="onOpenChange">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-50 bg-modal-backdrop backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      />
      <DialogContent
        ref="contentRef"
        :class="
          cn(
            'fixed left-1/2 top-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-2xl outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:p-6',
            panelClass || 'max-w-xl',
          )
        "
        @escape-key-down="onEscapeKeyDown"
        @pointer-down-outside="onPointerDownOutside"
        @open-auto-focus="onOpenAutoFocus"
      >
        <div class="flex min-w-0 items-start justify-between gap-4">
          <DialogTitle class="min-w-0 font-heading text-lg font-semibold text-foreground">
            {{ title }}
          </DialogTitle>
          <DialogDescription class="sr-only">{{ title }}</DialogDescription>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            class="-mr-1 -mt-1 text-muted-foreground"
            :aria-label="t('common:controls.close', 'Close')"
            @click="onCloseButtonClick"
          >
            <X />
          </Button>
        </div>
        <div class="modal-body-text min-w-0 space-y-3 text-sm">
          <slot />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup>
import { nextTick, ref } from 'vue';
import { X } from '@lucide/vue';
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { Button } from '@/ui/components/ui/button/index.js';
import { cn } from '@/ui/lib/utils.js';
import { useI18nText } from '../composables/useI18nText.js';

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: 'Info' },
  panelClass: { type: String, default: '' },
  closeOnEsc: { type: Boolean, default: true },
  closeOnBackdrop: { type: Boolean, default: true },
  initialFocusSelector: { type: String, default: '' },
});

const emit = defineEmits(['close']);
const { t } = useI18nText();
const contentRef = ref(null);
// 关闭原因语义（供父组件区分“已读/暂不阅读”等行为）：
// - 'programmatic' / 'close-button'：显式关闭（视为“已读/确认”）。
//   （父组件显式关闭 / 点击右上角 X 按钮）。
// - 'escape' / 'backdrop'：用户“暂不阅读”的关闭方式（Esc 键 / 点击遮罩）。
//
// 时序说明（为何用普通 let 记录原因、在 onOpenChange 中消费是安全的）：
// Reka UI 的 DismissableLayer 在同一次交互内「先派发 escape-key-down /
// pointer-down-outside 事件，再在未被 preventDefault 时触发 dismiss →
// update:open(false)」——二者在同一同步函数内顺序执行（escape 分支先
// emits('escapeKeyDown') 再 emits('dismiss')；pointer-down 分支在 await nextTick()
// 之后才 emits('dismiss')，见 reka-ui/src/DismissableLayer/DismissableLayer.vue）。
// 因此 onEscapeKeyDown / onPointerDownOutside 写入的 lastCloseReason 一定先于
// onOpenChange(false) 被读到。若未来升级 Reka 改变该顺序，需同步调整此处，
// 否则 Esc / 遮罩会被误判为 programmatic 而错误标记已读。
let lastCloseReason = 'programmatic';

function onOpenChange(nextOpen) {
  // 受控用法下 Reka UI 仅在内部请求关闭时触发 update:open(false)；
  // 打开态由父组件 :open 驱动，不会触发 update:open(true)。
  if (nextOpen) {
    return;
  }
  emitClose();
}

function onCloseButtonClick() {
  lastCloseReason = 'close-button';
  emitClose();
}

function emitClose() {
  emit('close', lastCloseReason);
  lastCloseReason = 'programmatic';
}

function onEscapeKeyDown(event) {
  if (!props.closeOnEsc) {
    event.preventDefault();
    return;
  }
  lastCloseReason = 'escape';
}

function onPointerDownOutside(event) {
  if (!props.closeOnBackdrop) {
    event.preventDefault();
    return;
  }
  lastCloseReason = 'backdrop';
}

async function onOpenAutoFocus(event) {
  const selector = String(props.initialFocusSelector || '').trim();
  if (!selector) {
    return;
  }

  event.preventDefault();
  await nextTick();
  // 有意只查询弹窗内部：避免全局 document.querySelector 误聚焦弹窗外元素。
  // 所有调用方的 initialFocusSelector 均指向弹窗内元素，无需全局 fallback。
  const element = contentRef.value?.$el?.querySelector?.(selector);
  if (element instanceof HTMLElement) {
    element.focus();
  }
}
</script>

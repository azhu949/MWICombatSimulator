<template>
  <section class="mx-auto max-w-5xl space-y-4">
    <header class="surface-panel">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="font-heading text-2xl font-semibold text-foreground sm:text-3xl">
            {{ t("common:patchNotes", "Patch Notes") }}
          </h2>
          <p class="mt-2 max-w-3xl text-sm leading-6 text-foreground/85">
            {{ t("common:vue.app.patchNotesPageDescription", "Review simulator changes, fixes, and interaction updates by version.") }}
          </p>
          <p class="mt-2 text-xs text-muted-foreground">
            {{ t("common:vue.app.patchNotesMarkReadHint", "Unread patch notes are marked as read when you open this page.") }}
          </p>
        </div>
        <span class="status-chip shrink-0">
          {{ t("common:vue.settings.versionsCount", "Versions", { count: entries.length }) }}
        </span>
      </div>
    </header>

    <div
      v-if="entries.length > 0"
      class="overflow-hidden rounded-lg border border-border bg-card text-card-foreground"
    >
      <article
        v-for="entry in entries"
        :key="entry.entryId"
        class="grid border-b border-border last:border-b-0 md:grid-cols-[14rem_minmax(0,1fr)]"
      >
        <header class="border-b border-border bg-muted/30 px-4 py-4 md:border-b-0 md:border-r md:px-5 md:py-5">
          <h3 class="font-heading text-sm font-semibold leading-6 text-foreground">
            {{ entry.label }}
          </h3>
        </header>

        <div class="px-4 py-4 md:px-6 md:py-5">
          <ul v-if="entry.notes.length > 0" class="list-disc space-y-2 pl-5 text-sm leading-6 text-foreground">
            <li v-for="note in entry.notes" :key="note">{{ note }}</li>
          </ul>
          <p v-else class="text-sm leading-6 text-foreground/85">
            {{ t("common:vue.app.patchNotesEmpty", "No patch notes yet.") }}
          </p>
        </div>
      </article>
    </div>

    <div v-else class="surface-panel">
      <p class="text-sm text-foreground/85">
        {{ t("common:vue.app.patchNotesEmpty", "No patch notes yet.") }}
      </p>
    </div>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { useI18nText } from "../composables/useI18nText.js";
import { resolvePatchNoteEntries } from "../patchNotes.js";

const { language, t } = useI18nText();
const entries = computed(() => resolvePatchNoteEntries(undefined, language.value));
</script>

<template>
    <div class="space-y-4">
        <div class="border-b border-border pb-3">
            <h2 class="font-heading text-lg font-semibold text-primary">
                {{ t("common:vue.home.workspaceAdvancedTitle", "Battle Attributes") }}
            </h2>
            <p class="mt-1 text-sm text-muted-foreground">
                {{
                    t(
                        "common:vue.home.workspaceAdvancedDesc",
                        "Review the full derived combat attributes for the current build.",
                    )
                }}
            </p>
        </div>

        <div v-if="sections.length > 0" class="space-y-8">
            <section v-for="section in sections" :key="section.key" class="space-y-3">
                <header class="flex items-center gap-3 px-1">
                    <span
                        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-primary/20 bg-primary/10 text-primary"
                    >
                        <component :is="section.icon" class="h-4 w-4" aria-hidden="true" />
                    </span>
                    <h3 class="font-heading text-[15px] font-semibold text-foreground">{{ section.title }}</h3>
                    <span class="h-px min-w-6 flex-1 bg-border" aria-hidden="true"></span>
                </header>
                <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <article
                        v-for="entry in section.rows"
                        :key="entry.key"
                        :class="[
                            'min-h-[4.75rem] min-w-0 rounded-md border px-4 py-3.5 shadow-sm transition-colors',
                            entry.hasSources
                                ? 'border-primary/30 bg-primary/5 hover:bg-primary/10'
                                : 'border-border bg-card hover:bg-muted/50',
                        ]"
                    >
                        <div class="flex min-w-0 items-start justify-between gap-3">
                            <p
                                class="min-w-0 break-words text-sm font-medium leading-5 text-foreground/80"
                                :title="entry.label"
                            >
                                {{ entry.label }}
                            </p>
                            <p
                                class="max-w-[55%] shrink-0 break-words text-right font-heading text-base font-semibold leading-5 tabular-nums text-foreground"
                            >
                                {{ entry.value }}
                            </p>
                        </div>
                        <p
                            v-if="entry.breakdownText"
                            class="mt-1.5 whitespace-normal break-words text-xs leading-5 tabular-nums text-muted-foreground"
                            :title="entry.breakdownText"
                        >
                            <span
                                v-for="part in entry.breakdownParts"
                                :key="part.key"
                                :class="['mr-1.5 last:mr-0', part.kind === 'source' ? 'font-medium text-primary' : '']"
                                >{{ part.text }}</span
                            >
                        </p>
                        <div v-else class="h-4" aria-hidden="true"></div>
                    </article>
                </div>
            </section>
        </div>
        <p v-else class="text-sm text-muted-foreground">{{ t("common:multiRound.noData", "No data") }}</p>
    </div>
</template>

<script setup>
import { useI18nText } from "../../composables/useI18nText.js";

defineProps({ sections: { type: Array, required: true } });
const { t } = useI18nText();
</script>

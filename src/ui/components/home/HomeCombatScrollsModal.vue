<template>
    <BaseModal
        :open="open"
        :title="t('common:vue.home.combatScrolls.title', 'Combat Scrolls')"
        panel-class="max-w-[94vw] lg:max-w-4xl"
        @close="$emit('close')"
    >
        <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div class="space-y-1">
                <p class="text-xs text-muted-foreground">
                    {{
                        t(
                            "common:vue.home.combatScrolls.hint",
                            "Selected scrolls open at t=0 while effects are enabled and renew when their current effect expires while stock remains.",
                        )
                    }}
                </p>
                <p class="text-xs font-medium text-foreground/85">{{ configuredCombatScrollSummary }}</p>
            </div>
            <div class="flex flex-wrap gap-2">
                <button
                    type="button"
                    class="button-secondary"
                    :disabled="
                        combatScrollOptions.length === 0 || configuredCombatScrollCount === combatScrollOptions.length
                    "
                    @click="setAllCombatScrollsConfigured(true)"
                >
                    {{ t("common:vue.home.selectAll", "Select All") }}
                </button>
                <button
                    type="button"
                    class="button-secondary"
                    :disabled="configuredCombatScrollCount === 0"
                    @click="setAllCombatScrollsConfigured(false)"
                >
                    {{ t("common:vue.home.clearAll", "Clear All") }}
                </button>
            </div>
        </div>
        <div
            v-if="!combatScrollsEffectsEnabled"
            class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning"
            role="status"
        >
            <span>{{
                t(
                    "common:vue.home.combatScrolls.disabledHint",
                    "Combat scroll effects are paused. The selections and quantities below are retained.",
                )
            }}</span>
            <button type="button" class="button-secondary" @click="setCombatScrollsEnabled(true)">
                {{ t("common:vue.home.combatScrolls.enableNow", "Enable Effects") }}
            </button>
        </div>
        <div
            v-if="simulator.simulationSettings.mode === 'labyrinth'"
            class="mb-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning"
            role="status"
        >
            {{
                t(
                    "common:vue.home.combatScrolls.ignoredLabyrinth",
                    "Scrolls are configured but are not effective in Labyrinth. The configuration is kept for other targets.",
                )
            }}
        </div>
        <div class="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
            <div
                v-for="(scroll, scrollIndex) in combatScrollOptions"
                :key="scroll.itemHrid || scroll.hrid"
                class="rounded-md border border-border bg-muted/30 p-2"
            >
                <div class="flex flex-wrap items-center gap-2">
                    <label class="flex min-w-0 flex-1 items-center gap-2 text-sm text-foreground">
                        <input
                            type="checkbox"
                            :checked="combatScrollViewModels[scrollIndex].enabled"
                            :aria-label="combatScrollViewModels[scrollIndex].name"
                            @change="setCombatScrollEnabled(scroll, $event.target.checked)"
                        />
                        <span class="truncate">{{ combatScrollViewModels[scrollIndex].name }}</span>
                        <span
                            v-if="
                                combatScrollViewModels[scrollIndex].enabled &&
                                combatScrollViewModels[scrollIndex].quantityInput === ''
                            "
                            class="shrink-0 text-[11px] text-primary"
                            >{{ t("common:vue.home.combatScrolls.unlimitedLabel", "Unlimited inventory") }}</span
                        >
                    </label>
                    <label class="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{{ t("common:vue.home.combatScrolls.quantity", "Quantity") }}</span>
                        <input
                            class="control-input w-24 py-1 text-right tabular-nums"
                            type="text"
                            inputmode="numeric"
                            pattern="[0-9]*"
                            :disabled="!combatScrollViewModels[scrollIndex].enabled"
                            :value="combatScrollViewModels[scrollIndex].quantityInput"
                            :placeholder="t('common:vue.home.combatScrolls.unlimitedPlaceholder', 'Unlimited')"
                            :aria-label="`${combatScrollViewModels[scrollIndex].name} ${t('common:vue.home.combatScrolls.quantity', 'Quantity')}`"
                            :aria-invalid="Boolean(combatScrollViewModels[scrollIndex].quantityError)"
                            @input="setCombatScrollQuantity(scroll, $event.target.value)"
                        />
                    </label>
                </div>
                <p
                    v-if="combatScrollViewModels[scrollIndex].quantityError"
                    class="mt-1 pl-6 text-xs text-destructive"
                    role="alert"
                >
                    {{ combatScrollViewModels[scrollIndex].quantityError }}
                </p>
                <p class="mt-1 pl-6 text-xs text-muted-foreground">
                    {{ combatScrollViewModels[scrollIndex].effect }} ·
                    {{ combatScrollViewModels[scrollIndex].durationLabel }}
                </p>
            </div>
        </div>
        <p v-if="combatScrollOptions.length === 0" class="text-sm text-muted-foreground">
            {{ t("common:vue.home.combatScrolls.unavailable", "No combat scroll data is available.") }}
        </p>
    </BaseModal>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { combatScrollOptions, normalizeCombatScrolls } from "../../../shared/combatScrolls.js";
import { itemDetailIndex as itemDetailMap } from "../../../shared/gameDataIndex.js";
import { useSimulatorStore } from "../../../stores/simulatorStore.js";
import { useGameDataText } from "../../composables/useGameDataText.js";
import { useI18nText } from "../../composables/useI18nText.js";
import { formatNumber } from "./homeFormatters.js";
import BaseModal from "../BaseModal.vue";

const props = defineProps({ open: { type: Boolean, default: false } });
defineEmits(["close"]);
const simulator = useSimulatorStore();
const { t } = useI18nText();
const { getBuffTypeName, getItemName } = useGameDataText();
const activePlayer = computed(() => simulator.activePlayer);
const combatScrollQuantityErrors = ref({});
const combatScrollQuantityDrafts = ref({});
// 每个 scroll 项的所有派生展示值合并为视图模型，模板只读一次；computed 缓存避免每次重渲染重复调用。
const combatScrollViewModels = computed(() =>
    combatScrollOptions.map((scroll) => ({
        enabled: isCombatScrollEnabled(scroll),
        quantityInput: combatScrollQuantityInput(scroll),
        quantityError: combatScrollQuantityError(scroll),
        name: formatCombatScrollName(scroll),
        effect: formatCombatScrollEffect(scroll),
        durationLabel: formatCombatScrollDurationLabel(scroll),
    })),
);
const combatScrollsEffectsEnabled = computed(() => simulator.simulationSettings.combatScrollsEnabled === true);
const configuredCombatScrollCount = computed(
    () => Object.keys(normalizeCombatScrolls(activePlayer.value?.combatScrolls)).length,
);
const configuredCombatScrollSummary = computed(() =>
    t("common:vue.home.combatScrolls.configuredCount", "{{configured}} of {{total}} scrolls configured", {
        configured: configuredCombatScrollCount.value,
        total: combatScrollOptions.length,
    }),
);

function combatScrollHrid(scrollOrHrid) {
    return scrollOrHrid && typeof scrollOrHrid === "object"
        ? String(scrollOrHrid.itemHrid || scrollOrHrid.hrid || "")
        : String(scrollOrHrid || "");
}
function normalizedActiveCombatScrolls() {
    const player = activePlayer.value;
    if (!player) return {};
    const normalized = normalizeCombatScrolls(player.combatScrolls);
    player.combatScrolls = normalized;
    return normalized;
}
function isCombatScrollEnabled(scroll) {
    const hrid = combatScrollHrid(scroll);
    return Boolean(
        hrid &&
        activePlayer.value?.combatScrolls &&
        Object.prototype.hasOwnProperty.call(activePlayer.value.combatScrolls, hrid),
    );
}
function combatScrollQuantityInput(scroll) {
    const hrid = combatScrollHrid(scroll);
    if (Object.prototype.hasOwnProperty.call(combatScrollQuantityDrafts.value, hrid)) {
        return String(combatScrollQuantityDrafts.value[hrid]);
    }
    const entry = activePlayer.value?.combatScrolls?.[hrid];
    return !entry || entry.quantity === null || entry.quantity === undefined || entry.quantity === ""
        ? ""
        : String(entry.quantity);
}
function combatScrollQuantityError(scroll) {
    return String(combatScrollQuantityErrors.value[combatScrollHrid(scroll)] || "");
}
function clearCombatScrollQuantityError(hrid) {
    if (!Object.prototype.hasOwnProperty.call(combatScrollQuantityErrors.value, hrid)) return;
    const next = { ...combatScrollQuantityErrors.value };
    delete next[hrid];
    combatScrollQuantityErrors.value = next;
}
function setCombatScrollQuantityError(hrid, message) {
    combatScrollQuantityErrors.value = { ...combatScrollQuantityErrors.value, [hrid]: String(message || "") };
}
function clearCombatScrollQuantityDraft(hrid) {
    if (!Object.prototype.hasOwnProperty.call(combatScrollQuantityDrafts.value, hrid)) return;
    const next = { ...combatScrollQuantityDrafts.value };
    delete next[hrid];
    combatScrollQuantityDrafts.value = next;
}
function setCombatScrollQuantityDraft(hrid, value) {
    combatScrollQuantityDrafts.value = { ...combatScrollQuantityDrafts.value, [hrid]: String(value ?? "") };
}
function commitActiveCombatScrolls(next) {
    if (activePlayer.value) activePlayer.value.combatScrolls = normalizeCombatScrolls(next);
}
function setCombatScrollEnabled(scroll, enabled) {
    const hrid = combatScrollHrid(scroll);
    if (!hrid || !activePlayer.value) return;
    clearCombatScrollQuantityError(hrid);
    clearCombatScrollQuantityDraft(hrid);
    const next = normalizedActiveCombatScrolls();
    if (enabled) {
        if (!Object.prototype.hasOwnProperty.call(next, hrid)) next[hrid] = { quantity: null };
    } else delete next[hrid];
    commitActiveCombatScrolls(next);
}
function setCombatScrollsEnabled(enabled) {
    simulator.simulationSettings.combatScrollsEnabled = Boolean(enabled);
}
function setAllCombatScrollsConfigured(enabled) {
    if (!activePlayer.value) return;
    combatScrollQuantityErrors.value = {};
    combatScrollQuantityDrafts.value = {};
    if (!enabled) {
        commitActiveCombatScrolls({});
        return;
    }
    const next = normalizedActiveCombatScrolls();
    for (const scroll of combatScrollOptions) {
        const hrid = combatScrollHrid(scroll);
        if (hrid && !Object.prototype.hasOwnProperty.call(next, hrid)) next[hrid] = { quantity: null };
    }
    commitActiveCombatScrolls(next);
}
function setCombatScrollQuantity(scroll, rawValue) {
    const hrid = combatScrollHrid(scroll);
    if (!hrid || !isCombatScrollEnabled(hrid)) return;
    const text = String(rawValue ?? "");
    if (text === "") {
        const next = normalizedActiveCombatScrolls();
        next[hrid] = { quantity: null };
        clearCombatScrollQuantityDraft(hrid);
        clearCombatScrollQuantityError(hrid);
        commitActiveCombatScrolls(next);
        return;
    }

    if (/^\d+$/.test(text)) {
        const numeric = Number(text);
        if (Number.isSafeInteger(numeric) && numeric > 0) {
            const next = normalizedActiveCombatScrolls();
            next[hrid] = { quantity: numeric };
            clearCombatScrollQuantityDraft(hrid);
            clearCombatScrollQuantityError(hrid);
            commitActiveCombatScrolls(next);
            return;
        }
    }

    setCombatScrollQuantityDraft(hrid, text);
    setCombatScrollQuantityError(
        hrid,
        t("common:vue.home.combatScrolls.invalidQuantity", "Enter a positive whole number."),
    );
}
function formatCombatScrollName(scroll) {
    const hrid = combatScrollHrid(scroll);
    return getItemName(hrid, String(scroll?.name || itemDetailMap?.[hrid]?.name || hrid || "Combat Scroll"));
}
function formatCombatScrollEffect(scroll) {
    if (scroll?.effectLabel) return String(scroll.effectLabel);
    const buff = scroll?.buff && typeof scroll.buff === "object" ? scroll.buff : {};
    const typeHrid = String(buff.typeHrid || scroll?.personalBuffTypeHrid || "");
    const typeName = getBuffTypeName(typeHrid, String(scroll?.name || typeHrid || "Buff"));
    const parts = [];
    const ratioBoost = Number(buff.ratioBoost || 0);
    const flatBoost = Number(buff.flatBoost || 0);
    if (Number.isFinite(ratioBoost) && Math.abs(ratioBoost) > 1e-12)
        parts.push(`${ratioBoost >= 0 ? "+" : ""}${(ratioBoost * 100).toFixed(1).replace(/\.0$/, "")}%`);
    if (Number.isFinite(flatBoost) && Math.abs(flatBoost) > 1e-12)
        parts.push(`${flatBoost >= 0 ? "+" : ""}${(flatBoost * 100).toFixed(1).replace(/\.0$/, "")}%`);
    return parts.length > 0 ? `${typeName} ${parts.join(" / ")}` : typeName;
}
function formatCombatScrollDurationLabel(scroll) {
    const durationNs = Number(scroll?.durationNs ?? scroll?.duration ?? 0);
    return t("common:vue.home.combatScrolls.duration", "{{minutes}} min per opening", {
        minutes: formatNumber(durationNs / (60 * 1e9), 2),
    });
}

watch(
    [() => activePlayer.value, () => props.open],
    () => {
        combatScrollQuantityErrors.value = {};
        combatScrollQuantityDrafts.value = {};
    },
    { immediate: true },
);
</script>

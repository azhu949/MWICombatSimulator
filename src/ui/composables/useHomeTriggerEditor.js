import { computed, reactive, readonly, watch } from "vue";
import { itemDetailIndex as itemDetailMap } from "../../shared/gameDataIndex.js";
import {
    getDefaultTriggerDtosForHrid,
    getEffectiveTriggerState,
    sanitizeTriggerList,
} from "../../services/triggerMapper.js";
import { useSimulatorStore } from "../../stores/simulatorStore.js";
import { useGameDataText } from "./useGameDataText.js";
import { useI18nText } from "./useI18nText.js";

function cloneValue(value) {
    return JSON.parse(JSON.stringify(value));
}

export function useHomeTriggerEditor() {
    const simulator = useSimulatorStore();
    const { t } = useI18nText();
    const { getAbilityName, getItemName } = useGameDataText();
    const activePlayer = computed(() => simulator.activePlayer);
    const state = reactive({
        kind: "",
        index: -1,
        hrid: "",
        draft: [],
        dirty: false,
        blockedMessage: "",
    });
    const activeDraft = computed(() => readonly(state.draft));
    const blockedMessage = computed(() => state.blockedMessage);
    let editingPlayerId = "";

    function formatItemName(hrid, fallback = "") {
        const normalized = String(hrid || "");
        return normalized ? getItemName(normalized, fallback || itemDetailMap?.[normalized]?.name || normalized) : "-";
    }

    function getAbilitySlotLabel(index) {
        const slotIndex = Number(index);
        if (slotIndex === 0) {
            return t("translation:abilitySlot.specialAbility", "Special Ability").replace(/<br\s*\/?>/gi, " ");
        }
        return t("common:vue.home.abilitySlot", `Ability ${slotIndex}`, { index: slotIndex });
    }

    function resolveTarget(kind, index) {
        const player = activePlayer.value;
        if (!player) {
            return { hrid: "", label: "" };
        }
        if (kind === "food" || kind === "drink") {
            const values = kind === "food" ? player.food : player.drinks;
            const hrid = String(values?.[index] || "");
            const labelKey = kind === "food" ? "common:vue.home.foodSlot" : "common:vue.home.drinkSlot";
            const fallback = kind === "food" ? "Food {{index}}" : "Drink {{index}}";
            return {
                hrid,
                label: formatItemName(hrid, itemDetailMap?.[hrid]?.name || t(labelKey, fallback, { index: index + 1 })),
            };
        }
        if (kind === "ability") {
            const hrid = String(player.abilities?.[index]?.abilityHrid || "");
            const fallback = getAbilitySlotLabel(index);
            return { hrid, label: hrid ? getAbilityName(hrid, fallback) : fallback };
        }
        return { hrid: "", label: "" };
    }

    function targetId(kind, index) {
        return `${kind}:${index}`;
    }

    function isActive(kind, index) {
        return state.kind === kind && state.index === index;
    }

    function targetView(kind, index) {
        const target = resolveTarget(kind, index);
        const effective = getEffectiveTriggerState(activePlayer.value?.triggerMap, target.hrid);
        return {
            ...target,
            state: effective.state,
            rules: effective.triggers,
            defaultRules: getDefaultTriggerDtosForHrid(target.hrid),
        };
    }

    function reset() {
        editingPlayerId = "";
        state.kind = "";
        state.index = -1;
        state.hrid = "";
        state.draft = [];
        state.dirty = false;
        state.blockedMessage = "";
    }

    function cancel() {
        reset();
    }

    function showBlockedMessage() {
        state.blockedMessage = t("common:vue.home.dirtyDraftBlocked", "Save or cancel the current changes first.");
    }

    function blockPlayerConfigReplacement() {
        if (!state.kind || !state.dirty) {
            return false;
        }
        showBlockedMessage();
        return true;
    }

    function canLeave() {
        if (state.kind && state.dirty) {
            showBlockedMessage();
            return false;
        }
        return true;
    }

    function request(kind, index) {
        if (isActive(kind, index)) {
            if (state.dirty) {
                showBlockedMessage();
                return;
            }
            reset();
            return;
        }
        if (state.kind && state.dirty) {
            showBlockedMessage();
            return;
        }
        const view = targetView(kind, index);
        if (!view.hrid) {
            return;
        }
        editingPlayerId = String(activePlayer.value?.id ?? "");
        state.kind = kind;
        state.index = index;
        state.hrid = view.hrid;
        state.draft = cloneValue(view.rules);
        state.dirty = false;
        state.blockedMessage = "";
    }

    function updateDraft(nextDraft) {
        if (state.kind) {
            state.draft = cloneValue(nextDraft);
            state.blockedMessage = "";
        }
    }

    function updateDirty(kind, index, dirty) {
        if (!isActive(kind, index)) {
            return;
        }
        state.dirty = Boolean(dirty);
        if (!state.dirty) {
            state.blockedMessage = "";
        }
    }

    function canReplaceTarget(kind, index) {
        if (isActive(kind, index) && state.dirty) {
            showBlockedMessage();
            return false;
        }
        if (isActive(kind, index)) {
            reset();
        }
        return true;
    }

    function setSelection(kind, index, value) {
        if (!canReplaceTarget(kind, index)) {
            return;
        }
        const normalized = String(value || "");
        if (kind === "food") {
            activePlayer.value.food[index] = normalized;
        } else if (kind === "drink") {
            activePlayer.value.drinks[index] = normalized;
        } else if (kind === "ability") {
            activePlayer.value.abilities[index].abilityHrid = normalized;
        }
        if (normalized) {
            simulator.ensureActivePlayerTriggerDefaults(normalized);
        }
    }

    function save(nextRules) {
        if (!state.hrid) {
            return;
        }
        simulator.setActivePlayerTriggers(state.hrid, sanitizeTriggerList(nextRules));
        reset();
    }

    watch(
        () => activePlayer.value,
        (nextPlayer, previousPlayer) => {
            const nextPlayerId = String(nextPlayer?.id ?? "");
            const previousPlayerId = String(previousPlayer?.id ?? "");

            if (state.kind && state.dirty) {
                if (editingPlayerId !== "" && nextPlayerId !== editingPlayerId) {
                    simulator.setActivePlayer(editingPlayerId);
                    showBlockedMessage();
                    return;
                }

                // A same-player object replacement (for example an unguarded import) invalidates
                // the draft. A transition back from another player keeps the owner's draft.
                if (nextPlayer !== previousPlayer && previousPlayerId !== "" && nextPlayerId === previousPlayerId) {
                    reset();
                }
                return;
            }

            // 外部替换（导入、快照等）或非脏状态下的正常切换：丢弃当前选中（不丢弃草稿）。
            // previousPlayerId !== "" 排除 immediate:true 首跑等边界。
            if (state.kind && nextPlayer !== previousPlayer && previousPlayerId !== "") {
                reset();
            }
        },
        { immediate: true },
    );

    return {
        activeDraft,
        blockedMessage,
        activePlayer,
        targetId,
        targetView,
        isActive,
        request,
        updateDraft,
        updateDirty,
        setSelection,
        save,
        cancel,
        reset,
        canLeave,
        blockPlayerConfigReplacement,
        getAbilitySlotLabel,
    };
}

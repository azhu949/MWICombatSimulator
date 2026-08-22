import { computed } from 'vue';
import { buildTriggerChangeDescriptor } from '../../services/triggerMapper.js';
import { useSimulatorStore } from '../../stores/simulatorStore.js';

function normalizeHrid(value) {
  return String(value || '');
}

export function normalizeHomeLevel(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

export function useHomeBuildComparison() {
  const simulator = useSimulatorStore();
  const activePlayer = computed(() => simulator.activePlayer);
  const baselineSnapshot = computed(() => simulator.activeQueueState?.baseline?.snapshot || null);
  const importedBaselineSnapshot = computed(() => simulator.activeImportedBaselineSnapshot || null);
  const levelComparisonBaselineSnapshot = computed(
    () => importedBaselineSnapshot.value || baselineSnapshot.value || null,
  );

  function hasTriggerChangeForHrids(hrids = []) {
    const baseline = baselineSnapshot.value;
    if (!baseline) {
      return false;
    }

    const currentTriggerMap = activePlayer.value?.triggerMap || {};
    const baselineTriggerMap = baseline?.triggerMap || {};
    for (const hrid of hrids) {
      const normalizedHrid = normalizeHrid(hrid);
      if (normalizedHrid && buildTriggerChangeDescriptor(baselineTriggerMap, currentTriggerMap, normalizedHrid)) {
        return true;
      }
    }
    return false;
  }

  function isLevelChanged(levelKey) {
    const baseline = levelComparisonBaselineSnapshot.value;
    if (!baseline) {
      return false;
    }
    return (
      normalizeHomeLevel(baseline?.levels?.[levelKey], 1) !==
      normalizeHomeLevel(activePlayer.value?.levels?.[levelKey], 1)
    );
  }

  function isEquipmentSlotChanged(slot) {
    const baseline = baselineSnapshot.value;
    if (!baseline) {
      return false;
    }
    const before = baseline?.equipment?.[slot] || { itemHrid: '', enhancementLevel: 0 };
    const after = activePlayer.value?.equipment?.[slot] || { itemHrid: '', enhancementLevel: 0 };
    return (
      normalizeHrid(before.itemHrid) !== normalizeHrid(after.itemHrid) ||
      normalizeHomeLevel(before.enhancementLevel, 0) !== normalizeHomeLevel(after.enhancementLevel, 0)
    );
  }

  function isFoodSlotChanged(index) {
    const baseline = baselineSnapshot.value;
    if (!baseline) {
      return false;
    }
    const beforeHrid = normalizeHrid(baseline?.food?.[index]);
    const afterHrid = normalizeHrid(activePlayer.value?.food?.[index]);
    return beforeHrid !== afterHrid || hasTriggerChangeForHrids([beforeHrid]);
  }

  function isDrinkSlotChanged(index) {
    const baseline = baselineSnapshot.value;
    if (!baseline) {
      return false;
    }
    const beforeHrid = normalizeHrid(baseline?.drinks?.[index]);
    const afterHrid = normalizeHrid(activePlayer.value?.drinks?.[index]);
    return beforeHrid !== afterHrid || hasTriggerChangeForHrids([beforeHrid]);
  }

  function isAbilitySlotChanged(index) {
    const baseline = baselineSnapshot.value;
    if (!baseline) {
      return false;
    }
    const before = baseline?.abilities?.[index] || { abilityHrid: '', level: 1 };
    const after = activePlayer.value?.abilities?.[index] || { abilityHrid: '', level: 1 };
    const beforeHrid = normalizeHrid(before.abilityHrid);
    const afterHrid = normalizeHrid(after.abilityHrid);
    return (
      beforeHrid !== afterHrid ||
      normalizeHomeLevel(before.level, 1) !== normalizeHomeLevel(after.level, 1) ||
      hasTriggerChangeForHrids([beforeHrid])
    );
  }

  // 模板按槽位读取 changed 标记：改为 computed 数组，避免每次重渲染重复执行
  // hasTriggerChangeForHrids（内部含两次 getEffectiveTriggerState + JSON.stringify）。
  const foodSlotChangedFlags = computed(() => Array.from({ length: 3 }, (_, index) => isFoodSlotChanged(index)));
  const drinkSlotChangedFlags = computed(() => Array.from({ length: 3 }, (_, index) => isDrinkSlotChanged(index)));
  const abilitySlotChangedFlags = computed(() => Array.from({ length: 5 }, (_, index) => isAbilitySlotChanged(index)));

  return {
    activePlayer,
    baselineSnapshot,
    importedBaselineSnapshot,
    levelComparisonBaselineSnapshot,
    isLevelChanged,
    isEquipmentSlotChanged,
    foodSlotChangedFlags,
    drinkSlotChangedFlags,
    abilitySlotChangedFlags,
  };
}

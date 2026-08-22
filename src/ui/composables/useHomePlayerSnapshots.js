import { computed, ref } from 'vue';
import { useSimulatorStore } from '../../stores/simulatorStore.js';
import { useI18nText } from './useI18nText.js';

const STATUS_FALLBACKS = {
  'common:settingsPage.playerSaveSuccess': 'Player configs saved.',
  'common:settingsPage.playerSaveError': 'Failed to save player configs. Check browser storage permissions.',
  'common:settingsPage.playerLoadSuccess': 'Player configs restored (saved at: {{time}}).',
  'common:settingsPage.playerLoadNotFound': 'No player config snapshot found. Save one first.',
  'common:settingsPage.playerLoadInvalid': 'Player config snapshot is invalid and cannot be restored.',
  'common:settingsPage.playerDeleteAllSuccess': 'Deleted all player snapshot data.',
  'common:settingsPage.playerDeleteSingleSuccess': 'Deleted snapshot data for player {{playerId}}.',
  'common:settingsPage.playerDeleteError': 'Failed to delete player snapshot data. Check browser storage permissions.',
  'common:vue.home.dirtyDraftBlocked': 'Save or cancel the current changes first.',
};

function statusFallback(messageKey, tone) {
  if (STATUS_FALLBACKS[messageKey]) return STATUS_FALLBACKS[messageKey];
  if (tone === 'success') return 'Player config operation completed.';
  if (tone === 'danger') return 'Player config operation failed.';
  return 'Player config operation could not be completed.';
}

export function useHomePlayerSnapshots(blockPlayerConfigReplacement) {
  const simulator = useSimulatorStore();
  const { t } = useI18nText();
  const status = ref({ tone: 'secondary', text: '' });
  const rows = computed(() => simulator.playerDataSnapshotRows || []);
  const hasData = computed(() => rows.value.some((row) => row.hasSnapshot));
  const savedAtLabel = computed(() => {
    const savedAt = Number(simulator.playerDataSnapshot?.savedAt || 0);
    const savedAtText = savedAt > 0 ? new Date(savedAt).toLocaleString() : '-';
    return t('common:settingsPage.playerSnapshotSavedAt', '', { time: savedAtText });
  });
  const statusClass = computed(() => {
    if (status.value.tone === 'success') {
      return 'text-success';
    }
    if (status.value.tone === 'danger') {
      return 'text-destructive';
    }
    return 'text-muted-foreground';
  });
  const statusText = computed(() => status.value.text || '');

  function setStatus(messageKey, tone = 'secondary', options = {}) {
    status.value = { tone, text: t(messageKey, statusFallback(messageKey, tone), options) };
  }

  function save() {
    const result = simulator.savePlayerDataSnapshot();
    setStatus(
      result.ok ? 'common:settingsPage.playerSaveSuccess' : result.messageKey || 'common:settingsPage.playerSaveError',
      result.ok ? 'success' : 'danger',
    );
  }

  function load() {
    if (blockPlayerConfigReplacement?.()) {
      setStatus('common:vue.home.dirtyDraftBlocked', 'warning');
      return;
    }
    const result = simulator.loadPlayerDataSnapshot();
    if (!result.ok) {
      setStatus(result.messageKey || 'common:settingsPage.playerLoadInvalid', 'danger');
      return;
    }
    const time = result.savedAt > 0 ? new Date(result.savedAt).toLocaleString() : '-';
    setStatus(result.messageKey || 'common:settingsPage.playerLoadSuccess', 'success', { time });
  }

  function deleteSingle(playerId) {
    const result = simulator.deleteSinglePlayerDataSnapshot(playerId);
    setStatus(
      result.messageKey ||
        (result.ok ? 'common:settingsPage.playerDeleteSingleSuccess' : 'common:settingsPage.playerDeleteError'),
      result.ok ? 'success' : 'danger',
      result.messageOptions || {},
    );
  }

  function deleteAll() {
    const result = simulator.deleteAllPlayerDataSnapshots();
    setStatus(
      result.messageKey ||
        (result.ok ? 'common:settingsPage.playerDeleteAllSuccess' : 'common:settingsPage.playerDeleteError'),
      result.ok ? 'success' : 'danger',
    );
  }

  return {
    status,
    statusClass,
    statusText,
    rows,
    hasData,
    savedAtLabel,
    save,
    load,
    deleteSingle,
    deleteAll,
  };
}

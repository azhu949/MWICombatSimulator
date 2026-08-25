import { buildMainSiteEnhancementImport } from './enhancementImportMapper.js';
import { buildMainSiteSkillingImport } from './skillingImportMapper.js';

function resolveActivateAfterImport(message) {
  if (Object.prototype.hasOwnProperty.call(message, 'activateAfterImport')) {
    return message.activateAfterImport === true;
  }

  return message.selectAfterImport === true;
}

/**
 * 将 Tampermonkey 主站导入载荷应用到模拟器 store。
 *
 * @param {{
 *   players: Array<{ id: string, selected?: boolean }>,
 *   activePlayerId: string,
 *   clearOtherPlayersForSoloImport: (playerId: string) => boolean,
 *   clearPlayerSlots: (playerIds: string[]) => boolean,
 *   importSoloConfig: (text: string, playerId: string) => { detectedFormat?: string },
 *   setActivePlayer: (playerId: string) => void,
 * }} simulator
 * @param {{
 *   targetPlayerId?: string,
 *   clearPlayerIds?: string[],
 *   clearOtherPlayers?: boolean,
 *   resetTeamSelection?: boolean,
 *   selectAfterImport?: boolean,
 *   activateAfterImport?: boolean,
 *   payload?: object,
 * }} message
 * @returns {{
 *   resolvedPlayerId: string,
 *   detectedFormat: string,
 *   message: string,
 * }}
 */
export function applyTampermonkeyImportMessage(simulator, message) {
  const safeMessage = message && typeof message === 'object' ? message : {};
  const candidatePlayerId = String(safeMessage.targetPlayerId || '').trim();
  const resolvedPlayerId =
    candidatePlayerId && simulator.players.some((player) => player.id === candidatePlayerId)
      ? candidatePlayerId
      : simulator.activePlayerId;
  const clearPlayerIds = Array.isArray(safeMessage.clearPlayerIds)
    ? safeMessage.clearPlayerIds
        .map((playerId) => String(playerId || '').trim())
        .filter((playerId) => simulator.players.some((player) => player.id === playerId))
    : [];
  const clearPlayerIdsAfterImport = clearPlayerIds.filter((playerId) => playerId !== resolvedPlayerId);
  const shouldSelectAfterImport = safeMessage.selectAfterImport === true;
  const shouldActivateAfterImport = resolveActivateAfterImport(safeMessage);

  if (safeMessage.clearOtherPlayers === true) {
    simulator.clearOtherPlayersForSoloImport(resolvedPlayerId);
  }

  if (safeMessage.resetTeamSelection === true) {
    simulator.players.forEach((player) => {
      player.selected = false;
    });
  }

  const result = simulator.importSoloConfig(JSON.stringify(safeMessage.payload || {}), resolvedPlayerId);

  if (clearPlayerIdsAfterImport.length > 0) {
    simulator.clearPlayerSlots(clearPlayerIdsAfterImport);
  }

  if (shouldActivateAfterImport) {
    simulator.setActivePlayer(resolvedPlayerId);
  }

  if (shouldSelectAfterImport) {
    const importedPlayer = simulator.players.find((player) => player.id === resolvedPlayerId);
    if (importedPlayer) {
      importedPlayer.selected = true;
    }
  }

  return {
    resolvedPlayerId,
    detectedFormat: result?.detectedFormat || '',
    message: `Imported main-site profile into player ${resolvedPlayerId}.`,
  };
}

/**
 * 将当前主站角色加成应用到强化模拟器。
 * 目标物品、价格覆盖与风险设置保持不变。
 */
export function applyTampermonkeyEnhancementImportMessage(enhancement, message) {
  if (!enhancement || typeof enhancement.patchConfig !== 'function') {
    throw new Error('Enhancement store is unavailable.');
  }

  const safeMessage = message && typeof message === 'object' ? message : {};
  const result = buildMainSiteEnhancementImport(safeMessage.payload || {}, enhancement.config || {});
  if (result.importedSections.length === 0) {
    throw new Error('No enhancement character data was found in the main-site payload.');
  }

  enhancement.patchConfig(result.configPatch);
  return {
    detectedFormat: 'main-site-enhancement-character',
    importedSections: result.importedSections,
    message: result.characterName
      ? `Imported enhancement setup for ${result.characterName}.`
      : 'Imported enhancement character setup.',
  };
}

/**
 * 用当前主站角色替换技能工作区快照。
 */
export function applyTampermonkeySkillingImportMessage(skilling, message) {
  if (!skilling || typeof skilling.importProfile !== 'function') {
    throw new Error('Skilling store is unavailable.');
  }

  const safeMessage = message && typeof message === 'object' ? message : {};
  const result = buildMainSiteSkillingImport(safeMessage.payload || {});
  skilling.importProfile(result.profile);
  return {
    detectedFormat: result.detectedFormat,
    importedSections: result.importedSections,
    characterName: result.characterName,
    message: result.characterName
      ? `Imported skilling snapshot for ${result.characterName}.`
      : 'Imported current-character skilling snapshot.',
  };
}

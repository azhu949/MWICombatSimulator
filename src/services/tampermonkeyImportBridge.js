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
 *   importSoloConfig: (text: string, playerId: string) => Promise<{ detectedFormat?: string }>,
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
 * @returns {Promise<{
 *   resolvedPlayerId: string,
 *   detectedFormat: string,
 *   labyrinthUpgradesImport: {
 *     levelCount: number, previousLevelCount: number, changed: boolean, cleared: boolean,
 *   } | null,
 *   message: string,
 * }>}
 */
export async function applyTampermonkeyImportMessage(simulator, message) {
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

  // 顺序不变量（2026-10-03）：本函数 async 化后，await 之前的预动作（clearOtherPlayersForSoloImport /
  // resetTeamSelection）与 await 之后的动作（clearPlayerSlots / setActivePlayer / selected 写入）之间
  // 存在让出执行权的窗口——importSoloConfig 内部要 await 按需加载的序列化模块与资产分刷新，期间用户
  // 手动导入、快照恢复等其它来源的写入可以落地。这些后置动作因此依赖 store 侧「玩家配置写入串行器」
  // （services/playerConfigMutationQueue.js）提供的排序：后发起者的配置写入一定在本函数的后置动作之后
  // 执行，不会被 clearPlayerSlots 误清。改动此处 await 顺序、或把 importSoloConfig 移出串行队列时，
  // 必须一并复核该不变量（回归用例见 __tests__/importLinkSerialization.test.js）。
  const result = await simulator.importSoloConfig(JSON.stringify(safeMessage.payload || {}), resolvedPlayerId);

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
    // 迷宫商店升级等级的覆盖摘要（主站载荷携带时才有值，见 mapper 的
    // describeLabyrinthUpgradesImport）：等级覆盖/清零是破坏性动作，必须随桥接响应
    // 回传给脚本状态栏，否则用户手填等级在导入瞬间无声消失（脚本侧只做本地化拼接，
    // 不重算 characterInfo）。字段缺失 = 载荷未携带等级（保留现有配置），无需提示。
    labyrinthUpgradesImport: result?.labyrinthUpgradesImport || null,
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

function resolveActivateAfterImport(message) {
    if (Object.prototype.hasOwnProperty.call(message, "activateAfterImport")) {
        return message.activateAfterImport === true;
    }

    return message.selectAfterImport === true;
}

/**
 * Apply a Tampermonkey main-site import payload to the simulator store.
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
    const safeMessage = message && typeof message === "object" ? message : {};
    const candidatePlayerId = String(safeMessage.targetPlayerId || "").trim();
    const resolvedPlayerId = candidatePlayerId && simulator.players.some((player) => player.id === candidatePlayerId)
        ? candidatePlayerId
        : simulator.activePlayerId;
    const clearPlayerIds = Array.isArray(safeMessage.clearPlayerIds)
        ? safeMessage.clearPlayerIds
            .map((playerId) => String(playerId || "").trim())
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
        detectedFormat: result?.detectedFormat || "",
        message: `Imported main-site profile into player ${resolvedPlayerId}.`,
    };
}

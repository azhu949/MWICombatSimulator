import CombatSimulator from './combatsimulator/combatSimulator';
import Player from './combatsimulator/player';
import Zone from './combatsimulator/zone';
import Labyrinth from './combatsimulator/labyrinth';
import { buildSimulationExtraBuffs } from './shared/simulationExtraBuffs.js';

onmessage = async function (event) {
  switch (event.data.type) {
    case 'start_simulation':
      let extra = event.data.extra || {};
      let extraBuffs = buildSimulationExtraBuffs(extra);

      // 在 DTO 中保留已配置的行，以便结果可以说明
      // 卷轴效果已被暂停；CombatSimulator 会应用该
      // 开关，且不修改用户已保存的配置。
      let playersData = event.data.players;
      let players = [];
      let zone = null;
      if (event.data.zone) {
        zone = new Zone(event.data.zone.zoneHrid, event.data.zone.difficultyTier);
      }
      let labyrinth = null;
      if (event.data.labyrinth) {
        labyrinth = new Labyrinth(
          event.data.labyrinth.labyrinthHrid,
          event.data.labyrinth.roomLevel,
          event.data.labyrinth.crates,
        );
      }
      for (let i = 0; i < playersData.length; i++) {
        let currentPlayer = Player.createFromDTO(structuredClone(playersData[i]));
        currentPlayer.zoneBuffs = zone?.buffs || labyrinth?.buffs || [];
        currentPlayer.extraBuffs = extraBuffs;
        players.push(currentPlayer);
      }
      let simulationTimeLimit = event.data.simulationTimeLimit;
      let enableHpMpVisualization = Boolean(extra.enableHpMpVisualization);
      let combatSimulator = new CombatSimulator(players, zone, labyrinth, {
        enableHpMpVisualization,
        combatScrollsEnabled: Boolean(extra.combatScrollsEnabled),
        isGuildTrial: Boolean(event.data.simulationContext?.isGuildTrial),
      });
      combatSimulator.addEventListener('progress', (event) => {
        this.postMessage({
          type: 'simulation_progress',
          progress: event.detail.progress,
          zone: event.detail.zone,
          difficultyTier: event.detail.difficultyTier,
          labyrinth: event.detail.labyrinth,
          roomLevel: event.detail.roomLevel,
          timeSeriesData: event.detail.timeSeriesData,
        });
      });

      try {
        let simResult = await combatSimulator.simulate(simulationTimeLimit);
        this.postMessage({ type: 'simulation_result', simResult: simResult });
      } catch (e) {
        console.log(e);
        this.postMessage({ type: 'simulation_error', error: e });
      }
      break;
  }
};

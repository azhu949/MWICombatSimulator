import { describe, expect, it } from 'vitest';

import Labyrinth from '../labyrinth.js';
import labyrinthCrateDetailMap from '../data/labyrinthCrateDetailMap.json';
import actionDetailMap from '../data/actionDetailMap.json';
import { buildLabyrinthShopUpgradeBuffs } from '../../shared/labyrinthShopUpgrades.js';
import { buildSimulationExtraBuffs } from '../../shared/simulationExtraBuffs.js';
import { buildPlayersForSimulation, createEmptyPlayerConfig } from '../../services/playerMapper.js';

const ATTACK_SPEED = '/buff_types/attack_speed';
const WISDOM = '/buff_types/wisdom';
const COFFEE_CRATE = '/items/basic_coffee_crate';

// 模块加载期快照：期望值始终基于未污染的补给箱数据，与测试执行顺序/子集
// 无关（若修复被回退，先行测试造成的 JSON 污染不会让后续断言自洽通过）。
const pristineCrateEntry = structuredClone(labyrinthCrateDetailMap[COFFEE_CRATE]);

// 普通区域路径：部分战斗区域自带永久 zone buff（当前为经验区域的 wisdom 0.2），
// worker.js / foodOptimizerSimulation.js 把 zone.buffs（模块级 actionDetailMap JSON，
// Zone 构造不拷贝）按引用赋给玩家。同样在模块加载期取未污染快照。
const zoneActionWithBuffs = Object.values(actionDetailMap).find(
  (action) => action && typeof action === 'object' && Array.isArray(action.buffs) && action.buffs.length > 0,
);
const pristineZoneBuffs = zoneActionWithBuffs ? structuredClone(zoneActionWithBuffs.buffs) : null;

function buildPlayer(id) {
  const config = { ...createEmptyPlayerConfig(id), selected: true };
  return buildPlayersForSimulation([config])[0];
}

// 复刻 worker.js 的装配方式：所有玩家共享同一批 zoneBuffs/extraBuffs
// 对象（补给箱 buff 还是模块级 JSON 常量），不做任何克隆。
function assembleSharedEnvironment(players) {
  const labyrinth = new Labyrinth('/monsters/test', 100, [COFFEE_CRATE], { attack_speed: 12 });
  const extraBuffs = buildSimulationExtraBuffs({ mooPass: true, comExp: 1 });
  for (const player of players) {
    player.zoneBuffs = labyrinth.buffs;
    player.extraBuffs = extraBuffs;
  }
  return { labyrinth, extraBuffs };
}

function expectedWisdomFlatBoost(extraBuffs) {
  return extraBuffs.filter((buff) => buff.typeHrid === WISDOM).reduce((sum, buff) => sum + buff.flatBoost, 0);
}

describe('多玩家共享迷宫 buff 时的永久加成隔离（商店升级 + 补给箱）', () => {
  it('后生成玩家的累加不得改写共享 buff 对象（跨玩家不重复累加）', () => {
    const players = [buildPlayer('shared-p1'), buildPlayer('shared-p2')];
    const { extraBuffs } = assembleSharedEnvironment(players);
    const upgradeBuff = buildLabyrinthShopUpgradeBuffs({ attack_speed: 12 })[0];
    // 期望值全部从模块加载期的未污染快照推导：补给箱 attack_speed ratio + 升级 L12。
    const expectedRatioBoost =
      pristineCrateEntry.find((buff) => buff.typeHrid === ATTACK_SPEED).ratioBoost + upgradeBuff.ratioBoost;
    const expectedFlatBoost = upgradeBuff.flatBoost;
    // wisdom 期望 = 箱内 combat_xp + mooPass + 社区经验。
    const wisdomFlatBoost =
      pristineCrateEntry.filter((buff) => buff.typeHrid === WISDOM).reduce((sum, buff) => sum + buff.flatBoost, 0) +
      expectedWisdomFlatBoost(extraBuffs);

    players[0].generatePermanentBuffs();
    players[1].generatePermanentBuffs();

    for (const player of players) {
      expect(player.permanentBuffs[ATTACK_SPEED].ratioBoost).toBeCloseTo(expectedRatioBoost, 8);
      expect(player.permanentBuffs[ATTACK_SPEED].flatBoost).toBeCloseTo(expectedFlatBoost, 8);
      expect(player.permanentBuffs[WISDOM].flatBoost).toBeCloseTo(wisdomFlatBoost, 8);
    }

    // 补给箱 buff 来自模块级 JSON：生成过程不得就地改写，
    // 否则同一 worker realm 内的下一次模拟会继承被污染的数值。
    expect(labyrinthCrateDetailMap[COFFEE_CRATE]).toStrictEqual(pristineCrateEntry);
  });

  it('主力在后续玩家生成后 clearBuffs（复活路径）仍取未污染数值', () => {
    const players = [buildPlayer('shared-p1'), buildPlayer('shared-p2')];
    const { extraBuffs } = assembleSharedEnvironment(players);
    // 期望值从模块加载期的未污染快照推导，与本文件其他测试的执行顺序解耦：
    // 补给箱 attack_speed ratio + 商店升级 L12。
    const expectedRatioBoost =
      pristineCrateEntry.find((buff) => buff.typeHrid === ATTACK_SPEED).ratioBoost +
      buildLabyrinthShopUpgradeBuffs({ attack_speed: 12 })[0].ratioBoost;
    // wisdom 期望 = 箱内 combat_xp + mooPass + 社区经验。
    const wisdomFlatBoost =
      pristineCrateEntry.filter((buff) => buff.typeHrid === WISDOM).reduce((sum, buff) => sum + buff.flatBoost, 0) +
      expectedWisdomFlatBoost(extraBuffs);

    players[0].generatePermanentBuffs();
    players[1].generatePermanentBuffs();
    players[0].clearBuffs();

    expect(players[0].combatBuffs[ATTACK_SPEED].ratioBoost).toBeCloseTo(expectedRatioBoost, 8);
    expect(players[0].combatBuffs[WISDOM].flatBoost).toBeCloseTo(wisdomFlatBoost, 8);
  });

  it('普通区域共享 zone.buffs（actionDetailMap JSON）时同样不得被改写', () => {
    // 生产路径守卫：worker.js 与 foodOptimizerSimulation.js 都把 zone.buffs
    // 按引用赋给玩家（Zone 构造不拷贝）。若该路径回归（经验区域 wisdom +
    // mooPass 同 typeHrid），共享 JSON 会在可复用的 realm 内随每次生成递增膨胀。
    expect(zoneActionWithBuffs).toBeTruthy();
    expect(pristineZoneBuffs).toBeTruthy();

    const players = [buildPlayer('zone-p1'), buildPlayer('zone-p2')];
    const extraBuffs = buildSimulationExtraBuffs({ mooPass: true });
    for (const player of players) {
      player.zoneBuffs = zoneActionWithBuffs.buffs;
      player.extraBuffs = extraBuffs;
    }

    players[0].generatePermanentBuffs();
    players[1].generatePermanentBuffs();

    // wisdom 期望 = 区域 experience_action_buff + mooPass。
    const expectedWisdomTotal =
      pristineZoneBuffs.filter((buff) => buff.typeHrid === WISDOM).reduce((sum, buff) => sum + buff.flatBoost, 0) +
      expectedWisdomFlatBoost(extraBuffs);
    for (const player of players) {
      expect(player.permanentBuffs[WISDOM].flatBoost).toBeCloseTo(expectedWisdomTotal, 8);
    }

    expect(zoneActionWithBuffs.buffs).toStrictEqual(pristineZoneBuffs);
  });
});

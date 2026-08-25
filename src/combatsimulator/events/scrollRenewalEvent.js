import CombatEvent from './combatEvent';

/**
 * 定时战斗卷轴的唤醒事件。
 *
 * 刻意不设置 `source` 或 `target`：玩家死亡清理会按这两个字段移除
 * 单元作用域的事件，而卷轴的计时必须跨越死亡/复活与副本重启继续运行。
 */
class ScrollRenewalEvent extends CombatEvent {
  static type = 'scrollRenewal';

  constructor(time, playerHrid, itemHrid, token = 0) {
    super(ScrollRenewalEvent.type, time);
    this.playerHrid = String(playerHrid || '');
    this.itemHrid = String(itemHrid || '');
    this.token = Number.isFinite(Number(token)) ? Number(token) : 0;
  }
}

export default ScrollRenewalEvent;

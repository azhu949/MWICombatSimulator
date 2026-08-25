import CombatEvent from './combatEvent';

class DamageOverTimeEvent extends CombatEvent {
  static type = 'damageOverTime';

  constructor(time, sourceRef, target, damage, totalTicks, currentTick, combatStyleHrid) {
    super(DamageOverTimeEvent.type, time);

    // 将其命名为 'source' 会在来源死亡时错误地清除持续伤害（Damage Over Time）
    this.sourceRef = sourceRef;
    this.target = target;
    this.damage = damage;
    this.totalTicks = totalTicks;
    this.currentTick = currentTick;
    this.combatStyleHrid = combatStyleHrid;
  }
}

export default DamageOverTimeEvent;

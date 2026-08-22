import CombatEvent from './combatEvent';

class CheckBuffExpirationEvent extends CombatEvent {
  static type = 'checkBuffExpiration';

  constructor(time, source, buffUniqueHrid = null, buffSourceKey = null) {
    super(CheckBuffExpirationEvent.type, time);

    this.source = source;
    this.buffUniqueHrid = buffUniqueHrid;
    this.buffSourceKey = buffSourceKey;
  }
}

export default CheckBuffExpirationEvent;

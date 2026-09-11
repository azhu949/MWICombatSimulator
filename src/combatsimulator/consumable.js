import Buff from './buff';
import itemDetailMap from './data/itemDetailMap.json';
import Trigger from './trigger';

const SELF_DEPENDENCY = '/combat_trigger_dependencies/self';
const MISSING_HP = '/combat_trigger_conditions/missing_hp';
const MISSING_MP = '/combat_trigger_conditions/missing_mp';
const GREATER_THAN_EQUAL = '/combat_trigger_comparators/greater_than_equal';

class Consumable {
  constructor(hrid, triggers = null) {
    this.hrid = hrid;

    let gameConsumable = itemDetailMap[this.hrid];
    if (!gameConsumable) {
      throw new Error('No consumable found for hrid: ' + this.hrid);
    }

    this.cooldownDuration = gameConsumable.consumableDetail.cooldownDuration;
    this.hitpointRestore = gameConsumable.consumableDetail.hitpointRestore;
    this.manapointRestore = gameConsumable.consumableDetail.manapointRestore;
    this.recoveryDuration = gameConsumable.consumableDetail.recoveryDuration;
    this.catagoryHrid = gameConsumable.categoryHrid;

    this.buffs = [];
    if (gameConsumable.consumableDetail.buffs) {
      for (const consumableBuff of gameConsumable.consumableDetail.buffs) {
        let buff = new Buff(consumableBuff);
        this.buffs.push(buff);
      }
    }

    if (triggers) {
      this.triggers = triggers;
    } else {
      this.triggers = [];
      const defaultCombatTriggers = Array.isArray(gameConsumable.consumableDetail.defaultCombatTriggers)
        ? gameConsumable.consumableDetail.defaultCombatTriggers
        : [];
      for (const defaultTrigger of defaultCombatTriggers) {
        let trigger = new Trigger(
          defaultTrigger.dependencyHrid,
          defaultTrigger.conditionHrid,
          defaultTrigger.comparatorHrid,
          defaultTrigger.value,
        );
        this.triggers.push(trigger);
      }
    }

    this.lastUsed = Number.MIN_SAFE_INTEGER;
  }

  static createFromDTO(dto) {
    let triggers = dto.triggers.map((trigger) => Trigger.createFromDTO(trigger));
    let consumable = new Consumable(dto.hrid, triggers);

    return consumable;
  }

  shouldTrigger(currentTime, source, target, friendlies, enemies) {
    if (source.isStunned) {
      return false;
    }
    let consumableHaste;
    if (this.catagoryHrid.includes('food')) {
      consumableHaste = source.combatDetails.combatStats.foodHaste;
    } else {
      consumableHaste = source.combatDetails.combatStats.drinkConcentration;
    }
    let cooldownDuration = this.cooldownDuration;
    if (consumableHaste > 0) {
      cooldownDuration = cooldownDuration / (1 + consumableHaste);
    }

    if (this.lastUsed + cooldownDuration > currentTime) {
      return false;
    }

    if (this.triggers.length == 0) {
      return true;
    }

    // Food optimizer candidates (and the game's common HP/MP food triggers)
    // use one self resource comparison. Keep calling compareValue so the
    // optimizer's threshold observer remains on the exact comparison path,
    // while avoiding generic dependency-map and condition dispatch.
    const trigger = this.triggers.length === 1 ? this.triggers[0] : null;
    if (
      trigger?.dependencyHrid === SELF_DEPENDENCY &&
      trigger.comparatorHrid === GREATER_THAN_EQUAL &&
      (trigger.conditionHrid === MISSING_HP || trigger.conditionHrid === MISSING_MP)
    ) {
      const current =
        trigger.conditionHrid === MISSING_HP
          ? source.combatDetails.maxHitpoints - source.combatDetails.currentHitpoints
          : source.combatDetails.maxManapoints - source.combatDetails.currentManapoints;
      return trigger.compareValue(current);
    }

    let shouldTrigger = true;
    for (const trigger of this.triggers) {
      if (!trigger.isActive(source, target, friendlies, enemies, currentTime)) {
        shouldTrigger = false;
      }
    }

    return shouldTrigger;
  }
}

export default Consumable;

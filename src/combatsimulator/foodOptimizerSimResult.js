import SimResult from './simResult';

// Food search only consumes deaths, mana exhaustion, consumable usage, and
// scroll usage. The combat engine still calls the other result hooks, so keep
// them as no-ops instead of branching at every event site.
class FoodOptimizerSimResult extends SimResult {
  constructor(zone, labyrinth, numberOfPlayers) {
    super(zone, labyrinth, numberOfPlayers, { minimal: true });
  }

  addWipeEvent() {}

  updateTimeSpentAlive() {}

  updateDungenonFinish() {}

  addEncounterEnd() {}

  addAttack() {}

  addHitpointsGained() {}

  addManapointsGained() {}

  addHitpointsSpent() {}

  addExperienceGain() {}

  calculateExperienceGain() {
    return null;
  }

  addExperienceGainValues() {}

  recordMonsterDeath() {}

  recordMonsterDeathFromUnit() {}

  recordMonsterDeathFromContext() {}

  setDropRateMultipliers() {}

  setManaUsed() {}

  addTimeSeriesSnapshot() {}
}

export default FoodOptimizerSimResult;

// A new, never-consumed food is ready even while existing foods are cooling down.
// Observe every insertion gap in the food loop, including states changed by a
// food's immediate recovery or buffs, rather than only observed trigger calls.
export function observeInactiveFoodThresholds(simulator, hrid) {
  let valid = true;
  const minimum = { hp: 1, mp: 1 };
  const observe = (unit) => {
    if (unit.hrid !== hrid || unit.combatDetails.currentHitpoints <= 0 || unit.isStunned) return;
    const hp = unit.combatDetails.maxHitpoints - unit.combatDetails.currentHitpoints;
    const mp = unit.combatDetails.maxManapoints - unit.combatDetails.currentManapoints;
    if (!Number.isFinite(hp) || !Number.isFinite(mp)) {
      valid = false;
      return;
    }
    minimum.hp = Math.max(minimum.hp, Math.floor(hp) + 1);
    minimum.mp = Math.max(minimum.mp, Math.floor(mp) + 1);
    if (!Number.isSafeInteger(minimum.hp) || !Number.isSafeInteger(minimum.mp)) valid = false;
  };
  const check = simulator.checkTriggersForUnit;
  simulator.checkTriggersForUnit = function (unit, ...args) {
    observe(unit);
    return check.call(this, unit, ...args);
  };
  const use = simulator.tryUseConsumable;
  simulator.tryUseConsumable = function (unit, consumable, ...args) {
    const result = use.call(this, unit, consumable, ...args);
    if (unit.hrid === hrid && unit.food.includes(consumable)) observe(unit);
    return result;
  };
  return () => (valid ? { ...minimum } : null);
}

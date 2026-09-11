// Each worker keeps taking from its current composition while other compositions
// are available. Once every group has an owner, idle workers can take unvisited
// candidates from the remaining iterators. Calls are synchronous on the coordinator.
export function createFoodOptimizerWorkQueue(factories) {
  const pending = factories[Symbol.iterator]();
  const active = new Set();
  const assignments = new Map();
  let exhausted = false;
  return {
    next(worker) {
      while (true) {
        let group = assignments.get(worker);
        if (!group || group.finished) {
          const next = exhausted ? { done: true } : pending.next();
          if (next.done) {
            exhausted = true;
            group = active.values().next().value;
            if (!group) {
              assignments.delete(worker);
              return { done: true };
            }
          } else {
            group = { iterator: next.value()[Symbol.iterator](), finished: false };
            active.add(group);
          }
          assignments.set(worker, group);
        }
        const next = group.iterator.next();
        if (!next.done) return next;
        group.finished = true;
        active.delete(group);
        assignments.delete(worker);
      }
    },
    clear() {
      exhausted = true;
      active.clear();
      assignments.clear();
      pending.return?.();
    },
  };
}

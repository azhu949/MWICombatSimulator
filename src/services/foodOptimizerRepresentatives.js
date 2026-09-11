import { buildFoodCandidate, compareFoodSlots } from './foodOptimizerDomain.js';

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function materializeFoodOptimizerDomains(domains) {
  return domains.map(({ min, max, ...item }) => ({
    ...item,
    thresholds: item.thresholds.filter((threshold) => threshold >= min && threshold <= max),
  }));
}

function* permutations(items, picked = []) {
  if (!items.length) {
    yield picked;
    return;
  }
  for (let index = 0; index < items.length; index += 1)
    yield* permutations(
      items.filter((_, other) => other !== index),
      [...picked, items[index]],
    );
}

// Every candidate in an equivalent region has the same cost and deaths, and
// the same number of slots. Only the full signature can change its rank.
export function selectFoodOptimizerRepresentatives(items, { order, excludedSignature, limit = 10 } = {}) {
  if (limit <= 0 || items.some((item) => !item.thresholds.length)) return [];
  const orders = order ? [order.map((hrid) => items.find((item) => item.hrid === hrid))] : permutations(items);
  const representatives = [];
  for (const arranged of orders) {
    const numeric = arranged.map((item) => [...item.thresholds].sort((a, b) => b - a));
    // For a non-final slot, "10|" sorts before "1|". Sorting the bare numbers'
    // strings would silently lose the best tie-breaking signatures.
    const lexical = arranged.map((item, index) =>
      [...item.thresholds].sort((a, b) => {
        const suffix = index + 1 < arranged.length ? '|' : '';
        return compareText(`${a}${suffix}`, `${b}${suffix}`);
      }),
    );
    const follows = (previous, current) => !previous || compareFoodSlots(previous, current) < 0;
    const canFinish = (index, previous) => {
      for (let next = index; next < arranged.length; next += 1) {
        const threshold = numeric[next].find((value) => follows(previous, { ...arranged[next], threshold: value }));
        if (threshold == null) return false;
        previous = { ...arranged[next], threshold };
      }
      return true;
    };
    if (!canFinish(0, null)) continue;
    const picked = [];
    function* visit(index) {
      if (index === arranged.length) {
        yield buildFoodCandidate(picked);
        return;
      }
      for (const threshold of lexical[index]) {
        const food = { ...arranged[index], threshold };
        if (!follows(picked[index - 1], food) || !canFinish(index + 1, food)) continue;
        picked[index] = food;
        yield* visit(index + 1);
      }
    }
    let retained = 0;
    for (const candidate of visit(0)) {
      if (candidate.signature === excludedSignature) continue;
      representatives.push(candidate);
      if (++retained >= limit) break;
    }
  }
  representatives.sort((a, b) => compareText(a.signature, b.signature));
  return representatives.slice(0, limit);
}

import { expect, it, vi } from 'vitest';

// assertComparatorReadCoverage (foodOptimizerPruning.js) binds
// QUERY_GUARD_FIELDS to what compareFoodSlots actually observes on the slots.
// A comparator that observes anything the list does not freeze must fail the
// pruning module's import instead of letting the memoized comparison templates
// answer from a stale copy. Each case installs a comparator into a fresh module
// registry and re-imports the pruning module; every faulty case asserts the
// exact offending key, so a stale mock from an earlier case cannot satisfy it,
// and the closing case keeps the proof silent for a legitimate comparator that
// reads the frozen fields in a different order.
const reimportWithComparator = async (compareFoodSlots) => {
  vi.resetModules();
  vi.doMock('../foodOptimizerDomain.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, compareFoodSlots };
  });
  return import('../foodOptimizerPruning.js');
};

it('fails the import when compareFoodSlots reads a field QUERY_GUARD_FIELDS does not freeze', async () => {
  await expect(reimportWithComparator((left, right) => left.itemLevel - right.itemLevel)).rejects.toThrow(
    '"itemLevel"',
  );
});

it('fails the import when the read hides behind an inequality an all-equal probe would not enter', async () => {
  // Equal slots tie on every field, so an all-equal probe alone returns 0
  // before the hrid tie breaker and never reads tier; real comparisons always
  // order distinct hrids, so only the full relative-state grid (kind equal,
  // hrid ordered) reaches the read and rejects the import.
  await expect(
    reimportWithComparator((left, right) =>
      left.kind !== right.kind ? 0 : left.hrid < right.hrid ? left.tier - right.tier : 0,
    ),
  ).rejects.toThrow('"tier"');
});

it('fails the import when the read hides behind a falsy fallback a truthy grid would not enter', async () => {
  // Price 0 is production-reachable (free foods), so a grid probing only
  // truthy prices never falls through to vendorPrice.
  await expect(
    reimportWithComparator((left, right) => (left.price || left.vendorPrice) - (right.price || right.vendorPrice)),
  ).rejects.toThrow('"vendorPrice"');
});

it('fails the import when the read hides behind a nullish fallback a defined grid would not enter', async () => {
  // An unset recoveryDuration is production-reachable, so a grid probing only
  // defined values never falls through to backupDuration; 0 is falsy but not
  // nullish, which is exactly why the grid needs both state kinds.
  await expect(
    reimportWithComparator(
      (left, right) =>
        (left.recoveryDuration ?? left.backupDuration) - (right.recoveryDuration ?? right.backupDuration),
    ),
  ).rejects.toThrow('"backupDuration"');
});

it('fails the import when compareFoodSlots enumerates the slot keys', async () => {
  await expect(
    reimportWithComparator((left, right) => Object.keys(left).length - Object.keys(right).length),
  ).rejects.toThrow('"ownKeys"');
});

it('fails the import when compareFoodSlots branches on slot membership', async () => {
  await expect(
    reimportWithComparator((left, right) => Number('vendorLevel' in left) - Number('vendorLevel' in right)),
  ).rejects.toThrow('"vendorLevel"');
});

it('fails the import when compareFoodSlots branches on the slot prototype', async () => {
  await expect(
    reimportWithComparator((left, right) => (Object.getPrototypeOf(left) === Object.prototype ? 0 : 1)),
  ).rejects.toThrow('"getPrototypeOf"');
});

it('keeps the import silent for a comparator that stays inside the frozen fields', async () => {
  // The real comparator never reads recoveryDuration; a reordered comparator
  // that does (and skips restore) must stay accepted, so the proof demands a
  // subset of the frozen fields and not the real comparator's exact pattern.
  const pruning = await reimportWithComparator(
    (left, right) =>
      left.price - right.price ||
      Number(right.recoveryDuration) - Number(left.recoveryDuration) ||
      (left.kind === right.kind ? 0 : left.kind < right.kind ? -1 : 1) ||
      (left.hrid < right.hrid ? -1 : left.hrid > right.hrid ? 1 : 0) ||
      Number(right.threshold) - Number(left.threshold),
  );
  expect(pruning.createFoodOptimizerPruningCache).toBeTypeOf('function');
});

import { describe, expect, it } from 'vitest';
import { COMBAT_SCROLL_DURATION_NS } from '../../shared/combatScrolls.js';
import Buff from '../buff.js';
import { createCombatScrollBuff } from '../combatScrollBuff.js';

describe('createCombatScrollBuff', () => {
  it('adapts a shared scroll template into a simulator Buff', () => {
    const buff = createCombatScrollBuff('/items/seal_of_damage');

    expect(buff).toBeInstanceOf(Buff);
    expect(buff.uniqueHrid).toBe('/buff_uniques/personal_damage');
    expect(buff.duration).toBe(COMBAT_SCROLL_DURATION_NS);
  });

  it('returns null for an unknown scroll', () => {
    expect(createCombatScrollBuff('/items/not_a_scroll')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { GAME_MODE_IRONCOW, GAME_MODE_STANDARD, normalizeGameMode } from '../gameMode.js';

describe('gameMode', () => {
  it('defaults to standard and only accepts ironcow as the non-default mode', () => {
    expect(GAME_MODE_STANDARD).toBe('standard');
    expect(GAME_MODE_IRONCOW).toBe('ironcow');
    expect(normalizeGameMode('ironcow')).toBe('ironcow');
    // 容忍大小写/空白等非规范写法（与 advisor 预设归一化同款宽容口径）。
    expect(normalizeGameMode('IRONCOW')).toBe('ironcow');
    expect(normalizeGameMode('  IronCow  ')).toBe('ironcow');
  });

  it('falls back to standard for every other value', () => {
    expect(normalizeGameMode('standard')).toBe('standard');
    expect(normalizeGameMode('bogus')).toBe('standard');
    expect(normalizeGameMode('')).toBe('standard');
    expect(normalizeGameMode(undefined)).toBe('standard');
    expect(normalizeGameMode(null)).toBe('standard');
    expect(normalizeGameMode(123)).toBe('standard');
  });
});

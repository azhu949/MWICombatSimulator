import { describe, expect, it } from 'vitest';
import { formatDataVersionText } from '../dataVersionPresentation.js';

describe('formatDataVersionText', () => {
  it('renders the index generated time in Asia/Shanghai local time', () => {
    expect(formatDataVersionText('2026-09-14T06:40:54.365Z')).toBe('2026-09-14 14:40:54');
  });

  it('keeps the shape fixed as YYYY-MM-DD HH:mm:ss without any time-zone suffix', () => {
    const text = formatDataVersionText('2026-09-14T06:40:54.365Z');
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(text).not.toContain('Z');
    expect(text).not.toContain('T');
    expect(text).not.toContain('UTC');
    expect(text).not.toContain('+');
  });

  it('rolls the calendar day over when UTC is already past 16:00 of the previous day', () => {
    expect(formatDataVersionText('2026-01-01T18:30:00.000Z')).toBe('2026-01-02 02:30:00');
  });

  it('renders midnight in China as 00:00:00 instead of 24:00:00', () => {
    expect(formatDataVersionText('2025-12-31T16:00:00.000Z')).toBe('2026-01-01 00:00:00');
  });

  it('keeps the same UTC day for timestamps before 08:00 China time', () => {
    expect(formatDataVersionText('2026-03-05T00:00:00.000Z')).toBe('2026-03-05 08:00:00');
  });

  it('falls back to the raw value when the timestamp cannot be parsed', () => {
    expect(formatDataVersionText('unknown')).toBe('unknown');
    expect(formatDataVersionText('not-a-date')).toBe('not-a-date');
    expect(formatDataVersionText('')).toBe('unknown');
    expect(formatDataVersionText(null)).toBe('unknown');
    expect(formatDataVersionText(undefined)).toBe('unknown');
  });
});

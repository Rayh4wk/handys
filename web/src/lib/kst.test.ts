import { describe, expect, it } from 'vitest';
import {
  formatKst,
  formatKstDateTime,
  formatKstTime,
  isoToKstInput,
  kstInputToIso,
} from './kst';

describe('kst', () => {
  it('kstInputToIso converts KST local input to UTC ISO', () => {
    expect(kstInputToIso('2026-10-26T13:00')).toBe('2026-10-26T04:00:00.000Z');
  });
  it('kstInputToIso throws on bad format', () => {
    expect(() => kstInputToIso('garbage')).toThrow();
  });
  it('isoToKstInput', () => {
    expect(isoToKstInput('2026-10-26T04:00:00.000Z')).toBe('2026-10-26T13:00');
    expect(isoToKstInput(null)).toBe('');
  });
  it('formatKst / formatKstTime', () => {
    expect(formatKst('2026-10-26T02:30:00.000Z')).toBe('10/26 11:30');
    expect(formatKstTime('2026-10-26T02:30:00.000Z')).toBe('11:30');
    expect(formatKst(null)).toBe('');
    expect(formatKstTime(null)).toBe('');
  });
  it('formatKstDateTime', () => {
    expect(formatKstDateTime('2026-10-26T04:00:05.000Z')).toBe('2026-10-26 13:00:05');
  });
  it('round-trips across the date boundary', () => {
    expect(isoToKstInput(kstInputToIso('2026-10-26T00:15'))).toBe('2026-10-26T00:15');
  });
});

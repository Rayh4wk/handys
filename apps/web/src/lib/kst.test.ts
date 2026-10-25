import { describe, expect, it } from 'vitest';
import {
  formatKst,
  formatKstClock,
  formatKstTime,
  isoToKstInput,
  kstInputAfter,
  kstInputToIso,
  relativeToNow,
  sameKstDay,
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
  it('sameKstDay compares KST calendar days', () => {
    // 23:30 and 00:30 KST on consecutive days, though both are 10/25 in UTC
    expect(sameKstDay('2026-10-25T14:30:00.000Z', '2026-10-25T15:30:00.000Z')).toBe(false);
    expect(sameKstDay('2026-10-26T02:00:00.000Z', '2026-10-26T04:30:00.000Z', null)).toBe(true);
    expect(sameKstDay(null, undefined)).toBe(true);
  });
  it('relativeToNow', () => {
    const now = Date.parse('2026-10-26T02:00:00.000Z');
    expect(relativeToNow('2026-10-26T02:00:30.000Z', now)).toBe('1분 후');
    expect(relativeToNow('2026-10-26T02:45:00.000Z', now)).toBe('45분 후');
    expect(relativeToNow('2026-10-26T04:59:00.000Z', now)).toBe('2시간 후');
    expect(relativeToNow('2026-10-26T02:00:00.000Z', now)).toBe('지남');
    expect(relativeToNow('2026-10-26T01:00:00.000Z', now)).toBe('지남');
  });
  it('kstInputAfter', () => {
    expect(kstInputAfter('2026-10-26T04:00:00.000Z', 30)).toBe('2026-10-26T13:30');
    expect(kstInputAfter('2026-10-26T14:45:00.000Z', 30)).toBe('2026-10-27T00:15');
  });
  it('formatKstClock', () => {
    expect(formatKstClock('2026-10-26T04:00:05.000Z')).toBe('13:00:05');
    expect(formatKstClock('2026-10-25T15:59:59.000Z')).toBe('00:59:59');
  });
  it('round-trips across the date boundary', () => {
    expect(isoToKstInput(kstInputToIso('2026-10-26T00:15'))).toBe('2026-10-26T00:15');
  });
});

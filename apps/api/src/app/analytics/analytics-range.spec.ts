import { BadRequestException } from '@nestjs/common';

import { addDays, localDay, resolveDateRange, startOfDay } from './analytics-range';

// 2026-10-04 10:00 UTC — 13:00 in Chișinău (UTC+3, summer time).
const NOW = new Date('2026-10-04T10:00:00Z');
const CHISINAU = 'Europe/Chisinau';

describe('resolveDateRange', () => {
  it('reads `days` as that many days ending today, as before', () => {
    const range = resolveDateRange({ days: 7 }, 'UTC', 14, NOW);
    expect([range.from, range.to, range.days]).toEqual(['2026-09-28', '2026-10-04', 7]);
    expect(range.start.toISOString()).toBe('2026-09-28T00:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });

  it('falls back to the endpoint default without any input', () => {
    expect(resolveDateRange({}, 'UTC', 14, NOW).days).toBe(14);
  });

  it('opens and closes the days at local midnight', () => {
    const range = resolveDateRange({ from: '2026-10-01', to: '2026-10-03' }, CHISINAU, 7, NOW);
    expect(range.days).toBe(3);
    expect(range.start.toISOString()).toBe('2026-09-30T21:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-10-03T21:00:00.000Z');
  });

  it('compares with the same number of days right before', () => {
    const range = resolveDateRange({ from: '2026-10-01', to: '2026-10-03' }, CHISINAU, 7, NOW);
    expect(range.previous.from).toBe('2026-09-28');
    expect(range.previous.to).toBe('2026-09-30');
    expect(range.previous.end).toEqual(range.start);
    expect(range.previous.start.toISOString()).toBe('2026-09-27T21:00:00.000Z');
  });

  it('runs `from` alone up to today in the zone', () => {
    // 23:30 UTC on the 4th is already the 5th in Chișinău.
    const late = new Date('2026-10-04T23:30:00Z');
    const range = resolveDateRange({ from: '2026-10-01' }, CHISINAU, 7, late);
    expect(range.to).toBe('2026-10-05');
  });

  it('reaches `days` back from `to` alone', () => {
    const range = resolveDateRange({ to: '2026-09-30', days: 30 }, 'UTC', 7, NOW);
    expect([range.from, range.to]).toEqual(['2026-09-01', '2026-09-30']);
  });

  it('survives the night the clocks go back', () => {
    // Chișinău leaves summer time on 2026-10-25: that day lasts 25 hours.
    const range = resolveDateRange({ from: '2026-10-25', to: '2026-10-25' }, CHISINAU, 7, NOW);
    expect(range.start.toISOString()).toBe('2026-10-24T21:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-10-25T22:00:00.000Z');
  });

  it('clamps `days` like the old endpoints did', () => {
    expect(resolveDateRange({ days: 0 }, 'UTC', 7, NOW).days).toBe(1);
    expect(resolveDateRange({ days: 5000 }, 'UTC', 7, NOW).days).toBe(366);
  });

  it('refuses a reversed, malformed or impossible range', () => {
    expect(() => resolveDateRange({ from: '2026-10-03', to: '2026-10-01' }, 'UTC', 7, NOW)).toThrow(
      BadRequestException,
    );
    expect(() => resolveDateRange({ from: '04.10.2026' }, 'UTC', 7, NOW)).toThrow(BadRequestException);
    expect(() => resolveDateRange({ to: '2026-02-30' }, 'UTC', 7, NOW)).toThrow(BadRequestException);
    expect(() => resolveDateRange({ from: '2024-01-01', to: '2026-01-01' }, 'UTC', 7, NOW)).toThrow(
      BadRequestException,
    );
  });
});

describe('day helpers', () => {
  it('tells the local day of an instant', () => {
    expect(localDay(new Date('2026-10-04T21:30:00Z'), CHISINAU)).toBe('2026-10-05');
    expect(localDay(new Date('2026-10-04T21:30:00Z'), 'UTC')).toBe('2026-10-04');
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('finds midnight in a zone west of Greenwich', () => {
    expect(startOfDay('2026-10-04', 'America/New_York').toISOString()).toBe('2026-10-04T04:00:00.000Z');
  });
});

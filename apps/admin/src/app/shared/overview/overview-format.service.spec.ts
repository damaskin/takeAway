import { TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService, type Translation } from '@ngx-translate/core';
import { TRANSLATIONS_RU } from '@takeaway/i18n';

import { OverviewFormat, createSort, deltaPercent, todayIn } from './overview-format.service';

describe('deltaPercent', () => {
  it('is the change in percent, or nothing without a base', () => {
    expect(deltaPercent(150, 100)).toBe(50);
    expect(deltaPercent(50, 100)).toBe(-50);
    expect(deltaPercent(10, 0)).toBeNull();
  });
});

describe('createSort', () => {
  const rows = [
    { name: 'B', n: 2 as number | null },
    { name: 'A', n: null },
    { name: 'C', n: 5 },
  ];

  it('runs descending first, flips on the same column, sinks blanks', () => {
    const sort = createSort<'name' | 'n'>('n');
    const pick = (r: (typeof rows)[number], k: 'name' | 'n') => (k === 'name' ? r.name : r.n);
    expect(sort.apply(rows, pick).map((r) => r.name)).toEqual(['C', 'B', 'A']);
    sort.toggle('n');
    expect(sort.apply(rows, pick).map((r) => r.name)).toEqual(['B', 'C', 'A']);
    // Names start A to Z.
    sort.toggle('name');
    expect(sort.apply(rows, pick).map((r) => r.name)).toEqual(['A', 'B', 'C']);
  });
});

describe('todayIn', () => {
  it('reads the day in the given zone', () => {
    const lateEvening = new Date('2026-10-04T22:30:00Z');
    expect(todayIn('Europe/Chisinau', lateEvening)).toBe('2026-10-05');
    expect(todayIn('UTC', lateEvening)).toBe('2026-10-04');
  });
});

describe('OverviewFormat', () => {
  let format: OverviewFormat;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideTranslateService()] });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('ru', TRANSLATIONS_RU as unknown as Translation);
    translate.use('ru');
    format = TestBed.inject(OverviewFormat);
  });

  it('says what the period is compared with', () => {
    const line = format.periodLine({
      from: '2026-09-05',
      to: '2026-10-04',
      days: 30,
      timeZone: 'Europe/Chisinau',
      previousFrom: '2026-08-06',
      previousTo: '2026-09-04',
    });
    expect(line.replace(/\s+/g, ' ')).toBe('5 сент. 2026 — 4 окт. 2026 · сравнение с предыдущими 30 днями');
  });

  it('marks growth as new when there was nothing before', () => {
    expect(format.delta(10, 0)).toEqual({ delta: null, text: '', hint: 'новое за период' });
    expect(format.delta(0, 0).hint).toBe('');
    expect(format.delta(120, 100).delta).toBe(20);
  });

  it('measures a share change in percentage points', () => {
    const d = format.pointsDelta(3.4, 2.7);
    expect(d.delta).toBeCloseTo(0.7);
    expect(d.text.replace(/\s+/g, ' ')).toBe('+0,7 п.п.');
  });

  it('keeps the café day on the hour chart unless orders came outside it', () => {
    const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: hour === 9 ? 4 : 0, revenueCents: 0 }));
    expect(format.hourItems(hours, 'MDL').map((i) => i.label)[0]).toBe('7');
    expect(format.hourItems(hours, 'MDL')).toHaveLength(16);
    hours[23] = { hour: 23, orders: 1, revenueCents: 0 };
    hours[5] = { hour: 5, orders: 1, revenueCents: 0 };
    const items = format.hourItems(hours, 'MDL');
    expect(items[0]?.label).toBe('5');
    expect(items.at(-1)?.title).toBe('23:00–00:00');
  });

  it('names weekdays Monday first', () => {
    const days = Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, orders: 1, revenueCents: 0 }));
    const items = format.weekdayItems(days, 'MDL');
    expect(items[0]?.title).toBe('Понедельник');
    expect(items[6]?.label).toBe('Вс');
  });

  it('groups statuses into handed over, in progress, cancelled and expired', () => {
    const slices = format.statusSlices({ PICKED_UP: 5, DELIVERED: 1, PAID: 2, READY: 1, CANCELLED: 3, EXPIRED: 4 });
    expect(slices.map((s) => [s.key, s.value])).toEqual([
      ['done', 6],
      ['open', 3],
      ['cancelled', 3],
      ['expired', 4],
    ]);
  });
});

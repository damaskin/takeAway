import { addDays, presetRange, todayIn } from './settlement-periods';

describe('presetRange', () => {
  // Saturday, 10 October 2026.
  const today = '2026-10-10';

  it('takes last week from Monday to Sunday', () => {
    expect(presetRange('lastWeek', today)).toEqual({ from: '2026-09-28', to: '2026-10-04' });
  });

  it('runs this week from Monday to today', () => {
    expect(presetRange('thisWeek', today)).toEqual({ from: '2026-10-05', to: '2026-10-10' });
    // A Monday is the first day of its own week.
    expect(presetRange('thisWeek', '2026-10-05')).toEqual({ from: '2026-10-05', to: '2026-10-05' });
  });

  it('treats Sunday as the end of the week, not the start', () => {
    expect(presetRange('lastWeek', '2026-10-11')).toEqual({ from: '2026-09-28', to: '2026-10-04' });
  });

  it('takes whole calendar months', () => {
    expect(presetRange('thisMonth', today)).toEqual({ from: '2026-10-01', to: '2026-10-10' });
    expect(presetRange('lastMonth', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(presetRange('lastMonth', '2026-03-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(presetRange('lastMonth', '2027-01-05')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('todayIn', () => {
  it('reads the calendar of the given zone', () => {
    const lateEvening = new Date('2026-10-10T22:30:00Z');
    expect(todayIn('Europe/Chisinau', lateEvening)).toBe('2026-10-11');
    expect(todayIn('UTC', lateEvening)).toBe('2026-10-10');
  });
});

describe('addDays', () => {
  it('crosses months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

import {
  ALWAYS_OPEN_ROWS,
  crossesMidnight,
  dayProblem,
  daysFromRows,
  hoursModeOf,
  rowsFromDays,
  timeToMinutes,
} from './working-hours';

describe('working hours', () => {
  it('tells "never set" apart from an explicit 24/7 and from a schedule', () => {
    expect(hoursModeOf([])).toBe('unset');
    expect(hoursModeOf(ALWAYS_OPEN_ROWS)).toBe('always');
    expect(hoursModeOf([{ weekday: 1, opensAt: 480, closesAt: 1200, isClosed: false }])).toBe('schedule');
  });

  it('shows a weekday without a row as a day off — the kitchen treats it as closed', () => {
    const days = daysFromRows([{ weekday: 1, opensAt: 480, closesAt: 1200, isClosed: false }]);
    expect(days[1]).toEqual({ isClosed: false, opens: '08:00', closes: '20:00' });
    expect(days[0]?.isClosed).toBe(true);
    expect(days[6]?.isClosed).toBe(true);
  });

  it('saves closing at 00:00 as midnight at the end of the day and reads it back as 00:00', () => {
    const rows = rowsFromDays([{ isClosed: false, opens: '08:00', closes: '00:00' }]);
    expect(rows).toEqual([{ weekday: 0, isClosed: false, opensAt: 480, closesAt: 1440 }]);
    expect(daysFromRows(rows)[0]).toEqual({ isClosed: false, opens: '08:00', closes: '00:00' });
  });

  it('refuses an open day without both times, where a cleared field used to become 00:00', () => {
    expect(dayProblem({ isClosed: false, opens: '', closes: '21:00' })).toBe('missingTime');
    expect(dayProblem({ isClosed: false, opens: '09:00', closes: '09:00' })).toBe('sameTime');
    expect(dayProblem({ isClosed: true, opens: '', closes: '' })).toBeNull();
    expect(dayProblem({ isClosed: false, opens: '09:00', closes: '21:00' })).toBeNull();
  });

  it('flags a window that runs past midnight', () => {
    expect(crossesMidnight({ isClosed: false, opens: '22:00', closes: '02:00' })).toBe(true);
    expect(crossesMidnight({ isClosed: false, opens: '09:00', closes: '00:00' })).toBe(false);
    expect(crossesMidnight({ isClosed: false, opens: '09:00', closes: '21:00' })).toBe(false);
  });

  it('reads the values a time input produces', () => {
    expect(timeToMinutes('08:30')).toBe(510);
    expect(timeToMinutes('08:30:00')).toBe(510);
    expect(timeToMinutes('')).toBeNull();
    expect(timeToMinutes('25:00')).toBeNull();
  });
});

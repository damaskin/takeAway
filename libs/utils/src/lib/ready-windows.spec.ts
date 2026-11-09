import { inReadyWindows, readyTimeShown, readyWindowTimes } from './ready-windows';

describe('readyWindowTimes', () => {
  it("offers each window's ends and the five-minute marks inside it", () => {
    expect(
      readyWindowTimes([
        { from: '2026-11-09T12:56:00.000Z', to: '2026-11-09T13:00:00.000Z' },
        { from: '2026-11-09T13:16:00.000Z', to: '2026-11-09T13:31:00.000Z' },
      ]),
    ).toEqual([
      '2026-11-09T12:56:00.000Z',
      '2026-11-09T13:00:00.000Z',
      '2026-11-09T13:16:00.000Z',
      '2026-11-09T13:20:00.000Z',
      '2026-11-09T13:25:00.000Z',
      '2026-11-09T13:30:00.000Z',
      '2026-11-09T13:31:00.000Z',
    ]);
  });

  it('gives a one-minute window once and skips nonsense', () => {
    expect(
      readyWindowTimes([
        { from: '2026-11-09T12:07:00.000Z', to: '2026-11-09T12:07:00.000Z' },
        { from: 'soon', to: '2026-11-09T13:00:00.000Z' },
        { from: '2026-11-09T14:00:00.000Z', to: '2026-11-09T13:00:00.000Z' },
      ]),
    ).toEqual(['2026-11-09T12:07:00.000Z']);
  });
});

describe('inReadyWindows', () => {
  it('includes both ends', () => {
    const windows = [{ from: '2026-11-09T12:56:00.000Z', to: '2026-11-09T13:00:00.000Z' }];
    expect(inReadyWindows(windows, '2026-11-09T13:00:00.000Z')).toBe(true);
    expect(inReadyWindows(windows, '2026-11-09T13:01:00.000Z')).toBe(false);
  });
});

describe('readyTimeShown', () => {
  it('rounds the clock time and the wait up, never early', () => {
    expect(readyTimeShown('2026-11-09T12:10:20.000Z', Date.parse('2026-11-09T12:00:00Z'))).toEqual({
      at: '2026-11-09T12:11:00.000Z',
      minutes: 11,
    });
    expect(readyTimeShown('2026-11-09T11:59:00.000Z', Date.parse('2026-11-09T12:00:00Z')).minutes).toBe(0);
  });
});

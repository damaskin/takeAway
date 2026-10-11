import { safeNext } from './login.page';

describe('safeNext', () => {
  it('follows a path inside the cabinet — the unbound tablet sends /kitchen', () => {
    expect(safeNext('/kitchen')).toBe('/kitchen');
    expect(safeNext('/stores/abc?tab=hours')).toBe('/stores/abc?tab=hours');
  });

  it('never leaves the cabinet', () => {
    for (const next of [
      null,
      '',
      'kitchen',
      'https://evil.test',
      '//evil.test',
      '/\\evil.test',
      'javascript:alert(1)',
    ]) {
      expect(safeNext(next)).toBe('/');
    }
  });
});

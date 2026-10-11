import { normalizeContact } from './contact';

describe('normalizeContact', () => {
  it('lower-cases an email', () => {
    expect(normalizeContact('  Ivan@Mail.MD ')).toEqual({ kind: 'email', value: 'ivan@mail.md' });
  });

  it('reads a phone the way the rest of the platform does', () => {
    expect(normalizeContact('069 123 456')).toEqual({ kind: 'phone', value: '+37369123456' });
    expect(normalizeContact('+373 (69) 12-34-56')).toEqual({ kind: 'phone', value: '+37369123456' });
    expect(normalizeContact('+44 20 7946 0958')).toEqual({ kind: 'phone', value: '+442079460958' });
  });

  it.each(['', '   ', 'ivan@', 'ivan@mail', '@mail.md', 'iv an@mail.md', 'telegram @ivan', '12345', 'call me'])(
    'refuses %p',
    (input) => {
      expect(normalizeContact(input)).toBeNull();
    },
  );
});

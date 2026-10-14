import { FormControl } from '@angular/forms';

import { emailOrLoginValidator, signInIdentifier } from './sign-in-identifier';

describe('signInIdentifier', () => {
  it('reads anything with an @ as an email', () => {
    expect(signInIdentifier(' Owner@NoName.md ')).toEqual({ kind: 'email', value: 'owner@noname.md' });
    expect(signInIdentifier('owner@')).toBeNull();
  });

  it('reads the rest as a login, lowercased', () => {
    expect(signInIdentifier('Anna.K_2-b')).toEqual({ kind: 'login', value: 'anna.k_2-b' });
    expect(signInIdentifier('abc')).toEqual({ kind: 'login', value: 'abc' });
  });

  it('is neither for a login outside the rule', () => {
    for (const raw of ['', '  ', 'ab', 'a'.repeat(33), 'anna k', 'анна', 'anna+1']) {
      expect(signInIdentifier(raw)).toBeNull();
    }
  });
});

describe('emailOrLoginValidator', () => {
  it('leaves an empty field to Validators.required', () => {
    expect(emailOrLoginValidator(new FormControl('', { nonNullable: true }))).toBeNull();
  });

  it('flags a value that is neither', () => {
    expect(emailOrLoginValidator(new FormControl('anna k', { nonNullable: true }))).toEqual({ identifier: true });
    expect(emailOrLoginValidator(new FormControl('anna.k', { nonNullable: true }))).toBeNull();
  });
});

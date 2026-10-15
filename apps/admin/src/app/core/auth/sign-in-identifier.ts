import { type AbstractControl, FormControl, type ValidationErrors, Validators } from '@angular/forms';
import { STAFF_LOGIN_PATTERN } from '@takeaway/shared-types';

/** What staff sign in with: an email, or the login an owner gave someone without one. */
export type SignInIdentifier = { kind: 'email'; value: string } | { kind: 'login'; value: string };

/**
 * Reads what was typed into a «Почта или логин» field. An '@' makes it an
 * email — a login never has one. Both are compared lowercase, so the value
 * is trimmed and lowercased; null when it is neither a valid email nor a
 * valid login.
 */
export function signInIdentifier(raw: string): SignInIdentifier | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (value.includes('@')) {
    return Validators.email(new FormControl(value)) === null ? { kind: 'email', value } : null;
  }
  return STAFF_LOGIN_PATTERN.test(value) ? { kind: 'login', value } : null;
}

/** Form validator for a «Почта или логин» field: `{ identifier: true }` when it is neither. */
export function emailOrLoginValidator(control: AbstractControl<string>): ValidationErrors | null {
  const raw = control.value ?? '';
  if (!raw.trim()) return null;
  return signInIdentifier(raw) ? null : { identifier: true };
}

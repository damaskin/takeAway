import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { normalizePhone } from '@takeaway/utils';

/**
 * The API's phone rule, checked before the round-trip: anything
 * `normalizePhone` reads as a number — international, or a Moldovan,
 * Ukrainian or Russian local habit. `{ phone: true }` when it cannot;
 * `{ required: true }` for blank when the number is required.
 */
export function phoneValidator(options: { required: boolean }): ValidatorFn {
  return (control: AbstractControl<string | null>): ValidationErrors | null => {
    const value = (control.value ?? '').trim();
    if (!value) return options.required ? { required: true } : null;
    return normalizePhone(value) ? null : { phone: true };
  };
}

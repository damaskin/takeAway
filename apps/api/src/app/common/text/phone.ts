import { normalizePhone } from '@takeaway/utils';
import { Transform } from 'class-transformer';
import { ValidateBy, type ValidationOptions } from 'class-validator';

/**
 * A phone field the way people type it, reduced to E.164 before validation
 * (see `normalizePhone`): «+373 (69) 12-34-56», «069 123 456» and
 * «8 916 123-45-67» all arrive as the international number. What does not
 * read as a phone number is left as it was typed, for
 * {@link IsInternationalPhone} to refuse; blank becomes `undefined`.
 */
export function ToPhone(): PropertyDecorator {
  return Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    if (value.trim() === '') return undefined;
    return normalizePhone(value) ?? value;
  });
}

/** Passes an E.164 number that {@link ToPhone} produced; refuses anything it could not read. */
export function IsInternationalPhone(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isInternationalPhone',
      validator: {
        validate: (value: unknown) => typeof value === 'string' && normalizePhone(value) === value,
        defaultMessage: () => '$property must be a phone number in international format, e.g. +37369123456',
      },
    },
    options,
  );
}

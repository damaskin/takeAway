import { normalizePhone } from './phone';

/** Something plausible on both sides of one `@`, with a dot in the domain. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A way to answer someone, as the support form stores it. */
export type ContactPoint = { kind: 'email'; value: string } | { kind: 'phone'; value: string };

/**
 * "How do we answer you" from a free-text field, reduced to one canonical
 * form — an email in lower case, or a phone in E.164 (see `normalizePhone`)
 * — or null when it is neither. The same visitor typing «Ivan@Mail.md» and
 * «ivan@mail.md», or «069 123 456» and «+373 69 123 456», is one contact,
 * which is what the per-contact limit on the site's support form counts.
 */
export function normalizeContact(input: string): ContactPoint | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.includes('@')) {
    const email = trimmed.toLowerCase();
    return EMAIL_PATTERN.test(email) ? { kind: 'email', value: email } : null;
  }
  const phone = normalizePhone(trimmed);
  return phone ? { kind: 'phone', value: phone } : null;
}

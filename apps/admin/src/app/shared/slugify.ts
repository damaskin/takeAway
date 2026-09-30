/**
 * A URL-safe slug suggested from a human name.
 *
 * Only a suggestion: it fills the field while the user has not typed one
 * themselves, and every slug is still editable before the record exists.
 * Cyrillic and other non-Latin names normalise away to nothing here, which
 * is why the field stays editable rather than being derived on save.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

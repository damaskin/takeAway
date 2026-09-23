/**
 * URL slugs from names typed in Russian, Romanian or English.
 *
 * The old slugifiers kept only `[a-z0-9]`, so «Ванильный сироп» became an
 * empty string (and a failed save) and «Кофейня Ромашка» a random token.
 * Cyrillic is transliterated (a simplified ГОСТ 7.79-2000 B / passport
 * scheme, which is what people read), Romanian diacritics are folded.
 */
const TRANSLIT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  і: 'i',
  ї: 'yi',
  є: 'ye',
  ґ: 'g',
};

/** Lower-case latin, digits and single hyphens; empty when nothing usable remains. */
export function slugify(input: string, maxLength = 60): string {
  const transliterated = Array.from(input.toLowerCase(), (ch) => TRANSLIT[ch] ?? ch).join('');
  return transliterated
    .normalize('NFKD') // ă, ș, ț, é … → base letter + combining mark
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

/**
 * The first free slug for `name`: the slug itself, then `-2`, `-3`, … A
 * name with nothing transliterable (emoji, punctuation) falls back to
 * `fallback`. `isTaken` is asked in order, so keep it to one indexed lookup.
 */
export async function uniqueSlug(
  name: string,
  isTaken: (candidate: string) => Promise<boolean>,
  fallback = 'item',
  maxLength = 60,
): Promise<string> {
  const base = slugify(name, maxLength - 4) || fallback;
  if (!(await isTaken(base))) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  // Not reached in practice; a random tail keeps it total rather than throwing.
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

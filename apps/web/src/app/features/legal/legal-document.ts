/**
 * The site's legal and help pages — Privacy Policy, Terms of Service and
 * Support — as plain data, one file per document and language under
 * `content/`.
 *
 * They live here rather than in the shared translation dictionaries because
 * those ship inside every app's initial bundle (web, Mini App, admin), and
 * pages of legal prose would weigh on all three while only the website shows
 * them. Here they load with the page's own lazy chunk.
 *
 * Text is written with two bits of inline markup so the content files stay
 * readable prose: `[label](target)` for a link and `**words**` for emphasis.
 * A target starting with `/` is a page of this site (`/privacy#location`
 * works); anything else — `mailto:`, `https://` — is an ordinary link.
 */

export type LegalDocKey = 'privacy' | 'terms' | 'support';

export const LEGAL_DOC_KEYS: readonly LegalDocKey[] = ['privacy', 'terms', 'support'];

/** A paragraph, or a bulleted list of items. */
export type LegalBlock = string | { readonly list: readonly string[] };

export interface LegalSection {
  /** Anchor for links such as `/privacy#location`, and the table of contents. */
  readonly id?: string;
  /** Omitted for a section of lead paragraphs that opens the page. */
  readonly heading?: string;
  /** 3 for a sub-topic or question under the previous heading; 2 by default. */
  readonly level?: 2 | 3;
  readonly blocks: readonly LegalBlock[];
}

export interface LegalDocument {
  /** The page heading, and the browser tab title with "— takeAway" after it. */
  readonly title: string;
  readonly description: string;
  /** "Effective 28 September 2026" — shown under the heading. */
  readonly effective?: string;
  /** Lists the top-level sections under the heading. */
  readonly toc: boolean;
  readonly sections: readonly LegalSection[];
}

export type LegalSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'strong'; readonly text: string }
  | { readonly kind: 'route'; readonly text: string; readonly path: string; readonly fragment: string | undefined }
  | { readonly kind: 'link'; readonly text: string; readonly href: string; readonly external: boolean };

const INLINE_MARKUP = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Splits a line of content into plain text, emphasis and links. */
export function parseLegalText(source: string): LegalSegment[] {
  const segments: LegalSegment[] = [];
  let rest = 0;
  for (const match of source.matchAll(INLINE_MARKUP)) {
    if (match.index > rest) segments.push({ kind: 'text', text: source.slice(rest, match.index) });
    const [whole, strong, label, target] = match;
    if (strong !== undefined) segments.push({ kind: 'strong', text: strong });
    else if (label !== undefined && target !== undefined) segments.push(link(label, target));
    rest = match.index + whole.length;
  }
  if (rest < source.length) segments.push({ kind: 'text', text: source.slice(rest) });
  return segments;
}

function link(text: string, target: string): LegalSegment {
  if (!target.startsWith('/')) return { kind: 'link', text, href: target, external: /^https?:/.test(target) };
  const hash = target.indexOf('#');
  return hash < 0
    ? { kind: 'route', text, path: target, fragment: undefined }
    : { kind: 'route', text, path: target.slice(0, hash), fragment: target.slice(hash + 1) || undefined };
}

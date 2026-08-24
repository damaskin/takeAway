/**
 * Minimal XML reader / canonical writer.
 *
 * The Agroprombank («Клевер») merchant API exchanges small, flat XML
 * documents signed with XMLDSig. Signing and verification both require
 * Canonical XML 1.0 (`REC-xml-c14n-20010315`), so a plain string serializer
 * is not enough — we need a parse → canonical-serialize round trip that is
 * byte-for-byte reproducible on both sides.
 *
 * This is deliberately a small in-repo implementation rather than a new
 * dependency: the documents involved have no DTDs, no entity declarations
 * and at most one namespace declaration (`xmlns` on `<Signature>`), which is
 * a subset c14n can be implemented for exactly.
 */

export interface XmlAttr {
  name: string;
  value: string;
}

export interface XmlElement {
  type: 'element';
  name: string;
  attrs: XmlAttr[];
  children: XmlNode[];
}

export interface XmlText {
  type: 'text';
  value: string;
}

export interface XmlComment {
  type: 'comment';
  value: string;
}

export interface XmlProcessingInstruction {
  type: 'pi';
  target: string;
  data: string;
}

export type XmlNode = XmlElement | XmlText | XmlComment | XmlProcessingInstruction;

export class XmlParseError extends Error {}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Expands the five predefined entities plus numeric character references. */
export function decodeEntities(raw: string): string {
  if (!raw.includes('&')) return raw;
  return raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

/**
 * Parses a document and returns its root element. Line endings are normalised
 * to `\n` first, as required before canonicalization.
 */
export function parseXml(source: string): XmlElement {
  const src = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  let i = 0;
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;

  const appendChild = (node: XmlNode): void => {
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
  };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) break;
    if (lt > i) {
      const raw = src.slice(i, lt);
      if (stack.length > 0) appendChild({ type: 'text', value: decodeEntities(raw) });
      i = lt;
    }

    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      if (end === -1) throw new XmlParseError('Unterminated comment');
      if (stack.length > 0) appendChild({ type: 'comment', value: src.slice(i + 4, end) });
      i = end + 3;
      continue;
    }

    if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9);
      if (end === -1) throw new XmlParseError('Unterminated CDATA section');
      if (stack.length > 0) appendChild({ type: 'text', value: src.slice(i + 9, end) });
      i = end + 3;
      continue;
    }

    if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i + 2);
      if (end === -1) throw new XmlParseError('Unterminated processing instruction');
      const body = src.slice(i + 2, end);
      const space = body.search(/\s/);
      const target = space === -1 ? body : body.slice(0, space);
      // The XML declaration is not part of the canonical form and is dropped.
      if (target.toLowerCase() !== 'xml' && stack.length > 0) {
        appendChild({ type: 'pi', target, data: space === -1 ? '' : body.slice(space + 1).trim() });
      }
      i = end + 2;
      continue;
    }

    if (src.startsWith('<!', i)) {
      // DOCTYPE and friends: skipped, they carry no canonical output.
      const end = src.indexOf('>', i);
      if (end === -1) throw new XmlParseError('Unterminated declaration');
      i = end + 1;
      continue;
    }

    if (src.startsWith('</', i)) {
      const end = src.indexOf('>', i);
      if (end === -1) throw new XmlParseError('Unterminated closing tag');
      const name = src.slice(i + 2, end).trim();
      const open = stack.pop();
      if (!open || open.name !== name) {
        throw new XmlParseError(`Closing tag </${name}> does not match <${open?.name ?? 'nothing'}>`);
      }
      i = end + 1;
      continue;
    }

    const tagEnd = findTagEnd(src, i);
    const rawTag = src.slice(i + 1, tagEnd);
    const selfClosing = rawTag.endsWith('/');
    const element = parseStartTag(selfClosing ? rawTag.slice(0, -1) : rawTag);
    if (stack.length === 0) {
      if (root) throw new XmlParseError('Document has more than one root element');
      root = element;
    } else {
      appendChild(element);
    }
    if (!selfClosing) stack.push(element);
    i = tagEnd + 1;
  }

  const unclosed = stack[stack.length - 1];
  if (unclosed) throw new XmlParseError(`Unclosed element <${unclosed.name}>`);
  if (!root) throw new XmlParseError('Document has no root element');
  return root;
}

/** Locates the `>` that closes a start tag, ignoring any inside attribute values. */
function findTagEnd(src: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>') return i;
  }
  throw new XmlParseError('Unterminated start tag');
}

const START_TAG_RE = /^\s*([^\s/>]+)\s*/;
const ATTR_RE = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')\s*/y;

function parseStartTag(inner: string): XmlElement {
  const head = START_TAG_RE.exec(inner);
  if (!head) throw new XmlParseError(`Malformed start tag: <${inner}>`);
  const element: XmlElement = { type: 'element', name: head[1] ?? '', attrs: [], children: [] };
  ATTR_RE.lastIndex = head[0].length;
  while (ATTR_RE.lastIndex < inner.length) {
    const m = ATTR_RE.exec(inner);
    if (!m) throw new XmlParseError(`Malformed attributes in <${inner}>`);
    element.attrs.push({ name: m[1] ?? '', value: normalizeAttrValue(decodeEntities(m[3] ?? m[4] ?? '')) });
  }
  return element;
}

/** XML attribute-value normalisation: tab/newline collapse to a single space. */
function normalizeAttrValue(value: string): string {
  return value.replace(/[\t\n]/g, ' ');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;')
    .replace(/\n/g, '&#xA;')
    .replace(/\r/g, '&#xD;');
}

function prefixOf(name: string): string {
  const idx = name.indexOf(':');
  return idx === -1 ? '' : name.slice(0, idx);
}

function localNameOf(name: string): string {
  const idx = name.indexOf(':');
  return idx === -1 ? name : name.slice(idx + 1);
}

/**
 * Canonical XML 1.0 (omitting comments) for an element subtree.
 *
 * `ancestorNs` carries namespace declarations in scope from outside the
 * subtree; the apex element renders them, as the spec requires when a
 * signature covers a nested element such as `SignedInfo`.
 */
export function canonicalize(el: XmlElement, ancestorNs: ReadonlyMap<string, string> = new Map()): string {
  const out: string[] = [];
  serializeElement(el, out, new Map<string, string>(), ancestorNs, true);
  return out.join('');
}

function serializeElement(
  el: XmlElement,
  out: string[],
  rendered: ReadonlyMap<string, string>,
  inherited: ReadonlyMap<string, string>,
  isApex: boolean,
): void {
  const own = new Map<string, string>();
  const plain: XmlAttr[] = [];
  for (const attr of el.attrs) {
    if (attr.name === 'xmlns') own.set('', attr.value);
    else if (attr.name.startsWith('xmlns:')) own.set(attr.name.slice(6), attr.value);
    else plain.push(attr);
  }

  const inScope = new Map(inherited);
  for (const [prefix, uri] of own) inScope.set(prefix, uri);

  // The apex renders every namespace visible to it; descendants render only
  // what actually changes relative to what an ancestor already emitted.
  const candidates = isApex ? inScope : own;
  const toRender: XmlAttr[] = [];
  for (const [prefix, uri] of candidates) {
    const already = rendered.get(prefix) ?? '';
    if (uri === already) continue;
    if (prefix === '' && uri === '') continue;
    toRender.push({ name: prefix === '' ? 'xmlns' : `xmlns:${prefix}`, value: uri });
  }
  toRender.sort((a, b) => compareNsDecl(a.name, b.name));

  const nextRendered = new Map(rendered);
  for (const [prefix, uri] of candidates) nextRendered.set(prefix, uri);

  plain.sort((a, b) => compareAttributes(a.name, b.name, inScope));

  out.push('<', el.name);
  for (const decl of toRender) out.push(' ', decl.name, '="', escapeAttr(decl.value), '"');
  for (const attr of plain) out.push(' ', attr.name, '="', escapeAttr(attr.value), '"');
  out.push('>');

  for (const node of el.children) {
    switch (node.type) {
      case 'element':
        serializeElement(node, out, nextRendered, inScope, false);
        break;
      case 'text':
        out.push(escapeText(node.value));
        break;
      case 'pi':
        out.push('<?', node.target, node.data ? ` ${node.data}` : '', '?>');
        break;
      default:
        // Comments are excluded from the non-`#WithComments` canonical form.
        break;
    }
  }

  out.push('</', el.name, '>');
}

function compareNsDecl(a: string, b: string): number {
  if (a === b) return 0;
  if (a === 'xmlns') return -1;
  if (b === 'xmlns') return 1;
  return a < b ? -1 : 1;
}

function compareAttributes(a: string, b: string, inScope: ReadonlyMap<string, string>): number {
  const uriA = prefixOf(a) === '' ? '' : (inScope.get(prefixOf(a)) ?? '');
  const uriB = prefixOf(b) === '' ? '' : (inScope.get(prefixOf(b)) ?? '');
  if (uriA !== uriB) return uriA < uriB ? -1 : 1;
  const localA = localNameOf(a);
  const localB = localNameOf(b);
  if (localA === localB) return 0;
  return localA < localB ? -1 : 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Building & reading helpers
// ─────────────────────────────────────────────────────────────────────────────

export type XmlFieldValue = string | number | boolean | null | undefined;

/**
 * Builds a flat element from `{ tag: value }` pairs. `null`/`undefined` values
 * are dropped so optional bank fields stay absent rather than empty.
 */
export function buildElement(name: string, fields: Record<string, XmlFieldValue>, attrs: XmlAttr[] = []): XmlElement {
  const kids: XmlNode[] = [];
  for (const [tag, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    kids.push({
      type: 'element',
      name: tag,
      attrs: [],
      children: [{ type: 'text', value: String(value) }],
    });
  }
  return { type: 'element', name, attrs, children: kids };
}

/** First direct child element with the given (case-insensitive) name. */
export function child(el: XmlElement, name: string): XmlElement | null {
  const lower = name.toLowerCase();
  for (const node of el.children) {
    if (node.type === 'element' && node.name.toLowerCase() === lower) return node;
  }
  return null;
}

/** All direct child elements with the given (case-insensitive) name. */
export function children(el: XmlElement, name: string): XmlElement[] {
  const lower = name.toLowerCase();
  return el.children.filter((n): n is XmlElement => n.type === 'element' && n.name.toLowerCase() === lower);
}

/** Concatenated text content of a direct child, or `null` when absent. */
export function text(el: XmlElement, name: string): string | null {
  const node = child(el, name);
  return node ? textOf(node) : null;
}

export function textOf(el: XmlElement): string {
  let out = '';
  for (const node of el.children) {
    if (node.type === 'text') out += node.value;
    else if (node.type === 'element') out += textOf(node);
  }
  return out;
}

/** Numeric text content of a direct child, or `null` when absent / not a number. */
export function num(el: XmlElement, name: string): number | null {
  const raw = text(el, name);
  if (raw === null) return null;
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/** Flattens an element subtree into a plain object — handy for `rawJson` columns. */
export function toPlainObject(el: XmlElement): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const node of el.children) {
    if (node.type !== 'element') continue;
    const key = node.name;
    const hasElementChildren = node.children.some((c) => c.type === 'element');
    const value: unknown = hasElementChildren ? toPlainObject(node) : textOf(node);
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else if (Array.isArray(existing)) (existing as unknown[]).push(value);
    else out[key] = [existing, value];
  }
  return out;
}

/** Serializes a document: XML declaration + canonical body. */
export function serializeDocument(el: XmlElement): string {
  return `<?xml version="1.0" encoding="UTF-8"?>${canonicalize(el)}`;
}

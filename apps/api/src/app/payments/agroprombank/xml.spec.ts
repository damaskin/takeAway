import { buildElement, canonicalize, children, num, parseXml, serializeDocument, text, toPlainObject } from './xml';

describe('xml parser', () => {
  it('parses a flat bank response', () => {
    const root = parseXml(
      `<?xml version="1.0" encoding="UTF-8"?>
       <root>
         <result>1</result>
         <token>E6B2C8EC084D52C</token>
       </root>`,
    );
    expect(root.name).toBe('root');
    expect(text(root, 'result')).toBe('1');
    expect(num(root, 'result')).toBe(1);
    expect(text(root, 'token')).toBe('E6B2C8EC084D52C');
    expect(text(root, 'missing')).toBeNull();
  });

  it('is case-insensitive on tag lookups, as the bank mixes casing', () => {
    const root = parseXml('<root><LastDigit>0578</LastDigit></root>');
    expect(text(root, 'lastdigit')).toBe('0578');
  });

  it('expands predefined and numeric entities', () => {
    const root = parseXml('<root><d>a &amp; b &lt;c&gt; &#1049; &#x41;</d></root>');
    expect(text(root, 'd')).toBe('a & b <c> Й A');
  });

  it('reads CDATA as text and ignores comments', () => {
    const root = parseXml('<root><!-- note --><d><![CDATA[a < b]]></d></root>');
    expect(text(root, 'd')).toBe('a < b');
    expect(canonicalize(root)).toBe('<root><d>a &lt; b</d></root>');
  });

  it('handles self-closing elements and attributes containing angle brackets', () => {
    const root = parseXml('<root><a href="x&gt;y"/><b/></root>');
    expect(canonicalize(root)).toBe('<root><a href="x>y"></a><b></b></root>');
  });

  it('collects repeated blocks', () => {
    const root = parseXml('<root><trx><rrn>1</rrn></trx><trx><rrn>2</rrn></trx></root>');
    expect(children(root, 'trx').map((t) => text(t, 'rrn'))).toEqual(['1', '2']);
  });

  it('rejects malformed documents instead of guessing', () => {
    expect(() => parseXml('<root><a></b></root>')).toThrow();
    expect(() => parseXml('<root><a></root>')).toThrow();
    expect(() => parseXml('not xml at all')).toThrow();
  });
});

describe('canonicalize', () => {
  it('sorts attributes by local name and renders namespaces first', () => {
    const root = parseXml('<root b="2" a="1" xmlns="urn:x"></root>');
    expect(canonicalize(root)).toBe('<root xmlns="urn:x" a="1" b="2"></root>');
  });

  it('renders a namespace inherited from outside the subtree on the apex node', () => {
    const signature = parseXml('<Signature xmlns="urn:dsig"><SignedInfo><a>1</a></SignedInfo></Signature>');
    const [signedInfo] = children(signature, 'SignedInfo');
    if (!signedInfo) throw new Error('fixture is missing <SignedInfo>');
    expect(canonicalize(signedInfo, new Map([['', 'urn:dsig']]))).toBe(
      '<SignedInfo xmlns="urn:dsig"><a>1</a></SignedInfo>',
    );
  });

  it('does not repeat a namespace a parent already rendered', () => {
    const root = parseXml('<root xmlns="urn:x"><a xmlns="urn:x"><b/></a></root>');
    expect(canonicalize(root)).toBe('<root xmlns="urn:x"><a><b></b></a></root>');
  });

  it('escapes text and attribute values per the c14n rules', () => {
    const root = parseXml('<root a="q&quot;t"><d>&lt;&amp;&gt;</d></root>');
    expect(canonicalize(root)).toBe('<root a="q&quot;t"><d>&lt;&amp;&gt;</d></root>');
  });

  it('preserves whitespace text nodes — they are part of the signed bytes', () => {
    const root = parseXml('<root>\n  <a>1</a>\n</root>');
    expect(canonicalize(root)).toBe('<root>\n  <a>1</a>\n</root>');
  });

  it('normalises CRLF line endings before canonicalizing', () => {
    expect(canonicalize(parseXml('<root>\r\n<a>1</a>\r\n</root>'))).toBe(
      canonicalize(parseXml('<root>\n<a>1</a>\n</root>')),
    );
  });
});

describe('buildElement', () => {
  it('drops null and undefined fields so optional bank fields stay absent', () => {
    const el = buildElement('root', { a: '1', b: null, c: undefined, d: 0 });
    expect(serializeDocument(el)).toBe('<?xml version="1.0" encoding="UTF-8"?><root><a>1</a><d>0</d></root>');
  });

  it('escapes values that would otherwise break the document', () => {
    expect(canonicalize(buildElement('root', { d: 'a & <b>' }))).toBe('<root><d>a &amp; &lt;b&gt;</d></root>');
  });
});

describe('toPlainObject', () => {
  it('flattens nested and repeated blocks for the rawJson column', () => {
    const root = parseXml('<root><result>1</result><trx><rrn>1</rrn></trx><trx><rrn>2</rrn></trx><cos>1</cos></root>');
    expect(toPlainObject(root)).toEqual({
      result: '1',
      cos: '1',
      trx: [{ rrn: '1' }, { rrn: '2' }],
    });
  });
});

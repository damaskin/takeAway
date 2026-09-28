import { AVAILABLE_LOCALES } from '@takeaway/i18n';

import { LEGAL_DOC_KEYS, parseLegalText, type LegalDocument } from './legal-document';
import { LEGAL_DOCUMENTS } from './legal-documents';

const LOCALES = AVAILABLE_LOCALES.map((l) => l.code);

function lines(doc: LegalDocument): string[] {
  return doc.sections.flatMap((s) => s.blocks.flatMap((b) => (typeof b === 'string' ? [b] : b.list)));
}

function anchors(doc: LegalDocument): string[] {
  return doc.sections.flatMap((s) => (s.id ? [s.id] : []));
}

describe('legal page content', () => {
  it('has the same sections in every language, so /privacy#location works whichever one is on', () => {
    for (const key of LEGAL_DOC_KEYS) {
      const [first, ...others] = LOCALES.map((locale) => anchors(LEGAL_DOCUMENTS[key][locale]));
      for (const other of others) expect(other).toEqual(first);
    }
  });

  it('never repeats an anchor within a page', () => {
    for (const key of LEGAL_DOC_KEYS) {
      for (const locale of LOCALES) {
        const ids = anchors(LEGAL_DOCUMENTS[key][locale]);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });

  it('links only to pages and sections that exist', () => {
    for (const key of LEGAL_DOC_KEYS) {
      for (const locale of LOCALES) {
        for (const line of lines(LEGAL_DOCUMENTS[key][locale])) {
          for (const segment of parseLegalText(line)) {
            if (segment.kind !== 'route') continue;
            const target = LEGAL_DOC_KEYS.find((k) => `/${k}` === segment.path);
            expect(target).toBeDefined();
            if (target && segment.fragment) {
              expect(anchors(LEGAL_DOCUMENTS[target][locale])).toContain(segment.fragment);
            }
          }
        }
      }
    }
  });

  it('gives every page the support contacts', () => {
    for (const key of LEGAL_DOC_KEYS) {
      for (const locale of LOCALES) {
        const text = lines(LEGAL_DOCUMENTS[key][locale]).join('\n');
        expect(text).toContain('(mailto:help@takeaway.md)');
        expect(text).toContain('(https://t.me/takaway_tgbot)');
      }
    }
  });

  it('publishes no phone number', () => {
    for (const key of LEGAL_DOC_KEYS) {
      for (const locale of LOCALES) {
        const text = lines(LEGAL_DOCUMENTS[key][locale]).join('\n');
        expect(text).not.toMatch(/tel:|\+\d[\d\s()-]{6,}/);
      }
    }
  });

  it('dates the policy and the terms', () => {
    for (const locale of LOCALES) {
      expect(LEGAL_DOCUMENTS.privacy[locale].effective).toMatch(/28/);
      expect(LEGAL_DOCUMENTS.terms[locale].effective).toMatch(/28/);
    }
  });
});

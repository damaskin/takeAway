import type { AppLocale } from '@takeaway/i18n';

import { PRIVACY_EN } from './content/privacy.en';
import { PRIVACY_RU } from './content/privacy.ru';
import { SUPPORT_EN } from './content/support.en';
import { SUPPORT_RU } from './content/support.ru';
import { TERMS_EN } from './content/terms.en';
import { TERMS_RU } from './content/terms.ru';
import type { LegalDocKey, LegalDocument } from './legal-document';

/** Every legal page in every UI language. Russian is the source text. */
export const LEGAL_DOCUMENTS: Readonly<Record<LegalDocKey, Readonly<Record<AppLocale, LegalDocument>>>> = {
  privacy: { ru: PRIVACY_RU, en: PRIVACY_EN },
  terms: { ru: TERMS_RU, en: TERMS_EN },
  support: { ru: SUPPORT_RU, en: SUPPORT_EN },
};

/**
 * Bank-side constants, kept free of framework imports so standalone tooling
 * (the connectivity probe, the sandbox gateway) can use them without pulling
 * in Nest.
 */

/** Bank-issued issuer codes a customer picks from when binding a card. */
export const CARD_INSTITUTES = [
  { code: '0001', name: 'ЗАО «Агропромбанк»' },
  { code: '0002', name: 'ОАО «Эксимбанк»' },
  { code: '0003', name: 'ЗАО «Сбербанк»' },
] as const;

export type CardInstituteCode = (typeof CARD_INSTITUTES)[number]['code'];

/**
 * Public gateway. Note the address inside the WSDL points at an internal bank
 * cluster host and must not be used.
 */
export const DEFAULT_ENDPOINT = 'https://ws.agroprombank.com/merchant/MerchantCAPService.asmx';

/** `targetNamespace` of MerchantCAPService.asmx — also the SOAPAction prefix. */
export const DEFAULT_NAMESPACE = 'http://services.agroprombank.com';

/**
 * Currency codes from the ПРБ directory the bank uses, shared by the tokenized
 * flow and Web-платёж. `000` is the Transnistrian rouble — the only currency
 * the «Клевер» scheme settles in today; the rest are listed so a misconfigured
 * brand fails loudly instead of silently charging in the wrong currency.
 */
export const BANK_CURRENCY_CODES: Readonly<Record<string, string>> = {
  RUP: '000',
  USD: '840',
  EUR: '978',
  MDL: '498',
};

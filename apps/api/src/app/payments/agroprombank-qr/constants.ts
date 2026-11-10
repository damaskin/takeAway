/**
 * «Мобильный платёж» constants, free of framework imports so the sandbox bank
 * and standalone tooling can share them.
 */

/** The bank's QR web service. */
export const DEFAULT_QR_SERVICE_URL = 'https://api.agroprombank.com/mobile/QRMobileService.asmx';

/**
 * Target namespace of the QR web service — trailing slash included, exactly
 * as the bank's documentation writes it: an ASMX service binds the arguments
 * by namespace, and SOAPAction is this plus the function name.
 */
export const DEFAULT_QR_NAMESPACE = 'http://services.agroprombank.com/';

/** What the QR code says unless `AGROPROMBANK_QR_CODE_FORMAT` overrides it. */
export const DEFAULT_QR_CODE_FORMAT = '{terminal}:{rub}:{extid}';

/** A QR terminal id: `QRT` and fifteen digits. */
export const QR_TERMINAL_PATTERN = /^QRT\d{15}$/;

/** Where our routes live, under the API's global prefix. */
export const QR_PAYMENT_ROUTE = 'payments/agroprombank-qr';

/** Currency the QR terminal takes: рубль ПМР, bank code `000`. Nothing else. */
export const QR_CURRENCY = 'RUP';
export const QR_CURRENCY_CODE = '000';

/** `DeviceId` and `PushId` in the credentials header: `-1` for a non-mobile client. */
export const QR_NO_DEVICE = '-1';

/**
 * `state` in `GetPaymentState*` and in the callback. Only «Оплачен» is
 * documented; every other value reads as "not paid yet" (question 3 to the bank).
 */
export const QR_STATE = {
  PAID: 2,
} as const;

/** QR web-service operations, with the bank's own spelling. */
export type QrServiceFunction =
  | 'CreatePayment'
  | 'CreatePaymentID'
  | 'ClosePayment'
  | 'ClosePaymentExtId'
  | 'GetPaymentState'
  | 'GetPaymentStateExtId'
  | 'ReversePayment'
  | 'GetPayments';

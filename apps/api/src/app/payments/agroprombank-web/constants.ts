/**
 * Web-платёж constants, free of framework imports so the sandbox bank and
 * standalone tooling can share them.
 */

/** The bank's hosted payment page («Инициация оплаты»). */
export const DEFAULT_WEB_PAYMENT_URL = 'https://epay.apb.online/PaymentStart';

/** Admin web service: GetState, CancelOperation, RefundOperation, ComplitionOperation. */
export const DEFAULT_WEB_SERVICE_URL = 'https://ws.agroprombank.com/merchant/APB.SV.WebPayment.AgentService.asmx';

/**
 * Target namespace of the admin web service — to be confirmed against its
 * WSDL, which is not reachable from outside the bank. Defaults to the
 * namespace of the bank's other merchant service.
 */
export const DEFAULT_WEB_NAMESPACE = 'http://services.agroprombank.com';

/** Where our routes live, under the API's global prefix. */
export const WEB_PAYMENT_ROUTE = 'payments/agroprombank-web';

/** The client a customer started paying from — decides where the bank sends them back. */
export const RETURN_TARGETS = ['web', 'tma', 'mobile'] as const;
export type ReturnTarget = (typeof RETURN_TARGETS)[number];

/** Which checkout the clients run: the bound-card flow, the bank's page, or neither. */
export type CardPaymentFlow = 'token' | 'web' | 'none';

/**
 * `CARD_PAYMENT_FLOW=token|web`, resolved against what is actually switched
 * on. `web` takes effect only once Web-платёж is enabled — until then the
 * clients keep the bound-card flow — so the switch can be set ahead of the
 * bank's credentials. The single rule shared by the feature flags the clients
 * read and the server's own "card payment required" check.
 */
export function resolveCardPaymentFlow(input: {
  wanted: string | undefined;
  tokenEnabled: boolean;
  webEnabled: boolean;
}): CardPaymentFlow {
  if (input.wanted?.trim().toLowerCase() === 'web' && input.webEnabled) return 'web';
  if (input.tokenEnabled) return 'token';
  return 'none';
}

/** `state` in GetState («Получение состояния операции»). */
export const WEB_STATE = {
  NOT_PAID: 0,
  PAID: 1,
  CANCELLED: 2,
  ERROR: 3,
  EXPIRED: 4,
} as const;

/** Admin web-service operations, spelled as in the bank's documentation. */
export type WebServiceFunction = 'GetState' | 'CancelOperation' | 'RefundOperation' | 'ComplitionOperation';

/** `Result/Code` of a successful admin web-service call. */
export const WEB_RESULT_OK = 1;

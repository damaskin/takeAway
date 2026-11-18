/**
 * The credentials one bank call goes out with, per Agroprombank flow.
 *
 * Every brand takes its guests' money on its own terminal
 * (`PaymentTerminal`); a brand without one — or without the section for a
 * flow — uses takeAway's default terminal from the API's env. Which one a
 * call uses is decided by `PaymentTerminalsService` and handed to the bank
 * clients explicitly: no client reads credentials on its own, so a call can
 * never fall through to the wrong merchant.
 *
 * Settings that belong to the deployment rather than to a merchant —
 * switches, endpoints, namespaces, time-outs, the invoice prefix, whether
 * responses are verified — stay in the env configs.
 */
export interface TerminalSource {
  /** `PaymentTerminal.id`; null — takeAway's default terminal from env. */
  id: string | null;
  /** The brand the terminal belongs to; null for the default terminal. */
  brandId: string | null;
}

/** Bound cards («Рекуррентные платежи», MerchantCAPService). */
export interface CardTerminal extends TerminalSource {
  merchantId: string | null;
  terminalId: string | null;
  privateKeyPem: string | null;
  /** The merchant's own certificate, sent as `<KeyInfo>`. */
  certificatePem: string | null;
  /** Bank certificate the responses are verified against (the env one unless the brand's is set). */
  bankCertificatePem: string | null;
  isTest: boolean;
  /** The terminal allows preauthorization — see `AgroprombankConfig.chargeMomentFor`. */
  holdUntilAccepted: boolean;
}

/** The hosted payment page «Web-платёж». */
export interface WebTerminal extends TerminalSource {
  merchantLogin: string | null;
  /** `MerchantId` in the admin web service; defaults to the login. */
  merchantId: string | null;
  merchantPass: string | null;
  bankCertificatePem: string | null;
  isTest: boolean;
  holdUntilAccepted: boolean;
}

/** «Мобильный платёж»: a QR terminal. */
export interface QrTerminal extends TerminalSource {
  /** `QRT` and fifteen digits. */
  terminalId: string | null;
  login: string | null;
  password: string | null;
  externalToken: string | null;
  /** The device id the bank issued for payment notifications; null — `-1`. */
  deviceId: string | null;
}

/** For logs: «terminal of brand X» or «the default terminal». */
export function describeTerminal(t: TerminalSource): string {
  return t.id ? `terminal ${t.id} of brand ${t.brandId}` : 'the default terminal';
}

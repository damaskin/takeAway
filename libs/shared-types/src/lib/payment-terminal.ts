/**
 * A brand's own Agroprombank («Клевер») terminal:
 * `/admin/brands/:brandId/payment-terminal` (SUPER_ADMIN) and its `status`
 * (the brand's own roles). docs/agroprombank-payments.md §13.
 *
 * Every brand takes its guests' card and QR money on its own terminal, so it
 * lands on the brand's account. Each flow — bound cards, the Web-платёж page,
 * the QR terminal — is a section of its own; a brand without a section for a
 * flow takes no online payment in it (never takeAway's default terminal in its
 * place — owner, 2026-11-27), and without any its orders are paid at the store.
 *
 * Secrets are write-only: the API never returns them, only whether one is
 * stored and its last four characters.
 */

/** The three Agroprombank flows. */
export type PaymentTerminalFlow = 'card' | 'web' | 'qr';

/**
 * Whether the brand takes a flow's payments on its own terminal (`BRAND`) or
 * not at all (`NONE`, since 2026-11-27 — before, `DEFAULT`: takeAway's terminal).
 */
export type PaymentTerminalSource = 'BRAND' | 'NONE';

/** A write-only secret: stored or not, and its tail to recognise it by. */
export interface PaymentTerminalSecret {
  set: boolean;
  last4: string | null;
}

/** A PEM certificate as read back: who it is issued to and until when. */
export interface PaymentTerminalCertificate {
  set: boolean;
  subject: string | null;
  /** ISO date-time. */
  validTo: string | null;
}

export interface PaymentTerminalCardSection {
  source: PaymentTerminalSource;
  merchantId: string | null;
  terminalId: string | null;
  privateKey: PaymentTerminalSecret;
  certificate: PaymentTerminalCertificate;
  /** The brand's own bank certificate; unset — the bank certificate from env is used. */
  bankCertificate: PaymentTerminalCertificate;
}

export interface PaymentTerminalWebSection {
  source: PaymentTerminalSource;
  merchantLogin: string | null;
  merchantId: string | null;
  merchantPass: PaymentTerminalSecret;
  bankCertificate: PaymentTerminalCertificate;
}

export interface PaymentTerminalQrSection {
  source: PaymentTerminalSource;
  terminalId: string | null;
  login: string | null;
  password: PaymentTerminalSecret;
  externalToken: PaymentTerminalSecret;
  /** The device id the bank issued for payment notifications; null — `-1` goes out. */
  deviceId: string | null;
}

/** What takeAway's default terminal (env) is, for the «по умолчанию» line. */
export interface DefaultPaymentTerminal {
  card: { configured: boolean; merchantId: string | null; terminalId: string | null };
  web: { configured: boolean; merchantLogin: string | null };
  qr: { configured: boolean; terminalId: string | null };
}

/** `GET /admin/brands/:brandId/payment-terminal` — SUPER_ADMIN. */
export interface PaymentTerminalView {
  brandId: string;
  /** The brand's terminal row in use; null — none, every flow uses the default terminal. */
  id: string | null;
  card: PaymentTerminalCardSection;
  web: PaymentTerminalWebSection;
  qr: PaymentTerminalQrSection;
  holdUntilAccepted: boolean;
  isTest: boolean;
  note: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
  defaultTerminal: DefaultPaymentTerminal;
}

/**
 * `PUT /admin/brands/:brandId/payment-terminal` — SUPER_ADMIN. Every field
 * is optional: left out — kept as stored; `null` or `''` — cleared; a value
 * — set. A section is all or nothing: its required fields must be there once
 * the change is applied. Changing what identifies a section (merchant or
 * terminal id, Web-платёж login, QR terminal) on a terminal that has taken
 * payments starts a new terminal record; the old one keeps serving refunds.
 */
export interface UpsertPaymentTerminalRequest {
  cardMerchantId?: string | null;
  cardTerminalId?: string | null;
  /** PEM, write-only. */
  cardPrivateKey?: string | null;
  cardCertificate?: string | null;
  cardBankCertificate?: string | null;
  webMerchantLogin?: string | null;
  webMerchantId?: string | null;
  /** Write-only. */
  webMerchantPass?: string | null;
  webBankCertificate?: string | null;
  qrTerminalId?: string | null;
  qrLogin?: string | null;
  /** Write-only. */
  qrPassword?: string | null;
  /** Write-only. */
  qrExternalToken?: string | null;
  /** The device id the bank issues for payment notifications; empty — `-1`. */
  qrDeviceId?: string | null;
  holdUntilAccepted?: boolean;
  isTest?: boolean;
  note?: string | null;
}

/** How one flow answered `POST …/payment-terminal/check`. */
export interface PaymentTerminalCheck {
  flow: PaymentTerminalFlow;
  /**
   * `OK` — a verified answer; `ANSWERED` — the bank answered a status lookup
   * of a made-up invoice with an error of its own (usually «not found», which
   * means the credentials were accepted — read `message`); `FAILED` — no
   * usable answer (network, signature, missing settings).
   */
  outcome: 'OK' | 'ANSWERED' | 'FAILED';
  message: string;
}

/** `POST /admin/brands/:brandId/payment-terminal/check` — read-only calls, one per section of the brand. */
export interface PaymentTerminalCheckResult {
  checks: PaymentTerminalCheck[];
}

/** `GET /admin/brands/:brandId/payment-terminal/status` — the brand's own roles: connected or not, nothing else. */
export interface PaymentTerminalStatus {
  /** At least one flow takes money on the brand's own terminal. */
  connected: boolean;
  flows: Record<PaymentTerminalFlow, PaymentTerminalSource>;
}

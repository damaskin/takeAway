import { createServer } from 'node:http';

import {
  DECLINE_AMOUNT,
  SANDBOX_PATH,
  UNKNOWN_CARD_DIGITS,
  createSandboxBank,
} from '../../apps/api/src/app/payments/agroprombank/testing/sandbox-bank';
import {
  QR_APP_PATH,
  QR_REFUSE_AMOUNT,
  QR_SERVICE_PATH,
  createSandboxQrBank,
  isSandboxQrPath,
} from '../../apps/api/src/app/payments/agroprombank-qr/testing/sandbox-qr-bank';
import {
  WEB_DECLINE_AMOUNT,
  WEB_PAYMENT_PATH,
  WEB_SERVICE_PATH,
  createSandboxWebBank,
} from '../../apps/api/src/app/payments/agroprombank-web/testing/sandbox-web-bank';
import { ensureDevKeys, readDevKey } from './dev-keys';
import { keepStateIn } from './state-file';

/**
 * Standalone sandbox gateways — `pnpm agro:mock`.
 *
 * Thin wrappers around the same `createSandboxBank` / `createSandboxWebBank` /
 * `createSandboxQrBank` the integration tests use, so the mocks you develop
 * against and the mocks CI runs cannot drift apart:
 *   - :8899 — MerchantCAPService (bound cards);
 *   - :8898 — Web-платёж (the payment page, ResultURL notifications and the
 *     admin web service) and «Мобильный платёж» (the QR web service, the fake
 *     bank app and the callback), side by side on one port, so the staging
 *     proxy that serves the one serves the other.
 *
 * Development only. Never point a deployment that takes real orders at this.
 */

const PORT = Number(process.env['AGRO_MOCK_PORT'] ?? 8899);
const WEB_PORT = Number(process.env['AGRO_WEB_MOCK_PORT'] ?? 8898);
/** Where the API listens, as the mock (not the browser) reaches it. */
const API_BASE = process.env['AGRO_WEB_MOCK_API_BASE'] ?? 'http://localhost:3000/api';
/** Where the customer's browser reaches the API after the page — the redirects go there. */
const PUBLIC_API_BASE = process.env['AGRO_WEB_MOCK_PUBLIC_API_BASE'] ?? API_BASE;
/** Where the QR sandbox calls back; the Web-платёж API base unless set. */
const QR_API_BASE = process.env['AGRO_QR_MOCK_API_BASE'] ?? API_BASE;
/** One SMS code for every binding (a shared test environment); random when unset. */
const FIXED_OTP = process.env['AGRO_MOCK_OTP']?.trim() || undefined;
/** Where the sandboxes keep their memory across restarts; in memory only when unset. */
const STATE_FILE = process.env['AGRO_MOCK_STATE_FILE']?.trim() || undefined;

// eslint-disable-next-line no-console
const log = (message: string): void => console.log(`[agro-mock] ${message}`);

const keys = ensureDevKeys();
const bank = createSandboxBank({
  merchantPublicKeyPem: readDevKey(keys.merchantPublicKeyPath),
  bankPrivateKeyPem: readDevKey(keys.bankPrivateKeyPath),
  fixedOtp: FIXED_OTP,
  log,
});

const webBank = createSandboxWebBank({
  merchantLogin: process.env['AGRO_WEB_MOCK_LOGIN'] ?? 'sandbox',
  merchantPass: process.env['AGRO_WEB_MOCK_PASS'] ?? 'sandbox-pass',
  bankPrivateKeyPem: readDevKey(keys.bankPrivateKeyPath),
  resultUrl: `${API_BASE}/payments/agroprombank-web/result`,
  resultMethod: process.env['AGRO_WEB_MOCK_RESULT_METHOD'] === 'GET' ? 'GET' : 'POST',
  successUrl: `${PUBLIC_API_BASE}/payments/agroprombank-web/success`,
  failUrl: `${PUBLIC_API_BASE}/payments/agroprombank-web/fail`,
  log: (message) => log(`[web] ${message}`),
});

const qrBank = createSandboxQrBank({
  login: process.env['AGRO_QR_MOCK_LOGIN'] ?? 'sandbox',
  password: process.env['AGRO_QR_MOCK_PASSWORD'] ?? 'sandbox-pass',
  callbackUrl: `${QR_API_BASE}/payments/agroprombank-qr/callback`,
  amountUnit: process.env['AGRO_QR_MOCK_AMOUNT_UNIT'] === 'rubles' ? 'rubles' : 'kopecks',
  log: (message) => log(`[qr] ${message}`),
});

if (STATE_FILE) keepStateIn(STATE_FILE, bank, webBank, qrBank, log);

void bank.listen(PORT).then((port) => {
  log(`песочница «Клевер» слушает http://localhost:${port}${SANDBOX_PATH}`);
  log(
    FIXED_OTP
      ? `одноразовый пароль: всегда ${FIXED_OTP}`
      : `одноразовый пароль: GET http://localhost:${port}/__sandbox/otp/:requestid`,
  );
  log(`состояние:          GET http://localhost:${port}/__sandbox/state`);
  log(`карта ${UNKNOWN_CARD_DIGITS} не привязывается, сумма ${DECLINE_AMOUNT} отклоняется — для проверки ошибок`);
});

// Web-платёж and the QR sandbox share a port: each request goes to the
// sandbox whose path it is, through that sandbox's own server.
const shared = createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://sandbox');
  (isSandboxQrPath(pathname) ? qrBank.server : webBank.server).emit('request', req, res);
});
shared.listen(WEB_PORT, () => {
  log(`Web-платёж: страница оплаты http://localhost:${WEB_PORT}${WEB_PAYMENT_PATH}`);
  log(`Web-платёж: веб-сервис       http://localhost:${WEB_PORT}${WEB_SERVICE_PATH}`);
  log(`Web-платёж: состояние         GET http://localhost:${WEB_PORT}/__sandbox/web/state`);
  log(`Web-платёж: оплатить без браузера POST http://localhost:${WEB_PORT}/__sandbox/web/pay/:nivid`);
  log(`Web-платёж: ResultURL → ${API_BASE}/payments/agroprombank-web/result; сумма ${WEB_DECLINE_AMOUNT} отклоняется`);
  log(`QR: веб-сервис               http://localhost:${WEB_PORT}${QR_SERVICE_PATH}`);
  log(`QR: «приложение банка»       http://localhost:${WEB_PORT}${QR_APP_PATH}?code=…`);
  log(
    `QR: оплатить без приложения  POST http://localhost:${WEB_PORT}/__sandbox/qr/pay/:extid (?silent=1 — без колбэка)`,
  );
  log(`QR: состояние                GET http://localhost:${WEB_PORT}/__sandbox/qr/state`);
  log(`QR: колбэк → ${QR_API_BASE}/payments/agroprombank-qr/callback; сумма ${QR_REFUSE_AMOUNT} не выставляется`);
});

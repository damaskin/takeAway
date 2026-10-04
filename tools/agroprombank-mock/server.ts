import {
  DECLINE_AMOUNT,
  SANDBOX_PATH,
  UNKNOWN_CARD_DIGITS,
  createSandboxBank,
} from '../../apps/api/src/app/payments/agroprombank/testing/sandbox-bank';
import {
  WEB_DECLINE_AMOUNT,
  WEB_PAYMENT_PATH,
  WEB_SERVICE_PATH,
  createSandboxWebBank,
} from '../../apps/api/src/app/payments/agroprombank-web/testing/sandbox-web-bank';
import { ensureDevKeys, readDevKey } from './dev-keys';

/**
 * Standalone sandbox gateways — `pnpm agro:mock`.
 *
 * Thin wrappers around the same `createSandboxBank` / `createSandboxWebBank`
 * the integration tests use, so the mocks you develop against and the mocks
 * CI runs cannot drift apart:
 *   - :8899 — MerchantCAPService (bound cards);
 *   - :8898 — Web-платёж: the payment page, ResultURL notifications and the
 *     admin web service.
 *
 * Development only. Never point a deployment that takes real orders at this.
 */

const PORT = Number(process.env['AGRO_MOCK_PORT'] ?? 8899);
const WEB_PORT = Number(process.env['AGRO_WEB_MOCK_PORT'] ?? 8898);
/** Where the API listens, as the mock (not the browser) reaches it. */
const API_BASE = process.env['AGRO_WEB_MOCK_API_BASE'] ?? 'http://localhost:3000/api';
/** Where the customer's browser reaches the API after the page — the redirects go there. */
const PUBLIC_API_BASE = process.env['AGRO_WEB_MOCK_PUBLIC_API_BASE'] ?? API_BASE;

// eslint-disable-next-line no-console
const log = (message: string): void => console.log(`[agro-mock] ${message}`);

const keys = ensureDevKeys();
const bank = createSandboxBank({
  merchantPublicKeyPem: readDevKey(keys.merchantPublicKeyPath),
  bankPrivateKeyPem: readDevKey(keys.bankPrivateKeyPath),
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

void bank.listen(PORT).then((port) => {
  log(`песочница «Клевер» слушает http://localhost:${port}${SANDBOX_PATH}`);
  log(`одноразовый пароль: GET http://localhost:${port}/__sandbox/otp/:requestid`);
  log(`состояние:          GET http://localhost:${port}/__sandbox/state`);
  log(`карта ${UNKNOWN_CARD_DIGITS} не привязывается, сумма ${DECLINE_AMOUNT} отклоняется — для проверки ошибок`);
});

void webBank.listen(WEB_PORT).then((port) => {
  log(`Web-платёж: страница оплаты http://localhost:${port}${WEB_PAYMENT_PATH}`);
  log(`Web-платёж: веб-сервис       http://localhost:${port}${WEB_SERVICE_PATH}`);
  log(`Web-платёж: состояние         GET http://localhost:${port}/__sandbox/web/state`);
  log(`Web-платёж: оплатить без браузера POST http://localhost:${port}/__sandbox/web/pay/:nivid`);
  log(`Web-платёж: ResultURL → ${API_BASE}/payments/agroprombank-web/result; сумма ${WEB_DECLINE_AMOUNT} отклоняется`);
});

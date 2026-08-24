import {
  DECLINE_AMOUNT,
  SANDBOX_PATH,
  UNKNOWN_CARD_DIGITS,
  createSandboxBank,
} from '../../apps/api/src/app/payments/agroprombank/testing/sandbox-bank';
import { ensureDevKeys, readDevKey } from './dev-keys';

/**
 * Standalone sandbox gateway — `pnpm agro:mock`.
 *
 * Thin wrapper around the same `createSandboxBank` the integration test uses,
 * so the mock you develop against and the mock CI runs cannot drift apart.
 *
 * Development only. Never point a deployment that takes real orders at this.
 */

const PORT = Number(process.env['AGRO_MOCK_PORT'] ?? 8899);

const keys = ensureDevKeys();
const bank = createSandboxBank({
  merchantPublicKeyPem: readDevKey(keys.merchantPublicKeyPath),
  bankPrivateKeyPem: readDevKey(keys.bankPrivateKeyPath),
  // eslint-disable-next-line no-console
  log: (message) => console.log(`[agro-mock] ${message}`),
});

void bank.listen(PORT).then((port) => {
  const log = (message: string): void => {
    // eslint-disable-next-line no-console
    console.log(`[agro-mock] ${message}`);
  };
  log(`песочница «Клевер» слушает http://localhost:${port}${SANDBOX_PATH}`);
  log(`одноразовый пароль: GET http://localhost:${port}/__sandbox/otp/:requestid`);
  log(`состояние:          GET http://localhost:${port}/__sandbox/state`);
  log(`карта ${UNKNOWN_CARD_DIGITS} не привязывается, сумма ${DECLINE_AMOUNT} отклоняется — для проверки ошибок`);
});

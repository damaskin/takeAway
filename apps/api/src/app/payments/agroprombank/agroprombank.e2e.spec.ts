import { generateKeyPairSync } from 'node:crypto';

import { AgroprombankClient, AgroprombankError, AgroprombankTransportError } from './agroprombank.client';
import { AgroprombankConfig } from './agroprombank.config';
import {
  DECLINE_AMOUNT,
  SANDBOX_PATH,
  type SandboxBank,
  UNKNOWN_CARD_DIGITS,
  createSandboxBank,
} from './testing/sandbox-bank';
import { num, text } from './xml';

/**
 * End-to-end exercise of everything that faces the bank: signing, canonical
 * XML, the SOAP envelope, response-signature verification, result-code
 * mapping. The real {@link AgroprombankClient} talks over real HTTP to a
 * sandbox that verifies our signature and signs its replies — so a change that
 * breaks canonicalization fails here rather than in production.
 *
 * What is deliberately *not* covered: whether the bank's own implementation
 * agrees with the documented profile. Only a live integration run can settle
 * that.
 */
describe('Agroprombank end-to-end (sandbox gateway)', () => {
  const merchant = keyPair();
  const bankKeys = keyPair();

  let bank: SandboxBank;
  let client: AgroprombankClient;
  let endpoint: string;

  beforeAll(async () => {
    bank = createSandboxBank({
      merchantPublicKeyPem: merchant.publicKey,
      bankPrivateKeyPem: bankKeys.privateKey,
    });
    const port = await bank.listen(0);
    endpoint = `http://127.0.0.1:${port}${SANDBOX_PATH}`;

    client = new AgroprombankClient({
      enabled: true,
      endpoint,
      namespace: 'http://services.agroprombank.com',
      merchantId: 'M00012345',
      terminalId: 'E1016682',
      privateKeyPem: merchant.privateKey,
      certificatePem: null,
      bankCertificatePem: bankKeys.publicKey,
      includeKeyInfo: false,
      verifyResponses: true,
      timeoutMs: 10_000,
      isTest: true,
      missingSettings: () => [],
    } as unknown as AgroprombankConfig);
  });

  afterAll(async () => {
    await bank.close();
  });

  /** Binds a card the way the service does, returning the bank token. */
  async function bindCard(lastDigits = '0578'): Promise<string> {
    const started = await client.invoke('NewTokenRequest', {
      LastDigit: lastDigits,
      Phone: '77712345',
      deactivateold: 0,
      description: 'Оплата заказов в takeAway',
      institute: '0001',
    });
    const requestId = text(started, 'requestid') as string;
    const otp = bank.otpFor(requestId) as string;

    const confirmed = await client.invoke('ProcessTokenRequest', { requestid: requestId, code: otp });
    return text(confirmed, 'token') as string;
  }

  it('binds a card through the two-step one-time-password flow', async () => {
    const started = await client.invoke('NewTokenRequest', {
      LastDigit: '0578',
      Phone: '77712345',
      deactivateold: 0,
      description: 'Оплата заказов в takeAway',
      institute: '0001',
    });
    const requestId = text(started, 'requestid');
    expect(requestId).toMatch(/^\d{6}$/);

    const otp = bank.otpFor(requestId as string);
    expect(otp).toMatch(/^\d{6}$/);

    const confirmed = await client.invoke('ProcessTokenRequest', { requestid: requestId, code: otp });
    expect(text(confirmed, 'token')).toHaveLength(64);
  });

  it('rejects a wrong one-time password with the bank error code', async () => {
    const started = await client.invoke('NewTokenRequest', {
      LastDigit: '0578',
      Phone: '77712345',
      deactivateold: 0,
      description: 'Оплата заказов в takeAway',
      institute: '0001',
    });

    await expect(
      client.invoke('ProcessTokenRequest', { requestid: text(started, 'requestid'), code: '000000' }),
    ).rejects.toMatchObject({ code: 5, description: 'Неверный одноразовый пароль' });
  });

  it('surfaces a refused binding as a business error, not a transport error', async () => {
    await expect(
      client.invoke('NewTokenRequest', {
        LastDigit: UNKNOWN_CARD_DIGITS,
        Phone: '77712345',
        deactivateold: 0,
        description: 'Оплата заказов в takeAway',
        institute: '0001',
      }),
    ).rejects.toBeInstanceOf(AgroprombankError);
  });

  it('reads the masked card details back', async () => {
    const token = await bindCard('4704');
    const checked = await client.invoke('CheckToken', { token });

    expect(text(checked, 'pan')).toBe('9104 **** **** 4704');
    expect(text(checked, 'embossing')).toBe('MA*** *******');
    expect(num(checked, 'cardstate')).toBe(1);
  });

  it('charges the card and returns the card transaction block', async () => {
    const token = await bindCard();
    const invoiceId = `${Date.now()}0001`;

    const paid = await client.invoke('ProcessCardAutoPayment', {
      invoiceid: invoiceId,
      token,
      amount: 3300,
      tipamount: 0,
      currencycode: '000',
      istest: '1',
      description: 'Оплата заказа №4242',
      terminalid: 'E1016682',
      preauth: 0,
    });

    expect(num(paid, 'result')).toBe(1);
    expect(text(paid, 'operationid')).toMatch(/^\d+$/);
    expect(num(paid, 'cos')).toBe(1);

    const trx = paid.children.find((n) => n.type === 'element' && n.name === 'trx');
    expect(trx).toBeDefined();
    if (trx?.type === 'element') {
      expect(text(trx, 'type')).toBe('debet');
      expect(text(trx, 'responsecode')).toBe('00');
      expect(text(trx, 'pan')).toBe('910401******0578');
      expect(text(trx, 'authcode')).toMatch(/^\d{6}$/);
    }
  });

  it('declines a charge the bank refuses', async () => {
    const token = await bindCard();
    await expect(
      client.invoke('ProcessCardAutoPayment', {
        invoiceid: `${Date.now()}0002`,
        token,
        amount: DECLINE_AMOUNT,
        tipamount: 0,
        currencycode: '000',
        istest: '1',
        description: 'Оплата заказа',
        terminalid: 'E1016682',
        preauth: 0,
      }),
    ).rejects.toMatchObject({ code: 116, description: 'Недостаточно средств на карте' });
  });

  it('refunds part of a settled payment', async () => {
    const token = await bindCard();
    const invoiceId = `${Date.now()}0003`;
    await client.invoke('ProcessCardAutoPayment', {
      invoiceid: invoiceId,
      token,
      amount: 3300,
      tipamount: 0,
      currencycode: '000',
      istest: '1',
      description: 'Оплата заказа',
      terminalid: 'E1016682',
      preauth: 0,
    });

    const refunded = await client.invoke('RefundOperation', { invoiceid: invoiceId, amount: 3300, refundamount: 1000 });
    expect(num(refunded, 'result')).toBe(1);
    expect(bank.operations.get(invoiceId)?.refunded).toBe(1000);

    // Over-refunding the remainder is refused by the bank, not by us.
    await expect(
      client.invoke('RefundOperation', { invoiceid: invoiceId, amount: 3300, refundamount: 2400 }),
    ).rejects.toBeInstanceOf(AgroprombankError);
  });

  it('holds and then captures a preauthorized payment', async () => {
    const token = await bindCard();
    const invoiceId = `${Date.now()}0004`;
    await client.invoke('ProcessCardAutoPayment', {
      invoiceid: invoiceId,
      token,
      amount: 3300,
      tipamount: 0,
      currencycode: '000',
      istest: '1',
      description: 'Поездка',
      terminalid: 'E1016682',
      preauth: 1,
    });
    expect(bank.operations.get(invoiceId)?.state).toBe(1);

    await client.invoke('CompletePreAuthorizaion', { invoiceid: invoiceId, amount: 3600, terminalid: 'E1016682' });
    expect(bank.operations.get(invoiceId)?.state).toBe(5);
    expect(bank.operations.get(invoiceId)?.amount).toBe(3600);
  });

  it('stops honouring a token after it is deactivated', async () => {
    const token = await bindCard();
    await client.invoke('DeactivateToken', { token });

    expect(num(await client.invoke('CheckToken', { token }), 'cardstate')).toBe(-1);
    await expect(
      client.invoke('ProcessCardAutoPayment', {
        invoiceid: `${Date.now()}0005`,
        token,
        amount: 100,
        tipamount: 0,
        currencycode: '000',
        istest: '1',
        description: 'Оплата заказа',
        terminalid: 'E1016682',
        preauth: 0,
      }),
    ).rejects.toMatchObject({ code: 12 });
  });

  it('reads an operation back from the bank register', async () => {
    const token = await bindCard();
    const invoiceId = `${Date.now()}0006`;
    await client.invoke('ProcessCardAutoPayment', {
      invoiceid: invoiceId,
      token,
      amount: 250,
      tipamount: 50,
      currencycode: '000',
      istest: '1',
      description: 'Оплата заказа',
      terminalid: 'E1016682',
      preauth: 0,
    });

    const fetched = await client.invoke('GetOperation', { terminalid: 'E1016682', invoiceid: invoiceId });
    const operation = fetched.children.find((n) => n.type === 'element' && n.name === 'operation');
    expect(operation).toBeDefined();
    if (operation?.type === 'element') {
      expect(text(operation, 'invoiceid')).toBe(invoiceId);
      expect(num(operation, 'amount')).toBe(250);
      expect(num(operation, 'tipamount')).toBe(50);
      expect(num(operation, 'state')).toBe(5);
    }
  });

  it('refuses a response signed by the wrong key', async () => {
    const impostor = keyPair();
    const wrongBank = createSandboxBank({
      merchantPublicKeyPem: merchant.publicKey,
      bankPrivateKeyPem: impostor.privateKey,
    });
    const port = await wrongBank.listen(0);
    const pinned = new AgroprombankClient({
      enabled: true,
      endpoint: `http://127.0.0.1:${port}${SANDBOX_PATH}`,
      namespace: 'http://services.agroprombank.com',
      merchantId: 'M00012345',
      terminalId: 'E1016682',
      privateKeyPem: merchant.privateKey,
      certificatePem: null,
      // Still pinned to the real bank key — the impostor must not pass.
      bankCertificatePem: bankKeys.publicKey,
      includeKeyInfo: false,
      verifyResponses: true,
      timeoutMs: 10_000,
      isTest: true,
      missingSettings: () => [],
    } as unknown as AgroprombankConfig);

    try {
      await expect(
        pinned.invoke('NewTokenRequest', {
          LastDigit: '0578',
          Phone: '77712345',
          deactivateold: 0,
          description: 'Оплата заказов в takeAway',
          institute: '0001',
        }),
      ).rejects.toBeInstanceOf(AgroprombankTransportError);
    } finally {
      await wrongBank.close();
    }
  });

  it('refuses a request signed by a key the bank does not know', async () => {
    const impostor = keyPair();
    const forged = new AgroprombankClient({
      enabled: true,
      endpoint,
      namespace: 'http://services.agroprombank.com',
      merchantId: 'M00012345',
      terminalId: 'E1016682',
      privateKeyPem: impostor.privateKey,
      certificatePem: null,
      bankCertificatePem: bankKeys.publicKey,
      includeKeyInfo: false,
      verifyResponses: true,
      timeoutMs: 10_000,
      isTest: true,
      missingSettings: () => [],
    } as unknown as AgroprombankConfig);

    await expect(forged.invoke('CheckToken', { token: 'whatever' })).rejects.toBeInstanceOf(AgroprombankTransportError);
  });
});

function keyPair(): { privateKey: string; publicKey: string } {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

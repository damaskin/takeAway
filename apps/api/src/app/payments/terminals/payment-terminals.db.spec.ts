import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { generateKeyPairSync, randomBytes } from 'node:crypto';

import { SecretCipher } from '../../common/crypto/secret-cipher';
import type { PrismaService } from '../../prisma/prisma.service';
import { AgroprombankQrClient } from '../agroprombank-qr/agroprombank-qr.client';
import { AgroprombankQrConfig } from '../agroprombank-qr/agroprombank-qr.config';
import { AgroprombankWebClient } from '../agroprombank-web/agroprombank-web.client';
import { AgroprombankWebConfig } from '../agroprombank-web/agroprombank-web.config';
import { AgroprombankClient } from '../agroprombank/agroprombank.client';
import { AgroprombankConfig } from '../agroprombank/agroprombank.config';
import { PaymentTerminalsAdminService } from './payment-terminals-admin.service';
import { PaymentTerminalsService } from './payment-terminals.service';

/**
 * Brand terminals on a real Postgres: secrets land encrypted and never come
 * back out, a brand without a terminal (or without a section) pays through
 * the default one, and a terminal that took payments is retired — not
 * rewritten — when it is replaced or removed, so its refunds still find it.
 * Opt-in: set PAYMENT_TERMINALS_IT_DATABASE_URL to a throwaway database with
 * the migrations applied (`prisma migrate deploy`). The suite adds rows with
 * ids starting `ptit-` and deletes them again.
 */
const url = process.env['PAYMENT_TERMINALS_IT_DATABASE_URL'];
const suite = url ? describe : describe.skip;

const BRAND = 'ptit-brand';
const OTHER = 'ptit-other';
const STORE = 'ptit-store';
const ADMIN = 'ptit-admin';

/** A public test certificate (CN=E2000001 test) — nothing secret in it. */
const CERT = `-----BEGIN CERTIFICATE-----
MIIDETCCAfmgAwIBAgIUE69EM6A/f+uWZbeqS7cox6Hc+AEwDQYJKoZIhvcNAQEL
BQAwGDEWMBQGA1UEAwwNRTIwMDAwMDEgdGVzdDAeFw0yNjExMTcxMzQ3MzVaFw0z
NjExMTQxMzQ3MzVaMBgxFjAUBgNVBAMMDUUyMDAwMDAxIHRlc3QwggEiMA0GCSqG
SIb3DQEBAQUAA4IBDwAwggEKAoIBAQDuArMFHwSUJDxfNWRaE6IXosgo2bAQOAia
5jOTjQH+iXj38f3oUwVlKwW3/cmmGRuXyNp/Bwg6lh104mu7bcG+DOA4IKihbpRu
lB9Ms5NvkhZ06jplcMIWs1qf8Y440Tkv8KPvDvgQ+c6vyHgde+Km9xuRMMFmoBpI
le4gcyIPRGs5wqt603Uq3G+nHSMz6/0JEcXKplRcG6gpeTjinjd/xhYxE7jSxOvp
VqTPw6bwf1ToLmLLib497yajHTVK2U5ciZm+lNrCn5ifss+9MPKqz7kXx+IU4e3D
pt9+Z8xkjRhavx/T8MqCxAwi+EW2Fl3V6S4XLsPGQ6S0jgAqZP09AgMBAAGjUzBR
MB0GA1UdDgQWBBRTL0EyHins2k+DhwOx/ByQezGx0DAfBgNVHSMEGDAWgBRTL0Ey
Hins2k+DhwOx/ByQezGx0DAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUA
A4IBAQCiF3IgjRct7+yE0qak0vc9QuPxxYTGCC1wcM36E+kgSIGGfRvVRynhMuip
BBg+/RU2YLnFmPXb+HcoQKHw++GmoQJLu+c+nJY/joGU5inHiayf9G3EMyQ7EK6A
hwduozHXiCPztYck57dtoH2/wXS/QqfBTYNjUXgO/sZO1fMpfN3CR42rfEA8mXDg
ND9CFDaY+Uo85hnI3LQkFQA53UwLnf/tk97LxY0POepEmhjUpROeuMTpHr8qbRyp
Ylqb51nMG3W6NgITeP1Vkg86Z07O0xXkI9aJYB01zO09/bdRRzT/Z4kZFBs/hzVO
hgDtfwWO7kJM5NgvRMk9L5OHxokT
-----END CERTIFICATE-----
`;

suite('brand payment terminals on Postgres', () => {
  let prisma: PrismaClient;
  let terminals: PaymentTerminalsService;
  let admin: PaymentTerminalsAdminService;
  let orderNo = 0;
  const privateKey = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  }).privateKey;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await cleanUp(prisma);
    for (const id of [BRAND, OTHER]) {
      await prisma.brand.create({ data: { id, slug: id, name: id, currency: 'RUP' } });
    }
    await prisma.store.create({
      data: {
        id: STORE,
        brandId: BRAND,
        slug: STORE,
        name: 'Центр',
        addressLine: 'Юности 12',
        city: 'Тирасполь',
        country: 'MD',
        latitude: 46.84,
        longitude: 29.66,
        currency: 'RUP',
        timezone: 'UTC',
      },
    });
    await prisma.user.create({ data: { id: ADMIN, name: 'Platform admin' } });

    const config = new ConfigService({
      POS_CREDENTIALS_KEY: randomBytes(32).toString('hex'),
      AGROPROMBANK_ENABLED: 'true',
      AGROPROMBANK_MERCHANT_ID: 'M-DEFAULT',
      AGROPROMBANK_TERMINAL_ID: 'E-DEFAULT',
      AGROPROMBANK_PRIVATE_KEY: 'default-key',
      AGROPROMBANK_INCLUDE_KEYINFO: 'false',
      AGROPROMBANK_VERIFY_RESPONSES: 'false',
      AGROPROMBANK_WEB_ENABLED: 'true',
      AGROPROMBANK_WEB_MERCHANT_LOGIN: 'web-default',
      AGROPROMBANK_WEB_MERCHANT_PASS: 'web-default-pass',
      AGROPROMBANK_WEB_VERIFY_RESPONSES: 'false',
      AGROPROMBANK_QR_TERMINAL_ID: 'QRT000000000000001',
      AGROPROMBANK_QR_LOGIN: 'qr-default',
      AGROPROMBANK_QR_PASSWORD: 'qr-default-pass',
    });
    const cipher = new SecretCipher(config);
    const card = new AgroprombankConfig(config);
    const web = new AgroprombankWebConfig(config);
    const qr = new AgroprombankQrConfig(config);
    terminals = new PaymentTerminalsService(prisma as unknown as PrismaService, cipher, card, web, qr);
    admin = new PaymentTerminalsAdminService(
      prisma as unknown as PrismaService,
      cipher,
      terminals,
      card,
      web,
      qr,
      new AgroprombankClient(card),
      new AgroprombankWebClient(web),
      new AgroprombankQrClient(qr),
    );
  });

  afterEach(async () => {
    await prisma.payment.deleteMany({ where: { order: { storeId: STORE } } });
    await prisma.order.deleteMany({ where: { storeId: STORE } });
    await prisma.paymentTerminal.deleteMany({ where: { brandId: { in: [BRAND, OTHER] } } });
  });

  afterAll(async () => {
    await cleanUp(prisma);
    await prisma.$disconnect();
  });

  const cardSection = () => ({
    cardMerchantId: 'M-BRAND',
    cardTerminalId: 'E-BRAND',
    cardPrivateKey: privateKey,
  });

  async function payOn(terminalId: string): Promise<void> {
    const order = await prisma.order.create({
      data: {
        id: `ptit-order-${(orderNo += 1)}`,
        orderCode: `PT${orderNo}`,
        qrToken: `ptit-${orderNo}`,
        userId: ADMIN,
        storeId: STORE,
        status: 'PAID',
        pickupMode: 'ASAP',
        pickupAt: new Date(),
        subtotalCents: 1000,
        totalCents: 1000,
        currency: 'RUP',
      },
    });
    await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'AGROPROMBANK',
        status: 'SUCCEEDED',
        amountCents: 1000,
        currency: 'RUP',
        paymentTerminalId: terminalId,
      },
    });
  }

  it('stores secrets encrypted and answers only «set» and their last four characters', async () => {
    const view = await admin.upsert(
      BRAND,
      { ...cardSection(), qrTerminalId: 'QRT123456789012345', qrLogin: 'brand', qrPassword: 'secret-qr-pass' },
      ADMIN,
    );

    const row = await prisma.paymentTerminal.findFirstOrThrow({ where: { brandId: BRAND } });
    expect(row.cardPrivateKeyCipher).not.toContain('PRIVATE KEY');
    expect(row.qrPasswordCipher).not.toContain('secret-qr-pass');
    const json = JSON.stringify(view);
    expect(json).not.toContain('secret-qr-pass');
    expect(json).not.toContain('PRIVATE KEY');
    expect(view.qr.password).toEqual({ set: true, last4: 'pass' });
    expect(view.card.privateKey.set).toBe(true);
    expect(view.card.source).toBe('BRAND');
    expect(view.web.source).toBe('DEFAULT');
    expect(view.updatedByName).toBe('Platform admin');

    // The resolver hands the bank calls the decrypted values.
    const card = await terminals.cardForBrand(BRAND);
    expect(card).toMatchObject({ id: row.id, merchantId: 'M-BRAND', terminalId: 'E-BRAND' });
    expect(card.privateKeyPem).toContain('PRIVATE KEY');
    expect((await terminals.qrForBrand(BRAND)).password).toBe('secret-qr-pass');
  });

  it('falls back to the default terminal per flow', async () => {
    await admin.upsert(BRAND, { qrTerminalId: 'QRT123456789012345', qrLogin: 'b', qrPassword: 'brand-pass' }, ADMIN);

    expect(await terminals.cardForBrand(BRAND)).toMatchObject({ id: null, merchantId: 'M-DEFAULT' });
    expect(await terminals.webForBrand(BRAND)).toMatchObject({ id: null, merchantLogin: 'web-default' });
    expect(await terminals.qrForBrand(BRAND)).toMatchObject({ terminalId: 'QRT123456789012345' });
    expect(await terminals.qrForBrand(OTHER)).toMatchObject({ id: null, terminalId: 'QRT000000000000001' });
    expect(await admin.status(OTHER)).toEqual({
      connected: false,
      flows: { card: 'DEFAULT', web: 'DEFAULT', qr: 'DEFAULT' },
    });
    expect((await admin.status(BRAND)).connected).toBe(true);
  });

  it('keeps a secret that is left out, and rotates it in place', async () => {
    await admin.upsert(BRAND, cardSection(), ADMIN);
    const first = await prisma.paymentTerminal.findFirstOrThrow({ where: { brandId: BRAND } });

    await admin.upsert(BRAND, { holdUntilAccepted: true, note: 'договор №7' }, ADMIN);
    const second = await prisma.paymentTerminal.findFirstOrThrow({ where: { brandId: BRAND } });

    expect(second.id).toBe(first.id);
    expect(second.cardPrivateKeyCipher).toBe(first.cardPrivateKeyCipher);
    expect(second).toMatchObject({ holdUntilAccepted: true, note: 'договор №7' });
  });

  it('starts a new record when a used terminal is re-identified; the old one still serves its payments', async () => {
    await admin.upsert(BRAND, cardSection(), ADMIN);
    const old = await prisma.paymentTerminal.findFirstOrThrow({ where: { brandId: BRAND } });
    await payOn(old.id);

    await admin.upsert(BRAND, { cardTerminalId: 'E-BRAND-2' }, ADMIN);

    const rows = await prisma.paymentTerminal.findMany({ where: { brandId: BRAND }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.retiredAt).not.toBeNull();
    expect(rows[1]).toMatchObject({ retiredAt: null, cardTerminalId: 'E-BRAND-2', cardMerchantId: 'M-BRAND' });
    // New payments go through the new one, refunds of the old one through the old one.
    expect((await terminals.cardForBrand(BRAND)).terminalId).toBe('E-BRAND-2');
    expect((await terminals.cardFor(old.id)).terminalId).toBe('E-BRAND');
  });

  it('removes an unused terminal outright and retires a used one', async () => {
    await admin.upsert(BRAND, cardSection(), ADMIN);
    await admin.remove(BRAND, ADMIN);
    expect(await prisma.paymentTerminal.count({ where: { brandId: BRAND } })).toBe(0);

    await admin.upsert(BRAND, cardSection(), ADMIN);
    const used = await prisma.paymentTerminal.findFirstOrThrow({ where: { brandId: BRAND } });
    await payOn(used.id);
    const view = await admin.remove(BRAND, ADMIN);

    expect(view.id).toBeNull();
    expect(view.card.source).toBe('DEFAULT');
    expect((await prisma.paymentTerminal.findUniqueOrThrow({ where: { id: used.id } })).retiredAt).not.toBeNull();
    expect((await terminals.cardForBrand(BRAND)).id).toBeNull();
    expect((await terminals.cardFor(used.id)).merchantId).toBe('M-BRAND');
  });

  it('refuses half a section, a broken key and a malformed QR terminal', async () => {
    await expect(admin.upsert(BRAND, { cardMerchantId: 'M-BRAND' }, ADMIN)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PAYMENT_TERMINAL_INCOMPLETE' }),
    });
    await expect(admin.upsert(BRAND, { ...cardSection(), cardPrivateKey: 'nope' }, ADMIN)).rejects.toThrow(
      /private key/,
    );
    await expect(admin.upsert(BRAND, { qrTerminalId: 'QRT1', qrLogin: 'a', qrPassword: 'b' }, ADMIN)).rejects.toThrow(
      /QRT/,
    );
    expect(await prisma.paymentTerminal.count({ where: { brandId: BRAND } })).toBe(0);
  });

  it('reads a certificate back as subject and expiry', async () => {
    const view = await admin.upsert(BRAND, { ...cardSection(), cardCertificate: CERT }, ADMIN);
    expect(view.card.certificate).toMatchObject({ set: true, subject: expect.stringContaining('E2000001') });
    expect(view.card.certificate.validTo).toMatch(/^2036-/);
  });
});

async function cleanUp(prisma: PrismaClient): Promise<void> {
  await prisma.payment.deleteMany({ where: { order: { storeId: STORE } } });
  await prisma.order.deleteMany({ where: { storeId: STORE } });
  await prisma.paymentTerminal.deleteMany({ where: { brandId: { in: [BRAND, OTHER] } } });
  await prisma.store.deleteMany({ where: { id: STORE } });
  await prisma.brand.deleteMany({ where: { id: { in: [BRAND, OTHER] } } });
  await prisma.user.deleteMany({ where: { id: ADMIN } });
}

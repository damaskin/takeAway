import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';

import { SecretCipher } from '../../common/crypto/secret-cipher';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AgroprombankQrClient } from '../agroprombank-qr/agroprombank-qr.client';
import { AgroprombankQrConfig } from '../agroprombank-qr/agroprombank-qr.config';
import type { AgroprombankWebClient } from '../agroprombank-web/agroprombank-web.client';
import { AgroprombankWebConfig } from '../agroprombank-web/agroprombank-web.config';
import type { AgroprombankClient } from '../agroprombank/agroprombank.client';
import { AgroprombankConfig } from '../agroprombank/agroprombank.config';
import { PaymentTerminalsAdminService, lastFour } from './payment-terminals-admin.service';
import { PaymentTerminalsService } from './payment-terminals.service';

/**
 * What the platform admin sees of a brand's terminal: never a secret, only
 * whether one is stored and its tail. The database side (encryption at rest,
 * retiring a used terminal) is `payment-terminals.db.spec.ts`.
 */
describe('PaymentTerminalsAdminService (masking)', () => {
  const config = new ConfigService({
    POS_CREDENTIALS_KEY: randomBytes(32).toString('hex'),
    AGROPROMBANK_MERCHANT_ID: 'M-DEFAULT',
    AGROPROMBANK_TERMINAL_ID: 'E-DEFAULT',
    AGROPROMBANK_QR_TERMINAL_ID: 'QRT000000000000001',
  });
  const cipher = new SecretCipher(config);
  const card = new AgroprombankConfig(config);
  const web = new AgroprombankWebConfig(config);
  const qr = new AgroprombankQrConfig(config);

  function build(row: Record<string, unknown> | null) {
    const prisma = {
      brand: { findUnique: jest.fn().mockResolvedValue({ id: 'brand-1' }) },
      paymentTerminal: { findFirst: jest.fn().mockResolvedValue(row) },
    };
    const terminals = new PaymentTerminalsService(prisma as unknown as PrismaService, cipher, card, web, qr);
    return new PaymentTerminalsAdminService(
      prisma as unknown as PrismaService,
      cipher,
      terminals,
      card,
      web,
      qr,
      {} as AgroprombankClient,
      {} as AgroprombankWebClient,
      {} as AgroprombankQrClient,
    );
  }

  const row = {
    id: 'term-1',
    brandId: 'brand-1',
    cardMerchantId: 'M-BRAND',
    cardTerminalId: 'E-BRAND',
    cardPrivateKeyCipher: cipher.encrypt(
      '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAAS1z9Q=\n-----END PRIVATE KEY-----\n',
    ),
    cardCertificatePem: null,
    cardBankCertificatePem: null,
    webMerchantLogin: null,
    webMerchantId: null,
    webMerchantPassCipher: null,
    webBankCertificatePem: null,
    qrTerminalId: 'QRT123456789012345',
    qrLogin: 'brand-login',
    qrPasswordCipher: cipher.encrypt('correct-horse-battery'),
    qrExternalTokenCipher: null,
    holdUntilAccepted: false,
    isTest: false,
    note: null,
    retiredAt: null,
    createdById: null,
    updatedById: null,
    createdAt: new Date('2026-11-17T10:00:00Z'),
    updatedAt: new Date('2026-11-17T10:00:00Z'),
    updatedBy: { name: 'Иван', email: null },
  };

  it('answers secrets as «set» and their last four characters, never the secret', async () => {
    const view = await build(row).view('brand-1');

    expect(view.qr.password).toEqual({ set: true, last4: 'tery' });
    expect(view.card.privateKey).toEqual({ set: true, last4: '1z9Q' });
    expect(view.qr.externalToken).toEqual({ set: false, last4: null });
    expect(view.web.merchantPass).toEqual({ set: false, last4: null });
    const json = JSON.stringify(view);
    expect(json).not.toContain('correct-horse-battery');
    expect(json).not.toContain('PRIVATE KEY');
    expect(json).not.toContain('Cipher');
  });

  it('shows which flows use the brand’s terminal and what the default one is', async () => {
    const view = await build(row).view('brand-1');

    expect([view.card.source, view.web.source, view.qr.source]).toEqual(['BRAND', 'DEFAULT', 'BRAND']);
    expect(view.defaultTerminal.card).toMatchObject({ merchantId: 'M-DEFAULT', terminalId: 'E-DEFAULT' });
    expect(view.defaultTerminal.qr.terminalId).toBe('QRT000000000000001');
  });

  it('reads a brand without a terminal as «default for every flow»', async () => {
    const view = await build(null).view('brand-1');

    expect(view.id).toBeNull();
    expect([view.card.source, view.web.source, view.qr.source]).toEqual(['DEFAULT', 'DEFAULT', 'DEFAULT']);
  });

  it('does not give away a short secret by its tail', () => {
    expect(lastFour('12345')).toBeNull();
    expect(lastFour('12345678')).toBe('5678');
  });
});

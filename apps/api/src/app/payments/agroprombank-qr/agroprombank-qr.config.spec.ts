import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { AgroprombankQrConfig } from './agroprombank-qr.config';

function configWith(env: Record<string, string>): AgroprombankQrConfig {
  return new AgroprombankQrConfig({ get: (key: string) => env[key] } as unknown as ConfigService);
}

const READY = {
  AGROPROMBANK_QR_ENABLED: 'true',
  AGROPROMBANK_QR_TERMINAL_ID: 'QRT169007299815722',
  AGROPROMBANK_QR_LOGIN: 'takeaway',
  AGROPROMBANK_QR_PASSWORD: 'secret',
};

describe('AgroprombankQrConfig', () => {
  // On by default since 2026-11-27: the brand's own QR terminal offers it to
  // a store, the switch only stops it everywhere. takeAway's default terminal
  // stays unconfigured.
  it('is switched on but has no default terminal by default, with the documented defaults', () => {
    const config = configWith({});
    expect(config.enabled).toBe(true);
    expect(config.isConfigured).toBe(false);
    expect(config.offeredCurrencies).toEqual(['RUP']);
    expect(config.serviceUrl).toBe('https://api.agroprombank.com/mobile/QRMobileService.asmx');
    expect(config.namespace).toBe('http://services.agroprombank.com/');
    expect(config.codeFormat).toBe('{terminal}:{rub}:{extid}');
    expect(config.appLink).toBeNull();
    expect(config.lifetimeMinutes).toBe(10);
    expect(config.timeoutMs).toBe(15_000);
  });

  it('is configured with a terminal and a login and password, and then offers RUP', () => {
    const config = configWith(READY);
    expect(config.missingSettings()).toEqual([]);
    expect(config.isConfigured).toBe(true);
    expect(config.offeredCurrencies).toEqual(['RUP']);
  });

  it('offers nothing once switched off, whatever is configured', () => {
    const config = configWith({ ...READY, AGROPROMBANK_QR_ENABLED: 'false' });
    expect(config.enabled).toBe(false);
    expect(config.offeredCurrencies).toEqual([]);
  });

  it('takes an external token in place of login and password', () => {
    const { AGROPROMBANK_QR_LOGIN: _login, AGROPROMBANK_QR_PASSWORD: _password, ...rest } = READY;
    expect(configWith(rest).missingSettings()).toEqual([expect.stringContaining('AGROPROMBANK_QR_LOGIN')]);
    expect(configWith({ ...rest, AGROPROMBANK_QR_EXTERNAL_TOKEN: 'tok' }).isConfigured).toBe(true);
  });

  it('wants the terminal as QRT and fifteen digits', () => {
    expect(configWith({ ...READY, AGROPROMBANK_QR_TERMINAL_ID: 'QRT123' }).missingSettings()).toEqual([
      expect.stringContaining('QRT and 15 digits'),
    ]);
    expect(configWith({ ...READY, AGROPROMBANK_QR_TERMINAL_ID: '' }).missingSettings()).toEqual([
      'AGROPROMBANK_QR_TERMINAL_ID',
    ]);
  });

  it('shares the digits-only invoice prefix', () => {
    expect(configWith({ ...READY, AGROPROMBANK_INVOICE_PREFIX: 'TA' }).missingSettings()).toEqual([
      expect.stringContaining('AGROPROMBANK_INVOICE_PREFIX'),
    ]);
    expect(configWith({ ...READY, AGROPROMBANK_INVOICE_PREFIX: ' 1 ' }).invoicePrefix).toBe('1');
  });

  // Money already taken must be looked after when QR is switched off for new orders.
  it('can still call the bank when switched off, as long as it is set up', () => {
    const config = configWith({ ...READY, AGROPROMBANK_QR_ENABLED: 'false' });
    expect(config.isConfigured).toBe(false);
    expect(config.canCallBank).toBe(true);
    expect(config.offeredCurrencies).toEqual([]);
  });

  describe('secrets from files', () => {
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'qr-config-'));
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('reads the password and the token from _FILE, trimmed', () => {
      const password = join(dir, 'password');
      const token = join(dir, 'token');
      writeFileSync(password, 'from-file\n');
      writeFileSync(token, ' tok-file \n');
      const config = configWith({
        AGROPROMBANK_QR_PASSWORD_FILE: password,
        AGROPROMBANK_QR_EXTERNAL_TOKEN_FILE: token,
      });
      expect(config.password).toBe('from-file');
      expect(config.externalToken).toBe('tok-file');
    });

    it('prefers the inline value, and reports a file it cannot read as missing', () => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      expect(configWith({ AGROPROMBANK_QR_PASSWORD: 'inline', AGROPROMBANK_QR_PASSWORD_FILE: '/nope' }).password).toBe(
        'inline',
      );
      expect(configWith({ AGROPROMBANK_QR_PASSWORD_FILE: join(dir, 'missing') }).password).toBeNull();
      expect(error).toHaveBeenCalled();
      error.mockRestore();
    });
  });
});

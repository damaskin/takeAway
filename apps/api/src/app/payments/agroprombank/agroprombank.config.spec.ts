import { ConfigService } from '@nestjs/config';

import { AgroprombankConfig } from './agroprombank.config';

function configWith(env: Record<string, string>): AgroprombankConfig {
  const values: Record<string, string> = {
    AGROPROMBANK_ENABLED: 'true',
    AGROPROMBANK_MERCHANT_ID: 'M00000001',
    AGROPROMBANK_TERMINAL_ID: 'E0000001',
    AGROPROMBANK_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nstub\\n-----END PRIVATE KEY-----',
    AGROPROMBANK_INCLUDE_KEYINFO: 'false',
    AGROPROMBANK_VERIFY_RESPONSES: 'false',
    ...env,
  };
  return new AgroprombankConfig({ get: (key: string) => values[key] } as unknown as ConfigService);
}

describe('AgroprombankConfig', () => {
  describe('invoice prefix', () => {
    // The bank reads invoiceid as a number: "TA…" failed every charge with
    // .NET's "Input string was not in a correct format."
    it('refuses letters, before any call reaches the bank', () => {
      const missing = configWith({ AGROPROMBANK_INVOICE_PREFIX: 'TA' }).missingSettings();
      expect(missing).toEqual([expect.stringContaining('AGROPROMBANK_INVOICE_PREFIX')]);
    });

    it('takes digits, or no prefix at all', () => {
      expect(configWith({ AGROPROMBANK_INVOICE_PREFIX: '1' }).missingSettings()).toEqual([]);
      expect(configWith({ AGROPROMBANK_INVOICE_PREFIX: ' 42 ' }).invoicePrefix).toBe('42');
      expect(configWith({}).missingSettings()).toEqual([]);
    });
  });
});

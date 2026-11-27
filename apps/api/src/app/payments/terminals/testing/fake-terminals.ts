import type { PaymentTerminalsService } from '../payment-terminals.service';
import type { CardTerminal, QrTerminal, WebTerminal } from '../terminal-types';

/** A brand's own terminal, per flow; a flow left out uses the env config's terminal as the brand's (tests only). */
export interface FakeBrandTerminal {
  card?: CardTerminal;
  web?: WebTerminal;
  qr?: QrTerminal;
}

interface Defaults {
  card?: { defaultTerminal(): CardTerminal };
  web?: { defaultTerminal(): WebTerminal };
  qr?: { defaultTerminal(): QrTerminal };
}

/**
 * `PaymentTerminalsService` without a database, for tests: the defaults come
 * from the env configs under test (read on every call, like the real one),
 * and brands with their own terminal are listed by brand id. Retired
 * terminals that still serve old payments go in `retired`. A brand listed in
 * `without` has no terminal at all — `*ForBrand` answer null, as the real one
 * does for a brand that takes no online payment (2026-11-27). Any other brand
 * is served the env config's terminal as if it were its own, so the flow
 * specs need not give every test brand a terminal. Tests only.
 */
export function fakeTerminals(
  defaults: Defaults,
  brands: Record<string, FakeBrandTerminal> = {},
  retired: FakeBrandTerminal[] = [],
  without: ReadonlyArray<string> = [],
): PaymentTerminalsService {
  // Read on every call: a test may give a brand its terminal after the fake is built.
  const byId = <K extends keyof FakeBrandTerminal>(flow: K, id: string): NonNullable<FakeBrandTerminal[K]> => {
    const found = [...Object.values(brands), ...retired].map((b) => b[flow]).find((t) => t?.id === id);
    if (!found) throw new Error(`Payment terminal ${id} has no ${flow} section`);
    return found as NonNullable<FakeBrandTerminal[K]>;
  };
  const def = <K extends keyof Defaults>(flow: K) => {
    const config = defaults[flow];
    if (!config) throw new Error(`No default ${flow} terminal in this test`);
    return config.defaultTerminal() as ReturnType<NonNullable<Defaults[K]>['defaultTerminal']>;
  };
  const fake = {
    cardForBrand: async (brandId: string) =>
      without.includes(brandId) ? null : (brands[brandId]?.card ?? def('card')),
    webForBrand: async (brandId: string) => (without.includes(brandId) ? null : (brands[brandId]?.web ?? def('web'))),
    qrForBrand: async (brandId: string) => (without.includes(brandId) ? null : (brands[brandId]?.qr ?? def('qr'))),
    cardFor: async (id: string | null) => (id ? byId('card', id) : def('card')),
    webFor: async (id: string | null) => (id ? byId('web', id) : def('web')),
    qrFor: async (id: string | null) => (id ? byId('qr', id) : def('qr')),
    cardMerchantIds: async (ids: ReadonlyArray<string | null>) => {
      const out = new Map<string | null, string | null>();
      for (const id of ids) out.set(id, id ? byId('card', id).merchantId : def('card').merchantId);
      return out;
    },
  };
  return fake as unknown as PaymentTerminalsService;
}

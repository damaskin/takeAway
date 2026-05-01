import type { PosIntegration, PosProvider } from '@prisma/client';

/**
 * Plain shape stored inside {@link PosIntegration.credentialsCiphertext}
 * — encrypted at rest with {@link SecretCipher}. The interface is a
 * tagged union so each provider can carry the fields it actually needs;
 * SecretCipher itself is shape-agnostic (`encryptJson` / `decryptJson`).
 */
export type PosCredentials = IikoCredentials | PosterCredentials;

export interface IikoCredentials {
  readonly kind: 'IIKO';
  /** iiko Cloud API login (sometimes called `apiLogin`). */
  readonly apiLogin: string;
}

export interface PosterCredentials {
  readonly kind: 'POSTER';
  /** Long-lived application token issued in the Poster admin panel. */
  readonly token: string;
  /** Subdomain used for both API host and webhook callbacks: `${accountName}.joinposter.com`. */
  readonly accountName: string;
}

/**
 * Non-secret per-integration config. Lives in {@link PosIntegration.settings}
 * as a JSON blob — schema is enforced provider-side, not by Postgres.
 */
export interface IikoSettings {
  /** Selected iiko organization. iiko Cloud lets one login span multiple. */
  organizationId?: string;
  /** Optional override for the iiko Cloud API host. Defaults to api-ru.iiko.services. */
  apiHost?: string;
}

export interface PosterSettings {
  /** Override for the Poster API host. Defaults to `${accountName}.joinposter.com`. */
  apiHost?: string;
}

export type PosSettings = IikoSettings | PosterSettings;

/**
 * Lightweight shape used by {@link IPosProvider.listStores} and the menu /
 * stop-list importers. The PosService is responsible for translating these
 * drafts into {@link Store}, {@link Category}, {@link Product},
 * {@link Modifier} rows via upsert on `(externalProvider, externalId)`.
 *
 * Drafts are intentionally narrower than the DB model — a provider only
 * supplies what it knows; defaults are filled in by the service layer.
 */
export interface ImportedStoreDraft {
  externalId: string;
  name: string;
  addressLine?: string;
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
}

export interface ImportedCategoryDraft {
  externalId: string;
  name: string;
  sortOrder?: number;
}

export interface ImportedProductDraft {
  externalId: string;
  /** Externally known category id; service joins it against ImportedCategoryDraft. */
  categoryExternalId: string;
  name: string;
  description?: string;
  basePriceCents: number;
  prepTimeSeconds?: number;
  imageUrls?: string[];
}

export interface ImportedModifierDraft {
  externalId: string;
  productExternalId: string;
  name: string;
  priceDeltaCents: number;
  minCount?: number;
  maxCount?: number;
}

export interface ImportedMenu {
  categories: ImportedCategoryDraft[];
  products: ImportedProductDraft[];
  modifiers: ImportedModifierDraft[];
}

export interface ImportedStopListEntry {
  /** Store from which the product is unavailable. Matched by Store.externalId. */
  storeExternalId: string;
  /** Product that's stopped. Matched by Product.externalId. */
  productExternalId: string;
}

/**
 * Snapshot of an outgoing order, prepared by the PosService before
 * {@link IPosProvider.pushOrder} is called. Keeps the provider layer free
 * of Prisma include shapes.
 */
export interface OrderForPush {
  id: string;
  orderCode: string;
  storeExternalId: string;
  customerName: string | null;
  customerPhone: string | null;
  notes: string | null;
  items: OrderForPushItem[];
  totalCents: number;
  currency: string;
}

export interface OrderForPushItem {
  productExternalId: string;
  quantity: number;
  unitPriceCents: number;
  modifiers: { externalId: string; count: number }[];
  notes?: string;
}

/**
 * Callback bag handed to long-running importers so they can publish progress
 * back to {@link PosSyncJob} (and over WS to the admin UI). Both functions
 * are no-ops in unit tests by default.
 */
export interface SyncProgressCtx {
  setTotal(total: number): Promise<void>;
  advance(delta: number): Promise<void>;
}

/**
 * Common surface every POS adapter implements. New providers (r-keeper,
 * Frontpad, 1С, …) drop in by adding an enum value, an implementation,
 * and a token registration in the PosModule providers map.
 *
 * Methods that aren't supported on a particular back-office MUST throw a
 * `MethodNotSupportedException` — the service layer surfaces that as a
 * 400 to the admin UI rather than a 500.
 */
export interface IPosProvider {
  readonly kind: PosProvider;

  /** Pings the provider's auth endpoint with the given credentials. Throws on failure. */
  testConnection(integration: PosIntegrationCtx): Promise<void>;

  /** Lists stores/terminals/spots accessible with the given credentials. */
  listStores(integration: PosIntegrationCtx): Promise<ImportedStoreDraft[]>;

  /** Streams the full menu (categories + products + modifiers) into ImportedMenu. */
  importMenu(integration: PosIntegrationCtx, ctx: SyncProgressCtx): Promise<ImportedMenu>;

  /** Pulls the current stop-list. Empty array means everything is in stock. */
  importStopList(integration: PosIntegrationCtx, ctx: SyncProgressCtx): Promise<ImportedStopListEntry[]>;

  /** Pushes a paid order downstream. Returns the provider-side identifier. */
  pushOrder(integration: PosIntegrationCtx, order: OrderForPush): Promise<{ posExternalId: string }>;

  /** Optional — only providers that support push (Poster) need to register hooks. */
  subscribeWebhooks?(integration: PosIntegrationCtx, callbackUrl: string): Promise<void>;
}

/**
 * Slim shape passed to providers — the {@link PosIntegration} row plus its
 * decrypted credentials, packaged together so the provider doesn't need to
 * know about SecretCipher.
 */
export interface PosIntegrationCtx {
  readonly row: PosIntegration;
  readonly credentials: PosCredentials;
  readonly settings: PosSettings;
}

/** Stable injection token — used in providers map and Module DI graph. */
export const POS_PROVIDERS = Symbol('POS_PROVIDERS');

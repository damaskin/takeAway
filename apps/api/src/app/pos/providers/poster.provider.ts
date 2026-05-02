import {
  BadGatewayException,
  Injectable,
  Logger,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import axios, { AxiosError, AxiosInstance } from 'axios';

import type {
  IPosProvider,
  ImportedCategoryDraft,
  ImportedMenu,
  ImportedProductDraft,
  ImportedStopListEntry,
  ImportedStoreDraft,
  OrderForPush,
  PosIntegrationCtx,
  PosterCredentials,
  PosterSettings,
  SyncProgressCtx,
} from './pos-provider.interface';

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Resolve the Poster API host for an integration. Real Poster accounts
 * answer on their own subdomain — `https://{accountName}.joinposter.com` —
 * not on the bare apex domain. The apex returns "Method Not Allowed" for
 * every API method, which used to surface as a 502 on connect.
 *
 * Honor an explicit `settings.apiHost` override so private deployments /
 * tests can pin a different host.
 */
function posterApiHost(accountName: string, override?: string): string {
  if (override) return override;
  return `https://${accountName}.joinposter.com`;
}

interface PosterEnvelope<T> {
  response?: T;
  error?: { code: number; message: string };
}

interface PosterIncomingProduct {
  product_id: number;
  count: number;
  modifications?: { m: number; a: number }[];
}

interface PosterIncomingOrderBody {
  spot_id: number;
  phone: string;
  client_name: string;
  products: PosterIncomingProduct[];
  comment?: string;
}

interface PosterIncomingOrderResponse {
  incoming_order_id?: string | number;
}

interface PosterCategoryRow {
  category_id: number | string;
  category_name: string;
  category_hidden?: number | string;
  parent_category?: number | string;
  sort_order?: number | string;
}

interface PosterProductRow {
  product_id: number | string;
  product_name: string;
  menu_category_id: number | string;
  /**
   * Either a flat string (`"150.00"`), or a per-spot map (`{ "1": "150.00" }`).
   * Field is missing on category-only rows; we skip those.
   */
  price?: string | number | Record<string, string | number>;
  product_production_description?: string;
  photo?: string;
  photo_origin?: string;
  hidden?: number | string;
  /** Per-spot stop-list flag, populated by certain Poster plans only. */
  out_of_stock?: number | string;
  spots?: { spot_id: number | string; price?: string | number; visible?: number | string }[];
}

interface PosterSpotRow {
  spot_id: number | string;
  name: string;
  address?: string;
  status?: number | string;
}

/**
 * Adapter for joinposter.com — Poster's public API.
 *
 * Auth model: a long-lived application token, supplied as `?token=` on
 * every request. There is no exchange step or short-lived bearer, so we
 * don't cache anything provider-side; the encrypted token is read from
 * {@link PosIntegration.credentialsCiphertext} on demand.
 *
 * Mapping decisions (M2):
 *   - Cents = round(parseFloat(price) * 100). Poster prices are decimal
 *     strings in the brand currency.
 *   - Per-spot prices: we take the maximum across spots as the listed
 *     basePrice (the brand admin can override per-store later).
 *   - Hidden / out_of_stock at the *product* level → stop-list entry on
 *     every Store of the brand. Per-spot stop-lists land on the
 *     specific store (matched via Store.externalId == spot_id).
 */
@Injectable()
export class PosterProvider implements IPosProvider {
  readonly kind = 'POSTER' as const;
  /**
   * Poster pushes stop-list / menu changes via webhook (see
   * `POST /pos/webhooks/poster/:brandId`), so periodic polling is wasted
   * traffic. The webhook endpoint enqueues the matching MENU / STOP_LIST
   * job in response to each event.
   */
  readonly supportsStopListPolling = false;
  private readonly logger = new Logger(PosterProvider.name);

  async testConnection(integration: PosIntegrationCtx): Promise<void> {
    // settings.getAllSettings is a cheap GET that every Poster account
    // exposes regardless of role, and crucially works on dev (Moldovan)
    // accounts where access.ping returns "Method Not Allowed". Calling
    // it with an invalid token triggers a Poster error code that
    // {@link call} maps to 401, which is what we want here.
    await this.call<unknown>(integration, '/api/settings.getAllSettings');
  }

  async listStores(integration: PosIntegrationCtx): Promise<ImportedStoreDraft[]> {
    const rows = await this.call<PosterSpotRow[]>(integration, '/api/spots.getSpots');
    return rows
      .filter((s) => Number(s.status ?? 1) !== 0)
      .map((s) => ({
        externalId: String(s.spot_id),
        name: s.name?.trim() || `Spot ${s.spot_id}`,
        addressLine: s.address?.trim() || undefined,
      }));
  }

  async importMenu(integration: PosIntegrationCtx, ctx: SyncProgressCtx): Promise<ImportedMenu> {
    const [rawCategories, rawProducts] = await Promise.all([
      this.call<PosterCategoryRow[]>(integration, '/api/menu.getCategories'),
      this.call<PosterProductRow[]>(integration, '/api/menu.getProducts'),
    ]);

    const categories: ImportedCategoryDraft[] = rawCategories
      .filter((c) => Number(c.category_hidden ?? 0) === 0)
      .map((c) => ({
        externalId: String(c.category_id),
        name: c.category_name?.trim() || `Category ${c.category_id}`,
        sortOrder: numberOrUndefined(c.sort_order),
      }));

    await ctx.setTotal(rawProducts.length);
    const products: ImportedProductDraft[] = [];
    let processed = 0;

    for (const p of rawProducts) {
      processed += 1;
      if (processed % 25 === 0) await ctx.advance(25);

      if (Number(p.hidden ?? 0) === 1) continue;
      const cents = posterPriceCents(p);
      if (cents === null) continue;
      products.push({
        externalId: String(p.product_id),
        categoryExternalId: String(p.menu_category_id),
        name: p.product_name?.trim() || `Product ${p.product_id}`,
        description: p.product_production_description?.trim() || undefined,
        basePriceCents: cents,
        imageUrls: posterImageUrls(p),
      });
    }
    await ctx.advance(processed % 25);

    return { categories, products, modifiers: [] };
  }

  async importStopList(integration: PosIntegrationCtx, _ctx: SyncProgressCtx): Promise<ImportedStopListEntry[]> {
    const products = await this.call<PosterProductRow[]>(integration, '/api/menu.getProducts');
    const entries: ImportedStopListEntry[] = [];
    for (const p of products) {
      const productExternalId = String(p.product_id);
      // Product-level "stopped everywhere" — emit one entry per spot if we
      // know about them, otherwise a single brand-wide marker (storeExternalId
      // = '*' is interpreted by the upserter as "every store of the brand").
      if (Number(p.hidden ?? 0) === 1 || Number(p.out_of_stock ?? 0) === 1) {
        entries.push({ storeExternalId: '*', productExternalId });
        continue;
      }
      // Per-spot visibility — only available on certain Poster plans.
      for (const spot of p.spots ?? []) {
        if (Number(spot.visible ?? 1) === 0) {
          entries.push({ storeExternalId: String(spot.spot_id), productExternalId });
        }
      }
    }
    return entries;
  }

  async pushOrder(integration: PosIntegrationCtx, order: OrderForPush): Promise<{ posExternalId: string }> {
    const spotId = Number(order.storeExternalId);
    if (!Number.isFinite(spotId) || spotId <= 0) {
      throw new BadGatewayException(
        `Cannot push order ${order.orderCode}: store has no Poster spot mapping (externalId=${order.storeExternalId})`,
      );
    }

    const products: PosterIncomingProduct[] = [];
    for (const item of order.items) {
      const productId = Number(item.productExternalId);
      if (!Number.isFinite(productId) || productId <= 0) {
        // Mixed-catalog brand — locally-managed items can't be sent to Poster.
        // Skip them with a warning so the order still partially syncs.
        this.logger.warn(`Skipping order item with non-Poster product ${item.productExternalId}`);
        continue;
      }
      const modifications = item.modifiers
        .map((m) => ({ m: Number(m.externalId), a: m.count }))
        .filter((m) => Number.isFinite(m.m) && m.m > 0 && m.a > 0);
      products.push({
        product_id: productId,
        count: item.quantity,
        modifications: modifications.length > 0 ? modifications : undefined,
      });
    }
    if (products.length === 0) {
      throw new BadGatewayException(`Cannot push order ${order.orderCode}: no Poster-mapped items`);
    }

    const credentials = integration.credentials as PosterCredentials;
    const settings = integration.settings as PosterSettings;
    const host = posterApiHost(credentials.accountName, settings.apiHost);

    const body: PosterIncomingOrderBody = {
      spot_id: spotId,
      phone: order.customerPhone ?? '',
      client_name: order.customerName ?? '',
      products,
      comment: this.buildPosterComment(order),
    };

    try {
      const response = await this.http(host).post<PosterEnvelope<PosterIncomingOrderResponse>>(
        '/api/incomingOrders.createIncomingOrder',
        body,
        { params: { token: credentials.token } },
      );
      if (response.data.error) {
        const code = response.data.error.code;
        if (code === 35 || code === 1 || code === 5) {
          throw new UnauthorizedException(`Poster: ${response.data.error.message}`);
        }
        throw new BadGatewayException(`Poster pushOrder error ${code}: ${response.data.error.message}`);
      }
      const incoming = response.data.response;
      const posExternalId = incoming?.incoming_order_id != null ? String(incoming.incoming_order_id) : null;
      if (!posExternalId) throw new BadGatewayException('Poster did not return incoming_order_id');
      return { posExternalId };
    } catch (err) {
      if (err instanceof UnauthorizedException || err instanceof BadGatewayException) throw err;
      if (err instanceof AxiosError && err.response) {
        const status = err.response.status;
        if (status === 401 || status === 403) throw new UnauthorizedException('Poster rejected the token');
        this.logger.warn(`Poster pushOrder failed (${status}): ${JSON.stringify(err.response.data ?? {})}`);
        throw new BadGatewayException(`Poster gateway returned HTTP ${status}`);
      }
      throw err;
    }
  }

  private buildPosterComment(order: OrderForPush): string {
    const lines = [`takeAway #${order.orderCode}`];
    if (order.notes) lines.push(order.notes);
    return lines.join(' · ');
  }

  async subscribeWebhooks(_integration: PosIntegrationCtx, _callbackUrl: string): Promise<void> {
    throw new NotImplementedException('Poster webhook subscription is not available yet (M4)');
  }

  /**
   * Wraps an `axios.get` against the Poster API with envelope unwrapping
   * and error→Nest-exception translation. Tests substitute the underlying
   * axios instance via the `setHttpFactory` hook.
   */
  private async call<T>(integration: PosIntegrationCtx, path: string, params: Record<string, string> = {}): Promise<T> {
    const credentials = integration.credentials as PosterCredentials;
    const settings = integration.settings as PosterSettings;
    const host = posterApiHost(credentials.accountName, settings.apiHost);
    try {
      const response = await this.http(host).get<PosterEnvelope<T>>(path, {
        params: { ...params, token: credentials.token },
      });
      if (response.data.error) {
        const code = response.data.error.code;
        if (code === 35 || code === 1 || code === 5) {
          throw new UnauthorizedException(`Poster: ${response.data.error.message}`);
        }
        throw new BadGatewayException(`Poster API error ${code}: ${response.data.error.message}`);
      }
      return (response.data.response ?? ([] as unknown as T)) as T;
    } catch (err) {
      if (err instanceof UnauthorizedException || err instanceof BadGatewayException) throw err;
      if (err instanceof AxiosError && err.response) {
        const status = err.response.status;
        if (status === 401 || status === 403) {
          throw new UnauthorizedException('Poster rejected the token');
        }
        this.logger.warn(`Poster ${path} failed (${status}): ${JSON.stringify(err.response.data ?? {})}`);
        throw new BadGatewayException(`Poster gateway returned HTTP ${status}`);
      }
      throw err;
    }
  }

  protected http(host: string): AxiosInstance {
    return axios.create({
      baseURL: host,
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Picks a sensible base price across whatever shape Poster returned:
 *   - flat string/number  → direct
 *   - per-spot object     → max across the map
 *   - per-spot `spots[]`  → max across visible spots
 * Returns null if nothing usable was available, so the importer can skip
 * the product instead of writing a 0-priced row.
 */
function posterPriceCents(p: PosterProductRow): number | null {
  const collect: number[] = [];

  const eat = (raw: string | number | undefined): void => {
    if (raw === undefined || raw === null || raw === '') return;
    const n = typeof raw === 'string' ? parseFloat(raw) : raw;
    if (Number.isFinite(n) && n > 0) collect.push(Math.round(n * 100));
  };

  if (typeof p.price === 'string' || typeof p.price === 'number') {
    eat(p.price);
  } else if (p.price && typeof p.price === 'object') {
    for (const v of Object.values(p.price)) eat(v as string | number);
  }
  for (const s of p.spots ?? []) eat(s.price);

  if (collect.length === 0) return null;
  return Math.max(...collect);
}

function posterImageUrls(p: PosterProductRow): string[] | undefined {
  const url = p.photo_origin || p.photo;
  return url ? [url] : undefined;
}

function numberOrUndefined(v: number | string | undefined): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'string' ? parseInt(v, 10) : v;
  return Number.isFinite(n) ? n : undefined;
}

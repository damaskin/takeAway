import { BadGatewayException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import axios, { AxiosError, AxiosInstance } from 'axios';

import { RedisService } from '../../redis/redis.service';
import type {
  IPosProvider,
  IikoCredentials,
  IikoSettings,
  ImportedCategoryDraft,
  ImportedMenu,
  ImportedModifierDraft,
  ImportedProductDraft,
  ImportedStopListEntry,
  ImportedStoreDraft,
  OrderForPush,
  PosIntegrationCtx,
  SyncProgressCtx,
} from './pos-provider.interface';

const DEFAULT_API_HOST = 'https://api-ru.iiko.services';
const TOKEN_TTL_SECONDS = 50 * 60;
const REQUEST_TIMEOUT_MS = 15_000;

interface IikoAccessTokenResponse {
  correlationId?: string;
  token: string;
}

interface IikoOrganizationRow {
  id: string;
  name: string;
  country?: string;
}

interface IikoTerminalGroupItem {
  id: string;
  organizationId: string;
  name: string;
  address?: string;
  timeZone?: string;
}

interface IikoTerminalGroupsResponse {
  terminalGroups?: { organizationId: string; items: IikoTerminalGroupItem[] }[];
}

interface IikoOrganizationsResponse {
  organizations?: IikoOrganizationRow[];
}

interface IikoNomenclatureGroup {
  id: string;
  name?: string;
  description?: string;
  parentGroup?: string | null;
  order?: number;
  isDeleted?: boolean;
}

interface IikoNomenclatureProductCategory {
  id: string;
  name?: string;
  isDeleted?: boolean;
}

interface IikoSizePrice {
  sizeId?: string | null;
  price?: { currentPrice?: number; isIncludedInMenu?: boolean };
}

interface IikoProductModifier {
  /** Modifier-product id — references another row in `products` with type === 'Modifier'. */
  id: string;
  defaultAmount?: number;
  minAmount?: number;
  maxAmount?: number;
  required?: boolean;
}

interface IikoNomenclatureProduct {
  id: string;
  /** "Dish" (default) | "Modifier" | "Goods". Modifier rows are excluded from the catalog import. */
  type?: 'Dish' | 'Modifier' | 'Goods' | string;
  name?: string;
  description?: string;
  isDeleted?: boolean;
  /** Decimal price for products with a single SKU; sizePrices wins when present. */
  price?: number;
  sizePrices?: IikoSizePrice[];
  groupId?: string | null;
  productCategoryId?: string | null;
  modifiers?: IikoProductModifier[];
  imageLinks?: string[];
}

interface IikoNomenclatureResponse {
  groups?: IikoNomenclatureGroup[];
  productCategories?: IikoNomenclatureProductCategory[];
  products?: IikoNomenclatureProduct[];
}

interface IikoStopListItem {
  productId: string;
  /** iiko reports remaining balance — values ≤ 0 mean "stopped". */
  balance?: number;
  sizeId?: string | null;
}

interface IikoStopListTerminalGroup {
  terminalGroupId: string;
  items?: IikoStopListItem[];
}

/**
 * iiko returns stop-lists nested by organizationId then by terminalGroupId.
 * Some deployments flatten the inner level — we accept both shapes.
 */
interface IikoStopListOrgEntry {
  organizationId: string;
  /** Nested form: outer entry holds a list of terminal-group buckets. */
  items?: IikoStopListTerminalGroup[];
  /** Flat form: outer entry IS one terminal group bucket. */
  terminalGroupId?: string;
}

interface IikoStopListsResponse {
  terminalGroupStopLists?: IikoStopListOrgEntry[];
}

interface IikoOrderCreateResponse {
  correlationId?: string;
  orderInfo?: { id: string; externalNumber?: string; organizationId?: string; timestamp?: string };
}

/**
 * Adapter for the iiko Cloud (api-ru.iiko.services) public API.
 *
 * Auth model: a single `apiLogin` is exchanged for a short-lived bearer
 * token at `/api/1/access_token`. Tokens are valid for ~1 hour; we cache
 * them in Redis at 50 minutes to leave a safety margin against clock skew
 * between us and the iiko gateway.
 *
 * Capability matrix:
 *   - testConnection / listStores  — auth ping + terminal-group fan-out
 *   - importMenu                   — `/api/1/nomenclature` per organization
 *   - importStopList               — `/api/1/stop_lists` per organization, polled by cron
 *   - pushOrder                    — `/api/1/order/create` against a terminal group
 *
 * iiko Cloud has no public webhook channel for stop-list / menu changes,
 * so the cron in {@link PosCronService} polls every 30 minutes.
 */
@Injectable()
export class IikoProvider implements IPosProvider {
  readonly kind = 'IIKO' as const;
  readonly supportsStopListPolling = true;
  private readonly logger = new Logger(IikoProvider.name);

  constructor(private readonly redis: RedisService) {}

  async testConnection(integration: PosIntegrationCtx): Promise<void> {
    await this.fetchAccessToken(integration, { force: true });
  }

  async listStores(integration: PosIntegrationCtx): Promise<ImportedStoreDraft[]> {
    const orgIds = await this.resolveOrgIds(integration, { requireOrg: true });
    const groups = await this.callAuthed<IikoTerminalGroupsResponse>(integration, '/api/1/terminal_groups', {
      organizationIds: orgIds,
    });

    const drafts: ImportedStoreDraft[] = [];
    for (const bucket of groups.terminalGroups ?? []) {
      for (const item of bucket.items ?? []) {
        drafts.push({
          externalId: item.id,
          name: item.name?.trim() || `Terminal ${item.id}`,
          addressLine: item.address?.trim() || undefined,
          timezone: item.timeZone || undefined,
        });
      }
    }
    return drafts;
  }

  async importMenu(integration: PosIntegrationCtx, ctx: SyncProgressCtx): Promise<ImportedMenu> {
    const orgId = (integration.settings as IikoSettings).organizationId?.trim();
    if (!orgId) {
      // iiko nomenclature requires exactly one organizationId — pin it on the
      // integration before menu sync. Without it we'd have to fan out across
      // every org, which produces colliding categoryExternalIds.
      throw new BadGatewayException('iiko menu import requires settings.organizationId');
    }

    const data = await this.callAuthed<IikoNomenclatureResponse>(integration, '/api/1/nomenclature', {
      organizationId: orgId,
    });

    const categories = (data.groups ?? [])
      .filter((g) => !g.isDeleted)
      .map<ImportedCategoryDraft>((g) => ({
        externalId: g.id,
        name: g.name?.trim() || `Group ${g.id}`,
        sortOrder: typeof g.order === 'number' ? g.order : undefined,
      }));

    // Index modifier-products so we can flesh out names/prices when a Dish
    // references them via products[].modifiers[].id.
    const productById = new Map<string, IikoNomenclatureProduct>();
    for (const p of data.products ?? []) productById.set(p.id, p);

    const dishes = (data.products ?? []).filter((p) => !p.isDeleted && (p.type ?? 'Dish') !== 'Modifier');
    await ctx.setTotal(dishes.length);

    const products: ImportedProductDraft[] = [];
    const modifiers: ImportedModifierDraft[] = [];
    let processed = 0;
    for (const p of dishes) {
      processed += 1;
      if (processed % 25 === 0) await ctx.advance(25);

      const cents = iikoPriceCents(p);
      if (cents === null) continue;
      const categoryExternalId = p.groupId || p.productCategoryId;
      if (!categoryExternalId) continue;

      products.push({
        externalId: p.id,
        categoryExternalId,
        name: p.name?.trim() || `Product ${p.id}`,
        description: p.description?.trim() || undefined,
        basePriceCents: cents,
        imageUrls: pickImageUrls(p),
      });

      for (const m of p.modifiers ?? []) {
        const mod = productById.get(m.id);
        if (!mod || mod.isDeleted) continue;
        modifiers.push({
          externalId: m.id,
          productExternalId: p.id,
          name: mod.name?.trim() || `Modifier ${m.id}`,
          priceDeltaCents: iikoPriceCents(mod) ?? 0,
          minCount: typeof m.minAmount === 'number' ? m.minAmount : 0,
          maxCount: typeof m.maxAmount === 'number' && m.maxAmount > 0 ? m.maxAmount : 1,
        });
      }
    }
    if (processed % 25 !== 0) await ctx.advance(processed % 25);

    return { categories, products, modifiers };
  }

  async importStopList(integration: PosIntegrationCtx, _ctx: SyncProgressCtx): Promise<ImportedStopListEntry[]> {
    const orgIds = await this.resolveOrgIds(integration, { requireOrg: false });
    if (orgIds.length === 0) return [];

    const data = await this.callAuthed<IikoStopListsResponse>(integration, '/api/1/stop_lists', {
      organizationIds: orgIds,
    });

    const entries: ImportedStopListEntry[] = [];
    for (const orgEntry of data.terminalGroupStopLists ?? []) {
      // Flat shape: outer row IS the terminal group.
      if (orgEntry.terminalGroupId && (orgEntry as IikoStopListTerminalGroup).items) {
        const flat = orgEntry as unknown as IikoStopListTerminalGroup;
        for (const it of flat.items ?? []) {
          if ((it.balance ?? 0) > 0) continue;
          entries.push({ storeExternalId: flat.terminalGroupId, productExternalId: it.productId });
        }
        continue;
      }
      // Nested shape: outer row is org, inner rows are terminal groups.
      for (const tg of orgEntry.items ?? []) {
        for (const it of tg.items ?? []) {
          if ((it.balance ?? 0) > 0) continue;
          entries.push({ storeExternalId: tg.terminalGroupId, productExternalId: it.productId });
        }
      }
    }
    return entries;
  }

  async pushOrder(integration: PosIntegrationCtx, order: OrderForPush): Promise<{ posExternalId: string }> {
    const orgId = (integration.settings as IikoSettings).organizationId?.trim();
    if (!orgId) {
      throw new BadGatewayException(`Cannot push order ${order.orderCode}: settings.organizationId is not pinned`);
    }
    if (!order.storeExternalId) {
      throw new BadGatewayException(`Cannot push order ${order.orderCode}: store has no iiko terminalGroupId`);
    }

    const items = order.items
      .filter((it) => it.productExternalId)
      .map((it) => ({
        type: 'Product' as const,
        productId: it.productExternalId,
        amount: it.quantity,
        modifiers: (it.modifiers ?? [])
          .filter((m) => m.externalId && m.count > 0)
          .map((m) => ({ productId: m.externalId, amount: m.count })),
        comment: it.notes ?? undefined,
      }));
    if (items.length === 0) {
      throw new BadGatewayException(`Cannot push order ${order.orderCode}: no iiko-mapped items`);
    }

    const body = {
      organizationId: orgId,
      terminalGroupId: order.storeExternalId,
      order: {
        id: randomUUID(),
        externalNumber: order.orderCode,
        customer: order.customerName ? { name: order.customerName, type: 'regular' as const } : undefined,
        phone: order.customerPhone ?? undefined,
        comment: order.notes ?? `takeAway #${order.orderCode}`,
        items,
      },
    };

    const response = await this.callAuthed<IikoOrderCreateResponse>(integration, '/api/1/order/create', body);
    const posExternalId = response.orderInfo?.id;
    if (!posExternalId) {
      throw new BadGatewayException('iiko did not return orderInfo.id');
    }
    return { posExternalId };
  }

  /**
   * Resolves the set of organizationIds the caller cares about. If the
   * integration pins one in `settings.organizationId`, we use that; otherwise
   * we fan out via `/api/1/organizations`. Pass `requireOrg: true` to throw
   * when the account exposes zero orgs (the auth-worked-but-empty case).
   */
  private async resolveOrgIds(integration: PosIntegrationCtx, opts: { requireOrg: boolean }): Promise<string[]> {
    const explicit = (integration.settings as IikoSettings).organizationId?.trim();
    if (explicit) return [explicit];

    const response = await this.callAuthed<IikoOrganizationsResponse>(integration, '/api/1/organizations', {});
    const ids = (response.organizations ?? []).map((o) => o.id);
    if (ids.length === 0 && opts.requireOrg) {
      throw new BadGatewayException('iiko returned no organizations for these credentials');
    }
    return ids;
  }

  /**
   * Returns a valid bearer token for the integration. Cached in Redis under
   * `pos:iiko:token:{integrationId}` with a 50-minute TTL.
   *
   * `force: true` skips the cache — used by testConnection so we never
   * report success based on a stale cached token.
   */
  private async fetchAccessToken(integration: PosIntegrationCtx, opts: { force?: boolean } = {}): Promise<string> {
    const cacheKey = `pos:iiko:token:${integration.row.id}`;
    if (!opts.force) {
      const cached = await this.redis.get(cacheKey);
      if (cached) return cached;
    }

    const credentials = integration.credentials as IikoCredentials;
    const settings = integration.settings as IikoSettings;
    const host = settings.apiHost ?? DEFAULT_API_HOST;

    try {
      const response = await this.http(host).post<IikoAccessTokenResponse>('/api/1/access_token', {
        apiLogin: credentials.apiLogin,
      });
      const token = response.data.token;
      if (!token) {
        throw new BadGatewayException('iiko returned an empty access token');
      }
      await this.redis.set(cacheKey, token, TOKEN_TTL_SECONDS);
      return token;
    } catch (err) {
      if (err instanceof AxiosError && err.response) {
        const status = err.response.status;
        if (status === 401 || status === 403) {
          throw new UnauthorizedException('iiko rejected the apiLogin');
        }
        this.logger.warn(`iiko access_token failed (${status}): ${JSON.stringify(err.response.data ?? {})}`);
        throw new BadGatewayException(`iiko gateway returned HTTP ${status}`);
      }
      throw err;
    }
  }

  /**
   * POSTs to an iiko endpoint with the bearer token attached. Reuses the
   * Redis-cached access token; on 401 we drop the cache once and retry.
   */
  private async callAuthed<T>(integration: PosIntegrationCtx, path: string, body: unknown): Promise<T> {
    const settings = integration.settings as IikoSettings;
    const host = settings.apiHost ?? DEFAULT_API_HOST;
    const tryCall = async (token: string): Promise<T> => {
      const response = await this.http(host).post<T>(path, body, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.data;
    };

    try {
      const token = await this.fetchAccessToken(integration);
      return await tryCall(token);
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 401) {
        // Token rotated under us — drop the cache and retry once.
        await this.redis.del(`pos:iiko:token:${integration.row.id}`);
        const fresh = await this.fetchAccessToken(integration, { force: true });
        return await tryCall(fresh);
      }
      if (err instanceof AxiosError && err.response) {
        const status = err.response.status;
        if (status === 401 || status === 403) throw new UnauthorizedException('iiko rejected the apiLogin');
        this.logger.warn(`iiko ${path} failed (${status}): ${JSON.stringify(err.response.data ?? {})}`);
        throw new BadGatewayException(`iiko gateway returned HTTP ${status}`);
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
 * Picks a sensible base price across whatever shape iiko returned:
 *   - flat `price` decimal      → direct
 *   - per-size `sizePrices[]`   → max across menu-included entries
 * Returns null if nothing usable is available (free items, modifier-only
 * rows, or deleted SKUs that slipped past the isDeleted filter).
 */
function iikoPriceCents(p: IikoNomenclatureProduct): number | null {
  const collect: number[] = [];
  const eat = (raw: number | undefined): void => {
    if (raw === undefined || raw === null) return;
    if (Number.isFinite(raw) && raw > 0) collect.push(Math.round(raw * 100));
  };
  eat(p.price);
  for (const sp of p.sizePrices ?? []) {
    if (sp.price?.isIncludedInMenu === false) continue;
    eat(sp.price?.currentPrice);
  }
  if (collect.length === 0) return null;
  return Math.max(...collect);
}

function pickImageUrls(p: IikoNomenclatureProduct): string[] | undefined {
  const urls = (p.imageLinks ?? []).filter((u): u is string => typeof u === 'string' && u.length > 0).slice(0, 5);
  return urls.length > 0 ? urls : undefined;
}

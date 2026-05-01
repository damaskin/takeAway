import {
  BadGatewayException,
  Injectable,
  Logger,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import axios, { AxiosError, AxiosInstance } from 'axios';

import { RedisService } from '../../redis/redis.service';
import type {
  IPosProvider,
  IikoCredentials,
  IikoSettings,
  ImportedMenu,
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

/**
 * Adapter for the iiko Cloud (api-ru.iiko.services) public API.
 *
 * Auth model: a single `apiLogin` is exchanged for a short-lived bearer
 * token at `/api/1/access_token`. Tokens are valid for ~1 hour; we cache
 * them in Redis at 50 minutes to leave a safety margin against clock skew
 * between us and the iiko gateway.
 *
 * For M1 only {@link testConnection} is wired up — listing stores,
 * importing menu/stop-list and pushing orders all live behind
 * NotImplementedException placeholders so the API surface compiles and
 * the admin UI can hit the endpoints, but the actual sync work is M3/M4.
 */
@Injectable()
export class IikoProvider implements IPosProvider {
  readonly kind = 'IIKO' as const;
  /**
   * iiko Cloud has no public webhook channel for stop-list changes, so the
   * cron poller is the only way to keep our copy fresh. Stays `false` until
   * `importStopList` lands (M5+) — flipping it earlier would just keep the
   * cron enqueueing jobs that immediately fail with NotImplementedException.
   */
  readonly supportsStopListPolling = false;
  private readonly logger = new Logger(IikoProvider.name);

  constructor(private readonly redis: RedisService) {}

  async testConnection(integration: PosIntegrationCtx): Promise<void> {
    await this.fetchAccessToken(integration, { force: true });
  }

  async listStores(integration: PosIntegrationCtx): Promise<ImportedStoreDraft[]> {
    const settings = integration.settings as IikoSettings;
    const explicitOrgId = settings.organizationId?.trim();

    const orgIds = explicitOrgId
      ? [explicitOrgId]
      : ((await this.callAuthed<IikoOrganizationsResponse>(integration, '/api/1/organizations', {})).organizations?.map(
          (o) => o.id,
        ) ?? []);
    if (orgIds.length === 0) {
      // Auth worked but the account has no organizations — surface as a
      // proper provider error instead of silently returning [].
      throw new BadGatewayException('iiko returned no organizations for these credentials');
    }

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

  async importMenu(_integration: PosIntegrationCtx, _ctx: SyncProgressCtx): Promise<ImportedMenu> {
    throw new NotImplementedException('iiko menu import is not available yet (M2)');
  }

  async importStopList(_integration: PosIntegrationCtx, _ctx: SyncProgressCtx): Promise<ImportedStopListEntry[]> {
    throw new NotImplementedException('iiko stop-list import is not available yet (M2)');
  }

  async pushOrder(_integration: PosIntegrationCtx, _order: OrderForPush): Promise<{ posExternalId: string }> {
    throw new NotImplementedException('iiko outgoing orders are not available yet (M3)');
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
